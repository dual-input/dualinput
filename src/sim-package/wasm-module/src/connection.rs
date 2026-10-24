//! The module's own SimConnect connection, which carries the core's writes to the routines'
//! slots in and the module's status out.

use std::cell::RefCell;
use std::ffi::{CString, c_void};
use std::mem::{offset_of, size_of};
use std::ptr;

use messages::module::{ModuleStatus, RoutineId, STATUS};

use crate::bindings::{
    DWORD, HANDLE, SIMCONNECT_CLIENT_DATA_PERIOD_ON_SET, SIMCONNECT_CLIENT_DATA_SET_FLAG_DEFAULT,
    SIMCONNECT_CREATE_CLIENT_DATA_FLAG, SIMCONNECT_CREATE_CLIENT_DATA_FLAG_DEFAULT,
    SIMCONNECT_CREATE_CLIENT_DATA_FLAG_READ_ONLY, SIMCONNECT_RECV, SIMCONNECT_RECV_ID_CLIENT_DATA,
    SIMCONNECT_RECV_SIMOBJECT_DATA, SIMCONNECT_UNUSED, SimConnect_AddToClientDataDefinition,
    SimConnect_CallDispatch, SimConnect_Close, SimConnect_CreateClientData,
    SimConnect_MapClientDataNameToID, SimConnect_Open, SimConnect_RequestClientData,
    SimConnect_SetClientData,
};

/// The status slot's client data area on this connection, and its definition's ID. Each
/// routine's slot takes the next area, in the order `Host::slots` lists them, and its area's
/// number for its definition and its request too.
const STATUS_AREA: u32 = 0;

/// What `gather` collects: each client data message's request and bytes.
type Gathered = Vec<(u32, Vec<u8>)>;

pub(crate) struct Connection {
    handle: HANDLE,
    /// Each routine's slot, by its area less one.
    routines: Vec<RoutineId>,
}

impl Connection {
    /// Opens the connection, creates the status slot and each routine's slot in `slots`,
    /// with its size in bytes, and asks for each routine's slot whenever the core sets it.
    /// None when SimConnect refuses the connection.
    pub(crate) fn open(slots: &[(RoutineId, u32)]) -> Option<Connection> {
        let mut handle: HANDLE = 0;
        // SAFETY: SimConnect writes the connection's handle into `handle`, and reads the
        // name, which outlives the call.
        let opened = unsafe {
            SimConnect_Open(
                &mut handle,
                c"Dual Input module".as_ptr(),
                ptr::null_mut(),
                0,
                0,
                0,
            )
        };
        if opened != 0 {
            return None;
        }
        let connection = Connection {
            handle,
            routines: slots.iter().map(|&(id, _)| id).collect(),
        };
        // The core trusts the status slot to say whether our module runs, and the read-only
        // flag lets only the slot's creator, this connection, write it
        // (record/areas/core/03-sim-seam-and-wasm-module.md, "Its slots").
        connection.create(
            STATUS_AREA,
            STATUS,
            size_of::<ModuleStatus>() as u32,
            SIMCONNECT_CREATE_CLIENT_DATA_FLAG_READ_ONLY,
        );
        for (area, &(id, size)) in (STATUS_AREA + 1..).zip(slots) {
            connection.create(
                area,
                &id.slot(),
                size,
                SIMCONNECT_CREATE_CLIENT_DATA_FLAG_DEFAULT,
            );
            // SAFETY: the call takes only numbers. With no flags, every write arrives, a
            // rewrite of the same bytes included, since the routine host counts each as the
            // core still feeding the routine.
            unsafe {
                SimConnect_RequestClientData(
                    handle,
                    area,
                    area,
                    area,
                    SIMCONNECT_CLIENT_DATA_PERIOD_ON_SET,
                    0,
                    0,
                    0,
                    0,
                )
            };
        }
        Some(connection)
    }

