//! `Lead`, on the flying machine: it reads the aircraft in the first frame at or past each
//! 50ms mark, and reports each read with the frame's time
//! (record/areas/flight-model/01-flight-model-sync.md, "The flying machine").

use messages::flight_model::slots::LeadSlot;
use messages::flight_model::{LEAD, PERIOD, Sample};
use messages::module::RoutineId;
use routine_host::{Frame, Routine, Wants};

use crate::vars::Names;

#[derive(Default)]
pub struct Lead {
    /// The next mark, in µs on the core's counter.
    next: u64,
    names: Option<Names>,
}

impl Routine for Lead {
    const ID: RoutineId = LEAD;
    type Slot = LeadSlot;
    type Report = Sample;

    fn on_slot(&mut self, _: &LeadSlot) {}

    fn frame(&mut self, frame: &Frame, want: &mut Wants) {
        if frame.now < self.next {
            return;
        }
        // The marks stay 50ms apart whatever the frame rate, so reports average 20 a second
        // above 20 fps, and after a frame that passes a whole period they start again from
        // that frame, rather than report in every frame until they catch up.
        self.next = if frame.now - self.next < PERIOD {
            self.next + PERIOD
        } else {
            frame.now + PERIOD
        };
        if self.names.is_none() {
            self.names = Names::new(want);
        }
        let Some(snapshot) = self.names.as_ref().and_then(|names| names.read(want)) else {
            return;
        };
        // The stamp is the frame's time, on the core's counter, so a report that reaches the
        // core late still says when it was read.
        want.report(&Sample {
            at: frame.now,
            snapshot,
        });
    }
}
