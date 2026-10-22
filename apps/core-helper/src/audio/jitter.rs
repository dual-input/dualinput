//! A playback stream's buffer: frames by the sender's number, held at each transmission's
//! start for a depth picked from the frames before, then played one each 20ms as the output
//! device asks for them, with a frame that comes after its turn dropped and a missing one
//! concealed (record/areas/traffic-atc/01-traffic-and-atc.md, "The buffer").
//!
//! The device's own clock paces the playing, since the output thread asks for the next frame
//! whenever the device needs one, so a sender whose clock drifts from the device's slowly
//! fills or drains the buffer rather than splitting a transmission.

use std::collections::{BTreeMap, VecDeque};

use messages::core_helper::Buffer;

/// Every frame is 20ms, in µs.
const FRAME_US: u64 = 20_000;

/// What the output thread plays next on a stream.
#[derive(Debug, PartialEq, Eq)]
pub enum Turn {
    Play(Vec<u8>),
    /// The frame whose turn it is never came, or came late, so the codec conceals it.
    Conceal,
    /// A transmission ended, with what came of its frames.
    End(Report),
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Report {
    pub played: u32,
    pub concealed: u32,
    pub late: u32,
    pub depth_ms: u16,
}

struct Transmission {
    first: u32,
    first_arrived: u64,
    /// When its first frame plays, in µs on the helper's clock.
    start: u64,
    /// The number whose turn is next.
    next: u32,
    frames: BTreeMap<u32, Vec<u8>>,
    report: Report,
}

pub struct Jitter {
    rule: Buffer,
    /// How late each of the last `history` frames came, in µs, against its transmission's
    /// first frame plus 20ms for each frame since.
    lateness: VecDeque<u64>,
    /// The frame received before, by its number and the sender's stamp.
    previous: Option<(u32, u64)>,
    /// The front one plays, and one that started while it still played waits behind it.
    transmissions: VecDeque<Transmission>,
    /// The last number whose turn has passed, so a frame that comes after its turn is
    /// dropped even once its transmission has ended, rather than starting another.
    passed: Option<u32>,
}

impl Jitter {
    pub fn new(rule: Buffer) -> Jitter {
        Jitter {
            rule,
            lateness: VecDeque::new(),
            previous: None,
            transmissions: VecDeque::new(),
            passed: None,
        }
    }

    /// The depth for a transmission starting now: the smallest that would have played the
    /// rule's share of the frames heard on time, between its least and most, or its least
    /// with nothing heard yet.
    fn depth(&self) -> u64 {
        let least = u64::from(self.rule.least_ms) * 1_000;
        let most = u64::from(self.rule.most_ms) * 1_000;
        if self.lateness.is_empty() {
            return least;
        }
        let mut sorted: Vec<u64> = self.lateness.iter().copied().collect();
        sorted.sort_unstable();
        let share = f64::from(self.rule.on_time_percent.min(100)) / 100.0;
        let index = ((share * sorted.len() as f64).ceil() as usize).clamp(1, sorted.len()) - 1;
        sorted[index].clamp(least, most)
    }

    /// A frame from the sender, by its number and stamp there, which arrived at `arrived` µs
    /// on the helper's clock.
    pub fn push(&mut self, number: u32, stamp: u64, opus: Vec<u8>, arrived: u64) {
        let passed = self.passed.is_some_and(|p| number <= p);
        // Compared with the frame before rather than the transmission's first, so a drift
        // between the two clocks over a 2-minute ATIS never splits it. The gate's silence
        // takes no numbers, so a stamp past what the numbers account for is a pause.
        let new = match self.previous {
            Some((n, s)) if number > n => {
                let expected = s + u64::from(number - n) * FRAME_US;
                stamp > expected + u64::from(self.rule.new_after_ms) * 1_000
            }
            Some(_) => false,
            None => true,
        };
        // A frame whose stamp follows on from the one before belongs to that frame's
        // transmission, so one that comes after its transmission ended is dropped.
        if !passed && new {
            let depth = self.depth();
            let start = arrived + depth;
            self.transmissions.push_back(Transmission {
                first: number,
                first_arrived: arrived,
                start,
                next: number,
                frames: BTreeMap::new(),
                report: Report {
                    depth_ms: (depth / 1_000) as u16,
                    ..Report::default()
                },
            });
        }
        if self.previous.is_none_or(|(n, _)| number > n) {
            self.previous = Some((number, stamp));
        }
        // The newest transmission that starts at or before the frame's number holds it.
        let Some(t) = self
            .transmissions
            .iter_mut()
            .rev()
            .find(|t| number >= t.first)
        else {
            return;
        };
        let due = t.first_arrived + u64::from(number - t.first) * FRAME_US;
        self.lateness.push_back(arrived.saturating_sub(due));
        while self.lateness.len() > usize::from(self.rule.history).max(1) {
            self.lateness.pop_front();
        }
        if number < t.next {
            t.report.late += 1;
        } else {
            t.frames.insert(number, opus);
        }
    }

