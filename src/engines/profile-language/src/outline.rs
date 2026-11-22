//! A file's lines as an outline: each key and each list item, with the comment lines above it,
//! what it holds below it, and a block's lines, which every feature of the language reads.
//!
//! It reads the narrow part of YAML a profile uses, by indentation, and any text at all, since an
//! editor asks about a file mid-edit. A line it can't read as a key or a list item is an item of
//! its own, `Head::Text`, so a key half typed still sits where its indentation puts it.

use crate::{Pos, Range};

pub(crate) struct Outline<'t> {
    /// Each line, without its line break or a `\r` before it. A text that ends in a line break
    /// has an empty last line.
    pub(crate) lines: Vec<&'t str>,
    pub(crate) items: Vec<Item>,
    /// The comment lines after the last top-level item.
    pub(crate) trailing: Vec<usize>,
}

#[derive(Clone, Debug)]
pub(crate) struct Item {
    /// The comment and blank lines above it, from the line after the item before.
    pub(crate) above: Vec<usize>,
    /// Its head's line, from 0.
    pub(crate) line: usize,
    pub(crate) indent: usize,
    pub(crate) head: Head,
    /// A comment after its value, or after its key when it has none.
    pub(crate) comment: Option<Comment>,
    pub(crate) children: Vec<Item>,
    /// The comment lines after its last child, at its children's indentation or deeper.
    pub(crate) trailing: Vec<usize>,
    pub(crate) block: Option<Block>,
    /// The lines a value written over several lines goes on with, such as a quoted text broken
    /// across lines.
    pub(crate) more: Vec<usize>,
}

#[derive(Clone, Debug)]
pub(crate) enum Head {
    /// `key: value`, or `key:` with what it holds on the lines below.
    Key { key: Token, value: Option<Token> },
    /// `- value`, or `-` alone with what it holds below.
    Dash { value: Option<Token> },
    /// A line that's neither, such as a key half typed, with its text after its indentation.
    Text(String),
}

/// A key or a value as its line writes it.
#[derive(Clone, Debug)]
pub(crate) struct Token {
    pub(crate) raw: String,
    /// Its first character's column in its line, from 0, in characters.
    pub(crate) column: usize,
}

/// A comment after a value: the space before its `#`, and the comment from its `#`.
#[derive(Clone, Debug)]
pub(crate) struct Comment {
    pub(crate) gap: String,
    pub(crate) text: String,
}

/// A `|` or `>` block's lines.
#[derive(Clone, Debug)]
pub(crate) struct Block {
    pub(crate) header: String,
    /// Its lines, blank ones among them, without the blank lines after its last, which YAML
    /// drops, unless its header keeps them with `+`.
    pub(crate) lines: Vec<usize>,
    /// The indentation its text starts at, which every line of it strips, or none for a block
    /// with no text.
    pub(crate) indent: Option<usize>,
}

impl Token {
    /// The text a key or a scalar holds, its quotes taken off and their escapes read, or none
    /// for one that's no whole scalar: a list or a map in brackets, a block's header, or a quote
    /// that doesn't end on its line.
    pub(crate) fn text(&self) -> Option<String> {
        unquote(&self.raw)
    }

    pub(crate) fn quoted(&self) -> bool {
        self.raw.starts_with(['\'', '"'])
    }

    pub(crate) fn range(&self, line: usize) -> Range {
        Range::new(
            Pos::new(line + 1, self.column + 1),
            Pos::new(line + 1, self.column + 1 + self.raw.chars().count()),
        )
    }
}

impl Item {
    /// Its key's text, for a key.
    pub(crate) fn key(&self) -> Option<String> {
        match &self.head {
            Head::Key { key, .. } => Some(key.text().unwrap_or_else(|| key.raw.clone())),
            _ => None,
        }
    }

    pub(crate) fn key_token(&self) -> Option<&Token> {
        match &self.head {
            Head::Key { key, .. } => Some(key),
            _ => None,
        }
    }

    pub(crate) fn value(&self) -> Option<&Token> {
        match &self.head {
            Head::Key { value, .. } | Head::Dash { value } => value.as_ref(),
            Head::Text(_) => None,
        }
    }

    /// The child whose key is `key`.
    pub(crate) fn child(&self, key: &str) -> Option<&Item> {
        self.children
            .iter()
            .find(|c| c.key().as_deref() == Some(key))
    }

    /// The text of the child `key`'s value, as `name:`'s.
    pub(crate) fn child_text(&self, key: &str) -> Option<String> {
        self.child(key)?.value()?.text()
    }

