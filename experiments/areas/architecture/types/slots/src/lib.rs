//! p07's data slots: structs shaped like the ones the core and our WASM module
//! trade through SimConnect client data areas. The core builds for x86_64 and
//! the module for wasm32, and both read the same bytes, so each struct's size
//! and field offsets are asserted at compile time. This crate compiling for both
//! targets means both layouts equal the numbers below.
//!
//! `Unpinned` holds a `usize`, which is 8 bytes on x86_64 and 4 on wasm32, and
//! its assertions differ by target on purpose: they show the drift a struct
//! with a pointer-sized field would carry between the two builds.

use core::mem::{align_of, offset_of, size_of};

/// The core's control slot: the session's state and a counter, written every 200ms.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Control {
    pub counter: u32,
    pub state: u8,
    pub _pad: [u8; 3],
    pub sent_at_us: u64,
    pub session: [u8; 16],
}

const _: () = {
    assert!(size_of::<Control>() == 32);
    assert!(align_of::<Control>() == 8);
    assert!(offset_of!(Control, counter) == 0);
    assert!(offset_of!(Control, state) == 4);
    assert!(offset_of!(Control, sent_at_us) == 8);
    assert!(offset_of!(Control, session) == 16);
};

/// A pose sample, with the padding the compiler adds left implicit: after `seq`,
/// 4 bytes of padding put `lat` on an 8-byte boundary.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Pose {
    pub seq: u32,
    pub lat: f64,
    pub lon: f64,
    pub alt: f64,
    pub pitch: f32,
    pub bank: f32,
    pub heading: f32,
}

const _: () = {
    assert!(size_of::<Pose>() == 48);
    assert!(offset_of!(Pose, seq) == 0);
    assert!(offset_of!(Pose, lat) == 8);
    assert!(offset_of!(Pose, lon) == 16);
    assert!(offset_of!(Pose, alt) == 24);
    assert!(offset_of!(Pose, pitch) == 32);
    assert!(offset_of!(Pose, bank) == 36);
    assert!(offset_of!(Pose, heading) == 40);
};

/// A struct with a pointer-sized field, which no slot may hold.
#[repr(C)]
pub struct Unpinned {
    pub flag: u8,
    pub count: usize,
}

#[cfg(target_pointer_width = "64")]
const _: () = assert!(size_of::<Unpinned>() == 16 && offset_of!(Unpinned, count) == 8);
#[cfg(target_pointer_width = "32")]
const _: () = assert!(size_of::<Unpinned>() == 8 && offset_of!(Unpinned, count) == 4);

/// The layout as text, which p07-quickjs prints from the x86_64 build.
pub fn layout() -> String {
    format!(
        "Control size {} align {} offsets counter {} state {} sent_at_us {} session {}; Pose size {} offsets seq {} lat {} heading {}; Unpinned size {} offset count {}",
        size_of::<Control>(),
        align_of::<Control>(),
        offset_of!(Control, counter),
        offset_of!(Control, state),
        offset_of!(Control, sent_at_us),
        offset_of!(Control, session),
        size_of::<Pose>(),
        offset_of!(Pose, seq),
        offset_of!(Pose, lat),
        offset_of!(Pose, heading),
        size_of::<Unpinned>(),
        offset_of!(Unpinned, count),
    )
}

/// Where the layout's numbers sit in the wasm32 build's memory, so the probe can
/// instantiate that build in Node and read them.
#[no_mangle]
pub extern "C" fn p07_layout() -> *const u32 {
    P07_LAYOUT.as_ptr()
}

/// The layout's numbers, in the order `layout` prints them.
pub static P07_LAYOUT: [u32; 12] = [
    size_of::<Control>() as u32,
    align_of::<Control>() as u32,
    offset_of!(Control, counter) as u32,
    offset_of!(Control, state) as u32,
    offset_of!(Control, sent_at_us) as u32,
    offset_of!(Control, session) as u32,
    size_of::<Pose>() as u32,
    offset_of!(Pose, seq) as u32,
    offset_of!(Pose, lat) as u32,
    offset_of!(Pose, heading) as u32,
    size_of::<Unpinned>() as u32,
    offset_of!(Unpinned, count) as u32,
];
