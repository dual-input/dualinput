//! The routine host, in our WASM module: it runs the routines features feed it, one frame
//! at a time, and does what they ask of the sim, so no routine calls the sim itself
//! (record/areas/architecture/02-code-map.md, "Work in the sim").
//!
//! A routine runs from its feature's first feed until the feature ends it, or until 1s
//! passes with no write to its slot, which the core writes again every 200ms while it runs.
//! So a core that stops leaves no routine running, and the freeze, the one want that lasts
//! past the frame that asked for it, lifts with it.
//!
//! The module's edge, or on the bench the stand-in sim, hands the host each slot's writes
//! and each frame, and carries out its wants through `Sim`.

// A panic in our module puts it in the sim's `DIRTY` state, and the sim stops running it, so
// one routine's bug would stop every routine (record/areas/architecture/02-code-map.md,
// "When the module stops"). So the commonest panics fail Clippy, which tools/check.ts runs on
// the module.
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

mod freeze;
mod hold;
mod vars;

pub use freeze::Flag;
pub use hold::Hold;
pub use vars::{AVATAR, Ids, Named, Space, USER, VarRef};

use bytemuck::Pod;
use messages::module::slots::SlotHeader;
use messages::module::{ModuleStatus, RoutineId};

use crate::freeze::Freeze;
use crate::vars::{Vars, Write};

/// The sim, as the host reaches it: through the sim's own APIs in our module, and through
/// the stand-in's objects on the bench (record/areas/core/03-sim-seam-and-wasm-module.md,
/// "Wants and the sim's APIs").
pub trait Sim {
    /// Whether the pilot's aircraft has `flag` on.
    fn frozen(&mut self, flag: Flag) -> bool;
    /// Turns `flag` on or off on the pilot's aircraft.
    fn set_frozen(&mut self, flag: Flag, on: bool);
    /// The sim's IDs for `named` and its unit, a `Z:` variable's on `object`, or `None` when
    /// the sim has no such variable or unit.
    fn look_up(&mut self, object: u32, named: &Named) -> Option<Ids>;
    /// The value of the variable `ids` names, in `space`, on `object`, or `None` when the
    /// sim can't read it.
    fn get(&mut self, object: u32, space: Space, ids: Ids) -> Option<f64>;
    fn set(&mut self, object: u32, space: Space, ids: Ids, value: f64);
    /// Whether the sim has removed or reset its variables since the last ask, after which
    /// every ID it gave may name nothing, or another variable.
    fn reset(&mut self) -> bool;
    /// Fires the `H:` event `name`, its name with no `H:`.
    fn fire_h(&mut self, name: &str);
    /// Calls the preset of an input event `name` names, such as `ELECTRICAL_Battery_1_Toggle`,
    /// with `value` when it takes one.
    fn call_preset(&mut self, name: &str, value: Option<f64>);
}

/// An `H:` event or a preset a routine asked for, carried out once every routine's frame has
/// run, in the order asked, so a write function's two kinds keep their call order.
enum Fire {
    H(String),
    Preset { name: String, value: Option<f64> },
}

/// A slot that goes this long with no write from the core leaves its routine unfed, and the
/// host drops it, in µs.
const UNFED: u64 = 1_000_000;

/// A routine: a feature's work in the sim, which reads the values its feature feeds it and
/// asks the host for what it wants each frame. A routine starts as `Default` at its first
/// feed, so it carries nothing from one feeding into the next.
pub trait Routine: Default + Send + 'static {
    const ID: RoutineId;
    /// Whether each feed is carried out once, as an `H:` event or a preset is. The host drops
    /// a routine left unfed for 1s, and the core's next rewrite starts it again on the same
    /// feed, which a routine that holds a pose needs, and one that fires events mustn't take,
    /// since a toggle fired twice puts a switch back.
    const FEED_ONCE: bool = false;
    /// What its feature feeds it, read in place from the routine's slot.
    type Slot: Pod;
    /// A new feed, which the core's rewrites of the same feed don't repeat.
    fn on_slot(&mut self, slot: &Self::Slot);
    fn frame(&mut self, frame: &Frame, want: &mut Wants);
}

/// One frame of the sim, as a routine sees it.
pub struct Frame {
    /// The host's estimate of the core's counter, in µs on the PC's performance counter,
    /// so what a routine times is on the core's timeline
    /// (record/areas/flight-model/01-flight-model-sync.md, "The core's counter in our
    /// module").
    pub now: u64,
}

