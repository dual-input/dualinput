//! Preflight: the pilot flying's core sets the session's aircraft, counts who is ready, and
//! ends preflight on a 3s countdown, and every core holds its aircraft still through
//! preflight while its pilot is in the flight (record/areas/session/02-units.md,
//! "Preflight").

use std::time::Duration;

use kernel::{Cx, TimerId, View};
use messages::net::PilotId;
use messages::session::{self as wire, GoWithout, Phase, Preflight, SetReady};
use messages::{hex, unhex};
use sim_service::{Period, SimAwareness, SimCx, SimEvent, Value, Var};

use crate::{PreflightEnded, Ready, Session};

/// From every counted member ready to the flight starting.
const COUNTDOWN: Duration = Duration::from_secs(3);

/// The pilot flying's duties, while preflight hasn't ended: the session's aircraft, the
/// phase, and the countdown. Returns whether it wrote the key.
pub(crate) fn run(me: &mut Session, cx: &mut Cx) -> bool {
    let (Some(mine), Some(pf)) = (me.me(), me.pf()) else {
        return false;
    };
    let preflight = me.preflight();
    if pf != mine || preflight.phase == Phase::Ended {
        cancel_countdown(me, cx);
        return false;
    }
    let awareness = cx.read::<SimAwareness>();
    let here = awareness
        .stage
        .in_a_flight()
        .then(|| awareness.aircraft.clone())
        .flatten();
    match here {
        // The pilot flying is in a flight: it sets the session's aircraft whenever the key
        // holds none or another, so a host who loaded the wrong aircraft reloads.
        Some(aircraft) => {
            let same = preflight
                .aircraft
                .as_ref()
                .is_some_and(|a| a.path.eq_ignore_ascii_case(&aircraft.path));
            if !same {
                let phase = if preflight.phase == Phase::NoAircraft {
                    // Whether the aircraft is on the ground decides whether there's a
                    // preflight at all, which the read's answer settles.
                    ask_ground(me, cx);
                    Phase::NoAircraft
                } else {
                    Phase::Running
                };
                cancel_countdown(me, cx);
                let next = Preflight {
                    aircraft: Some(aircraft),
                    phase,
                };
                tracing::info!(
                    aircraft = next.aircraft.as_ref().map(|a| a.path.as_str()),
                    "the pilot flying set the session's aircraft"
                );
                me.write(wire::PREFLIGHT, Some(&next), cx);
                return true;
            }
            // A read the sim failed leaves the phase to the next one.
            if preflight.phase == Phase::NoAircraft {
                if me.held.as_ref().is_some_and(|h| h.ground.is_none()) {
                    ask_ground(me, cx);
                }
                return false;
            }
            count(me, preflight, cx)
        }
        // A pilot flying who leaves the flight with another member in it passed control
        // already, so here nobody else is in it, and the session has no aircraft again.
        None if preflight.aircraft.is_some() => {
            cancel_countdown(me, cx);
            tracing::info!(
                "the pilot flying left the flight before preflight ended, with nobody else in it, so the session has no aircraft"
            );
            me.write(wire::PREFLIGHT, Some(&Preflight::default()), cx);
            true
        }
        None => false,
    }
}

/// Reads `A:SIM ON GROUND` once, since a pilot flying who's first in a flight in the air has
/// no preflight: holding an aircraft still in the air goes wrong, because a frozen aircraft
/// keeps integrating its velocities (record/areas/product/03-v1-scope.md, "Preflight").
fn ask_ground(me: &mut Session, cx: &Cx) {
    let handle = cx
        .sim()
        .watch(&[Var::number("A:SIM ON GROUND", "bool")], Period::Once);
    if let Some(held) = &mut me.held {
        held.ground = Some(handle);
    }
}

/// What the sim answered the session crate's calls.
pub(crate) fn sim(me: &mut Session, event: SimEvent, cx: &mut Cx) {
    let (watch, values) = match event {
        SimEvent::Values { watch, values } => (watch, values),
        SimEvent::Failed { call } => {
            if let Some(held) = &mut me.held
                && held.ground == Some(call)
            {
                tracing::info!("the sim didn't answer whether the aircraft is on the ground");
                held.ground = None;
            }
            return;
        }
        _ => return,
    };
    let Some(held) = &mut me.held else {
        return;
    };
    if held.ground != Some(watch) {
        return;
    }
    held.ground = None;
    let preflight = me.preflight();
    if preflight.phase != Phase::NoAircraft || preflight.aircraft.is_none() {
        return;
    }
    let on_ground = matches!(values.first(), Some((_, Value::Number(n))) if *n != 0.0);
    let phase = if on_ground {
        Phase::Running
    } else {
        tracing::info!("the pilot flying is in the air, so the flight starts with no preflight");
        Phase::Ended
    };
    me.write(wire::PREFLIGHT, Some(&Preflight { phase, ..preflight }), cx);
    me.settle(cx);
}

