// A test may panic and index freely, which the crate's lints forbid the routines.
#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

//! Flight-model sync's cases, on a clock the test steps and samples it feeds
//! (record/areas/flight-model/01-flight-model-sync.md, "Cases for the bench").

use std::collections::BTreeMap;

use messages::flight_model::slots::{FollowSlot, LeadSlot};
use messages::flight_model::{FOLLOW, LEAD, PERIOD, Sample, Snapshot};
use messages::module::RoutineId;
use messages::module::slots::SlotHeader;
use routine_host::{Flag, Host, Ids, Key, Named, Sim, Space, routines};

use crate::pose::{Offset, moved};
use crate::{Follow, Lead};

const HASH: u64 = 7;
const DELAY: u64 = 400_000;
/// 150 kt, in feet per second.
const SPEED: f64 = 253.2;
const FT: f64 = 0.3048;
/// One of `run`'s frames, in µs, 89 a second.
const FRAME: u64 = 11_236;
/// What the aircraft moves in one of `run`'s frames at 150 kt, in meters.
const FRAME_M: f64 = SPEED * FT * FRAME as f64 / 1e6;

/// The sim: the pilot's aircraft's variables by name, its freezes, and the events sent.
#[derive(Default)]
struct World {
    values: BTreeMap<String, f64>,
    names: Vec<String>,
    frozen: [bool; 3],
    keys: Vec<(Key, i32)>,
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
            unit: 0,
        })
    }
    fn get(&mut self, _: u32, _: Space, ids: Ids) -> Option<f64> {
        self.values.get(&self.names[ids.var as usize]).copied()
    }
    fn set(&mut self, _: u32, _: Space, ids: Ids, value: f64) {
        self.values
            .insert(self.names[ids.var as usize].clone(), value);
    }
    fn reset(&mut self) -> bool {
        false
    }
    fn fire_h(&mut self, _: &str) {}
    fn call_preset(&mut self, _: &str, _: Option<f64>) {}
    fn key(&mut self, key: Key, value: i32) {
        self.keys.push((key, value));
    }

    fn camera(&mut self, _: u32) -> Option<messages::module::slots::CameraRead> {
        None
    }
}

impl World {
    /// Puts the aircraft at `s`, moving over the ground at `velocity`, east, up, and north.
    fn place(&mut self, s: &Snapshot, velocity: [f64; 3]) {
        let values = [
            ("PLANE LATITUDE", s.lat),
            ("PLANE LONGITUDE", s.lon),
            ("PLANE ALTITUDE", s.alt),
            ("PLANE PITCH DEGREES", f64::from(s.pitch)),
            ("PLANE BANK DEGREES", f64::from(s.bank)),
            ("PLANE HEADING DEGREES TRUE", f64::from(s.heading)),
            ("VELOCITY BODY X", f64::from(s.velocity[0])),
            ("VELOCITY BODY Y", f64::from(s.velocity[1])),
            ("VELOCITY BODY Z", f64::from(s.velocity[2])),
            ("ROTATION VELOCITY BODY X", f64::from(s.rotation[0])),
            ("ROTATION VELOCITY BODY Y", f64::from(s.rotation[1])),
            ("ROTATION VELOCITY BODY Z", f64::from(s.rotation[2])),
            ("AILERON POSITION", f64::from(s.surfaces[0])),
            ("ELEVATOR POSITION", f64::from(s.surfaces[1])),
            ("RUDDER POSITION", f64::from(s.surfaces[2])),
            ("BRAKE LEFT POSITION", f64::from(s.brakes[0])),
            ("BRAKE RIGHT POSITION", f64::from(s.brakes[1])),
            ("VELOCITY WORLD X", velocity[0]),
            ("VELOCITY WORLD Y", velocity[1]),
            ("VELOCITY WORLD Z", velocity[2]),
        ];
        for (name, value) in values {
            self.values.insert(name.to_string(), value);
        }
    }

    /// Where the aircraft is, as a snapshot's position.
    fn at(&self) -> Snapshot {
        Snapshot {
            lat: self.values["PLANE LATITUDE"],
            lon: self.values["PLANE LONGITUDE"],
            alt: self.values["PLANE ALTITUDE"],
            ..Snapshot::default()
        }
    }
}

/// How far apart two positions are, in meters.
fn apart(a: &Snapshot, b: &Snapshot) -> f64 {
    Offset::from(a, b).meters(a.lat)
}

