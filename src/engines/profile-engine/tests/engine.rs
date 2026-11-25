//! The profile engine's checks, each at its place, and a bundle written and read back.

use std::collections::BTreeMap;

use profile_engine::{
    Compiled, Files, LEVEL, Name, Owner, ProfileStatus, Severity, Watch, Write, check, program,
    read, source, write,
};

struct Tree(BTreeMap<String, String>);

impl Files for Tree {
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        self.0.get(path).map(|t| t.clone().into_bytes())
    }
}

fn tree(files: &[(&str, &str)]) -> Tree {
    Tree(
        files
            .iter()
            .map(|(p, t)| (p.to_string(), t.to_string()))
            .collect(),
    )
}

const BARON: &str = "\
maker: M
name: Black Square Baron
status: experimental
authors: Dual Input
aircraft:
  variants:
    base: bksq-aircraft-baronpro
    press: bksq-aircraft-baronpropress
  pace: 2 frames
import: modules/radio
state:
  mixture_1:
    name: Left mixture
    description: 'Full rich: the lever at its top'
    watch: L('BKSQ_MixtureLeverPosition_1')
    write: L('BKSQ_MixtureLeverPosition_1')
    owner: pilot_flying
    only: press
  heading_bug:
    name: Heading bug
    watch: A('AUTOPILOT HEADING LOCK DIR', 'Degrees')
    write:
      inc: K('HEADING_BUG_INC')
      dec: K('HEADING_BUG_DEC')
      wrap: true
      range: [0, 359]
  fuel_pump:
    name: Fuel pump
    watch: L('SWITCH_FUEL_PUMP_1_1')
    write: |
      (value) => {
        write(L('SWITCH_FUEL_PUMP_1_1'), value)

        write(H('FUEL'))
      }


  fcu_heading:
    name: FCU heading
    default: 0
    watch:
      inc: K('SOME_AC_HDG_INC')
      dec: K('SOME_AC_HDG_DEC')
      wrap: true
      range: [0, 359]
    write:
      inc: K('SOME_AC_HDG_INC')
      dec: K('SOME_AC_HDG_DEC')
events:
  ap_master:
    name: Autopilot master
    watch: K('AP_MASTER')
    write: K('AP_MASTER')
    ignore: K('TOGGLE_FLIGHT_DIRECTOR')
";

const RADIO: &str = "\
authors: Someone else
state:
  com_1:
    name: COM 1
    watch: A('COM ACTIVE FREQUENCY:1', 'MHz')
    write: K('COM_RADIO_SET_HZ', value)
";

fn baron() -> Tree {
    tree(&[
        ("aircraft/bksq-baronpro.yaml", BARON),
        ("modules/radio.yaml", RADIO),
    ])
}

#[test]
fn a_profile_and_its_module_check_with_nothing_to_report() {
    let s = source(&baron(), "aircraft/bksq-baronpro.yaml").expect("the files load");
    assert_eq!(
        s.paths(),
        ["aircraft/bksq-baronpro.yaml", "modules/radio.yaml"]
    );
    let report = check(&s, LEVEL);
    assert!(report.diagnostics.is_empty(), "{report}");
}

/// The builder compiles each script; here each script stands for its own JavaScript.
fn compiled(s: &profile_engine::Source) -> Compiled {
    Compiled {
        scripts: program(s, LEVEL).scripts,
    }
}

