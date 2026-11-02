//! Each socket's life, read on the loop: its open, each message it sends, and its close
//! (record/areas/core/02-clients-and-panel-bridge.md, "The protocol").

use std::collections::{BTreeMap, BTreeSet};

use kernel::{Cx, Input};
use messages::clients::{
    FromClient, Hello, NOTIFICATION_CLICKED, OPEN_DISCORD, SET_SETTING, ToClient, component,
};
use serde_json::Value;

use crate::panels::Answered;
use crate::{
    Client, ClientJoined, Clients, CommandCall, PanelReplaced, ROUND, Sender, SocketUp, UnitCall,
};

impl Clients {
    pub(crate) fn socket(me: &mut Clients, input: &Input, cx: &mut Cx) {
        let Some(up) = SocketUp::decode(&input.bytes) else {
            tracing::warn!(
                seq = input.seq,
                "an input from the WebSocket server didn't decode"
            );
            return;
        };
        match up {
            SocketUp::Bound { port } => {
                tracing::info!(port, "the core's WebSocket server listens on 127.0.0.1");
                me.port = Some(port);
            }
            SocketUp::Opened { socket } => {
                me.sockets.insert(
                    socket,
                    Client {
                        hello: None,
                        heard: cx.now(),
                        watching: BTreeSet::new(),
                        sent: BTreeMap::new(),
                        answered: Answered::No,
                    },
                );
                if me.round.is_none() {
                    me.round = Some(cx.timer(ROUND, Clients::round));
                }
            }
            SocketUp::Text { socket, text } => me.text(socket, &text, cx),
            SocketUp::Closed { socket } => {
                if let Some(client) = me.sockets.get(&socket) {
                    tracing::info!(
                        socket,
                        component = client.component(),
                        "a client's socket closed"
                    );
                }
                me.forget(socket, cx);
            }
        }
    }

    fn text(&mut self, socket: u64, text: &str, cx: &mut Cx) {
        let Some(client) = self.sockets.get_mut(&socket) else {
            return;
        };
        client.heard = cx.now();
        let joined = client.hello.is_some();
        let message: FromClient = match serde_json::from_str(text) {
            Ok(message) => message,
            Err(error) => {
                // A `hello` is read for its component, version, and hash before the rest of
                // it, so a client of another shape, likeliest from another version, still
                // joins and is named, and its versions are logged.
                if let Some(head) = hello_head(text) {
                    tracing::warn!(socket, component = head.component, %error, "a client's hello didn't read whole, so it joins on its component, version, and hash");
                    self.hello(socket, head, cx);
                } else {
                    tracing::warn!(socket, component = client.component(), %error, "a client's message didn't read, so it was dropped");
                }
                return;
            }
        };
        match message {
            FromClient::Hello(hello) => self.hello(socket, hello, cx),
            _ if !joined => tracing::warn!(
                socket,
                "a client sent a message before its hello, so it was dropped"
            ),
            FromClient::Alive => {}
            FromClient::Watch { slices } => self.watch(socket, slices, cx),
            FromClient::Command { id, name, args } => self.command(socket, id, &name, args, cx),
            FromClient::Unit { unit, body } => self.unit(socket, &unit, body, cx),
        }
    }