    /// Maps `name` to `area`, creates it with `size` bytes, and defines it as one block of
    /// that size, under the area's own number. SimConnect reports a call that fails as an
    /// exception, later, and the module has no one to tell, so it goes unheard.
    fn create(&self, area: u32, name: &str, size: u32, flags: SIMCONNECT_CREATE_CLIENT_DATA_FLAG) {
        let Ok(name) = CString::new(name) else {
            return;
        };
        // SAFETY: SimConnect reads the name, which outlives the calls.
        unsafe {
            SimConnect_MapClientDataNameToID(self.handle, name.as_ptr(), area);
            SimConnect_CreateClientData(self.handle, area, size, flags);
            SimConnect_AddToClientDataDefinition(
                self.handle,
                area,
                0,
                size,
                0.0,
                SIMCONNECT_UNUSED,
            );
        }
    }

    /// Each routine's slot the core wrote since the last call, with its bytes, which
    /// SimConnect delivers only inside `SimConnect_CallDispatch`.
    pub(crate) fn dispatch(&self) -> Vec<(RoutineId, Vec<u8>)> {
        // SAFETY: SimConnect calls `gather` only inside this call.
        unsafe {
            SimConnect_CallDispatch(self.handle, Some(gather), ptr::null_mut());
        }
        GATHERED
            .with(|gathered| gathered.take())
            .into_iter()
            .filter_map(|(request, bytes)| {
                let index = usize::try_from(request).ok()?.checked_sub(1)?;
                Some((*self.routines.get(index)?, bytes))
            })
            .collect()
    }

    /// Writes `status` into the status slot.
    pub(crate) fn write_status(&self, status: &ModuleStatus) {
        let mut status = *status;
        // SAFETY: SimConnect copies the status's bytes out during the call.
        unsafe {
            SimConnect_SetClientData(
                self.handle,
                STATUS_AREA,
                STATUS_AREA,
                SIMCONNECT_CLIENT_DATA_SET_FLAG_DEFAULT,
                0,
                size_of::<ModuleStatus>() as DWORD,
                (&raw mut status).cast(),
            );
        }
    }

    pub(crate) fn close(self) {
        // SAFETY: the call takes only the handle, which no call uses after this one.
        unsafe { SimConnect_Close(self.handle) };
    }
}

thread_local! {
    // What `gather` collects for `dispatch`. With the buffer passed as
    // `SimConnect_CallDispatch`'s context, our module read none of the core's writes in the
    // sim, and with this slot it read every one, so the callback takes no context (measured
    // on MSFS 2024, 2026-10-24, record/areas/core/log.md). A module runs on one thread, so a
    // thread's own slot holds it.
    static GATHERED: RefCell<Gathered> = const { RefCell::new(Vec::new()) };
}

/// SimConnect's dispatch callback, which copies each client data message's request and bytes
/// into `GATHERED`. A client data message is a `SIMCONNECT_RECV_SIMOBJECT_DATA` with nothing
/// added, and its bytes start at `dwData` (read in MSFS 2024 SDK 1.8.1, `SimConnect.h`).
unsafe extern "C" fn gather(recv: *mut SIMCONNECT_RECV, size: DWORD, _: *mut c_void) {
    if recv.is_null() {
        return;
    }
    // SAFETY: SimConnect hands a message of `size` bytes, which lives through this call.
    unsafe {
        if (*recv).dwID != SIMCONNECT_RECV_ID_CLIENT_DATA as DWORD {
            return;
        }
        let request = (*recv.cast::<SIMCONNECT_RECV_SIMOBJECT_DATA>()).dwRequestID;
        let start = offset_of!(SIMCONNECT_RECV_SIMOBJECT_DATA, dwData);
        let Some(len) = (size as usize).checked_sub(start) else {
            return;
        };
        let bytes = std::slice::from_raw_parts(recv.cast::<u8>().add(start), len);
        GATHERED.with(|gathered| {
            if let Ok(mut gathered) = gathered.try_borrow_mut() {
                gathered.push((request, bytes.to_vec()));
            }
        });
    }
}
