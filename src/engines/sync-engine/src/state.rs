//! State entries: the state object, telling a write's read back from a local change, who sends
//! and putting back, the conflict rule, the check, shadow values, and catch-up
//! (record/areas/sync/05-units.md, "The sync engine").

use profile_engine::{Owner, StateEntry, Steps, Watch as Watches, Write};

use crate::events::{Driven, Reported};
use crate::runs::{Chain, Count, Run, action, steps, wrapped};
use crate::script::RunFailed;
use crate::{
    Applied, CHECK, CatchUpEntry, CatchUpRun, CatchUpState, Change, ChangeKind, Ctx, Engine, Flag,
    Flagged, MOST_BYTES, Out, Ready, Role, Slot, Stamp, Step, Value, VectorClock, Watch, Watching,
    Why,
};

/// How many of an entry's distinct values catch-up's order remembers when the cockpit first
/// took (record/areas/sync/05-units.md, "Catch-up's order").
const HISTORY: usize = 16;

pub(crate) struct StateSlot {
    pub(crate) entry: StateEntry,
    /// The entry's value in the state object: the reading, or the shadow of a counting entry.
    pub(crate) reading: Option<Value>,
    /// The entry's synced value: the value of this machine's latest sent change, arrival, or
    /// catch-up, which a put-back writes.
    pub(crate) synced: Option<Value>,
    /// The Sync log's row that set the synced value, to which a write that waits belongs, since
    /// it writes the synced value as it goes.
    synced_row: u32,
    /// The stamp of the synced value, which the conflict rule compares.
    pub(crate) stamp: Option<Stamp>,
    /// Values the engine wrote that no reading has matched yet, oldest first.
    pub(crate) pending: Vec<Pending>,
    /// When the cockpit first took each of the entry's latest distinct values, the one it took
    /// longest ago first.
    history: Vec<(Value, u64)>,
    /// A write that waits for the entry's first reading, so a toggle never flips blind.
    awaiting_reading: Option<(Value, How)>,
    /// A change handed to the stream that it hasn't sent yet, and its row.
    sending: Option<Value>,
    sending_row: u32,
    last_sent: Option<Value>,
    pub(crate) stopped: bool,
    driven: Driven,
    /// A counting entry's `count` variable, as last read.
    count_at: Option<f64>,
    /// A watch-only entry's values from other machines, each with when to compare it and its
    /// row.
    compare: Vec<(Value, u64, u32)>,
    refused: bool,
}

