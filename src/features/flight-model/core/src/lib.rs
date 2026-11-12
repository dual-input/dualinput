//! Flight-model sync, the feature that makes the aircraft the pilot flying flies move on
//! every other pilot's PC (record/areas/flight-model/01-flight-model-sync.md).
//!
//! On the flying machine, the routine `Lead` reads the aircraft in our WASM module about 20
//! times a second, and this crate sends each read to the crew as a sample. On a following
//! machine, it takes each sample, moves its stamp onto this core's counter, and feeds it to
//! the routine `Follow`, which freezes the aircraft and draws it 400ms behind the samples.
//! Which routine runs follows the session: `Lead` while this pilot holds control and is in
//! the flight, and `Follow` while this pilot is in the flight and another holds control.
//!
//! It loads no profile, so it flies a session whose aircraft has none. The platform ends
//! every feature's routines when a profile unloads, this feature's among them, which happens
//! only as its pilot leaves the flight or the session ends, when this crate ends its routine
//! too: the pilot flying pins the session's profile once, and no pin changes while a pilot
//! stays in the flight (record/areas/profiles/02-units.md, "The pin"). Register it after
//! every crate of the platform.

mod offset;

use std::time::Duration;

use kernel::{Cx, Handle, Registry, TimerId};
use messages::flight_model::slots::{FollowSlot, LeadSlot};
use messages::flight_model::{self as wire, PERIOD, Sample};
use messages::net::PilotId;
use network::{NetUnit, Network, Sender, To};

use session::{ControlPassed, FlightChanged, Session, SessionEnded};
use sim_service::{SimAwareness, SimChanged, SimCx, SimEvent, SimUnit};

use crate::offset::Applied;

/// How far behind the samples `Follow` draws the aircraft, in µs, the delay of FS Copilot's
/// module (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.h`, `k_delay_sec`).
/// Each feed carries it, so a later delay that follows the path changes only this crate.
pub const DELAY: u64 = 400_000;

/// How long the flying sim's pause goes with no report before this core sends the last
/// sample again, in µs. Whether our module's update runs in a pause is unmeasured, and when
/// it does, `Lead` keeps reporting and nothing is sent again.
const QUIET: u64 = 100_000;

/// The feature's state: the routine it runs, and what it keeps for it.
#[derive(Default)]
pub struct FlightModel {
    running: Running,
}

#[derive(Default)]
enum Running {
    #[default]
    Neither,
    /// This pilot flies.
    Lead {
        /// The call whose reports are `Lead`'s.
        reports: Handle,
        /// The stamp of the input that started `Lead`. The report slot keeps its last report
        /// for the whole run of the sim, and a new connection's read of it may hand that one
        /// over, which is unverified, so a report stamped before this is left out. `Lead`
        /// stamps no report of this start earlier, since the routine host's estimate of the
        /// core's counter is at least the counter of the feed that started it.
        started: u64,
        /// The last sample sent, and the stamp of the input its report came in.
        last: Option<(Sample, u64)>,
        /// The timer that sends the last sample again through a pause.
        again: Option<TimerId>,
    },
    /// This pilot follows another.
    Follow(Following),
}

/// What a following core keeps since `Follow` started.
struct Following {
    pf: PilotId,
    /// The newest stamp taken, on the PF's counter.
    newest: u64,
    /// The PF's clock offset as this core applies it, once the network has given one.
    offset: Option<Applied>,
}

impl Following {
    /// What to feed `Follow` for `sample`, which came from `from` at `now`, with the
    /// network's estimate of that sender's clock offset, or `None` to drop it: from a sender
    /// who isn't the PF this core follows, which covers a new PF's samples until the
    /// session's control key arrives; with a stamp no later than the newest taken; or before
    /// the network has an offset for its sender, which lasts until the link's first
    /// heartbeat.
    fn take(
        &mut self,
        from: PilotId,
        sample: &Sample,
        estimate: Option<i64>,
        now: u64,
    ) -> Option<FollowSlot> {
        if from != self.pf || sample.at <= self.newest {
            return None;
        }
        let offset = offset::apply(&mut self.offset, estimate?, now);
        self.newest = sample.at;
        // The stamp moves from the PF's counter onto this core's, the one `Follow` draws on.
        Some(FollowSlot {
            delay: DELAY,
            has_sample: 1,
            sample: Sample {
                at: sample.at.saturating_add_signed(-offset),
                snapshot: sample.snapshot,
            },
        })
    }
}

