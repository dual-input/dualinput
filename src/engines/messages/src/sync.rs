//! The sync engine's own messages: an entry's value, the stamp a value is held under, and the
//! state a catch-up hands over (record/areas/sync/05-units.md, "The sync engine").
//!
//! They live apart from any feature's module, since the sync engine is an engine that state sync
//! runs, and deleting state sync's module would otherwise take the engine's types with it.

use serde::{Deserialize, Serialize};

use crate::cockpit::{Origin, VectorClock};
use crate::net::PilotId;

/// A state entry's value, a number in its sim units or a text.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Value {
    Number(f64),
    Text(String),
}

impl Value {
    /// Whether two values are the same as the sim reads them: numbers within `f32`'s precision,
    /// since a value written as 165 read back as 165.000002 on an AI object's `A:` variable
    /// (measured on MSFS 2024, 2026-10-02, record/areas/avatars/log.md).
    pub fn same(&self, other: &Value) -> bool {
        match (self, other) {
            (Value::Number(a), Value::Number(b)) => (*a as f32) == (*b as f32),
            (Value::Text(a), Value::Text(b)) => a == b,
            _ => false,
        }
    }

    pub fn number(&self) -> Option<f64> {
        match self {
            Value::Number(n) => Some(*n),
            Value::Text(_) => None,
        }
    }
}

/// What a state entry's value is held under, which the conflict rule compares: the message that
/// set it, by its sender and number, that message's clock, and who was the pilot flying when it
/// was made (record/areas/sync/02-live-sync.md, "When two pilots change one entry").
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stamp {
    pub origin: Origin,
    pub number: u64,
    pub clock: VectorClock,
    pub pilot_flying: PilotId,
}

impl Stamp {
    /// Whether a value under this stamp replaces one under `other`, by the conflict rule:
    /// - the change made after its sender saw the other wins;
    /// - of two made without seeing each other, the one the flying machine made wins;
    /// - of two from one pilot under two restart counts, the higher count;
    /// - and otherwise the lower pilot ID, which compares as its lowercase hex does.
    pub fn wins(&self, other: &Stamp) -> bool {
        if self.clock.has(other.origin, other.number) {
            return true;
        }
        if other.clock.has(self.origin, self.number) {
            return false;
        }
        let flying = |s: &Stamp| s.origin.pilot == s.pilot_flying;
        if flying(self) != flying(other) {
            return flying(self);
        }
        if self.origin.pilot == other.origin.pilot {
            return self.origin.restart > other.origin.restart;
        }
        self.origin.pilot < other.origin.pilot
    }
}

/// The state a catch-up hands over: each state entry the flying machine syncs, in the order its
/// cockpit first took the value it holds, those it held from the load first
/// (record/areas/sync/05-units.md, "Catch-up's order").
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct CatchUpState {
    pub entries: Vec<CatchUpEntry>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CatchUpEntry {
    pub key: String,
    pub value: Value,
    /// `None` for a value the flying machine read and never sent or took, such as one it held
    /// from the load.
    pub stamp: Option<Stamp>,
}