    fn hello(&mut self, socket: u64, hello: Hello, cx: &mut Cx) {
        if hello.version != messages::VERSION || hello.hash != messages::HASH {
            // The core goes on talking to it: every component of a release updates together,
            // so a mismatch most likely means a developer's stale package (user, 2026-10-15).
            tracing::warn!(
                socket,
                component = hello.component,
                client_version = hello.version,
                client_hash = hello.hash,
                core_version = messages::VERSION,
                core_hash = messages::HASH,
                "a client's version differs from the core's"
            );
        }
        tracing::info!(
            socket,
            component = hello.component,
            panel = hello.panel,
            instruments = hello.instruments.len(),
            "a client joined"
        );
        let panel = hello.component == component::PANEL_BRIDGE;
        if panel && let Some(name) = &hello.panel {
            // A page's socket stays open after the page reloads, so a panel's new socket
            // naming the panel another socket holds replaces it. Its name, not its
            // instruments' keys, tells, since two of the Black Square Baron's panels each hold
            // an instrument keyed `GNS_DISABLED` (record/areas/core/
            // 02-clients-and-panel-bridge.md's note of 2026-10-22).
            let old: Vec<u64> = self
                .sockets
                .iter()
                .filter(|&(&s, c)| {
                    s != socket
                        && c.hello
                            .as_ref()
                            .is_some_and(|h| h.panel.as_ref() == Some(name))
                })
                .map(|(&s, _)| s)
                .collect();
            for old in old {
                tracing::info!(
                    old,
                    new = socket,
                    "a cockpit panel's new socket replaced its old one"
                );
                self.close(old, 1000, cx);
                cx.raise(PanelReplaced { old, new: socket });
            }
        }
        let component = hello.component.clone();
        if let Some(client) = self.sockets.get_mut(&socket) {
            client.hello = Some(hello);
        }
        cx.raise(ClientJoined { socket, component });
        if panel {
            self.panel_joined(socket, cx);
        }
    }

    fn watch(&mut self, socket: u64, slices: Vec<String>, cx: &mut Cx) {
        let Some(client) = self.sockets.get_mut(&socket) else {
            return;
        };
        client.watching = slices.into_iter().collect();
        client
            .sent
            .retain(|slice, _| client.watching.contains(slice));
        // A client that starts showing a slice gets it at once.
        self.send_slices(Some(socket), cx);
    }

    fn command(&mut self, socket: u64, id: u32, name: &str, args: Value, cx: &mut Cx) {
        let result = match name {
            SET_SETTING => self.set_setting(args, cx),
            NOTIFICATION_CLICKED => self.notification_clicked(socket, args, cx),
            OPEN_DISCORD => self.open_discord(cx),
            _ => {
                if let Some(handler) = self.commands.get(name) {
                    cx.call_handler(handler, CommandCall { socket, id, args });
                    return;
                }
                tracing::info!(
                    socket,
                    command = name,
                    "a client sent a command no unit registered"
                );
                Err("unknown".into())
            }
        };
        self.answer(socket, id, result, cx);
    }

    fn unit(&mut self, socket: u64, unit: &str, body: Value, cx: &mut Cx) {
        let Some(handler) = self.unit_messages.get(unit) else {
            tracing::warn!(
                socket,
                unit,
                "a client sent a unit message to a unit that takes none, so it was dropped"
            );
            return;
        };
        let component = self.component_of(socket);
        cx.call_handler(
            handler,
            UnitCall {
                from: Sender { socket, component },
                body,
            },
        );
    }

    /// A command's handler returned, and its client hears whether the command was taken.
    pub(crate) fn answered(
        me: &mut Clients,
        (socket, id, result): (u64, u32, Result<(), String>),
        cx: &mut Cx,
    ) {
        me.answer(socket, id, result, cx);
    }

    fn answer(&self, socket: u64, id: u32, result: Result<(), String>, cx: &Cx) {
        if self.sockets.contains_key(&socket) {
            self.to(
                socket,
                &ToClient::Answer {
                    id,
                    error: result.err(),
                },
                cx,
            );
        }
    }
}

/// A `hello`'s component, version, and hash, read from its text alone, with no panel and no
/// instruments, for a `hello` whose other fields don't read.
fn hello_head(text: &str) -> Option<Hello> {
    let value: Value = serde_json::from_str(text).ok()?;
    if value.get("t")?.as_str()? != "hello" {
        return None;
    }
    let field = |name: &str| value.get(name)?.as_str().map(str::to_string);
    Some(Hello {
        component: field("component")?,
        version: field("version")?,
        hash: field("hash")?,
        panel: None,
        instruments: Vec::new(),
    })
}
