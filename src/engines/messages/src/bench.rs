//! The lines the bench and a bench build of the core trade over the bench's socket, a TCP
//! socket on 127.0.0.1 that only a build with the `stand-in` feature opens. The bench
//! drives the core's test units and its stand-in sim through it, from outside the core, as
//! a pilot's surroundings would (record/areas/build/02-testing.md, "Its place").
//!
//! Each line is one of these as JSON. The bench is TypeScript, so ts-rs writes their types
//! into ts/bench/ when this crate's tests run.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The core's first line, so a bench that was built from another tree refuses the core,
/// as every program's first message does (decision 026).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bench/")]
pub struct Hello {
    pub version: String,
    pub hash: String,
}

/// A line from the bench, such as `{"kind":"count","n":3}`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum ToCore {
    /// A numbered line, whose number a test unit logs as it handles it, so a replay of the
    /// recording tells a scenario which of the lines it sent reached the loop.
    Count { n: u32 },
    /// Plays the loop under load: the capture of a flight at `capture`, in the format
    /// tools/bench/fixtures/README.md gives, `plays` times over, with the made-up inputs of
    /// a session beside it, then exits the core.
    Load { capture: String, plays: u32 },
    /// Has a test unit put out the core's exit.
    Exit,
    /// Has a test unit's handler panic.
    Panic,
    /// Acts on the stand-in sim, as something happens to the sim. It goes to the stand-in's
    /// thread, and is no input of the core's.
    StandIn { act: StandInAct },
    /// Has the sim's test unit, which stands in for a feature, make a call of the sim.
    Sim { call: SimCall },
    /// Has the clients' test unit, which stands in for a feature with a slice and a panel
    /// module, act.
    Clients { act: ClientsAct },
    /// Has the core helper's test unit, which stands in for the features that want things
    /// of the core helper, act.
    Helper { act: HelperAct },
    /// Has the network's test unit, which stands in for a feature with a channel of each
    /// delivery, act.
    Net { act: NetAct },
    /// Has the cockpit stream's test unit, which stands in for state sync, act.
    Cockpit { act: CockpitAct },
}

/// What the cockpit stream's test unit does. It registers state sync's sorts of kind, and a
/// catch-up step that hands over the values it holds, by key.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "act", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum CockpitAct {
    /// Sends `count` messages of `kind` for `key`, the first with `value` and each after with 1
    /// more, one every `every_ms`.
    Send {
        kind: BenchKind,
        key: String,
        value: f64,
        count: u32,
        every_ms: u32,
    },
    /// Says whether its catch-up step can give and take while this member is in the flight, as
    /// state sync's can while its profile is loaded.
    Ready { on: bool },
    /// How long its step takes to land after it takes a catch-up, as an aircraft settling.
    Settle { ms: u64 },
    /// Asks for control, as the take-control key does.
    TakeControl,
    /// Tells the bench, as a `cockpit report` line, the values it holds, the take-control
    /// verdict, and the stream's state.
    Report,
}

/// The kinds of the cockpit stream's test unit.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum BenchKind {
    /// A shared entry's value, which the stream holds newest, as state sync's change.
    Held,
    /// A value only the pilot flying sends, which a replay collapses, as state sync's.
    PilotFlying,
    /// An event, as state sync's firing.
    Event,
}

pub const HELD: crate::cockpit::CockpitKind<f64> = crate::cockpit::CockpitKind::new(1001);
pub const PILOT_FLYING: crate::cockpit::CockpitKind<f64> = crate::cockpit::CockpitKind::new(1002);
pub const EVENT: crate::cockpit::CockpitKind<f64> = crate::cockpit::CockpitKind::new(1003);
/// The test unit's catch-up step.
pub const STEP: u16 = 1001;

/// What the core helper's test unit does. It registers one of each want: a binding to the
/// setting `bench.input`, the next press, the mouse, a capture, a playback stream, and a
/// sound, the bench's tone.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "act", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum HelperAct {
    Binding {
        on: bool,
    },
    NextPress {
        on: bool,
    },
    Mouse {
        on: bool,
    },
    /// Captures the first running program of `programs`, or stops with `None`.
    Capture {
        programs: Option<Vec<String>>,
    },
    Stream {
        on: bool,
    },
    Sounds {
        on: bool,
    },
    Play,
    /// Hands the stream `per_second` frames a second, each of `bytes` bytes, for `for_ms`.
    Frames {
        per_second: u32,
        bytes: u32,
        for_ms: u64,
    },
    /// Hands the stream each frame the capture brings, as ATC audio's path between two
    /// machines would, on one.
    Loop {
        on: bool,
    },
}

