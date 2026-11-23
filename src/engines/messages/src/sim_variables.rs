//! Sim variables' messages: what its two panel modules tell the core and what the core tells them
//! (record/areas/profiles/04-the-extension-in-the-sim.md, "Reaching the sim by name").

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The panel module that hears `H:` events, and the name its messages go under. `NAME` in
/// src/platform/sim-variables/panel/src/h-events.ts names it too, and so does the module's file,
/// panel/h-events.ts, so change all three together.
pub const H_EVENTS: &str = "h-events";
/// The panel module that reads `instrument()` values, and the name its messages go under.
/// `NAME` in src/platform/sim-variables/panel/src/instrument-reads.ts names it too, and so does
/// the module's file, panel/instrument-reads.ts, so change all three together.
pub const INSTRUMENT_READS: &str = "instrument-reads";

/// What the `h-events` module tells the core.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "sim-variables/")]
pub struct HeardH {
    /// The event's name as the instrument receives it, with no `H:`.
    pub name: String,
    /// The instrument it was aimed at, if the sim named one.
    pub target: Option<String>,
}

/// What the `instrument-reads` module tells the core.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "sim-variables/")]
pub enum FromInstrumentReads {
    /// The module started, serving these instruments, by their keys.
    Started { instruments: Vec<String> },
    /// Each path whose value changed since the last message.
    Read { readings: Vec<PathReading> },
}

/// One path's new reading, by the number `InstrumentPaths` gave it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "sim-variables/")]
pub struct PathReading {
    pub number: u32,
    pub reading: Reading,
}

/// What a path read.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "as", content = "value", rename_all = "kebab-case")]
#[ts(export, export_to = "sim-variables/")]
pub enum Reading {
    Number(f64),
    Text(String),
    /// The path threw, or read something an entry can't hold, and why, which goes out once
    /// until the path reads a value again.
    Error(String),
}

/// What the core tells the `instrument-reads` module: every path it reads, which replaces the
/// paths it read before.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "sim-variables/")]
pub struct InstrumentPaths {
    pub paths: Vec<InstrumentPath>,
}

/// One value the module reads.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "sim-variables/")]
pub struct InstrumentPath {
    pub number: u32,
    /// The instrument's key, as the module's `start` was given it.
    pub instrument: String,
    pub path: String,
    /// Whether the entry reads text, which a reading of a number or a boolean fails, as a
    /// reading of text fails an entry that reads a number.
    pub text: bool,
}