/// The flying aircraft at `t`, in µs: heading east at 150 kt from a point over Switzerland,
/// with its yoke a little left and its left brake half on.
fn flying(t: u64) -> Snapshot {
    let start = Snapshot {
        lat: 47f64.to_radians(),
        lon: 8f64.to_radians(),
        alt: 5_000.0,
        heading: std::f32::consts::FRAC_PI_2,
        velocity: [0.0, 0.0, SPEED as f32],
        surfaces: [-4_000, 1_000, 0],
        brakes: [16_384, 0],
        ..Snapshot::default()
    };
    moved(&start, [SPEED, 0.0, 0.0], t as f64 / 1e6)
}

/// A following machine: the host with `Follow`, on a clock the test steps. The module's clock
/// is the core's counter here, so a frame's time is the clock.
struct Following {
    host: Host,
    world: World,
    feeds: u32,
    /// The stamp of the last sample fed.
    fed: u64,
    /// The last feed's body, and when the slot was last written, for the core's rewrites.
    body: Vec<u8>,
    written: u64,
}

impl Following {
    fn new() -> Following {
        Following {
            host: Host::new(routines![Follow], HASH, "0.1.0"),
            world: World::default(),
            feeds: 0,
            fed: 0,
            body: Vec::new(),
            written: 0,
        }
    }

    fn write(&mut self, routine: RoutineId, body: &[u8], clock: u64) {
        self.feeds += 1;
        self.body = body.to_vec();
        self.rewrite(routine, clock);
    }

    /// Writes the slot as it stands, as the core does at each feed and again every 200ms.
    fn rewrite(&mut self, routine: RoutineId, clock: u64) {
        let header = SlotHeader {
            feeds: self.feeds,
            end: 0,
            slots_hash: HASH,
            counter: clock,
        };
        let mut bytes = bytemuck::bytes_of(&header).to_vec();
        bytes.extend_from_slice(&self.body);
        self.host.written(routine, &bytes, clock);
        self.written = clock;
    }

    /// The feed that starts `Follow`, with no sample.
    fn start(&mut self, clock: u64) {
        let slot = FollowSlot {
            delay: DELAY,
            ..FollowSlot::default()
        };
        self.fed = clock.saturating_sub(1);
        self.write(FOLLOW, bytemuck::bytes_of(&slot), clock);
    }

    fn feed(&mut self, sample: Sample, clock: u64) {
        let slot = FollowSlot {
            delay: DELAY,
            has_sample: 1,
            sample,
        };
        self.fed = sample.at;
        self.write(FOLLOW, bytemuck::bytes_of(&slot), clock);
    }

    /// Runs frames from `from` until `to`, 89 a second, feeding the sample `sample` gives for
    /// each 50ms mark, if it gives one. A sample arrives the moment it was read, as over a
    /// path with no delay. Returns the aircraft's position after each frame, with the
    /// frame's time.
    fn run(
        &mut self,
        from: u64,
        to: u64,
        sample: impl Fn(u64) -> Option<Snapshot>,
    ) -> Vec<(u64, Snapshot)> {
        let mut out = Vec::new();
        let mut clock = from;
        while clock < to {
            let mark = clock / PERIOD * PERIOD;
            let due = (mark > self.fed).then(|| sample(mark)).flatten();
            if let Some(snapshot) = due {
                self.feed(Sample { at: mark, snapshot }, clock);
            } else if clock - self.written >= 200_000 {
                self.rewrite(FOLLOW, clock);
            }
            self.host.frame(clock, &mut self.world);
            if self.world.values.contains_key("PLANE LATITUDE") {
                out.push((clock, self.world.at()));
            }
            clock += FRAME;
        }
        out
    }
}

/// The largest step between two frames, in meters, and the smallest.
fn steps(path: &[(u64, Snapshot)]) -> (f64, f64) {
    let steps: Vec<f64> = path.windows(2).map(|w| apart(&w[0].1, &w[1].1)).collect();
    (
        steps.iter().copied().fold(0.0, f64::max),
        steps.iter().copied().fold(f64::MAX, f64::min),
    )
}

/// The position at the first frame at or after `clock`.
fn place_at(path: &[(u64, Snapshot)], clock: u64) -> Snapshot {
    path.iter().find(|(c, _)| *c >= clock).unwrap().1
}

fn lead_slot(counter: u64) -> Vec<u8> {
    let header = SlotHeader {
        feeds: 1,
        end: 0,
        slots_hash: HASH,
        counter,
    };
    let mut bytes = bytemuck::bytes_of(&header).to_vec();
    bytes.extend_from_slice(bytemuck::bytes_of(&LeadSlot {}));
    bytes
}

