//! The core helper's edge, on tokio: it starts the helper's program with its standard input
//! and output piped, hands up its start, each message, and its exit as inputs, and carries
//! out the service's sends, stops, and kills (record/areas/core/04-core-helper.md, "The
//! helper's life").

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use core_helper_service::{PipeOut, PipeUp};
use kernel::SourceId;
use messages::core_helper;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::mpsc;

use crate::queue::Queue;
use crate::sinks::Sinks;

/// How long the helper has to exit once its standard input closes, before the edge kills it.
const STOP_WAIT: Duration = Duration::from_secs(1);

/// The helper's program, beside the core's own, which `tools/build.ts` lays out together.
/// `PROGRAM`'s comment and its setting's label in src/platform/core-helper-service/src/lib.rs
/// name the same file, so change all three together.
const PROGRAM: &str = "dualinput-core-helper.exe";

/// The run the service last started, from its start until its process exits.
struct Running {
    run: u32,
    /// Each message for the helper, framed, until a stop drops this, which closes its
    /// standard input once the messages before it are written.
    frames: Option<mpsc::UnboundedSender<Vec<u8>>>,
    kill: mpsc::UnboundedSender<()>,
}

pub fn start(
    runtime: &tokio::runtime::Handle,
    queue: Arc<Queue>,
    source: SourceId,
    sinks: &mut Sinks,
) {
    let runtime = runtime.clone();
    let current: Mutex<Option<Running>> = Mutex::new(None);
    sinks.on(move |out: PipeOut| {
        let mut current = current.lock().unwrap_or_else(|p| p.into_inner());
        match out {
            // Sinks run on the loop's thread, and starting a process can take a while, so
            // the start runs on tokio. The run's channels exist from here, so a send, a stop,
            // or a kill that comes before the process does waits for it in order.
            PipeOut::Start { run, program } => {
                let (frames, to_write) = mpsc::unbounded_channel();
                let (kill, killed) = mpsc::unbounded_channel();
                *current = Some(Running {
                    run,
                    frames: Some(frames),
                    kill,
                });
                let path = program_path(&program);
                runtime.spawn(run_helper(
                    run,
                    path,
                    to_write,
                    killed,
                    queue.clone(),
                    source,
                ));
            }
            PipeOut::Send { run, message } => {
                let Some(frames) = current
                    .as_ref()
                    .filter(|r| r.run == run)
                    .and_then(|r| r.frames.as_ref())
                else {
                    return;
                };
                match core_helper::frame(&message) {
                    Ok(bytes) => {
                        let _ = frames.send(bytes);
                    }
                    Err(error) => {
                        tracing::error!(%error, "a message for the core helper didn't encode")
                    }
                }
            }
            PipeOut::Stop { run } => {
                if let Some(running) = current.as_mut().filter(|r| r.run == run) {
                    running.frames = None;
                    let kill = running.kill.clone();
                    runtime.spawn(async move {
                        tokio::time::sleep(STOP_WAIT).await;
                        // The process may be gone already, with nothing left to hear this.
                        let _ = kill.send(());
                    });
                }
            }
            PipeOut::Kill { run } => {
                if let Some(running) = current.as_ref().filter(|r| r.run == run) {
                    let _ = running.kill.send(());
                }
            }
        }
    });
}

/// The program to start: the helper beside the core, or the one the development setting
/// names, which a relative path finds from the core's folder.
fn program_path(program: &str) -> PathBuf {
    super::beside_core(if program.is_empty() { PROGRAM } else { program })
}

/// Starts the helper, then writes to it and watches it until it exits.
async fn run_helper(
    run: u32,
    path: PathBuf,
    to_write: mpsc::UnboundedReceiver<Vec<u8>>,
    killed: mpsc::UnboundedReceiver<()>,
    queue: Arc<Queue>,
    source: SourceId,
) {
    let started = Command::new(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let mut child = match started {
        Ok(child) => child,
        Err(error) => {
            let error = format!("{} didn't start: {error}", path.display());
            queue.push(source, PipeUp::NotStarted { run, error }.encode());
            return;
        }
    };
    let process = child.id().unwrap_or(0);
    queue.push(source, PipeUp::Started { run, process }.encode());
    let stdin = child
        .stdin
        .take()
        .expect("the helper's standard input should be piped");
    let stdout = child
        .stdout
        .take()
        .expect("the helper's standard output should be piped");
    tokio::spawn(write(stdin, to_write));
    watch(run, child, stdout, killed, queue, source).await;
}

/// Writes each message to the helper until the service stops it, then closes its standard
/// input by dropping it, which tells the helper to exit.
async fn write(mut stdin: ChildStdin, mut frames: mpsc::UnboundedReceiver<Vec<u8>>) {
    while let Some(bytes) = frames.recv().await {
        if stdin.write_all(&bytes).await.is_err() {
            break;
        }
    }
}

/// Reads the helper's messages and waits for its exit, which goes up after every message it
/// sent before it.
async fn watch(
    run: u32,
    mut child: Child,
    stdout: ChildStdout,
    mut killed: mpsc::UnboundedReceiver<()>,
    queue: Arc<Queue>,
    source: SourceId,
) {
    let reading = read(run, stdout, queue.clone(), source);
    tokio::pin!(reading);
    let mut read_all = false;
    let status = loop {
        tokio::select! {
            too_long = &mut reading, if !read_all => {
                read_all = true;
                if too_long {
                    tracing::error!(run, "the core helper sent a length over 1 MiB, so the core killed it");
                    let _ = child.start_kill();
                }
            }
            Some(()) = killed.recv() => {
                let _ = child.start_kill();
            }
            status = child.wait() => break status,
        }
    };
    if !read_all {
        let _ = tokio::time::timeout(STOP_WAIT, reading).await;
    }
    let code = status.ok().and_then(|s| s.code());
    queue.push(source, PipeUp::Exited { run, code }.encode());
}

/// Hands up each message until the helper's standard output closes. Returns true when it
/// stopped at a length over the most a message may be, which only a bug sends.
async fn read(run: u32, mut stdout: ChildStdout, queue: Arc<Queue>, source: SourceId) -> bool {
    loop {
        let mut head = [0; 4];
        if stdout.read_exact(&mut head).await.is_err() {
            return false;
        }
        let Some(length) = core_helper::length(head) else {
            return true;
        };
        let mut bytes = vec![0; length];
        if stdout.read_exact(&mut bytes).await.is_err() {
            return false;
        }
        queue.push(source, PipeUp::Message { run, bytes }.encode());
    }
}
