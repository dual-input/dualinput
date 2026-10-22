//! The core, Dual Input's main program, and its edge. The kernel runs the core's units on
//! one thread, the loop, and the edge is everything around it: the threads that wait, the
//! one queue they push inputs into, each output's sink, the recording's writer, replay,
//! the log, and the panic hook (record/areas/core/01-loop-and-edge.md).
//!
//! `main.rs` lists the units. Tests build cores of their own units through `run` and
//! `replay`.

// The core's math has to be its own program's, so a replay computes what the run did. Any
// RUSTFLAGS, even an empty one, replaces the `+crt-static` that .cargo/config.toml sets,
// without a warning, and the core would then take its math from the pilot's Windows
// (record/areas/build/01-the-build.md, "The C runtime"). rustdoc never gets those flags,
// and builds no program, so the guard leaves it be.
#[cfg(all(
    target_env = "msvc",
    not(target_feature = "crt-static"),
    not(any(doc, doctest))
))]
compile_error!(
    "dualinput-core must link the C runtime statically: RUSTFLAGS replaced the +crt-static of .cargo/config.toml"
);

#[cfg(feature = "stand-in")]
mod bench;
mod clock;
mod cpu;
mod data_folder;
mod edges;
mod home;
mod log;
mod loop_stats;
mod panic;
mod queue;
mod recording;
mod run;
mod run_context;
mod sinks;

use std::path::PathBuf;
use std::process::ExitCode;

use kernel::Registry;
use tracing::level_filters::LevelFilter;

pub use data_folder::default_folder;
pub use recording::replay::{Outcome, Replay, replay};
pub use run::{Options, Ran, run};

const USAGE: &str = "usage: dualinput-core [--data <folder>]
       dualinput-core replay <recording> [--log <level>]

--data names the data folder, which is %APPDATA%\\DualInput\\ unless a development core
needs one of its own. A replay's level is error, warn, info, debug, or trace; info unless
given.";

/// The program: a live run, or with `replay`, a replay of a recording.
pub fn main(units: &[fn(&mut Registry)]) -> ExitCode {
    // A bench build registers the test units after the build's own, in its runs and its
    // replays alike, so a replay has the units its recording ran with.
    #[cfg(feature = "stand-in")]
    let units = &[units, bench::UNITS].concat();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args[..] {
        [] => live(default_folder(), units),
        ["--data", folder] => live(PathBuf::from(folder), units),
        ["replay", file] => replay_file(file, LevelFilter::INFO, units),
        ["replay", file, "--log", level] => match level.parse() {
            Ok(level) => replay_file(file, level, units),
            Err(_) => usage(),
        },
        _ => usage(),
    }
}

fn live(data: PathBuf, units: &[fn(&mut Registry)]) -> ExitCode {
    let options = Options {
        data,
        level: LevelFilter::INFO,
        checkpoint_every_input: false,
        abort_on_panic: true,
    };
    match run(&options, units) {
        // An exit the core meant, which tells the desktop app not to start it again.
        Ok(Ran::Exited { .. }) => ExitCode::SUCCESS,
        Ok(Ran::AlreadyRunning) => {
            eprintln!(
                "another core holds the data folder {}",
                options.data.display()
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("the core couldn't run: {error}");
            ExitCode::FAILURE
        }
    }
}

/// Replays a recording, and prints what came of it. tools/bench/cores.ts reads what this
/// prints when the replay matched, so change both together.
fn replay_file(file: &str, level: LevelFilter, units: &[fn(&mut Registry)]) -> ExitCode {
    match replay(PathBuf::from(file).as_path(), units, level, true) {
        Ok(Replay { warnings, outcome }) => {
            for warning in warnings {
                eprintln!("warning: {warning}");
            }
            match outcome {
                Outcome::Matched {
                    inputs,
                    checkpoints,
                    truncated,
                } => {
                    let inputs = count(inputs, "input");
                    let matched = match checkpoints {
                        0 => "it held no checkpoint to compare".to_string(),
                        1 => "its 1 checkpoint matched".to_string(),
                        n => format!("all {n} checkpoints matched"),
                    };
                    let cut = if truncated {
                        ", up to the last whole frame of a cut recording"
                    } else {
                        ""
                    };
                    println!("replayed {inputs}, and {matched}{cut}");
                    ExitCode::SUCCESS
                }
                Outcome::Parted {
                    checkpoint,
                    since,
                    second,
                } => {
                    let last = checkpoint.saturating_sub(1);
                    let inputs = if since >= last {
                        format!("input {last}")
                    } else {
                        format!("one of inputs {since} to {last}")
                    };
                    println!(
                        "the replay parted from the run at the checkpoint before input {checkpoint}, in the run's second {second}: {inputs} led a unit to put out something else"
                    );
                    ExitCode::from(1)
                }
                Outcome::Refused(reason) => {
                    eprintln!("the replay didn't run: {reason}");
                    ExitCode::from(2)
                }
            }
        }
        Err(error) => {
            eprintln!("the replay couldn't read {file}: {error}");
            ExitCode::from(2)
        }
    }
}

/// `n` of `what`, as "1 input" or "2 inputs".
fn count(n: u64, what: &str) -> String {
    if n == 1 {
        format!("1 {what}")
    } else {
        format!("{n} {what}s")
    }
}

fn usage() -> ExitCode {
    eprintln!("{USAGE}");
    ExitCode::from(2)
}
