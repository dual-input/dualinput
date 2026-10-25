//! The figure's place as `Figure` wrote it on the figure's object, turned back into the
//! aircraft's frame, so the page draws the figure where the sim would.
//!
//! The scripts hold the aircraft at latitude 0, longitude 0, altitude 0, heading north, and
//! level, where avatars-routines' earth.rs places a point by WGS 84's radii at the equator:
//! the meridian's a(1 − e²) and the normal's a. So this undoes that placing exactly, and a
//! change to earth.rs's radii changes these.

/// WGS 84's equatorial radius and flattening, as earth.rs gives them.
const EQUATOR_M: f64 = 6_378_137.0;
const FLATTENING: f64 = 1.0 / 298.257_223_563;
const FT: f64 = 0.3048;

/// Where a figure is in the aircraft's frame, x left, y up, z forward, in meters, and its
/// heading right of the nose, pitch, and bank in degrees, the sim's way round: nose up and
/// right wing down negative.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placed {
    pub at: [f32; 3],
    pub facing: f32,
    pub pitch: f32,
    pub bank: f32,
}

/// The aircraft's frame's place for an object at these `A:PLANE` values, the aircraft held as
/// above.
pub fn in_aircraft(
    latitude: f64,
    longitude: f64,
    altitude: f64,
    heading: f64,
    pitch: f64,
    bank: f64,
) -> Placed {
    let e2 = FLATTENING * (2.0 - FLATTENING);
    let north = latitude.to_radians() * EQUATOR_M * (1.0 - e2);
    let east = longitude.to_radians() * EQUATOR_M;
    let up = altitude * FT;
    Placed {
        at: [-east as f32, up as f32, north as f32],
        facing: ((heading + 180.0).rem_euclid(360.0) - 180.0) as f32,
        pitch: pitch as f32,
        bank: bank as f32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_meter_north_east_and_up_is_a_meter_forward_right_and_up() {
        let e2 = FLATTENING * (2.0 - FLATTENING);
        let lat = (1.0 / (EQUATOR_M * (1.0 - e2))).to_degrees();
        let lon = (1.0 / EQUATOR_M).to_degrees();
        let p = in_aircraft(lat, lon, 1.0 / FT, 350.0, 0.0, 0.0);
        let [x, y, z] = p.at;
        assert!(
            (x + 1.0).abs() < 1e-6 && (y - 1.0).abs() < 1e-6 && (z - 1.0).abs() < 1e-6,
            "{p:?}"
        );
        assert!(
            (p.facing + 10.0).abs() < 1e-4,
            "350° is 10° left of the nose: {p:?}"
        );
    }
}
