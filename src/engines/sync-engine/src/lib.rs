//! The sync engine: for one loaded profile, what each entry watches, how to write it, whether a
//! reading is this machine's own change or the echo of a write, which of two changes wins, and
//! the state a catch-up hands over (record/areas/sync/05-units.md, "The sync engine").
//!
//! It does no I/O and reads no clock. Each call takes the time and the roles in `Ctx`, and the
//! engine answers with `Out`s, which state sync, the feature that joins it to the sim and the
//! cockpit stream, carries out, so the IDE and the bench can run the same engine on their own.
//! Everything that waits, a stepping write's next step, the check of a write, the settle rule,
//! counts the sim's frames and their stamps, which state sync hands over as `frame` calls.

mod events;
mod runs;
mod script;
mod state;

use std::collections::BTreeMap;

pub use messages::cockpit::{Origin, VectorClock};
pub use messages::session::Control;
pub use messages::sync::{CatchUpEntry, CatchUpState, Stamp, Value};
pub use profile_engine::{Name, Pace, Resolved};
pub use sandbox::Sandbox;

use crate::events::EventSlot;
use crate::runs::Run;
use crate::script::Script;
use crate::state::StateSlot;

/// A value still pending this long after its write, or after a stepping write's last step, is
/// flagged. A profile watches the switch it writes, which shows a write within a few frames, as
/// the Fenix's switches did in about 130ms, and the slowest watch is an `instrument()` entry,
/// which its panel module reads every 250ms, so 1.5s leaves a wide margin (measured on MSFS
/// 2024, 2026-11-09, record/areas/sync/log.md). State sync waits as long after a load before
/// its catch-up step can give, for every watch's first reading.
pub const CHECK: u64 = 1_500_000;
/// A token, or an `ignore`, that no occurrence uses within this long expires, since an aircraft
/// that masks an event never reports it, and the token would swallow the pilot's next press.
const TOKEN: u64 = 1_000_000;
/// An aircraft counts as settled this long after Ready to fly (decision 048).
pub const SETTLE: u64 = 30_000_000;
/// The largest value a change carries, as sent (decision 046).
const MOST_BYTES: usize = 4 * 1024;

/// What each call knows of the session.
#[derive(Clone, Copy, Debug)]
pub struct Ctx {
    /// The input's stamp, in µs on the PC's counter.
    pub at: u64,
    /// This machine's pilot, under its core's restart count.
    pub me: Origin,
    /// The control value, which names the pilot flying.
    pub control: Control,
    /// This machine's own catch-up runs, so its own changes are put back, not sent.
    pub catching_up: bool,
    /// Preflight has ended, before which the engine reads and keeps its order, and sends and
    /// puts back nothing.
    pub preflight_ended: bool,
}

impl Ctx {
    /// Whether this machine is the flying machine.
    pub fn flying(&self) -> bool {
        self.control.pf == self.me.pilot
    }
}

/// When the aircraft whose profile loads was ready to fly.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ready {
    /// Its `RTC_END` is still to come, and `ready_to_fly` brings it.
    Yet,
    /// Its `RTC_END` came before the load, at this stamp.
    At(u64),
    /// This core missed it, having found the sim already flying, as after a core restart, so
    /// the aircraft counts as settled at once (record/areas/sync/04-order-and-recovery.md, "A
    /// core that restarts").
    Missed,
}

/// The profile's load.
#[derive(Clone, Copy, Debug)]
pub struct Load {
    pub at: u64,
    pub ready: Ready,
    /// How long after Ready to fly the aircraft counts as settled, `SETTLE` in a flight.
    pub settle: u64,
}

/// What state sync watches for one entry, by its place in `watches`.
#[derive(Clone, Debug, PartialEq)]
pub struct Watch {
    pub name: Name,
    pub watching: Watching,
    /// The entry it's for.
    pub entry: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Watching {
    /// A variable's, an input event's, or an instrument's value, read once when watching starts
    /// and on each change.
    Value,
    /// An `L:` variable whose every rise from 0 is one occurrence.
    Pulse,
    /// Each time a `K:`, `H:`, or `B:` event fires.
    Occurrence,
}

/// What state sync saw on this machine, for the watch at `watch`.
#[derive(Clone, Debug, PartialEq)]
pub enum Seen {
    Value {
        watch: usize,
        value: Value,
    },
    Fired {
        watch: usize,
        value: Option<f64>,
    },
    /// The sim refused the read, so the entry gets no reading, and a write held for one drops.
    Refused {
        watch: usize,
    },
}

/// Another machine's change to an entry, or its firing, as the cockpit stream applies it.
#[derive(Clone, Debug, PartialEq)]
pub enum Arrived {
    Change { value: Value, stamp: Stamp },
    Fired { value: Option<Value> },
}

/// What the cockpit stream counts an arrival as.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Applied {
    Done,
    Skipped,
    /// Its write takes frames, and `Out::Stepped` says when its last step went.
    Stepping,
}

