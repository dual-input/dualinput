//! The pilot's aircraft and the objects in the sim, as the routine host reaches them through
//! the sim's Vars and Events APIs (record/areas/core/03-sim-seam-and-wasm-module.md, "Wants
//! and the sim's APIs").

use std::collections::BTreeMap;
use std::ffi::{CString, c_void};
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};

use routine_host::{Flag, Ids, Key, Named, Sim, Space};

use crate::vars;

use crate::bindings::{
    FS_OBJECT_ID_USER_AIRCRAFT, FS_VAR_ERROR_NONE, FS_VAR_UPDATE_OP_REMOVE, FS_VAR_UPDATE_OP_RESET,
    FsAVarId, FsBVarId, FsEventId, FsObjectId, FsUnitId, FsVarParamArray, FsVarParamTypeDouble,
    FsVarParamTypeInteger, FsVarParamVariant, FsVarParamVariant__bindgen_ty_1, FsVarTypeFlags,
    FsVarUpdateOp, KEY_AXIS_AILERONS_SET, KEY_AXIS_ELEVATOR_SET, KEY_AXIS_LEFT_BRAKE_SET,
    KEY_AXIS_RIGHT_BRAKE_SET, KEY_AXIS_RUDDER_SET, KEY_FREEZE_ALTITUDE_SET,
    KEY_FREEZE_ATTITUDE_SET, KEY_FREEZE_LATITUDE_LONGITUDE_SET, execute_calculator_code,
    fsEventsTriggerKeyEvent, fsVarsAVarGet, fsVarsBVarCall, fsVarsGetAVarId, fsVarsGetBVarId,
    fsVarsGetUnitId, fsVarsRegisterVarsStatusUpdateHandler,
    fsVarsUnregisterVarsStatusUpdateHandler,
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
    /// Each preset's ID, by its name, which a reset of the sim's variables drops.
    presets: BTreeMap<String, FsBVarId>,
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
            self.presets.clear();
        }
        reset
    }

    /// Fires the `H:` event as calculator code, `(>H:name)`, since the Events API's
    /// `fsEventsHEventCall` returned `FS_EVENTS_ERROR_FAIL` and reached no cockpit panel, while
    /// calculator code reached every one (measured on MSFS 2024, 2026-11-10,
    /// record/areas/sync/log.md). A name that could close the code's parenthesis or add a word
    /// to it is no `H:` event's, so it fires nothing.
    fn fire_h(&mut self, name: &str) {
        let plain = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ':');
        if name.is_empty() || !name.chars().all(plain) {
            return;
        }
        let Ok(code) = CString::new(format!("(>H:{name})")) else {
            return;
        };
        // SAFETY: the sim reads the code, which outlives the call, and writes no result, since
        // each result's pointer is null.
        unsafe {
            execute_calculator_code(
                code.as_ptr(),
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
    }

    /// Calls a preset by the name it has, such as `ELECTRICAL_Battery_1_Toggle`, which
    /// `fsVarsGetBVarId` takes with `callable` true. An ID the sim refuses isn't kept, so the
    /// next call asks again, and the 1.5s check flags a write it swallows. Only `_Toggle`,
    /// with no value, has run in the sim, so whether a `_Set` takes its value as one double is
    /// unverified (record/areas/sync/log.md, 2026-11-10).
    fn call_preset(&mut self, name: &str, value: Option<f64>) {
        let id = match self.presets.get(name) {
            Some(&id) => id,
            None => {
                let Ok(text) = CString::new(name) else {
                    return;
                };
                // SAFETY: the sim reads the name, which outlives the call.
                let id =
                    unsafe { fsVarsGetBVarId(text.as_ptr(), true, FS_OBJECT_ID_USER_AIRCRAFT) };
                if id < 0 {
                    return;
                }
                self.presets.insert(name.to_string(), id);
                id
            }
        };
        let mut param = FsVarParamVariant {
            type_: FsVarParamTypeDouble,
            __bindgen_anon_1: FsVarParamVariant__bindgen_ty_1 {
                doubleValue: value.unwrap_or(0.0),
            },
        };
        let params = FsVarParamArray {
            size: u32::from(value.is_some()),
            array: if value.is_some() {
                &mut param
            } else {
                ptr::null_mut()
            },
        };
        // SAFETY: the sim reads at most the one value, which outlives the call.
        unsafe { fsVarsBVarCall(id, params, FS_OBJECT_ID_USER_AIRCRAFT) };
    }

    /// Sends the event with its value as an integer, the type SimConnect sends an event's
    /// value as. The Events API's integer is unsigned, so a negative value goes as its two's
    /// complement, as SimConnect's `DWORD` carries one.
    fn key(&mut self, key: Key, value: i32) {
        let event = match key {
            Key::AxisAilerons => KEY_AXIS_AILERONS_SET,
            Key::AxisElevator => KEY_AXIS_ELEVATOR_SET,
            Key::AxisRudder => KEY_AXIS_RUDDER_SET,
            Key::AxisLeftBrake => KEY_AXIS_LEFT_BRAKE_SET,
            Key::AxisRightBrake => KEY_AXIS_RIGHT_BRAKE_SET,
        };
        let mut param = FsVarParamVariant {
            type_: FsVarParamTypeInteger,
            __bindgen_anon_1: FsVarParamVariant__bindgen_ty_1 {
                intValue: value as u32,
            },
        };
        let params = FsVarParamArray {
            size: 1,
            array: &mut param,
        };
        // SAFETY: the sim reads the one value, which outlives the call.
        unsafe { fsEventsTriggerKeyEvent(event as FsEventId, params) };
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
