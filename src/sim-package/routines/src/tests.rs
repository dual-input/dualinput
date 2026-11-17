// A test may panic and index freely, which the crate's lints forbid the list.
#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

//! The routines together, as our WASM module runs them: what one writes in a frame, the next
//! one in the list reads.

use std::collections::BTreeMap;

use messages::avatars::FIGURE;
use messages::avatars::slots::{BODY_SEATED, FigureSlot, SHOWS_ALL};
use messages::flight_model::slots::FollowSlot;
use messages::flight_model::{FOLLOW, PERIOD, Sample, Snapshot};
use messages::module::RoutineId;
use messages::module::slots::SlotHeader;
use routine_host::{Flag, Host, Ids, Key, Named, Sim, Space, USER};

const HASH: u64 = 7;
const OBJECT: u32 = 0x100;
const DELAY: u64 = 400_000;
/// 130 m/s, about 250 kt, in feet per second.
const SPEED: f64 = 426.5;
/// A degree of latitude, in meters, near enough to read a figure's place against its
/// aircraft's.
const DEGREE_M: f64 = 111_195.0;
/// The times between frames, in µs, about 60 a second and as uneven as the sim's.
const FRAMES: [u64; 5] = [14_000, 19_000, 16_000, 22_000, 12_000];

/// The sim: each variable by its object and name, an angle in degrees whatever unit a routine
/// names it in, and the pilot's aircraft's freezes. A frozen aircraft stays where it's written.
#[derive(Default)]
struct World {
    values: BTreeMap<(u32, String), f64>,
    names: Vec<String>,
    frozen: [bool; 3],
}

impl Sim for World {
    fn frozen(&mut self, flag: Flag) -> bool {
        self.frozen[flag as usize]
    }
    fn set_frozen(&mut self, flag: Flag, on: bool) {
        self.frozen[flag as usize] = on;
    }
    fn look_up(&mut self, _: u32, named: &Named) -> Option<Ids> {
        self.names.push(named.name.clone());
        Some(Ids {
            var: self.names.len() as i32 - 1,
            unit: i32::from(named.unit == "radians"),
        })
    }
    fn get(&mut self, object: u32, _: Space, ids: Ids) -> Option<f64> {
        let name = self.names.get(ids.var as usize)?;
        let value = *self.values.get(&(object, name.clone())).unwrap_or(&0.0);
        Some(if ids.unit == 1 {
            value.to_radians()
        } else {
            value
        })
    }
    fn set(&mut self, object: u32, _: Space, ids: Ids, value: f64) {
        let name = self.names[ids.var as usize].clone();
        let value = if ids.unit == 1 {
            value.to_degrees()
        } else {
            value
        };
        self.values.insert((object, name), value);
    }
    fn reset(&mut self) -> bool {
        false
    }
    fn fire_h(&mut self, _: &str) {}
    fn call_preset(&mut self, _: &str, _: Option<f64>) {}
    fn key(&mut self, _: Key, _: i32) {}

    fn camera(&mut self, _: u32) -> Option<messages::module::slots::CameraRead> {
        None
    }
}

impl World {
    fn value(&self, object: u32, name: &str) -> f64 {
        self.values[&(object, name.to_string())]
    }

    /// How far `object` is from the pilot's aircraft, in meters along the aircraft's track and
    /// to its right.
    fn ahead_and_right(&self, object: u32) -> [f64; 2] {
        let latitude = self.value(USER, "PLANE LATITUDE");
        let north = (self.value(object, "PLANE LATITUDE") - latitude) * DEGREE_M;
        let east = (self.value(object, "PLANE LONGITUDE") - self.value(USER, "PLANE LONGITUDE"))
            * DEGREE_M
            * latitude.to_radians().cos();
        let (sin, cos) = HEADING.to_radians().sin_cos();
        [north * cos + east * sin, east * cos - north * sin]
    }
}

/// The flying aircraft's heading, in degrees true, which the sim gives as 3.49 radians and
/// `Follow` writes as -2.79, and its pitch and bank as the sim has them, 5° nose up and 15°
/// to the left.
const HEADING: f64 = 200.0;
const PITCH: f64 = -5.0;
const BANK: f64 = 15.0;

/// The flying aircraft at `t`, in µs: on a track of 200° at 130 m/s from 47°N 8°E.
fn flying(t: u64) -> Snapshot {
    let along = SPEED * 0.3048 * t as f64 / 1e6;
    let (sin, cos) = HEADING.to_radians().sin_cos();
    Snapshot {
        lat: (47.0 + along * cos / DEGREE_M).to_radians(),
        lon: (8.0 + along * sin / (DEGREE_M * 47f64.to_radians().cos())).to_radians(),
        alt: 5_000.0,
        pitch: PITCH.to_radians() as f32,
        bank: BANK.to_radians() as f32,
        heading: HEADING.to_radians() as f32,
        velocity: [0.0, 0.0, SPEED as f32],
        ..Snapshot::default()
    }
}

