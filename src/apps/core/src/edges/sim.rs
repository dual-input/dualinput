//! The sim thread: the sim edge, which holds every SimConnect connection, pushes what the
//! sim hands up under the sim service's source, and makes each call the loop puts out
//! (record/areas/core/03-sim-seam-and-wasm-module.md, "The edge").

use std::sync::Arc;
use std::thread::JoinHandle;

use kernel::SourceId;
use sim_client::SimCall;
use sim_edge::SimEdge;

use crate::queue::Queue;
use crate::run_context::{self, Context};
use crate::sinks::Sinks;

pub fn start(
    queue: Arc<Queue>,
    source: SourceId,
    context: Arc<Context>,
    sinks: &mut Sinks,
) -> std::io::Result<(SimEdge, JoinHandle<()>)> {
    let (edge, thread) = SimEdge::start(
        move || run_context::enter(context),
        move |up| queue.push(source, up.encode()),
    )?;
    let calls = edge.clone();
    sinks.on(move |call: SimCall| calls.call(call));
    Ok((edge, thread))
}
