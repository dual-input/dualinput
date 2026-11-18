//! Event entries, and what keeps a change from applying twice: the tokens the engine's own
//! writes leave, an entry's `ignore`, and the input event double-fire filter; and the test for
//! an entry the aircraft drives itself (record/areas/sync/02-live-sync.md, "Keeping a change
//! from applying twice"; record/areas/sync/04-order-and-recovery.md, "Entries the aircraft drives
//! itself").

use profile_engine::{EventEntry, Name, Write};

use crate::runs::{Chain, Run, action};
use crate::script::RunFailed;
use crate::{
    Action, Applied, Change, ChangeKind, Ctx, Engine, Out, Role, Slot, TOKEN, Value, Watch,
    Watching, Why,
};

/// The sim reported each of the PA-24's input events twice, one frame apart (measured on MSFS
/// 2024, 2026-10-05, record/areas/sync/log.md), so a report with the same name and value as one
/// from the last 3 frames drops, but never one more than 200ms after it, since at a low frame
/// rate 3 frames could reach a real repeat 261ms later (measured on MSFS 2024, 2026-08-23,
/// fsc-editor, docs/sim-vars/build/v1-log.md).
const DOUBLE_FIRE_FRAMES: u64 = 3;
pub(crate) const DOUBLE_FIRE_MOST: u64 = 200_000;

/// The driven-entry test's starting values, which v1's recordings tune: an entry its own
/// aircraft changed in each 3s window for 30s, while another machine's change to it came too.
/// The windows are fixed from the first change, so a change every 3s, give or take a frame, hits
/// each one.
const DRIVEN_EVERY: u64 = 3_000_000;
const DRIVEN_WINDOWS: u64 = 10;

/// What a name is, whatever its unit or its values, which tokens and reports compare.
pub(crate) fn ident(name: &Name) -> (char, &str) {
    match name {
        Name::L { name, .. } => ('L', name),
        Name::A { name, .. } => ('A', name),
        Name::B { name } => ('B', name),
        Name::K { name, .. } => ('K', name),
        Name::H { name } => ('H', name),
        Name::Instrument { key, .. } => ('I', key),
    }
}

/// An occurrence the engine expects: one its own write made, or a consequence to ignore.
#[derive(Clone, Debug)]
pub(crate) struct Token {
    letter: char,
    name: String,
    /// For a variable the engine set, the value its reading comes back at.
    value: Option<f64>,
    pub(crate) until: u64,
}

/// An input event's report, for the double-fire filter.
#[derive(Clone, Debug)]
pub(crate) struct Report {
    name: String,
    value: Option<f64>,
    frame: u64,
    pub(crate) at: u64,
}

/// The driven-entry test's count for one entry.
#[derive(Clone, Debug, Default)]
pub(crate) struct Driven {
    since: Option<u64>,
    /// The window of the latest change, counted from `since`'s.
    window: u64,
    received: Option<u64>,
}

impl Driven {
    /// This machine's aircraft changed or fired the entry, other than by Dual Input's write.
    /// Returns whether the entry now counts as driven: a change in every window for 30s, and
    /// another machine's since the first.
    pub(crate) fn own(&mut self, at: u64) -> bool {
        let window = self
            .since
            .map(|since| at.saturating_sub(since) / DRIVEN_EVERY);
        match window {
            Some(w) if w <= self.window + 1 => self.window = w,
            _ => {
                self.since = Some(at);
                self.window = 0;
            }
        }
        let since = self.since.unwrap_or(at);
        self.window >= DRIVEN_WINDOWS && self.received.is_some_and(|r| r >= since)
    }

    pub(crate) fn received(&mut self, at: u64) {
        self.received = Some(at);
    }
}

pub(crate) struct EventSlot {
    pub(crate) entry: EventEntry,
    pub(crate) stopped: bool,
    driven: Driven,
    /// A pulse's value, as last read, whose rise from 0 is an occurrence.
    pulse: Option<f64>,
}

