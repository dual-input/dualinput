//! The session's keys as this core holds them: each key's newest value by its stamp, one
//! copy for each member of a key every member writes, and one for any other key
//! (record/areas/network/01-between-machines.md, "Channels").

use std::collections::BTreeMap;

use messages::net::PilotId;
use messages::session::{Control, KeyValue, Stamp, Writer};

/// One key's value as this core holds it, `None` once cleared.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Held {
    pub(crate) stamp: Stamp,
    pub(crate) value: Option<Vec<u8>>,
}

#[derive(Default)]
pub(crate) struct Store {
    /// By the key's number, and for a member's own key, the member's pilot ID.
    values: BTreeMap<(u16, Option<PilotId>), Held>,
}

/// The most members whose own copy of a key this core holds. No crew comes near it, and it bounds
/// what a crewmate's crafted messages can make this core hold, and dial, since each member it holds
/// an entry for and has no link to is dialed after every message.
const MOST_WRITERS: usize = 32;

/// Where a key's value sits: under its writer for a member's own key, and once for the
/// session otherwise.
pub(crate) fn slot(number: u16, writer: Writer, stamp_writer: PilotId) -> (u16, Option<PilotId>) {
    match writer {
        Writer::Member => (number, Some(stamp_writer)),
        Writer::Anyone | Writer::PilotFlying => (number, None),
    }
}

impl Store {
    pub(crate) fn get(&self, number: u16, member: Option<PilotId>) -> Option<&Held> {
        self.values.get(&(number, member))
    }

    /// The stamp a write by `me` under `control` takes: one past the highest number seen on
    /// that key.
    pub(crate) fn stamp(
        &self,
        number: u16,
        member: Option<PilotId>,
        me: PilotId,
        control: Control,
    ) -> Stamp {
        let n = self
            .values
            .get(&(number, member))
            .map_or(0, |held| held.stamp.n);
        Stamp {
            control,
            n: n + 1,
            writer: me,
        }
    }

    /// Takes a value, from this core or another, if it outranks the one held. Returns whether
    /// it did. A key only the pilot flying writes takes no value whose writer wasn't the
    /// pilot flying under the control value it was written under.
    pub(crate) fn take(&mut self, writer: Writer, value: KeyValue) -> bool {
        if writer == Writer::PilotFlying && value.stamp.writer != value.stamp.control.pf {
            tracing::debug!(
                key = value.key,
                "a value of a key only the pilot flying writes came from another member, so it was dropped"
            );
            return false;
        }
        let slot = slot(value.key, writer, value.stamp.writer);
        if writer == Writer::Member
            && !self.values.contains_key(&slot)
            && self.members_of(value.key).len() >= MOST_WRITERS
        {
            tracing::warn!(
                key = value.key,
                "a value from one member too many was dropped"
            );
            return false;
        }
        let replaces = self
            .values
            .get(&slot)
            .is_none_or(|held| value.stamp.outranks(&held.stamp));
        if replaces {
            self.values.insert(
                slot,
                Held {
                    stamp: value.stamp,
                    value: value.value,
                },
            );
        }
        replaces
    }

    /// Every value held, to send whole on a new connection.
    pub(crate) fn all(&self) -> Vec<KeyValue> {
        self.values
            .iter()
            .map(|(&(key, _), held)| KeyValue {
                key,
                stamp: held.stamp,
                value: held.value.clone(),
            })
            .collect()
    }

    /// The session-wide keys' numbers whose value is held.
    pub(crate) fn wide(&self) -> Vec<u16> {
        self.values
            .keys()
            .filter(|(_, member)| member.is_none())
            .map(|&(key, _)| key)
            .collect()
    }

    /// Drops every key a member wrote as its own, as it leaves the session.
    pub(crate) fn forget(&mut self, member: PilotId) {
        self.values.retain(|(_, m), _| *m != Some(member));
    }

    /// The members whose own copy of `number` this core holds.
    pub(crate) fn members_of(&self, number: u16) -> Vec<PilotId> {
        self.values
            .keys()
            .filter_map(|&(key, member)| if key == number { member } else { None })
            .collect()
    }

