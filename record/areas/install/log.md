# Installing and updating: log

## 2026-11-02: Windows 11's Startup apps page writes 01 for off and zeros for on, and tells a running app neither

**Asked.**
Whether the desktop app reads a pilot's off in Windows' own list, as [the Settings tab](../interface/decisions.md#the-settings-tab-holds-the-binding-the-output-device-the-recordings-and-the-version) says it does, from an entry the page itself wrote rather than the ones [we read on 2026-10-18](results/2026-10-18-windows-and-msfs-facts.txt).

**Expected.**
An odd first byte for off, which the app reads when it starts, with nothing to tell it sooner.

**Found,** with the development build's `Dual Input` value under `Run`, and Settings, Apps, Startup flipped by hand (measured on Windows 11 Pro 10.0.26200, 2026-11-02):

- Off wrote `StartupApproved\Run\Dual Input` as `01 00 00 00 68 D2 9B 9C D3 6A DD 01`.
- On wrote 12 zero bytes.
- A running app went on saying `on` after the off, and said `off-in-windows` once restarted.
- Deleting the `Run` value left the `StartupApproved` entry behind, with its zeros, which read as on.

**What changed.**
The desktop app reads the switch again every 5s, because the EFB app's note sends a pilot to that page to turn it back on, and they'd return to a switch that stayed off until the app next started.
A socket then heard `on` with the app still running.

**Docs affected.**
None, since [the Settings tab](../interface/decisions.md#the-settings-tab-holds-the-binding-the-output-device-the-recordings-and-the-version) already has the switch follow Windows' off.

## 2026-10-25: An egui window in a Rust tray app takes 96 MB to 153 MB while open, and leaves 62 MB to 69 MB in the process once it closes, where Tauri's leaves 3.7 MB

**Asked.**
What a Rust tray app costs all day if it draws its few screens, such as the performance history's graph and the update's progress, with egui rather than Tauri's WebView2, since the user is weighing a Dual Input whose only window is its EFB app, leaving the tray app no other reason to carry Tauri (user, 2026-10-25).

**Expected.**
Less than Tauri's 72.7 MB with a window open, since egui draws in its own process with no browser, and about the tray's own memory once the window closes.

**Found,** with [p02](../../../experiments/areas/install/p02-egui-tray.mjs), which measures as [p01](#2026-10-18-a-tauri-2-app-idles-as-a-tray-icon-in-22-mb-and-gives-back-webview2s-69-mb-once-its-window-is-destroyed-but-not-while-its-hidden) did, adding each process's GPU memory: an eframe 0.37.0 app with a `tray-icon` 0.26.1 icon and a 480×360 window showing a static `egui_plot` 0.38.0 graph, built once for each of eframe's renderers (measured on our development machine, 2026-10-25, with an NVIDIA GeForce RTX 4090 and AMD Radeon Graphics; results for [wgpu](../../../experiments/areas/install/results/p02-egui-tray-2026-10-25-14-10-14.txt) and [OpenGL](../../../experiments/areas/install/results/p02-egui-tray-glow-2026-10-25-14-17-45.txt)):

| State | wgpu 30.0.1, eframe's default | glow 0.17.0, OpenGL | Tauri 2.12.1, from p01 |
| --- | --- | --- | --- |
| The tray icon alone, no window ever opened | 1.7 MB | 1.6 MB | 2.2 MB |
| A window open | 153.2 MB, and 241.7 MB of GPU memory | 96.5 MB, and 29.2 MB of GPU memory | 72.7 MB over 7 processes |
| The window hidden | 153.2 MB | 96.6 MB | 72.3 MB |
| The window closed, the tray icon left | 62.6 MB | 68.6 MB | 3.7 MB |
| The program on disk | 12.7 MB | 6.7 MB | 8.2 MB |

- Memory is Task Manager's, the private working set, after 60s idle; p01 didn't read GPU memory.
- Each egui app ran in one process, and used 0ms to 94ms of CPU in each 60s idle.
- Closing the window kept 61 MB to 67 MB more than the tray alone, in either renderer, so what stays is what the process loaded for the GPU, such as its driver, rather than the window; WebView2 draws in processes of its own, which exit with the window.

**What changed.**
An egui window costs the tray app its memory for the rest of the day once a pilot has opened it, unless the window runs in a process that exits with it, such as the tray app started again to show one screen; the tray alone stays under 2 MB either way.
Which the tray app's screens use is the user's call.

**Docs affected.**
[Installing and updating](01-installing-and-updating.md#one-program-from-login), if the tray app drops Tauri.

## 2026-10-22: Our VCockpit.js won over FS Copilot's, though fscopilot-bridge sorts after dualinput with the same order hint

**Asked.**
Which package's `VCockpit.js` the sim loads into a cockpit's panels when ours and FS Copilot's are both in `Community`, each with the order hint `PANEL_PATCH`, which [the build](../build/01-the-build.md#our-package) leaves to a case in the sim; stage 5's session ran it first, at the user's ask (user, 2026-10-22).

**Expected.**
FS Copilot's, since `fscopilot-bridge` sorts after `dualinput`, and within one order hint's group the package later in the alphabet wins a file both hold, by the rule [packages that override our files](01-installing-and-updating.md#packages-that-override-our-files) gives (inference, not run).

**Found,** on MSFS 2024 1.9.18.0, Steam's edition, in a flight with the Black Square Baron (measured on our development machine, 2026-10-22, [core results](../core/results/2026-10-22-stage-5-session.txt)):

- All 20 cockpit panels ran our bridge, which only our `VCockpit.js` loads.
- The `VCockpit.js` a panel fetched from `/Pages/VCockpit/Core/VCockpit.js` was 24,735 bytes and held our blocks, where `fscopilot-bridge`'s copy on disk is 26,060 bytes.
- `fscopilot-bridge` is FS Copilot 1.2.0, its folder made on 2026-10-20, while each `node tools/build.ts install` makes `dualinput`'s folder afresh by renaming its copy in, so ours was the newer folder.
- Why ours won is unverified: which folder is newer, or the sim's `Content.xml`, could decide it, where the alphabet doesn't.

**What changed.**
Nothing yet: the check of the packages that override our files, and its case with FS Copilot's package installed, come with [stage 15](../build/plan.md#15-installing-and-updating), which takes this result as its starting point.

**Docs affected.**
[The build](../build/01-the-build.md) and [01-installing-and-updating](01-installing-and-updating.md), in notes at their tops.

## 2026-10-21: A fixed `DualInput\` staging folder beside a Community junction's target can be the pilot's data folder

**Asked.**
Whether copying our package into `Community` through a `DualInput\` folder beside it, as [our package](01-installing-and-updating.md#our-package) has the app do, can delete something not ours, which stage 4's code review of `node tools/build.ts install` raised.

**Expected.**
No, since `DualInput\` is ours.

**Found.**
A rename can't cross drives, so the copy goes beside the folder a `Community` junction leads to, and a pilot can make `Community` a junction to another folder.
With a junction to `%APPDATA%\Community`, the folder beside its target named `DualInput` is `%APPDATA%\DualInput\`, the pilot's data folder, which the copy deletes before and after it runs (read in `tools/lib/install.ts`, and tested in `tools/install.test.ts`, "install deletes nothing beside the folder a Community junction leads to").

**What changed.**
The copy goes through a folder made fresh for each copy, `dualinput-install-` and a random suffix, which `tools/build.ts install` does and the desktop app will do in [stage 15](../build/plan.md#15-installing-and-updating) (user, 2026-10-21).

**Docs affected.**
[01-installing-and-updating](01-installing-and-updating.md), in a note at its top.

## 2026-10-18: The sim's BlurPage files haven't changed since 2025-11-04

**Asked.**
How often a copy of BlurPage that we ship would fall behind the sim's own, once shipping it replaced making it on each pilot's PC (user, 2026-10-18).

**Expected.**
A change with some sim updates, since Steam's update of 2026-10-14 rewrote files in `fs-base-ui`.

**Found,** by reading our Steam install's `steamapps\common\Limitless\Packages\fs-base-ui\cookedcomps\` (read on our development machine, 2026-10-18, MSFS 2024 1.9.18.0):

- `{8B92BB9A-4176-4F1A-A9CE-CB1195C4E952}.html`, 973 bytes, and its `.json`, 142 bytes, were both last written on 2025-11-04.
- The `.json`'s SHA-256 matches the copy interface's p10 took on 2026-10-06 (`experiments/areas/interface/menu/package/PackageSources/cookedcomps/`), and the `.html` is still the 973 bytes the [interface log](../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly) gives it.
- Whether Steam keeps a file's old write time when an update leaves it unchanged, rather than the sim having left it alone, is unverified; the hash match covers 2026-10-06 to today.

**What changed.**
The BlurPage copy ships in our package, built like our `VCockpit.js`, where [decision 003](../../decisions/003-watcher-keeps-blurpage-copy-current.md) has it made on each PC ([our package](01-installing-and-updating.md#our-package)).

**Docs affected.**
[Installing and updating](01-installing-and-updating.md).

## 2026-10-18: A Tauri 2 app idles as a tray icon in 2.2 MB, and gives back WebView2's 69 MB once its window is destroyed, but not while it's hidden

**Asked.**
Whether the desktop app can be the program that runs all day from login, doing the watcher's jobs as a tray icon, at a cost near the 1.0 MB a Rust tray icon took ([architecture log](../architecture/log.md#2026-10-08-a-tray-icon-alone-costs-10-mb-of-memory-in-rust-16-mb-in-net-native-aot-51-mb-in-winforms-and-397-mb-over-three-processes-in-electron)), since we'd measured Tauri only with its window open.

**Expected.**
A few MB with no window, and WebView2's processes lingering after the window closes.

**Found,** with [p01](../../../experiments/areas/install/p01-tauri-tray.mjs), a Tauri 2.12.1 app with its tray icon on and its Rust side holding a WebSocket, each state measured after 15s to settle and again after 60s idle (measured on our development machine, 2026-10-18, WebView2 Runtime 155.0.4283.62, [results](../../../experiments/areas/install/results/p01-tauri-tray-2026-10-18-08-36-33.txt)):

| State | Processes | Task Manager's memory | CPU over 60s |
| --- | --- | --- | --- |
| The tray icon alone, no window ever opened | 1 | 2.2 MB | 0ms |
| A window open, showing a static page | 7 | 72.7 MB | 125ms |
| The window hidden | 7 | 72.3 MB | 63ms |
| The window destroyed, the tray icon left | 1 | 3.7 MB | 0ms |

- All six WebView2 processes had exited within 15s of the window's `destroy()`, and the app's own process kept 1.5 MB more than before the window opened.
- Hiding the window kept every WebView2 process and its memory.
- The program is 8.2 MB on disk.

**What changed.**
The desktop app can run all day as a tray icon at 2.2 MB to 3.7 MB, if closing its window destroys the window rather than hiding it; whether it takes the watcher's jobs is 6.17's redraft (user's call).

**Docs affected.**
[Installing and updating](01-installing-and-updating.md), once redrafted.

## 2026-10-18: Velopack installs and updates per-user on one path, an unsigned program meets Smart App Control with no override, and Windows hides a notification sent while a game runs

**Asked.**
How a pilot installs Dual Input and gets its updates, what our prior apps did for both, and which of Windows' and MSFS 2024's behaviors a design for a per-user, unsigned install, started at login, with a Windows notification early in the sim's load, runs into.

**Expected.**
An installer we'd pick on its build cost, a firewall rule the installer adds, and a notification that shows over the sim's loading screen.

**Found,** by reading docs and source and by reads and probes on our development machine that changed no setting ([prior installers](results/2026-10-18-prior-installers.txt), [installer frameworks](results/2026-10-18-installer-frameworks.txt), [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)):

- Velopack's Setup.exe installs to `%LocalAppData%\{packId}` with no administrator prompt, and an update replaces its `current\` folder by two renames, so a program there keeps its path; Update.exe force-kills every process under its folder but itself, and its hooks may show no UI (read in velopack 1.2.161, `src/bins/src/commands/apply_windows_impl.rs`, `src/bins/src/shared/util_windows.rs`, and [its hooks page](https://docs.velopack.io/integrating/hooks)).
- Tauri's updater plugin needs a Tauri app handle, so a program that isn't the Tauri app can't drive it, and Tauri's NSIS installer stops only the desktop app's own program (read in tauri-plugin-updater 2.14.0, `plugins/updater/src/updater.rs`, and tauri-bundler 2.10.3, `installer.nsi`).
- "The Netsh advfirewall command requires administrator permissions to run" (documented, [the Windows 8.1 answer-file page](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-8.1-and-8/hh825692(v=win.10)); no add was tried without one), and a pilot who isn't an administrator gets block rules when prompted, whatever they click, which win over allow rules (documented, [Windows Firewall rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)); our machine holds that pair for FS Copilot's `fscopilot.exe`, and a program with no administrator read all 896 of its rules (read and measured on our development machine, 2026-10-18).
- An enforcing Smart App Control "will block execution of unsigned files unless the file has a positive reputation", "There is currently no way to bypass Smart App Control protection for individual apps", and its checks "apply to all executable files, not just those downloaded from the Internet" (documented, [its FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions) and [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)); how many pilots have it on is unknown.
- Focus assist is "set by default to activate automatically when you're duplicating your display, playing a game, or using an app in full screen mode", Do Not Disturb sends other apps' banners "directly to the notification center", and on Windows 11 a tray balloon that times out isn't kept there (documented, [Focus](https://support.microsoft.com/en-us/windows/turn-off-notifications-in-windows-during-certain-times-81ed1b25-809b-741d-549c-7696474d15d3), [Notifications and Do Not Disturb](https://support.microsoft.com/en-us/windows/experience/notifications-and-do-not-disturb-in-windows), and [Shell_NotifyIconW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shell_notifyiconw)); that the same default holds on Windows 11 25H2 is unverified.
- The sim's per-profile `Content.xml` names every folder in Community, suffixes included, and marks a package the pilot disabled in the sim `UserDisabled` (read on our development machine, 2026-10-18), so a copy staged inside Community would most likely mount as a second package (unverified).
- On Steam, `fs-base-ui` sits in `steamapps\common\Limitless\Packages`, and only Steam's update of 2026-10-14 rewrote it, while the sim's boots on 2026-10-16 wrote nothing there (read on our development machine, 2026-10-18).
- Walking the process list for `FlightSimulator2024.exe` took 2.8ms a walk from PowerShell, and WMI's `Win32_ProcessStartTrace` refused a program with no administrator (measured on our development machine, 2026-10-18).
- In our FS Copilot work, the exerciser's in-process sync of an FS Copilot build into its own folder "deleted 349 of 355 files, reached the mapped FsCopilot.dll" and killed its window, so the copy moved to a script that runs after the program exits and "stages then swaps rather than deleting first" (measured, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-19 — The exerciser leaves the tree, and takes four compile-time couplings with it").
- Neither FS Copilot nor fsc-editor looks for the sim's process before it writes its package (read in the FS Copilot fork, `FsCopilot/Installer.cs`, and fsc-editor, `src/main/sim/install.ts`), though FS Copilot's setup button waits while its SimConnect connection is up, "Setup required. Close Microsoft Flight Simulator to continue" (read in the FS Copilot fork, `FsCopilot/ViewModels/SetupViewModel.cs`, `IsMsfsRunning`), and fsc-editor tells a stale package by its module's SHA-256 (same file, `hashFile`), since its package's and its module's version numbers had drifted apart (fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — Two version numbers for one package, and neither is trustworthy").

**What changed.**
Velopack installs and updates Dual Input, with the watcher as its main program, which adds the firewall rule on its first run; the warning early in the sim's load leaves v1 (user, 2026-10-18); and v1 stays unsigned, which costs a pilot whose Smart App Control enforces turning it off until a release of ours has a positive reputation (user, 2026-10-18) ([installing and updating](01-installing-and-updating.md)).

**Docs affected.**
[Installing and updating](01-installing-and-updating.md), and those its [what this changes elsewhere](01-installing-and-updating.md#what-this-changes-elsewhere) lists.
