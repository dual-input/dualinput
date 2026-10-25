//! Turning code into a program: its words in order, each `if{`, `els{`, and goto resolved to
//! the place it jumps to, and each variable read or written to its place in the program's
//! list of variables.

use serde::{Deserialize, Serialize};

use crate::{Error, Var};

/// Compiled code, which `run` runs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Program {
    pub(crate) ops: Vec<Op>,
    /// Every variable it names, each once, in the order the code first names them.
    pub vars: Vec<Var>,
    /// Whether it writes a variable a run keeps, which then holds its value from one run to
    /// the next, as the Baron's wing flex filters its own `O:` variables from frame to frame
    /// (record/areas/avatars/decisions.md, "The model is posed only from code in the
    /// aircraft's own files").
    pub keeps_state: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) enum Op {
    Number(f64),
    Text(String),
    Read(u32),
    Write(u32),
    /// An event, `(>K:...)`, `(>H:...)`, or an input event's `(>B:...)`, which posing never
    /// sends, and which takes nothing from the stack, since how many values an event takes
    /// isn't in the code.
    Event,
    Word(Word),
    /// Pops the condition, and jumps to the place when it's false.
    IfNot(u32),
    Jump(u32),
    /// Stores the top in a register; `pop` also pops it.
    Store {
        register: u8,
        pop: bool,
    },
    Load(u8),
    Quit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum Word {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    PMod,
    Inc,
    Dec,
    Neg,
    Eq,
    Ne,
    Gt,
    Lt,
    Ge,
    Le,
    Choose,
    BitAnd,
    BitOr,
    BitXor,
    BitNot,
    ShiftRight,
    ShiftLeft,
    Not,
    And,
    Or,
    Abs,
    Int,
    Floor,
    Ceil,
    Near,
    Range,
    Cos,
    Sin,
    Tan,
    Cot,
    Acos,
    Asin,
    Atan,
    Atan2,
    Log10,
    Ln,
    Log,
    Sqr,
    Sqrt,
    Eps,
    Pi,
    Exp,
    Min,
    Max,
    Pow,
    Sign,
    Fraction,
    IntDiv,
    NormDegrees,
    WholeDegrees,
    RadToDeg,
    DegToRad,
    NormRadians,
    Case,
    Seed,
    Rand,
    Lower,
    Upper,
    Chr,
    Ord,
    Concat,
    FindChar,
    Compare,
    CompareCaseless,
    Length,
    Find,
    Substring,
    Symbol,
    Backup,
    Clear,
    Duplicate,
    Pop,
    Swap,
}

/// The SDK's words, each as written, lowercase.
const WORDS: &[(&str, Word)] = &[
    ("+", Word::Add),
    ("-", Word::Sub),
    ("*", Word::Mul),
    ("/", Word::Div),
    ("%", Word::Mod),
    ("pmod", Word::PMod),
    ("++", Word::Inc),
    ("--", Word::Dec),
    ("/-/", Word::Neg),
    ("neg", Word::Neg),
    ("==", Word::Eq),
    ("eq", Word::Eq),
    ("!=", Word::Ne),
    ("ne", Word::Ne),
    (">", Word::Gt),
    ("gt", Word::Gt),
    ("<", Word::Lt),
    ("lt", Word::Lt),
    (">=", Word::Ge),
    ("ge", Word::Ge),
    ("<=", Word::Le),
    ("le", Word::Le),
    ("?", Word::Choose),
    ("&", Word::BitAnd),
    ("|", Word::BitOr),
    ("^", Word::BitXor),
    ("~", Word::BitNot),
    (">>", Word::ShiftRight),
    ("<<", Word::ShiftLeft),
    ("!", Word::Not),
    ("not", Word::Not),
    ("&&", Word::And),
    ("and", Word::And),
    ("||", Word::Or),
    ("or", Word::Or),
    ("abs", Word::Abs),
    ("int", Word::Int),
    ("flr", Word::Floor),
    ("ceil", Word::Ceil),
    ("near", Word::Near),
    ("rng", Word::Range),
    ("cos", Word::Cos),
    ("sin", Word::Sin),
    ("tg", Word::Tan),
    ("ctg", Word::Cot),
    ("acos", Word::Acos),
    ("asin", Word::Asin),
    ("atg", Word::Atan),
    ("atg2", Word::Atan2),
    ("lg", Word::Log10),
    ("ln", Word::Ln),
    ("log", Word::Log),
    ("sqr", Word::Sqr),
    ("sqrt", Word::Sqrt),
    ("eps", Word::Eps),
    ("pi", Word::Pi),
    ("exp", Word::Exp),
    ("min", Word::Min),
    ("max", Word::Max),
    ("pow", Word::Pow),
    ("sign", Word::Sign),
    ("dec", Word::Fraction),
    ("div", Word::IntDiv),
    ("dnor", Word::NormDegrees),
    ("d360", Word::WholeDegrees),
    ("rddg", Word::RadToDeg),
    ("dgrd", Word::DegToRad),
    ("rnor", Word::NormRadians),
    ("case", Word::Case),
    ("seed", Word::Seed),
    ("rand", Word::Rand),
    ("lc", Word::Lower),
    ("uc", Word::Upper),
    ("cap", Word::Upper),
    ("chr", Word::Chr),
    ("ord", Word::Ord),
    ("scat", Word::Concat),
    ("schr", Word::FindChar),
    ("scmp", Word::Compare),
    ("scmi", Word::CompareCaseless),
    ("slen", Word::Length),
    ("sstr", Word::Find),
    ("ssub", Word::Substring),
    ("symb", Word::Symbol),
    ("b", Word::Backup),
    ("c", Word::Clear),
    ("d", Word::Duplicate),
    ("p", Word::Pop),
    ("r", Word::Swap),
];

/// The registers, `s0` to `s49`, `l0` to `l49`, and `sp0` to `sp49`.
const REGISTERS: u8 = 50;

/// Compiles `code`, which `expand` has given its parameters and macros. A word this crate
/// doesn't take, a parameter or macro left unexpanded, or a block left open fails, so code
/// that would pose a part wrongly is never run.
pub fn compile(code: &str) -> Result<Program, Error> {
    let tokens = tokenize(code)?;
    let mut c = Compiler {
        code,
        ops: Vec::with_capacity(tokens.len()),
        vars: Vec::new(),
        keeps_state: false,
        labels: Vec::new(),
        gotos: Vec::new(),
    };
    // Each open block: the place of its `IfNot`, and of the jump over its `els{` part once
    // that has begun.
    let mut blocks: Vec<(usize, Option<usize>)> = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let token = tokens[i].as_str();
        i += 1;
        match token {
            "if{" => {
                blocks.push((c.ops.len(), None));
                c.ops.push(Op::IfNot(0));
            }
            "els{" => return c.fail("an els{ that follows no if{ block"),
            "}" => {
                let Some((if_at, jump_at)) = blocks.pop() else {
                    return c.fail("a } that closes no block");
                };
                match jump_at {
                    None if tokens.get(i).map(String::as_str) == Some("els{") => {
                        i += 1;
                        let jump_at = c.ops.len();
                        c.ops.push(Op::Jump(0));
                        c.ops[if_at] = Op::IfNot(c.ops.len() as u32);
                        blocks.push((if_at, Some(jump_at)));
                    }
                    None => c.ops[if_at] = Op::IfNot(c.ops.len() as u32),
                    Some(jump_at) => c.ops[jump_at] = Op::Jump(c.ops.len() as u32),
                }
            }
            _ => c.token(token)?,
        }
    }
    if !blocks.is_empty() {
        return c.fail("an if{ left open");
    }
    for &(at, label) in &c.gotos {
        let Some(&(_, to)) = c.labels.iter().find(|(l, _)| *l == label) else {
            return c.fail(&format!("g{label}, with no label :{label}"));
        };
        c.ops[at] = Op::Jump(to as u32);
    }
    Ok(Program {
        ops: c.ops,
        vars: c.vars,
        keeps_state: c.keeps_state,
    })
}

