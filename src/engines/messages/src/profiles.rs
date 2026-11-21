//! The profile loader's session key, channel, match item, slice, and command
//! (record/areas/profiles/02-units.md, "The pin", "Test sessions", and "The match check's
//! item"; record/areas/interface/decisions.md, "The aircraft picker loads an aircraft through the
//! world map's store, and only at the world map").

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::net::{Channel, Delivery, PilotId};
use crate::session::{Key, MatchItem, Writer};

/// The bundle the session pins: the pilot flying's loader writes its choice whenever the
/// session's aircraft changes before preflight ends, whenever the key holds none and its choice
/// becomes one, and whenever a member's local folder gets a new bundle for the session's
/// aircraft; every core loads the bundle it names. `None` when no profile covers the aircraft.
pub const PIN: Key<Option<Pin>> = Key::new(6, Writer::PilotFlying);

/// A bundle, by the SHA-256 of its bytes; whether it's a local one, which no core fetches, since
/// no copy of it is on the profiles' site; and for a local one, the member whose local folder it
/// came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pin {
    pub hash: [u8; 32],
    pub local: bool,
    pub from: Option<PilotId>,
}

/// Local bundles in a test session: a member's new one on its way to the pilot flying, and the
/// pinned one on its way from the pilot flying to a member who lacks it. A stream at the lowest
/// priority, so through a relay a bundle waits behind the live channels within the relay's cap.
pub const BUNDLES: Channel<LocalBundle> = Channel::new(10, Delivery::Stream, 0);

/// A local bundle's bytes, with the hash they're kept under, which a core checks as it loads them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalBundle {
    pub hash: [u8; 32],
    pub bytes: Vec<u8>,
    /// For a member's new bundle on its way to the pilot flying to pin, the member whose local
    /// folder it came from; `None` for the pinned bundle, which only a core that lacks it gets,
    /// so a copy of an earlier pin still on its way is never pinned again.
    pub offer: Option<PilotId>,
}

/// This member's profile, the profile loader's item of the match check.
pub const BUNDLE: MatchItem<Bundle> = MatchItem::new(4);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Bundle {
    /// This core loaded the pinned bundle.
    Loaded(Pin),
    /// The pin holds none, since no profile covers the session's aircraft.
    NoProfile,
    /// The pin names a bundle this core couldn't fetch, find, or read.
    Unavailable,
    /// This member is in the flight, and its core is reading the pinned bundle, or waiting for it
    /// to arrive.
    Loading,
}

/// The slice `ProfilesSlice` is sent as.
pub const SLICE: &str = "profiles";

/// What the apps show of the profiles.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "profiles/")]
pub struct ProfilesSlice {
    /// The profile that covers the aircraft the sim last loaded, in a session or not, or `None`
    /// when no profile covers it.
    pub loaded: Option<LoadedProfile>,
    /// Each published profile this core's level takes, in the aircraft picker.
    pub supported: Vec<SupportedAircraft>,
    /// How many of the picker's picks the world map couldn't carry out, which the picker counts
    /// up from as it asks, so it says when its pick failed.
    pub pick_failed: u32,
    /// The session's pinned bundle while it's a local one, as in a test session, or `None`.
    pub test: Option<TestProfile>,
}

/// A test session's bundle, as the session card and the crew rows show it
/// (record/areas/interface/decisions.md, "A test session shows the bundle each PC runs").
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "profiles/")]
pub struct TestProfile {
    /// The pinned bundle's hash, shortened to its first 7 hex digits.
    pub hash: String,
    /// The member whose local folder it came from, as 32 hex digits.
    pub from: Option<String>,
    /// What each member in the flight runs, as its value of the match check's item says.
    pub members: Vec<MemberBundle>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "profiles/")]
pub struct MemberBundle {
    /// The member, as 32 hex digits.
    pub pilot: String,
    pub runs: Runs,
}

/// What one member's PC runs.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "profiles/")]
pub enum Runs {
    /// The bundle with this short hash, the pinned one or, for a moment after a new pin, the one
    /// before it.
    Loaded { hash: String },
    /// It's reading the pinned bundle, or waiting for it to arrive.
    Loading,
    /// It couldn't get or read the pinned bundle.
    Missing,
}

/// A hash shortened as the apps show it, its first 7 hex digits.
pub fn short(hash: &[u8; 32]) -> String {
    let mut text = crate::hex(hash);
    text.truncate(7);
    text
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "profiles/")]
pub struct LoadedProfile {
    pub maturity: Maturity,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "profiles/")]
pub struct SupportedAircraft {
    pub maker: String,
    pub model: String,
    pub maturity: Maturity,
    /// Whether a package on disk holds it. A streamed copy keeps no folder on disk, so one reads
    /// as not installed.
    pub installed: bool,
}

/// How far a profile's authors stand behind it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "profiles/")]
pub enum Maturity {
    Stable,
    Experimental,
}

/// The profile loader's commands, which any client sends.
pub mod command {
    /// Loads an aircraft from the picker, with a `Pick`.
    pub const PICK: &str = "profiles.pick";
}

/// `profiles.pick`'s arguments.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "profiles/")]
pub struct Pick {
    pub maker: String,
    pub model: String,
}
