//! State sync, the feature that makes a switch, knob, or lever one pilot moves also move in the
//! other pilot's cockpit (record/areas/sync/05-units.md, "State sync").
//!
//! It holds one sync engine for the loaded profile, and joins it to the rest of the core: what
//! the engine watches comes through sim variables, its changes go out on the cockpit stream,
//! what the crew changed comes back in the stream's order, and each action the engine asks for
//! goes to sim variables, which carries it out through the route its kind of name takes.

mod carry;
mod notices;
mod watch;

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use clients::{ClientJoined, ClientLeft, Clients, ClientsUnit, SettingDef, To};
use cockpit_stream::{
    Answer, Applying, CockpitCx, CockpitSent, CockpitStream, CockpitUnit, Delivered, PRETEND,
};
use kernel::{Cx, Handle, Registry, TimerId, View};
use messages::clients::SettingKind;
use messages::clients::component::PROFILE_EXTENSION;
use messages::cockpit::Origin;
use messages::net::PilotId;
use messages::session::{Control, Phase};
use messages::sim::Stage;
use messages::state_sync::{
    CHANGE, ChecklistRow, FIRED, NAME, PF_CHANGE, STATE, Source, StateSyncSlice, SyncLog,
};
use messages::sync::{CatchUpState, Stamp, Value};
use profile_engine::Resolved;
use profile_loader::{ProfileLoaded, ProfileUnloaded, Profiles};
use sandbox::Sandbox;
use session::{ControlPassed, Ready, Session};
use sim_service::{SimAwareness, SimChanged, SimCx, SimEvent, SimUnit};
use sim_variables::{VariablesCx, VariablesEvent, VariablesUnit};
use sync_engine::{Applied, Arrived, Ctx, Engine, Load, Ready as Settling};

use crate::notices::Notices;

/// The development setting that says how long after Ready to fly an aircraft counts as settled,
/// in ms. The bench sets it to 0, since every session scenario flies the 58P, whose profile would
/// otherwise cost each of them the 30s, and the scenario that tests the wait leaves it out.
pub const SETTLE_MS: &str = "state-sync.settle-ms";

/// State sync's state.
#[derive(Default)]
pub struct StateSync {
    /// The engine and what's kept beside it, while a profile is loaded.
    live: Option<Live>,
    /// When this sim last reached Flying from Ready to fly, while it stays in Flying.
    rtc_end: Option<u64>,
    /// Each connected profile extension of this core's release, by its socket. While any is
    /// connected, the engine keeps its log for the extension's Sync log
    /// (record/areas/profiles/06-the-sync-log.md, "How it reaches the view").
    extensions: BTreeSet<u64>,
}

struct Live {
    /// The stamp of the profile's load, which names the load each step of the log belongs to.
    loaded_at: u64,
    engine: Engine,
    /// The watch through sim variables of every name in `engine.watches()`, in its order.
    watch: Handle,
    frames: Option<Handle>,
    /// The arrival each stepping write carries out, which the stream waits on.
    stepping: BTreeMap<String, Applying>,
    /// Who sent each entry's last arrival, whom a failed write's notification names.
    from: BTreeMap<String, messages::net::PilotId>,
    checklist: Vec<ChecklistRow>,
    notices: Notices,
    /// The timer that turns the catch-up step ready, until it has. `give` leaves out an entry
    /// with no reading, so a step ready at the load would answer a catch-up asked before it
    /// with none of the cockpit's values.
    ready_timer: Option<TimerId>,
}

/// Registers state sync.
pub fn register(r: &mut Registry) {
    let mut me = r.unit::<StateSync>(NAME);
    me.setting(
        SETTLE_MS,
        SettingDef {
            label: "How long after Ready to fly an aircraft counts as settled, in ms",
            kind: SettingKind::Number {
                min: 0.0,
                max: 120_000.0,
            },
            default: serde_json::json!(sync_engine::SETTLE / 1_000),
            part_only: false,
            development: true,
        },
    );
    me.on::<ProfileLoaded>(StateSync::load)
        .on::<ProfileUnloaded>(StateSync::unload)
        .on::<SimChanged>(StateSync::sim_changed)
        .on::<CockpitSent>(StateSync::sent)
        .on::<ControlPassed>(StateSync::control_passed)
        .on::<ClientJoined>(StateSync::joined)
        .on::<ClientLeft>(StateSync::left)
        .guard::<Ready>(StateSync::settled)
        .on_sim(StateSync::on_sim)
        .ends_with_profile()
        .on_variables(StateSync::on_variables)
        .client_state(NAME, StateSync::slice)
        .catch_up_step(STATE, StateSync::give, StateSync::take);
    // The profile extension's recorder records all three, so a recording holds every change and
    // firing a crewmate would receive.
    me.cockpit_kind(CHANGE, StateSync::apply)
        .hold_newest()
        .recorded()
        .entry(Value::number);
    me.cockpit_kind(PF_CHANGE, StateSync::apply)
        .hold_newest()
        .collapse_in_replay()
        .recorded()
        .entry(Value::number);
    me.cockpit_kind(FIRED, StateSync::fire)
        .recorded()
        .entry(|value| value.as_ref().and_then(Value::number));
}

