//! The network crate driven through the kernel as the core's edge drives it: the transport's
//! events go in, and its commands come out (record/areas/network/02-units.md, "Links", "The
//! first message", and "The heartbeat and clock offsets").

use std::collections::BTreeMap;

use kernel::{
    CancelTimer, Cx, FIRST, Fetched, Input, JOBS, Kernel, Output, Registry, SetTimer, SourceId,
    StartJob, TIMERS, TimerId, Work, first_input,
};
use messages::backend::{Kind, NewSession};
use messages::net::{
    Channel, Command, Delivery, EndpointId, Event, HEARTBEAT, Header, Heartbeat, PilotId, Relay,
    codes,
};
use network::{
    BackendAnswered, LinkLost, LinkUp, Me, Member, MemberLeft, MemberOut, NetUnit, Network, Opened,
    Sender, To,
};
use serde::{Deserialize, Serialize};

const SESSION: Channel<String> = Channel::new(100, Delivery::Stream, u8::MAX);
const DATA: Channel<u32> = Channel::new(101, Delivery::Stream, 10);

const ME: PilotId = [1; 16];
const THEM: PilotId = [2; 16];
const MY_ENDPOINT: EndpointId = [5; 32];

#[derive(Serialize, Deserialize)]
enum Act {
    Open {
        crew: Vec<(PilotId, u32, EndpointId)>,
    },
    /// Opens as `Open` does, with one relay in the session's list.
    OpenRelayed {
        crew: Vec<(PilotId, u32, EndpointId)>,
    },
    Send(u32),
    Leave,
    Quit,
    Host,
    Join(String),
    /// Says whether the PC reaches the internet, and whether the refused notice is up.
    Peek,
    /// Opens with no crew under this code.
    OpenAs(String),
}

fn me() -> Me {
    Me {
        pilot: ME,
        name: "Pilot".into(),
        kind: Kind::Crew,
    }
}

/// What the test unit saw, put out so the test reads it.
#[derive(Serialize, Debug, PartialEq, Eq)]
struct Saw(String);

/// Stands in for the session crate, and for a feature with a channel.
#[derive(Default)]
struct Session;

struct Acts;

impl Session {
    fn register(r: &mut Registry) {
        let mut me = r.unit::<Session>("session");
        me.source::<Acts>(Session::act);
        me.opener(SESSION, Session::open)
            .channel(SESSION, Session::keys)
            .channel(DATA, Session::data);
        me.on::<LinkUp>(|_: &mut Session, up: &LinkUp, cx: &mut Cx| {
            cx.out(Saw(format!(
                "up again={} restart={}",
                up.again, up.member.restart
            )))
        })
        .on::<LinkLost>(|_: &mut Session, _: &LinkLost, cx: &mut Cx| cx.out(Saw("lost".into())))
        .on::<MemberLeft>(|_: &mut Session, _: &MemberLeft, cx: &mut Cx| cx.out(Saw("left".into())))
        .on::<MemberOut>(|_: &mut Session, _: &MemberOut, cx: &mut Cx| cx.out(Saw("out".into())))
        .on::<BackendAnswered>(|_: &mut Session, a: &BackendAnswered, cx: &mut Cx| {
            cx.out(Saw(format!("answered {:?} {:?}", a.asked, a.answer)))
        });
    }

