//! The profile engine's checks, each at its place, and a bundle written and read back.

use std::collections::BTreeMap;

use profile_engine::{
    Compiled, Files, LEVEL, Name, Owner, Severity, Watch, Write, check, program, read, source,
    write,
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

    assert_eq!(p.authors.as_deref(), Some("Dual Input"));
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
            "aircraft:\n  variants:\n    a: x\nstate:\n  x:\n    name: X\n    watch: L('X')\n    write: {block}\n{body}{}",
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
    let head = "aircraft:\n  variants:\n    a: x\n    b: y\n";
    let entry = |rest: &str| format!("state:\n  x:\n    name: X\n{rest}");
    for (body, code, line, column) in [
        ("unknown: 1\n".to_string(), "unknown-block", 5, 1),
        (
            entry("    watch: L('X')\n    write: L('X')\n    colour: red\n"),
            "unknown-field",
            10,
            5,
        ),
        ("state:\n  X:\n    name: X\n".to_string(), "key-form", 6, 3),
        (entry("    watch: L('X')\n"), "required", 6, 3),
        (
            "state:\n  x:\n    name: 5\n    watch: L('X')\n    write: L('X')\n".to_string(),
            "type",
            7,
            11,
        ),
        (
            "state:\n  x:\n    name: \"\"\n    watch: L('X')\n    write: L('X')\n".to_string(),
            "type",
            7,
            11,
        ),
        (
            entry("    watch: K('X')\n    write: K('X')\n"),
            "name-kind",
            8,
            12,
        ),
        (
            "events:\n  x:\n    name: X\n    watch: A('X', 'Bool')\n    write: K('X')\n"
                .to_string(),
            "name-kind",
            8,
            12,
        ),
        (
            "events:\n  x:\n    name: X\n    watch: instrument('G', 'a')\n    write: H('X')\n"
                .to_string(),
            "name-kind",
            8,
            12,
        ),
        (
            entry("    watch: L('X')\n    write: instrument('G', 'a')\n"),
            "name-kind",
            9,
            12,
        ),
        (
            entry("    watch: L('X')\n    write: L('X')\n    ignore: instrument('G', 'a')\n"),
            "name-kind",
            10,
            13,
        ),
        (
            entry("    watch: L('X')\n    write: H('X', 'Bool')\n"),
            "name",
            9,
            12,
        ),
        (
            entry("    watch: A('X')\n    write: L('X')\n"),
            "name",
            8,
            12,
        ),
        (
            entry("    watch: instrument('G', 'f()')\n    write: H('X')\n"),
            "name",
            8,
            12,
        ),
        (
            entry("    watch: L('X')\n    write:\n      inc: K('I')\n      dec: K('D')\n"),
            "wrap",
            10,
            7,
        ),
        (
            entry(
                "    watch: L('X')\n    write:\n      inc: K('I')\n      dec: K('D')\n      wrap: true\n",
            ),
            "range",
            10,
            7,
        ),
        (
            entry("    watch: L('X')\n    wrap: true\n    write: L('X')\n"),
            "unknown-field",
            9,
            5,
        ),
        (
            entry(
                "    watch:\n      inc: K('I')\n      wrap: true\n      range: [0, 9]\n    write: none\n",
            ),
            "default",
            9,
            7,
        ),
        (
            entry(
                "    default: 0\n    watch:\n      inc: K('I')\n      wrap: true\n    write: none\n",
            ),
            "wrap",
            10,
            7,
        ),
        (
            entry(
                "    default: 0\n    watch:\n      inc: K('I')\n      wrap: true\n      range: [0, 9]\n    write:\n      inc: K('I')\n      dec: K('D')\n      wrap: true\n",
            ),
            "wrap",
            16,
            13,
        ),
        (
            entry("    default: 0\n    watch: L('X')\n    write: L('X')\n"),
            "default",
            8,
            14,
        ),
        (
            entry("    watch: L('X')\n    write: L('X')\n    only: c\n"),
            "variant-unknown",
            10,
            11,
        ),
        (
            entry(
                "    watch: L('X')\n    write: L('X')\n  y:\n    name: Y\n    watch: L('X')\n    write: L('Y')\n",
            ),
            "watch-twice",
            12,
            12,
        ),
        (
            entry("    watch: L('X')\n    write: K('X', value, value)\n"),
            "name",
            9,
            12,
        ),
        (
            entry("    watch: L('X')\n    write: L('X')\n    ignore: K('X', value)\n"),
            "value-place",
            10,
            13,
        ),
        (
            "events:\n  x:\n    name: X\n    watch: K('X')\n    write: none\n".to_string(),
            "write",
            9,
            12,
        ),
        (
            "events:\n  x:\n    name: X\n    watch: K('X')\n    write:\n      toggle: K('X')\n"
                .to_string(),
            "write",
            10,
            7,
        ),
        (
            "events:\n  x:\n    name: X\n    watch: K('X')\n    write:\n      inc: K('I')\n      dec: K('D')\n"
                .to_string(),
            "write",
            10,
            7,
        ),
        (
            entry(
                "    watch: L('X')\n    write:\n      inc: K('I')\n      dec: K('D')\n      wrap: false\n      pace: 2 frame\n",
            ),
            "pace",
            13,
            13,
        ),
        (
            entry("    watch: L('X')\n    write:\n      toggle: L('X')\n"),
            "name-kind",
            10,
            15,
        ),
        (
            entry("    watch: L('X')\n    write: L('X')\n    owner: captain\n"),
            "owner",
            10,
            12,
        ),
        ("import: modules/none\n".to_string(), "module-missing", 5, 9),
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
            &tree(&[("p.yaml", "aircraft:\n  variants:\n    a: x\\y\n")]),
            "p.yaml",
        )
        .expect("loads"),
        LEVEL,
    );
    assert_eq!(place_of(&report, "variant-path"), ("p.yaml", 3, 8));
}