/// Which routine the session calls for.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Wanted {
    Neither,
    Lead,
    Follow(PilotId),
}

/// Registers flight-model sync.
pub fn register(r: &mut Registry) {
    r.unit::<FlightModel>("flight-model")
        .channel(wire::SAMPLES, FlightModel::on_sample)
        .on_sim(FlightModel::on_sim)
        .on::<FlightChanged>(|me, _, cx| me.settle(cx))
        .on::<ControlPassed>(|me, _, cx| me.settle(cx))
        .on::<SessionEnded>(|me, _, cx| me.settle(cx))
        .on::<SimChanged>(FlightModel::sim_changed);
}

impl FlightModel {
    /// Ends the routine this core runs and starts the one the session calls for, when the two
    /// differ. A change of PF on a machine that goes on following differs too, so `Follow`
    /// starts new, with a new buffer for the new PF's samples.
    fn settle(&mut self, cx: &mut Cx) {
        let session = cx.read::<Session>();
        let wanted = match (session.me(), session.pf()) {
            (Some(me), Some(pf)) if session.in_flight(&me) => {
                if pf == me {
                    Wanted::Lead
                } else {
                    Wanted::Follow(pf)
                }
            }
            _ => Wanted::Neither,
        };
        let now = match &self.running {
            Running::Neither => Wanted::Neither,
            Running::Lead { .. } => Wanted::Lead,
            Running::Follow(following) => Wanted::Follow(following.pf),
        };
        if wanted == now {
            return;
        }
        match std::mem::take(&mut self.running) {
            Running::Neither => {}
            Running::Lead { again, .. } => {
                if let Some(timer) = again {
                    cx.cancel_timer(timer);
                }
                cx.module().end(wire::LEAD);
            }
            Running::Follow(_) => cx.module().end(wire::FOLLOW),
        }
        match wanted {
            Wanted::Neither => tracing::info!("flight-model sync runs no routine"),
            Wanted::Lead => {
                tracing::info!("this pilot flies, so flight-model sync starts Lead");
                self.running = Running::Lead {
                    reports: start_lead(cx),
                    started: cx.now(),
                    last: None,
                    again: None,
                };
                self.through_a_pause(cx);
            }
            Wanted::Follow(pf) => {
                tracing::info!(
                    pf = messages::hex(&pf),
                    "another pilot flies, so flight-model sync starts Follow"
                );
                start_follow(cx);
                self.running = Running::Follow(Following {
                    pf,
                    newest: 0,
                    offset: None,
                });
            }
        }
    }

    fn on_sim(me: &mut FlightModel, event: SimEvent, cx: &mut Cx) {
        let SimEvent::Report { call, bytes } = event else {
            return;
        };
        let Running::Lead {
            reports,
            started,
            last,
            ..
        } = &mut me.running
        else {
            return;
        };
        if call != *reports || bytes.len() != size_of::<Sample>() {
            return;
        }
        let sample: Sample = bytemuck::pod_read_unaligned(&bytes);
        if sample.at < *started {
            return;
        }
        *last = Some((sample, cx.now()));
        network::send_one_off(cx, wire::SAMPLES, To::Crew, &sample);
    }

    /// The flying sim paused or went on, which starts or stops the samples sent again.
    fn sim_changed(me: &mut FlightModel, _: &SimChanged, cx: &mut Cx) {
        me.through_a_pause(cx);
    }

    /// While the flying sim is paused, a timer sends the last sample again every 50ms, so a
    /// following machine draws the aircraft standing still rather than carrying it on.
    fn through_a_pause(&mut self, cx: &mut Cx) {
        let paused = cx.read::<SimAwareness>().pause != 0;
        let Running::Lead { again, .. } = &mut self.running else {
            return;
        };
        match (paused, *again) {
            (true, None) => {
                *again = Some(cx.timer(Duration::from_micros(PERIOD), FlightModel::again));
            }
            (false, Some(timer)) => {
                cx.cancel_timer(timer);
                *again = None;
            }
            _ => {}
        }
    }

