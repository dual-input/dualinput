//! The profile loader's session key, match item, slice, and command
//! (record/areas/profiles/02-units.md, "The pin" and "The match check's item";
//! record/areas/interface/decisions.md, "The aircraft picker loads an aircraft through the
//! world map's store, and only at the world map").

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::session::{Key, MatchItem, Writer};

/// The bundle the session pins: the pilot flying's loader writes its choice whenever the
/// session's aircraft changes before preflight ends, and whenever the key holds none and its
/// choice becomes one; every core loads the bundle it names. `None` when no profile covers the
/// aircraft.
pub const PIN: Key<Option<Pin>> = Key::new(6, Writer::PilotFlying);

/// A bundle, by the SHA-256 of its bytes, and whether it's a local one, which no core fetches,
/// since no copy of it is on the profiles' site.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pin {
    pub hash: [u8; 32],
    pub local: bool,
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
    /// as not installed until the world map's own list can say.
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
