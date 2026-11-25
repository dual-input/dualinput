//! The formatter, which writes a file in the format's layout
//! (record/areas/profiles/01-format-and-delivery.md, "Layout";
//! record/areas/profiles/03-the-extension.md, "Formatting"): the top-level keys in `LAYOUT`'s order,
//! each with the comments above it, and an entry's fields in their table's order; 2 spaces to a
//! level; a bracketed map written out; a list of numbers or variant IDs on one line in brackets,
//! and any other list a line to an item; a value plain where YAML reads it as the same text, and
//! in single quotes where it doesn't; headings in Layout's forms; comments reflowed; and each
//! script in the layout `script` gives it.
//!
//! It never changes the order of entries, which is the author's and the bundle's, or the words of
//! a comment. A script that doesn't parse keeps its lines, only their indentation moving as a
//! whole. A file that doesn't parse gets no edits, and neither does one whose formatted text the
//! engine reads as a different profile, which only a mistake of the formatter's own could give.

use profile_engine::tree::{self, Kind, Node};
use profile_engine::{Diagnostic, LAYOUT, Place, Table, fields, plain, read_name, single_quoted};

use crate::comments::{WIDTH, reflow};
use crate::complete::inline_script;
use crate::outline::{
    self, Block, Head, Item, Outline, Token, comment_text, flow_items, indent_of, is_blank, unquote,
};
use crate::script::{canonical_script, format_script};
use crate::{Edit, Pos, Range};

/// The name the formatter gives the engine as a file's, for its errors.
const FILE: &str = "profile.yaml";

/// Why a file got no edits.
#[derive(Debug)]
pub enum Unformatted {
    /// It doesn't parse as YAML, with the engine's errors.
    Yaml(Vec<Diagnostic>),
    /// The formatted text read as a different profile.
    Changed,
}

/// The file written in the format's layout.
pub fn format(text: &str) -> Result<String, Unformatted> {
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let (before, brackets) = tree::parse_keeping_brackets(FILE, text).map_err(Unformatted::Yaml)?;
    let outline = outline::parse(text);
    let out = Writer {
        o: &outline,
        out: Vec::new(),
    }
    .file();
    let (after, _) = tree::parse_keeping_brackets(FILE, &out).map_err(|_| Unformatted::Changed)?;
    let brackets: Vec<Place> = brackets.into_iter().map(|d| d.at).collect();
    if !same(&root(&before, &brackets), &root(&after, &[])) {
        return Err(Unformatted::Changed);
    }
    Ok(out)
}

/// The one edit that turns `old` into `new`, over whole lines, or none when they're the same.
pub fn edit_between(old: &str, new: &str) -> Option<Edit> {
    if old == new {
        return None;
    }
    let o: Vec<char> = old.chars().collect();
    let n: Vec<char> = new.chars().collect();
    let mut prefix = o.iter().zip(&n).take_while(|(a, b)| a == b).count();
    let room = o.len().min(n.len()) - prefix;
    let suffix = (0..room)
        .take_while(|&i| o[o.len() - 1 - i] == n[n.len() - 1 - i])
        .count();
    // The edit starts at a line's start and ends at one, past the line break before it, so an
    // editor's undo shows whole lines.
    while prefix > 0 && o[prefix - 1] != '\n' {
        prefix -= 1;
    }
    let mut end = o.len() - suffix;
    while end < o.len() && (end == 0 || o[end - 1] != '\n') {
        end += 1;
    }
    let new_end = n.len() - (o.len() - end);
    Some(Edit {
        range: Range::new(place_of(&o, prefix), place_of(&o, end)),
        text: n[prefix..new_end].iter().collect(),
    })
}

fn place_of(chars: &[char], at: usize) -> Pos {
    let head = &chars[..at];
    let line = 1 + head.iter().filter(|c| **c == '\n').count();
    let column = 1 + head.iter().rev().take_while(|c| **c != '\n').count();
    Pos::new(line, column)
}

/// Whether a comment run opens its block, stands apart from the line above, or neither.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Lead {
    /// It opens its block, so a heading in it takes no blank line before it.
    First,
    /// A blank line before a heading only.
    None,
    /// A blank line before it, as each top-level key from `aircraft` on takes.
    Blank,
}

