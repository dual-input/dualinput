//! A script's JavaScript in one layout, written by dprint-plugin-typescript, Deno's formatter as a
//! library (record/areas/profiles/03-the-extension.md, "Scripts"): 2 spaces to a level, single
//! quotes but for a string that holds more of them than of double quotes, and no semicolons, as the
//! 58P's scripts are written.
//!
//! A `return` or a `write()` at the end of an `if`'s line is easy to miss, and a profile that many
//! authors edit breaks in part when a reader misses one. So every `if`, `else`, `for`, and `while`
//! body takes braces, on lines of its own, and every arrow function's parameters take parentheses,
//! as in `(value) =>`.

use std::path::Path;

use dprint_plugin_typescript::configuration::{
    Configuration, ConfigurationBuilder, QuoteStyle, SameOrNextLinePosition, Semicolons, UseBraces,
    UseParentheses,
};
use dprint_plugin_typescript::{FormatTextOptions, format_text};

/// A script is a function on its own, an expression statement that starts with `(`, which dprint
/// writes without semicolons as `;((value) => …)`, against a line above running into it. As an
/// assignment's value it needs neither, so the formatter formats it after this and takes it off.
const AS_VALUE: &str = "x = ";

/// The script with its lines kept to `width` columns, and no line break after its last, or none
/// when it doesn't parse as an expression, as while it's being typed.
pub(crate) fn format_script(text: &str, width: usize) -> Option<String> {
    let width = u32::try_from(width).ok()?;
    run(text, &style().line_width(width).build())
}

/// The script as the formatter's same-profile check compares it before and after: the same text
/// however its lines were broken, since dprint joins whatever fits on one line of any length.
pub(crate) fn canonical_script(text: &str) -> Option<String> {
    run(
        text,
        &style()
            .line_width(u32::MAX / 2)
            .prefer_single_line(true)
            .build(),
    )
}

fn style() -> ConfigurationBuilder {
    let mut builder = ConfigurationBuilder::new();
    builder
        .indent_width(2)
        .quote_style(QuoteStyle::PreferSingle)
        .semicolons(Semicolons::Asi)
        .arrow_function_use_parentheses(UseParentheses::Force)
        // Braces alone leave `if (x) { return }` on one line, so the body moves to the next.
        .if_statement_use_braces(UseBraces::Always)
        .if_statement_single_body_position(SameOrNextLinePosition::NextLine)
        .for_statement_use_braces(UseBraces::Always)
        .for_statement_single_body_position(SameOrNextLinePosition::NextLine)
        .for_in_statement_use_braces(UseBraces::Always)
        .for_in_statement_single_body_position(SameOrNextLinePosition::NextLine)
        .for_of_statement_use_braces(UseBraces::Always)
        .for_of_statement_single_body_position(SameOrNextLinePosition::NextLine)
        .while_statement_use_braces(UseBraces::Always)
        .while_statement_single_body_position(SameOrNextLinePosition::NextLine);
    builder
}

fn run(text: &str, config: &Configuration) -> Option<String> {
    let source = format!("{AS_VALUE}{}", text.trim());
    let out = format_text(FormatTextOptions {
        path: Path::new("script.js"),
        extension: None,
        text: source.as_str().into(),
        config,
        external_formatter: None,
        arena_pool: None,
    })
    .ok()?
    .unwrap_or(source);
    // A value dprint moves to the line below the `=` would leave the script's first line out of
    // place, so the script stays as typed.
    let script = out.strip_prefix(AS_VALUE)?.trim_end();
    (!script.is_empty()).then(|| script.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_script_takes_the_layout_and_one_that_doesnt_parse_takes_none() {
        let messy = "(value) => {\n    while (state.standby_battery === 2) {\n\n  write(B('X'), value).every(\"1 frame\");\n      }\n    }\n";
        assert_eq!(
            format_script(messy, 94).as_deref(),
            Some(
                "(value) => {\n  while (state.standby_battery === 2) {\n    write(B('X'), value).every('1 frame')\n  }\n}"
            )
        );
        assert_eq!(
            format_script("(value) => write(L(\"it's\"), value)", 94).as_deref(),
            Some("(value) => write(L(\"it's\"), value)")
        );
        assert_eq!(format_script("(value) => {\n  write(\n", 94), None);
    }

    #[test]
    fn every_body_takes_braces_on_lines_of_its_own_and_every_arrow_takes_parentheses() {
        let early = "(value) => {\n  if (value == state.starter) return\n  write(K('A'))\n}";
        assert_eq!(
            format_script(early, 94).as_deref(),
            Some(
                "(value) => {\n  if (value == state.starter) {\n    return\n  }\n  write(K('A'))\n}"
            )
        );
        let chain = "(value) => {\n  if (value == 0) write(K('A'))\n  else if (value == 19) write(K('B'))\n  else write(K('C'))\n}";
        assert_eq!(
            format_script(chain, 94).as_deref(),
            Some(
                "(value) => {\n  if (value == 0) {\n    write(K('A'))\n  } else if (value == 19) {\n    write(K('B'))\n  } else {\n    write(K('C'))\n  }\n}"
            )
        );
        let nested = "(value) => {\n  if (value) { if (state.mode == 3) write(H('X')) }\n}";
        assert_eq!(
            format_script(nested, 94).as_deref(),
            Some(
                "(value) => {\n  if (value) {\n    if (state.mode == 3) {\n      write(H('X'))\n    }\n  }\n}"
            )
        );
        let loops = "(value) => {\n  while (state.a > value) write(K('DEC'))\n  for (const k of [1, 2]) write(L('X'), k)\n}";
        assert_eq!(
            format_script(loops, 94).as_deref(),
            Some(
                "(value) => {\n  while (state.a > value) {\n    write(K('DEC'))\n  }\n  for (const k of [1, 2]) {\n    write(L('X'), k)\n  }\n}"
            )
        );
        assert_eq!(
            format_script("value => write(L('A'), value)", 94).as_deref(),
            Some("(value) => write(L('A'), value)")
        );
    }

    #[test]
    fn a_line_past_its_width_breaks_and_the_canonical_form_joins_it_again() {
        let long =
            "(value) => write(L('BKSQ_MixtureLeverPosition_1'), value * 100 + state.mixture_2 * 2)";
        let narrow = format_script(long, 60).expect("it parses");
        assert!(narrow.contains('\n'), "{narrow}");
        assert!(narrow.lines().all(|l| l.chars().count() <= 60), "{narrow}");
        assert_eq!(canonical_script(&narrow), canonical_script(long));
    }
}
