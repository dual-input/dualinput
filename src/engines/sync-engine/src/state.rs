//! State entries: the state object, telling the echo of a write from this machine's own
//! change, who sends and putting back, the conflict rule, the check, shadow values, and
//! catch-up (record/areas/sync/05-units.md, "The sync engine").

use profile_engine::{Owner, StateEntry, Watch as Watches, Write};

use crate::events::Driven;
use crate::runs::{Chain, Count, Run, action, steps, wrapped};
use crate::script::RunFailed;
use crate::{
    Applied, CHECK, CatchUpEntry, CatchUpRun, CatchUpState, Change, ChangeKind, Ctx, Engine, Flag,
    Flagged, MOST_BYTES, Out, Ready, Role, Slot, Stamp, Value, VectorClock, Watch, Watching, Why,
};

/// How many of an entry's distinct values catch-up's order remembers when the cockpit first
/// took (record/areas/sync/05-units.md, "Catch-up's order").
const HISTORY: usize = 16;

pub(crate) struct StateSlot {
    pub(crate) entry: StateEntry,
    /// The entry's value in the state object: the reading, or the shadow of a counting entry.
    pub(crate) reading: Option<Value>,
    /// The value this machine holds for the entry as synced, which a put-back writes.
    pub(crate) held: Option<Value>,
    /// The stamp of the value it holds, which the conflict rule compares.
    pub(crate) stamp: Option<Stamp>,
    /// Values the engine wrote that no reading has matched yet, oldest first.
    pub(crate) pending: Vec<Pending>,
    /// When the cockpit first took each of the entry's latest distinct values, the one it took
    /// longest ago first.
    history: Vec<(Value, u64)>,
    /// A write held until the entry's first reading, so a toggle never flips blind.
    waiting: Option<(Value, How)>,
    /// A change handed to the stream that it hasn't sent yet.
    sending: Option<Value>,
    last_sent: Option<Value>,
    pub(crate) stopped: bool,
    driven: Driven,
    /// A counting entry's `count` variable, as last read.
    count_at: Option<f64>,
    /// A watch-only entry's values from other machines, each with when to compare it.
    compare: Vec<(Value, u64)>,
    refused: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct Pending {
    pub(crate) value: Value,
    /// When it's flagged, or `None` while its write's run still sends.
    pub(crate) due: Option<u64>,
    /// Whether it's flagged when it's due, or only dropped.
    pub(crate) flags: bool,
}

/// How a write goes.
#[derive(Clone, Copy, Debug)]
pub(crate) struct How {
    /// Its values go pending and are checked, which a put-back's aren't.
    checked: bool,
    /// Whether a value still pending at its check is flagged; it's dropped either way.
    flags: bool,
    /// An arrival waits on it.
    answers: bool,
    catch_up: bool,
}

const ARRIVAL: How = How {
    checked: true,
    flags: true,
    answers: true,
    catch_up: false,
};
const PUT_BACK: How = How {
    checked: false,
    flags: false,
    answers: false,
    catch_up: false,
};
const CATCH_UP: How = How {
    checked: true,
    flags: true,
    answers: false,
    catch_up: true,
};

impl How {
    /// How `how` goes for `owner`'s entry on this machine. On a following machine, flight-model
    /// sync's routine `Follow` freezes the aircraft and writes its pose, and the aircraft's
    /// own systems still move what the PF owns, as its autopilot trims, faster than putting it
    /// back brings it home, so a flag there would only report the trim in every flight on
    /// autopilot (measured on MSFS 2024, 2026-11-17, record/areas/sync/log.md, "A preset called
    /// with a value from our WASM module took only its first value, and from a panel it took
    /// every one"). Its values still go pending, so the echo of the write is still its own.
    /// The PF's machine writes those entries' last values as it takes control, when they count.
    fn for_owner(self, owner: Owner, cx: Ctx) -> How {
        let following = owner == Owner::PilotFlying && !cx.flying();
        How {
            flags: self.flags && !following,
            ..self
        }
    }
}

impl StateSlot {
    fn counted(&self) -> Option<&profile_engine::Count> {
        match &self.entry.watch {
            Watches::Count(c) => Some(c),
            Watches::Name(_) => None,
        }
    }

    fn watch_only(&self) -> bool {
        matches!(self.entry.write, Write::None)
    }

