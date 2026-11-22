//! A write in progress: its actions, each sent the times its chain asks, spaced at its pace, a
//! stepping write's steps among them, which the engine sends as the sim's frames come
//! (record/areas/sync/05-units.md, "Writing").

use std::collections::VecDeque;

use profile_engine::{Arg, Name, Pace};

use crate::script::Written;
use crate::{Action, CHECK, Ctx, Engine, Out, Planned, Slot, Value};

/// One action, sent `times` times, `pace` apart.
#[derive(Clone, Debug)]
pub(crate) struct Chain {
    pub(crate) action: Action,
    pub(crate) times: u64,
    pub(crate) pace: Pace,
    /// For a stepping write's steps, how far each moves its count.
    pub(crate) step: Option<f64>,
}

/// When a chain's next action goes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Due {
    Now,
    Frame(u64),
    At(u64),
}

/// A stepping write's count: it starts from the reading when it starts and adds each step it
/// sends, and reads the entry no more until its last step, so a reading that lags a step behind
/// never makes it step again.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Count {
    pub(crate) at: f64,
    /// The range a wrapping count goes round in, its bottom and its top.
    pub(crate) wrap: Option<(f64, f64)>,
}

#[derive(Debug)]
pub(crate) struct Run {
    chains: VecDeque<Chain>,
    due: Due,
    /// Whether each step's value goes pending, which a put-back's and a shadow's don't.
    pub(crate) checked: bool,
    /// Whether a pending value still unread at its check is flagged, which a following
    /// machine's write of an entry the pilot flying owns isn't.
    pub(crate) flags: bool,
    /// Its values don't go pending, as a put-back's don't, so this machine's readings while it
    /// runs start no put-back of their own.
    pub(crate) put_back: bool,
    /// An arrival waits on its last step, as `Applied::Stepping`.
    pub(crate) answers: bool,
    /// It's a catch-up write.
    pub(crate) catch_up: bool,
    pub(crate) count: Option<Count>,
    /// A token for each step's name, as a counting entry's step leaves one.
    pub(crate) tokens: bool,
}

impl Run {
    pub(crate) fn new(chains: Vec<Chain>) -> Run {
        Run {
            chains: chains.into(),
            due: Due::Now,
            checked: true,
            flags: true,
            put_back: false,
            answers: false,
            catch_up: false,
            count: None,
            tokens: false,
        }
    }

    /// Whether it takes more than the call it starts in: a chain's first action goes at once,
    /// and the next chain starts as the one before sends its last, so only a chain that sends
    /// more than once waits.
    pub(crate) fn takes_frames(&self) -> bool {
        self.chains.iter().any(|c| c.times > 1)
    }

    /// Its chains as a plan shows them, each action with its times and its pace, in the
    /// spacing `Engine::step_run` sends them at, so change both together.
    pub(crate) fn planned(&self) -> Vec<Planned> {
        self.chains
            .iter()
            .filter(|c| c.times > 0)
            .map(|c| Planned {
                action: c.action.clone(),
                times: c.times,
                every: c.pace,
            })
            .collect()
    }
}

/// How far a range that wraps goes before it comes round: its bottom to its top, and a step
/// past the top, which is the bottom. A stepping write's count, a shadow's count, and the
/// shorter way round all go round by it.
pub(crate) fn span(lo: f64, hi: f64, step: f64) -> f64 {
    hi - lo + step
}

/// `at` brought into a range that wraps.
pub(crate) fn wrapped(at: f64, lo: f64, hi: f64, step: f64) -> f64 {
    lo + (at - lo).rem_euclid(span(lo, hi, step))
}

/// A count moved by `by`, going round its range when it wraps.
pub(crate) fn moved(count: Count, by: f64) -> f64 {
    let at = count.at + by;
    match count.wrap {
        Some((lo, hi)) => wrapped(at, lo, hi, by.abs()),
        None => at,
    }
}

/// The steps from `from` to `to`: how many, and which way, the shorter way round a range that
/// wraps, and clamped to one that stops.
pub(crate) fn steps(
    from: f64,
    to: f64,
    step: f64,
    wrap: Option<bool>,
    range: Option<(f64, f64)>,
) -> (u64, bool) {
    let step = if step > 0.0 { step } else { 1.0 };
    let mut diff = match (wrap, range) {
        (Some(true), Some((lo, hi))) => {
            let span = span(lo, hi, step);
            let d = (to - from).rem_euclid(span);
            if d > span / 2.0 { d - span } else { d }
        }
        (_, Some((lo, hi))) => to.clamp(lo.min(hi), hi.max(lo)) - from,
        _ => to - from,
    };
    if diff.abs() < step / 2.0 {
        diff = 0.0;
    }
    let n = (diff.abs() / step).round();
    (if n.is_finite() { n as u64 } else { 0 }, diff >= 0.0)
}

