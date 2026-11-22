//! Sim variables, the platform's way for any feature to read and write the sim's variables and
//! fire its events by the names a profile writes, each kind of name by its route
//! (record/areas/profiles/04-the-extension-in-the-sim.md, "Reaching the sim by name"):
//!
//! | Name | Watch | Act |
//! | --- | --- | --- |
//! | `L:`, `A:` | the sim service's watch, every frame, on change | a write |
//! | `B:` | `input`, then its subscription | its preset, through `HtmlAndInputEvents` |
//! | `K:` | `listen` | `key`, the legacy call with one value or none |
//! | `H:` | the `h-events` panel module, in one panel | through `HtmlAndInputEvents` |
//! | `instrument()` | the `instrument-reads` panel module, in its instrument's panel | nothing writes one |
//!
//! A feature watches and acts through `cx.variables()`, and hears what it watches through
//! `on_variables`. Its watch lasts until it ends it. Sim variables' own side in the sim lasts one
//! flight: its connection opens at its first call and closes as this pilot leaves the session's
//! flight, taking every watch and the routine with it. Within a flight it takes no watch back
//! from the sim, since the sim client has no call that does, and replays every call that set
//! the connection up after a loss, so ending a watch only stops handing its readings on.
//!
//! Register it after the session crate, whose flight it follows, and before every feature that
//! uses it, since a feature's `on_variables` registers with it.

mod actions;
mod panels;
mod watches;

use std::collections::{BTreeMap, BTreeSet};

use clients::{ClientLeft, ClientsUnit};
use kernel::{Cx, Handle, Handler, Registry, Unit};
use messages::sim_variables::{H_EVENTS, INSTRUMENT_READS};
use messages::sync::Value;
use profile_engine::Name;
use session::{FlightChanged, Session, SessionEnded};
use sim_service::{Period, SimCx, SimEvent, SimUnit, Value as SimValue, Var};

use crate::watches::{Source, Watches};

/// The unit's name.
const NAME: &str = "sim-variables";

/// One name a feature watches, and how.
#[derive(Clone, Debug, PartialEq)]
pub struct Watch {
    pub name: Name,
    pub reads: Reads,
}

/// How a watch reads a name. Only an input event can be read either way: an `L:`, an `A:`, and
/// an `instrument()` always give values, and a `K:` and an `H:` event always occurrences.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reads {
    /// Its value as watching starts, and at each change.
    Value,
    /// Each time it fires, with its first read left out, since that says only where an input
    /// stands.
    Occurrences,
}

/// One action, as the sync engine's writes give them, in call order.
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    /// Sets an `L:` or `A:` variable, or an input event through its preset, to a value.
    Set { name: Name, value: Value },
    /// Sends a `K:` event with its values.
    Key { name: Name, values: Vec<f64> },
    /// Fires an `H:` event, or an input event's preset with no value.
    Fire { name: Name },
}

/// What reaches a feature's `on_variables`: for the name at `place` in the watch `watch`, what
/// it got.
#[derive(Clone, Debug, PartialEq)]
pub struct VariablesEvent {
    pub watch: Handle,
    pub place: usize,
    pub got: Got,
}

/// What a watch got for one of its names.
#[derive(Clone, Debug, PartialEq)]
pub enum Got {
    /// A value, as watching starts and at each change, or the last one read when another
    /// feature's watch of the same name started first.
    Read(Value),
    /// An occurrence, with the value it carried.
    Fired(Option<f64>),
    /// The sim refused the name, as it refuses an `A:` it lacks with an exception after the
    /// call, or the name's panel couldn't read it, with the error's words.
    Failed(String),
}

/// Sim variables' state.
#[derive(Default)]
pub struct SimVariables {
    /// Each feature's `on_variables`, by its unit's place.
    hooks: BTreeMap<u32, Handler<VariablesEvent>>,
    watches: Watches<Handle>,
    /// Whether this pilot is in a session's flight, which the side in the sim lasts.
    in_flight: bool,
    sim: InSim,
    panels: panels::Panels,
}

/// What sim variables holds of its connection, for one flight.
#[derive(Default)]
struct InSim {
    /// Each source the connection watches, listens to, or reads.
    made: BTreeSet<Source>,
    /// The source of each of the connection's calls, by the handle its answers carry.
    calls: BTreeMap<Handle, Source>,
    /// Each variable's handle for a write, by its name and unit: its watch's, or a definition
    /// of its own for a write function's target no watch reads.
    written: BTreeMap<(String, String), Handle>,
}

