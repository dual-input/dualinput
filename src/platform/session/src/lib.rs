//! The session crate, the platform's crate for who is in a session and what they share: the
//! members and who is in the flight, the session's keys, control, the session file, joining
//! and leaving, preflight and its hold, the match check, and when the core exits
//! (record/areas/session/02-units.md).
//!
//! Every core works out who is in the flight from a key each member writes about its own
//! sim, with one function, so control, preflight, and the session's end all turn on one rule
//! that no member answers for another.
//!
//! Register it after the network crate, whose opener and session channel it fills, and
//! before every feature that declares a session key, a match item, or a guard on its
//! requests.

mod control;
mod file;
mod joining;
mod matching;
mod members;
mod preflight;
mod slice;
mod store;

pub use matching::{Found, clear_match, set_match};
pub use messages::session::{Control, Key, MatchItem, Phase, Preflight, Writer};

use std::collections::{BTreeMap, BTreeSet};

use clients::{ClientsUnit, SettingDef};
use kernel::{Cx, Handle, JobId, Moment, Registry, TimerId, Unit};
use messages::clients::SettingKind;
use messages::net::{EndpointId, PilotId, Relay};
use messages::session::{self as wire, KeyValue, Keys, Link, Stamp};
use network::{
    BackendAnswered, BindFailed, ConnectionRefused, EndpointBound, LinkLost, LinkUp, MemberLeft,
    MemberOut, NetUnit, To,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::json;
use sim_service::{AircraftChanged, SimChanged, SimUnit};

use crate::store::Store;

/// A session started for this core: hosted, joined, or found in the session file as the core
/// started.
pub struct SessionStarted;
/// The session ended for this core.
pub struct SessionEnded;
/// A member's first message passed, and it takes part in the session.
pub struct MemberJoined {
    pub member: PilotId,
}
/// A member left the session, was counted out after 30 minutes, or another member saw it
/// leave.
pub struct MemberGone {
    pub member: PilotId,
}
/// A member entered the flight or left it (record/areas/session/02-units.md, "In the
/// flight").
pub struct FlightChanged {
    pub member: PilotId,
    pub in_flight: bool,
}
/// A key's value changed, by this core's write or another's.
pub struct KeyChanged {
    pub key: u16,
}
/// The pilot flying changed. `made_here` when this core made the change, so the cockpit
/// stream sends its message of the change with this core's vector clock.
pub struct ControlPassed {
    pub before: Option<Control>,
    pub after: Control,
    pub made_here: bool,
}
/// Preflight ended, raised once in a session, when this core first sees the phase.
pub struct PreflightEnded;

impl Moment for SessionStarted {}
impl Moment for SessionEnded {}
impl Moment for MemberJoined {}
impl Moment for MemberGone {}
impl Moment for FlightChanged {}
impl Moment for KeyChanged {}
impl Moment for ControlPassed {}
impl Moment for PreflightEnded {}

/// A request to write session keys, which every feature makes through `cx.ask`, so a guard
/// on any one key refuses the whole request, as "Share my traffic and ATC" claims two keys at
/// once (record/areas/architecture/02-code-map.md, "Guards").
pub struct WriteKeys {
    /// Each key by its number, and its value in postcard, or `None` to clear it.
    pub writes: Vec<(u16, Option<Vec<u8>>)>,
}

impl WriteKeys {
    pub fn one<T: Serialize>(key: Key<T>, value: &T) -> WriteKeys {
        WriteKeys {
            writes: vec![(key.number, Some(encode(value)))],
        }
    }

    /// The value the request writes into `key`: `None` when it writes no value there, and
    /// `Some(None)` when it clears it.
    pub fn value<T: DeserializeOwned>(&self, key: Key<T>) -> Option<Option<T>> {
        let (_, value) = self.writes.iter().find(|(k, _)| *k == key.number)?;
        Some(
            value
                .as_ref()
                .and_then(|bytes| postcard::from_bytes(bytes).ok()),
        )
    }
}

/// This pilot taking control now, which the take-control key and button ask for.
pub struct TakeControl;

/// This pilot's Ready during preflight.
pub struct Ready;

/// A key a unit declared.
#[derive(Clone, Copy)]
pub(crate) struct Declared {
    pub(crate) writer: Writer,
    pub(crate) names_member: bool,
    /// A role's label, in its feature's words, which the switch shows.
    pub(crate) label: Option<&'static str>,
}

/// The session crate's state.
#[derive(Default)]
pub struct Session {
    pub(crate) declared: BTreeMap<u16, Declared>,
    pub(crate) items: BTreeMap<u16, matching::Item>,
    /// This core's own value for each match item, which an item's owner hands over whether
    /// or not a session is held, so a session that starts later writes them at once.
    pub(crate) mine: BTreeMap<u16, Vec<u8>>,
    /// Host or Join, waiting for the backend's answer.
    pub(crate) asking: Option<joining::Asking>,
    /// Why the last Host or Join was refused, until the next starts.
    pub(crate) refused: Option<wire::Refused>,
    pub(crate) held: Option<Held>,
    /// The job that reads the clipboard for the EFB app's code box.
    pub(crate) clipboard: Option<JobId>,
    /// The session file's write that was still running as the session ended, after which
    /// the file is deleted.
    pub(crate) delete_after: Option<JobId>,
    /// Set once a quit has started, after which the core exits.
    pub(crate) quitting: bool,
    /// Whether `settle` is queued for this input.
    pub(crate) settling: bool,
}

/// The session this core holds.
pub(crate) struct Held {
    /// Whether this is a join whose first link hasn't come up, which the apps show as an attempt
    /// rather than a session.
    pub(crate) dialing: bool,
    /// Whether this is a Host whose endpoint hasn't bound, which the apps show as an attempt too,
    /// so a session that can't reach anyone never shows.
    pub(crate) opening: bool,
    pub(crate) id: String,
    pub(crate) code: String,
    pub(crate) me: PilotId,
    pub(crate) name: String,
    pub(crate) restart: u32,
    pub(crate) key: [u8; 32],
    pub(crate) relays: Vec<Relay>,
    pub(crate) store: Store,
    pub(crate) control: Option<Control>,
    /// Each other member, from its first `LinkUp` until it's gone.
    pub(crate) others: BTreeMap<PilotId, Other>,
    /// The members who left, whom this core's status lists as left, so a member that can't
    /// reach a leaver learns it left.
    pub(crate) left: BTreeSet<PilotId>,
    /// The crew to dial, which the session file keeps: each other member's endpoint, from
    /// the backend's answer or the file, and from each `LinkUp`.
    pub(crate) crew: BTreeMap<PilotId, EndpointId>,
    /// Each member's answer to whether it's in the flight, as last raised.
    pub(crate) flight: BTreeMap<PilotId, bool>,
    /// The members that have been in the flight, whose leaving it the crew hears of.
    pub(crate) was_in: BTreeSet<PilotId>,
    /// Where each crewmate who was in the flight has gone, as the crew last heard it.
    pub(crate) away: BTreeMap<PilotId, members::Away>,
    /// Whether this core has raised `PreflightEnded`.
    pub(crate) ended_seen: bool,
    /// A core that started from the session file passes control it held once the crew's
    /// first message has passed, since only then does it know the current control value
    /// (record/areas/sync/04-order-and-recovery.md, "A core that restarts").
    pub(crate) restarted: bool,
    /// Whether the session file holds what this core last wrote, which `network::open` waits
    /// for.
    pub(crate) file: joining::FileState,
    /// The run of the sim the pilot was last in, which the session file keeps.
    pub(crate) run: Option<(u32, u64)>,
    pub(crate) countdown: Option<TimerId>,
    /// Whether this core feeds `Hold`.
    pub(crate) hold: bool,
    /// The read of `A:SIM ON GROUND` the pilot flying's core makes as preflight first gets an
    /// aircraft.
    pub(crate) ground: Option<Handle>,
    /// A pilot flying who leaves passes control, then closes 1s later.
    pub(crate) leaving: Option<(TimerId, bool)>,
    /// How many members have joined, which orders them.
    pub(crate) joined: u64,
}

impl Held {
    /// Whether the apps show this as a Host or Join still running rather than a session.
    pub(crate) fn attempting(&self) -> bool {
        self.dialing || self.opening
    }
}

/// Another member: this core's link to it, and its place in the order members joined.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Other {
    pub(crate) link: Link,
    pub(crate) order: u64,
}