    /// Notes that the cockpit took `value` at `at`, keeping when it first took each value.
    fn took(&mut self, value: &Value, at: u64) {
        let first = match self.history.iter().position(|(v, _)| v.same(value)) {
            Some(i) => self.history.remove(i).1,
            None => at,
        };
        self.history.push((value.clone(), first));
        if self.history.len() > HISTORY {
            self.history.remove(0);
        }
    }

    fn first_took(&self, value: &Value) -> Option<u64> {
        self.history
            .iter()
            .find(|(v, _)| v.same(value))
            .map(|(_, at)| *at)
    }
}

/// A count moved to `to`, going round its range or stopping at its ends.
fn counted_to(c: &profile_engine::Count, to: f64) -> f64 {
    let (lo, hi) = c.range;
    if c.wrap {
        wrapped(to, lo, hi, c.step)
    } else {
        to.clamp(lo.min(hi), hi.max(lo))
    }
}

impl Engine {
    pub(crate) fn add_state(&mut self, entry: &StateEntry) {
        let i = self.state.len();
        self.keys.insert(entry.key.clone(), Slot::State(i));
        let mut watch = |name: &profile_engine::Name, watching, role| {
            self.watches.push(Watch {
                name: name.clone(),
                watching,
                entry: entry.key.clone(),
            });
            self.roles.push(role);
        };
        let reading = match &entry.watch {
            Watches::Name(name) => {
                watch(name, Watching::Value, Role::Value(i));
                None
            }
            Watches::Count(c) => {
                for (name, role) in [
                    (&c.inc, Role::Inc(i)),
                    (&c.dec, Role::Dec(i)),
                    (&c.set, Role::Set(i)),
                ] {
                    if let Some(name) = name {
                        watch(name, Watching::Occurrence, role);
                    }
                }
                if let Some(name) = &c.count {
                    watch(name, Watching::Value, Role::Count(i));
                }
                Some(Value::Number(c.default))
            }
        };
        let mut slot = StateSlot {
            entry: entry.clone(),
            reading: None,
            held: None,
            stamp: None,
            pending: Vec::new(),
            history: Vec::new(),
            waiting: None,
            sending: None,
            last_sent: None,
            stopped: false,
            driven: Driven::default(),
            count_at: None,
            compare: Vec::new(),
            refused: false,
        };
        // A shadow starts at its default, taken at the load.
        if let Some(value) = reading {
            slot.took(&value, self.loaded_at);
            slot.reading = Some(value);
        }
        self.state.push(slot);
    }

    /// Compiles every write function, after every entry is in, so `state` starts whole.
    pub(crate) fn compile(&mut self, profile: &profile_engine::Resolved, out: &mut Vec<Out>) {
        let functions = profile
            .state
            .iter()
            .enumerate()
            .map(|(i, e)| (Slot::State(i), &e.key, &e.write))
            .chain(
                profile
                    .events
                    .iter()
                    .enumerate()
                    .map(|(i, e)| (Slot::Event(i), &e.key, &e.write)),
            );
        for (slot, key, write) in functions {
            let Write::Function(js) = write else { continue };
            if let Err(error) = self.script.compile(slot, js) {
                tracing::info!(
                    entry = key,
                    error,
                    "a write function didn't compile, so its entry stops"
                );
                self.stop(slot, Why::Compile(error), out);
            }
        }
        for slot in &self.state {
            self.script.note(&slot.entry.key, slot.reading.clone());
        }
    }

    /// An entry's reading, from a variable, an input event, or an instrument.
    pub(crate) fn reading(&mut self, i: usize, value: Value, cx: Ctx, out: &mut Vec<Out>) {
        let Some(slot) = self.state.get_mut(i) else {
            return;
        };
        let Some(reading) = &slot.reading else {
            // The first reading counts as taken at the load, and lets a held write go.
            slot.took(&value, self.loaded_at);
            slot.reading = Some(value.clone());
            self.script.note(&slot.entry.key, Some(value));
            if let Some((wanted, how)) = slot.waiting.take() {
                let how = How {
                    answers: false,
                    ..how
                };
                self.write(i, wanted, how, cx, out);
                if how.catch_up && !self.runs.contains_key(&Slot::State(i)) {
                    self.made(i);
                }
            }
            return;
        };
        if reading.same(&value) {
            return;
        }
        slot.took(&value, cx.at);
        slot.reading = Some(value.clone());
        self.script.note(&slot.entry.key, Some(value.clone()));
        // A reading that equals a value the engine wrote is its echo, and clears it and every
        // value pending before it; one that equals none is this machine's own change.
        if let Some(p) = slot.pending.iter().position(|p| p.value.same(&value)) {
            slot.pending.drain(..=p);
            return;
        }
        self.own_change(i, value, cx, out);
    }

