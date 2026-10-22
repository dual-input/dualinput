//! The bench build's own edge and test units, which only a build with the `stand-in`
//! feature has: the socket the bench drives the core through, the stand-in sim in the sim
//! edge's place, and the units its scenarios name. Everything else in a bench build is a
//! release's code (record/areas/build/02-testing.md, "Its place").

mod lines;
mod load;
mod module;
mod playback;
mod sim;
mod socket;

use std::path::Path;
use std::sync::{Arc, Mutex};

use kernel::{Kernel, Registry, SourceId};
use messages::bench::FromCore;
use sim_client::SimCall;
use stand_in_sim::StandIn;

use crate::queue::Queue;
use crate::run_context::Context;
use crate::sinks::Sinks;

/// The test units, which `main` registers after the build's own.
pub const UNITS: &[fn(&mut Registry)] = &[
    lines::Lines::register,
    load::Load::register,
    sim::Probe::register,
];

/// The sources the bench's edge pushes the test units' inputs under, and each unit's name by
/// its place, for a scenario that names the unit whose sim connection it acts on.
pub struct Sources {
    lines: SourceId,
    load: SourceId,
    sim: SourceId,
    units: Vec<&'static str>,
}

impl Sources {
    /// The test units' sources, or `None` for a core run with units of its own, such as a
    /// test's, which then opens no socket.
    pub fn of(kernel: &Kernel) -> Option<Sources> {
        Some(Sources {
            lines: kernel.source::<lines::Socket>()?,
            load: kernel.source::<load::Playback>()?,
            sim: kernel.source::<sim::Calls>()?,
            units: kernel.units(),
        })
    }
}

/// Where the bench's lines from the core go: the bench connected now, if one is.
#[derive(Clone, Default)]
pub struct ToBench(Arc<Mutex<Option<std::net::TcpStream>>>);

impl ToBench {
    pub fn send(&self, line: &FromCore) {
        let mut text = serde_json::to_vec(line).expect("serde_json should write a bench line");
        text.push(b'\n');
        let mut bench = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(stream) = bench.as_mut() {
            use std::io::Write;
            if stream.write_all(&text).is_err() {
                *bench = None;
            }
        }
    }
}

/// Starts the stand-in sim, when the core has a sim service, with our module's routines and
/// the bench's own, and opens the bench's socket. The test units' outputs go into the
/// outputs' hash, so a replay checks them, and what the sim's test unit heard goes to the
/// bench too.
pub fn start(
    data: &Path,
    queue: Arc<Queue>,
    sources: Sources,
    seam: Option<SourceId>,
    context: Arc<Context>,
    sinks: &mut Sinks,
) -> std::io::Result<()> {
    let to_bench = ToBench::default();
    sinks.on(|_: lines::Counted| {});
    sinks.on(|_: load::Wrote| {});
    let heard = to_bench.clone();
    sinks.on(move |sim::Heard(what)| heard.send(&FromCore::Heard { what }));
    let stand_in = match seam {
        Some(source) => {
            let queue = queue.clone();
            let (stand_in, _) = StandIn::start(
                move |up| queue.push(source, up.encode()),
                Box::new(module::BenchModule::new(messages::SLOTS_HASH)),
            )?;
            let calls = stand_in.clone();
            sinks.on(move |call: SimCall| calls.call(call));
            Some(stand_in)
        }
        None => None,
    };
    socket::start(data, queue, sources, stand_in, to_bench, context)
}
