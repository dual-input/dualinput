//! The two clocks every record carries.
//!
//! `mono_us` is the counter the spine stamps with: `QueryPerformanceCounter` on Windows, in
//! whole µs ([01-spine](../../../../../../record/areas/architecture/01-spine.md#times)), and
//! `CLOCK_MONOTONIC` on the droplets. `wall_us` is the system clock, which Windows' time
//! service steers, so it's recorded beside the counter and never used to measure a span.

#[cfg(windows)]
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(windows)]
fn qpc_frequency() -> u64 {
    static FREQ: OnceLock<u64> = OnceLock::new();
    *FREQ.get_or_init(|| {
        let mut f = 0i64;
        // SAFETY: writes one i64 through a valid pointer.
        unsafe { windows_sys::Win32::System::Performance::QueryPerformanceFrequency(&mut f) };
        f.max(1) as u64
    })
}

/// The raw counter and its frequency, for a record that wants both.
#[cfg(windows)]
pub fn qpc_raw() -> (u64, u64) {
    let mut c = 0i64;
    // SAFETY: writes one i64 through a valid pointer.
    unsafe { windows_sys::Win32::System::Performance::QueryPerformanceCounter(&mut c) };
    (c as u64, qpc_frequency())
}

/// Microseconds on the monotonic counter. The product runs in 128 bits because at 10 MHz,
/// ticks times 1,000,000 passes 64 bits after about 10.7 days of uptime.
#[cfg(windows)]
pub fn mono_us() -> u64 {
    let (c, f) = qpc_raw();
    ((c as u128 * 1_000_000u128) / f as u128) as u64
}

#[cfg(unix)]
pub fn qpc_raw() -> (u64, u64) {
    (mono_ns(), 1_000_000_000)
}

#[cfg(unix)]
fn mono_ns() -> u64 {
    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: writes one timespec through a valid pointer.
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) };
    ts.tv_sec as u64 * 1_000_000_000 + ts.tv_nsec as u64
}

#[cfg(unix)]
pub fn mono_us() -> u64 {
    mono_ns() / 1000
}

/// The system clock in µs since 1970. On Windows, std reads it with
/// `GetSystemTimePreciseAsFileTime`.
pub fn wall_us() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_micros() as i64,
        Err(e) => -(e.duration().as_micros() as i64),
    }
}

/// The system clock in ns, which the stations answer clock requests with, since chrony keeps
/// a droplet's clock on internet time. An i64 holds ns since 1970 until 2262, and serde
/// can't decode an i128 inside an internally tagged enum such as `Ctl`.
pub fn wall_ns() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_nanos() as i64,
        Err(e) => -(e.duration().as_nanos() as i64),
    }
}
