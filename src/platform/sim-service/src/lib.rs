//! The sim service, the platform's crate for the sim: it opens and closes every SimConnect
//! connection, makes the calls features ask for on each feature's own connection, routes
//! what comes back to the call that caused it, keeps our WASM module's status, and raises
//! `SimChanged` as sim awareness follows the sim
//! (record/areas/core/03-sim-seam-and-wasm-module.md, "The sim service").
//!
//! Everything the sim's side of the seam hands up arrives as an input under `sim_client::Seam`
//! and is parsed here, on the loop, so a replay runs the same path as the sim did.
//!
//! The service registers two units: sim awareness, whose state features read through
//! `cx.read::<SimAwareness>()`, and the service itself. Register it after the clients crate,
//! whose port it announces and to which it adds its slice, and before every feature that
//! calls the sim, since a feature's `on_sim` registers with the service.

mod aircraft;
mod announce;
mod awareness;
mod calls;
mod connections;
mod menu;
mod module;
mod seam;

pub use aircraft::{
    AircraftChanged, PackageFound, USER_CFG, aircraft_awareness, find_package, package_roots,
    package_version, packages_folder, user_cfgs,
};
pub use announce::announce;
pub use calls::{ModuleCalls, Sim, SimCx, SimUnit};
pub use connections::profile_unloaded;
pub use module::{Status, hold};
pub use sim_awareness::SimAwareness;
pub use sim_client::message::Camera;
pub use sim_client::{InitPosition, Period, Value, Var};

use std::collections::BTreeMap;
use std::time::Duration;

use clients::ClientsUnit;
use kernel::{Cx, Handle, Handler, Moment, Registry, Started, TimerId};
use sim_client::Seam;

use crate::connections::Holder;
use crate::module::ModuleWatch;

/// How often the service looks for the sim's process while it holds none, and opens the
/// platform's connection while it's closed, as FS Copilot tried again every 2s
/// (record/learn/foundations/04-03-client-data-ai-and-throughput.md, "Throughput, threading,
/// and reconnects").
const RETRY: Duration = Duration::from_secs(2);

/// The service raises this once for each step that changes sim awareness's state, so a
/// flight load is one entry into Loading however many signals it brings. It carries the
/// state before; the state after is `cx.read::<SimAwareness>()`.
pub struct SimChanged {
    pub before: SimAwareness,
}

impl Moment for SimChanged {}

/// What reaches a unit's `on_sim` handler from the sim.
#[derive(Clone, Debug, PartialEq)]
pub enum SimEvent {
    /// A watch's values, each with its place in the watch's variables.
    Values {
        watch: Handle,
        values: Vec<(usize, Value)>,
    },
    /// One object a `poll` found, with its values, each with its place in the poll's
    /// variables, and its number among the poll's objects, from 1 to `out_of`. A poll that
    /// found nothing answers once, with `out_of` 0 and no values.
    Polled {
        call: Handle,
        object: u32,
        values: Vec<(usize, Value)>,
        entry: u32,
        out_of: u32,
    },
    /// The sim refused a call after it returned. `call` is the call's handle when the edge
    /// still held its packet ID, and `index` the argument at fault, such as a watch's
    /// variable.
    Exception {
        call: Option<Handle>,
        exception: u32,
        index: u32,
    },
    /// A call the service couldn't make, because the sim is closed or the unit's connection
    /// didn't open.
    Failed { call: Handle },
    /// The object a `create_ai` made, by the ID a `watch_on`, a `key_on`, a `remove`, and a
    /// routine's write name it by.
    Created { call: Handle, object: u32 },
    /// The camera this frame, which a `cameras` call subscribed to, in `SIMOBJECT`'s
    /// referential and in `WORLD`'s, read in our WASM module before any routine moved the
    /// aircraft.
    Camera {
        call: Handle,
        simobject: Camera,
        world: Camera,
    },
    /// The sim drew a frame, which a `frames` call subscribed to: its frame rate in frames
    /// a second, and the sim's rate, 1 at normal speed.
    Frame { call: Handle, rate: f32, speed: f32 },
    /// An event a `listen` call hears, with the values it carried, each as SimConnect gives it.
    Heard { call: Handle, data: [u32; 5] },
    /// The value of the input event an `input` call reads: its value at the call when `first`,
    /// and each change after it.
    Input {
        call: Handle,
        value: Value,
        first: bool,
    },
    /// One report of a routine, which a `cx.module().reports` call asked for: the bytes of
    /// the routine's `Report`, as our WASM module wrote them into its report slot.
    Report { call: Handle, bytes: Vec<u8> },
    /// The unit's connection was lost, and what it set up or created in the sim with it.
    Lost,
    /// The menu script's answer to a `world_map` call.
    WorldMap {
        call: Handle,
        outcome: messages::sim::WorldMapOutcome,
    },
}

/// The sim service's state.
#[derive(Default)]
pub struct SimService {
    /// The service's own unit, which numbers the platform's connection.
    me: Option<kernel::UnitId>,
    /// The sim's process, from found until it exits.
    process: Option<u32>,
    /// Whether the quit message came in this run of the sim, after which the service opens
    /// nothing until the process exits and another is found.
    quit: bool,
    /// Each unit's connection, by the unit's place.
    holders: BTreeMap<u32, Holder>,
    /// Each unit's `on_sim` handler, by the unit's place.
    hooks: BTreeMap<u32, Handler<SimEvent>>,
    /// The platform's own uses of its connection.
    platform: connections::Platform,
    module: ModuleWatch,
    announcing: announce::Announcing,
    aware: aircraft::Awareness,
    menu: menu::Menu,
}

impl SimService {
    /// Our WASM module's status, as the platform's connection last read it.
    pub fn module_status(&self) -> Status {
        self.module.status
    }

    /// Whether any feature's routine is fed, which `Status::Stopped` waits on.
    pub fn routine_live(&self) -> bool {
        self.module.live()
    }
}

/// Registers sim awareness and the sim service.
pub fn register(r: &mut Registry) {
    r.unit::<SimAwareness>("sim-awareness");
    let mut me = r.unit::<SimService>("sim-service");
    let id = me.id();
    me.on::<Started>(SimService::started)
        .on::<SimChanged>(SimService::sim_changed)
        .on::<clients::ClientJoined>(SimService::client_joined)
        .on::<clients::ClientLeft>(SimService::client_left)
        .client_messages(messages::sim::MENU_UNIT, SimService::menu_said)
        .client_state(messages::sim::SLICE, SimService::slice);
    aircraft::setting(&mut me);
    me.source::<Seam>(SimService::seam);
    r.state_mut::<SimService>().me = Some(id);
}

impl SimService {
    fn started(me: &mut SimService, _: &Started, cx: &mut Cx) {
        me.retry(cx);
        cx.timer(module::REWRITE, SimService::rewrite);
    }

    /// Every 2s: looks for the sim's process while it holds none, and opens the platform's
    /// connection while the process runs and the connection is closed.
    fn tick(me: &mut SimService, _: TimerId, cx: &mut Cx) {
        me.retry(cx);
    }

    fn retry(&mut self, cx: &mut Cx) {
        if self.process.is_none() {
            cx.out(sim_client::SimCall::FindProcess);
        } else if !self.quit && !self.is_open(self.me()) {
            self.open(self.me(), cx);
        }
        cx.timer(RETRY, SimService::tick);
    }
}
