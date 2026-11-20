//! The recording's writer, on a thread of its own, so the loop never waits on the disk.

use std::io::BufWriter;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use messages::recording::RecordingStopped;
use recording_format::{Header, Record, Writer};
use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

use crate::run_context::{self, Context};

/// A killed core loses what the writer hadn't flushed, so flushing each second bounds the
/// loss to the run's last second (record/areas/core/01-loop-and-edge.md, "Budgets").
const FLUSH: Duration = Duration::from_secs(1);

/// Filling the pilot's system drive mid-flight would stall more than Dual Input, so the
/// recording stops once its drive has less than this free (record/areas/recording/log.md,
/// "2026-10-23: One zstd frame flushed each second keeps a busy flight's recording at 42.6 MB
/// an hour, where a frame ended each second takes 66.7 MB").
const FLOOR: u64 = 1_000_000_000;

enum Message {
    Record(Record),
    /// Flushes, then answers, for the panic hook.
    Flush(mpsc::Sender<()>),
    Finish,
}

/// What the loop and the panic hook send the writer through.
#[derive(Clone)]
pub struct Handle {
    to: mpsc::Sender<Message>,
}

impl Handle {
    pub fn record(&self, record: Record) {
        // The writer only stops once the run has ended, after the loop has.
        let _ = self.to.send(Message::Record(record));
    }

    /// Asks the writer to put everything it was sent on disk, and waits for it at most
    /// `within`. Returns whether it answered.
    pub fn flush(&self, within: Duration) -> bool {
        let (answer, answered) = mpsc::channel();
        self.to.send(Message::Flush(answer)).is_ok() && answered.recv_timeout(within).is_ok()
    }

    pub fn finish(&self) {
        let _ = self.to.send(Message::Finish);
    }
}

/// Writes the header to `path`, then starts the thread that writes everything after it, which
/// calls `stopped` if it stops before the run ends.
pub fn start(
    path: &Path,
    header: &Header,
    context: Arc<Context>,
    stopped: impl Fn(RecordingStopped) + Send + 'static,
) -> std::io::Result<(Handle, JoinHandle<()>)> {
    let writer = Writer::new(
        BufWriter::new(crate::data_folder::create_run_file(path)?),
        header,
    )?;
    let folder = path.parent().map_or_else(PathBuf::new, Path::to_path_buf);
    let (to, from) = mpsc::channel();
    let thread = std::thread::Builder::new()
        .name("writer".into())
        .spawn(move || {
            run_context::enter(context);
            write(writer, &from, || free_space(&folder), stopped);
        })?;
    Ok((Handle { to }, thread))
}

/// Writes what `from` sends, flushing each second, until it's told to finish. `free` gives
/// the bytes free on the recording's drive, or `None` when Windows can't say, and `stopped` hears
/// why the recording stopped before that.
fn write<W: std::io::Write>(
    writer: Writer<W>,
    from: &mpsc::Receiver<Message>,
    free: impl Fn() -> Option<u64>,
    stopped: impl Fn(RecordingStopped),
) {
    // A write that fails, such as on a full disk, stops the recording and nothing else,
    // since a pilot's session matters more than its recording.
    let mut writer = Some(writer);
    let mut flushed = Instant::now();
    let mut pending = false;
    loop {
        let message = if pending {
            from.recv_timeout(FLUSH.saturating_sub(flushed.elapsed()))
        } else {
            from.recv().map_err(RecvTimeoutError::from)
        };
        let result = match message {
            Ok(Message::Record(record)) => {
                pending = true;
                let result = writer.as_mut().map_or(Ok(()), |w| w.write(&record));
                if flushed.elapsed() >= FLUSH {
                    result.and_then(|()| {
                        flush(&mut writer, &mut flushed, &mut pending, &free, &stopped)
                    })
                } else {
                    result
                }
            }
            Ok(Message::Flush(answer)) => {
                let result = flush(&mut writer, &mut flushed, &mut pending, &free, &stopped);
                let _ = answer.send(());
                result
            }
            Err(RecvTimeoutError::Timeout) => {
                flush(&mut writer, &mut flushed, &mut pending, &free, &stopped)
            }
            Ok(Message::Finish) | Err(RecvTimeoutError::Disconnected) => {
                if let Some(Err(error)) = writer.take().map(Writer::finish) {
                    tracing::error!(%error, "the recording's last block couldn't be written");
                }
                return;
            }
        };
        if let Err(error) = result {
            tracing::error!(%error, "the recording stopped, since a write to it failed");
            writer = None;
            stopped(RecordingStopped::FailedWrite);
        }
    }
}