    fn act(_: &mut Session, input: &Input, cx: &mut Cx) {
        match postcard::from_bytes(&input.bytes).unwrap() {
            Act::Open { crew } => open(cx, crew, Vec::new()),
            Act::OpenRelayed { crew } => open(
                cx,
                crew,
                vec![Relay {
                    url: "http://relay.test/".into(),
                    token: "t".into(),
                    cap: 0,
                }],
            ),
            Act::Send(n) => network::send(cx, DATA, To::Crew, &n),
            Act::Leave => network::leave(cx, false),
            Act::Quit => network::leave(cx, true),
            Act::OpenAs(code) => network::open(
                cx,
                network::Open {
                    code,
                    me: me(),
                    restart: 0,
                    key: [9; 32],
                    relays: Vec::new(),
                    crew: Vec::new(),
                },
            ),
            Act::Peek => {
                let internet = cx.read::<Network>().internet();
                let refused = cx
                    .read::<clients::Clients>()
                    .notice_up("network.refused")
                    .is_some();
                cx.out(Saw(format!("internet={internet:?} refused={refused}")));
            }
            Act::Host => network::host(
                cx,
                network::Host {
                    session: "5d0c6a8e-2b3f-4c1d-9e7a-0f1b2c3d4e5f".into(),
                    me: me(),
                },
            ),
            Act::Join(code) => network::join(cx, network::Join { code, me: me() }),
        }
    }

    fn open(_: &mut Session, opened: Opened, cx: &mut Cx) {
        network::first(cx, opened, &"my keys".to_string());
    }

    fn keys(_: &mut Session, _: Sender, keys: String, cx: &mut Cx) {
        cx.out(Saw(format!("keys {keys}")));
    }

    fn data(_: &mut Session, _: Sender, n: u32, cx: &mut Cx) {
        cx.out(Saw(format!("data {n}")));
    }
}

fn open(cx: &Cx, crew: Vec<(PilotId, u32, EndpointId)>, relays: Vec<Relay>) {
    network::open(
        cx,
        network::Open {
            code: "ABC123".into(),
            me: me(),
            restart: 0,
            key: [9; 32],
            relays,
            crew: crew
                .into_iter()
                .map(|(pilot, restart, endpoint)| Member {
                    pilot,
                    restart,
                    endpoint,
                })
                .collect(),
        },
    );
}

const SECOND: u64 = 1_000_000;

struct Core {
    kernel: Kernel,
    transport: SourceId,
    acts: SourceId,
    seq: u64,
    now: u64,
    timers: BTreeMap<(u64, TimerId), ()>,
    commands: Vec<Command>,
    jobs: Vec<StartJob>,
    saw: Vec<String>,
}

impl Core {
    fn new() -> Core {
        Core::with_settings(None)
    }

    /// A core whose `settings.json` holds `settings`.
    fn with_settings(settings: Option<&str>) -> Core {
        let mut registry = Registry::new();
        clients::register(&mut registry);
        network::register(&mut registry);
        Session::register(&mut registry);
        let kernel = Kernel::new(registry);
        let transport = kernel.source::<network::Transport>().unwrap();
        let acts = kernel.source::<Acts>().unwrap();
        let mut core = Core {
            kernel,
            transport,
            acts,
            seq: 0,
            now: SECOND,
            timers: BTreeMap::new(),
            commands: Vec::new(),
            jobs: Vec::new(),
            saw: Vec::new(),
        };
        core.handle(
            FIRST,
            first_input(
                [1; 32],
                vec![(
                    "settings.json".into(),
                    settings.map(|s| s.as_bytes().to_vec()),
                )],
            ),
        );
        core
    }

    fn handle(&mut self, source: SourceId, bytes: Vec<u8>) {
        self.seq += 1;
        let outputs = self.kernel.handle(&Input {
            seq: self.seq,
            stamp: self.now,
            source,
            bytes,
        });
        self.carry(outputs);
    }

    fn carry(&mut self, outputs: Vec<Output>) {
        for output in outputs {
            let value = output.into_value();
            let value = match value.downcast::<SetTimer>() {
                Ok(set) => {
                    self.timers.insert((set.due, set.id), ());
                    continue;
                }
                Err(value) => value,
            };
            let value = match value.downcast::<CancelTimer>() {
                Ok(cancel) => {
                    self.timers.retain(|(_, id), _| *id != cancel.id);
                    continue;
                }
                Err(value) => value,
            };
            let value = match value.downcast::<StartJob>() {
                Ok(job) => {
                    self.jobs.push(*job);
                    continue;
                }
                Err(value) => value,
            };
            let value = match value.downcast::<Command>() {
                Ok(command) => {
                    self.commands.push(*command);
                    continue;
                }
                Err(value) => value,
            };
            if let Ok(saw) = value.downcast::<Saw>() {
                self.saw.push(saw.0);
            }
        }
    }

