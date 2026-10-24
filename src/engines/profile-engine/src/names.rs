//! Names: the calls through which a profile says what something in the sim is, such as
//! `L('BKSQ_MixtureLeverPosition_1')` or `K('KOHLSMAN_SET', 2)`. A name never acts
//! (record/areas/profiles/01-format-and-delivery.md, "Names").
//!
//! A name is JavaScript, so a write function calls the same `L()` the YAML names a variable
//! with, but the engine reads a name in the YAML itself, since the core, which runs no
//! TypeScript, has to know what each entry watches.

use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Name {
    /// An `L:` variable, in its unit, `Number` when the name gives none.
    L {
        name: String,
        unit: Option<String>,
    },
    /// An `A:` variable, with its index in the name, as `GENERAL ENG THROTTLE LEVER POSITION:1`.
    A {
        name: String,
        unit: String,
    },
    /// An input event: watched, its value; written, the preset its name gives.
    B {
        name: String,
    },
    /// A `K:` event, with the values it sends after the one a write passes.
    K {
        name: String,
        values: Vec<Arg>,
    },
    H {
        name: String,
    },
    /// A value in a gauge's JavaScript: the instrument's key, then a dotted path from its
    /// object.
    Instrument {
        key: String,
        path: String,
    },
}

/// One of a `K:` event's other values: a number, or `value`, the place the written value goes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Arg {
    Number(f64),
    Value,
}

/// What a name names, which decides the fields it may stand in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Variable,
    Event,
    Instrument,
}

impl Name {
    pub(crate) fn kind(&self) -> Kind {
        match self {
            Name::L { .. } | Name::A { .. } => Kind::Variable,
            Name::B { .. } | Name::K { .. } | Name::H { .. } => Kind::Event,
            Name::Instrument { .. } => Kind::Instrument,
        }
    }

    /// The call's letter and the name it gives, which two entries watching one thing share
    /// whatever their units.
    pub(crate) fn identity(&self) -> (char, String) {
        match self {
            Name::L { name, .. } => ('L', name.clone()),
            Name::A { name, .. } => ('A', name.clone()),
            Name::B { name } => ('B', name.clone()),
            Name::K { name, .. } => ('K', name.clone()),
            Name::H { name } => ('H', name.clone()),
            Name::Instrument { key, path } => ('I', format!("{key}.{path}")),
        }
    }

    /// Whether a write passes its value into one of the name's own values.
    pub fn takes_value(&self) -> bool {
        matches!(self, Name::K { values, .. } if values.contains(&Arg::Value))
    }
}

/// Why a text isn't a name, said to the author.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct NotAName(pub(crate) String);

/// Whether a text is meant as a name: one of the calls, then `(`. A text that isn't, such as
/// `(value) => …`, is a function.
pub(crate) fn looks_like_name(text: &str) -> bool {
    let text = text.trim();
    ["L", "A", "B", "K", "H", "instrument"].iter().any(|call| {
        text.strip_prefix(call)
            .is_some_and(|rest| rest.trim_start().starts_with('('))
    })
}

pub(crate) fn parse(text: &str) -> Result<Name, NotAName> {
    let mut p = Parser {
        chars: text.trim().chars().collect(),
        at: 0,
    };
    let call = p.ident();
    p.space();
    if !p.eat('(') {
        return Err(NotAName(format!("`{}` isn't a name", text.trim())));
    }
    let mut args = Vec::new();
    p.space();
    if !p.eat(')') {
        loop {
            p.space();
            args.push(p.arg()?);
            p.space();
            if p.eat(')') {
                break;
            }
            if !p.eat(',') {
                return Err(NotAName(format!(
                    "`{}` needs a comma or `)` after each value",
                    text.trim()
                )));
            }
        }
    }
    p.space();
    if p.at != p.chars.len() {
        return Err(NotAName(format!(
            "`{}` has more after its `)`",
            text.trim()
        )));
    }
    build(&call, args)
}

