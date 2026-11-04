//! Template parameters and macros in text: `#NAME#` takes the value of the parameter `NAME`
//! in scope, and `@Name` the value of the macro `Name`, which can name parameters and macros
//! of its own (documented, [Model Behaviors Parameters](https://docs.flightsimulator.com/msfs2024/retail/content-configuration/models/modelbehaviors/usingbehaviours/model-behaviors-parameters/)).

/// How deep macros may name macros before the expansion stops, against a macro that names
/// itself.
const DEEPEST: u32 = 16;

/// How many bytes the values one expansion takes in may add up to. `DEEPEST` alone lets a macro
/// that names another 10 times, and so on down, run 10^16 times. A name past this stays as
/// written, so its code fails to compile, as any name that isn't known does.
const MOST_BYTES: usize = 1 << 20;

/// `text` with each `#NAME#` that `param` knows and each `@Name` that `mac` knows replaced by
/// its value, expanded in turn. A name neither knows stays as written, so code that still
/// holds one fails to compile, and says which.
pub fn expand<'a>(
    text: &str,
    param: &dyn Fn(&str) -> Option<&'a str>,
    mac: &dyn Fn(&str) -> Option<&'a str>,
) -> String {
    let mut left = MOST_BYTES;
    expand_at(text, param, mac, 0, &mut left)
}

/// Takes `value` out of what's `left`, counting an empty one too, if it fits.
fn spend(left: &mut usize, value: &str) -> bool {
    let cost = value.len() + 1;
    let fits = *left >= cost;
    if fits {
        *left -= cost;
    }
    fits
}

fn expand_at<'a>(
    text: &str,
    param: &dyn Fn(&str) -> Option<&'a str>,
    mac: &dyn Fn(&str) -> Option<&'a str>,
    depth: u32,
    left: &mut usize,
) -> String {
    if depth > DEEPEST || (!text.contains('#') && !text.contains('@')) {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(['#', '@']) {
        out.push_str(&rest[..at]);
        let marker = rest.as_bytes()[at];
        let after = &rest[at + 1..];
        if marker == b'#' {
            let name_len = after
                .find(|c: char| !is_param_char(c))
                .unwrap_or(after.len());
            let name = &after[..name_len];
            if !name.is_empty()
                && after[name_len..].starts_with('#')
                && let Some(value) = param(name)
                && spend(left, value)
            {
                out.push_str(&expand_at(value, param, mac, depth + 1, left));
                rest = &after[name_len + 1..];
                continue;
            }
        } else {
            let name_len = after
                .find(|c: char| !is_macro_char(c))
                .unwrap_or(after.len());
            let name = &after[..name_len];
            if let Some(value) = (!name.is_empty()).then(|| mac(name)).flatten()
                && spend(left, value)
            {
                out.push_str(&expand_at(value, param, mac, depth + 1, left));
                rest = &after[name_len..];
                continue;
            }
        }
        out.push(marker as char);
        rest = after;
    }
    out.push_str(rest);
    out
}

/// A parameter's name holds letters, digits, `_`, and `-`.
fn is_param_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}

fn is_macro_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}
