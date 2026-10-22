//! What a unit registers with the network crate: its channels, and for the session crate
//! alone, the opener that fills each connection's first message
//! (record/areas/network/02-units.md, "Channels and sends" and "The first message").

use kernel::{Cx, Handler, Unit};
use messages::net::{Channel, PilotId};
use serde::de::DeserializeOwned;

use crate::Network;

/// Who sent a message: a pilot, under the restart count their first message named.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Sender {
    pub pilot: PilotId,
    pub restart: u32,
}

/// A message's bytes as it reached the loop, before its channel's handler reads it.
pub(crate) struct Received {
    pub(crate) from: Sender,
    pub(crate) bytes: Vec<u8>,
}

/// A connection whose first message this core should send now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Opened {
    pub conn: u64,
}

pub(crate) struct ChannelReg {
    pub(crate) handler: Handler<Received>,
}

pub(crate) struct OpenerReg {
    pub(crate) channel: u16,
    pub(crate) handler: Handler<Opened>,
}

/// The network crate's hooks on a unit, as it registers.
pub trait NetUnit<S> {
    /// A channel, whose messages from other cores call `f` with their sender. The handler
    /// checks who may send it, since only units above the network can read control.
    fn channel<M: DeserializeOwned + 'static>(
        &mut self,
        channel: Channel<M>,
        f: fn(&mut S, Sender, M, &mut Cx),
    ) -> &mut Self;

    /// The session crate's opener: as each connection comes up, `f` sends every session key
    /// this core holds through `network::first`. Only one unit may register one, and its
    /// channel's handler gets the keys each connection's first message carries.
    fn opener<M: 'static>(
        &mut self,
        channel: Channel<M>,
        f: fn(&mut S, Opened, &mut Cx),
    ) -> &mut Self;
}

impl<S: 'static> NetUnit<S> for Unit<'_, S> {
    fn channel<M: DeserializeOwned + 'static>(
        &mut self,
        channel: Channel<M>,
        f: fn(&mut S, Sender, M, &mut Cx),
    ) -> &mut Self {
        let number = channel.number;
        let handler = self.handler(move |state: &mut S, received: Received, cx: &mut Cx| {
            match postcard::from_bytes::<M>(&received.bytes) {
                Ok(message) => f(state, received.from, message, cx),
                Err(error) => {
                    tracing::warn!(channel = number, %error, "a message from another core didn't read, so it was dropped")
                }
            }
        });
        let me = self.registry().state_mut::<Network>();
        assert!(
            me.channels.insert(number, ChannelReg { handler }).is_none(),
            "channel {number} should be registered once"
        );
        self
    }

    fn opener<M: 'static>(
        &mut self,
        channel: Channel<M>,
        f: fn(&mut S, Opened, &mut Cx),
    ) -> &mut Self {
        let handler =
            self.handler(move |state: &mut S, opened: Opened, cx: &mut Cx| f(state, opened, cx));
        let me = self.registry().state_mut::<Network>();
        assert!(me.opener.is_none(), "only one unit may register the opener");
        me.opener = Some(OpenerReg {
            channel: channel.number,
            handler,
        });
        self
    }
}
