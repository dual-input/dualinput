//! p08's standalone module: p03's, on declarations bindgen generates from the
//! SDK's headers (build.rs), and stamping what it echoes with the clocks it can
//! read. The client writes IN every 200ms with a sequence number and its time on
//! QueryPerformanceCounter; in the frame the module hears a new number, it
//! writes OUT with that number, the client's time, and its own clocks, and sets
//! L:CROSSCHECK_P08_ECHO to the number, so the client can time a data-slot
//! write and a variable it requests through SimConnect from the same frame.
//!
//! OUT, 48 bytes: magic, version, frames, the sequence number (u32 each); the
//! client's time in µs, WASI's monotonic clock in ns, WASI's realtime clock in
//! ns (u64 each); and the sum of Update_StandAlone's frame times in seconds
//! (f64). IN, 16 bytes: the sequence number, 4 bytes unused, the client's time.
//!
//! WASI's clock_time_get is the call wasi-libc's clock_gettime makes, which
//! FS Copilot's module reaches through std::chrono::steady_clock (read in the
//! FS Copilot fork, FsCopilot.Bridge.Wasm/wasm_module.cpp, g_start), so the sim
//! provides it to modules. Whether it counts the same ticks as
//! QueryPerformanceCounter is what p08 measures.
//!
//! It reports how far it got through `L:` variables, which the Vars API sets
//! without SimConnect, as p03's does: CROSSCHECK_P08_STAGE (1 init began, 2
//! SimConnect_Open succeeded, 3 slots made, 4 the first CallDispatch returned),
//! _OPEN, _FAIL_STEP, _FAIL_HR, _EXC_COUNT, _EXC, _CLOCK (the monotonic call's
//! errno), and _FRAMES every 30 frames. It touches nothing of the aircraft.

mod sys {
    #![allow(non_camel_case_types, non_snake_case, non_upper_case_globals, dead_code, clippy::all)]
    include!(concat!(env!("OUT_DIR"), "/msfs.rs"));
}

use std::ffi::{c_void, CString};
use std::mem::{offset_of, size_of};

#[link(wasm_import_module = "wasi_snapshot_preview1")]
extern "C" {
    // WASI preview 1, as the wasi crate declares it: a clock ID, a precision,
    // and where to write the time in ns; it returns an errno.
    fn clock_time_get(id: i32, precision: i64, time: i32) -> i32;
}

const CLOCK_REALTIME: i32 = 0;
const CLOCK_MONOTONIC: i32 = 1;
const MAGIC: u32 = 0x5038_5253;
const VERSION: u32 = 1;
const OUT_AREA: u32 = 0xC800;
const IN_AREA: u32 = 0xC801;
const OUT_DEF: u32 = 0xC800;
const IN_DEF: u32 = 0xC801;
const IN_REQUEST: u32 = 0xC801;

#[repr(C)]
#[derive(Clone, Copy)]
struct Out {
    magic: u32,
    version: u32,
    frames: u32,
    seq: u32,
    core_us: u64,
    mono_ns: u64,
    real_ns: u64,
    delta_sum: f64,
}

const _: () = assert!(size_of::<Out>() == 48);

// The sim runs a module on one thread of its own (05-01), so nothing else touches these.
static mut SIM: sys::HANDLE = 0;
static mut OUT: Out = Out { magic: MAGIC, version: VERSION, frames: 0, seq: 0, core_us: 0, mono_ns: 0, real_ns: 0, delta_sum: 0.0 };
static mut EXCEPTIONS: u32 = 0;
static mut ECHO: i32 = -1;
static mut NUMBER: i32 = -1;

fn name(suffix: &str) -> CString {
    CString::new(format!("CROSSCHECK_P08_{suffix}")).unwrap()
}

unsafe fn number_unit() -> i32 {
    if NUMBER < 0 {
        NUMBER = sys::fsVarsGetUnitId(c"number".as_ptr()) as i32;
    }
    NUMBER
}

unsafe fn report(suffix: &str, value: f64) {
    let lvar = sys::fsVarsRegisterLVar(name(suffix).as_ptr());
    sys::fsVarsLVarSet(lvar, number_unit() as _, value);
}

unsafe fn clock(id: i32) -> (u64, i32) {
    let mut t: u64 = 0;
    let errno = clock_time_get(id, 1, &mut t as *mut u64 as i32);
    (t, errno)
}

unsafe fn write_out() -> sys::HRESULT {
    let mut out = OUT;
    sys::SimConnect_SetClientData(SIM, OUT_AREA, OUT_DEF, 0, 0, size_of::<Out>() as _, (&mut out as *mut Out).cast())
}

