//! What the core and our WASM module trade through the sim's client data areas, the slots:
//! each routine's slot, which the core writes and the module reads, and the module's status
//! slot, which the module writes and the core reads
//! (record/areas/core/03-sim-seam-and-wasm-module.md, "Its slots").
//!
//! The module reads a slot in place, as the bytes of a `#[repr(C)]` struct, so the slots'
//! structs live in files named `slots.rs`, which build.rs hashes into `SLOTS_HASH`. A module
//! from another build then ignores a feed whose header carries another hash, rather than
//! reading its bytes as a struct laid out differently.

pub mod slots;

use bytemuck::{Pod, Zeroable};

/// The name of the module's status slot.
pub const STATUS: &str = "DUALINPUT_MODULE_STATUS";

/// A routine, by the name its slot carries, such as `HOLD` for `DUALINPUT_ROUTINE_HOLD`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RoutineId {
    pub name: &'static str,
    /// Whether it asks the routine host to freeze the aircraft. A module that stopped can't
    /// lift that freeze, so the core lifts it when the last such routine ends
    /// (record/areas/architecture/log.md, 2026-10-23).
    pub freezes: bool,
}

impl RoutineId {
    /// The client data area the core writes the routine's feeds into.
    pub fn slot(self) -> String {
        format!("DUALINPUT_ROUTINE_{}", self.name)
    }
}

/// Preflight's routine, which holds the pilot's aircraft frozen.
pub const HOLD: RoutineId = RoutineId {
    name: "HOLD",
    freezes: true,
};

/// What the module writes into its status slot once a second. Its layout never changes,
/// so a core reads the status of a module from any build, and can say which build it is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Pod, Zeroable)]
#[repr(C)]
pub struct ModuleStatus {
    /// The module's count of seconds since it started, which stops when the module does.
    pub counter: u64,
    /// The `SLOTS_HASH` of the module's build.
    pub slots_hash: u64,
    /// The module's `VERSION`, padded with zero bytes.
    pub version: [u8; 16],
}

impl ModuleStatus {
    pub fn new(counter: u64, slots_hash: u64, version: &str) -> ModuleStatus {
        let mut padded = [0; 16];
        for (to, from) in padded.iter_mut().zip(version.bytes()) {
            *to = from;
        }
        ModuleStatus {
            counter,
            slots_hash,
            version: padded,
        }
    }

    /// The module's version, as the text it wrote.
    pub fn version(&self) -> String {
        let text = self.version.split(|&b| b == 0).next().unwrap_or_default();
        String::from_utf8_lossy(text).into_owned()
    }
}
