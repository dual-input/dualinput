//! The stand-in's sim, which only its thread touches: the process it watches, each open
//! connection and what the core set up on it, the aircraft, the module's frames, and the
//! signals a scenario plays.

use std::collections::{BTreeMap, BTreeSet};
use std::panic::AssertUnwindSafe;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use sim_client::message::{Data, Message};
use sim_client::{Connection, Op, SimCall, Tag, Up};
use simconnect_types::{
    SIMCONNECT_DATA_REQUEST_FLAG_CHANGED, SIMCONNECT_DATATYPE_STRING256,
    SIMCONNECT_EXCEPTION_NAME_UNRECOGNIZED, SIMCONNECT_PERIOD_ONCE,
};
use windows_sys::Win32::Foundation::{E_FAIL, FILETIME, S_OK, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, GetProcessTimes, INFINITE, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_SYNCHRONIZE, WaitForMultipleObjects, WaitForSingleObject,
};

use crate::{Act, Aircraft, Called, Message as ToThread, Module, Object, Report, Signal};

/// What the sim's open message names, as MSFS 2024's did on three sim releases: SunRise
/// 12.2, build 282174.999, and SimConnect 12.2.0.0 (measured,
/// record/areas/build/results/2026-10-18-msfs-packages-and-sdk.txt).
const APPLICATION: &str = "SunRise";
const APPLICATION_VERSION: [u32; 4] = [12, 2, 282_174, 999];
const SIMCONNECT_VERSION: [u32; 4] = [12, 2, 0, 0];

/// Frames a second unless a scenario sets another rate: our module's update rate with the
/// PA-24 parked (measured on MSFS 2024, 2026-10-09, record/areas/architecture/log.md).
const FRAMES: u32 = 89;

/// The sim's freeze events, and the variable each sets.
const FREEZES: [(&str, &str); 3] = [
    (
        "FREEZE_LATITUDE_LONGITUDE_SET",
        "IS LATITUDE LONGITUDE FREEZE ON",
    ),
    ("FREEZE_ALTITUDE_SET", "IS ALTITUDE FREEZE ON"),
    ("FREEZE_ATTITUDE_SET", "IS ATTITUDE FREEZE ON"),
];

pub(crate) struct Sim {
    up: Box<dyn FnMut(Up) + Send>,
    module: Box<dyn Module>,
    module_stopped: bool,
    /// The stand-in's own clock, which the module reads its time from.
    started: Instant,
    /// The process the bench named as the sim's, until it's found and has exited.
    watched: Option<u32>,
    /// The sim's process, by its ID and a handle to it, once found, until it exits.
    process: Option<(u32, Object)>,
    /// Whether the quit message went out, after which the sim answers no new connection.
    quit: bool,
    conns: BTreeMap<Connection, Conn>,
    /// Each unit's last connection that's gone, for `Act::Stale`.
    gone: BTreeMap<u32, Connection>,
    aircraft: Aircraft,
    /// The last `AircraftLoaded` path, which the `AircraftLoaded` state answers with.
    aircraft_path: String,
    rejected: BTreeSet<String>,
    open_reply: Duration,
    frame_every: Option<Duration>,
    next_frame: Instant,
    /// What's due later, such as a held-back open message or a played signal, in order.
    due: Vec<(Instant, Due)>,
    opened: Vec<Connection>,
    calls: Vec<Called>,
}

enum Due {
    OpenReply(Connection),
    Signal(Signal),
}

/// What the core set up on one connection.
#[derive(Default)]
struct Conn {
    open_replied: bool,
    events: BTreeMap<u32, String>,
    system: BTreeMap<String, u32>,
    flow: bool,
    definitions: BTreeMap<u32, Vec<Datum>>,
    requests: BTreeMap<u32, Request>,
    areas: BTreeMap<u32, String>,
    /// Each area read as it's set, by its request.
    area_reads: BTreeMap<u32, u32>,
}

struct Datum {
    name: String,
    text: bool,
    datum: u32,
}

struct Request {
    definition: u32,
    /// The data last sent, for a request that sends only what changed.
    last: Option<Vec<u8>>,
}

