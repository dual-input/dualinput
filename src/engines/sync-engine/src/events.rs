//! Event entries, and what keeps a change from applying twice: the tokens the engine's own
//! writes leave, an entry's `ignore`, and the input event double-fire filter; and the test for
//! an entry the aircraft drives itself (record/areas/sync/02-live-sync.md, "Keeping a change
//! from applying twice"; record/areas/sync/04-order-and-recovery.md, "Entries the aircraft drives
//! itself").

use profile_engine::{EventEntry, Name, Write};

use crate::runs::{Chain, Run, action};
use crate::script::RunFailed;
use crate::{
    Action, Applied, Change, ChangeKind, Ctx, Engine, Out, Role, Slot, Step, TOKEN, Value, Watch,
    Watching, Why,
};

/// The sim reported each of the PA-24's input events twice, one frame apart, so a report with
/// the same name and value as one from the last 3 frames drops, but never one more than 200ms
/// after it, since at a low frame rate 3 frames could reach a real repeat 261ms later (measured
/// on MSFS 2024, record/areas/sync/02-live-sync.md, "Keeping a change from applying twice").
const DOUBLE_FIRE_FRAMES: u64 = 3;
pub(crate) const DOUBLE_FIRE_MOST: u64 = 200_000;

/// The driven-entry test's values: an entry its own aircraft changed in each 3s window for 30s,
/// while another machine's change to it came too. The windows are fixed from the first change,
/// so a change every 3s, give or take a frame, hits each one. The 3s and the 30s are starting
/// values, which the record leaves open (record/areas/sync/04-order-and-recovery.md, "Left
/// open").
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
    /// The entry and the Sync log's row whose write or change left it.
    pub(crate) slot: Slot,
    pub(crate) row: u32,
}

impl Token {
    /// The name as a profile writes it, as `K('TOGGLE_FLIGHT_DIRECTOR')`, for the Sync log.
    fn shown(&self) -> String {
        match self.letter {
            'I' => format!("instrument('{}')", self.name),
            letter => format!("{letter}('{}')", self.name),
        }
    }
}

/// An input event's report, for the double-fire filter.
#[derive(Clone, Debug)]
pub(crate) struct Report {
    name: String,
    value: Option<f64>,
    frame: u64,
    pub(crate) at: u64,
    /// The entry and the row the report went to, which a second report of it joins.
    slot: Slot,
    row: u32,
}

/// What the double-fire filter makes of a report.
pub(crate) enum Reported {
    /// The report isn't an input event's.
    NotInput,
    /// The first report, kept at this place, whose entry and row the caller fills in.
    First(usize),
    /// The sim reporting again what it reported, which drops.
    Twice,
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

    /// Leaves a token for the occurrence an action of the engine's will make, for `slot`'s write
    /// of `row`.
    pub(crate) fn token(&mut self, action: &Action, cx: Ctx, slot: Slot, row: u32) {
        let (name, value) = match action {
            Action::Set { name, value } => (name, value.number()),
            Action::Key { name, .. } | Action::Fire { name } => (name, None),
        };
        self.leave_token(name, value, cx, slot, row);
    }

    pub(crate) fn leave_token(
        &mut self,
        name: &Name,
        value: Option<f64>,
        cx: Ctx,
        slot: Slot,
        row: u32,
    ) {
        let (letter, name) = ident(name);
        self.tokens.push(Token {
            letter,
            name: name.to_string(),
            value,
            until: cx.at + TOKEN,
            slot,
            row,
        });
    }

    /// Uses up the oldest token for `name`, and for a variable's, the value it came back at, and
    /// logs it on the row that left it, whose entry and row it returns.
    pub(crate) fn use_token(
        &mut self,
        name: &Name,
        value: Option<f64>,
        cx: Ctx,
    ) -> Option<(Slot, u32)> {
        let (letter, name) = ident(name);
        let found = self.tokens.iter().position(|t| {
            t.letter == letter
                && t.name == name
                && (t.value.is_none() || t.value.map(|v| v as f32) == value.map(|v| v as f32))
        })?;
        let token = self.tokens.remove(found);
        if !self.stopped(token.slot) {
            self.note_slot(token.slot, token.row, cx.at, || Step::TokenUsed);
        }
        Some((token.slot, token.row))
    }

    /// Whether `slot`'s entry stopped syncing, which ended every row of its with `stopped`, so a
    /// token or an `ignore` its rows left logs nothing more, and no row's verdict changes after
    /// the stop.
    fn stopped(&self, slot: Slot) -> bool {
        match slot {
            Slot::State(i) => self.state.get(i).is_some_and(|s| s.stopped),
            Slot::Event(i) => self.events.get(i).is_some_and(|e| e.stopped),
        }
    }

    /// Starts an entry's `ignore`, for `slot`'s change of `row`: the next occurrence of each name
    /// within 1s is the entry's own consequence.
    pub(crate) fn start_ignores(&mut self, names: &[Name], cx: Ctx, slot: Slot, row: u32) {
        for name in names {
            let (letter, name) = ident(name);
            self.ignores.push(Token {
                letter,
                name: name.to_string(),
                value: None,
                until: cx.at + TOKEN,
                slot,
                row,
            });
        }
    }

