//! What `serve`'s edits of a profile's text share, the display picker's `displays` and adding an
//! aircraft's `variants`: each reads the text's tree, changes its lines, and gives back the whole
//! text as the formatter writes it, with the file's own line ends.

use profile_engine::tree::{self, Kind, Node};
use profile_engine::{LAYOUT, plain, single_quoted};
use profile_language::{Edit, edit_between, format};

/// A text being edited: its tree, its lines with `\n` line ends, and its top-level keys, each with
/// its line from 0.
pub(crate) struct Editing {
    pub(crate) root: Node,
    pub(crate) lines: Vec<String>,
    pub(crate) top: Vec<(String, usize)>,
}

/// Reads `text` for an edit. A map written in brackets reads as nothing at its place, so lines
/// added under it would break the file; the file doesn't build with one anyway, so the edit waits
/// until it's written out. `what` names the edit for the error, as "Add".
pub(crate) fn read(text: &str, what: &str) -> Result<Editing, String> {
    let lf = text.replace("\r\n", "\n");
    let (root, bracketed) = tree::parse_keeping_brackets("profile.yaml", &lf).map_err(|_| {
        format!("the file's YAML doesn't parse, so {what} can't find where to write")
    })?;
    if !bracketed.is_empty() {
        return Err(format!(
            "the file has a map written in brackets, so {what} waits until it's written out"
        ));
    }
    let top = match &root.kind {
        Kind::Map(entries) => entries
            .iter()
            .map(|(k, _)| (k.text.clone(), k.at.line - 1))
            .collect(),
        _ => Vec::new(),
    };
    Ok(Editing {
        lines: lf.split('\n').map(str::to_string).collect(),
        root,
        top,
    })
}

/// The edit from `text` to `lines` as the formatter writes them, with `text`'s line ends, or none
/// when nothing changed.
pub(crate) fn finish(text: &str, lines: &[String]) -> Option<Edit> {
    let changed = lines.join("\n");
    let formatted = format(&changed).unwrap_or(changed);
    let formatted = if text.contains("\r\n") {
        formatted.replace('\n', "\r\n")
    } else {
        formatted
    };
    edit_between(text, &formatted)
}

/// The line, from 0, where a new top-level `key` goes: before the first top-level key the
/// format's layout puts after it, with the comments above that key left with it, or at the end.
pub(crate) fn new_key_line(editing: &Editing, key: &str) -> usize {
    let place = |key: &str| {
        LAYOUT
            .iter()
            .position(|k| *k == key)
            .unwrap_or(LAYOUT.len())
    };
    let after = place(key);
    let next = editing
        .top
        .iter()
        .find(|(k, _)| place(k) > after)
        .map_or(editing.lines.len(), |&(_, line)| line);
    let mut at = next;
    while at > 0 && is_run_line(&editing.lines[at - 1]) {
        at -= 1;
    }
    at
}

/// A value as a line writes it: plain where YAML reads it as the same text, or in single quotes.
pub(crate) fn scalar(value: &str) -> String {
    if plain(value) {
        value.to_string()
    } else {
        single_quoted(value)
    }
}

/// A blank line or a comment, which sits above the key below it.
pub(crate) fn is_run_line(line: &str) -> bool {
    let t = line.trim();
    t.is_empty() || t.starts_with('#')
}