struct Compiler<'c> {
    code: &'c str,
    ops: Vec<Op>,
    vars: Vec<Var>,
    keeps_state: bool,
    labels: Vec<(u32, usize)>,
    /// Each goto's place, and the label it names, resolved once every label is known.
    gotos: Vec<(usize, u32)>,
}

impl Compiler<'_> {
    fn fail<T>(&self, what: &str) -> Result<T, Error> {
        Err(Error(format!("{what}, in: {}", self.code.trim())))
    }

    fn token(&mut self, token: &str) -> Result<(), Error> {
        if let Some(inside) = token.strip_prefix('(').and_then(|t| t.strip_suffix(')')) {
            return self.variable(inside);
        }
        if let Some(text) = token.strip_prefix('\'').and_then(|t| t.strip_suffix('\'')) {
            self.ops.push(Op::Text(text.to_string()));
            return Ok(());
        }
        if token.contains('#') {
            return self.fail(&format!("the parameter {token}, left unexpanded"));
        }
        if token.starts_with('@') {
            return self.fail(&format!("the macro {token}, left unexpanded"));
        }
        if let Some(label) = token.strip_prefix(':').and_then(|n| n.parse::<u32>().ok()) {
            self.labels.push((label, self.ops.len()));
            return Ok(());
        }
        if let Some(n) = number(token) {
            self.ops.push(Op::Number(n));
            return Ok(());
        }
        let word = token.to_ascii_lowercase();
        if let Some(&(_, w)) = WORDS.iter().find(|(name, _)| *name == word) {
            self.ops.push(Op::Word(w));
            return Ok(());
        }
        if word == "quit" {
            self.ops.push(Op::Quit);
            return Ok(());
        }
        if let Some(label) = word.strip_prefix('g').and_then(|n| n.parse::<u32>().ok()) {
            self.gotos.push((self.ops.len(), label));
            self.ops.push(Op::Jump(0));
            return Ok(());
        }
        for (prefix, store, pop) in [("sp", true, true), ("s", true, false), ("l", false, false)] {
            if let Some(n) = word.strip_prefix(prefix).and_then(|n| n.parse::<u8>().ok()) {
                if n >= REGISTERS {
                    return self.fail(&format!("the register {token}, past {}", REGISTERS - 1));
                }
                self.ops.push(if store {
                    Op::Store { register: n, pop }
                } else {
                    Op::Load(n)
                });
                return Ok(());
            }
        }
        self.fail(&format!("the word {token}, which this crate doesn't run"))
    }

    /// A variable's read, `(A:NAME, unit)`, or its write, `(>L:NAME, unit)`.
    fn variable(&mut self, inside: &str) -> Result<(), Error> {
        let (write, inside) = match inside.trim().strip_prefix('>') {
            Some(rest) => (true, rest),
            None => (false, inside.trim()),
        };
        let Some((kind, rest)) = inside.split_once(':') else {
            return self.fail(&format!("the variable ({inside}), with no kind"));
        };
        let kind = kind.trim().to_ascii_uppercase();
        let mut chars = kind.chars();
        let (Some(kind), None) = (chars.next(), chars.next()) else {
            return self.fail(&format!(
                "the variable ({inside}), of no kind this crate knows"
            ));
        };
        if matches!(kind, 'K' | 'H') || (write && kind == 'B') {
            if write {
                self.ops.push(Op::Event);
                return Ok(());
            }
            return self.fail(&format!("a read of the event ({inside})"));
        }
        if matches!(kind, 'F' | 'M' | 'R' | 'C' | 'X' | 'W') {
            return self.fail(&format!(
                "the {kind}: variable ({inside}), which posing has no value for"
            ));
        }
        let (name, unit) = match rest.split_once(',') {
            Some((name, unit)) => (name.trim(), unit.trim().to_ascii_lowercase()),
            None => (rest.trim(), "number".to_string()),
        };
        let var = Var {
            kind,
            name: name.to_string(),
            unit,
        };
        if write && var.kept() {
            self.keeps_state = true;
        }
        let place = match self.vars.iter().position(|v| *v == var) {
            Some(i) => i,
            None => {
                self.vars.push(var);
                self.vars.len() - 1
            }
        } as u32;
        self.ops.push(if write {
            Op::Write(place)
        } else {
            Op::Read(place)
        });
        Ok(())
    }
}