    /// A counting entry's `inc`, `dec`, or `set`.
    pub(crate) fn counted_event(
        &mut self,
        i: usize,
        role: Role,
        value: Option<f64>,
        cx: Ctx,
        out: &mut Vec<Out>,
    ) {
        let Some(slot) = self.state.get(i) else {
            return;
        };
        let Some(c) = slot.counted().cloned() else {
            return;
        };
        let shadow = slot
            .reading
            .as_ref()
            .and_then(Value::number)
            .unwrap_or(c.default);
        let (name, to) = match role {
            Role::Inc(_) => (c.inc.as_ref(), shadow + c.step),
            Role::Dec(_) => (c.dec.as_ref(), shadow - c.step),
            _ => (c.set.as_ref(), value.unwrap_or(shadow)),
        };
        if name.is_some_and(|n| self.double_fire(n, value, cx)) {
            return;
        }
        let ours = name.is_some_and(|n| self.use_token(n, None));
        self.shadow_to(i, &c, to, ours, cx, out);
    }

    /// A counting entry's `count` variable, whose change is added to the shadow.
    pub(crate) fn counted_variable(&mut self, i: usize, value: Value, cx: Ctx, out: &mut Vec<Out>) {
        let Some(slot) = self.state.get_mut(i) else {
            return;
        };
        let (Some(c), Some(now)) = (slot.counted().cloned(), value.number()) else {
            return;
        };
        let Some(before) = slot.count_at.replace(now) else {
            return;
        };
        let shadow = slot
            .reading
            .as_ref()
            .and_then(Value::number)
            .unwrap_or(c.default);
        let ours = c
            .count
            .as_ref()
            .is_some_and(|n| self.use_token(n, Some(now)));
        self.shadow_to(i, &c, shadow + (now - before), ours, cx, out);
    }

    fn shadow_to(
        &mut self,
        i: usize,
        c: &profile_engine::Count,
        to: f64,
        ours: bool,
        cx: Ctx,
        out: &mut Vec<Out>,
    ) {
        let value = Value::Number(counted_to(c, to));
        let Some(slot) = self.state.get_mut(i) else {
            return;
        };
        if slot.reading.as_ref().is_some_and(|r| r.same(&value)) {
            return;
        }
        slot.took(&value, cx.at);
        slot.reading = Some(value.clone());
        self.script.note(&slot.entry.key, Some(value.clone()));
        if !ours {
            self.own_change(i, value, cx, out);
        }
    }

    pub(crate) fn refused(&mut self, i: usize, _out: &mut Vec<Out>) {
        let Some(slot) = self.state.get_mut(i) else {
            return;
        };
        slot.refused = true;
        if let Some((_, how)) = slot.waiting.take() {
            tracing::info!(
                entry = slot.entry.key,
                "the sim refused an entry's read, so the write held for it dropped"
            );
            if how.catch_up {
                self.made(i);
            }
        }
    }

    /// A change this machine's sim reports that Dual Input didn't write.
    fn own_change(&mut self, i: usize, value: Value, cx: Ctx, out: &mut Vec<Out>) {
        let Some(slot) = self.state.get_mut(i) else {
            return;
        };
        if slot.stopped {
            return;
        }
        let shared = slot.entry.owner == Owner::Shared;
        if shared && cx.preflight_ended && slot.driven.own(cx.at) {
            return self.stop(Slot::State(i), Why::Driven, out);
        }
        // The rest of sync starts at preflight's end.
        if !cx.preflight_ended {
            return;
        }
        let Some(slot) = self.state.get(i) else {
            return;
        };
        let may_not_send = (!shared && !cx.flying()) || cx.catching_up;
        if may_not_send {
            if slot.watch_only() {
                return;
            }
            // A put-back that still steps carries on, since each reading it passes would start it
            // again.
            if self.runs.get(&Slot::State(i)).is_some_and(|r| r.put_back) {
                return;
            }
            if let Some(held) = slot.held.clone().filter(|h| !h.same(&value)) {
                self.write(i, held, PUT_BACK, cx, out);
            }
            return;
        }
        self.send_state(i, value, cx, out);
    }