    fn act(&mut self, act: Act) {
        self.handle(self.acts, postcard::to_stdvec(&act).unwrap());
    }

    /// The fetch jobs started since the last call, as each one's method, URL, and job.
    fn fetches(&mut self) -> Vec<(String, StartJob)> {
        std::mem::take(&mut self.jobs)
            .into_iter()
            .map(|job| match &job.job.work {
                Work::Fetch(f) => (format!("{:?} {}", f.method, f.url), job),
                other => panic!("only fetches should start: {other:?}"),
            })
            .collect()
    }

    fn answer(&mut self, job: &StartJob, status: u16, body: &str) {
        let fetched = Fetched {
            status,
            headers: Vec::new(),
            body: body.as_bytes().to_vec(),
        };
        self.handle(JOBS, job.id.finished(Ok(fetched.encode())));
    }

    fn event(&mut self, event: Event) {
        self.handle(self.transport, network::encode_event(&event));
    }

    /// Moves the clock to `to`, firing each timer due by then, in order.
    fn advance(&mut self, to: u64) {
        while let Some(&(due, id)) = self.timers.keys().next().filter(|(due, _)| *due <= to) {
            self.timers.remove(&(due, id));
            self.now = due;
            self.handle(TIMERS, id.fired());
        }
        self.now = to;
    }

    fn take(&mut self) -> (Vec<Command>, Vec<String>) {
        (
            std::mem::take(&mut self.commands),
            std::mem::take(&mut self.saw),
        )
    }

    /// The other core's first message on `conn`, as its stream's bytes.
    fn their_first(&mut self, conn: u64, restart: u32, code: &str) {
        self.their_header(
            conn,
            Header {
                version: messages::VERSION.into(),
                hash: messages::HASH.into(),
                code: code.into(),
                pilot: THEM,
                restart,
            },
        );
    }

    /// The other core's first message on `conn`, under `header`.
    fn their_header(&mut self, conn: u64, header: Header) {
        let mut bytes = postcard::to_stdvec(&header).unwrap();
        bytes.extend(postcard::to_stdvec(&"their keys".to_string()).unwrap());
        self.event(Event::Stream {
            conn,
            channel: SESSION.number,
            bytes: framed(&bytes),
        });
    }

    /// Opens the session with the other pilot in its crew, binds, and has `conn` connect,
    /// this side dialing, with both first messages passing.
    fn linked(&mut self, conn: u64, them: EndpointId) {
        self.act(Act::Open {
            crew: vec![(THEM, 0, them)],
        });
        self.event(Event::Bound(Ok(MY_ENDPOINT)));
        self.event(Event::Connected {
            conn,
            endpoint: them,
            dialed: true,
        });
        self.their_first(conn, 0, "ABC123");
    }
}

fn framed(bytes: &[u8]) -> Vec<u8> {
    let mut framed = (bytes.len() as u32).to_le_bytes().to_vec();
    framed.extend(bytes);
    framed
}

