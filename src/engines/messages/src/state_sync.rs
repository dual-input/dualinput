//! State sync's messages: its cockpit kinds and catch-up step, and its slice
//! (record/areas/sync/05-units.md, "State sync").

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cockpit::CockpitKind;
use crate::sync::{LogStep, Value};

/// The feature's name: its unit's and its slice's.
pub const NAME: &str = "state-sync";

/// A shared entry's new value, keyed by the entry.
pub const CHANGE: CockpitKind<Value> = CockpitKind::new(20);
/// A value only the flying machine sends, keyed by the entry, which a replay collapses.
pub const PF_CHANGE: CockpitKind<Value> = CockpitKind::new(21);
/// An event entry's firing, with its value if it carried one, keyed by the entry.
pub const FIRED: CockpitKind<Option<Value>> = CockpitKind::new(22);
/// State sync's catch-up step.
pub const STATE: u16 = 20;

/// One row of the pilot flying's preflight checklist: a counted control and the value it starts
/// at.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "state-sync/")]
pub struct ChecklistRow {
    pub id: String,
    pub name: String,
    pub default: String,
    pub description: Option<String>,
}

/// State sync's `unit` message to the profile extension: the steps its engine logged in one call,
/// while an extension of this release is connected (record/areas/profiles/06-the-sync-log.md,
/// "How it reaches the view").
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SyncLog {
    /// The profile's load the steps belong to, by its stamp, since each load numbers its rows
    /// from 1.
    pub load: u64,
    /// Who sent the arrival or the catch-up that this call took, which starts every row of a
    /// crewmate's or a playback's among the steps.
    pub from: Option<Source>,
    pub steps: Vec<LogStep>,
}

/// Where an arrival or a catch-up came from.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Source {
    /// A crewmate, by the session's name for them.
    Member(String),
    /// The recorder's pretend sender.
    Playback,
}

/// The slice `state-sync`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "state-sync/")]
pub struct StateSyncSlice {
    /// The pilot flying's checklist, which is empty for any other pilot and once preflight has
    /// ended.
    pub checklist: Vec<ChecklistRow>,
}
