//! Tests of the build script's hash. `cargo test` never runs tests inside a build script,
//! so this file includes the script as a module.

// Tests run off the core's loop, so they may write files, which the root's clippy.toml
// forbids only the loop.
#![allow(clippy::disallowed_methods)]

// The script's `main` and `find_lock` go unused here, which would warn.
#[allow(dead_code)]
#[path = "../build.rs"]
mod build_script;

use std::{fs, path::PathBuf};

use build_script::{crate_hash, reachable_packages, slots_hash};

fn fake_crate(name: &str, files: &[(&str, &str)]) -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name);
    // CARGO_TARGET_TMPDIR keeps what the last run wrote, so clear it first.
    if dir.exists() {
        fs::remove_dir_all(&dir).expect("the last run's folder should be removable");
    }
    for (path, text) in files {
        let file = dir.join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, text).unwrap();
    }
    dir
}

// The crate reaches serde, and toml 1.1.8, which the lock names with its version because it
// also holds toml 0.9.4. Nothing reaches toml 0.9.4 or `unrelated`.
const LOCK: &str = r#"
version = 4

[[package]]
name = "messages"
version = "0.1.0"
dependencies = ["serde", "toml 1.1.8"]

[[package]]
name = "serde"
version = "1.0.228"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "toml"
version = "0.9.4"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "toml"
version = "1.1.8"
source = "registry+https://github.com/rust-lang/crates.io-index"
dependencies = ["serde"]

[[package]]
name = "unrelated"
version = "2.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
"#;

const FILES_LF: &[(&str, &str)] = &[
    ("Cargo.toml", "[package]\nname = \"messages\"\n"),
    ("build.rs", "fn main() {}\n"),
    ("src/lib.rs", "pub mod a;\n"),
    ("src/a.rs", "pub struct A {\n    pub x: u32,\n}\n"),
];

#[test]
fn crlf_line_ends_give_the_same_hash() {
    let crlf: Vec<(&str, String)> = FILES_LF
        .iter()
        .map(|(p, t)| (*p, t.replace('\n', "\r\n")))
        .collect();
    let crlf: Vec<(&str, &str)> = crlf.iter().map(|(p, t)| (*p, t.as_str())).collect();
    let lf = fake_crate("lf", FILES_LF);
    let crlf = fake_crate("crlf", &crlf);
    assert_eq!(crate_hash(&lf, LOCK), crate_hash(&crlf, LOCK));
}

#[test]
fn a_change_to_a_message_changes_the_hash() {
    let before = fake_crate("before", FILES_LF);
    let mut changed = FILES_LF.to_vec();
    changed[3] = ("src/a.rs", "pub struct A {\n    pub x: u64,\n}\n");
    let after = fake_crate("after", &changed);
    assert_ne!(crate_hash(&before, LOCK), crate_hash(&after, LOCK));
}

#[test]
fn moving_text_between_files_changes_the_hash() {
    let one = fake_crate(
        "one",
        &[("Cargo.toml", "a"), ("build.rs", ""), ("src/lib.rs", "bc")],
    );
    let two = fake_crate(
        "two",
        &[("Cargo.toml", "ab"), ("build.rs", ""), ("src/lib.rs", "c")],
    );
    assert_ne!(crate_hash(&one, LOCK), crate_hash(&two, LOCK));
}

#[test]
fn the_lock_gives_the_packages_the_crate_reaches() {
    let reached = reachable_packages(LOCK, "messages");
    let expected =
        [("serde", "1.0.228"), ("toml", "1.1.8")].map(|(n, v)| (n.to_owned(), v.to_owned()));
    assert_eq!(reached, expected);
}

#[test]
fn only_a_change_to_a_slot_changes_the_slots_hash() {
    let files = [
        ("Cargo.toml", "[package]\nname = \"messages\"\n"),
        ("build.rs", "fn main() {}\n"),
        ("src/lib.rs", "pub mod module;\n"),
        ("src/module.rs", "pub mod slots;\npub struct Status;\n"),
        ("src/module/slots.rs", "pub struct HoldSlot {}\n"),
    ];
    let base = slots_hash(&fake_crate("slots", &files));
    let mut message = files;
    message[3] = ("src/module.rs", "pub mod slots;\npub struct Status(u8);\n");
    assert_eq!(base, slots_hash(&fake_crate("slots-message", &message)));
    let mut slot = files;
    slot[4] = ("src/module/slots.rs", "pub struct HoldSlot { x: u32 }\n");
    assert_ne!(base, slots_hash(&fake_crate("slots-slot", &slot)));
}

#[test]
fn a_new_codec_version_changes_the_hash_and_an_unrelated_package_doesnt() {
    let dir = fake_crate("codec", FILES_LF);
    let base = crate_hash(&dir, LOCK);
    assert_ne!(base, crate_hash(&dir, &LOCK.replace("1.0.228", "1.0.229")));
    assert_eq!(base, crate_hash(&dir, &LOCK.replace("2.0.0", "2.0.1")));
}
