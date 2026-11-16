//! The jobs a watcher would otherwise run beside the core: noticing the sim, starting the core and starting it again, writing
//! our package, the firewall rule, and updates (record/areas/install/01-installing-and-updating.md). They run on one task, so
//! each decision reads one state, and whatever blocks, a wait on a process, the network, or the disk, runs on a thread of its
//! own and comes back as an event.

mod core;
mod firewall;
mod keeper;
mod package;
mod sim;
mod updates;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use messages::desktop::{DesktopState, Firewall, ToDesktop, Update};
use tauri::{AppHandle, Manager};
use tokio::sync::{mpsc, watch};
use tokio::time::{Interval, MissedTickBehavior};
use velopack::VelopackAsset;

use crate::processes::{self, Held, SimWalk};
use crate::screens::Shared;
use crate::usage::Line;
use crate::{log, places, start_with_windows};
use keeper::Keeper;
use updates::{Found, Updates};

pub use firewall::{FIX_FLAG, fix_and_exit};

/// How often the app walks the processes for the sim while it holds none. `SimWalk`'s walk took 0.8ms of CPU, so a walk
/// every 2s costs about 0.04% of one core (measured on our development machine, 2026-11-16, record/areas/install/log.md).
const WALK_EVERY: Duration = Duration::from_secs(2);
/// How often it checks for an update, beside its start and each time the sim closes.
const CHECK_EVERY: Duration = Duration::from_secs(3 * 60 * 60);
/// The EFB app's note sends a pilot to Windows' startup list to turn Start with Windows back on, and Windows tells a running
/// program nothing of it, so without this the switch stays wrong until the app next starts (measured on Windows 11,
/// 2026-11-02, record/areas/install/log.md).
const READ_WINDOWS_EVERY: Duration = Duration::from_secs(5);
/// How long the sim has to close once asked, before the app stops waiting to start it again. The Steam edition closed 13s
/// after the ask, asking the pilot nothing (measured on MSFS 2024, 2026-11-10, record/areas/install/log.md); the 2 minutes
/// leave room for a sim slower to shut down, or one that asks the pilot first, which no run has shown.
const CLOSE_WAIT: Duration = Duration::from_secs(120);
/// The argument the app starts with after an update that closed the sim, naming the sim's program, which it starts again.
pub const START_SIM_FLAG: &str = "--start-sim";

/// What reaches the jobs.
pub enum Event {
    Asked(ToDesktop),
    /// Quit anyway, in the window.
    Quit,
    SimExited,
    CoreExited(Option<u32>),
    Checked {
        at_once: bool,
        found: Result<Option<Found>, String>,
    },
    Progress(u8),
    /// The release to apply, and the bytes its download took.
    Downloaded(Result<(VelopackAsset, u64), String>),
    FirewallRead(Result<Firewall, String>),
    FirewallFixed,
    PackageWritten {
        sim_started: bool,
    },
}

/// What the app was started for, beside its window.
pub struct Start {
    /// The sim to start again once our package is written, after an update that closed it.
    pub start_sim: Option<PathBuf>,
}

/// A timer that drops what it missed, rather than firing it all at once when the PC wakes from a night's sleep.
pub fn every(period: Duration) -> Interval {
    let mut timer = tokio::time::interval(period);
    timer.set_missed_tick_behavior(MissedTickBehavior::Skip);
    timer
}

struct Sim {
    id: u32,
    program: Option<PathBuf>,
}

/// An install the pilot asked for, which closes the sim first when it runs, and quits the core.
struct Install {
    /// The sim to start again once the new app runs, when the sim ran as they asked.
    sim: Option<PathBuf>,
    closed_at: Option<Instant>,
    quit_sent: bool,
}

