//! The mouse, as the core helper hands it over: each press cast into the aircraft's model and
//! made a hand's target (record/areas/avatars/01-avatars.md, "A click").

use aircraft_model::{Hit, Ray, Scene, YokePart};
use core_helper_service::Mouse as Event;
use kernel::Cx;
use messages::avatars::Side;
use messages::core_helper::MouseKind;
use sim_service::Camera;
use simconnect_types::SIMCONNECT_POSITION_REFERENTIAL_WORLD;

use crate::hands::{self, Target};
use crate::v3::{self, V3};
use crate::{Avatars, ray};

/// A ray meets nothing farther than this, in meters: on foot the pilot clicked the exterior
/// from up to 11.3m (measured on MSFS 2024, 2026-10-03, record/areas/avatars/log.md, "On
/// foot outside, the click ray lands within 1cm on the exterior").
const MOST: f32 = 20.0;
/// A right press counts as a click when it came up within 300ms, with the cursor under 5px
/// and the mouse under 20 counts from where it went down, as p20, p25, and p27 judged it
/// (same log, "A quick, still right press is a click").
const RIGHT_WITHIN: u64 = 300_000;
const RIGHT_PIXELS: f32 = 5.0;
const RIGHT_COUNTS: u32 = 20;

#[derive(Default)]
pub(crate) struct Mouse {
    /// The view's width for each unit of its height, from the window's size.
    aspect: Option<f32>,
    press: Option<Press>,
}

struct Press {
    right: bool,
    x: f32,
    y: f32,
    at: u64,
    camera: Camera,
    /// Inside, a left press's drag glides along the plane of the surface it first met.
    plane: Option<(V3, V3)>,
}

pub(crate) fn on_mouse(me: &mut Avatars, event: Event, cx: &mut Cx) {
    if event.height > 0 {
        me.mouse.aspect = Some(event.width as f32 / event.height as f32);
    }
    let now = cx.now();
    let Some(camera) = me.sim.camera else {
        return;
    };
    match event.kind {
        MouseKind::LeftDown => {
            let hit = cast(me, &camera, event.x, event.y);
            let inside = hit.as_ref().is_some_and(|(_, s)| *s == Scene::Interior);
            me.mouse.press = Some(Press {
                right: false,
                x: event.x,
                y: event.y,
                at: now,
                camera,
                plane: hit
                    .as_ref()
                    .filter(|_| inside)
                    .map(|(h, _)| (h.point, h.normal)),
            });
            if let Some((hit, scene)) = hit {
                let (hand, target) = aim(me, &hit, scene, cx);
                me.hands.press(hand, target);
            }
        }
        MouseKind::Move => drag(me, &camera, event.x, event.y),
        MouseKind::LeftUp => {
            me.mouse.press = None;
            me.hands.release(now);
        }
        MouseKind::RightDown => {
            me.mouse.press = Some(Press {
                right: true,
                x: event.x,
                y: event.y,
                at: now,
                camera,
                plane: None,
            });
        }
        MouseKind::RightUp { travel } => {
            let Some(press) = me.mouse.press.take().filter(|p| p.right) else {
                return;
            };
            let moved = ((event.x - press.x) * event.width as f32 / 2.0)
                .hypot((event.y - press.y) * event.height as f32 / 2.0);
            let still = now.saturating_sub(press.at) <= RIGHT_WITHIN
                && moved < RIGHT_PIXELS
                && travel < RIGHT_COUNTS;
            if let Some((hit, scene)) = cast(me, &press.camera, press.x, press.y).filter(|_| still)
            {
                let (hand, target) = aim(me, &hit, scene, cx);
                me.hands.press(hand, target);
                me.hands.release(now);
            }
        }
        MouseKind::Wheel { .. } => {
            if let Some((hit, scene)) = cast(me, &camera, event.x, event.y) {
                let (hand, target) = aim(me, &hit, scene, cx);
                me.hands.notch(hand, target, now);
            }
        }
    }
}

