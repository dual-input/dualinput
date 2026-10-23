//! The droplet's test unit. It stands in for the session crate, opening the session from the
//! droplet's config with no backend, and for v1's features, sending p06's busy mix on a channel
//! for each and noting when each probe came (record/areas/network/log.md, 2026-10-11, p06's
//! entry). The bench's own test unit has one channel of each delivery; this one has a channel
//! for each of the mix's parts, so a newest-only slot of one part never replaces another's.

use std::collections::BTreeMap;
use std::time::Duration;

use clients::Clients;
use kernel::{Cx, Exit, Job, JobId, Registry, TimerId};
use messages::backend::Kind;
use messages::bench::Probe;
use messages::net::{Channel, Delivery, EndpointId, PilotId, Relay};
use network::{LinkLost, LinkUp, Me, Member, NetUnit, Opened, Sender, To};
use serde::{Deserialize, Serialize};

/// The start file the edge hands the unit, in place of the session file and the backend's
/// answer.
pub const CONFIG: &str = "droplet.json";
/// What the unit writes once its mix is over, for tools/bench/droplet/report.ts.
const RESULTS: &str = "probes.json";

/// Every first message names this code, which both ends share.
const CODE: &str = "DROPLET";

/// iroh first connects through the relay, then moves to the direct path once it finds one,
/// so the mix starts this long after the link comes up, and the report refuses a run whose
/// path wasn't direct from the mix's start.
const WARM_UP: Duration = Duration::from_secs(5);
/// After the mix, for what's still on its way.
const DRAIN: Duration = Duration::from_secs(5);

/// A probe's postcard bytes besides its padding: its number, send stamp, deadline, and the
/// padding's length, within a few bytes, so a part's probes come to about p06's sizes.
const PROBE_HEAD: u32 = 12;
/// How long an audio probe may wait to go, as the bench's test unit gives its deadline probes.
const AUDIO_DEADLINE: u64 = 300_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Role {
    Listen,
    Dial,
}

#[derive(Serialize, Deserialize)]
pub struct Config {
    pub role: Role,
    pub pilot: PilotId,
    pub key: [u8; 32],
    pub relay_url: String,
    pub relay_token: String,
    /// The listener's pilot and endpoint IDs, which the dialer dials.
    pub peer: Option<(PilotId, EndpointId)>,
    pub secs: u64,
}

/// The session channel, which each connection's first message opens.
const SESSION: Channel<String> = Channel::new(1100, Delivery::Stream, u8::MAX);

/// One part of the mix: its channel, the end that sends it, and its probes' size and rate.
/// The sizes and rates are p06's busy mix; the priorities are this run's own, since each of
/// v1's channels takes its priority in the stage that builds its feature.
struct Part {
    name: &'static str,
    channel: Channel<Probe>,
    from: Role,
    bytes: u32,
    per_second: u32,
}

const FLIGHT: Channel<Probe> = Channel::new(1101, Delivery::Newest, 200);
const CONTROLS: Channel<Probe> = Channel::new(1102, Delivery::Newest, 200);
const AVATAR: Channel<Probe> = Channel::new(1103, Delivery::Newest, 120);
const BATCH: Channel<Probe> = Channel::new(1104, Delivery::Newest, 50);
const AUDIO: Channel<Probe> = Channel::new(1105, Delivery::Deadline, 150);
const COCKPIT: Channel<Probe> = Channel::new(1106, Delivery::Stream, 100);
/// The session's requests, which the listener answers on `REPLY` with the request itself, so
/// the dialer times each round trip on its own clock.
const REQUEST: Channel<Probe> = Channel::new(1107, Delivery::Stream, 110);
const REPLY: Channel<Probe> = Channel::new(1108, Delivery::Stream, 110);