unsafe extern "C" fn dispatch(recv: *mut sys::SIMCONNECT_RECV, _size: sys::DWORD, _context: *mut c_void) {
    let id = { (*recv).dwID } as i32;
    if id == sys::SIMCONNECT_RECV_ID_EXCEPTION as i32 {
        let e = recv as *const sys::SIMCONNECT_RECV_EXCEPTION;
        EXCEPTIONS += 1;
        report("EXC_COUNT", EXCEPTIONS as f64);
        report("EXC", { (*e).dwException } as f64);
    } else if id == sys::SIMCONNECT_RECV_ID_CLIENT_DATA as i32 {
        let d = recv as *const sys::SIMCONNECT_RECV_SIMOBJECT_DATA;
        if { (*d).dwRequestID } != IN_REQUEST {
            return;
        }
        let data = (recv as *const u8).add(offset_of!(sys::SIMCONNECT_RECV_SIMOBJECT_DATA, dwData));
        let seq = std::ptr::read_unaligned(data as *const u32);
        let core_us = std::ptr::read_unaligned(data.add(8) as *const u64);
        if seq == OUT.seq {
            return;
        }
        // Stamped as it's heard, in the frame it's heard, then echoed.
        let (mono, errno) = clock(CLOCK_MONOTONIC);
        let (real, _) = clock(CLOCK_REALTIME);
        if OUT.seq == 0 {
            report("CLOCK", errno as f64);
        }
        OUT.seq = seq;
        OUT.core_us = core_us;
        OUT.mono_ns = mono;
        OUT.real_ns = real;
        write_out();
        if ECHO < 0 {
            ECHO = sys::fsVarsRegisterLVar(name("ECHO").as_ptr()) as i32;
        }
        sys::fsVarsLVarSet(ECHO as _, number_unit() as _, seq as f64);
    }
}

#[no_mangle]
pub extern "C" fn module_init() {
    unsafe {
        report("STAGE", 1.0);
        let client = name("CLIENT");
        let opened = sys::SimConnect_Open(&raw mut SIM, client.as_ptr(), std::mem::zeroed(), 0, 0, 0);
        report("OPEN", opened as f64);
        if opened != 0 {
            SIM = 0;
            return;
        }
        report("STAGE", 2.0);
        let (out_name, in_name) = (name("OUT"), name("IN"));
        let steps: [&dyn Fn() -> sys::HRESULT; 8] = [
            &|| sys::SimConnect_MapClientDataNameToID(SIM, out_name.as_ptr(), OUT_AREA),
            &|| sys::SimConnect_CreateClientData(SIM, OUT_AREA, size_of::<Out>() as _, 0),
            &|| sys::SimConnect_AddToClientDataDefinition(SIM, OUT_DEF, 0, size_of::<Out>() as _, 0.0, sys::SIMCONNECT_UNUSED),
            &|| sys::SimConnect_MapClientDataNameToID(SIM, in_name.as_ptr(), IN_AREA),
            &|| sys::SimConnect_CreateClientData(SIM, IN_AREA, 16, 0),
            &|| sys::SimConnect_AddToClientDataDefinition(SIM, IN_DEF, 0, 16, 0.0, sys::SIMCONNECT_UNUSED),
            &|| sys::SimConnect_RequestClientData(SIM, IN_AREA, IN_REQUEST, IN_DEF, sys::SIMCONNECT_CLIENT_DATA_PERIOD_ON_SET, 0, 0, 0, 0),
            &|| write_out(),
        ];
        let mut failed = false;
        for (i, step) in steps.iter().enumerate() {
            let hr = step();
            if hr != 0 && !failed {
                failed = true;
                report("FAIL_STEP", (i + 1) as f64);
                report("FAIL_HR", hr as f64);
            }
        }
        report("STAGE", 3.0);
        sys::SimConnect_CallDispatch(SIM, Some(dispatch), std::ptr::null_mut());
        report("STAGE", 4.0);
    }
}

#[no_mangle]
pub extern "C" fn Update_StandAlone(delta: f32) {
    unsafe {
        OUT.frames = OUT.frames.wrapping_add(1);
        OUT.delta_sum += delta as f64;
        if OUT.frames % 30 == 0 {
            report("FRAMES", OUT.frames as f64);
        }
        if SIM == 0 {
            return;
        }
        sys::SimConnect_CallDispatch(SIM, Some(dispatch), std::ptr::null_mut());
    }
}

#[no_mangle]
pub extern "C" fn module_deinit() {
    unsafe {
        if SIM != 0 {
            sys::SimConnect_Close(SIM);
            SIM = 0;
        }
    }
}
