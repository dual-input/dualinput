//! A profile's YAML as a tree of our own, each node with its place in the file, built from
//! saphyr's, so the checker, the bundle's reader, and an editor never depend on saphyr's types.

use saphyr::{LoadableYamlNode, MarkedYaml, Scalar, YamlData};

use crate::report::{Diagnostic, Place};

#[derive(Clone, Debug, PartialEq)]
pub struct Node {
    /// Where saphyr starts the node: a quoted text at its opening quote, and a block at its first
    /// line that holds text, which `Text::content` corrects.
    pub at: Place,
    pub kind: Kind,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    Null,
    Bool(bool),
    Number(f64),
    Str(Text),
    Seq(Vec<Node>),
    /// A map's entries in the file's order, each key with its own place.
    Map(Vec<(Key, Node)>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Key {
    pub text: String,
    pub at: Place,
    /// The quote the key is written in, `'` or `"`, or none for a plain key.
    pub quote: Option<char>,
}

/// A string, and where its text starts, so TypeScript's errors in a script land on the
/// script's own line and column.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Text {
    pub text: String,
    /// For a block, `|` or `>`, the line below its indicator, at the block's indentation, where
    /// each line of the text starts; otherwise the place of the text's first character.
    pub content: Place,
    pub block: bool,
    /// The quote the text is written in, `'` or `"`, or none for a plain text or a block.
    pub quote: Option<char>,
}

impl Text {
    /// Where the text's character at `offset`, counted in characters from its first, sits in
    /// the file. It's exact in a block, and in a plain or quoted text up to its first escape,
    /// such as `''`, or its first folded line break, past which YAML's text and the file's
    /// differ.
    pub fn at(&self, offset: usize) -> Place {
        let head: String = self.text.chars().take(offset).collect();
        let Some(last) = head.rfind('\n') else {
            return Place::new(
                &self.content.file,
                self.content.line,
                self.content.column + offset,
            );
        };
        let indent = if self.block { self.content.column } else { 1 };
        Place::new(
            &self.content.file,
            self.content.line + head.matches('\n').count(),
            indent + head[last + 1..].chars().count(),
        )
    }
}

impl Node {
    pub fn str(&self) -> Option<&Text> {
        match &self.kind {
            Kind::Str(t) => Some(t),
            _ => None,
        }
    }

    pub(crate) fn what(&self) -> &'static str {
        match self.kind {
            Kind::Null => "nothing",
            Kind::Bool(_) => "true or false",
            Kind::Number(_) => "a number",
            Kind::Str(_) => "text",
            Kind::Seq(_) => "a list",
            Kind::Map(_) => "a map",
        }
    }
}

/// Parses one file. YAML that doesn't parse, a repeated key in one map among it, is an error
/// at the place saphyr gives, and so is an anchor, an alias, or a tag, which a profile has no
/// use for and which would let one node stand in two places. A leading byte-order mark, which
/// Windows PowerShell 5.1's `Set-Content -Encoding utf8` writes, is skipped, since saphyr reads
/// it as part of the first key.
///
/// A bracketed map, which a file that parses can hold anywhere, fails the file too, and every one
/// in it is reported at once, so an author converting a profile sees them all in one build.
pub fn parse(file: &str, text: &str) -> Result<Node, Vec<Diagnostic>> {
    let (root, bracketed) = parse_keeping_brackets(file, text)?;
    if bracketed.is_empty() {
        Ok(root)
    } else {
        Err(bracketed)
    }
}

/// Parses one file as `parse` does, but gives the tree even when it holds a bracketed map,
/// beside the errors `parse` gives for them, so an editor's outline still shows the file. Each
/// bracketed map is `Kind::Null` at its place, since YAML split it at its commas, and
/// `bracketed_entries` gives the entries its author meant.
pub fn parse_keeping_brackets(
    file: &str,
    text: &str,
) -> Result<(Node, Vec<Diagnostic>), Vec<Diagnostic>> {
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let docs = MarkedYaml::load_from_str(text).map_err(|e| {
        vec![Diagnostic::error(
            Place::new(file, e.marker().line(), e.marker().col() + 1),
            "yaml",
            format!("The YAML doesn't parse: {}", e.info()),
        )]
    })?;
    let mut docs = docs.into_iter();
    let Some(doc) = docs.next() else {
        return Ok((
            Node {
                at: Place::new(file, 1, 1),
                kind: Kind::Map(Vec::new()),
            },
            Vec::new(),
        ));
    };
    if let Some(second) = docs.next() {
        return Err(vec![Diagnostic::error(
            place(file, &second),
            "yaml",
            "A profile is one YAML document, so it can't hold a second after `---`",
        )]);
    }
    let lines: Vec<&str> = text.split('\n').collect();
    let mut bracketed = Vec::new();
    let root = convert(file, &lines, &doc, &mut bracketed).map_err(|e| vec![e])?;
    Ok((root, bracketed))
}

