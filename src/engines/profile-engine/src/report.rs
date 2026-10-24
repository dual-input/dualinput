//! What a check found: errors, which stop a profile loading and stop CI publishing it, and
//! warnings, which are advice and block nothing, each at a file, line, and column, with a code,
//! so the builder, CI, and the IDE point at the same place (record/areas/profiles/02-units.md,
//! "The profile engine").

use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Place {
    /// The file's path from `profiles/`, as `aircraft/bksq-baronpro.yaml`.
    pub file: String,
    /// From 1.
    pub line: usize,
    /// From 1, in characters.
    pub column: usize,
}

impl Place {
    pub fn new(file: &str, line: usize, column: usize) -> Place {
        Place {
            file: file.to_string(),
            line,
            column,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub severity: Severity,
    pub at: Place,
    /// A short name for the kind of mistake, such as `name-kind`, or TypeScript's own, such as
    /// `TS2339`.
    pub code: String,
    pub message: String,
}

impl Diagnostic {
    pub fn error(at: Place, code: &str, message: impl Into<String>) -> Diagnostic {
        Diagnostic {
            severity: Severity::Error,
            at,
            code: code.to_string(),
            message: message.into(),
        }
    }

    pub fn warning(at: Place, code: &str, message: impl Into<String>) -> Diagnostic {
        Diagnostic {
            severity: Severity::Warning,
            ..Diagnostic::error(at, code, message)
        }
    }
}

impl fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let severity = match self.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
        };
        write!(
            f,
            "{}:{}:{}: {severity} {}: {}",
            self.at.file, self.at.line, self.at.column, self.code, self.message
        )
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Report {
    pub diagnostics: Vec<Diagnostic>,
}

impl Report {
    pub fn push(&mut self, diagnostic: Diagnostic) {
        self.diagnostics.push(diagnostic);
    }

    pub fn has_errors(&self) -> bool {
        self.diagnostics
            .iter()
            .any(|d| d.severity == Severity::Error)
    }

    pub fn errors(&self) -> impl Iterator<Item = &Diagnostic> {
        self.diagnostics
            .iter()
            .filter(|d| d.severity == Severity::Error)
    }

    pub fn extend(&mut self, other: Report) {
        self.diagnostics.extend(other.diagnostics);
    }

    /// Orders the diagnostics by file, line, and column, so a report reads top to bottom.
    pub fn sort(&mut self) {
        self.diagnostics.sort_by(|a, b| a.at.cmp(&b.at));
    }
}

impl fmt::Display for Report {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for d in &self.diagnostics {
            writeln!(f, "{d}")?;
        }
        Ok(())
    }
}
