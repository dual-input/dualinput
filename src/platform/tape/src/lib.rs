//! The recorder's unit, `tape`, which lets one author on one PC see what a crewmate's changes do
//! in their cockpit: it records the cockpit stream's messages of the recorded kinds as this
//! machine sends them, with each catch-up step's payload at Record, and plays them back into the
//! same cockpit from the stream's pretend sender, which state sync's own handlers apply as a
//! crewmate's (record/areas/profiles/05-the-recorder.md).
//!
//! It works only alone in a session's flight, since the pretend sender's counter goes into this
//! machine's clock, and a crewmate's stream would wait for its messages. A member joining, or the
//! profile's unload, as at a save's reload, stops what's running, and says so in the slice. The
//! one recording stays until the next Record or the session's end.
//!
//! A feature whose messages travel outside the cockpit stream registers its channel here, as
//! flight-model sync registers its samples, so the aircraft flies the recorded path too: it hands
//! `tape` each message it sends while a recording runs, and gets each back at its recorded time
//! during a playback (record/areas/profiles/05-the-recorder.md, "Flying the recorded path").
//!
//! Register it after the cockpit stream, the session, and the profile loader, whose moments it
//! hears, and before every feature, whose channels register with it.

use std::collections::HashMap;
use std::ops::Range;
use std::time::Duration;

use clients::ClientsUnit;
use cockpit_stream::{CockpitCx, CockpitSent, CockpitStream, PretendCaughtUp};
use kernel::{Cx, Handler, Moment, Registry, TimerId, Unit, View};
use messages::net::Channel;
use messages::session::MEMBER;
use messages::tape::{
    NAME, StoppedBy, Stopping, TapeOff, TapeSlice, TapeState, TapeStopped, command,
};
use profile_loader::ProfileUnloaded;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use session::{MemberJoined, Session, SessionEnded};

/// A playback started, ended, or stopped, so a feature that runs something else through one reads
/// `Tape::playing` again.
pub struct PlaybackChanged;

impl Moment for PlaybackChanged {}

/// A message of a registered channel, handed back at its recorded time during a playback.
pub struct Played<B> {
    pub body: B,
    /// µs from Record to the moment the playback's messages started, which moves a time on this
    /// core's counter from the recording onto the playback.
    pub shift: u64,
}

/// How often the slice's running time is read again. The island counts on by itself from each
/// reading, so its readout moves every second either way, and this only keeps it true.
const READ_EVERY: Duration = Duration::from_secs(1);

/// The most messages one input hands over, so a core whose playback timer fires late, as after
/// a debugger held it, doesn't panic. Each message queues a call or two in the kernel, which
/// takes over 1,000 for one input as a cycle and panics, and at 20 samples a second a timer 25s
/// late would find 500 due. The rest go out in the inputs after it, in order.
const MOST_AT_ONCE: usize = 100;

/// The recorder's state.
#[derive(Default)]
pub struct Tape {
    recording: Option<Recording>,
    running: Running,
    /// The running time the slice shows, in µs, as last read.
    shown: u64,
    stopped: Option<TapeStopped>,
    /// The timer that reads the running time again.
    reading: Option<TimerId>,
    /// The timer for the playback's next message, or for its end.
    next: Option<TimerId>,
    /// The channels features registered, by number, each with the handler that takes its
    /// messages back during a playback.
    channels: HashMap<u16, Handler<(Vec<u8>, u64)>>,
}

struct Recording {
    /// The core's counter at Record, in µs.
    started: u64,
    /// Each catch-up step's payload at Record, which playback's catch-up takes.
    payloads: Vec<(u16, Vec<u8>)>,
    messages: Vec<Recorded>,
    /// The registered channels' messages, in the order they came.
    taken: Vec<Taken>,
    /// µs from Record to Stop.
    length: u64,
}

/// A message as the stream sent it.
struct Recorded {
    /// µs since Record.
    at: u64,
    kind: u16,
    key: String,
    body: Vec<u8>,
}

/// A registered channel's message, as its feature sent it.
struct Taken {
    /// µs since Record.
    at: u64,
    channel: u16,
    /// Its postcard bytes.
    body: Vec<u8>,
}

