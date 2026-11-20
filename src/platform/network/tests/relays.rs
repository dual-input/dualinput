//! Tests of the build script's default relay list. `cargo test` never runs tests inside a
//! build script, so this file compiles the script in as a module.

// Tests run off the core's loop, so they may read files, which the root's clippy.toml forbids
// only the loop.
#![allow(clippy::disallowed_methods)]

// The script's `main` and `read` go unused here, which would warn.
#[allow(dead_code)]
#[path = "../build.rs"]
mod build;

const LIST: &str = include_str!("../../../relays/relays.toml");

#[test]
fn a_build_with_the_tokens_takes_each_relays_newest() {
    let out = build::render(LIST, Some("fra = [\"new\", \"old\"]\n")).unwrap();
    assert!(
        out.contains(r#"("https://fra.relay.dualinput.app", "new", 262144)"#),
        "{out}"
    );
    assert!(!out.contains("old"), "{out}");
}

/// No release ships a relay it holds no token for.
#[test]
fn a_build_with_the_tokens_stops_at_a_relay_with_none() {
    let error = build::render(LIST, Some("sgp = [\"new\"]\n")).unwrap_err();
    assert!(error.contains("a token for the relay fra"), "{error}");
}

#[test]
fn a_build_without_the_tokens_lists_every_relay_with_none() {
    let out = build::render(LIST, None).unwrap();
    assert!(
        out.contains(r#"("https://fra.relay.dualinput.app", "", 262144)"#),
        "{out}"
    );
}
