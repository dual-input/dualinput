//! The cache, a folder `profiles\` in the core's data folder: the index, its ETag, and each
//! bundle as `bundles\<hash>.yaml`. Each start fetches the index with the ETag it kept, so a
//! start with nothing new published costs one answer of headers, then each bundle the index
//! gives this core's level that the cache lacks (record/areas/profiles/02-units.md,
//! "Fetching" and "The cache").

use std::collections::{BTreeMap, BTreeSet};

use kernel::{Cx, Entry, Fetch, Fetched, Job, JobId, Method};
use profile_engine::Index;
use session::Session;

use crate::{Profiles, chosen, site};

pub(crate) const INDEX: &str = "profiles/index.json";
pub(crate) const ETAG: &str = "profiles/index.etag";
const BUNDLES: &str = "profiles/bundles";

#[derive(Default)]
pub(crate) struct Cache {
    pub(crate) index: Option<Index>,
    etag: Option<String>,
    /// The bundles the cache holds, by their hashes, once its folder is listed.
    held: Option<BTreeSet<String>>,
    index_job: Option<JobId>,
    /// Each bundle being fetched or written, by its hash.
    fetching: BTreeMap<String, JobId>,
    /// The start's fetches are running, and once they finish the cache deletes each bundle
    /// no level takes.
    starting: bool,
    pub(crate) start_failed: bool,
    /// The bundles whose fetch failed, until this member next enters the flight.
    pub(crate) failed: BTreeSet<String>,
}

impl Cache {
    pub(crate) fn listed(&self) -> bool {
        self.held.is_some()
    }

    pub(crate) fn holds(&self, hash: &str) -> bool {
        self.held.as_ref().is_some_and(|h| h.contains(hash))
    }
}

pub(crate) fn path(hash: &str) -> String {
    format!("{BUNDLES}/{hash}.yaml")
}

pub(crate) fn index_file(me: &mut Profiles, bytes: Option<&[u8]>, _: &mut Cx) {
    me.cache.index = bytes.and_then(Index::parse);
}

pub(crate) fn etag_file(me: &mut Profiles, bytes: Option<&[u8]>, _: &mut Cx) {
    me.cache.etag = bytes.and_then(|b| String::from_utf8(b.to_vec()).ok());
}

/// The start's fetches: the cache's folder listed, if it isn't yet, and the index.
pub(crate) fn start(me: &mut Profiles, cx: &mut Cx) {
    let c = &mut me.cache;
    c.starting = true;
    c.start_failed = false;
    // A bundle whose fetch failed is fetched again with the rest, once the index comes back.
    c.failed.clear();
    if c.held.is_none() {
        cx.job(Job::list(BUNDLES), listed);
    }
    // The ETag goes out only with the index it came with, so a 304 never leaves this core with
    // no index, or another index than the one the site matched.
    let headers = match (&c.etag, &c.index) {
        (Some(etag), Some(_)) => vec![("if-none-match".to_string(), etag.clone())],
        _ => Vec::new(),
    };
    c.index_job = Some(cx.job(
        Job::fetch(Fetch {
            method: Method::Get,
            url: format!("{}/index.json", site(cx)),
            headers,
            body: Vec::new(),
            keep: vec!["etag".into()],
        }),
        index_fetched,
    ));
}

fn listed(me: &mut Profiles, _: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
    let entries = result
        .ok()
        .and_then(|bytes| Entry::decode(&bytes))
        .unwrap_or_default();
    me.cache.held = Some(
        entries
            .iter()
            .filter_map(|e| e.name.strip_suffix(".yaml").map(str::to_string))
            .collect(),
    );
    fetch_missing(me, cx);
    finish_start(me, cx);
    me.update(cx);
}

fn index_fetched(me: &mut Profiles, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
    if me.cache.index_job != Some(job) {
        return;
    }
    me.cache.index_job = None;
    let fetched =
        result.and_then(|b| Fetched::decode(&b).ok_or_else(|| "the answer didn't decode".into()));
    match fetched {
        Ok(f) if f.status == 304 => {
            tracing::info!("the profiles' index is unchanged since this core last fetched it");
        }
        Ok(f) if f.status == 200 => match Index::parse(&f.body) {
            Some(index) => {
                tracing::info!(
                    profiles = index.profiles.len(),
                    "the profiles' index was fetched"
                );
                cx.job(Job::write(INDEX, index.encode()), index_written);
                me.cache.index = Some(index);
                me.cache.etag = f
                    .headers
                    .into_iter()
                    .find(|(n, _)| n == "etag")
                    .map(|(_, v)| v);
            }
            None => {
                tracing::warn!("the profiles' index the site sent doesn't read");
                me.cache.start_failed = true;
            }
        },
        Ok(f) => {
            tracing::info!(
                status = f.status,
                "the profiles' site refused the index, so this core uses its cache"
            );
            me.cache.start_failed = true;
        }
        Err(why) => {
            tracing::info!(
                why,
                "couldn't fetch the profiles' index, so this core uses its cache"
            );
            me.cache.start_failed = true;
        }
    }
    fetch_missing(me, cx);
    finish_start(me, cx);
    me.update(cx);
}

/// The index's ETag is written once the index is, so the file of one never pairs with another
/// index, as a crash between two writes running side by side could leave them.
fn index_written(me: &mut Profiles, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
    if result.is_ok()
        && let Some(etag) = &me.cache.etag
    {
        cx.job(Job::write(ETAG, etag.clone().into_bytes()), written);
    }
    written(me, job, result, cx);
}

