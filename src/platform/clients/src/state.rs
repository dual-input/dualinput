//! Client state: each round, the clients crate builds each slice some client shows, and
//! sends each client the slices whose value differs from the one it last sent that client
//! (record/areas/core/02-clients-and-panel-bridge.md, "What a unit registers and calls").

use std::collections::BTreeMap;

use kernel::{Cx, TimerId, View};
use messages::clients::{BANNER, NOTIFICATIONS, SETTINGS};
use serde_json::Value;

use crate::{Clients, ROUND};

/// Builds a slice as JSON text, written straight from the unit's value rather than through a
/// `Value` tree, which would allocate every field again in each round, 20 a second for every
/// slice a client shows.
type Build = Box<dyn Fn(&View) -> Result<String, serde_json::Error>>;

/// A slice a unit registered, with what builds it.
pub(crate) struct Slice {
    pub(crate) name: &'static str,
    pub(crate) build: Build,
}

impl Clients {
    pub(crate) fn round(me: &mut Clients, _: TimerId, cx: &mut Cx) {
        me.send_slices(None, cx);
        me.round = Some(cx.timer(ROUND, Clients::round));
    }

    /// Sends each client, or only `only`, the slices it shows whose value changed since it
    /// last got them. Each slice is built once, however many clients show it. A slice no unit
    /// registered, such as a deleted feature's, is never built, so its clients get nothing.
    pub(crate) fn send_slices(&mut self, only: Option<u64>, cx: &Cx) {
        let mut built: BTreeMap<String, Option<String>> = BTreeMap::new();
        let sockets: Vec<u64> = match only {
            Some(socket) => vec![socket],
            None => self.sockets.keys().copied().collect(),
        };
        for socket in sockets {
            let Some(watching) = self.sockets.get(&socket).map(|c| c.watching.clone()) else {
                continue;
            };
            for slice in watching {
                let text = built
                    .entry(slice.clone())
                    .or_insert_with(|| self.build(&slice, cx))
                    .clone();
                let Some(text) = text else { continue };
                let Some(client) = self.sockets.get_mut(&socket) else {
                    continue;
                };
                if client.sent.get(&slice) == Some(&text) {
                    continue;
                }
                client.sent.insert(slice.clone(), text.clone());
                let message = format!(
                    r#"{{"t":"state","slice":{},"value":{text}}}"#,
                    Value::String(slice)
                );
                self.send_text(socket, message, cx);
            }
        }
    }

    /// A slice's value as JSON text, or `None` for a slice no unit registered.
    fn build(&self, slice: &str, cx: &Cx) -> Option<String> {
        let text = match slice {
            NOTIFICATIONS => {
                serde_json::to_string(&self.notifications.values().collect::<Vec<_>>())
            }
            SETTINGS => serde_json::to_string(&self.settings.slice()),
            BANNER => serde_json::to_string(&self.banner_open()),
            _ => {
                let registered = self.slices.iter().find(|s| s.name == slice)?;
                (registered.build)(&cx.view())
            }
        };
        match text {
            Ok(text) => Some(text),
            Err(error) => {
                tracing::error!(slice, %error, "a slice didn't encode as JSON");
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use messages::clients::ToClient;

    /// `send_slices` writes a `state` message by hand, splicing in the slice's text rather
    /// than encoding it again, so this holds it to `ToClient::State`.
    #[test]
    fn a_state_message_built_by_hand_reads_as_toclient_state() {
        let text = format!(
            r#"{{"t":"state","slice":{},"value":{}}}"#,
            Value::String("a\"b".into()),
            r#"{"x":1}"#
        );
        let message: ToClient = serde_json::from_str(&text).expect("the message should read");
        assert_eq!(
            message,
            ToClient::State {
                slice: "a\"b".into(),
                value: serde_json::json!({"x": 1})
            }
        );
    }
}
