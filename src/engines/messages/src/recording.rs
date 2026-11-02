//! What the recording crate shows the apps of the runs the core keeps, and the commands it
//! takes (record/areas/recording/01-recording-and-bug-reports.md, the note of 2026-10-23).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The slice of client state that lists the runs in the data folder's `recordings\`.
pub const SLICE: &str = "recording";

/// The command that marks the moment, which writes a line to the run's log. It takes no
/// arguments.
pub const MARK: &str = "recording.mark";

/// The command that deletes a run, whose arguments are a `DeleteRun`.
pub const DELETE: &str = "recording.delete";

/// The command that opens a run's folder in Explorer, whose arguments are an `OpenFolder`.
pub const OPEN_FOLDER: &str = "recording.open-folder";

/// The slice `recording`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "recording/")]
pub struct RecordingSlice {
    /// Oldest first, as the core last listed them.
    pub runs: Vec<Run>,
    /// Why the run in progress stopped recording, if it has.
    pub stopped: Option<RecordingStopped>,
}

/// Why a run stopped recording, while the core went on running.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "recording/")]
pub enum RecordingStopped {
    /// The recording's drive has under 1 GB free.
    NoSpace,
    /// A write to the recording failed.
    FailedWrite,
}

/// One run of the core: its folder, named by its start in UTC, as in `2026-10-20_14-02-11`,
/// and the bytes its recording and log take.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "recording/")]
pub struct Run {
    pub name: String,
    /// The run in progress's is at most 10s old, and any other's is as the core last listed it.
    pub size: u64,
    /// The run in progress, which can't be deleted.
    pub in_progress: bool,
}

/// `recording.delete`'s arguments.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "recording/")]
pub struct DeleteRun {
    pub name: String,
}

/// `recording.open-folder`'s arguments.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "recording/")]
pub struct OpenFolder {
    pub name: String,
}
