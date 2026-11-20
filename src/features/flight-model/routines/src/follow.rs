//! `Follow`, on a following machine: it freezes the aircraft and draws it behind the flying
//! machine's samples (record/areas/flight-model/01-flight-model-sync.md, "The following
//! machine").
//!
//! Each frame it finds where the aircraft belongs at the frame's time less the delay:
//! between the two samples around that time; past the newest one, carried on along the line
//! through the last two for up to 2s, then held; or before any sample is old enough, moving
//! as the aircraft itself moved when `Follow` started. Where it belongs can step: when a
//! sample is old enough to draw from after a gap or at the start, and when samples that
//! waited out a gap arrive together, so a carry goes on from a newer one. At each step it
//! takes how far the aircraft is from where it belongs as a correction and eases that away
//! over 3s, so the aircraft never jumps, unless it's over 1km off, which it writes at once.

use std::collections::VecDeque;

use messages::flight_model::slots::FollowSlot;
use messages::flight_model::{FOLLOW, Sample, Snapshot};
use messages::module::RoutineId;
use routine_host::{Frame, Key, Routine, USER, VarRef, Wants};

use crate::pose::{Offset, between, carried, moved};
use crate::vars::Names;

/// How long `Follow` carries the aircraft on past its newest sample, or on its own motion
/// before its first, before it holds it where it is, in µs. In a standard-rate turn at 150 kt,
/// 2s of carrying strays about 8m from the path.
const CARRY: u64 = 2_000_000;

/// How long a correction takes to shrink to nothing, in µs.
const EASE: u64 = 3_000_000;

/// A correction over this many meters is written at once, since easing 1km in 3s would slide
/// the aircraft far faster than it flies.
const AT_ONCE_M: f64 = 1_000.0;

/// The most samples `Follow` keeps. At 20 a second, the delay's 400ms holds 8, so this many
/// only fill up when the core's counter and the samples' stamps disagree by seconds.
const KEPT: usize = 64;

/// The aircraft's own velocity over the ground and the simulation rate, which `Follow` reads
/// once, in its first frame.
const OWN_MOTION: [(&str, &str); 4] = [
    ("A:VELOCITY WORLD X", "feet per second"),
    ("A:VELOCITY WORLD Y", "feet per second"),
    ("A:VELOCITY WORLD Z", "feet per second"),
    ("E:SIMULATION RATE", "number"),
];

#[derive(Default)]
pub struct Follow {
    names: Option<Names>,
    /// How far behind the samples it draws, in µs, as each feed gives it.
    delay: u64,
    /// The samples, oldest first, each stamped on this core's counter.
    samples: VecDeque<Sample>,
    /// The aircraft as `Follow` found it, or `None` until a frame could read it.
    own: Option<Own>,
    /// What the last frame placed the aircraft by, and where, before any correction.
    placed: Option<(Placed, Snapshot)>,
    correction: Option<Correction>,
    /// What the last two frames wrote, and when, the newer one first.
    wrote: [Option<(u64, Snapshot)>; 2],
}

/// What a frame places the aircraft by.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Placed {
    /// Its own motion when `Follow` started, before any sample is old enough.
    Own,
    /// The two samples around the frame's time.
    Drawn,
    /// The line through the last two samples, past the newest, whose stamp this is.
    Carried { from: u64 },
    /// Where the last frame placed it, while every sample it holds is still ahead of the
    /// frame's time, as when more samples than it keeps arrive together.
    Held,
}

impl Placed {
    /// Whether the place can be a step away from the one the frame before had, placed by
    /// `before`. Time running past the newest sample goes on from where drawing left it, and
    /// its own motion and a hold go on from where they were.
    fn steps_from(self, before: Option<Placed>) -> bool {
        match (before, self) {
            (_, Placed::Own | Placed::Held) => false,
            (Some(Placed::Drawn), Placed::Drawn | Placed::Carried { .. }) => false,
            (Some(Placed::Carried { from: a }), Placed::Carried { from: b }) => a != b,
            _ => true,
        }
    }
}

/// The aircraft's own motion when `Follow` started.
struct Own {
    at: u64,
    snapshot: Snapshot,
    /// Its velocity over the ground, east, up, and north in feet per second, times the
    /// simulation rate, since a raised rate moves the aircraft that many times faster than
    /// its velocity, which is unverified.
    velocity: [f64; 3],
}

/// How far the aircraft was from where it belonged at a step, and when the step came.
struct Correction {
    offset: Offset,
    from: u64,
}

impl Routine for Follow {
    const ID: RoutineId = FOLLOW;
    type Slot = FollowSlot;
    type Report = ();

    fn on_slot(&mut self, slot: &FollowSlot) {
        self.delay = slot.delay;
        if slot.has_sample == 0 {
            return;
        }
        // The core feeds samples in the order of their stamps, and one out of order would
        // draw the aircraft backward.
        if self.samples.back().is_some_and(|s| s.at >= slot.sample.at) {
            return;
        }
        if self.samples.len() == KEPT {
            self.samples.pop_front();
        }
        self.samples.push_back(slot.sample);
    }

