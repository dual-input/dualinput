//! The local folder: bundles the profile builder, the profile extension, or the IDE wrote, which
//! a session takes over a published one for the aircraft they cover. The loader lists it at
//! start, at each session's start, and each second while a session is held, and reads a file
//! again only when its name is new or its size or last-modified time changed, at this core's
//! level, skipping, and logging, one that fails, so it never takes a bundle this core can't read
//! (record/areas/profiles/02-units.md, "The local folder").
//!
//! A bundle whose hash changed while a session is held is fresh, and the loader sends it to the
//! crew (record/areas/profiles/02-units.md, "Test sessions"). A file whose bytes hash as before is
//! no change, so a program that only touches a file, such as a virus scanner, sends nothing.

use std::collections::BTreeMap;
use std::time::Duration;

use clients::Clients;
use kernel::{Cx, Entry, Job, JobId, TimerId};
use messages::profiles::Pin;
use messages::unhex;
use profile_engine::Maturity;
use session::Session;

use crate::{LOCAL, Profiles};

/// The local folder when the development setting names none, in the core's data folder, where
/// the profile extension writes (record/areas/profiles/02-units.md, "Writing a bundle there").
/// `Settings::local` in tools/profile-builder/src/serve.rs names the same folder, as the
/// extension's language server writes into it, so change both together.
const FOLDER: &str = "profiles\\local";

/// How often the loader lists the folder while a session is held, so an author's save reaches
/// the crew within about this long.
const POLL: Duration = Duration::from_secs(1);

#[derive(Default)]
pub(crate) struct Local {
    /// The folder's bundles as last listed, by file name.
    found: Vec<Bundle>,
    folder: String,
    listing: Option<JobId>,
    /// Each file being read, by its job.
    reads: BTreeMap<JobId, Listed>,
    /// Each file as the listings found it, and what its read gave, so a listing reads again only
    /// a file that changed.
    seen: BTreeMap<String, Seen>,
    /// Whether a bundle that changes counts as fresh, which holds from the end of the first
    /// listing in a session, so the bundles already in the folder at a session's start go to
    /// nobody.
    watching: bool,
    /// The bundles that changed while a session was held, oldest first, until the loader takes
    /// them.
    fresh: Vec<Bundle>,
    poll: Option<TimerId>,
}

/// A file as a listing gives it.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Listed {
    name: String,
    size: u64,
    modified: u64,
}

/// A file as last listed, and its bundle, or `None` for one that doesn't read at this level.
struct Seen {
    listed: Listed,
    bundle: Option<Bundle>,
    /// The hash of the file's last read that gave a bundle, kept through a read that didn't, as of
    /// a file read half-written, so the next good read of the same bytes is no change.
    good: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct Bundle {
    pub(crate) file: String,
    pub(crate) hash: String,
    covers: Vec<String>,
    maturity: Maturity,
}

impl Bundle {
    pub(crate) fn covers(&self, aircraft: &str) -> bool {
        profile_engine::covers(&self.covers, aircraft)
    }
}

impl Local {
    /// Whether a listing is still being read, so a choice waits for it.
    pub(crate) fn busy(&self) -> bool {
        self.listing.is_some() || !self.reads.is_empty()
    }

    /// The first local bundle, by file name, that covers the aircraft, as this pilot's own.
    pub(crate) fn covering(
        &self,
        aircraft: &str,
        me: Option<messages::net::PilotId>,
    ) -> Option<Pin> {
        let b = self.found.iter().find(|b| b.covers(aircraft))?;
        Some(Pin {
            hash: unhex(&b.hash)?,
            local: true,
            from: me,
        })
    }

    /// The maturity of the first local bundle, by file name, that covers the aircraft.
    pub(crate) fn maturity_of(&self, aircraft: &str) -> Option<Maturity> {
        self.found
            .iter()
            .find(|b| b.covers(aircraft))
            .map(|b| b.maturity)
    }

    /// The file that holds a local bundle, by its hash.
    pub(crate) fn file(&self, hash: &str) -> Option<String> {
        self.found
            .iter()
            .find(|b| b.hash == hash)
            .map(|b| self.path(&b.file))
    }

    pub(crate) fn path(&self, file: &str) -> String {
        format!("{}\\{file}", self.folder)
    }

