//! The sandbox: one QuickJS-ng runtime for a loaded profile's scripts, which the sync engine
//! compiles the profile's write functions in and runs each of them in, under decision 046's
//! limits (record/areas/plugins/01-plugins.md, "The sandbox").
//!
//! A replay of the core runs a recording's inputs through the same build, so a write function
//! has to do there exactly what it did live. So the context leaves out what QuickJS-ng takes
//! from the wall clock, `Date`, `performance`, and `Math.random`, whose seed it is; every call
//! into JS pins the stack's top where it enters, since QuickJS-ng otherwise sets its stack's
//! limit from where the runtime was made; and the time limit counts QuickJS-ng's interrupt
//! checks rather than reading a clock, so a replay stops a runaway call at the same check
//! (record/decisions/047-sandbox-time-limit-counts-interrupt-checks.md).

use std::cell::Cell;
use std::fmt;
use std::rc::Rc;

/// rquickjs, so the code that calls into the sandbox handles the context's values through the
/// version the sandbox runs.
pub use rquickjs;
use rquickjs::context::intrinsic::{Eval, Promise, RegExp};
use rquickjs::{CatchResultExt, CaughtError, Coerced, Context, Ctx, Object, qjs};

/// The most memory the runtime may hold, decision 046's 64 MB, past which QuickJS-ng throws
/// "out of memory", as an error a script can catch (record/decisions/
/// 046-sandbox-runtimes-and-limits.md).
pub const MEMORY: usize = 64 * 1024 * 1024;

/// The stack a call may use below its entry into JS, QuickJS-ng's own default, past which it
/// throws a `RangeError`. Call into the sandbox on a thread with that much room below the
/// call, or Windows ends the program at the thread's own limit first, as the loop's thread,
/// whose size `STACK` in src/apps/core/src/run.rs sets, has.
pub const STACK: usize = 1024 * 1024;

/// The interrupt check at which a call stops. QuickJS-ng checks once every 10,000 of its ticks,
/// each a jump back in a loop, a branch, or a call, so how long a check takes turns on what the
/// script does between ticks. This count stops a write function's own endless loop, which calls
/// a name and `write()` each pass, in about 100ms on our development machine, an empty loop
/// sooner and one that builds an object each pass later, while a healthy write function makes
/// under one check (record/areas/plugins/log.md, 2026-10-24).
pub const CHECKS: u32 = 100;

/// A call that didn't return.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Failed {
    /// The call reached the time limit's interrupt check, and QuickJS-ng stopped it with an
    /// error no `catch` or `finally` in the script sees.
    TimeLimit,
    /// QuickJS-ng ran out of the runtime's memory, and the script didn't catch the error it
    /// threw, or the script threw `null`, which QuickJS-ng throws when the error doesn't fit.
    MemoryLimit,
    /// The script threw, and nothing caught it: the error's name and message, then its stack,
    /// as in `TypeError: not a function`.
    Threw(String),
}

