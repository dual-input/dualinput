# Build: plan

This plan builds Dual Input's v1, as [03-v1-scope](../product/03-v1-scope.md) has it, in numbered stages, each ending with an exit you can watch happen.
It's the one place v1's build status lives, for [step 9](../product/plan.md#9-build-test-and-release-v1) of the product plan, whose exit is its last stage's exit.
[Node 8](../architecture/plan.md#8-the-build-order) of the architecture plan designs the stages and their order.

## How a stage reads

Each stage is a `##` section of this plan, placed in the order the stages are built, and gives these lines:

- `Builds:` the units of [the code map](../architecture/02-code-map.md#the-units) it builds, or the parts of them it names, each linked to the section that designs it.
- `Designs first:` what the record left to this stage to design, when it left anything.
- `Needs:` the stages whose output it uses, so two stages that don't need each other can be built at the same time.
- `Tests:` the cases it turns into tests, linked to the sections of the design docs that list them, and each budget it measures.
- `Exit:` what you watch happen when the stage is done.

A stage is done when it has a `Done on` line under its `Exit:` line, and open until then.
The build stands at the first open stage whose `Needs:` line names only done stages, and any other open stage whose needs are done can be built beside it.

## How the stages are ordered

The stages follow these rules (user, 2026-10-18):

- A stage builds only on stages that are done, so the engines and the platform come before the features that use them ([tiers](../architecture/02-code-map.md#tiers)).
- Each stage builds one [system](../architecture/02-code-map.md#systems) whole and proves it on the bench, where the bench build's test units stand in for features not yet built ([its place](02-testing.md#its-place)).
  So where the record leaves an item to a system's stage, such as the network's stage, it names one stage.
- A system splits where one stage can't build it whole: along its design docs when it's too big for one exit, by tier when its features use platform that a later stage builds, as the session's rate and pause and Go to wait for the apps, and by part when an earlier stage needs one of its parts first, as the bench needs the sim seam's `sim-client`.
  An item the record leaves to a split system's stage goes to the stage that builds the part it's about.
- Each case becomes a test in the stage that builds the last thing it needs, so a case of the loop's in which the desktop app starts a crashed core again lands in the install stage.
- Where several stages could go next, the one whose design rests on more claims no run has tried goes first, so a wrong design shows before much is built on it.
- The first session in the sim, with a bench core as the second pilot, comes once the platform and state sync are built, and the first flight with friends once flight-model sync is built too.
  Friends fly their installed Dual Input ([the four levels](02-testing.md#the-four-levels)), so the install stage comes before that flight.
- No stage builds code that a later stage replaces: what a stage builds is final, and only the bench's stand-ins and test units stand in for what isn't built yet.
- Nothing on GitHub that a stage waits on comes before [stage 22](#22-github): no pull requests, no workflows, no releases, and no Pages site, since waiting on pull requests and CI slows the build down (user, 2026-10-18).
  A stage's commits go straight to `main` once the user has reviewed the stage.
  `main` requires a pull request for every change, and only its admins may push past that rule (user, 2026-11-20).
  Stage 22 builds CI as [testing](02-testing.md#what-keeps-ci-green) and [the build](01-the-build.md#ci) design it, and from then CI runs on each push to `main` and blocks none.
  The repositories of ours beside this one came with the stages that needed them: `dual-input/relay-tokens`, which holds the relays' tokens and stays private, in stage 7 (user, 2026-10-22), and in stage 11b two that Dual Input installs with npm, `dual-input/msfs-tailwind`, a Tailwind 3 preset for Coherent GT, and `dual-input/coherent-checks`, the Coherent GT check's, whose data msfs-tailwind's test reads (user, 2026-10-25).
  This repository went public on 2026-11-20, ahead of stage 22, and those two with it (user, 2026-11-20).

## Working a stage

1. Before writing anything for the stage, read each section its `Builds:` and `Tests:` lines link, with the notes at the top of each design doc they're in, since a doc's notes change the text below them ([step 8](../product/plan.md#8-v1-build-plan)).
   You'll know what the stage builds and what proves it.
2. If the stage has only its headline, write its lines in this plan, as [how a stage reads](#how-a-stage-reads) gives them, from what step 1 read.
   You'll see its `Builds:`, `Needs:`, `Tests:`, and `Exit:` lines.
3. If the stage has a `Designs first:` line, propose that design to the user, and once they agree, write it in the design doc it belongs to.
   The proposal can go out while the stage before is still running its bench or its review, so neither the runs nor the user's answer wait on the other (user, 2026-10-24).
   You'll see the design in its doc before any of the stage's code.
4. Write the stage's code, and turn its cases into tests, as [left to each stage](02-testing.md#left-to-each-stage) says, until `node tools/check.ts` passes, and from stage 3 the bench's scenarios that the stage added or changed, with `node tools/bench.ts <scenario>...`.
   The whole bench, `node tools/bench.ts`, runs in their place at the close of stages 10, 15, and 20, and at the close of any stage that changes what every scenario runs on: the kernel, the core's edge, the message crate's framing, or a pinned dependency such as iroh, since waiting on it at every stage slowed the build (user, 2026-10-23).
   An `Exit:` line's `node tools/bench.ts` means whichever of the two the stage runs.
   Once `node tools/check.ts` passes, run the `code-reviewer` agent on the stage's code while the bench runs, without asking, and fix or answer each finding, so the review doesn't wait for the bench (user, 2026-10-24).
   You'll see every check pass on our development machine, and each of the review's findings fixed or answered.
5. If the stage's system has cases in the sim, run them, and measure the stage's budgets in the sim, in one session in the sim ([in the sim](02-testing.md#in-the-sim)).
   A case moves to a later stage's session when that session sets up what the case needs anyway and no stage between them builds on what the case checks, so the sim is set up once rather than twice (user, 2026-10-24).
   You'll have each case's report and each measurement.
6. Measure the stage's budgets on the bench, on our development machine, and write each result, from the bench and from the sim, with how it was taken, in the log of the area it belongs to.
   A result that misses its budget goes back to the design that set it, as [left to each stage](02-testing.md#left-to-each-stage) says.
   You'll see a log entry for each budget.
7. Once the stage's exit has happened, make the stage's map with `/stage-map`: a private page that shows what each of the stage's parts does, why, and how its code works, which the user reads before the diff (user, 2026-10-20).
   Then show the user the map, and the stage's lines and its code together as one uncommitted diff, with the code review's findings and what was done about each (user, 2026-10-18).
   You'll have the map's link and the user's answer, and if they want changes, those changes made, and the map published again if they changed what it shows.
8. Once the user has looked, add `Done on <YYYY-MM-DD>.` under the stage's `Exit:` line, commit the stage, and push it.
   You'll see the stage's commit on `origin/main`, and the next open stage is where the build stands.

A stage built beside another, as [how a stage reads](#how-a-stage-reads) allows, runs in a session of its own in its own git worktree, so neither stage's uncommitted work lands in the other's commit (user, 2026-10-24).
At step 8 it rebases onto `origin/main` and pushes its commit to `main` as a fast-forward, with `git push origin HEAD:main`.
A run that measures a budget waits until no other stage's build or bench is running on our development machine, since either takes the CPU the budget is measured on.

## When building shows a design is wrong

1. Propose the change to the user before writing it.
2. Once they agree, write what the stage found in the log of the area the design belongs to.
3. Add a note at the top of the design doc that names the log entry, as [writing.md](../../../.claude/rules/writing.md#design-plan-and-log) has a design doc amended.
4. If the change reverses a numbered decision, write the decision that reverses it, as [writing.md](../../../.claude/rules/writing.md#decisions) says.

## 1 The workspace and its checks

Builds:

- the root's files: `Cargo.toml`, whose members are globs, `rust-toolchain.toml`, `package.json` and its lockfile, `.cargo/config.toml`, which links the C runtime statically and sets ts-rs's two variables, and `msfs-sdk.txt` ([the workspace](../architecture/02-code-map.md#the-workspace), [the C runtime](01-the-build.md#the-c-runtime))
- `tools/msfs-sdk` and `tools/setup.ts`, which install cargo-msfs and the SDK that `msfs-sdk.txt` names ([the SDK](01-the-build.md#the-sdk))
- `tools/build.ts`, which builds what the tree holds and stops when the installed SDK isn't the one `msfs-sdk.txt` names ([building every target](../architecture/02-code-map.md#building-every-target))
- the message crate, which each later stage adds its messages to, with its hash and `ts/stamp.ts`, its first TypeScript types coming with the first stage that adds a message ([the message crate's hash](01-the-build.md#the-message-crates-hash))
- [the map check](../architecture/02-code-map.md#the-map-check)
- `tools/check.ts`, which runs each check a pull request runs in [CI](../architecture/02-code-map.md#ci) that the tree has something for: Rustfmt, Clippy, the default members' tests, each tsconfig's type check, the messages' types generated again and compared, the map check, and the tools' own tests, on Node's test runner

Each later stage adds its own checks to `tools/check.ts`, such as the Coherent GT check in stage 5, so stage 22's workflows run what every push already ran.
The root `Cargo.toml` takes each tier's glob with the tier's first crate, since Cargo refuses a glob that matches no folder ([build log](log.md#2026-10-18-cargo-refuses-a-member-glob-that-matches-no-folder-or-a-folder-without-a-cargotoml-and-typescript-702s---explainfiles-lists-a-type-only-import)).

Needs: nothing.

Tests:

- The map check's own tests, in `tools/map-check.test.ts`: a tree that keeps every rule [tiers](../architecture/02-code-map.md#tiers) lists, and a tree for each rule broken, each failing by the rules it breaks and no others.
- The message crate's tests of its hash: a change to a message, or to a package it reaches, changes it, and an unrelated package doesn't.
- From [the build's cases on a desk](01-the-build.md#cases-for-the-bench): a change to the message crate committed without the stamp generated again fails `tools/check.ts`; a checkout with CRLF line ends gives the same hash; a `tools/build.ts` run followed by `cargo build` compiles no crate; and a build whose installed SDK isn't `msfs-sdk.txt`'s stops and names `node tools/setup.ts`, in `tools/build.test.ts`.
  The [build log](log.md#2026-10-18-cargo-refuses-a-member-glob-that-matches-no-folder-or-a-folder-without-a-cargotoml-and-typescript-702s---explainfiles-lists-a-type-only-import) has the run of each by hand.

Exit: on our development machine, `node tools/check.ts` passes on the tree, and the map check fails each of its fixtures by the rule it breaks.
Done on 2026-10-18.

## 2 The core's loop and edge

Builds:

- the kernel: the registry, the store of each unit's state, hooks, moments, requests and their guards, the outbox and its running hash, timers, jobs, the files each unit is handed with the core's first input, such as the settings, and each unit's handles and IDs ([the kernel's interface](../core/01-loop-and-edge.md#the-kernels-interface), [starting and stopping](../core/01-loop-and-edge.md#starting-and-stopping))
- `src/apps/core`'s `main` and its list of units, the queue and its stamps, the home folder's placeholder, the timer thread, tokio's runtime and its blocking pool, a sink for each output type, the panic hook, the log's subscriber, and starting and exiting, with FMA3 off, the data folder's named mutex, and the guard on the static C runtime ([threads](../core/01-loop-and-edge.md#threads), [the queue](../core/01-loop-and-edge.md#the-queue), [inputs](../core/01-loop-and-edge.md#inputs), [the core's math](../core/01-loop-and-edge.md#the-cores-math), [a panic](../core/01-loop-and-edge.md#a-panic), [starting and stopping](../core/01-loop-and-edge.md#starting-and-stopping), [logging](../core/01-loop-and-edge.md#logging))
- the recording's writer and `dualinput-core replay`, with the replay log's encoding in `recording-format`: its header, inputs, and checkpoints ([replay](../core/01-loop-and-edge.md#replay))
- the loop's Clippy rules: the root's `clippy.toml` and the workspace's lint on a `HashMap`'s order, which the loop's crates take ([one loop](../architecture/02-code-map.md#one-loop))

The sim thread comes in stage 4, the WebSocket server and the port file in stage 5, and `tools/replay.ts` in stage 22.
The edge's jobs read and write files, and its other jobs, fetching over HTTPS and reading the clipboard, come with the first stage whose units start them.
01-loop-and-edge's other cases and budgets are in the `Tests` lines of stages 3, 4, 5, 9, 15, and 18, each marked as from stage 2.

Designs first: four things [01-loop-and-edge](../core/01-loop-and-edge.md) left open, which the user agreed on 2026-10-20: the queue's lock ([the queue](../core/01-loop-and-edge.md#the-queue)), the 64-bit hash that folds the outputs ([outputs](../core/01-loop-and-edge.md#outputs)), the crate that gives ChaCha20 ([timers, jobs, and IDs](../core/01-loop-and-edge.md#timers-jobs-and-ids)), and how big the log file grows ([logging](../core/01-loop-and-edge.md#logging)).

Needs: 1.

Tests:

- A test of each rule in [the kernel's interface](../core/01-loop-and-edge.md#the-kernels-interface), among the kernel's own tests, a test unit that raises moments in a cycle among them.
- From [01-loop-and-edge's cases](../core/01-loop-and-edge.md#cases-for-the-bench): two edges push at once, and every stamp rises with its sequence number, over 200,000 pushes each, which the bench runs for minutes; a test unit that reads the clock is caught at the next checkpoint of its replay; and a replay on another commit refuses, naming the commit.
- From [the build's cases on a desk](01-the-build.md#cases-for-the-bench): a build with `RUSTFLAGS` set, even empty, stops at `src/apps/core`'s guard, in `tools/core.test.ts`; and the core imports no `api-ms-win-crt-*` DLL, by `dumpbin /imports`.
- From [01-loop-and-edge's budgets](../core/01-loop-and-edge.md#budgets): by hand, a timer fires within 2ms of its deadline at p99 on an idle PC, and the core holds under 30 MB of private working set with no session; among the tests, the core exits within 1s of its exit going out.

Exit: on our development machine, `node tools/check.ts` passes with the kernel's and `src/apps/core`'s tests among it.
In one of them, a core with units of the test's own records a run and exits within 1s, and the recording replays to every checkpoint, while a copy with one input's bytes changed names the first checkpoint after that input.
Done on 2026-10-20.

## 3 The bench

Builds:

- `tools/bench.ts` and `tools/bench/`: the runner, which builds the bench build into a target folder of its own, runs each scenario in `tools/bench/scenarios/` on Node's test runner with a data folder for each core, starts and kills the cores, and ends each scenario by replaying each core's recording; and the loop under load, which runs by hand on p10's capture of a flight ([the bench](02-testing.md#the-bench), [replays](02-testing.md#replays), [the loop under load](02-testing.md#the-loop-under-load))
- `src/apps/core`'s `stand-in` feature: the bench's socket, whose messages are the message crate's first, and the test units the scenarios drive ([its place](02-testing.md#its-place))
- the loop's stats in the core's log ([logging](../core/01-loop-and-edge.md#logging))
- `simconnect-types`; the sim seam's four inputs in `sim-client`, with the edge's own calls, which look for the sim's process and open and close a connection; and the stand-in sim's thread, the process it watches, its opens and closes, and the losses and quit messages a scenario asks for ([the stand-in sim](02-testing.md#the-stand-in-sim), [the sim seam](../architecture/02-code-map.md#the-sim-seam), [the edge](../core/03-sim-seam-and-wasm-module.md#the-edge))

The stand-in answers no SimConnect call until [stage 4](#4-the-sim-seam-our-wasm-module-and-our-package), which builds the platform's calls in `sim-client`, the sim edge, and the stand-in together, as each later stage builds its features' calls, so the stand-in learns each call beside the edge that tries it in the sim (user, 2026-10-20).
Each later stage adds the stand-ins its own units need ([left to each stage](02-testing.md#left-to-each-stage)).
The bench's [other cases](02-testing.md#cases-for-the-bench) and its [budgets](02-testing.md#budgets) need parts later stages build, and are in the `Tests` lines of stages 4, 5, 7, 15, and 22, each marked as from stage 3, and the loop under load runs again in stage 14.

Needs: 2.

Tests:

- From [01-loop-and-edge's cases](../core/01-loop-and-edge.md#cases-for-the-bench): the core is killed, its recording reads up to its last full frame, and it loses at most the recording's last second ([budgets](../core/01-loop-and-edge.md#budgets)).
- From [the bench's own cases](02-testing.md#cases-for-the-bench): a bench build and a release build of one commit carry one message crate's hash, and `cargo tree` of the release build lists no `stand-in-sim`.
- By hand, [the loop under load](02-testing.md#the-loop-under-load) for an hour: the queue within one sim frame, 11.2ms, at p99, each handler within 1ms but the stand-ins for write functions, and the loop busy under 20% of a CPU core ([the code map's budgets](../architecture/02-code-map.md#budgets)); its replay within 6 minutes ([01-loop-and-edge's budgets](../core/01-loop-and-edge.md#budgets)); and, from stage 2, edges pushing at once for the hour, every stamp rising with its sequence number, since the recording's writer stops at a stamp that falls and the recording holds every input the loop handled ([01-loop-and-edge's cases](../core/01-loop-and-edge.md#cases-for-the-bench)).
- The stand-in's own tests: it hands up a watched process's finding and its exit code, an open's result and the sim's open message, and the losses and quit messages a scenario asks for.

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, the killed core's scenario among them, and the [core's log](../core/log.md) has an entry for the loop under load's hour.
Done on 2026-10-21.

## 4 The sim seam, our WASM module, and our package

Builds:

- `sim-edge`: the sim thread, which waits on each connection's event and the sim's process for at most 2ms, makes the queued calls through `SimConnect.dll` in order, dispatches each connection's messages, tags each exception by its packet ID, and finds and watches the sim's process ([the edge](../core/03-sim-seam-and-wasm-module.md#the-edge))
- the rest of `sim-client`: each connection's IDs, the setup it makes again on a new connection, and watches by name ([the sim client](../core/03-sim-seam-and-wasm-module.md#the-sim-client))
- `sim-awareness`: its stages, the aircraft from `AircraftLoaded`'s path, the pause, and the run of the sim and how it ended ([sim awareness](../core/03-sim-seam-and-wasm-module.md#sim-awareness))
- `sim-service`: its connections; the platform's connection and what it holds, but the announcement; the calls `watch`, `write`, and `key`, and `cx.module()`'s `feed` and `end`; the module's status and the unfreeze; `SimChanged`; and the flight file's `[Departure]` read, as a job ([the sim service](../core/03-sim-seam-and-wasm-module.md#the-sim-service), [the module's status](../core/03-sim-seam-and-wasm-module.md#the-modules-status))
- `routine-host`: routines' slots and their header, a routine's life, `Frame::now`, the freeze, preflight's `Hold`, and the module's status slot ([routines in our WASM module](../architecture/02-code-map.md#routines-in-our-wasm-module), [its slots](../core/03-sim-seam-and-wasm-module.md#its-slots), [the core's counter in our module](../flight-model/01-flight-model-sync.md#the-cores-counter-in-our-module))
- `src/sim-package/routines/`, the module's list of routines, and `src/sim-package/wasm-module/`, the module's edge on the sim's APIs, with Clippy's four panic lints denied in every crate the module builds ([our WASM module](../core/03-sim-seam-and-wasm-module.md#our-wasm-module), [when the module stops](../architecture/02-code-map.md#when-the-module-stops))
- our package, which `tools/build.ts` lays out with its `layout.json` and `manifest.json`; `node tools/build.ts install`; and the module's build in `tools/check.ts`, which checks its exports against the list p03 checked ([our package](01-the-build.md#our-package), [building every target](../architecture/02-code-map.md#building-every-target), [CI](../architecture/02-code-map.md#ci))
- the stand-in in the edge's place in the bench build: its answer to each call above, its aircraft's table of variables, its frames, which run the routine host and the routines natively, its faults, a load played from p08's recorded signals, and the stub the bench starts for each sim ([the stand-in sim](02-testing.md#the-stand-in-sim))
- the SimConnect SDK's version, `simconnect_types::SDK_VERSION`, in the recording's header ([what a recording holds](../core/01-loop-and-edge.md#what-a-recording-holds))

The sim service's other calls each come with the first feature that makes them, with the stand-in's answer and the call's trial in the sim (user, 2026-10-21): `listen`, `input`, and `set_input` in stage 14, `reports` in stage 16, `create_ai`, `remove`, `camera`, and `frames` in stage 17, `poll` and `release` in stage 18, `world_map` in stage 21, and `commbus_call` and `commbus_listen` after v1, since no v1 feature makes them.
p08's client already made AI creates, camera reads, input events, masking, and a CommBus call through `SimConnect.dll` in a flight ([the core](../architecture/01-spine.md#the-core)), so trying them before their features adds little.
The routine host's other wants come with the routines that ask for them, in stages 14, 16, and 17.
The sim service's parts that need a later stage come with it: the announcement with `announce`, the module's notifications, and the sim service's slice of client state in stage 5, which builds the clients crate; the menu script with our BlurPage copy and aircraft awareness in stage 9, which builds the session crate; and the checks of packages on disk in stage 15.
The kernel gets no way to count an output the sim service makes for a feature's call as that feature's, since with every input recorded a replay checks both units' outputs ([recording log](../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour)).

Needs: 3.

Tests:

- From [03's cases for the bench](../core/03-sim-seam-and-wasm-module.md#cases-for-the-bench), as sim awareness's own tests: p08's recorded signals raise one Loading, one Ready to fly, and one Flying, with the PA-24's folder and preset, and the main menu's two `AircraftLoaded` raise nothing; the Restart's recorded signals raise one Loading, and no Menu; and the A350's two paths for one load name one aircraft.
- From the same, on the bench: the quit message, then the process exiting, ends the run as a close, and nothing opens between the two; the process exiting with no quit message ends it as a crash; a loss with no quit message, then an open that succeeds, changes no stage, and each test unit hears its own connection's loss; a feed whose slots hash differs runs no routine, and the sim service reports the module as differing; and the counter still for 3s in Flying, unpaused, with a routine live, unfreezes the aircraft, while still through Loading, through a pause, with no routine live, or for under 3s since a pause ended, it does nothing.
- From [the code map's cases](../architecture/02-code-map.md#cases-for-the-bench), on the bench: `AircraftLoaded` three times around one load raises one `SimChanged` into Loading; a message for a closed connection is discarded; a variable the stand-in rejects from a watch after the call returned leaves the watch's other values arriving; the platform's connection takes its masking group at `S_OK`, before the sim's open message; and a connection lost and opened again has its setup made again, as the platform's has when the sim closes and starts again.
- From [the code map's cases for work in the sim](../architecture/02-code-map.md#cases-for-the-bench-for-work-in-the-sim), on the bench: a routine fed again after its end mark starts with nothing from its last feeding; and with the module stopped by a test routine built to panic, the core unfreezes the aircraft within 3s of the counter's last tick, while the counter stalling through a flight load or a pause unfreezes nothing.
- From stage 3: two bench cores on one PC each see only their own stub, and killing one stub ends that core's sim alone, as a crash ([the bench's own cases](02-testing.md#cases-for-the-bench)).
- From [the build's cases on a desk](01-the-build.md#cases-for-the-bench): `node tools/build.ts install` writes our package into each packages folder's `Community`, and refuses while the sim runs.
- In this stage's session in the sim: our module runs from our `PANEL_PATCH` package, and the sim service reads it as Running ([our package](01-the-build.md#our-package)); and from [03's cases](../core/03-sim-seam-and-wasm-module.md#cases-for-the-bench), closing the sim from its menu sends the quit message before its process exits; killing the sim shows which of a failed call, the quit message, and the process's exit reaches the edge first, and how soon; through a second flight load in one run of the sim, the module's own connection and its slots carry on; a Marketplace aircraft's path names its folder and preset, and each of the L-1011's four presets gives a path of its own; and a connection's event, not the 2ms timeout, wakes the edge.
- In that session, by hand: from stage 2, the timers fire within 2ms of their deadlines at p99 with the sim running and the PC busy ([01-loop-and-edge's budgets](../core/01-loop-and-edge.md#budgets)); the edge puts a message on the queue within 1ms of SimConnect signaling it, at p99 ([the sim seam's budgets](../architecture/02-code-map.md#the-sim-seams-budgets)); and Closed comes within 100ms of the quit message or the process exiting, and the platform's connection opens within 6.5s of the sim taking connections ([03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md)'s note of 2026-10-21 on its budgets).

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, the module's build and the sim seam's scenarios among them; in this stage's session in the sim, a core built from the tree follows the sim in its log from its boot through two flight loads to its close, naming each load's aircraft, with the module Running; and the [core's log](../core/log.md) has an entry for the session's cases and budgets.
Done on 2026-10-22.

## 5 Clients and the panel bridge

Builds:

- `clients`: the protocol's messages, in the message crate's `clients` module; the table of clients, each one's `hello`, and the close of a socket quiet for 8s; client state's slices, its round every 50ms, and `watch`; commands and their answers; `unit` messages to a component or a panel module, and from one; notifications, as a slice of its own; settings in `settings.json`, each with its label and whether it's a development setting; the moments a client joined or left, a panel's socket replaced, and a setting changed; the profile's load and unload, at which it answers each cockpit panel with `load` or `none`, and sends `stop`; the trouble notification when no cockpit panel's `hello` comes within 10s of the profile loading; and `bye` ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md), [settings](../interface/01-apps.md#settings), [trouble](../interface/01-apps.md#trouble))
- `src/apps/core`'s WebSocket server, on tokio-websockets 0.13.3: its `Origin` check, its 1 MiB limit, text alone, socket IDs from the edge's counter, and the port file, written once the port is bound and deleted as the core exits ([the WebSocket server](../core/02-clients-and-panel-bridge.md#the-websocket-server), [finding the core](../architecture/01-spine.md#finding-the-core))
- `page-client`: hearing the core's announcement in a page that has the sim's `common.js`, connecting, the `hello`, `alive`, handing each message to whoever registered its tag, connecting again at the next announcement, and the connection's state ([page-client](../core/02-clients-and-panel-bridge.md#page-client), [when the core goes](../interface/01-apps.md#when-the-core-goes))
- `panel-bridge`: a record of each instrument with its key, the `hello` naming them once a session runs, loading each panel module from its file and calling its `start` and `stop` each in a `try`, a module's `ctx` with its instruments, its `unit` messages, and `ctx.watch`, and `window.DUALINPUT_BRIDGE_UNLOCK()` ([our VCockpit.js](../core/02-clients-and-panel-bridge.md#our-vcockpitjs), [panel modules](../core/02-clients-and-panel-bridge.md#panel-modules), [modules in the panel bridge](../architecture/02-code-map.md#modules-in-the-panel-bridge))
- in our package, `src/sim-package/pages`' `VCockpit.js` override, which `tools/build.ts` makes from the stock file at named anchors, and `bridge.js`, one esbuild bundle of the bridge and page-client ([our VCockpit.js](../core/02-clients-and-panel-bridge.md#our-vcockpitjs))
- `src/sim-package/stock/`, with the sim's `VCockpit.js`, BlurPage's two files, and `stock.json`; `tools/stock.ts`; and the build's comparison of the sim's own files with them ([the sim's stock files](01-the-build.md#the-sims-stock-files))
- the Coherent GT check, in `tools/`, with its data file from [Coherent GT's JavaScript](../architecture/coherent-gt.md) and p09's samples as its first tests, which `tools/check.ts` runs on every file we ship into the sim, and a hook runs after each edit ([the Coherent GT check](01-the-build.md#the-coherent-gt-check))
- the bench's fake pages, which hear the stand-in's announcement and speak the protocol over the core's WebSocket from the messages' TypeScript types, a fake cockpit panel's bridge among them ([the sim's pages](02-testing.md#the-sims-pages))

Designs first: whether the core sends each client `alive` every 2s whatever else it sends, or only after 2s of nothing, as [the protocol](../core/02-clients-and-panel-bridge.md#the-protocol) has it, since recording every input took away the drift the first guarded against ([recording log](../recording/log.md)); [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md)'s note of 2026-10-22 settles it.

From stage 4, it also builds the sim service's announcement every 2s, whose body holds the clients crate's port, and `sim_service::announce`, which a bench test unit calls in the session crate's place until stage 9; `SimConnect_CallCommBusEvent` in `sim-client`, the edge, and the stand-in, which hands each call to the bench's fake pages; the sim service's slice of client state; and the module's trouble notifications ([the announcement](../core/03-sim-seam-and-wasm-module.md#the-announcement), [sim awareness](../core/03-sim-seam-and-wasm-module.md#sim-awareness), [the module's status](../core/03-sim-seam-and-wasm-module.md#the-modules-status)).
The bridge's locks come with pointer sync in [stage 19](#19-pointer-sync), the one v1 feature that asks for them, and what `clients` holds for the apps alone comes with the apps' wiring in [stage 11a](#11a-the-apps-wiring) (user, 2026-10-22).
The bench's fake EFB app and banner come in stage 11a too, and its fake menu script in stage 9.
A bench test unit stands in for the profile loader until stage 10, telling `clients` when the profile loads and unloads, as [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md)'s note of 2026-10-22 has it.

Needs: 4.

Tests:

- From stage 2: a feature's command handler reads the clients crate's settings while the clients crate dispatches it ([01-loop-and-edge's cases](../core/01-loop-and-edge.md#cases-for-the-bench)).
- From stage 3: a fake page that heard the stand-in's announcement connects; and in this stage's session in the sim, with a bench core running beside the real sim's core, every cockpit panel connects to the real sim's core, and none to the bench core, while stage 11b's session checks the sim's other pages ([the bench's own cases](02-testing.md#cases-for-the-bench)).
- From [02's cases](../core/02-clients-and-panel-bridge.md#cases-for-the-bench), on the bench: a socket from a browser page closes with 1008, and nothing it sent reaches the loop; a `hello` from a client of another version is logged with both versions, and the core goes on talking to it; a message that doesn't parse is logged and dropped, and a `command` whose arguments don't parse answers with an error; the core suspended for 12s leaves every fake page its socket, and each fake panel's modules carry on without loading again; the core restarted on another port has every fake page connect again within 2s of its next announcement; a panel told `none` connects no more until the session ends; a slice that changes 100 times a second reaches a fake page at most once a round; a command no unit registered answers "unknown"; and a settings file keeps a key no unit registered.
- From [the code map's cases for work in the sim](../architecture/02-code-map.md#cases-for-the-bench-for-work-in-the-sim): as the bridge's own tests, a panel module that fails to load, or throws in `start`, leaves the other panel modules in its panel running, and with the core's socket closed every panel module stops at once; and on the bench, a panel that reloads mid-session gets its panel modules again on its new socket, and the core closes the old one.
- From [the apps' cases](../interface/01-apps.md#cases-for-the-bench), on the bench: a setting changed from a fake page's socket takes effect; no cockpit panel connecting within 10s of the profile loading raises `clients`' trouble notification, cleared once one connects; and a module from another build while a test routine is fed raises the sim service's trouble notification for our package.
- From stage 4: the announcement goes out within one input of the session crate's call, here the test unit's ([03's budgets](../core/03-sim-seam-and-wasm-module.md#budgets)).
- On the bench, [02's budgets](../core/02-clients-and-panel-bridge.md#budgets): a message under 64 KiB; one round of client state under 1ms on the loop; under 30 messages a second to one panel; each of 20 fake cockpit panels, as many as the Black Square Baron 58P has, answered with `load` or `none` within 1s of the profile loading; and a fake page connected again within 2s of a restarted core's announcement.
  And [the build's budgets](01-the-build.md#budgets): the Coherent GT check on a 2.5 MB bundle, and the hook's findings after a save, each under 1s.
- In this stage's session in the sim: our `VCockpit.js` loads the bridge into every cockpit panel of a flight, and every instrument loads as without us; each bridge hears the core's announcement, and once the sim's inspector plays a session's announcement into its panel, connects to the core with its instruments' keys; and with `bridge.js` missing, and with one that throws as it loads, every instrument loads as it would without Dual Input, in a sim started for each ([02's cases](../core/02-clients-and-panel-bridge.md#cases-for-the-bench); user, 2026-10-22).

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, the Coherent GT check and the clients' scenarios among them; in this stage's session in the sim, every cockpit panel of a flight loads the bridge, and connects to the real sim's core once the inspector plays a session's announcement into it, and every instrument loads as without us whether `bridge.js` is there, missing, or throws; and the [core's log](../core/log.md) has an entry for the session's cases and budgets.
Done on 2026-10-22.

## 6 The core helper

Builds:

- the message crate's `core_helper` module: `ToHelper`, `FromHelper`, `Wants`, and the types inside them, with the changes the notes at the top of [04-core-helper](../core/04-core-helper.md), [take-control](../control/01-take-control.md), [avatars](../avatars/01-avatars.md), and [traffic and ATC](../traffic-atc/01-traffic-and-atc.md) make: no `Alive`, the mouse on or off, sounds as a want of their own, a capture that names a list of programs, each frame's stamp, a stream's buffer rule and gain, the report at each transmission's end, and the mouse's wheel notches and the right release's counts ([the pipe](../core/04-core-helper.md#the-pipe))
- `core-helper-service`: each want's registration, numbered in the order units register, and turning each on and off; the sounds and the wants sent whole after each `Hello`, and the wants after each change, a setting changed whose key a binding names among them; `play`; the helper's life, from its start to its start again 2s after it exits, with the `Hello` check and the trouble notification 5s after it went down; `Failed`'s warning; `InUse` logged, and the warning for a missing device; the output device setting; the command that lists devices and programs, and its slice; and the development setting that names the program the core starts as its helper ([what a feature registers and calls](../core/04-core-helper.md#what-a-feature-registers-and-calls), [the helper's life](../core/04-core-helper.md#the-helpers-life), [the devices](../core/04-core-helper.md#the-devices), [the stand-in core helper](02-testing.md#the-stand-in-core-helper))
- `src/apps/core`'s edge for the helper, on tokio: starting the program from the core's own folder with its standard input and output piped and its standard error discarded, the pipe's frames with their 4-byte length and 1 MiB limit, closing its standard input at a stop and killing it after 1s, and its process ID, its exit, or the error that stopped it starting, each as an input ([the pipe](../core/04-core-helper.md#the-pipe), [the helper's life](../core/04-core-helper.md#the-helpers-life), [threads](../core/01-loop-and-edge.md#threads))
- `src/apps/core-helper`: its threads; Raw Input for keys, buttons, and the mouse, with the sim's windows found by class and title, and DPI awareness; the output device, Windows' default and its changes, the lists, and `InUse`; capturing the first running program of a list through process loopback, with the mixer's level divided out, the gate, and 20ms Opus frames; playback streams behind [the buffer](../traffic-atc/01-traffic-and-atc.md#the-buffer) traffic and ATC gives, with loss concealment, gain, and each transmission's report; sounds from Ogg Opus, mixed into the one output stream; and Opus through opus-rs ([inside the helper](../core/04-core-helper.md#inside-the-helper))
- the bench's stand-in core helper, a Rust program on the message crate, which the bench names through that development setting and scripts ([the stand-in core helper](02-testing.md#the-stand-in-core-helper)); and a bench test unit that registers wants and turns them on, in the place of the features that will

The microphone, its setting, phrases, and the speech thread come with the voice phrases, a Soon pick, as 04-core-helper's note of 2026-10-17 has it.
Each feature's own wants come with its stage, with its cases on the stand-in core helper: avatars' mouse in [stage 17](#17-avatars), ATC audio's capture and stream in [stage 18](#18-traffic-and-atc-audio), and take-control's binding, next press, and sounds in [stage 20](#20-take-control).

Designs first: the versions of opus-rs and wasapi the helper pins, since 04-core-helper leaves opus-rs's to this stage and wasapi has had a release since the design chose 0.25.0; how the bench scripts its stand-in core helper, which [testing](02-testing.md#the-stand-in-core-helper) leaves open; and where the ATC speech for opus-rs's check comes from.

Needs: 5.

Tests:

- From [04's cases](../core/04-core-helper.md#cases-for-the-bench), on the bench with the stand-in core helper: the helper killed while a want is on runs again within 3s, with the test unit's binding sent as before; the core killed, and the helper exits within 1s; and a helper of another build is logged, killed, and started again, and the trouble notification shows 5s after it went down.
  04's case of a suspended helper killed after 8s goes, since the helper sends no `Alive` (04-core-helper's note of 2026-10-18).
- As the helper's own tests, with no device: its first message is `Hello`; it exits within 1s of its standard input closing, which settles whether a program with no console reads a piped standard input ([left open](../core/04-core-helper.md#left-open)), and exits with a code other than 0 on a length over 1 MiB or a message that doesn't parse; a held key whose press repeats crosses once; a device's first report only sets which of its buttons are down; audio below the gate never crosses; and from [traffic and ATC's cases](../traffic-atc/01-traffic-and-atc.md#cases-for-the-bench), the buffer's: frames with 80ms ± 30ms of jitter settle the depth at their 98th percentile, a frame later than its turn is dropped and concealed, a missing number whose stamp gap matches is concealed, a stamp 30ms past what consecutive numbers account for starts a new transmission, and a 2-minute transmission whose stamps drift 12ms from the device stays one.
- From 04's cases, on a desk, on our development machine, with the real helper started by a core built from the tree: a bound key held for 2s crosses as one press and one release; a key nobody bound, typed into another program, never crosses the pipe, which the recording shows; while binding, with a throttle quadrant's switch held on, only the button the pilot presses crosses, and then nothing; clicks with another program in front never cross; on a monitor scaled to 150%, a click in the top-left corner of the sim's window's client area crosses as x −1, y 1, and one in the bottom-right as x 1, y −1; Windows' default output device changing while a sound plays carries the sound on in the new device; a picked headset unplugged plays on Windows' default and warns, and goes back to the headset when it's plugged into another port; and a captured program that exits and starts again stops the capture, then attaches again, with its frames at full level while it's at 30% in the Windows mixer.
  The same run settles two of 04's [left open](../core/04-core-helper.md#left-open) items: whether WASAPI converts a process-loopback stream's format, and whether such a stream reports the counter's value with each read.
- From 04's cases, by hand: ATC speech recorded from BeyondATC goes through opus-rs at 24 kbps with 5% of frames lost, within the CPU budget, and the run counts frames of 6 bytes or fewer; we listen to it, and a fault a pilot would notice swaps in libopus ([Opus](../core/04-core-helper.md#opus)).
- In this stage's session in the sim, with the real helper: a bound key crosses with the sim's main window or a popped-out display in front, and not with another program in front; a click in the sim's main window crosses with its place and the window's size, and a click in a popped-out display crosses nothing; the helper captures BeyondATC's speech; and from [traffic and ATC's cases](../traffic-atc/01-traffic-and-atc.md#cases-for-the-bench), whether the helper captures SayIntentions' speech through `SayIntentionsAI`.
- [04's budgets](../core/04-core-helper.md#budgets): on a desk, the helper under 1% of one CPU core while it captures and plays, under 20 MB of private working set, a press on the queue within 5ms of the helper's stamp at p99, and exited within 1s of its standard input closing; and on the bench, running with every want sent within 3s of an exit, and the pipe under 200 messages a second each way.

The cases on a desk that need a person at the PC, and this stage's cases in the sim, run in one session of their own, after stage 7, which was built while stage 6 waited for them (user, 2026-10-22).

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, the helper's own tests and the stand-in core helper's scenarios among them; on a desk and in this stage's session in the sim, a core built from the tree starts the real helper, which sends a bound key's press, a click in the sim's window with its place, and a captured program's frames, and plays a sound on the device picked; and the [core's log](../core/log.md) has an entry for the desk's and the session's cases and budgets.
Done on 2026-10-23.

## 7 The network

Builds:

- the message crate's `net` module: the kinds of delivery, the first message's header, and the transport's commands and events, with a test that fails on two channels with one number ([the units](../network/02-units.md#the-units), [channels and sends](../network/02-units.md#channels-and-sends))
- `network`: channels and sends; the first message, with the opener hook the session crate fills; links, one for each pilot ID, with the 2s redial, the 5s lost timer, the 10s first-message timeout, the rule for which of two connections stays, and `MemberOut` at 30 minutes; the moments `LinkUp`, `LinkLost`, `MemberLeft`, `MemberOut`, and `BackendAnswered`; the requests `Host`, `Join`, `Open`, `Dial`, and `Leave`, with the backend's requests signed by the endpoint key; the heartbeat and clock offsets; and its slice, settings, and notifications ([the network crate](../network/02-units.md#the-network-crate))
- `transport`, an engine at the core's edge: its commands and events; the endpoint from `presets::Minimal` with `RelayMode::Custom`, the path timers, and the one-off queue's size; the newest-only slots and ATC audio's queue; pacing through a relay; the heartbeat's send stamp; and binding under a timeout ([the transport](../network/02-units.md#the-transport), [sending](../network/01-between-machines.md#sending), [paths](../network/01-between-machines.md#paths))
- `src/apps/core`'s edge for the transport, on tokio, and its jobs that fetch over HTTPS, the first stage whose units start them ([threads](../core/01-loop-and-edge.md#threads))
- `src/backend/`: the Worker's four requests, codes, lapses, wrong codes, signatures, and hourly Cron Trigger, its D1 migrations, and its tests against a local D1 ([the backend](../network/02-units.md#the-backend))
- `src/relays/`: `relays.toml`, the default relay list the network crate compiles from it, and `src/relays/deploy.ts` ([the relays](../network/02-units.md#the-relays))
- the bench's two local `iroh-relay`s with test tokens, a TCP proxy in front of each that holds back or cuts one core's connection, its local backend on a local D1, and a test unit that stands in for the session crate's opener and requests, and for channels of each delivery ([what it touches](02-testing.md#what-it-touches))
- `tools/bench/droplet`: a small core for Linux, with the transport at an edge of its own and a relay inside its listener, for the by-hand run below on our droplets; `run.ts`, which runs two of them between the droplets under `tc netem`; and `report.ts`, which reads what each end got ([the network's units](../network/02-units.md)' note of 2026-10-23)

The cases that need features of later stages come with them: the cockpit stream's replay on `LinkUp` with `again` in [stage 13](#13-the-sync-engine-and-the-cockpit-stream), a PF's Leave and a take-control during a cut with the session crate in [stage 9](#9-the-session) and take-control in [stage 20](#20-take-control).
The release workflow that deploys the backend comes in [stage 22](#22-github), and the private repository that holds the relays' tokens, `dual-input/relay-tokens`, comes now, the one exception to [how the stages are ordered](#how-the-stages-are-ordered)'s rule on GitHub (user, 2026-10-22).

Designs first: iroh's version, since the design pinned 1.3 and iroh 1.4.1 has come out ([iroh as a dependency](../network/01-between-machines.md#iroh-as-a-dependency)); where the network crate's build finds the relays' tokens ([their configuration](../network/02-units.md#their-configuration)); how a released backend path's bodies are held to the release that first served them ([the build's left open](01-the-build.md#left-open)); and whether v1's backend keeps a session's rows for 30 days after a leave ([the network's units](../network/02-units.md)' note of 2026-10-21).
The user settled all four on 2026-10-22: iroh's version, the repository, and the 30 days as [the network's units](../network/02-units.md)' note of 2026-10-22 has them, and the backend's released bodies as [the build](01-the-build.md)'s note of the same day has them.

Needs: 5.

Tests:

- From [02-units' cases](../network/02-units.md#cases-for-the-bench), on the bench, with two or three cores through the local relays and their proxies: every channel through a relay at a 1% and a 3% rate of held-back bytes, the streams' p99 lateness within 17ms of the one-off packets'; a core suspended for 60s, with `LinkLost` after 5s and, on resuming, a redial, a first message, and `LinkUp` with `again`; a core killed and restarted, whose higher restart count ends the old link with `LinkUp`'s `again` false and no `MemberOut`; the proxy cutting both cores for 10s, 30s, 60s, and 120s, with the time to data again recorded; the relay down for 40s; a core's home relay moved; two relays with the cores homed at different ones; both cores redialing at once in either order, keeping one connection; a joiner whose first dials fail linking once the proxy lets it through; no first message for 10s, and a wrong code, version, or hash, each closing with its code and the refused side's notification; a burst of one-off packets never holding more than 3,486 bytes in QUIC's queue, nor a flight sample going out after a newer one; two cores' clock offsets within 1ms of 0; and the backend's requests against a local D1.
- From stage 3: a scenario that holds back one pair's relay leaves the other pairs' messages on time ([the bench's own cases](02-testing.md#cases-for-the-bench)).
- [02-units' budgets](../network/02-units.md#budgets): about 140 inputs a second from one link within the loop's budgets; the transport within the edge's 2% of one CPU core; a join within 3s on a direct path; and v1's busiest mix through the relay, whose peak rate sets the relay's cap.
- By hand, on our droplets: v1's full mix on a direct path at no loss, 1%, and 3%, through `tc netem`, with and without the newest-only slots, which settles [left open](../network/02-units.md#left-open)'s item on them.

This stage's by-hand run on our droplets ran unattended, on its own, so stage 6's cases that need a person or the sim keep a session of their own.
The stage closes on its network scenarios, without the whole bench, though it pinned iroh's crates, since the whole bench passed on its code before the pin and before the product's code moved into `src/` (user, 2026-10-23).
It closes before `src/relays/deploy.ts` has deployed our relays, which waits for their DNS records, and [stage 22](#22-github)'s tests deploy them (user, 2026-10-23).

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, the network's scenarios and the backend's tests among them; two bench cores link through a local relay, lose the link, and link again, as the network's log shows; the by-hand run on our droplets has run; and the [network's log](../network/log.md) has an entry for the cases and budgets.
Done on 2026-10-23.

## 8 Recording and bug reports

Builds, as [01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md)'s note of 2026-10-23 has them:

- `recording-format`: one zstd frame for the run, flushed each second, in place of the frame it ended each second ([the files](../recording/01-recording-and-bug-reports.md#the-files))
- `src/apps/core`'s writer: the flush each second, and the recording stopped, as on a failed write, when the data folder's drive has under 1 GB free
- the kernel: every unit's handles from one counter, and its random IDs from one ChaCha20 generator; and two jobs the edge runs, one that lists a folder with each entry's size, and one that deletes a file or a folder ([timers, jobs, and IDs](../core/01-loop-and-edge.md#timers-jobs-and-ids))
- `src/apps/core`'s edge: every input as it came, so `home.rs`'s placeholder, and the jobs' and the core helper's way back to the real path, go; the log subscriber still replaces the home folder's path and the Windows username in each line
- `recording`: at the core's start, listing `recordings\` and deleting the oldest runs while all of them together pass 1 GB; a slice of the runs by their folders' names, with their sizes and the newest as the run in progress; a command that marks the moment, which logs a line at info; and a command that deletes a run, refusing the one in progress, then lists the runs again ([slices and commands](../interface/01-apps.md#slices-and-commands))

The rule that each unit logs at info each decision a pilot can notice, with its reason, is in [01-loop-and-edge](../core/01-loop-and-edge.md)'s note of 2026-10-21 on [logging](../core/01-loop-and-edge.md#logging), and each stage's units keep it.
The report page is the EFB app's, and comes with [the apps](#11b-the-apps); the clipboard's job, which hands up only an invite code, comes with the first stage whose units start it, as [stage 2](#2-the-cores-loop-and-edge) has the edge's jobs come.

Designs first: the budgets for a session's recording and for a run with no session, which rested on partial recording, and which of what keeps the drift from spreading's rules stay, now that every input is recorded ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md)'s note of 2026-10-21).
The user settled both on 2026-10-23, with the writer's flush, the stop under 1 GB free, and the cuts that leave the recording no marks, index, or placeholder for the home folder, as the [recording log](../recording/log.md#2026-10-23-one-zstd-frame-flushed-each-second-keeps-a-busy-flights-recording-at-426-mb-an-hour-where-a-frame-ended-each-second-takes-667-mb)'s entry of that day has them.

Needs: 7.

Tests:

- As `recording-format`'s tests: a recording cut between two flushes reads back every input flushed before the cut, and says it's truncated.
- As `src/apps/core`'s tests: the writer stops the recording when the drive has under 1 GB free, and the run goes on; and a log line holding the home folder's path and the username shows neither.
- As `recording`'s tests: runs past 1 GB lose the oldest at the core's start, however many held no session.
- On the bench: a killed core's recording replays to its last flush, losing at most its last second; a fake page's command deletes an older run, refuses the one in progress, and the slice shows the runs left; and a replay on the same commit with a log line added warns, runs, and matches every checkpoint.
- [Budgets](../recording/01-recording-and-bug-reports.md#budgets): p10's capture through the writer this stage builds, within a session's 60 MB an hour.

The kernel changes, so the whole bench runs at this stage's close, which also covers the move into `src/` and iroh's pin that it hasn't run on (user, 2026-10-23).

Exit: on our development machine, `node tools/check.ts` and the whole `node tools/bench.ts` pass, the recording's scenarios among them; a killed core's recording, written in one frame flushed each second, replays to its last flush; and the [recording log](../recording/log.md) has the built writer's size on p10's capture.
Done on 2026-10-23.

## 9 The session

Builds:

- `session`: members and their four keys, and who is in the flight ([members](../session/02-units.md#members), [in the flight](../session/02-units.md#in-the-flight)); session keys, with their three writers, `Member`, `Anyone`, and `PilotFlying`, the `WriteKeys` request, which any guard on one key refuses whole, `KeyChanged`, and every key in each connection's first message through the network's opener ([session keys](../session/02-units.md#session-keys)); control, with `TakeControl` and the session crate's own guard on it, and the passes the platform makes itself ([control](../session/02-units.md#control)); the session file ([the session file](../session/02-units.md#the-session-file)); Host, Join, Leave, and Quit, the join from the clipboard that the EFB app's code box asks for, with the edge's job that reads the clipboard and hands up only an invite code, and when the core exits ([joining and leaving](../session/02-units.md#joining-and-leaving)); preflight, its phases, Ready with the session crate's own guard, Go without, and the 3s countdown ([preflight](../session/02-units.md#preflight)); the match check, with its own three items, the aircraft's package and where it's installed, its version, and its livery ([the match check](../session/02-units.md#the-match-check)); the display name setting; and its slice and the switch that claims every role key ([slices and commands](../interface/01-apps.md#slices-and-commands))
- `sim-service`: aircraft awareness, from the packages folders it reads from `UserCfg.opt`, which runs while a session is held, and `AircraftChanged` ([the aircraft's facts](../core/03-sim-seam-and-wasm-module.md#the-aircrafts-facts)); and the feed of preflight's `Hold` on the platform's connection ([routines in our WASM module](../architecture/02-code-map.md#routines-in-our-wasm-module))
- the menu script and our BlurPage copy in `src/sim-package/pages`, with the menu script's report of its master page, which ends sim awareness's Starting ([the menu script](../session/02-units.md#the-menu-script), [leaving Starting](../core/03-sim-seam-and-wasm-module.md#leaving-starting)); the menu's page, which only Go to reads, comes with Go to
- the bench's fake menu script ([the sim's pages](02-testing.md#the-sims-pages)); and the bench's test unit that stood in for the session crate keeps only its channels of each delivery, so the network's scenarios host and join through the session crate

Windows ending the pilot's session ends the core with no quit, so the crew sees a lost link, as [01-loop-and-edge](../core/01-loop-and-edge.md)'s note of 2026-10-23 has it.
The guards other crates add come with them: the cockpit stream's on control in [stage 13](#13-the-sync-engine-and-the-cockpit-stream), state sync's on Ready in [stage 14](#14-state-sync), and the profile loader's pin and match item in [stage 10](#10-profiles).
The session's features, rate and pause and Go to, come in [stage 21](#21-rate-and-pause-and-go-to), and the world map's requests with Go to.

Needs: 4, 7, and 8.

Tests:

- From [the session's cases](../session/02-units.md#cases-for-the-bench), on the bench, with two cores, the stand-in sim, and the fake pages:
  - A host starts a session before the sim runs: the joiner's slice shows the host hasn't loaded a flight yet, then the session's aircraft once the host loads one.
  - A host starts a session from a flight: `control` names the host, `preflight` holds the aircraft at once, and preflight runs, or ends at once when the host is airborne.
  - A joiner in another aircraft is a member and out of the flight, and enters the flight, as a late joiner after preflight, once it loads the session's aircraft.
  - The PF loads the wrong aircraft in preflight, returns to the menu, keeping control, then loads the right one: the session's aircraft follows.
  - The PF leaves the session in preflight while the PM is at the menu: the PM holds control, and preflight runs once the PM is in a flight.
  - Both pilots ready: the countdown runs and preflight ends on both cores, and `Hold` holds each aircraft until then; an un-ready at 2.9s cancels it; a lost link during the countdown cancels it, and the returning member is unready; a ready pilot whose sim crashes comes back unready.
  - Go without a PM whose sim kept running: preflight ends, and on return the PM raises `PreflightEnded`; the PM can't name the PF.
  - The PF leaves the flight after preflight with the PM in it: control passes to the PM; then the PM leaves the flight too: both cores leave, and the session ends.
  - A restarted core with a session file: a raised restart count before `Open`, `SessionStarted` and the announcement, and a pass of control it held before its own `FlightChanged`.
  - A streamed copy against an installed one: a warning; two streamed copies: nothing.
- From stage 2: a pilot quits Dual Input in a session, and the other core sees a leave, not an outage ([01-loop-and-edge's cases](../core/01-loop-and-edge.md#cases-for-the-bench)).
- From stage 4: a connection made in the main menu reaches Menu, and one made in a flight reaches Flying with the `AircraftLoaded` state's aircraft, by the menu script's master page ([03's cases](../core/03-sim-seam-and-wasm-module.md#cases-for-the-bench)), raising one `SimChanged` for the load it finds ([the code map's cases](../architecture/02-code-map.md#cases-for-the-bench)).
- From stage 5: a quit sent from the EFB app's socket takes effect, and a module from another build while `Hold` is fed raises the sim service's trouble notification for our package ([the apps' cases](../interface/01-apps.md#cases-for-the-bench)).
- From stage 7: a PF's Leave mid-flight, after which the PM holds control within 1s, and its core raises `MemberLeft` and stops dialing; and a PF's quit, which does the same, tells the backend, and exits ([02-units' cases](../network/02-units.md#cases-for-the-bench)).
- In this stage's session in the sim: `fsEventsTriggerKeyEvent` freezes and unfreezes the pilot's aircraft through `Hold` ([03's cases](../core/03-sim-seam-and-wasm-module.md#cases-for-the-bench)); and our BlurPage copy brings the menu script, whose master page takes a core that found the sim at the main menu to Menu.
- [The session's budgets](../session/02-units.md#budgets): a handler within the code map's 1ms; under 1 MB for the keys and members of a v1 session; a first message's keys under 4 KB with two pilots; and preflight's end on each core within one network delay of the PF's.

The kernel's view of the units' states gains each request's verdict, which the session's slice shows, so the whole bench runs at this stage's close.

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, the session's and the network's scenarios among them; two bench cores host and join, hold both aircraft through preflight, end it on a countdown, pass control, and end the session; in one session in the sim, `Hold` freezes and unfreezes the aircraft, and the menu script takes the core out of Starting; and the [session's log](../session/log.md) has an entry for the cases and budgets.

Done on 2026-10-24.

## 10 Profiles

Builds:

- `profile-engine`: the format's own blocks, `authors`, `aircraft`, `import`, `state`, and `events`, with every name call, every form of `write`, pace, counting into a shadow value, and `ignore` ([a profile](../profiles/01-format-and-delivery.md#a-profile) to [modules](../profiles/01-format-and-delivery.md#modules)); the checker, with each error [what fails a load](../profiles/01-format-and-delivery.md#what-fails-a-load) lists for those blocks, and the one warning a file alone shows, an `ignore` naming a variable a state entry watches; the tables of blocks and fields, each with the level it came in at, which the checker, the schema, and the declarations read; level 1, with its JSON Schema and its declarations generated into `levels/1/`; and `read`, `source`, `check`, `program`, `place`, `write`, a bundle's bytes, and its SHA-256 ([the profile engine](../profiles/02-units.md#the-profile-engine))
- `profile-build`: modules merged, the type check and compile with TypeScript 6.0.3 inside QuickJS-ng, the level worked out, and the bundle read back ([the builder](../profiles/02-units.md#the-builder))
- `tools/profile-builder`: `dualinput-profile-builder`, with `build`, `watch`, and `publish`, which lays out the Pages tree in a folder, adding to what the folder holds, at the levels it's told a release supports ([the builder program](../profiles/02-units.md#the-builder-program), [publishing](../profiles/02-units.md#publishing))
- `profile-loader`: the index fetched with its ETag at each start, and the bundles it lacks; the cache; the local folder, a development setting; the pin, a `PilotFlying` key; the pinned bundle read and checked by a job, then `ProfileLoaded` and `ProfileUnloaded`; the match check's item; and the profiles' address, a development setting over the release's own ([fetching](../profiles/02-units.md#fetching) to [the match check's item](../profiles/02-units.md#the-match-checks-item))
- the first profile, `profiles/aircraft/bksq-baronpro.yaml`, by `Dual Input`, covering the 58P alone, `bksq-aircraft-baronpropress`, with its `authors` and `aircraft` blocks, which stages 14, 17, and 19 fill; the base Baron and the 58TC join it later, a line each in `variants`, with `only` where they differ, such as the mixture (user, 2026-10-24)
- the bench's local profiles' site, which serves the folder `publish` lays out, and which a scenario can hold back, cut, or add a bundle to ([what it touches](02-testing.md#what-it-touches)); and the bench's test unit that stood in for the profile loader keeps only its feature with a slice, a setting, a command, and a panel module, so the clients' scenarios load a profile through the loader
- level 1's JavaScript for write functions: every global the sandbox's context defines, with every member it defines, typed by TypeScript 6.0.3's own library declarations, which `tools/javascript-types.ts` keeps to the list in `src/engines/profile-engine/javascript/sandbox.json` that p03 measured, so a write function gets the whole of the JavaScript the sandbox runs, and one that names what it lacks, such as `Date` or `Math.random`, fails its type check (user, 2026-10-24; [profiles log](../profiles/log.md))
- `tools/check.ts`'s checks of the profiles: building the tree's profiles, and generating level 1's files and its JavaScript again and failing on a difference ([profiles in this repository](../architecture/02-code-map.md#profiles-in-this-repository))

Each feature's module in the profile engine comes with its feature, since no level is released before v1: avatars' `seats`, `location`, and `deadband` in [stage 17](#17-avatars), and pointer sync's `displays`, with their checks, in [stage 19](#19-pointer-sync).
The registration through which a feature's module adds a block or a field of an entry comes with its first user, avatars' module, so its shape fits a real block (user, 2026-10-24).
The warnings only a running sim shows, a name the loaded aircraft doesn't know, a value that changes on its own, and a knob that went round on a `wrap: false` entry, are the IDE's.
Publishing the profiles to their Pages site comes in [stage 22](#22-github), with CI's check that a released level's files match its release tag, since no tag holds a level before v1's release.

Designs first: the profiles' address, which the profiles' units left until the domain's name was set; where the builder gets TypeScript 6.0.3's `typescript.js`, since the root's lockfile holds TypeScript 7.0.2; what the first profile covers; and the bundle the bench measures a load at, the largest we have, while the tree's one profile holds no entries.
The user settled all four on 2026-10-24: `profiles.dualinput.app` ([where the core fetches from](../profiles/02-units.md#where-the-core-fetches-from)), an npm alias that `profile-build` embeds from ([TypeScript 6.0.3 inside QuickJS-ng](../profiles/02-units.md#typescript-603-inside-quickjs-ng)), the 58P alone, as its line above has it, and a fixture of 200 KB, above 1.5 times the size of FS Copilot's largest profile ([budgets](../profiles/02-units.md#budgets)).

Needs: 9.

Tests:

- From [the profiles' cases](../profiles/02-units.md#cases-for-the-bench), on the bench, with two cores, the stand-in sim, the fake pages, and the local profiles' site:
  - The PF's start fetch finishes after the session's aircraft is set: the pin goes from none to the bundle, every core in the flight loads it, and the match check shows it loaded.
  - Control passes before preflight ends to a pilot whose cache holds an older bundle: the pin stays.
  - A member whose cache lacks the pinned bundle fetches it by its hash and loads it, and the match check shows no difference.
  - A member offline whose cache lacks the pin shows "Couldn't get the session's profile", loads nothing, and fetches it when it next enters the flight online.
  - The PF pins a local bundle: a member with the same file loads it, and one without it fetches nothing and shows the error.
  - The session's aircraft changes before preflight ends, and a member enters the new aircraft before the new pin arrives: it loads nothing, then loads the new bundle.
  - A member leaves the flight and comes back: the profile unloads, and the same pin loads again, though the site published a newer bundle meanwhile.
  - A session starts airborne with the PF's cache empty, and the PF's fetch finishes after preflight ended: the pin goes from none to the bundle.
  - A cached bundle whose bytes don't match its name is deleted and fetched again.
  - A job's result arrives after this member left the flight, and is dropped.
  - A replay of a run with a load decodes the recorded profile, reads no file, and loads the same.
- As the builder's own tests, from the same list: a bundle written and read back gives the profile it came from, scripts with blank lines at their ends included; the same files built twice give the same bytes; a profile at a level no release supports isn't published, and is published once a release supports the level; a bundle that fails its level's frozen schema fails; two profiles covering one preset fail; a script using syntax QuickJS-ng can't parse fails the build; and `publish` only adds files to its folder.
- As `profile-engine`'s tests: each error and the warning the engine checks, reported at its file, line, and column.
- From [the session's cases](../session/02-units.md#cases-for-the-bench): the PF loads the wrong aircraft in preflight, then the right one, and the pinned hash follows the aircraft; and a session in an aircraft with no published profile shows the loader's error, while the rest of that case, every feature that needs no profile running, comes with the last of those features.
- [The profiles' budgets](../profiles/02-units.md#budgets): a build of 300 write functions within 2s at one level, in 128 MB, on an 8 MB stack; a load on the loop within a handler's 1ms at the largest bundle we have; and a start with nothing new published costing one answer of headers.

This stage's close runs the whole bench ([working a stage](#working-a-stage)).

Exit: on our development machine, `node tools/check.ts` and the whole `node tools/bench.ts` pass, the profiles' scenarios among them; `dualinput-profile-builder build profiles` builds the tree's profile to the same bytes twice; two bench cores pin a bundle from the local profiles' site, the joiner fetches it by its hash, both load it, and the match check shows it loaded; and the [profiles' log](../profiles/log.md) has an entry for the cases and budgets.
Done on 2026-10-24.

## 11a The apps' wiring

Builds, with the names and behaviors the [interface log](../interface/log.md#2026-10-24-the-apps-wiring-calls-notices-notifications-gives-the-banners-socket-a-slice-of-its-own-and-passes-a-development-cores-data-folder-to-the-desktop-app)'s entry of 2026-10-24 gives (user, 2026-10-24):

- from stage 5, `clients`' parts for the apps alone: the slice `banner`, true while a banner page's socket is open; the command `clients.notification-clicked`, which sends the EFB app the order that opens the EFB onto our app, `{ "t": "open-efb" }` in a `unit` message from `clients`, even when the notification has cleared; and the command `clients.bring-desktop-forward`, which puts out the start of the desktop app's program whether or not a desktop app is connected ([slices and commands](../interface/01-apps.md#slices-and-commands), [notifications](../interface/01-apps.md#notifications), [bringing the desktop app forward](../interface/01-apps.md#bringing-the-desktop-app-forward))
- `src/apps/core`'s edge for that start: `dualinput-desktop.exe` from the core's own folder, with none of the core's standard handles, and with `--data <folder>` from a core on a data folder other than the pilot's ([one program from login](../install/01-installing-and-updating.md#one-program-from-login))
- the message crate's names for them: the components `efb-app` and `banner`, the commands' arguments, and the order's type, `EfbAppOrder`
- notices called notifications, through the message crate, `clients`, and every unit that raises one: the type `Notification`, the slice `notifications`, and `clients::notify` and `clients::clear_notification`
- the bench's fake EFB app and banner ([the sim's pages](02-testing.md#the-sims-pages)); its stand-in desktop app, a program in `tools/bench/desktop-app` that `tools/bench.ts` copies beside the bench's core as `dualinput-desktop.exe`, and which writes each start's arguments to the file `DUALINPUT_BENCH_DESKTOP_APP` names; and a notification the clients' test unit raises

None of it shows anything to a pilot, so it's split from [the apps](#11b-the-apps) and built while the apps' design waits for the user (user, 2026-10-24).

Needs: 9 and 10.

Tests:

- From [the apps' cases](../interface/01-apps.md#cases-for-the-bench), on the bench, with the fake EFB app and banner: a notification clicked outside its action on the banner reaches the EFB app as the order that opens the EFB; and the EFB app's button, with no desktop app connected and with one, starts the desktop app's program, here the stand-in, with the bench core's data folder, and the desktop app gets no message.
- On the bench: the banner's slice follows a fake banner's socket opening and closing.
- As `clients`' own tests: the banner's slice holds from a banner page's `hello` until the core closes its socket 8s after its last message; a click on a notification that has cleared still orders the EFB app; and a command whose arguments don't parse answers an error, and orders or starts nothing.
- As `src/apps/core`'s own test: only a core on a data folder other than the pilot's passes it to the desktop app's program.

The apps' other cases need code this stage doesn't build, and are in the `Tests` lines of the stages that build it, each marked as from stage 11a: the shells' and the EFB app's code in [stage 11b](#11b-the-apps), the desktop app's start of the core in [stage 15](#15-installing-and-updating), `Follow` in [stage 16](#16-flight-model-sync), and rate and pause in [stage 21](#21-rate-and-pause-and-go-to).
Stages 5 and 9 ran the rest: a setting changed and a quit sent from the EFB app's socket, no cockpit panel within 10s of the profile loading, and a module from another build while `Hold` is fed.
The rename, and the EFB app's component name `efb-app`, change six scenarios, `clients-panels`, `clients-protocol`, `clients-outages`, `core-helper`, `network`, and `session`, so the stage closes on them beside its own, `clients-apps`.

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, `clients-apps` and the six scenarios the new names changed among them; and on the bench, a fake banner's click reaches the fake EFB app as the order that opens the EFB, and the fake EFB app's button starts the stand-in desktop app with the bench core's data folder, with a desktop app connected and without.
Done on 2026-10-24.

## 11b The apps

Designs first: the apps' looks and words, from [the apps' list](../interface/01-apps.md#left-to-the-apps-stage) and [installing and updating's](../install/01-installing-and-updating.md#left-to-the-apps-stage).
Builds: the kit our pages draw with, the EFB shell, the desktop shell for the desktop app's own screens, `src/apps/desktop`'s window and Rust side, and `src/sim-package/pages`' EFB app and banner, with every screen a pilot uses Dual Input through in the EFB app ([01-apps](../interface/01-apps.md); [tentative decisions](../interface/decisions.md#dual-inputs-one-full-window-is-its-efb-app)).
It takes out what [stage 11a](#11a-the-apps-wiring) built for the EFB app's button that brought the desktop app forward: `clients`' command for it and the core's start of `dualinput-desktop.exe` with `--data`, with the tests and the bench's pieces that serve only them.
It also extends [the Coherent GT check](01-the-build.md#the-coherent-gt-check) to every CSS file we ship into the sim, passing only what p14 measured the engine keeping ([Coherent GT's JavaScript and CSS](../architecture/coherent-gt.md#css)), with p13's and p14's results as its tests, since the kit our pages in the sim draw with is the first CSS we ship there ([tentative decisions](../interface/decisions.md#the-coherent-gt-check-covers-the-css-we-ship-into-the-sim); user, 2026-10-25).
It moves the Coherent GT check from `tools/coherent-check/` into the repository of its own that [decision 031](../../decisions/031-coherent-gt-check-tool.md) gives it, `dual-input/coherent-checks`, kept private for now, which Dual Input then installs with npm, since msfs-tailwind's test reads the check's data (user, 2026-10-25).
It builds `msfs-tailwind`, a Tailwind 3 preset for Coherent GT as p14 measured it, with p17 as its test, in a private repository of its own, `dual-input/msfs-tailwind`, from its first commit, and Dual Input installs it with npm from GitHub, where npm's lockfile pins the commit, with no tags until Dual Input goes public ([tentative decisions](../interface/decisions.md#tailwind-3-reaches-the-kit-through-msfs-tailwind-a-preset-of-our-own-for-coherent-gt); [interface log](../interface/log.md#2026-10-25-by-p14s-measurements-coherent-gt-keeps-82-of-tailwind-3s-output-with-its-colors-written-as-rgba-and-autoprefixers--webkit--twins-and-every-common-variant-but-focus-visible-and-has); user, 2026-10-25).
It stops the core's log from replacing the bare Windows username, and keeps its replacement of the home folder's path, because a pilot's display name can be the same text as their username, and the log keeps display names, which are Dual Input's and never the Windows account's ([the home folder's path](../recording/01-recording-and-bug-reports.md#the-home-folders-path); user, 2026-10-25).
It adds two top-level keys to the profile format's level 1, which no release has shipped yet: `name`, the aircraft's name as the EFB app's list of supported aircraft shows it, such as "Synaptic A220", and `maturity`, `stable` or `experimental`, which the profile's authors set, since that list tags each aircraft with it ([a profile's top-level keys](../profiles/01-format-and-delivery.md#a-profile); user, 2026-10-26).
It adds each link's round trip, from the transport's `Stats`, to the network's slice of client state, so the EFB app's crew rows show it beside the link's path ([what the pilot sees](../network/02-units.md#what-the-pilot-sees-and-settings); user, 2026-10-26).
It builds the desktop app's [fixed local port](../interface/decisions.md#the-desktop-app-tells-the-efb-app-about-updates-and-the-firewall-over-a-fixed-local-port), which carries the update's state and the firewall rule's to the EFB app, and has the order that opens the EFB carry [where to land](../interface/decisions.md#a-notifications-click-opens-the-efb-app-where-its-explained-or-acted-on).
Each feature's part in the apps comes with that feature's stage.
The bench's frames are the design's reference, and their code carries over only once it's written as the product's: no shortcut of the bench's reaches the apps, so the code stands as the best work we can do (user, 2026-11-01).
Needs: 9, 10, and 11a.

The user checks the stage by hand at these points, and the build goes on from each once they've looked (user, 2026-11-01):

1. The kit, on one page that shows every component in every state.
2. A sample of the EFB app, once what's built holds one of every different kind of thing, such as motion and scrolling, so the whole app isn't built on a bad base.
3. The whole EFB app.

Tests:

- From stage 5: in this stage's session in the sim, with a bench core running beside the real sim's core, the EFB app, the banner, and the menu script connect to the real sim's core, and none to the bench core ([the bench's own cases](02-testing.md#cases-for-the-bench)).
- From stage 11a, from [the apps' cases](../interface/01-apps.md#cases-for-the-bench): a part whose `start` throws leaves the app's other parts running; deleting a feature's folder and its line in each list leaves both apps building, while `tools/map-check.test.ts` already fails a shell that names a feature's module of the message crate; in a flight of a session, the stand-in's toolbar call fails twice, and the EFB app's code calls again until the banner's page connects, and once it's open, a banner closed by its toolbar button stays closed until the next flight; and when the session ends, and on a `bye`, the EFB app's code closes the banner with one call.
- From stage 11a, in this stage's session in the sim: the apps' cases in the sim, and the banner's panel opening, outside a load, within 2s of the EFB app's code first calling the toolbar for it ([the apps' budgets](../interface/01-apps.md#budgets)).

Exit: on our development machine, `node tools/check.ts` and the whole bench pass, which this stage runs because it changes the kernel and the core's edge; three sessions in the sim pass the apps' cases, with the EFB app and the banner connecting only to the real core while a bench core runs beside it ([interface log](../interface/log.md#2026-11-02-a-third-session-in-the-sim-passes-the-heads-a-changed-window-a-cards-click-with-no-core-and-a-joiners-preflight-card)); and the user has looked over the kit, the sample, the whole EFB app, and the desktop app's window.
Done on 2026-11-04.

## 12 The sandbox

Builds: the sandbox, on rquickjs 0.14.0 as `profile-build` is ([plugins and the sandbox](../plugins/01-plugins.md)).
Its time limit counts QuickJS-ng's interrupt checks, and stops a call at the count that lets a write function's endless loop run about 100ms on our development machine, which the [plugins log](../plugins/log.md) records with how long each kind of runaway ran at it ([decision 047](../../decisions/047-sandbox-time-limit-counts-interrupt-checks.md); user, 2026-10-24).
Its context defines exactly the globals and members that `src/engines/profile-engine/javascript/sandbox.json` lists, which a test checks, since level 1 of the profile format types write functions by that list ([stage 10](#10-profiles)).
The context takes QuickJS-ng's `Promise` intrinsic and deletes the `Promise` and `AsyncDisposableStack` globals, since without the intrinsic an async function made QuickJS-ng abort the core when its sandbox was dropped, as [plugins and the sandbox](../plugins/01-plugins.md)'s note of 2026-10-24 has it (user, 2026-10-24).
The sync engine's names, `write()`, and `state` in the context, and what a write function at a limit does to its entry, come with the sync engine in [stage 13](#13-the-sync-engine-and-the-cockpit-stream).

Needs: 1.

Tests:

- From [the sandbox's cases](../plugins/01-plugins.md#cases-for-the-bench), as its own tests, with no core and no sim ([the sandbox's cases](02-testing.md#the-sandboxs-cases)):
  - A recursion that runs until its `RangeError`, called from two depths of the Rust stack, in a run and in a replay, stops at the same depth each time.
  - A run and two replays count the same interrupt checks in each call into JS, one stopped at the time limit among them, which stops at the same tick each time.
  - A call to `Math.random` or `queueMicrotask` fails; and in `profile-build`'s tests, a write function that names `queueMicrotask`, or is async, fails its type check, as one that names `Math.random` does from stage 10.
- From [decision 046](../../decisions/046-sandbox-runtimes-and-limits.md): an endless loop stops at the time limit, which no `catch` or `finally` in the script sees; a runaway allocation stops at 64 MB, of large arrays, of small objects, and in a regex; and after either limit, the next call runs.
- An async function a script makes through `eval`, and `Array.fromAsync`, run to their first `await`, and the sandbox drops without QuickJS-ng aborting.
- By hand, in a release build on our development machine: how long each kind of runaway runs before the time limit stops it.

Exit: on our development machine, `node tools/check.ts` passes, the sandbox's tests among them; in a release build, a write function's endless loop stops at the time limit within 50ms to 200ms; and the [plugins log](../plugins/log.md) has an entry with the count and how long each kind of runaway ran at it.
Done on 2026-10-24.

## 13 The sync engine and the cockpit stream

Builds:

- the message crate's `cockpit` module: a sender, by pilot ID and restart count; the vector clock as data; a cockpit message, with its sender, clock, control value, gap, kind, key, and body; the stream's one channel, with `Replay`, `CatchUpAsk`, and `CatchUp` beside the messages; the `Newest` channel each member's clock goes out on once a second; a kind's constant, with its body's type; the stream's own kind, `CONTROL`; and the stream's slice ([a cockpit message](../sync/05-units.md#a-cockpit-message), [kept messages and a replay](../sync/05-units.md#kept-messages-and-a-replay))
- the message crate's `sync` module, the sync engine's own: a value, an entry's stamp, and the state a catch-up hands over, so deleting state sync leaves the engine building ([tiers](../architecture/02-code-map.md#tiers))
- `sync-engine`: one engine for each loaded profile, with no I/O: the state object, which write functions read as `state`; what each entry watches; writing in each form, a chain's steps at its pace, and a stepping write that counts its own steps; its own echo; the check at 1.5s; write functions, with the names, `write()`, `repeat`, and `every` in the sandbox's context, and a function at a limit stopping its entry on its own machine; events, their tokens, `ignore`, and the input event double-fire filter; shadow values; who sends, and putting back; the conflict rule, with a change the stream still holds; the settle rule; the driven-entry test; and catch-up's order, `give`, and `take` ([the sync engine](../sync/05-units.md#the-sync-engine))
- `cockpit-stream`: kinds, with `hold_newest`, `collapse_in_replay`, and the entry a kind's key names; sending, holding each key's newest value at most 20 times a second, `withdraw`, and `CockpitSent`; applying in causal order, with copies dropped, each message paced by what's left of its gap, capped at 2s, `Unfinished` and `applied`, and queueing while this member is out of the flight or waits for its catch-up's answer; kept messages, each member's clock once a second, and the replay on `LinkUp` with `again`, with its collapse; a change of control's `CONTROL` message and the messages it drops; catch-up's pipeline, its steps, and its exchange; the guard on `TakeControl`; and its slice ([the cockpit stream](../sync/05-units.md#the-cockpit-stream))
- the bench's test unit that stands in for state sync and pointer sync, with a kind of each sort the stream offers and a catch-up step ([its place](02-testing.md#its-place))

From stage 12, it also builds the sync engine's names, `write()`, and `state` in the sandbox's context, and what a write function at a limit does to its entry, which [the sync units](../sync/05-units.md)' note of 2026-10-18 gives.
From stage 10, the sync engine fails a write whose chain's pace doesn't read as one ([pace](../profiles/01-format-and-delivery.md#pace)); the profile engine refuses a `toggle` or stepping write on an event entry; and level 1's declarations refuse a write function's `write()` on a variable with no value ([01-format-and-delivery](../profiles/01-format-and-delivery.md)'s note of 2026-10-25; user, 2026-10-24 and 2026-10-25).
State sync, the feature that joins the engine to the sim, the stream, and the session, comes in [stage 14](#14-state-sync), with its kinds, its catch-up step, the guard on Ready, and its notices.

Needs: 10 and 12.

Tests:

- From [the sync units' cases](../sync/05-units.md#cases-for-the-bench), as the sync engine's own tests, with no core: a knob turned a detent a frame with the reading a frame behind sends nothing back and doesn't overshoot; turning it back through the same values 1s later goes out; a `toggle` over a lamp that lights 2s late flips once, is flagged, and doesn't flip again; a write function that checks for power and writes nothing is flagged, live and in catch-up's burst behind the battery; a value written as 165 and read as 165.000002 isn't flagged; two pilots changing one shared entry within 50ms, and again while one's change is still held, end on one value; catch-up writes the battery before the APU master, and ends at its last write once settled; Ready to fly 20s after the load, with switches restored 5s after it, leaves the aircraft unsettled until 30s after `RTC_END`, and nothing goes out before preflight ends; a restarted core is settled at once, and its shadows take the flying machine's values; an entry the aircraft changes every 3s on both machines stops syncing within 30s; the PM's throttle is put back at once, sends nothing, and flags nothing while it moves for 3s; an event entry that watches an `H:` event and writes an input event doesn't send back the `H:` event its write fires, and stops when that event comes 2s late; a write function stuck in a loop stops its entry; an input event reported twice a frame apart goes out once, and twice when 261ms apart or at 4 fps; and a token nothing uses expires after 1s.
- From the same cases, as the cockpit stream's own tests of its order, with three machines and no core: B's press waits at C until A's page key has applied, since the bench can't hold back one pair of cores alone without a relay for each.
- From the same cases, on the bench, with two cores, or three where a third is named, and the test unit in state sync's and pointer sync's place: a lever changed 60 times a second goes out at most 20 times a second, its last value before the press after it; a 60s cut replays at the gaps the sender left, collapses a run of the pilot flying's changes, and denies take-control until the replay ends; a takeover during a cut drops the old pilot flying's solo changes on every core, and the ex-pilot flying catches up from the new one; a late joiner asks, the pilot flying answers, the queued copies drop, and the catch-up ends at its last write once settled; an ask that reaches the pilot flying before its step can give is answered once it can; a link lost between an ask and its answer has the ask made again when it's back; control passing between two others during a catch-up, with three cores, has the catching-up core ask the new pilot flying and drop the old one's answer; a pilot flying who leaves the flight during the other's replay sends its `CONTROL`, and the replay ends with nothing dropped; and a member whose aircraft has no profile applies `CONTROL`, ends its replay, and may take control.
- From stage 7: a core suspended for 60s comes back with the cockpit stream's replay ([02-units' cases](../network/02-units.md#cases-for-the-bench)).
- From stage 9: the cockpit stream's guard on control, in the cases above.
- [The sync units' budgets](../sync/05-units.md#budgets): kept messages under 4 MB for a 30-minute cut at 20 changes a second, from a message's encoded size; a catch-up's answer under 64 KB for 500 entries; and by hand, in a release build, an engine call within the code map's 1ms and 300 write functions compiled within 10ms.

The sync units' other cases need state sync's calls of the stand-in sim or a display's panel, and come with [state sync](#14-state-sync) and [pointer sync](#19-pointer-sync); the cases in the sim all need state sync, so this stage has no session in the sim.
The stage changes nothing every scenario runs on, so it closes on the scenarios the cockpit stream reaches, the seven that hold a session, since the stream acts only in one: `cockpit`, `network`, `network-loss`, `network-outages`, `network-relays`, `profiles`, and `session` (user, 2026-10-24).

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, the sync engine's and the cockpit stream's tests and the seven scenarios that hold a session among them; two bench cores replay a cut in order and catch a late joiner up from the pilot flying; and the [sync log](../sync/log.md) has an entry for the cases and budgets.
Done on 2026-10-25.

## 14 State sync

Builds: the state sync feature, its routine `NamedEvents`, its panel modules `h-events` and `instrument-reads`, its parts in the apps, and the Baron 58P profile's `state` and `events` blocks ([the sync units](../sync/05-units.md), [reading it in the panel](../plugins/01-plugins.md#reading-it-in-the-panel)).
From stage 4, it also builds the sim service's `listen` and `input`, with `sim-client`'s `B:` names; the routine host's `H:` events and input event presets; and the stand-in's answers to each, with the rules a scenario scripts for its aircraft's own behavior ([what a feature calls](../core/03-sim-seam-and-wasm-module.md#what-a-feature-calls), [the sim client](../core/03-sim-seam-and-wasm-module.md#the-sim-client), [what a routine can ask for](../architecture/02-code-map.md#what-a-routine-can-ask-for), [what it models](02-testing.md#what-it-models)).
It ends with the first session in the sim, with a bench core as the second pilot ([how the stages are ordered](#how-the-stages-are-ordered)).

Designs first: how a write that names an input event's preset reaches the sim, settled in the [sync log](../sync/log.md#2026-11-09-writes-to-input-events-go-through-our-wasm-module-since-simconnects-list-has-none-of-their-presets) (user, 2026-11-09).

Needs: 11b and 13.

Tests:

- From [the sync units' cases](../sync/05-units.md#cases-for-the-bench) that need state sync's calls of the stand-in sim or a display's panel, on the bench with two cores, in a scenario of their own: a switch flipped on one core's aircraft moves on the other's, and nothing comes back; an input event read once and then by its subscription, and written; a `K:` event heard through `listen`, and our own send of it using up its token; an `H:` event fired through `HEvents` and heard in one panel; an `instrument()` value read in its panel and written through `H:` events; a pulse set and cleared within one frame, which never fires its event entry; a press on a display that sets a variable the profile also syncs, the variable's change reaching the core before the press; a `toggle` over a lamp the stand-in lights 2s late, which shows one notification; Ready denied until 30s after `RTC_END`; and a late joiner's catch-up onto the stand-in's aircraft, the battery before the APU master.
- [The sync units' cases in the sim](../sync/05-units.md#cases-for-the-bench), in this stage's session.
- From stage 3: [the loop under load](02-testing.md#the-loop-under-load) again, by hand, with the stand-in's sim inputs and state sync's write functions in place of the test unit's stand-ins for them, beside MSFS flying the iniBuilds A350, reading the queue at p99 against 11.2ms (user, 2026-10-25).
- In this stage's session in the sim: the real core's loop stats after the 58P flight, its slowest inputs and its queue at p99 against 11.2ms, beside the real sim (user, 2026-10-25).
- From stage 4, in this stage's session in the sim: a group on one connection keeps hearing an event while a group on another is cleared ([a connection for each feature](../architecture/02-code-map.md#a-connection-for-each-feature-for-each-load)).
- From stage 19, in this stage's session in the sim: [pointer sync's cases in the sim](../pointer-sync/01-pointer-sync.md#cases-for-the-bench), the A220's ND with a local profile that names its `DisplayUnits`.
- From stage 20, with a pilot at the hardware for this stage's session, and no sim: a bound button crosses with another program in front, with `node tools/sim/core-helper.ts person 3` ([take-control's cases](../control/01-take-control.md#cases-for-the-bench)).

Exit: on our development machine, `node tools/check.ts` and the whole of `node tools/bench.ts` pass, since stage 17 left the full bench to this stage; in a session in the sim in the 58P, with a bench core as the second pilot, a switch flipped in the sim moves on the bench core's aircraft, and one the bench core flips moves in the sim's cockpit; and the [sync log](../sync/log.md) has an entry for the cases in the sim and the loop's stats.
Done on 2026-11-10: the whole bench ran once and passed 147 of 149 scenarios, the two failures being panel scenarios that predated the 58P profile's `H:` and `instrument()` entries; those two and the scenarios the code review's fixes reach, 109 in all, then passed, and `node tools/check.ts` passed after the fixes ([sync log](../sync/log.md#2026-11-10-stage-14s-code-review-found-a-catch-up-answered-with-no-values-a-preset-fired-again-after-a-gap-and-a-stream-stalled-by-an-unload)).

## 15 Installing and updating

Builds: the desktop app's tray icon and its jobs, the installer and updates through Velopack, packed on our development machine, the firewall rule, and writing our package ([installing and updating](../install/01-installing-and-updating.md)).
From stage 4, the release's folder also holds the C++ runtime's three DLLs that `SimConnect.dll` imports ([the build](01-the-build.md)), and the desktop app copies our package as [installing and updating](../install/01-installing-and-updating.md)'s note of 2026-10-21 has it.
The release workflow comes in [stage 22](#22-github).
The desktop app's `messages::HASH` covers the root's `Cargo.lock`, not the one it compiled with, since `src/engines/messages/build.rs` looks for the lock upward from itself, so before this stage gives the app a socket to the core, `tools/check.ts` fails when the two locks give the message crate different package versions ([the message crate's hash](01-the-build.md#the-message-crates-hash); user, 2026-11-10).
From stage 11b, it has Velopack's first run open the welcome; hands a second start's request to the running app, since until then a second start makes a second tray icon and a second writer to the usage file; has Quit anyway send the session crate's Quit before the app exits; and counts what the app downloads in its usage samples' `network`, with an `update-downloaded` line for each update.
While the sim runs, automatic checks go on and an automatic download waits for the sim to close, and Check now or Install downloads at once, which adds a state to the local port's `Update`, available and not downloaded (user, 2026-11-03).

Designs first:

- The first run's welcome, which should be nicer than stage 11b left it, a heading, one line, and Dismiss, since it's the first thing a pilot sees of Dual Input (user, 2026-11-04).
- The words for an update that's available and not downloaded, in the EFB app's Settings tab and the desktop app's window.
- The splash image Setup.exe shows over its progress bar ([the desktop app's screens](../interface/decisions.md#the-desktop-app-shows-velopacks-windows-and-its-own-figures-and-the-build-designs-the-rest)).
- How `messages::HASH` holds for the desktop app, whose own `Cargo.lock` the message crate's build script never reads.

Needs: 3 and 11b.

Tests:

- From stage 2: a whole unit's handler panics, the process exits with a code other than 0, the desktop app starts it again, the pilot comes back as a late joiner, and the replay panics at the same input; and the core exits on its own, with 0, and the desktop app doesn't start it again ([01-loop-and-edge's cases](../core/01-loop-and-edge.md#cases-for-the-bench)).
- From stage 3: a bench core killed under the desktop app comes back as a bench core, with its own data folder ([the bench's own cases](02-testing.md#cases-for-the-bench)).
- From stage 11a: the core killed while the sim runs, which the desktop app starts again 2s after it exits, and after an exit with 0, starts none until the sim next starts ([the apps' cases](../interface/01-apps.md#cases-for-the-bench), [the sim and the core](../install/01-installing-and-updating.md#the-sim-and-the-core)).
- [Installing and updating's cases for the bench](../install/01-installing-and-updating.md#cases-for-the-bench), in three groups (user, 2026-11-10):
  - those that need no Setup.exe, Update.exe, or uninstall: on the bench, with a stub named `FlightSimulator2024.exe` for the sim's process and the desktop app beside a bench build of the core named `dualinput-core.exe` ([what it runs](02-testing.md#what-it-runs));
  - those that need one and no session: on our development machine, from releases this stage packs, since CI's runner waits for [stage 22](#22-github);
  - those that need a session: in [stage 16](#16-flight-model-sync)'s first flight with friends, and three of them in [stage 23](#23-v1s-release)'s sessions with friends.

  The case of a window that holds a core is left out, since an open window keeps no core running, as [installing and updating](../install/01-installing-and-updating.md)'s first note has it.
- [Its cases on a desk](../install/01-installing-and-updating.md#cases-on-a-desk) on our development machine, but for Windows 10 without WebView2, which needs a PC we don't have, and deltas through `GithubSource`, which need two releases from the release workflow, in [stage 23](#23-v1s-release).
- [Its cases in the sim](../install/01-installing-and-updating.md#cases-in-the-sim) in one session, but for a fresh install of the sim and the Store edition, which need a pilot's PC, and Windows' firewall prompt, which needs a session and goes to stage 16.
- The EFB app's Install and restart, in the same session: the desktop app closes the sim, installs, and starts the sim again, which no run had done ([the fixed local port](../interface/decisions.md#the-desktop-app-tells-the-efb-app-about-updates-and-the-firewall-over-a-fixed-local-port)).
- [Its budgets](../install/01-installing-and-updating.md#budgets), on the bench but for the update's, which runs with the release cases.

Exit: on our development machine, `node tools/check.ts` and the whole `node tools/bench.ts` pass, the desktop app's scenarios among them; a release this stage packs installs from its Setup.exe with no administrator prompt, opens the welcome, adds the firewall rule through one UAC prompt, writes our package into Community, and comes back as a tray icon at the next sign-in; a newer release packed beside it downloads, waits while the sim runs, and applies once it closes, the new app starting as a tray icon; Install and restart in the EFB app updates and starts the sim again; and the [installing log](../install/log.md) has an entry for the cases and budgets.

Done on 2026-11-11: the releases passed every case without a session on our development machine ([installing log](../install/log.md#2026-11-10-a-release-installs-with-one-uac-prompt-and-updates-within-3s-of-the-sims-process-ending-but-the-welcome-took-the-prompt-for-declined-before-the-pilot-answered-it)), `node tools/check.ts` passed after the code review's fixes, and the whole bench ran once and passed 155 of 157 tests, the two failures being the desktop app's: a panic case whose wait raced the bench's socket, which passed once it waited on the core's log, and the CPU budget at 0.234% of a core, which read 0.130% and 0.182% in the scenario's runs alone ([installing log](../install/log.md#2026-11-11-the-whole-bench-passed-155-of-157-tests-at-stage-15s-close-and-the-desktop-apps-cpu-over-a-minute-ranged-0130-to-0234-of-a-core-across-three-runs)); those were whole clock ticks, and read from cycles the app used 0.139% to 0.154% ([installing log](../install/log.md#2026-11-11-the-bench-read-the-desktop-apps-cpu-in-whole-156ms-clock-ticks-read-from-cycles-the-app-uses-014-to-015-of-a-core)).

## 16 Flight-model sync

Builds:

- the message crate's `flight_model` module: the sample and its channel, `SAMPLES`, one-off packets of which only the newest waits, handed over after the heartbeat's and before avatars' poses; `PERIOD`, the 50ms between reports; the routines `LEAD` and `FOLLOW`; and in its `slots.rs`, the snapshot, `Lead`'s report, and `Follow`'s slot ([the sample](../flight-model/01-flight-model-sync.md#the-sample))
- `src/features/flight-model/core`: on the flying machine, `Lead` fed and its reports asked for, each report sent to the crew as a sample, and the last sample sent again every 50ms through a pause; on a following machine, each sample taken or dropped, the PF's clock offset taken at `Follow`'s start and moved by at most 5ms a second after it, and `Follow` fed each sample on this core's counter, with the delay; and each routine started and ended on `FlightChanged`, `ControlPassed`, and `SessionEnded` ([the flying machine](../flight-model/01-flight-model-sync.md#the-flying-machine), [taking a sample](../flight-model/01-flight-model-sync.md#taking-a-sample), [when each routine runs](../flight-model/01-flight-model-sync.md#when-each-routine-runs))
- `src/features/flight-model/routines`: `Lead`, which reads the snapshot in the first frame at or past each 50ms mark; and `Follow`, which freezes the aircraft, draws it 400ms behind along straight lines between samples, carries it for up to 2s through a gap and then holds it, eases a correction away over 3s, writes at once a correction over 1km, starts from its aircraft's own motion, writes the pose and both velocities each frame, and sends the five axis events ([drawing](../flight-model/01-flight-model-sync.md#drawing), [through a gap](../flight-model/01-flight-model-sync.md#through-a-gap), [its first frames](../flight-model/01-flight-model-sync.md#its-first-frames))

From stage 4, it also builds the sim service's `reports`, which a second call for the same routine moves to its new handle; the routine host's writes on the pilot's aircraft, its events with values, its reports, each routine's report slot, and its reads of `E:` variables, which `Follow` needs for `E:SIMULATION RATE`; the module's edge for each, through `fsEventsTriggerKeyEvent`, `SimConnect_SetClientData`, and `fsVarsEVarGet`; and the stand-in's answers to each, with its aircraft moving by its velocities ([what a feature calls](../core/03-sim-seam-and-wasm-module.md#what-a-feature-calls), [what a routine can ask for](../architecture/02-code-map.md#what-a-routine-can-ask-for), [what this adds to our WASM module](../flight-model/01-flight-model-sync.md#what-this-adds-to-our-wasm-module), [what it models](02-testing.md#what-it-models)).
Flight-model sync loads no profile, but the platform ends every feature's routines when a profile unloads.
v1 unloads one only as its pilot leaves the flight or the session ends, when flight-model sync ends its routine anyway, since no pin changes while a pilot stays in the flight ([the pin](../profiles/02-units.md#the-pin), [a connection for each feature](../architecture/02-code-map.md#a-connection-for-each-feature-for-each-load)).
It ends with the first flight with friends, which needs state sync and the installer too ([how the stages are ordered](#how-the-stages-are-ordered)).

Needs: 4, 9, 14, and 15.

Tests:

- From [flight-model sync's cases](../flight-model/01-flight-model-sync.md#cases-for-the-bench), as the routines' and the routine host's own tests, on a clock the test steps and samples it feeds: at 30 fps and at 89 fps, `Lead` reports 20 times a second on average; with the module's clock 12s behind the core's counter and write delays drawn from 2026-10-09's round trips, the routine host's offset settles within its budget, keeps it through a flight load with no header, and holds through a 2-hour run; one lost sample is neither carried nor eased; the 2s move to the relay is carried, then eased; a 20s gap is carried 2s, then held, frozen throughout, and written at once when samples return more than 1km on; a paused PF's repeated samples hold the aircraft, and the first report after the pause is taken; a joiner whose PF is 50km away is written at once at the first drawn pose, and one 10m away eases over 3s; at a handover the ex-PF's aircraft flies on, eases back, and never stops or jumps; and at a simulation rate of 2 it carries on at the speed it flew.
- From the same, as the feature's own tests: a 30ms step in the network's offset reaches the applied offset within 6s, 5ms a second at most; and a sample from a sender who isn't the PF, from a new PF before the key, with an old stamp, or before the link's first offset is dropped.
- From the same, on the bench, with two cores, or three where a third is named, in a scenario of their own, `flight-model`, which follows each stand-in's aircraft frame by frame: a report the stand-in delivers 193ms late leaves the following aircraft's path where it was; a relay cut for 2s is carried and eased with no jump; one cut for 20s is carried 2s, then held, frozen throughout, and written at once when samples return; a PF in the pause menu, the stand-in's module updating or not, has the following aircraft hold, and it moves on after the pause; a sample while this pilot is out of the flight is dropped; at a handover the ex-PF's aircraft flies on, eases back, and never stops or jumps; with three cores, across a change of PF, the third machine takes the new PF's samples; and a joiner 30km from its PF is written at once, and one at the PF's stand 10m away eases over 3s.
- From [the code map's cases for work in the sim](../architecture/02-code-map.md#cases-for-the-bench-for-work-in-the-sim), in the same scenario: when a pilot takes control, their aircraft unfreezes as `Follow`'s end mark arrives, flies on from the velocities last written, and is still flying 5s later; and when preflight's hold ends while `Follow` runs, the aircraft stays frozen through it.
  The case of a killed core stays the routine host's own test, which stage 4 wrote, a routine left unfed for 1s lifting its freeze, since a bench core's stand-in runs in the core's process and ends with it.
- From this stage, in the same scenario: a pilot who leaves the flight has an aircraft nothing freezes, and a restarted core is frozen and drawn again.
- From stage 17, in the `avatars` scenario: a following machine's yoke moved through `Follow`'s events keeps the PF's hand on its horn ([01-avatars' cases](../avatars/01-avatars.md#cases-for-the-bench)).
- [Flight-model sync's budgets](../flight-model/01-flight-model-sync.md#budgets): a sample's size in postcard and the samples' rate, on the bench; and the routine host's offset, in the routine host's test above and in this stage's session in the sim.
- [Flight-model sync's cases in the sim](../flight-model/01-flight-model-sync.md#cases-for-the-bench), in this stage's session, in the 58P, with a bench core as the second pilot, whose stand-in aircraft the 58P follows.
- [Flight-model sync's cases with friends](../flight-model/01-flight-model-sync.md#cases-for-the-bench), in the first flight with friends.
- From this stage's session in the sim, in the first flight with friends: with the autopilot engaged, the following aircraft's axis events leave it engaged, which the session couldn't tell, since the 58P caught up from the stand-in's cockpit, which has none engaged ([flight-model log](../flight-model/log.md#2026-11-11-seated-on-the-pose-follow-says-it-writes-a-figure-keeps-its-seat-on-the-following-machine-and-the-58p-banks-and-pitches-with-the-aircraft-it-follows)).
- From stage 4, in this stage's session in the sim: `fsVarsAVarSet` holds the pilot's own aircraft's pose; through a second flight load in one run of the sim, `Follow` starts new at its first feed ([03's cases](../core/03-sim-seam-and-wasm-module.md#cases-for-the-bench)); and our module's update, every routine's frame and the routine host's work together, takes under 0.1ms a frame at p99 ([budgets for work in the sim](../architecture/02-code-map.md#budgets-for-work-in-the-sim)).
- From stage 11a, on the bench: a restarted core with `Follow` fed, and whether the trouble notification for our package shows before the module's first status write ([the apps' cases](../interface/01-apps.md#cases-for-the-bench)).
- From stage 15, in the first flight with friends, from releases on both PCs: two of [installing and updating's cases](../install/01-installing-and-updating.md#cases-for-the-bench) that need a session, the tray's Quit in a session and a session holding a downloaded update, the other three going to [stage 22](#22-github) (user, 2026-11-12); and [in the sim](../install/01-installing-and-updating.md#cases-in-the-sim), whether the core's UDP socket raises Windows' firewall prompt on a PC with no rule naming it, and if the pilot cancels it, whether the desktop app's fix deletes the block rules Windows adds, since the core binds that socket only as a session opens ([install log](../install/log.md#2026-11-10-a-release-installs-with-one-uac-prompt-and-updates-within-3s-of-the-sims-process-ending-but-the-welcome-took-the-prompt-for-declined-before-the-pilot-answered-it)).
- From stage 19, in the first flight with friends: [pointer sync's cases with friends](../pointer-sync/01-pointer-sync.md#cases-for-the-bench), whether the two PCs give a display the same rect, and whether a drag looks smooth over a relayed link.
- From stage 17, in this stage's session in the sim: whether an overlay such as Steam's would swallow every click if the core helper checked the window under the cursor, the check that would keep a click on another program's window over the sim's view from bringing a hand ([avatars' known limits](../avatars/01-avatars.md#known-limits)).
- From stage 14, in the first flight with friends: a write through a `_Set` preset with a value, the Baron 58P's `B:LANDING_GEAR_ParkingBrake_Set`, since stage 14's session wrote only `_Toggle` presets, and this stage's session in the sim can't make the case, its second pilot's stand-in running no preset ([flight-model log](../flight-model/log.md#2026-11-11-seated-on-the-pose-follow-says-it-writes-a-figure-keeps-its-seat-on-the-following-machine-and-the-58p-banks-and-pitches-with-the-aircraft-it-follows); [sync log](../sync/log.md#2026-11-10-stage-14s-code-review-found-a-catch-up-answered-with-no-values-a-preset-fired-again-after-a-gap-and-a-stream-stalled-by-an-unload)).
- From stage 17, in this stage's session in the sim: `Figure` timed again beside `Lead` and `Follow` with `experiments/areas/avatars/p29-sim-session/update-timer.patch`, since they share the module's 0.1ms and stage 17 measured the module's update at 127µs to 146µs at p99 with two figures ([avatars log](../avatars/log.md#2026-11-05-a-click-that-took-the-focus-from-the-sim-left-a-figures-hand-out-and-the-rest-of-the-session-passed)).
- From stage 17, in this stage's session in the sim, which flies a following machine: no part of the figure skips a frame in flight, on the flying machine and on a following one, and whether a following machine's `A:YOKE X POSITION WITH AP LINEAR` and `A:YOKE Y POSITION WITH AP` move with `Follow`'s axis events ([01-avatars' cases](../avatars/01-avatars.md#cases-for-the-bench)).

The stage's routines run in every scenario that holds a session in a flight, so it closes on those scenarios and its own, not on the whole bench, which stage 15 ran.

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, the routines' tests and the `flight-model` scenario among them; on the bench, one core's stand-in aircraft, moving by its velocities, moves on the other core's stand-in 400ms behind it, and after a take-control the two swap; in this stage's session in the sim, the 58P follows the bench core's aircraft through a turn with its yoke moving, and the bench core's aircraft follows the 58P; in the first flight with friends, two pilots on two PCs, each on an installed release, fly one 58P, each taking control in turn; and the [flight-model log](../flight-model/log.md) has an entry for the cases and budgets.
Done on 2026-11-12: the flight left two findings to work of their own (user, 2026-11-12), a following pilot's camera read 1m to 3m behind their seat in flight, so the crew sees them as a head in the cabin ([avatars log](../avatars/log.md#2026-11-12-on-a-following-machine-in-flight-the-camera-reads-1m-to-3m-behind-the-pilots-seat-so-the-crew-sees-that-pilot-as-a-head-in-the-cabin)), and 14 of state sync's writes that read another value 1.5s later, the elevator trim and autopilot modes on a following machine among them ([sync log](../sync/log.md#2026-11-12-in-the-first-flight-with-friends-14-of-state-syncs-writes-read-another-value-15s-later-11-on-the-following-machine-the-elevator-trim-and-autopilot-modes-among-them)).

## 17 Avatars

Builds:

- the message crate's `avatars` module: the pose, with its body and two hands, on a `Newest` channel keyed by its sender; and the routine `FIGURE` with `Figure`'s slot, holding each yoke's grips and animations, and for each figure its object, its seat's hip, knees, feet, and facing, its color, what of it shows, whether it slumps, whether it's this pilot's own, and its pose, within 8,192 bytes ([the pose](../avatars/01-avatars.md#the-pose), [feeding `Figure`](../avatars/01-avatars.md#feeding-figure))
- `msfs-gltf`, `msfs-rpn`, and `ray-cast`, our own engines on the engines' bottom line, and `aircraft-model` on them, with `quick-xml` 0.42: the files from the preset's `aircraft.cfg` and `model.cfg` to the largest LOD and the behavior XML with what it includes; the model, built in avatars' job and handed up as one flat buffer the loop reads in place; posing from the code whose variables changed; casting, past hidden nodes and invisible materials; and each yoke's grips and animations ([the aircraft model](../avatars/01-avatars.md#the-aircraft-model), [a hand on a yoke](../avatars/01-avatars.md#a-hand-on-a-yoke))
- `avatars`: what it registers; the pose sent at most every 33ms and at least every 1s while its pilot is in the flight, and the newest kept of each sender's; the seat taken, held, given up to the PF or the lower pilot ID, and seen held; inside or outside, the head, and on foot; the mouse on at `ProfileLoaded` and off at `ProfileUnloaded`; the ray, by `SIMOBJECT` in the aircraft and `WORLD` on foot; which hand and its target, with the drag, the right press, the wheel, going home, and the yoke at rest; the reach for a located change, its 100ms, and `deadband`; colors; the figures it creates, freezes, and draws in each state; its settings and notifications; the model's job, and a machine that can't read the models, with its match-check item at the session crate's new level, `info` ([avatars log](../avatars/log.md#2026-10-25-stage-17-settles-five-items-01-avatars-left-open-a-run-of-its-own-the-seat-in-the-pose-an-info-item-for-a-model-a-machine-cant-read-vr-as-a-known-limit-and-an-eye-on-what-the-figure-costs)); and the edge's job that reads a file and the files it names, which the model's job takes ([01-avatars](../avatars/01-avatars.md), from [what it registers](../avatars/01-avatars.md#what-it-registers) to [a machine that can't read the models](../avatars/01-avatars.md#a-machine-that-cant-read-the-models))
- `avatars-routines`: `Figure`, which eases each hand and the head, holds a grip on this machine's own yoke, solves each figure's 27 joints, walks it and runs it on foot, and places each figure through the aircraft's pose led by 1 frame and WGS 84's radii, or this pilot's own on foot on their avatar, changing and writing a joint only when it moved past what shows ([`Figure`, each frame](../avatars/01-avatars.md#figure-each-frame), [drawing on arrival](../avatars/01-avatars.md#drawing-on-arrival))
- the figure's SimObject in `src/features/avatars/figure/`, `DUALINPUT_FIGURE_PILOT`, with its LODs: its generator and source, what `fspackagetool` compiled from it in `compiled/` with `source.json`, the procedure and script for the recompile, `tools/build.ts` laying it out in our package, and `tools/check.ts`'s check of the sources' hashes ([names](../avatars/01-avatars.md#names), [files compiled with the sim](01-the-build.md#files-compiled-with-the-sim))
- `tools/profile-author`, with `seats` and `locations` ([the authoring tool](../avatars/01-avatars.md#the-authoring-tool)), and the Baron 58P profile's `seats`, which its `seats` writes
- avatars' part of the EFB app, the Figures tab, with its slice for the note at its top and its four switches ([the Figures tab](../interface/decisions.md#the-figures-tab-holds-the-pilots-figure-and-explains-what-its-figures-can-do)); and each member's color in their session entry, rewritten when their name or color changes, which heads and figures both read ([session log](../session/log.md#2026-11-04-a-members-entry-is-rewritten-on-a-change-so-a-new-name-or-color-reaches-the-crew-at-once-and-the-color-moves-to-the-session))
- `tools/figure-viewer`, a page that draws the figure from its source in the 58P's own geometry, posed by `Figure`'s own code over scripted walks, runs, crouches, reaches, and grips, so its look is tuned by eye off the sim before the session in the sim (user, 2026-10-25)
- the bench's avatars scenarios, the stand-in's camera and avatar on foot that a scenario moves, and an aircraft package of our own as the model job's fixture, since the 58P's files can't be in the tree

From stage 10, it also builds the profile engine's registration through which a feature's module adds a block or a field of an entry, with its checks, its lines in a bundle, its schema, and its declarations, and avatars' module, `seats`, `location`, and `deadband`, through it ([the profile engine](../profiles/02-units.md#the-profile-engine), [seats](../profiles/01-format-and-delivery.md#seats), [state entries](../profiles/01-format-and-delivery.md#state-entries)).
From stage 4, it also builds the sim service's `create_ai`, `remove`, `camera`, and `frames`, and a `watch` and a `key` on an object by its ID; the routine host's reads of named variables, its writes on an object by its ID, `Z:` ones among them, and its lookups made again after a `RESET`; the module's edge for each, through `fsVars`; and the stand-in's answers to each, with its objects, and its faults for a create whose title the sim lacks and for several `Frame` events in one read ([what a feature calls](../core/03-sim-seam-and-wasm-module.md#what-a-feature-calls), [wants and the sim's APIs](../core/03-sim-seam-and-wasm-module.md#wants-and-the-sims-apis), [what a routine can ask for](../architecture/02-code-map.md#what-a-routine-can-ask-for), [what it models](02-testing.md#what-it-models)).
Stage 16 comes after this one, so it builds the routine host's writes on the pilot's aircraft, events with values, and reports.
The platform ends each feature's routines and closes its connection when the profile unloads, which avatars is the first feature to need ([a connection for each feature](../architecture/02-code-map.md#a-connection-for-each-feature-for-each-load)).

Needs: 6, 10, and 13.

Tests:

- From [01-avatars' cases](../avatars/01-avatars.md#cases-for-the-bench), on the bench, with two cores, the stand-in sim, a stand-in core helper, and the routine host built natively, every case but the one that needs `Follow`, which comes with [stage 16](#16-flight-model-sync).
- As the engines' own tests, on the fixture: every MSFS vertex layout read, and one the reader doesn't name refused; macros and template parameters expanded, and each word of the code run against the value the SDK documents; a cast that meets the nearest hit through each node's transform, and passes hidden nodes and invisible materials; and the fixture's yoke grips found.
  By hand, on the installed 58P: the share of its animation and visibility codes that compile, against the probes' 310 of 406, and its grips found where p25's sat.
- As `profile-engine`'s tests: each error avatars' module adds, at its file, line, and column, and a feature's field above a level failing as the format's own does.
- From stage 4: after a `RESET`, `Figure`'s `Z:` writes still land ([03's cases](../core/03-sim-seam-and-wasm-module.md#cases-for-the-bench)); several `Frame` events in one read each reach the loop as an input of its own, and an AI create whose title the sim lacks has its exception reach the call ([the code map's cases](../architecture/02-code-map.md#cases-for-the-bench)).
- From the build's cases on a desk: a figure source changed without a recompile fails `tools/check.ts` ([cases for the bench](01-the-build.md#cases-for-the-bench)).
- [01-avatars' budgets](../avatars/01-avatars.md#budgets), on our development machine with the installed 58P: a cast, its posing included, within 0.5ms at p99; the model's job within 2s; the model under 60 MB; and taking it on the loop within 1ms.
  And the 58P's model as a recording keeps it at each load, with zstd, which sets the figure [the recording's budgets](../recording/01-recording-and-bug-reports.md#budgets) leave to this stage.
- The figure's triangles, nodes, and materials at each of its levels of detail, which its generator prints, against a budget this stage sets from the viewer's look.
- In this stage's session in the sim: from [the build's cases](01-the-build.md#cases-for-the-bench), our figure spawns from our `PANEL_PATCH` package; from stage 4, closing a connection removes the AI objects it created, as killing its client did ([a connection for each feature](../architecture/02-code-map.md#a-connection-for-each-feature-for-each-load)); from 01-avatars' cases in the sim, whether the figure's material fades, whether a click passes through the pilot's own figure, whether the 58P's yoke buttons are nodes below `Yoke_L` and `Yoke_R`, whether a frame maps to a glTF animation's time as the SDK documents, and whether the interior model's bounding box tells the 58P's chase view from a walk down its cabin; and the budgets in the sim, `Figure` within the module's 0.1ms a frame at p99 with two figures, and each figure's frame time against p28's.
- From 01-avatars' cases in the sim, in [stage 16](#16-flight-model-sync)'s session, which flies a following machine: no part of the figure skips a frame in flight, on the flying machine and on a following one, and whether a following machine's `A:YOKE X POSITION WITH AP LINEAR` and `A:YOKE Y POSITION WITH AP` move with `Follow`'s axis events.

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, the engines' and avatars' tests and its scenarios among them; on the bench, a left tap by one core's pilot moves its figure's hand on the other core's stand-in, and a camera moved between the seats takes the nearer seat; in this stage's session in the sim, our figure sits in the 58P's seats from its profile, reaches where the pilot clicks, and walks and crouches as the user approved by eye; and the [avatars log](../avatars/log.md) has an entry for the cases and budgets.
Done on 2026-11-05: `node tools/check.ts` passed on the tree rebased onto take-control, and the bench's avatars and session scenarios passed before the session's last changes ([avatars log](../avatars/log.md#2026-11-05-the-session-in-the-sim-the-figure-spawns-and-sits-the-sim-sizes-it-by-its-257m-at-rest-sphere-and-a-pilot-on-foot-read-as-seated)); the full bench on that tree waits for the next stage's run, which fixes what it finds (user, 2026-11-05).

Left for a later pass on the figure, outside this Exit (user, 2026-11-05): the visual issues in its walk, run, and crouch, translucent arms and hands for a pilot's own figure, with its arms hidden if that fails, and how a pilot's own figure looks on foot, where it runs a frame behind their avatar and the camera cuts its chest ball open.

## 18 Traffic and ATC audio

Builds, as [traffic and ATC](../traffic-atc/01-traffic-and-atc.md)'s four notes have them:

- the message crate's `traffic` module: the traffic host's key; the identities' stream and the states' channel, with an identity, a batch, and a state at FS Copilot's precision, the four flap surfaces as a byte of percent each; `Traffic`'s slot; the slice of the two counts and this PC's traffic packs; and `LIST_PACKS` ([what goes out](../traffic-atc/01-traffic-and-atc.md#what-goes-out), [names](../traffic-atc/01-traffic-and-atc.md#names))
- the message crate's `atc_audio` module: the ATC host's key, the frames' channel and its frame, the ATC app and ATC volume settings, and the slice of what the capture takes ([ATC audio](../traffic-atc/01-traffic-and-atc.md#atc-audio))
- `object-mirror`, on the engines' bottom line: the gate, and the playout on a fixed delay, generic over the sample and the pose ([the object-mirror engine](../traffic-atc/01-traffic-and-atc.md#the-object-mirror-engine), [the gate](../traffic-atc/01-traffic-and-atc.md#the-gate))
- `src/features/traffic/core`: on the traffic host, polling every 500ms within 200km and ground objects within 1km, the objects it skips and the allowlist, each new object's identity read once, the gate's samples in batches, every identity again on `LinkUp`, and forgetting everything as polling stops; on a receiving machine, each sender's identities and newest states, the copies of the key's member while this pilot is in the flight, created, released, frozen, and dressed, with a stand-in for a create that throws, removed by each of the four rules, and fed to `Traffic` on this core's counter; the two counts; and the traffic packs' job ([the traffic host](../traffic-atc/01-traffic-and-atc.md#the-traffic-host), [a receiving machine](../traffic-atc/01-traffic-and-atc.md#a-receiving-machine), [notifications](../traffic-atc/01-traffic-and-atc.md#notifications), [traffic packs](../traffic-atc/01-traffic-and-atc.md#traffic-packs))
- `src/features/traffic/routines`: `Traffic`, which draws each copy 1s behind the traffic host's reads and writes its pose and velocities only when they changed ([`Traffic`, each frame](../traffic-atc/01-traffic-and-atc.md#traffic-each-frame))
- `src/features/atc-audio/core`: the capture on the ATC host, each frame to the crew with its number, stamp, and deadline, and on every other machine the playback stream with the buffer's rule and the volume's gain, opened again as the key moves or the host's restart count rises ([ATC audio](../traffic-atc/01-traffic-and-atc.md#atc-audio))
- each feature's part of the EFB app, its tab, rebuilt from the frames in `experiments/areas/interface/bench/src/frames/traffic.tsx`: the sharing card, How it works, Traffic's rules and check and this PC's packs, ATC audio's app picker, volume, and output device, the header's icon, and the tab's dot; and in the EFB shell, the sharing card both tabs show, and each host's chip in the crew row ([the tabs](../interface/decisions.md#the-traffic-and-atc-audio-tabs-hold-their-sharing-settings-and-warnings-flagged-by-a-dot-on-the-tabs-icon), [the sharing card](../interface/decisions.md#the-sharing-card-is-one-row-in-every-state-and-each-tab-teaches-its-feature), [shared apart](../interface/decisions.md#traffic-and-atc-audio-are-shared-apart-each-by-a-switch-of-its-own))
- the bench's `traffic` and `atc-audio` scenarios, and the stand-in's AI traffic, objects that no connection created, which a scenario puts in its sim and moves

From stage 4, it also builds the sim service's `poll` and `release`, a create of an aircraft or a helicopter through `AICreateNonATCAircraft_EX1` with its tail, and a definition written into an object by its ID; the edge's calls for each; and the stand-in's answers to each ([what a feature calls](../core/03-sim-seam-and-wasm-module.md#what-a-feature-calls)).

Designs first: whether the session crate's `session.share` claims or releases one role's key, the switch's own, in place of every role's key at once, which only the combined switch sent, since [traffic and ATC audio are shared apart](../interface/decisions.md#traffic-and-atc-audio-are-shared-apart-each-by-a-switch-of-its-own) left it to the user.
The user settled it on 2026-11-15: one role's key each, as [the session's units](../session/02-units.md)' note of that day has it.

Needs: 6, 9, and 11b.

Tests:

- From [traffic and ATC's cases](../traffic-atc/01-traffic-and-atc.md#cases-for-the-bench), on the bench, with two cores, the stand-in sim, a stand-in core helper, and the routine host built natively, every case but the buffer's, which stage 6 made the helper's own tests; `Traffic`'s, two feeds within one module frame and the samples 500ms apart, as its own tests, with the gate's and the playout's as `object-mirror`'s.
- [Traffic and ATC's budgets](../traffic-atc/01-traffic-and-atc.md#budgets), on the bench: a poll's answers within a handler's 1ms with 130 aircraft and 720 ground objects; traffic between machines, against about 2.5KB/s for 120 aircraft; ATC audio, against about 7KB/s through a relay, the speech's 4KB/s and each frame's framing (user, 2026-11-15); and 150 copies created within 5s of a join.
- [Traffic and ATC's cases in the sim](../traffic-atc/01-traffic-and-atc.md#cases-for-the-bench), in this stage's session in the sim, with a bench core as the second pilot ([in the sim](02-testing.md#in-the-sim)), the four checks of the design's note of 2026-11-15 among them; and its budgets there: the sim's frame on a receiving machine, and ATC from the app to the crew.
- From stage 2: the core holds under 100 MB of private working set beside QuickJS-ng's runtimes in a busy session, one that hosts traffic ([01-loop-and-edge's budgets](../core/01-loop-and-edge.md#budgets)).
- From stage 4: v1's connections and their watches add under 0.2ms to the sim's frame ([the sim seam's budgets](../architecture/02-code-map.md#the-sim-seams-budgets)), and `Traffic`'s frame takes under 0.1ms with 25 moving copies ([budgets for work in the sim](../architecture/02-code-map.md#budgets-for-work-in-the-sim)), timed with the update-timer patch stages 16 and 17 used.
- From stage 20: [the helper's CPU budget](../core/04-core-helper.md#budgets) with take-control's binding on, as in every session, since capturing a tone took 0.49% of a core alone and 1.08% with a binding and the mouse on ([control log](../control/log.md#2026-11-04-stage-20s-take-control-passes-its-cases-on-the-bench-and-a-press-reaches-the-cue-about-80ms-later-past-the-50ms-budget)).

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, the `traffic` and `atc-audio` scenarios among them; on the bench, one core's stand-in AI aircraft move on the other core's stand-in as frozen copies 1s behind, and the ATC host's captured frames reach the other core's stand-in helper; in this stage's session in the sim, the traffic host's AI aircraft show in a receiving sim as frozen copies, taxiing, pushing back, and in flight, as smoothly as FS Copilot's, and ATC from the ATC host's app plays in the other pilot's headset; and the [traffic and ATC log](../traffic-atc/log.md) has an entry for the cases and budgets.
Done on 2026-11-16: the whole bench passed 175 of 176 cases, the one failure the desktop app's idle CPU, which this stage doesn't touch ([traffic and ATC log](../traffic-atc/log.md#2026-11-16-the-whole-bench-passed-175-of-176-cases-on-stage-18s-committed-tree-the-desktop-apps-idle-cpu-over-its-02-as-on-every-run-the-day-before)); in the sim, `Traffic` held its budget with 25 moving copies ([traffic and ATC log](../traffic-atc/log.md#2026-11-16-traffic-held-its-budget-with-25-moving-copies-and-the-cost-the-day-before-came-from-19-moving-aircraft-and-30-the-stand-in-turned)), and the helper, at 1.44% of a core capturing BeyondATC, took the budget the user raised to 2% ([core log](../core/log.md#2026-11-16-capturing-beyondatc-with-a-binding-and-the-mouse-on-the-helper-took-144-of-a-core-and-opus-rs-at-5-loss-stayed-understandable)).

## 19 Pointer sync

Builds:

- the message crate's `pointer_sync` module: a gesture's `Down`, `Move`, `Held`, and `Up`, each point in fractions of the display's rect; its cockpit kind, `GESTURE`, keyed by its instrument's key; the panel module's messages, the instruments it serves, each gesture it captured, each one it's to play, and each up it's done with; and the visible lock's slice ([a gesture](../pointer-sync/01-pointer-sync.md#a-gesture), [what pointer sync registers](../pointer-sync/01-pointer-sync.md#what-pointer-sync-registers))
- `src/features/pointer-sync/core`: the instruments each panel serves; a captured gesture sent on the cockpit stream under its instrument's whole key, so a profile's bare `FCP` keeps the A220's four FCPs apart, and a key whose query carries the livery plays nothing on another livery, a known limit (user, 2026-10-25); each arriving message handed to each panel serving an instrument of that key, on that panel's socket alone, and answered `Skipped` while a catch-up runs that preflight's end didn't start, or when no panel serves the key; an up applied once each of those panels is done with it, or its socket closed or was replaced, or its module stopped, or after 1s, which the run's log notes at info; and the visible lock's slice, from the session's control, the network's link to the PF, and the stream's replay and catch-up ([playing a gesture](../pointer-sync/01-pointer-sync.md#playing-a-gesture), [locks](../pointer-sync/01-pointer-sync.md#locks))
- `clients`' `unit` message to one socket, which pointer sync's sends take
- `src/features/pointer-sync/panel`: the panel module `pointer-sync`, which captures each gesture on the displays `load` names, in the capture phase, skipping every event we dispatched, with a move at most every 33ms and only 2px from the last, `Held` after each 1s with nothing sent, an up whose `click` says the pointer stayed within 4px, and an up with no click once its pilot has been still for 30s (user, 2026-10-25); and plays each arriving message at the bridge's hit test, one gesture at a time on a display, under an unseen lock it renews, ending a gesture whose lock lapsed and starting it again if more of it comes; and shows the visible lock the slice names, each lock waiting until its own pilot's gesture on the display has ended ([a gesture](../pointer-sync/01-pointer-sync.md#a-gesture), [playing a gesture](../pointer-sync/01-pointer-sync.md#playing-a-gesture), [timing](../pointer-sync/01-pointer-sync.md#timing))
- pointer sync's module in the profile engine, `displays`, through the registration [stage 17](#17-avatars) built, with its check that a `WasmInstrument|` key fails; and the Baron 58P profile's tablet, `BlackSquareTablet` ([displays](../profiles/01-format-and-delivery.md#displays); read in bksq-aircraft-baronpro 0.1.1, `PANEL.CFG`)
- `tools/build.ts`'s build of each feature's panel module into our package, as `html_ui/DualInput/modules/` and the module's name, through the Coherent GT check ([panel modules](../core/02-clients-and-panel-bridge.md#panel-modules))
- the bench's fake cockpit panel for pointer sync: the panel bridge and the `pointer-sync` module, run in Node over a fake document on a fake page's socket, whose pilot taps, drags, and holds; and the cockpit stream's test unit keeps only its kinds that stand in for state sync, so the `cockpit` scenario's press is a pointer sync tap ([the sim's pages](02-testing.md#the-sims-pages))

From stage 5, it also builds the panel bridge's locks: the unseen lock, which lapses 2s after its module last renewed it, and which a press it took paints red-orange at about 60% opacity until that press's up, staying until then, or for 10s at most where the panel never hears the up; the visible lock with its words, which turns into a warning that blocks nothing once the core has been silent for 8s; the hit test that looks past every overlay; the mouse events a module dispatches, which no module captures; each lock dropped at once by its module's stop, the socket's close, and `window.DUALINPUT_BRIDGE_UNLOCK()`; and a rejoin for an instrument created after the `hello`, which stops the panel's modules so the new socket's `load` starts them again ([what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns), [locks](../pointer-sync/01-pointer-sync.md#locks)).
The flash's color and the locks' words are the user's (user, 2026-10-17 and 2026-10-25), and the warning stays until the core speaks again or its socket closes (user, 2026-10-25).

Needs: 5, 13, and stage 17's registration in the profile engine, which landed ahead of its stage (user, 2026-10-25).

Tests:

- From [pointer sync's cases](../pointer-sync/01-pointer-sync.md#cases-for-the-bench), on the bench, with two cores and the fake cockpit panel on each:
  - A tap plays as `mousedown`, `mouseup`, and `click` at the same fractions; a 3s drag's moves reach the other panel while it's made, about 30 a second, with no `click`; and a press held still for 5s keeps the other display's lock through its `Held` messages, and still lasts 5s replayed after a cut.
  - A state change sent while a display press is held applies between the down and the up on both machines.
  - The sending core killed partway through a drag: the other display's lock lapses within 2s of the last move, the panel gets a `mouseup` on the document, and nothing more of that gesture plays; a tap whose up arrives 2.5s after its down lapses, starts again at the up, and clicks; and a 10s cut partway through a drag ends the gesture 2s after its last move, and the replay starts it again from its next move and plays every gesture after it.
  - A press on a display under the unseen lock: the flash shows while it's held and goes at the up, the display gets nothing, nothing is sent, and a lock whose gesture ends meanwhile stays until that up; and the other pilot's `Down` while this pilot's button is down on the display locks it at this pilot's up, and their own `Up` goes out.
  - An `Up` for a display with no gesture playing is answered at once, with no line in the run's log; an up the panel never answers applies after 1s, with a line at info; a panel module that throws partway through a gesture leaves no lock after 2s; and a receiving panel that reloads partway through a gesture has the up handed to the old socket count as applied, and ignores the rest.
  - A `Down` during a late joiner's catch-up is skipped, and its moves and up after the catch-up are ignored; and a PF's press made once the PM has asked for preflight's end's catch-up plays on the PM's display while that catch-up runs, where one made before the ask reaches the PF drops on the PM, a known limit (user, 2026-10-25; [pointer sync log](../pointer-sync/log.md)).
  - The PM's link to the PF cut: within 5s every display on the PM's machine locks and none on the PF's, taking control lifts it, and once the link returns it holds until the replay ends; a PF's Leave whose close reaches the PM before the handover locks the PM's displays until it takes control; a late joiner's displays lock until its catch-up ends; and a press in preflight acts on its own display and is sent nowhere.
- As the panel module's own tests, over the fake document, from the same cases: two displays in one panel each send and play under their own key; a `mousedown` with a gesture open sends that gesture's `Up` with no click first; no event the module dispatches is captured or sent back; a press on one of the bridge's overlays starts no gesture, and an up that lands on one ends this pilot's gesture; and a gesture still for 30s ends with an up and no click.
- As the bridge's own tests: a press a lock took whose up never comes holds the lock 10s at most; and a rejoin stops the panel's modules, which the new socket's `load` starts again with every instrument.
- From stage 5, on the bench with the fake cockpit panel and as the bridge's own tests: with the core suspended, a visible lock turns into a warning within 10s of the core's last message, and `window.DUALINPUT_BRIDGE_UNLOCK()` removes it at once; and with the core's socket closed, every lock drops at once ([the code map's cases for work in the sim](../architecture/02-code-map.md#cases-for-the-bench-for-work-in-the-sim)).
- As the profile engine's tests: a module's displays join its profile's, and a `WasmInstrument|` key fails the load.
- As `clients`' own tests: a `unit` message to one socket reaches that panel alone.
- [Pointer sync's budgets](../pointer-sync/01-pointer-sync.md#budgets), on the bench: a gesture's messages, about 30 a second while it moves and one a second while it's held, at their encoded size; and the messages to one panel through a drag, under 30 a second.

Its cases in the sim move to [stage 14](#14-state-sync)'s session, the first with a bench core as the second pilot, which sets up a session in the 58P with our package installed, as they need, and its cases with friends move to [stage 16](#16-flight-model-sync)'s first flight with friends.
The stage changes nothing every scenario runs on, so it closes on the scenarios it adds or changes, `pointer-sync` and `cockpit`.

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, the panel module's and the bridge's tests and the `pointer-sync` scenario among them; on the bench, a tap on one core's fake panel plays as `mousedown`, `mouseup`, and `click` at the same fractions on the other's, and with the PM's link to the PF cut, the PM's displays lock until it's back and the replay has ended; and the [pointer sync log](../pointer-sync/log.md) has an entry for the cases and budgets.
Done on 2026-10-25.

## 20 Take-control

Builds:

- the message crate's `take_control` module: its two settings' keys, its two commands, and its slice, which holds whether the input is live, whether this pilot holds control, each denial's reason, the warning while the link to the PF is lost, and the next press while Bind waits for it, the part reading the two settings from the slice of settings ([the units](../control/01-take-control.md#the-units), [taking control](../control/01-take-control.md#taking-control))
- `src/features/take-control/core`: the binding, on for the whole of a session while an input is set, which asks on a press's down or once it has been held 0.35s; the sounds, on for the whole of a session; the request's four steps; the cue and the notification at each pass, which names the pilot who left the flight, and says what a PF who lost control through a lost link had undone; the refusal's cue and notification; and "Reconnecting to James", held while this core's link to the PF is lost ([the binding](../control/01-take-control.md#the-binding), [taking control](../control/01-take-control.md#taking-control), [a pass](../control/01-take-control.md#a-pass), [the banner](../interface/decisions.md#the-banner-carries-what-a-pilot-must-see-without-the-efb-and-the-rest-shows-where-its-acted-on))
- `src/features/take-control/efb`: the button under the tab bar, held 0.35s, with its ring, its bound key, and its lines; and the binding's section at the top of Settings ([take control](../interface/decisions.md#take-control-is-a-held-button-under-the-tabs-with-one-hold-of-035s), [the Settings tab](../interface/decisions.md#the-settings-tab-holds-the-binding-the-output-device-the-recordings-and-the-version)), rebuilt from the frames in `experiments/areas/interface/bench/src/frames/flight.tsx` and `settings.tsx`, with the kit's `Choice` for Press or Hold
- two cues, made by an ignored test of `src/apps/core-helper`, as the bench's tone is, which [stage 20b](#20b-the-sounds) kept for v1 ([left open](../control/01-take-control.md#left-open))
- the helper's next press, which skips a modifier and any key pressed with one held, so one key binds, and while it's on, a press crosses only as the next press, so pressing the key already bound doesn't also take control ([the Settings tab](../interface/decisions.md#the-settings-tab-holds-the-binding-the-output-device-the-recordings-and-the-version))
- the helper's output thread, which takes its commands after waiting for the device, so a sound goes into that write, 10ms sooner on a device with a 10ms period
- the core helper service's warning for a binding, in the frames' words, "Your take-control key isn't working" and "Windows didn't let Dual Input listen for F9."
- the cockpit stream's guard's reason, in the frames' words, "You're catching up with James."
- on the bench, the stand-in core helper for every bench core that names no other, which says its own hello with no bench line, since every session now runs a helper; and the `play` line's time since the last press

Needs: 6 and 11b.

Tests:

- From [take-control's cases](../control/01-take-control.md#cases-for-the-bench), on the bench, with two cores and a stand-in core helper on each, the hold's two sides moved to its 0.35s:
  - A single press by the PM: control passes, and both machines play the cue, the PM's notification "You have control" and the PF's "Adam has control".
  - A long press held 0.2s: nothing; held 0.5s: control passes at 0.35s, before the release.
  - A press by the PF: nothing.
  - A press before preflight ends, or out of the flight: nothing, and no cue.
  - A press during this pilot's catch-up: the refusal cue and a notification with the reason, and control stays.
  - A press while the link to the PF is lost, with or without a catch-up running: control passes at once, and "Reconnecting to James" clears; the button's slice carried its warning before.
  - The PM's press and the PF's within 20ms: if the PM's pass hasn't reached the PF's machine, the PF's press does nothing, and each machine plays the cue once; if it has, the PF takes control back, and each plays it twice.
  - The PF leaving the flight: the PM's machine plays the cue and "You have control", and the PF's, out of the flight, plays nothing.
  - A pilot with no binding: the helper runs through the session, and the EFB app's request takes control with the cue.
  - Bind, then a key: the key is bound by its scan code, and shown by its name; Bind, then Cancel: the binding is as before.
  - Rebinding mid-session: the new key takes control, and the old one does nothing.
  - The core helper killed mid-session and started again: the binding takes control as before.
  - The EFB app's request, while a guard denies: the refusal cue and notification, as for the key.
  - Beyond the cases: a PF whose link came back to find control taken gets "Adam took control while you were disconnected", and a replay on the PF's machine, which the guard refuses control through, tells that pilot nothing.
- The design's last case needs the real helper, since the helper's Windows calls have no bench.
  Its bound key, in another program and in a popped-out display, passed in [stage 6's session](../core/log.md#2026-10-23-stage-6s-helper-passes-every-case-at-the-desk-and-in-the-sim-and-captures-within-1-of-a-core-in-opuss-audio-mode-but-never-sees-an-xbox-controllers-buttons-over-usb).
  This stage's change to the next press runs in `node tools/sim/core-helper.ts desk`.
  A bound button with another program in front moves to [stage 14](#14-state-sync)'s session, since stage 6's pressed a button only as the next press, and it needs a pilot at the hardware.
- As the helper's own tests: a modifier and a key pressed with one held don't bind, and a key after they're released does; and both cues are 48 kHz, mono.
- As the part's own tests: a click takes nothing, a hold takes control once at 0.35s, and letting go early cancels it.
- [Take-control's budget](../control/01-take-control.md#budgets): a single press to the cue under 100ms from the helper's stamp on the down, the loop's part on the bench, and the output stream's by an ignored test of the helper's on our development machine's default device.

The stage closes on the whole bench, as [working a stage](#working-a-stage) has it.

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, the `take-control` scenario among them; on the bench, a press on one core's stand-in helper passes control, and both machines play the cue and show who has control; and the [control log](../control/log.md) has an entry for the cases and the budget.
Done on 2026-11-04.

## 14b State sync's writes that read another value

Designs first: why 14 of state sync's writes in the first flight with friends read another value 1.5s later, 11 of them on the following machine, the elevator trim and the autopilot modes among them ([sync log](../sync/log.md#2026-11-12-in-the-first-flight-with-friends-14-of-state-syncs-writes-read-another-value-15s-later-11-on-the-following-machine-the-elevator-trim-and-autopilot-modes-among-them)), and whether they're why the aircraft drifted, mainly sideways, after a handover with the autopilot engaged, which the [flight-model log](../flight-model/log.md#2026-11-12-two-pilots-on-two-pcs-flew-one-58p-smoothly-through-13-handovers-over-a-relayed-link-and-after-a-handover-with-the-autopilot-engaged-the-aircraft-drifted) leaves to this work (user, 2026-11-12).
Then which unit fixes it, since the sync log's leads sit in the following sim's own autopilot, the 58P profile's entries, and the sync engine's `CHECK`, one read 1.5s after a write, which flags a value that lands later.
The fix comes from a session in the sim that makes both happen again.
The replays and two sessions in the sim found both causes: the drift was the host's heading bug, jammed at its first value, since `fsVarsBVarCall` with a value jams an input event for the rest of the flight ([sync log](../sync/log.md#2026-11-17-fsvarsbvarcall-with-a-value-jams-the-input-event-for-the-rest-of-the-flight-and-calculator-code-from-our-module-doesnt)), and the trim that read another value was a following machine's autopilot running it to full nose-down ([sync log](../sync/log.md#2026-11-17-a-preset-called-with-a-value-from-our-wasm-module-took-only-its-first-value-and-from-a-panel-it-took-every-one)).
Two coupled toggles that undo each other, a following machine's autopilot sending its own vertical speed target, and a following 58P's trim falling and its bank growing as it takes control, after the write at the handover went out ([sync log](../sync/log.md#2026-11-18-in-stage-14bs-session-the-58p-took-every-preset-value-and-its-heading-bug-followed-and-as-it-took-control-its-own-trim-fell-and-it-banked-after-our-trim-write-went-out)), stay known limits, the first for [stage 14c](#14c-two-coupled-writes-in-one-input) and the last for [stage 16c](#16c-trim-and-bank-after-a-handover) (user, 2026-11-17 and 2026-11-18).

Builds:

- our WASM module's presets, each called as calculator code, `<value> (>B:<name>)`, in place of `fsVarsBVarCall` and the IDs it kept ([sync log](../sync/log.md#2026-11-17-fsvarsbvarcall-with-a-value-jams-the-input-event-for-the-rest-of-the-flight-and-calculator-code-from-our-module-doesnt))
- in `sync-engine`: a flag for each write that never lands, which state sync logs, its notification still once per entry for each load; a PF-owned entry's write on a following machine, live and in catch-up, left unchecked; as control passes to a machine, each PF-owned entry written once at the old PF's last value; and a state entry's write function that returns a value, which the engine waits to read in place of the value it gave the function
- in `profile-engine`, a state entry's write function typed to return its entry's type, `write()`'s chain, which the engine takes as no value, or nothing
- in state sync, the engine's call as control passes
- in the Baron 58P profile, the heading bug's function returning its value rounded to the preset's 1/16,384ths of a turn, and notes on the three known limits

Needs: 14 and 16, since `Follow` flies the following machine, where 11 of the 14 were.

Tests:

- As the sync engine's own tests: every write that never lands is flagged, the first and each one after it; a PF-owned entry that a following machine's own systems move is never flagged, live or in catch-up; a machine that takes control writes what the PF owns at the old PF's last values, while one that goes on following writes nothing; a reading that matches the value a write function returned is its write's echo, which goes nowhere, and a catch-up's write whose returned value the cockpit already reads is never flagged; and what an event entry's function returns goes unused.
- On the bench, in the `state-sync` scenario: a following machine never flags what the PF owns, and writes it at the old PF's last value as it takes control.
- In this stage's session in the sim, in the 58P with a bench core as the second pilot: the heading bug, an altimeter, and a cabin handle take every value the second pilot sets through their `_Set` presets, and the heading bug's, rounded off its whole degrees, raise no flag; and the 58P's heading bug follows the second pilot's into a handover with the autopilot in heading mode.

The stage's code acts only in a session with a profile loaded, so it closes on the scenarios that hold a session in a flight, the 18 stage 16 closed on.

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, the `state-sync` scenario's new case among them; in this stage's session in the sim, the 58P's `_Set` presets take every value the second pilot sets, and its heading bug follows the second pilot's into a handover in heading mode; and the [sync log](../sync/log.md) has an entry for the session.

Done on 2026-11-18, with the `state-sync` scenario at 11 of 11 and the other 17 at 120 of 121: the `cockpit` scenario's first test failed its handler budget on the startup stall the flake task diagnosed in `flight-model-handler-flake.md`, its first core's seventh input, which took 41ms with a diagnostic build, 41ms of it writing two log lines.

## 16b A following pilot's camera

Designs first: why a following pilot's core reads its camera 1m to 3m behind the pilot's seat in flight, so the crew sees that pilot as a head in the cabin, and the click's ray, cast from that camera, may put their hand in the wrong place too, and how avatars or flight-model sync fixes both, from the read in the sim the log names as what would settle it ([avatars log](../avatars/log.md#2026-11-12-on-a-following-machine-in-flight-the-camera-reads-1m-to-3m-behind-the-pilots-seat-so-the-crew-sees-that-pilot-as-a-head-in-the-cabin)).
The design settled on 2026-11-17: the platform reads the camera through its own routine, `Camera`, in our WASM module, behind the sim service's subscription `cameras`, which avatars takes, and the routine host reads it for `Camera` during that routine's frame, before any routine's writes go out ([avatars log](../avatars/log.md#2026-11-17-inside-our-module-before-the-routines-write-a-following-machines-camera-reads-at-the-eye-in-every-referential); user, 2026-11-17), as the notes at the top of [01-avatars](../avatars/01-avatars.md), [03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md), [the code map](../architecture/02-code-map.md), and [testing](02-testing.md) have it.

Builds:

- the message crate's `module` module: the platform's routine `CAMERA`, its slot, which holds nothing, and its report, the camera in `SIMOBJECT`'s referential and in `WORLD`'s, each as `SimConnect_CameraGet` gives it
- `routine-host`: the want to read the camera in a referential, carried out during the routine's frame, which gives nothing when the sim gives no camera; and the platform's routine `Camera`, which reads the camera in both referentials each frame and reports them, and reports nothing in a frame the sim gives no camera
- our WASM module's edge for the want, through `fsCameraGet`, and `routine_host::Camera` in the module's list of routines in `src/sim-package/routines`
- the stand-in's answer to the want, from a camera placed in the world from where its aircraft stood as the module's frame began, after the stand-in moved it, and its answer to `CameraGet` from the same place
- `sim-service`: `cameras` in place of `camera`, feeding `Camera` on the platform's connection while any unit's subscription is open, ending it when the last closes, and handing each subscriber the camera from `Camera`'s report on its own connection
- `avatars`: `cameras` taken at `ProfileLoaded`; the camera taken from its newest arrival, in the referential the pilot's place calls for, where it was taken from `SimConnect_CameraGet`'s answer; and the hands' time and this pilot's pose still moved on each `Frame` event, since a camera may not come every frame

Needs: 16 and 17.

Tests:

- As the routine host's own tests: a routine's read of the camera sees none of that frame's writes, and `Camera`'s report carries the camera in both referentials each frame, and nothing in a frame with no camera.
- On the bench, in the `avatars` scenario: a pilot following in flight at 40 m/s and 85 m/s keeps their seat, and the other core's `Figure` is fed their figure seated, with its eye within 5cm of the seat's eye, since a camera a frame behind can still fall within the seat's 0.8m; and `Camera`'s slot is written while a profile is loaded, and no more once it unloads, since the sim service has no tests of its own and the bench reaches it.
- In this stage's session in the sim, in the 58P, with a bench core as the pilot flying, whose stand-in aircraft the 58P follows ([in the sim](02-testing.md#in-the-sim)): following at about 85 m/s and 130 m/s, the pilot keeps their seat, the bench core's `Figure` is fed their figure seated, and a click on a cockpit switch is cast from their eye and puts their hand on that switch; then the same after the pilot takes control in flight and flies at about 85 m/s, since the module's read has been measured only on a following machine.
- In the same session: a click on the aircraft's exterior on foot puts the hand where it was clicked, since `Camera` reports only when the sim gives both referentials, and its `SIMOBJECT` read on foot is unmeasured.
- In the same session: a click in active pause, and a click with ChasePlane off and the head held still, each puts the hand on the switch, since whether our module runs in active pause and whether SimConnect sends a report that didn't change are both unmeasured, and a gap either leaves is a known limit of [01-avatars](../avatars/01-avatars.md#known-limits).
- In this stage's session in the sim, our module's update timed again with `experiments/areas/avatars/p29-sim-session/update-timer.patch`, since `Camera` adds a read of the camera and a report to every frame, and put to the user against the 91µs to 335µs at p99 they accepted for stage 16, since budgets are theirs ([flight-model log](../flight-model/log.md#2026-11-11-seated-on-the-pose-follow-says-it-writes-a-figure-keeps-its-seat-on-the-following-machine-and-the-58p-banks-and-pitches-with-the-aircraft-it-follows)).

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, the fix's tests and the `avatars` scenario among them; in this stage's session in the sim, a pilot whose 58P follows the bench core's aircraft in flight, and then flies it, keeps their seat, and their click puts their hand on the switch they clicked; and the [avatars log](../avatars/log.md) has an entry for the fix and the session.
Done on 2026-11-18.

## 20b The sounds

Designs first: the style of Dual Input's sounds, which the user picks by ear from a page of a few contrasting styles, each playing the same two cues, with a licensed pack or a sound designer as the way out if none is good enough (user, 2026-11-04).
Builds: no new cues, since the user picked [stage 20](#20-take-control)'s two over four rounds of candidates, so v1 keeps them; and the voice phrases' two cues, the offer opening and the offer timing out ([voice phrases](../product/03-v1-scope.md#voice-phrases)), sketched in their style in `experiments/areas/control/sounds/make.mjs` for that Soon pick ([control log](../control/log.md#2026-11-15-four-rounds-of-candidate-cues-didnt-beat-stage-20s-stand-ins-so-v1-keeps-them); user, 2026-11-15).
Needs: 20.
Tests: none of its own, since it changes no code; the helper's test from stage 20 still checks that both cues are 48 kHz, mono.

Exit: the user has heard the candidates and picked the cues v1 ships, and the [control log](../control/log.md) has an entry for the rounds.
Done on 2026-11-15.

## 21 Rate and pause, and Go to

Builds:

- the message crate's `rate_and_pause` module: `PAUSE`, an `Anyone` key, `RATE`, a `PilotFlying` key, the `unit` message to the EFB app's part, and the time of day's match item; and its `go_to` module: `SPOT`, a `PilotFlying` key, its slice, and its command ([session keys](../session/02-units.md#session-keys), [slices and commands](../interface/01-apps.md#slices-and-commands))
- `src/features/rate-and-pause/core`: active pause, written when this sim's flag, `Pause_EX1` 4, changes to differ from the key, and applied through the EFB app's part whenever the flag differs from the key, again when the EFB app joins; the simulation rate, written on the flying machine and stepped on a following one by `K:SIM_RATE_INCR` or `K:SIM_RATE_DECR`, one step at a time; both only while this pilot is in the flight; the PF in the pause menu, `Pause_EX1` 8, as a held notification in the frames' words, "James has paused"; and the time of day's item, `E:ZULU TIME` and the zulu date, a warning past 10 minutes ([rate and pause](../session/02-units.md#rate-and-pause), [the match check](../session/02-units.md#the-match-check), [the banner](../interface/decisions.md#the-banner-carries-what-a-pilot-must-see-without-the-efb-and-the-rest-shows-where-its-acted-on))
- `src/features/rate-and-pause/efb`: the part with no screen, which calls `TOOLBAR_SET_ACTIVE_PAUSE` on each `unit` message ([a feature's parts](../interface/01-apps.md#a-features-parts))
- `src/features/go-to/core`: the PF's spot, their `[Departure]` airport and stand and whether an engine runs; why Join is unavailable; and Join, which runs the world map's requests one at a time and says which step failed ([Go to](../session/02-units.md#go-to), [Join](../interface/decisions.md#join-takes-a-joiner-from-the-world-map-into-the-pfs-flight-or-only-sets-it-up))
- `src/features/go-to/efb`: Join at the end of the PF's crew row with where the PF is under their name, its question with Set up only and Join now, its toasts, and its reasons while disabled, rebuilt from `JoinPf` in `experiments/areas/interface/bench/src/frames/home.tsx`; and for it, a place for parts on a crew row in the EFB shell, and the frames' icon for a warning and an error on the kit's toast
- the menu script's requests: the departure airport, stand, and runway, the PF's aircraft found or selected, their livery, the flight's start, and Ready to fly pressed ([the menu script](../session/02-units.md#the-menu-script)), and on the bench a fake menu script that answers them
- the aircraft picker's load, `profiles.pick`, through the menu script's aircraft request at the world map, which [stage 11b](#11b-the-apps) left refusing (user, 2026-11-17)
- the match check's comparisons told which value is the reader's, with the profile's and the time of day's items in the frames' words from the reader's side, and the version's, the place's, and the livery's shortened (user, 2026-11-17)

From stage 4, it also builds the sim service's `world_map`, a `unit` message to the newest menu script's socket answered with the call's handle, and failed at once with no menu script connected ([what a feature calls](../core/03-sim-seam-and-wasm-module.md#what-a-feature-calls)), with the menu script's report of the menu's page, read every 500ms.
The page's report runs outside a session too, since stage 11b's aircraft picker reads it at home.

Needs: 9 and 11b.

Tests:

- From [the session's cases](../session/02-units.md#cases-for-the-bench), on the bench, with two cores, a fake EFB app whose part plays the toolbar's call on its stand-in, and a fake menu script on each:
  - The EFB app's part sets active pause on the stand-in's toolbar call, and the flag that comes back writes no key.
  - Two pilots press active pause at once: both machines keep one value; a pilot who presses it twice within one round trip ends with every machine on one value; and a following pilot's change of the rate is stepped back.
  - From stage 11a: rate and pause's `unit` message sent while the EFB app reconnects, and active pause catching up once it's back ([the apps' cases](../interface/01-apps.md#cases-for-the-bench)).
  - Beyond the cases: the PF in the pause menu shows "James has paused" on the other's banner until they leave it, and two times of day 20 minutes apart show a warning.
  - Join from the world map: with the PF at a stand, engines off, Set up only sets the airport, the stand, the aircraft, and the livery; with the PF's engines running, Join now sets a runway, starts the flight, and presses Ready to fly; a stand the list lacks keeps the airport alone and says so; a step that fails says which; and Join is unavailable, with its reason, before the PF loads a flight, with no departure, without the PF's aircraft, in a flight in another aircraft, and with no menu script.
- As the menu script's own tests: `departure_stand` for PARKING 14 at an airport that has PARKING 140 selects PARKING 14.
- [The session's budgets](../session/02-units.md#budgets): a following machine's active pause applied within 500ms of the key arriving, on the bench up to the part being asked, and in the sim from the part's call to the flag; and Go to's, from the press to the stand or runway selected within 5s, in the sim.

In the sim, in one session ([cases in the sim](../session/02-units.md#cases-for-the-bench)): our EFB app's code calls `TOOLBAR_SET_ACTIVE_PAUSE` with the EFB closed, and active pause turns on and off, with the time from the call to the flag; `departure_runway` selects a runway by its `ID`, as the world map's own list does (read in fs-base-ui 0.1.10, `html_ui/Global/pkg/base.bundle.js`, `FreeflightPlanCombobox._updateDropdown`), and the Baron 58P's engines run at Ready to fly after it; `departure_stand` against a gate whose list name has a letter; which entry of the aircraft list and of the liveries is the PF's; that the menu script sees `FreeFlightPage`; and Join now from the world map to the PF's flight, with Go to's budget.
The stage changes nothing every scenario runs on, so it closes on the scenarios it adds or changes: `rate-and-pause`, `go-to`, and those with a fake menu script, `session`, `profiles`, and `flight-model`.

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, the `rate-and-pause` and `go-to` scenarios among them; on the bench, active pause set on one core's fake EFB app reaches the other's, and Join from the world map runs every request to Ready to fly; in the sim, active pause follows from our EFB app's code, and Join now puts a joiner in the PF's flight; and the [session log](../session/log.md) has an entry for the cases and budgets.
Done on 2026-11-17: on the bench, `rate-and-pause` and `go-to` passed 4 of 4, a following machine's part asked to pause 21ms after the press ([session log](../session/log.md#2026-11-17-stage-21s-rate-and-pause-and-go-to-pass-their-bench-cases-and-a-following-machines-part-was-asked-to-pause-21ms-after-the-press)); in the sim, our EFB app's code set active pause on and off within 264ms of the press, and Join now selected a runway 0.45s after its command and started the flight within 0.9s, once the menu script parsed ([session log](../session/log.md#2026-11-17-in-the-sim-join-set-the-world-map-and-started-the-flight-within-09s-and-active-pause-followed-from-our-efb-apps-code-in-264ms-once-the-menu-script-parsed)).

## 14c Two coupled writes in one input

Designs first: how state sync writes two coupled controls that arrive in one input, since a profile's write decides in the core from a reading a frame or more old, so one write can undo the other, as the 58P's altitude hold and vertical speed mode did twice in the first flight with friends, which [stage 14b](#14b-state-syncs-writes-that-read-another-value) found and left as a known limit (user, 2026-11-17).
It starts from the sync log's entries of 2026-11-16 and 2026-11-17, and the idea weighed there, in which profiles stay in JavaScript and our WASM module runs a toggle as calculator code guarded by the entry's own variable.
Before that design, it measures how the sim orders and applies the events of one frame, through SimConnect and through our module.
p33 found that no route shows the 58P autopilot's response to an event in the frame it's sent, so a toggle guarded in the sim reads the old mode too.
Instead, the sync engine holds a toggle, a stepping write, or a write function while another entry has a value pending, as [05-units](../sync/05-units.md)' note of stage 14c has it ([sync log](../sync/log.md#2026-11-19-no-route-showed-an-autopilot-events-effect-in-the-frame-it-was-sent-so-a-guard-in-the-sim-reads-the-old-mode-and-the-events-of-one-frame-apply-in-the-order-sent); user, 2026-11-19).

Builds:

- in `sync-engine`: an arrival's or a catch-up's `toggle`, stepping write, or write function held while another entry has a value pending, other than a following machine's write of what the PF owns, each later write of an arrival or a catch-up held behind it, in order, and each made from the readings, at the value its entry holds then, a frame after that value reads back or is dropped; a held arrival answered as `Stepping`; and a reading that brings the value a held write wants taken as no change of this machine's
- in the Baron 58P profile, the note on `ap_vs_hold`'s known limit dropped

Needs: 14b.

Tests:

- As the sync engine's own tests: a toggle that arrives with another entry's write decides once that write reads back, finds its mode already off, and sends nothing back; a held toggle goes once the write before it is flagged, and flips when its mode still reads on; a following machine's write of what the PF owns holds no toggle, and a value's write never waits for another entry's pending write; catch-up holds a toggle behind the write before it, and the writes after it in order; a held write makes the value its entry holds as it goes, this pilot's own change included; and a write function behind the battery in catch-up's burst waits for the battery, then writes.
- On the bench, in the `state-sync` scenario, with the stand-in's rules for the 58P's two vertical modes: altitude hold and vertical speed mode changed in one frame leave the other machine in altitude hold, and nothing comes back.

The stage's code acts only in a session with a profile loaded, so it closes on the scenarios that hold a session in a flight: the 18 stage 16 closed on, and `go-to` and `rate-and-pause`, which stage 21 added after them.

Exit: on our development machine, `node tools/check.ts` and `node tools/bench.ts` pass, the `state-sync` scenario's new case among them, which fails with the hold taken out; and the [sync log](../sync/log.md) has an entry for p33 and the fix.
Done on 2026-11-19: `node tools/check.ts` passed, and the `state-sync` scenario passed 12 of 12 after the code review's fixes, its new case failing with the hold taken out ([sync log](../sync/log.md#2026-11-19-no-route-showed-an-autopilot-events-effect-in-the-frame-it-was-sent-so-a-guard-in-the-sim-reads-the-old-mode-and-the-events-of-one-frame-apply-in-the-order-sent)); the other 19 scenarios of the close wait for the next bench that runs them, since a game held the PC (user, 2026-11-19).
On 2026-11-20 the whole bench passed 184 of 184 on main at 48c0d1d, those 19 among them, and `node tools/check.ts` passed there too.

## 16c Trim and bank after a handover

Designs first: what moves the 58P's elevator trim and bank in the frames after flight-model sync's `Follow` lets it go at a handover, and which unit fixes it, which [stage 14b](#14b-state-syncs-writes-that-read-another-value) found and left as a known limit (user, 2026-11-18).
In 14b's two runs in the sim, the trim dropped from -8% to between -62% and -77% and came back within about 7 frames, and a left bank of 16° to 24° began in the same frame, though state sync's write of the old PF's trim, -5%, went out at that moment; in the run whose autopilot held the second pilot's altitude, the 58P turned 15.6° and lost 128 ft in 15s.
It started from the sync log's entry of 2026-11-18, and `tools/sim/handover.ts` reproduced it.
Two runs of p40 in the sim found the cause: the 58P's KFC 150, the sim's own autopilot, winds up while `Follow` holds the aircraft frozen, and once it's let go, rolls it and runs its trim until it settles, within about 9s; the first flight with friends shows the same behind a PF whose aircraft moves ([flight-model log](../flight-model/log.md#2026-11-19-after-a-handover-the-58ps-own-autopilot-rolls-the-aircraft-and-runs-its-trim-wound-up-while-follow-held-it-frozen-which-v1-keeps-as-a-known-limit)).
The user kept it as a known limit of flight-model sync, since the likely fix, which p40 never got to try, turns the autopilot off and on again at every handover (user, 2026-11-19).
Builds: nothing.
Needs: 14b and 16.
Tests: none, since it changes no code.
Exit: the [flight-model log](../flight-model/log.md) has an entry for the cause, and [01-flight-model-sync](../flight-model/01-flight-model-sync.md) a note on the known limit.
Done on 2026-11-19.

## 2b The core's log off the loop's thread

Designs first: a thread of the log's own that writes the run's log, since Windows held a core's early writes to its new `log.txt` for up to 49ms on the loop's thread, which failed the bench's 1ms for a handler in `flight-model`'s and `cockpit`'s first tests ([core log](../core/log.md#2026-11-18-windows-held-a-cores-early-writes-to-its-log-for-up-to-49ms-on-the-loops-thread-so-the-log-gets-a-writer-of-its-own); user, 2026-11-18).
Builds: that writer, in `src/apps/core`'s log, as [01-loop-and-edge](../core/01-loop-and-edge.md)'s note of stage 2b has it, and the bench's `Core.logged` in `tools/bench/cores.ts`, which waits for a line of a running core's log, since a line can reach the file after the bench sees what its handler did.
Needs: 2.
Tests: as the log's own tests, a line sent while each write takes 50ms returns at once, a flush waits for every line sent before it, and the cap and the home folder's path hold as before.
The stage changes the core's edge, so it closes on the whole bench.

Exit: on our development machine, `node tools/check.ts` and the whole `node tools/bench.ts` pass, the log's tests among them.
Done on 2026-11-18: the whole bench passed 182 of 182, and after the code review's fixes the seven scenarios they touched passed 60 of 60; the stall itself didn't come in these runs, so they show the loop can't wait on a held write, not that the stall is gone ([core log](../core/log.md#2026-11-18-windows-held-a-cores-early-writes-to-its-log-for-up-to-49ms-on-the-loops-thread-so-the-log-gets-a-writer-of-its-own)).

## 21b Code comments

Designs first: one pass over every comment in the tree as it stands, since nothing has read them the way the `doc-reviewer` reads a document: prose-lint checks words and history only, and each stage's code review weighed comments as one of eight things (user, 2026-11-20).
Each chunk below goes to an agent of its own, and no two chunks share a file.
Each agent fixes, most costly first: a comment its code no longer matches, plan or status left in a comment, a workaround for sim behavior with no source cited, and anything else writing.md's [Code comments](../../../.claude/rules/writing.md#code-comments) rules out, skipping matters of taste.
A bug a comment exposes goes to the user rather than into this stage's diff, so the stage changes only comments.
A generated file's comments are fixed at their source: the message crate's TypeScript types come from its Rust, `levels/1/declarations.d.ts` from the profile builder, and `javascript.d.ts` from `tools/javascript-types.ts`.
The stage changes no behavior, so it runs no bench, and its close runs no code review, since the chunks' review is one (user, 2026-11-20).

Builds: the comments' fixes, chunk by chunk, each with its comment lines as of 2026-11-20:

1. the sim side of `src/engines/`: `sync-engine`, `aircraft-model`, `stand-in-sim`, `sim-client`, `sim-edge`, `sim-awareness`, `simconnect-types`, `object-mirror`, `ray-cast`, `msfs-gltf`, and `msfs-rpn`, 2,131 lines
2. `tools/`, outside `tools/bench/`, 1,995 lines
3. `src/features/`, 1,811 lines
4. `src/platform/`'s `sim-service`, `session`, `network`, `kernel`, `routine-host`, and `recording`, 1,714 lines
5. `src/apps/desktop`, `src/platform/efb-shell`, `src/platform/desktop-shell`, and `src/packages/`, 1,677 lines
6. the message crate's Rust, in `src/engines/messages`, 1,383 lines
7. the rest of `src/engines/`, with `src/sim-package/`, `src/backend/`, and `src/relays/`, 1,275 lines
8. `tools/bench/`, 1,248 lines
9. `src/apps/core` and `src/apps/core-helper`, 1,144 lines
10. the rest of `src/platform/`, 993 lines

Needs: every stage before 22.
Tests: none, since it changes no behavior.

Exit: on our development machine, `node tools/check.ts` passes, and every chunk has been read and fixed.
Done on 2026-11-20: every chunk was read and fixed, changing comments in 254 files, with the message crate's TypeScript types written again from its new doc comments, and `node tools/check.ts` passed; the two bugs the comments exposed, in `tools/sim/desk`'s usage message and the EFB app's dev loop, went to the user rather than into the diff, and were fixed in commits of their own that day at the user's word.

## 22 GitHub

Designs first: how CI, releases, and the relays run once the repository went public on 2026-11-20, which the user settled that day, and which the design docs these lines link carry (user, 2026-11-20):

- CI runs on every pull request and every push to `main`, where it blocks nothing, on GitHub's standard runners, which are free on a public repository.
  It runs the bench on programs one job builds, and a new push cancels the run still going for the same pull request or branch ([what keeps CI green](02-testing.md#what-keeps-ci-green)).
  The user chose 8 jobs, each running a share of the scenarios balanced by their times, then on 2026-11-21 one job per scenario, longest first, which a trial measured at 18 minutes 54 seconds against the shares' 19 minutes 12 seconds ([build log](log.md)).
- A release runs neither the checks nor the bench again, once CI has passed on its commit on `main` ([a release](01-the-build.md#a-release)).
  Releases are public, pre-v1 builds included.
- One relay, in Frankfurt, so `nyc` leaves `src/relays/relays.toml` ([the network's units](../network/02-units.md)' note of 2026-11-20).

The user changed how releases and the backend ship on 2026-11-21, once CI ran:

- A release is merging a pull request, and nothing else is done by hand: a workflow keeps the release pull request open with the next version, from the commits' conventional titles, and the release's notes, from their `Release-Note:` trailers, and a release runs when CI passes on the merged release commit ([a release](01-the-build.md#a-release)).
  No session in the sim checks a release first ([before a release](02-testing.md#before-a-release)).
- The backend deploys whenever CI passes on `main`, apart from releases ([the backend](01-the-build.md#the-backend)).
- Commits follow conventional commits, as [writing.md](../../../.claude/rules/writing.md#commit-messages) has them.
- A relay deploys by hand, and a new token reaches every relay before its commit reaches `relay-tokens` ([their configuration](../network/02-units.md#their-configuration)).

Builds: what waits for the end because it's on GitHub ([how the stages are ordered](#how-the-stages-are-ordered)):

- CI's workflow, `.github/workflows/ci.yml`, with the bench's programs built once, a job per scenario from `tools/bench/order.ts`, and `tools/ci.ts` ([CI](../architecture/02-code-map.md#ci), [the build's CI](01-the-build.md#ci), [what keeps CI green](02-testing.md#what-keeps-ci-green))
- the release pull request's workflow, `release-pr.yml`, and the release workflow, `release.yml`, with `tools/release.ts`'s steps and `tools/lib/changes.ts`, which reads the commits since the last release ([a release](01-the-build.md#a-release))
- the backend's first deploy to Cloudflare, its D1 database made and its migrations applied, and `backend.yml`, which deploys it whenever CI passes on `main`, with `tools/backend.ts` ([the backend](01-the-build.md#the-backend))
- the profiles' workflow, `profiles.yml`, the `pages` branch, and the Pages site at `profiles.dualinput.app` ([profiles in this repository](../architecture/02-code-map.md#profiles-in-this-repository), [publishing](../profiles/02-units.md#publishing))
- CI's check that a released level's files match each release tag that holds the level, which `tools/check.ts` runs and the profiles' publish runs first, as [stage 10](#10-profiles) left it here
- the relay in Frankfurt, on a droplet of ours at `fra.relay.dualinput.app` ([their configuration](../network/02-units.md#their-configuration))
- the repository's secrets: a read-only deploy key for `dual-input/relay-tokens`, and a Cloudflare token
- `tools/replay.ts`, which fetches the core a recording's release shipped ([running a replay](../core/01-loop-and-edge.md#running-a-replay))

The repositories of ours beside this one exist already, made in stages 7 and 11b ([how the stages are ordered](#how-the-stages-are-ordered)).
Needs: every stage before it.

Tests:

- From stage 1: CI's time against the 20 minutes of [budgets for the workspace](../architecture/02-code-map.md#budgets-for-the-workspace), with `cargo build --timings`; one commit built on our development machine and on CI's runner gives one hash ([the build's cases on a desk](01-the-build.md#cases-for-the-bench)); and the runner, set up from nothing by the steps for a new PC in [building every target](../architecture/02-code-map.md#building-every-target), builds and tests the tree.
- From stage 3: whether a GitHub-hosted Windows runner holds three cores, two relays, and their proxies ([testing's left open](02-testing.md#left-open)); and a pull request's bench within the code map's 20 minutes, as a job per scenario beside the others ([testing's budgets](02-testing.md#budgets)).
- [The build's cases on a desk](01-the-build.md#cases-for-the-bench) for a release: the first release publishes with no delta, and a run for a version that's published stops at its first step.
- The release pull request: a `fix` since the last release raises the patch and a `feat` the minor, both `Cargo.toml` files, both `Cargo.lock` files, and `stamp.ts` take the version, and its body groups the `Release-Note:` trailers.
- From stage 7: once `fra.relay.dualinput.app` points at our droplet, `node src/relays/deploy.ts fra` deploys the relay, and it answers `/ping` over HTTPS with the certificate it took from Let's Encrypt, before the first release ([their configuration](../network/02-units.md#their-configuration)).

Exit: on GitHub's runners, CI passes on a pull request and on `main`, the bench as a job per scenario, and the [build log](log.md) has CI's times against the 20 minutes and whether a runner held three cores and two relays; the release workflow has published 0.1.0 from its release commit once CI passed on it, and a release pull request has opened for the next; the backend deploys when CI passes on `main` and answers at `api.dualinput.app`, the relay at `fra.relay.dualinput.app`, and the profiles' index at `profiles.dualinput.app`.
The cases that need a second release, and the session with friends that stage 15 left here, wait for [stage 23](#23-v1s-release)'s sessions with friends (user, 2026-11-21).

Done on 2026-11-21: CI passed on pull requests and on `main`, the bench a job per scenario, 0.1.0 published from its release commit, the release pull request for 0.2.0 opened, and the backend, the relay, and the profiles' site answer ([build log](log.md#2026-11-21-010-published-from-a-release-commit-at-mains-tip-and-toolsreplayts-replayed-the-released-cores-own-recording)).

## 22b Test sessions

Designs first: test sessions, in which the author's core sends each new bundle of a profile to the crew and every machine reloads it mid-session, which moved to v1 on 2026-11-21 ([the product plan's picks](../product/plan.md#3-v1-or-later)), with the three things node 4's review found a reload needs, which [testing an edit](../profiles/01-format-and-delivery.md#testing-an-edit) lists.
The user settled it that day, and [test sessions](../profiles/02-units.md#test-sessions) carries it (user, 2026-11-21):

- Any member's core sends a new bundle from its local folder, the PF's loader pins the newest it gets, after preflight too, and no setting turns a test session on.
- The local folder defaults to `profiles\local\` in the core's data folder, where [stage 22d](#22d-the-profile-extension)'s extension writes each bundle as [writing a bundle there](../profiles/02-units.md#writing-a-bundle-there) has it.
- A local bundle the session pins reaches each member that lacks it, from the PF's core, so a crewmate needs none of the author's files.
- While the profile is unpublished, the EFB app's session card shows the pinned bundle's short hash and who saved it, each crew row the short hash that member's PC runs, and the banner says once when every PC in the flight has loaded a new one.
- A profile's unload ends the sim work of the features that load a profile and no other's, since flight-model sync's `Lead` and `Follow` would otherwise end at a reload in flight ([architecture log](../architecture/log.md#2026-11-21-a-profiles-unload-ended-every-features-sim-work-flight-model-syncs-included-so-it-ends-only-the-work-of-features-that-load-a-profile)).
- Known limits: a reload starts each counted entry's shadow value at its `default`, the crew's figures go and come back at each reload, and a change made while a machine's profile reloads is lost.

Builds:

- in `profile-loader`: the local folder's default, and its listing each second while a session is held, which reads a file again when its size or last-modified time changed; a new local bundle that covers the session's aircraft kept in the cache and offered to the PF on `BUNDLES`, and passed on to the PF by a core that gets it after control passed; the PF's pin of the newest offer, after preflight too, naming whose it is; a pinned local bundle sent to every other member once its pin lands, and to each member at their `LinkUp`; every local bundle offered, sent, or received kept in the cache; a local pin loading from the cache or the local folder, and waiting for its bytes; the match check's `Loading`; the slice's `test`; and the banner's notice once every PC in the flight has loaded a new local bundle ([the local folder](../profiles/02-units.md#the-local-folder), [test sessions](../profiles/02-units.md#test-sessions), [the pin](../profiles/02-units.md#the-pin), [loading](../profiles/02-units.md#loading), [the match check's item](../profiles/02-units.md#the-match-checks-item))
- in the message crate's profiles module: the channel `BUNDLES`, the pin's `from`, `Bundle::Loading`, and `ProfilesSlice`'s `test`
- in `kernel` and the core's jobs edge: each listed file's last-modified time
- in `sim-service`: a unit's mark that its sim work ends with the profile, which state sync and avatars take, so a profile's unload ends their routines and closes their connections alone ([02-code-map](../architecture/02-code-map.md)'s note of 2026-11-21); and flight-model sync's comment that leaned on the old rule
- in `efb-shell`: the session card's line and the crew rows' hashes ([a test session shows the bundle each PC runs](../interface/decisions.md#a-test-session-shows-the-bundle-each-pc-runs))

Needs: every stage before 22, so it can be built beside stage 22.

Tests:

- From [the profiles' cases](../profiles/02-units.md#cases-for-the-bench), on the bench, with the stand-in sim and the local profiles' site:
  - In the `profiles` scenario: the PF pins a local bundle at the session's start, and a member whose local folder lacks it gets it from the PF and loads it.
  - In a scenario of its own, `test-sessions`, with a crew in flight on a profile of the scenario's own:
    - After preflight, a new bundle in the PF's local folder: the pin moves to it, both cores reload it, the following core catches up, the slice shows its short hash for both PCs, and the banner says once that both loaded it.
    - A local file written again with the same bytes moves no pin.
    - Through a reload in flight, flight-model sync's `Follow` runs on.
    - With settling at 4s, a reload more than 4s after Ready to fly ends its catch-up without waiting to settle.
    - A new bundle in the following pilot's local folder reaches the PF, which pins it, naming that pilot.
    - An entry whose write function hit the sandbox's limit, which stopped syncing, syncs again once a new bundle fixes it.
    - A pilot who joins after a new bundle was pinned gets it from the PF and loads it.
- As the profile loader's own tests: the match check's comparison shows no difference while a member is loading.

The stage changes the kernel and the core's edge, so it closes on the whole bench, which CI runs on the stage's pull request, as a job per scenario, since our development machine's disk was short (user, 2026-11-21).

Exit: on our development machine, `node tools/check.ts` and the scenarios the stage touches pass, and on CI the whole bench passes, the `test-sessions` scenario and the `profiles` scenario's changed case among them; on the bench, a bundle the following pilot's local folder gets reloads on both cores in flight, and a bundle the PF's gets reloads while `Follow` runs on; and the [profiles' log](../profiles/log.md) has an entry for the cases.
Done on 2026-11-21: on our development machine, `node tools/check.ts` passed, and the three scenarios the stage touches passed 26 of 26, a reload's catch-up ending 1,494ms after its load against 4s of settling ([profiles log](../profiles/log.md#2026-11-21-stage-22bs-test-sessions-pass-their-bench-cases-and-a-reloads-catch-up-ended-15s-after-its-load-against-4s-of-settling)); on CI, the stage's pull request, rebased onto stage 22c, passed every check, its 30 scenario jobs among them, before it merged.

## 22c The format's audit

Builds: the changes to the profile format, the profile engine, and the profile builder that an audit of the format finds before v1's release fixes level 1, which [the profiles log](../profiles/log.md#2026-11-21-the-formats-audit-before-level-1-freezes-puts-maps-on-their-own-lines-types-instrument-readings-and-names-one-layout) lists:

- the reader's refusal of a bracketed map, with an error that shows the map written out, and its skip of a leading byte-order mark ([01-format-and-delivery](../profiles/01-format-and-delivery.md)'s note of stage 22c)
- `instrument(key, path, 'string')`, an `instrument()` entry typed as a number or as text in level 1's declarations, and `instrument-reads`' check of a reading's kind ([01-plugins](../plugins/01-plugins.md)'s note of stage 22c)
- each level's two schemas, `profile.json` and `module.json`, and a bundle's top-level keys in [the layout](../profiles/01-format-and-delivery.md#layout)'s order ([02-units](../profiles/02-units.md)'s note of stage 22c)
- the 58P's profile in the layout, its maps on their own lines and its `instrument()` values without `Number()`
- CI's check that a released level's files match each release tag from 1.0.0 on, in `tools/lib/levels.ts`

Designs first: the audit's list of gaps, each ruled on by the user, on 2026-11-21.
Needs: every stage before 22, so it can be built beside stage 22.
Tests: the profile engine's cases for a bracketed map, a byte-order mark, a schema for each kind of file, and the bundle's order; the builder's type check of a number and a text `instrument()` entry; `instrument-reads`' cases for a reading of each kind; `tools/levels.test.ts` for which tags hold a level; and the scenarios that load the 58P's profile, `state-sync`, `clients-panels`, and `profiles`.
Exit: `node tools/check.ts` passes with the 58P's profile in the layout, and `node tools/bench.ts state-sync clients-panels profiles` passes.
Done on 2026-11-21: the bug the audit found in the aircraft picker, which kept a pick of the 58P on "Loading…" since it waited for the sim's names for the aircraft to match the profile's, went to the user rather than into the stage, and was fixed in a commit of its own that day at the user's word.

## 14d `h-events` in one panel

Designs first: how state sync's `h-events` stays in one panel, since its rule knew that panel by its instruments' keys, two of the Baron's panels each hold one instrument keyed `GNS_DISABLED`, and the `clients-panels` scenario sent it to both of its panels that copy them, 18 and 19, during stage 22c ([sync log](../sync/log.md#2026-11-21-h-events-went-to-two-panels-whose-instruments-share-a-key-since-state-sync-knew-its-panel-only-by-its-keys)).
The clients crate keeps it there, by the panel's name, as [05-units](../sync/05-units.md)' note of 2026-11-21 has it (user, 2026-11-21).

Builds:

- in `clients`: `one_panel_module`, which registers a panel module that goes to one panel at a time ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md)'s note of 2026-11-21)
- in `state-sync`: `h-events` registered that way, with a rule that remembers no panel

Needs: 14.

Tests:

- As the clients crate's own tests: of two panels holding instruments of one key, a one-panel module goes to the first answered, to its new socket when it reloads, and never to the other, even when the other joins again; and after the profile unloads and loads again, to one panel.
- On the bench, in the `clients-panels` scenario: state sync's `h-events` goes to one of two panels that hold instruments of one key, and to that panel's new socket when it reloads.

It closes on `clients-panels`, whose panels share keys; `state-sync`, whose cases hear `H:` events through `h-events`; and `pointer-sync`, whose panels reload and share the tablet's key.

Exit: on our development machine, `node tools/check.ts` passes, and `node tools/bench.ts clients-panels state-sync pointer-sync` passes, the new case among them, which fails before the fix.
Done on 2026-11-21: `node tools/check.ts` passed, and the three scenarios passed 28 of 28, the new case among them, which failed before the fix ([sync log](../sync/log.md#2026-11-21-h-events-went-to-two-panels-whose-instruments-share-a-key-since-state-sync-knew-its-panel-only-by-its-keys)).

## 22d The profile extension

Designs first: the profile extension, a VS Code extension for writing profiles, which moved to v1 on 2026-11-21 ([the product plan's picks](../product/plan.md#3-v1-or-later)).
The user designed it with us on 2026-11-21 and 2026-11-22, a call at a time, and [03-the-extension](../profiles/03-the-extension.md) carries it (user):

- It's on VS Code's Marketplace for Windows and attached to each release, and its `.vsix` carries `dualinput-profile-builder`, so any author on Windows builds and tests a profile without the workspace's setup, which reverses the rule that v1 ships no authoring tool.
- It's a thin client in TypeScript of a language server in Rust, `dualinput-profile-builder serve`, over a new engine, `profile-language`, with TypeScript's language service in the server's QuickJS-ng, in two runtimes, so no request waits behind a check or a build.
- It gives `profiles/aircraft/` and `profiles/modules/` a language of its own, keeping `.yaml`, highlighted in colors of its own that start from fsc-editor's; completion, hovers, and checks from the engine; Go to Definition, references, renames, and workspace symbols; an outline from the headings; a formatter that writes the format's layout and reflows comments, with indentation as you type from it and a check of layout in CI; and snippets.
- A manual save builds into the local folder, and the server owns building, so the extension holds only VS Code's UI.
- The format puts `seats` last, takes single quotes outside scripts, and runs a heading's rule on to column 100 ([profiles log](../profiles/log.md#2026-11-22-the-profile-extensions-design-finds-what-vs-code-reads-of-a-vsix-and-a-language-what-vsce-costs-and-what-zed-allows-and-the-format-puts-seats-last-and-takes-single-quotes)).
- The three of fsc-editor's features that need the sim, live values, Run, and the display picker, go to [stage 22g](#22g-the-extension-in-the-sim).

Builds:

- `src/engines/profile-language` ([how it works](../profiles/03-the-extension.md#how-it-works))
- in `tools/profile-builder`: `serve`, the language server, with its two runtimes and building on save, and `format`, with `--check` ([the language server](../profiles/03-the-extension.md#the-language-server), [TypeScript in two runtimes](../profiles/03-the-extension.md#typescript-in-two-runtimes))
- `src/apps/profile-extension`: the extension, its grammar, and its tests ([the extension](../profiles/03-the-extension.md#the-extension))
- `tools/lib/vsix.ts`, `node tools/build.ts extension`, and the extension's icon from `tools/icons.ts` ([packing and publishing](../profiles/03-the-extension.md#packing-and-publishing))
- in `profile-engine`: `seats` last among a bundle's keys; a double-quoted string outside scripts refused in an author's files; and each entry's `name:` as a doc comment on its key in the program TypeScript checks ([01-format-and-delivery](../profiles/01-format-and-delivery.md)'s note of stage 22d, [02-units](../profiles/02-units.md)' note of stage 22d)
- in `profile-build`: a script that declares `state`, `write`, `L`, `A`, `B`, `K`, or `H` refused, with the error `reserved-name` ([checks](../profiles/03-the-extension.md#checks))
- the 58P's profile, as the formatter writes it
- in `release.yml` and `tools/release.ts`: the `.vsix` attached to each release and published on the Marketplace ([the build](01-the-build.md)'s note of stage 22d)
- in `tools/check.ts` and the profiles' workflow: `format --check` on `profiles/`
- in `tools/map-check.ts`: `profile-language` on the engines' top line

Needs: 22c, for the format's audited level 1.

Tests:

- [The extension's cases](../profiles/03-the-extension.md#cases), and [its budgets](../profiles/03-the-extension.md#budgets) for a request inside a script and for the engine's checks on a keystroke.
- On the bench, the scenarios that load the 58P's bundle, whose bytes `seats` last changes: `state-sync`, `clients-panels`, `profiles`, and `test-sessions`.
- The extension's first publish on the Marketplace waits for the publisher the user makes and for a release, so it joins [stage 23](#23-v1s-release)'s tests.

The stage changes neither the kernel nor the core's edge, so it closes on those four scenarios.

Exit: on our development machine, `node tools/check.ts` passes, `format --check` on `profiles/` among it, and `node tools/bench.ts state-sync clients-panels profiles test-sessions` passes; the `.vsix` that `node tools/build.ts extension` writes installs in VS Code, each of the extension's features works on the 58P's profile, and a manual save writes into the local folder a bundle whose hash is the one `dualinput-profile-builder build` gives for the same file; and the [profiles' log](../profiles/log.md) has the budgets' measurements.

Done on 2026-11-22.

## 22e The docs

Builds: the documentation for pilots, for developers of Dual Input's code, and for profile authors ([the product plan](../product/plan.md#3-v1-or-later)).
Designs first: a guide to how each of the three is written, from research the user directs, where the docs are published, and what `CLAUDE.md` says of `docs/` once agents write there.
Needs: nothing for the guides; 22b, 22c, 22d, 22g, and 22h for the profile authors' documentation, 22g's of what [04-the-extension-in-the-sim](../profiles/04-the-extension-in-the-sim.md#what-this-changes-elsewhere) asks it to say, and 22h's of what [05-the-recorder](../profiles/05-the-recorder.md#what-this-changes-elsewhere) asks.

## 22f The graphics

Builds: the graphics Dual Input presents itself with ([the product plan](../product/plan.md#3-v1-or-later)), each drawn by a tool from the tree ([the graphics](01-the-build.md#the-graphics); [their looks](../interface/decisions.md#dual-inputs-icon-is-the-sky-glyph-on-the-apps-background-and-the-sims-toolbar-and-efb-get-the-glyph-alone-in-white)):

- `tools/icons.ts`, which draws the desktop app's and the tray's icon, our app's icon in the EFB and the banner's toolbar icon, and the avatar of our GitHub organization and Discord server, from the glyph in `src/packages/ui/src/glyph.ts`
- `tools/screenshots.ts`, with `tools/lib/dev-pages.ts` and playwright-core, which pictures every scene of the EFB app's, the banner's, the desktop window's, and the welcome's dev pages in `docs/screenshots/`, a layout beside each for the docs' crops, with the scenes and the handle each dev page gives it and the standing figure's `FigureStill` ([the screenshots](01-the-build.md#the-screenshots))
- the repository's social preview, which the same tool draws and the README opens with; the README's other pictures are stage 22e's, which writes the words around them (user, 2026-11-21)

Designs first: each graphic's look, with the user, and the screenshot tool.
Needs: every stage before 22, so it can be built beside stage 22.

Tests, by hand, since the tools have no tests of their own:

- Three runs of `node tools/screenshots.ts` in a row, the second and third changing no file ([build log](log.md#2026-11-21-a-picture-of-an-apps-screen-comes-out-the-same-on-every-run-once-its-clock-fonts-motion-chance-drawing-and-standing-figure-are-held)).
- Each layout's boxes drawn over four pictures land on their elements, and the tool's social preview matches the draft the user chose, pixel for pixel.
- The icons by eye: the tray icon in the tray on our development machine (user, 2026-11-21), and the glyph alone beside other packages' toolbar icons and EFB icons, drawn as the EFB's stylesheet draws them; in the sim, at its next sitting, with the toolbar button's hover and open states.

Exit: on our development machine, `node tools/check.ts` passes, and a second run of `node tools/screenshots.ts` changes no file; the avatar is set on GitHub and Discord, the social preview in the repository's settings, and the README opens with it.
Done on 2026-11-21: 105 pictures came out identical on three runs in a row, `node tools/check.ts` passed, the user set the avatar on GitHub and Discord and uploaded the social preview, and the icons in the sim's toolbar and EFB wait for the next sitting to be looked at.

## 22g The extension in the sim

Designs first: three of fsc-editor's features that the user picked for the profile extension on 2026-11-21, which need the sim, so they come after [stage 22d](#22d-the-profile-extension): live values on each `watch:` line; Run, which fires an entry's write with a value the author types; and the display picker, which lists the cockpit's panels for `displays` and outlines one in the sim.
The user designed them with us on 2026-11-22, a call at a time, and [04-the-extension-in-the-sim](../profiles/04-the-extension-in-the-sim.md) carries it (user):

- They work in a session's flight, through the author's own running core: `dualinput-profile-builder serve` connects to it as one more client, and a feature of the core's, `authoring`, serves it; the extension starts no session.
- Live values show on `watch:` lines alone, from the open text, always visible in fsc-editor's box at the end of the line, and a misspelled `L:` reads 0, with no mark.
- The Dual Input panel, a webview in VS Code's right-hand side bar drawn with our kit, holds a status line, Run, and the picker.
- Run starts from a lens above each entry and runs the open text; it shows the values the entry has read, a preview of what it sends, and the revert notice; it takes a step count on a counting entry; and it runs only in the session's profile and its modules, and on an entry the PF owns only for the PF.
- The picker lists every panel and outlines the row you're on, with no "pick in cockpit"; a `panels` count in the core's announcement brings back the panels told `none`, so every panel stays while the extension is connected.
- Every feature reads and writes the sim's variables and fires its events by a profile's names through a platform crate of its own, `sim-variables`, which takes state sync's routes, with a lifetime of its own, one flight, and the sync engine gains one entry's write outside a sync.
- The profile authors' documentation of these features goes to [stage 22e](#22e-the-docs).

Building found that moving state sync's routes moved their code but not their lifetimes, and the user took a reworked `sim-variables` with four rules of its own on 2026-11-22 ([profiles log](../profiles/log.md#2026-11-22-building-22g-found-that-moving-state-syncs-routes-to-the-platform-moved-their-code-but-not-their-lifetimes-so-sim-variables-has-one-of-its-own)).

Builds:

- `src/platform/sim-variables`, with its connection for each flight, the panel modules `h-events` and `instrument-reads`, and `NamedEvents` as the routine host's own `HtmlAndInputEvents` ([reaching the sim by name](../profiles/04-the-extension-in-the-sim.md#reaching-the-sim-by-name))
- in `sync-engine`: `write_once`, `plan`, and the mark of an engine that only runs the writes it's asked for ([the sync engine's single write](../profiles/04-the-extension-in-the-sim.md#the-sync-engines-single-write))
- in `state-sync`: its watches and writes through `sim-variables` ([sync's units](../sync/05-units.md)' note of stage 22g)
- in `sim-service`: `close`, a unit closing its own connection ([the sim seam](../core/03-sim-seam-and-wasm-module.md)'s note of stage 22g)
- `src/features/authoring`: its crate in the core and its panel module `outline` ([what `authoring` does](../profiles/04-the-extension-in-the-sim.md#what-authoring-does), [the display picker](../profiles/04-the-extension-in-the-sim.md#the-display-picker))
- in `clients`: answering the panels once every unit has handled the profile's load, each open panel's name and keys for features, and answering the open panels again when a module's rule changes or the profile unloads; in `sim-service` and `page-client`: the announcement's `panels` count ([every panel stays while the extension is connected](../profiles/04-the-extension-in-the-sim.md#every-panel-stays-while-the-extension-is-connected))
- in `tools/profile-builder`'s `serve`: the connection to the author's core, the open files' names, the bundle for Run, the boxes' text, the lenses, and the picker's edit ([the connection](../profiles/04-the-extension-in-the-sim.md#the-connection))
- in `src/apps/profile-extension`: the boxes, the lenses' commands, the setting `dualInput.dataFolder`, the Dual Input panel's webview in the kit with its dev page in `tools/lib/dev-pages.ts`, and `engines.vscode` raised to the version that takes the secondary side bar ([the Dual Input panel](../profiles/04-the-extension-in-the-sim.md#the-dual-input-panel))
- in `tools/bench`: the fake `serve` and the scenario `authoring`; and `tools/sim/authoring.ts`, the session's cases in the sim
- in `tools/map-check.ts`: `sim-variables` and `authoring`

Needs: 22d.

Tests:

- [The design's cases](../profiles/04-the-extension-in-the-sim.md#cases), on the bench, as unit tests, by hand, and in one session in the sim, and [its budgets](../profiles/04-the-extension-in-the-sim.md#budgets).
- State sync's scenarios on its routes through `sim-variables`: `state-sync`, `clients-panels`, `test-sessions`, and `profiles`.

The stage changes the kernel, with a job that reads bytes off the loop, and the announcement and `page-client`, which every scenario's pages run on, so it closes on the whole bench.

Exit: on our development machine, `node tools/check.ts` passes, and `node tools/bench.ts` passes, the `authoring` scenario among it; the `.vsix` that `node tools/build.ts extension` writes installs in VS Code, and the user has seen the Dual Input panel's dev page in each of its states; in one session in the sim on the 58P, `node tools/sim/authoring.ts` reports each of its cases passed; and the [profiles' log](../profiles/log.md) has the budgets' measurements and the session's report.

Done on 2026-11-23: CI ran `node tools/check.ts` and the whole bench in place of our development machine, by the user's call, and both passed on the pull request's last commit, the `authoring` scenario among them, with a new `state-sync` case for a crew whose cockpits differ; the user installed the `.vsix` and saw the panel's dev page in each state; and `node tools/sim/authoring.ts` passed its 32 cases in one session on the 58P, every budget held ([profiles log](../profiles/log.md#2026-11-23-stage-22gs-session-in-the-sim-passed-its-32-cases-in-the-58p-every-budget-held)).
The session found a catch-up that crawls behind writes that never land, which the user took as a known limit of stage 14c ([sync log](../sync/log.md#2026-11-23-a-catch-up-crawls-when-its-writes-never-land-since-each-toggle-stepping-write-or-write-function-waits-out-the-15s-check-of-the-write-before-it)).

## 22h The recorder

Designs first: the recorder, which the user proposed for the profile extension on 2026-11-23, so one author on one PC sees what a crewmate's changes do in their cockpit.
The user designed it with us on 2026-11-23, a call at a time, and [05-the-recorder](../profiles/05-the-recorder.md) carries it (user):

- Record, Stop, and Play: a recording holds the cockpit stream's own messages from Record to Stop, of state sync's kinds and pointer sync's gestures, and each catch-up step's payload at Record.
- Play puts the cockpit back through that catch-up, then plays each message at its recorded time from a pretend sender, through the stream's order and state sync's own handlers, which run the saved profile.
- It works alone in a session's flight, with the open text saved, and its buttons are off with a reason otherwise.
- One recording, kept until the next Record or the session's end, in `tape`, a platform unit, so any feature's messages can join it.
- The Dual Input panel becomes a surface of islands, with the recorder's island at the bottom: Record, Stop, and Play, as on a tape deck.
- Flight-model replay, which the user added on 2026-11-24: a recording also holds flight-model sync's samples, and a playback is a second reason for flight-model sync to run `Follow`, from Play, fed from the recording, so the aircraft goes back to where it stood at Record and flies the recorded path, with control left with the author.

Builds:

- `src/platform/tape` ([how it works](../profiles/05-the-recorder.md#how-it-works)), with a feature's channel recorded and played back ([what a feature registers with `tape`](../profiles/05-the-recorder.md#what-a-feature-registers-with-tape))
- in `cockpit-stream`: recorded kinds, `CockpitSent`'s body, a step's payloads on request, and the pretend sender ([what the cockpit stream gains](../profiles/05-the-recorder.md#what-the-cockpit-stream-gains))
- in `state-sync`: its three kinds marked recorded; in `pointer-sync`: its gesture kind marked recorded
- in `src/features/flight-model/core`: its samples handed to `tape` while a recording runs, and `Follow` run through a playback, fed the recording's samples ([flying the recorded path](../profiles/05-the-recorder.md#flying-the-recorded-path))
- in `tools/profile-builder`'s `serve`: the island's view, the saved check, and the commands
- in `src/apps/profile-extension`: the panel as islands, the recorder's island, and its states on the dev page ([the recorder's island](../profiles/05-the-recorder.md#the-recorders-island))
- in `tools/bench`: the scenario `tape`
- in `tools/map-check.ts`: `tape`

Needs: 22g.

Tests:

- [The design's cases](../profiles/05-the-recorder.md#cases), on the bench, as unit tests, by hand, and in the sim, and [its budgets](../profiles/05-the-recorder.md#budgets).
- State sync's scenarios, on the cockpit stream they run on: `state-sync`, `clients-panels`, `test-sessions`, and `profiles`.
- Flight-model sync's scenario, `flight-model`, on the rule for which routine runs, which flight-model replay changes.

The stage changes the cockpit stream, which every scenario with a crew runs on, so it closes on the whole bench.

Exit: on our development machine, `node tools/check.ts` passes, and `node tools/bench.ts` passes, the `tape` scenario among it; the `.vsix` that `node tools/build.ts extension` writes installs in VS Code, and the user has seen the recorder's island in each of its states on the dev page; in one session in the sim on the 58P, recordings play back as [the design's cases in the sim](../profiles/05-the-recorder.md#cases) have it; and the [profiles' log](../profiles/log.md) has the budgets' measurements.

Done on 2026-11-24: on main with the session's two restart fixes, `node tools/check.ts` passed, and `node tools/bench.ts tape flight-model session` passed its 40 tests with both budgets held ([profiles log](../profiles/log.md#2026-11-24-the-recorders-messages-reached-the-stream-within-38ms-of-their-recorded-times-and-a-recording-held-about-205-bytes-an-entry)).
The whole bench ran once, before pointer sync replay and flight-model replay joined the stage, and passed 201 of its 202 tests, `authoring`'s check of 1ms an input failing under the full bench's load and passing alone ([profiles log](../profiles/log.md#2026-11-24-stage-22hs-recorder-passed-its-bench-scenario-and-a-playback-that-ended-mid-step-had-left-the-stream-pretending)).
The user installed the `.vsix`, saw the island in each of its states on the dev page, and kept as built the line before preflight ends and the island reading "recorded" while a knob still steps through a playback's last changes.
In the sim on the 58P, recordings put the cockpit back and played its changes, and flew the aircraft along its recorded paths ([profiles log](../profiles/log.md#2026-11-24-in-the-sim-playbacks-flew-the-58p-back-along-its-recorded-paths-with-follow-from-play-to-the-end)).

## 20c Combinations for the take-control key, and Learn more on its warning

Designs first: the user's call on 2026-11-25 that the take-control key binds with Shift, Ctrl, or Alt held, such as Ctrl+F9, where [the Settings tab](../interface/decisions.md#the-settings-tab-holds-the-binding-the-output-device-the-recordings-and-the-version) had bound a key alone.
A combination keeps a key typed into one of the sim's text boxes from taking control, and the Windows key binds nothing, alone or held.
How a combination matches is this stage's: only with exactly its modifiers held, the left and right keys alike, and a hold from its key's down to the up of any of its keys ([04-core-helper](../core/04-core-helper.md)'s note of 2026-11-25).
The user's call the same day, made while [stage 22e](#22e-the-docs) wrote the docs, that the lost link's warning under the button reads "If you take control, your session might desync.", with Learn more to the docs for pilots ([take control](../interface/decisions.md#take-control-is-a-held-button-under-the-tabs-with-one-hold-of-035s)).

Builds:

- the message crate's `Input::Key` with `ctrl`, `shift`, and `alt`, which a setting saved before reads as false, and take-control's command `LEARN_MORE`
- the helper's next press and bindings: a key with the modifiers held as it goes down, nothing for a modifier alone or a key with the Windows key held, a name such as "Ctrl+F9", and a combination's release at the up of any of its keys; and, which the code review found, any modifier `GetAsyncKeyState` says is up let go at each key's down, so a release on the lock screen never leaves one held
- in `src/features/take-control`: the warning's new line, on the banner and under the button, and under the button Learn more, which the core answers by opening the docs' section in the pilot's browser, with a toast
- in `tools/sim/desk`: keys held together, and pressed and let go one at a time, for `node tools/sim/core-helper.ts desk`, whose binding becomes Ctrl+F24, and whose check of the capture takes the helper's 2% budget

Needs: 20.

Tests:

- As the helper's own tests: a key presses with exactly the modifiers held, on either side; a modifier alone, and a key with the Windows key held, give nothing; a modifier whose release never came is let go once Windows says it's up, and Windows' state never holds one down; and a combination holds until any of its keys goes up.
- As the message crate's own tests: a combination reads from its setting and crosses the pipe whole, and a key saved before reads with no modifier.
- On the bench, in the `take-control` scenario: rebinding to Ctrl+B takes control by the combination, and the lost link's warning reads the new line; and the `core-helper` scenario, whose keys gain the three fields.
- On the real helper, in `node tools/sim/core-helper.ts desk`: the bound Ctrl+F24 crosses held 2s and with a popped-out display in front, and not with another program in front; F24 alone and Ctrl+Shift+F24 don't cross; the right Ctrl crosses as Ctrl; letting go of Ctrl first ends the press; and Ctrl+Shift+F22 binds with both modifiers and a name that leads with them.
- No test sends `LEARN_MORE`, since its job opens the pilot's browser, and take-control has no harness of its own, where the clients crate checks the same job for our Discord's link.

It changes neither the kernel nor the core's edge, so it closes on the `take-control` and `core-helper` scenarios.

Exit: on our development machine, `node tools/check.ts`, `node tools/bench.ts take-control core-helper`, and `node tools/sim/core-helper.ts desk` pass; and the [control log](../control/log.md) has an entry for the change.
Done on 2026-11-25: `node tools/check.ts` passed, and the two scenarios passed their 20 tests.
The desk run passed every case of keys and binding in each of three runs on the final helper ([control log](../control/log.md#2026-11-25-the-take-control-binding-takes-shift-ctrl-and-alt-combinations-matched-exactly)).
The first run also passed the mouse's cases and failed only the capture's CPU check, at 1.27% of a core against a 1% the desk run kept from before the helper's 2% budget, so the stage raised that check to 2%.
The two runs after passed it and lost the mouse's corner clicks while someone used the PC; this stage doesn't change the mouse's path.

## 23 v1's release

Builds: v1's release, through the release workflow, after the last sessions with friends.
Needs: every stage before it.

Tests, from stage 22 (user, 2026-11-21):

- [The build's cases on a desk](01-the-build.md#cases-for-the-bench) that need a second release: the next release publishes with a delta from the one before, and a run whose draft is left unpublished leaves a draft the next run deletes before it publishes; and the release pull request's merge releases it once CI passes.
- From stage 22d: once the user has made the Marketplace's publisher, `dual-input`, with a Trusted Publishing policy for `release.yml`, a release publishes the profile extension there, and it installs in VS Code from the Marketplace ([packing and publishing](../profiles/03-the-extension.md#packing-and-publishing)).
- From stage 15, in a session with friends on releases the release workflow made, through the servers it deployed: Setup.exe run over the install during the session, a crewmate's core seeing its link lost at an uninstall, a host who is behind, an update downloaded in the app, through `GithubSource` and its delta, and if Windows shows its firewall prompt on a PC with no rule naming the core, whether the desktop app's fix deletes the block rules a canceled prompt leaves, which stage 16's first flight with friends left for the live path (user, 2026-11-12; [install log](../install/log.md#2026-11-12-in-a-session-an-update-downloads-and-waits-then-installs-as-the-sim-closes-the-trays-quit-reads-as-a-leave-and-a-session-raised-no-firewall-prompt-from-windows)).

Exit: [step 9](../product/plan.md#9-build-test-and-release-v1)'s exit happens.
