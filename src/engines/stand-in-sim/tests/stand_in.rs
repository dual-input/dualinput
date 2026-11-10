//! The stand-in hands up what the sim edge would, as a scenario acts on the sim: a watched
//! process found and its exit code, an open's result and the sim's open message, and the
//! losses and quit messages a scenario asks for, then an open that never answers. A `ping`
//! that runs for a minute stands for the sim's process, as the bench's stub does.

use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use sim_client::message::{Camera, Message};
use sim_client::{Connection, InitPosition, Op, SimCall, Tag, Up};
use stand_in_sim::{Act, Module, StandIn, World};

const S_OK: i32 = 0;
const E_FAIL: i32 = 0x8000_4005_u32 as i32;

/// A module with no slots, which writes nothing.
struct NoModule;

impl Module for NoModule {
    fn slots(&self) -> Vec<String> {
        Vec::new()
    }

    fn written(&mut self, _: &str, _: &[u8], _: u64) {}

    fn frame(&mut self, _: u64, _: &mut World) -> Vec<(String, Vec<u8>)> {
        Vec::new()
    }
}

fn started() -> (StandIn, mpsc::Receiver<Up>) {
    let (to, from) = mpsc::channel();
    let (stand_in, _) = StandIn::start(
        move |up| {
            let _ = to.send(up);
        },
        |_| {},
        Box::new(NoModule),
    )
    .unwrap();
    (stand_in, from)
}

fn next(from: &mpsc::Receiver<Up>) -> Up {
    from.recv_timeout(Duration::from_secs(5))
        .expect("the stand-in should hand up an input")
}

fn quiet(from: &mpsc::Receiver<Up>) {
    if let Ok(up) = from.recv_timeout(Duration::from_millis(200)) {
        panic!("the stand-in handed up {up:?}");
    }
}

/// The process that stands for the sim's, which ends when the test does.
struct Sim(Child);

impl Sim {
    fn start() -> Sim {
        let ping = Command::new("ping")
            .args(["-n", "60", "127.0.0.1"])
            .stdout(Stdio::null())
            .spawn()
            .expect("ping should start");
        Sim(ping)
    }

    fn id(&self) -> u32 {
        self.0.id()
    }

    /// Ends the process with 1, as a crash ends the sim with a code of its own.
    fn kill(&mut self) {
        self.0.kill().unwrap();
        self.0.wait().unwrap();
    }
}

