//! The bench's sim. In a bench build of the core it takes the sim edge's place, below the
//! sim seam, and answers the loop's calls as the sim would, with SimConnect's own messages
//! (record/areas/build/02-testing.md, "The stand-in sim").
//!
//! It runs where the edge runs, off the loop on a thread of its own, and hands up what the
//! edge would, for the core to stamp and record, so a bench run's recording replays with no
//! stand-in, as a release's replays with no sim. A scenario acts on it the way things
//! happen to a sim: the bench names the process that stands for the sim's, kills that
//! process to crash it, has it quit, lose a connection, or play a flight load's signals, and
//! asks it what the core called and what its aircraft holds.
//!
//! The stand-in answers each call the platform's units make. Each later stage adds the
//! answers to its own units' calls, beside the edge that makes them in the sim.

mod aircraft;
mod motion;
mod sim;
mod world;

pub use aircraft::Aircraft;
pub use world::{Made, World};

use std::sync::{Arc, mpsc};
use std::thread::JoinHandle;
use std::time::Duration;

use sim_client::message::Camera;
use sim_client::{Connection, Op, SimCall, Up};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::Threading::{CreateEventW, SetEvent};

use crate::sim::Sim;

/// Our WASM module, as the stand-in runs it: natively, in its frames. The bench build fills
/// it with the routine host and the module's list of routines, so the stand-in, an engine,
/// depends on no platform code (record/areas/build/02-testing.md, "Our WASM module").
pub trait Module: Send {
    /// The client data areas the module creates as it starts, by name.
    fn slots(&self) -> Vec<String>;
    /// A connection wrote the area `slot`, which the module read at `clock`, in µs on the
    /// stand-in's clock.
    fn written(&mut self, slot: &str, bytes: &[u8], clock: u64);
    /// One frame at `clock`, on the sim's aircraft and objects. Returns each area the module
    /// wrote, by name, with its bytes: its status, and each routine's report, whose area's
    /// name starts with `REPORT_PREFIX`.
    fn frame(&mut self, clock: u64, world: &mut World) -> Vec<(String, Vec<u8>)>;
}

/// What the name of each report's client data area starts with, by which `Act::LateReport`
/// tells a report from the module's status. `RoutineId::report_slot` in
/// src/engines/messages/src/module.rs makes those names, so change both together.
pub const REPORT_PREFIX: &str = "DUALINPUT_REPORT_";

/// A signal of the sim's that a scenario plays, as the sim sends it around a flight load.
#[derive(Clone, Debug, PartialEq)]
pub enum Signal {
    /// The `AircraftLoaded` system event, naming the aircraft's `aircraft.cfg`, which the
    /// `AircraftLoaded` state then answers with too.
    AircraftLoaded(String),
    /// The `FlightLoaded` system event, naming the flight file.
    FlightLoaded(String),
    /// A flow event, by SimConnect's number for it, such as `SIMCONNECT_FLOW_EVENT_RTC_END`.
    Flow(i32),
    /// The `Pause_EX1` system event with its flags, 0 when nothing pauses the sim.
    Pause(u32),
}

