//! The menu script, our script in the sim's menu document, which our copy of BlurPage brings in:
//! the service asks it for its master page as its socket joins, hears each change of page, and
//! hands it the world map's requests a feature calls, routing each answer back to that call
//! (record/areas/session/02-units.md, "The menu script").

use clients::{ClientJoined, ClientLeft, Sender, To};
use kernel::{Cx, Handle};
use messages::clients::component;
use messages::sim::{FromMenuScript, MENU_UNIT, WorldMapCall, WorldMapOutcome, WorldMapRequest};

use crate::awareness::Step;
use crate::connections::Origin;
use crate::{SimEvent, SimService};

impl SimService {
    /// Whether a menu script is connected, without which the world map's requests fail.
    pub fn menu_script(&self) -> bool {
        !self.menu.sockets.is_empty()
    }

    pub(crate) fn world_map_for(
        me: &mut SimService,
        (origin, request): (Origin, WorldMapRequest),
        cx: &mut Cx,
    ) {
        let Some(call) = origin.handle else {
            return;
        };
        // A page's socket can stay open after the page has gone, until the core's 8s of quiet
        // closes it (decision 010), so the newest socket is the one whose page is up.
        let Some(&socket) = me.menu.sockets.last() else {
            tracing::info!(
                ?request,
                "a world map request with no menu script connected"
            );
            me.tell(origin.unit, SimEvent::Failed { call }, cx);
            return;
        };
        tracing::info!(?request, "a world map request to the menu script");
        me.menu.waiting.insert(call.n(), (socket, call));
        let asked = WorldMapCall {
            call: call.n(),
            request,
        };
        clients::send(cx, To::Socket(socket), MENU_UNIT, &asked);
    }

    /// The menu script's socket joined: the service asks it for its master page, which ends
    /// Starting for a core that found the sim already running, since no SimConnect signal tells
    /// the main menu from a flight then (record/areas/core/03-sim-seam-and-wasm-module.md,
    /// "Leaving Starting").
    pub(crate) fn client_joined(me: &mut SimService, joined: &ClientJoined, cx: &mut Cx) {
        if joined.component != component::MENU_SCRIPT {
            return;
        }
        me.menu.sockets.push(joined.socket);
        clients::send(
            cx,
            To::Socket(joined.socket),
            MENU_UNIT,
            &serde_json::json!({}),
        );
    }

    /// A menu script's socket closed, so each request it held fails, as a request to a menu
    /// that's gone would otherwise wait for good.
    pub(crate) fn client_left(me: &mut SimService, left: &ClientLeft, cx: &mut Cx) {
        if left.component != component::MENU_SCRIPT {
            return;
        }
        me.menu.sockets.retain(|&socket| socket != left.socket);
        let gone: Vec<u64> = me
            .menu
            .waiting
            .iter()
            .filter(|(_, (socket, _))| *socket == left.socket)
            .map(|(&n, _)| n)
            .collect();
        for n in gone {
            if let Some((_, call)) = me.menu.waiting.remove(&n) {
                me.tell_unit(call, SimEvent::Failed { call }, cx);
            }
        }
    }

    pub(crate) fn menu_said(me: &mut SimService, _: Sender, said: FromMenuScript, cx: &mut Cx) {
        match said {
            FromMenuScript::Page(report) => {
                tracing::info!(master = ?report.master, "the menu script reported its master page");
                Step::signal(cx, Step::Page(report.master));
            }
            FromMenuScript::Answer(answer) => {
                let Some((_, call)) = me.menu.waiting.remove(&answer.call) else {
                    tracing::info!(
                        call = answer.call,
                        "the menu script answered a request no unit waits for"
                    );
                    return;
                };
                if let WorldMapOutcome::Failed { why } = &answer.outcome {
                    tracing::info!(why, "a world map request failed in the menu script");
                }
                let outcome = answer.outcome;
                me.tell_unit(call, SimEvent::WorldMap { call, outcome }, cx);
            }
        }
    }

    /// Tells the unit that drew `call`.
    fn tell_unit(&self, call: Handle, event: SimEvent, cx: &Cx) {
        if let Some(hook) = self.hooks.get(&call.unit()) {
            cx.call_handler(hook, event);
        }
    }
}

/// The menu scripts connected, oldest first, and each world map request waiting for its answer,
/// by its call's number, with the socket it went to.
#[derive(Default)]
pub(crate) struct Menu {
    sockets: Vec<u64>,
    waiting: std::collections::BTreeMap<u64, (u64, Handle)>,
}
