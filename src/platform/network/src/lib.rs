//! The network crate, the platform's crate for everything between machines: each member's
//! link and its connection, the channels, the heartbeat and clock offsets, and the first
//! message's checks. It makes every decision on the loop, each link's state and timers, every
//! dial and close, and which of two connections stays, so a replay reproduces each one, and
//! asks the transport, at the core's edge, to carry them out
//! (record/areas/network/02-units.md, "The network crate").
//!
//! Register it after the clients crate, whose settings and slice it uses, and before every unit
//! that registers a channel.

mod backend;
mod clock;
mod edge;
mod hooks;
mod links;
mod reach;
mod slewed;

pub use backend::{
    Answer, Asked, BACKEND, BackendAnswered, Host, Join, Me, RELAYS, RELAYS_ONLY, Refusal, cancel,
    endpoint_id, host, join, member,
};
pub use edge::{Transport, encode as encode_event};
pub use hooks::{NetUnit, Opened, Sender};
pub use messages::net::OneOff;
pub use slewed::Slewed;

use std::collections::BTreeMap;

use clients::{Clients, ClientsUnit, SettingDef};
use kernel::{Cx, Moment, Registry, Started, TimerId, View};
use messages::clients::SettingKind;
use messages::net::{
    Channel, Command, Delivery, EndpointId, HEARTBEAT, Header, MemberLink, NetSlice, PilotId,
    Relay, SLICE, Wait,
};
use serde::Serialize;
use serde_json::json;

use crate::clock::Offset;
use crate::hooks::{ChannelReg, OpenerReg};
use crate::links::{Conn, Link};

/// A member: a pilot ID, with the restart count and endpoint ID of its latest first message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Member {
    pub pilot: PilotId,
    pub restart: u32,
    pub endpoint: EndpointId,
}

/// The member's link took a connection whose first message passed; `again` when it was up
/// before under the same restart count.
pub struct LinkUp {
    pub member: Member,
    pub again: bool,
}

/// 5s with nothing on the member's connection.
pub struct LinkLost {
    pub member: PilotId,
}

/// The member's connection closed with Leave's code or the quit code.
pub struct MemberLeft {
    pub member: PilotId,
}

/// 30 minutes without a connection to the member.
pub struct MemberOut {
    pub member: PilotId,
}

/// The session's endpoint bound, so its links can dial.
pub struct EndpointBound;

/// The session's endpoint didn't bind, and it binds once per session, so no link will come up.
pub struct BindFailed;

/// A core refused a connection over its first message: this core's check, or the other core,
/// whose close names why.
pub struct ConnectionRefused {
    pub why: Mismatch,
}

/// What the two cores of a refused connection differ on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Mismatch {
    /// The session's code.
    Code,
    /// Dual Input's version, with the other core's when its first message named it, which a
    /// close doesn't.
    Version(Option<String>),
    /// The message crate's hash, which two builds of one version can differ on.
    Hash,
}

impl Moment for LinkUp {}
impl Moment for LinkLost {}
impl Moment for MemberLeft {}
impl Moment for MemberOut {}
impl Moment for EndpointBound {}
impl Moment for BindFailed {}
impl Moment for ConnectionRefused {}

/// Whom a send goes to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum To {
    /// Every member whose link is up.
    Crew,
    Member(PilotId),
}

/// This core in the session it opened.
#[derive(Clone, Debug)]
pub(crate) struct InSession {
    pub(crate) code: String,
    pub(crate) pilot: PilotId,
    pub(crate) restart: u32,
}

/// The network crate's state.
#[derive(Default)]
pub struct Network {
    channels: BTreeMap<u16, ChannelReg>,
    opener: Option<OpenerReg>,
    session: Option<InSession>,
    /// This core's endpoint ID, once bound.
    endpoint: Option<EndpointId>,
    links: BTreeMap<PilotId, Link>,
    conns: BTreeMap<u64, Conn>,
    /// Each sender's clock offset, by pilot ID and restart count.
    offsets: BTreeMap<(PilotId, u32), Offset>,
    heartbeat: Option<TimerId>,
    /// What each of the links' timers is for.
    timer_for: BTreeMap<TimerId, links::TimerFor>,
    /// The channels a bench scenario holds, each with the messages that came on it meanwhile,
    /// oldest first.
    held: BTreeMap<u16, Vec<(Sender, Vec<u8>)>>,
    backend: backend::Backend,
    reach: reach::Reach,
}

/// Holds every message that comes on the channel numbered `channel` for `ms`, then delivers
/// them in the order they came. Loss on a direct path can bring one channel's message after a
/// later one of another's, as traffic's states before their identities, which the bench's relay
/// never does, since it keeps every byte in order; the bench's network unit calls this so a
/// scenario can.
pub fn hold(cx: &Cx, channel: u16, ms: u64) {
    cx.call(Network::hold_for, (channel, ms));
}

impl Network {
    /// A sender's clock offset, its counter less this core's in µs, while its exchanges give
    /// one.
    pub fn offset(&self, sender: Sender) -> Option<i64> {
        self.offsets
            .get(&(sender.pilot, sender.restart))
            .and_then(Offset::estimate)
    }

