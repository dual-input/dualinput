//! A file's symbols and folding ranges, from which an editor draws its outline, breadcrumbs,
//! sticky scroll, and Go to Symbol (record/areas/profiles/03-the-extension.md, "The outline").
//!
//! The tree holds `aircraft` with its variants; `state` and `events`, each holding its sections,
//! each section its subsections, and each its entries; and `seats`, each seat by its `name:`. An
//! entry shows its `name:` with its key beside it, so the outline reads as the cockpit does.

use crate::Range;
use crate::comments::{self, Level};
use crate::outline::{self, Item, Outline, comment_text, is_comment};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SymbolKind {
    /// A top-level block, as `state`.
    Block,
    /// `# ═══ TITLE`
    Section,
    /// `# ── Title`
    Subsection,
    StateEntry,
    EventEntry,
    Variant,
    Seat,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Symbol {
    pub name: String,
    /// What an editor shows beside the name: an entry's or a seat's key, or a variant's folders.
    pub detail: Option<String>,
    pub kind: SymbolKind,
    /// The lines it spans.
    pub range: Range,
    /// The text an editor selects for it: a key, or a heading's line.
    pub selection: Range,
    pub children: Vec<Symbol>,
}

/// A range of lines that folds, from its first line to its last, from 1.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Fold {
    pub start: usize,
    pub end: usize,
}

pub fn symbols(text: &str) -> Vec<Symbol> {
    let o = outline::parse(text);
    let mut out = Vec::new();
    for item in &o.items {
        let Some(key) = item.key() else {
            continue;
        };
        let children = match key.as_str() {
            "aircraft" => item
                .child("variants")
                .map(|v| v.children.iter().filter_map(|c| variant(&o, c)).collect())
                .unwrap_or_default(),
            "state" => entries(&o, item, false),
            "events" => entries(&o, item, true),
            "seats" => item.children.iter().filter_map(|c| seat(&o, c)).collect(),
            _ => continue,
        };
        let Some(token) = item.key_token() else {
            continue;
        };
        let mut range = o.item_range(item);
        if let Some(&last) = item.trailing.last() {
            range.end = range.end.max(o.line_range(last).end);
        }
        out.push(Symbol {
            name: key,
            detail: None,
            kind: SymbolKind::Block,
            range,
            selection: token.range(item.line),
            children,
        });
    }
    out
}

/// Each block, entry, map, and script that spans more than its line, and each heading, down to
/// the next heading at its level or above.
pub fn folds(text: &str) -> Vec<Fold> {
    let o = outline::parse(text);
    let mut out: Vec<Fold> = o
        .walk()
        .into_iter()
        .filter(|(_, item)| item.end() > item.line)
        .map(|(_, item)| Fold {
            start: item.line + 1,
            end: item.end() + 1,
        })
        .collect();
    fn headings(symbols: &[Symbol], out: &mut Vec<Fold>) {
        for s in symbols {
            if matches!(s.kind, SymbolKind::Section | SymbolKind::Subsection)
                && s.range.end.line > s.range.start.line
            {
                out.push(Fold {
                    start: s.range.start.line,
                    end: s.range.end.line,
                });
            }
            headings(&s.children, out);
        }
    }
    headings(&symbols(text), &mut out);
    out.sort();
    out.dedup();
    out
}

fn variant(o: &Outline, item: &Item) -> Option<Symbol> {
    let token = item.key_token()?;
    let paths: Vec<String> = match item.value() {
        Some(v) => v.text().into_iter().collect(),
        None => item
            .children
            .iter()
            .filter_map(|c| c.value()?.text())
            .collect(),
    };
    Some(Symbol {
        name: item.key()?,
        detail: (!paths.is_empty()).then(|| paths.join(", ")),
        kind: SymbolKind::Variant,
        range: o.item_range(item),
        selection: token.range(item.line),
        children: Vec::new(),
    })
}

fn seat(o: &Outline, item: &Item) -> Option<Symbol> {
    let token = item.key_token()?;
    let key = item.key()?;
    Some(Symbol {
        name: item.child_text("name").unwrap_or_else(|| key.clone()),
        detail: Some(key),
        kind: SymbolKind::Seat,
        range: o.item_range(item),
        selection: token.range(item.line),
        children: Vec::new(),
    })
}

fn entry(o: &Outline, item: &Item, event: bool) -> Option<Symbol> {
    let token = item.key_token()?;
    let key = item.key()?;
    Some(Symbol {
        name: item.child_text("name").unwrap_or_else(|| key.clone()),
        detail: Some(key),
        kind: if event {
            SymbolKind::EventEntry
        } else {
            SymbolKind::StateEntry
        },
        range: o.item_range(item),
        selection: token.range(item.line),
        children: Vec::new(),
    })
}

/// A block's entries under the sections and subsections their headings open. A section holds the
/// entries below it until the next section, a subsection those below it until the next heading,
/// and entries before the block's first heading sit under the block.
fn entries(o: &Outline, block: &Item, event: bool) -> Vec<Symbol> {
    let mut tree = Tree::default();
    for item in &block.children {
        for &l in &item.above {
            tree.heading(o, l);
        }
        if let Some(symbol) = entry(o, item, event) {
            tree.push(symbol);
        }
    }
    for &l in &block.trailing {
        tree.heading(o, l);
    }
    tree.finish()
}

#[derive(Default)]
struct Tree {
    out: Vec<Symbol>,
    section: Option<Symbol>,
    subsection: Option<Symbol>,
}

impl Tree {
    fn heading(&mut self, o: &Outline, line: usize) {
        let text = o.line(line);
        if !is_comment(text) {
            return;
        }
        let Some((level, title)) = comments::heading(comment_text(text)) else {
            return;
        };
        let range = o.line_range(line);
        let symbol = Symbol {
            name: title.to_string(),
            detail: None,
            kind: match level {
                Level::Section => SymbolKind::Section,
                Level::Subsection => SymbolKind::Subsection,
            },
            range,
            selection: range,
            children: Vec::new(),
        };
        self.close_subsection();
        match level {
            Level::Section => {
                self.close_section();
                self.section = Some(symbol);
            }
            Level::Subsection => self.subsection = Some(symbol),
        }
    }

    fn push(&mut self, symbol: Symbol) {
        let end = symbol.range.end;
        for open in [&mut self.subsection, &mut self.section]
            .into_iter()
            .flatten()
        {
            open.range.end = open.range.end.max(end);
        }
        match (&mut self.subsection, &mut self.section) {
            (Some(s), _) | (None, Some(s)) => s.children.push(symbol),
            (None, None) => self.out.push(symbol),
        }
    }

    fn close_subsection(&mut self) {
        let Some(sub) = self.subsection.take() else {
            return;
        };
        match &mut self.section {
            Some(s) => {
                s.range.end = s.range.end.max(sub.range.end);
                s.children.push(sub);
            }
            None => self.out.push(sub),
        }
    }

    fn close_section(&mut self) {
        if let Some(s) = self.section.take() {
            self.out.push(s);
        }
    }

    fn finish(mut self) -> Vec<Symbol> {
        self.close_subsection();
        self.close_section();
        self.out
    }
}
