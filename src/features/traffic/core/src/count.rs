//! The count of aircraft in this sim that aren't the traffic host's: the sim's own AI traffic,
//! or an injector running on this machine, which a receiving pilot turns off, since Dual
//! Input hides no other source's traffic (record/areas/traffic-atc/01-traffic-and-atc.md,
//! "Notifications"). The Traffic tab shows it, and the dot on its icon flags it
//! (record/areas/interface/decisions.md, "The Traffic and ATC audio tabs hold their sharing,
//! settings, and warnings").

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use kernel::{Cx, Handle, TimerId};
use sim_service::{SimCx, Value, Var};
use simconnect_types::{SIMCONNECT_SIMOBJECT_TYPE_AIRCRAFT, SIMCONNECT_SIMOBJECT_TYPE_HELICOPTER};

use crate::host::AIRCRAFT_RADIUS;

/// How often a receiving machine counts, as FS Copilot's receiver did (read in the FS Copilot
/// fork, `FsCopilot/Simulation/TrafficReceiver.cs`, `ForeignPoll`).
pub(crate) const EVERY: Duration = Duration::from_secs(10);

#[derive(Default)]
pub(crate) struct Counting {
    timer: Option<TimerId>,
    /// Each kind's call of the count out, and whether its last answer has come.
    calls: BTreeMap<Handle, bool>,
    found: u32,
    /// The last whole count.
    last: Option<u32>,
    /// What the tab shows: the count, once two in a row have found some, since a copy whose
    /// create answers after the count's answer counts once as not ours.
    pub(crate) others: u32,
}

impl Counting {
    /// Counts every 10s while `on`, and shows nothing while off.
    pub(crate) fn settle(&mut self, on: bool, cx: &Cx) {
        match (on, self.timer) {
            (true, None) => self.timer = Some(cx.timer(EVERY, crate::Traffic::count_tick)),
            (false, Some(timer)) => {
                cx.cancel_timer(timer);
                *self = Counting::default();
            }
            _ => {}
        }
    }

    pub(crate) fn tick(&mut self, timer: TimerId, cx: &Cx) {
        if self.timer != Some(timer) {
            return;
        }
        self.timer = Some(cx.timer(EVERY, crate::Traffic::count_tick));
        let vars = [Var::number("A:IS USER SIM", "bool")];
        let sim = cx.sim();
        self.calls = [
            SIMCONNECT_SIMOBJECT_TYPE_AIRCRAFT,
            SIMCONNECT_SIMOBJECT_TYPE_HELICOPTER,
        ]
        .map(|kind| (sim.poll(kind, AIRCRAFT_RADIUS, &vars), false))
        .into_iter()
        .collect();
        self.found = 0;
    }

    /// One aircraft or helicopter the count found: neither this pilot's nor a copy, among
    /// `own`, counts. Returns whether the call was the count's.
    pub(crate) fn polled(
        &mut self,
        call: Handle,
        object: u32,
        values: &[(usize, Value)],
        (entry, out_of): (u32, u32),
        own: &BTreeSet<u32>,
    ) -> bool {
        let Some(done) = self.calls.get_mut(&call) else {
            return false;
        };
        let user = values
            .iter()
            .any(|(_, v)| matches!(v, Value::Number(n) if *n != 0.0));
        if out_of > 0 && !user && !own.contains(&object) {
            self.found += 1;
        }
        if entry >= out_of {
            *done = true;
        }
        if self.calls.values().all(|done| *done) {
            self.calls.clear();
            let before = self.last.replace(self.found);
            if self.found == 0 {
                self.others = 0;
            } else if before.is_some_and(|n| n > 0) {
                if self.others == 0 {
                    tracing::info!(
                        count = self.found,
                        "aircraft that aren't the traffic host's show in this sim"
                    );
                }
                self.others = self.found;
            }
        }
        true
    }
}
