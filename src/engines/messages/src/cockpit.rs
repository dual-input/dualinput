//! The cockpit stream's messages: one stream between cores that carries every cockpit message,
//! each feature's change, event, or press, in an order every machine agrees on, with the replay
//! and the catch-up exchange beside them; and the clock each member sends once a second
//! (record/areas/sync/05-units.md, "The cockpit stream").
//!
//! A kind's body is its feature's own type, in the feature's module of this crate, so the
//! stream names no feature's types.

use std::marker::PhantomData;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::net::{Channel, Delivery, OneOff, PilotId, Wait};
use crate::session::Control;

/// The stream's one channel, below the session's, since a cockpit message may name a control
/// value only the session channel's keys carry (record/areas/network/01-between-machines.md,
/// "Channels").
pub const CHANNEL: Channel<Cockpit> = Channel::new(3, Delivery::Stream, 240);

/// Each member's clock, once a second, which tells every other member what it applied, so they
/// stop keeping it. The heartbeat can't carry it, since the network sits below the cockpit
/// stream (record/areas/network/02-units.md, "The heartbeat and clock offsets").
pub const CLOCKS: Channel<Clock> = Channel::new(4, Delivery::Newest, 10);

/// A sender of cockpit messages: a pilot, under one restart count of their core, so a core that
/// restarts counts its messages afresh, under a counter of its own.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Origin {
    pub pilot: PilotId,
    pub restart: u32,
}

/// How many cockpit messages from each sender a machine has applied, its own counter holding how
/// many it sent. It names each counter by pilot ID and restart count in full, so its encoding
/// depends on nothing the receiver holds (decision 042).
///
/// The counters stay sorted by sender, so two clocks with the same counts encode the same.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct VectorClock {
    counters: Vec<(Origin, u64)>,
}

impl VectorClock {
    /// The count for `origin`, 0 for a sender it has none of.
    pub fn get(&self, origin: Origin) -> u64 {
        match self.counters.binary_search_by_key(&origin, |(o, _)| *o) {
            Ok(i) => self.counters.get(i).map_or(0, |(_, n)| *n),
            Err(_) => 0,
        }
    }

    /// Sets the count for `origin`.
    pub fn set(&mut self, origin: Origin, n: u64) {
        match self.counters.binary_search_by_key(&origin, |(o, _)| *o) {
            Ok(i) => {
                if let Some(counter) = self.counters.get_mut(i) {
                    counter.1 = n;
                }
            }
            Err(i) => self.counters.insert(i, (origin, n)),
        }
    }

    /// Adds 1 to `origin`'s count, and returns it, as a sender numbers its next message.
    pub fn bump(&mut self, origin: Origin) -> u64 {
        let n = self.get(origin) + 1;
        self.set(origin, n);
        n
    }

    /// Whether this clock has applied the `n`th message from `origin`.
    pub fn has(&self, origin: Origin, n: u64) -> bool {
        self.get(origin) >= n
    }

    /// Whether this clock has applied everything `other` has.
    pub fn covers(&self, other: &VectorClock) -> bool {
        other.counters.iter().all(|(o, n)| self.get(*o) >= *n)
    }

    /// Takes each of `other`'s counts that's higher than this clock's, but `mine`'s, as a
    /// catching-up machine takes the flying machine's clock: a machine's own counter never goes
    /// back, since a number used twice would drop the second message as a copy
    /// (record/areas/sync/04-order-and-recovery.md, "Catch-up").
    pub fn take(&mut self, other: &VectorClock, mine: Origin) {
        for &(origin, n) in &other.counters {
            if origin != mine && n > self.get(origin) {
                self.set(origin, n);
            }
        }
    }

    /// Each sender and its count, in sender order.
    pub fn counters(&self) -> impl Iterator<Item = (Origin, u64)> + '_ {
        self.counters.iter().copied()
    }
}

/// One cockpit message.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CockpitMessage {
    /// Who made it. A replay carries every message its sender kept, the ones it applied from
    /// others among them, so a message names its maker rather than leaving the connection to.
    pub sender: Origin,
    /// The sender's clock as it sent the message; the sender's own count is the message's
    /// number.
    pub clock: VectorClock,
    /// The control value it was made under.
    pub control: Control,
    /// µs since the sender's last cockpit message, which a receiver waits what's left of,
    /// capped at 2s.
    pub gap: u32,
    pub kind: u16,
    /// The kind's key, such as an entry's name.
    pub key: String,
    /// The kind's own message, in postcard.
    pub body: Vec<u8>,
}

impl CockpitMessage {
    /// Its number among its sender's messages, from 1.
    pub fn number(&self) -> u64 {
        self.clock.get(self.sender)
    }
}

/// What the stream's one channel carries.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Cockpit {
    Message(CockpitMessage),
    /// Opens a replay of the messages the sender kept that the receiver lacks: the receiver's
    /// replay runs until its clock covers this one.
    Replay {
        clock: VectorClock,
    },
    /// Asks the flying machine for a catch-up.
    CatchUpAsk,
    /// The flying machine's answer: its clock as of the state it hands over, the control value
    /// it answered under, and each catch-up step's payload, in the pipeline's order.
    CatchUp {
        clock: VectorClock,
        control: Control,
        steps: Vec<(u16, Vec<u8>)>,
    },
}

/// A member's clock, on `CLOCKS`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Clock(pub VectorClock);

impl OneOff for Clock {
    fn wait(&self) -> Wait {
        Wait::Newest { key: 0 }
    }
}

/// A kind of cockpit message: a number no other kind has, and its body's type, as a channel is
/// a number and its message's type. A feature's kind is a constant in its module of this crate.
pub struct CockpitKind<B> {
    pub number: u16,
    body: PhantomData<fn() -> B>,
}

impl<B> CockpitKind<B> {
    pub const fn new(number: u16) -> CockpitKind<B> {
        CockpitKind {
            number,
            body: PhantomData,
        }
    }
}

impl<B> Clone for CockpitKind<B> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<B> Copy for CockpitKind<B> {}

/// The stream's own kind: a change of control, which the core that made it sends with its
/// clock, so every receiver tells what the new pilot flying had seen
/// (record/areas/sync/05-units.md, "A change of control").
pub const CONTROL: CockpitKind<Passed> = CockpitKind::new(0);

/// A change of control's body: the value it replaced, whose pilot flying's messages it judges,
/// and the value it made, which is also the message's own control value.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Passed {
    pub before: Option<Control>,
    pub after: Control,
}

/// The cockpit stream's slice of client state.
pub const SLICE: &str = "cockpit-stream";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "cockpit/")]
pub struct CockpitSlice {
    /// This machine's catch-up runs: asked, or taking the answer until its steps are done.
    pub catching_up: bool,
    /// The catch-up that runs is the one preflight's end started.
    pub from_preflight_end: bool,
    /// A replay from another member runs.
    pub replaying: bool,
}