/// The table an item's children take their order from.
#[derive(Clone, Debug, PartialEq)]
enum Ctx {
    Top,
    Aircraft,
    /// `state` or `events`, whose entries keep their order.
    Entries(bool),
    Entry(bool),
    Write,
    Watch,
    /// A feature's block of items, as `seats`.
    Items(String),
    Item(String),
    /// A map whose keys keep their order, such as `variants`.
    Keep,
}

impl Ctx {
    fn child(&self, key: Option<&str>) -> Ctx {
        let key = key.unwrap_or("");
        match self {
            Ctx::Top => match key {
                "aircraft" => Ctx::Aircraft,
                "state" => Ctx::Entries(false),
                "events" => Ctx::Entries(true),
                k if !fields(Table::Item(k)).is_empty() => Ctx::Items(k.to_string()),
                _ => Ctx::Keep,
            },
            Ctx::Entries(event) => Ctx::Entry(*event),
            Ctx::Entry(_) => match key {
                "write" => Ctx::Write,
                "watch" => Ctx::Watch,
                _ => Ctx::Keep,
            },
            Ctx::Items(block) => Ctx::Item(block.clone()),
            _ => Ctx::Keep,
        }
    }

    /// The keys of the table this item's children take their order from, if they take one.
    fn order(&self, children: &[Item]) -> Option<Vec<&'static str>> {
        let table = match self {
            Ctx::Aircraft => Table::Aircraft,
            Ctx::Entry(false) => Table::StateEntry,
            Ctx::Entry(true) => Table::EventEntry,
            Ctx::Write
                if children
                    .iter()
                    .any(|c| c.key().as_deref() == Some("toggle")) =>
            {
                Table::Toggle
            }
            Ctx::Write => Table::Steps,
            Ctx::Watch => Table::Count,
            Ctx::Item(block) => Table::Item(block.as_str()),
            _ => return None,
        };
        Some(fields(table).iter().map(|f| f.key).collect())
    }
}

/// How a list is written.
#[derive(PartialEq, Eq)]
enum Form {
    /// On its key's line, in brackets.
    Flow,
    /// A line to an item.
    Lines,
}

/// A list of numbers or variant IDs goes on its key's line in brackets, and any other a line to
/// an item. `only` is the one field whose items are variant IDs.
fn form(key: &str, items: &[String]) -> Form {
    let number = |raw: &str| {
        !raw.starts_with(['\'', '"'])
            && raw.chars().any(|c| c.is_ascii_digit())
            && raw.parse::<f64>().is_ok()
    };
    if key == "only" || items.iter().all(|i| number(i)) {
        Form::Flow
    } else {
        Form::Lines
    }
}

struct Writer<'o, 't> {
    o: &'o Outline<'t>,
    out: Vec<String>,
}

