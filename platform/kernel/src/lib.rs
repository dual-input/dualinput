//! The kernel runs the core, Dual Input's main program, on one thread, the loop, which
//! takes one input at a time. Nothing on the loop reads a clock, draws an unseeded random
//! number, or does I/O, so the same inputs always give the same outputs, and a recording of
//! a run's inputs replays the run exactly.
//!
//! The core is made of units. A unit is one crate's state and the handlers that change it,
//! registered once through `Registry::unit`: each crate of the platform's has one, and each
//! feature has one. While a handler runs, it holds the only `&mut` to its own unit's state,
//! reads any other unit's through `Cx`, and reaches the world only by putting out outputs,
//! which the core's edge, in `apps/core`, carries out. A timer, a job, and anything else that
//! waits comes back later as an input of its own.
//!
//! record/areas/core/01-loop-and-edge.md, "The kernel's interface", designs what's here.

mod edge;
mod registry;
mod run;

pub use edge::{
    CancelTimer, Exit, FIRST, Handle, Input, JOBS, Job, JobId, SetTimer, SourceId, StartJob,
    TIMERS, Then, TimerId, Work, first_input,
};
pub use registry::{Handler, Registry, Unit, UnitId};
pub use run::{Cx, Kernel, Output, Verdict, View, running_unit};

/// A moment is something a crate of the platform's tells every unit that registered for it,
/// such as a link lost. Its type lives in the crate that raises it, so a unit that handles
/// it depends on that crate, and a feature never raises one: the map check fails a feature
/// that implements this trait (record/areas/architecture/02-code-map.md, "The map check").
pub trait Moment: 'static {}

/// The kernel raises this once the core's first input has handed each unit its start files,
/// and before the next input.
pub struct Started;

impl Moment for Started {}
