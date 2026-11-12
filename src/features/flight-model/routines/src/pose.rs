//! The arithmetic `Follow` draws by: a snapshot between two others, one carried on along a
//! line, one moved by a velocity over the ground, and the difference between two poses, which
//! it eases away.

use std::f64::consts::{PI, TAU};

use messages::flight_model::Snapshot;

/// WGS 84's equatorial radius and flattening, and a foot in meters, as `Figure` places a
/// figure by them in src/features/avatars/routines/src/earth.rs.
const EQUATOR_M: f64 = 6_378_137.0;
const FLATTENING: f64 = 1.0 / 298.257_223_563;
const FT: f64 = 0.3048;

/// WGS 84's meridian and normal radii at `latitude`, in radians, in meters.
fn radii(latitude: f64) -> (f64, f64) {
    let e2 = FLATTENING * (2.0 - FLATTENING);
    let s = latitude.sin();
    let w = (1.0 - e2 * s * s).sqrt();
    (EQUATOR_M * (1.0 - e2) / (w * w * w), EQUATOR_M / w)
}

/// From the angle `from` to the angle `to`, in radians, the shorter way round.
fn turn(to: f64, from: f64) -> f64 {
    (to - from + PI).rem_euclid(TAU) - PI
}

/// A longitude or a heading brought back within a turn of 0.
fn wrapped(angle: f64) -> f64 {
    turn(angle, 0.0)
}

fn mix(a: f64, b: f64, k: f64) -> f64 {
    a + (b - a) * k
}

/// `value` as the nearest whole number within `min` to `max`, and 0 for no number at all.
/// Rust compiles an `as` from a float to `trunc_sat`, which cargo-msfs's check of the module
/// refuses (measured with Rust 1.95, 2026-11-04), so this clamps the value itself, then
/// converts it unchecked.
pub(crate) fn whole(value: f64, min: i32, max: i32) -> i32 {
    if value.is_nan() {
        return 0;
    }
    let within = value.round().clamp(f64::from(min), f64::from(max));
    // SAFETY: `within` is a whole number in an `i32`'s range, which the clamp above made it.
    unsafe { within.to_int_unchecked::<i32>() }
}

/// A control surface's position, in Position 16k, as a snapshot holds it.
pub(crate) fn surface(value: f64) -> i16 {
    whole(value, i32::from(i16::MIN), i32::from(i16::MAX)) as i16
}

/// A brake's position, 0 to 32,767, as a snapshot holds it.
pub(crate) fn brake(value: f64) -> u16 {
    whole(value, 0, 32_767) as u16
}

/// The snapshot `k` of the way from `a` to `b`, each field along a straight line and each
/// angle the shorter way round, as FS Copilot's module draws its fields (read in the FS
/// Copilot fork, `FsCopilot.Bridge.Wasm/interpolators.h`).
pub(crate) fn between(a: &Snapshot, b: &Snapshot, k: f64) -> Snapshot {
    let angle = |a: f32, b: f32| {
        let a = f64::from(a);
        wrapped(a + turn(f64::from(b), a) * k) as f32
    };
    let line = |a: f32, b: f32| mix(f64::from(a), f64::from(b), k) as f32;
    let mut velocity = [0.0; 3];
    let mut rotation = [0.0; 3];
    for (out, (a, b)) in velocity.iter_mut().zip(a.velocity.iter().zip(b.velocity)) {
        *out = line(*a, b);
    }
    for (out, (a, b)) in rotation.iter_mut().zip(a.rotation.iter().zip(b.rotation)) {
        *out = line(*a, b);
    }
    let mut surfaces = [0; 3];
    for (out, (a, b)) in surfaces.iter_mut().zip(a.surfaces.iter().zip(b.surfaces)) {
        *out = surface(mix(f64::from(*a), f64::from(b), k));
    }
    let mut brakes = [0; 2];
    for (out, (a, b)) in brakes.iter_mut().zip(a.brakes.iter().zip(b.brakes)) {
        *out = brake(mix(f64::from(*a), f64::from(b), k));
    }
    Snapshot {
        lat: mix(a.lat, b.lat, k),
        lon: wrapped(a.lon + turn(b.lon, a.lon) * k),
        alt: mix(a.alt, b.alt, k),
        pitch: angle(a.pitch, b.pitch),
        bank: angle(a.bank, b.bank),
        heading: angle(a.heading, b.heading),
        velocity,
        rotation,
        surfaces,
        brakes,
        pad: 0,
    }
}