const PARTS: [Part; 8] = [
    Part {
        name: "flight",
        channel: FLIGHT,
        from: Role::Dial,
        bytes: 130,
        per_second: 20,
    },
    Part {
        name: "controls",
        channel: CONTROLS,
        from: Role::Dial,
        bytes: 40,
        per_second: 20,
    },
    Part {
        name: "avatar",
        channel: AVATAR,
        from: Role::Dial,
        bytes: 121,
        per_second: 20,
    },
    Part {
        name: "avatar",
        channel: AVATAR,
        from: Role::Listen,
        bytes: 121,
        per_second: 20,
    },
    Part {
        name: "batch",
        channel: BATCH,
        from: Role::Dial,
        bytes: 945,
        per_second: 11,
    },
    Part {
        name: "audio",
        channel: AUDIO,
        from: Role::Dial,
        bytes: 70,
        per_second: 50,
    },
    Part {
        name: "cockpit",
        channel: COCKPIT,
        from: Role::Dial,
        bytes: 84,
        per_second: 20,
    },
    Part {
        name: "request",
        channel: REQUEST,
        from: Role::Dial,
        bytes: 64,
        per_second: 1,
    },
];

#[derive(Default)]
pub struct Mix {
    config: Option<Config>,
    /// When the mix started, once the link had been up for the warm-up.
    started: Option<u64>,
    over: bool,
    /// The part each sending timer is for, and when its next probe is due, so a timer that
    /// fires late pushes back no probe after it.
    sending: BTreeMap<TimerId, (usize, u64)>,
    sent: BTreeMap<&'static str, u32>,
    /// Each probe that came, by part: its number, its send stamp on the sender's clock, and
    /// when it came on this one's.
    got: BTreeMap<&'static str, Vec<(u32, u64, u64)>>,
    round_trips: Vec<u64>,
    /// Each time the link came up or was lost.
    links: Vec<(&'static str, u64)>,
}

#[derive(Serialize)]
struct Results<'a> {
    role: Role,
    started: Option<u64>,
    secs: u64,
    sent: &'a BTreeMap<&'static str, u32>,
    got: &'a BTreeMap<&'static str, Vec<(u32, u64, u64)>>,
    round_trips: &'a [u64],
    links: &'a [(&'static str, u64)],
}

impl Mix {
    pub fn register(r: &mut Registry) {
        let mut me = r.unit::<Mix>("droplet-mix");
        me.start_file(CONFIG, Mix::configured)
            .opener(SESSION, Mix::opened)
            .channel(SESSION, |_: &mut Mix, _, _: String, _| {})
            .channel(FLIGHT, |me: &mut Mix, _, p, cx| me.got("flight", p, cx))
            .channel(CONTROLS, |me: &mut Mix, _, p, cx| me.got("controls", p, cx))
            .channel(AVATAR, |me: &mut Mix, _, p, cx| me.got("avatar", p, cx))
            .channel(BATCH, |me: &mut Mix, _, p, cx| me.got("batch", p, cx))
            .channel(AUDIO, |me: &mut Mix, _, p, cx| me.got("audio", p, cx))
            .channel(COCKPIT, |me: &mut Mix, _, p, cx| me.got("cockpit", p, cx))
            .channel(REQUEST, Mix::request)
            .channel(REPLY, Mix::reply)
            .on::<LinkUp>(Mix::up)
            .on::<LinkLost>(|me: &mut Mix, _: &LinkLost, cx: &mut Cx| {
                me.links.push(("lost", cx.now()));
            });
    }

    /// Opens the session with the relay the listener runs, at the cap relays.toml gives our own.
    fn configured(me: &mut Mix, bytes: Option<&[u8]>, cx: &mut Cx) {
        let Some(config) = bytes.and_then(|b| serde_json::from_slice::<Config>(b).ok()) else {
            tracing::error!("the droplet's config didn't read");
            return cx.out(Exit);
        };
        let cap = cx
            .read::<Clients>()
            .setting_as::<Vec<Relay>>(network::RELAYS)
            .and_then(|relays| relays.first().map(|r| r.cap))
            .unwrap_or_default();
        network::open(
            cx,
            network::Open {
                code: CODE.into(),
                me: Me {
                    pilot: config.pilot,
                    name: format!("{:?}", config.role),
                    kind: Kind::Crew,
                },
                restart: 0,
                key: config.key,
                relays: vec![Relay {
                    url: config.relay_url.clone(),
                    token: config.relay_token.clone(),
                    cap,
                }],
                crew: config
                    .peer
                    .map(|(pilot, endpoint)| Member {
                        pilot,
                        restart: 0,
                        endpoint,
                    })
                    .into_iter()
                    .collect(),
            },
        );
        me.config = Some(config);
    }