/// The members preflight counts: every member that no member's Ready goes without.
pub(crate) fn counted(me: &Session) -> Vec<PilotId> {
    let members = me.members();
    let without: Vec<PilotId> = members
        .iter()
        .filter_map(|m| me.member_key(wire::READY, m))
        .flat_map(|r| r.without)
        .collect();
    members
        .into_iter()
        .filter(|m| !without.contains(m))
        .collect()
}

/// Whether a counted member is ready: its Ready says so, it's in the flight, and the pilot
/// flying's link to it is up.
fn ready(me: &Session, member: &PilotId) -> bool {
    let Some(held) = &me.held else {
        return false;
    };
    let link_up = *member == held.me
        || held
            .others
            .get(member)
            .is_some_and(|o| o.link == wire::Link::Up);
    link_up && me.in_flight(member) && me.member_key(wire::READY, member).is_some_and(|r| r.ready)
}

/// The countdown starts when every counted member is ready, and goes back to running, its
/// timer canceled, when one isn't.
fn count(me: &mut Session, preflight: Preflight, cx: &Cx) -> bool {
    let all = counted(me).iter().all(|m| ready(me, m));
    match (preflight.phase, all) {
        (Phase::Running, true) => {
            tracing::info!("every counted member is ready, so the countdown runs");
            let timer = cx.timer(COUNTDOWN, countdown_over);
            if let Some(held) = &mut me.held {
                held.countdown = Some(timer);
            }
            let next = Preflight {
                phase: Phase::Countdown,
                ..preflight
            };
            me.write(wire::PREFLIGHT, Some(&next), cx);
            true
        }
        (Phase::Countdown, false) => {
            tracing::info!("a counted member isn't ready, so the countdown stops");
            cancel_countdown(me, cx);
            let next = Preflight {
                phase: Phase::Running,
                ..preflight
            };
            me.write(wire::PREFLIGHT, Some(&next), cx);
            true
        }
        _ => false,
    }
}

/// The countdown ran out: the flight starts. An un-ready that reaches the pilot flying after
/// this is too late.
fn countdown_over(me: &mut Session, timer: TimerId, cx: &mut Cx) {
    let Some(held) = &mut me.held else {
        return;
    };
    if held.countdown != Some(timer) {
        return;
    }
    held.countdown = None;
    let preflight = me.preflight();
    if preflight.phase != Phase::Countdown {
        return;
    }
    tracing::info!("the countdown ran out, so preflight ended");
    me.write(
        wire::PREFLIGHT,
        Some(&Preflight {
            phase: Phase::Ended,
            ..preflight
        }),
        cx,
    );
    me.settle(cx);
}

fn cancel_countdown(me: &mut Session, cx: &Cx) {
    if let Some(timer) = me.held.as_mut().and_then(|h| h.countdown.take()) {
        cx.cancel_timer(timer);
    }
}

/// Every core holds its aircraft while its pilot is in the flight and preflight runs, and
/// lets it go when preflight ends, the pilot leaves the flight, or the session ends.
pub(crate) fn hold(me: &mut Session, cx: &Cx) {
    let want = me.me().is_some_and(|mine| {
        me.in_flight(&mine) && matches!(me.preflight().phase, Phase::Running | Phase::Countdown)
    });
    set_hold(me, want, cx);
}

pub(crate) fn set_hold(me: &mut Session, want: bool, cx: &Cx) {
    let held_now = me.held.as_ref().is_some_and(|h| h.hold);
    if want == held_now {
        return;
    }
    if let Some(held) = &mut me.held {
        held.hold = want;
    }
    tracing::info!(on = want, "this core holds the aircraft for preflight");
    sim_service::hold(cx, want);
}

