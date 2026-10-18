// A Tauri 2 app that starts as a tray icon with no window, for p01. The probe
// passes the port of its WebSocket server as the only argument; this program's
// Rust side connects to it, as the desktop app's Rust side holds a socket to
// the core, and takes one command per message: open, hide, show, or close,
// answering each with "ok".

#![windows_subsystem = "windows"]

use futures_util::{SinkExt, StreamExt};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tokio_tungstenite::tungstenite::Message;

fn main() {
    let port: u16 = std::env::args().nth(1).and_then(|a| a.parse().ok()).unwrap_or(0);
    let app = tauri::Builder::default()
        .setup(move |app| {
            let icon = app.default_window_icon().cloned().expect("tauri.conf.json names an icon");
            TrayIconBuilder::new().icon(icon).tooltip("p01: Tauri tray").build(app)?;
            let handle = app.handle().clone();
            if port != 0 {
                tauri::async_runtime::spawn(async move {
                    let url = format!("ws://127.0.0.1:{port}/?from=tauri-tray");
                    let Ok((mut ws, _)) = tokio_tungstenite::connect_async(url).await else { return };
                    while let Some(Ok(msg)) = ws.next().await {
                        let Message::Text(cmd) = msg else { continue };
                        let result = match cmd.as_str() {
                            "open" => WebviewWindowBuilder::new(&handle, "main", WebviewUrl::App("index.html".into()))
                                .title("p01: Tauri tray")
                                .inner_size(480.0, 360.0)
                                .build()
                                .map(|_| ())
                                .map_err(|e| e.to_string()),
                            "hide" | "show" | "close" => match handle.get_webview_window("main") {
                                Some(w) => match cmd.as_str() {
                                    "hide" => w.hide(),
                                    "show" => w.show(),
                                    // destroy() drops the window and its webview at once, where
                                    // close() only asks, so the probe measures a window that's gone.
                                    _ => w.destroy(),
                                }
                                .map_err(|e| e.to_string()),
                                None => Err("no window".into()),
                            },
                            other => Err(format!("unknown command {other}")),
                        };
                        let reply = match result {
                            Ok(()) => "ok".to_string(),
                            Err(e) => format!("error: {e}"),
                        };
                        if ws.send(Message::Text(reply.into())).await.is_err() {
                            break;
                        }
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the Tauri app failed to build");
    // With its last window gone, Tauri exits unless told not to, and a tray app
    // has to outlive its window; an exit with a code, from the app itself, still
    // goes through.
    app.run(|_app, event| {
        if let RunEvent::ExitRequested { code: None, api, .. } = event {
            api.prevent_exit();
        }
    });
}
