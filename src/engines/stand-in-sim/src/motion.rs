//! How the stand-in's aircraft moves: each frame by its velocities, as the sim's does, with
//! each freeze holding its part of the pose and none of them the velocities, as the sim's
//! freezes held a Baron's pose while its velocities ran on (measured on MSFS 2024,
//! 2026-10-03, record/areas/flight-model/log.md, "Freezing holds the pose but not the
//! velocities"). So a leading aircraft's samples move, and a follower let go flies on from the
//! velocities last written (record/areas/build/02-testing.md, "What it models").
//!
//! The stand-in has no flight model: nothing changes a velocity but a write, so an aircraft
//! flies straight on at the speed it was given, or turns at the rate it was given.

use crate::Aircraft;

/// WGS 84's equatorial radius and flattening, as `Figure` places a figure by them in
/// src/features/avatars/routines/src/earth.rs.
const EQUATOR_M: f64 = 6_378_137.0;
const FLATTENING: f64 = 1.0 / 298.257_223_563;
const FT: f64 = 0.3048;
/// A foot a second in knots, of 1,852m an hour.
const FT_PER_S_IN_KNOTS: f64 = FT * 3_600.0 / 1_852.0;

/// Moves `aircraft` on by `seconds`. Its table holds the pose in degrees and feet, the body
/// velocities in feet per second, x right, y up, and z forward, and the rotation velocities
/// in radians per second, x about the pitch axis, y about the heading's, and z about the
/// bank's, each in the sign its angle counts in. `E:SIMULATION RATE` multiplies the motion,
/// as a raised rate moves the sim's aircraft that many times faster than its velocity, which
/// is unverified (record/areas/flight-model/01-flight-model-sync.md, "Its first frames"); a
/// rate nothing set counts as 1.
pub(crate) fn fly(aircraft: &mut Aircraft, seconds: f64) {
    let rate = match aircraft.number("SIMULATION RATE") {
        r if r > 0.0 => r,
        _ => 1.0,
    };
    let dt = seconds * rate;
    let (heading, pitch, bank) = (
        aircraft.number("PLANE HEADING DEGREES TRUE"),
        aircraft.number("PLANE PITCH DEGREES"),
        aircraft.number("PLANE BANK DEGREES"),
    );
    let [right, up, forward] =
        ["X", "Y", "Z"].map(|a| aircraft.number(&format!("VELOCITY BODY {a}")));
    let [north, east, down] = to_ned(heading, pitch, bank, [forward, right, -up]);
    // The sim gives the velocity over the ground too, which `Follow` reads as it starts, and
    // its speed, which the traffic host reads in knots.
    aircraft.set_number("VELOCITY WORLD X", east);
    aircraft.set_number("VELOCITY WORLD Y", -down);
    aircraft.set_number("VELOCITY WORLD Z", north);
    aircraft.set_number("GROUND VELOCITY", north.hypot(east) * FT_PER_S_IN_KNOTS);

    if aircraft.number("IS LATITUDE LONGITUDE FREEZE ON") == 0.0 && (north != 0.0 || east != 0.0) {
        let latitude = aircraft.number("PLANE LATITUDE");
        let (meridian, normal) = radii(latitude);
        let north_m = north * FT * dt;
        let east_m = east * FT * dt;
        aircraft.set_number(
            "PLANE LATITUDE",
            latitude + (north_m / meridian).to_degrees(),
        );
        let turn = (east_m / (normal * latitude.to_radians().cos())).to_degrees();
        let longitude = aircraft.number("PLANE LONGITUDE") + turn;
        aircraft.set_number(
            "PLANE LONGITUDE",
            (longitude + 540.0).rem_euclid(360.0) - 180.0,
        );
    }
    if aircraft.number("IS ALTITUDE FREEZE ON") == 0.0 && down != 0.0 {
        let altitude = aircraft.number("PLANE ALTITUDE");
        aircraft.set_number("PLANE ALTITUDE", altitude - down * dt);
    }
    if aircraft.number("IS ATTITUDE FREEZE ON") == 0.0 {
        let [about_pitch, about_heading, about_bank] =
            ["X", "Y", "Z"].map(|a| aircraft.number(&format!("ROTATION VELOCITY BODY {a}")));
        if about_heading != 0.0 {
            let to = heading + (about_heading * dt).to_degrees();
            aircraft.set_number("PLANE HEADING DEGREES TRUE", to.rem_euclid(360.0));
        }
        if about_pitch != 0.0 {
            aircraft.set_number(
                "PLANE PITCH DEGREES",
                pitch + (about_pitch * dt).to_degrees(),
            );
        }
        if about_bank != 0.0 {
            aircraft.set_number("PLANE BANK DEGREES", bank + (about_bank * dt).to_degrees());
        }
    }
}