    /// Its last line that isn't a comment after its children.
    pub(crate) fn end(&self) -> usize {
        let own = [
            Some(self.line),
            self.block.as_ref().and_then(|b| b.lines.last().copied()),
            self.more.last().copied(),
        ];
        let children = self.children.iter().map(Item::end);
        own.into_iter()
            .flatten()
            .chain(children)
            .max()
            .unwrap_or(self.line)
    }

    /// Whether `line` is one of its own: its head, its block, its continuation lines, or a
    /// child's, comments after its children included.
    pub(crate) fn holds(&self, line: usize) -> bool {
        let last = self
            .trailing
            .last()
            .copied()
            .map_or(self.end(), |t| t.max(self.end()));
        line >= self.line && line <= last
    }
}

impl<'t> Outline<'t> {
    /// The top-level item whose key is `key`.
    pub(crate) fn top(&self, key: &str) -> Option<&Item> {
        self.items.iter().find(|i| i.key().as_deref() == Some(key))
    }

    /// The items that hold `line`, the outermost first.
    pub(crate) fn path(&self, line: usize) -> Vec<&Item> {
        let mut path = Vec::new();
        let mut items = &self.items;
        while let Some(item) = items.iter().find(|i| i.holds(line)) {
            path.push(item);
            items = &item.children;
        }
        path
    }

    /// The item whose block holds `line`, with its block.
    pub(crate) fn block_at(&self, line: usize) -> Option<(&Item, &Block)> {
        let path = self.path(line);
        let item = path.last()?;
        let block = item.block.as_ref()?;
        let first = block.lines.first()?;
        let last = block.lines.last()?;
        (line >= *first && line <= *last).then_some((*item, block))
    }

    /// A line's text, or an empty one past the file's end.
    pub(crate) fn line(&self, line: usize) -> &'t str {
        self.lines.get(line).copied().unwrap_or("")
    }

    /// The range of a line's text after its indentation.
    pub(crate) fn line_range(&self, line: usize) -> Range {
        let text = self.line(line);
        Range::new(
            Pos::new(line + 1, indent_of(text) + 1),
            Pos::new(line + 1, text.chars().count() + 1),
        )
    }

    /// The range from an item's head to its last line.
    pub(crate) fn item_range(&self, item: &Item) -> Range {
        let end = item.end();
        Range::new(
            Pos::new(item.line + 1, item.indent + 1),
            Pos::new(end + 1, self.line(end).chars().count() + 1),
        )
    }

    /// Each item, depth first, with the keys of the items above it, the top-level one first.
    pub(crate) fn walk(&self) -> Vec<(Vec<String>, &Item)> {
        fn go<'a>(
            items: &'a [Item],
            path: &mut Vec<String>,
            out: &mut Vec<(Vec<String>, &'a Item)>,
        ) {
            for item in items {
                out.push((path.clone(), item));
                path.push(item.key().unwrap_or_default());
                go(&item.children, path, out);
                path.pop();
            }
        }
        let mut out = Vec::new();
        go(&self.items, &mut Vec::new(), &mut out);
        out
    }
}

pub(crate) fn parse(text: &str) -> Outline<'_> {
    let lines: Vec<&str> = text
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect();
    let mut parser = Parser {
        lines: &lines,
        at: 0,
    };
    let (items, trailing) = parser.items(0, false);
    Outline {
        lines,
        items,
        trailing,
    }
}

struct Parser<'a, 't> {
    lines: &'a [&'t str],
    at: usize,
}

impl Parser<'_, '_> {
    /// The items of a block whose items sit at `indent`, each with the comment lines above it,
    /// and the comment lines after its last item. With `dashes`, the block is a list written at
    /// its key's own indentation, so only `- ` lines are its items.
    fn items(&mut self, indent: usize, dashes: bool) -> (Vec<Item>, Vec<usize>) {
        let mut items = Vec::new();
        loop {
            let start = self.at;
            while self.at < self.lines.len() && is_run_line(self.lines[self.at]) {
                self.at += 1;
            }
            let run: Vec<usize> = (start..self.at).collect();
            let next = self.lines.get(self.at).copied();
            let belongs = next.is_some_and(|l| {
                let m = indent_of(l);
                m > indent || (m == indent && (!dashes || is_dash(l)))
            });
            if belongs {
                let item = self.item(run);
                items.push(item);
                continue;
            }
            // The comments at this block's indentation or deeper are its own, after its last
            // item; from the first comment further out, the rest go to the block outside.
            let mut keep = 0;
            for (i, &l) in run.iter().enumerate() {
                if is_blank(self.lines[l]) {
                    continue;
                }
                if indent_of(self.lines[l]) < indent {
                    break;
                }
                keep = i + 1;
            }
            if let Some(&back) = run.get(keep) {
                self.at = back;
            }
            return (items, run[..keep].to_vec());
        }
    }

