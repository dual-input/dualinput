//! The figure's 27 joints from where its head looks and where its hands and feet go, in the
//! figure's own frame: meters forward, right, and up from its hips, with angles in degrees,
//! yaw right, pitch up, and roll right positive (record/areas/avatars/01-avatars.md, "`Figure`,
//! each frame").
//!
//! The head turns about the eye, the chest sits between the hips and the head, each arm runs
//! straight from its shoulder to its hand, and each leg's thigh runs to its knee, which bends
//! toward the foot until the shin passes through it, as the probes' figure did (read in
//! experiments/areas/avatars/figure/solve.mjs). Each stick telescopes to its length.

use crate::spec;

/// A point or direction in the figure's frame: forward, right, up.
pub type L3 = [f32; 3];

/// The channels, in the order `values` holds them; each is the variable
/// `Z:DUALINPUT_FIGURE_` and its name. The figure's generator, in
/// src/features/avatars/figure/, builds an animation for each of the same names, so change
/// both together.
pub const CHANNELS: [&str; 27] = [
    "HEAD_FWD",
    "HEAD_RIGHT",
    "HEAD_UP",
    "CHEST_FWD",
    "CHEST_RIGHT",
    "CHEST_UP",
    "HEAD_YAW",
    "HEAD_PITCH",
    "HEAD_ROLL",
    "ARM_L_YAW",
    "ARM_L_PITCH",
    "ARM_L_LEN",
    "ARM_R_YAW",
    "ARM_R_PITCH",
    "ARM_R_LEN",
    "LEG_L_YAW",
    "LEG_L_PITCH",
    "LEG_L_LEN",
    "LEG_L_ROLL",
    "LEG_L_BEND",
    "LEG_L_SHIN",
    "LEG_R_YAW",
    "LEG_R_PITCH",
    "LEG_R_LEN",
    "LEG_R_ROLL",
    "LEG_R_BEND",
    "LEG_R_SHIN",
];

/// Which of `CHANNELS` are lengths and moves, in meters, rather than angles.
pub fn is_length(channel: usize) -> bool {
    matches!(channel, 0..=5 | 11 | 14 | 17 | 20 | 23 | 26)
}

/// Where the figure's parts go.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Body {
    pub eye: L3,
    /// Where the head looks: yaw right and pitch up, in degrees.
    pub look: [f32; 2],
    /// The hips' center, the figure's origin when it sits.
    pub hips: L3,
    /// Each hand's center, the left then the right.
    pub hands: [L3; 2],
    /// Each knee and foot, the left then the right; a foot with none hangs from the thigh at
    /// the spec's rest bend and shin.
    pub knees: [L3; 2],
    pub feet: [Option<L3>; 2],
}

