//! The recording crate driven through the kernel as the core's edge drives it: the writer's
//! input, its timer, and its jobs go in, and the slice and the jobs it starts come out. A real
//! `recording.open-folder` would open a window on the PC's desktop, so its job is checked here
//! rather than on the bench.

use std::collections::BTreeMap;

use clients::{SocketOut, SocketUp, Sockets};
use kernel::{
    Entry, FIRST, Input, JOBS, Kernel, Output, Registry, SetTimer, SourceId, StartJob, TIMERS,
    TimerId, Work, first_input,
};
use messages::clients::ToClient;
use messages::recording::{RecordingSlice, RecordingStopped};
use serde_json::{Value, json};

const SECOND: u64 = 1_000_000;
const OLD: &str = "2026-10-20_14-02-11";
const CURRENT: &str = "2026-10-21_09-00-00";

struct Core {
    kernel: Kernel,
    sockets: SourceId,
    writer: SourceId,
    seq: u64,
    now: u64,
    timers: BTreeMap<(u64, TimerId), ()>,
    jobs: Vec<StartJob>,
    slice: Option<RecordingSlice>,
    answers: Vec<Option<String>>,
}

impl Core {
    /// A core past its start, with `OLD` and `CURRENT` listed, and a client watching the slice.
    fn new() -> Core {
        let mut registry = Registry::new();
        clients::register(&mut registry);
        recording::register(&mut registry);
        let kernel = Kernel::new(registry);
        let sockets = kernel
            .source::<Sockets>()
            .expect("a source for the sockets");
        let writer = kernel
            .source::<recording::Writer>()
            .expect("a source for the writer");
        let mut core = Core {
            kernel,
            sockets,
            writer,
            seq: 0,
            now: SECOND,
            timers: BTreeMap::new(),
            jobs: Vec::new(),
            slice: None,
            answers: Vec::new(),
        };
        let files = vec![("settings.json".to_string(), None)];
        core.handle(FIRST, first_input([1; 32], files));
        let listing = core.take_job(|work| matches!(work, Work::List { .. }));
        core.finish(
            &listing,
            Entry::encode(&[
                Entry {
                    name: OLD.into(),
                    size: 10,
                },
                Entry {
                    name: CURRENT.into(),
                    size: 20,
                },
            ]),
        );
        core.handle(core.sockets, SocketUp::Opened { socket: 1 }.encode());
        core.say(json!({ "t": "hello", "component": "desktop", "version": messages::VERSION, "hash": messages::HASH }));
        core.say(json!({ "t": "watch", "slices": ["recording"] }));
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
        for output in outputs {
            self.carry(output);
        }
    }

    fn carry(&mut self, output: Output) {
        let value = output.into_value();
        let value = match value.downcast::<SetTimer>() {
            Ok(set) => {
                self.timers.insert((set.due, set.id), ());
                return;
            }
            Err(value) => value,
        };
        let value = match value.downcast::<StartJob>() {
            Ok(job) => {
                self.jobs.push(*job);
                return;
            }
            Err(value) => value,
        };
        if let Ok(out) = value.downcast::<SocketOut>()
            && let SocketOut::Send { text, .. } = *out
        {
            match serde_json::from_str(&text) {
                Ok(ToClient::State { value, .. }) => {
                    self.slice = serde_json::from_value(value).ok();
                }
                Ok(ToClient::Answer { error, .. }) => self.answers.push(error),
                _ => {}
            }
        }
    }

    fn say(&mut self, message: Value) {
        let text = SocketUp::Text {
            socket: 1,
            text: message.to_string(),
        };
        self.handle(self.sockets, text.encode());
    }

    /// Fires every timer due within `span`, as the edge would.
    fn advance(&mut self, span: u64) {
        let to = self.now + span;
        while let Some((&(due, id), ())) = self.timers.iter().next().filter(|(k, _)| k.0 <= to) {
            self.timers.remove(&(due, id));
            self.now = self.now.max(due);
            self.handle(TIMERS, id.fired());
        }
        self.now = to;
    }

    fn take_job(&mut self, wanted: impl Fn(&Work) -> bool) -> StartJob {
        let at = self
            .jobs
            .iter()
            .position(|job| wanted(&job.job.work))
            .expect("the job should have started");
        self.jobs.remove(at)
    }

    fn finish(&mut self, job: &StartJob, bytes: Vec<u8>) {
        self.handle(JOBS, job.id.finished(Ok(bytes)));
    }

    /// The slice, after a round of the clients crate's.
    fn slice(&mut self) -> RecordingSlice {
        self.advance(100_000);
        self.slice
            .clone()
            .expect("the client should have the slice")
    }
}

#[test]
fn the_writers_input_says_why_the_run_in_progress_stopped() {
    for why in [RecordingStopped::NoSpace, RecordingStopped::FailedWrite] {
        let mut core = Core::new();
        assert_eq!(core.slice().stopped, None);
        core.handle(core.writer, recording::stopped_input(why));
        assert_eq!(core.slice().stopped, Some(why));
    }
}

#[test]
fn the_run_in_progress_alone_has_its_size_read_again_every_10s() {
    let mut core = Core::new();
    core.jobs.clear();
    // A client quiet for 8s loses its socket, so this one says it's alive as the time passes.
    for _ in 0..9 {
        core.advance(SECOND);
        core.say(json!({ "t": "alive" }));
    }
    assert!(
        !core
            .jobs
            .iter()
            .any(|job| matches!(job.job.work, Work::List { .. })),
        "no read before 10s"
    );
    core.advance(SECOND);
    let read = core.take_job(|work| matches!(work, Work::List { .. }));
    assert!(
        matches!(&read.job.work, Work::List { path } if *path == format!("recordings\\{CURRENT}")),
        "{:?}",
        read.job.work
    );
    core.finish(
        &read,
        Entry::encode(&[
            Entry {
                name: "inputs.zst".into(),
                size: 5_000,
            },
            Entry {
                name: "log.txt".into(),
                size: 300,
            },
        ]),
    );
    let runs = core.slice().runs;
    assert_eq!(runs[0].size, 10, "an older run keeps its listed size");
    assert_eq!(runs[1].size, 5_300);
}

#[test]
fn only_a_listed_run_has_its_folder_opened() {
    let mut core = Core::new();
    core.jobs.clear();
    core.say(json!({ "t": "command", "id": 1, "name": "recording.open-folder", "args": { "name": "..\\settings.json" } }));
    assert!(core.jobs.is_empty(), "no job for a name it didn't list");
    assert!(
        core.answers
            .last()
            .is_some_and(|e| e.as_deref().is_some_and(|e| e.contains("no run named")))
    );

    core.say(json!({ "t": "command", "id": 2, "name": "recording.open-folder", "args": { "name": OLD } }));
    assert_eq!(core.answers.last(), Some(&None));
    let open = core.take_job(|work| matches!(work, Work::OpenFolder { .. }));
    assert!(
        matches!(&open.job.work, Work::OpenFolder { path } if *path == format!("recordings\\{OLD}")),
        "{:?}",
        open.job.work
    );
}
