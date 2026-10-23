//! What the recording crate shows the apps of the runs the core keeps, and the commands it
//! takes (record/areas/recording/01-recording-and-bug-reports.md, the note of 2026-10-23).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The slice of client state that lists the runs in the data folder's `recordings\`.
pub const SLICE: &str = "recording";

/// The command that marks the moment, from the EFB app's button, which writes a line to the
/// run's log. It takes no arguments.
pub const MARK: &str = "recording.mark";

/// The command that deletes a run, whose arguments are a `DeleteRun`.
pub const DELETE: &str = "recording.delete";

/// The slice `recording`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "recording/")]
pub struct RecordingSlice {
    /// Oldest first, as the core last listed them.
    pub runs: Vec<Run>,
}

/// One run of the core: its folder, named by its start in UTC, as in `2026-10-20_14-02-11`,
/// and the bytes its recording and log take.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "recording/")]
pub struct Run {
    pub name: String,
    pub size: u64,
    /// The run in progress, which can't be deleted. Its size is as it was when the core
    /// last listed the runs.
    pub in_progress: bool,
}

/// `recording.delete`'s arguments.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "recording/")]
pub struct DeleteRun {
    pub name: String,
}
