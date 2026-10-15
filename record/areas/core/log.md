# Core: log

What we found about the core's own process, its loop and its edge, newest entry first.
The probes are in [experiments/areas/core](../../../experiments/areas/core), and their raw output is in its `results/` folder.

## 2026-10-15: The sim's script loader holds every later script behind one that never loads, while it loads one at a time

**Asked:** if a file of ours that `VCockpit.js` loads through the sim's `Include.addImports`, as FS Copilot's copy loads its own, never loads, does the cockpit still load as if Crosscheck weren't installed, for node 6.2 of the [architecture plan](../architecture/plan.md#62-clients-and-the-panel-bridge)?

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

[a511]: ../architecture/log.md#2026-10-14-a-core-replays-a-whole-run-when-one-ordered-loop-owns-its-state-and-takes-every-input-stamped-through-one-queue-as-sans-io-cores-lmax-and-tigerbeetle-run-and-neither-actors-nor-simulation-runtimes-can-replay-a-run-from-a-pilots-pc
