//! The routines' slots, which the module reads in place. build.rs hashes every file named
//! `slots.rs` into `SLOTS_HASH`, so a change here gives a build another hash, and a module
//! from the build before ignores this build's feeds.

use bytemuck::{Pod, Zeroable};

/// What starts every routine's slot. The core writes it with each feed, and again every
/// 200ms until the next one, so the routine host can tell a new feed from a rewrite, and a
/// routine's end from a core that stopped writing
/// (record/areas/architecture/02-code-map.md, "Routines in our WASM module").
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pod, Zeroable)]
#[repr(C)]
pub struct SlotHeader {
    /// How many times the feature has fed the routine, so a rewrite of the last feed
    /// carries the same count.
    pub feeds: u32,
    /// 1 once the feature has ended the routine, until its next feed.
    pub end: u32,
    /// The `SLOTS_HASH` of the core's build.
    pub slots_hash: u64,
    /// The stamp of the input the core was handling when it wrote, in µs on the PC's
    /// performance counter.
    pub counter: u64,
}

/// `Hold`'s slot, which carries nothing: the routine only asks for the freeze.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pod, Zeroable)]
#[repr(C)]
pub struct HoldSlot {}

/// `Camera`'s slot, which carries nothing: the routine reads the camera in both referentials
/// while it runs.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pod, Zeroable)]
#[repr(C)]
pub struct CameraSlot {}

/// The camera in one referential, as `SimConnect_CameraGet` and `fsCameraGet` give it
/// (record/areas/core/03-sim-seam-and-wasm-module.md, the note on the camera).
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct CameraRead {
    /// In meters from the aircraft's reference point, x left, y up, and z forward, in
    /// `SIMOBJECT`'s referential; latitude and longitude in degrees and altitude in meters
    /// in `WORLD`'s.
    pub position: [f64; 3],
    /// The view's height, in radians, as `SimConnect_CameraGet` gives it. Whether
    /// `fsCameraGet`'s is the same is unverified, and a click on a target whose place is known,
    /// whose ray reads it, settles it.
    pub fov: f64,
    /// In degrees, as the sim's three angles carry them: the pitch, then the yaw, then the
    /// roll.
    pub pitch: f32,
    pub yaw: f32,
    pub roll: f32,
    /// The referential, `SIMCONNECT_POSITION_REFERENTIAL_SIMOBJECT` or `_WORLD`.
    pub referential: u32,
}

/// `Camera`'s report each frame: the camera in both referentials, read during the routine's
/// frame, before any routine's writes go out.
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct CameraReport {
    pub simobject: CameraRead,
    pub world: CameraRead,
}
