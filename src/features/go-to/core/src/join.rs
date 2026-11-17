//! Join: the world map's requests, each sent once the one before has answered, so a step that
//! fails stops the rest and says which it was (record/areas/session/02-units.md, "Go to").

use std::collections::VecDeque;
use std::time::Duration;

use kernel::{Cx, Handle, TimerId};
use messages::go_to::{Join, JoinState, Outcome, Said, Spot, Step};
use messages::sim::{Stage, WorldMapOutcome, WorldMapRequest};
use session::Session;
use sim_service::{SimAwareness, SimCx, SimService};

use crate::{GoTo, Wanted};

/// How long the flight's load has to begin once the world map started it. The sim loaded within
/// 0.7s in p08 and p10 (record/areas/interface/log.md, 2026-10-05 and 2026-10-06), and with no
/// departure it showed an error dialog and loaded nothing, which would otherwise leave Join
/// running for good.
const LOAD_BEGINS: Duration = Duration::from_secs(10);

/// One Join, from its press until its last step answers.
pub(crate) struct Run {
    now: bool,
    spot: Spot,
    wanted: Wanted,
    steps: VecDeque<Step>,
    /// The step on its way, and its call.
    asked: Option<(Step, Handle)>,
    no_stand: bool,
    /// Once the flight has started: the timer that gives up on its load beginning, until it does.
    launched: Option<Option<TimerId>>,
}

/// `JOIN`: starts a Join, while Join can run.
pub(crate) fn start(me: &mut GoTo, Join { now }: Join, cx: &mut Cx) -> Result<(), String> {
    let state = me.join_state(
        cx.read::<Session>(),
        cx.read::<SimAwareness>(),
        cx.read::<SimService>(),
    );
    if state != JoinState::Ready {
        return Err(format!("Join can't run now: {state:?}"));
    }
    let session = cx.read::<Session>();
    let (Some(spot), Some(wanted)) = (
        session.key(messages::go_to::SPOT).flatten(),
        GoTo::wanted(cx),
    ) else {
        return Err("Join can't run now: the pilot flying's spot isn't known".into());
    };
    let mut steps = VecDeque::from([Step::Airport]);
    // A runway start runs the engines (reported by the user, 2026-10-16), which catch-up can't
    // give a joiner's aircraft, since it writes each entry once at the pilot flying's value and an
    // engine start takes time (record/areas/session/02-units.md, "Go to").
    if spot.engines {
        steps.push_back(Step::Runway);
    } else if spot.stand.is_some() {
        steps.push_back(Step::Stand);
    }
    steps.extend([Step::Aircraft, Step::Livery]);
    if now {
        steps.extend([Step::Launch, Step::Ready]);
    }
    tracing::info!(now, ?spot, ?steps, "Join started");
    me.run = Some(Run {
        now,
        spot,
        wanted,
        steps,
        asked: None,
        no_stand: false,
        launched: None,
    });
    next(me, cx);
    Ok(())
}

/// Sends the next step's request, or ends the run once none is left.
fn next(me: &mut GoTo, cx: &Cx) {
    let Some(run) = me.run.as_mut() else {
        return;
    };
    let Some(step) = run.steps.pop_front() else {
        let (now, no_stand) = (run.now, run.no_stand);
        if !now {
            say(me, Outcome::SetUp { no_stand });
        }
        me.run = None;
        return;
    };
    let request = match step {
        Step::Airport => WorldMapRequest::DepartureAirport {
            icao: run.spot.airport.clone().unwrap_or_default(),
        },
        Step::Stand => match &run.spot.stand {
            Some(stand) => WorldMapRequest::DepartureStand {
                name: stand.name.clone(),
                number: stand.number,
            },
            None => return next(me, cx),
        },
        Step::Runway => WorldMapRequest::DepartureRunway,
        Step::Aircraft => WorldMapRequest::Aircraft {
            folder: run.wanted.folder.clone(),
            title: Some(run.wanted.title.clone()),
        },
        Step::Livery => WorldMapRequest::Livery {
            name: run.spot.livery.clone(),
            title: run.wanted.title.clone(),
        },
        Step::Launch => {
            // The load's signals and the launch's answer come by separate paths, SimConnect and the
            // menu script's socket, so Join follows the load from the launch on, whichever comes
            // first: in p10, `FlightLoaded` came 200ms after `launchFlight`.
            run.launched = Some(Some(cx.timer(LOAD_BEGINS, load_late)));
            WorldMapRequest::LaunchFlight
        }
        Step::Ready => WorldMapRequest::ReadyToFly,
    };
    run.asked = Some((step, cx.sim().world_map(request)));
}

