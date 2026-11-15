//! Mirroring objects from one sim into another: the gate, which decides which of a sending
//! machine's samples go out, and the playout, which gives a copy's pose at a time from the
//! samples that arrived (record/areas/traffic-atc/01-traffic-and-atc.md, "The object-mirror
//! engine").
//!
//! Both read no clock and do no I/O, and both are generic over what they carry, so traffic runs
//! the gate in the core and the playout in its routine `Traffic`, in our WASM module, and a
//! later plugin's object mirroring, such as GSX's vehicles, runs the same two.

// Our WASM module builds this crate in, and a panic there stops every routine in the sim, so
// the commonest panics fail Clippy, which tools/check.ts runs on the module
// (record/areas/architecture/02-code-map.md, "When the module stops"). Tests may panic.
#![cfg_attr(
    not(test),
    deny(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing
    )
)]

mod gate;
mod playout;

pub use gate::{Gate, Sample, Sends};
pub use playout::{Playout, Pose};
