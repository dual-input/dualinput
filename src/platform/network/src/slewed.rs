//! A sender's clock offset as a feature applies it to the stamps of what it draws. The network's
//! estimate can step, as when the connection moves between paths and the exchange its filter
//! keeps changes, and a 10ms step taken at once would move a drawn aircraft 0.8m at 150 kt. So
//! the applied offset moves toward the estimate by at most 5ms a second, which slows or speeds
//! what's drawn by at most 0.5% (record/areas/flight-model/01-flight-model-sync.md, "Taking a
//! sample"). Flight-model sync draws the PF's aircraft by it, and traffic the traffic host's
//! copies.

/// The offset in use, the sender's counter less this core's in µs, and when it was last moved,
/// or nothing before the first.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Slewed(Option<(i64, u64)>);

/// How far the applied offset moves in a second, in µs.
const PER_SECOND: u64 = 5_000;

impl Slewed {
    /// The offset to apply at `now`, given the network's `estimate`: the estimate itself the
    /// first time, and after that the last one applied, moved toward the estimate by at most
    /// 5ms for each second since.
    pub fn apply(&mut self, estimate: i64, now: u64) -> i64 {
        let offset = match self.0 {
            None => estimate,
            Some((was, at)) => {
                let most = (now.saturating_sub(at) * PER_SECOND / 1_000_000) as i64;
                was + (estimate - was).clamp(-most, most)
            }
        };
        // A sample that moves the offset by under a µs leaves the time where it was, so the
        // time since keeps adding up until it's worth a whole one.
        let at = match self.0 {
            Some((was, at)) if was == offset && estimate != offset => at,
            _ => now,
        };
        self.0 = Some((offset, at));
        offset
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Flight-model sync's case: a 30ms step in the network's offset reaches the applied
    /// offset within 6s, and no sample moves it by more than its share of 5ms a second.
    #[test]
    fn a_30ms_step_reaches_the_applied_offset_within_6s_and_never_at_once() {
        let mut applied = Slewed::default();
        assert_eq!(applied.apply(1_000_000, 0), 1_000_000, "the first at once");
        let mut last = 1_000_000;
        let mut reached = None;
        // A sample every 50ms.
        for n in 1..=140u64 {
            let now = n * 50_000;
            let offset = applied.apply(1_030_000, now);
            assert!(offset - last <= 250, "a step of {}µs", offset - last);
            last = offset;
            if offset == 1_030_000 && reached.is_none() {
                reached = Some(now);
            }
        }
        assert_eq!(reached, Some(6_000_000));
    }

    #[test]
    fn it_moves_down_as_it_moves_up_and_adds_up_short_gaps() {
        let mut applied = Slewed::default();
        applied.apply(0, 0);
        assert_eq!(applied.apply(-10_000, 1_000_000), -5_000);
        // 100µs apart, each worth under a µs, add up to one after 200µs.
        let mut offset = 0;
        for n in 1..=4u64 {
            offset = applied.apply(-10_000, 1_000_000 + n * 100);
        }
        assert_eq!(offset, -5_002);
    }
}