/// What a scenario does to the sim, which no call of the core's asked for.
pub enum Act {
    /// Takes the process with this ID as the sim's, as the bench's stub for it. The
    /// stand-in finds it once the core asks, as the edge finds the sim's.
    Watch { process: u32 },
    /// Loses the newest connection of the unit at `unit`, as a failed call on it would.
    Lose { unit: u32 },
    /// Sends the quit message on every open connection. Whether a sim closing from its menu
    /// sends it before its process exits is unmeasured
    /// (record/areas/core/03-sim-seam-and-wasm-module.md, "Cases for the bench").
    Quit,
    /// Plays `signals`, each the given ms after the one before.
    Play(Vec<(u64, Signal)>),
    /// Refuses the variable `name` in every data definition after the call returned, with an
    /// exception tagged with the call.
    Reject { name: String },
    /// Holds back the sim's open message for this long after an open returns, as the sim
    /// sent it 46s after `S_OK` as it booted (record/areas/architecture/01-spine.md, "The
    /// core").
    OpenReply { delay: Duration },
    /// Sets how many frames the sim runs a second, 0 to stop them, as through a load.
    Frames { per_second: u32 },
    /// Stops the module, as the sim stops one that went `DIRTY`.
    StopModule,
    /// Runs this module from now on, such as one from another build.
    Module(Box<dyn Module>),
    /// Hands up one more message on the unit's last connection that's gone, as the sim can
    /// send one the edge reads after the connection closed.
    Stale { unit: u32 },
    /// Sets the aircraft's variables, each a number or a text, such as `SIM ON GROUND` or
    /// `TITLE`, as the sim's aircraft holds them.
    Set {
        numbers: Vec<(String, f64)>,
        texts: Vec<(String, String)>,
    },
    /// Sets the variables of the pilot's avatar on foot, such as `PLANE LATITUDE` and
    /// `IS CROUCH`, which a watch on `SIMCONNECT_OBJECT_ID_USER_AVATAR` reads.
    SetAvatar { numbers: Vec<(String, f64)> },
    /// Puts the camera where `Camera` says, in its referential, which `CameraGet` in that
    /// referential answers with.
    Camera(Camera),
    /// Lacks the SimObject titled `title`, so a create naming it fails with an exception
    /// tagged with the call. Which exception the sim sends is unverified, so the stand-in
    /// sends `SIMCONNECT_EXCEPTION_CREATE_OBJECT_FAILED`, which the SDK lists among a
    /// create's (record/areas/traffic-atc/log.md, 2026-10-17).
    Lack { title: String },
    /// Hands up `count` `Frame` events at once on each connection subscribed to it, as FS
    /// Copilot's traffic thread got several in one read when the sim outpaced it (read in the
    /// FS Copilot fork, `FsCopilot/Connection/SimTraffic.cs`).
    FrameBurst { count: u32 },
    /// Resets the sim's variables, as an aircraft change does: the module hears the reset,
    /// and every ID the Vars API gave it names nothing.
    ResetVars,
    /// Sets the aircraft's input events, each with its value, the ones
    /// `SimConnect_EnumerateInputEvents` lists. It reports nothing, as a load reports nothing.
    Inputs { events: Vec<(String, f64)> },
    /// Moves the input event `name` to `value`, and reports it to each connection subscribed to
    /// it. Moved twice, it plays the sim's double report of one flip.
    SetInput { name: String, value: f64 },
    /// The aircraft or its pilot fires the event `name` with `data`, which each connection
    /// listening to it hears.
    SendEvent { name: String, data: u32 },
    /// Scripts the aircraft's own behavior from now on, as a scenario's system needs it.
    Rule(Rule),
    /// Hands up the module's next report this long after the module made it, as a variable
    /// requested through SimConnect once came 193ms after the slot from its frame (measured on
    /// MSFS 2024, 2026-10-09, record/areas/architecture/log.md). The reports after it come on
    /// time, so the late one arrives behind newer ones.
    LateReport { delay: Duration },
    /// Hands the sim's pages the aircraft's variables `names`, as numbers, once each frame
    /// from now on, after the module's frame, or stops with no names. A scenario follows the
    /// aircraft's path by them, frame by frame.
    Track { names: Vec<String> },
    /// Puts each of the sim's own AI objects in the sim, or sets more of its variables, as an
    /// ATC app's traffic. Each moves by its velocities from then on, as the stand-in's
    /// aircraft does, and a by-type request of its kind finds it.
    Ai(Vec<Ai>),
    /// Takes the AI objects `ids` out of the sim, as an ATC app removes an aircraft that
    /// landed.
    AiGone { ids: Vec<u32> },
    /// Holds back the last answer of each of the next `count` by-type requests, so none is
    /// whole, as a busy sim's poll can be.
    HoldPolls { count: u32 },
}

/// One of the sim's own AI objects, by an ID the scenario gives it, clear of the IDs the
/// stand-in gives the objects connections create.
#[derive(Clone, Debug, PartialEq)]
pub struct Ai {
    pub id: u32,
    /// Its `SIMCONNECT_SIMOBJECT_TYPE`, such as `SIMCONNECT_SIMOBJECT_TYPE_AIRCRAFT`.
    pub kind: i32,
    pub numbers: Vec<(String, f64)>,
    pub texts: Vec<(String, String)>,
}

/// One thing the aircraft does on its own, such as "when this variable is written, set that one
/// 2s later" (record/areas/build/02-testing.md, "What it models").
#[derive(Clone, Debug, PartialEq)]
pub struct Rule {
    pub when: When,
    /// How long after `when` it acts.
    pub after: Duration,
    pub then: Then,
}

/// What sets a rule off. A name is spelled as the sim spells it, its prefix optional.
#[derive(Clone, Debug, PartialEq)]
pub enum When {
    /// A connection wrote this variable.
    Written(String),
    /// Someone sent this `K:` event.
    Sent(String),
    /// Our WASM module fired this `H:` event.
    Fired(String),
    /// Once each time this passes, from now.
    Every(Duration),
}

