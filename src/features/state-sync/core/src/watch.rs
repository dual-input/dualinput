//! The engine's watches as sim variables takes them, and what each got as the engine's input.

use kernel::Cx;
use profile_engine::Name;
use sim_variables::{Got, Reads, Watch};
use sync_engine::{Seen, Watching};

use crate::Live;

/// The engine's watches, in its order. A pulse is an `L:` variable's value, whose every rise
/// from 0 the engine counts as one occurrence.
pub(crate) fn watches(watches: &[sync_engine::Watch]) -> Vec<Watch> {
    watches
        .iter()
        .map(|w| Watch {
            name: w.name.clone(),
            reads: match w.watching {
                Watching::Occurrence => Reads::Occurrences,
                Watching::Value | Watching::Pulse => Reads::Value,
            },
        })
        .collect()
}

impl Live {
    /// What the watch at `place` got, as the engine's input.
    pub(crate) fn seen(&mut self, place: usize, got: Got, cx: &Cx) -> Seen {
        match got {
            Got::Read(value) => Seen::Value {
                watch: place,
                value,
            },
            Got::Fired(value) => Seen::Fired {
                watch: place,
                value,
            },
            Got::Failed(error) => {
                let instrument = self
                    .engine
                    .watches()
                    .get(place)
                    .is_some_and(|w| matches!(w.name, Name::Instrument { .. }));
                if instrument {
                    self.path_failed(place, &error, cx);
                }
                Seen::Refused { watch: place }
            }
        }
    }
}