impl<'t> Writer<'_, 't> {
    fn file(mut self) -> String {
        let place = |item: &Item| {
            item.key()
                .and_then(|k| LAYOUT.iter().position(|l| *l == k))
                .unwrap_or(LAYOUT.len())
        };
        let aircraft = LAYOUT
            .iter()
            .position(|k| *k == "aircraft")
            .expect("LAYOUT holds aircraft");
        let mut items: Vec<&Item> = self.o.items.iter().collect();
        items.sort_by_key(|i| place(i));
        for (n, item) in items.iter().enumerate() {
            let lead = match n {
                0 => Lead::First,
                _ if place(item) >= aircraft => Lead::Blank,
                _ => Lead::None,
            };
            self.run(&item.above, 0, lead);
            self.item(item, 0, &Ctx::Top.child(item.key().as_deref()));
        }
        // The comments after the last key stand apart from it, and the blank lines after them,
        // as after any key, go.
        if self.o.trailing.iter().any(|&l| !is_blank(self.o.line(l))) {
            let lead = if items.is_empty() {
                Lead::First
            } else {
                Lead::Blank
            };
            self.run(&self.o.trailing, 0, lead);
        }
        let mut text = self.out.join("\n");
        if !text.is_empty() {
            text.push('\n');
        }
        text
    }

    fn blank(&mut self) {
        if self.out.last().is_some_and(|l| !l.is_empty()) {
            self.out.push(String::new());
        }
    }

    /// The comment lines of a run, each comment's paragraphs reflowed, at `indent`, with one blank
    /// line between comments and before a heading that doesn't open its block.
    fn run(&mut self, lines: &[usize], indent: usize, lead: Lead) {
        let mut comments: Vec<Vec<&str>> = Vec::new();
        let mut comment = Vec::new();
        for &l in lines {
            let text = self.o.line(l);
            if is_blank(text) {
                if !comment.is_empty() {
                    comments.push(std::mem::take(&mut comment));
                }
            } else {
                comment.push(comment_text(text));
            }
        }
        if !comment.is_empty() {
            comments.push(comment);
        }
        let written: Vec<_> = comments.iter().map(|c| reflow(c, indent)).collect();
        let heading_first = written
            .first()
            .and_then(|c| c.first())
            .is_some_and(|w| w.heading);
        if lead == Lead::Blank || (lead == Lead::None && heading_first) {
            self.blank();
        }
        let pad = " ".repeat(indent);
        for (n, comment) in written.iter().enumerate() {
            if n > 0 {
                self.blank();
            }
            for (k, line) in comment.iter().enumerate() {
                if k > 0 && line.heading {
                    self.blank();
                }
                self.out.push(format!("{pad}{}", line.text));
            }
        }
    }

    /// An item at `indent`, its children taking their order from `ctx`, its own context.
    fn item(&mut self, item: &Item, indent: usize, ctx: &Ctx) {
        let pad = " ".repeat(indent);
        let comment = item
            .comment
            .as_ref()
            .map(|c| format!("{}{}", c.gap, c.text))
            .unwrap_or_default();
        match &item.head {
            Head::Text(text) => {
                self.out.push(format!("{pad}{text}"));
                self.more(item, indent);
            }
            Head::Key { key, value } => {
                let lead = format!("{pad}{}:", key_out(key));
                let key = item.key().unwrap_or_default();
                self.holding(item, value.as_ref(), &lead, &comment, indent, ctx, &key);
            }
            Head::Dash { value } => {
                let lead = format!("{pad}-");
                self.holding(item, value.as_ref(), &lead, &comment, indent, ctx, "");
            }
        }
    }

    /// An item's line, its key or dash written as `lead`, and what it holds.
    #[allow(clippy::too_many_arguments)]
    fn holding(
        &mut self,
        item: &Item,
        value: Option<&Token>,
        lead: &str,
        comment: &str,
        indent: usize,
        ctx: &Ctx,
        key: &str,
    ) {
        let Some(value) = value else {
            if let Some(items) = list_items(item)
                && form(key, &items) == Form::Flow
            {
                self.out.push(format!("{lead} {}{comment}", flow(&items)));
                return;
            }
            self.out.push(format!("{lead}{comment}"));
            self.items(&item.children, &item.trailing, indent + 2, ctx);
            return;
        };
        let room = WIDTH.saturating_sub(indent + 2);
        if let Some(block) = &item.block {
            self.out
                .push(format!("{lead} {}{comment}", header_out(&block.header)));
            // A folded block, `>`, joins its lines with spaces, so only a literal one, `|`, holds a
            // script's lines as they're written.
            let script = (key == "write" && block.header.starts_with('|'))
                .then(|| format_script(&self.block_lines(block).join("\n"), room))
                .flatten();
            match script {
                Some(script) => self.script(&script, indent + 2),
                None => self.block(block, indent + 2),
            }
            return;
        }
        if !item.more.is_empty() {
            self.out.push(format!("{lead} {}{comment}", value.raw));
            self.more(item, indent);
            return;
        }
        if value.raw.starts_with('{')
            && let Some(entries) = tree::bracketed_entries(&value.raw, 1)
            && !entries.is_empty()
        {
            self.out.push(format!("{lead}{comment}"));
            let children: Vec<Item> = entries.iter().map(|e| outline::entry(e)).collect();
            self.items(&children, &[], indent + 2, ctx);
            return;
        }
        if value.raw.starts_with('[')
            && let Some(items) = flow_items(&value.raw)
            && !items.is_empty()
        {
            if form(key, &items) == Form::Flow {
                self.out.push(format!("{lead} {}{comment}", flow(&items)));
            } else {
                self.out.push(format!("{lead}{comment}"));
                let pad = " ".repeat(indent + 2);
                for i in &items {
                    self.out.push(format!("{pad}- {}", value_out(i)));
                }
            }
            return;
        }
        // Layout writes every script as a block, so a script on the `write:` line goes below it. A
        // value YAML reads as a boolean, a number, or null, as `write: true`, isn't one: a block
        // would turn it into text, and the same-profile check would refuse the whole file.
        if key == "write"
            && inline_script(&value.raw)
            && plain(value.raw.trim())
            && let Some(script) = format_script(&value.raw, room)
        {
            self.out.push(format!("{lead} |{comment}"));
            self.script(&script, indent + 2);
            return;
        }
        self.out
            .push(format!("{lead} {}{comment}", value_out(&value.raw)));
    }

    /// A map's or a list's items at `indent`, a map's in its table's order, and the comments after
    /// its last.
    fn items(&mut self, children: &[Item], trailing: &[usize], indent: usize, ctx: &Ctx) {
        let mut ordered: Vec<&Item> = children.iter().collect();
        if let Some(keys) = ctx.order(children) {
            let place = |c: &Item| {
                c.key()
                    .and_then(|k| keys.iter().position(|o| *o == k))
                    .unwrap_or(keys.len())
            };
            ordered.sort_by_key(|c| place(c));
        }
        for (n, child) in ordered.iter().enumerate() {
            let lead = if n == 0 { Lead::First } else { Lead::None };
            self.run(&child.above, indent, lead);
            self.item(child, indent, &ctx.child(child.key().as_deref()));
        }
        let lead = if ordered.is_empty() {
            Lead::First
        } else {
            Lead::None
        };
        self.run(trailing, indent, lead);
    }

    /// A block's lines, moved to `indent` as a whole.
    fn block(&mut self, block: &Block, indent: usize) {
        let pad = " ".repeat(indent);
        for line in self.block_lines(block) {
            match line {
                "" => self.out.push(String::new()),
                text => self.out.push(format!("{pad}{text}")),
            }
        }
    }

    /// A block's lines without the block's indentation. A blank line's spaces past it are its
    /// text, so they stay.
    fn block_lines(&self, block: &Block) -> Vec<&'t str> {
        block
            .lines
            .iter()
            .map(|&l| {
                let text = self.o.line(l);
                match block.indent {
                    Some(old) if text.len() > old => &text[old..],
                    _ => "",
                }
            })
            .collect()
    }

    /// A formatted script's lines at `indent`.
    fn script(&mut self, script: &str, indent: usize) {
        let pad = " ".repeat(indent);
        for line in script.lines() {
            match line {
                "" => self.out.push(String::new()),
                text => self.out.push(format!("{pad}{text}")),
            }
        }
    }

    /// The lines a value goes on with, each at its depth below the item.
    fn more(&mut self, item: &Item, indent: usize) {
        for &l in &item.more {
            let text = self.o.line(l);
            if is_blank(text) {
                self.out.push(String::new());
                continue;
            }
            let depth = indent_of(text).saturating_sub(item.indent);
            self.out.push(format!(
                "{}{}",
                " ".repeat(indent + depth),
                text.trim_start_matches(' ').trim_end()
            ));
        }
    }
}

