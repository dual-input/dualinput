//! The one timeline every process on the PC reads, Windows' performance counter, in µs, so
//! the core can compare the helper's stamps with its own (record/areas/architecture/01-spine.md,
//! "Times"). `clock::now` in apps/core and the bench's stand-in core helper's `now` read it
//! the same way, so change all three together.

use std::sync::OnceLock;

use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

/// Now, in µs on the performance counter. The conversion runs in 128 bits, since ticks times
/// 1,000,000 passes a signed 64-bit integer after about 10.7 days of the PC running.
pub fn now() -> u64 {
    let mut ticks = 0;
    // SAFETY: QueryPerformanceCounter writes one i64 to the pointer it's given.
    let _ = unsafe { QueryPerformanceCounter(&mut ticks) };
    let micros = u128::from(ticks.unsigned_abs()) * 1_000_000 / u128::from(frequency());
    u64::try_from(micros).unwrap_or(u64::MAX)
}

fn frequency() -> u64 {
    static FREQUENCY: OnceLock<u64> = OnceLock::new();
    *FREQUENCY.get_or_init(|| {
        let mut frequency = 0;
        // SAFETY: QueryPerformanceFrequency writes one i64 to the pointer it's given.
        let _ = unsafe { QueryPerformanceFrequency(&mut frequency) };
        frequency.unsigned_abs().max(1)
    })
}

/// A stamp WASAPI gives, the performance counter's value in 100ns units, in µs.
pub fn from_wasapi(position: u64) -> u64 {
    position / 10
}
