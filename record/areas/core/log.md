# Core: log

What we found about the core's own process, its loop and its edge, newest entry first.
The probes are in [experiments/areas/core](../../../experiments/areas/core), and their raw output is in its `results/` folder.

## 2026-10-20: Stage 2's timers fire at most 977µs late, its idle core holds 1.0 MB, and it exits in 29ms

**Asked:** does the core [stage 2](../build/plan.md#2-the-cores-loop-and-edge) builds meet three of [01-loop-and-edge's budgets](01-loop-and-edge.md#budgets): a timer within 2ms of its deadline at p99 on an idle PC, under 30 MB of private working set with no session, and an exit done within 1s?

**Expected:** all three, since p01's high-resolution waitable timer woke at most 1.46ms late ([p01's entry](#2026-10-15-a-high-resolution-waitable-timer-wakes-within-15ms-where-tokios-wake-up-to-17ms-late-and-the-cores-math-changes-with-the-c-runtimes-fma3-switch-and-with-its-version)), and the core runs no units of its own yet.

**Found:** on our development machine, with `apps/core`'s tests:

- **Timers:** 1,000 timers in a release build, each set, as the one before it fired, to fire 10ms later, came in 158µs late at p50, 587µs at p99, and 977µs at most.
  A timer's lateness is its firing input's stamp less its deadline, so it counts the timer thread's wake and the queue's push.
  The PC ran its usual programs and wasn't otherwise idled.
- **Memory:** a release core with no units held 1.0 MB of private working set 10s after it started, by `GetProcessMemoryInfo`'s `PrivateWorkingSetSize`.
- **Exiting:** a debug core of a test's own units exited 29ms after a unit put out its exit, the time `run` measures from the exit to its end, through tokio's shutdown, the timer thread's stop, and the writer's last frame.

**Changed:** nothing, since each is within its budget.
The timer budget's other half, with the sim running and the PC busy, waits for [stage 4](../build/plan.md#4-the-sim-seam-our-wasm-module-and-our-package)'s session in the sim, and the memory budget's busy session for [stage 18](../build/plan.md#18-traffic-and-atc-audio)'s, which hosts traffic.

**Affects:** nothing.

**Evidence:** [results/2026-10-20-stage-2-budgets.txt](results/2026-10-20-stage-2-budgets.txt).

## 2026-10-15: The `Sim` state reads 1 in the main menu and through a load's screen, and a Restart sends `FLIGHT_END` inside its load

**Asked:** can sim awareness tell the main menu from a flight by the `Sim` state when the core connects mid-run, and does `FLIGHT_END` mean the pilot left the flight, for node 6.3 of the [architecture plan](../architecture/plan.md#63-the-sim-seam-and-our-wasm-module)?
The SDK says `Sim` is 1 while the user controls the aircraft and 0 in the menus ([04-02](../../learn/foundations/04-02-events.md#system-events-and-state)), and 6.3's review found sync's p01 probe had recorded both.

**Expected:** `Sim` 0 in the main menu, and `FLIGHT_END` only on leaving a flight.

**Found:** in sync's p01 runs, which subscribed to `Sim` and the flow events (read in `experiments/areas/sync/results/p01-guided-load-2026-10-05-17-29-24.ndjson` and `-16-54-34.ndjson`; seconds from each probe's start):

- **`Sim` in the main menu:** it read 1 as the probe connected, at 1.6s, 15s before a load from the main menu with no `FLIGHT_END` before it, and read 1 again at 17.8s, 1s after that load's `FlightLoaded` and 17s before its `RTC_START`.
- **A Restart from the pause menu,** at 384.0s in the first run: `Sim` 0, `FlightLoaded` at 384.1s, `FLIGHT_END` and `FLT_LOAD` 72ms later, then `RTC_START` at 396.5s and `RTC_END` at 397.6s.
- **The A350's reload,** at 874.3s in the second run, sent `FlightLoaded`, then `FLIGHT_END` 50ms later, then `FLT_LOAD`.

**Changed:** sim awareness tells the menu from a flight while it's starting by the menu script's master page, not by `Sim`, and `FLIGHT_END` moves it to no stage, so a Restart is one load.

**Affects:** [03-sim-seam-and-wasm-module](03-sim-seam-and-wasm-module.md#stages).

**Evidence:** the two `.ndjson` files named above, read on 2026-10-15.

## 2026-10-15: Every sim crash our aircraft harness saw closed SimConnect's connection with no quit message before it

**Asked:** what reaches a SimConnect client when the sim crashes, so the core can tell a crash from the pilot closing the sim, for node 6.3 of the [architecture plan](../architecture/plan.md#63-the-sim-seam-and-our-wasm-module)?

**Expected:** a lost connection with no quit message, since a crashed process sends nothing.

**Found:** the aircraft harness ([aircraft log](../aircraft/log.md#2026-10-01-loading-flights-through-simconnect-works-but-the-sim-crashed-on-5-of-about-30-loads-so-we-canceled-the-unattended-session)) recorded the first of node-simconnect's `quit`, `close`, and `error` as the reason a connection ended, "the sim quit" for `quit` (read in `experiments/areas/aircraft/lib/sim.mjs`, the constructor's handlers and `lost`).
The report of each of the 5 runs in which the sim crashed, each crash with exception `0xc0000005` in the Windows Application log ([crashes.tsv](../../../experiments/areas/aircraft/results/crashes.tsv)), reads "The connection was lost: the SimConnect connection closed." (read in the five `run-*-2026-10-01-*.txt` reports in `experiments/areas/aircraft/results/`).
So in each crash, the connection closed with no quit message before it.

No run of ours has recorded a clean close, which the quit message reports: it "Specifies that the user has exited from Microsoft Flight Simulator 2024" (documented, [SIMCONNECT_RECV_ID](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Structures_And_Enumerations/SIMCONNECT_RECV_ID.htm)).
fsc-editor logs the two with different reasons and acts the same on both (read in fsc-editor, `src/main/sim/session.ts`, `ready` and `dropped`).

**Changed:** the core takes a sim whose process exits with no quit message before it as crashed.

**Affects:** [03-sim-seam-and-wasm-module](03-sim-seam-and-wasm-module.md#a-crash-and-a-close).

**Evidence:** the five run reports and `crashes.tsv` named above, read on 2026-10-15.

## 2026-10-15: Two of the three `AircraftLoaded` our client heard around a flight load came in the main menu

**Asked:** which of the sim's signals mark a load, so sim awareness raises one moment for it, for node 6.3 of the [architecture plan](../architecture/plan.md#63-the-sim-seam-and-our-wasm-module)?
The [architecture log][flight] reports `AircraftLoaded` three times through the load, which the code map read as three for one load.

**Expected:** three `AircraftLoaded` inside the load.

**Found:** p08's client stamped each signal (read in `experiments/areas/architecture/results/p08-flight-2026-10-09-17-12-31.ndjson`; seconds from the probe's start):

| s | Signal |
| --- | --- |
| 109.9 | `SimConnect_Open` returns `S_OK`, and the client subscribes |
| 163.4 | `TELEPORT_START`, `TELEPORT_DONE` |
| 171.8 | `AircraftLoaded`, the PA-24's preset path, about when the main menu's PA-24 loaded, 16s after the sim's open reply |
| 199.6 | `TELEPORT_START`, `TELEPORT_DONE` |
| 204.5 | `AircraftLoaded`, the same path |
| 220.3 | `FlightLoaded`, `CustomFlight.FLT` |
| 220.4 | `FLT_LOAD` and `FLT_LOADED` for `apron.flt`, then for `CustomFlight.FLT`, then `TELEPORT_START`, `TELEPORT_DONE` |
| 227.1 | `AircraftLoaded`, the same path |
| 236.6 | `FLIGHT_START`, `FLT_LOAD` and `FLT_LOADED` for `apron.flt`, `RTC_START` |
| 294.3 | `RTC_END`, as the pilot pressed Ready to fly |

So two `AircraftLoaded` came in the main menu, 49s and 16s before the flight's `FlightLoaded`, and one inside the load, while `FLT_LOAD` came three times inside the load.

**Changed:** sim awareness starts a load at `FlightLoaded`, takes the aircraft from the `AircraftLoaded` heard while loading, and ignores one heard anywhere else.

**Affects:** [03-sim-seam-and-wasm-module](03-sim-seam-and-wasm-module.md#sim-awareness); the code map's [cases for the bench](../architecture/02-code-map.md#cases-for-the-bench), whose first case reads the run as three in one load.

**Evidence:** the `.ndjson` named above, read on 2026-10-15.

## 2026-10-15: The sim's script loader holds every later script behind one that never loads, while it loads one at a time

**Asked:** if a file of ours that `VCockpit.js` loads through the sim's `Include.addImports`, as FS Copilot's copy loads its own, never loads, does the cockpit still load as if Dual Input weren't installed, for node 6.2 of the [architecture plan](../architecture/plan.md#62-clients-and-the-panel-bridge)?

**Expected:** yes, since FS Copilot's copy loads seven files of its own that way ([06-02](../../learn/foundations/06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open)).

**Found:** the sim's `IncludeMgr` (read in the sim's `common.js` as captured from MSFS 2024 on 2026-08-30, FS Copilot profiles, `sim-sources/vcockpit02-displayunits/html_UI_JS_common.js`; not run):

- `requestScript` sets the script element's `onload` and no `onerror`, and `onScriptLoaded` takes a script off the loader's list only when it loads.
- While `loadScriptAsync` is false, `addScript` requests a script at once only if the list is empty, and `onScriptLoaded` requests the next only after one loads; stock `VCockpit.js` turns it off with `Include.setAsyncLoading(false)` before it loads each instrument's scripts (read in FS Copilot's copy of the stock file in the same capture, `html_UI_Pages_VCockpit_Core_VCockpit.js`, `loadNextInstrument`, outside its FS Copilot blocks).

So a script of ours that never loads, such as one the sim can't find, stays at the head of the list, and an instrument's scripts queued behind it may never be requested (inference, from the code read).

**Changed:** our `VCockpit.js` and the panel bridge load our files through script elements of their own, outside the sim's loader, so a file of ours that fails touches nothing the sim loads.

What we haven't run: a Community package whose `VCockpit.js` loads a file that doesn't exist, through `Include.addImports` and through a script element of its own, with the panel's instruments listed through the inspector, which settles both the risk and the fix.

**Affects:** [02-clients-and-panel-bridge](02-clients-and-panel-bridge.md#our-vcockpitjs).

**Evidence:** the capture's `html_UI_JS_common.js`, `IncludeMgr`, lines 646 to 720, read on 2026-10-15.

## 2026-10-15: iroh 1.3 already brings tokio-websockets into the core, so serving the clients with it keeps the core at one WebSocket implementation

**Asked:** which WebSocket library should the core serve its clients with, once refusing a connection during the handshake isn't a priority (user, 2026-10-15), for node 6.2 of the [architecture plan](../architecture/plan.md#62-clients-and-the-panel-bridge)?

**Expected:** tokio-tungstenite, the one our Tauri probe's Rust side already ran as a client ([architecture log](../architecture/log.md#2026-10-08-a-tauri-2-window-takes-723-mb-of-memory-over-seven-processes-against-electrons-665-mb-over-four-its-program-is-80-mb-against-3474-mb-and-its-rust-sides-websocket-sends-no-origin)).

**Found:**

- **What the core already links:** in the lockfiles of every network probe that builds iroh 1.3, `two-cores`, p03, p05, p06, and p07, iroh 1.3.0 depends on iroh-relay 1.3.0, which depends on tokio-websockets 0.13.3, and no crate brings tungstenite ([p02-websocket-crates.mjs](../../../experiments/areas/core/p02-websocket-crates.mjs)).
  iroh-relay turns on tokio-websockets' `client` for every target but WebAssembly in a browser, and its `server` only through iroh-relay's own `server` feature (read in iroh-relay 1.3.0, `Cargo.toml`); tokio-websockets' `server` needs `base64`, `http`, `httparse`, and tokio's `io-util`, which its `client` needs too (read in tokio-websockets 0.13.3, `Cargo.toml`), so the core turns `server` on and adds no crate.
- **What each would add:** in `two-cores`' lockfile, tokio-tungstenite 0.30.0 would add three crates, `tokio-tungstenite`, `tungstenite`, and `sha1`, since iroh brings the rest (read, comparing p02's list with the lockfile), and a second WebSocket implementation beside iroh's.
  In empty programs with tokio 1.53.2's `net`, tokio-tungstenite brought 38 crates and tokio-websockets 23, tokio's own included in both (p02).
- **Why tokio-tungstenite has more users:** 3,512 crates depend on it, against 34 on tokio-websockets, among them axum's WebSocket support, ethers-providers, poem, and warp, while async-nats, twilight-gateway, and iroh-relay are tokio-websockets' most downloaded; its first release was on 2017-03-17, and tokio-websockets' on 2022-12-06 (documented, crates.io's API, as of 2026-10-15).
  That the head start and those frameworks account for the gap is our inference.
- **Conformance:** tokio-websockets "passes the Autobahn test suite without relaxations by default" (documented, [tokio-websockets](https://github.com/Gelbpunkt/tokio-websockets), as of 2026-10-15).
- **Where each can check `Origin`:** tungstenite 0.30.0's `Callback::on_request` can refuse a connection before the upgrade (read in tungstenite 0.30.0, `src/handshake/server.rs`), while tokio-websockets 0.13.3's `ServerBuilder::accept` writes the upgrade before it returns the request, and its `serve` takes a stream after a handshake the caller does itself (read in tokio-websockets 0.13.3, `src/server.rs`).
  Its `Limits` cap a message at 64 MiB by default (same crate, `src/proto/types.rs`).

**Changed:** the core serves its clients with tokio-websockets, its `server` turned on, and checks `Origin` the moment `accept` returns, closing a socket with another before reading anything from it.

**Affects:** [02-clients-and-panel-bridge](02-clients-and-panel-bridge.md).

**Evidence:** `experiments/areas/core/results/p02-websocket-crates-2026-10-15-20-09-12.txt`, and the files and pages named above, read on 2026-10-15.

## 2026-10-15: A high-resolution waitable timer wakes within 1.5ms where tokio's wake up to 17ms late, and the core's math changes with the C runtime's FMA3 switch and with its version

**Asked:** how close to its deadline can the core's edge wake a timer on Windows; and does the C runtime's FMA3 math, which Windows picks by CPU ([architecture log, 5.1.1][a511]), reach Rust's `f64` math and QuickJS-ng's, so that a recording made on one PC replays on another; for node 6.1 of the [architecture plan](../architecture/plan.md#61-the-cores-loop-and-edge)?

**Expected:** tokio's sleep to wake on Windows' default timer tick, about 15.6ms apart, and Rust's `f64::sin` to call the C runtime's `sin` on the MSVC target.

**Found:** four runs of [p01-edge.mjs](../../../experiments/areas/core/p01-edge.mjs) on our development machine, Windows 11 Pro 10.0.26200 with `ucrtbase.dll` 10.0.26100.9444, Rust 1.95.0, tokio 1.53.2, rquickjs 0.14.0, and the Windows SDK 10.0.22621.0, the sim closed and the PC otherwise idle:

- **tokio's sleep, at the default resolution,** woke 14.3ms to 14.5ms late at p50 on a 1ms sleep, and 5.5ms to 15.2ms late at p50 on every sleep from 1ms to 50ms, at most 16.9ms, the way a wait for the next tick of a 15.6ms clock would (inference).
  40 deadlines 50ms apart, through `sleep_until`, took 2,001ms to 2,011ms, so the lateness didn't add up across a chain.
- **After `timeBeginPeriod(1)`**, which returned 0, tokio's sleeps woke 1.3ms to 1.6ms late at p50 and at most 2.8ms in one of the four runs, and as late as before in the other three.
  Microsoft documents that "Starting with Windows 11, if a window-owning process becomes fully occluded, minimized, or otherwise invisible or inaudible to the end user, Windows does not guarantee a higher resolution than the default system resolution" (documented, [timeBeginPeriod](https://learn.microsoft.com/en-us/windows/win32/api/timeapi/nf-timeapi-timebeginperiod)); why one run got it and the others didn't, we didn't find out.
- **A high-resolution waitable timer,** made by `CreateWaitableTimerExW` with `CREATE_WAITABLE_TIMER_HIGH_RESOLUTION` and waited on by one thread, woke 0.14ms to 0.52ms late at p50 on every sleep from 1ms to 200ms, and at most 1.46ms, in every run.
  Microsoft supports the flag from "Windows 10, version 1803" (documented, [CreateWaitableTimerExW](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-createwaitabletimerexw)).
- **Rust's `f64` math:** a release build that calls `sin`, `cos`, `tan`, `exp`, `ln`, `powf`, and `atan2` imports `sin`, `cos`, `tan`, `exp`, `log`, `pow`, and `atan2` from `api-ms-win-crt-math-l1-1-0.dll`, the Universal C Runtime's math, by `dumpbin /imports`.
  QuickJS-ng's `Math.sin` calls C's `sin` too (read in rquickjs-sys 0.14.0, `quickjs/quickjs.c`, `js_math_sin`).
- **The FMA3 switch:** `_get_FMA3_enable()` returned 1 at start, so this CPU has FMA3 and the runtime's startup turned it on, and `_set_FMA3_enable(0)` turned it off.
  Over 200,000 values, each through `sin`, `cos`, `tan`, `exp`, `log`, `pow`, and `atan2`, 9,536 of the 1,400,000 results differed between FMA3 on and off, in Rust and in QuickJS-ng alike, while Rust's and QuickJS-ng's results matched bit for bit, with FMA3 on and with it off; turning it back on gave the first results again.
- **The C runtime linked into the program,** built with `+crt-static` from the Windows SDK's static library, imported no C runtime DLL, and its FMA3 switch worked the same way, with 9,810 of the 1,400,000 results differing between on and off.
  With FMA3 off, its results hashed to `87856d1dc5f95859` where the DLL's hashed to `18529f0357777f4a`, so the two copies of the runtime compute different bits even with FMA3 off.
  Microsoft documents that "On Windows 10 or Windows 11, the centrally deployed version matches the version of the operating system", and that the copy in the system directory "is always used, even if an application includes an application-local copy" (documented, [Universal CRT deployment](https://learn.microsoft.com/en-us/cpp/windows/universal-crt-deployment)), so shipping our own `ucrtbase.dll` beside the core wouldn't fix its version, and only linking the runtime in does.

**Changed:**

- The core's edge runs its timers on a thread of its own that waits on a high-resolution waitable timer, not on tokio's, so a timer of the loop's wakes within about 1.5ms where tokio's could be 17ms late, and the core asks nothing of `timeBeginPeriod`.
- The core links the C runtime statically, so its math is its build's rather than the copy that comes with each pilot's Windows, and calls `_set_FMA3_enable(0)` before it starts any thread, live and in a replay, which reaches Rust's math and QuickJS-ng's both, where a pure-Rust math library would have reached only Rust's.
  Through the DLL, a recording made on a PC on another Windows build, or on one without FMA3, could replay on ours with results that differ, about 0.7% of them between FMA3 on and off here (arithmetic, from 9,536 of 1,400,000).
  That two CPUs give the same bits from one build with FMA3 off is unverified, and replaying a recording made on a friend's PC on ours settles it.

What we haven't run: timers with the sim running and the PC busy, which [node 7](../architecture/plan.md#7-testing)'s bench measures.

**Affects:** [01-loop-and-edge](01-loop-and-edge.md); the item in [02-code-map](../architecture/02-code-map.md#left-open)'s left open on replaying a recording on a PC with another CPU.

**Evidence:** `experiments/areas/core/results/p01-edge-2026-10-15-17-43-10.txt`, `-17-43-58.txt`, `-17-59-07.txt`, and `-18-03-34.txt`, each with the timers and the imports; the last two with the FMA3 switch, and the last with the C runtime linked statically too.

[flight]: ../architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start
[a511]: ../architecture/log.md#2026-10-14-a-core-replays-a-whole-run-when-one-ordered-loop-owns-its-state-and-takes-every-input-stamped-through-one-queue-as-sans-io-cores-lmax-and-tigerbeetle-run-and-neither-actors-nor-simulation-runtimes-can-replay-a-run-from-a-pilots-pc