impl Session {
    /// Whether this core holds a session.
    pub fn held(&self) -> bool {
        self.held.is_some()
    }

    /// This pilot's ID in the session.
    pub fn me(&self) -> Option<PilotId> {
        self.held.as_ref().map(|h| h.me)
    }

    /// This core's restart count in the session, which the cockpit stream counts its messages
    /// under.
    pub fn restart(&self) -> Option<u32> {
        self.held.as_ref().map(|h| h.restart)
    }

    /// The session's invite code.
    pub fn code(&self) -> Option<&str> {
        self.held.as_ref().map(|h| h.code.as_str())
    }

    /// The control value, once this core knows one.
    pub fn control(&self) -> Option<Control> {
        self.held.as_ref().and_then(|h| h.control)
    }

    /// The pilot flying, once this core knows the control value.
    pub fn pf(&self) -> Option<PilotId> {
        self.control().map(|c| c.pf)
    }

    /// Every member, this pilot first, then the others in the order they joined.
    pub fn members(&self) -> Vec<PilotId> {
        let Some(held) = &self.held else {
            return Vec::new();
        };
        let mut others: Vec<(&PilotId, &Other)> = held.others.iter().collect();
        others.sort_by_key(|(_, o)| o.order);
        std::iter::once(held.me)
            .chain(others.into_iter().map(|(p, _)| *p))
            .collect()
    }

