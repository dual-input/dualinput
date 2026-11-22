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
    /// object. It reads a number unless `text`, which `'string'` after the path gives, so a
    /// write function compares it with no conversion
    /// (record/areas/plugins/01-plugins.md, "Its values").
    Instrument {
        key: String,
        path: String,
        text: bool,
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

/// One of the calls a name is made with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Call {
    L,
    A,
    B,
    K,
    H,
    Instrument,
}

impl Call {
    /// Every call, in the order the format's documents list them.
    pub const ALL: [Call; 6] = [
        Call::L,
        Call::A,
        Call::B,
        Call::K,
        Call::H,
        Call::Instrument,
    ];

    /// The call's function, as a profile writes it.
    pub fn word(self) -> &'static str {
        match self {
            Call::L => "L",
            Call::A => "A",
            Call::B => "B",
            Call::K => "K",
            Call::H => "H",
            Call::Instrument => "instrument",
        }
    }

    /// The call with the texts it needs left empty, as `A('', '')`, since `A()` takes a unit
    /// every time and `instrument()` a path, for an editor to fill in.
    pub fn blank(self) -> &'static str {
        match self {
            Call::L => "L('')",
            Call::A => "A('', '')",
            Call::B => "B('')",
            Call::K => "K('')",
            Call::H => "H('')",
            Call::Instrument => "instrument('', '')",
        }
    }
}

/// Which names a field takes: the checker refuses any other there, and an editor offers only
/// these. Each field's table in blocks.rs says which one it takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Allowed {
    /// A state entry's `watch`: a variable, an input event, or an `instrument()` value.
    StateWatch,
    /// An event entry's `watch`: an event, or an `L:` variable as a pulse.
    EventWatch,
    /// A `write` that's a name.
    Write,
    /// A field that sends an event, such as `toggle` or `inc`.
    Event,
    /// A counting watch's `count`.
    Variable,
    Ignore,
}

impl Allowed {
    /// The calls it takes, in `Call::ALL`'s order.
    pub fn calls(self) -> &'static [Call] {
        match self {
            Allowed::StateWatch => &[Call::L, Call::A, Call::B, Call::Instrument],
            Allowed::EventWatch => &[Call::L, Call::B, Call::K, Call::H],
            Allowed::Write | Allowed::Ignore => &[Call::L, Call::A, Call::B, Call::K, Call::H],
            Allowed::Event => &[Call::B, Call::K, Call::H],
            Allowed::Variable => &[Call::L, Call::A],
        }
    }

    /// Why the field refuses `name`, said to the author, or nothing when it takes it.
    pub(crate) fn refuses(self, name: &Name) -> Option<String> {
        if self.calls().contains(&name.call()) {
            return None;
        }
        Some(match self {
            Allowed::StateWatch => format!(
                "a state entry watches a variable, an input event, or an instrument() value, and {name} is an event, which an event entry watches"
            ),
            Allowed::EventWatch => format!(
                "an event entry watches a K:, H:, or B: event, or an L: variable as a pulse, and {name} isn't one"
            ),
            Allowed::Write | Allowed::Ignore => {
                "instrument() can be watched but never written or ignored; write the gauge through its H: events".to_string()
            }
            Allowed::Event => format!("this takes an event, K(), H(), or B(), and {name} isn't one"),
            Allowed::Variable => format!("this takes a variable, L() or A(), and {name} isn't one"),
        })
    }
}

impl Name {
    pub(crate) fn kind(&self) -> Kind {
        match self {
            Name::L { .. } | Name::A { .. } => Kind::Variable,
            Name::B { .. } | Name::K { .. } | Name::H { .. } => Kind::Event,
            Name::Instrument { .. } => Kind::Instrument,
        }
    }

    /// The call the name is made with.
    pub fn call(&self) -> Call {
        match self {
            Name::L { .. } => Call::L,
            Name::A { .. } => Call::A,
            Name::B { .. } => Call::B,
            Name::K { .. } => Call::K,
            Name::H { .. } => Call::H,
            Name::Instrument { .. } => Call::Instrument,
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
            Name::Instrument { key, path, .. } => ('I', format!("{key}.{path}")),
        }
    }

    /// Whether a write passes its value into one of the name's own values.
    pub fn takes_value(&self) -> bool {
        matches!(self, Name::K { values, .. } if values.contains(&Arg::Value))
    }
}

/// Whether a key a profile names opts in an instrument by its key: a bare identifier, such as
/// `FCP`, names every instrument that carries it, whatever its url's query, and a full key names
/// exactly that instrument (record/areas/profiles/01-format-and-delivery.md, "Displays").
pub fn key_names(named: &str, instrument: &str) -> bool {
    if named.contains('|') {
        named == instrument
    } else {
        instrument.split('|').next() == Some(named)
    }
}

/// Why a text isn't a name, said to the author.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct NotAName(pub(crate) String);

/// Whether a text is meant as a name: one of the calls, then `(`. A text that isn't, such as
/// `(value) => …`, is a function.
pub(crate) fn looks_like_name(text: &str) -> bool {
    let text = text.trim();
    Call::ALL.iter().any(|call| {
        text.strip_prefix(call.word())
            .is_some_and(|rest| rest.trim_start().starts_with('('))
    })
}

