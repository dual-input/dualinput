//! A point of the aircraft's frame placed in the world, and a figure's attitude from the
//! aircraft's, as `Figure` writes each figure's object.

/// WGS 84's equatorial radius and flattening.
const EQUATOR_M: f64 = 6_378_137.0;
const FLATTENING: f64 = 1.0 / 298.257_223_563;
const FT: f64 = 0.3048;

/// The aircraft's pose, or an object's, as the sim reads and writes it: degrees, altitude in
/// feet MSL, heading true, and pitch and bank negative for nose up and right wing down
/// (measured on MSFS 2024, 2026-10-03, record/areas/avatars/log.md, "Nose up and right wing
/// down are negative").
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct Pose {
    pub(crate) latitude: f64,
    pub(crate) longitude: f64,
    pub(crate) altitude: f64,
    pub(crate) heading: f64,
    pub(crate) pitch: f64,
    pub(crate) bank: f64,
}

impl Pose {
    /// This pose led by `k` frames of the change from `last`, as p16 and p25 held a figure in
    /// a moving aircraft with a lead of 1 (measured on MSFS 2024, 2026-10-03,
    /// record/areas/avatars/log.md, "Over three minutes of flying, leads of 0.75 and 1 frame
    /// both hold the figure").
    pub(crate) fn led(&self, last: &Pose, k: f64) -> Pose {
        let turn = |a: f64, b: f64| (a - b + 540.0).rem_euclid(360.0) - 180.0;
        Pose {
            latitude: self.latitude + (self.latitude - last.latitude) * k,
            longitude: self.longitude + (self.longitude - last.longitude) * k,
            altitude: self.altitude + (self.altitude - last.altitude) * k,
            heading: (self.heading + turn(self.heading, last.heading) * k).rem_euclid(360.0),
            pitch: self.pitch + (self.pitch - last.pitch) * k,
            bank: self.bank + (self.bank - last.bank) * k,
        }
    }
}

/// The rotation from a body's axes, forward, right, and down, to north, east, and down,
/// turned by heading, then pitch up, then bank right.
fn body_to_ned(p: &Pose) -> [[f64; 3]; 3] {
    let (ps, th, ph) = (
        p.heading.to_radians(),
        -p.pitch.to_radians(),
        -p.bank.to_radians(),
    );
    let (cps, sps, cth, sth, cph, sph) =
        (ps.cos(), ps.sin(), th.cos(), th.sin(), ph.cos(), ph.sin());
    [
        [
            cth * cps,
            sph * sth * cps - cph * sps,
            cph * sth * cps + sph * sps,
        ],
        [
            cth * sps,
            sph * sth * sps + cph * cps,
            cph * sth * sps - sph * cps,
        ],
        [-sth, sph * cth, cph * cth],
    ]
}

/// The pose of an object at `at` in the aircraft's frame, x left, y up, z forward, turned
/// `facing` degrees right of the aircraft's nose, by WGS 84's radii at the aircraft's
/// latitude. `world_to_frame` in the avatars crate's ray.rs turns a point the other way, so
/// change both together.
pub(crate) fn place(a: &Pose, at: [f32; 3], facing: f32) -> Pose {
    let r = body_to_ned(a);
    let body = [f64::from(at[2]), -f64::from(at[0]), -f64::from(at[1])];
    let ned = r.map(|[x, y, z]| x * body[0] + y * body[1] + z * body[2]);
    let e2 = FLATTENING * (2.0 - FLATTENING);
    let s = a.latitude.to_radians().sin();
    let w = (1.0 - e2 * s * s).sqrt();
    let meridian = EQUATOR_M * (1.0 - e2) / (w * w * w);
    let normal = EQUATOR_M / w;
    // The figure's axes: the aircraft's, turned about its own down axis by the facing.
    let (cf, sf) = (
        f64::from(facing).to_radians().cos(),
        f64::from(facing).to_radians().sin(),
    );
    let [n, e, d] = r.map(|[x, y, z]| [x * cf + y * sf, -x * sf + y * cf, z]);
    let heading = e[0].atan2(n[0]).to_degrees().rem_euclid(360.0);
    let theta = (-d[0]).clamp(-1.0, 1.0).asin();
    let phi = d[1].atan2(d[2]);
    Pose {
        latitude: a.latitude + (ned[0] / meridian).to_degrees(),
        longitude: a.longitude + (ned[1] / (normal * a.latitude.to_radians().cos())).to_degrees(),
        altitude: a.altitude - ned[2] / FT,
        heading,
        pitch: -theta.to_degrees(),
        bank: -phi.to_degrees(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_point_ahead_of_an_aircraft_facing_east_lies_east_and_turns_with_it() {
        let a = Pose {
            latitude: 47.0,
            longitude: 8.0,
            altitude: 1_000.0,
            heading: 90.0,
            ..Pose::default()
        };
        let p = place(&a, [0.0, 2.0, 10.0], 30.0);
        assert!((p.latitude - 47.0).abs() < 1e-9);
        assert!(p.longitude > 8.0);
        assert!((p.altitude - (1_000.0 + 2.0 / FT)).abs() < 1e-6);
        assert!((p.heading - 120.0).abs() < 1e-6, "{p:?}");
        assert!(p.pitch.abs() < 1e-9 && p.bank.abs() < 1e-9);
    }

    #[test]
    fn a_figure_facing_ahead_keeps_the_aircrafts_attitude() {
        let a = Pose {
            heading: 200.0,
            pitch: -8.0,
            bank: 15.0,
            ..Pose::default()
        };
        let p = place(&a, [0.0; 3], 0.0);
        assert!((p.heading - 200.0).abs() < 1e-6);
        assert!((p.pitch + 8.0).abs() < 1e-6);
        assert!((p.bank - 15.0).abs() < 1e-6);
    }

    #[test]
    fn a_lead_carries_the_change_on_across_north() {
        let last = Pose {
            heading: 359.0,
            ..Pose::default()
        };
        let now = Pose {
            heading: 1.0,
            ..Pose::default()
        };
        assert!((now.led(&last, 1.0).heading - 3.0).abs() < 1e-9);
    }
}
