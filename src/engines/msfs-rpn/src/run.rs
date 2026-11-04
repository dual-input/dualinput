//! Running a program on given values.

use std::collections::BTreeMap;
use std::f64::consts::{PI, TAU};

use crate::compile::{Op, Program, Word};

/// A program stops after this many steps, against a goto that loops forever.
const MOST_STEPS: u32 = 100_000;

/// A string stops growing at this many bytes, against a loop that doubles one until the core
/// runs out of memory, within `MOST_STEPS`. The sim's string words hold names and short labels.
const LONGEST_TEXT: usize = 1_024;

/// What `rand` gives: posing runs on the core's loop, which draws no random number, and a
/// part that moves at random poses at its middle.
const RAND: f64 = 0.5;

/// The variables a run keeps itself, `O:`, `I:`, and `G:`, which start at 0 and keep what a
/// program writes into them from one run to the next.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Scratch {
    kept: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, PartialEq)]
enum Value {
    Number(f64),
    Text(String),
}

impl Value {
    fn number(&self) -> f64 {
        match self {
            Value::Number(n) => *n,
            Value::Text(t) => t.trim().parse().unwrap_or(0.0),
        }
    }

    fn text(&self) -> String {
        match self {
            Value::Number(n) => n.to_string(),
            Value::Text(t) => t.clone(),
        }
    }
}

struct Machine {
    stack: Vec<Value>,
    registers: [f64; 50],
    /// The first value the last word took, which `b` puts back.
    backup: Value,
}

impl Machine {
    fn pop(&mut self) -> Value {
        let v = self.stack.pop().unwrap_or(Value::Number(0.0));
        self.backup = v.clone();
        v
    }

    fn num(&mut self) -> f64 {
        self.pop().number()
    }

    /// Takes the top two, the first written first: `a b -` is `a - b`.
    fn two(&mut self) -> (f64, f64) {
        let b = self.num();
        let a = self.stack.pop().map_or(0.0, |v| v.number());
        (a, b)
    }

    fn push(&mut self, n: f64) {
        self.stack.push(Value::Number(n));
    }

    fn truth(b: bool) -> f64 {
        if b { 1.0 } else { 0.0 }
    }
}

impl Program {
    /// Runs the program: `value` gives each variable it reads by its place in `vars`, and
    /// `scratch` keeps the variables a run keeps. Returns the number left on top of the
    /// stack, 0 when it's empty.
    pub fn run(&self, scratch: &mut Scratch, value: &dyn Fn(usize) -> f64) -> f64 {
        let mut m = Machine {
            stack: Vec::with_capacity(16),
            registers: [0.0; 50],
            backup: Value::Number(0.0),
        };
        let mut at = 0usize;
        let mut steps = 0;
        while let Some(op) = self.ops.get(at) {
            steps += 1;
            if steps > MOST_STEPS {
                break;
            }
            at += 1;
            match op {
                Op::Number(n) => m.push(*n),
                Op::Text(t) => m.stack.push(Value::Text(t.clone())),
                Op::Read(i) => {
                    let i = *i as usize;
                    let n = match self.vars.get(i) {
                        Some(v) if v.kept() => scratch
                            .kept
                            .get(&kept_key(v.kind, &v.name))
                            .copied()
                            .unwrap_or(0.0),
                        Some(_) => value(i),
                        None => 0.0,
                    };
                    m.push(n);
                }
                Op::Write(i) => {
                    let n = m.num();
                    if let Some(v) = self.vars.get(*i as usize).filter(|v| v.kept()) {
                        scratch.kept.insert(kept_key(v.kind, &v.name), n);
                    }
                }
                Op::Event => {}
                Op::IfNot(to) => {
                    if m.num() == 0.0 {
                        at = *to as usize;
                    }
                }
                Op::Jump(to) => at = *to as usize,
                Op::Store { register, pop } => {
                    let v = if *pop {
                        m.num()
                    } else {
                        m.stack.last().map_or(0.0, Value::number)
                    };
                    if let Some(r) = m.registers.get_mut(*register as usize) {
                        *r = v;
                    }
                }
                Op::Load(register) => {
                    let v = m.registers.get(*register as usize).copied().unwrap_or(0.0);
                    m.push(v);
                }
                Op::Quit => break,
                Op::Word(w) => word(&mut m, *w),
            }
        }
        m.stack.last().map_or(0.0, Value::number)
    }
}

fn kept_key(kind: char, name: &str) -> String {
    format!("{kind}:{}", name.to_ascii_lowercase())
}

