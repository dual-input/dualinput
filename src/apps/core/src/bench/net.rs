//! The test unit that stands in for a feature with a channel of each delivery, whose probes
//! carry their send stamp so the receiver measures how late each came, and that tells the
//! bench, as lines of text, what the network raises. The session crate hosts, joins, and opens
//! the session, through the commands the bench's fake desktop app sends
//! (record/areas/build/plan.md, "7 The network" and "9 The session").

use std::collections::BTreeMap;
use std::time::Duration;

use kernel::{Cx, Input, Registry, TimerId};
use messages::bench::{DEADLINE, Delivery, NEWEST, NetAct, Probe, STREAM, ToCore};
use messages::net::{Channel, PilotId};
use network::{LinkLost, LinkUp, MemberLeft, MemberOut, NetUnit, Network, Sender, To};
use serde::Serialize;

use super::sim::Heard;

/// Names the source the bench's lines for this unit come in under.
pub struct Acts;

#[derive(Default)]
pub struct BenchNet {
    /// A sender for each delivery a scenario asked for, by the delivery's number, and the
    /// delivery each of their timers is for.
    sending: BTreeMap<u8, Sending>,
    timers: BTreeMap<TimerId, u8>,
    got: BTreeMap<u16, Got>,
    /// Each member's restart count, as its latest `LinkUp` gave it.
    members: BTreeMap<PilotId, u32>,
}

struct Sending {
    delivery: Delivery,
    left: u32,
    every: Duration,
    bytes: u32,
    n: u32,
    /// When the next probe is due, so a timer that fires late pushes back no probe after it.
    due: u64,
}

#[derive(Default)]
struct Got {
    /// How late each probe came, in µs.
    late: Vec<u64>,
    /// Probes that came after one with a higher number.
    behind: u32,
    highest: Option<u32>,
}

/// What came on one channel, as the bench reads it.
#[derive(Serialize)]
struct Summary {
    count: usize,
    p50_us: u64,
    p99_us: u64,
    max_us: u64,
    behind: u32,
}

impl Got {
    fn summary(&self) -> Summary {
        let mut late = self.late.clone();
        late.sort_unstable();
        let at = |q: f64| {
            late.get(((late.len().max(1) - 1) as f64 * q) as usize)
                .copied()
                .unwrap_or(0)
        };
        Summary {
            count: late.len(),
            p50_us: at(0.5),
            p99_us: at(0.99),
            max_us: at(1.0),
            behind: self.behind,
        }
    }
}

impl BenchNet {
    pub fn register(r: &mut Registry) {
        let mut me = r.unit::<BenchNet>("bench-net");
        me.source::<Acts>(BenchNet::act);
        me.channel(STREAM, |me: &mut BenchNet, _, p, cx| me.got(STREAM, p, cx))
            .channel(NEWEST, |me: &mut BenchNet, _, p, cx| me.got(NEWEST, p, cx))
            .channel(DEADLINE, |me: &mut BenchNet, _, p, cx| {
                me.got(DEADLINE, p, cx)
            })
            .on::<LinkUp>(|me: &mut BenchNet, up: &LinkUp, cx: &mut Cx| {
                me.members.insert(up.member.pilot, up.member.restart);
                cx.out(Heard(format!(
                    "net up {} again={} restart={}",
                    short(&up.member.pilot),
                    up.again,
                    up.member.restart
                )))
            })
            .on::<LinkLost>(|_: &mut BenchNet, l: &LinkLost, cx: &mut Cx| {
                cx.out(Heard(format!("net lost {}", short(&l.member))))
            })
            .on::<MemberLeft>(|_: &mut BenchNet, l: &MemberLeft, cx: &mut Cx| {
                cx.out(Heard(format!("net left {}", short(&l.member))))
            })
            .on::<MemberOut>(|_: &mut BenchNet, o: &MemberOut, cx: &mut Cx| {
                cx.out(Heard(format!("net out {}", short(&o.member))))
            });
    }

    fn act(me: &mut BenchNet, input: &Input, cx: &mut Cx) {
        let Ok(ToCore::Net { act }) = serde_json::from_slice(&input.bytes) else {
            tracing::warn!("a line for the network's test unit isn't one of its acts");
            return;
        };
        match act {
            NetAct::Send {
                delivery,
                count,
                every_ms,
                bytes,
            } => {
                let which = delivery as u8;
                me.sending.insert(
                    which,
                    Sending {
                        delivery,
                        left: count,
                        every: Duration::from_millis(u64::from(every_ms)),
                        bytes,
                        n: 0,
                        due: cx.now(),
                    },
                );
                me.send(which, cx);
            }
            NetAct::Report => {
                let probes: BTreeMap<u16, Summary> =
                    me.got.iter().map(|(c, g)| (*c, g.summary())).collect();
                let network = cx.read::<Network>();
                let offsets: BTreeMap<String, Option<i64>> = me
                    .members
                    .iter()
                    .map(|(&pilot, &restart)| {
                        (short(&pilot), network.offset(Sender { pilot, restart }))
                    })
                    .collect();
                let report = serde_json::json!({ "probes": probes, "offsets": offsets });
                cx.out(Heard(format!("net report {report}")));
                me.got.clear();
            }
        }
    }

    fn send(&mut self, which: u8, cx: &Cx) {
        let Some(s) = self.sending.get_mut(&which) else {
            return;
        };
        if s.left == 0 {
            let delivery = s.delivery;
            self.sending.remove(&which);
            return cx.out(Heard(format!("net sent {delivery:?}")));
        }
        let now = cx.now();
        let probe = Probe {
            n: s.n,
            sent: now,
            deadline: (s.delivery == Delivery::Deadline).then_some(now + 300_000),
            pad: vec![0; s.bytes as usize],
        };
        match s.delivery {
            Delivery::Stream => network::send(cx, STREAM, To::Crew, &probe),
            Delivery::Newest => network::send_one_off(cx, NEWEST, To::Crew, &probe),
            Delivery::Deadline => network::send_one_off(cx, DEADLINE, To::Crew, &probe),
        }
        s.n += 1;
        s.left -= 1;
        s.due += u64::try_from(s.every.as_micros()).unwrap_or(u64::MAX);
        let after = Duration::from_micros(s.due.saturating_sub(now));
        let timer = cx.timer(after, |me: &mut BenchNet, id: TimerId, cx| {
            if let Some(which) = me.timers.remove(&id) {
                me.send(which, cx);
            }
        });
        self.timers.insert(timer, which);
    }

    fn got(&mut self, channel: Channel<Probe>, probe: Probe, cx: &Cx) {
        let got = self.got.entry(channel.number).or_default();
        got.late.push(cx.now().saturating_sub(probe.sent));
        if got.highest.is_some_and(|h| probe.n < h) {
            got.behind += 1;
        }
        got.highest = got.highest.max(Some(probe.n));
    }
}

/// A pilot ID's first 4 bytes, enough to tell two apart in a line.
fn short(pilot: &PilotId) -> String {
    pilot[..4].iter().map(|b| format!("{b:02x}")).collect()
}
