//! The run's log file, `log.txt`, beside its recording, which a bug report sends us with it.
//!
//! The loop's crates log through `tracing`'s macros, and this subscriber writes each line,
//! stamped with the stamp and sequence number of the input being handled, so a line lines
//! up with the recording. A log line is neither an output nor in the outputs' hash, so a
//! replay may log at a higher level and still replay exactly.
//!
//! The thread that logs a line, the loop included, never waits on the disk: it sends the
//! line, and a thread of the log's own writes it to the file. Windows held a core's early
//! writes to its new `log.txt` for up to 49ms, on the loop's thread
//! (record/areas/core/log.md, "2026-11-18: Windows held a core's early writes to its log for up
//! to 49ms on the loop's thread, so the log gets a writer of its own").

use std::fmt;
use std::io::Write;
use std::path::Path;
use std::sync::mpsc::{self, Receiver, Sender, SyncSender};
use std::sync::{Mutex, Once, PoisonError};
use std::thread::JoinHandle;
use std::time::Duration;

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

/// How many lines can wait for the writer before the thread that logs waits too. A replay at
/// a raised level logs faster than the writer writes, and with no cap on a replay's log, its
/// lines would otherwise fill memory; a live run logs a few lines in the 49ms Windows held a
/// write, so its loop waits only in a storm of lines.
const WAITING: usize = 1_024;

pub struct Log {
    sending: Mutex<Sending>,
    /// The log's writer, until `finish` waits for it.
    writer: Mutex<Option<JoinHandle<()>>>,
    /// `None` for a replay's log, which has no cap, since a replay is where we raise the
    /// level.
    cap: Option<u64>,
    level: LevelFilter,
    /// The home folder's path, which names the pilot's Windows account, as written and
    /// lowercased, since the sim sends paths under it lowercased
    /// (record/areas/recording/01-recording-and-bug-reports.md, "The home folder's path").
    /// Only the path goes, since a pilot's display name can be the same text as their Windows
    /// username, and display names make a crew's logs readable to us.
    home: Vec<String>,
}

/// The lines on their way to the writer, and the bytes sent, which the cap counts.
struct Sending {
    /// `None` once the log has finished, which drops every later line.
    to: Option<SyncSender<Message>>,
    sent: u64,
    capped: bool,
}

impl Sending {
    fn send(&self, message: Message) -> bool {
        self.to.as_ref().is_some_and(|to| to.send(message).is_ok())
    }
}

enum Message {
    Line(String),
    /// Answered once every line sent before it is written.
    Flush(Sender<()>),
}

impl Log {
    pub fn open(path: &Path, cap: Option<u64>, level: LevelFilter) -> std::io::Result<Log> {
        let home = std::env::var("USERPROFILE").ok().filter(|h| !h.is_empty());
        let file = crate::data_folder::create_run_file(path)?;
        Log::writing(file, cap, level, home)
    }

    /// Apart from `open` so a test can hand the log a file in memory whose writes it holds.
    fn writing(
        file: impl Write + Send + 'static,
        cap: Option<u64>,
        level: LevelFilter,
        home: Option<String>,
    ) -> std::io::Result<Log> {
        // A field logged with `?`, or a text field, comes out with its backslashes doubled.
        let mut home: Vec<String> = home
            .into_iter()
            .flat_map(|h| [h.to_lowercase(), h])
            .flat_map(|h| [h.replace('\\', "\\\\"), h])
            .collect();
        home.dedup();
        let (to, lines) = mpsc::sync_channel(WAITING);
        let writer = std::thread::Builder::new()
            .name("log".into())
            .spawn(move || write(file, lines))?;
        Ok(Log {
            sending: Mutex::new(Sending {
                to: Some(to),
                sent: 0,
                capped: false,
            }),
            writer: Mutex::new(Some(writer)),
            cap,
            level,
            home,
        })
    }

    pub fn level(&self) -> LevelFilter {
        self.level
    }

    /// Sends a line to the writer, unless the log has reached its cap.
    pub fn line(&self, line: &str) {
        let line = self.hide(line);
        let mut sending = self.sending.lock().unwrap_or_else(PoisonError::into_inner);
        if sending.capped {
            return;
        }
        if let Some(cap) = self.cap
            && sending.sent + line.len() as u64 > cap
        {
            sending.capped = true;
            let note = format!(
                "{}µs WARN log.txt reached {} MB, so it drops every later line but a panic's\n",
                clock::now(),
                cap / 1_000_000
            );
            sending.send(Message::Line(note));
            return;
        }
        sending.sent += line.len() as u64;
        sending.send(Message::Line(line));
    }

