//! `Traffic`'s slot, which the routine reads in place. build.rs hashes every file named
//! `slots.rs` into `SLOTS_HASH`, so a change here gives a build another hash.

use bytemuck::{Pod, Zeroable};

/// How many entries one feed carries: a routine's slot holds 8,192 bytes, the header takes 24,
/// and an entry 80, so 100 leave room (record/areas/traffic-atc/01-traffic-and-atc.md,
/// "`Traffic`, each frame").
pub const ENTRIES: usize = 100;

/// What `Traffic` is fed: one batch's states, each with its copy's object ID, and an entry for
/// each copy removed since the last feed.
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct TrafficSlot {
    pub count: u32,
    /// Fills the struct to a multiple of its alignment, since a slot's struct can have no
    /// padding.
    pub pad: u32,
    pub entries: [Entry; ENTRIES],
}

impl Default for TrafficSlot {
    fn default() -> Self {
        Zeroable::zeroed()
    }
}

/// One copy at one moment, or its removal.
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct Entry {
    /// The copy's object ID in this sim.
    pub object: u32,
    /// 1 when the copy has been removed, and `Traffic` forgets it, since the sim can give its
    /// ID to an object created after it.
    pub removed: u32,
    /// When the traffic host read it, in µs on this core's counter.
    pub at: u64,
    /// `A:PLANE LATITUDE` and `A:PLANE LONGITUDE` in degrees, and `A:PLANE ALTITUDE` in feet MSL.
    pub lat: f64,
    pub lon: f64,
    pub alt: f64,
    /// `A:PLANE PITCH DEGREES`, `A:PLANE BANK DEGREES`, and `A:PLANE HEADING DEGREES TRUE`, in
    /// degrees.
    pub pitch: f32,
    pub bank: f32,
    pub heading: f32,
    /// `A:VELOCITY BODY X`, `Y`, and `Z`, in feet a second, and `A:ROTATION VELOCITY BODY X`,
    /// `Y`, and `Z`, in radians a second, which feed only a frozen object's animations and
    /// sounds.
    pub velocity: [f32; 3],
    pub rotation: [f32; 3],
    pub pad: u32,
}
