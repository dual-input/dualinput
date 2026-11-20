//! The traffic host: while this pilot holds traffic's key and is in the flight, it polls the
//! sim's AI aircraft, helicopters, and nearby ground objects twice a second, reads each new
//! object's identity once, and sends the crew each identity and the states the gate lets out
//! (record/areas/traffic-atc/01-traffic-and-atc.md, "The traffic host").

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use kernel::{Cx, Handle, TimerId};
use messages::net::{ONE_OFF_ROOM, PilotId};
use messages::traffic::{self as wire, Batch, Identified, Identity, Kind, State};
use network::To;
use object_mirror::Gate;
use sim_service::{Period, SimCx, Value, Var};
use simconnect_types::{
    SIMCONNECT_SIMOBJECT_TYPE_AIRCRAFT, SIMCONNECT_SIMOBJECT_TYPE_GROUND,
    SIMCONNECT_SIMOBJECT_TYPE_HELICOPTER,
};

use crate::wire::{Read, polled};

/// How often the host polls, as FS Copilot did: at 2Hz its copies moved uniformly, at 1Hz they
/// held now and then at a sample's end, and at 0.5Hz they stalled and ran 2s behind (FS
/// Copilot fork, `record/traffic-atc/docs/build/log.md`, "Jitter measured, not eyeballed").
const POLL: Duration = Duration::from_millis(500);

/// How long a poll may wait for its answers before it's dropped, in µs. With `POLL`, it leaves
/// 12 polls out at most, for which `OPEN_POLLS` in src/engines/sim-client/src/client.rs keeps
/// room, so change them together.
const POLL_WITHIN: u64 = 2_000_000;

/// How long a sample may go unsent, in µs, which keeps a parked aircraft from going 15s with
/// none, after which a receiving machine removes its copy
/// (record/areas/session/01-roles-and-members.md, "The traffic and ATC host").
const HEARTBEAT: u64 = 5_000_000;

/// The radius aircraft and helicopters are polled within, the most the SDK allows, in meters
/// (record/areas/interface/decisions.md, "Traffic polls within the sim's 200km cap, with no
/// radius setting").
pub(crate) const AIRCRAFT_RADIUS: u32 = 200_000;

/// The radius ground objects are polled within, in meters: a tug about 5m long spans about 3
/// pixels at 1km on a 1,920 by 1,080 screen at a 90° field of view
/// (record/areas/traffic-atc/01-traffic-and-atc.md, "Which objects the host carries").
const GROUND_RADIUS: u32 = 1_000;

/// The title prefixes of the ground objects the host carries: the sim's pushback tugs,
/// `ASO_Pushback_White` and `ASO_Pushback_Blue` at EGLL and KSFO, which push AI aircraft back.
/// GSX's signs, its tugs, about 60 within 1km at KSFO, most parked at gates, and the sim's other
/// vehicles stay on the machine that runs them, since a receiving pilot who runs GSX would see
/// GSX's twice (record/areas/traffic-atc/log.md, 2026-10-17, and 2026-11-15, "In the sim, copies
/// drew at 0.16 on FS Copilot's jitter measure").
const GROUND_ALLOWED: [&str; 1] = ["ASO_Pushback_"];

/// How many objects the host carries at most, the first it finds, counting those whose
/// identity it's still reading. Leaving or entering the flight queues a call for each copy in
/// one input, which the kernel stops past 1,000, and a busy hub's traffic is under 180 objects:
/// at EGLL our probe p10 counted 142 to 153 aircraft, and 23 of the sim's pushback tugs came
/// within 1km of the pilot's aircraft (user, 2026-11-15;
/// record/areas/traffic-atc/01-traffic-and-atc.md, the note at its top).
const MOST_CARRIED: usize = 500;

/// What starts the title of every SimObject of ours, such as avatars' figure,
/// `DUALINPUT_FIGURE_PILOT`, which the host never carries.
const OURS: &str = "DUALINPUT_";

/// The batch's own fields, a base of up to 10 bytes in postcard, its place, and the states'
/// count, which every batch's size counts beside its states'.
const BATCH_HEAD: usize = 12;

/// What the host reads once of each new object, in `Identity`'s order.
fn identity_vars() -> [Var; 5] {
    [
        Var::text("A:TITLE"),
        Var::text("A:LIVERY NAME"),
        Var::text("A:ATC ID"),
        Var::text("A:ATC AIRLINE"),
        Var::text("A:ATC FLIGHT NUMBER"),
    ]
}

