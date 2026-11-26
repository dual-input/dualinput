//! What the sim's features read of a profile's or a module's text: its maker and model, each name
//! call on a `watch:` line with how its line watches it, each entry with whether it writes and
//! who owns it, its `displays`, and its `aircraft:` and `variants:`
//! (record/areas/profiles/04-the-extension-in-the-sim.md, 07-adding-an-aircraft.md).
//!
//! It reads the engine's tree, which holds each node's place, so a file whose YAML doesn't parse
//! has no facts, and the server keeps the ones its last text that parsed gave.

use messages::authoring::Reads;
use profile_engine::tree::{self, Kind, Node};
use profile_engine::{Name, read_name};

use super::variants::Variant;

/// The name the tree gives the file it reads, which no fact here carries.
const FILE: &str = "open.yaml";

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Facts {
    pub(crate) maker: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) watches: Vec<WatchLine>,
    pub(crate) entries: Vec<Entry>,
    /// The `displays:` key's line, from 0, and what it names, as written.
    pub(crate) displays: Option<(usize, Vec<String>)>,
    /// The `aircraft:` key's line, from 0.
    pub(crate) aircraft: Option<usize>,
    /// The `variants:` key's line under `aircraft:`, from 0, and each variant's ID and the paths
    /// it names, as written, in the file's order.
    pub(crate) variants: Option<(usize, Vec<Variant>)>,
}

