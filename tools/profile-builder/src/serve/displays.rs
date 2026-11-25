//! The display picker: its rows, from the cockpit panels' `hello`s, and Sync's edit, which writes
//! the ticked rows into `displays` (record/areas/profiles/04-the-extension-in-the-sim.md, "The
//! display picker").

use std::collections::{BTreeMap, BTreeSet};

use messages::authoring::CockpitPanel;
use profile_engine::tree::{self, Kind};
use profile_engine::{LAYOUT, key_names, plain, single_quoted};
use profile_language::{Edit, edit_between, format};

use super::view::{DisplayRow, PickerGroup, RowRefusal};

/// The identifier every WASM instrument's key starts with, which v1's pointer sync can't reach,
/// since it plays presses into HTML displays only, and a profile naming one fails its load.
/// `WASM` in src/engines/profile-engine/src/features/pointer_sync.rs names it too, so change both
/// together.
const WASM: &str = "WasmInstrument";

/// The picker's groups: an identifier one instrument holds is one row, which writes the
/// identifier, and one several instruments share is a heading over a row for each full key; a
/// full key that several panels hold is one row, with their count. Each row is ticked by
/// `ticks`, the rows the author ticked or unticked, by full key, or else by whether `displays`
/// names it.
pub(crate) fn groups(
    panels: &[CockpitPanel],
    displays: &[String],
    ticks: &BTreeMap<String, bool>,
) -> Vec<PickerGroup> {
    let mut held: BTreeMap<&str, u32> = BTreeMap::new();
    for panel in panels {
        let keys: BTreeSet<&str> = panel.instruments.iter().map(String::as_str).collect();
        for key in keys {
            *held.entry(key).or_default() += 1;
        }
    }
    let mut by_identifier: BTreeMap<(String, &str), Vec<(&str, u32)>> = BTreeMap::new();
    for (&key, &count) in &held {
        let identifier = key.split('|').next().unwrap_or(key);
        by_identifier
            .entry((identifier.to_lowercase(), identifier))
            .or_default()
            .push((key, count));
    }
    let row = |key: &str, full: &str, panels: u32| DisplayRow {
        key: key.to_string(),
        full_key: full.to_string(),
        panels,
        ticked: ticks
            .get(full)
            .copied()
            .unwrap_or_else(|| displays.iter().any(|d| key_names(d, full))),
        refused: (full.split('|').next() == Some(WASM)).then_some(RowRefusal::WasmInstrument),
    };
    by_identifier
        .into_iter()
        .map(|((_, identifier), keys)| match keys.as_slice() {
            [(full, count)] => PickerGroup::Single {
                row: row(identifier, full, *count),
            },
            _ => PickerGroup::Shared {
                identifier: identifier.to_string(),
                rows: keys
                    .iter()
                    .map(|(full, count)| row(full, full, *count))
                    .collect(),
            },
        })
        .collect()
}

/// Ticks the row `id`, or unticks it once ticked; on a heading, ticks every row under it, or
/// unticks them all once all are ticked. A row that can't be ticked stays as it is.
pub(crate) fn tick(groups: &[PickerGroup], id: &str, ticks: &mut BTreeMap<String, bool>) {
    for group in groups {
        match group {
            PickerGroup::Single { row } if row.key == id && row.refused.is_none() => {
                ticks.insert(row.full_key.clone(), !row.ticked);
            }
            PickerGroup::Shared { identifier, rows } if identifier == id => {
                let open: Vec<&DisplayRow> = rows.iter().filter(|r| r.refused.is_none()).collect();
                let all = open.iter().all(|r| r.ticked);
                for r in open {
                    ticks.insert(r.full_key.clone(), !all);
                }
            }
            PickerGroup::Shared { rows, .. } => {
                for r in rows.iter().filter(|r| r.key == id && r.refused.is_none()) {
                    ticks.insert(r.full_key.clone(), !r.ticked);
                }
            }
            PickerGroup::Single { .. } => {}
        }
    }
}