#[test]
fn lead_reports_20_times_a_second_at_30_fps_and_at_89_fps() {
    for fps in [30u64, 89] {
        let mut host = Host::new(routines![Lead], HASH, "0.1.0");
        let mut world = World::default();
        world.place(&flying(0), [SPEED, 0.0, 0.0]);
        let mut reports = Vec::new();
        for frame in 0..fps * 10 {
            let clock = frame * 1_000_000 / fps;
            // The core writes the slot again every 200ms, which keeps the routine running.
            if frame % (fps / 5) == 0 {
                host.written(LEAD, &lead_slot(clock), clock);
            }
            host.frame(clock, &mut world);
            for (routine, report) in host.reports() {
                assert_eq!(routine, LEAD);
                let sample: Sample = bytemuck::pod_read_unaligned(&report);
                assert_eq!(sample.at, clock, "stamped with its frame's time");
                assert_eq!(sample.snapshot.surfaces, [-4_000, 1_000, 0]);
                reports.push(sample.at);
            }
        }
        assert!(
            (199..=201).contains(&reports.len()),
            "{} reports in 10s at {fps} fps",
            reports.len()
        );
    }
}

#[test]
fn lead_reports_nothing_while_the_sim_cant_read_the_pose() {
    let mut host = Host::new(routines![Lead], HASH, "0.1.0");
    let mut world = World::default();
    host.written(LEAD, &lead_slot(0), 0);
    host.frame(1_000, &mut world);
    assert_eq!(host.reports().count(), 0);
}

#[test]
fn follow_draws_the_aircraft_400ms_behind_the_samples_and_sends_the_controls() {
    let mut f = Following::new();
    f.start(0);
    let path = f.run(0, 3_000_000, |mark| Some(flying(mark)));
    assert!(f.world.frozen.iter().all(|&on| on), "frozen in every frame");
    for (clock, at) in path.iter().filter(|(clock, _)| *clock > 1_000_000) {
        let off = apart(at, &flying(clock - DELAY));
        assert!(off < 0.01, "{off}m off the path at {clock}");
    }
    assert_eq!(f.world.values["VELOCITY BODY Z"] as f32, SPEED as f32);
    // Each surface negated, and each brake less 16,384.
    assert_eq!(
        f.world.keys[f.world.keys.len() - 5..],
        [
            (Key::AxisAilerons, 4_000),
            (Key::AxisElevator, -1_000),
            (Key::AxisRudder, 0),
            (Key::AxisLeftBrake, 0),
            (Key::AxisRightBrake, -16_384),
        ]
    );
}

#[test]
fn one_lost_sample_is_neither_carried_nor_eased() {
    let mut f = Following::new();
    f.start(0);
    let path = f.run(0, 4_000_000, |mark| {
        (mark != 2_000_000).then(|| flying(mark))
    });
    for (clock, at) in path.iter().filter(|(clock, _)| *clock > 1_000_000) {
        assert!(apart(at, &flying(clock - DELAY)) < 0.01);
    }
}

#[test]
fn the_2s_move_to_the_relay_is_carried_then_eased_back_without_a_jump() {
    let mut f = Following::new();
    f.start(0);
    // Samples stop for 2s, as when a dead direct path gives way to the relay.
    let path = f.run(0, 9_000_000, |mark| {
        (!(2_000_000..4_000_000).contains(&mark)).then(|| flying(mark))
    });
    let after: Vec<_> = path
        .iter()
        .filter(|(c, _)| *c > 1_000_000)
        .copied()
        .collect();
    // On a straight path, the line through the last two samples is the path itself.
    for (clock, at) in &after {
        let off = apart(at, &flying(clock - DELAY));
        assert!(off < 0.05, "{off}m off at {clock}");
    }
    let (most, least) = steps(&after);
    assert!(
        most < FRAME_M * 1.2 && least > FRAME_M * 0.8,
        "{least} to {most}"
    );
}

#[test]
fn a_20s_gap_is_carried_2s_then_held_frozen_and_written_at_once_when_samples_return() {
    let mut f = Following::new();
    f.start(0);
    let path = f.run(0, 25_000_000, |mark| {
        (!(2_000_000..22_000_000).contains(&mark)).then(|| flying(mark))
    });
    assert!(f.world.frozen.iter().all(|&on| on));
    // The newest sample before the gap is 1.95s's, drawn at 2.35s, so the carry ends at 4.35s.
    let carried = apart(&flying(1_950_000), &place_at(&path, 4_400_000));
    assert!(
        (carried - SPEED * FT * 2.0).abs() < 1.0,
        "carried {carried}m"
    );
    assert!(
        apart(&place_at(&path, 4_400_000), &place_at(&path, 21_900_000)) < 0.001,
        "held"
    );
    // The first sample back is over 1.5km on, so the aircraft is written there at once.
    for (clock, at) in path.iter().filter(|(c, _)| *c > 22_020_000) {
        let off = apart(at, &flying(clock - DELAY));
        assert!(off < 0.01, "{off}m off at {clock}");
    }
}

