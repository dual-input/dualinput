# Installing and updating

```text
Purpose:     How Crosscheck reaches a pilot's PC and stays current, and what the watcher does between runs of the sim.
Depends on:  ../product/03-v1-scope.md, ../architecture/01-spine.md, ../architecture/02-code-map.md, ../core/01-loop-and-edge.md, ../core/03-sim-seam-and-wasm-module.md, ../session/02-units.md, ../interface/01-apps.md, log.md
Decides:     What installs and updates Crosscheck; where it lives on disk; when the watcher checks for an update and when one applies; how the apps learn of an update and ask for a check or an install; when our Community package is written; how the watcher notices the sim, starts the core again, and quits it; who adds and checks the firewall rule; how the core finds packages that override our files and checks our own; how a package is turned off; what uninstalling removes; and what an unsigned v1 costs (node 6.17).
```

Velopack installs Crosscheck for the pilot's own account and updates it, with the watcher as Velopack's main program, so no update asks for an administrator, and every program keeps one path from release to release.
The watcher applies an update only while the sim is closed, no session is held, and no other program of ours runs, and writes our Community package into each packages folder whose copy is of another version.
It tells the core what its updating is doing through a file the core reads, and the core passes on the pilot's Install now and Check now through a file the watcher reads, so the apps show a check, a download, and what holds an update back.
The watcher's tray quits the core through the window the core already has for Windows' end of session, and the watcher alone adds the firewall rule, with one UAC prompt on its first run.
In the core, the sim service warns of packages that override our files and checks our own, and a package turns off by moving beside `Community` while the sim is closed.

