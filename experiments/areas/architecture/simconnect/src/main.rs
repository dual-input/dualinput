// p06's SimConnect client: a Rust program on the SDK's own SimConnect.dll,
// doing what the core would do at the main menu, and reporting each thing that
// arrives on stdout for p06-rust-simconnect.mjs to read.
//
// It opens a connection; subscribes to the "1sec" system event, to the flow
// events, and to CROSSCHECK_P06_ASK on the CommBus; and asks once a second for
// CROSSCHECK_P03A_OUT, the output slot of p03's Rust module. On stdin it takes
//   bus <text>   call CROSSCHECK_P06_HELLO on the CommBus for JavaScript
//   in <n>       write n to CROSSCHECK_P03A_IN, which the module echoes in its output
//   quit
//
// The declarations below are written by hand from MSFS 2024 SDK 1.7.3's
// SimConnect.h, since generating them with bindgen needs libclang, which this
// machine doesn't have. Outside a WASM module, HANDLE and HWND are pointers.

use std::ffi::{c_char, c_void, CString};
use std::io::{BufRead, Write};
use std::ptr::null_mut;
use std::sync::mpsc;
use std::time::Duration;

type Handle = *mut c_void;

#[link(name = "SimConnect")]
extern "system" {
    fn SimConnect_Open(handle: *mut Handle, name: *const c_char, hwnd: *mut c_void, user_event: u32, event: Handle, config_index: u32) -> i32;
    fn SimConnect_Close(handle: Handle) -> i32;
    fn SimConnect_GetNextDispatch(handle: Handle, data: *mut *mut Recv, size: *mut u32) -> i32;
    fn SimConnect_SubscribeToSystemEvent(handle: Handle, event_id: u32, name: *const c_char) -> i32;
    fn SimConnect_SubscribeToFlowEvent(handle: Handle) -> i32;
    fn SimConnect_SubscribeToCommBusEvent(handle: Handle, event_id: u32, name: *const c_char) -> i32;
    fn SimConnect_CallCommBusEvent(handle: Handle, name: *const c_char, broadcast_to: u32, size: u32, data: *const c_char) -> i32;
    fn SimConnect_MapClientDataNameToID(handle: Handle, name: *const c_char, id: u32) -> i32;
    fn SimConnect_AddToClientDataDefinition(handle: Handle, define_id: u32, offset: u32, size: u32, epsilon: f32, datum_id: u32) -> i32;
    fn SimConnect_RequestClientData(handle: Handle, id: u32, request_id: u32, define_id: u32, period: u32, flags: u32, origin: u32, interval: u32, limit: u32) -> i32;
    fn SimConnect_SetClientData(handle: Handle, id: u32, define_id: u32, flags: u32, reserved: u32, size: u32, data: *const c_void) -> i32;
}

// SIMCONNECT_RECV; every record starts with it, and the header packs every
// struct to 1 byte, so the offsets below are byte offsets from the record's start.
#[repr(C)]
struct Recv {
    size: u32,
    version: u32,
    id: u32,
}

const RECV_EXCEPTION: u32 = 1;
const RECV_OPEN: u32 = 2;
const RECV_EVENT: u32 = 4;
const RECV_CLIENT_DATA: u32 = 16;
const RECV_FLOW_EVENT: u32 = 39;
const RECV_COMM_BUS: u32 = 43;
const BROADCAST_TO_JS: u32 = 1;
const PERIOD_SECOND: u32 = 4;
const UNUSED: u32 = u32::MAX;
const EVENT_1SEC: u32 = 1;
const EVENT_ASK: u32 = 2;
const OUT_AREA: u32 = 0x6100;
const IN_AREA: u32 = 0x6101;
const OUT_REQUEST: u32 = 0x6100;

