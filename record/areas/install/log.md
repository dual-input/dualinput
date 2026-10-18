# Installing and updating: log

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
How a pilot installs Crosscheck and gets its updates, what our prior apps did for both, and which of Windows' and MSFS 2024's behaviors a design for a per-user, unsigned install, started at login, with a Windows notification early in the sim's load, runs into.

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
Velopack installs and updates Crosscheck, with the watcher as its main program, which adds the firewall rule on its first run; the warning early in the sim's load leaves v1 (user, 2026-10-18); and v1 stays unsigned, which costs a pilot whose Smart App Control enforces turning it off until a release of ours has a positive reputation (user, 2026-10-18) ([installing and updating](01-installing-and-updating.md)).

**Docs affected.**
[Installing and updating](01-installing-and-updating.md), and those its [what this changes elsewhere](01-installing-and-updating.md#what-this-changes-elsewhere) lists.
