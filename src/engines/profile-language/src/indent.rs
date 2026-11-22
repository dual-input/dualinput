//! Indentation as you type, from the formatter's rules: a new line goes where the formatter would
//! put it (record/areas/profiles/03-the-extension.md, "Formatting"). Under a key that holds a map
//! or a list, as `state:` or an entry's key, it goes 2 deeper; under a field with a value, at the
//! field's; and after `write: |`, 2 deeper than `write:`. Inside a script, it keeps the indent of
//! the line above, and goes 2 deeper after a line that ends in `{`, `(`, or `=>`, and a `}` typed
//! at a line's start moves it back 2.

use crate::outline::{self, Head, Outline, indent_of, is_blank, is_block_header, is_comment};

/// The indentation, in spaces, that the line `line`, from 1, takes when Enter has just started
/// it, from the nearest line above it that isn't blank; none at the file's first line.
pub fn indent_after(text: &str, line: usize) -> Option<usize> {
    let o = outline::parse(text);
    let above = above(&o, line.checked_sub(1)?)?;
    Some(rule(&o, above))
}

/// The indentation the line `line`, from 1, takes once a `}` typed at its start closes a script's
/// block, or none for a line that isn't one.
pub fn indent_closing(text: &str, line: usize) -> Option<usize> {
    let o = outline::parse(text);
    let at = line.checked_sub(1)?;
    if !o.line(at).trim_start().starts_with('}') {
        return None;
    }
    let above = above(&o, at)?;
    let (_, block) = script_line(&o, above)?;
    let least = block.indent.unwrap_or(0);
    Some(rule(&o, above).saturating_sub(2).max(least))
}

/// The nearest line above `at`, from 0, that isn't blank.
fn above(o: &Outline, at: usize) -> Option<usize> {
    (0..at).rev().find(|&l| !is_blank(o.line(l)))
}

/// The block whose text holds `line`, if it's a line of a script's or any block's text.
fn script_line<'o>(o: &'o Outline, line: usize) -> Option<(&'o outline::Item, &'o outline::Block)> {
    o.block_at(line)
        .filter(|(_, b)| b.lines.first().is_some_and(|&first| first <= line))
}

/// The indentation of the line after `above`, from 0.
fn rule(o: &Outline, above: usize) -> usize {
    let text = o.line(above);
    let indent = indent_of(text);
    if script_line(o, above).is_some() {
        let end = text.trim_end();
        let opens = end.ends_with('{') || end.ends_with('(') || end.ends_with("=>");
        return if opens { indent + 2 } else { indent };
    }
    if is_comment(text) {
        return indent;
    }
    match outline::head(text, indent).0 {
        Head::Key { value: None, .. } | Head::Dash { value: None } => indent + 2,
        Head::Key { value: Some(v), .. } | Head::Dash { value: Some(v) }
            if is_block_header(&v.raw) =>
        {
            indent + 2
        }
        _ => indent,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROFILE: &str = "state:\n  mixture_1:\n    name: Left mixture\n    write: |\n      (value) => {\n        write(L('X'), value)\n";

    #[test]
    fn enter_indents_as_the_formatter_writes() {
        assert_eq!(indent_after(PROFILE, 2), Some(2));
        assert_eq!(indent_after(PROFILE, 3), Some(4));
        assert_eq!(indent_after(PROFILE, 4), Some(4));
        assert_eq!(indent_after(PROFILE, 5), Some(6));
        assert_eq!(indent_after(PROFILE, 6), Some(8));
        assert_eq!(indent_after(PROFILE, 7), Some(8));
    }

    #[test]
    fn a_closing_brace_moves_back_2() {
        let text = format!("{PROFILE}        }}\n");
        assert_eq!(indent_closing(&text, 7), Some(6));
        assert_eq!(indent_closing(PROFILE, 3), None);
    }
}
