use messages::module::slots::HtmlAndInputEventsSlot;
use messages::module::{HTML_AND_INPUT_EVENTS, HtmlOrInputEvent, RoutineId, html_and_input_events};

use crate::{Frame, Routine, Wants};

/// The platform's routine that makes the two kinds of event only code in the sim can, `H:`
/// events and input events' presets, for whichever features act through sim variables. The SDK
/// documents no SimConnect route to an `H:` event, and `SimConnect_SetInputEvent` takes only
/// the names `SimConnect_EnumerateInputEvents` lists, which holds no presets
/// (record/areas/sync/log.md, "Writes to input events go through our WASM module, since
/// SimConnect's list has none of their presets").
///
/// The routine host carries them out once every routine's frame has run, in the order they were
/// fed, so a write function's `H:` and `B:` actions keep their call order. Each feed is carried
/// out once, since a `_Toggle` preset fired twice puts the switch back.
#[derive(Default)]
pub struct HtmlAndInputEvents {
    due: Vec<HtmlOrInputEvent>,
}

impl Routine for HtmlAndInputEvents {
    const ID: RoutineId = HTML_AND_INPUT_EVENTS;
    const FEED_ONCE: bool = true;
    type Slot = HtmlAndInputEventsSlot;
    type Report = ();

    fn on_slot(&mut self, slot: &HtmlAndInputEventsSlot) {
        self.due.extend(html_and_input_events(slot));
    }

    fn frame(&mut self, _: &Frame, want: &mut Wants) {
        for event in self.due.drain(..) {
            match event {
                HtmlOrInputEvent::H(name) => want.fire_h(&name),
                HtmlOrInputEvent::Preset { name, value } => want.call_preset(&name, value),
            }
        }
    }
}
