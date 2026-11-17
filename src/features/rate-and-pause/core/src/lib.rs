//! Rate and pause, the feature that keeps every pilot's active pause and the pilot flying's
//! simulation rate the same on every machine in the flight, says when the pilot flying is in the
//! pause menu, and compares the sims' times of day (record/areas/session/02-units.md, "Rate and
//! pause").
//!
//! Active pause turns on and off only through the call the sim's toolbar makes,
//! `TOOLBAR_SET_ACTIVE_PAUSE`, which no SimConnect event we tried makes (measured on MSFS 2024,
//! 2026-10-16, record/areas/environment/log.md), so the feature asks its part in the EFB app to
//! make it.

mod time;

use std::collections::VecDeque;

use clients::{ClientJoined, ClientLeft, To};
use kernel::{Cx, Handle, Registry};
use messages::clients::{Landing, Level, Notification, component};
use messages::hex;
use messages::rate_and_pause::{NAME, PAUSE, RATE, SetPause, TIME_OF_DAY};
use messages::session::STATUS;
use session::{
    ControlPassed, FlightChanged, KeyChanged, MemberGone, Session, SessionEnded, SessionUnit,
    WriteKeys,
};
use sim_service::{Period, SimAwareness, SimChanged, SimCx, SimEvent, SimUnit, Value, Var};

/// `Pause_EX1`'s flag for active pause.
const ACTIVE: u32 = 4;
/// `Pause_EX1`'s flag for the sim pause, which the pause menu raises.
const MENU: u32 = 8;

/// How long an ask of the EFB app's part counts as on its way, in µs. An ask whose call changed
/// nothing would otherwise keep the pilot's own press to that value from reaching the crew. How
/// soon the call's flag comes back is unmeasured, and stage 21's session in the sim times it.
const ASK_LIVES: u64 = 2_000_000;

/// The notification while the pilot flying is in the pause menu.
const IN_MENU: &str = "pause-menu";

/// Rate and pause's state.
#[derive(Default)]
pub struct RateAndPause {
    /// Each value asked of the EFB app's part whose flag hasn't come back, oldest first, with
    /// when it was asked, so the flag it brings back writes no key.
    asked: VecDeque<(bool, u64)>,
    /// How many of the EFB app's sockets are open.
    efb_apps: usize,
    /// The watch of `E:SIMULATION RATE`, from this sim's first flight in the run.
    rate_watch: Option<Handle>,
    /// This sim's simulation rate, as last read.
    rate: Option<f32>,
    /// The rate when this machine sent its last step, until a new rate shows.
    stepped_at: Option<f32>,
    /// The read of the sim's date and time of day, while it's on its way.
    time_read: Option<Handle>,
}

/// Registers rate and pause. Register it after the session crate and the sim service.
pub fn register(r: &mut Registry) {
    let mut me = r.unit::<RateAndPause>(NAME);
    me.session_key(PAUSE)
        .session_key(RATE)
        .match_item(TIME_OF_DAY, time::compare)
        .on_sim(RateAndPause::on_sim);
    me.on::<SimChanged>(RateAndPause::sim_changed)
        .on::<KeyChanged>(RateAndPause::key_changed)
        .on::<FlightChanged>(RateAndPause::flight_changed)
        .on::<ControlPassed>(|me, _: &ControlPassed, cx| {
            me.follow(cx);
            pause_menu(cx);
        })
        .on::<MemberGone>(|_, _: &MemberGone, cx| pause_menu(cx))
        .on::<SessionEnded>(|me, _: &SessionEnded, cx| {
            me.asked.clear();
            me.stepped_at = None;
            clients::clear_notification(cx, IN_MENU);
        })
        .on::<ClientJoined>(RateAndPause::client_joined)
        .on::<ClientLeft>(RateAndPause::client_left);
}

/// Whether this pilot is in the flight, the only time either key is written or applied
/// (record/areas/session/02-units.md, "Rate and pause").
fn in_flight(session: &Session) -> bool {
    session.me().is_some_and(|me| session.in_flight(&me))
}