/// One name call on a `watch:` line, or on a counting map's line under it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WatchLine {
    /// From 0, as the protocol counts lines.
    pub(crate) line: usize,
    /// The name call as the line writes it, which `authoring.open` carries and the slice names
    /// it by.
    pub(crate) text: String,
    pub(crate) name: Name,
    pub(crate) reads: Reads,
    /// The counting map's field it's on, as `inc`, or none on a `watch:` line itself.
    pub(crate) of: Option<String>,
    /// The key of the entry it's in.
    pub(crate) entry: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EntryKind {
    State,
    /// A state entry whose `watch:` counts events into a shadow value.
    Counting,
    Event,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Entry {
    pub(crate) key: String,
    /// Its `name:`, or its key when it has none.
    pub(crate) name: String,
    pub(crate) kind: EntryKind,
    /// Its key's line and column, each from 0, the column in characters.
    pub(crate) line: usize,
    pub(crate) column: usize,
    /// The last line it spans, from 0: the line before the next entry's key or the next
    /// top-level key, so the blank and comment lines after it are its own.
    pub(crate) last: usize,
    /// Its own last line, from 0: `last` without the blank and comment lines at its end, which sit
    /// above the next entry, its heading among them, as the entry's fold leaves them.
    pub(crate) end: usize,
    /// Whether it has a write, which Run runs: a `write:` that isn't `none`.
    pub(crate) writes: bool,
    pub(crate) pilot_flying: bool,
    /// The variant IDs its `only` names, as written, or none for an entry of every variant.
    pub(crate) only: Vec<String>,
}

impl Facts {
    pub(crate) fn entry(&self, key: &str) -> Option<&Entry> {
        self.entries.iter().find(|e| e.key == key)
    }

    /// The entry whose lines hold `line`, from 0.
    pub(crate) fn entry_at(&self, line: usize) -> Option<&Entry> {
        self.entries
            .iter()
            .find(|e| line >= e.line && line <= e.last)
    }
}

/// The facts of a file's text, or none when its YAML doesn't parse.
pub(crate) fn read(text: &str) -> Option<Facts> {
    let (root, _) = tree::parse_keeping_brackets(FILE, text).ok()?;
    let Kind::Map(top) = &root.kind else {
        return Some(Facts::default());
    };
    let all: Vec<&str> = text.split('\n').collect();
    let lines = all.len();
    let mut facts = Facts::default();
    for (n, (key, node)) in top.iter().enumerate() {
        // The line before the next top-level key, from 0, or the file's last.
        let next = top.get(n + 1).map_or(lines.saturating_sub(1), |(k, _)| {
            k.at.line.saturating_sub(2)
        });
        match key.text.as_str() {
            "maker" => facts.maker = text_of(node),
            "name" => facts.model = text_of(node),
            "displays" => facts.displays = Some((key.at.line - 1, texts(node))),
            "aircraft" => {
                facts.aircraft = Some(key.at.line - 1);
                if let Kind::Map(fields) = &node.kind
                    && let Some((key, variants)) = fields.iter().find(|(k, _)| k.text == "variants")
                {
                    let named = match &variants.kind {
                        Kind::Map(each) => each
                            .iter()
                            .map(|(id, paths)| (id.text.clone(), texts(paths)))
                            .collect(),
                        _ => Vec::new(),
                    };
                    facts.variants = Some((key.at.line - 1, named));
                }
            }
            "state" => entries(&mut facts, node, false, next, &all),
            "events" => entries(&mut facts, node, true, next, &all),
            _ => {}
        }
    }
    Some(facts)
}

fn entries(facts: &mut Facts, block: &Node, event: bool, end: usize, text: &[&str]) {
    let Kind::Map(entries) = &block.kind else {
        return;
    };
    for (n, (key, node)) in entries.iter().enumerate() {
        let last = entries
            .get(n + 1)
            .map_or(end, |(k, _)| k.at.line.saturating_sub(2))
            .max(key.at.line - 1);
        let own = (key.at.line - 1..=last)
            .rev()
            .find(|&l| {
                let t = text.get(l).map_or("", |l| l.trim());
                !t.is_empty() && !t.starts_with('#')
            })
            .unwrap_or(key.at.line - 1);
        let field = |name: &str| child(node, name);
        let watch = field("watch");
        let counting = watch.is_some_and(|w| matches!(w.kind, Kind::Map(_)));
        let kind = match (event, counting) {
            (true, _) => EntryKind::Event,
            (false, true) => EntryKind::Counting,
            (false, false) => EntryKind::State,
        };
        if let Some(watch) = watch {
            watch_lines(facts, &key.text, watch, kind);
        }
        facts.entries.push(Entry {
            key: key.text.clone(),
            name: field("name")
                .and_then(text_of)
                .unwrap_or_else(|| key.text.clone()),
            kind,
            line: key.at.line - 1,
            column: key.at.column - 1,
            last,
            end: own,
            writes: field("write").is_some_and(|w| text_of(w).as_deref() != Some("none")),
            pilot_flying: field("owner").and_then(text_of).as_deref() == Some("pilot_flying"),
            only: field("only").map(texts).unwrap_or_default(),
        });
    }
}

/// The name calls an entry's `watch:` names: a state entry's variable as a value, an event
/// entry's event as occurrences, and a counting map's `inc:`, `dec:`, and `set:` as occurrences
/// and its `count:` as a value.
fn watch_lines(facts: &mut Facts, entry: &str, watch: &Node, kind: EntryKind) {
    let mut push = |node: &Node, reads: Reads, of: Option<&str>| {
        let Some(text) = text_of(node) else {
            return;
        };
        // A name half typed reads as no name call, and gets no box until it's whole.
        let Some(name) = read_name(&text) else {
            return;
        };
        facts.watches.push(WatchLine {
            line: node.at.line - 1,
            text,
            name,
            reads,
            of: of.map(str::to_string),
            entry: entry.to_string(),
        });
    };
    match (kind, &watch.kind) {
        (EntryKind::Counting, Kind::Map(fields)) => {
            for (key, node) in fields {
                let reads = match key.text.as_str() {
                    "inc" | "dec" | "set" => Reads::Occurrences,
                    "count" => Reads::Value,
                    _ => continue,
                };
                push(node, reads, Some(&key.text));
            }
        }
        (EntryKind::Event, _) => push(watch, Reads::Occurrences, None),
        _ => push(watch, Reads::Value, None),
    }
}

fn child<'n>(node: &'n Node, key: &str) -> Option<&'n Node> {
    match &node.kind {
        Kind::Map(entries) => entries.iter().find(|(k, _)| k.text == key).map(|(_, v)| v),
        _ => None,
    }
}

fn text_of(node: &Node) -> Option<String> {
    node.str().map(|t| t.text.trim().to_string())
}

