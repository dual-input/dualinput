//! SimConnect's types and constants, as the SDK's SimConnect.h declares them, which bindgen
//! generates as this crate builds.
//!
//! The crate holds no function: the sim edge alone declares SimConnect's, so the crate graph
//! shows that only the edge can call SimConnect.dll, where one crate holding both would let
//! any crate that reads a message's layout call the sim unseen
//! (record/areas/architecture/02-code-map.md, "The sim seam").

#[allow(
    non_camel_case_types,
    non_snake_case,
    non_upper_case_globals,
    dead_code,
    clippy::all
)]
mod generated {
    include!(concat!(env!("OUT_DIR"), "/simconnect.rs"));
}

pub use generated::*;

/// The SDK version these types came from, the one the root's msfs-sdk.txt names, for a
/// recording's header to name.
pub const SDK_VERSION: &str = env!("SIMCONNECT_SDK_VERSION");