/// One object the host tracks.
enum Tracked {
    /// Its identity's read, waiting for its answer, with the kind of the poll that found it.
    Reading(Handle, Kind),
    /// Never carried: one of ours, or a ground object no title on the allowlist starts.
    Skipped,
    Carried(Identity),
}

/// The poll out.
struct Poll {
    started: u64,
    /// Each kind's call, and whether its last answer has come.
    calls: BTreeMap<Handle, (Kind, bool)>,
    seen: BTreeSet<u32>,
    /// The states the gate let out, each with when it was read.
    sends: Vec<(u32, Read, u64)>,
}

/// The traffic host's state, from its first poll until it stops.
pub(crate) struct Hosting {
    timer: TimerId,
    poll: Option<Poll>,
    tracked: BTreeMap<u32, Tracked>,
    gate: Gate<Read>,
    /// The copies this machine removed as its pilot took the role, which its polls find until
    /// their removal lands (record/areas/traffic-atc/01-traffic-and-atc.md, "Which objects the
    /// host carries").
    removing: BTreeSet<u32>,
    /// Whether the host has logged that it reached `MOST_CARRIED`, which it does once.
    capped: bool,
    stats: Stats,
}

/// What the host's log line says every 30s, which a bug report and the bench read.
#[derive(Default)]
struct Stats {
    since: u64,
    polls: u32,
    dropped: u32,
    poll_us: u64,
    read: u32,
    /// Identity reads the sim refused, each of which the next poll makes again.
    refused: u32,
    sent: u32,
    bytes: u64,
}

/// How often the host logs its stats, in µs.
const STATS_EVERY: u64 = 30_000_000;

impl Hosting {
    pub(crate) fn start(removing: BTreeSet<u32>, cx: &Cx) -> Hosting {
        tracing::info!("this pilot shares their traffic, so traffic polls the sim's AI objects");
        Hosting {
            timer: cx.timer(POLL, crate::Traffic::poll_tick),
            poll: None,
            tracked: BTreeMap::new(),
            gate: Gate::new(HEARTBEAT),
            removing,
            capped: false,
            stats: Stats {
                since: cx.now(),
                ..Stats::default()
            },
        }
    }

    /// Stops polling and forgets every object and the gate's state for each, so polling again
    /// sends every identity anew; and when this pilot left the flight, sends every object as
    /// gone, since the key still names them and nobody else removes the copies.
    pub(crate) fn stop(self, left_flight: bool, cx: &Cx) {
        cx.cancel_timer(self.timer);
        if left_flight {
            for (&object, tracked) in &self.tracked {
                if matches!(tracked, Tracked::Carried(_)) {
                    gone(object, cx);
                }
            }
        }
        tracing::info!(left_flight, "traffic stopped polling the sim's AI objects");
    }

    /// The poll's timer: starts a poll unless one is out for under 2s, and drops one out longer,
    /// with nothing sent as gone, since a poll whose answers aren't whole says nothing of what
    /// left.
    pub(crate) fn tick(&mut self, timer: TimerId, cx: &Cx) {
        if timer != self.timer {
            return;
        }
        self.timer = cx.timer(POLL, crate::Traffic::poll_tick);
        let now = cx.now();
        if let Some(poll) = &self.poll {
            if now.saturating_sub(poll.started) < POLL_WITHIN {
                return;
            }
            tracing::info!("a poll's answers weren't whole after 2s, so traffic dropped it");
            self.stats.dropped += 1;
            if let Some(poll) = self.poll.take() {
                self.send_states(poll.sends, cx);
            }
        }
        let sim = cx.sim();
        let vars = polled();
        let calls = [
            (
                Kind::Aircraft,
                SIMCONNECT_SIMOBJECT_TYPE_AIRCRAFT,
                AIRCRAFT_RADIUS,
            ),
            (
                Kind::Helicopter,
                SIMCONNECT_SIMOBJECT_TYPE_HELICOPTER,
                AIRCRAFT_RADIUS,
            ),
            (
                Kind::Ground,
                SIMCONNECT_SIMOBJECT_TYPE_GROUND,
                GROUND_RADIUS,
            ),
        ]
        .map(|(kind, of, radius)| (sim.poll(of, radius, &vars), (kind, false)));
        self.poll = Some(Poll {
            started: now,
            calls: calls.into_iter().collect(),
            seen: BTreeSet::new(),
            sends: Vec::new(),
        });
        self.log_stats(now);
    }

