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
