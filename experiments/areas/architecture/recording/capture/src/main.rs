// p10's capture: it subscribes to what the core of a flying machine that also
// hosts traffic would read from the sim, and records every SimConnect record
// with the time SimConnect_GetNextDispatch handed it over, between "start" and
// "stop" (node 5.1.2 of record/areas/architecture/plan.md). p10-recording.mjs
// drives it over stdin and reads its lines on stdout:
//
//   p10-capture <names file> <recording file>
//
// Commands, one a line: alive, start, stop, quit. On "start" it subscribes, so
// the aircraft is loaded by then, and records until "stop":
//   - the flight model and the controls the flight model's samples carry, every
//     sim frame, as the flying machine's sampler reads them
//   - the camera, asked for once a sim frame, as the figure's head follows it
//   - the names file's L: and A: names, tagged, each sim frame one changes, and
//     its B: names as input event subscriptions
//   - AI aircraft within 200km and ground vehicles within 5km every 500ms, and
//     each new object's identity once
//   - the flow and system events, and p08's module's slots, written every 200ms
//
// It takes no masking group and writes nothing into the sim but our own
// module's slot, so it stays out of the pilot's input path. It exits when
// "alive" stops for 15s, when stdin closes, or after 40 minutes.

mod sc {
    #![allow(non_camel_case_types, non_snake_case, non_upper_case_globals, dead_code, clippy::all)]
    include!(concat!(env!("OUT_DIR"), "/simconnect.rs"));
}

use std::collections::{BTreeMap, BTreeSet};
use std::ffi::{c_char, CString};
use std::fs::File;
use std::io::{BufRead, BufWriter, Write};
use std::mem::offset_of;
use std::ptr::null_mut;
use std::sync::{mpsc, OnceLock};
use std::time::{Duration, Instant};

use p10_common::*;
use windows_sys::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
use windows_sys::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

const DEF_FM: u32 = 1;
const DEF_PROFILE: u32 = 2;
const DEF_TRAFFIC: u32 = 3;
const DEF_IDENT: u32 = 4;
const REQ_FM: u32 = 1;
const REQ_PROFILE: u32 = 2;
const REQ_TRAFFIC_AIR: u32 = 3;
const REQ_TRAFFIC_GROUND: u32 = 4;
const REQ_INPUTS: u32 = 5;
const REQ_IDENT_FIRST: u32 = 1000;
const EV_SIM_START: u32 = 1;
const EV_SIM_STOP: u32 = 2;
const EV_FLIGHT_LOADED: u32 = 3;
const EV_AIRCRAFT_LOADED: u32 = 4;
const EV_PAUSE: u32 = 5;
// p08's module's slots (flight/module/src/lib.rs), which it echoes.
const OUT_AREA: u32 = 0xC800;
const IN_AREA: u32 = 0xC801;
const REQ_OUT: u32 = 0xC800;
const OUT_SIZE: u32 = 48;
const IN_SIZE: u32 = 16;

const AIR_RADIUS_M: u32 = 200_000;
const GROUND_RADIUS_M: u32 = 5_000;
const TRAFFIC_EVERY: Duration = Duration::from_millis(500);
const SLOT_EVERY: Duration = Duration::from_millis(200);
const STATUS_EVERY: Duration = Duration::from_secs(10);
const DEADMAN: Duration = Duration::from_secs(15);
const CAP: Duration = Duration::from_secs(40 * 60);
const CONNECT_CAP: Duration = Duration::from_secs(10 * 60);

