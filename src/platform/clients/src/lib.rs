//! The clients crate, the platform's crate for the core's clients: the sim's pages, a
//! cockpit panel's bridge among them, and the desktop app. It speaks the client protocol over
//! the WebSockets the core's edge holds, and gives every other unit three ways to reach the
//! clients: slices of state it sends on a timer to the clients that show them, commands the
//! clients send it, and `unit` messages to a client by name. It also keeps the notifications,
//! the pilot's settings, and which panel modules each cockpit panel loads
//! (record/areas/core/02-clients-and-panel-bridge.md), and what the apps alone need of it
//! (record/areas/interface/01-apps.md).
//!
//! Register it before every unit that uses it, since each registers its slices, commands,
//! and settings into the clients crate's state.

mod apps;
mod edge;
mod hooks;
mod panels;
mod settings;
mod sockets;
mod state;

pub use edge::{SocketOut, SocketUp, Sockets};
pub use hooks::{ClientsUnit, SettingDef};
pub use messages::clients::{Landing, Level};

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use kernel::{Cx, Handler, Moment, Registry, Started, TimerId};
use messages::clients::{Hello, Notification, ToClient};
use serde::Serialize;
use serde_json::Value;

use crate::settings::Settings;

/// How often each side sends something, at least: the core sends every client `alive` this
/// often whatever else it sends, and each client does the same (decision 010;
/// record/areas/core/02-clients-and-panel-bridge.md's note of 2026-10-22).
const ALIVE: Duration = Duration::from_secs(2);

/// A socket the core hasn't heard from in this long, in µs, is closed, since a page's socket
/// stays open after the page is gone (record/areas/architecture/01-spine.md, "The sim's pages").
const QUIET: u64 = 8_000_000;

/// How often the clients crate builds the slices some client shows, and sends each client
/// the ones that changed, while any client is connected. The timer bounds the work however
/// many inputs arrive, and needs no unit to mark what changed.
const ROUND: Duration = Duration::from_millis(50);

/// A message over this many bytes misses its budget, which the log says.
const MESSAGE_BUDGET: usize = 64 * 1024;

/// A client opened with its `hello`.
pub struct ClientJoined {
    pub socket: u64,
    pub component: String,
}

/// A client's socket closed, or the core closed it.
pub struct ClientLeft {
    pub socket: u64,
    pub component: String,
}

/// A cockpit panel's `hello` named the panel another socket held, so its new socket replaced
/// the old, which the core closed, as when a panel reloads.
pub struct PanelReplaced {
    pub old: u64,
    pub new: u64,
}

/// A setting changed by command.
pub struct SettingChanged {
    pub key: String,
}

impl Moment for ClientJoined {}
impl Moment for ClientLeft {}
impl Moment for PanelReplaced {}
impl Moment for SettingChanged {}

/// Who sent a `unit` message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sender {
    pub socket: u64,
    pub component: String,
}

/// Whom a `unit` message goes to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum To {
    /// Every client of a component, such as `menu-script`.
    Component(String),
    /// Every cockpit panel that loaded a panel module, by the module's name.
    PanelModule(String),
    /// One client, by its socket, as a feature reaches only the panels that serve a display.
    Socket(u64),
}

/// The clients crate's state.
#[derive(Default)]
pub struct Clients {
    /// The port the WebSocket server listens on, once it's bound.
    port: Option<u16>,
    sockets: BTreeMap<u64, Client>,
    slices: Vec<state::Slice>,
    commands: BTreeMap<&'static str, Handler<CommandCall>>,
    unit_messages: BTreeMap<&'static str, Handler<UnitCall>>,
    panel_modules: Vec<panels::PanelModuleRule>,
    notifications: BTreeMap<String, Notification>,
    settings: Settings,
    profile: panels::Profile,
    round: Option<TimerId>,
    /// When the 2s tick is due, in µs on the PC's performance counter.
    next_tick: u64,
}

struct Client {
    hello: Option<Hello>,
    /// The stamp of the last message from it.
    heard: u64,
    watching: BTreeSet<String>,
    /// Each slice's value as last sent to it, as JSON text.
    sent: BTreeMap<String, String>,
    /// For a cockpit panel, what it was answered once the profile loaded.
    answered: panels::Answered,
}

