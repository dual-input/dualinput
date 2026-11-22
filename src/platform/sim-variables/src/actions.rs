//! Carrying out a feature's actions, each through the route its kind of name takes
//! (record/areas/sync/05-units.md, "Reaching the sim").

use kernel::Cx;
use messages::module::slots::HtmlAndInputEventsSlot;
use messages::module::{HTML_AND_INPUT_EVENTS, HtmlOrInputEvent, html_and_input_event_slots};
use messages::sync::Value;
use profile_engine::Name;
use sim_service::{SimCx, Value as SimValue};

use crate::watches::Source;
use crate::{Action, SimVariables};

/// One step of carrying out a list of actions.
#[derive(Debug, PartialEq)]
enum Step {
    /// A batch for `HtmlAndInputEvents`, which makes them in its order.
    Events(Vec<HtmlOrInputEvent>),
    /// An action SimConnect makes itself.
    Call(Action),
}

/// `actions` as the steps that carry them out, in their order. `H:` events and input events'
/// presets go to the routine as a batch, ended by each action SimConnect makes, so a write
/// function's actions go out in its call order, though whether the sim keeps that order
/// between two routes is unverified (record/areas/sync/05-units.md, "Reaching the sim").
fn steps(actions: Vec<Action>) -> Vec<Step> {
    let mut steps = Vec::new();
    let mut batch = Vec::new();
    for action in actions {
        let event = match &action {
            Action::Fire {
                name: Name::H { name },
            } => Some(HtmlOrInputEvent::H(name.clone())),
            Action::Fire {
                name: Name::B { name },
            } => Some(HtmlOrInputEvent::Preset {
                name: name.clone(),
                value: None,
            }),
            Action::Set {
                name: Name::B { name },
                value,
            } => Some(HtmlOrInputEvent::Preset {
                name: name.clone(),
                value: value.number(),
            }),
            _ => None,
        };
        match event {
            Some(event) => batch.push(event),
            None => {
                if !batch.is_empty() {
                    steps.push(Step::Events(std::mem::take(&mut batch)));
                }
                steps.push(Step::Call(action));
            }
        }
    }
    if !batch.is_empty() {
        steps.push(Step::Events(batch));
    }
    steps
}

/// One thing carrying out actions sends.
#[derive(Debug, PartialEq)]
enum Sent {
    /// A feed of `HtmlAndInputEvents`, boxed, since a slot holds 8,000 bytes of names.
    Feed(Box<HtmlAndInputEventsSlot>),
    /// An action SimConnect makes itself.
    Call(Action),
}

impl SimVariables {
    pub(crate) fn act_for(me: &mut SimVariables, actions: Vec<Action>, cx: &mut Cx) {
        for sent in me.sent(actions) {
            match sent {
                // One unit feeds the routine for every feature, since the sim service keys a
                // feed by its unit and writes it again every 200ms, and two units' feeds of one
                // slot would each read as new and fire a `_Toggle` preset again (read in
                // src/platform/sim-service/src/module.rs, `feeds`). This handler runs as sim
                // variables' own unit, whichever feature acted.
                Sent::Feed(slot) => cx.module().feed(HTML_AND_INPUT_EVENTS, &*slot),
                Sent::Call(action) => me.call(action, cx),
            }
        }
    }

    /// What carrying out `actions` sends, in their order, which is nothing outside a flight.
    fn sent(&self, actions: Vec<Action>) -> Vec<Sent> {
        if !self.in_flight {
            return Vec::new();
        }
        let mut sent = Vec::new();
        for step in steps(actions) {
            match step {
                Step::Events(events) => sent.extend(
                    html_and_input_event_slots(&events)
                        .into_iter()
                        .map(|slot| Sent::Feed(Box::new(slot))),
                ),
                Step::Call(action) => sent.push(Sent::Call(action)),
            }
        }
        sent
    }