impl Sim {
    pub(crate) fn new(up: Box<dyn FnMut(Up) + Send>, module: Box<dyn Module>) -> Sim {
        let started = Instant::now();
        Sim {
            up,
            module,
            module_stopped: false,
            started,
            watched: None,
            process: None,
            quit: false,
            conns: BTreeMap::new(),
            gone: BTreeMap::new(),
            aircraft: Aircraft::default(),
            aircraft_path: String::new(),
            rejected: BTreeSet::new(),
            open_reply: Duration::ZERO,
            frame_every: Some(Duration::from_secs(1) / FRAMES),
            next_frame: started,
            due: Vec::new(),
            opened: Vec::new(),
            calls: Vec::new(),
        }
    }

    fn clock(&self) -> u64 {
        self.started.elapsed().as_micros() as u64
    }
}

/// Waits on its messages, the sim's process, and its next frame or signal, as the edge waits
/// on its connections and the sim's process (record/areas/core/03-sim-seam-and-wasm-module.md,
/// "Its thread").
pub(crate) fn run(mut sim: Sim, from: &mpsc::Receiver<ToThread>, wake: &Object) {
    loop {
        while let Ok(message) = from.try_recv() {
            match message {
                ToThread::Call(call) => sim.call(call),
                ToThread::Act(act) => sim.act(act),
                ToThread::Report(to) => {
                    let _ = to.send(sim.report());
                }
                ToThread::Stop => return,
            }
        }
        sim.run_due();
        if sim.frame_every.is_some() && Instant::now() >= sim.next_frame {
            sim.frame();
        }
        let next = sim
            .due
            .iter()
            .map(|(at, _)| *at)
            .chain(sim.frame_every.map(|_| sim.next_frame))
            .min();
        let timeout = next.map_or(INFINITE, |at| {
            at.saturating_duration_since(Instant::now()).as_millis() as u32
        });
        let mut handles = vec![wake.0];
        handles.extend(sim.process.as_ref().map(|(_, process)| process.0));
        // SAFETY: each handle stays open through the wait.
        let woke =
            unsafe { WaitForMultipleObjects(handles.len() as u32, handles.as_ptr(), 0, timeout) };
        if woke == WAIT_OBJECT_0 + 1 {
            sim.exited();
        }
    }
}

impl Sim {
    fn call(&mut self, call: SimCall) {
        match call {
            SimCall::FindProcess => self.find(),
            SimCall::Open { connection, .. } => self.open(connection),
            SimCall::Close { connection } => {
                if self.conns.remove(&connection).is_some() {
                    self.gone.insert(connection.unit, connection);
                }
            }
            SimCall::On {
                connection,
                tag,
                op,
            } => self.on(connection, tag, op),
        }
    }

    fn open(&mut self, connection: Connection) {
        // SimConnect_Open returned E_FAIL until the sim took connections, 109s into its
        // boot (measured on MSFS 2024, 2026-10-09, record/areas/architecture/log.md,
        // "Connecting as the sim boots").
        if self.process.is_none() {
            self.hand_up(Up::Opened {
                connection,
                result: E_FAIL,
            });
            return;
        }
        // A sim that is shutting down may still return S_OK, which is unverified
        // (record/areas/core/03-sim-seam-and-wasm-module.md, "Connections"). The stand-in
        // plays that case, a connection that never answers, so a bench case shows the core
        // opening nothing after the quit message.
        if self.quit {
            self.hand_up(Up::Opened {
                connection,
                result: S_OK,
            });
            return;
        }
        self.conns.insert(connection, Conn::default());
        self.opened.push(connection);
        self.hand_up(Up::Opened {
            connection,
            result: S_OK,
        });
        let at = Instant::now() + self.open_reply;
        self.schedule(at, Due::OpenReply(connection));
    }