/// How far a playback has got through the recording's messages and taken messages: the next of
/// each to hand over.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Cursor {
    message: usize,
    taken: usize,
}

#[derive(Default)]
enum Running {
    #[default]
    Nothing,
    Recording,
    /// Playback's catch-up, until the stream raises `PretendCaughtUp`.
    Restoring,
    /// Playing since `since`, on the core's counter.
    Playing {
        since: u64,
        cursor: Cursor,
        /// The most µs a message has been handed over after its recorded time, which the
        /// playback's end and its stop log for the 20ms budget
        /// (record/areas/profiles/05-the-recorder.md, "Budgets"). It counts from the inputs'
        /// stamps, so it holds how late the timer woke, and not how long its input then waited
        /// in the loop's queue, which the loop's stats give.
        most_late: u64,
    },
}

/// A channel of a unit's own, outside the cockpit stream, that the recorder records and plays
/// back, as a cockpit kind marks itself recorded with the stream.
pub trait TapeUnit<S> {
    /// The unit hands `tape` each message of `channel` it sends, through `cx.tape().take`, which
    /// `tape` keeps while a recording runs, and `f` gets each back at its recorded time during a
    /// playback. A message that doesn't read is skipped.
    fn taped<B: DeserializeOwned + 'static>(
        &mut self,
        channel: Channel<B>,
        f: fn(&mut S, Played<B>, &mut Cx),
    ) -> &mut Self;
}

impl<S: 'static> TapeUnit<S> for Unit<'_, S> {
    fn taped<B: DeserializeOwned + 'static>(
        &mut self,
        channel: Channel<B>,
        f: fn(&mut S, Played<B>, &mut Cx),
    ) -> &mut Self {
        let number = channel.number;
        let handler = self.handler(
            move |state: &mut S, (bytes, shift): (Vec<u8>, u64), cx: &mut Cx| {
                match postcard::from_bytes::<B>(&bytes) {
                    Ok(body) => f(state, Played { body, shift }, cx),
                    Err(error) => tracing::warn!(
                        channel = number,
                        %error,
                        "a recorded message didn't read, so it was skipped"
                    ),
                }
            },
        );
        let tape = self.registry().state_mut::<Tape>();
        assert!(
            tape.channels.insert(number, handler).is_none(),
            "channel {number} should be registered with tape once"
        );
        self
    }
}

/// What a handler calls on the recorder, through `cx.tape()`.
pub trait TapeCx<'k> {
    fn tape(&self) -> TapeCalls<'_, 'k>;
}

impl<'k> TapeCx<'k> for Cx<'k> {
    fn tape(&self) -> TapeCalls<'_, 'k> {
        TapeCalls { cx: self }
    }
}

pub struct TapeCalls<'c, 'k> {
    cx: &'c Cx<'k>,
}

impl TapeCalls<'_, '_> {
    /// A message of a registered channel as the feature sends it, which `tape` keeps, with its
    /// time since Record, while a recording runs.
    pub fn take<B: Serialize>(&self, channel: Channel<B>, body: &B) {
        if !matches!(self.cx.read::<Tape>().running, Running::Recording) {
            return;
        }
        match postcard::to_stdvec(body) {
            Ok(bytes) => self.cx.call(Tape::took, (channel.number, bytes)),
            Err(error) => {
                tracing::error!(channel = channel.number, %error, "a message to record didn't encode");
            }
        }
    }
}

/// Registers the recorder.
pub fn register(r: &mut Registry) {
    let mut me = r.unit::<Tape>(NAME);
    me.on::<CockpitSent>(Tape::sent)
        .on::<PretendCaughtUp>(Tape::caught_up)
        .on::<MemberJoined>(Tape::joined)
        .on::<ProfileUnloaded>(|me: &mut Tape, _: &ProfileUnloaded, cx: &mut Cx| {
            me.interrupted(StoppedBy::Reload, cx);
        })
        .on::<SessionEnded>(Tape::ended)
        .command(command::RECORD, Tape::record)
        .command(command::STOP, Tape::stop)
        .command(command::PLAY, Tape::play)
        .client_state(NAME, Tape::slice);
}

