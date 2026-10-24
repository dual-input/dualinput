//! A profile's YAML as a tree of our own, each node with its place in the file, built from
//! saphyr's, so the checker and the bundle's reader never depend on saphyr's types.

use saphyr::{LoadableYamlNode, MarkedYaml, Scalar, YamlData};

use crate::report::{Diagnostic, Place};

#[derive(Clone, Debug)]
pub(crate) struct Node {
    pub(crate) at: Place,
    pub(crate) kind: Kind,
}

#[derive(Clone, Debug)]
pub(crate) enum Kind {
    Null,
    Bool(bool),
    Number(f64),
    Str(Text),
    Seq(Vec<Node>),
    /// A map's entries in the file's order, each key with its own place.
    Map(Vec<(Key, Node)>),
}

#[derive(Clone, Debug)]
pub(crate) struct Key {
    pub(crate) text: String,
    pub(crate) at: Place,
}

/// A string, and where its text starts, so TypeScript's errors in a script land on the
/// script's own line and column.
#[derive(Clone, Debug)]
pub(crate) struct Text {
    pub(crate) text: String,
    /// For a block, `|` or `>`, the line below its indicator, at the block's indentation, where
    /// each line of the text starts; otherwise the place of the text's first character.
    pub(crate) content: Place,
    pub(crate) block: bool,
}

impl Node {
    pub(crate) fn str(&self) -> Option<&Text> {
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
/// use for and which would let one node stand in two places.
pub(crate) fn parse(file: &str, text: &str) -> Result<Node, Diagnostic> {
    let docs = MarkedYaml::load_from_str(text).map_err(|e| {
        Diagnostic::error(
            Place::new(file, e.marker().line(), e.marker().col() + 1),
            "yaml",
            format!("The YAML doesn't parse: {}", e.info()),
        )
    })?;
    let mut docs = docs.into_iter();
    let Some(doc) = docs.next() else {
        return Ok(Node {
            at: Place::new(file, 1, 1),
            kind: Kind::Map(Vec::new()),
        });
    };
    if let Some(second) = docs.next() {
        return Err(Diagnostic::error(
            place(file, &second),
            "yaml",
            "A profile is one YAML document, so it can't hold a second after `---`",
        ));
    }
    let lines: Vec<&str> = text.split('\n').collect();
    convert(file, &lines, &doc)
}

fn place(file: &str, node: &MarkedYaml) -> Place {
    Place::new(file, node.span.start.line(), node.span.start.col() + 1)
}

fn convert(file: &str, lines: &[&str], node: &MarkedYaml) -> Result<Node, Diagnostic> {
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
            })
        }
        YamlData::Sequence(items) => Kind::Seq(
            items
                .iter()
                .map(|n| convert(file, lines, n))
                .collect::<Result<_, _>>()?,
        ),
        YamlData::Mapping(map) => {
            let mut entries = Vec::new();
            for (k, v) in map {
                let Some(text) = k.data.as_str() else {
                    return Err(Diagnostic::error(
                        place(file, k),
                        "key-form",
                        "Each key in a profile is text",
                    ));
                };
                entries.push((
                    Key {
                        text: text.to_string(),
                        at: place(file, k),
                    },
                    convert(file, lines, v)?,
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
        let error = parse("a.yaml", "authors: A\nauthors: B\n").expect_err("a repeat");
        assert_eq!(error.code, "yaml");
        assert_eq!(error.at.line, 2);
    }

    #[test]
    fn yaml_1_2_reads_no_as_text() {
        let root = parse("a.yaml", "x: no\n").expect("parses");
        assert!(matches!(map(&root)[0].1.kind, Kind::Str(_)));
    }
}
