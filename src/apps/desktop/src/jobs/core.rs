//! The core, as the app starts it, finds it, and quits it. The app starts `dualinput-core.exe` from its own folder, and finds
//! a core it didn't start through the port file, which names the core's process by its ID and creation time, since a crashed
//! core leaves the file behind and Windows may give its ID to another process (decision 014).

use std::os::windows::io::IntoRawHandle;
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use messages::clients::{FromClient, Hello, PortFile, ToClient, component};
use messages::session::command::QUIT;
use tokio_websockets::{ClientBuilder, Message};

use crate::places;
use crate::processes::Held;

/// A console program started from this one opens a console window unless told not to.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// How long Quit waits for the core's `bye` before the app ends anyway.
const QUIT_WAIT: Duration = Duration::from_secs(3);

/// The core the port file names, if that core still runs.
pub fn named() -> Option<Held> {
    let text = std::fs::read_to_string(places::port_file()).ok()?;
    let file: PortFile = serde_json::from_str(&text).ok()?;
    let held = Held::open(file.process)?;
    (held.created == file.created).then_some(held)
}

/// Starts the core from this program's folder, on the data folder `--data` named, if any, with none of this program's
/// standard handles, so it outlives the app.
pub fn start() -> Result<Held, String> {
    let program = places::core_program();
    let mut command = Command::new(&program);
    if let Some(folder) = places::named_data_folder() {
        command.arg("--data").arg(folder);
    }
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|error| format!("{} didn't start: {error}", program.display()))?;
    let id = child.id();
    Held::adopt(child.into_raw_handle(), id)
        .ok_or_else(|| format!("the core {id} started and couldn't be held"))
}

/// Sends the session crate's Quit to the core the port file names, as any client may, and waits for its `bye`, or its socket
/// to close, at most 3s. The core then leaves any session, so the crew sees a leave rather than a lost link.
pub async fn quit() {
    let Some(port) = std::fs::read_to_string(places::port_file())
        .ok()
        .and_then(|text| serde_json::from_str::<PortFile>(&text).ok())
        .map(|file| file.port)
    else {
        return;
    };
    let sent = tokio::time::timeout(QUIT_WAIT, async {
        let uri = format!("ws://127.0.0.1:{port}");
        let (mut ws, _) = ClientBuilder::new()
            .uri(&uri)
            .map_err(|error| error.to_string())?
            .connect()
            .await
            .map_err(|error| error.to_string())?;
        let hello = FromClient::Hello(Hello {
            component: component::DESKTOP.into(),
            version: messages::VERSION.into(),
            hash: messages::HASH.into(),
            panel: None,
            instruments: Vec::new(),
        });
        let quit = FromClient::Command {
            id: 1,
            name: QUIT.into(),
            args: serde_json::Value::Null,
        };
        for message in [hello, quit] {
            let text = serde_json::to_string(&message).map_err(|error| error.to_string())?;
            ws.send(Message::text(text))
                .await
                .map_err(|error| error.to_string())?;
        }
        while let Some(Ok(message)) = ws.next().await {
            if let Some(ToClient::Bye) = message
                .as_text()
                .and_then(|text| serde_json::from_str(text).ok())
            {
                break;
            }
        }
        Ok::<(), String>(())
    })
    .await;
    match sent {
        Ok(Ok(())) => crate::log::line("the core quit"),
        Ok(Err(error)) => crate::log::line(&format!("the core's Quit didn't go: {error}")),
        Err(_) => crate::log::line("the core didn't say bye within 3s of its Quit"),
    }
}
