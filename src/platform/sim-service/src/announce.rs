//! The core's announcement, and what the sim service shows the apps: every 2s from the
//! platform's connection opening, and at once when the session crate calls `announce`, a
//! CommBus call for JavaScript with the clients crate's port and whether a session runs, so
//! every page in the sim finds the core (record/areas/core/03-sim-seam-and-wasm-module.md,
//! "The announcement"); the slice of client state `sim`; and the module's trouble notices.

use std::time::Duration;

use clients::{Clients, Level};
use kernel::{Cx, TimerId, View};
use messages::clients::{ANNOUNCE, Announce};
use messages::sim::SimSlice;
use sim_awareness::SimAwareness;
use sim_client::Op;
use simconnect_types::SIMCONNECT_COMM_BUS_BROADCAST_TO_JS;

use crate::SimService;
use crate::connections::Origin;
use crate::module::Status;

/// How often the core announces itself while the sim takes its calls. A page that loaded
/// before the core hears the next one, so no page asks (record/areas/architecture/01-spine.md,
/// "Finding the core").
const EVERY: Duration = Duration::from_secs(2);

/// The one trouble notice for our package, which the check of our package on disk raises
/// too, and the module's own for a module that stopped (record/areas/interface/01-apps.md,
/// "Trouble").
const PACKAGE_NOTICE: &str = "package";
const STOPPED_NOTICE: &str = "module-stopped";

/// The session crate calls this as a session starts or ends, and the core announces it at
/// once, on the same input, since a cockpit panel connects only to an announcement that
/// says a session runs.
pub fn announce(cx: &Cx, session: bool) {
    cx.call(SimService::announce_session, session);
}

#[derive(Default)]
pub(crate) struct Announcing {
    session: bool,
    timer: Option<TimerId>,
    /// Which of the module's trouble notices are raised.
    package: bool,
    stopped: bool,
}

impl SimService {
    /// The platform's connection opened: the announcements start, the first at once.
    pub(crate) fn start_announcing(&mut self, cx: &Cx) {
        self.announce_now(cx);
        if self.announcing.timer.is_none() {
            self.announcing.timer = Some(cx.timer(EVERY, SimService::announce_tick));
        }
    }

    fn announce_tick(me: &mut SimService, _: TimerId, cx: &mut Cx) {
        me.announcing.timer = None;
        if !me.is_ready(me.me()) {
            return;
        }
        me.announce_now(cx);
        me.announcing.timer = Some(cx.timer(EVERY, SimService::announce_tick));
    }

    fn announce_session(me: &mut SimService, session: bool, cx: &mut Cx) {
        if me.announcing.session != session {
            tracing::info!(
                session,
                "the core announces that a session {}",
                if session { "started" } else { "ended" }
            );
        }
        me.announcing.session = session;
        me.announce_now(cx);
    }

    /// One announcement, on the platform's connection while it's open.
    fn announce_now(&mut self, cx: &Cx) {
        let Some(port) = cx.read::<Clients>().port() else {
            tracing::debug!("the core has no port to announce yet");
            return;
        };
        if !self.is_ready(self.me()) {
            return;
        }
        let body = Announce {
            port,
            session: self.announcing.session,
        };
        let origin = Origin {
            unit: self.me(),
            handle: None,
        };
        let data = serde_json::to_string(&body).unwrap_or_default();
        let op = Op::CallCommBusEvent {
            name: ANNOUNCE.into(),
            broadcast: SIMCONNECT_COMM_BUS_BROADCAST_TO_JS,
            data,
        };
        self.make(origin, vec![op], cx);
    }

    /// The slice `sim`, which the apps show.
    pub(crate) fn slice(me: &SimService, view: &View) -> SimSlice {
        let awareness = view.read::<SimAwareness>();
        SimSlice {
            stage: awareness.stage,
            page: awareness.page,
            aircraft: awareness.aircraft.clone(),
            pause: awareness.pause,
            ended: awareness.ended,
            module: me.module.status,
        }
    }

    /// While any routine is fed, a module that's missing or from another build raises the one
    /// trouble notice for our package, and a module that stopped raises its own; each clears
    /// once the module runs or no routine is fed (user, 2026-10-18).
    pub(crate) fn module_notices(&mut self, cx: &Cx) {
        let live = self.module.live();
        let status = self.module.status;
        let package = live && matches!(status, Status::Missing | Status::Differs);
        let stopped = live && status == Status::Stopped;
        if package != self.announcing.package {
            self.announcing.package = package;
            if package {
                clients::notice(
                    cx,
                    PACKAGE_NOTICE,
                    Level::Trouble,
                    "Dual Input's package in the sim is missing or from another version, so it can't hold or fly the aircraft. Install Dual Input again with the sim closed.",
                    None,
                );
            } else {
                clients::clear_notice(cx, PACKAGE_NOTICE);
            }
        }
        if stopped != self.announcing.stopped {
            self.announcing.stopped = stopped;
            if stopped {
                clients::notice(
                    cx,
                    STOPPED_NOTICE,
                    Level::Trouble,
                    "Dual Input's module in the sim stopped, so it can't fly or hold the aircraft. A frozen aircraft stays frozen until you take control or leave the session. Restart the sim to bring the module back.",
                    None,
                );
            } else {
                clients::clear_notice(cx, STOPPED_NOTICE);
            }
        }
    }
}