    fn send_state(&mut self, i: usize, value: Value, cx: Ctx, out: &mut Vec<Out>) {
        let Some(slot) = self.state.get_mut(i) else {
            return;
        };
        if let Value::Text(t) = &value
            && t.len() > MOST_BYTES
        {
            let bytes = t.len();
            return self.flag(i, Flagged::TooLarge { bytes }, out);
        }
        slot.held = Some(value.clone());
        let key = slot.entry.key.clone();
        // A change undone before the stream sent it never goes out.
        if slot.sending.is_some() && slot.last_sent.as_ref().is_some_and(|l| l.same(&value)) {
            slot.sending = None;
            out.push(Out::Withdraw(key));
            return;
        }
        slot.sending = Some(value.clone());
        let kind = match slot.entry.owner {
            Owner::Shared => ChangeKind::Shared,
            Owner::PilotFlying => ChangeKind::PilotFlying,
        };
        let ignore = slot.entry.ignore.clone();
        out.push(Out::Send(Change {
            entry: key,
            value: Some(value),
            kind,
        }));
        self.start_ignores(&ignore, cx);
    }

    pub(crate) fn state_sent(&mut self, i: usize, stamp: Stamp) {
        if let Some(slot) = self.state.get_mut(i) {
            if let Some(sent) = slot.sending.take() {
                slot.last_sent = Some(sent);
            }
            slot.stamp = Some(stamp);
        }
    }

    /// Another machine's change to a state entry.
    pub(crate) fn arrived_change(
        &mut self,
        i: usize,
        value: Value,
        stamp: Stamp,
        cx: Ctx,
        out: &mut Vec<Out>,
    ) -> Applied {
        let Some(slot) = self.state.get_mut(i) else {
            return Applied::Skipped;
        };
        if slot.stopped {
            return Applied::Skipped;
        }
        let shared = slot.entry.owner == Owner::Shared;
        if shared {
            slot.driven.received(cx.at);
        }
        if slot.watch_only() {
            slot.compare.push((value, cx.at + CHECK));
            slot.stamp = Some(stamp);
            return Applied::Done;
        }
        if shared {
            // A change the stream still holds has no clock yet, so it counts as made without
            // seeing the arrival.
            let wins = match &slot.sending {
                Some(_) => stamp.wins(&Stamp {
                    origin: cx.me,
                    number: u64::MAX,
                    clock: VectorClock::default(),
                    pilot_flying: cx.control.pf,
                }),
                None => slot.stamp.as_ref().is_none_or(|s| stamp.wins(s)),
            };
            if !wins {
                return Applied::Skipped;
            }
            if slot.sending.take().is_some() {
                out.push(Out::Withdraw(slot.entry.key.clone()));
            }
        }
        slot.stamp = Some(stamp);
        slot.held = Some(value.clone());
        let how = ARRIVAL.for_owner(slot.entry.owner, cx);
        self.write(i, value, how, cx, out)
    }

    /// Control passed to this machine: each PF-owned entry whose reading differs from the old
    /// PF's last value is written to that value once, so the machine takes control with the
    /// controls the old PF flew. While this machine followed, its own systems could move those
    /// entries away, as its autopilot ran the 58P's trim to full nose-down. The write doesn't
    /// hold a 58P's trim with its autopilot engaged: the autopilot, wound up while the aircraft
    /// was frozen, runs the trim away within a second of the write (measured on MSFS 2024,
    /// 2026-11-19, record/areas/flight-model/log.md, "After a handover the 58P's own autopilot
    /// rolls the aircraft and runs its trim, wound up while `Follow` held it frozen, which v1
    /// keeps as a known limit"). A toggle is left out, since a write of it still on its way would
    /// flip it back, and nothing but a pilot moves a switch.
    pub(crate) fn took_control(&mut self, cx: Ctx, out: &mut Vec<Out>) {
        if !cx.flying() {
            return;
        }
        for i in 0..self.state.len() {
            let Some(slot) = self.state.get(i) else {
                continue;
            };
            if slot.entry.owner != Owner::PilotFlying
                || slot.stopped
                || slot.watch_only()
                || matches!(slot.entry.write, Write::Toggle(_))
            {
                continue;
            }
            let (Some(held), Some(reading)) = (&slot.held, &slot.reading) else {
                continue;
            };
            if !held.same(reading) {
                let held = held.clone();
                self.write(i, held, PUT_BACK, cx, out);
            }
        }
    }

