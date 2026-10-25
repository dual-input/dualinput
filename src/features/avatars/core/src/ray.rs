//! The ray from the camera through the cursor, and the world's points turned into the
//! aircraft's frame, through `aircraft_model::frame`, which tools/profile-author shares.

use aircraft_model::Ray;
use aircraft_model::frame::{self, View};
pub(crate) use aircraft_model::frame::{AircraftPose, world_to_frame};
use sim_service::Camera;

use crate::v3::V3;

fn view(camera: &Camera) -> View {
    View {
        position: camera.position,
        pitch: camera.pitch,
        yaw: camera.yaw,
        fov: camera.fov,
    }
}

/// The ray from a `SIMOBJECT` camera through the cursor at `x` and `y`, −1 to 1 right and up,
/// in a view `aspect` wide for each unit high.
pub(crate) fn cockpit(camera: &Camera, x: f32, y: f32, aspect: f32) -> Ray {
    frame::cockpit(&view(camera), x, y, aspect)
}

/// Where a `SIMOBJECT` camera looks, the ray through the view's center.
pub(crate) fn look(camera: &Camera) -> V3 {
    cockpit(camera, 0.0, 0.0, 1.0).direction
}

/// The ray from a `WORLD` camera through the cursor, in the aircraft's frame.
pub(crate) fn on_foot(
    camera: &Camera,
    x: f32,
    y: f32,
    aspect: f32,
    aircraft: &AircraftPose,
) -> Ray {
    frame::on_foot(&view(camera), x, y, aspect, aircraft)
}