/// What Sync writes into `displays`: each ticked row's key, a shared identifier alone once every
/// row under it is ticked, since it then names them all and survives liveries, and after them each
/// display `displays` names that no listed panel holds, such as one in a panel the sim hasn't
/// loaded, which the picker can't show and so mustn't drop.
pub(crate) fn written(groups: &[PickerGroup], displays: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut listed: Vec<&str> = Vec::new();
    for group in groups {
        match group {
            PickerGroup::Single { row } => {
                listed.push(&row.full_key);
                if row.ticked && row.refused.is_none() {
                    out.push(row.key.clone());
                }
            }
            PickerGroup::Shared { identifier, rows } => {
                listed.extend(rows.iter().map(|r| r.full_key.as_str()));
                let open: Vec<&DisplayRow> = rows.iter().filter(|r| r.refused.is_none()).collect();
                if !open.is_empty() && open.iter().all(|r| r.ticked) {
                    out.push(identifier.clone());
                } else {
                    out.extend(open.iter().filter(|r| r.ticked).map(|r| r.key.clone()));
                }
            }
        }
    }
    for d in displays {
        if !listed.iter().any(|full| key_names(d, full)) && !out.contains(d) {
            out.push(d.clone());
        }
    }
    out
}

/// The edit that makes a file's `displays` the list `displays`, one to a line, or none when it
/// already is: the `displays:` key's lines replaced, or, in a file with none, a `displays:` key
/// added before the first top-level key the format's layout puts after it, with the comments above
/// that key left with it; then the whole text as the formatter writes it.
pub(crate) fn edit(text: &str, displays: &[String]) -> Result<Option<Edit>, String> {
    let crlf = text.contains("\r\n");
    let lf = text.replace("\r\n", "\n");
    let (root, _) = tree::parse_keeping_brackets("profile.yaml", &lf)
        .map_err(|_| "the file's YAML doesn't parse, so Sync can't find where displays go")?;
    let top: Vec<(String, usize)> = match &root.kind {
        Kind::Map(entries) => entries
            .iter()
            .map(|(k, _)| (k.text.clone(), k.at.line - 1))
            .collect(),
        _ => Vec::new(),
    };
    let mut lines: Vec<String> = lf.split('\n').map(str::to_string).collect();
    let block: Vec<String> = if displays.is_empty() {
        Vec::new()
    } else {
        std::iter::once("displays:".to_string())
            .chain(displays.iter().map(|d| format!("  - {}", scalar(d))))
            .collect()
    };
    if let Some(&(_, at)) = top.iter().find(|(k, _)| k == "displays") {
        // Its lines are its key's and the ones below it indented or blank; a comment at the
        // file's edge after them is the next key's.
        let end = (at + 1..lines.len())
            .find(|&l| !lines[l].trim().is_empty() && !lines[l].starts_with([' ', '\t']))
            .unwrap_or(lines.len());
        lines.splice(at..end, block);
    } else if !block.is_empty() {
        let place = |key: &str| {
            LAYOUT
                .iter()
                .position(|k| *k == key)
                .unwrap_or(LAYOUT.len())
        };
        let after = place("displays");
        let next = top
            .iter()
            .find(|(k, _)| place(k) > after)
            .map_or(lines.len(), |&(_, line)| line);
        let mut at = next;
        while at > 0 && is_run_line(&lines[at - 1]) {
            at -= 1;
        }
        lines.splice(at..at, block);
    }
    let changed = lines.join("\n");
    let formatted = format(&changed).unwrap_or(changed);
    let formatted = if crlf {
        formatted.replace('\n', "\r\n")
    } else {
        formatted
    };
    Ok(edit_between(text, &formatted))
}

/// A display as a list item writes it: plain where YAML reads it as the same text, or in single
/// quotes.
fn scalar(display: &str) -> String {
    if plain(display) {
        display.to_string()
    } else {
        single_quoted(display)
    }
}

