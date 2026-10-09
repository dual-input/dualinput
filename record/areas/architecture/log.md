# Architecture: log

What our experiments found for the [architecture plan](plan.md)'s nodes, newest entry first.
The probes and their raw output are in [experiments/areas/architecture](../../../experiments/areas/architecture), with the results in its `results/` folder.

## 2026-10-09: ts-rs, with 64-bit integers set to numbers, generates TypeScript that matches what serde_json sends; specta needs two opt-ins, typeshare can't express our messages, and the data slots keep one layout on x86_64 and wasm32

**Asked:** which of ts-rs, specta, and typeshare generates TypeScript types from a Rust crate of messages that match what serde_json sends; do the same messages reach TypeScript running in QuickJS-ng through rquickjs; and do the data slots' structs keep one layout on x86_64 and wasm32 (node 1.4.1)?

**Expected:** all three would generate usable types, each needing an opt-in for 64-bit integers, since Coherent GT has no `BigInt`.

**Found:** on our development machine, Windows 10.0.26200, rustc 1.95.0, with serde 1.0.229, serde_json 1.0.151, uuid 1.27.0, ts-rs 12.0.1, specta 2.0.0-rc.25 with specta-typescript and specta-serde 0.0.12, typeshare 1.0.5 with typeshare-cli 1.13.4, rquickjs 0.14.0 (QuickJS-ng 0.16.2), TypeScript 7.0.2, and esbuild 0.28.2.
The crate's messages cover an internally tagged enum with struct variants, an adjacently tagged enum with newtype variants, a unit enum, an `Option` sent as `null` and one left out when empty, a `Vec`, a map, a UUID sent as text, and a time in µs as a `u64`.
TypeScript's compiler, under `--strict`, checked 5 sample messages and their 5 replies as serde_json wrote them against each generator's types, 5 deliberately wrong messages that each had to fail, and a plugin that answers each message.

- **ts-rs** wrote types on its defaults, but typed each `u64` as `bigint`, so the 4 samples carrying a time failed with "Type 'number' is not assignable to type 'bigint'", and so did the plugin's `sentAtUs + 1`.
  With its large-integer setting at `number`, every sample, reply, and the plugin passed, and each wrong message failed.
- **specta** refused twice: its `Format` refused the field left out when empty ("`skip_serializing_if` requires `PhasesFormat`"), and `PhasesFormat` refused the `u64` ("Specta forbids exporting BigInt-style types").
  With `PhasesFormat` and each `u64` field marked `specta_typescript::Number`, every check passed.
  It typed each `f32` as `number | null`, and wrote each type whose shape differs by direction twice, such as `Notice_Serialize` and `Notice_Deserialize`.
- **typeshare** refused the `u64` ("Unsupported type"), and with each one marked `U53`, refused the internally tagged enum: "Serde content attribute needs to be specified for algebraic enum ToCore".
  With that enum left out, 3 of the 5 samples failed, because it typed `flying` as optional where serde_json sends `null`, and made `Level` a TypeScript `enum`, which rejects the `"warning"` and `"error"` that serde_json sends and is code that runs rather than only a type.
  Its file also failed on its own, naming `BTreeMap`, which TypeScript doesn't have.
- **QuickJS-ng**, handed each sample as an object through its own JSON parser, ran the plugin compiled by esbuild, and 4 of the 5 replies came back equal to what Rust expected.
  The fifth carried a time of 2^53 + 1µs, 9,007,199,254,740,993, which JavaScript held as 9,007,199,254,740,992, so its reply came back 2µs short.
  2^53µs is about 285 years, so a time in µs since boot fits a JavaScript number, and a 64-bit ID doesn't.
- **The data slots' structs** compiled with their size and offset assertions for both x86_64 and wasm32-wasip1, and read back from each build the same layout: the control slot 32 bytes, aligned to 8, with its fields at offsets 0, 4, 8, and 16, and the pose 48 bytes, with `lat` at 8 after 4 bytes the compiler added.
  A struct holding a `usize` took 16 bytes with that field at 8 on x86_64, and 8 bytes with it at 4 on wasm32.