/// What a rule does. A value left out takes the value that set the rule off, 0 if none did.
#[derive(Clone, Debug, PartialEq)]
pub enum Then {
    Set {
        name: String,
        value: Option<f64>,
    },
    /// Sets the variable to 1 when it's 0, and to 0 otherwise.
    Flip {
        name: String,
    },
    SetInput {
        name: String,
        value: Option<f64>,
    },
    /// The aircraft fires this `H:` event, as its own code does on a click.
    Fire {
        name: String,
    },
    Send {
        name: String,
        data: Option<u32>,
    },
}

/// What the sim hands its JavaScript.
#[derive(Clone, Debug, PartialEq)]
pub enum Page {
    /// A CommBus call the core made for JavaScript, by its event's name and its text.
    CommBus { name: String, data: String },
    /// An `H:` event, with no `H:` on its name, as an instrument receives it.
    HEvent { name: String },
    /// The variables `Act::Track` named, after one frame, at `at`, in µs of the PC's own
    /// time since 1970, which two stand-ins on one PC share.
    Track { at: u64, values: Vec<f64> },
}

/// What the stand-in tells the bench when asked.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Report {
    /// Every connection the core opened while the sim took connections, in order.
    pub opened: Vec<Connection>,
    /// Every call made of it, in order.
    pub calls: Vec<Called>,
    /// The aircraft's variables, each with its value as text.
    pub variables: Vec<(String, String)>,
    /// The aircraft's input events, each with its value.
    pub inputs: Vec<(String, f64)>,
    /// The objects connections created and the sim still holds, with their variables.
    pub objects: Vec<Made>,
    /// Whether the module stopped.
    pub module_stopped: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Called {
    pub connection: Connection,
    pub op: Op,
    /// Whether the call came before the connection's open message went up.
    pub before_open_reply: bool,
}

enum Message {
    Call(SimCall),
    Act(Act),
    Report(mpsc::Sender<Report>),
    Stop,
}

/// What the loop's sink for `SimCall` and the bench reach the stand-in's thread through.
#[derive(Clone)]
pub struct StandIn {
    to: mpsc::Sender<Message>,
    /// Wakes the thread to read its messages.
    wake: Arc<Object>,
}

impl StandIn {
    /// Starts the stand-in's thread, running `module` in its frames, which hands each input
    /// up through `up`, as the edge hands its own to the core's queue, and hands `pages` each
    /// `Page` the sim would hand its JavaScript, so the bench's fake pages hear the core's
    /// announcement and each `H:` event (record/areas/build/02-testing.md, "The sim's pages").
    pub fn start(
        up: impl FnMut(Up) + Send + 'static,
        pages: impl FnMut(Page) + Send + 'static,
        module: Box<dyn Module>,
    ) -> std::io::Result<(StandIn, JoinHandle<()>)> {
        // SAFETY: an auto-reset event with no name and no security attributes.
        let wake = Arc::new(Object(unsafe {
            CreateEventW(std::ptr::null(), 0, 0, std::ptr::null())
        }));
        if wake.0.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let (to, from) = mpsc::channel();
        let sim = Sim::new(Box::new(up), Box::new(pages), module);
        let thread_wake = wake.clone();
        let thread = std::thread::Builder::new()
            .name("stand-in".into())
            .spawn(move || sim::run(sim, &from, &thread_wake))?;
        Ok((StandIn { to, wake }, thread))
    }

    /// Carries out one of the loop's calls.
    pub fn call(&self, call: SimCall) {
        self.send(Message::Call(call));
    }

    pub fn act(&self, act: Act) {
        self.send(Message::Act(act));
    }

    /// What the stand-in has been called for and what its aircraft holds, or `None` if its
    /// thread has ended.
    pub fn report(&self) -> Option<Report> {
        let (to, from) = mpsc::channel();
        self.send(Message::Report(to));
        from.recv_timeout(Duration::from_secs(5)).ok()
    }

    pub fn stop(&self) {
        self.send(Message::Stop);
    }

    fn send(&self, message: Message) {
        if self.to.send(message).is_ok() {
            // SAFETY: the event lives as long as `self.wake`.
            unsafe { SetEvent(self.wake.0) };
        }
    }
}

/// A handle to a Windows event or process, which any thread may wait on or close.
struct Object(HANDLE);

// SAFETY: Windows' synchronization objects and process handles may be used from any thread.
unsafe impl Send for Object {}
// SAFETY: as above.
unsafe impl Sync for Object {}

impl Drop for Object {
    fn drop(&mut self) {
        // SAFETY: the handle came from a Create or Open function and is closed once.
        unsafe { CloseHandle(self.0) };
    }
}
