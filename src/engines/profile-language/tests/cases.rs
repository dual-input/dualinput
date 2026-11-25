//! The profile language's cases (record/areas/profiles/03-the-extension.md, "Cases"): the
//! outline, the formatter, comments, quotes, which programs check a module, completion,
//! navigation, and indentation as you type.

use std::collections::BTreeMap;

use profile_language::{
    Completion, CompletionKind, Context, Pos, SymbolKind, Unformatted, Workspace, complete,
    definition, folds, format, indent_after, indent_closing, programs, references, rename, symbols,
};

const BARON: &str = include_str!("../../../../profiles/aircraft/bksq-baronpro.yaml");

fn formatted(text: &str) -> String {
    format(text).unwrap_or_else(|e| panic!("{e:?}"))
}

/// The 1-based line of the first line holding `text`.
fn line_of(text: &str, holding: &str) -> usize {
    text.lines()
        .position(|l| l.contains(holding))
        .unwrap_or_else(|| panic!("no line holds {holding}"))
        + 1
}

#[test]
fn the_58ps_outline_holds_its_sections_subsections_and_entries_by_name() {
    let found = symbols(BARON);
    let names: Vec<&str> = found.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, ["aircraft", "state", "events", "seats"]);
    let state = &found[1];
    let electrical = &state.children[0];
    assert_eq!(
        (electrical.kind, electrical.name.as_str()),
        (SymbolKind::Section, "ELECTRICAL")
    );
    let battery = &electrical.children[0];
    assert_eq!(battery.kind, SymbolKind::StateEntry);
    assert_eq!(battery.name, "Battery");
    assert_eq!(battery.detail.as_deref(), Some("battery"));
    let breakers = electrical
        .children
        .iter()
        .find(|c| c.kind == SymbolKind::Subsection)
        .expect("a subsection");
    assert_eq!(breakers.name, "Breakers");
    assert_eq!(
        breakers.children[0].detail.as_deref(),
        Some("breaker_gear_relay")
    );
    let events = &found[2];
    assert_eq!(events.children[0].children[0].kind, SymbolKind::EventEntry);
    let seats: Vec<&str> = found[3].children.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(seats, ["Copilot", "Pilot"]);
    assert_eq!(found[0].children[0].name, "press");
    // Each heading folds, down to the last entry before the next heading at its level or above.
    let all = folds(BARON);
    for (n, line) in BARON.lines().enumerate() {
        let heading =
            line.trim_start().starts_with("# ═══") || line.trim_start().starts_with("# ──");
        if heading {
            assert!(
                all.iter().any(|f| f.start == n + 1),
                "no fold at line {}",
                n + 1
            );
        }
    }
    let lights = line_of(BARON, "# ═══ LIGHTS");
    let fold = all.iter().find(|f| f.start == lights).expect("a fold");
    assert_eq!(fold.end, line_of(BARON, "# ═══ FUEL") - 2);
}

#[test]
fn the_formatter_writes_every_rule_of_layout() {
    let out_of_layout = "state:   \r\n    # === ELECTRICAL ===\r\n\r\n    battery:\r\n        write: {toggle: B('BAT_TOGGLE')}\r\n        watch: B('BAT')\r\n        name: \"Battery\"\r\n        only:\r\n        - press\r\n        - turbo\r\n\r\n    # Above the starter.\r\n    starter:\r\n        name: 'Starter'\r\n        watch: L('STARTER')\r\n        ignore: [K('A'), K('B')]\r\n        write: |\r\n            (value) => {\r\n              write(L('STARTER'), value)\r\n            }\r\n    # ─── Breakers ──────────\r\n    breaker:\r\n        name: Breaker\r\n        watch: L('BR')\r\n        write:\r\n            dec: K('BR_DEC')\r\n            inc: K('BR_INC')\r\n            range:\r\n            - 0\r\n            - 10\r\n            wrap: true\r\naircraft:\r\n    variants:\r\n        press: a-press\r\n        turbo: a-turbo\r\nmaturity: stable\r\nname: Model\r\nmaker: Maker";
    // A heading's rule runs on to column 100.
    let in_layout = "maker: Maker
name: Model
maturity: stable

aircraft:
  variants:
    press: a-press
    turbo: a-turbo

state:
  # ═══ ELECTRICAL
  battery:
    name: Battery
    watch: B('BAT')
    write:
      toggle: B('BAT_TOGGLE')
    only: [press, turbo]
  # Above the starter.
  starter:
    name: Starter
    watch: L('STARTER')
    write: |
      (value) => {
        write(L('STARTER'), value)
      }
    ignore:
      - K('A')
      - K('B')

  # ── Breakers
  breaker:
    name: Breaker
    watch: L('BR')
    write:
      inc: K('BR_INC')
      dec: K('BR_DEC')
      wrap: true
      range: [0, 10]
"
    .replace(
        "# ═══ ELECTRICAL\n",
        &format!("# ═══ ELECTRICAL {}\n", "═".repeat(81)),
    )
    .replace(
        "# ── Breakers\n",
        &format!("# ── Breakers {}\n", "─".repeat(84)),
    );
    assert_eq!(formatted(out_of_layout), in_layout);
    assert_eq!(formatted(&in_layout), in_layout);
}

