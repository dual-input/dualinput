# Core: the loop and the edge

```text
Purpose:     How the kernel runs the core's loop, and how the core's edge feeds it, carries out what it puts out, records it, and replays it.
Depends on:  ../architecture/02-code-map.md, ../architecture/01-spine.md, ../architecture/decisions.md, log.md
Decides:     The core's threads; how the queue stamps and orders inputs, and what an input is; the kernel's interface for units, their state, hooks, moments, requests, outputs, timers, jobs, and IDs; what a recording holds for a replay, and how a replay finds where it diverged; what a panic does; how the core starts, stops, and logs; and the budgets of the loop and the edge (node 6.1).
```

The core runs every unit on one thread, the loop, which takes one input at a time from one queue.
An input is its source and its bytes, stamped under the queue's lock, so the stamps rise in the order the loop takes the inputs, and the unit that owns the source parses the bytes on the loop, so a live run and a replay take one path.
The kernel calls each handler with its unit's own state, a read-only view of every other unit's, and an outbox.
The core's edge, in `apps/core`, runs the threads that wait, carries out the outbox, and records each input before the loop handles it, with a hash of everything the core put out once a second, so a replay finds the second where it diverged.
A panic crashes the core, which comes back as a late joiner.

This answers node 6.1 of the [architecture plan](../architecture/plan.md#61-the-cores-loop-and-edge).
The code map's [one loop](../architecture/02-code-map.md#one-loop), [what a feature registers](../architecture/02-code-map.md#what-a-feature-registers), [what a handler sees and does](../architecture/02-code-map.md#what-a-handler-sees-and-does), [guards](../architecture/02-code-map.md#guards), and [the registry and moments](../architecture/02-code-map.md#the-registry-and-moments) give the rules this design builds on, and this document holds only what they leave out.

## The units

| Unit | Holds | Keeps the loop's rules |
| --- | --- | --- |
| kernel | The registry, the store of each unit's state, moments, requests and their guards, the outbox and its running hash, timers, jobs, the handles and IDs it hands out, and the call that handles one input | Yes |
| `apps/core` | `main` and the list of units; the queue; the clock; the timer thread, tokio's runtime, and the blocking pool; a sink for each output type; the recording's writer; replay; the panic hook; and the log's subscriber | No |

## Threads

```text
 sim thread (6.3) ─────────────┐
 tokio: WebSockets, iroh,      │                     ┌─▶ recording writer
   HTTPS, the helper's pipe ───┼─▶ queue ─▶ loop ────┤
 timer thread ─────────────────┤   stamped           └─▶ each output, to its edge
 tokio's blocking pool ────────┘   under its lock
```

| Thread | Runs | Because |
| --- | --- | --- |
| The loop | The kernel, with a 16 MB stack | p10 gave its loop 16 MB for QuickJS-ng (read in `experiments/areas/architecture/recording/loop/src/main.rs`, `STACK`), a probe that never ran, so the bench checks it |
| tokio, with two worker threads | The WebSocket server and its sockets ([6.2](../architecture/plan.md#62-clients-and-the-panel-bridge)), the transport ([6.4](../architecture/plan.md#64-the-network)), HTTPS, and the core helper's pipe ([6.5](../architecture/plan.md#65-the-core-helper)) | The core runs on tokio ([decision 027](../../decisions/027-core-runs-on-tokio.md)) |
| tokio's blocking pool, at most 4 threads | Jobs | One pool, where a second of ours would do the same work |
| The timer thread | A heap of deadlines, waiting on a high-resolution waitable timer for the nearest, or on an event that wakes it when the heap changes | tokio's sleep woke up to 16.9ms late, and a high-resolution waitable timer at most 1.13ms ([log][p01]) |
| The recording's writer | Each input, encoded by the recording-format engine, in zstd frames, one ended each second | A crash loses at most the last second |
| The sim thread | The sim edge, which [6.3](../architecture/plan.md#63-the-sim-seam-and-our-wasm-module) designs | |

## The queue

- `push` takes the queue's lock, reads `QueryPerformanceCounter`, converts it to µs in 128 bits as [times](../architecture/01-spine.md#times) requires, gives the input that stamp and the next sequence number, appends it, and lets go of the lock.
  So no two threads can stamp in one order and push in the other.
  FS Copilot's resend history had that bug: presses and drags arrived on separate pool threads, so two could be recorded with their times in the opposite order to their sequence numbers, and the receiver dropped one as a copy (FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, "R15 · History is ordered by wall clock, not by Seq").
- The queue is unbounded, because the sim thread has to go on dispatching SimConnect's messages and tokio's tasks must never block on the loop.
  When the oldest input waiting is more than 100ms old, the edge logs it, once until the queue catches up, which is how the bench sees a loop falling behind.
- The loop takes every input waiting under one lock, and waits on a condition variable when there's none, with no timeout, since a timer's firing is an input too.

## Inputs

An input is its sequence number, its stamp, its source, and its bytes.

- A unit that takes inputs from outside the core registers a source: the sim service for SimConnect's messages, opens, and losses ([the sim seam](../architecture/02-code-map.md#the-sim-seam)), the clients crate for the WebSockets, the network crate for the links and the messages iroh delivers, the core-helper-service crate for the core helper, and the kernel for its timers, its jobs, and the core's first input.
- Sources are numbered in the order they register, which the same build always repeats, and only the build that wrote a recording replays it ([one loop](../architecture/02-code-map.md#one-loop)), so the number needs no name beside it.
- The bytes are what came in, unparsed: a SimConnect message copied whole, a message as iroh delivered it, a WebSocket's text, a frame from the core helper, a timer's handle, or a job's result.
  The owning unit parses them on the loop, within its handler's 1ms ([budgets](../architecture/02-code-map.md#budgets)), so the only code that runs live and never in a replay is the edge's copying.
  fsc-editor's replay entered after its own parsing, on a path of its own, and a bug that only that path's difference could cause shipped ([why the seam sits at SimConnect's calls](../architecture/02-code-map.md#why-the-seam-sits-at-simconnects-calls)).

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

- The kernel offers moments, requests and guards, sources, timers, and jobs.
- A crate of the platform's adds its own hooks as an extension trait on `Unit<S>`, such as the clients crate's `command` or the cockpit stream's `cockpit_kind`, and keeps its table of what each unit registered in its own state.
- When an input reaches it, such a crate calls the registered handler through the kernel's `invoke`, which takes that unit's state out of its slot and knows which unit runs, for the log and the panic hook.
  So the kernel names no service, as the [code map](../architecture/02-code-map.md#the-registry-and-moments) requires.

### Moments

- `cx.raise(m)` queues a moment on the loop, and the kernel runs each moment's handlers in registration order, a moment raised by a handler queuing behind the ones already waiting, until none is left, before the next input.
- More than 1,000 moments for one input is a cycle, which is a bug, and the kernel panics.
- The map check searches `features/` for `impl Moment`, as it searches a feature's source for another feature's modules, so no feature raises a moment of its own.

### Requests and guards

- A crate of the platform's declares each request it decides with `r.request::<R>()`, with the function that decides it and the function that gives the request this pilot would make now, and a unit adds a guard with `me.guard::<R>(f)`.
- `cx.ask(r)` asks; the kernel runs the request's guards, any denial refuses it, and otherwise its crate decides it, before the next input.
- After each input and its moments, the kernel runs every declared request's guards on the request this pilot would make, and keeps each verdict for the clients crate to show ([guards](../architecture/02-code-map.md#guards)).
  v1 declares about three requests, so this costs microseconds.

### Outputs

- `cx.out(o)` puts out `o`, of a type the crate whose edge carries it out defines, such as the sim service's calls or the network's sends, and every output type is `Serialize + Send + 'static`.
- After the input and its moments, `apps/core` hands each output to the sink it registered for that type, in the order handlers put them out.
  An edge carries out its outputs in that order, and nothing is promised between two edges.
- A unit that needs one output carried out before another waits for an input that says so.
  The session crate puts out the session file with its raised restart count, and opens links only once the file's "written" comes back, as [the session file](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts) requires.
- The kernel folds each output's postcard encoding into a running 64-bit hash, for the recording's checkpoints.

### Timers, jobs, and IDs

- `cx.timer(after)` sets a timer due at the input's stamp plus `after`, and returns its handle, and the timer thread pushes its firing as an input.
  A timer canceled after its firing was queued still comes up, and the kernel drops it.
- `cx.job(j)` starts a job: reading a file, fetching over HTTPS, or reading the clipboard runs at the edge, and its result is an input like any other.
  Which inputs a recording keeps whole, and which by reference, such as a profile's bundle by its hash, is for [6.6](../architecture/plan.md#66-recording-and-bug-reports).
  A job that only computes from inputs the recording already holds, such as parsing a cockpit model, can run again in a replay instead of being recorded, and [6.13](../architecture/plan.md#613-avatars) decides whether avatars needs that.
  A canceled job's result still arrives and is recorded, and the kernel drops it.
- Timers, jobs, and calls that wait for an answer, such as the sim's, take their handles from counters on the loop, so a replay hands out the same ones.
- `cx.new_id()` draws a version 4 UUID from a ChaCha20 generator in the kernel, seeded once by 256 random bits the edge draws from the operating system and puts in the core's first input.
  `uuid`'s `Builder::from_random_bytes` sets the version and variant on bytes it's given (read in uuid 1.28.0, `src/builder.rs`), so the message crate keeps `v4` off.
  A replay draws the same IDs, and nobody without the recording can predict them.

## Replay

### What a recording holds

A recording starts with a header naming the build, then holds three kinds of record, in the order they happened:

- **Inputs,** each before the loop handles it.
- **The sandbox's stops.**
  The check the edge hands the sandbox ([one loop](../architecture/02-code-map.md#one-loop)) reads the clock in a live run, and when it stops a script call at its 100ms limit, it records the call's number and how many interrupt calls it took.
  In a replay it reads no clock, and stops that call at that count.
- **Checkpoints.**
  When an input's stamp starts a new second since the core's first input, the edge records the running hash of the outputs, with the input's sequence number, before the loop handles it: 16 bytes a second, about 58 KB an hour (arithmetic).
  A recording can instead hold a checkpoint before every input, which its header says, for the bench.

The header names the build by its commit, a hash of `Cargo.lock`, the toolchain, and the profile, and an uncommitted build by a hash of its diff too, which the build script writes into the program.
It doesn't name the program's bytes, since a build of one commit on two PCs needn't match byte for byte (unverified for ours).
How the records are encoded is the recording-format engine's, and what a recording keeps is [6.6](../architecture/plan.md#66-recording-and-bug-reports)'s.

### Running a replay

1. Run `crosscheck-core replay <file>`, the same program, built at the commit the header names.
   A program of another build refuses, naming the commit to check out.
2. Its queue fills from the file, at the recorded pace times `--speed`, or as fast as the loop runs with `--speed 0`, as fsc-editor's replay schedules from its capture's stamps (fsc-editor, `src/main/sim/replay.ts`, `startReplay`).
3. Each output goes to a sink that hashes it and drops it, no timer or job runs, since their results come from the file, and the sandbox's check reads its stops from the file.
4. At each checkpoint the replay compares its hash with the recorded one; at the first that differs, it names that checkpoint and the inputs since the one before it.

A developer runs a replay under a debugger, as any run of the core.

### Floating point

`main` calls `_set_FMA3_enable(0)` before it starts any thread, in a live run and a replay.
Rust's `f64` math and QuickJS-ng's `Math` both call the Universal C Runtime's functions, whose FMA3 path the runtime turns on when the CPU has FMA3, and with it off, every PC takes the path a CPU without FMA3 takes ([log][p01]).
That every PC then computes the same results is unverified, and replaying a recording made on a friend's PC on ours settles it.
This answers 02-code-map's item in [left open](../architecture/02-code-map.md#left-open) on replaying on a PC with another CPU, once that replay matches.

## A panic

A release build sets `panic = "abort"`, so a panic on any thread ends the core (documented, [Cargo's profiles](https://doc.rust-lang.org/cargo/reference/profiles.html#panic)).
The panic hook in `apps/core` first logs the panic, the input's sequence number, and the unit that was running, and has the writer end its zstd frame, waiting at most 500ms.
Then the watcher starts the core again ([the watcher and the desktop app](../architecture/01-spine.md#the-watcher-and-the-desktop-app)), and the pilot comes back as a late joiner ([decision 041](../../decisions/041-core-crash-comes-back-as-late-joiner.md)), while a replay of the recording reproduces the panic at the same input.

Catching a feature's panic and turning that feature off for the session would be a mechanism for recovering from our own bugs, and would leave a session half working: a following machine whose flight-model feature was off would fly on its own, where a restart and a late join bring every feature back (user, 2026-10-15).
Tests unwind whatever the profile says, since "The `rustc` test harness currently requires `unwind` behavior" (documented, same page).

## Starting and stopping

The core starts in this order:

1. `main` calls `_set_FMA3_enable(0)`, then reads the port file, and exits if it names a core that's still running for this data folder ([finding the core](../architecture/01-spine.md#finding-the-core)).
2. It draws the generator's 256-bit seed, and registers the units: the platform's crates from the kernel up, then the features, from the one list.
3. It starts the writer, which writes the header, and pushes the core's first input: the seed, and the bytes of the settings file and of the session file, if there is one.
4. It starts the timer thread, tokio's runtime, and the sim thread, and wires each source and each sink.
   The WebSocket server's port, once bound, comes in as an input, and the edge writes the port file.
5. It starts the loop.

The session crate decides when the core exits, by the spine's rule: the sim has closed, no session is held, and the desktop app isn't open ([what moves them](../architecture/01-spine.md#what-moves-them)); its design in [6.7](../architecture/plan.md#67-the-session) confirms it.
It puts out an exit, and then:

1. The loop takes no more inputs.
2. The edges carry out the outputs already put out, within 750ms in all, as FS Copilot's goodbye on the way out had (FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, `ShutdownGrace`).
   FS Copilot's quit queued its goodbye, and "the process exits before LiteNetLib's update thread sends it" (FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-12 — A deliberate quit reaches the peer as an outage").
3. The writer ends its last frame, the edge deletes the port file, and the process exits.

## Logging

- The loop's crates log through `tracing`'s macros, and `apps/core`'s subscriber writes each line to a file in the data folder, stamped with the stamp and sequence number of the input being handled, which the kernel exposes.
- The level is a setting, and a replay may raise it, since a log line is neither an output nor in the hash, and changes nothing a handler reads.
- `tracing` itself reaches no crate on the map check's list of crates that do I/O, which is unverified until the first build, where the map check settles it.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures.

| What | Budget |
| --- | --- |
| The queue, a handler, and the loop's CPU | As [the code map](../architecture/02-code-map.md#budgets) gives them: under 11.2ms at p99, at most 1ms a handler, and under 20% of one CPU core through a busy flight |
| The edge's threads, beside the loop | Under 2% of one CPU core through a busy flight, and under 0.5% with no session |
| Memory | Under 30 MB of private working set with no session, and under 100 MB in a busy session, beside QuickJS-ng's runtimes, which their 64 MB limits cap ([decision 046](../../decisions/046-sandbox-runtimes-and-limits.md)) |
| A timer | Fires within 1ms of its deadline at p99 |
| A crash | Loses at most the recording's last second |
| A replay | Runs an hour's recording in under 6 minutes |
| Exiting | Done within 1s of the exit going out |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test:

- Two edges push at once for minutes, and every stamp rises with its sequence number.
- A pilot quits Crosscheck in a session, and the other core gets the goodbye before the process exits.
- The core is killed, and its recording reads up to its last full frame.
- A test unit raises moments in a cycle, and the kernel panics after 1,000.
- A replay on another build refuses, naming the commit.
- A test unit that reads the clock in one handler is caught at the next checkpoint of its replay.
- A handler panics, the core restarts, the pilot comes back as a late joiner, and the replay panics at the same input.
- The timers fire within their budget with the sim running and the PC busy.

## Left open

- Which lock the queue takes, which 64-bit hash folds the outputs, which crate gives ChaCha20, and how big the log file grows: choices inside `apps/core` or the kernel.
- Whether every PC computes the same results with FMA3 off, which replaying a friend's recording on ours settles.
- What a recording keeps, and what it keeps by reference: [6.6](../architecture/plan.md#66-recording-and-bug-reports).
- Whether avatars' model parse runs again in a replay: [6.13](../architecture/plan.md#613-avatars).

[p01]: log.md#2026-10-15-tokios-timers-wake-up-to-17ms-late-on-windows-a-high-resolution-waitable-timer-wakes-within-12ms-and-rusts-f64-math-calls-the-c-runtimes
