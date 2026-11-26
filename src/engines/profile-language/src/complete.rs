//! Completion outside scripts, by place, from the profile engine's own tables, so an editor offers
//! exactly what the build takes, and the snippets, each only where it fits
//! (record/areas/profiles/03-the-extension.md, "Completion and hovers" and "Snippets"). Inside a
//! script, `in_script` says so, and the server asks TypeScript instead.

use profile_engine::{Call, Field, LEVEL, Table, fields, read_name};

use crate::outline::{self, Head, Outline, indent_of, is_blank, is_comment};
use crate::{Pos, Range};

/// What a completion needs to know beyond the file's own text.
pub struct Context<'a> {
    /// Whether the file is a module, in `profiles/modules/`, rather than a profile.
    pub module: bool,
    /// The modules a file may import, each as an import names it, as `modules/kfc-150`.
    pub modules: &'a [String],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompletionKind {
    Field,
    /// One of the few words a field takes, as `pilot_flying`.
    Word,
    Name,
    Variant,
    Module,
    Snippet,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Completion {
    pub label: String,
    pub kind: CompletionKind,
    /// Its one-line description.
    pub detail: Option<String>,
    /// What it writes, in the snippet syntax of the Language Server Protocol, where `$1` is the
    /// first blank and Tab moves to the next; a line after the first is indented from the
    /// cursor's line, which an editor adds.
    pub insert: String,
    /// The text it replaces, from where its place starts to the cursor.
    pub replace: Range,
    /// The text an editor sorts the list by, which keeps the tables' order.
    pub sort: String,
    /// Whether an editor should offer completion again once it's in, for the value it takes.
    pub again: bool,
}

/// Whether `at` is inside a script: a `write:` block's text, or a function written on its
/// `write:` line, where TypeScript completes, explains, and checks.
pub fn in_script(text: &str, at: Pos) -> bool {
    let o = outline::parse(text);
    let Some(l) = at.line.checked_sub(1) else {
        return false;
    };
    if let Some((item, _)) = o.block_at(l) {
        return item.key().as_deref() == Some("write");
    }
    let path = o.path(l);
    path.last().is_some_and(|item| {
        item.line == l
            && item.key().as_deref() == Some("write")
            && item
                .value()
                .is_some_and(|v| inline_script(&v.raw) && at.column > v.column)
    })
}

/// Whether a `write:` value written on its line is a function rather than a name, `none`, a map,
/// or a block's header.
pub(crate) fn inline_script(raw: &str) -> bool {
    let raw = raw.trim();
    !raw.is_empty()
        && raw != "none"
        && !raw.starts_with(['[', '{', '|', '>', '\'', '"'])
        && !Call::ALL.iter().any(|c| {
            raw.strip_prefix(c.word())
                .is_some_and(|rest| rest.trim_start().starts_with('('))
        })
}

/// The completions at `at`, outside a script.
pub fn complete(text: &str, at: Pos, cx: &Context) -> Vec<Completion> {
    let o = outline::parse(text);
    let Some(l) = at.line.checked_sub(1) else {
        return Vec::new();
    };
    if in_script(text, at) {
        return Vec::new();
    }
    let before: String = o
        .line(l)
        .chars()
        .take(at.column.saturating_sub(1))
        .collect();
    let indent = indent_of(&before);
    let typed = &before[indent..];
    let from = |column: usize| Range::new(Pos::new(at.line, column + 1), at);
    if typed.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        if alone(&o, l) {
            let snippet = if cx.module { &NEW_MODULE } else { &NEW_PROFILE };
            return vec![snippet.completion(from(indent), 0)];
        }
        let Some(path) = parents(&o, l, indent) else {
            return Vec::new();
        };
        return keys(&o, l, indent, &path, cx, from(indent));
    }
    values(&o, l, indent, typed, cx, at).unwrap_or_default()
}

/// Whether every line but `l` is blank or a comment, as in a new file.
fn alone(o: &Outline, l: usize) -> bool {
    (0..o.lines.len()).all(|k| k == l || is_blank(o.line(k)) || is_comment(o.line(k)))
}

