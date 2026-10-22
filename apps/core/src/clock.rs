//! The core's one clock: Windows' performance counter, in µs.

use std::sync::OnceLock;

use windows_sys::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

/// Now, in µs on the PC's performance counter, which every stamp in the core uses
/// (record/areas/architecture/01-spine.md, "Times"). The conversion runs in 128 bits,
/// since at the 10 MHz Windows fixes the counter at under a hypervisor, ticks times
/// 1,000,000 passes a signed 64-bit integer, which the counter is, after about 10.7 days of
/// the PC running. The core helper stamps its inputs the same way, in apps/core-helper's
/// `clock::now` and the bench's stand-in's `now`, so change all three together.
pub fn now() -> u64 {
    let mut ticks = 0;
    // SAFETY: QueryPerformanceCounter writes one i64 to the pointer it's given.
    unsafe { QueryPerformanceCounter(&mut ticks) };
    let micros = u128::from(ticks.unsigned_abs()) * 1_000_000 / u128::from(frequency());
    u64::try_from(micros).expect("µs since the PC started should fit in 64 bits")
}

fn frequency() -> u64 {
    static FREQUENCY: OnceLock<u64> = OnceLock::new();
    *FREQUENCY.get_or_init(|| {
        let mut frequency = 0;
        // SAFETY: QueryPerformanceFrequency writes one i64 to the pointer it's given.
        unsafe { QueryPerformanceFrequency(&mut frequency) };
        frequency.unsigned_abs().max(1)
    })
}
