//! A bundle's bytes, laid out one way, so the same files and the same builder give the same
//! bytes on any PC, and its hash (record/areas/profiles/02-units.md, "A bundle's bytes").
//!
//! The top-level keys come in one fixed order, the entries in their source's order, each
//! entry's fields in the order of the format's tables, every script as a `|` block of the
//! compiled JavaScript, and every other value plain where YAML allows it, with no comments and
//! no `import`, in UTF-8 with LF line endings.

use saphyr::Scalar;
use sha2::{Digest, Sha256};

use crate::format::{Count, EventEntry, Owner, Profile, StateEntry, Steps, Watch, Write};
use crate::names::Name;

/// SHA-256 over the bytes, in lowercase hex, which Windows' `Get-FileHash` gives too, so anyone
/// can check a bundle against its name.
pub fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub(crate) fn emit(p: &Profile) -> Vec<u8> {
    let mut out = Out::default();
    if let Some(authors) = &p.authors {
        out.line(0, &format!("authors: {}", scalar(authors)));
    }
    out.line(0, "aircraft:");
    out.line(1, "variants:");
    for v in &p.aircraft.variants {
        match v.paths.as_slice() {
            [one] => out.line(2, &format!("{}: {}", scalar(&v.id), scalar(one))),
            paths => {
                out.line(2, &format!("{}:", scalar(&v.id)));
                for path in paths {
                    out.line(3, &format!("- {}", scalar(path)));
                }
            }
        }
    }
    if let Some(pace) = p.aircraft.pace {
        out.line(1, &format!("pace: {pace}"));
    }
    if !p.state.is_empty() {
        out.line(0, "state:");
        for e in &p.state {
            state_entry(&mut out, e);
        }
    }
    if !p.events.is_empty() {
        out.line(0, "events:");
        for e in &p.events {
            event_entry(&mut out, e);
        }
    }
    out.text.into_bytes()
}

fn state_entry(out: &mut Out, e: &StateEntry) {
    out.line(1, &format!("{}:", e.key));
    out.line(2, &format!("name: {}", scalar(&e.name)));
    match &e.watch {
        Watch::Name(n) => out.line(2, &format!("watch: {}", name(n))),
        Watch::Count(c) => count(out, c),
    }
    write(out, &e.write);
    if let Watch::Count(c) = &e.watch {
        out.line(2, &format!("default: {}", c.default));
    }
    if e.owner == Owner::PilotFlying {
        out.line(2, "owner: pilot_flying");
    }
    list(out, "only", e.only.iter().map(|s| scalar(s)));
    list(out, "ignore", e.ignore.iter().map(name));
}

fn event_entry(out: &mut Out, e: &EventEntry) {
    out.line(1, &format!("{}:", e.key));
    out.line(2, &format!("name: {}", scalar(&e.name)));
    out.line(2, &format!("watch: {}", name(&e.watch)));
    write(out, &e.write);
    list(out, "only", e.only.iter().map(|s| scalar(s)));
    list(out, "ignore", e.ignore.iter().map(name));
}

fn count(out: &mut Out, c: &Count) {
    out.line(2, "watch:");
    for (key, n) in [("inc", &c.inc), ("dec", &c.dec)] {
        if let Some(n) = n {
            out.line(3, &format!("{key}: {}", name(n)));
        }
    }
    if c.step != 1.0 {
        out.line(3, &format!("step: {}", c.step));
    }
    for (key, n) in [("set", &c.set), ("count", &c.count)] {
        if let Some(n) = n {
            out.line(3, &format!("{key}: {}", name(n)));
        }
    }
    out.line(3, &format!("wrap: {}", c.wrap));
    out.line(3, &format!("range: [{}, {}]", c.range.0, c.range.1));
}

fn write(out: &mut Out, w: &Write) {
    match w {
        Write::None => out.line(2, "write: none"),
        Write::Name(n) => out.line(2, &format!("write: {}", name(n))),
        Write::Toggle(n) => {
            out.line(2, "write:");
            out.line(3, &format!("toggle: {}", name(n)));
        }
        Write::Steps(s) => steps(out, s),
        Write::Function(js) => script(out, js),
    }
}

fn steps(out: &mut Out, s: &Steps) {
    let Steps {
        inc,
        dec,
        step,
        wrap,
        range,
        pace,
    } = s;
    out.line(2, "write:");
    out.line(3, &format!("inc: {}", name(inc)));
    out.line(3, &format!("dec: {}", name(dec)));
    if *step != 1.0 {
        out.line(3, &format!("step: {step}"));
    }
    if let Some(wrap) = wrap {
        out.line(3, &format!("wrap: {wrap}"));
    }
    if let Some((lo, hi)) = range {
        out.line(3, &format!("range: [{lo}, {hi}]"));
    }
    if let Some(pace) = pace {
        out.line(3, &format!("pace: {pace}"));
    }
}

/// A script as a `|` block, whose chomping indicator keeps its trailing line breaks exactly: `-`
/// for none, nothing for one, `+` for more, and whose indentation indicator, when its first line
/// starts with a space, says where its text starts.
fn script(out: &mut Out, js: &str) {
    let body = js.trim_end_matches('\n');
    let breaks = js.len() - body.len();
    let chomp = match breaks {
        0 => "-",
        1 => "",
        _ => "+",
    };
    let indent = if body.starts_with(' ') || body.starts_with('\n') {
        "2"
    } else {
        ""
    };
    out.line(2, &format!("write: |{indent}{chomp}"));
    for line in body.split('\n') {
        if line.is_empty() {
            out.text.push('\n');
        } else {
            out.line(3, line);
        }
    }
    for _ in 1..breaks {
        out.text.push('\n');
    }
}

fn list(out: &mut Out, key: &str, items: impl Iterator<Item = String>) {
    let items: Vec<String> = items.collect();
    if items.is_empty() {
        return;
    }
    out.line(2, &format!("{key}:"));
    for item in items {
        out.line(3, &format!("- {item}"));
    }
}

fn name(n: &Name) -> String {
    scalar(&n.to_string())
}

/// Text as a plain scalar where YAML reads it back as the same text, and double-quoted with
/// JSON's escapes, which YAML's double quotes take too, where it wouldn't.
fn scalar(s: &str) -> String {
    let plain = !s.is_empty()
        && s.trim() == s
        && !s.starts_with(|c: char| "-?:,[]{}#&*!|>'\"%@`".contains(c))
        && !s.ends_with(':')
        && !s.contains(": ")
        && !s.contains(" #")
        && !s.contains(['\n', '\r', '\t'])
        && matches!(Scalar::parse_from_cow(s.into()), Scalar::String(_));
    if plain {
        s.to_string()
    } else {
        serde_json::to_string(s).expect("serde_json should quote any text")
    }
}

#[derive(Default)]
struct Out {
    text: String,
}

impl Out {
    fn line(&mut self, depth: usize, line: &str) {
        for _ in 0..depth {
            self.text.push_str("  ");
        }
        self.text.push_str(line);
        self.text.push('\n');
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hash_is_lowercase_hex_sha_256() {
        assert_eq!(
            hash(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn text_yaml_would_read_as_something_else_is_quoted() {
        for (text, written) in [
            ("Left mixture", "Left mixture"),
            ("L('X')", "L('X')"),
            ("true", "\"true\""),
            ("12", "\"12\""),
            ("a: b", "\"a: b\""),
            ("- x", "\"- x\""),
            ("it's", "it's"),
        ] {
            assert_eq!(scalar(text), written);
        }
    }
}