    /// The bundles that changed while a session was held, oldest first, which only one caller
    /// takes.
    pub(crate) fn take_fresh(&mut self) -> Vec<Bundle> {
        std::mem::take(&mut self.fresh)
    }
}

/// Lists the folder again from the start, dropping a listing still being read. At a session's
/// start, `baseline` says what the folder holds counts as no change.
pub(crate) fn refresh(me: &mut Profiles, baseline: bool, cx: &mut Cx) {
    let l = &mut me.local;
    if let Some(job) = l.listing.take() {
        cx.cancel_job(job);
    }
    for (job, _) in std::mem::take(&mut l.reads) {
        cx.cancel_job(job);
    }
    if baseline {
        l.watching = false;
        l.fresh.clear();
    }
    let folder = cx
        .read::<Clients>()
        .setting_as::<String>(LOCAL)
        .filter(|folder| !folder.is_empty())
        .unwrap_or_else(|| FOLDER.into())
        .trim_end_matches(['\\', '/'])
        .to_string();
    if folder != l.folder {
        l.folder = folder;
        l.seen.clear();
        l.found.clear();
    }
    list(me, cx);
}

fn list(me: &mut Profiles, cx: &mut Cx) {
    let l = &mut me.local;
    l.listing = Some(cx.job(Job::list(l.folder.clone()), listed));
}

/// Lists the folder each second while a session is held, unless a listing is still being read.
pub(crate) fn start_polling(me: &mut Profiles, cx: &mut Cx) {
    if me.local.poll.is_none() {
        me.local.poll = Some(cx.timer(POLL, polled));
    }
}

fn polled(me: &mut Profiles, timer: TimerId, cx: &mut Cx) {
    if me.local.poll != Some(timer) {
        return;
    }
    me.local.poll = None;
    if !cx.read::<Session>().held() {
        return;
    }
    if !me.local.busy() {
        list(me, cx);
    }
    start_polling(me, cx);
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
    let listed: Vec<Listed> = entries
        .into_iter()
        .filter(|e| e.name.ends_with(".yaml"))
        .map(|e| Listed {
            name: e.name,
            size: e.size,
            modified: e.modified,
        })
        .collect();
    let l = &mut me.local;
    l.seen
        .retain(|name, _| listed.iter().any(|f| f.name == *name));
    for file in listed {
        if l.seen.get(&file.name).is_some_and(|s| s.listed == file) {
            continue;
        }
        let path = l.path(&file.name);
        let job = cx.job(Job::read(path).then(summarized), read);
        l.reads.insert(job, file);
    }
    finish(me, cx);
}

/// Runs at the edge on a local file: its hash, the folders and presets it covers, and its
/// maturity, or why it doesn't read at this core's level.
fn summarized(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let profile = profile_engine::read(&bytes, profile_engine::LEVEL).map_err(|r| r.to_string())?;
    let maturity = profile.maturity;
    let covers: Vec<String> = profile
        .aircraft
        .variants
        .into_iter()
        .flat_map(|v| v.paths)
        .collect();
    postcard::to_stdvec(&(profile_engine::hash(&bytes), covers, maturity))
        .map_err(|e| e.to_string())
}

fn read(me: &mut Profiles, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
    let Some(listed) = me.local.reads.remove(&job) else {
        return;
    };
    let summary = result.and_then(|bytes| {
        postcard::from_bytes::<(String, Vec<String>, Maturity)>(&bytes).map_err(|e| e.to_string())
    });
    let bundle = match summary {
        Ok((hash, covers, maturity)) => Some(Bundle {
            file: listed.name.clone(),
            hash,
            covers,
            maturity,
        }),
        Err(why) => {
            tracing::warn!(
                file = listed.name,
                why,
                "a file in the local folder isn't a bundle this core reads, so it's skipped"
            );
            None
        }
    };
    let l = &mut me.local;
    let before = l.seen.get(&listed.name).and_then(|s| s.good.clone());
    if let Some(b) = &bundle
        && l.watching
        && before.as_ref() != Some(&b.hash)
    {
        tracing::info!(
            file = b.file,
            hash = b.hash,
            "a bundle in the local folder changed during the session"
        );
        l.fresh.push(b.clone());
    }
    let good = bundle.as_ref().map(|b| b.hash.clone()).or(before);
    l.seen.insert(
        listed.name.clone(),
        Seen {
            listed,
            bundle,
            good,
        },
    );
    finish(me, cx);
}

/// Once every file of a listing is read, its bundles replace the last listing's, and a session
/// held from here on watches for changes.
fn finish(me: &mut Profiles, cx: &mut Cx) {
    if me.local.busy() {
        return;
    }
    let l = &mut me.local;
    let found: Vec<Bundle> = l.seen.values().filter_map(|s| s.bundle.clone()).collect();
    if found.len() != l.found.len() || !l.watching {
        tracing::info!(bundles = found.len(), "the local folder was listed");
    }
    // `seen` is ordered by file name, so `found` is too.
    l.found = found;
    l.watching = cx.read::<Session>().held();
    me.update(cx);
}