**Changed:** ts-rs does what 1.4 needs with one setting; specta does with two opt-ins, on a release candidate; and typeshare can't express internally tagged enums or 64-bit fields without changing the messages themselves.
A 64-bit integer reaches TypeScript exactly only below 2^53, so an ID crosses as text, and a struct in a data slot holds only fixed-width fields.

What we haven't run: the types in Coherent GT itself, which never sees them, since types erase when compiled and the messages arrive as JSON; a check in CI that the generated files match the crate; and Tauri's commands between the desktop app's pages and its Rust side, which tauri-specta types and ts-rs doesn't.

**Affects:** node 1.4's answer.

**Evidence:** `results/p07-types-2026-10-09-12-06-44.txt`.

## 2026-10-08: Embedded in Rust, QuickJS runs 100 write functions a frame in 75µs, idles under 1 MB, and holds its memory and time limits, while V8's memory limit failed until TurboFan was off

**Asked:** what do QuickJS and V8, embedded in a Rust program, cost to start, hold idle, and call, running a plugin and 100 profile write functions compiled from TypeScript, and do their memory and time limits stop a runaway script without taking the program down (node 1.3.5)?

**Expected:** both engines well under a millisecond a frame, and both limits holding in both engines.

**Found:** on our development machine, Windows 10.0.26200, with p04's hosts built by rustc 1.95.0: QuickJS-ng 0.16.2 through rquickjs 0.14.0, V8 15.2.124.1 through the `v8` crate 152.2.0, and Node v22.23.1's `vm` module as a baseline.
A hypothetical plugin, 100 write functions, and runaway scripts were compiled from TypeScript by esbuild 0.28.2.
Each frame called all 100 write functions, each crossing once into a host function, 60 times a second for 10s.
Limits were 64 MB of memory and 100ms of time.
Other builds were running on the machine, so the p99 and CPU figures are noisy; the means of two runs agreed within about 10%.

| Engine | Startup in the process | Memory idle, private working set and working set | A frame of 100 calls, mean and p99 | CPU, share of one core |
| --- | --- | --- | --- | --- |
| QuickJS | 1.7ms | 0.9 MB and 5.2 MB | 75µs and 155µs | 0.55% |
| V8 | 5.5ms | 3.4 MB and 13.1 MB | 81µs and 221µs | 0.76% |
| V8 with `--no-turbofan` | 5.7ms | 3.4 MB and 13.1 MB | 87µs and 336µs | 0.74% |
| Node `vm` | 2.4ms | 12.1 MB and 37.4 MB | 82µs and 300µs | 0.92% |

- In every engine, all 60,000 calls arrived and their checksums matched.
- QuickJS's memory limit stopped endless allocation in 88ms with "InternalError: out of memory", and its interrupt handler stopped an endless loop at 100ms; the host caught both and ran the next 10 frames correctly.
- V8's watchdog stopped an endless loop in 104ms through `TerminateExecution`.
  Its near-heap-limit callback asked for termination 17 times while endless allocation went on, and the process died at the 1 GB cap with "Fatal JavaScript out of memory".
  With `--no-turbofan`, the same callback stopped the allocation in 50ms, and the host ran on; the probe's agent read a failure with `--no-maglev` alone in a run whose output wasn't saved, so that TurboFan rather than Maglev is the cause is unverified.
- V8's heap limit doesn't count ArrayBuffers: 256 MB of them passed the 64 MB limit until the host gave V8 an allocator that counted them.
- Node's `vm` stopped an endless loop with its `timeout`, after 114ms, but has no memory limit: under `--max-old-space-size=64`, endless allocation ended the whole process.
  A worker thread with `resourceLimits` ended alone and the main thread ran on in both runs, but in the first run the 10 frames after it didn't match their checksums, and in the second they did.
- Endless recursion ended with a RangeError in every engine, and every host ran on.

