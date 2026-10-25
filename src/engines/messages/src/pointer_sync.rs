//! Pointer sync's messages. A gesture is one press or drag on a synced display, an instrument the
//! profile's `displays` names, from a button's down to its up, and it goes to the crew as it
//! happens, each of its messages a cockpit message keyed by the display. Beside it are the panel
//! module's messages to its feature and back, and the visible lock's slice
//! (record/areas/pointer-sync/01-pointer-sync.md).
//!
//! A gesture travels in postcard on the cockpit stream and in JSON between the core and its
//! panels, so its enum keeps serde's default tagging, which both read; an internally tagged
//! enum needs a format that describes itself, which postcard isn't.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cockpit::CockpitKind;

/// The feature's name: its unit's, its panel module's, which tags the `unit` messages each
/// sends the other, and its slice's. `NAME` in src/features/pointer-sync/panel/src/module.ts
/// names it too, and so does the module's file, panel/pointer-sync.ts, which the build makes
/// /DualInput/modules/pointer-sync.js, so change all three together.
pub const NAME: &str = "pointer-sync";

/// A gesture's cockpit kind, keyed by its instrument's key. It neither holds a key's newest
/// message nor collapses in a replay, since every move of a drag plays.
pub const GESTURE: CockpitKind<Gesture> = CockpitKind::new(10);

/// One message of a gesture. Its point is `point` rather than `at`, since the Coherent GT check
/// reads any `.at` in our code in the sim as `Array.prototype.at`, which the engine lacks.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "pointer-sync/")]
pub enum Gesture {
    /// A button went down: 0 for the left, 1 the middle, 2 the right, as a `MouseEvent`'s
    /// `button`.
    Down {
        button: u8,
        point: Point,
    },
    Move {
        point: Point,
    },
    /// 1s passed with nothing else sent, so a press held still keeps its lock on the other
    /// machines and its length in a replay.
    Held,
    /// That button went up, `click` when the pointer never got 4px from the down.
    Up {
        point: Point,
        click: bool,
    },
}

/// A point, in fractions of the display's bounding rect, never clamped, so a drag that leaves
/// the display goes on past 0 or 1.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "pointer-sync/")]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

/// What the panel module sends its feature, in a `unit` message tagged `pointer-sync`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "pointer-sync/")]
pub enum FromPanel {
    /// The instruments the module serves in its panel, by key, as it starts, and none as it
    /// stops.
    Displays { displays: Vec<String> },
    /// One message of a gesture its pilot made on an instrument, by the instrument's key.
    Gesture { display: String, gesture: Gesture },
    /// It played the up numbered `up` through, or had no gesture playing to end with it.
    Done { up: u32 },
}

/// Another pilot's gesture message, which the feature sends each panel serving an instrument
/// of its key.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "pointer-sync/")]
pub struct Play {
    pub display: String,
    pub gesture: Gesture,
    /// For an up, its number, which the module's `Done` names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub up: Option<u32>,
}

/// The visible lock's slice, `pointer-sync`: why every synced display on this machine locks, if
/// it does.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "pointer-sync/")]
pub enum Lock {
    #[default]
    None,
    /// This machine isn't the PF's, and has no link up to the PF.
    NoLink,
    /// A replay or a catch-up runs here.
    CatchingUp,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A gesture reads back from both of the formats it travels in.
    #[test]
    fn a_gesture_reads_back_from_postcard_and_json() {
        let point = Point { x: 0.25, y: -0.5 };
        for g in [
            Gesture::Down { button: 2, point },
            Gesture::Move { point },
            Gesture::Held,
            Gesture::Up { point, click: true },
        ] {
            let bytes = postcard::to_stdvec(&g).expect("a gesture should encode");
            assert_eq!(postcard::from_bytes::<Gesture>(&bytes).ok(), Some(g));
            let json = serde_json::to_string(&g).expect("a gesture should encode");
            assert_eq!(serde_json::from_str::<Gesture>(&json).ok(), Some(g));
        }
        assert_eq!(
            serde_json::to_string(&Gesture::Held).ok().as_deref(),
            Some("\"held\"")
        );
    }
}
