//! The pilot's aircraft and the objects in the sim, as the routine host reaches them through
//! the sim's Vars and Events APIs (record/areas/core/03-sim-seam-and-wasm-module.md, "Wants
//! and the sim's APIs").

use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};

use routine_host::{Flag, Ids, Named, Sim, Space};

use crate::vars;

use crate::bindings::{
    FS_OBJECT_ID_USER_AIRCRAFT, FS_VAR_ERROR_NONE, FS_VAR_UPDATE_OP_REMOVE, FS_VAR_UPDATE_OP_RESET,
    FsAVarId, FsEventId, FsObjectId, FsUnitId, FsVarParamArray, FsVarParamTypeInteger,
    FsVarParamVariant, FsVarParamVariant__bindgen_ty_1, FsVarTypeFlags, FsVarUpdateOp,
    KEY_FREEZE_ALTITUDE_SET, KEY_FREEZE_ATTITUDE_SET, KEY_FREEZE_LATITUDE_LONGITUDE_SET,
    fsEventsTriggerKeyEvent, fsVarsAVarGet, fsVarsGetAVarId, fsVarsGetUnitId,
    fsVarsRegisterVarsStatusUpdateHandler, fsVarsUnregisterVarsStatusUpdateHandler,
};

/// Set when the sim removes or resets variables, which fsc-editor's module heard on an
/// aircraft change (measured on MSFS 2024, 2026-08-27, fsc-editor,
/// `docs/sim-vars/build/v1-log.md`, "2026-08-27 — The typed variable API works, and the sim
/// announces invalidation"). The next read then looks every ID up again, rather than trust
/// one the sim may have dropped.
static FORGET: AtomicBool = AtomicBool::new(false);

/// The sim's handler for the status of its variables.
unsafe extern "C" fn on_vars_status(
    _: FsVarTypeFlags,
    operation: FsVarUpdateOp,
    _: FsObjectId,
    _: *mut c_void,
) {
    if operation == FS_VAR_UPDATE_OP_REMOVE || operation == FS_VAR_UPDATE_OP_RESET {
        FORGET.store(true, Ordering::Relaxed);
    }
}

/// Starts hearing the sim's removes and resets of its variables.
pub(crate) fn listen() {
    // SAFETY: the handler reads nothing through its pointer, which is null. `true` is the
    // header's default for its last parameter, `bUseObjIdSpecialValue`.
    unsafe { fsVarsRegisterVarsStatusUpdateHandler(Some(on_vars_status), ptr::null_mut(), true) };
}

pub(crate) fn stop_listening() {
    // SAFETY: as in `listen`, with the same handler and arguments.
    unsafe { fsVarsUnregisterVarsStatusUpdateHandler(Some(on_vars_status), ptr::null_mut(), true) };
}

/// The IDs the sim gave the freeze's variables and their unit.
struct FreezeIds {
    bool_unit: FsUnitId,
    latitude_longitude: FsAVarId,
    altitude: FsAVarId,
    attitude: FsAVarId,
}

impl FreezeIds {
    /// Each ID from the sim, or None while any is missing, so the next read asks again.
    fn look_up() -> Option<FreezeIds> {
        // SAFETY: the sim reads each name, which outlives its call.
        let ids = unsafe {
            FreezeIds {
                bool_unit: fsVarsGetUnitId(c"bool".as_ptr()),
                latitude_longitude: fsVarsGetAVarId(c"IS LATITUDE LONGITUDE FREEZE ON".as_ptr()),
                altitude: fsVarsGetAVarId(c"IS ALTITUDE FREEZE ON".as_ptr()),
                attitude: fsVarsGetAVarId(c"IS ATTITUDE FREEZE ON".as_ptr()),
            }
        };
        let all = [
            ids.bool_unit,
            ids.latitude_longitude,
            ids.altitude,
            ids.attitude,
        ];
        all.iter().all(|&id| id >= 0).then_some(ids)
    }

    fn of(&self, flag: Flag) -> FsAVarId {
        match flag {
            Flag::LatitudeLongitude => self.latitude_longitude,
            Flag::Altitude => self.altitude,
            Flag::Attitude => self.attitude,
        }
    }
}

/// The pilot's aircraft and the objects in the sim, with the IDs the sim gave the freeze's
/// variables, looked up once and kept until the sim removes or resets its variables.
#[derive(Default)]
pub(crate) struct Aircraft {
    ids: Option<FreezeIds>,
}

impl Aircraft {
    fn ids(&mut self) -> Option<&FreezeIds> {
        if self.ids.is_none() {
            self.ids = FreezeIds::look_up();
        }
        self.ids.as_ref()
    }
}

impl Sim for Aircraft {
    /// The routine host asks once a frame, before any routine runs, so the freeze's IDs go
    /// at the same time as the host's own.
    fn reset(&mut self) -> bool {
        let reset = FORGET.swap(false, Ordering::Relaxed);
        if reset {
            self.ids = None;
        }
        reset
    }

    fn look_up(&mut self, object: u32, named: &Named) -> Option<Ids> {
        vars::look_up(object, named)
    }

    fn get(&mut self, object: u32, space: Space, ids: Ids) -> Option<f64> {
        vars::get(object, space, ids)
    }

    fn set(&mut self, object: u32, space: Space, ids: Ids, value: f64) {
        vars::set(object, space, ids, value);
    }

    /// A flag the sim can't read counts as off, so while a routine wants the freeze, the
    /// routine host sends it each frame rather than never sending it.
    fn frozen(&mut self, flag: Flag) -> bool {
        let Some(ids) = self.ids() else {
            return false;
        };
        let mut value = 0.0;
        let none = FsVarParamArray {
            size: 0,
            array: ptr::null_mut(),
        };
        // SAFETY: the sim writes the value into `value`, which outlives the call, and reads
        // no parameter, since `none` holds none.
        let error = unsafe {
            fsVarsAVarGet(
                ids.of(flag),
                ids.bool_unit,
                none,
                &mut value,
                FS_OBJECT_ID_USER_AIRCRAFT,
            )
        };
        error == FS_VAR_ERROR_NONE && value != 0.0
    }

    /// Sends the flag's `_SET` event with 1 to turn it on or 0 to turn it off, as an
    /// integer, the type SimConnect sends an event's value as. It froze a Baron 58P in a
    /// flight at the first send of each flag (measured on MSFS 2024, 2026-10-24,
    /// record/areas/core/log.md).
    fn set_frozen(&mut self, flag: Flag, on: bool) {
        let event = match flag {
            Flag::LatitudeLongitude => KEY_FREEZE_LATITUDE_LONGITUDE_SET,
            Flag::Altitude => KEY_FREEZE_ALTITUDE_SET,
            Flag::Attitude => KEY_FREEZE_ATTITUDE_SET,
        };
        let mut value = FsVarParamVariant {
            type_: FsVarParamTypeInteger,
            __bindgen_anon_1: FsVarParamVariant__bindgen_ty_1 {
                intValue: u32::from(on),
            },
        };
        let values = FsVarParamArray {
            size: 1,
            array: &mut value,
        };
        // SAFETY: the sim reads the one value, which outlives the call.
        unsafe { fsEventsTriggerKeyEvent(event as FsEventId, values) };
    }
}
