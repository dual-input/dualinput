//! The raw file: one JSON object per line, each with `t`, the monotonic µs it was made, and
//! `k`, its kind. A writer thread owns the file and flushes it at least once a second, so a
//! crash loses at most the last second, and no task that times packets ever waits on the disk.

use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::clock::mono_us;

enum Msg {
    Line(String),
    Flush(mpsc::Sender<()>),
    Rotate(PathBuf, mpsc::Sender<std::io::Result<()>>),
}

#[derive(Clone)]
pub struct RawLog {
    tx: Sender<Msg>,
    path: Arc<Mutex<PathBuf>>,
    // Lines written, so the window can say how much it has collected.
    count: Arc<Mutex<u64>>,
}

impl RawLog {
    pub fn create(path: &Path) -> std::io::Result<RawLog> {
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        let (tx, rx) = mpsc::channel::<Msg>();
        std::thread::Builder::new()
            .name("rawlog".into())
            .spawn(move || writer(file, rx))?;
        Ok(RawLog { tx, path: Arc::new(Mutex::new(path.to_path_buf())), count: Arc::new(Mutex::new(0)) })
    }

    pub fn path(&self) -> PathBuf {
        self.path.lock().unwrap().clone()
    }

    /// Closes the current file, everything sent so far in it, and sends every later line to
    /// `next`. Returns the closed file's path.
    pub fn rotate(&self, next: &Path) -> std::io::Result<PathBuf> {
        let (tx, rx) = mpsc::channel();
        self.tx
            .send(Msg::Rotate(next.to_path_buf(), tx))
            .map_err(|_| std::io::Error::other("log writer stopped"))?;
        rx.recv_timeout(Duration::from_secs(10)).map_err(|_| std::io::Error::other("log writer didn't answer"))??;
        let mut p = self.path.lock().unwrap();
        Ok(std::mem::replace(&mut *p, next.to_path_buf()))
    }

    pub fn lines(&self) -> u64 {
        *self.count.lock().unwrap()
    }

    /// Writes `{"t":<now>,"k":<kind>, ...fields}`; `fields` must be a JSON object.
    pub fn rec(&self, kind: &str, fields: serde_json::Value) {
        self.rec_at(mono_us(), kind, fields)
    }

    pub fn rec_at(&self, t: u64, kind: &str, fields: serde_json::Value) {
        let body = fields.to_string();
        let line = if body.len() <= 2 {
            format!("{{\"t\":{t},\"k\":\"{kind}\"}}")
        } else {
            format!("{{\"t\":{t},\"k\":\"{kind}\",{}", &body[1..])
        };
        self.raw(line);
    }

    /// A line already formatted as JSON, for the per-packet records, which skip building a
    /// `serde_json::Value` because they come hundreds of times a second.
    pub fn raw(&self, line: String) {
        *self.count.lock().unwrap() += 1;
        let _ = self.tx.send(Msg::Line(line));
    }

    /// Blocks until everything sent so far is on disk.
    pub fn flush(&self) {
        let (tx, rx) = mpsc::channel();
        if self.tx.send(Msg::Flush(tx)).is_ok() {
            let _ = rx.recv_timeout(Duration::from_secs(10));
        }
    }
}

fn writer(file: File, rx: mpsc::Receiver<Msg>) {
    let mut w = BufWriter::with_capacity(256 * 1024, file);
    let mut last_flush = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(Msg::Line(l)) => {
                let _ = w.write_all(l.as_bytes());
                let _ = w.write_all(b"\n");
            }
            Ok(Msg::Flush(done)) => {
                let _ = w.flush();
                let _ = w.get_ref().sync_data();
                let _ = done.send(());
                last_flush = Instant::now();
            }
            Ok(Msg::Rotate(next, done)) => {
                let _ = w.flush();
                let _ = w.get_ref().sync_data();
                match OpenOptions::new().create(true).append(true).open(&next) {
                    Ok(f) => {
                        w = BufWriter::with_capacity(256 * 1024, f);
                        let _ = done.send(Ok(()));
                    }
                    Err(e) => {
                        let _ = done.send(Err(e));
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                let _ = w.flush();
                return;
            }
        }
        if last_flush.elapsed() >= Duration::from_secs(1) {
            let _ = w.flush();
            last_flush = Instant::now();
        }
    }
}

/// Routes `tracing` events from iroh, noq, and the portmapper into the raw file as `trace`
/// records, each holding the event as tracing's JSON formatter wrote it.
pub fn install_tracing(log: RawLog, filter: &str) {
    use tracing_subscriber::EnvFilter;
    let make = TraceWriter { log };
    let sub = tracing_subscriber::fmt()
        .json()
        .with_env_filter(EnvFilter::new(filter))
        .with_writer(make)
        .with_ansi(false)
        .finish();
    let _ = tracing::subscriber::set_global_default(sub);
}

#[derive(Clone)]
struct TraceWriter {
    log: RawLog,
}

struct TraceLine {
    log: RawLog,
    buf: Vec<u8>,
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for TraceWriter {
    type Writer = TraceLine;
    fn make_writer(&'a self) -> TraceLine {
        TraceLine { log: self.log.clone(), buf: Vec::with_capacity(256) }
    }
}

impl Write for TraceLine {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.buf.extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Drop for TraceLine {
    fn drop(&mut self) {
        let s = String::from_utf8_lossy(&self.buf);
        for line in s.lines().filter(|l| !l.trim().is_empty()) {
            self.log.raw(format!("{{\"t\":{},\"k\":\"trace\",\"e\":{}}}", mono_us(), line.trim()));
        }
    }
}
