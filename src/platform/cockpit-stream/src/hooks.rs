//! What a feature registers with the cockpit stream, its kinds and its catch-up step, and what it
//! calls through `cx.cockpit()` (record/areas/sync/05-units.md, "Kinds", "Sending", and
//! "Catch-up").

use std::marker::PhantomData;

use kernel::{Cx, Handler, Registry, Unit, View};
use messages::cockpit::{CockpitKind, CockpitMessage, Origin, VectorClock};
use messages::session::Control;
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::CockpitStream;

/// A cockpit message as its kind's handler gets it.
pub struct Delivered<B> {
    pub sender: Origin,
    pub clock: VectorClock,
    /// The control value it was made under.
    pub control: Control,
    pub key: String,
    pub body: B,
    /// Names the message in `applied`, once a handler that answered `Unfinished` is done.
    pub id: Applying,
}

/// A message whose handler answered `Unfinished`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Applying(pub(crate) u64);

/// What a kind's handler says of a message it was handed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Answer {
    Done,
    /// Nothing done, which counts as applied too.
    Skipped,
    /// Applied once its unit calls `cx.cockpit().applied(id)`, and no later message applies
    /// before then, but the next of its kind and key, which counts this one applied and goes to
    /// the handler at once, as a new value cuts a stepping write short.
    Unfinished,
}

/// A message on its way to its kind's handler.
pub(crate) struct Dispatch {
    pub(crate) message: CockpitMessage,
    pub(crate) id: u64,
}

/// Reads a profile entry's number from a kind's body.
pub(crate) type EntryNumber = Box<dyn Fn(&[u8]) -> Option<f64>>;
/// Makes a catch-up step's payload from its unit's state.
pub(crate) type Give = Box<dyn Fn(&View) -> Vec<u8>>;

/// A kind, as its unit registered it.
pub(crate) struct KindReg {
    pub(crate) handler: Handler<Dispatch>,
    /// The stream holds each key's newest message and sends it at most 20 times a second.
    pub(crate) hold: bool,
    /// A replay skips all but the last of a run of its messages for one key.
    pub(crate) collapse: bool,
    /// For a kind whose key names a profile entry, reads the entry's number from a body.
    pub(crate) entry: Option<EntryNumber>,
    /// The recorder records its messages, which `CockpitSent` says.
    pub(crate) recorded: bool,
}

/// A catch-up step, as its unit registered it.
pub(crate) struct StepReg {
    pub(crate) number: u16,
    pub(crate) give: Give,
    pub(crate) take: Handler<Vec<u8>>,
}

/// The cockpit stream's hooks on a unit, as it registers.
pub trait CockpitUnit<S> {
    /// A kind of cockpit message, whose messages from other machines call `f` in the stream's
    /// order. A body that doesn't read is skipped.
    fn cockpit_kind<B: DeserializeOwned + 'static>(
        &mut self,
        kind: CockpitKind<B>,
        f: fn(&mut S, Delivered<B>, &mut Cx) -> Answer,
    ) -> KindOptions<'_, B>;

    /// A step of the catch-up pipeline, in the order the steps register: `give` makes its
    /// payload on the flying machine, and `take` gets it on the catching-up one, which calls
    /// `step_made` once every write is made and `step_done` once the step has landed.
    fn catch_up_step(
        &mut self,
        step: u16,
        give: fn(&S, &View) -> Vec<u8>,
        take: fn(&mut S, Vec<u8>, &mut Cx),
    ) -> &mut Self;
}

impl<S: 'static> CockpitUnit<S> for Unit<'_, S> {
    fn cockpit_kind<B: DeserializeOwned + 'static>(
        &mut self,
        kind: CockpitKind<B>,
        f: fn(&mut S, Delivered<B>, &mut Cx) -> Answer,
    ) -> KindOptions<'_, B> {
        let number = kind.number;
        let handler = self.handler(move |state: &mut S, d: Dispatch, cx: &mut Cx| {
            let answer = match postcard::from_bytes::<B>(&d.message.body) {
                Ok(body) => f(
                    state,
                    Delivered {
                        sender: d.message.sender,
                        clock: d.message.clock,
                        control: d.message.control,
                        key: d.message.key,
                        body,
                        id: Applying(d.id),
                    },
                    cx,
                ),
                Err(error) => {
                    tracing::warn!(kind = number, %error, "a cockpit message's body didn't read, so it was skipped");
                    Answer::Skipped
                }
            };
            cx.call(CockpitStream::answered, (d.id, answer));
        });
        let me = self.registry().state_mut::<CockpitStream>();
        assert!(
            me.kinds
                .insert(
                    number,
                    KindReg {
                        handler,
                        hold: false,
                        collapse: false,
                        entry: None,
                        recorded: false,
                    },
                )
                .is_none(),
            "cockpit kind {number} should be registered once"
        );
        KindOptions {
            registry: self.registry(),
            number,
            body: PhantomData,
        }
    }

    fn catch_up_step(
        &mut self,
        step: u16,
        give: fn(&S, &View) -> Vec<u8>,
        take: fn(&mut S, Vec<u8>, &mut Cx),
    ) -> &mut Self {
        let take = self
            .handler(move |state: &mut S, payload: Vec<u8>, cx: &mut Cx| take(state, payload, cx));
        let me = self.registry().state_mut::<CockpitStream>();
        assert!(
            !me.steps.iter().any(|s| s.number == step),
            "catch-up step {step} should be registered once"
        );
        me.steps.push(StepReg {
            number: step,
            give: Box::new(move |view: &View| give(view.read::<S>(), view)),
            take,
        });
        self
    }
}