const FM_FIELDS: [(&str, &str); 21] = [
    ("PLANE LATITUDE", "radians"),
    ("PLANE LONGITUDE", "radians"),
    ("PLANE ALTITUDE", "feet"),
    ("PLANE PITCH DEGREES", "radians"),
    ("PLANE BANK DEGREES", "radians"),
    ("PLANE HEADING DEGREES TRUE", "radians"),
    ("VELOCITY BODY X", "feet per second"),
    ("VELOCITY BODY Y", "feet per second"),
    ("VELOCITY BODY Z", "feet per second"),
    ("ROTATION VELOCITY BODY X", "radians per second"),
    ("ROTATION VELOCITY BODY Y", "radians per second"),
    ("ROTATION VELOCITY BODY Z", "radians per second"),
    ("ACCELERATION BODY X", "feet per second squared"),
    ("ACCELERATION BODY Y", "feet per second squared"),
    ("ACCELERATION BODY Z", "feet per second squared"),
    ("YOKE X POSITION", "position"),
    ("YOKE Y POSITION", "position"),
    ("RUDDER PEDAL POSITION", "position"),
    ("BRAKE LEFT POSITION", "position"),
    ("BRAKE RIGHT POSITION", "position"),
    ("SIM ON GROUND", "bool"),
];

const TRAFFIC_FIELDS: [(&str, &str); 12] = [
    ("PLANE LATITUDE", "degrees"),
    ("PLANE LONGITUDE", "degrees"),
    ("PLANE ALTITUDE", "feet"),
    ("PLANE PITCH DEGREES", "degrees"),
    ("PLANE BANK DEGREES", "degrees"),
    ("PLANE HEADING DEGREES TRUE", "degrees"),
    ("GROUND VELOCITY", "knots"),
    ("VERTICAL SPEED", "feet per minute"),
    ("SIM ON GROUND", "bool"),
    ("LIGHT BEACON", "bool"),
    ("LIGHT LANDING", "bool"),
    ("GEAR HANDLE POSITION", "bool"),
];

static FREQ: OnceLock<i64> = OnceLock::new();

fn ticks() -> i64 {
    let mut t = 0i64;
    unsafe { QueryPerformanceCounter(&mut t) };
    t
}

// Ticks times 1,000,000 passes a signed 64-bit integer after about 10.7 days at
// 10 MHz, so the product is taken in 128 bits (the spine's Times).
fn now() -> u64 {
    ((ticks() as u128) * 1_000_000 / (*FREQ.get().unwrap() as u128)) as u64
}

fn say(line: &str) {
    let mut out = std::io::stdout();
    let _ = writeln!(out, "{}\t{line}", now());
    let _ = out.flush();
}

fn c(s: &str) -> CString {
    CString::new(s).unwrap()
}

fn text(bytes: &[c_char]) -> String {
    let b: Vec<u8> = bytes.iter().take_while(|&&c| c != 0).map(|&c| c as u8).collect();
    String::from_utf8_lossy(&b).replace(['\t', '\n', '\r'], " ")
}

unsafe fn read<T>(rec: *const sc::SIMCONNECT_RECV, offset: usize) -> T {
    std::ptr::read_unaligned((rec as *const u8).add(offset) as *const T)
}

struct Names {
    vars: Vec<(String, String)>,
    inputs: BTreeSet<String>,
}

// One name a line, tab-separated: L or A, the name, and its unit; or B and an
// input event's name, which the capture matches against the sim's list.
fn read_names(path: &str) -> Names {
    let mut names = Names { vars: vec![], inputs: BTreeSet::new() };
    for line in std::fs::read_to_string(path).expect("read the names file").lines() {
        let f: Vec<&str> = line.split('\t').collect();
        match f.as_slice() {
            ["L", name, unit] => names.vars.push((format!("L:{name}"), unit.to_string())),
            ["A", name, unit] => names.vars.push((name.to_string(), unit.to_string())),
            ["B", name] => {
                names.inputs.insert(name.to_lowercase());
            }
            _ => {}
        }
    }
    names
}

#[derive(Default)]
struct Tally {
    count: u64,
    bytes: u64,
}

