# Architecture: log

What our experiments found for the [architecture plan](plan.md)'s nodes, newest entry first.
The probes and their raw output are in [experiments/areas/architecture](../../../experiments/areas/architecture), with the results in its `results/` folder.

## 2026-10-09: Coherent GT parses all of ES2017 and object rest but no other syntax from ES2018 on, has no built-in from ES2018 on of its own but WeakRef, and runs TypeScript compiled to es2017 by tsc and by esbuild

**Asked:** which syntax from ES2017 to ES2022 does Coherent GT parse, which built-ins does it have, and does a TypeScript module compiled at the target 1.6.1 points to run in the EFB's document (node 1.6.2)?
We started at ES2015, since an `es2017` target passes ES2015 to ES2017 syntax through untouched (user, 2026-10-09).

**Expected:** ES2017 syntax and no later, after [the entry below](#2026-10-09-coherent-gts-makers-last-placed-its-engine-near-safari-101-the-msfs-avionics-framework-and-flybywire-compile-to-es2017-nobody-maintains-a-rule-set-for-the-engine-and-working-title-ships-its-own-pinned-copy-of-the-framework).

**Found:** on MSFS 2024 SunRise 12.2.282174.999, in the A2A PA-24 parked, p09 ran through the inspector in five documents: mainUi, the EFB's, the toolbar's, a cockpit panel, `VCockpit53 - GNS_DISABLED`, and our banner panel, which it opened through the toolbar's document.
Each reported the same user agent, `CoherentGT/2.0`, and the same syntax:

- **Every ES2015, ES2016, and ES2017 feature tried parsed and returned the right value:** classes with getters, statics, and `extends Error`, tagged templates, destructuring with defaults, generators, `new.target`, `super` in object methods, the `u` and `y` regex flags, `**`, `async` functions, arrows, and methods, and trailing commas in calls.
- **From ES2018 on, only object rest and the template literal revision parsed**, and `import()` parsed but wasn't run.
  These failed:
  - object spread, with "Invalid destructuring assignment target."
  - `for await`, async generators, and optional catch binding
  - a raw U+2028 in a string literal, with "Unexpected EOF"
  - `?.`, `??`, BigInt literals, logical assignment, numeric separators, class fields, `#private` fields and methods, static blocks, and `#x in obj`
  - every regex feature from ES2018 on: named groups and lookbehind, with "unrecognized character after (?", unicode property escapes, and the `s` and `d` flags, which parse inside a function and throw "Invalid regular expression: invalid flags" when it runs
- **Built-ins.**
  Every ES2015 to ES2017 built-in tried was the engine's own, by `Function.prototype.toString`.
  From ES2018 on, `WeakRef` was its own in all five documents, and nothing else was.
  Each of these was missing in all five:
  - `Array.prototype.flat`, `flatMap`, `Object.fromEntries`, and `Symbol.prototype.description`
  - `BigInt`, `globalThis`, `String.prototype.matchAll`, `Promise.any`, `AggregateError`, and `FinalizationRegistry`
  - `Array.prototype.at`, `Object.hasOwn`, `String.prototype.at`, `findLast`, `toSorted`, and `Intl`
  The sim's own scripts filled in a few in some documents and not others:

  | Built-in | Filled in by a script in | Missing in |
  | --- | --- | --- |
  | `Promise.prototype.finally` | mainUi, the EFB, the toolbar | the cockpit panel, our banner |
  | `Promise.allSettled` | mainUi, the toolbar | the EFB, the cockpit panel, our banner |
  | `String.prototype.trimStart`, `replaceAll` | the toolbar | the other four |

  `new Error("a", { cause: 1 })` carried no `cause`, and a five-element sort came out stable.
- **Web APIs**, the same in all five.
  - Missing: `ResizeObserver`, `IntersectionObserver`, `PointerEvent`, `AbortController`, `queueMicrotask`, `structuredClone`, `requestIdleCallback`, `crypto.subtle`, `Worker`, `BroadcastChannel`, and `indexedDB`.
  - Present: `MutationObserver`, `TouchEvent`, `EventTarget`, `CustomEvent`, `requestAnimationFrame`, `performance.now`, `TextEncoder` and `TextDecoder`, `URL` and `URLSearchParams`, `fetch`, `XMLHttpRequest`, `WebSocket`, `Blob`, `FileReader`, `DOMParser`, `crypto.getRandomValues`, `customElements`, `attachShadow`, `CSS.supports`, `matchMedia`, and `localStorage`.
- **TypeScript compiled to `es2017`.**
  [shared.ts](../../../experiments/areas/architecture/coherent/shared.ts) uses an enum, a static field, a `#private` field, `?.`, `??`, `??=`, object spread, object rest in a parameter, a numeric separator, `async`, and a spread of a `Map`'s values.
  Compiled by TypeScript 7.0.2 at `es2017`, and by esbuild 0.28.2 at `es2017`, each ran in the EFB's document and in the cockpit panel and passed all 7 of its checks, and its `async` method resolved.
  esbuild refused FlyByWire's target, `safari11`, with "Transforming destructuring to the configured target environment ("safari11") is not supported yet", for the object rest in a parameter.
- The probe's first full run lost the compiled module's steps to "inspector connection failed", when it opened a page's inspector again straight after closing it; one connection for each page's steps fixed it.

**Changed:**

- `es2017` is our compile target: Coherent GT parses everything it emits, and both compilers lower every later syntax our module used.
- The target doesn't cover what the compilers don't lower, which the build's check has to reject in our sources:
  - every regex feature from ES2018 on, which neither compiler rewrites into ES2017
  - a raw U+2028 or U+2029 in a string
- Our code can count on ES2017's built-ins and `WeakRef`, and nothing later, since a fill-in one document has, another lacks.
  TypeScript's `lib` set to ES2017 and `ES2021.WeakRef`, the framework's own setting, flags every later built-in at type-check time.
- The DOM lib declares the missing web APIs, so the build needs a list of its own that bans them.
- `globalThis` and `Array.prototype.flat` are missing in all five documents, though FS Copilot's probe found both in the A220's DisplayUnits document (FS Copilot fork, `record/pointer-forwarding/docs/09-environment.md`), so a script there likely filled them in (unverified).
  [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) and the foundations chapter [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits) list `globalThis` as Coherent GT's own, after that probe.

What we haven't run: `import()` and a sort of a long array; the A220's DisplayUnits document again, to see what fills in `globalThis` there; and a check over our compiled output in CI, which 1.6 designs.

**Affects:** node 1.6.2 of the [architecture plan](plan.md#162-the-syntax-and-built-ins-coherent-gt-has); 1.6's section of the spine; [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel); and the foundations chapter [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits), on which ECMAScript version Coherent GT matches.

**Evidence:** `results/p09-coherent-syntax-2026-10-09-19-07-30.txt`; the first run's lost steps in `-19-05-28.txt`; and `-19-06-45.txt`, whose stable-sort line reads the wrong value as wanted.

## 2026-10-09: Coherent GT's makers last placed its engine near Safari 10.1, the MSFS Avionics Framework and FlyByWire compile to ES2017, nobody maintains a rule set for the engine, and Working Title ships its own pinned copy of the framework

**Asked:** what do Coherent Labs and the MSFS 2024 SDK document about the JavaScript Coherent GT runs; what compile targets and lint rules do the MSFS Avionics Framework, FlyByWire, and other open MSFS projects build their in-sim code with; and how is the framework published, licensed, and versioned (node 1.6.1)?

**Expected:** a target near ES2017, since the engine has `async` and lacks ES2020's syntax ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits)).

**Found:** a search of vendors' pages, package registries, and projects' repositories, on 2026-10-09:

- **Coherent Labs.**
  Coherent GT 2.0.1.3, released 2017-12-07, "Updated internal WebKit version to Safari Technology Preview (STP) 34. Closest browser comparison would now be Safari 10.1.2", and added "complete support for EcmaScript 6" and "EcmaScript 7" (documented, [Coherent GT changelog](https://coherent-labs.com/posts/changelog-coherent-gt/)).
  No later entry, through 2.9.23.0 of 2023-06-06, names a newer WebKit, JavaScriptCore, or ECMAScript level.
  The engine has `globalThis`, `WeakRef`, and `Array.prototype.flat` ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits)), which Safari got after 10.1, so either MSFS 2024 runs a newer build than the changelog shows, or the sim's scripts fill them in (unverified).
- **The MSFS 2024 SDK.**
  Its JavaScript, Coherent GT debugger, gauge, BaseInstrument, and EFB API pages name no ECMAScript level, browser, compile target, or bundler; its JavaScript page calls Coherent GT "the web engine being used by Microsoft Flight Simulator 2024 to display glasscockpits" (documented, [JavaScript](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/javascript/javascript/index.md)).
- **The MSFS Avionics Framework.**
  Its library compiles with TypeScript 5.8.3 through ts-patch, `"target": "es2017"`, `"lib": ["DOM", "DOM.Iterable", "ES2017", "ES2021.WeakRef"]`, and the `@microsoft/msfs-ts-transformer` plugin, and Rollup bundles the output with no second compile (read in microsoft/msfs-avionics-mirror, its main branch on 2026-10-09, `src/sdk/tsconfig.json`).
  The transformer rewrites `for`-`of` loops and array destructuring as indexed access, which its description says Coherent GT's interpreter doesn't optimize well, so it's for speed, not syntax (documented, `@microsoft/msfs-ts-transformer` 1.0.0 on npm).
  A comment in its source says "Object.fromEntries is not available in CoherentJS" (read in the same repository, `src/sdk/utils/datastructures/ObjectUtils.ts`).
  Its documentation's own `tsconfig` sets `"target": "es2017"` with the comment "compatible with Coherent GT" (documented, [Setting Up Your Environment](https://microsoft.github.io/msfs-avionics-mirror/2024/docs/getting-started/setting-up-your-environment)).
- **Its package, license, and versions.**
  `@microsoft/msfs-sdk` 2.3.3, of 2025-12-12, is the newest on npm, with `"license": "MIT"` and `msfssdk.js` as its main file (read in the npm registry).
  The repository's license is MIT with an addendum that the software is "licensed only for usage in Microsoft Flight Simulator. Licensing is strictly prohibited otherwise." (read in microsoft/msfs-avionics-mirror, `LICENSE`).
  The repository's package version rose with each sim update, 2.1.1 at SU2, 2.2.3 at SU3, 2.3.3 at SU4, and 2.4.3 at SU5, and 2.4.3 isn't on npm yet; no document states how versions relate to the sim (read in the repository's history by our search).
- **How Working Title ships it.**
  The G1000 pins `"@microsoft/msfs-sdk": "2.4.3"` with no range, and its build copies the framework's `msfssdk-iife.js` into the instrument's own `Libraries` folder as `msfssdk.js` (read in microsoft/msfs-avionics-mirror, its main branch on 2026-10-09, `src/workingtitle-instruments-g1000/package.json`).
  So the framework's authors ship their own pinned copy, rather than using one the sim provides.
- **FlyByWire.**
  Its shared `tsconfig.json` sets `"target": "es2017"` with the documentation's comment, and its esbuild helper sets `target: 'safari11'` under "// Target approximate CoherentGT WebKit version", with `format: 'iife'` (read in flybywiresim/aircraft, its master branch on 2026-10-09, `build-utils.js`; the tsconfig in `fbw-common/src/systems/tsconfig.json`, by our search).
  Its instruments, built through `@synaptic-simulations/mach` with esbuild at `es2017`, bundle the framework into each instrument, and its ESLint config, at `ecmaVersion: 2021`, has no rule for Coherent GT (read by our search).
- **Others.**
  The KLN 90B, a toolbar panel, and Salty's 747 compile to `es2017` too, and one open EFB app, FSTRaK's, compiles with esbuild at `es2017` and takes the framework as the EFB's global `msfssdk` instead of bundling it (read by our search, in falcon71/kln90b, hallidave/landing-monitor, saltysimulations/salty-747, and o4oren/FSTRaK).
- **Rule sets.**
  We found no ESLint plugin, browserslist query, or compatibility table for Coherent GT or MSFS's JavaScript, on npm or in a code search of GitHub.

**Changed:**

- `es2017` is the compile target the framework's authors, FlyByWire, and every project we read use, and none goes higher, so it's our starting target, which 1.6.2 checks against what the engine parses.
- A compiler's target lowers syntax but fills in no built-in, and TypeScript's `lib` setting catches a missing ES built-in such as `Object.fromEntries` at type-check time but not a missing DOM API such as `ResizeObserver`, which the `DOM` lib declares; so our check needs a rule of its own for those, and nobody maintains one to reuse.
- We can ship our own pinned copy of the framework, as Working Title does, under a license that limits its use to Microsoft Flight Simulator, which Crosscheck is built for.

What we haven't settled: whether the engine's newer built-ins are its own or the sim's fill-ins, which 1.6.2 measures; and how the framework's versions track sim updates, which no document states.

**Affects:** node 1.6.1 of the [architecture plan](plan.md#161-coherent-gts-javascript-as-documented-and-as-others-build-for-it), which 1.6.2 and 1.6 build on; and the tentative decision [Our interface in the sim is built on the MSFS Avionics Framework](decisions.md#our-interface-in-the-sim-is-built-on-the-msfs-avionics-framework).

**Evidence:** the pages and files named above, read on 2026-10-09.

## 2026-10-09: In a flight, a Rust client on SimConnect.dll masks, creates AI objects with liveries, sets input events, reads the camera, and follows the load; the Rust module echoes; Raw Input gets a person's key and button; and the module's clock counts the counter's ticks from near the sim's start

**Asked:** does what Crosscheck's Rust pieces did at the main menu hold in a flight (node 1.5)?
Specifically: does the core's client on the SDK's `SimConnect.dll` do what our probes did through node-simconnect, does our Rust module run and trade data slots, and does the helper's Raw Input get a key and a button that a person presses with the sim in front?
Three measurements rode along: whether a clock the module reads counts the same ticks as `QueryPerformanceCounter`, how long a data-slot write and a variable requested through SimConnect take to reach the client, and how each page's `performance.now()` runs against the counter.
The banner's half of the run is in the [interface log](../interface/log.md#2026-10-09-installed-from-the-community-folder-our-toolbar-script-loads-at-the-flight-load-and-it-and-our-efb-apps-code-each-open-the-banner-when-the-client-asks-over-the-commbus).

**Expected:** yes to each, since the DLL and node-simconnect speak one protocol to one server.

**Found:** on MSFS 2024 SunRise 12.2.282174.999, in the A2A PA-24 parked, with p08's client, module, and helper built by rustc 1.95.0 on declarations bindgen 0.72.1 generated from the SDK's headers with libclang from LLVM 23.1.3, the client's from MSFS 2024 SDK 1.7.3 and the module's from the SDK 1.8.1 that cargo-msfs fetched:

- **The declarations.** bindgen gave `HANDLE` a pointer in the client and a 64-bit integer in the module, as each header declares it, and the input event's hash a 64-bit integer; `SIMCONNECT_DATA_INITPOSITION` went by value.
  All 66 of the client's calls returned `S_OK`, and no exception arrived.
- **Connecting as the sim boots.** The client asked Steam to start the sim and retried `SimConnect_Open`, which returned `E_FAIL`, −2147467259, until it returned `S_OK` 109s later.
  The client took group A at 10,000,000 at once, held open by `K:SIM_RATE_INCR`, and each call returned `S_OK`, but the sim's open reply arrived 46s after that, and the main menu's PA-24 loaded 16s after the reply.
  Calls made before the reply took effect: the IN writes made then were echoed once the reply came, and group A sat ahead of Accu-Sim (below).
- **Masking.** Once group A added `K:AXIS_ELEVATOR_SET`, maskable, after Ready to fly, it heard all 262 elevator events that the client's listener at the highest priority heard, 142 of them past ±6,000, and Accu-Sim's `L:ElevatorInput` held at −18.26 while the pilot moved the yoke; free, it ran −100 to 100.
  Clearing group A also cut the listener's group off from the axis: in the cleared phase it heard none, while `L:ElevatorInput` ran −100 to 100 again.
  Removing a client event from a group did the same through node-simconnect (measured on MSFS 2024, 2026-10-01, the comment on `subscribeKeys` in `experiments/areas/aircraft/lib/sim.mjs`).
- **The flight load.** The client heard `TELEPORT_START` and `TELEPORT_DONE` twice in the main menu, then `FLT_LOAD` and `FLT_LOADED` for `apron.flt` and `CustomFlight.FLT`, `FLIGHT_START`, `RTC_START`, and `RTC_END` 58s after `RTC_START`, with `AircraftLoaded` three times and `FlightLoaded` once.
- **AI objects.** `EnumerateSimObjectsAndLiveries` listed 6,297 aircraft entries, 16 of them PA-24 liveries.
  `AICreateNonATCAircraft_EX1` created a PA-24 in the livery `C-FCIO`, beside the pilot's `N8351P`, and `AICreateSimulatedObject_EX1` created our figure, `CROSSCHECK_Figure`; each object's `TITLE` and `LIVERY NAME` read back as created, and both were removed.
  The screenshot shows neither, since the aircraft faced a hangar wall.
- **The camera.** `CameraGetStatus` answered 2, `SIMCONNECT_CAMERA_ACQUIRED_BY_OTHER` (read in MSFS 2024 SDK 1.7.3, `SimConnect.h`), and `CameraGet` relative to the aircraft gave 0.302, 0.546, 0.011m, angles of 4.1°, 7.8°, and 0.0°, and a field of view of 0.739.
- **Input events.** `EnumerateInputEvents` listed 318.
  `GetInputEvent` read `SWITCH_BATTERY_MASTER_2STATES` as 1; set to 0, the subscription reported 0 twice and `L:Battery1Switch` read 0; set back to 1, both followed.
- **The CommBus.** A listener put into `VCockpit53 - GNS_DISABLED` through the inspector heard all 5 of the client's calls and answered each.
- **The module.** It echoed all 2,432 of the client's IN writes.
  In the flight, from 20s after Ready to fly, 1,476 echoes over 299s came back in a round trip of 10.2ms at least, 16.6ms median, 22.1ms at the 95th percentile, and 44.6ms at most, while the module's update ran 26,702 times, 89.2 a second.
  During the load, between the open reply and Ready to fly, round trips reached 2.8s, and the 178 writes made before the open reply came back up to 37.6s late.
- **The module's clock.** WASI's monotonic clock, through `clock_time_get`, gave stamps in whole 100ns steps: 2,377 of 2,432 were multiples of 100ns, and the other 55 ended in 99ns.
  That is `QueryPerformanceCounter`'s tick on this machine, whose frequency is 10 MHz.
  One constant offset fits all 1,476 flight echoes.
  With each stamp placed between the client's write and its receipt, the offsets that fit all of them span 9.5ms, those that fit the first and the last 30s overlap, and any drift is within ±33 ppm over the 299s; least squares gives −2 to −3 ppm.
  The clock read 0 about 12s after Steam was asked to start the sim, not at the PC's start, so its stamps need an offset to reach the counter's timeline; which event in the sim's start sets that 0 is unverified.
  WASI's realtime clock gave Unix time in multiples of 100ns, and the sum of `Update_StandAlone`'s frame times ran 36 ppm fast over the 299s.
- **A variable through SimConnect.** `L:CROSSCHECK_P08_ECHO`, which the module set in the frame it echoed and the client requested each sim frame it changed, arrived after the slot from the same frame in all 718 pairs: by 1.14ms at least, 1.79ms median, 2.90ms at the 99th percentile, and 193ms at most.
- **Raw Input.** In sink mode, the helper got all 3 Page Down presses the user made, each with `FlightSimulator2024.exe` in front.
  In a 10s window it got 22 changes of the buttons down on device `VID_044F&PID_0405`, each with the sim in front.
- **The pages' clocks.** Node's `process.hrtime` reads `QueryPerformanceCounter`: in a separate check that day, .NET's `Stopwatch.GetTimestamp`, which reads the counter, fell inside each of 3 brackets of `hrtime`, on the same 10 MHz scale.
  The probe sampled each page's `performance.now()` through the inspector, bracketed by `hrtime`, about 8 times over the last 145s of the run.
  Against the counter, the toolbar's ran −60.6 ppm, residual spread 11.3ms; the EFB's +5.6 ppm, 1.7ms; and `VCockpit53`'s −5.3 ppm, 5.0ms.
  `Date.now()` ran within 2 ppm of `performance.now()` in each page.
  Each sample's inspector round trip was about 20ms, so 8 samples over 145s can't tell a rate apart from the counter's below tens of ppm; no page's clock jumped by more than its spread.
  The probe kept only these summaries, not the samples.

**Changed:**

- The core can reach the sim through the SDK's own `SimConnect.dll` for what a flight adds, and our module runs in one, both on declarations bindgen generates from the SDK's headers.
- The core can take its masking group as soon as `SimConnect_Open` succeeds, before the sim's open reply arrives.
- The helper's Raw Input in sink mode gets a key and a flight-hardware button that a person presses with the sim in front.
- The module can stamp what it reads on `QueryPerformanceCounter`'s ticks through WASI's monotonic clock, but from an origin near the sim's start, so a stamp reaches the core's timeline only through one offset per run of the sim, which the core can estimate from the echoes' round trips.
- A data-slot write reached the client within a 44.6ms round trip in the flight, and a variable requested through SimConnect each sim frame came about 2ms after the slot from the same frame, and once 193ms after it.
- A page's `performance.now()` showed no jump over 145s, but this run can't resolve its rate against the counter.

What we haven't run: the module's clock over a longer flight, and which event sets its 0; page samples kept and taken over longer; an aircraft other than the PA-24; a second flight load in the same sim run; and the helper's audio in a flight.

**Affects:** node 1.5 of the [architecture plan](plan.md#15-a-flight-with-crosschecks-rust-pieces); the tentative decisions [Crosscheck is written in Rust](decisions.md#crosscheck-is-written-in-rust-and-in-typescript-where-an-engine-runs-it) and [The core catches the take-control key and buttons](decisions.md#the-core-catches-the-take-control-key-and-buttons); and the spine's [left open](01-spine.md#left-open) items on the core, the clocks, and the arrival delay.

**Evidence:** `results/p08-flight-2026-10-09-17-12-31.txt`, `.ndjson`, and a folder of screenshots.

## 2026-10-09: ts-rs, with 64-bit integers set to numbers, generates TypeScript that matches what serde_json sends; specta needs two opt-ins, typeshare can't express our messages, and the data slots keep one layout on x86_64 and wasm32

**Asked:** which of ts-rs, specta, and typeshare generates TypeScript types from a Rust crate of messages that match what serde_json sends; do the same messages reach TypeScript running in QuickJS-ng through rquickjs; and do the data slots' structs keep one layout on x86_64 and wasm32 (node 1.4.1)?

**Expected:** all three would generate usable types, each needing an opt-in for 64-bit integers, since Coherent GT has no `BigInt`.

**Found:** on our development machine, Windows 10.0.26200, rustc 1.95.0, with serde 1.0.229, serde_json 1.0.151, uuid 1.27.0, ts-rs 12.0.1, specta 2.0.0-rc.25 with specta-typescript and specta-serde 0.0.12, typeshare 1.0.5 with typeshare-cli 1.13.4, rquickjs 0.14.0 (QuickJS-ng 0.16.2), TypeScript 7.0.2, and esbuild 0.28.2.
The crate's messages cover an internally tagged enum with struct variants, an adjacently tagged enum with newtype variants, a unit enum, an `Option` sent as `null` and one left out when empty, a `Vec`, a map, a UUID sent as text, and a time in µs as a `u64`.
TypeScript's compiler, under `--strict`, checked 5 sample messages and their 5 replies as serde_json wrote them against each generator's types, 5 deliberately wrong messages that each had to fail, and a plugin that answers each message; typeshare's types, with the replies' enum left out, faced the 5 messages and 4 of the wrong ones.

- **ts-rs** wrote types on its defaults, but typed each `u64` as `bigint`, so the 2 sample messages carrying a time and their 2 replies failed with "Type 'number' is not assignable to type 'bigint'", and the plugin's `sentAtUs + 1` failed with "Operator '+' cannot be applied to types 'bigint' and '1'".
  With its large-integer setting at `number`, every sample, reply, and the plugin passed, and each wrong message failed.
- **specta** refused twice: its `Format` refused the field left out when empty ("`skip_serializing_if` requires `PhasesFormat`"), and `PhasesFormat` refused the `u64` ("Specta forbids exporting BigInt-style types").
  With `PhasesFormat` and each `u64` field marked `specta_typescript::Number`, every check passed.
  It typed each `f32` and `f64` as `number | null`, and wrote `Notice`, the type with the field left out when empty, twice, as `Notice_Serialize` and `Notice_Deserialize`, which came out the same here.
- **typeshare** refused the `u64` ("Unsupported type"), and with each one marked `U53`, refused the internally tagged enum: "Serde content attribute needs to be specified for algebraic enum ToCore".
  With that enum left out, 3 of the 5 samples failed, because it typed `flying` as optional where serde_json sends `null`, and made `Level` a TypeScript `enum`, which rejects the `"warning"` and `"error"` that serde_json sends and is code that runs rather than only a type.
  Its file also failed on its own, naming `BTreeMap`, which TypeScript doesn't have.
- **QuickJS-ng**, handed each sample as an object through its own JSON parser, ran the plugin compiled by esbuild, and 4 of the 5 replies came back equal to what Rust expected.
  The fifth carried a time of 2^53 + 1µs, 9,007,199,254,740,993, which JavaScript held as 9,007,199,254,740,992, so its reply came back 2µs short.
  2^53µs is about 285 years, so a time in µs since boot fits a JavaScript number, and a 64-bit ID doesn't.
- **The data slots' structs** compiled with their size and offset assertions for both x86_64 and wasm32-wasip1, and read back from each build the same layout: the control slot 32 bytes, aligned to 8, with its fields at offsets 0, 4, 8, and 16, and the pose 48 bytes, with `lat` at 8 after 4 bytes the compiler added.
  A struct holding a `usize` took 16 bytes with that field at 8 on x86_64, and 8 bytes with it at 4 on wasm32.

**Changed:** ts-rs does what 1.4 needs with one setting; specta does with two opt-ins, on a release candidate; and typeshare takes a `u64` once each is marked, but can't express an internally tagged enum without changing the messages themselves.
A 64-bit integer reaches TypeScript exactly only up to 2^53, so an ID crosses as text, and a struct in a data slot holds only fixed-width fields.

What we haven't run: the types in Coherent GT itself, which never sees them, since types erase when compiled and the messages arrive as JSON; a check in CI that the generated files match the crate; and Tauri's commands between the desktop app's pages and its Rust side, whose calls tauri-specta types (documented, [tauri-specta](https://docs.rs/tauri-specta/2.0.0-rc.21/tauri_specta/)), while ts-rs types only the messages they carry.

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
