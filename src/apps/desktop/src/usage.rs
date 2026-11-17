//! What the desktop app takes of the PC, which its window's charts show a pilot who asks why it's always running. The window
//! has to agree with Task Manager or the pilot has no reason to believe it, so the figures are the private working set
//! Task Manager's Memory column shows, and they count the window's own WebView2 processes while it's open. They leave out
//! the core, which runs for the sim and isn't what the pilot is asking about (user, 2026-11-03).
//!
//! The app holds no history in memory, since what it's measuring is how little it takes: each sample goes to a file, and only
//! an open window reads it.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use windows_sys::Win32::System::ProcessStatus::{
    GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
    PROCESS_MEMORY_COUNTERS_EX2,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::System::WindowsProgramming::QueryProcessCycleTime;

use crate::processes::{Object, Running, running};

pub const SAMPLE_EVERY: Duration = Duration::from_secs(60);
/// How many samples the file adds before it's trimmed, a day's worth, so it holds at most two days.
pub const TRIM_EVERY: u32 = 24 * 60;
const KEEP_SECONDS: u64 = 24 * 60 * 60;
const NAME: &str = "usage.jsonl";
/// The program a WebView2 window runs in. Only these of the app's descendants count, since the app will start the core too.
const WEBVIEW: &str = "msedgewebview2.exe";

/// A moment's figures: the memory in bytes, the share of all the PC's cores in percent, and the bytes the app's updates
/// downloaded since the sample before.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Sample {
    pub at: u64,
    pub memory: u64,
    pub cpu: f32,
    pub network: u64,
}

/// One line of the file.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub enum Line {
    Sample(Sample),
    WindowOpened { at: u64 },
    UpdateDownloaded { at: u64 },
}

/// The last 24 hours, as the window's charts read them.
#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub samples: Vec<Sample>,
    pub window_opened: Vec<u64>,
    pub update_downloaded: Vec<u64>,
    pub now: u64,
}

/// The time in seconds, as the file holds it.
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs())
}

/// The file of samples, one JSON object a line, so adding a sample never rewrites what's there. A sample comes from the
/// runtime's thread and a window's opening from the main one, so the lock keeps them from running together, or from landing
/// while a trim rewrites the file.
pub struct History {
    path: PathBuf,
    writing: Mutex<()>,
}

impl History {
    pub fn in_folder(folder: &Path) -> Self {
        Self {
            path: folder.join(NAME),
            writing: Mutex::new(()),
        }
    }

    pub fn add(&self, line: Line) {
        let text = serde_json::to_string(&line).expect("a line of the usage file should encode");
        let Ok(_writing) = self.writing.lock() else {
            return;
        };
        let written = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .and_then(|mut file| file.write_all(format!("{text}\n").as_bytes()));
        if let Err(error) = written {
            crate::log::line(&format!("a usage sample didn't save: {error}"));
        }
    }

    /// What's within 24 hours of `now`. A line that doesn't read is one a crash cut short, with no newline, so the line after
    /// it joins it, and the crash costs those two samples.
    pub fn read(&self, now: u64) -> Usage {
        let mut usage = Usage {
            now,
            ..Usage::default()
        };
        let text = fs::read_to_string(&self.path).unwrap_or_default();
        for line in text
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
        {
            match line {
                Line::Sample(sample) if kept(sample.at, now) => usage.samples.push(sample),
                Line::WindowOpened { at } if kept(at, now) => usage.window_opened.push(at),
                Line::UpdateDownloaded { at } if kept(at, now) => usage.update_downloaded.push(at),
                _ => {}
            }
        }
        usage
    }

    /// Drops what's past 24 hours, so the file doesn't grow without end. It writes a new file and renames it over the old, so a
    /// crash here keeps the day, and an open window never reads half of it.
    pub fn trim(&self, now: u64) {
        let Ok(_writing) = self.writing.lock() else {
            return;
        };
        let Ok(text) = fs::read_to_string(&self.path) else {
            return;
        };
        let keep: String = text
            .lines()
            .filter(|line| {
                serde_json::from_str::<Line>(line).is_ok_and(|line| {
                    kept(
                        match line {
                            Line::Sample(sample) => sample.at,
                            Line::WindowOpened { at } | Line::UpdateDownloaded { at } => at,
                        },
                        now,
                    )
                })
            })
            .flat_map(|line| [line, "\n"])
            .collect();
        let new = self.path.with_extension("new");
        if let Err(error) = fs::write(&new, keep).and_then(|()| fs::rename(&new, &self.path)) {
            crate::log::line(&format!("the usage file wasn't trimmed: {error}"));
        }
    }
}

