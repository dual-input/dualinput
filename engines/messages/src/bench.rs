//! The lines the bench and a bench build of the core trade over the bench's socket, a TCP
//! socket on 127.0.0.1 that only a build with the `stand-in` feature opens. The bench
//! drives the core's test units and its stand-in sim through it, from outside the core, as
//! a pilot's surroundings would (record/areas/build/02-testing.md, "Its place").
//!
//! Each line is one of these as JSON. The bench is TypeScript, so ts-rs writes their types
//! into ts/bench/ when this crate's tests run.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The core's first line, so a bench that was built from another tree refuses the core,
/// as every program's first message does (decision 026).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bench/")]
pub struct Hello {
    pub version: String,
    pub hash: String,
}

/// A line from the bench, such as `{"kind":"count","n":3}`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum ToCore {
    /// A numbered line, whose number a test unit logs as it handles it, so a replay of the
    /// recording tells a scenario which of the lines it sent reached the loop.
    Count { n: u32 },
    /// Plays the loop under load: the capture of a flight at `capture`, in the format
    /// tools/bench/fixtures/README.md gives, `plays` times over, with the made-up inputs of
    /// a session beside it, then exits the core.
    Load { capture: String, plays: u32 },
    /// Has a test unit put out the core's exit.
    Exit,
    /// Acts on the stand-in sim, as something happens to the sim. It goes to the stand-in's
    /// thread, and is no input of the core's.
    StandIn { act: StandInAct },
    /// Has the sim's test unit, which stands in for a feature, make a call of the sim.
    Sim { call: SimCall },
    /// Has the clients' test unit, which stands in for the session crate, the profile
    /// loader, and a feature with a slice and a panel module, act.
    Clients { act: ClientsAct },
}

/// What the clients' test unit does.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "act", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum ClientsAct {
    /// Has the core announce that a session started, or ended, as the session crate does.
    Session { on: bool },
    /// Loads a profile whose panel module `bench-panel` takes each instrument whose key
    /// starts with one of `picks`, or unloads it, as the profile loader does.
    Profile { loaded: bool, picks: Vec<String> },
    /// Changes the slice `bench` `per_second` times a second for `for_ms`.
    Churn { per_second: u32, for_ms: u64 },
    /// Says `bye` to every client, as the session crate does as the core quits.
    Bye,
}

/// What the bench does to the stand-in sim.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "act", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum StandInAct {
    /// Takes the process with this ID, the bench's stub, as the sim's.
    Watch { process: u32 },
    /// Loses the newest connection of the unit named `unit`.
    Lose { unit: String },
    /// Sends the sim's quit message on every open connection.
    Quit,
    /// Plays the sim's signals, each `after_ms` after the one before.
    Play { signals: Vec<Played> },
    /// Refuses the variable `name` in every data definition after the call returned.
    Reject { name: String },
    /// Holds back the sim's open message for this long after each open returns.
    OpenReply { delay_ms: u64 },
    /// Runs this many frames a second, 0 to stop them.
    Frames { per_second: u32 },
    /// Stops our module, as the sim stops one that went `DIRTY`.
    StopModule,
    /// Runs a module from a build whose slots hash is this one, given in hex.
    ModuleFrom { slots_hash: String },
    /// Hands up one more message on the named unit's last connection that's gone.
    Stale { unit: String },
    /// Answers with a `FromCore::StandIn` line.
    Report,
}

/// One of the sim's signals the stand-in plays.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bench/")]
pub struct Played {
    pub after_ms: u64,
    pub signal: Signal,
}

/// A signal of the sim's around a flight load.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "signal", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum Signal {
    AircraftLoaded {
        path: String,
    },
    FlightLoaded {
        path: String,
    },
    /// A flow event, by SimConnect's number for it, as p08's client recorded them.
    Flow {
        event: i32,
    },
    Pause {
        flags: u32,
    },
}

/// A call of the sim the test unit makes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "call", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum SimCall {
    /// Watches numbers, each named with its unit, such as `["A:IS ALTITUDE FREEZE ON",
    /// "bool"]`, on change or once. The unit numbers its watches from 0 as it makes them.
    Watch {
        vars: Vec<(String, String)>,
        once: bool,
    },
    /// Writes values into the variables of the watch the unit made `watch`th.
    Write {
        watch: u32,
        values: Vec<f64>,
    },
    Key {
        event: String,
        value: u32,
    },
    /// Feeds the routine `routine`: `HOLD`, or the bench's `PROBE` with its mode.
    Feed {
        routine: String,
        mode: u32,
    },
    End {
        routine: String,
    },
}

/// A line from the core besides its first.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum FromCore {
    /// Something the sim's test unit heard or saw, as one line of text, such as `stage
    /// loading`.
    Heard { what: String },
    /// A CommBus call the core made for JavaScript, which the stand-in hands to the sim's
    /// pages, so the bench's fake pages hear the core's announcement.
    CommBus { name: String, data: String },
    /// What the stand-in was called for, and what its aircraft holds.
    StandIn {
        /// Each connection opened while the sim took connections, as its unit's place and
        /// that unit's count of opens.
        opens: Vec<(u32, u32)>,
        calls: Vec<Called>,
        variables: Vec<(String, String)>,
        module_stopped: bool,
    },
}

/// One call the core made of the stand-in.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bench/")]
pub struct Called {
    pub unit: u32,
    pub open: u32,
    /// The SimConnect function, such as `SetNotificationGroupPriority`.
    pub function: String,
    /// The call's arguments, as Rust prints them.
    pub arguments: String,
    pub before_open_reply: bool,
}
