//! The one-off packets of one connection that wait for room in QUIC's queue.
//!
//! noq queues one-off packets in order and drops the oldest of any channel to make room for a
//! new one, so a traffic batch could push out a flight sample, and a newer sample could wait
//! behind stale ones (record/areas/network/01-between-machines.md, "Sending"). So QUIC's queue
//! holds only a few packets, and the rest wait here: the newest packet for each channel and key
//! in a slot, which a newer one replaces, and ATC frames in their channel's queue until their
//! deadline, each handed over highest priority first.

use std::cmp::Reverse;
use std::collections::{BTreeMap, VecDeque};

use messages::net::Wait;

/// A one-off packet as the network crate hands it down.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Packet {
    pub(crate) channel: u16,
    pub(crate) priority: u8,
    pub(crate) wait: Wait,
    pub(crate) bytes: Vec<u8>,
    /// Whether the send stamp goes after the bytes as the packet goes to QUIC.
    pub(crate) stamp: bool,
}

/// Where a waiting packet sits. Keys sort the packet to send first to the front: the highest
/// priority, then the lowest channel number, so two channels of one priority still go in
/// one fixed order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Slot {
    Newest(Reverse<u8>, u16, u64),
    Deadline(Reverse<u8>, u16),
}

/// A channel's place in the order packets go in.
type Order = (Reverse<u8>, u16);

#[derive(Default)]
pub(crate) struct Waiting {
    newest: BTreeMap<(Reverse<u8>, u16, u64), Packet>,
    /// Each deadline channel's packets in the order they came, with their deadlines.
    deadline: BTreeMap<Order, VecDeque<(u64, Packet)>>,
}

impl Waiting {
    pub(crate) fn put(&mut self, packet: Packet) {
        let order = (Reverse(packet.priority), packet.channel);
        match packet.wait {
            Wait::Newest { key } => {
                self.newest.insert((order.0, order.1, key), packet);
            }
            Wait::Deadline { at } => self
                .deadline
                .entry(order)
                .or_default()
                .push_back((at, packet)),
        }
    }

    /// Drops each packet whose deadline passed before `now`, and returns the earliest
    /// deadline still waiting.
    pub(crate) fn expire(&mut self, now: u64) -> Option<u64> {
        for queue in self.deadline.values_mut() {
            queue.retain(|(at, _)| *at >= now);
        }
        self.deadline.retain(|_, queue| !queue.is_empty());
        self.deadline
            .values()
            .flat_map(|queue| queue.iter().map(|(at, _)| *at))
            .min()
    }

    /// The packet to hand over next, and the slot that takes it out once it's gone.
    pub(crate) fn next(&self) -> Option<(Slot, &Packet)> {
        let newest = self.newest.iter().next();
        let deadline = self
            .deadline
            .iter()
            .find_map(|(order, queue)| queue.front().map(|(_, packet)| (order, packet)));
        match (newest, deadline) {
            (Some((&(p, c, k), packet)), Some((&(dp, dc), _))) if (p, c) <= (dp, dc) => {
                Some((Slot::Newest(p, c, k), packet))
            }
            (_, Some((&(p, c), packet))) => Some((Slot::Deadline(p, c), packet)),
            (Some((&(p, c, k), packet)), None) => Some((Slot::Newest(p, c, k), packet)),
            (None, None) => None,
        }
    }

    /// Takes out the packet `next` named, once QUIC has it.
    pub(crate) fn sent(&mut self, slot: Slot) {
        match slot {
            Slot::Newest(p, c, k) => {
                self.newest.remove(&(p, c, k));
            }
            Slot::Deadline(p, c) => {
                if let Some(queue) = self.deadline.get_mut(&(p, c)) {
                    queue.pop_front();
                    if queue.is_empty() {
                        self.deadline.remove(&(p, c));
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn newest(channel: u16, priority: u8, key: u64, byte: u8) -> Packet {
        Packet {
            channel,
            priority,
            wait: Wait::Newest { key },
            bytes: vec![byte],
            stamp: false,
        }
    }

    fn deadline(channel: u16, priority: u8, at: u64, byte: u8) -> Packet {
        Packet {
            channel,
            priority,
            wait: Wait::Deadline { at },
            bytes: vec![byte],
            stamp: false,
        }
    }

    fn drain(waiting: &mut Waiting) -> Vec<u8> {
        let mut out = Vec::new();
        while let Some((slot, packet)) = waiting.next() {
            out.push(packet.bytes[0]);
            waiting.sent(slot);
        }
        out
    }

    /// A flight sample never goes out after a newer one: the newer replaces it in its slot
    /// (record/areas/network/02-units.md, "Cases for the bench").
    #[test]
    fn a_newer_packet_replaces_the_one_waiting_for_its_key() {
        let mut waiting = Waiting::default();
        waiting.put(newest(3, 200, 0, 1));
        waiting.put(newest(3, 200, 0, 2));
        waiting.put(newest(3, 200, 7, 3));
        assert_eq!(drain(&mut waiting), vec![2, 3]);
    }

    #[test]
    fn the_highest_priority_goes_first_then_the_lowest_channel() {
        let mut waiting = Waiting::default();
        waiting.put(newest(9, 10, 0, 1));
        waiting.put(deadline(6, 150, 1_000, 2));
        waiting.put(newest(4, 150, 0, 3));
        waiting.put(newest(1, 255, 0, 4));
        assert_eq!(drain(&mut waiting), vec![4, 3, 2, 1]);
    }

    #[test]
    fn a_deadline_queue_keeps_its_order_and_drops_what_passed() {
        let mut waiting = Waiting::default();
        waiting.put(deadline(6, 150, 1_000, 1));
        waiting.put(deadline(6, 150, 3_000, 2));
        waiting.put(deadline(6, 150, 2_000, 3));
        assert_eq!(waiting.expire(1_500), Some(2_000));
        assert_eq!(drain(&mut waiting), vec![2, 3]);
        assert_eq!(waiting.expire(0), None);
    }
}
