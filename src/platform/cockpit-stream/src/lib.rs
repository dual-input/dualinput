//! The cockpit stream, the platform's crate that carries every cockpit message, each feature's
//! change, event, or press, between the pilots' machines in one order every machine agrees on:
//! it holds each state entry's newest value, applies each message once what it depends on has
//! applied, paces what it applies, keeps what it sent for a replay after a cut, drops what a
//! change of control drops, and runs catch-up, which the catching-up machine asks the flying
//! machine for (record/areas/sync/05-units.md, "The cockpit stream").
//!
//! A machine's vector clock is its one record of what it applied: a message it covers is a copy,
//! what it sends once a second tells the others what to stop keeping, and a catch-up hands it
//! over (decision 042).
//!
//! Register it after the session crate, whose control it guards, and before every feature that
//! registers a kind or a catch-up step.

mod hooks;
mod order;

pub use hooks::{Answer, Applying, Cockpit, CockpitCx, CockpitUnit, Delivered, KindOptions};
pub use messages::cockpit::{CockpitKind, Origin, VectorClock};

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use clients::{ClientsUnit, Landing, Level, Notification};
use kernel::{Cx, Moment, Registry, TimerId, View};
use messages::cockpit::{
    CHANNEL, CLOCKS, CONTROL, Clock, Cockpit as Wire, CockpitMessage, CockpitSlice, Passed, SLICE,
};
use messages::net::PilotId;
use messages::session::{Control, MEMBER, Phase};
use network::{LinkUp, NetUnit, Network, Sender, To};
use session::{
    ControlPassed, FlightChanged, MemberGone, PreflightEnded, Session, SessionEnded,
    SessionStarted, TakeControl,
};

use crate::hooks::{Dispatch, KindReg, StepReg};
use crate::order::{Inbox, Next, Skipped};

/// How often each member sends its clock.
const CLOCK_EVERY: Duration = Duration::from_secs(1);
/// A held value goes out at most this often, 20 times a second, a starting value v1's
/// recordings tune, so a change undone within 50ms never goes out
/// (record/areas/sync/04-order-and-recovery.md, "The cockpit stream").
const HOLD_FOR: Duration = Duration::from_millis(50);
/// Each message the stream applies queues two calls, its handler's and its answer's, and the
/// kernel panics past 1,000 queued in one input, which a replay's messages, up to about 540 in
/// one of the transport's 64 KiB reads, would pass. So the stream applies at most this many in
/// one input, and the rest in the inputs of a timer that fires at once.
const MOST_A_INPUT: u32 = 50;

/// This machine's own change went out on the cockpit stream, with the message's clock, and for a
/// kind whose key names a profile entry, the entry's number as its body gives it, which avatars
/// reaches the figure's hand for (record/areas/architecture/02-code-map.md, "What a handler sees
/// and does").
pub struct CockpitSent {
    pub kind: u16,
    pub key: String,
    pub clock: VectorClock,
    /// The control value it was made under, which the conflict rule keeps with its value.
    pub control: Control,
    pub names_entry: bool,
    pub number: Option<f64>,
}

impl Moment for CockpitSent {}

/// The cockpit stream's state.
#[derive(Default)]
pub struct CockpitStream {
    pub(crate) kinds: BTreeMap<u16, KindReg>,
    /// The catch-up pipeline, in the order its steps registered.
    pub(crate) steps: Vec<StepReg>,
    /// The steps that can give and take now, which outlasts a session, as a loaded profile can.
    ready: BTreeSet<u16>,
    live: Option<Live>,
}

/// The stream in the session this core holds.
struct Live {
    me: Origin,
    clock: VectorClock,
    /// When this machine last sent a cockpit message, for the next one's gap.
    last_sent: Option<u64>,
    /// The newest message of each held kind and key, in the order each was first held.
    held: Vec<Held>,
    flush: Option<TimerId>,
    /// Every message sent or applied, until every member's clock covers it.
    kept: Vec<CockpitMessage>,
    /// Each member's clock, as it last sent it.
    acks: BTreeMap<PilotId, VectorClock>,
    inbox: Inbox,
    /// A message handed to its kind's handler, whose answer hasn't come.
    dispatched: Option<(CockpitMessage, u64)>,
    /// A message whose handler answered `Unfinished`.
    unfinished: Option<(CockpitMessage, u64)>,
    next_id: u64,
    pace: Option<(TimerId, u64)>,
    /// The stamp of the input the stream last applied in, and how many it applied there.
    applying_in: (u64, u32),
    clocks: Option<TimerId>,
    catch_up: CatchUp,
    /// The members whose ask waits until this machine's steps can give.
    askers: BTreeSet<PilotId>,
    /// A change of control dropped a message this machine applied, so it asks the new pilot
    /// flying for a catch-up once any replay it's receiving ends.
    ask_after_replay: bool,
    /// Whom the banner says this machine is catching up with, and whether a catch-up, rather
    /// than a replay, is why.
    catching_up_with: Option<(PilotId, bool)>,
}

