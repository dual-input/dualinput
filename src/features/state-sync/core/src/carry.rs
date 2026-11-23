//! Carrying out what the engine asks for: its actions through sim variables, and the rest on the
//! cockpit stream and in the pilot's notifications.

use cockpit_stream::CockpitCx;
use kernel::Cx;
use messages::state_sync::{CHANGE, FIRED, PF_CHANGE, STATE};
use sim_variables::VariablesCx;
use sync_engine::{Action, ChangeKind, Flagged, Out, Why};

use crate::Live;

impl Live {
    /// Carries out `outs` in the order they came, each run of actions in one call to sim
    /// variables, which keeps a write function's call order within it.
    pub(crate) fn carry_out(&mut self, outs: Vec<Out>, cx: &Cx) {
        let mut acts = Vec::new();
        for out in outs {
            match out {
                Out::Act(action) => acts.push(action_of(action)),
                other => {
                    if !acts.is_empty() {
                        cx.variables().act(std::mem::take(&mut acts));
                    }
                    self.apply_out(other, cx);
                }
            }
        }
        if !acts.is_empty() {
            cx.variables().act(acts);
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

fn action_of(action: Action) -> sim_variables::Action {
    match action {
        Action::Set { name, value } => sim_variables::Action::Set { name, value },
        Action::Key { name, values } => sim_variables::Action::Key { name, values },
        Action::Fire { name } => sim_variables::Action::Fire { name },
    }
}
