//! p33's part in our WASM module, compiled in only through module.patch, which is never
//! committed into src/. It runs the probe's scripts, one list of steps for each of the
//! module's frames, and writes back what each step gave, so the probe can ask how the sim
//! orders and applies the events of one frame without rebuilding the module for each question.
//!
//! The probe writes a script into the client data area `DUALINPUT_P33_CMD`:
//!
//!   run 7
//!   calc (>K:AP_ALT_HOLD) (A:AUTOPILOT ALTITUDE LOCK, Bool)
//!   key AP_PANEL_VS_HOLD 1
//!   next
//!   calc (A:AUTOPILOT VERTICAL HOLD, Bool)
//!
//! `calc` runs calculator code and keeps the number it leaves, `key` sends a key event through
//! the Events API with its value, as the routine host's `key` does, and `next` ends the frame's
//! steps. Once the last frame has run, the module writes `done 7` into `DUALINPUT_P33_OUT`, then
//! a line for each step: the frame it ran in, the µs since the script's first frame, and its
//! number, 0 for a `key`.

use std::cell::RefCell;
use std::ffi::{CString, c_void};
use std::fmt::Write as _;
use std::ptr;

use crate::bindings::{
    DWORD, FsEventId, FsVarParamArray, FsVarParamTypeInteger, FsVarParamVariant,
    FsVarParamVariant__bindgen_ty_1, HANDLE, KEY_AP_ALT_HOLD, KEY_AP_ALT_HOLD_OFF,
    KEY_AP_ALT_HOLD_ON, KEY_AP_PANEL_VS_HOLD, KEY_AP_PITCH_LEVELER_ON, KEY_AP_VS_OFF,
    KEY_AP_VS_ON, KEY_HEADING_BUG_SET, SIMCONNECT_CLIENT_DATA_PERIOD_ON_SET,
    SIMCONNECT_CLIENT_DATA_SET_FLAG_DEFAULT, SIMCONNECT_CREATE_CLIENT_DATA_FLAG_DEFAULT,
    SIMCONNECT_CREATE_CLIENT_DATA_FLAG_READ_ONLY, SIMCONNECT_RECV, SIMCONNECT_RECV_ID_CLIENT_DATA,
    SIMCONNECT_RECV_SIMOBJECT_DATA, SIMCONNECT_UNUSED, SimConnect_AddToClientDataDefinition,
    SimConnect_CallDispatch, SimConnect_Close, SimConnect_CreateClientData,
    SimConnect_MapClientDataNameToID, SimConnect_Open, SimConnect_RequestClientData,
    SimConnect_SetClientData, execute_calculator_code, fsEventsTriggerKeyEvent,
};

const CMD: u32 = 0;
const OUT: u32 = 1;
const CMD_BYTES: u32 = 4096;
const OUT_BYTES: u32 = 8192;

enum Step {
    Calc(CString),
    Key(u32, u32),
}

struct Probe {
    handle: HANDLE,
    token: String,
    frames: Vec<Vec<Step>>,
    frame: usize,
    started: u64,
    results: String,
}

thread_local! {
    static PROBE: RefCell<Option<Probe>> = const { RefCell::new(None) };
    static GATHERED: RefCell<Vec<Vec<u8>>> = const { RefCell::new(Vec::new()) };
}

/// Opens p33's own connection and its two areas.
pub(crate) fn open() {
    let mut handle: HANDLE = 0;
    // SAFETY: SimConnect writes the handle and reads the name, which outlives the call.
    let opened = unsafe { SimConnect_Open(&mut handle, c"Dual Input p33".as_ptr(), ptr::null_mut(), 0, 0, 0) };
    if opened != 0 {
        return;
    }
    // SAFETY: SimConnect reads each name, which outlives its call; the rest are numbers.
    unsafe {
        SimConnect_MapClientDataNameToID(handle, c"DUALINPUT_P33_CMD".as_ptr(), CMD);
        SimConnect_CreateClientData(handle, CMD, CMD_BYTES, SIMCONNECT_CREATE_CLIENT_DATA_FLAG_DEFAULT);
        SimConnect_AddToClientDataDefinition(handle, CMD, 0, CMD_BYTES, 0.0, SIMCONNECT_UNUSED);
        SimConnect_RequestClientData(handle, CMD, CMD, CMD, SIMCONNECT_CLIENT_DATA_PERIOD_ON_SET, 0, 0, 0, 0);
        SimConnect_MapClientDataNameToID(handle, c"DUALINPUT_P33_OUT".as_ptr(), OUT);
        SimConnect_CreateClientData(handle, OUT, OUT_BYTES, SIMCONNECT_CREATE_CLIENT_DATA_FLAG_READ_ONLY);
        SimConnect_AddToClientDataDefinition(handle, OUT, 0, OUT_BYTES, 0.0, SIMCONNECT_UNUSED);
    }
    PROBE.with(|p| {
        *p.borrow_mut() = Some(Probe {
            handle,
            token: String::new(),
            frames: Vec::new(),
            frame: 0,
            started: 0,
            results: String::new(),
        })
    });
}

pub(crate) fn close() {
    PROBE.with(|p| {
        if let Some(probe) = p.borrow_mut().take() {
            // SAFETY: nothing uses the handle after this.
            unsafe { SimConnect_Close(probe.handle) };
        }
    });
}

