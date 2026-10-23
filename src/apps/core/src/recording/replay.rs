//! Replaying a recording on this build, to find the second where it parted from the run
//! (record/areas/core/01-loop-and-edge.md, "Running a replay").

use std::fs::File;
use std::path::Path;
use std::rc::Rc;

use kernel::{Kernel, Registry};
use recording_format::{Header, Reader, Record};
use tracing::level_filters::LevelFilter;

use crate::recording::build_info;
use crate::recording::convert::from_record;
use crate::run::{STACK, build};
use crate::run_context;
use crate::{cpu, data_folder};

pub struct Replay {
    /// What differs between this build or PC and the recording's, which could make the
    /// replay part from the run without a bug.
    pub warnings: Vec<String>,
    pub outcome: Outcome,
}

pub enum Outcome {
    /// Every checkpoint matched. `truncated` says the recording stops partway through a
    /// record or a block, as a killed core's does.
    Matched {
        inputs: u64,
        checkpoints: u64,
        truncated: bool,
    },
    /// The checkpoint before input `checkpoint` differed, so one of the inputs from `since`
    /// to the one before `checkpoint` led a unit to put out something else. `second`
    /// is the second of the run it came in.
    Parted {
        checkpoint: u64,
        since: u64,
        second: u64,
    },
    /// The replay didn't run, for the reason given.
    Refused(String),
}

/// Replays the recording `file` with `units`, which must be the run's: a replay starts none
/// of the edge's threads, and each output is dropped. It takes a folder beside the
/// recording as its data folder, for its lock and its log, so it can run while Dual Input
/// does.
pub fn replay(
    file: &Path,
    units: &[fn(&mut Registry)],
    level: LevelFilter,
    abort_on_panic: bool,
) -> std::io::Result<Replay> {
    let (header, _) = Reader::new(File::open(file)?)?;
    if header.commit != build_info::COMMIT {
        let commit = &header.commit;
        let reason = format!(
            "the recording was made by commit {commit}, and this build is commit {}; check out {commit} and build it to replay the recording",
            build_info::COMMIT
        );
        return Ok(Replay {
            warnings: Vec::new(),
            outcome: Outcome::Refused(reason),
        });
    }
    let warnings = differences(&header);
    cpu::fma3_off();
    // tools/bench/cores.ts reads the replay's log from this folder, so change both together.
    let folder = file.parent().unwrap_or(Path::new(".")).join("replay");
    std::fs::create_dir_all(&folder)?;
    let Some(_lock) = data_folder::lock(&folder) else {
        let reason = "another replay of this recording is running".to_string();
        return Ok(Replay {
            warnings,
            outcome: Outcome::Refused(reason),
        });
    };
    let (context, _scope) =
        run_context::open(&folder.join("log.txt"), None, level, abort_on_panic)?;
    for warning in &warnings {
        tracing::warn!("{warning}");
    }

    let file = file.to_path_buf();
    let units = units.to_vec();
    let looper = std::thread::Builder::new()
        .name("loop".into())
        .stack_size(STACK)
        .spawn(move || {
            run_context::enter(context);
            let mut kernel = build(&units);
            let (_, mut reader) = Reader::new(File::open(&file)?)?;
            records(&mut kernel, &mut reader)
        })?;
    let outcome = match looper.join() {
        Ok(outcome) => outcome?,
        Err(panic) => std::panic::resume_unwind(panic),
    };
    match &outcome {
        Outcome::Matched {
            inputs,
            checkpoints,
            ..
        } => tracing::info!(inputs, checkpoints, "the replay matched every checkpoint"),
        Outcome::Parted {
            checkpoint,
            since,
            second,
        } => tracing::warn!(checkpoint, since, second, "the replay parted from the run"),
        Outcome::Refused(_) => {}
    }
    Ok(Replay { warnings, outcome })
}

fn records(kernel: &mut Kernel, reader: &mut Reader<File>) -> std::io::Result<Outcome> {
    let (mut inputs, mut checkpoints, mut since) = (0, 0, 0);
    let (mut first, mut last) = (None, 0);
    while let Some(record) = reader.next_record()? {
        match record {
            Record::Checkpoint(checkpoint) => {
                if kernel.hash() != checkpoint.hash {
                    // The second is the next input's, or for the checkpoint after the exit,
                    // the last input's.
                    let stamp = match reader.next_record()? {
                        Some(Record::Input(input)) => input.stamp,
                        _ => last,
                    };
                    let second = (stamp - first.unwrap_or(stamp)) / 1_000_000;
                    return Ok(Outcome::Parted {
                        checkpoint: checkpoint.seq,
                        since,
                        second,
                    });
                }
                checkpoints += 1;
                since = checkpoint.seq;
            }
            Record::Input(input) => {
                first.get_or_insert(input.stamp);
                last = input.stamp;
                let input = Rc::new(from_record(input));
                run_context::handling(input.clone());
                kernel.handle(&input);
                run_context::done();
                inputs += 1;
            }
        }
    }
    Ok(Outcome::Matched {
        inputs,
        checkpoints,
        truncated: reader.truncated(),
    })
}

/// What could make the replay part from the run with no bug to find: other uncommitted
/// changes, another compiler or C runtime, which can change the core's math, another MSFS
/// SDK, whose SimConnect headers lay out the sim's messages the core reads, or another CPU.
fn differences(header: &Header) -> Vec<String> {
    let mut warnings = Vec::new();
    if header.uncommitted.as_deref() != build_info::UNCOMMITTED {
        warnings.push(format!(
            "the recording's build had uncommitted changes {}, and this one has {}, so the checkpoints show where the two part",
            header.uncommitted.as_deref().unwrap_or("none"),
            build_info::UNCOMMITTED.unwrap_or("none")
        ));
    }
    for (what, theirs, ours) in [
        ("rustc", &header.rustc, build_info::RUSTC),
        ("the MSVC tools", &header.msvc, build_info::MSVC),
        (
            "the Windows SDK",
            &header.windows_sdk,
            build_info::WINDOWS_SDK,
        ),
        (
            "the MSFS SDK",
            &header.simconnect_sdk,
            simconnect_types::SDK_VERSION,
        ),
    ] {
        if theirs != ours {
            warnings.push(format!(
                "the recording's build used {what} {theirs}, and this one {ours}"
            ));
        }
    }
    let (cpu, fma3) = cpu::cpu();
    if header.cpu != cpu || header.fma3 != fma3 {
        warnings.push(format!(
            "the recording was made on {} (FMA3: {}), and this PC is {cpu} (FMA3: {fma3}); whether two CPUs give the same math with FMA3 off is unverified",
            header.cpu, header.fma3
        ));
    }
    warnings
}
