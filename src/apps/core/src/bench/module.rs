//! Our WASM module as the stand-in runs it: the routine host with the module's list of
//! routines and the bench's own test routine, natively, on the stand-in's aircraft and
//! objects (record/areas/build/02-testing.md, "Our WASM module").

use bytemuck::{Pod, Zeroable};
use messages::avatars::FIGURE;
use messages::avatars::slots::{
    BODY_HEAD, BODY_ON_FOOT, FigureSlot, FigureState, HAND_GRIP, HAND_POINT, HAND_THUMB,
};
use messages::bench::{FedBody, FedFigure, FedHand, FromCore};
use messages::module::slots::{CameraRead, SlotHeader};
use messages::module::{RoutineId, STATUS};
use routine_host::{Flag, Frame, Host, Ids, Key, Named, Routine, Sim, Space, Wants};
use stand_in_sim::{Aircraft, Module, World};

use super::ToBench;

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
    type Report = ();

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
    to_bench: ToBench,
    /// What `Figure` was last fed, so only a change makes a line.
    fed: Option<(u32, Vec<FedFigure>)>,
}

impl BenchModule {
    /// A module built with `slots_hash`, which is this build's unless a scenario stands in
    /// for a module from another build.
    pub fn new(slots_hash: u64, to_bench: ToBench) -> BenchModule {
        let mut list = routines::list();
        list.push(routine_host::kind::<Probe>());
        BenchModule {
            host: Host::new(list, slots_hash, messages::VERSION),
            to_bench,
            fed: None,
        }
    }

    /// Tells the bench what `Figure`'s slot now holds, when that changed, since a figure's
    /// seat, hands, and color are what most of avatars' cases look at
    /// (record/areas/avatars/01-avatars.md, "Cases for the bench").
    fn tell_fed(&mut self, bytes: &[u8]) {
        let header = size_of::<SlotHeader>();
        let Some(body) = bytes.get(header..header + size_of::<FigureSlot>()) else {
            return;
        };
        let at = bytes
            .get(..header)
            .map_or(0, |h| bytemuck::pod_read_unaligned::<SlotHeader>(h).counter);
        let slot: FigureSlot = bytemuck::pod_read_unaligned(body);
        let figures: Vec<FedFigure> = slot
            .figures
            .iter()
            .take(slot.count as usize)
            .map(fed_figure)
            .collect();
        let yokes = slot.yokes.iter().filter(|y| y.present != 0).count() as u32;
        let fed = Some((yokes, figures));
        if fed != self.fed {
            self.fed = fed;
            if let Some((yokes, figures)) = &self.fed {
                self.to_bench.send(&FromCore::Fed {
                    at,
                    yokes: *yokes,
                    figures: figures.clone(),
                });
            }
        }
    }
}

fn fed_figure(state: &FigureState) -> FedFigure {
    let pose = &state.pose;
    FedFigure {
        object: state.object,
        color: state.color,
        shows: state.shows,
        slumps: state.slumps != 0,
        hip: state.hip,
        body: match pose.body {
            BODY_HEAD => FedBody::Head {
                eye: pose.eye,
                look: pose.look,
            },
            BODY_ON_FOOT => FedBody::OnFoot {
                at: pose.at,
                heading: pose.heading,
                crouch: pose.crouch != 0,
            },
            _ => FedBody::Seated {
                eye: pose.eye,
                look: pose.look,
            },
        },
        hands: pose.hands.map(|hand| match hand.kind {
            HAND_GRIP => FedHand::Grip { side: hand.side },
            HAND_THUMB => FedHand::Thumb { point: hand.point },
            HAND_POINT => FedHand::Point { point: hand.point },
            _ => FedHand::Rest,
        }),
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
            if id.name == FIGURE.name {
                self.tell_fed(bytes);
            }
        }
    }

    fn frame(&mut self, clock: u64, world: &mut World) -> Vec<(String, Vec<u8>)> {
        let status = self.host.frame(clock, &mut Plane(world));
        let mut wrote: Vec<(String, Vec<u8>)> = self
            .host
            .reports()
            .map(|(routine, report)| (routine.report_slot(), report))
            .collect();
        wrote.extend(status.map(|s| (STATUS.to_string(), bytemuck::bytes_of(&s).to_vec())));
        wrote
    }
}

/// The stand-in's aircraft and objects, as the routine host reaches them. The module turns a
/// freeze on and off through the sim's events, and the stand-in sets the variable each sets.
/// Each table holds a variable by the name SimConnect takes: an `A:` or `E:` one with no
/// prefix, and an `L:` or `Z:` one with its own, so the two don't meet; every `E:` and `L:`
/// one is the aircraft's, since the sim keeps one table of each.
///
/// A table holds one number for a variable, whatever unit a reader names, and holds an angle
/// in degrees, as avatars reads the aircraft's pose. `Lead` and `Follow` read and write the
/// pose in radians, so a read or a write in `radians` converts, and the unit's ID says which:
/// 1 for radians, 0 for any other.
struct Plane<'a>(&'a mut World);

/// The unit ID `Plane` gives `radians`.
const RADIANS: i32 = 1;

impl Plane<'_> {
    /// The table a variable is in, and its name there, from the ID the world gave it.
    fn find(&mut self, object: u32, space: Space, ids: Ids) -> Option<(&mut Aircraft, String)> {
        let (own, name) = self.0.var_named(ids.var)?;
        let (object, key) = match space {
            Space::A => (object, name.to_string()),
            Space::E => (0, name.to_string()),
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
            unit: i32::from(named.unit.eq_ignore_ascii_case("radians")),
        })
    }

    fn get(&mut self, object: u32, space: Space, ids: Ids) -> Option<f64> {
        let (vars, key) = self.find(object, space, ids)?;
        let value = vars.number(&key);
        Some(if ids.unit == RADIANS {
            value.to_radians()
        } else {
            value
        })
    }

    fn set(&mut self, object: u32, space: Space, ids: Ids, value: f64) {
        // The Vars API has no write for an `E:` variable, so our module writes none, as `set`
        // in src/sim-package/wasm-module/src/vars.rs skips it.
        if space == Space::E {
            return;
        }
        let value = if ids.unit == RADIANS {
            value.to_degrees()
        } else {
            value
        };
        if let Some((vars, key)) = self.find(object, space, ids) {
            vars.set_number(&key, value);
        }
    }

    fn reset(&mut self) -> bool {
        self.0.take_reset()
    }

    fn fire_h(&mut self, name: &str) {
        self.0.fire_h(name);
    }

    fn call_preset(&mut self, name: &str, value: Option<f64>) {
        self.0.call_preset(name, value);
    }

    fn key(&mut self, key: Key, value: i32) {
        self.0.key(key.name(), value);
    }

    fn camera(&mut self, referential: u32) -> Option<CameraRead> {
        let camera = self.0.camera(referential);
        Some(CameraRead {
            position: camera.position,
            fov: camera.fov,
            pitch: camera.pitch,
            yaw: camera.yaw,
            roll: camera.roll,
            referential,
        })
    }
}