impl Live {
    /// A catch-up that stops unfinished takes back what the banner said, since saying it's caught
    /// up would be false.
    fn stop_catch_up(&mut self, cx: &Cx) {
        self.catch_up = CatchUp::Idle;
        if matches!(self.catching_up_with, Some((_, true))) {
            self.take_back_catching_up(cx);
        }
    }

    fn take_back_catching_up(&mut self, cx: &Cx) {
        self.catching_up_with = None;
        clients::clear_notification(cx, "catch");
    }
}

/// A message the stream holds until its kind's next chance to go.
struct Held {
    kind: u16,
    key: String,
    body: Vec<u8>,
    /// The control value it was made under.
    control: Control,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum CatchUp {
    Idle,
    /// Asked the flying machine, under the control value of the moment.
    Asking {
        from: PilotId,
        control: Option<Control>,
        preflight_end: bool,
    },
    /// Took the answer: the steps hand over what they made and what landed.
    Taking {
        from: PilotId,
        preflight_end: bool,
        made: BTreeSet<u16>,
        done: BTreeSet<u16>,
    },
}

impl CockpitStream {
    /// Whether this machine's catch-up runs, and whether preflight's end started it, which
    /// pointer sync reads to play the presses queued behind that one rather than skip them.
    pub fn catching_up(&self) -> Option<bool> {
        match self.live.as_ref().map(|l| &l.catch_up) {
            Some(CatchUp::Asking { preflight_end, .. } | CatchUp::Taking { preflight_end, .. }) => {
                Some(*preflight_end)
            }
            _ => None,
        }
    }

    /// The senders whose replay to this machine still runs.
    pub fn replaying(&self) -> Vec<Origin> {
        self.live
            .as_ref()
            .map(|l| l.inbox.replay_senders())
            .unwrap_or_default()
    }

    /// The messages this machine keeps for a replay, and the ones waiting to apply.
    pub fn counts(&self) -> (usize, usize) {
        self.live
            .as_ref()
            .map_or((0, 0), |l| (l.kept.len(), l.inbox.len()))
    }

    fn slice(&self) -> CockpitSlice {
        CockpitSlice {
            catching_up: self.catching_up().is_some(),
            from_preflight_end: self.catching_up() == Some(true),
            replaying: !self.replaying().is_empty(),
        }
    }
}

/// Registers the cockpit stream.
pub fn register(r: &mut Registry) {
    let mut me = r.unit::<CockpitStream>("cockpit-stream");
    me.channel(CHANNEL, CockpitStream::received)
        .channel(CLOCKS, CockpitStream::clock_in)
        .on::<SessionStarted>(|me: &mut CockpitStream, _: &SessionStarted, cx: &mut Cx| {
            me.start(cx)
        })
        .on::<SessionEnded>(|me: &mut CockpitStream, _: &SessionEnded, cx: &mut Cx| me.end(cx))
        .on::<LinkUp>(CockpitStream::link_up)
        .on::<MemberGone>(CockpitStream::member_gone)
        .on::<ControlPassed>(CockpitStream::control_passed)
        .on::<FlightChanged>(CockpitStream::flight_changed)
        .on::<PreflightEnded>(|me: &mut CockpitStream, _: &PreflightEnded, cx: &mut Cx| {
            me.maybe_ask(true, cx)
        })
        .guard::<TakeControl>(CockpitStream::guard)
        .client_state(SLICE, |me: &CockpitStream, _: &View| me.slice());
}

/// Whether this member may send a feature's message: preflight has ended, and it's in the
/// flight.
fn may_send(cx: &Cx) -> bool {
    cx.read::<Session>().live_in_flight()
}

/// A member's display name in the middle of a sentence, for one whose key hasn't arrived too.
fn name_of(session: &Session, pilot: &PilotId) -> String {
    session
        .member_key(MEMBER, pilot)
        .map_or_else(|| "a pilot".to_string(), |entry| entry.name)
}

fn in_flight(session: &Session) -> bool {
    session.me().is_some_and(|me| session.in_flight(&me))
}

/// Whether this member is the session's only one.
fn alone(cx: &Cx) -> bool {
    cx.read::<Session>().members().len() <= 1
}

impl CockpitStream {
    fn start(&mut self, cx: &mut Cx) {
        let session = cx.read::<Session>();
        let (Some(pilot), Some(restart)) = (session.me(), session.restart()) else {
            return;
        };
        let collapsing = self
            .kinds
            .iter()
            .filter(|(_, k)| k.collapse)
            .map(|(n, _)| *n)
            .collect();
        self.end(cx);
        self.live = Some(Live {
            me: Origin { pilot, restart },
            clock: VectorClock::default(),
            last_sent: None,
            held: Vec::new(),
            flush: None,
            kept: Vec::new(),
            acks: BTreeMap::new(),
            inbox: Inbox::new(collapsing),
            dispatched: None,
            unfinished: None,
            next_id: 0,
            pace: None,
            applying_in: (0, 0),
            clocks: Some(cx.timer(CLOCK_EVERY, CockpitStream::clocks_out)),
            catch_up: CatchUp::Idle,
            askers: BTreeSet::new(),
            ask_after_replay: false,
            catching_up_with: None,
        });
    }

