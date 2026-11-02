//! The fixed local port the EFB app connects to: a WebSocket server on 127.0.0.1 that sends each socket the desktop app's
//! whole state when it opens and again each time it changes, and hands up what the socket asks.

use futures_util::{SinkExt, StreamExt};
use messages::desktop::{DesktopState, ToDesktop};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, watch};
use tokio_websockets::{CloseCode, Limits, Message, ServerBuilder};

/// What every page we use sent as its `Origin` (measured on MSFS 2024, 2026-10-08, record/areas/interface/log.md). Only the
/// EFB app has any reason to reach this port, and any web page in a browser on this PC can open a socket to 127.0.0.1, so
/// one that says nothing is closed too, where the core takes that from the desktop app. `SIM_ORIGIN` in
/// src/apps/core/src/edges/sockets.rs names the same one.
const SIM_ORIGIN: &str = "coui://html_ui";

/// The largest message a socket takes, far past the few words any of them is.
const LIMIT: usize = 4 * 1024;

const ACCEPT_AGAIN_AFTER: std::time::Duration = std::time::Duration::from_millis(100);

/// Serves each connection until the listener's task ends with the program.
pub async fn serve(
    listener: TcpListener,
    state: watch::Receiver<DesktopState>,
    asks: mpsc::UnboundedSender<ToDesktop>,
) {
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                tokio::spawn(socket(stream, state.clone(), asks.clone()));
            }
            // Out of handles, say, it would fail again at once, so it waits rather than spin a CPU core.
            Err(error) => {
                crate::log::line(&format!("a connection to the local port failed: {error}"));
                tokio::time::sleep(ACCEPT_AGAIN_AFTER).await;
            }
        }
    }
}

async fn socket(
    stream: TcpStream,
    mut state: watch::Receiver<DesktopState>,
    asks: mpsc::UnboundedSender<ToDesktop>,
) {
    let builder = ServerBuilder::new().limits(Limits::default().max_payload_len(Some(LIMIT)));
    let Ok((request, mut ws)) = builder.accept(stream).await else {
        return;
    };
    // `accept` has written the upgrade by the time it returns the request, so a page that isn't the sim's is closed before anything it sent is read.
    if request
        .headers()
        .get("origin")
        .and_then(|origin| origin.to_str().ok())
        != Some(SIM_ORIGIN)
    {
        let _ = ws
            .send(Message::close(Some(CloseCode::POLICY_VIOLATION), ""))
            .await;
        return;
    }
    let first = state.borrow_and_update().clone();
    if send(&mut ws, &first).await.is_err() {
        return;
    }
    loop {
        tokio::select! {
            changed = state.changed() => {
                if changed.is_err() {
                    return;
                }
                let now = state.borrow_and_update().clone();
                if send(&mut ws, &now).await.is_err() {
                    return;
                }
            }
            incoming = ws.next() => match incoming {
                Some(Ok(message)) => {
                    if message.is_close() {
                        return;
                    }
                    // What doesn't read is a page from another version, which asks nothing of this one.
                    if let Some(ask) = message.as_text().and_then(|text| serde_json::from_str::<ToDesktop>(text).ok()) {
                        let _ = asks.send(ask);
                    }
                }
                Some(Err(_)) | None => return,
            },
        }
    }
}

async fn send<S>(
    ws: &mut tokio_websockets::WebSocketStream<S>,
    state: &DesktopState,
) -> Result<(), tokio_websockets::Error>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let text = serde_json::to_string(state).expect("the desktop app's state should encode as JSON");
    ws.send(Message::text(text)).await
}

#[cfg(test)]
mod tests {
    use messages::desktop::{Firewall, Update};
    use tokio_websockets::ClientBuilder;

    use super::*;

    fn state() -> DesktopState {
        DesktopState {
            update: Update::Current { checked: None },
            firewall: Firewall::Allows,
            start_with_windows: messages::desktop::StartWithWindows::On,
        }
    }

    /// A server on a port Windows picks, with the handles a test drives it through.
    async fn bench() -> (
        u16,
        watch::Sender<DesktopState>,
        mpsc::UnboundedReceiver<ToDesktop>,
    ) {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("a port should be free");
        let port = listener
            .local_addr()
            .expect("a bound listener should have an address")
            .port();
        let (say, hear) = watch::channel(state());
        let (ask, asks) = mpsc::unbounded_channel();
        tokio::spawn(serve(listener, hear, ask));
        (port, say, asks)
    }

    async fn connect(
        port: u16,
        origin: Option<&str>,
    ) -> tokio_websockets::WebSocketStream<tokio_websockets::MaybeTlsStream<TcpStream>> {
        let mut client = ClientBuilder::new()
            .uri(&format!("ws://127.0.0.1:{port}"))
            .expect("the address should parse");
        if let Some(origin) = origin {
            client = client
                .add_header(
                    "origin".try_into().expect("the name should parse"),
                    origin.try_into().expect("the origin should parse"),
                )
                .expect("the header should add");
        }
        client
            .connect()
            .await
            .expect("the server should take the socket")
            .0
    }

    async fn next_state(
        ws: &mut tokio_websockets::WebSocketStream<tokio_websockets::MaybeTlsStream<TcpStream>>,
    ) -> DesktopState {
        let message = ws
            .next()
            .await
            .expect("the socket should stay open")
            .expect("the message should arrive");
        serde_json::from_str(message.as_text().expect("the state should be text"))
            .expect("the state should decode")
    }

    #[tokio::test(flavor = "current_thread")]
    async fn a_page_from_the_sim_hears_the_state_whole_and_each_change() {
        let (port, say, _asks) = bench().await;
        let mut ws = connect(port, Some(SIM_ORIGIN)).await;
        assert_eq!(next_state(&mut ws).await, state());
        let ready = DesktopState {
            update: Update::Ready {
                next: "1.0.3".into(),
            },
            ..state()
        };
        say.send(ready.clone())
            .expect("a socket should be watching");
        assert_eq!(next_state(&mut ws).await, ready);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn what_a_page_asks_is_handed_up_and_what_doesnt_read_is_dropped() {
        let (port, _say, mut asks) = bench().await;
        let mut ws = connect(port, Some(SIM_ORIGIN)).await;
        let _ = next_state(&mut ws).await;
        ws.send(Message::text("not json".to_string()))
            .await
            .expect("the socket should take it");
        ws.send(Message::text(
            r#"{"t":"set-start-with-windows","on":false}"#.to_string(),
        ))
        .await
        .expect("the socket should take it");
        assert_eq!(
            asks.recv().await,
            Some(ToDesktop::SetStartWithWindows { on: false })
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn a_page_outside_the_sim_and_one_with_no_origin_are_closed() {
        let (port, _say, _asks) = bench().await;
        for origin in [Some("https://example.com"), None] {
            let mut ws = connect(port, origin).await;
            let message = ws
                .next()
                .await
                .expect("the close should arrive")
                .expect("the close should read");
            assert!(message.is_close(), "{origin:?} should hear no state");
        }
    }
}