#[test]
fn the_formatter_writes_the_58ps_profile_as_it_stands() {
    assert_eq!(formatted(BARON), BARON);
}

#[test]
fn comments_reflow_by_paragraph_and_lines_laid_out_by_hand_keep_theirs() {
    let long = "word ".repeat(30);
    let text = format!(
        "state:\n  # {long}\n  # tail of the paragraph.\n  #\n  # - a list item\n  #   that goes on\n  #   under its first word\n  # 1. a numbered one\n  #   a diagram's line\n  # a  table's line\n  # watch: L('X')\n  # A known limit: as\n  # it reflows.\n  a:\n    name: A  # a comment after a value\n    watch: L('X')\n    write: none\n"
    );
    let out = formatted(&text);
    let comments: Vec<&str> = out
        .lines()
        .filter(|l| l.trim_start().starts_with('#'))
        .collect();
    assert!(comments.iter().all(|l| l.chars().count() <= 100), "{out}");
    let words: usize = comments[..2].iter().map(|l| l.split(' ').count() - 3).sum();
    assert_eq!(words, 30 + 4, "{out}");
    assert_eq!(
        comments[2..],
        [
            "  #",
            "  # - a list item that goes on under its first word",
            "  # 1. a numbered one",
            "  #   a diagram's line",
            "  # a  table's line",
            "  # watch: L('X')",
            "  # A known limit: as it reflows.",
        ]
    );
    assert!(
        out.contains("    name: A  # a comment after a value\n"),
        "{out}"
    );
    // The 58P's own "A known limit: as" goes on reflowing, so it fills its first line.
    let limit = BARON
        .lines()
        .find(|l| l.contains("# A known limit: as"))
        .expect("the 58P's known limit");
    assert!(limit.chars().count() > 90, "{limit}");
}

#[test]
fn double_quotes_outside_a_script_go_single_and_a_scripts_stay() {
    let text = "state:\n  a:\n    name: \"Left mixture\"\n    description: \"Radio: COM1\"\n    watch: L(\"it's\")\n    write: |\n      (value) => write(L(\"'\"), value)\n";
    let out = formatted(text);
    assert!(out.contains("    name: Left mixture\n"), "{out}");
    assert!(out.contains("    description: 'Radio: COM1'\n"), "{out}");
    assert!(out.contains("    watch: L('it\\'s')\n"), "{out}");
    assert!(
        out.contains("      (value) => write(L(\"'\"), value)\n"),
        "{out}"
    );
}

#[test]
fn a_file_that_doesnt_parse_gets_no_edits() {
    assert!(matches!(
        format("state:\n  a: [1, 2\n  b: 3\n"),
        Err(Unformatted::Yaml(_))
    ));
}

const PROFILE: &str = "maker: M
name: A
maturity: stable

aircraft:
  variants:
    press: a-press
    turbo: a-turbo

import: modules/radio

state:
  battery:
    name: Battery
    watch: L('BATTERY')
    write: |
      (value) => {
        if (value == state.battery) return
        write(L('BATTERY'), state.com_power ? value : 0)
      }
";

const MODULE: &str = "state:
  com_power:
    name: COM power
    watch: L('COM_POWER')
    write: |
      (value) => write(L('COM_POWER'), state.battery ? value : 0)
";

fn workspace<'a>() -> Workspace<'a> {
    Workspace {
        files: BTreeMap::from([
            ("aircraft/a.yaml", PROFILE),
            ("aircraft/b.yaml", "import: modules/radio\n"),
            ("modules/radio.yaml", MODULE),
            ("modules/lone.yaml", "state: {}\n"),
        ]),
    }
}

