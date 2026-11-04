//! Writes the figure's sizes, from its spec in src/features/avatars/figure/figure.json, as
//! constants `Figure` solves with, so the model the generator builds from the spec and the
//! joints `Figure` writes into it can't disagree.

// A build script runs as the crate builds, never on the core's loop, so reading files is its
// job, which the root's clippy.toml forbids only the loop.
#![allow(clippy::disallowed_methods)]

use std::env;
use std::fmt::Write;
use std::fs;
use std::path::PathBuf;

/// Each constant, and where the spec holds it.
const CONSTANTS: &[(&str, &str)] = &[
    ("EYE_FORWARD", "/head/eyeForward"),
    ("CHEST_AT", "/chest/at"),
    ("SHOULDERS_WIDTH", "/shoulders/width"),
    ("SHOULDERS_DOWN", "/shoulders/down"),
    ("LEGS_WIDTH", "/legs/width"),
    ("LEGS_DOWN", "/legs/down"),
    ("KNEE_ARC", "/knee/arc"),
    ("REST_HAND_FWD", "/rest/hand/fwd"),
    ("REST_HAND_RIGHT", "/rest/hand/right"),
    ("REST_HAND_UP", "/rest/hand/up"),
    ("REST_LEG_BEND", "/rest/leg/bend"),
    ("REST_LEG_SHIN", "/rest/leg/shin"),
    ("STAND_HIPS", "/stand/hips"),
    ("STAND_CROUCH", "/stand/crouch"),
    ("STAND_HEAD", "/stand/head"),
    ("WALK_STRIDE", "/walk/stride"),
    ("WALK_LIFT", "/walk/lift"),
    ("WALK_SWING", "/walk/swing"),
    ("RUN_FROM", "/run/from"),
    ("RUN_STRIDE", "/run/stride"),
    ("RUN_LIFT", "/run/lift"),
    ("RUN_LEAN", "/run/lean"),
    ("RUN_SWING", "/run/swing"),
    ("SLUMP_PITCH", "/slump/pitch"),
    ("SLUMP_DROP", "/slump/drop"),
];

fn main() {
    let manifest = PathBuf::from(
        env::var_os("CARGO_MANIFEST_DIR").expect("Cargo should set CARGO_MANIFEST_DIR"),
    );
    let spec_path = manifest.join("../figure/figure.json");
    println!("cargo::rerun-if-changed={}", spec_path.display());
    let spec: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&spec_path)
            .expect("src/features/avatars/figure/figure.json should be readable"),
    )
    .expect("the figure's spec should be JSON");
    let mut out = String::new();
    for (name, at) in CONSTANTS {
        let value = spec
            .pointer(at)
            .and_then(serde_json::Value::as_f64)
            .unwrap_or_else(|| panic!("the figure's spec should give a number at {at}"));
        writeln!(out, "pub(crate) const {name}: f32 = {value:?};").expect("a String takes writes");
    }
    // A whole number here, so `Figure` turns no float into an integer, which the sim's module
    // check refuses unless the compiler happens to fold it.
    let segments = spec
        .pointer("/knee/segments")
        .and_then(serde_json::Value::as_u64)
        .expect("the figure's spec should give its knee's segments as a whole number");
    writeln!(out, "pub(crate) const KNEE_SEGMENTS: u32 = {segments};")
        .expect("a String takes writes");
    let reach: f64 = spec
        .pointer("/telescope")
        .and_then(serde_json::Value::as_array)
        .and_then(|pieces| pieces.last())
        .and_then(serde_json::Value::as_f64)
        .expect("the figure's spec should list its telescope's pieces")
        * 2.0;
    writeln!(
        out,
        "/// The longest a stick telescopes, twice its longest piece.\npub(crate) const REACH: f32 = {reach:?};"
    )
    .expect("a String takes writes");
    let file =
        PathBuf::from(env::var_os("OUT_DIR").expect("Cargo should set OUT_DIR")).join("spec.rs");
    fs::write(file, out).expect("OUT_DIR should be writable");
}
