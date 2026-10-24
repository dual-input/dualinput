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
mod module;
mod seam;

pub use aircraft::{AircraftChanged, USER_CFG, aircraft_awareness};
pub use announce::announce;
pub use calls::{ModuleCalls, Sim, SimCx, SimUnit};
pub use module::{Status, hold};
pub use sim_awareness::SimAwareness;
pub use sim_client::{Period, Value, Var};

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
    /// The unit's connection was lost, and what it set up or created in the sim with it.
    Lost,
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
        .client_messages(messages::sim::MENU_UNIT, SimService::menu_report)
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
