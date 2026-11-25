//! The profile language: the editor's features over the profile engine, which the profile
//! extension's language server, `dualinput-profile-builder serve`, answers an editor with
//! (record/areas/profiles/03-the-extension.md, "How it works"). It holds the formatter and
//! indentation as you type, the outline, completion and snippets, hovers, navigation across a
//! profile and its modules, and the quick fixes.
//!
//! It's pure: it takes text and returns results, reads no file, and runs no TypeScript, so
//! `cargo test` covers it whole. The server hands it the open editors' texts and the files on
//! disk, and asks TypeScript itself about a place inside a script, which `in_script` tells it.
//!
//! Every place it takes and gives is a `Pos`: a line and a column from 1, the column counted in
//! characters, as the engine's `Place` counts them. The server turns each into the protocol's
//! lines from 0 and columns in UTF-16 code units, and back.
//!
//! It reads a file's lines as an outline of its own rather than through the engine's tree, since
//! the tree holds no comments and an editor asks about a file mid-edit, when it may not parse.
//! The formatter checks what it writes against the engine's tree, so the outline can't change
//! what a profile means.

mod comments;
mod complete;
mod fixes;
mod format;
mod hover;
mod indent;
mod navigate;
mod outline;
mod script;
mod symbols;

pub use complete::{Completion, CompletionKind, Context, complete, in_script};
pub use fixes::{Fix, fix};
pub use format::{Unformatted, edit_between, format};
pub use hover::hover;
pub use indent::{indent_after, indent_closing};
pub use navigate::{
    EntrySymbol, Location, Workspace, closure, definition, imports, prepare_rename, programs,
    references, rename, workspace_symbols,
};
pub use symbols::{Fold, Symbol, SymbolKind, folds, symbols};

/// A place in a file: a line and a column from 1, the column in characters, as the engine's
/// `Place` counts them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Pos {
    pub line: usize,
    pub column: usize,
}

impl Pos {
    pub fn new(line: usize, column: usize) -> Pos {
        Pos { line, column }
    }
}

/// The text from `start` up to `end`, which it leaves out.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Range {
    pub start: Pos,
    pub end: Pos,
}

impl Range {
    pub fn new(start: Pos, end: Pos) -> Range {
        Range { start, end }
    }

    pub fn contains(&self, at: Pos) -> bool {
        self.start <= at && at <= self.end
    }
}

/// A change to a file: the text that replaces `range`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Edit {
    pub range: Range,
    pub text: String,
}
