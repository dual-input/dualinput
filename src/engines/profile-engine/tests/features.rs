//! A feature's module in the format, through avatars' `seats`, `location`, and `deadband`: its
//! fields checked as the format's own are, at their places, written into a bundle and read
//! back, resolved for a variant, and named in the level's schema.

use std::collections::BTreeMap;

use profile_engine::features::avatars::Location;
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
maker: M
name: A
maturity: stable
aircraft:
  variants:
    base: bksq-aircraft-baronpro
    press: bksq-aircraft-baronpropress
state:
  mixture_1:
    name: Left mixture
    watch: L('BKSQ_MixtureLeverPosition_1')
    write: L('BKSQ_MixtureLeverPosition_1')
    location:
      base: [0.21, 0.55, 1.92]
      press: [0.2, 0.56, 1.9]
    deadband: 2
  battery:
    name: Battery
    watch: L('BATTERY')
    write: L('BATTERY')
    location: [0.4, 0.6, 1.8]
events:
  ap_master:
    name: Autopilot master
    watch: K('AP_MASTER')
    write: K('AP_MASTER')
    location: [0, 0.7, 1.95]
seats:
  pilot:
    name: Pilot
    hip: [0.31, 0.12, 1.4]
    knees: [0.05, 0.45]
    feet: [-0.42, 0.62]
    eye: [0.63, -0.05]
  copilot:
    name: Copilot
    hip: [-0.31, 0.12, 1.4]
    knees: [0.05, 0.45]
    feet: [-0.42, 0.62]
    eye: [0.63, -0.05]
    facing: 5
    take_radius: 0.25
    only: press
";

fn compiled(s: &profile_engine::Source) -> Compiled {
    Compiled {
        scripts: program(s, LEVEL).scripts,
    }
}

#[test]
fn seats_and_locations_check_and_come_back_from_a_bundle() {
    let s = source(&tree(&[("p.yaml", PROFILE)]), "p.yaml").expect("loads");
    let report = check(&s, LEVEL);
    assert!(report.diagnostics.is_empty(), "{report}");
    let bytes = write(&s, &compiled(&s));
    let text = String::from_utf8(bytes.clone()).expect("UTF-8");
    let p = read(&bytes, LEVEL).unwrap_or_else(|r| panic!("{r}\n{text}"));
    let seats = &p.features.avatars.seats;
    assert_eq!(seats.len(), 2);
    assert_eq!(seats[1].key, "copilot");
    assert_eq!(seats[1].hip, [-0.31, 0.12, 1.4]);
    assert_eq!((seats[1].facing, seats[1].take_radius), (5.0, Some(0.25)));
    let mixture = &p.state[0].features.avatars;
    assert_eq!(mixture.deadband, Some(2.0));
    assert_eq!(
        mixture.location.as_ref().and_then(|l| l.at("press")),
        Some([0.2, 0.56, 1.9])
    );
    assert_eq!(
        p.state[1].features.avatars.location,
        Some(Location::Everywhere([0.4, 0.6, 1.8]))
    );
    assert!(p.events[0].features.avatars.location.is_some());
    // Written again from the bundle, it gives the same bytes.
    let again = source(&tree(&[("b.yaml", &text)]), "b.yaml").expect("a bundle loads");
    assert_eq!(write(&again, &compiled(&again)), bytes);
}

#[test]
fn a_variant_gets_its_own_seats_and_locations() {
    let s = source(&tree(&[("p.yaml", PROFILE)]), "p.yaml").expect("loads");
    let p = read(&write(&s, &compiled(&s)), LEVEL).expect("reads");
    let base = p.clone().resolve("base");
    let keys: Vec<&str> = base
        .features
        .avatars
        .seats
        .iter()
        .map(|s| s.key.as_str())
        .collect();
    assert_eq!(keys, ["pilot"], "the copilot's seat is the press's alone");
    assert_eq!(p.resolve("press").features.avatars.seats.len(), 2);
    let map = Location::ByVariant(vec![("press".into(), [1.0, 2.0, 3.0])]);
    assert_eq!(
        map.at("base"),
        None,
        "a variant missing from the map gets no location"
    );
}

/// Each error avatars' module adds, at the line and column of what's wrong.
#[test]
fn each_error_avatars_adds_is_reported_at_its_place() {
    let head = "maker: M\nname: A\nmaturity: stable\naircraft:\n  variants:\n    a: x\n";
    let entry = |rest: &str| {
        format!("{head}state:\n  x:\n    name: X\n    watch: L('X')\n    write: L('X')\n{rest}")
    };
    let seat = |rest: &str| format!("{head}seats:\n  pilot:\n    name: Pilot\n{rest}");
    let full = "    hip: [0, 0, 0]\n    knees: [0, 0]\n    feet: [0, 0]\n    eye: [0, 0]\n";
    for (yaml, code, line, column) in [
        (entry("    location: [1, 2]\n"), "point", 12, 15),
        (
            entry("    location:\n      b: [1, 2, 3]\n"),
            "variant-unknown",
            13,
            7,
        ),
        (entry("    deadband: -1\n"), "type", 12, 15),
        (entry("    deadband: big\n"), "type", 12, 15),
        (seat("    hip: [0, 0, 0]\n"), "required", 8, 3),
        (seat(&format!("{full}    eye: [0, 0, 0]\n")), "yaml", 14, 5),
        (seat(&format!("{full}    take_radius: 0\n")), "type", 14, 18),
        (
            seat(&format!("{full}    only: b\n")),
            "variant-unknown",
            14,
            11,
        ),
        (
            seat(&format!("{full}    lean: 3\n")),
            "unknown-field",
            14,
            5,
        ),
    ] {
        let found = source(&tree(&[("p.yaml", &yaml)]), "p.yaml")
            .map(|s| check(&s, LEVEL))
            .unwrap_or_else(|r| r);
        let d = found
            .diagnostics
            .iter()
            .find(|d| d.code == code)
            .unwrap_or_else(|| panic!("no {code} in:\n{yaml}\ngot:\n{found}"));
        assert_eq!(
            (d.at.line, d.at.column),
            (line, column),
            "{code} in:\n{yaml}\ngot:\n{found}"
        );
    }
}

#[test]
fn a_module_holds_no_seats_or_locations() {
    let files = tree(&[
        (
            "p.yaml",
            "maker: M\nname: A\nmaturity: stable\naircraft:\n  variants:\n    a: x\nimport: modules/m\n",
        ),
        (
            "modules/m.yaml",
            "state:\n  y:\n    name: Y\n    watch: L('Y')\n    write: L('Y')\n    location: [0, 0, 0]\n    deadband: 1\nseats: {}\n",
        ),
    ]);
    let report = check(&source(&files, "p.yaml").expect("loads"), LEVEL);
    let codes: Vec<(&str, usize)> = report
        .errors()
        .map(|d| (d.code.as_str(), d.at.line))
        .collect();
    assert_eq!(codes, [("module-only", 6), ("module-only", 8)], "{report}");
}

#[test]
fn the_levels_schema_names_avatars_fields() {
    let schema = profile_engine::schema(LEVEL);
    for key in ["seats", "take_radius", "location", "deadband"] {
        assert!(schema.contains(&format!("\"{key}\"")), "{key}");
    }
}
