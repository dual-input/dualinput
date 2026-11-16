# Installing and updating

```text
Purpose:     How Dual Input reaches a pilot's PC and stays current, and what runs on it between runs of the sim.
Depends on:  ../product/03-v1-scope.md, ../architecture/01-spine.md, ../architecture/02-code-map.md, ../core/01-loop-and-edge.md, ../core/03-sim-seam-and-wasm-module.md, ../session/02-units.md, ../interface/01-apps.md, ../build/01-the-build.md, log.md
Decides:     That the desktop app does the watcher's jobs from a tray icon; what installs and updates Dual Input; where it lives on disk; when an update is checked for and when it applies; when our Community package is written; how the sim's start reaches the core; who adds and checks the firewall rule; how a package that overrides our files, and trouble with our own, shows in the core; what uninstalling removes; and what an unsigned v1 costs (node 6.17).
```

> **Note**
> Stage 11b's tentative decision that [Dual Input's one full window is its EFB app](../interface/decisions.md#dual-inputs-one-full-window-is-its-efb-app) changes what the desktop app's window is for: it shows only the desktop app's own screens, the update's progress and the 24 hours of figures, and the app keeps Tauri for them (user, 2026-10-25).
> So an open window keeps no core running, where [the sim and the core](#the-sim-and-the-core) and [one program from login](#one-program-from-login) have it hold one, and the core no longer starts the desktop app's program, since the EFB app has no button for it.

> **Note**
> Stage 11b's tentative decisions settle part of [left to the apps' stage](#left-to-the-apps-stage) until the apps' design confirms them (user, 2026-10-25 to 2026-11-01).
> [A fixed local port](../interface/decisions.md#the-desktop-app-tells-the-efb-app-about-updates-and-the-firewall-over-a-fixed-local-port) carries the update's state and the firewall rule's to the EFB app, whose [Settings tab](../interface/decisions.md#the-settings-tab-holds-the-binding-the-output-device-the-recordings-and-the-version) shows the update and Start with Windows, and whose [header](../interface/decisions.md#the-header-shows-only-what-needs-the-pilot) offers the firewall's Fix.
> Quit lives only in the tray, and [the desktop app's own screens](../interface/decisions.md#the-desktop-app-shows-velopacks-windows-and-its-own-figures-and-the-build-designs-the-rest) are designed during the build.
> The join refusal when the host is behind says they need to leave the session and update ([Host and Join](../interface/decisions.md#host-and-join-answer-inside-the-start-card)).

> **Note**
> The user changed [when the app checks](#when-the-app-checks) on 2026-11-03: a check that finds a newer release downloads it at once only while the sim is closed.
> While the sim runs, automatic checks go on, so the EFB app can say a new version exists, and the download waits for the sim to close, unless the pilot presses Check now or Install, which download at once.
> That adds a state to the local port's `Update`, available and not downloaded.

> **Note**
> On the first run, the welcome's firewall step asks the pilot before the UAC prompt shows, where [the firewall rule](#the-firewall-rule) has the app run itself elevated at once, and no core waits on the rule, since one that waited would leave Dual Input dead in the sim for a pilot who left the welcome open; a core that starts before the rule is in may raise Windows' own prompt, unverified, and the EFB app's Fix mends what that leaves ([the desktop app's screens](../interface/decisions.md#the-desktop-app-shows-velopacks-windows-and-its-own-figures-and-the-build-designs-the-rest); user, 2026-11-10).
> The welcome no longer has a screen for a sim that has never run, which [left to the apps' stage](#left-to-the-apps-stage) names.

> **Note**
> Stage 15 found that a `CreateToolhelp32Snapshot` walk every 2s takes about 0.15% of one CPU core by itself, most of the app's 0.2%, and moved the walk for the sim to `NtQuerySystemInformation` ([log](log.md#2026-11-10-the-desktop-app-starts-the-core-18s-after-the-sim-and-20s-to-24s-after-a-crash-and-holds-its-02-of-a-core-only-with-a-walk-cheaper-than-toolhelps)).
> That call's process list holds a record for every thread, so it costs more with every thread the PC runs: it took 4.0ms of CPU a walk at 7,146 threads, which at 30 walks a minute is 0.2% of a core by itself.
> So where [the sim and the core](#the-sim-and-the-core) has the app walk with Toolhelp, it takes the process IDs from `EnumProcesses` and opens each process for its program's name, at 0.8ms a walk, and keeps Toolhelp for its figures' once-a-minute walk ([log](log.md#2026-11-16-the-desktop-apps-walk-for-the-sim-cost-40ms-at-7146-threads-and-through-enumprocesses-it-costs-08ms-so-the-app-uses-006-to-007-of-a-core)).

Dual Input has no watcher: the desktop app runs from login as a tray icon, at 2.2 MB until its window first opens and 3.7 MB after, and does the watcher's jobs, and it shows its window when the pilot opens it.
Velopack installs it for the pilot's own account and updates it, with the desktop app as Velopack's main program, so no update asks for an administrator, and every program keeps one path from release to release.
The app applies an update only while the sim is closed, no session is held, and the core has exited, and Install now quits the core to get there.
At its start and at each sim close, an installed app writes our Community package wherever it's missing or of another version, and on its first run it adds the firewall rule.
The core searches no other package for files that override ours, and checks nothing of our own package on disk: the clients crate's notification when no cockpit panel connects names another package's `VCockpit.js` as the likeliest cause, the module's status raises our package's trouble notification, and Dual Input turns no package off.

This answers node 6.17 of the [architecture plan](../architecture/plan.md#617-installing-and-updating).
[Installing and updating](../product/03-v1-scope.md#installing-and-updating), decisions [002](../../decisions/002-core-starts-with-every-sim-run.md) and [003](../../decisions/003-watcher-keeps-blurpage-copy-current.md), and the spine's [desktop app and the core](../architecture/01-spine.md#the-desktop-app-and-the-core) give the rules this design builds on, with the desktop app doing what they give the watcher, and this document holds only what they leave out.
The research behind it is in this area's [log](log.md).

## One program from login

- A Tauri 2 app with a tray icon and no window took 2.2 MB of Task Manager's memory in one process, and no CPU over 60s; with a window open, 72.7 MB in seven; with the window hidden, 72.3 MB in seven; and with the window destroyed, 3.7 MB in one, every WebView2 process gone within 15s (measured on our development machine, 2026-10-18, [log](log.md#2026-10-18-a-tauri-2-app-idles-as-a-tray-icon-in-22-mb-and-gives-back-webview2s-69-mb-once-its-window-is-destroyed-but-not-while-its-hidden)).
  So closing the desktop app's window destroys it, and never hides it; that a window opened again after one was destroyed gives its memory back the same way is unmeasured ([cases on a desk](#cases-on-a-desk)).
- The desktop app's Rust side does every job the spine and decision 002 give the watcher, so no program of ours runs beside the core without talking to it, and the files [decision 015](../../decisions/015-watcher-reads-files-core-writes.md) has the watcher read fall away with it; the BlurPage copy that decision 003 gives the watcher ships in our package instead ([our package](#our-package)).
- **At login** it starts as a tray icon alone, from a value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` that runs it with `--tray`.
  Velopack's install hook writes that value, since starting with Windows is on at first ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), and the app's setting to start with Windows writes or deletes it after.
  Started with no argument, as from the Start menu, it opens its window.
- **One runs for each data folder,** as one core does: a second start, from the Start menu or from the core, hands its request to the running one, which opens its window, and exits.
  So the core's start of the desktop app's program, when the EFB app's button asks and no desktop app is connected ([bringing the desktop app forward](../interface/01-apps.md#bringing-the-desktop-app-forward)), opens the running app's window, and a developer's desktop app with a data folder of its own runs beside the installed one.
- **Its socket** to the core is open while its window is open, so the core still exits once the sim has closed, no session is held, and no window is open ([joining and leaving](../session/02-units.md#joining-and-leaving)).
- **The tray's Quit** sends the session crate's Quit, as any client may ([quit](../interface/01-apps.md#quit)), and ends the app, which stays ended until the next login or the next start from the Start menu.

## The units

| Unit | Holds |
| --- | --- |
| Velopack's Setup.exe and Update.exe | Not ours: the installer, and the swap of one release's programs for the next ([the installer and the updater](#the-installer-and-the-updater)) |
| `src/apps/desktop` | The tray icon and the window, and in its Rust side the watcher's jobs: noticing the sim, starting the core and starting it again, checking for, downloading, and applying updates, writing our Community package, the firewall rule, and the 24 hours of figures |
| `sim-service` | The packages folders, and our package's trouble notification |

## The installer and the updater

Velopack is a per-user installer, Setup.exe; an updater, Update.exe; a Rust crate, `velopack`, that the desktop app links; and `vpk`, a .NET tool that packs a release (read in velopack 1.2.161, [installer frameworks](results/2026-10-18-installer-frameworks.txt)).
It's MIT-licensed, and its 1.x line began on 2026-05-26.

- **Per-user, one path.**
  Setup.exe installs to `%LOCALAPPDATA%\DualInput\` with no administrator prompt, and an update replaces the `current\` folder there by two renames, so `current\dualinput-core.exe` keeps its path from release to release (read in velopack 1.2.161, `src/bins/src/setup.rs` and `src/bins/src/commands/apply_windows_impl.rs`).
  The firewall rule names that path.
- **One release, three programs.**
  The desktop app is Velopack's main program, and the core, the core helper, the SDK's `SimConnect.dll` beside the core, and our Community package ride beside it in `current\` ([what a release holds](../build/01-the-build.md#what-a-release-holds)), so the core starts the core helper and the desktop app from its own folder, as [the helper's life](../core/04-core-helper.md#the-helpers-life) and [bringing the desktop app forward](../interface/01-apps.md#bringing-the-desktop-app-forward) need.
  The desktop app builds with `tauri build --no-bundle`, so Tauri makes no installer of its own (documented, [Tauri's CLI](https://v2.tauri.app/reference/cli/)).
- **Shortcuts.**
  Packed with `--shortcuts StartMenuRoot`, Setup.exe puts a Start-menu shortcut to the main program, which starts it from `current\` (read in `src/bins/src/windows/shortcuts.rs`); the login start needs `--tray`, so the Run value, not a Startup shortcut, carries it.
- **WebView2.**
  Packed with `--framework webview2`, Setup.exe looks for the runtime, and where it's missing asks the pilot in a dialog of its own, then runs Microsoft's bootstrapper without elevation (read in `src/bins/src/windows/prerequisite.rs`, `prompt_and_install_all_missing`, and `runtimes.rs`), which installs the runtime for the pilot alone unless a per-machine Edge updater replaces it (documented, [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)); such a PC needs the internet at install.
- **Downloads.**
  The `velopack` crate in the desktop app downloads each release and checks its size and SHA-256 against the release's feed (read in `src/lib-rust/src/manager.rs`, `verify_package_checksum`).
  It downloads deltas when it holds the whole package of the release it's updating from and the feed lists a delta for each release since; otherwise, or when a delta fails, it downloads the whole release (same file, `download_updates` and `create_delta_update_strategy`), and Update.exe applies the deltas.
  CI fetches the previous release with `vpk download github` before `vpk pack`, which makes a delta "as long as there is a previous release in your `--outputDir`" (documented, [Velopack's deltas](https://docs.velopack.io/packaging/deltas)).
- **The feed.**
  The app reads it through Velopack's `GithubSource`, which builds the feed from the newest 10 releases and downloads each file from the release that holds it (read in `src/lib-rust/src/sources/github.rs`), so a pilot up to 10 releases behind gets deltas (inference from that file and `manager.rs`; unverified by a run).
  A plain URL at `releases/latest/download/`, through `HttpSource`, would reach only the newest release's files (read in `src/lib-rust/src/sources/http.rs`), so a pilot two releases behind would get no delta.
  `GithubSource` makes a call to GitHub's API for each check and each download, which GitHub limits to 60 an hour from one address, and a pilot's checks, every 3 hours and at each start and sim close, make a few an hour at most.
- **The app applies only by its own checks.**
  `VelopackApp::build().run()` applies a downloaded update as the program that calls it starts, unless auto-apply is turned off (read in `src/lib-rust/src/app.rs`, `set_auto_apply_on_startup`, "ON by default"), so the desktop app calls it with auto-apply off, and the core and the core helper link no Velopack.
  Update.exe force-kills every process running from its folder but itself before it swaps (read in `src/bins/src/shared/util_windows.rs`, `force_stop_package`), so the app applies only when [what holds an update back](#what-holds-an-update-back) clears.
- **Its costs.**
  CI needs the .NET 8 SDK to run `vpk` (documented, [Velopack's Rust guide](https://docs.velopack.io/getting-started/rust)), while Setup.exe and Update.exe are Rust (read in `src/bins`), so nothing of .NET reaches the pilot.

Tauri's own NSIS installer and updater plugin, which the desktop app could drive, would also install per-user with no prompt, keep their folder, and sign each update with a key of ours, but they download the whole installer for every update and write its files in place (read in tauri-bundler 2.10.3, `installer.nsi`, and tauri-plugin-updater 2.14.0, `plugins/updater/src/updater.rs`, where no code fetches a delta), while Velopack sends deltas and swaps a folder by rename, and deltas decide it (user, 2026-10-18).
An MSI installed per machine prompts for an administrator at every update (read in tauri-bundler 2.10.3, `msi/main.wxs`, `InstallScope="perMachine"`), and an installer and updater of our own would be all ours to write, the swap's failures among them.

## On disk

| What | Where |
| --- | --- |
| The programs, and the copy of our package the app writes from | `%LOCALAPPDATA%\DualInput\current\` |
| Velopack's downloads | `%LOCALAPPDATA%\DualInput\packages\` |
| WebView2's data for the desktop app's window | `%LOCALAPPDATA%\DualInput\webview\`, so an uninstall deletes it with Velopack's folder |
| The core's data folder | `%APPDATA%\DualInput\` |
| The desktop app's own files, its log and its figures among them | `%APPDATA%\DualInput\app\` |
| Our package | `Community` in each packages folder ([the packages folders](#the-packages-folders)) |
| Our package while the app copies it | A folder the app makes fresh for each copy, beside `Community` or beside the folder a `Community` junction leads to, for the seconds the copy takes while the sim is closed |

- The data folder sits outside Velopack's folder, whose contents an uninstall deletes (read in `src/bins/src/commands/uninstall.rs`), and in `%APPDATA%`, the folder the sim's Steam edition keeps its own packages in (read on our development machine, 2026-10-18, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)).
- Our package goes in `Community`, where FS Copilot's, YourControls', and FlyByWire's installers put theirs ([prior installers](results/2026-10-18-prior-installers.txt); [installer frameworks](results/2026-10-18-installer-frameworks.txt)), though the SDK names `Community2024` for packages only MSFS 2024 runs (documented, [Virtual File System Information](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Virtual_File_System_Information.htm)).
- A development core with a data folder of its own keeps everything there ([finding the core](../architecture/01-spine.md#finding-the-core)).

## The packages folders

- The desktop app and the sim service each find the sim's packages folders from the `InstalledPackagesPath` line of each `UserCfg.opt` they find: Steam's in `%APPDATA%\Microsoft Flight Simulator 2024\`, and the Microsoft Store's in `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\`, which no run of ours has seen ([02-01](../../learn/foundations/02-01-installs-and-packages.md)).
  They match the line by its name and a space, `InstalledPackagesPath `, as FlyByWire's installer does, so a longer name such as `InstalledPackagesPathNextBoot` doesn't match (read in flybywiresim/installer v3.7.2, `src/renderer/actions/install-path.utils.tsx`).
- Every packages folder found gets our package, so a PC with both editions has it in each.
- Nothing asks the pilot for a folder: the sim "will only look at this file to determine where the Official and Community folders are" (documented, [Virtual File System Information](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Virtual_File_System_Information.htm)), so a folder the pilot names before the sim has written one may not be the sim's.
  A pilot who installs Dual Input before the sim's first run gets our package when that run closes, provided the run writes `UserCfg.opt` (unverified; a first run on a fresh install settles it).
- The sim service gives the session crate the packages folders for its search for an aircraft's package ([the match check](../session/02-units.md#the-match-check)), so one unit reads `UserCfg.opt` in the core.

## The sim and the core

- Every 2s, while it holds no sim process, the desktop app walks a `CreateToolhelp32Snapshot` for `FlightSimulator2024.exe`, ignoring case, as the core's edge does ([the sim's process](../core/03-sim-seam-and-wasm-module.md#the-sims-process)), then opens the process with `SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION` and waits on it for its exit.
  - A walk took 2.8ms from PowerShell, with 291 processes running, about 0.14% of one core at one walk every 2s; a program with no administrator opened another of the pilot's processes that way, and a wait on a process it started returned when that process exited, with its exit code; and WMI's `Win32_ProcessStartTrace` refused it (measured on our development machine, 2026-10-18, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)).
  - That the Store edition's process has the same name, and opens the same way, is unverified ([cases in the sim](#cases-in-the-sim)).
- The app wants a core while the sim runs, its window is open, or a session file exists, so a pilot whose sim closed while the crew flies on keeps a core that comes back after a crash ([in the flight](../session/02-units.md#in-the-flight)).
  While it wants one and the port file names none that runs, matched by its process ID and creation time ([finding the core](../architecture/01-spine.md#finding-the-core)), it starts `dualinput-core.exe` from its own folder.
  The app can start after the sim, since Windows "does not provide guarantees about how promptly the programs in the Run key are run" (documented, [Run and RunOnce](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys)), so it looks for the sim as it starts.
- It waits on whichever core the port file names, whoever started it, and reads its exit code (documented, [GetExitCodeProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getexitcodeprocess); measured only on a process the probe started).
  When that core exits with a code other than 0, the app starts one again 2s later while it still wants one; after an exit with 0, which means the core chose to stop, by a quit or by the spine's rule ([exiting](../core/01-loop-and-edge.md#exiting)), it starts none until the sim next starts or its window next opens.
  This replaces the rule in [when the core goes](../interface/01-apps.md#when-the-core-goes), which starts a core after a close without a `bye`, since the exit code is the same fact read where the core's process is.

## Updates

### When the app checks

- At its start, each time the sim closes, every 3 hours, and on Check now, a button in its window.
- The check as the sim closes is the one a refused join leans on, since the join check tells the pilot who is behind to close the sim ([installing and updating](../product/03-v1-scope.md#installing-and-updating)).
- A check that finds a newer release downloads it at once, while the sim runs too.
- The window shows whether the app is checking, downloading and how far, up to date and when it last checked, ready and what holds the update back, or failed and the error, so a pilot who opens it while a check runs sees the check, and has no reason to end our programs to start one.

### What holds an update back

A downloaded update applies once all of these hold:

1. The sim is closed.
2. No session file exists ([the session file](../session/02-units.md#the-session-file)).
3. No core runs, since Update.exe kills any program running from its folder.

- The core exits on its own once the sim has closed, no session is held, and no window of the app is open, so an open window holds the core, and the core holds the update; closing the window lets both go.
- The app then calls `wait_exit_then_apply_updates` with `restart` set and `--tray` as the restart argument, and exits, and Update.exe swaps `current\` and starts the new app as a tray icon (read in velopack 1.2.161, `src/lib-rust/src/manager.rs` and `src/bins/src/commands/apply.rs`), which writes our package ([our package](#our-package)).
- A host alone in a session before preflight ends keeps it through the sim's close ([in the flight](../session/02-units.md#in-the-flight)), so a host who is behind has their update held by the session, which the window says, and leaves the session first.

### Install now

- Install now is a button in the window while an update is ready, and it waits, saying why, while the sim runs or a session is held, which the pilot ends first (user, 2026-10-18).
- Otherwise the app sends the session crate's Quit, so the core sends `bye` and exits with 0, then applies the update with no restart argument, so the new app opens its window.

### No warning early in the sim's load

The warning that a waiting update needs a sim restart, which [installing and updating](../product/03-v1-scope.md#installing-and-updating) has a Windows notification give early in the sim's load, is out of v1 (user, 2026-10-18).

- Microsoft gives Focus assist's default as "to activate automatically when you're duplicating your display, playing a game, or using an app in full screen mode" (documented, [Focus](https://support.microsoft.com/en-us/windows/turn-off-notifications-in-windows-during-certain-times-81ed1b25-809b-741d-549c-7696474d15d3)), and while Do Not Disturb is on, other apps' banners "are sent directly to the notification center" (documented, [Notifications and Do Not Disturb](https://support.microsoft.com/en-us/windows/experience/notifications-and-do-not-disturb-in-windows)); that the same default holds for Do Not Disturb on Windows 11 25H2 is unverified.
- On Windows 11 a tray balloon that times out "will not be displayed in the Notification Center" (documented, [Shell_NotifyIconW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shell_notifyiconw)).
- An update waits at a sim start only when the sim started before its download finished, or a session or an open window held it, and the join check names the fix.
- So the core writes no date of the pilot's last session, which decision 015 has the watcher read for that warning alone.

## Our package

- Our package is one folder named `dualinput`, with the order hint `PANEL_PATCH`, which holds our WASM module and the figure's SimObject too ([our package](../build/01-the-build.md#our-package)).
- At its start and each time the sim closes, while the sim is closed, the desktop app writes our package from `current\` into each packages folder's `Community` where the package is missing or its `manifest.json`'s `package_version` isn't the app's version.
  That one rule writes it at an install, after an update, after a reinstall, and after a pilot or a mod deletes it, and nothing watches `Community` between those moments (user, 2026-10-18).
  The app writes it only when it runs from Velopack's `current\` folder, as an installed app does, so a developer installs a development build's package with `node tools/build.ts install`, since a rebuild keeps the version and the app's rule would never copy it in ([our package](../build/01-the-build.md#our-package)).
- The build finishes the package in `current\`, its `layout.json` included, so the app only copies it: first into a folder it makes fresh for each copy, beside `Community` or beside the folder a `Community` junction leads to, as `tools/build.ts install` does, then it renames the old copy out of `Community` and the new one in, and deletes the old one.
  - A folder of one fixed name, `DualInput\`, could be the pilot's data folder: a junction to `%APPDATA%\Community` would put it at `%APPDATA%\DualInput\` (user, 2026-10-21; [log](log.md#2026-10-21-a-fixed-dualinput-staging-folder-beside-a-community-junctions-target-can-be-the-pilots-data-folder)).
  - A copy made inside `Community` would most likely mount as a second package, since the sim's `Content.xml` names each folder there by its name, suffixes included (read on our development machine, 2026-10-18; unverified by a run).
  - Our FS Copilot exerciser's sync of a new build into its own folder, while it ran, "deleted 349 of 355 files" before it reached one in use, and its fix "stages then swaps rather than deleting first" (FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-19 — The exerciser leaves the tree, and takes four compile-time couplings with it").
  - Before it deletes a folder, the app checks whether it's a junction and removes only the link, since fsc-editor found two packages in our Community folder that were junctions to folders under `Program Files` (read in fsc-editor, `src/main/sim/install.ts`, `removeEntry`).
- **The BlurPage copy ships in our package,** built from the sim's stock file as our `VCockpit.js` is, and a release follows any sim update that changes either, where [decision 003](../../decisions/003-watcher-keeps-blurpage-copy-current.md) has the watcher make the copy on each pilot's PC (user, 2026-10-18).
  - Every pilot then gets the same copy, the Microsoft Store edition's pilots too, whose install folder a program may not be able to read (unverified, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)), and no PC reads, hashes, or watches the sim's files.
  - The copy should rarely fall behind: on our Steam install, BlurPage's two files were last written on 2025-11-04, though Steam's update of 2026-10-14 rewrote other files in `fs-base-ui`, and the `.json` matches the copy we took on 2026-10-06 (read on our development machine, 2026-10-18, [log](log.md#2026-10-18-the-sims-blurpage-files-havent-changed-since-2025-11-04)).
  - When a sim update does change BlurPage, our older copy hides the sim's new one until our next release, and what that does to the menu is unknown until it happens.
    The build keeps the sim's stock files in `src/sim-package/stock/`, and a developer's build on a PC with the sim stops when the sim's own differ from them ([the sim's stock files](../build/01-the-build.md#the-sims-stock-files)).

## How package trouble shows

### Packages that override our files

- Our package lists three paths outside our own folders: `html_ui/Pages/VCockpit/Core/VCockpit.js`, and BlurPage's `cookedcomps/{8B92BB9A-4176-4F1A-A9CE-CB1195C4E952}.html` and its `.json`.
  FS Copilot's package lists `html_ui/pages/vcockpit/core/vcockpit.js`, all in lowercase (read in the FS Copilot fork, `FsCopilot.Bridge/Packages/fscopilot-bridge/layout.json`).
- Of two packages with the same order hint that override one file, the one mounted later wins, in alphabetical order (documented, [Virtual File System Information](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Virtual_File_System_Information.htm)).
  But our `VCockpit.js` won over FS Copilot's in one flight with both packages in `Community`, though `fscopilot-bridge` sorts after `dualinput` with the same order hint (measured on MSFS 2024, 2026-10-22, [log](log.md#2026-10-22-our-vcockpitjs-won-over-fs-copilots-though-fscopilot-bridge-sorts-after-dualinput-with-the-same-order-hint)).
  Why ours won is unverified, so a pilot with both packages installed may find FS Copilot's panels running our bridge in place of its own.
- The sim most likely doesn't mount a package that the profile's `Content.xml`, under `%APPDATA%\Microsoft Flight Simulator 2024\`, marks `UserDisabled` (unverified); that file names each package `communityfs24-` or `communityfs20-` and its folder's name, lowercased (read on our development machine, 2026-10-18, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)).
- The core searches no other package for files that override ours, since ours won over FS Copilot's against the mount order such a search assumed.
  Which copy won shows when the pages that need it say hello or don't: the panel bridge within 10s of the profile loading ([trouble](../interface/01-apps.md#trouble)), and the menu script, without which Go to is unavailable ([go to](../session/02-units.md#go-to)).
  When no cockpit panel connects, the clients crate's notification names another package's `VCockpit.js` as the likeliest cause (user, 2026-10-23; [architecture log](../architecture/log.md#2026-10-23-a-review-against-the-simplicity-rule-cut-eight-guards-and-kept-every-designed-feature-it-questioned)).
- Dual Input turns no package off: removing or turning off a package that overrides our files is the pilot's, however they keep their mods, and the offer [installing and updating](../product/03-v1-scope.md#installing-and-updating) makes to disable it moves to Later (user, 2026-10-18).

### Our own package

- The core checks nothing of our own package on disk, since the module's status of Missing or Differs covers it ([the module's status](../core/03-sim-seam-and-wasm-module.md#the-modules-status); user, 2026-10-23; [architecture log](../architecture/log.md#2026-10-23-a-review-against-the-simplicity-rule-cut-eight-guards-and-kept-every-designed-feature-it-questioned)).
- The sim service raises one trouble notification for our package from either status, and Stopped raises a notification of its own (user, 2026-10-18).

## The firewall rule

- The desktop app owns the rule, because "The Netsh advfirewall command requires administrator permissions to run" (documented, [the Windows 8.1 answer-file page](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-8.1-and-8/hh825692(v=win.10)); no add was tried without one), and a pilot who isn't an administrator, prompted when a program first listens, gets block rules "It doesn't matter what option is selected", which win over allow rules (documented, [Windows Firewall rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)).
  Our machine holds that pair of block rules, TCP and UDP, for FS Copilot's `fscopilot.exe`, with no allow rule (read on our development machine, 2026-10-18, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)).
- On its first run after the install, before it starts any core, the app reads the rules, which a program with no administrator did (measured on our development machine, 2026-10-18, same file), and if no rule allows the core or a block rule names it, runs itself with the `runas` verb and a flag of its own, which shows one UAC prompt.
  That copy acts on the flag before the check that hands a second start to the running app, adds an inbound rule allowing UDP to `current\dualinput-core.exe`, written as its full path, on every network profile, deletes every block rule naming that path, comparing paths without regard to letter case, as [the way through home routers](../network/01-between-machines.md#the-way-through-home-routers) requires, and exits.
  So a reinstall asks nothing, since the rule a past uninstall left behind names the same path.
- At each of its starts the app reads the rules again, and while the rule is missing or a block rule names the core, it offers the same fix.
- An update keeps the core's path, so the rule should keep matching it, which a desk case checks.
- Velopack's hooks "may not show any UI" (documented, [Velopack's hooks](https://docs.velopack.io/integrating/hooks)), so the uninstall hook tries no prompt, whether or not one would work there (unverified), and the rule stays behind, naming a path that no longer exists, which a reinstall's core has again.
- Whether the core's UDP socket raises Windows' prompt at all, when no rule names it, is unverified (same file).

## Uninstalling

- The desktop app's uninstall hook runs with no UI, and Velopack kills it after 30s, by its docs, where its source passes 60s (documented, [Velopack's hooks](https://docs.velopack.io/integrating/hooks); read in velopack 1.2.161, `src/bins/src/commands/uninstall.rs`).
- Velopack force-stops every process running from its folder before it runs the hook (read in velopack 1.2.161, `src/bins/src/commands/uninstall.rs`, `uninstall`), so a core that runs at an uninstall dies with no quit, and a crew in a session with it sees its link lost; uninstalling in a session isn't a path a crew takes.
- Only the pilot starts an uninstall, from Windows' list of installed programs, and an update never does, since it applies only with no core running.
  The nearest thing to an accident is running Setup.exe again over the install, which asks the pilot to confirm, then force-stops our programs and runs the install hook, not the uninstall hook (read in velopack 1.2.161, `src/bins/src/commands/install.rs`), so the data folder stays: the new app, finding the session file, starts a core, and the pilot comes back as a late joiner, as after a crash ([decision 041](../../decisions/041-core-crash-comes-back-as-late-joiner.md)).
- The hook deletes our package from each `Community`, the Run value, and the data folder.
- Velopack then deletes its own folder, the programs and WebView2's data among it, ignoring any file it can't delete, the Start-menu shortcut, and its entry in the pilot's list of installed programs (same file); WebView2's processes run from the runtime's own folder, so whether one outlives the app it served and holds a file there is unverified ([cases on a desk](#cases-on-a-desk)).
- The firewall rule stays, as [the firewall rule](#the-firewall-rule) says.

## An unsigned v1

v1 ships unsigned, as [installing and updating](../product/03-v1-scope.md#installing-and-updating) leaves code signing out (user, 2026-10-18), at three costs:

- On a PC whose Smart App Control enforces, a release of ours runs only once it has a positive reputation, since Smart App Control "will block execution of unsigned files unless the file has a positive reputation" and its checks "apply to all executable files, not just those downloaded from the Internet" (documented, [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)), and "There is currently no way to bypass Smart App Control protection for individual apps" (documented, [its FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)).
  Each unsigned release starts "with zero reputation" (same page), so until a release has one, the pilot turns Smart App Control off for the whole PC; in its evaluation mode it blocks nothing.
  How many pilots run it is unknown, and some MSFS pilots found it blocking the sim's own `CoherentGTCore.dll` (an MSFS forum thread, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)).
- SmartScreen shows "Windows protected your PC" at the first install, and the pilot chooses "Run anyway" (documented, [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)).
  The app's downloads carry no mark of the web, so SmartScreen likely never checks an update (unverified), while Smart App Control checks every program it runs.
- "Unsigned applications are more likely to be flagged by antivirus software" (documented, [Velopack's FAQ](https://docs.velopack.io/troubleshooting/faq)), so a release that Microsoft Defender or another antivirus takes for malware would have a program of ours quarantined, which the pilot sees as Dual Input not starting or not updating; how often that happens to a release of ours is unknown until releases reach pilots, and their bug reports can't say, since a quarantined core sends none.

Velopack trusts the feed through HTTPS and the GitHub account that publishes it, since it checks a download's hash against the feed and no publisher's signature (read in velopack 1.2.161, `src/lib-rust/src/manager.rs`, `verify_package_checksum`).

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures.

| What | Budget |
| --- | --- |
| The desktop app with no window, the sim closed | Under 5 MB of private working set, and under 0.2% of one CPU core |
| The core starting | Within 3s of the sim's process appearing |
| A core that crashed | Started again within 3s of its exit |
| An update with nothing holding it | Applied, and the new app running, within 30s of the last thing holding it going away |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with a program named `FlightSimulator2024.exe` standing in for the sim's process:

- The stand-in starts, and the app starts a core; the app starts with the stand-in already running, and starts one too.
- The core exits with 1 while the stand-in runs, and the app starts it again; it exits with 0, and the app starts none until the stand-in starts again; it crashes before it writes the port file, and the app starts it again.
- The stand-in ends while a session is held, and the core then crashes: the app starts it again.
- The stand-in starts again while the core is still exiting from the last end: the app starts a core for the new run.
- The window opens with the stand-in ended: the core started for it waits for the app's socket, rather than exiting at once.
- An update is downloaded and the app starts with the stand-in running: the update stays pending.
- An update downloads while the stand-in runs: the window says the sim holds it; the stand-in ends, the core exits, the update applies, and the new app starts as a tray icon and writes our package.
- The stand-in starts while the app copies our package: the app swaps nothing, and writes the package at the stand-in's next end.
- Setup.exe run over the install during a session: the core dies, the new app starts a core because the session file exists, and the pilot comes back as a late joiner.
- A session file, or an open window, holds a downloaded update, and the window says which.
- A host who is behind, alone in a session with the stand-in ended: the window says the session holds the update, and it applies once they leave.
- Install now waits while the stand-in runs or a session is held; otherwise the core quits, the update applies, and the new app opens its window.
- Check now: the window goes through checking to up to date, and to failed with the error while the network is cut.
- The tray's Quit in a session: the other core sees a leave, the core exits with 0, and the app ends.
- A second start of the app, from the Start menu or from the core, opens the running app's window and exits.
- Closing the window, with the stand-in ended and no session: the app's socket closes and the core exits.
- Our package removed, or at another version: the app writes it at its next start or the stand-in's next end.
- An install with the stand-in running, then a restart before it ends: our package is written once it ends.
- Uninstalling with the core running: Velopack kills it, a crew's core sees its link lost, and the data folder goes.
- A first install, then a restart of the PC: the Run value starts the app as a tray icon, and a reinstall over a firewall rule left behind shows no UAC prompt.

### Cases on a desk

These need no sim:

- After a Velopack update, the firewall rule still matches `current\dualinput-core.exe`, and Update.exe killed only what ran from its folder.
- On a Windows 10 PC without WebView2, Setup.exe's dialog leads to a per-user install with no UAC prompt.
- The Run value starts the app at login as a tray icon alone.
- A window opened again after one was destroyed gives its memory back the same way, and WebView2's processes exit when the app is killed, leaving nothing in `%LOCALAPPDATA%\DualInput\webview\` held open.
- A pilot two releases behind gets deltas through `GithubSource`.

### Cases in the sim

- Uninstalling while the sim runs: which of our package's files the sim holds, and what the hook leaves.
- On a PC with no rule naming the core's path, whether the core's UDP socket raises Windows' firewall prompt.
- A fresh install of the sim: whether its first run writes `UserCfg.opt`.
- The Store edition, on a pilot's PC: its process's name and whether the app opens it, where its `UserCfg.opt` and `Content.xml` are, and whether a program reads its install folder and `fs-base-ui`.

## Left open

- A sim started in the seconds Update.exe takes to swap `current\` boots with the old package beside a new core, whose module then differs from the core and raises its trouble notification until the sim closes; nothing guards against it.

## Left to the apps' stage

Stage 11b settled these, in [the desktop app's screens](../interface/decisions.md#the-desktop-app-shows-velopacks-windows-and-its-own-figures-and-the-build-designs-the-rest), [the fixed local port](../interface/decisions.md#the-desktop-app-tells-the-efb-app-about-updates-and-the-firewall-over-a-fixed-local-port), and [the header](../interface/decisions.md#the-header-shows-only-what-needs-the-pilot):

- The tray icon's menu, the figures and what quitting costs, a sample a minute, and their words.
- How the app's setting to start with Windows follows Windows' own switch for its Run value, which Settings and Task Manager keep under `StartupApproved`: the app only reads that switch, every 5s, and the EFB app tells the pilot where to turn it back on (measured on Windows 11, 2026-11-02, [log](log.md#2026-11-02-windows-11s-startup-apps-page-writes-01-for-off-and-zeros-for-on-and-tells-a-running-app-neither)).
- How the window shows the update's states, Install now, and Check now, and what Install now says while it waits.
- How the EFB app's header offers the firewall fix, and what the first run's window shows while no `UserCfg.opt` exists.
- The join check's refusal when the host is the one behind, which tells them to leave the session first.

## What this changes elsewhere

The text or the notes at the top of [the spine](../architecture/01-spine.md), [the code map](../architecture/02-code-map.md), [03-v1-scope](../product/03-v1-scope.md#installing-and-updating), [01-between-machines](../network/01-between-machines.md), [01-loop-and-edge](../core/01-loop-and-edge.md), [03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md), [the session's units](../session/02-units.md), and [the apps](../interface/01-apps.md) list what this design changes there, and the [tentative decisions](../architecture/decisions.md#dual-input-has-no-watcher-and-the-desktop-app-runs-from-login-as-a-tray-icon-doing-its-jobs) give the reasons.
