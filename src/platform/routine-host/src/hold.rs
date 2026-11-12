use messages::module::HOLD;
use messages::module::slots::HoldSlot;

use crate::{Frame, Routine, Wants};

/// Preflight's routine, which holds the pilot's aircraft frozen until preflight ends. It's
/// the platform's own, so it lives in the routine host, since the module can't link the
/// crates in the core that feed it (record/areas/architecture/02-code-map.md, "Routines in
/// our WASM module").
#[derive(Default)]
pub struct Hold;

impl Routine for Hold {
    const ID: messages::module::RoutineId = HOLD;
    type Slot = HoldSlot;
    type Report = ();

    fn on_slot(&mut self, _: &HoldSlot) {}

    fn frame(&mut self, _: &Frame, want: &mut Wants) {
        want.freeze();
    }
}