    fn end(&mut self, cx: &mut Cx) {
        let Some(live) = self.live.take() else {
            return;
        };
        clients::clear_notification(cx, "catch");
        for timer in [live.flush, live.pace.map(|(t, _)| t), live.clocks]
            .into_iter()
            .flatten()
        {
            cx.cancel_timer(timer);
        }
    }

    // Sending.

    pub(crate) fn send_bytes(
        me: &mut CockpitStream,
        (kind, key, body): (u16, String, Vec<u8>),
        cx: &mut Cx,
    ) {
        let Some(hold) = me.kinds.get(&kind).map(|k| k.hold) else {
            return tracing::error!(
                kind,
                "a cockpit message of a kind no unit registered was sent"
            );
        };
        if me.live.is_none() || !may_send(cx) {
            return tracing::debug!(
                kind,
                "a cockpit message wasn't sent, since this member isn't in the flight after preflight"
            );
        }
        // A message carries the control value it was made under, so a held one keeps the value
        // of the moment its unit handed it over: the old pilot flying's switch, held as a
        // takeover reaches it, still goes out as the old pilot flying's, which the takeover
        // drops (record/areas/sync/04-order-and-recovery.md, "A change of control").
        let control = cx.read::<Session>().control().unwrap_or_default();
        if hold {
            let Some(live) = me.live.as_mut() else { return };
            match live
                .held
                .iter_mut()
                .find(|h| h.kind == kind && h.key == key)
            {
                Some(held) => {
                    held.body = body;
                    held.control = control;
                }
                None => live.held.push(Held {
                    kind,
                    key,
                    body,
                    control,
                }),
            }
            if live.flush.is_none() {
                live.flush = Some(cx.timer(HOLD_FOR, CockpitStream::flushed));
            }
        } else {
            me.flush_held(cx);
            me.send_message(kind, key, body, control, cx);
        }
    }

    pub(crate) fn withdraw_held(me: &mut CockpitStream, (kind, key): (u16, String), _: &mut Cx) {
        if let Some(live) = me.live.as_mut() {
            live.held.retain(|h| !(h.kind == kind && h.key == key));
        }
    }

    fn flushed(me: &mut CockpitStream, _: TimerId, cx: &mut Cx) {
        if let Some(live) = me.live.as_mut() {
            live.flush = None;
        }
        me.flush_held(cx);
    }

    /// Sends every held message, in the order each was first held.
    fn flush_held(&mut self, cx: &mut Cx) {
        let Some(live) = self.live.as_mut() else {
            return;
        };
        if let Some(timer) = live.flush.take() {
            cx.cancel_timer(timer);
        }
        let held = std::mem::take(&mut live.held);
        if !may_send(cx) {
            return;
        }
        for h in held {
            self.send_message(h.kind, h.key, h.body, h.control, cx);
        }
    }

    /// Numbers a message with this machine's next count, fills in its clock and gap, keeps it,
    /// and sends it to the crew.
    fn send_message(
        &mut self,
        kind: u16,
        key: String,
        body: Vec<u8>,
        control: Control,
        cx: &mut Cx,
    ) {
        let alone = alone(cx);
        let Some(live) = self.live.as_mut() else {
            return;
        };
        live.clock.bump(live.me);
        let now = cx.now();
        let gap = live.last_sent.map_or(0, |l| {
            u32::try_from(now.saturating_sub(l)).unwrap_or(u32::MAX)
        });
        live.last_sent = Some(now);
        let message = CockpitMessage {
            sender: live.me,
            clock: live.clock.clone(),
            control,
            gap,
            kind,
            key,
            body,
        };
        network::send(cx, CHANNEL, To::Crew, &Wire::Message(message.clone()));
        if kind != CONTROL.number {
            let entry = self.kinds.get(&kind).and_then(|k| k.entry.as_ref());
            cx.raise(CockpitSent {
                kind,
                key: message.key.clone(),
                clock: message.clock.clone(),
                control: message.control,
                names_entry: entry.is_some(),
                number: entry.and_then(|f| f(&message.body)),
            });
        }
        // With nobody else in the session, nobody needs it replayed.
        if !alone {
            live.kept.push(message);
        }
    }

