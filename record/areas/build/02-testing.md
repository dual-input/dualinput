# Testing

```text
Purpose:     How Dual Input is tested, from a crate's own tests to friends on two PCs, and which tests keep CI green.
Depends on:  01-the-build.md, ../architecture/02-code-map.md, ../architecture/01-spine.md, ../core/03-sim-seam-and-wasm-module.md, ../core/04-core-helper.md, ../network/01-between-machines.md, ../network/02-units.md, ../profiles/02-units.md, ../recording/01-recording-and-bug-reports.md, ../plugins/01-plugins.md, ../install/01-installing-and-updating.md
Decides:     The four levels of testing, and where and when each runs; which tests a merge and a release need green, and which run outside CI; what the bench runs, touches, and checks, and how it runs only what it built; the stand-in sim's place, rules, model, frames, WASM module, pages, and process; the stand-in core helper; the replay check; the loop under load; and that no second MSFS runs in a virtual machine (node 7).
```

> **Note**
> In [what it models](#what-it-models), the stand-in's aircraft holds an angle in degrees, and a read or a write of our module's in radians converts; an axis event sets its surface's variable to the event's value negated, and a brake's to the value plus 16,384; a pause holds the aircraft still; and a scenario can ask for a routine's next report 193ms late, and for the aircraft's variables after every frame, stamped with the PC's time, which is how the `flight-model` scenario lays one core's aircraft over another's ([flight-model log](../flight-model/log.md#2026-11-11-on-the-bench-a-following-aircraft-keeps-to-the-flying-ones-path-400ms-behind-and-samples-that-arrive-together-after-a-gap-made-follow-jump)).

> **Note**
> In [what it models](#what-it-models), the stand-in's camera keeps its place in the world from where its aircraft stood as our module's frame began, after the stand-in moved it by its velocities, as the sim's does, so a routine's read of it during its frame lands at the eye, and a read after `Follow`'s writes would land one frame of the aircraft's travel behind the eye, as in the sim ([avatars log](../avatars/log.md#2026-11-17-inside-our-module-before-the-routines-write-a-following-machines-camera-reads-at-the-eye-in-every-referential)).

> **Note**
> In [the loop under load](#the-loop-under-load), the test unit runs a real sync engine of 100 write functions, fed a frame before each flight-model input and its writes back as readings, in place of the 98.7µs hold; a handler's 1ms holds on a quiet PC alone, with the input that loads the engine counted as a load beside the stops, and beside the sim the queue's wait judges the loop while the inputs over 1ms are recorded with no budget, since the sim's share of the CPU put about 640 over it ([core log](../core/log.md#2026-11-10-beside-the-a350-the-loops-queue-keeps-its-budget-and-the-sims-share-of-the-cpu-puts-about-640-inputs-over-a-handlers-1ms); user, 2026-11-10).

Dual Input is tested at four levels: each crate's and each TypeScript part's own tests; the bench, two or three real cores on one PC, each on a stand-in sim; our own MSFS; and friends on two PCs.
CI runs the first two on every pull request that changes code and on every push to `main`, so a merge needs both green, and the release workflow takes only a commit whose run on `main` passed.
[The four levels](#the-four-levels) gives when the sim and friends come in.
The bench reaches a core only where a pilot's surroundings do: the stand-in sim below the sim seam, fake pages over the real WebSocket, a stand-in core helper over the real pipe, local stand-ins for the network and the profiles' site, and the processes and files on the PC.
The stand-in sim takes the sim edge's place in a bench build of the core, and runs our WASM module's routines natively.

This answers node 7 of the [architecture plan](../architecture/plan.md#7-testing), narrowed to the setup every stage's tests run on.
Each system's cases for the bench, and the measurement of each of its budgets, become tests in the stage of [node 8](../architecture/plan.md#8-the-build-order) that builds the system ([left to each stage](#left-to-each-stage); user, 2026-10-18).
Two rules from our earlier benches hold throughout, as node 7 gives them: no development mode skips the real path, and a bench drives the product only from outside it, never through its internals, and only through builds it made itself.

## The four levels

| Level | What runs | Where | When |
| --- | --- | --- | --- |
| Unit tests | Each crate's tests, the engines alone, the routines built natively, and each TypeScript part's tests; seam inputs recorded from the real sim, such as p08's signals, played into the sim client and sim awareness ([cases for the bench](../core/03-sim-seam-and-wasm-module.md#cases-for-the-bench)) | CI, and a developer's PC | Every pull request that changes code, and while developing |
| The bench | Two or three bench builds of the core, each on a stand-in sim, with fake pages, a stand-in core helper, and local stand-ins for the relays, the backend, and the profiles' site | CI's Windows runner, and a developer's PC | Every pull request that changes code, and while developing |
| In the sim | A build of the core from the tree, its package installed with `node tools/build.ts install` ([our package](01-the-build.md#our-package)), on our MSFS, with a bench core on a stand-in as the second pilot where a case needs a crew | Our development machine | At the end of each stage whose system has cases in the sim |
| With friends | Each pilot's installed Dual Input | Two PCs on two home networks | At a stage whose cases need two PCs, and before v1 ships |

The tests of `page-client` and of the panel bridge run on Node's test runner, as the tools' and the bench's do ([build plan](plan.md#5-clients-and-the-panel-bridge)).

## What keeps CI green

- A pull request that changes code runs the bench beside the checks the code map's [CI](../architecture/02-code-map.md#ci) lists, the unit tests among them, and a merge needs every one green.
- The bench runs as one job for each scenario file on GitHub's standard runners, which a public repository gets free, so each check a pull request shows is one scenario, named by its title, and a failed one reruns alone (user, 2026-11-20 and 2026-11-21).
  GitHub documents 20 jobs at once on the Free plan ([Actions limits](https://docs.github.com/en/actions/reference/limits)), but ran 6 to 15 of our jobs at once (measured on 2026-11-21, [build log](log.md#2026-11-21-with-warm-caches-a-pull-requests-ci-took-19-minutes-12-seconds-inside-its-20-and-the-bench-passed-in-8-jobs-on-githubs-runners)).
  One job builds the bench's programs once, with `node tools/bench.ts build`, and each scenario's job downloads them and runs its file with `node tools/bench.ts --programs <folder> <scenario>`, which lists each failed test and its error in the job's summary, and writes none when every test passes, since GitHub's own view of the run shows each job's result and time (user, 2026-11-25).
  `tools/bench/order.ts` holds each scenario's title and its time on our development machine, where the whole bench took 52 minutes on 2026-11-20, and the jobs start longest first, since the run lasts until its longest scenario, `network-outages`, ends.
- A new push cancels the run still going for the same pull request or branch.
- The same workflow runs on every push to `main`, merges included, and blocks nothing.
  A push to `main` runs every job, whatever it changed, so each commit there has a run of its own.
- A release runs only once CI passes on its release commit on `main`, and runs neither the checks nor the bench again ([a release](01-the-build.md#a-release); user, 2026-11-20).
- CI's bench checks behavior, and no timing budget fails it: CI's bench jobs set `DUALINPUT_BENCH_BUDGETS` to `report`, so `tools/bench/budgets.ts` prints a missed budget and the scenario passes.
  A shared runner's other load moves a timing from run to run: a profile's build took 2,711ms in one run and 2,905ms in the next, against 2,000ms, and a handler over 1ms came in different scenarios in each (measured on 2026-11-21, [build log](log.md#2026-11-21-cis-first-run-on-githubs-runners-took-47-minutes-with-every-cache-cold-ran-6-jobs-at-once-and-failed-on-the-benchs-own-timing-budgets-and-races)).

## What runs outside CI

| What | Where | When |
| --- | --- | --- |
| Each system's timing budgets, and [the loop under load](#the-loop-under-load) | The bench and the sim, on our development machine | At the stage's end |
| Cases that need a third-party aircraft's files, such as avatars' cases on the 58P's models, since CI can't hold those files | The bench, on our development machine | At the stage's end |
| The system's [cases in the sim](#in-the-sim) | One session in the sim | At the stage's end |
| Installing and updating's [cases on a desk](../install/01-installing-and-updating.md#cases-on-a-desk) | A PC set up for each | At the install stage |
| v1's full mix on a direct path under loss | Our droplets, by hand ([cases for the bench](../network/02-units.md#cases-for-the-bench)) | At the network's stage, and whenever the pinned iroh or noq changes |
| A [session with friends](#with-friends) | Two PCs | At a stage whose cases need two PCs, and before v1 ships |

## The bench

### What it runs

- Two or three bench builds of the core, three where a case names a third, each with a data folder of its own, so its port file, session file, settings, and recordings are its own, as a development core's are ([finding the core](../architecture/01-spine.md#finding-the-core)).
- The desktop app, for its own cases and for those where it starts a core again.
  The app starts `dualinput-core.exe` from its own folder ([the sim and the core](../install/01-installing-and-updating.md#the-sim-and-the-core)), so the bench lays out a folder holding the desktop app and a bench build of the core named `dualinput-core.exe`, set to that core's data folder.
  The core the app starts again is then a bench core.

The desktop app walks the processes for `FlightSimulator2024.exe` (same section), so its cases run with no sim and no other scenario on the PC.
Those that run Setup.exe, Update.exe, or an uninstall run only on CI's runner, since Velopack installs into the per-user folder a developer's own Dual Input uses.

### What it touches

The bench reaches each core only where a pilot's surroundings reach it, so every scenario runs the code a pilot's core runs:

- the stand-in sim, below the sim seam ([the stand-in sim](#the-stand-in-sim))
- fake pages, which connect over the core's real WebSocket and speak the client protocol from the messages' TypeScript types ([the sim's pages](#the-sims-pages))
- the stand-in core helper, over the core helper's real pipe ([the stand-in core helper](#the-stand-in-core-helper))
- the network, as [the network's units](../network/02-units.md#cases-for-the-bench) set it up: each core's IP transports cleared, a local backend on a local D1, and two local `iroh-relay`s ([network log][p05])
  Each relay sits behind a TCP proxy that can hold back or cut one core's connection without touching the others.
  The network's cases on two relays and on a moved home relay need both relays, and a case can route one pair of cores through each and delay one pair alone.
- the profiles, from a local site that serves `index.json` and `bundles/<hash>.yaml` as the Pages site does ([where the core fetches from](../profiles/02-units.md#where-the-core-fetches-from)), from bundles the profile builder built from the tree, which a scenario can hold back, cut, or add a bundle to
- the packages folders, from a folder the bench lays out with a `UserCfg.opt` and the packages a scenario names, so no run reads or writes the sim's own ([the packages folders](../install/01-installing-and-updating.md#the-packages-folders))
- processes, which it starts, kills, and suspends, since a killed process closes its sockets and a suspended one holds them open and stops answering (FS Copilot fork, `record/pointer-forwarding/docs/14-test-bench.md`, "Outages are made by suspending a process")
- each core's data folder, where it writes a session file or settings before a start and reads the recordings after

The cores and the desktop app reach the local backend, relays, profiles' site, and packages folder through development settings, so the code that reaches them is the release's.

### What it checks

A scenario asserts on what a pilot's surroundings see:

- what the fake pages are told: slices, notifications, verdicts, and orders
- what the stand-in's aircraft holds, and every call each core made of the stand-in
- each core's recording, and its replay ([replays](#replays))
- each process's exit code, and its log

So a scenario checks what a pilot's EFB app or panel would have been told, with no second channel for test state, as FS Copilot's fake panel did (FS Copilot fork, `record/pointer-forwarding/docs/14-test-bench.md`, "The panel is faked, not driven").

### Building what it runs

Each bench run builds the programs it runs from the tree under test, and starts each by the path that build wrote, so it never runs a program from another commit.
FS Copilot's exerciser harness ran whatever its checkout had compiled last, and "a stale build is a working build, and it cost two sessions" (FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-19 — The exerciser leaves the tree, and takes four compile-time couplings with it").
On a developer's PC the build is incremental, so a run with nothing changed builds nothing.
The bench builds into `target/bench`, a target folder of its own, because a build with the `stand-in` feature in `target/` would replace the `dualinput-core.exe` a plain `cargo build` writes there, and a developer's next build would replace the bench's (user, 2026-10-20).

The scenarios' programs build with the root's profile `release-with-checks`: the release profile's optimizations, so a scenario's timing checks measure about what a pilot's core takes, with a development build's overflow checks and debug assertions still on (user, 2026-10-23).
An unoptimized build ran the clients crate's round, every 50ms, at 300µs to 650µs, close enough to the code map's [1ms for a handler](../architecture/02-code-map.md#budgets) that a pause of the loop's thread put a different input past it in each run, while in the same scenarios this profile's slowest input took 477µs ([session log](../session/log.md#2026-10-23-an-unoptimized-bench-build-sat-close-enough-to-a-handlers-1ms-for-a-pause-of-the-pcs-to-cross-it-so-the-bench-builds-optimized)).
Where the release profile aborts at a panic, this one unwinds, as a development build does, since the stand-in sim catches a routine's panic the way the sim traps our module, and it leaves out `lto` and builds incrementally, so a run after a small change rebuilds in seconds: 6s after a change to one file of the session crate, on our development machine.

A scenario that checks the 1ms for a handler allows each core one input over it, if under 2ms, because a pause of the loop's thread still puts an input past it now and then, and the loop's stats time an input by the wall clock, which can't tell a pause from work (user, 2026-10-23).
We infer the pauses, unverified, from a step of about 20µs that once took 592µs, and in a whole bench on this profile, of the 15,558 inputs of the 8 cores that logged their run's stats as they exited, 1 went over, at 1,049µs, in an input that wrote no log line, on a core busy 0.19% of its run ([session log](../session/log.md#2026-10-23-an-unoptimized-bench-build-sat-close-enough-to-a-handlers-1ms-for-a-pause-of-the-pcs-to-cross-it-so-the-bench-builds-optimized)).
A handler that takes over 1ms each time it runs still fails, and one that runs once in a scenario and takes 1ms to 2ms passes, which is the gap this leaves.

### Where it lives

`tools/bench/` holds the bench, as the code map's [workspace](../architecture/02-code-map.md#the-workspace) has it: its scenarios, fake pages, and local profiles' site in TypeScript on Node, as `tools/build.ts` and the other scripts there are, and the stand-in core helper, a Rust program on the message crate.
The stand-in sim is an engine, `src/engines/stand-in-sim`, and the bench build of the core links it.

`node tools/bench.ts` runs the bench (user, 2026-10-20):

- Each scenario is a file in `tools/bench/scenarios/`, run on Node's test runner, as the tools' own tests are.
- Each scenario's run has a folder of its own in `target/bench/runs/`, with a data folder for each core.
- `tools/check.ts` leaves the bench out, since the bench takes minutes, so a stage's code passes both.
- The [loop under load](#the-loop-under-load) runs only when asked for, with `node tools/bench.ts load`, since it measures timing and takes an hour, and on the release profile, as a pilot's core runs.

## The stand-in sim

### Its place

The bench build of the core is `src/apps/core` built with its Cargo feature `stand-in`, which links `stand-in-sim` and the routines, built natively, and puts the stand-in where the edge goes.
The feature also registers the test units the cases name, such as one that panics, one that raises moments in a cycle, and one that reads the clock, and the bench build's list of routines adds a test routine built to panic ([the code map's cases](../architecture/02-code-map.md#cases-for-the-bench-for-work-in-the-sim), [01-loop-and-edge's](../core/01-loop-and-edge.md#cases-for-the-bench)).
Apart from those, everything above the sim seam is a release's code, `tools/build.ts release` builds without the feature, and the edge's own code runs only in the sim.
The bench build listens on a local socket the bench drives the stand-in and the test units through, and a release build has no such socket.

- The socket is TCP on 127.0.0.1, at a port Windows picks, which the core writes to `bench-port` in its data folder, so the bench finds a core whichever program started it (user, 2026-10-20).
- Each message is one line of JSON, whose types are the message crate's `bench` module, as [decision 025](../../decisions/025-messages-in-one-rust-crate.md) has every message between our programs, and the core's first line carries its version and hash, as [decision 026](../../decisions/026-first-message-carries-version-and-hash.md) asks.
- A line for a test unit becomes an input under that unit's source, which the recording keeps, so the replay runs it.
- A line for the stand-in goes to the stand-in's thread, as the bench acting on the sim, and is no input of the core's.
- The core sends the bench lines of its own after its first: what the sim's test unit, which stands in for a feature that calls the sim, heard from the sim and from sim awareness, each as a line of text, and the stand-in's report when the bench asks for one, of every connection opened, every call made of it, and its aircraft's variables.

### Its rules

The stand-in runs where the edge runs: off the loop, on a thread of its own, with a clock of its own.
It hands up stamped inputs, and the recording keeps them as it keeps the edge's, so a bench run's recording replays on the core's replay with no stand-in, as a release's recording replays with no sim ([a replay](../recording/01-recording-and-bug-reports.md#a-replay)).
So it keeps the edge's rules rather than the loop's, and [tiers](../architecture/02-code-map.md#tiers) exempts it as it exempts the sim edge.

### What it models

- Every kind of call v1's units make, each answered with SimConnect's own messages and exceptions, the exceptions already tagged with their call, as the code map gives the stand-in ([the sim seam](../architecture/02-code-map.md#the-sim-seam)).
- An aircraft is a table of named variables, each in its sim units, seeded from a recording of that aircraft in the real sim, so its values and units are ones the sim gave.
- The aircraft moves each frame by its velocities, and a freeze holds its pose but not its velocities, as the sim's freeze did (measured on MSFS 2024, 2026-10-03, [flight-model log](../flight-model/log.md#2026-10-03-freezing-holds-the-pose-but-not-the-velocities-so-a-follower-has-to-write-them-all)), so a leading aircraft's samples move and an unfrozen follower flies on.
- A scenario scripts the aircraft's own behavior as rules, such as "when this variable is written, set that one 2s later", which the systems' cases need: a lamp lit 2s late, switches restored 5s after Ready to fly, an entry changed every 3s on both machines ([the sync units' cases](../sync/05-units.md#cases-for-the-bench)).
- Faults come on demand: a variable rejected after its call returned, `AircraftLoaded` three times around one load, several `Frame` events in one read, a lost connection, an exception for a call, a create with a title the sim lacks, and the sim's quit message ([the code map's cases](../architecture/02-code-map.md#cases-for-the-bench)); a sim crashes when the bench kills its stub ([the sim's process](#the-sims-process)).
- A load's signals can play from a recording of the real sim's, as p08's recorded signals feed sim awareness's tests, so a bench load follows a sequence the sim gave.

### Its frames

`Frame` events come from the stand-in's own timer, 89 a second unless a scenario sets another rate, which is our module's update rate with the PA-24 parked (measured on MSFS 2024, 2026-10-09, [architecture log][flight]); the `Frame` event's own rate is unmeasured ([the sync units' budgets](../sync/05-units.md#budgets)), and p10's flight at EGLL in the 58P ran at 22.5 to 29.8 fps ([architecture log][p10]).
The systems' cases set 4, 30, and 89 a second ([the sync units' cases](../sync/05-units.md#cases-for-the-bench), [flight-model sync's](../flight-model/01-flight-model-sync.md#cases-for-the-bench)), and a scenario can stop frames for a load or a pause, and bunch several into one read.

### Our WASM module

- The routine host and the routines run natively in the stand-in's frame: each frame, the stand-in hands the routine host its slots' newest writes and the frame, and carries out its wants on the aircraft's table, as [what a routine can ask for](../architecture/02-code-map.md#what-a-routine-can-ask-for) lists them: reads, writes, the freeze, events, `H:` events, and reports into the report slots.
- The module's list of routines lives in a library crate of its own, `src/sim-package/routines/`, which the module and the bench build both link, the one dependency on `src/sim-package/` the code map's note allows.
  The bench can't link the module itself, because the module builds only as a cdylib.
- The stand-in takes the module through a trait, which the bench build fills with the routine host and that list, so the stand-in, an engine, depends on no platform or feature code, as node 5 requires of it ([the architecture plan](../architecture/plan.md#7-testing)).
- A routine's panic stops the stand-in's module as the sim stops a module that went `DIRTY`: the stand-in catches the panic and runs the module no more, and its thread belongs to no run of the core's, so the core's panic hook leaves the core running.
  The bench build's test routine, `PROBE`, panics on one of its modes, and on the others shows whether it carried anything from one feeding into the next.

### The sim's pages

The stand-in hands each `SimConnect_CallCommBusEvent` the core makes for JavaScript to the bench's fake pages, so a fake page hears the core's announcement and opens its WebSocket as a real page does ([finding the core](../architecture/01-spine.md#finding-the-core)).
The bench fakes the EFB app, the banner, the menu script, and each cockpit panel's bridge from the socket outward, so a bench pilot reaches Ready to fly, uses Go to, and presses a display, and the core can't tell a fake page from a real one.
This settles the code map's [left open](../architecture/02-code-map.md#left-open) item on how a core on a stand-in reaches the sim's pages.

### The sim's process

A stub program, which the bench starts and kills, stands for the sim's process.
The stand-in reports it found, with its ID and creation time, and exited, with its exit code, as the edge reports the sim's ([the sim's process](../core/03-sim-seam-and-wasm-module.md#the-sims-process)), and killing it is how a bench sim crashes.
Each stand-in watches the stub the bench started for it, by its process ID, so a stub's name matters only to the desktop app.
The stub is named `FlightSimulator2024.exe` in the desktop app's cases alone, and has another name in every other case, so neither the real edge nor the desktop app takes it for the sim.

## The stand-in core helper

- A development setting names the program the core starts as its core helper, and the bench names its own, which speaks the real pipe's messages ([the pipe](../core/04-core-helper.md#the-pipe)) and takes a script from the bench: presses, the mouse, captured audio frames, and what to report it played.
- The bench scripts it over a line of its own ([build plan](plan.md#6-the-core-helper)): the bench starts each core with `DUALINPUT_BENCH_HELPER` naming a local port, the stand-in inherits the variable from the core that starts it and connects there, and over that line the bench tells it what to send or do, and hears each message the core sent it.
  The core's pipe can't carry the script, since the core owns both its ends.
- The core still starts only the program its development setting names, sends it every want, reads its `Hello`, and starts it again when it exits, so the core's real path runs, and the rule that no development mode skips it holds.
  Only the Windows calls behind the pipe differ, and the core helper's own tests on a desk and its cases in the sim run those ([cases for the bench](../core/04-core-helper.md#cases-for-the-bench)).
- This settles the question [6.5](../architecture/plan.md#65-the-core-helper) raised for node 7 on that setting.

## Replays

- Every bench scenario ends by replaying each core's recording, and fails on any checkpoint that doesn't match, so a change that makes a replay drift fails its own pull request.
- A replay checks every unit, since the core records every input ([cases for the bench](../recording/01-recording-and-bug-reports.md#cases-for-the-bench); user, 2026-10-21; [recording log](../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour)).

## The loop under load

One bench case drives one core through a busy flight at full rate: sim inputs recorded in a flight, as p10's were, the network's starting budget of about 140 inputs a second from one link ([the network's budgets](../network/02-units.md#budgets)), and write functions held to their 100ms limit among them, since v1 runs no plugin ([the architecture plan](../architecture/plan.md#7-testing)).
It measures the queue against the code map's one sim frame at p99, 11.2ms ([budgets](../architecture/02-code-map.md#budgets)), and replays the run to the same outputs.
p10's loop ran a 600s capture of a flying machine that hosted traffic at EGLL, with made-up inputs at a session's rates beside it, and an input waited 92µs in the queue at p99, the loop was busy 0.5% of the time, and two replays matched the live run's outputs (measured on our development machine, 2026-10-16, [architecture log][p10]); the bench case repeats that load with the stand-in's inputs and v1's write functions.
It runs on our development machine, since it measures timing, at the kernel's stage and again once state sync's write functions run.
The second run goes beside MSFS on the same PC, flying the iniBuilds A350 at a busy airport with traffic, in focus, so the core shares the CPU with a heavy sim at the same priority, as a pilot's core does (user, 2026-10-25).
The bench case gives the core its work, and the A350 only loads the PC, so it needs no profile of its own; the 58P, v1's first profile, loads the sim too lightly to show the sharing.

At the kernel's stage, before the sim service, the sandbox, and the network exist, a test unit stands in for them, on the same load as p10's (user, 2026-10-20):

- It takes p10's capture, copied into `tools/bench/fixtures/`, at the pace it was captured, and p10's made-up inputs at a session's rates, with the link's raised to about 140 a second.
- On each flight-model input, it puts out 100 outputs and keeps the loop for 98.7µs, standing in for 100 write functions, which took that long on average in p10.
- Once a minute, it keeps the loop for 100ms, standing in for a write function stopped at its limit.
- Each of these waits reads the clock but leaves the outputs alone, so the replay still matches.
- The run plays the 600s capture six times over, for an hour, then replays the recording.
- The bench reads the queue's waits, the loop's busy share, and the slowest input from the loop's stats in the core's log ([logging](../core/01-loop-and-edge.md#logging)).

## The sandbox's cases

The sandbox's recursion and interrupt-check cases are its own unit tests, with no core and no sim ([cases for the bench](../plugins/01-plugins.md#cases-for-the-bench)).

## In the sim

- A stage whose system has cases in the sim ends with one session in the sim, which runs all of them, as [CLAUDE.md](../../../CLAUDE.md#working-rules) asks of everything that needs the sim.
  Each system's cases are a script in `tools/sim/`, such as `node tools/sim/sim-seam.ts`, which runs the release core from the tree on a data folder of its own and reports each case as the core's log shows it; the sim's inspector on 127.0.0.1:19999 runs a case's part in a panel with nobody pasting it, and `SimConnect_FlightLoad` switches aircraft, with someone nearby, since MSFS 2024 crashed on 5 of about 30 such loads (measured on MSFS 2024 1.8.16.0, 2026-10-01, [aircraft log](../aircraft/log.md#2026-10-01-loading-flights-through-simconnect-works-but-the-sim-crashed-on-5-of-about-30-loads-so-we-canceled-the-unattended-session)).
- Where a case needs a crew, a bench core on a stand-in plays the second pilot on the same PC, as FS Copilot's exerciser joined its app's session as a peer rather than through a development mode (FS Copilot fork, `record/exerciser/docs/01-design.md`, "Session: the exerciser is a peer").
  The real sim's core reaches the bench's local backend, relays, and profiles' site through the same development settings as the bench core, so both meet at the commit's own backend.
- Only a SimConnect client of the sim can call on its CommBus ([finding the core](../architecture/01-spine.md#finding-the-core)), so the real sim's pages hear only the real core's announcement and connect to it alone, which no run has tried ([cases for the bench](#cases-for-the-bench)).
  FS Copilot's bench and a running sim collided three ways, among them every cockpit panel connecting to the bench's instances when no real FS Copilot ran (FS Copilot fork, `record/pointer-forwarding/docs/14-test-bench.md`, "Do not run the simulator during a bench run").

### Before a release

No session in the sim runs before a release, since a release is merging its pull request, with no step by hand (user, 2026-11-21; [a release](01-the-build.md#a-release)).
What only the real sim shows, such as our package's pages loading and a session's switches moving in a real cockpit, is checked in the sessions of the stages whose systems have cases in the sim, and a release that breaks something there is followed by a fix's release.

## With friends

- A session's checklist gathers the cases with friends of every stage built by then, so one session checks many things, as node 7 asks (user, 2026-10-14).
- Each pilot sends their run's folder by hand ([a bug report](../recording/01-recording-and-bug-reports.md#a-bug-report); user, 2026-10-21), so the session needs no video call, and a following machine's recording measures its own [budget](../recording/01-recording-and-bug-reports.md#budgets).

## Budgets

Each is a starting value, which the first stage of [node 8](../architecture/plan.md#8-the-build-order) that runs the bench in CI measures:

| What | Budget |
| --- | --- |
| A pull request's bench, the job that builds its programs included | Within the code map's 20 minutes for a pull request's CI ([budgets for the workspace](../architecture/02-code-map.md#budgets-for-the-workspace)), as one job per scenario beside the others, after the one that builds |

## Cases for the bench

These test the setup itself, and the first stage that builds the bench runs them:

- A bench build and a release build of one commit carry one message crate's hash, and `cargo tree` of the release build lists no `stand-in-sim`.
- Two bench cores on one PC each see only their own stub, and killing one stub ends that core's sim alone, as a crash.
- A fake page that heard the stand-in's announcement connects.
- A bench core killed under the desktop app comes back as a bench core, with its own data folder.
- A scenario that holds back one pair's relay leaves the other pairs' messages on time.

In the sim:

- With a bench core running beside the real sim's core, every page of the real sim connects to the real sim's core, and none to the bench core.

## Left to each stage

Each stage of [node 8](../architecture/plan.md#8-the-build-order) that builds a system:

- turns its design doc's cases for the bench, in the sim, on a desk, and with friends into tests at the levels above, the ones for the bench and the unit tests running in CI from then on
- measures each of its budgets on our development machine, on the bench and in the sim, at its end, and says how
- takes a budget a measurement misses back to the design that set it, which changes the design or the budget, and the area's log says which
- adds to the stand-in each kind of call its units make, and to the fake pages each message they need

## Dropped

A second MSFS with its own Dual Input in a virtual machine on the same PC, which the spine's [parts](../architecture/01-spine.md#parts) drop for the bench: a bench core on a stand-in plays the second pilot, and friends bring two real sims (user, 2026-10-18).

## Left open

Nothing: a GitHub-hosted Windows runner holds the bench's three cores, two relays, and their proxies, and a pull request's bench finished within the 20 minutes ([build log](log.md#2026-11-21-with-warm-caches-a-pull-requests-ci-took-19-minutes-12-seconds-inside-its-20-and-the-bench-passed-in-8-jobs-on-githubs-runners)).

## What this changes elsewhere

This design changes [the code map](../architecture/02-code-map.md), [the spine](../architecture/01-spine.md), [the build](01-the-build.md), and [04-core-helper](../core/04-core-helper.md), and the [tentative decisions](../architecture/decisions.md#dual-input-is-tested-at-four-levels-and-ci-keeps-the-unit-tests-and-the-bench-green-on-every-pull-request) give the reasons.

[flight]: ../architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start
[p10]: ../architecture/log.md#2026-10-16-a-flying-machine-that-hosts-traffic-at-egll-takes-in-285-mb-of-inputs-an-hour-45-mb-with-zstd-mostly-traffic-and-one-loop-carries-them-at-05-of-a-core-and-replays-them-exactly
[p05]: ../network/log.md#2026-10-11-when-two-endpoints-home-at-different-relays-iroh-carries-both-directions-through-the-dialed-endpoints-home-relay-so-whoever-dials-picks-the-relay