impl fmt::Display for Failed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Failed::TimeLimit => write!(f, "the call reached the sandbox's time limit"),
            Failed::MemoryLimit => {
                write!(f, "the call ran out of the sandbox's {} MB", MEMORY >> 20)
            }
            Failed::Threw(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for Failed {}

/// One QuickJS-ng runtime with its one context, made and called on one thread, the loop's.
pub struct Sandbox {
    context: Context,
    /// The interrupt checks the running call, or the last one, has made.
    checks: Rc<Cell<u32>>,
}

impl Default for Sandbox {
    fn default() -> Sandbox {
        Sandbox::new()
    }
}

impl Sandbox {
    /// A runtime under the limits, with a context of QuickJS-ng's base objects and three of
    /// rquickjs's intrinsics: `Eval`, which compiling a profile's write functions needs,
    /// `RegExp`, and `Promise`. Without `Promise`, an async function or `Array.fromAsync` leaves
    /// an object behind that makes QuickJS-ng abort the process when the runtime is dropped
    /// (record/areas/plugins/log.md, 2026-10-24). The context then loses `Math.random`, which
    /// QuickJS-ng seeds from the wall clock, and `Promise`, `AsyncDisposableStack`, and
    /// `queueMicrotask`, since a write function returns before the loop's next input and nothing
    /// runs a job queued behind it. What's left is exactly what
    /// src/engines/profile-engine/javascript/sandbox.json lists, which level 1 of the profile
    /// format types write functions by: no `Date`, `performance`, `WeakRef`, `Map`, `Set`, or
    /// `Promise`.
    pub fn new() -> Sandbox {
        let runtime = rquickjs::Runtime::new().expect("QuickJS-ng should start a runtime");
        runtime.set_memory_limit(MEMORY);
        runtime.set_max_stack_size(STACK);
        let checks = Rc::new(Cell::new(0_u32));
        let counted = checks.clone();
        runtime.set_interrupt_handler(Some(Box::new(move || {
            counted.set(counted.get().saturating_add(1));
            counted.get() >= CHECKS
        })));
        let context = Context::custom::<(Eval, RegExp, Promise)>(&runtime)
            .expect("QuickJS-ng should make a context");
        let mut sandbox = Sandbox { context, checks };
        sandbox
            .call(|ctx| {
                let globals = ctx.globals();
                globals.get::<_, Object>("Math")?.remove("random")?;
                for name in ["Promise", "AsyncDisposableStack", "queueMicrotask"] {
                    globals.remove(name)?;
                }
                Ok(())
            })
            .expect(
                "the context should let the sandbox delete Math.random and the promise globals",
            );
        sandbox
    }

    /// The one entry into JS: runs `f`, whose every call into the context counts toward one
    /// time limit. It pins the stack's top here, so a recursion stops at the same depth however
    /// deep in the Rust stack the call comes from, live or in a replay. A value that outlives
    /// the call has to leave as a `rquickjs::Persistent`, which has to be dropped before the
    /// sandbox, or rquickjs aborts the process.
    pub fn call<R>(
        &mut self,
        f: impl for<'js> FnOnce(&Ctx<'js>) -> rquickjs::Result<R>,
    ) -> Result<R, Failed> {
        self.checks.set(0);
        let outcome = self.context.with(|ctx| {
            // SAFETY: the pointer is this context's live runtime, which `with` holds.
            unsafe { qjs::JS_UpdateStackTop(qjs::JS_GetRuntime(ctx.as_raw().as_ptr())) };
            f(&ctx).catch(&ctx).map_err(failure)
        });
        // A call past its check stopped there, even if the caller's own code caught the error
        // QuickJS-ng threw.
        if self.checks.get() >= CHECKS {
            return Err(Failed::TimeLimit);
        }
        outcome
    }

    /// The interrupt checks QuickJS-ng made in the last call, which the time limit counts.
    pub fn checks(&self) -> u32 {
        self.checks.get()
    }
}

/// What a caught error says about the call. The sync engine stops an entry whose write
/// function met a limit, and QuickJS-ng says it met the memory limit in three ways: "out of
/// memory", "out of memory in regexp execution" when a regex's stack outgrows it, and `null`
/// when even the error object doesn't fit, as with a runaway of small objects (read in
/// rquickjs-sys 0.14.0, `quickjs/quickjs.c`, `JS_ThrowError2`). So a script's own `throw null`
/// reads as the memory limit too.
fn failure(caught: CaughtError<'_>) -> Failed {
    match caught {
        CaughtError::Exception(e) => {
            let name = e
                .get::<_, Coerced<String>>("name")
                .map(|n| n.0)
                .unwrap_or_default();
            let message = e.message().unwrap_or_default();
            if name == "InternalError" && message.starts_with("out of memory") {
                return Failed::MemoryLimit;
            }
            let mut text = format!("{name}: {message}");
            if let Some(stack) = e.stack().filter(|s| !s.trim().is_empty()) {
                text.push('\n');
                text.push_str(stack.trim_end());
            }
            Failed::Threw(text)
        }
        CaughtError::Value(v) if v.is_null() => Failed::MemoryLimit,
        CaughtError::Value(v) => Failed::Threw(
            v.get::<Coerced<String>>()
                .map(|t| t.0)
                .unwrap_or_else(|_| "a thrown value that doesn't convert to text".into()),
        ),
        CaughtError::Error(e) => Failed::Threw(e.to_string()),
    }
}