/// A blank line or a comment, which sits above the key below it.
fn is_run_line(line: &str) -> bool {
    let t = line.trim();
    t.is_empty() || t.starts_with('#')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn panel(name: &str, instruments: &[&str]) -> CockpitPanel {
        CockpitPanel {
            name: Some(name.into()),
            instruments: instruments.iter().map(|i| i.to_string()).collect(),
        }
    }

    /// Every row and heading, in the order the picker's Up and Down walk them.
    fn stops(groups: &[PickerGroup]) -> Vec<String> {
        groups
            .iter()
            .flat_map(|g| match g {
                PickerGroup::Single { row } => vec![row.key.clone()],
                PickerGroup::Shared { identifier, rows } => std::iter::once(identifier.clone())
                    .chain(rows.iter().map(|r| r.key.clone()))
                    .collect(),
            })
            .collect()
    }

    fn rows(groups: &[PickerGroup]) -> Vec<(String, String, u32, bool, bool)> {
        groups
            .iter()
            .flat_map(|g| match g {
                PickerGroup::Single { row } => vec![row.clone()],
                PickerGroup::Shared { rows, .. } => rows.clone(),
            })
            .map(|r| (r.key, r.full_key, r.panels, r.ticked, r.refused.is_some()))
            .collect()
    }

    /// Panels shaped as the Black Square Baron 58P's, with a shared `KX155B` and `WTT` the 58P
    /// lacks, as the panel's dev page writes them.
    fn cockpit() -> Vec<CockpitPanel> {
        vec![
            panel(
                "VCockpit60",
                &["KAS297B_1|Index=1", "GNS_DISABLED", "KX155B|Index=1"],
            ),
            panel(
                "VCockpit61",
                &["GNS_DISABLED", "KX155B|Index=2", "bksq_wradar1"],
            ),
            panel(
                "VCockpit62",
                &[
                    "WasmInstrument|wasm_module=Gauge/TDSGTNXiGaugeModule.wasm&wasm_gauge=GTNXI750U1",
                ],
            ),
        ]
    }

    #[test]
    fn an_identifier_one_instrument_holds_is_one_row_and_a_shared_one_a_heading_over_its_keys() {
        let displays = ["KAS297B_1".to_string(), "KX155B|Index=2".to_string()];
        let groups = groups(&cockpit(), &displays, &BTreeMap::new());
        assert_eq!(
            stops(&groups),
            [
                "bksq_wradar1",
                "GNS_DISABLED",
                "KAS297B_1",
                "KX155B",
                "KX155B|Index=1",
                "KX155B|Index=2",
                "WasmInstrument"
            ]
        );
        let wasm =
            "WasmInstrument|wasm_module=Gauge/TDSGTNXiGaugeModule.wasm&wasm_gauge=GTNXI750U1";
        assert_eq!(
            rows(&groups),
            [
                (
                    "bksq_wradar1".into(),
                    "bksq_wradar1".into(),
                    1,
                    false,
                    false
                ),
                (
                    "GNS_DISABLED".into(),
                    "GNS_DISABLED".into(),
                    2,
                    false,
                    false
                ),
                (
                    "KAS297B_1".into(),
                    "KAS297B_1|Index=1".into(),
                    1,
                    true,
                    false
                ),
                (
                    "KX155B|Index=1".into(),
                    "KX155B|Index=1".into(),
                    1,
                    false,
                    false
                ),
                (
                    "KX155B|Index=2".into(),
                    "KX155B|Index=2".into(),
                    1,
                    true,
                    false
                ),
                ("WasmInstrument".into(), wasm.into(), 1, false, true),
            ]
        );
    }

    #[test]
    fn a_heading_ticks_every_row_under_it_and_sync_writes_the_identifier_once_all_are() {
        let mut ticks = BTreeMap::new();
        let none: [String; 0] = [];
        let first = groups(&cockpit(), &none, &ticks);
        tick(&first, "KX155B", &mut ticks);
        tick(&first, "WasmInstrument", &mut ticks);
        tick(&first, "GNS_DISABLED", &mut ticks);
        let ticked = groups(&cockpit(), &none, &ticks);
        assert_eq!(written(&ticked, &none), ["GNS_DISABLED", "KX155B"]);
        tick(&ticked, "KX155B|Index=2", &mut ticks);
        let one = groups(&cockpit(), &none, &ticks);
        assert_eq!(written(&one, &none), ["GNS_DISABLED", "KX155B|Index=1"]);
        tick(&one, "KX155B", &mut ticks);
        let all = groups(&cockpit(), &none, &ticks);
        assert_eq!(written(&all, &none), ["GNS_DISABLED", "KX155B"]);
        tick(&all, "KX155B", &mut ticks);
        let cleared = groups(&cockpit(), &none, &ticks);
        assert_eq!(written(&cleared, &none), ["GNS_DISABLED"]);
    }

    #[test]
    fn sync_keeps_a_display_no_listed_panel_holds() {
        let displays = ["BlackSquareTablet".to_string(), "GNS_DISABLED".to_string()];
        let groups = groups(&cockpit(), &displays, &BTreeMap::new());
        assert_eq!(
            written(&groups, &displays),
            ["GNS_DISABLED", "BlackSquareTablet"]
        );
    }

    const PROFILE: &str = "maker: M
name: Test
status: experimental

aircraft:
  variants:
    a: test-aircraft

# ═══ STATE

state:
  battery:
    name: Battery
    watch: L('BATTERY')
    write: L('BATTERY')
";

    fn applied(text: &str, edit: Option<Edit>) -> String {
        let Some(edit) = edit else {
            return text.to_string();
        };
        let offset = |line: usize, column: usize| {
            let start: usize = text
                .split_inclusive('\n')
                .take(line - 1)
                .map(str::len)
                .sum();
            start + column - 1
        };
        let (from, to) = (
            offset(edit.range.start.line, edit.range.start.column),
            offset(edit.range.end.line, edit.range.end.column),
        );
        format!("{}{}{}", &text[..from], edit.text, &text[to..])
    }

    #[test]
    fn sync_adds_displays_in_its_layout_place_and_leaves_the_comments_above_the_next_key() {
        let displays = ["GNS_DISABLED".to_string(), "KX155B|Index=1".to_string()];
        let after = applied(PROFILE, edit(PROFILE, &displays).expect("an edit"));
        let at = |part: &str| {
            after
                .find(part)
                .unwrap_or_else(|| panic!("{part}: {after}"))
        };
        assert!(after.contains("\n\ndisplays:\n  - GNS_DISABLED\n  - KX155B|Index=1\n\n"));
        assert!(at("test-aircraft") < at("displays:") && at("displays:") < at("# ═══ STATE"));
        assert_eq!(
            after,
            format(&after).expect("formats"),
            "as the formatter writes it"
        );
    }

    #[test]
    fn sync_replaces_the_displays_lines_one_to_a_line_and_writes_nothing_when_they_hold() {
        let text = PROFILE.replace(
            "\n# ═══ STATE",
            "\ndisplays: BlackSquareTablet\n\n# ═══ STATE",
        );
        let displays = ["BlackSquareTablet".to_string(), "KX155B".to_string()];
        let after = applied(&text, edit(&text, &displays).expect("an edit"));
        assert!(
            after.contains("displays:\n  - BlackSquareTablet\n  - KX155B\n\n# ═══ STATE"),
            "{after}"
        );
        assert_eq!(after.matches("displays").count(), 1, "{after}");
        assert_eq!(edit(&after, &displays).expect("no edit"), None);
        let cleared = applied(&after, edit(&after, &[]).expect("an edit"));
        assert!(!cleared.contains("displays"), "{cleared}");
    }

    #[test]
    fn sync_keeps_the_files_line_ends() {
        let text = PROFILE.replace('\n', "\r\n");
        let after = applied(&text, edit(&text, &["A".to_string()]).expect("an edit"));
        assert!(after.contains("displays:\r\n  - A\r\n"), "{after}");
        assert!(!after.replace("\r\n", "").contains('\n'));
    }
}
