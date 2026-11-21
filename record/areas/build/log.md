# The build: log

## 2026-11-21: With warm caches, a pull request's CI took 19 minutes 12 seconds, inside its 20, and the bench passed in 8 jobs on GitHub's runners

**Asked:** the questions of [the entry below](#2026-11-21-cis-first-run-on-githubs-runners-took-47-minutes-with-every-cache-cold-ran-6-jobs-at-once-and-failed-on-the-benchs-own-timing-budgets-and-races), on a run whose SDK and Cargo caches the first run saved.

**Expected:** most of the cold run's 47 minutes gone with `node tools/setup.ts`'s 15 to 18, and the bench passing now that CI reports its budgets.

**Found:** the second run on [pull request 1](https://github.com/dual-input/dualinput/pull/1), with the fixes the entry below names, passed every job in 19 minutes 12 seconds from start to end ([results](results/2026-11-21-ci-runs.txt)):

- The longest path was the job that builds the bench's programs, 9 minutes 13 seconds, 6 minutes 42 seconds of them building, and then the slowest share, 9 minutes 25 seconds.
- The checks job took 10 minutes 8 seconds beside it, 7 minutes 20 seconds of them in `node tools/check.ts`.
- `node tools/setup.ts` took 1s in each job, the caches holding cargo-msfs and the SDK, and `npm ci` took about 1 minute in every job.
- At most 8 jobs ran at once this time, the checks and 7 shares, where the first run held 6, so the count GitHub runs at once isn't steady.
- The runner held every scenario, three cores and two relays included, and the shares reported their missed budgets rather than failing on them: one input over 1ms past the one allowed in `cockpit` and in `session`, inputs over 1ms on 4 cores of `flight-model` and `traffic`, the handlers of the `profiles` run that loaded the 200 KB bundle, and a profile's build at 2,905ms against 2,000ms; one `traffic` core's queue also waited 2,559µs at p50.
- Every program built with the static C runtime on the runner, so its Windows SDK holds `libucrt.lib`.

**Changed:** the budget stands; the code map's and testing's left open items on CI's time and on whether a runner holds the bench, and the build's on the runner's static C runtime, are answered here.

**Affects:** [budgets for the workspace](../architecture/02-code-map.md#budgets-for-the-workspace), which a change that builds more than this one could miss, since this run finished 48s inside it; [testing's left open](02-testing.md#left-open); and [the build's left open](01-the-build.md#left-open).

## 2026-11-21: CI's first run on GitHub's runners took 47 minutes with every cache cold, ran 6 jobs at once, and failed on the bench's own timing budgets and races

**Asked:** how long CI takes on GitHub's standard Windows runners against the code map's [20 minutes](../architecture/02-code-map.md#budgets-for-the-workspace), whether a runner holds the bench's three cores, two relays, and their proxies ([testing's left open](02-testing.md#left-open)), and whether the 8 shares of the bench run at once.

**Expected:** a cold run well over 20 minutes, the 8 shares at once, since GitHub's Free plan runs up to 20 jobs at once (documented, [Actions limits](https://docs.github.com/en/actions/reference/limits)), and the bench passing as it does on our development machine.

**Found:** the first run on [pull request 1](https://github.com/dual-input/dualinput/pull/1), with no cache of any kind, took 47 minutes from start to end ([results](results/2026-11-21-ci-runs.txt)):

- The checks job took 43 minutes and passed all 17 checks, so the messages' types and `stamp.ts` that `cargo test` wrote on the runner matched those our development machine committed, and one commit gives one message crate's hash on both.
  `node tools/setup.ts` took 18 of those minutes, compiling cargo-msfs and fetching the SDK, and `node tools/check.ts` 19.
- The job that builds the bench's programs took 29 minutes, 15 of them in `node tools/setup.ts`.
- Each share of the bench took 8 to 10 minutes, against about 6.5 on our development machine.
- At most 6 jobs ran at once, the checks and 5 shares, so 3 shares waited for others to end.
- The runner held every scenario with three cores and two relays, among them `network-relays`, `traffic`, and `session`, and 5 shares failed one or two tests each, none on behavior of the product:
  - Four timing budgets: one input over 1ms past the one allowed under 2ms, in `flight-model`, `cockpit`, and `session`, at 2,093µs to 2,184µs, and a profile's build at 2,711ms against 2,000ms in `profiles`.
  - `state-sync` flipped the PM's beacon back before the PM's core read the 1 it wrote, so state sync took the 0 for its write not landing, as it's built to.
  - `clients-outages`' suspension blocked the bench's own process while PowerShell compiled the call, so the core heard nothing from its pages for 8s and closed their sockets before it was suspended.

**Changed:** CI's bench jobs report a missed budget and pass, through `tools/bench/budgets.ts`, as [what keeps CI green](02-testing.md#what-keeps-ci-green) has it; `state-sync` waits 500ms before the PM flips the beacon back, as a pilot who sees it move would; and `tools/bench/suspend.ts` runs PowerShell without blocking the bench.

**Affects:** [testing's left open](02-testing.md#left-open), and [the code map's left open](../architecture/02-code-map.md#left-open) on CI's time, which a run with warm caches answers.

## 2026-11-18: The one input over 1ms the bench allows each core was a job's result, on the CPU, not a pause

**Asked:** what took the one input over 1ms that [building what it runs](02-testing.md#building-what-it-runs) allows each core, which that section puts down to a pause of the loop's thread.

**Expected:** a pause, with the loop's thread off the CPU.

**Found:** a diagnostic build, which logged each input over 1ms with the loop thread's CPU time and each handler over 300µs with its unit, ran two benches of `flight-model` and one of `cockpit` on 2026-11-18 ([results](../core/results/2026-11-18-log-write-stalls.txt)).
In every core, that input was a job's result, source 2, once a core, at 1,109µs to 1,618µs, with the loop's thread on the CPU throughout.
In the two `flight-model` benches, where the build named the unit, the handler was state sync's; in `cockpit`, which runs a test unit in state sync's place, the build didn't name it.
It's the handler that runs once a scenario and takes 1ms to 2ms, the gap that section names.

**Changed:** nothing; the allowance passes it, as that section says.

**Affects:** [building what it runs](02-testing.md#building-what-it-runs), whose pauses are still inferred.

## 2026-11-04: A plain `cargo build` writes the desktop program's Windows version resource from its crate

**Asked:** what lands in `dualinput-desktop.exe`'s Windows version resource, which [the build](01-the-build.md#each-components-version-and-hash) had reach it through `tauri build --config`, unverified, because tauri-build read only `tauri.conf.json`'s version and the crate inherited its own.

**Expected:** an empty version, or Tauri's default, from a build that passes no `--config`.

**Found:** `tools/build.ts` builds the program with `cargo build` from `src/apps/desktop`, and `tauri.conf.json` names no version.
The debug program's properties read `FileVersion` 0.1.0, `ProductVersion` 0.1.0, `ProductName` Dual Input, `FileDescription` Dual Input, and `CompanyName` dualinput, which Tauri took from the bundle identifier.
The crate names its version outright, since `src/apps/desktop` became a Cargo workspace of its own, so nothing is left for `--config` to carry.
A release build is unmeasured, and stage 22's release job is where one first runs.

**Changed:** [the build](01-the-build.md) drops `tauri build` for the desktop program, and its version's row names the crate.

## 2026-11-01: fspackagetool names a compiled panel after its source file, and compiled it with a game running

**Asked:** what `node tools/compile-panel.ts` gets from `fspackagetool` for the banner's panel definition, which the first run looked for under the name in the source's `Filename` element.

**Expected:** `InGamePanel_DualInputBanner.spb`, as the source's `Filename` said.

**Found:** on our development machine, with Cyberpunk 2077 running and the sim closed, `fspackagetool` reported "Attached to EXE - waiting for completion", then "Finished, 1 skipped, 1 done and 0 failed", and wrote `InGamePanels/dualinput-banner.spb`, 679 bytes, named after the source file.
The game kept running through both runs.

**Changed:** `tools/lib/panel.ts` names the compiled file `dualinput-banner.spb`, and the source's `Filename` says the same.
The first compile is committed in `src/sim-package/panel/compiled/`.
Whether the sim loads the panel from it, and takes the definition's fractional sizes, is unverified until a session in the sim.

**Affects:** [files compiled with the sim](01-the-build.md#files-compiled-with-the-sim).

## 2026-11-01: Tauri in the root workspace gives the loop's crates getrandom, so the desktop app is a Cargo workspace of its own

**Asked:** whether `src/apps/desktop` can sit in the one Cargo workspace [the code map](../architecture/02-code-map.md#the-workspace) gives every Rust crate.

**Expected:** yes, since the map check reads normal dependencies, and no loop crate depends on Tauri.

**Found:** with the desktop app as a member, on Tauri 2.12.1, the map check failed 10 loop crates, each as "`reaches kernel -> uuid -> getrandom`".
Cargo turns on a crate's features for every crate one build holds, and Tauri asks for `uuid`'s `v4`, which the kernel's `uuid` keeps off so the loop draws IDs from its seed.
The same unifying would have changed how the core compiles whenever a build held the desktop app, such as tokio's features.

**Changed:** `src/apps/desktop` is a workspace of its own, with its own `Cargo.lock` and `target/desktop`, and the root's `exclude` names it.
So a plain `cargo build` or `cargo test` at the root doesn't compile Tauri, `tools/build.ts` builds it apart, and `tools/check.ts` runs its Rustfmt, Clippy, and tests apart, and fails if its version differs from the root's.

**Affects:** [the workspace](../architecture/02-code-map.md#the-workspace), which a blockquote there names.

## 2026-10-22: The Coherent GT check reads a 2.7 MB bundle in 0.66s and its hook answers in 0.3s, and it fails an `X || fallback` fill-in, which none of its rules passes

**Asked.**
Whether stage 5 of [the build plan](plan.md#5-clients-and-the-panel-bridge)'s Coherent GT check, built to [the Coherent GT check](01-the-build.md#the-coherent-gt-check)'s design, meets its two budgets: the check on a 2.5 MB bundle, Node's start included, under 1s, and the hook's findings after a save under 1s ([budgets](01-the-build.md#budgets)).

**Expected.**
Both, since the prototype read the framework's 2.5 MB bundle in 458ms ([log entry of 2026-10-18](#2026-10-18-acorn-at-es2017-fails-every-p09-sample-the-engine-fails-and-the-frameworks-whole-bundle-gives-two-false-hits-by-name)).

**Found** (measured on our development machine, 2026-10-22, Node 22.23.1, [core results](../core/results/2026-10-22-stage-5-budgets.txt)):

- Of the 44 p09 samples the engine ran, the check fails each of the 20 the engine failed, passes each of the 22 from ES2015 to ES2017, and fails object rest and the template literal revision, which the engine parsed (`tools/coherent-check/check.test.ts`).
- On a 2,714,019-byte bundle of 11 copies of acorn 8.19.0's `dist/acorn.js`, since the framework's bundle isn't installed here, it took a median 656ms over five runs, Node's start included, and 1,612ms on the first, cold run.
- It failed acorn's `var hasOwn = Object.hasOwn || (function (obj, propName) {...})`, 11 times, since an `X || fallback` fill-in is none of its four rules, and `return BigInt(...)` in a function acorn calls only after `typeof BigInt` at its caller, which it can't see.
- Building `bridge.js` and our `VCockpit.js` and checking both took 153ms, and the hook took 293ms after an edit to our code in the sim and 86ms after an edit to `tools/check.ts`, which loads nothing more.

**What changed.**
Nothing: our bundles use neither pattern, and a package's code that does goes in the data file with its reason, as rule 4 has it.

**Docs affected.**
None.

## 2026-10-21: bindgen brings the freeze events' numbers into our WASM module, and the module, its package, and the core's SimConnect.dll build from the tree

**Asked.**
Whether bindgen brings the numbers of the freeze's events into our WASM module from the SDK's `MSFS_Events.h`, which [wants and the sim's APIs](../core/03-sim-seam-and-wasm-module.md#wants-and-the-sims-apis) left unverified until the module's build added that header.
Then whether stage 4 of [the build plan](plan.md#4-the-sim-seam-our-wasm-module-and-our-package) builds the module, our package, and the core's link to `SimConnect.dll` from the tree, with no path to the SDK written twice more.

**Expected.**
The numbers, since `MSFS_EventsEnum.h` defines each as a sum of two constants, which clang can evaluate.

**Found,** with rustc 1.95.0, bindgen 0.72.1, cargo-msfs v1.1.0, and SDK 1.8.1 (measured on our development machine, 2026-10-21):

- bindgen evaluated each `#define` in `MSFS_EventsEnum.h`, such as `KEY_FREEZE_ATTITUDE_SET (KEY_ID_MIN + 1292)` with `KEY_ID_MIN 0x00010000`, into a `u32`: 66828 for `KEY_FREEZE_ATTITUDE_SET`, 66830 for `KEY_FREEZE_LATITUDE_LONGITUDE_SET`, and 66834 for `KEY_FREEZE_ALTITUDE_SET`, each the header's sum.
- The module built by cargo-msfs exports the 11 functions p03 checked for, and `memory`, `__stack_pointer`, `__indirect_function_table`, `rust_eh_personality`, and one of std's mangled symbols, as p03's build did.
  Beyond p08's, it imports `fsEventsTriggerKeyEvent`, `fsVarsGetAVarId`, `fsVarsAVarGet`, and the handler of the variables' status, `fsVarsRegisterVarsStatusUpdateHandler` and its unregister.
- A crate can hand a build script that depends on it a value: `simconnect-types` declares `links = "simconnect-sdk"` and prints `cargo::metadata=folder=` with the SDK's folder after its version check, and the sim edge's build script reads it as `DEP_SIMCONNECT_SDK_FOLDER`, links `SimConnect.lib` from it, and copies `SimConnect.dll` beside the program.
- ts-rs writes an import of another generated type without an extension, as `import type { Called } from "./Called"`, which `tools/tsconfig.json`'s `nodenext` resolution refuses, since Node runs our tools by stripping their types and resolves an import only by its whole file name.
  `TS_RS_IMPORT_EXTENSION` set to `ts` writes `"./Called.ts"`.

**What changed.**
The module's numbers for the freeze come from the SDK's headers, with no table of ours.
`.cargo/config.toml`'s `[env]` table sets `TS_RS_IMPORT_EXTENSION` beside its two other entries for ts-rs.
The SDK's folder stays named in three places, the sim edge's build script reading it from `simconnect-types`.

**Docs affected.**
[03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md) and [the build](01-the-build.md), in notes at their tops.

## 2026-10-20: bindgen builds the Windows side's SimConnect types with the static C runtime, and ts-rs's derive reaches windows-sys

**Asked.**
Whether `simconnect-types`, the first crate of stage 3 of [the build plan](plan.md#3-the-bench) that reads the SDK's headers, builds from the SDK in cargo-msfs's folder with the static C runtime, which [the build](01-the-build.md#left-open) and [the code map](../architecture/02-code-map.md#building-every-target) left to the first build of the sim's edge.
Then whether the message crate's first dependencies, serde and ts-rs, keep it a loop crate.

**Expected.**
Both, as p08's client generated its bindings with bindgen 0.72.1 ([architecture log](../architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)), though from SDK 1.7.3 in the SDK's own install folder.

**Found,** with rustc 1.95.0, bindgen 0.72.1, libclang from LLVM 23.1.3, and SDK 1.8.1 in `%APPDATA%\cargo-msfs\data\msfs2024` (measured on our development machine, 2026-10-20):

- `simconnect-types`' build script, which Cargo compiles with the `+crt-static` that `.cargo/config.toml` sets for every x86_64 program, ran bindgen on the SDK's `SimConnect.h` behind `windows.h`, and the crate built, with bindgen's checks of each packed struct's layout.
- ts-rs 12.0.1's derive, `ts-rs-macros`, reaches `windows-sys` through `termcolor` and `winapi-util`, and the map check failed the message crate for it as `loop-io`.
  `termcolor` comes with ts-rs's default `serde-compat` feature, which makes ts-rs read serde's attributes, such as the tag of `messages::bench::ToCore`, so the message crate keeps it.
- Each of the 312,702 SimConnect messages in p10's capture of a flight carries version 6 in its header, which the stand-in sim puts in its own (read in `experiments/areas/architecture/results/p10-capture-2026-10-16-13-52-24.bin.zst`).

**What changed.**
The build's item on bindgen and the static C runtime, and the code map's claim that the one SDK serves the Windows side, are settled.
When the map check looks for a loop crate's I/O, it follows no proc macro's own dependencies, as it follows no build dependency's, since a proc macro runs in the compiler too.

**Docs affected.**
[The code map](../architecture/02-code-map.md) and [the build](01-the-build.md), in notes at their tops.

## 2026-10-18: Cargo refuses a member glob that matches no folder, or a folder without a Cargo.toml, and TypeScript 7.0.2's --explainFiles lists a type-only import

**Asked.**
What stage 1 of [the build plan](plan.md#1-the-workspace-and-its-checks) needs before its code: whether the root `Cargo.toml` can name members by globs over folders that also hold TypeScript, as [the workspace](../architecture/02-code-map.md#the-workspace) has it, and whether TypeScript 7.0.2 reports a file's imports, type-only ones included, for the map check.
Then whether stage 1's cases on a desk pass.

**Expected.**
Cargo passing over a folder without a `Cargo.toml`, as p12 saw its globs work over folders that all held one ([architecture log](../architecture/log.md#2026-10-15-cargo-takes-globs-in-default-members-too-and-esbuilds-metafile-leaves-out-a-type-only-import)).

**Found,** with Cargo 1.95.0, TypeScript 7.0.2, and Node 22.23.1 (measured on our development machine, 2026-10-18):

- A glob that matches no folder fails the whole workspace: `members = ["platform/*"]` with no `platform\` folder, and with an empty one, gave "failed to load manifest for workspace member `...\platform/*`", since Cargo takes it as a path.
- A glob that matches a folder without a `Cargo.toml` fails it too: `sim-package/*` over `sim-package\pages\` gave "failed to load manifest for workspace member `...\sim-package\pages`".
- `exclude` takes such a folder out of a glob's matches, and naming a folder that doesn't exist there is no error.
- `tsc -p <tsconfig> --explainFiles` lists each file of the program, and under the file an import brought in, "Imported via '../../b/panel/press.ts' from file 'features/a/panel/types-only.ts'", for a file whose one import was `import type`.
- cargo-msfs v1.1.0's `version.txt` held `1.8.1`, CRLF, and `2603316`, its SDK listing's entry, where `tools/msfs-sdk` writes the version alone, so the version is its first line either way.
- The cases on a desk that stage 1 takes:
  - `node tools/build.ts` with no SDK installed, or SDK 1.7.3 installed, stopped before running Cargo, naming `node tools/setup.ts` (`tools/build.test.ts`).
  - `node tools/build.ts` followed by `cargo build` compiled no crate.
  - After `cargo fmt` rewrote the message crate's source, `node tools/check.ts` failed at the messages' types, naming `stamp.ts`, and wrote it again, so a change to the crate that leaves the stamp stale fails the check.
  - Files with CRLF line ends hash as their LF copies do, in the message crate's own tests.

**What changed.**
The root `Cargo.toml` names each tier's folder by a glob once the tier's first crate exists, and `exclude` names each TypeScript folder the globs match, such as `engines/page-client`.
`.cargo/config.toml` also sets ts-rs's two variables, so a plain `cargo test` writes the messages' types where the code map has them, typed as decision 025 asks.
The map check reads TypeScript's imports from `--explainFiles`.

**Docs affected.**
[The code map](../architecture/02-code-map.md) and [the build](01-the-build.md), in notes at their tops.

## 2026-10-18: The sim's stock VCockpit.js is on disk in our Steam install, in asobo-vcockpits-core, not streamed

**Asked.**
Where the build gets the sim's stock `VCockpit.js` and BlurPage files, since our record had the sim streaming `VCockpit.js` rather than keeping it on disk ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#our-vcockpitjs)), and what tells us a sim update changed one.

**Expected.**
BlurPage on disk, where [decision 003](../../decisions/003-watcher-keeps-blurpage-copy-current.md) found it, and `VCockpit.js` reachable only through the inspector.

**Found,** by reading our Steam install of MSFS 2024 1.9.18.0 with the sim closed (read on our development machine, 2026-10-18, [results](results/2026-10-18-msfs-packages-and-sdk.txt)):

- `steamapps\common\Limitless\Packages\asobo-vcockpits-core\html_ui\Pages\VCockpit\Core\VCockpit.js` is on disk: 23,520 bytes with CRLF line ends, last written 2024-12-15, SHA-256 `F8797FA188EBE73D09861F8C74E8BF7E1D8B7F9B3C692CF062C3A131ED74F45E`.
- `BaseInstrument.js` is on disk too, in `asobo-vcockpits-instruments\html_ui\Pages\VCockpit\Instruments\Shared\`, 33,744 bytes, last written 2025-04-07 (read on our development machine, 2026-10-18, apart from the results file).
- The file's code matches the stock copy the FS Copilot fork made on 2026-09-06 by stripping FS Copilot's blocks from its own copy (FS Copilot fork, `record/pointer-forwarding/module/vendor/VCockpit.stock.js`), apart from FS Copilot's header comment and blank lines.
- The claim that the sim streams these files comes from the FS Copilot fork's `record/pointer-forwarding/docs/09-environment.md`, which states it without a measurement.
- BlurPage's `{8B92BB9A-4176-4F1A-A9CE-CB1195C4E952}.html` and `.json`, in `fs-base-ui\cookedcomps\`, have SHA-256 `4712CCF9DDA2EEAB24C96F98EBD71C2D075C4AB3418CDE2896510FD8D113A101` and `419BD3C40DD94B1C0885F3895992F699F7027C1AD8AEF3370F49D4359C42B0D8`.
- Neither SDK, 1.7.3 or 1.8.1, holds any `html_ui` file.
- Only a file's own hash tells whether an update changed it:
  - Steam's update of 2026-10-14 rewrote `asobo-vcockpits-core`'s `manifest.json` and `layout.json` and left its files' write times.
  - The dates in `layout.json` are the package build's, 2026-10-07, not the files'.
  - SimConnect's open message read version 12.2, build 282174.999, on sims 1.8.14, 1.8.16, and 1.9.18 (measured, same results, which cite each run).
  - `FlightSimulator2024.exe`'s file version, 1,9,18,0, names the sim's release.
- Whether a Microsoft Store install holds the same packages where a program can read them is unverified.

**What changed.**
The stock files live in the tree, and a build on a PC with the sim compares the sim's own with them ([the sim's stock files](01-the-build.md#the-sims-stock-files)).

**Docs affected.**
[The build](01-the-build.md), [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md), and [06-02](../../learn/foundations/06-02-apis-debugger-and-injection.md).

## 2026-10-18: fspackagetool starts the sim to build, and the sim re-encodes the figure's vertices and compiles an in-game panel's definition to binary

**Asked.**
Whether CI's runners can build the files of our package that the SDK's package tool compiles, and what it does to them, so we could weigh writing those formats ourselves (user, 2026-10-18).

**Expected.**
A tool that runs without the sim, as cargo-msfs unpacks the SDK without running its installer.

**Found:**

- `fspackagetool.exe`, 75,264 bytes and the same in SDK 1.7.3 and 1.8.1, says "you need to have Microsoft Flight Simulator 2024 installed", starts `FlightSimulator2024.exe` through Steam, the Store, or a path in a file beside it, passes the build to the sim as arguments, and waits for it (read in the program's strings, [results](results/2026-10-18-msfs-packages-and-sdk.txt)).
  So it can't run on a runner with no sim.
- The rest of our probes' packages were copy-only, a `manifest.json` and `layout.json` our scripts wrote beside the files, and the sim ran them (same results, which cite each probe).
- What it did to the figure, comparing the source the probe wrote with what came out (read on our development machine, 2026-10-18, in `experiments/areas/avatars/figure/package/`, built on 2026-10-03 on sim 1.8.16):
  - The glTF gains the extension `ASOBO_asset_optimized`, with a bounding box, `MajorVersion` 4, `MinorVersion` 8, `UseCheckerboardMaterialForMissingTextures`, and `UseOnlyFilenameForImageURI`.
  - Every vertex of the 32 meshes goes into one interleaved buffer view, 36 bytes a vertex: position as three floats, tangent and normal as four signed bytes each, two sets of texture coordinates as two shorts each, and a color as four 16-bit values; the source had position and normal alone, as floats.
  - The added tangent is (127, 0, 0, 127), the coordinates are 0, and each color value is 15,360, the bits of 1.0 as a half float (inference).
  - The indices go into one view, and the buffer grows from 123,396 to 166,512 bytes.
  - The nodes, materials, and animations come out the same, apart from the order of their keys.
  - The model's XML loses its comment, `model.cfg` becomes `model.CFG`, and it writes a `manifest.json` that carries the building sim's version, and no `layout.json`.
  - `_PackageInt\_RPTInputs.xml`, which it leaves beside the package, holds each source file's absolute path, the home folder included.
  - Two builds of the same figure, on 2026-10-03 and 2026-10-05, gave the same `.bin` (same results).
- What it did to p05's in-game panel: its 525-byte XML definition became a 674-byte `.spb`, whose properties are keyed by GUIDs, whose numbers are raw floats, 48 and 100 among them, and whose strings are encoded, so "Dual Input" isn't in it as text (read on our development machine, 2026-10-18, in `experiments/areas/interface/ingame/package/`).
- We found no description of either format: `ASOBO_asset_optimized` is in neither the SDK's glTF schema index nor its page on the format, and no page we found describes `.spb` (searched 2026-10-18).

**What changed.**
A developer compiles both with the sim and commits what comes out, and no tool of ours writes either format (user, 2026-10-18; [files compiled with the sim](01-the-build.md#files-compiled-with-the-sim)).

**Docs affected.**
[The build](01-the-build.md) and [avatars](../avatars/01-avatars.md).

## 2026-10-18: The SDK's listing links only its newest two versions, and every older installer we tried is still served

**Asked.**
Whether the build can name the SDK it builds against, since cargo-msfs installs only the newest ([building every target](../architecture/02-code-map.md#building-every-target)).

**Expected.**
Only the newest SDK downloadable.

**Found** ([results](results/2026-10-18-msfs-packages-and-sdk.txt)):

- cargo-msfs v1.1.0 fetches `https://sdk.flightsimulator.com/msfs2024/files/sdk.json`, takes the first entry's core installer, and has no version argument (read in navigraph/cargo-msfs v1.1.0, `src/sdk.rs`, `get_latest_sdk_release` and `install_latest_sdk`).
- On 2026-10-18 the listing named 33 SDK versions and linked two, 1.8.1 and 1.7.3 (measured).
- Each of the 10 versions we asked for, from 0.9.3 to 1.8.1, answered with 200 at `installers/<version>/MSFS2024_SDK_Core_Installer_<version>.zip`, the 8 the listing doesn't link among them (measured, 2026-10-18, a HEAD request each).
  Nothing from Microsoft promises they stay (unverified).
- The `version.txt` cargo-msfs writes reads "1.8.1" and "2603316" on two lines on our machine, since the SDK's own `version.txt` overwrites it as the files unpack (read on our development machine, 2026-10-18; the cause is an inference).
- From 1.7.3 to 1.8.1, 8 of the 153 WebAssembly headers, one field's type in `SimConnect.h`, `SimConnect.dll`, and two constants in `MSFS_WasmVersions.a` changed (read, comparing the two SDKs file by file).

**What changed.**
The build installs the SDK version the repository names, with a program of ours ([the SDK](01-the-build.md#the-sdk)).

**Docs affected.**
[The build](01-the-build.md) and the [code map](../architecture/02-code-map.md).

## 2026-10-18: One line of Cargo config links every x86_64 program's C runtime statically, and alternating with cargo-msfs's build rebuilds nothing

**Asked.**
How the core links the C runtime statically when nothing sets `RUSTFLAGS` ([the core's math](../core/01-loop-and-edge.md#the-cores-math)), whether the other programs should too, and whether that breaks p11's finding that the module's build and the Windows side's never rebuild each other's crates.

**Expected.**
A flag per program, or a rebuild of the shared crates each time the two builds alternate.

**Found,** on copies of p11's workspace and p05's Tauri app, with Rust 1.95.0 (measured on our development machine, 2026-10-18, [results](results/2026-10-18-static-c-runtime.txt)):

- With `[target.x86_64-pc-windows-msvc] rustflags = ["-C", "target-feature=+crt-static"]` in the workspace's `.cargo/config.toml`, p11's core imported no C runtime DLL, and was 251,904 bytes against 153,088 without it, which imported `VCRUNTIME140.dll` and five `api-ms-win-crt-*` DLLs.
- The first build with it compiled all 27 crates again, and after that each of four builds, alternating `cargo build` and cargo-msfs's, compiled none.
  - cargo-msfs sets `RUSTFLAGS`, which outranks every config file, and under `--target` the build scripts and proc macros get no flags at all (read in Cargo 1.95.0, `target_info.rs`).
  - Since Cargo 1.85, a crate built with other flags gets files of its own (read in Cargo's changelog, #14830), so both copies of the shared host crates stay on disk.
- serde_derive, ts-rs-macros, and thiserror-impl built with the flag, and the tests passed.
- A `RUSTFLAGS` of any value, an empty one included, replaced the config's flag, and a `compile_error!` on `not(target_feature = "crt-static")` failed both such builds.
- Tauri's build script links the VC runtime statically by default and the UCRT through Windows' copy; with `staticVCRuntime` off and the config's flag, the app imported no C runtime DLL.
- `actions-rust-lang/setup-rust-toolchain` v1.17.0 sets `RUSTFLAGS="-D warnings"` by default (read in its `action.yml`).

**What changed.**
Every x86_64 program links the C runtime statically through that one line ([the C runtime](01-the-build.md#the-c-runtime)).

**Docs affected.**
[The build](01-the-build.md), [01-loop-and-edge](../core/01-loop-and-edge.md), and the [code map](../architecture/02-code-map.md).

## 2026-10-18: acorn at ES2017 fails every p09 sample the engine fails, and the framework's whole bundle gives two false hits by name

**Asked.**
How to build [decision 031](../../decisions/031-coherent-gt-check-tool.md)'s check: its parser, its list of banned built-ins and web APIs with an exception for a package's own fill-in, and whether it offers an ESLint config; and what the framework's `for`-`of` rewrite does.

**Expected.**
acorn at 2017 to fit, and many false hits by name in a framework bundle.

**Found** (measured on our development machine, 2026-10-18, Node 22.23.1, [results](results/2026-10-18-coherent-gt-check-blocks.txt)):

- acorn 8.19.0 at `ecmaVersion: 2017` rejected all 20 of p09's samples the engine fails and accepted all 22 from ES2015 to ES2017.
  It also rejected 3 the engine parses: object rest, which esbuild lowers, and the template literal revision and `import()`, which the framework's bundles don't use.
- `@eslint-community/regexpp` 4.12.2's `RegExpValidator` at 2017 failed esbuild 0.28.2's `new RegExp("(?<y>\\d{4})")` with "Invalid group".
- An FSComponent page on `@microsoft/msfs-sdk` 2.3.3, bundled at `es2017`, 2,535,217 bytes, had no use of a banned name.
  The whole framework, 3,689,065 bytes, had 2, both calls to its own `ArrayUtils.flatMap`, which a check that resolves the receiver to a class in the same file clears.
- source-map-js 1.2.2 mapped each failure in a bundle to our TypeScript's line, minified or not.
- The standalone check took a median 458ms on the 2.5 MB bundle, Node's start included, against 1,358ms for ESLint with eslint-plugin-es-x 10.1.0, which has no rule for any web API or for `Intl`, and in its aggressive mode put 172 false hits on that bundle.
- typescript-eslint 8.71.2 stopped with "typescript-eslint does not support TS 7.0."
- `@microsoft/msfs-ts-transformer` 1.0.0 needs TypeScript 5's type checker through ts-patch, so neither esbuild nor TypeScript 7 runs it; the published `msfssdk.js` 2.3.3 already holds 109 rewritten loops and 140 `for`-`of` loops it couldn't rewrite.
- We found no measurement anywhere of what `for`-`of` costs in Coherent GT.

**What changed.**
The check is a standalone tool on acorn, with no ESLint config in v1, and no `for`-`of` rewrite runs ([the Coherent GT check](01-the-build.md#the-coherent-gt-check)).

**Docs affected.**
[The build](01-the-build.md) and the [spine](../architecture/01-spine.md).

## 2026-10-18: vpk uploads a draft unless told to publish, and two of its paths exit 0 having shipped less

**Asked.**
How a release job can fail when it attaches nothing, since fsc-editor's v0.1.0 shipped empty while its publisher logged "GitHub release not created" and exited 0 (fsc-editor, commit 7b2348e).

**Expected.**
A command that reports a failed upload.

**Found** (read in velopack 1.2.161 and GitHub's docs, [results](results/2026-10-18-velopack-in-ci.txt)):

- Every exception inside a `vpk` command exits -1, a tag or name that already exists among them.
- `vpk upload github` creates a draft, uploads the build's files, `releases.win.json`, and `RELEASES`, and publishes only with `--publish`; it requires a token, though Velopack's example passes none.
- `vpk download github` that finds no full package logs a warning and exits 0, so the next `vpk pack` makes no delta.
- In a PowerShell step, only the last native command's exit code sets the step's result (documented, [GitHub's workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)).
- GitHub lists draft releases only to a caller with push access (documented, [GitHub's releases API](https://docs.github.com/en/rest/releases/releases)), and `vpk download github` doesn't filter them out.
- `GithubSource` reads `releases.win.json` and the packages it names, and nothing else on a release.

**What changed.**
A release uploads as a draft, the job checks it, and only then publishes it ([a release](01-the-build.md#a-release)).

**Docs affected.**
[The build](01-the-build.md).
