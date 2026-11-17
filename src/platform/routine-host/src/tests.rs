// A test may panic and index freely, which the crate's lints forbid the routines.
#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

use std::cell::RefCell;
use std::collections::BTreeMap;

use bytemuck::{Pod, Zeroable};
use messages::module::RoutineId;
use messages::module::slots::SlotHeader;

use super::*;

const HASH: u64 = 0xABCD;

thread_local! {
    /// What the test routine heard, since a routine lives inside the host.
    static HEARD: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

fn heard() -> Vec<String> {
    HEARD.with(|h| h.borrow_mut().drain(..).collect())
}

#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
struct NoteSlot {
    n: u32,
}

/// Hears each feed's number, adds it to what it remembers, and asks for the freeze while
/// it remembers 2, so a test sees what a routine carried from its last feeding.
#[derive(Default)]
struct Note {
    seen: Vec<u32>,
}

impl Routine for Note {
    const ID: RoutineId = NOTE;
    type Slot = NoteSlot;
    type Report = ();

    fn on_slot(&mut self, slot: &NoteSlot) {
        self.seen.push(slot.n);
        HEARD.with(|h| {
            h.borrow_mut()
                .push(format!("slot {} after {:?}", slot.n, self.seen))
        });
    }

    fn frame(&mut self, frame: &Frame, want: &mut Wants) {
        HEARD.with(|h| h.borrow_mut().push(format!("frame at {}", frame.now)));
        if self.seen.contains(&2) {
            want.freeze();
        }
    }
}

/// The sim, with variables by name on each object and the IDs it hands out for them, which
/// count on from a reset, so an ID from before one names nothing.
#[derive(Default)]
struct Aircraft {
    on: [bool; 3],
    sets: Vec<(Flag, bool)>,
    /// Each object's variables, by the object, 0 for an `L:` one, and the name.
    values: BTreeMap<(u32, String), f64>,
    /// Each ID handed out since the last reset: a `Z:` variable's object, and the name.
    ids: BTreeMap<i32, (Option<u32>, String)>,
    next_id: i32,
    reset: bool,
    lookups: u32,
    /// Each `H:` event and preset made, in order.
    fired: Vec<String>,
    /// Whether the sim gives a camera, which it holds at the aircraft's `PLANE LATITUDE`,
    /// along x, so a test sees which pose a read of it saw.
    camera: bool,
}

impl Aircraft {
    fn place(&self, object: u32, space: Space, ids: Ids) -> Option<(u32, String)> {
        let (own, name) = self.ids.get(&ids.var)?;
        let object = match space {
            Space::A => object,
            Space::E | Space::L => 0,
            Space::Z => (*own)?,
        };
        Some((object, name.clone()))
    }
}

impl Sim for Aircraft {
    fn frozen(&mut self, flag: Flag) -> bool {
        self.on[flag as usize]
    }

    fn set_frozen(&mut self, flag: Flag, on: bool) {
        self.on[flag as usize] = on;
        self.sets.push((flag, on));
    }

    fn look_up(&mut self, object: u32, named: &Named) -> Option<Ids> {
        self.lookups += 1;
        let own = (named.space == Space::Z).then_some(object);
        self.next_id += 1;
        self.ids.insert(self.next_id, (own, named.name.clone()));
        Some(Ids {
            var: self.next_id,
            unit: 0,
        })
    }

    fn get(&mut self, object: u32, space: Space, ids: Ids) -> Option<f64> {
        let key = self.place(object, space, ids)?;
        self.values.get(&key).copied()
    }

    fn set(&mut self, object: u32, space: Space, ids: Ids, value: f64) {
        if let Some(key) = self.place(object, space, ids) {
            self.values.insert(key, value);
        }
    }

    fn reset(&mut self) -> bool {
        std::mem::take(&mut self.reset)
    }

    fn fire_h(&mut self, name: &str) {
        self.fired.push(format!("H {name}"));
    }

    fn call_preset(&mut self, name: &str, value: Option<f64>) {
        self.fired.push(format!("B {name} {value:?}"));
    }

    fn key(&mut self, key: Key, value: i32) {
        self.fired.push(format!("K {} {value}", key.name()));
    }

    fn camera(&mut self, referential: u32) -> Option<CameraRead> {
        let latitude = self.values.get(&(USER, "PLANE LATITUDE".to_string()));
        self.camera.then(|| CameraRead {
            position: [latitude.copied().unwrap_or(0.0), 0.0, 0.0],
            referential,
            ..CameraRead::default()
        })
    }
}

/// Moves the aircraft one degree of latitude a frame, as `Follow` writes the pose.
#[derive(Default)]
struct Mover {
    frames: u32,
}

const MOVER: RoutineId = RoutineId {
    name: "MOVER",
    freezes: false,
};

impl Routine for Mover {
    const ID: RoutineId = MOVER;
    type Slot = NoteSlot;
    type Report = ();

    fn on_slot(&mut self, _: &NoteSlot) {}

    fn frame(&mut self, _: &Frame, want: &mut Wants) {
        self.frames += 1;
        if let Some(latitude) = want.var("A:PLANE LATITUDE", "degrees") {
            want.write(USER, latitude, f64::from(self.frames));
        }
    }
}

/// `Camera`'s slot written with no struct after its header, since `CameraSlot` holds nothing.
fn camera_feed() -> Vec<u8> {
    bytemuck::bytes_of(&SlotHeader {
        feeds: 1,
        end: 0,
        slots_hash: HASH,
        counter: 0,
    })
    .to_vec()
}

fn camera_reports(host: &mut Host) -> Vec<messages::module::slots::CameraReport> {
    host.reports()
        .filter(|(id, _)| *id == messages::module::CAMERA)
        .map(|(_, bytes)| bytemuck::pod_read_unaligned(&bytes))
        .collect()
}

#[test]
fn a_camera_read_sees_none_of_the_frames_writes() {
    let mut host = Host::new(routines![Mover, Camera], HASH, "");
    let mut sim = Aircraft {
        camera: true,
        ..Aircraft::default()
    };
    host.written(MOVER, &write(1, 0, HASH, 0, 1), 0);
    host.written(messages::module::CAMERA, &camera_feed(), 0);
    let mut seen = Vec::new();
    for at in 0..3 {
        host.frame(at, &mut sim);
        seen.extend(
            camera_reports(&mut host)
                .iter()
                .map(|r| r.simobject.position[0]),
        );
    }
    // `Mover` runs first and writes each frame's latitude, and the camera still reads the
    // latitude the frame began with.
    assert_eq!(seen, [0.0, 1.0, 2.0]);
}

#[test]
fn camera_reports_both_referentials_each_frame_and_nothing_in_a_frame_with_no_camera() {
    let mut host = Host::new(routines![Camera], HASH, "");
    let mut sim = Aircraft {
        camera: true,
        ..Aircraft::default()
    };
    host.written(messages::module::CAMERA, &camera_feed(), 0);
    host.frame(0, &mut sim);
    let reports = camera_reports(&mut host);
    assert_eq!(reports.len(), 1);
    assert_eq!(
        (
            reports[0].simobject.referential,
            reports[0].world.referential
        ),
        (
            messages::module::REFERENTIAL_SIMOBJECT,
            messages::module::REFERENTIAL_WORLD
        )
    );
    sim.camera = false;
    host.frame(1, &mut sim);
    assert!(
        camera_reports(&mut host).is_empty(),
        "a frame with no camera reports nothing"
    );
}

/// Asks for an `H:` event and a preset, in that order, once each feed.
#[derive(Default)]
struct Fires {
    due: bool,
}

const FIRES: RoutineId = RoutineId {
    name: "FIRES",
    freezes: false,
};

impl Routine for Fires {
    const ID: RoutineId = FIRES;
    const FEED_ONCE: bool = true;
    type Slot = NoteSlot;
    type Report = ();

    fn on_slot(&mut self, _: &NoteSlot) {
        self.due = true;
    }

    fn frame(&mut self, _: &Frame, want: &mut Wants) {
        if std::mem::take(&mut self.due) {
            want.fire_h("FUEL");
            want.call_preset("ELECTRICAL_Battery_1_Toggle", None);
            want.call_preset("INSTRUMENT_HEADING_BUG_Set", Some(180.0));
        }
    }
}

#[test]
fn h_events_and_presets_go_after_the_frames_in_the_order_asked() {
    let mut host = Host::new(vec![kind::<Fires>()], HASH, "");
    let mut sim = Aircraft::default();
    let mut bytes = bytemuck::bytes_of(&SlotHeader {
        feeds: 1,
        end: 0,
        slots_hash: HASH,
        counter: 0,
    })
    .to_vec();
    bytes.extend_from_slice(bytemuck::bytes_of(&NoteSlot { n: 1 }));
    host.written(FIRES, &bytes, 0);
    host.frame(0, &mut sim);
    assert_eq!(
        sim.fired,
        [
            "H FUEL",
            "B ELECTRICAL_Battery_1_Toggle None",
            "B INSTRUMENT_HEADING_BUG_Set Some(180.0)"
        ]
    );
    host.frame(1, &mut sim);
    assert_eq!(sim.fired.len(), 3, "each fires once, not each frame");
}

#[test]
fn a_routine_whose_feed_goes_once_starts_again_after_a_gap_without_it() {
    let mut host = Host::new(vec![kind::<Fires>()], HASH, "");
    let mut sim = Aircraft::default();
    host.written(FIRES, &write(1, 0, HASH, 0, 1), 0);
    host.frame(0, &mut sim);
    assert_eq!(sim.fired.len(), 3);
    host.frame(1_100_000, &mut sim);
    host.written(FIRES, &write(1, 0, HASH, 1_200_000, 1), 1_200_000);
    host.frame(1_200_001, &mut sim);
    assert_eq!(
        sim.fired.len(),
        3,
        "the rewrite after the gap fired nothing again"
    );
    host.written(FIRES, &write(2, 0, HASH, 1_400_000, 2), 1_400_000);
    host.frame(1_400_001, &mut sim);
    assert_eq!(sim.fired.len(), 6, "the next feed fires");
}

#[test]
fn a_routine_left_unfed_starts_again_on_the_same_feed() {
    let mut host = host();
    let mut sim = Aircraft::default();
    host.written(NOTE, &write(1, 0, HASH, 0, 2), 0);
    host.frame(1_100_000, &mut sim);
    host.written(NOTE, &write(1, 0, HASH, 1_200_000, 2), 1_200_000);
    heard();
    host.frame(1_200_001, &mut sim);
    assert!(
        sim.on[0],
        "the restarted routine holds the freeze its feed asks for"
    );
    heard();
}

#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
struct CopySlot {
    object: u32,
}

/// Reads `A:PLANE LATITUDE` of the pilot's aircraft each frame and writes it, doubled, into
/// `Z:COPY` on the object its feed names, with a `L:` name asked for twice.
#[derive(Default)]
struct Double {
    object: u32,
}

const COPY: RoutineId = RoutineId {
    name: "COPY",
    freezes: false,
};

impl Routine for Double {
    const ID: RoutineId = COPY;
    type Slot = CopySlot;
    type Report = ();

    fn on_slot(&mut self, slot: &CopySlot) {
        self.object = slot.object;
    }

    fn frame(&mut self, _: &Frame, want: &mut Wants) {
        let latitude = want.var("A:PLANE LATITUDE", "degrees").unwrap();
        let copy = want.var("Z:COPY", "number").unwrap();
        let shared = want.var("L:SHARED", "number").unwrap();
        assert_eq!(want.var("L:SHARED", "number"), Some(shared));
        assert_eq!(
            want.var("SHARED", "number"),
            None,
            "a name needs its prefix"
        );
        let value = want.read(USER, latitude);
        want.write(self.object, copy, value.unwrap_or(0.0) * 2.0);
        // A write lands after every routine's frame, so this frame reads what was there.
        let copied = want.read(self.object, copy);
        HEARD.with(|h| h.borrow_mut().push(format!("read {copied:?}")));
    }
}

fn write(feeds: u32, end: u32, hash: u64, counter: u64, n: u32) -> Vec<u8> {
    let header = SlotHeader {
        feeds,
        end,
        slots_hash: hash,
        counter,
    };
    let mut bytes = bytemuck::bytes_of(&header).to_vec();
    bytes.extend_from_slice(bytemuck::bytes_of(&NoteSlot { n }));
    bytes
}

fn host() -> Host {
    Host::new(routines![Note, Hold], HASH, "0.1.0")
}

const NOTE: RoutineId = RoutineId {
    name: "NOTE",
    freezes: true,
};

#[test]
fn each_slot_has_the_header_and_its_struct() {
    assert_eq!(
        host().slots(),
        [(NOTE, 24 + 4), (messages::module::HOLD, 24)]
    );
}

#[test]
fn a_rewrite_of_the_same_feed_is_no_new_feed() {
    let mut host = host();
    let mut sim = Aircraft::default();
    host.written(NOTE, &write(1, 0, HASH, 5_000_000, 1), 1_000);
    host.written(NOTE, &write(1, 0, HASH, 5_200_000, 1), 201_000);
    host.written(NOTE, &write(2, 0, HASH, 5_400_000, 2), 401_000);
    host.frame(402_000, &mut sim);
    assert_eq!(
        heard(),
        [
            "slot 1 after [1]",
            "slot 2 after [1, 2]",
            "frame at 5401000"
        ]
    );
}

#[test]
fn a_routine_fed_again_after_its_end_starts_new() {
    let mut host = host();
    let mut sim = Aircraft::default();
    host.written(NOTE, &write(1, 0, HASH, 0, 2), 0);
    host.frame(1_000, &mut sim);
    assert!(
        sim.on.iter().all(|&on| on),
        "the routine asked for the freeze"
    );
    host.written(NOTE, &write(1, 1, HASH, 0, 0), 2_000);
    host.frame(3_000, &mut sim);
    assert!(
        sim.on.iter().all(|&on| !on),
        "an ended routine asks for nothing"
    );
    host.written(NOTE, &write(2, 0, HASH, 0, 3), 4_000);
    host.frame(5_000, &mut sim);
    heard();
    assert!(
        sim.on.iter().all(|&on| !on),
        "nothing remembered from before its end"
    );
}

#[test]
fn a_routine_left_unfed_for_1s_stops() {
    let mut host = host();
    let mut sim = Aircraft::default();
    host.written(NOTE, &write(1, 0, HASH, 0, 2), 0);
    host.frame(1_000_000, &mut sim);
    assert!(sim.on[0]);
    host.frame(1_000_001, &mut sim);
    assert!(!sim.on[0], "the freeze lifts once the routine is unfed");
    heard();
}

#[test]
fn a_feed_from_another_build_runs_nothing() {
    let mut host = host();
    let mut sim = Aircraft::default();
    host.written(NOTE, &write(1, 0, HASH + 1, 0, 2), 0);
    host.frame(1_000, &mut sim);
    assert_eq!(heard(), Vec::<String>::new());
    assert!(sim.sets.is_empty());
}

#[test]
fn the_host_releases_only_the_flags_it_set() {
    let mut host = host();
    let mut sim = Aircraft {
        on: [false, true, false],
        ..Aircraft::default()
    };
    host.written(messages::module::HOLD, &write(1, 0, HASH, 0, 0)[..24], 0);
    host.frame(1_000, &mut sim);
    host.frame(2_000, &mut sim);
    host.written(
        messages::module::HOLD,
        &write(1, 1, HASH, 0, 0)[..24],
        3_000,
    );
    host.frame(4_000, &mut sim);
    assert_eq!(
        sim.sets,
        [
            (Flag::LatitudeLongitude, true),
            (Flag::Attitude, true),
            (Flag::LatitudeLongitude, false),
            (Flag::Attitude, false),
        ]
    );
    assert_eq!(
        sim.on,
        [false, true, false],
        "the altitude freeze was someone else's"
    );
}

#[test]
fn a_host_that_stops_releases_the_freeze_it_set() {
    let mut host = host();
    let mut sim = Aircraft::default();
    host.written(messages::module::HOLD, &write(1, 0, HASH, 0, 0)[..24], 0);
    host.frame(1_000, &mut sim);
    assert!(sim.on.iter().all(|&on| on));
    host.release(&mut sim);
    assert!(sim.on.iter().all(|&on| !on));
}

#[test]
fn the_estimate_of_the_cores_counter_takes_the_largest_offset() {
    let mut host = host();
    let mut sim = Aircraft::default();
    host.written(NOTE, &write(1, 0, HASH, 10_000_000, 1), 1_000_000);
    host.written(NOTE, &write(1, 0, HASH, 10_200_100, 1), 1_200_000);
    host.frame(1_300_000, &mut sim);
    let heard = heard();
    assert_eq!(heard.last().unwrap(), "frame at 10300100");
}

#[test]
fn a_routine_reads_now_and_writes_after_every_frame_on_the_object_it_names() {
    let mut host = Host::new(routines![Double], HASH, "0.1.0");
    let mut sim = Aircraft::default();
    sim.values.insert((USER, "PLANE LATITUDE".into()), 21.5);
    let header = SlotHeader {
        feeds: 1,
        end: 0,
        slots_hash: HASH,
        counter: 0,
    };
    let mut bytes = bytemuck::bytes_of(&header).to_vec();
    bytes.extend_from_slice(bytemuck::bytes_of(&CopySlot { object: 0x0101 }));
    host.written(COPY, &bytes, 0);
    host.frame(1_000, &mut sim);
    host.frame(2_000, &mut sim);
    assert_eq!(heard(), ["read None", "read Some(43.0)"]);
    assert_eq!(sim.values.get(&(0x0101, "COPY".into())), Some(&43.0));
    assert_eq!(sim.lookups, 2, "each ID looked up once, on its first read");
}

/// 03's case: after a `RESET`, `Figure`'s `Z:` writes still land
/// (record/areas/core/03-sim-seam-and-wasm-module.md, "Cases for the bench").
#[test]
fn after_a_reset_the_host_looks_each_id_up_again_and_its_writes_land() {
    let mut host = Host::new(routines![Double], HASH, "0.1.0");
    let mut sim = Aircraft::default();
    sim.values.insert((USER, "PLANE LATITUDE".into()), 1.0);
    let header = SlotHeader {
        feeds: 1,
        end: 0,
        slots_hash: HASH,
        counter: 0,
    };
    let mut bytes = bytemuck::bytes_of(&header).to_vec();
    bytes.extend_from_slice(bytemuck::bytes_of(&CopySlot { object: 7 }));
    host.written(COPY, &bytes, 0);
    host.frame(1_000, &mut sim);
    sim.ids.clear();
    sim.reset = true;
    sim.values.insert((USER, "PLANE LATITUDE".into()), 5.0);
    host.frame(2_000, &mut sim);
    heard();
    assert_eq!(sim.values.get(&(7, "COPY".into())), Some(&10.0));
    assert_eq!(sim.lookups, 4);
}

#[test]
fn the_status_goes_out_at_the_first_frame_then_once_a_second() {
    let mut host = host();
    let mut sim = Aircraft::default();
    let counters: Vec<Option<u64>> = [0, 500_000, 1_000_000, 1_500_000, 2_100_000]
        .into_iter()
        .map(|clock| host.frame(clock, &mut sim).map(|s| s.counter))
        .collect();
    assert_eq!(counters, [Some(0), None, Some(1), None, Some(2)]);
    let status = host.frame(3_200_000, &mut sim).unwrap();
    assert_eq!(
        (status.slots_hash, status.version()),
        (HASH, "0.1.0".into())
    );
}

#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
struct Reading {
    rate: f64,
}

/// Reads `E:SIMULATION RATE` each frame, reports it, and sends two axis events, the second
/// with a negative value.
#[derive(Default)]
struct Reporter;

const REPORTER: RoutineId = RoutineId {
    name: "REPORTER",
    freezes: false,
};

impl Routine for Reporter {
    const ID: RoutineId = REPORTER;
    type Slot = NoteSlot;
    type Report = Reading;

    fn on_slot(&mut self, _: &NoteSlot) {}

    fn frame(&mut self, _: &Frame, want: &mut Wants) {
        let rate = want.var("E:SIMULATION RATE", "number").unwrap();
        let reading = Reading {
            rate: want.read(USER, rate).unwrap_or(0.0),
        };
        want.report(&reading);
        // A report of another size than the routine's own is dropped.
        want.report(&0u8);
        want.key(Key::AxisAilerons, 8_000);
        want.key(Key::AxisElevator, -16_383);
    }
}

#[test]
fn only_a_routine_that_reports_gets_a_report_slot() {
    let host = Host::new(routines![Note, Reporter, Hold], HASH, "");
    assert_eq!(host.report_slots(), [(REPORTER, 8)]);
}

#[test]
fn a_report_and_events_with_values_go_out_once_every_frame_has_run() {
    let mut host = Host::new(routines![Reporter, Fires], HASH, "");
    let mut sim = Aircraft::default();
    sim.values.insert((0, "SIMULATION RATE".into()), 2.0);
    host.written(REPORTER, &write(1, 0, HASH, 0, 0), 0);
    host.written(FIRES, &write(1, 0, HASH, 0, 0), 0);
    host.frame(1_000, &mut sim);
    let reports: Vec<_> = host.reports().collect();
    assert_eq!(
        reports,
        [(REPORTER, bytemuck::bytes_of(&2.0f64).to_vec())],
        "the E: variable's value, reported once"
    );
    assert_eq!(
        sim.fired[..2],
        ["K AXIS_AILERONS_SET 8000", "K AXIS_ELEVATOR_SET -16383"],
        "the events go before the H: events and presets"
    );
    host.frame(2_000, &mut sim);
    host.frame(3_000, &mut sim);
    assert_eq!(
        host.reports().count(),
        1,
        "a report the edge didn't take goes with the next frame"
    );
}

/// Flight-model sync's case: with the module's clock 12s behind the core's counter, and write
/// delays drawn from the round trips of 2026-10-09's flight, 10.2ms at least, 16.6ms at the
/// median, 22.1ms at the 95th percentile, and 44.6ms at most, the host's offset settles
/// within 2ms of where it ends, 10s after its first header, keeps it through a flight load
/// with no header, and holds through a 2-hour run
/// (record/areas/flight-model/01-flight-model-sync.md, "Cases for the bench" and "Budgets").
#[test]
fn the_offset_settles_within_2ms_in_10s_and_holds_for_2_hours() {
    const BEHIND: u64 = 12_000_000;
    // A delay in µs from a number in 0..1, along the round trips' percentiles.
    fn delay(u: f64) -> u64 {
        let points = [
            (0.0, 10_200.0),
            (0.5, 16_600.0),
            (0.95, 22_100.0),
            (1.0, 44_600.0),
        ];
        let at = points.windows(2).find(|w| u <= w[1].0).unwrap();
        let share = (u - at[0].0) / (at[1].0 - at[0].0);
        (at[0].1 + share * (at[1].1 - at[0].1)) as u64
    }
    let mut seed = 0x2026_1009u64;
    let mut draw = || {
        seed = seed
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (seed >> 11) as f64 / (1u64 << 53) as f64
    };
    let mut host = host();
    let mut sim = Aircraft::default();
    // The core's counter at a frame, as the host estimates it, less the true one.
    let mut error_at = |host: &mut Host, core: u64| {
        heard();
        host.frame(core - BEHIND, &mut sim);
        let frame = heard().pop().unwrap();
        let now: i64 = frame.strip_prefix("frame at ").unwrap().parse().unwrap();
        now - core as i64
    };
    // The core writes the slot again every 200ms, and each write reaches the module late.
    let first = 20_000_000;
    let mut write_at = |host: &mut Host, core: u64| {
        let read = core + delay(draw());
        host.written(NOTE, &write(1, 0, HASH, core, 1), read - BEHIND);
    };
    for n in 0..50 {
        write_at(&mut host, first + n * 200_000);
    }
    let settled = error_at(&mut host, first + 10_000_000);
    assert!(settled <= 0, "the estimate never passes the core's counter");
    // A flight load: 90s with no header, through which the offset stays.
    let after_load = first + 100_000_000;
    host.written(
        NOTE,
        &write(1, 0, HASH, after_load, 1),
        after_load + 20_000 - BEHIND,
    );
    assert_eq!(error_at(&mut host, after_load + 100_000), settled);
    for n in 0..36_000 {
        write_at(&mut host, after_load + 200_000 + n * 200_000);
    }
    let end = error_at(&mut host, after_load + 7_200_000_000 + 400_000);
    assert!(end <= 0 && end >= settled);
    assert!(
        end - settled <= 2_000,
        "10s in, the offset was {}µs from where it ended",
        end - settled
    );
}

/// Says where it put the pilot's aircraft, in the frames after a feed numbered 1.
#[derive(Default)]
struct Places {
    on: bool,
}

const PLACES: RoutineId = RoutineId {
    name: "PLACES",
    freezes: false,
};

impl Routine for Places {
    const ID: RoutineId = PLACES;
    type Slot = NoteSlot;
    type Report = ();

    fn on_slot(&mut self, slot: &NoteSlot) {
        self.on = slot.n == 1;
    }

    fn frame(&mut self, _: &Frame, want: &mut Wants) {
        if self.on {
            want.place(Pose {
                latitude: 0.82,
                ..Pose::default()
            });
        }
    }
}

/// Hears where a routine before it put the pilot's aircraft, each frame.
#[derive(Default)]
struct Asks;

const ASKS: RoutineId = RoutineId {
    name: "ASKS",
    freezes: false,
};

impl Routine for Asks {
    const ID: RoutineId = ASKS;
    type Slot = NoteSlot;
    type Report = ();

    fn on_slot(&mut self, _: &NoteSlot) {}

    fn frame(&mut self, _: &Frame, want: &mut Wants) {
        let placed = want.placed().map(|p| p.latitude);
        HEARD.with(|h| h.borrow_mut().push(format!("placed {placed:?}")));
    }
}

#[test]
fn a_pose_one_routine_places_reaches_the_routines_after_it_for_that_frame_alone() {
    let mut sim = Aircraft::default();
    let mut host = Host::new(routines![Places, Asks], HASH, "0.1.0");
    host.written(PLACES, &write(1, 0, HASH, 0, 1), 0);
    host.written(ASKS, &write(1, 0, HASH, 0, 1), 0);
    host.frame(1_000, &mut sim);
    host.written(PLACES, &write(2, 0, HASH, 2_000, 2), 2_000);
    host.frame(3_000, &mut sim);
    assert_eq!(heard(), ["placed Some(0.82)", "placed None"]);

    // A routine before the one that places hears nothing of it.
    let mut host = Host::new(routines![Asks, Places], HASH, "0.1.0");
    host.written(PLACES, &write(1, 0, HASH, 0, 1), 0);
    host.written(ASKS, &write(1, 0, HASH, 0, 1), 0);
    host.frame(1_000, &mut sim);
    host.frame(2_000, &mut sim);
    assert_eq!(heard(), ["placed None", "placed None"]);
}
