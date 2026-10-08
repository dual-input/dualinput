// One Tauri window showing ../page, for p05. The probe passes the port of its
// WebSocket server as the only argument. The page and this program's Rust side
// each open a WebSocket to it, so the server logs the Origin each one sends.

#![windows_subsystem = "windows"]

use futures_util::StreamExt;
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    let port: u16 = std::env::args().nth(1).and_then(|a| a.parse().ok()).unwrap_or(0);
    tauri::Builder::default()
        .setup(move |app| {
            // The page reads these globals because the initialization script
            // runs before the page's own scripts, and Electron passes the same
            // two values in the query instead.
            let globals = format!("window.CROSSCHECK_P05_PORT = {port}; window.CROSSCHECK_P05_FROM = \"tauri-page\";");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("p05: Tauri")
                .inner_size(480.0, 360.0)
                .initialization_script(globals.as_str())
                .build()?;
            if port != 0 {
                tauri::async_runtime::spawn(async move {
                    let url = format!("ws://127.0.0.1:{port}/?from=tauri-rust");
                    // Reading until the server hangs up keeps the socket open
                    // while the probe measures, as an app's connection would be.
                    if let Ok((mut ws, _)) = tokio_tungstenite::connect_async(url).await {
                        while let Some(Ok(_)) = ws.next().await {}
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the Tauri app failed to start");
}