/// What the engine's calls know of the session, or `None` before this core has one with a
/// control value, as for a core whose first `Started` message hasn't come.
fn engine_ctx(cx: &Cx) -> Option<Ctx> {
    let session = cx.read::<Session>();
    let pilot = session.me()?;
    let restart = session.restart()?;
    let control: Control = session.control()?;
    Some(Ctx {
        at: cx.now(),
        me: Origin { pilot, restart },
        control,
        catching_up: cx.read::<CockpitStream>().catching_up().is_some(),
        preflight_ended: session.preflight().phase == Phase::Ended,
    })
}

/// The pilot flying's checklist: each counting entry's name and starting value, since a shadow
/// is right only if the pilot flying's aircraft starts there
/// (record/areas/sync/01-profile-entries.md).
fn checklist(profile: &Resolved) -> Vec<ChecklistRow> {
    profile
        .state
        .iter()
        .filter_map(|entry| match &entry.watch {
            profile_engine::Watch::Count(count) => Some(ChecklistRow {
                id: entry.key.clone(),
                name: entry.name.clone(),
                default: count.default.to_string(),
                description: entry.description.clone(),
            }),
            profile_engine::Watch::Name(_) => None,
        })
        .collect()
}

impl StateSync {
    /// The profile loaded: an engine for it, its watches, and the catch-up step.
    fn load(me: &mut StateSync, _: &ProfileLoaded, cx: &mut Cx) {
        let Some(profile) = cx.read::<Profiles>().loaded().map(|l| l.profile.clone()) else {
            return;
        };
        let stage = cx.read::<SimAwareness>().stage;
        let ready = match (stage, me.rtc_end) {
            (Stage::Flying, Some(at)) => Settling::At(at),
            (Stage::Flying, None) => Settling::Missed,
            _ => Settling::Yet,
        };
        let settle = cx
            .read::<Clients>()
            .setting_as::<u64>(SETTLE_MS)
            .map_or(sync_engine::SETTLE, |ms| ms * 1_000);
        let loaded_at = cx.now();
        let (mut engine, out) = Engine::load(
            &profile,
            Sandbox::new(),
            Load {
                at: loaded_at,
                ready,
                settle,
            },
        );
        engine.keep_log(!me.extensions.is_empty());
        let watch = cx.variables().watch(&watch::watches(engine.watches()));
        let mut live = Live {
            loaded_at,
            engine,
            watch,
            frames: Some(cx.sim().frames()),
            stepping: BTreeMap::new(),
            from: BTreeMap::new(),
            checklist: checklist(&profile),
            notices: Notices::default(),
            ready_timer: Some(cx.timer(
                Duration::from_micros(sync_engine::CHECK),
                StateSync::catch_up_ready,
            )),
        };
        live.carry_out(out, cx);
        me.live = Some(live);
    }

    fn unload(me: &mut StateSync, _: &ProfileUnloaded, cx: &mut Cx) {
        // The stream applies nothing after a stepping write's arrival until its unit says it's
        // applied, and an engine that's gone takes no more steps, so each counts as applied.
        if let Some(live) = me.live.take() {
            cx.variables().end(live.watch);
            for applying in live.stepping.into_values() {
                cx.cockpit().applied(applying);
            }
        }
        cx.cockpit().step_ready(STATE, false);
    }

