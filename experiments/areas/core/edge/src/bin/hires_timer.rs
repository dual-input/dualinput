//! How late a high-resolution waitable timer wakes on Windows, waited on by a
//! thread of its own.

use std::ffi::c_void;
use std::time::Instant;

const CREATE_WAITABLE_TIMER_HIGH_RESOLUTION: u32 = 0x0000_0002;
const TIMER_ALL_ACCESS: u32 = 0x001F_0003;
const INFINITE: u32 = 0xFFFF_FFFF;

#[link(name = "kernel32")]
extern "system" {
    fn CreateWaitableTimerExW(attrs: *const c_void, name: *const u16, flags: u32, access: u32) -> *mut c_void;
    fn SetWaitableTimer(h: *mut c_void, due: *const i64, period: i32, routine: *const c_void, arg: *const c_void, resume: i32) -> i32;
    fn WaitForSingleObject(h: *mut c_void, ms: u32) -> u32;
}

fn main() {
    let h = unsafe { CreateWaitableTimerExW(std::ptr::null(), std::ptr::null(), CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS) };
    assert!(!h.is_null(), "CreateWaitableTimerExW failed");
    for ms in [1u64, 2, 5, 10, 16, 20, 50, 200] {
        let n = if ms >= 50 { 20 } else { 60 };
        let mut late: Vec<f64> = vec![];
        for _ in 0..n {
            // Relative, in 100ns units.
            let due: i64 = -((ms * 10_000) as i64);
            let t = Instant::now();
            unsafe {
                SetWaitableTimer(h, &due, 0, std::ptr::null(), std::ptr::null(), 0);
                WaitForSingleObject(h, INFINITE);
            }
            late.push(t.elapsed().as_secs_f64() * 1e3 - ms as f64);
        }
        late.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let p = |q: f64| late[((q * late.len() as f64).ceil() as usize).clamp(1, late.len()) - 1];
        println!("high-resolution waitable timer\tsleep {ms}ms\t{n} runs\tlate by p50 {:.2}ms\tp99 {:.2}ms\tmax {:.2}ms", p(0.5), p(0.99), late[late.len() - 1]);
    }
}
