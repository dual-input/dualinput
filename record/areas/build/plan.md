# Build: plan

This plan builds Crosscheck's v1, as [03-v1-scope](../product/03-v1-scope.md) has it, in numbered stages, each ending with an exit you can watch happen.
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
  Friends fly their installed Crosscheck ([the four levels](02-testing.md#the-four-levels)), so the install stage comes before that flight.
- No stage builds code that a later stage replaces: what a stage builds is final, and only the bench's stand-ins and test units stand in for what isn't built yet.

## Working a stage

1. Before writing anything for the stage, read each section its `Builds:` and `Tests:` lines link, with the notes at the top of each design doc they're in, since a doc's notes change the text below them ([step 8](../product/plan.md#8-v1-build-plan)).
   You'll know what the stage builds and what proves it.
2. If the stage has a `Designs first:` line, propose that design to the user, and once they agree, write it in the design doc it belongs to.
   You'll see the design in its doc before any of the stage's code.
3. Write the stage's code, and turn its cases into tests, as [left to each stage](02-testing.md#left-to-each-stage) says.
   You'll see CI run its unit tests and bench tests green on its pull request.
4. Ask the user whether to run the `code-reviewer` agent, as [CLAUDE.md](../../../CLAUDE.md#working-rules) says.
   You'll have their answer, and if they want a review, its findings fixed or answered.
5. If the stage's system has cases in the sim, run them, and measure the stage's budgets in the sim, in one session in the sim ([in the sim](02-testing.md#in-the-sim)).
   You'll have each case's report and each measurement.
6. Measure the stage's budgets on the bench, on our development machine, and write each result, from the bench and from the sim, with how it was taken, in the log of the area it belongs to.
   A result that misses its budget goes back to the design that set it, as [left to each stage](02-testing.md#left-to-each-stage) says.
   You'll see a log entry for each budget.
7. Once the stage's exit has happened, add `Done on <YYYY-MM-DD>.` under its `Exit:` line.
   You'll see the `Done on` line, and the next open stage is where the build stands.

## When building shows a design is wrong

1. Propose the change to the user before writing it.
2. Once they agree, write what the stage found in the log of the area the design belongs to.
3. Add a note at the top of the design doc that names the log entry, as [writing.md](../../../.claude/rules/writing.md#design-plan-and-log) has a design doc amended.
4. If the change reverses a numbered decision, write the decision that reverses it, as [writing.md](../../../.claude/rules/writing.md#decisions) says.

## 1 The workspace and CI

Builds: the Cargo workspace and its folders, `tools/setup.ts` and `tools/build.ts`, the C runtime's static link, the message crate, which each later stage adds its messages to, and its hash, the map check, the Coherent GT check, and the checks CI runs on a pull request ([the workspace](../architecture/02-code-map.md#the-workspace), [01-the-build](01-the-build.md)).
Needs: nothing.

## 2 The core's loop and edge

Builds: the kernel, and `apps/core`'s edge, with the replay log's encoding in `recording-format` ([01-loop-and-edge](../core/01-loop-and-edge.md)).
Needs: 1.

## 3 The bench

Builds: `tools/bench/`'s scenarios and the processes and folders it runs, the stand-in sim with the sim seam's `sim-client` and `simconnect-types`, and `apps/core`'s `stand-in` feature with its test units ([the bench](02-testing.md#the-bench), [the stand-in sim](02-testing.md#the-stand-in-sim)).
Each later stage adds the stand-ins its own units need ([left to each stage](02-testing.md#left-to-each-stage)).
Needs: 2.

## 4 The sim seam, our WASM module, and our package

Builds: the sim service, sim awareness, the sim edge, the routine host, `sim-package/routines/`, `sim-package/wasm-module`, and our package with `node tools/build.ts install` ([03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md), [our package](01-the-build.md#our-package)).
Needs: 3.

## 5 Clients and the panel bridge

Builds: the clients crate, `page-client`, the panel bridge, and our `VCockpit.js` override, with the bench's fake pages ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md)).
Needs: 4.

## 6 The core helper

Builds: the core helper service and `apps/core-helper`, with the bench's stand-in core helper ([04-core-helper](../core/04-core-helper.md)).
Needs: 5.

## 7 The network

Builds: the network crate, the transport, the backend's invite codes, and our relays, with the bench's local relays, their proxies, and its local backend ([01-between-machines](../network/01-between-machines.md), [the network's units](../network/02-units.md), [the backend](01-the-build.md#the-backend)).
Needs: 5.

## 8 Recording and bug reports

Builds: the recording crate, the self-describing record in `recording-format`, uploads, and the backend's bug reports ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md)).
The report page is the desktop shell's, and comes with [the apps](#11-the-apps).
Needs: 7.

## 9 The session

Builds: the session crate: members, session keys, control, the session file, joining and leaving, preflight, and the match check ([01-roles-and-members](../session/01-roles-and-members.md), [the session's units](../session/02-units.md)).
Its features come in [stage 21](#21-rate-and-pause-and-go-to).
Needs: 4, 7, and 8.

## 10 Profiles

Builds: the profile engine, `profile-build`, the profile loader, `tools/profile-builder`, and CI's publishing to the profiles' site, with the bench's local profiles' site ([01-format-and-delivery](../profiles/01-format-and-delivery.md), [the profiles' units](../profiles/02-units.md)).
Needs: 9.

## 11 The apps

Designs first: the apps' looks and words, from [the apps' list](../interface/01-apps.md#left-to-the-apps-stage) and [installing and updating's](../install/01-installing-and-updating.md#left-to-the-apps-stage).
Builds: the EFB shell, the desktop shell, `apps/desktop`'s window and Rust side, and `sim-package/pages`' EFB app and banner ([01-apps](../interface/01-apps.md)).
Each feature's part in the apps comes with that feature's stage.
Needs: 9 and 10.

## 12 The sandbox

Builds: the sandbox ([plugins and the sandbox](../plugins/01-plugins.md)).
It needs only stage 1, so it can be built any time before stage 13.
Needs: 1.

## 13 The sync engine and the cockpit stream

Builds: the sync engine, and the cockpit stream with catch-up ([01-profile-entries](../sync/01-profile-entries.md) to [the sync units](../sync/05-units.md)).
Needs: 10 and 12.

## 14 State sync

Builds: the state sync feature, its routine `HEvents`, its panel modules `h-events` and `instrument-reads`, its parts in the apps, and the Baron 58P profile's `state` and `events` blocks ([the sync units](../sync/05-units.md), [reading it in the panel](../plugins/01-plugins.md#reading-it-in-the-panel)).
It ends with the first session in the sim, with a bench core as the second pilot ([how the stages are ordered](#how-the-stages-are-ordered)).
Needs: 11 and 13.

## 15 Installing and updating

Builds: the desktop app's tray icon and its jobs, the installer and updates through Velopack, the firewall rule, writing our package, the core's checks of the packages that override ours, and the release workflow with the check before a release ([installing and updating](../install/01-installing-and-updating.md), [a release](01-the-build.md#a-release), [before a release](02-testing.md#before-a-release)).
Needs: 3 and 11.

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

## 19 Pointer sync

Builds: the pointer sync feature, its panel module, and the Baron 58P profile's displays ([pointer sync](../pointer-sync/01-pointer-sync.md)).
Needs: 5 and 13.

## 20 Take-control

Builds: the take-control feature, with its parts in the EFB app and the desktop app ([take-control](../control/01-take-control.md)).
Needs: 6 and 11.

## 21 Rate and pause, and Go to

Builds: the rate and pause feature with its part in the EFB app, and Go to with its part in the desktop app ([the session's units](../session/02-units.md)).
Needs: 9 and 11.

## 22 v1's release

Builds: v1's release, through the release workflow, after the last sessions with friends.
Needs: every stage before it.
Exit: [step 9](../product/plan.md#9-build-test-and-release-v1)'s exit happens.
