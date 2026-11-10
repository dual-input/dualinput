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
}

impl Aircraft {
    fn key(&self, object: u32, space: Space, ids: Ids) -> Option<(u32, String)> {
        let (own, name) = self.ids.get(&ids.var)?;
        let object = match space {
            Space::A => object,
            Space::L => 0,
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
        let key = self.key(object, space, ids)?;
        self.values.get(&key).copied()
    }

    fn set(&mut self, object: u32, space: Space, ids: Ids, value: f64) {
        if let Some(key) = self.key(object, space, ids) {
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