/// Registers sim variables.
pub fn register(r: &mut Registry) {
    let mut me = r.unit::<SimVariables>(NAME);
    me.on::<FlightChanged>(SimVariables::flight_changed)
        .on::<SessionEnded>(|me, _, cx| me.set_flight(false, cx))
        .on::<ClientLeft>(|me, left, _| me.panels.left(left.socket))
        .on_sim(SimVariables::on_sim)
        .one_panel_module(H_EVENTS, panels::h_events_rule, panels::any_html_event)
        .panel_module(
            INSTRUMENT_READS,
            panels::instruments_rule,
            panels::any_instrument,
        )
        .client_messages(H_EVENTS, SimVariables::heard_h)
        .client_messages(INSTRUMENT_READS, SimVariables::instrument_reads);
}

/// Registers what a feature hears of the names it watches.
pub trait VariablesUnit {
    type State;
    /// Hands `f` each reading, firing, and failure of the feature's watches.
    fn on_variables(&mut self, f: fn(&mut Self::State, VariablesEvent, &mut Cx)) -> &mut Self;
}

impl<S: 'static> VariablesUnit for Unit<'_, S> {
    type State = S;

    fn on_variables(&mut self, f: fn(&mut S, VariablesEvent, &mut Cx)) -> &mut Self {
        let hook = self.handler(f);
        let unit = self.id().place();
        self.registry()
            .state_mut::<SimVariables>()
            .hooks
            .insert(unit, hook);
        self
    }
}

/// Sim variables' calls, from a handler.
pub trait VariablesCx<'k> {
    fn variables(&self) -> Variables<'_, 'k>;
}

impl<'k> VariablesCx<'k> for Cx<'k> {
    fn variables(&self) -> Variables<'_, 'k> {
        Variables { cx: self }
    }
}

/// The calling feature's watches and actions. Each call returns at once, and runs once the
/// feature's handler has returned.
pub struct Variables<'c, 'k> {
    cx: &'c Cx<'k>,
}

impl Variables<'_, '_> {
    /// Watches `names`: each reading, firing, or failure reaches the feature's `on_variables`
    /// with this handle and the name's place in `names`.
    pub fn watch(&self, names: &[Watch]) -> Handle {
        let watch = self.cx.handle();
        self.cx
            .call(SimVariables::watch_for, (watch, names.to_vec()));
        watch
    }

    /// Carries out `actions` in their order, each through its name's route, while this pilot is
    /// in a session's flight. Outside one they do nothing.
    pub fn act(&self, actions: Vec<Action>) {
        self.cx.call(SimVariables::act_for, actions);
    }

    /// Stops handing on the readings of `watch`.
    pub fn end(&self, watch: Handle) {
        self.cx.call(SimVariables::end_for, watch);
    }
}

impl SimVariables {
    fn flight_changed(me: &mut SimVariables, changed: &FlightChanged, cx: &mut Cx) {
        if cx.read::<Session>().me() == Some(changed.member) {
            me.set_flight(changed.in_flight, cx);
        }
    }

    /// This pilot entered a session's flight or left it. Entering, each name a feature watches
    /// gets its watch in the sim; leaving, the connection closes, with its watches and the
    /// routine, and what it held of them goes.
    fn set_flight(&mut self, in_flight: bool, cx: &Cx) {
        if in_flight == self.in_flight {
            return;
        }
        self.in_flight = in_flight;
        if in_flight {
            let sources: Vec<Source> = self.watches.watched().cloned().collect();
            self.make(sources, cx);
        } else {
            cx.sim().close();
            self.sim = InSim::default();
            self.watches.forget_readings();
        }
    }

    fn watch_for(me: &mut SimVariables, (watch, names): (Handle, Vec<Watch>), cx: &mut Cx) {
        let (new, now) = me.watches.add(watch, &names);
        let instruments = new.iter().any(Source::is_instrument);
        let panels = new.iter().any(Source::in_a_panel);
        me.make(new, cx);
        me.hand_on(now, cx);
        if instruments {
            me.send_every_panel_paths(cx);
        }
        // The panel modules run while some feature watches a name they serve, and their rules
        // read what features watch only as `clients` answers the panels, which it does at the
        // profile's load. A name watched later, as the profile extension's open text names one,
        // gets its module only once `clients` answers the panels again.
        if panels {
            clients::panel_rules_changed(cx);
        }
    }

    fn end_for(me: &mut SimVariables, watch: Handle, cx: &mut Cx) {
        let gone = me.watches.end(watch);
        if gone.iter().any(Source::is_instrument) {
            me.panels.forget(&gone);
            me.send_every_panel_paths(cx);
        }
        if gone.iter().any(Source::in_a_panel) {
            clients::panel_rules_changed(cx);
        }
    }

