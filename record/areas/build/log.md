# The build: log

## 2026-10-18: The sim's stock VCockpit.js is on disk in our Steam install, in asobo-vcockpits-core, not streamed

**Asked.**
Where the build gets the sim's stock `VCockpit.js` and BlurPage files, since our record had the sim streaming `VCockpit.js` rather than keeping it on disk ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#our-vcockpitjs)), and what tells us a sim update changed one.

**Expected.**
BlurPage on disk, where [decision 003](../../decisions/003-watcher-keeps-blurpage-copy-current.md) found it, and `VCockpit.js` reachable only through the inspector.

**Found,** by reading our Steam install of MSFS 2024 1.9.18.0 with the sim closed (read on our development machine, 2026-10-18, [results](results/2026-10-18-msfs-packages-and-sdk.txt)):

- `steamapps\common\Limitless\Packages\asobo-vcockpits-core\html_ui\Pages\VCockpit\Core\VCockpit.js` is on disk: 23,520 bytes with CRLF line ends, last written 2024-12-15, SHA-256 `F8797FA188EBE73D09861F8C74E8BF7E1D8B7F9B3C692CF062C3A131ED74F45E`.
- `BaseInstrument.js` is on disk too, in `asobo-vcockpits-instruments\html_ui\Pages\VCockpit\Instruments\Shared\`, 33,744 bytes, last written 2025-04-07.
- The file's code matches the stock copy the FS Copilot fork made on 2026-09-06 by stripping FS Copilot's blocks from its own copy (FS Copilot fork, `record/pointer-forwarding/module/vendor/VCockpit.stock.js`), apart from FS Copilot's header comment and blank lines.
- The claim that the sim streams these files comes from the FS Copilot fork's `record/pointer-forwarding/docs/09-environment.md`, which states it without a measurement.
- BlurPage's `{8B92BB9A-4176-4F1A-A9CE-CB1195C4E952}.html` and `.json`, in `fs-base-ui\cookedcomps\`, have SHA-256 `4712CCF9DDA2EEAB24C96F98EBD71C2D075C4AB3418CDE2896510FD8D113A101` and `419BD3C40DD94B1C0885F3895992F699F7027C1AD8AEF3370F49D4359C42B0D8`.
- Neither SDK, 1.7.3 or 1.8.1, holds any `html_ui` file.
- Only a file's own hash tells whether an update changed it:
  - Steam's update of 2026-10-14 rewrote both packages' `manifest.json` and `layout.json` and left the files' write times.
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
- What it did to p05's in-game panel: its 525-byte XML definition became a 674-byte `.spb`, whose properties are keyed by GUIDs, whose numbers are raw floats, 48 and 100 among them, and whose strings are encoded, so "Crosscheck" isn't in it as text (read on our development machine, 2026-10-18, in `experiments/areas/interface/ingame/package/`).

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
- Each of 10 older versions we asked for, from 0.9.3 to 1.8.1, answered with 200 at `installers/<version>/MSFS2024_SDK_Core_Installer_<version>.zip` (measured, 2026-10-18, a HEAD request each).
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

- Every failure of `vpk` exits -1, a tag or name that already exists among them.
- `vpk upload github` creates a draft, uploads the build's files, `releases.win.json`, and `RELEASES`, and publishes only with `--publish`; it requires a token, though Velopack's example passes none.
- `vpk download github` that finds no full package logs a warning and exits 0, so the next `vpk pack` makes no delta.
- In a PowerShell step, only the last command's exit code sets the step's result (documented, [GitHub's workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)).
- GitHub lists draft releases only to a caller with push access (documented, [GitHub's releases API](https://docs.github.com/en/rest/releases/releases)), and `vpk download github` doesn't filter them out.
- `GithubSource` reads `releases.win.json` and the packages it names, and nothing else on a release.

**What changed.**
A release uploads as a draft, the job checks it, and only then publishes it ([a release](01-the-build.md#a-release)).

**Docs affected.**
[The build](01-the-build.md).
