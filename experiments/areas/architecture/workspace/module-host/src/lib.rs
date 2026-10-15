//! p11's module host, as 02-code-map's "Work in the sim" draws it: it hands each
//! routine its slot's values and each frame, and does what the routines ask. It
//! makes no call into the sim, so the core's stand-in links it natively and the
//! module links it for wasm32.

use messages::SlotHeader;

pub struct Frame {
    pub now_us: u64,
}

#[derive(Default, Debug, PartialEq)]
pub struct Wants {
    pub freeze: bool,
    pub writes: Vec<(&'static str, f64)>,
}

impl Wants {
    pub fn freeze(&mut self) {
        self.freeze = true;
    }
    pub fn write(&mut self, name: &'static str, value: f64) {
        self.writes.push((name, value));
    }
}

pub trait Routine: Default + 'static {
    const ID: &'static str;
    /// The routine's struct, which follows the header in its slot.
    type Slot: Copy;
    fn on_slot(&mut self, slot: &Self::Slot);
    fn frame(&mut self, f: &Frame, want: &mut Wants);
}

/// What the edge carries out after a frame.
#[derive(Default, Debug, PartialEq)]
pub struct Actions {
    /// Some(true) to freeze, Some(false) to release a freeze the host set.
    pub freeze: Option<bool>,
    pub writes: Vec<(&'static str, f64)>,
}

const UNFED_US: u64 = 1_000_000;
const HEADER: usize = size_of::<SlotHeader>();

trait Entry {
    fn id(&self) -> &'static str;
    fn slot_size(&self) -> usize;
    fn write(&mut self, now_us: u64, bytes: &[u8]);
    fn frame(&mut self, f: &Frame, want: &mut Wants);
}

struct Slot<R: Routine> {
    live: Option<R>,
    feeds: u32,
    last_write_us: Option<u64>,
}

impl<R: Routine> Entry for Slot<R> {
    fn id(&self) -> &'static str {
        R::ID
    }

    fn slot_size(&self) -> usize {
        HEADER + size_of::<R::Slot>()
    }

    fn write(&mut self, now_us: u64, bytes: &[u8]) {
        if bytes.len() < self.slot_size() {
            return;
        }
        let word = |at: usize| u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
        let header = SlotHeader { feeds: word(0), ended: word(4) };
        self.last_write_us = Some(now_us);
        if header.ended != 0 {
            self.live = None;
            return;
        }
        let new = self.live.is_none();
        if new || header.feeds != self.feeds {
            self.feeds = header.feeds;
            // The slot holds the struct the core wrote, at a fixed offset; the
            // message crate asserts its layout on both targets.
            let body = unsafe { std::ptr::read_unaligned(bytes[HEADER..].as_ptr().cast::<R::Slot>()) };
            self.live.get_or_insert_with(R::default).on_slot(&body);
        }
    }

    fn frame(&mut self, f: &Frame, want: &mut Wants) {
        if let Some(t) = self.last_write_us {
            if f.now_us.saturating_sub(t) > UNFED_US {
                self.live = None;
            }
        }
        if let Some(r) = self.live.as_mut() {
            r.frame(f, want);
        }
    }
}

#[derive(Default)]
pub struct Host {
    slots: Vec<Box<dyn Entry>>,
    froze: bool,
}

impl Host {
    pub fn add<R: Routine>(&mut self) {
        self.slots.push(Box::new(Slot::<R> { live: None, feeds: 0, last_write_us: None }));
    }

    /// Each routine's ID and its slot's size in bytes, for the edge to create the slots.
    pub fn slots(&self) -> Vec<(&'static str, usize)> {
        self.slots.iter().map(|s| (s.id(), s.slot_size())).collect()
    }

    pub fn write(&mut self, id: &str, now_us: u64, bytes: &[u8]) {
        if let Some(s) = self.slots.iter_mut().find(|s| s.id() == id) {
            s.write(now_us, bytes);
        }
    }

    pub fn frame(&mut self, f: &Frame, frozen_now: bool) -> Actions {
        let mut want = Wants::default();
        for s in &mut self.slots {
            s.frame(f, &mut want);
        }
        let freeze = if want.freeze && !frozen_now {
            self.froze = true;
            Some(true)
        } else if !want.freeze && self.froze {
            self.froze = false;
            Some(false)
        } else {
            None
        };
        Actions { freeze, writes: want.writes }
    }
}

#[macro_export]
macro_rules! routines {
    ($($r:ty),* $(,)?) => {{
        let mut host = $crate::Host::default();
        $(host.add::<$r>();)*
        host
    }};
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Holds {
        fed: u32,
    }

    impl Routine for Holds {
        const ID: &'static str = "HOLDS";
        type Slot = u32;
        fn on_slot(&mut self, slot: &u32) {
            self.fed = *slot;
        }
        fn frame(&mut self, _: &Frame, want: &mut Wants) {
            want.freeze();
            want.write("L:FED", f64::from(self.fed));
        }
    }

    fn slot(feeds: u32, ended: u32, value: u32) -> Vec<u8> {
        [feeds.to_le_bytes(), ended.to_le_bytes(), value.to_le_bytes()].concat()
    }

    #[test]
    fn a_routine_runs_while_fed_and_the_host_undoes_only_its_own_freeze() {
        let mut host = routines![Holds];
        assert_eq!(host.slots(), vec![("HOLDS", 12)]);

        host.write("HOLDS", 0, &slot(1, 0, 7));
        let a = host.frame(&Frame { now_us: 10 }, false);
        assert_eq!(a.freeze, Some(true));
        assert_eq!(a.writes, vec![("L:FED", 7.0)]);

        // A rewrite of the same feed doesn't reach on_slot, and the host doesn't freeze twice.
        host.write("HOLDS", 200_000, &slot(1, 0, 9));
        let b = host.frame(&Frame { now_us: 200_010 }, true);
        assert_eq!((b.freeze, b.writes), (None, vec![("L:FED", 7.0)]));

        // The end mark drops it at once.
        host.write("HOLDS", 300_000, &slot(1, 1, 7));
        assert_eq!(host.frame(&Frame { now_us: 300_010 }, true).freeze, Some(false));

        // Fed again, it starts new; 1s with no write drops it.
        host.write("HOLDS", 400_000, &slot(2, 0, 3));
        assert_eq!(host.frame(&Frame { now_us: 400_010 }, false).writes, vec![("L:FED", 3.0)]);
        let late = host.frame(&Frame { now_us: 1_500_000 }, true);
        assert_eq!((late.freeze, late.writes), (Some(false), vec![]));
    }

    #[test]
    fn a_freeze_the_host_didnt_set_is_left_alone() {
        let mut host = routines![Holds];
        assert_eq!(host.frame(&Frame { now_us: 0 }, true).freeze, None);
    }
}
