//! The slot of state sync's routine in our WASM module, `NamedEvents`
//! (record/areas/sync/05-units.md, "`H:` events").

use bytemuck::{Pod, Zeroable};

/// The bytes one feed of `NamedEvents` holds for its events.
pub const NAMED_EVENT_BYTES: usize = 8_000;

/// One batch of events, `count` of them in `names`, in call order, each ended by a 0 byte. An
/// `H:` event is its letter and its name, as `HFUEL`, and an input event's preset is `B`, its
/// name, and any value after `=`, as `BINSTRUMENT_HEADING_BUG_Set=180`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Pod, Zeroable)]
#[repr(C)]
pub struct NamedEventsSlot {
    pub count: u16,
    pub names: [u8; NAMED_EVENT_BYTES],
}
