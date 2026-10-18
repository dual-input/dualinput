# Installing and updating

```text
Purpose:     How Crosscheck reaches a pilot's PC and stays current, and what the watcher does between runs of the sim.
Depends on:  ../product/03-v1-scope.md, ../architecture/01-spine.md, ../architecture/02-code-map.md, ../core/01-loop-and-edge.md, ../core/03-sim-seam-and-wasm-module.md, ../session/02-units.md, ../interface/01-apps.md, log.md
Decides:     What installs and updates Crosscheck; where it lives on disk; when the watcher checks for an update and when one applies; how the apps learn of an update and ask for a check or an install; when our Community package is written; how the watcher notices the sim, starts the core again, and quits it; who adds and checks the firewall rule; how the core finds packages that override our files and checks our own; how a package is turned off; what uninstalling removes; and what an unsigned v1 costs (node 6.17).
```

Velopack installs Crosscheck for the pilot's own account and updates it, with the watcher as its main program, so no update asks for an administrator, and every program keeps one path from release to release.
The watcher applies an update only while the sim is closed, no session is held, and no other program of ours runs, and it writes our Community package once for each version.
It tells the core what its updating is doing through a file the core reads, and the core passes on the pilot's Install now and Check now through a file the watcher reads, so the apps show a check, a download, and what holds an update back.
The watcher's tray quits the core through the window the core already has for Windows' end of session, and the watcher alone adds the firewall rule, with one UAC prompt on its first run.

