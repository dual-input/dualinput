//! The recording's writer, on a thread of its own, so the loop never waits on the disk.

use std::fs::File;
use std::io::BufWriter;
use std::sync::Arc;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use recording_format::{Header, Record, Writer};

use crate::run_context::{self, Context};

/// A killed core loses the frame it hadn't ended, so ending one each second bounds the loss
/// to the run's last second (record/areas/core/01-loop-and-edge.md, "Budgets").
const FRAME: Duration = Duration::from_secs(1);

enum Message {
    Record(Record),
    /// Ends the open frame, then answers, for the panic hook.
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

/// Writes the header to `file`, then starts the thread that writes everything after it.
pub fn start(
    file: File,
    header: &Header,
    context: Arc<Context>,
) -> std::io::Result<(Handle, JoinHandle<()>)> {
    let writer = Writer::new(BufWriter::new(file), header)?;
    let (to, from) = mpsc::channel();
    let thread = std::thread::Builder::new()
        .name("writer".into())
        .spawn(move || {
            run_context::enter(context);
            write(writer, &from);
        })?;
    Ok((Handle { to }, thread))
}

fn write(writer: Writer<BufWriter<File>>, from: &mpsc::Receiver<Message>) {
    // A write that fails, such as on a full disk, stops the recording and nothing else,
    // since a pilot's session matters more than its recording.
    let mut writer = Some(writer);
    let mut ended = Instant::now();
    let mut open = false;
    loop {
        let message = if open {
            from.recv_timeout(FRAME.saturating_sub(ended.elapsed()))
        } else {
            from.recv().map_err(RecvTimeoutError::from)
        };
        let result = match message {
            Ok(Message::Record(record)) => {
                open = true;
                let result = writer.as_mut().map_or(Ok(()), |w| w.write(&record));
                if ended.elapsed() >= FRAME {
                    result.and_then(|()| end(&mut writer, &mut ended, &mut open))
                } else {
                    result
                }
            }
            Ok(Message::Flush(answer)) => {
                let result = end(&mut writer, &mut ended, &mut open);
                let _ = answer.send(());
                result
            }
            Err(RecvTimeoutError::Timeout) => end(&mut writer, &mut ended, &mut open),
            Ok(Message::Finish) | Err(RecvTimeoutError::Disconnected) => {
                if let Some(Err(error)) = writer.take().map(Writer::finish) {
                    tracing::error!(%error, "the recording's last frame couldn't be written");
                }
                return;
            }
        };
        if let Err(error) = result {
            tracing::error!(%error, "the recording stopped, since a write to it failed");
            writer = None;
        }
    }
}

fn end(
    writer: &mut Option<Writer<BufWriter<File>>>,
    ended: &mut Instant,
    open: &mut bool,
) -> std::io::Result<()> {
    *ended = Instant::now();
    *open = false;
    writer.as_mut().map_or(Ok(()), Writer::end_frame)
}
