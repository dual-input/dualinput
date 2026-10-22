// A test may panic and index freely, which the crate's lints forbid the routines.
#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

use std::cell::RefCell;

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
    const ID: RoutineId = RoutineId("NOTE");
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

#[derive(Default)]
struct Aircraft {
    on: [bool; 3],
    sets: Vec<(Flag, bool)>,
}

impl Sim for Aircraft {
    fn frozen(&mut self, flag: Flag) -> bool {
        self.on[flag as usize]
    }

    fn set_frozen(&mut self, flag: Flag, on: bool) {
        self.on[flag as usize] = on;
        self.sets.push((flag, on));
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

const NOTE: RoutineId = RoutineId("NOTE");

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
        sets: Vec::new(),
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
