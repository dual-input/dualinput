//! What p04's two engine programs share: the limits, the frame schedule, the
//! host's record of what the write functions wrote, the process's memory and CPU
//! as Windows reports them, and the lines the programs print for the runner.
//!
//! Each program prints `TAG {json}` lines on stdout and waits on stdin for the
//! runner's `IDLE` and `GO`, so the runner can read the process's memory from
//! the OS while the engine sits idle after loading, and for `BEGIN` before the
//! frames and `CONTINUE` after them, so the runner can read the process's
//! cycle count on each side of the frames with p04-cycles.

use std::fmt::Write as _;
use std::io::{BufRead, Write as _};
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::FILETIME;
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
};
use windows_sys::Win32::System::ProcessStatus::{
    GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

/// 60 frames a second for 10s.
pub const FRAMES: u32 = 600;
pub const FRAME: Duration = Duration::from_nanos(16_666_667);
pub const WRITERS: usize = 100;

/// What the engine may hold: QuickJS's whole runtime, V8's heap and, through a
/// counting allocator, V8's ArrayBuffers.
pub const MEMORY_LIMIT: usize = 64 << 20;
/// How long one frame's calls, or one runaway call, may run before the host stops it.
pub const TIME_LIMIT: Duration = Duration::from_millis(100);
/// Frames the host runs, unpaced, after each runaway to check it still works.
pub const CHECK_FRAMES: u32 = 10;
/// Megabytes of ArrayBuffers the buffer runaway asks for: four times the limit.
pub const BUFFER_MB: u32 = 256;

/// The runaway calls in the order the hosts make them: the test's name, the
/// function in runaway.ts, its argument, and how long the host lets it run. The
/// memory tests get 10s, so the time limit can't be what stops them. The
/// allocation runaway goes last, because if no limit stops it the engine ends
/// the process.
pub const RUNAWAYS: [(&str, &str, f64, Duration); 4] = [
    ("loop", "loopForever", 0.0, TIME_LIMIT),
    ("buffers", "allocBuffers", BUFFER_MB as f64, Duration::from_secs(10)),
    ("recursion", "recurseForever", 0.0, Duration::from_secs(10)),
    ("alloc", "allocForever", 0.0, Duration::from_secs(10)),
];

/// The engines run on a thread of their own with this much stack, because a
/// Windows main thread has 1 MB, and V8's default stack limit assumes about
/// that much for V8 alone.
pub const STACK: usize = 8 << 20;

/// The most memory the process may commit, enforced by Windows rather than by
/// the engine. It isn't one of the limits under test. An engine limit that
/// fails lets a runaway grow until the machine runs out: a V8 near-heap-limit
/// callback that raised the limit while termination never landed reached 22 GB
/// before we stopped it. Past this cap an allocation fails, and the engine
/// either reports it or ends the process.
pub const PROCESS_CAP: usize = 1 << 30;

/// Puts this process in a job object capped at PROCESS_CAP. Returns false if
/// Windows refused.
pub fn cap_process_memory() -> bool {
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return false;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY;
        info.ProcessMemoryLimit = PROCESS_CAP;
        let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
        SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info as *const _ as *const _, size) != 0
            && AssignProcessToJobObject(job, GetCurrentProcess()) != 0
    }
}

/// The value write function `i` receives in `frame`: 0 to 99.5 in steps of 0.5,
/// exact in binary, so every engine computes the same writes.
pub fn input(frame: u32, i: usize) -> f64 {
    ((frame as usize * 7 + i * 13) % 200) as f64 / 2.0
}

/// What the host saw cross into it from the write functions.
#[derive(Default, Clone, Copy, PartialEq)]
pub struct Sink {
    pub calls: u64,
    pub sum: f64,
    pub name_bytes: u64,
}

impl Sink {
    pub fn record(&mut self, name: &str, values: &[f64]) {
        self.calls += 1;
        self.name_bytes += name.len() as u64;
        for v in values {
            self.sum += v;
        }
    }

    pub fn since(&self, before: &Sink) -> Sink {
        Sink {
            calls: self.calls - before.calls,
            sum: self.sum - before.sum,
            name_bytes: self.name_bytes - before.name_bytes,
        }
    }

    pub fn json(&self) -> String {
        Json::new()
            .int("calls", self.calls)
            .num("sum", self.sum)
            .int("name_bytes", self.name_bytes)
            .done()
    }
}

pub struct Bundles {
    pub plugin: String,
    pub writers: String,
    pub runaway: String,
}

impl Bundles {
    pub fn read(dist: &str) -> Bundles {
        let read = |name: &str| {
            std::fs::read_to_string(std::path::Path::new(dist).join(name))
                .unwrap_or_else(|e| panic!("{name}: {e}"))
        };
        Bundles { plugin: read("plugin.js"), writers: read("writers.js"), runaway: read("runaway.js") }
    }
}

pub struct Memory {
    pub working_set: usize,
    pub private: usize,
    pub peak_working_set: usize,
}

/// The process's working set and private bytes (commit charge), from
/// GetProcessMemoryInfo. Task Manager's private working set isn't here; the
/// runner reads it from the OS.
pub fn memory() -> Memory {
    let mut c: PROCESS_MEMORY_COUNTERS_EX = unsafe { std::mem::zeroed() };
    c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;
    unsafe {
        GetProcessMemoryInfo(GetCurrentProcess(), &mut c as *mut _ as *mut PROCESS_MEMORY_COUNTERS, c.cb);
    }
    Memory { working_set: c.WorkingSetSize, private: c.PrivateUsage, peak_working_set: c.PeakWorkingSetSize }
}

