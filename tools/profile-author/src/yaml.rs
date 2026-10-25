//! A profile's YAML, edited in place: a value set or a key removed by its path, as
//! `["seats", "pilot", "hip"]`, with every other line left as it was, comments included, which
//! 01-avatars leaves to the tool (record/areas/avatars/01-avatars.md, "Left open").
//!
//! saphyr, the YAML reader the profile engine uses, gives each key's line and column, and a
//! key's value is the rest of its line and every line below it indented deeper than the key.
//! So an edit rewrites only the lines of the value it sets, and a value that fits on its key's
//! line keeps the comment after it.

use saphyr::{LoadableYamlNode, MarkedYaml, Scalar, YamlData};

/// A value to write: one line of YAML, such as `[0.31, 0.12, 1.4]`, or a map in block form.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Line(String),
    Map(Vec<(String, Value)>),
}

/// How deep a new map's keys sit below their parent's, as the format's examples write them.
const STEP: usize = 2;

/// Parses a profile's text as the profile engine does, one document.
pub fn parse(text: &str) -> Result<Option<MarkedYaml<'_>>, String> {
    let docs =
        MarkedYaml::load_from_str(text).map_err(|e| format!("the YAML doesn't parse: {e}"))?;
    Ok(docs.into_iter().next())
}

/// The value of `key` in a map, or `None` when the node isn't a map or lacks it.
pub fn get<'a, 'i>(node: &'a MarkedYaml<'i>, key: &str) -> Option<&'a MarkedYaml<'i>> {
    match &node.data {
        YamlData::Mapping(map) => map
            .iter()
            .find(|(k, _)| k.data.as_str() == Some(key))
            .map(|(_, v)| v),
        _ => None,
    }
}

/// A map's keys and values, in the file's order, or none for anything but a map.
pub fn entries<'a, 'i>(node: &'a MarkedYaml<'i>) -> Vec<(&'a str, &'a MarkedYaml<'i>)> {
    match &node.data {
        YamlData::Mapping(map) => map
            .iter()
            .filter_map(|(k, v)| Some((k.data.as_str()?, v)))
            .collect(),
        _ => Vec::new(),
    }
}

pub fn text<'a>(node: &'a MarkedYaml<'_>) -> Option<&'a str> {
    node.data.as_str()
}

pub fn number(node: &MarkedYaml<'_>) -> Option<f64> {
    match &node.data {
        YamlData::Value(Scalar::Integer(i)) => Some(*i as f64),
        YamlData::Value(Scalar::FloatingPoint(f)) => Some(f.into_inner()),
        _ => None,
    }
}

/// A list's items, or the node itself for a field that takes a list or one item.
pub fn items<'a, 'i>(node: &'a MarkedYaml<'i>) -> Vec<&'a MarkedYaml<'i>> {
    match &node.data {
        YamlData::Sequence(items) => items.iter().collect(),
        _ => vec![node],
    }
}

/// `N` numbers written as a list, such as a point.
pub fn numbers<const N: usize>(node: &MarkedYaml<'_>) -> Option<[f64; N]> {
    let YamlData::Sequence(items) = &node.data else {
        return None;
    };
    if items.len() != N {
        return None;
    }
    let mut out = [0.0; N];
    for (slot, item) in out.iter_mut().zip(items) {
        *slot = number(item)?;
    }
    Some(out)
}

/// Sets the value at `path`, adding each key it lacks at the end of its parent's map.
pub fn set(text: &str, path: &[&str], value: &Value) -> Result<String, String> {
    let mut doc = Doc::new(text);
    let root = parse(text)?;
    let found = walk(root.as_ref(), path)?;
    doc.check_block(&found, path)?;
    if found.len() == path.len() {
        let key = found.last().expect("a path has a key");
        doc.replace(key, value);
    } else {
        doc.insert(
            root.as_ref(),
            found.last(),
            &path[found.len()..],
            value,
            path,
        )?;
    }
    let edited = doc.text();
    let landed = walk(parse(&edited)?.as_ref(), path)?.len() == path.len();
    if !landed {
        return Err(format!("the edit of `{}` didn't land", path.join(".")));
    }
    Ok(edited)
}

/// Removes the key at `path` and its value, or leaves the text as it was when it lacks one.
pub fn remove(text: &str, path: &[&str]) -> Result<String, String> {
    let mut doc = Doc::new(text);
    let root = parse(text)?;
    let found = walk(root.as_ref(), path)?;
    if found.len() < path.len() {
        return Ok(text.to_string());
    }
    doc.check_block(&found, path)?;
    let key = found.last().expect("a path has a key");
    let last = doc.extent(key.line, key.col);
    doc.lines.drain(key.line..=last);
    Ok(doc.text())
}