    /// The bytes held for every value, in all, for the session's memory budget.
    pub(crate) fn bytes(&self) -> usize {
        self.values
            .values()
            .map(|held| held.value.as_ref().map_or(0, Vec::len) + size_of::<Held>())
            .sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: PilotId = [1; 16];
    const B: PilotId = [2; 16];

    fn control(generation: u64, pf: PilotId) -> Control {
        Control { generation, pf }
    }

    fn value(key: u16, control: Control, n: u64, writer: PilotId, byte: u8) -> KeyValue {
        KeyValue {
            key,
            stamp: Stamp { control, n, writer },
            value: Some(vec![byte]),
        }
    }

    /// What each writer's value makes this core hold, and dial, stays bounded whatever a crewmate
    /// sends, and a member it already holds still updates.
    #[test]
    fn a_member_key_holds_at_most_its_most_writers() {
        let mut store = Store::default();
        let c1 = control(1, A);
        let writer = |n: usize| {
            let mut id = [0; 16];
            id[..8].copy_from_slice(&(n as u64).to_le_bytes());
            id
        };
        for n in 0..MOST_WRITERS {
            assert!(store.take(Writer::Member, value(40, c1, 1, writer(n), 1)));
        }
        assert!(!store.take(Writer::Member, value(40, c1, 1, writer(MOST_WRITERS), 1)));
        assert_eq!(store.members_of(40).len(), MOST_WRITERS);
        assert!(store.take(Writer::Member, value(40, c1, 2, writer(0), 2)));
    }

    /// Two pilots who change one key at once, or during a cut, keep the same value on every
    /// machine: control first, then the number, then the lower pilot ID.
    #[test]
    fn of_two_writes_the_higher_control_then_number_then_lower_pilot_stays() {
        let mut store = Store::default();
        let c1 = control(1, A);
        assert!(store.take(Writer::Anyone, value(40, c1, 1, A, 1)));
        assert!(
            store.take(Writer::Anyone, value(40, c1, 2, B, 2)),
            "a higher number replaces"
        );
        assert!(
            !store.take(Writer::Anyone, value(40, c1, 2, B.map(|b| b + 1), 3)),
            "of one number, the lower pilot stays"
        );
        assert!(
            store.take(Writer::Anyone, value(40, c1, 2, [0; 16], 4)),
            "a lower pilot replaces at one number"
        );
        assert!(
            store.take(Writer::Anyone, value(40, control(2, B), 1, B, 5)),
            "a newer control value outranks any number"
        );
        assert_eq!(store.get(40, None).unwrap().value, Some(vec![5]));
    }

    #[test]
    fn of_one_generation_the_control_naming_the_lower_pilot_outranks() {
        assert!(control(3, A).outranks(&control(3, B)));
        assert!(control(4, B).outranks(&control(3, A)));
    }

    #[test]
    fn a_member_key_keeps_each_members_copy() {
        let mut store = Store::default();
        let c = control(1, A);
        store.take(Writer::Member, value(3, c, 1, A, 1));
        store.take(Writer::Member, value(3, c, 1, B, 2));
        assert_eq!(store.members_of(3), vec![A, B]);
        store.forget(B);
        assert_eq!(store.members_of(3), vec![A]);
    }

    #[test]
    fn a_pilot_flying_key_drops_a_value_from_anyone_but_the_pilot_flying() {
        let mut store = Store::default();
        assert!(!store.take(Writer::PilotFlying, value(5, control(1, A), 1, B, 1)));
        assert!(store.take(Writer::PilotFlying, value(5, control(1, A), 1, A, 1)));
    }

    #[test]
    fn a_write_stamps_one_past_the_highest_number_seen() {
        let mut store = Store::default();
        store.take(Writer::Anyone, value(40, control(1, A), 7, B, 1));
        assert_eq!(store.stamp(40, None, A, control(1, A)).n, 8);
        assert_eq!(store.stamp(41, None, A, control(1, A)).n, 1);
    }
}