    /// One object a poll found, or a poll of one kind that found none.
    pub(crate) fn polled(
        &mut self,
        call: Handle,
        object: u32,
        values: &[(usize, Value)],
        (entry, out_of): (u32, u32),
        own: &BTreeSet<u32>,
        cx: &Cx,
    ) -> bool {
        let Some(poll) = &mut self.poll else {
            return false;
        };
        let Some(&(kind, _)) = poll.calls.get(&call) else {
            return false;
        };
        if out_of > 0 {
            poll.seen.insert(object);
            let read = Read::of(values);
            self.stats.read += 1;
            let ours = own.contains(&object) || self.removing.contains(&object);
            if !read.user && !ours {
                match self.tracked.get(&object) {
                    // A GSX sign counts while its title is read, which at a busy gate leaves
                    // an aircraft for the next poll, and only the objects carried say the
                    // host is full.
                    None if carrying(&self.tracked).0 >= MOST_CARRIED => {
                        if carrying(&self.tracked).1 >= MOST_CARRIED && !self.capped {
                            self.capped = true;
                            tracing::info!(
                                most = MOST_CARRIED,
                                "the traffic host carries as many objects as it may, so it shares no more"
                            );
                        }
                    }
                    None => {
                        let watch = cx.sim().watch_on(object, &identity_vars(), Period::Once);
                        self.tracked.insert(object, Tracked::Reading(watch, kind));
                    }
                    Some(Tracked::Carried(_)) => {
                        for (read, at) in self.gate.decide(object, read, cx.now()) {
                            poll.sends.push((object, read, at));
                        }
                    }
                    Some(Tracked::Reading(..) | Tracked::Skipped) => {}
                }
            }
        }
        if entry >= out_of
            && let Some((_, done)) = poll.calls.get_mut(&call)
        {
            *done = true;
        }
        if poll.calls.values().all(|(_, done)| *done) {
            self.finish(cx);
        }
        true
    }

    /// Every kind has answered: an object no answer named has gone.
    fn finish(&mut self, cx: &Cx) {
        let Some(poll) = self.poll.take() else {
            return;
        };
        self.stats.polls += 1;
        self.stats.poll_us += cx.now().saturating_sub(poll.started);
        let left: Vec<u32> = self
            .tracked
            .keys()
            .filter(|o| !poll.seen.contains(o))
            .copied()
            .collect();
        for object in left {
            if let Some(Tracked::Carried(_)) = self.tracked.remove(&object) {
                gone(object, cx);
            }
            self.gate.forget(object);
        }
        self.removing.retain(|o| poll.seen.contains(o));
        self.send_states(poll.sends, cx);
    }

    /// A watch's values, which may be an identity's read: the object is carried from its next
    /// poll on, unless it's one of ours or a ground object off the allowlist.
    pub(crate) fn identity(&mut self, watch: Handle, values: &[(usize, Value)], cx: &Cx) -> bool {
        let Some((&object, kind)) = self.tracked.iter().find_map(|(o, t)| match t {
            Tracked::Reading(w, kind) if *w == watch => Some((o, *kind)),
            _ => None,
        }) else {
            return false;
        };
        let text = |at: usize| {
            values
                .iter()
                .find(|(i, _)| *i == at)
                .and_then(|(_, v)| match v {
                    Value::Text(t) => Some(t.clone()),
                    Value::Number(_) => None,
                })
                .unwrap_or_default()
        };
        let identity = Identity {
            title: text(0),
            livery: text(1),
            tail: text(2),
            airline: text(3),
            flight_number: text(4),
            kind,
        };
        let skipped = identity.title.starts_with(OURS)
            || (kind == Kind::Ground
                && !GROUND_ALLOWED
                    .iter()
                    .any(|prefix| identity.title.starts_with(prefix)));
        if skipped {
            self.tracked.insert(object, Tracked::Skipped);
            return true;
        }
        let identified = Identified {
            object,
            identity: Some(identity.clone()),
        };
        network::send(cx, wire::IDENTITIES, To::Crew, &identified);
        self.tracked.insert(object, Tracked::Carried(identity));
        true
    }

