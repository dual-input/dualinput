//! The profile engine: the profile format, its checker, its levels, and a bundle's bytes,
//! which the core, the builder, and the profile extension's language server all share, so a
//! profile CI publishes is one the core loads (record/areas/profiles/01-format-and-delivery.md,
//! record/areas/profiles/02-units.md).
//!
//! It reads no file: whoever runs it hands it the files' bytes, and it runs no TypeScript,
//! which `profile-build` does, so the core links this crate alone.
//!
//! An editor reads what it knows of the format from here rather than knowing it twice: a file's
//! tree with each node's place, in `tree`; the fields each place takes, with the names and words
//! each field takes, in `fields`; the top-level keys' order, in `LAYOUT`; and where a script's
//! text sits in the program TypeScript checks, through `Program`
//! (record/areas/profiles/03-the-extension.md).

mod blocks;
mod bundle;
mod check;
pub mod features;
mod format;
mod index;
mod levels;
mod names;
mod program;
mod report;
mod source;
pub mod tree;

pub use blocks::{Field, LAYOUT, Table, fields};
pub use bundle::{hash, plain, single_quoted};
pub use check::is_entry_key;
pub use format::{
    Aircraft, Count, EventEntry, Maturity, Owner, Pace, Profile, Resolved, StateEntry, Steps,
    Variant, Watch, Write,
};
pub use index::{Index, IndexBundle, IndexProfile, Shown, covers};
pub use levels::{Schema, declarations, schema};
pub use names::{Allowed, Arg, Call, Name, key_names, read_name};
pub use program::{Compiled, Program, ProgramFile, ProgramPlace, TypeError};
pub use report::{Diagnostic, Place, Report, Severity};
pub use source::{Files, Source, module_file, module_source, source};

use check::{File, Mode};

/// The highest level of the format this build reads. A release that adds a block, a field, a
/// name call, or a method on the chain raises it by 1, and levels only add, so a core runs
/// every bundle at its level and below (record/areas/profiles/01-format-and-delivery.md,
/// "Levels").
pub const LEVEL: u32 = 1;

/// The name a bundle's diagnostics carry as their file.
const BUNDLE: &str = "bundle.yaml";

/// Reads a bundle, checked against `level`'s fields, with no type check, since the builder ran
/// that on the bundle's source.
pub fn read(bundle: &[u8], level: u32) -> Result<Profile, Report> {
    let text = std::str::from_utf8(bundle).map_err(|_| {
        one(Diagnostic::error(
            Place::new(BUNDLE, 1, 1),
            "yaml",
            "A bundle is UTF-8 text",
        ))
    })?;
    let root = tree::parse(BUNDLE, text).map_err(|diagnostics| Report { diagnostics })?;
    let files = [File {
        root: &root,
        module: false,
    }];
    let (checked, report) = check::check(&files, level, Mode::Bundle);
    if report.has_errors() {
        return Err(report);
    }
    Ok(checked.profile)
}

fn one(d: Diagnostic) -> Report {
    Report {
        diagnostics: vec![d],
    }
}

fn checked(source: &Source, level: u32) -> (check::Checked, Report) {
    let files: Vec<File> = source
        .files
        .iter()
        .enumerate()
        .map(|(i, f)| File {
            root: &f.root,
            module: i > 0 || source.module,
        })
        .collect();
    check::check(&files, level, Mode::Source)
}

/// Every check but the type check, at `level`.
pub fn check(source: &Source, level: u32) -> Report {
    checked(source, level).1
}

/// The level's declarations, and every script, for TypeScript.
pub fn program(source: &Source, level: u32) -> Program {
    let (checked, _) = checked(source, level);
    program::program(&checked, &source.files[0].path, declarations(level), level)
}

/// TypeScript's errors, at the YAML's lines and columns.
pub fn place(program: &Program, found: &[TypeError]) -> Report {
    program::place(program, found)
}

/// The bundle's bytes, with each write function's compiled JavaScript in place of its source.
pub fn write(source: &Source, compiled: &Compiled) -> Vec<u8> {
    let (checked, _) = checked(source, LEVEL);
    bundle::emit(&program::with_compiled(&checked, compiled))
}