#[test]
fn a_bundle_written_and_read_back_gives_the_profile_it_was_written_from() {
    let s = source(&baron(), "aircraft/bksq-baronpro.yaml").expect("the files load");
    let bytes = write(&s, &compiled(&s));
    let text = String::from_utf8(bytes.clone()).expect("UTF-8");
    assert!(!text.contains("import"), "{text}");
    assert!(!text.contains('\r'));
    let p = read(&bytes, LEVEL).unwrap_or_else(|r| panic!("{r}\n{text}"));

    assert_eq!(p.name, "Black Square Baron");
    assert_eq!(p.status, ProfileStatus::Experimental);
    assert_eq!(p.authors.as_deref(), Some("Dual Input"));
    assert_eq!(
        p.state[0].description.as_deref(),
        Some("Full rich: the lever at its top")
    );
    assert_eq!(p.state[1].description, None);
    let keys: Vec<&str> = p.state.iter().map(|e| e.key.as_str()).collect();
    assert_eq!(
        keys,
        [
            "mixture_1",
            "heading_bug",
            "fuel_pump",
            "fcu_heading",
            "com_1"
        ]
    );
    assert_eq!(p.state[0].owner, Owner::PilotFlying);
    assert_eq!(p.state[0].only, ["press"]);
    let Write::Function(js) = &p.state[2].write else {
        panic!("a function")
    };
    assert_eq!(
        js,
        "(value) => {\n  write(L('SWITCH_FUEL_PUMP_1_1'), value)\n\n  write(H('FUEL'))\n}\n"
    );
    let Watch::Count(count) = &p.state[3].watch else {
        panic!("a count")
    };
    assert_eq!(
        (count.default, count.wrap, count.range),
        (0.0, true, (0.0, 359.0))
    );
    let Write::Name(Name::K { values, .. }) = &p.state[4].write else {
        panic!("a K: event")
    };
    assert_eq!(values, &[profile_engine::Arg::Value]);

    // A bundle is a profile with nothing to merge, so it loads as a source of its own, and
    // written again, with its JavaScript as the compiled scripts, it gives the same bytes.
    let text = String::from_utf8(bytes.clone()).expect("UTF-8");
    let again = source(&tree(&[("b.yaml", &text)]), "b.yaml").expect("a bundle loads");
    assert_eq!(write(&again, &compiled(&again)), bytes);
}

#[test]
fn a_script_with_blank_lines_at_its_end_or_none_comes_back_the_same() {
    for (block, text) in [
        ("|-", "(value) => write(L('X'), value)"),
        ("|", "(value) => write(L('X'), value)\n"),
        ("|+", "(value) => write(L('X'), value)\n\n\n"),
        ("|2", "  (value) => write(L('X'), value)\n"),
    ] {
        let body: String = text
            .trim_end_matches('\n')
            .split('\n')
            .map(|l| format!("      {l}\n"))
            .collect();
        let trailing = "\n".repeat(text.len() - text.trim_end_matches('\n').len());
        let yaml = format!(
            "maker: M\nname: A\nstatus: complete\naircraft:\n  variants:\n    a: x\nstate:\n  x:\n    name: X\n    watch: L('X')\n    write: {block}\n{body}{}",
            if trailing.len() > 1 {
                &trailing[1..]
            } else {
                ""
            }
        );
        let s = source(&tree(&[("p.yaml", &yaml)]), "p.yaml").expect("loads");
        let bytes = write(&s, &compiled(&s));
        let p = read(&bytes, LEVEL).unwrap_or_else(|r| panic!("{r}"));
        let Write::Function(js) = &p.state[0].write else {
            panic!("a function")
        };
        assert_eq!(js, text, "{block}");
    }
}