impl Client {
    fn component(&self) -> &str {
        self.hello.as_ref().map_or("", |h| h.component.as_str())
    }
}

/// A command a client sent, which the clients crate hands the unit that registered it.
pub(crate) struct CommandCall {
    socket: u64,
    id: u32,
    args: Value,
}

/// A `unit` message a client sent.
pub(crate) struct UnitCall {
    from: Sender,
    body: Value,
}

impl Clients {
    /// The port the core's WebSocket server listens on, once it's bound, which the sim
    /// service announces.
    pub fn port(&self) -> Option<u16> {
        self.port
    }

    /// A setting's value: what the pilot set, or its default.
    pub fn setting(&self, key: &str) -> Option<&Value> {
        self.settings.value(key)
    }

    /// A setting's value read into `T`, or `None` when no unit registered `key`.
    pub fn setting_as<T: serde::de::DeserializeOwned>(&self, key: &str) -> Option<T> {
        self.setting(key)
            .and_then(|v| serde_json::from_value(v.clone()).ok())
    }

    /// How many clients have sent their `hello`.
    pub fn joined(&self) -> usize {
        self.sockets.values().filter(|c| c.hello.is_some()).count()
    }

    /// The component `socket`'s client named in its `hello`, or nothing before it.
    pub(crate) fn component_of(&self, socket: u64) -> String {
        self.sockets
            .get(&socket)
            .map_or("", Client::component)
            .to_string()
    }

    /// The notification up under its full ID, the raising unit's name, `.`, and its own ID,
    /// as `network.refused`.
    pub fn notification_up(&self, id: &str) -> Option<&Notification> {
        self.notifications.get(id)
    }
}

/// The clients crate's unit name, which its own `unit` messages to the EFB app carry.
const UNIT: &str = "clients";

/// Registers the clients crate.
pub fn register(r: &mut Registry) {
    let mut me = r.unit::<Clients>(UNIT);
    me.on::<Started>(Clients::started)
        .start_file(settings::FILE, Clients::settings_file);
    me.source::<Sockets>(Clients::socket);
}

/// Puts out a `unit` message, once: a client that connects later never gets it.
pub fn send<B: Serialize>(cx: &Cx, to: To, unit: &str, body: &B) {
    match serde_json::to_value(body) {
        Ok(body) => cx.call(Clients::send_unit, (to, unit.to_string(), body)),
        Err(error) => tracing::error!(unit, %error, "a unit message didn't encode as JSON"),
    }
}

/// Raises a notification, or changes the one already raised under `id`, which is the running
/// unit's own: the notification's full ID is the unit's name, `.`, and `id`.
pub fn notify(cx: &Cx, id: &str, level: Level, text: &str, action: Option<&str>, landing: Landing) {
    let notification = Notification {
        id: notification_id(id),
        level,
        text: text.to_string(),
        action: action.map(str::to_string),
        landing,
    };
    cx.call(Clients::raise_notification, notification);
}

/// Clears the running unit's notification `id`, if it's raised.
pub fn clear_notification(cx: &Cx, id: &str) {
    cx.call(Clients::clear, notification_id(id));
}

fn notification_id(id: &str) -> String {
    format!("{}.{id}", kernel::running_unit().unwrap_or("core"))
}

/// The profile loader loaded a profile on the pilot's aircraft, so the clients crate answers
/// each cockpit panel with the panel modules its instruments get. Each panel module's rule
/// reads the loaded profile from the profile loader's state.
pub fn profile_loaded(cx: &Cx) {
    cx.call(Clients::loaded, ());
}

/// The profile unloaded, so every panel module stops.
pub fn profile_unloaded(cx: &Cx) {
    cx.call(Clients::unloaded, ());
}

/// Says `bye` to every client, which the session crate asks for as the core quits, so the
/// apps tell a quit from a crash.
pub fn bye(cx: &Cx) {
    cx.call(Clients::bye_all, ());
}

impl Clients {
    fn started(me: &mut Clients, _: &Started, cx: &mut Cx) {
        me.schedule_tick(cx);
    }

