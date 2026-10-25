//! The test unit that stands in for state sync on the cockpit stream: its sorts of kind, a held
//! value, one a replay collapses, and an event, and a catch-up step that hands over the values
//! it holds. It tells the bench, as lines of text, each message it applied and each the stream
//! sent, pointer sync's among them (record/areas/build/plan.md, "13 The sync engine and the
//! cockpit stream").

use std::collections::BTreeMap;
use std::time::Duration;

use cockpit_stream::{Answer, CockpitCx, CockpitSent, CockpitStream, CockpitUnit, Delivered};
use kernel::{Cx, Input, Registry, TimerId, Verdict, View};
use messages::bench::{BenchKind, CockpitAct, EVENT, HELD, PILOT_FLYING, STEP, ToCore};
use messages::cockpit::CockpitKind;
use session::{FlightChanged, Session, TakeControl};

use super::sim::Heard;

/// Names the source the bench's lines for this unit come in under.
pub struct Acts;

#[derive(Default)]
pub struct BenchCockpit {
    /// The newest value of each key, applied or sent, which the catch-up step hands over.
    values: BTreeMap<String, f64>,
    /// Whether the bench says the step can give and take.
    ready: bool,
    settle: Duration,
    sending: BTreeMap<TimerId, Sending>,
}

struct Sending {
    kind: BenchKind,
    key: String,
    value: f64,
    left: u32,
    every: Duration,
}

fn kind_of(kind: BenchKind) -> CockpitKind<f64> {
    match kind {
        BenchKind::Held => HELD,
        BenchKind::PilotFlying => PILOT_FLYING,
        BenchKind::Event => EVENT,
    }
}

/// A kind's name in the bench's lines, `other` for a feature's, such as pointer sync's gesture.
fn name_of(kind: u16) -> &'static str {
    match kind {
        k if k == HELD.number => "held",
        k if k == PILOT_FLYING.number => "pilot-flying",
        k if k == EVENT.number => "event",
        _ => "other",
    }
}

impl BenchCockpit {
    pub fn register(r: &mut Registry) {
        let mut me = r.unit::<BenchCockpit>("bench-cockpit");
        me.source::<Acts>(BenchCockpit::act);
        me.on::<CockpitSent>(|_: &mut BenchCockpit, sent: &CockpitSent, cx: &mut Cx| {
            cx.out(Heard(format!(
                "cockpit sent {} {} {}",
                name_of(sent.kind),
                sent.key,
                sent.number.map_or_else(|| "-".into(), |n| n.to_string())
            )))
        })
        .on::<FlightChanged>(|me: &mut BenchCockpit, _: &FlightChanged, cx: &mut Cx| {
            me.tell_ready(cx)
        })
        .catch_up_step(STEP, BenchCockpit::give, BenchCockpit::take);
        me.cockpit_kind(HELD, |me, d, cx| me.apply(BenchKind::Held, d, cx))
            .hold_newest()
            .entry(|v| Some(*v));
        me.cockpit_kind(PILOT_FLYING, |me, d, cx| {
            me.apply(BenchKind::PilotFlying, d, cx)
        })
        .hold_newest()
        .collapse_in_replay()
        .entry(|v| Some(*v));
        me.cockpit_kind(EVENT, |me, d, cx| me.apply(BenchKind::Event, d, cx));
    }

    fn act(me: &mut BenchCockpit, input: &Input, cx: &mut Cx) {
        let Ok(ToCore::Cockpit { act }) = serde_json::from_slice(&input.bytes) else {
            tracing::warn!("a line for the cockpit stream's test unit isn't one of its acts");
            return;
        };
        match act {
            CockpitAct::Send {
                kind,
                key,
                value,
                count,
                every_ms,
            } => me.send(
                Sending {
                    kind,
                    key,
                    value,
                    left: count,
                    every: Duration::from_millis(u64::from(every_ms)),
                },
                cx,
            ),
            CockpitAct::Ready { on } => {
                me.ready = on;
                me.tell_ready(cx);
            }
            CockpitAct::Settle { ms } => me.settle = Duration::from_millis(ms),
            CockpitAct::TakeControl => {
                cx.out(Heard(format!(
                    "cockpit take-control {}",
                    verdict(cx.verdict::<TakeControl>())
                )));
                cx.ask(TakeControl);
            }
            CockpitAct::Report => {
                let stream = cx.read::<CockpitStream>();
                let (kept, waiting) = stream.counts();
                let report = serde_json::json!({
                    "values": me.values,
                    "take_control": verdict(cx.verdict::<TakeControl>()),
                    "catching_up": stream.catching_up().is_some(),
                    "replaying": !stream.replaying().is_empty(),
                    "kept": kept,
                    "waiting": waiting,
                });
                cx.out(Heard(format!("cockpit report {report}")));
            }
        }
    }

    /// Says the step can give and take while the bench says so and this member is in the
    /// flight, as state sync's profile loads only in the flight.
    fn tell_ready(&self, cx: &Cx) {
        let session = cx.read::<Session>();
        let in_flight = session.me().is_some_and(|me| session.in_flight(&me));
        cx.cockpit().step_ready(STEP, self.ready && in_flight);
    }

    fn send(&mut self, mut s: Sending, cx: &Cx) {
        if s.left == 0 {
            return;
        }
        self.values.insert(s.key.clone(), s.value);
        cx.cockpit().send(kind_of(s.kind), &s.key, &s.value);
        s.left -= 1;
        s.value += 1.0;
        if s.left > 0 {
            let timer = cx.timer(s.every, |me: &mut BenchCockpit, id: TimerId, cx| {
                if let Some(s) = me.sending.remove(&id) {
                    me.send(s, cx);
                }
            });
            self.sending.insert(timer, s);
        }
    }

    fn apply(&mut self, kind: BenchKind, d: Delivered<f64>, cx: &Cx) -> Answer {
        self.values.insert(d.key.clone(), d.body);
        cx.out(Heard(format!(
            "cockpit applied {} {} {} from={}",
            name_of(kind_of(kind).number),
            d.key,
            d.body,
            short(&d.sender.pilot)
        )));
        Answer::Done
    }

    fn give(me: &BenchCockpit, _: &View) -> Vec<u8> {
        serde_json::to_vec(&me.values).unwrap_or_default()
    }

    fn take(me: &mut BenchCockpit, payload: Vec<u8>, cx: &mut Cx) {
        let values: BTreeMap<String, f64> = serde_json::from_slice(&payload).unwrap_or_default();
        cx.out(Heard(format!(
            "cockpit took {}",
            serde_json::to_string(&values).unwrap_or_default()
        )));
        me.values.extend(values);
        cx.cockpit().step_made(STEP);
        cx.timer(me.settle, |_: &mut BenchCockpit, _: TimerId, cx| {
            cx.out(Heard("cockpit settled".into()));
            cx.cockpit().step_done(STEP);
        });
    }
}

fn verdict(verdict: Option<Verdict>) -> String {
    match verdict {
        Some(Verdict::Allowed) => "allowed".into(),
        Some(Verdict::Denied(reasons)) => format!("denied: {}", reasons.join("; ")),
        None => "none".into(),
    }
}

/// A pilot ID's first 4 bytes, enough to tell two apart in a line.
fn short(pilot: &[u8; 16]) -> String {
    pilot[..4].iter().map(|b| format!("{b:02x}")).collect()
}