/// Each error a profile's own blocks can have, at the line and column of what's wrong.
#[test]
fn each_error_is_reported_at_its_place_with_its_code() {
    let head = "maker: M\nname: A\nstatus: complete\naircraft:\n  variants:\n    a: x\n    b: y\n";
    let entry = |rest: &str| format!("state:\n  x:\n    name: X\n{rest}");
    for (body, code, line, column) in [
        ("unknown: 1\n".to_string(), "unknown-block", 8, 1),
        (
            entry("    watch: L('X')\n    write: L('X')\n    colour: red\n"),
            "unknown-field",
            13,
            5,
        ),
        ("state:\n  X:\n    name: X\n".to_string(), "key-form", 9, 3),
        (entry("    watch: L('X')\n"), "required", 9, 3),
        (
            "state:\n  x:\n    name: 5\n    watch: L('X')\n    write: L('X')\n".to_string(),
            "type",
            10,
            11,
        ),
        (
            "state:\n  x:\n    name: \"\"\n    watch: L('X')\n    write: L('X')\n".to_string(),
            "type",
            10,
            11,
        ),
        (
            entry("    watch: K('X')\n    write: K('X')\n"),
            "name-kind",
            11,
            12,
        ),
        (
            "events:\n  x:\n    name: X\n    watch: A('X', 'Bool')\n    write: K('X')\n"
                .to_string(),
            "name-kind",
            11,
            12,
        ),
        (
            "events:\n  x:\n    name: X\n    watch: instrument('G', 'a')\n    write: H('X')\n"
                .to_string(),
            "name-kind",
            11,
            12,
        ),
        (
            entry("    watch: L('X')\n    write: instrument('G', 'a')\n"),
            "name-kind",
            12,
            12,
        ),
        (
            entry("    watch: L('X')\n    write: L('X')\n    ignore: instrument('G', 'a')\n"),
            "name-kind",
            13,
            13,
        ),
        (
            entry("    watch: L('X')\n    write: H('X', 'Bool')\n"),
            "name",
            12,
            12,
        ),
        (
            entry("    watch: A('X')\n    write: L('X')\n"),
            "name",
            11,
            12,
        ),
        (
            entry("    watch: instrument('G', 'f()')\n    write: H('X')\n"),
            "name",
            11,
            12,
        ),
        (
            entry("    watch: L('X')\n    write:\n      inc: K('I')\n      dec: K('D')\n"),
            "wrap",
            13,
            7,
        ),
        (
            entry(
                "    watch: L('X')\n    write:\n      inc: K('I')\n      dec: K('D')\n      wrap: true\n",
            ),
            "range",
            13,
            7,
        ),
        (
            entry("    watch: L('X')\n    wrap: true\n    write: L('X')\n"),
            "unknown-field",
            12,
            5,
        ),
        (
            entry(
                "    watch:\n      inc: K('I')\n      wrap: true\n      range: [0, 9]\n    write: none\n",
            ),
            "default",
            12,
            7,
        ),
        (
            entry(
                "    default: 0\n    watch:\n      inc: K('I')\n      wrap: true\n    write: none\n",
            ),
            "wrap",
            13,
            7,
        ),
        (
            entry(
                "    default: 0\n    watch:\n      inc: K('I')\n      wrap: true\n      range: [0, 9]\n    write:\n      inc: K('I')\n      dec: K('D')\n      wrap: true\n",
            ),
            "wrap",
            19,
            13,
        ),
        (
            entry("    default: 0\n    watch: L('X')\n    write: L('X')\n"),
            "default",
            11,
            14,
        ),
        (
            entry("    watch: L('X')\n    write: L('X')\n    only: c\n"),
            "variant-unknown",
            13,
            11,
        ),
        (
            entry(
                "    watch: L('X')\n    write: L('X')\n  y:\n    name: Y\n    watch: L('X')\n    write: L('Y')\n",
            ),
            "watch-twice",
            15,
            12,
        ),
        (
            entry("    watch: L('X')\n    write: K('X', value, value)\n"),
            "name",
            12,
            12,
        ),
        (
            entry("    watch: L('X')\n    write: L('X')\n    ignore: K('X', value)\n"),
            "value-place",
            13,
            13,
        ),
        (
            "events:\n  x:\n    name: X\n    watch: K('X')\n    write: none\n".to_string(),
            "write",
            12,
            12,
        ),
        (
            "events:\n  x:\n    name: X\n    watch: K('X')\n    write:\n      toggle: K('X')\n"
                .to_string(),
            "write",
            13,
            7,
        ),
        (
            "events:\n  x:\n    name: X\n    watch: K('X')\n    write:\n      inc: K('I')\n      dec: K('D')\n"
                .to_string(),
            "write",
            13,
            7,
        ),
        (
            entry(
                "    watch: L('X')\n    write:\n      inc: K('I')\n      dec: K('D')\n      wrap: false\n      pace: 2 frame\n",
            ),
            "pace",
            16,
            13,
        ),
        (
            entry("    watch: L('X')\n    write:\n      toggle: L('X')\n"),
            "name-kind",
            13,
            15,
        ),
        (
            entry("    watch: L('X')\n    write: L('X')\n    owner: captain\n"),
            "owner",
            13,
            12,
        ),
        ("import: modules/none\n".to_string(), "module-missing", 8, 9),
    ] {
        let yaml = format!("{head}{body}");
        let report = match source(&tree(&[("p.yaml", &yaml)]), "p.yaml") {
            Ok(s) => check(&s, LEVEL),
            Err(r) => r,
        };
        let found = report
            .diagnostics
            .iter()
            .find(|d| d.code == code && d.severity == Severity::Error);
        assert!(
            found.is_some_and(
                |d| (d.at.file.as_str(), d.at.line, d.at.column) == ("p.yaml", line, column)
            ),
            "expected {code} at {line}:{column} in:\n{yaml}\ngot:\n{report}"
        );
    }
}