fn place(file: &str, node: &MarkedYaml) -> Place {
    Place::new(file, node.span.start.line(), node.span.start.col() + 1)
}

/// The quote a scalar starting at `at` is written in, if any.
fn quote_at(lines: &[&str], at: &Place) -> Option<char> {
    lines
        .get(at.line - 1)
        .and_then(|l| l.chars().nth(at.column - 1))
        .filter(|c| matches!(c, '\'' | '"'))
}

/// Converts saphyr's node, pushing an error for each bracketed map into `bracketed` and leaving
/// nothing in its place, so the walk goes on to find the rest.
fn convert(
    file: &str,
    lines: &[&str],
    node: &MarkedYaml,
    bracketed: &mut Vec<Diagnostic>,
) -> Result<Node, Diagnostic> {
    let at = place(file, node);
    let kind = match &node.data {
        YamlData::Value(Scalar::Null) => Kind::Null,
        YamlData::Value(Scalar::Boolean(b)) => Kind::Bool(*b),
        YamlData::Value(Scalar::Integer(i)) => Kind::Number(*i as f64),
        YamlData::Value(Scalar::FloatingPoint(f)) => Kind::Number(f.into_inner()),
        YamlData::Value(Scalar::String(s)) => {
            let (content, block) = content(file, lines, &at, s);
            Kind::Str(Text {
                text: s.to_string(),
                content,
                block,
                quote: if block { None } else { quote_at(lines, &at) },
            })
        }
        YamlData::Sequence(items) => Kind::Seq(
            items
                .iter()
                .map(|n| convert(file, lines, n, bracketed))
                .collect::<Result<_, _>>()?,
        ),
        YamlData::Mapping(map) => {
            if let Some(form) = in_brackets(lines, &at) {
                bracketed.push(Diagnostic::error(
                    at.clone(),
                    "map-form",
                    written_out(&form),
                ));
                return Ok(Node {
                    at,
                    kind: Kind::Null,
                });
            }
            let mut entries = Vec::new();
            for (k, v) in map {
                let Some(text) = k.data.as_str() else {
                    return Err(Diagnostic::error(
                        place(file, k),
                        "key-form",
                        "Each key in a profile is text",
                    ));
                };
                let key_at = place(file, k);
                entries.push((
                    Key {
                        text: text.to_string(),
                        quote: quote_at(lines, &key_at),
                        at: key_at,
                    },
                    convert(file, lines, v, bracketed)?,
                ));
            }
            Kind::Map(entries)
        }
        YamlData::Representation(..) | YamlData::BadValue => {
            return Err(Diagnostic::error(at, "yaml", "The YAML doesn't parse here"));
        }
        YamlData::Tagged(..) | YamlData::Alias(_) => {
            return Err(Diagnostic::error(
                at,
                "yaml",
                "A profile uses no YAML tags, anchors, or aliases",
            ));
        }
    };
    Ok(Node { at, kind })
}

/// A map written in brackets, `{…}`, which a profile refuses: YAML splits one at its commas,
/// so `{toggle: K('X', 2, 6)}` reads the name's values as keys, and the error that follows names
/// a key, far from the cause (record/areas/profiles/01-format-and-delivery.md, "Layout").
/// Returns the map's entries as the file writes them, split at the commas outside a name's
/// parentheses, its brackets, and its quotes, or none for a map the file doesn't bracket.
fn in_brackets(lines: &[&str], at: &Place) -> Option<Bracketed> {
    let line = lines.get(at.line - 1)?;
    let rest: String = line.chars().skip(at.column - 1).collect();
    let inner = rest.strip_prefix('{')?;
    let mut entries = Vec::new();
    let mut entry = String::new();
    let mut depth = 0usize;
    let mut quote = None;
    for c in inner.chars() {
        match (quote, c) {
            (Some(q), _) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '\'' | '"') => quote = Some(c),
            (None, '(' | '[' | '{') => depth += 1,
            (None, '}') if depth == 0 => {
                entries.push(entry.trim().to_string());
                return Some(Bracketed::Closed(
                    entries.into_iter().filter(|e| !e.is_empty()).collect(),
                ));
            }
            (None, ')' | ']' | '}') => depth = depth.saturating_sub(1),
            (None, ',') if depth == 0 => {
                entries.push(entry.trim().to_string());
                entry.clear();
                continue;
            }
            _ => {}
        }
        entry.push(c);
    }
    Some(Bracketed::PastItsLine)
}