    /// Every 2s: `alive` to every client, and a close for each socket quiet for 8s.
    fn tick(me: &mut Clients, _: TimerId, cx: &mut Cx) {
        let now = cx.now();
        // A tick that fires 2s late means the core itself stopped, suspended or starved,
        // and heard nothing in that time while the pages went on sending; their messages
        // wait in the sockets and may come in after this tick. So each client's 8s count
        // starts again, and a page that kept its socket through the core's stop keeps it.
        let late = now.saturating_sub(me.next_tick);
        if me.next_tick != 0 && late > ALIVE.as_micros() as u64 {
            tracing::info!(
                late_ms = late / 1_000,
                "the core stopped for a while, so each client's 8s of quiet counts from now"
            );
            for client in me.sockets.values_mut() {
                client.heard = now;
            }
        }
        let quiet: Vec<u64> = me
            .sockets
            .iter()
            .filter(|(_, c)| now.saturating_sub(c.heard) >= QUIET)
            .map(|(&socket, _)| socket)
            .collect();
        for socket in quiet {
            tracing::info!(
                socket,
                component = me.sockets.get(&socket).map_or("", Client::component),
                "a client sent nothing for 8s, so the core closed its socket"
            );
            me.close(socket, 1000, cx);
        }
        let open: Vec<u64> = me.sockets.keys().copied().collect();
        for socket in open {
            me.to(socket, &ToClient::Alive, cx);
        }
        me.schedule_tick(cx);
    }

    fn schedule_tick(&mut self, cx: &Cx) {
        self.next_tick = cx.now() + ALIVE.as_micros() as u64;
        cx.timer(ALIVE, Clients::tick);
    }

    /// Sends one message to a socket.
    fn to(&self, socket: u64, message: &ToClient, cx: &Cx) {
        match serde_json::to_string(message) {
            Ok(text) => self.send_text(socket, text, cx),
            Err(error) => tracing::error!(%error, "a message to a client didn't encode as JSON"),
        }
    }

    fn send_text(&self, socket: u64, text: String, cx: &Cx) {
        if text.len() > MESSAGE_BUDGET {
            tracing::warn!(
                socket,
                bytes = text.len(),
                "a message to a client is over its 64 KiB budget"
            );
        }
        cx.out(SocketOut::Send { socket, text });
    }

    /// Closes a socket from the core's side, and forgets it at once, so the close the edge
    /// hands up later finds nothing.
    fn close(&mut self, socket: u64, code: u16, cx: &mut Cx) {
        cx.out(SocketOut::Close { socket, code });
        self.forget(socket, cx);
    }

    fn forget(&mut self, socket: u64, cx: &mut Cx) {
        let Some(client) = self.sockets.remove(&socket) else {
            return;
        };
        if let Some(hello) = client.hello {
            cx.raise(ClientLeft {
                socket,
                component: hello.component,
            });
        }
        if self.sockets.is_empty()
            && let Some(round) = self.round.take()
        {
            cx.cancel_timer(round);
        }
    }

    fn send_unit(me: &mut Clients, (to, unit, body): (To, String, Value), cx: &mut Cx) {
        let message = ToClient::Unit {
            unit: unit.clone(),
            body,
        };
        let Ok(text) = serde_json::to_string(&message) else {
            return;
        };
        for (&socket, client) in &me.sockets {
            let to_it = match &to {
                To::Component(component) => client.component() == component,
                To::PanelModule(module) => client.answered.loaded(module),
                To::Socket(to) => socket == *to,
            };
            if to_it {
                me.send_text(socket, text.clone(), cx);
            }
        }
    }

    fn raise_notification(me: &mut Clients, notification: Notification, _: &mut Cx) {
        if me.notifications.get(&notification.id) != Some(&notification) {
            tracing::info!(id = notification.id, level = ?notification.level, text = notification.text, "a notification was raised");
            me.notifications
                .insert(notification.id.clone(), notification);
        }
    }

    fn clear(me: &mut Clients, id: String, _: &mut Cx) {
        if me.notifications.remove(&id).is_some() {
            tracing::info!(id, "a notification was cleared");
        }
    }

    fn bye_all(me: &mut Clients, _: (), cx: &mut Cx) {
        for &socket in me.sockets.keys() {
            me.to(socket, &ToClient::Bye, cx);
        }
    }
}