/// The diagnostic `code` in `report`, by its file, line, and column.
fn place_of<'a>(report: &'a profile_engine::Report, code: &str) -> (&'a str, usize, usize) {
    let d = report
        .diagnostics
        .iter()
        .find(|d| d.code == code)
        .unwrap_or_else(|| panic!("no {code} in:\n{report}"));
    (d.at.file.as_str(), d.at.line, d.at.column)
}

#[test]
fn a_variants_path_is_written_with_slashes() {
    let report = check(
        &source(
            &tree(&[(
                "p.yaml",
                "maker: M\nname: A\nstatus: complete\naircraft:\n  variants:\n    a: x\\y\n",
            )]),
            "p.yaml",
        )
        .expect("loads"),
        LEVEL,
    );
    assert_eq!(place_of(&report, "variant-path"), ("p.yaml", 6, 8));
}

#[test]
fn a_profile_needs_a_maker_a_name_and_a_status_and_a_module_holds_none() {
    let codes = |files: &[(&str, &str)]| -> Vec<String> {
        let report = check(&source(&tree(files), "p.yaml").expect("loads"), LEVEL);
        report.errors().map(|d| d.code.clone()).collect()
    };
    let head = "aircraft:\n  variants:\n    a: x\n";
    assert_eq!(
        codes(&[("p.yaml", head)]),
        ["required", "required", "required"]
    );
    assert_eq!(
        codes(&[("p.yaml", &format!("maker: M\nname: A\n{head}"))]),
        ["required"]
    );
    assert_eq!(
        codes(&[(
            "p.yaml",
            &format!("maker: M\nstatus: stable\nname: A\n{head}")
        )]),
        ["status"]
    );
    assert_eq!(
        codes(&[
            (
                "p.yaml",
                &format!("maker: M\nname: A\nstatus: complete\nimport: modules/m\n{head}")
            ),
            ("modules/m.yaml", "maker: M\nname: M\nstatus: complete\n"),
        ]),
        ["module-only", "module-only", "module-only"]
    );
}

#[test]
fn only_a_state_entry_takes_a_description() {
    let yaml = "maker: M\nname: A\nstatus: complete\naircraft:\n  variants:\n    a: x\nevents:\n  x:\n    name: X\n    description: An event\n    watch: K('X')\n    write: K('X')\n";
    let report = check(
        &source(&tree(&[("p.yaml", yaml)]), "p.yaml").expect("loads"),
        LEVEL,
    );
    assert_eq!(place_of(&report, "unknown-field"), ("p.yaml", 10, 5));
}

#[test]
fn a_key_defined_in_a_profile_and_its_module_and_a_module_with_only_fail_in_the_module() {
    let files = tree(&[
        (
            "p.yaml",
            "maker: M\nname: A\nstatus: complete\naircraft:\n  variants:\n    a: x\nimport: [modules/m]\nstate:\n  x:\n    name: X\n    watch: L('X')\n    write: L('X')\n",
        ),
        (
            "modules/m.yaml",
            "state:\n  x:\n    name: X\n    watch: L('Y')\n    write: L('Y')\n    only: a\n",
        ),
    ]);
    let report = check(&source(&files, "p.yaml").expect("loads"), LEVEL);
    let codes: Vec<&str> = report.errors().map(|d| d.code.as_str()).collect();
    assert_eq!(codes, ["key-twice", "module-only"], "{report}");
    assert_eq!(place_of(&report, "key-twice"), ("modules/m.yaml", 2, 3));
    assert_eq!(place_of(&report, "module-only"), ("modules/m.yaml", 6, 5));
}