/// The keys of the items that hold a line at `indent` below line `l`, from 0, the top-level one
/// first, by indentation alone, since the line may be half typed; none where the line would go
/// on with a value or a block's text.
pub(crate) fn parents(o: &Outline, l: usize, indent: usize) -> Option<Vec<String>> {
    let mut path = Vec::new();
    let mut need = indent;
    for k in (0..l).rev() {
        if need == 0 {
            break;
        }
        let text = o.line(k);
        if is_blank(text) || is_comment(text) || indent_of(text) >= need {
            continue;
        }
        let at = indent_of(text);
        match outline::head(text, at).0 {
            Head::Key { key, value: None } => path.push(key.text().unwrap_or(key.raw)),
            Head::Dash { value: None } => path.push("-".into()),
            _ => return None,
        }
        need = at;
    }
    path.reverse();
    Some(path)
}

/// The keys and values of the lines at `indent` beside line `l`, under the same item, with each
/// one's line.
pub(crate) fn siblings(
    o: &Outline,
    l: usize,
    indent: usize,
) -> Vec<(String, Option<String>, usize)> {
    let mut lines = Vec::new();
    let mut scan = |range: &mut dyn Iterator<Item = usize>| {
        for k in range {
            let text = o.line(k);
            if is_blank(text) || is_comment(text) {
                continue;
            }
            let at = indent_of(text);
            if at < indent {
                break;
            }
            if at == indent && k != l {
                lines.push(k);
            }
        }
    };
    scan(&mut (0..l).rev());
    scan(&mut (l + 1..o.lines.len()));
    lines.sort();
    lines
        .into_iter()
        .filter_map(|k| match outline::head(o.line(k), indent).0 {
            Head::Key { key, value } => {
                Some((key.text().unwrap_or(key.raw), value.map(|v| v.raw), k))
            }
            _ => None,
        })
        .collect()
}

/// The table whose fields an item at `path` holds.
pub(crate) fn table_of<'p>(path: &[&'p str]) -> Option<Table<'p>> {
    Some(match path {
        [] => Table::Top,
        ["aircraft"] => Table::Aircraft,
        ["state", _] => Table::StateEntry,
        ["events", _] => Table::EventEntry,
        ["state", _, "write"] => Table::Steps,
        ["state", _, "watch"] => Table::Count,
        [block, _] if !fields(Table::Item(block)).is_empty() => Table::Item(block),
        _ => return None,
    })
}

/// The field `key` names at `path`, a write map's `toggle` among them.
pub(crate) fn field_at(path: &[&str], key: &str) -> Option<Field> {
    let table = table_of(path)?;
    let mut found = fields(table);
    if table == Table::Steps {
        found.extend(fields(Table::Toggle));
    }
    found.into_iter().find(|f| f.key == key)
}

/// The profile's variants' IDs, in its file's order.
pub(crate) fn variant_ids(o: &Outline) -> Vec<String> {
    o.top("aircraft")
        .and_then(|a| a.child("variants"))
        .map(|v| v.children.iter().filter_map(|c| c.key()).collect())
        .unwrap_or_default()
}

fn keys(
    o: &Outline,
    l: usize,
    indent: usize,
    path: &[String],
    cx: &Context,
    replace: Range,
) -> Vec<Completion> {
    let present: Vec<String> = siblings(o, l, indent)
        .into_iter()
        .map(|(k, _, _)| k)
        .collect();
    let has = |key: &str| present.iter().any(|p| p == key);
    let p: Vec<&str> = path.iter().map(String::as_str).collect();
    let mut out = Vec::new();
    let snippets = |list: &[&Snippet], out: &mut Vec<Completion>| {
        for (n, s) in list.iter().enumerate() {
            out.push(s.completion(replace, n));
        }
    };
    match p.as_slice() {
        ["aircraft", "variants"] => snippets(&[&VARIANT], &mut out),
        ["state"] => snippets(
            &[&STATE_ENTRY, &WATCH_ONLY, &COUNTED, &SECTION, &SUBSECTION],
            &mut out,
        ),
        ["events"] => snippets(&[&EVENT_ENTRY, &SECTION, &SUBSECTION], &mut out),
        ["state", _, "write"] => {
            let counted = counted_entry(o, l, indent);
            if present.is_empty() {
                out.push(field(&fields(Table::Toggle)[0], 0, replace));
                let steps = if counted { &COUNTED_STEPS } else { &STEPS };
                out.push(steps.completion(replace, 1));
            } else if !has("toggle") {
                for (n, f) in fields(Table::Steps).iter().enumerate() {
                    let refused = counted && matches!(f.key, "wrap" | "range");
                    if !has(f.key) && !refused {
                        out.push(field(f, n, replace));
                    }
                }
            }
        }
        ["state" | "events", _, "location"] => {
            for (n, id) in variant_ids(o).into_iter().enumerate() {
                if !has(&id) {
                    out.push(Completion {
                        label: id.clone(),
                        kind: CompletionKind::Variant,
                        detail: Some("A variant's point".into()),
                        insert: format!("{id}: [${{1:0}}, ${{2:0}}, ${{3:0}}]"),
                        replace,
                        sort: format!("0{n:02}"),
                        again: false,
                    });
                }
            }
        }
        ["seats"] => snippets(&[&SEAT], &mut out),
        _ => {
            let Some(table) = table_of(&p) else {
                return out;
            };
            for (n, f) in fields(table).iter().enumerate() {
                let refused = f.level > LEVEL || (cx.module && f.profile_only);
                if !has(f.key) && !refused {
                    out.push(field(f, n, replace));
                }
            }
        }
    }
    out
}

