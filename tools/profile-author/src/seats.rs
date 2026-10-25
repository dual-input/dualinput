//! `seats`: each seat seeded, then drawn with our figure sitting in it while the author tunes
//! its hip, knees, feet, and eye, and written into the profile at each change
//! (record/areas/avatars/01-avatars.md, "The authoring tool").
//!
//! A seed comes from the profile's own seats, then from the seat objects SimConnect lists,
//! then from the cockpit model's `PILOT_` nodes, and the author's mark on a cushion moves the
//! seat selected or adds one.

use std::time::{Duration, Instant};

use aircraft_model::Vec3;
use aircraft_model::frame::{self, AircraftPose};
use messages::avatars::slots::{
    BODY_SEATED, FIGURES, FigureSlot, FigureState, HAND_REST, HandSlot, PoseSlot, SHOWS_ALL,
};
use messages::avatars::{FIGURE, PALETTE};
use messages::module::slots::SlotHeader;
use messages::module::{ModuleStatus, STATUS};
use profile_engine::features::avatars::Seat;
use sim_client::message::{Camera, Message};
use sim_client::{Area, InitPosition, Tag, Value, Var};
use simconnect_types::SIMCONNECT_SIMOBJECT_TYPE_ALL;

use crate::cockpit::{self, Cockpit};
use crate::profile::{self, Facts, ProfileFile};
use crate::screen::{self, Cursor, Key};
use crate::sim::{Event, Received, SLOT_WRITE};
use crate::yaml;

/// Our figure's SimObject (record/areas/avatars/01-avatars.md, "Names").
const TITLE: &str = "DUALINPUT_FIGURE_PILOT";

/// The sim's freeze events, which hold each figure where `Figure` writes it, as avatars
/// freezes the figures it creates (src/features/avatars/core/src/crew.rs, `FREEZES`).
const FREEZES: [&str; 3] = [
    "K:FREEZE_LATITUDE_LONGITUDE_SET",
    "K:FREEZE_ALTITUDE_SET",
    "K:FREEZE_ATTITUDE_SET",
];

/// How often the tool writes `Figure`'s slot again, as the core does: the routine host drops a
/// routine 1s after its last write (src/platform/sim-service/src/module.rs, `REWRITE`).
const REWRITE: Duration = Duration::from_millis(200);

/// How long the tool waits for our WASM module's status before saying it has none.
const STATUS_WAIT: Duration = Duration::from_secs(3);

/// A new seat's knees, feet, and eye, the format's example seat, which the author tunes from
/// (record/areas/profiles/01-format-and-delivery.md, "Seats").
const KNEES: [f64; 2] = [0.05, 0.45];
const FEET: [f64; 2] = [-0.42, 0.62];
const EYE: [f64; 2] = [0.63, -0.05];

/// A seed this close to a seat already listed is that seat, as p21 paired each seat object
/// with the `PILOT_` node within 0.3m of it (read in experiments/areas/avatars/p21-yoke-hands.mjs).
const SAME_SEAT: f32 = 0.3;

/// The palette's colors for the seat selected and the others.
const SELECTED: u32 = 0;
const OTHER: u32 = 1;

/// Seat objects lie within this many meters of the aircraft, where p03 listed the C152's
/// (measured on MSFS 2024, 2026-10-02, record/areas/avatars/log.md, "Seat objects place the
/// other pilot in the cockpit").
const NEAR: u32 = 50;

/// How long the tool takes the sim's answers to the read of every object near, one answer
/// for each, which p21 gave 2s (read in experiments/areas/avatars/p21-yoke-hands.mjs,
/// `sim.byType`).
const LISTING: Duration = Duration::from_secs(2);

/// The seats to start from. While any of the profile's seats applies to the loaded variant,
/// they're the seats, so a seat the author dropped or moved stays as they left it. Otherwise
/// each seat object seeds one, then each `PILOT_` node no seat object sits on. A seed takes
/// `only` with the loaded variant when the profile holds other variants' seats, since a
/// variant with a different cabin gets seats of its own
/// (record/areas/profiles/01-format-and-delivery.md, "Seats").
pub fn seeds(
    existing: &[Seat],
    variant: &str,
    objects: &[(String, Vec3)],
    nodes: &[(String, Vec3)],
) -> Vec<Seat> {
    let mut seats = existing.to_vec();
    if existing.iter().any(|s| applies(s, variant)) {
        return seats;
    }
    let start = seats.len();
    let taken = |seats: &[Seat], at: Vec3| {
        seats[start..]
            .iter()
            .any(|s| distance(hip(s), at) < SAME_SEAT)
    };
    for (title, at) in objects {
        if taken(&seats, *at) {
            continue;
        }
        let word = title.rsplit('_').next().unwrap_or(title);
        let key = unique(&seats, &snake(word));
        seats.push(seat(key, word.to_string(), *at));
    }
    for (node, at) in nodes {
        if taken(&seats, *at) {
            continue;
        }
        // Left of the centerline is the pilot's side, which picks the hand rules
        // (record/areas/profiles/01-format-and-delivery.md, "Seats").
        let (key, name) = if at[0] > 0.0 {
            ("pilot", "Pilot")
        } else {
            ("copilot", "Copilot")
        };
        let (key, name) = if seats.iter().any(|s| s.key == key) {
            (unique(&seats, &snake(node)), node.clone())
        } else {
            (key.to_string(), name.to_string())
        };
        seats.push(seat(key, name, *at));
    }
    if start > 0 {
        for s in &mut seats[start..] {
            s.only = vec![variant.to_string()];
        }
    }
    seats
}