    fn item(&mut self, above: Vec<usize>) -> Item {
        let line = self.at;
        let text = self.lines[line];
        let indent = indent_of(text);
        self.at += 1;
        let (head, comment) = head(text, indent);
        let mut item = Item {
            above,
            line,
            indent,
            head,
            comment,
            children: Vec::new(),
            trailing: Vec::new(),
            block: None,
            more: Vec::new(),
        };
        if let Some(value) = item.value() {
            if is_block_header(&value.raw) {
                let header = value.raw.clone();
                item.block = Some(self.block(indent, &header));
            } else {
                item.more = self.more(indent);
            }
            return item;
        }
        if matches!(item.head, Head::Text(_)) {
            item.more = self.more(indent);
            return item;
        }
        let mut peek = self.at;
        while peek < self.lines.len() && is_run_line(self.lines[peek]) {
            peek += 1;
        }
        if let Some(next) = self.lines.get(peek) {
            let m = indent_of(next);
            let key = matches!(item.head, Head::Key { .. });
            if m > indent {
                (item.children, item.trailing) = self.items(m, false);
            } else if m == indent && key && is_dash(next) {
                (item.children, item.trailing) = self.items(m, true);
            }
        }
        item
    }

    fn block(&mut self, indent: usize, header: &str) -> Block {
        let keep = header.contains('+');
        let mut content = header
            .chars()
            .find_map(|c| c.to_digit(10))
            .map(|d| indent + d as usize);
        let mut lines = Vec::new();
        while let Some(&l) = self.lines.get(self.at) {
            if !is_blank(l) {
                let m = indent_of(l);
                if m <= indent || m < *content.get_or_insert(m) {
                    break;
                }
            }
            lines.push(self.at);
            self.at += 1;
        }
        if !keep {
            while lines.last().is_some_and(|&l| is_blank(self.lines[l])) {
                lines.pop();
                self.at -= 1;
            }
        }
        Block {
            header: header.to_string(),
            lines,
            indent: content,
        }
    }

    /// The lines deeper than `indent` that go on with a value written on its head's line, and
    /// the blank lines between them.
    fn more(&mut self, indent: usize) -> Vec<usize> {
        let mut out = Vec::new();
        loop {
            let mut peek = self.at;
            while peek < self.lines.len() && is_blank(self.lines[peek]) {
                peek += 1;
            }
            match self.lines.get(peek) {
                Some(l) if !is_comment(l) && indent_of(l) > indent => {
                    out.extend(self.at..=peek);
                    self.at = peek + 1;
                }
                _ => return out,
            }
        }
    }
}

/// An item from one entry of a bracketed map, as `toggle: K('X')`, which no line of the file
/// holds, for the formatter to write out.
pub(crate) fn entry(text: &str) -> Item {
    let (head, comment) = head(text, 0);
    Item {
        above: Vec::new(),
        line: 0,
        indent: 0,
        head,
        comment,
        children: Vec::new(),
        trailing: Vec::new(),
        block: None,
        more: Vec::new(),
    }
}

/// A line's head: a key and its value, or a list item's value, with a comment after either.
pub(crate) fn head(text: &str, indent: usize) -> (Head, Option<Comment>) {
    let rest = &text[indent..];
    if rest == "-" || rest.starts_with("- ") {
        let (value, comment) = value_and_comment(&rest[1..], indent + 1);
        return (Head::Dash { value }, comment);
    }
    let Some(colon) = key_end(rest) else {
        return (Head::Text(rest.trim_end().to_string()), None);
    };
    let key = Token {
        raw: rest[..colon].trim_end().to_string(),
        column: indent,
    };
    let column = indent + rest[..colon + 1].chars().count();
    let (value, comment) = value_and_comment(&rest[colon + 1..], column);
    (Head::Key { key, value }, comment)
}

/// The byte where a line's key ends, at its `:`, if the line holds a key.
fn key_end(rest: &str) -> Option<usize> {
    if rest.is_empty() || rest.starts_with('#') {
        return None;
    }
    let from = if rest.starts_with(['\'', '"']) {
        quote_end(rest)?
    } else {
        0
    };
    let bytes = rest.as_bytes();
    (from..bytes.len()).find(|&i| {
        bytes[i] == b':' && (i + 1 == bytes.len() || bytes[i + 1] == b' ' || bytes[i + 1] == b'\t')
    })
}

