//! The profile loader's session key and match item (record/areas/profiles/02-units.md, "The
//! pin" and "The match check's item").

use serde::{Deserialize, Serialize};

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