fn kept(at: u64, now: u64) -> bool {
    at + KEEP_SECONDS >= now
}

/// This app's process and the WebView2 processes below it, however deep.
fn ours(all: &[Running], me: u32) -> Vec<u32> {
    let mut found = vec![me];
    let mut at = 0;
    while at < found.len() {
        let parent = found[at];
        found.extend(
            all.iter()
                .filter(|one| {
                    one.parent == parent
                        && one.program.eq_ignore_ascii_case(WEBVIEW)
                        && !found.contains(&one.id)
                })
                .map(|one| one.id)
                .collect::<Vec<_>>(),
        );
        at += 1;
    }
    found
}

/// A process's private working set in bytes, and the cycles it has used. A process gone since the snapshot has neither.
fn figures_of(id: u32) -> Option<(u64, u64)> {
    // SAFETY: OpenProcess takes access rights, an inherit flag, and an ID.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, id) };
    if handle.is_null() {
        return None;
    }
    let handle = Object(handle);
    let mut cycles = 0;
    // SAFETY: the handle stays open through the call, which writes one u64.
    if unsafe { QueryProcessCycleTime(handle.0, &mut cycles) } == 0 {
        return None;
    }
    // SAFETY: an all-zero struct of integers is valid.
    let mut memory: PROCESS_MEMORY_COUNTERS_EX2 = unsafe { std::mem::zeroed() };
    // A Windows that predates the longer struct may refuse its size or leave its last field at the zero it was given, and
    // the commit charge is the nearest figure it has (unverified, since we've run on no such Windows).
    let read = [
        size_of::<PROCESS_MEMORY_COUNTERS_EX2>(),
        size_of::<PROCESS_MEMORY_COUNTERS_EX>(),
    ]
    .into_iter()
    .any(|size| {
        memory.cb = size as u32;
        // SAFETY: the handle stays open through the call, and the struct the pointer leads to is at least `size` long.
        unsafe {
            GetProcessMemoryInfo(
                handle.0,
                (&raw mut memory).cast::<PROCESS_MEMORY_COUNTERS>(),
                size as u32,
            ) != 0
        }
    });
    if !read {
        return None;
    }
    let private = match memory.PrivateWorkingSetSize {
        0 => memory.PrivateUsage,
        set => set,
    };
    Some((private as u64, cycles))
}

/// Takes samples, each one's CPU figure counting from the sample before.
pub struct Sampler {
    me: u32,
    cores: f64,
    seen: HashMap<u32, u64>,
    taken: Instant,
    /// The time-stamp counter at the last sample, which the next one's cycles are measured against.
    counted: u64,
    /// What updates downloaded since the last sample.
    downloaded: u64,
}

impl Sampler {
    pub fn new() -> Self {
        // SAFETY: the call takes nothing.
        let me = unsafe { GetCurrentProcessId() };
        let (_, seen) = read_ours(me);
        Self {
            me,
            cores: std::thread::available_parallelism().map_or(1.0, |n| n.get() as f64),
            seen,
            taken: Instant::now(),
            counted: counter(),
            downloaded: 0,
        }
    }

    /// Counts what an update's download took toward the next sample.
    pub fn downloaded(&mut self, bytes: u64) {
        self.downloaded += bytes;
    }

    /// A sample that the next one counts from.
    pub fn take(&mut self, at: u64) -> Sample {
        let (sample, seen, counted) = self.read(at);
        self.seen = seen;
        self.taken = Instant::now();
        self.counted = counted;
        self.downloaded = 0;
        sample
    }

    /// A sample of this moment that leaves the next one's count alone, for the end of an open window's chart.
    pub fn peek(&self, at: u64) -> Sample {
        self.read(at).0
    }

    fn read(&self, at: u64) -> (Sample, HashMap<u32, u64>, u64) {
        let (memory, now) = read_ours(self.me);
        let counted = counter();
        let sample = Sample {
            at,
            memory,
            cpu: cpu_share(
                &self.seen,
                &now,
                self.taken.elapsed(),
                counted.wrapping_sub(self.counted),
                self.cores,
            ),
            network: self.downloaded,
        };
        (sample, now, counted)
    }
}

