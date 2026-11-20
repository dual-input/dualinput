//! What the core does at a panic. A panic is a bug, and the core doesn't try to carry on
//! past one: it ends, the desktop app starts it again, and the pilot comes back as a late
//! joiner (record/areas/core/01-loop-and-edge.md, "A panic"). Before it ends, the hook
//! leaves what we need to find the bug.

use std::panic::PanicHookInfo;
use std::sync::Once;
use std::time::Duration;

use crate::clock;
use crate::run_context;

/// How long the hook waits for the log's writer to write the panic's line, and then for the
/// recording's writer to put the recording's last frame on disk.
const FLUSH: Duration = Duration::from_millis(500);

/// Installs the one panic hook of the process, ahead of the one already there, which still
/// prints the panic. A panic on a thread that belongs to no run, such as a test's own, goes
/// to that hook alone.
pub fn install() {
    static INSTALLED: Once = Once::new();
    INSTALLED.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let abort = run_context::with(|_| record(info)).unwrap_or(false);
            previous(info);
            if abort {
                std::process::abort();
            }
        }));
    });
}

/// Logs the panic with the input being handled and the unit that was running, and waits for
/// the log's writer to write it and for the recording's writer to put everything it was sent
/// on disk, that input included, since the loop records each input before handling it.
/// Returns whether the process should abort.
fn record(info: &PanicHookInfo) -> bool {
    let unit = kernel::running_unit().unwrap_or("none");
    let at = run_context::current().map_or("no input".to_string(), |input| {
        format!("input {}", input.seq)
    });
    run_context::with(|c| {
        // `replayPanic` in tools/bench/cores.ts and tools/bench/scenarios/desktop-app.ts find a
        // crashed run by "panic at input <n>" in its log, so change all three together.
        c.log.always(&format!(
            "{}µs ERROR panic at {at}, in unit {unit}: {info}\n",
            clock::now()
        ));
        c.log.flush(FLUSH);
        if let Some(writer) = c.writer.get() {
            writer.flush(FLUSH);
        }
        c.abort_on_panic
    })
    .unwrap_or(false)
}