/// The entries of a bracketed map that starts at `column`, from 1, of `line`, as the file writes
/// them and the `map-form` error writes them out, such as `toggle: K('BUS', 2, 6)`, for an
/// editor to put each on a line of its own. Gives none where no bracketed map starts, or where
/// one runs past its line.
pub fn bracketed_entries(line: &str, column: usize) -> Option<Vec<String>> {
    match in_brackets(&[line], &Place::new("", 1, column.max(1)))? {
        Bracketed::Closed(entries) => Some(entries),
        Bracketed::PastItsLine => None,
    }
}

/// A bracketed map as its line shows it.
enum Bracketed {
    /// Its entries, none for `{}`.
    Closed(Vec<String>),
    /// It runs onto the lines below, which the error doesn't write out.
    PastItsLine,
}

/// The error for a bracketed map, with its entries as the lines that replace it.
fn written_out(form: &Bracketed) -> String {
    let lead =
        "A map in a profile goes on its own lines, since YAML splits a map in `{…}` at its commas";
    let entries = match form {
        Bracketed::PastItsLine => {
            return format!(
                "{lead}: write each of its entries on a line of its own, below its key"
            );
        }
        Bracketed::Closed(entries) => entries,
    };
    let lines: Vec<String> = entries.iter().map(|e| format!("`{e}`")).collect();
    match lines.as_slice() {
        [] => "A map in a profile goes on its own lines, so an empty one, `{}`, is left out: delete its key".to_string(),
        [one] => format!("{lead}: write {one} on the line below its key"),
        [first, last] => {
            format!("{lead}: write {first} and {last} below its key, each on a line of its own")
        }
        [rest @ .., last] => format!(
            "{lead}: write {}, and {last} below its key, each on a line of its own",
            rest.join(", ")
        ),
    }
}

