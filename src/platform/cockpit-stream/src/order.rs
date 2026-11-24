//! The order a receiver applies cockpit messages in: each waits until the receiver's clock
//! covers every message it depends on, a copy drops, a replay collapses a run of the pilot
//! flying's changes, a change of control drops what the new pilot flying hadn't seen, and each
//! waits what's left of the gap its sender left before it, capped at 2s
//! (record/areas/sync/05-units.md, "Applying").
//!
//! It holds no kernel state, so its rules are tested with three machines and no core.

use std::collections::{BTreeMap, BTreeSet};

use messages::cockpit::{CONTROL, CockpitMessage, Origin, VectorClock};
use messages::net::PilotId;
use messages::session::Control;

/// The most a message waits for the gap its sender left before it.
pub(crate) const GAP_CAP: u64 = 2_000_000;

/// A message that arrived and hasn't applied yet.
#[derive(Clone, Debug)]
struct Waiting {
    message: CockpitMessage,
    /// It came in a replay, as one of the messages the replay's clock covers.
    replayed: bool,
}

/// What the receiver does next.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Next {
    /// Hand this message to its kind's handler.
    Apply(CockpitMessage),
    /// Skip this message, which counts as applied: a change of control dropped it, or a replay
    /// collapsed it.
    Skip(CockpitMessage, Skipped),
    /// Nothing applies before this stamp, which pacing set.
    WaitUntil(u64),
    /// Nothing can apply until more arrives.
    Nothing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Skipped {
    ControlDropped,
    Collapsed,
}

/// What a receiver holds of the messages that arrived.
#[derive(Debug, Default)]
pub(crate) struct Inbox {
    waiting: Vec<Waiting>,
    /// When each sender's last message applied, which its next waits the gap from.
    last_applied: BTreeMap<Origin, u64>,
    /// The replay each sender opened, by the clock its `Replay` carried, until the receiver's
    /// clock covers it.
    replays: BTreeMap<Origin, VectorClock>,
    /// Each change of control this machine has heard of: the value it made, and the clock of
    /// the core that made it.
    controls: Vec<(Control, VectorClock)>,
    /// The kinds whose runs a replay collapses.
    collapsing: BTreeSet<u16>,
}

impl Inbox {
    pub(crate) fn new(collapsing: BTreeSet<u16>) -> Inbox {
        Inbox {
            collapsing,
            ..Inbox::default()
        }
    }

    /// A message from the connection's sender `from`, live or in a replay.
    pub(crate) fn arrived(&mut self, from: Origin, message: CockpitMessage) {
        let replayed = self
            .replays
            .get(&from)
            .is_some_and(|c| message.number() <= c.get(message.sender));
        self.waiting.push(Waiting { message, replayed });
    }

    /// A change of control, heard as its message arrives or as this core makes it, so a message
    /// it drops is judged whether or not the change's own message has applied yet.
    pub(crate) fn control(&mut self, after: Control, clock: VectorClock) {
        if !self.controls.iter().any(|(c, _)| *c == after) {
            self.controls.push((after, clock));
        }
    }

    /// A replay from `from` runs until this machine's clock covers `clock`.
    pub(crate) fn replay(&mut self, from: Origin, clock: VectorClock) {
        self.replays.insert(from, clock);
    }

    /// The senders whose replays still run, after the clock moved.
    pub(crate) fn replaying(&mut self, clock: &VectorClock) -> Vec<Origin> {
        self.replays.retain(|_, c| !clock.covers(c));
        self.replay_senders()
    }

    /// The senders whose replays ran when the clock last moved.
    pub(crate) fn replay_senders(&self) -> Vec<Origin> {
        self.replays.keys().copied().collect()
    }

    /// Forgets every replay from `pilot`, under any restart count.
    pub(crate) fn stop_replays_from(&mut self, pilot: PilotId) {
        self.replays.retain(|origin, _| origin.pilot != pilot);
    }

    /// Drops every waiting message from `sender`, and when its last applied, so its next message
    /// waits no gap from one of before, as a playback that stopped leaves nothing for the next.
    pub(crate) fn drop_from(&mut self, sender: Origin) {
        self.waiting.retain(|w| w.message.sender != sender);
        self.last_applied.remove(&sender);
    }

