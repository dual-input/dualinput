//! Rate and pause's messages: its two session keys, the `unit` message its part in the EFB app
//! hears, and the time of day's match item (record/areas/session/02-units.md, "Rate and pause").

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::session::{Key, MatchItem, Writer};

/// The feature's name: its unit's, and the one its `unit` messages to the EFB app's part carry.
/// `NAME` in src/features/rate-and-pause/efb/index.ts names it too, so change both together.
pub const NAME: &str = "rate-and-pause";

/// Active pause, which any member writes, the stamp settling two writes at once.
pub const PAUSE: Key<bool> = Key::new(9, Writer::Anyone);

/// The flying machine's `E:SIMULATION RATE`, which a following machine steps its own to.
pub const RATE: Key<f32> = Key::new(10, Writer::PilotFlying);

/// The sim's date and time of day, which the match check compares, since neither is synced.
pub const TIME_OF_DAY: MatchItem<TimeOfDay> = MatchItem::new(6);

/// What the core sends the EFB app's part: active pause on or off.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "rate-and-pause/")]
pub struct SetPause {
    pub on: bool,
}

/// The sim's date, `E:ZULU YEAR`, `E:ZULU MONTH OF YEAR`, and `E:ZULU DAY OF MONTH`, and its
/// time of day, `E:ZULU TIME`, in whole seconds since midnight.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimeOfDay {
    pub year: u16,
    pub month: u8,
    pub day: u8,
    pub seconds: u32,
}
