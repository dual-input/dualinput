//! The scripts the page plays: what avatars would feed `Figure` for one pilot, frame by frame,
//! through a look around, reaches, grips, a walk, a run, a crouch, and a slump, in the 58P's
//! left seat and beside its left wingtip. Each is written by hand against the cockpit, so its
//! times are a script's, apart from a tap's, which follow avatars'.

use aircraft_model::Vec3;
use messages::avatars::GRAY;
use messages::avatars::slots::{
    BODY_ON_FOOT, BODY_SEATED, HAND_GRIP, HAND_POINT, HAND_REST, HandSlot, PoseSlot, SHOWS_ALL,
};

use crate::cockpit::Spot;
use crate::seat::Seat;
use crate::slot::Fed;

/// What one frame of a script feeds, the aircraft's variables it sets, and where each hand was
/// sent, for the page to mark.
pub struct Input {
    pub fed: Fed,
    /// Each variable by its name with its prefix, such as `A:YOKE Y POSITION WITH AP`.
    pub aircraft: Vec<(String, f64)>,
    pub targets: [Option<Vec3>; 2],
}

pub struct Script {
    pub name: &'static str,
    pub title: &'static str,
    pub seconds: f32,
    pub at: Box<dyn Fn(f32) -> Input>,
}

/// What the scripts are written against, found in the 58P.
#[derive(Clone, Debug)]
pub struct Stage {
    pub seat: Seat,
    /// The spots the reach script's hands go to, by `AIMS`' names, where a cast met the cockpit.
    pub spots: Vec<(&'static str, Spot)>,
    /// The ground's height, and the line beside the left wingtip the figure walks along, as x,
    /// in the aircraft's frame.
    pub ground: f32,
    pub beside: f32,
    /// The pilot's yoke's variables, which the grip script moves.
    pub yoke: Vec<String>,
}

/// Where the reach script presses: a yaw right and a pitch up from the seat's eye, in degrees.
pub const AIMS: [(&str, f32, f32); 4] = [
    ("left panel", -32.0, -14.0),
    ("center panel", 22.0, -16.0),
    ("throttles", 24.0, -42.0),
    ("right panel", 48.0, -12.0),
];

/// The figure's color in every script but the slump, a palette index: blue.
const COLOR: u32 = 1;

/// A walk's and a run's speeds, in m/s.
const WALK: f32 = 1.4;
const RUN: f32 = 4.0;
const CREEP: f32 = 0.7;

/// A tap, as avatars times one: its hand stays 150ms on the spot after the release, about
/// 0.3s from the press, then hovers 1.5cm farther out for 500ms (record/areas/avatars/
/// 01-avatars.md, "Which hand, and its target").
const ON_SPOT: f32 = 0.3;
const HOVER: f32 = 0.5;
const HOVER_OUT: f32 = 0.015;

/// Every script, in the order the page lists them.
pub fn all(stage: &Stage) -> Vec<Script> {
    vec![
        look(stage.clone()),
        reach(stage.clone()),
        grip(stage.clone()),
        walk(stage.clone()),
        run(stage.clone()),
        crouch(stage.clone()),
        slump(stage.clone()),
    ]
}

/// A value at `t` through `keys`, each a time and a value, eased in and out between two keys
/// and held before the first and after the last.
pub fn keyed(t: f32, keys: &[(f32, f32)]) -> f32 {
    let Some(&(t0, v0)) = keys.first() else {
        return 0.0;
    };
    if t <= t0 {
        return v0;
    }
    for pair in keys.windows(2) {
        let [(a, va), (b, vb)] = [pair[0], pair[1]];
        if t <= b {
            let u = if b > a { (t - a) / (b - a) } else { 1.0 };
            let s = u * u * (3.0 - 2.0 * u);
            return va + (vb - va) * s;
        }
    }
    keys.last().map_or(v0, |k| k.1)
}

/// The unit direction a yaw right and a pitch up give, in degrees, in the aircraft's frame.
pub fn direction(yaw: f32, pitch: f32) -> Vec3 {
    let (y, p) = (yaw.to_radians(), pitch.to_radians());
    [-y.sin() * p.cos(), p.sin(), y.cos() * p.cos()]
}

fn rest() -> HandSlot {
    HandSlot {
        kind: HAND_REST,
        side: 0,
        point: [0.0; 3],
    }
}

/// A hand on the pilot's yoke, the left one.
fn on_yoke() -> HandSlot {
    HandSlot {
        kind: HAND_GRIP,
        side: 0,
        point: [0.0; 3],
    }
}

fn point(p: Vec3) -> HandSlot {
    HandSlot {
        kind: HAND_POINT,
        side: 0,
        point: p,
    }
}

/// A tap on `spot` starting at `start`: on the spot, then hovering, then nothing once it's
/// over.
fn tap(t: f32, start: f32, spot: Option<&Spot>) -> Option<Vec3> {
    let s = spot?;
    let d = t - start;
    if !(0.0..ON_SPOT + HOVER).contains(&d) {
        return None;
    }
    let out = if d < ON_SPOT { 0.0 } else { HOVER_OUT };
    Some([
        s.at[0] + s.normal[0] * out,
        s.at[1] + s.normal[1] * out,
        s.at[2] + s.normal[2] * out,
    ])
}

/// A seated pose: the eye leaned `lean` meters forward of the seat's, looking `yaw` right and
/// `pitch` up of the seat's facing, with `hands`.
fn seated(seat: &Seat, yaw: f32, pitch: f32, lean: f32, hands: [HandSlot; 2]) -> PoseSlot {
    let mut pose: PoseSlot = bytemuck::Zeroable::zeroed();
    pose.body = BODY_SEATED;
    let [ex, ey, ez] = seat.eye_point();
    let f = seat.forward();
    pose.eye = [ex + f[0] * lean, ey, ez + f[2] * lean];
    pose.look = direction(seat.facing + yaw, pitch);
    pose.hands = hands;
    pose
}

/// A pose on foot, its feet at `at`, facing `heading` right of the nose.
fn on_foot(at: Vec3, heading: f32, crouch: bool, hands: [HandSlot; 2]) -> PoseSlot {
    let mut pose: PoseSlot = bytemuck::Zeroable::zeroed();
    pose.body = BODY_ON_FOOT;
    pose.at = at;
    pose.heading = heading;
    pose.crouch = u32::from(crouch);
    pose.hands = hands;
    pose
}

fn input(pose: PoseSlot, targets: [Option<Vec3>; 2]) -> Input {
    Input {
        fed: Fed {
            pose,
            color: COLOR,
            shows: SHOWS_ALL,
            slumps: false,
        },
        aircraft: Vec::new(),
        targets,
    }
}

fn hand_of(target: Option<Vec3>, otherwise: HandSlot) -> HandSlot {
    target.map_or(otherwise, point)
}

/// Seated, the left hand on the yoke, looking left, then right, then down at the panel with a
/// lean toward it.
fn look(stage: Stage) -> Script {
    Script {
        name: "look",
        title: "Look around",
        seconds: 8.0,
        at: Box::new(move |t| {
            let yaw = keyed(
                t,
                &[
                    (1.0, 0.0),
                    (2.0, -55.0),
                    (3.0, -55.0),
                    (4.5, 60.0),
                    (5.5, 60.0),
                    (6.3, 0.0),
                ],
            );
            let pitch = keyed(t, &[(6.3, 0.0), (6.8, -35.0), (7.4, -35.0), (8.0, 0.0)]);
            let lean = keyed(t, &[(6.3, 0.0), (6.8, 0.06), (7.4, 0.06), (8.0, 0.0)]);
            input(
                seated(&stage.seat, yaw, pitch, lean, [on_yoke(), rest()]),
                [None, None],
            )
        }),
    }
}

/// Seated as the PF: the left hand on the yoke while the right taps the center panel, the
/// throttles, and the right panel, then the left taps the left panel while the right holds the
/// yoke, the head turning to each.
fn reach(stage: Stage) -> Script {
    let spot = move |name: &str, stage: &Stage| {
        stage
            .spots
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, s)| *s)
    };
    Script {
        name: "reach",
        title: "Reach for the panel",
        seconds: 10.0,
        at: Box::new(move |t| {
            let [left_panel, center, throttles, right_panel] =
                ["left panel", "center panel", "throttles", "right panel"].map(|n| spot(n, &stage));
            let right = tap(t, 1.0, center.as_ref())
                .or_else(|| tap(t, 2.8, throttles.as_ref()))
                .or_else(|| tap(t, 4.6, right_panel.as_ref()));
            let left = tap(t, 6.5, left_panel.as_ref());
            // The right hand holds the yoke from the left's tap, which ends at 7.3s, until
            // 0.3s after the left is back on it, its way home taking 0.3s.
            let right_on_yoke = (6.5..7.9).contains(&t);
            let hands = [
                hand_of(left, on_yoke()),
                hand_of(right, if right_on_yoke { on_yoke() } else { rest() }),
            ];
            // Each key of the head's yaw, for `k` 0, or its pitch, for 1.
            let aim = |i: usize, k: usize| if k == 0 { AIMS[i].1 } else { AIMS[i].2 };
            let keys = |k: usize| {
                [
                    (0.5, 0.0),
                    (0.9, aim(1, k)),
                    (1.9, aim(1, k)),
                    (2.6, aim(2, k)),
                    (3.7, aim(2, k)),
                    (4.4, aim(3, k)),
                    (5.5, aim(3, k)),
                    (6.3, aim(0, k)),
                    (7.4, aim(0, k)),
                    (8.2, 0.0),
                ]
            };
            input(
                seated(
                    &stage.seat,
                    keyed(t, &keys(0)),
                    keyed(t, &keys(1)),
                    0.0,
                    hands,
                ),
                [left, right],
            )
        }),
    }
}

