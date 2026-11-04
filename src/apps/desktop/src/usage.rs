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
use windows_sys::Win32::Foundation::FILETIME;
use windows_sys::Win32::System::ProcessStatus::{
    GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
    PROCESS_MEMORY_COUNTERS_EX2,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcessId, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

use crate::processes::{Object, Running, running};

pub const SAMPLE_EVERY: Duration = Duration::from_secs(60);
/// How many samples the file adds before it's trimmed, a day's worth, so it holds at most two days.
pub const TRIM_EVERY: u32 = 24 * 60;
const KEEP_SECONDS: u64 = 24 * 60 * 60;
const NAME: &str = "usage.jsonl";
/// The program a WebView2 window runs in. Only these of the app's descendants count, since the app will start the core too.
const WEBVIEW: &str = "msedgewebview2.exe";

/// A moment's figures: the memory in bytes, the share of all the PC's cores in percent, and the bytes downloaded since the sample
/// before. TODO: when the app downloads updates, count them in `network`.
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

/// A process's private working set in bytes, and the CPU time it has used, in 100ns. A process gone since the snapshot has neither.
fn figures_of(id: u32) -> Option<(u64, u64)> {
    // SAFETY: OpenProcess takes access rights, an inherit flag, and an ID.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, id) };
    if handle.is_null() {
        return None;
    }
    let handle = Object(handle);
    let mut times = [FILETIME::default(); 4];
    let [created, exited, kernel, user] = &mut times;
    // SAFETY: the handle stays open through the call, which writes the four times.
    if unsafe { GetProcessTimes(handle.0, created, exited, kernel, user) } == 0 {
        return None;
    }
    let time = |t: &FILETIME| u64::from(t.dwHighDateTime) << 32 | u64::from(t.dwLowDateTime);
    let cpu = time(&times[2]) + time(&times[3]);
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
    Some((private as u64, cpu))
}

/// Takes samples, each one's CPU figure counting from the sample before.
pub struct Sampler {
    me: u32,
    cores: f64,
    seen: HashMap<u32, u64>,
    taken: Instant,
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
        }
    }

    /// A sample that the next one counts from.
    pub fn take(&mut self, at: u64) -> Sample {
        let (sample, seen) = self.read(at);
        self.seen = seen;
        self.taken = Instant::now();
        sample
    }

    /// A sample of this moment that leaves the next one's count alone, for the end of an open window's chart.
    pub fn peek(&self, at: u64) -> Sample {
        self.read(at).0
    }

    fn read(&self, at: u64) -> (Sample, HashMap<u32, u64>) {
        let (memory, now) = read_ours(self.me);
        let sample = Sample {
            at,
            memory,
            cpu: cpu_share(&self.seen, &now, self.taken.elapsed(), self.cores),
            network: 0,
        };
        (sample, now)
    }
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

/// The share of the PC's cores these processes used since `seen`. A process that started since counts all its time, so a
/// window's first seconds show. A moment too short to read comes out as if it were 1s long, since a tray menu's first figure
/// otherwise divides by next to nothing.
fn cpu_share(seen: &HashMap<u32, u64>, now: &HashMap<u32, u64>, over: Duration, cores: f64) -> f32 {
    let used: u64 = now
        .iter()
        .map(|(id, time)| time.saturating_sub(seen.get(id).copied().unwrap_or(0)))
        .sum();
    let over = over.as_secs_f64().max(1.0) * 10_000_000.0;
    (used as f64 / over / cores * 100.0).min(100.0) as f32
}

/// The tray menu's line, in the units Task Manager shows.
pub fn tray_line(sample: &Sample) -> String {
    format!(
        "Using {} MB RAM, {:.1}% CPU",
        (sample.memory as f64 / 1_048_576.0).round(),
        sample.cpu
    )
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
    fn the_cpu_share_counts_since_the_last_sample_and_a_new_process_whole() {
        let seen = HashMap::from([(1, 100_000_000)]);
        let now = HashMap::from([(1, 110_000_000), (2, 10_000_000)]);
        // 2s of CPU over 10s on one core is 20%, and on four cores 5%.
        assert_eq!(cpu_share(&seen, &now, Duration::from_secs(10), 1.0), 20.0);
        assert_eq!(cpu_share(&seen, &now, Duration::from_secs(10), 4.0), 5.0);
        assert_eq!(cpu_share(&seen, &now, Duration::from_millis(1), 1.0), 100.0);
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
}
