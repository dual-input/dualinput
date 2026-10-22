//! What the kernel and the core's edge hand each other: inputs one way, and the kernel's own
//! outputs, timers, jobs, and the exit, the other.

use serde::{Deserialize, Serialize};

/// Where an input came from. Sources are numbered in the order they register: the kernel's
/// three below first, then each unit's, in the order the units register, which one build
/// always repeats. So a recording names a source by its number alone, and replays only on
/// the build that wrote it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SourceId(pub u32);

/// The core's first input, which `first_input` encodes.
pub const FIRST: SourceId = SourceId(0);
/// A timer firing, whose bytes `TimerId::fired` gives.
pub const TIMERS: SourceId = SourceId(1);
/// A job's result, whose bytes `JobId::finished` gives.
pub const JOBS: SourceId = SourceId(2);

/// One input to the loop: its bytes as they came in, unparsed, so the unit that owns the
/// source parses them on the loop, and a replay parses them the same way.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Input {
    /// Its place in the core's queue, from 0.
    pub seq: u64,
    /// When the queue took it, in µs on the PC's performance counter. Every handler takes
    /// the time from here, as `Cx::now`.
    pub stamp: u64,
    pub source: SourceId,
    pub bytes: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct First {
    pub(crate) seed: [u8; 32],
    pub(crate) files: Vec<(String, Option<Vec<u8>>)>,
}

/// The bytes of the core's first input: the seed of every unit's random IDs, 256 bits the
/// edge draws from the operating system, and each start file's bytes, `None` for a file
/// that's missing. A replay takes all of these from the recording, so it reads no file.
pub fn first_input(seed: [u8; 32], files: Vec<(String, Option<Vec<u8>>)>) -> Vec<u8> {
    postcard::to_stdvec(&First { seed, files }).expect("postcard should encode the first input")
}

/// A number a unit draws from its own counter, for a timer, a job, or a call that waits for
/// an answer.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Handle {
    pub(crate) unit: u32,
    pub(crate) n: u64,
}

impl Handle {
    /// The place of the unit that drew it.
    pub fn unit(self) -> u32 {
        self.unit
    }

    /// Its number among that unit's handles, from 0.
    pub fn n(self) -> u64 {
        self.n
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct TimerId(pub(crate) Handle);

impl TimerId {
    pub fn handle(self) -> Handle {
        self.0
    }

    /// The bytes of the input the edge pushes on `TIMERS` when this timer fires.
    pub fn fired(self) -> Vec<u8> {
        postcard::to_stdvec(&self.0).expect("postcard should encode a handle")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct JobId(pub(crate) Handle);

impl JobId {
    pub fn handle(self) -> Handle {
        self.0
    }

    /// The bytes of the input the edge pushes on `JOBS` when this job ends: its result, or
    /// its error as text.
    pub fn finished(self, result: Result<Vec<u8>, String>) -> Vec<u8> {
        postcard::to_stdvec(&(self.0, result)).expect("postcard should encode a job's result")
    }
}

/// An output asking the edge to push `id`'s firing at `due`, in µs on the PC's performance
/// counter.
#[derive(Clone, Copy, Debug, Serialize)]
pub struct SetTimer {
    pub id: TimerId,
    pub due: u64,
}

/// An output asking the edge to drop a timer. One that already fired still reaches the
/// kernel, which drops it.
#[derive(Clone, Copy, Debug, Serialize)]
pub struct CancelTimer {
    pub id: TimerId,
}

/// An output asking the edge to run a job, off the loop.
#[derive(Clone, Debug, Serialize)]
pub struct StartJob {
    pub id: JobId,
    pub job: Job,
}

/// Work the edge does for a unit, off the loop: reading or writing a file, or fetching over
/// HTTPS, then optionally an engine's work on what it got, as the profile loader parses and
/// checks a bundle.
#[derive(Clone, Debug, Serialize)]
pub struct Job {
    pub work: Work,
    /// Runs on the edge's thread after the work, on its bytes. It's an engine's pure
    /// function, so it reads no state of the loop's, and a replay never runs it, since the
    /// recording holds its result. It stays out of the outputs' hash, which postcard can't
    /// encode it for.
    #[serde(skip)]
    pub then: Option<Then>,
}

/// An engine's work on what a job read: its result, or its error as text.
pub type Then = fn(Vec<u8>) -> Result<Vec<u8>, String>;

/// A path is relative to the core's data folder, or absolute. A path from an input may have
/// the home folder's path hidden at its start, and the edge puts the real path back before
/// it opens the file (record/areas/recording/01-recording-and-bug-reports.md, "The home
/// folder's path"). The pool runs several jobs at once, so a unit that writes one path again
/// waits for the first write's result, or the two can land in either order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum Work {
    /// Reads a whole file, whose bytes are the job's result.
    Read { path: String },
    /// Writes a whole file, replacing it, through a file beside it that's renamed over it,
    /// so a crash never leaves it half written. The result is empty.
    Write { path: String, bytes: Vec<u8> },
    /// Fetches a URL, as the network's requests to the backend do. The result is a
    /// `Fetched`, whatever its status, and a fetch that got no answer is the job's error.
    Fetch(Fetch),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Fetch {
    pub method: Method,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    /// The answer's headers the result keeps, by name, such as `etag`, so the recording
    /// holds only what a unit reads.
    pub keep: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Method {
    Get,
    Post,
}

/// What a fetch got: the answer's status, the headers its request kept, and its body.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fetched {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Fetched {
    pub fn encode(&self) -> Vec<u8> {
        postcard::to_stdvec(self).expect("postcard should encode what a fetch got")
    }

    pub fn decode(bytes: &[u8]) -> Option<Fetched> {
        postcard::from_bytes(bytes).ok()
    }
}

impl Job {
    pub fn read(path: impl Into<String>) -> Job {
        Job {
            work: Work::Read { path: path.into() },
            then: None,
        }
    }

    pub fn write(path: impl Into<String>, bytes: Vec<u8>) -> Job {
        Job {
            work: Work::Write {
                path: path.into(),
                bytes,
            },
            then: None,
        }
    }

    pub fn fetch(fetch: Fetch) -> Job {
        Job {
            work: Work::Fetch(fetch),
            then: None,
        }
    }

    pub fn then(self, f: Then) -> Job {
        Job {
            then: Some(f),
            ..self
        }
    }
}

/// An output asking the core to exit. The loop takes no more inputs, the edges carry out
/// the outputs already put out, and the process exits with 0, which tells the desktop app it
/// meant to (record/areas/core/01-loop-and-edge.md, "Exiting").
#[derive(Clone, Copy, Debug, Serialize)]
pub struct Exit;