#[test]
fn an_import_cycle_fails_at_the_import_that_closes_it() {
    let files = tree(&[
        (
            "p.yaml",
            "maker: M\nname: A\nstatus: complete\naircraft:\n  variants:\n    a: x\nimport: modules/m\n",
        ),
        ("modules/m.yaml", "import: modules/n\n"),
        ("modules/n.yaml", "import: modules/m\n"),
    ]);
    let report = source(&files, "p.yaml").err().expect("a cycle");
    assert_eq!(place_of(&report, "import-cycle"), ("modules/n.yaml", 1, 9));
}

#[test]
fn an_ignore_on_a_watched_variable_is_a_warning() {
    let yaml = "maker: M\nname: A\nstatus: complete\naircraft:\n  variants:\n    a: x\nstate:\n  x:\n    name: X\n    watch: L('X')\n    write: L('X')\n  y:\n    name: Y\n    watch: L('Y')\n    write: L('Y')\n    ignore: L('X')\n";
    let report = check(
        &source(&tree(&[("p.yaml", yaml)]), "p.yaml").expect("loads"),
        LEVEL,
    );
    assert!(!report.has_errors(), "{report}");
    assert_eq!(report.diagnostics[0].severity, Severity::Warning);
    assert_eq!(place_of(&report, "ignore-watched"), ("p.yaml", 16, 13));
}

#[test]
fn a_bundle_has_no_import() {
    let report = read(
        b"maker: M\nname: A\nstatus: complete\naircraft:\n  variants:\n    a: x\nimport: modules/m\n",
        LEVEL,
    )
    .expect_err("an error");
    assert_eq!(place_of(&report, "import"), ("bundle.yaml", 7, 1));
}
#[test]
fn each_variants_file_declares_only_its_own_entries() {
    let s = source(&baron(), "aircraft/bksq-baronpro.yaml").expect("loads");
    let p = program(&s, LEVEL);
    let names: Vec<&str> = p.files.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(names, ["base.ts", "press.ts"]);
    assert!(!p.files[0].text.contains("mixture_1"));
    assert!(p.files[1].text.contains("readonly mixture_1: number;"));
    assert!(
        p.files[1]
            .text
            .contains("const write_fuel_pump: (value: number) => number | Chain | void = (")
    );
}

#[test]
fn a_type_error_lands_at_its_scripts_line_and_column() {
    let s = source(&baron(), "aircraft/bksq-baronpro.yaml").expect("loads");
    let p = program(&s, LEVEL);
    let file = &p.files[1];
    let line = file
        .text
        .lines()
        .position(|l| l.contains("write(H('FUEL'))"))
        .expect("the script's line");
    let found = [profile_engine::TypeError {
        file: file.name.clone(),
        line,
        column: 2,
        code: "TS2345".into(),
        message: "a mistake".into(),
    }];
    let report = profile_engine::place(&p, &found);
    let d = &report.diagnostics[0];
    assert_eq!(
        (d.at.file.as_str(), d.at.line, d.at.column),
        ("aircraft/bksq-baronpro.yaml", 34, 9)
    );
    assert_eq!(d.code, "TS2345");
    assert_eq!(d.message, "a mistake (on press)");
}

#[test]
fn a_checked_profile_survives_postcard() {
    let s = source(&baron(), "aircraft/bksq-baronpro.yaml").expect("loads");
    let p = read(&write(&s, &compiled(&s)), LEVEL).expect("reads");
    let bytes = postcard::to_stdvec(&p).expect("encodes");
    let back: profile_engine::Profile = postcard::from_bytes(&bytes).expect("decodes");
    assert_eq!(back, p);
    assert_eq!(back.covers("bksq-aircraft-baronpropress"), Some("press"));
    assert_eq!(back.clone().resolve("base").state.len(), 4);
}