struct Jobs {
    app: AppHandle,
    say: watch::Sender<DesktopState>,
    events: mpsc::UnboundedSender<Event>,
    keeper: Keeper,
    sim: Option<Sim>,
    core: Option<u32>,
    updates: Option<Updates>,
    /// A release that's out and not downloaded, while the sim runs.
    found: Option<Found>,
    /// A release downloaded and not applied.
    ready: Option<VelopackAsset>,
    checking: bool,
    downloading: Option<String>,
    install: Option<Install>,
    /// The sim to start again once it has closed and our package is written.
    start_sim: Option<PathBuf>,
    /// When the sim was asked to close so it could start again.
    restart_closed_at: Option<Instant>,
    walk: SimWalk,
    package_due: bool,
    writing_package: bool,
    core_missing_said: bool,
}

/// Starts the jobs on Tauri's runtime, taking what reaches them on heard, whose sender the window and the local port hand
/// their asks to. The window's shared state must be managed first, since the jobs read and write it.
pub fn start(
    app: AppHandle,
    say: watch::Sender<DesktopState>,
    start: Start,
    events: mpsc::UnboundedSender<Event>,
    heard: mpsc::UnboundedReceiver<Event>,
) {
    let feed =
        places::setting(updates::FEED_SETTING).and_then(|value| value.as_str().map(str::to_string));
    let updates = match Updates::new(feed) {
        Ok(updates) => Some(updates),
        Err(error) => {
            log::line(&format!(
                "this app wasn't installed by Velopack, so it neither updates nor writes our package: {error}"
            ));
            None
        }
    };
    let ready = updates.as_ref().and_then(Updates::pending);
    let installed = updates.is_some();
    let jobs = Jobs {
        app,
        say,
        events: events.clone(),
        keeper: Keeper::default(),
        sim: None,
        core: None,
        updates,
        found: None,
        ready,
        checking: false,
        downloading: None,
        install: None,
        start_sim: start.start_sim,
        restart_closed_at: None,
        walk: SimWalk::default(),
        package_due: installed,
        writing_package: false,
        core_missing_said: false,
    };
    tauri::async_runtime::spawn(jobs.run(heard));
}

impl Jobs {
    async fn run(mut self, mut heard: mpsc::UnboundedReceiver<Event>) {
        if let Some(ready) = &self.ready {
            log::line(&format!(
                "version {} was downloaded before, and waits to install",
                ready.Version
            ));
            let next = ready.Version.clone();
            self.update(Update::Ready { next });
        }
        self.read_firewall();
        // The sim is looked for before anything else, so a package isn't written under a sim that already runs.
        self.find_sim();
        let mut walk = every(WALK_EVERY);
        let mut read_windows = every(READ_WINDOWS_EVERY);
        // The first tick is the check at the app's start.
        let mut check = every(CHECK_EVERY);
        loop {
            let again = self.keeper.again_at();
            tokio::select! {
                event = heard.recv() => match event {
                    Some(event) => self.on(event).await,
                    None => return,
                },
                _ = walk.tick() => if self.sim.is_none() {
                    self.find_sim();
                },
                _ = read_windows.tick() => self.read_start_with_windows(),
                _ = check.tick() => self.check(false),
                () = until(again) => {}
            }
            self.tick();
        }
    }

    fn update(&self, update: Update) {
        self.say.send_if_modified(|state| {
            let changed = state.update != update;
            state.update = update;
            changed
        });
    }

    fn read_start_with_windows(&self) {
        let now = start_with_windows::state();
        self.say.send_if_modified(|state| {
            let changed = state.start_with_windows != now;
            state.start_with_windows = now;
            changed
        });
    }

