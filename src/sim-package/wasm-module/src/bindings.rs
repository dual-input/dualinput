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

unsafe extern "C" {
    /// The Panels API's calculator code, which SDK 1.7.3 marks deprecated and still gives a
    /// module, declared here by hand, since bindgen reads no legacy header (read in MSFS 2024 SDK
    /// 1.7.3, `WASM/include/MSFS/Legacy/gauges.h`): `BOOL execute_calculator_code(PCSTRINGZ code,
    /// FLOAT64* fvalue, SINT32* ivalue, PCSTRINGZ* svalue)`.
    pub fn execute_calculator_code(
        code: *const std::ffi::c_char,
        fvalue: *mut f64,
        ivalue: *mut i32,
        svalue: *mut *const std::ffi::c_char,
    ) -> i32;
}
