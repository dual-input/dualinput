//! Quick fixes for the errors that already show their fix
//! (record/areas/profiles/03-the-extension.md, "Checks"): `map-form`'s bracketed map written out
//! on its own lines, and `quotes`' double-quoted text in single quotes, each as the error's
//! message writes it.

use profile_engine::{read_name, single_quoted, tree};

use crate::outline::{self, Head, Token, indent_of, unquote};
use crate::{Edit, Pos, Range};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fix {
    pub title: String,
    pub edits: Vec<Edit>,
}

/// The fix for the error `code` at `at`, if it's one this gives.
pub fn fix(text: &str, code: &str, at: Pos) -> Option<Fix> {
    let l = at.line.checked_sub(1)?;
    let line = text.split('\n').nth(l)?;
    let line = line.strip_suffix('\r').unwrap_or(line);
    match code {
        "map-form" => map_form(line, l, at.column),
        "quotes" => quotes(line, l, at.column.checked_sub(1)?),
        _ => None,
    }
}

/// A key's bracketed map, `key: {a: 1, b: 2}`, written out on its own lines below the key.
fn map_form(line: &str, l: usize, column: usize) -> Option<Fix> {
    let indent = indent_of(line);
    let (head, comment) = outline::head(line, indent);
    let Head::Key {
        key,
        value: Some(value),
    } = head
    else {
        return None;
    };
    if value.column + 1 != column || !value.raw.starts_with('{') {
        return None;
    }
    let comment = comment
        .map(|c| format!("{}{}", c.gap, c.text))
        .unwrap_or_default();
    let mut lines = vec![format!("{}{}:{comment}", " ".repeat(indent), key.raw)];
    written_out(&value.raw, indent + 2, &mut lines)?;
    Some(Fix {
        title: "Write the map out on its own lines".into(),
        edits: vec![Edit {
            range: whole_line(line, l),
            text: lines.join("\n"),
        }],
    })
}

/// A bracketed map's entries at `indent`, a line each, an entry's own bracketed map written out
/// below it in turn.
fn written_out(map: &str, indent: usize, lines: &mut Vec<String>) -> Option<()> {
    let pad = " ".repeat(indent);
    for entry in tree::bracketed_entries(map, 1)? {
        match outline::head(&entry, 0).0 {
            Head::Key {
                key,
                value: Some(v),
            } if v.raw.starts_with('{') => {
                lines.push(format!("{pad}{}:", key.raw));
                written_out(&v.raw, indent + 2, lines)?;
            }
            _ => lines.push(format!("{pad}{entry}")),
        }
    }
    Some(())
}

/// The text in double quotes at `column`, from 0, in single quotes: a key or a value the quote
/// starts, or a name in a value written plain.
fn quotes(line: &str, l: usize, column: usize) -> Option<Fix> {
    let indent = indent_of(line);
    let (head, _) = outline::head(line, indent);
    let tokens: Vec<Token> = match head {
        Head::Key { key, value } => std::iter::once(key).chain(value).collect(),
        Head::Dash { value } => value.into_iter().collect(),
        Head::Text(_) => Vec::new(),
    };
    let token = tokens
        .into_iter()
        .find(|t| column >= t.column && column < t.column + t.raw.chars().count())?;
    let written = if token.column == column && token.raw.starts_with('"') {
        let text = unquote(&token.raw)?;
        if text.contains(['\n', '\r']) {
            return None;
        }
        single_quoted(&text)
    } else {
        read_name(&token.raw)?.to_string()
    };
    Some(Fix {
        title: format!("Write it in single quotes, as {written}"),
        edits: vec![Edit {
            range: token.range(l),
            text: written,
        }],
    })
}

fn whole_line(line: &str, l: usize) -> Range {
    Range::new(
        Pos::new(l + 1, 1),
        Pos::new(l + 1, line.chars().count() + 1),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn applied(text: &str, fix: &Fix) -> String {
        let edit = &fix.edits[0];
        let lines: Vec<&str> = text.split('\n').collect();
        let line = lines[edit.range.start.line - 1];
        let chars: Vec<char> = line.chars().collect();
        let head: String = chars[..edit.range.start.column - 1].iter().collect();
        let tail: String = chars[edit.range.end.column - 1..].iter().collect();
        format!("{head}{}{tail}", edit.text)
    }

    #[test]
    fn a_bracketed_map_is_written_out() {
        let text = "    write: {toggle: K('BUS', 2, 6)}  # bus";
        let found = fix(text, "map-form", Pos::new(1, 12)).expect("a fix");
        assert_eq!(
            applied(text, &found),
            "    write:  # bus\n      toggle: K('BUS', 2, 6)"
        );
    }

    #[test]
    fn double_quotes_go_single() {
        let text = "    name: \"Radio: COM1\"";
        let found = fix(text, "quotes", Pos::new(1, 11)).expect("a fix");
        assert_eq!(applied(text, &found), "    name: 'Radio: COM1'");
        let text = "    watch: L(\"it's\")";
        let found = fix(text, "quotes", Pos::new(1, 14)).expect("a fix");
        assert_eq!(applied(text, &found), "    watch: L('it\\'s')");
    }
}
