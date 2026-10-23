//! The run's log file, `log.txt`, beside its recording, which a bug report sends us with it.
//!
//! The loop's crates log through `tracing`'s macros, and this subscriber writes each line,
//! stamped with the stamp and sequence number of the input being handled, so a line lines
//! up with the recording. A log line is neither an output nor in the outputs' hash, so a
//! replay may log at a higher level and still replay exactly.

use std::fmt;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::{Mutex, Once};

use tracing::level_filters::LevelFilter;
use tracing_subscriber::Layer;
use tracing_subscriber::filter::dynamic_filter_fn;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::time::FormatTime;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use crate::clock;
use crate::run_context;

/// A live run's log stops here. The core deletes old runs only when it starts, so without a
/// cap one storm of lines could fill the disk within a session; at 16 MB, one 150-byte
/// warning every sim frame at 60 fps takes about 30 minutes to fill it
/// (record/areas/core/01-loop-and-edge.md, "Logging").
pub const CAP: u64 = 16_000_000;

pub struct Log {
    lines: Mutex<Lines>,
    /// `None` for a replay's log, which has no cap, since a replay is where we raise the
    /// level.
    cap: Option<u64>,
    level: LevelFilter,
    /// The home folder's path, which names the pilot's Windows account, as written and
    /// lowercased, since the sim sends paths under it lowercased
    /// (record/areas/recording/01-recording-and-bug-reports.md, "The home folder's path").
    home: Vec<String>,
    /// The Windows username, which can also be an ordinary word, such as "User" or
    /// "Owner", so it's hidden only as a whole word.
    user: Option<String>,
}

struct Lines {
    file: File,
    written: u64,
    capped: bool,
}

impl Log {
    pub fn open(path: &Path, cap: Option<u64>, level: LevelFilter) -> std::io::Result<Log> {
        let named = |name| std::env::var(name).ok().filter(|v: &String| !v.is_empty());
        Log::with(path, cap, level, named("USERPROFILE"), named("USERNAME"))
    }

    fn with(
        path: &Path,
        cap: Option<u64>,
        level: LevelFilter,
        home: Option<String>,
        user: Option<String>,
    ) -> std::io::Result<Log> {
        let file = File::create(path)?;
        let mut home: Vec<String> = home
            .into_iter()
            .flat_map(|h| [h.to_lowercase(), h])
            .collect();
        home.dedup();
        Ok(Log {
            lines: Mutex::new(Lines {
                file,
                written: 0,
                capped: false,
            }),
            cap,
            level,
            home,
            user,
        })
    }

    pub fn level(&self) -> LevelFilter {
        self.level
    }

    /// Writes a line, unless the log has reached its cap.
    pub fn line(&self, line: &str) {
        let line = self.hide(line);
        let mut lines = self
            .lines
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if lines.capped {
            return;
        }
        if let Some(cap) = self.cap
            && lines.written + line.len() as u64 > cap
        {
            lines.capped = true;
            let note = format!(
                "{}µs WARN log.txt reached {} MB, so it drops every later line but a panic's\n",
                clock::now(),
                cap / 1_000_000
            );
            let _ = lines.file.write_all(note.as_bytes());
            return;
        }
        lines.written += line.len() as u64;
        // A line that can't be written is lost, and the run goes on.
        let _ = lines.file.write_all(line.as_bytes());
    }

    /// Writes a line past the cap, for the panic hook, since a crash needs that line most.
    pub fn always(&self, line: &str) {
        let line = self.hide(line);
        let mut lines = self
            .lines
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let _ = lines.file.write_all(line.as_bytes());
        let _ = lines.file.flush();
    }

    fn hide(&self, line: &str) -> String {
        let mut line = line.to_string();
        for form in &self.home {
            line = line.replace(form.as_str(), "%USERPROFILE%");
        }
        match &self.user {
            Some(user) => hide_word(&line, user, "%USERNAME%"),
            None => line,
        }
    }
}

