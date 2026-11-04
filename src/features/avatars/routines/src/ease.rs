//! How each part of a figure moves toward its target from frame to frame
//! (record/areas/avatars/01-avatars.md, "`Figure`, each frame").
//!
//! A hand goes out on a spring damped just enough not to overshoot, 95% of the way in 0.15s,
//! and back to rest or to a grip along a curve that sags 6cm toward its shoulder and eases out
//! by 1 − (1 − t)³ over 0.3s, as p27 drove them (measured on MSFS 2024, 2026-10-04,
//! record/areas/avatars/log.md, "In the A350, the pilot cut the hand's time on the spot"); the
//! head closes 1 − e^(−dt/0.12s) of what's left each frame, as p25's did (read in
//! experiments/areas/avatars/p25-figure-hands.mjs, `EASE_S`).
//! A part within what shows of its target, at rest, snaps to it, so it stops changing and
//! `Figure` stops writing it.

use crate::solve::{L3, add, length, scale, sub};

/// A critically damped spring's rate: (1 + ωt)e^(−ωt) is 5% at t = 0.15s for ω = 31.6.
const SPRING: f32 = 31.6;
const HOME_S: f32 = 0.3;
const SAG: f32 = 0.06;
const HEAD_S: f32 = 0.12;
/// Nearer than this, and slower than this a second, a part snaps to its target, in meters.
const SETTLED: f32 = 0.0005;

/// A hand's way to its target.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Way {
    /// Out to a spot, on the spring.
    Out,
    /// Home along the curve, started at `from` this many seconds ago.
    Home { from: L3, t: f32 },
}

/// Where a hand is going. A home's place moves on its own, a grip's with the yoke, so a change of
/// this, rather than of the target's place, starts the hand's way again: from a thigh to a yoke
/// it takes the curve, and along a moving yoke it follows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Goal {
    /// A spot, or a button, on the spring.
    Out,
    Rest,
    /// The yoke on this side.
    Grip(usize),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct HandEase {
    pub(crate) at: L3,
    velocity: L3,
    goal: Goal,
    way: Way,
}

impl HandEase {
    /// A hand already at its target.
    pub(crate) fn new(at: L3, goal: Goal) -> HandEase {
        HandEase {
            at,
            velocity: [0.0; 3],
            goal,
            way: match goal {
                Goal::Out => Way::Out,
                _ => Way::Home {
                    from: at,
                    t: HOME_S,
                },
            },
        }
    }

    /// One frame of `dt` seconds toward `target`: on the spring while its goal is a spot, and
    /// otherwise home along the curve, sagging toward `shoulder`.
    pub(crate) fn step(&mut self, target: L3, goal: Goal, shoulder: L3, dt: f32) {
        if goal != self.goal {
            self.goal = goal;
            if goal == Goal::Out {
                self.way = Way::Out;
            } else {
                self.way = Way::Home {
                    from: self.at,
                    t: 0.0,
                };
                self.velocity = [0.0; 3];
            }
        }
        match &mut self.way {
            Way::Out => {
                // The spring's exact step: x(t) = (x0 + (v0 + ω x0) t) e^(−ωt), about the target.
                let x0 = sub(self.at, target);
                let e = (-SPRING * dt).exp();
                let k = add(self.velocity, scale(x0, SPRING));
                let x = scale(add(x0, scale(k, dt)), e);
                self.velocity = scale(sub(self.velocity, scale(k, SPRING * dt)), e);
                self.at = add(target, x);
                if length(x) < SETTLED && length(self.velocity) < SETTLED * SPRING {
                    self.at = target;
                    self.velocity = [0.0; 3];
                }
            }
            Way::Home { from, t } => {
                *t = (*t + dt).min(HOME_S);
                let u = *t / HOME_S;
                let eased = 1.0 - (1.0 - u).powi(3);
                let along = add(*from, scale(sub(target, *from), eased));
                let toward = sub(shoulder, along);
                let sag = if length(toward) > 0.0 {
                    scale(
                        toward,
                        SAG * (std::f32::consts::PI * u).sin() / length(toward),
                    )
                } else {
                    [0.0; 3]
                };
                self.at = if u >= 1.0 { target } else { add(along, sag) };
            }
        }
    }
}

/// The head's ease toward where it looks from and toward.
pub(crate) fn head(at: L3, target: L3, dt: f32) -> L3 {
    let closed = 1.0 - (-dt / HEAD_S).exp();
    let next = add(at, scale(sub(target, at), closed));
    if length(sub(next, target)) < SETTLED {
        target
    } else {
        next
    }
}

/// An angle's ease, the shorter way round, in degrees.
pub(crate) fn angle(at: f32, target: f32, dt: f32) -> f32 {
    let closed = 1.0 - (-dt / HEAD_S).exp();
    let diff = (target - at + 540.0).rem_euclid(360.0) - 180.0;
    if diff.abs() < 0.05 {
        target
    } else {
        at + diff * closed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hand_out_covers_95_percent_in_0_15s_without_overshooting() {
        let mut hand = HandEase::new([0.0; 3], Goal::Rest);
        let target = [1.0, 0.0, 0.0];
        let mut most: f32 = 0.0;
        for _ in 0..9 {
            hand.step(target, Goal::Out, [0.0; 3], 1.0 / 60.0);
            most = most.max(hand.at[0]);
        }
        assert!((0.94..=0.97).contains(&hand.at[0]), "{:?}", hand.at);
        for _ in 0..120 {
            hand.step(target, Goal::Out, [0.0; 3], 1.0 / 60.0);
            most = most.max(hand.at[0]);
        }
        assert!(most <= 1.0, "no overshoot: {most}");
        assert_eq!(hand.at, target, "a settled hand snaps to its target");
    }

    #[test]
    fn a_hand_home_sags_toward_its_shoulder_and_lands_in_0_3s() {
        let mut hand = HandEase::new([0.0; 3], Goal::Rest);
        hand.step([1.0, 0.0, 0.0], Goal::Out, [0.5, 0.0, 1.0], 1.0);
        let mut mid = [0.0; 3];
        for i in 0..18 {
            hand.step([0.0; 3], Goal::Rest, [0.5, 0.0, 1.0], 1.0 / 60.0);
            if i == 8 {
                mid = hand.at;
            }
        }
        assert!(mid[2] > 0.0, "it sags toward the shoulder: {mid:?}");
        assert_eq!(hand.at, [0.0; 3]);
    }

    #[test]
    fn a_hand_from_rest_to_a_grip_takes_the_curve_and_on_the_grip_follows_the_yoke() {
        let (rest, grip) = ([0.0; 3], [1.0, 0.0, 0.0]);
        let mut hand = HandEase::new(rest, Goal::Rest);
        hand.step(grip, Goal::Grip(0), [0.5, 0.0, 1.0], 1.0 / 60.0);
        assert!(hand.at[0] < 0.2, "it doesn't jump: {:?}", hand.at);
        for _ in 0..18 {
            hand.step(grip, Goal::Grip(0), [0.5, 0.0, 1.0], 1.0 / 60.0);
        }
        assert_eq!(hand.at, grip, "it lands in 0.3s");
        let moved = [1.1, 0.0, 0.0];
        hand.step(moved, Goal::Grip(0), [0.5, 0.0, 1.0], 1.0 / 60.0);
        assert_eq!(hand.at, moved, "it stays on the yoke as the yoke moves");
        hand.step(rest, Goal::Rest, [0.5, 0.0, 1.0], 1.0 / 60.0);
        assert!(
            hand.at[0] > 0.8,
            "letting go takes the curve: {:?}",
            hand.at
        );
    }
}