struct State {
    sim: sc::HANDLE,
    names: Names,
    alive: Instant,
    quit: bool,
    subscribed: bool,
    out: Option<BufWriter<File>>,
    path: String,
    started_us: u64,
    tally: BTreeMap<u16, Tally>,
    last_traffic: Instant,
    last_slot: Instant,
    last_status: Instant,
    slot_seq: u32,
    seen_objects: BTreeSet<u32>,
    next_ident: u32,
    air_objects: u32,
    ground_objects: u32,
    inputs_matched: u32,
    exceptions_shown: u32,
    fm_since_status: u64,
}

impl State {
    unsafe fn call(&self, what: &str, hr: sc::HRESULT) {
        if hr != 0 {
            say(&format!("CALLFAILED\t{what}\t{hr}"));
        }
    }

    unsafe fn define(&self, def: u32, name: &str, unit: &str, kind: sc::SIMCONNECT_DATATYPE, datum: u32) {
        let unit = if unit.is_empty() { None } else { Some(c(unit)) };
        let hr = sc::SimConnect_AddToDataDefinition(self.sim, def, c(name).as_ptr(), unit.as_ref().map_or(std::ptr::null(), |u| u.as_ptr()), kind, 0.0, datum);
        self.call(&format!("define {def} {name}"), hr);
    }

    unsafe fn subscribe(&mut self) {
        let sim = self.sim;
        for (name, unit) in FM_FIELDS {
            self.define(DEF_FM, name, unit, sc::SIMCONNECT_DATATYPE_FLOAT64, sc::SIMCONNECT_UNUSED);
        }
        self.call("request the flight model each sim frame", sc::SimConnect_RequestDataOnSimObject(sim, REQ_FM, DEF_FM, sc::SIMCONNECT_OBJECT_ID_USER, sc::SIMCONNECT_PERIOD_SIM_FRAME, 0, 0, 0, 0));

        // Tagged, so each record carries only the entries that changed, each with
        // its datum ID, and a name the sim refuses can't shift the others' values
        // (fsc-editor, docs/sim-vars/build/v1-log.md, "2026-08-23 — The `A:` read
        // crashed the app. Positional reads were the wrong shape.").
        let vars = self.names.vars.clone();
        for (i, (name, unit)) in vars.iter().enumerate() {
            self.define(DEF_PROFILE, name, unit, sc::SIMCONNECT_DATATYPE_FLOAT64, i as u32);
        }
        let flags = sc::SIMCONNECT_DATA_REQUEST_FLAG_CHANGED | sc::SIMCONNECT_DATA_REQUEST_FLAG_TAGGED;
        self.call("request the profile's names each sim frame one changes", sc::SimConnect_RequestDataOnSimObject(sim, REQ_PROFILE, DEF_PROFILE, sc::SIMCONNECT_OBJECT_ID_USER, sc::SIMCONNECT_PERIOD_SIM_FRAME, flags, 0, 0, 0));
        say(&format!("PROFILE\t{}", vars.len()));

        for (name, unit) in TRAFFIC_FIELDS {
            self.define(DEF_TRAFFIC, name, unit, sc::SIMCONNECT_DATATYPE_FLOAT64, sc::SIMCONNECT_UNUSED);
        }
        self.define(DEF_IDENT, "TITLE", "", sc::SIMCONNECT_DATATYPE_STRING256, sc::SIMCONNECT_UNUSED);
        self.define(DEF_IDENT, "ATC ID", "", sc::SIMCONNECT_DATATYPE_STRING32, sc::SIMCONNECT_UNUSED);
        self.define(DEF_IDENT, "LIVERY NAME", "", sc::SIMCONNECT_DATATYPE_STRING256, sc::SIMCONNECT_UNUSED);

        self.call("list the input events", sc::SimConnect_EnumerateInputEvents(sim, REQ_INPUTS));

        self.call("map CROSSCHECK_P08_OUT", sc::SimConnect_MapClientDataNameToID(sim, c("CROSSCHECK_P08_OUT").as_ptr(), OUT_AREA));
        self.call("define OUT", sc::SimConnect_AddToClientDataDefinition(sim, OUT_AREA, 0, OUT_SIZE, 0.0, sc::SIMCONNECT_UNUSED));
        self.call("map CROSSCHECK_P08_IN", sc::SimConnect_MapClientDataNameToID(sim, c("CROSSCHECK_P08_IN").as_ptr(), IN_AREA));
        self.call("define IN", sc::SimConnect_AddToClientDataDefinition(sim, IN_AREA, 0, IN_SIZE, 0.0, sc::SIMCONNECT_UNUSED));
        self.call("request OUT as it's set", sc::SimConnect_RequestClientData(sim, OUT_AREA, REQ_OUT, OUT_AREA, sc::SIMCONNECT_CLIENT_DATA_PERIOD_ON_SET, 0, 0, 0, 0));
        self.subscribed = true;
    }