/// What the routines ask of the sim in one frame: reads, which the host makes at once, and
/// the rest, which it carries out once every routine's frame has run. A routine that needs
/// a want this lacks adds it here (record/areas/architecture/02-code-map.md, "What a
/// routine can ask for").
pub struct Wants<'f> {
    freeze: bool,
    sim: &'f mut dyn Sim,
    vars: &'f mut Vars,
    writes: &'f mut Vec<Write>,
    fires: &'f mut Vec<Fire>,
}

impl Wants<'_> {
    /// Freezes the pilot's aircraft for this frame. The host keeps it frozen while any
    /// routine asks, and unfreezes it in the first frame none does, if the host froze it.
    pub fn freeze(&mut self) {
        self.freeze = true;
    }

    /// The host's place for the variable `name`, such as `A:PLANE LATITUDE` or
    /// `Z:DUALINPUT_FIGURE_HEAD_YAW`, in `unit`. A routine asks once and keeps the place.
    /// `None` for a name with no `A:`, `L:`, or `Z:` prefix.
    pub fn var(&mut self, name: &str, unit: &str) -> Option<VarRef> {
        self.vars.place(name, unit)
    }

    /// The value of `var` on `object`, `USER` for the pilot's aircraft, read now.
    pub fn read(&mut self, object: u32, var: VarRef) -> Option<f64> {
        let space = self.vars.space(var)?;
        let ids = self.vars.ids(var, object, self.sim)?;
        self.sim.get(object, space, ids)
    }

    /// Writes `value` into `var` on `object`, once every routine's frame has run.
    pub fn write(&mut self, object: u32, var: VarRef, value: f64) {
        self.writes.push(Write { object, var, value });
    }

    /// Fires the `H:` event `name`, once every routine's frame has run.
    pub fn fire_h(&mut self, name: &str) {
        self.fires.push(Fire::H(name.to_string()));
    }

    /// Calls the input event's preset `name`, once every routine's frame has run.
    pub fn call_preset(&mut self, name: &str, value: Option<f64>) {
        self.fires.push(Fire::Preset {
            name: name.to_string(),
            value,
        });
    }
}

/// A routine of the module's list, with its type erased, so one list holds every routine.
pub struct Kind {
    id: RoutineId,
    size: usize,
    feed_once: bool,
    make: fn() -> Box<dyn Running>,
}

/// A `Kind` for the routine `R`, for the module's list.
pub fn kind<R: Routine>() -> Kind {
    Kind {
        id: R::ID,
        size: size_of::<R::Slot>(),
        feed_once: R::FEED_ONCE,
        make: || Box::new(R::default()),
    }
}

/// The module's list of routines, such as `routines![Hold]`.
#[macro_export]
macro_rules! routines {
    ($($routine:ty),* $(,)?) => {
        vec![$($crate::kind::<$routine>()),*]
    };
}

trait Running: Send {
    fn on_slot(&mut self, bytes: &[u8]);
    fn frame(&mut self, frame: &Frame, want: &mut Wants);
}

impl<R: Routine> Running for R {
    fn on_slot(&mut self, bytes: &[u8]) {
        // `written` checked the length against the slot's size.
        if let Some(bytes) = bytes.get(..size_of::<R::Slot>()) {
            Routine::on_slot(self, &bytemuck::pod_read_unaligned(bytes));
        }
    }

    fn frame(&mut self, frame: &Frame, want: &mut Wants) {
        Routine::frame(self, frame, want);
    }
}

struct Slot {
    kind: Kind,
    running: Option<Box<dyn Running>>,
    /// The feed count of the last write, so a rewrite of the same feed is no new feed.
    feeds: u32,
    /// When the last write arrived, on the module's clock.
    written: u64,
}

/// The routines of one module and what they've asked of the sim.
pub struct Host {
    slots_hash: u64,
    version: &'static str,
    slots: Vec<Slot>,
    /// The core's counter less the module's clock, the largest any header has given.
    offset: Option<i64>,
    /// When the host started, and when it last wrote its status, both on its clock.
    started: Option<u64>,
    status_written: Option<u64>,
    freeze: Freeze,
    vars: Vars,
    /// The frame's writes, kept from frame to frame so a frame allocates nothing.
    writes: Vec<Write>,
    /// The frame's `H:` events and presets, kept the same way.
    fires: Vec<Fire>,
}

impl Host {
    /// A host for the routines `list`, in a module built with `slots_hash` and `version`,
    /// which are `messages::SLOTS_HASH` and `messages::VERSION`, unless the bench is
    /// standing in for a module from another build.
    pub fn new(list: Vec<Kind>, slots_hash: u64, version: &'static str) -> Host {
        Host {
            slots_hash,
            version,
            slots: list
                .into_iter()
                .map(|kind| Slot {
                    kind,
                    running: None,
                    feeds: 0,
                    written: 0,
                })
                .collect(),
            offset: None,
            started: None,
            status_written: None,
            freeze: Freeze::default(),
            vars: Vars::default(),
            writes: Vec::new(),
            fires: Vec::new(),
        }
    }

