//! The bench's socket: TCP on 127.0.0.1, at a port Windows picks, which the core writes to
//! `bench-port` in its data folder, so the bench finds a core whichever program started it.
//! Each line is a message of `messages::bench` as JSON, and the core's first is its version
//! and hash (record/areas/build/02-testing.md, "Its place").

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use messages::bench::{Hello, ToCore};

use super::{Sources, playback};
use crate::queue::Queue;
use crate::run_context::{self, Context};

pub fn start(
    data: &Path,
    queue: Arc<Queue>,
    sources: Sources,
    context: Arc<Context>,
) -> std::io::Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    // Written whole, then renamed, so the bench never reads half a port.
    let new = data.join("bench-port.new");
    std::fs::write(&new, port.to_string())?;
    std::fs::rename(&new, data.join("bench-port"))?;
    tracing::info!(port, "the bench's socket is listening");
    std::thread::Builder::new()
        .name("bench-socket".into())
        .spawn(move || {
            run_context::enter(context.clone());
            // One bench at a time, and the next once it hangs up.
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => serve(stream, &queue, &sources, &context),
                    Err(error) => tracing::warn!(%error, "the bench couldn't connect"),
                }
            }
        })?;
    Ok(())
}

fn serve(stream: TcpStream, queue: &Arc<Queue>, sources: &Sources, context: &Arc<Context>) {
    let hello = Hello {
        version: messages::VERSION.into(),
        hash: messages::HASH.into(),
    };
    let mut hello = serde_json::to_vec(&hello).expect("serde_json should write the hello");
    hello.push(b'\n');
    if (&stream).write_all(&hello).is_err() {
        return;
    }
    for line in BufReader::new(&stream).split(b'\n') {
        let Ok(mut line) = line else {
            return;
        };
        if line.last() == Some(&b'\r') {
            line.pop();
        }
        match serde_json::from_slice(&line) {
            // A load is the bench acting on the core's surroundings, which then send their
            // inputs, so it starts the playback rather than reaching the loop.
            Ok(ToCore::Load { capture, plays }) => playback::play(
                PathBuf::from(capture),
                plays,
                queue.clone(),
                sources.load,
                context.clone(),
            ),
            Ok(_) => queue.push(sources.lines, line, true),
            Err(error) => tracing::warn!(%error, "a line from the bench isn't one of its messages"),
        }
    }
}
