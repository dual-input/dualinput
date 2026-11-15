//! Our WASM module's one list of routines, each a feature's crate built into the module
//! (record/areas/architecture/02-code-map.md, "Routines in our WASM module"). When you add
//! a feature's routine, add its type to the list.

// A panic in our module stops every routine in the sim, so the commonest panics fail Clippy,
// which tools/check.ts runs on the module (record/areas/architecture/02-code-map.md, "When
// the module stops").
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use routine_host::{Kind, routines};

#[cfg(test)]
mod tests;

pub fn list() -> Vec<Kind> {
    routines![
        routine_host::Hold,
        flight_model_routines::Lead,
        flight_model_routines::Follow,
        avatars_routines::Figure,
        traffic_routines::Traffic,
        state_sync_routines::NamedEvents
    ]
}
