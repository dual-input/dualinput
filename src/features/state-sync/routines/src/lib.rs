//! State sync's routine in our WASM module, `NamedEvents`: it makes the two kinds of event only
//! code in the sim can, `H:` events and input events' presets, since the SDK documents no
//! SimConnect route to an `H:` event, and `SimConnect_SetInputEvent` takes only the names
//! `SimConnect_EnumerateInputEvents` lists, which holds no presets
//! (record/areas/sync/log.md, 2026-11-09).
//!
//! The routine host carries them out once every routine's frame has run, in the order they were
//! fed, so a write function's `H:` and `B:` actions keep their call order.

// A panic in our module stops every routine in the sim, so the commonest panics fail Clippy,
// which tools/check.ts runs on the module (record/areas/architecture/02-code-map.md, "When the
// module stops").
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use messages::module::RoutineId;
use messages::state_sync::slots::NamedEventsSlot;
use messages::state_sync::{NAMED_EVENTS, NamedEvent, named_events};
use routine_host::{Frame, Routine, Wants};

/// Makes each event of each feed, in the frame after it arrives.
#[derive(Default)]
pub struct NamedEvents {
    due: Vec<NamedEvent>,
}

impl Routine for NamedEvents {
    const ID: RoutineId = NAMED_EVENTS;
    const FEED_ONCE: bool = true;
    type Slot = NamedEventsSlot;
    type Report = ();

    fn on_slot(&mut self, slot: &NamedEventsSlot) {
        self.due.extend(named_events(slot));
    }

    fn frame(&mut self, _: &Frame, want: &mut Wants) {
        for event in self.due.drain(..) {
            match event {
                NamedEvent::H(name) => want.fire_h(&name),
                NamedEvent::Preset { name, value } => want.call_preset(&name, value),
            }
        }
    }
}
