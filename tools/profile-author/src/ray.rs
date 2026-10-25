//! The ray from the camera through the cursor, and a seat's eye, each as avatars works it out
//! in src/features/avatars/core/src/ray.rs and seats.rs, which keep theirs inside the crate, so
//! change both together. Every point is in the aircraft's frame, in meters from its reference
//! point: x left, y up, z forward.

use aircraft_model::{Ray, Vec3};
use profile_engine::features::avatars::Seat;
use sim_client::message::Camera;

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
/// in a view `aspect` wide for each unit high: `fov` is the view's height, the camera's pitch
/// turns the ray down as it grows, and its yaw turns it right, the signs with which p20's
/// clicks landed within 2mm at two zooms and two window shapes (measured on MSFS 2024,
/// 2026-10-03, record/areas/avatars/log.md, "The ray through the cursor needs no
/// calibration").
pub fn cockpit(camera: &Camera, x: f32, y: f32, aspect: f32) -> Ray {
    let tv = (camera.fov as f32 / 2.0).tan();
    let (mut f, mut r, mut u) = (1.0, x * tv * aspect, y * tv);
    let p = (-camera.pitch).to_radians();
    (f, u) = (f * p.cos() - u * p.sin(), f * p.sin() + u * p.cos());
    let w = camera.yaw.to_radians();
    (f, r) = (f * w.cos() - r * w.sin(), f * w.sin() + r * w.cos());
    Ray {
        origin: of(camera.position),
        direction: unit([-r, u, f]),
    }
}

/// The direction a seat faces, `degrees` from the nose, positive to the right, which is
/// toward −x.
pub fn facing(degrees: f64) -> Vec3 {
    let r = (degrees as f32).to_radians();
    [-r.sin(), 0.0, r.cos()]
}

/// A seat's eye: up and forward from its hip, turned by its facing.
pub fn eye(seat: &Seat) -> Vec3 {
    let f = facing(seat.facing);
    let [up, forward] = [seat.eye[0] as f32, seat.eye[1] as f32];
    let hip = of(seat.hip);
    [
        hip[0] + f[0] * forward,
        hip[1] + up,
        hip[2] + f[2] * forward,
    ]
}

/// The eye a seat takes from a camera at `camera`: its height above the hip, and how far it
/// sits ahead of the hip along the seat's facing, since a seat's eye doesn't go sideways.
pub fn eye_at(seat: &Seat, camera: Vec3) -> [f64; 2] {
    let f = facing(seat.facing);
    let hip = of(seat.hip);
    let ahead = (camera[0] - hip[0]) * f[0] + (camera[2] - hip[2]) * f[2];
    [f64::from(camera[1] - hip[1]), f64::from(ahead)]
}

pub fn of(p: [f64; 3]) -> Vec3 {
    [p[0] as f32, p[1] as f32, p[2] as f32]
}

fn unit(a: Vec3) -> Vec3 {
    let l = (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt();
    if l > 0.0 {
        [a[0] / l, a[1] / l, a[2] / l]
    } else {
        a
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Vec3, b: Vec3) -> bool {
        (0..3).all(|k| (a[k] - b[k]).abs() < 1e-4)
    }

    #[test]
    fn the_ray_through_the_center_runs_along_the_look_with_avatars_signs() {
        let mut camera = Camera {
            position: [0.3, 0.8, -0.1],
            referential: 1,
            fov: 0.9,
            ..Camera::default()
        };
        assert!(close(
            cockpit(&camera, 0.0, 0.0, 1.0).direction,
            [0.0, 0.0, 1.0]
        ));
        camera.yaw = 90.0;
        assert!(
            close(cockpit(&camera, 0.0, 0.0, 1.0).direction, [-1.0, 0.0, 0.0]),
            "yaw turns it right, to −x"
        );
        camera.yaw = 0.0;
        camera.pitch = 30.0;
        let d = cockpit(&camera, 0.0, 0.0, 1.0).direction;
        assert!(d[1] < -0.49 && d[2] > 0.86, "pitch turns it down: {d:?}");
    }

    #[test]
    fn a_seats_eye_and_the_eye_a_camera_gives_it_agree() {
        let seat = Seat {
            key: "pilot".into(),
            name: "Pilot".into(),
            hip: [0.31, 0.12, 1.4],
            knees: [0.05, 0.45],
            feet: [-0.42, 0.62],
            eye: [0.63, -0.05],
            facing: 0.0,
            take_radius: None,
            only: Vec::new(),
        };
        assert!(close(eye(&seat), [0.31, 0.75, 1.35]));
        let [up, ahead] = eye_at(&seat, [0.25, 0.8, 1.5]);
        assert!((up - 0.68).abs() < 1e-5 && (ahead - 0.1).abs() < 1e-5);
    }
}