    /// Runs `work` on a thread of its own, and hands what it gives back as an event.
    fn blocking<T: Send + 'static>(
        &self,
        work: impl FnOnce() -> T + Send + 'static,
        then: impl FnOnce(T) -> Event + Send + 'static,
    ) {
        let events = self.events.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _ = events.send(then(work()));
        });
    }

    async fn on(&mut self, event: Event) {
        match event {
            Event::Asked(ask) => self.asked(ask),
            Event::Quit => {
                core::quit().await;
                self.app.exit(0);
            }
            Event::SimExited => {
                log::line("the sim closed");
                self.sim = None;
                self.package_due = self.updates.is_some();
                if self.updates.is_none()
                    && let Some(program) = self.start_sim.take()
                {
                    sim::start(&program);
                }
                // The check a refused join leans on, since the join check tells a pilot who is behind to close the sim.
                self.check(false);
            }
            Event::CoreExited(code) => {
                match code {
                    Some(code) => log::line(&format!("the core exited with {code:#x}")),
                    None => log::line("the core exited, and Windows gave no exit code"),
                }
                self.core = None;
                self.keeper
                    .core_exited(code, Instant::now(), self.sim.is_some());
            }
            Event::Checked { at_once, found } => self.checked(at_once, found),
            Event::Progress(done) => {
                if let Some(next) = self.downloading.clone() {
                    self.update(Update::Downloading { next, done });
                }
            }
            Event::Downloaded(downloaded) => self.downloaded(downloaded),
            Event::FirewallRead(read) => self.firewall_read(read),
            Event::FirewallFixed => self.read_firewall(),
            Event::PackageWritten { sim_started } => {
                self.writing_package = false;
                if sim_started {
                    self.package_due = true;
                } else if self.sim.is_none()
                    && let Some(program) = self.start_sim.take()
                {
                    sim::start(&program);
                }
            }
        }
    }

    fn asked(&mut self, ask: ToDesktop) {
        match ask {
            ToDesktop::SetStartWithWindows { on } => {
                if let Err(error) = start_with_windows::set(on) {
                    log::line(&format!("starting with Windows didn't change: {error}"));
                }
                self.read_start_with_windows();
            }
            ToDesktop::CheckForUpdates => self.check(true),
            ToDesktop::InstallUpdate => self.install_asked(),
            ToDesktop::RestartSim => self.restart_asked(),
            ToDesktop::FixFirewall => self.fix_firewall(),
        }
    }

    /// Checks for a newer release, unless a check or a download is under way or one waits to install. `at_once` downloads
    /// what it finds while the sim runs too, as Check now and Install do.
    fn check(&mut self, at_once: bool) {
        let Some(updates) = self.updates.clone() else {
            if at_once {
                log::line("an update was asked for, and this app wasn't installed by Velopack");
            }
            return;
        };
        if self.ready.is_some() || self.downloading.is_some() {
            return;
        }
        if at_once && let Some(found) = self.found.take() {
            self.download(found);
            return;
        }
        if self.checking {
            return;
        }
        self.checking = true;
        self.update(Update::Checking);
        self.blocking(
            move || updates.check(),
            move |found| Event::Checked { at_once, found },
        );
    }

    fn checked(&mut self, at_once: bool, found: Result<Option<Found>, String>) {
        self.checking = false;
        match found {
            Ok(None) => {
                // A release found before and pulled since would otherwise download at the next Check now.
                self.found = None;
                log::line("no newer release is out");
                self.update(Update::Current {
                    checked: Some(log::checked_at()),
                });
                if self.install.take().is_some() {
                    log::line("the install asked for has nothing to install");
                }
            }
            Ok(Some(found)) => {
                let next = found.version();
                log::line(&format!("version {next} is out"));
                if at_once || self.sim.is_none() || self.install.is_some() {
                    self.download(found);
                } else {
                    // An automatic download waits for the sim to close, so it never takes the pilot's connection mid-flight
                    // (user, 2026-11-03).
                    self.found = Some(found);
                    self.update(Update::Available { next });
                }
            }
            Err(error) => {
                log::line(&format!("the check for updates failed: {error}"));
                self.update(Update::Failed { next: None, error });
                if self.install.take().is_some() {
                    log::line("the install asked for waits for a check that works");
                }
            }
        }
    }

    fn download(&mut self, found: Found) {
        let Some(updates) = self.updates.clone() else {
            return;
        };
        let next = found.version();
        self.found = None;
        self.downloading = Some(next.clone());
        self.update(Update::Downloading { next, done: 0 });
        let events = self.events.clone();
        let bytes = found.bytes();
        self.blocking(
            move || {
                updates
                    .download(&found, move |done| {
                        let _ = events.send(Event::Progress(done));
                    })
                    .map(|release| (release, bytes))
            },
            Event::Downloaded,
        );
    }

    fn downloaded(&mut self, downloaded: Result<(VelopackAsset, u64), String>) {
        let next = self.downloading.take().unwrap_or_default();
        match downloaded {
            Ok((release, bytes)) => {
                log::line(&format!(
                    "version {} is downloaded, and waits to install",
                    release.Version
                ));
                let shared = self.app.state::<Shared>();
                if let Ok(mut sampler) = shared.sampler.lock() {
                    sampler.downloaded(bytes);
                }
                if let Some(history) = &shared.history {
                    history.add(Line::UpdateDownloaded {
                        at: crate::usage::now(),
                    });
                }
                self.update(Update::Ready {
                    next: release.Version.clone(),
                });
                self.ready = Some(release);
            }
            Err(error) => {
                log::line(&format!("the download of {next} failed: {error}"));
                self.update(Update::Failed {
                    next: Some(next),
                    error,
                });
                if self.install.take().is_some() {
                    log::line("the install asked for waits for a download that works");
                }
            }
        }
    }

    /// Install now in the window, or Install and restart in the EFB app: it downloads at once what it hasn't, closes the
    /// sim if it runs, so the new app starts it again, and quits the core.
    fn install_asked(&mut self) {
        if places::session_held() {
            log::line("an install was asked for while a session is held, which holds the update");
            return;
        }
        if self.updates.is_none() {
            log::line("an install was asked for, and this app wasn't installed by Velopack");
            return;
        }
        self.install = Some(Install {
            sim: self.sim.as_ref().and_then(|sim| sim.program.clone()),
            closed_at: None,
            quit_sent: false,
        });
        if self.ready.is_none() {
            self.check(true);
        }
    }

    /// The EFB app's Restart the sim, which loads the package this version wrote.
    fn restart_asked(&mut self) {
        if self.ready.is_some() {
            self.install_asked();
            return;
        }
        let Some(sim) = &self.sim else {
            return;
        };
        let Some(program) = sim.program.clone() else {
            log::line("the sim's program couldn't be read, so it can't be started again");
            return;
        };
        if sim::close(sim.id) {
            log::line("asked the sim to close, to start it again");
            self.start_sim = Some(program);
            self.restart_closed_at = Some(Instant::now());
        } else {
            log::line("the sim has no window to close");
        }
    }

    fn read_firewall(&self) {
        let core = places::core_program();
        self.blocking(move || firewall::read(&core), Event::FirewallRead);
    }

    fn firewall_read(&mut self, read: Result<Firewall, String>) {
        match read {
            Ok(firewall) => {
                self.say.send_if_modified(|state| {
                    let changed = state.firewall != firewall;
                    state.firewall = firewall;
                    changed
                });
            }
            Err(error) => log::line(&format!("the firewall's rules didn't read: {error}")),
        }
        // The welcome's step waits on this, and moves on or says the rule wasn't added once the rules are read again. It's
        // cleared after the state is written, and `screens::view` reads it first, so no view pairs a cleared flag with the
        // state from before the fix.
        self.fixing_firewall().store(false, Ordering::Release);
    }

    fn fixing_firewall(&self) -> &AtomicBool {
        &self.app.state::<Shared>().inner().fixing_firewall
    }

    /// Runs the elevated copy, which shows the UAC prompt, then reads the rules again: from the welcome, as the first run's
    /// step asks, and from the EFB app's Fix. Fix's prompt opens on the desktop behind the sim, which a pilot in VR can't see,
    /// a cost the design names. `Shared::ask` has marked the fix running already.
    fn fix_firewall(&self) {
        log::line("asking Windows to let the core take connections, through the UAC prompt");
        self.blocking(firewall::run_elevated, |_| Event::FirewallFixed);
    }

    /// What follows from the state as it stands: the sim found, the core held or started, our package written, and an update
    /// applied once nothing holds it.
    fn tick(&mut self) {
        let now = Instant::now();
        if self.core.is_none()
            && let Some(held) = core::named()
        {
            log::line(&format!("found the core {} running", held.id));
            self.hold_core(held);
        }
        if self.core.is_none()
            && self
                .keeper
                .should_start(now, self.sim.is_some(), places::session_held())
        {
            self.start_core();
        }
        if self.package_due && self.sim.is_none() && !self.writing_package {
            self.write_package();
        }
        if let Some(closed_at) = self.restart_closed_at
            && self.sim.is_some()
            && now.duration_since(closed_at) > CLOSE_WAIT
        {
            log::line(
                "the sim didn't close within 2 minutes of being asked, so it won't be started again",
            );
            self.start_sim = None;
            self.restart_closed_at = None;
        }
        if self.sim.is_none() {
            self.restart_closed_at = None;
        }
        self.install(now);
    }

    fn find_sim(&mut self) {
        let Some(id) = self.walk.find() else {
            return;
        };
        let Some(held) = Held::open(id) else {
            return;
        };
        let program = held.program();
        log::line(&format!("the sim started, as process {id}"));
        // The pilot started it before the app could start it again, which would otherwise come at its next close.
        if self.start_sim.take().is_some() {
            log::line("the sim started before this app started it again, so it won't");
        }
        self.keeper.sim_started(self.core.is_some());
        self.sim = Some(Sim { id, program });
        self.blocking(move || held.wait(), |_| Event::SimExited);
    }

    fn hold_core(&mut self, held: Held) {
        self.keeper.core_held();
        self.core = Some(held.id);
        self.blocking(move || held.wait(), Event::CoreExited);
    }

    fn start_core(&mut self) {
        if !places::core_program().exists() {
            if !self.core_missing_said {
                log::line(&format!(
                    "no core program is beside this app, at {}, so it starts none",
                    places::core_program().display()
                ));
                self.core_missing_said = true;
            }
            return;
        }
        match core::start() {
            Ok(held) => {
                log::line(&format!("started the core, as process {}", held.id));
                self.hold_core(held);
            }
            Err(error) => {
                log::line(&format!("the core didn't start: {error}"));
                self.keeper
                    .core_exited(None, Instant::now(), self.sim.is_some());
            }
        }
    }

    fn write_package(&mut self) {
        self.package_due = false;
        self.writing_package = true;
        self.blocking(write_package, |sim_started| Event::PackageWritten {
            sim_started,
        });
    }

    /// Applies a downloaded update once the sim is closed, no session is held, and no core runs, since Update.exe kills
    /// every program running from its folder (record/areas/install/01-installing-and-updating.md, "What holds an update
    /// back"). An install the pilot asked for gets there itself: it closes the sim and quits the core.
    fn install(&mut self, now: Instant) {
        // Update.exe would kill the app partway through a copy, and leave the copy's folder behind.
        let Some(release) = self.ready.clone().filter(|_| !self.writing_package) else {
            return;
        };
        if let Some(install) = &mut self.install {
            if let Some(sim) = &self.sim {
                match install.closed_at {
                    None => {
                        if sim::close(sim.id) {
                            log::line("asked the sim to close, to install the update");
                        }
                        install.closed_at = Some(now);
                    }
                    Some(closed_at) if now.duration_since(closed_at) > CLOSE_WAIT => {
                        log::line(
                            "the sim didn't close within 2 minutes of being asked, so the update waits for it to close",
                        );
                        self.install = None;
                    }
                    Some(_) => {}
                }
                return;
            }
            if places::session_held() {
                log::line("a session is held, which holds the update");
                self.install = None;
                return;
            }
            if self.core.is_some() {
                if !install.quit_sent {
                    install.quit_sent = true;
                    tauri::async_runtime::spawn(core::quit());
                }
                return;
            }
            // The new app opens its window when the pilot asked from it, and as a tray icon that starts the sim again when
            // they asked from the EFB app.
            let restart = match &install.sim {
                Some(program) => vec![
                    "--tray".to_string(),
                    START_SIM_FLAG.to_string(),
                    program.to_string_lossy().into_owned(),
                ],
                None => Vec::new(),
            };
            self.apply(&release, &restart);
            return;
        }
        if self.sim.is_none() && !places::session_held() && self.core.is_none() {
            self.apply(&release, &["--tray".to_string()]);
        }
    }

    fn apply(&mut self, release: &VelopackAsset, restart: &[String]) {
        let Some(updates) = &self.updates else {
            return;
        };
        log::line(&format!("installing version {}", release.Version));
        match updates.apply(release, restart) {
            Ok(()) => {
                // A tick while the app exits would start a second Update.exe.
                self.ready = None;
                self.install = None;
                self.app.exit(0);
            }
            Err(error) => {
                log::line(&format!("the update didn't start: {error}"));
                self.update(Update::Failed {
                    next: Some(release.Version.clone()),
                    error,
                });
                self.ready = None;
                self.install = None;
            }
        }
    }
}