impl Tape {
    /// Whether a playback runs, from Play to its end or its stop, the cockpit's putting back
    /// included.
    pub fn playing(&self) -> bool {
        matches!(self.running, Running::Restoring | Running::Playing { .. })
    }

    /// The recording's first message of `channel`, as a feature puts back what it held at Record.
    pub fn first<B: DeserializeOwned>(&self, channel: Channel<B>) -> Option<B> {
        let taken = self
            .recording
            .as_ref()?
            .taken
            .iter()
            .find(|t| t.channel == channel.number)?;
        postcard::from_bytes(&taken.body).ok()
    }

    fn record(me: &mut Tape, _: Value, cx: &mut Cx) -> Result<(), String> {
        refuse(off(&cx.view()))?;
        me.end_running(cx);
        // A playback that reached its end can leave a knob still stepping in the stream, with
        // messages waiting behind it, which a new recording shouldn't record as they apply.
        cx.cockpit().stop_pretending();
        let payloads = cx.read::<CockpitStream>().payloads(&cx.view());
        me.recording = Some(Recording {
            started: cx.now(),
            payloads,
            messages: Vec::new(),
            taken: Vec::new(),
            length: 0,
        });
        me.running = Running::Recording;
        me.stopped = None;
        me.read_again(cx);
        tracing::info!("a recording started");
        Ok(())
    }

    fn stop(me: &mut Tape, _: Value, cx: &mut Cx) -> Result<(), String> {
        me.stopped = None;
        me.end_running(cx);
        Ok(())
    }

    fn play(me: &mut Tape, _: Value, cx: &mut Cx) -> Result<(), String> {
        refuse(off(&cx.view()))?;
        if !matches!(me.running, Running::Nothing) {
            return Err("the recorder is running, so press Stop first".into());
        }
        let Some(recording) = &me.recording else {
            return Err("there's no recording to play".into());
        };
        cx.cockpit().stop_pretending();
        cx.cockpit().pretend(recording.payloads.clone());
        tracing::info!(
            messages = recording.messages.len(),
            taken = recording.taken.len(),
            ms = recording.length / 1_000,
            "a playback started"
        );
        me.running = Running::Restoring;
        me.stopped = None;
        me.shown = 0;
        cx.raise(PlaybackChanged);
        Ok(())
    }

    /// Ends what's running, as Stop does: a recording keeps what it has, and a playback stops.
    fn end_running(&mut self, cx: &mut Cx) {
        let now = cx.now();
        match std::mem::take(&mut self.running) {
            Running::Recording => {
                if let Some(recording) = self.recording.as_mut() {
                    recording.length = now.saturating_sub(recording.started);
                    tracing::info!(
                        messages = recording.messages.len(),
                        taken = recording.taken.len(),
                        ms = recording.length / 1_000,
                        bytes = recording.bytes(),
                        "a recording stopped"
                    );
                }
            }
            Running::Restoring => {
                cx.cockpit().stop_pretending();
                cx.raise(PlaybackChanged);
                tracing::info!("a playback stopped");
            }
            Running::Playing { most_late, .. } => {
                cx.cockpit().stop_pretending();
                cx.raise(PlaybackChanged);
                tracing::info!(most_late_us = most_late, "a playback stopped");
            }
            Running::Nothing => {}
        }
        for timer in [self.reading.take(), self.next.take()]
            .into_iter()
            .flatten()
        {
            cx.cancel_timer(timer);
        }
    }

    /// Something other than Stop stopped what's running, which the slice says until the next
    /// command. A playback that reached its end can still have a knob stepping in the stream, so
    /// the stream stops pretending whatever runs here: a crewmate who joins then takes a clock
    /// that covers every pretend message, and an unload leaves none to apply into the next load.
    fn interrupted(&mut self, by: StoppedBy, cx: &mut Cx) {
        cx.cockpit().stop_pretending();
        let what = match self.running {
            Running::Nothing => return,
            Running::Recording => Stopping::Recording,
            Running::Restoring | Running::Playing { .. } => Stopping::Playback,
        };
        tracing::info!(?by, "what the recorder was running stopped");
        self.end_running(cx);
        self.stopped = Some(TapeStopped { what, by });
    }

