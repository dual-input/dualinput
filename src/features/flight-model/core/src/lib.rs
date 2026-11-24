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
//! The profile extension's recorder, the platform unit `tape`, replays the aircraft's path through
//! the same routines, so control stays with the author. While a recording runs, this crate hands
//! `tape` each sample it sends, and while a playback runs, it runs `Follow` in place of `Lead`,
//! fed the recording's samples (record/areas/profiles/05-the-recorder.md, "Flying the recorded
//! path").
//!
//! It loads no profile, so it flies a session whose aircraft has none, and its routines run on
//! through a profile's unload, as a test session's reload in flight makes one, since only a unit
//! marked `ends_with_profile` has its routines ended there (record/areas/architecture/log.md,
//! 2026-11-21). Register it after every crate of the platform.

use std::time::Duration;

use kernel::{Cx, Handle, Registry, TimerId};
use messages::flight_model::slots::{FollowSlot, LeadSlot};
use messages::flight_model::{self as wire, PERIOD, Sample};
use messages::net::PilotId;
use network::{NetUnit, Network, Sender, Slewed, To};

use session::{ControlPassed, FlightChanged, Session, SessionEnded};
use sim_service::{SimAwareness, SimChanged, SimCx, SimEvent, SimUnit};
use tape::{PlaybackChanged, Played, Tape, TapeCx, TapeUnit};

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
    /// A recording plays back, and `Follow` draws its samples.
    Replay,
}

/// What a following core keeps since `Follow` started.
struct Following {
    pf: PilotId,
    /// The newest stamp taken, on the pilot flying's counter.
    newest: u64,
    /// The pilot flying's clock offset as this core applies it, once the network has given one.
    offset: Slewed,
}

impl Following {
    /// What to feed `Follow` for `sample`, which came from `from` at `now`, with the
    /// network's estimate of that sender's clock offset, or `None` to drop it: from a sender
    /// who isn't the pilot flying this core follows, which covers a new pilot flying's samples
    /// until the session's control key arrives; with a stamp no later than the newest taken; or
    /// before the network has an offset for its sender, which lasts until the link's first
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
        let offset = self.offset.apply(estimate?, now);
        self.newest = sample.at;
        // The stamp moves from the pilot flying's counter onto this core's, the one `Follow`
        // draws on.
        Some(fed(Sample {
            at: sample.at.saturating_add_signed(-offset),
            snapshot: sample.snapshot,
        }))
    }
}

/// Which routine the session calls for.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Wanted {
    Neither,
    Lead,
    Follow(PilotId),
    Replay,
}

/// Registers flight-model sync, after `tape`, which its samples register with.
pub fn register(r: &mut Registry) {
    r.unit::<FlightModel>("flight-model")
        .channel(wire::SAMPLES, FlightModel::on_sample)
        .taped(wire::SAMPLES, FlightModel::played)
        .on_sim(FlightModel::on_sim)
        .on::<FlightChanged>(|me, _, cx| me.settle(cx))
        .on::<ControlPassed>(|me, _, cx| me.settle(cx))
        .on::<SessionEnded>(|me, _, cx| me.settle(cx))
        .on::<PlaybackChanged>(|me, _, cx| me.settle(cx))
        .on::<SimChanged>(FlightModel::sim_changed);
}

