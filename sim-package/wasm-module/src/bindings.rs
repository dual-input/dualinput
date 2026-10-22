//! The sim's APIs, as the SDK's headers declare them, which build.rs generates with bindgen.

#![allow(
    non_camel_case_types,
    non_snake_case,
    non_upper_case_globals,
    dead_code,
    clippy::all,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

include!(concat!(env!("OUT_DIR"), "/sim.rs"));
