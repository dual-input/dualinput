//! The TypeScript program the builder checks a profile's write functions with: the level's
//! declarations, and for each variant one file that declares `state` with that variant's
//! entries and wraps each write function in a constant of its type, so a function that reads
//! a key its variant lacks fails (record/areas/profiles/02-units.md, "The profile engine").
//!
//! profile-build's driver.js finds the scripts as the values of a file's top-level constants,
//! the only declarations here with a value, to refuse a script that declares a name Dual Input
//! gives every script, so change both together.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::check::Checked;
use crate::format::{Profile, Watch};
use crate::names::Name;
use crate::report::{Diagnostic, Place, Report};

pub struct Program {
    /// The level's declarations, the scripts' whole world, since TypeScript checks with `noLib`.
    pub declarations: ProgramFile,
    /// One file for each variant, or one for a module read on its own, which has none.
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

    /// Where a place in the YAML that's inside a script sits in the program: in each file that
    /// holds the script, which is every variant's the script applies to, in the variants' order.
    /// A place on a script's line before its text, as on `write:`, sits in none.
    pub fn to_program(&self, at: &Place) -> Vec<ProgramPlace> {
        self.spots
            .iter()
            .filter(|s| {
                s.at.file == at.file
                    && at.line >= s.at.line
                    && at.line < s.at.line + s.lines
                    && (s.block || at.line > s.at.line || at.column >= s.at.column)
            })
            .map(|s| {
                let column = if s.block || at.line == s.at.line {
                    at.column.saturating_sub(s.at.column)
                } else {
                    at.column.saturating_sub(1)
                };
                ProgramPlace {
                    file: s.file.clone(),
                    line: s.first + (at.line - s.at.line),
                    column,
                }
            })
            .collect()
    }

    /// Where a place in one of the program's files sits in the YAML, if it's inside a script.
    pub fn to_yaml(&self, at: &ProgramPlace) -> Option<Place> {
        self.spot(&at.file, at.line).map(|s| yaml(s, at))
    }

    /// The script that holds a line of a program file.
    fn spot(&self, file: &str, line: usize) -> Option<&Spot> {
        self.spots
            .iter()
            .find(|s| s.file == file && line >= s.first && line < s.first + s.lines)
    }
}

/// A place in one of the program's files, as TypeScript counts it: the file's name, and its line
/// and column from 0.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProgramPlace {
    pub file: String,
    pub line: usize,
    pub column: usize,
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

/// One of TypeScript's diagnostics, in the program's files, lines and columns from 0, or the
/// builder's own on a script.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TypeError {
    pub file: String,
    pub line: usize,
    pub column: usize,
    /// The code the report gives it: TypeScript's, as `TS2339`, or the builder's, as
    /// `reserved-name`.
    pub code: String,
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
    // A module read on its own has no variants, so its one file declares every entry.
    let variants: Vec<Option<&str>> = if p.aircraft.variants.is_empty() {
        vec![None]
    } else {
        p.aircraft
            .variants
            .iter()
            .map(|v| Some(v.id.as_str()))
            .collect()
    };
    let mut files = Vec::new();
    let mut spots = Vec::new();
    for variant in variants {
        let name = format!("{}.ts", variant.unwrap_or("module"));
        let applies = |only: &[String]| {
            only.is_empty() || variant.is_none_or(|id| only.iter().any(|o| o == id))
        };
        // A file with an export is a module, so each variant's state and constants stay in
        // its own file. Each key's doc comment is its entry's name, which TypeScript's
        // completion and hovers show beside the key.
        let mut text = String::from("export {};\ndeclare const state: {\n");
        for e in p.state.iter().filter(|e| applies(&e.only)) {
            text.push_str(&format!("  /** {} */\n", doc(&e.name)));
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
                variant: variant.unwrap_or_default().to_string(),
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

/// A name as a doc comment's text, with a `*/` in it written `*\/`, so it can't end the comment,
/// which Markdown, as an editor shows the comment, reads as `*/`.
fn doc(name: &str) -> String {
    name.replace("*/", "*\\/")
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

/// A place inside `spot`'s script in the YAML. A block's lines start at its indentation, which
/// the program leaves out, as does the first line of any other script.
fn yaml(spot: &Spot, at: &ProgramPlace) -> Place {
    let line = spot.at.line + (at.line - spot.first);
    let column = if spot.block || at.line == spot.first {
        spot.at.column + at.column
    } else {
        at.column + 1
    };
    Place::new(&spot.at.file, line, column)
}

/// TypeScript's errors at the YAML's lines and columns. An error every variant shares shows
/// once, naming the variants only when the profile has several. A reserved name is refused on
/// every variant alike, since it turns on no variant's entries, so its error names none.
pub(crate) fn place(program: &Program, found: &[TypeError]) -> Report {
    let mut grouped: BTreeMap<(Place, String, String), Vec<String>> = BTreeMap::new();
    for e in found {
        let at = ProgramPlace {
            file: e.file.clone(),
            line: e.line,
            column: e.column,
        };
        let (at, variant) = match program.spot(&e.file, e.line) {
            Some(s) => (yaml(s, &at), s.variant.clone()),
            None => (
                Place::new(&program.profile_file, 1, 1),
                e.file.trim_end_matches(".ts").to_string(),
            ),
        };
        grouped
            .entry((at, e.code.clone(), e.message.clone()))
            .or_default()
            .push(variant);
    }
    let mut report = Report::default();
    for ((at, code, message), mut variants) in grouped {
        variants.sort();
        variants.dedup();
        let message = if program.many_variants && code.starts_with("TS") {
            format!("{message} (on {})", variants.join(", "))
        } else {
            message
        };
        report.push(Diagnostic::error(at, &code, message));
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