    /// Each move into Flying from Ready to fly is that load's `RTC_END`, and a sim found already
    /// in Flying has none, which the engine counts as settled at once.
    fn sim_changed(me: &mut StateSync, changed: &SimChanged, cx: &mut Cx) {
        let stage = cx.read::<SimAwareness>().stage;
        if stage != Stage::Flying {
            me.rtc_end = None;
        } else if changed.before.stage == Stage::ReadyToFly {
            let at = cx.now();
            me.rtc_end = Some(at);
            if let Some(live) = me.live.as_mut() {
                live.engine.ready_to_fly(at);
            }
        }
    }

    /// The guard on Ready: until the aircraft has settled, what it restores of itself after the
    /// load would otherwise reach the crew as a pilot's changes.
    fn settled(me: &StateSync, _: &Ready, _: &View) -> Result<(), String> {
        match &me.live {
            Some(live) if !live.engine.settled() => Err(
                "Ready opens once your aircraft has settled, about 30s after Ready to fly".into(),
            ),
            _ => Ok(()),
        }
    }

    /// The catch-up step turns ready `CHECK` after the load, by which every watch has read.
    fn catch_up_ready(me: &mut StateSync, timer: TimerId, cx: &mut Cx) {
        if let Some(live) = me.live.as_mut()
            && live.ready_timer == Some(timer)
        {
            live.ready_timer = None;
            cx.cockpit().step_ready(STATE, true);
        }
    }

    /// The sim drew a frame, which paces the engine's steps and checks. State sync's own
    /// connection carries only this subscription, and closes with the profile.
    fn on_sim(me: &mut StateSync, event: SimEvent, cx: &mut Cx) {
        let (Some(live), Some(ctx)) = (me.live.as_mut(), engine_ctx(cx)) else {
            return;
        };
        match event {
            SimEvent::Frame { call, .. } if Some(call) == live.frames => {
                let out = live.engine.frame(ctx);
                live.carry_out(out, cx);
                live.send_log(None, cx);
            }
            SimEvent::Lost => {
                tracing::info!("state sync's connection to the sim was lost and opens again");
            }
            _ => {}
        }
    }

    /// A reading, a firing, or a failure of one of the engine's watches.
    fn on_variables(me: &mut StateSync, event: VariablesEvent, cx: &mut Cx) {
        let (Some(live), Some(ctx)) = (me.live.as_mut(), engine_ctx(cx)) else {
            return;
        };
        if event.watch != live.watch {
            return;
        }
        let seen = live.seen(event.place, event.got, cx);
        let out = live.engine.seen(seen, ctx);
        live.carry_out(out, cx);
        live.send_log(None, cx);
    }

    /// Control passed: a machine that now flies writes what the pilot flying owns at the former
    /// pilot flying's values.
    fn control_passed(me: &mut StateSync, _: &ControlPassed, cx: &mut Cx) {
        let (Some(live), Some(ctx)) = (me.live.as_mut(), engine_ctx(cx)) else {
            return;
        };
        let out = live.engine.control_passed(ctx);
        live.carry_out(out, cx);
        live.send_log(None, cx);
    }

    /// A profile extension of this core's release connected, so the engine keeps its log while it
    /// stays, for the extension's Sync log.
    fn joined(me: &mut StateSync, joined: &ClientJoined, _: &mut Cx) {
        if joined.component == PROFILE_EXTENSION && joined.version == messages::VERSION {
            me.extensions.insert(joined.socket);
            me.keep_log();
        }
    }

    fn left(me: &mut StateSync, left: &ClientLeft, _: &mut Cx) {
        if me.extensions.remove(&left.socket) {
            me.keep_log();
        }
    }

    fn keep_log(&mut self) {
        let on = !self.extensions.is_empty();
        if let Some(live) = self.live.as_mut() {
            live.engine.keep_log(on);
        }
    }

    /// The stream sent one of this machine's changes, which the conflict rule holds it under.
    fn sent(me: &mut StateSync, sent: &CockpitSent, cx: &mut Cx) {
        if sent.kind != CHANGE.number && sent.kind != PF_CHANGE.number {
            return;
        }
        let Some(live) = me.live.as_mut() else {
            return;
        };
        let session = cx.read::<Session>();
        let (Some(pilot), Some(restart)) = (session.me(), session.restart()) else {
            return;
        };
        let origin = Origin { pilot, restart };
        let stamp = Stamp {
            origin,
            number: sent.clock.get(origin),
            clock: sent.clock.clone(),
            pilot_flying: sent.control.pf,
        };
        live.engine.sent(&sent.key, stamp, cx.now());
        live.send_log(None, cx);
    }