    fn kind_of(&self, id: i32, req: u32) -> u16 {
        match id {
            sc::SIMCONNECT_RECV_ID_SIMOBJECT_DATA | sc::SIMCONNECT_RECV_ID_SIMOBJECT_DATA_BYTYPE => match req {
                REQ_FM => FM,
                REQ_PROFILE => PROFILE,
                REQ_TRAFFIC_AIR => TRAFFIC_AIR,
                REQ_TRAFFIC_GROUND => TRAFFIC_GROUND,
                r if r >= REQ_IDENT_FIRST => IDENT,
                _ => OTHER,
            },
            sc::SIMCONNECT_RECV_ID_CLIENT_DATA => MODULE,
            sc::SIMCONNECT_RECV_ID_CAMERA_DATA => CAMERA,
            sc::SIMCONNECT_RECV_ID_SUBSCRIBE_INPUT_EVENT => INPUT_EVENT,
            sc::SIMCONNECT_RECV_ID_EVENT | sc::SIMCONNECT_RECV_ID_EVENT_FILENAME => SYSTEM,
            sc::SIMCONNECT_RECV_ID_FLOW_EVENT => FLOW,
            sc::SIMCONNECT_RECV_ID_EXCEPTION => EXCEPTION,
            sc::SIMCONNECT_RECV_ID_ENUMERATE_INPUT_EVENTS => ENUM,
            _ => OTHER,
        }
    }