#[test]
fn a_key_defined_in_a_profile_and_its_module_and_a_module_with_only_fail_in_the_module() {
    let files = tree(&[
        (
            "p.yaml",
            "aircraft:\n  variants:\n    a: x\nimport: [modules/m]\nstate:\n  x:\n    name: X\n    watch: L('X')\n    write: L('X')\n",
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
            "aircraft:\n  variants:\n    a: x\nimport: modules/m\n",
        ),
        ("modules/m.yaml", "import: modules/n\n"),
        ("modules/n.yaml", "import: modules/m\n"),
    ]);
    let report = source(&files, "p.yaml").err().expect("a cycle");
    assert_eq!(place_of(&report, "import-cycle"), ("modules/n.yaml", 1, 9));
}

#[test]
fn an_ignore_on_a_watched_variable_is_a_warning() {
    let yaml = "aircraft:\n  variants:\n    a: x\nstate:\n  x:\n    name: X\n    watch: L('X')\n    write: L('X')\n  y:\n    name: Y\n    watch: L('Y')\n    write: L('Y')\n    ignore: L('X')\n";
    let report = check(
        &source(&tree(&[("p.yaml", yaml)]), "p.yaml").expect("loads"),
        LEVEL,
    );
    assert!(!report.has_errors(), "{report}");
    assert_eq!(report.diagnostics[0].severity, Severity::Warning);
    assert_eq!(place_of(&report, "ignore-watched"), ("p.yaml", 13, 13));
}

#[test]
fn a_bundle_has_no_import() {
    let report = read(
        b"aircraft:\n  variants:\n    a: x\nimport: modules/m\n",
        LEVEL,
    )
    .expect_err("an error");
    assert_eq!(place_of(&report, "import"), ("bundle.yaml", 4, 1));
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
            .contains("const write_fuel_pump: (value: number) => void = (")
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
        code: 2345,
        message: "a mistake".into(),
    }];
    let report = profile_engine::place(&p, &found);
    let d = &report.diagnostics[0];
    assert_eq!(
        (d.at.file.as_str(), d.at.line, d.at.column),
        ("aircraft/bksq-baronpro.yaml", 30, 9)
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
fn the_levels_files_name_every_field() {
    let schema = profile_engine::schema(LEVEL);
    for key in ["authors", "variants", "watch", "toggle", "range", "pace"] {
        assert!(schema.contains(&format!("\"{key}\"")), "{key}");
    }
    assert!(profile_engine::declarations(LEVEL).contains("declare function write("));
}

/// A bundle that fails its level's frozen fields fails to read, as the builder's read-back and
/// a core's load both do: here, every field came in at level 1.
#[test]
fn a_bundle_using_a_field_above_its_level_fails_to_read() {
    let report = read(b"authors: X\naircraft:\n  variants:\n    a: x\n", 0).expect_err("level 0");
    assert_eq!(place_of(&report, "above-level"), ("bundle.yaml", 1, 1));
}