/// A list's items as its lines write them, if each is a value on its own line with nothing
/// else: no comment, and nothing below it.
fn list_items(item: &Item) -> Option<Vec<String>> {
    if item.children.is_empty() || !item.trailing.is_empty() {
        return None;
    }
    item.children
        .iter()
        .map(|c| match &c.head {
            Head::Dash { value: Some(v) }
                if c.above.is_empty()
                    && c.comment.is_none()
                    && c.children.is_empty()
                    && c.block.is_none()
                    && c.more.is_empty()
                    && !v.raw.starts_with(['[', '{', '|', '>']) =>
            {
                Some(v.raw.clone())
            }
            _ => None,
        })
        .collect()
}

/// A list's items in brackets, each written as the formatter writes a value, and quoted where a
/// bracket or a comma in it would end it.
fn flow(items: &[String]) -> String {
    let written: Vec<String> = items
        .iter()
        .map(|raw| {
            let v = value_out(raw);
            if !v.starts_with(['\'', '"']) && v.contains([',', '[', ']', '{', '}']) {
                single_quoted(&v)
            } else {
                v
            }
        })
        .collect();
    format!("[{}]", written.join(", "))
}

/// A block's header, `|` or `>` with what follows it, whose indentation indicator, if it has
/// one, becomes 2, since the block's text moves to 2 spaces past its key.
fn header_out(header: &str) -> String {
    header
        .chars()
        .map(|c| if c.is_ascii_digit() { '2' } else { c })
        .collect()
}