#[test]
fn a_modules_scripts_are_checked_in_each_importing_profile_or_on_their_own() {
    let ws = workspace();
    assert_eq!(
        programs(&ws, "modules/radio.yaml"),
        ["aircraft/a.yaml", "aircraft/b.yaml"]
    );
    assert_eq!(programs(&ws, "modules/lone.yaml"), ["modules/lone.yaml"]);
    assert_eq!(programs(&ws, "aircraft/a.yaml"), ["aircraft/a.yaml"]);
}

#[test]
fn definition_references_and_rename_reach_across_a_profile_and_its_module() {
    let ws = workspace();
    let read = Pos::new(line_of(PROFILE, "state.com_power"), 33);
    let found = definition(&ws, "aircraft/a.yaml", read);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].path, "modules/radio.yaml");
    assert_eq!(found[0].range.start, Pos::new(2, 3));

    let key = Pos::new(line_of(PROFILE, "  battery:"), 4);
    let refs = references(&ws, "aircraft/a.yaml", key, false);
    let paths: Vec<&str> = refs.iter().map(|l| l.path.as_str()).collect();
    assert_eq!(paths, ["aircraft/a.yaml", "modules/radio.yaml"], "{refs:?}");

    let edits = rename(&ws, "modules/radio.yaml", Pos::new(2, 4), "radio_power").expect("renames");
    let files: Vec<&str> = edits.iter().map(|(p, _)| p.as_str()).collect();
    assert_eq!(files, ["aircraft/a.yaml", "modules/radio.yaml"]);
    assert_eq!(edits[1].1.len(), 1);
    assert!(rename(&ws, "modules/radio.yaml", Pos::new(2, 4), "Radio").is_err());
    assert!(rename(&ws, "modules/radio.yaml", Pos::new(2, 4), "battery").is_err());

    let variant = Pos::new(line_of(PROFILE, "press: a-press"), 6);
    let text = PROFILE.replace("    write: |", "    only: [turbo]\n    write: |");
    let ws = Workspace {
        files: BTreeMap::from([("aircraft/a.yaml", text.as_str())]),
    };
    let only = Pos::new(line_of(&text, "only: [turbo]"), 13);
    let found = definition(&ws, "aircraft/a.yaml", only);
    assert_eq!(found[0].range.start, Pos::new(variant.line + 1, 5));
}

/// The labels the completion at the end of line `line` offers.
fn labels(text: &str, line: usize, module: bool) -> Vec<String> {
    offered(text, line, module)
        .into_iter()
        .map(|c| c.label)
        .collect()
}

fn offered(text: &str, line: usize, module: bool) -> Vec<Completion> {
    let modules = ["modules/radio".to_string()];
    let column = text.lines().nth(line - 1).unwrap_or("").chars().count() + 1;
    complete(
        text,
        Pos::new(line, column),
        &Context {
            module,
            modules: &modules,
        },
    )
}

