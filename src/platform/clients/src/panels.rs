//! Cockpit panels and their modules: once the profile has loaded and a panel's `hello` has
//! arrived, the clients crate answers the panel with `load` and the panel modules its
//! instruments get, or with `none`, and a profile that unloads, or a module's rule that
//! changes, answers each panel running a module again
//! (record/areas/core/02-clients-and-panel-bridge.md, "Cockpit panels and their modules", with
//! the doc's notes on it).

use std::time::Duration;

use kernel::{Cx, TimerId, View};
use messages::clients::{Landing, Level, Notification, PanelModule, ToClient, component};

use crate::Clients;

/// A profile with a panel module that needs a panel, loaded with no cockpit panel's `hello` in
/// this long, means our panel bridge didn't load, which stops every panel module, so the
/// clients crate raises trouble. Any other profile waits for no panel, since an aircraft can
/// have no cockpit panels, as a balloon has none (record/areas/interface/01-apps.md, "Trouble").
const NO_PANEL: Duration = Duration::from_secs(10);

/// The clients crate's own notification for it, under its unit's name.
const NO_PANEL_NOTIFICATION: &str = "clients.no-panel";

pub(crate) struct PanelModuleRule {
    pub(crate) name: &'static str,
    pub(crate) rule: fn(&View, &[String]) -> Vec<String>,
    pub(crate) needed: fn(&View) -> bool,
    /// Whether it goes to one panel at a time, which `ClientsUnit::one_panel_module` says.
    pub(crate) one_panel: bool,
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

    /// The profile loaded. Answering the panels here would tell every waiting panel `none`: a
    /// module's rule asks what features watch through sim variables, and a feature's watch
    /// reaches sim variables in a call it queues as it handles `ProfileLoaded`, which runs after
    /// this one. So the answers, and the check for a panel that never comes, go in a call of
    /// their own, queued behind those (record/areas/profiles/04-the-extension-in-the-sim.md,
    /// "Reaching the sim by name").
    pub(crate) fn loaded(me: &mut Clients, _: (), cx: &mut Cx) {
        me.profile.loaded = true;
        cx.call(Clients::answer_loaded, ());
    }

    fn answer_loaded(me: &mut Clients, _: (), cx: &mut Cx) {
        if !me.profile.loaded {
            return;
        }
        let panels = me.panels();
        tracing::info!(
            panels = panels.len(),
            "the profile loaded, so the clients crate answers each cockpit panel"
        );
        if panels.is_empty() && me.panel_modules.iter().any(|m| (m.needed)(&cx.view())) {
            me.profile.no_panel = Some(cx.timer(NO_PANEL, Clients::no_panel));
        }
        for socket in panels {
            me.answer_panel(socket, cx);
        }
    }

    /// The profile unloaded. Each panel running a module is answered again, once every unit
    /// has handled `ProfileUnloaded`, as at the load, so a module whose rule reads no profile,
    /// as the profile extension's `outline` doesn't, carries on through a test session's reload,
    /// and the rest stop.
    pub(crate) fn unloaded(me: &mut Clients, _: (), cx: &mut Cx) {
        me.profile.loaded = false;
        if let Some(timer) = me.profile.no_panel.take() {
            cx.cancel_timer(timer);
        }
        me.clear_no_panel();
        cx.call(Clients::answer_again, ());
    }

    /// Answers each panel running a module again, as a rule changed or the profile unloaded.
    pub(crate) fn answer_again(me: &mut Clients, _: (), cx: &mut Cx) {
        let running: Vec<u64> = me
            .panels()
            .into_iter()
            .filter(|s| {
                me.sockets
                    .get(s)
                    .is_some_and(|c| matches!(c.answered, Answered::Load(_)))
            })
            .collect();
        for socket in running {
            me.answer_panel(socket, cx);
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
                ..Notification::new(Level::Trouble, "Cockpit screens aren't syncing", Landing::Header)
                    .detail("Dual Input couldn't load into the cockpit's panels. Another add-on that replaces VCockpit.js is the likeliest cause.")
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

    /// Answers a panel with the panel modules whose rules pick any of its instruments, less a
    /// one-panel module another open socket holds, or with `none`, after which it closes its
    /// socket. `Clients::hello` closes a reloaded panel's old socket before it calls
    /// `panel_joined`, so a one-panel module follows its panel through a reload.
    ///
    /// A panel already running modules hears only the change: `load` for the modules it gains,
    /// then `stop` for those it loses, in that order, since a bridge left with no module closes
    /// its socket. One left with none closes it so, and joins again at the next announcement,
    /// when it's answered afresh. A module a panel keeps keeps the instruments it started
    /// with, since the bridge carries on a module it runs.
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
            .filter(|m| !m.one_panel || !self.held_elsewhere(m.name, socket))
            .filter_map(|m| {
                let picked = (m.rule)(&view, &instruments);
                (!picked.is_empty()).then(|| PanelModule {
                    name: m.name.into(),
                    instruments: picked,
                })
            })
            .collect();
        let names: Vec<String> = modules.iter().map(|m| m.name.clone()).collect();
        let answered = match &client.answered {
            Answered::Load(before) => {
                let before = before.clone();
                let gained: Vec<PanelModule> = modules
                    .into_iter()
                    .filter(|m| !before.contains(&m.name))
                    .collect();
                let lost: Vec<String> = before.into_iter().filter(|n| !names.contains(n)).collect();
                if !gained.is_empty() {
                    self.to(socket, &ToClient::Load { modules: gained }, cx);
                }
                if !lost.is_empty() {
                    self.to(socket, &ToClient::Stop { modules: lost }, cx);
                }
                if names.is_empty() {
                    Answered::No
                } else {
                    Answered::Load(names)
                }
            }
            _ if modules.is_empty() => {
                self.to(socket, &ToClient::None, cx);
                Answered::None
            }
            _ => {
                self.to(socket, &ToClient::Load { modules }, cx);
                Answered::Load(names)
            }
        };
        tracing::debug!(socket, ?answered, "a cockpit panel was answered");
        if let Some(client) = self.sockets.get_mut(&socket) {
            client.answered = answered;
        }
    }

    /// Whether an open socket other than `socket` was answered with `module`.
    fn held_elsewhere(&self, module: &str, socket: u64) -> bool {
        self.sockets
            .iter()
            .any(|(&s, c)| s != socket && c.answered.loaded(module))
    }
}
