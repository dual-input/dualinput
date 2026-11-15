//! SimConnect's functions that the edge calls, and each `Op` made as the one call it names.

use std::ffi::{CString, c_char, c_void};
use std::ptr::null;

use sim_client::Op;
use simconnect_types::{
    BOOL, DWORD, SIMCONNECT_CLIENT_DATA_DEFINITION_ID, SIMCONNECT_CLIENT_DATA_ID,
    SIMCONNECT_CLIENT_DATA_PERIOD, SIMCONNECT_CLIENT_DATA_REQUEST_FLAG,
    SIMCONNECT_CLIENT_DATA_SET_FLAG, SIMCONNECT_CLIENT_DATA_SET_FLAG_DEFAULT,
    SIMCONNECT_CLIENT_EVENT_ID, SIMCONNECT_COMM_BUS_BROADCAST_TO, SIMCONNECT_DATA_DEFINITION_ID,
    SIMCONNECT_DATA_INITPOSITION, SIMCONNECT_DATA_REQUEST_FLAG, SIMCONNECT_DATA_REQUEST_ID,
    SIMCONNECT_DATA_SET_FLAG, SIMCONNECT_DATA_SET_FLAG_DEFAULT, SIMCONNECT_DATATYPE,
    SIMCONNECT_EVENT_FLAG, SIMCONNECT_NOTIFICATION_GROUP_ID, SIMCONNECT_OBJECT_ID,
    SIMCONNECT_PERIOD, SIMCONNECT_RECV, SIMCONNECT_SIMOBJECT_TYPE, SIMCONNECT_UNUSED,
};
use windows_sys::Win32::Foundation::{HANDLE, HWND};
use windows_sys::core::HRESULT;