    fn joined(me: &mut Tape, joined: &MemberJoined, cx: &mut Cx) {
        // In the middle of a sentence, as "Playback stopped because a pilot joined", for a member
        // whose key hasn't arrived.
        let name = {
            let session = cx.read::<Session>();
            if session.me() == Some(joined.member) {
                return;
            }
            session
                .member_key(MEMBER, &joined.member)
                .map_or_else(|| "a pilot".to_string(), |entry| entry.name)
        };
        me.interrupted(StoppedBy::Joined { name }, cx);
    }

    fn ended(me: &mut Tape, _: &SessionEnded, cx: &mut Cx) {
        me.end_running(cx);
        me.recording = None;
        me.stopped = None;
    }

    /// A recorded kind's message as the stream sent it, while recording.
    fn sent(me: &mut Tape, sent: &CockpitSent, cx: &mut Cx) {
        let (Running::Recording, Some(recording)) = (&me.running, me.recording.as_mut()) else {
            return;
        };
        if !sent.recorded {
            return;
        }
        recording.messages.push(Recorded {
            at: cx.now().saturating_sub(recording.started),
            kind: sent.kind,
            key: sent.key.clone(),
            body: sent.body.clone(),
        });
    }

    /// A registered channel's message as its feature sent it, while recording.
    fn took(me: &mut Tape, (channel, body): (u16, Vec<u8>), cx: &mut Cx) {
        let (Running::Recording, Some(recording)) = (&me.running, me.recording.as_mut()) else {
            return;
        };
        if !me.channels.contains_key(&channel) {
            tracing::warn!(
                channel,
                "a message of a channel nobody registered with tape was left out"
            );
            return;
        }
        recording.taken.push(Taken {
            at: cx.now().saturating_sub(recording.started),
            channel,
            body,
        });
    }

    /// The cockpit stands as it did at Record, so the playback's messages start, each at its time
    /// since Record, counted from now.
    fn caught_up(me: &mut Tape, _: &PretendCaughtUp, cx: &mut Cx) {
        if !matches!(me.running, Running::Restoring) {
            return;
        }
        me.running = Running::Playing {
            since: cx.now(),
            cursor: Cursor::default(),
            most_late: 0,
        };
        me.read_again(cx);
        me.send_due(cx);
    }

    /// Hands over the messages whose time has come: each of the stream's, with its gap from the
    /// one before as it was sent, and each registered channel's, to its feature with the
    /// playback's shift. Then sets a timer for the next, at once when more were due than one
    /// input hands over, or ends the playback at the recording's length. The messages arrive at
    /// their times rather than all at once, since the stream caps the gap a message waits at 2s,
    /// which would shorten a longer pause (record/areas/profiles/05-the-recorder.md, "Playback").
    fn send_due(&mut self, cx: &mut Cx) {
        let (
            Running::Playing {
                since,
                cursor,
                most_late,
            },
            Some(recording),
        ) = (&mut self.running, self.recording.as_ref())
        else {
            return;
        };
        let elapsed = cx.now().saturating_sub(*since);
        let (messages, taken) = recording.due(cursor, elapsed);
        *most_late = messages
            .clone()
            .map(|i| recording.messages[i].at)
            .chain(taken.clone().map(|i| recording.taken[i].at))
            .map(|at| elapsed.saturating_sub(at))
            .fold(*most_late, u64::max);
        for i in messages {
            let m = &recording.messages[i];
            let before = i.checked_sub(1).map_or(0, |b| recording.messages[b].at);
            let gap = u32::try_from(m.at.saturating_sub(before)).unwrap_or(u32::MAX);
            cx.cockpit()
                .arrive(m.kind, m.key.clone(), m.body.clone(), gap);
        }
        let shift = since.saturating_sub(recording.started);
        for t in &recording.taken[taken] {
            if let Some(handler) = self.channels.get(&t.channel) {
                cx.call_handler(handler, (t.body.clone(), shift));
            }
        }
        let Some(due) = recording.next(cursor, elapsed) else {
            tracing::info!(most_late_us = *most_late, "a playback reached its end");
            self.running = Running::Nothing;
            if let Some(timer) = self.reading.take() {
                cx.cancel_timer(timer);
            }
            cx.raise(PlaybackChanged);
            return;
        };
        let wait = Duration::from_micros(due.saturating_sub(elapsed));
        self.next = Some(cx.timer(wait, Tape::due));
    }