    unsafe fn on_record(&mut self, rec: *const sc::SIMCONNECT_RECV, size: usize, at: u64) {
        let id = (*rec).dwID as i32;
        let is_data = id == sc::SIMCONNECT_RECV_ID_SIMOBJECT_DATA || id == sc::SIMCONNECT_RECV_ID_SIMOBJECT_DATA_BYTYPE;
        let req: u32 = if is_data { read(rec, offset_of!(sc::SIMCONNECT_RECV_SIMOBJECT_DATA, dwRequestID)) } else { 0 };
        let kind = self.kind_of(id, req);

        if let Some(out) = self.out.as_mut() {
            let bytes = std::slice::from_raw_parts(rec as *const u8, size).to_vec();
            let n = write_input(out, &Input { us: at, kind, bytes }).expect("write the recording");
            let t = self.tally.entry(kind).or_default();
            t.count += 1;
            t.bytes += n as u64;
        }

        match kind {
            FM => {
                self.fm_since_status += 1;
                self.call("camera get", sc::SimConnect_CameraGet(self.sim, sc::SIMCONNECT_POSITION_REFERENTIAL_WORLD as u32));
            }
            TRAFFIC_AIR | TRAFFIC_GROUND => {
                let object: u32 = read(rec, offset_of!(sc::SIMCONNECT_RECV_SIMOBJECT_DATA, dwObjectID));
                let out_of: u32 = read(rec, offset_of!(sc::SIMCONNECT_RECV_SIMOBJECT_DATA, dwoutof));
                if kind == TRAFFIC_AIR { self.air_objects = out_of } else { self.ground_objects = out_of }
                if self.seen_objects.insert(object) {
                    let r = REQ_IDENT_FIRST + self.next_ident;
                    self.next_ident += 1;
                    self.call("ask a new object's identity once", sc::SimConnect_RequestDataOnSimObject(self.sim, r, DEF_IDENT, object, sc::SIMCONNECT_PERIOD_ONCE, 0, 0, 0, 0));
                }
            }
            ENUM => {
                let r = rec as *const sc::SIMCONNECT_RECV_ENUMERATE_INPUT_EVENTS;
                let (count, entry, out_of) = ((*r)._base.dwArraySize, (*r)._base.dwEntryNumber, (*r)._base.dwOutOf);
                let first = offset_of!(sc::SIMCONNECT_RECV_ENUMERATE_INPUT_EVENTS, rgData);
                let step = std::mem::size_of::<sc::SIMCONNECT_INPUT_EVENT_DESCRIPTOR>();
                for i in 0..count as usize {
                    let e: sc::SIMCONNECT_INPUT_EVENT_DESCRIPTOR = read(rec, first + i * step);
                    let name = e.Name;
                    if self.names.inputs.contains(&text(&name).to_lowercase()) {
                        self.inputs_matched += 1;
                        self.call("subscribe an input event", sc::SimConnect_SubscribeInputEvent(self.sim, e.Hash));
                    }
                }
                if entry + 1 >= out_of {
                    say(&format!("INPUTS\t{}\t{}", self.inputs_matched, self.names.inputs.len()));
                }
            }
            EXCEPTION if self.exceptions_shown < 20 => {
                self.exceptions_shown += 1;
                let r = rec as *const sc::SIMCONNECT_RECV_EXCEPTION;
                say(&format!("EXCEPTION\t{}\t{}\t{}", { (*r).dwException }, { (*r).dwSendID }, { (*r).dwIndex }));
            }
            _ => {}
        }
        if id == sc::SIMCONNECT_RECV_ID_QUIT {
            say("SIMQUIT");
            self.quit = true;
        }
    }

    unsafe fn timers(&mut self) {
        if !self.subscribed {
            return;
        }
        if self.last_traffic.elapsed() >= TRAFFIC_EVERY {
            self.last_traffic = Instant::now();
            self.call("request AI aircraft", sc::SimConnect_RequestDataOnSimObjectType(self.sim, REQ_TRAFFIC_AIR, DEF_TRAFFIC, AIR_RADIUS_M, sc::SIMCONNECT_SIMOBJECT_TYPE_AIRCRAFT));
            self.call("request ground vehicles", sc::SimConnect_RequestDataOnSimObjectType(self.sim, REQ_TRAFFIC_GROUND, DEF_TRAFFIC, GROUND_RADIUS_M, sc::SIMCONNECT_SIMOBJECT_TYPE_GROUND));
        }
        if self.last_slot.elapsed() >= SLOT_EVERY {
            self.last_slot = Instant::now();
            self.slot_seq = self.slot_seq.wrapping_add(1);
            let mut block = [0u8; IN_SIZE as usize];
            block[0..4].copy_from_slice(&self.slot_seq.to_le_bytes());
            block[8..16].copy_from_slice(&now().to_le_bytes());
            self.call("write IN", sc::SimConnect_SetClientData(self.sim, IN_AREA, IN_AREA, 0, 0, IN_SIZE, block.as_mut_ptr().cast()));
        }
        if self.last_status.elapsed() >= STATUS_EVERY {
            let secs = self.last_status.elapsed().as_secs_f64();
            self.last_status = Instant::now();
            let fps = self.fm_since_status as f64 / secs;
            self.fm_since_status = 0;
            let (records, bytes) = self.tally.values().fold((0, 0), |(c, b), t| (c + t.count, b + t.bytes));
            let recording = if self.out.is_some() { (now() - self.started_us) as f64 / 1e6 } else { 0.0 };
            say(&format!("STATUS\t{recording:.0}\t{fps:.1}\t{}\t{}\t{records}\t{bytes}", self.air_objects, self.ground_objects));
        }
    }