impl Engine {
    pub(crate) fn add_event(&mut self, entry: &EventEntry) {
        let i = self.events.len();
        self.keys.insert(entry.key.clone(), Slot::Event(i));
        let (watching, role) = match entry.watch {
            Name::L { .. } => (Watching::Pulse, Role::Pulse(i)),
            _ => (Watching::Occurrence, Role::Event(i)),
        };
        self.watches.push(Watch {
            name: entry.watch.clone(),
            watching,
            entry: entry.key.clone(),
        });
        self.roles.push(role);
        self.events.push(EventSlot {
            entry: entry.clone(),
            stopped: false,
            driven: Driven::default(),
            pulse: None,
        });
    }

    /// Leaves a token for the occurrence an action of the engine's will make.
    pub(crate) fn token(&mut self, action: &Action, cx: Ctx) {
        let (name, value) = match action {
            Action::Set { name, value } => (name, value.number()),
            Action::Key { name, .. } | Action::Fire { name } => (name, None),
        };
        self.leave_token(name, value, cx);
    }

    fn leave_token(&mut self, name: &Name, value: Option<f64>, cx: Ctx) {
        let (letter, name) = ident(name);
        self.tokens.push(Token {
            letter,
            name: name.to_string(),
            value,
            until: cx.at + TOKEN,
        });
    }

    /// Uses up the oldest token for `name`, and for a variable's, the value it came back at.
    pub(crate) fn use_token(&mut self, name: &Name, value: Option<f64>) -> bool {
        let (letter, name) = ident(name);
        let found = self.tokens.iter().position(|t| {
            t.letter == letter
                && t.name == name
                && (t.value.is_none() || t.value.map(|v| v as f32) == value.map(|v| v as f32))
        });
        found.map(|i| self.tokens.remove(i)).is_some()
    }

    /// Starts an entry's `ignore`: the next occurrence of each name within 1s is the entry's own
    /// consequence.
    pub(crate) fn start_ignores(&mut self, names: &[Name], cx: Ctx) {
        for name in names {
            let (letter, name) = ident(name);
            self.ignores.push(Token {
                letter,
                name: name.to_string(),
                value: None,
                until: cx.at + TOKEN,
            });
        }
    }

    fn use_ignore(&mut self, name: &Name) -> bool {
        let (letter, name) = ident(name);
        let found = self
            .ignores
            .iter()
            .position(|t| t.letter == letter && t.name == name);
        found.map(|i| self.ignores.remove(i)).is_some()
    }

    /// Whether an input event's report is the sim reporting one it already reported.
    pub(crate) fn double_fire(&mut self, name: &Name, value: Option<f64>, cx: Ctx) -> bool {
        let Name::B { name } = name else {
            return false;
        };
        let frame = self.frame;
        let twice = self.reports.iter().any(|r| {
            &r.name == name
                && r.value.map(|v| v as f32) == value.map(|v| v as f32)
                && frame.saturating_sub(r.frame) <= DOUBLE_FIRE_FRAMES
                && cx.at.saturating_sub(r.at) <= DOUBLE_FIRE_MOST
        });
        if !twice {
            self.reports.push(Report {
                name: name.clone(),
                value,
                frame,
                at: cx.at,
            });
        }
        twice
    }

    /// An event entry's `K:`, `H:`, or `B:` event fired on this machine.
    pub(crate) fn event_fired(
        &mut self,
        i: usize,
        value: Option<f64>,
        cx: Ctx,
        out: &mut Vec<Out>,
    ) {
        let Some(name) = self.events.get(i).map(|e| e.entry.watch.clone()) else {
            return;
        };
        if self.double_fire(&name, value, cx)
            || self.use_token(&name, None)
            || self.use_ignore(&name)
        {
            return;
        }
        self.occurred(i, value, cx, out);
    }