    fn due(me: &mut Tape, timer: TimerId, cx: &mut Cx) {
        if me.next == Some(timer) {
            me.next = None;
            me.send_due(cx);
        }
    }

    /// Reads the running time again, and again each `READ_EVERY` while something runs.
    fn read_again(&mut self, cx: &mut Cx) {
        let since = match (&self.running, &self.recording) {
            (Running::Recording, Some(recording)) => recording.started,
            (Running::Playing { since, .. }, _) => *since,
            _ => return,
        };
        self.shown = cx.now().saturating_sub(since);
        if let Some(timer) = self.reading.take() {
            cx.cancel_timer(timer);
        }
        self.reading = Some(cx.timer(READ_EVERY, Tape::read));
    }

    fn read(me: &mut Tape, timer: TimerId, cx: &mut Cx) {
        if me.reading == Some(timer) {
            me.reading = None;
            me.read_again(cx);
        }
    }

    /// The slice `tape`.
    fn slice(me: &Tape, view: &View) -> TapeSlice {
        let ms = |us: u64| us / 1_000;
        let length = me.recording.as_ref().map_or(0, |r| r.length);
        let state = match (&me.running, &me.recording) {
            (Running::Recording, _) => TapeState::Recording {
                elapsed_ms: ms(me.shown),
            },
            (Running::Restoring, _) => TapeState::Restoring {
                length_ms: ms(length),
            },
            (Running::Playing { .. }, _) => TapeState::Playing {
                at_ms: ms(me.shown.min(length)),
                length_ms: ms(length),
            },
            (Running::Nothing, Some(_)) => TapeState::Recorded {
                length_ms: ms(length),
            },
            (Running::Nothing, None) => TapeState::Empty,
        };
        TapeSlice {
            state,
            off: off(view),
            stopped: me.stopped.clone(),
        }
    }
}

impl Recording {
    /// The bytes the recording holds on the heap, which its stop logs: each list's slots, and
    /// each message's key and body, without what the allocator adds to each block.
    fn bytes(&self) -> usize {
        let slots = self.payloads.capacity() * size_of::<(u16, Vec<u8>)>()
            + self.messages.capacity() * size_of::<Recorded>()
            + self.taken.capacity() * size_of::<Taken>();
        let payloads: usize = self.payloads.iter().map(|(_, body)| body.capacity()).sum();
        let messages: usize = self
            .messages
            .iter()
            .map(|m| m.key.capacity() + m.body.capacity())
            .sum();
        let taken: usize = self.taken.iter().map(|t| t.body.capacity()).sum();
        slots + payloads + messages + taken
    }

    /// Moves `cursor` past the messages and taken messages due by `elapsed`, µs since the
    /// playback's messages started, in the order of their times across the two, at most
    /// `MOST_AT_ONCE`, and returns the indices it passed in each.
    fn due(&self, cursor: &mut Cursor, elapsed: u64) -> (Range<usize>, Range<usize>) {
        let from = *cursor;
        for _ in 0..MOST_AT_ONCE {
            let message = self
                .messages
                .get(cursor.message)
                .filter(|m| m.at <= elapsed);
            let taken = self.taken.get(cursor.taken).filter(|t| t.at <= elapsed);
            match (message, taken) {
                (Some(m), Some(t)) if t.at < m.at => cursor.taken += 1,
                (Some(_), _) => cursor.message += 1,
                (None, Some(_)) => cursor.taken += 1,
                (None, None) => break,
            }
        }
        (from.message..cursor.message, from.taken..cursor.taken)
    }