/// A key the text holds: its line from 0, its column, and its value.
struct KeyAt<'a> {
    line: usize,
    col: usize,
    value: &'a MarkedYaml<'a>,
}

/// The keys of `path` the text holds, outermost first, stopping at the first it lacks.
fn walk<'a>(root: Option<&'a MarkedYaml<'a>>, path: &[&str]) -> Result<Vec<KeyAt<'a>>, String> {
    let mut found = Vec::new();
    let Some(mut node) = root else {
        return Ok(found);
    };
    for (depth, step) in path.iter().enumerate() {
        let map = match &node.data {
            YamlData::Mapping(map) => map,
            YamlData::Value(Scalar::Null) => break,
            _ if depth == 0 => return Err("the profile isn't a map of keys".into()),
            _ => return Err(format!("`{}` isn't a map", path[..depth].join("."))),
        };
        let Some((k, v)) = map.iter().find(|(k, _)| k.data.as_str() == Some(step)) else {
            break;
        };
        found.push(KeyAt {
            line: k.span.start.line().saturating_sub(1),
            col: k.span.start.col(),
            value: v,
        });
        node = v;
    }
    Ok(found)
}

/// The text as lines, with the line ending it uses.
struct Doc {
    lines: Vec<String>,
    newline: &'static str,
}

impl Doc {
    fn new(text: &str) -> Doc {
        Doc {
            lines: text
                .split('\n')
                .map(|l| l.strip_suffix('\r').unwrap_or(l).to_string())
                .collect(),
            newline: if text.contains("\r\n") { "\r\n" } else { "\n" },
        }
    }

    fn text(&self) -> String {
        self.lines.join(self.newline)
    }

