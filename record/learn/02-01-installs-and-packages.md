# The MSFS 2024 platform: installs and packages

- [Installs and where packages live](#installs-and-where-packages-live)
- [Packages and the virtual file system](#packages-and-the-virtual-file-system)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

The rest of part 2 is in [02-02-aircraft](02-02-aircraft.md) and [02-03-the-running-sim](02-03-the-running-sim.md).

## Installs and where packages live

MSFS 2024 keeps its packages under one folder, which the `InstalledPackagesPath` line in `UserCfg.opt` names [1] [2].
The Steam and Microsoft Store installs keep `UserCfg.opt` in different places [1] [2]:

| Install | `UserCfg.opt` |
| --- | --- |
| Steam | `%APPDATA%\Microsoft Flight Simulator 2024\UserCfg.opt` |
| Microsoft Store | `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\UserCfg.opt` |

On our Steam development machine the line reads `InstalledPackagesPath "…\Microsoft Flight Simulator 2024\Packages"`, and that folder holds `Community`, `Community2024`, `Official2020`, `Official2024`, and `StreamedPackages` [2].
A path that doesn't come from this line can be wrong, because a user can move the packages folder [2].

**What it changes for Crosscheck.**
Crosscheck's installer has to read `InstalledPackagesPath` from both locations rather than guess a folder, as FS Copilot's and fsc-editor's installers do [1] [2].

## Packages and the virtual file system

A package is a folder with a `manifest.json` and a `layout.json` at its top [3].
At boot, the sim mounts every enabled package into one virtual file system (VFS), and a file in a package mounted later hides the file at the same path in a package mounted earlier [3] [4].
The sim builds the VFS once, at boot, so it doesn't see a package added while it runs until the next start [4] [5].

**How it works.**
`manifest.json` holds the package's metadata.
FS Copilot's bridge package, for example, declares `"package_version": "1.2.0"`, `"minimum_game_version": "1.6.34"`, `"builder": "Microsoft Flight Simulator 2024"`, and `"package_order_hint": "PANEL_PATCH"` [6].
`layout.json` lists every other file in the package, each with a `path`, a `size`, and a `date` [3] [6].
The `date` is a Windows FILETIME, and the sim writes it as a bare number [7].

Packages come from the Community folders, where add-ons go, and from the Official folders and streaming, which the sim manages [3] [4].
Two rules decide what's mounted when packages overlap.

The first rule picks one copy when the same package, by name, is installed in two places [4].
The copy with the highest score is activated, and the others aren't mounted at all [4]:

| Source | Score |
| --- | --- |
| A package being edited in Developer Mode | Infinite |
| A package the sim needs to boot | 100 |
| `Community2024` | 4 |
| `Community` | 3 |
| Marketplace, installed | 2 |
| Marketplace, streamed | 1 |
| Streamed | 0 |
| Base content | -1 |

The second rule orders different packages that contain the same file path.
The sim mounts packages in groups by their order hint, the `package_order_hint` in `manifest.json`, and alphabetically within a group [4] [8].
A package mounted later wins, so a package named `z-bridge` overrides one named `a-bridge` [4].

**Overriding core files.**
The SDK says a package can override a file under `html_ui` or `ModelBehaviorDefs` only if it lists the file as a globally overridden file [4] [8].
Our measurements disagree.
FS Copilot's package replaces `html_ui/Pages/VCockpit/Core/VCockpit.js`, and nothing in the package lists an override: its manifest declares only the order hint `PANEL_PATCH`, which the SDK gives to packages that override cockpit elements [6] [8].
Our own prototype package overrode the same file the same way, and its copy loaded into every panel [9].
We trust the measurement for the sim build we tested; whether `PANEL_PATCH` is what makes it work, and whether a later sim update enforces the SDK's rule, is unverified.

**Restarts.**
A new or reinstalled package needs a sim restart, because the sim reads `layout.json` at startup [5].
An edit to a file the package already lists doesn't need one: reloading a panel through the Coherent debugger picked up an edited `hook.js` [10].
A package built in the Project Editor is mounted into the running sim at once [11].

**What it changes for Crosscheck.**
If Crosscheck ships a package, each install or update costs the pilot a sim restart, so the app has to tell "installed but not loaded" apart from "not installed", as fsc-editor's does [2].
If it overrides a core file, it competes with FS Copilot and YourControls, which replace `VCockpit.js` too ([chapter 1](01-prior-art-and-crew-practice.md#prior-art)), and the mount order picks the winner [4].
[Part 6](outline.md#6-glass-cockpits-and-coherent-gt-full) covers panel injection and its load-order conflicts.

**Traps.**

- The SDK says `Community` is for MSFS 2020 packages and `Community2024` for MSFS 2024 packages [12], but MSFS 2024 mounts both: FS Copilot's installer copies its 2024 package into `Community` only, and it runs [1] [9].
- A broken `layout.json` fails silently.
  fsc-editor's first module package, with its `date` quoted and two manifest fields missing, installed without complaint and never ran [7].
- Some Community folders hold junctions.
  fsc-editor found two packages on our machine that are junctions to folders under `Program Files`, so an installer that deletes or replaces files must check for links before following them [13].

## Sources

1. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Installer.cs`, which reads `UserCfg.opt` from the Store and Steam locations for both sims and installs into each `Community` folder it finds.
2. Documented in our record: fsc-editor, `docs/sim-vars/04-connection.md`, sections "Finding the Community folder" and "Four states, not two", and `src/main/sim/install.ts`, which lists the same `UserCfg.opt` locations.
3. Documented: MSFS 2024 SDK, [Using The SDK](https://docs.flightsimulator.com/msfs2024/html/1_Introduction/Using_The_SDK.htm).
4. Documented: MSFS 2024 SDK, [Virtual File System Information](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Virtual_File_System_Information.htm), sections on package precedence, mount order, and VFS overriding.
5. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/10-module.md`, sections "Building" and "The conflict, and why the build refuses".
6. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, the built package's `FsCopilot.Bridge/Packages/fscopilot-bridge/manifest.json` and `layout.json`, and its package definition, `FsCopilot.Bridge/PackageDefinitions/fscopilot-bridge.xml`.
7. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — First 2a attempt: the module did not load".
8. Documented: MSFS 2024 SDK, [The Project Inspector](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Project_Editor/The_Project_Inspector.htm), sections "Package Order Hint" and "Globally Overridden Files".
9. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - The prototype module works end to end in the simulator".
   The prototype's manifest is written by `record/pointer-forwarding/module/tools/build.mjs`.
10. Measured on MSFS 2024, 2026-09-17: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-17 — A peer's press drove the real A220 ND, opted in by identifier alone".
11. Documented: MSFS 2024 SDK, [The Project Editor](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Project_Editor/The_Project_Editor.htm).
12. Documented: MSFS 2024 SDK, [SDK Overview, "The Community Folders"](https://docs.flightsimulator.com/msfs2024/html/1_Introduction/SDK_Overview.htm#community).
13. Documented in our record: fsc-editor, `src/main/sim/install.ts`, the comment at the top of the file.

## Unverified claims

- **`PANEL_PATCH` is what lets an `html_ui` override take effect without a global-override list.**
  FS Copilot's comments and our prototype's build script say so, but nobody has tried the same package with another hint.
  Installing the prototype package with its hint removed, and checking through the Coherent debugger which `VCockpit.js` a panel loaded, would settle it.
- **The Microsoft Store install keeps `UserCfg.opt` under `Microsoft.Limitless_8wekyb3d8bbwe\LocalCache`.**
  FS Copilot's and fsc-editor's code both look there [1] [2], but our records only show a Steam machine.
  Reading the file on a Store install would settle it.