#[test]
fn a_modules_schema_leaves_out_what_only_a_profile_holds_and_requires_no_aircraft() {
    let parse = |file| -> serde_json::Value {
        serde_json::from_str(&profile_engine::schema(LEVEL, file)).expect("a schema is JSON")
    };
    let profile = parse(profile_engine::Schema::Profile);
    let module = parse(profile_engine::Schema::Module);
    assert_eq!(
        profile["required"],
        serde_json::json!(["maker", "name", "status", "aircraft"])
    );
    assert!(module.get("required").is_none());
    for key in ["maker", "name", "status", "aircraft", "seats"] {
        assert!(profile["properties"].get(key).is_some(), "{key}");
        assert!(module["properties"].get(key).is_none(), "{key}");
    }
    let state = |s: &serde_json::Value| s["properties"]["state"]["additionalProperties"].clone();
    for key in ["only", "location"] {
        assert!(state(&profile)["properties"].get(key).is_some(), "{key}");
        assert!(state(&module)["properties"].get(key).is_none(), "{key}");
    }
    assert_eq!(
        state(&profile)["required"],
        serde_json::json!(["name", "watch", "write"])
    );
    // An event entry neither counts nor toggles nor steps, which the checker refuses.
    let event = &profile["properties"]["events"]["additionalProperties"]["properties"];
    assert_eq!(event["write"]["type"], "string");
    assert_eq!(event["watch"]["type"], "string");
}

#[test]
fn the_levels_files_name_every_field() {
    let schema = profile_engine::schema(LEVEL, profile_engine::Schema::Profile);
    for key in [
        "name",
        "status",
        "description",
        "authors",
        "variants",
        "watch",
        "toggle",
        "range",
        "pace",
    ] {
        assert!(schema.contains(&format!("\"{key}\"")), "{key}");
    }
    assert!(profile_engine::declarations(LEVEL).contains("declare function write("));
}

const HEAD: &str = "maker: M\nname: A\nstatus: complete\naircraft:\n  variants:\n    a: x\n";

/// The `quotes` errors in a profile's source, by line and column, with their messages.
fn quotes(yaml: &str) -> Vec<(usize, usize, String)> {
    let report = check(
        &source(&tree(&[("p.yaml", yaml)]), "p.yaml").expect("loads"),
        LEVEL,
    );
    report
        .errors()
        .filter(|d| d.code == "quotes")
        .map(|d| (d.at.line, d.at.column, d.message.clone()))
        .collect()
}

/// Outside a script, an author's file takes single quotes alone, and the error shows the text
/// in them (record/areas/profiles/03-the-extension.md, "Quotes").
#[test]
fn a_double_quoted_text_in_a_source_fails_with_its_single_quoted_form() {
    let yaml = format!(
        "{HEAD}state:\n  radio:\n    name: \"Radio: COM1\"\n    description: \"Pilot's\"\n    watch: L('X')\n    write: L('X')\n    only: [\"a\"]\n"
    );
    let found = quotes(&yaml);
    let places: Vec<(usize, usize)> = found.iter().map(|(l, c, _)| (*l, *c)).collect();
    assert_eq!(places, [(9, 11), (10, 18), (13, 12)], "{found:?}");
    assert_eq!(
        found[0].2,
        "Outside a script, a profile writes text in single quotes, as `'Radio: COM1'`"
    );
    assert!(found[1].2.ends_with("as `'Pilot''s'`"), "{}", found[1].2);
}

#[test]
fn a_name_call_with_a_double_quoted_text_fails_at_that_text() {
    let yaml = format!(
        "{HEAD}state:\n  x:\n    name: X\n    watch: A('X', \"Bool\")\n    write: K(\"it's\", value)\n"
    );
    let found = quotes(&yaml);
    assert_eq!(found.len(), 2, "{found:?}");
    assert_eq!((found[0].0, found[0].1), (10, 19));
    assert_eq!(
        found[0].2,
        "Outside a script, a profile writes text in single quotes, as `A('X', 'Bool')`"
    );
    assert_eq!((found[1].0, found[1].1), (11, 14));
    assert!(
        found[1].2.ends_with("as `K('it\\'s', value)`"),
        "{}",
        found[1].2
    );
}

