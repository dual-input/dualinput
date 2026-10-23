//! What the network crate and the transport hand each other, and what every channel between
//! two cores shares: the kinds of delivery, the first message's header, and the transport's
//! commands and events (record/areas/network/02-units.md, "The units").
//!
//! The transport's commands and events live here, not in the transport, because the network
//! crate keeps the loop's rules and the transport does I/O, so the network crate can't depend
//! on it, as the sim's calls live in the sim client rather than the sim edge.
//!
//! A channel's own constant lives in its owner's module of this crate, beside its message
//! type, so both sides read its number, delivery, and priority from the crate whose hash
//! their first messages compare (record/areas/network/01-between-machines.md, "Joining").

use std::marker::PhantomData;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// How a channel's messages travel.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Delivery {
    /// Every message in order and resent, on a QUIC stream of the sender's that opens with
    /// the channel's number.
    Stream,
    /// One-off packets, of which only the newest for each key waits to go, the key named by
    /// the message, such as a pose's figure.
    Newest,
    /// One-off packets in a short queue, each dropped once its deadline passes, the deadline
    /// named by the message, such as an ATC frame's turn to play.
    Deadline,
}

/// A channel between cores: its number, its delivery, its priority, and the type of its
/// messages. Priority orders streams among streams and one-off packets among one-off
/// packets, higher first.
pub struct Channel<M> {
    pub number: u16,
    pub delivery: Delivery,
    pub priority: u8,
    message: PhantomData<fn() -> M>,
}

impl<M> Channel<M> {
    pub const fn new(number: u16, delivery: Delivery, priority: u8) -> Channel<M> {
        Channel {
            number,
            delivery,
            priority,
            message: PhantomData,
        }
    }
}

impl<M> Clone for Channel<M> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<M> Copy for Channel<M> {}

/// The network's own channel: each core's heartbeat, once a second on each connection, which
/// guarantees the other side hears something at least that often, and carries a clock
/// exchange (record/areas/network/02-units.md, "The heartbeat and clock offsets"). The first
/// message's session channel, the session crate's, is a stream.
pub const HEARTBEAT: Channel<Heartbeat> = Channel::new(1, Delivery::Newest, u8::MAX);

/// A heartbeat: the last heartbeat this core received on the connection, as that packet's
/// send stamp and the stamp of the input it arrived in, both 0 before one has. The transport
/// adds this packet's own send stamp after it, 8 bytes of µs on the PC's counter.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Heartbeat {
    pub echo_sent: u64,
    pub echo_received: u64,
}

/// A pilot, by the ID their core drew for them, which every core keys what it keeps about
/// a sender by, with the restart count, never a connection or an endpoint.
pub type PilotId = [u8; 16];

/// An iroh endpoint's ID, the public half of its key.
pub type EndpointId = [u8; 32];

/// The head of each connection's first message, on the session channel's stream: Dual
/// Input's version and the message crate's hash, which stay first in every release, then the
/// session's code and the sender's pilot ID and restart count.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Header {
    pub version: String,
    pub hash: String,
    pub code: String,
    pub pilot: PilotId,
    pub restart: u32,
}

/// A relay as a session's list names it. The backend keeps each session's list, so the
/// Worker reads it too.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "net/")]
pub struct Relay {
    pub url: String,
    pub token: String,
    /// What the core keeps everything it sends through this relay below, in bytes a second.
    pub cap: u32,
}

/// What the network crate asks of the transport.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Command {
    /// Builds the endpoint with this key and relay list, with its IP transports cleared
    /// when `ip` is false, and binds it under a timeout.
    Bind {
        key: [u8; 32],
        relays: Vec<Relay>,
        ip: bool,
    },
    /// Dials an endpoint through every relay in the list, dropping any dial to it still
    /// running.
    Dial {
        endpoint: EndpointId,
    },
    Close {
        conn: u64,
        code: u32,
    },
    /// Writes to the channel's stream on the connection, opening it with the channel's
    /// number and priority on first use.
    Stream {
        conn: u64,
        channel: u16,
        priority: u8,
        bytes: Vec<u8>,
    },
    /// A one-off packet, which waits in its slot or its channel's queue for room in QUIC's,
    /// with the send stamp added as it goes when `stamp` is set.
    OneOff {
        conn: u64,
        channel: u16,
        priority: u8,
        wait: Wait,
        bytes: Vec<u8>,
        stamp: bool,
    },
    Shutdown,
}

