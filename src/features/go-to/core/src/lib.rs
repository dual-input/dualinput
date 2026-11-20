//! Go to, which the EFB app labels Join: the pilot flying's core writes where they are, and a
//! pilot out of the flight, at Free flight's world map, has the menu script set the world map to
//! the pilot flying's airport, their stand or a runway, their aircraft, and their livery, and with
//! Join now also start the flight and press Ready to fly (record/areas/session/02-units.md, "Go
//! to"; record/areas/interface/decisions.md, "Join takes a joiner from the world map into the PF's
//! flight, or only sets it up"). Dual Input then moves the joiner's aircraft to the pilot flying's,
//! as flight-model sync does for every joiner.

mod join;

use clients::{ClientJoined, ClientLeft, ClientsUnit};
use kernel::{Cx, Handle, Registry, View};
use messages::go_to::{GoToSlice, JOIN, JoinState, NAME, SPOT, Said, Spot, Stand, Unavailable};
use messages::session::STATUS;
use messages::sim::{MenuPage, Stage, WorldMapOutcome, WorldMapRequest};
use session::{
    ControlPassed, FlightChanged, KeyChanged, Session, SessionEnded, SessionUnit, WriteKeys,
};
use sim_service::{
    AircraftChanged, Period, SimAwareness, SimChanged, SimCx, SimEvent, SimService, SimUnit, Value,
    Var,
};

/// How many engines' `A:GENERAL ENG COMBUSTION` the feature reads, as traffic reads four engines'
/// variables. An aircraft with more has only its first four read.
const ENGINES: usize = 4;

/// Go to's state.
#[derive(Default)]
pub struct GoTo {
    /// The watch of `A:NUMBER OF ENGINES` and each engine's `A:GENERAL ENG COMBUSTION`, from this
    /// sim's first flight in the run.
    engines_watch: Option<Handle>,
    /// The watch's values by their place, since it hands up only the ones that changed.
    engine_values: [f64; ENGINES + 1],
    /// The aircraft list's answer for the pilot flying's aircraft at the world map: whether the
    /// list has it, once the menu script answers.
    found: Option<(Wanted, Option<bool>)>,
    /// The ask of the aircraft list on its way, with the aircraft it asks about.
    finding: Option<(Handle, Wanted)>,
    run: Option<join::Run>,
    said: Option<Said>,
}

/// The pilot flying's aircraft, as the world map's aircraft list is asked for it: its folder under
/// `SimObjects\Airplanes\`, and its `A:TITLE`, which names it in Join's words.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Wanted {
    folder: String,
    title: String,
}

/// Registers Go to. Register it after the session crate and the sim service.
pub fn register(r: &mut Registry) {
    let mut me = r.unit::<GoTo>(NAME);
    me.session_key(SPOT)
        .on_sim(GoTo::on_sim)
        .command(JOIN, join::start)
        .client_state(NAME, GoTo::slice);
    me.on::<SimChanged>(GoTo::sim_changed)
        .on::<KeyChanged>(|me, _: &KeyChanged, cx| me.changed(cx))
        .on::<FlightChanged>(|me, _: &FlightChanged, cx| me.changed(cx))
        .on::<ControlPassed>(|me, _: &ControlPassed, cx| me.changed(cx))
        .on::<AircraftChanged>(|me, _: &AircraftChanged, cx| me.changed(cx))
        .on::<ClientJoined>(|me, _: &ClientJoined, cx| me.changed(cx))
        .on::<ClientLeft>(|me, _: &ClientLeft, cx| me.changed(cx))
        .on::<SessionEnded>(|me, _: &SessionEnded, cx| {
            me.stop(cx);
            me.found = None;
            me.said = None;
        });
}

impl GoTo {
    fn sim_changed(me: &mut GoTo, changed: &SimChanged, cx: &mut Cx) {
        let stage = cx.read::<SimAwareness>().stage;
        if stage.in_a_flight() && !changed.before.stage.in_a_flight() && me.engines_watch.is_none()
        {
            let mut vars = vec![Var::number("A:NUMBER OF ENGINES", "number")];
            vars.extend(
                (1..=ENGINES)
                    .map(|n| Var::number(&format!("A:GENERAL ENG COMBUSTION:{n}"), "bool")),
            );
            me.engines_watch = Some(cx.sim().watch(&vars, Period::OnChange));
        }
        if stage != changed.before.stage {
            join::stage_changed(me, stage, cx);
        }
        me.changed(cx);
    }