/// Whether the entry a write map at `indent` below line `l` belongs to counts events into a
/// shadow value, so its write steps by the count's `wrap` and `range`.
fn counted_entry(o: &Outline, l: usize, indent: usize) -> bool {
    let write = (0..l)
        .rev()
        .find(|&k| !is_blank(o.line(k)) && indent_of(o.line(k)) < indent);
    write.is_some_and(|w| counts(o, w, indent_of(o.line(w))))
}

/// Whether the field on line `l` holds a map or a block on the lines below it: the next line with
/// text is indented past the field's.
fn holds_lines_below(o: &Outline, l: usize) -> bool {
    let indent = indent_of(o.line(l));
    (l + 1..o.lines.len())
        .find(|&k| !is_blank(o.line(k)))
        .is_some_and(|k| indent_of(o.line(k)) > indent)
}

/// Whether the entry whose field is on line `l`, at `indent`, counts events into a shadow value:
/// its `watch:` is a map, on the lines below it.
fn counts(o: &Outline, l: usize, indent: usize) -> bool {
    siblings(o, l, indent)
        .iter()
        .any(|(k, v, _)| k == "watch" && v.is_none())
}

/// A field's completion, which writes its key and offers its value next.
fn field(f: &Field, n: usize, replace: Range) -> Completion {
    let key = f.key;
    let insert = match key {
        "aircraft" => "aircraft:\n  variants:\n    $0".to_string(),
        "state" | "events" | "seats" | "variants" => format!("{key}:\n  $0"),
        "location" | "hip" => format!("{key}: [${{1:0}}, ${{2:0}}, ${{3:0}}]"),
        "knees" | "feet" | "eye" => format!("{key}: [${{1:0}}, ${{2:0}}]"),
        "range" => "range: [${1:0}, ${2:359}]".to_string(),
        _ => format!("{key}: $0"),
    };
    let again = f.names.is_some() || !f.words.is_empty() || matches!(key, "only" | "import");
    Completion {
        label: key.to_string(),
        kind: CompletionKind::Field,
        detail: Some(f.about.to_string()),
        insert,
        replace,
        sort: format!("0{n:02}"),
        again,
    }
}

