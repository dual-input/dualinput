//! The platform's connection's own uses for sim awareness: the system events and flow events
//! it subscribes to, the state it asks for, and the flight file it reads, each turned into a
//! signal for the sim awareness engine (record/areas/core/03-sim-seam-and-wasm-module.md,
//! "What the platform's connection holds").

use clients::{ClientJoined, Sender, To};
use kernel::{Cx, Job, JobId};
use messages::clients::component;
use messages::sim::{MENU_UNIT, MenuPage, MenuReport};
use sim_awareness::{Departure, Flow, Process, Signal, SimAwareness};
use simconnect_types::SIMCONNECT_GROUP_PRIORITY_HIGHEST_MASKABLE;

use crate::connections::Origin;
use crate::{SimChanged, SimService};

/// A signal for sim awareness, owned, so the service can hand it to the sim awareness unit
/// as a call, which runs once the service's handler has returned.
pub(crate) enum Step {
    Process(Process),
    Quit,
    AircraftLoaded(String),
    AircraftState(String),
    FlightLoaded,
    Flow(Flow),
    Pause(u32),
    Page(MenuPage),
    Departure(Departure),
}

impl Step {
    pub(crate) fn signal(cx: &Cx, step: Step) {
        cx.call(Step::take, step);
    }

    /// Runs as the sim awareness unit: steps its state, and raises `SimChanged` when the
    /// step changed it.
    fn take(awareness: &mut SimAwareness, step: Step, cx: &mut Cx) {
        let before = awareness.clone();
        let signal = match &step {
            Step::Process(process) => Signal::Process(*process),
            Step::Quit => Signal::Quit,
            Step::AircraftLoaded(path) => Signal::AircraftLoaded(path),
            Step::AircraftState(path) => Signal::AircraftState(path),
            Step::FlightLoaded => Signal::FlightLoaded,
            Step::Flow(flow) => Signal::Flow(*flow),
            Step::Pause(flags) => Signal::Pause(*flags),
            Step::Page(page) => Signal::Page(*page),
            Step::Departure(departure) => Signal::Departure(departure.clone()),
        };
        if awareness.step(signal) {
            if awareness.stage != before.stage {
                tracing::info!(
                    stage = ?awareness.stage,
                    aircraft = awareness.aircraft.as_ref().map(|a| a.path.as_str()),
                    "the sim's stage changed"
                );
            }
            cx.raise(SimChanged { before });
        }
    }
}

impl SimService {
    /// The platform's connection opened. The first time, it takes the masking group and
    /// subscribes; on a later connection the sim client made the same setup again. Either
    /// way it asks for the loaded aircraft, since a system event reports only what happens
    /// after the subscription (record/learn/foundations/04-02-events.md, "System events and
    /// state").
    pub(crate) fn platform_opened(&mut self, cx: &Cx) {
        let me = Origin {
            unit: self.me(),
            handle: None,
        };
        let first = !self.platform.set_up;
        let Some(client) = self.client(me, cx) else {
            return;
        };
        let mut ops = Vec::new();
        if first {
            // The masking group, which takes its priority as the sim starts, so a later
            // feature that masks sits ahead of an aircraft's own module, held open by
            // K:SIM_RATE_INCR, which it listens to and doesn't mask
            // (record/areas/architecture/01-spine.md, "The core").
            let (_, group) = client.group(
                &me,
                SIMCONNECT_GROUP_PRIORITY_HIGHEST_MASKABLE,
                &["K:SIM_RATE_INCR"],
            );
            ops.extend(group);
            let mut subscribe = |name: &str, ops: &mut Vec<_>| {
                let (event, op) = client.system_event(&me, name);
                ops.push(op);
                event
            };
            let aircraft_loaded = subscribe("AircraftLoaded", &mut ops);
            let flight_loaded = subscribe("FlightLoaded", &mut ops);
            let pause = subscribe("Pause_EX1", &mut ops);
            ops.push(client.flow_events(&me));
            let (status, mut read) = client.area(&me, messages::module::STATUS, STATUS_SIZE);
            let (request, op) = client.read_area(&me, status);
            read.push(op);
            ops.extend(read);
            self.platform.aircraft_loaded = aircraft_loaded;
            self.platform.flight_loaded = flight_loaded;
            self.platform.pause = pause;
            self.platform.status = request;
            self.platform.set_up = true;
        }
        let Some(client) = self
            .holders
            .get_mut(&me.unit.place())
            .map(|h| &mut h.client)
        else {
            return;
        };
        let (request, op) = client.system_state("AircraftLoaded");
        ops.push(op);
        self.platform.aircraft_state = Some(request);
        self.make(me, ops, cx);
    }

    /// Reads the flight file `FlightLoaded` named, for its `[Departure]` section, which Go to
    /// reads (record/areas/session/02-units.md, "Go to").
    pub(crate) fn read_flight_file(&self, file: String, cx: &Cx) {
        cx.job(Job::read(file), SimService::flight_file);
    }

    fn flight_file(_: &mut SimService, _: JobId, read: Result<Vec<u8>, String>, cx: &mut Cx) {
        match read {
            Ok(bytes) => match Departure::from_flight_file(&String::from_utf8_lossy(&bytes)) {
                Some(departure) => Step::signal(cx, Step::Departure(departure)),
                None => tracing::info!("the loaded flight file has no [Departure] section"),
            },
            Err(error) => tracing::warn!(%error, "the loaded flight file couldn't be read"),
        }
    }

    /// Each load that reaches Ready to fly or Flying: the aircraft's facts start again, with
    /// its title read once to log beside the aircraft's path, since the path, not the title,
    /// names the preset (record/areas/core/03-sim-seam-and-wasm-module.md, "The aircraft").
    pub(crate) fn sim_changed(me: &mut SimService, changed: &SimChanged, cx: &mut Cx) {
        let in_flight = |stage| {
            matches!(
                stage,
                messages::sim::Stage::ReadyToFly | messages::sim::Stage::Flying
            )
        };
        if in_flight(cx.read::<SimAwareness>().stage) && !in_flight(changed.before.stage) {
            me.aircraft_loaded(cx);
        }
        me.check_stall(cx);
    }
}

impl SimService {
    /// The menu script's socket joined: the service asks it for its master page, which ends
    /// Starting for a core that found the sim already running, since no SimConnect signal
    /// tells the main menu from a flight then (record/areas/core/03-sim-seam-and-wasm-module.md,
    /// "Leaving Starting").
    pub(crate) fn client_joined(_: &mut SimService, joined: &ClientJoined, cx: &mut Cx) {
        if joined.component == component::MENU_SCRIPT {
            clients::send(
                cx,
                To::Component(component::MENU_SCRIPT.into()),
                MENU_UNIT,
                &serde_json::json!({}),
            );
        }
    }

    pub(crate) fn menu_report(_: &mut SimService, _: Sender, report: MenuReport, cx: &mut Cx) {
        tracing::info!(master = ?report.master, "the menu script reported its master page");
        Step::signal(cx, Step::Page(report.master));
    }
}

/// The status slot's size, which never changes.
const STATUS_SIZE: u32 = size_of::<messages::module::ModuleStatus>() as u32;
