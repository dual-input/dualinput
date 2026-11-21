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

/// A number from the kernel's counter, for a timer, a job, or a call that waits for an
/// answer, with the unit that drew it, whose handler its answer goes to.
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

    /// Its number among the core's handles, from 0.
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

/// Work the edge does for a unit off the loop, of the kinds `Work` lists, then optionally an
/// engine's work on what it got, as the profile loader parses and checks a bundle.
#[derive(Clone, Debug, Serialize)]
pub struct Job {
    pub work: Work,
    /// Runs on the edge's thread after the work, on its bytes. It's an engine's pure
    /// function, so it reads no state of the loop's, and a replay never runs it, since the
    /// recording holds its result. It stays out of the outputs' hash, which postcard can't
    /// encode it for.
    #[serde(skip)]
    pub then: Option<Then>,
    /// A gather's engine function, which names the files to read next, as `Then` runs on the
    /// edge and stays out of the hash.
    #[serde(skip)]
    pub follow: Option<Follow>,
}

/// An engine's work on what a job read: its result, or its error as text.
pub type Then = fn(Vec<u8>) -> Result<Vec<u8>, String>;

/// An engine's choice of the files a gather reads next, from the gather's context and the
/// files it has read so far, each with its bytes, or none for one that doesn't exist. A
/// gather ends when it names no file it hasn't read.
pub type Follow = fn(&[u8], &[(String, Option<Vec<u8>>)]) -> Vec<String>;

/// What a gather read: its context, and every file in the order it read them, with its
/// bytes, or none for a file that doesn't exist or doesn't read.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Gathered {
    pub context: Vec<u8>,
    pub files: Vec<(String, Option<Vec<u8>>)>,
}

impl Gathered {
    pub fn encode(&self) -> Vec<u8> {
        postcard::to_stdvec(self).expect("postcard should encode the files a gather read")
    }

    /// Borrowed, then copied whole, since decoding into a `Vec<u8>` takes it a byte at a time,
    /// and a gather's files can be tens of megabytes. Postcard writes the two the same way.
    pub fn decode(bytes: &[u8]) -> Option<Gathered> {
        #[derive(Deserialize)]
        struct Borrowed<'a> {
            context: &'a [u8],
            #[serde(borrow)]
            files: Vec<(String, Option<&'a [u8]>)>,
        }
        let borrowed: Borrowed<'_> = postcard::from_bytes(bytes).ok()?;
        Some(Gathered {
            context: borrowed.context.to_vec(),
            files: borrowed
                .files
                .into_iter()
                .map(|(path, file)| (path, file.map(<[u8]>::to_vec)))
                .collect(),
        })
    }
}

/// A path is relative to the core's data folder, or absolute, and may start with `%APPDATA%`
/// or `%LOCALAPPDATA%`, which the edge fills in, as the sim's `UserCfg.opt` sits under one or
/// the other. The pool runs several jobs at once, so a unit that writes one path again waits
/// for the first write's result, or the two can land in either order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum Work {
    /// Reads a whole file, whose bytes are the job's result.
    Read { path: String },
    /// Writes a whole file, replacing it, through a file beside it that's renamed over it,
    /// so a crash never leaves it half written. The result is empty.
    Write { path: String, bytes: Vec<u8> },
    /// Lists a folder: the result is its entries, encoded by `Entry::encode`, sorted by
    /// name. A folder that doesn't exist lists nothing.
    List { path: String },
    /// Deletes a file, or a folder and everything in it. The result is empty.
    Delete { path: String },
    /// Finds the folders under each root, at its depth, such as 1 for the root's own
    /// children, that hold the path `holding`. The result is their paths, one to a line, as
    /// `<root>\<child>`, in no order; a root that doesn't exist holds none.
    Find {
        roots: Vec<(String, u8)>,
        holding: String,
    },
    /// Reads the clipboard's text, and hands up the invite code it holds, if it holds one,
    /// and nothing else of it, so the recording never holds what a pilot copied for another
    /// program (record/areas/recording/01-recording-and-bug-reports.md, "The clipboard"). The
    /// result is the code, or empty.
    InviteCode,
    /// Replaces the clipboard's contents with this text. The result is empty.
    CopyText { text: String },
    /// Reads the Windows account's name, which first-time setup offers as a display name. The
    /// result is the name, or empty.
    Username,
    /// Opens a folder in Explorer, without waiting for its window. The result is empty.
    OpenFolder { path: String },
    /// Opens `app_url` in the program it's for if the pilot has that program, and otherwise `url`
    /// in their browser, without waiting for a window. The result is empty.
    OpenLink { url: String, app_url: String },
    /// Fetches a URL, as the network's requests to the backend do. The result is a
    /// `Fetched`, whatever its status, and a fetch that got no answer is the job's error.
    Fetch(Fetch),
    /// Reads the files the job's `follow` names from `context`, then the files it names once
    /// it has those, until it names none it hasn't read, as avatars' model job reads an
    /// aircraft's `aircraft.cfg`, the `model.cfg` it names, and on to the model's buffers.
    /// The result is a `Gathered`.
    Gather { context: Vec<u8> },
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

/// One entry of a folder a job listed: its name; its size in bytes, a folder's being the total of
/// every file inside it; and when it last changed, in ms since the Unix epoch, or 0 when Windows
/// can't say, which lets the profile loader see a rewritten bundle of the same size.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub name: String,
    pub size: u64,
    pub modified: u64,
}

impl Entry {
    pub fn encode(entries: &[Entry]) -> Vec<u8> {
        postcard::to_stdvec(entries).expect("postcard should encode a folder's entries")
    }

    pub fn decode(bytes: &[u8]) -> Option<Vec<Entry>> {
        postcard::from_bytes(bytes).ok()
    }
}

impl Job {
    fn of(work: Work) -> Job {
        Job {
            work,
            then: None,
            follow: None,
        }
    }

    pub fn read(path: impl Into<String>) -> Job {
        Job::of(Work::Read { path: path.into() })
    }

    pub fn write(path: impl Into<String>, bytes: Vec<u8>) -> Job {
        Job::of(Work::Write {
            path: path.into(),
            bytes,
        })
    }

    pub fn list(path: impl Into<String>) -> Job {
        Job::of(Work::List { path: path.into() })
    }

    pub fn delete(path: impl Into<String>) -> Job {
        Job::of(Work::Delete { path: path.into() })
    }

    pub fn find(roots: Vec<(String, u8)>, holding: impl Into<String>) -> Job {
        Job::of(Work::Find {
            roots,
            holding: holding.into(),
        })
    }

    pub fn invite_code() -> Job {
        Job::of(Work::InviteCode)
    }

    pub fn copy_text(text: impl Into<String>) -> Job {
        Job::of(Work::CopyText { text: text.into() })
    }

    pub fn username() -> Job {
        Job::of(Work::Username)
    }

    pub fn open_link(url: impl Into<String>, app_url: impl Into<String>) -> Job {
        Job::of(Work::OpenLink {
            url: url.into(),
            app_url: app_url.into(),
        })
    }

    pub fn open_folder(path: impl Into<String>) -> Job {
        Job::of(Work::OpenFolder { path: path.into() })
    }

    pub fn fetch(fetch: Fetch) -> Job {
        Job::of(Work::Fetch(fetch))
    }

    pub fn gather(context: Vec<u8>, follow: Follow) -> Job {
        Job {
            follow: Some(follow),
            ..Job::of(Work::Gather { context })
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