/// The time-stamp counter, which ticks at the rate Windows counts a process's cycles in.
fn counter() -> u64 {
    // SAFETY: reading the time-stamp counter has no effects.
    unsafe { std::arch::x86_64::_rdtsc() }
}

fn read_ours(me: u32) -> (u64, HashMap<u32, u64>) {
    let mut memory = 0;
    let mut times = HashMap::new();
    for id in ours(&running(), me) {
        if let Some((private, cpu)) = figures_of(id) {
            memory += private;
            times.insert(id, cpu);
        }
    }
    (memory, times)
}

/// The share of the PC's cores these processes used since `seen`, so an idle minute reads as the little it took rather than as
/// a 0% one minute and a jump the next. Windows adds a process's time a whole 15.6ms clock tick at a time, to whichever thread
/// runs as the tick fires, so three runs of the same quiet minute of this app read 0.130% to 0.234% of a core from its times,
/// where the cycles Windows counts for it read 0.139% and 0.154%, and a 3,000ms spin as 2,995.1ms at the processor's base clock
/// (record/areas/install/log.md, "2026-11-11: The bench read the desktop app's CPU in whole 15.6ms clock ticks"). So these are
/// the cycles each process used against the time-stamp counter's over the same moment, which ticks at that base clock. A
/// process that started since counts all its cycles, so a window's first seconds show. A moment too short to read counts as if
/// it were 1s long, since a tray menu's first figure otherwise divides by next to nothing.
fn cpu_share(
    seen: &HashMap<u32, u64>,
    now: &HashMap<u32, u64>,
    over: Duration,
    counted: u64,
    cores: f64,
) -> f32 {
    let used: u64 = now
        .iter()
        .map(|(id, cycles)| cycles.saturating_sub(seen.get(id).copied().unwrap_or(0)))
        .sum();
    let seconds = over.as_secs_f64();
    if counted == 0 || seconds <= 0.0 {
        return 0.0;
    }
    // The counter's cycles over 1s or the moment, whichever is longer, at the rate it counted them over the moment.
    let whole = counted as f64 * (1.0 / seconds).max(1.0);
    (used as f64 / whole / cores * 100.0).min(100.0) as f32
}

/// The tray menu's line, in the units Task Manager shows.
pub fn tray_line(sample: &Sample) -> String {
    format!(
        "Using {} MB RAM, {} CPU",
        (sample.memory as f64 / 1_048_576.0).round(),
        cpu_text(sample.cpu)
    )
}

