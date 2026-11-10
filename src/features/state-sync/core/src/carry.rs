//! Carrying out what the engine asks for, each action through the route its kind of name takes
//! (record/areas/sync/05-units.md, "Reaching the sim").

use cockpit_stream::CockpitCx;
use kernel::Cx;
use messages::state_sync::{
    CHANGE, FIRED, NAMED_EVENTS, NamedEvent, PF_CHANGE, STATE, named_event_slots,
};
use messages::sync::Value;
use profile_engine::Name;
use sim_service::{SimCx, Value as SimValue};
use sync_engine::{Action, ChangeKind, Flagged, Out, Why};

use crate::{Live, variable};

impl Live {
    /// Carries out `outs` in the order they came. `H:` events and input events' presets go to
    /// the routine as a batch, flushed before anything else, so a write function's actions go
    /// out in its call order, though whether the sim keeps that order between two routes is
    /// unverified (record/areas/sync/05-units.md, "Reaching the sim").
    pub(crate) fn carry_out(&mut self, outs: Vec<Out>, cx: &Cx) {
        let mut named: Vec<NamedEvent> = Vec::new();
        for out in outs {
            match out {
                Out::Act(Action::Fire { name }) => {
                    if let Some(event) = named_event(&name, None) {
                        named.push(event);
                    }
                }
                Out::Act(Action::Set {
                    name: Name::B { name },
                    value,
                }) => named.push(NamedEvent::Preset {
                    name,
                    value: value.number(),
                }),
                Out::Act(action) => {
                    flush(&mut named, cx);
                    self.act(action, cx);
                }
                other => {
                    flush(&mut named, cx);
                    self.apply_out(other, cx);
                }
            }
        }
        flush(&mut named, cx);
    }

    fn act(&mut self, action: Action, cx: &Cx) {
        match action {
            Action::Set { name, value } => {
                let Some((sim_name, unit)) = variable(&name) else {
                    tracing::warn!(?name, "a write named nothing state sync can set");
                    return;
                };
                let handle = self.write_handle(&sim_name, &unit, cx);
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
            Action::Fire { .. } => {}
        }
    }

    fn apply_out(&mut self, out: Out, cx: &Cx) {
        match out {
            Out::Send(change) => match (change.kind, change.value) {
                (ChangeKind::Shared, Some(value)) => {
                    cx.cockpit().send(CHANGE, &change.entry, &value);
                }
                (ChangeKind::PilotFlying, Some(value)) => {
                    cx.cockpit().send(PF_CHANGE, &change.entry, &value);
                }
                (ChangeKind::Fired, value) => cx.cockpit().send(FIRED, &change.entry, &value),
                _ => tracing::warn!(entry = change.entry, "a change came with no value"),
            },
            Out::Withdraw(entry) => {
                cx.cockpit().withdraw(CHANGE, &entry);
                cx.cockpit().withdraw(PF_CHANGE, &entry);
            }
            Out::Flag(flag) => {
                match &flag.what {
                    Flagged::NeverLanded { wanted, reading } => tracing::info!(
                        entry = flag.entry,
                        ?wanted,
                        ?reading,
                        retries = 0,
                        "a write never landed"
                    ),
                    Flagged::TooLarge { bytes } => {
                        tracing::info!(entry = flag.entry, bytes, "a value was too large to send")
                    }
                }
                self.couldnt_sync(&flag.entry, &flag.name, cx);
            }
            Out::Differ {
                entry,
                theirs,
                mine,
            } => tracing::info!(entry, ?theirs, ?mine, "a watch-only entry differs"),
            Out::Stop { entry, name, why } => {
                let why_text = match &why {
                    Why::Driven => "the aircraft keeps changing it on every machine",
                    Why::Limit(_) => "its write function reached the sandbox's limit",
                    Why::Compile(_) => "its write function didn't compile",
                };
                tracing::info!(entry, ?why, reason = why_text, "an entry stopped syncing");
                self.couldnt_sync(&entry, &name, cx);
            }
            Out::Stepped(entry) => {
                if let Some(applying) = self.stepping.remove(&entry) {
                    cx.cockpit().applied(applying);
                }
            }
            Out::CatchUpMade => cx.cockpit().step_made(STATE),
            Out::CatchUpDone => cx.cockpit().step_done(STATE),
            Out::Act(_) => {}
        }
    }

    /// A path the panel can't read: its entry gets no reading, and its pilot hears so once for
    /// each load (record/areas/plugins/01-plugins.md, "Its values").
    pub(crate) fn path_failed(&mut self, watch: usize, error: &str, cx: &Cx) {
        let Some(found) = self.engine.watches().get(watch) else {
            return;
        };
        let entry = found.entry.clone();
        tracing::info!(entry, error, "an instrument() path didn't read");
        let name = self.engine.entry_name(&entry).unwrap_or(&entry).to_string();
        self.couldnt_sync(&entry, &name, cx);
    }

    /// Tells the pilot an entry couldn't sync, once per entry for each load, and several flags
    /// in a row as one card (record/areas/interface/decisions.md, "The banner carries what a
    /// pilot must see without the EFB").
    pub(crate) fn couldnt_sync(&mut self, entry: &str, name: &str, cx: &Cx) {
        let from = self.from.get(entry).copied();
        self.notices.couldnt_sync(entry, name, from, cx);
    }
}

fn named_event(name: &Name, value: Option<f64>) -> Option<NamedEvent> {
    match name {
        Name::H { name } => Some(NamedEvent::H(name.clone())),
        Name::B { name } => Some(NamedEvent::Preset {
            name: name.clone(),
            value,
        }),
        other => {
            tracing::warn!(
                ?other,
                "a fired action named neither an H: event nor a preset"
            );
            None
        }
    }
}

fn flush(named: &mut Vec<NamedEvent>, cx: &Cx) {
    if named.is_empty() {
        return;
    }
    for slot in named_event_slots(named) {
        cx.module().feed(NAMED_EVENTS, &slot);
    }
    named.clear();
}
