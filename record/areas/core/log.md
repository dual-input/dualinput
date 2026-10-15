# Core: log

What we found about the core's own process, its loop and its edge, newest entry first.
The probes are in [experiments/areas/core](../../../experiments/areas/core), and their raw output is in its `results/` folder.

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
  Microsoft documents that "On Windows 10 or Windows 11, the centrally deployed version matches the version of the operating system", and that the copy in the system directory "is always used, even if an application includes an application-local copy" (documented, [Universal CRT deployment](https://learn.microsoft.com/en-us/cpp/windows/universal-crt-deployment)).

**Changed:**

- The core's edge runs its timers on a thread of its own that waits on a high-resolution waitable timer, not on tokio's, so a timer of the loop's wakes within about 1.5ms where tokio's could be 17ms late, and the core asks nothing of `timeBeginPeriod`.
- The core links the C runtime statically, so its math is its build's rather than the copy that comes with each pilot's Windows, and calls `_set_FMA3_enable(0)` before it starts any thread, live and in a replay, which reaches Rust's math and QuickJS-ng's both, where a pure-Rust math library would have reached only Rust's.
  Through the DLL, a recording made on a PC on another Windows build, or on one without FMA3, could replay on ours with results that differ, about 0.7% of them between FMA3 on and off here (arithmetic, from 9,536 of 1,400,000).
  That two CPUs give the same bits from one build with FMA3 off is unverified, and replaying a recording made on a friend's PC on ours settles it.

What we haven't run: timers with the sim running and the PC busy, which [node 7](../architecture/plan.md#7-testing)'s bench measures.

**Affects:** [01-loop-and-edge](01-loop-and-edge.md); the item in [02-code-map](../architecture/02-code-map.md#left-open)'s left open on replaying a recording on a PC with another CPU.

**Evidence:** `experiments/areas/core/results/p01-edge-2026-10-15-17-43-10.txt`, `-17-43-58.txt`, `-17-59-07.txt`, and `-18-03-34.txt`, each with the timers and the imports; the last two with the FMA3 switch, and the last with the C runtime linked statically too.

[a511]: ../architecture/log.md#2026-10-14-a-core-replays-a-whole-run-when-one-ordered-loop-owns-its-state-and-takes-every-input-stamped-through-one-queue-as-sans-io-cores-lmax-and-tigerbeetle-run-and-neither-actors-nor-simulation-runtimes-can-replay-a-run-from-a-pilots-pc