    /// Notes that a message applied, or was skipped, at `at`.
    pub(crate) fn applied(&mut self, message: &CockpitMessage, at: u64, skipped: Option<Skipped>) {
        match skipped {
            // The last of a collapsed run applies in its place with no wait before it.
            Some(Skipped::Collapsed) => self.last_applied.remove(&message.sender),
            _ => self.last_applied.insert(message.sender, at),
        };
    }

    pub(crate) fn len(&self) -> usize {
        self.waiting.len()
    }

    /// What applies next, with the receiver's clock as it stands, its own pilot, the session's
    /// control value, and the time. A message never waits on a counter of this machine's own
    /// pilot, since that pilot's earlier cores, the only senders under those counters it
    /// lacks, made their changes in this same cockpit. With `paced` false, a message waits no
    /// gap, and with `only`, only a message of that kind and key can apply, as the next of one
    /// kind and key does that cuts a stepping write short.
    pub(crate) fn next(
        &mut self,
        clock: &VectorClock,
        me: Origin,
        control: Option<Control>,
        now: u64,
        paced: bool,
        only: Option<(u16, &str)>,
    ) -> Next {
        // A message the clock already covers is a copy.
        self.waiting
            .retain(|w| !clock.has(w.message.sender, w.message.number()));
        // A change of control's message on this stream can come before the session crate hears
        // of the change, so a message is judged against the newest control value either knows.
        let control =
            self.controls
                .iter()
                .map(|(c, _)| *c)
                .fold(control, |newest, c| match newest {
                    Some(n) if !c.outranks(&n) => Some(n),
                    _ => Some(c),
                });
        let mut earliest: Option<u64> = None;
        let mut tried = BTreeSet::new();
        for i in 0..self.waiting.len() {
            let Some(w) = self.waiting.get(i) else {
                break;
            };
            let m = &w.message;
            // Only a sender's next message can apply, so later ones of its wait behind it.
            if !tried.insert(m.sender) {
                continue;
            }
            let next_number = clock.get(m.sender) + 1;
            let depends = m
                .clock
                .counters()
                .any(|(o, n)| o != m.sender && o.pilot != me.pilot && clock.get(o) < n);
            if m.number() != next_number || depends {
                continue;
            }
            if only.is_some_and(|(kind, key)| m.kind != kind || m.key != key) {
                continue;
            }
            if m.kind != CONTROL.number
                && let Some(control) = control
                && m.sender.pilot == m.control.pf
                && control != m.control
                && control.outranks(&m.control)
            {
                // A message the superseded pilot flying made under the value it lost applies
                // only if the change of control's clock includes it, and waits for that change.
                let superseding = self
                    .controls
                    .iter()
                    .filter(|(c, _)| c.outranks(&m.control))
                    .min_by(|(a, _), (b, _)| {
                        if a.outranks(b) {
                            std::cmp::Ordering::Greater
                        } else {
                            std::cmp::Ordering::Less
                        }
                    });
                match superseding {
                    None => continue,
                    Some((_, by)) if !by.has(m.sender, m.number()) => {
                        return self.skip(i, Skipped::ControlDropped);
                    }
                    Some(_) => {}
                }
            }
            if paced && let Some(last) = self.last_applied.get(&m.sender) {
                let due = last.saturating_add(u64::from(m.gap).min(GAP_CAP));
                if due > now {
                    earliest = Some(earliest.map_or(due, |e| e.min(due)));
                    continue;
                }
            }
            // A collapsed run waits the gap before its first message, and its last applies in
            // the first's place, with no wait of its own.
            if w.replayed && self.collapsing.contains(&m.kind) {
                match self.collapses(i, clock, me) {
                    Some(true) => return self.skip(i, Skipped::Collapsed),
                    Some(false) => {}
                    // The replay hasn't all arrived, so whether a later change follows can't
                    // be told yet.
                    None => continue,
                }
            }
            let w = self.waiting.remove(i);
            return Next::Apply(w.message);
        }
        match earliest {
            Some(at) => Next::WaitUntil(at),
            None => Next::Nothing,
        }
    }