fn holds_control(session: &Session) -> bool {
    session.pf().is_some() && session.pf() == session.me()
}

/// Whether two rates are one, since a rate the sim steps through is a power of 2.
fn same_rate(a: f32, b: f32) -> bool {
    (a - b).abs() <= a.abs().max(b.abs()) * 1e-3
}

impl RateAndPause {
    fn sim_changed(me: &mut RateAndPause, changed: &SimChanged, cx: &mut Cx) {
        let sim = cx.read::<SimAwareness>();
        let active = sim.pause & ACTIVE != 0;
        if active != (changed.before.pause & ACTIVE != 0) {
            me.flag_changed(active, cx);
        }
        if sim.stage.in_a_flight() && !changed.before.stage.in_a_flight() && me.rate_watch.is_none()
        {
            let rate = Var::number("E:SIMULATION RATE", "number");
            me.rate_watch = Some(cx.sim().watch(&[rate], Period::OnChange));
        }
    }

    /// Forgets each ask whose flag hasn't come back in `ASK_LIVES`.
    fn expire(&mut self, cx: &Cx) {
        let now = cx.now();
        self.asked
            .retain(|&(_, at)| now.saturating_sub(at) < ASK_LIVES);
    }

    /// This sim's active pause changed. A change the part asked for writes nothing, and any
    /// other is the pilot's own, which every machine follows.
    fn flag_changed(&mut self, active: bool, cx: &Cx) {
        self.expire(cx);
        if let Some(at) = self.asked.iter().position(|&(on, _)| on == active) {
            self.asked.drain(..=at);
            // The key may have moved on while this ask was on its way.
            self.apply(cx);
            return;
        }
        let session = cx.read::<Session>();
        if in_flight(session) && session.key(PAUSE) != Some(active) {
            tracing::info!(active, "this pilot changed active pause");
            cx.ask(WriteKeys::one(PAUSE, &active));
        }
    }

    /// Asks the EFB app's part to set active pause to the key, when the flag this sim will have
    /// once every ask on its way has come back differs. An ask whose call changed nothing leaves
    /// the flag off the key until the key next changes, a known limit until the session in the
    /// sim shows whether the call can fail.
    fn apply(&mut self, cx: &Cx) {
        let session = cx.read::<Session>();
        let Some(wanted) = session.key(PAUSE).filter(|_| in_flight(session)) else {
            return;
        };
        self.expire(cx);
        let active = cx.read::<SimAwareness>().pause & ACTIVE != 0;
        let coming = self.asked.back().map_or(active, |&(on, _)| on);
        if coming == wanted || self.efb_apps == 0 {
            return;
        }
        self.asked.push_back((wanted, cx.now()));
        clients::send(
            cx,
            To::Component(component::EFB_APP.into()),
            NAME,
            &SetPause { on: wanted },
        );
    }

    fn key_changed(me: &mut RateAndPause, changed: &KeyChanged, cx: &mut Cx) {
        if changed.key == PAUSE.number {
            me.apply(cx);
        } else if changed.key == RATE.number {
            me.stepped_at = None;
            me.follow(cx);
        } else if changed.key == STATUS.number {
            pause_menu(cx);
        }
    }

    /// A member entered the flight or left it. This pilot entering takes the crew's pause and
    /// rate, and anyone entering hands the match check the sim's time again, so a late join
    /// compares fresh values (record/areas/session/02-units.md, "The match check").
    fn flight_changed(me: &mut RateAndPause, changed: &FlightChanged, cx: &mut Cx) {
        let session = cx.read::<Session>();
        if changed.in_flight && in_flight(session) {
            if session.me() == Some(changed.member) {
                me.apply(cx);
                me.follow(cx);
            }
            me.read_time(cx);
        }
        pause_menu(cx);
    }

    fn read_time(&mut self, cx: &Cx) {
        let vars = [
            Var::number("E:ZULU TIME", "seconds"),
            Var::number("E:ZULU DAY OF MONTH", "number"),
            Var::number("E:ZULU MONTH OF YEAR", "number"),
            Var::number("E:ZULU YEAR", "number"),
        ];
        self.time_read = Some(cx.sim().watch(&vars, Period::Once));
    }