    /// Whether a member's link is up.
    pub fn up(&self, pilot: &PilotId) -> bool {
        self.links.get(pilot).is_some_and(|l| l.conn.is_some())
    }

    /// Whether this PC reaches the internet, as the last check found, or `None` before the
    /// first.
    pub fn internet(&self) -> Option<bool> {
        self.reach.internet
    }

    /// Whether our servers answer, as the last check found, or `None` before the first.
    pub fn servers(&self) -> Option<messages::net::Servers> {
        self.reach.servers
    }

    fn slice(&self) -> NetSlice {
        NetSlice {
            members: self
                .links
                .iter()
                .map(|(pilot, link)| {
                    let conn = link.conn.and_then(|c| self.conns.get(&c));
                    MemberLink {
                        pilot: messages::hex(pilot),
                        up: link.conn.is_some(),
                        path: conn.and_then(|c| c.path.clone()),
                        round_trip_ms: conn.and_then(|c| c.round_trip_ms),
                    }
                })
                .collect(),
            internet: self.reach.internet,
            servers: self.reach.servers,
        }
    }
}

/// Registers the network crate.
pub fn register(r: &mut Registry) {
    let mut me = r.unit::<Network>("network");
    me.source::<Transport>(Network::event);
    me.on::<Started>(Network::started);
    me.setting(
        RELAYS,
        SettingDef {
            label: "The relays a session you host runs through",
            kind: SettingKind::Relays,
            default: json!(backend::default_relays()),
            part_only: false,
            development: true,
        },
    )
    .setting(
        RELAYS_ONLY,
        SettingDef {
            label: "Send everything through the relays, never straight to the other PCs",
            kind: SettingKind::Bool,
            default: json!(false),
            part_only: false,
            development: true,
        },
    )
    .setting(
        BACKEND,
        SettingDef {
            label: "The backend's address, the release's own when empty",
            kind: SettingKind::Text,
            default: json!(""),
            part_only: false,
            development: true,
        },
    )
    .client_state(SLICE, |me: &Network, _: &View| me.slice());
}

/// Opens the session: binds the endpoint with `key` and the session's relays, and dials each
/// crew member.
pub fn open(cx: &Cx, open: Open) {
    cx.call(Network::open_session, open);
}

/// What `open` needs: the session's code, this core's pilot and restart count, the endpoint
/// key Host or Join drew or the session file kept, the session's relays, and the crew to dial.
pub struct Open {
    pub code: String,
    pub me: Me,
    pub restart: u32,
    pub key: [u8; 32],
    pub relays: Vec<Relay>,
    pub crew: Vec<Member>,
}

/// Dials a member that another's entry names and this core holds no link to.
pub fn dial(cx: &Cx, member: Member) {
    cx.call(Network::dial_member, member);
}

/// Closes each connection with Leave's code, or the quit code, tells the backend, and shuts
/// the endpoint.
pub fn leave(cx: &Cx, quit: bool) {
    cx.call(Network::leave_session, quit);
}
/// Sends a message on a stream channel.
pub fn send<M: Serialize>(cx: &Cx, channel: Channel<M>, to: To, message: &M) {
    debug_assert_eq!(channel.delivery, Delivery::Stream);
    match postcard::to_stdvec(message) {
        Ok(bytes) => cx.call(
            Network::send_bytes,
            (
                channel.number,
                channel.priority,
                to,
                Outgoing::Stream(bytes),
            ),
        ),
        Err(error) => tracing::error!(%error, "a message for other cores didn't encode"),
    }
}

/// Sends a message on a one-off channel, which waits as the message says.
pub fn send_one_off<M: Serialize + OneOff>(cx: &Cx, channel: Channel<M>, to: To, message: &M) {
    debug_assert_ne!(channel.delivery, Delivery::Stream);
    match postcard::to_stdvec(message) {
        Ok(bytes) => cx.call(
            Network::send_bytes,
            (
                channel.number,
                channel.priority,
                to,
                Outgoing::OneOff(bytes, message.wait()),
            ),
        ),
        Err(error) => tracing::error!(%error, "a message for other cores didn't encode"),
    }
}

/// Sends a connection's first message: the header the network writes, then `keys`, on the
/// opener's channel. Only the opener calls it, with the connection `Opened` named.
pub fn first<M: Serialize>(cx: &Cx, opened: Opened, keys: &M) {
    match postcard::to_stdvec(keys) {
        Ok(bytes) => cx.call(Network::send_first, (opened.conn, bytes)),
        Err(error) => tracing::error!(%error, "a first message's keys didn't encode"),
    }
}

pub(crate) enum Outgoing {
    Stream(Vec<u8>),
    OneOff(Vec<u8>, Wait),
}

/// A frame on a stream: its length, then its bytes.
pub(crate) fn frame(bytes: &[u8]) -> Vec<u8> {
    let mut framed = Vec::with_capacity(bytes.len() + 4);
    framed.extend((bytes.len() as u32).to_le_bytes());
    framed.extend(bytes);
    framed
}

