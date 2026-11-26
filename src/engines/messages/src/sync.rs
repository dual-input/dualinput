//! The sync engine's own messages: an entry's value, the stamp a value is held under, the state a
//! catch-up hands over (record/areas/sync/05-units.md, "The sync engine"), and the steps of its log
//! (record/areas/profiles/06-the-sync-log.md, "What the engine logs").
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
    /// (measured on MSFS 2024, 2026-10-02, record/areas/avatars/log.md, "2026-10-02: Writing a
    /// GSX person's animation frame makes it walk, and a seated one moves on its own").
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
    /// `None` for a value the flying machine read and never sent or took, such as one it kept
    /// from the load.
    pub stamp: Option<Stamp>,
}

/// One step of the Sync log: one decision the sync engine took for one row, in the order it took
/// them. A row is a cause, and its first step says which; every later step joins the row whose
/// write left what it decides on (record/areas/profiles/06-the-sync-log.md, "Rows and steps").
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LogStep {
    /// The row, numbered from 1 in each load of the profile, whether the log is on or not, so a
    /// replay that keeps the log from the load numbers each row as the live run did.
    pub row: u32,
    /// The engine's input's time, in µs on the PC's counter.
    pub at: u64,
    /// The entry's key.
    pub entry: String,
    pub step: Step,
}

/// A step's decision, under the engine's own word for it, which the Sync log shows as it is.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Step {
    /// A row's first step: a change on this PC that no pending value or token explains, by the
    /// pilot's hand or by the aircraft's own systems, with the value read or the one an
    /// occurrence carried.
    LocalChange {
        value: Option<Value>,
    },
    /// A row's first step: a crewmate's change or firing, or a playback's, as the cockpit stream
    /// applied it, from the sender the message names.
    Arrived {
        value: Option<Value>,
    },
    /// A row's first step: a catch-up's value for the entry, from the sender the message names.
    CaughtUp {
        value: Value,
    },
    /// A row's first step: control passed to this pilot, and the engine writes an entry the
    /// pilot flying owns at the old pilot flying's last value.
    ControlPassed {
        value: Value,
    },
    /// A local change went out.
    Sent,
    /// A newer row of the entry took over this row's unsent change, waiting write, or run, or
    /// read back a value that cleared this row's pending one.
    Replaced,
    /// The stream dropped this row's unsent change, for the reason `why` names.
    Withdrawn {
        why: Withdrawal,
    },
    NotSentDuringPreflight,
    /// This pilot may not send the change, so the engine writes the entry's synced value.
    PutBack {
        value: Value,
    },
    PutBackCarriesOn,
    MatchesSyncedValue,
    /// A local change this pilot may not send, with nothing to put back: a watch-only entry's, one
    /// with no synced value yet, and an event's firing during this pilot's own catch-up.
    NotSent,
    TooLarge {
        bytes: u64,
    },
    Stopped {
        why: Stopping,
    },
    ReportedTwice,
    /// An occurrence the entry's `ignore` names, as the profile writes it, such as
    /// `K('TOGGLE_FLIGHT_DIRECTOR')`, which the entry's own change or firing caused, so it isn't
    /// sent.
    Ignored {
        event: String,
    },
    /// The conflict rule: a newer change of this pilot's wins, and nothing is written.
    Lost,
    /// It beat a change of this pilot's the stream still held, which the engine withdraws.
    Won,
    /// A watch-only entry's value from a crewmate, compared with the reading 1.5s later.
    Compared,
    Matches,
    Differs {
        reading: Option<Value>,
    },
    AwaitingReading,
    FirstReading {
        value: Value,
    },
    /// The write waits for its turn: for the entry whose write waits ahead of it, or the entries
    /// with a pending value its check would flag.
    WaitsFor {
        ahead: Vec<String>,
    },
    /// While the write waited, a reading came at the value it wants, which an earlier write set.
    NowReads {
        value: Value,
    },
    AlreadyMatches,
    /// The actions the engine handed over in one call, which a write function's run that wrote
    /// nothing leaves empty.
    Writes {
        actions: Vec<Written>,
    },
    FunctionFailed {
        error: String,
    },
    Pending {
        value: Value,
    },
    /// A reading matched the row's pending value, and with `landed`, it's the row's last value,
    /// read back after its last step.
    ReadBack {
        value: Value,
        landed: bool,
    },
    NeverLanded {
        reading: Option<Value>,
    },
    /// A following machine's write of what the pilot flying owns was still pending at its check,
    /// which drops it without the warning `NeverLanded` gives.
    WarningSkipped,
    TokenUsed,
    TokenExpired,
    /// The occurrence an `ignore` waited for, as the profile writes it, didn't come within 1s.
    IgnoreExpired {
        event: String,
    },
    NoValue,
    DroppedRefused,
    ShadowRestored {
        value: Value,
    },
    SkippedStopped,
}

/// Why the stream dropped a row's unsent change, each reason a word the Sync log shows after
/// `withdrawn`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Withdrawal {
    /// A crew member's change won the conflict rule.
    Lost,
    /// The entry went back to the value it last sent before the stream sent this change.
    Undone,
}

/// Why an entry stopped syncing for the rest of the load.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Stopping {
    Driven,
    Limit { error: String },
    Compile { error: String },
}

/// One action of a write: the name as the profile writes it, such as `K('AP_ALT_HOLD')`, and the
/// values it carries.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Written {
    pub name: String,
    pub values: Vec<Value>,
}
