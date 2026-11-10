//! What the engine watches: setting each watch up through the route its kind of name takes, and
//! handing it each reading and occurrence (record/areas/sync/05-units.md, "Reaching the sim").

use std::collections::BTreeMap;

use kernel::{Cx, Handle};
use messages::sync::Value;
use profile_engine::Name;
use sim_service::{Period, SimCx, SimEvent, Value as SimValue, Var};
use sync_engine::{Ctx, Out, Seen, Watching};

use crate::{Live, variable};

/// Each variable's handle for a write, by its name and unit: a watch's when an entry reads it,
/// and otherwise a definition of its own, which only a write function's target that no entry
/// reads ever needs.
#[derive(Default)]
pub(crate) struct Written {
    handles: BTreeMap<(String, String), Handle>,
}

fn var(name: &str, unit: &str) -> Var {
    if unit.eq_ignore_ascii_case("string") {
        Var::text(name)
    } else {
        Var::number(name, unit)
    }
}

impl Live {
    /// Sets up each watch of the loaded variant. Each variable gets a watch of its own, since
    /// an exception can name only the call it fails, and a watch that read many variables
    /// couldn't say which of them the sim refused.
    pub(crate) fn start_watching(&mut self, cx: &mut Cx) {
        let (mut vars, mut var_watches) = (Vec::new(), Vec::new());
        let (mut listens, mut listen_watches) = (Vec::new(), Vec::new());
        let (mut inputs, mut input_watches) = (Vec::new(), Vec::new());
        for (place, watch) in self.engine.watches().iter().enumerate() {
            match &watch.name {
                Name::L { .. } | Name::A { .. } => {
                    if let Some((name, unit)) = variable(&watch.name) {
                        vars.push(var(&name, &unit));
                        var_watches.push((place, name, unit));
                    }
                }
                Name::K { name, .. } => {
                    listens.push(name.clone());
                    listen_watches.push(place);
                }
                Name::B { name } => {
                    inputs.push(name.clone());
                    input_watches.push(place);
                }
                Name::H { name } => self.h_watches.entry(name.clone()).or_default().push(place),
                Name::Instrument { .. } => {}
            }
        }
        let sim = cx.sim();
        let handles = sim.watch_each(&vars, Period::OnChange);
        for (handle, (place, name, unit)) in handles.into_iter().zip(var_watches) {
            self.watches.insert(handle, place);
            self.written.handles.insert((name, unit), handle);
        }
        for (handle, place) in sim.listen(&listens).into_iter().zip(listen_watches) {
            self.watches.insert(handle, place);
        }
        for (handle, place) in sim.input(&inputs).into_iter().zip(input_watches) {
            self.watches.insert(handle, place);
        }
    }

    /// A value, an occurrence, or a refusal the sim service brought, as the engine's input.
    pub(crate) fn heard_from_sim(&mut self, event: SimEvent, ctx: Ctx) -> Vec<Out> {
        match event {
            SimEvent::Frame { call, .. } if Some(call) == self.frames => self.engine.frame(ctx),
            SimEvent::Values { watch, values } => {
                let Some(&place) = self.watches.get(&watch) else {
                    return Vec::new();
                };
                let mut out = Vec::new();
                for (_, value) in values {
                    let seen = Seen::Value {
                        watch: place,
                        value: value_of(value),
                    };
                    out.extend(self.engine.seen(seen, ctx));
                }
                out
            }
            SimEvent::Heard { call, data } => {
                let Some(&watch) = self.watches.get(&call) else {
                    return Vec::new();
                };
                // SimConnect hands an event's value as a DWORD, which a negative value, such
                // as an axis at its low end, fills as an `i32`.
                let value = Some(f64::from(data[0] as i32));
                self.engine.seen(Seen::Fired { watch, value }, ctx)
            }
            SimEvent::Input { call, value, first } => {
                let Some(&watch) = self.watches.get(&call) else {
                    return Vec::new();
                };
                let occurrence = self
                    .engine
                    .watches()
                    .get(watch)
                    .is_some_and(|w| w.watching == Watching::Occurrence);
                match (occurrence, first) {
                    // The first read says only where an event entry's input stands.
                    (true, true) => Vec::new(),
                    (true, false) => {
                        let value = value_of(value).number();
                        self.engine.seen(Seen::Fired { watch, value }, ctx)
                    }
                    (false, _) => {
                        let value = value_of(value);
                        self.engine.seen(Seen::Value { watch, value }, ctx)
                    }
                }
            }
            SimEvent::Exception {
                call, exception, ..
            } => {
                let Some(&watch) = call.and_then(|c| self.watches.get(&c)) else {
                    tracing::info!(exception, "the sim refused a write of state sync's");
                    return Vec::new();
                };
                tracing::info!(
                    exception,
                    watch,
                    "the sim refused a variable a profile watches"
                );
                self.engine.seen(Seen::Refused { watch }, ctx)
            }
            SimEvent::Failed { call } => {
                let Some(&watch) = self.watches.get(&call) else {
                    return Vec::new();
                };
                tracing::info!(watch, "the sim couldn't read what a profile watches");
                self.engine.seen(Seen::Refused { watch }, ctx)
            }
            SimEvent::Lost => {
                tracing::info!("state sync's connection to the sim was lost and opens again");
                Vec::new()
            }
            _ => Vec::new(),
        }
    }

    /// The handle a write of `name` goes through, defining the variable if no watch reads it.
    pub(crate) fn write_handle(&mut self, name: &str, unit: &str, cx: &Cx) -> Handle {
        *self
            .written
            .handles
            .entry((name.to_string(), unit.to_string()))
            .or_insert_with(|| cx.sim().define(&var(name, unit)))
    }
}

fn value_of(value: SimValue) -> Value {
    match value {
        SimValue::Number(n) => Value::Number(n),
        SimValue::Text(t) => Value::Text(t),
    }
}