    /// Sends a line past the cap, for the panic hook, since a crash needs that line most.
    pub fn always(&self, line: &str) {
        let line = self.hide(line);
        let sending = self.sending.lock().unwrap_or_else(PoisonError::into_inner);
        sending.send(Message::Line(line));
    }

    /// Waits at most `within` for the writer to write every line sent so far, for the panic
    /// hook, since a release core ends the process once the hook returns.
    pub fn flush(&self, within: Duration) {
        let (done, written) = mpsc::channel();
        let asked = self
            .sending
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .send(Message::Flush(done));
        if asked {
            let _ = written.recv_timeout(within);
        }
    }

    /// Waits for the writer to write every line sent, and drops every later one, as a run or
    /// a replay ends, so its last lines are in the file before the process exits.
    pub fn finish(&self) {
        self.sending
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .to = None;
        let writer = self
            .writer
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(writer) = writer {
            let _ = writer.join();
        }
    }

    fn hide(&self, line: &str) -> String {
        let mut line = line.to_string();
        for form in &self.home {
            line = line.replace(form.as_str(), "%USERPROFILE%");
        }
        line
    }
}

/// The writer: writes each line in the order the threads sent them, until the log finishes.
fn write(mut file: impl Write, lines: Receiver<Message>) {
    for message in lines {
        match message {
            // A line that can't be written is lost, and the run goes on.
            Message::Line(line) => {
                let _ = file.write_all(line.as_bytes());
            }
            Message::Flush(done) => {
                let _ = file.flush();
                let _ = done.send(());
            }
        }
    }
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
    use std::sync::Arc;
    use std::time::Instant;

    use super::*;

    /// A file in memory, whose every write takes `held`, as a write Windows holds does.
    #[derive(Clone, Default)]
    struct Memory {
        bytes: Arc<Mutex<Vec<u8>>>,
        held: Duration,
    }

    impl Write for Memory {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            std::thread::sleep(self.held);
            self.bytes.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl Memory {
        fn text(&self) -> String {
            String::from_utf8(self.bytes.lock().unwrap().clone()).unwrap()
        }
    }

    #[test]
    fn stops_at_the_cap_with_one_line_saying_so_and_keeps_a_panics_line() {
        let file = Memory::default();
        let log = Log::writing(file.clone(), Some(100), LevelFilter::INFO, None).unwrap();
        for i in 0..20 {
            log.line(&format!("line {i:02} of the run\n"));
        }
        log.always("the panic\n");
        log.finish();
        let text = file.text();
        assert!(text.starts_with("line 00 of the run\nline 01"));
        assert!(text.contains(
            "WARN log.txt reached 0 MB, so it drops every later line but a panic's\nthe panic\n"
        ));
        assert!(!text.contains("line 19"));
    }

    #[test]
    fn hides_the_home_folders_path_and_keeps_a_display_name_that_matches_the_username() {
        let file = Memory::default();
        let log = Log::writing(
            file.clone(),
            None,
            LevelFilter::INFO,
            Some(r"C:\Users\Pilot".into()),
        )
        .unwrap();
        log.line("read c:\\users\\pilot\\settings.json and C:\\Users\\Pilot\\x as Pilot\n");
        log.finish();
        assert_eq!(
            file.text(),
            "read %USERPROFILE%\\settings.json and %USERPROFILE%\\x as Pilot\n"
        );
    }

    #[test]
    fn a_write_held_50ms_never_holds_the_thread_that_logs_and_a_flush_waits_for_every_line() {
        let file = Memory {
            held: Duration::from_millis(50),
            ..Memory::default()
        };
        let log = Log::writing(file.clone(), None, LevelFilter::INFO, None).unwrap();
        let started = Instant::now();
        for i in 0..3 {
            log.line(&format!("line {i}\n"));
        }
        let took = started.elapsed();
        assert!(
            took < Duration::from_millis(50),
            "3 lines took {took:?} to send"
        );
        log.flush(Duration::from_secs(5));
        assert_eq!(file.text(), "line 0\nline 1\nline 2\n");
        log.always("after the flush\n");
        log.finish();
        log.line("after the end\n");
        assert_eq!(file.text(), "line 0\nline 1\nline 2\nafter the flush\n");
    }
}