    fn act(&mut self, act: Act) {
        match act {
            Act::Watch { process } => self.watched = Some(process),
            Act::Lose { unit } => {
                let newest = self.conns.keys().rev().find(|c| c.unit == unit).copied();
                if let Some(connection) = newest {
                    self.conns.remove(&connection);
                    self.gone.insert(unit, connection);
                    self.hand_up(Up::Lost { connection });
                }
            }
            Act::Quit => {
                self.quit = true;
                let open: Vec<Connection> = self.conns.keys().copied().collect();
                for connection in open {
                    self.send(connection, &Message::Quit);
                }
            }
            Act::Play(signals) => {
                let mut at = Instant::now();
                for (after, signal) in signals {
                    at += Duration::from_millis(after);
                    self.schedule(at, Due::Signal(signal));
                }
            }
            Act::Reject { name } => {
                self.rejected
                    .insert(name.strip_prefix("A:").unwrap_or(&name).to_string());
            }
            Act::OpenReply { delay } => self.open_reply = delay,
            Act::Frames { per_second } => {
                self.frame_every = (per_second > 0).then(|| Duration::from_secs(1) / per_second);
                self.next_frame = Instant::now();
            }
            Act::StopModule => self.module_stopped = true,
            Act::Module(module) => {
                self.module = module;
                self.module_stopped = false;
            }
            Act::Stale { unit } => {
                if let Some(&connection) = self.gone.get(&unit) {
                    self.hand_up(Up::Message {
                        connection,
                        record: Message::Event {
                            group: u32::MAX,
                            event: 1,
                            data: 0,
                        }
                        .record(),
                        call: None,
                    });
                }
            }
        }
    }

    fn report(&self) -> Report {
        Report {
            opened: self.opened.clone(),
            calls: self.calls.clone(),
            variables: self.aircraft.variables(),
            module_stopped: self.module_stopped,
        }
    }

    /// One of SimConnect's functions, answered as the sim would.
    fn on(&mut self, connection: Connection, tag: Tag, op: Op) {
        let Some(conn) = self.conns.get_mut(&connection) else {
            return;
        };
        self.calls.push(Called {
            connection,
            op: op.clone(),
            before_open_reply: !conn.open_replied,
        });
        match op {
            Op::MapClientEventToSimEvent { event, name } => {
                conn.events.insert(event, name);
            }
            Op::TransmitClientEvent { event, data, .. } => {
                let name = conn.events.get(&event).cloned().unwrap_or_default();
                if let Some((_, var)) = FREEZES.iter().find(|(e, _)| *e == name) {
                    self.aircraft.set_number(var, f64::from(data));
                }
            }
            Op::AddClientEventToNotificationGroup { .. }
            | Op::SetNotificationGroupPriority { .. } => {}
            Op::SubscribeToSystemEvent { event, name } => {
                conn.system.insert(name, event);
            }
            Op::SubscribeToFlowEvent => conn.flow = true,
            Op::RequestSystemState { request, state } => {
                let text = if state == "AircraftLoaded" {
                    self.aircraft_path.clone()
                } else {
                    String::new()
                };
                let message = Message::SystemState {
                    request,
                    integer: 0,
                    float: 0.0,
                    text,
                };
                self.send(connection, &message);
            }
            Op::AddToDataDefinition {
                definition,
                name,
                datatype,
                datum,
                ..
            } => {
                if self.rejected.contains(&name) {
                    // Which argument the sim names for an unknown variable is unverified, so
                    // the stand-in names the variable's name, the call's third.
                    let message = Message::Exception {
                        exception: SIMCONNECT_EXCEPTION_NAME_UNRECOGNIZED as u32,
                        send_id: 0,
                        index: 3,
                    };
                    self.send_tagged(connection, &message, tag);
                } else {
                    conn.definitions.entry(definition).or_default().push(Datum {
                        name,
                        text: datatype == SIMCONNECT_DATATYPE_STRING256,
                        datum,
                    });
                }
            }
            Op::RequestDataOnSimObject {
                request,
                definition,
                period,
                flags,
                ..
            } => {
                if period == SIMCONNECT_PERIOD_ONCE {
                    if let Some(data) = self.data(connection, request, definition) {
                        self.send(connection, &Message::ObjectData(data));
                    }
                } else if flags & SIMCONNECT_DATA_REQUEST_FLAG_CHANGED != 0 {
                    conn.requests.insert(
                        request,
                        Request {
                            definition,
                            last: None,
                        },
                    );
                }
            }
            Op::SetDataOnSimObject {
                definition, data, ..
            } => {
                let mut at = 0;
                for d in conn.definitions.get(&definition).into_iter().flatten() {
                    if d.text {
                        let Some(field) = data.get(at..at + 256) else {
                            break;
                        };
                        let end = field.iter().position(|&b| b == 0).unwrap_or(256);
                        self.aircraft
                            .set_text(&d.name, &String::from_utf8_lossy(&field[..end]));
                        at += 256;
                    } else {
                        let Some(bytes) = data.get(at..at + 8) else {
                            break;
                        };
                        let value = f64::from_le_bytes(bytes.try_into().unwrap_or([0; 8]));
                        self.aircraft.set_number(&d.name, value);
                        at += 8;
                    }
                }
            }
            Op::MapClientDataNameToId { name, area } => {
                conn.areas.insert(area, name);
            }
            Op::AddToClientDataDefinition { .. } => {}
            Op::RequestClientData { area, request, .. } => {
                conn.area_reads.insert(request, area);
            }
            Op::SetClientData { area, data, .. } => {
                let name = conn.areas.get(&area).cloned();
                if let Some(name) = name
                    && !self.module_stopped
                    && self.module.slots().contains(&name)
                {
                    let clock = self.clock();
                    self.module.written(&name, &data, clock);
                }
            }
        }
    }