    /// Uses up the oldest `ignore` for `name`, and logs it on the row that started it, whose
    /// entry and row it returns.
    fn use_ignore(&mut self, name: &Name, cx: Ctx) -> Option<(Slot, u32)> {
        let (letter, name) = ident(name);
        let found = self
            .ignores
            .iter()
            .position(|t| t.letter == letter && t.name == name)?;
        let ignore = self.ignores.remove(found);
        if !self.stopped(ignore.slot) {
            self.note_slot(ignore.slot, ignore.row, cx.at, || Step::Ignored {
                event: ignore.shown(),
            });
        }
        Some((ignore.slot, ignore.row))
    }

    /// Drops the tokens and `ignore`s whose time is up, each a step of the row that left it, since
    /// an aircraft that masks an event never reports it.
    pub(crate) fn expire(&mut self, cx: Ctx) {
        if !self.log.is_on() {
            self.tokens.retain(|t| t.until > cx.at);
            self.ignores.retain(|t| t.until > cx.at);
            return;
        }
        let (tokens, expired): (Vec<_>, Vec<_>) = std::mem::take(&mut self.tokens)
            .into_iter()
            .partition(|t| t.until > cx.at);
        self.tokens = tokens;
        let expired: Vec<_> = expired
            .into_iter()
            .filter(|t| !self.stopped(t.slot))
            .collect();
        for t in expired {
            self.note_slot(t.slot, t.row, cx.at, || Step::TokenExpired);
        }
        let (ignores, expired): (Vec<_>, Vec<_>) = std::mem::take(&mut self.ignores)
            .into_iter()
            .partition(|t| t.until > cx.at);
        self.ignores = ignores;
        let expired: Vec<_> = expired
            .into_iter()
            .filter(|t| !self.stopped(t.slot))
            .collect();
        for t in expired {
            self.note_slot(t.slot, t.row, cx.at, || Step::IgnoreExpired {
                event: t.shown(),
            });
        }
    }

    /// Whether an input event's report is the sim reporting one it already reported, which logs
    /// `reported twice` on the first report's row.
    pub(crate) fn double_fire(&mut self, name: &Name, value: Option<f64>, cx: Ctx) -> Reported {
        let Name::B { name } = name else {
            return Reported::NotInput;
        };
        let frame = self.frame;
        let first = self.reports.iter().find(|r| {
            &r.name == name
                && r.value.map(|v| v as f32) == value.map(|v| v as f32)
                && frame.saturating_sub(r.frame) <= DOUBLE_FIRE_FRAMES
                && cx.at.saturating_sub(r.at) <= DOUBLE_FIRE_MOST
        });
        if let Some(&Report { slot, row, .. }) = first {
            self.note_slot(slot, row, cx.at, || Step::ReportedTwice);
            return Reported::Twice;
        }
        self.reports.push(Report {
            name: name.clone(),
            value,
            frame,
            at: cx.at,
            slot: Slot::State(0),
            row: 0,
        });
        Reported::First(self.reports.len() - 1)
    }

    /// Gives a first report the entry and row it went to.
    pub(crate) fn reported_as(&mut self, reported: &Reported, slot: Slot, row: u32) {
        if let Reported::First(at) = *reported
            && let Some(r) = self.reports.get_mut(at)
        {
            r.slot = slot;
            r.row = row;
        }
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
        let reported = self.double_fire(&name, value, cx);
        if matches!(reported, Reported::Twice) {
            return;
        }
        let (slot, row) = match self.use_token(&name, None, cx) {
            Some(left) => left,
            None => match self.use_ignore(&name, cx) {
                Some(started) => started,
                None => (Slot::Event(i), self.occurred(i, value, cx, out)),
            },
        };
        self.reported_as(&reported, slot, row);
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
        if self.use_token(&name, None, cx).is_some() || self.use_ignore(&name, cx).is_some() {
            return;
        }
        // The occurrence carries the value the pulse rose to, so a write of the pulse's own
        // variable replays it, as the A350's cockpit sets a command variable to 1 for its module
        // to act on and clear (record/areas/sync/01-profile-entries.md, "Event entries").
        self.occurred(i, Some(now), cx, out);
    }

