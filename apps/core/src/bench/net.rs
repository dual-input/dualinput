//! The test unit that stands in for the session crate, hosting, joining, and opening the
//! session with what the backend answers, and for a feature with a channel of each delivery.
//! It keeps its session in `bench-session.json`, as the session crate keeps its session file,
//! so a core killed and started again opens under a higher restart count, and tells the bench
//! what happens as lines of text (record/areas/build/plan.md, "7 The network").

use std::collections::BTreeMap;
use std::time::Duration;

use clients::Clients;
use kernel::{Cx, Input, Job, JobId, Registry, TimerId};
use messages::backend::Kind;
use messages::bench::{DEADLINE, Delivery, NEWEST, NetAct, Probe, SESSION, STREAM, ToCore};
use messages::net::{Channel, EndpointId, PilotId, Relay};
use network::{
    Answer, Asked, BackendAnswered, LinkLost, LinkUp, Me, Member, MemberLeft, MemberOut, NetUnit,
    Network, Opened, Sender, To,
};
use serde::{Deserialize, Serialize};

use super::sim::Heard;

/// Names the source the bench's lines for this unit come in under.
pub struct Acts;

const SESSION_FILE: &str = "bench-session.json";

/// What the session file keeps: enough to open the session again after a restart.
#[derive(Clone, Serialize, Deserialize)]
struct Saved {
    code: String,
    pilot: PilotId,
    name: String,
    restart: u32,
    key: [u8; 32],
    relays: Vec<Relay>,
    crew: Vec<(PilotId, EndpointId)>,
}

#[derive(Default)]
pub struct BenchNet {
    me: Option<Me>,
    /// The code a join looked up, which opens the session once the backend finds it.
    joining: Option<String>,
    saved: Option<Saved>,
    /// A sender for each delivery a scenario asked for, by the delivery's number, and the
    /// delivery each of their timers is for.
    sending: BTreeMap<u8, Sending>,
    timers: BTreeMap<TimerId, u8>,
    got: BTreeMap<u16, Got>,
    /// Each member's restart count, as its latest `LinkUp` gave it.
    members: BTreeMap<PilotId, u32>,
    /// Whether first messages stay unsent.
    silent: bool,
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
        me.start_file(SESSION_FILE, BenchNet::session_file)
            .opener(SESSION, BenchNet::opened)
            .channel(SESSION, BenchNet::keys)
            .channel(STREAM, |me: &mut BenchNet, _, p, cx| me.got(STREAM, p, cx))
            .channel(NEWEST, |me: &mut BenchNet, _, p, cx| me.got(NEWEST, p, cx))
            .channel(DEADLINE, |me: &mut BenchNet, _, p, cx| {
                me.got(DEADLINE, p, cx)
            })
            .on::<BackendAnswered>(BenchNet::answered)
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

    /// A session file from before a restart opens the session again, one restart higher.
    fn session_file(me: &mut BenchNet, bytes: Option<&[u8]>, cx: &mut Cx) {
        let Some(mut saved) = bytes.and_then(|b| serde_json::from_slice::<Saved>(b).ok()) else {
            return;
        };
        saved.restart += 1;
        me.me = Some(Me {
            pilot: saved.pilot,
            name: saved.name.clone(),
            kind: Kind::Crew,
        });
        cx.out(Heard(format!("net restarted restart={}", saved.restart)));
        me.open(saved, cx);
    }

    fn act(me: &mut BenchNet, input: &Input, cx: &mut Cx) {
        let Ok(ToCore::Net { act }) = serde_json::from_slice(&input.bytes) else {
            tracing::warn!("a line for the network's test unit isn't one of its acts");
            return;
        };
        match act {
            NetAct::Host { name } => {
                let my = me.me(name, cx);
                let session = cx.new_id().to_string();
                network::host(cx, network::Host { session, me: my });
            }
            NetAct::Join {
                code,
                name,
                open_as,
            } => {
                let my = me.me(name, cx);
                me.joining = Some(open_as.unwrap_or_else(|| code.clone()));
                network::join(cx, network::Join { code, me: my });
            }
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
            NetAct::First { send } => me.silent = !send,
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
            NetAct::Leave { quit } => {
                me.saved = None;
                cx.job(Job::write(SESSION_FILE, Vec::new()), BenchNet::wrote);
                network::leave(cx, quit);
            }
        }
    }

