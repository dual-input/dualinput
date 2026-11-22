//! Between the protocol's places and URIs and the profile language's places and paths. The
//! Language Server Protocol counts lines from 0 and a line's characters in UTF-16 code units, as
//! VS Code's strings do, and the profile language counts both from 1, the column in characters,
//! as the engine's `Place` does.

use std::path::{Path, PathBuf};

use lsp_types::Position;
use profile_language::{Pos, Range};

/// A text's lines, for turning places in it one way and the other.
pub(crate) struct Lines<'t> {
    lines: Vec<&'t str>,
}

impl<'t> Lines<'t> {
    pub(crate) fn new(text: &'t str) -> Lines<'t> {
        Lines {
            lines: text
                .split('\n')
                .map(|l| l.strip_suffix('\r').unwrap_or(l))
                .collect(),
        }
    }

    fn line(&self, line: usize) -> &'t str {
        self.lines.get(line).copied().unwrap_or("")
    }

    pub(crate) fn lsp(&self, at: Pos) -> Position {
        let line = at.line.saturating_sub(1);
        let units: usize = self
            .line(line)
            .chars()
            .take(at.column.saturating_sub(1))
            .map(char::len_utf16)
            .sum();
        Position::new(line as u32, units as u32)
    }

    pub(crate) fn pos(&self, at: Position) -> Pos {
        let line = at.line as usize;
        let mut units = 0;
        let mut chars = 0;
        for c in self.line(line).chars() {
            if units >= at.character as usize {
                break;
            }
            units += c.len_utf16();
            chars += 1;
        }
        Pos::new(line + 1, chars + 1)
    }

    pub(crate) fn range(&self, range: Range) -> lsp_types::Range {
        lsp_types::Range::new(self.lsp(range.start), self.lsp(range.end))
    }

    /// The range a diagnostic at `at` underlines: from it to the next space, or its line's end.
    pub(crate) fn token(&self, at: Pos) -> lsp_types::Range {
        let text: Vec<char> = self.line(at.line.saturating_sub(1)).chars().collect();
        let start = at.column.saturating_sub(1).min(text.len());
        let length = text[start..]
            .iter()
            .take_while(|c| !c.is_whitespace())
            .count();
        let end = Pos::new(
            at.line,
            start + length.max(usize::from(start < text.len())) + 1,
        );
        lsp_types::Range::new(self.lsp(at), self.lsp(end))
    }

    /// The range from a line's start to the end of its indentation.
    pub(crate) fn indentation(&self, line: usize) -> lsp_types::Range {
        let text = self.line(line);
        let spaces = text.len() - text.trim_start_matches([' ', '\t']).len();
        lsp_types::Range::new(
            Position::new(line as u32, 0),
            Position::new(line as u32, spaces as u32),
        )
    }
}

/// The file a `file:` URI names, as VS Code writes one, `file:///c%3A/Users/...`, its drive letter
/// in lowercase, so each file has one path however its URI was written.
pub(crate) fn path_of(uri: &str) -> Option<PathBuf> {
    let rest = uri.strip_prefix("file://")?;
    let decoded = percent_decoded(rest)?;
    let path = match decoded.strip_prefix('/') {
        Some(p) if p.as_bytes().get(1) == Some(&b':') => p.replace('/', "\\"),
        Some(_) if cfg!(windows) => decoded.replace('/', "\\"),
        Some(_) => decoded,
        None if cfg!(windows) => format!("\\\\{}", decoded.replace('/', "\\")),
        None => return None,
    };
    Some(PathBuf::from(lower_drive(&path)))
}

/// A file's `file:` URI, as VS Code writes one: its drive letter in lowercase, and every byte but
/// a letter, a digit, `-`, `.`, `_`, `~`, and `/` percent-encoded.
pub(crate) fn uri_of(path: &Path) -> String {
    let text = lower_drive(&path.to_string_lossy()).replace('\\', "/");
    let mut out = String::from("file://");
    let rest = match text.as_bytes().get(1) {
        Some(b':') => {
            out.push('/');
            out.push_str(&text[..1]);
            out.push_str("%3A");
            &text[2..]
        }
        _ => text.as_str(),
    };
    for b in rest.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~/".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn lower_drive(path: &str) -> String {
    let mut chars: Vec<char> = path.chars().collect();
    if chars.len() >= 2 && chars[1] == ':' {
        chars[0] = chars[0].to_ascii_lowercase();
    }
    chars.into_iter().collect()
}

fn percent_decoded(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_uri_and_its_path_go_both_ways() {
        let path =
            path_of("file:///c%3A/Users/Some%20One/profiles/aircraft/x.yaml").expect("a path");
        assert_eq!(
            path,
            PathBuf::from("c:\\Users\\Some One\\profiles\\aircraft\\x.yaml")
        );
        assert_eq!(
            uri_of(&PathBuf::from("C:\\Users\\Some One\\x.yaml")),
            "file:///c%3A/Users/Some%20One/x.yaml"
        );
        assert_eq!(
            path_of("file:///C:/a/b.yaml"),
            Some(PathBuf::from("c:\\a\\b.yaml"))
        );
    }

    #[test]
    fn a_column_counts_characters_one_way_and_utf16_units_the_other() {
        let lines = Lines::new("# ═══ 𝄞 A\r\nb");
        let at = lines.lsp(Pos::new(1, 9));
        assert_eq!((at.line, at.character), (0, 9));
        assert_eq!(lines.pos(Position::new(0, 9)), Pos::new(1, 9));
        assert_eq!(lines.pos(Position::new(1, 1)), Pos::new(2, 2));
    }
}