// A parameter declared at the wrong width still builds, and the sim's calls fail later: our
// WASM module once declared SimConnect's HANDLE 32 bits wide where the SDK's headers give
// 64, and SimConnect_Open returned S_OK while the first call after it returned E_FAIL
// (measured on MSFS 2024, 2026-10-08, record/areas/architecture/log.md, "A standalone
// module built from Rust with cargo-msfs, and packaged by our own script, runs on MSFS 2024
// and trades data slots with a SimConnect client, once its SimConnect handle is 64 bits
// wide"). So each parameter takes its type from simconnect-types, which bindgen generates
// from SimConnect.h, or from windows-sys for Windows' own types, and each declaration
// follows its function's line in the header of the SDK the root's msfs-sdk.txt names. When
// you add an `Op`, declare its function here from that header.
#[link(name = "SimConnect")]
unsafe extern "system" {
    pub(crate) fn SimConnect_Open(
        handle: *mut HANDLE,
        name: *const c_char,
        window: HWND,
        user_event: DWORD,
        event: HANDLE,
        config_index: DWORD,
    ) -> HRESULT;
    pub(crate) fn SimConnect_Close(handle: HANDLE) -> HRESULT;
    pub(crate) fn SimConnect_GetNextDispatch(
        handle: HANDLE,
        data: *mut *mut SIMCONNECT_RECV,
        size: *mut DWORD,
    ) -> HRESULT;
    pub(crate) fn SimConnect_GetLastSentPacketID(handle: HANDLE, id: *mut DWORD) -> HRESULT;
    fn SimConnect_MapClientEventToSimEvent(
        handle: HANDLE,
        event: SIMCONNECT_CLIENT_EVENT_ID,
        name: *const c_char,
    ) -> HRESULT;
    fn SimConnect_TransmitClientEvent(
        handle: HANDLE,
        object: SIMCONNECT_OBJECT_ID,
        event: SIMCONNECT_CLIENT_EVENT_ID,
        data: DWORD,
        group: SIMCONNECT_NOTIFICATION_GROUP_ID,
        flags: SIMCONNECT_EVENT_FLAG,
    ) -> HRESULT;
    #[allow(clippy::too_many_arguments)]
    fn SimConnect_TransmitClientEvent_EX1(
        handle: HANDLE,
        object: SIMCONNECT_OBJECT_ID,
        event: SIMCONNECT_CLIENT_EVENT_ID,
        group: SIMCONNECT_NOTIFICATION_GROUP_ID,
        flags: SIMCONNECT_EVENT_FLAG,
        data0: DWORD,
        data1: DWORD,
        data2: DWORD,
        data3: DWORD,
        data4: DWORD,
    ) -> HRESULT;
    fn SimConnect_EnumerateInputEvents(
        handle: HANDLE,
        request: SIMCONNECT_DATA_REQUEST_ID,
    ) -> HRESULT;
    fn SimConnect_GetInputEvent(
        handle: HANDLE,
        request: SIMCONNECT_DATA_REQUEST_ID,
        hash: u64,
    ) -> HRESULT;
    fn SimConnect_SubscribeInputEvent(handle: HANDLE, hash: u64) -> HRESULT;
    fn SimConnect_AddClientEventToNotificationGroup(
        handle: HANDLE,
        group: SIMCONNECT_NOTIFICATION_GROUP_ID,
        event: SIMCONNECT_CLIENT_EVENT_ID,
        maskable: BOOL,
    ) -> HRESULT;
    fn SimConnect_SetNotificationGroupPriority(
        handle: HANDLE,
        group: SIMCONNECT_NOTIFICATION_GROUP_ID,
        priority: DWORD,
    ) -> HRESULT;
    fn SimConnect_SubscribeToSystemEvent(
        handle: HANDLE,
        event: SIMCONNECT_CLIENT_EVENT_ID,
        name: *const c_char,
    ) -> HRESULT;
    fn SimConnect_SubscribeToFlowEvent(handle: HANDLE) -> HRESULT;
    fn SimConnect_RequestSystemState(
        handle: HANDLE,
        request: SIMCONNECT_DATA_REQUEST_ID,
        state: *const c_char,
    ) -> HRESULT;
    fn SimConnect_AddToDataDefinition(
        handle: HANDLE,
        definition: SIMCONNECT_DATA_DEFINITION_ID,
        name: *const c_char,
        unit: *const c_char,
        datatype: SIMCONNECT_DATATYPE,
        epsilon: f32,
        datum: DWORD,
    ) -> HRESULT;
    fn SimConnect_RequestDataOnSimObject(
        handle: HANDLE,
        request: SIMCONNECT_DATA_REQUEST_ID,
        definition: SIMCONNECT_DATA_DEFINITION_ID,
        object: SIMCONNECT_OBJECT_ID,
        period: SIMCONNECT_PERIOD,
        flags: SIMCONNECT_DATA_REQUEST_FLAG,
        origin: DWORD,
        interval: DWORD,
        limit: DWORD,
    ) -> HRESULT;
    fn SimConnect_RequestDataOnSimObjectType(
        handle: HANDLE,
        request: SIMCONNECT_DATA_REQUEST_ID,
        definition: SIMCONNECT_DATA_DEFINITION_ID,
        radius: DWORD,
        kind: SIMCONNECT_SIMOBJECT_TYPE,
    ) -> HRESULT;
    fn SimConnect_SetDataOnSimObject(
        handle: HANDLE,
        definition: SIMCONNECT_DATA_DEFINITION_ID,
        object: SIMCONNECT_OBJECT_ID,
        flags: SIMCONNECT_DATA_SET_FLAG,
        count: DWORD,
        size: DWORD,
        data: *mut c_void,
    ) -> HRESULT;
    fn SimConnect_MapClientDataNameToID(
        handle: HANDLE,
        name: *const c_char,
        area: SIMCONNECT_CLIENT_DATA_ID,
    ) -> HRESULT;
    fn SimConnect_AddToClientDataDefinition(
        handle: HANDLE,
        definition: SIMCONNECT_CLIENT_DATA_DEFINITION_ID,
        offset: DWORD,
        size_or_type: DWORD,
        epsilon: f32,
        datum: DWORD,
    ) -> HRESULT;
    fn SimConnect_RequestClientData(
        handle: HANDLE,
        area: SIMCONNECT_CLIENT_DATA_ID,
        request: SIMCONNECT_DATA_REQUEST_ID,
        definition: SIMCONNECT_CLIENT_DATA_DEFINITION_ID,
        period: SIMCONNECT_CLIENT_DATA_PERIOD,
        flags: SIMCONNECT_CLIENT_DATA_REQUEST_FLAG,
        origin: DWORD,
        interval: DWORD,
        limit: DWORD,
    ) -> HRESULT;
    fn SimConnect_SetClientData(
        handle: HANDLE,
        area: SIMCONNECT_CLIENT_DATA_ID,
        definition: SIMCONNECT_CLIENT_DATA_DEFINITION_ID,
        flags: SIMCONNECT_CLIENT_DATA_SET_FLAG,
        reserved: DWORD,
        size: DWORD,
        data: *mut c_void,
    ) -> HRESULT;
    fn SimConnect_CallCommBusEvent(
        handle: HANDLE,
        name: *const c_char,
        broadcast: SIMCONNECT_COMM_BUS_BROADCAST_TO,
        size: DWORD,
        data: *const c_char,
    ) -> HRESULT;
    fn SimConnect_AICreateSimulatedObject_EX1(
        handle: HANDLE,
        title: *const c_char,
        livery: *const c_char,
        at: SIMCONNECT_DATA_INITPOSITION,
        request: SIMCONNECT_DATA_REQUEST_ID,
    ) -> HRESULT;
    fn SimConnect_AICreateNonATCAircraft_EX1(
        handle: HANDLE,
        title: *const c_char,
        livery: *const c_char,
        tail: *const c_char,
        at: SIMCONNECT_DATA_INITPOSITION,
        request: SIMCONNECT_DATA_REQUEST_ID,
    ) -> HRESULT;
    fn SimConnect_AIReleaseControl(
        handle: HANDLE,
        object: SIMCONNECT_OBJECT_ID,
        request: SIMCONNECT_DATA_REQUEST_ID,
    ) -> HRESULT;
    fn SimConnect_AIRemoveObject(
        handle: HANDLE,
        object: SIMCONNECT_OBJECT_ID,
        request: SIMCONNECT_DATA_REQUEST_ID,
    ) -> HRESULT;
    fn SimConnect_CameraGet(handle: HANDLE, referential: DWORD) -> HRESULT;
}