fn key_out(key: &Token) -> String {
    if !key.quoted() {
        return key.raw.clone();
    }
    match key.text() {
        Some(t) if !t.contains(['\n', '\r']) => quote_as_needed(&t),
        _ => key.raw.clone(),
    }
}

/// A value as the formatter writes it: a quoted one plain where YAML reads it as the same text,
/// and in single quotes where it doesn't, and a name in double quotes in single quotes. A value
/// written plain stays as it is, since YAML may read it as a number or `true`.
fn value_out(raw: &str) -> String {
    if raw.starts_with(['\'', '"']) {
        return match unquote(raw) {
            Some(t) if !t.contains(['\n', '\r']) => quote_as_needed(&t),
            _ => raw.to_string(),
        };
    }
    if raw.contains('"')
        && let Some(name) = read_name(raw)
    {
        return quote_as_needed(&name.to_string());
    }
    raw.to_string()
}

/// A text plain if YAML reads it so as the same text, or else in single quotes, a name in it in
/// single quotes of its own.
fn quote_as_needed(text: &str) -> String {
    let text = match read_name(text) {
        Some(name) if text.contains('"') => name.to_string(),
        _ => text.to_string(),
    };
    if plain(&text) {
        text
    } else {
        single_quoted(&text)
    }
}

/// A tree as the comparison of a file before and after reads it: its maps' keys sorted, but for
/// the entries of `state` and `events`, whose order is the bundle's, and each name in the single
/// quotes the formatter writes it in.
#[derive(Debug, PartialEq)]
enum Canon {
    /// A bracketed map, which the engine's tree leaves out, and the formatter writes out.
    Any,
    Null,
    Bool(bool),
    Number(u64),
    Text(String),
    Seq(Vec<Canon>),
    Map(Vec<(String, Canon)>),
}

fn root(node: &Node, brackets: &[Place]) -> Canon {
    let Kind::Map(entries) = &node.kind else {
        return canon(node, brackets, false);
    };
    let mut map: Vec<(String, Canon)> = entries
        .iter()
        .map(|(k, v)| {
            let ordered = k.text == "state" || k.text == "events";
            (k.text.clone(), canon(v, brackets, ordered))
        })
        .collect();
    map.sort_by(|a, b| a.0.cmp(&b.0));
    Canon::Map(map)
}

fn canon(node: &Node, brackets: &[Place], ordered: bool) -> Canon {
    match &node.kind {
        Kind::Null if brackets.contains(&node.at) => Canon::Any,
        Kind::Null => Canon::Null,
        Kind::Bool(b) => Canon::Bool(*b),
        Kind::Number(n) => Canon::Number(n.to_bits()),
        Kind::Str(t) => {
            Canon::Text(read_name(&t.text).map_or_else(|| t.text.clone(), |n| n.to_string()))
        }
        Kind::Seq(items) => Canon::Seq(items.iter().map(|i| canon(i, brackets, false)).collect()),
        Kind::Map(entries) => {
            let mut map: Vec<(String, Canon)> = entries
                .iter()
                .map(|(k, v)| {
                    let c = match &v.kind {
                        // The formatter lays a script out anew, so a script compares in the one
                        // form dprint gives it however its lines are written.
                        Kind::Str(t) if k.text == "write" && inline_script(&t.text) => {
                            canonical_script(&t.text).map(Canon::Text)
                        }
                        _ => None,
                    };
                    (
                        k.text.clone(),
                        c.unwrap_or_else(|| canon(v, brackets, false)),
                    )
                })
                .collect();
            if !ordered {
                map.sort_by(|a, b| a.0.cmp(&b.0));
            }
            Canon::Map(map)
        }
    }
}

