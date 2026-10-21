//! The bench build's own edge and test units, which only a build with the `stand-in`
//! feature has: the socket the bench drives the core through, and the units its scenarios
//! name. Everything else in a bench build is a release's code
//! (record/areas/build/02-testing.md, "Its place").

mod lines;
mod load;
mod playback;
mod socket;

use std::path::Path;
use std::sync::Arc;

use kernel::{Kernel, Registry, SourceId};

use crate::queue::Queue;
use crate::run_context::Context;
use crate::sinks::Sinks;

/// The test units, which `main` registers after the build's own.
pub const UNITS: &[fn(&mut Registry)] = &[lines::Lines::register, load::Load::register];

/// The sources the bench's edge pushes the test units' inputs under.
pub struct Sources {
    lines: SourceId,
    load: SourceId,
}

impl Sources {
    /// The test units' sources, or `None` for a core run with units of its own, such as a
    /// test's, which then opens no socket.
    pub fn of(kernel: &Kernel) -> Option<Sources> {
        Some(Sources {
            lines: kernel.source::<lines::Socket>()?,
            load: kernel.source::<load::Playback>()?,
        })
    }
}

/// The test units' outputs go into the outputs' hash, so a replay checks them, and
/// nowhere else.
pub fn sinks(sinks: &mut Sinks) {
    sinks.on(|_: lines::Counted| {});
    sinks.on(|_: load::Wrote| {});
}

/// Opens the bench's socket and writes its port into the data folder.
pub fn start(
    data: &Path,
    queue: Arc<Queue>,
    sources: Sources,
    context: Arc<Context>,
) -> std::io::Result<()> {
    socket::start(data, queue, sources, context)
}