    /// A key inside a flow collection, such as `pilot: {hip: [0, 0, 0]}`, shares its line with
    /// what comes before it, and the line edits below would cut that collection apart.
    fn check_block(&self, found: &[KeyAt<'_>], path: &[&str]) -> Result<(), String> {
        for (depth, key) in found.iter().enumerate() {
            let before: String = self.lines[key.line].chars().take(key.col).collect();
            if !before.trim().is_empty() {
                return Err(format!(
                    "`{}` is written in flow style, with braces, which the tool doesn't edit; write it as a block",
                    path[..=depth].join(".")
                ));
            }
        }
        Ok(())
    }

    /// The last line of the value of the key at `line` and `col`: the lines below it indented
    /// deeper, and a list under it written at its own indentation, as YAML allows. A blank
    /// line or a comment at the key's indentation or less belongs to whatever comes next.
    fn extent(&self, line: usize, col: usize) -> usize {
        let (_, value, _) = split(&self.lines[line], col);
        let open = value.is_empty();
        let mut last = line;
        for (i, l) in self.lines.iter().enumerate().skip(line + 1) {
            let t = l.trim_start();
            if t.is_empty() {
                continue;
            }
            let indent = l.len() - t.len();
            let listed = open && indent == col && (t == "-" || t.starts_with("- "));
            if indent > col || listed {
                last = i;
            } else {
                break;
            }
        }
        last
    }

    fn replace(&mut self, key: &KeyAt<'_>, value: &Value) {
        let last = self.extent(key.line, key.col);
        let line = &self.lines[key.line];
        let (head, _, comment) = split(line, key.col);
        let mut out = Vec::new();
        match value {
            Value::Line(v) => out.push(with_comment(format!("{head} {v}"), line, comment)),
            Value::Map(entries) => {
                let indent = match &key.value.data {
                    YamlData::Mapping(map) => map
                        .iter()
                        .next()
                        .map(|(k, _)| k.span.start.col())
                        .filter(|&c| c > key.col),
                    _ => None,
                }
                .unwrap_or(key.col + STEP);
                out.push(with_comment(head.to_string(), line, comment));
                for entry in entries {
                    render(entry, indent, &mut out);
                }
            }
        }
        self.lines.splice(key.line..=last, out);
    }

    /// Adds `rest` of `path` below the deepest key found, `parent`, or at the end of the file.
    fn insert(
        &mut self,
        root: Option<&MarkedYaml<'_>>,
        parent: Option<&KeyAt<'_>>,
        rest: &[&str],
        value: &Value,
        path: &[&str],
    ) -> Result<(), String> {
        let (at, indent) = match parent {
            None => {
                let indent = root
                    .and_then(|r| match &r.data {
                        YamlData::Mapping(map) => {
                            map.iter().next().map(|(k, _)| k.span.start.col())
                        }
                        _ => None,
                    })
                    .unwrap_or(0);
                let end = self
                    .lines
                    .iter()
                    .rposition(|l| !l.trim().is_empty())
                    .map_or(0, |i| i + 1);
                (end, indent)
            }
            Some(p) => {
                let named = || path[..path.len() - rest.len()].join(".");
                let indent = match &p.value.data {
                    YamlData::Mapping(map) => match map.iter().next() {
                        Some((k, _)) if k.span.start.line().saturating_sub(1) > p.line => {
                            k.span.start.col()
                        }
                        Some(_) => {
                            return Err(format!(
                                "`{}` is written in flow style, with braces, which the tool doesn't edit; write it as a block",
                                named()
                            ));
                        }
                        // `{}` on the key's line: the map's keys go below it instead.
                        None => {
                            let line = &self.lines[p.line];
                            let (head, _, comment) = split(line, p.col);
                            self.lines[p.line] = with_comment(head.to_string(), line, comment);
                            p.col + STEP
                        }
                    },
                    YamlData::Value(Scalar::Null) => p.col + STEP,
                    _ => return Err(format!("`{}` isn't a map", named())),
                };
                (self.extent(p.line, p.col) + 1, indent)
            }
        };
        let mut out = Vec::new();
        render(&nest(rest, value), indent, &mut out);
        self.lines.splice(at..at, out);
        Ok(())
    }
}

/// `rest` as one entry, each key but the last a map holding the next.
fn nest(rest: &[&str], value: &Value) -> (String, Value) {
    match rest {
        [last] => (last.to_string(), value.clone()),
        [first, more @ ..] => (first.to_string(), Value::Map(vec![nest(more, value)])),
        [] => unreachable!("an insert adds at least one key"),
    }
}

fn render((key, value): &(String, Value), indent: usize, out: &mut Vec<String>) {
    let pad = " ".repeat(indent);
    match value {
        Value::Line(v) => out.push(format!("{pad}{key}: {v}")),
        Value::Map(entries) => {
            out.push(format!("{pad}{key}:"));
            for entry in entries {
                render(entry, indent + STEP, out);
            }
        }
    }
}

/// The line of a key at column `col`, cut into the key up to its colon, the value written on
/// the line, and where its comment starts, if it has one.
fn split(line: &str, col: usize) -> (&str, &str, Option<usize>) {
    let start = line.char_indices().nth(col).map_or(line.len(), |(i, _)| i);
    let key = &line[start..];
    // A quoted key may hold a colon, so its colon comes after its closing quote.
    let after_key = match key.chars().next() {
        Some(q @ ('"' | '\'')) => key[1..].find(q).map_or(0, |i| i + 2),
        _ => 0,
    };
    let Some(colon) = key[after_key..].find(':').map(|i| start + after_key + i) else {
        return (line, "", None);
    };
    let head = &line[..=colon];
    let rest = &line[colon + 1..];
    let comment = comment_in(rest).map(|i| colon + 1 + i);
    let value = &line[colon + 1..comment.unwrap_or(line.len())];
    (head, value.trim(), comment)
}

/// Where a comment starts in a value's text: a `#` after whitespace, outside quotes. A quote
/// opens quoted text only where a scalar can start, so the apostrophe in `Pilot's seat` opens
/// none.
fn comment_in(text: &str) -> Option<usize> {
    let mut quote = None;
    let mut before = ' ';
    for (i, c) in text.char_indices() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if matches!(c, '"' | '\'') && matches!(before, ' ' | '[' | '{' | ',') => {
                quote = Some(c);
            }
            None if c == '#' && before.is_whitespace() => return Some(i),
            None => {}
        }
        before = c;
    }
    None
}