    fn frame(&mut self, frame: &Frame, want: &mut Wants) {
        // In every frame it runs, with a pose to write or not, so the aircraft stays frozen
        // before the first sample and through a gap.
        want.freeze();
        if self.names.is_none() {
            self.names = Names::new(want);
        }
        let Some(names) = &self.names else {
            return;
        };
        if self.own.is_none() {
            self.own = Own::read(names, frame.now, want);
        }
        let at = frame.now.saturating_sub(self.delay);
        // Drawing needs the newest sample at or before `at` and the ones after it, and a
        // carry needs the last two.
        while self.samples.len() > 2 && self.samples.get(1).is_some_and(|s| s.at <= at) {
            self.samples.pop_front();
        }
        let Some((placed, mut target)) = self.place(at, frame.now) else {
            return;
        };
        let step = placed.steps_from(self.placed.map(|(by, _)| by));
        if step {
            // The aircraft is where the last frames left it, moving as they moved it, and
            // the difference from where it belongs is what eases away.
            self.correction = self
                .expected(frame.now)
                .map(|was| Offset::from(&target, &was))
                .filter(|offset| offset.meters(target.lat) <= AT_ONCE_M)
                .map(|offset| Correction {
                    offset,
                    from: frame.now,
                });
        }
        // A step written at once is no motion to go on from, so the frame before it is
        // forgotten, and the next step measures from this frame alone.
        let at_once = step && self.correction.is_none();
        self.placed = Some((placed, target));
        // What's left of the correction shrinks along a straight line, so the aircraft
        // slides back at one speed.
        let left = self.correction.as_ref().map(|correction| {
            let since = frame.now.saturating_sub(correction.from);
            (1.0 - since as f64 / EASE as f64, correction.offset)
        });
        match left {
            Some((left, offset)) if left > 0.0 => target = offset.added(&target, left),
            _ => self.correction = None,
        }
        names.write(&target, want);
        // Until a sample places the aircraft, its controls stay its pilot's.
        if placed != Placed::Own {
            send_controls(&target, want);
        }
        let [newer, _] = self.wrote;
        self.wrote = [Some((frame.now, target)), newer.filter(|_| !at_once)];
    }
}

impl Follow {
    /// The aircraft between the two samples around `at`, or `None` when no two are.
    fn drawn(&self, at: u64) -> Option<Snapshot> {
        let mut before = self.samples.front()?;
        for after in self.samples.iter().skip(1) {
            if before.at <= at && at <= after.at {
                let share = (at - before.at) as f64 / (after.at - before.at) as f64;
                return Some(between(&before.snapshot, &after.snapshot, share));
            }
            before = after;
        }
        None
    }

    /// Where the aircraft belongs at `at`, and what places it there. Between two samples
    /// around `at`, it's drawn. Past the newest sample, it's carried on along the line through
    /// the last two for up to `CARRY`, then held, with the newest's attitude, velocities, and
    /// controls. Before any sample is old enough, it moves as it moved when `Follow` started,
    /// for up to `CARRY`.
    fn place(&self, at: u64, now: u64) -> Option<(Placed, Snapshot)> {
        if let Some(drawn) = self.drawn(at) {
            return Some((Placed::Drawn, drawn));
        }
        if let Some(newest) = self.samples.back().filter(|s| s.at < at) {
            let past = (at - newest.at).min(CARRY);
            let before = self.samples.iter().rev().nth(1);
            let snapshot = match before {
                Some(before) => {
                    let share = past as f64 / (newest.at - before.at) as f64;
                    carried(&before.snapshot, &newest.snapshot, share)
                }
                None => newest.snapshot,
            };
            return Some((Placed::Carried { from: newest.at }, snapshot));
        }
        // Samples have placed it before, and the ones it holds are all ahead of `at`, so it
        // stays where it was until one is old enough, rather than going back to its start.
        if let Some((by, last)) = self.placed
            && by != Placed::Own
        {
            return Some((Placed::Held, last));
        }
        let own = self.own.as_ref()?;
        let seconds = now.saturating_sub(own.at).min(CARRY) as f64 / 1e6;
        Some((Placed::Own, moved(&own.snapshot, own.velocity, seconds)))
    }

    /// Where the aircraft is at `now` if it goes on as the last two frames wrote it.
    fn expected(&self, now: u64) -> Option<Snapshot> {
        let [newer, older] = self.wrote;
        let (at, last) = newer?;
        let Some((before_at, before)) = older.filter(|(before_at, _)| *before_at < at) else {
            return Some(last);
        };
        let share = now.saturating_sub(at) as f64 / (at - before_at) as f64;
        Some(carried(&before, &last, share))
    }
}

impl Own {
    fn read(names: &Names, now: u64, want: &mut Wants) -> Option<Own> {
        let snapshot = names.read(want)?;
        let mut motion = [0.0; 4];
        for (value, (name, unit)) in motion.iter_mut().zip(OWN_MOTION) {
            let var: VarRef = want.var(name, unit)?;
            *value = want.read(USER, var).unwrap_or(0.0);
        }
        let [east, up, north, rate] = motion;
        let rate = if rate > 0.0 { rate } else { 1.0 };
        Some(Own {
            at: now,
            snapshot,
            velocity: [east * rate, up * rate, north * rate],
        })
    }
}

/// Sends the five axis events. Each surface goes negated, since on the 58P each surface
/// variable read its axis event's value negated, so a surface sent back negated repeats the
/// pilot flying's input, and the following aircraft moves its own yoke and pedals from it
/// (measured on MSFS 2024, 2026-10-01,
/// experiments/areas/flight-controls/results/p01-mask-2026-10-01-20-28-54.txt). Each brake goes
/// less 16,384, which the 58P reads on a curve, so its toe brakes read less than the pilot
/// flying's in mid-travel, a known limit (measured on MSFS 2024, 2026-11-11,
/// record/areas/flight-model/log.md, "In the sim the 58P follows a stand-in's path within
/// centimeters").
fn send_controls(s: &Snapshot, want: &mut Wants) {
    let [aileron, elevator, rudder] = s.surfaces.map(|v| -i32::from(v));
    let [left, right] = s.brakes.map(|v| i32::from(v) - 16_384);
    want.key(Key::AxisAilerons, aileron);
    want.key(Key::AxisElevator, elevator);
    want.key(Key::AxisRudder, rudder);
    want.key(Key::AxisLeftBrake, left);
    want.key(Key::AxisRightBrake, right);
}
