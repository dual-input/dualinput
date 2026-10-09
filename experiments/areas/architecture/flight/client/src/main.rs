// p08's SimConnect client: what the core would do in a flight, on the SDK's own
// SimConnect.dll, through declarations bindgen generates from SimConnect.h
// (build.rs). p08-flight.mjs drives it over stdin and reads what it reports on
// stdout, one tab-separated line each. A line's first field is when the client
// handled it, in whole µs on QueryPerformanceCounter, the clock the spine
// stamps on; a record's is when SimConnect_GetNextDispatch handed it over.
//
// It connects as soon as the sim answers, and at once takes a masking group at
// 10,000,000, held open by K:SIM_RATE_INCR, which it listens to and doesn't
// mask, as the core would at the sim's start (measured on MSFS 2024,
// 2026-10-07, record/areas/flight-controls/log.md, "A group that takes its
// priority as the sim starts, held open by an event it only listens to, masks
// ahead of Accu-Sim once it adds the axis").
//
// Commands, one a line, fields split by tabs:
//   alive                      the keepalive; without one for 15s it lets go and exits
//   qpc                        report the counter's ticks and frequency
//   module                     map the module's slots, read OUT as it's set, and write
//                              IN every 200ms with a sequence number and the time
//   echo                       read L:CROSSCHECK_P08_ECHO every sim frame it changes
//   listen                     hear K:AXIS_ELEVATOR_SET at the highest priority, without
//                              masking, and read L:ElevatorInput as it changes
//   mask | clear               add the elevator axis to the start group, maskable; clear it
//   pos                        the user aircraft's position and true heading, once
//   strings <object>           an object's TITLE and LIVERY NAME, once
//   liveries <text>            the aircraft titles and liveries the sim knows, those
//                              whose title holds <text>
//   spawnai <title> <livery> <tail> <lat> <lon> <alt ft> <hdg>
//   spawnobj <title> <livery> <lat> <lon> <alt ft> <hdg>
//   remove <object>
//   camera                     the camera's status, and where it is
//   inputs <text>              the input events, those whose name holds <text>
//   inputget <hash> | inputsub <hash> | inputset <hash> <value>
//   battery                    read L:Battery1Switch as it changes
//   bus <name> <text>          call <name> on the CommBus for JavaScript
//   quit
//
// It fails open, as p03-mask-at-start's holder does: it clears its groups and
// exits when `alive` stops for 15s, when stdin closes, or after 45 minutes, and
// killing it releases its masks (measured on MSFS 2024, 2026-10-01,
// record/areas/flight-controls/log.md, "Masking stops a pilot's hardware input,
// and closing the masking client gives it back").

mod sc {
    #![allow(non_camel_case_types, non_snake_case, non_upper_case_globals, dead_code, clippy::all)]
    include!(concat!(env!("OUT_DIR"), "/simconnect.rs"));
}

use std::collections::HashMap;
use std::ffi::{c_char, c_void, CString};
use std::io::{BufRead, Write};
use std::mem::offset_of;
use std::ptr::null_mut;
use std::sync::{mpsc, OnceLock};
use std::time::{Duration, Instant};

use windows_sys::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
use windows_sys::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

const EV_ANCHOR: u32 = 1;
const EV_ELEV_LISTEN: u32 = 2;
const EV_ELEV_MASK: u32 = 3;
const EV_AIRCRAFT_LOADED: u32 = 10;
const EV_FLIGHT_LOADED: u32 = 11;
const EV_SIM_START: u32 = 12;
const EV_SIM_STOP: u32 = 13;
const EV_ANSWER: u32 = 20;
const GROUP_A: u32 = 1;
const GROUP_H: u32 = 2;
// The module's slots. Its IDs start at 0xC800, apart from p03's 0xC300.
const OUT_AREA: u32 = 0xC800;
const IN_AREA: u32 = 0xC801;
const REQ_OUT: u32 = 0xC800;
const DEF_ECHO: u32 = 1;
const DEF_ELEV: u32 = 2;
const DEF_POS: u32 = 3;
const DEF_STRINGS: u32 = 4;
const DEF_BATTERY: u32 = 5;
const REQ_ECHO: u32 = 1;
const REQ_ELEV: u32 = 2;
const REQ_POS: u32 = 3;
const REQ_LIVERIES: u32 = 4;
const REQ_SPAWN_AI: u32 = 5;
const REQ_SPAWN_OBJ: u32 = 6;
const REQ_INPUTS: u32 = 7;
const REQ_GETINPUT: u32 = 8;
const REQ_BATTERY: u32 = 9;
const REQ_REMOVE: u32 = 10;
const REQ_STRINGS_FIRST: u32 = 1000;
// What the module writes to OUT, as module/src/lib.rs lays it out; 48 bytes.
const OUT_SIZE: u32 = 48;
const IN_SIZE: u32 = 16;
const MAGIC: u32 = 0x5038_5253;

