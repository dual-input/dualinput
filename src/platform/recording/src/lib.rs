//! The recording crate keeps the core's runs, each a folder in the data folder's
//! `recordings\` with the run's recording and log, which a pilot sends us by hand when we ask
//! for a bug's. When the core starts, it deletes the oldest runs while all of them together
//! pass 1 GB; it lists the runs for the desktop app; and it takes the commands that mark the
//! moment and delete a run (record/areas/recording/01-recording-and-bug-reports.md, the note
//! of 2026-10-23).
//!
//! The core's edge creates the run's folder before the loop starts, named by its start in
//! UTC, so the newest folder by name is the run in progress. A PC whose clock was set back
//! between two runs would show an older run as in progress, and refuse to delete that one,
//! while Windows refuses to delete the files the core still has open.
//!
//! Register it after the clients crate, whose slice and commands it uses.

use clients::ClientsUnit;
use kernel::{Cx, Entry, Job, JobId, Registry, Started, View};
use messages::recording::{DELETE, DeleteRun, MARK, RecordingSlice, Run, SLICE};
use serde_json::Value;

/// The folder in the data folder that holds the runs.
const RECORDINGS: &str = "recordings";

/// All runs together stay within this, which holds about 17 hours of a busy session's
/// recording at its budget of 60 MB an hour (record/areas/recording/log.md, 2026-10-23).
const KEEP: u64 = 1_000_000_000;

#[derive(Default)]
pub struct Recording {
    /// The runs as last listed, oldest first, the newest being the run in progress.
    runs: Vec<Entry>,
}

/// Registers the crate.
pub fn register(r: &mut Registry) {
    r.unit::<Recording>("recording")
        .on::<Started>(Recording::started)
        .client_state(SLICE, Recording::slice)
        .command(MARK, Recording::mark)
        .command(DELETE, Recording::delete);
}

impl Recording {
    fn started(_: &mut Recording, _: &Started, cx: &mut Cx) {
        cx.job(Job::list(RECORDINGS), Recording::listed_at_start);
    }

    fn listed_at_start(me: &mut Recording, _: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
        let Some(mut runs) = listing(result) else {
            return;
        };
        let old = oldest_past(&runs, KEEP);
        for run in runs.drain(..old) {
            tracing::info!(
                run = run.name,
                mb = run.size / 1_000_000,
                "a run was deleted, since all runs together passed 1 GB"
            );
            cx.job(Job::delete(path(&run.name)), Recording::deleted);
        }
        me.runs = runs;
    }

    /// A deleted run leaves the slice as soon as it's asked for, and a run that couldn't be
    /// deleted comes back with the next listing.
    fn deleted(_: &mut Recording, _: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
        if let Err(error) = result {
            tracing::warn!(%error, "a run couldn't be deleted");
        }
        cx.job(Job::list(RECORDINGS), Recording::listed);
    }

    fn listed(me: &mut Recording, _: JobId, result: Result<Vec<u8>, String>, _: &mut Cx) {
        if let Some(runs) = listing(result) {
            me.runs = runs;
        }
    }

    fn slice(me: &Recording, _: &View) -> RecordingSlice {
        let newest = me.runs.len().saturating_sub(1);
        RecordingSlice {
            runs: me
                .runs
                .iter()
                .enumerate()
                .map(|(i, run)| Run {
                    name: run.name.clone(),
                    size: run.size,
                    in_progress: i == newest,
                })
                .collect(),
        }
    }

    /// The EFB app's button: the moment goes in the run's log, and the recording already
    /// holds this command as an input at that moment.
    fn mark(_: &mut Recording, _: Value, _: &mut Cx) -> Result<(), String> {
        tracing::info!("the pilot marked the moment");
        Ok(())
    }

    fn delete(me: &mut Recording, args: DeleteRun, cx: &mut Cx) -> Result<(), String> {
        // Only a name from the core's own listing reaches a path, so a client can't name a
        // file outside `recordings\`.
        let Some(at) = me.runs.iter().position(|run| run.name == args.name) else {
            return Err(format!("there's no run named {}", args.name));
        };
        if at + 1 == me.runs.len() {
            return Err("the run in progress can't be deleted".into());
        }
        let run = me.runs.remove(at);
        tracing::info!(run = run.name, "the pilot deleted a run");
        cx.job(Job::delete(path(&run.name)), Recording::deleted);
        Ok(())
    }
}

/// The runs a listing found, oldest first, or `None` after logging why it failed.
fn listing(result: Result<Vec<u8>, String>) -> Option<Vec<Entry>> {
    match result.map(|bytes| Entry::decode(&bytes)) {
        Ok(Some(runs)) => Some(runs),
        Ok(None) => {
            tracing::error!("the runs' listing didn't decode");
            None
        }
        Err(error) => {
            tracing::warn!(%error, "the runs couldn't be listed");
            None
        }
    }
}

/// How many of the oldest runs to delete so all of `runs`, oldest first, stay within `keep`
/// bytes, never counting the newest, the run in progress.
fn oldest_past(runs: &[Entry], keep: u64) -> usize {
    let mut total: u64 = runs.iter().map(|run| run.size).sum();
    let mut old = 0;
    while total > keep && old + 1 < runs.len() {
        total -= runs[old].size;
        old += 1;
    }
    old
}

fn path(run: &str) -> String {
    format!("{RECORDINGS}\\{run}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runs(sizes: &[u64]) -> Vec<Entry> {
        sizes
            .iter()
            .enumerate()
            .map(|(i, &size)| Entry {
                name: format!("2026-10-{:02}_12-00-00", i + 1),
                size,
            })
            .collect()
    }

    const MB: u64 = 1_000_000;

    #[test]
    fn deletes_the_oldest_runs_until_all_fit_in_1_gb() {
        assert_eq!(
            oldest_past(&runs(&[400 * MB, 300 * MB, 200 * MB, 300 * MB]), KEEP),
            1
        );
        assert_eq!(
            oldest_past(&runs(&[600 * MB, 300 * MB, 2 * MB, 200 * MB]), KEEP),
            1
        );
        assert_eq!(oldest_past(&runs(&[300 * MB, 300 * MB, 300 * MB]), KEEP), 0);
    }

    #[test]
    fn never_deletes_the_run_in_progress() {
        assert_eq!(oldest_past(&runs(&[700 * MB, 1_500 * MB]), KEEP), 1);
        assert_eq!(oldest_past(&runs(&[1_500 * MB]), KEEP), 0);
        assert_eq!(oldest_past(&[], KEEP), 0);
    }
}
