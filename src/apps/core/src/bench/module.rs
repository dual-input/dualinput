//! Our WASM module as the stand-in runs it: the routine host with the module's list of
//! routines and the bench's own test routine, natively, on the stand-in's aircraft and
//! objects (record/areas/build/02-testing.md, "Our WASM module").

use bytemuck::{Pod, Zeroable};
use messages::module::{RoutineId, STATUS};
use routine_host::{Flag, Frame, Host, Ids, Named, Routine, Sim, Space, Wants};
use stand_in_sim::{Aircraft, Module, World};

/// The bench's test routine, whose mode its feed sets, so a scenario can tell what a
/// routine carried from one feeding into the next, and can stop the module with a panic.
pub const PROBE: RoutineId = RoutineId {
    name: "PROBE",
    freezes: true,
};

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

    fn frame(&mut self, clock: u64, world: &mut World) -> Vec<(String, Vec<u8>)> {
        self.host
            .frame(clock, &mut Plane(world))
            .map(|status| (STATUS.to_string(), bytemuck::bytes_of(&status).to_vec()))
            .into_iter()
            .collect()
    }
}

/// The stand-in's aircraft and objects, as the routine host reaches them. The module turns a
/// freeze on and off through the sim's events, and the stand-in sets the variable each sets.
/// Each table holds a variable by the name SimConnect takes: an `A:` one with no prefix, and
/// an `L:` or `Z:` one with its own, so the two don't meet; every `L:` one is the aircraft's,
/// since the sim keeps one table of them.
struct Plane<'a>(&'a mut World);

impl Plane<'_> {
    /// The table a variable is in, and its name there, from the ID the world gave it.
    fn find(&mut self, object: u32, space: Space, ids: Ids) -> Option<(&mut Aircraft, String)> {
        let (own, name) = self.0.var_named(ids.var)?;
        let (object, key) = match space {
            Space::A => (object, name.to_string()),
            Space::L => (0, format!("L:{name}")),
            Space::Z => (own?, format!("Z:{name}")),
        };
        Some((self.0.vars_mut(object)?, key))
    }
}

fn variable(flag: Flag) -> &'static str {
    match flag {
        Flag::LatitudeLongitude => "IS LATITUDE LONGITUDE FREEZE ON",
        Flag::Altitude => "IS ALTITUDE FREEZE ON",
        Flag::Attitude => "IS ATTITUDE FREEZE ON",
    }
}

impl Sim for Plane<'_> {
    fn frozen(&mut self, flag: Flag) -> bool {
        self.0.aircraft.number(variable(flag)) != 0.0
    }

    fn set_frozen(&mut self, flag: Flag, on: bool) {
        self.0
            .aircraft
            .set_number(variable(flag), f64::from(u8::from(on)));
    }

    fn look_up(&mut self, object: u32, named: &Named) -> Option<Ids> {
        let own = (named.space == Space::Z).then_some(object);
        Some(Ids {
            var: self.0.var_id(own, &named.name),
            unit: 0,
        })
    }

    fn get(&mut self, object: u32, space: Space, ids: Ids) -> Option<f64> {
        let (vars, key) = self.find(object, space, ids)?;
        Some(vars.number(&key))
    }

    fn set(&mut self, object: u32, space: Space, ids: Ids, value: f64) {
        if let Some((vars, key)) = self.find(object, space, ids) {
            vars.set_number(&key, value);
        }
    }

    fn reset(&mut self) -> bool {
        self.0.take_reset()
    }
}