/// A field that takes a list, or one item on its own, as its texts.
fn texts(node: &Node) -> Vec<String> {
    match &node.kind {
        Kind::Seq(items) => items.iter().filter_map(text_of).collect(),
        _ => text_of(node).into_iter().collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &str = "maker: Black Square
name: Baron 58P
displays:
  - BlackSquareTablet
  - 'KX155B|Index=1'
state:
  battery:
    name: Battery
    watch: L('BATTERY')   # the master
    write: L('BATTERY')

  throttle:
    owner: pilot_flying
    watch: L('THROTTLE', 'Percent over 100')
    write: none
  com:
    name: COM
    watch:
      inc: K('COM_INC')
      dec: K('COM_DEC')
      count: L('COM_COUNT')
    write:
      inc: K('COM_INC')
      dec: K('COM_DEC')
events:
  ap_master:
    name: Autopilot master
    watch: K('AP_MASTER')
    write: K('AP_MASTER')
";

    #[test]
    fn a_files_watch_lines_entries_and_displays_read_with_their_lines() {
        let facts = read(TEXT).expect("parses");
        assert_eq!(facts.maker.as_deref(), Some("Black Square"));
        assert_eq!(facts.model.as_deref(), Some("Baron 58P"));
        assert_eq!(
            facts.displays,
            Some((
                2,
                vec![
                    "BlackSquareTablet".to_string(),
                    "KX155B|Index=1".to_string()
                ]
            ))
        );
        let watched: Vec<(usize, &str, Reads, Option<&str>)> = facts
            .watches
            .iter()
            .map(|w| (w.line, w.text.as_str(), w.reads, w.of.as_deref()))
            .collect();
        assert_eq!(
            watched,
            [
                (8, "L('BATTERY')", Reads::Value, None),
                (13, "L('THROTTLE', 'Percent over 100')", Reads::Value, None),
                (18, "K('COM_INC')", Reads::Occurrences, Some("inc")),
                (19, "K('COM_DEC')", Reads::Occurrences, Some("dec")),
                (20, "L('COM_COUNT')", Reads::Value, Some("count")),
                (27, "K('AP_MASTER')", Reads::Occurrences, None),
            ]
        );
        let battery = facts.entry("battery").expect("battery");
        assert_eq!((battery.line, battery.column, battery.last), (6, 2, 10));
        assert!(battery.writes && !battery.pilot_flying);
        let throttle = facts.entry("throttle").expect("throttle");
        assert!(!throttle.writes && throttle.pilot_flying);
        assert_eq!(
            facts.entry("com").map(|e| e.kind),
            Some(EntryKind::Counting)
        );
        let ap = facts.entry("ap_master").expect("the event");
        assert_eq!((ap.kind, ap.last), (EntryKind::Event, 29));
        assert_eq!(facts.entry_at(9).map(|e| e.key.as_str()), Some("battery"));
        assert_eq!(facts.entry_at(4).map(|e| e.key.as_str()), None);
    }

    #[test]
    fn an_entrys_own_end_leaves_the_comments_above_the_next_and_its_only_reads() {
        let text = "state:\n  battery:\n    watch: L('B')\n    only: [g1000]\n\n  # ── Lights\n  # The beacon.\n  beacon:\n    watch: L('C')\n    only: g1000\n";
        let facts = read(text).expect("parses");
        let battery = facts.entry("battery").expect("battery");
        assert_eq!((battery.line, battery.end, battery.last), (1, 3, 6));
        assert_eq!(battery.only, ["g1000"]);
        let beacon = facts.entry("beacon").expect("beacon");
        assert_eq!((beacon.line, beacon.end), (7, 9));
        assert_eq!(
            beacon.only,
            ["g1000"],
            "one ID on its own reads as a list of one"
        );
    }

    #[test]
    fn a_profiles_variants_read_with_their_paths_in_either_form() {
        let text = "maker: Asobo\nname: Cessna 172 Skyhawk\naircraft:\n  variants:\n    g1000: asobo_c172sp_g1000\n    skis:\n      - asobo_c172sp_g1000/presets/asobo/c172sp_avionics_passengers_skis\n    classic: [asobo_c172sp]\n";
        let facts = read(text).expect("parses");
        assert_eq!(facts.aircraft, Some(2));
        assert_eq!(
            facts.variants,
            Some((
                3,
                vec![
                    ("g1000".to_string(), vec!["asobo_c172sp_g1000".to_string()]),
                    (
                        "skis".to_string(),
                        vec![
                            "asobo_c172sp_g1000/presets/asobo/c172sp_avionics_passengers_skis"
                                .to_string()
                        ]
                    ),
                    ("classic".to_string(), vec!["asobo_c172sp".to_string()]),
                ]
            ))
        );
        let bare = read("maker: M\naircraft:\n  pace: 2 frames\n").expect("parses");
        assert_eq!((bare.aircraft, bare.variants), (Some(1), None));
    }

    #[test]
    fn a_name_half_typed_has_no_watch_line_and_yaml_that_doesnt_parse_has_no_facts() {
        let half = TEXT.replace("L('BATTERY')   #", "L('BATT   #");
        let facts = read(&half).expect("parses");
        assert!(!facts.watches.iter().any(|w| w.entry == "battery"));
        assert_eq!(read("state:\n  a: [1\n"), None);
    }
}