impl Memory {
    pub fn json(&self) -> String {
        Json::new()
            .mb("working_set_mb", self.working_set)
            .mb("private_mb", self.private)
            .mb("peak_working_set_mb", self.peak_working_set)
            .done()
    }
}

/// User and kernel time of every thread in the process, V8's own threads
/// included, in the whole 15.625ms clock ticks Windows charges it in. The
/// runner's cycle count is the figure to use; see src/bin/cycles.rs.
pub fn cpu_ms() -> f64 {
    let zero = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
    unsafe {
        GetProcessTimes(GetCurrentProcess(), &mut created, &mut exited, &mut kernel, &mut user);
    }
    let ticks = |t: FILETIME| ((t.dwHighDateTime as u64) << 32 | t.dwLowDateTime as u64) as f64;
    (ticks(kernel) + ticks(user)) / 10_000.0
}

pub struct Stats {
    pub mean: f64,
    pub p50: f64,
    pub p99: f64,
    pub max: f64,
}

pub fn stats(samples: &[f64]) -> Stats {
    let mut s = samples.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let at = |q: f64| s[((s.len() as f64 * q).ceil() as usize).clamp(1, s.len()) - 1];
    Stats { mean: s.iter().sum::<f64>() / s.len() as f64, p50: at(0.5), p99: at(0.99), max: s[s.len() - 1] }
}

/// The result of running every frame on schedule.
pub struct FrameRun {
    pub frame_us: Vec<f64>,
    pub wall_ms: f64,
    pub cpu_ms: f64,
    pub late_frames: u32,
}

/// Runs `frame` FRAMES times, each at its own slot on a 60Hz schedule, and
/// times each call. A frame that starts late runs at once, so the run always
/// has FRAMES frames in about FRAMES/60 seconds.
pub fn run_frames(mut frame: impl FnMut(u32)) -> FrameRun {
    let mut frame_us = Vec::with_capacity(FRAMES as usize);
    let mut late_frames = 0;
    let cpu0 = cpu_ms();
    let start = Instant::now();
    for f in 0..FRAMES {
        let slot = start + FRAME * f;
        let now = Instant::now();
        if slot > now {
            std::thread::sleep(slot - now);
        } else if now - slot > FRAME {
            late_frames += 1;
        }
        let t = Instant::now();
        frame(f);
        frame_us.push(t.elapsed().as_secs_f64() * 1e6);
    }
    FrameRun { frame_us, wall_ms: start.elapsed().as_secs_f64() * 1e3, cpu_ms: cpu_ms() - cpu0, late_frames }
}

impl FrameRun {
    pub fn json(&self, sink: &Sink, errors: u64) -> String {
        let s = stats(&self.frame_us);
        Json::new()
            .int("frames", self.frame_us.len() as u64)
            .num("mean_us", s.mean)
            .num("p50_us", s.p50)
            .num("p99_us", s.p99)
            .num("max_us", s.max)
            .num("first_us", self.frame_us[0])
            .num("wall_ms", self.wall_ms)
            .num("tick_cpu_ms", self.cpu_ms)
            .num("tick_cpu_percent", self.cpu_ms / self.wall_ms * 100.0)
            .int("late_frames", self.late_frames as u64)
            .int("errors", errors)
            .raw("sink", &sink.json())
            .done()
    }
}

/// Reads stdin until the runner sends `word`. Returns false if stdin closes first.
pub fn wait_for(word: &str) -> bool {
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        match line {
            Ok(l) if l.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}') == word => return true,
            Ok(_) => continue,
            Err(_) => return false,
        }
    }
    false
}

pub fn emit(tag: &str, json: &str) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{tag} {json}");
    let _ = out.flush();
}

pub fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1e3
}

/// A one-line JSON object, built by hand so the probe needs no serde.
pub struct Json(String);

impl Json {
    pub fn new() -> Json {
        Json(String::from("{"))
    }

    fn key(mut self, k: &str) -> Json {
        if self.0.len() > 1 {
            self.0.push(',');
        }
        let _ = write!(self.0, "\"{k}\":");
        self
    }

    pub fn num(self, k: &str, v: f64) -> Json {
        let mut j = self.key(k);
        if v.is_finite() {
            let _ = write!(j.0, "{v}");
        } else {
            j.0.push_str("null");
        }
        j
    }

    pub fn mb(self, k: &str, bytes: usize) -> Json {
        self.num(k, (bytes as f64 / 1048576.0 * 100.0).round() / 100.0)
    }

    pub fn int(self, k: &str, v: u64) -> Json {
        let mut j = self.key(k);
        let _ = write!(j.0, "{v}");
        j
    }

    pub fn bool(self, k: &str, v: bool) -> Json {
        let mut j = self.key(k);
        j.0.push_str(if v { "true" } else { "false" });
        j
    }

    pub fn str(self, k: &str, v: &str) -> Json {
        let mut j = self.key(k);
        j.0.push('"');
        for c in v.chars() {
            match c {
                '"' => j.0.push_str("\\\""),
                '\\' => j.0.push_str("\\\\"),
                c if (c as u32) < 0x20 => {
                    let _ = write!(j.0, "\\u{:04x}", c as u32);
                }
                c => j.0.push(c),
            }
        }
        j.0.push('"');
        j
    }

    pub fn raw(self, k: &str, json: &str) -> Json {
        let mut j = self.key(k);
        j.0.push_str(json);
        j
    }

    pub fn done(mut self) -> String {
        self.0.push('}');
        self.0
    }
}

impl Default for Json {
    fn default() -> Self {
        Json::new()
    }
}