    unsafe fn command(&mut self, line: &str) {
        match line.trim() {
            "alive" => self.alive = Instant::now(),
            "start" if self.out.is_none() => {
                if !self.subscribed {
                    self.subscribe();
                }
                self.out = Some(BufWriter::new(File::create(&self.path).expect("create the recording")));
                self.started_us = now();
                self.tally.clear();
                self.last_status = Instant::now();
                self.fm_since_status = 0;
                say("STARTED");
            }
            "stop" => self.stop(),
            "quit" => self.quit = true,
            "" => {}
            other => say(&format!("UNKNOWN\t{other}")),
        }
    }

    fn stop(&mut self) {
        let Some(mut out) = self.out.take() else { return };
        out.flush().expect("flush the recording");
        let secs = (now() - self.started_us) as f64 / 1e6;
        for (kind, t) in &self.tally {
            say(&format!("KIND\t{kind}\t{}\t{}\t{}", kind_name(*kind), t.count, t.bytes));
        }
        let (records, bytes) = self.tally.values().fold((0, 0), |(c, b), t| (c + t.count, b + t.bytes));
        say(&format!("TOTAL\t{secs:.1}\t{records}\t{bytes}\t{}", self.seen_objects.len()));
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (names_path, path) = match args.as_slice() {
        [_, n, p] => (n.clone(), p.clone()),
        _ => {
            eprintln!("usage: p10-capture <names file> <recording file>");
            std::process::exit(2);
        }
    };
    let mut f = 0i64;
    unsafe { QueryPerformanceFrequency(&mut f) };
    FREQ.set(f).unwrap();
    let names = read_names(&names_path);
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
        // SimConnect signals this event when a record is waiting, so a record is
        // stamped as it arrives rather than at the next poll.
        let signal = CreateEventW(std::ptr::null(), 0, 0, std::ptr::null());
        let mut sim: sc::HANDLE = null_mut();
        let name = c("CROSSCHECK p10 capture");
        let mut waited = false;
        loop {
            if sc::SimConnect_Open(&mut sim, name.as_ptr(), null_mut(), 0, signal as sc::HANDLE, 0) == 0 {
                break;
            }
            if !waited {
                say("WAITING");
                waited = true;
            }
            if started.elapsed() > CONNECT_CAP {
                say("GAVEUP");
                std::process::exit(1);
            }
            if let Ok(None) = rx.try_recv() {
                std::process::exit(0);
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        say("CONNECTED");

        let mut st = State {
            sim,
            names,
            alive: Instant::now(),
            quit: false,
            subscribed: false,
            out: None,
            path,
            started_us: 0,
            tally: BTreeMap::new(),
            last_traffic: Instant::now(),
            last_slot: Instant::now(),
            last_status: Instant::now(),
            slot_seq: 0,
            seen_objects: BTreeSet::new(),
            next_ident: 0,
            air_objects: 0,
            ground_objects: 0,
            inputs_matched: 0,
            exceptions_shown: 0,
            fm_since_status: 0,
        };
        for (event, name) in [(EV_SIM_START, "SimStart"), (EV_SIM_STOP, "SimStop"), (EV_FLIGHT_LOADED, "FlightLoaded"), (EV_AIRCRAFT_LOADED, "AircraftLoaded"), (EV_PAUSE, "Pause")] {
            st.call(&format!("subscribe {name}"), sc::SimConnect_SubscribeToSystemEvent(sim, event, c(name).as_ptr()));
        }
        st.call("subscribe flow events", sc::SimConnect_SubscribeToFlowEvent(sim));
        say("READY");

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
            st.timers();
            if st.quit {
                break "asked to quit";
            }
            if st.alive.elapsed() > DEADMAN {
                break "no keepalive for 15s";
            }
            if started.elapsed() > CAP {
                break "the 40-minute cap";
            }
        };
        st.stop();
        say(&format!("LETGO\t{why}"));
        sc::SimConnect_Close(sim);
    }
    say("CLOSED");
}