    // Receiving.

    fn received(me: &mut CockpitStream, from: Sender, wire: Wire, cx: &mut Cx) {
        let Some(live) = me.live.as_mut() else {
            return;
        };
        let origin = Origin {
            pilot: from.pilot,
            restart: from.restart,
        };
        match wire {
            Wire::Message(m) => {
                if m.kind == CONTROL.number {
                    live.inbox.control(m.control, m.clock.clone());
                }
                live.inbox.arrived(origin, m);
                me.pump(cx);
            }
            Wire::Replay { clock } => {
                tracing::info!("another member's replay of what this machine missed begins");
                live.inbox.replay(origin, clock);
                me.pump(cx);
            }
            Wire::CatchUpAsk => me.asked(from.pilot, cx),
            Wire::CatchUp {
                clock,
                control,
                steps,
            } => me.answered_catch_up(from.pilot, clock, control, steps, cx),
        }
    }

    /// Applies everything that can apply now, one message at a time: each goes to its kind's
    /// handler, and the next waits for the handler's answer.
    fn pump(&mut self, cx: &mut Cx) {
        loop {
            let session = cx.read::<Session>();
            let control = session.control();
            let flying_in = in_flight(session);
            let Some(live) = self.live.as_mut() else {
                return;
            };
            if live.dispatched.is_some() || !flying_in {
                break;
            }
            match &live.catch_up {
                CatchUp::Asking { .. } => break,
                CatchUp::Taking { made, .. }
                    if !self.steps.iter().all(|s| made.contains(&s.number)) =>
                {
                    break;
                }
                _ => {}
            }
            let now = cx.now();
            if live.applying_in.0 != now {
                live.applying_in = (now, 0);
            }
            if live.applying_in.1 >= MOST_A_INPUT {
                if live.pace.is_none_or(|(_, due)| due != now) {
                    if let Some((timer, _)) = live.pace.take() {
                        cx.cancel_timer(timer);
                    }
                    live.pace = Some((cx.timer(Duration::ZERO, CockpitStream::paced), now));
                }
                break;
            }
            live.applying_in.1 += 1;
            let next = match &live.unfinished {
                // Only the next of the unfinished message's kind and key applies, which counts
                // it applied and goes at once.
                Some((u, _)) => {
                    let mut clock = live.clock.clone();
                    clock.set(u.sender, u.number());
                    let next = live.inbox.next(
                        &clock,
                        live.me,
                        control,
                        now,
                        false,
                        Some((u.kind, u.key.as_str())),
                    );
                    if matches!(next, Next::Apply(_) | Next::Skip(..))
                        && let Some((u, _)) = live.unfinished.take()
                    {
                        Self::commit(live, u, now, None);
                    }
                    next
                }
                None => live
                    .inbox
                    .next(&live.clock, live.me, control, now, true, None),
            };
            match next {
                Next::Apply(m) if m.kind == CONTROL.number => {
                    let m = self.control_applied(m);
                    if let Some(live) = self.live.as_mut() {
                        Self::commit(live, m, now, None);
                    }
                }
                Next::Apply(m) => {
                    let Some(kind) = self.kinds.get(&m.kind) else {
                        // A crew on one release never sends a kind this core lacks.
                        Self::commit(live, m, now, None);
                        continue;
                    };
                    let id = live.next_id;
                    live.next_id += 1;
                    live.dispatched = Some((m.clone(), id));
                    cx.call_handler(&kind.handler, Dispatch { message: m, id });
                    break;
                }
                Next::Skip(m, why) => {
                    tracing::debug!(
                        kind = m.kind,
                        key = m.key,
                        ?why,
                        "a cockpit message was skipped"
                    );
                    Self::commit(live, m, now, Some(why));
                }
                Next::WaitUntil(at) => {
                    if live.pace.is_none_or(|(_, due)| due != at) {
                        if let Some((timer, _)) = live.pace.take() {
                            cx.cancel_timer(timer);
                        }
                        let after = Duration::from_micros(at.saturating_sub(now));
                        live.pace = Some((cx.timer(after, CockpitStream::paced), at));
                    }
                    break;
                }
                Next::Nothing => break,
            }
        }
        self.after_pump(cx);
    }

