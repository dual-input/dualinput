//! Navigation across a profile, its modules, and the profiles that import a module
//! (record/areas/profiles/03-the-extension.md, "Navigation"): Go to Definition, Find All
//! References, and Rename of an entry's key, and Go to Symbol in Workspace.
//!
//! A script reads an entry as `state.<key>`, and since a script may declare no `state` of its
//! own, every `state.<key>` in a script's text is a read of the entry `<key>`, so the reads are
//! found by their text, with no TypeScript. A module's scripts run in the program of each profile
//! that imports it, so an entry's reads are those in every program that holds the entry's file.

use std::collections::BTreeMap;

use profile_engine::{is_entry_key, module_file};

use crate::complete::{inline_script, parents, variant_ids};
use crate::outline::{self, Head, Outline, flow_items, indent_of};
use crate::{Edit, Pos, Range};

/// The profiles and modules an editor works across, each by its path from `profiles/`, as
/// `aircraft/bksq-baronpro.yaml` or `modules/kfc-150.yaml`, with its text.
#[derive(Default)]
pub struct Workspace<'a> {
    pub files: BTreeMap<&'a str, &'a str>,
}

/// A place in one of the workspace's files.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Location {
    pub path: String,
    pub range: Range,
}

/// An entry, as Go to Symbol in Workspace finds it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EntrySymbol {
    pub path: String,
    pub key: String,
    /// Its `name:`, or its key when it has none.
    pub name: String,
    pub event: bool,
    pub range: Range,
}

/// The modules a file imports, each as its file's path from `profiles/`, with the import's text.
pub fn imports(text: &str) -> Vec<(String, Range)> {
    let o = outline::parse(text);
    let Some(item) = o.top("import") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut push = |raw: &str, range: Range| {
        if let Some(file) = outline::unquote(raw).and_then(|t| module_file(t.trim())) {
            out.push((file, range));
        }
    };
    match item.value() {
        Some(v) => match flow_items(&v.raw) {
            Some(items) => items.iter().for_each(|i| push(i, v.range(item.line))),
            None => push(&v.raw, v.range(item.line)),
        },
        None => {
            for c in &item.children {
                if let Some(v) = c.value() {
                    push(&v.raw, v.range(c.line));
                }
            }
        }
    }
    out
}

/// Where Go to Definition goes from `at`: from `state.<key>` in a script to its entry, from an
/// import to its module's file, and from a variant ID to its line under `variants`.
pub fn definition(ws: &Workspace, path: &str, at: Pos) -> Vec<Location> {
    let Some(text) = ws.files.get(path) else {
        return Vec::new();
    };
    if let Some(read) = reads(text).into_iter().find(|r| r.span.contains(at)) {
        let mut found: Vec<Location> = scope(ws, path)
            .iter()
            .flat_map(|f| declarations(ws, f, &read.key))
            .collect();
        found.sort();
        found.dedup();
        return found;
    }
    if let Some((file, _)) = imports(text).into_iter().find(|(_, r)| r.contains(at)) {
        let start = Range::new(Pos::new(1, 1), Pos::new(1, 1));
        return if ws.files.contains_key(file.as_str()) {
            vec![Location {
                path: file,
                range: start,
            }]
        } else {
            Vec::new()
        };
    }
    variant_at(text, at)
        .and_then(|id| variant_key(text, &id))
        .map(|range| {
            vec![Location {
                path: path.to_string(),
                range,
            }]
        })
        .unwrap_or_default()
}

/// Every script's read of the entry at `at`, an entry's key or a `state.<key>`, across every
/// program that holds the entry, with the entry's key itself when `declaration`.
pub fn references(ws: &Workspace, path: &str, at: Pos, declaration: bool) -> Vec<Location> {
    let Some(key) = entry_at(ws, path, at) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for file in reach(ws, path, &key) {
        let Some(text) = ws.files.get(file.as_str()) else {
            continue;
        };
        for read in reads(text) {
            if read.key == key {
                out.push(Location {
                    path: file.clone(),
                    range: read.range,
                });
            }
        }
        if declaration {
            out.extend(declarations(ws, &file, &key));
        }
    }
    out.sort();
    out.dedup();
    out
}

/// The range Rename renames at `at`: an entry's key, or the key of a `state.<key>`.
pub fn prepare_rename(text: &str, at: Pos) -> Option<Range> {
    reads(text)
        .into_iter()
        .find(|r| r.span.contains(at))
        .map(|r| r.range)
        .or_else(|| {
            entries(text)
                .into_iter()
                .map(|e| e.range)
                .find(|r| r.contains(at))
        })
}