const DEADMAN: Duration = Duration::from_secs(15);
const CAP: Duration = Duration::from_secs(45 * 60);
const CONNECT_CAP: Duration = Duration::from_secs(10 * 60);
const IN_EVERY: Duration = Duration::from_millis(200);

static FREQ: OnceLock<i64> = OnceLock::new();

fn ticks() -> i64 {
    let mut t = 0i64;
    unsafe { QueryPerformanceCounter(&mut t) };
    t
}

// Ticks times 1,000,000 passes a signed 64-bit integer after about 10.7 days at
// 10 MHz, so the product is taken in 128 bits (the spine's Times).
fn us(t: i64) -> u64 {
    ((t as u128) * 1_000_000 / (*FREQ.get().unwrap() as u128)) as u64
}

fn now() -> u64 {
    us(ticks())
}

fn say(at: u64, line: &str) {
    let mut out = std::io::stdout();
    let _ = writeln!(out, "{at}\t{line}");
    let _ = out.flush();
}

fn text(bytes: &[c_char]) -> String {
    let b: Vec<u8> = bytes.iter().take_while(|&&c| c != 0).map(|&c| c as u8).collect();
    String::from_utf8_lossy(&b).replace(['\t', '\n', '\r'], " ")
}

unsafe fn read<T>(rec: *const sc::SIMCONNECT_RECV, offset: usize) -> T {
    std::ptr::read_unaligned((rec as *const u8).add(offset) as *const T)
}

unsafe fn text_at(rec: *const sc::SIMCONNECT_RECV, offset: usize, size: usize) -> String {
    let len = size.saturating_sub(offset);
    let bytes = std::slice::from_raw_parts((rec as *const u8).add(offset) as *const c_char, len);
    text(bytes)
}

fn c(s: &str) -> CString {
    CString::new(s).unwrap()
}

struct State {
    sim: sc::HANDLE,
    alive: Instant,
    module: bool,
    seq: u32,
    last_in: Instant,
    strings: HashMap<u32, u32>,
    next_strings: u32,
    liveries_filter: String,
    liveries_seen: u32,
    inputs_filter: String,
    inputs_seen: u32,
    quit: bool,
}

impl State {
    unsafe fn call(&self, what: &str, hr: sc::HRESULT) {
        say(now(), &format!("CALL\t{what}\t{hr}"));
    }

