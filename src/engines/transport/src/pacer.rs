//! Pacing through a relay. Each relay caps how fast one client may send to it, and drops what
//! goes over, so the core keeps everything it sends through a relay, summed over every
//! connection through it, below the cap the session's relay list gives, holding stream data
//! back, the lowest priority first, so a replay or a catch-up waits behind the live channels
//! (record/areas/network/01-between-machines.md, "Sending").

use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::Duration;

use tokio::time::Instant;

/// How much the bucket holds at most, as a share of a second at the cap, so what builds up
/// while nothing is sent goes out in a burst of at most this much.
const BURST: f64 = 0.1;

/// The longest a stream waits before it looks at the bucket again, so it notices a stream
/// of higher priority that stopped waiting.
const LOOK_AGAIN: Duration = Duration::from_millis(20);

pub(crate) struct Pacer {
    per_second: f64,
    bucket: Mutex<Bucket>,
}

struct Bucket {
    bytes: f64,
    at: Instant,
    /// How many streams of each priority are waiting.
    waiting: BTreeMap<u8, u32>,
}

impl Pacer {
    pub(crate) fn new(cap: u32) -> Pacer {
        let per_second = f64::from(cap);
        Pacer {
            per_second,
            bucket: Mutex::new(Bucket {
                bytes: per_second * BURST,
                at: Instant::now(),
                waiting: BTreeMap::new(),
            }),
        }
    }

    fn most(&self) -> f64 {
        self.per_second * BURST
    }

    fn bucket(&self) -> std::sync::MutexGuard<'_, Bucket> {
        let mut bucket = self.bucket.lock().unwrap_or_else(|p| p.into_inner());
        let now = Instant::now();
        let earned = now.duration_since(bucket.at).as_secs_f64() * self.per_second;
        bucket.bytes = (bucket.bytes + earned).min(self.most());
        bucket.at = now;
        bucket
    }

    /// One-off packets go at once, and what they send makes stream data wait, since the
    /// bucket can run below empty.
    pub(crate) fn spend(&self, bytes: usize) {
        self.bucket().bytes -= bytes as f64;
    }

    /// Waits until `bytes` of stream data at `priority` may go: the bucket holds that much,
    /// or a full bucket's worth for a larger write, and no stream of a higher priority waits.
    pub(crate) async fn take(&self, priority: u8, bytes: usize) {
        let mut waiting: Option<Waiter> = None;
        loop {
            let wait = {
                let mut bucket = self.bucket();
                let higher =
                    priority < u8::MAX && bucket.waiting.range(priority + 1..).next().is_some();
                let needed = (bytes as f64).min(self.most());
                if !higher && bucket.bytes >= needed {
                    bucket.bytes -= bytes as f64;
                    if let Some(waiter) = waiting.take() {
                        waiter.leave(&mut bucket);
                    }
                    return;
                }
                if waiting.is_none() {
                    *bucket.waiting.entry(priority).or_default() += 1;
                    waiting = Some(Waiter {
                        pacer: self,
                        priority,
                        left: false,
                    });
                }
                let short = (needed - bucket.bytes).max(0.0) / self.per_second;
                Duration::from_secs_f64(short).clamp(Duration::from_millis(1), LOOK_AGAIN)
            };
            tokio::time::sleep(wait).await;
        }
    }
}

/// A stream waiting for the bucket, counted until it takes its bytes or its task ends.
struct Waiter<'a> {
    pacer: &'a Pacer,
    priority: u8,
    left: bool,
}

impl Waiter<'_> {
    fn leave(mut self, bucket: &mut Bucket) {
        Self::uncount(bucket, self.priority);
        self.left = true;
    }

    fn uncount(bucket: &mut Bucket, priority: u8) {
        if let Some(count) = bucket.waiting.get_mut(&priority) {
            *count -= 1;
            if *count == 0 {
                bucket.waiting.remove(&priority);
            }
        }
    }
}

impl Drop for Waiter<'_> {
    fn drop(&mut self) {
        if !self.left {
            let mut bucket = self.pacer.bucket.lock().unwrap_or_else(|p| p.into_inner());
            Self::uncount(&mut bucket, self.priority);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    /// At a cap of 100,000 bytes a second, 50,000 bytes of stream data take 0.4s: the
    /// 10,000 the full bucket starts with go at once.
    #[tokio::test(start_paused = true)]
    async fn stream_data_goes_at_the_cap() {
        let pacer = Pacer::new(100_000);
        let start = Instant::now();
        for _ in 0..50 {
            pacer.take(10, 1_000).await;
        }
        let took = start.elapsed();
        assert!(
            (Duration::from_millis(390)..Duration::from_millis(420)).contains(&took),
            "took {took:?}"
        );
    }

    /// One-off packets go at once, and the stream data behind them waits for what they spent.
    #[tokio::test(start_paused = true)]
    async fn one_off_packets_make_streams_wait() {
        let pacer = Pacer::new(100_000);
        pacer.spend(30_000);
        let start = Instant::now();
        pacer.take(10, 1_000).await;
        let took = start.elapsed();
        assert!(
            (Duration::from_millis(200)..Duration::from_millis(230)).contains(&took),
            "took {took:?}"
        );
    }

    /// Of two streams waiting, the higher priority goes first.
    #[tokio::test(start_paused = true)]
    async fn the_higher_priority_stream_goes_first() {
        let pacer = Arc::new(Pacer::new(100_000));
        pacer.spend(10_000);
        let order = Arc::new(Mutex::new(Vec::new()));
        let low = {
            let (pacer, order) = (pacer.clone(), order.clone());
            tokio::spawn(async move {
                pacer.take(1, 5_000).await;
                order.lock().unwrap().push(1);
            })
        };
        tokio::time::sleep(Duration::from_millis(1)).await;
        let high = {
            let (pacer, order) = (pacer.clone(), order.clone());
            tokio::spawn(async move {
                pacer.take(200, 5_000).await;
                order.lock().unwrap().push(200);
            })
        };
        let _ = tokio::join!(low, high);
        assert_eq!(*order.lock().unwrap(), vec![200, 1]);
    }
}
