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
6. Once the node's `Exit:` has happened and its answer meets [When a node is done](#when-a-node-is-done), add `Done on <YYYY-MM-DD>.` under its `Exit:` line.
   You'll see the `Done on` line, and the next open node is where the work stands.

When working one node turns up something another node has to settle, add it under that node on a line that starts `Raised elsewhere:` and names the node it came from.
That node's answer settles each such line before it's marked done, and a line added under a done node reopens it, as [Reopening a node](#reopening-a-node) says.
If no node covers it, propose a new node for it, as step 2 says.

The tree's root is step 7 of the product plan: its question is step 7's exit, and its children are the top-level nodes.
When every top-level node is done and their answers don't yet give each decision step 7's exit names, propose the next top-level node, as step 2 does.
When they do, check the top-level answers as step 4 does, number this area's tentative decisions as [Where answers go](#where-answers-go) says, and mark step 7 done in [the product plan](../product/plan.md#7-tech-stack-and-architecture).

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

Once the top-level answers pass the root's walk through a session ([how the tree grows](#how-the-tree-grows)), write each tentative decision in this area's `decisions.md` as a numbered decision in `record/decisions/`, and link the tentative one to it; those are the decisions step 7's exit names.
A node's answer isn't checked against every other node's until that walk, and a numbered decision can't be edited, so numbering waits for it.

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
A part is one row of the spine's [Parts](01-spine.md#parts), such as sync, and it may live in one component or span several.

Step 7 can't decide a language, frameworks, or a core architecture without it, and every node after it assumes its answer.
It reads [01-aims](../product/01-aims.md), [03-v1-scope](../product/03-v1-scope.md), [04-room-for-later](../product/04-room-for-later.md), step 7 of [the product plan](../product/plan.md#7-tech-stack-and-architecture), and the sync design docs: [01-profile-entries](../sync/01-profile-entries.md), [02-live-sync](../sync/02-live-sync.md), and [03-catch-up](../sync/03-catch-up.md).
Its answer goes in `01-spine.md`, in this area.
`01-spine.md` takes up step 7's paragraphs after its exit, from the headless core proposed on 2026-10-03 to sim awareness, and once the user agrees to it, step 7 links to it in their place.
Its answer also names Crosscheck's parts, the area each one's documents go in, and where each is designed, in a node of this plan or in a stage of [step 8](../product/plan.md#8-v1-build-plan), and files each open question it leaves under the part it belongs to.
Exit: the user agrees to `01-spine.md`, its Parts and Left open sections included.
Waits on 1.1, 1.2, 1.3, 1.4, 1.5, and 1.6.
Reopened on 2026-10-11, by 1.1's reopening.
Done on 2026-10-11.
Raised elsewhere: by 1.3, whether masking, AI objects with liveries, input events, the camera, and a flight load's flow events work through the SDK's `SimConnect.dll`, which 1.5 settles ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.3, which APIs our panel bridge and WASM module offer plugins, to place with the part that designs plugins ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.1, whether the profile engine fires `H:` events through SimConnect's client events or through the calculator code our WASM module runs for plugins, to place with the part that designs the profile engine ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.1.2, how each module, and each hook our panel code installs for a plugin, tears itself down, to place with the parts that design the panel bridge and the WASM module ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.2, what counts as trouble for each component and where the pilot sees it, to place with the part that designs the apps ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.2, letting a web page connect to the core, opt-in, if an integration ever needs it, to place with the part that designs the core's protocol ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.4, whether a clock our WASM module can read counts the same ticks as `QueryPerformanceCounter`, which 1.5 measures, to place with the part that designs the flight-model sync ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.4, which clock a page in the sim measures a span on, which 1.5 measures, to place with the part that designs each page that sends a span, starting with the panel bridge ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.4, what a core that restarts mid-flight gives up by registering its masks after the aircraft loaded, to place with the part that designs the core ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.4, what the core does with a component on its own machine whose version or hash differs from its own, beyond logging it, to place with the part that designs the core ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.4, how far the core's arrival stamp trails the sim's read, for a page's message, a data-slot write from our WASM module, and a value the core requests through SimConnect, which 1.5 bounds for a data-slot write, to place with the part that designs the flight-model sync and each page that sends values ([01-spine](01-spine.md#left-open)).

## 1.1 Components

Question: what components does Crosscheck run, where does each run, and what does each own?
The spine can't draw a link without its endpoints, and v1's features name endpoints beyond the watcher, the core, and the core's clients that step 7 leans toward.
Pilots bind the take-control key in Crosscheck's settings rather than the sim's ([03-v1-scope](../product/03-v1-scope.md#take-control-key)), so one of our components has to catch the press of that key or hardware button, and the record doesn't say which, nor which components a plugin's code runs in ([03-v1-scope](../product/03-v1-scope.md#plugins)).
It reads what node 1 reads, then the area logs, starting with [interface](../interface/log.md), [avatars](../avatars/log.md) with its [decisions](../avatars/decisions.md), [flight-controls](../flight-controls/log.md), and [flight-model](../flight-model/log.md).
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.
Waits on 1.1.1 and 1.1.2.
Reopened on 2026-10-09, by node 1's walk through a session, which found that the core needs the pilot's settings while the optional desktop app is closed ([tentative decisions](decisions.md#the-core-keeps-the-pilots-settings)).
Reopened on 2026-10-11, by node 2's answer, which gives invite codes and introductions between cores to the backend rather than the relay ([01-between-machines](../network/01-between-machines.md#joining)).
Done on 2026-10-11.

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
It reads the tentative decisions 1.1 has settled ([decisions](decisions.md)), the session sections of [03-v1-scope](../product/03-v1-scope.md#session), and the spine's [sim awareness](01-spine.md#sim-awareness).
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
Reopened on 2026-10-09, by node 1's walk through a session, which found that the watcher had no way to learn what its jobs need from the core, that the port file named the core by a process ID Windows may reuse, and that the core launched the desktop app for a Rejoin button v1 doesn't have ([tentative decisions](decisions.md#apps-outside-the-sim-find-the-core-through-a-port-file)).
Done on 2026-10-09.
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
The spine can't pick a language until it knows the runtimes the components run in, and they differ: Coherent GT, the sim's WASM, whatever the core and the desktop app's window run in, and whatever the local speech recognizer and ATC audio capture run in, which the record leaves open ([voice phrases](../product/03-v1-scope.md#voice-phrases), [hearing ATC](../product/03-v1-scope.md#hearing-atc)).
It reads 1.1's answer, then the foundations chapters [05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md), [05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md), and [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md).
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.
Waits on 1.3.1, 1.3.2, 1.3.3, 1.3.4, 1.3.5, and 1.3.6.
Done on 2026-10-08.
Raised elsewhere: by 1.1, whether the core's native code for Windows input and audio runs in the core's own process or in a process the core supervises, since a crash in native code inside the core's process takes the core down, and the pilot out of the session until the core restarts ([tentative decisions](decisions.md#the-core-catches-the-take-control-key-and-buttons)).

## 1.3.1 The watcher's runtime

Question: what does a process that shows only a tray icon cost in memory and CPU, idle, in each runtime the watcher could run in?
1.3 can't pick the watcher's runtime without it.
The watcher runs from the pilot's login, all day, and shows the pilot its own CPU and memory use ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), and Node has no tray icon, so the watcher needs a runtime that has one, such as Electron's main process or a native program.
An idle Node process took 29 MB, and Electron 43's executable running as plain Node took 35 MB (measured on our development machine, 2026-10-06, with Node 22.23.1), but neither showed a tray icon.
A probe settles it, with no sim: a tray icon and nothing else, idle for 60s, in Electron 43's main process, in .NET 9 WinForms built self-contained and with Native AOT, and in Rust on Win32, recording the memory and CPU of all of each one's processes.
It reads the watcher's part of [installing and updating](../product/03-v1-scope.md#installing-and-updating) and the watcher's row in [01-spine](01-spine.md#components).
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
Every SimConnect finding so far came through node-simconnect, which implements the protocol again in JavaScript ([01-spine](01-spine.md#the-core)), and a Rust core would call `SimConnect.dll` instead ([04-01](../../learn/foundations/04-01-connection-and-data.md#what-it-is)).
A probe settles it, at the main menu: connect, call mainUi over the CommBus and hear its answer, subscribe to a system event and to the flow events, and write a data slot of the p03 module and read its echo.
It reads [04-01](../../learn/foundations/04-01-connection-and-data.md), [05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md), the interface log's [2026-10-08 entries](../interface/log.md), and the probes p13 to p15.
Its answer goes in an entry in this area's log, which 1.3's section of `01-spine.md` cites.
Exit: a log entry in this area answers the question.
Done on 2026-10-08.

## 1.3.5 An embedded engine for plugins and write functions

Question: what do QuickJS and V8, embedded in a Rust program, cost to start, hold idle, and call, running a plugin and 100 profile write functions compiled from TypeScript, and do their memory and time limits stop a runaway script without taking the program down?
1.3 can't choose the core's language without it.
Plugin code runs only in the core, in TypeScript (user, 2026-10-08), and step 7 asks for a sandbox, with size limits, for the profile's write functions ([the product plan](../product/plan.md#7-tech-stack-and-architecture)), so a core in Rust or Node runs them in an engine with limits: Node's own `vm` module "is not a security mechanism" (documented, [Node.js vm](https://nodejs.org/api/vm.html)).
A probe settles it, with no sim: compile a small plugin and 100 write functions with esbuild, run them in QuickJS through rquickjs and in V8 through a Rust binding, call the write functions as every frame at 60 frames a second would, and break each limit on purpose; Node's `vm` module runs the same code as a baseline.
It reads [01-profile-entries](../sync/01-profile-entries.md#the-writer-api) and the [plugins](../product/03-v1-scope.md#plugins) section of 03-v1-scope.
Its answer goes in an entry in this area's log, which 1.3's section of `01-spine.md` cites.
Exit: a log entry in this area answers the question.
Done on 2026-10-08.

## 1.3.6 Tauri for the desktop app

Question: what does a Tauri 2 window cost in memory against an Electron window showing the same page, and what `Origin` does a WebSocket send from a Tauri page and from Tauri's Rust side?
1.3 can't take Tauri for the desktop app without it.
The core accepts a WebSocket only with `Origin` `coui://html_ui` or none ([tentative decisions](decisions.md#the-core-accepts-a-websocket-only-with-the-sims-origin-or-none)), so a desktop app whose pages send an `Origin` has to connect from a side that sends none.
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
Waits on 1.4.1.
Done on 2026-10-09.
Raised elsewhere: by 1.3, how the TypeScript sides, the sim's pages, the desktop app's pages, and plugins calling the core's host functions, get their types from the Rust crate that defines each message, so both sides are checked against one definition ([01-spine](01-spine.md#messages-between-components); [05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md#protocol-versioning-between-the-app-and-the-module-packed-structs)).
Raised elsewhere: by 1.1, what a pilot's identity is across a core restart, since FS Copilot made a restarted app "a new peer in every respect" (FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, R03), while [the connection](../product/03-v1-scope.md#the-connection) reconnects a returning pilot from session state saved on their machine.

## 1.4.1 Types from the Rust crate

Question: which of ts-rs, specta, and typeshare generates TypeScript types from the Rust crate that defines our messages, so that the types match what serde_json sends for messages shaped like ours; do the same messages reach TypeScript running in QuickJS-ng through rquickjs; and do the data slots' structs keep one layout when the crate builds for x86_64 and for wasm32?
1.4 can't say how a message crosses between Rust and TypeScript without it.
One Rust crate defines each message, and the TypeScript sides take their types from it ([01-spine](01-spine.md#messages-between-components)), because a format written twice drifts: fsc-editor writes its module's wire format in TypeScript and in C++, and "nothing but `src/main/sim/link.test.ts` notices when the two" drift (read in fsc-editor, `link/README.md`).
How well each generator fits is documented only.
ts-rs reads serde's attributes and gives 64-bit integers the type `bigint` unless set otherwise (documented, [ts-rs](https://github.com/Aleph-Alpha/ts-rs)), while Coherent GT has no `BigInt` (measured, [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits)).
specta's 2.0 has been a release candidate since early 2025, rc.25 on 2026-05-07 ([specta on crates.io](https://crates.io/crates/specta)), and typeshare's pages don't say how it treats 64-bit integers ([typeshare](https://github.com/1Password/typeshare)).
A probe settles it, with no sim: define messages shaped like ours in a crate, among them a tagged enum, optional and repeated fields, a UUID carried as text, and a time in µs; generate TypeScript with each tool; type-check sample values that serde_json writes against each tool's types, under TypeScript's strict settings; pass the same values into QuickJS-ng through rquickjs and read them in compiled TypeScript; and build the data slots' structs for both targets with assertions on their sizes and field offsets.
It reads [05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md#protocol-versioning-between-the-app-and-the-module-packed-structs), [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits), and the probes [p03](../../../experiments/areas/architecture/p03-rust-module.mjs) and [p04](../../../experiments/areas/architecture/p04-embedded-engine.mjs).
Its answer goes in an entry in this area's log, which 1.4's section of `01-spine.md` cites.
Exit: a log entry in this area answers the question.
Done on 2026-10-09.

## 1.5 A flight with Crosscheck's Rust pieces

Question: in a flight on MSFS 2024, does the core's Rust client on the SDK's `SimConnect.dll` do what our probes did there through node-simconnect, does our Rust WASM module run and trade data slots, does the helper's Raw Input get a key and a button that a person presses with the sim in front, and can our code open the banner's panel when a flight loads and when a session starts mid-flight?
Node 1 can't be done without it, because two of its tentative decisions rest on runs outside a flight.
[Crosscheck is written in Rust, and in TypeScript where an engine runs it](decisions.md#crosscheck-is-written-in-rust-and-in-typescript-where-an-engine-runs-it) names the SDK's `SimConnect.dll` and a Rust module, which have run only at the main menu, and under [the core catches the take-control key and buttons](decisions.md#the-core-catches-the-take-control-key-and-buttons), the helper has received only keys that another program sent while another window was in front.
The banner decides whether the toolbar script is a component at all.
It opened our panel with no click only after a Build and Mount ([interface log](../interface/log.md#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click)), while the same call opened the panel from the EFB's page too ([interface log](../interface/log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)), where our EFB app's code runs with the EFB closed ([interface log](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)).
So if the toolbar script can't open the panel at a flight load, the EFB app may, and the toolbar script goes.
Three measurements that stages of step 8 need ride along, because the flight is set up anyway and none needs the user (user, 2026-10-09): whether a clock our module reads counts the same ticks as the core's `QueryPerformanceCounter`, how long a data-slot write from the module takes to reach the core, and how each page's `performance.now()` runs against the core's counter ([01-spine](01-spine.md#left-open)).
A guided probe that the user runs settles it.
In one flight, the core's Rust client does masking, including a group that took its priority as the sim started, AI objects with liveries, input events, the camera, and a flight load's flow events, as the probes behind the [flight-controls](../flight-controls/log.md), [avatars](../avatars/log.md), and [sync](../sync/log.md) logs did through node-simconnect.
Our module counts frames, echoes a data slot, and stamps that echo on any clock it can read, the user presses a key and a button the helper listens for while the sim is in front, and the toolbar script and the EFB app's code each try to open the banner's panel at a flight load and mid-flight.
Meanwhile the core stamps the module's echoes as they arrive, and times each page's `performance.now()` against its own counter over a few minutes, through the sim's inspector.
It reads the architecture log's 2026-10-08 entries, the probes [p02](../../../experiments/areas/architecture/p02-rust-helper.mjs), [p03](../../../experiments/areas/architecture/p03-rust-module.mjs), and [p06](../../../experiments/areas/architecture/p06-rust-simconnect.mjs), the [interface log](../interface/log.md), and the probes the flight-controls, avatars, and sync logs name.
Its answer goes in entries in the logs of the areas the findings belong to, which `01-spine.md` and the tentative decisions cite.
Exit: log entries answer each part of the question.
Done on 2026-10-09.

## 1.6 Frameworks

Question: which frameworks does each component build on, beyond the languages and toolchains 1.3 chose, how is our code in Coherent GT compiled and checked, and what can the EFB app share with the desktop app's pages?
Step 7's exit needs a decision on the frameworks ([the product plan](../product/plan.md#7-tech-stack-and-architecture)).
1.3 left three of them open as choices inside one part: the framework for the desktop app's pages, the core's async runtime and WebSocket library, and the compiler and syntax target for our code in Coherent GT, which four components share ([01-spine](01-spine.md#left-open)).
Step 7 also asks for a check, run in CI and after edits, that every file run in Coherent GT, experiments included, parses within the engine's measured limits, written after we look for Coherent GT's own documentation of its JavaScript and for rules others already maintain; this node sets its rules, and the build's stage of step 8 runs it.
It also settles what code the EFB app can share with the desktop app, which [03-v1-scope](../product/03-v1-scope.md#efb-app) narrows: the EFB app is built on the sim's EFB framework, and the desktop app's interface doesn't run in the EFB.
It reads step 7 of [the product plan](../product/plan.md#7-tech-stack-and-architecture), the spine's [language and toolchains](01-spine.md#language-and-toolchains), the foundations chapters [05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md) and [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits), and the [EFB app](../product/03-v1-scope.md#efb-app) section of 03-v1-scope.
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.
Waits on 1.6.1 and 1.6.2.
Done on 2026-10-09.

## 1.6.1 Coherent GT's JavaScript, as documented and as others build for it

Question: what do Coherent Labs and the MSFS 2024 SDK document about the JavaScript Coherent GT runs; what compile targets and lint rules do the MSFS Avionics Framework, FlyByWire, and other open MSFS projects build their in-sim code with; and how is the framework published, licensed, and versioned, so we know whether to bundle our own pinned copy or use the one the sim provides?
1.6 can't set our compiler's target or write the parse check's rules without it: step 7 asks us to look for Coherent GT's own documentation of its JavaScript, and for rules others already maintain, before writing ours ([the product plan](../product/plan.md#7-tech-stack-and-architecture)).
Our list of what the engine lacks comes from one probe of one A220 document on 2026-08-30 ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits)).
Our interface in the sim is built on the MSFS Avionics Framework ([tentative decisions](decisions.md#our-interface-in-the-sim-is-built-on-the-msfs-avionics-framework)), and p08's EFB app used the copy the sim provides, which a sim update can change ([architecture log](log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)).
It reads 06-01 and the FS Copilot fork's `record/pointer-forwarding/docs/09-environment.md`, then searches Coherent Labs' documentation, the MSFS 2024 SDK's, and the build configurations of the MSFS Avionics Framework's mirror, FlyByWire's aircraft, and other open MSFS projects.
Its answer goes in an entry in this area's log, which 1.6.2 and 1.6's section of `01-spine.md` cite.
Exit: a log entry in this area answers the question.
Done on 2026-10-09.

## 1.6.2 The syntax and built-ins Coherent GT has

Question: which syntax from ES2017 to ES2022 does Coherent GT parse, which built-ins does it have, and does a TypeScript module compiled at the target 1.6.1 points to run in the EFB's document?
1.6 can't set the compiler's target, decide what the build fills in or rejects, or write the parse check without it.
Coherent GT has ES2017's `async` and lacks ES2020's `?.`, and nobody has tested the syntax in between ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#unverified-claims)); it has `Array.prototype.flat` and lacks `Object.fromEntries`, both ES2019 (FS Copilot fork, `record/pointer-forwarding/docs/09-environment.md`).
The module stands for the logic the EFB app and the desktop app's pages would share, since the EFB app is its own app on the sim's EFB framework ([03-v1-scope](../product/03-v1-scope.md#efb-app)).
A probe settles it, with nothing for the user to do: through the inspector, in the main menu's EFB, toolbar, and mainUi documents, and in a cockpit panel once a flight is loaded, evaluate each syntax feature and built-in on its own, so that one that fails to parse hides no other; then evaluate the compiled module in the EFB's document and run it.
It reads 1.6.1's answer, 06-01, [inspector.mjs](../../../experiments/tools/inspector.mjs), and p08's EFB app in [flight/build.mjs](../../../experiments/areas/architecture/flight/build.mjs).
Its answer goes in an entry in this area's log, which 1.6's section of `01-spine.md` cites.
Exit: a log entry in this area answers the question.
Waits on 1.6.1.
Done on 2026-10-09.

## 2 How the cores reach each other

Question: how do a session's cores reach each other and the relay: the topology, the transport, getting through home routers, the relay, and encryption?
Step 7 can't decide the core architecture without it.
Its decisions pick whether each machine sends to every other directly or through the flying machine ([02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order)), and v1 builds a transport in which each channel declares who sends and receives it, its delivery, its priority, and whether it joins the cockpit's shared order ([04-room-for-later](../product/04-room-for-later.md#channels)).
The relay's language follows from the transport, since a Cloudflare Worker can't relay UDP as of 2026-10-08 ([01-spine](01-spine.md#between-machines)), so this node picks it.
It also says how a core learns that the relay or another pilot's core went quiet ([01-spine](01-spine.md#how-the-core-knows-a-component-is-alive)), and weighs the ways [the connection](../product/03-v1-scope.md#the-connection) lists to soften a short gap.
The transport lets a developer run a whole session on one PC, with two cores, each with its own ports and identity ([the product plan](../product/plan.md#7-tech-stack-and-architecture)).
It reads the [network log](../network/log.md), [01-aims](../product/01-aims.md#relay-and-license), the [invite code](../product/03-v1-scope.md#invite-code) and [the connection](../product/03-v1-scope.md#the-connection) in 03-v1-scope, [channels](../product/04-room-for-later.md#channels) in 04-room-for-later, the spine's [between machines](01-spine.md#between-machines) and [shared conventions](01-spine.md#shared-conventions), and the foundations chapters [08-05](../../learn/foundations/08-05-position-and-clocks.md) and 09-01 to 09-06, starting with [09-01](../../learn/foundations/09-01-addresses-and-link-quality.md).
It also reads our earlier relays: the FS Copilot fork's `record/self-hosted-relay/` and `record/traffic-atc/docs/04-transport.md`, and fsc-editor's `relay/`.
Its answer goes in a design doc in the network area, `record/areas/network/01-between-machines.md`.
Exit: the user agrees to that design doc.
Waits on 2.1, 2.2, and 2.3.
Reopened on 2026-10-11, by a design review of its answer against v1's scope, the features after v1, and our earlier projects' incidents, which found gaps v1 hits, such as two connections for one pair after an outage and two machines both flying after an ordinary drop.
Done on 2026-10-11.
Raised elsewhere: by 1.4, how the cores pack each field of a message, how each channel other than the cockpit's tells a copy from a late message, and whether the relay's and the backend's messages are the message crate's ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.4, what a core does when it starts and finds a session file after being down long enough that its pilot may have been cut off for more than 5 minutes ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.4, how a receiver estimates each sender's clock offset, what a higher restart count does to it, and how far two PCs' counters part in practice, which the flight-model sync uses ([01-spine](01-spine.md#left-open)).

## 2.1 Carrying a session's traffic

Question: how do the best current designs carry real-time traffic between two home PCs, directly and through a relay, and which Rust library lets us build the best of them?
2 can't pick the transport, the way through home routers, or the relay without it, and the relay's language follows from the relay.
The record knows the networking of FS Copilot's LiteNetLib, fsc-editor's WebSocket relay, and YourControls' laminar ([10-02](../../learn/foundations/10-02-yourcontrols.md)), and knows QUIC and WebRTC only from their RFCs ([09-02](../../learn/foundations/09-02-transports-and-delivery.md)).
FS Copilot's networking came from patching an existing app with as little change as possible, so its choices are one example among others, while its measurements stand (user, 2026-10-09).
Each channel gets the delivery it needs: a stream that resends for messages that must arrive, and packets sent once for what the next message replaces, such as the flight model, the avatars, and ATC audio ([channels](../product/04-room-for-later.md#channels)).
The sender sends the most urgent data first, so a bulk transfer never delays the flight model.
Encryption isn't a requirement, because nothing a session carries is sensitive, so Crosscheck builds nothing for it, and a transport that encrypts anyway is judged only on the bytes that adds (user, 2026-10-09).
A research read settles it.
It reads the documentation and source of QUIC through quinn, iroh, WebRTC data channels with a TURN relay, Valve's GameNetworkingSockets, and a UDP protocol of our own, and Tailscale's hole punching for its method.
It judges each on each channel's delivery, priorities between channels, hole punching, relay fallback and switching between the two mid-session, two cores on one PC, the bytes it adds to a packet, and its maintenance as of 2026-10 and its license.
For each relay, it judges what the relay is, its language, its cost per relayed session-hour against the aim of about $10 a month, and how that cost grows with users, since one small relay's figures say little about many users (user, 2026-10-09).
It may end in a probe, such as relaying through Cloudflare's TURN from a client that isn't WebRTC, which the spine leaves unverified ([01-spine](01-spine.md#between-machines)).
It reads [01-aims](../product/01-aims.md#relay-and-license), [the connection](../product/03-v1-scope.md#the-connection), [channels](../product/04-room-for-later.md#channels), the [network log](../network/log.md), the spine's [between machines](01-spine.md#between-machines), and the foundations chapters 09-01 to 09-06 and [10-02](../../learn/foundations/10-02-yourcontrols.md).
Its answer goes in an entry in the network log, which 2's design doc cites.
Exit: a network log entry answers the question.
Done on 2026-10-10.

## 2.2 Packing a message between cores

Question: which binary format does the message crate use between cores, and how many bytes does each channel's message take in it?
2 can't say how the cores pack each field of a message without it, which 1.4 raised ([01-spine](01-spine.md#left-open)), and a message sent once has to fit in one packet, whose size 2.1 bounds.
Between cores, the messages are the crate's ([messages and their types](01-spine.md#messages-and-their-types)), and a UUID takes 16 bytes in a binary serde format, against 36 characters as text ([IDs](01-spine.md#ids)).
The relay's traffic grows with each message's size, and the user prefers compact messages.
A probe settles it, with no sim: encode sample messages of each v1 channel in postcard 1.1.3, MessagePack through rmp-serde 1.3.1, which YourControls uses ([10-02](../../learn/foundations/10-02-yourcontrols.md)), bitcode 0.6.9, which packs bits, and wincode 0.6.2, which writes bincode's format, compare their sizes, and decode each back.
bincode itself is out: its development "has ceased", and its last release, 3.0.0 on 2025-12-16, holds only a README and a compile error ([bincode 3.0.0 on docs.rs](https://docs.rs/crate/bincode/3.0.0)).
The samples include a cockpit change with its vector clock for two pilots, a flight-model sample, an avatar pose, and a traffic batch.
It reads the spine's [messages and their types](01-spine.md#messages-and-their-types) and [IDs](01-spine.md#ids), [02-live-sync](../sync/02-live-sync.md), [channels](../product/04-room-for-later.md#channels), and the probe [p07](../../../experiments/areas/architecture/p07-types.mjs).
Its answer goes in an entry in the network log, which 2's design doc cites.
Exit: a network log entry answers the question.
Done on 2026-10-10.

## 2.3 A probe across friends' home networks

Question: between real home networks, how often does iroh link two PCs directly, how much do the stalls of its relay, which carries packets over TCP, cost a session's traffic against a UDP relay under the same loss, how fast does iroh move to the relay when a direct link dies silently, how much does a busy home upload add to a session's delays, and how far does a PC's `QueryPerformanceCounter` part from true time?
2 can't choose its transport without it, because 2.1 leads with iroh as it is on two conditions nobody has measured: that its relay's stalls don't show in flight data and ATC audio, and that its switch to the relay can be made fast enough ([network log](../network/log.md#2026-10-10-iroh-13-leads-for-carrying-a-session-between-home-pcs-provided-its-tcp-relays-stalls-dont-show-and-its-switch-to-the-relay-can-be-made-fast)).
Neither condition has a pass line yet: the user sets the audio buffer and the switch time we'd accept from this probe's counts, before node 2 picks.
Nor can 2 settle without it how often a heartbeat must go to keep a router's mapping open, how often short gaps come, which tells us which of the ways to soften a gap in [the connection](../product/03-v1-scope.md#the-connection) to build, or how far two PCs' counters part, which 1.4 raised ([01-spine](01-spine.md#left-open)).
Our records measure round trips only from our own PC to servers ([09-01](../../learn/foundations/09-01-addresses-and-link-quality.md)), and one home router of ours, which forgot an idle UDP mapping after 120s to 150s ([network log](../network/log.md#2026-10-10-a-cloudflare-turn-allocation-exchanges-data-with-10-peer-addresses-over-its-life-and-silently-drops-everything-to-or-from-an-11th)).
A probe settles it, with no sim.
Each friend runs one program on their home PC whenever they like, for about an hour, alone, with nothing to do once it starts (user, 2026-10-10).
Its other end is ours (user, 2026-10-10):

- a temporary droplet near the friends, running our own iroh relay, a UDP forwarder, and copies of the probe;
- a second temporary droplet in a distant region, running another iroh relay and UDP forwarder;
- a copy of the probe that runs all day on the user's PC, behind a real home router.

1. It asks for every approval first: Windows' SmartScreen warning, Windows Firewall's prompt, which the program brings up by opening its sockets and asking the router for a port at launch, and one consent screen.
   The screen says how long it runs; that it uses the full upload speed for about a minute, and that its load on the PC and the connection is very low otherwise; and what it uploads to our server: its measurements, such as connection times, delays, and losses, and the PC's public IP address and the kind of router it's behind.
   Then it keeps the PC awake and runs to the end.
2. It finds whether the friend's router keeps one public port for every destination, through a few public STUN servers, whether the router answers UPnP, NAT-PMP, or PCP, whether the PC reaches the internet over IPv6, and whether the router keeps an idle mapping through gaps of 30s, 60s, 120s, and 180s.
3. It tries about 10 fresh iroh connections to each of three copies of the probe on the droplet, each behind a NAT the droplet simulates in a network namespace of its own: one that keeps one public port for every destination, one that also filters by sender, and one that picks a new port for each destination.
   It tries the same to the copy on the user's PC, which puts two real home routers against each other.
4. Against the copy behind the easiest simulated NAT, it times iroh's move to the relay when the droplet's firewall drops the direct path mid-session, and its move back.
   It runs this with iroh's path idle timeout at 15s, 5s, and 2s, set through `QuicTransportConfigBuilder::default_path_max_idle_timeout`, which agents read accepts values under 15s (unverified), or by patching iroh if it doesn't.
5. For about 20 minutes, it sends traffic shaped like a session to the copy on the user's PC through our iroh relay, with iroh's direct addresses off through `Builder::clear_ip_transports()`, while the UDP forwarder carries an identical copy beside it.
   The traffic is a flight-model stream of 20 one-off packets a second of about 150 bytes, a cockpit stream that resends, of about 5 messages a second of about 100 bytes, and an audio-shaped stream of 50 one-off packets a second of about 60 bytes, an Opus frame's size at 24 kbps (FS Copilot fork, `record/traffic-atc/docs/04-transport.md`, "The MTU floor").
   The droplet drops packets on the traffic between the relay and the friend's PC, both ways, with Linux's `tc netem`: none, then 1%, then 3%, then bursts of 5 packets in a row about every 10s.
   The same four runs go through the distant droplet, and the 20 minutes cover both.
   Our analysis finds every stall and gap with its length, and how many would show behind a flight-model delay of 100ms and of 0.4s, and in an audio buffer of 60ms.
6. For one minute, it uses the full upload speed toward the droplet while step 5's traffic runs over the direct path, and records how far that traffic's round trip and loss rise.
7. It samples `QueryPerformanceCounter`, the counter every stamp uses ([times](01-spine.md#times)), against the droplet's clock, which internet time keeps accurate, through the run.
   It doesn't read the system clock, because Windows' time service steers it.
8. If another friend's run overlaps, the server introduces the two, and they connect through iroh as in step 3, recording whether the link went direct and how long that took, then send session traffic between them on the side, recording its round trips and losses.

The program uploads raw data and draws no conclusions, so our analysis runs on our side and can run again with other thresholds, and it collects all the raw data that's reasonable to collect (user, 2026-10-10):

- every packet both ways, on every stream and path: its channel, number, size, send stamp, and arrival stamp;
- every connection attempt, with its candidate addresses and the time each step took;
- iroh's path events, and each path's statistics each second: round trip, congestion window, lost packets, congestion events, and MTU;
- the router's and the STUN servers' answers as they came;
- the PC's network: wired or Wi-Fi, link speed, Wi-Fi signal strength where Windows reports it, IPv6 addresses, and Windows' network-change, sleep, and resume events;
- the PC's CPU and memory load each second, and its Windows version;
- `QueryPerformanceCounter` samples against the droplet's clock, and the system clock beside them;
- the droplets' own side: the relay's and forwarder's logs and the `tc netem` and firewall settings in force at each moment.
It writes its raw data to a file on the PC as it goes, so uploading never competes with the traffic it measures and a crash loses little, and it uploads the file itself at the end (user, 2026-10-10).
If that upload fails, it retries the next time it's opened, and as a last resort the window shows the file so the friend can send it over by hand.
Its window says what it's doing at each step and shows progress through the whole run (user, 2026-10-09), in clear words that name things as they are, such as a relay server or a peer, rather than vaguer ones such as "partner" (user, 2026-10-10).
It's unsigned, so each friend passes the SmartScreen warning once.
Its raw results carry the friends' public IP addresses, which they agree to send us, and the results we commit leave them out, because nothing personal enters the tree ([CLAUDE.md](../../../CLAUDE.md#working-rules)).
It reads the [network log](../network/log.md), the foundations chapters [09-01](../../learn/foundations/09-01-addresses-and-link-quality.md), [09-03](../../learn/foundations/09-03-nat-and-traversal.md), and [09-06](../../learn/foundations/09-06-connection-lifecycle.md), the spine's [times](01-spine.md#times), and 2.1's answer.
Its answer goes in an entry in the network log, which 2's design doc cites.
Exit: a network log entry answers the question.
Waits on 2.1.
Done on 2026-10-10.

## 3 Sync and the session

Question: in what order does catch-up apply state, how does catch-up run as a pipeline of steps, how does a core that restarted recover, and how do the session's roles and members work?
Step 7's decisions pick the order catch-up applies state in, where we lean toward first-final-value order, which needs the session's history, kept in the recording ([03-catch-up](../sync/03-catch-up.md#choosing-the-order)).
They also build in three things [04-room-for-later](../product/04-room-for-later.md) says v1 builds: catch-up as a pipeline of steps ([a catch-up pipeline](../product/04-room-for-later.md#a-catch-up-pipeline)); one table of roles, each with its rule for who holds it, how it moves, and what happens when its holder drops out ([roles](../product/04-room-for-later.md#roles)); and a member list in which each member is crew or a passenger, with vector clocks that hold only members who send ([people beyond the crew](../product/04-room-for-later.md#people-beyond-the-crew)).
The PF is the table's first role, so the take-control tie is part of how that role moves.
It waits on node 2, because how a restarted core recovers and how the cockpit channel tells a copy from a late message turn on what that channel resends.
It reads the sync design docs, [01-profile-entries](../sync/01-profile-entries.md), [02-live-sync](../sync/02-live-sync.md), and [03-catch-up](../sync/03-catch-up.md), and the [sync log](../sync/log.md); the [control](../product/03-v1-scope.md#control) and [session](../product/03-v1-scope.md#session) sections of 03-v1-scope; [04-room-for-later](../product/04-room-for-later.md); the spine's [shared conventions](01-spine.md#shared-conventions); and the foundations chapters [08-01](../../learn/foundations/08-01-replication-models-and-authority.md), [08-02](../../learn/foundations/08-02-echoes-and-initial-sync.md), and [08-03](../../learn/foundations/08-03-ordering-and-classes-of-data.md).
Its answer goes in two new design docs: `record/areas/sync/04-order-and-recovery.md` for the sync rules, with a note at the top of each earlier sync doc whose text it changes, and `record/areas/session/01-roles-and-members.md` for the roles and the member list.
Exit: the user agrees to the answer in those documents.
Waits on 2.
Raised elsewhere: by 1.4, how a core that restarted while the sim kept running recovers what it lost and gets its pilot's lost changes to the others, how the cockpit channel tells a copy from a late message, and how the conflict rule orders two changes from one pilot under two restart counts ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.4, whether a vector clock names each counter by its pilot's ID and restart count or by a place in the member list, and how a place would name a restart count ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.1.2, how the core judges an aircraft settled in a session started before 03-catch-up's rule could call it settled ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1, how the machines agree on which of two take-control presses came first, which per-machine clock offsets can't settle alone ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 2, how a returning ex-PF's cockpit and aircraft come to the new PF's state when another pilot took control while their connection was lost, over what the ex-PF flew alone, given that control settles first, in a new connection's first message, and every receiver drops the ex-PF's replayed cockpit messages made under its superseded control value, counting each as delivered, and samples made under any older value; and how the cockpit's causal order marks a dropped message as delivered ([01-between-machines](../network/01-between-machines.md#control)).
Raised elsewhere: by 2, who may change control and when, in the table of roles, since node 2 settles only how the control value travels and that a tie goes to the lower pilot ID, which answers the line by 1 above for presses within one round trip ([01-between-machines](../network/01-between-machines.md#control)).
Raised elsewhere: by 2, how a PF whose sim crashed comes back, its aircraft and cockpit restored and control resumed if nobody took it meanwhile, since a crash passes nothing (user, 2026-10-11; [01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)).
Raised elsewhere: by 2, how a receiver paces a replay of up to 30 minutes, applying state entries, the PF's levers and trim among them, at their newest value while it keeps the spacing between events and presses, so a replay of minutes of trim or throttle doesn't run for minutes, since at the PF's spacing a replay runs nearly as long as a busy cut, and an entry the pacing skips counts as delivered ([01-between-machines](../network/01-between-machines.md#coming-back)).
Raised elsewhere: by 2, how a replay handles messages a restarted core lost, the user preferring a replay with gaps over a full catch-up of state, which can't restore a display's page or an FMS ([01-between-machines](../network/01-between-machines.md#coming-back)).
Raised elsewhere: by 2, whether any of the session channel's keys that several members write, such as active pause, the countdown, Go without, and seat claims, needs more than node 2's stamp, which keeps the same one of two changes on every machine and lets a new PF's win, such as an authority or the cockpit's shared order ([01-between-machines](../network/01-between-machines.md#channels)).
Raised elsewhere: by 2, how the following machine writes the PF's last value back when the PM moves a PF-owned engine lever or trim ([01-between-machines](../network/01-between-machines.md#channels)).
Raised elsewhere: by 2, naming a profile entry by its index in a message, which 2.2 found cuts a cockpit change from 84 bytes to 27, only when both machines' profile hashes match, since the match check lets a crew fly with different profiles ([network log, 2.2](../network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does)).

## 4 Profiles and plugin delivery

Question: what are a profile's syntax and file layout, what size limits does the sandbox for write functions set, what form do a plugin's changes to aircraft files take, and how do profiles and plugins reach pilots?
Step 7's exit needs a decision on the profile format, which takes the shape [01-profile-entries](../sync/01-profile-entries.md) gives it, two blocks of entries and a writer API, and the decision picks its syntax and file layout; step 7 also picks the size limits of the sandbox that write functions run in ([the product plan](../product/plan.md#7-tech-stack-and-architecture)).
The format builds in what [04-room-for-later](../product/04-room-for-later.md#profiles) says v1 builds: watch-only entries, plugin values, a direction field with room for a third value, profile hashes the match check compares, and a format that takes new blocks.
Profiles and plugins reach pilots apart from Crosscheck's releases, signed, and pinned for each session by hash ([tentative decisions](decisions.md#profiles-and-plugins-reach-pilots-apart-from-crosschecks-releases)).
It reads 01-profile-entries; the [plugins](../product/03-v1-scope.md#plugins), [preflight match check](../product/03-v1-scope.md#preflight-match-check), and [installing and updating](../product/03-v1-scope.md#installing-and-updating) sections of 03-v1-scope; the [profiles](../product/04-room-for-later.md#profiles) and [plugins](../product/04-room-for-later.md#plugins) sections of 04-room-for-later; the [tentative decisions](decisions.md#plugin-code-runs-only-in-the-core) on plugins; the architecture log's [QuickJS-ng entry](log.md#2026-10-08-embedded-in-rust-quickjs-runs-100-write-functions-a-frame-in-75µs-idles-under-1-mb-and-holds-its-memory-and-time-limits-while-v8s-memory-limit-failed-until-turbofan-was-off); and FS Copilot's profiles in `../fsc/profiles/`.
Its answer goes in a design doc in the profiles area, `record/areas/profiles/01-format-and-delivery.md`.
Exit: the user agrees to that design doc.
Raised elsewhere: by 1.1 and 1.3, where profiles and plugins are served from, how their signing keys are kept, and how often the core checks for new versions ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.4, how the version of our plugin API that each profile and plugin declares relates to Crosscheck's version ([01-spine](01-spine.md#left-open)).