    /// Writes `wanted` into the entry through its `write`, as the engine chooses.
    fn write(&mut self, i: usize, wanted: Value, how: How, cx: Ctx, out: &mut Vec<Out>) -> Applied {
        let Some(slot) = self.state.get_mut(i) else {
            return Applied::Skipped;
        };
        let counted = slot.counted().cloned();
        if counted.is_none() && slot.reading.is_none() {
            if !slot.refused {
                slot.waiting = Some((wanted, how));
            }
            return Applied::Done;
        }
        let matches = slot.reading.as_ref().is_some_and(|r| r.same(&wanted));
        let checked = how.checked && counted.is_none();
        let slot_id = Slot::State(i);
        let run = match slot.entry.write.clone() {
            Write::None => return Applied::Done,
            Write::Name(name) => {
                if matches {
                    return Applied::Done;
                }
                Run::new(vec![Chain {
                    action: action(&name, Some(&wanted)),
                    times: 1,
                    pace: self.pace,
                    step: None,
                }])
            }
            Write::Toggle(name) => {
                if matches {
                    return Applied::Done;
                }
                Run::new(vec![Chain {
                    action: action(&name, None),
                    times: 1,
                    pace: self.pace,
                    step: None,
                }])
            }
            Write::Steps(s) => {
                // A new value while it steps aims again from its count, and one that comes
                // while its last step is still pending starts from that step, since the reading
                // can lag the last step by 2 frames.
                let from = match self.runs.get(&slot_id).and_then(|r| r.count) {
                    Some(count) => Some(count.at),
                    None => slot
                        .pending
                        .last()
                        .and_then(|p| p.value.number())
                        .or_else(|| slot.reading.as_ref().and_then(Value::number)),
                };
                let (Some(from), Some(to)) = (from, wanted.number()) else {
                    return Applied::Done;
                };
                let (wrap, range, step) = match &counted {
                    Some(c) => (Some(c.wrap), Some(c.range), s.step),
                    None => (s.wrap, s.range, s.step),
                };
                let (n, up) = steps(from, to, step, wrap, range);
                if n == 0 {
                    // Already at its count: a run still stepping elsewhere stops there.
                    self.cut_short(slot_id, cx, out);
                    return Applied::Done;
                }
                let mut run = Run::new(vec![Chain {
                    action: action(if up { &s.inc } else { &s.dec }, None),
                    times: n,
                    pace: s.pace.unwrap_or(self.pace),
                    step: Some(if up { step } else { -step }),
                }]);
                run.count = Some(Count {
                    at: from,
                    wrap: (wrap == Some(true)).then_some(range).flatten(),
                });
                run
            }
            Write::Function(_) => match self.script.run(slot_id, Some(&wanted)) {
                Ok(ran) => {
                    // Without the value a function returns, a reading the sim rounded matches
                    // no write and goes back to the crew as this pilot's change: the 58P's
                    // heading-bug preset turns degrees into 1/16,384ths of a turn, so a written
                    // 1° read back as 1.0107° (measured on MSFS 2024, 2026-11-16,
                    // record/areas/sync/log.md, "The drift after a handover was the host's
                    // heading bug, which no write moved after its first, and every `_Set` preset
                    // that missed took the value of its first call").
                    let reads = ran.reads.unwrap_or_else(|| wanted.clone());
                    // A cockpit that already reads that value reports no change for the check
                    // to match, as a catch-up's 252° finds 252.0044° already on the bug.
                    let there = self
                        .state
                        .get(i)
                        .and_then(|s| s.reading.as_ref())
                        .is_some_and(|r| r.same(&reads));
                    if checked && !there {
                        self.pend(i, reads, None, how.flags);
                    }
                    Run::new(self.chains_of(ran.written))
                }
                Err(RunFailed::Limit(failed)) => {
                    tracing::info!(entry = self.state.get(i).map(|s| s.entry.key.as_str()), %failed, "a write function reached a limit, so its entry stops on this machine");
                    self.stop(slot_id, Why::Limit(failed.to_string()), out);
                    return Applied::Skipped;
                }
                Err(RunFailed::Wrong(error)) => {
                    tracing::info!(
                        entry = self.state.get(i).map(|s| s.entry.key.as_str()),
                        error,
                        "a write function failed, so its write made nothing"
                    );
                    if checked {
                        self.pend(i, wanted, Some(cx.at + CHECK), how.flags);
                    }
                    return Applied::Done;
                }
            },
        };
        let mut run = run;
        let function = matches!(
            self.state.get(i).map(|s| &s.entry.write),
            Some(Write::Function(_))
        );
        // A name's or a toggle's value goes pending as it's written; a stepping write's goes
        // step by step, and a function's went pending whatever the run wrote.
        if checked && !function && run.count.is_none() {
            self.pend(i, wanted, None, how.flags);
        }
        run.checked = checked;
        run.flags = how.flags;
        run.put_back = !how.checked;
        // A counting entry hears its own write's events, which its tokens use up.
        run.tokens = counted.is_some();
        run.catch_up = how.catch_up;
        let stepping = run.takes_frames();
        run.answers = how.answers && stepping;
        self.start(slot_id, run, cx, out);
        if stepping && how.answers {
            Applied::Stepping
        } else {
            Applied::Done
        }
    }