    /// A member's display name, or "A pilot" for one whose key hasn't arrived.
    pub fn name_of(&self, member: &PilotId) -> String {
        self.member_key(wire::MEMBER, member)
            .map_or_else(|| "A pilot".to_string(), |entry| entry.name)
    }

    /// Whether this pilot is in the flight and preflight has ended, the only time what they do
    /// in the cockpit reaches the crew and the take-control input counts
    /// (record/areas/session/01-roles-and-members.md, "The PF").
    pub fn live_in_flight(&self) -> bool {
        self.preflight().phase == Phase::Ended && self.me().is_some_and(|me| self.in_flight(&me))
    }

    /// A session-wide key's value.
    pub fn key<T: DeserializeOwned>(&self, key: Key<T>) -> Option<T> {
        let held = self.held.as_ref()?;
        decode(held.store.get(key.number, None)?.value.as_deref()?)
    }

    /// A member's own copy of a key every member writes.
    pub fn member_key<T: DeserializeOwned>(&self, key: Key<T>, member: &PilotId) -> Option<T> {
        let held = self.held.as_ref()?;
        decode(
            held.store
                .get(key.number, Some(*member))?
                .value
                .as_deref()?,
        )
    }

    /// The session's aircraft and preflight's phase.
    pub fn preflight(&self) -> Preflight {
        self.key(wire::PREFLIGHT).unwrap_or_default()
    }

    /// Whether a member is in the flight: its sim at Ready to fly or Flying, in the session's
    /// aircraft, folder and preset, compared ignoring case. Every core works this out the same
    /// way, from the keys it holds, so no member writes a yes or no of its own.
    pub fn in_flight(&self, member: &PilotId) -> bool {
        let Some(aircraft) = self.preflight().aircraft else {
            return false;
        };
        let Some(status) = self.member_key(wire::STATUS, member) else {
            return false;
        };
        members::flying(status.stage)
            && status
                .aircraft
                .is_some_and(|a| a.path.eq_ignore_ascii_case(&aircraft.path))
    }

    /// The match check's differences among the members in the flight.
    pub fn differences(&self) -> Vec<wire::Difference> {
        matching::differences(self)
    }
}

/// What a unit declares to the session crate as it registers.
pub trait SessionUnit {
    /// A session key the unit owns, which it writes through `WriteKeys`.
    fn session_key<T>(&mut self, key: Key<T>) -> &mut Self;

    /// A role's key, with its label in the feature's words, which "Share my traffic and ATC"
    /// claims with every other role's.
    fn role_key(&mut self, key: Key<Option<PilotId>>, label: &'static str) -> &mut Self;

    /// An item of the match check, which compares every member's value with `compare`, and
    /// whose value the unit hands over with `set_match` whenever it changes.
    fn match_item<T: DeserializeOwned + 'static>(
        &mut self,
        item: MatchItem<T>,
        compare: fn(&[(String, T)]) -> Option<Found>,
    ) -> &mut Self;
}