    /// A pulse's reading: each rise from 0 is an occurrence.
    pub(crate) fn pulse(&mut self, i: usize, value: Value, cx: Ctx, out: &mut Vec<Out>) {
        let Some(slot) = self.events.get_mut(i) else {
            return;
        };
        let now = value.number().unwrap_or(0.0);
        let before = slot.pulse.replace(now);
        if before != Some(0.0) || now == 0.0 {
            return;
        }
        let name = slot.entry.watch.clone();
        if self.use_token(&name, None) || self.use_ignore(&name) {
            return;
        }
        // The occurrence carries the value the pulse rose to, so a write of the pulse's own
        // variable replays it, as the A350's cockpit sets a command variable to 1 for its module
        // to act on and clear (record/areas/sync/01-profile-entries.md, "Event entries").
        self.occurred(i, Some(now), cx, out);
    }

    fn occurred(&mut self, i: usize, value: Option<f64>, cx: Ctx, out: &mut Vec<Out>) {
        let Some(slot) = self.events.get_mut(i) else {
            return;
        };
        if slot.stopped {
            return;
        }
        if cx.preflight_ended && slot.driven.own(cx.at) {
            return self.stop(Slot::Event(i), Why::Driven, out);
        }
        // A firing during this machine's catch-up is its pilot's own, which isn't sent, and an
        // event has nothing to put back.
        if !cx.preflight_ended || cx.catching_up {
            return;
        }
        let ignore = slot.entry.ignore.clone();
        out.push(Out::Send(Change {
            entry: slot.entry.key.clone(),
            value: value.map(Value::Number),
            kind: ChangeKind::Fired,
        }));
        self.start_ignores(&ignore, cx);
    }

    /// Another machine's firing, which the engine fires through the entry's `write`, leaving a
    /// token for the name the entry watches, so the aircraft's report of it isn't sent back.
    pub(crate) fn arrived_firing(
        &mut self,
        i: usize,
        value: Option<Value>,
        cx: Ctx,
        out: &mut Vec<Out>,
    ) -> Applied {
        let Some(slot) = self.events.get_mut(i) else {
            return Applied::Skipped;
        };
        if slot.stopped {
            return Applied::Skipped;
        }
        slot.driven.received(cx.at);
        let watched = slot.entry.watch.clone();
        let chains = match slot.entry.write.clone() {
            Write::Name(name @ (Name::L { .. } | Name::A { .. })) if value.is_none() => {
                tracing::info!(
                    entry = slot.entry.key,
                    %name,
                    "an event entry's write sets a variable, and its firing carried no value to set"
                );
                return Applied::Skipped;
            }
            Write::Name(name) => vec![Chain {
                action: action(&name, value.as_ref()),
                times: 1,
                pace: self.pace,
                step: None,
            }],
            Write::Function(_) => match self.script.run(Slot::Event(i), value.as_ref()) {
                Ok(ran) => self.chains_of(ran.written),
                Err(RunFailed::Limit(failed)) => {
                    self.stop(Slot::Event(i), Why::Limit(failed.to_string()), out);
                    return Applied::Skipped;
                }
                Err(RunFailed::Wrong(error)) => {
                    tracing::info!(
                        entry = self.events.get(i).map(|e| e.entry.key.as_str()),
                        error,
                        "a write function failed, so its firing made nothing"
                    );
                    return Applied::Done;
                }
            },
            // The checker refuses each of these on an event entry, which has no value of the
            // cockpit's to compare or step from (record/areas/profiles/01-format-and-delivery.md,
            // "What fails a load").
            Write::Toggle(_) | Write::Steps(_) | Write::None => {
                tracing::warn!(
                    entry = self.events.get(i).map(|e| e.entry.key.as_str()),
                    "an event entry's write toggles, steps, or writes none, which its checker refuses"
                );
                return Applied::Skipped;
            }
        };
        self.leave_token(&watched, None, cx);
        let mut run = Run::new(chains);
        let stepping = run.takes_frames();
        run.answers = stepping;
        run.checked = false;
        self.start(Slot::Event(i), run, cx, out);
        if stepping {
            Applied::Stepping
        } else {
            Applied::Done
        }
    }
}