    /// Tells the pilot while this machine catches up, one word for a late joiner's catch-up and
    /// a short outage's replay, and then that it has, by one notification that changes in place.
    /// Preflight's end catches up every machine as the flight starts, which is no news
    /// (record/areas/interface/decisions.md, "The banner carries what a pilot must see without
    /// the EFB, and the rest shows where it's acted on").
    fn say_catching_up(&mut self, cx: &Cx) {
        let Some(live) = self.live.as_mut() else {
            return;
        };
        let now = match &live.catch_up {
            CatchUp::Asking {
                preflight_end: true,
                ..
            }
            | CatchUp::Taking {
                preflight_end: true,
                ..
            } => None,
            CatchUp::Asking { from, .. } | CatchUp::Taking { from, .. } => Some((*from, true)),
            CatchUp::Idle => live
                .inbox
                .replay_senders()
                .first()
                .map(|sender| (sender.pilot, false)),
        };
        let before = live.catching_up_with;
        if now == before {
            return;
        }
        live.catching_up_with = now;
        let name = |pilot: &PilotId| name_of(cx.read::<Session>(), pilot);
        let said = match (now, before) {
            (Some((pilot, _)), _) => Notification::new(
                Level::Information,
                format!("Catching up with {}", name(&pilot)),
                Landing::Session,
            )
            .detail("Anything you move in the cockpit now will be reset.")
            .busy(),
            (None, Some((pilot, was_catch_up))) => {
                let who = name(&pilot);
                let caught_up = Notification::new(
                    Level::Information,
                    format!("Caught up with {who}"),
                    Landing::Session,
                )
                .once();
                if was_catch_up {
                    caught_up.detail(format!(
                        "Pages and FMS entries may still differ from {who}'s."
                    ))
                } else {
                    caught_up
                }
            }
            (None, None) => return,
        };
        clients::notify(cx, "catch", said);
    }

    /// A replay that ended, and the catch-up a dropped message asks for once none runs.
    fn after_pump(&mut self, cx: &mut Cx) {
        let Some(live) = self.live.as_mut() else {
            return;
        };
        let clock = live.clock.clone();
        let before = live.inbox.replay_senders().len();
        let running = live.inbox.replaying(&clock);
        if running.len() < before {
            tracing::info!("a replay of what this machine missed ended");
        }
        self.ask_after_drop(cx);
        self.say_catching_up(cx);
        // Kept messages go as members' clocks cover them, in `clock_in`, and at once with
        // nobody else in the session, since scanning them all after every message would cost a
        // long cut's handlers their 1ms.
        if alone(cx)
            && let Some(live) = self.live.as_mut()
        {
            live.kept.clear();
        }
    }

    /// Once no replay runs, a machine that applied a message a change of control dropped asks
    /// the new pilot flying for a catch-up, which waits for the session crate to know the new
    /// pilot flying, since the change's message on this stream can come before its key does.
    fn ask_after_drop(&mut self, cx: &mut Cx) {
        let pf = cx.read::<Session>().pf();
        let ready = !self.steps.is_empty() && self.steps_ready();
        let Some(live) = self.live.as_mut() else {
            return;
        };
        if !live.ask_after_replay || !live.inbox.replay_senders().is_empty() {
            return;
        }
        if pf.is_none_or(|pf| pf == live.me.pilot) {
            return;
        }
        live.ask_after_replay = false;
        if !ready {
            return tracing::info!(
                "a change of control dropped a message this machine applied, and it has no profile to catch up"
            );
        }
        tracing::info!(
            "a change of control dropped a message this machine applied, so it catches up from the new pilot flying"
        );
        self.ask_now(false, cx);
    }

    fn paced(me: &mut CockpitStream, timer: TimerId, cx: &mut Cx) {
        if let Some(live) = me.live.as_mut()
            && live.pace.is_some_and(|(t, _)| t == timer)
        {
            live.pace = None;
        }
        me.pump(cx);
    }

    /// The clock takes a message's number, and the stream keeps it for others' replays.
    fn commit(live: &mut Live, m: CockpitMessage, now: u64, skipped: Option<Skipped>) {
        live.clock.set(m.sender, m.number());
        live.inbox.applied(&m, now, skipped);
        live.kept.push(m);
    }

    pub(crate) fn answered(me: &mut CockpitStream, (id, answer): (u64, Answer), cx: &mut Cx) {
        let Some(live) = me.live.as_mut() else {
            return;
        };
        let Some((m, did)) = live.dispatched.take() else {
            return;
        };
        if did != id {
            live.dispatched = Some((m, did));
            return;
        }
        match answer {
            Answer::Done | Answer::Skipped => Self::commit(live, m, cx.now(), None),
            Answer::Unfinished => live.unfinished = Some((m, id)),
        }
        me.pump(cx);
    }

