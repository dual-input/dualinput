# The build

```text
Purpose:     How one repository's code becomes a checked release: what a release holds, the checks the build runs, the Coherent GT check, the message crate's hash, and how CI packs, checks, and publishes each release.
Depends on:  ../architecture/02-code-map.md, ../architecture/01-spine.md, ../architecture/coherent-gt.md, ../install/01-installing-and-updating.md, ../profiles/02-units.md, ../core/01-loop-and-edge.md, ../core/02-clients-and-panel-bridge.md, ../avatars/01-avatars.md, ../network/02-units.md, log.md
Decides:     What a release holds; how every x86_64 program links the C runtime statically; which SDK the build uses; where the sim's stock files live and how a sim update that changes them shows; our package's folder name, order hint, and contents; how the files only the sim compiles get built; how the Coherent GT check is built and when it runs, and that no for-of rewrite runs; how the message crate is hashed, and how the version and the hash reach each component; how a release is built, checked, and published, and when the backend deploys; and that v1 ships no authoring tools (node 6.18).
```

`tools/build.ts` builds every target into one folder, which becomes a release's `current\`: the desktop app, the core, the core helper, the SDK's `SimConnect.dll`, and our one Community package, `crosscheck`.
One line of Cargo config links every x86_64 program's C runtime statically, the build installs the SDK version the repository names, and the sim's stock files that our `VCockpit.js` and BlurPage copy start from live in the tree.
The Coherent GT check is a Node tool of its own on acorn, run on every bundle after each edit and in CI, and the message crate's hash is SHA-256 over its own source and the locked versions of what it depends on.
A release runs by hand on `main`: a job that can't write to the repository builds, checks, and packs it, and a job that can uploads it as a draft, checks the draft, deploys the backend, and publishes it.

