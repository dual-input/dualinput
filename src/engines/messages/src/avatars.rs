//! Avatars' messages: each pilot's pose, which their core sends the crew, and the routine
//! `Figure`, which draws every figure in our WASM module (record/areas/avatars/01-avatars.md,
//! "The pose" and "Feeding `Figure`").

pub mod slots;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::module::RoutineId;
use crate::net::{Channel, Delivery, OneOff, Wait};
use crate::session::MatchItem;

/// Whether this machine read the aircraft's models, the match check's item, at the `info`
/// level: a pilot whose machine can't learns before the flight why their clicks bring no
/// hand (user, 2026-10-25; record/areas/avatars/log.md).
pub const MODEL: MatchItem<ModelRead> = MatchItem::new(5);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModelRead {
    Read,
    Unreadable,
}

/// The slice `avatars`, an `AvatarsSlice`.
pub const SLICE: &str = "avatars";

/// What the Figures tab shows of the feature's state.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "avatars/")]
pub struct AvatarsSlice {
    pub note: Option<AircraftNote>,
}

/// Why the figures do less in the loaded aircraft, which the tab says at its top rather than
/// in a notification, since it would come back on every flight in that aircraft
/// (record/areas/interface/decisions.md, "The Figures tab holds the pilot's figure and explains
/// what its figures can do").
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "avatars/")]
pub enum AircraftNote {
    /// This machine can't read the aircraft's model files, so a click brings no hand.
    Model,
    /// The profile has no seats, so figures show as heads alone.
    Seats,
}

/// The gray a slumped figure turns, which follows `session::PALETTE`'s colors in the figure's
/// own palette. The figure's source, in src/features/avatars/figure/, lays it out so.
pub const GRAY: u8 = crate::session::PALETTE.len() as u8;

/// Each pilot's pose, as one-off packets of which only the newest waits to go, handed over
/// after the flight model's and ATC audio's and before traffic's
/// (record/areas/network/01-between-machines.md, "Channels" and "Sending").
pub const POSES: Channel<Pose> = Channel::new(5, Delivery::Newest, 150);

/// The routine that eases, solves, and places every figure each frame.
pub const FIGURE: RoutineId = RoutineId {
    name: "FIGURE",
    freezes: false,
};

/// Everything one pilot's figure shows. Every point is in the aircraft's frame, in meters
/// from its reference point, x left, y up, and z forward, the frame a profile's `location`
/// uses, so one aircraft drawn a little apart on two machines still has the figure in the
/// same place on it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Pose {
    /// When the sender made it, in µs on its counter, which orders one sender's poses.
    pub at: u64,
    pub body: Body,
    /// The left hand, then the right.
    pub hands: [Hand; 2],
}

impl OneOff for Pose {
    /// A connection is to one member, who sends only their own figure's pose.
    fn wait(&self) -> Wait {
        Wait::Newest { key: 0 }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Body {
    /// In the seat whose key a profile's `seats` gives, with the head at `eye` looking along
    /// `look`: the camera, or in an outside view the seat's eye looking forward.
    Seated {
        seat: String,
        eye: [f32; 3],
        look: [f32; 3],
    },
    /// Inside the aircraft in no seat, a head at the camera.
    Head { eye: [f32; 3], look: [f32; 3] },
    /// Walking: where the feet stand, which way the figure faces in degrees from the
    /// aircraft's nose, positive to the right, and whether it crouches.
    OnFoot {
        at: [f32; 3],
        heading: f32,
        crouch: bool,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum Hand {
    /// On the thigh.
    Rest,
    /// On the yoke on that side of the centerline, at its grip for this hand, which each
    /// machine finds from its own copy of the aircraft's model.
    Grip(Side),
    /// On a button of the seat's own yoke, at this point in the frame of the yoke's last
    /// animated node, while the yoke moves.
    Thumb([f32; 3]),
    /// The hand's center at this point.
    Point([f32; 3]),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Side {
    Left,
    Right,
}