    pub(crate) fn finished(me: &mut CockpitStream, id: u64, cx: &mut Cx) {
        let Some(live) = me.live.as_mut() else {
            return;
        };
        if live.unfinished.as_ref().is_some_and(|(_, u)| *u == id)
            && let Some((m, _)) = live.unfinished.take()
        {
            Self::commit(live, m, cx.now(), None);
            me.pump(cx);
        }
    }

    // Changes of control.

    /// A change of control's message applied: a machine other than the new pilot flying that
    /// counts more of the superseded pilot flying's messages than its clock does applied one the
    /// change drops, and catches up from the new pilot flying.
    fn control_applied(&mut self, m: CockpitMessage) -> CockpitMessage {
        let Some(live) = self.live.as_mut() else {
            return m;
        };
        let Ok(passed) = postcard::from_bytes::<Passed>(&m.body) else {
            tracing::warn!("a change of control's message didn't read");
            return m;
        };
        if passed.after.pf != live.me.pilot
            && let Some(before) = passed.before
            && live
                .clock
                .counters()
                .any(|(o, n)| o.pilot == before.pf && n > m.clock.get(o))
        {
            live.ask_after_replay = true;
        }
        m
    }

    fn control_passed(me: &mut CockpitStream, passed: &ControlPassed, cx: &mut Cx) {
        let Some(live) = me.live.as_ref() else {
            return;
        };
        let mine = live.me.pilot;
        if passed.made_here {
            me.flush_held(cx);
            let body = postcard::to_stdvec(&Passed {
                before: passed.before,
                after: passed.after,
            })
            .expect("a change of control should encode");
            me.send_message(CONTROL.number, String::new(), body, passed.after, cx);
            if let Some(live) = me.live.as_mut() {
                let clock = live.clock.clone();
                live.inbox.control(passed.after, clock);
            }
        }
        let Some(live) = me.live.as_mut() else {
            return;
        };
        // Who asked this machine asks the new pilot flying instead.
        live.askers.clear();
        if passed.after.pf == mine {
            if live.catch_up != CatchUp::Idle {
                tracing::info!(
                    "control reached this pilot during their catch-up, which stops, since they're the source now"
                );
                live.stop_catch_up(cx);
            }
        } else if let CatchUp::Asking { preflight_end, .. }
        | CatchUp::Taking { preflight_end, .. } = live.catch_up.clone()
        {
            tracing::info!(
                "control passed during this machine's catch-up, so it asks the new pilot flying"
            );
            me.ask_now(preflight_end, cx);
        }
        me.ask_after_drop(cx);
        me.pump(cx);
    }

    /// The take-control guard: control can't pass to this pilot while their catch-up runs, or a
    /// replay to them runs, over a link that's up (record/areas/sync/04-order-and-recovery.md,
    /// "Catch-up").
    fn guard(me: &CockpitStream, _: &TakeControl, view: &View) -> Result<(), String> {
        let Some(live) = &me.live else {
            return Ok(());
        };
        let network = view.read::<Network>();
        let catching_up = match &live.catch_up {
            CatchUp::Asking { from, .. } | CatchUp::Taking { from, .. } => Some(*from),
            CatchUp::Idle => None,
        };
        let from = catching_up.filter(|from| network.up(from)).or_else(|| {
            live.inbox
                .replay_senders()
                .into_iter()
                .map(|sender| sender.pilot)
                .find(|pilot| network.up(pilot))
        });
        match from {
            Some(pilot) => Err(format!(
                "You're catching up with {}.",
                name_of(view.read::<Session>(), &pilot)
            )),
            None => Ok(()),
        }
    }

    // Catch-up.

    /// Whether every catch-up step can give and take, which holds for a pipeline of none.
    fn steps_ready(&self) -> bool {
        self.steps.iter().all(|s| self.ready.contains(&s.number))
    }

    pub(crate) fn step_ready(me: &mut CockpitStream, (step, ready): (u16, bool), cx: &mut Cx) {
        let was = me.steps_ready();
        if ready {
            me.ready.insert(step);
        } else {
            me.ready.remove(&step);
        }
        let now = me.steps_ready();
        let Some(live) = me.live.as_mut() else {
            return;
        };
        if now && !was {
            let mine = Some(live.me.pilot);
            if cx.read::<Session>().pf() == mine {
                let askers: Vec<PilotId> = std::mem::take(&mut live.askers).into_iter().collect();
                for asker in askers {
                    me.answer(asker, cx);
                }
            } else {
                me.maybe_ask(false, cx);
            }
        } else if !now && was && live.catch_up != CatchUp::Idle {
            tracing::info!("a catch-up step can't take a catch-up any more, so the catch-up stops");
            live.stop_catch_up(cx);
            me.pump(cx);
        }
    }

