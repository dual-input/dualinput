//! The network's edge: the transport on the core's tokio runtime, which carries out the
//! network crate's commands and pushes each of its events into the queue under the network's
//! source (record/areas/network/02-units.md, "The transport").

use std::sync::Arc;

use kernel::SourceId;
use messages::net::Command;
use transport::Transport;

use crate::clock;
use crate::queue::Queue;
use crate::sinks::Sinks;

pub fn start(
    runtime: &tokio::runtime::Handle,
    queue: Arc<Queue>,
    source: SourceId,
    sinks: &mut Sinks,
) -> Transport {
    let transport = transport::start(runtime, clock::now, move |event| {
        queue.push(source, network::encode_event(&event))
    });
    let commands = transport.clone();
    sinks.on(move |command: Command| commands.send(command));
    transport
}