    fn skip(&mut self, i: usize, why: Skipped) -> Next {
        let w = self.waiting.remove(i);
        Next::Skip(w.message, why)
    }

    /// Whether the replayed message at `i` is followed, in its replay, by a later message of its
    /// kind and key with only collapsing messages between; `None` while the replay is still
    /// arriving.
    fn collapses(&self, i: usize, clock: &VectorClock, me: Origin) -> Option<bool> {
        let w = self.waiting.get(i)?;
        let m = &w.message;
        let whole = self.replays.values().all(|replay| {
            replay
                .counters()
                .filter(|(o, _)| o.pilot != me.pilot)
                .all(|(o, n)| {
                    clock.has(o, n)
                        || self
                            .waiting
                            .iter()
                            .any(|x| x.message.sender == o && x.message.number() >= n)
                })
        });
        if !whole {
            return None;
        }
        for later in self.waiting.iter().skip(i + 1).filter(|x| x.replayed) {
            let l = &later.message;
            if !self.collapsing.contains(&l.kind) {
                return Some(false);
            }
            if l.kind == m.kind && l.key == m.key {
                return Some(true);
            }
        }
        Some(false)
    }
}

#[cfg(test)]
mod tests {
    //! Three machines, A, B, and C, each a clock and an inbox, with the test as the network.

    use super::*;

    const PAGE: u16 = 1;
    const PRESS: u16 = 2;
    const LEVER: u16 = 3;

    fn origin(n: u8) -> Origin {
        Origin {
            pilot: [n; 16],
            restart: 0,
        }
    }

    fn control(generation: u64, pf: u8) -> Control {
        Control {
            generation,
            pf: [pf; 16],
        }
    }

    struct Machine {
        me: Origin,
        clock: VectorClock,
        inbox: Inbox,
        applied: Vec<(u16, String)>,
        skipped: Vec<(u16, String, Skipped)>,
        now: u64,
        control: Control,
        last_sent: Option<u64>,
    }

    impl Machine {
        fn new(n: u8) -> Machine {
            Machine {
                me: origin(n),
                clock: VectorClock::default(),
                inbox: Inbox::new([LEVER].into()),
                applied: Vec::new(),
                skipped: Vec::new(),
                now: 0,
                control: control(1, 1),
                last_sent: None,
            }
        }

        fn send(&mut self, kind: u16, key: &str) -> CockpitMessage {
            self.clock.bump(self.me);
            let gap = self.last_sent.map_or(0, |l| self.now - l) as u32;
            self.last_sent = Some(self.now);
            CockpitMessage {
                sender: self.me,
                clock: self.clock.clone(),
                control: self.control,
                gap,
                kind,
                key: key.into(),
                body: Vec::new(),
            }
        }

        fn get(&mut self, from: Origin, m: &CockpitMessage) {
            if m.kind == CONTROL.number {
                self.inbox.control(m.control, m.clock.clone());
            }
            self.inbox.arrived(from, m.clone());
        }

        /// Applies everything that can apply now.
        fn pump(&mut self) -> Next {
            loop {
                match self.inbox.next(
                    &self.clock,
                    self.me,
                    Some(self.control),
                    self.now,
                    true,
                    None,
                ) {
                    Next::Apply(m) => {
                        self.clock.set(m.sender, m.number());
                        self.inbox.applied(&m, self.now, None);
                        self.applied.push((m.kind, m.key));
                    }
                    Next::Skip(m, why) => {
                        self.clock.set(m.sender, m.number());
                        self.inbox.applied(&m, self.now, Some(why));
                        self.skipped.push((m.kind, m.key, why));
                    }
                    other => return other,
                }
            }
        }
    }

    #[test]
    fn b_s_press_waits_at_c_until_a_s_page_key_has_applied() {
        let (mut a, mut b, mut c) = (Machine::new(1), Machine::new(2), Machine::new(3));
        let page = a.send(PAGE, "page");
        b.get(a.me, &page);
        b.pump();
        let press = b.send(PRESS, "display");
        // B's press reaches C first.
        c.get(b.me, &press);
        assert_eq!(c.pump(), Next::Nothing);
        assert!(
            c.applied.is_empty(),
            "the press waits for the page it was made on"
        );
        c.get(a.me, &page);
        c.pump();
        assert_eq!(
            c.applied,
            vec![(PAGE, "page".to_string()), (PRESS, "display".to_string())]
        );
    }