**Changed:** either engine runs a profile's write functions every frame for under 0.1ms, so the engine's cost doesn't decide the core's language.
QuickJS held both limits as built, with the smallest footprint; V8 holds its memory limit only with TurboFan off and with an allocator that counts ArrayBuffers; Node's `vm` holds no memory limit, so a Node core would sandbox write functions in a worker thread or an embedded engine.

What we haven't run: a real profile's write functions and a real plugin, and the engines inside a core that's doing everything else at the same time.

**Affects:** node 1.3's answer, and the sandbox for write functions in [step 7 of the product plan](../product/plan.md#7-tech-stack-and-architecture).

**Evidence:** `results/p04-embedded-engine-2026-10-08-20-01-09.txt` and `-20-03-54.txt`.

## 2026-10-08: A Tauri 2 window takes 72.3 MB of memory over seven processes against Electron's 66.5 MB over four, its program is 8.0 MB against 347.4 MB, and its Rust side's WebSocket sends no Origin

**Asked:** what does a Tauri 2 window cost in memory against an Electron window showing the same page, and what `Origin` does a WebSocket send from a Tauri page and from Tauri's Rust side (node 1.3.6)?

**Expected:** Tauri lighter in memory as well as on disk, since its pages run in the system's shared WebView2 rather than a Chromium of its own.

**Found:** on our development machine, Windows 10.0.26200, while MSFS 2024 was starting, with p05's two apps each showing one static page: Tauri 2.12.1 on WebView2 Runtime 154.0.4258.62, built by rustc 1.95.0 with no Tauri CLI, and Electron 43.4.0.
Memory is the private working set, which Task Manager's Memory column shows, at the end of 60s idle after 15s to settle, summed over each app's processes:

| App | Processes | Memory | Working set | Private bytes | CPU over the 60s | On disk |
| --- | --- | --- | --- | --- | --- | --- |
| Tauri 2 | 7: the app and WebView2's browser, GPU, renderer, network, storage, and crash handler | 72.3 MB | 334.7 MB | 151.7 MB | 0.16% of one processor | 8.0 MB |
| Electron 43 | 4: main, GPU, renderer, and network | 66.5 MB | 274.3 MB | 147.0 MB | 0.18% of one processor | 347.4 MB |

- The Tauri app's own process took 3.9 MB, and WebView2's browser process 26.5 MB of the rest.
  WebView2's runtime takes 861.2 MB on disk, shared by every app that uses it and installed with Windows 11, so we wouldn't ship it.
- Tauri's page sent the `Origin` `http://tauri.localhost`, Tauri's Rust side, through tokio-tungstenite 0.30.0, sent none, and Electron's page sent `file://`.
- Each app ran once, and the Tauri app had run once for 10s before, so its WebView2 data folder already existed.

**Changed:** Tauri saves disk, not memory: its window took 5.8 MB more than Electron's.
A Tauri desktop app passes the core's `Origin` check by connecting from its Rust side, as an Electron one does from its main process.

What we haven't run: a second run of each, and a real interface rather than a static page.