    /// Whatever the spot, Join's state, or the aircraft check turns on may have changed.
    fn changed(&mut self, cx: &Cx) {
        self.write_spot(cx);
        self.check_aircraft(cx);
    }

    /// Whether any engine runs, from the watch's values.
    fn engines(&self) -> bool {
        let count = self.engine_values[0] as usize;
        self.engine_values[1..=count.min(ENGINES)]
            .iter()
            .any(|&combustion| combustion != 0.0)
    }

    /// Where this pilot is, while they're in a flight.
    fn spot(&self, cx: &Cx) -> Spot {
        let departure = cx.read::<SimAwareness>().departure.as_ref();
        Spot {
            airport: departure.map(|d| d.airport.clone()),
            stand: departure
                .filter(|d| !d.stand_name.is_empty())
                .map(|d| Stand {
                    name: d.stand_name.clone(),
                    number: d.stand_number,
                }),
            engines: self.engines(),
            livery: cx
                .read::<SimService>()
                .aircraft_facts()
                .and_then(|facts| facts.livery.clone())
                // The Baron 58P read no `A:LIVERY NAME`, and its livery is in its title
                // (measured on MSFS 2024, 2026-11-17, record/areas/session/log.md, "In the sim,
                // Join set the world map and started the flight within 0.9s, and active pause
                // followed from our EFB app's code in 264ms, once the menu script parsed").
                .filter(|livery| !livery.is_empty()),
        }
    }

    /// The pilot flying's core writes their spot while they're in the flight, and clears it when
    /// they leave it.
    fn write_spot(&self, cx: &Cx) {
        let session = cx.read::<Session>();
        let Some(me) = session.me().filter(|me| session.pf() == Some(*me)) else {
            return;
        };
        let spot = session.in_flight(&me).then(|| self.spot(cx));
        if session.key(SPOT).flatten() != spot {
            cx.ask(WriteKeys::one(SPOT, &spot));
        }
    }

    /// The pilot flying's aircraft, while this pilot is at the world map with the menu script
    /// there to look it up, once its name has arrived, so Join never names an aircraft it can't.
    fn wanted(cx: &Cx) -> Option<Wanted> {
        let sim = cx.read::<SimAwareness>();
        if sim.stage != Stage::Menu
            || sim.page != MenuPage::WorldMap
            || !cx.read::<SimService>().menu_script()
        {
            return None;
        }
        let session = cx.read::<Session>();
        let pf = session.pf().filter(|pf| session.me() != Some(*pf))?;
        let aircraft = session.preflight().aircraft?;
        Some(Wanted {
            folder: aircraft.folder().to_string(),
            title: session.member_key(STATUS, &pf).and_then(|s| s.title)?,
        })
    }

    /// Asks the aircraft list whether this pilot has the pilot flying's aircraft, once for each
    /// visit to the world map and each aircraft, since Join is unavailable without it.
    fn check_aircraft(&mut self, cx: &Cx) {
        let Some(wanted) = GoTo::wanted(cx) else {
            self.found = None;
            return;
        };
        // The run asks the menu script for the aircraft itself, and a request of the check's in
        // between would break Join's one request at a time.
        let asked = self.found.as_ref().is_some_and(|(w, _)| *w == wanted);
        if asked || self.finding.is_some() || self.run.is_some() {
            return;
        }
        let request = WorldMapRequest::FindAircraft {
            folder: wanted.folder.clone(),
            title: Some(wanted.title.clone()),
        };
        self.found = Some((wanted.clone(), None));
        self.finding = Some((cx.sim().world_map(request), wanted));
    }

