//! Traffic's routine in our WASM module, `Traffic`, on a receiving machine: it draws every copy
//! of the traffic host's AI objects each frame, 1s behind the traffic host's reads
//! (record/areas/traffic-atc/01-traffic-and-atc.md, "`Traffic`, each frame").
//!
//! Each copy is frozen, so the sim moves it only where it's written, and a moving copy must be
//! written every frame: written at 20Hz into a sim at about 33 fps, FS Copilot's copies scored
//! 1.65 on its jitter measure, where 0 is constant motion, against 0.17 written on each frame
//! (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "Jitter measured, not eyeballed").
//! So `Traffic` writes inside the sim's frame, where the core's writes would each follow a
//! `Frame` event's round trip through the queue, the loop, and the edge.

// A panic in our module puts it in the sim's `DIRTY` state, and the sim stops running it, so
// one routine's bug would stop every routine (record/areas/architecture/02-code-map.md, "When
// the module stops"). So the commonest panics fail Clippy, as in the routine host.
#![cfg_attr(
    not(test),
    deny(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing
    )
)]

use std::collections::BTreeMap;

use messages::module::RoutineId;
use messages::traffic::TRAFFIC;
use messages::traffic::slots::{Entry, TrafficSlot};
use object_mirror::{Playout, Pose};
use routine_host::{Frame, Routine, VarRef, Wants};

/// How far behind the traffic host's reads `Traffic` draws each copy, in µs: the 500ms between
/// two polls and up to 500ms of lateness, near the 534ms that the worst 1% of one-off packets
/// came late through a far relay at 3% loss (record/areas/network/01-between-machines.md, "The
/// relays").
pub const DELAY: u64 = 1_000_000;

/// What `Traffic` writes on each copy, in the order `Drawn` holds them, with the units an entry
/// carries.
const WRITTEN: [(&str, &str); 12] = [
    ("A:PLANE LATITUDE", "degrees"),
    ("A:PLANE LONGITUDE", "degrees"),
    ("A:PLANE ALTITUDE", "feet"),
    ("A:PLANE PITCH DEGREES", "degrees"),
    ("A:PLANE BANK DEGREES", "degrees"),
    ("A:PLANE HEADING DEGREES TRUE", "degrees"),
    ("A:VELOCITY BODY X", "feet per second"),
    ("A:VELOCITY BODY Y", "feet per second"),
    ("A:VELOCITY BODY Z", "feet per second"),
    ("A:ROTATION VELOCITY BODY X", "radians per second"),
    ("A:ROTATION VELOCITY BODY Y", "radians per second"),
    ("A:ROTATION VELOCITY BODY Z", "radians per second"),
];

/// One copy's pose and velocities as `Traffic` writes them.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Drawn {
    values: [f64; 12],
}

impl Drawn {
    fn of(entry: &Entry) -> Drawn {
        let [vx, vy, vz] = entry.velocity.map(f64::from);
        let [rx, ry, rz] = entry.rotation.map(f64::from);
        Drawn {
            values: [
                entry.lat,
                entry.lon,
                entry.alt,
                f64::from(entry.pitch),
                f64::from(entry.bank),
                f64::from(entry.heading),
                vx,
                vy,
                vz,
                rx,
                ry,
                rz,
            ],
        }
    }
}

impl Pose for Drawn {
    /// The position along the line between the two, each angle the short way round, and the
    /// newer sample's velocities, which feed only the copy's animations and sounds, as FS
    /// Copilot wrote them (read in the FS Copilot fork,
    /// `FsCopilot/Simulation/TrafficInterpolator.cs`, `TryRender`).
    fn between(&self, next: &Drawn, share: f64) -> Drawn {
        let mut values = next.values;
        for (i, (to, (a, b))) in values
            .iter_mut()
            .zip(self.values.iter().zip(next.values))
            .enumerate()
            .take(6)
        {
            let delta = if i >= 3 {
                (b - a + 540.0).rem_euclid(360.0) - 180.0
            } else {
                b - a
            };
            *to = a + delta * share;
        }
        // A turn across north carries the heading past 0 or 360.
        if let Some(heading) = values.get_mut(5) {
            *heading = heading.rem_euclid(360.0);
        }
        Drawn { values }
    }
}

#[derive(Default)]
pub struct Traffic {
    playout: Playout<Drawn>,
    /// The host's places for what it writes, named at its first frame.
    names: Option<[VarRef; 12]>,
    /// What each copy was last written, so a frame writes only the values that changed.
    written: BTreeMap<u32, [f64; 12]>,
}

impl Routine for Traffic {
    const ID: RoutineId = TRAFFIC;
    type Slot = TrafficSlot;
    type Report = ();

    fn on_slot(&mut self, slot: &TrafficSlot) {
        let count = (slot.count as usize).min(slot.entries.len());
        for entry in slot.entries.iter().take(count) {
            if entry.removed != 0 {
                self.playout.remove(entry.object);
                self.written.remove(&entry.object);
            } else {
                self.playout.push(entry.object, entry.at, Drawn::of(entry));
            }
        }
    }

    fn frame(&mut self, frame: &Frame, want: &mut Wants) {
        if self.names.is_none() {
            self.names = names(want);
        }
        let Some(names) = self.names else {
            return;
        };
        // Each write crosses into the sim, so a frame writes only the values that changed. A
        // frozen copy holds its pose and its written velocities, which its animations and sounds
        // read: a copy on the ground mostly moves and turns, its velocities change at the samples
        // alone, and a parked copy costs no writes at all. In the sim, with about 105 copies, 4
        // of them moving, `Traffic` took about 85µs a frame writing every value and about 60µs
        // writing only what changed, where the same frames took under 5µs natively
        // (record/areas/traffic-atc/log.md, 2026-11-15).
        let written = &mut self.written;
        self.playout
            .each(frame.now.saturating_sub(DELAY), |object, drawn| {
                let last = written.entry(object).or_insert([f64::NAN; 12]);
                for ((var, value), was) in names.into_iter().zip(drawn.values).zip(last.iter_mut())
                {
                    if *was != value {
                        want.write(object, var, value);
                        *was = value;
                    }
                }
            });
    }
}

fn names(want: &mut Wants) -> Option<[VarRef; 12]> {
    let mut names = [VarRef(0); 12];
    for (r, (name, unit)) in names.iter_mut().zip(WRITTEN) {
        *r = want.var(name, unit)?;
    }
    Some(names)
}

#[cfg(test)]
mod tests;
