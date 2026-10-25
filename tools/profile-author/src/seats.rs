//! `seats`: each seat seeded, then drawn with our figure sitting in it while the author tunes
//! its hip, knees, feet, and eye, and written into the profile at each change
//! (record/areas/avatars/01-avatars.md, "The authoring tool").
//!
//! A seed comes from the profile's own seats, then from the seat objects SimConnect lists,
//! then from the cockpit model's `PILOT_` nodes, and the author's mark on a cushion moves the
//! seat selected or adds one.

use std::time::{Duration, Instant};

use aircraft_model::Vec3;
use messages::avatars::slots::{
    BODY_SEATED, FIGURES, FigureSlot, FigureState, HAND_REST, HandSlot, PoseSlot, SHOWS_ALL,
};
use messages::avatars::{FIGURE, PALETTE};
use messages::module::slots::SlotHeader;
use messages::module::{ModuleStatus, STATUS};
use profile_engine::features::avatars::Seat;
use sim_client::message::{Camera, Message};
use sim_client::{Area, InitPosition, Tag};

use crate::cockpit::{self, Cockpit};
use crate::profile::{self, Facts, ProfileFile};
use crate::ray;
use crate::screen::{self, Cursor, Key};
use crate::sim::{Event, Received};
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

/// The seats to start from: the profile's own, then one for each seat object, then one for
/// each `PILOT_` node, each seed skipped where a seat that applies to the loaded variant
/// already sits.
pub fn seeds(
    existing: &[Seat],
    variant: &str,
    objects: &[(String, Vec3)],
    nodes: &[(String, Vec3)],
) -> Vec<Seat> {
    let mut seats = existing.to_vec();
    let taken = |seats: &[Seat], at: Vec3| {
        seats
            .iter()
            .filter(|s| applies(s, variant))
            .any(|s| distance(ray::of(s.hip), at) < SAME_SEAT)
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
            hip: ray::of(seat.hip),
            knees: seat.knees.map(|v| v as f32),
            feet: seat.feet.map(|v| v as f32),
            facing: seat.facing as f32,
            pose: PoseSlot {
                body: BODY_SEATED,
                eye: ray::eye(seat),
                look: ray::facing(seat.facing),
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
        ["seat", key] => Ok(Command::Select(key.to_string())),
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
    let objects = seat_objects(&mut cockpit);
    let seats = seeds(&facts.seats, &variant, &objects, &nodes);
    for s in &seats {
        let from = if facts.seats.iter().any(|f| f.key == s.key) {
            "from the profile"
        } else if objects
            .iter()
            .any(|(_, at)| distance(*at, ray::of(s.hip)) < 1e-3)
        {
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
    session.create_figures();
    println!("{HELP}");
    session.show_selected();
    session.run()
}

/// The seat objects near the aircraft, each with its title and its place in the aircraft's
/// frame.
fn seat_objects(_cockpit: &mut Cockpit) -> Vec<(String, Vec3)> {
    println!(
        "seat objects: not listed, since the sim client has no SimConnect_RequestDataOnSimObjectType yet; seeding from PILOT_ nodes"
    );
    Vec::new()
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
            Received::Refused { call } => {
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
                seat.eye = ray::eye_at(seat, ray::of(camera.position));
                println!("  the eye went where the camera is");
            }
        }
        self.changed();
        self.show_selected();
    }

    fn command(&mut self, command: Command) -> Result<(), String> {
        if let Command::Select(key) = &command {
            if !self.seats.iter().any(|s| &s.key == key) {
                let key = snake(key);
                let mut seat = seat(key.clone(), key.clone(), [0.0; 3]);
                // A new seat starts at the selected seat's hip, until it's marked.
                if let Some(s) = self.selected_seat() {
                    seat.hip = s.hip;
                }
                self.seats.push(seat);
                self.selected = Some(key);
                self.changed();
                self.create_figures();
                println!(
                    "  added: press Page Down with the cursor on its cushion to place its hip"
                );
            } else {
                self.selected = Some(key.clone());
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
                if let Some(i) = self.figures.iter().position(|f| f.key == gone.key) {
                    let figure = self.figures.remove(i);
                    if let Some(object) = figure.object {
                        let op = self.cockpit.sim.client.remove(object);
                        self.cockpit.sim.make([op]);
                    }
                }
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

    /// Writes the profile and feeds `Figure` the change.
    fn changed(&mut self) {
        match self.write() {
            Ok(()) => self.gone.clear(),
            Err(e) => println!("  {e}"),
        }
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

    /// Creates a figure for each seat that applies to the loaded variant and has none, at the
    /// aircraft's place, where `Figure` moves it once it's fed.
    fn create_figures(&mut self) {
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
            .filter(|(s, _)| applies(s, &self.variant))
            .collect();
        if drawn.is_empty() {
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
    fn seeds_come_from_the_profile_then_seat_objects_then_pilot_nodes_each_once() {
        let objects = [
            ("SEAT_DEFAULT_Pilot".to_string(), [0.283, 0.13, -0.04]),
            ("SEAT_C152_Pax".to_string(), [-0.21, -0.13, 0.1]),
        ];
        let nodes = [
            ("PILOT_1".to_string(), [-0.282, 0.13, -0.05]),
            ("PILOT_2".to_string(), [-0.2, -0.12, 0.1]),
        ];
        let seats = seeds(&[existing()], "press", &objects, &nodes);
        let keys: Vec<&str> = seats.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(
            keys,
            ["pilot", "pax", "copilot"],
            "the pilot's seat object sits on the profile's pilot, and PILOT_2 on the Pax object"
        );
        assert_eq!(seats[1].name, "Pax");
        assert_eq!(seats[2].hip, [-0.282f32, 0.13, -0.05].map(f64::from));
        assert_eq!(
            (seats[2].knees, seats[2].feet, seats[2].eye),
            (KNEES, FEET, EYE)
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
    fn a_seat_for_another_variant_holds_no_seed_back() {
        let mut other = existing();
        other.only = vec!["base".into()];
        let objects = [("SEAT_DEFAULT_Pilot".to_string(), [0.283, 0.13, -0.04])];
        let seats = seeds(&[other], "press", &objects, &[]);
        assert_eq!(seats.len(), 2);
        assert_eq!(
            seats[1].key, "pilot_2",
            "the other variant's seat keeps its key"
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
        assert_eq!(parse("radius default").unwrap(), Command::Radius(None));
        assert!(parse("radius 0").is_err());
        assert!(parse("knees 1").unwrap_err().contains("2 numbers"));
        let mut s = existing();
        set(&mut s, Part::Hip, &[0.0, 0.01, -0.02], true);
        assert!((s.hip[1] - 0.13).abs() < 1e-6 && (s.hip[2] - -0.07).abs() < 1e-6);
    }
}
