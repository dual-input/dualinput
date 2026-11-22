//! Comments: headings, and the reflow of a comment's paragraphs to 100 columns
//! (record/areas/profiles/03-the-extension.md, "Comments").
//!
//! A formatter can't tell a line break an author meant from one they didn't, so a line holding
//! only `#` ends a paragraph, and a line that looks laid out by hand keeps its line: a heading, a
//! line with more than one space after its `#` that doesn't go on with a list item, a line with
//! two spaces in a row, and a line that starts with an entry's key or a field and a colon, an
//! entry set aside. A list item starts a line of its own, and the lines under it indented to its
//! first word go on with it.

use profile_engine::is_entry_key;

/// The column a comment's paragraphs fill to.
pub(crate) const WIDTH: usize = 100;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Level {
    /// `# ═══ TITLE ═══…`
    Section,
    /// `# ── Title ──…`
    Subsection,
}

/// A heading's level and title, from a comment's text after its `#`, in Layout's forms or
/// fsc-editor's: a run of `═` (2 or more) or `=` (3 or more) for a section, and of `─` (2 or more)
/// or `-` (3 or more) for a subsection, a space, the title, and a closing run, which the reader
/// skips (fsc-editor, `docs/profile-format.md`).
pub(crate) fn heading(text: &str) -> Option<(Level, &str)> {
    let body = text.trim();
    let first = body.chars().next()?;
    let (level, least, family): (_, _, &[char]) = match first {
        '═' => (Level::Section, 2, &['═', '=']),
        '=' => (Level::Section, 3, &['═', '=']),
        '─' => (Level::Subsection, 2, &['─', '-']),
        '-' => (Level::Subsection, 3, &['─', '-']),
        _ => return None,
    };
    let run = body.chars().take_while(|c| *c == first).count();
    let rest = &body[run * first.len_utf8()..];
    if run < least || !rest.starts_with(' ') {
        return None;
    }
    let mut title = rest.trim();
    if let Some(space) = title.rfind(' ') {
        let tail = &title[space + 1..];
        if tail.chars().all(|c| family.contains(&c)) {
            title = title[..space].trim_end();
        }
    } else if title.chars().all(|c| family.contains(&c)) {
        return None;
    }
    (!title.is_empty()).then_some((level, title))
}

/// A heading as Layout writes it, from its `#`, with its rule running on to `width` columns, as a
/// comment's paragraphs fill to, so a section stands out as a line across the file in any editor.
/// A title too long for that still gets two of the rule's characters.
pub(crate) fn heading_line(level: Level, title: &str, width: usize) -> String {
    let (rule, head) = match level {
        Level::Section => ("═", format!("# ═══ {title} ")),
        Level::Subsection => ("─", format!("# ── {title} ")),
    };
    let fill = width.saturating_sub(head.chars().count()).max(2);
    format!("{head}{}", rule.repeat(fill))
}

/// A line of a comment that only rule characters make, a divider rather than a heading.
fn divider(text: &str) -> bool {
    let body = text.trim();
    body.chars().count() >= 3 && body.chars().all(|c| matches!(c, '═' | '=' | '─' | '-'))
}

/// One line of a comment as the formatter writes it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Written {
    /// From its `#`.
    pub(crate) text: String,
    pub(crate) heading: bool,
}

/// What one line of a comment is.
enum Kind<'a> {
    Break,
    Heading(Level, &'a str),
    Kept,
    /// A list item: its marker, as `- ` or `1. `, and its text.
    Item(&'a str, &'a str),
    /// A line that goes on with the list item above it.
    Continued(&'a str),
    Prose(&'a str),
}

/// A paragraph being gathered: a list item's marker, if it's one, and its words.
struct Paragraph<'a> {
    marker: Option<&'a str>,
    words: Vec<&'a str>,
}

/// The lines of one comment, each its text after its `#`, written as the formatter writes them
/// at `indent`.
pub(crate) fn reflow(texts: &[&str], indent: usize) -> Vec<Written> {
    let width = WIDTH.saturating_sub(indent);
    let mut out = Vec::new();
    let mut open: Option<Paragraph> = None;
    for text in texts {
        let text = text.trim_end();
        let item_width = open
            .as_ref()
            .and_then(|p| p.marker)
            .map(|m| m.chars().count());
        match kind(text, item_width) {
            Kind::Prose(words) => match &mut open {
                Some(p) if p.marker.is_none() => p.words.extend(words.split(' ')),
                _ => {
                    flush(&mut open, width, &mut out);
                    open = Some(Paragraph {
                        marker: None,
                        words: words.split(' ').collect(),
                    });
                }
            },
            Kind::Continued(words) => {
                if let Some(p) = &mut open {
                    p.words.extend(words.split(' '));
                }
            }
            Kind::Item(marker, words) => {
                flush(&mut open, width, &mut out);
                open = Some(Paragraph {
                    marker: Some(marker),
                    words: words.split(' ').filter(|w| !w.is_empty()).collect(),
                });
            }
            Kind::Break => {
                flush(&mut open, width, &mut out);
                out.push(Written {
                    text: "#".into(),
                    heading: false,
                });
            }
            Kind::Heading(level, title) => {
                flush(&mut open, width, &mut out);
                out.push(Written {
                    text: heading_line(level, title, width),
                    heading: true,
                });
            }
            Kind::Kept => {
                flush(&mut open, width, &mut out);
                out.push(Written {
                    text: format!("#{text}"),
                    heading: false,
                });
            }
        }
    }
    flush(&mut open, width, &mut out);
    out
}

/// What a comment's line is, from its text after its `#`. `item` is the width of the marker of a
/// list item it may go on with.
fn kind(text: &str, item: Option<usize>) -> Kind<'_> {
    if text.trim().is_empty() {
        return Kind::Break;
    }
    if let Some((level, title)) = heading(text) {
        return Kind::Heading(level, title);
    }
    if divider(text) {
        return Kind::Kept;
    }
    let Some(line) = text.strip_prefix(' ') else {
        return Kind::Kept;
    };
    let content = line.trim_start();
    if line.len() > content.len() {
        let under_item = item == Some(line.len() - content.len());
        return if under_item && plain_prose(content) {
            Kind::Continued(content)
        } else {
            Kind::Kept
        };
    }
    if !plain_prose(line) {
        return Kind::Kept;
    }
    match marker(line) {
        Some(m) => Kind::Item(&line[..m], &line[m..]),
        None => Kind::Prose(line),
    }
}