    unsafe fn on_record(&mut self, rec: *const sc::SIMCONNECT_RECV, size: usize, at: u64) {
        let id = (*rec).dwID as i32;
        match id {
            sc::SIMCONNECT_RECV_ID_EXCEPTION => {
                let r = rec as *const sc::SIMCONNECT_RECV_EXCEPTION;
                say(at, &format!("EXCEPTION\t{}\t{}\t{}", { (*r).dwException }, { (*r).dwSendID }, { (*r).dwIndex }));
            }
            sc::SIMCONNECT_RECV_ID_OPEN => {
                let r = rec as *const sc::SIMCONNECT_RECV_OPEN;
                let name = (*r).szApplicationName;
                say(at, &format!(
                    "OPEN\t{}\t{}.{}\t{}.{}\t{}.{}",
                    text(&name),
                    { (*r).dwApplicationVersionMajor },
                    { (*r).dwApplicationVersionMinor },
                    { (*r).dwApplicationBuildMajor },
                    { (*r).dwApplicationBuildMinor },
                    { (*r).dwSimConnectVersionMajor },
                    { (*r).dwSimConnectVersionMinor }
                ));
            }
            sc::SIMCONNECT_RECV_ID_QUIT => {
                say(at, "QUIT");
                self.quit = true;
            }
            sc::SIMCONNECT_RECV_ID_EVENT => {
                let r = rec as *const sc::SIMCONNECT_RECV_EVENT;
                // An axis event's value is signed; dwData carries its bits.
                say(at, &format!("EVENT\t{}\t{}\t{}", { (*r).uGroupID }, { (*r).uEventID }, { (*r).dwData } as i32));
            }
            sc::SIMCONNECT_RECV_ID_EVENT_FILENAME => {
                let r = rec as *const sc::SIMCONNECT_RECV_EVENT_FILENAME;
                let file = (*r).szFileName;
                say(at, &format!("FILENAME\t{}\t{}", { (*r)._base.uEventID }, text(&file)));
            }
            sc::SIMCONNECT_RECV_ID_SIMOBJECT_DATA | sc::SIMCONNECT_RECV_ID_CLIENT_DATA => {
                let r = rec as *const sc::SIMCONNECT_RECV_SIMOBJECT_DATA;
                let req = (*r).dwRequestID;
                let data = offset_of!(sc::SIMCONNECT_RECV_SIMOBJECT_DATA, dwData);
                match req {
                    REQ_OUT if id == sc::SIMCONNECT_RECV_ID_CLIENT_DATA => {
                        let (magic, version, frames, seq): (u32, u32, u32, u32) = (read(rec, data), read(rec, data + 4), read(rec, data + 8), read(rec, data + 12));
                        let (core_us, mono_ns, real_ns): (u64, u64, u64) = (read(rec, data + 16), read(rec, data + 24), read(rec, data + 32));
                        let sim_time: f64 = read(rec, data + 40);
                        say(at, &format!("OUT\t{}\t{version}\t{frames}\t{seq}\t{core_us}\t{mono_ns}\t{real_ns}\t{sim_time}", if magic == MAGIC { "ours" } else { "other" }));
                    }
                    REQ_ECHO => say(at, &format!("ECHO\t{}", read::<f64>(rec, data))),
                    REQ_ELEV => say(at, &format!("VAR\tElevatorInput\t{}", read::<f64>(rec, data))),
                    REQ_BATTERY => say(at, &format!("VAR\tBattery1Switch\t{}", read::<f64>(rec, data))),
                    REQ_POS => {
                        let v: [f64; 4] = [read(rec, data), read(rec, data + 8), read(rec, data + 16), read(rec, data + 24)];
                        say(at, &format!("POS\t{}\t{}\t{}\t{}", v[0], v[1], v[2], v[3]));
                    }
                    _ => {
                        if let Some(object) = self.strings.remove(&req) {
                            say(at, &format!("STRINGS\t{object}\t{}\t{}", text_at(rec, data, (data + 256).min(size)), text_at(rec, data + 256, (data + 512).min(size))));
                        } else {
                            say(at, &format!("DATA\t{req}"));
                        }
                    }
                }
            }
            sc::SIMCONNECT_RECV_ID_ASSIGNED_OBJECT_ID => {
                let r = rec as *const sc::SIMCONNECT_RECV_ASSIGNED_OBJECT_ID;
                say(at, &format!("ASSIGNED\t{}\t{}", { (*r).dwRequestID }, { (*r).dwObjectID }));
            }
            sc::SIMCONNECT_RECV_ID_ENUMERATE_SIMOBJECT_AND_LIVERY_LIST => {
                let r = rec as *const sc::SIMCONNECT_RECV_ENUMERATE_SIMOBJECT_AND_LIVERY_LIST;
                let (count, entry, out_of) = ((*r)._base.dwArraySize, (*r)._base.dwEntryNumber, (*r)._base.dwOutOf);
                let first = offset_of!(sc::SIMCONNECT_RECV_ENUMERATE_SIMOBJECT_AND_LIVERY_LIST, rgData);
                let step = std::mem::size_of::<sc::SIMCONNECT_ENUMERATE_SIMOBJECT_LIVERY>();
                for i in 0..count as usize {
                    let e: sc::SIMCONNECT_ENUMERATE_SIMOBJECT_LIVERY = read(rec, first + i * step);
                    let (title, livery) = (e.AircraftTitle, e.LiveryName);
                    let title = text(&title);
                    self.liveries_seen += 1;
                    if title.to_lowercase().contains(&self.liveries_filter) {
                        say(at, &format!("LIVERY\t{title}\t{}", text(&livery)));
                    }
                }
                if entry + 1 >= out_of {
                    say(at, &format!("LIVERIES\t{}", self.liveries_seen));
                }
            }
            sc::SIMCONNECT_RECV_ID_ENUMERATE_INPUT_EVENTS => {
                let r = rec as *const sc::SIMCONNECT_RECV_ENUMERATE_INPUT_EVENTS;
                let (count, entry, out_of) = ((*r)._base.dwArraySize, (*r)._base.dwEntryNumber, (*r)._base.dwOutOf);
                let first = offset_of!(sc::SIMCONNECT_RECV_ENUMERATE_INPUT_EVENTS, rgData);
                let step = std::mem::size_of::<sc::SIMCONNECT_INPUT_EVENT_DESCRIPTOR>();
                for i in 0..count as usize {
                    let e: sc::SIMCONNECT_INPUT_EVENT_DESCRIPTOR = read(rec, first + i * step);
                    let name = e.Name;
                    let name = text(&name);
                    self.inputs_seen += 1;
                    if name.to_lowercase().contains(&self.inputs_filter) {
                        let (hash, kind) = (e.Hash, e.eType);
                        say(at, &format!("INPUT\t{name}\t{hash}\t{kind}"));
                    }
                }
                if entry + 1 >= out_of {
                    say(at, &format!("INPUTS\t{}", self.inputs_seen));
                }
            }
            sc::SIMCONNECT_RECV_ID_GET_INPUT_EVENT => {
                let r = rec as *const sc::SIMCONNECT_RECV_GET_INPUT_EVENT;
                let value = offset_of!(sc::SIMCONNECT_RECV_GET_INPUT_EVENT, Value);
                let kind = (*r).eType;
                let shown = if kind == sc::SIMCONNECT_INPUT_EVENT_TYPE_DOUBLE { read::<f64>(rec, value).to_string() } else { text_at(rec, value, size) };
                say(at, &format!("GETINPUT\t{}\t{kind}\t{shown}", { (*r).dwRequestID }));
            }
            sc::SIMCONNECT_RECV_ID_SUBSCRIBE_INPUT_EVENT => {
                let r = rec as *const sc::SIMCONNECT_RECV_SUBSCRIBE_INPUT_EVENT;
                let value = offset_of!(sc::SIMCONNECT_RECV_SUBSCRIBE_INPUT_EVENT, Value);
                let (hash, kind) = ((*r).Hash, (*r).eType);
                let shown = if kind == sc::SIMCONNECT_INPUT_EVENT_TYPE_DOUBLE { read::<f64>(rec, value).to_string() } else { text_at(rec, value, size) };
                say(at, &format!("SUBINPUT\t{hash}\t{kind}\t{shown}"));
            }
            sc::SIMCONNECT_RECV_ID_FLOW_EVENT => {
                let r = rec as *const sc::SIMCONNECT_RECV_FLOW_EVENT;
                let path = (*r).FltPath;
                say(at, &format!("FLOW\t{}\t{}", { (*r).FlowEvent }, text(&path)));
            }
            sc::SIMCONNECT_RECV_ID_COMM_BUS => {
                let r = rec as *const sc::SIMCONNECT_RECV_COMM_BUS;
                say(at, &format!("COMMBUS\t{}\t{}", { (*r).uEventID }, text_at(rec, offset_of!(sc::SIMCONNECT_RECV_COMM_BUS, rgData), size)));
            }
            sc::SIMCONNECT_RECV_ID_CAMERA_DATA => {
                let r = rec as *const sc::SIMCONNECT_RECV_CAMERA_DATA;
                let d = (*r).CameraData;
                let (p, o) = (d.Position, d.Pbh);
                let (x, y, z, pitch, bank, heading, fov, referential) = (p.x, p.y, p.z, o.Pitch, o.Bank, o.Heading, d.Fov, d.PositionReferential);
                say(at, &format!("CAMERA\t{x}\t{y}\t{z}\t{pitch}\t{bank}\t{heading}\t{fov}\t{referential}"));
            }
            sc::SIMCONNECT_RECV_ID_CAMERA_STATUS => {
                let r = rec as *const sc::SIMCONNECT_RECV_CAMERA_STATUS;
                say(at, &format!("CAMSTATUS\t{}\t{}", { (*r).acquiredState }, { (*r).bGameControlled }));
            }
            other => say(at, &format!("RECV\t{other}")),
        }
    }