fn written(_: &mut Profiles, _: JobId, result: Result<Vec<u8>, String>, _: &mut Cx) {
    if let Err(why) = result {
        tracing::warn!(why, "couldn't write the profiles' cache");
    }
}

/// Fetches each bundle the index gives this core's level that the cache lacks.
fn fetch_missing(me: &mut Profiles, cx: &mut Cx) {
    let (Some(index), Some(_)) = (&me.cache.index, &me.cache.held) else {
        return;
    };
    for hash in chosen(index).into_values() {
        fetch_bundle(me, &hash, cx);
    }
}

/// Fetches a bundle by its hash, unless the cache holds it, it's being fetched, or its fetch
/// failed since this member last entered the flight.
pub(crate) fn fetch_bundle(me: &mut Profiles, hash: &str, cx: &mut Cx) {
    let c = &mut me.cache;
    if c.held.is_none() || c.holds(hash) || c.fetching.contains_key(hash) || c.failed.contains(hash)
    {
        return;
    }
    let job = cx.job(
        Job::fetch(Fetch {
            method: Method::Get,
            url: format!("{}/bundles/{hash}.yaml", site(cx)),
            headers: Vec::new(),
            body: Vec::new(),
            keep: Vec::new(),
        })
        .then(fetched_bundle),
        bundle_fetched,
    );
    me.cache.fetching.insert(hash.to_string(), job);
}

/// Runs at the edge on a fetched bundle: the hash of its bytes, and the bytes, or why the site
/// sent none.
fn fetched_bundle(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let f = Fetched::decode(&bytes).ok_or("the answer didn't decode")?;
    if f.status != 200 {
        return Err(format!("the profiles' site answered {}", f.status));
    }
    postcard::to_stdvec(&(profile_engine::hash(&f.body), f.body)).map_err(|e| e.to_string())
}

fn bundle_fetched(me: &mut Profiles, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
    let Some(hash) = job_hash(me, job) else {
        return;
    };
    let got = result.and_then(|bytes| {
        postcard::from_bytes::<(String, Vec<u8>)>(&bytes).map_err(|e| e.to_string())
    });
    match got {
        Ok((read, body)) if read == hash => {
            let write = cx.job(Job::write(path(&hash), body), bundle_written);
            me.cache.fetching.insert(hash, write);
        }
        Ok((read, _)) => {
            tracing::warn!(hash, read, "a bundle the site sent doesn't match its name");
            fetch_failed(me, hash);
        }
        Err(why) => {
            tracing::info!(hash, why, "couldn't fetch a profile's bundle");
            fetch_failed(me, hash);
        }
    }
    finish_start(me, cx);
    me.update(cx);
}

fn bundle_written(me: &mut Profiles, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
    let Some(hash) = job_hash(me, job) else {
        return;
    };
    match result {
        Ok(_) => {
            if let Some(held) = &mut me.cache.held {
                held.insert(hash);
            }
        }
        Err(why) => {
            tracing::warn!(
                hash,
                why,
                "couldn't write a profile's bundle into the cache"
            );
            fetch_failed(me, hash);
        }
    }
    finish_start(me, cx);
    me.update(cx);
}

fn fetch_failed(me: &mut Profiles, hash: String) {
    if me.cache.starting {
        me.cache.start_failed = true;
    }
    me.cache.failed.insert(hash);
}

/// The hash a job of the cache's was for, which it takes off the running ones.
fn job_hash(me: &mut Profiles, job: JobId) -> Option<String> {
    let hash = me
        .cache
        .fetching
        .iter()
        .find(|(_, j)| **j == job)
        .map(|(h, _)| h.clone())?;
    me.cache.fetching.remove(&hash);
    Some(hash)
}

/// Once the start's fetches finish, a start with no session deletes each cached bundle that
/// isn't the one the index gives this core's level for its profile; a start whose session may
/// pin an older one, or whose fetch failed, deletes nothing.
fn finish_start(me: &mut Profiles, cx: &mut Cx) {
    let c = &mut me.cache;
    if !c.starting || c.index_job.is_some() || !c.fetching.is_empty() || c.held.is_none() {
        return;
    }
    c.starting = false;
    let (Some(index), Some(held)) = (&c.index, &mut c.held) else {
        return;
    };
    if c.start_failed || cx.read::<Session>().held() {
        return;
    }
    let keep: BTreeSet<String> = chosen(index).into_values().collect();
    let old: Vec<String> = held
        .iter()
        .filter(|h| !keep.contains(*h))
        .cloned()
        .collect();
    for hash in old {
        tracing::info!(hash, "a cached bundle no level takes was deleted");
        held.remove(&hash);
        cx.job(Job::delete(path(&hash)), written);
    }
}

/// A cached bundle whose bytes don't match its name: the cache deletes it, then fetches it
/// again, once the delete is done, since the edge runs jobs side by side, and a write could
/// otherwise land before the delete.
pub(crate) fn forget(me: &mut Profiles, hash: &str, cx: &mut Cx) {
    if let Some(held) = &mut me.cache.held {
        held.remove(hash);
    }
    let job = cx.job(Job::delete(path(hash)), deleted);
    me.cache.fetching.insert(hash.to_string(), job);
}

fn deleted(me: &mut Profiles, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
    let Some(hash) = job_hash(me, job) else {
        return;
    };
    if let Err(why) = result {
        tracing::warn!(hash, why, "couldn't delete a cached bundle");
    }
    fetch_bundle(me, &hash, cx);
    me.update(cx);
}
