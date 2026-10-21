//! The stand-in hands up what the sim edge would, as a scenario acts on the sim: a watched
//! process found and its exit code, an open's result and the sim's open message, and the
//! losses and quit messages a scenario asks for, then an open that never answers. A `ping` that runs for a minute stands for
//! the sim's process, as the bench's stub does.

use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use sim_client::{Connection, SimCall, Up};
use stand_in_sim::{Act, StandIn};

const S_OK: i32 = 0;
const E_FAIL: i32 = 0x8000_4005_u32 as i32;

fn started() -> (StandIn, mpsc::Receiver<Up>) {
    let (to, from) = mpsc::channel();
    let (stand_in, _) = StandIn::start(move |up| {
        let _ = to.send(up);
    })
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
    let Up::Message { connection, record } = next(&from) else {
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

    stand_in.act(Act::Lose { connection: C1 });
    assert_eq!(next(&from), Up::Lost { connection: C1 });
    stand_in.act(Act::Quit);
    let Up::Message { connection, record } = next(&from) else {
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