/// `s` with its position moved on along the line from `before` through `s`, `k` times that
/// line's length, and everything else as `s` has it. Carrying along the line through two
/// samples keeps a raised simulation rate, where carrying on the velocities would leave the
/// aircraft behind.
pub(crate) fn carried(before: &Snapshot, s: &Snapshot, k: f64) -> Snapshot {
    Snapshot {
        lat: s.lat + (s.lat - before.lat) * k,
        lon: wrapped(s.lon + turn(s.lon, before.lon) * k),
        alt: s.alt + (s.alt - before.alt) * k,
        ..*s
    }
}

/// `s` with its position moved by `velocity` over the ground, east, up, and north in feet per
/// second, for `seconds`.
pub(crate) fn moved(s: &Snapshot, [east, up, north]: [f64; 3], seconds: f64) -> Snapshot {
    let (meridian, normal) = radii(s.lat);
    Snapshot {
        lat: s.lat + north * FT * seconds / meridian,
        lon: wrapped(s.lon + east * FT * seconds / (normal * s.lat.cos())),
        alt: s.alt + up * seconds,
        ..*s
    }
}

/// How far one pose is from another: its six numbers, each less the other's.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct Offset {
    lat: f64,
    lon: f64,
    alt: f64,
    pitch: f64,
    bank: f64,
    heading: f64,
}

impl Offset {
    /// From `drawn` to `written`.
    pub(crate) fn from(drawn: &Snapshot, written: &Snapshot) -> Offset {
        let angle = |to: f32, from: f32| turn(f64::from(to), f64::from(from));
        Offset {
            lat: written.lat - drawn.lat,
            lon: turn(written.lon, drawn.lon),
            alt: written.alt - drawn.alt,
            pitch: angle(written.pitch, drawn.pitch),
            bank: angle(written.bank, drawn.bank),
            heading: angle(written.heading, drawn.heading),
        }
    }

    /// How far apart the two positions are, in meters, at the latitude `lat`.
    pub(crate) fn meters(&self, lat: f64) -> f64 {
        let (meridian, normal) = radii(lat);
        let north = self.lat * meridian;
        let east = self.lon * normal * lat.cos();
        let up = self.alt * FT;
        (north * north + east * east + up * up).sqrt()
    }

    /// `s` with `share` of the offset added to its pose.
    pub(crate) fn added(&self, s: &Snapshot, share: f64) -> Snapshot {
        let angle = |a: f32, by: f64| wrapped(f64::from(a) + by * share) as f32;
        Snapshot {
            lat: s.lat + self.lat * share,
            lon: wrapped(s.lon + self.lon * share),
            alt: s.alt + self.alt * share,
            pitch: angle(s.pitch, self.pitch),
            bank: angle(s.bank, self.bank),
            heading: angle(s.heading, self.heading),
            ..*s
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_angle_goes_the_shorter_way_round() {
        let a = Snapshot {
            heading: 6.2,
            lon: 3.1,
            ..Snapshot::default()
        };
        let b = Snapshot {
            heading: 0.1,
            lon: -3.1,
            ..Snapshot::default()
        };
        let half = between(&a, &b, 0.5);
        let across_north = wrapped(6.2 + turn(0.1, 6.2) / 2.0);
        assert!((f64::from(half.heading) - across_north).abs() < 1e-6);
        assert!(
            half.lon.abs() > 3.1,
            "across the antimeridian: {}",
            half.lon
        );
    }

    #[test]
    fn a_velocity_over_the_ground_moves_a_position_by_its_meters() {
        let s = Snapshot {
            lat: 0.8,
            lon: 0.1,
            alt: 1_000.0,
            ..Snapshot::default()
        };
        let to = moved(&s, [100.0, 10.0, -50.0], 2.0);
        let offset = Offset::from(&s, &to);
        let meters = ((200.0f64 * FT).powi(2) + (20.0 * FT).powi(2) + (100.0 * FT).powi(2)).sqrt();
        assert!((offset.meters(0.8) - meters).abs() < 0.01);
        assert_eq!(offset.added(&s, 1.0).alt, 1_020.0);
    }
}
