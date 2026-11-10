use std::collections::BTreeMap;

use sim_client::Connection;
use simconnect_types::SIMCONNECT_OBJECT_ID_USER_AVATAR;

use crate::Aircraft;

/// The first ID the stand-in gives an object a connection creates. Which IDs the sim gives
/// is unverified, so the stand-in starts well clear of the pilot's aircraft, 0.
const FIRST_OBJECT: u32 = 0x100;

/// What the stand-in's sim holds that the core's calls and the module read and write: the
/// pilot's aircraft, their avatar on foot, and the objects connections created, each a
/// table of its variables; and the IDs the Vars API hands the module for them, which a reset
/// of the sim's variables makes stale, as an aircraft change does in the sim
/// (record/areas/core/03-sim-seam-and-wasm-module.md, "Wants and the sim's APIs").
#[derive(Default)]
pub struct World {
    pub aircraft: Aircraft,
    /// `SIMCONNECT_OBJECT_ID_USER_AVATAR`, the pilot on foot, which a scenario moves.
    pub avatar: Aircraft,
    objects: BTreeMap<u32, Object>,
    next_object: u32,
    /// Each ID the Vars API has handed out since the last reset: for an object's own
    /// variable, its object, and the variable's name. IDs count on across a reset, so one
    /// from before names nothing.
    ids: BTreeMap<i32, (Option<u32>, String)>,
    next_id: i32,
    reset: bool,
    /// The aircraft's input events, by name, each with its hash and value.
    pub(crate) inputs: BTreeMap<String, Input>,
    /// The `H:` events the module fired and the presets it called since the stand-in last
    /// looked, in order.
    fired: Vec<Fired>,
}

/// An event the module made in the sim.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Fired {
    H(String),
    Preset { name: String, value: Option<f64> },
}

pub(crate) struct Input {
    pub(crate) hash: u64,
    pub(crate) value: f64,
}

struct Object {
    title: String,
    connection: Connection,
    vars: Aircraft,
}

/// An object a connection created, as the stand-in reports it.
#[derive(Clone, Debug, PartialEq)]
pub struct Made {
    pub id: u32,
    pub title: String,
    pub connection: Connection,
    pub variables: Vec<(String, String)>,
}

impl World {
    /// The variables of the object `id`: the pilot's aircraft at 0, the avatar on foot at
    /// `SIMCONNECT_OBJECT_ID_USER_AVATAR`, or an object a connection created.
    pub fn vars(&self, id: u32) -> Option<&Aircraft> {
        match id {
            0 => Some(&self.aircraft),
            SIMCONNECT_OBJECT_ID_USER_AVATAR => Some(&self.avatar),
            _ => self.objects.get(&id).map(|o| &o.vars),
        }
    }

    pub fn vars_mut(&mut self, id: u32) -> Option<&mut Aircraft> {
        match id {
            0 => Some(&mut self.aircraft),
            SIMCONNECT_OBJECT_ID_USER_AVATAR => Some(&mut self.avatar),
            _ => self.objects.get_mut(&id).map(|o| &mut o.vars),
        }
    }

    /// The ID the Vars API gives the variable `name`, on `own` for an object's own one.
    pub fn var_id(&mut self, own: Option<u32>, name: &str) -> i32 {
        self.next_id += 1;
        self.ids.insert(self.next_id, (own, name.to_string()));
        self.next_id
    }

    /// The variable an ID names, while no reset has come since the Vars API gave it.
    pub fn var_named(&self, id: i32) -> Option<(Option<u32>, &str)> {
        self.ids.get(&id).map(|(own, name)| (*own, name.as_str()))
    }

    /// Whether the sim's variables reset since the last ask, as the Vars API tells a module.
    pub fn take_reset(&mut self) -> bool {
        std::mem::take(&mut self.reset)
    }

    /// The module fired the `H:` event `name`, which the stand-in hands to the sim's pages once
    /// the module's frame ends, as every JavaScript instrument hears one.
    pub fn fire_h(&mut self, name: &str) {
        self.fired.push(Fired::H(name.to_string()));
    }

    /// The module called an input event's preset, which the stand-in carries out once the
    /// module's frame ends.
    pub fn call_preset(&mut self, name: &str, value: Option<f64>) {
        self.fired.push(Fired::Preset {
            name: name.to_string(),
            value,
        });
    }

    pub(crate) fn take_fired(&mut self) -> Vec<Fired> {
        std::mem::take(&mut self.fired)
    }

    pub(crate) fn reset_vars(&mut self) {
        self.ids.clear();
        self.reset = true;
    }

    /// Every object's ID: the pilot's aircraft, the avatar, and the objects connections
    /// created.
    pub(crate) fn objects(&self) -> Vec<u32> {
        [0, SIMCONNECT_OBJECT_ID_USER_AVATAR]
            .into_iter()
            .chain(self.objects.keys().copied())
            .collect()
    }

    /// Creates an object of the SimObject `title`, which its `A:TITLE` reads, as the C152's
    /// seat object's reads `SEAT_C152_Pilot` (measured on MSFS 2024, 2026-10-02,
    /// record/areas/avatars/log.md, "Seat objects place the other pilot in the cockpit").
    pub(crate) fn create(&mut self, title: &str, connection: Connection) -> u32 {
        let id = FIRST_OBJECT + self.next_object;
        self.next_object += 1;
        let mut vars = Aircraft::default();
        vars.set_text("TITLE", title);
        self.objects.insert(
            id,
            Object {
                title: title.to_string(),
                connection,
                vars,
            },
        );
        id
    }

    /// Removes an object `connection` created; the sim lets a client remove only its own.
    pub(crate) fn remove(&mut self, id: u32, connection: Connection) {
        if self
            .objects
            .get(&id)
            .is_some_and(|o| o.connection == connection)
        {
            self.objects.remove(&id);
        }
    }

    /// Removes every object `connection` created, as the sim does when the connection closes
    /// (documented, SimConnect_Close) or its client dies.
    pub(crate) fn remove_all(&mut self, connection: Connection) {
        self.objects.retain(|_, o| o.connection != connection);
    }

    pub(crate) fn made(&self) -> Vec<Made> {
        self.objects
            .iter()
            .map(|(&id, o)| Made {
                id,
                title: o.title.clone(),
                connection: o.connection,
                variables: o.vars.variables(),
            })
            .collect()
    }
}
