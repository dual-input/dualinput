//! p03's standalone module, in Rust: the smallest version of what our WASM
//! module does with the core. At load it creates two data slots and leaves its
//! version in one; each frame it counts, writes the count, and copies whatever
//! the core last wrote into the other slot back into its own, so the core can
//! tell a module that loaded, one that ticks, and one that hears it.
//!
//! build.rs makes each variant: its letter, the first SimConnect ID its slots
//! use, and whether the SDK's MSFS_WasmVersions.a is linked in. Each variant
//! also reports how far it got through `L:` variables, which the Vars API sets
//! without SimConnect, so a module whose SimConnect calls fail still says so:
//!   STAGE      1 init began, 2 SimConnect_Open succeeded, 3 slots made and
//!              written, 4 the first CallDispatch returned
//!   OPEN       SimConnect_Open's HRESULT, and HANDLE the handle it gave
//!   FAIL_STEP  the first of the eight calls after Open to return an error, and
//!   FAIL_HR    its HRESULT
//!   SEND_FIRST the send ID of the first of those eight calls, so an exception's
//!              send ID names the call that caused it
//!   EXC_COUNT, EXC, EXC_SEND, EXC_INDEX   the SimConnect exceptions the module
//!              received, the last one's code, send ID, and parameter
//!   FRAMES     the frame count, every 30 frames
//!
//! The sim's functions are imports; cargo-msfs links with `--allow-undefined`,
//! which turns each undeclared function into an import from `env`, as the SDK's
//! toolset does for the C++ modules.

use std::ffi::{c_char, c_void, CString};
use std::mem::size_of;
use std::ptr::null_mut;

mod config {
    include!(concat!(env!("OUT_DIR"), "/config.rs"));
}

// HANDLE is 64 bits inside a module, though pointers are 32 (read in MSFS 2024 SDK
// 1.7.3, WASM/include/MSFS/MSFS_WindowsTypes.h: `typedef unsigned long long HANDLE`).
// Declared as a pointer, the handle came back cut to 32 bits, and every call
// after SimConnect_Open failed with E_FAIL (p03's third and fourth runs).
type Handle = u64;

#[repr(C)]
struct Recv {
    size: u32,
    version: u32,
    id: u32,
}

// SIMCONNECT_RECV_EXCEPTION.
#[repr(C)]
struct RecvException {
    recv: Recv,
    exception: u32,
    send_id: u32,
    index: u32,
}

// SIMCONNECT_RECV_CLIENT_DATA, which is SIMCONNECT_RECV_SIMOBJECT_DATA, with the
// first DWORD of the data.
#[repr(C)]
struct RecvClientData {
    recv: Recv,
    request_id: u32,
    object_id: u32,
    define_id: u32,
    flags: u32,
    entry_number: u32,
    out_of: u32,
    define_count: u32,
    data: u32,
}

// What the module writes to its OUT slot.
#[repr(C)]
#[derive(Clone, Copy)]
struct Out {
    magic: u32,
    version: u32,
    inits: u32,
    frames: u32,
    echo: u32,
}

// A value the reader checks for, so it can tell our slot from an empty one.
const MAGIC: u32 = 0x5033_5253;
const VERSION: u32 = 1;
const RECV_ID_EXCEPTION: u32 = 1;
const RECV_ID_CLIENT_DATA: u32 = 16;
const PERIOD_ON_SET: u32 = 3;
const UNUSED: u32 = u32::MAX;
const OUT_AREA: u32 = config::BASE_ID;
const IN_AREA: u32 = config::BASE_ID + 1;
const OUT_DEF: u32 = config::BASE_ID;
const IN_DEF: u32 = config::BASE_ID + 1;
const IN_REQUEST: u32 = config::BASE_ID;

extern "C" {
    fn SimConnect_Open(handle: *mut Handle, name: *const c_char, hwnd: *mut c_void, user_event: u32, event: Handle, config_index: u32) -> i32;
    fn SimConnect_Close(handle: Handle) -> i32;
    fn SimConnect_CallDispatch(handle: Handle, dispatch: extern "C" fn(*const Recv, u32, *mut c_void), context: *mut c_void) -> i32;
    fn SimConnect_GetLastSentPacketID(handle: Handle, send_id: *mut u32) -> i32;
    fn SimConnect_MapClientDataNameToID(handle: Handle, name: *const c_char, id: u32) -> i32;
    fn SimConnect_CreateClientData(handle: Handle, id: u32, size: u32, flags: u32) -> i32;
    fn SimConnect_AddToClientDataDefinition(handle: Handle, define_id: u32, offset: u32, size: u32, epsilon: f32, datum_id: u32) -> i32;
    fn SimConnect_SetClientData(handle: Handle, id: u32, define_id: u32, flags: u32, reserved: u32, size: u32, data: *const c_void) -> i32;
    fn SimConnect_RequestClientData(handle: Handle, id: u32, request_id: u32, define_id: u32, period: u32, flags: u32, origin: u32, interval: u32, limit: u32) -> i32;
    fn fsVarsRegisterLVar(name: *const c_char) -> i32;
    fn fsVarsLVarSet(lvar: i32, unit: i32, value: f64) -> i32;
    fn fsVarsGetUnitId(name: *const c_char) -> i32;
}