impl<S: 'static> SessionUnit for Unit<'_, S> {
    fn session_key<T>(&mut self, key: Key<T>) -> &mut Self {
        declare(
            self.registry(),
            key.number,
            key.writer,
            key.names_member,
            None,
        );
        self
    }

    fn role_key(&mut self, key: Key<Option<PilotId>>, label: &'static str) -> &mut Self {
        declare(self.registry(), key.number, key.writer, true, Some(label));
        self
    }

    fn match_item<T: DeserializeOwned + 'static>(
        &mut self,
        item: MatchItem<T>,
        compare: fn(&[(String, T)]) -> Option<Found>,
    ) -> &mut Self {
        let session = self.registry().state_mut::<Session>();
        assert!(
            session
                .items
                .insert(item.number, matching::Item::new(compare))
                .is_none(),
            "match item {} should be registered once",
            item.number
        );
        self
    }
}

fn declare(
    r: &mut Registry,
    number: u16,
    writer: Writer,
    names_member: bool,
    label: Option<&'static str>,
) {
    let session = r.state_mut::<Session>();
    assert!(
        session
            .declared
            .insert(
                number,
                Declared {
                    writer,
                    names_member,
                    label,
                },
            )
            .is_none(),
        "session key {number} should be declared once"
    );
}

/// Registers the session crate.
pub fn register(r: &mut Registry) {
    let mut me = r.unit::<Session>("session");
    me.start_file(file::NAME, joining::session_file)
        .opener(wire::CHANNEL, Session::opened)
        .channel(wire::CHANNEL, Session::keys_in)
        .on::<BackendAnswered>(joining::answered)
        .on::<ConnectionRefused>(joining::connection_refused)
        .on::<EndpointBound>(joining::endpoint_bound)
        .on::<BindFailed>(|me, _: &BindFailed, cx| me.cannot_open(cx))
        .on::<LinkUp>(members::link_up)
        .on::<LinkLost>(members::link_lost)
        .on::<MemberLeft>(|me, left: &MemberLeft, cx| me.gone(left.member, cx))
        .on::<MemberOut>(members::member_out)
        .on::<SimChanged>(|me, _: &SimChanged, cx| me.settle(cx))
        .on::<AircraftChanged>(matching::aircraft_changed)
        .on_sim(preflight::sim)
        .request(control::take, control::build_take)
        .guard(control::own_guard)
        .request(preflight::ready_request, preflight::build_ready)
        .guard(preflight::own_guard)
        .request(Session::write_keys, slice::build_share)
        .command(wire::command::HOST, joining::host)
        .command(wire::command::JOIN, joining::join)
        .command(
            wire::command::JOIN_FROM_CLIPBOARD,
            joining::join_from_clipboard,
        )
        .command(wire::command::CANCEL, joining::cancel)
        .command(wire::command::COPY_CODE, joining::copy_code)
        .command(wire::command::LEAVE, |me, (): (), cx| {
            me.leave(cx, false);
            Ok(())
        })
        .command(wire::command::QUIT, |me, (): (), cx| {
            me.quit(cx);
            Ok(())
        })
        .command(wire::command::READY, preflight::ready_command)
        .command(wire::command::GO_WITHOUT, preflight::go_without)
        .command(wire::command::SHARE, slice::share)
        .setting(
            wire::NAME,
            SettingDef {
                label: "The name your crew sees",
                kind: SettingKind::LimitedText {
                    max: wire::NAME_MAX_CHARACTERS,
                },
                default: json!(""),
                part_only: false,
                development: false,
            },
        )
        .client_state(wire::SLICE, slice::build);
    me.session_key(wire::MEMBER)
        .session_key(wire::STATUS)
        .session_key(wire::READY)
        .session_key(wire::MATCH)
        .session_key(wire::PREFLIGHT)
        .match_item(wire::PACKAGE, matching::compare_package)
        .match_item(wire::VERSION, matching::compare_version)
        .match_item(wire::LIVERY, matching::compare_livery);
}