    /// Makes the watch in the sim of each of `sources` this flight's connection doesn't watch
    /// yet. Each variable gets a watch of its own, since an exception names only the call it
    /// fails, and a watch that read many variables couldn't say which the sim refused. `H:`
    /// events and `instrument()` values come from the panel modules instead.
    fn make(&mut self, sources: Vec<Source>, cx: &Cx) {
        if !self.in_flight {
            return;
        }
        let (mut vars, mut var_sources) = (Vec::new(), Vec::new());
        let (mut keys, mut key_sources) = (Vec::new(), Vec::new());
        let (mut inputs, mut input_sources) = (Vec::new(), Vec::new());
        for source in sources {
            if !self.sim.made.insert(source.clone()) {
                continue;
            }
            match &source {
                Source::Variable { name, unit } => {
                    vars.push(var(name, unit));
                    var_sources.push(source);
                }
                Source::Key(name) => {
                    keys.push(name.clone());
                    key_sources.push(source);
                }
                Source::Input(name) => {
                    inputs.push(name.clone());
                    input_sources.push(source);
                }
                Source::Html(_) | Source::Instrument { .. } => {}
            }
        }
        let sim = cx.sim();
        for (handle, source) in sim
            .watch_each(&vars, Period::OnChange)
            .into_iter()
            .zip(var_sources)
        {
            if let Source::Variable { name, unit } = &source {
                self.sim
                    .written
                    .insert((name.clone(), unit.clone()), handle);
            }
            self.sim.calls.insert(handle, source);
        }
        for (handle, source) in sim.listen(&keys).into_iter().zip(key_sources) {
            self.sim.calls.insert(handle, source);
        }
        for (handle, source) in sim.input(&inputs).into_iter().zip(input_sources) {
            self.sim.calls.insert(handle, source);
        }
    }

    /// What the sim brought for this flight's connection, handed to each feature that watches
    /// its source.
    fn on_sim(me: &mut SimVariables, event: SimEvent, cx: &mut Cx) {
        let got = match event {
            SimEvent::Values { watch, values } => {
                let Some(source) = me.source_of(watch) else {
                    return;
                };
                let mut got = Vec::new();
                for (_, value) in values {
                    got.extend(me.watches.read(&source, value_of(value), false));
                }
                got
            }
            SimEvent::Heard { call, data } => {
                let Some(source) = me.source_of(call) else {
                    return;
                };
                // SimConnect hands an event's value as a DWORD, which a negative value, such as
                // an axis at its low end, fills as an `i32`.
                me.watches.fired(&source, Some(f64::from(data[0] as i32)))
            }
            SimEvent::Input { call, value, first } => {
                let Some(source) = me.source_of(call) else {
                    return;
                };
                me.watches.read(&source, value_of(value), first)
            }
            SimEvent::Exception {
                call, exception, ..
            } => {
                let Some(source) = call.and_then(|c| me.source_of(c)) else {
                    tracing::info!(exception, "the sim refused a write of sim variables'");
                    return;
                };
                tracing::info!(
                    exception,
                    ?source,
                    "the sim refused a name a feature watches"
                );
                let error = format!("the sim refused it, with SimConnect exception {exception}");
                me.watches.failed(&source, error)
            }
            SimEvent::Failed { call } => {
                let Some(source) = me.source_of(call) else {
                    return;
                };
                tracing::info!(?source, "the sim couldn't read a name a feature watches");
                let error = match source {
                    Source::Input(_) => "the loaded aircraft has no input event of this name",
                    _ => "the sim couldn't read it",
                };
                me.watches.failed(&source, error.to_string())
            }
            SimEvent::Lost => {
                tracing::info!("sim variables' connection to the sim was lost and opens again");
                return;
            }
            _ => return,
        };
        me.hand_on(got, cx);
    }

    fn source_of(&self, call: Handle) -> Option<Source> {
        self.sim.calls.get(&call).cloned()
    }

    /// Hands each feature what its watches got.
    fn hand_on(&self, got: Vec<(Handle, usize, Got)>, cx: &Cx) {
        for (watch, place, got) in got {
            match self.hooks.get(&watch.unit()) {
                Some(hook) => cx.call_handler(hook, VariablesEvent { watch, place, got }),
                None => tracing::debug!(
                    unit = watch.unit(),
                    "a unit with no on_variables handler missed what its watch got"
                ),
            }
        }
    }

    /// The handle a write of `name` in `unit` goes through: its watch's, or a definition of its
    /// own, made at the first write, for a variable no watch reads.
    fn write_handle(&mut self, name: &str, unit: &str, cx: &Cx) -> Handle {
        *self
            .sim
            .written
            .entry((name.to_string(), unit.to_string()))
            .or_insert_with(|| cx.sim().define(&var(name, unit)))
    }
}

fn var(name: &str, unit: &str) -> Var {
    if unit.eq_ignore_ascii_case("string") {
        Var::text(name)
    } else {
        Var::number(name, unit)
    }
}

fn value_of(value: SimValue) -> Value {
    match value {
        SimValue::Number(n) => Value::Number(n),
        SimValue::Text(t) => Value::Text(t),
    }
}