/// Seated with both hands on the yoke while it turns and moves fore and aft, then the right
/// hand lets go.
fn grip(stage: Stage) -> Script {
    Script {
        name: "grip",
        title: "Grip the yoke",
        seconds: 10.0,
        at: Box::new(move |t| {
            let swing = keyed(t, &[(1.0, 0.0), (1.8, 1.0), (8.2, 1.0), (9.0, 0.0)]);
            let periods = [5.0, 3.5];
            let aircraft = stage
                .yoke
                .iter()
                .zip(periods)
                .map(|(name, period)| {
                    let value = 60.0 * swing * (std::f32::consts::TAU * (t - 1.0) / period).sin();
                    (name.clone(), f64::from(value))
                })
                .collect();
            let right = if t < 7.0 { on_yoke() } else { rest() };
            let mut i = input(
                seated(&stage.seat, 0.0, -8.0, 0.0, [on_yoke(), right]),
                [None, None],
            );
            i.aircraft = aircraft;
            i
        }),
    }
}

/// Where a figure on foot is at `t` along `legs`, each a time it ends at and the point it
/// ends at, from `start`, and the heading of the leg it's on, or the last leg's once it
/// stands.
fn along(t: f32, start: (f32, Vec3, f32), legs: &[(f32, Vec3)]) -> (Vec3, f32) {
    let (mut t0, mut from, mut heading) = start;
    for &(t1, to) in legs {
        let dx = to[0] - from[0];
        let dz = to[2] - from[2];
        if dx.hypot(dz) > 1e-4 {
            heading = (-dx).atan2(dz).to_degrees();
        }
        if t <= t1 {
            let u = if t1 > t0 {
                ((t - t0) / (t1 - t0)).clamp(0.0, 1.0)
            } else {
                1.0
            };
            return ([from[0] + dx * u, to[1], from[2] + dz * u], heading);
        }
        (t0, from) = (t1, to);
    }
    (from, heading)
}

