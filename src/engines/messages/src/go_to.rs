//! The messages of Go to, which the EFB app labels Join: the pilot flying's spot, Join's command,
//! and the slice its part in the EFB app draws from (record/areas/session/02-units.md, "Go to";
//! record/areas/interface/decisions.md, "Join takes a joiner from the world map into the PF's
//! flight, or only sets it up").

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::session::{Key, Writer};

/// The feature's name: its unit's and its slice's. `NAME` in src/features/go-to/efb/names.ts
/// names it too, so change both together.
pub const NAME: &str = "go-to";

/// The pilot flying's spot, which their core writes while they're in the flight, and clears
/// when they leave it.
pub const SPOT: Key<Option<Spot>> = Key::new(11, Writer::PilotFlying);

/// The command Join's two answers send, with `Join` as its arguments. `JOIN` in
/// src/features/go-to/efb/names.ts names it too.
pub const JOIN: &str = "go-to.join";

/// Where the pilot flying is.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "go-to/")]
pub struct Spot {
    /// The flight file's `[Departure]` airport, `ICAO`, or none when the flight names none.
    pub airport: Option<String>,
    /// Its stand, from `GateName` and `GateNumber`.
    pub stand: Option<Stand>,
    /// Whether any of the aircraft's engines runs, from `A:GENERAL ENG COMBUSTION`.
    pub engines: bool,
    /// `A:LIVERY NAME`, which Join selects where the joiner has it.
    pub livery: Option<String>,
}

/// A stand, as the flight file names it, such as `GateName=PARKING` and `GateNumber=140`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "go-to/")]
pub struct Stand {
    pub name: String,
    pub number: u32,
}

/// The arguments of `JOIN`: Join now, which also starts the flight and presses Ready to fly, or
/// Set up only.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "go-to/")]
pub struct Join {
    pub now: bool,
}

/// What the part draws: Join on the pilot flying's crew row, and a toast for each `said`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "go-to/")]
pub struct GoToSlice {
    /// The pilot flying's spot, while they're in a flight.
    pub spot: Option<Spot>,
    pub join: JoinState,
    /// The last thing a Join said, numbered so the part shows each once.
    pub said: Option<Said>,
}

/// Whether Join shows on the pilot flying's row, and whether it can run.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "as", rename_all = "kebab-case")]
#[ts(export, export_to = "go-to/")]
pub enum JoinState {
    /// No Join: this pilot is out of a session, in the flight, the pilot flying, or somewhere
    /// the EFB isn't open, such as a flight's load.
    Hidden,
    /// Join can run.
    Ready,
    /// A Join runs.
    Running,
    /// Join shows, disabled, with why.
    Unavailable { why: Unavailable },
}

/// Why Join can't run.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "go-to/")]
pub enum Unavailable {
    /// The pilot flying isn't in a flight.
    NoFlight,
    /// Their flight file names no departure airport.
    NoDeparture,
    /// The world map's aircraft list has no entry for their aircraft, which Join names.
    NoAircraft,
    /// This pilot is in a flight in another aircraft.
    OtherAircraft,
    /// No menu script is connected, as when our copy of BlurPage is gone.
    NoScript,
}

/// One thing a Join said.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "go-to/")]
pub struct Said {
    /// Counts up with each thing said, so a page that reconnects shows nothing twice.
    pub n: u32,
    /// Join now rather than Set up only.
    pub now: bool,
    /// The spot this Join went to.
    pub spot: Spot,
    /// The pilot flying's aircraft, by its `A:TITLE`, which Join selected.
    pub aircraft: String,
    pub outcome: Outcome,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "as", rename_all = "kebab-case")]
#[ts(export, export_to = "go-to/")]
pub enum Outcome {
    /// The world map holds the airport, the stand or runway, the aircraft, and the livery where
    /// the joiner has it. Join now says it as the flight starts.
    SetUp {
        /// The world map listed no stand of the pilot flying's, so the airport stays without one.
        no_stand: bool,
    },
    /// A step failed, and Join stopped there.
    Failed { step: Step },
}

/// A step of Join, in the order Join takes them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "go-to/")]
pub enum Step {
    Airport,
    Stand,
    Runway,
    Aircraft,
    Livery,
    Launch,
    Ready,
}
