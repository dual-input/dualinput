//! Velopack's side of updates: where the app checks, what a check found, and the download and the swap, which its Update.exe
//! does once the app exits (record/areas/install/01-installing-and-updating.md, "The installer and the updater"). Each call
//! here blocks on the network or the disk, so the jobs run them on threads of their own.

use std::sync::mpsc;

use velopack::sources::{AutoSource, GithubSource, UpdateSource};
use velopack::{UpdateCheck, UpdateInfo, UpdateManager, VelopackAsset};

/// The development setting that names a folder or an address to take releases from, in place of our GitHub repository's,
/// such as a folder `vpk pack` wrote. The bench and a developer's test of an update use it.
pub const FEED_SETTING: &str = "desktop.update-feed";
/// Our repository, whose newest 10 releases `GithubSource` reads, so a pilot up to 10 releases behind gets deltas (read in
/// velopack 1.2.161, unverified by a run; record/areas/install/01-installing-and-updating.md, "The installer and the
/// updater").
const REPOSITORY: &str = "https://github.com/dual-input/dualinput";

/// A release newer than the running one.
pub struct Found {
    pub info: Box<UpdateInfo>,
}

impl Found {
    pub fn version(&self) -> String {
        self.info.TargetFullRelease.Version.clone()
    }

    /// What the download takes: its deltas when Velopack has a base to apply them to, or the whole release. A delta that
    /// fails falls back to the whole release, which this doesn't see, so then the count is under what came.
    pub fn bytes(&self) -> u64 {
        if self.info.BaseRelease.is_some() && !self.info.DeltasToTarget.is_empty() {
            self.info
                .DeltasToTarget
                .iter()
                .map(|delta| delta.Size)
                .sum()
        } else {
            self.info.TargetFullRelease.Size
        }
    }
}

#[derive(Clone)]
pub struct Updates {
    manager: UpdateManager,
}

impl Updates {
    /// The app's updates, if Velopack installed it: a development build, run from Cargo's folder, has none. A feed the
    /// development setting names takes the place of our repository.
    pub fn new(feed: Option<String>) -> Result<Self, String> {
        let source: Box<dyn UpdateSource> = match feed {
            Some(feed) => Box::new(AutoSource::new(&feed)),
            None => Box::new(GithubSource::new(REPOSITORY, None, false)),
        };
        UpdateManager::new_boxed(source, None, None)
            .map(|manager| Self { manager })
            .map_err(|error| error.to_string())
    }

    /// A release downloaded earlier and not yet applied.
    pub fn pending(&self) -> Option<VelopackAsset> {
        self.manager.get_update_pending_restart()
    }

    pub fn check(&self) -> Result<Option<Found>, String> {
        match self.manager.check_for_updates() {
            Ok(UpdateCheck::UpdateAvailable(info)) => Ok(Some(Found { info })),
            Ok(UpdateCheck::NoUpdateAvailable | UpdateCheck::RemoteIsEmpty) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    /// Downloads `found`, telling `progress` each percent Velopack reports, and gives the release to apply.
    pub fn download(
        &self,
        found: &Found,
        progress: impl Fn(u8) + Send + 'static,
    ) -> Result<VelopackAsset, String> {
        let (tell, told) = mpsc::channel::<i16>();
        let forward = std::thread::spawn(move || {
            for percent in told {
                progress(percent.clamp(0, 100) as u8);
            }
        });
        let downloaded = self.manager.download_updates(&found.info, Some(tell));
        let _ = forward.join();
        downloaded
            .map(|()| found.info.TargetFullRelease.clone())
            .map_err(|error| error.to_string())
    }

    /// Starts Update.exe, which waits for this program to exit, swaps `current\`, and starts the new app with `restart`'s
    /// arguments. The caller then exits. Its window shows the swap's progress, so a pilot sees why our programs stopped.
    pub fn apply(&self, release: &VelopackAsset, restart: &[String]) -> Result<(), String> {
        self.manager
            .wait_exit_then_apply_updates(release, false, true, restart)
            .map_err(|error| error.to_string())
    }
}