    /// Sends the last sample again, once no report has come for `QUIET`, stamped one period
    /// after the one before, so its stamps stay behind the first report after the pause.
    fn again(me: &mut FlightModel, timer: TimerId, cx: &mut Cx) {
        let Running::Lead { last, again, .. } = &mut me.running else {
            return;
        };
        if *again != Some(timer) {
            return;
        }
        *again = Some(cx.timer(Duration::from_micros(PERIOD), FlightModel::again));
        let Some((sample, reported)) = last else {
            return;
        };
        if cx.now().saturating_sub(*reported) < QUIET {
            return;
        }
        sample.at += PERIOD;
        network::send_one_off(cx, wire::SAMPLES, To::Crew, sample);
    }

    /// A sample from another core, which is dropped while this core doesn't run `Follow`, so
    /// a pilot out of the flight never has an aircraft frozen and moved.
    fn on_sample(me: &mut FlightModel, from: Sender, sample: Sample, cx: &mut Cx) {
        let Running::Follow(following) = &mut me.running else {
            return;
        };
        let estimate = cx.read::<Network>().offset(from);
        if let Some(slot) = following.take(from.pilot, &sample, estimate, cx.now()) {
            cx.module().feed(wire::FOLLOW, &slot);
        }
    }
}

/// Feeds `Lead` and asks for its reports, which a second call moves to the new handle.
fn start_lead(cx: &Cx) -> Handle {
    let reports = cx.module().reports::<Sample>(wire::LEAD);
    cx.module().feed(wire::LEAD, &LeadSlot {});
    reports
}

/// Feeds `Follow` with no sample, so the aircraft freezes before the first one arrives.
fn start_follow(cx: &Cx) {
    let slot = FollowSlot {
        delay: DELAY,
        ..FollowSlot::default()
    };
    cx.module().feed(wire::FOLLOW, &slot);
}

#[cfg(test)]
mod tests {
    use super::*;

    const PF: PilotId = [1; 16];

    fn following() -> Following {
        Following {
            pf: PF,
            newest: 0,
            offset: None,
        }
    }

    fn sample(at: u64) -> Sample {
        Sample {
            at,
            ..Sample::default()
        }
    }

    /// Flight-model sync's case: a sample from a sender who isn't the PF, from a new PF
    /// before the key, with an old stamp, or before the link's first offset is dropped.
    #[test]
    fn a_sample_is_dropped_from_another_sender_with_an_old_stamp_or_before_an_offset() {
        let mut f = following();
        // Before the link's first heartbeat, the network has no offset for the PF.
        assert_eq!(f.take(PF, &sample(1_000_000), None, 500), None);
        // A new PF's samples, until the control key makes it the PF this core follows.
        assert_eq!(f.take([2; 16], &sample(1_000_000), Some(0), 500), None);
        assert!(f.take(PF, &sample(1_000_000), Some(0), 500).is_some());
        assert_eq!(f.take(PF, &sample(1_000_000), Some(0), 600), None);
        assert_eq!(f.take(PF, &sample(999_999), Some(0), 700), None);
        assert!(f.take(PF, &sample(1_050_000), Some(0), 800).is_some());
    }

    #[test]
    fn a_samples_stamp_moves_onto_this_cores_counter_with_the_delay() {
        let mut f = following();
        // The PF's counter runs 2s ahead of this core's.
        let slot = f.take(PF, &sample(10_000_000), Some(2_000_000), 0).unwrap();
        assert_eq!((slot.delay, slot.has_sample), (DELAY, 1));
        assert_eq!(slot.sample.at, 8_000_000);
        // And 3s behind: the first estimate since `Follow` started is taken at once.
        let mut f = following();
        let slot = f
            .take(PF, &sample(10_000_000), Some(-3_000_000), 0)
            .unwrap();
        assert_eq!(slot.sample.at, 13_000_000);
    }
}
