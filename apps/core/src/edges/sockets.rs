//! The clients' WebSocket server, on tokio: a task for each socket hands up its open, each
//! text message, and its close as inputs, and carries out the clients crate's sends and
//! closes (record/areas/core/02-clients-and-panel-bridge.md, "The WebSocket server").

use std::collections::BTreeMap;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use clients::{SocketOut, SocketUp};
use futures_util::{SinkExt, StreamExt};
use kernel::SourceId;
use messages::clients::{PORT_FILE, PortFile};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_websockets::{CloseCode, Limits, Message, ServerBuilder};
use windows_sys::Win32::Foundation::FILETIME;
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, GetProcessTimes,
};

use crate::queue::Queue;
use crate::sinks::Sinks;

/// The largest message a socket takes, sixteen times a message's 64 KiB budget, so a message
/// over budget still arrives and the bench catches it, while a runaway closes the socket.
/// tokio-websockets' own default is 64 MiB.
const LIMIT: usize = 1024 * 1024;

/// What every page we use sent as its `Origin` (measured on MSFS 2024, 2026-10-08,
/// record/areas/interface/log.md); the desktop app's Rust side sends none (decision 013).
const SIM_ORIGIN: &str = "coui://html_ui";

type Senders = Arc<Mutex<BTreeMap<u64, mpsc::UnboundedSender<Message>>>>;

/// The running server, whose port file goes as the core exits.
pub struct Server {
    port_file: PathBuf,
}

impl Server {
    /// Deletes the port file, so no app finds a core that's gone.
    pub fn stop(&self) {
        if let Err(error) = std::fs::remove_file(&self.port_file) {
            tracing::warn!(%error, "the port file couldn't be deleted");
        }
    }
}

/// Binds the server on 127.0.0.1 at a port Windows picks, hands the port up as an input, and
/// writes the port file. Each socket's ID comes from a counter here, inside its inputs, so a
/// replay sees the same IDs.
pub fn start(
    runtime: &tokio::runtime::Handle,
    queue: Arc<Queue>,
    source: SourceId,
    data: &Path,
    sinks: &mut Sinks,
) -> std::io::Result<Server> {
    let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    queue.push(source, SocketUp::Bound { port }.encode());
    let port_file = data.join(PORT_FILE);
    write_port_file(&port_file, port)?;

    let senders = Senders::default();
    let listener = {
        let _runtime = runtime.enter();
        TcpListener::from_std(listener)?
    };
    runtime.spawn(accept(listener, queue, source, senders.clone()));
    sinks.on(move |out: SocketOut| {
        let senders = senders
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let (socket, message) = match out {
            SocketOut::Send { socket, text } => (socket, Message::text(text)),
            SocketOut::Close { socket, code } => {
                (socket, Message::close(CloseCode::try_from(code).ok(), ""))
            }
        };
        // A socket whose task ended has handed up its close, which the clients crate takes
        // in turn, so a send to it now goes nowhere.
        if let Some(sender) = senders.get(&socket) {
            let _ = sender.send(message);
        }
    });
    tracing::info!(port, "the clients' WebSocket server listens on 127.0.0.1");
    Ok(Server { port_file })
}

async fn accept(listener: TcpListener, queue: Arc<Queue>, source: SourceId, senders: Senders) {
    let next = Arc::new(AtomicU64::new(0));
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                tokio::spawn(serve(
                    stream,
                    queue.clone(),
                    source,
                    senders.clone(),
                    next.clone(),
                ));
            }
            Err(error) => tracing::warn!(%error, "a connection to the WebSocket server failed"),
        }
    }
}

async fn serve(
    stream: TcpStream,
    queue: Arc<Queue>,
    source: SourceId,
    senders: Senders,
    next: Arc<AtomicU64>,
) {
    let builder = ServerBuilder::new().limits(Limits::default().max_payload_len(Some(LIMIT)));
    let (request, mut ws) = match builder.accept(stream).await {
        Ok(accepted) => accepted,
        Err(error) => {
            tracing::debug!(%error, "a WebSocket's handshake failed");
            return;
        }
    };
    // `accept` has written the upgrade by the time it returns the request, so a page whose
    // Origin isn't the sim's is closed before anything it sent is read, and nothing of it
    // reaches the loop (decision 013).
    let origin = request
        .headers()
        .get("origin")
        .map(|v| v.to_str().unwrap_or("?").to_string());
    if origin.as_deref().is_some_and(|o| o != SIM_ORIGIN) {
        tracing::warn!(origin, "a WebSocket from a page outside the sim was closed");
        let _ = ws
            .send(Message::close(Some(CloseCode::POLICY_VIOLATION), ""))
            .await;
        return;
    }
    let socket = next.fetch_add(1, Ordering::Relaxed);
    let (sender, mut outgoing) = mpsc::unbounded_channel();
    senders
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .insert(socket, sender);
    queue.push(source, SocketUp::Opened { socket }.encode());
    loop {
        tokio::select! {
            incoming = ws.next() => match incoming {
                Some(Ok(message)) => {
                    if let Some(text) = message.as_text() {
                        queue.push(source, SocketUp::Text { socket, text: text.to_string() }.encode());
                    } else if message.is_binary() {
                        // The protocol is JSON text alone.
                        let _ = ws.send(Message::close(Some(CloseCode::UNSUPPORTED_DATA), "")).await;
                        break;
                    } else if message.is_close() {
                        break;
                    }
                }
                Some(Err(_)) | None => break,
            },
            message = outgoing.recv() => match message {
                Some(message) => {
                    let closing = message.is_close();
                    if ws.send(message).await.is_err() || closing {
                        break;
                    }
                }
                None => break,
            },
        }
    }
    senders
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .remove(&socket);
    queue.push(source, SocketUp::Closed { socket }.encode());
}

/// Writes the port file through a file beside it renamed over it, so an app never reads half
/// of one.
fn write_port_file(path: &Path, port: u16) -> std::io::Result<()> {
    let (process, created) = this_process();
    let text = serde_json::to_string(&PortFile {
        port,
        process,
        created,
    })
    .map_err(std::io::Error::other)?;
    let mut new = path.as_os_str().to_owned();
    new.push(".new");
    std::fs::write(&new, text)?;
    std::fs::rename(&new, path)
}

/// The core's process ID and its creation time, which name this run of the core together.
fn this_process() -> (u32, u64) {
    let zero = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
    // SAFETY: GetCurrentProcess returns a pseudo handle that needs no closing, and
    // GetProcessTimes writes the four FILETIMEs it's given.
    unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut created,
            &mut exited,
            &mut kernel,
            &mut user,
        );
    }
    // SAFETY: GetCurrentProcessId takes nothing and can't fail.
    let process = unsafe { GetCurrentProcessId() };
    (
        process,
        (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime),
    )
}
