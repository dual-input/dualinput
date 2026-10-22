//! The test unit that takes the bench's lines: it counts each numbered one, and puts out
//! the core's exit when the bench asks.

use kernel::{Cx, Exit, Input, Registry};
use messages::bench::ToCore;
use serde::Serialize;

/// Names the source the socket's lines come in under.
pub struct Socket;

/// A numbered line reached the loop. It goes into the outputs' hash, so a replay that lost
/// or changed a line parts from the run.
#[derive(Serialize)]
pub struct Counted(pub u32);

#[derive(Default)]
pub struct Lines;

impl Lines {
    pub fn register(r: &mut Registry) {
        r.unit::<Lines>("bench-lines").source::<Socket>(Lines::line);
    }

    /// Each input is a line as the bench sent it, which this parses on the loop, as a unit
    /// parses a WebSocket's text, so a replay parses it the same way.
    fn line(_: &mut Lines, input: &Input, cx: &mut Cx) {
        match serde_json::from_slice(&input.bytes) {
            Ok(ToCore::Count { n }) => {
                // tools/bench/scenarios/killed-core.ts reads this line from a replay's log,
                // so change both together.
                tracing::debug!(n, "a line from the bench reached the loop");
                cx.out(Counted(n));
            }
            Ok(ToCore::Exit) => cx.out(Exit),
            // The socket hands a load to the playback, an act to the stand-in, a call of the
            // sim to the sim's test unit, and a clients' act to the clients' test unit, not to
            // this unit.
            Ok(
                ToCore::Load { .. }
                | ToCore::StandIn { .. }
                | ToCore::Sim { .. }
                | ToCore::Clients { .. },
            ) => {}
            Err(error) => tracing::warn!(%error, "a line from the bench isn't one of its messages"),
        }
    }
}
