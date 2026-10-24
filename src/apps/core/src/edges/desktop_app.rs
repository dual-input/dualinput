//! The desktop app's start, for the EFB app's button that brings it forward: the edge starts
//! the desktop app's program from the core's own folder, and the program's one running copy
//! for the core's data folder opens its window (record/areas/interface/01-apps.md, "Bringing
//! the desktop app forward").

use std::ffi::OsString;
use std::path::Path;
use std::process::{Command, Stdio};

use clients::StartDesktopApp;

use crate::sinks::Sinks;

/// The desktop app's program, beside the core's own in a release's folder
/// (record/areas/build/01-the-build.md, "What a release holds"). tools/bench.ts copies the
/// bench's stand-in beside the bench's core under this name, so change both together.
const PROGRAM: &str = "dualinput-desktop.exe";

pub fn start(runtime: &tokio::runtime::Handle, data: &Path, sinks: &mut Sinks) {
    let runtime = runtime.clone();
    let args = arguments(data, &crate::default_folder());
    let program = super::beside_core(PROGRAM);
    sinks.on(move |StartDesktopApp| {
        let program = program.clone();
        let args = args.clone();
        // Sinks run on the loop's thread, and starting a process can take a while.
        runtime.spawn_blocking(move || {
            // A desktop app that outlives the core would otherwise keep the core's standard
            // handles as its own, such as the bench's file of the core's output, so it gets
            // NUL, since it writes nothing to them.
            let started = Command::new(&program)
                .args(&args)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
            match started {
                Ok(child) => tracing::info!(
                    program = %program.display(),
                    process = child.id(),
                    "the core started the desktop app's program"
                ),
                Err(error) => tracing::error!(
                    program = %program.display(),
                    %error,
                    "the desktop app's program didn't start, so no window of it opens"
                ),
            }
        });
    });
}

/// The program's arguments. A development core on a data folder of its own passes the folder
/// on, so that folder's desktop app opens rather than the pilot's, and a pilot's core passes
/// nothing, as the Start menu does (user, 2026-10-24).
fn arguments(data: &Path, default: &Path) -> Vec<OsString> {
    if data == default {
        Vec::new()
    } else {
        vec!["--data".into(), data.into()]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_core_on_a_data_folder_of_its_own_passes_it_on() {
        let default = Path::new(r"C:\Users\Pilot\AppData\Roaming\DualInput");
        assert!(arguments(default, default).is_empty());
        let own = Path::new(r"D:\dev\bench\a");
        assert_eq!(
            arguments(own, default),
            [OsString::from("--data"), OsString::from(own)]
        );
    }
}