/// What a kind declares beside its handler.
pub struct KindOptions<'r, B> {
    registry: &'r mut Registry,
    number: u16,
    body: PhantomData<fn() -> B>,
}

impl<B: DeserializeOwned + 'static> KindOptions<'_, B> {
    fn kind(&mut self) -> &mut KindReg {
        self.registry
            .state_mut::<CockpitStream>()
            .kinds
            .get_mut(&self.number)
            .expect("a kind's options should follow its registration")
    }

    /// The stream holds each key's newest message, and sends it at most 20 times a second,
    /// before any message of a kind that doesn't hold.
    pub fn hold_newest(mut self) -> Self {
        self.kind().hold = true;
        self
    }

    /// A replay skips all but the last of a run of its messages for one key, with only
    /// collapsing messages between them.
    pub fn collapse_in_replay(mut self) -> Self {
        self.kind().collapse = true;
        self
    }

    /// The profile extension's recorder records the kind's messages as this machine sends them,
    /// and plays them back from a pretend sender (record/areas/profiles/05-the-recorder.md).
    pub fn recorded(mut self) -> Self {
        self.kind().recorded = true;
        self
    }

    /// The kind's key names a profile entry, whose number `number` reads from a body, which
    /// `CockpitSent` carries.
    pub fn entry(mut self, number: fn(&B) -> Option<f64>) -> Self {
        self.kind().entry = Some(Box::new(move |bytes: &[u8]| {
            postcard::from_bytes::<B>(bytes)
                .ok()
                .and_then(|b| number(&b))
        }));
        self
    }
}

/// What a handler calls on the cockpit stream, through `cx.cockpit()`.
pub trait CockpitCx<'k> {
    fn cockpit(&self) -> Cockpit<'_, 'k>;
}

impl<'k> CockpitCx<'k> for Cx<'k> {
    fn cockpit(&self) -> Cockpit<'_, 'k> {
        Cockpit { cx: self }
    }
}

pub struct Cockpit<'c, 'k> {
    cx: &'c Cx<'k>,
}

impl Cockpit<'_, '_> {
    /// Sends a message, or holds it when its kind holds. Nothing of a feature's kind goes
    /// before preflight ends, or while this member is out of the flight.
    pub fn send<B: Serialize>(&self, kind: CockpitKind<B>, key: &str, body: &B) {
        match postcard::to_stdvec(body) {
            Ok(bytes) => self.cx.call(
                CockpitStream::send_bytes,
                (kind.number, key.to_string(), bytes),
            ),
            Err(error) => {
                tracing::error!(kind = kind.number, %error, "a cockpit message didn't encode")
            }
        }
    }

    /// Drops what the stream holds for one kind and key.
    pub fn withdraw<B>(&self, kind: CockpitKind<B>, key: &str) {
        self.cx
            .call(CockpitStream::withdraw_held, (kind.number, key.to_string()));
    }

    /// A message whose handler answered `Unfinished` is done.
    pub fn applied(&self, id: Applying) {
        self.cx.call(CockpitStream::finished, id.0);
    }

    /// Whether a catch-up step can give and take, as state sync's can while its profile is
    /// loaded. A machine asks for its catch-up, and the flying machine answers, only while
    /// every step can.
    pub fn step_ready(&self, step: u16, ready: bool) {
        self.cx.call(CockpitStream::step_ready, (step, ready));
    }

    /// Every write of a step's catch-up is made, a stepping write's last step included.
    pub fn step_made(&self, step: u16) {
        self.cx.call(CockpitStream::step_made, step);
    }

    /// A step's catch-up is made and has landed, as state sync's once its aircraft has
    /// settled.
    pub fn step_done(&self, step: u16) {
        self.cx.call(CockpitStream::step_done, step);
    }

    /// Starts a playback from the pretend sender: the stream takes `payloads`, as `payloads`
    /// made them at Record, as a catch-up, and raises `PretendCaughtUp` once it has ended. Only
    /// alone in a session, which the caller's guards hold, since the pretend sender's counter
    /// goes into this machine's clock, and a crewmate's stream would wait for its messages
    /// (record/areas/profiles/05-the-recorder.md, "The pretend sender").
    pub fn pretend(&self, payloads: Vec<(u16, Vec<u8>)>) {
        self.cx.call(CockpitStream::pretend, payloads);
    }

    /// The pretend sender's next message, which the stream applies as it applies a crewmate's,
    /// with `gap`, in µs, the time between it and the one before it as they were sent.
    pub fn arrive(&self, kind: u16, key: String, body: Vec<u8>, gap: u32) {
        self.cx
            .call(CockpitStream::pretend_arrived, (kind, key, body, gap));
    }

    /// Ends a playback: the pretend sender's waiting messages drop, one still stepping counts as
    /// applied at once, and its catch-up ends.
    pub fn stop_pretending(&self) {
        self.cx.call(CockpitStream::stop_pretending, ());
    }
}
