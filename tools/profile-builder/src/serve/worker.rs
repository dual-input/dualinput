//! The server's second thread, with TypeScript in a runtime of its own, which checks the scripts
//! once typing pauses and runs each save's build, so a request inside a script, which the main
//! thread's runtime answers, never waits behind either (record/areas/profiles/03-the-extension.md,
//! "TypeScript in two runtimes").

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crossbeam_channel::{Receiver, Sender, unbounded};
use profile_build::{Compiler, STACK, build};
use profile_engine::{Diagnostic, Place, Program, Report, hash, place};

use crate::{Disk, utc, utc_now, write_whole};

pub(crate) enum Job {
    /// TypeScript's check of a program's scripts, for the program whose root is `program`, as
    /// its text stood at `generation`.
    Check {
        program: PathBuf,
        generation: u64,
        scripts: Box<Program>,
    },
    Build {
        id: u64,
        /// The saved file that set the build off.
        trigger: PathBuf,
        profiles: Vec<Target>,
        /// The local folder, or why there's none.
        local: Result<PathBuf, String>,
    },
}

/// A profile to build: its profiles' folder and its path in it, and whether its bundle goes into
/// the local folder even when the folder holds none of it yet, as a profile's own save does.
pub(crate) struct Target {
    pub(crate) root: PathBuf,
    pub(crate) rel: String,
    pub(crate) always: bool,
}

pub(crate) enum Done {
    Checked {
        program: PathBuf,
        generation: u64,
        report: Report,
    },
    Built {
        id: u64,
        trigger: PathBuf,
        built: Vec<Built>,
    },
}

/// One profile's build, and the bundle the local folder holds of it once it's done.
pub(crate) struct Built {
    pub(crate) root: PathBuf,
    pub(crate) rel: String,
    pub(crate) report: Report,
    pub(crate) held: Option<Held>,
}

/// A bundle the local folder holds.
pub(crate) struct Held {
    /// The full hex hash of its bytes.
    pub(crate) hash: String,
    /// When it was written, as an ISO time.
    pub(crate) built_at: Option<String>,
    pub(crate) bundle: PathBuf,
}

/// Starts the thread, which loads its runtime as it starts, and gives the sender of its jobs.
pub(crate) fn start(done: Sender<Done>) -> Sender<Job> {
    let (jobs, inbox) = unbounded();
    std::thread::Builder::new()
        .name("checks and builds".into())
        .stack_size(STACK)
        .spawn(move || work(&inbox, &done))
        .expect("the server's second thread should start");
    jobs
}

fn work(inbox: &Receiver<Job>, done: &Sender<Done>) {
    let mut compiler = Compiler::new();
    for job in inbox {
        let finished = match job {
            Job::Check {
                program,
                generation,
                scripts,
            } => {
                let report = match compiler.check(&scripts) {
                    Ok(found) => place(&scripts, &found),
                    Err(e) => Report {
                        diagnostics: vec![Diagnostic::error(
                            Place::new(&rel_name(&program), 1, 1),
                            "compiler",
                            e,
                        )],
                    },
                };
                Done::Checked {
                    program,
                    generation,
                    report,
                }
            }
            Job::Build {
                id,
                trigger,
                profiles,
                local,
            } => Done::Built {
                id,
                trigger,
                built: profiles
                    .iter()
                    .map(|t| build_one(&mut compiler, t, &local))
                    .collect(),
            },
        };
        if done.send(finished).is_err() {
            return;
        }
    }
}

/// The file's name, which a compiler's failure, rare as it is, is reported at.
fn rel_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Builds one profile from the files on disk, and writes its bundle into the local folder by the
/// four steps of record/areas/profiles/02-units.md's "Writing a bundle there": only a bundle that
/// built, named for the profile's file, through a `.new` file renamed over it.
fn build_one(compiler: &mut Compiler, target: &Target, local: &Result<PathBuf, String>) -> Built {
    let built = build(&Disk(target.root.clone()), &target.rel, compiler);
    let mut report = built.report;
    let name = target.rel.rsplit('/').next().unwrap_or(&target.rel);
    let file = local.as_ref().ok().map(|l| l.join(name));
    let mut wrote = false;
    if let Some(bundle) = &built.bundle {
        let written = match (local, &file) {
            (Ok(folder), Some(file)) if target.always || file.exists() => Some(
                std::fs::create_dir_all(folder)
                    .map_err(|e| format!("couldn't make {}: {e}", folder.display()))
                    .and_then(|()| write_whole(file, bundle)),
            ),
            (Err(why), _) if target.always => Some(Err(why.clone())),
            _ => None,
        };
        match written {
            Some(Ok(())) => wrote = true,
            Some(Err(why)) => report.push(Diagnostic::error(
                Place::new(&target.rel, 1, 1),
                "local-folder",
                format!("The bundle built, but it isn't in the local folder: {why}"),
            )),
            None => {}
        }
    }
    // The server's stdout carries the protocol, so the build's report goes to stderr, which the
    // extension shows in its Output panel.
    eprint!("{report}");
    let errors = report.errors().count();
    let held = match &file {
        Some(file) if wrote => {
            let hash = built.hash.unwrap_or_default();
            eprintln!("{}: built {hash}, into {}", target.rel, file.display());
            Some(Held {
                hash,
                built_at: Some(utc_now()),
                bundle: file.clone(),
            })
        }
        _ => {
            match (&built.bundle, errors) {
                (Some(_), _) => eprintln!(
                    "{}: built, and left out of the local folder, which holds no bundle of it",
                    target.rel
                ),
                (None, 1) => eprintln!("{}: 1 error, so nothing was written", target.rel),
                (None, n) => eprintln!("{}: {n} errors, so nothing was written", target.rel),
            }
            file.as_deref().and_then(held)
        }
    };
    Built {
        root: target.root.clone(),
        rel: target.rel.clone(),
        report,
        held,
    }
}

/// The bundle a local folder's file holds, if it's there.
pub(crate) fn held(file: &Path) -> Option<Held> {
    let bytes = std::fs::read(file).ok()?;
    let built_at = std::fs::metadata(file)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| utc(d.as_secs()));
    Some(Held {
        hash: hash(&bytes),
        built_at,
        bundle: file.to_path_buf(),
    })
}