    /// A call of the host's the sim refused or couldn't make: an identity's read, whose object
    /// the next poll reads again if it's still there.
    pub(crate) fn refused(&mut self, call: Handle) -> bool {
        let reading = self
            .tracked
            .iter()
            .find(|(_, t)| matches!(t, Tracked::Reading(w, _) if *w == call))
            .map(|(&o, _)| o);
        if let Some(object) = reading {
            self.tracked.remove(&object);
            self.stats.refused += 1;
            return true;
        }
        self.poll
            .as_ref()
            .is_some_and(|p| p.calls.contains_key(&call))
    }

    /// Traffic's connection went, and the poll and every identity's read out went with it, so
    /// the next poll starts anew and reads those objects again.
    pub(crate) fn lost(&mut self) {
        self.poll = None;
        self.tracked
            .retain(|_, t| !matches!(t, Tracked::Reading(..)));
    }

    /// An object a create of this machine's made after its copy went, which this machine
    /// removes, so its polls skip it until the removal lands.
    pub(crate) fn removing(&mut self, object: u32) {
        self.removing.insert(object);
    }

    /// A member's link came up: it gets every identity, and every object's next sample goes
    /// out, so a member that comes back or joins creates every copy within about 500ms of its
    /// identities.
    pub(crate) fn link_up(&mut self, member: PilotId, cx: &Cx) {
        let mut sent = 0;
        for (&object, tracked) in &self.tracked {
            if let Tracked::Carried(identity) = tracked {
                let identified = Identified {
                    object,
                    identity: Some(identity.clone()),
                };
                network::send(cx, wire::IDENTITIES, To::Member(member), &identified);
                sent += 1;
            }
        }
        self.gate.heartbeat_all();
        tracing::info!(
            member = messages::hex(&member),
            identities = sent,
            "a member's link came up, so traffic sent it every identity"
        );
    }

    /// Sends the gate's states in batches, each under a one-off packet's room in postcard,
    /// each keyed by its place among the poll's batches.
    fn send_states(&mut self, sends: Vec<(u32, Read, u64)>, cx: &Cx) {
        let Some(base) = sends.iter().map(|(_, _, at)| *at).min() else {
            return;
        };
        let mut batch = Batch {
            base,
            place: 0,
            states: Vec::new(),
        };
        let mut size = BATCH_HEAD;
        for (object, read, at) in sends {
            let after_ms = u16::try_from(at.saturating_sub(base) / 1_000).unwrap_or(u16::MAX);
            let state = read.state(object, after_ms);
            let bytes = encoded_size(&state);
            if size + bytes > ONE_OFF_ROOM && !batch.states.is_empty() {
                self.send_batch(&batch, size, cx);
                batch.place = batch.place.wrapping_add(1);
                batch.states.clear();
                size = BATCH_HEAD;
            }
            batch.states.push(state);
            size += bytes;
        }
        self.send_batch(&batch, size, cx);
    }

    fn send_batch(&mut self, batch: &Batch, size: usize, cx: &Cx) {
        self.stats.sent += batch.states.len() as u32;
        self.stats.bytes += size as u64;
        network::send_one_off(cx, wire::STATES, To::Crew, batch);
    }

    fn log_stats(&mut self, now: u64) {
        let s = &self.stats;
        let took = now.saturating_sub(s.since);
        if took < STATS_EVERY {
            return;
        }
        let objects = self
            .tracked
            .values()
            .filter(|t| matches!(t, Tracked::Carried(_)))
            .count();
        tracing::info!(
            objects,
            polls = s.polls,
            dropped = s.dropped,
            poll_ms = s.poll_us / u64::from(s.polls.max(1)) / 1_000,
            read = s.read,
            refused = s.refused,
            sent = s.sent,
            bytes_per_s = s.bytes * 1_000_000 / took,
            "traffic's stats as the traffic host"
        );
        self.stats = Stats {
            since: now,
            ..Stats::default()
        };
    }
}

/// How many objects are carried or have their identity read, and how many are carried.
fn carrying(tracked: &BTreeMap<u32, Tracked>) -> (usize, usize) {
    tracked.values().fold((0, 0), |(both, carried), t| match t {
        Tracked::Reading(..) => (both + 1, carried),
        Tracked::Carried(_) => (both + 1, carried + 1),
        Tracked::Skipped => (both, carried),
    })
}

fn gone(object: u32, cx: &Cx) {
    let identified = Identified {
        object,
        identity: None,
    };
    network::send(cx, wire::IDENTITIES, To::Crew, &identified);
}

fn encoded_size(state: &State) -> usize {
    postcard::to_stdvec(state).map_or(64, |bytes| bytes.len())
}