    /// Another machine's change, in the stream's order.
    fn apply(me: &mut StateSync, d: Delivered<Value>, cx: &mut Cx) -> Answer {
        let (Some(live), Some(ctx)) = (me.live.as_mut(), engine_ctx(cx)) else {
            return Answer::Skipped;
        };
        let stamp = Stamp {
            origin: d.sender,
            number: d.clock.get(d.sender),
            pilot_flying: d.control.pf,
            clock: d.clock,
        };
        live.from.insert(d.key.clone(), d.sender.pilot);
        let (applied, out) = live.engine.arrived(
            &d.key,
            Arrived::Change {
                value: d.body,
                stamp,
            },
            ctx,
        );
        if applied == Applied::Stepping {
            live.stepping.insert(d.key, d.id);
        }
        live.carry_out(out, cx);
        live.send_log(Some(d.sender.pilot), cx);
        answer(applied)
    }

    /// Another machine's event entry, in the stream's order.
    fn fire(me: &mut StateSync, d: Delivered<Option<Value>>, cx: &mut Cx) -> Answer {
        let (Some(live), Some(ctx)) = (me.live.as_mut(), engine_ctx(cx)) else {
            return Answer::Skipped;
        };
        live.from.insert(d.key.clone(), d.sender.pilot);
        let (applied, out) = live
            .engine
            .arrived(&d.key, Arrived::Fired { value: d.body }, ctx);
        if applied == Applied::Stepping {
            live.stepping.insert(d.key, d.id);
        }
        live.carry_out(out, cx);
        live.send_log(Some(d.sender.pilot), cx);
        answer(applied)
    }

    /// The catch-up step on the flying machine: each entry and its stamp, in the order its
    /// cockpit took each value. A machine with no engine gives nothing, as a member whose
    /// aircraft has no profile does.
    fn give(me: &StateSync, _: &View) -> Vec<u8> {
        let state = me
            .live
            .as_ref()
            .map_or_else(CatchUpState::default, |live| live.engine.give());
        postcard::to_stdvec(&state).unwrap_or_default()
    }

    /// The catch-up step on the catching-up machine. With no engine there's nothing to write,
    /// so the step is made and done at once.
    fn take(me: &mut StateSync, payload: Vec<u8>, cx: &mut Cx) {
        let state: Option<CatchUpState> = postcard::from_bytes(&payload).ok();
        let (Some(live), Some(ctx), Some(state)) = (me.live.as_mut(), engine_ctx(cx), state) else {
            cx.cockpit().step_made(STATE);
            cx.cockpit().step_done(STATE);
            return;
        };
        if let Some(pf) = cx.read::<Session>().pf() {
            for entry in &state.entries {
                live.from.insert(entry.key.clone(), pf);
            }
        }
        let out = live.engine.take(&state, ctx);
        live.carry_out(out, cx);
        let from = cx.read::<CockpitStream>().taking_from();
        live.send_log(from, cx);
    }

    fn slice(me: &StateSync, view: &View) -> StateSyncSlice {
        let session = view.read::<Session>();
        let flying = session.me().is_some() && session.me() == session.pf();
        let checklist = match &me.live {
            Some(live) if flying && session.preflight().phase != Phase::Ended => {
                live.checklist.clone()
            }
            _ => Vec::new(),
        };
        StateSyncSlice { checklist }
    }
}

impl Live {
    /// Sends the steps the engine logged in the call just made to every connected profile
    /// extension, with the load they belong to and who sent the arrival or the catch-up the call
    /// took. With no extension connected the engine logs nothing, and `clients` sends to nobody
    /// (record/areas/profiles/06-the-sync-log.md, "How it reaches the view").
    fn send_log(&mut self, from: Option<PilotId>, cx: &Cx) {
        let steps = self.engine.take_log();
        if steps.is_empty() {
            return;
        }
        let from = from.map(|pilot| {
            if pilot == PRETEND.pilot {
                Source::Playback
            } else {
                Source::Member(cx.read::<Session>().name_of(&pilot))
            }
        });
        let log = SyncLog {
            load: self.loaded_at,
            from,
            steps,
        };
        clients::send(cx, To::Component(PROFILE_EXTENSION.into()), NAME, &log);
    }
}

fn answer(applied: Applied) -> Answer {
    match applied {
        Applied::Done => Answer::Done,
        Applied::Skipped => Answer::Skipped,
        Applied::Stepping => Answer::Unfinished,
    }
}