    /// A request's values, tagged, each with its datum's ID.
    fn data(&self, connection: Connection, request: u32, definition: u32) -> Option<Data> {
        let conn = self.conns.get(&connection)?;
        let datums = conn.definitions.get(&definition)?;
        let mut bytes = Vec::new();
        for d in datums {
            bytes.extend_from_slice(&d.datum.to_le_bytes());
            if d.text {
                let mut field = [0u8; 256];
                let text = self.aircraft.text(&d.name);
                let n = text.len().min(255);
                field[..n].copy_from_slice(&text.as_bytes()[..n]);
                bytes.extend_from_slice(&field);
            } else {
                bytes.extend_from_slice(&self.aircraft.number(&d.name).to_le_bytes());
            }
        }
        Some(Data {
            request,
            object: 0,
            definition,
            flags: 2,
            count: datums.len() as u32,
            bytes,
        })
    }

    /// One frame: the module's, unless it stopped, then each watch whose values changed.
    fn frame(&mut self) {
        self.next_frame += self.frame_every.unwrap_or(Duration::ZERO);
        if self.next_frame < Instant::now() {
            self.next_frame = Instant::now();
        }
        if !self.module_stopped {
            let clock = self.clock();
            let (module, aircraft) = (&mut self.module, &mut self.aircraft);
            // A panic in our module stops it in the sim, which marks it DIRTY and runs it no
            // more, while the sim runs on, so the stand-in stops it too.
            match std::panic::catch_unwind(AssertUnwindSafe(|| module.frame(clock, aircraft))) {
                Ok(writes) => {
                    for (slot, bytes) in writes {
                        self.area_written(&slot, &bytes);
                    }
                }
                Err(_) => self.module_stopped = true,
            }
        }
        let changed: Vec<(Connection, u32, u32)> = self
            .conns
            .iter()
            .flat_map(|(&c, conn)| {
                conn.requests
                    .iter()
                    .map(move |(&r, q)| (c, r, q.definition))
            })
            .collect();
        for (connection, request, definition) in changed {
            let Some(data) = self.data(connection, request, definition) else {
                continue;
            };
            let Some(req) = self
                .conns
                .get_mut(&connection)
                .and_then(|c| c.requests.get_mut(&request))
            else {
                continue;
            };
            if req.last.as_ref() != Some(&data.bytes) {
                req.last = Some(data.bytes.clone());
                self.send(connection, &Message::ObjectData(data));
            }
        }
    }

    /// The module wrote the area `slot`: each connection that reads it as it's set hears it.
    fn area_written(&mut self, slot: &str, bytes: &[u8]) {
        let readers: Vec<(Connection, u32)> = self
            .conns
            .iter()
            .flat_map(|(&c, conn)| {
                conn.area_reads
                    .iter()
                    .filter(|(_, area)| conn.areas.get(area).map(String::as_str) == Some(slot))
                    .map(move |(&request, _)| (c, request))
            })
            .collect();
        for (connection, request) in readers {
            let data = Data {
                request,
                object: 0,
                definition: 0,
                flags: 0,
                count: 1,
                bytes: bytes.to_vec(),
            };
            self.send(connection, &Message::ClientData(data));
        }
    }

    fn schedule(&mut self, at: Instant, due: Due) {
        let place = self.due.partition_point(|(t, _)| *t <= at);
        self.due.insert(place, (at, due));
    }