fn same(a: &Canon, b: &Canon) -> bool {
    match (a, b) {
        (Canon::Any, _) | (_, Canon::Any) => true,
        (Canon::Seq(x), Canon::Seq(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(a, b)| same(a, b))
        }
        (Canon::Map(x), Canon::Map(y)) => {
            x.len() == y.len()
                && x.iter()
                    .zip(y)
                    .all(|((ka, a), (kb, b))| ka == kb && same(a, b))
        }
        _ => a == b,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn formatted(text: &str) -> String {
        format(text).unwrap_or_else(|e| panic!("{e:?}"))
    }

    #[test]
    fn an_edit_covers_the_lines_that_changed() {
        let edit = edit_between("a\nb\nc\n", "a\nB\nc\n").expect("an edit");
        assert_eq!(edit.range, Range::new(Pos::new(2, 1), Pos::new(3, 1)));
        assert_eq!(edit.text, "B\n");
        let edit = edit_between("a", "a\n").expect("an edit");
        assert_eq!(edit.range, Range::new(Pos::new(1, 1), Pos::new(1, 2)));
        assert_eq!(edit.text, "a\n");
        assert_eq!(edit_between("x\n", "x\n"), None);
    }

    #[test]
    fn values_go_plain_or_in_single_quotes() {
        let text = "state:\n  a:\n    name: \"Left mixture\"\n    description: 'Radio: COM1'\n    watch: L(\"X\")\n    write: \"true\"\n";
        let out = formatted(text);
        assert!(out.contains("name: Left mixture\n"), "{out}");
        assert!(out.contains("description: 'Radio: COM1'\n"), "{out}");
        assert!(out.contains("watch: L('X')\n"), "{out}");
        assert!(out.contains("write: 'true'\n"), "{out}");
    }

    #[test]
    fn a_script_takes_the_layout_and_one_that_doesnt_parse_keeps_its_lines() {
        let entry = "state:\n  a:\n    name: A\n    watch: B('X')\n";
        let messy = format!(
            "{entry}    write: |\n      (value) => {{\n          while (state.a === 2) {{\n\n      write(B('X'), value).every(\"1 frame\");\n            }}\n          }}\n"
        );
        assert_eq!(
            formatted(&messy),
            format!(
                "{entry}    write: |\n      (value) => {{\n        while (state.a === 2) {{\n          write(B('X'), value).every('1 frame')\n        }}\n      }}\n"
            )
        );
        let typing = format!("{entry}    write: |\n        (value) => {{\n          write(\n");
        assert_eq!(
            formatted(&typing),
            format!("{entry}    write: |\n      (value) => {{\n        write(\n")
        );
    }

    #[test]
    fn a_script_on_the_write_line_goes_into_a_block_and_keeps_to_the_width() {
        let entry = "state:\n  a:\n    name: A\n    watch: L('X')\n";
        let short = format!("{entry}    write: (value)=>write(L(\"X\"),value*100)\n");
        assert_eq!(
            formatted(&short),
            format!("{entry}    write: |\n      (value) => write(L('X'), value * 100)\n")
        );
        let long = format!(
            "{entry}    write: (value) => write(L('A_VARIABLE_WITH_A_LONG_NAME'), value * 100 + state.another_entry * 2 + state.a_third_entry * 3)\n"
        );
        let out = formatted(&long);
        assert!(
            out.starts_with(&format!("{entry}    write: |\n      (value) =>")),
            "{out}"
        );
        assert!(out.lines().count() > 6, "{out}");
        assert!(out.lines().all(|l| l.chars().count() <= WIDTH), "{out}");
    }

    #[test]
    fn a_write_yaml_reads_as_a_boolean_a_number_or_null_stays_on_its_line() {
        let entry = "state:\n  a:\n    name: A\n    watch: L('X')\n";
        for value in ["true", "0", "null"] {
            let text = format!("{entry}    write: {value}\n");
            assert_eq!(formatted(&text), text);
        }
    }
}