/// `line` with each whole-word `word` replaced by `name`, matching ASCII letters in either
/// case, so "Al" goes in "Al's path" and "AL" but not in "always".
fn hide_word(line: &str, word: &str, name: &str) -> String {
    let (bytes, word) = (line.as_bytes(), word.as_bytes());
    // A byte of a non-ASCII character counts as a letter, so a word's edge never splits one.
    let letter = |b: u8| b.is_ascii_alphanumeric() || b == b'_' || b >= 0x80;
    let mut hidden = String::with_capacity(line.len());
    let (mut i, mut kept) = (0, 0);
    while i + word.len() <= bytes.len() {
        let whole = bytes[i..i + word.len()].eq_ignore_ascii_case(word)
            && (i == 0 || !letter(bytes[i - 1]))
            && bytes.get(i + word.len()).is_none_or(|&b| !letter(b));
        if whole {
            hidden.push_str(&line[kept..i]);
            hidden.push_str(name);
            i += word.len();
            kept = i;
        } else {
            i += 1;
        }
    }
    hidden.push_str(&line[kept..]);
    hidden
}

/// Installs the one subscriber of the process, which writes each event to the log of the
/// run its thread belongs to, at that run's level. A thread that belongs to no run logs
/// nothing.
pub fn install() {
    static INSTALLED: Once = Once::new();
    INSTALLED.call_once(|| {
        let layer = tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .with_timer(InputTime)
            .with_writer(ThreadLog)
            .with_filter(dynamic_filter_fn(|meta, _| {
                run_context::with(|c| c.log.level() >= *meta.level()).unwrap_or(false)
            }));
        // In a test that installed its own subscriber first, `try_init` fails and the run
        // logs nothing, which changes no output.
        let _ = tracing_subscriber::registry().with(layer).try_init();
    });
}

/// Starts each line with the stamp and sequence number of the input the loop is handling,
/// as `81236512µs #5512 [session]`, with the unit whose handler is running; a line from
/// another thread has the time it was written, as `81236515µs`.
struct InputTime;

impl FormatTime for InputTime {
    fn format_time(&self, w: &mut Writer<'_>) -> fmt::Result {
        match run_context::current() {
            Some(input) => write!(w, "{}µs #{}", input.stamp, input.seq)?,
            None => write!(w, "{}µs", clock::now())?,
        }
        match kernel::running_unit() {
            Some(unit) => write!(w, " [{unit}]"),
            None => Ok(()),
        }
    }
}

struct ThreadLog;

impl MakeWriter<'_> for ThreadLog {
    type Writer = Line;

    fn make_writer(&self) -> Line {
        Line(Vec::new())
    }
}

/// One event's text, which goes to the log as a whole line once the subscriber has
/// written all of it.
struct Line(Vec<u8>);

impl Write for Line {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Drop for Line {
    fn drop(&mut self) {
        if !self.0.is_empty() {
            let line = String::from_utf8_lossy(&self.0);
            run_context::with(|c| c.log.line(&line));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(path: &Path) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    fn stops_at_the_cap_with_one_line_saying_so_and_keeps_a_panics_line() {
        let path =
            std::env::temp_dir().join(format!("dualinput-log-cap-{}.txt", std::process::id()));
        let log = Log::with(&path, Some(100), LevelFilter::INFO, None, None).unwrap();
        for i in 0..20 {
            log.line(&format!("line {i:02} of the run\n"));
        }
        log.always("the panic\n");
        let text = read(&path);
        assert!(text.starts_with("line 00 of the run\nline 01"));
        assert!(text.contains(
            "WARN log.txt reached 0 MB, so it drops every later line but a panic's\nthe panic\n"
        ));
        assert!(!text.contains("line 19"));
        drop(log);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn hides_the_home_folders_path() {
        let path =
            std::env::temp_dir().join(format!("dualinput-log-home-{}.txt", std::process::id()));
        let log = Log::with(
            &path,
            None,
            LevelFilter::INFO,
            Some(r"C:\Users\Pilot".into()),
            Some("Pilot".into()),
        )
        .unwrap();
        log.line("read c:\\users\\pilot\\settings.json and C:\\Users\\Pilot\\x as Pilot\n");
        assert_eq!(
            read(&path),
            "read %USERPROFILE%\\settings.json and %USERPROFILE%\\x as %USERNAME%\n"
        );
        drop(log);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn hides_the_username_only_as_a_whole_word() {
        assert_eq!(
            hide_word("Al always wrote AL's local file; al.", "Al", "%USERNAME%"),
            "%USERNAME% always wrote %USERNAME%'s local file; %USERNAME%."
        );
        assert_eq!(hide_word("Ålborg Al", "Al", "u"), "Ålborg u");
    }
}