impl FlightModel {
    /// Ends the routine this core runs and starts the one the session and the recorder call for,
    /// when the two differ. A change of pilot flying on a machine that goes on following differs
    /// too, so `Follow` starts new, with a new buffer for the new pilot flying's samples. A
    /// playback runs only alone, while this pilot holds control, and `Follow` takes the
    /// recording's samples in place of `Lead`.
    fn settle(&mut self, cx: &mut Cx) {
        let session = cx.read::<Session>();
        let playing = cx.read::<Tape>().playing();
        let wanted = match (session.me(), session.pf()) {
            (Some(me), Some(pf)) if session.in_flight(&me) => {
                if playing {
                    Wanted::Replay
                } else if pf == me {
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
            Running::Replay => Wanted::Replay,
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
            Running::Follow(_) | Running::Replay => cx.module().end(wire::FOLLOW),
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
                start_follow(cx, None);
                self.running = Running::Follow(Following {
                    pf,
                    newest: 0,
                    offset: Slewed::default(),
                });
            }
            Wanted::Replay => {
                tracing::info!("a recording plays back, so flight-model sync starts Follow on it");
                let first = cx.read::<Tape>().first(wire::SAMPLES);
                start_follow(cx, first.map(|first| put_back(first, cx.now())));
                self.running = Running::Replay;
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
        send(cx, &sample);
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
        send(cx, sample);
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

    /// A sample of the recording at its time in a playback, which `Follow` draws.
    fn played(me: &mut FlightModel, played: Played<Sample>, cx: &mut Cx) {
        if matches!(me.running, Running::Replay) {
            cx.module().feed(wire::FOLLOW, &fed(replayed(played)));
        }
    }
}

/// Sends a sample to the crew, and hands it to the recorder, which keeps it while a recording
/// runs.
fn send(cx: &Cx, sample: &Sample) {
    network::send_one_off(cx, wire::SAMPLES, To::Crew, sample);
    cx.tape().take(wire::SAMPLES, sample);
}

/// Feeds `Lead` and asks for its reports, which a second call moves to the new handle.
fn start_lead(cx: &Cx) -> Handle {
    let reports = cx.module().reports::<Sample>(wire::LEAD);
    cx.module().feed(wire::LEAD, &LeadSlot {});
    reports
}

/// Feeds `Follow` the sample to start on, or none, so the aircraft freezes before the first one
/// arrives.
fn start_follow(cx: &Cx, sample: Option<Sample>) {
    let slot = sample.map_or(
        FollowSlot {
            delay: DELAY,
            ..FollowSlot::default()
        },
        fed,
    );
    cx.module().feed(wire::FOLLOW, &slot);
}

/// `Follow`'s feed of one sample.
fn fed(sample: Sample) -> FollowSlot {
    FollowSlot {
        delay: DELAY,
        has_sample: 1,
        sample,
    }
}

/// The recording's first sample, which puts the aircraft back where it stood at Record as `Follow`
/// starts on it at `now`. The first frame that places the aircraft writes a sample old enough to
/// draw at once, however far the aircraft stands from it, since no frame has written a pose to
/// ease from. That frame's time is at least `now`, often exactly, since the feed's header carries
/// `now`, and `Follow` draws only from a sample strictly older than its time less the delay, so
/// the stamp goes a period further back than the delay.
fn put_back(first: Sample, now: u64) -> Sample {
    Sample {
        at: now.saturating_sub(DELAY + PERIOD),
        ..first
    }
}

/// A recorded sample on the playback's timeline: it came from this core, so its stamp is on this
/// core's counter already, and moves on by how far the playback lies after the recording, with no
/// clock offset.
fn replayed(played: Played<Sample>) -> Sample {
    Sample {
        at: played.body.at.saturating_add(played.shift),
        ..played.body
    }
}

#[cfg(test)]
mod tests {
    use messages::flight_model::Snapshot;

    use super::*;

    const PF: PilotId = [1; 16];

    fn following() -> Following {
        Following {
            pf: PF,
            newest: 0,
            offset: Slewed::default(),
        }
    }

    fn sample(at: u64) -> Sample {
        Sample {
            at,
            ..Sample::default()
        }
    }

    /// Flight-model sync's case: a sample from a sender who isn't the pilot flying, from a new
    /// pilot flying before the key, with an old stamp, or before the link's first offset is
    /// dropped.
    #[test]
    fn a_sample_is_dropped_from_another_sender_with_an_old_stamp_or_before_an_offset() {
        let mut f = following();
        // Before the link's first heartbeat, the network has no offset for the pilot flying.
        assert_eq!(f.take(PF, &sample(1_000_000), None, 500), None);
        // A new pilot flying's samples, until the control key makes it the one this core
        // follows.
        assert_eq!(f.take([2; 16], &sample(1_000_000), Some(0), 500), None);
        assert!(f.take(PF, &sample(1_000_000), Some(0), 500).is_some());
        assert_eq!(f.take(PF, &sample(1_000_000), Some(0), 600), None);
        assert_eq!(f.take(PF, &sample(999_999), Some(0), 700), None);
        assert!(f.take(PF, &sample(1_050_000), Some(0), 800).is_some());
    }

    #[test]
    fn a_samples_stamp_moves_onto_this_cores_counter_with_the_delay() {
        let mut f = following();
        // The pilot flying's counter runs 2s ahead of this core's.
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

    /// The recorder's case: a played sample's stamp moves on by the playback's shift, and the
    /// first sample is stamped a delay and a period before Play, so `Follow`'s first frame finds
    /// it old enough to draw (record/areas/profiles/05-the-recorder.md, "Cases").
    #[test]
    fn a_played_sample_moves_by_the_shift_and_the_first_is_old_enough_to_draw_at_play() {
        let recorded = Sample {
            at: 5_000_000,
            snapshot: Snapshot {
                lat: 0.8,
                ..Snapshot::default()
            },
        };
        // The playback's messages started 60s after Record.
        let played = replayed(Played {
            body: recorded,
            shift: 60_000_000,
        });
        assert_eq!(played.at, 65_000_000);
        assert_eq!(played.snapshot, recorded.snapshot);
        // Play pressed at 64s: `Follow` draws 400ms behind, and the stamp is 50ms further back.
        let first = put_back(recorded, 64_000_000);
        assert_eq!(first.at, 63_550_000);
        assert_eq!(first.snapshot, recorded.snapshot);
        assert!(first.at < 64_000_000 - DELAY);
    }
}