/// A share of the PC's cores, so a pilot never reads the app as stuck: to one decimal as Task Manager shows it, or below 0.1%
/// to its first digit that isn't 0, as 0.004%. Idle, the app uses about 0.065% of one core, so 0.004% of a 16-thread PC's,
/// which one decimal would show as 0.0% (record/areas/install/log.md, "2026-11-16: The desktop app's walk for the sim cost
/// 4.0ms"). `cpuText` in src/platform/desktop-shell/src/usage.ts formats the window's figures the same way, so change both
/// together.
fn cpu_text(percent: f32) -> String {
    let percent = f64::from(percent);
    if percent <= 0.0 {
        return "0%".into();
    }
    if percent >= 0.1 {
        return format!("{percent:.1}%");
    }
    let mut decimals = (-percent.log10()).ceil() as usize;
    // Rounding can carry into the next digit, as 0.0096 does to 0.010, which one fewer decimal writes as 0.01.
    if (percent * 10f64.powi(decimals as i32)).round() >= 10.0 {
        decimals -= 1;
    }
    format!("{percent:.decimals$}%")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let folder =
            std::env::temp_dir().join(format!("dualinput-usage-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).unwrap();
        folder
    }

    fn sample(at: u64) -> Sample {
        Sample {
            at,
            memory: 4_000_000,
            cpu: 0.1,
            network: 0,
        }
    }

    fn process(id: u32, parent: u32, program: &str) -> Running {
        Running {
            id,
            parent,
            program: program.into(),
        }
    }

    #[test]
    fn a_read_gives_back_the_last_24_hours() {
        let folder = folder("read");
        let history = History::in_folder(&folder);
        let now = 2 * KEEP_SECONDS;
        history.add(Line::Sample(sample(now - KEEP_SECONDS - 1)));
        history.add(Line::Sample(sample(now - 60)));
        history.add(Line::WindowOpened { at: now - 30 });
        history.add(Line::UpdateDownloaded { at: now - 20 });
        assert_eq!(
            history.read(now),
            Usage {
                samples: vec![sample(now - 60)],
                window_opened: vec![now - 30],
                update_downloaded: vec![now - 20],
                now,
            }
        );
        fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_line_a_crash_cut_short_costs_itself_and_the_one_that_joins_it() {
        let folder = folder("cut");
        let history = History::in_folder(&folder);
        history.add(Line::Sample(sample(100)));
        fs::write(
            folder.join(NAME),
            format!(
                "{}{{\"t\":\"sam",
                fs::read_to_string(folder.join(NAME)).unwrap()
            ),
        )
        .unwrap();
        history.add(Line::Sample(sample(200)));
        history.add(Line::Sample(sample(300)));
        assert_eq!(history.read(300).samples, [sample(100), sample(300)]);
        fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_trim_drops_only_whats_past_24_hours() {
        let folder = folder("trim");
        let history = History::in_folder(&folder);
        let now = 2 * KEEP_SECONDS;
        history.add(Line::WindowOpened { at: 5 });
        history.add(Line::Sample(sample(now)));
        history.trim(now);
        assert_eq!(
            fs::read_to_string(folder.join(NAME))
                .unwrap()
                .lines()
                .count(),
            1
        );
        assert_eq!(history.read(now).samples, [sample(now)]);
        fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_read_of_no_file_is_empty() {
        let folder = folder("none");
        assert_eq!(History::in_folder(&folder).read(9).samples, []);
        fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn ours_is_this_app_and_the_webview2_below_it_and_not_the_core() {
        let all = [
            process(1, 0, "explorer.exe"),
            process(10, 1, "dualinput-desktop.exe"),
            process(11, 10, "msedgewebview2.exe"),
            process(12, 11, "msedgewebview2.exe"),
            process(13, 10, "dualinput-core.exe"),
            process(14, 13, "msedgewebview2.exe"),
            process(20, 1, "msedgewebview2.exe"),
        ];
        assert_eq!(ours(&all, 10), [10, 11, 12]);
    }

    #[test]
    fn the_cpu_share_counts_cycles_since_the_last_sample_and_a_new_process_whole() {
        let seen = HashMap::from([(1, 100_000)]);
        let now = HashMap::from([(1, 101_000), (2, 1_000)]);
        // With the counter at 1,000 cycles a second, 2,000 cycles over 10s on one core is 20%, and on four cores 5%.
        let ten_seconds = Duration::from_secs(10);
        assert_eq!(cpu_share(&seen, &now, ten_seconds, 10_000, 1.0), 20.0);
        assert_eq!(cpu_share(&seen, &now, ten_seconds, 10_000, 4.0), 5.0);
        assert_eq!(
            cpu_share(&seen, &now, Duration::from_millis(1), 1, 1.0),
            100.0
        );
    }

    #[test]
    fn a_moment_too_short_to_read_counts_as_1s() {
        let seen = HashMap::from([(1, 0)]);
        let now = HashMap::from([(1, 500)]);
        // 500 cycles in 100ms of a counter at 1,000 a second read against a whole second's 1,000, not the moment's 100.
        let moment = Duration::from_millis(100);
        assert_eq!(cpu_share(&seen, &now, moment, 100, 1.0), 50.0);
        assert_eq!(cpu_share(&seen, &now, Duration::ZERO, 0, 1.0), 0.0);
    }

    #[test]
    fn the_tray_line_reads_in_task_managers_units() {
        let line = tray_line(&Sample {
            at: 0,
            memory: 4 * 1_048_576,
            cpu: 0.14,
            network: 0,
        });
        assert_eq!(line, "Using 4 MB RAM, 0.1% CPU");
    }

    #[test]
    fn a_small_cpu_share_reads_to_its_first_digit_rather_than_as_nothing() {
        assert_eq!(cpu_text(12.34), "12.3%");
        assert_eq!(cpu_text(0.0049), "0.005%");
        assert_eq!(cpu_text(0.0033), "0.003%");
        assert_eq!(cpu_text(0.05), "0.05%");
        assert_eq!(cpu_text(0.0096), "0.01%");
        assert_eq!(cpu_text(0.097), "0.1%");
        assert_eq!(cpu_text(0.0), "0%");
    }
}