    #[test]
    fn a_copy_drops_however_it_comes() {
        let (mut a, mut b) = (Machine::new(1), Machine::new(2));
        let m = a.send(PAGE, "page");
        b.get(a.me, &m);
        b.pump();
        b.get(a.me, &m);
        b.pump();
        assert_eq!(b.applied.len(), 1);
        assert_eq!(b.inbox.len(), 0);
    }

    #[test]
    fn a_replay_waits_the_gaps_its_sender_left_capped_at_2s() {
        let (mut a, mut b) = (Machine::new(1), Machine::new(2));
        let mut sent = Vec::new();
        for (at, key) in [(0, "one"), (500_000, "two"), (10_000_000, "three")] {
            a.now = at;
            sent.push(a.send(PAGE, key));
        }
        // The cut ends at 60s, and the three come back to back.
        b.now = 60_000_000;
        b.inbox.replay(a.me, a.clock.clone());
        for m in &sent {
            b.get(a.me, m);
        }
        assert_eq!(b.pump(), Next::WaitUntil(60_500_000));
        assert_eq!(b.applied.len(), 1, "the first waits nothing");
        b.now = 60_500_000;
        assert_eq!(
            b.pump(),
            Next::WaitUntil(62_500_000),
            "the 9.5s gap waits 2s"
        );
        b.now = 62_500_000;
        b.pump();
        assert_eq!(b.applied.len(), 3);
        assert!(
            b.inbox.replaying(&b.clock).is_empty(),
            "the replay ends once its clock is covered"
        );
    }

    #[test]
    fn a_replay_collapses_a_run_of_the_pilot_flyings_changes_but_not_across_an_event() {
        let (mut a, mut b) = (Machine::new(1), Machine::new(2));
        let sent = [
            a.send(LEVER, "throttle"),
            a.send(LEVER, "mixture"),
            a.send(LEVER, "throttle"),
            a.send(PRESS, "starter"),
            a.send(LEVER, "throttle"),
        ];
        b.inbox.replay(a.me, a.clock.clone());
        // Only part of the replay has come, so nothing collapses yet.
        b.get(a.me, &sent[0]);
        assert_eq!(b.pump(), Next::Nothing);
        for m in &sent[1..] {
            b.get(a.me, m);
        }
        b.pump();
        assert_eq!(
            b.skipped,
            vec![(LEVER, "throttle".to_string(), Skipped::Collapsed)]
        );
        assert_eq!(
            b.applied,
            vec![
                (LEVER, "mixture".to_string()),
                (LEVER, "throttle".to_string()),
                (PRESS, "starter".to_string()),
                (LEVER, "throttle".to_string()),
            ],
            "the throttle before the starter keeps the value it had then"
        );
    }

    #[test]
    fn a_change_of_control_drops_what_the_new_pilot_flying_hadnt_seen() {
        let (mut a, mut b, mut c) = (Machine::new(1), Machine::new(2), Machine::new(3));
        // A flies, and makes two changes; B saw the first before it took control.
        let seen = a.send(LEVER, "throttle");
        let solo = a.send(LEVER, "mixture");
        b.get(a.me, &seen);
        b.pump();
        b.control = control(2, 2);
        let mut take = b.send(CONTROL.number, "");
        take.control = control(2, 2);
        c.control = control(2, 2);
        // C hears A's two before B's change of control: they wait for it.
        c.get(a.me, &seen);
        c.get(a.me, &solo);
        assert_eq!(c.pump(), Next::Nothing);
        c.get(b.me, &take);
        c.pump();
        assert_eq!(
            c.applied,
            vec![
                (LEVER, "throttle".to_string()),
                (CONTROL.number, String::new())
            ]
        );
        assert_eq!(
            c.skipped,
            vec![(LEVER, "mixture".to_string(), Skipped::ControlDropped)]
        );
    }

