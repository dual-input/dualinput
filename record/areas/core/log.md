# Core: log

What we found about the core's own process, its loop and its edge, newest entry first.
The probes are in [experiments/areas/core](../../../experiments/areas/core), and their raw output is in its `results/` folder.

## 2026-10-15: tokio's timers wake up to 17ms late on Windows, a high-resolution waitable timer wakes within 1.2ms, and Rust's f64 math calls the C runtime's

**Asked:** how close to its deadline can the core's edge wake a timer on Windows, and does Rust's `f64` math reach the C runtime's functions, whose FMA3 path Windows picks by CPU ([architecture log, 5.1.1][a511]), for node 6.1 of the [architecture plan](../architecture/plan.md#61-the-cores-loop-and-edge)?

**Expected:** tokio's sleep to wake on Windows' default timer tick, about 15.6ms apart, and Rust's `f64::sin` to call the C runtime's `sin` on the MSVC target.

**Found:** two runs of [p01-edge.mjs](../../../experiments/areas/core/p01-edge.mjs) on our development machine, Windows 11 Pro 10.0.26200, with no sim running, Rust 1.95.0, and tokio 1.53.2:

- **tokio's sleep, at the default resolution,** woke 14.5ms late at p50 on a 1ms sleep, and 5.5ms to 15.2ms late at p50 on every sleep from 1ms to 50ms, at most 16.9ms, the way a wait for the next tick of a 15.6ms clock would (inference).
  40 deadlines 50ms apart, through `sleep_until`, took 2,004ms to 2,007ms, so the lateness didn't add up across a chain.
- **After `timeBeginPeriod(1)`**, which returned 0, tokio's sleeps woke 1.3ms to 1.6ms late at p50 and at most 2.8ms in the first run, and as late as before in the second.
  Microsoft documents that "Starting with Windows 11, if a window-owning process becomes fully occluded, minimized, or otherwise invisible or inaudible to the end user, Windows does not guarantee a higher resolution than the default system resolution" (documented, [timeBeginPeriod](https://learn.microsoft.com/en-us/windows/win32/api/timeapi/nf-timeapi-timebeginperiod)); why one run got it and the other didn't, we didn't find out.
- **A high-resolution waitable timer,** made by `CreateWaitableTimerExW` with `CREATE_WAITABLE_TIMER_HIGH_RESOLUTION` and waited on by one thread, woke 0.17ms to 0.52ms late at p50 on every sleep from 1ms to 200ms, and at most 1.13ms, in both runs.
  Microsoft supports the flag from "Windows 10, version 1803" (documented, [CreateWaitableTimerExW](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-createwaitabletimerexw)).
- **Rust's `f64` math:** a release build that calls `sin`, `cos`, `tan`, `exp`, `ln`, `powf`, and `atan2` imports `sin`, `cos`, `tan`, `exp`, `log`, `pow`, and `atan2` from `api-ms-win-crt-math-l1-1-0.dll`, the Universal C Runtime's math, by `dumpbin /imports`.
  QuickJS-ng's `Math.sin` calls C's `sin` too (read in rquickjs-sys 0.14.0, `quickjs/quickjs.c`, `js_math_sin`), so both reach the functions whose FMA3 path the C runtime's startup code turns on when the CPU has FMA3.
  Microsoft documents `_set_FMA3_enable(0)` as making "the transcendental math floating-point library functions" use "the implementations that don't use FMA3 instructions", and warns that "Differences may also be observable between computers that do or don't support FMA3" (documented, [_set_FMA3_enable](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/get-fma3-enable-set-fma3-enable)).

**Changed:**

- The core's edge runs its timers on a thread of its own that waits on a high-resolution waitable timer, not on tokio's, so a timer of the loop's wakes within about 1ms where tokio's could be 17ms late, and the core asks nothing of `timeBeginPeriod`.
- The core calls `_set_FMA3_enable(0)` before it starts any thread, live and in a replay, which reaches Rust's math and QuickJS-ng's both, where a pure-Rust math library would have reached only Rust's.
  That every PC then computes the same results is unverified: the documentation names only the FMA3 path as differing, and replaying a recording made on a friend's PC on ours settles it.

What we haven't run: timers with the sim running and the PC busy, which [node 7](../architecture/plan.md#7-testing)'s bench measures.

**Affects:** [01-loop-and-edge](01-loop-and-edge.md); the item in [02-code-map](../architecture/02-code-map.md#left-open)'s left open on replaying a recording on a PC with another CPU.

**Evidence:** `experiments/areas/core/results/p01-edge-2026-10-15-17-43-10.txt` and `-17-43-58.txt`.

[a511]: ../architecture/log.md#2026-10-14-a-core-replays-a-whole-run-when-one-ordered-loop-owns-its-state-and-takes-every-input-stamped-through-one-queue-as-sans-io-cores-lmax-and-tigerbeetle-run-and-neither-actors-nor-simulation-runtimes-can-replay-a-run-from-a-pilots-pc