fn word(m: &mut Machine, w: Word) {
    let truth = Machine::truth;
    match w {
        Word::Add => {
            let (a, b) = m.two();
            m.push(a + b);
        }
        Word::Sub => {
            let (a, b) = m.two();
            m.push(a - b);
        }
        Word::Mul => {
            let (a, b) = m.two();
            m.push(a * b);
        }
        Word::Div => {
            let (a, b) = m.two();
            m.push(a / b);
        }
        // The SDK takes the divisor as positive whatever its sign, and keeps the dividend's
        // sign for `%` and none for `pmod`.
        Word::Mod => {
            let (a, b) = m.two();
            m.push(a % b.abs());
        }
        Word::PMod => {
            let (a, b) = m.two();
            m.push(a.rem_euclid(b.abs()));
        }
        Word::Inc => {
            let a = m.num();
            m.push(a + 1.0);
        }
        Word::Dec => {
            let a = m.num();
            m.push(a - 1.0);
        }
        Word::Neg => {
            let a = m.num();
            m.push(-a);
        }
        Word::Eq | Word::Ne => {
            let b = m.pop();
            let a = m.stack.pop().unwrap_or(Value::Number(0.0));
            let same = match (&a, &b) {
                (Value::Text(x), Value::Text(y)) => x == y,
                _ => a.number() == b.number(),
            };
            m.push(truth(same == (w == Word::Eq)));
        }
        Word::Gt => {
            let (a, b) = m.two();
            m.push(truth(a > b));
        }
        Word::Lt => {
            let (a, b) = m.two();
            m.push(truth(a < b));
        }
        Word::Ge => {
            let (a, b) = m.two();
            m.push(truth(a >= b));
        }
        Word::Le => {
            let (a, b) = m.two();
            m.push(truth(a <= b));
        }
        // `X Y C ?` is X when C holds, and Y otherwise.
        Word::Choose => {
            let c = m.num();
            let y = m.stack.pop().unwrap_or(Value::Number(0.0));
            let x = m.stack.pop().unwrap_or(Value::Number(0.0));
            m.stack.push(if c != 0.0 { x } else { y });
        }
        Word::BitAnd => {
            let (a, b) = m.two();
            m.push((a as i64 & b as i64) as f64);
        }
        Word::BitOr => {
            let (a, b) = m.two();
            m.push((a as i64 | b as i64) as f64);
        }
        Word::BitXor => {
            let (a, b) = m.two();
            m.push((a as i64 ^ b as i64) as f64);
        }
        Word::BitNot => {
            let a = m.num();
            m.push(!(a as i64) as f64);
        }
        Word::ShiftRight => {
            let (a, b) = m.two();
            m.push(((a as i64) >> (b as i64).clamp(0, 63)) as f64);
        }
        Word::ShiftLeft => {
            let (a, b) = m.two();
            m.push(((a as i64) << (b as i64).clamp(0, 63)) as f64);
        }
        Word::Not => {
            let a = m.num();
            m.push(truth(a == 0.0));
        }
        Word::And => {
            let (a, b) = m.two();
            m.push(truth(a != 0.0 && b != 0.0));
        }
        Word::Or => {
            let (a, b) = m.two();
            m.push(truth(a != 0.0 || b != 0.0));
        }
        Word::Abs => one(m, f64::abs),
        Word::Int => one(m, f64::trunc),
        Word::Floor => one(m, f64::floor),
        Word::Ceil => one(m, f64::ceil),
        // Half rounds up, as the SDK's 8.5 would, where `round` takes -8.5 to -9.
        Word::Near => one(m, |a| (a + 0.5).floor()),
        // `lo hi v rng` holds when v lies between lo and hi.
        Word::Range => {
            let v = m.num();
            let (lo, hi) = m.two();
            m.push(truth(v >= lo.min(hi) && v <= lo.max(hi)));
        }
        Word::Cos => one(m, f64::cos),
        Word::Sin => one(m, f64::sin),
        Word::Tan => one(m, f64::tan),
        Word::Cot => one(m, |a| 1.0 / a.tan()),
        Word::Acos => one(m, f64::acos),
        Word::Asin => one(m, f64::asin),
        Word::Atan => one(m, f64::atan),
        Word::Atan2 => {
            let (a, b) = m.two();
            m.push(a.atan2(b));
        }
        Word::Log10 => one(m, f64::log10),
        Word::Ln => one(m, f64::ln),
        Word::Log => {
            let (a, b) = m.two();
            m.push(a.ln() / b.ln());
        }
        Word::Sqr => one(m, |a| a * a),
        Word::Sqrt => one(m, f64::sqrt),
        Word::Eps => one(m, |a| a.abs() * f64::EPSILON),
        Word::Pi => m.push(PI),
        Word::Exp => one(m, f64::exp),
        Word::Min => {
            let (a, b) = m.two();
            m.push(a.min(b));
        }
        Word::Max => {
            let (a, b) = m.two();
            m.push(a.max(b));
        }
        Word::Pow => {
            let (a, b) = m.two();
            m.push(a.powf(b));
        }
        // The SDK counts 0 as positive.
        Word::Sign => one(m, |a| if a < 0.0 { -1.0 } else { 1.0 }),
        Word::Fraction => one(m, f64::fract),
        Word::IntDiv => {
            let (a, b) = m.two();
            m.push((a / b).trunc());
        }
        Word::NormDegrees => one(m, |a| a.rem_euclid(360.0)),
        // A whole number from 1 to 360, where 0 is 360.
        Word::WholeDegrees => one(m, |a| {
            let d = a.round().rem_euclid(360.0);
            if d == 0.0 { 360.0 } else { d }
        }),
        Word::RadToDeg => one(m, f64::to_degrees),
        Word::DegToRad => one(m, f64::to_radians),
        Word::NormRadians => one(m, |a| a.rem_euclid(TAU)),
        // `v0 ... vn-1 n i case` gives the value i counts back from n: in the SDK's example,
        // `50 40 30 20 10 5 i case` gives 10 for an i from 0 to under 1. An i outside the
        // values takes the nearest, which the SDK doesn't say (unverified).
        Word::Case => {
            let i = m.num();
            // `n` comes from the aircraft's code, where 1e30 would ask for more memory than
            // there is, so it counts at most what the stack holds.
            let n = (m.num().max(0.0) as usize).min(m.stack.len());
            let mut values = Vec::with_capacity(n);
            for _ in 0..n {
                values.push(m.stack.pop().unwrap_or(Value::Number(0.0)));
            }
            let pick = (i.floor().max(0.0) as usize).min(n.saturating_sub(1));
            m.stack
                .push(values.get(pick).cloned().unwrap_or(Value::Number(0.0)));
        }
        Word::Seed => {
            m.pop();
        }
        Word::Rand => m.push(RAND),
        Word::Lower => text(m, |t| t.to_lowercase()),
        Word::Upper => text(m, |t| t.to_uppercase()),
        Word::Chr => {
            let a = m.num();
            let c = char::from_u32(a as u32).unwrap_or('\0');
            m.stack.push(Value::Text(c.to_string()));
        }
        Word::Ord => {
            let t = m.pop().text();
            m.push(t.chars().next().map_or(0.0, |c| c as u32 as f64));
        }
        Word::Concat => {
            let b = m.pop().text();
            let mut a = m.stack.pop().map(|v| v.text()).unwrap_or_default();
            if a.len() + b.len() <= LONGEST_TEXT {
                a.push_str(&b);
            }
            m.stack.push(Value::Text(a));
        }
        Word::FindChar | Word::Find => {
            let b = m.pop().text();
            let a = m.stack.pop().map(|v| v.text()).unwrap_or_default();
            m.push(a.find(&b).map_or(-1.0, |i| a[..i].chars().count() as f64));
        }
        // 0 when the two are the same, as the SDK's `scmp 0 ==` tests.
        Word::Compare | Word::CompareCaseless => {
            let b = m.pop().text();
            let a = m.stack.pop().map(|v| v.text()).unwrap_or_default();
            let (a, b) = if w == Word::CompareCaseless {
                (a.to_lowercase(), b.to_lowercase())
            } else {
                (a, b)
            };
            m.push(match a.cmp(&b) {
                std::cmp::Ordering::Less => -1.0,
                std::cmp::Ordering::Equal => 0.0,
                std::cmp::Ordering::Greater => 1.0,
            });
        }
        Word::Length => {
            let t = m.pop().text();
            m.push(t.chars().count() as f64);
        }
        // `t from to ssub`, both inclusive, a negative one counting from the end.
        Word::Substring => {
            let to = m.num();
            let from = m.num();
            let t: Vec<char> = m.pop().text().chars().collect();
            let place = |n: f64| {
                if n < 0.0 {
                    (t.len() as f64 + n).max(0.0) as usize
                } else {
                    n as usize
                }
            };
            let (from, to) = (place(from), place(to));
            let out: String = t
                .get(from..=to.min(t.len().saturating_sub(1)))
                .map(|s| s.iter().collect())
                .unwrap_or_default();
            m.stack.push(Value::Text(out));
        }
        Word::Symbol => {
            let i = m.num();
            let t = m.pop().text();
            let c = t.chars().nth(i.max(0.0) as usize).map(String::from);
            m.stack.push(Value::Text(c.unwrap_or_default()));
        }
        Word::Backup => {
            let v = m.backup.clone();
            m.stack.push(v);
        }
        Word::Clear => m.stack.clear(),
        Word::Duplicate => {
            let v = m.stack.last().cloned().unwrap_or(Value::Number(0.0));
            m.stack.push(v);
        }
        Word::Pop => {
            m.stack.pop();
        }
        Word::Swap => {
            let b = m.stack.pop().unwrap_or(Value::Number(0.0));
            let a = m.stack.pop().unwrap_or(Value::Number(0.0));
            m.stack.push(b);
            m.stack.push(a);
        }
    }
}

fn one(m: &mut Machine, f: impl Fn(f64) -> f64) {
    let a = m.num();
    m.push(f(a));
}

fn text(m: &mut Machine, f: impl Fn(&str) -> String) {
    let t = m.pop().text();
    m.stack.push(Value::Text(f(&t)));
}
