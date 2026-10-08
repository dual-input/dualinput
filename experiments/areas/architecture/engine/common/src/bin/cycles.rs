//! Reads a process's CPU use as cycles, for p04's CPU figure:
//!
//!   p04-cycles.exe rate     cycles a second, from 500ms of spinning
//!   p04-cycles.exe <pid>    cycles the process's threads have used so far
//!
//! Windows charges GetProcessTimes and Node's process.cpuUsage() in whole clock
//! ticks of 15.625ms, to whichever thread is running when the tick lands, so a
//! process that wakes 60 times a second for 100µs reads anywhere from none of
//! its time to several times it. QueryProcessCycleTime counts the cycles each
//! thread ran.

use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::CloseHandle;
use windows_sys::Win32::System::Threading::{GetCurrentThread, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
use windows_sys::Win32::System::WindowsProgramming::{QueryProcessCycleTime, QueryThreadCycleTime};

fn main() {
    let arg = std::env::args().nth(1).expect("usage: p04-cycles rate | <pid>");
    if arg == "rate" {
        let thread_cycles = || {
            let mut c = 0u64;
            unsafe { QueryThreadCycleTime(GetCurrentThread(), &mut c) };
            c
        };
        let (c0, t0) = (thread_cycles(), Instant::now());
        while t0.elapsed() < Duration::from_millis(500) {
            std::hint::spin_loop();
        }
        let rate = (thread_cycles() - c0) as f64 / t0.elapsed().as_secs_f64();
        println!("{{\"cycles_per_second\":{rate}}}");
        return;
    }
    let pid: u32 = arg.parse().expect("a process id");
    let mut cycles = 0u64;
    let ok = unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        let ok = !h.is_null() && QueryProcessCycleTime(h, &mut cycles) != 0;
        if !h.is_null() {
            CloseHandle(h);
        }
        ok
    };
    if !ok {
        eprintln!("could not read process {pid}");
        std::process::exit(1);
    }
    println!("{{\"cycles\":{cycles}}}");
}
