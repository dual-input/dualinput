//! The routine host's named variables, through the sim's Vars API, which takes IDs the host
//! looks up here once and keeps (record/areas/core/03-sim-seam-and-wasm-module.md, "Wants and
//! the sim's APIs").

use std::ffi::CString;
use std::ptr;

use routine_host::{Ids, Named, Space};

use crate::bindings::{
    FS_VAR_ERROR_NONE, FsObjectId, FsVarParamArray, fsVarsAVarGet, fsVarsAVarSet, fsVarsEVarGet,
    fsVarsGetAVarId, fsVarsGetEVarId, fsVarsGetUnitId, fsVarsLVarGet, fsVarsLVarSet,
    fsVarsRegisterLVar, fsVarsRegisterZVar, fsVarsZVarGet, fsVarsZVarSet,
};

/// No parameters, for a variable with no index.
const NONE: FsVarParamArray = FsVarParamArray {
    size: 0,
    array: ptr::null_mut(),
};

/// The IDs of `named` and its unit: an `A:` variable's through `fsVarsGetAVarId`, an `E:`
/// one's through `fsVarsGetEVarId`, an `L:` one's through `fsVarsRegisterLVar`, since
/// `fsVarsGetLVarId` returns -1 for one that doesn't exist yet and doesn't create it, and a
/// `Z:` one's on `object` through `fsVarsRegisterZVar`.
pub(crate) fn look_up(object: u32, named: &Named) -> Option<Ids> {
    let name = CString::new(named.name.as_str()).ok()?;
    let unit = CString::new(named.unit.as_str()).ok()?;
    // SAFETY: the sim reads each name, which outlives its call.
    let ids = unsafe {
        Ids {
            var: match named.space {
                Space::A => fsVarsGetAVarId(name.as_ptr()),
                Space::E => fsVarsGetEVarId(name.as_ptr()),
                Space::L => fsVarsRegisterLVar(name.as_ptr()),
                Space::Z => fsVarsRegisterZVar(name.as_ptr(), object as FsObjectId),
            },
            unit: fsVarsGetUnitId(unit.as_ptr()),
        }
    };
    (ids.var >= 0 && ids.unit >= 0).then_some(ids)
}

pub(crate) fn get(object: u32, space: Space, ids: Ids) -> Option<f64> {
    let mut value = 0.0;
    let target = object as FsObjectId;
    // SAFETY: the sim writes the value into `value`, which outlives the call, and reads no
    // parameter, since `NONE` holds none.
    let error = unsafe {
        match space {
            Space::A => fsVarsAVarGet(ids.var, ids.unit, NONE, &mut value, target),
            Space::E => fsVarsEVarGet(ids.var, ids.unit, &mut value),
            Space::L => fsVarsLVarGet(ids.var, ids.unit, &mut value),
            Space::Z => fsVarsZVarGet(ids.var, ids.unit, &mut value, target),
        }
    };
    (error == FS_VAR_ERROR_NONE).then_some(value)
}

/// Writes `value` into the variable. The Vars API has no write for an `E:` variable, so a
/// write to one does nothing.
pub(crate) fn set(object: u32, space: Space, ids: Ids, value: f64) {
    let target = object as FsObjectId;
    // SAFETY: the sim reads no parameter, since `NONE` holds none.
    unsafe {
        match space {
            Space::A => fsVarsAVarSet(ids.var, ids.unit, NONE, value, target),
            Space::E => return,
            Space::L => fsVarsLVarSet(ids.var, ids.unit, value),
            Space::Z => fsVarsZVarSet(ids.var, ids.unit, value, target),
        }
    };
}
