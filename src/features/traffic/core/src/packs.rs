//! This PC's traffic packs, which every pilot's Traffic tab lists for pilots to compare with
//! the host's by hand: each folder in a packages folder whose name a known pack starts, with
//! its manifest's `package_version` (record/areas/traffic-atc/01-traffic-and-atc.md, "Traffic
//! packs"). It reads folder names and manifests alone, where finding the package of each of the
//! host's titles would read every `aircraft.cfg` and `livery.cfg`: 2,690 files in our
//! development machine's Community folder, 2,551 of them in `fsltl-traffic-base`.

use clients::Clients;
use kernel::{Cx, Job, JobId};
use messages::traffic::Pack;

use crate::Traffic;

/// The known traffic packs, each a folder's name or the start of one. Each pack the build
/// confirms joins the list.
const KNOWN: [&str; 1] = ["fsltl-traffic-base"];

/// A listing under way: the reads of `UserCfg.opt` still out and the packages folders found,
/// then the search for packages, then each pack's manifest.
#[derive(Default)]
pub(crate) struct Listing {
    cfgs: Vec<JobId>,
    folders: Vec<String>,
    find: Option<JobId>,
    manifests: Vec<(JobId, String)>,
    found: Vec<Pack>,
}

/// `LIST_PACKS`: starts a listing, unless one is under way.
pub(crate) fn list(me: &mut Traffic, _: serde_json::Value, cx: &mut Cx) -> Result<(), String> {
    let busy = !me.listing.cfgs.is_empty()
        || me.listing.find.is_some()
        || !me.listing.manifests.is_empty();
    if busy {
        return Ok(());
    }
    let cfgs = sim_service::user_cfgs(cx.read::<Clients>());
    me.listing = Listing {
        cfgs: cfgs
            .into_iter()
            .map(|path| cx.job(Job::read(path), cfg_read))
            .collect(),
        ..Listing::default()
    };
    if me.listing.cfgs.is_empty() {
        me.packs = Some(Vec::new());
    }
    Ok(())
}

fn cfg_read(me: &mut Traffic, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
    let listing = &mut me.listing;
    if !listing.cfgs.contains(&job) {
        return;
    }
    listing.cfgs.retain(|j| *j != job);
    if let Ok(bytes) = result
        && let Some(folder) = sim_service::packages_folder(&String::from_utf8_lossy(&bytes))
    {
        listing.folders.push(folder);
    }
    if !listing.cfgs.is_empty() {
        return;
    }
    // The folders the sim service searches for the aircraft's package, so a pack from the
    // Marketplace lists as one in Community does.
    let roots = listing
        .folders
        .iter()
        .flat_map(|folder| sim_service::package_roots(folder))
        .collect();
    listing.find = Some(cx.job(Job::find(roots, "manifest.json"), found));
}

fn found(me: &mut Traffic, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
    if me.listing.find != Some(job) {
        return;
    }
    me.listing.find = None;
    let paths = result
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or_default();
    let mut packs: Vec<String> = paths
        .lines()
        .filter(|path| {
            let name = path.rsplit('\\').next().unwrap_or(path);
            KNOWN
                .iter()
                .any(|known| name.to_ascii_lowercase().starts_with(known))
        })
        .map(str::to_string)
        .collect();
    packs.sort();
    me.listing.manifests = packs
        .into_iter()
        .map(|path| {
            (
                cx.job(Job::read(format!(r"{path}\manifest.json")), manifest_read),
                path,
            )
        })
        .collect();
    if me.listing.manifests.is_empty() {
        me.packs = Some(Vec::new());
    }
}

fn manifest_read(me: &mut Traffic, job: JobId, result: Result<Vec<u8>, String>, _: &mut Cx) {
    let listing = &mut me.listing;
    let Some(at) = listing.manifests.iter().position(|(j, _)| *j == job) else {
        return;
    };
    let (_, path) = listing.manifests.remove(at);
    let version = result
        .ok()
        .and_then(|bytes| sim_service::package_version(&bytes));
    let name = path.rsplit('\\').next().unwrap_or(&path).to_string();
    listing.found.push(Pack { name, version });
    if listing.manifests.is_empty() {
        let mut found = std::mem::take(&mut listing.found);
        found.sort_by(|a, b| a.name.cmp(&b.name));
        found.dedup_by(|a, b| a.name == b.name);
        tracing::info!(
            packs = found.len(),
            "traffic listed this PC's traffic packs"
        );
        me.packs = Some(found);
    }
}