/// The bytes a one-off message may take: a one-off packet's 1,162 at QUIC's starting packet size,
/// less the 2 the transport puts the channel's number in, and a stamped channel's message takes
/// 8 fewer again. A traffic batch sizes itself from this. `PACKET` in src/engines/transport/src/lib.rs
/// holds the 1,162, so change both together.
pub const ONE_OFF_ROOM: usize = 1_162 - 2;

/// What a one-off channel's message names about how it waits for room in QUIC's queue: the
/// key whose newest packet alone waits, such as a pose's figure, or its deadline, such as an
/// ATC frame's turn to play. The network reads it on the loop. It lives here, beside every
/// message type, so each type implements it in its own module of this crate.
pub trait OneOff {
    fn wait(&self) -> Wait;
}

impl OneOff for Heartbeat {
    fn wait(&self) -> Wait {
        Wait::Newest { key: 0 }
    }
}

/// How a one-off packet waits for room in QUIC's queue.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Wait {
    /// Only the newest packet for each connection, channel, and key waits.
    Newest { key: u64 },
    /// The packet waits in its channel's queue until this time, in µs on the PC's counter.
    Deadline { at: u64 },
}

/// What the transport hands up, each an input of the network crate's. Connection numbers
/// come from a counter in the transport, so a replay sees the same numbers, and a higher
/// number is the newer connection.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Event {
    Bound(Result<EndpointId, String>),
    Connected {
        conn: u64,
        endpoint: EndpointId,
        dialed: bool,
    },
    Stream {
        conn: u64,
        channel: u16,
        bytes: Vec<u8>,
    },
    /// A one-off packet's bytes; a heartbeat's carry the send stamp the transport added.
    OneOff {
        conn: u64,
        channel: u16,
        bytes: Vec<u8>,
    },
    /// The connection closed, with its application code, or the error that closed it.
    Closed {
        conn: u64,
        code: Result<u32, String>,
    },
    Path {
        conn: u64,
        path: Path,
    },
    /// Once a second for each connection.
    Stats {
        conn: u64,
        sent: u64,
        lost: u64,
        rtt_us: u64,
        cwnd: u64,
    },
}

/// The path a connection runs on: straight between the two PCs, or through a relay.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "net/")]
pub enum Path {
    Direct,
    Relay { url: String },
}

/// The network's slice of client state, which the apps show the pilot.
pub const SLICE: &str = "network";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "net/")]
pub struct NetSlice {
    pub members: Vec<MemberLink>,
    /// Whether this PC reaches the internet, as the last check made while a link was lost
    /// found, or `None` before the first.
    pub internet: Option<bool>,
}

/// One member's link, by the member's pilot ID as 32 hex digits.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "net/")]
pub struct MemberLink {
    pub pilot: String,
    pub up: bool,
    /// The path of the link's connection, while it has one whose path is known.
    pub path: Option<Path>,
}

/// The application codes a core closes a connection with, so the other side tells a leave
/// from an outage, and a refusal's reason (record/areas/network/01-between-machines.md,
/// "Leaving"). Code 0, which QUIC sends when every handle to a connection drops, is none of
/// these, and counts as a lost link.
pub mod codes {
    /// Leave session.
    pub const LEAVE: u32 = 1;
    /// Dual Input closing any other way, which the others treat as a leave.
    pub const QUIT: u32 = 2;
    /// Nothing for 5s, so the link is lost and the core redials.
    pub const LOST: u32 = 3;
    /// The other of two connections stays.
    pub const OTHER_STAYS: u32 = 5;
    /// A first message with a higher restart count.
    pub const RESTARTED: u32 = 6;
    pub const WRONG_CODE: u32 = 10;
    pub const WRONG_VERSION: u32 = 11;
    pub const WRONG_HASH: u32 = 12;
}
