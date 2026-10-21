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
- Nothing on GitHub comes before [stage 22](#22-github): no pull requests, no workflows, no releases, no Pages site, and no repository of ours beside this one, since waiting on pull requests and CI slows the build down (user, 2026-10-18).
  Until then a stage's commits go straight to `main`, and are pushed once the user has reviewed the stage, and stage 22 builds CI as [testing](02-testing.md#what-keeps-ci-green) and [the build](01-the-build.md#ci) design it.

## Working a stage

1. Before writing anything for the stage, read each section its `Builds:` and `Tests:` lines link, with the notes at the top of each design doc they're in, since a doc's notes change the text below them ([step 8](../product/plan.md#8-v1-build-plan)).
   You'll know what the stage builds and what proves it.
2. If the stage has only its headline, write its lines in this plan, as [how a stage reads](#how-a-stage-reads) gives them, from what step 1 read.
   You'll see its `Builds:`, `Needs:`, `Tests:`, and `Exit:` lines.
3. If the stage has a `Designs first:` line, propose that design to the user, and once they agree, write it in the design doc it belongs to.
   You'll see the design in its doc before any of the stage's code.
4. Write the stage's code, and turn its cases into tests, as [left to each stage](02-testing.md#left-to-each-stage) says, until `node tools/check.ts` passes, and from stage 3 the whole bench too.
   You'll see every check pass on our development machine.
5. If the stage's system has cases in the sim, run them, and measure the stage's budgets in the sim, in one session in the sim ([in the sim](02-testing.md#in-the-sim)).
   You'll have each case's report and each measurement.
6. Measure the stage's budgets on the bench, on our development machine, and write each result, from the bench and from the sim, with how it was taken, in the log of the area it belongs to.
   A result that misses its budget goes back to the design that set it, as [left to each stage](02-testing.md#left-to-each-stage) says.
   You'll see a log entry for each budget.
7. Once the stage's exit has happened, make the stage's map with `/stage-map`: a private page that shows what each of the stage's parts does, why, and how its code works, which the user reads before the diff (user, 2026-10-20).
   Then show the user the map, and the stage's lines and its code together as one uncommitted diff, and ask whether to run the `code-reviewer` agent, as [CLAUDE.md](../../../CLAUDE.md#working-rules) says (user, 2026-10-18).
   You'll have the map's link and the user's answer, and if they want changes or a review, its findings fixed or answered, and the map published again if they changed what it shows.
8. Once the user has looked, add `Done on <YYYY-MM-DD>.` under the stage's `Exit:` line, commit the stage, and push it.
   You'll see the stage's commit on `origin/main`, and the next open stage is where the build stands.

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
- `apps/core`'s `main` and its list of units, the queue and its stamps, the home folder's placeholder, the timer thread, tokio's runtime and its blocking pool, a sink for each output type, the panic hook, the log's subscriber, and starting and exiting, with FMA3 off, the data folder's named mutex, and the guard on the static C runtime ([threads](../core/01-loop-and-edge.md#threads), [the queue](../core/01-loop-and-edge.md#the-queue), [inputs](../core/01-loop-and-edge.md#inputs), [the core's math](../core/01-loop-and-edge.md#the-cores-math), [a panic](../core/01-loop-and-edge.md#a-panic), [starting and stopping](../core/01-loop-and-edge.md#starting-and-stopping), [logging](../core/01-loop-and-edge.md#logging))
- the recording's writer and `dualinput-core replay`, with the replay log's encoding in `recording-format`: its header, inputs, and checkpoints ([replay](../core/01-loop-and-edge.md#replay))
- the loop's Clippy rules: the root's `clippy.toml` and the workspace's lint on a `HashMap`'s order, which the loop's crates take ([one loop](../architecture/02-code-map.md#one-loop))

The sim thread comes in stage 4, the WebSocket server and the port file in stage 5, the marks' record in stage 8, the window thread in stage 9 with the session crate that handles the quit it pushes, the sandbox's stops' record in stage 12, and `tools/replay.ts` in stage 22.
The edge's jobs read and write files, and its other jobs, fetching over HTTPS and reading the clipboard, come with the first stage whose units start them.
The kernel's way for a crate of the platform's to put out an output, or draw a handle, for the unit whose call it carries out comes in stage 4, whose sim service is the first to need it, and a slice credited to its owner in stage 5 ([what keeps the drift from spreading](../recording/01-recording-and-bug-reports.md#what-keeps-the-drift-from-spreading)).
01-loop-and-edge's other cases and budgets are in the `Tests` lines of stages 3, 4, 5, 9, 15, and 18, each marked as from stage 2.

Designs first: four things [01-loop-and-edge](../core/01-loop-and-edge.md) left open, which the user agreed on 2026-10-20: the queue's lock ([the queue](../core/01-loop-and-edge.md#the-queue)), the 64-bit hash that folds the outputs ([outputs](../core/01-loop-and-edge.md#outputs)), the crate that gives ChaCha20 ([timers, jobs, and IDs](../core/01-loop-and-edge.md#timers-jobs-and-ids)), and how big the log file grows ([logging](../core/01-loop-and-edge.md#logging)).

Needs: 1.

Tests:

- A test of each rule in [the kernel's interface](../core/01-loop-and-edge.md#the-kernels-interface), among the kernel's own tests, a test unit that raises moments in a cycle among them.
- From [01-loop-and-edge's cases](../core/01-loop-and-edge.md#cases-for-the-bench): two edges push at once, and every stamp rises with its sequence number, over 200,000 pushes each, which the bench runs for minutes; a test unit that reads the clock is caught at the next checkpoint of its replay; and a replay on another commit refuses, naming the commit.
- From [the build's cases on a desk](01-the-build.md#cases-for-the-bench): a build with `RUSTFLAGS` set, even empty, stops at `apps/core`'s guard, in `tools/core.test.ts`; and the core imports no `api-ms-win-crt-*` DLL, by `dumpbin /imports`.
- From [01-loop-and-edge's budgets](../core/01-loop-and-edge.md#budgets): by hand, a timer fires within 2ms of its deadline at p99 on an idle PC, and the core holds under 30 MB of private working set with no session; among the tests, the core exits within 1s of its exit going out.

Exit: on our development machine, `node tools/check.ts` passes with the kernel's and `apps/core`'s tests among it.
In one of them, a core with units of the test's own records a run and exits within 1s, and the recording replays to every checkpoint, while a copy with one input's bytes changed names the first checkpoint after that input.
Done on 2026-10-20.

## 3 The bench

Builds:

- `tools/bench.ts` and `tools/bench/`: the runner, which builds the bench build into a target folder of its own, runs each scenario in `tools/bench/scenarios/` on Node's test runner with a data folder for each core, starts and kills the cores, and ends each scenario by replaying each core's recording; and the loop under load, which runs by hand on p10's capture of a flight ([the bench](02-testing.md#the-bench), [replays](02-testing.md#replays), [the loop under load](02-testing.md#the-loop-under-load))
- `apps/core`'s `stand-in` feature: the bench's socket, whose messages are the message crate's first, and the test units the scenarios drive ([its place](02-testing.md#its-place))
- the loop's stats in the core's log ([logging](../core/01-loop-and-edge.md#logging))
- `simconnect-types`; the sim seam's four inputs in `sim-client`, with the edge's own calls, which look for the sim's process and open and close a connection; and the stand-in sim's thread, the process it watches, its opens and closes, and the losses and quit messages a scenario asks for ([the stand-in sim](02-testing.md#the-stand-in-sim), [the sim seam](../architecture/02-code-map.md#the-sim-seam), [the edge](../core/03-sim-seam-and-wasm-module.md#the-edge))

The stand-in answers no SimConnect call until [stage 4](#4-the-sim-seam-our-wasm-module-and-our-package), which builds each call in `sim-client`, the sim edge, and the stand-in together, so the stand-in learns each call beside the edge that tries it in the sim (user, 2026-10-20).
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

Builds: the sim service, sim awareness, the sim edge, the routine host, `sim-package/routines/`, `sim-package/wasm-module`, and our package with `node tools/build.ts install` ([03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md), [our package](01-the-build.md#our-package)); the rest of `sim-client`, with each SimConnect call the sim service makes and the stand-in's answer to it, and the stand-in in the edge's place in the bench build, with its frames, its aircraft, its faults, its routines through the routine host, and the stub the bench starts for each sim ([the stand-in sim](02-testing.md#the-stand-in-sim)); the SimConnect SDK's version, `simconnect_types::SDK_VERSION`, in the recording's header ([what a recording holds](../core/01-loop-and-edge.md#what-a-recording-holds)); and the kernel's way for the sim service to put out a call, and draw its handle, for the unit whose call it carries out ([what keeps the drift from spreading](../recording/01-recording-and-bug-reports.md#what-keeps-the-drift-from-spreading)).
Needs: 3.

Tests:

- From stage 2: the timers fire within 2ms of their deadlines at p99 with the sim running and the PC busy, in this stage's session in the sim ([01-loop-and-edge's budgets](../core/01-loop-and-edge.md#budgets)).
- From stage 3: two bench cores on one PC each see only their own stub, and killing one stub ends that core's sim alone, as a crash ([the bench's own cases](02-testing.md#cases-for-the-bench)).

## 5 Clients and the panel bridge

Builds: the clients crate, `page-client`, the panel bridge, and our `VCockpit.js` override, with the sim's stock files it starts from, the Coherent GT check, and the bench's fake pages ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md), [the sim's stock files](01-the-build.md#the-sims-stock-files), [the Coherent GT check](01-the-build.md#the-coherent-gt-check)).
Needs: 4.

Tests:

- From stage 2: a feature's command handler reads the clients crate's settings while the clients crate dispatches it ([01-loop-and-edge's cases](../core/01-loop-and-edge.md#cases-for-the-bench)).
- From stage 3: a fake page that heard the stand-in's announcement connects; and in this stage's session in the sim, with a bench core running beside the real sim's core, every page of the real sim connects to the real sim's core, and none to the bench core ([the bench's own cases](02-testing.md#cases-for-the-bench)).

## 6 The core helper

Builds: the core helper service and `apps/core-helper`, with the bench's stand-in core helper ([04-core-helper](../core/04-core-helper.md)).
Needs: 5.

## 7 The network

Builds: the network crate, the transport, the backend's invite codes, and our relays, with the bench's local relays, their proxies, and its local backend ([01-between-machines](../network/01-between-machines.md), [the network's units](../network/02-units.md), [the backend](01-the-build.md#the-backend)).
Needs: 5.
Tests, from stage 3: a scenario that holds back one pair's relay leaves the other pairs' messages on time ([the bench's own cases](02-testing.md#cases-for-the-bench)).

## 8 Recording and bug reports

Builds: the recording crate, the self-describing record and the replay log's marks in `recording-format`, uploads, and the backend's bug reports ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md)).
The report page is the desktop shell's, and comes with [the apps](#11-the-apps).
Needs: 7.

## 9 The session

Builds: the session crate: members, session keys, control, the session file, joining and leaving, preflight, and the match check ([01-roles-and-members](../session/01-roles-and-members.md), [the session's units](../session/02-units.md)); and `apps/core`'s window thread, which pushes a quit when Windows ends the pilot's session ([quitting](../core/01-loop-and-edge.md#quitting)).
Its features come in [stage 21](#21-rate-and-pause-and-go-to).
Needs: 4, 7, and 8.
Tests, from stage 2: a pilot quits Dual Input in a session, and Windows signs a pilot out with a session held, and each time the other core sees a leave, not an outage ([01-loop-and-edge's cases](../core/01-loop-and-edge.md#cases-for-the-bench)).

## 10 Profiles

Builds: the profile engine, `profile-build`, the profile loader, and `tools/profile-builder`, with the bench's local profiles' site ([01-format-and-delivery](../profiles/01-format-and-delivery.md), [the profiles' units](../profiles/02-units.md)).
Publishing the profiles to their Pages site comes in [stage 22](#22-github).
Needs: 9.

## 11 The apps

Designs first: the apps' looks and words, from [the apps' list](../interface/01-apps.md#left-to-the-apps-stage) and [installing and updating's](../install/01-installing-and-updating.md#left-to-the-apps-stage).
Builds: the EFB shell, the desktop shell, `apps/desktop`'s window and Rust side, and `sim-package/pages`' EFB app and banner ([01-apps](../interface/01-apps.md)).
Each feature's part in the apps comes with that feature's stage.
Needs: 9 and 10.

## 12 The sandbox

Builds: the sandbox, with the check `apps/core` hands its interrupt handler and the replay log's record of its stops ([plugins and the sandbox](../plugins/01-plugins.md), [what a recording holds](../core/01-loop-and-edge.md#what-a-recording-holds)).
It needs only stage 1, so it can be built any time before stage 13.
Needs: 1.

## 13 The sync engine and the cockpit stream

Builds: the sync engine, and the cockpit stream with catch-up ([01-profile-entries](../sync/01-profile-entries.md) to [the sync units](../sync/05-units.md)).
Needs: 10 and 12.

## 14 State sync

Builds: the state sync feature, its routine `HEvents`, its panel modules `h-events` and `instrument-reads`, its parts in the apps, and the Baron 58P profile's `state` and `events` blocks ([the sync units](../sync/05-units.md), [reading it in the panel](../plugins/01-plugins.md#reading-it-in-the-panel)).
It ends with the first session in the sim, with a bench core as the second pilot ([how the stages are ordered](#how-the-stages-are-ordered)).
Needs: 11 and 13.
Tests, from stage 3: [the loop under load](02-testing.md#the-loop-under-load) again, by hand, with the stand-in's sim inputs and state sync's write functions in place of the test unit's stand-ins for them.

## 15 Installing and updating

Builds: the desktop app's tray icon and its jobs, the installer and updates through Velopack, packed on our development machine, the firewall rule, writing our package, and the core's checks of the packages that override ours ([installing and updating](../install/01-installing-and-updating.md)).
The release workflow comes in [stage 22](#22-github).
Needs: 3 and 11.

Tests:

- From stage 2: a whole unit's handler panics, the process exits with a code other than 0, the desktop app starts it again, the pilot comes back as a late joiner, and the replay panics at the same input; and the core exits on its own, with 0, and the desktop app doesn't start it again ([01-loop-and-edge's cases](../core/01-loop-and-edge.md#cases-for-the-bench)).
- From stage 3: a bench core killed under the desktop app comes back as a bench core, with its own data folder ([the bench's own cases](02-testing.md#cases-for-the-bench)).

## 16 Flight-model sync

Builds: the flight-model feature, and its routines `Lead` and `Follow` ([01-flight-model-sync](../flight-model/01-flight-model-sync.md)).
It ends with the first flight with friends, which needs state sync and the installer too ([how the stages are ordered](#how-the-stages-are-ordered)).
Needs: 4, 9, 14, and 15.

## 17 Avatars

Builds: the avatars feature, its routine `Figure`, the figure's SimObject, `aircraft-model`, `msfs-gltf`, `msfs-rpn`, `ray-cast`, `tools/profile-author`, and the Baron 58P profile's seats ([01-avatars](../avatars/01-avatars.md)).
Needs: 6, 10, and 13.

## 18 Traffic and ATC audio

Builds: the traffic feature, its routine `Traffic`, `object-mirror`, and the ATC audio feature, with their parts in the apps ([traffic and ATC](../traffic-atc/01-traffic-and-atc.md)).
Needs: 6, 9, and 11.
Tests, from stage 2: the core holds under 100 MB of private working set beside QuickJS-ng's runtimes in a busy session, one that hosts traffic ([01-loop-and-edge's budgets](../core/01-loop-and-edge.md#budgets)).

## 19 Pointer sync

Builds: the pointer sync feature, its panel module, and the Baron 58P profile's displays ([pointer sync](../pointer-sync/01-pointer-sync.md)).
Needs: 5 and 13.

## 20 Take-control

Builds: the take-control feature, with its parts in the EFB app and the desktop app ([take-control](../control/01-take-control.md)).
Needs: 6 and 11.

## 21 Rate and pause, and Go to

Builds: the rate and pause feature with its part in the EFB app, and Go to with its part in the desktop app ([the session's units](../session/02-units.md)).
Needs: 9 and 11.

## 22 GitHub

Builds: what waits for the end because it's on GitHub ([how the stages are ordered](#how-the-stages-are-ordered)): CI's workflows for each pull request and each merge to `main` ([CI](../architecture/02-code-map.md#ci), [what keeps CI green](02-testing.md#what-keeps-ci-green)), the release workflow with the check before a release ([a release](01-the-build.md#a-release), [before a release](02-testing.md#before-a-release)), the profiles' workflow and their Pages site ([profiles in this repository](../architecture/02-code-map.md#profiles-in-this-repository)), `tools/replay.ts`, which fetches the core a recording's release shipped ([running a replay](../core/01-loop-and-edge.md#running-a-replay)), and the repositories of ours beside this one, the Coherent GT check's and the one that holds the relays' tokens ([the build](01-the-build.md)).
Needs: every stage before it.

Tests:

- From stage 1: CI's time against the 20 minutes of [budgets for the workspace](../architecture/02-code-map.md#budgets-for-the-workspace), with `cargo build --timings`; one commit built on our development machine and on CI's runner gives one hash ([the build's cases on a desk](01-the-build.md#cases-for-the-bench)); and the runner, set up from nothing by the steps for a new PC in [building every target](../architecture/02-code-map.md#building-every-target), builds and tests the tree.
- From stage 3: whether a GitHub-hosted Windows runner holds three cores, two relays, and their proxies ([testing's left open](02-testing.md#left-open)); a pull request's bench within the code map's 20 minutes, as a job beside the others; and the check before a release within 15 minutes of a person's time, from a sim at the main menu ([testing's budgets](02-testing.md#budgets)).

## 23 v1's release

Builds: v1's release, through the release workflow, after the last sessions with friends.
Needs: every stage before it.
Exit: [step 9](../product/plan.md#9-build-test-and-release-v1)'s exit happens.