    fn me(&mut self, name: String, cx: &Cx) -> Me {
        let me = Me {
            pilot: cx.random_bytes::<16>(),
            name,
            kind: Kind::Crew,
        };
        self.me = Some(me.clone());
        me
    }

    fn answered(me: &mut BenchNet, answered: &BackendAnswered, cx: &mut Cx) {
        let asked = match answered.asked {
            Asked::Host => "host",
            Asked::Join => "join",
            Asked::Check => "check",
        };
        match &answered.answer {
            Answer::Created { code } => {
                cx.out(Heard(format!("net {asked} code {code}")));
                let relays = cx
                    .read::<Clients>()
                    .setting_as::<Vec<Relay>>(network::RELAYS)
                    .unwrap_or_default();
                me.open_new(code.clone(), relays, Vec::new(), cx);
            }
            Answer::Found { relays, crew, .. } => {
                cx.out(Heard(format!("net {asked} found {}", crew.len())));
                if let (Asked::Join, Some(code)) = (answered.asked, me.joining.take()) {
                    let mine = me.me.as_ref().map(|m| m.pilot);
                    let crew = crew
                        .iter()
                        .filter_map(network::member)
                        .filter(|m| Some(m.pilot) != mine)
                        .map(|m| (m.pilot, m.endpoint))
                        .collect();
                    me.open_new(code, relays.clone(), crew, cx);
                }
            }
            Answer::Refused(why) => cx.out(Heard(format!("net {asked} refused {why:?}"))),
            Answer::NoAnswer(why) => cx.out(Heard(format!("net {asked} no-answer {why}"))),
        }
    }

    fn open_new(
        &mut self,
        code: String,
        relays: Vec<Relay>,
        crew: Vec<(PilotId, EndpointId)>,
        cx: &Cx,
    ) {
        let (Some(my), Some(key)) = (self.me.clone(), cx.read::<Network>().key()) else {
            return tracing::error!("the backend answered with no join or host asked");
        };
        let saved = Saved {
            code,
            pilot: my.pilot,
            name: my.name,
            restart: 0,
            key,
            relays,
            crew,
        };
        self.open(saved, cx);
    }

    /// Writes the session file, then opens the session, as the session crate does.
    fn open(&mut self, saved: Saved, cx: &Cx) {
        let bytes = serde_json::to_vec(&saved).expect("serde_json should write the session file");
        cx.job(Job::write(SESSION_FILE, bytes), BenchNet::wrote);
        let Some(my) = self.me.clone() else { return };
        network::open(
            cx,
            network::Open {
                code: saved.code.clone(),
                me: my,
                restart: saved.restart,
                key: saved.key,
                relays: saved.relays.clone(),
                crew: saved
                    .crew
                    .iter()
                    .map(|&(pilot, endpoint)| Member {
                        pilot,
                        restart: 0,
                        endpoint,
                    })
                    .collect(),
            },
        );
        self.saved = Some(saved);
    }

    fn wrote(_: &mut BenchNet, _: JobId, result: Result<Vec<u8>, String>, _: &mut Cx) {
        if let Err(error) = result {
            tracing::error!(error, "the bench's session file didn't write");
        }
    }

    fn opened(me: &mut BenchNet, opened: Opened, cx: &mut Cx) {
        if me.silent {
            return;
        }
        let name = me.me.as_ref().map(|m| m.name.clone()).unwrap_or_default();
        network::first(cx, opened, &name);
    }

    fn keys(_: &mut BenchNet, _: Sender, name: String, cx: &mut Cx) {
        cx.out(Heard(format!("net keys {name}")));
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
