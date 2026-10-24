//! The builder's own tests (record/areas/profiles/02-units.md, "Cases for the bench").

// Tests run off the core's loop, so they may start the thread the compiler needs, which the
// root's clippy.toml forbids only the loop.
#![allow(clippy::disallowed_methods)]

use std::collections::BTreeMap;

use profile_build::{Compiler, STACK, build};
use profile_engine::{Files, LEVEL, Write, read};

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

/// Runs `f` with a compiler, on a thread with the stack the compiler needs.
fn with_compiler(f: impl FnOnce(&mut Compiler) + Send + 'static) {
    std::thread::Builder::new()
        .stack_size(STACK)
        .spawn(move || f(&mut Compiler::new()))
        .expect("a thread should start")
        .join()
        .expect("the test's thread should end without a panic");
}

const PROFILE: &str = "\
authors: Dual Input
aircraft:
  variants:
    base: bksq-aircraft-baronpro
    press: bksq-aircraft-baronpropress
state:
  mixture_1:
    name: Left mixture
    watch: L('BKSQ_MixtureLeverPosition_1')
    write: L('BKSQ_MixtureLeverPosition_1')
    only: press
  fuel_pump:
    name: Fuel pump
    watch: L('SWITCH_FUEL_PUMP_1_1')
    write: |
      (value: number) => {
        write(L('SWITCH_FUEL_PUMP_1_1'), value)
        write(H('FUEL'))
      }
  heading_bug:
    name: Heading bug
    watch: A('AUTOPILOT HEADING LOCK DIR', 'Degrees')
    write: |
      (value) => write(K('HEADING_BUG_INC')).repeat(value).every('2 frames')
";

#[test]
fn a_profile_builds_to_the_same_bytes_twice_and_reads_back_at_its_level() {
    with_compiler(|compiler| {
        let files = tree(&[("aircraft/bksq-baronpro.yaml", PROFILE)]);
        let first = build(&files, "aircraft/bksq-baronpro.yaml", compiler);
        assert!(!first.report.has_errors(), "{}", first.report);
        let second = build(&files, "aircraft/bksq-baronpro.yaml", compiler);
        assert_eq!(first.bundle, second.bundle);
        assert_eq!(first.level, Some(1));
        assert_eq!(first.covers.len(), 2);
        let bundle = first.bundle.expect("a bundle");
        assert_eq!(first.hash, Some(profile_engine::hash(&bundle)));
        let p = read(&bundle, LEVEL).expect("the bundle reads back");
        let Write::Function(js) = &p.state[1].write else {
            panic!("a function")
        };
        assert!(!js.contains(": number"), "types are stripped: {js}");
        assert!(js.starts_with("(value) => {"), "{js}");
    });
}

#[test]
fn a_function_reading_a_key_one_variant_lacks_fails_at_its_line() {
    let profile = PROFILE.replace(
        "        write(H('FUEL'))\n",
        "        write(H('FUEL'), state.mixture_1)\n",
    );
    with_compiler(move |compiler| {
        let built = build(
            &tree(&[("aircraft/bksq-baronpro.yaml", &profile)]),
            "aircraft/bksq-baronpro.yaml",
            compiler,
        );
        assert!(built.bundle.is_none());
        let e = built.report.errors().next().expect("an error");
        assert_eq!(e.code, "TS2339", "{}", built.report);
        assert_eq!((e.at.line, e.at.column), (18, 32), "{}", built.report);
        assert!(e.message.ends_with("(on base)"), "{}", e.message);
    });
}

#[test]
fn a_wrong_pace_in_a_chain_fails_the_type_check() {
    let profile = PROFILE.replace("'2 frames'", "'2 frame'");
    with_compiler(move |compiler| {
        let built = build(
            &tree(&[("aircraft/bksq-baronpro.yaml", &profile)]),
            "aircraft/bksq-baronpro.yaml",
            compiler,
        );
        let e = built.report.errors().next().expect("an error");
        assert_eq!(e.code, "TS2345", "{}", built.report);
    });
}

/// A write function gets the JavaScript the sandbox runs, and nothing it lacks, which fails
/// the type check rather than the write (record/areas/profiles/log.md, 2026-10-24).
#[test]
fn a_write_function_types_what_the_sandbox_runs_and_nothing_it_lacks() {
    let profile = |body: &str| {
        format!(
            "aircraft:\n  variants:\n    a: x\nstate:\n  x:\n    name: X\n    watch: L('X')\n    write: |\n      (value) => {{\n        {body}\n      }}\n"
        )
    };
    let fine = [
        "write(L('X'), Math.round(value * 10) / 10)",
        "write(L('X'), [1, 2, 3].map((n) => n * value).reduce((a, b) => a + b, 0))",
        "write(L('X'), Number.parseFloat(value.toFixed(2)))",
        "if (`${value}`.padStart(3, '0').startsWith('00')) write(H('X'))",
        "for (const [i, n] of [4, 5].entries()) write(L('X'), i + n)",
        "write(L('X'), Object.keys({ a: 1 }).length + /x+/.exec('xx')!.length)",
        "write(K('KOHLSMAN_SET', 2, value))",
        "write(B('X_Toggle'))",
    ];
    let refused = [
        // A variable is set to a value, so one written with none fails here rather than at
        // every run (record/areas/profiles/01-format-and-delivery.md, "Write functions").
        "write(L('X'))",
        "write(A('X', 'Bool'))",
        "write(L('X'), Math.random())",
        "write(L('X'), Date.now())",
        "write(L('X'), JSON.parse('1'))",
        "write(L('X'), new Map([[1, 2]]).size)",
        "Promise.resolve(1)",
        "queueMicrotask(() => write(H('X')))",
        "const later = async () => write(H('X'))",
    ];
    let cases: Vec<(String, bool)> = fine
        .iter()
        .map(|b| (profile(b), true))
        .chain(refused.iter().map(|b| (profile(b), false)))
        .collect();
    with_compiler(move |compiler| {
        for (yaml, ok) in &cases {
            let built = build(&tree(&[("p.yaml", yaml)]), "p.yaml", compiler);
            assert_eq!(!built.report.has_errors(), *ok, "{yaml}\n{}", built.report);
            if !ok {
                assert!(
                    built.report.errors().all(|e| e.code.starts_with("TS")),
                    "only TypeScript should refuse it:\n{yaml}\n{}",
                    built.report
                );
            }
        }
    });
}