/// A value and a comment after it, from `after`, the text after a key's `:` or a list item's
/// `-`, which starts at `column`.
fn value_and_comment(after: &str, column: usize) -> (Option<Token>, Option<Comment>) {
    let after = after.trim_end();
    let text = after.trim_start();
    let lead = &after[..after.len() - text.len()];
    if text.is_empty() {
        return (None, None);
    }
    if text.starts_with('#') {
        let comment = Comment {
            gap: lead.to_string(),
            text: text.to_string(),
        };
        return (None, Some(comment));
    }
    let value = text[..scalar_end(text)].trim_end();
    let rest = &text[value.len()..];
    let tail = rest.trim_start();
    let comment = (tail.starts_with('#') && rest.len() > tail.len()).then(|| Comment {
        gap: rest[..rest.len() - tail.len()].to_string(),
        text: tail.to_string(),
    });
    let raw = if comment.is_some() { value } else { text };
    let token = Token {
        raw: raw.to_string(),
        column: column + lead.chars().count(),
    };
    (Some(token), comment)
}

/// The byte where a value written on its line ends, before a comment.
fn scalar_end(text: &str) -> usize {
    match text.chars().next() {
        Some('\'' | '"') => quote_end(text).unwrap_or(text.len()),
        Some('[' | '{') => bracket_end(text).unwrap_or(text.len()),
        Some('|' | '>') => text.find(char::is_whitespace).unwrap_or(text.len()),
        _ => {
            let bytes = text.as_bytes();
            (1..bytes.len())
                .find(|&i| bytes[i] == b'#' && matches!(bytes[i - 1], b' ' | b'\t'))
                .map_or(text.len(), |i| i - 1)
        }
    }
}

/// The byte after a quoted text's closing quote: `''` stands for a quote in single quotes, and
/// `\` escapes in double quotes.
fn quote_end(text: &str) -> Option<usize> {
    let quote = text.chars().next()?;
    let mut chars = text.char_indices().skip(1).peekable();
    while let Some((i, c)) = chars.next() {
        if quote == '"' && c == '\\' {
            chars.next();
        } else if c == quote {
            if quote == '\'' && chars.peek().is_some_and(|(_, n)| *n == '\'') {
                chars.next();
            } else {
                return Some(i + 1);
            }
        }
    }
    None
}

/// The byte after the bracket that closes a list or map in brackets, past brackets and quotes
/// inside it.
fn bracket_end(text: &str) -> Option<usize> {
    let mut depth = 0usize;
    let mut quote = None;
    for (i, c) in text.char_indices() {
        match (quote, c) {
            (Some(q), _) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '\'' | '"') => quote = Some(c),
            (None, '[' | '{' | '(') => depth += 1,
            (None, ']' | '}' | ')') => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(i + 1);
                }
            }
            _ => {}
        }
    }
    None
}

/// The items of a list in brackets, as each is written, or none for a text that isn't one whole
/// list on its line, or one holding a list or map of its own.
pub(crate) fn flow_items(raw: &str) -> Option<Vec<String>> {
    let inner = raw.strip_prefix('[')?.strip_suffix(']')?;
    if bracket_end(raw) != Some(raw.len()) {
        return None;
    }
    let mut items = Vec::new();
    let mut item = String::new();
    let mut depth = 0usize;
    let mut quote = None;
    for c in inner.chars() {
        match (quote, c) {
            (Some(q), _) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '\'' | '"') => quote = Some(c),
            (None, '[' | '{') => return None,
            (None, '(') => depth += 1,
            (None, ')') => depth = depth.saturating_sub(1),
            (None, ',') if depth == 0 => {
                items.push(std::mem::take(&mut item).trim().to_string());
                continue;
            }
            _ => {}
        }
        item.push(c);
    }
    let last = item.trim();
    if !last.is_empty() {
        items.push(last.to_string());
    }
    items.iter().all(|i| !i.is_empty()).then_some(items)
}

/// The text a scalar holds, as `Token::text` gives it.
pub(crate) fn unquote(raw: &str) -> Option<String> {
    match raw.chars().next() {
        Some('\'') => {
            let inner = raw.strip_prefix('\'')?.strip_suffix('\'')?;
            (quote_end(raw) == Some(raw.len())).then(|| inner.replace("''", "'"))
        }
        Some('"') => {
            (quote_end(raw) == Some(raw.len())).then_some(())?;
            double_quoted(&raw[1..raw.len() - 1])
        }
        Some('[' | '{' | '|' | '>') | None => None,
        Some(_) => Some(raw.trim().to_string()),
    }
}

