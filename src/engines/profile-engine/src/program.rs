//! The TypeScript program the builder checks a profile's write functions with: the level's
//! declarations, and for each variant one file that declares `state` with that variant's
//! entries and wraps each write function in a constant of its type, so a function that reads
//! a key its variant lacks fails (record/areas/profiles/02-units.md, "The profile engine").

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::check::Checked;
use crate::format::{Profile, Watch};
use crate::names::Name;
use crate::report::{Diagnostic, Place, Report};

pub struct Program {
    /// The level's declarations, the scripts' whole world, since TypeScript checks with `noLib`.
    pub declarations: ProgramFile,
    /// One file for each variant.
    pub files: Vec<ProgramFile>,
    /// Each write function's source, in the order `Compiled` hands them back.
    pub scripts: Vec<String>,
    /// Where each script's text starts in the YAML.
    places: Vec<Place>,
    spots: Vec<Spot>,
    profile_file: String,
    many_variants: bool,
}

impl Program {
    /// Where a script's text starts in the YAML, for an error the builder finds in it after
    /// TypeScript, such as syntax QuickJS-ng can't parse.
    pub fn script_place(&self, index: usize) -> Option<&Place> {
        self.places.get(index)
    }
}

#[derive(Clone, Debug)]
pub struct ProgramFile {
    pub name: String,
    pub text: String,
}

/// Where one script sits in a variant's file, and where its text starts in the YAML.
struct Spot {
    file: String,
    variant: String,
    /// Its first line in the file, from 0.
    first: usize,
    lines: usize,
    at: Place,
    block: bool,
}

/// One of TypeScript's diagnostics, in the program's files, lines and columns from 0.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TypeError {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub code: u32,
    pub message: String,
}

/// Each write function compiled to JavaScript, in the order of `Program::scripts`.
#[derive(Clone, Debug, Default)]
pub struct Compiled {
    pub scripts: Vec<String>,
}

pub(crate) fn program(
    checked: &Checked,
    profile_file: &str,
    declarations: String,
    level: u32,
) -> Program {
    let p = &checked.profile;
    let mut files = Vec::new();
    let mut spots = Vec::new();
    for variant in &p.aircraft.variants {
        let name = format!("{}.ts", variant.id);
        let applies = |only: &[String]| only.is_empty() || only.contains(&variant.id);
        // A file with an export is a module, so each variant's state and constants stay in
        // its own file.
        let mut text = String::from("export {};\ndeclare const state: {\n");
        for e in p.state.iter().filter(|e| applies(&e.only)) {
            text.push_str(&format!(
                "  readonly {}: {};\n",
                e.key,
                value_type(&e.watch)
            ));
        }
        text.push_str("};\n");
        for script in &checked.scripts {
            let (key, only, param) = if script.event {
                let e = &p.events[script.entry];
                (&e.key, &e.only, "(value?: number) => void".to_string())
            } else {
                // A state entry's function may return the value its entry will read once the
                // write lands, which the sync engine waits for in place of the one it gave. One
                // written `(value) => write(...)` returns write()'s chain, which the engine takes
                // as no value, and without `Chain` here TypeScript refuses that form.
                let e = &p.state[script.entry];
                let t = value_type(&e.watch);
                (
                    &e.key,
                    &e.only,
                    format!("(value: {t}) => {t} | Chain | void"),
                )
            };
            if !applies(only) {
                continue;
            }
            text.push_str(&format!("const write_{key}: {param} = (\n"));
            let first = text.lines().count();
            let body = script.text.text.trim_end_matches('\n');
            text.push_str(body);
            text.push_str("\n);\n");
            spots.push(Spot {
                file: name.clone(),
                variant: variant.id.clone(),
                first,
                lines: body.split('\n').count(),
                at: script.text.content.clone(),
                block: script.text.block,
            });
        }
        files.push(ProgramFile { name, text });
    }
    Program {
        declarations: ProgramFile {
            name: format!("level-{level}.d.ts"),
            text: declarations,
        },
        files,
        scripts: checked
            .scripts
            .iter()
            .map(|s| s.text.text.clone())
            .collect(),
        places: checked
            .scripts
            .iter()
            .map(|s| s.text.content.clone())
            .collect(),
        spots,
        profile_file: profile_file.to_string(),
        many_variants: p.aircraft.variants.len() > 1,
    }
}

/// The type a state entry's value has in `state`, from what it watches.
fn value_type(watch: &Watch) -> &'static str {
    match watch {
        Watch::Name(Name::L { unit: Some(u), .. } | Name::A { unit: u, .. })
            if u.eq_ignore_ascii_case("string") =>
        {
            "string"
        }
        Watch::Name(Name::Instrument { text: true, .. }) => "string",
        _ => "number",
    }
}

/// TypeScript's errors at the YAML's lines and columns. An error every variant shares shows
/// once, naming the variants only when the profile has several.
pub(crate) fn place(program: &Program, found: &[TypeError]) -> Report {
    let mut grouped: BTreeMap<(Place, u32, String), Vec<String>> = BTreeMap::new();
    for e in found {
        let spot = program
            .spots
            .iter()
            .find(|s| s.file == e.file && e.line >= s.first && e.line < s.first + s.lines);
        let (at, variant) = match spot {
            Some(s) => {
                let line = s.at.line + (e.line - s.first);
                let column = if s.block || e.line == s.first {
                    s.at.column + e.column
                } else {
                    e.column + 1
                };
                (Place::new(&s.at.file, line, column), s.variant.clone())
            }
            None => (
                Place::new(&program.profile_file, 1, 1),
                e.file.trim_end_matches(".ts").to_string(),
            ),
        };
        grouped
            .entry((at, e.code, e.message.clone()))
            .or_default()
            .push(variant);
    }
    let mut report = Report::default();
    for ((at, code, message), mut variants) in grouped {
        variants.sort();
        variants.dedup();
        let message = if program.many_variants {
            format!("{message} (on {})", variants.join(", "))
        } else {
            message
        };
        report.push(Diagnostic::error(at, &format!("TS{code}"), message));
    }
    report.sort();
    report
}

/// The profile with each write function's compiled JavaScript in place of its source.
pub(crate) fn with_compiled(checked: &Checked, compiled: &Compiled) -> Profile {
    let mut profile = checked.profile.clone();
    for (script, js) in checked.scripts.iter().zip(&compiled.scripts) {
        let write = if script.event {
            &mut profile.events[script.entry].write
        } else {
            &mut profile.state[script.entry].write
        };
        *write = crate::format::Write::Function(js.clone());
    }
    profile
}