/// The time a leg from `a` to `b` ends at when it starts at `t` at `speed`.
fn leg_end(t: f32, a: Vec3, b: Vec3, speed: f32) -> f32 {
    t + (b[0] - a[0]).hypot(b[2] - a[2]) / speed
}

/// On foot beside the left wingtip: stands, walks 7m forward, turns, and walks back.
fn walk(stage: Stage) -> Script {
    let a = [stage.beside, stage.ground, -3.0];
    let b = [stage.beside, stage.ground, 4.0];
    let t1 = leg_end(1.0, a, b, WALK);
    let t2 = leg_end(t1 + 1.0, b, a, WALK);
    Script {
        name: "walk",
        title: "Walk",
        seconds: t2 + 1.5,
        at: Box::new(move |t| {
            let (at, heading) = along(t, (1.0, a, 0.0), &[(t1, b), (t1 + 1.0, b), (t2, a)]);
            input(on_foot(at, heading, false, [rest(), rest()]), [None, None])
        }),
    }
}

/// On foot beside the left wingtip: runs 7m forward and back, then walks half of it.
fn run(stage: Stage) -> Script {
    let a = [stage.beside, stage.ground, -3.0];
    let b = [stage.beside, stage.ground, 4.0];
    let mid = [stage.beside, stage.ground, 0.5];
    let t1 = leg_end(1.0, a, b, RUN);
    let t2 = leg_end(t1 + 1.2, b, a, RUN);
    let t3 = leg_end(t2 + 1.2, a, mid, WALK);
    Script {
        name: "run",
        title: "Run",
        seconds: t3 + 1.5,
        at: Box::new(move |t| {
            let legs = [(t1, b), (t1 + 1.2, b), (t2, a), (t2 + 1.2, a), (t3, mid)];
            let (at, heading) = along(t, (1.0, a, 0.0), &legs);
            input(on_foot(at, heading, false, [rest(), rest()]), [None, None])
        }),
    }
}