/// Whether a line's text reads as prose: no two spaces in a row, as an aligned table has, and no
/// entry's key or field and a colon at its start, as an entry set aside has.
fn plain_prose(text: &str) -> bool {
    if text.contains("  ") {
        return false;
    }
    let set_aside = text
        .split_once(':')
        .is_some_and(|(key, rest)| is_entry_key(key) && (rest.is_empty() || rest.starts_with(' ')));
    !set_aside
}

/// The bytes of a list item's marker, as `- `, `* `, or `12. `, at a line's start.
fn marker(line: &str) -> Option<usize> {
    if line.starts_with("- ") || line.starts_with("* ") {
        return Some(2);
    }
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    (digits > 0 && line[digits..].starts_with(". ")).then_some(digits + 2)
}

/// Writes the open paragraph, filled to `width`, a list item's lines under its first word.
fn flush(open: &mut Option<Paragraph>, width: usize, out: &mut Vec<Written>) {
    let Some(p) = open.take() else {
        return;
    };
    let marker = p.marker.unwrap_or("");
    let first = format!("# {marker}");
    let rest = format!("# {}", " ".repeat(marker.chars().count()));
    let mut line = first;
    let mut empty = true;
    for word in p.words.iter().filter(|w| !w.is_empty()) {
        let fits = line.chars().count() + 1 + word.chars().count() <= width;
        if !empty && !fits {
            out.push(Written {
                text: std::mem::replace(&mut line, rest.clone()),
                heading: false,
            });
            empty = true;
        }
        if !empty {
            line.push(' ');
        }
        line.push_str(word);
        empty = false;
    }
    out.push(Written {
        text: line.trim_end().to_string(),
        heading: false,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(lines: &[Written]) -> Vec<&str> {
        lines.iter().map(|l| l.text.as_str()).collect()
    }

    #[test]
    fn headings_in_fsc_editors_forms_read_as_layouts() {
        assert_eq!(
            heading(" ═══ ELECTRICAL ════════"),
            Some((Level::Section, "ELECTRICAL"))
        );
        assert_eq!(
            heading(" --- Hot Battery Bus ---"),
            Some((Level::Subsection, "Hot Battery Bus"))
        );
        assert_eq!(heading(" === TRIMS ==="), Some((Level::Section, "TRIMS")));
        assert_eq!(
            heading(" ── Breakers"),
            Some((Level::Subsection, "Breakers"))
        );
        assert_eq!(heading(" ════════"), None);
        assert_eq!(heading(" - a list item"), None);
        assert_eq!(heading(" -- two dashes"), None);
    }

    #[test]
    fn a_headings_rule_runs_on_to_the_width_at_its_indent() {
        let lines = reflow(&[" ═══ ELECTRICAL", " --- Breakers ---"], 2);
        assert_eq!(
            lines[0].text,
            format!("# ═══ ELECTRICAL {}", "═".repeat(81))
        );
        assert_eq!(lines[1].text, format!("# ── Breakers {}", "─".repeat(84)));
        assert!(lines.iter().all(|l| l.text.chars().count() == WIDTH - 2));
        let long = "T".repeat(120);
        assert_eq!(
            heading_line(Level::Section, &long, WIDTH),
            format!("# ═══ {long} ══")
        );
    }

    #[test]
    fn a_paragraph_fills_to_the_width_and_a_lone_hash_ends_it() {
        let long = " word".repeat(30);
        let lines = reflow(&[&long, " tail", "", " next"], 0);
        assert!(lines[0].text.chars().count() <= WIDTH);
        assert!(lines[1].text.ends_with("tail"));
        assert_eq!(texts(&lines[2..]), ["#", "# next"]);
    }

    #[test]
    fn a_list_item_reflows_under_its_first_word() {
        let lines = reflow(&[" - one", "   two", " 1. three", "    four"], 0);
        assert_eq!(texts(&lines), ["# - one two", "# 1. three four"]);
    }

    #[test]
    fn lines_laid_out_by_hand_keep_their_lines() {
        let lines = reflow(
            &[
                " prose",
                "   diagram",
                " a  table",
                " watch: L('X')",
                " A known limit: as",
                " goes on",
            ],
            0,
        );
        assert_eq!(
            texts(&lines),
            [
                "# prose",
                "#   diagram",
                "# a  table",
                "# watch: L('X')",
                "# A known limit: as goes on"
            ]
        );
    }
}
