//! The seat the scripts sit the figure in, laid out as a profile's `seats` gives one
//! (record/areas/profiles/01-format-and-delivery.md, "Seats"). The program reads no profile,
//! so it starts the seat at the mirror of the cockpit's `PILOT_1` node, the copilot's, the page
//! tunes it, and serve.ts hands it over in seat.json.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Seat {
    /// The hip, in the aircraft's frame: x left, y up, z forward, in meters.
    pub hip: [f32; 3],
    /// Up and forward from the hip, in meters, in the seat's own frame.
    pub knees: [f32; 2],
    pub feet: [f32; 2],
    pub eye: [f32; 2],
    /// Degrees right of the nose.
    pub facing: f32,
}

impl Seat {
    /// A seat whose hip is `hip`, with the knees, feet, and eye of 01-format-and-delivery's
    /// example, a starting point the page tunes.
    pub fn at(hip: [f32; 3]) -> Seat {
        Seat {
            hip,
            knees: [-0.044, 0.218],
            feet: [-0.198, 0.51],
            eye: [0.643, -0.054],
            facing: 0.0,
        }
    }

    /// The direction the seat faces, in the aircraft's frame.
    pub fn forward(&self) -> [f32; 3] {
        let f = self.facing.to_radians();
        [-f.sin(), 0.0, f.cos()]
    }

    /// The seat's eye in the aircraft's frame, as avatars' seats.rs places it: up from the hip,
    /// then forward along the facing.
    pub fn eye_point(&self) -> [f32; 3] {
        let [up, forward] = self.eye;
        let f = self.forward();
        [
            self.hip[0] + f[0] * forward,
            self.hip[1] + up,
            self.hip[2] + f[2] * forward,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_eye_sits_up_from_the_hip_and_forward_along_the_facing() {
        let mut seat = Seat::at([0.3, 0.1, 0.0]);
        seat.eye = [0.6, 0.1];
        seat.facing = 90.0;
        let [x, y, z] = seat.eye_point();
        assert!(
            (x - 0.2).abs() < 1e-6,
            "facing right moves the eye right, to lower x: {x}"
        );
        assert!((y - 0.7).abs() < 1e-6 && z.abs() < 1e-6);
    }
}