    pub(crate) fn pend(&mut self, i: usize, value: Value, due: Option<u64>, flags: bool) {
        if let Some(slot) = self.state.get_mut(i) {
            slot.pending.push(Pending { value, due, flags });
        }
    }

    /// Values pending past their check, and watch-only values to compare.
    pub(crate) fn check(&mut self, cx: Ctx, out: &mut Vec<Out>) {
        for i in 0..self.state.len() {
            let Some(slot) = self.state.get_mut(i) else {
                continue;
            };
            let late: Vec<Value> = slot
                .pending
                .iter()
                .filter(|p| p.flags && p.due.is_some_and(|d| cx.at >= d))
                .map(|p| p.value.clone())
                .collect();
            slot.pending.retain(|p| p.due.is_none_or(|d| cx.at < d));
            let reading = slot.reading.clone();
            let (due, later): (Vec<_>, Vec<_>) =
                slot.compare.drain(..).partition(|(_, at)| cx.at >= *at);
            slot.compare = later;
            for (theirs, _) in due {
                if !reading.as_ref().is_some_and(|r| r.same(&theirs)) {
                    out.push(Out::Differ {
                        entry: slot.entry.key.clone(),
                        theirs,
                        mine: reading.clone(),
                    });
                }
            }
            if let Some(wanted) = late.into_iter().last() {
                self.flag(i, Flagged::NeverLanded { wanted, reading }, out);
            }
        }
        self.unread_catch_up(cx, out);
    }

    /// A catch-up write still held for its entry's first reading a check after the catch-up
    /// started is made, and flagged as never landed. Without this, an `instrument()` entry no
    /// panel reads holds the catch-up open, and the stream holds everything this machine sends
    /// for as long as it's open: six of the Baron 58P's did (measured on MSFS 2024, 2026-11-09,
    /// record/areas/sync/log.md).
    fn unread_catch_up(&mut self, cx: Ctx, out: &mut Vec<Out>) {
        let Some(c) = self.catch_up.as_ref() else {
            return;
        };
        if cx.at < c.started.saturating_add(CHECK) {
            return;
        }
        let unread: Vec<usize> = c
            .outstanding
            .iter()
            .copied()
            .filter(|&i| {
                self.state
                    .get(i)
                    .and_then(|s| s.waiting.as_ref())
                    .is_some_and(|(_, how)| how.catch_up)
            })
            .collect();
        for i in unread {
            let Some((wanted, _)) = self.state.get_mut(i).and_then(|s| s.waiting.take()) else {
                continue;
            };
            self.made(i);
            let reading = None;
            self.flag(i, Flagged::NeverLanded { wanted, reading }, out);
        }
    }

    /// Flags an entry each time, so the log has a line for every write that never lands, and
    /// state sync tells its pilot once for each load.
    pub(crate) fn flag(&mut self, i: usize, what: Flagged, out: &mut Vec<Out>) {
        let Some(slot) = self.state.get(i) else {
            return;
        };
        out.push(Out::Flag(Flag {
            entry: slot.entry.key.clone(),
            name: slot.entry.name.clone(),
            what,
        }));
    }