#[test]
fn a_connection_whose_first_message_passes_links_and_hands_on_what_waited_behind_it() {
    let mut core = Core::new();
    core.act(Act::Open {
        crew: vec![(THEM, 0, [7; 32])],
    });
    let (commands, _) = core.take();
    assert!(matches!(commands[0], Command::Bind { ip: true, .. }));
    core.event(Event::Bound(Ok(MY_ENDPOINT)));
    let (commands, _) = core.take();
    assert_eq!(commands, [Command::Dial { endpoint: [7; 32] }]);

    core.event(Event::Connected {
        conn: 1,
        endpoint: [7; 32],
        dialed: true,
    });
    let (commands, _) = core.take();
    let Command::Stream { channel, bytes, .. } = &commands[0] else {
        panic!("the first message should go out: {commands:?}")
    };
    assert_eq!(*channel, SESSION.number);
    let (header, keys) = postcard::take_from_bytes::<Header>(&bytes[4..]).unwrap();
    assert_eq!((header.code.as_str(), header.pilot), ("ABC123", ME));
    assert_eq!(postcard::from_bytes::<String>(keys).unwrap(), "my keys");

    // A data message and a one-off packet arrive before the first message: the one waits,
    // and the other is dropped.
    core.event(Event::Stream {
        conn: 1,
        channel: DATA.number,
        bytes: framed(&postcard::to_stdvec(&7u32).unwrap()),
    });
    core.event(Event::OneOff {
        conn: 1,
        channel: DATA.number,
        bytes: postcard::to_stdvec(&8u32).unwrap(),
    });
    assert_eq!(core.take().1, Vec::<String>::new());
    core.their_first(1, 0, "ABC123");
    assert_eq!(
        core.take().1,
        ["up again=false restart=0", "keys their keys", "data 7"]
    );

    core.act(Act::Send(3));
    let (commands, _) = core.take();
    assert_eq!(
        commands,
        [Command::Stream {
            conn: 1,
            channel: DATA.number,
            priority: DATA.priority,
            bytes: framed(&postcard::to_stdvec(&3u32).unwrap())
        }]
    );
}

#[test]
fn a_first_message_with_another_code_is_refused_with_its_code() {
    let mut core = Core::new();
    core.act(Act::Open { crew: Vec::new() });
    core.event(Event::Bound(Ok(MY_ENDPOINT)));
    core.event(Event::Connected {
        conn: 1,
        endpoint: [7; 32],
        dialed: false,
    });
    core.take();
    core.their_first(1, 0, "ZZZ999");
    let (commands, saw) = core.take();
    assert!(commands.contains(&Command::Close {
        conn: 1,
        code: codes::WRONG_CODE
    }));
    assert!(saw.is_empty());
}

#[test]
fn a_link_with_nothing_for_5s_is_lost_redials_every_2s_and_comes_back_again() {
    let mut core = Core::new();
    core.linked(1, [7; 32]);
    core.take();
    let start = core.now;
    // Something every 4s keeps the link up.
    for n in 1..=3 {
        core.advance(start + n * 4 * SECOND);
        core.event(Event::Stream {
            conn: 1,
            channel: DATA.number,
            bytes: framed(&postcard::to_stdvec(&n).unwrap()),
        });
    }
    assert!(!core.take().1.contains(&"lost".to_string()));
    let quiet = core.now;
    core.advance(quiet + 5 * SECOND);
    let (commands, saw) = core.take();
    assert_eq!(saw, ["lost"]);
    assert!(commands.contains(&Command::Close {
        conn: 1,
        code: codes::LOST
    }));
    assert!(commands.contains(&Command::Dial { endpoint: [7; 32] }));
    core.advance(core.now + 4 * SECOND);
    let dials = core
        .take()
        .0
        .iter()
        .filter(|c| matches!(c, Command::Dial { .. }))
        .count();
    assert_eq!(dials, 2, "a dial every 2s while lost");

    core.event(Event::Connected {
        conn: 2,
        endpoint: [7; 32],
        dialed: true,
    });
    core.their_first(2, 0, "ABC123");
    assert_eq!(core.take().1[0], "up again=true restart=0");
}

#[test]
fn a_higher_restart_count_ends_the_old_link_without_a_loss_and_comes_up_not_again() {
    let mut core = Core::new();
    core.linked(1, [7; 32]);
    core.take();
    core.event(Event::Connected {
        conn: 2,
        endpoint: [7; 32],
        dialed: false,
    });
    core.their_first(2, 1, "ABC123");
    let (commands, saw) = core.take();
    assert!(commands.contains(&Command::Close {
        conn: 1,
        code: codes::RESTARTED
    }));
    assert_eq!(saw[0], "up again=false restart=1");
    assert!(!saw.contains(&"lost".to_string()));
}