/// What the bench tells the stand-in core helper over the line the stand-in opens to it
/// (record/areas/build/02-testing.md, "The stand-in core helper").
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "act", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum StandInHelperAct {
    /// Says hello to the core, as the version and hash given, or as this build.
    Hello {
        version: Option<String>,
        hash: Option<String>,
    },
    /// The binding numbered `binding` went down or up.
    Press { binding: u16, down: bool },
    NextPress {
        input: crate::core_helper::Input,
        name: String,
    },
    /// A left click in the sim's main window at `x`, `y`.
    Click { x: f32, y: f32 },
    /// One mouse event at `x`, `y`, from −1 to 1 right and up, as a pilot's press, release, or
    /// wheel notch comes one at a time.
    Mouse {
        kind: crate::core_helper::MouseKind,
        x: f32,
        y: f32,
    },
    /// Sends `per_second` mouse moves a second for `for_ms`, as a pilot dragging a knob would.
    Moves { per_second: u32, for_ms: u64 },
    /// A captured frame of `bytes` bytes for the capture numbered `capture`.
    Frame { capture: u16, bytes: u32 },
    /// The program a capture takes, or that it waits for one.
    Capturing {
        capture: u16,
        program: Option<String>,
    },
    /// A want the helper can't carry out.
    Failed {
        want: crate::core_helper::WantId,
        error: String,
    },
    Lists {
        outputs: Vec<crate::core_helper::DeviceInfo>,
        programs: Vec<String>,
    },
    /// The output device the helper plays on.
    InUse {
        output: Option<crate::core_helper::DeviceInfo>,
    },
    /// Exits with `code`, as a crash would.
    Exit { code: i32 },
}

/// What the stand-in core helper tells the bench.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "line", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum StandInHelperLine {
    /// It started, as this process.
    Started {
        process: u32,
    },
    /// The core sent it every want, whole.
    Wants {
        bindings: Vec<(u16, crate::core_helper::Input)>,
        next_press: bool,
        mouse: bool,
        captures: Vec<u16>,
        streams: Vec<u16>,
        /// Each capture's programs, in the order the helper looks for them.
        programs: Vec<(u16, Vec<String>)>,
        /// Each stream's gain.
        gains: Vec<(u16, f32)>,
        sounds: bool,
        lists: bool,
    },
    Sound {
        sound: u16,
        bytes: u32,
    },
    Play {
        sound: u16,
        /// How long after the stamp on the last press the bench told it to make, on the
        /// performance counter, as take-control's budget counts it. 0 before any press.
        since_press_us: u64,
    },
    Frame {
        stream: u16,
        number: u32,
    },
    /// Its standard input closed, so it exits.
    Closed,
}

/// What the clients' test unit does.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "act", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum ClientsAct {
    /// Has the unit's panel module, `bench-panel`, take each instrument whose key starts with
    /// one of `picks`, once a profile loads, as a feature's rule picks instruments by its
    /// profile's block. The clients crate answers each panel running a module again at once.
    Picks { picks: Vec<String> },
    /// Asks for every cockpit panel again, through the announcement's `panels` count, as a
    /// feature that wants panels told `none` does.
    RecallPanels,
    /// Changes the slice `bench` `per_second` times a second for `for_ms`.
    Churn { per_second: u32, for_ms: u64 },
    /// Raises a notification with no action, as `bench-clients.<id>`, as a feature raises
    /// one in its own words.
    Notify { id: String, text: String },
}

