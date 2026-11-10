//! p30's standalone module: fires a test `H:` event in five ways, each under a name of its own,
//! so a listener in the cockpit's panels can tell which arrived. In stage 14's session, our
//! module's `fsEventsRegisterHEvent` and `fsEventsHEventCall`, with an empty parameter array
//! whose pointer is null, reached no panel (record/areas/sync/log.md, 2026-11-09).
//!
//! p30-h-events.mjs sets `L:DUALINPUT_P30_FIRE` to a way's number through the inspector. In the
//! next frame, the module fires `DUALINPUT_P30_TEST_<n>` that way, sets `L:DUALINPUT_P30_ID_<n>`
//! to the ID `fsEventsRegisterHEvent` gave, or -1, and `L:DUALINPUT_P30_ERROR_<n>` to what the
//! call returned, then sets FIRE back to 0. `L:DUALINPUT_P30_FRAMES` counts its frames, every
//! 30, so the script can tell it runs. It touches nothing of the aircraft.
//!
//! The ways:
//!   1  fsEventsHEventCall with size 0 and a null array, as our module calls it
//!   2  the same with size 0 and an array that points at a value
//!   3  the same with one integer value, 0
//!   4  the name registered with its `H:`, `H:DUALINPUT_P30_TEST_4`
//!   5  `execute_calculator_code("(>H:DUALINPUT_P30_TEST_5)")`, FS Copilot's way, which returns
//!      1 or 0, its BOOL

mod sys {
    #![allow(non_camel_case_types, non_snake_case, non_upper_case_globals, dead_code, clippy::all)]
    include!(concat!(env!("OUT_DIR"), "/msfs.rs"));
}

use std::ffi::{c_char, CString};
use std::ptr;

extern "C" {
    // The Panels API's calculator code, deprecated in SDK 1.7.3 and still given to modules
    // (read in MSFS 2024 SDK 1.7.3, WASM/include/MSFS/Legacy/gauges.h): BOOL
    // execute_calculator_code(PCSTRINGZ code, FLOAT64* fvalue, SINT32* ivalue, PCSTRINGZ* svalue).
    fn execute_calculator_code(code: *const c_char, fvalue: *mut f64, ivalue: *mut i32, svalue: *mut *const c_char) -> i32;
}

// The sim runs a module on one thread of its own, so nothing else touches these.
static mut FRAMES: u32 = 0;
static mut NUMBER: i32 = -1;
static mut FIRE: i32 = -1;

fn name(suffix: &str) -> CString {
    CString::new(format!("DUALINPUT_P30_{suffix}")).unwrap()
}

unsafe fn number_unit() -> i32 {
    if NUMBER < 0 {
        NUMBER = sys::fsVarsGetUnitId(c"number".as_ptr()) as i32;
    }
    NUMBER
}

unsafe fn set(suffix: &str, value: f64) {
    let lvar = sys::fsVarsRegisterLVar(name(suffix).as_ptr());
    sys::fsVarsLVarSet(lvar, number_unit() as _, value);
}

/// The way FIRE asks for, or 0. It compares floats, since `as i32` on one compiles to
/// `i32.trunc_sat_f64_s`, which cargo-msfs's validator refuses.
unsafe fn fire_requested() -> i32 {
    if FIRE < 0 {
        FIRE = sys::fsVarsRegisterLVar(name("FIRE").as_ptr()) as i32;
    }
    let mut value = 0.0;
    sys::fsVarsLVarGet(FIRE as _, number_unit() as _, &mut value);
    (1..=5).find(|&way| value == f64::from(way)).unwrap_or(0)
}

/// Registers `event` and calls it with `params`, and reports the ID and the call's error.
unsafe fn call(way: i32, event: &str, params: sys::FsVarParamArray) {
    let text = CString::new(event).unwrap();
    let id = sys::fsEventsRegisterHEvent(text.as_ptr());
    set(&format!("ID_{way}"), id as f64);
    let error = sys::fsEventsHEventCall(id, params);
    set(&format!("ERROR_{way}"), error as f64);
}

unsafe fn fire(way: i32) {
    let test = format!("DUALINPUT_P30_TEST_{way}");
    let mut value = sys::FsVarParamVariant {
        type_: sys::FsVarParamTypeInteger,
        __bindgen_anon_1: sys::FsVarParamVariant__bindgen_ty_1 { intValue: 0 },
    };
    match way {
        1 => call(way, &test, sys::FsVarParamArray { size: 0, array: ptr::null_mut() }),
        2 => call(way, &test, sys::FsVarParamArray { size: 0, array: &mut value }),
        3 => call(way, &test, sys::FsVarParamArray { size: 1, array: &mut value }),
        4 => call(way, &format!("H:{test}"), sys::FsVarParamArray { size: 0, array: ptr::null_mut() }),
        5 => {
            let code = CString::new(format!("(>H:{test})")).unwrap();
            let done = execute_calculator_code(code.as_ptr(), ptr::null_mut(), ptr::null_mut(), ptr::null_mut());
            set("ID_5", -1.0);
            set("ERROR_5", done as f64);
        }
        _ => {}
    }
}

#[no_mangle]
pub extern "C" fn module_init() {
    unsafe { set("FRAMES", 0.0) };
}

#[no_mangle]
pub extern "C" fn Update_StandAlone(_delta: f32) {
    unsafe {
        FRAMES = FRAMES.wrapping_add(1);
        if FRAMES % 30 == 0 {
            set("FRAMES", FRAMES as f64);
        }
        let way = fire_requested();
        if way != 0 {
            fire(way);
            set("FIRE", 0.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn module_deinit() {}