/// `content`, with the comment that started at byte `comment` of `old` after it, at the same
/// column where it still fits.
fn with_comment(content: String, old: &str, comment: Option<usize>) -> String {
    let Some(at) = comment else {
        return content;
    };
    let column = old[..at].chars().count();
    let width = content.chars().count();
    let gap = if width < column { column - width } else { 1 };
    format!("{content}{}{}", " ".repeat(gap), &old[at..])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(v: &str) -> Value {
        Value::Line(v.into())
    }

    const PROFILE: &str = "authors: Dual Input

aircraft:
  variants:
    press: bksq-aircraft-baronpropress

# ═══ STATE
state:
  mixture_1:
    name: Left mixture
    watch: L('BKSQ_MixtureLeverPosition_1')
    write: |
      (value) => {
        state: write(L('BKSQ_MixtureLeverPosition_1'), value)
      }
    location: [0.21, 0.55, 1.92]              # hypothetical
  # ── Lights
  beacon:
    name: Beacon
    only:
    - press
    watch: L('BEACON')
    write: L('BEACON')
";

    #[test]
    fn a_value_on_its_keys_line_is_replaced_and_keeps_its_comment_where_it_was() {
        let out = set(
            PROFILE,
            &["state", "mixture_1", "location"],
            &line("[0.3, 0.6, 1.9]"),
        )
        .unwrap();
        assert!(
            out.contains("    location: [0.3, 0.6, 1.9]                 # hypothetical\n"),
            "{out}"
        );
        assert_eq!(out.lines().count(), PROFILE.lines().count());
    }

    #[test]
    fn a_missing_key_goes_at_the_end_of_its_map_past_a_block_scalar() {
        let out = set(
            PROFILE,
            &["state", "beacon", "location"],
            &line("[1, 2, 3]"),
        )
        .unwrap();
        assert!(
            out.ends_with("    write: L('BEACON')\n    location: [1, 2, 3]\n"),
            "{out}"
        );
        let out = set(PROFILE, &["state", "mixture_1", "deadband"], &line("2")).unwrap();
        assert!(
            out.contains("    location: [0.21, 0.55, 1.92]              # hypothetical\n    deadband: 2\n  # ── Lights\n"),
            "the new key goes before the comment at its map's parent's indentation: {out}"
        );
    }

    #[test]
    fn a_list_at_its_keys_indentation_is_part_of_its_value() {
        let out = set(PROFILE, &["state", "beacon", "only"], &line("[press]")).unwrap();
        assert!(
            out.contains("    only: [press]\n    watch: L('BEACON')"),
            "{out}"
        );
    }

    #[test]
    fn missing_parents_are_added_and_a_map_value_replaces_a_line() {
        let out = set(
            PROFILE,
            &["seats", "pilot", "hip"],
            &line("[0.31, 0.12, 1.4]"),
        )
        .unwrap();
        assert!(
            out.ends_with("    write: L('BEACON')\nseats:\n  pilot:\n    hip: [0.31, 0.12, 1.4]\n"),
            "{out}"
        );
        let map = Value::Map(vec![
            ("base".into(), line("[0.2, 0.5, 1.9]")),
            ("press".into(), line("[0.3, 0.6, 1.9]")),
        ]);
        let out = set(PROFILE, &["state", "mixture_1", "location"], &map).unwrap();
        assert!(
            out.contains("    location:                                 # hypothetical\n      base: [0.2, 0.5, 1.9]\n      press: [0.3, 0.6, 1.9]\n  # ── Lights"),
            "{out}"
        );
        let back = set(
            &out,
            &["state", "mixture_1", "location"],
            &line("[1, 1, 1]"),
        )
        .unwrap();
        assert!(
            back.contains(
                "    location: [1, 1, 1]                       # hypothetical\n  # ── Lights"
            ),
            "{back}"
        );
    }

    #[test]
    fn a_removed_key_takes_its_value_and_a_missing_one_changes_nothing() {
        let out = remove(PROFILE, &["state", "mixture_1", "write"]).unwrap();
        assert!(!out.contains("(value) =>"), "{out}");
        assert!(out.contains("    watch: L('BKSQ_MixtureLeverPosition_1')\n    location:"));
        assert_eq!(remove(PROFILE, &["seats", "pilot"]).unwrap(), PROFILE);
    }

    #[test]
    fn crlf_lines_stay_crlf_and_an_empty_file_gets_its_first_key() {
        let crlf = PROFILE.replace('\n', "\r\n");
        let out = set(&crlf, &["state", "beacon", "deadband"], &line("1")).unwrap();
        assert!(
            out.contains("L('BEACON')\r\n    deadband: 1\r\n"),
            "{out:?}"
        );
        assert!(!out.replace("\r\n", "").contains('\n'));
        assert_eq!(
            set("", &["seats", "pilot", "name"], &line("Pilot")).unwrap(),
            "seats:\n  pilot:\n    name: Pilot\n"
        );
    }

    #[test]
    fn an_empty_flow_map_opens_and_a_key_inside_braces_is_refused() {
        let out = set(
            "seats: {}  # none yet\n",
            &["seats", "pilot", "name"],
            &line("Pilot"),
        )
        .unwrap();
        assert_eq!(out, "seats:     # none yet\n  pilot:\n    name: Pilot\n");
        let error = set(
            "seats: {pilot: {name: P}}\n",
            &["seats", "pilot", "name"],
            &line("Pilot"),
        )
        .unwrap_err();
        assert!(error.contains("flow style"), "{error}");
    }

    #[test]
    fn a_hash_inside_quotes_or_a_word_isnt_a_comment() {
        assert_eq!(comment_in(" 'a # b'  # c"), Some(10));
        assert_eq!(comment_in(" Pilot's seat # c"), Some(14));
        assert_eq!(comment_in(" C#"), None);
    }
}
