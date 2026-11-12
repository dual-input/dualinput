//! Flight-model sync's routines in our WASM module: `Lead`, which reads the flying aircraft
//! about 20 times a second, and `Follow`, which freezes a following aircraft and draws it
//! from those reads (record/areas/flight-model/01-flight-model-sync.md).
//!
//! Both run inside the sim's frame, since a write from outside the sim stutters in a moving
//! cockpit (measured on MSFS 2024, 2026-10-03, record/areas/avatars/log.md, "Writes from
//! outside the sim place an object in a moving cockpit but can't hold it still").

// A panic in our module puts it in the sim's `DIRTY` state, and the sim stops running it, so
// one routine's bug would stop every routine (record/areas/architecture/02-code-map.md, "When
// the module stops"). So the commonest panics fail Clippy, as in the routine host.
#![cfg_attr(
    not(test),
    deny(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing
    )
)]

mod follow;
mod lead;
mod pose;
mod vars;

pub use follow::Follow;
pub use lead::Lead;

#[cfg(test)]
mod tests;