This answers node 6.17 of the [architecture plan](../architecture/plan.md#617-installing-and-updating).
[Installing and updating](../product/03-v1-scope.md#installing-and-updating), decisions [002](../../decisions/002-core-starts-with-every-sim-run.md), [003](../../decisions/003-watcher-keeps-blurpage-copy-current.md), and [015](../../decisions/015-watcher-reads-files-core-writes.md), and the spine's [watcher and desktop app](../architecture/01-spine.md#the-watcher-and-the-desktop-app) give the rules this design builds on, and this document holds only what they leave out.
The research behind it is in this area's [log](log.md).

## The units

| Unit | Holds |
| --- | --- |
| Velopack's Setup.exe and Update.exe | Not ours: the installer, and the swap of one release's programs for the next ([the installer and the updater](#the-installer-and-the-updater)) |
| `apps/watcher` | Velopack's main program: noticing the sim, starting the core and starting it again, checking for, downloading, and applying updates, writing our Community package and its BlurPage copy, the firewall rule, moving packages out of `Community` and back, its tray, and its 24 hours of figures |
| `session` | The update's slice, from the watcher's file, and Install now and Check now, which it passes to the watcher through the core's file |
| `sim-service` | The packages folders, the search for packages that override our files, the check of our own package, and the settings that turn a package off |
| `apps/core` | The edge's watch on the watcher's file and process, and the core's window, which takes the tray's quit |

## The installer and the updater

Velopack is a per-user installer, Setup.exe; an updater, Update.exe; a Rust crate, `velopack`, that the watcher links; and `vpk`, a .NET tool that packs a release (read in velopack 1.2.161, [installer frameworks](results/2026-10-18-installer-frameworks.txt)).
It's MIT-licensed, and its 1.x line began on 2026-05-26.

- **Per-user, one path.**
  Setup.exe installs to `%LOCALAPPDATA%\Crosscheck\` with no administrator prompt, and an update replaces the `current\` folder there by two renames, so `current\crosscheck-core.exe` keeps its path from release to release (read in velopack 1.2.161, `src/bins/src/setup.rs` and `src/bins/src/commands/apply_windows_impl.rs`).
  The firewall rule names that path.
- **One release, four programs.**
  The watcher is Velopack's main program, and the core, the core helper, the desktop app, and our Community package ride beside it in `current\`, so the core starts the core helper and the desktop app from its own folder, as [the helper's life](../core/04-core-helper.md#the-helpers-life) and [bringing the desktop app forward](../interface/01-apps.md#bringing-the-desktop-app-forward) need.
  The desktop app builds with `tauri build --no-bundle`, so Tauri makes no installer of its own (documented, [Tauri's CLI](https://v2.tauri.app/reference/cli/)).
- **Shortcuts.**
  Packed with `--shortcuts Startup`, Setup.exe puts a shortcut to the watcher in the pilot's own Startup folder, `FOLDERID_Startup`, which starts it at login for that account alone (read in `src/bins/src/windows/shortcuts.rs` and `known_path.rs`, `get_startup`).
  The watcher's setting to start with Windows adds or deletes that shortcut, and an update doesn't put back one the watcher deleted (read in `shortcuts.rs`).
  Velopack makes shortcuts only to its main program, so the watcher's install hook adds a Start-menu shortcut to the desktop app, which starts a core when none runs ([the watcher and the desktop app](../architecture/01-spine.md#the-watcher-and-the-desktop-app)).
  That shortcut is the way back into Crosscheck after the tray's Quit, and the watcher itself stays quit until the next login.
- **WebView2.**
  Packed with `--framework webview2`, Setup.exe looks for the runtime, and where it's missing asks the pilot in a dialog of its own, then runs Microsoft's bootstrapper without elevation (read in `src/bins/src/windows/prerequisite.rs`, `prompt_and_install_all_missing`, and `runtimes.rs`), which installs the runtime for the pilot alone unless a per-machine Edge updater replaces it (documented, [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)); such a PC needs the internet at install.
- **Downloads.**
  The `velopack` crate in the watcher downloads each release and checks its size and SHA-256 against the release's feed (read in `src/lib-rust/src/manager.rs`, `verify_package_checksum`).
  It downloads deltas whenever it holds the package of the release it's updating from, falls back to the whole release when a delta fails, and has Update.exe apply the deltas (same file, `download_updates`).
  The watcher reads the feed through Velopack's `HttpSource` at `https://github.com/<org>/crosscheck/releases/latest/download/`, which takes no call to GitHub's API; whether `HttpSource` follows GitHub's redirect there is unverified, and a desk case settles it.
  If it doesn't, the watcher uses `GithubSource`, which GitHub's API limits to 60 calls an hour from one address and which sees only the newest 10 releases (read in `src/lib-rust/src/sources/github.rs`).
- **Only the watcher applies, and only by its own checks.**
  `VelopackApp::build().run()` applies a downloaded update as the program that calls it starts, unless auto-apply is turned off (read in `src/lib-rust/src/app.rs`, `set_auto_apply_on_startup`, "ON by default"), so the watcher calls it with auto-apply off, and the core and the desktop app link no Velopack.
  The watcher applies only when [what holds an update back](#what-holds-an-update-back) clears, since Update.exe force-kills every process running from its folder but itself before it swaps (read in `src/bins/src/shared/util_windows.rs`, `force_stop_package`).
- **Its costs.**
  CI needs the .NET 8 SDK to run `vpk`, and nothing of .NET reaches the pilot.

Tauri's NSIS installer in its per-user mode would also install with no prompt and keep its folder, but its updater needs a Tauri app's handle, so the watcher would carry an update client of our own, and the installer stops only the desktop app's program before it writes (read in tauri-plugin-updater 2.14.0, `plugins/updater/src/updater.rs`, and tauri-bundler 2.10.3, `installer.nsi`).
An MSI installed per machine prompts for an administrator at every update, and an installer and updater of our own would be all ours to write, the swap's failures among them.

## On disk

| What | Where |
| --- | --- |
| The programs, and the copy of our package the watcher writes from | `%LOCALAPPDATA%\Crosscheck\current\` |
| Velopack's downloads | `%LOCALAPPDATA%\Crosscheck\packages\` |
| The core's data folder | `%APPDATA%\Crosscheck\` |
| The watcher's own files: `update.json`, the version of our package it last wrote into each packages folder, the hash its BlurPage copy came from, the last Store install folder it saw, and its figures | `%APPDATA%\Crosscheck\watcher\` |
| Our package | `Community` in each packages folder ([the packages folders](#the-packages-folders)) |
| Our package while the watcher builds it, and packages turned off | `Crosscheck\` in each packages folder, beside `Community` |

- The data folder sits outside Velopack's folder, whose contents an uninstall deletes (read in `src/bins/src/commands/uninstall.rs`).
  It sits in `%APPDATA%`, the folder the sim's Steam edition keeps its own packages in (read on our development machine, 2026-10-18, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)).
- Our package goes in `Community`, where FS Copilot's, YourControls', and FlyByWire's installers put theirs ([prior installers](results/2026-10-18-prior-installers.txt); [installer frameworks](results/2026-10-18-installer-frameworks.txt)), though the SDK names `Community2024` for packages only MSFS 2024 runs (documented, [Virtual File System Information](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Virtual_File_System_Information.htm)).
- A development core with a data folder of its own keeps everything there ([finding the core](../architecture/01-spine.md#finding-the-core)).

## The packages folders

- The watcher and the sim service each find the sim's packages folders from the `InstalledPackagesPath` line of each `UserCfg.opt` they find: Steam's in `%APPDATA%\Microsoft Flight Simulator 2024\`, and the Microsoft Store's in `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\`, which no run of ours has seen ([02-01](../../learn/foundations/02-01-installs-and-packages.md)).
  They match the line by its name and a space, `InstalledPackagesPath `, as FlyByWire's installer does, so a longer name such as `InstalledPackagesPathNextBoot` doesn't match (read in flybywiresim/installer v3.7.2, `src/renderer/actions/install-path.utils.tsx`).
- Every packages folder found gets our package, so a PC with both editions has it in each.
- Neither program asks the pilot for a folder: the sim "will only look at this file to determine where the Official and Community folders are" (documented, [Virtual File System Information](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Virtual_File_System_Information.htm)), so a folder the pilot names before the sim has written one may not be the sim's.
  A pilot who installs Crosscheck before the sim's first run gets our package when that run closes, provided the run writes `UserCfg.opt` (unverified; a first run on a fresh install settles it).
- The sim service gives the session crate the packages folders for its search for an aircraft's package ([the match check](../session/02-units.md#the-match-check)), so one unit reads `UserCfg.opt` in the core.

## The watcher between runs of the sim

### Noticing the sim

- Every 2s, while it holds no sim process, the watcher walks a `CreateToolhelp32Snapshot` for `FlightSimulator2024.exe`, ignoring case, as the core's edge does ([the sim's process](../core/03-sim-seam-and-wasm-module.md#the-sims-process)).
  A walk took 2.8ms from PowerShell, with 291 processes running (measured on our development machine, 2026-10-18, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)), about 0.14% of one core at one walk every 2s.
- On finding it, the watcher opens the process with `SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION` and waits on it for its exit: a program with no administrator opened another of the pilot's processes that way, and a wait on a process it started returned when that process exited, with its exit code (same entry).
  That the Store edition's process has the same name, and opens the same way, is unverified ([cases in the sim](#cases-in-the-sim)).
- WMI's `Win32_ProcessStartTrace` refused a program with no administrator (measured, same entry), and its `__InstanceCreationEvent` polls at the interval its `WITHIN` sets (documented, [WITHIN](https://learn.microsoft.com/en-us/windows/win32/wmisdk/within-clause)), most likely walking the same list inside WMI's own process (inference).

### Starting the core

- When the watcher finds the sim, or starts with the sim already running, it starts `current\crosscheck-core.exe` unless the port file names a core that runs, matched by its process ID and creation time ([finding the core](../architecture/01-spine.md#finding-the-core)).
  The watcher can start after the sim, because Windows "does not provide guarantees about how promptly the programs in the Run key are run" and may delay the Startup group too (documented, [Run and RunOnce](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys)).
- It waits on whichever core the port file names, whoever started it.
  When that core exits with a code other than 0 while the sim runs, the watcher starts a core again 2s later; after an exit with 0, which means the core chose to stop ([exiting](../core/01-loop-and-edge.md#exiting)), it starts none.

### The tray's quit

- The tray's Quit ends the watcher and asks the core to quit.
- It posts the core a message the core registers with `RegisterWindowMessageW`, to the top-level window of the process the port file names, the window Windows' end of the pilot's session already reaches ([quitting](../core/01-loop-and-edge.md#quitting)).
- The core's window procedure pushes the same quit, which the session crate runs as a Leave before the core exits ([joining and leaving](../session/02-units.md#joining-and-leaving)).

## Updates

### When the watcher checks

- At its start, each time the sim closes, every 3 hours, and on Check now.
- The check as the sim closes is the one a refused join leans on, since the join check tells the pilot who is behind to close the sim ([installing and updating](../product/03-v1-scope.md#installing-and-updating)).
- A check that finds a newer release downloads it at once, while the sim runs too.

### What holds an update back

A downloaded update applies once all of these hold:

1. The sim is closed.
2. No session file exists ([the session file](../session/02-units.md#the-session-file)).
3. No program runs from `current\` but the watcher, since Update.exe kills any that does.

- The core exits on its own once the sim has closed, no session is held, and no desktop app is connected ([joining and leaving](../session/02-units.md#joining-and-leaving)), so an open desktop app holds the core, and the core holds the update.
- While an update is ready and the sim is closed, each of the watcher's 2s walks also looks for our programs, matching each one's path with `QueryFullProcessImageNameW`, as Update.exe does, and the update applies at the first walk that finds none.
- The watcher then calls `wait_exit_then_apply_updates` with `restart` set, and exits; Update.exe swaps `current\` and starts the new watcher (read in velopack 1.2.161, `src/lib-rust/src/manager.rs` and `src/bins/src/commands/apply.rs`), which writes our package ([our package](#our-package)).
- A host alone in a session before preflight ends keeps it through the sim's close ([in the flight](../session/02-units.md#in-the-flight)), so a host who is behind has their update held by the session, as the update file says, and leaves the session first.

### The watcher's update file

The watcher writes `watcher\update.json` on each change:

| State | With it |
| --- | --- |
| Checking | |
| Downloading | The version, and the bytes done of the total |
| Up to date | When it last checked, in UTC |
| Ready | The version, and what holds it back: the sim, a session, or a program of ours |
| Failed | Whether the check or the download failed, the error, and when |

- The file also holds the watcher's process ID and creation time.
- The core's edge pushes the file's bytes as an input as the core starts and whenever the file changes.
  It also waits on the process the file names, matched by its creation time, as the sim edge waits on the sim's, and pushes that process's exit.
  The session crate puts the state in its slice, as "not running" once the watcher's process has exited.
  So a pilot who opens the desktop app while a check runs sees the check, and has no reason to end our programs to start one.
- When a check ran is wall-clock time, which the spine allows where a person reads it ([times](../architecture/01-spine.md#times)).
- This adds a link, the core reading a file the watcher writes, where decision 015 has the watcher send the core nothing; every link still ends at the core ([decision 008](../../decisions/008-every-link-ends-at-core.md)).

### Install now and Check now

- Both are the session crate's commands, since the session crate owns quitting and decides when the core exits, and each refuses while the watcher isn't running.
- Each request is a random ID the session crate draws with `cx.new_id()` into `watcher-requests.json` beside the port file, one field for each command, so the file has one writer.
  The watcher takes a request when its ID changes while the watcher runs, and treats the IDs it finds at its start as taken, so an old request never fires late.
- **Install now** refuses unless an update is ready, and while the sim runs or a session is held, which the pilot ends first.
  Otherwise it writes its request and quits: the core sends `bye` and exits with 0 ([exiting](../core/01-loop-and-edge.md#exiting)).
  The desktop app closes itself on the `bye` that follows its own Install now.
  Once nothing holds the update, the watcher that took the request passes an argument to the new watcher through `wait_exit_then_apply_updates`' `restart_args`, and a watcher started with it starts the desktop app.
- **Check now** writes its request, and the watcher checks at once.
- The watcher watches the data folder for that file's changes.

### No warning early in the sim's load

The warning that a waiting update needs a sim restart, which [installing and updating](../product/03-v1-scope.md#installing-and-updating) has a Windows notification give early in the sim's load, is out of v1 (user, 2026-10-18).

- Microsoft gives Focus assist's default as "to activate automatically when you're duplicating your display, playing a game, or using an app in full screen mode" (documented, [Focus](https://support.microsoft.com/en-us/windows/turn-off-notifications-in-windows-during-certain-times-81ed1b25-809b-741d-549c-7696474d15d3)), and while Do Not Disturb is on, other apps' banners "are sent directly to the notification center" (documented, [Notifications and Do Not Disturb](https://support.microsoft.com/en-us/windows/experience/notifications-and-do-not-disturb-in-windows)); that the same default holds for Do Not Disturb on Windows 11 25H2 is unverified.
- On Windows 11 a tray balloon that times out "will not be displayed in the Notification Center" (documented, [Shell_NotifyIconW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shell_notifyiconw)).
- An update waits at a sim start only when the sim started before its download finished, or a session or a desktop app held it, and the join check names the fix.
- So the core writes no date of the pilot's last session, which decision 015 has the watcher read for that warning alone.

## Our package

- At its start and each time the sim closes, the watcher writes our package from `current\` into each packages folder's `Community` where the version it last wrote there isn't its own; it keeps those versions in its own files.
  Its first run after Setup.exe forgets them, so an install, and a reinstall, write every packages folder.
- It builds the new copy in `Crosscheck\` beside `Community`, makes its BlurPage copy there ([decision 003](../../decisions/003-watcher-keeps-blurpage-copy-current.md)), renames the old copy out of `Community` and the new one in, and deletes the old one.
  - A copy built inside `Community` would most likely mount as a second package, since the sim's `Content.xml` names each folder there by its name, suffixes included (read on our development machine, 2026-10-18; unverified by a run).
  - Our FS Copilot exerciser's sync of a new build into its own folder, while it ran, "deleted 349 of 355 files" before it reached one in use, and its fix "stages then swaps rather than deleting first" (FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-19 — The exerciser leaves the tree, and takes four compile-time couplings with it").
  - Before it deletes a folder, the watcher checks whether it's a junction and removes only the link, since fsc-editor found two packages in our Community folder that were junctions to folders under `Program Files` (read in fsc-editor, `src/main/sim/install.ts`, `removeEntry`).
- The watcher doesn't watch `Community` or put our package back between versions (user, 2026-10-18): a package a mod or the pilot breaks stays broken until the next update or a reinstall, and [the sim service's check](#our-own-package) tells the pilot.
- **The BlurPage copy** follows [decision 003](../../decisions/003-watcher-keeps-blurpage-copy-current.md): while the sim is closed, the watcher watches the sim's `fs-base-ui\cookedcomps\` and makes the copy again in our package when the file's hash differs from the one the copy came from.
  - On Steam it finds `fs-base-ui` under the library that `appmanifest_2537590.acf` names, in `steamapps\common\Limitless\Packages`, which only Steam's update of 2026-10-14 had rewritten, while the sim's boots on 2026-10-16 wrote nothing there (read on our development machine, 2026-10-18, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)).
  - The Store edition's folder carries the sim's version in its name, `WindowsApps\Microsoft.Limitless_<version>_x64__8wekyb3d8bbwe` (documented in pilots' posts of Windows' crash events, same file), so the watcher takes it from the running sim's path and keeps the last one it saw; whether a program can read it is unverified, and without the copy Go to is unavailable and says why, as decision 003 accepts.

## Turning a package off

- The sim service registers two settings: the other packages the pilot turned off, by folder name, and whether our own package is on.
- The watcher reads them from `settings.json` ([what a unit registers and calls](../core/02-clients-and-panel-bridge.md#what-a-unit-registers-and-calls)), a file the core writes, as decision 015 has the watcher read the core's files.
- While the sim is closed, it moves each package turned off from `Community` to `Crosscheck\disabled\` beside it, a rename on the same drive, and each one turned on again back; a junction moves as itself.
- It never renames onto a folder that exists, so a package that another program installed again while it was off stays in `Community`, and the sim service shows it as on.
  FS Copilot's app installs its package again whenever it finds it missing (read in the FS Copilot fork, `FsCopilot/Installer.cs`, `RequiresBridgeInstallation`).
- Our own package moves the same way, and an update writes it wherever it sits, so turning it on again brings the current version.
- The sim service shows where each package sits, so the apps tell a package that goes off when the sim closes from one that's off.
- Moving a folder changes none of the package's files, so [decision 001](../../decisions/001-changing-other-developers-packages.md), under which Crosscheck's own features never change another developer's package, stands: the pilot asks for the move, for a package whose `VCockpit.js` beats ours.
- Whether the sim mounts a folder beside `Community` is unverified, though it finds its folders through `UserCfg.opt`'s "the Official and Community folders" (documented, [Virtual File System Information](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Virtual_File_System_Information.htm)), and a sim run settles it ([cases in the sim](#cases-in-the-sim)).

## The checks in the core

### Packages that override our files

- At the core's start, and each time sim awareness finds the sim's process, the sim service searches, in a job, each other package's `layout.json` in each `Community` folder for the paths our package lists outside our own folders: `html_ui/Pages/VCockpit/Core/VCockpit.js`, and BlurPage's `cookedcomps/{8B92BB9A-4176-4F1A-A9CE-CB1195C4E952}.html` and its `.json`.
- It skips a package that the profile's `Content.xml`, under `%APPDATA%\Microsoft Flight Simulator 2024\`, marks `UserDisabled`; that file names each package `communityfs24-` or `communityfs20-` and its folder's name, lowercased (read on our development machine, 2026-10-18, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)).
- Each package it finds raises a warning notice naming it, and the session crate's match check shows the list as one item, from the sim service's state.
- Of two packages with the same order hint that override one file, the one mounted later wins, in alphabetical order (documented, [Virtual File System Information](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Virtual_File_System_Information.htm)), and which copy won shows when the pages that need it say hello or don't: the panel bridge within 10s of the profile loading ([trouble](../interface/01-apps.md#trouble)), and the menu script, without which Go to is unavailable ([go to](../session/02-units.md#go-to)).

### Our own package

- In the same search, the sim service checks our package in each `Community` folder: that it's there, that its `manifest.json`'s `package_version` is the core's version, and that `Content.xml` doesn't mark it `UserDisabled`.
- Otherwise it raises a trouble notice, unless the pilot turned our package off.
- So a package that's missing, out of date, or off in the sim shows before any session, where the EFB app and the banner never connecting goes only to the log ([trouble](../interface/01-apps.md#trouble)).

## The firewall rule

- The watcher owns the rule, because "The Netsh advfirewall command requires administrator permissions to run" (documented, [the Windows 8.1 answer-file page](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-8.1-and-8/hh825692(v=win.10)); no add was tried without one), and a pilot who isn't an administrator, prompted when a program first listens, gets block rules "It doesn't matter what option is selected", which win over allow rules (documented, [Windows Firewall rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)).
  Our machine holds that pair of block rules, TCP and UDP, for FS Copilot's `fscopilot.exe`, with no allow rule (read on our development machine, 2026-10-18, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)).
- On its first run after the install, before it starts any core, the watcher runs itself with the `runas` verb, which shows one UAC prompt, and that copy adds an inbound rule allowing UDP to `current\crosscheck-core.exe`, written as its full path, on every network profile, and deletes every block rule naming that path, comparing paths without regard to letter case, as [the way through home routers](../network/01-between-machines.md#the-way-through-home-routers) requires.
- At each of its starts, the watcher reads the rules, which a program with no administrator did (measured on our development machine, 2026-10-18, same file), and while the rule is missing or a block rule names the core, its tray offers the same fix.
- An update keeps the core's path, so the rule should keep matching it, which a desk case checks.
- Velopack's hooks "may not show any UI" (documented, [Velopack's hooks](https://docs.velopack.io/integrating/hooks)), so the uninstall hook tries no prompt, whether or not one would work there (unverified), and the rule stays behind, naming a path that no longer exists, which a reinstall's core has again.
- Whether the core's UDP socket raises Windows' prompt at all, when no rule names it, is unverified (same file).

## Uninstalling

- The watcher's uninstall hook runs with no UI, and Velopack kills it after 30s, by its docs, where its source passes 60s (documented, [Velopack's hooks](https://docs.velopack.io/integrating/hooks); read in velopack 1.2.161, `src/bins/src/commands/uninstall.rs`).
- Velopack runs the hook before it stops our programs, so the hook first posts the quit to the core's window, and the same kind of message to the running watcher's window, and waits for both to exit.
- It then moves each package in `Crosscheck\disabled\` back into `Community`, deletes our package and the `Crosscheck\` folder beside each `Community`, deletes the Start-menu shortcut it added, and deletes the data folder.
- Velopack then deletes the programs, the Startup shortcut, and its entry in the pilot's list of installed programs (same file).
- The firewall rule stays, as [the firewall rule](#the-firewall-rule) says.

## An unsigned v1

v1 ships unsigned, as [installing and updating](../product/03-v1-scope.md#installing-and-updating) leaves code signing out (user, 2026-10-18), at two costs:

- On a PC whose Smart App Control enforces, a release of ours runs only once it has a positive reputation, since Smart App Control "will block execution of unsigned files unless the file has a positive reputation" and its checks "apply to all executable files, not just those downloaded from the Internet" (documented, [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)), and "There is currently no way to bypass Smart App Control protection for individual apps" (documented, [its FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)).
  Each unsigned release starts "with zero reputation" (same page), so until a release has one, the pilot turns Smart App Control off for the whole PC; in its evaluation mode it blocks nothing.
  How many pilots run it is unknown, and some MSFS pilots found it blocking the sim's own `CoherentGTCore.dll` (an MSFS forum thread, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)).
- SmartScreen shows "Windows protected your PC" at the first install, and the pilot chooses "Run anyway" (documented, [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)).
  The watcher's downloads carry no mark of the web, so SmartScreen likely never checks an update (unverified), while Smart App Control checks every program it runs.

Velopack trusts the feed through HTTPS and the GitHub account that publishes it, since it checks a download's hash against the feed and no publisher's signature (read in velopack 1.2.161, `src/lib-rust/src/manager.rs`, `verify_package_checksum`).

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures.

| What | Budget |
| --- | --- |
| The watcher, with the sim closed | Under 5 MB of private working set, and under 0.2% of one CPU core |
| The core starting | Within 3s of the sim's process appearing |
| A core that crashed | Started again within 3s of its exit |
| An update with nothing holding it | Applied, and the new watcher running, within 30s of the last thing holding it going away |
| The update file | In the session's slice within 2s of the watcher writing it |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with a program named `FlightSimulator2024.exe` standing in for the sim's process:

- The stand-in starts, and the watcher starts a core; the watcher starts with the stand-in already running, and starts one too.
- The core exits with 1 while the stand-in runs, and the watcher starts it again; it exits with 0, and the watcher starts none; it crashes before it writes the port file, and the watcher starts it again.
- An update is downloaded and the watcher starts with the stand-in running: the update stays pending.
- An update downloads while the stand-in runs: the update file says the sim holds it; the stand-in ends, the core exits, the update applies, and the new watcher writes our package.
- A session file, or an open desktop app, holds a downloaded update, and the update file names it.
- A host who is behind, alone in a session with the stand-in ended: the update file says the session holds the update, and it applies once they leave.
- Install now refuses while the stand-in runs, while a session is held, and while the watcher isn't running; otherwise the core quits, the desktop app closes, the update applies after whichever of the two comes last, and the desktop app opens again.
- A core that starts while an update is ready shows it, and shows "not running" once the watcher exits.
- Check now: the update file goes through checking to up to date, and to failed with the error while the network is cut; a Check now from a core that has restarted is taken.
- The tray's Quit in a session: the other core sees a leave, and the core exits with 0.
- A package turned off moves beside `Community` only once the stand-in ends, and back when it's turned on; with the desktop app holding the core, the sim service's slice shows it off once it has moved; a package put back in `Community` while it was off stays, shown as on; uninstall puts it back.
- Our package removed, or at another version: the sim service's trouble notice; our package turned off by the pilot: none.
- An install with the stand-in running, then a restart before it ends: our package is written once it ends.
- A package whose `layout.json` lists `html_ui/Pages/VCockpit/Core/VCockpit.js`: a warning naming it, and the match check's item; the same package marked `UserDisabled`: neither.
- Uninstalling with the core running: the core quits first, and the data folder goes.

### Cases on a desk

These need no sim:

- After a Velopack update, the firewall rule still matches `current\crosscheck-core.exe`, and Update.exe killed only what ran from its folder.
- On a Windows 10 PC without WebView2, Setup.exe's dialog leads to a per-user install with no UAC prompt.
- The Startup shortcut starts the watcher at login, and the watcher's setting removes it.
- Velopack's `HttpSource` reads the feed through `releases/latest/download/`.

### Cases in the sim

- A package moved to `Crosscheck\disabled\` beside `Community` doesn't mount.
- Uninstalling while the sim runs: which of our package's files the sim holds, and what the hook leaves.
- On a PC with no rule naming the core's path, whether the core's UDP socket raises Windows' firewall prompt.
- A fresh install of the sim: whether its first run writes `UserCfg.opt`.
- The Store edition, on a pilot's PC: its process's name and whether the watcher opens it, where its `UserCfg.opt` and `Content.xml` are, and whether a program reads its install folder and `fs-base-ui`.

## Left open

- Our package's folder name, which sets its place in the mount order among packages with the same order hint, and so whether our `VCockpit.js` or another's wins, and whether our WASM module needs a package of its own, as [code in the sim](../architecture/01-spine.md#code-in-the-sim) has it until two modules in one package are tried: [6.18](../architecture/plan.md#618-the-build)'s.
- A sim started in the seconds Update.exe takes to swap `current\` boots with the old package beside a new core, whose module then differs from the core and raises its trouble notice until the sim closes; nothing guards against it.

## Left to the apps' stage

These wait for the apps' stage of step 8, with [the apps' list](../interface/01-apps.md#left-to-the-apps-stage):

- The watcher's tray, and its window with the 24 hours of figures and what quitting costs, how often it samples them, and its words.
- How the watcher's setting to start with Windows follows Windows' own switch for its Startup shortcut, which Settings and Task Manager keep under `StartupApproved` (read on our development machine, 2026-10-18, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)).
- How the apps show the update's states, Install now, and Check now, and what Install now says when it refuses.
- How the watcher offers the firewall fix, and what it shows while no `UserCfg.opt` exists.
- The words of each override warning, the match check's item, our package's trouble notice, and the join check's refusal when the host is the one behind, which tells them to leave the session first.

## What this changes elsewhere

The notes at the top of [the spine](../architecture/01-spine.md), [the code map](../architecture/02-code-map.md), [03-v1-scope](../product/03-v1-scope.md#installing-and-updating), [01-between-machines](../network/01-between-machines.md), [01-loop-and-edge](../core/01-loop-and-edge.md), [03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md), [the session's units](../session/02-units.md), and [the apps](../interface/01-apps.md) list what this design changes there, and the [tentative decisions](../architecture/decisions.md#velopack-installs-and-updates-crosscheck-per-user-with-the-watcher-as-velopacks-main-program) give the reasons.
