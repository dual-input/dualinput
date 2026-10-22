//! What the core's edge for the helper, in `src/apps/core`, and the service hand each other: the
//! helper's start, its messages, and its exit up, as inputs, and what to start, send, stop,
//! and kill down, as outputs (record/areas/core/04-core-helper.md, "The helper's life").

use messages::core_helper::ToHelper;
use serde::{Deserialize, Serialize};

/// Names the source the edge's inputs come up under, through `Kernel::source::<Pipe>()`.
pub struct Pipe;

/// What the edge hands up, as one input's bytes. Each start is a run, numbered by the
/// service, so an input from a helper the service already counts as gone, such as one it
/// killed, is told apart from the next one's.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PipeUp {
    Started {
        run: u32,
        process: u32,
    },
    /// The program didn't start, for this reason.
    NotStarted {
        run: u32,
        error: String,
    },
    /// A message, as the bytes that followed its length.
    Message {
        run: u32,
        bytes: Vec<u8>,
    },
    /// The process exited, with its code where Windows gave one. A length over the most a
    /// message may be makes the edge kill it, which ends here too.
    Exited {
        run: u32,
        code: Option<i32>,
    },
}

impl PipeUp {
    pub fn encode(&self) -> Vec<u8> {
        postcard::to_stdvec(self).expect("postcard should encode the helper's input")
    }

    /// The input `encode` made, or `None` for bytes it couldn't have made.
    pub fn decode(bytes: &[u8]) -> Option<PipeUp> {
        postcard::from_bytes(bytes).ok()
    }
}

/// What the service asks of the edge.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum PipeOut {
    /// Starts `program` as run `run`, or `dualinput-core-helper.exe` beside the core when
    /// `program` is empty, with its standard input and output piped.
    Start {
        run: u32,
        program: String,
    },
    Send {
        run: u32,
        message: ToHelper,
    },
    /// Closes the helper's standard input, which tells it to exit, and kills it if it
    /// hasn't 1s later.
    Stop {
        run: u32,
    },
    Kill {
        run: u32,
    },
}
