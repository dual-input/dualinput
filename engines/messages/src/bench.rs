//! The lines the bench and a bench build of the core trade over the bench's socket, a TCP
//! socket on 127.0.0.1 that only a build with the `stand-in` feature opens. The bench
//! drives the core's test units through it, from outside the core, as a pilot's
//! surroundings would (record/areas/build/02-testing.md, "Its place").
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
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
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
}
