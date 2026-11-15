//! ATC audio's messages: the ATC host's key, the frames the ATC host's core sends the crew, its
//! settings, and the slice the ATC audio tab draws from
//! (record/areas/traffic-atc/01-traffic-and-atc.md, "ATC audio").

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::net::{Channel, Delivery, OneOff, PilotId, Wait};
use crate::session::{Key, Writer};

/// The ATC host, a role's key that any member writes through the ATC audio tab's switch, which
/// names the pilot whose ATC app every other pilot hears.
pub const HOST: Key<Option<PilotId>> = Key::role(8, Writer::Anyone);

/// The ATC host's frames, as one-off packets in a short queue, each dropped once its turn to
/// play has passed, handed over after the flight model's and before avatars'
/// (record/areas/network/01-between-machines.md, "Sending").
pub const FRAMES: Channel<Frame> = Channel::new(9, Delivery::Deadline, 180);

/// How long after its stamp a frame still waiting in this core's queue is dropped, in µs: the
/// delay at which a readback on Discord overtakes the call (record/areas/product/03-v1-scope.md,
/// "Hearing ATC").
pub const DEADLINE: u64 = 300_000;

/// 20ms of the ATC app's speech, in Opus.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Frame {
    /// The frames sent since the capture turned on, so silence takes no numbers.
    pub number: u32,
    /// The helper's counter value for its first sample, in µs on the ATC host's PC.
    pub at: u64,
    pub opus: Vec<u8>,
}

impl OneOff for Frame {
    fn wait(&self) -> Wait {
        Wait::Deadline {
            at: self.at.saturating_add(DEADLINE),
        }
    }
}

/// The programs Automatic captures, the first that's running, by their files' names without
/// `.exe`: BeyondATC's and SayIntentions', as their Start menu shortcuts start them
/// (record/areas/traffic-atc/01-traffic-and-atc.md, "The ATC host"). `AUTOMATIC` in
/// src/features/atc-audio/efb/part.tsx lists them first in the ATC app picker, so change both
/// together.
pub const AUTOMATIC: [&str; 2] = ["BeyondATC", "SayIntentionsAI"];

/// The ATC app setting: the program the ATC host captures, by its file's name without `.exe`,
/// or empty for Automatic. `APP` in src/features/atc-audio/efb/part.tsx names it too, so change
/// both together.
pub const APP: &str = "atc-audio.app";

/// The ATC volume setting, from 0 to 100%, which sets the playback stream's gain. `VOLUME` in
/// src/features/atc-audio/efb/part.tsx names it too, so change both together.
pub const VOLUME: &str = "atc-audio.volume";

/// The slice `atc-audio`, an `AtcSlice`.
pub const SLICE: &str = "atc-audio";

/// What the ATC audio tab shows of the feature's state.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "atc-audio/")]
pub struct AtcSlice {
    /// The program the capture takes while this pilot is the ATC host, or `None` while it
    /// waits for one or this pilot isn't.
    pub capturing: Option<String>,
}
