//! What the build script found about this build, which a recording's header names:
//! `COMMIT`, `UNCOMMITTED`, `PROFILE`, `RUSTC`, `MSVC`, and `WINDOWS_SDK`.

include!(concat!(env!("OUT_DIR"), "/build_info.rs"));
