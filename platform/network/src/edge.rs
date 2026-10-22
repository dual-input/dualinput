//! The transport's events come up as the network crate's inputs, each one's bytes an `Event`
//! in postcard, and the network crate's outputs are the transport's `Command`s, which the
//! core's edge hands it (record/areas/network/02-units.md, "The transport").

use messages::net::Event;

/// Names the source the transport's events come up under, through
/// `Kernel::source::<Transport>()`.
pub struct Transport;

/// An event as the edge pushes it.
pub fn encode(event: &Event) -> Vec<u8> {
    postcard::to_stdvec(event).expect("postcard should encode a transport's event")
}

pub(crate) fn decode(bytes: &[u8]) -> Option<Event> {
    postcard::from_bytes(bytes).ok()
}
