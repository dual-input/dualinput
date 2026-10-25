//! Which seat this pilot's camera takes and holds (record/areas/avatars/01-avatars.md, "A
//! seat").

use profile_engine::features::avatars::Seat;

use crate::v3::{self, V3};

/// A seat's take radius unless the profile gives one (user, 2026-10-17).
const TAKE_RADIUS: f32 = 0.4;
/// A camera this far behind a seat's hip, along its facing, gives the seat up, inside.
const BEHIND: f32 = 0.8;
/// On a machine with no model, the camera is inside while it's within the box around every
/// seat's eye grown by this much.
const GROW: f32 = 1.0;

/// A seat as the frame lays it out.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Place {
    pub(crate) key: String,
    pub(crate) name: String,
    pub(crate) hip: V3,
    pub(crate) knees: [f32; 2],
    pub(crate) feet: [f32; 2],
    pub(crate) facing: f32,
    /// The eye, in the aircraft's frame: up and forward from the hip, turned by the facing.
    pub(crate) eye: V3,
    pub(crate) radius: f32,
}

impl Place {
    pub(crate) fn of(seat: &Seat) -> Place {
        let hip = v3::of(seat.hip);
        let facing = seat.facing as f32;
        Place {
            key: seat.key.clone(),
            name: seat.name.clone(),
            hip,
            knees: [seat.knees[0] as f32, seat.knees[1] as f32],
            feet: [seat.feet[0] as f32, seat.feet[1] as f32],
            facing,
            eye: aircraft_model::frame::eye(hip, seat.eye[0] as f32, seat.eye[1] as f32, facing),
            radius: seat.take_radius.map_or(TAKE_RADIUS, |r| r as f32),
        }
    }

    /// Left of the centerline, which picks the yoke in front of it and the hand rules.
    pub(crate) fn left(&self) -> bool {
        self.hip[0] > 0.0
    }

    /// Where the seat's figure looks in an outside view: from its eye along its facing.
    pub(crate) fn forward(&self) -> V3 {
        v3::facing(self.facing)
    }
}

/// The seat whose take radius holds `camera` and whose eye is nearest, of those `held` says
/// no other figure holds.
pub(crate) fn take(seats: &[Place], camera: V3, held: &dyn Fn(&str) -> bool) -> Option<usize> {
    nearest(seats, camera).filter(|&i| !held(&seats[i].key))
}

/// The seat whose take radius holds `camera` and whose eye is nearest, held or not: where the
/// camera sits, so where two radii overlap the border is the plane halfway between the eyes.
pub(crate) fn nearest(seats: &[Place], camera: V3) -> Option<usize> {
    seats
        .iter()
        .enumerate()
        .map(|(i, s)| (i, v3::distance(s.eye, camera), s.radius))
        .filter(|&(_, d, r)| d <= r)
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(i, _, _)| i)
}

/// Whether a camera inside keeps the seat: until it's more than 0.8m behind the hip.
pub(crate) fn keeps(seat: &Place, camera: V3) -> bool {
    v3::dot(v3::sub(camera, seat.hip), seat.forward()) >= -BEHIND
}

/// Whether `camera` is inside the aircraft, by the box around every seat's eye grown by 1m,
/// for a machine with no model.
pub(crate) fn inside_seats(seats: &[Place], camera: V3) -> bool {
    if seats.is_empty() {
        return false;
    }
    (0..3).all(|k| {
        let lo = seats.iter().map(|s| s.eye[k]).fold(f32::MAX, f32::min) - GROW;
        let hi = seats.iter().map(|s| s.eye[k]).fold(f32::MIN, f32::max) + GROW;
        (lo..=hi).contains(&camera[k])
    })
}

/// Of two pilots whose poses name one seat, whether this one keeps it: the PF does, or else
/// the lower pilot ID.
pub(crate) fn keeps_against(me: [u8; 16], other: [u8; 16], pf: Option<[u8; 16]>) -> bool {
    match pf {
        Some(pf) if pf == me => true,
        Some(pf) if pf == other => false,
        _ => me < other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The 58P's two seats, as the profile's tests give them.
    fn seats() -> Vec<Place> {
        let seat = |key: &str, x: f64| Seat {
            key: key.into(),
            name: key.into(),
            hip: [x, 0.12, 1.4],
            knees: [0.05, 0.45],
            feet: [-0.42, 0.62],
            eye: [0.63, -0.05],
            facing: 0.0,
            take_radius: None,
            only: Vec::new(),
        };
        vec![
            Place::of(&seat("pilot", 0.31)),
            Place::of(&seat("copilot", -0.31)),
        ]
    }

    #[test]
    fn a_seat_eye_is_up_and_forward_from_its_hip() {
        let s = &seats()[0];
        assert!(
            v3::distance(s.eye, [0.31, 0.75, 1.35]) < 1e-5,
            "{:?}",
            s.eye
        );
        assert!(s.left());
    }

    /// 01-avatars' case: a camera between the two seats, inside both radii, takes the seat
    /// whose eye is nearer, and with that seat held, nothing.
    #[test]
    fn a_camera_between_two_seats_takes_the_nearer_unless_another_holds_it() {
        let mut seats = seats();
        for s in &mut seats {
            s.radius = 0.5;
        }
        let between = [0.05, 0.75, 1.35];
        assert_eq!(take(&seats, between, &|_| false), Some(0));
        assert_eq!(take(&seats, between, &|k| k == "pilot"), None);
        assert_eq!(nearest(&seats, between), Some(0));
        assert_eq!(take(&seats, [0.0, 3.0, 0.0], &|_| false), None);
    }

    /// 01-avatars' case: a camera 0.9m behind the hip inside the cabin gives the seat up.
    #[test]
    fn a_camera_more_than_0_8m_behind_the_hip_gives_the_seat_up() {
        let s = &seats()[0];
        assert!(keeps(s, [0.31, 0.75, 1.35]));
        assert!(keeps(s, [0.31, 0.75, 0.65]));
        assert!(!keeps(s, [0.31, 0.75, 0.5]));
        assert!(inside_seats(&seats(), [0.0, 0.8, 0.5]));
        assert!(!inside_seats(&seats(), [0.0, 0.8, -5.0]));
    }

    #[test]
    fn the_pf_keeps_a_seat_both_took_and_else_the_lower_pilot_id() {
        let (a, b) = ([1; 16], [2; 16]);
        assert!(keeps_against(a, b, None));
        assert!(!keeps_against(b, a, None));
        assert!(keeps_against(b, a, Some(b)));
        assert!(!keeps_against(a, b, Some(b)));
    }
}
