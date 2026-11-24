//! The recorder's messages: the commands the profile extension's language server, `serve`, sends
//! the core's platform unit `tape`, and the slice `tape` it watches
//! (record/areas/profiles/05-the-recorder.md, "How it works").

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The unit's name, and its slice's.
pub const NAME: &str = "tape";

/// The recorder's commands, which take no arguments.
pub mod command {
    /// Starts a recording, in place of the one there is.
    pub const RECORD: &str = "tape.record";
    /// Stops a recording, or a playback with its catch-up.
    pub const STOP: &str = "tape.stop";
    /// Puts the cockpit back as it was at Record, then plays the recording into it.
    pub const PLAY: &str = "tape.play";
}

/// The slice `tape`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "tape/")]
pub struct TapeSlice {
    pub state: TapeState,
    /// Why the recorder can't act now, of the reasons the core can see, or none when it can.
    pub off: Option<TapeOff>,
    /// What last stopped a recording or a playback other than Stop, until the next command.
    pub stopped: Option<TapeStopped>,
}

/// What the recorder holds and does. Its times are in milliseconds, read again each second while
/// they run.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export, export_to = "tape/")]
pub enum TapeState {
    /// Nothing recorded in this session.
    #[default]
    Empty,
    Recording {
        elapsed_ms: u64,
    },
    Recorded {
        length_ms: u64,
    },
    /// Playback's catch-up, which puts the cockpit back as it was at Record.
    Restoring {
        length_ms: u64,
    },
    Playing {
        at_ms: u64,
        length_ms: u64,
    },
}

/// Why the recorder can't act, of the reasons the core can see; the open text being unsaved is
/// `serve`'s to tell (record/areas/profiles/05-the-recorder.md, "When the recorder works").
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "tape/")]
pub enum TapeOff {
    /// Outside a session's flight, or before preflight ends, when the cockpit stream sends
    /// nothing.
    NoFlight,
    /// Someone else is in the session.
    Crew,
    /// A catch-up step isn't ready, as for 1.5s after the profile loads.
    Loading,
}

/// What stopped a recording or a playback other than Stop.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "tape/")]
pub struct TapeStopped {
    pub what: Stopping,
    pub by: StoppedBy,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "tape/")]
pub enum Stopping {
    Recording,
    Playback,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export, export_to = "tape/")]
pub enum StoppedBy {
    /// The profile unloaded, as a save's reload unloads it.
    Reload,
    /// A crewmate joined the session, by their display name.
    Joined { name: String },
}