/// An author's script takes one form, a `|` block, and a folded block, a plain script, and a
/// quoted one each fail where their text starts (record/areas/profiles/01-format-and-delivery.md,
/// "What fails a load").
#[test]
fn a_script_other_than_a_literal_block_fails_with_script_block() {
    let entry = |key: &str, write: &str| {
        format!("  {key}:\n    name: X\n    watch: L('{key}')\n    write: {write}\n")
    };
    let yaml = format!(
        "{HEAD}state:\n{}{}{}{}{}",
        entry(
            "literal",
            "|\n      (value) => {\n        write(L('A'), value)\n      }"
        ),
        entry("trimmed", "|-\n      (value) => write(L('B'), value)"),
        entry(
            "folded",
            ">\n      (value) => {\n        write(L('C'), value)\n      }"
        ),
        entry("plain", "(value) =>\n      write(L('D'), value)"),
        entry("quoted", "'(value) => write(L(''E''), value)'"),
    );
    let report = check(
        &source(&tree(&[("p.yaml", &yaml)]), "p.yaml").expect("loads"),
        LEVEL,
    );
    let found: Vec<usize> = report
        .errors()
        .filter(|d| d.code == "script-block")
        .map(|d| d.at.line)
        .collect();
    assert_eq!(found, [24, 30, 35], "{yaml}");
}

#[test]
fn a_script_and_a_comment_take_double_quotes() {
    let yaml = format!(
        "{HEAD}state:\n  x:\n    name: X # \"a comment\"\n    watch: L('X')\n    write: |\n      (value) => write(L(\"X\"), value + \"'\".length)\n"
    );
    assert!(quotes(&yaml).is_empty());
}

/// A bundle keeps double quotes where YAML needs quotes, as the builder writes it, so the rule
/// holds an author's files alone.
#[test]
fn a_bundle_that_holds_double_quotes_reads_back() {
    let yaml =
        format!("{HEAD}state:\n  x:\n    name: 'true'\n    watch: L('X')\n    write: L('X')\n");
    let s = source(&tree(&[("p.yaml", &yaml)]), "p.yaml").expect("loads");
    let bytes = write(&s, &compiled(&s));
    let text = String::from_utf8(bytes.clone()).expect("UTF-8");
    assert!(text.contains("name: \"true\""), "{text}");
    let p = read(&bytes, LEVEL).unwrap_or_else(|r| panic!("{r}\n{text}"));
    assert_eq!(p.state[0].name, "true");
}

/// TypeScript's completion and hovers show a key's doc comment, so an author reads the entry's
/// name beside `state.battery_1`.
#[test]
fn each_key_of_state_carries_its_entrys_name_as_a_doc_comment() {
    let yaml = format!(
        "{HEAD}state:\n  battery_1:\n    name: Battery 1\n    watch: L('X')\n    write: L('X')\n  odd:\n    name: Ends */ here\n    watch: L('Y')\n    write: |\n      (value) => write(L('Y'), value)\n"
    );
    let s = source(&tree(&[("p.yaml", &yaml)]), "p.yaml").expect("loads");
    let p = program(&s, LEVEL);
    let text = &p.files[0].text;
    assert!(
        text.contains("  /** Battery 1 */\n  readonly battery_1: number;\n"),
        "{text}"
    );
    assert!(text.contains("/** Ends *\\/ here */"), "{text}");
    let line = text
        .lines()
        .position(|l| l.starts_with("(value) =>"))
        .expect("the script");
    let found = [profile_engine::TypeError {
        file: "a.ts".into(),
        line,
        column: 0,
        code: "TS2304".into(),
        message: "a mistake".into(),
    }];
    let d = &profile_engine::place(&p, &found).diagnostics[0];
    assert_eq!((d.at.line, d.at.column), (16, 7));
}

