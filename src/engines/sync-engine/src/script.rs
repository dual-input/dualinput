//! The profile's write functions in its sandbox: the names, `write()`, and `state` the context
//! defines for them, compiling each at load, and running one for a value, which hands back the
//! actions it wrote, in call order (record/areas/profiles/01-format-and-delivery.md, "Write
//! functions").
//!
//! A run's actions come back whole once the function returns, so the engine sees every action
//! before any goes out, and a function that throws or reaches a limit writes nothing.

use std::collections::BTreeMap;

use profile_engine::{Arg, Name, Pace};
use sandbox::rquickjs::{Array, Ctx, Function, Object, Persistent, Value as JsValue};
use sandbox::{Failed, Sandbox};

use crate::Value;

/// What level 1's declarations give a write function, beside the JavaScript the sandbox runs:
/// a name call for each kind of name, `value` for the place a `K:` event takes the written value,
/// `write()` with its chain's `repeat` and `every`, and `state`. The functions keep each action as
/// a plain object, and the script's own value, the function that takes them, stays out of every
/// global, so a write function can't reach it (src/engines/profile-engine/src/levels.rs holds the
/// declarations, so change both together).
const PRELUDE: &str = r#"(function (g) {
  "use strict";
  let actions = [];
  const marker = Object.freeze({});
  g.value = marker;
  g.L = (name, unit) => ({ kind: "L", name, unit });
  g.A = (name, unit) => ({ kind: "A", name, unit });
  g.B = (name) => ({ kind: "B", name });
  g.K = (name, ...values) => ({ kind: "K", name, values: values.map((v) => (v === marker ? null : v)) });
  g.H = (name) => ({ kind: "H", name });
  g.write = function (target, value) {
    const action = { target, value, times: 1, every: undefined };
    actions.push(action);
    const chain = {
      repeat(times) { action.times = times; return chain; },
      every(pace) { action.every = pace; return chain; },
    };
    return chain;
  };
  g.state = {};
  return function take() { const taken = actions; actions = []; return taken; };
})(this)"#;

/// One action a run wrote, with how many times its chain sends it and the spacing it set.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Written {
    pub(crate) name: Name,
    pub(crate) value: Option<Value>,
    pub(crate) times: u64,
    pub(crate) every: Option<Pace>,
}

/// Why a run wrote nothing.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum RunFailed {
    /// It reached the sandbox's time or memory limit, which stops its entry.
    Limit(Failed),
    /// It threw, or wrote something no action can be, such as a pace that doesn't read as one.
    Wrong(String),
}

/// The profile's runtime and its compiled functions. The functions are declared before the
/// sandbox, so they're dropped first: a `Persistent` that outlives its runtime makes rquickjs
/// abort the process.
pub(crate) struct Script {
    functions: BTreeMap<crate::Slot, Persistent<Function<'static>>>,
    take: Option<Persistent<Function<'static>>>,
    /// Each state entry's value as `state` shows it, by key, set in the context only before a
    /// run, since a write function reads it only then.
    changed: BTreeMap<String, Option<Value>>,
    sandbox: Sandbox,
}

impl Script {
    pub(crate) fn new(sandbox: Sandbox) -> Script {
        Script {
            functions: BTreeMap::new(),
            take: None,
            changed: BTreeMap::new(),
            sandbox,
        }
    }

    /// Compiles one write function, the JavaScript the builder compiled at ES2020, which is an
    /// expression whose value is the function. The prelude goes in before the first.
    pub(crate) fn compile(&mut self, slot: crate::Slot, js: &str) -> Result<(), String> {
        if self.take.is_none() {
            let take = self
                .sandbox
                .call(|ctx| {
                    let take: Function = ctx.eval(PRELUDE)?;
                    Ok(Persistent::save(ctx, take))
                })
                .map_err(|e| format!("the write functions' globals didn't start: {e}"))?;
            self.take = Some(take);
        }
        let source = format!("(\n{js}\n)");
        let function = self
            .sandbox
            .call(|ctx| {
                let f: Function = ctx.eval(source)?;
                Ok(Persistent::save(ctx, f))
            })
            .map_err(|e| e.to_string())?;
        self.functions.insert(slot, function);
        Ok(())
    }

    /// Notes an entry's value for `state`, which goes into the context before the next run.
    pub(crate) fn note(&mut self, key: &str, value: Option<Value>) {
        if !self.functions.is_empty() {
            self.changed.insert(key.to_string(), value);
        }
    }