/// The completions for a value, after `key: ` or `- ` on the line typed so far.
fn values(
    o: &Outline,
    l: usize,
    indent: usize,
    typed: &str,
    cx: &Context,
    at: Pos,
) -> Option<Vec<Completion>> {
    let path = parents(o, l, indent)?;
    let typed_chars = typed.chars().count();
    let (key, path, mut start, space) = if let Some(rest) = typed.strip_prefix("- ") {
        let (key, path) = path.split_last()?;
        let lead = rest.len() - rest.trim_start().len();
        (key.clone(), path.to_vec(), indent + 2 + lead, "")
    } else {
        let Head::Key { key, value } = outline::head(typed, 0).0 else {
            return None;
        };
        let start = value.as_ref().map_or(typed_chars, |v| v.column);
        let space = if typed.ends_with(':') { " " } else { "" };
        (key.text().unwrap_or(key.raw), path, indent + start, space)
    };
    // Inside a list in brackets, the value starts after the bracket or the last comma.
    let line: Vec<char> = o.line(l).chars().collect();
    let cursor = at.column - 1;
    if line.get(start) == Some(&'[') {
        let inner = line[start..cursor]
            .iter()
            .rposition(|c| matches!(c, '[' | ','))?;
        start += inner + 1;
        while line.get(start) == Some(&' ') && start < cursor {
            start += 1;
        }
    }
    let replace = Range::new(Pos::new(at.line, start + 1), at);
    let p: Vec<&str> = path.iter().map(String::as_str).collect();
    let mut out = Vec::new();
    let mut push = |label: String, kind, detail: Option<String>, insert: String, sort: String| {
        out.push(Completion {
            label,
            kind,
            detail,
            insert: format!("{space}{insert}"),
            replace,
            sort,
            again: false,
        });
    };
    if key == "only" {
        for (n, id) in variant_ids(o).into_iter().enumerate() {
            push(
                id.clone(),
                CompletionKind::Variant,
                None,
                id,
                format!("0{n:02}"),
            );
        }
        return Some(out);
    }
    if key == "import" && p.is_empty() {
        for (n, m) in cx.modules.iter().enumerate() {
            push(
                m.clone(),
                CompletionKind::Module,
                None,
                m.clone(),
                format!("0{n:02}"),
            );
        }
        return Some(out);
    }
    let f = field_at(&p, &key)?;
    for (n, word) in f.words.iter().enumerate() {
        let w = word.to_string();
        push(w.clone(), CompletionKind::Word, None, w, format!("0{n:02}"));
    }
    if let Some(allowed) = f.names {
        // An event entry's write is most often the name its watch gives.
        if key == "write" && matches!(p.as_slice(), ["events", _]) {
            let watch = siblings(o, l, indent)
                .into_iter()
                .find(|(k, _, _)| k == "watch")
                .and_then(|(_, v, _)| read_name(&outline::unquote(&v?)?));
            if let Some(name) = watch {
                let name = name.to_string();
                let detail = Some("The name the entry's watch gives".to_string());
                push(
                    name.clone(),
                    CompletionKind::Name,
                    detail,
                    name,
                    "00".into(),
                );
            }
        }
        for (n, call) in allowed.calls().iter().enumerate() {
            let detail = Some(about(*call).to_string());
            push(
                call.blank().into(),
                CompletionKind::Name,
                detail,
                blanks(*call),
                format!("1{n:02}"),
            );
        }
    }
    // The forms a write takes besides a name and `none` come after the names, on `write:` itself,
    // which an author reaches by typing it or by picking the field. An event entry's write takes
    // no map, since an event has no value of the cockpit's to compare or step from. A write that
    // already holds a map or a block on the lines below gets none, since a form would add a second.
    if key == "write" && !holds_lines_below(o, l) {
        let forms: &[&Snippet] = match p.as_slice() {
            ["state", _] if counts(o, l, indent) => &[&TOGGLE, &COUNTED_STEPPING, &FUNCTION],
            ["state", _] => &[&TOGGLE, &STEPPING, &FUNCTION],
            ["events", _] => &[&FUNCTION],
            _ => &[],
        };
        for (n, s) in forms.iter().enumerate() {
            // A map starts on the line below, so it takes no space after the colon.
            let lead = if s.body.starts_with('\n') { "" } else { space };
            out.push(Completion {
                insert: format!("{lead}{}", s.body),
                sort: format!("2{n:02}"),
                ..s.completion(replace, n)
            });
        }
    }
    Some(out)
}

/// A call with a blank in each of its quotes, as `A('$1', '$2')`.
fn blanks(call: Call) -> String {
    let mut out = String::new();
    for (n, part) in call.blank().split("''").enumerate() {
        if n > 0 {
            out.push_str(&format!("'${n}'"));
        }
        out.push_str(part);
    }
    out
}

fn about(call: Call) -> &'static str {
    match call {
        Call::L => "An L: variable, in its unit, Number unless given",
        Call::A => "An A: variable, in its unit",
        Call::B => "An input event",
        Call::K => "A K: event",
        Call::H => "An H: event",
        Call::Instrument => "A value in a gauge's JavaScript, by the instrument's key and a path",
    }
}

/// A snippet, which writes its fields in their table's order, as the formatter would, with the
/// caret on its first blank, the entry's key where it has one.
pub(crate) struct Snippet {
    pub(crate) label: &'static str,
    pub(crate) detail: &'static str,
    pub(crate) body: &'static str,
}

impl Snippet {
    fn completion(&self, replace: Range, n: usize) -> Completion {
        Completion {
            label: self.label.to_string(),
            kind: CompletionKind::Snippet,
            detail: Some(self.detail.to_string()),
            insert: self.body.to_string(),
            replace,
            sort: format!("1{n:02}"),
            again: false,
        }
    }
}

