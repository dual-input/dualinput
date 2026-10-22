//! The packet IDs of a connection's last calls, so an exception goes up with the tag of the
//! call that caused it: an exception names its call only by the packet ID that
//! `SimConnect_GetLastSentPacketID` gave the call (record/areas/architecture/02-code-map.md,
//! "The sim seam").

use std::collections::VecDeque;

use sim_client::Tag;

/// A connection's last calls, as each one's packet ID and tag, oldest first.
pub(crate) struct Sent {
    calls: VecDeque<(u32, Tag)>,
}

impl Sent {
    /// Traffic's routine writes its copies each frame, so traffic's connection makes a few
    /// calls a second, and 4,096 calls hold far more than 1s of them
    /// (record/areas/core/03-sim-seam-and-wasm-module.md, "Its thread"). `RECENT` in
    /// src/platform/sim-service/src/connections.rs is the sim service's count, so change both
    /// together.
    pub(crate) const KEPT: usize = 4_096;

    pub(crate) fn new() -> Sent {
        Sent {
            calls: VecDeque::new(),
        }
    }

    /// Keeps a call's packet ID and tag, and drops the oldest call once 4,096 are kept.
    pub(crate) fn add(&mut self, packet: u32, tag: Tag) {
        if self.calls.len() == Sent::KEPT {
            self.calls.pop_front();
        }
        self.calls.push_back((packet, tag));
    }

    /// The tag of the call SimConnect sent as `packet`, while it's among the calls kept.
    pub(crate) fn tag_of(&self, packet: u32) -> Option<Tag> {
        self.calls
            .iter()
            .rev()
            .find(|&&(sent, _)| sent == packet)
            .map(|&(_, tag)| tag)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_last_4096_calls_and_finds_each_by_its_packet_id() {
        let mut sent = Sent::new();
        for packet in 1..=5_000 {
            sent.add(packet, Tag(u64::from(packet) * 10));
        }
        assert_eq!(sent.calls.len(), Sent::KEPT);
        assert_eq!(sent.tag_of(5_000), Some(Tag(50_000)));
        // Calls 905 to 5,000 are the last 4,096.
        assert_eq!(sent.tag_of(905), Some(Tag(9_050)));
        assert_eq!(sent.tag_of(904), None);
        assert_eq!(sent.tag_of(1), None);
        assert_eq!(sent.tag_of(5_001), None);
    }
}
