//! The local folder: bundles the profile builder or the IDE wrote, which a session takes over a
//! published one for the aircraft they cover. The loader lists it at start, at each session,
//! and whenever the session's aircraft changes, reading each file at this core's level and
//! skipping, and logging, one that fails, so it never takes a bundle this core can't read
//! (record/areas/profiles/02-units.md, "The local folder").

use std::collections::BTreeMap;

use clients::Clients;
use kernel::{Cx, Entry, Job, JobId};
use messages::profiles::Pin;
use messages::unhex;

use crate::{LOCAL, Profiles};

#[derive(Default)]
pub(crate) struct Local {
    /// The folder's bundles as last listed, by file name.
    found: Vec<Bundle>,
    folder: String,
    listing: Option<JobId>,
    /// Each file being read, by its job.
    reads: BTreeMap<JobId, String>,
    /// The bundles read so far of a listing still being read.
    next: Vec<Bundle>,
}

#[derive(Clone, Debug)]
struct Bundle {
    file: String,
    hash: String,
    covers: Vec<String>,
}

impl Local {
    /// Whether a listing is still being read, so a choice waits for it.
    pub(crate) fn busy(&self) -> bool {
        self.listing.is_some() || !self.reads.is_empty()
    }

    /// The first local bundle, by file name, that covers the aircraft.
    pub(crate) fn covering(&self, aircraft: &str) -> Option<Pin> {
        let b = self
            .found
            .iter()
            .find(|b| profile_engine::covers(&b.covers, aircraft))?;
        Some(Pin {
            hash: unhex(&b.hash)?,
            local: true,
        })
    }

    /// The file that holds a local bundle, by its hash.
    pub(crate) fn file(&self, hash: &str) -> Option<String> {
        self.found
            .iter()
            .find(|b| b.hash == hash)
            .map(|b| format!("{}\\{}", self.folder, b.file))
    }
}

/// Lists the folder again, dropping a listing still being read.
pub(crate) fn refresh(me: &mut Profiles, cx: &mut Cx) {
    let l = &mut me.local;
    if let Some(job) = l.listing.take() {
        cx.cancel_job(job);
    }
    for (job, _) in std::mem::take(&mut l.reads) {
        cx.cancel_job(job);
    }
    l.next.clear();
    l.folder = cx
        .read::<Clients>()
        .setting_as::<String>(LOCAL)
        .unwrap_or_default()
        .trim_end_matches(['\\', '/'])
        .to_string();
    if l.folder.is_empty() {
        l.found.clear();
        return;
    }
    l.listing = Some(cx.job(Job::list(l.folder.clone()), listed));
}

fn listed(me: &mut Profiles, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
    if me.local.listing != Some(job) {
        return;
    }
    me.local.listing = None;
    let entries = match result.map(|b| Entry::decode(&b)) {
        Ok(Some(entries)) => entries,
        Ok(None) | Err(_) => {
            tracing::warn!(folder = me.local.folder, "couldn't list the local folder");
            Vec::new()
        }
    };
    for e in entries.into_iter().filter(|e| e.name.ends_with(".yaml")) {
        let path = format!("{}\\{}", me.local.folder, e.name);
        let job = cx.job(Job::read(path).then(summarized), read);
        me.local.reads.insert(job, e.name);
    }
    finish(me, cx);
}

/// Runs at the edge on a local file: its hash and the folders and presets it covers, or why
/// it doesn't read at this core's level.
fn summarized(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let profile = profile_engine::read(&bytes, profile_engine::LEVEL).map_err(|r| r.to_string())?;
    let covers: Vec<String> = profile
        .aircraft
        .variants
        .into_iter()
        .flat_map(|v| v.paths)
        .collect();
    postcard::to_stdvec(&(profile_engine::hash(&bytes), covers)).map_err(|e| e.to_string())
}

fn read(me: &mut Profiles, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
    let Some(file) = me.local.reads.remove(&job) else {
        return;
    };
    let summary = result.and_then(|bytes| {
        postcard::from_bytes::<(String, Vec<String>)>(&bytes).map_err(|e| e.to_string())
    });
    match summary {
        Ok((hash, covers)) => me.local.next.push(Bundle { file, hash, covers }),
        Err(why) => tracing::warn!(
            file,
            why,
            "a file in the local folder isn't a bundle this core reads, so it's skipped"
        ),
    }
    finish(me, cx);
}

/// Once every file of a listing is read, its bundles replace the last listing's.
fn finish(me: &mut Profiles, cx: &mut Cx) {
    if me.local.busy() {
        return;
    }
    let mut found = std::mem::take(&mut me.local.next);
    found.sort_by(|a, b| a.file.cmp(&b.file));
    tracing::info!(bundles = found.len(), "the local folder was listed");
    me.local.found = found;
    me.update(cx);
}