impl Session {
    /// Writes one of this core's keys, sends it to the crew, and raises `KeyChanged` when its
    /// value changed. A member's own key goes under this pilot.
    pub(crate) fn write<T: Serialize>(&mut self, key: Key<T>, value: Option<&T>, cx: &Cx) {
        self.write_bytes(key.number, value.map(encode), cx);
    }

    pub(crate) fn write_bytes(&mut self, number: u16, value: Option<Vec<u8>>, cx: &Cx) {
        let Some(declared) = self.declared.get(&number).copied() else {
            return tracing::error!(key = number, "a key no unit declared was written");
        };
        let Some(held) = &mut self.held else {
            return;
        };
        let member = (declared.writer == Writer::Member).then_some(held.me);
        if held.store.get(number, member).map(|h| &h.value) == Some(&value) {
            return;
        }
        let control = held.control.unwrap_or_default();
        let stamp = held.store.stamp(number, member, held.me, control);
        let value = KeyValue {
            key: number,
            stamp,
            value,
        };
        if held.store.take(declared.writer, value.clone()) {
            network::send(
                cx,
                wire::CHANNEL,
                To::Crew,
                &Keys {
                    control: held.control,
                    values: vec![value],
                },
            );
            cx.raise(KeyChanged { key: number });
        }
    }

    /// Writes every session-wide key again under the control value, as the core that becomes
    /// the pilot flying does, so nothing an ex-pilot flying set during a cut, such as a sim
    /// rate or a pause, outranks the new pilot flying's session
    /// (record/areas/network/01-between-machines.md, "Channels").
    pub(crate) fn stamp_again(&mut self, cx: &Cx) {
        let Some(held) = &mut self.held else {
            return;
        };
        let (Some(control), me) = (held.control, held.me) else {
            return;
        };
        let mut values = Vec::new();
        for number in held.store.wide() {
            let Some(declared) = self.declared.get(&number) else {
                continue;
            };
            let value = held.store.get(number, None).and_then(|h| h.value.clone());
            let stamp = held.store.stamp(number, None, me, control);
            let value = KeyValue {
                key: number,
                stamp,
                value,
            };
            if held.store.take(declared.writer, value.clone()) {
                values.push(value);
            }
        }
        if !values.is_empty() {
            network::send(
                cx,
                wire::CHANNEL,
                To::Crew,
                &Keys {
                    control: Some(control),
                    values,
                },
            );
        }
    }

    /// As each connection comes up, its first message carries every key this core holds, whose
    /// size the session's budget holds under 4 KB with two pilots
    /// (record/areas/session/02-units.md, "Budgets").
    fn opened(me: &mut Session, opened: network::Opened, cx: &mut Cx) {
        let keys = me.all_keys();
        tracing::info!(
            conn = opened.conn,
            bytes = encode(&keys).len(),
            "a connection's first message carries this core's keys"
        );
        network::first(cx, opened, &keys);
    }

    pub(crate) fn all_keys(&self) -> Keys {
        match &self.held {
            Some(held) => Keys {
                control: held.control,
                values: held.store.all(),
            },
            None => Keys::default(),
        }
    }

    /// Keys from another core, its first message's or a change after.
    fn keys_in(me: &mut Session, from: network::Sender, keys: Keys, cx: &mut Cx) {
        if let Some(control) = keys.control {
            control::arrived(me, control, cx);
        }
        let Some(held) = &mut me.held else {
            return;
        };
        let mine = held.me;
        // One message can hold many values of one key, and the kernel stops the core at 1,000
        // moments and calls for one input, so each key acts once however many it holds.
        let mut assert = BTreeMap::<u16, u64>::new();
        let mut changed = BTreeSet::new();
        for value in keys.values {
            let Some(declared) = me.declared.get(&value.key).copied() else {
                tracing::debug!(
                    key = value.key,
                    "a key no unit of this core declared arrived, and was dropped"
                );
                continue;
            };
            // A core that restarted lost its own keys' stamps, so its first writes stamp
            // lower than what the crew holds of it, and it writes its own value again above
            // theirs.
            if declared.writer == Writer::Member && value.stamp.writer == mine {
                let held_stamp = held.store.get(value.key, Some(mine)).map(|h| h.stamp);
                if held_stamp.is_none_or(|s: Stamp| value.stamp.outranks(&s)) {
                    let n = assert.entry(value.key).or_default();
                    *n = (*n).max(value.stamp.n);
                }
                continue;
            }
            let key = value.key;
            if held.store.take(declared.writer, value) {
                changed.insert(key);
            }
        }
        for key in changed {
            cx.raise(KeyChanged { key });
        }
        for (key, n) in assert {
            me.assert_own(key, n, cx);
        }
        members::learn(me, from, cx);
        if me
            .held
            .as_ref()
            .is_some_and(|h| h.restarted && h.control.is_some())
        {
            control::pass_after_restart(me, cx);
        }
        me.settle(cx);
    }

