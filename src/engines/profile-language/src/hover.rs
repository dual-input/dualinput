//! Hovers outside scripts (record/areas/profiles/03-the-extension.md, "Completion and hovers"): on
//! a field, its description and whether it's required, and on a variant ID, the SimObjects
//! folders or presets it covers. Inside a script, the server asks TypeScript.

use crate::complete::{field_at, parents, variant_ids};
use crate::outline::{self, Head, Outline, flow_items, indent_of};
use crate::{Pos, Range};

/// What a hover at `at` shows, in Markdown, and the text it's on.
pub fn hover(text: &str, at: Pos) -> Option<(String, Range)> {
    let o = outline::parse(text);
    let l = at.line.checked_sub(1)?;
    let line = o.line(l);
    let indent = indent_of(line);
    let path = parents(&o, l, indent)?;
    let p: Vec<&str> = path.iter().map(String::as_str).collect();
    let column = at.column.checked_sub(1)?;
    let on = |token: &outline::Token| {
        column >= token.column && column <= token.column + token.raw.chars().count()
    };
    match outline::head(line, indent).0 {
        Head::Key { key, value } => {
            let name = key.text().unwrap_or_else(|| key.raw.clone());
            if on(&key) {
                let range = key.range(l);
                let by_variant = matches!(p.as_slice(), ["aircraft", "variants"])
                    || matches!(p.as_slice(), ["state" | "events", _, "location"]);
                if by_variant {
                    return variant(&o, &name).map(|m| (m, range));
                }
                let field = field_at(&p, &name)?;
                let required = if field.required {
                    "Required."
                } else {
                    "Optional."
                };
                return Some((format!("**{name}**: {}\n\n{required}", field.about), range));
            }
            let value = value.filter(|v| on(v) && name == "only")?;
            variant_in(&o, &value, l, column)
        }
        Head::Dash { value: Some(value) } if p.last() == Some(&"only") && on(&value) => {
            variant_in(&o, &value, l, column)
        }
        _ => None,
    }
}

/// The hover on the variant ID at `column` of a value, one ID or a list of them in brackets.
fn variant_in(
    o: &Outline,
    value: &outline::Token,
    l: usize,
    column: usize,
) -> Option<(String, Range)> {
    let Some(items) = flow_items(&value.raw) else {
        let id = value.text()?;
        return variant(o, &id).map(|m| (m, value.range(l)));
    };
    // Each item's place in the value, found in its order.
    let mut from = 0;
    for item in items {
        let offset = value.raw[from..].find(&item)? + from;
        from = offset + item.len();
        let start = value.column + value.raw[..offset].chars().count();
        let end = start + item.chars().count();
        if column >= start && column <= end {
            let id = outline::unquote(&item)?;
            let range = Range::new(Pos::new(l + 1, start + 1), Pos::new(l + 1, end + 1));
            return variant(o, &id).map(|m| (m, range));
        }
    }
    None
}

/// What a variant covers, in Markdown, if the profile has it.
fn variant(o: &Outline, id: &str) -> Option<String> {
    if !variant_ids(o).iter().any(|v| v == id) {
        return None;
    }
    let item = o.top("aircraft")?.child("variants")?.child(id)?;
    let paths: Vec<String> = match item.value() {
        Some(v) => flow_items(&v.raw)
            .map(|items| items.iter().filter_map(|i| outline::unquote(i)).collect())
            .or_else(|| v.text().map(|t| vec![t]))
            .unwrap_or_default(),
        None => item
            .children
            .iter()
            .filter_map(|c| c.value()?.text())
            .collect(),
    };
    let listed: Vec<String> = paths.iter().map(|p| format!("`{p}`")).collect();
    Some(format!("**{id}** covers {}", listed.join(", ")))
}
