//! The socket to the author's own core, through which `serve` reaches the sim
//! (record/areas/profiles/04-the-extension-in-the-sim.md, "The connection"). A thread of its own
//! runs the WebSocket client on a current-thread tokio runtime, and hands what the core sends to
//! the rest of `serve` over a crossbeam channel, which `serve`'s loop waits on beside the editor's.
//!
//! It knows the socket's life and nothing of what goes over it: it reads the core's port from
//! `port.json` in the data folder it's given, connects with no `Origin`, which the core takes
//! (decision 013), says `alive` every 2s, and tries again every 2s while it has no socket. What a
//! new socket hears first is `serve`'s to send, once it hears `Opened`.

use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crossbeam_channel::{Receiver, Sender};
use futures_util::{SinkExt, StreamExt};
use messages::clients::{FromClient, PORT_FILE, PortFile, ToClient};
use tokio::net::TcpStream;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use tokio_websockets::{ClientBuilder, Message, WebSocketStream};

/// How often the socket says `alive`, which the protocol asks of every client, and how often the
/// connection tries again while it has none.
const EVERY: Duration = Duration::from_secs(2);

/// What the rest of `serve` tells the connection.
#[derive(Debug)]
pub(crate) enum Up {
    /// The core's data folder, which holds its `port.json`: the `dualInput.dataFolder` setting's,
    /// or `%APPDATA%\DualInput\`. The connection tries nothing until the first.
    Folder(PathBuf),
    /// A message for the core, which goes nowhere while there's no socket, since `serve` sends
    /// what a socket needs again on each new one.
    Send(FromClient),
}

/// What the connection tells the rest of `serve`.
#[derive(Debug)]
pub(crate) enum Down {
    Opened,
    Heard(ToClient),
    Closed,
}

/// The two ends `serve` holds. Its loop waits on crossbeam channels, so the core's messages come
/// over one; its own go over tokio's, whose `send` needs no runtime, so the connection's loop can
/// await them beside the socket.
pub(crate) struct Link {
    pub(crate) up: UnboundedSender<Up>,
    pub(crate) down: Receiver<Down>,
}

/// Starts the connection's thread, which tries nothing until it's told the data folder.
pub(crate) fn start() -> Link {
    let (up, inbox) = unbounded_channel();
    let (out, down) = crossbeam_channel::unbounded();
    std::thread::Builder::new()
        .name("the core's socket".into())
        .spawn(move || {
            match tokio::runtime::Builder::new_current_thread()
                .enable_io()
                .enable_time()
                .build()
            {
                Ok(runtime) => runtime.block_on(run(inbox, out)),
                Err(e) => eprintln!(
                    "The connection to Dual Input didn't start, so the sim's features are off: {e}"
                ),
            }
        })
        .expect("the connection's thread should start");
    Link { up, down }
}

/// How a socket ended.
#[derive(PartialEq, Eq)]
enum Ended {
    /// The core closed it, or it broke.
    Lost,
    /// The data folder changed, so the next socket goes to the core it names.
    Moved,
    /// `serve` is gone.
    Quit,
}

async fn run(mut inbox: UnboundedReceiver<Up>, out: Sender<Down>) {
    let mut folder: Option<PathBuf> = None;
    loop {
        let socket = match &folder {
            Some(folder) => connect(folder).await,
            None => None,
        };
        if let Some(ws) = socket {
            if out.send(Down::Opened).is_err() {
                return;
            }
            let ended = talk(ws, &mut inbox, &out, &mut folder).await;
            if out.send(Down::Closed).is_err() || ended == Ended::Quit {
                return;
            }
            if ended == Ended::Moved {
                continue;
            }
        }
        let wait = tokio::time::sleep(EVERY);
        tokio::pin!(wait);
        loop {
            tokio::select! {
                () = &mut wait => break,
                up = inbox.recv() => match up {
                    None => return,
                    Some(Up::Folder(f)) => {
                        folder = Some(f);
                        break;
                    }
                    Some(Up::Send(_)) => {}
                },
            }
        }
    }
}

/// A socket to the core whose `port.json` sits in `folder`, if one answers. A core that crashed
/// leaves its port file behind, naming a port nothing answers on, or another program's, whose
/// handshake fails, so either is tried again later.
async fn connect(folder: &Path) -> Option<WebSocketStream<TcpStream>> {
    let text = std::fs::read_to_string(folder.join(PORT_FILE)).ok()?;
    let port = serde_json::from_str::<PortFile>(&text).ok()?.port;
    let attempt = async {
        let stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await.ok()?;
        let builder = ClientBuilder::new()
            .uri(&format!("ws://127.0.0.1:{port}/"))
            .ok()?;
        builder.connect_on(stream).await.ok().map(|(ws, _)| ws)
    };
    tokio::time::timeout(EVERY, attempt).await.ok().flatten()
}

async fn talk(
    mut ws: WebSocketStream<TcpStream>,
    inbox: &mut UnboundedReceiver<Up>,
    out: &Sender<Down>,
    folder: &mut Option<PathBuf>,
) -> Ended {
    let mut alive = tokio::time::interval_at(tokio::time::Instant::now() + EVERY, EVERY);
    loop {
        tokio::select! {
            heard = ws.next() => match heard {
                Some(Ok(message)) if message.is_close() => return Ended::Lost,
                Some(Ok(message)) => {
                    let Some(text) = message.as_text() else {
                        continue;
                    };
                    match serde_json::from_str::<ToClient>(text) {
                        Ok(message) => {
                            if out.send(Down::Heard(message)).is_err() {
                                return Ended::Quit;
                            }
                        }
                        // A core of another release may send a message this one doesn't know,
                        // and the slices that say so still read.
                        Err(e) => eprintln!("A message from Dual Input didn't read, so it was dropped: {e}"),
                    }
                }
                Some(Err(_)) | None => return Ended::Lost,
            },
            up = inbox.recv() => match up {
                None => {
                    let _ = ws.close().await;
                    return Ended::Quit;
                }
                Some(Up::Send(message)) => {
                    if send(&mut ws, &message).await.is_err() {
                        return Ended::Lost;
                    }
                }
                Some(Up::Folder(f)) if folder.as_ref() != Some(&f) => {
                    *folder = Some(f);
                    let _ = ws.close().await;
                    return Ended::Moved;
                }
                Some(Up::Folder(_)) => {}
            },
            _ = alive.tick() => {
                if send(&mut ws, &FromClient::Alive).await.is_err() {
                    return Ended::Lost;
                }
            }
        }
    }
}

async fn send(
    ws: &mut WebSocketStream<TcpStream>,
    message: &FromClient,
) -> Result<(), tokio_websockets::Error> {
    let text = serde_json::to_string(message).expect("a message to the core should encode");
    ws.send(Message::text(text)).await
}