/// The name a text writes, such as `K("X", 2)`, or none for a text that isn't one, for an editor
/// to write it again in single quotes through `Display`, as the checker's `quotes` error shows it.
pub fn read_name(text: &str) -> Option<Name> {
    looks_like_name(text)
        .then(|| parse(text).ok())
        .flatten()
        .map(|p| p.name)
}

/// A name as the text writes it.
pub(crate) struct Parsed {
    pub(crate) name: Name,
    /// Where each of its texts written in double quotes starts, in characters from the start of
    /// the text it was read from, for the checker's error on double quotes outside a script.
    pub(crate) double: Vec<usize>,
}

pub(crate) fn parse(text: &str) -> Result<Parsed, NotAName> {
    let lead = text.chars().take_while(|c| c.is_whitespace()).count();
    let mut p = Parser {
        chars: text.trim().chars().collect(),
        at: 0,
        double: Vec::new(),
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
    Ok(Parsed {
        name: build(&call, args)?,
        double: p.double.iter().map(|at| lead + at).collect(),
    })
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
        "instrument" => {
            let (path, text) = match rest.as_slice() {
                [Raw::Str(path)] => (path, false),
                [Raw::Str(path), Raw::Str(kind)] if kind.eq_ignore_ascii_case("string") => {
                    (path, true)
                }
                [Raw::Str(_), _] => {
                    return Err(NotAName(
                        "`instrument()` takes `'string'` after its path, for a value that's text, and nothing else there"
                            .into(),
                    ));
                }
                _ => {
                    return Err(NotAName(
                        "`instrument()` takes the instrument's key and a dotted path, each in quotes, and `'string'` for a value that's text"
                            .into(),
                    ));
                }
            };
            if !instrument_path(path) {
                return Err(NotAName(format!(
                    "`{path}` is a path of names and whole numbers separated by dots, such as `config.range`"
                )));
            }
            Ok(Name::Instrument {
                key: name,
                path: path.clone(),
                text,
            })
        }
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
    /// Where each text in double quotes starts.
    double: Vec<usize>,
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
                if q == '"' {
                    self.double.push(self.at);
                }
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
            Name::Instrument { key, path, text } => {
                write!(f, "instrument({}, {}", quoted(key), quoted(path))?;
                if *text {
                    write!(f, ", 'string'")?;
                }
                write!(f, ")")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> Result<Name, NotAName> {
        super::parse(text).map(|p| p.name)
    }

    #[test]
    fn a_text_in_double_quotes_is_found_where_it_starts() {
        let p = super::parse(" K(\"X\", 2, value)").expect("a name");
        assert_eq!(p.double, [3]);
        assert_eq!(p.name.to_string(), "K('X', 2, value)");
        let p = super::parse("A('X', \"Bool\")").expect("a name");
        assert_eq!(p.double, [7]);
        assert!(super::parse("L('X')").expect("a name").double.is_empty());
    }

    #[test]
    fn each_field_takes_the_calls_its_rule_names() {
        let k = parse("K('X')").expect("a name");
        let i = parse("instrument('G', 'a')").expect("a name");
        assert!(Allowed::StateWatch.refuses(&k).is_some());
        assert!(Allowed::StateWatch.refuses(&i).is_none());
        assert!(Allowed::EventWatch.refuses(&k).is_none());
        assert!(Allowed::Write.refuses(&i).is_some());
        assert_eq!(Allowed::Event.calls(), [Call::B, Call::K, Call::H]);
    }

    #[test]
    fn a_bare_identifier_names_every_instrument_that_carries_it_and_a_full_key_names_one() {
        assert!(key_names("DisplayUnits", "DisplayUnits|config=N324DU"));
        assert!(key_names("BlackSquareTablet", "BlackSquareTablet"));
        assert!(!key_names(
            "DisplayUnits|config=Default",
            "DisplayUnits|config=N324DU"
        ));
        assert!(key_names("CTP|side=left", "CTP|side=left"));
        assert!(!key_names("CTP|side=left", "CTP|side=right"));
        assert!(!key_names("Display", "DisplayUnits"));
    }

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
            "instrument('KNS81', 'waypoints.0.ident', 'string')",
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
    fn an_instrument_reads_a_number_or_with_string_text() {
        let number = parse("instrument('KR87A', 'bfoMode')").expect("a name");
        assert!(matches!(number, Name::Instrument { text: false, .. }));
        let text = parse("instrument('KR87A', 'ident', 'String')").expect("a name");
        assert!(matches!(text, Name::Instrument { text: true, .. }));
        assert!(parse("instrument('KR87A', 'bfoMode', 'Bool')").is_err());
        assert!(parse("instrument('KR87A', 'bfoMode', 2)").is_err());
    }

    #[test]
    fn a_name_read_from_its_text_writes_again_in_single_quotes() {
        let name = read_name("K(\"X\", 2, value)").expect("a name");
        assert_eq!(name.to_string(), "K('X', 2, value)");
        assert_eq!(
            read_name("L(\"it's\")").expect("a name").to_string(),
            "L('it\\'s')"
        );
        assert!(read_name("(value) => write(L('X'), value)").is_none());
        assert!(read_name("L('X'").is_none());
    }

    #[test]
    fn a_function_isnt_a_name() {
        assert!(!looks_like_name("(value) => { write(L('X'), value) }"));
        assert!(looks_like_name("L('X'"));
    }
}
