//! `Figure`'s slot, which the routine reads in place. build.rs hashes every file named
//! `slots.rs` into `SLOTS_HASH`, so a change here gives a build another hash.
//!
//! The slot holds every figure this machine draws and each yoke's animations, within the
//! 8,192 bytes of a client data area, its header included
//! (record/areas/architecture/02-code-map.md, "Routines in our WASM module"). Its size is
//! checked below, so a field added past that fails the build.

use bytemuck::{Pod, Zeroable};

/// The most figures one slot holds: a crew of eight, each pilot's own figure included.
pub const FIGURES: usize = 8;

/// The frames a yoke's stage holds across its animation, as `aircraft-model` samples them.
pub const SAMPLES: usize = 21;

/// What `Figure` is fed: each yoke, then each figure, the first `count` in use.
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
#[repr(C)]
pub struct FigureSlot {
    /// The pilot's yoke, left of the centerline, then the copilot's.
    pub yokes: [YokeSlot; 2],
    pub figures: [FigureState; FIGURES],
    pub count: u32,
}

/// One yoke, from this machine's own copy of the aircraft's model, or none when it has no
/// such yoke or couldn't read its model.
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
#[repr(C)]
pub struct YokeSlot {
    /// 1 when the yoke is there.
    pub present: u32,
    /// How many of `stages` are in use, up to 2. With none, `base` is the grips' frame.
    pub stage_count: u32,
    /// The frame the first stage's node sits in, a 3x4 matrix in columns, in the aircraft's
    /// frame, with the yoke centered.
    pub base: [f32; 12],
    /// Where the left hand's and the right hand's centers go, in the frame of the last
    /// stage's node.
    pub grips: [[f32; 3]; 2],
    pub stages: [StageSlot; 2],
}

/// One of a yoke's animated nodes, whose frame is linear in one variable of the aircraft's.
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
#[repr(C)]
pub struct StageSlot {
    /// The variable, with its prefix, such as `A:YOKE Y POSITION WITH AP`, padded with zero
    /// bytes, and its unit, such as `percent`.
    pub var: [u8; 64],
    pub unit: [u8; 16],
    /// The animation's frame is `slope × value + intercept`, out of `length`.
    pub slope: f32,
    pub intercept: f32,
    pub length: f32,
    /// From the frame before, `base` or the previous stage's node, to this node's parent.
    pub before: [f32; 12],
    pub scale: [f32; 3],
    /// The node's translation, then its rotation as a quaternion `x, y, z, w`, at each of
    /// `SAMPLES` frames from 0 to `length`.
    pub samples: [[f32; 7]; SAMPLES],
}

/// One figure: its object, its seat, how it shows, and its pose.
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
#[repr(C)]
pub struct FigureState {
    /// The object `create_ai` made for it.
    pub object: u32,
    /// A palette index, which `Z:DUALINPUT_FIGURE_COLOR` carries.
    pub color: u32,
    /// Which parts show, from `SHOWS_*`.
    pub shows: u32,
    /// 1 while the figure slumps, its member out of the flight or out of reach.
    pub slumps: u32,
    /// The seat's hip, in the aircraft's frame, and its knees, feet, and facing, as a
    /// profile's `seats` gives them, while it sits.
    pub hip: [f32; 3],
    pub knees: [f32; 2],
    pub feet: [f32; 2],
    pub facing: f32,
    pub pose: PoseSlot,
}

/// Every part shows.
pub const SHOWS_ALL: u32 = SHOWS_BODY | SHOWS_HEAD | SHOWS_HANDS;
pub const SHOWS_BODY: u32 = 1;
/// The head and neck, which this pilot's own figure hides in the cockpit, since its head
/// sits at the camera.
pub const SHOWS_HEAD: u32 = 1 << 1;
pub const SHOWS_HANDS: u32 = 1 << 2;
/// The hands faded, as this pilot's own figure shows them.
pub const SHOWS_FADED: u32 = 1 << 3;

/// A `Pose`, laid out for the routine.
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
#[repr(C)]
pub struct PoseSlot {
    /// `BODY_SEATED`, `BODY_HEAD`, or `BODY_ON_FOOT`.
    pub body: u32,
    pub eye: [f32; 3],
    pub look: [f32; 3],
    /// On foot: where the feet stand, the heading in degrees from the nose, and 1 while it
    /// crouches.
    pub at: [f32; 3],
    pub heading: f32,
    pub crouch: u32,
    /// The left hand, then the right.
    pub hands: [HandSlot; 2],
}

pub const BODY_SEATED: u32 = 0;
pub const BODY_HEAD: u32 = 1;
pub const BODY_ON_FOOT: u32 = 2;

/// A `Hand`, laid out for the routine: `HAND_REST`, `HAND_GRIP` on the yoke `side` names,
/// 0 for the left, `HAND_THUMB`, or `HAND_POINT`, with its point.
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
#[repr(C)]
pub struct HandSlot {
    pub kind: u32,
    pub side: u32,
    pub point: [f32; 3],
}

pub const HAND_REST: u32 = 0;
pub const HAND_GRIP: u32 = 1;
pub const HAND_THUMB: u32 = 2;
pub const HAND_POINT: u32 = 3;

const _: () = assert!(
    size_of::<crate::module::slots::SlotHeader>() + size_of::<FigureSlot>() <= 8_192,
    "Figure's slot, its header included, fits a client data area's 8,192 bytes"
);
