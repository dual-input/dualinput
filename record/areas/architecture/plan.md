# Architecture: plan

This plan designs Crosscheck's v1 architecture, step 7 of [the product plan](../product/plan.md#7-tech-stack-and-architecture), and goes deeper until every detail rests on a fact, by the rule in [When a node is done](#when-a-node-is-done).
It grows as a tree of questions.
A question we can't answer yet gets child questions for what it needs first, so each level's detail comes from the work on the level above it.

## How the tree grows

Each node is a `##` section of this plan, placed in number order, and gives its question, what its parent can't settle without it, what it reads, the document its answer goes in, and an `Exit:` line.
A child's number extends its parent's, so 1.2 is the second child of 1.
A node is done when it has a `Done on` line under its `Exit:` line, and open until then.
A node with children has a line such as `Waits on 1.1 and 1.2.` under its `Exit:` line.
A node may also wait on a node numbered under another parent, when one answer serves both, and names it in its `Waits on` line the same way.
The work stands at the first node that has no `Done on` line, and no `Waits on` line naming a node that's still open.

To work a node:

1. Before proposing anything for the node, read in full each document in `record/` that bears on its question, starting with those the node lists, and search the prior work that [CLAUDE.md](../../../CLAUDE.md#prior-work) lists for anything on the question.
   You'll know what the record establishes and where it's silent.
2. If the node can't be answered from that, propose to the user the questions that have to be answered first, each as a child with what the node can't settle without it, and where a node elsewhere in the tree already asks one of them, propose naming that node instead.
   You'll have a list the user can agree to one child at a time.
3. For each child the user agrees to, add it as a node, and put its number in the parent's `Waits on` line.
   You'll see the child as a `##` section and its number in the parent's `Waits on` line, and by the rule above, the work moves to the first open child.
4. If the node has a `Waits on` line, once every node it names is done, walk each step of [a session from start to finish](../product/03-v1-scope.md#a-session-from-start-to-finish), and at each step check that those nodes' answers together do what that step's linked section requires.
   Wherever one answer needs something another doesn't give, reopen the node that has to change, as [Reopening a node](#reopening-a-node) says.
   You're done with this step when the whole session walks through the answers with nothing reopened.
5. Write the node's answer in the document it names.
6. Once the node's `Exit:` has happened and its answer meets [When a node is done](#when-a-node-is-done), add `Done on <YYYY-MM-DD>.` under its `Exit:` line, and number the tentative decisions its children settled, as [Where answers go](#where-answers-go) says.
   You'll see the `Done on` line, and the next open node is where the work stands.

When working one node turns up something another node has to settle, add it under that node on a line that starts `Raised elsewhere:` and names the node it came from.
That node's answer settles each such line before it's marked done, and a line added under a done node reopens it, as [Reopening a node](#reopening-a-node) says.
If no node covers it, propose a new node for it, as step 2 says.

The tree's root is step 7 of the product plan: its question is step 7's exit, and its children are the top-level nodes.
When every top-level node is done and their answers don't yet give each decision step 7's exit names, propose the next top-level node, as step 2 does.
When they do, check the top-level answers as step 4 does, number their tentative decisions as [Where answers go](#where-answers-go) says, and mark step 7 done in [the product plan](../product/plan.md#7-tech-stack-and-architecture).

## When a node is done

A node is marked done only when all of these hold:

- Every claim its answer rests on is measured, is read in files and doesn't turn on which code path runs, or is knowledge that [Evidence](../../../.claude/rules/writing.md#evidence) lets go unmarked.
  A documented or unverified claim needs a child that settles it, such as a read, a search of our prior work, or a probe in `experiments/`, proposed as step 2 says.
- Every choice the answer leaves open can be made later inside one part of Crosscheck without changing another, as the core's WebSocket library could be if no client sees it (a hypothetical example).
- Its answer settles each `Raised elsewhere:` line under it.

## Where answers go

An answer goes in one of these documents, never in this plan:

- a design doc in the area the answer belongs to, such as `record/areas/network/`
- a reference, beside what it describes
- a tentative decision in this area's `decisions.md`
- an entry in the log of the area the finding belongs to, for a child that's a read, a search, or a probe, which the parent's answer cites

This plan holds each node's question, its status, and its `Raised elsewhere:` lines.

When you mark a node done, write each tentative decision its children settled as a numbered decision in `record/decisions/`, and link the tentative one to it.
A child's decision isn't checked against its siblings' answers until its parent's step 4, and a numbered decision can't be edited, so numbering waits for the parent.
A child that serves two nodes gets its decisions numbered when the last of them is done.

## Reopening a node

A done node reopens when a finding contradicts it, or when its parent's step 4 finds that a sibling needs something its answer doesn't give, and so does every node whose answer rests on its answer.
In each one, replace the `Done on` line with `Reopened on <YYYY-MM-DD>, by <link to the finding, or the node whose answer needs the change>.`
When the node is marked done again, each numbered decision its new answer changes gets a reversing decision, as [Decisions](../../../.claude/rules/writing.md#decisions) says.

## 1 The spine

Question: what does every other part of Crosscheck rest on?
It covers:

- the processes Crosscheck runs as
- how its components talk to each other, on one machine and between machines: the watcher, the core, the desktop app, the EFB app, our WASM module, the panels, the relay, and the backend, and the plugins' code, which may run inside several of them
- the conventions they share
- the language
- the boundaries between its parts

A component is something that runs on its own, such as a process, a document in the sim, or a WASM module.
A part is a piece of Crosscheck's design that a later node works on, such as the sync engine, and it may live in one component or span several.

Step 7 can't decide a language, frameworks, or a core architecture without it, and every node after it assumes its answer.
It reads [01-aims](../product/01-aims.md), [03-v1-scope](../product/03-v1-scope.md), [04-room-for-later](../product/04-room-for-later.md), step 7 of [the product plan](../product/plan.md#7-tech-stack-and-architecture), and the sync design docs: [01-profile-entries](../sync/01-profile-entries.md), [02-live-sync](../sync/02-live-sync.md), and [03-catch-up](../sync/03-catch-up.md).
Its answer goes in `01-spine.md`, in this area.
`01-spine.md` takes up step 7's paragraphs after its exit, from the headless core proposed on 2026-10-03 to sim awareness, and once the user agrees to it, step 7 links to it in their place.
Exit: the user agrees to `01-spine.md`.
Waits on 1.1, 1.2, 1.3, and 1.4.
Raised elsewhere: by 1.1, whether profiles reach pilots apart from Crosscheck's releases, to place with the part that designs profiles and updates ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.1.2, how the core judges an aircraft settled in a session started before 03-catch-up's rule could call it settled, to place with the part that designs sync ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.1, whether the WASM module runs calculator code for the profile engine, to place with the part that designs the profile engine ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.1.2, how each module in a panel or the sim tears itself down, to place with the parts that design the panel bridge and plugins ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.2, what counts as trouble for each component and where the pilot sees it, to place with the parts that design the logs, the recording, and the apps ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.2, how the cores reach each other, a top-level node after node 1 (user, 2026-10-08) ([01-spine](01-spine.md#between-machines)).
Raised elsewhere: by 1.2, letting a web page connect to the core, opt-in, if an integration ever needs it, to place with the part that designs the core's protocol ([01-spine](01-spine.md#left-open)).

## 1.1 Components

Question: what components does Crosscheck run, where does each run, and what does each own?
The spine can't draw a link without its endpoints, and v1's features name endpoints beyond the watcher, the core, and the core's clients that step 7 leans toward.
Pilots bind the take-control key in Crosscheck's settings rather than the sim's ([03-v1-scope](../product/03-v1-scope.md#take-control-key)), so one of our components has to catch the press of that key or hardware button, and the record doesn't say which, nor which components a plugin's code runs in ([03-v1-scope](../product/03-v1-scope.md#plugins)).
It reads what node 1 reads, then the area logs, starting with [interface](../interface/log.md), [avatars](../avatars/log.md) with its [decisions](../avatars/decisions.md), [flight-controls](../flight-controls/log.md), and [flight-model](../flight-model/log.md).
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.
Waits on 1.1.1 and 1.1.2.
Done on 2026-10-08.

## 1.1.1 Masking priority at sim start

Question: can the core take its masking priority when the sim starts, ahead of any aircraft's module, without holding back the pilot's controls until a session asks it to?
1.1 can't say what the core does from the moment the sim starts without it.
On the A2A PA-24, our masks got ahead of the aircraft's only when they were registered before it loaded ([flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)), and soft takeover and mixed flight controls, both Soon picks, need that place on such aircraft ([04-room-for-later](../product/04-room-for-later.md#an-input-layer)).
A probe settles it: register an empty notification group at 10,000,000 before the PA-24 loads, add maskable events to it after the aircraft loads, and see whether our group still sits ahead of the aircraft's.
It reads the [flight-controls log](../flight-controls/log.md), the foundations chapter [04-02](../../learn/foundations/04-02-events.md), and the probe [p01-mask.mjs](../../../experiments/areas/flight-controls/p01-mask.mjs).
Its answer goes in an entry in the flight-controls log, which the tentative decision [The core starts with every sim run](decisions.md#the-core-starts-with-every-sim-run) and 1.1's section of `01-spine.md` cite.
Exit: a flight-controls log entry answers the question.
Done on 2026-10-07.

## 1.1.2 Components with no session

Question: what does each component do while no session runs, and what moves it into a session and back?
1.1 can't say what each component owns until it says when.
The core starts with every sim run ([tentative decisions](decisions.md#the-core-starts-with-every-sim-run)), and a pilot may fly the Baron every day and with a crew once a week, so with no session, nothing loads a profile, runs a plugin, or watches the cockpit (user, 2026-10-07).
Our earlier apps did otherwise: FS Copilot's app opened its relay link and its rendezvous registration at launch, session or not (read in the FS Copilot fork, `FsCopilot/Program.cs`, `BuildAvaloniaApp`, and `FsCopilot/Network/RelayNetwork.cs` and `P2PNetwork.cs`, their constructors), and fsc-editor's module streams the sim's `L:` values until the sim exits, because the app never sends it the `stop` command it has (read in fsc-editor, `link/src/module.cpp` and `src/shared/link.ts`).
It reads the tentative decisions 1.1 has settled ([decisions](decisions.md)), the session sections of [03-v1-scope](../product/03-v1-scope.md#session), and sim awareness in step 7 of [the product plan](../product/plan.md#7-tech-stack-and-architecture).
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.
Done on 2026-10-07.

## 1.2 Communication

Question: how do those components communicate?
The spine can't draw the boundaries between parts, or set the conventions they share, until it knows which components exchange what, and by what means.
It reads 1.1's answer, then the [interface](../interface/log.md) and [CommBus](../commbus/log.md) logs, and the foundations chapters on the ways to reach the sim: [04-01](../../learn/foundations/04-01-connection-and-data.md), [04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md), [05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md), and [06-04](../../learn/foundations/06-04-websockets-to-localhost.md).
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.
Waits on 1.2.1.
Done on 2026-10-08.
Raised elsewhere: by 1.1, how the core knows each component is alive and working, the watcher, the apps, the code in the sim, and the relay, so a component in trouble is plain to the pilot and lands in the logs and the recording ([ideas](../product/ideas.md#component-health); user, 2026-10-08).
Raised elsewhere: by 1.1.2, how the core tells the components in the sim that a session started and ended ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.1.2, how the WASM module hears from the core every second on every machine in a session, so it can undo our state in the sim when the core stops ([01-spine](01-spine.md#what-moves-them)).
Raised elsewhere: by 1.1, how a panel finds its own core when two cores run on one machine, since FS Copilot's panels try ports 9020 to 9024 and connect to the first that answers, one reason its test bench must not run beside a live sim (FS Copilot fork, `record/pointer-forwarding/docs/14-test-bench.md`, "Do not run the simulator during a bench run").

## 1.2.1 Links from the sim's pages

Question: can each kind of page in the sim that our components run in read an `L:` variable the core writes and hold a WebSocket to the core, and what do sockets in every cockpit panel cost in frame time?
1.2 can't say how those components find the core and learn that a session started without it.
The core is to announce its port in `L:CROSSCHECK_CORE_PORT`, and a cockpit panel is to connect only while `L:CROSSCHECK_SESSION` is 1, name its instruments, and close its socket if the core gives it nothing to load (user, 2026-10-08).
WebSockets to a program on the same PC were measured from the EFB's document, the toolbar's, a cockpit panel's, and two of Parallel 42's in-game panels, but not from an in-game panel of our own or from the menu's document, `mainUi` ([interface log](../interface/log.md#2026-10-05-an-efb-app-the-toolbar-and-in-game-panels-each-reach-a-program-on-the-same-pc-by-websocket-and-http-and-can-show-a-page-it-serves)).
Whether any of those pages can read an `L:` variable an outside program writes is unmeasured, and `mainUi` has `engine` but no `Coherent` ([interface log](../interface/log.md#2026-10-05-code-in-the-menus-document-sets-the-world-maps-departure-stand-aircraft-and-livery-and-starts-the-flight)).
How many sockets a session holds depends on the profile, and nobody has measured what they cost the sim.
A probe settles it: with an in-game panel of ours installed, write the variable through SimConnect in the main menu, read it and open a WebSocket from each kind of page, in the menu and again once a flight has loaded, then compare frame time with a socket in every cockpit panel, idle and busy, against none.
It reads the [interface log](../interface/log.md), the foundations chapter [06-04](../../learn/foundations/06-04-websockets-to-localhost.md), and the probes [p06-websocket.mjs](../../../experiments/areas/interface/p06-websocket.mjs) and [ingame/build.mjs](../../../experiments/areas/interface/ingame/build.mjs).
Its answer goes in an entry in the interface log, which 1.2's section of `01-spine.md` cites.
Exit: an interface log entry answers the question.
Done on 2026-10-08.

## 1.3 Language and toolchains

Question: what language and toolchain does each component's runtime take?
The spine can't pick a language until it knows the runtimes the components run in, and they differ: Coherent GT, the sim's WASM, Node and Electron if step 7's lean holds, and whatever the local speech recognizer and ATC audio capture run in, which the record leaves open ([voice phrases](../product/03-v1-scope.md#voice-phrases), [hearing ATC](../product/03-v1-scope.md#hearing-atc)).
It reads 1.1's answer, then the foundations chapters [05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md), [05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md), and [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md).
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.
Waits on 1.3.1, 1.3.2, 1.3.3, 1.3.4, 1.3.5, and 1.3.6.
Raised elsewhere: by 1.1, whether the core's native code for Windows input and audio runs in the core's own process or in a process the core supervises, since a crash in native code inside the core's process takes the core down, and the pilot out of the session until the core restarts ([tentative decisions](decisions.md#the-core-catches-the-take-control-key-and-buttons)).

## 1.3.1 The watcher's runtime

Question: what does a process that shows only a tray icon cost in memory and CPU, idle, in each runtime the watcher could run in?
1.3 can't pick the watcher's runtime without it.
The watcher runs from the pilot's login, all day, and shows the pilot its own CPU and memory use ([the product plan](../product/plan.md#7-tech-stack-and-architecture)), and Node has no tray icon, so the watcher needs a runtime that has one, such as Electron's main process or a native program.
An idle Node process took 29 MB, and Electron 43's executable running as plain Node took 35 MB (measured on our development machine, 2026-10-06, same step), but neither showed a tray icon.
A probe settles it, with no sim: a tray icon and nothing else, idle for 60s, in Electron 43's main process, in .NET 9 WinForms built self-contained and with Native AOT, and in Rust on Win32, recording the memory and CPU of all of each one's processes.
It reads step 7 of [the product plan](../product/plan.md#7-tech-stack-and-architecture) and the watcher's row in [01-spine](01-spine.md#components).
Its answer goes in an entry in this area's log, which 1.3's section of `01-spine.md` cites.
Exit: a log entry in this area answers the question.
Done on 2026-10-08.

## 1.3.2 A Rust standalone module

Question: does a standalone module built from Rust with Navigraph's cargo-msfs, and packaged by our own script, load on MSFS 2024, leave its version in a data slot, tick every frame, and read a data slot the core writes?
1.3 can't take Rust for the WASM module without it.
The Synaptic A220's systems module is Rust: it exports `rust_eh_personality` and the five allocator functions of the SDK's C library that the sim calls, `mallinfo`, `mchunkit_begin`, `mchunkit_next`, `get_pages_state`, and `mark_decommit_pages` (read in synaptic-aircraft-a220 1.0.10, `systems.wasm`, its exports), and the sim compiled it as an MSFS 2024 module (measured on our development machine, 2026-09-27, [05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md#gauge-vs-standalone-modules-and-the-sandbox)).
But it loads with the aircraft and exports no `Update_StandAlone`.
cargo-msfs builds Rust crates for MSFS 2020 and 2024 (documented, [cargo-msfs](https://github.com/navigraph/cargo-msfs)), and MSFS 2024 registered a package fsc-editor put together by hand (measured on MSFS 2024, 2026-08-23, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — The module must export MSFS's allocator. Hand-driving clang was the wrong call.").
A probe settles it: build a module that leaves its version in a data slot at load, counts frames in `Update_StandAlone`, and copies a slot the core writes into one the core reads; compare its exports and sections with fsc-editor's toolset build; install it, restart the sim to the main menu, and read the slots through node-simconnect.
It reads [05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md), [05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md), and fsc-editor's `link/`.
Its answer goes in an entry in this area's log, which 1.3's section of `01-spine.md` cites.
Exit: a log entry in this area answers the question.
Done on 2026-10-08.

## 1.3.3 A Rust helper

Question: can a Rust program capture one process's audio through WASAPI's process loopback, capture a microphone, play audio on an output device it picks, and read the keyboard through Raw Input in sink mode, and does it build without Visual Studio?
1.3 can't take Rust for the core's native code without it.
FS Copilot's app captured BeyondATC by process and played it back in C#, with the loopback's activation hand-written after Microsoft's ApplicationLoopback sample (read in the FS Copilot fork, `FsCopilot/Audio/ProcessLoopback.cs`; measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 3: the audio path works on one machine — Q10, Q12, Q13 settled"), and our probes read Raw Input in sink mode from C# ([mouse.mjs](../../../experiments/tools/mouse.mjs)).
Rust's default Windows target links with the linker in Visual Studio's Build Tools (documented, [rustup](https://rust-lang.github.io/rustup/installation/windows-msvc.html)), and its GNU target links with a MinGW linker of its own (unverified).
A probe settles it, with no sim: report the level of a process playing a tone and of the default microphone, play a tone on a named device, and print keys sent while another window has the focus, built once for each target.
It reads the [tentative decisions](decisions.md) on the take-control input and the audio, and FS Copilot's `FsCopilot/Audio/`.
Its answer goes in an entry in this area's log, which 1.3's section of `01-spine.md` cites.
Exit: a log entry in this area answers the question.
Done on 2026-10-08.

## 1.3.4 A Rust SimConnect client

Question: does a Rust program using the SDK's own SimConnect library, through bindings generated from its headers, connect to MSFS 2024, call the sim's pages and hear them over the CommBus, follow the sim's system events, and trade data slots with our Rust module?
1.3 can't take Rust for the core without it.
Every SimConnect finding so far came through node-simconnect, which implements the protocol again in JavaScript ([01-spine](01-spine.md#the-core-and-the-desktop-app)), and a Rust core would call `SimConnect.dll` instead ([04-01](../../learn/foundations/04-01-connection-and-data.md#what-it-is)).
A probe settles it, at the main menu: connect, call mainUi over the CommBus and hear its answer, subscribe to a system event and to the flow events, and write a data slot of the p03 module and read its echo.
It reads [04-01](../../learn/foundations/04-01-connection-and-data.md), [05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md), the interface log's [2026-10-08 entries](../interface/log.md), and the probes p13 to p15.
Its answer goes in an entry in this area's log, which 1.3's section of `01-spine.md` cites.
Exit: a log entry in this area answers the question.
Done on 2026-10-08.

## 1.3.5 An embedded engine for plugins and write functions

Question: what do QuickJS and V8, embedded in a Rust program, cost to start, hold idle, and call, running a plugin and 100 profile write functions compiled from TypeScript, and do their memory and time limits stop a runaway script without taking the program down?
1.3 can't choose the core's language without it.
Plugin code runs only in the core, in TypeScript (user, 2026-10-08), and step 7 asks for a sandbox, with size limits, for the profile's write functions ([the product plan](../product/plan.md#7-tech-stack-and-architecture)), so a core in either language runs them in an engine with limits: Node's own `vm` module "is not a security mechanism" (documented, [Node.js vm](https://nodejs.org/api/vm.html)).
A probe settles it, with no sim: compile a small plugin and 100 write functions with esbuild, run them in QuickJS through rquickjs and in V8 through a Rust binding, call the write functions as every frame at 60 frames a second would, and break each limit on purpose; Node's `vm` module runs the same code as a baseline.
It reads [01-profile-entries](../sync/01-profile-entries.md#the-writer-api) and the [plugins](../product/03-v1-scope.md#plugins) section of 03-v1-scope.
Its answer goes in an entry in this area's log, which 1.3's section of `01-spine.md` cites.
Exit: a log entry in this area answers the question.
Done on 2026-10-08.

## 1.3.6 Tauri for the desktop app

Question: what does a Tauri 2 window cost in memory against an Electron window showing the same page, and what `Origin` does a WebSocket send from a Tauri page and from Tauri's Rust side?
1.3 can't take Tauri for the desktop app without it.
The core accepts a WebSocket only with `Origin` `coui://html_ui` or none, and the desktop app connects from Electron's main process because a page in its window sends one ([tentative decisions](decisions.md#the-core-accepts-a-websocket-only-from-the-sims-pages-and-our-own-apps)).
A probe settles it, with no sim: open each window for 60s and record the memory of all its processes, as p01 did, and connect each way to a WebSocket server that logs the `Origin`, as p16 did.
It reads [p01](../../../experiments/areas/architecture/p01-tray-runtimes.mjs) and [p16](../../../experiments/areas/interface/p16-client-origin.mjs).
Its answer goes in an entry in this area's log, which 1.3's section of `01-spine.md` cites.
Exit: a log entry in this area answers the question.
Done on 2026-10-08.

## 1.4 Shared conventions

Question: what conventions does every component share?
1.2 says which components exchange what, and the spine also can't draw the boundaries between parts until it knows the form of the fields every message carries, such as its IDs and its times.
The record leaves two of these to step 7 by name: the form of a pilot ID ([02-live-sync](../sync/02-live-sync.md#when-two-pilots-change-one-entry)) and of a session ID ([03-v1-scope](../product/03-v1-scope.md#recording-and-bug-reports)).
The sync design implies others.
One is the ID that lets a receiver apply a message once when it arrives directly, through the relay, or both ([02-live-sync](../sync/02-live-sync.md#keeping-a-change-from-applying-twice)).
Another is the form of a time, because the sync design gives times in both frames and milliseconds: the duplicate filter's window is 3 frames and at most 200ms, and a write's pace is `every(1, 'frame')` or `every(40, 'ms')` ([02-live-sync](../sync/02-live-sync.md#keeping-a-change-from-applying-twice), [01-profile-entries](../sync/01-profile-entries.md#the-writer-api)).
It reads 1.2's answer, then the foundations chapters [08-01](../../learn/foundations/08-01-replication-models-and-authority.md), [08-03](../../learn/foundations/08-03-ordering-and-classes-of-data.md), [08-05](../../learn/foundations/08-05-position-and-clocks.md), [09-05](../../learn/foundations/09-05-versions-and-security.md), and [09-06](../../learn/foundations/09-06-connection-lifecycle.md).
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.
Raised elsewhere: by 1.3, one definition, which both sides are checked against, of each message that crosses between TypeScript and Rust through the WASM module's data slots and the helper's standard input and output ([01-spine](01-spine.md#messages-between-typescript-and-rust); [05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md#protocol-versioning-between-the-app-and-the-module-packed-structs)).
Raised elsewhere: by 1.1, what a pilot's identity is across a core restart, since FS Copilot made a restarted app "a new peer in every respect" (FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, R03), while [the connection](../product/03-v1-scope.md#the-connection) reconnects a returning pilot from session state saved on their machine.
