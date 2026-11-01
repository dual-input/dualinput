//! Pointer sync's `displays`: a module's join its profile's, a WASM instrument fails the load at
//! its place, and the block comes back from a bundle and is named in the level's schema.

use std::collections::BTreeMap;

use profile_engine::features::pointer_sync::displays;
use profile_engine::{Compiled, Files, LEVEL, check, program, read, source, write};

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

const PROFILE: &str = "\
name: A
maturity: stable
aircraft:
  variants:
    a: x
import: modules/gtn
displays:
  - BlackSquareTablet
  - CTP|side=left
";

const MODULE: &str = "displays: [PMS50_GTN750, BlackSquareTablet]\n";

#[test]
fn a_modules_displays_join_its_profiles_and_come_back_from_a_bundle() {
    let files = tree(&[("p.yaml", PROFILE), ("modules/gtn.yaml", MODULE)]);
    let s = source(&files, "p.yaml").expect("loads");
    let report = check(&s, LEVEL);
    assert!(report.diagnostics.is_empty(), "{report}");
    let bytes = write(
        &s,
        &Compiled {
            scripts: program(&s, LEVEL).scripts,
        },
    );
    let text = String::from_utf8(bytes.clone()).expect("UTF-8");
    let p = read(&bytes, LEVEL).unwrap_or_else(|r| panic!("{r}\n{text}"));
    assert_eq!(
        displays(&p.resolve("a")),
        ["BlackSquareTablet", "CTP|side=left", "PMS50_GTN750"],
        "the module's join the profile's, and one named twice is one"
    );
    assert!(
        text.contains("displays:\n  - BlackSquareTablet\n"),
        "{text}"
    );
}

#[test]
fn one_display_on_its_own_is_a_list_of_one() {
    let s = source(
        &tree(&[(
            "p.yaml",
            "name: A\nmaturity: stable\naircraft:\n  variants:\n    a: x\ndisplays: DisplayUnits\n",
        )]),
        "p.yaml",
    )
    .expect("loads");
    let bytes = write(
        &s,
        &Compiled {
            scripts: program(&s, LEVEL).scripts,
        },
    );
    let p = read(&bytes, LEVEL).expect("reads");
    assert_eq!(displays(&p.resolve("a")), ["DisplayUnits"]);
}

#[test]
fn a_wasm_instrument_fails_the_load_at_its_place() {
    let yaml = "name: A\nmaturity: stable\naircraft:\n  variants:\n    a: x\ndisplays:\n  - DisplayUnits\n  - WasmInstrument|wasm_module=ND\n";
    let report = check(
        &source(&tree(&[("p.yaml", yaml)]), "p.yaml").expect("loads"),
        LEVEL,
    );
    let found: Vec<(&str, usize, usize)> = report
        .errors()
        .map(|d| (d.code.as_str(), d.at.line, d.at.column))
        .collect();
    assert_eq!(found, [("displays-wasm", 8, 5)], "{report}");
}

#[test]
fn the_levels_schema_names_displays() {
    assert!(profile_engine::schema(LEVEL).contains("\"displays\""));
}