/// The checker refuses an empty `state:`, so a new file's snippet writes one entry with blanks.
/// Its variant, `id: folder` with its placeholders untouched, is one the profile extension's Add
/// takes the place of, as `PLACEHOLDER` in tools/profile-builder/src/serve/variants.rs has it, so
/// change both together.
pub(crate) const NEW_PROFILE: Snippet = Snippet {
    label: "new profile",
    detail: "A profile: its maker, name, status, authors, one variant, and one state entry",
    body: "maker: ${1:maker}\nname: ${2:model}\nstatus: ${3|partial,complete,flawless,experimental|}\nauthors: ${4:authors}\n\naircraft:\n  variants:\n    ${5:id}: ${6:folder}\n\nstate:\n  ${7:key}:\n    name: ${8:name}\n    watch: L('${9}')\n    write: L('${9}')\n",
};

pub(crate) const NEW_MODULE: Snippet = Snippet {
    label: "new module",
    detail: "A module: its authors and one state entry",
    body: "authors: ${1:authors}\n\nstate:\n  ${2:key}:\n    name: ${3:name}\n    watch: L('${4}')\n    write: L('${4}')\n",
};

const STATE_ENTRY: Snippet = Snippet {
    label: "state entry",
    detail: "A state entry whose write takes the name its watch gives",
    body: "${1:key}:\n  name: ${2:name}\n  watch: L('${3}')\n  write: L('${3}')",
};

const WATCH_ONLY: Snippet = Snippet {
    label: "watch-only entry",
    detail: "A state entry that's watched and never written",
    body: "${1:key}:\n  name: ${2:name}\n  watch: L('${3}')\n  write: none",
};

const COUNTED: Snippet = Snippet {
    label: "counted entry",
    detail: "A state entry that counts events into a shadow value, and steps it",
    body: "${1:key}:\n  name: ${2:name}\n  watch:\n    inc: K('${3}')\n    dec: K('${4}')\n    wrap: ${5|false,true|}\n    range: [${6:0}, ${7:100}]\n  write:\n    inc: K('${3}')\n    dec: K('${4}')\n  default: ${8:0}",
};

const EVENT_ENTRY: Snippet = Snippet {
    label: "event entry",
    detail: "An event entry whose write sends the event its watch gives",
    body: "${1:key}:\n  name: ${2:name}\n  watch: K('${3}')\n  write: K('${3}')",
};

// The four forms below are `write:`'s value, so each starts after `write:`, a map on the line
// below it.

const TOGGLE: Snippet = Snippet {
    label: "toggle",
    detail: "A write that sends an event when the wanted value differs",
    body: "\n  toggle: K('${1}')",
};

const STEPPING: Snippet = Snippet {
    label: "stepping write",
    detail: "A write that steps the control with inc and dec",
    body: "\n  inc: K('${1}')\n  dec: K('${2}')\n  wrap: ${3|false,true|}\n  range: [${4:0}, ${5:359}]",
};

/// A counted entry's write steps by the count's `wrap` and `range`.
const COUNTED_STEPPING: Snippet = Snippet {
    label: "stepping write",
    detail: "A write that steps the count with inc and dec",
    body: "\n  inc: K('${1}')\n  dec: K('${2}')",
};

const FUNCTION: Snippet = Snippet {
    label: "write function",
    detail: "A write function, which writes through write()",
    body: "|\n  (value) => {\n    write(L('${1}'), value)\n  }",
};

/// `inc` in an empty write map, with the fields that go with it.
const STEPS: Snippet = Snippet {
    label: "inc",
    detail: "inc, with dec, wrap, and range",
    body: "inc: K('${1}')\ndec: K('${2}')\nwrap: ${3|false,true|}\nrange: [${4:0}, ${5:359}]",
};

/// `inc` in a counted entry's write map, which steps by the count's `wrap` and `range`.
const COUNTED_STEPS: Snippet = Snippet {
    label: "inc",
    detail: "inc, with dec",
    body: "inc: K('${1}')\ndec: K('${2}')",
};

const SECTION: Snippet = Snippet {
    label: "section",
    detail: "A section's heading, # ═══ TITLE",
    body: "# ═══ ${1:TITLE}",
};

const SUBSECTION: Snippet = Snippet {
    label: "subsection",
    detail: "A subsection's heading, # ── Title",
    body: "# ── ${1:Title}",
};

const SEAT: Snippet = Snippet {
    label: "seat",
    detail: "A seat, with zeros to tune",
    body: "${1:key}:\n  name: ${2:name}\n  hip: [0, 0, 0]\n  knees: [0, 0]\n  feet: [0, 0]\n  eye: [0, 0]",
};

const VARIANT: Snippet = Snippet {
    label: "variant",
    detail: "A variant: a short ID and its SimObjects folder",
    body: "${1:id}: ${2:folder}",
};
