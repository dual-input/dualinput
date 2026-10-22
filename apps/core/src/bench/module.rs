//! Our WASM module as the stand-in runs it: the routine host with the module's list of
//! routines and the bench's own test routine, natively, on the stand-in's aircraft
//! (record/areas/build/02-testing.md, "Our WASM module").

use bytemuck::{Pod, Zeroable};
use messages::module::{RoutineId, STATUS};
use routine_host::{Flag, Frame, Host, Routine, Sim, Wants};
use stand_in_sim::{Aircraft, Module};

/// The bench's test routine, whose mode its feed sets, so a scenario can tell what a
/// routine carried from one feeding into the next, and can stop the module with a panic.
pub const PROBE: RoutineId = RoutineId("PROBE");

#[derive(Clone, Copy, Debug, Default, Pod, Zeroable)]
#[repr(C)]
pub struct ProbeSlot {
    pub mode: u32,
}

/// Remembers a mark on mode 1, asks for the freeze on mode 2 only while it remembers one,
/// asks for it on mode 3 whatever it remembers, and panics in its frame on mode 4, as a
/// routine with a bug would.
#[derive(Default)]
struct Probe {
    mark: bool,
    mode: u32,
}

impl Routine for Probe {
    const ID: RoutineId = PROBE;
    type Slot = ProbeSlot;

    fn on_slot(&mut self, slot: &ProbeSlot) {
        self.mode = slot.mode;
        if slot.mode == 1 {
            self.mark = true;
        }
    }

    fn frame(&mut self, _: &Frame, want: &mut Wants) {
        match self.mode {
            2 if self.mark => want.freeze(),
            3 => want.freeze(),
            4 => panic!("the bench's test routine stops the module, as a routine's bug would"),
            _ => {}
        }
    }
}

pub struct BenchModule {
    host: Host,
}

impl BenchModule {
    /// A module built with `slots_hash`, which is this build's unless a scenario stands in
    /// for a module from another build.
    pub fn new(slots_hash: u64) -> BenchModule {
        let mut list = routines::list();
        list.push(routine_host::kind::<Probe>());
        BenchModule {
            host: Host::new(list, slots_hash, messages::VERSION),
        }
    }
}

impl Module for BenchModule {
    fn slots(&self) -> Vec<String> {
        self.host
            .slots()
            .into_iter()
            .map(|(id, _)| id.slot())
            .collect()
    }

    fn written(&mut self, slot: &str, bytes: &[u8], clock: u64) {
        let id = self
            .host
            .slots()
            .into_iter()
            .map(|(id, _)| id)
            .find(|id| id.slot() == slot);
        if let Some(id) = id {
            self.host.written(id, bytes, clock);
        }
    }

    fn frame(&mut self, clock: u64, aircraft: &mut Aircraft) -> Vec<(String, Vec<u8>)> {
        self.host
            .frame(clock, &mut Plane(aircraft))
            .map(|status| (STATUS.to_string(), bytemuck::bytes_of(&status).to_vec()))
            .into_iter()
            .collect()
    }
}

/// The stand-in's aircraft, as the routine host reaches it. The module turns a freeze on
/// and off through the sim's events, and the stand-in sets the variable each sets.
struct Plane<'a>(&'a mut Aircraft);

fn variable(flag: Flag) -> &'static str {
    match flag {
        Flag::LatitudeLongitude => "IS LATITUDE LONGITUDE FREEZE ON",
        Flag::Altitude => "IS ALTITUDE FREEZE ON",
        Flag::Attitude => "IS ATTITUDE FREEZE ON",
    }
}

impl Sim for Plane<'_> {
    fn frozen(&mut self, flag: Flag) -> bool {
        self.0.number(variable(flag)) != 0.0
    }

    fn set_frozen(&mut self, flag: Flag, on: bool) {
        self.0.set_number(variable(flag), f64::from(u8::from(on)));
    }
}
