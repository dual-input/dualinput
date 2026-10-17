# Core: the loop and the edge

```text
Purpose:     How the kernel runs the core's loop, and how the core's edge feeds it, carries out what it puts out, records it, and replays it.
Depends on:  ../architecture/02-code-map.md, ../architecture/01-spine.md, ../architecture/decisions.md, log.md
Decides:     The core's threads; how the queue stamps and orders inputs, and what an input is; the kernel's interface for units, their state, hooks, moments, requests, outputs, timers, jobs, and IDs; what a recording holds for a replay, and how a replay finds where it diverged; the core's math; what a panic does; how the core starts, stops, quits, and logs; and the budgets of the loop and the edge (node 6.1).
```

> **Note**
> Since 2026-10-16, the kernel also hands out random bytes, through `cx.random_bytes()` from the same ChaCha20 generator as `cx.new_id()`, for the network's endpoint key, where [timers, jobs, and IDs](#timers-jobs-and-ids) has the generator draw only UUIDs ([02-units](../network/02-units.md#the-endpoint-key)).
>
> Since 2026-10-16, [01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md) changes this document in five places:
>
> - The writer leaves out the inputs a feature declares unrecorded, so [what a recording holds](#what-a-recording-holds) is every input but those; a unit with one runs in a replay on what was recorded, and its outputs aren't checked.
> - Each unit counts its own timers, jobs, and calls, and draws its IDs and random bytes from a generator of its own, seeded from the one seed and its place in the registry, where [timers, jobs, and IDs](#timers-jobs-and-ids) has one counter and one generator; and each output names its unit, so the checkpoints' hash folds only whole units' outputs.
> - A replay on the same commit with uncommitted changes warns and runs, where [running a replay](#running-a-replay) has any other build refuse.
> - A recording also holds marks, and writes each input's numbers as varints, in a folder for each run in `recordings\` with the run's log file.
> - The panic hook has the writer record the input being handled, even an unrecorded one, and a replay reproduces a panic only in a whole unit, where [a panic](#a-panic) promises it for any.
> - The edge puts a same-length placeholder in place of the home folder's path in every input, and the real path back in each output that names a file, and hands up the clipboard only when it holds an invite code.
>
> Since 2026-10-16, a job may also run an engine's work on what it read, as the profile loader's job reads, parses, and checks a bundle and hands up the checked profile encoded with postcard, beside the jobs [timers, jobs, and IDs](#timers-jobs-and-ids) lists; and the edge fetches over HTTPS through reqwest 0.13 with rustls, which iroh already brings into the core ([the profiles' units](../profiles/02-units.md#fetching)).
> Since 2026-10-17, the desktop app offers no quit, so a quit comes from the watcher's tray or from Windows, where [quitting](#quitting) also has it come from the desktop app; and the edge also starts the desktop app's program when the EFB app's button asks for it and no desktop app is connected ([the apps](../interface/01-apps.md#quit)).

The core runs every unit on one thread, the loop, which takes one input at a time from one queue.
An input is its source and its bytes, stamped under the queue's lock, so the stamps rise in the order the loop takes the inputs, and the unit that owns the source parses the bytes on the loop, so a live run and a replay take one path.
The kernel calls each handler with its unit's own state, a read-only view of every other unit's, and an outbox, and runs every call one unit asks of another after the asking handler returns.
The core's edge, in `apps/core`, runs the threads that wait, carries out the outbox, and records every input from the core's first, with a hash of everything the core put out once a second, so a replay on the same build finds the second where it diverged.
A panic crashes the core, which comes back as a late joiner, and a quit, from the pilot or from Windows ending their session, leaves the session before the core exits.

This answers node 6.1 of the [architecture plan](../architecture/plan.md#61-the-cores-loop-and-edge).
The code map's [one loop](../architecture/02-code-map.md#one-loop), [what a feature registers](../architecture/02-code-map.md#what-a-feature-registers), [what a handler sees and does](../architecture/02-code-map.md#what-a-handler-sees-and-does), [guards](../architecture/02-code-map.md#guards), and [the registry and moments](../architecture/02-code-map.md#the-registry-and-moments) give the rules this design builds on, and this document holds only what they leave out.

## The units

| Unit | Holds |
| --- | --- |
| kernel | The registry, the store of each unit's state, moments and the calls units ask of each other, requests and their guards, the outbox and its running hash, timers, jobs, the handles and IDs it hands out, and the call that handles one input |
| `apps/core` | `main` and the list of units; the queue; the clock; the edge's threads; a sink for each output type; the recording's writer; replay; the panic hook; the log's subscriber; and the one foreign function it declares, [below](#the-cores-math) |

## Threads

```text
 sim thread (6.3) ─────────────┐
 tokio: WebSockets, iroh,      │                     ┌─▶ recording writer
   HTTPS, the helper's pipe ───┤                     │
 timer thread ─────────────────┼─▶ queue ─▶ loop ────┤
 window thread ────────────────┤   stamped           └─▶ each output, to its edge
 tokio's blocking pool ────────┘   under its lock
```

| Thread | Runs | Because |
| --- | --- | --- |
| The loop | The kernel, with a 16 MB stack | p10 gave its loop thread 16 MB (read in `experiments/areas/architecture/recording/loop/src/main.rs`, `STACK`), whose source gives no reason, so the bench finds what QuickJS-ng needs |
| tokio, with two worker threads | The WebSocket server and its sockets ([6.2](../architecture/plan.md#62-clients-and-the-panel-bridge)), the transport ([6.4](../architecture/plan.md#64-the-network)), HTTPS, and the core helper's pipe ([6.5](../architecture/plan.md#65-the-core-helper)) | The core runs its sockets on tokio ([decision 027](../../decisions/027-core-runs-on-tokio.md)) |
| tokio's blocking pool, at most 4 threads | Jobs | One pool, where a second of ours would do the same work |
| The timer thread | A heap of deadlines, waiting through windows-sys's `CreateWaitableTimerExW` on a high-resolution waitable timer for the nearest, or on an event that wakes it when the heap changes | tokio's sleep woke up to 16.9ms late, and a high-resolution waitable timer at most 1.46ms ([core log][p01]); so this changes decision 027 for the loop's timers, once step 8's decisions are numbered |
| The window thread | A top-level window the core never shows, which hears Windows end the session, [below](#quitting) | Windows sends `WM_QUERYENDSESSION` to a window, through its `WindowProc` (documented, [WM_QUERYENDSESSION](https://learn.microsoft.com/en-us/windows/win32/shutdown/wm-queryendsession)), and the core has none otherwise |
| The recording's writer | Each record, encoded by the recording-format engine, in zstd frames, one ended each second | Each zstd frame "can be decompressed independently of other frames" (documented, [RFC 8878](https://www.rfc-editor.org/rfc/rfc8878#section-3.1)) |
| The sim thread | The sim edge, which [6.3](../architecture/plan.md#63-the-sim-seam-and-our-wasm-module) designs | |

## The queue

- `push` takes the queue's lock, reads `QueryPerformanceCounter`, converts it to µs in 128 bits as [times](../architecture/01-spine.md#times) requires, gives the input that stamp and the next sequence number, appends it, and lets go of the lock.
  So no two threads can stamp in one order and push in the other.
  FS Copilot's pre-PR review found that bug in its resend history by reading the code: presses and drags arrived on separate pool threads, so two could be recorded with their times opposite to their sequence numbers, and the receiver would drop one as a copy (FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, "R15 · History is ordered by wall clock, not by Seq").
- The queue is unbounded, because the sim thread has to go on dispatching SimConnect's messages and tokio's tasks must never block on the loop.
  When the oldest input waiting is more than 100ms old, the edge logs it, once until the queue catches up, which is how the bench sees a loop falling behind.

## Inputs

An input is its sequence number, its stamp, its source, and its bytes.

- A unit that takes inputs from outside the core registers a source: the sim service for SimConnect's messages, opens, and losses ([the sim seam](../architecture/02-code-map.md#the-sim-seam)), the clients crate for the WebSockets, the network crate for the links and the messages iroh delivers, the core-helper-service crate for the core helper, the session crate for Windows ending the session, and the kernel for its timers, its jobs, and the core's first input.
- Sources are numbered in the order they register, which the same build always repeats, and only the build that wrote a recording replays it ([one loop](../architecture/02-code-map.md#one-loop)), so the number needs no name beside it.
- The bytes are what came in, unparsed: a SimConnect message copied whole, a message as iroh delivered it, a WebSocket's text, a frame from the core helper, a timer's handle, or a job's result.
  The owning unit parses them on the loop, within its handler's 1ms ([budgets](../architecture/02-code-map.md#budgets)), so the only code that runs live and never in a replay is the edge's copying, as [why the seam sits at SimConnect's calls](../architecture/02-code-map.md#why-the-seam-sits-at-simconnects-calls) has it for the sim.

## The kernel's interface

```rust
// a sketch
pub fn register(r: &mut Registry) {
    let me = r.unit::<PointerSync>("pointer-sync");   // its state: Default, in a slot by registration order
    me.on::<LinkLost>(PointerSync::lock_displays);    // a moment, whose type the network crate holds
}

fn lock_displays(me: &mut PointerSync, _: &LinkLost, cx: &mut Cx) {
    let session = cx.read::<Session>();               // another unit's state, read-only
    cx.out(Lock { display: me.display });             // an output, which apps/core routes by its type
    me.unlock = Some(cx.timer(secs(5)));              // a handle now, an input when it fires
}
```

### Units and their state

- `r.unit::<S>(name)` adds a unit whose state `S` starts as `S::default()`, in a slot of a `Vec` by registration order, so the store never iterates a `HashMap`.
- While a handler runs, the kernel takes its unit's state out of its slot, so the handler holds the only `&mut` to its own state, and `cx.read::<T>()` hands it `&` to any other unit's, with no `RefCell`.
  A handler that reads its own unit's state through `cx` panics, since it already holds it.
- Which unit's state a handler can name is the crate graph's: reading `T` takes a dependency on `T`'s crate, which the [map check](../architecture/02-code-map.md#the-map-check) holds to the code map's tiers.

### Hooks

- A crate of the platform's adds its own hooks as an extension trait on `Unit<S>`, such as the clients crate's `command` or the cockpit stream's `cockpit_kind`, and keeps its table of what each unit registered in its own state.
- When an input reaches such a crate, it asks the kernel to call the registered handler, and the kernel makes the call once the asking handler has returned and its state is back in its slot, so the called handler can read the asking crate's state, such as the settings or sim awareness.
  An answer the asking crate needs, such as a cockpit kind's "applied", comes back to it the same way, as a call to one of its handlers.
- So the kernel names no service, as the [code map](../architecture/02-code-map.md#the-registry-and-moments) requires, and knows which unit each call runs, for the log and the panic hook.

### Moments

- `cx.raise(m)` queues a moment behind the moments and calls already waiting, and the kernel runs them all, in that order, before the next input.
- More than 1,000 moments and calls for one input is a cycle, which is a bug, and the kernel panics.
- The map check also searches `features/` for `impl Moment`, as it searches a feature's source for another feature's modules, so no feature raises a moment of its own; this adds to [the map check](../architecture/02-code-map.md#the-map-check)'s searches.

### Requests and guards

- A crate of the platform's declares each request it decides with `r.request::<R>()`, passing two functions: one decides a request, and one builds the request this pilot would make if they asked now, such as taking control.
  A unit adds a guard with `me.guard::<R>(f)`.
- `cx.ask(r)` asks; the kernel runs the request's guards, any denial refuses it, and otherwise its crate decides it, before the next input.
- After each input, the kernel builds each declared request as this pilot would make it now and runs its guards on it, and those results are the verdicts [guards](../architecture/02-code-map.md#guards) keeps.
  v1 declares about three requests, so this costs microseconds after each input (unverified, the bench measures it).

### Outputs

- `cx.out(o)` puts out `o`, of a type the crate whose edge carries it out defines, such as the sim service's calls or the network's sends, and every output type is `Serialize + Send + 'static`.
- After the input and its moments and calls, `apps/core` hands each output to the sink it registered for that type, in the order handlers put them out.
  An edge carries out its outputs in that order, and nothing is promised between two edges.
- A unit that needs one thing done before another waits for the input that says it's done.
  The session crate writes the session file with its raised restart count as a job, and opens links only once the job's result says it's written, as [the session file](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts) requires.
- The kernel folds each output's postcard encoding into a running 64-bit hash, for the recording's checkpoints.

### Timers, jobs, and IDs

- `cx.timer(after)` sets a timer due at the input's stamp plus `after`, and returns its handle, and the timer thread pushes its firing as an input.
- `cx.job(j)` starts a job at the edge: reading or writing a file, fetching over HTTPS, or reading the clipboard, whose result, or its error, is an input like any other.
- A timer or a job canceled after its input was queued still comes up, and the kernel drops it.
- Timers, jobs, and calls that wait for an answer, such as the sim's, take their handles from counters on the loop, so a replay hands out the same ones.
- `cx.new_id()` draws a version 4 UUID from a ChaCha20 generator in the kernel, seeded once by 256 random bits the edge draws from the operating system and puts in the core's first input.
  `uuid`'s `Builder::from_random_bytes` sets the version and variant on bytes it's given (read in uuid 1.28.0, `src/builder.rs`), so the message crate keeps `v4` off.
  A replay draws the same IDs, and nobody without the recording can predict them.

## Replay

### What a recording holds

The writer records every input from the core's first, in every run of the core, with or without a session, because a replay has to start where the run did: the seed, the handles, sim awareness, and the clients all build up from the first input.
What a run's recording is kept for, and for how long, is [6.6](../architecture/plan.md#66-recording-and-bug-reports)'s, which keeps or deletes a recording whole.

A recording starts with a header, then holds three kinds of record, in the order they happened:

- **Inputs,** each before the loop handles it.
- **The sandbox's stops,** each a script call's number and the count of interrupt calls at which [one loop](../architecture/02-code-map.md#one-loop)'s check stopped it.
- **Checkpoints:** when an input's stamp starts a new second since the core's first input, the edge records the running hash of the outputs and the input's sequence number, 8 bytes each, before the loop handles it, about 58 KB an hour before framing (arithmetic).
  A recording can instead hold a checkpoint before every input, which its header says, for the bench.

The header names the build: its commit, a hash of its diff when it's uncommitted, its profile, the versions of `rustc`, of the MSVC compiler `cc` builds QuickJS-ng with, and of the Windows SDK, whose C runtime the core links ([the core's math](#the-cores-math)), and the SimConnect SDK the build printed ([building every target](../architecture/02-code-map.md#building-every-target)).
It doesn't name the program's bytes, since a build of one commit on two PCs needn't match byte for byte (unverified for ours).
It also names the PC's CPU, and whether it has FMA3, so a replay that diverges on another CPU says so.
How the records are encoded is the recording-format engine's.

### Running a replay

1. Run `crosscheck-core replay <file>`, the same program, built at the commit the header names.
   A program of another build refuses, naming the commit to check out, and one on a PC whose CPU differs from the header's says so before it runs.
2. The replay starts none of the edge's threads, so it binds no server and writes no port file, and takes a folder beside the recording as its data folder, for its named mutex and its log file, so it can run while Crosscheck does; it takes the seed, the settings, and the session file from the recorded first input.
3. Its queue fills from the file as fast as the loop takes inputs, each output's sink drops it, no timer or job runs, since their results come from the file, and the sandbox's check reads its stops from the file.
4. At each checkpoint the replay compares its hash with the recorded one; at the first that differs, it names that checkpoint and the inputs since the one before it.

### The core's math

Rust's `f64` math and QuickJS-ng's `Math` both call the C runtime's functions, and two things changed the bits they returned, alike in both ([core log][p01]):

- the FMA3 switch, which the runtime turns on at startup on a CPU that has FMA3
- the runtime's version: with FMA3 off, Windows' `ucrtbase.dll` and the Windows SDK's static library still gave different bits

Windows always loads its own `ucrtbase.dll`, whose version follows each pilot's Windows, even when a program ships its own copy beside it (documented, [Universal CRT deployment](https://learn.microsoft.com/en-us/cpp/windows/universal-crt-deployment)).
So the core links the C runtime statically, which puts the math in our program, and `main` calls `_set_FMA3_enable(0)` before it starts any thread, in a live run and a replay.
That two CPUs give the same bits from one build with FMA3 off is unverified, and replaying a recording made on a friend's PC on ours settles it, which then answers 02-code-map's item in [left open](../architecture/02-code-map.md#left-open) on a PC with another CPU.

`_set_FMA3_enable` is in neither windows-sys 0.61.2 nor libc 0.2.190 (read in each crate's source), so `apps/core` declares that one foreign function itself, the third crate the code map's [tiers](../architecture/02-code-map.md#tiers) let declare one, for that function alone; the timer thread takes its functions from windows-sys.

## A panic

A release build sets `panic = "abort"`, so a panic on any thread ends the core (documented, [Cargo's profiles](https://doc.rust-lang.org/cargo/reference/profiles.html#panic)), and the process exits with a code other than 0 (unverified; a bench case checks it).
The panic hook in `apps/core` runs first, as std runs it "with both the aborting and unwinding runtimes" (documented, [`std::panic::set_hook`](https://doc.rust-lang.org/std/panic/fn.set_hook.html)): it logs the panic, the input's sequence number, and the unit that was running, and has the writer end its zstd frame, waiting at most 500ms.
The crash then takes [decision 041](../../decisions/041-core-crash-comes-back-as-late-joiner.md)'s path: the watcher starts the core again, and the pilot comes back as a late joiner, while a replay of the recording reproduces the panic at the same input.

Catching a feature's panic and turning that feature off for the session would be a mechanism for recovering from our own bugs, and would leave a session half working: a following machine whose flight-model feature was off would fly on its own, where a restart and a late join bring every feature back (user, 2026-10-15).

## Starting and stopping

The core starts in this order:

1. `main` turns FMA3 off, takes a named mutex for its data folder, and exits if another core holds it, so two cores started at once for one data folder can't both run; the port file still tells the apps outside the sim where the core is ([finding the core](../architecture/01-spine.md#finding-the-core)).
2. It draws the generator's 256-bit seed, and registers the units ([the registry and moments](../architecture/02-code-map.md#the-registry-and-moments)).
3. It starts the writer, which writes the header, and pushes the core's first input: the seed, and the bytes of the settings file and of the session file, if there is one.
4. It starts the timer thread, the window thread, tokio's runtime, and the sim thread, and wires each source and each sink.
   The WebSocket server's port, once bound, comes in as an input, and the edge writes the port file.
5. It starts the loop.

### Exiting

The session crate decides when the core exits, by the spine's rule in [what moves them](../architecture/01-spine.md#what-moves-them), as [6.7](../architecture/plan.md#67-the-session) designs it, and after a quit, [below](#quitting).
It puts out an exit, and then:

1. The loop takes no more inputs.
2. The edges carry out the outputs already put out, within 750ms in all, as FS Copilot's goodbye on the way out had (FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, `ShutdownGrace`).
   FS Copilot's quit queued its goodbye, and "the process exits before LiteNetLib's update thread sends it" (FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-12 — A deliberate quit reaches the peer as an outage").
3. The writer ends its last frame, the edge deletes the port file, and the process exits with 0, which tells the watcher it meant to.

### Quitting

A quit comes from the pilot, from the desktop app or the watcher's tray, which [6.16](../architecture/plan.md#616-the-apps) and [6.17](../architecture/plan.md#617-installing-and-updating) design, or from Windows ending the pilot's session.
The session crate runs a quit as a Leave, so the crew sees the pilot leave rather than lose the link ([leaving](../network/01-between-machines.md#leaving)), and then exits.

- Windows sends `WM_QUERYENDSESSION` to the core's window, which returns `TRUE` at once and pushes the quit, since "Each application should return TRUE or FALSE immediately upon receiving this message, and defer any cleanup operations until it receives the WM_ENDSESSION message" (documented, [WM_QUERYENDSESSION](https://learn.microsoft.com/en-us/windows/win32/shutdown/wm-queryendsession)).
- The window procedure doesn't return from `WM_ENDSESSION`: it waits there while [exiting](#exiting) runs, and the process ends with the call still open, because Windows may end the session "any time after all applications have returned from processing this message" (documented, [WM_ENDSESSION](https://learn.microsoft.com/en-us/windows/win32/shutdown/wm-endsession)).
- After 5s Windows shows the applications that hold up the shutdown (same page as `WM_QUERYENDSESSION`), so a quit finishes within 3s.
- Whether Windows sends these to a window that's never shown is unverified, and a bench case settles it.

## Logging

- The loop's crates log through `tracing`'s macros, and `apps/core`'s subscriber writes each line to a file in the data folder, stamped with the stamp and sequence number of the input being handled, which the kernel exposes.
- The level is a setting, and a replay may raise it, since a log line is neither an output nor in the hash, and changes nothing a handler reads.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures.

| What | Budget |
| --- | --- |
| The queue, a handler, and the loop's CPU | [The code map's](../architecture/02-code-map.md#budgets) |
| The edge's threads, beside the loop | Under 2% of one CPU core through a busy flight, and under 0.5% with no session |
| Memory | Under 30 MB of private working set with no session, and under 100 MB in a busy session, beside QuickJS-ng's runtimes, which their 64 MB limits cap ([decision 046](../../decisions/046-sandbox-runtimes-and-limits.md)) |
| A timer | Fires within 2ms of its deadline at p99, where p01 saw at most 1.46ms on an idle PC ([core log][p01]) |
| A crash | Loses at most the recording's last second |
| A replay | Runs an hour's recording in under 6 minutes |
| Exiting | Done within 1s of the exit going out, and a quit within 3s of Windows' `WM_QUERYENDSESSION` |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test:

- Two edges push at once for minutes, and every stamp rises with its sequence number.
- A feature's command handler reads the clients crate's settings while the clients crate dispatches it.
- A pilot quits Crosscheck in a session, and the other core sees a leave, not an outage.
- Windows signs the pilot out with a session held, and the other core sees a leave.
- The core is killed, and its recording reads up to its last full frame.
- A handler panics: the process exits with a code other than 0, the watcher starts it again, the pilot comes back as a late joiner, and the replay panics at the same input.
- The core exits on its own, with 0, and the watcher doesn't start it again.
- A test unit raises moments in a cycle, and the kernel panics after 1,000.
- A replay on another build refuses, naming the commit.
- A test unit that reads the clock in one handler is caught at the next checkpoint of its replay.
- The timers fire within their budget with the sim running and the PC busy.

## Left open

- Which lock the queue takes, which 64-bit hash folds the outputs, and how big the `tracing` log file grows: choices inside `apps/core` or the kernel.
- Which crate gives ChaCha20, inside the kernel, where the map check fails one that turns on `getrandom`.
- Whether two CPUs give the same bits from one build with FMA3 off, which replaying a friend's recording on ours settles.

[p01]: log.md#2026-10-15-a-high-resolution-waitable-timer-wakes-within-15ms-where-tokios-wake-up-to-17ms-late-and-the-cores-math-changes-with-the-c-runtimes-fma3-switch-and-with-its-version