    /// Each routine's slot and its size in bytes, header included, which the module creates
    /// as it starts.
    pub fn slots(&self) -> Vec<(RoutineId, u32)> {
        self.slots
            .iter()
            .map(|s| (s.kind.id, (size_of::<SlotHeader>() + s.kind.size) as u32))
            .collect()
    }

    /// The core wrote `id`'s slot, which the module read at `clock`, in µs on its clock.
    pub fn written(&mut self, id: RoutineId, bytes: &[u8], clock: u64) {
        let header_size = size_of::<SlotHeader>();
        let Some(slot) = self.slots.iter_mut().find(|s| s.kind.id == id) else {
            return;
        };
        let (Some(header), Some(body)) = (bytes.get(..header_size), bytes.get(header_size..))
        else {
            return;
        };
        let header: SlotHeader = bytemuck::pod_read_unaligned(header);
        // A core of another build lays its structs out another way, which this module would
        // read in place, and could write wrong values into the pilot's aircraft from
        // (record/areas/core/03-sim-seam-and-wasm-module.md, "A module from another build").
        if header.slots_hash != self.slots_hash || body.len() < slot.kind.size {
            return;
        }
        // Every write reached the module after it was made, so the largest offset is the
        // closest to the true one.
        let offset = header.counter as i64 - clock as i64;
        self.offset = Some(self.offset.map_or(offset, |o| o.max(offset)));
        slot.written = clock;
        if header.end != 0 {
            slot.running = None;
            slot.feeds = header.feeds;
            return;
        }
        let new_feed = slot.feeds != header.feeds;
        slot.feeds = header.feeds;
        match &mut slot.running {
            Some(running) if new_feed => running.on_slot(body),
            Some(_) => {}
            None => {
                let mut running = (slot.kind.make)();
                if new_feed || !slot.kind.feed_once {
                    running.on_slot(body);
                }
                slot.running = Some(running);
            }
        }
    }

    /// Runs one frame at `clock`, in µs on the module's clock: drops each routine left
    /// unfed, runs every other routine's frame, then carries out what they asked for on
    /// `sim`. Returns the status to write into the status slot, once a second.
    pub fn frame(&mut self, clock: u64, sim: &mut dyn Sim) -> Option<ModuleStatus> {
        let frame = Frame {
            now: self
                .offset
                .map_or(clock, |offset| clock.saturating_add_signed(offset)),
        };
        self.writes.clear();
        if sim.reset() {
            self.vars.forget();
        }
        let mut want = Wants {
            freeze: false,
            sim: &mut *sim,
            vars: &mut self.vars,
            writes: &mut self.writes,
            fires: &mut self.fires,
        };
        for slot in &mut self.slots {
            if slot.running.is_some() && clock.saturating_sub(slot.written) > UNFED {
                slot.running = None;
            }
            if let Some(running) = &mut slot.running {
                running.frame(&frame, &mut want);
            }
        }
        let freeze = want.freeze;
        for w in &self.writes {
            if let (Some(space), Some(ids)) =
                (self.vars.space(w.var), self.vars.ids(w.var, w.object, sim))
            {
                sim.set(w.object, space, ids, w.value);
            }
        }
        for fire in self.fires.drain(..) {
            match fire {
                Fire::H(name) => sim.fire_h(&name),
                Fire::Preset { name, value } => sim.call_preset(&name, value),
            }
        }
        self.freeze.carry_out(freeze, sim);
        self.status(clock)
    }

    /// Lifts the freeze, if the host set it, as the module stops. A module that starts again
    /// in the same run of the sim then finds the aircraft as the pilot left it, where it
    /// would find the flags on, take them for someone else's, and never release them.
    pub fn release(&mut self, sim: &mut dyn Sim) {
        self.freeze.carry_out(false, sim);
    }

    /// The status, when a second has passed since the host last wrote it, or in the first
    /// frame. Its counter is whole seconds since the host started.
    fn status(&mut self, clock: u64) -> Option<ModuleStatus> {
        let started = *self.started.get_or_insert(clock);
        let due = self
            .status_written
            .is_none_or(|last| clock.saturating_sub(last) >= 1_000_000);
        if !due {
            return None;
        }
        self.status_written = Some(clock);
        let counter = clock.saturating_sub(started) / 1_000_000;
        Some(ModuleStatus::new(counter, self.slots_hash, self.version))
    }
}

#[cfg(test)]
mod tests;
