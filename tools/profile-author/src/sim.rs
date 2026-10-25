//! The tool's one SimConnect connection, made through the sim edge on a thread of its own as
//! the core makes its connections, and the events the tool waits on: what the sim hands up,
//! a line typed in the terminal, and Page Down or Page Up.

use std::collections::BTreeMap;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use sim_client::message::Message;
use sim_client::{Client, Connection, Op, SimCall, Tag, Up};
use sim_edge::SimEdge;

use crate::screen::{self, Key};

/// The name the connection opens under, which the sim's SimConnect log shows.
const NAME: &str = "Dual Input profile author";

/// How long the tool waits for the sim to answer a call it needs before going on.
pub const ANSWER: Duration = Duration::from_secs(5);

pub enum Event {
    Sim(Up),
    Line(String),
    Key {
        key: Key,
        sim_in_front: bool,
    },
    /// The terminal's input ended, as Ctrl+Z then Enter ends it.
    Closed,
}

pub struct Events {
    rx: Receiver<Event>,
    tx: Sender<Event>,
}

impl Events {
    /// Starts reading the terminal's lines and the keys, each on a thread of its own.
    pub fn start() -> Events {
        let (tx, rx) = mpsc::channel();
        let lines = tx.clone();
        std::thread::spawn(move || {
            for line in std::io::stdin().lines() {
                let Ok(line) = line else {
                    break;
                };
                if lines.send(Event::Line(line)).is_err() {
                    return;
                }
            }
            let _ = lines.send(Event::Closed);
        });
        let keys = tx.clone();
        screen::watch_keys(move |key, sim_in_front| {
            let _ = keys.send(Event::Key { key, sim_in_front });
        });
        Events { rx, tx }
    }

    pub fn next(&self, within: Duration) -> Option<Event> {
        self.rx.recv_timeout(within).ok()
    }
}

/// How a refusal names a write of `Figure`'s slot, the one client data area the tool writes.
pub const SLOT_WRITE: &str = "a write of Figure's slot";

/// What a message from the sim came to.
pub enum Received {
    Message(Message),
    /// The sim refused a call, which the tool has printed, and `what` names.
    Refused {
        call: Option<Tag>,
        what: String,
    },
}

pub struct Sim {
    edge: SimEdge,
    thread: Option<JoinHandle<()>>,
    connection: Connection,
    pub client: Client<()>,
    next: u64,
    /// What each call was, by its tag, so a refusal names the call.
    calls: BTreeMap<Tag, String>,
}

impl Sim {
    /// Opens the connection, which fails while the sim isn't running.
    pub fn open(events: &Events) -> Result<Sim, String> {
        let tx = events.tx.clone();
        let (edge, thread) = SimEdge::start(
            || {},
            move |up| {
                let _ = tx.send(Event::Sim(up));
            },
        )
        .map_err(|e| format!("the sim edge's thread didn't start: {e}"))?;
        let connection = Connection { unit: 0, open: 1 };
        edge.call(SimCall::Open {
            connection,
            name: NAME.into(),
        });
        let sim = Sim {
            edge,
            thread: Some(thread),
            connection,
            client: Client::default(),
            next: 0,
            calls: BTreeMap::new(),
        };
        let end = Instant::now() + ANSWER;
        while let Some(event) = events.next(end.saturating_duration_since(Instant::now())) {
            if let Event::Sim(Up::Opened { result, .. }) = event {
                if result < 0 {
                    return Err(format!(
                        "SimConnect didn't open, HRESULT {result:#010x}: start the sim and load a flight in the aircraft"
                    ));
                }
                return Ok(sim);
            }
        }
        Err("SimConnect didn't answer the open within 5s".into())
    }

    /// Makes each call, in order.
    pub fn make(&mut self, ops: impl IntoIterator<Item = Op>) -> Vec<Tag> {
        let mut tags = Vec::new();
        for op in ops {
            self.next += 1;
            let tag = Tag(self.next);
            self.calls.insert(tag, describe(&op));
            tags.push(tag);
            self.edge.call(SimCall::On {
                connection: self.connection,
                tag,
                op,
            });
        }
        tags
    }

    /// Reads what the sim handed up, which ends the tool when the sim closed or the
    /// connection went.
    pub fn receive(&mut self, up: Up) -> Result<Option<Received>, String> {
        match up {
            Up::Message { record, call, .. } => match Message::read(&record) {
                Some(Message::Quit) => Err("the sim closed".into()),
                Some(Message::Exception {
                    exception, index, ..
                }) => {
                    let what = call
                        .and_then(|c| self.calls.get(&c))
                        .map_or("a call", String::as_str)
                        .to_string();
                    println!(
                        "  the sim refused {what}: SimConnect exception {exception}, at argument {index}"
                    );
                    Ok(Some(Received::Refused { call, what }))
                }
                Some(message) => Ok(Some(Received::Message(message))),
                None => Ok(None),
            },
            Up::Lost { .. } => Err("the connection to the sim was lost".into()),
            Up::Exited { code } => Err(format!("the sim's process ended with {code:#x}")),
            Up::Opened { .. } | Up::Found { .. } => Ok(None),
        }
    }

    /// Waits for the answer `f` picks out of what the sim hands up, ignoring the keys and the
    /// terminal meanwhile, but for `quit`.
    pub fn wait<T>(
        &mut self,
        events: &Events,
        what: &str,
        mut f: impl FnMut(&mut Client<()>, &Received) -> Option<T>,
    ) -> Result<T, String> {
        let end = Instant::now() + ANSWER;
        loop {
            let left = end.saturating_duration_since(Instant::now());
            match events.next(left) {
                Some(Event::Sim(up)) => {
                    if let Some(received) = self.receive(up)?
                        && let Some(answer) = f(&mut self.client, &received)
                    {
                        return Ok(answer);
                    }
                }
                Some(Event::Line(line)) if line.trim() == "quit" => return Err("quit".into()),
                Some(_) => {}
                None => return Err(format!("the sim didn't answer within 5s: {what}")),
            }
        }
    }
}

impl Drop for Sim {
    /// Closing the connection removes the objects it created, our figures among them, as the
    /// SDK documents and as killing a client did (record/areas/avatars/01-avatars.md, "The
    /// figures this machine draws").
    fn drop(&mut self) {
        self.edge.call(SimCall::Close {
            connection: self.connection,
        });
        self.edge.stop();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// A call, named for the line that says the sim refused it.
fn describe(op: &Op) -> String {
    match op {
        Op::AddToDataDefinition { name, .. } => format!("the variable {name}"),
        Op::MapClientEventToSimEvent { name, .. } => format!("the event {name}"),
        Op::MapClientDataNameToId { name, .. } => format!("the client data area {name}"),
        Op::AICreateSimulatedObject { title, .. } => format!("a create of {title}"),
        Op::SetClientData { .. } => SLOT_WRITE.into(),
        other => {
            let debug = format!("{other:?}");
            debug
                .split([' ', '{', '('])
                .next()
                .unwrap_or_default()
                .to_string()
        }
    }
}