/// Makes `op` as the one SimConnect call it names, on the connection `handle`, and returns
/// the call's result.
///
/// # Safety
///
/// `handle` is a connection that `SimConnect_Open` opened and `SimConnect_Close` hasn't
/// closed.
pub(crate) unsafe fn make(handle: HANDLE, op: Op) -> HRESULT {
    // SAFETY: the caller keeps `handle` open, and each string and buffer passed lives until
    // its call returns.
    unsafe {
        match op {
            Op::MapClientEventToSimEvent { event, name } => {
                let name = c_string(&name);
                SimConnect_MapClientEventToSimEvent(handle, event, name.as_ptr())
            }
            Op::TransmitClientEvent {
                object,
                event,
                data,
                group,
                flags,
            } => SimConnect_TransmitClientEvent(handle, object, event, data, group, flags),
            Op::TransmitClientEventEx1 {
                object,
                event,
                group,
                flags,
                data,
            } => SimConnect_TransmitClientEvent_EX1(
                handle, object, event, group, flags, data[0], data[1], data[2], data[3], data[4],
            ),
            Op::EnumerateInputEvents { request } => {
                SimConnect_EnumerateInputEvents(handle, request)
            }
            Op::GetInputEvent { request, hash } => SimConnect_GetInputEvent(handle, request, hash),
            Op::SubscribeInputEvent { hash } => SimConnect_SubscribeInputEvent(handle, hash),
            Op::AddClientEventToNotificationGroup {
                group,
                event,
                maskable,
            } => SimConnect_AddClientEventToNotificationGroup(
                handle,
                group,
                event,
                BOOL::from(maskable),
            ),
            Op::SetNotificationGroupPriority { group, priority } => {
                SimConnect_SetNotificationGroupPriority(handle, group, priority)
            }
            Op::SubscribeToSystemEvent { event, name } => {
                let name = c_string(&name);
                SimConnect_SubscribeToSystemEvent(handle, event, name.as_ptr())
            }
            Op::SubscribeToFlowEvent => SimConnect_SubscribeToFlowEvent(handle),
            Op::RequestSystemState { request, state } => {
                let state = c_string(&state);
                SimConnect_RequestSystemState(handle, request, state.as_ptr())
            }
            Op::AddToDataDefinition {
                definition,
                name,
                unit,
                datatype,
                datum,
            } => {
                let name = c_string(&name);
                // A string variable, such as A:TITLE, takes no unit. The sim client writes
                // that as an empty unit, and the edge passes a null pointer for it, as p08's
                // client did (read in experiments/areas/architecture/flight/client/src/
                // main.rs, `define`).
                let unit = (!unit.is_empty()).then(|| c_string(&unit));
                SimConnect_AddToDataDefinition(
                    handle,
                    definition,
                    name.as_ptr(),
                    unit.as_ref().map_or(null(), |unit| unit.as_ptr()),
                    datatype,
                    0.0,
                    datum,
                )
            }
            Op::RequestDataOnSimObject {
                request,
                definition,
                object,
                period,
                flags,
            } => SimConnect_RequestDataOnSimObject(
                handle, request, definition, object, period, flags, 0, 0, 0,
            ),
            Op::RequestDataOnSimObjectType {
                request,
                definition,
                radius,
                kind,
            } => SimConnect_RequestDataOnSimObjectType(handle, request, definition, radius, kind),
            Op::SetDataOnSimObject {
                definition,
                object,
                mut data,
            } => SimConnect_SetDataOnSimObject(
                handle,
                definition,
                object,
                SIMCONNECT_DATA_SET_FLAG_DEFAULT,
                1,
                data.len() as DWORD,
                data.as_mut_ptr().cast(),
            ),
            Op::MapClientDataNameToId { name, area } => {
                let name = c_string(&name);
                SimConnect_MapClientDataNameToID(handle, name.as_ptr(), area)
            }
            Op::AddToClientDataDefinition { definition, size } => {
                SimConnect_AddToClientDataDefinition(
                    handle,
                    definition,
                    0,
                    size,
                    0.0,
                    SIMCONNECT_UNUSED,
                )
            }
            Op::RequestClientData {
                area,
                request,
                definition,
                period,
                flags,
            } => SimConnect_RequestClientData(
                handle, area, request, definition, period, flags, 0, 0, 0,
            ),
            Op::SetClientData {
                area,
                definition,
                mut data,
            } => SimConnect_SetClientData(
                handle,
                area,
                definition,
                SIMCONNECT_CLIENT_DATA_SET_FLAG_DEFAULT,
                0,
                data.len() as DWORD,
                data.as_mut_ptr().cast(),
            ),
            Op::CallCommBusEvent {
                name,
                broadcast,
                data,
            } => {
                let name = c_string(&name);
                let data = c_string(&data);
                // The size counts the closing NUL, as p08's client passed it when a cockpit
                // panel heard its call (read in experiments/areas/architecture/flight/client/
                // src/main.rs, "bus").
                let size = data.as_bytes_with_nul().len() as DWORD;
                SimConnect_CallCommBusEvent(handle, name.as_ptr(), broadcast, size, data.as_ptr())
            }
            Op::AICreateSimulatedObject {
                title,
                livery,
                at,
                request,
            } => {
                let title = c_string(&title);
                let livery = c_string(&livery);
                SimConnect_AICreateSimulatedObject_EX1(
                    handle,
                    title.as_ptr(),
                    livery.as_ptr(),
                    init_position(at),
                    request,
                )
            }
            Op::AICreateNonAtcAircraft {
                title,
                livery,
                tail,
                at,
                request,
            } => {
                let title = c_string(&title);
                let livery = c_string(&livery);
                let tail = c_string(&tail);
                SimConnect_AICreateNonATCAircraft_EX1(
                    handle,
                    title.as_ptr(),
                    livery.as_ptr(),
                    tail.as_ptr(),
                    init_position(at),
                    request,
                )
            }
            Op::AIReleaseControl { object, request } => {
                SimConnect_AIReleaseControl(handle, object, request)
            }
            Op::AIRemoveObject { object, request } => {
                SimConnect_AIRemoveObject(handle, object, request)
            }
            Op::CameraGet { referential } => SimConnect_CameraGet(handle, referential),
        }
    }
}

fn init_position(at: sim_client::InitPosition) -> SIMCONNECT_DATA_INITPOSITION {
    SIMCONNECT_DATA_INITPOSITION {
        Latitude: at.latitude,
        Longitude: at.longitude,
        Altitude: at.altitude,
        Pitch: at.pitch,
        Bank: at.bank,
        Heading: at.heading,
        OnGround: DWORD::from(at.on_ground),
        Airspeed: at.airspeed,
    }
}

/// `text` as a C string. C reads a string up to its first NUL, so text that holds one
/// reaches SimConnect cut there, as it would from a C caller.
pub(crate) fn c_string(text: &str) -> CString {
    let end = text.find('\0').unwrap_or(text.len());
    CString::new(&text[..end]).expect("text before its first NUL should hold no NUL")
}
