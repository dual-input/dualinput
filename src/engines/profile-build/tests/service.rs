//! The language service's own tests: completion, a hover, and signature help inside a small
//! profile's scripts, each asked at a place in the YAML that the program maps
//! (record/areas/profiles/03-the-extension.md, "TypeScript in two runtimes").

// Tests run off the core's loop, so they may start the thread the service needs, which the
// root's clippy.toml forbids only the loop.
#![allow(clippy::disallowed_methods)]

use std::collections::BTreeMap;

use profile_build::{STACK, Service};
use profile_engine::{Files, LEVEL, Place, Program, ProgramPlace, program, source};

struct Tree(BTreeMap<String, String>);

impl Files for Tree {
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        self.0.get(path).map(|t| t.clone().into_bytes())
    }
}

/// A profile whose one script's line 17 holds `line`, at column 9.
fn profile(line: &str) -> String {
    format!(
        "maker: M\nname: A\nmaturity: stable\naircraft:\n  variants:\n    a: x\nstate:\n  battery_1:\n    name: Battery 1\n    watch: L('BATTERY_1')\n    write: L('BATTERY_1')\n  fuel_pump:\n    name: Fuel pump\n    watch: L('FUEL_PUMP')\n    write: |\n      (value) => {{\n        {line}\n      }}\n"
    )
}

fn program_of(yaml: &str) -> Program {
    let files = Tree(BTreeMap::from([("p.yaml".to_string(), yaml.to_string())]));
    program(&source(&files, "p.yaml").expect("loads"), LEVEL)
}

/// The program's place for column `column` of the script's line 17.
fn at(p: &Program, column: usize) -> ProgramPlace {
    p.to_program(&Place::new("p.yaml", 17, column))
        .into_iter()
        .next()
        .expect("the place is in the script")
}

/// Runs `f` with a service, on a thread with the stack it needs.
fn with_service(f: impl FnOnce(&mut Service) + Send + 'static) {
    std::thread::Builder::new()
        .stack_size(STACK)
        .spawn(move || f(&mut Service::new()))
        .expect("a thread should start")
        .join()
        .expect("the test's thread should end without a panic");
}

#[test]
fn completion_after_state_lists_its_keys_with_each_entrys_name() {
    with_service(|service| {
        let p = program_of(&profile("state."));
        service.set_program(&p).expect("the program loads");
        let here = at(&p, 15);
        let found = service.completions(&here).expect("completions");
        let labels: Vec<&str> = found.iter().map(|c| c.label.as_str()).collect();
        assert_eq!(labels, ["battery_1", "fuel_pump"], "{found:?}");
        assert_eq!(found[0].kind, "property");
        let details = service
            .completion_details(&here, "battery_1")
            .expect("details")
            .expect("TypeScript has the key");
        assert_eq!(details.documentation, "Battery 1");
        assert!(details.detail.contains("battery_1: number"), "{details:?}");
    });
}

#[test]
fn a_hover_on_write_and_signature_help_after_its_parenthesis() {
    with_service(|service| {
        let p = program_of(&profile("write(L('FUEL_PUMP'), value)"));
        service.set_program(&p).expect("the program loads");
        let hover = service
            .quick_info(&at(&p, 10))
            .expect("a hover")
            .expect("something to show");
        assert!(hover.display.starts_with("function write("), "{hover:?}");
        assert!(
            hover.documentation.contains("Hands the engine one action"),
            "{hover:?}"
        );

        let p = program_of(&profile("write("));
        service.set_program(&p).expect("the program loads");
        let help = service
            .signature_help(&at(&p, 15))
            .expect("signature help")
            .expect("a call");
        assert_eq!(help.signatures.len(), 3, "{help:?}");
        assert_eq!(help.active_parameter, 0);
        let first = &help.signatures[help.active_signature];
        assert!(first.label.starts_with("write("), "{first:?}");
        assert!(
            first.label.contains(&first.parameters[0].label),
            "{first:?}"
        );
    });
}
