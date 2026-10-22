//! The loop's stats in the run's log, once a minute and as the core exits: how many inputs
//! it handled, how busy it was, how long inputs waited in the queue, how many took longer
//! than a handler's budget, and the input that took longest, so a bug report's log shows
//! whether the loop kept up, and the bench reads the loop's budgets there
//! (record/areas/core/01-loop-and-edge.md, "Logging").

use std::time::{Duration, Instant};

use kernel::Input;

/// How often the minute's line goes out, while inputs come; an idle loop writes its line
/// with the next input.
const MINUTE: Duration = Duration::from_secs(60);

/// The code map's budget for a handler, so the line counts the inputs that went past it
/// (record/areas/architecture/02-code-map.md, "Budgets").
const HANDLER: Duration = Duration::from_millis(1);

pub struct Stats {
    minute: Window,
    run: Window,
}

impl Stats {
    pub fn new() -> Stats {
        Stats {
            minute: Window::new(),
            run: Window::new(),
        }
    }

    /// Counts one input, which waited `waited` µs in the queue, took `took` to handle, and
    /// kept the loop `busy` in all, and logs the minute's line once a minute has passed.
    pub fn handled(&mut self, input: &Input, waited: u64, took: Duration, busy: Duration) {
        for window in [&mut self.minute, &mut self.run] {
            window.add(input, waited, took, busy);
        }
        if self.minute.started.elapsed() >= MINUTE {
            self.minute.log("minute");
            self.minute = Window::new();
        }
    }

    /// Logs what's left of the minute, then the whole run.
    pub fn finish(&self) {
        if self.minute.inputs > 0 {
            self.minute.log("minute");
        }
        self.run.log("run");
    }
}

struct Window {
    started: Instant,
    inputs: u64,
    busy: Duration,
    over_1ms: u64,
    waits: Histogram,
    /// How long the slowest input took, and its sequence number and stamp.
    slowest: Option<(Duration, u64, u64)>,
}

impl Window {
    fn new() -> Window {
        Window {
            started: Instant::now(),
            inputs: 0,
            busy: Duration::ZERO,
            over_1ms: 0,
            waits: Histogram::new(),
            slowest: None,
        }
    }

    fn add(&mut self, input: &Input, waited: u64, took: Duration, busy: Duration) {
        self.inputs += 1;
        self.busy += busy;
        self.over_1ms += u64::from(took > HANDLER);
        self.waits.add(waited);
        if self.slowest.is_none_or(|(slowest, ..)| took > slowest) {
            self.slowest = Some((took, input.seq, input.stamp));
        }
    }

    fn log(&self, window: &str) {
        let length = self.started.elapsed();
        let busy_percent = 100.0 * self.busy.as_secs_f64() / length.as_secs_f64().max(1e-9);
        let (slowest, slowest_seq, slowest_stamp) = self.slowest.unwrap_or_default();
        tracing::info!(
            window,
            seconds = %format_args!("{:.1}", length.as_secs_f64()),
            inputs = self.inputs,
            busy_percent = %format_args!("{busy_percent:.2}"),
            wait_p50_us = self.waits.at_most(0.5),
            wait_p99_us = self.waits.at_most(0.99),
            wait_p999_us = self.waits.at_most(0.999),
            wait_max_us = self.waits.max,
            over_1ms = self.over_1ms,
            slowest_us = slowest.as_micros(),
            slowest_seq,
            slowest_stamp,
            "the loop's stats"
        );
    }
}

/// Counts waits in µs in buckets 1µs wide below 32µs, and above that 16 to each doubling,
/// so a percentile it gives is at most 1/16 above the true one, in 8 KB whatever the count.
/// src/engines/sim-edge/src/stats.rs keeps a copy for the sim edge's wake-ups, so change both
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

    /// The largest wait the bucket holds.
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

    /// A wait that the share `q` of the waits were at most, rounded up to its bucket's top
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
    fn each_wait_falls_in_a_bucket_whose_top_is_within_a_sixteenth_above_it() {
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
        let mut waits = Histogram::new();
        for us in 1..=1_000 {
            waits.add(us);
        }
        // 500µs is in the bucket from 496µs to 511µs.
        assert_eq!(waits.at_most(0.5), 511);
        assert_eq!(waits.at_most(0.99), 991);
        assert_eq!(waits.at_most(1.0), 1_000);
        assert_eq!(Histogram::new().at_most(0.99), 0);
    }
}
