//! Flight-model sync's slots, which its routines read and write in place: `Lead`'s report,
//! and `Follow`'s slot. build.rs hashes every file named `slots.rs` into `SLOTS_HASH`, so a
//! change here gives a build another hash.

use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};

/// The aircraft at one moment, each field as the sim's variable gives it
/// (record/areas/flight-model/01-flight-model-sync.md, "The sample"). Position stays `f64`,
/// since an `f32` latitude steps by about 0.4m.
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable, Serialize, Deserialize)]
#[repr(C)]
pub struct Snapshot {
    /// `A:PLANE LATITUDE` and `A:PLANE LONGITUDE`, in radians.
    pub lat: f64,
    pub lon: f64,
    /// `A:PLANE ALTITUDE`, in feet MSL.
    pub alt: f64,
    /// `A:PLANE PITCH DEGREES`, `A:PLANE BANK DEGREES`, and `A:PLANE HEADING DEGREES TRUE`, in
    /// radians, pitch and bank negative for nose up and right wing down, as the sim has them.
    pub pitch: f32,
    pub bank: f32,
    pub heading: f32,
    /// `A:VELOCITY BODY X`, `Y`, and `Z`, in feet per second.
    pub velocity: [f32; 3],
    /// `A:ROTATION VELOCITY BODY X`, `Y`, and `Z`, in radians per second.
    pub rotation: [f32; 3],
    /// `A:AILERON POSITION`, `A:ELEVATOR POSITION`, and `A:RUDDER POSITION`, in Position 16k,
    /// −16,384 to 16,384.
    pub surfaces: [i16; 3],
    /// `A:BRAKE LEFT POSITION` and `A:BRAKE RIGHT POSITION`, 0 to 32,767, 0 off.
    pub brakes: [u16; 2],
    /// Fills the struct to a multiple of its alignment, since a slot's struct can have no
    /// padding. A sample between cores leaves it out.
    #[serde(skip)]
    pub pad: u16,
}

/// One read of the flying aircraft: `Lead`'s report, and the message its core sends the crew.
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable, Serialize, Deserialize)]
#[repr(C)]
pub struct Sample {
    /// When `Lead` read it, the frame's time in µs on its core's counter. `Follow` is fed it
    /// moved onto the following core's counter.
    pub at: u64,
    pub snapshot: Snapshot,
}

/// `Lead`'s slot, which carries nothing: the routine reads the aircraft on its own clock.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pod, Zeroable)]
#[repr(C)]
pub struct LeadSlot {}

/// What `Follow` is fed: the newest sample, with how far behind the samples it draws.
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct FollowSlot {
    /// How far behind the samples `Follow` draws the aircraft, in µs.
    pub delay: u64,
    /// 1 when `sample` holds one. The feed that starts `Follow` holds none, so the aircraft
    /// freezes before the first sample arrives.
    pub has_sample: u64,
    pub sample: Sample,
}