    fn opened(me: &mut Mix, opened: Opened, cx: &mut Cx) {
        let name = me
            .config
            .as_ref()
            .map(|c| format!("{:?}", c.role))
            .unwrap_or_default();
        network::first(cx, opened, &name);
    }

    fn up(me: &mut Mix, _: &LinkUp, cx: &mut Cx) {
        me.links.push(("up", cx.now()));
        if me.links.iter().filter(|(what, _)| *what == "up").count() == 1 {
            cx.timer(WARM_UP, Mix::start);
        }
    }

    /// Starts each of this end's parts, and the timer that ends the mix.
    fn start(me: &mut Mix, _: TimerId, cx: &mut Cx) {
        let Some(config) = &me.config else { return };
        let (role, secs) = (config.role, config.secs);
        me.started = Some(cx.now());
        tracing::info!(secs, "the mix starts");
        for (part, _) in PARTS.iter().enumerate().filter(|(_, p)| p.from == role) {
            me.send(part, cx.now(), cx);
        }
        cx.timer(Duration::from_secs(secs), |me: &mut Mix, _, cx| {
            me.over = true;
            cx.timer(DRAIN, Mix::finish);
        });
    }

    /// Sends the part's next probe, and sets the timer for the one after.
    fn send(&mut self, part: usize, due: u64, cx: &Cx) {
        let Part {
            name,
            channel,
            bytes,
            per_second,
            ..
        } = PARTS[part];
        let n = self.sent.get(name).copied().unwrap_or_default();
        let now = cx.now();
        let probe = Probe {
            n,
            sent: now,
            deadline: (channel.delivery == Delivery::Deadline).then_some(now + AUDIO_DEADLINE),
            pad: vec![0; bytes.saturating_sub(PROBE_HEAD) as usize],
        };
        match channel.delivery {
            Delivery::Stream => network::send(cx, channel, To::Crew, &probe),
            _ => network::send_one_off(cx, channel, To::Crew, &probe),
        }
        self.sent.insert(name, n + 1);
        let next = due + 1_000_000 / u64::from(per_second);
        let timer = cx.timer(
            Duration::from_micros(next.saturating_sub(now)),
            |me: &mut Mix, id, cx| {
                if let Some((part, due)) = me.sending.remove(&id)
                    && !me.over
                {
                    me.send(part, due, cx);
                }
            },
        );
        self.sending.insert(timer, (part, next));
    }

    fn got(&mut self, name: &'static str, probe: Probe, cx: &Cx) {
        self.got
            .entry(name)
            .or_default()
            .push((probe.n, probe.sent, cx.now()));
    }

    fn request(me: &mut Mix, _: Sender, probe: Probe, cx: &mut Cx) {
        network::send(cx, REPLY, To::Crew, &probe);
        me.got("request", probe, cx);
    }

    fn reply(me: &mut Mix, _: Sender, probe: Probe, cx: &mut Cx) {
        me.round_trips.push(cx.now().saturating_sub(probe.sent));
    }

    fn finish(me: &mut Mix, _: TimerId, cx: &mut Cx) {
        let Some(config) = &me.config else { return };
        let results = Results {
            role: config.role,
            started: me.started,
            secs: config.secs,
            sent: &me.sent,
            got: &me.got,
            round_trips: &me.round_trips,
            links: &me.links,
        };
        let bytes = serde_json::to_vec(&results).expect("serde_json should write the results");
        cx.job(Job::write(RESULTS, bytes), Mix::written);
    }

    fn written(_: &mut Mix, _: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
        if let Err(error) = result {
            tracing::error!(error, "the droplet's results didn't write");
        }
        network::leave(cx, true);
        cx.out(Exit);
    }
}