/// Where a string's text starts, and whether it's a block. saphyr places a block, `|` or `>`,
/// at its first line that holds text, past any blank lines, which the text starts with, so the
/// text's first line is the one below the indicator, at the indentation the block strips from
/// every line. Any other string's text starts after its opening quote, if it has one.
fn content(file: &str, lines: &[&str], at: &Place, text: &str) -> (Place, bool) {
    let blank = text.chars().take_while(|c| *c == '\n').count();
    if at.line > blank + 1 {
        let header = lines[at.line - blank - 2];
        let header = header.split(" #").next().unwrap_or(header).trim_end();
        let indicator = header.rsplit(' ').next().unwrap_or(header);
        let mut chars = indicator.chars();
        let block = matches!(chars.next(), Some('|' | '>'))
            && chars.clone().count() <= 2
            && chars.all(|c| matches!(c, '+' | '-' | '1'..='9'));
        if block {
            return (Place::new(file, at.line - blank, at.column), true);
        }
    }
    let quoted = lines
        .get(at.line - 1)
        .and_then(|l| l.chars().nth(at.column - 1))
        .is_some_and(|c| c == '\'' || c == '"');
    if quoted {
        return (Place::new(file, at.line, at.column + 1), false);
    }
    (at.clone(), false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(node: &Node) -> &[(Key, Node)] {
        match &node.kind {
            Kind::Map(entries) => entries,
            _ => panic!("a map was expected"),
        }
    }

    #[test]
    fn places_are_lines_and_columns_from_1() {
        let root = parse("a.yaml", "state:\n  battery:\n    name: Battery\n").expect("parses");
        let (key, state) = &map(&root)[0];
        assert_eq!((key.at.line, key.at.column), (1, 1));
        let (battery, entry) = &map(state)[0];
        assert_eq!((battery.at.line, battery.at.column), (2, 3));
        let (_, name) = &map(entry)[0];
        assert_eq!((name.at.line, name.at.column), (3, 11));
    }

    #[test]
    fn a_block_scripts_text_starts_on_the_line_below_its_indicator() {
        let root = parse("a.yaml", "write: |\n\n  (value) => {\n  }\n").expect("parses");
        let (_, write) = &map(&root)[0];
        let text = write.str().expect("a string");
        assert_eq!(text.text, "\n(value) => {\n}\n");
        assert!(text.block);
        assert_eq!((text.content.line, text.content.column), (2, 3));
    }

    #[test]
    fn a_repeated_key_is_an_error_where_saphyr_finds_it() {
        let errors = parse("a.yaml", "authors: A\nauthors: B\n").expect_err("a repeat");
        assert_eq!(errors[0].code, "yaml");
        assert_eq!(errors[0].at.line, 2);
    }

    /// The one error a parse gives.
    fn only(errors: Vec<Diagnostic>) -> Diagnostic {
        assert_eq!(errors.len(), 1, "{errors:?}");
        errors.into_iter().next().expect("one error")
    }

    #[test]
    fn a_bracketed_map_is_refused_with_its_entries_written_out() {
        let error =
            only(parse("a.yaml", "write: {toggle: K('BUS', 2, 6)}\n").expect_err("brackets"));
        assert_eq!(error.code, "map-form");
        assert_eq!((error.at.line, error.at.column), (1, 8));
        assert!(
            error
                .message
                .contains("write `toggle: K('BUS', 2, 6)` on the line below its key"),
            "{}",
            error.message
        );
        let error = only(
            parse("a.yaml", "w: {inc: K('A, B'), dec: K('C'), wrap: false}\n")
                .expect_err("brackets"),
        );
        assert!(
            error
                .message
                .contains("write `inc: K('A, B')`, `dec: K('C')`, and `wrap: false` below"),
            "{}",
            error.message
        );
    }

    #[test]
    fn a_bracketed_map_inside_a_list_is_refused_and_a_bracketed_list_is_not() {
        let error = only(parse("a.yaml", "x: [{a: 1}]\n").expect_err("brackets"));
        assert_eq!(error.code, "map-form");
        let root = parse("a.yaml", "range: [0, 359]\n").expect("parses");
        assert!(matches!(map(&root)[0].1.kind, Kind::Seq(_)));
    }

    #[test]
    fn every_bracketed_map_in_a_file_is_reported_at_once() {
        let yaml = "state:\n  a:\n    write: {toggle: K('A')}\n  b:\n    write: {toggle: K('B')}\n";
        let errors = parse("a.yaml", yaml).expect_err("brackets");
        let lines: Vec<usize> = errors.iter().map(|e| e.at.line).collect();
        assert_eq!(lines, [3, 5]);
    }

    #[test]
    fn an_empty_bracketed_map_is_left_out_and_one_past_its_line_is_written_out_in_general() {
        let error = only(parse("a.yaml", "events: {}\n").expect_err("brackets"));
        assert!(
            error.message.contains("delete its key"),
            "{}",
            error.message
        );
        let error = only(parse("a.yaml", "w: {toggle: K('A'),\n  x: 1}\n").expect_err("brackets"));
        assert!(
            error.message.contains("each of its entries"),
            "{}",
            error.message
        );
    }

    #[test]
    fn a_leading_byte_order_mark_is_skipped() {
        let root = parse("a.yaml", "\u{FEFF}maker: M\n").expect("parses");
        let (key, _) = &map(&root)[0];
        assert_eq!(key.text, "maker");
        assert_eq!((key.at.line, key.at.column), (1, 1));
    }

    #[test]
    fn a_text_and_a_key_record_their_quote() {
        let root = parse(
            "a.yaml",
            "\"x\": 'Radio: COM1'\ny: \"two\"\nz: plain\nw: |\n  'block'\n",
        )
        .expect("parses");
        let quotes: Vec<(Option<char>, Option<char>)> = map(&root)
            .iter()
            .map(|(k, v)| (k.quote, v.str().and_then(|t| t.quote)))
            .collect();
        assert_eq!(
            quotes,
            [
                (Some('"'), Some('\'')),
                (None, Some('"')),
                (None, None),
                (None, None)
            ]
        );
    }

    #[test]
    fn a_character_of_a_text_is_placed_in_the_file() {
        let root = parse("a.yaml", "w: |\n  ab\n  cd\nv: 'xy'\n").expect("parses");
        let block = map(&root)[0].1.str().expect("a block");
        assert_eq!((block.at(4).line, block.at(4).column), (3, 4));
        let quoted = map(&root)[1].1.str().expect("a text");
        assert_eq!((quoted.at(1).line, quoted.at(1).column), (4, 6));
    }

    #[test]
    fn a_bracketed_map_keeps_the_rest_of_the_tree_for_an_editor() {
        let (root, errors) =
            parse_keeping_brackets("a.yaml", "a: 1\nw: {toggle: K('BUS', 2, 6)}\n").expect("YAML");
        assert_eq!(errors.len(), 1);
        assert!(matches!(map(&root)[1].1.kind, Kind::Null));
        assert_eq!(
            bracketed_entries("w: {toggle: K('BUS', 2, 6)}", 4),
            Some(vec!["toggle: K('BUS', 2, 6)".to_string()])
        );
        assert_eq!(bracketed_entries("w: x", 4), None);
    }

    #[test]
    fn yaml_1_2_reads_no_as_text() {
        let root = parse("a.yaml", "x: no\n").expect("parses");
        assert!(matches!(map(&root)[0].1.kind, Kind::Str(_)));
    }
}