/// A number as the SDK writes one: decimal with an optional exponent, hexadecimal after
/// `0x`, or octal after a leading 0, as `022` is 18.
fn number(token: &str) -> Option<f64> {
    let (negative, digits) = match token.strip_prefix('-') {
        Some(rest) if !rest.is_empty() => (true, rest),
        _ => (false, token),
    };
    let first = digits.chars().next()?;
    if !first.is_ascii_digit() && first != '.' {
        return None;
    }
    let value = if let Some(hex) = digits
        .strip_prefix("0x")
        .or_else(|| digits.strip_prefix("0X"))
    {
        u64::from_str_radix(hex, 16).ok()? as f64
    } else if digits.len() > 1
        && digits.starts_with('0')
        && digits.chars().all(|c| c.is_ascii_digit())
    {
        u64::from_str_radix(&digits[1..], 8).ok()? as f64
    } else {
        digits.parse::<f64>().ok().filter(|n| n.is_finite())?
    };
    Some(if negative { -value } else { value })
}

/// Splits code into its tokens: a variable in parentheses and a string in quotes each one
/// token whatever spaces they hold, `}` a token of its own, and anything else up to the
/// next space.
fn tokenize(code: &str) -> Result<Vec<String>, Error> {
    let mut tokens = Vec::new();
    let mut rest = code;
    loop {
        rest = rest.trim_start();
        let Some(first) = rest.chars().next() else {
            return Ok(tokens);
        };
        let end = match first {
            '(' => match rest.find(')') {
                Some(close) => close + 1,
                None => return Err(Error(format!("a ( left open, in: {}", code.trim()))),
            },
            '\'' => match rest[1..].find('\'') {
                Some(close) => close + 2,
                None => return Err(Error(format!("a ' left open, in: {}", code.trim()))),
            },
            '}' => 1,
            _ => rest
                .find(|c: char| c.is_whitespace() || c == '(' || c == '}')
                .unwrap_or(rest.len()),
        };
        tokens.push(rest[..end].to_string());
        rest = &rest[end..];
    }
}
