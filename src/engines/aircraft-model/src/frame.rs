//! The ray a cast takes, from the sim's camera through the cursor, and the world's points
//! turned into the aircraft's frame, x left, y up, and z forward in meters from its
//! reference point (record/areas/avatars/01-avatars.md, "The ray").
//!
//! In the aircraft, the camera comes in `SIMOBJECT`'s referential, already in the aircraft's
//! frame. On foot it comes in `WORLD`'s, which landed a click within 1cm where `SIMOBJECT`
//! landed it within 7cm, turned into the aircraft's frame through the aircraft's pose, which
//! stands still while its pilot walks (measured on MSFS 2024, 2026-10-03,
//! record/areas/avatars/log.md, "On foot outside, the click ray lands within 1cm on the
//! exterior").

use ray_cast::{Ray, Vec3};

/// WGS 84's equatorial radius and flattening.
const EQUATOR_M: f64 = 6_378_137.0;
const FLATTENING: f64 = 1.0 / 298.257_223_563;
const FT: f64 = 0.3048;

/// Where the sim's camera is and where it looks, as `SimConnect_CameraGet` gives it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct View {
    /// In `SIMOBJECT`'s referential, meters in the aircraft's frame; in `WORLD`'s, latitude
    /// and longitude in degrees and altitude in meters.
    pub position: [f64; 3],
    /// In degrees.
    pub pitch: f32,
    pub yaw: f32,
    /// The view's height, in radians.
    pub fov: f64,
}

/// The aircraft's pose as SimConnect reads it: degrees, altitude in feet MSL, heading true,
/// and pitch and bank negative for nose up and right wing down (measured on MSFS 2024,
/// 2026-10-03, record/areas/avatars/log.md, "Nose up and right wing down are negative").
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AircraftPose {
    pub latitude: f64,
    pub longitude: f64,
    pub altitude: f64,
    pub heading: f64,
    pub pitch: f64,
    pub bank: f64,
}

/// The ray from a `SIMOBJECT` camera through the cursor at `x` and `y`, −1 to 1 right and up,
/// in a view `aspect` wide for each unit high: `fov` is the view's height, the camera's
/// pitch turns the ray down as it grows, and its yaw turns it right, the signs p20 measured,
/// with which clicks landed within 2mm at two zooms and two window shapes (measured on MSFS
/// 2024, 2026-10-03, record/areas/avatars/log.md, "The ray through the cursor needs no
/// calibration").
pub fn cockpit(view: &View, x: f32, y: f32, aspect: f32) -> Ray {
    let tv = (view.fov as f32 / 2.0).tan();
    let (mut f, mut r, mut u) = (1.0, x * tv * aspect, y * tv);
    let p = (-view.pitch).to_radians();
    (f, u) = (f * p.cos() - u * p.sin(), f * p.sin() + u * p.cos());
    let w = view.yaw.to_radians();
    (f, r) = (f * w.cos() - r * w.sin(), f * w.sin() + r * w.cos());
    Ray {
        origin: view.position.map(|c| c as f32),
        direction: unit([-r, u, f]),
    }
}

/// The ray from a `WORLD` camera through the cursor, in the aircraft's frame: its yaw is the
/// camera's true heading and its pitch the angle below the horizon (same entry as the
/// module's).
pub fn on_foot(view: &View, x: f32, y: f32, aspect: f32, aircraft: &AircraftPose) -> Ray {
    let heading = f64::from(view.yaw).to_radians();
    let rise = -f64::from(view.pitch).to_radians();
    let forward = [
        rise.cos() * heading.cos(),
        rise.cos() * heading.sin(),
        -rise.sin(),
    ];
    let right = [-heading.sin(), heading.cos(), 0.0];
    let up = [
        right[1] * forward[2] - right[2] * forward[1],
        right[2] * forward[0] - right[0] * forward[2],
        right[0] * forward[1] - right[1] * forward[0],
    ];
    let tv = (view.fov / 2.0).tan();
    let (sx, sy) = (f64::from(x) * tv * f64::from(aspect), f64::from(y) * tv);
    let ned: [f64; 3] = std::array::from_fn(|k| forward[k] + right[k] * sx + up[k] * sy);
    let [lat, lon, alt_m] = view.position;
    Ray {
        origin: world_to_frame(aircraft, lat, lon, alt_m / FT),
        direction: unit(ned_to_frame(aircraft, ned)),
    }
}

/// A point given by latitude, longitude, and altitude in feet, in the aircraft's frame, by
/// WGS 84's radii at the aircraft's latitude, which accounted for the whole of the 14cm a
/// sphere put a point 26m forward of the A350's reference point off (measured on MSFS 2024,
/// 2026-10-04, record/areas/avatars/log.md, "The module's sphere earth"). `place` in the
/// avatars routines' earth.rs turns a point the other way, so change both together.
pub fn world_to_frame(a: &AircraftPose, lat: f64, lon: f64, alt_ft: f64) -> Vec3 {
    let (meridian, normal) = radii(a.latitude);
    let north = (lat - a.latitude).to_radians() * meridian;
    let east = (lon - a.longitude).to_radians() * normal * a.latitude.to_radians().cos();
    let down = -(alt_ft - a.altitude) * FT;
    ned_to_frame(a, [north, east, down])
}

