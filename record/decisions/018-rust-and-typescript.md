# 018: Dual Input is written in Rust, and in TypeScript where an engine runs it

The core, the helper, the watcher, the desktop app's program, and the WASM module are Rust, and TypeScript is for the code in Coherent GT, the desktop app's pages, plugins, and the backend ([01-spine](../areas/architecture/01-spine.md#language-and-toolchains)), while a profile's script is JavaScript in its YAML, which TypeScript checks against our declarations ([decision 045](045-profile-format-yaml-and-javascript.md)).
The core reaches the sim through the SDK's own `SimConnect.dll` and runs plugins and write functions in QuickJS-ng, embedded through rquickjs, with memory and time limits; the desktop app is a Tauri app; and the WASM module is built with Navigraph's cargo-msfs and packaged by our own script.
The Rust code's bindings to the SDK are generated from the SDK's headers, and the Rust components share one crate that defines the messages they trade.
Decided by the user on 2026-10-08, in node 1.3 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#dual-input-is-written-in-rust-and-in-typescript-where-an-engine-runs-it).

## Context

Dual Input's components run in runtimes that differ: Coherent GT, the sim's WebAssembly, whatever the core and the desktop app's window run in, and whatever the speech recognizer and ATC audio capture run in ([architecture plan](../areas/architecture/plan.md#13-language-and-toolchains)).
Four of the choices had something to measure:

- **The watcher** runs from the pilot's login, all day, and shows the pilot its own CPU and memory use, and Node has no tray icon ([architecture plan](../areas/architecture/plan.md#131-the-watchers-runtime)).
- **Plugins and write functions** run in an engine with limits, since step 7 asks for a sandbox with size limits for the profile's write functions, and Node's own `vm` module "is not a security mechanism" (documented, [Node.js vm](https://nodejs.org/api/vm.html)), as [node 1.3.5](../areas/architecture/plan.md#135-an-embedded-engine-for-plugins-and-write-functions) of the architecture plan says.
- **The desktop app** has to connect to a core that accepts a WebSocket only with the `Origin` `coui://html_ui` or none ([decision 013](013-core-accepts-sim-origin-or-none.md)).
- **The core** reaches the sim through SimConnect, and every SimConnect finding before node 1.3 came through node-simconnect, which implements the protocol again in JavaScript, where a Rust core would call `SimConnect.dll` ([architecture plan](../areas/architecture/plan.md#134-a-rust-simconnect-client)).

## Options

For the programs a JavaScript engine doesn't run, the record measured four runtimes on the watcher's job, a tray icon left idle for 60s, by private working set and size on disk (measured on our development machine, 2026-10-08, [architecture log](../areas/architecture/log.md#2026-10-08-a-tray-icon-alone-costs-10-mb-of-memory-in-rust-16-mb-in-net-native-aot-51-mb-in-winforms-and-397-mb-over-three-processes-in-electron)):

1. **Electron 43.4.0's main process:** 39.7 MB over three processes, and 347.4 MB on disk.
2. **.NET 9 WinForms, self-contained:** 5.1 MB, and 107.7 MB on disk.
3. **.NET 9 Native AOT:** 1.6 MB, and 1.1 MB on disk.
4. **Rust 1.95.0:** 1.0 MB, and 0.1 MB on disk.

None used processor time that Windows recorded (same entry).

For the engine that runs plugins and write functions in the core, three ran 100 write functions a frame, 60 frames a second, under limits of 64 MB and 100ms (measured on our development machine, 2026-10-08, [architecture log](../areas/architecture/log.md#2026-10-08-embedded-in-rust-quickjs-runs-100-write-functions-a-frame-in-75µs-idles-under-1-mb-and-holds-its-memory-and-time-limits-while-v8s-memory-limit-failed-until-turbofan-was-off)):

1. **Node's `vm` module:** 82µs a frame and 12.1 MB idle, and it stopped an endless loop after 114ms, but has no memory limit, so a Node core would run write functions in a worker thread or an embedded engine.
   A worker thread with `resourceLimits` ended alone and the main thread ran on, but in one of two runs the 10 frames after it didn't match their checksums.
2. **V8, through the `v8` crate:** 81µs a frame and 3.4 MB idle, but its process died on an endless allocation unless TurboFan was off, and its heap limit missed ArrayBuffers until the host gave it an allocator that counted them.
3. **QuickJS-ng, through rquickjs:** 75µs a frame and 0.9 MB idle, and it stopped an endless allocation at 64 MB in 88ms and an endless loop at 100ms, with the host running on.

For the desktop app's window, two frameworks each showed one static page for 60s (measured on our development machine, 2026-10-08, [architecture log](../areas/architecture/log.md#2026-10-08-a-tauri-2-window-takes-723-mb-of-memory-over-seven-processes-against-electrons-665-mb-over-four-its-program-is-80-mb-against-3474-mb-and-its-rust-sides-websocket-sends-no-origin)):

1. **Electron 43:** 66.5 MB over four processes, and 347.4 MB on disk.
2. **Tauri 2:** 72.3 MB over seven processes, and 8.0 MB on disk, leaving out WebView2's runtime, which Windows 11 includes.
   Its pages sent the `Origin` `http://tauri.localhost`, which the core refuses, and its Rust side, through tokio-tungstenite 0.30.0, sent none.

For the bindings to the SDK:

1. **Declarations written by hand from the headers.**
   The core's client ran on them at the main menu, but the module's gave `HANDLE` the wrong width for the SDK's WebAssembly headers, and nothing reported it until the sim's calls failed (measured on MSFS 2024, 2026-10-08, [architecture log](../areas/architecture/log.md#2026-10-08-a-standalone-module-built-from-rust-with-cargo-msfs-and-packaged-by-our-own-script-runs-on-msfs-2024-and-trades-data-slots-with-a-simconnect-client-once-its-simconnect-handle-is-64-bits-wide)).
2. **Declarations bindgen generates from the headers,** as FlyByWire's msfs-rs generates them (read in [msfs-rs](https://github.com/flybywiresim/msfs-rs), its main branch on 2026-10-08, `msfs/build.rs`).
   bindgen needs libclang, and our first client's declarations were written by hand because our development machine lacked it ([architecture log](../areas/architecture/log.md#2026-10-08-a-rust-program-on-the-sdks-own-simconnectdll-connects-to-msfs-2024-trades-commbus-calls-with-mainui-follows-system-events-and-trades-data-slots-with-our-rust-module)).

For the code a JavaScript engine runs, the record weighed no language beside TypeScript, since Coherent GT, WebView2, QuickJS-ng, and a Cloudflare Worker each run the JavaScript it compiles to (user, 2026-10-06 and 2026-10-08).

## Decision

Rust for the programs, QuickJS-ng for plugins and write functions, Tauri for the desktop app, generated bindings, and TypeScript for the code an engine runs.
The user chose Rust for every component a JavaScript engine doesn't run (user, 2026-10-08), and a Rust build did each one's job:

- At the main menu, a Rust client on the SDK's own `SimConnect.dll` connected, traded calls with mainUi over the CommBus, followed a system event, and traded data slots with our module (measured on MSFS 2024, 2026-10-08, [architecture log](../areas/architecture/log.md#2026-10-08-a-rust-program-on-the-sdks-own-simconnectdll-connects-to-msfs-2024-trades-commbus-calls-with-mainui-follows-system-events-and-trades-data-slots-with-our-rust-module)).
- In a flight, a Rust client on the SDK's `SimConnect.dll` masked the elevator ahead of Accu-Sim with a group it took as the sim booted, created AI objects with liveries, read the camera, read, set, and heard an input event, called a cockpit panel over the CommBus, and followed the flight load's flow events, and our Rust module echoed every slot write the client made, both on declarations bindgen generated from the SDK's headers (measured on MSFS 2024, 2026-10-09, [architecture log](../areas/architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)).
- A standalone module built by cargo-msfs ran on MSFS 2024 at the main menu and traded data slots with a SimConnect client (measured on MSFS 2024, 2026-10-08, [architecture log](../areas/architecture/log.md#2026-10-08-a-standalone-module-built-from-rust-with-cargo-msfs-and-packaged-by-our-own-script-runs-on-msfs-2024-and-trades-data-slots-with-a-simconnect-client-once-its-simconnect-handle-is-64-bits-wide)).
- A Rust helper did the helper's Windows input and audio work, built with Visual Studio's linker (measured on our development machine, 2026-10-08, [architecture log](../areas/architecture/log.md#2026-10-08-a-rust-program-captures-one-processs-audio-plays-on-a-device-it-looks-up-by-name-and-receives-keyboard-and-hid-input-through-raw-input-in-sink-mode-and-builds-with-visual-studios-linker)).
- A Rust program showing only a tray icon took a fortieth of the memory Electron's processes took for the same (measured on our development machine, 2026-10-08, [architecture log](../areas/architecture/log.md#2026-10-08-a-tray-icon-alone-costs-10-mb-of-memory-in-rust-16-mb-in-net-native-aot-51-mb-in-winforms-and-397-mb-over-three-processes-in-electron)).

Embedded in Rust, QuickJS-ng held its memory and time limits as built, with the host running on, while V8's process died on an endless allocation unless TurboFan was off, and Node's `vm` module has no memory limit (measured on our development machine, 2026-10-08, [architecture log](../areas/architecture/log.md#2026-10-08-embedded-in-rust-quickjs-runs-100-write-functions-a-frame-in-75µs-idles-under-1-mb-and-holds-its-memory-and-time-limits-while-v8s-memory-limit-failed-until-turbofan-was-off)).
A Tauri window took about the memory of an Electron one, with a program a fortieth of the size, and its Rust side's WebSocket sends no `Origin` (measured on our development machine, 2026-10-08, [architecture log](../areas/architecture/log.md#2026-10-08-a-tauri-2-window-takes-723-mb-of-memory-over-seven-processes-against-electrons-665-mb-over-four-its-program-is-80-mb-against-3474-mb-and-its-rust-sides-websocket-sends-no-origin)).
bindgen 0.72.1 gave `HANDLE` a pointer in the client and 64 bits in the module, as each header declares it ([01-spine](../areas/architecture/01-spine.md#the-core)), so no type is copied by hand.

## What it commits us to

- The helper's build links with Visual Studio's linker ([01-spine](../areas/architecture/01-spine.md#the-helper)), and installing cargo-msfs builds Binaryen's C++, so a CI runner needs a C++ compiler, and no run has built the module on one ([01-spine](../areas/architecture/01-spine.md#code-in-the-sim)).
  rustup says Visual Studio's Build Tools edition, without the IDE, needs a license to Visual Studio's Community, Professional, or Enterprise edition (documented, [rustup](https://rust-lang.github.io/rustup/installation/windows-msvc.html)).
- cargo-msfs fetches the SDK from the SDK site's public download, so the repository holds none of the SDK (read in navigraph/cargo-msfs v1.1.0, `src/sdk.rs`).
- The engine has run 100 hypothetical write functions in a host doing nothing else, and a real profile's write functions, and the engine inside a core doing its other work, haven't run ([01-spine](../areas/architecture/01-spine.md#the-core)).
- The TypeScript sides take their types from the Rust components' message crate ([decision 025](025-messages-in-one-rust-crate.md)).
- This decision leaves out a build without Visual Studio's linker, which failed with Rust's own tools and is untried with a full MinGW ([01-spine](../areas/architecture/01-spine.md#the-helper)).
- It also leaves out the relay's language ([01-spine](../areas/architecture/01-spine.md#language-and-toolchains)), which [decision 033](033-relays-run-iroh-relay-unmodified.md) settles, and the choices that stay inside one part ([01-spine](../areas/architecture/01-spine.md#left-open)), such as whether the bindings come from msfs-rs or our own run of bindgen.