#[derive(Debug)]
enum Raw {
    Str(String),
    Number(f64),
    Value,
}

fn build(call: &str, args: Vec<Raw>) -> Result<Name, NotAName> {
    let mut args = args.into_iter();
    let Some(Raw::Str(name)) = args.next() else {
        return Err(NotAName(format!(
            "`{call}()` takes the name first, in quotes"
        )));
    };
    let rest: Vec<Raw> = args.collect();
    let unit = |rest: &[Raw]| -> Result<Option<String>, NotAName> {
        match rest {
            [] => Ok(None),
            [Raw::Str(unit)] => Ok(Some(unit.clone())),
            _ => Err(NotAName(format!(
                "`{call}()` takes a name and a unit, in quotes"
            ))),
        }
    };
    let none = |rest: &[Raw]| -> Result<(), NotAName> {
        match rest {
            [] => Ok(()),
            [Raw::Str(_), ..] => Err(NotAName(format!("`{call}()` takes no unit"))),
            _ => Err(NotAName(format!("`{call}()` takes only its name"))),
        }
    };
    match call {
        "L" => Ok(Name::L {
            name,
            unit: unit(&rest)?,
        }),
        "A" => match unit(&rest)? {
            Some(unit) => Ok(Name::A { name, unit }),
            None => Err(NotAName(
                "`A()` takes a unit every time, since the unit sets the scale".into(),
            )),
        },
        "B" => none(&rest).map(|()| Name::B { name }),
        "H" => none(&rest).map(|()| Name::H { name }),
        "K" => {
            let mut values = Vec::new();
            for arg in rest {
                values.push(match arg {
                    Raw::Number(n) => Arg::Number(n),
                    Raw::Value => {
                        if values.contains(&Arg::Value) {
                            return Err(NotAName("`value` goes in a name at most once".into()));
                        }
                        Arg::Value
                    }
                    Raw::Str(_) => return Err(NotAName("`K()` takes no unit".into())),
                });
            }
            Ok(Name::K { name, values })
        }
        "instrument" => match rest.as_slice() {
            [Raw::Str(path)] => {
                if !instrument_path(path) {
                    return Err(NotAName(format!(
                        "`{path}` is a path of names and whole numbers separated by dots, such as `config.range`"
                    )));
                }
                Ok(Name::Instrument {
                    key: name,
                    path: path.clone(),
                })
            }
            _ => Err(NotAName(
                "`instrument()` takes the instrument's key and a dotted path, each in quotes"
                    .into(),
            )),
        },
        _ => Err(NotAName(format!("`{call}` isn't a name"))),
    }
}

/// A path of identifiers and whole numbers separated by dots, so nothing in it calls a method.
fn instrument_path(path: &str) -> bool {
    !path.is_empty()
        && path.split('.').all(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(c) if c.is_ascii_digit() => part.chars().all(|c| c.is_ascii_digit()),
                Some(c) if c.is_ascii_alphabetic() || c == '_' || c == '$' => {
                    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
                }
                _ => false,
            }
        })
}

struct Parser {
    chars: Vec<char>,
    at: usize,
}

