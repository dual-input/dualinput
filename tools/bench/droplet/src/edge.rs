//! The droplet's edge, a small copy of the core's for Linux: one queue every input reaches the
//! loop through, a timer thread, jobs on tokio's blocking pool, and a sink for each output type.
//! It records nothing, since nobody replays a droplet run.

use std::any::{Any, TypeId};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use kernel::{Input, JOBS, Output, SourceId, StartJob, TIMERS, TimerId, Work};

/// Now, in µs since the program started, which every stamp in it uses: the inputs', the
/// transport's, and its log's.
pub fn now() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    u64::try_from(START.get_or_init(Instant::now).elapsed().as_micros())
        .expect("µs since the program started should fit in 64 bits")
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|p| p.into_inner())
}

/// The one queue. As in the core, `push` stamps and numbers an input under the lock that
/// appends it, so stamps rise with sequence numbers.
#[derive(Default)]
pub struct Queue {
    state: Mutex<(VecDeque<Input>, u64)>,
    ready: Condvar,
}

impl Queue {
    pub fn push(&self, source: SourceId, bytes: Vec<u8>) {
        let mut state = lock(&self.state);
        let seq = state.1;
        state.1 += 1;
        state.0.push_back(Input {
            seq,
            stamp: now(),
            source,
            bytes,
        });
        drop(state);
        self.ready.notify_one();
    }

    /// The oldest input, once there is one.
    pub fn pop(&self) -> Input {
        let mut state = lock(&self.state);
        loop {
            if let Some(input) = state.0.pop_front() {
                return input;
            }
            state = self.ready.wait(state).unwrap_or_else(|p| p.into_inner());
        }
    }
}

#[derive(Default)]
struct Due {
    due: BTreeSet<(u64, TimerId)>,
    by_id: BTreeMap<TimerId, u64>,
    stopped: bool,
}

/// The timer thread, which pushes each of the loop's timers as an input when it's due. A probe
/// carries the stamp of the timer's input, not its due time, so a timer that fires late makes
/// no probe look late.
#[derive(Default)]
pub struct Timers {
    state: Mutex<Due>,
    wake: Condvar,
}

impl Timers {
    pub fn start(queue: Arc<Queue>) -> Arc<Timers> {
        let timers = Arc::new(Timers::default());
        let thread = timers.clone();
        std::thread::Builder::new()
            .name("timers".into())
            .spawn(move || thread.run(&queue))
            .expect("the timer thread should start");
        timers
    }

    pub fn set(&self, id: TimerId, at: u64) {
        let mut state = lock(&self.state);
        state.due.insert((at, id));
        state.by_id.insert(id, at);
        self.wake.notify_one();
    }

    pub fn cancel(&self, id: TimerId) {
        let mut state = lock(&self.state);
        if let Some(at) = state.by_id.remove(&id) {
            state.due.remove(&(at, id));
        }
    }

    pub fn stop(&self) {
        lock(&self.state).stopped = true;
        self.wake.notify_one();
    }

    fn run(&self, queue: &Queue) {
        let mut state = lock(&self.state);
        while !state.stopped {
            let now = now();
            while let Some(&(at, id)) = state.due.first() {
                if at > now {
                    break;
                }
                state.due.pop_first();
                state.by_id.remove(&id);
                queue.push(TIMERS, id.fired());
            }
            state = match state.due.first() {
                Some(&(at, _)) => {
                    self.wake
                        .wait_timeout(state, Duration::from_micros(at - now))
                        .unwrap_or_else(|p| p.into_inner())
                        .0
                }
                None => self.wake.wait(state).unwrap_or_else(|p| p.into_inner()),
            };
        }
    }
}

/// Runs a job on tokio's blocking pool, its path in the droplet's folder, and pushes its result.
/// The droplet run opens its session with no backend, so a fetch, such as the network's look-up
/// when no member answers within 10s, gets no answer, as with the backend down.
pub fn start_job(
    runtime: &tokio::runtime::Handle,
    queue: Arc<Queue>,
    folder: Arc<PathBuf>,
    start: StartJob,
) {
    runtime.spawn_blocking(move || {
        let result = match &start.job.work {
            Work::Read { path } => {
                std::fs::read(folder.join(path)).map_err(|e| format!("couldn't read {path}: {e}"))
            }
            Work::Write { path, bytes } => std::fs::write(folder.join(path), bytes)
                .map(|()| Vec::new())
                .map_err(|e| format!("couldn't write {path}: {e}")),
            Work::Fetch(fetch) => Err(format!(
                "{} got no answer: the droplet run has no backend",
                fetch.url
            )),
            // Only the recording crate lists, deletes, and opens folders, and the droplet runs none.
            Work::List { path } | Work::Delete { path } | Work::OpenFolder { path } => {
                Err(format!("{path}: the droplet program keeps no runs"))
            }
            // Only a page's Discord link asks this, and the droplet has no page.
            Work::OpenLink { url } => Err(format!("{url}: the droplet program opens no browser")),
            // Only the session crate and the sim service ask these, and the droplet runs
            // neither.
            Work::Find { .. } | Work::InviteCode | Work::CopyText { .. } => {
                Err("the droplet program has no sim and no clipboard".to_string())
            }
            // The clients crate asks at its start, for a setup no droplet runs.
            Work::Username => Ok(Vec::new()),
        };
        let result = match start.job.then {
            Some(then) => result.and_then(then),
            None => result,
        };
        queue.push(JOBS, start.id.finished(result));
    });
}

type Sink = Box<dyn FnMut(Box<dyn Any + Send>)>;

/// Where each output goes, as in the core.
#[derive(Default)]
pub struct Sinks {
    by_type: HashMap<TypeId, Sink>,
    dropped: BTreeSet<&'static str>,
}

impl Sinks {
    pub fn on<T: 'static>(&mut self, mut sink: impl FnMut(T) + 'static) {
        let sink: Sink = Box::new(move |value| {
            sink(
                *value
                    .downcast::<T>()
                    .expect("a sink should get its own type"),
            );
        });
        self.by_type.insert(TypeId::of::<T>(), sink);
    }

    /// Hands `output` to its sink. The droplet has no sockets and no sim, so it drops an
    /// output no sink here takes, such as the clients crate's socket messages, and logs each
    /// type it drops once.
    pub fn carry(&mut self, output: Output) {
        match self.by_type.get_mut(&output.value_type()) {
            Some(sink) => sink(output.into_value()),
            None => {
                if self.dropped.insert(output.type_name()) {
                    tracing::info!(
                        "the droplet drops {}, which unit {} put out",
                        output.type_name(),
                        output.unit_name()
                    );
                }
            }
        }
    }
}