/// The ray from the camera through the cursor, cast into the interior while the camera is
/// inside the aircraft, and into the exterior otherwise, with the model posed first.
fn cast(me: &mut Avatars, camera: &Camera, x: f32, y: f32) -> Option<(Hit, Scene)> {
    let aspect = me.mouse.aspect.unwrap_or(16.0 / 9.0);
    let on_foot = camera.referential == SIMCONNECT_POSITION_REFERENTIAL_WORLD as u32;
    let ray = if on_foot {
        ray::on_foot(camera, x, y, aspect, &me.sim.aircraft?)
    } else {
        ray::cockpit(camera, x, y, aspect)
    };
    let scene = if !on_foot && crate::camera_inside(me, camera) {
        Scene::Interior
    } else {
        Scene::Exterior
    };
    let model = me.model_mut()?;
    model.pose();
    let mut hit = model.cast(scene, &ray, MOST)?;
    // A surface met from its back faces the ray all the same, so the hand stays on the
    // camera's side of it.
    if v3::dot(hit.normal, ray.direction) > 0.0 {
        hit.normal = v3::scale(hit.normal, -1.0);
    }
    Some((hit, scene))
}

/// The hand a hit picks and its target: on the seat's own yoke, a thumb on a button or a grab
/// of the wheel on that side, and anywhere else the hand on the hit's side.
fn aim(me: &Avatars, hit: &Hit, scene: Scene, cx: &Cx) -> (usize, Target) {
    let rules = me.rules(cx);
    let left_of_center = me.left_of_center(hit.point);
    let side_hand = usize::from(left_of_center < 0.0);
    let seat = me.seat.and_then(|i| me.profile.as_ref()?.seats.get(i));
    if let (Some(seat), Some(model), Scene::Interior) = (seat, me.model(), scene)
        && let Some((y, part)) = model.yoke_part(hit.node)
        && let Some(yoke) = model.yokes().get(y).filter(|y| y.left == seat.left())
    {
        return match part {
            YokePart::Button => {
                let local = model
                    .world(Scene::Interior, yoke.last)
                    .map_or(hit.point, |frame| frame.inverse().point(hit.point));
                (side_hand, Target::Thumb(local))
            }
            YokePart::Wheel => {
                let side = if yoke.left { Side::Left } else { Side::Right };
                (side_hand, Target::Grip(side))
            }
        };
    }
    let hand = me.hands.hand_for(&rules, left_of_center);
    (hand, hands::point(hit.point, hit.normal))
}

/// While a left press is held, its hand follows the cursor: inside, along the plane of the
/// surface the press first met, and outside, by a fresh cast, since inside a fresh cast fell
/// through levers the model holds still, and outside the plane left the curved skin
/// (record/areas/avatars/decisions.md, "A drag glides inside and follows a fresh cast
/// outside").
fn drag(me: &mut Avatars, camera: &Camera, x: f32, y: f32) {
    let Some(press) = me.mouse.press.as_ref().filter(|p| !p.right) else {
        return;
    };
    if let Some((point, normal)) = press.plane {
        let aspect = me.mouse.aspect.unwrap_or(16.0 / 9.0);
        let ray = ray::cockpit(camera, x, y, aspect);
        if let Some(on) = on_plane(&ray, point, normal) {
            me.hands.drag(hands::point(on, normal));
        }
    } else if let Some((hit, _)) = cast(me, camera, x, y) {
        me.hands.drag(hands::point(hit.point, hit.normal));
    }
}

/// Where `ray` meets the plane through `point` with `normal`, ahead of the camera.
fn on_plane(ray: &Ray, point: V3, normal: V3) -> Option<V3> {
    let across = v3::dot(ray.direction, normal);
    if across.abs() < 1e-4 {
        return None;
    }
    let t = v3::dot(v3::sub(point, ray.origin), normal) / across;
    (t > 0.0).then(|| v3::add(ray.origin, v3::scale(ray.direction, t)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_drag_inside_glides_on_the_plane_of_the_first_hit() {
        let ray = Ray {
            origin: [0.0, 1.0, 0.0],
            direction: v3::unit([0.1, 0.0, 1.0]),
        };
        let on = on_plane(&ray, [0.0, 0.5, 2.0], [0.0, 0.0, -1.0]).unwrap();
        assert!(
            (on[2] - 2.0).abs() < 1e-5 && (on[0] - 0.2).abs() < 1e-5,
            "{on:?}"
        );
        let away = Ray {
            direction: [0.0, 0.0, -1.0],
            ..ray
        };
        assert_eq!(on_plane(&away, [0.0, 0.5, 2.0], [0.0, 0.0, -1.0]), None);
    }
}