**Affects:** node 1.3's answer, and the tentative decision on [the core's `Origin` check](decisions.md#the-core-accepts-a-websocket-only-with-the-sims-origin-or-none).

**Evidence:** `results/p05-tauri-window-2026-10-08-19-40-06.txt`.

## 2026-10-08: A Rust program on the SDK's own SimConnect.dll connects to MSFS 2024, trades CommBus calls with mainUi, follows system events, and trades data slots with our Rust module

**Asked:** does a Rust program using the SDK's own SimConnect library connect to MSFS 2024, call the sim's pages and hear them over the CommBus, follow the sim's system events, and trade data slots with our Rust module (node 1.3.4)?
Every SimConnect finding before it came through node-simconnect, which implements the protocol again in JavaScript.

**Expected:** yes, since every call it makes is in the SDK's header, and the server it talks to is the one node-simconnect talks to.

**Found:** on MSFS 2024 SunRise 12.2.282174.999, at the main menu, with p06's client built by rustc 1.95.0 against MSFS 2024 SDK 1.7.3's `SimConnect.lib` and `SimConnect.dll`, and p03's Rust module installed:

- The open reply named SunRise 12.2, build 282174.999, and SimConnect 12.2, and each of eight calls returned `S_OK`: subscribing to the "1sec" system event, to the flow events, and to `CROSSCHECK_P06_ASK` on the CommBus, then mapping, defining, and requesting the module's two data slots.
- "1sec" arrived 15 times in 14.8s, and no exception arrived; the main menu sent no flow event, as expected.
- The client called `CROSSCHECK_P06_HELLO` for JavaScript 10 times.
  A listener put into mainUi through the inspector, the way mainUi's own view listeners take events, heard all 10 and answered each with `CROSSCHECK_P06_ASK`, and the client received all 10.
- The client read the module's output slot 15 times, once a second: it held the module's version, the module's update count rose 2,134 between the first and last reads, and a value the client wrote to the module's input slot came back in its echo.
- The client's declarations were written by hand from the header, because generating them with bindgen needs libclang, which this machine lacks.

**Changed:** a Rust core reaches the sim through the SDK's own library for everything the core does at the main menu.

What we haven't run: anything a flight adds, such as masking, AI objects with liveries, input events, the camera, and a flight load's flow events; and declarations generated by bindgen.

**Affects:** node 1.3's answer.

**Evidence:** `results/p06-rust-simconnect-2026-10-08-19-39-04.txt`.

## 2026-10-08: A standalone module built from Rust with cargo-msfs, and packaged by our own script, runs on MSFS 2024 and trades data slots with a SimConnect client, once its SimConnect handle is 64 bits wide

**Asked:** does a standalone module built from Rust with Navigraph's cargo-msfs, and packaged by our own script, load on MSFS 2024, leave its version in a data slot, run its update every frame, and read a data slot the core writes (node 1.3.2)?

**Expected:** yes, since cargo-msfs builds Rust crates for MSFS 2024 and the Synaptic A220's Rust module runs on it.

**Found:** on MSFS 2024 SunRise 12.2.282174.999, at the main menu, over four boots with p03's module built by cargo-msfs v1.1.0 and rustc 1.95.0:

- cargo-msfs installed its SDK by downloading `MSFS2024_SDK_Core_Installer_1.8.1.zip`, 622.5 MB, from `sdk.flightsimulator.com`, and unpacking 1.6 GB of it without running the installer, in about 7 minutes.
  Each build after that took about 1s.
  Installing cargo-msfs itself compiled Binaryen's C++, with Visual Studio on this PC.
- The module exported every function the sim calls in a standalone module, the five allocator functions from the SDK's own C library among them, and lacked the toolset's `GetSimConnectVersion` export and its custom sections.
- With SimConnect's `HANDLE` declared as a 32-bit pointer, `SimConnect_Open` returned `S_OK` and a handle cut to 32 bits, the first call after it returned `E_FAIL`, −2147467259, `SimConnect_GetLastSentPacketID` then gave 0, and the module's slots never appeared.
  The module recorded only the first failing call of the eight after `SimConnect_Open`.
  The SDK declares `HANDLE` 64 bits wide in a module (read in MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_WindowsTypes.h`, `typedef unsigned long long HANDLE`).
- With `HANDLE` as a 64-bit integer, every call returned `S_OK`.
  The module's slot held its version, `module_init` had run once, `Update_StandAlone` ran 681 times in 5.00s, 136 a second at the main menu, and a value the probe wrote to the module's input slot came back in its output slot within 0.5s.
  Nobody read the sim's frame rate beside it, so that it ran once a frame rests on the SDK and the forum ([05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md#lifecycle-init-per-frame-update-deinit)).
- A second build linked with the SDK's `MSFS_WasmVersions.a`, which the SDK's toolset links into every module, ran the same, so the module needs none of its version exports.
- Linked by Rust's linker, `MSFS_WasmVersions.a` brought along a `StackSizesSection` that covers only its own three functions, and the sim refused the module: the WASM Debug window showed `FAILED` and "The module is not scheduled" (seen by the user), and the sim compiled no DLL.
  With that section removed, the module ran.
- The first boot put two modules in one package's `modules` folder, the plain build first and the one linked with `MSFS_WasmVersions.a` second, and only the first ran.
  The second was the build the sim refused in a package of its own in each later boot, so the run doesn't show whether the sim runs a second module from one package (unverified).
  Building both of the working variants into one package, and reading both modules' counters, would settle it.
- The sim compiled each module into `WASM\MSFS2024`, and the WASM Debug window showed each `READY`, with a release WASM build compiled to a debug DLL, which it flagged as "Incoherent build types" (seen by the user).
  It showed the same for `crosscheck-p12-follow`, our C++ probe module built with the SDK's MSBuild toolset, so the debug DLL comes from the sim, not from cargo-msfs or Rust.

**Changed:** our WASM module can be Rust, built by cargo-msfs, which fetches the SDK from the SDK site's public download at build time, so we store nothing of the SDK.
Bindings written by hand have to follow the SDK's headers for every type, because a binding with a wrong width compiles and loads, and nothing reports the mistake until the sim's calls fail; bindings generated from the headers, as FlyByWire's msfs-rs generates them with bindgen, would follow them, which no run has checked.
Until two modules in one package are tried, each standalone module gets a package of its own.

What we haven't run: the module in a flight, a build on a CI runner, which would need a C++ compiler for cargo-msfs's own install, and two working modules in one package.

**Affects:** node 1.3's answer; and the foundations chapter [05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md), which says no hosted build server can produce a module, because the SDK has no unattended install and `fspackagetool` runs the game, and that `MSFS_WasmVersions.a` marks a module as an MSFS 2024 module, while ours, without it, was compiled into `WASM\MSFS2024` and its update ran 136 times a second.

**Evidence:** `results/p03-rust-module-2026-10-08-17-44-49.txt`, `-17-54-02.txt`, `-17-59-24.txt`, and `-18-04-12.txt`, each with its `.ndjson`, and `results/p03-build-2026-10-08-18-05-07.txt`.

## 2026-10-08: A Rust program captures one process's audio, plays on a device it looks up by name, and receives keyboard and HID input through Raw Input in sink mode, and builds with Visual Studio's linker

**Asked:** can a Rust program do the native work the core's helper would do, which is to capture one process's audio through WASAPI's process loopback, capture a microphone, play on an output device it picks, and read input through Raw Input in sink mode, and does it build without Visual Studio (node 1.3.3)?

**Expected:** yes to each job, since the `wasapi` crate 0.25 has `new_application_loopback_client` and `windows-sys` has Raw Input, and a build for Rust's GNU target linking with Rust's own MinGW tools.

**Found:** on our development machine, Windows 10.0.26200, with p02's helper built by rustc 1.95.0 on `wasapi` 0.25.0 and `windows-sys` 0.59.0:

- One copy played a 440Hz tone at −26dBFS peak on "Speakers (Focusrite USB Audio)", the default output device, which it looked up by that name among the output devices; it didn't try a device other than the default.
  A second copy captured the first's process tree through process loopback at 48,000 frames a second, and read −29.0dBFS RMS and −26.0dBFS peak each second, the tone's own level.
- The default input device, "Analogue 1 + 2 (Focusrite USB Audio)", gave 48,000 frames a second at about −65dBFS RMS; whether a microphone was connected to it is untested, and the three devices named as microphones weren't tried.
- Registered in sink mode for keyboards, joysticks, and gamepads, the helper received all three presses and releases of F24 that another copy sent, from device 0, which marks input a program sent, while its own window never had the focus.
  In the same 4s it received 1,447 HID reports from four devices nobody touched, which nothing identified.
- The build for the default target, x86_64-pc-windows-msvc, linked with Visual Studio 2022's linker, in 17s, to 238,592 bytes.
- The build for x86_64-pc-windows-gnu failed.
  With the target added to the MSVC toolchain, rustc found no `dlltool.exe`.
  With Rust's GNU toolchain, 1.99.0, its own `dlltool.exe` failed at `CreateProcess`, which we take to be the assembler it calls and Rust doesn't ship (unverified).
  The `windows` crates need it to build their import libraries.
  The probe's saved output says only that the GNU build wasn't there; these two failures were read in the build's console.

**Changed:** Rust does each job the helper needs, through crates that already wrap them.
On Windows, the helper's build takes a C toolchain besides Rust: the MSVC target linked with Visual Studio 2022's linker, and rustup documents Visual Studio's "Desktop Development with C++" workload for it, and says the Build Tools edition, without the IDE, needs a license to Visual Studio's Community, Professional, or Enterprise edition ([rustup](https://rust-lang.github.io/rustup/installation/windows-msvc.html)); a full MinGW for the GNU target is untried.

What we haven't run: Raw Input with the sim in front, which the take-control input's [tentative decision](decisions.md#the-core-catches-the-take-control-key-and-buttons) leaves open; a key a person pressed rather than one a program sent; which devices the HID reports came from; a microphone; and an output device other than the default.

**Affects:** node 1.3's answer, and the tentative decisions on [the take-control input](decisions.md#the-core-catches-the-take-control-key-and-buttons) and [the audio](decisions.md#the-core-runs-crosschecks-audio).

**Evidence:** `results/p02-rust-helper-2026-10-08-17-14-54.txt`.

## 2026-10-08: A tray icon alone costs 1.0 MB of memory in Rust, 1.6 MB in .NET Native AOT, 5.1 MB in WinForms, and 39.7 MB over three processes in Electron

**Asked:** what does a process that shows only a tray icon cost, idle, in each runtime the watcher could run in (node 1.3.1)?

**Expected:** Electron well above the others, since its executable took 35 MB running as plain Node (measured on our development machine, 2026-10-06, with Node 22.23.1).

**Found:** on our development machine, Windows 10.0.26200 with 16 logical processors, p01 started each program, waited 15s after its icon appeared, then left it idle for 60s.
Memory is the private working set, which Task Manager's Memory column shows, summed over the program and every process it started:

| Runtime | Processes | Memory | Working set | Private bytes | On disk |
| --- | --- | --- | --- | --- | --- |
| Node v22.23.1, no tray icon, for comparison | 2, with `conhost` | 11.0 MB | 38.4 MB | 16.7 MB | 83.0 MB |
| Electron 43.4.0's main process | 3 | 39.7 MB | 165.9 MB | 104.7 MB | 347.4 MB |
| .NET 9 WinForms, self-contained single file | 1 | 5.1 MB | 33.3 MB | 8.1 MB | 107.7 MB |
| .NET 9 Native AOT, calling `Shell_NotifyIconW` | 1 | 1.6 MB | 11.3 MB | 3.3 MB | 1.1 MB |
| Rust 1.95.0, calling `Shell_NotifyIconW` | 1 | 1.0 MB | 9.6 MB | 1.4 MB | 0.1 MB |

- None of them used any processor time that Windows recorded in the 60s.
- Electron started two processes beside its main one, of 15.4 MB and 6.3 MB.
- Node's working set, 31.3 MB for `node` itself, agrees with the 29 MB measured on 2026-10-06.
- The Native AOT build linked with Visual Studio 2022's `link.exe`, and found it only once the Visual Studio Installer's folder was on `PATH`.

**Changed:** a watcher in Rust costs the pilot about 1 MB all day, a tenth of an idle Node process, and one in Electron about 40 MB.

**Affects:** node 1.3's answer, and the watcher's row in [01-spine](01-spine.md#components).

**Evidence:** `results/p01-tray-runtimes-2026-10-08-17-12-53.txt`.