#[test]
fn a_pf_in_the_pause_menu_has_the_aircraft_hold_and_never_carry() {
    let mut f = Following::new();
    f.start(0);
    f.run(0, 2_000_000, |mark| Some(flying(mark)));
    // The flying core sends the last sample again every 50ms, each stamped 50ms after the
    // one before.
    let last = flying(1_950_000);
    let path = f.run(2_000_000, 8_000_000, |_| Some(last));
    for (clock, at) in path.iter().filter(|(c, _)| *c > 2_400_000) {
        assert!(apart(at, &last) < 0.001, "moved at {clock}");
    }
    // The flying aircraft goes on from where it paused, and the first report after the
    // pause is taken: the following aircraft moves on from where it held, with no jump.
    let resumed = |mark: u64| Some(flying(mark - 6_000_000));
    let after = f.run(8_000_000, 10_000_000, resumed);
    let (most, _) = steps(&after);
    assert!(most < FRAME_M * 1.05, "a step of {most}m");
    let (clock, at) = after.last().unwrap();
    assert!(apart(at, &flying(clock - DELAY - 6_000_000)) < 0.01);
}

#[test]
fn a_joiner_whose_pf_is_50km_away_is_written_at_once_and_one_10m_away_eases_over_3s() {
    // On a runway 50km west of the flying aircraft, standing still.
    let mut far = Following::new();
    let runway = moved(&flying(0), [-164_042.0, 0.0, 0.0], 1.0);
    far.world.place(&runway, [0.0; 3]);
    far.start(0);
    let path = far.run(0, 2_000_000, |mark| Some(flying(mark)));
    let first = path
        .iter()
        .position(|(_, at)| apart(at, &runway) > 1.0)
        .unwrap();
    let (clock, at) = path[first];
    assert!(
        apart(&at, &flying(clock - DELAY)) < 0.01,
        "at the drawn pose, in one frame"
    );
    assert!(
        (400_000..470_000).contains(&clock),
        "once a sample is 400ms old: {clock}"
    );

    // At the pilot flying's stand, 10m east of where the pilot flying's aircraft stands.
    let stand = Snapshot {
        velocity: [0.0; 3],
        ..flying(0)
    };
    let mut near = Following::new();
    near.world
        .place(&moved(&stand, [10.0 / FT, 0.0, 0.0], 1.0), [0.0; 3]);
    near.start(0);
    let path = near.run(0, 5_000_000, |_| Some(stand));
    let off = |clock: u64| apart(&place_at(&path, clock), &stand);
    assert!((off(300_000) - 10.0).abs() < 0.01, "still where it loaded");
    assert!(
        (off(1_950_000) - 5.0).abs() < 0.3,
        "halfway: {}",
        off(1_950_000)
    );
    assert!(off(3_600_000) < 0.01, "at the PF's stand after 3s");
    let (most, _) = steps(&path);
    assert!(most < 0.05, "a step of {most}m");
}

#[test]
fn at_a_handover_the_ex_pfs_aircraft_flies_on_eases_back_and_never_stops_or_jumps() {
    // The former pilot flying's aircraft has flown itself to where the flying aircraft is at
    // 5s, while the new pilot flying's, which followed it, is 400ms behind.
    let behind = |t: u64| flying(t - DELAY);
    let mut f = Following::new();
    f.world.place(&flying(5_000_000), [SPEED, 0.0, 0.0]);
    f.start(5_000_000);
    let path = f.run(5_000_000, 10_000_000, |mark| Some(behind(mark)));
    // It flies on for 0.4s at the speed it flew.
    let off = apart(&place_at(&path, 5_390_000), &flying(5_390_000));
    assert!(off < 1.0, "{off}m off its own way on");
    // Then it eases about 62m back over 3s, at about three-quarters of its speed.
    let (most, least) = steps(&path);
    assert!(most < FRAME_M * 1.05, "a step of {most}m");
    assert!(least > FRAME_M * 0.6, "a step of only {least}m");
    for (clock, at) in path.iter().filter(|(c, _)| *c > 8_500_000) {
        let back = apart(at, &behind(clock - DELAY));
        assert!(back < 0.05, "{back}m off the samples after the ease");
    }
    assert!(
        f.world.keys.len() < path.len() * 5,
        "its own controls for the first 0.4s"
    );
}

