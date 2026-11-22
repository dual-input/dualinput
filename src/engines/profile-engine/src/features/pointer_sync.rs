//! Pointer sync's module: the `displays` block, the instruments pointer sync plays presses into,
//! by the identifiers our FS Copilot fork's `pointer:` took
//! (record/areas/profiles/01-format-and-delivery.md, "Displays").

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::blocks::field;
use crate::bundle::{Out, scalar};
use crate::check::Checker;
use crate::features::{self, Module};
use crate::format::Resolved;
use crate::tree::{Key, Node};

pub(crate) const MODULE: Module = Module {
    blocks: &[field(
        "displays",
        1,
        "The instruments pointer sync plays presses into: an identifier, for every instrument that carries it, or a full key, identifier|query, for one",
    )],
    state_fields: &[],
    event_fields: &[],
    check_block,
    check_field,
    emit_block,
    emit_fields,
    items: |_| &[],
    schema,
};

/// The identifier of every WASM instrument, which v1's pointer sync can't reach, since it plays
/// presses into HTML displays only, and the sim owns a WASM instrument's hit-testing
/// (read in the FS Copilot fork, FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js).
const WASM: &str = "WasmInstrument";

/// Pointer sync's blocks of a profile.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Blocks {
    /// Each display, by its identifier or its full key, the profile's first, then its modules'.
    pub displays: Vec<String>,
}

impl Blocks {
    /// A panel a variant lacks never appears, so the displays need no `only`, and every
    /// variant has them all.
    pub(crate) fn resolve(&self, _: &str) -> Blocks {
        self.clone()
    }
}

/// The displays the loaded profile names.
pub fn displays(profile: &Resolved) -> &[String] {
    &profile.features.pointer_sync.displays
}

fn check_block(c: &mut Checker, _: &Key, node: &Node) {
    for item in Checker::items(node) {
        let Some(display) = c.text(item, "Each display") else {
            continue;
        };
        if display.split('|').next() == Some(WASM) {
            c.error(
                &item.at,
                "displays-wasm",
                format!(
                    "`{display}` is a WASM instrument, and pointer sync plays presses into HTML displays only"
                ),
            );
            continue;
        }
        // A module's displays join its profile's, and one named twice is one display.
        let displays = &mut c.profile.features.pointer_sync.displays;
        if !displays.contains(&display) {
            displays.push(display);
        }
    }
}

fn check_field(_: &mut Checker, _: &Key, _: &Node, _: &mut features::EntryFields) {
    unreachable!("pointer sync adds no field to an entry")
}

fn emit_block(_: &str, blocks: &features::Blocks, out: &mut Out) {
    let displays = &blocks.pointer_sync.displays;
    if displays.is_empty() {
        return;
    }
    out.line(0, "displays:");
    for d in displays {
        out.line(1, &format!("- {}", scalar(d)));
    }
}

fn emit_fields(_: &features::EntryFields, _: &mut Out) {}

fn schema(key: &str) -> Value {
    match key {
        "displays" => {
            let display =
                json!({ "type": "string", "not": { "pattern": "^WasmInstrument(\\||$)" } });
            json!({ "anyOf": [display, { "type": "array", "items": display }] })
        }
        _ => json!({}),
    }
}
