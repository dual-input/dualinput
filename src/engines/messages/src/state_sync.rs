//! State sync's messages: its cockpit kinds and catch-up step, and its slice
//! (record/areas/sync/05-units.md, "State sync").

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cockpit::CockpitKind;
use crate::sync::Value;

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

/// The slice `state-sync`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "state-sync/")]
pub struct StateSyncSlice {
    /// The pilot flying's checklist, which is empty for any other pilot and once preflight has
    /// ended.
    pub checklist: Vec<ChecklistRow>,
}