impl Drop for Sim {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// A message's header: its size, SimConnect's version, and its kind.
fn header(record: &[u8]) -> [u32; 3] {
    let word = |at: usize| u32::from_le_bytes(record[at..at + 4].try_into().unwrap());
    [word(0), word(4), word(8)]
}

const C1: Connection = Connection { unit: 1, open: 1 };
const C2: Connection = Connection { unit: 2, open: 1 };

fn open(name: &str, connection: Connection) -> SimCall {
    SimCall::Open {
        connection,
        name: name.into(),
    }
}

#[test]
fn finds_the_watched_process_once_and_hands_up_its_exit_code_when_killed() {
    let (stand_in, from) = started();
    stand_in.call(SimCall::FindProcess);
    quiet(&from);

    let mut process = Sim::start();
    stand_in.act(Act::Watch {
        process: process.id(),
    });
    stand_in.call(SimCall::FindProcess);
    match next(&from) {
        Up::Found {
            process: id,
            created,
        } => {
            assert_eq!(id, process.id());
            assert!(created > 0);
        }
        up => panic!("the stand-in should find the process, not hand up {up:?}"),
    }
    stand_in.call(SimCall::FindProcess);
    quiet(&from);

    process.kill();
    assert_eq!(next(&from), Up::Exited { code: 1 });
    stand_in.call(SimCall::FindProcess);
    quiet(&from);
}

#[test]
fn opens_a_connection_only_while_the_sim_runs_and_hands_up_its_open_message() {
    let (stand_in, from) = started();
    stand_in.call(open("Dual Input", C1));
    assert_eq!(
        next(&from),
        Up::Opened {
            connection: C1,
            result: E_FAIL
        }
    );

    let mut process = Sim::start();
    stand_in.act(Act::Watch {
        process: process.id(),
    });
    stand_in.call(SimCall::FindProcess);
    assert!(matches!(next(&from), Up::Found { .. }));
    stand_in.call(open("Dual Input", C1));
    assert_eq!(
        next(&from),
        Up::Opened {
            connection: C1,
            result: S_OK
        }
    );
    let Up::Message {
        connection, record, ..
    } = next(&from)
    else {
        panic!("the sim's open message should follow the open");
    };
    assert_eq!(connection, C1);
    // SIMCONNECT_RECV_OPEN: a 12-byte header, a 256-byte name, and ten DWORDs.
    assert_eq!(header(&record), [308, 6, 2]);
    assert_eq!(&record[12..20], b"SunRise\0");
    process.kill();
}

#[test]
fn loses_a_connection_and_quits_on_the_others_when_asked() {
    let (stand_in, from) = started();
    let mut process = Sim::start();
    stand_in.act(Act::Watch {
        process: process.id(),
    });
    stand_in.call(SimCall::FindProcess);
    assert!(matches!(next(&from), Up::Found { .. }));
    for connection in [C1, C2] {
        stand_in.call(open("Dual Input", connection));
        assert!(matches!(next(&from), Up::Opened { result: S_OK, .. }));
        assert!(matches!(next(&from), Up::Message { .. }));
    }

    stand_in.act(Act::Lose { unit: C1.unit });
    assert_eq!(next(&from), Up::Lost { connection: C1 });
    stand_in.act(Act::Quit);
    let Up::Message {
        connection, record, ..
    } = next(&from)
    else {
        panic!("the quit message should come up on the connection still open");
    };
    assert_eq!(connection, C2);
    assert_eq!(header(&record), [12, 6, 3]);
    quiet(&from);

    // A sim that has quit, while its process still runs, takes an open that never answers.
    stand_in.call(open("Dual Input", C1));
    assert_eq!(
        next(&from),
        Up::Opened {
            connection: C1,
            result: S_OK
        }
    );
    quiet(&from);
    process.kill();
}

/// The message an input carries, and the tag of the call it names.
fn message(up: Up) -> (Message, Option<Tag>) {
    let Up::Message { record, call, .. } = up else {
        panic!("a message should come up, not {up:?}");
    };
    (Message::read(&record).unwrap(), call)
}

fn on(connection: Connection, tag: u64, op: Op) -> SimCall {
    SimCall::On {
        connection,
        tag: Tag(tag),
        op,
    }
}

fn create(title: &str, request: u32) -> Op {
    Op::AICreateSimulatedObject {
        title: title.into(),
        livery: String::new(),
        at: InitPosition::default(),
        request,
    }
}

#[test]
fn creates_objects_answers_the_camera_and_sends_frames_as_the_sim_would() {
    let (stand_in, from) = started();
    let mut process = Sim::start();
    stand_in.act(Act::Watch {
        process: process.id(),
    });
    stand_in.call(SimCall::FindProcess);
    assert!(matches!(next(&from), Up::Found { .. }));
    stand_in.act(Act::Frames { per_second: 0 });
    stand_in.call(open("Dual Input", C1));
    assert!(matches!(next(&from), Up::Opened { result: S_OK, .. }));
    assert!(matches!(next(&from), Up::Message { .. }));

    stand_in.call(on(C1, 1, create("DUALINPUT_FIGURE_PILOT", 9)));
    let (assigned, _) = message(next(&from));
    let Message::Assigned { request: 9, object } = assigned else {
        panic!("the create's object ID should come under its request, not {assigned:?}");
    };

    stand_in.act(Act::Lack {
        title: "MISSING".into(),
    });
    stand_in.call(on(C1, 2, create("MISSING", 10)));
    let (refused, call) = message(next(&from));
    assert!(matches!(refused, Message::Exception { .. }));
    assert_eq!(call, Some(Tag(2)), "the exception names the create's call");

    let camera = Camera {
        position: [0.3, 0.8, -0.1],
        referential: 1,
        yaw: 20.0,
        fov: 0.9,
        ..Camera::default()
    };
    stand_in.act(Act::Camera(camera));
    stand_in.call(on(C1, 3, Op::CameraGet { referential: 1 }));
    assert_eq!(message(next(&from)).0, Message::Camera(camera));

    stand_in.call(on(
        C1,
        4,
        Op::SubscribeToSystemEvent {
            event: 5,
            name: "Frame".into(),
        },
    ));
    stand_in.act(Act::FrameBurst { count: 3 });
    for _ in 0..3 {
        let (frame, _) = message(next(&from));
        assert!(matches!(frame, Message::Frame { event: 5, .. }));
    }

    let report = stand_in.report().unwrap();
    assert_eq!(report.objects.len(), 1);
    assert_eq!(report.objects[0].id, object);
    stand_in.call(SimCall::Close { connection: C1 });
    assert!(
        stand_in.report().unwrap().objects.is_empty(),
        "a closed connection's objects go with it"
    );
    process.kill();
}

#[test]
fn finds_the_next_sim_named_before_the_last_one_exited() {
    let (stand_in, from) = started();
    let mut first = Sim::start();
    stand_in.act(Act::Watch {
        process: first.id(),
    });
    stand_in.call(SimCall::FindProcess);
    assert!(matches!(next(&from), Up::Found { .. }));

    let next_sim = Sim::start();
    stand_in.act(Act::Watch {
        process: next_sim.id(),
    });
    first.kill();
    assert_eq!(next(&from), Up::Exited { code: 1 });
    stand_in.call(SimCall::FindProcess);
    assert!(matches!(next(&from), Up::Found { process, .. } if process == next_sim.id()));
}