/// On foot: crouches, stands, creeps forward crouched, then reaches for a spot on the ground
/// ahead with the right hand.
fn crouch(stage: Stage) -> Script {
    let a = [stage.beside, stage.ground, -3.0];
    let b = [stage.beside, stage.ground, -3.0 + CREEP * 3.0];
    // Ahead of the feet and a little to the right, 10cm above the ground.
    let low = [b[0] - 0.15, stage.ground + 0.1, b[2] + 0.45];
    Script {
        name: "crouch",
        title: "Crouch",
        seconds: 10.5,
        at: Box::new(move |t| {
            let (at, heading) = along(t, (4.5, a, 0.0), &[(7.5, b)]);
            let crouch = (1.0..3.0).contains(&t) || (4.5..9.5).contains(&t);
            let reach = (7.8..9.3).contains(&t).then_some(low);
            input(
                on_foot(at, heading, crouch, [rest(), hand_of(reach, rest())]),
                [None, reach],
            )
        }),
    }
}

/// Seated, the figure slumps and turns gray, as for a member out of the flight, then comes
/// back.
fn slump(stage: Stage) -> Script {
    Script {
        name: "slump",
        title: "Slump",
        seconds: 6.0,
        at: Box::new(move |t| {
            let slumps = (1.5..4.5).contains(&t);
            let mut i = input(
                seated(&stage.seat, 0.0, 0.0, 0.0, [on_yoke(), rest()]),
                [None, None],
            );
            i.fed.slumps = slumps;
            if slumps {
                i.fed.color = u32::from(GRAY);
            }
            i
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stage() -> Stage {
        Stage {
            seat: Seat::at([0.28, 0.13, -0.05]),
            spots: vec![(
                "center panel",
                Spot {
                    at: [0.0, 0.6, 0.8],
                    normal: [0.0, 0.0, -1.0],
                },
            )],
            ground: -1.2,
            beside: 7.0,
            yoke: vec!["A:YOKE Y POSITION WITH AP".into()],
        }
    }

    #[test]
    fn keys_ease_between_and_hold_outside() {
        let keys = [(1.0, 0.0), (2.0, 10.0)];
        assert_eq!(keyed(0.0, &keys), 0.0);
        assert_eq!(keyed(1.5, &keys), 5.0);
        assert_eq!(keyed(3.0, &keys), 10.0);
    }

    #[test]
    fn a_walk_moves_at_its_speed_and_faces_its_way() {
        let s = walk(stage());
        let at = |t| (s.at)(t).fed.pose;
        assert_eq!(at(0.5).at, [7.0, -1.2, -3.0], "standing at the start");
        let (p, q) = (at(2.0), at(3.0));
        assert!(((q.at[2] - p.at[2]) - WALK).abs() < 1e-4);
        assert_eq!(p.heading, 0.0, "forward");
        assert!(
            (at(s.seconds - 2.0).heading.abs() - 180.0).abs() < 1e-3,
            "back"
        );
    }

    #[test]
    fn a_tap_holds_its_spot_then_hovers_out_then_ends() {
        let s = reach(stage());
        let hand = |t| (s.at)(t).fed.pose.hands[1];
        assert_eq!(hand(0.5).kind, HAND_REST);
        assert_eq!(hand(1.1).point, [0.0, 0.6, 0.8]);
        assert!((hand(1.5).point[2] - (0.8 - HOVER_OUT)).abs() < 1e-6);
        assert_eq!(hand(2.0).kind, HAND_REST);
        assert_eq!((s.at)(1.1).targets[1], Some([0.0, 0.6, 0.8]));
    }

    #[test]
    fn the_grip_script_moves_the_yoke_and_the_slump_turns_gray() {
        let g = grip(stage());
        assert_eq!((g.at)(0.5).aircraft[0].1, 0.0);
        assert!((g.at)(3.0).aircraft[0].1.abs() > 10.0);
        let s = slump(stage());
        assert_eq!((s.at)(2.0).fed.color, u32::from(GRAY));
        assert!((s.at)(2.0).fed.slumps && !(s.at)(5.0).fed.slumps);
    }
}