/// Sleeps until `at`, or forever with none.
async fn until(at: Option<Instant>) {
    match at {
        Some(at) => tokio::time::sleep_until(at.into()).await,
        None => std::future::pending().await,
    }
}

/// Writes our package from this program's folder into each packages folder, and says whether the sim started during a copy,
/// in which case the next close writes it.
fn write_package() -> bool {
    let package = places::program_folder().join(package::NAME);
    let mut sim_started = false;
    for folder in places::packages_folders() {
        let sim = processes::sim_runs;
        match package::write(&package, messages::VERSION, &folder, sim) {
            Ok(package::Wrote::Current) => {}
            Ok(package::Wrote::Written) => log::line(&format!(
                "wrote our package into {}",
                folder.join("Community").display()
            )),
            Ok(package::Wrote::SimStarted) => {
                log::line(
                    "the sim started while our package was copied, so it's written once the sim closes",
                );
                sim_started = true;
            }
            Err(error) => log::line(&format!(
                "our package wasn't written into {}: {error}",
                folder.join("Community").display()
            )),
        }
    }
    sim_started
}

/// The rules' state for a first run's window, read before it opens, since the welcome picks its steps from the first state it
/// reads, and the jobs' own read would race the page's load. A read that fails takes the rule as in, so the welcome skips the
/// step and the EFB app's Fix stays the way in. It reads on a thread of its own, since the main thread's COM apartment is
/// WebView2's to set.
pub fn firewall_now() -> Firewall {
    let core = places::core_program();
    let read = std::thread::spawn(move || firewall::read(&core))
        .join()
        .unwrap_or_else(|_| Err("the read panicked".to_string()));
    read.unwrap_or_else(|error| {
        log::line(&format!("the firewall's rules didn't read: {error}"));
        Firewall::Allows
    })
}