fn flush<W: std::io::Write>(
    writer: &mut Option<Writer<W>>,
    flushed: &mut Instant,
    pending: &mut bool,
    free: impl Fn() -> Option<u64>,
    stopped: impl Fn(RecordingStopped),
) -> std::io::Result<()> {
    *flushed = Instant::now();
    *pending = false;
    let Some(w) = writer.as_mut() else {
        return Ok(());
    };
    w.flush()?;
    if let Some(free) = free().filter(|&free| free < FLOOR) {
        tracing::warn!(
            free_mb = free / 1_000_000,
            "the recording stopped, since its drive has under 1 GB free"
        );
        if let Some(Err(error)) = writer.take().map(Writer::finish) {
            tracing::error!(%error, "the recording's last block couldn't be written");
        }
        stopped(RecordingStopped::NoSpace);
    }
    Ok(())
}

/// The bytes free to this account on the drive that holds `folder`.
fn free_space(folder: &Path) -> Option<u64> {
    let wide: Vec<u16> = folder.as_os_str().encode_wide().chain([0]).collect();
    let mut free = 0u64;
    // SAFETY: `wide` is a zero-terminated UTF-16 path that outlives the call, which writes
    // only the one count asked for.
    let done = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    (done != 0).then_some(free)
}

#[cfg(test)]
mod tests {
    use super::*;
    use recording_format::{Input, Reader};
    use std::cell::{Cell, RefCell};
    use std::fs::File;
    use std::sync::atomic::{AtomicBool, Ordering};

    fn header() -> Header {
        Header {
            commit: "0".repeat(40),
            uncommitted: None,
            profile: "debug".into(),
            rustc: "rustc".into(),
            msvc: "14".into(),
            windows_sdk: "10".into(),
            simconnect_sdk: "1.8.1".into(),
            cpu: "a test CPU".into(),
            fma3: true,
            checkpoint_every_input: false,
        }
    }

    fn input(seq: u64) -> Record {
        Record::Input(Input {
            seq,
            stamp: seq,
            source: 3,
            bytes: vec![1, 2, 3],
        })
    }

    #[test]
    fn stops_recording_once_the_drive_has_under_1_gb_free() {
        let path =
            std::env::temp_dir().join(format!("dualinput-writer-{}.zst", std::process::id()));
        let writer = Writer::new(File::create(&path).unwrap(), &header()).unwrap();
        let (to, from) = mpsc::channel();
        // Plenty free at the first flush, then 500 MB.
        let flushes = Cell::new(0);
        let free = || {
            flushes.set(flushes.get() + 1);
            Some(if flushes.get() == 1 {
                50 * FLOOR
            } else {
                FLOOR / 2
            })
        };
        let (answer, answered) = mpsc::channel();
        to.send(Message::Record(input(0))).unwrap();
        to.send(Message::Flush(answer.clone())).unwrap();
        to.send(Message::Record(input(1))).unwrap();
        to.send(Message::Flush(answer)).unwrap();
        to.send(Message::Record(input(2))).unwrap();
        to.send(Message::Finish).unwrap();
        let heard = RefCell::new(Vec::new());
        write(writer, &from, free, |why| heard.borrow_mut().push(why));
        assert_eq!(answered.try_iter().count(), 2, "every flush is answered");
        assert_eq!(*heard.borrow(), [RecordingStopped::NoSpace]);

        let (_, mut reader) = Reader::new(File::open(&path).unwrap()).unwrap();
        let mut records = Vec::new();
        while let Some(record) = reader.next_record().unwrap() {
            records.push(record);
        }
        assert_eq!(records, vec![input(0), input(1)]);
        assert!(!reader.truncated(), "the stop ends the recording's frame");
        std::fs::remove_file(&path).unwrap();
    }

    /// A disk that takes the header's bytes, then refuses every write once `full` is set.
    struct Disk {
        full: Arc<AtomicBool>,
    }

    impl std::io::Write for Disk {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if self.full.load(Ordering::Relaxed) {
                return Err(std::io::Error::other("the disk is full"));
            }
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn says_so_once_when_a_write_fails_and_writes_nothing_more() {
        let full = Arc::new(AtomicBool::new(false));
        let disk = Disk { full: full.clone() };
        let writer = Writer::new(disk, &header()).unwrap();
        full.store(true, Ordering::Relaxed);
        let (to, from) = mpsc::channel();
        let (answer, answered) = mpsc::channel();
        to.send(Message::Record(input(0))).unwrap();
        to.send(Message::Flush(answer.clone())).unwrap();
        to.send(Message::Record(input(1))).unwrap();
        to.send(Message::Flush(answer)).unwrap();
        to.send(Message::Finish).unwrap();
        let heard = RefCell::new(Vec::new());
        write(
            writer,
            &from,
            || Some(50 * FLOOR),
            |why| heard.borrow_mut().push(why),
        );
        assert_eq!(answered.try_iter().count(), 2, "every flush is answered");
        assert_eq!(*heard.borrow(), [RecordingStopped::FailedWrite]);
    }

    #[test]
    fn finds_the_space_free_on_the_temp_folders_drive() {
        assert!(free_space(&std::env::temp_dir()).is_some_and(|free| free > 0));
    }
}