#[test]
fn a_place_in_a_script_maps_to_the_program_and_back() {
    let s = source(&baron(), "aircraft/bksq-baronpro.yaml").expect("loads");
    let p = program(&s, LEVEL);
    let at = profile_engine::Place::new("aircraft/bksq-baronpro.yaml", 34, 9);
    let in_program = p.to_program(&at);
    let files: Vec<&str> = in_program.iter().map(|q| q.file.as_str()).collect();
    assert_eq!(files, ["base.ts", "press.ts"]);
    let line = &p.files[0]
        .text
        .lines()
        .nth(in_program[0].line)
        .expect("a line");
    assert_eq!(&line[in_program[0].column..], "write(H('FUEL'))");
    assert_eq!(p.to_yaml(&in_program[1]), Some(at));
    let outside = profile_engine::Place::new("aircraft/bksq-baronpro.yaml", 30, 5);
    assert!(p.to_program(&outside).is_empty());
    let one_line = source(
        &tree(&[(
            "p.yaml",
            &format!("{HEAD}state:\n  x:\n    name: X\n    watch: L('X')\n    write: '(value) => write(L(''X''), value)'\n"),
        )]),
        "p.yaml",
    )
    .expect("loads");
    let p = program(&one_line, LEVEL);
    assert!(
        p.to_program(&profile_engine::Place::new("p.yaml", 11, 12))
            .is_empty()
    );
    let q = p.to_program(&profile_engine::Place::new("p.yaml", 11, 15));
    assert_eq!((q[0].line, q[0].column), (6, 2));
}

/// A module that no profile imports is checked against its own entries alone, by a module's
/// rules (record/areas/profiles/03-the-extension.md, "Checks").
#[test]
fn a_module_read_on_its_own_checks_as_a_module_and_declares_its_own_entries() {
    let files = tree(&[("modules/radio.yaml", RADIO)]);
    let s = profile_engine::module_source(&files, "modules/radio.yaml").expect("loads");
    let report = check(&s, LEVEL);
    assert!(report.diagnostics.is_empty(), "{report}");
    let p = program(&s, LEVEL);
    let names: Vec<&str> = p.files.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(names, ["module.ts"]);
    assert!(p.files[0].text.contains("readonly com_1: number;"));
    let profile_only = tree(&[("modules/m.yaml", "maker: M\n")]);
    let s = profile_engine::module_source(&profile_only, "modules/m.yaml").expect("loads");
    assert_eq!(
        place_of(&check(&s, LEVEL), "module-only"),
        ("modules/m.yaml", 1, 1)
    );
}

/// An editor offers a field's names from its table, which are the names the checker takes there.
#[test]
fn the_tables_give_each_fields_names_words_and_whether_its_required() {
    use profile_engine::{Allowed, Call, Table, fields};
    let state = fields(Table::StateEntry);
    let field = |key: &str| *state.iter().find(|f| f.key == key).expect("a field");
    assert_eq!(field("watch").names, Some(Allowed::StateWatch));
    assert!(!Allowed::StateWatch.calls().contains(&Call::K));
    assert!(field("watch").required && !field("owner").required);
    assert_eq!(field("owner").words, ["pilot_flying", "shared"]);
    assert_eq!(field("write").words, ["none"]);
    let toggle = fields(Table::Toggle);
    assert_eq!(toggle[0].names, Some(Allowed::Event));
    assert_eq!(Call::A.blank(), "A('', '')");
    assert!(profile_engine::is_entry_key("battery_1"));
    assert!(!profile_engine::is_entry_key("Battery"));
    assert_eq!(
        profile_engine::module_file("modules/gns-430").as_deref(),
        Some("modules/gns-430.yaml")
    );
    assert!(profile_engine::plain("Left mixture") && !profile_engine::plain("Radio: COM1"));
}

/// A bundle that fails its level's frozen fields fails to read, as the builder's read-back and
/// a core's load both do: here, every field came in at level 1.
#[test]
fn a_bundle_using_a_field_above_its_level_fails_to_read() {
    let report = read(
        b"maker: M\nname: A\nstatus: complete\nauthors: X\naircraft:\n  variants:\n    a: x\n",
        0,
    )
    .expect_err("level 0");
    assert_eq!(place_of(&report, "above-level"), ("bundle.yaml", 1, 1));
}