    /// Writes this core's own value of a member key again, above `n`.
    fn assert_own(&mut self, number: u16, n: u64, cx: &Cx) {
        let Some(held) = &mut self.held else {
            return;
        };
        let me = held.me;
        let value = held
            .store
            .get(number, Some(me))
            .and_then(|h| h.value.clone());
        let control = held.control.unwrap_or_default();
        let stamp = Stamp {
            control,
            n: n + 1,
            writer: me,
        };
        let value = KeyValue {
            key: number,
            stamp,
            value,
        };
        held.store.take(Writer::Member, value.clone());
        network::send(
            cx,
            wire::CHANNEL,
            To::Crew,
            &Keys {
                control: held.control,
                values: vec![value],
            },
        );
    }

    /// `WriteKeys`, once every guard on it allowed it.
    fn write_keys(me: &mut Session, request: WriteKeys, cx: &mut Cx) {
        let pf = me.pf();
        let mine = me.me();
        for (number, value) in request.writes {
            match me.declared.get(&number).map(|d| d.writer) {
                Some(Writer::PilotFlying) if pf != mine || mine.is_none() => tracing::info!(
                    key = number,
                    "a key only the pilot flying writes wasn't written, since this pilot isn't flying"
                ),
                Some(_) => me.write_bytes(number, value, cx),
                None => tracing::error!(key = number, "a key no unit declared was asked for"),
            }
        }
        me.settle(cx);
    }

    /// Brings everything that follows from the keys up to date, after any handler that
    /// changed them: who is in the flight, control's passes, preflight, the hold, and the
    /// session's end. It's queued behind every call already queued, so the handlers one input
    /// calls share one pass, as a first message raises `LinkUp` and then hands over the keys
    /// behind it.
    pub(crate) fn settle(&mut self, cx: &Cx) {
        if !self.settling {
            self.settling = true;
            cx.call(Session::settle_now, ());
        }
    }

    fn settle_now(me: &mut Session, (): (), cx: &mut Cx) {
        me.settling = false;
        me.settle_all(cx);
    }

    fn settle_all(&mut self, cx: &mut Cx) {
        if self.held.is_none() {
            joining::check_exit(self, cx);
            return;
        }
        members::write_status(self, cx);
        // A pass of control or a preflight write changes who is in the flight, and a change
        // of who is in the flight can call for either, so this runs until nothing changes.
        for _ in 0..8 {
            let changed = members::flight_changes(self, cx) | preflight::run(self, cx);
            if !changed {
                break;
            }
        }
        preflight::hold(self, cx);
        preflight::ended(self, cx);
        members::notifications(self, cx);
        members::end_if_nobody_flies(self, cx);
    }
}

pub(crate) fn encode<T: Serialize>(value: &T) -> Vec<u8> {
    postcard::to_stdvec(value).expect("a session key's value should encode with postcard")
}

pub(crate) fn decode<T: DeserializeOwned>(bytes: &[u8]) -> Option<T> {
    postcard::from_bytes(bytes).ok()
}

#[cfg(test)]
mod tests {
    use messages::backend::Kind;
    use messages::session::{KeyValue, MemberEntry, Ready as ReadyKey, Status};
    use messages::sim::{Aircraft, Stage};

    use super::*;

    const ME: PilotId = [1; 16];
    const THEM: PilotId = [2; 16];

