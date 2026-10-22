//! The network crate, the platform's crate for everything between machines: each member's
//! link and its connection, the channels, the heartbeat and clock offsets, and the first
//! message's checks. It makes every decision on the loop, each link's state and timers, every
//! dial and close, and which of two connections stays, so a replay reproduces each one, and
//! asks the transport, at the core's edge, to carry them out
//! (record/areas/network/02-units.md, "The network crate").
//!
//! Register it after the clients crate and before every unit that registers a channel.

mod clock;
mod edge;
mod hooks;
mod links;

pub use edge::{Transport, encode as encode_event};
pub use hooks::{NetUnit, Opened, Sender};

use std::collections::BTreeMap;

use kernel::{Cx, Moment, Registry, Started, TimerId};
use messages::net::{
    Channel, Command, Delivery, EndpointId, HEARTBEAT, Header, Heartbeat, PilotId, Relay, Wait,
};
use serde::Serialize;

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

impl Moment for LinkUp {}
impl Moment for LinkLost {}
impl Moment for MemberLeft {}
impl Moment for MemberOut {}

/// Whom a send goes to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum To {
    /// Every member whose link is up.
    Crew,
    Member(PilotId),
}

/// What a one-off packet's message says about how it waits for room in QUIC's queue: the
/// key whose newest packet alone waits, or its deadline.
pub trait OneOff {
    fn wait(&self) -> Wait;
}

impl OneOff for Heartbeat {
    fn wait(&self) -> Wait {
        Wait::Newest { key: 0 }
    }
}

/// This core in the session it opened.
#[derive(Clone, Debug)]
pub(crate) struct Me {
    pub(crate) code: String,
    pub(crate) pilot: PilotId,
    pub(crate) restart: u32,
}

/// The network crate's state.
#[derive(Default)]
pub struct Network {
    channels: BTreeMap<u16, ChannelReg>,
    opener: Option<OpenerReg>,
    me: Option<Me>,
    /// This core's endpoint ID, once bound.
    endpoint: Option<EndpointId>,
    links: BTreeMap<PilotId, Link>,
    conns: BTreeMap<u64, Conn>,
    /// Each sender's clock offset, by pilot ID and restart count.
    offsets: BTreeMap<(PilotId, u32), Offset>,
    heartbeat: Option<TimerId>,
    /// What each of the links' timers is for.
    timer_for: BTreeMap<TimerId, links::TimerFor>,
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
}

/// Registers the network crate.
pub fn register(r: &mut Registry) {
    let mut me = r.unit::<Network>("network");
    me.source::<Transport>(Network::event);
    me.on::<Started>(Network::started);
}

/// Opens the session: binds the endpoint with `key` and the session's relays, and dials each
/// crew member. `ip` off clears the endpoint's IP transports, so two cores on one PC reach
/// each other through a relay.
pub fn open(cx: &Cx, open: Open) {
    cx.call(Network::open_session, open);
}

/// What `open` needs.
pub struct Open {
    pub code: String,
    pub pilot: PilotId,
    pub restart: u32,
    pub key: [u8; 32],
    pub relays: Vec<Relay>,
    pub crew: Vec<Member>,
    pub ip: bool,
}

/// Dials a member that another's entry names and this core holds no link to.
pub fn dial(cx: &Cx, member: Member) {
    cx.call(Network::dial_member, member);
}

/// Closes each connection with Leave's code, or the quit code, and shuts the endpoint.
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
    fn started(me: &mut Network, _: &Started, cx: &mut Cx) {
        me.heartbeat = Some(cx.timer(links::HEARTBEAT_EVERY, Network::heartbeat_out));
    }

    fn open_session(me: &mut Network, open: Open, cx: &mut Cx) {
        tracing::info!(
            code = open.code,
            restart = open.restart,
            crew = open.crew.len(),
            "the network opens the session"
        );
        me.me = Some(Me {
            code: open.code,
            pilot: open.pilot,
            restart: open.restart,
        });
        cx.out(Command::Bind {
            key: open.key,
            relays: open.relays,
            ip: open.ip,
        });
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
            link.stop(cx);
        }
        me.links.clear();
        me.me = None;
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
        let (Some(my), Some(opener)) = (&me.me, &me.opener) else {
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
