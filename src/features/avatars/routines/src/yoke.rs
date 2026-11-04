//! A yoke as this machine draws it: each of its animated nodes placed from the aircraft's own
//! variable, through the frames `aircraft-model` sampled across its animation, so a hand on it
//! moves with the yoke this machine shows (record/areas/avatars/01-avatars.md, "A hand on a
//! yoke").

use messages::avatars::slots::{SAMPLES, StageSlot, YokeSlot};

/// A 3x4 matrix in columns: three axes, then the translation.
pub(crate) type Frame3 = [f32; 12];

type V3 = [f32; 3];

fn columns(a: &Frame3) -> [V3; 4] {
    let [a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11] = *a;
    [[a0, a1, a2], [a3, a4, a5], [a6, a7, a8], [a9, a10, a11]]
}

fn frame(c: [V3; 4]) -> Frame3 {
    let [[a0, a1, a2], [a3, a4, a5], [a6, a7, a8], [a9, a10, a11]] = c;
    [a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11]
}

/// `v` turned by `a`'s axes, without its translation.
fn turn(a: &[V3; 4], v: V3) -> V3 {
    let [x, y, z, _] = a;
    let [p, q, r] = v;
    [
        x[0] * p + y[0] * q + z[0] * r,
        x[1] * p + y[1] * q + z[1] * r,
        x[2] * p + y[2] * q + z[2] * r,
    ]
}

pub(crate) fn then(a: &Frame3, b: &Frame3) -> Frame3 {
    let (a, [b0, b1, b2, b3]) = (columns(a), columns(b));
    let [t0, t1, t2] = turn(&a, b3);
    let [_, _, _, [x, y, z]] = a;
    frame([
        turn(&a, b0),
        turn(&a, b1),
        turn(&a, b2),
        [t0 + x, t1 + y, t2 + z],
    ])
}

pub(crate) fn point(a: &Frame3, p: V3) -> V3 {
    let a = columns(a);
    let [t0, t1, t2] = turn(&a, p);
    let [_, _, _, [x, y, z]] = a;
    [t0 + x, t1 + y, t2 + z]
}

/// A translation, a rotation as a quaternion `x, y, z, w`, and a scale, as one frame.
fn trs(t: V3, q: [f32; 4], s: V3) -> Frame3 {
    let [x, y, z, w] = q;
    let [sx, sy, sz] = s;
    frame([
        [
            (1.0 - 2.0 * (y * y + z * z)) * sx,
            2.0 * (x * y + z * w) * sx,
            2.0 * (x * z - y * w) * sx,
        ],
        [
            2.0 * (x * y - z * w) * sy,
            (1.0 - 2.0 * (x * x + z * z)) * sy,
            2.0 * (y * z + x * w) * sy,
        ],
        [
            2.0 * (x * z + y * w) * sz,
            2.0 * (y * z - x * w) * sz,
            (1.0 - 2.0 * (x * x + y * y)) * sz,
        ],
        t,
    ])
}

/// A stage's node's frame at the variable's `value`: the frame the code gives, clamped to the
/// animation, between its two nearest samples.
fn stage(s: &StageSlot, value: f32) -> Frame3 {
    let frame = (s.slope * value + s.intercept).clamp(0.0, s.length.max(0.0));
    let at = if s.length > 0.0 {
        frame / s.length * (SAMPLES - 1) as f32
    } else {
        0.0
    };
    // Rust compiles an `as` from a float to `trunc_sat`, which cargo-msfs's check of the module
    // refuses (measured with Rust 1.95, 2026-11-04), so the sample is counted up to.
    let i = (1..SAMPLES - 1)
        .take_while(|&i| i as f32 <= at)
        .last()
        .unwrap_or(0);
    let t = (at - i as f32).clamp(0.0, 1.0);
    let (Some(&[ax, ay, az, aqx, aqy, aqz, aqw]), Some(&[bx, by, bz, bqx, bqy, bqz, bqw])) =
        (s.samples.get(i), s.samples.get(i + 1))
    else {
        return trs([0.0; 3], [0.0, 0.0, 0.0, 1.0], s.scale);
    };
    let mix = |a: f32, b: f32| a + (b - a) * t;
    let translation = [mix(ax, bx), mix(ay, by), mix(az, bz)];
    // The shorter way between the two rotations, normalized.
    let sign = if aqx * bqx + aqy * bqy + aqz * bqz + aqw * bqw < 0.0 {
        -1.0
    } else {
        1.0
    };
    let q = [
        mix(aqx, sign * bqx),
        mix(aqy, sign * bqy),
        mix(aqz, sign * bqz),
        mix(aqw, sign * bqw),
    ];
    let n = q.iter().map(|c| c * c).sum::<f32>().sqrt();
    let q = if n > 0.0 { q.map(|c| c / n) } else { q };
    trs(translation, q, s.scale)
}

/// The frame of a yoke's last animated node, in the aircraft's frame, with each stage's
/// variable at the value `values` gives it.
pub(crate) fn last_frame(y: &YokeSlot, values: [f32; 2]) -> Frame3 {
    let mut frame = y.base;
    for (s, v) in y.stages.iter().zip(values).take(y.stage_count as usize) {
        frame = then(&then(&frame, &s.before), &stage(s, v));
    }
    frame
}

/// A stage's variable's name and unit, as the slot carries them.
pub(crate) fn var_of(s: &StageSlot) -> (&str, &str) {
    (text(&s.var), text(&s.unit))
}

/// Text padded with zero bytes, up to its first.
fn text(bytes: &[u8]) -> &str {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    std::str::from_utf8(bytes.get(..end).unwrap_or_default()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDENTITY: Frame3 = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0];

    #[test]
    fn a_stage_places_its_node_between_its_two_nearest_samples() {
        let mut s: StageSlot = bytemuck::Zeroable::zeroed();
        s.length = 100.0;
        s.slope = 0.5;
        s.intercept = 50.0;
        s.before = IDENTITY;
        s.scale = [1.0; 3];
        for (i, sample) in s.samples.iter_mut().enumerate() {
            *sample = [0.0, 0.0, i as f32 * 0.01, 0.0, 0.0, 0.0, 1.0];
        }
        let mut y: YokeSlot = bytemuck::Zeroable::zeroed();
        y.base = IDENTITY;
        y.stage_count = 1;
        y.stages[0] = s;
        // Value 0 is frame 50 of 100, sample 10; value 5 is frame 52.5, sample 10.5.
        let at = |v| point(&last_frame(&y, [v, 0.0]), [0.0; 3])[2];
        assert!((at(0.0) - 0.10).abs() < 1e-6);
        assert!((at(5.0) - 0.105).abs() < 1e-6);
        assert!(
            (at(1_000.0) - 0.20).abs() < 1e-6,
            "clamped to the animation's end"
        );
    }

    #[test]
    fn a_quarter_turn_about_y_takes_x_to_minus_z() {
        let s = std::f32::consts::FRAC_1_SQRT_2;
        let f = trs([0.0; 3], [0.0, s, 0.0, s], [1.0; 3]);
        let p = point(&f, [1.0, 0.0, 0.0]);
        assert!((p[2] + 1.0).abs() < 1e-6 && p[0].abs() < 1e-6, "{p:?}");
    }
}