    unsafe fn write_in(&mut self) {
        self.seq = self.seq.wrapping_add(1);
        let sent = now();
        let mut block = [0u8; IN_SIZE as usize];
        block[0..4].copy_from_slice(&self.seq.to_le_bytes());
        block[8..16].copy_from_slice(&sent.to_le_bytes());
        let hr = sc::SimConnect_SetClientData(self.sim, IN_AREA, IN_AREA, 0, 0, IN_SIZE, block.as_mut_ptr().cast());
        say(sent, &format!("WROTE\t{}\t{hr}", self.seq));
        self.last_in = Instant::now();
    }

    unsafe fn define(&self, def: u32, name: &str, unit: &str, kind: sc::SIMCONNECT_DATATYPE) {
        let unit = if unit.is_empty() { None } else { Some(c(unit)) };
        let hr = sc::SimConnect_AddToDataDefinition(self.sim, def, c(name).as_ptr(), unit.as_ref().map_or(std::ptr::null(), |u| u.as_ptr()), kind, 0.0, sc::SIMCONNECT_UNUSED);
        self.call(&format!("define {def} {name}"), hr);
    }

    unsafe fn watch(&self, req: u32, def: u32, what: &str) {
        let hr = sc::SimConnect_RequestDataOnSimObject(self.sim, req, def, sc::SIMCONNECT_OBJECT_ID_USER, sc::SIMCONNECT_PERIOD_SIM_FRAME, sc::SIMCONNECT_DATA_REQUEST_FLAG_CHANGED, 0, 0, 0);
        self.call(&format!("request {what} each sim frame it changes"), hr);
    }