    /// The pilot flying writes their rate into the key, and a following machine steps its own
    /// toward the key's, one step at a time, each once the last shows in `E:SIMULATION RATE`,
    /// which also steps back a following pilot's own change (record/areas/sync/
    /// 04-order-and-recovery.md, "Putting back").
    fn follow(&mut self, cx: &Cx) {
        let session = cx.read::<Session>();
        let Some(rate) = self.rate.filter(|_| in_flight(session)) else {
            return;
        };
        let key = session.key(RATE);
        if holds_control(session) {
            if key.is_none_or(|key| !same_rate(key, rate)) {
                cx.ask(WriteKeys::one(RATE, &rate));
            }
            return;
        }
        let Some(wanted) = key.filter(|&wanted| !same_rate(wanted, rate)) else {
            return;
        };
        if self.stepped_at.is_some_and(|at| same_rate(at, rate)) {
            return;
        }
        let step = if wanted > rate {
            "K:SIM_RATE_INCR"
        } else {
            "K:SIM_RATE_DECR"
        };
        tracing::debug!(rate, wanted, step, "stepping the simulation rate");
        self.stepped_at = Some(rate);
        cx.sim().key(step, &[]);
    }

    fn on_sim(me: &mut RateAndPause, event: SimEvent, cx: &mut Cx) {
        match event {
            SimEvent::Values { watch, values } if Some(watch) == me.rate_watch => {
                // No step of the sim's rate stops it, so a rate of 0 is a read that failed.
                if let Some((_, Value::Number(rate))) = values.first()
                    && *rate > 0.0
                {
                    me.rate = Some(*rate as f32);
                    me.follow(cx);
                }
            }
            SimEvent::Values { watch, values } if Some(watch) == me.time_read => {
                me.time_read = None;
                match time::read(&values) {
                    Some(time) => session::set_match(cx, TIME_OF_DAY, &time),
                    None => tracing::warn!(?values, "the sim's time of day didn't read"),
                }
            }
            SimEvent::Lost => {
                me.rate_watch = None;
                me.rate = None;
                me.time_read = None;
            }
            SimEvent::Failed { call }
            | SimEvent::Exception {
                call: Some(call), ..
            } => {
                if Some(call) == me.rate_watch {
                    me.rate_watch = None;
                } else if Some(call) == me.time_read {
                    me.time_read = None;
                }
            }
            _ => {}
        }
    }

    fn client_joined(me: &mut RateAndPause, joined: &ClientJoined, cx: &mut Cx) {
        if joined.component == component::EFB_APP {
            me.efb_apps += 1;
            // A pause the key changed to while the app was gone reaches the sim now
            // (record/areas/interface/01-apps.md, "Cases for the bench").
            me.asked.clear();
            me.apply(cx);
        }
    }

    fn client_left(me: &mut RateAndPause, left: &ClientLeft, _: &mut Cx) {
        if left.component == component::EFB_APP {
            me.efb_apps = me.efb_apps.saturating_sub(1);
        }
    }
}

/// Holds "James has paused", the frames' words, while the pilot flying's sim is in the pause
/// menu, on every other member's banner, since anyone can open that menu and Dual Input syncs
/// only active pause (record/areas/interface/decisions.md, "The banner carries what a pilot must
/// see without the EFB").
fn pause_menu(cx: &Cx) {
    let session = cx.read::<Session>();
    let paused = session.pf().filter(|pf| {
        session.me() != Some(*pf)
            && session
                .member_key(STATUS, pf)
                .is_some_and(|status| status.pause & MENU != 0)
    });
    match paused {
        Some(pf) => clients::notify(
            cx,
            IN_MENU,
            Notification::new(
                Level::Information,
                format!("{} has paused", session.name_of(&pf)),
                Landing::Session,
            )
            .about(hex(&pf)),
        ),
        None => clients::clear_notification(cx, IN_MENU),
    }
}
