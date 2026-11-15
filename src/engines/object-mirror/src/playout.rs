//! The playout: where each copy belongs at a time, from the samples that arrived for it. It's
//! FS Copilot's, on a fixed delay that its caller takes off the time, rather than one that
//! follows the samples' spacing (read in the FS Copilot fork,
//! `FsCopilot/Simulation/TrafficInterpolator.cs`, `TryRender`).

use std::collections::{BTreeMap, VecDeque};

/// A pose, as the playout draws one between two samples.
pub trait Pose: Copy + PartialEq {
    /// The pose `share` of the way from `self` to `next`: along the line between them, each
    /// angle turned the short way round, and past 1 carried on along that line.
    fn between(&self, next: &Self, share: f64) -> Self;
}

/// How long a copy is carried on past its newest sample at most, along the line through its
/// last two, in the time unit `push` takes, here µs: one lost batch is bridged with no pause,
/// two in a row show.
const CARRY: u64 = 600_000;

/// How many samples a copy keeps. A copy drawn 1s behind 2Hz samples needs three, so more
/// fill up only when its samples' times run far ahead of what's drawn.
const KEPT: usize = 16;

struct Track<P> {
    /// Oldest first, each with its time.
    samples: VecDeque<(u64, P)>,
    /// What the last call drew, so a pose that hasn't changed isn't drawn again.
    drawn: Option<P>,
}

/// Every copy's recent samples.
pub struct Playout<P> {
    tracks: BTreeMap<u32, Track<P>>,
}

impl<P> Default for Playout<P> {
    fn default() -> Self {
        Playout {
            tracks: BTreeMap::new(),
        }
    }
}

impl<P: Pose> Playout<P> {
    /// Takes `pose`, read at `at`, for `object`. A sample at or before the newest is dropped,
    /// so the stop a sender repeats costs nothing, and `push` says so with `false`.
    pub fn push(&mut self, object: u32, at: u64, pose: P) -> bool {
        let track = self.tracks.entry(object).or_insert_with(|| Track {
            samples: VecDeque::new(),
            drawn: None,
        });
        if track.samples.back().is_some_and(|(t, _)| *t >= at) {
            return false;
        }
        if track.samples.len() == KEPT {
            track.samples.pop_front();
        }
        track.samples.push_back((at, pose));
        true
    }

    /// `object`'s pose at `t`, or `None` when it's the pose this gave last time, as a parked
    /// copy's is, or `object` has no sample.
    pub fn at(&mut self, object: u32, t: u64) -> Option<P> {
        let track = self.tracks.get_mut(&object)?;
        let pose = place(&mut track.samples, t)?;
        if track.drawn == Some(pose) {
            return None;
        }
        track.drawn = Some(pose);
        Some(pose)
    }

    /// Calls `f` with each copy whose pose at `t` differs from the last one it was given.
    pub fn each(&mut self, t: u64, mut f: impl FnMut(u32, P)) {
        for (&object, track) in &mut self.tracks {
            let Some(pose) = place(&mut track.samples, t) else {
                continue;
            };
            if track.drawn != Some(pose) {
                track.drawn = Some(pose);
                f(object, pose);
            }
        }
    }

    pub fn remove(&mut self, object: u32) {
        self.tracks.remove(&object);
    }

    pub fn is_empty(&self) -> bool {
        self.tracks.is_empty()
    }
}

/// Where the samples put their copy at `t`: between the two around it; past the newest, carried
/// along the line through the last two for as long as the gap between them, up to `CARRY`, then
/// held; and before the oldest, held at it. Drops each sample no later time needs.
fn place<P: Pose>(samples: &mut VecDeque<(u64, P)>, t: u64) -> Option<P> {
    while samples.len() > 2 && samples.get(1).is_some_and(|(at, _)| *at <= t) {
        samples.pop_front();
    }
    let &(a_at, a) = samples.front()?;
    let Some(&(b_at, b)) = samples.get(1) else {
        return Some(a);
    };
    // A parked copy's samples are alike, its heartbeats' among them, so it takes none of
    // `between`'s arithmetic, which every copy would otherwise pay every frame.
    if t <= a_at || a == b {
        return Some(a);
    }
    let gap = b_at - a_at;
    let past = t.saturating_sub(a_at).min(gap + gap.min(CARRY));
    Some(a.between(&b, past as f64 / gap as f64))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Copy, Debug, PartialEq)]
    struct X(f64);

    impl Pose for X {
        fn between(&self, next: &X, share: f64) -> X {
            X(self.0 + (next.0 - self.0) * share)
        }
    }

    const MS: u64 = 1_000;

    /// Traffic and ATC's case: drawing samples 500ms apart has no hold at a sample's end, a copy
    /// past its newest sample is carried 500ms, then held, and a parked copy isn't written.
    #[test]
    fn samples_500ms_apart_draw_with_no_hold_carry_500ms_and_a_parked_copy_isnt_drawn() {
        let mut playout = Playout::default();
        // A copy moving 1 a second, sampled every 500ms, drawn 1s behind, a frame each 10ms.
        let mut drawn = Vec::new();
        for frame in 0..400u64 {
            let now = frame * 10 * MS;
            if now.is_multiple_of(500 * MS) {
                playout.push(7, now, X(now as f64 / 1e6));
            }
            if let Some(x) = playout.at(7, now.saturating_sub(1_000 * MS)) {
                drawn.push((now, x.0));
            }
        }
        // From 1s on, it moves the same 0.01 every frame, across each sample's end alike.
        let steps: Vec<f64> = drawn
            .windows(2)
            .filter(|w| w[0].0 >= 1_000 * MS)
            .map(|w| w[1].1 - w[0].1)
            .collect();
        assert!(steps.iter().all(|s| (s - 0.01).abs() < 1e-9), "{steps:?}");

        // The samples stop at 3.5s: drawn 1s behind, the copy is carried to 4.0, then held.
        let mut last = None;
        for frame in 400..700u64 {
            let now = frame * 10 * MS;
            if let Some(x) = playout.at(7, now - 1_000 * MS) {
                last = Some((now, x.0));
            }
        }
        let (when, x) = last.unwrap();
        assert!((x - 4.0).abs() < 1e-9, "carried to {x}");
        assert_eq!(
            when,
            5_000 * MS,
            "and held from then, with nothing drawn again"
        );
    }

    #[test]
    fn a_sample_at_or_before_the_newest_is_dropped() {
        let mut playout = Playout::default();
        assert!(playout.push(1, 1_000, X(1.0)));
        assert!(!playout.push(1, 1_000, X(2.0)));
        assert!(!playout.push(1, 900, X(2.0)));
        assert_eq!(playout.at(1, 5_000), Some(X(1.0)));
        assert_eq!(
            playout.at(1, 6_000),
            None,
            "the same pose again isn't drawn"
        );
    }

    #[test]
    fn each_draws_only_the_copies_that_moved() {
        let mut playout = Playout::default();
        playout.push(1, 0, X(0.0));
        playout.push(1, 500 * MS, X(1.0));
        playout.push(2, 0, X(5.0));
        let mut seen = Vec::new();
        playout.each(250 * MS, |object, x| seen.push((object, x.0)));
        assert_eq!(seen, [(1, 0.5), (2, 5.0)]);
        seen.clear();
        playout.each(260 * MS, |object, x| seen.push((object, x.0)));
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].0, 1);
        playout.remove(1);
        playout.remove(2);
        assert!(playout.is_empty());
    }
}