    unsafe fn init_pos(f: &[&str]) -> sc::SIMCONNECT_DATA_INITPOSITION {
        let n = |i: usize| f.get(i).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
        sc::SIMCONNECT_DATA_INITPOSITION { Latitude: n(0), Longitude: n(1), Altitude: n(2), Pitch: 0.0, Bank: 0.0, Heading: n(3), OnGround: 1, Airspeed: 0 }
    }

    unsafe fn command(&mut self, line: &str) {
        let f: Vec<&str> = line.split('\t').collect();
        let arg = |i: usize| f.get(i).copied().unwrap_or("");
        let hash = |i: usize| arg(i).parse::<u64>().unwrap_or(0);
        match arg(0) {
            "alive" => self.alive = Instant::now(),
            "qpc" => say(now(), &format!("QPC\t{}\t{}", ticks(), FREQ.get().unwrap())),
            "module" => {
                self.call("map CROSSCHECK_P08_OUT", sc::SimConnect_MapClientDataNameToID(self.sim, c("CROSSCHECK_P08_OUT").as_ptr(), OUT_AREA));
                self.call("define OUT", sc::SimConnect_AddToClientDataDefinition(self.sim, OUT_AREA, 0, OUT_SIZE, 0.0, sc::SIMCONNECT_UNUSED));
                self.call("map CROSSCHECK_P08_IN", sc::SimConnect_MapClientDataNameToID(self.sim, c("CROSSCHECK_P08_IN").as_ptr(), IN_AREA));
                self.call("define IN", sc::SimConnect_AddToClientDataDefinition(self.sim, IN_AREA, 0, IN_SIZE, 0.0, sc::SIMCONNECT_UNUSED));
                self.call("request OUT as it's set", sc::SimConnect_RequestClientData(self.sim, OUT_AREA, REQ_OUT, OUT_AREA, sc::SIMCONNECT_CLIENT_DATA_PERIOD_ON_SET, 0, 0, 0, 0));
                self.module = true;
            }
            "echo" => {
                self.define(DEF_ECHO, "L:CROSSCHECK_P08_ECHO", "number", sc::SIMCONNECT_DATATYPE_FLOAT64);
                self.watch(REQ_ECHO, DEF_ECHO, "L:CROSSCHECK_P08_ECHO");
            }
            "listen" => {
                self.call("map K:AXIS_ELEVATOR_SET to listen", sc::SimConnect_MapClientEventToSimEvent(self.sim, EV_ELEV_LISTEN, c("AXIS_ELEVATOR_SET").as_ptr()));
                self.call("add it to group H, not maskable", sc::SimConnect_AddClientEventToNotificationGroup(self.sim, GROUP_H, EV_ELEV_LISTEN, 0));
                self.call("group H at the highest priority", sc::SimConnect_SetNotificationGroupPriority(self.sim, GROUP_H, sc::SIMCONNECT_GROUP_PRIORITY_HIGHEST));
                self.define(DEF_ELEV, "L:ElevatorInput", "number", sc::SIMCONNECT_DATATYPE_FLOAT64);
                self.watch(REQ_ELEV, DEF_ELEV, "L:ElevatorInput");
            }
            "mask" => {
                // A second client event for the axis, rather than the listening
                // one moved, because removing a client event from a group cut
                // the sim event off from the client's other groups too (measured
                // on MSFS 2024, 2026-10-01, the comment on subscribeKeys in
                // experiments/areas/aircraft/lib/sim.mjs).
                self.call("map K:AXIS_ELEVATOR_SET to mask", sc::SimConnect_MapClientEventToSimEvent(self.sim, EV_ELEV_MASK, c("AXIS_ELEVATOR_SET").as_ptr()));
                self.call("add it to group A, maskable", sc::SimConnect_AddClientEventToNotificationGroup(self.sim, GROUP_A, EV_ELEV_MASK, 1));
            }
            "clear" => self.call("clear group A", sc::SimConnect_ClearNotificationGroup(self.sim, GROUP_A)),
            "pos" => {
                for (name, unit) in [("PLANE LATITUDE", "degrees"), ("PLANE LONGITUDE", "degrees"), ("PLANE ALTITUDE", "feet"), ("PLANE HEADING DEGREES TRUE", "degrees")] {
                    self.define(DEF_POS, name, unit, sc::SIMCONNECT_DATATYPE_FLOAT64);
                }
                self.call("request the position once", sc::SimConnect_RequestDataOnSimObject(self.sim, REQ_POS, DEF_POS, sc::SIMCONNECT_OBJECT_ID_USER, sc::SIMCONNECT_PERIOD_ONCE, 0, 0, 0, 0));
            }
            "strings" => {
                if self.next_strings == 0 {
                    self.define(DEF_STRINGS, "TITLE", "", sc::SIMCONNECT_DATATYPE_STRING256);
                    self.define(DEF_STRINGS, "LIVERY NAME", "", sc::SIMCONNECT_DATATYPE_STRING256);
                }
                let object = arg(1).parse::<u32>().unwrap_or(0);
                let req = REQ_STRINGS_FIRST + self.next_strings;
                self.next_strings += 1;
                self.strings.insert(req, object);
                self.call(&format!("request object {object}'s TITLE and LIVERY NAME"), sc::SimConnect_RequestDataOnSimObject(self.sim, req, DEF_STRINGS, object, sc::SIMCONNECT_PERIOD_ONCE, 0, 0, 0, 0));
            }
            "liveries" => {
                self.liveries_filter = arg(1).to_lowercase();
                self.liveries_seen = 0;
                self.call("enumerate aircraft and liveries", sc::SimConnect_EnumerateSimObjectsAndLiveries(self.sim, REQ_LIVERIES, sc::SIMCONNECT_SIMOBJECT_TYPE_AIRCRAFT));
            }
            "spawnai" => {
                let pos = Self::init_pos(&f[4.min(f.len())..]);
                let hr = sc::SimConnect_AICreateNonATCAircraft_EX1(self.sim, c(arg(1)).as_ptr(), c(arg(2)).as_ptr(), c(arg(3)).as_ptr(), pos, REQ_SPAWN_AI);
                self.call(&format!("create aircraft {} with livery {}", arg(1), arg(2)), hr);
            }
            "spawnobj" => {
                let pos = Self::init_pos(&f[3.min(f.len())..]);
                let hr = sc::SimConnect_AICreateSimulatedObject_EX1(self.sim, c(arg(1)).as_ptr(), c(arg(2)).as_ptr(), pos, REQ_SPAWN_OBJ);
                self.call(&format!("create object {}", arg(1)), hr);
            }
            "remove" => {
                let object = arg(1).parse::<u32>().unwrap_or(0);
                self.call(&format!("remove object {object}"), sc::SimConnect_AIRemoveObject(self.sim, object, REQ_REMOVE));
            }
            "camera" => {
                self.call("camera status", sc::SimConnect_CameraGetStatus(self.sim));
                self.call("camera get, relative to the aircraft", sc::SimConnect_CameraGet(self.sim, sc::SIMCONNECT_POSITION_REFERENTIAL_SIMOBJECT as u32));
            }
            "inputs" => {
                self.inputs_filter = arg(1).to_lowercase();
                self.inputs_seen = 0;
                self.call("enumerate input events", sc::SimConnect_EnumerateInputEvents(self.sim, REQ_INPUTS));
            }
            "inputget" => self.call(&format!("get input event {}", hash(1)), sc::SimConnect_GetInputEvent(self.sim, REQ_GETINPUT, hash(1))),
            "inputsub" => self.call(&format!("subscribe input event {}", hash(1)), sc::SimConnect_SubscribeInputEvent(self.sim, hash(1))),
            "inputset" => {
                let mut value: f64 = arg(2).parse().unwrap_or(0.0);
                let hr = sc::SimConnect_SetInputEvent(self.sim, hash(1), std::mem::size_of::<f64>() as u32, (&mut value as *mut f64).cast::<c_void>());
                self.call(&format!("set input event {} to {value}", hash(1)), hr);
            }
            "battery" => {
                self.define(DEF_BATTERY, "L:Battery1Switch", "number", sc::SIMCONNECT_DATATYPE_FLOAT64);
                self.watch(REQ_BATTERY, DEF_BATTERY, "L:Battery1Switch");
            }
            "bus" => {
                let body = c(arg(2));
                let len = body.as_bytes_with_nul().len() as u32;
                let hr = sc::SimConnect_CallCommBusEvent(self.sim, c(arg(1)).as_ptr(), sc::SIMCONNECT_COMM_BUS_BROADCAST_TO_JS, len, body.as_ptr());
                self.call(&format!("call {} on the CommBus for JavaScript", arg(1)), hr);
            }
            "quit" => self.quit = true,
            "" => {}
            other => say(now(), &format!("UNKNOWN\t{other}")),
        }
    }

