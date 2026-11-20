// A test may panic and index freely, which the crate's lints forbid the routine.
#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

//! `Traffic`'s cases, on a clock the test steps and feeds it makes
//! (record/areas/traffic-atc/01-traffic-and-atc.md, "Cases for the bench").

use std::collections::BTreeMap;

use messages::module::slots::SlotHeader;
use messages::traffic::TRAFFIC;
use messages::traffic::slots::{Entry, TrafficSlot};
use routine_host::{Flag, Host, Ids, Key, Named, Sim, Space, routines};

use crate::{DELAY, Traffic};

const HASH: u64 = 7;

/// The sim: each object's variables by name.
#[derive(Default)]
struct World {
    names: Vec<String>,
    objects: BTreeMap<u32, BTreeMap<String, f64>>,
    writes: usize,
}

impl Sim for World {
    fn frozen(&mut self, _: Flag) -> bool {
        false
    }
    fn set_frozen(&mut self, _: Flag, _: bool) {}
    fn look_up(&mut self, _: u32, named: &Named) -> Option<Ids> {
        self.names.push(named.name.clone());
        Some(Ids {
            var: self.names.len() as i32 - 1,
            unit: 0,
        })
    }
    fn get(&mut self, object: u32, _: Space, ids: Ids) -> Option<f64> {
        self.objects
            .get(&object)?
            .get(&self.names[ids.var as usize])
            .copied()
    }
    fn set(&mut self, object: u32, _: Space, ids: Ids, value: f64) {
        self.writes += 1;
        let name = self.names[ids.var as usize].clone();
        self.objects.entry(object).or_default().insert(name, value);
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

/// A receiving machine's module with `Traffic`, on a clock the test steps, which is the core's
/// counter here.
struct Receiving {
    host: Host,
    world: World,
    feeds: u32,
    /// The last feed's slot, which the core writes again until the next.
    slot: TrafficSlot,
}

impl Receiving {
    fn new() -> Receiving {
        Receiving {
            host: Host::new(routines![Traffic], HASH, "0.1.0"),
            world: World::default(),
            feeds: 0,
            slot: TrafficSlot::default(),
        }
    }

    /// Feeds `entries`, as the core writes the slot at `now`.
    fn feed(&mut self, now: u64, entries: &[Entry]) {
        self.feeds += 1;
        self.slot = TrafficSlot::default();
        self.slot.count = entries.len() as u32;
        self.slot.entries[..entries.len()].copy_from_slice(entries);
        self.write(now);
    }

    fn write(&mut self, now: u64) {
        let header = SlotHeader {
            feeds: self.feeds,
            end: 0,
            slots_hash: HASH,
            counter: now,
        };
        let mut bytes = bytemuck::bytes_of(&header).to_vec();
        bytes.extend_from_slice(bytemuck::bytes_of(&self.slot));
        self.host.written(TRAFFIC, &bytes, now);
    }

    /// One frame at `now`, after the core's rewrite of the last feed, which keeps the routine
    /// running.
    fn frame(&mut self, now: u64) {
        self.write(now);
        self.host.frame(now, &mut self.world);
    }

    fn latitude(&self, object: u32) -> Option<f64> {
        self.world
            .objects
            .get(&object)?
            .get("PLANE LATITUDE")
            .copied()
    }
}

/// A copy at `at` µs, `lat` degrees north, heading `heading`.
fn entry(object: u32, at: u64, lat: f64, heading: f32) -> Entry {
    Entry {
        object,
        at,
        lat,
        lon: 8.0,
        alt: 400.0,
        heading,
        velocity: [0.0, 0.0, 30.0],
        ..Entry::default()
    }
}

/// Traffic and ATC's case: two feeds within one module frame, and `Traffic` takes both.
#[test]
fn two_feeds_within_one_module_frame_are_both_taken() {
    let mut m = Receiving::new();
    m.feed(0, &[entry(0x100, 0, 47.0, 90.0)]);
    m.feed(10, &[entry(0x101, 0, 48.0, 90.0)]);
    m.frame(DELAY);
    assert_eq!(m.latitude(0x100), Some(47.0));
    assert_eq!(m.latitude(0x101), Some(48.0));
}

#[test]
fn a_copy_is_drawn_1s_behind_turning_the_short_way_and_a_removed_one_is_forgotten() {
    let mut m = Receiving::new();
    // Its heading turns across north from 350° to 10° between two samples 500ms apart.
    m.feed(
        0,
        &[
            entry(0x100, 0, 47.0, 350.0),
            entry(0x100, 500_000, 47.001, 10.0),
        ],
    );
    m.frame(DELAY + 250_000);
    let copy = &m.world.objects[&0x100];
    assert!((copy["PLANE LATITUDE"] - 47.0005).abs() < 1e-9);
    assert!(
        (copy["PLANE HEADING DEGREES TRUE"] - 0.0).abs() < 1e-6,
        "{}",
        copy["PLANE HEADING DEGREES TRUE"]
    );
    assert_eq!(copy["VELOCITY BODY Z"], 30.0);

    // A parked copy isn't written again.
    m.frame(DELAY + 5_000_000);
    let writes = m.world.writes;
    m.frame(DELAY + 6_000_000);
    assert_eq!(m.world.writes, writes, "a parked copy costs no writes");

    // Removed, it isn't drawn, even when a later feed's sample would have moved it.
    m.feed(
        7_000_000,
        &[Entry {
            object: 0x100,
            removed: 1,
            ..Entry::default()
        }],
    );
    m.world.objects.clear();
    m.frame(DELAY + 7_000_000);
    assert_eq!(m.latitude(0x100), None);
}

/// A copy taxiing straight north writes all 12 values at its first frame, and from then only its
/// latitude, the one value that changes, since each write crosses into the sim.
#[test]
fn a_copy_writes_only_the_values_that_changed() {
    let mut m = Receiving::new();
    m.feed(
        0,
        &[
            entry(0x100, 0, 47.0, 0.0),
            entry(0x100, 500_000, 47.001, 0.0),
            entry(0x100, 1_000_000, 47.002, 0.0),
        ],
    );
    m.frame(DELAY + 100_000);
    assert_eq!(m.world.writes, 12, "the first frame writes every value");
    for step in 2..=8u64 {
        let writes = m.world.writes;
        m.frame(DELAY + step * 100_000);
        assert_eq!(
            m.world.writes - writes,
            1,
            "frame {step} writes the latitude alone"
        );
    }
}

/// `Traffic`'s budget's frame, natively: 25 copies, each moving every frame. The module's own
/// time is measured in the sim with the update-timer patch, so this prints a reference alone:
///   cargo test -p traffic-routines --release -- --ignored --nocapture moving_copies
#[test]
#[ignore = "a timing, measured by hand in a release build"]
// A test runs off the core's loop, so it may read the clock, which the root's clippy.toml
// forbids only the loop.
#[allow(clippy::disallowed_methods)]
fn moving_copies_frame_time() {
    let mut m = Receiving::new();
    let mut now = 0;
    let mut times = Vec::new();
    for frame in 0..20_000u64 {
        now = frame * 11_236;
        if frame % 45 == 0 {
            let entries: Vec<Entry> = (0..25)
                .map(|i| {
                    entry(
                        0x100 + i,
                        now,
                        47.0 + now as f64 * 1e-9 + f64::from(i) * 1e-3,
                        90.0,
                    )
                })
                .collect();
            m.feed(now, &entries);
        }
        let started = std::time::Instant::now();
        m.frame(now);
        times.push(started.elapsed().as_nanos());
    }
    times.sort_unstable();
    let p99 = times[times.len() * 99 / 100];
    println!(
        "25 moving copies: a frame took {p99}ns at p99, natively, over {} frames to {now}µs",
        times.len()
    );
}

/// The mix of traffic's first session in the sim, natively: 4 copies moving, and 101 parked,
/// each fed a heartbeat every 5s, which in the sim added about 85µs to our module's update at
/// p50 while every value was written each frame (record/areas/traffic-atc/log.md, "In the sim,
/// copies drew at 0.16 on FS Copilot's jitter measure"):
///   cargo test -p traffic-routines --release -- --ignored --nocapture parked_copies
#[test]
#[ignore = "a timing, measured by hand in a release build"]
#[allow(clippy::disallowed_methods)]
fn parked_copies_frame_time() {
    let mut m = Receiving::new();
    let mut times = Vec::new();
    for frame in 0..20_000u64 {
        let now = frame * 11_236;
        if frame % 45 == 0 {
            let moving = (0..4).map(|i| {
                entry(
                    0x100 + i,
                    now,
                    47.0 + now as f64 * 1e-9 + f64::from(i) * 1e-3,
                    90.0,
                )
            });
            let parked = (0..101)
                .filter(|_| frame % 450 == 0)
                .map(|i| entry(0x200 + i, now, 48.0 + f64::from(i) * 1e-3, 270.0));
            // A slot holds 100 entries, so the core feeds more in slots of 100, which one frame takes.
            let all: Vec<Entry> = moving.chain(parked).collect();
            for chunk in all.chunks(100) {
                m.feed(now, chunk);
            }
        }
        let started = std::time::Instant::now();
        m.frame(now);
        times.push(started.elapsed().as_nanos());
    }
    times.sort_unstable();
    let (p50, p99) = (times[times.len() / 2], times[times.len() * 99 / 100]);
    println!(
        "4 moving and 101 parked copies: a frame took {p50}ns at p50 and {p99}ns at p99, natively, over {} frames",
        times.len()
    );
}