    /// A session this core holds, with every key the session crate declares, and `THEM` a
    /// member whose link is up.
    fn session() -> Session {
        let mut r = Registry::new();
        clients::register(&mut r);
        sim_service::register(&mut r);
        network::register(&mut r);
        register(&mut r);
        let declared = std::mem::take(&mut r.state_mut::<Session>().declared);
        let mut held = Held {
            dialing: false,
            opening: false,
            id: String::new(),
            code: "KX7P3M".into(),
            me: ME,
            name: "James".into(),
            restart: 0,
            key: [0; 32],
            relays: Vec::new(),
            store: Store::default(),
            control: Some(Control {
                generation: 1,
                pf: ME,
            }),
            others: BTreeMap::new(),
            left: BTreeSet::new(),
            crew: BTreeMap::new(),
            flight: BTreeMap::new(),
            was_in: BTreeSet::new(),
            away: BTreeMap::new(),
            ended_seen: false,
            restarted: false,
            file: joining::FileState::default(),
            run: None,
            countdown: None,
            hold: false,
            ground: None,
            leaving: None,
            joined: 1,
        };
        held.others.insert(
            THEM,
            Other {
                link: Link::Up,
                order: 1,
            },
        );
        Session {
            declared,
            held: Some(held),
            ..Session::default()
        }
    }

    fn put<T: Serialize>(me: &mut Session, key: Key<T>, writer: PilotId, value: &T) {
        let held = me.held.as_mut().unwrap();
        let control = held.control.unwrap();
        let member = (key.writer == Writer::Member).then_some(writer);
        let stamp = held.store.stamp(key.number, member, writer, control);
        held.store.take(
            key.writer,
            KeyValue {
                key: key.number,
                stamp,
                value: Some(encode(value)),
            },
        );
    }

    fn status(stage: Stage, path: &str) -> Status {
        Status {
            stage,
            aircraft: Some(Aircraft { path: path.into() }),
            ..Status::default()
        }
    }

    fn preflight(path: &str, phase: Phase) -> Preflight {
        Preflight {
            aircraft: Some(Aircraft { path: path.into() }),
            phase,
        }
    }

    /// A member is in the flight at Ready to fly or Flying, in the session's aircraft, folder
    /// and preset, compared ignoring case.
    #[test]
    fn a_member_is_in_the_flight_in_the_sessions_aircraft_at_ready_to_fly_or_flying() {
        let mut me = session();
        put(
            &mut me,
            wire::STATUS,
            ME,
            &status(Stage::Flying, "bksq-aircraft-baronpropress"),
        );
        assert!(
            !me.in_flight(&ME),
            "a session with no aircraft has nobody in the flight"
        );
        put(
            &mut me,
            wire::PREFLIGHT,
            ME,
            &preflight("BKSQ-aircraft-baronpropress", Phase::Running),
        );
        assert!(me.in_flight(&ME));
        put(
            &mut me,
            wire::STATUS,
            THEM,
            &status(Stage::ReadyToFly, "pa24-250/presets/a2a/pa24-250"),
        );
        assert!(
            !me.in_flight(&THEM),
            "another aircraft is out of the flight"
        );
        put(
            &mut me,
            wire::STATUS,
            THEM,
            &status(Stage::Menu, "bksq-aircraft-baronpropress"),
        );
        assert!(!me.in_flight(&THEM), "the main menu is out of the flight");
    }

    /// Preflight counts every member that no member's Ready goes without.
    #[test]
    fn preflight_counts_every_member_no_ready_goes_without() {
        let mut me = session();
        assert_eq!(preflight::counted(&me), vec![ME, THEM]);
        put(
            &mut me,
            wire::READY,
            ME,
            &ReadyKey {
                ready: true,
                without: vec![THEM],
            },
        );
        assert_eq!(preflight::counted(&me), vec![ME]);
    }

    #[test]
    fn the_members_are_this_pilot_first_then_the_others_in_the_order_they_joined() {
        let mut me = session();
        put(
            &mut me,
            wire::MEMBER,
            THEM,
            &MemberEntry {
                name: "Adam".into(),
                kind: Kind::Crew,
                endpoint: [0; 32],
            },
        );
        assert_eq!(me.members(), vec![ME, THEM]);
        assert_eq!(me.member_key(wire::MEMBER, &THEM).unwrap().name, "Adam");
    }
}
