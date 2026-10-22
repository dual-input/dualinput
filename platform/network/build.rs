//! Compiles each release's default relay list from relays/relays.toml, with each relay's
//! newest token from a clone of the private repository dual-input/relay-tokens, which
//! `DUALINPUT_RELAY_TOKENS` names (record/areas/network/02-units.md, "Their configuration").
//!
//! A build without that variable, a developer's or a pull request's, compiles the list with
//! no tokens, so its cores reach no relay of ours until a setting names one, and the bench
//! names its own. A build with it stops when a relay has no token, so no release ships a relay
//! it can't use (record/areas/build/01-the-build.md, "A release"). tests/relays.rs compiles
//! this file into the tests to check both.

// A build script runs at build time, off the core's loop, so it may read files and the
// environment, which the root's clippy.toml forbids only the loop.
#![allow(clippy::disallowed_methods)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;

#[derive(Deserialize)]
struct Relays {
    relay: Vec<Relay>,
}

#[derive(Deserialize)]
struct Relay {
    region: String,
    url: String,
    cap: u32,
}

/// tokens.toml in dual-input/relay-tokens: each region's tokens, newest first, as
/// `nyc = ["newest", "older"]`.
type Tokens = BTreeMap<String, Vec<String>>;

fn main() {
    let manifest = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("cargo should set CARGO_MANIFEST_DIR"),
    );
    let list = manifest.join("../../relays/relays.toml");
    println!("cargo::rerun-if-changed={}", list.display());
    println!("cargo::rerun-if-env-changed=DUALINPUT_RELAY_TOKENS");
    let tokens = std::env::var_os("DUALINPUT_RELAY_TOKENS").map(|folder| {
        let file = Path::new(&folder).join("tokens.toml");
        println!("cargo::rerun-if-changed={}", file.display());
        read(&file)
    });
    let out = render(&read(&list), tokens.as_deref()).unwrap_or_else(|e| panic!("{e}"));
    let dest = PathBuf::from(std::env::var("OUT_DIR").expect("cargo should set OUT_DIR"))
        .join("relays.rs");
    std::fs::write(&dest, out).expect("OUT_DIR should be writable");
}

/// The Rust of the default list: each relay's URL, newest token, and cap, with no tokens when
/// `tokens` is `None`, and an error naming a relay that tokens.toml gives none.
pub(crate) fn render(list: &str, tokens: Option<&str>) -> Result<String, String> {
    let relays: Relays =
        toml::from_str(list).map_err(|e| format!("relays/relays.toml should read: {e}"))?;
    let tokens: Option<Tokens> = tokens
        .map(|t| toml::from_str(t).map_err(|e| format!("tokens.toml should read: {e}")))
        .transpose()?;
    let mut out = String::from(
        "/// Each default relay's URL, newest token, and cap, from relays/relays.toml.\npub(crate) const DEFAULT_RELAYS: &[(&str, &str, u32)] = &[\n",
    );
    for relay in &relays.relay {
        let token = match &tokens {
            Some(tokens) => tokens
                .get(&relay.region)
                .and_then(|t| t.first())
                .ok_or_else(|| {
                    format!(
                        "dual-input/relay-tokens should hold a token for the relay {}",
                        relay.region
                    )
                })?
                .clone(),
            None => String::new(),
        };
        out.push_str(&format!(
            "    ({:?}, {:?}, {}),\n",
            relay.url, token, relay.cap
        ));
    }
    out.push_str("];\n");
    Ok(out)
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("{} should be readable: {e}", path.display()))
}