/// Once a frame, after the routine host's frame: takes a new script, and runs its next frame.
pub(crate) fn frame() {
    PROBE.with(|p| {
        let Ok(mut p) = p.try_borrow_mut() else { return };
        let Some(probe) = p.as_mut() else { return };
        // SAFETY: SimConnect calls `gather` only inside this call.
        unsafe { SimConnect_CallDispatch(probe.handle, Some(gather), ptr::null_mut()) };
        if let Some(bytes) = GATHERED.with(|g| g.take()).pop() {
            probe.take(&bytes);
        }
        probe.step();
    });
}

impl Probe {
    fn take(&mut self, bytes: &[u8]) {
        let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
        let text = String::from_utf8_lossy(bytes.get(..end).unwrap_or_default()).to_string();
        let mut lines = text.lines();
        let Some(token) = lines.next().and_then(|l| l.strip_prefix("run ")) else { return };
        if token == self.token {
            return;
        }
        self.token = token.to_string();
        self.frames = vec![Vec::new()];
        for line in lines {
            let line = line.trim();
            if line == "next" {
                self.frames.push(Vec::new());
            } else if let Some(code) = line.strip_prefix("calc ") {
                if let (Ok(code), Some(frame)) = (CString::new(code), self.frames.last_mut()) {
                    frame.push(Step::Calc(code));
                }
            } else if let Some(rest) = line.strip_prefix("key ") {
                let mut words = rest.split_whitespace();
                let event = words.next().and_then(key_id);
                let value = words.next().and_then(|v| v.parse::<i64>().ok()).unwrap_or(0) as u32;
                if let (Some(event), Some(frame)) = (event, self.frames.last_mut()) {
                    frame.push(Step::Key(event, value));
                }
            }
        }
        self.frames.reverse();
        self.frame = 0;
        self.started = crate::clock_us();
        self.results = format!("done {}\n", self.token);
    }

    fn step(&mut self) {
        let Some(steps) = self.frames.pop() else { return };
        for step in steps {
            let value = match step {
                Step::Calc(code) => {
                    let mut value = 0.0;
                    // SAFETY: the sim reads the code, which outlives the call, and writes one number.
                    unsafe { execute_calculator_code(code.as_ptr(), &mut value, ptr::null_mut(), ptr::null_mut()) };
                    value
                }
                Step::Key(event, value) => {
                    let mut param = FsVarParamVariant {
                        type_: FsVarParamTypeInteger,
                        __bindgen_anon_1: FsVarParamVariant__bindgen_ty_1 { intValue: value },
                    };
                    let params = FsVarParamArray { size: 1, array: &mut param };
                    // SAFETY: the sim reads the one value, which outlives the call.
                    unsafe { fsEventsTriggerKeyEvent(event as FsEventId, params) };
                    0.0
                }
            };
            let us = crate::clock_us().saturating_sub(self.started);
            let _ = writeln!(self.results, "{} {} {}", self.frame, us, value);
        }
        self.frame += 1;
        if self.frames.is_empty() {
            let mut bytes = self.results.clone().into_bytes();
            bytes.resize(OUT_BYTES as usize, 0);
            // SAFETY: SimConnect copies the bytes out during the call.
            unsafe {
                SimConnect_SetClientData(
                    self.handle,
                    OUT,
                    OUT,
                    SIMCONNECT_CLIENT_DATA_SET_FLAG_DEFAULT,
                    0,
                    OUT_BYTES as DWORD,
                    bytes.as_mut_ptr().cast(),
                )
            };
        }
    }
}

fn key_id(name: &str) -> Option<u32> {
    Some(match name {
        "AP_ALT_HOLD" => KEY_AP_ALT_HOLD,
        "AP_ALT_HOLD_ON" => KEY_AP_ALT_HOLD_ON,
        "AP_ALT_HOLD_OFF" => KEY_AP_ALT_HOLD_OFF,
        "AP_PANEL_VS_HOLD" => KEY_AP_PANEL_VS_HOLD,
        "AP_VS_ON" => KEY_AP_VS_ON,
        "AP_VS_OFF" => KEY_AP_VS_OFF,
        "AP_PITCH_LEVELER_ON" => KEY_AP_PITCH_LEVELER_ON,
        "HEADING_BUG_SET" => KEY_HEADING_BUG_SET,
        _ => return None,
    })
}

/// As connection.rs's `gather`, for p33's own connection: each client data message's bytes.
unsafe extern "C" fn gather(recv: *mut SIMCONNECT_RECV, size: DWORD, _: *mut c_void) {
    if recv.is_null() {
        return;
    }
    // SAFETY: SimConnect hands a message of `size` bytes, which lives through this call.
    unsafe {
        if (*recv).dwID != SIMCONNECT_RECV_ID_CLIENT_DATA as DWORD {
            return;
        }
        let start = std::mem::offset_of!(SIMCONNECT_RECV_SIMOBJECT_DATA, dwData);
        let Some(len) = (size as usize).checked_sub(start) else { return };
        let bytes = std::slice::from_raw_parts(recv.cast::<u8>().add(start), len);
        GATHERED.with(|g| {
            if let Ok(mut g) = g.try_borrow_mut() {
                g.push(bytes.to_vec());
            }
        });
    }
}
