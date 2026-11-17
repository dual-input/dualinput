use messages::module::slots::{CameraReport, CameraSlot};
use messages::module::{CAMERA, REFERENTIAL_SIMOBJECT, REFERENTIAL_WORLD};

use crate::{Frame, Routine, Wants};

/// The platform's routine that reads the camera for the features that subscribe to it, as
/// avatars does for the seat, the head, and the click's ray. On a following machine, one whose
/// aircraft `Follow` moves along the pilot flying's path, the camera read from outside the sim
/// lands one frame of the aircraft's travel behind the pilot's eye, and read here, during a
/// routine's frame, it lands at the eye, so the platform reads it here, and no feature has to
/// know (record/areas/core/03-sim-seam-and-wasm-module.md, the
/// note on the camera). It reports both referentials each frame, so a pilot getting up or
/// sitting down needs no new feed.
#[derive(Default)]
pub struct Camera;

impl Routine for Camera {
    const ID: messages::module::RoutineId = CAMERA;
    type Slot = CameraSlot;
    type Report = CameraReport;

    fn on_slot(&mut self, _: &CameraSlot) {}

    fn frame(&mut self, _: &Frame, want: &mut Wants) {
        // A frame with no camera, as through a load, reports nothing, rather than a camera
        // at the aircraft's reference point that would put a head there.
        let simobject = want.camera(REFERENTIAL_SIMOBJECT);
        let world = want.camera(REFERENTIAL_WORLD);
        if let (Some(simobject), Some(world)) = (simobject, world) {
            want.report(&CameraReport { simobject, world });
        }
    }
}