/// An arrival's or a catch-up's write to the entry `i`, waiting for other writes or other
/// entries' pending values, in the order it came. It writes the entry's synced value when it
/// goes, which a newer arrival, a catch-up taken again, or this pilot's local change may have
/// moved since.
#[derive(Debug)]
pub(crate) struct Waiting {
    i: usize,
    how: How,
    /// Nothing pending kept it waiting at the last frame, so it goes at the next.
    ready: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct Pending {
    pub(crate) value: Value,
    /// When it's flagged, or `None` while its write's run still sends.
    pub(crate) due: Option<u64>,
    /// Whether it's flagged when it's due, or only dropped.
    pub(crate) flags: bool,
    /// The Sync log's row whose write it is.
    pub(crate) row: u32,
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
    /// own systems still move what the pilot flying owns, as its autopilot trims, faster than
    /// putting it back brings it home, so a flag there would only report the trim in every
    /// flight on autopilot (measured on MSFS 2024, 2026-11-17, record/areas/sync/log.md, "A
    /// preset called with a value from our WASM module took only its first value, and from a
    /// panel it took every one"). Its values still go pending, so the write's read back is
    /// still its own. The pilot flying's machine writes those entries' last values as it takes
    /// control, when they count.
    fn for_owner(self, owner: Owner, cx: Ctx) -> How {
        let following = owner == Owner::PilotFlying && !cx.flying();
        How {
            flags: self.flags && !following,
            ..self
        }
    }
}

impl StateSlot {
    pub(crate) fn counted(&self) -> Option<&profile_engine::Count> {
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
            synced: None,
            synced_row: 0,
            stamp: None,
            pending: Vec::new(),
            history: Vec::new(),
            awaiting_reading: None,
            sending: None,
            sending_row: 0,
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

    /// Holds every write function for its first run to compile, after every entry is in, so
    /// `state` starts whole.
    pub(crate) fn add_functions(&mut self, profile: &profile_engine::Resolved) {
        let functions = profile
            .state
            .iter()
            .enumerate()
            .map(|(i, e)| (Slot::State(i), &e.write))
            .chain(
                profile
                    .events
                    .iter()
                    .enumerate()
                    .map(|(i, e)| (Slot::Event(i), &e.write)),
            );
        for (slot, write) in functions {
            if let Write::Function(js) = write {
                self.script.add(slot, js);
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
            // The first reading counts as taken at the load, and lets a write that waits for it
            // go. It starts no row of the Sync log, since the engine only keeps it.
            slot.took(&value, self.loaded_at);
            slot.reading = Some(value.clone());
            let awaiting = slot.awaiting_reading.take();
            let row = slot.synced_row;
            // The step's value is the reading's, cloned only while the log is on.
            let logged = (awaiting.is_some() && self.log.is_on()).then(|| value.clone());
            self.script.note(&slot.entry.key, Some(value));
            if let Some((wanted, how)) = awaiting {
                if let Some(value) = logged {
                    self.note_state(i, row, cx.at, || Step::FirstReading { value });
                }
                let how = How {
                    answers: false,
                    ..how
                };
                self.write(i, wanted, how, row, cx, out);
                if how.catch_up && !self.outstanding(i) {
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
        // A reading that equals a value the engine wrote is that write's read back, and clears it
        // and every value pending before it; one that equals none is a local change.
        if let Some(p) = slot.pending.iter().position(|p| p.value.same(&value)) {
            let row = slot.pending[p].row;
            // Values of other rows that it clears end those rows, since a newer value of the
            // entry read back first; this row's own earlier values, as a stepping write's, log
            // nothing.
            let replaced: Vec<u32> = if self.log.is_on() {
                let mut rows: Vec<u32> = slot.pending[..p]
                    .iter()
                    .map(|q| q.row)
                    .filter(|&r| r != row)
                    .collect();
                rows.dedup();
                rows
            } else {
                Vec::new()
            };
            slot.pending.drain(..=p);
            if !self.log.is_on() {
                return;
            }
            // The row's write has landed once its last value reads back after its last step.
            let more = slot.pending.iter().any(|q| q.row == row);
            let stepping = self.runs.get(&Slot::State(i)).is_some_and(|r| r.row == row);
            for older in replaced {
                self.note_state(i, older, cx.at, || Step::Replaced);
            }
            let landed = !more && !stepping;
            self.note_state(i, row, cx.at, || Step::ReadBack { value, landed });
            return;
        }
        // A reading that brings the value a waiting write will write came from the write ahead
        // of it, as altitude hold's event turns vertical speed mode off, so it's no local change
        // either, and the waiting write finds it there.
        let brings = slot.synced.as_ref().is_some_and(|s| s.same(&value));
        let row = slot.synced_row;
        if brings && self.is_waiting(i) {
            self.note_state(i, row, cx.at, || Step::NowReads { value });
            return;
        }
        self.local_change(i, value, cx, out);
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
        let reported = match name {
            Some(n) => self.double_fire(n, value, cx),
            None => Reported::NotInput,
        };
        if matches!(reported, Reported::Twice) {
            return;
        }
        let used = name.and_then(|n| self.use_token(n, None, cx));
        let row = self.shadow_to(i, &c, to, used.is_some(), cx, out);
        let (slot, row) = used.unwrap_or((Slot::State(i), row));
        self.reported_as(&reported, slot, row);
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
        let used = c
            .count
            .as_ref()
            .and_then(|n| self.use_token(n, Some(now), cx));
        self.shadow_to(i, &c, shadow + (now - before), used.is_some(), cx, out);
    }

    /// Moves a counting entry's shadow to `to`, a local change unless a token of the engine's own
    /// step explains it, and returns the local change's row, or 0 for none.
    fn shadow_to(
        &mut self,
        i: usize,
        c: &profile_engine::Count,
        to: f64,
        ours: bool,
        cx: Ctx,
        out: &mut Vec<Out>,
    ) -> u32 {
        let value = Value::Number(counted_to(c, to));
        let Some(slot) = self.state.get_mut(i) else {
            return 0;
        };
        if slot.reading.as_ref().is_some_and(|r| r.same(&value)) {
            return 0;
        }
        slot.took(&value, cx.at);
        slot.reading = Some(value.clone());
        self.script.note(&slot.entry.key, Some(value.clone()));
        if ours {
            return 0;
        }
        self.local_change(i, value, cx, out)
    }

    pub(crate) fn refused(&mut self, i: usize, at: u64) {
        let Some(slot) = self.state.get_mut(i) else {
            return;
        };
        slot.refused = true;
        if let Some((_, how)) = slot.awaiting_reading.take() {
            tracing::info!(
                entry = slot.entry.key,
                "the sim refused an entry's read, so the write waiting for its first reading dropped"
            );
            let row = slot.synced_row;
            self.note_state(i, row, at, || Step::DroppedRefused);
            if how.catch_up {
                self.made(i);
            }
        }
    }

    /// A local change: one this machine's sim reports that Dual Input didn't write. Returns its
    /// row, or 0 when it starts none.
    fn local_change(&mut self, i: usize, value: Value, cx: Ctx, out: &mut Vec<Out>) -> u32 {
        // An entry that stopped syncing reads nothing more, so its changes start no row.
        if self.state.get(i).is_none_or(|s| s.stopped) || self.only_asked {
            return 0;
        }
        let row = self.row();
        self.note_state(i, row, cx.at, || Step::LocalChange {
            value: Some(value.clone()),
        });
        let Some(slot) = self.state.get_mut(i) else {
            return row;
        };
        let shared = slot.entry.owner == Owner::Shared;
        if shared && cx.preflight_ended && slot.driven.own(cx.at) {
            self.stop(Slot::State(i), Why::Driven, Some((row, cx.at)), out);
            return row;
        }
        // The rest of sync starts at preflight's end.
        if !cx.preflight_ended {
            self.note_state(i, row, cx.at, || Step::NotSentDuringPreflight);
            return row;
        }
        let Some(slot) = self.state.get(i) else {
            return row;
        };
        let may_not_send = (!shared && !cx.flying()) || cx.catching_up;
        if may_not_send {
            let watch_only = slot.watch_only();
            let synced = slot.synced.clone();
            // A put-back that still steps carries on, since each reading it passes would start it
            // again.
            let putting_back = self.runs.get(&Slot::State(i)).is_some_and(|r| r.put_back);
            match synced {
                _ if watch_only => self.note_state(i, row, cx.at, || Step::NotSent),
                _ if putting_back => self.note_state(i, row, cx.at, || Step::PutBackCarriesOn),
                Some(synced) if !synced.same(&value) => {
                    self.note_state(i, row, cx.at, || Step::PutBack {
                        value: synced.clone(),
                    });
                    self.write(i, synced, PUT_BACK, row, cx, out);
                }
                Some(_) => self.note_state(i, row, cx.at, || Step::MatchesSyncedValue),
                None => self.note_state(i, row, cx.at, || Step::NotSent),
            }
            return row;
        }
        self.send_state(i, value, row, cx, out);
        row
    }

    /// Makes `value`, from `row`, the entry's synced value. A write that waits belongs to the row
    /// that set the synced value, since it writes that value as it goes, so a newer row takes it
    /// over and the older row ends `replaced`.
    fn set_synced(&mut self, i: usize, value: Value, row: u32, at: u64) {
        let waits = self.log.is_on()
            && (self.is_waiting(i)
                || self
                    .state
                    .get(i)
                    .is_some_and(|s| s.awaiting_reading.is_some()));
        let Some(slot) = self.state.get_mut(i) else {
            return;
        };
        let older = slot.synced_row;
        slot.synced = Some(value);
        slot.synced_row = row;
        if waits && older != row {
            self.note_state(i, older, at, || Step::Replaced);
        }
    }

    fn send_state(&mut self, i: usize, value: Value, row: u32, cx: Ctx, out: &mut Vec<Out>) {
        if let Value::Text(t) = &value
            && t.len() > MOST_BYTES
        {
            let bytes = t.len();
            self.note_state(i, row, cx.at, || Step::TooLarge {
                bytes: bytes as u64,
            });
            return self.flag(i, Flagged::TooLarge { bytes }, out);
        }
        self.set_synced(i, value.clone(), row, cx.at);
        let Some(slot) = self.state.get_mut(i) else {
            return;
        };
        let key = slot.entry.key.clone();
        let unsent = slot.sending.is_some().then_some(slot.sending_row);
        // A change undone before the stream sent it never goes out.
        if unsent.is_some() && slot.last_sent.as_ref().is_some_and(|l| l.same(&value)) {
            slot.sending = None;
            out.push(Out::Withdraw(key));
            let why = crate::Withdrawal::Undone;
            if let Some(older) = unsent {
                self.note_state(i, older, cx.at, || Step::Withdrawn { why });
            }
            self.note_state(i, row, cx.at, || Step::Withdrawn { why });
            return;
        }
        slot.sending = Some(value.clone());
        slot.sending_row = row;
        if let Some(older) = unsent {
            self.note_state(i, older, cx.at, || Step::Replaced);
        }
        let Some(slot) = self.state.get(i) else {
            return;
        };
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
        self.start_ignores(&ignore, cx, Slot::State(i), row);
    }

    pub(crate) fn state_sent(&mut self, i: usize, stamp: Stamp, at: u64) {
        let Some(slot) = self.state.get_mut(i) else {
            return;
        };
        slot.stamp = Some(stamp);
        if let Some(sent) = slot.sending.take() {
            slot.last_sent = Some(sent);
            let row = slot.sending_row;
            self.note_state(i, row, at, || Step::Sent);
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
        let row = self.row();
        self.note_state(i, row, cx.at, || Step::Arrived {
            value: Some(value.clone()),
        });
        let Some(slot) = self.state.get_mut(i) else {
            return Applied::Skipped;
        };
        if slot.stopped {
            self.note_state(i, row, cx.at, || Step::SkippedStopped);
            return Applied::Skipped;
        }
        let shared = slot.entry.owner == Owner::Shared;
        if shared {
            slot.driven.received(cx.at);
        }
        if slot.watch_only() {
            slot.compare.push((value, cx.at + CHECK, row));
            slot.stamp = Some(stamp);
            self.note_state(i, row, cx.at, || Step::Compared);
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
                self.note_state(i, row, cx.at, || Step::Lost);
                return Applied::Skipped;
            }
            if slot.sending.take().is_some() {
                out.push(Out::Withdraw(slot.entry.key.clone()));
                let unsent = slot.sending_row;
                self.note_state(i, unsent, cx.at, || Step::Withdrawn {
                    why: crate::Withdrawal::Lost,
                });
                self.note_state(i, row, cx.at, || Step::Won);
            }
        }
        let Some(slot) = self.state.get_mut(i) else {
            return Applied::Skipped;
        };
        slot.stamp = Some(stamp);
        let owner = slot.entry.owner;
        self.set_synced(i, value.clone(), row, cx.at);
        let how = ARRIVAL.for_owner(owner, cx);
        self.write(i, value, how, row, cx, out)
    }

    /// Control passed to this machine: each entry the pilot flying owns whose reading differs
    /// from the old pilot flying's last value is written to that value once, so the machine
    /// takes control with the controls the old pilot flying flew. While this machine followed,
    /// its own systems could move those entries away, as its autopilot ran the 58P's trim to
    /// full nose-down. The write doesn't hold a 58P's trim with its autopilot engaged: the
    /// autopilot, wound up while the aircraft was frozen, runs the trim away within a second of
    /// the write (measured on MSFS 2024, 2026-11-19, record/areas/flight-model/log.md, "After a
    /// handover the 58P's own autopilot rolls the aircraft and runs its trim, wound up while
    /// `Follow` held it frozen, which v1 keeps as a known limit"). A toggle is left out, since a
    /// write of it still on its way would flip it back, and nothing but a pilot moves a switch.
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
            let (Some(synced), Some(reading)) = (&slot.synced, &slot.reading) else {
                continue;
            };
            if !synced.same(reading) {
                let synced = synced.clone();
                let row = self.row();
                self.note_state(i, row, cx.at, || Step::ControlPassed {
                    value: synced.clone(),
                });
                self.write(i, synced, PUT_BACK, row, cx, out);
            }
        }
    }

    /// Writes `wanted` into the entry through its `write`, or has it wait for `release`. A
    /// toggle, a stepping write, or a write function decides from the cockpit's readings, and
    /// another entry's write can change them a few frames later: on a 58P in vertical speed mode,
    /// altitude hold's `K:AP_ALT_HOLD` turns vertical speed mode off, and a vertical speed toggle
    /// that arrives with it, still reading the mode on, toggles it again and leaves the wrong
    /// mode. No route showed the autopilot taking an event in the frame it was sent, so a check
    /// made in the sim as the toggle goes reads the old mode too. So such a write waits while
    /// another entry has a value pending, and each write of an arrival or a catch-up after it
    /// waits for it, in order. A put-back goes at once, since it restores this machine's own
    /// control (measured on MSFS 2024, 2026-11-19, record/areas/sync/log.md, "No route showed an
    /// autopilot event's effect in the frame it was sent, so a guard in the sim reads the old
    /// mode, and the events of one frame apply in the order sent").
    fn write(
        &mut self,
        i: usize,
        wanted: Value,
        how: How,
        row: u32,
        cx: Ctx,
        out: &mut Vec<Out>,
    ) -> Applied {
        let waits = how.checked
            && self.state.get(i).is_some_and(|s| s.reading.is_some())
            && (!self.waiting.is_empty() || (self.decides(i) && self.pending_besides(i)));
        if !waits {
            return self.write_now(i, wanted, how, row, cx, out);
        }
        if self.log.is_on() {
            let ahead = self.ahead_of(i);
            self.note_state(i, row, cx.at, || Step::WaitsFor { ahead });
        }
        // A newer value for an entry whose write already waits keeps its place, as the stream
        // hands it over in place of the waiting arrival, and the waiting write takes the newer
        // value as it goes.
        match self.waiting.iter_mut().find(|b| b.i == i) {
            Some(waiting) => {
                waiting.how = How {
                    answers: waiting.how.answers || how.answers,
                    catch_up: waiting.how.catch_up || how.catch_up,
                    ..how
                };
            }
            None => self.waiting.push_back(Waiting {
                i,
                how,
                ready: false,
            }),
        }
        if how.answers {
            Applied::Stepping
        } else {
            Applied::Done
        }
    }

    /// What the entry's write waits for, by the entries' keys: the write that waits ahead of
    /// it, or, with none waiting, each other entry whose pending value its check would flag.
    fn ahead_of(&self, i: usize) -> Vec<String> {
        let key = |j: usize| self.state.get(j).map(|s| s.entry.key.clone());
        let place = self.waiting.iter().position(|b| b.i == i);
        let before = match place {
            Some(at) => at.checked_sub(1).and_then(|p| self.waiting.get(p)),
            None => self.waiting.back(),
        };
        if let Some(b) = before {
            return key(b.i).into_iter().collect();
        }
        // Another entry's pending value keeps only a write that decides from the readings
        // waiting; a set write waits only for the writes ahead of it.
        if !self.decides(i) {
            return Vec::new();
        }
        self.state
            .iter()
            .enumerate()
            .filter(|(j, s)| *j != i && s.pending.iter().any(|p| p.flags))
            .map(|(_, s)| s.entry.key.clone())
            .collect()
    }

    /// Whether the entry's write decides from the cockpit's readings, rather than setting a value.
    fn decides(&self, i: usize) -> bool {
        self.state.get(i).is_some_and(|s| {
            matches!(
                s.entry.write,
                Write::Toggle(_) | Write::Steps(_) | Write::Function(_)
            )
        })
    }

    /// Whether another entry has a value pending that its check would flag. A following
    /// machine's write of what the pilot flying owns doesn't flag, as `How::for_owner` sets it,
    /// since that machine's own autopilot moves the trim faster than it reads back, so it could
    /// keep every switch waiting for a check's length; so it keeps nothing waiting here either.
    fn pending_besides(&self, i: usize) -> bool {
        self.state
            .iter()
            .enumerate()
            .any(|(j, s)| j != i && s.pending.iter().any(|p| p.flags))
    }

    /// Makes the waiting writes whose turn has come, in order, once a frame. A write that decides
    /// from the readings goes a frame after nothing kept it waiting, so the readings of the frame
    /// its blocker read back in have all arrived: state sync watches each variable on a request
    /// of its own, and where the sim's `Frame` event falls among one frame's requests is
    /// unmeasured, while the autopilot's two modes changed in one frame (measured on MSFS 2024,
    /// 2026-11-19, record/areas/sync/log.md, "No route showed an autopilot event's effect in the
    /// frame it was sent, so a guard in the sim reads the old mode, and the events of one frame
    /// apply in the order sent").
    pub(crate) fn release(&mut self, cx: Ctx, out: &mut Vec<Out>) {
        while let Some(&Waiting { i, ready, .. }) = self.waiting.front() {
            if self.decides(i) {
                let blocked = self.pending_besides(i);
                if blocked || !ready {
                    if let Some(front) = self.waiting.front_mut() {
                        front.ready = !blocked;
                    }
                    return;
                }
            }
            let Some(Waiting { how, .. }) = self.waiting.pop_front() else {
                return;
            };
            let (wanted, row) = match self.state.get(i) {
                Some(s) => (s.synced.clone(), s.synced_row),
                None => (None, 0),
            };
            let applied = match wanted {
                Some(wanted) => self.write_now(i, wanted, how, row, cx, out),
                None => Applied::Done,
            };
            if how.answers
                && applied != Applied::Stepping
                && let Some(s) = self.state.get(i)
            {
                out.push(Out::Stepped(s.entry.key.clone()));
            }
            if how.catch_up && !self.outstanding(i) {
                self.made(i);
            }
        }
    }

    /// Whether a write of the entry waits for another.
    pub(crate) fn is_waiting(&self, i: usize) -> bool {
        self.waiting.iter().any(|b| b.i == i)
    }

    /// Whether the entry's write is still to be made: it runs, waits for the entry's first
    /// reading, or waits for another. Catch-up counts it made once it isn't.
    pub(crate) fn outstanding(&self, i: usize) -> bool {
        self.runs.contains_key(&Slot::State(i))
            || self
                .state
                .get(i)
                .is_some_and(|s| s.awaiting_reading.is_some())
            || self.is_waiting(i)
    }

    /// Writes `wanted` into the entry through its `write`, as the engine chooses, for `row`.
    fn write_now(
        &mut self,
        i: usize,
        wanted: Value,
        how: How,
        row: u32,
        cx: Ctx,
        out: &mut Vec<Out>,
    ) -> Applied {
        let Some(slot) = self.state.get_mut(i) else {
            return Applied::Skipped;
        };
        let counted = slot.counted().cloned();
        if counted.is_none() && slot.reading.is_none() {
            let refused = slot.refused;
            if !refused {
                slot.awaiting_reading = Some((wanted, how));
            }
            let step = if refused {
                Step::DroppedRefused
            } else {
                Step::AwaitingReading
            };
            self.note_state(i, row, cx.at, || step);
            return Applied::Done;
        }
        let matches = slot.reading.as_ref().is_some_and(|r| r.same(&wanted));
        let checked = how.checked && counted.is_none();
        let slot_id = Slot::State(i);
        // The value that goes pending as the write starts, which logs after its actions.
        let mut pending = None;
        // A write function's checked write that the cockpit already reads, which ends its row
        // after its actions, since no reading comes for a check to match.
        let mut already = false;
        let run = match slot.entry.write.clone() {
            Write::None => return Applied::Done,
            Write::Name(_) | Write::Toggle(_) if matches => {
                self.note_state(i, row, cx.at, || Step::AlreadyMatches);
                return Applied::Done;
            }
            Write::Name(name) => Run::new(vec![Chain {
                action: action(&name, Some(&wanted)),
                times: 1,
                pace: self.pace,
                step: None,
            }]),
            Write::Toggle(name) => Run::new(vec![Chain {
                action: action(&name, None),
                times: 1,
                pace: self.pace,
                step: None,
            }]),
            Write::Steps(s) => {
                let Some((chain, count)) = self.steps_to(i, &s, &wanted) else {
                    return Applied::Done;
                };
                if chain.times == 0 {
                    // Already at its count: a run still stepping elsewhere stops there.
                    self.note_state(i, row, cx.at, || Step::AlreadyMatches);
                    self.cut_short(slot_id, row, cx, out);
                    return Applied::Done;
                }
                let mut run = Run::new(vec![chain]);
                run.count = Some(count);
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
                        if self.log.is_on() {
                            pending = Some(reads.clone());
                        }
                        self.pend(i, reads, None, how.flags, row);
                    }
                    already = checked && there;
                    // A run that writes nothing, as a transponder function that skips while the
                    // battery is off, is a step of its own, since no action logs one.
                    if ran.written.is_empty() {
                        self.note_state(i, row, cx.at, || Step::Writes {
                            actions: Vec::new(),
                        });
                    }
                    Run::new(self.chains_of(ran.written))
                }
                Err(RunFailed::Limit(failed)) => {
                    tracing::info!(entry = self.state.get(i).map(|s| s.entry.key.as_str()), %failed, "a write function reached a limit, so its entry stops on this machine");
                    self.stop(
                        slot_id,
                        Why::Limit(failed.to_string()),
                        Some((row, cx.at)),
                        out,
                    );
                    return Applied::Skipped;
                }
                Err(RunFailed::Compile(error)) => {
                    tracing::info!(
                        entry = self.state.get(i).map(|s| s.entry.key.as_str()),
                        error,
                        "a write function didn't compile, so its entry stops"
                    );
                    self.stop(slot_id, Why::Compile(error), Some((row, cx.at)), out);
                    return Applied::Skipped;
                }
                Err(RunFailed::Wrong(error)) => {
                    tracing::info!(
                        entry = self.state.get(i).map(|s| s.entry.key.as_str()),
                        error,
                        "a write function failed, so its write made nothing"
                    );
                    self.note_state(i, row, cx.at, || Step::FunctionFailed { error });
                    if checked {
                        self.note_state(i, row, cx.at, || Step::Pending {
                            value: wanted.clone(),
                        });
                        self.pend(i, wanted, Some(cx.at + CHECK), how.flags, row);
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
        // step by step, which its `writes` steps show, and a function's went pending whatever the
        // run wrote.
        if checked && !function && run.count.is_none() {
            if self.log.is_on() {
                pending = Some(wanted.clone());
            }
            self.pend(i, wanted, None, how.flags, row);
        }
        run.checked = checked;
        run.flags = how.flags;
        run.put_back = !how.checked;
        // A counting entry hears its own write's events, which its tokens use up.
        run.tokens = counted.is_some();
        run.catch_up = how.catch_up;
        run.row = row;
        let stepping = run.takes_frames();
        run.answers = how.answers && stepping;
        self.start(slot_id, run, cx, out);
        if let Some(value) = pending {
            self.note_state(i, row, cx.at, || Step::Pending { value });
        }
        if already {
            self.note_state(i, row, cx.at, || Step::AlreadyMatches);
        }
        if stepping && how.answers {
            Applied::Stepping
        } else {
            Applied::Done
        }
    }

    /// A stepping write's steps from where the entry stands to `wanted`, and the count they
    /// start from, or `None` when either isn't a number. A new value while it steps aims again
    /// from its count, and one that comes while its last step is still pending starts from that
    /// step, since the reading can lag the last step by 2 frames (measured on MSFS 2024,
    /// 2026-10-05, record/areas/sync/log.md, "Two writes in one frame land in the order sent, and
    /// a write shows within 2 frames").
    pub(crate) fn steps_to(&self, i: usize, s: &Steps, wanted: &Value) -> Option<(Chain, Count)> {
        let slot = self.state.get(i)?;
        let from = match self.runs.get(&Slot::State(i)).and_then(|r| r.count) {
            Some(count) => count.at,
            None => slot
                .pending
                .last()
                .and_then(|p| p.value.number())
                .or_else(|| slot.reading.as_ref().and_then(Value::number))?,
        };
        let to = wanted.number()?;
        let (wrap, range, step) = match slot.counted() {
            Some(c) => (Some(c.wrap), Some(c.range), s.step),
            None => (s.wrap, s.range, s.step),
        };
        let (n, up) = steps(from, to, step, wrap, range);
        let chain = Chain {
            action: action(if up { &s.inc } else { &s.dec }, None),
            times: n,
            pace: s.pace.unwrap_or(self.pace),
            step: Some(if up { step } else { -step }),
        };
        let count = Count {
            at: from,
            wrap: (wrap == Some(true)).then_some(range).flatten(),
        };
        Some((chain, count))
    }

    pub(crate) fn pend(&mut self, i: usize, value: Value, due: Option<u64>, flags: bool, row: u32) {
        if let Some(slot) = self.state.get_mut(i) {
            slot.pending.push(Pending {
                value,
                due,
                flags,
                row,
            });
        }
    }

    /// Values pending past their check, and watch-only values to compare.
    pub(crate) fn check(&mut self, cx: Ctx, out: &mut Vec<Out>) {
        let logging = self.log.is_on();
        for i in 0..self.state.len() {
            let Some(slot) = self.state.get_mut(i) else {
                continue;
            };
            let late: Vec<(Value, u32)> = slot
                .pending
                .iter()
                .filter(|p| p.flags && p.due.is_some_and(|d| cx.at >= d))
                .map(|p| (p.value.clone(), p.row))
                .collect();
            // A following machine's write of what the pilot flying owns drops at its check
            // without a flag.
            let skipped: Vec<u32> = match logging {
                true => {
                    let mut rows: Vec<u32> = slot
                        .pending
                        .iter()
                        .filter(|p| !p.flags && p.due.is_some_and(|d| cx.at >= d))
                        .map(|p| p.row)
                        .collect();
                    rows.dedup();
                    rows
                }
                false => Vec::new(),
            };
            slot.pending.retain(|p| p.due.is_none_or(|d| cx.at < d));
            let reading = slot.reading.clone();
            let due = match slot.compare.is_empty() {
                true => Vec::new(),
                false => {
                    let (due, later): (Vec<_>, Vec<_>) =
                        slot.compare.drain(..).partition(|(_, at, _)| cx.at >= *at);
                    slot.compare = later;
                    due
                }
            };
            for (theirs, _, row) in due {
                if reading.as_ref().is_some_and(|r| r.same(&theirs)) {
                    self.note_state(i, row, cx.at, || Step::Matches);
                    continue;
                }
                self.note_state(i, row, cx.at, || Step::Differs {
                    reading: reading.clone(),
                });
                if let Some(slot) = self.state.get(i) {
                    out.push(Out::Differ {
                        entry: slot.entry.key.clone(),
                        theirs,
                        mine: reading.clone(),
                    });
                }
            }
            if late.is_empty() && skipped.is_empty() {
                continue;
            }
            for row in skipped {
                self.note_state(i, row, cx.at, || Step::WarningSkipped);
            }
            if logging {
                let mut rows: Vec<u32> = late.iter().map(|(_, row)| *row).collect();
                rows.dedup();
                for row in rows {
                    self.note_state(i, row, cx.at, || Step::NeverLanded {
                        reading: reading.clone(),
                    });
                }
            }
            if let Some((wanted, _)) = late.into_iter().last() {
                self.flag(i, Flagged::NeverLanded { wanted, reading }, out);
            }
        }
        self.unread_catch_up(cx, out);
    }

    /// A catch-up write still waiting for its entry's first reading a check after the catch-up
    /// started is made, and flagged as never landed. Without this, an `instrument()` entry no
    /// panel reads holds the catch-up open, and the stream holds everything this machine sends
    /// for as long as it's open: six of the Baron 58P's did (measured on MSFS 2024, 2026-11-09,
    /// record/areas/sync/log.md, "The first session in the sim stopped on a catch-up that six
    /// unread instrument() entries held open").
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
                    .and_then(|s| s.awaiting_reading.as_ref())
                    .is_some_and(|(_, how)| how.catch_up)
            })
            .collect();
        for i in unread {
            let Some(slot) = self.state.get_mut(i) else {
                continue;
            };
            let Some((wanted, _)) = slot.awaiting_reading.take() else {
                continue;
            };
            let row = slot.synced_row;
            self.made(i);
            self.note_state(i, row, cx.at, || Step::NeverLanded { reading: None });
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

    /// Stops an entry syncing on this machine for the rest of the load, a step of the row, at
    /// its time, when a row's decision stopped it.
    pub(crate) fn stop(
        &mut self,
        slot: Slot,
        why: Why,
        logged: Option<(u32, u64)>,
        out: &mut Vec<Out>,
    ) {
        if let Some((row, at)) = logged
            && self.log.is_on()
        {
            self.log_stop(slot, &why, row, at);
        }
        // An arrival waiting on the run's last step, or on a write waiting for another, counts
        // as applied, so the stream moves on.
        let mut answered = self.runs.remove(&slot).is_some_and(|r| r.answers);
        if let Slot::State(i) = slot {
            answered |= self.waiting.iter().any(|b| b.i == i && b.how.answers);
            self.waiting.retain(|b| b.i != i);
        }
        let (key, name) = match slot {
            Slot::State(i) => {
                let Some(s) = self.state.get_mut(i) else {
                    return;
                };
                s.stopped = true;
                s.pending.clear();
                s.awaiting_reading = None;
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

    /// Logs the stop on `row`, and on each other row whose run, pending value, waiting write, or
    /// unsent change the stop clears, since each would otherwise show as under way for good: a
    /// crew member's arrival is often still within its check when the entry turns out driven.
    #[cold]
    fn log_stop(&mut self, slot: Slot, why: &Why, row: u32, at: u64) {
        let stopping = match why {
            Why::Driven => crate::Stopping::Driven,
            Why::Limit(error) => crate::Stopping::Limit {
                error: error.clone(),
            },
            Why::Compile(error) => crate::Stopping::Compile {
                error: error.clone(),
            },
        };
        let mut cut: Vec<u32> = self.runs.get(&slot).map(|r| r.row).into_iter().collect();
        if let Slot::State(i) = slot
            && let Some(s) = self.state.get(i)
        {
            cut.extend(s.pending.iter().map(|p| p.row));
            if s.awaiting_reading.is_some() || self.is_waiting(i) {
                cut.push(s.synced_row);
            }
            if s.sending.is_some() {
                cut.push(s.sending_row);
            }
        }
        cut.sort_unstable();
        cut.dedup();
        // Rows count from 1, so 0 is a slot's row before it had one.
        cut.retain(|&r| r != row && r != 0);
        for r in std::iter::once(row).chain(cut) {
            self.note_slot(slot, r, at, || Step::Stopped {
                why: stopping.clone(),
            });
        }
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
    /// order the cockpit first took each value, those it kept from the load first.
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
        if self.only_asked {
            return out;
        }
        self.catch_up = Some(CatchUpRun {
            started: cx.at,
            ..CatchUpRun::default()
        });
        for e in &state.entries {
            let Some(Slot::State(i)) = self.keys.get(&e.key).copied() else {
                continue;
            };
            let missed = self.ready == Ready::Missed;
            // Catch-up writes no watch-only entry, so it starts no row for one.
            if self.state.get(i).is_none_or(|s| s.watch_only()) {
                continue;
            }
            let row = self.row();
            self.note_state(i, row, cx.at, || Step::CaughtUp {
                value: e.value.clone(),
            });
            if self.state.get(i).is_some_and(|s| s.stopped) {
                self.note_state(i, row, cx.at, || Step::SkippedStopped);
                continue;
            }
            self.set_synced(i, e.value.clone(), row, cx.at);
            let Some(slot) = self.state.get_mut(i) else {
                continue;
            };
            slot.stamp = e.stamp.clone();
            // A core back from a restart lost its shadows, and its aircraft kept the controls it
            // had, which matched the flying machine's, so it takes the flying machine's shadows
            // as they stand.
            if slot.counted().is_some() && missed {
                slot.took(&e.value, cx.at);
                slot.reading = Some(e.value.clone());
                self.script.note(&e.key, Some(e.value.clone()));
                self.note_state(i, row, cx.at, || Step::ShadowRestored {
                    value: e.value.clone(),
                });
                continue;
            }
            if slot.reading.as_ref().is_some_and(|r| r.same(&e.value)) {
                self.note_state(i, row, cx.at, || Step::AlreadyMatches);
                continue;
            }
            let how = CATCH_UP.for_owner(slot.entry.owner, cx);
            self.write(i, e.value.clone(), how, row, cx, &mut out);
            if self.outstanding(i)
                && let Some(c) = self.catch_up.as_mut()
            {
                c.outstanding.insert(i);
            }
        }
        self.catch_up_progress(&mut out);
        out
    }
}