/// Velopack's hook as the app installs: starting with Windows is on at first (record/areas/product/03-v1-scope.md,
/// "Installing and updating").
pub fn installed() {
    // Velopack runs this hook before the app's own start opens the log.
    log::start();
    if let Err(error) = start_with_windows::set(true) {
        log::line(&format!("starting with Windows wasn't turned on: {error}"));
    }
    // The pilot sees Setup.exe's splash for longer than a flash. An install takes about 0.3s on our development machine,
    // and Setup.exe keeps its splash up while this hook runs, waiting up to 30s, so the hook waits 3s. (measured,
    // record/areas/install/log.md, "2026-11-10: Velopack's splash stays up 0.3s to 1.0s on our install, so the app's
    // install hook holds it 3s for the splash to play")
    std::thread::sleep(Duration::from_secs(3));
}

/// Velopack's hook as the app uninstalls, which may show no UI: it deletes our package from each Community, the Run value,
/// and the data folder. The firewall rule stays, since removing it would need the UAC prompt.
pub fn uninstalling() {
    for folder in places::packages_folders() {
        if let Err(error) = package::delete(&folder) {
            log::line(&format!(
                "our package wasn't deleted from {}: {error}",
                folder.join("Community").display()
            ));
        }
    }
    if let Err(error) = start_with_windows::set(false) {
        log::line(&format!("the Run value wasn't deleted: {error}"));
    }
    let _ = package::remove(places::data_folder());
}
