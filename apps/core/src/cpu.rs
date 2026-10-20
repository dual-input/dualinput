//! The CPU: keeping the core's math the same on every one, as a replay needs, and naming it
//! in the recording's header.

unsafe extern "C" {
    /// The C runtime's switch for its FMA3 math, which it turns on at startup on a CPU that
    /// has FMA3. Neither windows-sys nor libc declares it, so we do.
    fn _set_FMA3_enable(flag: i32) -> i32;
}

/// Rust's `f64` functions and QuickJS-ng's `Math` call the C runtime, whose results changed
/// with its FMA3 switch (measured on our development machine, 2026-10-15,
/// record/areas/core/log.md). So the core turns FMA3 off before it starts any thread, in a
/// run and in a replay alike, and links the C runtime statically, so its version doesn't
/// follow the pilot's Windows.
pub fn fma3_off() {
    // SAFETY: the function takes a flag and returns the previous one, and touches nothing
    // else.
    unsafe { _set_FMA3_enable(0) };
}

/// The CPU's name, as it gives it, and whether it has FMA3, for the recording's header, so
/// a replay on another CPU says so.
pub fn cpu() -> (String, bool) {
    use std::arch::x86_64::__cpuid;
    let mut name = Vec::with_capacity(48);
    for leaf in 0x8000_0002..=0x8000_0004 {
        let r = __cpuid(leaf);
        for word in [r.eax, r.ebx, r.ecx, r.edx] {
            name.extend_from_slice(&word.to_le_bytes());
        }
    }
    let name = String::from_utf8_lossy(&name)
        .trim_matches(char::from(0))
        .trim()
        .to_string();
    (name, std::arch::is_x86_feature_detected!("fma"))
}
