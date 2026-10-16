# Architecture: log

What our experiments found for the [architecture plan](plan.md)'s nodes, newest entry first.
The probes and their raw output are in [experiments/areas/architecture](../../../experiments/areas/architecture), with the results in its `results/` folder.

## 2026-10-16: A flying machine that hosts traffic at EGLL takes in 285 MB of inputs an hour, 45 MB with zstd, mostly traffic, and one loop carries them at 0.5% of a core and replays them exactly

**Asked:** how many bytes an hour a recording of every input a flying machine's core takes in comes to, raw and compressed, which [6.6](plan.md#66-recording-and-bug-reports) needs to size what each PC keeps and what a bug report uploads; and does one loop carry that load and replay it, which [node 7](plan.md#7-testing) measures (both raised by 5.1)?

**Expected:** tens of MB an hour compressed: fsc-editor's capture of every `L:` variable of a PA-24 came to about 56 MB an hour as gzipped NDJSON ([5.1.1's entry](#2026-10-14-a-core-replays-a-whole-run-when-one-ordered-loop-owns-its-state-and-takes-every-input-stamped-through-one-queue-as-sans-io-cores-lmax-and-tigerbeetle-run-and-neither-actors-nor-simulation-runtimes-can-replay-a-run-from-a-pilots-pc)).

**Found:** on MSFS 2024 SunRise 12.2.282174.999, whose program reports version 1.9.18.0, in the Black Square Baron 58P, bksq-aircraft-baronpro 0.1.1, at EGLL with AI traffic on, while the user taxied and flew around the airport for 600s:

- p10's capture subscribed as the core of a flying machine that also hosts traffic would: the flight model and the camera every sim frame, 298 of the 309 names FS Copilot's 58P profile watches, as they change, AI aircraft within 200km and ground vehicles within 5km every 500ms, and p08's module's slot.
  The sim ran at 22.5 to 29.8 fps, with 142 to 153 aircraft and 0 to 248 ground vehicles around.
- It took in 312,702 inputs, 47.5 MB raw, 285 MB an hour: 7.57 MB with zstd at level 3, 45.4 MB an hour, and 6.79 MB at level 19, 40.7 MB an hour.

  | Inputs | A second | Raw, an hour | With zstd at level 3, of the 600s |
  | --- | --- | --- | --- |
  | AI aircraft | 291.2 | 157.2 MB | 3.61 MB |
  | Ground vehicles | 166.8 | 90.0 MB | 0.20 MB |
  | Flight model | 26.0 | 20.8 MB | 1.84 MB |
  | Camera | 26.0 | 10.3 MB | 0.42 MB |
  | Traffic identities | 1.7 | 3.7 MB | 0.01 MB |
  | Module slot | 4.9 | 1.8 MB | 0.07 MB |
  | Profile entries | 4.5 | 1.2 MB | 0.02 MB |

  Each kind was compressed apart, and the 14 bytes each input carries for its time, kind, and length take the rest of the 7.57 MB.
- Storing each record as its XOR with the last record of the same kind and object, and each time as its gap from the one before, shrank the whole by 1.07x at level 3 and 1.09x at level 19, and every byte came back ([p10-delta](../../../experiments/areas/architecture/p10-delta.mjs)).
- p10's loop ran the capture at its own pace for 600s, with made-up inputs at a session's rates beside it: 20 cockpit changes, 30 avatar poses, 10 panel messages, 50 ATC frames, 6 cursor reports, and 5 timer firings a second, a heartbeat each second, 19 job results, and 9 plugin calls stopped at their 100ms limit.
  Each flight-model input ran p04's 100 write functions in QuickJS-ng.
  - It took 385,929 inputs, 643 a second, and was busy 0.5% of the time.
  - An input waited in the queue 11µs at the median, 92µs at p99, 53.7ms at p99.9, and 100ms at most, the stops at the plugin's limit holding back the inputs behind them.
  - A flight-model input took 98.7µs on average to handle, and 2.97ms at most.
  - Its recording came to 12.95 MB with zstd at level 3, 77.7 MB an hour, more than the capture alone because the made-up inputs' bytes are random (read in `recording/loop/src/main.rs`, `Noise::bytes`).
  - It replayed that recording twice, in 1.8s and 1.9s, 331 and 324 times faster than it ran, and both replays put out 1,929,091 outputs whose hash matched the live run's.

**Changed:**

- A flying machine that hosts traffic in a busy area records about 45 MB an hour with zstd, and traffic is most of it: 87% of the raw bytes, and half of the compressed.
  So the reading radius and rate that traffic sync's design picks ([6.14](plan.md#614-traffic-and-atc)) set a recording's size more than its encoding does.
- The flight model and the camera come every sim frame, so at the 89 updates a second of p08's flight in a PA-24 they would take about 3 times the bytes they took at 26 fps (arithmetic, unmeasured).
- Plain zstd stays: storing records as differences gained under 10%.
- One loop carried a busy flying machine's load at 0.5% of a core, and replayed it exactly, an hour in about 11s at this rate, against the budgets of 20% of a core ([02-code-map](02-code-map.md#budgets)) and an hour in under 6 minutes ([01-loop-and-edge](../core/01-loop-and-edge.md#budgets)).

What we haven't run: a following machine, whose inputs are the crew's messages rather than the sim's flight model and traffic; a flight longer than 10 minutes; a frame rate near 89; and an area with little traffic.

**Affects:** [6.6](plan.md#66-recording-and-bug-reports)'s and [node 7](plan.md#7-testing)'s items raised by 5.1, 02-code-map's [left open](02-code-map.md#left-open) items on how much of the queue a recording keeps and whether one loop meets its budgets, and [recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)' open question of how big a flight's recording is.

**Evidence:** [the capture's report](../../../experiments/areas/architecture/results/p10-recording-2026-10-16-13-52-24.txt), the capture itself compressed with zstd as `results/p10-capture-2026-10-16-13-52-24.bin.zst`, [p10-delta's output](../../../experiments/areas/architecture/results/p10-delta-2026-10-16-13-52-24.txt), and [the loop's report](../../../experiments/areas/architecture/results/p10-loop-2026-10-16-13-52-24/p10-loop-run.txt).

## 2026-10-15: Cargo refuses two crates of one name in a workspace, and p10's loop reaches no crate that does I/O

**Asked:** can the platform's `helper` crate and the helper's program share a name in one workspace, and does p10's loop, which embeds QuickJS-ng, reach any crate on the map check's list of crates that do I/O (node 5's map)?

**Expected:** no to the first; and no to the second, since rquickjs and zstd build their C code themselves.

**Found:** on our development machine, with Cargo 1.95.0 ([results](../../../experiments/areas/architecture/results/map-checks-2026-10-15.txt)):

- A workspace with two members both named `helper` failed `cargo metadata` with "two packages named `helper` in this workspace".
- p10's loop has 11 crates besides itself among its normal dependencies, rquickjs 0.14.0 and zstd 0.13.3 among them, none of them tokio, a Windows crate, or `getrandom`.

**Changed:** each crate in `apps/` is named `crosscheck-` and its folder, and the I/O list holds the Windows crates and `getrandom`.

**Affects:** [02-code-map](02-code-map.md#the-units).

## 2026-10-15: Cargo takes globs in `default-members` too, and esbuild's metafile leaves out a type-only import

**Asked:** can the root `Cargo.toml` name its members and default members by globs, so deleting a feature's folder needs no edit there, and can the map check read one feature's import of another's types from esbuild's metafile (node 5.4)?

**Expected:** yes to the first, since Cargo documents globs in `members`; and no to the second, as node 5.4's review had found in a scratch run.

**Found:** on our development machine, with Cargo 1.95.0 and esbuild 0.28.2 ([p12](../../../experiments/areas/architecture/p12-map-inputs.mjs), [results](../../../experiments/areas/architecture/results/p12-map-inputs-2026-10-15-13-42-40.txt)):

- A workspace naming `features/*/core` in both `members` and `default-members` built both features' crates and the program that lists them, and left out a member named only in `members`, whose build script would have failed.
- A file whose only import of another feature's file was `import type` got a metafile listing no import, while a file importing a value from it got one.

**Changed:** the map check reads TypeScript imports through the TypeScript compiler rather than esbuild's metafile, and the workspace names its members by globs.

**Affects:** [02-code-map](02-code-map.md#the-workspace).

## 2026-10-15: Our WASM module builds with cargo-msfs from inside the core's Cargo workspace, against the same message crate, and neither build disturbs the other's

**Asked:** can one Cargo workspace hold the core's crates and our WASM module, so the module, its host, and its routines build against the message crate the core uses (node 5.4)?
p08 kept its module out of its workspace, with `exclude = ["module"]` (read in `experiments/areas/architecture/flight/Cargo.toml`).

**Expected:** yes, since cargo-msfs runs `cargo build --release --target wasm32-wasip1` in the crate's folder, with its own `RUSTFLAGS` (read in navigraph/cargo-msfs v1.1.0, `src/main.rs`, Build).

**Found:** yes, on our development machine, with Rust 1.95.0 and edition 2024 ([p11](../../../experiments/areas/architecture/p11-workspace.mjs), [results](../../../experiments/areas/architecture/results/p11-workspace-2026-10-15-12-35-57.txt)).

- The workspace held a message crate, the module's host, one routine, the module as a cdylib, and a Windows program, with the module left out of `default-members`, because its build script needs the SDK that cargo-msfs names in `MSFS_SDK`.
- From cold, `cargo build --release` built the Windows side in 5.4s, `cargo test` passed its 3 tests, and cargo-msfs built the module from its folder in 6.6s, 61,157 bytes, with every export on the list p03 checks.
- Building each side again after the other compiled no crate, so the two targets share one `target/` folder and one `Cargo.lock` without rebuilding each other.
- The core's crate turned on uuid's `v4` for itself, and the module's build compiled no `getrandom`, which the Windows side's did (read in the build's `target/` folder), so a feature one member turns on stayed out of the module's build.
  The module's imports were p08's, which ran in the sim, plus the SimConnect and Vars API calls its own code made: `SimConnect_TransmitClientEvent`, `SimConnect_MapClientEventToSimEvent`, `fsVarsGetAVarId`, and `fsVarsAVarSet`.
- The Windows program ran the module's host and the routine natively, fed the same slot bytes the module reads: the routine asked for the freeze in its first frame, and the host released it at the first frame sampled more than 1s after the last write, 1.1s after it.
- cargo-msfs refuses a crate whose build outputs more than one file (read in navigraph/cargo-msfs v1.1.0, `src/main.rs`, Build), so the module's cdylib can't also be the rlib the stand-in links; the host and the routines are crates of their own.
- cargo-msfs hands the build its caller's environment after setting `RUSTFLAGS` (same function), so a `RUSTFLAGS` of ours, in CI or a shell, would replace its flags.

Nothing p11 built ran in the sim.

**Changed:** 5.4 can put the module in the core's workspace, kept out of `default-members`, with its host and routines as crates beside it.

**Affects:** [5.4](plan.md#54-the-workspace), whose question names this as untried.

## 2026-10-14: A core replays a whole run when one ordered loop owns its state and takes every input stamped through one queue, as sans-IO cores, LMAX, and TigerBeetle run, and neither actors nor simulation runtimes can replay a run from a pilot's PC

**Asked:** how do current designs run an app's core and its extensions, on one ordered loop or as concurrent tasks, so that deleting an extension leaves the rest whole, a run replays exactly from its recorded inputs, order holds at the sim's frame rate, and plugins in QuickJS-ng reach a subset of the same hooks (node 5.1.1)?

**Expected:** one ordered loop, carrying to every input of the core what fsc-editor's replay did for sim events alone, which "swaps the source of events and changes nothing else" (fsc-editor, `src/main/sim/replay.ts`).

**Found:** a research read, on 2026-10-14, of each design's documentation and source ([results](results/2026-10-14-host-research.txt)), where we read the lines marked checked ourselves:

- **One loop, with I/O at its edges.**
  noq-proto, the QUIC core under iroh 1.3, "contains no networking code and does not get any relevant timestamps from the operating system", and takes the time as an argument (read in noq-proto 1.3.0, `src/lib.rs`; checked).
  str0m "never calls `Instant::now()` itself" (documented, [str0m](https://github.com/algesten/str0m)).
  LMAX runs its business logic on one thread, rebuilds its state by replaying its input events, and ends a slow external call "with an output event", because on one thread it "will halt the entire order processing machine" (documented, [Fowler, 2011-07-12](https://martinfowler.com/articles/lmax.html)).
  TigerBeetle's core is single-threaded (documented, [ARCHITECTURE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/ARCHITECTURE.md)), and Polar Signals writes each component as synchronous calls that run to completion (documented, [Subiotto, 2025-07-08](https://blog.polarsignals.com/blog/posts/2025/07/08/dst-rust)).
- **Replaying a run from the field.**
  On Age of Empires, "a game recording gave us a great way of passing around repro cases for bugs" (documented, [Bettner and Terrano, GDC 2001](https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond)).
  Riot replayed each frame's recorded packets into League of Legends' server, recorded "above our low-level network system", after fixing five kinds of divergence: six clock APIs, several random number generators, uninitialized variables, containers ordered by pointer, and differences between operating systems (documented, [Riot, 2017-06-20](https://www.riotgames.com/en/news/determinism-league-legends-implementation)).
  So our core records the messages iroh delivers, and iroh's own I/O stays out of the replay.
- **Simulation runtimes**, madsim, turmoil, and shuttle, reproduce a simulated run from a seed, with mocked I/O and a virtual clock (documented, [turmoil 0.7.2](https://docs.rs/turmoil/0.7.2/turmoil/), [madsim](https://github.com/madsim-rs/madsim), [shuttle](https://github.com/awslabs/shuttle)).
  Nothing simulates a pilot's sim, crew, and panels, so none of them replays a run from a pilot's PC; they fit a bench of two cores on one PC.
- **Actors on tokio,** one per feature, leave the order between features to the scheduler, so two features answering one moment could write to the sim in either order, and a replay would need every delivery recorded (inference).
  A QuickJS `Runtime` is `Send` only with rquickjs's `parallel` feature (read in rquickjs-core 0.14.0, `src/runtime/base.rs`), so a plugin actor would need a thread of its own.
- **Registering a feature.**
  Zed's own features are crates, each started by one call in `main`, such as `editor::init(cx)` (read in Zed's main branch on 2026-10-14, `crates/zed/src/main.rs`).
  Bevy registers a plugin through `Plugin::build(&mut App)`, but "systems run in parallel by default whenever possible", and a message race is possible "If no ordering is applied" (documented, [Bevy 0.20.0](https://docs.rs/bevy/0.20.0/bevy/app/trait.Plugin.html), [quick start](https://bevy.org/learn/quick-start/getting-started/ecs/), [Messages](https://docs.rs/bevy/latest/bevy/ecs/message/struct.Messages.html)).
  VS Code's activation events and contribution points match a plugin that loads with its profile and a profile block (documented, [activation events](https://code.visualstudio.com/api/references/activation-events), [contribution points](https://code.visualstudio.com/api/references/contribution-points)).
- **What breaks a replay on our stack.**
  - QuickJS-ng reads the wall clock when it makes a context, seeding `Math.random` and its hash seed (read in rquickjs-sys 0.14.0, `quickjs/quickjs.c`, `JS_NewContextRaw`; checked), and again in `Date.now` (same file, `js_Date_now`; checked), in `new Date()` and `Date()` (same file, `js_date_constructor`; checked), and in `performance.now` (same file, `js_perf_now`; checked).
    Our 100ms limit runs on the clock too, while QuickJS-ng calls the interrupt handler once every 10,000 ticks of its own counter (same file, `JS_INTERRUPT_COUNTER_INIT`; checked).
  - A `HashMap`'s iteration order is randomly seeded (documented, [std](https://doc.rust-lang.org/std/collections/struct.HashMap.html)).
  - The x64 Universal C Runtime picks its FMA3 math by CPU, and "Differences may also be observable between computers" (documented, [`_set_FMA3_enable`](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/get-fma3-enable-set-fma3-enable)); whether Rust's `f64` functions reach it on our target is unverified.
  - tokio's RNG takes a seed only behind `tokio_unstable` (read in tokio 1.53.2, `src/runtime/builder.rs`, `Builder::rng_seed`).
- **Size,** unmeasured for our core.
  fsc-editor's 115s capture of a PA-24, with every `L:` variable watched, holds 243,858 changes in 1.8MB of gzipped NDJSON (read in fsc-editor, `src/main/sim/fixtures/README.md`, "pa24-many-controls", and the file's size; checked), about 56MB an hour (arithmetic).

**Changed:** 5.1's answer starts from one ordered loop, as the research recommends.
Edge tasks for SimConnect, iroh, the WebSocket clients, and the helper's pipe, and a pool for slow work, stamp each input with its time and queue it.
The loop owns the host's state, every feature, and the QuickJS-ng runtimes, runs synchronous handlers in the order features registered, and never reads a clock or does I/O itself; slow work leaves as an output and comes back as an input.
Recorded with a header holding the build and the profile's hash, the queue replays the core exactly on the same build.
Its costs come with it:

- A multi-step flow, such as catch-up, is a state machine written out, not an `async` function.
- A slow handler delays every input behind it: at 89 sim updates a second, one plugin call at its 100ms limit holds back about 9 updates, in order, none lost (arithmetic).
- The loop's crates keep these rules: no iterating a `HashMap`, no `Instant::now`, no random number generator the operating system seeds, no threads, and no `.await`.
  Clippy's [`disallowed_methods`](https://rust-lang.github.io/rust-clippy/master/index.html#disallowed_methods) fails a build that calls a listed function, and its `iter_over_hash_type` one that loops over a `HashMap`, but no lint catches `.await` or I/O, so keeping tokio and every crate that does I/O out of the loop's crates is what stops them.
- QuickJS-ng's `Math.random` and `Date.now` become host functions on the loop's time and a recorded seed, and its time limit becomes a count of interrupt calls, recorded where it fired.

**Affects:** node 5.1 of the [architecture plan](plan.md#51-the-platforms-interface); and [recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)' open question of how big a flight's recording is, since the loop's inputs are what a recording would keep.

**Evidence:** [results/2026-10-14-host-research.txt](results/2026-10-14-host-research.txt), the research agent's report, and the four lines marked checked, read on 2026-10-14.

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
- **What the compilers do with what they can't lower**, in a sample with a named group, a lookbehind, the `s` flag, and a BigInt literal, compiled at `es2017` ([compilers.mjs](../../../experiments/areas/architecture/coherent/compilers.mjs), with no sim):
  - TypeScript 7.0.2 emitted each regex and the BigInt literal as written, and its check reported TS1503 for the named group, TS1501 for the `s` flag, and TS2737 for the BigInt literal, and nothing for the lookbehind.
  - esbuild 0.28.2 rewrote each regex as a `new RegExp(...)` call, with no warning, and the BigInt literal as `BigInt("10")`, warning that it "may crash at run-time".
- The probe's first full run lost the compiled module's steps to "inspector connection failed", when it opened a page's inspector again straight after closing it; one connection for each page's steps fixed it.

**Changed:**

- `es2017` is our compile target: Coherent GT parses everything it emits, and both compilers lower every later syntax our module used.
- The target doesn't cover what the compilers don't lower, which the build's check has to reject in our sources, before compiling:
  - every regex feature from ES2018 on, which TypeScript leaves as written and esbuild hides in a `new RegExp(...)` call that a parse check of its output can't see
  - a raw U+2028 or U+2029 in a string
- Our code can count on ES2017's built-ins and `WeakRef`, and nothing later, since a fill-in one document has, another lacks.
  TypeScript's `lib` set to ES2017 and `ES2021.WeakRef`, the framework's own setting, flags every later built-in at type-check time.
- The DOM lib declares the missing web APIs, so the build needs a list of its own that bans them.
- `globalThis` and `Array.prototype.flat` are missing in all five documents, though FS Copilot's probe found both in the A220's DisplayUnits document (FS Copilot fork, `record/pointer-forwarding/docs/09-environment.md`), so a script there likely filled them in (unverified).
  [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) and the foundations chapter [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits) list `globalThis` as Coherent GT's own, after that probe.

What we haven't run: `import()` and a sort of a long array; the A220's DisplayUnits document again, to see what fills in `globalThis` there; and a check over our compiled output in CI, which 1.6 designs.

**Affects:** node 1.6.2 of the [architecture plan](plan.md#162-the-syntax-and-built-ins-coherent-gt-has); 1.6's section of the spine; [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel); and the foundations chapter [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits), on which ECMAScript version Coherent GT matches.

**Evidence:** `results/p09-coherent-syntax-2026-10-09-19-07-30.txt`; the first run's lost steps in `-19-05-28.txt`; `-19-06-45.txt`, whose stable-sort line reads the wrong value as wanted; and `results/p09-compilers-2026-10-09-19-30-30.txt`.

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