/// What the bench does to the stand-in sim.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "act", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum StandInAct {
    /// Takes the process with this ID, the bench's stub, as the sim's.
    Watch { process: u32 },
    /// Loses the newest connection of the unit named `unit`.
    Lose { unit: String },
    /// Sends the sim's quit message on every open connection.
    Quit,
    /// Plays the sim's signals, each `after_ms` after the one before.
    Play { signals: Vec<Played> },
    /// Refuses the variable `name` in every data definition after the call returned.
    Reject { name: String },
    /// Holds back the sim's open message for this long after each open returns.
    OpenReply { delay_ms: u64 },
    /// Runs this many frames a second, 0 to stop them.
    Frames { per_second: u32 },
    /// Stops our module, as the sim stops one that went `DIRTY`.
    StopModule,
    /// Runs a module from a build whose slots hash is this one, given in hex.
    ModuleFrom { slots_hash: String },
    /// Hands up one more message on the named unit's last connection that's gone.
    Stale { unit: String },
    /// Sets the aircraft's variables, each a number or a text, such as `A:SIM ON GROUND` or
    /// `A:TITLE`.
    Set {
        numbers: Vec<(String, f64)>,
        texts: Vec<(String, String)>,
    },
    /// Sets the variables of the pilot's avatar on foot, such as `A:PLANE LATITUDE`.
    SetAvatar { numbers: Vec<(String, f64)> },
    /// Puts the camera where `CameraGet` and the module's read in `referential` find it: 1 for
    /// `SIMOBJECT`, in meters from the aircraft's reference point, x left, y up, z forward,
    /// and 2 for `WORLD`, latitude and longitude in degrees and altitude in meters; its angles
    /// in degrees, and its field of view, the view's height, in radians.
    Camera {
        referential: u32,
        position: [f64; 3],
        pitch: f32,
        yaw: f32,
        roll: f32,
        fov: f64,
    },
    /// Lacks the SimObject titled `title`, so a create naming it fails.
    Lack { title: String },
    /// Hands up `count` `Frame` events at once on each connection subscribed to them.
    FrameBurst { count: u32 },
    /// Resets the sim's variables, as an aircraft change does
    /// (record/areas/core/03-sim-seam-and-wasm-module.md, "Wants and the sim's APIs").
    ResetVars,
    /// Sets the aircraft's input events, each with its value, which the sim lists.
    Inputs { events: Vec<(String, f64)> },
    /// Moves an input event and reports it to each connection subscribed to it.
    SetInput { name: String, value: f64 },
    /// The aircraft or its pilot fires a `K:` event, which each listening connection hears.
    SendEvent { name: String, data: u32 },
    /// Scripts the aircraft's own behavior from now on.
    Rule {
        when: RuleWhen,
        after_ms: u64,
        then: RuleThen,
    },
    /// Hands up the next report of the routine `routine`, such as `LEAD`, this long after our
    /// module made it.
    LateReport { routine: String, delay_ms: u64 },
    /// Sends a `FromCore::Track` line with the aircraft's variables `names` after each frame
    /// from now on, or stops with no names.
    Track { names: Vec<String> },
    /// Puts each of the sim's own AI objects in the sim, or sets more of its variables, as an
    /// ATC app's traffic, each moving by its velocities from then on.
    Ai { objects: Vec<AiObject> },
    /// Takes the AI objects `ids` out of the sim.
    AiGone { ids: Vec<u32> },
    /// Holds back the last answer of each of the next `count` by-type requests, so none is
    /// whole.
    HoldPolls { count: u32 },
    /// Answers with a `FromCore::StandIn` line.
    Report,
}

/// One of the sim's own AI objects, by an ID the scenario gives it, with its variables, such as
/// `A:PLANE LATITUDE` and `A:TITLE`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bench/")]
pub struct AiObject {
    pub id: u32,
    pub kind: AiKind,
    pub numbers: Vec<(String, f64)>,
    pub texts: Vec<(String, String)>,
}

/// Which `SIMCONNECT_SIMOBJECT_TYPE` an AI object is, which a poll of that kind finds.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum AiKind {
    Aircraft,
    Helicopter,
    Ground,
}

/// What sets off a rule of the stand-in's aircraft.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "when", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum RuleWhen {
    /// A connection wrote this variable.
    Written {
        name: String,
    },
    /// Someone sent this `K:` event.
    Sent {
        name: String,
    },
    /// Our WASM module fired this `H:` event.
    Fired {
        name: String,
    },
    Every {
        ms: u64,
    },
}

/// What a rule of the stand-in's aircraft does. A value left out takes the value that set the
/// rule off.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "then", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum RuleThen {
    Set { name: String, value: Option<f64> },
    Flip { name: String },
    SetInput { name: String, value: Option<f64> },
    Fire { name: String },
    Send { name: String, data: Option<u32> },
}

/// One of the sim's signals the stand-in plays.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bench/")]
pub struct Played {
    pub after_ms: u64,
    pub signal: Signal,
}

/// A signal of the sim's around a flight load.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "signal", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum Signal {
    AircraftLoaded {
        path: String,
    },
    FlightLoaded {
        path: String,
    },
    /// A flow event, by SimConnect's number for it, as p08's client recorded them.
    Flow {
        event: i32,
    },
    Pause {
        flags: u32,
    },
}

/// A call of the sim the test unit makes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "call", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum SimCall {
    /// Watches numbers, each named with its unit, such as `["A:IS ALTITUDE FREEZE ON",
    /// "bool"]`, on change or once. The unit numbers its watches from 0 as it makes them.
    Watch {
        vars: Vec<(String, String)>,
        once: bool,
    },
    /// Writes values into the variables of the watch the unit made `watch`th.
    Write {
        watch: u32,
        values: Vec<f64>,
    },
    Key {
        event: String,
        value: u32,
    },
    /// Feeds the routine `routine`: `HOLD`, or the bench's `PROBE` with its mode.
    Feed {
        routine: String,
        mode: u32,
    },
    End {
        routine: String,
    },
    /// Creates an object of the SimObject titled `title`, at no place in particular.
    Create {
        title: String,
    },
    /// Subscribes to the sim's `Frame` event.
    Frames,
}

/// An object a connection created, as the stand-in holds it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bench/")]
pub struct Made {
    pub id: u32,
    pub title: String,
    /// The place of the unit whose connection created it.
    pub unit: u32,
    /// Its variables, each with its value as text, a `Z:` one under its prefix.
    pub variables: Vec<(String, String)>,
}