/// A vector along the body's forward, right, and down axes, turned north, east, and down by
/// the heading, then the pitch, then the bank, each in degrees, pitch and bank negative for
/// nose up and right wing down, as the sim has them.
fn to_ned(heading: f64, pitch: f64, bank: f64, [f, r, d]: [f64; 3]) -> [f64; 3] {
    let (ps, th, ph) = (
        heading.to_radians(),
        -pitch.to_radians(),
        -bank.to_radians(),
    );
    let (cps, sps, cth, sth, cph, sph) =
        (ps.cos(), ps.sin(), th.cos(), th.sin(), ph.cos(), ph.sin());
    [
        cth * cps * f + (sph * sth * cps - cph * sps) * r + (cph * sth * cps + sph * sps) * d,
        cth * sps * f + (sph * sth * sps + cph * cps) * r + (cph * sth * sps - sph * cps) * d,
        -sth * f + sph * cth * r + cph * cth * d,
    ]
}

/// WGS 84's meridian and normal radii at `latitude`, in meters.
fn radii(latitude: f64) -> (f64, f64) {
    let e2 = FLATTENING * (2.0 - FLATTENING);
    let s = latitude.to_radians().sin();
    let w = (1.0 - e2 * s * s).sqrt();
    (EQUATOR_M * (1.0 - e2) / (w * w * w), EQUATOR_M / w)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flying_east() -> Aircraft {
        let mut a = Aircraft::default();
        a.set_number("PLANE LATITUDE", 47.0);
        a.set_number("PLANE LONGITUDE", 8.0);
        a.set_number("PLANE ALTITUDE", 5_000.0);
        a.set_number("PLANE HEADING DEGREES TRUE", 90.0);
        // 150 kt, climbing at 10 ft/s.
        a.set_number("VELOCITY BODY Z", 253.2);
        a.set_number("VELOCITY BODY Y", 10.0);
        a
    }

    #[test]
    fn an_aircraft_flies_on_by_its_velocities() {
        let mut a = flying_east();
        fly(&mut a, 2.0);
        assert!((a.number("PLANE LATITUDE") - 47.0).abs() < 1e-9);
        let east_m = (a.number("PLANE LONGITUDE") - 8.0).to_radians()
            * radii(47.0).1
            * 47f64.to_radians().cos();
        assert!((east_m - 253.2 * FT * 2.0).abs() < 0.01, "{east_m}");
        assert!((a.number("PLANE ALTITUDE") - 5_020.0).abs() < 1e-9);
        assert!((a.number("VELOCITY WORLD X") - 253.2).abs() < 1e-9);
    }

    #[test]
    fn each_freeze_holds_its_part_of_the_pose() {
        let mut a = flying_east();
        a.set_number("ROTATION VELOCITY BODY Y", 0.1);
        a.set_number("IS LATITUDE LONGITUDE FREEZE ON", 1.0);
        a.set_number("IS ATTITUDE FREEZE ON", 1.0);
        fly(&mut a, 1.0);
        assert_eq!(a.number("PLANE LONGITUDE"), 8.0);
        assert_eq!(a.number("PLANE HEADING DEGREES TRUE"), 90.0);
        assert!((a.number("PLANE ALTITUDE") - 5_010.0).abs() < 1e-9);
        assert_eq!(
            a.number("VELOCITY BODY Z"),
            253.2,
            "a freeze leaves the velocities"
        );
    }

    #[test]
    fn a_raised_rate_moves_it_that_many_times_faster() {
        let (mut a, mut b) = (flying_east(), flying_east());
        b.set_number("SIMULATION RATE", 2.0);
        fly(&mut a, 2.0);
        fly(&mut b, 1.0);
        assert!((a.number("PLANE LONGITUDE") - b.number("PLANE LONGITUDE")).abs() < 1e-12);
    }

    #[test]
    fn it_turns_at_its_rotation_velocity() {
        let mut a = flying_east();
        a.set_number("ROTATION VELOCITY BODY Y", std::f64::consts::PI / 60.0);
        fly(&mut a, 10.0);
        assert!((a.number("PLANE HEADING DEGREES TRUE") - 120.0).abs() < 1e-9);
    }
}