    /// Asks for a catch-up when this machine needs one: it isn't the pilot flying, preflight
    /// has ended, it's in the flight, and every step can take one.
    fn maybe_ask(&mut self, preflight_end: bool, cx: &mut Cx) {
        let Some(live) = self.live.as_ref() else {
            return;
        };
        let session = cx.read::<Session>();
        let needed = !self.steps.is_empty()
            && self.steps_ready()
            && live.catch_up == CatchUp::Idle
            && session.preflight().phase == Phase::Ended
            && in_flight(session)
            && session.pf().is_some_and(|pf| pf != live.me.pilot);
        if needed {
            self.ask_now(preflight_end, cx);
        }
    }

    /// Asks the pilot flying for a catch-up, in place of any this machine had asked for.
    fn ask_now(&mut self, preflight_end: bool, cx: &mut Cx) {
        let session = cx.read::<Session>();
        let (Some(pf), control) = (session.pf(), session.control()) else {
            return;
        };
        let ready = !self.steps.is_empty() && self.steps_ready();
        let Some(live) = self.live.as_mut() else {
            return;
        };
        if pf == live.me.pilot || !ready {
            live.stop_catch_up(cx);
            return;
        }
        tracing::info!(
            preflight_end,
            "this machine asks the pilot flying for a catch-up"
        );
        live.catch_up = CatchUp::Asking {
            from: pf,
            control,
            preflight_end,
        };
        network::send(cx, CHANNEL, To::Member(pf), &Wire::CatchUpAsk);
        self.say_catching_up(cx);
    }

    /// Another member asked this machine for a catch-up: the flying machine answers once every
    /// step can give.
    fn asked(&mut self, from: PilotId, cx: &mut Cx) {
        let ready = self.steps_ready();
        let Some(live) = self.live.as_mut() else {
            return;
        };
        if cx.read::<Session>().pf() != Some(live.me.pilot) {
            return tracing::debug!(
                "a catch-up was asked of a machine that isn't the flying machine"
            );
        }
        if ready {
            self.answer(from, cx);
        } else {
            tracing::info!(
                "a catch-up was asked before this machine's steps can give, so it's answered once they can"
            );
            live.askers.insert(from);
        }
    }

    fn answer(&mut self, to: PilotId, cx: &mut Cx) {
        let control = cx.read::<Session>().control().unwrap_or_default();
        let view = cx.view();
        let steps: Vec<(u16, Vec<u8>)> = self
            .steps
            .iter()
            .map(|s| (s.number, (s.give)(&view)))
            .collect();
        let Some(live) = self.live.as_ref() else {
            return;
        };
        tracing::info!(
            bytes = steps.iter().map(|(_, p)| p.len()).sum::<usize>(),
            "the flying machine answers a catch-up"
        );
        network::send(
            cx,
            CHANNEL,
            To::Member(to),
            &Wire::CatchUp {
                clock: live.clock.clone(),
                control,
                steps,
            },
        );
    }

    /// The flying machine's answer: this machine takes its clock, for every counter but its own,
    /// so every message the state already holds drops as a copy, and hands each step its
    /// payload.
    fn answered_catch_up(
        &mut self,
        from: PilotId,
        clock: VectorClock,
        control: Control,
        steps: Vec<(u16, Vec<u8>)>,
        cx: &mut Cx,
    ) {
        let current = cx.read::<Session>().control();
        let Some(live) = self.live.as_mut() else {
            return;
        };
        let CatchUp::Asking {
            from: asked,
            preflight_end,
            ..
        } = live.catch_up.clone()
        else {
            return tracing::debug!(
                "a catch-up's answer came that this machine no longer waits for"
            );
        };
        if asked != from || current != Some(control) {
            tracing::info!(
                "a catch-up's answer came under an old control value, so this machine asks the pilot flying again"
            );
            return self.ask_now(preflight_end, cx);
        }
        let me = live.me;
        live.clock.take(&clock, me);
        let mut made = BTreeSet::new();
        for step in &self.steps {
            match steps.iter().find(|(n, _)| *n == step.number) {
                Some((_, payload)) => cx.call_handler(&step.take, payload.clone()),
                None => {
                    made.insert(step.number);
                }
            }
        }
        live.catch_up = CatchUp::Taking {
            from,
            preflight_end,
            done: made.clone(),
            made,
        };
        tracing::info!("this machine takes the flying machine's catch-up");
        self.steps_progress(cx);
    }