impl Network {
    fn open_session(me: &mut Network, open: Open, cx: &mut Cx) {
        tracing::info!(
            code = open.code,
            restart = open.restart,
            crew = open.crew.len(),
            "the network opens the session"
        );
        // A pilot may type a code in either case, and the backend reads it upper-cased, so every
        // first message carries it so too.
        me.session = Some(InSession {
            code: open.code.to_ascii_uppercase(),
            pilot: open.me.pilot,
            restart: open.restart,
        });
        // Host and Join drew the key a session opens with, and hold it with its public half
        // already, so only a session from the session file costs a curve multiplication here.
        if me.key() != Some(open.key) {
            me.backend.key = Some(ed25519_dalek::SigningKey::from_bytes(&open.key));
        }
        me.backend.me = Some(open.me);
        me.backend.relays = open.relays.clone();
        let relays_only = cx
            .read::<Clients>()
            .setting_as::<bool>(RELAYS_ONLY)
            .unwrap_or(false);
        cx.out(Command::Bind {
            key: open.key,
            relays: open.relays,
            ip: !relays_only,
        });
        // The heartbeat runs only while a session is open, so a core with none puts no input
        // a second into its recording.
        if me.heartbeat.is_none() {
            me.heartbeat = Some(cx.timer(links::HEARTBEAT_EVERY, Network::heartbeat_out));
        }
        me.backend.renew =
            Some(cx.timer(backend::RENEW_EVERY, |me: &mut Network, _, cx| me.renew(cx)));
        if !open.crew.is_empty() {
            me.start_check(cx);
        }
        for member in open.crew {
            me.add_link(member, cx);
        }
    }

    fn dial_member(me: &mut Network, member: Member, cx: &mut Cx) {
        if !me.links.contains_key(&member.pilot) {
            me.add_link(member, cx);
        }
    }

    fn leave_session(me: &mut Network, quit: bool, cx: &mut Cx) {
        let code = if quit {
            messages::net::codes::QUIT
        } else {
            messages::net::codes::LEAVE
        };
        tracing::info!(quit, "the network leaves the session");
        for &conn in me.conns.keys() {
            cx.out(Command::Close { conn, code });
        }
        me.conns.clear();
        for link in me.links.values_mut() {
            link.stop(cx, &mut me.timer_for);
        }
        me.links.clear();
        me.tell_leave(cx);
        me.forget(cx);
        me.session = None;
        me.endpoint = None;
        if let Some(heartbeat) = me.heartbeat.take() {
            cx.cancel_timer(heartbeat);
        }
        cx.out(Command::Shutdown);
    }
    fn send_bytes(
        me: &mut Network,
        (channel, priority, to, outgoing): (u16, u8, To, Outgoing),
        cx: &mut Cx,
    ) {
        let conns: Vec<u64> = me
            .links
            .iter()
            .filter(|(pilot, _)| matches!(to, To::Crew) || to == To::Member(**pilot))
            .filter_map(|(_, link)| link.conn)
            .collect();
        for conn in conns {
            let command = match &outgoing {
                Outgoing::Stream(bytes) => Command::Stream {
                    conn,
                    channel,
                    priority,
                    bytes: frame(bytes),
                },
                Outgoing::OneOff(bytes, wait) => Command::OneOff {
                    conn,
                    channel,
                    priority,
                    wait: *wait,
                    bytes: bytes.clone(),
                    stamp: channel == HEARTBEAT.number,
                },
            };
            cx.out(command);
        }
    }

    fn send_first(me: &mut Network, (conn, keys): (u64, Vec<u8>), cx: &mut Cx) {
        let (Some(my), Some(opener)) = (&me.session, &me.opener) else {
            return tracing::error!("a first message was sent with no session open or no opener");
        };
        let header = Header {
            version: messages::VERSION.into(),
            hash: messages::HASH.into(),
            code: my.code.clone(),
            pilot: my.pilot,
            restart: my.restart,
        };
        let Ok(mut bytes) = postcard::to_stdvec(&header) else {
            return tracing::error!("a first message's header didn't encode");
        };
        bytes.extend(keys);
        cx.out(Command::Stream {
            conn,
            channel: opener.channel,
            priority: u8::MAX,
            bytes: frame(&bytes),
        });
    }

    /// Once a second, a heartbeat on each connection whose link is up, carrying the last
    /// heartbeat this core received on it.
    fn heartbeat_out(me: &mut Network, _: TimerId, cx: &mut Cx) {
        for link in me.links.values() {
            let Some(conn) = link.conn else { continue };
            let echo = me.conns.get(&conn).map(|c| c.echo).unwrap_or_default();
            let Ok(bytes) = postcard::to_stdvec(&echo) else {
                continue;
            };
            cx.out(Command::OneOff {
                conn,
                channel: HEARTBEAT.number,
                priority: HEARTBEAT.priority,
                wait: Wait::Newest { key: 0 },
                bytes,
                stamp: true,
            });
        }
        me.heartbeat = Some(cx.timer(links::HEARTBEAT_EVERY, Network::heartbeat_out));
    }
}