    /// The next frame to play, once the output device needs one, at `now` µs on the
    /// helper's clock, or `None` while no transmission has reached its start.
    pub fn pull(&mut self, now: u64) -> Option<Turn> {
        let t = self.transmissions.front_mut()?;
        if now < t.start {
            return None;
        }
        if let Some(opus) = t.frames.remove(&t.next) {
            self.passed = Some(t.next);
            t.next += 1;
            t.report.played += 1;
            return Some(Turn::Play(opus));
        }
        if t.frames.keys().any(|&n| n > t.next) {
            self.passed = Some(t.next);
            t.next += 1;
            t.report.concealed += 1;
            return Some(Turn::Conceal);
        }
        // The transmission ends when its frames run out.
        let ended = self.transmissions.pop_front()?;
        if let Some(next) = self.transmissions.front_mut() {
            next.start = next.start.max(now);
        }
        Some(Turn::End(ended.report))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule() -> Buffer {
        Buffer {
            least_ms: 60,
            most_ms: 300,
            on_time_percent: 98,
            history: 500,
            new_after_ms: 30,
            gain: 1.0,
        }
    }

    /// Plays frames arriving at the given times, pulling every 20ms as a device would, from
    /// `from` µs to `until` µs, and returns every turn.
    fn play(jitter: &mut Jitter, arrivals: &[(u32, u64, u64)], from: u64, until: u64) -> Vec<Turn> {
        let mut turns = Vec::new();
        let mut pending: Vec<&(u32, u64, u64)> = arrivals.iter().collect();
        pending.sort_by_key(|a| a.2);
        let mut next = 0;
        let mut now = from;
        while now < until {
            while next < pending.len() && pending[next].2 <= now {
                let (number, stamp, arrived) = *pending[next];
                jitter.push(number, stamp, vec![number as u8], arrived);
                next += 1;
            }
            while let Some(turn) = jitter.pull(now) {
                let frame = !matches!(turn, Turn::End(_));
                turns.push(turn);
                if frame {
                    break;
                }
            }
            now += FRAME_US;
        }
        turns
    }

    fn ends(turns: &[Turn]) -> Vec<&Report> {
        turns
            .iter()
            .filter_map(|t| match t {
                Turn::End(r) => Some(r),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn with_nothing_heard_the_depth_is_its_least_and_a_transmission_plays_whole() {
        let mut jitter = Jitter::new(rule());
        let arrivals: Vec<_> = (0..10)
            .map(|n| (n, n as u64 * FRAME_US, n as u64 * FRAME_US))
            .collect();
        let turns = play(&mut jitter, &arrivals, 0, 1_000_000);
        assert_eq!(
            ends(&turns),
            [&Report {
                played: 10,
                concealed: 0,
                late: 0,
                depth_ms: 60
            }]
        );
    }

    #[test]
    fn a_frame_later_than_its_turn_is_dropped_and_concealed() {
        let mut jitter = Jitter::new(rule());
        let mut arrivals: Vec<_> = (0..30)
            .map(|n| (n, n as u64 * FRAME_US, n as u64 * FRAME_US))
            .collect();
        // Frame 4 arrives 200ms late, long after its turn at 60ms + 80ms.
        arrivals[4].2 += 200_000;
        let turns = play(&mut jitter, &arrivals, 0, 1_000_000);
        assert_eq!(turns.iter().filter(|t| **t == Turn::Conceal).count(), 1);
        assert_eq!(ends(&turns).len(), 1);
        assert_eq!(ends(&turns)[0].late, 1);
        assert_eq!(ends(&turns)[0].played, 29);
    }

    #[test]
    fn a_frame_that_comes_after_its_transmission_ended_starts_no_other() {
        let mut jitter = Jitter::new(rule());
        let mut arrivals: Vec<_> = (0..10)
            .map(|n| (n, n as u64 * FRAME_US, n as u64 * FRAME_US))
            .collect();
        arrivals[9].2 += 500_000;
        let turns = play(&mut jitter, &arrivals, 0, 2_000_000);
        assert_eq!(ends(&turns).len(), 1);
        assert_eq!(ends(&turns)[0].played, 9);
    }

    #[test]
    fn a_missing_number_whose_stamp_gap_matches_is_concealed() {
        let mut jitter = Jitter::new(rule());
        let arrivals: Vec<_> = (0..10)
            .filter(|&n| n != 5)
            .map(|n| (n, n as u64 * FRAME_US, n as u64 * FRAME_US))
            .collect();
        let turns = play(&mut jitter, &arrivals, 0, 1_000_000);
        assert_eq!(ends(&turns).len(), 1);
        assert_eq!(ends(&turns)[0].concealed, 1);
    }

    #[test]
    fn a_stamp_30ms_past_what_the_numbers_account_for_starts_a_new_transmission() {
        let mut jitter = Jitter::new(rule());
        // Numbers 0 to 4, then 5 to 9 stamped 500ms later: the gate's silence between.
        let arrivals: Vec<_> = (0..10)
            .map(|n| {
                let pause = if n >= 5 { 500_000 } else { 0 };
                (n, n as u64 * FRAME_US + pause, n as u64 * FRAME_US + pause)
            })
            .collect();
        let turns = play(&mut jitter, &arrivals, 0, 2_000_000);
        let reports = ends(&turns);
        assert_eq!(reports.len(), 2);
        assert!(reports.iter().all(|r| r.played == 5 && r.concealed == 0));
    }

    #[test]
    fn a_2_minute_transmission_whose_stamps_drift_12ms_from_the_device_stays_one() {
        let mut jitter = Jitter::new(rule());
        // 6,000 frames, the sender's 20ms each 2µs longer than the device's.
        let arrivals: Vec<_> = (0..6_000u32)
            .map(|n| {
                let at = u64::from(n) * (FRAME_US + 2);
                (n, at, at)
            })
            .collect();
        let turns = play(&mut jitter, &arrivals, 0, 130_000_000);
        assert_eq!(
            ends(&turns),
            [&Report {
                played: 6_000,
                concealed: 0,
                late: 0,
                depth_ms: 60
            }]
        );
    }

    #[test]
    fn with_80ms_and_30ms_of_jitter_the_depth_settles_at_their_98th_percentile() {
        let mut jitter = Jitter::new(rule());
        // A fixed spread of delays from 50ms to 110ms, the same in each transmission, so the
        // lateness against each transmission's first frame is known.
        let delay = |n: u32| 50_000 + u64::from((n * 37) % 61) * 1_000;
        let mut arrivals = Vec::new();
        for t in 0..20u32 {
            for k in 0..50u32 {
                let n = t * 50 + k;
                let stamp = u64::from(n) * FRAME_US + u64::from(t) * 2_000_000;
                arrivals.push((n, stamp, stamp + delay(n)));
            }
        }
        let turns = play(&mut jitter, &arrivals, 0, 70_000_000);
        let last = *ends(&turns).last().unwrap();
        // The last transmission's depth comes from the 500 frames before it, transmissions 9
        // to 18, each frame as late as its delay past its transmission's first frame's.
        let mut lateness: Vec<u64> = (9 * 50..19 * 50)
            .map(|n| delay(n).saturating_sub(delay(n - n % 50)))
            .collect();
        lateness.sort_unstable();
        let p98 = lateness[(0.98 * lateness.len() as f64).ceil() as usize - 1];
        let expected = (p98.clamp(60_000, 300_000) / 1_000) as u16;
        assert!(
            last.depth_ms.abs_diff(expected) <= 1,
            "the depth was {}ms, against a 98th percentile of {expected}ms",
            last.depth_ms
        );
        assert_eq!(last.late, 0);
    }
}