#[test]
fn completion_offers_what_each_place_takes_and_nothing_its_checker_refuses() {
    let top = "maker: M\n\n";
    let keys = labels(top, 2, false);
    assert_eq!(keys[..3], ["name", "maturity", "authors"]);
    assert!(!keys.contains(&"maker".to_string()));
    let module = labels("authors: X\n\n", 2, true);
    assert!(
        !module
            .iter()
            .any(|k| matches!(k.as_str(), "maker" | "aircraft" | "seats")),
        "{module:?}"
    );
    assert!(module.contains(&"state".to_string()));

    let entry =
        "aircraft:\n  variants:\n    press: x\n    turbo: y\nstate:\n  a:\n    name: A\n    ";
    let fields = labels(entry, 8, false);
    assert_eq!(fields[..3], ["description", "watch", "write"]);
    assert!(
        !fields
            .iter()
            .any(|f| matches!(f.as_str(), "toggle" | "stepping write" | "write function")),
        "{fields:?}"
    );

    let words = |line: &str| labels(&format!("{entry}{line}"), 8, false);
    assert_eq!(words("owner: "), ["pilot_flying", "shared"]);
    assert_eq!(
        labels("maker: M\nmaturity: ", 2, false),
        ["stable", "experimental"]
    );
    assert_eq!(words("only: "), ["press", "turbo"]);
    assert_eq!(words("only: [press, "), ["press", "turbo"]);
    assert_eq!(labels("import: ", 1, false), ["modules/radio"]);
    assert_eq!(
        words("watch: "),
        ["L('')", "A('', '')", "B('')", "instrument('', '')"]
    );
    assert_eq!(words("write: ")[..2], ["none", "L('')"]);
    let write = offered(&format!("{entry}write: "), 8, false);
    assert_eq!(write[2].insert, "A('$1', '$2')");
    let forms = &write[write.len() - 3..];
    assert_eq!(
        forms.iter().map(|c| c.label.as_str()).collect::<Vec<_>>(),
        ["toggle", "stepping write", "write function"]
    );
    assert!(forms.iter().all(|c| c.kind == CompletionKind::Snippet));
    assert_eq!(forms[0].insert, "\n  toggle: K('${1}')");
    assert!(forms[1].insert.contains("wrap:") && forms[1].insert.contains("range:"));
    // Right after the colon, a function takes the space and a map, which starts below, doesn't.
    let tight = offered(&format!("{entry}write:"), 8, false);
    let insert = |label: &str| {
        let c = tight.iter().rev().find(|c| c.label == label);
        c.map(|c| c.insert.clone()).unwrap_or_default()
    };
    assert!(insert("write function").starts_with(" |\n  (value) => {"));
    assert!(insert("toggle").starts_with("\n  toggle:"));
    let counted = "state:\n  c:\n    name: C\n    watch:\n      inc: K('A')\n      dec: K('B')\n      wrap: false\n      range: [0, 10]\n    write: ";
    let steps = offered(counted, 9, false);
    let stepping = steps.iter().find(|c| c.label == "stepping write");
    assert_eq!(
        stepping.map(|c| c.insert.as_str()),
        Some("\n  inc: K('${1}')\n  dec: K('${2}')")
    );
    // A write that already holds a map below it gets no second form.
    let held = offered(&format!("{entry}write:\n      toggle: K('X')\n"), 8, false);
    assert!(
        !held.iter().any(|c| c.kind == CompletionKind::Snippet),
        "{:?}",
        held.iter().map(|c| &c.label).collect::<Vec<_>>()
    );

    let event = "events:\n  a:\n    name: A\n    watch: H('X')\n    write: ";
    assert_eq!(
        labels(event, 5, false),
        [
            "H('X')",
            "L('')",
            "A('', '')",
            "B('')",
            "K('')",
            "H('')",
            "write function"
        ]
    );
    assert_eq!(
        labels("events:\n  a:\n    watch: ", 3, false),
        ["L('')", "B('')", "K('')", "H('')"]
    );

    let map = format!("{entry}write:\n      ");
    let steps = offered(&map, 9, false);
    assert_eq!(steps[0].label, "toggle");
    assert!(
        steps[1].insert.starts_with("inc:")
            && steps[1].insert.contains("wrap:")
            && steps[1].insert.contains("range:")
    );
    assert_eq!(
        labels(&format!("{map}toggle: "), 9, false),
        ["B('')", "K('')", "H('')"]
    );
    assert_eq!(labels(&format!("{map}wrap: "), 9, false), ["true", "false"]);
    let location = format!("{entry}location:\n      ");
    assert_eq!(labels(&location, 9, false), ["press", "turbo"]);

    let snippets: Vec<CompletionKind> = offered("state:\n  ", 2, false)
        .iter()
        .map(|c| c.kind)
        .collect();
    assert!(snippets.iter().all(|k| *k == CompletionKind::Snippet));
    assert_eq!(labels("state:\n  ", 2, false)[0], "state entry");
    assert_eq!(labels("", 1, false), ["new profile"]);
    assert_eq!(labels("", 1, true), ["new module"]);
}

#[test]
fn enter_indents_as_the_formatter_writes_and_a_closing_brace_moves_back() {
    let text = "state:\n  a:\n    name: A\n    write: |\n      (value) => {\n        if (value) write(K('X'))\n        const f = (\n          1)\n        const g = () =>\n";
    let after = |line: &str| indent_after(text, line_of(text, line) + 1);
    assert_eq!(after("state:"), Some(2));
    assert_eq!(after("  a:"), Some(4));
    assert_eq!(after("name: A"), Some(4));
    assert_eq!(after("write: |"), Some(6));
    assert_eq!(after("(value) => {"), Some(8));
    assert_eq!(after("if (value)"), Some(8));
    assert_eq!(after("const f = ("), Some(10));
    assert_eq!(after("const g"), Some(10));
    let closed = "state:\n  a:\n    write: |\n      (value) => {\n        if (value) write(K('X'))\n        }\n";
    assert_eq!(indent_closing(closed, 6), Some(6));
    let empty = "state:\n  a:\n    write: |\n      (value) => {\n        }\n";
    assert_eq!(indent_closing(empty, 5), Some(6));
    assert_eq!(indent_closing(closed, 2), None);
}
