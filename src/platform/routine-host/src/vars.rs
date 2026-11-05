//! Named variables, which a routine reads during its frame and writes once every routine's
//! frame has run, on the pilot's aircraft or on an object by its ID
//! (record/areas/architecture/02-code-map.md, "What a routine can ask for").
//!
//! `Figure` writes up to 34 variables on each figure every frame, so a lookup by name for
//! each would cost a frame what it costs to compare every name. So a routine names a variable
//! once, through `Wants::var`, and keeps the `VarRef` it gets, its place in the host's table.
//! The sim's Vars API takes IDs, which the host looks up once for each place and keeps until
//! the sim removes or resets its variables, as fsc-editor's module heard it do on an aircraft
//! change (measured on MSFS 2024, 2026-08-27, fsc-editor, `docs/sim-vars/build/v1-log.md`,
//! "2026-08-27 — The typed variable API works, and the sim announces invalidation").

use std::collections::BTreeMap;

use crate::Sim;

/// The pilot's aircraft, as a read or a write names its object: SimConnect's
/// `SIMCONNECT_OBJECT_ID_USER` and the Vars API's `FS_OBJECT_ID_USER_AIRCRAFT` are both 0,
/// and an object a SimConnect connection created takes the same ID in both (read in
/// experiments/areas/avatars/wasm/src/follow.cpp, which wrote `Z:` variables on the ID
/// SimConnect assigned).
pub const USER: u32 = 0;

/// The pilot's avatar on foot, as a read names its object: the Vars API's
/// `FS_OBJECT_ID_USER_AVATAR`, `FS_OBJECT_ID_MAX + 1` (read in the MSFS 2024 SDK,
/// WASM/include/MSFS/MSFS_Core.h).
pub const AVATAR: u32 = 0xFFFF_FFFF - 128 + 1;

/// Which of the sim's tables a variable is in, by its prefix.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Space {
    /// `A:`, the sim's variables of an aircraft or an object.
    A,
    /// `L:`, shared by everything in the sim.
    L,
    /// `Z:`, an object's own, which the Vars API registers on each object apart, as p12
    /// registered its own on each object it wrote (same file).
    Z,
}

/// A variable as the sim names it: its table, its name without the prefix, such as
/// `PLANE LATITUDE` or `DUALINPUT_FIGURE_HEAD_YAW`, and its unit, such as `degrees`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Named {
    pub space: Space,
    pub name: String,
    pub unit: String,
}

/// A variable the host has named, by its place in the host's table.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct VarRef(pub u32);

/// The IDs the sim gave a variable and its unit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ids {
    pub var: i32,
    pub unit: i32,
}

/// The host's table of every variable a routine has named, which lasts as long as the host,
/// so a routine fed again gets the same places, and the sim's IDs for each place: an `A:` or
/// `L:` variable's by its place, and a `Z:` variable's by its place and its object.
#[derive(Default)]
pub(crate) struct Vars {
    named: Vec<Named>,
    shared: BTreeMap<VarRef, Ids>,
    own: BTreeMap<(VarRef, u32), Ids>,
}

impl Vars {
    /// The place of `name`, such as `A:PLANE LATITUDE`, in `unit`, which it takes on the
    /// first ask. `None` for a name with no prefix of the three.
    pub(crate) fn place(&mut self, name: &str, unit: &str) -> Option<VarRef> {
        let (space, rest) = match name.split_at_checked(2)? {
            ("A:", rest) => (Space::A, rest),
            ("L:", rest) => (Space::L, rest),
            ("Z:", rest) => (Space::Z, rest),
            _ => return None,
        };
        if let Some(at) = self
            .named
            .iter()
            .position(|n| n.space == space && n.name == rest && n.unit == unit)
        {
            return Some(VarRef(at as u32));
        }
        self.named.push(Named {
            space,
            name: rest.to_string(),
            unit: unit.to_string(),
        });
        Some(VarRef(self.named.len() as u32 - 1))
    }

    pub(crate) fn space(&self, var: VarRef) -> Option<Space> {
        self.named.get(var.0 as usize).map(|n| n.space)
    }

    /// The sim's IDs for `var` on `object`, looked up on the first ask. A name the sim
    /// doesn't know is asked again next time rather than kept as missing, since a variable
    /// can appear as an aircraft loads.
    pub(crate) fn ids(&mut self, var: VarRef, object: u32, sim: &mut dyn Sim) -> Option<Ids> {
        let named = self.named.get(var.0 as usize)?;
        let kept = match named.space {
            Space::Z => self.own.get(&(var, object)),
            Space::A | Space::L => self.shared.get(&var),
        };
        if let Some(ids) = kept {
            return Some(*ids);
        }
        let ids = sim.look_up(object, named)?;
        match named.space {
            Space::Z => self.own.insert((var, object), ids),
            Space::A | Space::L => self.shared.insert(var, ids),
        };
        Some(ids)
    }

    /// Forgets every ID, once the sim has removed or reset its variables, keeping the
    /// places.
    pub(crate) fn forget(&mut self) {
        self.shared.clear();
        self.own.clear();
    }
}

/// A write a routine asked for, carried out once every routine's frame has run.
pub(crate) struct Write {
    pub(crate) object: u32,
    pub(crate) var: VarRef,
    pub(crate) value: f64,
}