fn seat(key: String, name: String, hip: Vec3) -> Seat {
    Seat {
        key,
        name,
        hip: hip.map(f64::from),
        knees: KNEES,
        feet: FEET,
        eye: EYE,
        facing: 0.0,
        take_radius: None,
        only: Vec::new(),
    }
}

pub fn applies(seat: &Seat, variant: &str) -> bool {
    seat.only.is_empty() || seat.only.iter().any(|o| o == variant)
}

/// A seat's key in the form an entry's key takes, lowercase snake_case starting with a letter.
fn snake(word: &str) -> String {
    let key: String = word
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    if key.starts_with(|c: char| c.is_ascii_lowercase()) {
        key
    } else {
        format!("seat_{key}")
    }
}

fn unique(seats: &[Seat], key: &str) -> String {
    let free = |k: &str| !seats.iter().any(|s| s.key == k);
    if free(key) {
        return key.to_string();
    }
    (2..)
        .map(|n| format!("{key}_{n}"))
        .find(|k| free(k))
        .expect("some count is free")
}

fn distance(a: Vec3, b: Vec3) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

fn hip(seat: &Seat) -> Vec3 {
    seat.hip.map(|c| c as f32)
}

/// A seat's eye in the aircraft's frame, as avatars places it.
fn eye(seat: &Seat) -> Vec3 {
    frame::eye(
        hip(seat),
        seat.eye[0] as f32,
        seat.eye[1] as f32,
        seat.facing as f32,
    )
}

/// The eye a seat takes from a camera at `camera`: its height above the hip, and how far it
/// sits ahead of the hip along the seat's facing, since a seat's eye doesn't go sideways.
fn eye_at(seat: &Seat, camera: Vec3) -> [f64; 2] {
    let f = frame::facing(seat.facing as f32);
    let hip = hip(seat);
    let ahead = (camera[0] - hip[0]) * f[0] + (camera[2] - hip[2]) * f[2];
    [f64::from(camera[1] - hip[1]), f64::from(ahead)]
}

/// `Figure`'s slot for the figures drawn, each seat with its figure's object: seated at its
/// hip, its head at its eye looking along its facing, and its hands at rest. The tool feeds no
/// yoke, so no hand holds one.
pub fn slot(figures: &[(&Seat, u32)], selected: Option<&str>) -> FigureSlot {
    let mut slot: FigureSlot = bytemuck::Zeroable::zeroed();
    let rest = HandSlot {
        kind: HAND_REST,
        side: 0,
        point: [0.0; 3],
    };
    for (place, (seat, object)) in slot.figures.iter_mut().zip(figures) {
        *place = FigureState {
            object: *object,
            color: if Some(seat.key.as_str()) == selected {
                SELECTED
            } else {
                OTHER
            },
            shows: SHOWS_ALL,
            slumps: 0,
            hip: hip(seat),
            knees: seat.knees.map(|v| v as f32),
            feet: seat.feet.map(|v| v as f32),
            facing: seat.facing as f32,
            pose: PoseSlot {
                body: BODY_SEATED,
                eye: eye(seat),
                look: frame::facing(seat.facing as f32),
                at: [0.0; 3],
                heading: 0.0,
                crouch: 0,
                hands: [rest; 2],
            },
        };
    }
    slot.count = figures.len().min(FIGURES) as u32;
    slot
}