This answers node 6.18 of the [architecture plan](../architecture/plan.md#618-the-build).
The code map's [workspace](../architecture/02-code-map.md#the-workspace), [installing and updating](../install/01-installing-and-updating.md#the-installer-and-the-updater), the profiles' [publishing](../profiles/02-units.md#publishing), the spine's [compiling our code in the sim](../architecture/01-spine.md#compiling-our-code-in-the-sim) and [the check](../architecture/01-spine.md#the-check), and decisions [025](../../decisions/025-messages-in-one-rust-crate.md), [026](../../decisions/026-first-message-carries-version-and-hash.md), [030](../../decisions/030-in-sim-code-es2017-esbuild.md), and [031](../../decisions/031-coherent-gt-check-tool.md) give the rules this design builds on, and this document holds only what they leave out.
The research behind it is in this area's [log](log.md).

## What a release holds

`node tools/build.ts release` lays out one folder, which `vpk pack` packs and Setup.exe installs as `current\`:

| In the folder | Built by |
| --- | --- |
| `crosscheck-desktop.exe` | `tauri build --no-bundle`, which builds the desktop app's pages and then its Rust side with Tauri's `custom-protocol` feature, so the program serves its built pages rather than looking for Vite's server, as a plain `cargo build` of it would (read in tauri-cli 2.12.3, [results][velopack]) |
| `crosscheck-core.exe` and `crosscheck-core-helper.exe` | `cargo build --release` |
| `SimConnect.dll` | Copied from the pinned SDK ([the SDK](#the-sdk)), for the core, which loads it from its own folder |
| `crosscheck\` | Our Community package ([our package](#our-package)) |

- **The desktop app's version.** `tauri build` gets the version from the root's `[workspace.package]` through `--config`, since Tauri's CLI and the running app read a version the crate inherits, while the program's Windows version resource comes only from `tauri.conf.json`'s own (read in tauri-cli 2.12.3 and tauri-build, [results][velopack]).
  That settles the code map's [left open](../architecture/02-code-map.md#left-open) item on it.
- **The WASM module's list** holds `Follow`, `Lead`, `HEvents`, and `Traffic`, and no `Mechanisms`, since v1 has no plugins; `object-mirror` builds for wasm32 in the module and for x86_64 in the core.
- **The panel modules** build into `/Crosscheck/modules/`, state sync's `h-events` and `instrument-reads` among them.
- **The network crate** compiles each release's default relay list from `relays/relays.toml` ([their configuration](../network/02-units.md#their-configuration)).
- **The tools,** `tools/profile-builder` and `tools/profile-author` among them, build with the workspace, and no release carries them ([authoring tools](#authoring-tools)).

## The C runtime

The root's `.cargo/config.toml` holds one entry, so every program `cargo build` builds for x86_64 links the whole C runtime statically: the core, the core helper, the desktop app's Rust side, the tools, and the tests.

```toml
[target.x86_64-pc-windows-msvc]
rustflags = ["-C", "target-feature=+crt-static"]
```

- With it, p11's core imported no C runtime DLL, where without it the program imported `VCRUNTIME140.dll` and five `api-ms-win-crt-*` DLLs, and it grew from 153,088 to 251,904 bytes (measured on our development machine, 2026-10-18, [log][crt]).
  - So the core's math is its own program's, as [the core's math](../core/01-loop-and-edge.md#the-cores-math) needs.
  - No program needs the Visual C++ redistributable, which Microsoft has applications deploy and which asks for an administrator as it installs (documented, [results][crtresults]); Velopack's `--framework vcredist143-x64` would put that prompt into our per-user install, so no release uses it.
- cc compiles C code, such as QuickJS-ng's, with `-MT` when the flag is on, so all of a program's code takes one runtime (read in cc 1.8.0, [results][crtresults]).
- **The module's build.** cargo-msfs's own `RUSTFLAGS` outrank the entry, so the module builds as it does without it, and after the first build each of four, alternating `cargo build` and cargo-msfs's, compiled no crate (measured, [log][crt]).
  That holds from Cargo 1.85, which gives a crate built with other flags files of its own, so `rust-toolchain.toml` names 1.85 or later.
- **The desktop app.** `tauri.conf.json` turns Tauri's `build.windows.staticVCRuntime` off, so the entry decides the desktop app's runtime too, where Tauri's own default links the UCRT through Windows' copy for that one program (measured, [log][crt]).
- **A guard.** A `RUSTFLAGS` of any value, an empty one included, replaces the entry without a word (measured, [log][crt]), so `apps/core` stops a build that lacks the flag:

  ```rust
  #[cfg(all(target_env = "msvc", not(target_feature = "crt-static")))]
  compile_error!("crosscheck-core must link the C runtime statically: RUSTFLAGS replaced the +crt-static of .cargo/config.toml");
  ```

  CI installs Rust with rustup from `rust-toolchain.toml`, rather than through `actions-rust-lang/setup-rust-toolchain`, whose v1.17.0 sets `RUSTFLAGS="-D warnings"` by default (read in its `action.yml`, [log][crt]).

## The SDK

- `msfs-sdk.txt` at the root names one SDK version, such as `1.8.1`, and every build uses that version.
- `tools/msfs-sdk` installs it: a Rust program adapted from cargo-msfs's `install_latest_sdk`, under cargo-msfs's MIT license, on the crates that code uses, `reqwest`, `zip`, `msi`, and `cab`.
  It downloads `https://sdk.flightsimulator.com/msfs2024/files/installers/<version>/MSFS2024_SDK_Core_Installer_<version>.zip`, unpacks the installer's files into `%APPDATA%\cargo-msfs\data\msfs2024` without running it, as cargo-msfs does, and writes `version.txt` there with the version alone.
- `tools/setup.ts` runs it whenever that version differs from the root's, so `cargo-msfs build` and the Windows side's bindings read the SDK from the same folder, and cargo-msfs's own `install` and `update` go unused.
- The listing cargo-msfs reads links only the newest two SDKs, while each of the 10 older installers we asked for was still served (measured, 2026-10-18, [log][sdk]), so a build of an old commit, such as a replay's ([running a replay](../core/01-loop-and-edge.md#running-a-replay)), installs the SDK that commit built against.
- A new SDK reaches the build only through a commit that changes `msfs-sdk.txt`, which settles the code map's [left open](../architecture/02-code-map.md#left-open) item on an SDK newer than a release's.
- CI caches the SDK's folder, keyed on that version.

## The sim's stock files

- `sim-package/stock/` holds the sim's `VCockpit.js`, and BlurPage's `.html` and `.json`, byte for byte as the sim ships them, and `stock.json`, which names the sim release they came from and each file's SHA-256.
  `.gitattributes` marks the folder `-text`, so git never rewrites their CRLF line ends and the hashes hold on every checkout.
- That puts three of Asobo's files in the public tree, where the sim's other files we read stay out ([commbus log](../commbus/log.md)), since our package ships changed copies of them anyway, and FS Copilot and YourControls keep theirs in their public repositories (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/Pages/VCockpit/Core/VCockpit.js`, and in YourControls/yourcontrols, `scripts/build-include/2024/YourControls/`, [results][msfs]; user, 2026-10-18).
- The build makes our copies from them, putting our blocks in at named anchors, and refuses when an anchor is missing ([our VCockpit.js](../core/02-clients-and-panel-bridge.md#our-vcockpitjs)).
- **A sim update that changes one.** On a PC with the sim's Steam edition, found through Steam's `libraryfolders.vdf` as p10's build finds it (read in `experiments/areas/interface/menu/build.mjs`), `tools/build.ts` hashes the sim's three files, in its `asobo-vcockpits-core` and `fs-base-ui` packages, and stops when one differs from `stock.json`, naming `node tools/stock.ts`, which copies the sim's files in and writes `stock.json` again.
  - A file's own hash is the one sign of its change: Steam's update of 2026-10-14 rewrote both packages' manifests and left the files, and SimConnect's open message read the same version on three sim releases (read and measured, [log][stock]).
  - So the change shows at a developer's first build after the update, the occasion [Coherent GT's JavaScript](../architecture/coherent-gt.md#re-measuring) also gives p09's re-measure, and the commit that brings the files in shows what the update changed, for a release to carry.
- CI has no sim, so it checks only that each file matches `stock.json`.
- The build reads the Steam edition's files, and whether the Microsoft Store edition keeps them where a program can read them is unverified ([log][stock]).

## Our package

- **One package,** in a folder named `crosscheck` with the order hint `PANEL_PATCH`, holds our code in the sim and its pages, our `VCockpit.js` and BlurPage copies, our WASM module, the figure's SimObject, and the banner's in-game panel.
  - FS Copilot's one package holds its WASM module and its `html_ui` both (read in the FS Copilot fork, `FsCopilot.Bridge/PackageDefinitions/fscopilot-bridge.xml`), and the spine's rule of a package for each standalone module keeps two modules apart ([code in the sim](../architecture/01-spine.md#code-in-the-sim)), while we ship one.
  - That settles what [installing and updating](../install/01-installing-and-updating.md#left-open) leaves to this design.
- **The mount order.** Packages mount by their order hint's group, then alphabetically within a group, and the one mounted later wins a file both hold (documented, [Virtual File System Information](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Virtual_File_System_Information.htm)).
  The sim's report on our machine lists packages with no hint first, then `UI_PATCH`, then `PANEL_PATCH`, then `CUSTOM_INSTRUMENT` (read on our development machine, 2026-10-18, [results][msfs]).
  - FS Copilot's package is `fscopilot-bridge`, with `PANEL_PATCH`, and its `VCockpit.js` loaded over the sim's in every panel (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - The prototype module works end to end in the simulator").
    Ours takes that measured setup, and FS Copilot's, later in the alphabet, wins over ours.
  - YourControls' package carries no hint (read, [results][msfs]), so it most likely mounts before ours and loses (inference from the report's order).
  - Either way the sim service's warning names the other package ([packages that override our files](../install/01-installing-and-updating.md#packages-that-override-our-files)), while a name or group that mounted after FS Copilot's would make ours win and break FS Copilot with no word from it.
  - A pilot can reorder packages in Developer Mode's Package Reorder Tool, whose page also calls the order within one priority "not guaranteed" (documented, [results][msfs]).
- A SimObject in a `PANEL_PATCH` package, and our BlurPage copy loading from one, are untried ([cases for the bench](#cases-for-the-bench)).
- `tools/build.ts` writes the package's `layout.json`, and its `manifest.json` with the release's version as `package_version`, as p08's build script does (read in `experiments/areas/architecture/flight/build.mjs`, `finish`).

## Files compiled with the sim

The figure's model and the banner's in-game panel definition are the only files of ours the sim compiles, and the rest of our package is copied as it is ([log][compiled]).

- `fspackagetool` starts the sim to build, so no CI runner can run it ([log][compiled]).
- The figure comes out with Asobo's extension `ASOBO_asset_optimized` and every vertex re-encoded into one 36-byte layout, and the banner's XML definition as a binary `.spb` with its strings encoded (read on our development machine, 2026-10-18, [log][compiled]).
- No tool of ours writes either format, since we'd own two undocumented formats against every sim update for files that rarely change (user, 2026-10-18).
- **When a source changes,** someone on a PC with the sim, closed in full, since `fspackagetool` hangs while the sim runs (measured, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — The module becomes a sub-project, and fspackagetool cannot run with the sim open") and fails while a crashed sim lingers ([avatars log](../avatars/log.md#2026-10-03-a-skinned-stick-took-the-sim-down-in-an-in-sim-build-and-a-crashed-sim-held-fspackagetool-until-it-was-closed)), compiles it and commits what came out into a `compiled/` folder beside the source, with `source.json` holding each source file's SHA-256.
  - The `manifest.json` that `fspackagetool` writes stays out, since `tools/build.ts` writes the package's own, and so does its `_PackageInt\` folder, which holds the home folder's path ([log][compiled]).
  - CI hashes each source and fails when one differs from `source.json`, so a source changed without a recompile fails its pull request.
- The stage of [node 8](../architecture/plan.md#8-the-build-order) that first ships either file writes the procedure and the script for that recompile, for whoever does it months later (user, 2026-10-18).

## The Coherent GT check

[Decision 031](../../decisions/031-coherent-gt-check-tool.md)'s check is a Node program of its own, on acorn, acorn-walk, eslint-scope, `@eslint-community/regexpp`, and source-map-js: 9 packages and 1.4 MB with what they depend on, under MIT and BSD licenses (measured and read, [log][check]).

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
  The data file keeps a name filled in in some documents only apart from a missing one, so the message names those documents, though both fail.
- **A package's own fill-in** passes by five rules:
  1. A definition isn't a use: an assignment to the member, `Object.defineProperty` of it, or a declaration of the global.
  2. A guard isn't a use: `typeof X`, `"x" in Y`, or `Y.x` in the test of an `if`, a ternary, or an `&&`, and the branch it guards passes too.
  3. A receiver the file binds to its own class or object, declaring the member, isn't the built-in, which clears both hits in the whole framework's bundle, its own `ArrayUtils.flatMap` (measured, [log][check]).
  4. A file that installs a fill-in for a name passes its own uses of that name.
  5. Anything else allowed goes in the data file, as a receiver's name or a source path matched through the map, each with its reason, and never as a comment, which a minified bundle drops.
- **Its report** names each failure's file, line, and column in the bundle, then in the source through esbuild's map, then the source's line, so a failure in a bundle points at our TypeScript (measured, [log][check]).
- **When it runs.** In CI, on every file we ship into the sim, and after each edit: a hook rebuilds our in-sim bundles with esbuild and checks them, about 0.7s after a save, and its findings come back to the agent as prose-lint's do (measured, [results][checkresults]).
  Experiments' panel files, which are JavaScript as written, get the check alone.
- **No ESLint config in v1.**
  The hook gives the same findings at our TypeScript's line, and typescript-eslint refuses TypeScript 7, so a config would need TypeScript 6 installed beside it (measured, [log][check]); one generated from the same data file can come later.
  ESLint with eslint-plugin-es-x as the check itself ran about 3 times slower, has no rule for any web API or for `Intl`, and in its aggressive mode put 172 false hits on one bundle (measured, [log][check]).
- **The data file** holds what [Coherent GT's JavaScript](../architecture/coherent-gt.md) lists, and changes with each re-measure, as decision 031 has it.
- The check lives in a repository of its own under Crosscheck's GitHub organization, as decision 031 has it, and our `package.json` pins it at an exact version.

### No for-of rewrite

No step of the build rewrites `for`-`of` loops, which settles the spine's [left open](../architecture/01-spine.md#left-open) item without its frame-time probe:

- The framework's transformer needs TypeScript 5's type checker, through ts-patch, which neither esbuild nor TypeScript 7 runs (read and measured, [log][check]).
- The framework's published bundle already runs 140 `for`-`of` loops its transformer couldn't rewrite, over its Maps, Sets, and generators, and esbuild's own helpers for object spread and rest at `es2017` run one on each call (measured, [results][checkresults]).
- We found no measurement anywhere of what a `for`-`of` costs in Coherent GT ([log][check]), so the apps' stage writes an index loop wherever its own measurements find a hot one.

## The message crate's hash

- **What it covers.** The message crate's build script hashes, with SHA-256:
  - its `Cargo.toml`, its build script, and every file under `src/`, in the order of their paths, each with CRLF taken as LF, so a checkout's line ends change nothing;
  - then the name and version of every package `Cargo.lock` reaches from the message crate, serde, serde_json, and postcard among them.
  It writes the hash as lowercase hex into `messages::HASH`.
- So the hash covers each message's fields and every encoding the crate writes, JSON, postcard, a data slot's struct, or the helper's binary, and a new version of a codec, where FS Copilot's fingerprint covers a type's fields and not its codec ([09-05](../../learn/foundations/09-05-versions-and-security.md#serialization-protocol-versioning-and-compatibility-between-app-versions)).
- Two development builds that differ by a comment in the crate refuse each other, which costs a release nothing, since every component of a release carries one commit's hash.
- **To TypeScript.** The same `cargo test` that writes ts-rs's types writes `engines/messages/ts/stamp.ts`, holding the version and the hash, so it's committed beside the types, and CI's check for a difference after it generates them again covers it ([building every target](../architecture/02-code-map.md#building-every-target)).
  The hash covers nothing in `ts/`, so writing the stamp never changes it.

| Component | Its version | Its hash |
| --- | --- | --- |
| The core, the core helper, the desktop app's Rust side, and the WASM module | `CARGO_PKG_VERSION`, which each crate inherits from `[workspace.package]` | `messages::HASH` |
| The desktop app's program, in its Windows version resource | `tauri build --config` ([what a release holds](#what-a-release-holds)) | None |
| Our code in the sim | `stamp.ts` | `stamp.ts` |
| Our package's `manifest.json` | `tools/build.ts` | None |
| The backend | None: it compares the version and hash the host posted with each joiner's | None |

## CI

Beside the code map's [CI](../architecture/02-code-map.md#ci):

- **The runner** is `windows-latest`, Windows Server 2025 with Visual Studio 2026, which holds .NET SDKs 8 to 10, rustup, Node 22, LLVM 20.1.8, the GitHub CLI, the C++ workload, and the Windows SDK (documented, [Windows2025-VS2026's readme](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-VS2026-Readme.md)).
  It sets no `LIBCLANG_PATH`, so CI sets it to the image's LLVM for bindgen (read, [results][velopack]).
- **A pull request also runs** the check of the files compiled with the sim against `source.json`, the check of `sim-package/stock/` against `stock.json`, and the map check's three additions: its search of `features/` for `impl Moment`, its allowance for the one foreign function `apps/core` declares ([the core's math](../core/01-loop-and-edge.md#the-cores-math)), and its failing a platform unit whose source names a feature's module of the message crate ([a feature's parts](../interface/01-apps.md#a-features-parts)).
- **Each step runs one command,** a script in `tools/` where a step needs more, since a PowerShell step's result is its last command's (documented, [log][vpk]), and each script stops at its first failing command.
- **The backend's tests** run against a local D1 ([cases for the bench](../network/02-units.md#cases-for-the-bench)).
- **The profiles' job** is one reusable workflow that the merge trigger and the release workflow both call, since a release published with the workflow's own token starts no other workflow (documented, [GITHUB_TOKEN](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication)).

## A release

A person runs the `release` workflow on `main` by hand, and it reads the version from the root's `[workspace.package]`.
Every step is one `node tools/release.ts` command.

The **build job**, whose token reads the repository and can't write to it:

1. It stops when a release of that version exists.
2. It installs the toolchain, runs `npm ci` and `node tools/setup.ts`, and installs `vpk` 1.2.161 with `dotnet tool install`, the version of the desktop app's `velopack` crate, since `vpk` packs its own Update.exe, which that crate drives (read in velopack 1.2.161, [results][velopack]).
3. It runs every check a pull request runs.
4. It runs `node tools/build.ts release` ([what a release holds](#what-a-release-holds)).
5. It runs `vpk download github`, which fetches the newest release's full package so `vpk pack` can make a delta.
   It passes the job's own token, which lists no draft, since GitHub lists drafts only to a caller with push access, so a draft a failed run left can't become the delta's base ([log][vpk]); that a read-only token sees none is unverified by a run.
   The step fails when a published release exists and no full package came, since `vpk` then exits 0 and packs no delta ([log][vpk]).
6. It runs `vpk pack` with the desktop app as the main program, `--framework webview2`, and `--shortcuts StartMenuRoot` ([the installer and the updater](../install/01-installing-and-updating.md#the-installer-and-the-updater)), and keeps what it wrote as the job's artifact.

The **publish job**, whose token can write releases, then:

1. Deletes a draft of this version that a failed run left, since `vpk upload github` refuses a tag that exists ([log][vpk]).
2. Runs `vpk upload github` without `--publish`, naming the commit it built as the tag's target, which leaves a draft no pilot sees ([log][vpk]).
3. Checks the draft: that its assets hold the full package, `Setup.exe`, `releases.win.json`, `RELEASES`, and, when a release came before, the delta; and that its `releases.win.json`, the file `GithubSource` reads, lists this version's full package and delta ([log][vpk]).
4. Deploys the backend ([the backend](#the-backend)).
5. Publishes the draft with `gh release edit`, and the release becomes `releases/latest`.
6. Runs the profiles' job, which publishes the bundles at any level this release brings ([publishing](../profiles/02-units.md#publishing)).

- A release with nothing attached stops at the third step, where fsc-editor's v0.1.0 shipped empty while its publisher logged a warning and exited 0 (fsc-editor, commit 7b2348e).
- The tag is the bare version, such as `1.0.0`, as `vpk upload github` writes it (read, [results][velopack]), and the profiles' job reads each release's level from those tags.
- Every release on the repository is Crosscheck's, so `releases/latest` names ours; the Coherent GT check's releases are its own repository's.

## The backend

- The publish job runs D1's migrations and then `wrangler deploy`, with a Cloudflare token from the repository's secrets, just before it publishes, so the backend running is the newest release's, and only once that release has passed every check.
- A second workflow, run by hand, deploys the backend alone, for a fix between releases.
- The newest release's backend answers older releases' cores too, so a change to a request's body takes a new path beside the old one ([its requests](../network/02-units.md#its-requests)).

## Authoring tools

v1 ships no authoring tool (user, 2026-10-18):

- `crosscheck-profile-builder` and `tools/profile-author` run from the repository with `cargo run`, for the core team, and CI's profiles' job runs the builder to publish.
- Both are Rust on the workspace's engines and platform crates, and the profile author tool needs the SDK too, so running one from a clone takes [the workspace](../architecture/02-code-map.md#the-workspace)'s whole setup on a new PC, which a pilot who writes YAML won't have; the IDE brings authoring to them later (user, 2026-10-18).
- A contributor without that setup can still send a profile's change as a pull request, and CI's check reports on it, while testing a bundle in their own core waits for the IDE.
- That settles the profiles' units' [left open](../profiles/02-units.md#left-open) item on the builder program: it keeps the name `crosscheck-profile-builder`, and authors get it with the repository.

## Budgets

Each is a starting value:

| What | Budget |
| --- | --- |
| A pull request's CI, with a warm cache | Within 20 minutes ([budgets for the workspace](../architecture/02-code-map.md#budgets-for-the-workspace)), which the first stage of [node 8](../architecture/plan.md#8-the-build-order) that builds real code measures with `cargo build --timings` |
| The check on a 2.5 MB bundle, Node's start included | Under 1s; 458ms on the framework's (measured, [log][check]) |
| The hook's findings after a save | Under 1s; about 0.7s (measured, [results][checkresults]) |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test.

In the sim:

- The figure spawns from our `PANEL_PATCH` package, and our BlurPage copy loads from it.
- With FS Copilot's package installed, its `VCockpit.js` wins over ours and the sim service's warning names it; with YourControls', ours wins.

On a desk:

- A build with `RUSTFLAGS` set, even empty, stops at `apps/core`'s guard.
- No shipped program imports `VCRUNTIME140.dll`, and the core imports no `api-ms-win-crt-*` DLL, by `dumpbin /imports`.
- A change to the message crate committed without the stamp generated again fails CI, and one commit built on two PCs, one checked out with CRLF line ends, gives one hash.
- A figure source changed without a recompile fails CI.
- A stock file the sim changed stops a developer's build, and `tools/stock.ts` brings it in.
- A release with none before it publishes with no delta, the next publishes with one, and one whose upload fails leaves a draft that the next run deletes before it publishes.
- A release run for a version that exists stops at its first step.

## Left open

- The check's name, and whether our `package.json` takes it from npm or from its repository: its repository's, when it's made.
- What each release's notes say, and who writes them.
- Whether Microsoft keeps serving older SDK installers: a build of a commit whose SDK it stopped serving can't run, and replaying its recordings would then need that SDK kept elsewhere.
- Whether bindgen's build script, for the Windows side's bindings, builds with the static runtime, which the first build of the sim's edge settles ([results][crtresults]).
- Whether the runner's Windows SDK holds the static UCRT, `libucrt.lib`, which the first build on the runner settles ([results][velopack]).
- Whether the Microsoft Store edition keeps the stock files where a program can read them ([log][stock]).

## What this changes elsewhere

The notes at the top of [the code map](../architecture/02-code-map.md), [the spine](../architecture/01-spine.md), [01-loop-and-edge](../core/01-loop-and-edge.md), [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md), [the profiles' units](../profiles/02-units.md), [avatars](../avatars/01-avatars.md), [installing and updating](../install/01-installing-and-updating.md), and [the network's units](../network/02-units.md) list what this design changes there, and the [tentative decisions](../architecture/decisions.md#every-x86_64-program-links-the-c-runtime-statically-through-one-line-of-the-workspaces-cargo-config) give the reasons.

[stock]: log.md#2026-10-18-the-sims-stock-vcockpitjs-is-on-disk-in-our-steam-install-in-asobo-vcockpits-core-not-streamed
[compiled]: log.md#2026-10-18-fspackagetool-starts-the-sim-to-build-and-the-sim-re-encodes-the-figures-vertices-and-compiles-an-in-game-panels-definition-to-binary
[sdk]: log.md#2026-10-18-the-sdks-listing-links-only-its-newest-two-versions-and-every-older-installer-we-tried-is-still-served
[crt]: log.md#2026-10-18-one-line-of-cargo-config-links-every-x86_64-programs-c-runtime-statically-and-alternating-with-cargo-msfss-build-rebuilds-nothing
[check]: log.md#2026-10-18-acorn-at-es2017-fails-every-p09-sample-the-engine-fails-and-the-frameworks-whole-bundle-gives-two-false-hits-by-name
[vpk]: log.md#2026-10-18-vpk-uploads-a-draft-unless-told-to-publish-and-two-of-its-paths-exit-0-having-shipped-less
[msfs]: results/2026-10-18-msfs-packages-and-sdk.txt
[velopack]: results/2026-10-18-velopack-in-ci.txt
[crtresults]: results/2026-10-18-static-c-runtime.txt
[checkresults]: results/2026-10-18-coherent-gt-check-blocks.txt
