//! p11's stand-in for flight-model sync's routine, as 02-code-map's sketch has
//! it: it asks for the freeze in every frame it runs, and writes the pose from
//! 400ms back once it has a sample that old.

use messages::PoseSample;
use module_host::{Frame, Routine, Wants};

const DELAY_US: u64 = 400_000;

#[derive(Default)]
pub struct Follow {
    samples: Vec<PoseSample>,
}

impl Routine for Follow {
    const ID: &'static str = messages::FOLLOW;
    type Slot = PoseSample;

    fn on_slot(&mut self, s: &PoseSample) {
        self.samples.push(*s);
    }

    fn frame(&mut self, f: &Frame, want: &mut Wants) {
        want.freeze();
        let at = f.now_us.saturating_sub(DELAY_US);
        if let Some(p) = self.samples.iter().rev().find(|s| s.t_us <= at) {
            want.write("A:PLANE LATITUDE", p.lat_deg);
            want.write("A:PLANE LONGITUDE", p.lon_deg);
            want.write("A:PLANE ALTITUDE", p.alt_ft);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_asks_for_the_freeze_before_it_has_a_sample_old_enough() {
        let mut follow = Follow::default();
        follow.on_slot(&PoseSample { t_us: 1_000_000, lat_deg: 47.0, ..Default::default() });
        let mut want = Wants::default();
        follow.frame(&Frame { now_us: 1_100_000 }, &mut want);
        assert!(want.freeze);
        assert!(want.writes.is_empty());
        let mut want = Wants::default();
        follow.frame(&Frame { now_us: 1_400_000 }, &mut want);
        assert_eq!(want.writes.first(), Some(&("A:PLANE LATITUDE", 47.0)));
    }
}