/// The bytes the tool writes into `Figure`'s slot: the header the routine host checks, with
/// this build's `SLOTS_HASH`, then the slot.
pub fn slot_bytes(feeds: u32, counter: u64, slot: &FigureSlot) -> Vec<u8> {
    let header = SlotHeader {
        feeds,
        end: 0,
        slots_hash: messages::SLOTS_HASH,
        counter,
    };
    let mut bytes = bytemuck::bytes_of(&header).to_vec();
    bytes.extend_from_slice(bytemuck::bytes_of(slot));
    bytes
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Part {
    Hip,
    Knees,
    Feet,
    Eye,
}

#[derive(Debug, PartialEq)]
enum Command {
    Select(String),
    Name(String),
    Key(String),
    Set {
        part: Part,
        values: Vec<f64>,
        by: bool,
    },
    EyeAtCamera,
    Facing(f64),
    Radius(Option<f64>),
    Only(Vec<String>),
    Drop,
    List,
    Help,
    Quit,
}

const HELP: &str = "\
Commands, each typed here and ended with Enter:
  seat <key>               select a seat, or add one with that key
  name <text>              the seat's name, which a pilot reads
  key <key>                the seat's key, which poses carry between machines
  hip <x> <y> <z>          meters from the reference point, x left, y up, z forward
  knees|feet|eye <up> <forward>
                           meters from the hip, in the seat's own frame
  hip|knees|feet|eye by <numbers>
                           move it by that much
  eye camera               the eye where the camera is now
  facing <degrees>         from the nose, positive to the right
  radius <meters>|default  how near its eye the camera takes the seat
  only <variant>...|all    the variants the seat applies to
  drop                     take the seat out of the profile
  list                     every seat
  quit                     end; every change is already written
Page Down in the sim puts the selected seat's hip where the cursor points.";

fn parse(line: &str) -> Result<Command, String> {
    let words: Vec<&str> = line.split_whitespace().collect();
    let numbers = |from: &[&str]| -> Result<Vec<f64>, String> {
        from.iter()
            .map(|w| {
                w.parse::<f64>()
                    .map_err(|_| format!("`{w}` isn't a number"))
            })
            .collect()
    };
    let rest = || {
        line.trim()
            .split_once(' ')
            .map_or("", |(_, r)| r.trim())
            .to_string()
    };
    match words.as_slice() {
        [] => Err(String::new()),
        ["seat", key] => Ok(Command::Select(snake(key))),
        ["name", _, ..] => Ok(Command::Name(rest())),
        ["key", key] => Ok(Command::Key(snake(key))),
        ["eye", "camera"] => Ok(Command::EyeAtCamera),
        [part @ ("hip" | "knees" | "feet" | "eye"), more @ ..] => {
            let part = match *part {
                "hip" => Part::Hip,
                "knees" => Part::Knees,
                "feet" => Part::Feet,
                _ => Part::Eye,
            };
            let (by, values) = match more {
                ["by", values @ ..] => (true, numbers(values)?),
                values => (false, numbers(values)?),
            };
            let wanted = if part == Part::Hip { 3 } else { 2 };
            if values.len() != wanted {
                return Err(format!("that takes {wanted} numbers"));
            }
            Ok(Command::Set { part, values, by })
        }
        ["facing", degrees] => Ok(Command::Facing(numbers(&[degrees])?[0])),
        ["radius", "default"] => Ok(Command::Radius(None)),
        ["radius", meters] => {
            let r = numbers(&[meters])?[0];
            if r <= 0.0 {
                return Err("a radius is a number of meters above 0".into());
            }
            Ok(Command::Radius(Some(r)))
        }
        ["only", "all"] => Ok(Command::Only(Vec::new())),
        ["only", ids @ ..] if !ids.is_empty() => {
            Ok(Command::Only(ids.iter().map(|s| s.to_string()).collect()))
        }
        ["drop"] => Ok(Command::Drop),
        ["list"] => Ok(Command::List),
        ["help"] => Ok(Command::Help),
        ["quit"] => Ok(Command::Quit),
        _ => Err("that isn't a command; `help` lists them".into()),
    }
}

/// Moves one part of a seat to `values`, or by them.
fn set(seat: &mut Seat, part: Part, values: &[f64], by: bool) {
    let target: &mut [f64] = match part {
        Part::Hip => &mut seat.hip,
        Part::Knees => &mut seat.knees,
        Part::Feet => &mut seat.feet,
        Part::Eye => &mut seat.eye,
    };
    for (t, v) in target.iter_mut().zip(values) {
        *t = if by { *t + v } else { *v };
    }
}

fn describe(seat: &Seat) -> String {
    let mut text = format!(
        "{} ({}): hip {}, knees {}, feet {}, eye {}",
        seat.key,
        seat.name,
        point(&seat.hip),
        point(&seat.knees),
        point(&seat.feet),
        point(&seat.eye)
    );
    if seat.facing != 0.0 {
        text += &format!(", facing {}°", seat.facing);
    }
    if let Some(r) = seat.take_radius {
        text += &format!(", take radius {}m", profile::meters(r));
    }
    if !seat.only.is_empty() {
        text += &format!(", only {}", seat.only.join(", "));
    }
    text
}

fn point(values: &[f64]) -> String {
    let items: Vec<String> = values.iter().map(|v| profile::meters(*v)).collect();
    format!("[{}]", items.join(", "))
}

/// What the camera's next answer is for.
enum Asked {
    Hip(Cursor),
    Eye,
}

/// One figure: its seat's key, the create waiting for its object, and its object.
struct Figure {
    key: String,
    create: u32,
    tag: Option<Tag>,
    object: Option<u32>,
}

struct Session {
    cockpit: Cockpit,
    file: ProfileFile,
    variant: String,
    seats: Vec<Seat>,
    /// Keys the profile holds that the author dropped or renamed since its last write.
    gone: Vec<String>,
    selected: Option<String>,
    figures: Vec<Figure>,
    area: Area,
    feeds: u32,
    /// Until the sim refuses a write of the slot.
    feeding: bool,
    /// The read of our WASM module's status, until it answers.
    status_read: Option<u32>,
    asked: Option<Asked>,
}

pub fn run(file: ProfileFile) -> Result<(), String> {
    let facts = Facts::read(&file.read()?)?;
    let mut cockpit = Cockpit::connect()?;
    let variant = facts.variant(&cockpit.aircraft).ok_or_else(|| {
        format!(
            "{} covers none of the loaded aircraft, {}",
            file.path.display(),
            cockpit.aircraft
        )
    })?;
    println!("variant: {variant}");
    let nodes = cockpit.model.seat_seeds().to_vec();
    let objects = seat_objects(&mut cockpit)?;
    let seats = seeds(&facts.seats, &variant, &objects, &nodes);
    for s in &seats {
        let from = if facts.seats.iter().any(|f| f.key == s.key) {
            "from the profile"
        } else if objects.iter().any(|(_, at)| distance(*at, hip(s)) < 1e-3) {
            "seeded from a seat object"
        } else {
            "seeded from a PILOT_ node"
        };
        println!("  {}, {from}", describe(s));
    }
    let size = (size_of::<SlotHeader>() + size_of::<FigureSlot>()) as u32;
    let (area, ops) = cockpit.sim.client.area(&(), &FIGURE.slot(), size);
    cockpit.sim.make(ops);
    let (status, ops) = cockpit
        .sim
        .client
        .area(&(), STATUS, size_of::<ModuleStatus>() as u32);
    cockpit.sim.make(ops);
    let (request, op) = cockpit.sim.client.read_area(&(), status);
    cockpit.sim.make([op]);
    let selected = seats
        .iter()
        .find(|s| applies(s, &variant))
        .map(|s| s.key.clone());
    let mut session = Session {
        cockpit,
        file,
        variant,
        seats,
        gone: Vec::new(),
        selected,
        figures: Vec::new(),
        area,
        feeds: 0,
        feeding: true,
        status_read: Some(request),
        asked: None,
    };
    if session.seats != facts.seats {
        session.write()?;
        println!(
            "wrote the seeded seats into {}",
            session.file.path.display()
        );
    }
    session.sync_figures();
    println!("{HELP}");
    session.show_selected();
    session.run()
}

/// The seat objects near the aircraft, which p21 told from the other objects by their titles'
/// `SEAT_`, each with its title and its place in the aircraft's frame, through the aircraft's
/// pose. In flight the sim reports a seat object a frame behind the aircraft, about 2m at
/// 100 kt, so a seat object seeds a seat well only while the aircraft stands still (measured
/// on MSFS 2024, 2026-10-03, record/areas/avatars/log.md, "Led by one frame, a WASM-written
/// figure sits in the seat of a flying aircraft").
fn seat_objects(cockpit: &mut Cockpit) -> Result<Vec<(String, Vec3)>, String> {
    let vars = [
        Var::text("A:TITLE"),
        Var::number("A:PLANE LATITUDE", "degrees"),
        Var::number("A:PLANE LONGITUDE", "degrees"),
        Var::number("A:PLANE ALTITUDE", "feet"),
    ];
    let (request, ops) =
        cockpit
            .sim
            .client
            .read_by_type(&(), SIMCONNECT_SIMOBJECT_TYPE_ALL, NEAR, &vars);
    cockpit.sim.make(ops);
    let mut found = Vec::new();
    let end = Instant::now() + LISTING;
    while let Some(event) = cockpit
        .events
        .next(end.saturating_duration_since(Instant::now()))
    {
        let Event::Sim(up) = event else {
            continue;
        };
        let Some(received) = cockpit.sim.receive(up)? else {
            continue;
        };
        if cockpit.take(&received) {
            continue;
        }
        let Received::Message(Message::ObjectData(d)) = &received else {
            continue;
        };
        if d.request != request {
            continue;
        }
        let values = cockpit.sim.client.values(d).unwrap_or_default();
        found.extend(seat_object(values, &cockpit.pose));
    }
    let titles: Vec<&str> = found.iter().map(|(t, _)| t.as_str()).collect();
    println!(
        "seat objects within {NEAR}m: {}",
        if titles.is_empty() {
            "none".to_string()
        } else {
            titles.join(", ")
        }
    );
    Ok(found)
}

/// One object's answer to the read: its title and its place in the aircraft's frame, when
/// it's a seat object.
fn seat_object(values: Vec<(usize, Value)>, pose: &AircraftPose) -> Option<(String, Vec3)> {
    let (mut title, mut at) = (String::new(), [0.0; 3]);
    for (i, value) in values {
        match (i, value) {
            (0, Value::Text(t)) => title = t,
            (1..=3, Value::Number(n)) => at[i - 1] = n,
            _ => {}
        }
    }
    if !title.to_ascii_uppercase().starts_with("SEAT_") {
        return None;
    }
    let [lat, lon, alt] = at;
    Some((title, frame::world_to_frame(pose, lat, lon, alt)))
}

impl Session {
    fn run(&mut self) -> Result<(), String> {
        let started = Instant::now();
        let mut written = Instant::now();
        loop {
            if self.status_read.is_some() && started.elapsed() > STATUS_WAIT {
                self.status_read = None;
                println!(
                    "  our WASM module wrote no status within 3s: install the dualinput package in Community and restart the sim, or Figure draws nothing"
                );
            }
            let wait = REWRITE.saturating_sub(written.elapsed());
            match self.cockpit.events.next(wait) {
                Some(Event::Sim(up)) => {
                    if let Some(received) = self.cockpit.sim.receive(up)? {
                        self.received(received);
                    }
                }
                Some(Event::Key {
                    key: Key::Mark,
                    sim_in_front,
                }) => self.mark(sim_in_front),
                Some(Event::Key { .. }) => {}
                Some(Event::Line(line)) => match parse(&line) {
                    Ok(Command::Quit) => return Ok(()),
                    Ok(command) => {
                        if let Err(e) = self.command(command) {
                            println!("  {e}");
                        }
                    }
                    Err(e) if e.is_empty() => {}
                    Err(e) => println!("  {e}"),
                },
                Some(Event::Closed) => return Ok(()),
                None => {}
            }
            if written.elapsed() >= REWRITE {
                self.feed(false);
                written = Instant::now();
            }
        }
    }

    fn received(&mut self, received: Received) {
        if self.cockpit.take(&received) {
            return;
        }
        match received {
            Received::Message(Message::Assigned { request, object }) => {
                let Some(figure) = self.figures.iter_mut().find(|f| f.create == request) else {
                    // Its seat went while the sim created it.
                    let op = self.cockpit.sim.client.remove(object);
                    self.cockpit.sim.make([op]);
                    return;
                };
                figure.object = Some(object);
                for event in FREEZES {
                    let ops = self.cockpit.sim.client.key_on(&(), object, event, 1);
                    self.cockpit.sim.make(ops);
                }
                self.feed(true);
            }
            Received::Message(Message::ClientData(d)) if Some(d.request) == self.status_read => {
                self.status_read = None;
                let Some(bytes) = d.bytes.get(..size_of::<ModuleStatus>()) else {
                    return;
                };
                let status: ModuleStatus = bytemuck::pod_read_unaligned(bytes);
                if status.slots_hash == messages::SLOTS_HASH {
                    println!(
                        "  our WASM module runs, version {}, from this build",
                        status.version()
                    );
                } else {
                    println!(
                        "  our WASM module, version {}, is from another build, so Figure ignores this tool's slot: build and install the package from this tree",
                        status.version()
                    );
                }
            }
            Received::Message(Message::Camera(camera)) => {
                if let Some(asked) = self.asked.take() {
                    self.camera(asked, &camera);
                }
            }
            // A module from another build may lay its slot out smaller, and SimConnect may
            // then refuse each write of this build's larger slot (unverified), which the
            // rewrite would print 5 times a second, so the tool stops at the first.
            Received::Refused { what, .. } if what == SLOT_WRITE => {
                if self.feeding {
                    self.feeding = false;
                    println!(
                        "  the tool stops feeding Figure; build and install the package from this tree, then start the tool again"
                    );
                }
            }
            Received::Refused { call, .. } => {
                if let Some(figure) = self
                    .figures
                    .iter_mut()
                    .find(|f| f.tag.is_some() && f.tag == call)
                {
                    figure.tag = None;
                    println!(
                        "  the sim couldn't create {TITLE} for {}: install the dualinput package in Community and restart the sim",
                        figure.key
                    );
                }
            }
            Received::Message(_) => {}
        }
    }

    fn mark(&mut self, sim_in_front: bool) {
        if !sim_in_front {
            println!("  Page Down marks only while the sim is in front");
            return;
        }
        let Some(cursor) = screen::cursor().filter(Cursor::over_window) else {
            println!("  the cursor isn't over the sim's window");
            screen::beep(false);
            return;
        };
        self.asked = Some(Asked::Hip(cursor));
        self.cockpit.ask_camera();
    }

    fn camera(&mut self, asked: Asked, camera: &Camera) {
        let Some(key) = self.selected.clone() else {
            println!("  no seat is selected: `seat <key>` adds one");
            return;
        };
        let Some(seat) = self.seats.iter_mut().find(|s| s.key == key) else {
            return;
        };
        match asked {
            Asked::Hip(cursor) => {
                let Some((hit, scene)) = cockpit::cast(&mut self.cockpit.model, camera, &cursor)
                else {
                    println!(
                        "  the ray met nothing: point at the cushion and press Page Down again"
                    );
                    screen::beep(false);
                    return;
                };
                seat.hip = hit.point.map(f64::from);
                let node = self.cockpit.model.node_name(scene, hit.node).unwrap_or("?");
                screen::beep(true);
                println!("  the hip went where the cursor points, on {node}");
            }
            Asked::Eye => {
                seat.eye = eye_at(seat, camera.position.map(|c| c as f32));
                println!("  the eye went where the camera is");
            }
        }
        self.changed();
        self.show_selected();
    }

    fn command(&mut self, command: Command) -> Result<(), String> {
        if let Command::Select(key) = &command {
            let key = key.clone();
            if !self.seats.iter().any(|s| s.key == key) {
                let mut seat = seat(key.clone(), key.clone(), [0.0; 3]);
                // A new seat starts at the selected seat's hip, and applies to the variants it
                // does, until it's marked; with none selected, the profile's seats are all
                // other variants', as `seeds` takes them.
                match self.selected_seat() {
                    Some(s) => (seat.hip, seat.only) = (s.hip, s.only.clone()),
                    None if !self.seats.is_empty() => seat.only = vec![self.variant.clone()],
                    None => {}
                }
                self.seats.push(seat);
                self.selected = Some(key);
                self.changed();
                println!(
                    "  added: press Page Down with the cursor on its cushion to place its hip"
                );
            } else {
                self.selected = Some(key);
                self.feed(true);
            }
            self.show_selected();
            return Ok(());
        }
        if let Command::List | Command::Help = command {
            if command == Command::Help {
                println!("{HELP}");
            }
            for s in &self.seats {
                let marker = if Some(&s.key) == self.selected.as_ref() {
                    "*"
                } else {
                    " "
                };
                println!(" {marker} {}", describe(s));
            }
            return Ok(());
        }
        let key = self
            .selected
            .clone()
            .ok_or("no seat is selected: `seat <key>` picks one")?;
        if let Command::EyeAtCamera = command {
            self.asked = Some(Asked::Eye);
            self.cockpit.ask_camera();
            return Ok(());
        }
        if let Command::Key(new) = &command
            && self.seats.iter().any(|s| &s.key == new)
        {
            return Err(format!("a seat already has the key {new}"));
        }
        let at = self
            .seats
            .iter()
            .position(|s| s.key == key)
            .ok_or("the selected seat is gone")?;
        let seat = &mut self.seats[at];
        match command {
            Command::Name(name) => seat.name = name,
            Command::Key(new) => {
                self.gone
                    .push(std::mem::replace(&mut seat.key, new.clone()));
                if let Some(f) = self.figures.iter_mut().find(|f| f.key == key) {
                    f.key = new.clone();
                }
                self.selected = Some(new);
            }
            Command::Set { part, values, by } => set(seat, part, &values, by),
            Command::Facing(d) => seat.facing = d,
            Command::Radius(r) => seat.take_radius = r,
            Command::Only(ids) => {
                let known: Vec<String> = Facts::read(&self.file.read()?)?
                    .variants
                    .into_iter()
                    .map(|v| v.id)
                    .collect();
                if let Some(bad) = ids.iter().find(|i| !known.contains(i)) {
                    return Err(format!(
                        "the profile has no variant {bad}; it has {}",
                        known.join(", ")
                    ));
                }
                seat.only = ids;
            }
            Command::Drop => {
                let gone = self.seats.remove(at);
                self.gone.push(gone.key.clone());
                self.selected = self
                    .seats
                    .iter()
                    .find(|s| applies(s, &self.variant))
                    .map(|s| s.key.clone());
                println!("  dropped {}", gone.key);
            }
            Command::Select(_)
            | Command::EyeAtCamera
            | Command::List
            | Command::Help
            | Command::Quit => {}
        }
        self.changed();
        self.show_selected();
        Ok(())
    }

    fn selected_seat(&self) -> Option<&Seat> {
        let key = self.selected.as_ref()?;
        self.seats.iter().find(|s| &s.key == key)
    }

    fn show_selected(&self) {
        match self.selected_seat() {
            Some(s) => println!(
                "selected, drawn {}: {}",
                PALETTE[SELECTED as usize],
                describe(s)
            ),
            None => println!("no seat yet: `seat pilot` adds one"),
        }
    }

    /// Writes the profile, and draws the change.
    fn changed(&mut self) {
        match self.write() {
            Ok(()) => self.gone.clear(),
            Err(e) => println!("  {e}"),
        }
        self.sync_figures();
        self.feed(true);
    }

    fn write(&mut self) -> Result<(), String> {
        let mut text = self.file.read()?;
        for key in &self.gone {
            text = yaml::remove(&text, &["seats", key])?;
        }
        for seat in &self.seats {
            text = profile::write_seat(&text, seat)?;
        }
        if self.seats.is_empty() {
            text = yaml::remove(&text, &["seats"])?;
        }
        self.file.write(&text)
    }

    /// Keeps one figure for each seat that applies to the loaded variant, up to the slot's
    /// eight: removes the figure of a seat dropped or left out of the variant, and creates each
    /// one missing at the aircraft's place, where `Figure` moves it once it's fed. A figure
    /// whose create is still out goes when its object comes.
    fn sync_figures(&mut self) {
        let (seats, variant) = (&self.seats, &self.variant);
        let (kept, gone): (Vec<Figure>, Vec<Figure>) = std::mem::take(&mut self.figures)
            .into_iter()
            .partition(|f| seats.iter().any(|s| s.key == f.key && applies(s, variant)));
        self.figures = kept;
        for object in gone.into_iter().filter_map(|f| f.object) {
            let op = self.cockpit.sim.client.remove(object);
            self.cockpit.sim.make([op]);
        }
        let pose = self.cockpit.pose;
        let at = InitPosition {
            latitude: pose.latitude,
            longitude: pose.longitude,
            altitude: pose.altitude,
            pitch: pose.pitch,
            bank: pose.bank,
            heading: pose.heading,
            on_ground: false,
            airspeed: 0,
        };
        let wanted: Vec<String> = self
            .seats
            .iter()
            .filter(|s| applies(s, &self.variant))
            .map(|s| s.key.clone())
            .filter(|k| !self.figures.iter().any(|f| &f.key == k))
            .take(FIGURES.saturating_sub(self.figures.len()))
            .collect();
        for key in wanted {
            let (create, op) = self.cockpit.sim.client.create(TITLE, "", at);
            let tag = self.cockpit.sim.make([op]).pop();
            self.figures.push(Figure {
                key,
                create,
                tag,
                object: None,
            });
        }
    }

    /// Writes `Figure`'s slot, as a new feed or as a rewrite of the last.
    fn feed(&mut self, new: bool) {
        let drawn: Vec<(&Seat, u32)> = self
            .figures
            .iter()
            .filter_map(|f| Some((self.seats.iter().find(|s| s.key == f.key)?, f.object?)))
            .collect();
        if drawn.is_empty() || !self.feeding {
            return;
        }
        if new {
            self.feeds = self.feeds.wrapping_add(1);
        }
        let bytes = slot_bytes(
            self.feeds,
            screen::now(),
            &slot(&drawn, self.selected.as_deref()),
        );
        let op = self.cockpit.sim.client.write_area(self.area, bytes);
        self.cockpit.sim.make([op]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn existing() -> Seat {
        seat("pilot".into(), "Pilot".into(), [0.28, 0.12, -0.05])
    }

    #[test]
    fn seeds_come_from_seat_objects_then_pilot_nodes_each_once() {
        let objects = [
            ("SEAT_DEFAULT_Pilot".to_string(), [0.283, 0.13, -0.04]),
            ("SEAT_C152_Pax".to_string(), [-0.21, -0.13, 0.1]),
        ];
        let nodes = [
            ("PILOT_1".to_string(), [-0.282, 0.13, -0.05]),
            ("PILOT_2".to_string(), [-0.2, -0.12, 0.1]),
        ];
        let seats = seeds(&[], "press", &objects, &nodes);
        let keys: Vec<&str> = seats.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(
            keys,
            ["pilot", "pax", "copilot"],
            "PILOT_2 sits on the Pax object"
        );
        assert_eq!(seats[1].name, "Pax");
        assert_eq!(seats[2].hip, [-0.282f32, 0.13, -0.05].map(f64::from));
        assert_eq!(
            (seats[2].knees, seats[2].feet, seats[2].eye),
            (KNEES, FEET, EYE)
        );
        assert!(seats.iter().all(|s| s.only.is_empty()));

        let kept = seeds(&[existing()], "press", &objects, &nodes);
        assert_eq!(
            kept,
            vec![existing()],
            "with a seat of its own, the profile's seats stand, so a seat dropped stays dropped"
        );

        let from_nodes = seeds(&[], "press", &[], &nodes[..1]);
        assert_eq!(
            from_nodes[0].key, "copilot",
            "PILOT_1 is right of the centerline in the 58P"
        );
        let both = seeds(
            &[],
            "press",
            &[],
            &[nodes[0].clone(), ("PILOT_3".into(), [-0.9, 0.1, -1.0])],
        );
        assert_eq!(both[1].key, "pilot_3");
    }

    #[test]
    fn a_seed_beside_another_variants_seat_is_the_loaded_variants_own() {
        let mut other = existing();
        other.only = vec!["base".into()];
        let objects = [("SEAT_DEFAULT_Pilot".to_string(), [0.283, 0.13, -0.04])];
        let seats = seeds(&[other], "press", &objects, &[]);
        assert_eq!(seats.len(), 2);
        assert_eq!(
            seats[1].key, "pilot_2",
            "the other variant's seat keeps its key"
        );
        assert_eq!(
            seats[1].only,
            ["press"],
            "so the base variant keeps one seat at that spot"
        );
    }

    #[test]
    fn the_slot_seats_each_figure_at_its_hip_with_its_head_at_its_eye() {
        let mut copilot = existing();
        copilot.key = "copilot".into();
        copilot.hip[0] = -0.28;
        copilot.facing = 90.0;
        let pilot = existing();
        let slot = slot(&[(&pilot, 0x101), (&copilot, 0x102)], Some("copilot"));
        assert_eq!(slot.count, 2);
        let [a, b] = [slot.figures[0], slot.figures[1]];
        assert_eq!((a.object, a.color, b.color), (0x101, OTHER, SELECTED));
        assert_eq!(a.hip, [0.28, 0.12, -0.05]);
        assert_eq!(a.pose.body, BODY_SEATED);
        assert!(
            (a.pose.eye[1] - (0.12 + 0.63)).abs() < 1e-6
                && (a.pose.eye[2] - (-0.05 - 0.05)).abs() < 1e-6
        );
        assert!(
            (b.pose.look[0] + 1.0).abs() < 1e-6,
            "facing right is toward −x: {:?}",
            b.pose.look
        );
        assert_eq!(a.pose.hands[0].kind, HAND_REST);
        assert_eq!(slot.yokes[0].present, 0);

        let bytes = slot_bytes(7, 1_234, &slot);
        assert_eq!(
            bytes.len(),
            size_of::<SlotHeader>() + size_of::<FigureSlot>()
        );
        assert!(bytes.len() <= 8_192, "a client data area holds 8,192 bytes");
        let header: SlotHeader = bytemuck::pod_read_unaligned(&bytes[..size_of::<SlotHeader>()]);
        assert_eq!(
            header,
            SlotHeader {
                feeds: 7,
                end: 0,
                slots_hash: messages::SLOTS_HASH,
                counter: 1_234,
            }
        );
        let back: FigureSlot = bytemuck::pod_read_unaligned(&bytes[size_of::<SlotHeader>()..]);
        assert_eq!(back.figures[1].object, 0x102);
    }

    /// The Baron's pilot's seat object sat 0.283m left of the reference point (measured on
    /// MSFS 2024, 2026-10-03, record/areas/avatars/log.md, "One hand holds the yoke through
    /// its whole travel").
    #[test]
    fn a_seat_object_is_told_by_its_title_and_placed_in_the_aircrafts_frame() {
        let pose = AircraftPose {
            latitude: 47.0,
            longitude: 8.0,
            altitude: 1_500.0,
            heading: 90.0,
            ..AircraftPose::default()
        };
        // Facing east, left of the aircraft is north.
        let north = (0.283 / 6_367_000.0f64).to_degrees();
        let values = |title: &str| {
            vec![
                (0, Value::Text(title.into())),
                (1, Value::Number(47.0 + north)),
                (2, Value::Number(8.0)),
                (3, Value::Number(1_500.0)),
            ]
        };
        let (title, at) = seat_object(values("SEAT_DEFAULT_Pilot"), &pose).unwrap();
        assert_eq!(title, "SEAT_DEFAULT_Pilot");
        assert!(
            (at[0] - 0.283).abs() < 2e-3 && at[1].abs() < 1e-3 && at[2].abs() < 1e-3,
            "{at:?}"
        );
        assert_eq!(seat_object(values("Black Square Baron 58P"), &pose), None);
    }

    #[test]
    fn the_eye_a_camera_gives_a_seat_puts_the_seats_eye_at_the_camera() {
        let mut s = existing();
        s.eye = eye_at(&s, [0.25, 0.8, 0.1]);
        assert!(
            (s.eye[0] - 0.68).abs() < 1e-5 && (s.eye[1] - 0.15).abs() < 1e-5,
            "{:?}",
            s.eye
        );
        let e = eye(&s);
        assert!(
            (e[1] - 0.8).abs() < 1e-5 && (e[2] - 0.1).abs() < 1e-5,
            "{e:?}"
        );
        s.facing = 90.0;
        s.eye = eye_at(&s, [0.08, 0.8, -0.05]);
        assert!(
            (s.eye[1] - 0.2).abs() < 1e-5,
            "facing right, the camera 0.2m toward −x is ahead"
        );
    }

    #[test]
    fn commands_read_as_the_help_gives_them() {
        assert_eq!(
            parse("hip by 0 0.01 -0.02").unwrap(),
            Command::Set {
                part: Part::Hip,
                values: vec![0.0, 0.01, -0.02],
                by: true
            }
        );
        assert_eq!(
            parse("eye 0.63 -0.05").unwrap(),
            Command::Set {
                part: Part::Eye,
                values: vec![0.63, -0.05],
                by: false
            }
        );
        assert_eq!(parse("eye camera").unwrap(), Command::EyeAtCamera);
        assert_eq!(
            parse("name First officer").unwrap(),
            Command::Name("First officer".into())
        );
        assert_eq!(
            parse("key First-Officer").unwrap(),
            Command::Key("first_officer".into())
        );
        assert_eq!(
            parse("seat Pilot").unwrap(),
            Command::Select("pilot".into()),
            "a key typed in another case names the seat that has it, not a second one"
        );
        assert_eq!(parse("radius default").unwrap(), Command::Radius(None));
        assert!(parse("radius 0").is_err());
        assert!(parse("knees 1").unwrap_err().contains("2 numbers"));
        let mut s = existing();
        set(&mut s, Part::Hip, &[0.0, 0.01, -0.02], true);
        assert!((s.hip[1] - 0.13).abs() < 1e-6 && (s.hip[2] - -0.07).abs() < 1e-6);
    }
}
