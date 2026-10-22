//! What the core's WebSocket server, at the core's edge in `apps/core`, and the clients crate
//! hand each other: a socket's open, its text, and its close up, as inputs, and what to send
//! and which socket to close down, as outputs
//! (record/areas/core/02-clients-and-panel-bridge.md, "The WebSocket server").

use serde::{Deserialize, Serialize};

/// Names the source the WebSocket server's inputs come up under, through
/// `Kernel::source::<Sockets>()`.
pub struct Sockets;

/// What the WebSocket server hands up, as one input's bytes. Each socket's ID comes from a
/// counter at the edge, inside the input, so a replay sees the same IDs. A socket whose
/// `Origin` the edge refused never comes up at all.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SocketUp {
    /// The server listens on this port on 127.0.0.1.
    Bound {
        port: u16,
    },
    Opened {
        socket: u64,
    },
    /// A text message, as it came in.
    Text {
        socket: u64,
        text: String,
    },
    /// The socket closed, from the client's side, by an error, or for a binary message.
    Closed {
        socket: u64,
    },
}

impl SocketUp {
    pub fn encode(&self) -> Vec<u8> {
        postcard::to_stdvec(self).expect("postcard should encode a socket's input")
    }

    /// The input `encode` made, or `None` for bytes it couldn't have made.
    pub fn decode(bytes: &[u8]) -> Option<SocketUp> {
        postcard::from_bytes(bytes).ok()
    }
}

/// What the clients crate asks of the WebSocket server.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum SocketOut {
    Send {
        socket: u64,
        text: String,
    },
    /// Closes the socket with this close code.
    Close {
        socket: u64,
        code: u16,
    },
}