fn write(host: &mut Host, routine: RoutineId, feeds: u32, body: &[u8], clock: u64) {
    let header = SlotHeader {
        feeds,
        end: 0,
        slots_hash: HASH,
        counter: clock,
    };
    let mut bytes = bytemuck::bytes_of(&header).to_vec();
    bytes.extend_from_slice(body);
    host.written(routine, &bytes, clock);
}

fn seated() -> FigureSlot {
    let mut slot: FigureSlot = bytemuck::Zeroable::zeroed();
    slot.count = 1;
    let f = &mut slot.figures[0];
    f.object = OBJECT;
    f.color = 1;
    f.shows = SHOWS_ALL;
    f.hip = [0.31, 0.12, 1.4];
    f.knees = [0.05, 0.45];
    f.feet = [-0.42, 0.62];
    f.pose.body = BODY_SEATED;
    f.pose.eye = [0.31, 0.75, 1.35];
    f.pose.look = [0.0, 0.0, 1.0];
    slot
}

#[test]
fn a_figure_keeps_its_seat_in_an_aircraft_follow_writes() {
    let mut host = Host::new(crate::list(), HASH, "0.1.0");
    let mut world = World::default();
    let start = flying(0);
    let (sin, cos) = HEADING.to_radians().sin_cos();
    for (name, value) in [
        ("PLANE LATITUDE", start.lat.to_degrees()),
        ("PLANE LONGITUDE", start.lon.to_degrees()),
        ("PLANE ALTITUDE", start.alt),
        ("PLANE HEADING DEGREES TRUE", HEADING),
        ("PLANE PITCH DEGREES", PITCH),
        ("PLANE BANK DEGREES", BANK),
        ("VELOCITY BODY Z", SPEED),
        ("VELOCITY WORLD X", SPEED * sin),
        ("VELOCITY WORLD Z", SPEED * cos),
    ] {
        world.values.insert((USER, name.to_string()), value);
    }

    let figure = seated();
    let mut follow = FollowSlot {
        delay: DELAY,
        ..FollowSlot::default()
    };
    let (mut feeds, mut fed, mut written) = (1, 0, 0);
    write(&mut host, FIGURE, 1, bytemuck::bytes_of(&figure), 0);
    write(&mut host, FOLLOW, feeds, bytemuck::bytes_of(&follow), 0);

    // 8s of frames: the aircraft settles onto the samples' path, then the figure's place is
    // read against the aircraft's after each frame.
    let mut offsets = Vec::new();
    let mut clock = 1_000;
    for dt in FRAMES.iter().cycle() {
        if clock > 8_000_000 {
            break;
        }
        let mark = clock / PERIOD * PERIOD;
        if mark > fed {
            fed = mark;
            feeds += 1;
            follow.has_sample = 1;
            follow.sample = Sample {
                at: mark,
                snapshot: flying(mark),
            };
            write(&mut host, FOLLOW, feeds, bytemuck::bytes_of(&follow), clock);
        }
        if clock - written >= 200_000 {
            written = clock;
            write(&mut host, FIGURE, 1, bytemuck::bytes_of(&figure), clock);
        }
        host.frame(clock, &mut world);
        if clock > 5_000_000 {
            offsets.push(world.ahead_and_right(OBJECT));
        }
        clock += dt;
    }

    assert!(world.frozen.iter().all(|f| *f), "Follow froze the aircraft");
    let range = |axis: usize| {
        offsets.iter().fold((f64::MAX, f64::MIN), |(a, b), o| {
            (a.min(o[axis]), b.max(o[axis]))
        })
    };
    let (least, most) = range(0);
    assert!(
        most - least < 0.01,
        "the figure's hip moved {:.2}m along the aircraft over {} frames, from {least:.2}m ahead of the aircraft's reference point to {most:.2}m",
        most - least,
        offsets.len(),
    );
    assert!(
        (least - 1.4).abs() < 0.1,
        "the hip sits about 1.4m ahead of the reference point: {least:.2}m"
    );
    let (left, right) = range(1);
    assert!(
        right - left < 0.01,
        "the hip moved {:.2}m across the aircraft",
        right - left
    );

    // The figure faces ahead, so it takes the aircraft's attitude as `Follow` wrote it, a
    // heading of -160° for 200° among it.
    for (name, turns) in [
        ("PLANE HEADING DEGREES TRUE", 360.0),
        ("PLANE PITCH DEGREES", f64::MAX),
        ("PLANE BANK DEGREES", f64::MAX),
    ] {
        let apart = (world.value(OBJECT, name) - world.value(USER, name)).rem_euclid(turns);
        assert!(
            apart.min(turns - apart) < 0.01,
            "the figure's {name} is {}, and the aircraft's {}",
            world.value(OBJECT, name),
            world.value(USER, name)
        );
    }
    let written = world.value(USER, "PLANE PITCH DEGREES");
    assert!(
        (written - PITCH).abs() < 0.01,
        "the aircraft's pitch: {written}"
    );
}