/// The text inside YAML's double quotes, its escapes read.
fn double_quoted(inner: &str) -> Option<String> {
    let mut out = String::new();
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        let hex = |chars: &mut std::str::Chars, n: usize| -> Option<char> {
            let digits: String = chars.by_ref().take(n).collect();
            u32::from_str_radix(&digits, 16)
                .ok()
                .and_then(char::from_u32)
        };
        out.push(match chars.next()? {
            '0' => '\0',
            'a' => '\u{7}',
            'b' => '\u{8}',
            't' | '\t' => '\t',
            'n' => '\n',
            'v' => '\u{b}',
            'f' => '\u{c}',
            'r' => '\r',
            'e' => '\u{1b}',
            ' ' => ' ',
            '"' => '"',
            '/' => '/',
            '\\' => '\\',
            'N' => '\u{85}',
            '_' => '\u{a0}',
            'L' => '\u{2028}',
            'P' => '\u{2029}',
            'x' => hex(&mut chars, 2)?,
            'u' => hex(&mut chars, 4)?,
            'U' => hex(&mut chars, 8)?,
            _ => return None,
        });
    }
    Some(out)
}

pub(crate) fn is_block_header(raw: &str) -> bool {
    let mut chars = raw.chars();
    matches!(chars.next(), Some('|' | '>'))
        && chars.clone().count() <= 2
        && chars.all(|c| matches!(c, '+' | '-' | '1'..='9'))
}

pub(crate) fn indent_of(line: &str) -> usize {
    line.len() - line.trim_start_matches(' ').len()
}

pub(crate) fn is_blank(line: &str) -> bool {
    line.trim().is_empty()
}

pub(crate) fn is_comment(line: &str) -> bool {
    line.trim_start().starts_with('#')
}

/// A comment line or a blank one, which sits between items.
fn is_run_line(line: &str) -> bool {
    is_blank(line) || is_comment(line)
}

fn is_dash(line: &str) -> bool {
    let rest = line.trim_start_matches(' ');
    rest == "-" || rest.starts_with("- ")
}

/// A comment line's text after its `#`.
pub(crate) fn comment_text(line: &str) -> &str {
    let rest = line.trim_start();
    rest.strip_prefix('#').unwrap_or(rest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_values_and_comments_are_read_from_their_lines() {
        let o = parse("a: 'x: y'  # note\nb:\n  - 1\n  - two # n\nc: [1, 2]\n");
        let a = &o.items[0];
        assert_eq!(a.key().as_deref(), Some("a"));
        assert_eq!(a.value().map(|v| v.raw.as_str()), Some("'x: y'"));
        assert_eq!(a.value().and_then(Token::text).as_deref(), Some("x: y"));
        assert_eq!(a.comment.as_ref().map(|c| c.gap.as_str()), Some("  "));
        let b = &o.items[1];
        assert_eq!(b.children.len(), 2);
        assert_eq!(b.children[1].value().map(|v| v.raw.as_str()), Some("two"));
        assert_eq!(flow_items("[1, 2]"), Some(vec!["1".into(), "2".into()]));
    }

    #[test]
    fn a_comment_goes_with_the_item_below_it_or_stays_in_its_block() {
        let o = parse(
            "state:\n  # ═══ A\n  a:\n    name: A\n    # owner: shared\n  # ── B\n  b:\n    name: B\n# end\n",
        );
        let state = &o.items[0];
        assert_eq!(state.children[0].above, [1]);
        assert_eq!(state.children[0].trailing, [4]);
        assert_eq!(state.children[1].above, [5]);
        assert_eq!(o.trailing, [8]);
    }

    #[test]
    fn a_block_holds_its_lines_and_leaves_the_blank_ones_after_it() {
        let o = parse("w: |\n  a\n\n  b\n\nx: 1\n");
        let block = o.items[0].block.as_ref().expect("a block");
        assert_eq!(block.lines, [1, 2, 3]);
        assert_eq!(block.indent, Some(2));
        assert_eq!(o.items[1].above, [4]);
    }

    #[test]
    fn a_list_at_its_keys_own_indentation_ends_at_the_next_key() {
        let o = parse("a:\n- 1\n- 2\nb: 3\n");
        assert_eq!(o.items.len(), 2);
        assert_eq!(o.items[0].children.len(), 2);
    }

    #[test]
    fn double_quotes_read_their_escapes() {
        assert_eq!(unquote("\"a\\\"b\\u00e9\"").as_deref(), Some("a\"bé"));
        assert_eq!(unquote("'it''s'").as_deref(), Some("it's"));
        assert_eq!(unquote("'open"), None);
    }
}