/// The action that writes `value` into `name`, as a name on its own writes: a variable or an
/// input event set, a `K:` event sent with the value before its own values, or where `value`
/// marks, and an `H:` event fired.
pub(crate) fn action(name: &Name, value: Option<&Value>) -> Action {
    match name {
        Name::L { .. } | Name::A { .. } | Name::B { .. } => match value {
            Some(v) => Action::Set {
                name: name.clone(),
                value: v.clone(),
            },
            None => Action::Fire { name: name.clone() },
        },
        Name::K { values, .. } => {
            let written = value.and_then(Value::number);
            let mut out = Vec::new();
            if !values.contains(&Arg::Value)
                && let Some(v) = written
            {
                out.push(v);
            }
            for arg in values {
                match arg {
                    Arg::Number(n) => out.push(*n),
                    Arg::Value => out.extend(written),
                }
            }
            Action::Key {
                name: name.clone(),
                values: out,
            }
        }
        Name::H { .. } | Name::Instrument { .. } => Action::Fire { name: name.clone() },
    }
}

impl Engine {
    /// The chains a function's run wrote: each write's action, sent the times its chain asks, at
    /// its own pace, or else the aircraft's.
    pub(crate) fn chains_of(&self, written: Vec<Written>) -> Vec<Chain> {
        written
            .into_iter()
            .map(|w| Chain {
                action: action(&w.name, w.value.as_ref()),
                times: w.times,
                pace: w.every.unwrap_or(self.pace),
                step: None,
            })
            .collect()
    }

    /// Starts `run` for `slot`, in place of any it had, and sends what's due at once. The run it
    /// replaces hands over what it owed: the arrival waiting on its last step, and its catch-up
    /// write, so a put-back or a new value that cuts it short still answers both.
    pub(crate) fn start(&mut self, slot: Slot, mut run: Run, cx: Ctx, out: &mut Vec<Out>) {
        if let Some(old) = self.runs.remove(&slot) {
            run.answers |= old.answers;
            run.catch_up |= old.catch_up;
        }
        self.runs.insert(slot, run);
        self.step_run(slot, cx, out);
    }

    /// Ends `slot`'s run where it stands, as one that sent its last action.
    pub(crate) fn cut_short(&mut self, slot: Slot, cx: Ctx, out: &mut Vec<Out>) {
        if let Some(run) = self.runs.remove(&slot) {
            self.ended(slot, run, cx, out);
        }
    }

    /// Each run's actions that are due, and each run that ended.
    pub(crate) fn advance_runs(&mut self, cx: Ctx, out: &mut Vec<Out>) {
        let slots: Vec<Slot> = self.runs.keys().copied().collect();
        for slot in slots {
            self.step_run(slot, cx, out);
        }
    }

    /// Sends what's due of `slot`'s run: a chain's first action in the same call as the action
    /// before it, and each of its others its pace after the one before. `Run::planned` shows a
    /// write's plan in this spacing, so change both together.
    fn step_run(&mut self, slot: Slot, cx: Ctx, out: &mut Vec<Out>) {
        let frame = self.frame;
        loop {
            let Some(run) = self.runs.get_mut(&slot) else {
                return;
            };
            let due = match run.due {
                Due::Now => true,
                Due::Frame(f) => frame >= f,
                Due::At(t) => cx.at >= t,
            };
            if !due {
                return;
            }
            while run.chains.front().is_some_and(|c| c.times == 0) {
                run.chains.pop_front();
            }
            let Some(chain) = run.chains.front_mut() else {
                let run = self.runs.remove(&slot);
                if let Some(run) = run {
                    self.ended(slot, run, cx, out);
                }
                return;
            };
            chain.times -= 1;
            let action = chain.action.clone();
            let step = chain.step;
            let pace = chain.pace;
            let more = chain.times > 0;
            run.due = if more {
                match pace {
                    Pace::Frames(n) => Due::Frame(frame + u64::from(n)),
                    Pace::Ms(ms) => Due::At(cx.at + u64::from(ms) * 1_000),
                }
            } else {
                Due::Now
            };
            let checked = run.checked;
            let flags = run.flags;
            let tokens = run.tokens;
            if let (Some(by), Some(count)) = (step, run.count.as_mut()) {
                count.at = moved(*count, by);
                let value = Value::Number(count.at);
                if checked && let Slot::State(i) = slot {
                    self.pend(i, value, None, flags);
                }
            }
            if tokens {
                self.token(&action, cx);
            }
            out.push(Out::Act(action));
            if more {
                return;
            }
        }
    }

    /// A run sent its last action: its values pending from now, the arrival it answers
    /// applied, and its catch-up write made.
    fn ended(&mut self, slot: Slot, run: Run, cx: Ctx, out: &mut Vec<Out>) {
        if let Slot::State(i) = slot {
            if let Some(s) = self.state.get_mut(i) {
                for p in s.pending.iter_mut().filter(|p| p.due.is_none()) {
                    p.due = Some(cx.at + CHECK);
                }
            }
            if run.answers
                && let Some(s) = self.state.get(i)
            {
                out.push(Out::Stepped(s.entry.key.clone()));
            }
            if run.catch_up
                && let Some(c) = self.catch_up.as_mut()
            {
                c.outstanding.remove(&i);
            }
        }
        if let Slot::Event(i) = slot
            && run.answers
            && let Some(e) = self.events.get(i)
        {
            out.push(Out::Stepped(e.entry.key.clone()));
        }
    }
}