/// The edits that rename the entry at `at` to `new`, its key and every `state.<key>` that reads
/// it, by file.
pub fn rename(
    ws: &Workspace,
    path: &str,
    at: Pos,
    new: &str,
) -> Result<Vec<(String, Vec<Edit>)>, String> {
    if !is_entry_key(new) {
        return Err(format!(
            "`{new}` isn't an entry's key, which is lowercase snake_case starting with a letter, as `battery_1`"
        ));
    }
    let key = entry_at(ws, path, at).ok_or("There's no entry's key here to rename")?;
    let files = reach(ws, path, &key);
    if files.iter().any(|f| !declarations(ws, f, new).is_empty()) {
        return Err(format!("`{new}` is already an entry's key there"));
    }
    let mut edits: BTreeMap<String, Vec<Edit>> = BTreeMap::new();
    for l in references(ws, path, at, true) {
        edits.entry(l.path).or_default().push(Edit {
            range: l.range,
            text: new.to_string(),
        });
    }
    Ok(edits.into_iter().collect())
}

/// Every entry across the workspace whose name or key holds `query`'s characters in order,
/// ignoring case.
pub fn workspace_symbols(ws: &Workspace, query: &str) -> Vec<EntrySymbol> {
    let query: Vec<char> = query.to_lowercase().chars().collect();
    let matches = |text: &str| {
        let mut want = query.iter().peekable();
        for c in text.to_lowercase().chars() {
            if want.peek() == Some(&&c) {
                want.next();
            }
        }
        want.peek().is_none()
    };
    ws.files
        .iter()
        .flat_map(|(path, text)| {
            entries(text).into_iter().map(move |mut e| {
                e.path = path.to_string();
                e
            })
        })
        .filter(|e| matches(&e.name) || matches(&e.key))
        .collect()
}

/// A script's `state.<key>`.
struct Read {
    key: String,
    /// The key's own text, which a rename replaces.
    range: Range,
    /// From `state` to the key's end, where Go to Definition and Find All References answer.
    span: Range,
}

/// Each `state.<key>` in a file's scripts.
fn reads(text: &str) -> Vec<Read> {
    let o = outline::parse(text);
    let mut out = Vec::new();
    for (_, item) in o.walk() {
        if item.key().as_deref() != Some("write") {
            continue;
        }
        if let Some(block) = &item.block {
            for &l in &block.lines {
                scan(o.line(l), l, 0, &mut out);
            }
        } else if let Some(v) = item.value()
            && inline_script(&v.raw)
        {
            scan(o.line(item.line), item.line, v.column, &mut out);
        }
    }
    out
}

fn ident(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '$'
}

/// Each `state.<key>` on line `l`, from 0, from its character `from`.
fn scan(line: &str, l: usize, from: usize, out: &mut Vec<Read>) {
    let chars: Vec<char> = line.chars().collect();
    let word: Vec<char> = "state".chars().collect();
    let mut i = from;
    while i + word.len() <= chars.len() {
        let starts = chars[i..i + word.len()] == word[..]
            && (i == 0 || !(ident(chars[i - 1]) || chars[i - 1] == '.'));
        if !starts {
            i += 1;
            continue;
        }
        let mut j = i + word.len();
        let skip = |j: &mut usize| {
            while chars.get(*j) == Some(&' ') {
                *j += 1;
            }
        };
        skip(&mut j);
        if chars.get(j) != Some(&'.') {
            i += 1;
            continue;
        }
        j += 1;
        skip(&mut j);
        let start = j;
        while j < chars.len() && ident(chars[j]) {
            j += 1;
        }
        if j > start && !chars[start].is_ascii_digit() {
            let at = |c: usize| Pos::new(l + 1, c + 1);
            out.push(Read {
                key: chars[start..j].iter().collect(),
                range: Range::new(at(start), at(j)),
                span: Range::new(at(i), at(j)),
            });
        }
        i = j.max(i + 1);
    }
}

/// A file's entries, in `state` and `events`.
fn entries(text: &str) -> Vec<EntrySymbol> {
    let o = outline::parse(text);
    let mut out = Vec::new();
    for (block, event) in [("state", false), ("events", true)] {
        let Some(item) = o.top(block) else {
            continue;
        };
        for e in &item.children {
            let (Some(key), Some(token)) = (e.key(), e.key_token()) else {
                continue;
            };
            out.push(EntrySymbol {
                path: String::new(),
                name: e.child_text("name").unwrap_or_else(|| key.clone()),
                key,
                event,
                range: token.range(e.line),
            });
        }
    }
    out
}