#[test]
fn at_a_simulation_rate_of_2_the_ex_pfs_aircraft_carries_on_at_the_speed_it_flew() {
    let mut f = Following::new();
    f.world.place(&flying(0), [SPEED, 0.0, 0.0]);
    f.world.values.insert("SIMULATION RATE".into(), 2.0);
    f.start(0);
    let path = f.run(0, 300_000, |_| None);
    let (clock, at) = path.last().unwrap();
    let expected = SPEED * FT * 2.0 * *clock as f64 / 1e6;
    let moved = apart(&flying(0), at);
    assert!((moved - expected).abs() < 0.05, "{moved}m, not {expected}m");
}

#[test]
fn before_its_first_sample_follow_carries_its_own_motion_2s_then_holds() {
    let mut f = Following::new();
    f.world.place(&flying(0), [SPEED, 0.0, 0.0]);
    f.start(0);
    let path = f.run(0, 5_000_000, |_| None);
    let end = path.last().unwrap().1;
    let carried = apart(&flying(0), &end);
    assert!(
        (carried - SPEED * FT * 2.0).abs() < 0.05,
        "carried {carried}m"
    );
    assert!(f.world.frozen.iter().all(|&on| on));
    assert!(f.world.keys.is_empty(), "its controls stay its pilot's");
}

#[test]
fn a_sample_out_of_order_is_left_out() {
    let mut f = Following::new();
    f.start(0);
    f.run(0, 1_000_000, |mark| Some(flying(mark)));
    let before = f.world.at();
    f.feed(
        Sample {
            at: 100_000,
            snapshot: moved(&flying(0), [0.0, 0.0, 1e6], 1.0),
        },
        1_000_000,
    );
    f.fed = 950_000;
    let path = f.run(1_000_000, 1_500_000, |mark| Some(flying(mark)));
    assert!(apart(&before, &path[0].1) < 2.0 * FRAME_M);
}

/// The bench's relay holds a cut core's packets back and hands them over together, so the
/// samples of a gap arrive at once, each older than the frame's time less the delay.
#[test]
fn samples_that_waited_out_a_gap_and_arrive_together_are_eased_onto_with_no_jump() {
    let mut f = Following::new();
    f.start(0);
    f.run(0, 2_000_000, |mark| Some(flying(mark)));
    // 3.5s with no sample: carried 2s, then held.
    let mut path = f.run(2_000_000, 5_500_000, |_| None);
    // Then the samples of the gap's first 2s, one after another between two frames, and
    // live ones after them, with nothing for the 1.5s between.
    let mut clock = 5_500_000;
    for mark in (2_000_000..4_000_000).step_by(PERIOD as usize) {
        f.feed(
            Sample {
                at: mark,
                snapshot: flying(mark),
            },
            clock,
        );
        if mark % 250_000 == 0 {
            f.host.frame(clock, &mut f.world);
            path.push((clock, f.world.at()));
            clock += FRAME;
        }
    }
    f.fed = clock;
    path.extend(f.run(clock, 10_000_000, |mark| Some(flying(mark))));
    let (most, _) = steps(&path);
    assert!(most < FRAME_M * 1.6, "a step of {most}m");
    for (clock, at) in path.iter().filter(|(c, _)| *c > 9_500_000) {
        let off = apart(at, &flying(clock - DELAY));
        assert!(off < 0.05, "{off}m off at {clock}");
    }
}

/// More samples than `Follow` keeps, all ahead of the frame's time less the delay, as when
/// the two cores' counters disagree: the aircraft stays where it was, and never goes back to
/// where `Follow` started.
#[test]
fn samples_all_ahead_of_the_frames_time_hold_the_aircraft_where_it_was() {
    let mut f = Following::new();
    f.world.place(&flying(0), [0.0; 3]);
    f.start(0);
    f.run(0, 2_000_000, |mark| Some(flying(mark)));
    let before = f.world.at();
    for n in 0..80u64 {
        let at = 60_000_000 + n * PERIOD;
        f.feed(
            Sample {
                at,
                snapshot: flying(at),
            },
            2_000_000,
        );
    }
    f.fed = u64::MAX;
    let path = f.run(2_000_000, 3_000_000, |_| None);
    let (most, _) = steps(&path);
    assert!(most < FRAME_M * 1.6, "a step of {most}m");
    let moved = apart(&before, &path.last().unwrap().1);
    assert!(moved < 160.0, "it moved {moved}m, back toward its start");
}
