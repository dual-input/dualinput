//! p11's module: the edge, the one code here that calls the sim, around the
//! module host and the one list of routines. It opens SimConnect, creates a slot
//! for each routine as CROSSCHECK_P11_<ID>, hands each write to the host, and
//! each frame carries out what the host returns: the freeze through SimConnect's
//! client events, and the writes through the Vars API. p11 builds it and checks
//! its exports and imports; nothing here has run in the sim.

mod sys {
    #![allow(non_camel_case_types, non_snake_case, non_upper_case_globals, dead_code, unsafe_op_in_unsafe_fn, clippy::all)]
    include!(concat!(env!("OUT_DIR"), "/msfs.rs"));
}

use std::cell::{Cell, RefCell};
use std::ffi::{CString, c_void};
use std::mem::offset_of;
use std::time::Instant;

use module_host::{Frame, Host, routines};

const FIRST_ID: u32 = 0xCB00;
const FREEZE_EVENTS: [&str; 3] = ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"];
const FREEZE_EVENT_ID: u32 = 0xCBF0;

struct Edge {
    host: Host,
    slots: Vec<&'static str>,
    started: Instant,
}

thread_local! {
    // The sim runs a module on one thread of its own (05-01).
    static SIM: Cell<sys::HANDLE> = const { Cell::new(0) };
    static EDGE: RefCell<Option<Edge>> = const { RefCell::new(None) };
}

fn now_us(edge: &Edge) -> u64 {
    edge.started.elapsed().as_micros() as u64
}

unsafe extern "C" fn dispatch(recv: *mut sys::SIMCONNECT_RECV, _size: sys::DWORD, _context: *mut c_void) {
    unsafe {
        if { (*recv).dwID } as i32 != sys::SIMCONNECT_RECV_ID_CLIENT_DATA as i32 {
            return;
        }
        let d = recv as *const sys::SIMCONNECT_RECV_SIMOBJECT_DATA;
        let index = ({ (*d).dwRequestID } - FIRST_ID) as usize;
        let words = { (*d).dwDefineCount } as usize;
        let data = (recv as *const u8).add(offset_of!(sys::SIMCONNECT_RECV_SIMOBJECT_DATA, dwData));
        EDGE.with_borrow_mut(|e| {
            let Some(e) = e else { return };
            let Some(id) = e.slots.get(index).copied() else { return };
            let now = now_us(e);
            let bytes = std::slice::from_raw_parts(data, words.max(1) * 4);
            e.host.write(id, now, bytes);
        });
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn module_init() {
    let host = routines![follow::Follow];
    let slots = host.slots();
    let mut sim: sys::HANDLE = 0;
    unsafe {
        let client = CString::new("CROSSCHECK_P11").unwrap();
        if sys::SimConnect_Open(&mut sim, client.as_ptr(), std::mem::zeroed(), 0, 0, 0) != 0 {
            return;
        }
        for (i, (id, size)) in slots.iter().enumerate() {
            let area = FIRST_ID + i as u32;
            let name = CString::new(format!("CROSSCHECK_P11_{id}")).unwrap();
            sys::SimConnect_MapClientDataNameToID(sim, name.as_ptr(), area);
            sys::SimConnect_CreateClientData(sim, area, *size as _, 0);
            sys::SimConnect_AddToClientDataDefinition(sim, area, 0, *size as _, 0.0, sys::SIMCONNECT_UNUSED);
            sys::SimConnect_RequestClientData(sim, area, area, area, sys::SIMCONNECT_CLIENT_DATA_PERIOD_ON_SET, 0, 0, 0, 0);
        }
        for (i, event) in FREEZE_EVENTS.iter().enumerate() {
            let name = CString::new(*event).unwrap();
            sys::SimConnect_MapClientEventToSimEvent(sim, FREEZE_EVENT_ID + i as u32, name.as_ptr());
        }
    }
    SIM.set(sim);
    EDGE.set(Some(Edge { host, slots: slots.iter().map(|(id, _)| *id).collect(), started: Instant::now() }));
}

#[unsafe(no_mangle)]
pub extern "C" fn Update_StandAlone(_delta: f32) {
    let sim = SIM.get();
    if sim == 0 {
        return;
    }
    // No borrow of EDGE is held across the dispatch, which borrows it itself.
    unsafe { sys::SimConnect_CallDispatch(sim, Some(dispatch), std::ptr::null_mut()) };
    let actions = EDGE.with_borrow_mut(|e| {
        let e = e.as_mut()?;
        let now = now_us(e);
        Some(e.host.frame(&Frame { now_us: now }, false))
    });
    let Some(actions) = actions else { return };
    unsafe {
        if let Some(on) = actions.freeze {
            for i in 0..FREEZE_EVENTS.len() as u32 {
                sys::SimConnect_TransmitClientEvent(sim, 0, FREEZE_EVENT_ID + i, on as u32, 1, 16);
            }
        }
        let unit = sys::fsVarsGetUnitId(c"degrees".as_ptr());
        for (name, value) in actions.writes {
            let var = CString::new(name.trim_start_matches("A:")).unwrap();
            let id = sys::fsVarsGetAVarId(var.as_ptr());
            sys::fsVarsAVarSet(id, unit, std::mem::zeroed(), value, sys::FS_OBJECT_ID_USER_AIRCRAFT as _);
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn module_deinit() {
    let sim = SIM.replace(0);
    if sim != 0 {
        unsafe { sys::SimConnect_Close(sim) };
    }
    EDGE.set(None);
}