/// The key of the entry `key` in `file`, if it's there.
fn declarations(ws: &Workspace, file: &str, key: &str) -> Vec<Location> {
    let Some(text) = ws.files.get(file) else {
        return Vec::new();
    };
    entries(text)
        .into_iter()
        .filter(|e| e.key == key)
        .map(|e| Location {
            path: file.to_string(),
            range: e.range,
        })
        .collect()
}

/// The key of the entry at `at`: on an entry's key, or on a `state.<key>`.
fn entry_at(ws: &Workspace, path: &str, at: Pos) -> Option<String> {
    let text = ws.files.get(path)?;
    reads(text)
        .into_iter()
        .map(|r| (r.key, r.span))
        .chain(entries(text).into_iter().map(|e| (e.key, e.range)))
        .find(|(_, r)| r.contains(at))
        .map(|(k, _)| k)
}

/// The files whose scripts may read the entry `key` that `path` reads or declares: those of every
/// program holding a file of `path`'s programs that declares it.
fn reach(ws: &Workspace, path: &str, key: &str) -> Vec<String> {
    let declaring: Vec<String> = scope(ws, path)
        .into_iter()
        .filter(|f| !declarations(ws, f, key).is_empty())
        .collect();
    let mut out: Vec<String> = if declaring.is_empty() {
        scope(ws, path)
    } else {
        declaring.iter().flat_map(|d| scope(ws, d)).collect()
    };
    out.sort();
    out.dedup();
    out
}

/// A file and every module it imports, through the modules it imports too, of those the
/// workspace holds.
pub fn closure(ws: &Workspace, path: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut stack = vec![path.to_string()];
    while let Some(file) = stack.pop() {
        if out.contains(&file) {
            continue;
        }
        let Some(text) = ws.files.get(file.as_str()) else {
            continue;
        };
        stack.extend(imports(text).into_iter().rev().map(|(m, _)| m));
        out.push(file);
    }
    out
}

/// The roots of the programs that hold `path`: each profile whose imports reach it, or the
/// module itself when none does, which is checked against its own entries.
pub fn programs(ws: &Workspace, path: &str) -> Vec<String> {
    let holding: Vec<String> = ws
        .files
        .keys()
        .filter(|p| p.starts_with("aircraft/"))
        .filter(|p| closure(ws, p).iter().any(|f| f == path))
        .map(|p| p.to_string())
        .collect();
    if holding.is_empty() {
        vec![path.to_string()]
    } else {
        holding
    }
}

/// Every file of every program that holds `path`.
fn scope(ws: &Workspace, path: &str) -> Vec<String> {
    let mut out: Vec<String> = programs(ws, path)
        .iter()
        .flat_map(|p| closure(ws, p))
        .collect();
    out.sort();
    out.dedup();
    out
}

/// The variant ID at `at`, in an `only:` or as a `location:` map's key.
fn variant_at(text: &str, at: Pos) -> Option<String> {
    let o: Outline = outline::parse(text);
    let l = at.line.checked_sub(1)?;
    let line = o.line(l);
    let indent = indent_of(line);
    let path = parents(&o, l, indent)?;
    let column = at.column.checked_sub(1)?;
    let on = |t: &outline::Token| column >= t.column && column <= t.column + t.raw.chars().count();
    let id = match outline::head(line, indent).0 {
        Head::Key { key, .. }
            if on(&key) && path.last().map(String::as_str) == Some("location") =>
        {
            key.text()
        }
        Head::Key {
            key,
            value: Some(v),
        } if key.text().as_deref() == Some("only") && on(&v) => match flow_items(&v.raw) {
            Some(items) => {
                let offset = column - v.column;
                let mut from = 0;
                items.into_iter().find_map(|item| {
                    let start = v.raw[from..].find(&item)? + from;
                    from = start + item.len();
                    let s = v.raw[..start].chars().count();
                    let e = s + item.chars().count();
                    (offset >= s && offset <= e)
                        .then(|| outline::unquote(&item))
                        .flatten()
                })
            }
            None => v.text(),
        },
        Head::Dash { value: Some(v) }
            if path.last().map(String::as_str) == Some("only") && on(&v) =>
        {
            v.text()
        }
        _ => None,
    }?;
    variant_ids(&o).contains(&id).then_some(id)
}

/// The range of a variant's key under `variants`.
fn variant_key(text: &str, id: &str) -> Option<Range> {
    let o = outline::parse(text);
    let item = o.top("aircraft")?.child("variants")?.child(id)?;
    Some(item.key_token()?.range(item.line))
}