    /// Runs the function for `slot` with `value`, and hands back what it wrote.
    pub(crate) fn run(
        &mut self,
        slot: crate::Slot,
        value: Option<&Value>,
    ) -> Result<Vec<Written>, RunFailed> {
        let (Some(function), Some(take)) = (self.functions.get(&slot), self.take.as_ref()) else {
            return Err(RunFailed::Wrong("the entry has no write function".into()));
        };
        // A run that fails leaves `state` to be set again before the next.
        let changed = &self.changed;
        let raw = self
            .sandbox
            .call(|ctx| {
                let take = take.clone().restore(ctx)?;
                // A run that failed left what it wrote before it stopped.
                take.call::<_, Array>(())?;
                let state: Object = ctx.globals().get("state")?;
                for (key, value) in changed {
                    match value {
                        Some(v) => state.set(key.as_str(), to_js(ctx, v)?)?,
                        None => state.remove(key.as_str())?,
                    }
                }
                let f = function.clone().restore(ctx)?;
                match value {
                    Some(v) => f.call::<_, ()>((to_js(ctx, v)?,))?,
                    None => f.call::<_, ()>(())?,
                }
                let taken: Array = take.call(())?;
                let mut raw = Vec::new();
                for action in taken.iter::<Object>() {
                    raw.push(read_raw(&action?)?);
                }
                Ok(raw)
            })
            .map_err(|failed| match failed {
                Failed::Threw(e) => RunFailed::Wrong(e),
                limit => RunFailed::Limit(limit),
            })?;
        self.changed.clear();
        raw.into_iter()
            .map(|r| written(r, value))
            .collect::<Result<_, _>>()
            .map_err(RunFailed::Wrong)
    }
}

fn to_js<'js>(ctx: &Ctx<'js>, value: &Value) -> sandbox::rquickjs::Result<JsValue<'js>> {
    Ok(match value {
        Value::Number(n) => JsValue::new_float(ctx.clone(), *n),
        Value::Text(t) => sandbox::rquickjs::String::from_str(ctx.clone(), t)?.into_value(),
    })
}

/// An action as the prelude kept it, before it's checked.
struct Raw {
    kind: Option<String>,
    name: Option<String>,
    unit: Option<String>,
    values: Option<Vec<Option<f64>>>,
    value: Option<RawValue>,
    times: f64,
    every: Option<String>,
}

enum RawValue {
    Number(f64),
    Text(String),
    Other,
}

fn read_raw<'js>(action: &Object<'js>) -> sandbox::rquickjs::Result<Raw> {
    let target: JsValue = action.get("target")?;
    let target = target.into_object();
    let field = |key: &str| -> sandbox::rquickjs::Result<Option<String>> {
        match &target {
            Some(t) => t.get::<_, Option<String>>(key),
            None => Ok(None),
        }
    };
    let values = match &target {
        Some(t) => t.get::<_, Option<Vec<Option<f64>>>>("values")?,
        None => None,
    };
    let value: JsValue = action.get("value")?;
    let value = if value.is_undefined() {
        None
    } else if let Some(n) = value.as_number() {
        Some(RawValue::Number(n))
    } else if let Some(s) = value.as_string() {
        Some(RawValue::Text(s.to_string()?))
    } else {
        Some(RawValue::Other)
    };
    Ok(Raw {
        kind: field("kind")?,
        name: field("name")?,
        unit: field("unit")?,
        values,
        value,
        times: action.get::<_, Option<f64>>("times")?.unwrap_or(f64::NAN),
        every: action.get::<_, Option<String>>("every")?,
    })
}

/// Checks one action, as `write()`'s declarations type it, and as the format reads a pace.
/// `run_value` is the value the function was given.
fn written(raw: Raw, run_value: Option<&Value>) -> Result<Written, String> {
    let name_of = || -> Result<Name, String> {
        let name = raw
            .name
            .clone()
            .ok_or("write() takes a name from L(), A(), B(), K(), or H()")?;
        Ok(match raw.kind.as_deref() {
            Some("L") => Name::L {
                name,
                unit: raw.unit.clone(),
            },
            Some("A") => Name::A {
                name,
                unit: raw.unit.clone().ok_or("A() takes a unit every time")?,
            },
            Some("B") => Name::B { name },
            Some("H") => Name::H { name },
            Some("K") => Name::K {
                name,
                values: raw
                    .values
                    .clone()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|v| v.map_or(Arg::Value, Arg::Number))
                    .collect(),
            },
            _ => return Err("write() takes a name from L(), A(), B(), K(), or H()".into()),
        })
    };
    let name = name_of()?;
    let value = match raw.value {
        None => None,
        Some(RawValue::Number(n)) if n.is_finite() => Some(Value::Number(n)),
        Some(RawValue::Text(t)) => Some(Value::Text(t)),
        Some(_) => return Err("write() writes a number or a text".into()),
    };
    if raw.times.fract() != 0.0 || !(0.0..=u32::MAX as f64).contains(&raw.times) {
        return Err(format!(
            "repeat() takes a whole number of times, not {}",
            raw.times
        ));
    }
    let every = match raw.every {
        None => None,
        Some(text) => Some(Pace::parse(&text).ok_or_else(|| {
            format!("a chain's pace reads as `1 frame`, `<n> frames`, or `<n>ms`, not `{text}`")
        })?),
    };
    let value = match (&name, value) {
        (Name::L { .. } | Name::A { .. }, None) => {
            return Err("write() sets a variable to a value, and got none".into());
        }
        // `write(K('X', 3, value))` puts the value the function was given where `value` marks,
        // as a name written on its own does with the value it writes.
        (Name::K { values, .. }, None) if values.contains(&Arg::Value) => match run_value {
            Some(v) => Some(v.clone()),
            None => {
                return Err(
                    "a K: event with `value` among its values needs a value, and the function was given none"
                        .into(),
                );
            }
        },
        (_, value) => value,
    };
    Ok(Written {
        name,
        value,
        times: raw.times as u64,
        every,
    })
}