    unsafe fn let_go(&self, why: &str) {
        self.call("clear group A", sc::SimConnect_ClearNotificationGroup(self.sim, GROUP_A));
        self.call("clear group H", sc::SimConnect_ClearNotificationGroup(self.sim, GROUP_H));
        say(now(), &format!("LETGO\t{why}"));
    }
}

fn main() {
    let mut f = 0i64;
    unsafe { QueryPerformanceFrequency(&mut f) };
    FREQ.set(f).unwrap();
    let started = Instant::now();

    let (tx, rx) = mpsc::channel::<Option<String>>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            if tx.send(Some(line)).is_err() {
                return;
            }
        }
        let _ = tx.send(None);
    });

    unsafe {
        // SimConnect signals this event when a record is waiting, so the client
        // stamps a record as it arrives rather than at its next poll.
        let signal = CreateEventW(std::ptr::null(), 0, 0, std::ptr::null());
        let mut sim: sc::HANDLE = null_mut();
        let name = c("CROSSCHECK p08 client");
        let mut waited = false;
        loop {
            let hr = sc::SimConnect_Open(&mut sim, name.as_ptr(), null_mut(), 0, signal as sc::HANDLE, 0);
            if hr == 0 {
                break;
            }
            if !waited {
                say(now(), &format!("WAITING\t{hr}"));
                waited = true;
            }
            if started.elapsed() > CONNECT_CAP {
                say(now(), "GAVEUP");
                std::process::exit(1);
            }
            if let Ok(None) = rx.try_recv() {
                std::process::exit(0);
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        say(now(), &format!("CONNECTED\t{}", started.elapsed().as_millis()));

        let mut st = State {
            sim,
            alive: Instant::now(),
            module: false,
            seq: 0,
            last_in: Instant::now(),
            strings: HashMap::new(),
            next_strings: 0,
            liveries_filter: String::new(),
            liveries_seen: 0,
            inputs_filter: String::new(),
            inputs_seen: 0,
            quit: false,
        };
        // The event first, then the priority, as subscribeKeys orders them; the
        // sim refused a priority for a group with no events in it (measured on
        // MSFS 2024, 2026-10-07, record/areas/flight-controls/log.md).
        st.call("map K:SIM_RATE_INCR", sc::SimConnect_MapClientEventToSimEvent(sim, EV_ANCHOR, c("SIM_RATE_INCR").as_ptr()));
        st.call("add it to group A, not maskable", sc::SimConnect_AddClientEventToNotificationGroup(sim, GROUP_A, EV_ANCHOR, 0));
        st.call("group A at 10,000,000", sc::SimConnect_SetNotificationGroupPriority(sim, GROUP_A, sc::SIMCONNECT_GROUP_PRIORITY_HIGHEST_MASKABLE));
        say(now(), "GROUPS");
        for (event, name) in [(EV_AIRCRAFT_LOADED, "AircraftLoaded"), (EV_FLIGHT_LOADED, "FlightLoaded"), (EV_SIM_START, "SimStart"), (EV_SIM_STOP, "SimStop")] {
            st.call(&format!("subscribe {name}"), sc::SimConnect_SubscribeToSystemEvent(sim, event, c(name).as_ptr()));
        }
        st.call("subscribe flow events", sc::SimConnect_SubscribeToFlowEvent(sim));
        st.call("subscribe CROSSCHECK_P08_ANSWER", sc::SimConnect_SubscribeToCommBusEvent(sim, EV_ANSWER, c("CROSSCHECK_P08_ANSWER").as_ptr()));
        say(now(), "READY");

        let why = loop {
            WaitForSingleObject(signal, 2);
            loop {
                let mut rec: *mut sc::SIMCONNECT_RECV = null_mut();
                let mut size: sc::DWORD = 0;
                if sc::SimConnect_GetNextDispatch(sim, &mut rec, &mut size) != 0 {
                    break;
                }
                let at = now();
                st.on_record(rec, size as usize, at);
            }
            while let Ok(line) = rx.try_recv() {
                match line {
                    Some(line) => st.command(&line),
                    None => st.quit = true,
                }
            }
            if st.module && st.last_in.elapsed() >= IN_EVERY {
                st.write_in();
            }
            if st.quit {
                break "asked to quit";
            }
            if st.alive.elapsed() > DEADMAN {
                break "no keepalive for 15s";
            }
            if started.elapsed() > CAP {
                break "the 45-minute cap";
            }
        };
        st.let_go(why);
        sc::SimConnect_Close(sim);
    }
    say(now(), "CLOSED");
}