/// What state sync carries out.
#[derive(Clone, Debug, PartialEq)]
pub enum Out {
    Act(Action),
    /// A change of this machine's to send.
    Send(Change),
    /// Drops the change of this entry's the stream still holds.
    Withdraw(String),
    Flag(Flag),
    /// A watch-only entry whose value here differs from another machine's, 1.5s after it came.
    Differ {
        entry: String,
        theirs: Value,
        mine: Option<Value>,
    },
    /// The entry stops syncing on this machine for the rest of the load.
    Stop {
        entry: String,
        name: String,
        why: Why,
    },
    /// The entry's stepping write sent its last step, so the arrival that started it counts as
    /// applied.
    Stepped(String),
    /// Every catch-up write is made, a stepping write's last step included.
    CatchUpMade,
    /// The catch-up's writes are made and the aircraft has settled.
    CatchUpDone,
}

/// One action of a write, in call order.
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    /// Sets an `L:` or `A:` variable, or an input event, to a value.
    Set { name: Name, value: Value },
    /// Sends a `K:` event with its values, the legacy call for one or none.
    Key { name: Name, values: Vec<f64> },
    /// Fires an `H:` event, or an input event's preset with no value.
    Fire { name: Name },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Change {
    pub entry: String,
    pub value: Option<Value>,
    pub kind: ChangeKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChangeKind {
    /// A shared state entry's value.
    Shared,
    /// A value only the flying machine sends, which a replay collapses.
    PilotFlying,
    /// An event entry's firing.
    Fired,
}

/// A write that never landed, or a value too large to send, each time, so a text over the
/// limit that keeps changing is flagged at each change.
#[derive(Clone, Debug, PartialEq)]
pub struct Flag {
    pub entry: String,
    pub name: String,
    pub what: Flagged,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Flagged {
    NeverLanded {
        wanted: Value,
        reading: Option<Value>,
    },
    TooLarge {
        bytes: usize,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub enum Why {
    /// Every machine's own aircraft keeps changing it (record/areas/sync/04-order-and-recovery.md,
    /// "Entries the aircraft drives itself").
    Driven,
    /// Its write function reached the sandbox's time or memory limit.
    Limit(String),
    /// Its write function didn't compile in the sandbox, which the builder's own parse of it
    /// should have caught.
    Compile(String),
}

/// An entry, by its block and its place there.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Slot {
    State(usize),
    Event(usize),
}

/// What one watch is for.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Role {
    Value(usize),
    Inc(usize),
    Dec(usize),
    Set(usize),
    Count(usize),
    Event(usize),
    Pulse(usize),
}

/// A catch-up this machine takes.
#[derive(Debug, Default)]
pub(crate) struct CatchUpRun {
    /// When the catch-up was taken.
    pub(crate) started: u64,
    /// The state entries whose catch-up write isn't made yet.
    pub(crate) outstanding: std::collections::BTreeSet<usize>,
    pub(crate) made: bool,
    pub(crate) done: bool,
}

/// One engine for one loaded profile, on one machine.
pub struct Engine {
    pub(crate) state: Vec<StateSlot>,
    pub(crate) events: Vec<EventSlot>,
    pub(crate) keys: BTreeMap<String, Slot>,
    pub(crate) watches: Vec<Watch>,
    pub(crate) roles: Vec<Role>,
    /// The aircraft's pace, one step a frame unless the profile sets another.
    pub(crate) pace: Pace,
    /// The write in progress for each entry that has one.
    pub(crate) runs: BTreeMap<Slot, Run>,
    pub(crate) tokens: Vec<events::Token>,
    pub(crate) ignores: Vec<events::Token>,
    pub(crate) reports: Vec<events::Report>,
    /// The sim's frames so far, which a pace in frames counts.
    pub(crate) frame: u64,
    pub(crate) loaded_at: u64,
    pub(crate) ready: Ready,
    pub(crate) settle_after: u64,
    pub(crate) settled: bool,
    pub(crate) catch_up: Option<CatchUpRun>,
    /// Last of the fields, since its runtime has to outlive every function it compiled.
    pub(crate) script: Script,
}

impl Engine {
    /// The engine for `profile`, as one variant has it, with its write functions compiled in
    /// `sandbox`. A function that doesn't compile stops its entry, which the outs say.
    pub fn load(profile: &Resolved, sandbox: Sandbox, load: Load) -> (Engine, Vec<Out>) {
        let mut engine = Engine {
            state: Vec::new(),
            events: Vec::new(),
            keys: BTreeMap::new(),
            watches: Vec::new(),
            roles: Vec::new(),
            pace: profile.pace.unwrap_or(Pace::Frames(1)),
            runs: BTreeMap::new(),
            tokens: Vec::new(),
            ignores: Vec::new(),
            reports: Vec::new(),
            frame: 0,
            loaded_at: load.at,
            ready: load.ready,
            settle_after: load.settle,
            settled: false,
            catch_up: None,
            script: Script::new(sandbox),
        };
        let mut out = Vec::new();
        for entry in &profile.state {
            engine.add_state(entry);
        }
        for entry in &profile.events {
            engine.add_event(entry);
        }
        engine.compile(profile, &mut out);
        engine.settle(load.at);
        (engine, out)
    }

    /// The aircraft's `RTC_END`, when it comes after the load. The last one marks the load the
    /// pilot flies, since a flight that loads twice sends one for each.
    pub fn ready_to_fly(&mut self, at: u64) {
        self.ready = Ready::At(at);
        self.settled = false;
        self.settle(at);
    }

    /// What each entry reads or hears, each by its place, which `Seen` names.
    pub fn watches(&self) -> &[Watch] {
        &self.watches
    }

    /// The name a pilot reads for the entry `key`, such as "Battery".
    pub fn entry_name(&self, key: &str) -> Option<&str> {
        match self.keys.get(key)? {
            Slot::State(i) => self.state.get(*i).map(|s| s.entry.name.as_str()),
            Slot::Event(i) => self.events.get(*i).map(|e| e.entry.name.as_str()),
        }
    }

    /// Whether the aircraft has settled, as of the last call.
    pub fn settled(&self) -> bool {
        self.settled
    }

    /// A reading or an occurrence on this machine.
    pub fn seen(&mut self, what: Seen, cx: Ctx) -> Vec<Out> {
        let mut out = Vec::new();
        match what {
            Seen::Value { watch, value } => match self.roles.get(watch).copied() {
                Some(Role::Value(i)) => self.reading(i, value, cx, &mut out),
                Some(Role::Count(i)) => self.counted_variable(i, value, cx, &mut out),
                Some(Role::Pulse(i)) => self.pulse(i, value, cx, &mut out),
                _ => tracing::debug!(watch, "a value came for a watch that takes none"),
            },
            Seen::Fired { watch, value } => match self.roles.get(watch).copied() {
                Some(Role::Event(i)) => self.event_fired(i, value, cx, &mut out),
                Some(role @ (Role::Inc(i) | Role::Dec(i) | Role::Set(i))) => {
                    self.counted_event(i, role, value, cx, &mut out)
                }
                _ => tracing::debug!(watch, "an occurrence came for a watch that takes none"),
            },
            Seen::Refused { watch } => {
                if let Some(Role::Value(i)) = self.roles.get(watch).copied() {
                    self.refused(i, &mut out);
                }
            }
        }
        out
    }

    /// Another machine's change to `entry`, or its firing, as the stream applies it.
    pub fn arrived(&mut self, entry: &str, change: Arrived, cx: Ctx) -> (Applied, Vec<Out>) {
        let mut out = Vec::new();
        let applied = match (self.keys.get(entry).copied(), change) {
            (Some(Slot::State(i)), Arrived::Change { value, stamp }) => {
                self.arrived_change(i, value, stamp, cx, &mut out)
            }
            (Some(Slot::Event(i)), Arrived::Fired { value }) => {
                self.arrived_firing(i, value, cx, &mut out)
            }
            _ => {
                tracing::debug!(entry, "a change came for an entry this profile lacks");
                Applied::Skipped
            }
        };
        (applied, out)
    }

    /// One of the sim's frames: the steps it makes due, the checks it closes, and the settle
    /// rule.
    pub fn frame(&mut self, cx: Ctx) -> Vec<Out> {
        let mut out = Vec::new();
        self.frame += 1;
        self.advance_runs(cx, &mut out);
        self.tokens.retain(|t| t.until > cx.at);
        self.ignores.retain(|t| t.until > cx.at);
        self.reports
            .retain(|r| cx.at.saturating_sub(r.at) <= events::DOUBLE_FIRE_MOST);
        self.check(cx, &mut out);
        self.settle(cx.at);
        self.catch_up_progress(&mut out);
        out
    }

    /// Control passed, and `cx` holds the new control value.
    pub fn control_passed(&mut self, cx: Ctx) -> Vec<Out> {
        let mut out = Vec::new();
        self.took_control(cx, &mut out);
        out
    }

    /// The stream sent this machine's change to `entry` under `stamp`.
    pub fn sent(&mut self, entry: &str, stamp: Stamp) {
        if let Some(Slot::State(i)) = self.keys.get(entry).copied() {
            self.state_sent(i, stamp);
        }
    }

    fn settle(&mut self, at: u64) {
        self.settled = match self.ready {
            Ready::Yet => false,
            Ready::At(t) => at >= t.saturating_add(self.settle_after),
            Ready::Missed => true,
        };
    }
}
