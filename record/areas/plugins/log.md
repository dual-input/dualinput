# Plugins: log

## 2026-10-24: Stage 12's sandbox stops a write function's endless loop at 100 interrupt checks, and needs QuickJS-ng's Promise intrinsic, without which an async function aborts the core when its sandbox is dropped

**Asked.**
Building [stage 12](../build/plan.md#12-the-sandbox): how many of QuickJS-ng's interrupt checks make about 100ms of a call on our development machine, where [decision 047](../../decisions/047-sandbox-time-limit-counts-interrupt-checks.md) sets the time limit; and whether the context [the sandbox](01-plugins.md#the-sandbox) designs defines what `sandbox.json` lists, survives every script a write function can make, and repeats in a replay.

**Expected.**
One count near 100ms for any endless loop, since QuickJS-ng checks once every 10,000 of its ticks, and the context working as the read of 2026-10-17 had it.

**Found,** on our development machine, an AMD Ryzen 7 7800X3D on Windows 10.0.26200, through rquickjs 0.14.0 and QuickJS-ng 0.16.2, built by rustc 1.95.0 in release builds unless a line says otherwise, the timing with no game running and a torrent client using 4.6% of a core ([results](results/2026-10-24-stage-12-sandbox.txt)):

- How long a check takes turns on what a loop does between its ticks, each a jump back, a branch, or a call: the median of five runs went from 17µs a check for an empty `for (;;) {}` to 2.5ms for a loop that builds an object each pass, at 1,000 checks as at 100.
  Each loop ran as the body of a function given one value, as the sync engine calls a write function.
- So the count is set by the two endless loops a write function's own bug would make: one that steps past its value and one that writes forever, each calling a name, such as `K('X')`, and `write()` each pass (user, 2026-10-24).
  Stand-ins for the name and `write()` build the objects the real ones return.
  At 100 checks, those two loops and the other runaways stopped in these times, while a healthy write function makes under one check:

  | Runaway, each the body of a function given 1 | Stopped after | A check |
  | --- | --- | --- |
  | A write function that steps past its value | 104.5ms | 1.04ms |
  | A write function that writes forever | 130.6ms | 1.31ms |
  | An empty loop | 1.7ms | 17µs |
  | A loop that counts | 37.9ms | 379µs |
  | A loop that reads and writes an object | 38.1ms | 381µs |
  | A loop that calls a function | 20.2ms | 202µs |
  | A loop that calls the host | 31.2ms | 312µs |
  | A loop that builds an object each pass | 248.2ms | 2.48ms |
  | A loop that slices a string | 63.9ms | 639µs |
  | A regex that backtracks | 9.1ms | 91µs |
  | A loop that catches running out of memory | 2,561.0ms | 25.6ms |

- A loop that catches "out of memory" and keeps allocating took about 25ms a check, so it met the time limit after 2.6s, where [the sandbox](01-plugins.md#the-sandbox) has it meet the limit at 100ms; we haven't traced why a check takes that long there.
- In a context without rquickjs's `Promise` intrinsic, an async function left an object behind, even one declared and never called, and so did a call to `Array.fromAsync`, which the base objects define.
  Dropping the runtime then ended the process on QuickJS-ng's assertion `list_empty(&rt->gc_obj_list)`, so QuickJS-ng's assertions are compiled into release builds, which the 2026-10-17 read left unverified.
  Such an async function read as an `object` to `typeof`, and calling it threw "TypeError: not a function".
- TypeScript refuses an async write function with "TS2318: Cannot find global type 'Promise'", and refuses `queueMicrotask` too, so only a script that builds an async function from a string through `eval`, or reaches `Array.fromAsync` through `as any`, makes one.
- With the intrinsic taken, and the `Promise` and `AsyncDisposableStack` globals it adds deleted, the runtime drops cleanly.
  The context then defines exactly the globals and members `sandbox.json` lists, and an async function runs to its first `await` and never resumes, since nothing runs its jobs.
- With the stack's top pinned at each call into JS, a recursion stopped at the same depth wherever in the Rust stack the call came from: at the thread's top, 256 KB below it, and 512 KB below it, in a run and in a replay.
  The depth was 296 calls in 1 MB in a release build, and 68 in a debug one.
  With the pin taken out of a debug build, the same calls stopped at 30, 69, and 143, where the pinned build stopped each at 68.
- A run and two replays of seven calls, a stopped one among them, made the same checks in each call, and the stopped call stopped at the same tick.
  The check that stops a call starts QuickJS-ng's count of ticks again, so a short call right after it makes no check at all.

The code review found one more, which a test then showed in a debug build: QuickJS-ng says a call met the memory limit in three ways, "out of memory", "out of memory in regexp execution" when a regex's stack outgrows it, and `null` when even the error object doesn't fit (read in rquickjs-sys 0.14.0, `quickjs/quickjs.c`, `JS_ThrowError2`).
A runaway of small objects, `for (;;) last = { next: last }`, threw `null`, which the sandbox read as a script's throw, so the sync engine would have run the function again at the next value rather than stop its entry.
The sandbox reads all three as the memory limit, so a script's own `throw null` does too.

**What changed.**
The sandbox's context takes rquickjs's `Promise` intrinsic and deletes the `Promise` and `AsyncDisposableStack` globals, as it deletes `Math.random`, and its time limit stops a call at its 100th check (user, 2026-10-24).

**Docs affected.**
[Plugins and the sandbox](01-plugins.md) carries a note saying so, with the 2.5s a loop that catches "out of memory" runs; [the code map](../architecture/02-code-map.md) and [the profiles' units](../profiles/02-units.md) carry one where they name the context's intrinsics; the [tentative decision on the sandbox's rules](../architecture/decisions.md#the-sandbox-deletes-mathrandom-and-the-promise-globals-pins-the-stacks-top-at-each-call-into-js-and-builds-its-contexts-from-eval-regexp-and-promise) changes in place; and [the build plan](../build/plan.md)'s stage 12 has its lines.

## 2026-10-17: The Baron's gauge settings change only through its H: events, which do other things in other modes, and QuickJS-ng's hash seed picks only a Map's or a Set's bucket

**Asked.**
What the Baron 58P's plugin has to read and write to sync the settings that live only in its gauges' JavaScript, and whether QuickJS-ng's hash seed, or anything else in the engine, makes a script behave differently in a replay.

**Expected.**
A plugin that reads each setting in its panel and writes it through an operation of our panel bridge, as [03-v1-scope](../product/03-v1-scope.md#plugins) and [01-format-and-delivery](../profiles/01-format-and-delivery.md#plugins) had it, and a seed that orders a Map's iteration.

**Found,** by reading, with nothing run ([the Baron's gauge state](results/2026-10-17-baron-gauge-state.txt), [the QuickJS-ng sandbox](results/2026-10-17-quickjs-sandbox.txt)):

- Every setting is an own property each gauge's constructor sets, saved nowhere, and changed in the gauge's event handler, by its H: events; beyond that, the KAS 297B clears its arming when vertical speed hold engages and takes the autopilot's target as its armed vertical speed, and the KR 87 counts its elapsed seconds each frame while its timer runs (read in bksq-aircraft-baronpro 0.1.1, `KR87A.js`, `KAS297B.js`, `bksq_wradar1.js`).
- The same H: events do other things in other modes: on the radar's systems page they refill the oxygen, repair an engine, or set the battery voltage, and on its failures page one resets every failure; on the KAS 297B they step the altitude preselect or the autopilot's vertical speed unless its knob is pulled and vertical speed hold is off; and the ADF's frequency transfer swaps its frequencies when already in FRQ (same files, `onInteractionEvent` and `onEvent`).
  So a profile can write each setting through its events only in a write function that checks the mode, which another entry already syncs.
- The KX 155B mirrors its knob-pulled states to `L:COM_1_KNOB_PULLED` and its siblings and never reads them back, so a profile syncs them with no plugin, which contradicts 03-v1-scope's write method (read in `KX155B.js`, `onInteractionEvent`).
- The tablet restores each failure row's state at load except engine fires and the five rows that toggle a `K:` event, and does restore engine failures (read in `BlackSquareTablet.js`, `loadFailureStates`, and the types in `populateFailureMatrix`).
- The KNS-81's `radioConfigLoad` is its waypoint load: it reads the 30 DataStorage keys, then tunes NAV 3's active and standby frequencies to waypoint 1, and its `setStandbyFrequency` also writes that frequency into the waypoint on display (read in `KNS81.js`, `radioConfigLoad` and `setStandbyFrequency`), so calling it mid-flight would overwrite that waypoint; the waypoints stay out of v1.
- At a failure rate of 0 the tablet rolls no failures, but the aircraft's XML still sends `K:TOGGLE_ENGINE1_FAILURE` when `L:var_engineDamage_L` reaches 100, and the same for engine 2, and no XML reads the rate (read in `BaronProfessional_Base_INT.xml`).
- QuickJS-ng seeds `Math.random` and a hash seed from the wall clock when it makes a context, and reads the hash seed only in `map_hash_key`, to pick a Map's, Set's, WeakMap's, or WeakSet's bucket, while every iteration walks a list kept in insertion order (read in rquickjs-sys 0.14.0, `quickjs/quickjs.c`, `JS_NewContextRaw`, `map_hash_key`, `js_map_forEach`).
- QuickJS-ng sets its stack limit from the stack pointer when the runtime is made, and rquickjs moves it only with its `parallel` feature, so a recursion's depth at its `RangeError` turns on the Rust stack's depth at the call (read in `quickjs.c`, `update_stack_limit`, and rquickjs-core 0.14.0, `src/runtime/raw.rs`); inferred, not run.

**What changed.**
v1 builds no plugins: a profile reads a gauge's setting through a new name, `instrument()`, and writes it through the gauge's H: events, and the sandbox deletes `Math.random` and pins the stack's top at each call ([plugins and the sandbox](01-plugins.md)).

**Docs affected.**
[Plugins and the sandbox](01-plugins.md), and those its [what this changes elsewhere](01-plugins.md#what-this-changes-elsewhere) lists.
