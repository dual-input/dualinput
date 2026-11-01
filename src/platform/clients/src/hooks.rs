//! What a unit registers with the clients crate: its slices of client state, its commands,
//! the `unit` messages it takes from clients, its panel modules, and its settings
//! (record/areas/core/02-clients-and-panel-bridge.md, "What a unit registers and calls").

use kernel::{Cx, Unit, View};
use messages::clients::SettingKind;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::panels::PanelModuleRule;
use crate::state::Slice;
use crate::{Clients, CommandCall, Sender, UnitCall};

/// A setting a unit registers.
pub struct SettingDef {
    /// In the registering feature's words.
    pub label: &'static str,
    pub kind: SettingKind,
    pub default: Value,
    /// Whether only the registering feature's part shows it.
    pub part_only: bool,
    /// A development setting shows in no app: a developer edits `settings.json` while the
    /// core is stopped.
    pub development: bool,
}

/// The clients crate's hooks on a unit, as it registers.
pub trait ClientsUnit<S> {
    /// A slice of client state, which `view` builds from the unit's state and the
    /// platform's each round, for the clients that show it. `view` runs inside a handler of
    /// the clients crate, so reading `Clients` through `View` there panics; a unit that shows
    /// a setting keeps its own copy, from `SettingChanged`.
    fn client_state<V: Serialize + 'static>(
        &mut self,
        slice: &'static str,
        view: fn(&S, &View) -> V,
    ) -> &mut Self;

    /// A command any client may send, by name. The clients crate answers "taken" when `f`
    /// returns `Ok`, and the error otherwise, and an error without calling `f` when the
    /// arguments don't read as `A`.
    fn command<A: DeserializeOwned + 'static>(
        &mut self,
        name: &'static str,
        f: fn(&mut S, A, &mut Cx) -> Result<(), String>,
    ) -> &mut Self;

    /// The `unit` messages clients send this unit by `name`, such as a panel module's.
    fn client_messages<B: DeserializeOwned + 'static>(
        &mut self,
        name: &'static str,
        f: fn(&mut S, Sender, B, &mut Cx),
    ) -> &mut Self;

    /// A panel module, whose rule picks the instruments of a cockpit panel it loads for,
    /// given the instruments' keys, once the profile has loaded. The rule reads the loaded
    /// profile through `View`, and a panel none of whose instruments it picks doesn't load it.
    /// `needed` says whether the loaded profile names anything the module serves, and when no
    /// module's does, the clients crate raises no trouble over a panel that never connects.
    /// Both run inside a handler of the clients crate, so reading `Clients` there panics.
    fn panel_module(
        &mut self,
        name: &'static str,
        rule: fn(&View, &[String]) -> Vec<String>,
        needed: fn(&View) -> bool,
    ) -> &mut Self;

    /// A setting, by a key no other unit registers, whose value any unit reads through
    /// `Clients::setting`.
    fn setting(&mut self, key: &'static str, setting: SettingDef) -> &mut Self;
}

impl<S: 'static> ClientsUnit<S> for Unit<'_, S> {
    fn client_state<V: Serialize + 'static>(
        &mut self,
        slice: &'static str,
        view: fn(&S, &View) -> V,
    ) -> &mut Self {
        let build = Box::new(move |v: &View| serde_json::to_string(&view(v.read::<S>(), v)));
        let clients = self.registry().state_mut::<Clients>();
        assert!(
            !clients.slices.iter().any(|s| s.name == slice),
            "slice {slice} should be registered once"
        );
        clients.slices.push(Slice { name: slice, build });
        self
    }

    fn command<A: DeserializeOwned + 'static>(
        &mut self,
        name: &'static str,
        f: fn(&mut S, A, &mut Cx) -> Result<(), String>,
    ) -> &mut Self {
        let handler = self.handler(move |state: &mut S, call: CommandCall, cx: &mut Cx| {
            let result = match serde_json::from_value::<A>(call.args) {
                Ok(args) => f(state, args, cx),
                Err(error) => Err(format!("its arguments didn't read: {error}")),
            };
            cx.call(Clients::answered, (call.socket, call.id, result));
        });
        let clients = self.registry().state_mut::<Clients>();
        assert!(
            clients.commands.insert(name, handler).is_none(),
            "command {name} should be registered once"
        );
        self
    }

    fn client_messages<B: DeserializeOwned + 'static>(
        &mut self,
        name: &'static str,
        f: fn(&mut S, Sender, B, &mut Cx),
    ) -> &mut Self {
        let handler = self.handler(move |state: &mut S, call: UnitCall, cx: &mut Cx| {
            match serde_json::from_value::<B>(call.body) {
                Ok(body) => f(state, call.from, body, cx),
                Err(error) => tracing::warn!(unit = name, component = call.from.component, %error, "a client's unit message didn't read, so it was dropped"),
            }
        });
        let clients = self.registry().state_mut::<Clients>();
        assert!(
            clients.unit_messages.insert(name, handler).is_none(),
            "unit messages to {name} should be registered once"
        );
        self
    }

    fn panel_module(
        &mut self,
        name: &'static str,
        rule: fn(&View, &[String]) -> Vec<String>,
        needed: fn(&View) -> bool,
    ) -> &mut Self {
        let clients = self.registry().state_mut::<Clients>();
        assert!(
            !clients.panel_modules.iter().any(|m| m.name == name),
            "panel module {name} should be registered once"
        );
        clients
            .panel_modules
            .push(PanelModuleRule { name, rule, needed });
        self
    }

    fn setting(&mut self, key: &'static str, setting: SettingDef) -> &mut Self {
        self.registry()
            .state_mut::<Clients>()
            .settings
            .register(key, setting);
        self
    }
}