    /// The sync units' budget: kept messages under 4 MB through a 30-minute cut at a busy pilot
    /// flying's 20 changes a second (record/areas/sync/05-units.md, "Budgets").
    #[test]
    fn kept_messages_for_a_30_minute_cut_stay_under_4_mb() {
        let mut a = Machine::new(1);
        a.clock.set(origin(2), 1_234);
        let mut m = a.send(LEVER, "mixture_1");
        m.body = postcard::to_stdvec(&messages::sync::Value::Number(0.73)).unwrap();
        let bytes = postcard::to_stdvec(&messages::cockpit::Cockpit::Message(m))
            .unwrap()
            .len();
        let total = bytes * 20 * 60 * 30;
        println!(
            "budget: a change took {bytes} bytes, so a 30-minute cut at 20 a second keeps {total} bytes, against 4,194,304"
        );
        assert!(total < 4 * 1024 * 1024, "{total} bytes");
    }

    #[test]
    fn a_restarted_core_never_waits_on_its_own_earlier_counters() {
        let mut a = Machine::new(1);
        let old = origin(2);
        a.clock.set(old, 5);
        let m = a.send(PAGE, "page");
        let mut restarted = Machine::new(2);
        restarted.me.restart = 1;
        restarted.get(a.me, &m);
        restarted.pump();
        assert_eq!(restarted.applied.len(), 1);
    }

    /// A playback's message as the recorder hands it over: numbered by the pretend sender, its
    /// clock holding that count alone, and its gap from the one before as recorded.
    fn played(sender: Origin, number: u64, gap: u32, key: &str) -> CockpitMessage {
        let mut clock = VectorClock::default();
        clock.set(sender, number);
        CockpitMessage {
            sender,
            clock,
            control: control(1, 1),
            gap,
            kind: LEVER,
            key: key.into(),
            body: Vec::new(),
        }
    }

    #[test]
    fn a_playbacks_messages_arriving_at_their_times_keep_a_long_pause_and_wait_their_gap_after_a_hold()
     {
        let pretend = origin(0xff);
        let mut b = Machine::new(2);
        b.get(pretend, &played(pretend, 1, 0, "one"));
        b.pump();
        // A 5s pause, longer than the 2s a burst waits at most, passes in full, since the second
        // arrives at its time.
        b.now = 5_000_000;
        b.get(pretend, &played(pretend, 2, 5_000_000, "two"));
        assert_eq!(b.pump(), Next::Nothing);
        assert_eq!(b.applied.len(), 2, "the second applies as it arrives");
        // The third arrives at 5.5s while the second's stepping write holds the stream until 7s,
        // and then waits its own 0.5s after the second applied, as a crewmate's would.
        b.now = 5_500_000;
        let third = played(pretend, 3, 500_000, "three");
        b.now = 7_000_000;
        b.inbox
            .applied(&played(pretend, 2, 5_000_000, "two"), b.now, None);
        b.get(pretend, &third);
        assert_eq!(b.pump(), Next::WaitUntil(7_500_000));
        b.now = 7_500_000;
        b.pump();
        assert_eq!(b.applied.len(), 3);
    }

    #[test]
    fn a_stopped_playback_leaves_nothing_waiting_and_the_next_waits_no_gap_from_it() {
        let pretend = origin(0xff);
        let mut b = Machine::new(2);
        b.get(pretend, &played(pretend, 1, 0, "one"));
        b.pump();
        // Two more wait, the second behind the first's gap.
        b.now = 100_000;
        b.get(pretend, &played(pretend, 2, 1_000_000, "two"));
        b.get(pretend, &played(pretend, 3, 2_000_000, "three"));
        assert!(matches!(b.pump(), Next::WaitUntil(_)));
        b.inbox.drop_from(pretend);
        assert_eq!(b.inbox.len(), 0);
        // The next playback numbers on from the last that applied, and waits no gap from before.
        b.get(pretend, &played(pretend, 2, 3_000_000, "again"));
        assert_eq!(b.pump(), Next::Nothing);
        assert_eq!(b.applied.len(), 2);
    }
}
