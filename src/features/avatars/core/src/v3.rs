//! Points and directions in the aircraft's frame, in meters: x left, y up, z forward.

pub(crate) type V3 = [f32; 3];

pub(crate) fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

pub(crate) fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub(crate) fn scale(a: V3, k: f32) -> V3 {
    [a[0] * k, a[1] * k, a[2] * k]
}

pub(crate) fn dot(a: V3, b: V3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub(crate) fn length(a: V3) -> f32 {
    dot(a, a).sqrt()
}

pub(crate) fn distance(a: V3, b: V3) -> f32 {
    length(sub(a, b))
}

/// `a` scaled to length 1, or `a` itself when it has none.
pub(crate) fn unit(a: V3) -> V3 {
    let l = length(a);
    if l > 0.0 { scale(a, 1.0 / l) } else { a }
}

/// The direction a seat or figure faces, `degrees` from the nose, positive to the right,
/// which is toward −x.
pub(crate) fn facing(degrees: f32) -> V3 {
    let r = degrees.to_radians();
    [-r.sin(), 0.0, r.cos()]
}

pub(crate) fn of(p: [f64; 3]) -> V3 {
    [p[0] as f32, p[1] as f32, p[2] as f32]
}