    fn run_due(&mut self) {
        let now = Instant::now();
        while self.due.first().is_some_and(|(at, _)| *at <= now) {
            let (_, due) = self.due.remove(0);
            match due {
                Due::OpenReply(connection) => {
                    if let Some(conn) = self.conns.get_mut(&connection) {
                        conn.open_replied = true;
                        let open = Message::Open {
                            application: APPLICATION.into(),
                            version: APPLICATION_VERSION,
                            simconnect: SIMCONNECT_VERSION,
                        };
                        self.send(connection, &open);
                    }
                }
                Due::Signal(signal) => self.signal(signal),
            }
        }
    }

    /// A played signal, which each connection subscribed to it hears.
    fn signal(&mut self, signal: Signal) {
        if let Signal::AircraftLoaded(path) = &signal {
            self.aircraft_path = path.clone();
        }
        let hearers: Vec<(Connection, Message)> = self
            .conns
            .iter()
            .filter_map(|(&c, conn)| {
                let system = |name: &str| conn.system.get(name).copied();
                let message = match &signal {
                    Signal::AircraftLoaded(path) => Message::Filename {
                        event: system("AircraftLoaded")?,
                        file: path.clone(),
                    },
                    Signal::FlightLoaded(path) => Message::Filename {
                        event: system("FlightLoaded")?,
                        file: path.clone(),
                    },
                    Signal::Flow(event) if conn.flow => Message::Flow {
                        event: *event,
                        path: String::new(),
                    },
                    Signal::Flow(_) => return None,
                    Signal::Pause(flags) => Message::Event {
                        group: u32::MAX,
                        event: system("Pause_EX1")?,
                        data: *flags,
                    },
                };
                Some((c, message))
            })
            .collect();
        for (connection, message) in hearers {
            self.send(connection, &message);
        }
    }

    fn send(&mut self, connection: Connection, message: &Message) {
        self.hand_up(Up::Message {
            connection,
            record: message.record(),
            call: None,
        });
    }

    /// Hands up an exception already tagged with the call that caused it, as the edge tags
    /// one by its packet ID.
    fn send_tagged(&mut self, connection: Connection, message: &Message, tag: Tag) {
        self.hand_up(Up::Message {
            connection,
            record: message.record(),
            call: Some(tag),
        });
    }

    fn hand_up(&mut self, up: Up) {
        (self.up)(up);
    }

    /// Finds the watched process, as the edge finds the sim's, while it holds none: a
    /// process that has already exited isn't found, as the edge's list of running
    /// processes wouldn't hold it.
    fn find(&mut self) {
        let Some(id) = self.watched.filter(|_| self.process.is_none()) else {
            return;
        };
        // SAFETY: OpenProcess takes access rights, an inherit flag, and an ID.
        let handle = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                id,
            )
        };
        if handle.is_null() {
            return;
        }
        let process = Object(handle);
        // SAFETY: the handle stays open through the call, and a 0ms wait only polls.
        if unsafe { WaitForSingleObject(process.0, 0) } != WAIT_TIMEOUT {
            return;
        }
        let mut times = [FILETIME::default(); 4];
        let [created, exited, kernel, user] = &mut times;
        // SAFETY: the handle stays open through the call, which writes the four times.
        if unsafe { GetProcessTimes(process.0, created, exited, kernel, user) } == 0 {
            return;
        }
        let created = u64::from(times[0].dwHighDateTime) << 32 | u64::from(times[0].dwLowDateTime);
        self.process = Some((id, process));
        self.quit = false;
        self.hand_up(Up::Found {
            process: id,
            created,
        });
    }

    /// Hands up the exit code of the sim's process. How a crash reaches a SimConnect
    /// connection, as a failed call or as nothing until the process is gone, is unmeasured
    /// (record/areas/core/03-sim-seam-and-wasm-module.md, "Its inputs"), so the stand-in
    /// hands up nothing more for the connections it drops.
    fn exited(&mut self) {
        let Some((id, process)) = self.process.take() else {
            return;
        };
        let mut code = 0;
        // SAFETY: the handle stays open through the call, which writes the code.
        unsafe { GetExitCodeProcess(process.0, &mut code) };
        // The bench may already have named the next sim's stub, which stays watched.
        if self.watched == Some(id) {
            self.watched = None;
        }
        for connection in std::mem::take(&mut self.conns).into_keys() {
            self.gone.insert(connection.unit, connection);
        }
        self.hand_up(Up::Exited { code });
    }
}