/// The direction a seat or figure faces, `degrees` from the nose, positive to the right,
/// which is toward −x.
pub fn facing(degrees: f32) -> Vec3 {
    let r = degrees.to_radians();
    [-r.sin(), 0.0, r.cos()]
}

/// A seat's eye, as a profile's seat gives it: `up` above its hip and `forward` along its
/// facing.
pub fn eye(hip: Vec3, up: f32, forward: f32, facing_degrees: f32) -> Vec3 {
    let f = facing(facing_degrees);
    [
        hip[0] + f[0] * forward,
        hip[1] + up,
        hip[2] + f[2] * forward,
    ]
}

/// The meridian's and the prime vertical's radii of curvature at `latitude`, in meters.
fn radii(latitude: f64) -> (f64, f64) {
    let e2 = FLATTENING * (2.0 - FLATTENING);
    let s = latitude.to_radians().sin();
    let w = (1.0 - e2 * s * s).sqrt();
    (EQUATOR_M * (1.0 - e2) / (w * w * w), EQUATOR_M / w)
}

/// A direction north, east, and down, in the aircraft's frame: the transpose of the
/// rotation from the aircraft's body, forward, right, and down, to north, east, and down,
/// turned by heading, then pitch up, then bank right.
fn ned_to_frame(a: &AircraftPose, v: [f64; 3]) -> Vec3 {
    let r = body_to_ned(a);
    let b: [f64; 3] = std::array::from_fn(|j| r[0][j] * v[0] + r[1][j] * v[1] + r[2][j] * v[2]);
    [-b[1] as f32, -b[2] as f32, b[0] as f32]
}

fn body_to_ned(a: &AircraftPose) -> [[f64; 3]; 3] {
    let (ps, th, ph) = (
        a.heading.to_radians(),
        -a.pitch.to_radians(),
        -a.bank.to_radians(),
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

/// `a` scaled to length 1, or `a` itself when it has none.
fn unit(a: Vec3) -> Vec3 {
    let l = (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt();
    if l > 0.0 { a.map(|c| c / l) } else { a }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Vec3, b: Vec3) -> bool {
        (0..3).map(|k| (a[k] - b[k]).powi(2)).sum::<f32>().sqrt() < 1e-4
    }

    fn look(view: &View) -> Vec3 {
        cockpit(view, 0.0, 0.0, 1.0).direction
    }

    #[test]
    fn the_cockpit_ray_through_the_center_runs_along_the_look() {
        let mut view = View {
            position: [0.3, 0.8, -0.1],
            fov: 0.9,
            ..View::default()
        };
        assert!(close(look(&view), [0.0, 0.0, 1.0]));
        view.yaw = 90.0;
        assert!(
            close(look(&view), [-1.0, 0.0, 0.0]),
            "yaw turns it right, to −x"
        );
        view.yaw = 0.0;
        view.pitch = 30.0;
        let d = look(&view);
        assert!(d[1] < -0.49 && d[2] > 0.86, "pitch turns it down: {d:?}");
        let up = cockpit(&view, 0.0, 1.0, 16.0 / 9.0).direction;
        assert!(up[1] > d[1], "the cursor's top is above the center");
    }

    #[test]
    fn a_point_north_of_an_aircraft_facing_north_is_ahead_and_one_east_facing_east_too() {
        let a = AircraftPose {
            latitude: 47.0,
            longitude: 8.0,
            altitude: 1_000.0,
            ..AircraftPose::default()
        };
        let (meridian, _) = radii(47.0);
        let ahead = world_to_frame(&a, 47.0 + (10.0 / meridian).to_degrees(), 8.0, 1_000.0);
        assert!(close(ahead, [0.0, 0.0, 10.0]), "{ahead:?}");
        let above = world_to_frame(&a, 47.0, 8.0, 1_000.0 + 10.0 / FT);
        assert!(close(above, [0.0, 10.0, 0.0]), "{above:?}");
        let east = AircraftPose { heading: 90.0, ..a };
        let (_, normal) = radii(47.0);
        let dlon = (10.0 / (normal * 47f64.to_radians().cos())).to_degrees();
        assert!(close(
            world_to_frame(&east, 47.0, 8.0 + dlon, 1_000.0),
            [0.0, 0.0, 10.0]
        ));
    }

    #[test]
    fn a_nose_up_aircraft_sees_the_horizon_below_its_nose() {
        let a = AircraftPose {
            pitch: -10.0,
            ..AircraftPose::default()
        };
        let d = ned_to_frame(&a, [1.0, 0.0, 0.0]);
        assert!(d[1] < 0.0 && d[2] > 0.98, "{d:?}");
    }

    #[test]
    fn a_seat_eye_is_up_and_forward_from_its_hip_along_its_facing() {
        let e = eye([0.31, 0.12, 1.4], 0.63, -0.05, 0.0);
        assert!(close(e, [0.31, 0.75, 1.35]), "{e:?}");
        let turned = eye([0.0, 0.0, 0.0], 0.0, 1.0, 90.0);
        assert!(
            close(turned, [-1.0, 0.0, 0.0]),
            "facing right is −x: {turned:?}"
        );
    }
}