    /// An event entry's firing on this machine that no token or `ignore` explains, a local change
    /// of its own, whose row it returns, or 0 for none.
    fn occurred(&mut self, i: usize, value: Option<f64>, cx: Ctx, out: &mut Vec<Out>) -> u32 {
        // An entry that stopped syncing reads nothing more, so its firings start no row.
        if self.events.get(i).is_none_or(|e| e.stopped) || self.only_asked {
            return 0;
        }
        let row = self.row();
        let carried = value.map(Value::Number);
        self.note_event(i, row, cx.at, || Step::LocalChange { value: carried });
        let driven =
            cx.preflight_ended && self.events.get_mut(i).is_some_and(|e| e.driven.own(cx.at));
        if driven {
            self.stop(Slot::Event(i), Why::Driven, Some((row, cx.at)), out);
            return row;
        }
        if !cx.preflight_ended {
            self.note_event(i, row, cx.at, || Step::NotSentDuringPreflight);
            return row;
        }
        // A firing during this machine's catch-up is its pilot's own, which isn't sent, and an
        // event has nothing to put back.
        if cx.catching_up {
            self.note_event(i, row, cx.at, || Step::NotSent);
            return row;
        }
        let Some(slot) = self.events.get(i) else {
            return row;
        };
        let ignore = slot.entry.ignore.clone();
        out.push(Out::Send(Change {
            entry: slot.entry.key.clone(),
            value: value.map(Value::Number),
            kind: ChangeKind::Fired,
        }));
        // The stream holds no firing, so it goes as the engine hands it over.
        self.note_event(i, row, cx.at, || Step::Sent);
        self.start_ignores(&ignore, cx, Slot::Event(i), row);
        row
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
        let row = self.row();
        self.note_event(i, row, cx.at, || Step::Arrived {
            value: value.clone(),
        });
        if self.events.get(i).is_some_and(|e| e.stopped) {
            self.note_event(i, row, cx.at, || Step::SkippedStopped);
            return Applied::Skipped;
        }
        let Some(slot) = self.events.get_mut(i) else {
            return Applied::Skipped;
        };
        slot.driven.received(cx.at);
        let watched = slot.entry.watch.clone();
        let write = slot.entry.write.clone();
        let chains = match self.firing(i, write, value.as_ref()) {
            Ok(chains) => chains,
            Err(Unfired::NoValue(name)) => {
                tracing::info!(
                    entry = self.events.get(i).map(|e| e.entry.key.as_str()),
                    %name,
                    "an event entry's write sets a variable, and its firing carried no value to set"
                );
                self.note_event(i, row, cx.at, || Step::NoValue);
                return Applied::Skipped;
            }
            Err(Unfired::Failed(RunFailed::Limit(failed))) => {
                self.stop(
                    Slot::Event(i),
                    Why::Limit(failed.to_string()),
                    Some((row, cx.at)),
                    out,
                );
                return Applied::Skipped;
            }
            Err(Unfired::Failed(RunFailed::Compile(error))) => {
                tracing::info!(
                    entry = self.events.get(i).map(|e| e.entry.key.as_str()),
                    error,
                    "a write function didn't compile, so its entry stops"
                );
                self.stop(Slot::Event(i), Why::Compile(error), Some((row, cx.at)), out);
                return Applied::Skipped;
            }
            Err(Unfired::Failed(RunFailed::Wrong(error))) => {
                tracing::info!(
                    entry = self.events.get(i).map(|e| e.entry.key.as_str()),
                    error,
                    "a write function failed, so its firing made nothing"
                );
                self.note_event(i, row, cx.at, || Step::FunctionFailed { error });
                return Applied::Done;
            }
            Err(Unfired::Refused) => {
                tracing::warn!(
                    entry = self.events.get(i).map(|e| e.entry.key.as_str()),
                    "an event entry's write toggles, steps, or writes none, which its checker refuses"
                );
                return Applied::Skipped;
            }
        };
        self.leave_token(&watched, None, cx, Slot::Event(i), row);
        if chains.is_empty() {
            self.note_event(i, row, cx.at, || Step::Writes {
                actions: Vec::new(),
            });
        }
        let mut run = Run::new(chains);
        let stepping = run.takes_frames();
        run.answers = stepping;
        run.checked = false;
        run.row = row;
        self.start(Slot::Event(i), run, cx, out);
        if stepping {
            Applied::Stepping
        } else {
            Applied::Done
        }
    }

    /// The chains an event entry's `write` makes for a firing that carried `value`, or why it
    /// makes none.
    pub(crate) fn firing(
        &mut self,
        i: usize,
        write: Write,
        value: Option<&Value>,
    ) -> Result<Vec<Chain>, Unfired> {
        match write {
            Write::Name(name @ (Name::L { .. } | Name::A { .. })) if value.is_none() => {
                Err(Unfired::NoValue(name))
            }
            Write::Name(name) => Ok(vec![Chain {
                action: action(&name, value),
                times: 1,
                pace: self.pace,
                step: None,
            }]),
            Write::Function(_) => self
                .script
                .run(Slot::Event(i), value)
                .map(|ran| self.chains_of(ran.written))
                .map_err(Unfired::Failed),
            // The checker refuses each of these on an event entry, which has no value of the
            // cockpit's to compare or step from (record/areas/profiles/01-format-and-delivery.md,
            // "What fails a load").
            Write::Toggle(_) | Write::Steps(_) | Write::None => Err(Unfired::Refused),
        }
    }
}

/// Why an event entry's write made nothing.
pub(crate) enum Unfired {
    /// It sets this variable, and the firing carried no value to set it to.
    NoValue(Name),
    Failed(RunFailed),
    /// It toggles, steps, or writes none, which the checker refuses.
    Refused,
}
