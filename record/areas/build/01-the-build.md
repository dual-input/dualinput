# The build

```text
Purpose:     How one repository's code becomes a checked, published release.
Depends on:  ../architecture/02-code-map.md, ../architecture/01-spine.md, ../architecture/coherent-gt.md, ../install/01-installing-and-updating.md, ../profiles/02-units.md, ../core/01-loop-and-edge.md, ../core/02-clients-and-panel-bridge.md, ../avatars/01-avatars.md, ../network/02-units.md, 02-testing.md, log.md
Decides:     What a release holds; how every x86_64 program links the C runtime statically; which SDK the build uses; where the sim's stock files live and how a sim update that changes them shows; our package's folder name, order hint, and contents, and how a development build reaches the sim; how the files only the sim compiles get built; how the Coherent GT check is built and when it runs, and that no for-of rewrite runs; how the message crate is hashed, and how the version and the hash reach each component; how a release is built, checked, and published, when the backend deploys, and how its tests hold a released path's bodies; that v1 ships no authoring tools (node 6.18); and how the icons, the screenshots, and the social preview are drawn (stage 22f).
```

> **Note**
> Stage 15 packs with `node tools/release.ts pack`, the build job's step 6 below, which installs `vpk` into `target/vpk`.
> It also passes `--runtime win-x64`, since `vpk` 1.2.161 packs for x86 when no runtime is named, and `--splashImage` and `--splashProgressColor` for Setup.exe's splash, which `node tools/splash.ts` draws ([installing log](../install/log.md#2026-11-10-the-desktop-app-starts-the-core-18s-after-the-sim-and-20s-to-24s-after-a-crash-and-holds-its-02-of-a-core-only-with-a-walk-cheaper-than-toolhelps)).