    fn on_sim(me: &mut GoTo, event: SimEvent, cx: &mut Cx) {
        match event {
            SimEvent::Values { watch, values } if Some(watch) == me.engines_watch => {
                for (place, value) in values {
                    if let (Some(slot), Value::Number(n)) = (me.engine_values.get_mut(place), value)
                    {
                        *slot = n;
                    }
                }
                me.write_spot(cx);
            }
            SimEvent::WorldMap { call, outcome } => {
                if me.finding.as_ref().is_some_and(|(c, _)| *c == call) {
                    let has = match outcome {
                        WorldMapOutcome::Done => Some(true),
                        WorldMapOutcome::NoMatch => Some(false),
                        WorldMapOutcome::Failed { .. } => None,
                    };
                    me.found_answer(has, cx);
                } else {
                    join::answered(me, call, outcome, cx);
                }
            }
            SimEvent::Failed { call } => {
                if me.finding.as_ref().is_some_and(|(c, _)| *c == call) {
                    me.found_answer(None, cx);
                } else if Some(call) == me.engines_watch {
                    me.engines_watch = None;
                } else {
                    join::answered(
                        me,
                        call,
                        WorldMapOutcome::Failed {
                            why: "no menu script answered".into(),
                        },
                        cx,
                    );
                }
            }
            SimEvent::Lost => {
                me.engines_watch = None;
                me.engine_values = Default::default();
            }
            _ => {}
        }
    }

    /// The aircraft list's answer, or `None` when the menu script couldn't give one, which
    /// leaves Join available, so the run itself says which step failed.
    fn found_answer(&mut self, has: Option<bool>, cx: &Cx) {
        let Some((_, wanted)) = self.finding.take() else {
            return;
        };
        tracing::info!(
            folder = wanted.folder,
            title = wanted.title,
            ?has,
            "the world map's aircraft list was asked for the pilot flying's aircraft"
        );
        self.found = Some((wanted, has));
        self.check_aircraft(cx);
    }

    /// Whether Join shows on the pilot flying's row, and whether it can run. Each reason is
    /// checked once the ones before it hold, since whether this pilot has the aircraft needs the
    /// menu script at the world map, and only one reason shows.
    pub(crate) fn join_state(
        &self,
        session: &Session,
        sim: &SimAwareness,
        service: &SimService,
    ) -> JoinState {
        let (Some(me), Some(pf)) = (session.me(), session.pf()) else {
            return JoinState::Hidden;
        };
        if pf == me || session.in_flight(&me) {
            return JoinState::Hidden;
        }
        if self.run.is_some() {
            return JoinState::Running;
        }
        let unavailable = |why| JoinState::Unavailable { why };
        // The EFB opens at the world map and in a flight, so anywhere else no one sees Join
        // (record/areas/interface/decisions.md, "Dual Input's one full window is its EFB app").
        let in_a_flight = sim.stage.in_a_flight();
        if !in_a_flight && sim.stage != Stage::Menu {
            return JoinState::Hidden;
        }
        let Some(spot) = session.key(SPOT).flatten() else {
            return unavailable(Unavailable::NoFlight);
        };
        if in_a_flight {
            return unavailable(Unavailable::OtherAircraft);
        }
        if !service.menu_script() {
            return unavailable(Unavailable::NoScript);
        }
        if sim.page != MenuPage::WorldMap {
            return JoinState::Hidden;
        }
        if spot.airport.is_none() {
            return unavailable(Unavailable::NoDeparture);
        }
        // The aircraft list's check runs once the pilot flying's aircraft name has arrived, and a
        // Join pressed before it answers would send its requests beside it.
        if self.found.is_none() || self.finding.is_some() {
            return JoinState::Running;
        }
        if self
            .found
            .as_ref()
            .is_some_and(|(_, has)| *has == Some(false))
        {
            return unavailable(Unavailable::NoAircraft);
        }
        JoinState::Ready
    }

    fn slice(me: &GoTo, view: &View) -> GoToSlice {
        let session = view.read::<Session>();
        GoToSlice {
            spot: session.key(SPOT).flatten(),
            join: me.join_state(
                session,
                view.read::<SimAwareness>(),
                view.read::<SimService>(),
            ),
            said: me.said.clone(),
        }
    }
}