#[test]
fn of_two_connections_from_one_restart_the_one_the_lower_endpoint_id_dialed_stays() {
    // This core's endpoint is the lower, so the connection it dialed stays.
    let mut core = Core::new();
    core.linked(1, [7; 32]);
    core.event(Event::Connected {
        conn: 2,
        endpoint: [7; 32],
        dialed: false,
    });
    core.take();
    core.their_first(2, 0, "ABC123");
    let (commands, saw) = core.take();
    assert!(commands.contains(&Command::Close {
        conn: 2,
        code: codes::OTHER_STAYS
    }));
    assert!(saw.is_empty(), "the link keeps its connection: {saw:?}");

    // Here the other's endpoint is the lower, so the connection it dialed stays.
    let mut core = Core::new();
    core.linked(1, [0; 32]);
    core.event(Event::Connected {
        conn: 2,
        endpoint: [0; 32],
        dialed: false,
    });
    core.take();
    core.their_first(2, 0, "ABC123");
    let (commands, saw) = core.take();
    assert!(commands.contains(&Command::Close {
        conn: 1,
        code: codes::OTHER_STAYS
    }));
    assert_eq!(saw[0], "up again=true restart=0");
}

#[test]
fn a_close_with_leaves_code_is_a_leave_and_any_other_a_lost_link() {
    let mut core = Core::new();
    core.linked(1, [7; 32]);
    core.take();
    core.event(Event::Closed {
        conn: 1,
        code: Ok(codes::LEAVE),
    });
    assert_eq!(core.take().1, ["left"]);
    // A lost link redials every 2s, and a leave never does.
    let dials = |core: &mut Core| {
        core.advance(core.now + 4 * SECOND);
        core.take()
            .0
            .iter()
            .filter(|c| matches!(c, Command::Dial { .. }))
            .count()
    };
    assert_eq!(dials(&mut core), 0, "a dial after a leave");

    let mut core = Core::new();
    core.linked(1, [7; 32]);
    core.take();
    core.event(Event::Closed {
        conn: 1,
        code: Ok(0),
    });
    assert_eq!(core.take().1, ["lost"]);
    assert!(dials(&mut core) > 0, "no dial after a lost link");
}

#[test]
fn heartbeats_go_out_every_second_and_their_exchanges_give_the_others_clock_offset() {
    let mut core = Core::new();
    core.linked(1, [7; 32]);
    core.take();
    core.advance(core.now + SECOND);
    let (commands, _) = core.take();
    let Some(Command::OneOff {
        bytes, stamp: true, ..
    }) = commands
        .iter()
        .find(|c| matches!(c, Command::OneOff { .. }))
    else {
        panic!("a heartbeat should go out: {commands:?}")
    };
    assert_eq!(
        postcard::from_bytes::<Heartbeat>(bytes).unwrap(),
        Heartbeat::default()
    );

    // The other's counter runs 1,000µs ahead, and each way takes 100µs: its heartbeat echoes
    // one this core sent at `sent`, and was itself sent 100µs before it arrives here.
    let sent = core.now;
    core.now += 300;
    let echo = Heartbeat {
        echo_sent: sent,
        echo_received: sent + 1_100,
    };
    let mut bytes = postcard::to_stdvec(&echo).unwrap();
    bytes.extend((sent + 1_200).to_le_bytes());
    core.event(Event::OneOff {
        conn: 1,
        channel: HEARTBEAT.number,
        bytes,
    });
    core.advance(core.now + SECOND);
    let (commands, _) = core.take();
    let Some(Command::OneOff { bytes, .. }) = commands
        .iter()
        .find(|c| matches!(c, Command::OneOff { .. }))
    else {
        panic!("a heartbeat should go out")
    };
    assert_eq!(
        postcard::from_bytes::<Heartbeat>(bytes).unwrap(),
        Heartbeat {
            echo_sent: sent + 1_200,
            echo_received: sent + 300
        },
        "the next heartbeat echoes the one received"
    );
}