/// One figure as the core fed it to `Figure`, read from the slot the module takes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bench/")]
pub struct FedFigure {
    pub object: u32,
    pub color: u32,
    pub shows: u32,
    pub slumps: bool,
    /// The seat's hip, which names the seat, all 0 in no seat.
    pub hip: [f32; 3],
    pub body: FedBody,
    /// The left hand, then the right.
    pub hands: [FedHand; 2],
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "body", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum FedBody {
    Seated {
        eye: [f32; 3],
        look: [f32; 3],
    },
    Head {
        eye: [f32; 3],
        look: [f32; 3],
    },
    OnFoot {
        at: [f32; 3],
        heading: f32,
        crouch: bool,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "hand", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum FedHand {
    Rest,
    /// On the yoke on this side of the centerline, 0 for the left.
    Grip {
        side: u32,
    },
    Thumb {
        point: [f32; 3],
    },
    Point {
        point: [f32; 3],
    },
}

/// A line from the core besides its first.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum FromCore {
    /// Something the sim's test unit heard or saw, as one line of text, such as `stage
    /// loading`.
    Heard { what: String },
    /// `Figure`'s slot changed: each figure and how many yokes it carries, at `at`, the core's
    /// stamp on the feed in µs on its counter, so a scenario times the hands by the core's own
    /// clock. The sim service writes an unchanged slot again every 200ms, which sends no line.
    Fed {
        at: u64,
        yokes: u32,
        figures: Vec<FedFigure>,
    },
    /// A CommBus call the core made for JavaScript, which the stand-in hands to the sim's
    /// pages, so the bench's fake pages hear the core's announcement.
    CommBus { name: String, data: String },
    /// An `H:` event reached the sim's pages, as an instrument receives it, with no `H:`.
    HEvent { name: String },
    /// The aircraft's variables `StandInAct::Track` named, after one of the stand-in's
    /// frames, at `at`, in µs of the PC's own time since 1970.
    Track { at: u64, values: Vec<f64> },
    /// What the stand-in was called for, and what its aircraft holds.
    StandIn {
        /// Each connection opened while the sim took connections, as its unit's place and
        /// that unit's count of opens.
        opens: Vec<(u32, u32)>,
        calls: Vec<Called>,
        variables: Vec<(String, String)>,
        inputs: Vec<(String, f64)>,
        objects: Vec<Made>,
        module_stopped: bool,
    },
}

/// One call the core made of the stand-in.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bench/")]
pub struct Called {
    pub unit: u32,
    pub open: u32,
    /// The SimConnect function, such as `SetNotificationGroupPriority`.
    pub function: String,
    /// The call's arguments, as Rust prints them.
    pub arguments: String,
    pub before_open_reply: bool,
}

/// What the network's test unit does. It stands in for a feature with a channel of each
/// delivery, whose probes carry their send stamp so the receiver measures how late each came.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "act", rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum NetAct {
    /// Sends `count` probes of `bytes` bytes each on the channel of `delivery`, one every
    /// `every_ms`, to every member whose link is up.
    Send {
        delivery: Delivery,
        count: u32,
        every_ms: u32,
        bytes: u32,
    },
    /// Tells the bench what came on each channel since the last report, and its clock offset
    /// from each member, as a `net report` line.
    Report,
    /// Holds every message that comes on the channel numbered `channel` for `ms`, then
    /// delivers them in their order, as loss on a direct path can hold one channel behind
    /// another.
    Hold { channel: u16, ms: u32 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "bench/")]
pub enum Delivery {
    Stream,
    Newest,
    Deadline,
}

/// The network's test unit's channels, one of each delivery.
pub const STREAM: crate::net::Channel<Probe> =
    crate::net::Channel::new(1001, crate::net::Delivery::Stream, 100);
pub const NEWEST: crate::net::Channel<Probe> =
    crate::net::Channel::new(1002, crate::net::Delivery::Newest, 200);
pub const DEADLINE: crate::net::Channel<Probe> =
    crate::net::Channel::new(1003, crate::net::Delivery::Deadline, 150);

/// One probe: its number, its send stamp in µs on the sender's counter, which two cores on
/// one PC share, and bytes that make it the size a scenario asks.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Probe {
    pub n: u32,
    pub sent: u64,
    /// For a deadline channel's probe, when its turn passes, in µs on the counter.
    pub deadline: Option<u64>,
    pub pad: Vec<u8>,
}
impl crate::net::OneOff for Probe {
    fn wait(&self) -> crate::net::Wait {
        match self.deadline {
            Some(at) => crate::net::Wait::Deadline { at },
            None => crate::net::Wait::Newest { key: 0 },
        }
    }
}
