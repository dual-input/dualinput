//! The sim's calculator code, reverse Polish notation: expanding an aircraft's template
//! parameters and macros in it, compiling it, and running it on given values, so
//! `aircraft-model` can pose an aircraft's model the way its behavior XML would
//! (record/areas/avatars/01-avatars.md, "Its engines").
//!
//! No Rust crate runs this code, and the probes' own operator set ran 310 of the Baron 58P's
//! 406 animation and visibility codes, most of the rest stopping at template parameters and
//! `@` macros left unexpanded (record/areas/avatars/log.md, 2026-10-17). So this crate
//! expands both, and takes every word the SDK documents but the vector words and `F:`'s
//! functions, which no posing code we read uses
//! (documented, [Reverse Polish Notation](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/reverse-polish-notation/)).
//!
//! ```text
//! let program = compile("(A:YOKE Y POSITION WITH AP, Percent) 2 / 50 +")?;
//! program.vars          [Var { kind: 'A', name: "YOKE Y POSITION WITH AP", unit: "percent" }]
//! program.run(&mut scratch, |i| value of program.vars[i])   the number left on the stack
//! ```

mod compile;
mod expand;
mod run;

pub use compile::{Program, compile};
pub use expand::expand;
pub use run::Scratch;

use serde::{Deserialize, Serialize};

/// A variable the code names: its kind, the letter before the colon, such as `A` for a sim
/// variable or `L` for a local one; its name as written; and its unit, lowercase, `number`
/// when the code gives none.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Var {
    pub kind: char,
    pub name: String,
    pub unit: String,
}

impl Var {
    /// Whether its value comes from the sim, which the caller watches: an `A:` or an `L:`
    /// variable. The others are the component's, the instrument's, or the gauge's own, which
    /// a run keeps in its scratch, or ones no caller has, such as the mouse's.
    pub fn from_sim(&self) -> bool {
        matches!(self.kind, 'A' | 'L')
    }

    /// Whether a run keeps it itself, as the sim keeps a component's `O:` variables.
    pub fn kept(&self) -> bool {
        matches!(self.kind, 'O' | 'I' | 'G')
    }

    /// Whether posing has a value for it at all: one the caller watches, or one a run keeps.
    /// An `E:` time or a `B:` input event's value is neither, so code that reads one poses
    /// nothing, and its part stays as the file stores it.
    pub fn known(&self) -> bool {
        self.from_sim() || self.kept()
    }
}

/// Why code didn't compile.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error(pub String);

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

#[cfg(test)]
mod tests;