    pub(crate) fn step_made(me: &mut CockpitStream, step: u16, cx: &mut Cx) {
        if let Some(CatchUp::Taking { made, .. }) = me.live.as_mut().map(|l| &mut l.catch_up) {
            made.insert(step);
        }
        me.steps_progress(cx);
    }

    pub(crate) fn step_done(me: &mut CockpitStream, step: u16, cx: &mut Cx) {
        if let Some(CatchUp::Taking { made, done, .. }) = me.live.as_mut().map(|l| &mut l.catch_up)
        {
            made.insert(step);
            done.insert(step);
        }
        me.steps_progress(cx);
    }

    /// Once every step's writes are made, the queue applies on top; once every step is done,
    /// the catch-up ends.
    fn steps_progress(&mut self, cx: &mut Cx) {
        let all: BTreeSet<u16> = self.steps.iter().map(|s| s.number).collect();
        if let Some(live) = self.live.as_mut()
            && let CatchUp::Taking { done, .. } = &live.catch_up
            && all.is_subset(done)
        {
            tracing::info!("this machine's catch-up ended");
            live.catch_up = CatchUp::Idle;
        }
        self.pump(cx);
    }

    // The crew.

    /// A link up again gets a replay of every kept message the member's last clock doesn't
    /// cover, and a catch-up whose answer the link cut off is asked again.
    fn link_up(me: &mut CockpitStream, up: &LinkUp, cx: &mut Cx) {
        let Some(live) = me.live.as_ref() else {
            return;
        };
        let pilot = up.member.pilot;
        if up.again {
            let ack = live.acks.get(&pilot);
            let missing: Vec<&CockpitMessage> = live
                .kept
                .iter()
                .filter(|m| !ack.is_some_and(|c| c.has(m.sender, m.number())))
                .collect();
            tracing::info!(
                messages = missing.len(),
                "a member's link is up again, so it gets a replay"
            );
            network::send(
                cx,
                CHANNEL,
                To::Member(pilot),
                &Wire::Replay {
                    clock: live.clock.clone(),
                },
            );
            for m in missing {
                network::send(cx, CHANNEL, To::Member(pilot), &Wire::Message(m.clone()));
            }
        }
        if let CatchUp::Asking {
            from,
            preflight_end,
            ..
        } = live.catch_up
            && from == pilot
        {
            tracing::info!(
                "the flying machine's link is up again while this machine waits for its catch-up, so it asks again"
            );
            me.ask_now(preflight_end, cx);
        }
    }

    fn member_gone(me: &mut CockpitStream, gone: &MemberGone, cx: &mut Cx) {
        if let Some(live) = me.live.as_mut() {
            live.acks.remove(&gone.member);
            live.askers.remove(&gone.member);
            // Nothing more comes of a replay from a member who's gone.
            live.inbox.stop_replays_from(gone.member);
            if live
                .catching_up_with
                .is_some_and(|(pilot, _)| pilot == gone.member)
            {
                live.take_back_catching_up(cx);
            }
        }
        me.prune(cx);
        me.pump(cx);
    }

    fn flight_changed(me: &mut CockpitStream, changed: &FlightChanged, cx: &mut Cx) {
        let Some(live) = me.live.as_mut() else {
            return;
        };
        if changed.member != live.me.pilot {
            return;
        }
        if !changed.in_flight {
            // A machine out of the flight sends nothing on the stream.
            live.held.clear();
        }
        me.pump(cx);
    }

    fn clocks_out(me: &mut CockpitStream, _: TimerId, cx: &mut Cx) {
        let Some(live) = me.live.as_mut() else {
            return;
        };
        network::send_one_off(cx, CLOCKS, To::Crew, &Clock(live.clock.clone()));
        live.clocks = Some(cx.timer(CLOCK_EVERY, CockpitStream::clocks_out));
    }

    fn clock_in(me: &mut CockpitStream, from: Sender, clock: Clock, cx: &mut Cx) {
        if let Some(live) = me.live.as_mut() {
            live.acks.insert(from.pilot, clock.0);
        }
        me.prune(cx);
    }

    /// Drops each kept message every other member's clock covers.
    fn prune(&mut self, cx: &Cx) {
        let Some(live) = self.live.as_mut() else {
            return;
        };
        let members: Vec<PilotId> = cx
            .read::<Session>()
            .members()
            .into_iter()
            .filter(|p| *p != live.me.pilot)
            .collect();
        let acks = &live.acks;
        live.kept.retain(|m| {
            members
                .iter()
                .any(|p| !acks.get(p).is_some_and(|c| c.has(m.sender, m.number())))
        });
    }
}
