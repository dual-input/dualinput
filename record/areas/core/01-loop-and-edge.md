# Core: the loop and the edge

```text
Purpose:     How the kernel runs the core's loop, and how the core's edge feeds it, carries out what it puts out, records it, and replays it.
Depends on:  ../architecture/02-code-map.md, ../architecture/01-spine.md, ../architecture/decisions.md, log.md
Decides:     The core's threads; how the queue stamps and orders inputs, and what an input is; the kernel's interface for units, their state, hooks, moments, requests, outputs, timers, jobs, and IDs; what a recording holds for a replay, and how a replay finds where it diverged; the core's math; what a panic does; how the core starts, stops, quits, and logs; and the budgets of the loop and the edge (node 6.1).
```

> **Note**
> Stage 11b's tentative decision that [Dual Input's one full window is its EFB app](../interface/decisions.md#dual-inputs-one-full-window-is-its-efb-app) takes out the EFB app's button that brought the desktop app forward, so the core's edge no longer starts the desktop app's program, as [starting and stopping](#starting-and-stopping) has it (user, 2026-10-25).

The core runs every unit on one thread, the loop, which takes one input at a time from one queue.
An input is its source and its bytes, stamped under the queue's lock, so the stamps rise in the order the loop takes the inputs, and the unit that owns the source parses the bytes on the loop, so a live run and a replay take one path.
The kernel calls each handler with its unit's own state, a read-only view of every other unit's, and an outbox, and runs every call one unit asks of another after the asking handler returns.
The core's edge, in `src/apps/core`, runs the threads that wait, carries out the outbox, and records every input from the core's first, with a hash once a second of every unit's outputs, so a replay on the same build finds the second where it diverged.
A panic crashes the core, which comes back as a late joiner.
The pilot's quit leaves the session before the core exits, and Windows ending the pilot's session ends the core with no quit.

This answers node 6.1 of the [architecture plan](../architecture/plan.md#61-the-cores-loop-and-edge).
The code map's [one loop](../architecture/02-code-map.md#one-loop), [what a feature registers](../architecture/02-code-map.md#what-a-feature-registers), [what a handler sees and does](../architecture/02-code-map.md#what-a-handler-sees-and-does), [guards](../architecture/02-code-map.md#guards), and [the registry and moments](../architecture/02-code-map.md#the-registry-and-moments) give the rules this design builds on, and this document holds only what they leave out.

## The units

| Unit | Holds |
| --- | --- |
| kernel | The registry, the store of each unit's state, moments and the calls units ask of each other, requests and their guards, the outbox and its running hash, timers, jobs, the handles and IDs it hands out, and the call that handles one input |
| `src/apps/core` | `main` and the list of units; the queue; the clock; the edge's threads; a sink for each output type; the recording's writer; replay; the panic hook; the log's subscriber; and the one foreign function it declares, [below](#the-cores-math) |

## Threads

```text
 sim thread (6.3) ─────────────┐
 tokio: WebSockets, iroh,      │                     ┌─▶ recording writer
   HTTPS, the helper's pipe ───┤                     │
 timer thread ─────────────────┼─▶ queue ─▶ loop ────┤
 tokio's blocking pool ────────┘   stamped           └─▶ each output, to its edge
                                   under its lock
```

| Thread | Runs | Because |
| --- | --- | --- |
| The loop | The kernel, with a 16 MB stack | p10 gave its loop thread 16 MB (read in `experiments/areas/architecture/recording/loop/src/main.rs`, `STACK`), whose source gives no reason, so the bench finds what QuickJS-ng needs |
| tokio, with two worker threads | The WebSocket server and its sockets ([6.2](../architecture/plan.md#62-clients-and-the-panel-bridge)), the transport ([6.4](../architecture/plan.md#64-the-network)), HTTPS, and the core helper's pipe ([6.5](../architecture/plan.md#65-the-core-helper)) | The core runs its sockets on tokio ([decision 027](../../decisions/027-core-runs-on-tokio.md)) |
| tokio's blocking pool, at most 4 threads | Jobs | One pool, where a second of ours would do the same work |
| The timer thread | A heap of deadlines, waiting through windows-sys's `CreateWaitableTimerExW` on a high-resolution waitable timer for the nearest, or on an event that wakes it when the heap changes | tokio's sleep woke up to 16.9ms late, and a high-resolution waitable timer at most 1.46ms ([core log][p01]); so this changes decision 027 for the loop's timers, once step 8's decisions are numbered |
| The recording's writer | Each record, encoded by the recording-format engine, in one zstd frame for the run, flushed each second | One frame flushed each second kept a busy flight's recording at 42.6 MB an hour, where a frame ended each second took 66.7 MB (measured on our development machine, 2026-10-23, [recording log][flush]; user, 2026-10-23) |
| The sim thread | The sim edge, which [6.3](../architecture/plan.md#63-the-sim-seam-and-our-wasm-module) designs | |

## The queue

- `push` takes the queue's lock, reads `QueryPerformanceCounter`, converts it to µs in 128 bits as [times](../architecture/01-spine.md#times) requires, gives the input that stamp and the next sequence number, appends it, and lets go of the lock.
  So no two threads can stamp in one order and push in the other.
  FS Copilot's pre-PR review found that bug in its resend history by reading the code: presses and drags arrived on separate pool threads, so two could be recorded with their times opposite to their sequence numbers, and the receiver would drop one as a copy (FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, "R15 · History is ordered by wall clock, not by Seq").
- The lock is std's `Mutex` over a `VecDeque`, and the loop sleeps on std's `Condvar` while the queue is empty.
  A channel, std's `mpsc` or crossbeam's, would push without a lock, but its stamp and its send are two steps, so two threads could stamp in one order and send in the other, as in R15.
  parking_lot's lock has no poisoning, but ours is held for one clock read and one append, and a panic ends the core before a poisoned lock is ever seen ([a panic](#a-panic)).
- The queue is unbounded, because the sim thread has to go on dispatching SimConnect's messages and tokio's tasks must never block on the loop.
  When the oldest input waiting is more than 100ms old, the edge logs it, once until the queue catches up, which is how the bench sees a loop falling behind.

## Inputs

An input is its sequence number, its stamp, its source, and its bytes.

- A unit that takes inputs from outside the core registers a source: the sim service for SimConnect's messages, opens, and losses ([the sim seam](../architecture/02-code-map.md#the-sim-seam)), the clients crate for the WebSockets, the network crate for the links and the messages iroh delivers, the core-helper-service crate for the core helper, and the kernel for its timers, its jobs, and the core's first input.
- Sources are numbered in the order they register, which the same build always repeats, and a recording replays only on its release's own program or a build of its commit ([running a replay](#running-a-replay)), so the number needs no name beside it.
- The bytes are what came in, unparsed: a SimConnect message copied whole, a message as iroh delivered it, a WebSocket's text, a frame from the core helper, a timer's handle, or a job's result.
  The owning unit parses them on the loop, within its handler's 1ms ([budgets](../architecture/02-code-map.md#budgets)), so the only code that runs live and never in a replay is the edge's copying, as [why the seam sits at SimConnect's calls](../architecture/02-code-map.md#why-the-seam-sits-at-simconnects-calls) has it for the sim.
- The edge leaves every input as it came: no placeholder replaces the home folder's path, and no output that names a file gets the path back ([the home folder's path](../recording/01-recording-and-bug-reports.md#the-home-folders-path); user, 2026-10-23; [recording log][flush]).

## The kernel's interface

```rust
// a sketch
pub fn register(r: &mut Registry) {
    let me = r.unit::<PointerSync>("pointer-sync");   // its state: Default, in a slot by registration order
    me.on::<LinkLost>(PointerSync::lock_displays);    // a moment, whose type the network crate holds
}

fn lock_displays(me: &mut PointerSync, _: &LinkLost, cx: &mut Cx) {
    let session = cx.read::<Session>();               // another unit's state, read-only
    cx.out(Lock { display: me.display });             // an output, which src/apps/core routes by its type
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
- The map check also searches `src/features/` for `impl Moment`, as it searches a feature's source for another feature's modules, so no feature raises a moment of its own; this adds to [the map check](../architecture/02-code-map.md#the-map-check)'s searches.

### Requests and guards

- A crate of the platform's declares each request it decides with `r.request::<R>()`, passing two functions: one decides a request, and one builds the request this pilot would make if they asked now, such as taking control.
  A unit adds a guard with `me.guard::<R>(f)`.
- `cx.ask(r)` asks; the kernel runs the request's guards, any denial refuses it, and otherwise its crate decides it, before the next input.
- After each input, the kernel builds each declared request as this pilot would make it now and runs its guards on it, and those results are the verdicts [guards](../architecture/02-code-map.md#guards) keeps.
  v1 declares about three requests, so this costs microseconds after each input (unverified, the bench measures it).

### Outputs

- `cx.out(o)` puts out `o`, of a type the crate whose edge carries it out defines, such as the sim service's calls or the network's sends, and every output type is `Serialize + Send + 'static`.
- After the input and its moments and calls, `src/apps/core` hands each output to the sink it registered for that type, in the order handlers put them out.
  An edge carries out its outputs in that order, and nothing is promised between two edges.
- A unit that needs one thing done before another waits for the input that says it's done.
  The session crate writes the session file with its raised restart count as a job, and opens links only once the job's result says it's written, as [the session file](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts) requires.
- Each output names its unit, and the kernel folds every unit's outputs, traffic's, avatars', the flight model's, and ATC audio's among them, each by its postcard encoding, into a running 64-bit hash for the recording's checkpoints (user, 2026-10-21; [recording log][every]).
- The hash is the first 8 bytes of a running SHA-256, from the sha2 crate the message crate's hash already uses.
  A build of the header's commit made with another rustc still replays, with a warning ([running a replay](#running-a-replay)), so the hash has to come out the same across Rust releases, and std's `DefaultHasher` "should not be relied upon over releases" (documented, [DefaultHasher](https://doc.rust-lang.org/std/hash/struct.DefaultHasher.html)).
  xxh3 would be many times faster, and FNV-1a needs no crate, and the hash takes the heavy outputs too, traffic's, avatars', the flight model's, and ATC audio's, so whether SHA-256's hundreds of MB a second still leave it a small part of the loop's time is unverified, and the bench measures the loop's CPU.

### Timers, jobs, and IDs

- `cx.timer(after)` sets a timer due at the input's stamp plus `after`, and returns its handle, and the timer thread pushes its firing as an input.
- `cx.job(j)` starts a job at the edge: reading or writing a file, listing a folder with each entry's size, deleting a file or a folder, fetching over HTTPS, or reading the clipboard, whose result, or its error, is an input like any other.
  The recording crate lists and deletes its runs through the folder jobs (user, 2026-10-23; [recording log][flush]).
  A job may also run an engine's work on what it read, as the profile loader's job reads, parses, and checks a bundle and hands up the checked profile encoded with postcard ([loading](../profiles/02-units.md#loading)).
  The edge fetches over HTTPS through reqwest 0.13 with rustls, which iroh already brings into the core ([fetching](../profiles/02-units.md#fetching)), and hands up the clipboard only when it holds an invite code ([the clipboard](../recording/01-recording-and-bug-reports.md#the-clipboard)).
- A timer or a job canceled after its input was queued still comes up, and the kernel drops it.
- The kernel draws every unit's handles, for its timers, jobs, and calls that wait for an answer, such as the sim's, from one counter on the loop, and since the core records every input, a replay hands out the same ones (user, 2026-10-23; [recording log][flush]).
  A handle names the unit that drew it, whose handler its timer's firing or its job's result calls.
- `cx.new_id()` draws a version 4 UUID, and `cx.random_bytes()` draws random bytes, such as the network's endpoint key ([the endpoint key](../network/02-units.md#the-endpoint-key)), each from the kernel's one ChaCha20 generator.
  The generator takes the core's seed, 256 random bits the edge draws from the operating system and puts in the core's first input, as its key (user, 2026-10-23).
  `uuid`'s `Builder::from_random_bytes` sets the version and variant on bytes it's given (read in uuid 1.28.0, `src/builder.rs`), so the message crate keeps `v4` off.
  A replay draws the same IDs, and nobody without the recording can predict them.
- The generator is chacha20 0.10.2's `ChaCha20Rng`, with only the crate's `rng` feature.
  chacha20 depends on cfg-if, cpufeatures, and rand_core 0.10.1, which depends on nothing (read in each crate's `Cargo.toml`), so nothing in the kernel can reach `getrandom` and draw randomness from the operating system, which a replay couldn't draw again.
  rand_chacha 0.10.0 gives the same generator, but rand 0.10 itself builds its default generator on chacha20 (read in rand 0.10.3's `Cargo.toml`), so chacha20 is the one the rand project relies on.

## Replay

### What a recording holds

The writer records every input from the core's first, in every run of the core, with or without a session, because a replay has to start where the run did: the seed, the handles, sim awareness, and the clients all build up from the first input.
A replay checks every unit's outputs ([what it runs](../recording/01-recording-and-bug-reports.md#what-it-runs); user, 2026-10-21; [recording log][every]).
What a run's recording is kept for, and for how long, is [6.6](../architecture/plan.md#66-recording-and-bug-reports)'s, which keeps or deletes a recording whole.
Each run's recording sits in a folder of its own in the data folder's `recordings\`, with the run's log file ([the files](../recording/01-recording-and-bug-reports.md#the-files)).

A recording starts with a header, then holds two kinds of record, in the order they happened, all in one zstd frame for the run, which the writer flushes each second (user, 2026-10-23; [recording log][flush]):

- **Inputs,** each before the loop handles it, with each of its numbers written as a varint ([the inputs](../recording/01-recording-and-bug-reports.md#the-inputs)).
- **Checkpoints:** when an input's stamp starts a new second since the core's first input, the edge records the running hash of every unit's outputs and the input's sequence number, 8 bytes each, before the loop handles it, about 58 KB an hour before framing (arithmetic).
  A recording can instead hold a checkpoint before every input, which its header says, for the bench.
  The edge also records one after the input that put out the core's exit, as if before an input that never came, so a replay checks a run's last second too.

The sandbox's time limit counts QuickJS-ng's interrupt checks, so a replay stops a script call at the same check with nothing recorded, and the loop reads no clock (user, 2026-10-23; [decision 047](../../decisions/047-sandbox-time-limit-counts-interrupt-checks.md)).

The header names the build: its commit, a hash of its diff when it's uncommitted, its profile, the versions of `rustc`, of the MSVC compiler `cc` builds QuickJS-ng with, and of the Windows SDK, whose C runtime the core links ([the core's math](#the-cores-math)), and the SimConnect SDK the build printed ([building every target](../architecture/02-code-map.md#building-every-target)).
It doesn't name the program's bytes, since a build of one commit on two PCs needn't match byte for byte (unverified for ours).
It also names the PC's CPU, and whether it has FMA3, so a replay that diverges on another CPU says so.
How the records are encoded is the recording-format engine's.

### Running a replay

1. For a pilot's recording, run `node tools/replay.ts <file>`, which fetches from GitHub the `dualinput-core.exe` that the recording's release shipped, and replays on it, since the core's math follows the C runtime of the Windows SDK the core was built with, which CI's image doesn't pin ([the core's math](#the-cores-math)).
   A build of the header's commit also replays it, through `dualinput-core replay <file>`, for added logging, and warns when its rustc, MSVC, Windows SDK, or MSFS SDK version differs from the header's (user, 2026-10-18), the last since the MSFS SDK's headers lay out the sim's messages the core reads.
   One with uncommitted changes warns and runs ([a replay on the same commit with local changes](../recording/01-recording-and-bug-reports.md#a-replay-on-the-same-commit-with-local-changes)).
   A program of another commit refuses, naming the commit to check out, and one on a PC whose CPU differs from the header's says so before it runs.
2. The replay starts none of the edge's threads, so it binds no server and writes no port file, and takes a folder beside the recording as its data folder, for its named mutex and its log file, so it can run while Dual Input does; it takes the seed, the settings, and the session file from the recorded first input.
3. Its queue fills from the file as fast as the loop takes inputs, each output's sink drops it, and no timer or job runs, since their results come from the file.
4. At each checkpoint the replay compares its hash with the recorded one; at the first that differs, it names that checkpoint and the inputs since the one before it.

### The core's math

Rust's `f64` math and QuickJS-ng's `Math` both call the C runtime's functions, and two things changed the bits they returned, alike in both ([core log][p01]):

- the FMA3 switch, which the runtime turns on at startup on a CPU that has FMA3
- the runtime's version: with FMA3 off, Windows' `ucrtbase.dll` and the Windows SDK's static library still gave different bits

Windows always loads its own `ucrtbase.dll`, whose version follows each pilot's Windows, even when a program ships its own copy beside it (documented, [Universal CRT deployment](https://learn.microsoft.com/en-us/cpp/windows/universal-crt-deployment)).
So the core links the C runtime statically, which puts the math in our program, and `main` calls `_set_FMA3_enable(0)` before it starts any thread, in a live run and a replay.
It links the runtime through one entry in the workspace's `.cargo/config.toml`, which every x86_64 program of ours shares, and a `compile_error!` in `src/apps/core` stops a build whose `RUSTFLAGS` replaced the entry ([the C runtime](../build/01-the-build.md#the-c-runtime)).
That two CPUs give the same bits from one build with FMA3 off is unverified, and replaying a recording made on a friend's PC on ours settles it, which then answers 02-code-map's item in [left open](../architecture/02-code-map.md#left-open) on a PC with another CPU.

`_set_FMA3_enable` is in neither windows-sys 0.61.2 nor libc 0.2.190 (read in each crate's source), so `src/apps/core` declares that one foreign function itself, the third crate the code map's [tiers](../architecture/02-code-map.md#tiers) let declare one, for that function alone; the timer thread takes its functions from windows-sys.

## A panic

A release build sets `panic = "abort"`, so a panic on any thread ends the core (documented, [Cargo's profiles](https://doc.rust-lang.org/cargo/reference/profiles.html#panic)), and the process exits with a code other than 0 (unverified; a bench case checks it).
The panic hook in `src/apps/core` runs first, as std runs it "with both the aborting and unwinding runtimes" (documented, [`std::panic::set_hook`](https://doc.rust-lang.org/std/panic/fn.set_hook.html)): it logs the panic, the input's sequence number, and the unit that was running, and has the writer end the run's zstd frame, waiting at most 500ms.
The writer already holds the input being handled, since it records every input before the loop handles it ([what a recording holds](#what-a-recording-holds)).
The crash then takes [decision 041](../../decisions/041-core-crash-comes-back-as-late-joiner.md)'s path: the desktop app starts the core again ([the sim and the core](../install/01-installing-and-updating.md#the-sim-and-the-core)), and the pilot comes back as a late joiner, while a replay of the recording reproduces a panic in any unit at the same input ([a panic](../recording/01-recording-and-bug-reports.md#a-panic); user, 2026-10-21; [recording log][every]).

Catching a feature's panic and turning that feature off for the session would be a mechanism for recovering from our own bugs, and would leave a session half working: a following machine whose flight-model feature was off would fly on its own, where a restart and a late join bring every feature back (user, 2026-10-15).

## Starting and stopping

The desktop app runs from login as a tray icon, starts the core with the sim, and starts it again after an exit other than 0 ([the sim and the core](../install/01-installing-and-updating.md#the-sim-and-the-core)).
The core's edge doesn't start the desktop app's program, since the EFB app has no button that asks for it ([bringing the desktop app forward](../interface/01-apps.md#bringing-the-desktop-app-forward)).

The core starts in this order:

1. `main` turns FMA3 off, takes a named mutex for its data folder, and exits if another core holds it, so two cores started at once for one data folder can't both run; the port file still tells the apps outside the sim where the core is ([finding the core](../architecture/01-spine.md#finding-the-core)).
2. It draws the core's 256-bit seed, and registers the units ([the registry and moments](../architecture/02-code-map.md#the-registry-and-moments)).
3. It starts the writer, which writes the header, and pushes the core's first input: the seed, and the bytes of the settings file and of the session file, if there is one.
4. It starts the timer thread, tokio's runtime, and the sim thread, and wires each source and each sink.
   The WebSocket server's port, once bound, comes in as an input, and the edge writes the port file.
5. It starts the loop.

### Exiting

The session crate decides when the core exits, by the spine's rule in [what moves them](../architecture/01-spine.md#what-moves-them), as [6.7](../architecture/plan.md#67-the-session) designs it, and after a quit, [below](#quitting).
It puts out an exit, and then:

1. The loop takes no more inputs.
2. The edges carry out the outputs already put out, within 750ms in all, as FS Copilot's goodbye on the way out had (FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, `ShutdownGrace`).
   FS Copilot's quit queued its goodbye, and "the process exits before LiteNetLib's update thread sends it" (FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-12 — A deliberate quit reaches the peer as an outage").
3. The writer ends the run's zstd frame, the edge deletes the port file, and the process exits with 0, which tells the desktop app it meant to.

### Quitting

A quit comes from the pilot, through the session crate's Quit, which any client may send ([quit](../interface/01-apps.md#quit)), the desktop app's tray among them ([one program from login](../install/01-installing-and-updating.md#one-program-from-login)).
The session crate runs a quit as a Leave, so the crew sees the pilot leave rather than lose the link ([leaving](../network/01-between-machines.md#leaving)), and then exits.

Windows ending the pilot's session ends the core with no quit, since the core keeps no window to hear it, and the crew sees a lost link (user, 2026-10-23; [architecture log][review]).

## Logging

- The loop's crates log through `tracing`'s macros, and `src/apps/core`'s subscriber writes each line to the run's log file, beside its recording in `recordings\` ([what a recording holds](#what-a-recording-holds)), stamped with the stamp and sequence number of the input being handled, which the kernel exposes.
- The level is a setting, and a replay may raise it, since a log line is neither an output nor in the hash, and changes nothing a handler reads.
- Each unit logs at info each decision a pilot can notice, with its reason, such as control passing, a value applied or refused, a link lost, and catch-up's steps.
  When a pilot reports a problem, we ask for the run's `log.txt` first, and for the recording only when the log isn't enough, and the pilot sends either by hand (user, 2026-10-21; [recording log][every]).
- A live run's log file stops at 16 MB: the subscriber writes one line saying so, then drops every later line but the panic hook's, which a crash needs most.
  The core deletes old runs only when it starts ([what each PC keeps](../recording/01-recording-and-bug-reports.md#what-each-pc-keeps)), so without a cap one storm of lines could fill the disk within a session.
  At 16 MB, one 150-byte warning every sim frame at 60 fps takes about 30 minutes to fill it, and 1 GB still holds about 60 runs (arithmetic).
  Keeping the newest lines instead would lose the run's start, with its build and settings, and a storm's first lines, which show what set it off; the recording holds the rest.
  A replay's log has no cap, since a replay is where we raise the level.
- Once a minute the edge logs the loop's stats for that minute, and as the core exits for the whole run as well: how many inputs it handled, the share of the time it was busy from taking an input to asking for the next, how long they waited in the queue at p50, p99, p99.9, and at most, how many took longer than a handler's 1ms ([budgets](../architecture/02-code-map.md#budgets)), and the input that took longest to handle, with its time and sequence number (user, 2026-10-20).
  So the log a pilot sends shows whether the loop kept up, and the bench reads the loop's budgets there ([the loop under load](../build/02-testing.md#the-loop-under-load)).

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
| Exiting | Done within 1s of the exit going out |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test:

- Two edges push at once for minutes, and every stamp rises with its sequence number.
- A feature's command handler reads the clients crate's settings while the clients crate dispatches it.
- A pilot quits Dual Input in a session, and the other core sees a leave, not an outage.
- The core is killed, and its recording reads up to its last flush.
- A unit's handler panics: the process exits with a code other than 0, the desktop app starts it again, the pilot comes back as a late joiner, and the replay panics at the same input.
- The core exits on its own, with 0, and the desktop app doesn't start it again.
- A test unit raises moments in a cycle, and the kernel panics after 1,000.
- A replay on another commit refuses, naming the commit.
- A test unit that reads the clock in one handler is caught at the next checkpoint of its replay.
- The timers fire within their budget with the sim running and the PC busy.

## Left open

- Whether two CPUs give the same bits from one build with FMA3 off, which replaying a friend's recording on ours settles.

[p01]: log.md#2026-10-15-a-high-resolution-waitable-timer-wakes-within-15ms-where-tokios-wake-up-to-17ms-late-and-the-cores-math-changes-with-the-c-runtimes-fma3-switch-and-with-its-version
[every]: ../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour
[flush]: ../recording/log.md#2026-10-23-one-zstd-frame-flushed-each-second-keeps-a-busy-flights-recording-at-426-mb-an-hour-where-a-frame-ended-each-second-takes-667-mb
[review]: ../architecture/log.md#2026-10-23-a-review-against-the-simplicity-rule-cut-eight-guards-and-kept-every-designed-feature-it-questioned
