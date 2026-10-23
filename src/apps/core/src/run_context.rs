//! What each of the core's threads knows of the run it belongs to: the run's log, its
//! recording's writer, and on the loop, the input being handled. The log's subscriber and
//! the panic hook are each one for the whole process, and read these to reach their run.

use std::cell::RefCell;
use std::path::Path;
use std::rc::Rc;
use std::sync::{Arc, OnceLock};

use kernel::Input;
use tracing::level_filters::LevelFilter;

use crate::log::{self, Log};
use crate::panic;
use crate::recording::writer;

pub struct Context {
    pub log: Log,
    /// Set once the units have registered, which the header needs. A replay has none.
    pub writer: OnceLock<writer::Handle>,
    /// Whether a panic ends the process once the hook has run, even in a build whose
    /// profile unwinds, so a development core crashes as a release does. A test that runs
    /// a core in its own process turns it off.
    pub abort_on_panic: bool,
}

thread_local! {
    static CONTEXT: RefCell<Option<Arc<Context>>> = const { RefCell::new(None) };
    static HANDLING: RefCell<Option<Rc<Input>>> = const { RefCell::new(None) };
}

/// Makes this thread one of the run's. Each thread the core starts calls it first.
pub fn enter(context: Arc<Context>) {
    CONTEXT.with(|c| *c.borrow_mut() = Some(context));
}

/// Opens a run's log at `path`, installs the process's subscriber and panic hook if they
/// aren't yet, and makes the calling thread one of the run's until the `Scope` is dropped.
pub fn open(
    path: &Path,
    cap: Option<u64>,
    level: LevelFilter,
    abort_on_panic: bool,
) -> std::io::Result<(Arc<Context>, Scope)> {
    let context = Arc::new(Context {
        log: Log::open(path, cap, level)?,
        writer: OnceLock::new(),
        abort_on_panic,
    });
    log::install();
    panic::install();
    let scope = Scope::enter(context.clone());
    Ok((context, scope))
}

/// Makes the calling thread one of the run's until this is dropped, for the thread that
/// calls `run` or `replay`, which outlives the run.
pub struct Scope;

impl Scope {
    pub fn enter(context: Arc<Context>) -> Scope {
        enter(context);
        Scope
    }
}

impl Drop for Scope {
    fn drop(&mut self) {
        let _ = CONTEXT.try_with(|c| c.borrow_mut().take());
    }
}

/// Runs `f` with this thread's run, if it has one.
pub fn with<R>(f: impl FnOnce(&Context) -> R) -> Option<R> {
    let context = CONTEXT.try_with(|c| c.borrow().clone()).ok().flatten()?;
    Some(f(&context))
}

pub fn handling(input: Rc<Input>) {
    HANDLING.with(|h| *h.borrow_mut() = Some(input));
}

pub fn done() {
    HANDLING.with(|h| *h.borrow_mut() = None);
}

/// The input the loop is handling, when this thread is the loop and it's handling one.
pub fn current() -> Option<Rc<Input>> {
    HANDLING.try_with(|h| h.borrow().clone()).ok().flatten()
}
