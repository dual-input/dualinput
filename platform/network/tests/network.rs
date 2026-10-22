//! The network crate driven through the kernel as the core's edge drives it: the transport's
//! events go in, and its commands come out (record/areas/network/02-units.md, "Links", "The
//! first message", and "The heartbeat and clock offsets").

use std::collections::BTreeMap;

use kernel::{
    CancelTimer, Cx, FIRST, Input, Kernel, Output, Registry, SetTimer, SourceId, TIMERS, TimerId,
    first_input,
};
use messages::net::{
    Channel, Command, Delivery, EndpointId, Event, HEARTBEAT, Header, Heartbeat, PilotId, codes,
};
use network::{LinkLost, LinkUp, Member, MemberLeft, NetUnit, Opened, Sender, To};
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
    Send(u32),
    Leave,
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
        .on::<MemberLeft>(|_: &mut Session, _: &MemberLeft, cx: &mut Cx| {
            cx.out(Saw("left".into()))
        });
    }

    fn act(_: &mut Session, input: &Input, cx: &mut Cx) {
        match postcard::from_bytes(&input.bytes).unwrap() {
            Act::Open { crew } => network::open(
                cx,
                network::Open {
                    code: "ABC123".into(),
                    pilot: ME,
                    restart: 0,
                    key: [9; 32],
                    relays: Vec::new(),
                    crew: crew
                        .into_iter()
                        .map(|(pilot, restart, endpoint)| Member {
                            pilot,
                            restart,
                            endpoint,
                        })
                        .collect(),
                    ip: false,
                },
            ),
            Act::Send(n) => network::send(cx, DATA, To::Crew, &n),
            Act::Leave => network::leave(cx, false),
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

const SECOND: u64 = 1_000_000;

struct Core {
    kernel: Kernel,
    transport: SourceId,
    acts: SourceId,
    seq: u64,
    now: u64,
    timers: BTreeMap<(u64, TimerId), ()>,
    commands: Vec<Command>,
    saw: Vec<String>,
}

impl Core {
    fn new() -> Core {
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
            saw: Vec::new(),
        };
        core.handle(
            FIRST,
            first_input([1; 32], vec![("settings.json".into(), None)]),
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
        let header = Header {
            version: messages::VERSION.into(),
            hash: messages::HASH.into(),
            code: code.into(),
            pilot: THEM,
            restart,
        };
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
    assert!(matches!(commands[0], Command::Bind { ip: false, .. }));
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
fn a_connection_with_no_first_message_closes_after_10s() {
    let mut core = Core::new();
    core.act(Act::Open { crew: Vec::new() });
    core.event(Event::Connected {
        conn: 1,
        endpoint: [7; 32],
        dialed: false,
    });
    core.take();
    core.advance(core.now + 10 * SECOND);
    assert!(core.take().0.contains(&Command::Close {
        conn: 1,
        code: codes::NO_FIRST_MESSAGE
    }));
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

    let mut core = Core::new();
    core.linked(1, [7; 32]);
    core.take();
    core.event(Event::Closed {
        conn: 1,
        code: Ok(0),
    });
    assert_eq!(core.take().1, ["lost"]);
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
