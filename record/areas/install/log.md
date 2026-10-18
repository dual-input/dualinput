# Installing and updating: log

## 2026-10-18: Velopack installs and updates per-user on one path, an unsigned program meets Smart App Control with no override, and Windows hides a notification sent while a game runs

**Asked.**
How a pilot installs Crosscheck and gets its updates, what our prior apps did for both, and which of Windows' and MSFS 2024's behaviors a design for a per-user, unsigned install, started at login, with a Windows notification early in the sim's load, runs into.

**Expected.**
An installer we'd pick on its build cost, a firewall rule the installer adds, and a notification that shows over the sim's loading screen.

**Found,** by reading docs and source and by reads and probes on our development machine that changed no setting ([prior installers](results/2026-10-18-prior-installers.txt), [installer frameworks](results/2026-10-18-installer-frameworks.txt), [Windows and MSFS facts](results/2026-10-18-windows-and-msfs-facts.txt)):

- Velopack's Setup.exe installs to `%LocalAppData%\{packId}` with no administrator prompt, and an update replaces its `current\` folder by two renames, so a program there keeps its path; Update.exe force-kills every process under its folder but itself, and its hooks may show no UI (read in velopack 1.2.161, `src/bins/src/commands/apply_windows_impl.rs`, `src/bins/src/shared/util_windows.rs`, and [its hooks page](https://docs.velopack.io/integrating/hooks)).
- Tauri's updater plugin needs a Tauri app handle, so a program that isn't the Tauri app can't drive it, and Tauri's NSIS installer stops only the desktop app's own program (read in tauri-plugin-updater 2.14.0, `plugins/updater/src/updater.rs`, and tauri-bundler 2.10.3, `installer.nsi`).
- Adding a Windows Firewall rule takes an administrator, and a pilot who isn't one gets block rules when prompted, whatever they click, which win over allow rules (documented, [Windows Firewall rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)); our machine holds that pair for FS Copilot's `fscopilot.exe`, and a program with no administrator read all 896 of its rules (read and measured on our development machine, 2026-10-18).
- Smart App Control blocks unsigned programs, "There is currently no way to bypass Smart App Control protection for individual apps", and its checks "apply to all executable files, not just those downloaded from the Internet" (documented, [its FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions) and [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)); how many pilots have it on is unknown.
- Windows turns on Do Not Disturb by default "when you're duplicating your display, playing a game, or using an app in full screen mode", sending banners to the notification center, and on Windows 11 a tray balloon that times out isn't kept there (documented, [Focus](https://support.microsoft.com/en-us/windows/turn-off-notifications-in-windows-during-certain-times-81ed1b25-809b-741d-549c-7696474d15d3) and [Shell_NotifyIconW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shell_notifyiconw)).
- The sim's per-profile `Content.xml` names every folder in Community, suffixes included, and marks a package the pilot disabled in the sim `UserDisabled` (read on our development machine, 2026-10-18), so a copy staged inside Community would most likely mount as a second package (unverified).
- On Steam, `fs-base-ui` sits in `steamapps\common\Limitless\Packages`, and only Steam's update of 2026-10-14 rewrote it, while the sim's boots since wrote nothing there (read on our development machine, 2026-10-18).
- Walking the process list for `FlightSimulator2024.exe` took 2.8ms a walk from PowerShell, and WMI's `Win32_ProcessStartTrace` refused a program with no administrator (measured on our development machine, 2026-10-18).
- In our FS Copilot work, a program that copied a new build over its own folder while it ran "deleted 349 of 355 files, reached the mapped FsCopilot.dll" and killed its window, so the copy moved to a script that runs after the program exits and "stages then swaps rather than deleting first" (observed, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-19 — The exerciser leaves the tree, and takes four compile-time couplings with it").
- Neither FS Copilot nor fsc-editor checks for the sim's process before it writes its package (read in the FS Copilot fork, `FsCopilot/Installer.cs`, and fsc-editor, `src/main/sim/install.ts`), and fsc-editor tells a stale package by its module's SHA-256 (same file, `hashFile`), since its package's and its module's version numbers had drifted apart (fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — Two version numbers for one package, and neither is trustworthy").

**What changed.**
Velopack installs and updates Crosscheck, with the watcher as its main program, which adds the firewall rule on its first run; the warning early in the sim's load leaves v1 (user, 2026-10-18); and v1 stays unsigned, which costs a pilot who runs Smart App Control turning it off (user, 2026-10-18) ([installing and updating](01-installing-and-updating.md)).

**Docs affected.**
[Installing and updating](01-installing-and-updating.md), and those its [what this changes elsewhere](01-installing-and-updating.md#what-this-changes-elsewhere) lists.
