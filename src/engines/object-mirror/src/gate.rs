//! The gate: which of an object's samples a sending machine sends. At a busy gate in FS
//! Copilot's captures it passed about a fifth of them, since a parked aircraft's samples are all
//! alike (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "The change gate"). It
//! carries FS Copilot's rules (read in the FS Copilot fork, `FsCopilot/Simulation/TrafficGate.cs`,
//! `Decide`), and the sample decides what counts as a change.

use std::collections::BTreeMap;

/// A sample of one object, as the gate compares them.
pub trait Sample: Clone {
    /// Whether `self` differs from `sent`, the last sample that went out, by enough to go out
    /// itself.
    fn changed(&self, sent: &Self) -> bool;
}

/// How many polls after it the sample that ends a run of motion goes out again, each time with
/// that poll's time. A playout carries a copy past its newest sample along the line through its
/// last two, so a stop that stayed the newest sample would leave its copy carried past where it
/// stopped until the next heartbeat, lost or not. A repeat at a later time gives the copy a
/// segment that stands still, and one that comes after a lost stop brings the copy to it a poll
/// late. FS Copilot repeated the stop at the stop's own time, and a receiving machine that
/// already held it dropped each repeat as no newer (record/areas/traffic-atc/log.md,
/// 2026-11-15).
const REPEATS: u32 = 2;

/// What the gate keeps of one object.
struct Kept<S> {
    sent: S,
    sent_at: u64,
    /// The newest sample held back since the last one sent.
    held: Option<(S, u64)>,
    /// How many more polls send the last sample again.
    repeats: u32,
    /// Whether the next sample goes out whatever it holds.
    due: bool,
}

/// The gate's state for every object a sender tracks.
pub struct Gate<S> {
    objects: BTreeMap<u32, Kept<S>>,
    /// How long a sample may go unsent, in the time unit `decide` takes.
    heartbeat: u64,
}

/// What one sample lets out: nothing, it, the held sample and it, or the stop again, each with
/// the time it was read, oldest first.
pub struct Sends<S>([Option<(S, u64)>; 2]);

impl<S> Iterator for Sends<S> {
    type Item = (S, u64);

    fn next(&mut self) -> Option<(S, u64)> {
        let [first, second] = &mut self.0;
        first.take().or_else(|| second.take())
    }
}

impl<S: Sample> Gate<S> {
    /// A gate that sends every object's sample at least once each `heartbeat`, which keeps a
    /// parked aircraft's copy alive on a receiving machine that removes one after 3 heartbeats.
    pub fn new(heartbeat: u64) -> Gate<S> {
        Gate {
            objects: BTreeMap::new(),
            heartbeat,
        }
    }

    /// Which samples go out, now that `object` was read as `sample` at `at`:
    ///
    /// - its first sample;
    /// - a sample past the thresholds `Sample::changed` sets, after the last one held back, with
    ///   its own time, so a receiving machine doesn't spread the first step of a motion across
    ///   the quiet before it;
    /// - a sample once `heartbeat` has passed since the last one sent;
    /// - and on the next two polls after a change, the last one sent again, at `at`, so its copy
    ///   holds where it stopped.
    pub fn decide(&mut self, object: u32, sample: S, at: u64) -> Sends<S> {
        let Some(kept) = self.objects.get_mut(&object) else {
            self.objects.insert(
                object,
                Kept {
                    sent: sample.clone(),
                    sent_at: at,
                    held: None,
                    repeats: REPEATS,
                    due: false,
                },
            );
            return Sends([Some((sample, at)), None]);
        };
        let changed = sample.changed(&kept.sent);
        let beat = kept.due || at.saturating_sub(kept.sent_at) >= self.heartbeat;
        if !changed && !beat {
            kept.held = Some((sample, at));
            if kept.repeats == 0 {
                return Sends([None, None]);
            }
            kept.repeats -= 1;
            return Sends([Some((kept.sent.clone(), at)), None]);
        }
        let held = kept
            .held
            .take()
            .filter(|(_, held_at)| changed && *held_at > kept.sent_at);
        kept.sent = sample.clone();
        kept.sent_at = at;
        kept.repeats = if changed { REPEATS } else { 0 };
        kept.due = false;
        Sends([held, Some((sample, at))])
    }

    /// Every object's next sample goes out, as a member that joined or came back needs.
    pub fn heartbeat_all(&mut self) {
        for kept in self.objects.values_mut() {
            kept.due = true;
        }
    }

    pub fn forget(&mut self, object: u32) {
        self.objects.remove(&object);
    }

    pub fn clear(&mut self) {
        self.objects.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A position on a line, which changes past 0.1.
    #[derive(Clone, Copy, Debug, PartialEq)]
    struct At(f64);

    impl Sample for At {
        fn changed(&self, sent: &At) -> bool {
            (self.0 - sent.0).abs() > 0.1
        }
    }

    const POLL: u64 = 500;
    const BEAT: u64 = 5_000;

    fn sent(gate: &mut Gate<At>, at: u64, x: f64) -> Vec<(f64, u64)> {
        gate.decide(1, At(x), at).map(|(s, t)| (s.0, t)).collect()
    }

    /// Traffic and ATC's case: a parked aircraft's state goes out every 5s.
    #[test]
    fn a_parked_objects_sample_goes_out_first_and_then_every_heartbeat() {
        let mut gate = Gate::new(BEAT);
        let mut out = Vec::new();
        for poll in 0..=30u64 {
            out.extend(sent(&mut gate, poll * POLL, 0.0));
        }
        // The first, and its two repeats, then one each 5s, with no repeats after a heartbeat.
        let times: Vec<u64> = out.iter().map(|(_, t)| *t).collect();
        assert_eq!(times, [0, 500, 1_000, 5_000, 10_000, 15_000]);
    }

    /// Traffic and ATC's case: an aircraft that starts to move sends its held sample first, then
    /// each poll's; its stop goes out on three polls.
    #[test]
    fn a_start_sends_the_held_sample_first_and_a_stop_goes_out_three_times() {
        let mut gate = Gate::new(BEAT);
        for poll in 0..6u64 {
            sent(&mut gate, poll * POLL, 0.0);
        }
        // It moves at the seventh poll: the sixth, held back, goes first with its own time.
        assert_eq!(sent(&mut gate, 3_000, 1.0), [(0.0, 2_500), (1.0, 3_000)]);
        assert_eq!(sent(&mut gate, 3_500, 2.0), [(2.0, 3_500)]);
        // It stops at 2.0: that sample goes out again on the next two polls, at theirs, then nothing.
        let after: Vec<_> = (8..12u64)
            .flat_map(|poll| sent(&mut gate, poll * POLL, 2.0))
            .collect();
        assert_eq!(after, [(2.0, 4_000), (2.0, 4_500)]);
    }

    #[test]
    fn heartbeat_all_sends_every_objects_next_sample() {
        let mut gate = Gate::new(BEAT);
        for poll in 0..4u64 {
            sent(&mut gate, poll * POLL, 0.0);
        }
        assert!(sent(&mut gate, 2_000, 0.0).is_empty());
        gate.heartbeat_all();
        assert_eq!(sent(&mut gate, 2_500, 0.0), [(0.0, 2_500)]);
        assert!(sent(&mut gate, 3_000, 0.0).is_empty());
        // A forgotten object's next sample is its first again.
        gate.forget(1);
        assert_eq!(sent(&mut gate, 3_500, 0.0), [(0.0, 3_500)]);
    }
}
