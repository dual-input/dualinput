//! Cockpit panels and their modules: once the profile has loaded and a panel's `hello` has
//! arrived, the clients crate answers the panel with `load` and the panel modules its
//! instruments get, or with `none`, and a profile that unloads sends `stop`
//! (record/areas/core/02-clients-and-panel-bridge.md, "Cockpit panels and their modules").

use std::time::Duration;

use kernel::{Cx, TimerId, View};
use messages::clients::{Level, Notification, PanelModule, ToClient, component};

use crate::Clients;

/// A profile loaded with no cockpit panel's `hello` in this long means our panel bridge
/// didn't load, which stops every panel module, so the clients crate raises trouble
/// (record/areas/interface/01-apps.md, "Trouble").
const NO_PANEL: Duration = Duration::from_secs(10);

/// The clients crate's own notification for it, under its unit's name.
const NO_PANEL_NOTIFICATION: &str = "clients.no-panel";

pub(crate) struct PanelModuleRule {
    pub(crate) name: &'static str,
    pub(crate) rule: fn(&View, &[String]) -> Vec<String>,
}

#[derive(Default)]
pub(crate) struct Profile {
    loaded: bool,
    no_panel: Option<TimerId>,
}

/// What a cockpit panel was answered once the profile loaded.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) enum Answered {
    #[default]
    No,
    Load(Vec<String>),
    None,
}

impl Answered {
    pub(crate) fn loaded(&self, module: &str) -> bool {
        matches!(self, Answered::Load(modules) if modules.iter().any(|m| m == module))
    }
}

impl Clients {
    /// A cockpit panel's `hello` arrived.
    pub(crate) fn panel_joined(&mut self, socket: u64, cx: &mut Cx) {
        if !self.profile.loaded {
            return;
        }
        if let Some(timer) = self.profile.no_panel.take() {
            cx.cancel_timer(timer);
        }
        self.clear_no_panel();
        self.answer_panel(socket, cx);
    }

    pub(crate) fn loaded(me: &mut Clients, _: (), cx: &mut Cx) {
        me.profile.loaded = true;
        let panels = me.panels();
        tracing::info!(
            panels = panels.len(),
            "the profile loaded, so the clients crate answers each cockpit panel"
        );
        if panels.is_empty() {
            me.profile.no_panel = Some(cx.timer(NO_PANEL, Clients::no_panel));
        }
        for socket in panels {
            me.answer_panel(socket, cx);
        }
    }

    pub(crate) fn unloaded(me: &mut Clients, _: (), cx: &mut Cx) {
        me.profile.loaded = false;
        if let Some(timer) = me.profile.no_panel.take() {
            cx.cancel_timer(timer);
        }
        me.clear_no_panel();
        for socket in me.panels() {
            let Some(client) = me.sockets.get_mut(&socket) else {
                continue;
            };
            if let Answered::Load(modules) = std::mem::take(&mut client.answered) {
                me.to(socket, &ToClient::Stop { modules }, cx);
            }
        }
    }

    fn no_panel(me: &mut Clients, _: TimerId, _: &mut Cx) {
        me.profile.no_panel = None;
        if !me.profile.loaded || !me.panels().is_empty() {
            return;
        }
        tracing::warn!(
            "no cockpit panel said hello within 10s of the profile loading, so our panel bridge didn't load"
        );
        me.notifications.insert(
            NO_PANEL_NOTIFICATION.into(),
            Notification {
                id: NO_PANEL_NOTIFICATION.into(),
                level: Level::Trouble,
                text: "Dual Input's panel bridge didn't load in the cockpit, so features that run in its panels are off. Another package's VCockpit.js is the likeliest cause.".into(),
                action: None,
            },
        );
    }

    fn clear_no_panel(&mut self) {
        if self.notifications.remove(NO_PANEL_NOTIFICATION).is_some() {
            tracing::info!(
                "a cockpit panel connected, so the panel bridge's trouble notification cleared"
            );
        }
    }

    /// Every cockpit panel that has said hello.
    fn panels(&self) -> Vec<u64> {
        self.sockets
            .iter()
            .filter(|(_, c)| c.component() == component::PANEL_BRIDGE)
            .map(|(&s, _)| s)
            .collect()
    }

    /// Answers a panel with the panel modules whose rules pick any of its instruments, or
    /// with `none`, after which it closes its socket.
    fn answer_panel(&mut self, socket: u64, cx: &Cx) {
        let Some(client) = self.sockets.get(&socket) else {
            return;
        };
        let instruments = client
            .hello
            .as_ref()
            .map(|h| h.instruments.clone())
            .unwrap_or_default();
        let view = cx.view();
        let modules: Vec<PanelModule> = self
            .panel_modules
            .iter()
            .filter_map(|m| {
                let picked = (m.rule)(&view, &instruments);
                (!picked.is_empty()).then(|| PanelModule {
                    name: m.name.into(),
                    instruments: picked,
                })
            })
            .collect();
        let (answered, message) = if modules.is_empty() {
            (Answered::None, ToClient::None)
        } else {
            (
                Answered::Load(modules.iter().map(|m| m.name.clone()).collect()),
                ToClient::Load { modules },
            )
        };
        tracing::debug!(socket, ?answered, "a cockpit panel was answered");
        self.to(socket, &message, cx);
        if let Some(client) = self.sockets.get_mut(&socket) {
            client.answered = answered;
        }
    }
}