/// Raises `PreflightEnded` once, when this core first sees the phase: at the countdown's end,
/// at a late join, or when a member the crew went without comes back.
pub(crate) fn ended(me: &mut Session, cx: &Cx) {
    if me.preflight().phase != Phase::Ended {
        return;
    }
    let Some(held) = &mut me.held else {
        return;
    };
    if held.ended_seen {
        return;
    }
    held.ended_seen = true;
    // The session's budget holds its keys and members under 1 MB, and preflight's end is
    // when every member has written all of its own (record/areas/session/02-units.md,
    // "Budgets").
    tracing::info!(
        bytes = held.store.bytes(),
        members = held.others.len() + 1,
        "preflight ended, and the session's keys take this much"
    );
    cx.raise(PreflightEnded);
}

/// Writes this pilot's Ready off, keeping whom it goes without.
pub(crate) fn unready(me: &mut Session, why: &str, cx: &Cx) {
    let Some(mine) = me.me() else {
        return;
    };
    let mut ready = me.member_key(wire::READY, &mine).unwrap_or_default();
    if !ready.ready {
        return;
    }
    tracing::info!(why, "this pilot is no longer ready");
    ready.ready = false;
    me.write(wire::READY, Some(&ready), cx);
}

/// `Ready`, once every guard allowed it.
pub(crate) fn ready_request(me: &mut Session, _: Ready, cx: &mut Cx) {
    let Some(mine) = me.me() else {
        return;
    };
    let mut ready = me.member_key(wire::READY, &mine).unwrap_or_default();
    ready.ready = true;
    tracing::info!("this pilot is ready");
    me.write(wire::READY, Some(&ready), cx);
    me.settle(cx);
}

pub(crate) fn build_ready(me: &Session, _: &View) -> Option<Ready> {
    me.held().then_some(Ready)
}

/// The session crate's own guard on Ready: this pilot is in the flight while preflight runs.
pub(crate) fn own_guard(me: &Session, _: &Ready, _: &View) -> Result<(), String> {
    let Some(mine) = me.me() else {
        return Err("There's no session".into());
    };
    if !matches!(me.preflight().phase, Phase::Running | Phase::Countdown) {
        return Err("Ready waits for preflight".into());
    }
    if !me.in_flight(&mine) {
        return Err("Ready waits until you're in the session's flight".into());
    }
    Ok(())
}

/// `session.ready`: Ready asks the request, so its guards decide, and un-ready writes at once.
pub(crate) fn ready_command(me: &mut Session, args: SetReady, cx: &mut Cx) -> Result<(), String> {
    if !me.held() {
        return Err("There's no session".into());
    }
    if args.on {
        if let Some(kernel::Verdict::Denied(reasons)) = cx.verdict::<Ready>() {
            return Err(reasons.join(". "));
        }
        cx.ask(Ready);
    } else {
        unready(me, "this pilot un-readied", cx);
        me.settle(cx);
    }
    Ok(())
}

/// `session.go-without`: a ready pilot takes a counted member who dropped out out of the
/// count. The pilot flying can't be named, since control stays with a pilot flying whose link
/// is lost, so preflight waits for one who dropped out.
pub(crate) fn go_without(me: &mut Session, args: GoWithout, cx: &mut Cx) -> Result<(), String> {
    let (Some(mine), Some(member)) = (me.me(), unhex::<16>(&args.member)) else {
        return Err("There's no session, or no such member".into());
    };
    if !matches!(me.preflight().phase, Phase::Running | Phase::Countdown) {
        return Err("Go without is only for preflight".into());
    }
    if me.pf() == Some(member) {
        return Err("The crew can't go without the pilot flying".into());
    }
    let mut ready = me.member_key(wire::READY, &mine).unwrap_or_default();
    if !ready.ready {
        return Err("Go without is for a pilot who's ready".into());
    }
    if !counted(me).contains(&member) || member == mine {
        return Err("That member isn't counted".into());
    }
    let link_up = me
        .held
        .as_ref()
        .and_then(|h| h.others.get(&member))
        .is_some_and(|o| o.link == wire::Link::Up);
    let dropped_out = !link_up || !me.in_flight(&member);
    if !dropped_out {
        return Err("That member hasn't dropped out".into());
    }
    tracing::info!(member = hex(&member), "this pilot goes without a member");
    ready.without.push(member);
    me.write(wire::READY, Some(&ready), cx);
    me.settle(cx);
    Ok(())
}