    fn call(&mut self, action: Action, cx: &Cx) {
        match action {
            Action::Set { name, value } => {
                let Source::Variable { name, unit } = Source::of(&name) else {
                    tracing::warn!(?name, "a write named nothing sim variables can set");
                    return;
                };
                let handle = self.write_handle(&name, &unit, cx);
                let value = match value {
                    Value::Number(n) => SimValue::Number(n),
                    Value::Text(t) => SimValue::Text(t),
                };
                cx.sim().write(handle, vec![value]);
            }
            Action::Key { name, values } => {
                let Name::K { name, .. } = name else {
                    tracing::warn!(?name, "a key action named no K: event");
                    return;
                };
                // A DWORD on the wire: a negative value goes as its `i32` bits, as an axis's
                // low end does, and the cast from `f64` saturates.
                let values: Vec<u32> = values.iter().map(|v| *v as i64 as u32).collect();
                cx.sim().key(&name, &values);
            }
            Action::Fire { name } => {
                tracing::warn!(
                    ?name,
                    "a fired action named neither an H: event nor a preset"
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use messages::module::html_and_input_events;

    use super::*;

    fn h(name: &str) -> Action {
        Action::Fire {
            name: Name::H { name: name.into() },
        }
    }

    fn toggle(name: &str) -> Action {
        Action::Fire {
            name: Name::B { name: name.into() },
        }
    }

    fn toggled(name: &str) -> HtmlOrInputEvent {
        HtmlOrInputEvent::Preset {
            name: name.into(),
            value: None,
        }
    }

    /// The events the routine's feeds among `sent` hold, in the order fed.
    fn fed(sent: &[Sent]) -> Vec<HtmlOrInputEvent> {
        sent.iter()
            .flat_map(|s| match s {
                Sent::Feed(slot) => html_and_input_events(slot),
                Sent::Call(_) => Vec::new(),
            })
            .collect()
    }

    #[test]
    fn an_action_outside_a_flight_does_nothing() {
        let actions = vec![
            Action::Set {
                name: Name::L {
                    name: "STROBE".into(),
                    unit: None,
                },
                value: Value::Number(1.0),
            },
            Action::Key {
                name: Name::K {
                    name: "AP_MASTER".into(),
                    values: Vec::new(),
                },
                values: Vec::new(),
            },
            h("FUEL"),
            toggle("LIGHTING_NAV_1_Toggle"),
        ];
        let mut me = SimVariables::default();
        assert!(me.sent(actions.clone()).is_empty(), "outside a flight");
        me.in_flight = true;
        let sent = me.sent(actions);
        assert_eq!(
            sent.len(),
            3,
            "in a flight: the write, the key, and one feed for the H: event and the preset"
        );
        assert_eq!(
            fed(&sent),
            [
                HtmlOrInputEvent::H("FUEL".into()),
                toggled("LIGHTING_NAV_1_Toggle")
            ]
        );
    }

    /// State sync's toggle of the nav lights and a Run's of the beacon, handled in one input:
    /// `act_for` carries out each in turn, as sim variables' own unit, so the routine gets two
    /// feeds from one unit, which the sim service's `feed` counts as two new ones, and the
    /// routine host carries out each new feed once, and a rewrite of the last not at all (read
    /// in src/platform/routine-host/src/lib.rs, `written`).
    #[test]
    fn html_and_input_events_fed_by_two_features_in_one_input_fires_each_event_once() {
        let me = SimVariables {
            in_flight: true,
            ..SimVariables::default()
        };
        let state_sync = me.sent(vec![toggle("LIGHTING_NAV_1_Toggle"), h("FUEL")]);
        let run = me.sent(vec![toggle("LIGHTING_BEACON_1_Toggle")]);
        assert_eq!(
            (state_sync.len(), run.len()),
            (1, 1),
            "one feed for each feature's batch"
        );
        assert_eq!(
            [fed(&state_sync), fed(&run)].concat(),
            [
                toggled("LIGHTING_NAV_1_Toggle"),
                HtmlOrInputEvent::H("FUEL".into()),
                toggled("LIGHTING_BEACON_1_Toggle")
            ],
            "each event once, in the order acted"
        );
    }

    #[test]
    fn events_and_presets_batch_until_a_call_and_keep_their_order() {
        let set = Action::Set {
            name: Name::L {
                name: "STROBE".into(),
                unit: None,
            },
            value: Value::Number(1.0),
        };
        let preset = Action::Set {
            name: Name::B {
                name: "INSTRUMENT_HEADING_BUG_Set".into(),
            },
            value: Value::Number(180.0),
        };
        let steps = steps(vec![h("FUEL"), preset, set.clone(), h("adf_bfo")]);
        assert_eq!(
            steps,
            [
                Step::Events(vec![
                    HtmlOrInputEvent::H("FUEL".into()),
                    HtmlOrInputEvent::Preset {
                        name: "INSTRUMENT_HEADING_BUG_Set".into(),
                        value: Some(180.0),
                    },
                ]),
                Step::Call(set),
                Step::Events(vec![HtmlOrInputEvent::H("adf_bfo".into())]),
            ]
        );
    }
}