    /// Stops an entry syncing on this machine for the rest of the load.
    pub(crate) fn stop(&mut self, slot: Slot, why: Why, out: &mut Vec<Out>) {
        // An arrival waiting on the run's last step counts as applied, so the stream moves on.
        let answered = self.runs.remove(&slot).is_some_and(|r| r.answers);
        let (key, name) = match slot {
            Slot::State(i) => {
                let Some(s) = self.state.get_mut(i) else {
                    return;
                };
                s.stopped = true;
                s.pending.clear();
                s.waiting = None;
                if s.sending.take().is_some() {
                    out.push(Out::Withdraw(s.entry.key.clone()));
                }
                if let Some(c) = self.catch_up.as_mut() {
                    c.outstanding.remove(&i);
                }
                (s.entry.key.clone(), s.entry.name.clone())
            }
            Slot::Event(i) => {
                let Some(e) = self.events.get_mut(i) else {
                    return;
                };
                e.stopped = true;
                (e.entry.key.clone(), e.entry.name.clone())
            }
        };
        tracing::info!(
            entry = key,
            ?why,
            "an entry stops syncing on this machine for the rest of the load"
        );
        if answered {
            out.push(Out::Stepped(key.clone()));
        }
        out.push(Out::Stop {
            entry: key,
            name,
            why,
        });
    }

    fn made(&mut self, i: usize) {
        if let Some(c) = self.catch_up.as_mut() {
            c.outstanding.remove(&i);
        }
    }

    pub(crate) fn catch_up_progress(&mut self, out: &mut Vec<Out>) {
        let settled = self.settled;
        let Some(c) = self.catch_up.as_mut() else {
            return;
        };
        if !c.made && c.outstanding.is_empty() {
            c.made = true;
            out.push(Out::CatchUpMade);
        }
        if c.made && !c.done && settled {
            c.done = true;
            out.push(Out::CatchUpDone);
        }
    }

    /// On the flying machine: each state entry it syncs, at the value its cockpit holds, in the
    /// order the cockpit first took each value, those it held from the load first.
    pub fn give(&self) -> CatchUpState {
        let mut entries: Vec<(u64, CatchUpEntry)> = self
            .state
            .iter()
            .filter(|s| !s.stopped && !s.watch_only())
            .filter_map(|s| {
                let value = s.reading.clone()?;
                let at = s.first_took(&value).unwrap_or(self.loaded_at);
                Some((
                    at,
                    CatchUpEntry {
                        key: s.entry.key.clone(),
                        value,
                        stamp: s.stamp.clone(),
                    },
                ))
            })
            .collect();
        entries.sort_by_key(|(at, _)| *at);
        CatchUpState {
            entries: entries.into_iter().map(|(_, e)| e).collect(),
        }
    }

    /// On the catching-up machine: writes each entry its cockpit doesn't already match, once, at
    /// the flying machine's value, in the flying machine's order. A catch-up taken again, as
    /// when control passes during one, starts over and skips what already matches.
    pub fn take(&mut self, state: &CatchUpState, cx: Ctx) -> Vec<Out> {
        let mut out = Vec::new();
        self.catch_up = Some(CatchUpRun {
            started: cx.at,
            ..CatchUpRun::default()
        });
        for e in &state.entries {
            let Some(Slot::State(i)) = self.keys.get(&e.key).copied() else {
                continue;
            };
            let missed = self.ready == Ready::Missed;
            let Some(slot) = self.state.get_mut(i) else {
                continue;
            };
            if slot.stopped || slot.watch_only() {
                continue;
            }
            slot.held = Some(e.value.clone());
            slot.stamp = e.stamp.clone();
            // A core back from a restart lost its shadows, and its aircraft kept the controls it
            // had, which matched the flying machine's, so it takes the flying machine's shadows
            // as they stand.
            if slot.counted().is_some() && missed {
                slot.took(&e.value, cx.at);
                slot.reading = Some(e.value.clone());
                self.script.note(&e.key, Some(e.value.clone()));
                continue;
            }
            if slot.reading.as_ref().is_some_and(|r| r.same(&e.value)) {
                continue;
            }
            let how = CATCH_UP.for_owner(slot.entry.owner, cx);
            self.write(i, e.value.clone(), how, cx, &mut out);
            let outstanding = self.runs.contains_key(&Slot::State(i))
                || self.state.get(i).is_some_and(|s| s.waiting.is_some());
            if outstanding && let Some(c) = self.catch_up.as_mut() {
                c.outstanding.insert(i);
            }
        }
        self.catch_up_progress(&mut out);
        out
    }
}