    /// When the next message or taken message after `cursor` is due, in µs since the playback's
    /// messages started, or the playback's end at the recording's length once none is left;
    /// `None` once that end has come by `elapsed`.
    fn next(&self, cursor: &Cursor, elapsed: u64) -> Option<u64> {
        let soonest = [
            self.messages.get(cursor.message).map(|m| m.at),
            self.taken.get(cursor.taken).map(|t| t.at),
        ]
        .into_iter()
        .flatten()
        .min();
        soonest.or((elapsed < self.length).then_some(self.length))
    }
}

/// Why the recorder can't act now, of the reasons the core can see
/// (record/areas/profiles/05-the-recorder.md, "When the recorder works").
fn off(view: &View) -> Option<TapeOff> {
    let session = view.read::<Session>();
    if !session.live_in_flight() {
        return Some(TapeOff::NoFlight);
    }
    if session.members().len() > 1 {
        return Some(TapeOff::Crew);
    }
    if !view.read::<CockpitStream>().steps_ready() {
        return Some(TapeOff::Loading);
    }
    None
}

/// A command's refusal, in words the island never shows, since its buttons are off then.
fn refuse(off: Option<TapeOff>) -> Result<(), String> {
    match off {
        None => Ok(()),
        Some(TapeOff::NoFlight) => Err("the recorder works in a session's flight".into()),
        Some(TapeOff::Crew) => {
            Err("the recorder works only while you're alone in the session".into())
        }
        Some(TapeOff::Loading) => Err("the profile is still loading".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A recording with messages at `messages` and taken messages at `taken`, each in µs since
    /// Record, `length` µs long.
    fn recording(messages: &[u64], taken: &[u64], length: u64) -> Recording {
        Recording {
            started: 0,
            payloads: Vec::new(),
            messages: messages
                .iter()
                .map(|&at| Recorded {
                    at,
                    kind: 1,
                    key: String::new(),
                    body: Vec::new(),
                })
                .collect(),
            taken: taken
                .iter()
                .map(|&at| Taken {
                    at,
                    channel: 6,
                    body: Vec::new(),
                })
                .collect(),
            length,
        }
    }

    /// The design's case: a playback hands each message and each sample at its recorded time,
    /// in order across the two, and ends at the recording's length
    /// (record/areas/profiles/05-the-recorder.md, "Cases").
    #[test]
    fn a_playback_hands_each_message_and_sample_at_its_time_and_ends_at_the_length() {
        let r = recording(&[100, 300], &[50, 200, 350], 500);
        let mut cursor = Cursor::default();
        assert_eq!(r.due(&mut cursor, 0), (0..0, 0..0));
        assert_eq!(r.next(&cursor, 0), Some(50));
        assert_eq!(r.due(&mut cursor, 120), (0..1, 0..1));
        assert_eq!(r.next(&cursor, 120), Some(200));
        // A late timer hands over everything due by then at once.
        assert_eq!(r.due(&mut cursor, 400), (1..2, 1..3));
        assert_eq!(r.next(&cursor, 400), Some(500));
        assert_eq!(r.due(&mut cursor, 500), (2..2, 3..3));
        assert_eq!(r.next(&cursor, 500), None);
    }

    /// A timer that fires long after its time, as after a debugger held the core, finds more due
    /// than one input hands over, and the rest go in the next, which is due at once.
    #[test]
    fn a_late_timer_hands_over_at_most_its_share_and_the_rest_at_once() {
        let samples: Vec<u64> = (1..=150).collect();
        let r = recording(&[60], &samples, 1_000);
        let mut cursor = Cursor::default();
        // The message at 60 goes in its place among the samples.
        assert_eq!(r.due(&mut cursor, 900), (0..1, 0..MOST_AT_ONCE - 1));
        assert_eq!(r.next(&cursor, 900), Some(100));
        assert_eq!(r.due(&mut cursor, 900), (1..1, MOST_AT_ONCE - 1..150));
        assert_eq!(r.next(&cursor, 900), Some(1_000));
    }

    #[test]
    fn a_recording_with_nothing_in_it_plays_to_its_length() {
        let r = recording(&[], &[], 2_000);
        let mut cursor = Cursor::default();
        assert_eq!(r.due(&mut cursor, 0), (0..0, 0..0));
        assert_eq!(r.next(&cursor, 0), Some(2_000));
        assert_eq!(r.next(&cursor, 2_000), None);
    }
}