// The sim runs a module on one thread of its own (05-01), so nothing else touches these.
static mut SIM: Handle = 0;
static mut OUT: Out = Out { magic: MAGIC, version: VERSION, inits: 0, frames: 0, echo: 0 };
static mut EXCEPTIONS: u32 = 0;

fn name(suffix: &str) -> CString {
    CString::new(format!("CROSSCHECK_P03{}_{suffix}", config::TAG)).unwrap()
}

unsafe fn report(suffix: &str, value: f64) {
    let lvar = fsVarsRegisterLVar(name(suffix).as_ptr());
    fsVarsLVarSet(lvar, fsVarsGetUnitId(c"number".as_ptr()), value);
}

unsafe fn write_out() -> i32 {
    let out = OUT;
    SimConnect_SetClientData(SIM, OUT_AREA, OUT_DEF, 0, 0, size_of::<Out>() as u32, (&out as *const Out).cast())
}

extern "C" fn dispatch(recv: *const Recv, _size: u32, _context: *mut c_void) {
    unsafe {
        match (*recv).id {
            RECV_ID_EXCEPTION => {
                let e = &*(recv as *const RecvException);
                EXCEPTIONS += 1;
                report("EXC_COUNT", EXCEPTIONS as f64);
                report("EXC", e.exception as f64);
                report("EXC_SEND", e.send_id as f64);
                report("EXC_INDEX", e.index as f64);
            }
            RECV_ID_CLIENT_DATA => {
                let data = &*(recv as *const RecvClientData);
                if data.request_id == IN_REQUEST {
                    OUT.echo = data.data;
                }
            }
            _ => {}
        }
    }
}

#[no_mangle]
pub extern "C" fn module_init() {
    unsafe {
        OUT.inits += 1;
        report("STAGE", 1.0);
        let opened = SimConnect_Open(&raw mut SIM, name("CLIENT").as_ptr(), null_mut(), 0, 0, 0);
        report("OPEN", opened as f64);
        report("HANDLE", SIM as f64);
        if opened != 0 {
            SIM = 0;
            return;
        }
        report("STAGE", 2.0);
        let (out_name, in_name) = (name("OUT"), name("IN"));
        let mut first_send = 0u32;
        let steps: [&dyn Fn() -> i32; 8] = [
            &|| SimConnect_MapClientDataNameToID(SIM, out_name.as_ptr(), OUT_AREA),
            &|| SimConnect_CreateClientData(SIM, OUT_AREA, size_of::<Out>() as u32, 0),
            &|| SimConnect_AddToClientDataDefinition(SIM, OUT_DEF, 0, size_of::<Out>() as u32, 0.0, UNUSED),
            &|| SimConnect_MapClientDataNameToID(SIM, in_name.as_ptr(), IN_AREA),
            &|| SimConnect_CreateClientData(SIM, IN_AREA, 4, 0),
            &|| SimConnect_AddToClientDataDefinition(SIM, IN_DEF, 0, 4, 0.0, UNUSED),
            &|| SimConnect_RequestClientData(SIM, IN_AREA, IN_REQUEST, IN_DEF, PERIOD_ON_SET, 0, 0, 0, 0),
            &|| write_out(),
        ];
        let mut failed = false;
        for (i, step) in steps.iter().enumerate() {
            let hr = step();
            if i == 0 {
                SimConnect_GetLastSentPacketID(SIM, &mut first_send);
                report("SEND_FIRST", first_send as f64);
            }
            if hr != 0 && !failed {
                failed = true;
                report("FAIL_STEP", (i + 1) as f64);
                report("FAIL_HR", hr as f64);
            }
        }
        report("STAGE", 3.0);
        SimConnect_CallDispatch(SIM, dispatch, null_mut());
        report("STAGE", 4.0);
    }
}

#[no_mangle]
pub extern "C" fn Update_StandAlone(_delta: f32) {
    unsafe {
        OUT.frames = OUT.frames.wrapping_add(1);
        if OUT.frames % 30 == 0 {
            report("FRAMES", OUT.frames as f64);
        }
        if SIM == 0 {
            return;
        }
        SimConnect_CallDispatch(SIM, dispatch, null_mut());
        write_out();
    }
}

#[no_mangle]
pub extern "C" fn module_deinit() {
    unsafe {
        if SIM != 0 {
            SimConnect_Close(SIM);
            SIM = 0;
        }
    }
}