fn say(line: &str) {
    let mut out = std::io::stdout();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

unsafe fn u32_at(record: *const u8, offset: usize) -> u32 {
    std::ptr::read_unaligned(record.add(offset) as *const u32)
}

unsafe fn str_at(record: *const u8, offset: usize, size: usize) -> String {
    let bytes = std::slice::from_raw_parts(record.add(offset), size.saturating_sub(offset));
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}

unsafe fn on_record(record: *const u8, size: usize) {
    match (*(record as *const Recv)).id {
        RECV_OPEN => say(&format!(
            "OPEN {} {}.{} build {}.{}, SimConnect {}.{}",
            str_at(record, 12, 12 + 256),
            u32_at(record, 268),
            u32_at(record, 272),
            u32_at(record, 276),
            u32_at(record, 280),
            u32_at(record, 284),
            u32_at(record, 288)
        )),
        RECV_EXCEPTION => say(&format!("EXCEPTION {} send {} index {}", u32_at(record, 12), u32_at(record, 16), u32_at(record, 20))),
        RECV_EVENT => say(&format!("EVENT {} data {}", u32_at(record, 16), u32_at(record, 20))),
        RECV_FLOW_EVENT => say(&format!("FLOW {} {}", u32_at(record, 12), str_at(record, 16, size))),
        // SIMCONNECT_RECV_COMM_BUS: the list template's four DWORDs, then
        // uEventID at 28 and the string at 32.
        RECV_COMM_BUS => say(&format!("COMMBUS {} {}", u32_at(record, 28), str_at(record, 32, size))),
        // SIMCONNECT_RECV_CLIENT_DATA: seven DWORDs after the header, then the data at 40.
        RECV_CLIENT_DATA => {
            let words: Vec<String> = (0..5).map(|i| u32_at(record, 40 + 4 * i).to_string()).collect();
            say(&format!("OUT {}", words.join(" ")));
        }
        other => say(&format!("RECV {other}")),
    }
}

fn main() {
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    unsafe {
        let mut sim: Handle = null_mut();
        let name = CString::new("CROSSCHECK p06 rust client").unwrap();
        let hr = SimConnect_Open(&mut sim, name.as_ptr(), null_mut(), 0, null_mut(), 0);
        if hr != 0 {
            say(&format!("ERROR SimConnect_Open {hr}"));
            std::process::exit(1);
        }
        let c = |s: &str| CString::new(s).unwrap();
        let calls = [
            ("subscribe 1sec", SimConnect_SubscribeToSystemEvent(sim, EVENT_1SEC, c("1sec").as_ptr())),
            ("subscribe flow events", SimConnect_SubscribeToFlowEvent(sim)),
            ("subscribe CROSSCHECK_P06_ASK", SimConnect_SubscribeToCommBusEvent(sim, EVENT_ASK, c("CROSSCHECK_P06_ASK").as_ptr())),
            ("map CROSSCHECK_P03A_OUT", SimConnect_MapClientDataNameToID(sim, c("CROSSCHECK_P03A_OUT").as_ptr(), OUT_AREA)),
            ("define OUT", SimConnect_AddToClientDataDefinition(sim, OUT_AREA, 0, 20, 0.0, UNUSED)),
            ("map CROSSCHECK_P03A_IN", SimConnect_MapClientDataNameToID(sim, c("CROSSCHECK_P03A_IN").as_ptr(), IN_AREA)),
            ("define IN", SimConnect_AddToClientDataDefinition(sim, IN_AREA, 0, 4, 0.0, UNUSED)),
            ("request OUT every second", SimConnect_RequestClientData(sim, OUT_AREA, OUT_REQUEST, OUT_AREA, PERIOD_SECOND, 0, 0, 0, 0)),
        ];
        for (what, hr) in calls {
            say(&format!("CALL {what} {hr}"));
        }
        say("READY");
        loop {
            let mut record: *mut Recv = null_mut();
            let mut size = 0u32;
            while SimConnect_GetNextDispatch(sim, &mut record, &mut size) == 0 {
                on_record(record as *const u8, size as usize);
            }
            match rx.try_recv() {
                Ok(line) if line == "quit" => break,
                Ok(line) if line.starts_with("bus ") => {
                    let text = c(&line[4..]);
                    let len = text.as_bytes_with_nul().len() as u32;
                    let hr = SimConnect_CallCommBusEvent(sim, c("CROSSCHECK_P06_HELLO").as_ptr(), BROADCAST_TO_JS, len, text.as_ptr());
                    say(&format!("CALLED bus {hr}"));
                }
                Ok(line) if line.starts_with("in ") => {
                    let value: u32 = line[3..].trim().parse().unwrap_or(0);
                    let hr = SimConnect_SetClientData(sim, IN_AREA, IN_AREA, 0, 0, 4, (&value as *const u32).cast());
                    say(&format!("WROTE in {value} {hr}"));
                }
                Ok(other) => say(&format!("UNKNOWN {other}")),
                Err(mpsc::TryRecvError::Disconnected) => break,
                Err(mpsc::TryRecvError::Empty) => {}
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        SimConnect_Close(sim);
    }
    say("CLOSED");
}