> **Note**
> From stage 22d, v1 ships one authoring tool, the profile extension, with `dualinput-profile-builder` inside it, so [authoring tools](#authoring-tools)' rule that v1 ships none no longer holds, while `tools/profile-author` still runs from the repository alone ([03-the-extension](../profiles/03-the-extension.md#packing-and-publishing); user, 2026-11-21 and 2026-11-22):
>
> - `node tools/build.ts extension` builds the extension's `.vsix` into `target/profile-extension/`, and `node tools/build.ts release` builds it too, beside the folder in [what a release holds](#what-a-release-holds).
> - In [a release](#a-release), `node tools/release.ts pack` copies the `.vsix` into the build job's artifact, the publish job's `upload` attaches it to the draft beside the installer and `check` fails a draft without it, and once the release is published, a job of its own, `marketplace`, publishes it on VS Code's Marketplace with vsce, run through `npx` at a pinned version in that job alone, signed in by the Marketplace's Trusted Publishing from the job's GitHub OIDC token, so the repository holds no secret for it ([packing and publishing](../profiles/03-the-extension.md#packing-and-publishing)).
> - `tools/check.ts` and the profiles' job run `dualinput-profile-builder format --check` on `profiles/`.

> **Note**
> Since 2026-11-25, in [the screenshots](#the-screenshots), the EFB app's scenes are fixed IDs, each the file name its picture had, such as `james-link-lost`, so a doc's link never moves when a state is renamed, and its dev page names each by its situation and a short label, as "James flies: Link lost", which the README shows (user, 2026-11-25).
> `?scene=` and `node tools/screenshots.ts efb james-flying` take the ID, and the other pages' scenes are still named by their names.
> The EFB app's dev page lists every state at once beside the app, each situation a block of its states in four columns in the pilot's order, with the view's three sizes above them, and keeps the state and size it showed across an edit's reload (user, 2026-11-25).
> `tools/dev.ts` sends an edit's reload to every page waiting on it and code to run only to the debugger's, since a browser tab left on its port took the reload and left the debugger on the old build.

> **Note**
> Since 2026-11-25, first-time setup checks nothing, so in [the screenshots](#the-screenshots) its one scene runs the default 5s, and only a join that's slow to answer runs longer, 8s ([interface log](../interface/log.md#2026-11-25-first-time-setup-drops-its-system-check-since-each-failure-it-found-shows-in-the-header-or-a-screen-of-its-own)).

`tools/build.ts` lays out one folder, which becomes a release's `current\`: the desktop app, the core, the core helper, the SDK's `SimConnect.dll` and the three C runtime DLLs it imports, and our one Community package, `dualinput`.
One line of Cargo config links every x86_64 program's C runtime statically, the build installs the SDK version the repository names, and the sim's stock files that our `VCockpit.js` and BlurPage copy start from live in the tree.
The Coherent GT check is a Node tool of its own on acorn, run on every bundle after each edit and in CI, and the message crate's hash is SHA-256 over its own source and the locked versions of what it depends on.
A release is merging the release pull request, which a workflow keeps open with the next version and its notes; once CI passes on the merged commit, a job that can't write to the repository builds and packs it, and a job that can uploads it as a draft, checks the draft, and publishes it, while the backend deploys whenever CI passes on `main`.

This answers node 6.18 of the [architecture plan](../architecture/plan.md#618-the-build).
The docs in its Depends on line and decisions [025](../../decisions/025-messages-in-one-rust-crate.md), [026](../../decisions/026-first-message-carries-version-and-hash.md), [030](../../decisions/030-in-sim-code-es2017-esbuild.md), and [031](../../decisions/031-coherent-gt-check-tool.md) give the rules this design builds on, and it holds only what they leave out.
The research behind it is in this area's [log](log.md).

## What a release holds

`node tools/build.ts release` builds every target but the backend and the profiles, then lays out the folder that `vpk pack` packs and Setup.exe installs as `current\`:

| In the folder | Built by |
| --- | --- |
| `dualinput-desktop.exe` | `tools/build.ts` builds its window's pages with esbuild and the kit's stylesheet into `target/desktop-pages`, then `cargo build` from `src/apps/desktop` compiles them in; the crate turns on Tauri's `custom-protocol` feature, so the program serves them with no Tauri CLI and no bundling step ([the kit](../interface/decisions.md#the-apps-draw-with-a-kit-of-our-own-components-styled-with-tailwind-3)) |
| `dualinput-core.exe` and `dualinput-core-helper.exe` | `cargo build --release` |
| `SimConnect.dll` | Copied from the pinned SDK ([the SDK](#the-sdk)), for the core, which loads it from its own folder |
| `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`, and `MSVCP140.dll` | Copied from the MSVC tools' redistributable folder, for `SimConnect.dll`, which imports them ([the C runtime](#the-c-runtime)) |
| `dualinput\` | Our Community package ([our package](#our-package)) |

The module's routines, the panel modules, and the default relay list build as [the sync units](../sync/05-units.md#h-events), [flight-model sync](../flight-model/01-flight-model-sync.md#what-this-adds-to-our-wasm-module), [traffic and ATC](../traffic-atc/01-traffic-and-atc.md#the-units), [plugins and the sandbox](../plugins/01-plugins.md#reading-it-in-the-panel), and [the network's units](../network/02-units.md#their-configuration) give them, and no release carries the tools ([authoring tools](#authoring-tools)).

## The C runtime

The root's `.cargo/config.toml` holds one entry for the C runtime, so every program `cargo build` builds for x86_64 links the whole C runtime statically: the core, the core helper, the desktop app's Rust side, the tools, and the tests.

```toml
[target.x86_64-pc-windows-msvc]
rustflags = ["-C", "target-feature=+crt-static"]
```

- With it, p11's core imported no C runtime DLL, where without it the program imported `VCRUNTIME140.dll` and five `api-ms-win-crt-*` DLLs, and it grew from 153,088 to 251,904 bytes (measured on our development machine, 2026-10-18, [log][crt]).
  - So the core's math is its own program's, as [the core's math](../core/01-loop-and-edge.md#the-cores-math) needs.
  - No program needs the Visual C++ redistributable, which Microsoft has applications deploy and which asks for an administrator as it installs (documented, [Redistributing Visual C++ files](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files)).
    Velopack's `--framework vcredist143-x64` runs that installer (read in velopack 1.2.161, [results][crtresults]), so it would most likely put the prompt into our per-user install (inference), and no release uses it.
- cc compiles C code, such as QuickJS-ng's, with `-MT` when the flag is on, so all of a program's code takes one runtime (read in cc 1.8.0, [results][crtresults]).
- bindgen's build script for the Windows side's bindings, `simconnect-types`', builds with the static C runtime ([log][bindgen]).
- **SimConnect.dll's runtime.** The SDK's `SimConnect.dll` imports `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`, and `MSVCP140.dll`, by `dumpbin /dependents`, and the SDK's static `SimConnect.lib` names the same runtime, `/DEFAULTLIB:MSVCRT`, so linking it would bring them into the core.
  - So a release carries the three DLLs beside `SimConnect.dll`, copied from the MSVC tools' redistributable folder, as Microsoft's "local deployment" (documented, [Redistributing Visual C++ files](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files)), so the core starts on a PC whose runtime lives only inside the Microsoft Store edition's own package, which is unverified, and no pilot needs the redistributable's installer (user, 2026-10-21).
  - The sim's own exe imports the same three, so a PC that runs the Steam edition has them installed.
- **The module's build.** cargo-msfs's own `RUSTFLAGS` outrank the entry, so the module builds as it does without it, and after the first build each of four, alternating `cargo build` and cargo-msfs's, compiled no crate (measured, [log][crt]).
  That holds from Cargo 1.85, which gives a crate built with other flags files of its own, so `rust-toolchain.toml` names 1.85 or later.
- **The desktop app.** `tauri.conf.json` turns Tauri's `build.windows.staticVCRuntime` off, so the entry decides the desktop app's runtime too, where Tauri's own default links the UCRT through Windows' copy for that one program (measured with tauri-build 2.7.1, [log][crt]).
- **A guard.** A `RUSTFLAGS` of any value, an empty one included, replaces the entry without a word (measured, [log][crt]), so `src/apps/core` stops a build that lacks the flag:

  ```rust
  #[cfg(all(target_env = "msvc", not(target_feature = "crt-static")))]
  compile_error!("dualinput-core must link the C runtime statically: RUSTFLAGS replaced the +crt-static of .cargo/config.toml");
  ```

  CI installs Rust with rustup from `rust-toolchain.toml`, rather than through `actions-rust-lang/setup-rust-toolchain`, whose v1.17.0 sets `RUSTFLAGS="-D warnings"` by default (read in its `action.yml`, [log][crt]).

## The SDK

- `msfs-sdk.txt` at the root names one SDK version, such as `1.8.1`, and every build uses that version.
- `tools/msfs-sdk` installs it: a Rust program adapted from cargo-msfs's `install_latest_sdk`, under cargo-msfs's MIT license.
  It downloads `https://sdk.flightsimulator.com/msfs2024/files/installers/<version>/MSFS2024_SDK_Core_Installer_<version>.zip`, unpacks the installer's files into `%APPDATA%\cargo-msfs\data\msfs2024` without running it, as cargo-msfs does, and writes `version.txt` there with the version alone.
- `tools/setup.ts` runs it whenever that version differs from the root's, so `cargo-msfs build` and the Windows side's bindings read the SDK from the same folder, and cargo-msfs's own `install` and `update` go unused.
- The bindings' build scripts and `tools/build.ts` fail when the first line of `version.txt` isn't the version `msfs-sdk.txt` names, with a message naming `node tools/setup.ts`; they read only the first line, since cargo-msfs writes a build number after it ([log][workspace]).
  The build scripts run again when either file changes, so a pull that changes the SDK, or a `cargo-msfs install` that put the newest one in, never builds against the wrong one.
- The sim edge's build script links `SimConnect.lib` and copies `SimConnect.dll` beside the program it builds, from the SDK's folder, which `simconnect-types` hands it through Cargo's `links` metadata, so the SDK's folder stays named in three places ([log][package]).
- The listing cargo-msfs reads links only the newest two SDKs, while each of the 8 older installers it doesn't link was still served when we asked (measured, 2026-10-18, [log][sdk]), so a build of an old commit installs the SDK that commit built against.
- `tools/replay.ts` fetches the release a recording names from GitHub, takes `dualinput-core.exe` from its full package, and replays with it, so replaying a release's recording needs no rebuild and no older SDK, and only a rebuild for added logging installs one ([running a replay](../core/01-loop-and-edge.md#running-a-replay); user, 2026-10-18).
- A new SDK reaches the build only through a commit that changes `msfs-sdk.txt`, which settles the code map's [left open](../architecture/02-code-map.md#left-open) item on an SDK newer than a release's.
- CI caches the SDK's folder, keyed on that version.

## The sim's stock files

- `src/sim-package/stock/` holds the sim's `VCockpit.js`, and BlurPage's `.html` and `.json`, byte for byte as the sim ships them, and `stock.json`, which names the sim release and Steam branch they came from and each file's SHA-256.
  `.gitattributes` marks the folder `-text`, so git never rewrites their CRLF line ends and the hashes hold on every checkout.
- That puts three of Asobo's files in the public tree, where the sim's other files we read stay out ([commbus log](../commbus/log.md)), since our package ships changed copies of them anyway, and YourControls keeps its copy of `VCockpit.js` in its public repository, as FS Copilot keeps its own in its source (read in YourControls/yourcontrols, `scripts/build-include/2024/YourControls/`, and in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/Pages/VCockpit/Core/VCockpit.js`, [results][msfs]; user, 2026-10-18).
- The build makes our copies from them, putting our blocks in at named anchors, and refuses when an anchor is missing ([our VCockpit.js](../core/02-clients-and-panel-bridge.md#our-vcockpitjs)).
- **A sim update that changes one.** On a PC with the sim's Steam edition, found through Steam's `libraryfolders.vdf` as p10's build finds it (read in `experiments/areas/interface/menu/build.mjs`), `tools/build.ts` hashes the sim's three files, in its `asobo-vcockpits-core` and `fs-base-ui` packages, and stops when one differs from `stock.json`, naming `node tools/stock.ts`, which copies the sim's files in and writes `stock.json` again.
  - A file's own hash is the one sign of its change: Steam's update of 2026-10-14 rewrote `asobo-vcockpits-core`'s `manifest.json` and `layout.json` and left its files, and SimConnect's open message read the same version on three sim releases (read and measured, [log][stock]).
  - So a developer's first build after such an update stops, and the commit `tools/stock.ts` makes shows what the update changed, for a release to carry.
  - `tools/stock.ts` takes the files only from Steam's public branch, which `appmanifest_2537590.acf`'s `BetaKey` names, and on a beta branch the build warns rather than stops, so a beta's files never reach pilots on the public sim.
- CI has no sim, so it checks only that each file matches `stock.json`.
- The build reads the Steam edition's files, and whether the Microsoft Store edition keeps them where a program can read them is unverified ([log][stock]).

## Our package

- **One package,** in a folder named `dualinput` with the order hint `PANEL_PATCH`, holds our code in the sim and its pages, the EFB app among them, our `VCockpit.js` and BlurPage copies, our WASM module, the figure's SimObject, and the banner's in-game panel.
  - FS Copilot's one package holds its WASM module and its `html_ui` both (read in the FS Copilot fork, `FsCopilot.Bridge/PackageDefinitions/fscopilot-bridge.xml`), and the spine's rule of a package for each standalone module keeps two modules apart ([code in the sim](../architecture/01-spine.md#code-in-the-sim)), while we ship one.
  - That settles what [installing and updating](../install/01-installing-and-updating.md#left-open) leaves to this design.
- **Its layout.** `tools/build.ts` lays out the package in `target/sim-package/dualinput/`: `modules/dualinput.wasm`, a `layout.json` that gives each file's size and last write, and a `manifest.json` with p08's fields, the title and creator Dual Input, the root `Cargo.toml`'s version, `package_order_hint` `PANEL_PATCH`, and `minimum_game_version` 1.8.14 ([log][package]).
  It bundles `bridge.js` with esbuild into `html_ui/DualInput/`, makes our `VCockpit.js` into `html_ui/Pages/VCockpit/Core/`, and runs `node --check` and [the Coherent GT check](#the-coherent-gt-check) on both.
- **The mount order.** Within one order hint's group, the package later in the alphabet wins a file both hold ([packages that override our files](../install/01-installing-and-updating.md#packages-that-override-our-files)).
  The same SDK page has a file in `html_ui` override only when its package lists it as globally overridden; neither FS Copilot's package nor ours does, and FS Copilot's override worked anyway ([02-01](../../learn/foundations/02-01-installs-and-packages.md)).
  The sim's report on our machine lists the group with no hint before `UI_PATCH`, `PANEL_PATCH`, and `CUSTOM_INSTRUMENT` (read on our development machine, 2026-10-18, [results][msfs]), though that this is the mount order across groups is unverified.
  The Package Reorder Tool's page says the order within one priority "is not guaranteed" (documented, [Developer Mode's tools](https://docs.flightsimulator.com/msfs2024/retail/devmode/menus/tools/)).
  - FS Copilot's generated package, `fscopilot-bridge`, with `PANEL_PATCH`, ran its `VCockpit.js` in the A220's panels (measured on MSFS 2024, 2026-09-01, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-01 - Single-machine cockpit validation: the production pipeline works"), so ours takes the same hint; whether `PANEL_PATCH` is what makes an override work is unverified ([02-01](../../learn/foundations/02-01-installs-and-packages.md)).
  - `fscopilot-bridge` sorts after `dualinput` in the same group, so the documented rule has FS Copilot's win over ours, but in one flight with both packages installed, ours won, and why is unverified ([installing log](../install/log.md#2026-10-22-our-vcockpitjs-won-over-fs-copilots-though-fscopilot-bridge-sorts-after-dualinput-with-the-same-order-hint)).
  - YourControls' package carries no hint (read, [results][msfs]), so it most likely mounts before ours and loses (inference from the report's order).
  - Ours winning, as it did in that flight, breaks FS Copilot with no word from it.
- Our probes ran an in-game panel, the EFB app, and BlurPage's copy only from packages with other hints, and a SimObject in a `PANEL_PATCH` package is untried, so one boot of our package in the sim settles all four ([cases for the bench](#cases-for-the-bench)).
- **A development build** reaches the sim only when the developer asks: `node tools/build.ts install` copies the package it built into each packages folder's `Community`, as the desktop app copies ours (user, 2026-10-18).
  - It reads the packages folder from each edition's `UserCfg.opt` that exists, Steam's in `%APPDATA%` and the Microsoft Store's in `%LOCALAPPDATA%`.
  - It copies the package into a folder it makes fresh for each copy, `dualinput-install-` and a random suffix, beside each `Community`, or beside the folder a junction leads to when `Community` is one, renames the copy in, and deletes that folder ([installing log](../install/log.md#2026-10-21-a-fixed-dualinput-staging-folder-beside-a-community-junctions-target-can-be-the-pilots-data-folder)).
  - It refuses while `FlightSimulator2024.exe` runs, before it builds and again before it copies.
  - The desktop app writes our package only when it runs from Velopack's `current\` folder, as an installed release does, so a development build of it never touches `Community`.
  - A rebuild keeps the version, which changes only for a release, so the installed app's rule, which compares versions, would never copy a rebuild in.
  - On a PC with a release installed too, the installed app rewrites `Community` whenever the development package's version differs from its own, so the developer quits it first.

## Files compiled with the sim

The figure's model and the banner's in-game panel definition are the only files of ours the sim compiles, and the rest of our package is copied as it is ([log][compiled]).

- `fspackagetool` starts the sim to build, so no CI runner can run it ([log][compiled]).
- The figure comes out with Asobo's extension `ASOBO_asset_optimized` and every vertex re-encoded into one 36-byte layout, and the banner's XML definition as a binary `.spb` with its strings encoded, and we found no description of either format (read on our development machine and searched, 2026-10-18, [log][compiled]).
- No tool of ours writes either format, since we'd own two undocumented formats against every sim update for files that rarely change (user, 2026-10-18).
- **When a source changes,** someone on a PC with the sim compiles it with `fspackagetool` and commits what came out into a `compiled/` folder beside the source, with `source.json` holding each source file's SHA-256.
  - The sim must be closed in full, since `fspackagetool` hangs while the sim runs (measured, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — The module becomes a sub-project, and fspackagetool cannot run with the sim open") and fails while a crashed sim lingers ([avatars log](../avatars/log.md#2026-10-03-a-skinned-stick-took-the-sim-down-in-an-in-sim-build-and-a-crashed-sim-held-fspackagetool-until-it-was-closed)).
  - The `manifest.json` that `fspackagetool` writes stays out, since `tools/build.ts` writes the package's own, and so does its `_PackageInt\` folder, which holds the home folder's path ([log][compiled]).
  - CI hashes each source and fails when one differs from `source.json`, so a source changed without a recompile fails its pull request.
- The stage of [node 8](../architecture/plan.md#8-the-build-order) that first ships either file writes the procedure and the script for that recompile, for whoever does it months later (user, 2026-10-18).

## The Coherent GT check

[Decision 031](../../decisions/031-coherent-gt-check-tool.md)'s check is a Node program of its own, on acorn, acorn-walk, eslint-scope, `@eslint-community/regexpp`, and source-map-js: 9 packages and 1.4 MB with what they depend on, under MIT and BSD licenses (measured and read, [results][checkresults]).

- **Syntax.** acorn parses each file at `ecmaVersion: 2017`, and stops at its first syntax error.
  It rejected all 20 of p09's samples the engine fails and accepted all 22 from ES2015 to ES2017 (measured, [log][check]), so p09's samples are the tool's first tests.
  It also rejects 3 the engine parses, object rest, the template literal revision, and `import()`: esbuild lowers the first, and hand-written JavaScript keeps to ES2017, as decision 031 has it.
- **Regexes.** acorn checks each regex literal at 2017.
  Each `RegExp(...)` or `new RegExp(...)` on the unshadowed global, whose arguments are string literals or template literals without expressions, goes to regexpp's `RegExpValidator` at 2017, which failed esbuild's `new RegExp("(?<y>\\d{4})")` with "Invalid group" (measured, [log][check]).
- **Banned names,** from the data file:
  - globals, such as `globalThis`, `BigInt`, `Intl`, and the missing web APIs, found among eslint-scope's unresolved references, so a local of the same name passes, and through `window.`, `self.`, and `globalThis.`;
  - static members of a global, such as `Object.fromEntries`;
  - prototype methods, such as `flat`, `at`, and `finally`, found by their property's name, since a bundle carries no types;
  - and an `Error`'s `cause`.
- **A package's own fill-in** passes by four rules:
  1. A file that defines a name, by assigning the member, by `Object.defineProperty` of it, or by declaring the global, passes each use of that name in it, the definition included.
  2. A guard isn't a use: `typeof X`, `"x" in Y`, or `Y.x` in the test of an `if`, a ternary, or an `&&`, and the branch it guards passes too.
  3. A receiver the file binds to its own class or object, declaring the member, isn't the built-in, which clears both hits in the whole framework's bundle, its own `ArrayUtils.flatMap` (measured, [log][check]).
  4. Anything else allowed goes in the data file, as a receiver's name or a source path matched through the map, each with its reason, and never as a comment, which a minified bundle drops.
- **Its report** names each failure's file, line, and column in the bundle, then in the source through esbuild's map, then the source's line, so a failure in a bundle points at our TypeScript (measured on a prototype of the check, [log][check]).
- **When it runs.** In CI, on every file we ship into the sim, and after each edit: a hook rebuilds our in-sim bundles with esbuild and checks them, in about 0.3s after an edit to our code in the sim ([core results][stage5]), and its findings come back to the agent as prose-lint's do.
  Experiments' panel files, which are JavaScript as written, get the check alone.
- **No ESLint config in v1.**
  The hook gives the same findings at our TypeScript's line, and typescript-eslint refuses TypeScript 7, so a config would need TypeScript 6 installed beside it (measured, [log][check]); one generated from the same data file can come later.
  ESLint with eslint-plugin-es-x as the check itself ran about 3 times slower, has no rule for any web API or for `Intl`, and in its aggressive mode put 172 false hits on one bundle (measured, [log][check]).
- The data file holds what [Coherent GT's JavaScript](../architecture/coherent-gt.md) lists.
- **CSS.** The check also reads each CSS file we ship into the sim, with css-tree, and passes only what p14 measured the engine keeping ([tentative decisions](../interface/decisions.md#the-coherent-gt-check-covers-the-css-we-ship-into-the-sim)).
  Its README says what each part of a rule passes on, and its known gaps.
- **Where it lives.** The check is its own repository, `dual-input/coherent-checks`, which our `package.json` installs from GitHub, with npm's lockfile pinning the commit.
  The hook stays with us, in `tools/coherent-hook.ts`, since it names our folders and runs our build.

### No for-of rewrite

No step of the build rewrites `for`-`of` loops, which settles the spine's [left open](../architecture/01-spine.md#left-open) item without its frame-time probe:

- The framework's transformer needs TypeScript 5's type checker, through ts-patch, which neither esbuild nor TypeScript 7 runs (read and measured, [log][check]).
- The framework's published bundle already runs 140 `for`-`of` loops its transformer couldn't rewrite, over its Maps, Sets, and generators, and esbuild's own helpers for object spread and rest at `es2017` run one on each call (measured, [results][checkresults]).
- We found no measurement anywhere of what a `for`-`of` costs in Coherent GT ([log][check]), so the apps' stage writes an index loop wherever its own measurements find a hot one.

## The message crate's hash

- **What it covers.** The message crate's build script hashes, with SHA-256:
  - its `Cargo.toml`, its build script, and every file under `src/`, in the order of their paths, each with CRLF taken as LF, so a checkout's line ends change nothing;
  - then the name and version of every package the workspace's `Cargo.lock` reaches from the message crate, serde, serde_json, and postcard among them.
  It writes the hash as lowercase hex into `messages::HASH`.
  It tells Cargo to run it again only when one of those files changes, since a build script with no `rerun-if-changed` runs again on any change in its package (documented, [Cargo's build scripts](https://doc.rust-lang.org/cargo/reference/build-scripts.html#rerun-if-changed)), and `tools/build.ts` writes the crate's `ts/` folder on every build.
- So the hash covers each message's fields and every encoding its types take, JSON, postcard, a data slot's struct, or the helper's binary, and a new version of a codec, where FS Copilot's fingerprint covers a type's fields and not its codec ([09-05](../../learn/foundations/09-05-versions-and-security.md#serialization-protocol-versioning-and-compatibility-between-app-versions)).
- Two development builds that differ by a comment in the crate refuse each other, which costs a release nothing, since every component of a release carries one commit's hash.
- **In the desktop app.** The desktop app, a Cargo workspace of its own, compiles the message crate against its own `Cargo.lock`, while the build script hashes the root's, the first lock it finds above the crate.
  So `tools/check.ts` fails when `cargo tree` shows the message crate reaching a package version through the desktop app's lock that it doesn't reach through the root's, so whenever the check passes, the hash covers what the desktop app compiles.
- **To TypeScript.** `.cargo/config.toml`'s `[env]` table, beside [the C runtime](#the-c-runtime)'s entry, sets ts-rs's `TS_RS_EXPORT_DIR` to the message crate's `ts/` and `TS_RS_LARGE_INT` to `number`, so a plain `cargo test` writes the types there ([log][workspace]), and `TS_RS_IMPORT_EXTENSION` to `ts`, so a generated type imports another by its whole file name, as Node resolves our tools' imports ([log][package]).
  The same `cargo test` that writes ts-rs's types writes `src/engines/messages/ts/stamp.ts`, holding the version and the hash, so it's committed beside the types, and CI's check for a difference after it generates them again covers it ([building every target](../architecture/02-code-map.md#building-every-target)).
  The hash covers nothing in `ts/`, so writing the stamp never changes it.

## Each component's version and hash

| Component | Its version | Its hash |
| --- | --- | --- |
| The core, the core helper, and the WASM module | `CARGO_PKG_VERSION`, which each crate inherits from `[workspace.package]` | `messages::HASH` |
| The desktop app's Rust side, and its program's Windows version resource | `CARGO_PKG_VERSION`, from its own `Cargo.toml`, since it's a Cargo workspace of its own, and `tools/check.ts` fails if that differs from the root's | `messages::HASH`, from the root's `Cargo.lock` ([the message crate's hash](#the-message-crates-hash)) |
| Our code in the sim | `stamp.ts` | `stamp.ts` |
| Our package's `manifest.json` | `tools/build.ts` | None |
| The backend | None: it compares the version and hash the host posted with each joiner's | None |

With `tauri.conf.json` naming no version, a plain `cargo build` writes the crate's version into the program's Windows version resource, which needs no `--config`, since the crate names its version outright (measured on our development machine, 2026-11-04, [log](log.md#2026-11-04-a-plain-cargo-build-writes-the-desktop-programs-windows-version-resource-from-its-crate)), and that settles the code map's [left open](../architecture/02-code-map.md#left-open) item on it.

## CI

Beside the code map's [CI](../architecture/02-code-map.md#ci):

- **The runner** is `windows-latest`, Windows Server 2025 with Visual Studio 2026, which in its image of 2026-10-07 holds .NET SDKs 8 to 10, rustup, Node 22, LLVM 20.1.8, the GitHub CLI, the C++ workload, and the Windows SDK (documented, [Windows2025-VS2026's readme](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-VS2026-Readme.md)).
  It sets no `LIBCLANG_PATH`, so CI sets it to the image's LLVM for bindgen (read, [results][velopack]).
- **The workflows** are in `.github/workflows/`: `ci.yml` for every pull request and every push to `main`; `release-pr.yml` on every push to `main`; `release.yml` and `backend.yml`, which start when a run of `ci.yml` on `main` passes; and `profiles.yml`, the profiles' job.
- **A pull request that changes code also runs** the unit tests and the bench, as [what keeps CI green](02-testing.md#what-keeps-ci-green) gives them.
  A change is code unless every file it changes is in `profiles/`, `record/`, `docs/`, `experiments/`, or `.claude/`, or is Markdown, which `node tools/ci.ts changes` reads from the pull request's merge commit, and a push to `main` runs every job.
- **`ci.yml`'s jobs:** one runs `node tools/check.ts`; one builds the bench's programs, and one runs each scenario; the profiles' job runs for a pull request that changes `profiles/` and no code, and publishes on every push to `main`; and the last, `ci`, named "All checks passed", fails when any other failed or was canceled.
  The profiles publish on every push rather than on those that change a bundle, since a newer push cancels the run before it, and publishing adds nothing when no bundle changed, so a canceled run's bundles publish with the next.
- **`main`'s branch protection requires "All checks passed" alone,** the `ci` job's name, since GitHub counts a job its condition skipped as passed, and a skipped matrix job reports under no scenario's name, so a required check named for a scenario would never report on a pull request that changes no code.
- **A pull request also checks** the files compiled with the sim against `source.json`, and the stock files against `stock.json`.
- **`tools/check.ts`** builds the module and fails unless it exports what p03 checked, as [CI](../architecture/02-code-map.md#ci) has a pull request do, runs [the Coherent GT check](#the-coherent-gt-check), and checks the stock files against `stock.json`.
- **A pull request's build carries no relay tokens,** and the network's tests run through a local relay with a test token (user, 2026-10-18; [cases for the bench](../network/02-units.md#cases-for-the-bench)).
- **Each step runs one command,** a script in `tools/` where a step needs more, since a PowerShell step's result is its last native command's exit code (documented, [log][vpk]), and each script stops at its first failing command.
- **Caches** hold the SDK's folder, keyed on its version, and each job's Cargo dependencies, through `Swatinem/rust-cache`, and each action is pinned by its commit, with its tag beside it.
- **The profiles' job** is one reusable workflow, which `ci.yml` and the release workflow both call as a job, since a release published with the workflow's own token starts no other workflow (documented, [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)).

## A release

A release is merging a pull request, and nothing else is done by hand (user, 2026-11-21).
On each push to `main`, `release-pr.yml` runs `node tools/release.ts pr`, which reads the commits since the newest release's tag:

- Their conventional titles give the next version, as [writing.md](../../../.claude/rules/writing.md#commit-messages) has them: a breaking change raises the major, or before 1.0 the minor; a `feat` raises the minor; and a `fix` or `perf` the patch.
  While none of them is a `feat`, `fix`, or `perf`, there's nothing to release, and it does nothing.
- It rewrites the `release` branch as `main` plus one commit, `chore(release): <version>`, which writes the version into the root `Cargo.toml`'s `[workspace.package]`, the desktop app's `Cargo.toml`, our crates' entries in both `Cargo.lock` files, the entries with no `source`, and `stamp.ts`'s `VERSION`.
  The message crate's hash leaves out the crate's own version, so the bump doesn't change it.
- It opens the release pull request from that branch, or updates the one open, with the release's notes so far as its body: each `Release-Note:` trailer, grouped as New for a `feat`, Fixed for a `fix` or `perf`, and Changed for the rest.
- Between a release commit's merge and its tag, `main` holds a version no release has yet, and it waits.

The workflow's own token pushes the branch and opens the release pull request, so GitHub holds the pull request's CI run for a maintainer's approval rather than starting it (measured, 2026-11-21, [log][published]), and nobody approves it, which keeps CI from running twice on every push to `main`.
So `ci` never reports there, and an admin merges it past the check, with a rebase or a squash.
Nothing ships unchecked: the merge is a push to `main`, and `ci.yml` checks the merged commit before anything is released (user, 2026-11-21).

When a run of `ci.yml` on `main` passes on a commit whose title is `chore(release): <version>`, `release.yml` releases that commit.
A squash merge adds ` (#<n>)` to the title, which changes nothing.
The first release, 0.1.0, has no tag before it to count commits from, so its commit is pushed to `main` by hand, empty, with that title.
It reads the version from the root's `[workspace.package]`.
Each step of its build and publish jobs runs one command, each of the release's own through `node tools/release.ts`, which reaches GitHub through `gh` and `vpk` with the job's token.

The **build job**, whose token reads the repository and can't write to it:

1. It stops unless the commit's title names the version the tree holds, and when a published release of that version exists.
   A draft of that version doesn't stop it, since the publish job deletes the draft.
   CI passed on the commit, or the workflow wouldn't have started, so it runs neither the checks nor the bench again (user, 2026-11-20).
2. It checks out `dual-input/relay-tokens`, the private repository of the relays' tokens ([their configuration](../network/02-units.md#their-configuration)), with a read-only deploy key from this repository's secrets (user, 2026-10-18), then installs the toolchain and runs `npm ci` and `node tools/setup.ts`.
3. It runs `node tools/build.ts release` ([what a release holds](#what-a-release-holds)); the network crate's build compiles each release's default relay list from `src/relays/relays.toml` and that checkout, and stops when a relay in `relays.toml` has no token.
4. It runs `vpk download github`, which fetches the newest release's full package so `vpk pack` can make a delta, and fails unless that package is the one `releases/latest` holds, or none came and no release is published.
   That one check catches both ways the delta's base goes wrong: `vpk` exits 0 having fetched nothing, and its feed takes in any draft its token can list ([log][vpk]).
5. It runs `vpk pack` with the desktop app as the main program, `--framework webview2`, and `--shortcuts StartMenuRoot` ([the installer and the updater](../install/01-installing-and-updating.md#the-installer-and-the-updater)), and keeps what it wrote as the job's artifact.
   It passes the release's notes, from the trailers since the last release, as `--releaseNotes`, which `vpk upload github` makes the release's body (read, [results][velopack]).
   It also passes `--packId DualInput`, which never changes, since Setup.exe's folder most likely takes that name (inference, [results][velopack]), and `--noPortable`, so no release carries a portable copy that no design covers.
   `vpk` is installed with `dotnet tool install` at the version `Cargo.lock` gives the desktop app's `velopack` crate, since `vpk` packs its own Update.exe, which that crate drives, and doesn't check that the two match for a Rust program (read in velopack 1.2.161, [results][velopack]).

The **publish job**, whose token can write releases, then:

1. Deletes a draft of this version that a failed run left, since `vpk upload github` refuses a tag that exists ([log][vpk]), and runs `vpk upload github` without `--publish`, naming the commit it built as the tag's target, which leaves a draft no pilot sees ([log][vpk]).
   `vpk` takes the token from `VPK_TOKEN`, so no command line in the job's log shows it (read in velopack 1.2.161, `src/vpk/Velopack.Vpk/Commands/BaseCommand.cs`).
2. Checks the draft: that its assets hold every file `vpk pack` listed in `assets.win.json`, and that its `releases.win.json`, the file `GithubSource` reads, lists this version's full package, and this version's delta whenever the build job fetched a base, since the draft's feed lists only this build's packages ([log][vpk]), and the API's asset path reaches a draft's file (measured, 2026-11-21, [log][published]).
3. Publishes the draft as the newest release, through GitHub's API.

A third job, which needs the publish job, calls the profiles' workflow, which publishes the bundles at any level this release brings ([publishing](../profiles/02-units.md#publishing)).

- A release with nothing attached stops at the draft's check, where fsc-editor's v0.1.0 shipped empty while its publisher logged a warning and exited 0 (fsc-editor, commit 7b2348e).
- A run that fails partway is run again with GitHub's "Re-run failed jobs".
- A release commit's CI run has a concurrency group of its own, so a newer push to `main` can't cancel it.
- When CI fails on a release commit for a real reason, `main` holds a version no release has, and the release pull request waits; once a fix is on `main`, an empty `chore(release): <that version>` commit pushed by hand releases it.
- GitHub refuses a release whose commit's `.github/workflows/` differs from `main`'s to any token that can't change workflows, and no workflow's token can (documented, [create a release](https://docs.github.com/en/rest/releases/releases#create-a-release)), so a workflow change that reaches `main` while a release runs stops it, as one stopped 0.1.0's first run ([log][workflows]).
  The build job checks before it builds, and the publish job again before its upload, each stopping with a message that names the recovery: the same empty commit, which releases from `main`'s tip.
  The gap is a known limit, rather than a GitHub App whose token could change workflows (user, 2026-11-21).
- The publish job ends by starting `release-pr.yml`, so a `feat` or `fix` merged while the release ran gets its release pull request without waiting for a push.
- GitHub lets a workflow's token open a pull request only where the organization and the repository both allow Actions to create and approve pull requests, which both do (user, 2026-11-21).
- A squash merge takes the pull request's title and description as its commit's, a repository setting, so a contributor's `Release-Note:` trailers in the description reach `main`, where GitHub's default would list the pull request's commits instead (user, 2026-11-21).
- No session in the sim checks a release first: the bench checks behavior on every push, and the stages' own sessions in the sim check what only the real sim shows, so a release that breaks something there is followed by a fix's release (user, 2026-11-21).
- The tag is the bare version, such as `1.0.0`, as `vpk upload github` writes it (read, [results][velopack]), and the profiles' job reads each release's level from those tags.
- Every release on the repository is Dual Input's, so the newest 10 releases `GithubSource` lists are ours; the Coherent GT check's releases are its own repository's.

## The backend

- The backend deploys on its own, apart from releases: whenever a run of `ci.yml` on `main` passes, `backend.yml` runs D1's migrations and then `wrangler deploy`, through `node tools/backend.ts deploy`, with a Cloudflare token from the repository's secrets (user, 2026-11-21).
  So the backend running is `main`'s, and a path a release's cores use is live before that release ships, since its release commit comes after it on `main`.
  A deploy whose commit `main` has moved past deploys nothing, since a CI run passing late, such as one run again, would otherwise put an older Worker over `main`'s, on a D1 holding `main`'s newer migrations.
  The workflow can also be run by hand on `main`, to deploy again.
- `wrangler.jsonc` names the D1 database that `wrangler d1 create` made in Cloudflare once, by hand, since a deploy makes no database.
- The backend answers older releases' cores too, so a change to a released path's request or answer goes on a new path beside it, such as `/v2/lookup` ([its requests](../network/02-units.md#its-requests)).
  Each path's tests send its request written out as literal JSON, which once a release serves that path is never edited, only added to, so the backend's own tests catch a change that would break an older core, with no job of their own (user, 2026-10-22; [build plan](plan.md#7-the-network)).

## Authoring tools

v1 ships no authoring tool (user, 2026-10-18):

- `dualinput-profile-builder` and `tools/profile-author` run from the repository with `cargo run`, for the core team, and CI's profiles' job runs the builder to publish.
- Both are Rust on the workspace's engines and platform crates, and the profile author tool needs the SDK too, so running one from a clone takes [the workspace](../architecture/02-code-map.md#the-workspace)'s whole setup on a new PC, which a pilot who writes YAML won't have; the IDE brings authoring to them later (user, 2026-10-18).
- A contributor without that setup can still send a profile's change as a pull request, and CI's check reports on it, while testing a bundle in their own core waits for the IDE.
- That settles the profiles' units' [left open](../profiles/02-units.md#left-open) item on the builder program: it keeps the name `dualinput-profile-builder`, and authors get it with the repository.

## The graphics

Three tools draw the pictures Dual Input presents itself with, from the tree, so each changes with what it shows and none is drawn by hand ([build plan](plan.md#22f-the-graphics)).
Their looks are the interface's [tentative decision on the icon and the preview](../interface/decisions.md#dual-inputs-icon-is-the-sky-glyph-on-the-apps-background-and-the-sims-toolbar-and-efb-get-the-glyph-alone-in-white).

| Tool | Draws | From |
| --- | --- | --- |
| `node tools/icons.ts` | The desktop app's `src/apps/desktop/icons/icon.ico`; our app's icon in the EFB and the banner's toolbar icon, `efb-icon.svg` and `banner-icon.svg` in `src/sim-package/pages/`; and `target/icons/avatar.png`, for our GitHub organization and Discord server | The glyph's path and how the icon places it, in `src/packages/ui/src/glyph.ts`, which the kit's mark draws from too, and the palette |
| `node tools/splash.ts` | Setup.exe's splash, `src/apps/desktop/icons/splash.gif` | Its own code |
| `node tools/screenshots.ts` | A picture of every scene of the apps' dev pages, a layout beside each, and the repository's social preview, in `docs/screenshots/` | The dev pages' stand-in cores, whose sessions are made up, so no real pilot's data shows |

A person uploads the avatar and the social preview in GitHub's and Discord's settings when either changes, since no tool of ours changes an account's settings.

### The screenshots

- The tool builds the EFB app's, the banner's, the desktop window's, and the welcome's dev pages as `tools/dev.ts` builds them, with the list of pages in `tools/lib/dev-pages.ts`, opens each scene in the Edge that Windows installs, through playwright-core, and takes a picture of the element the page names, at 2x.
  `node tools/screenshots.ts efb` takes one page's scenes, and `node tools/screenshots.ts efb "James flying"` one scene.
- A scene is the page's own: each dev page puts three things on `window.DUALINPUT_DEV`, its scenes' names, a `show` function that switches to one, and the element to picture, and it starts on the scene its address names, as `?scene=Preflight`.
  A scene of the EFB app's can name the tab it shows, and can run longer than the default 5s before its picture: setup's scenes run 12s, since its checks reach the name card at about 9s.
  So a new screen gets its picture from a new scene in its page's stand-in, and the stand-in's scenes are what "every state" means.
- Every picture stays in the tree, as `docs/screenshots/<page>/<scene>.png`, the scene's name in lowercase with dashes between its words, so a doc links any state with no run first (user, 2026-11-21).
  `docs/screenshots/README.md` shows them all, each under its scene's name and its path.
  They're PNGs of up to 256 colors, which drew the same as full ones on the apps' screens at half the bytes: 105 pictures took 3 MB.
  A whole page's run deletes the pictures of scenes that are gone, and names each, since a doc may still link it.
- A picture of an unchanged screen comes out the same, byte for byte, and the tool writes a picture or a layout only when its bytes differ from the file's, so after a run `git status` lists only the pictures whose screen changed.
  It takes all of these ([build log](log.md#2026-11-21-a-picture-of-an-apps-screen-comes-out-the-same-on-every-run-once-its-clock-fonts-motion-chance-drawing-and-standing-figure-are-held)):
  - Playwright's clock, paused from the page's start and run 5s in 100ms steps.
    React renders in tasks it posts on a `MessageChannel`, so after each step the page posts three tasks of its own on one, which run after React's.
  - every font loaded before the clock starts
  - every CSS animation and transition ended at once
  - `Math.random` seeded
  - Edge drawing in software, `--disable-gpu`, with text smoothed in gray, `--disable-lcd-text`
  - the EFB app's standing figure held still, through the figure's `FigureStill` context, which only the dev page sets
  - the picture taken again until two in a row match
- Beside each picture, `<scene>.json` says where each labeled element shows in it, so the docs site can crop a picture around one element, and its build fails when a label it crops around is gone (stage 22e, 2026-11-21):

  ```text
  { "width": 1074, "height": 1518, "scale": 2, "elements": [
    {"role":"button","label":"Host a session","x":83,"y":353,"width":908,"height":83},
    ...
  ] }
  ```

  `width` and `height` are the picture's size in its own pixels, and `scale` is how many picture pixels make one CSS pixel of the page, along each axis.
  An element is a node of Chrome's accessibility tree with a role and a name, other than text alone and the page itself, in the tree's order, two of a role and a name both kept.
  Its role is Chrome's, and its label is its accessible name, the words a pilot sees or a screen reader reads.
  `x` and `y` are the element's top-left corner, in picture pixels from the picture's top-left corner, and its `width` and `height` are measured after its box is cut to each ancestor that clips it and to the picture.
  An element that isn't drawn, is under 5% opaque, or is clipped out of the picture has no entry, and neither does an icon button the app gives no name.
- Every run also draws `docs/screenshots/social-preview.png`, 1280x640, from the EFB app's "Flying together" over a night valley from the sim, `tools/screenshots/night-valley.webp`, and the README opens with it.

The tool can't picture what no dev page draws: the cockpit's locks, the sim's own screens, and Velopack's windows.
Its pictures are Edge's drawing, while the sim draws the same pages with Coherent GT, which can differ ([its measured limits](../architecture/coherent-gt.md)); the dev loop's debugger shows Coherent GT's drawing.

## Budgets

Each is a starting value:

| What | Budget |
| --- | --- |
| A pull request's CI, with a warm cache | The code map's [budgets for the workspace](../architecture/02-code-map.md#budgets-for-the-workspace), which the first stage of [node 8](../architecture/plan.md#8-the-build-order) that builds real code measures with `cargo build --timings` |
| The check on a 2.5 MB bundle, Node's start included | Under 1s; 458ms on the framework's (measured, [log][check]) |
| The hook's findings after a save | Under 1s; about 0.3s after an edit to our code in the sim (measured, [core results][stage5]) |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test.

In the sim:

- From our `PANEL_PATCH` package, the figure spawns, and our BlurPage copy, the banner's in-game panel, and the EFB app load.
- With FS Copilot's package installed, its `VCockpit.js` wins over ours, and the clients crate's notification when no cockpit panel connects names another package's `VCockpit.js` as the likeliest cause; in this case's one run, ours won instead ([installing log](../install/log.md#2026-10-22-our-vcockpitjs-won-over-fs-copilots-though-fscopilot-bridge-sorts-after-dualinput-with-the-same-order-hint)).
  With YourControls' installed, ours wins.

On a desk:

- A build with `RUSTFLAGS` set, even empty, stops at `src/apps/core`'s guard, and one whose installed SDK isn't `msfs-sdk.txt`'s stops and names `node tools/setup.ts`.
- No shipped program imports `VCRUNTIME140.dll`, and the core imports no `api-ms-win-crt-*` DLL, by `dumpbin /imports`.
- A change to the message crate committed without the stamp generated again fails CI; one commit built on two PCs, one checked out with CRLF line ends, gives one hash; and a `tools/build.ts` run followed by `cargo build` compiles no crate.
- A development build of the desktop app writes nothing to `Community`, and `tools/build.ts install` writes the package and refuses while the sim runs.
- A figure source changed without a recompile fails CI.
- A stock file the sim changed stops a developer's build on the public branch, warns on a beta branch, and `tools/stock.ts` brings it in only from the public one.
- A release with none before it publishes with no delta, the next publishes with one, and one whose upload fails leaves a draft that the next run deletes before it publishes.
- A release run for a version that's published stops at its first step.

## Left open

- The check's name, and whether our `package.json` takes it from npm or from its repository: its repository's, when it's made.
- Whether Microsoft keeps serving older SDK installers: a build of a commit whose SDK it stopped serving can't run, so a rebuild for added logging, to replay a recording with, would then need that SDK kept elsewhere.
- Whether the Microsoft Store edition keeps the stock files where a program can read them ([log][stock]).
- Why our `VCockpit.js` won over FS Copilot's in one flight with both packages installed, against the documented rule ([installing log](../install/log.md#2026-10-22-our-vcockpitjs-won-over-fs-copilots-though-fscopilot-bridge-sorts-after-dualinput-with-the-same-order-hint)).

## What this changes elsewhere

The text or the notes at the top of [the code map](../architecture/02-code-map.md), [the spine](../architecture/01-spine.md), [01-loop-and-edge](../core/01-loop-and-edge.md), [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md), [the profiles' units](../profiles/02-units.md), [avatars](../avatars/01-avatars.md), [installing and updating](../install/01-installing-and-updating.md), and [the network's units](../network/02-units.md) list what this design changes there, and the [tentative decisions](../architecture/decisions.md#every-x86_64-program-links-the-c-runtime-statically-through-one-line-of-the-workspaces-cargo-config) give the reasons.

[stock]: log.md#2026-10-18-the-sims-stock-vcockpitjs-is-on-disk-in-our-steam-install-in-asobo-vcockpits-core-not-streamed
[compiled]: log.md#2026-10-18-fspackagetool-starts-the-sim-to-build-and-the-sim-re-encodes-the-figures-vertices-and-compiles-an-in-game-panels-definition-to-binary
[sdk]: log.md#2026-10-18-the-sdks-listing-links-only-its-newest-two-versions-and-every-older-installer-we-tried-is-still-served
[crt]: log.md#2026-10-18-one-line-of-cargo-config-links-every-x86_64-programs-c-runtime-statically-and-alternating-with-cargo-msfss-build-rebuilds-nothing
[check]: log.md#2026-10-18-acorn-at-es2017-fails-every-p09-sample-the-engine-fails-and-the-frameworks-whole-bundle-gives-two-false-hits-by-name
[vpk]: log.md#2026-10-18-vpk-uploads-a-draft-unless-told-to-publish-and-two-of-its-paths-exit-0-having-shipped-less
[workflows]: log.md#2026-11-21-github-refused-010s-release-since-a-change-to-ciyml-reached-main-after-its-release-commit
[published]: log.md#2026-11-21-010-published-from-a-release-commit-at-mains-tip-and-toolsreplayts-replayed-the-released-cores-own-recording
[workspace]: log.md#2026-10-18-cargo-refuses-a-member-glob-that-matches-no-folder-or-a-folder-without-a-cargotoml-and-typescript-702s---explainfiles-lists-a-type-only-import
[bindgen]: log.md#2026-10-20-bindgen-builds-the-windows-sides-simconnect-types-with-the-static-c-runtime-and-ts-rss-derive-reaches-windows-sys
[package]: log.md#2026-10-21-bindgen-brings-the-freeze-events-numbers-into-our-wasm-module-and-the-module-its-package-and-the-cores-simconnectdll-build-from-the-tree
[msfs]: results/2026-10-18-msfs-packages-and-sdk.txt
[velopack]: results/2026-10-18-velopack-in-ci.txt
[crtresults]: results/2026-10-18-static-c-runtime.txt
[checkresults]: results/2026-10-18-coherent-gt-check-blocks.txt
[stage5]: ../core/results/2026-10-22-stage-5-budgets.txt