pub(crate) fn add(a: L3, b: L3) -> L3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
pub(crate) fn sub(a: L3, b: L3) -> L3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub(crate) fn scale(a: L3, k: f32) -> L3 {
    [a[0] * k, a[1] * k, a[2] * k]
}
pub(crate) fn dot(a: L3, b: L3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub(crate) fn length(a: L3) -> f32 {
    dot(a, a).sqrt()
}
pub(crate) fn unit(a: L3) -> L3 {
    let l = length(a);
    if l > 1e-9 {
        scale(a, 1.0 / l)
    } else {
        [1.0, 0.0, 0.0]
    }
}
fn cross(a: L3, b: L3) -> L3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// A shoulder's or a leg's anchor: from the chest's center, and from the hips.
pub(crate) fn shoulder(side: f32) -> L3 {
    [
        0.0,
        side * spec::SHOULDERS_WIDTH / 2.0,
        -spec::SHOULDERS_DOWN,
    ]
}
pub(crate) fn leg(hips: L3, side: f32) -> L3 {
    add(hips, [0.0, side * spec::LEGS_WIDTH / 2.0, -spec::LEGS_DOWN])
}

/// The unit direction `look` points.
pub fn look_dir(look: [f32; 2]) -> L3 {
    let (y, p) = (look[0].to_radians(), look[1].to_radians());
    [p.cos() * y.cos(), p.cos() * y.sin(), p.sin()]
}

/// Where the chest sits: between the hips and the head's center.
pub(crate) fn chest(body: &Body) -> L3 {
    let head = sub(body.eye, scale(look_dir(body.look), spec::EYE_FORWARD));
    add(body.hips, scale(sub(head, body.hips), spec::CHEST_AT))
}

/// The 27 channels' values for `body`.
pub fn solve(body: &Body) -> [f32; 27] {
    let [ex, ey, ez] = body.eye;
    let [yaw, pitch] = body.look;
    let chest = chest(body);
    let [cx, cy, cz] = chest;
    let arm = |side: f32, hand: L3| {
        let d = sub(hand, add(chest, shoulder(side)));
        let (yaw, pitch) = aim(unit(d));
        [yaw, pitch, length(d).clamp(0.02, spec::REACH)]
    };
    let [[l0, l1, l2], [r0, r1, r2]] = body.hands;
    let [la0, la1, la2] = arm(-1.0, [l0, l1, l2]);
    let [ra0, ra1, ra2] = arm(1.0, [r0, r1, r2]);
    let [kl, kr] = body.knees;
    let [fl, fr] = body.feet;
    let [ll0, ll1, ll2, ll3, ll4, ll5] = solve_leg(leg(body.hips, -1.0), kl, fl);
    let [lr0, lr1, lr2, lr3, lr4, lr5] = solve_leg(leg(body.hips, 1.0), kr, fr);
    [
        ex, ey, ez, cx, cy, cz, yaw, pitch, 0.0, la0, la1, la2, ra0, ra1, ra2, ll0, ll1, ll2, ll3,
        ll4, ll5, lr0, lr1, lr2, lr3, lr4, lr5,
    ]
}

/// A limb pointed along `dir`, as yaw and pitch in degrees.
fn aim(dir: L3) -> (f32, f32) {
    let yaw = dir[1].atan2(dir[0]);
    let pitch = dir[2].atan2(dir[0].hypot(dir[1]));
    (yaw.to_degrees(), pitch.to_degrees())
}

/// A leg's yaw, pitch, thigh, roll, bend, and shin: the thigh from `from` to the knee, then
/// the knee's curve bending toward the foot until the shin passes through it.
fn solve_leg(from: L3, knee: L3, foot: Option<L3>) -> [f32; 6] {
    let thigh = sub(knee, from);
    let dir = unit(thigh);
    let len = length(thigh).max(0.02);
    let (yaw, pitch) = aim(dir);
    let (y, p) = (yaw.to_radians(), pitch.to_radians());
    let up = [-p.sin() * y.cos(), -p.sin() * y.sin(), p.cos()];
    let right = cross(up, dir);
    let Some(foot) = foot else {
        return [
            yaw,
            pitch,
            len,
            0.0,
            spec::REST_LEG_BEND,
            spec::REST_LEG_SHIN,
        ];
    };
    let w = sub(foot, add(from, scale(dir, len)));
    let along = dot(w, dir);
    let off = sub(w, scale(dir, along));
    let roll = if length(off) > 1e-6 {
        dot(off, right).atan2(-dot(off, up)).to_degrees()
    } else {
        0.0
    };
    let (bend, shin) = bend_to(along, length(off));
    [yaw, pitch, len, roll, bend.to_degrees(), shin]
}

/// Where a knee's curve of equal sticks ends, along the limb and toward the bend, for a bend
/// of `bend` radians. `footFor` in tools/figure-viewer/page/app.js repeats this, so change both
/// together.
pub(crate) fn bend_end(bend: f32) -> (f32, f32) {
    let segments = spec::KNEE_SEGMENTS.max(1);
    let piece = spec::KNEE_ARC / segments as f32;
    let (mut along, mut toward) = (0.0, 0.0);
    for k in 1..=segments {
        let a = k as f32 * bend / segments as f32;
        along += piece * a.cos();
        toward += piece * a.sin();
    }
    (along, toward)
}

/// The bend, in radians, and the shin's length that put the shin through a point `along`
/// the limb and `toward` the bend from the curve's start. Past the furthest bend the curve
/// reaches, it stays there.
fn bend_to(along: f32, toward: f32) -> (f32, f32) {
    if toward < 1e-6 {
        return (0.0, (along - spec::KNEE_ARC).max(0.02));
    }
    let miss = |b: f32| {
        let (ea, et) = bend_end(b);
        (along - ea) * b.sin() - (toward - et) * b.cos()
    };
    let most = std::f32::consts::PI * 0.99;
    let mut bend = most;
    if miss(most) > 0.0 {
        let (mut lo, mut hi) = (0.0, most);
        for _ in 0..30 {
            let mid = (lo + hi) / 2.0;
            if miss(mid) > 0.0 {
                hi = mid;
            } else {
                lo = mid;
            }
        }
        bend = (lo + hi) / 2.0;
    }
    let (ea, et) = bend_end(bend);
    let shin = ((along - ea) * bend.cos() + (toward - et) * bend.sin()).max(0.02);
    (bend, shin)
}

/// Where a knee goes, between the leg's anchor and its foot, for a thigh and a shin each
/// `half` long: bent forward, as a standing leg's knee bends.
pub(crate) fn knee_between(from: L3, foot: L3, half: f32) -> L3 {
    let d = sub(foot, from);
    let dist = length(d).min(2.0 * half - 1e-4);
    let u = unit(d);
    let along = dist / 2.0;
    let out = (half * half - along * along).max(0.0).sqrt();
    let forward = unit(sub([1.0, 0.0, 0.0], scale(u, u[0])));
    add(add(from, scale(u, along)), scale(forward, out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seated() -> Body {
        Body {
            eye: [-0.05, 0.0, 0.63],
            look: [0.0, 0.0],
            hips: [0.0; 3],
            hands: [[0.2, -0.17, 0.1], [0.2, 0.17, 0.1]],
            knees: [[0.45, -0.08, 0.05], [0.45, 0.08, 0.05]],
            feet: [Some([0.62, -0.08, -0.42]), Some([0.62, 0.08, -0.42])],
        }
    }

    #[test]
    fn a_hand_ahead_of_its_shoulder_points_the_arm_forward_and_down() {
        let v = solve(&seated());
        let chest = chest(&seated());
        let d = sub([0.2, -0.17, 0.1], add(chest, shoulder(-1.0)));
        assert!((v[11] - length(d)).abs() < 1e-5);
        assert!(v[10] < 0.0, "pitch down to the thigh");
        assert!(v[9] < 0.0, "yaw left toward the left hand");
        assert_eq!(&v[0..3], &[-0.05, 0.0, 0.63]);
    }

    #[test]
    fn the_shin_passes_through_the_foot() {
        let body = seated();
        let v = solve(&body);
        // Rebuild the left foot from the leg's channels, as the model draws it.
        let from = leg(body.hips, -1.0);
        let (y, p) = (v[15].to_radians(), v[16].to_radians());
        let dir = [p.cos() * y.cos(), p.cos() * y.sin(), p.sin()];
        let up = [-p.sin() * y.cos(), -p.sin() * y.sin(), p.cos()];
        let right = cross(up, dir);
        let roll = v[18].to_radians();
        let toward_dir = add(scale(up, -roll.cos()), scale(right, roll.sin()));
        let bend = v[19].to_radians();
        let (ea, et) = bend_end(bend);
        let knee_end = add(
            add(add(from, scale(dir, v[17])), scale(dir, ea)),
            scale(toward_dir, et),
        );
        let shin_dir = add(scale(dir, bend.cos()), scale(toward_dir, bend.sin()));
        let foot = add(knee_end, scale(shin_dir, v[20]));
        let miss = length(sub(foot, body.feet[0].unwrap_or_default()));
        assert!(miss < 0.005, "the foot lands {miss}m off");
    }

    #[test]
    fn a_standing_knee_bends_forward_and_keeps_its_lengths() {
        let from = [0.0, 0.08, -0.07];
        let foot = [0.0, 0.08, -0.8];
        let k = knee_between(from, foot, 0.43);
        assert!(k[0] > 0.0, "forward");
        assert!((length(sub(k, from)) - 0.43).abs() < 1e-4);
        assert!((length(sub(foot, k)) - 0.43).abs() < 1e-4);
    }
}
