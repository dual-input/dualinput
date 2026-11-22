//! Every message Dual Input's programs send each other, on one PC and between the two
//! pilots' PCs. So no two programs can disagree on a message's shape, the Rust programs
//! all use this one crate, and ts-rs generates the TypeScript side's types from it. Each
//! program's first message carries `VERSION` and `HASH`, so two builds that don't match
//! refuse each other (decisions 025 and 026).

// Our WASM module builds this crate in, and a panic there stops every routine in the sim,
// so the commonest panics fail Clippy, which tools/check.ts runs on the module
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

/// Dual Input's version, which every crate inherits from the root Cargo.toml's
/// `[workspace.package]`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

include!(concat!(env!("OUT_DIR"), "/hash.rs"));

pub mod atc_audio;
pub mod authoring;
pub mod avatars;
pub mod backend;
pub mod bench;
pub mod clients;
pub mod cockpit;
pub mod core_helper;
pub mod desktop;
pub mod flight_model;
pub mod go_to;
pub mod module;
pub mod net;
pub mod pointer_sync;
pub mod profiles;
pub mod rate_and_pause;
pub mod recording;
pub mod session;
pub mod sim;
pub mod sim_variables;
pub mod state_sync;
pub mod sync;
pub mod take_control;
pub mod traffic;

/// Bytes as lowercase hex, two digits a byte, the form pilot and endpoint IDs take in the
/// messages, the backend's requests, and the session file.
pub fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(out, "{b:02x}");
    }
    out
}

/// `2 * N` hex digits back to their `N` bytes, or `None` when `text` isn't that.
pub fn unhex<const N: usize>(text: &str) -> Option<[u8; N]> {
    if text.len() != N * 2 {
        return None;
    }
    let mut out = [0; N];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(text.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(out)
}

// Tests run off the core's loop, so they may write files, which the root's clippy.toml
// forbids only the loop.
#[cfg(test)]
#[allow(clippy::disallowed_methods)]
mod tests {
    use super::{HASH, VERSION};

    /// Our TypeScript, in the sim's panels and the desktop app, sends the same version and
    /// hash in its first message, and imports them from `ts/stamp.ts`, which this test
    /// writes.
    ///
    /// A test writes it, not the build script, because ts-rs writes the messages'
    /// TypeScript types from tests too, so one `cargo test` writes all of `ts/`, and
    /// because a build script should write only into its OUT_DIR.
    #[test]
    fn writes_the_stamp() {
        let dir = std::env::var_os("TS_RS_EXPORT_DIR")
            .expect("TS_RS_EXPORT_DIR should be set by the root's .cargo/config.toml");
        let dir = std::path::Path::new(&dir);
        std::fs::create_dir_all(dir).expect("TS_RS_EXPORT_DIR should be a folder we can create");
        let stamp = format!(
            "// Written by the test `writes_the_stamp` in src/engines/messages/src/lib.rs.\n\
             // node tools/build.ts writes it again, so edit the test, not this file.\n\
             export const VERSION = \"{VERSION}\";\n\
             export const HASH = \"{HASH}\";\n"
        );
        std::fs::write(dir.join("stamp.ts"), stamp).expect("stamp.ts should be writable");
    }

    #[test]
    fn hash_is_sha256_hex() {
        assert_eq!(HASH.len(), 64);
        assert!(
            HASH.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        );
    }
}
