//! The session-shaped packets both ends send, and the control datagrams the stations answer.
//!
//! A session packet starts with a 20-byte header and is padded to its stream's size, so the
//! receiver logs its number and the sender's stamp without either side keeping state:
//!
//! ```text
//! 0..2   magic 0xC5 0x02
//! 2      stream: 1 flight model, 2 cockpit, 3 audio
//! 3      reserved
//! 4..8   tag, the traffic run both ends log it under
//! 8..12  sequence number within the stream
//! 12..20 the sender's monotonic µs at send
//! ```

use bytes::{BufMut, Bytes, BytesMut};
use serde::{Deserialize, Serialize};

pub const HEADER: usize = 20;
pub const MAGIC: [u8; 2] = [0xC5, 0x02];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Stream {
    Flight = 1,
    Cockpit = 2,
    Audio = 3,
}

impl Stream {
    pub fn from_u8(v: u8) -> Option<Stream> {
        match v {
            1 => Some(Stream::Flight),
            2 => Some(Stream::Cockpit),
            3 => Some(Stream::Audio),
            _ => None,
        }
    }

    /// Payload bytes and packets a second, from 2.3: a flight-model sample of about 150 bytes
    /// 20 times a second, a cockpit message of about 100 bytes 5 times a second, and an Opus
    /// frame's 60 bytes at 24 kbps, 50 times a second.
    pub fn shape(self) -> (usize, u32) {
        match self {
            Stream::Flight => (150, 20),
            Stream::Cockpit => (100, 5),
            Stream::Audio => (60, 50),
        }
    }
}

pub fn packet(stream: Stream, tag: u32, seq: u32, sent_us: u64) -> Bytes {
    let (size, _) = stream.shape();
    let mut b = BytesMut::with_capacity(size);
    b.put_slice(&MAGIC);
    b.put_u8(stream as u8);
    b.put_u8(0);
    b.put_u32(tag);
    b.put_u32(seq);
    b.put_u64(sent_us);
    b.resize(size, 0x5a);
    b.freeze()
}

pub struct Header {
    pub stream: u8,
    pub tag: u32,
    pub seq: u32,
    pub sent_us: u64,
}

pub fn parse(b: &[u8]) -> Option<Header> {
    if b.len() < HEADER || b[0..2] != MAGIC {
        return None;
    }
    Some(Header {
        stream: b[2],
        tag: u32::from_be_bytes(b[4..8].try_into().ok()?),
        seq: u32::from_be_bytes(b[8..12].try_into().ok()?),
        sent_us: u64::from_be_bytes(b[12..20].try_into().ok()?),
    })
}

/// Control datagrams on a station's port 3479 are `P02` followed by one JSON object.
pub const CTL_PREFIX: &[u8; 3] = b"P02";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Ctl {
    /// A clock exchange: `t1` is the asker's monotonic µs at send.
    ClockReq { nonce: u64, t1: u64 },
    /// `rx_ns` and `tx_ns` are the station's system clock at receive and at reply.
    ClockResp { nonce: u64, t1: u64, rx_ns: i64, tx_ns: i64 },
    /// Asks for one reply from this port and one from the station's other port, to tell a
    /// router that filters by sender port from one that doesn't.
    FilterReq { nonce: u64 },
    FilterResp { nonce: u64, from_alt: bool, seen: String },
    /// Asks the station to stay silent for `gap_ms`, then send once to the address it saw.
    HoldReq { nonce: u64, gap_ms: u64 },
    HoldAck { nonce: u64, seen: String },
    HoldWake { nonce: u64, seen: String },
    /// Sent after a hold, to learn whether the router kept the same public port.
    AfterReq { nonce: u64 },
    AfterResp { nonce: u64, seen: String, before: Option<String> },
    /// What a station sends when another one, through its API, asks it to reach an address
    /// that never sent to it.
    Unsolicited { nonce: u64, from: String },
    EchoReq { nonce: u64 },
    EchoResp { nonce: u64, seen: String },
}

pub fn ctl_encode(c: &Ctl) -> Vec<u8> {
    let mut v = CTL_PREFIX.to_vec();
    v.extend_from_slice(&serde_json::to_vec(c).unwrap());
    v
}

pub fn ctl_decode(b: &[u8]) -> Option<Ctl> {
    if b.len() < 4 || &b[0..3] != CTL_PREFIX {
        return None;
    }
    serde_json::from_slice(&b[3..]).ok()
}

/// What the UDP forwarder takes from a peer as its address for a session: `P02REG` and the
/// session's token. It forwards nothing to a peer until one arrives.
pub const REG_PREFIX: &[u8; 6] = b"P02REG";
