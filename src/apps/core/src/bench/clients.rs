//! The test unit that stands in for a feature that uses the clients crate, before one is
//! built: a slice, a setting, a command, a notification, and a panel module that echoes its
//! panel's messages, which the clients crate answers each cockpit panel with once the profile
//! loader has loaded a profile (record/areas/build/02-testing.md, "Its place").

use std::time::Duration;

use clients::{Clients, ClientsUnit, Sender, SettingDef, To};
use kernel::{Cx, Input, Registry, TimerId, View};
use messages::bench::{ClientsAct, ToCore};
use messages::clients::SettingKind;
use serde_json::{Value, json};

/// Names the source the bench's lines for this unit come in under.
pub struct Acts;

/// The unit's panel module, whose rule takes the instruments the bench picks.
pub const PANEL_MODULE: &str = "bench-panel";

#[derive(Default)]
pub struct BenchClients {
    /// The prefixes of the instruments the unit's panel module takes, as a feature's rule takes
    /// the ones its profile's block names.
    picks: Vec<String>,
    counter: u64,
    churn: Option<Churn>,
}

struct Churn {
    every: Duration,
    until: u64,
}

impl BenchClients {
    pub fn register(r: &mut Registry) {
        let mut me = r.unit::<BenchClients>("bench-clients");
        me.source::<Acts>(BenchClients::act);
        me.client_state(
            "bench",
            |me: &BenchClients, _: &View| json!({ "counter": me.counter }),
        )
        .setting(
            "bench.flag",
            SettingDef {
                label: "A flag the bench sets",
                kind: SettingKind::Bool,
                default: json!(false),
                part_only: false,
                development: false,
            },
        )
        .command("bench.read-setting", BenchClients::read_setting)
        .panel_module(PANEL_MODULE, BenchClients::rule, BenchClients::needed)
        .client_messages(PANEL_MODULE, BenchClients::echo);
    }

    fn act(me: &mut BenchClients, input: &Input, cx: &mut Cx) {
        let Ok(ToCore::Clients { act }) = serde_json::from_slice(&input.bytes) else {
            tracing::warn!("a line for the clients' test unit isn't one of its acts");
            return;
        };
        match act {
            ClientsAct::Picks { picks } => me.picks = picks,
            ClientsAct::Churn { per_second, for_ms } => {
                let every = Duration::from_secs(1) / per_second.max(1);
                me.churn = Some(Churn {
                    every,
                    until: cx.now() + for_ms * 1_000,
                });
                cx.timer(every, BenchClients::churn);
            }
            ClientsAct::Notify { id, text } => clients::notify(
                cx,
                &id,
                clients::Level::Information,
                &text,
                None,
                clients::Landing::Session,
            ),
        }
    }

    fn churn(me: &mut BenchClients, _: TimerId, cx: &mut Cx) {
        let Some(churn) = &me.churn else { return };
        me.counter += 1;
        if cx.now() < churn.until {
            cx.timer(churn.every, BenchClients::churn);
        } else {
            me.churn = None;
        }
    }

    /// The case from the loop's design: a command's handler reads the clients crate's
    /// settings while the clients crate dispatches it.
    fn read_setting(_: &mut BenchClients, _: Value, cx: &mut Cx) -> Result<(), String> {
        match cx.read::<Clients>().setting_as::<bool>("bench.flag") {
            Some(true) => Ok(()),
            _ => Err("bench.flag isn't set".into()),
        }
    }

    fn rule(view: &View, instruments: &[String]) -> Vec<String> {
        let picks = &view.read::<BenchClients>().picks;
        instruments
            .iter()
            .filter(|i| picks.iter().any(|p| i.starts_with(p.as_str())))
            .cloned()
            .collect()
    }

    fn needed(view: &View) -> bool {
        !view.read::<BenchClients>().picks.is_empty()
    }

    /// Sends a panel module's message back to every panel that loaded the module.
    fn echo(_: &mut BenchClients, _: Sender, body: Value, cx: &mut Cx) {
        clients::send(
            cx,
            To::PanelModule(PANEL_MODULE.into()),
            PANEL_MODULE,
            &body,
        );
    }
}
