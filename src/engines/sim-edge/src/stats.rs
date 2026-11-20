//! The edge's wake-ups in the run's log, once a minute, so a session in the sim reads two
//! things there: whether the edge puts a message on the queue within 1ms of SimConnect
//! signaling it, at p99, and whether a connection's event, rather than the 2ms timeout,
//! wakes the edge (record/areas/core/03-sim-seam-and-wasm-module.md, "Cases for the bench").

use std::time::{Duration, Instant};

/// How often the minute's line goes out, while the edge wakes; with no connection open it
/// waits on calls and the sim's process alone, and writes its line at the next wake.
const MINUTE: Duration = Duration::from_secs(60);

/// What ended one of the edge's waits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Woke {
    /// A connection's event.
    Event,
    /// The 2ms timeout, while a connection is open.
    Timeout,
    /// A call, or the sim's process ending.
    Other,
}

pub(crate) struct Stats {
    started: Instant,
    event_wakes: u64,
    timeout_wakes: u64,
    messages: u64,
    timeout_messages: u64,
    /// How long, in µs, from a connection's event waking the edge to each message that wake
    /// found being handed up. A message a timeout or a call woke the edge for came in at a
    /// time the edge can't see, so this leaves it out.
    event_to_up: Histogram,
}

impl Stats {
    pub(crate) fn new() -> Stats {
        Stats {
            started: Instant::now(),
            event_wakes: 0,
            timeout_wakes: 0,
            messages: 0,
            timeout_messages: 0,
            event_to_up: Histogram::new(),
        }
    }

    pub(crate) fn woke(&mut self, how: Woke) {
        match how {
            Woke::Event => self.event_wakes += 1,
            Woke::Timeout => self.timeout_wakes += 1,
            Woke::Other => {}
        }
    }

    /// Counts a message handed up `since` the wake that found it.
    pub(crate) fn handed_up(&mut self, how: Woke, since: Duration) {
        self.messages += 1;
        match how {
            Woke::Event => self
                .event_to_up
                .add(u64::try_from(since.as_micros()).unwrap_or(u64::MAX)),
            Woke::Timeout => self.timeout_messages += 1,
            Woke::Other => {}
        }
    }

    /// Logs the minute's line once a minute has passed, and starts the next minute.
    pub(crate) fn tick(&mut self) {
        if self.started.elapsed() >= MINUTE {
            self.log();
            *self = Stats::new();
        }
    }

    /// Logs what's left of the minute, as the edge stops.
    pub(crate) fn finish(&self) {
        self.log();
    }

    /// Logs the minute's counts, unless the edge neither read a connection nor handed up a
    /// message in it, as while the sim is closed.
    fn log(&self) {
        if self.event_wakes + self.timeout_wakes + self.messages == 0 {
            return;
        }
        tracing::info!(
            seconds = %format_args!("{:.1}", self.started.elapsed().as_secs_f64()),
            messages = self.messages,
            event_wakes = self.event_wakes,
            timeout_wakes = self.timeout_wakes,
            timeout_messages = self.timeout_messages,
            event_to_up_p50_us = self.event_to_up.at_most(0.5),
            event_to_up_p99_us = self.event_to_up.at_most(0.99),
            event_to_up_p999_us = self.event_to_up.at_most(0.999),
            event_to_up_max_us = self.event_to_up.max,
            "the sim edge's stats"
        );
    }
}

/// Counts times in µs in buckets 1µs wide below 32µs, and above that 16 to each doubling, so
/// a percentile it gives is at most 1/16 above the true one, in 8 KB whatever the count. It's
/// the histogram src/apps/core/src/loop_stats.rs keeps of the loop's waits, so change both
/// together.
struct Histogram {
    counts: Vec<u64>,
    total: u64,
    max: u64,
}

impl Histogram {
    const EXACT: u64 = 32;
    const STEPS: u32 = 16;

    fn new() -> Histogram {
        Histogram {
            counts: vec![0; Histogram::bucket(u64::MAX) + 1],
            total: 0,
            max: 0,
        }
    }

    fn bucket(us: u64) -> usize {
        if us < Histogram::EXACT {
            return us as usize;
        }
        let doubling = us.ilog2();
        let step = (us >> (doubling - 4)) & u64::from(Histogram::STEPS - 1);
        (Histogram::EXACT as u32 + (doubling - 5) * Histogram::STEPS) as usize + step as usize
    }

    /// The longest time the bucket holds.
    fn top(bucket: usize) -> u64 {
        if (bucket as u64) < Histogram::EXACT {
            return bucket as u64;
        }
        let past = bucket as u32 - Histogram::EXACT as u32;
        let doubling = past / Histogram::STEPS + 5;
        let width = 1u64 << (doubling - 4);
        let bottom = (u64::from(Histogram::STEPS + past % Histogram::STEPS)) * width;
        bottom + (width - 1)
    }

    fn add(&mut self, us: u64) {
        self.counts[Histogram::bucket(us)] += 1;
        self.total += 1;
        self.max = self.max.max(us);
    }

    /// A time that the share `q` of the times were at most, rounded up to its bucket's top
    /// and never past the longest.
    fn at_most(&self, q: f64) -> u64 {
        let rank = ((self.total as f64 * q).ceil() as u64).max(1);
        let mut seen = 0;
        for (bucket, &count) in self.counts.iter().enumerate() {
            seen += count;
            if seen >= rank {
                return Histogram::top(bucket).min(self.max);
            }
        }
        self.max
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_time_falls_in_a_bucket_whose_top_is_within_a_sixteenth_above_it() {
        for us in (0..100_000).chain([1 << 40, u64::MAX / 3, u64::MAX]) {
            let top = Histogram::top(Histogram::bucket(us));
            assert!(top >= us, "{us}µs fell in a bucket topped at {top}µs");
            assert!(
                top - us <= us / 16,
                "{us}µs fell in a bucket topped at {top}µs"
            );
        }
    }

    #[test]
    fn gives_percentiles_rounded_up_to_their_bucket() {
        let mut times = Histogram::new();
        for us in 1..=1_000 {
            times.add(us);
        }
        // 500µs is in the bucket from 496µs to 511µs.
        assert_eq!(times.at_most(0.5), 511);
        assert_eq!(times.at_most(0.99), 991);
        assert_eq!(times.at_most(1.0), 1_000);
        assert_eq!(Histogram::new().at_most(0.99), 0);
    }

    #[test]
    fn times_only_the_messages_a_connections_event_woke_the_edge_for() {
        let mut stats = Stats::new();
        for how in [Woke::Event, Woke::Timeout, Woke::Timeout, Woke::Other] {
            stats.woke(how);
        }
        stats.handed_up(Woke::Event, Duration::from_micros(300));
        stats.handed_up(Woke::Timeout, Duration::from_micros(5));
        stats.handed_up(Woke::Other, Duration::from_micros(7));
        assert_eq!((stats.event_wakes, stats.timeout_wakes), (1, 2));
        assert_eq!((stats.messages, stats.timeout_messages), (3, 1));
        assert_eq!(stats.event_to_up.total, 1);
        assert_eq!(stats.event_to_up.max, 300);
    }
}