/// The menu script's answer to a step, or a failure for one no menu script could answer.
pub(crate) fn answered(me: &mut GoTo, call: Handle, outcome: WorldMapOutcome, cx: &Cx) {
    let Some(run) = me.run.as_mut() else {
        return;
    };
    let Some((step, _)) = run.asked.filter(|(_, asked)| *asked == call) else {
        return;
    };
    run.asked = None;
    tracing::info!(?step, ?outcome, "a step of Join answered");
    match (step, outcome) {
        (Step::Launch, WorldMapOutcome::Done) => {
            // The flight starts, so Join now says so, and presses Ready to fly once the load
            // shows it, which it may have already.
            let no_stand = run.no_stand;
            say(me, Outcome::SetUp { no_stand });
            let stage = cx.read::<SimAwareness>().stage;
            stage_changed(me, stage, cx);
        }
        (Step::Ready, WorldMapOutcome::Done) => me.stop(cx),
        (_, WorldMapOutcome::Done) => next(me, cx),
        // The world map lists no such stand, so the airport stays selected with no stand, and
        // Join goes on (record/areas/interface/decisions.md, "Join takes a joiner from the world
        // map into the PF's flight, or only sets it up").
        (Step::Stand, WorldMapOutcome::NoMatch) => {
            run.no_stand = true;
            next(me, cx);
        }
        // The joiner lacks the livery, and keeps the aircraft's own.
        (Step::Livery, WorldMapOutcome::NoMatch) => next(me, cx),
        (step, _) => fail(me, step, cx),
    }
}

/// Follows the flight's load once Join has started it: Ready to fly once the load reaches its
/// button and the launch has answered, the run's end once the flight is up, and a failure if the
/// load ends back at the menu.
pub(crate) fn stage_changed(me: &mut GoTo, stage: Stage, cx: &Cx) {
    let Some(run) = me.run.as_mut() else {
        return;
    };
    let Some(late) = run.launched else {
        return;
    };
    match stage {
        Stage::Loading => {
            if let Some(timer) = late {
                cx.cancel_timer(timer);
            }
            run.launched = Some(None);
        }
        Stage::ReadyToFly if run.asked.is_none() && run.steps.front() == Some(&Step::Ready) => {
            next(me, cx)
        }
        // The flight has started, by Join's press or the pilot's own.
        Stage::Flying => me.stop(cx),
        // Back at the menu once the load had begun, or the sim gone.
        Stage::Menu if late.is_none() => fail(me, Step::Launch, cx),
        Stage::Closed => fail(me, Step::Launch, cx),
        _ => {}
    }
}

fn load_late(me: &mut GoTo, _: TimerId, cx: &mut Cx) {
    if let Some(run) = me.run.as_mut() {
        run.launched = Some(None);
    }
    tracing::info!("the flight Join started didn't begin to load");
    fail(me, Step::Launch, cx);
}

fn fail(me: &mut GoTo, step: Step, cx: &Cx) {
    say(me, Outcome::Failed { step });
    me.stop(cx);
}

/// Something for the part to show, about the run going now.
fn say(me: &mut GoTo, outcome: Outcome) {
    let Some(run) = &me.run else {
        return;
    };
    let n = me.said.as_ref().map_or(1, |said| said.n + 1);
    me.said = Some(Said {
        n,
        now: run.now,
        spot: run.spot.clone(),
        aircraft: run.wanted.title.clone(),
        outcome,
    });
}

impl GoTo {
    /// Ends the run going now, if one is.
    pub(crate) fn stop(&mut self, cx: &Cx) {
        if let Some(Run {
            launched: Some(Some(timer)),
            ..
        }) = self.run.take()
        {
            cx.cancel_timer(timer);
        }
    }
}