/// A Host goes to the backend signed by a fresh endpoint key, whose public half its entry
/// names, and the code comes back in `BackendAnswered` (record/areas/network/02-units.md,
/// "Requests the session crate makes").
#[test]
fn a_host_asks_for_a_code_signed_by_its_endpoint_key() {
    use ed25519_dalek::{Signature, VerifyingKey};

    let mut core = Core::new();
    core.act(Act::Host);
    let fetches = core.fetches();
    let [(what, job)] = &fetches[..] else {
        panic!("one fetch should start: {fetches:?}")
    };
    assert_eq!(what, "Post https://api.dualinput.app/v1/sessions");
    let Work::Fetch(fetch) = &job.job.work else {
        unreachable!()
    };
    let header = |name: &str| {
        fetch
            .headers
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.clone())
            .unwrap()
    };
    let unhex = |s: String| -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    };
    let endpoint: [u8; 32] = unhex(header("DualInput-Endpoint")).try_into().unwrap();
    let signature: [u8; 64] = unhex(header("DualInput-Signature")).try_into().unwrap();
    VerifyingKey::from_bytes(&endpoint)
        .unwrap()
        .verify_strict(&fetch.body, &Signature::from_bytes(&signature))
        .expect("the signature should match the body");
    let body: NewSession = serde_json::from_slice(&fetch.body).unwrap();
    assert_eq!(body.host.endpoint, header("DualInput-Endpoint"));
    assert_eq!(body.host.pilot, "01".repeat(16));
    assert_eq!(body.version, messages::VERSION);

    let job = job.clone();
    core.answer(&job, 200, r#"{"code":"K7Q2XM"}"#);
    assert_eq!(
        core.take().1,
        [r#"answered Host Created { code: "K7Q2XM" }"#]
    );
}

#[test]
fn a_lookup_answers_with_the_session_or_why_not() {
    let mut core = Core::new();
    core.act(Act::Join("K7Q2XM".into()));
    let (what, job) = core.fetches().remove(0);
    assert_eq!(what, "Post https://api.dualinput.app/v1/lookup");
    core.answer(
        &job,
        200,
        r#"{"answer":"found","session":"s","relays":[{"url":"https://r","token":"t","cap":1}],
            "crew":[{"pilot":"02020202020202020202020202020202","name":"Them","kind":"crew",
            "endpoint":"0707070707070707070707070707070707070707070707070707070707070707"}]}"#,
    );
    let saw = core.take().1;
    assert!(saw[0].starts_with("answered Join Found"), "{saw:?}");

    core.act(Act::Join("K7Q2XN".into()));
    let (_, job) = core.fetches().remove(0);
    core.answer(&job, 200, r#"{"answer":"other-version","older":"mine"}"#);
    assert_eq!(core.take().1, ["answered Join Refused(OtherVersion(Mine))"]);

    core.act(Act::Join("K7Q2XP".into()));
    let (_, job) = core.fetches().remove(0);
    core.answer(&job, 403, r#"{"error":"the signature didn't match"}"#);
    assert_eq!(
        core.take().1,
        [r#"answered Join Refused(Other("the signature didn't match"))"#]
    );
}

#[test]
fn a_request_with_no_answer_in_10s_answers_no_answer() {
    let mut core = Core::new();
    core.act(Act::Join("K7Q2XM".into()));
    core.fetches();
    core.advance(core.now + 10 * SECOND);
    assert_eq!(
        core.take().1,
        [r#"answered Join NoAnswer("the backend didn't answer within 10s")"#]
    );
}

/// A joiner lists itself at its first `LinkUp`, renews every 10 minutes, and tells the
/// backend when it leaves.
#[test]
fn a_joiner_lists_itself_at_its_first_link_up_and_tells_the_backend_it_left() {
    let mut core = Core::new();
    core.linked(1, [7; 32]);
    let posted: Vec<String> = core.fetches().into_iter().map(|(w, _)| w).collect();
    assert_eq!(posted, ["Post https://api.dualinput.app/v1/members"]);
    core.advance(core.now + 600 * SECOND);
    let renewed: Vec<String> = core.fetches().into_iter().map(|(w, _)| w).collect();
    assert!(
        renewed.contains(&"Post https://api.dualinput.app/v1/members".to_string()),
        "{renewed:?}"
    );
    core.act(Act::Leave);
    let left: Vec<String> = core.fetches().into_iter().map(|(w, _)| w).collect();
    assert_eq!(left, ["Post https://api.dualinput.app/v1/members/leave"]);
}

/// A core back from a restart dials the crew in its session file, and looks the code up when
/// none answers within 10s (record/areas/network/01-between-machines.md, "A session file after
/// a long outage").
#[test]
fn a_core_whose_crew_doesnt_answer_in_10s_looks_the_code_up() {
    let mut core = Core::new();
    core.act(Act::Open {
        crew: vec![(THEM, 0, [7; 32])],
    });
    core.event(Event::Bound(Ok(MY_ENDPOINT)));
    core.advance(core.now + 10 * SECOND);
    let looked: Vec<String> = core.fetches().into_iter().map(|(w, _)| w).collect();
    assert_eq!(looked, ["Post https://api.dualinput.app/v1/lookup"]);
}

/// A first message from another release, or another build of this one, closes with the code
/// naming which (record/areas/network/02-units.md, "The first message").
#[test]
fn a_first_message_of_another_version_or_hash_is_refused_with_its_code() {
    for (conn, header, code) in [
        (
            1,
            Header {
                version: "0.0.1".into(),
                hash: messages::HASH.into(),
                code: "ABC123".into(),
                pilot: THEM,
                restart: 0,
            },
            codes::WRONG_VERSION,
        ),
        (
            2,
            Header {
                version: messages::VERSION.into(),
                hash: "0".repeat(64),
                code: "ABC123".into(),
                pilot: THEM,
                restart: 0,
            },
            codes::WRONG_HASH,
        ),
    ] {
        let mut core = Core::new();
        core.act(Act::Open { crew: Vec::new() });
        core.event(Event::Bound(Ok(MY_ENDPOINT)));
        core.event(Event::Connected {
            conn,
            endpoint: [7; 32],
            dialed: false,
        });
        core.take();
        core.their_header(conn, header);
        let (commands, saw) = core.take();
        assert_eq!(commands, [Command::Close { conn, code }]);
        assert!(saw.is_empty(), "nothing should link: {saw:?}");
    }
}

#[test]
fn a_member_with_no_connection_for_30_minutes_is_counted_out() {
    let mut core = Core::new();
    core.act(Act::Open {
        crew: vec![(THEM, 0, [7; 32])],
    });
    core.event(Event::Bound(Ok(MY_ENDPOINT)));
    core.advance(core.now + 30 * 60 * SECOND - 1);
    assert!(!core.take().1.contains(&"out".to_string()));
    core.advance(core.now + 1);
    assert!(core.take().1.contains(&"out".to_string()));
}

/// While a link is lost, each dial asks every relay for `/ping`: an answer means this PC
/// reaches the internet, and none within 2s means it doesn't (record/areas/network/02-units.md,
/// "What the pilot sees, and settings").
#[test]
fn a_dial_while_a_link_is_lost_checks_whether_the_internet_answers() {
    let mut core = Core::new();
    core.act(Act::OpenRelayed {
        crew: vec![(THEM, 0, [7; 32])],
    });
    core.event(Event::Bound(Ok(MY_ENDPOINT)));
    let pings: Vec<_> = core
        .fetches()
        .into_iter()
        .filter(|(w, _)| w.starts_with("Get"))
        .collect();
    let [(what, job)] = &pings[..] else {
        panic!("one ping should start: {pings:?}")
    };
    assert_eq!(what, "Get http://relay.test/ping");
    let job = job.clone();
    core.answer(&job, 200, "");
    core.act(Act::Peek);
    assert_eq!(core.take().1, ["internet=Some(true) refused=false"]);

    // The next dial, 2s on, checks again, and no answer within 2s means no internet.
    core.advance(core.now + 2 * SECOND);
    assert_eq!(
        core.fetches()
            .iter()
            .filter(|(w, _)| w.starts_with("Get"))
            .count(),
        1
    );
    core.advance(core.now + 2 * SECOND);
    core.act(Act::Peek);
    assert!(
        core.take()
            .1
            .contains(&"internet=Some(false) refused=false".to_string())
    );
}

#[test]
fn the_relays_only_setting_clears_the_endpoints_ip_transports() {
    let mut core = Core::with_settings(Some(r#"{"network.relays-only": true}"#));
    core.act(Act::Open { crew: Vec::new() });
    let (commands, _) = core.take();
    assert!(
        matches!(commands[0], Command::Bind { ip: false, .. }),
        "{commands:?}"
    );
}

/// A close can overtake the first message the other side sent before it, so a close with a
/// refusal's code shows the refusal even on a connection no link took.
#[test]
fn a_close_with_a_refusals_code_shows_the_refused_notice() {
    let mut core = Core::new();
    core.act(Act::Open {
        crew: vec![(THEM, 0, [7; 32])],
    });
    core.event(Event::Bound(Ok(MY_ENDPOINT)));
    core.event(Event::Connected {
        conn: 1,
        endpoint: [7; 32],
        dialed: true,
    });
    core.event(Event::Closed {
        conn: 1,
        code: Ok(codes::WRONG_CODE),
    });
    core.act(Act::Peek);
    assert!(
        core.take()
            .1
            .contains(&"internet=None refused=true".to_string())
    );
}

#[test]
fn a_quit_closes_each_connection_with_the_quit_code_and_shuts_the_endpoint() {
    let mut core = Core::new();
    core.linked(1, [7; 32]);
    core.take();
    core.act(Act::Quit);
    let (commands, _) = core.take();
    assert_eq!(
        commands,
        [
            Command::Close {
                conn: 1,
                code: codes::QUIT
            },
            Command::Shutdown
        ]
    );
}

/// A pilot may type a code in lower case, and the backend reads it upper-cased, so the lookup
/// and every first message carry it upper-cased.
#[test]
fn a_code_typed_in_lower_case_is_looked_up_and_sent_upper_cased() {
    let mut core = Core::new();
    core.act(Act::Join("abc123".into()));
    let (_, job) = core.fetches().remove(0);
    let Work::Fetch(fetch) = &job.job.work else {
        unreachable!()
    };
    assert!(String::from_utf8_lossy(&fetch.body).contains(r#""code":"ABC123""#));

    let mut core = Core::new();
    core.act(Act::OpenAs("abc123".into()));
    core.event(Event::Bound(Ok(MY_ENDPOINT)));
    core.event(Event::Connected {
        conn: 1,
        endpoint: [7; 32],
        dialed: true,
    });
    let (commands, _) = core.take();
    let Some(Command::Stream { bytes, .. }) = commands.last() else {
        panic!("the first message should go out: {commands:?}")
    };
    let (header, _) = postcard::take_from_bytes::<Header>(&bytes[4..]).unwrap();
    assert_eq!(header.code, "ABC123");
}

/// A member can leave before its first message passes, on a connection no link holds yet.
#[test]
fn a_leave_before_the_first_message_passes_is_still_a_leave() {
    let mut core = Core::new();
    core.act(Act::Open {
        crew: vec![(THEM, 0, [7; 32])],
    });
    core.event(Event::Bound(Ok(MY_ENDPOINT)));
    core.event(Event::Connected {
        conn: 1,
        endpoint: [7; 32],
        dialed: true,
    });
    core.take();
    core.event(Event::Closed {
        conn: 1,
        code: Ok(codes::LEAVE),
    });
    assert_eq!(core.take().1, ["left"]);
    // It stops dialing that member.
    core.advance(core.now + 10 * SECOND);
    assert!(
        !core
            .take()
            .0
            .iter()
            .any(|c| matches!(c, Command::Dial { .. }))
    );
}