impl Parser {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.at).copied()
    }

    fn eat(&mut self, c: char) -> bool {
        if self.peek() == Some(c) {
            self.at += 1;
            true
        } else {
            false
        }
    }

    fn space(&mut self) {
        while self.peek().is_some_and(char::is_whitespace) {
            self.at += 1;
        }
    }

    fn ident(&mut self) -> String {
        let start = self.at;
        while self
            .peek()
            .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            self.at += 1;
        }
        self.chars[start..self.at].iter().collect()
    }

    fn arg(&mut self) -> Result<Raw, NotAName> {
        match self.peek() {
            Some(q @ ('\'' | '"')) => {
                self.at += 1;
                let mut s = String::new();
                loop {
                    match self.peek() {
                        None => return Err(NotAName("A quoted name never ends".into())),
                        Some(c) if c == q => {
                            self.at += 1;
                            return Ok(Raw::Str(s));
                        }
                        Some('\\') => {
                            self.at += 1;
                            match self.peek() {
                                Some(c @ ('\\' | '\'' | '"')) => s.push(c),
                                _ => {
                                    return Err(NotAName(
                                        "In a name's quotes, `\\` goes only before `\\`, `'`, or `\"`"
                                            .into(),
                                    ));
                                }
                            }
                            self.at += 1;
                        }
                        Some(c) => {
                            s.push(c);
                            self.at += 1;
                        }
                    }
                }
            }
            Some(c) if c.is_ascii_digit() || c == '-' || c == '.' => {
                let start = self.at;
                self.at += 1;
                while self
                    .peek()
                    .is_some_and(|c| c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '-' | '+'))
                {
                    self.at += 1;
                }
                let text: String = self.chars[start..self.at].iter().collect();
                text.parse::<f64>()
                    .ok()
                    .filter(|n| n.is_finite())
                    .map(Raw::Number)
                    .ok_or_else(|| NotAName(format!("`{text}` isn't a number")))
            }
            _ => {
                let word = self.ident();
                if word == "value" {
                    Ok(Raw::Value)
                } else {
                    Err(NotAName(format!(
                        "A name's values are text in quotes, numbers, or `value`, not `{word}`"
                    )))
                }
            }
        }
    }
}

/// Writes a JavaScript string in single quotes.
fn quoted(s: &str) -> String {
    let mut out = String::from("'");
    for c in s.chars() {
        if matches!(c, '\'' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('\'');
    out
}

impl fmt::Display for Name {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Name::L { name, unit: None } => write!(f, "L({})", quoted(name)),
            Name::L {
                name,
                unit: Some(unit),
            } => write!(f, "L({}, {})", quoted(name), quoted(unit)),
            Name::A { name, unit } => write!(f, "A({}, {})", quoted(name), quoted(unit)),
            Name::B { name } => write!(f, "B({})", quoted(name)),
            Name::H { name } => write!(f, "H({})", quoted(name)),
            Name::K { name, values } => {
                write!(f, "K({}", quoted(name))?;
                for v in values {
                    match v {
                        Arg::Number(n) => write!(f, ", {n}")?,
                        Arg::Value => write!(f, ", value")?,
                    }
                }
                write!(f, ")")
            }
            Name::Instrument { key, path } => {
                write!(f, "instrument({}, {})", quoted(key), quoted(path))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_call_reads_and_writes_back_the_same() {
        for text in [
            "L('BKSQ_MixtureLeverPosition_1')",
            "L('X', 'Bool')",
            "A('GENERAL ENG THROTTLE LEVER POSITION:1', 'Percent')",
            "B('ELECTRICAL_Battery_1_Toggle')",
            "K('KOHLSMAN_SET', 2)",
            "K('SOME_EVENT', 3, value)",
            "H('bksq_wradar1_radarAlertToggle')",
            "instrument('KNS81', 'waypoints.0.frequency')",
            "L('it\\'s')",
        ] {
            let name = parse(text).unwrap_or_else(|e| panic!("{text}: {}", e.0));
            assert_eq!(name.to_string(), text);
        }
    }

    #[test]
    fn a_unit_where_a_name_takes_none_or_none_on_a_is_an_error() {
        assert!(parse("H('X', 'Bool')").is_err());
        assert!(parse("K('X', 'Bool')").is_err());
        assert!(parse("A('PLANE ALTITUDE')").is_err());
        assert!(parse("K('X', value, value)").is_err());
    }

    #[test]
    fn an_instrument_path_calls_nothing() {
        assert!(parse("instrument('KNS81', 'getWaypoint()')").is_err());
        assert!(parse("instrument('KNS81', 'a..b')").is_err());
    }

    #[test]
    fn a_function_isnt_a_name() {
        assert!(!looks_like_name("(value) => { write(L('X'), value) }"));
        assert!(looks_like_name("L('X'"));
    }
}