This answers node 6.17 of the [architecture plan](../architecture/plan.md#617-installing-and-updating).
[Installing and updating](../product/03-v1-scope.md#installing-and-updating), decisions [002](../../decisions/002-core-starts-with-every-sim-run.md), [003](../../decisions/003-watcher-keeps-blurpage-copy-current.md), and [015](../../decisions/015-watcher-reads-files-core-writes.md), and the spine's [watcher and desktop app](../architecture/01-spine.md#the-watcher-and-the-desktop-app) give the rules this design builds on, and this document holds only what they leave out.
The research behind it is in this area's [log](log.md).

## The units

| Unit | Holds |
| --- | --- |
| Velopack's Setup.exe and Update.exe | The installer and the swap of one release's programs for the next, which aren't programs of ours ([the installer and the updater](#the-installer-and-the-updater)) |
| `apps/watcher` | Velopack's main program: noticing the sim, starting the core and starting it again, checking for, downloading, and applying updates, writing our Community package and its BlurPage copy, the firewall rule, moving packages out of Community and back, its tray, and its 24 hours of figures |
| `session` | The update's slice, from the watcher's file, and Install now and Check now, which it passes to the watcher through the core's file |
| `sim-service` | The packages folders, the search for packages that override our files, the check of our own package, and the settings that turn a package off |
| `apps/core` | The edge's watch on the watcher's file, and the core's window, which takes the tray's quit |

## The installer and the updater

Velopack is a per-user installer, Setup.exe; an updater, Update.exe; a Rust crate, `velopack`, that the watcher links; and `vpk`, a .NET tool that packs a release (read in velopack 1.2.161, [installer frameworks](results/2026-10-18-installer-frameworks.txt)).
It's MIT-licensed, and its 1.x line began on 2026-05-26.

- **Per-user, one path.**
  Setup.exe installs to `%LOCALAPPDATA%\Crosscheck\` with no administrator prompt, and an update replaces the `current\` folder there by two renames, so `current\crosscheck-core.exe` keeps its path from release to release (read in velopack 1.2.161, `src/bins/src/setup.rs` and `src/bins/src/commands/apply_windows_impl.rs`).
  The firewall rule names that path, and the tray icon's registration names the watcher's path, which only programs signed by one company may change (documented, [NOTIFYICONDATA](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ns-shellapi-notifyicondataw)).
- **One release, four programs.**
  The watcher is Velopack's main program, and the core, the core helper, the desktop app, and our Community package ride beside it in `current\`, so the core starts the core helper and the desktop app from its own folder, as [the helper's life](../core/04-core-helper.md#the-helpers-life) and [bringing the desktop app forward](../interface/01-apps.md#bringing-the-desktop-app-forward) need.
  The desktop app builds with `tauri build --no-bundle`, so Tauri makes no installer of its own (documented, [Tauri's CLI](https://v2.tauri.app/reference/cli/)).
- **At login.**
  Setup.exe puts a shortcut to the watcher in the pilot's own Startup folder, which starts it at login for that account alone (read in `src/bins/src/windows/shortcuts.rs`).
- **WebView2.**
  Where it's missing, Setup.exe runs Microsoft's bootstrapper without elevation, which installs the runtime for the pilot alone (read in `src/bins/src/windows/webview2.rs`; documented, [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)), so such a PC needs the internet at install.
- **Downloads.**
  Update.exe applies a delta when it's smaller than the whole release, and checks each download's size and SHA-256 against the release's feed (read in `src/lib-rust/src/manager.rs`).
  The watcher reads the feed from the newest release's assets, through `https://github.com/<org>/crosscheck/releases/latest/download/`, which takes no call to GitHub's API; that Velopack's `HttpSource` follows GitHub's redirect there is unverified, and its `GithubSource` is the fallback, which GitHub's API limits to 60 calls an hour from one address and which sees only the newest 10 releases (read in `src/lib-rust/src/sources/github.rs`).
- **Only the watcher applies.**
  `VelopackApp::build().run()` applies a downloaded update when the program that calls it starts, unless told not to, so only the watcher calls it, and the core and the desktop app link no Velopack.
  Update.exe force-kills every process running from its folder but itself before it swaps (read in `src/bins/src/shared/util_windows.rs`, `force_stop_package`), so the watcher applies only when none of ours runs ([what holds an update back](#what-holds-an-update-back)).
- **Its costs.**
  CI needs the .NET 8 SDK to run `vpk`, and nothing of .NET reaches the pilot.

Tauri's NSIS installer in its per-user mode would also install with no prompt and keep its folder, but its updater needs a Tauri app's handle, so the watcher would carry an update client of our own, and the installer stops only the desktop app's program before it writes (read in tauri-plugin-updater 2.14.0, `plugins/updater/src/updater.rs`, and tauri-bundler 2.10.3, `installer.nsi`).
An MSI installed per machine prompts for an administrator at every update, and an installer and updater of our own would be all ours to write, the swap's failures among them.

## On disk

| What | Where |
| --- | --- |
| The programs, and the copy of our package that the watcher writes from | `%LOCALAPPDATA%\Crosscheck\current\` |
| Velopack's downloads | `%LOCALAPPDATA%\Crosscheck\packages\` |
| The core's data folder | `%APPDATA%\Crosscheck\` |
| The watcher's own files: its update file, its settings, the requests it has taken, and its figures | `%APPDATA%\Crosscheck\watcher\` |
| Our package | `Community` in each packages folder ([the packages folders](#the-packages-folders)) |
| Our package while the watcher builds it, and packages turned off | `Crosscheck\` in each packages folder, beside `Community` |

- The data folder sits outside Velopack's folder, whose contents an uninstall deletes (read in `src/bins/src/commands/uninstall.rs`), and in `%APPDATA%`, where the sim's Steam edition keeps its own packages folder (read on our development machine, 2026-10-18, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)).
- Our package goes in `Community`, where FS Copilot's, YourControls', and FlyByWire's installers put theirs ([prior installers](results/2026-10-18-prior-installers.txt); [installer frameworks](results/2026-10-18-installer-frameworks.txt)), though the SDK names `Community2024` for packages only MSFS 2024 runs (documented, [Virtual File System Information](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Virtual_File_System_Information.htm)).
- A development core with a data folder of its own keeps everything there ([finding the core](../architecture/01-spine.md#finding-the-core)).

## The packages folders

- The watcher and the sim service each find the sim's packages folders from the `InstalledPackagesPath` line of each `UserCfg.opt` they find, Steam's in `%APPDATA%\Microsoft Flight Simulator 2024\` and the Microsoft Store's in `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\` ([02-01](../../learn/foundations/02-01-installs-and-packages.md)), taking the line whose name is exactly `InstalledPackagesPath`, as FlyByWire's installer does (read in flybywiresim/installer v3.7.2, `src/renderer/actions/install-path.utils.tsx`).
- Every packages folder found gets our package, so a PC with both editions has it in each.
- Neither program asks the pilot for a folder: the sim "will only look at this file to determine where the Official and Community folders are" (documented, [Virtual File System Information](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Virtual_File_System_Information.htm)), so a folder the pilot names before the sim has written one may not be the sim's.
  A pilot who installs Crosscheck before the sim's first run gets our package when that run closes.
- The sim service gives the session crate the packages folders for its search for an aircraft's package ([the match check](../session/02-units.md#the-match-check)), so one unit reads `UserCfg.opt` in the core.

## The watcher between runs of the sim

### Noticing the sim

- Every 2s, while it holds no sim process, the watcher walks a `CreateToolhelp32Snapshot` for `FlightSimulator2024.exe`, ignoring case, as the core's edge does ([the sim's process](../core/03-sim-seam-and-wasm-module.md#the-sims-process)).
  A walk took 2.8ms from PowerShell, with 291 processes running (measured on our development machine, 2026-10-18, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)), about 0.14% of one core at one walk every 2s.
- On finding it, the watcher opens the process with `SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION` and waits on it for its exit, which a program with no administrator could do on another of the pilot's processes (same entry).
- WMI's `Win32_ProcessStartTrace` refused a program with no administrator, and its `__InstanceCreationEvent` walks the same list inside WMI's own process (measured and documented, same entry).

### Starting the core

- When the watcher finds the sim, or starts with the sim already running, it starts `current\crosscheck-core.exe` unless the port file names a core that runs, matched by its process ID and creation time ([finding the core](../architecture/01-spine.md#finding-the-core)).
  The watcher can start after the sim, because Windows "does not provide guarantees about how promptly the programs in the Run key are run" and may delay the Startup group too (documented, [Run and RunOnce](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys)).
- It waits on whichever core the port file names, whoever started it, and when that core exits with a code other than 0 while the sim runs, it starts a core again 2s later, as the core helper service starts the helper again ([the helper's life](../core/04-core-helper.md#the-helpers-life)); a core that exits with 0 meant to ([exiting](../core/01-loop-and-edge.md#exiting)).
- A core the watcher starts beside one the desktop app starts exits, since the first holds the data folder's mutex ([starting and stopping](../core/01-loop-and-edge.md#starting-and-stopping)).

### The tray's quit

- The tray's Quit ends the watcher and asks the core to quit.
- It posts the core a message the core registers with `RegisterWindowMessageW`, to the top-level window of the process the port file names, the window Windows' end of the pilot's session already reaches ([quitting](../core/01-loop-and-edge.md#quitting)).
- The core's window procedure pushes the same quit, which the session crate runs as a Leave before the core exits ([joining and leaving](../session/02-units.md#joining-and-leaving)).
- Whether to quit, asked once with Quit and Keep running given equal weight, is [installing and updating](../product/03-v1-scope.md#installing-and-updating)'s rule.

### Its own files

- The watcher's setting to start with Windows is its Startup shortcut, whose state Windows' Settings and Task Manager keep under `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder`, an undocumented value in which a first byte of `02` meant on and `03` off on our machine (read on our development machine, 2026-10-18, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)), so the watcher reads the pilot's choice wherever they made it.
- It samples its own CPU and memory, and the core's by the port file's process ID, once a minute, a starting value, and keeps 24 hours of samples in its own files.

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

The core exits on its own once the sim has closed, no session is held, and no desktop app is connected ([joining and leaving](../session/02-units.md#joining-and-leaving)), so an open desktop app holds the core, and the core holds the update.
The watcher then calls `wait_exit_then_apply_updates` and exits, and Update.exe swaps `current\` and starts the new watcher (read in velopack 1.2.161, `src/lib-rust/src/manager.rs`), which writes our package ([our package](#our-package)).

### The watcher's update file

The watcher writes `watcher\update.json` on each change:

| State | With it |
| --- | --- |
| Checking | |
| Downloading | The version, and the bytes done of the total |
| Up to date | When it last checked, in UTC |
| Ready | The version, and what holds it back: the sim, a session, or a program of ours |
| Failed | Whether the check or the download failed, the error, and when |

- The file also holds the watcher's process ID and creation time, so the core tells a running watcher from a file left behind, as every reader of the port file tells a running core.
- The core's edge watches the file and pushes its bytes as an input when it changes, and the session crate puts it in its slice, as "not running" when the process it names has gone.
  So a pilot who opens the desktop app while a check runs sees the check, and has no reason to end our programs to start one.
- When a check ran is wall-clock time, which the spine allows where a person reads it ([times](../architecture/01-spine.md#times)).
- This adds a link, the core reading a file the watcher writes, where decision 015 has the watcher send the core nothing; every link still ends at the core ([decision 008](../../decisions/008-every-link-ends-at-core.md)).

### Install now and Check now

- Both are the session crate's commands, since the session crate owns quitting and decides when the core exits, and each refuses while the watcher isn't running.
- **Install now** refuses unless an update is ready, and while the sim runs or a session is held, which the pilot ends first.
  Otherwise it asks the watcher to open the desktop app again after the update, through `watcher-requests.json` beside the port file, and quits: the core sends `bye` and exits with 0 ([exiting](../core/01-loop-and-edge.md#exiting)).
  The desktop app closes itself on the `bye` that follows its own Install now, the watcher finds nothing holding the update and applies it, and the new watcher starts the desktop app.
- **Check now** asks the watcher for a check through the same file, and the watcher checks at once.
- Each request carries a number one higher than the last, and the watcher keeps the number of the last one it took in its own files, so each file has one writer and a request runs once.
- The watcher watches the data folder for that file's changes.

### No warning early in the sim's load

The warning that a waiting update needs a sim restart, which [installing and updating](../product/03-v1-scope.md#installing-and-updating) has a Windows notification give early in the sim's load, is out of v1 (user, 2026-10-18).

- Windows turns on Do Not Disturb by default "when you're duplicating your display, playing a game, or using an app in full screen mode", which sends other apps' banners to the notification center, and on Windows 11 a tray balloon that times out isn't kept there (documented, [Focus](https://support.microsoft.com/en-us/windows/turn-off-notifications-in-windows-during-certain-times-81ed1b25-809b-741d-549c-7696474d15d3) and [Shell_NotifyIconW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shell_notifyiconw)).
- An update waits at a sim start only when the sim started before its download finished, or a session or a desktop app held it, and the join check names the fix.
- So the core writes no date of the pilot's last session, which decision 015 has the watcher read for that warning alone.

## Our package

- The watcher writes our package from `current\` into each packages folder's `Community` once for each version: on its first run after an install or an update, or, if the sim is running then or no `UserCfg.opt` exists yet, the next time the sim closes.
- It builds the new copy in `Crosscheck\` beside `Community`, makes its BlurPage copy there ([decision 003](../../decisions/003-watcher-keeps-blurpage-copy-current.md)), renames the old copy out of `Community` and the new one in, and deletes the old one.
  - A copy built inside `Community` would most likely mount as a second package, since the sim's `Content.xml` names each folder there by its name, suffixes included (read on our development machine, 2026-10-18; unverified by a run).
  - FS Copilot's in-process copy of its own build "deleted 349 of 355 files" before it reached one in use, and its fix "stages then swaps rather than deleting first" (FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-19 — The exerciser leaves the tree, and takes four compile-time couplings with it").
  - Before it deletes a folder, the watcher checks whether it's a junction and removes only the link, since fsc-editor found two packages in our Community folder that were junctions to folders under `Program Files` (read in fsc-editor, `src/main/sim/install.ts`, `removeEntry`).
- The watcher doesn't watch `Community` or put our package back between versions (user, 2026-10-18): a package a mod or the pilot breaks stays broken until the next update, and [the sim service's check](#our-own-package) tells the pilot.
- **The BlurPage copy** follows [decision 003](../../decisions/003-watcher-keeps-blurpage-copy-current.md): while the sim is closed, the watcher watches the sim's `fs-base-ui\cookedcomps\` and makes the copy again in our package when the file's hash differs from the one the copy came from.
  - On Steam it finds `fs-base-ui` under the library that `appmanifest_2537590.acf` names, in `steamapps\common\Limitless\Packages`, which only Steam's update of 2026-10-14 had rewritten, while the sim's boots in the four days after wrote nothing there (read on our development machine, 2026-10-18, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)).
  - The Store edition's folder carries the sim's version in its name, `WindowsApps\Microsoft.Limitless_<version>_x64__8wekyb3d8bbwe` (documented in pilots' posts of Windows' crash events, same file), so the watcher takes it from the running sim's path and keeps the last one it saw; whether a program can read it is unverified, and without the copy Go to is unavailable and says why, as decision 003 accepts.

## Turning a package off

- The sim service registers two settings: the other packages the pilot turned off, by folder name, and whether our own package is on.
- The watcher reads them from `settings.json` ([what a unit registers and calls](../core/02-clients-and-panel-bridge.md#what-a-unit-registers-and-calls)), a file the core writes, as decision 015 has the watcher read the core's files.
- While the sim is closed, it moves each package turned off from `Community` to `Crosscheck\disabled\` beside it, a rename on the same drive, and each one turned on again back; a junction moves as itself.
- Our own package moves the same way, and an update writes it wherever it sits, so turning it on again brings the current version.
- The sim service shows where each package sits, so the apps tell a package that goes off when the sim closes from one that's off.
- Moving a folder changes none of the package's files, so [decision 001](../../decisions/001-changing-other-developers-packages.md), under which Crosscheck's own features never change another developer's package, stands: the pilot asks for the move, for a package whose `VCockpit.js` beats ours.
- Whether the sim mounts a folder beside `Community` is unverified, though it finds its folders through `UserCfg.opt`'s "the Official and Community folders" (documented, [Virtual File System Information](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Virtual_File_System_Information.htm)), and a sim run settles it ([cases in the sim](#cases-in-the-sim)).

## The checks in the core

### Packages that override our files

- At the core's start, and each time sim awareness finds the sim's process, the sim service searches, in a job, each other package's `layout.json` in each `Community` folder for the paths our package lists outside our own folders: `html_ui/Pages/VCockpit/Core/VCockpit.js`, and BlurPage's `cookedcomps/{8B92BB9A-4176-4F1A-A9CE-CB1195C4E952}.html` and its `.json`.
- It skips a package the sim's `Content.xml` marks `UserDisabled`, which the per-profile file under `%APPDATA%\Microsoft Flight Simulator 2024\` names `communityfs20-` or `communityfs24-` and its folder's name, lowercased (read on our development machine, 2026-10-18, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)), and one the pilot turned off that has moved.
- Each package it finds raises a warning notice naming it, and the session crate's match check shows the list as one item, from the sim service's state.
- Of two packages with the same order hint that override one file, the one mounted later wins, in alphabetical order (documented, [Virtual File System Information](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Virtual_File_System_Information.htm)), and which copy won shows when the pages that need it say hello or don't: the panel bridge within 10s of the profile loading ([trouble](../interface/01-apps.md#trouble)), and the menu script, without which Go to is unavailable ([go to](../session/02-units.md#go-to)).

### Our own package

- In the same search, the sim service checks our package in each `Community` folder: that it's there, that its `manifest.json`'s `package_version` is the core's version, and that `Content.xml` doesn't mark it `UserDisabled`.
- Otherwise it raises a trouble notice, unless the pilot turned our package off.
- So a package that's missing, out of date, or off in the sim shows before any session, where the EFB app and the banner never connecting goes only to the log ([trouble](../interface/01-apps.md#trouble)).

## The firewall rule

- The watcher owns the rule, because adding one takes an administrator, and a pilot who isn't one, prompted when a program first listens, gets block rules "It doesn't matter what option is selected", which win over allow rules (documented, [Windows Firewall rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)).
  Our machine holds that pair of block rules, TCP and UDP, for FS Copilot's `fscopilot.exe`, with no allow rule (read on our development machine, 2026-10-18, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)).
- On its first run after the install, before it starts any core, the watcher runs itself with the `runas` verb, which shows one UAC prompt, and that copy adds an inbound rule allowing UDP to `current\crosscheck-core.exe`, written as its full path, on every network profile, and deletes every block rule naming that path, comparing paths without regard to letter case, as [the way through home routers](../network/01-between-machines.md#the-way-through-home-routers) requires.
- At each of its starts, the watcher reads the rules, which a program with no administrator did (measured on our development machine, 2026-10-18, same file), and while the rule is missing or a block rule names the core, its tray offers the same fix.
- An update keeps the path, so it keeps the rule.
- Velopack's hooks "may not show any UI" (documented, [Velopack's hooks](https://docs.velopack.io/integrating/hooks)), so an uninstall leaves the rule behind, naming a path that no longer exists, which a reinstall's core has again.
- Whether the core's UDP socket raises Windows' prompt at all, when no rule names it, is unverified (same file).

## Uninstalling

- The watcher's uninstall hook, which Velopack runs with no UI and kills after 30s (documented, [Velopack's hooks](https://docs.velopack.io/integrating/hooks)), moves each package in `Crosscheck\disabled\` back into `Community`, deletes our package and the `Crosscheck\` folder beside each `Community`, and deletes the data folder.
- Velopack then deletes the programs, the Startup shortcut, and its entry in the pilot's list of installed programs (read in velopack 1.2.161, `src/bins/src/commands/uninstall.rs`).
- The firewall rule stays, as [the firewall rule](#the-firewall-rule) says.

## An unsigned v1

v1 ships unsigned, as [installing and updating](../product/03-v1-scope.md#installing-and-updating) leaves code signing out (user, 2026-10-18), at two costs:

- A pilot whose PC runs Smart App Control can't run Crosscheck until they turn it off for the whole PC, since "There is currently no way to bypass Smart App Control protection for individual apps" (documented, [its FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)), and its checks "apply to all executable files, not just those downloaded from the Internet" (documented, [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)).
  How many pilots run it is unknown, and some MSFS pilots found it blocking the sim's own `CoherentGTCore.dll` (an MSFS forum thread, [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)).
- SmartScreen shows "Windows protected your PC" at the first install, with "Run anyway" behind its More info link, and an unsigned release starts "with zero reputation" (documented, same page).
  Update.exe's downloads carry no mark of the web, so SmartScreen likely never checks an update (unverified), while Smart App Control checks every program it runs.

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

- The stand-in starts, and the watcher starts a core within 3s; the watcher starts with the stand-in already running, and starts one too.
- The core exits with 1 while the stand-in runs, and the watcher starts it again; it exits with 0, and the watcher starts none.
- An update downloads while the stand-in runs: the update file says the sim holds it; the stand-in ends, the core exits, the update applies, and the new watcher writes our package.
- A session file, or an open desktop app, holds a downloaded update, and the update file names it.
- Install now refuses while the stand-in runs, while a session is held, and while the watcher isn't running; otherwise the core quits, the desktop app closes, the update applies, and the desktop app opens again.
- Check now: the update file goes through checking to up to date, and to failed with the error while the network is cut.
- The tray's Quit in a session: the other core sees a leave, and the core exits with 0.
- A package turned off moves beside `Community` only once the stand-in ends, and back when it's turned on; uninstall puts it back.
- Our package removed, or at another version: the sim service's trouble notice; our package turned off by the pilot: none.
- A package whose `layout.json` lists `html_ui/Pages/VCockpit/Core/VCockpit.js`: a warning naming it, and the match check's item; the same package marked `UserDisabled`: neither.

With no sim, on a desk:

- After a Velopack update, the firewall rule still names `current\crosscheck-core.exe`, and Update.exe killed only what ran from its folder.
- On a Windows 10 PC without WebView2, Setup.exe installs it with no prompt.
- The Startup shortcut starts the watcher at login, and turning it off in Windows' Settings shows as off in the watcher.
- Velopack's `HttpSource` reads the feed through `releases/latest/download/`.

### Cases in the sim

- A package moved to `Crosscheck\disabled\` beside `Community` doesn't mount.
- Uninstalling while the sim runs: which of our package's files the sim holds, and what the hook leaves.
- On a PC with no rule naming the core's path, whether the core's UDP socket raises Windows' firewall prompt.
- The Store edition, on a pilot's PC: where its `UserCfg.opt` and `Content.xml` are, and whether a program reads its install folder and `fs-base-ui`.

## Left open

- Our package's folder name, which sets its place in the mount order among packages with the same order hint, and so whether our `VCockpit.js` or another's wins, and whether our WASM module needs a package of its own, as [code in the sim](../architecture/01-spine.md#code-in-the-sim) has it until two modules in one package are tried: [6.18](../architecture/plan.md#618-the-build)'s.
- A sim started in the seconds Update.exe takes to swap `current\` boots with the old package beside a new core, whose module then differs from the core and raises its trouble notice until the sim closes; nothing guards against it.
- How long the uninstall hook gets: Velopack's docs say 30s, and its source passes 60s (read in `src/bins/src/commands/uninstall.rs`), so the hook keeps within 30s.

## Left to the apps' stage

These wait for the apps' stage of step 8, with [the apps' list](../interface/01-apps.md#left-to-the-apps-stage):

- The watcher's tray, and its window with the 24 hours of figures and what quitting costs, and its words.
- How the apps show the update's states, Install now, and Check now, and what Install now says when it refuses.
- How the watcher offers the firewall fix, and what it shows while no `UserCfg.opt` exists.
- The words of each override warning, the match check's item, and our package's trouble notice.

## What this changes elsewhere

The notes at the top of [the spine](../architecture/01-spine.md), [the code map](../architecture/02-code-map.md), [03-v1-scope](../product/03-v1-scope.md#installing-and-updating), [01-between-machines](../network/01-between-machines.md), [01-loop-and-edge](../core/01-loop-and-edge.md), [03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md), [the session's units](../session/02-units.md), and [the apps](../interface/01-apps.md) list what this design changes there, and the [tentative decisions](../architecture/decisions.md#velopack-installs-and-updates-crosscheck-per-user-with-the-watcher-as-its-main-program) give the reasons.
