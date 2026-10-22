//! Each sender's clock offset, from the heartbeat's exchanges, as NTP estimates one: from an
//! exchange's four stamps, the offset is ½[(T2 − T1) + (T3 − T4)], and of the last 8 it keeps
//! the one with the shortest round trip (decision 038; record/areas/network/02-units.md, "The
//! heartbeat and clock offsets").

use std::collections::VecDeque;

/// How many exchanges the estimate chooses among.
const KEPT: usize = 8;

#[derive(Default)]
pub struct Offset {
    exchanges: VecDeque<(i64, u64)>,
}

impl Offset {
    /// Takes one exchange: T1, this core's send stamp, which the other echoed back; T2, the
    /// other's receive stamp of it; T3, the other's send stamp of its reply; and T4, this
    /// core's receive stamp of the reply.
    pub fn exchange(&mut self, t1: u64, t2: u64, t3: u64, t4: u64) {
        let (t1, t2, t3, t4) = (t1 as i128, t2 as i128, t3 as i128, t4 as i128);
        let round_trip = ((t4 - t1) - (t3 - t2)).max(0);
        let offset = ((t2 - t1) + (t3 - t4)) / 2;
        self.exchanges.push_back((offset as i64, round_trip as u64));
        if self.exchanges.len() > KEPT {
            self.exchanges.pop_front();
        }
    }

    /// The other core's counter less this core's, in µs, from the exchange with the shortest
    /// round trip of the last 8, or `None` before the first.
    pub fn estimate(&self) -> Option<i64> {
        self.exchanges
            .iter()
            .min_by_key(|(_, round_trip)| *round_trip)
            .map(|(offset, _)| *offset)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shortest_round_trip_of_the_last_8_gives_the_offset() {
        let mut offset = Offset::default();
        // The other's counter runs 1,000µs ahead; each exchange's paths take 100µs each
        // way, but one, whose way back took 900µs, is left out.
        offset.exchange(10_000, 11_100, 11_200, 10_300);
        offset.exchange(20_000, 21_100, 21_200, 21_100);
        assert_eq!(offset.estimate(), Some(1_000));
        for n in 0..8 {
            let t = 100_000 * (n + 1);
            offset.exchange(t, t + 1_300, t + 1_400, t + 700);
        }
        assert_eq!(
            offset.estimate(),
            Some(1_000),
            "the two first exchanges fell out"
        );
    }
}
