//! The test unit that stands in for a feature that calls the sim: it makes the calls the
//! bench's lines ask for, and tells the bench what it hears from the sim, what sim
//! awareness says, and our module's status, each as a line of text.

use std::time::Duration;

use kernel::{Cx, Handle, Input, Registry, Started, TimerId};
use messages::bench::{SimCall, ToCore};
use messages::module::HOLD;
use messages::module::slots::HoldSlot;
use serde::Serialize;
use sim_service::{
    InitPosition, Period, SimAwareness, SimChanged, SimCx, SimEvent, SimService, SimUnit, Status,
    Value, Var,
};

use super::module::{PROBE, ProbeSlot};

/// Names the source the bench's calls of the sim come in under.
pub struct Calls;

/// A line of text for the bench. It goes into the outputs' hash, so a replay that heard
/// something else parts from the run.
#[derive(Serialize)]
pub struct Heard(pub String);

/// How often the unit looks at our module's status, which raises no moment of its own.
const LOOK: Duration = Duration::from_millis(100);

#[derive(Default)]
pub struct Probe {
    /// Its watches, in the order it made them, which the bench numbers them by.
    watches: Vec<Handle>,
    /// Its creates, numbered the same way.
    creates: Vec<Handle>,
    status: Status,
}

impl Probe {
    pub fn register(r: &mut Registry) {
        r.unit::<Probe>("bench-sim")
            .on_sim(Probe::on_sim)
            .on::<SimChanged>(Probe::changed)
            .on::<Started>(Probe::started)
            .source::<Calls>(Probe::call);
    }

    fn call(me: &mut Probe, input: &Input, cx: &mut Cx) {
        let Ok(ToCore::Sim { call }) = serde_json::from_slice(&input.bytes) else {
            tracing::warn!("a line for the sim's test unit isn't a call");
            return;
        };
        match call {
            SimCall::Watch { vars, once } => {
                let vars: Vec<Var> = vars.iter().map(|(n, u)| Var::number(n, u)).collect();
                let period = if once { Period::Once } else { Period::OnChange };
                me.watches.push(cx.sim().watch(&vars, period));
            }
            SimCall::Write { watch, values } => {
                let Some(&watch) = me.watches.get(watch as usize) else {
                    cx.out(Heard(format!("no watch {watch}")));
                    return;
                };
                cx.sim()
                    .write(watch, values.into_iter().map(Value::Number).collect());
            }
            SimCall::Key { event, value } => {
                cx.sim().key(&event, &[value]);
            }
            SimCall::Feed { routine, mode } => match routine.as_str() {
                "HOLD" => cx.module().feed(HOLD, &HoldSlot {}),
                "PROBE" => cx.module().feed(PROBE, &ProbeSlot { mode }),
                other => cx.out(Heard(format!("no routine {other}"))),
            },
            SimCall::End { routine } => match routine.as_str() {
                "HOLD" => cx.module().end(HOLD),
                "PROBE" => cx.module().end(PROBE),
                other => cx.out(Heard(format!("no routine {other}"))),
            },
            SimCall::Create { title } => {
                me.creates
                    .push(cx.sim().create_ai(&title, "", InitPosition::default()));
            }
            SimCall::Frames => {
                cx.sim().frames();
            }
        }
    }

    fn on_sim(me: &mut Probe, event: SimEvent, cx: &mut Cx) {
        let watch = |handle: &Handle| me.watches.iter().position(|w| w == handle);
        let heard = match event {
            SimEvent::Values { watch: w, values } => {
                let values: Vec<String> = values
                    .iter()
                    .map(|(place, value)| match value {
                        Value::Number(n) => format!("{place}={n}"),
                        Value::Text(t) => format!("{place}={t}"),
                    })
                    .collect();
                format!("values of watch {:?}: {}", watch(&w), values.join(" "))
            }
            SimEvent::Polled {
                object,
                entry,
                out_of,
                ..
            } => format!("polled object {object}, {entry} of {out_of}"),
            SimEvent::Exception {
                call, exception, ..
            } => match call.and_then(|c| me.creates.iter().position(|h| *h == c)) {
                Some(create) => format!("exception {exception} for create {create}"),
                None => format!(
                    "exception {exception} for watch {:?}",
                    call.and_then(|c| watch(&c))
                ),
            },
            SimEvent::Failed { .. } => "a call failed".to_string(),
            SimEvent::Lost => "lost".to_string(),
            SimEvent::Created { call, object } => format!(
                "created object {object} for create {:?}",
                me.creates.iter().position(|h| *h == call)
            ),
            SimEvent::Camera { simobject, .. } => format!("camera at {:?}", simobject.position),
            SimEvent::Frame { .. } => "frame".to_string(),
            SimEvent::Heard { data, .. } => format!("heard an event with {}", data[0]),
            SimEvent::Input { value, first, .. } => format!("input {value:?} first={first}"),
            SimEvent::Report { bytes, .. } => format!("a report of {} bytes", bytes.len()),
            SimEvent::WorldMap { outcome, .. } => format!("the world map answered {outcome:?}"),
        };
        cx.out(Heard(heard));
    }

    fn changed(_: &mut Probe, changed: &SimChanged, cx: &mut Cx) {
        let now = cx.read::<SimAwareness>();
        if now.stage != changed.before.stage {
            let aircraft = now.aircraft.as_ref().map_or("none", |a| a.path.as_str());
            cx.out(Heard(format!("stage {:?} aircraft {aircraft}", now.stage)));
        }
        if now.ended != changed.before.ended {
            cx.out(Heard(format!("ended {:?}", now.ended)));
        }
        if now.departure != changed.before.departure
            && let Some(d) = &now.departure
        {
            let (airport, stand, number) = (&d.airport, &d.stand_name, d.stand_number);
            cx.out(Heard(format!("departure {airport} {stand} {number}")));
        }
    }

    fn started(_: &mut Probe, _: &Started, cx: &mut Cx) {
        cx.timer(LOOK, Probe::look);
    }

    fn look(me: &mut Probe, _: TimerId, cx: &mut Cx) {
        let status = cx.read::<SimService>().module_status();
        if status != me.status {
            me.status = status;
            cx.out(Heard(format!("module {status:?}")));
        }
        cx.timer(LOOK, Probe::look);
    }
}
