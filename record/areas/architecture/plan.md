# Architecture: plan

This plan designs Crosscheck's v1 architecture in nodes 1 to 4, for [step 7](../product/plan.md#7-tech-stack-and-architecture) of the product plan, and v1's code map, systems, tests, and build order in nodes 5 to 8, for [step 8](../product/plan.md#8-v1-build-plan).
Each goes deeper until every detail rests on a fact, by the rules in [When a node is done](#when-a-node-is-done).
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

The tree has two roots, steps 7 and 8 of the product plan, and each root's question is its step's exit.
Step 7's top-level nodes are 1 to 4, and step 8's are 5 to 8.
When every top-level node under a root is done and their answers don't yet give what its step's exit names, propose the next top-level node under it, as step 2 does.
When they do, check the top-level answers as step 4 does, run the other checks its step's exit names, number this area's tentative decisions as [Where answers go](#where-answers-go) says, and mark the step done in [the product plan](../product/plan.md).

## When a node is done

A node is marked done only when all of these hold:

- Every claim its answer rests on is measured, is read in files and doesn't turn on which code path runs, or is knowledge that [Evidence](../../../.claude/rules/writing.md#evidence) lets go unmarked.
  A documented or unverified claim needs a child that settles it, such as a read, a search of our prior work, or a probe in `experiments/`, proposed as step 2 says.
- Every choice the answer leaves open can be made later inside one part of Crosscheck without changing another, as the core's WebSocket library could be if no client sees it (a hypothetical example).
- Its answer settles each `Raised elsewhere:` line under it.

A node under step 8 goes one level below the spine, so it also meets these:

- Every choice its answer leaves open can be made later inside one crate or package without changing another's interface, where the second rule above asks only for one part.
- Every rule its answer leaves open that turns on frame timing is a named test case, owned by one crate, for [node 7](#7-testing)'s tests in the sim, because frame timing is settled in the sim, not on paper ([01-format-and-delivery](../profiles/01-format-and-delivery.md#checking-a-write)).
- Its answer sets a budget for the code it designs: frame time for code in the sim, and CPU and memory for code that runs all day on the pilot's PC (user, 2026-10-14).
- Its answer has had one review round: a scenario walker, a simplifier, and a fact-check.

## Where answers go

An answer goes in one of these documents, never in this plan:

- a design doc in the area the answer belongs to, such as `record/areas/network/`
- a reference, beside what it describes
- a tentative decision in this area's `decisions.md`
- an entry in the log of the area the finding belongs to, for a child that's a read, a search, or a probe, which the parent's answer cites

This plan holds each node's question, its status, and its `Raised elsewhere:` lines.

Once a root's top-level answers pass its walk through a session ([how the tree grows](#how-the-tree-grows)), write each tentative decision from its nodes in this area's `decisions.md` as a numbered decision in `record/decisions/`, and link the tentative one to it.
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
Reopened on 2026-10-11, by node 3's answer, which makes a sim that closes count as leaving the flight, so a PF's crash passes control ([04-order-and-recovery](../sync/04-order-and-recovery.md#a-sim-that-closed)).
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
Reopened on 2026-10-12, by the root's walk through a session ([how the tree grows](#how-the-tree-grows)), which found that a machine in an aircraft other than the flying machine's would apply and send changes to entries the other aircraft lacks, and stall the cockpit stream behind one it can't apply ([03-v1-scope](../product/03-v1-scope.md)).
Reopened on 2026-10-12, by a walk of its answer through real scenarios with the user, which found that a traffic and ATC host out of the flight kept the role from the crew, that a core restarted after a PC crash passed control before it could know the current control value, and, zooming out, that recovering a crashed core in place cost more than a late join ([04-order-and-recovery](../sync/04-order-and-recovery.md#a-core-that-restarts)).
Reopened on 2026-10-13, by another review of its answer, checked against the sources and the day's decisions, which found that the time of day went stale as a session key, that control could pass to a pilot out of the flight or during preflight, that a catch-up of a settled aircraft had no end, that an input event reports no value until it changes, that traffic copies came back forever and parked ones vanished, that nothing paced what queued behind a replay, and that a jittering lever could flood the stream ([04-order-and-recovery](../sync/04-order-and-recovery.md); [roles and members](../session/01-roles-and-members.md)).
Done on 2026-10-13.
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
Reopened on 2026-10-12, by the root's walk through a session ([how the tree grows](#how-the-tree-grows)), which found five places where its answer didn't fit the others: the core fetched a profile only when an aircraft loaded, though the spine loads one when a session starts with the aircraft already loaded; a session pinned one bundle though it can change aircraft; the format named the flight controls among the PF's entries, which node 2 carries in the flight model's samples; two tentative decisions kept the watcher's jobs for plugins' file changes, which this node deferred; and a variant named only a folder, where modular aircraft keep their variants as presets inside one ([01-format-and-delivery](../profiles/01-format-and-delivery.md)).
Reopened on 2026-10-13, by node 3's second review, which made a session fly one aircraft, so it pins one bundle again ([roles and members](../session/01-roles-and-members.md#the-pf)).
Done on 2026-10-13.
Raised elsewhere: by 1.1 and 1.3, where profiles and plugins are served from, how their signing keys are kept, and how often the core checks for new versions ([01-spine](01-spine.md#left-open)).
Raised elsewhere: by 1.4, how the version of our plugin API that each profile and plugin declares relates to Crosscheck's version ([01-spine](01-spine.md#left-open)).

## 5 The code map

Question: what are the units of Crosscheck's code, its crates and packages; which tier is each in; what does each own; what is its interface; which units may it depend on; and which units make up each system?
Step 8 can't design a system, a test, or a stage until it knows which units exist and what each may reach.
The spine names the components and the parts ([01-spine](01-spine.md#parts)), and the code map names the units inside them, each in one of three tiers (user, 2026-10-14):

- **The platform:** the services every feature uses, in the core, such as the session, control, channels, and recording, and in the sim, the panel bridge and our WASM module, which load what features and plugins run there by name ([04-room-for-later](../product/04-room-for-later.md#code-inside-the-sim)).
- **Engines:** libraries that know nothing of the app, so another program, such as the [Crosscheck IDE](../product/ideas.md#crosscheck-ide), can link them.
- **Features:** each one thing a pilot gets, such as pointer sync or the PF's spot on the world map.

Three tests stand in for a definition of clean, because a definition in prose invites an agent to enforce it where it doesn't fit (user, 2026-10-14):

- Deleting a feature, its crate, its one registration, its modules in the message crate and the profile engine, its routines in our WASM module and their line in the module's list, its panel modules, and its section in each app, leaves everything else building and passing its tests.
- An engine builds and runs outside the core.
- CI checks each crate's dependencies against the ones the map allows.

A system is the units one design doc designs, in one area, and [node 6](#6-systems) designs each system.
A feature's messages stay in the one message crate of [decision 025](../../decisions/025-messages-in-one-rust-crate.md), so deleting a feature also deletes its module there (user, 2026-10-14).
Each contract is defined once, and linked or generated wherever it's used, because a hand-kept copy in our earlier work bred bugs.
fsc-editor's Trace copied eight of FS Copilot's C# functions into TypeScript, and of the bugs in its first cut, "All three were found by re-reading, not by any check" (fsc-editor, `docs/help/trace-panel.md`, "The problem, stated honestly").
An IDE that links the sync engine runs the core's own code instead.
It reads the spine, decisions 001 to 046, the design docs in the [network](../network/01-between-machines.md), [sync](../sync/01-profile-entries.md), [session](../session/01-roles-and-members.md), and [profiles](../profiles/01-format-and-delivery.md) areas, [03-v1-scope](../product/03-v1-scope.md), [04-room-for-later](../product/04-room-for-later.md), and the [avatars' tentative decisions](../avatars/decisions.md).
Its answer goes in `02-code-map.md`, in this area.
Exit: the user agrees to `02-code-map.md`.
Waits on 5.1, 5.2, 5.3, and 5.4.
Done on 2026-10-15.

## 5.1 The platform's interface

Question: how does the platform run its features, and what does a feature register with it and call, among moments in the session, session keys, roles, channels, message kinds on the cockpit stream, catch-up steps, profile blocks, client state and commands, notices, settings, items for the match check, recording, and the core helper's input and audio?
5 can't give any feature its dependencies without it, since every feature's crate is written against it.
[04-room-for-later](../product/04-room-for-later.md#plugins) names the hooks, moments in a session, channels, catch-up steps, and code inside the sim, and says "v1's own features are built on the hooks plugins use", but gives them no shape.
Features reach each other only through the platform's moments and registries, so deleting one leaves the others whole.
Traffic and ATC audio each register a role of their own, and one switch grants and releases both (user, 2026-10-14), where [roles and members](../session/01-roles-and-members.md#the-traffic-and-atc-host) gives them one role that can split.
A feature's profile block, such as pointer sync's `displays` or avatars' `seats`, stays in the profile engine, as its messages stay in the message crate, because CI and the IDE check a profile without the core (user, 2026-10-14).
It also settles how an ID that's stored, or crosses between versions, is named, such as a message's kind in the recording, which later versions of Crosscheck still read ([04-room-for-later](../product/04-room-for-later.md#recording)).
postcard writes an enum's variant as its position (read in postcard 1.1.3, `src/ser/serializer.rs`, `serialize_unit_variant`), so deleting one feature's variant would shift every variant after it.
It reads 04-room-for-later, the [channels](../network/01-between-machines.md#channels) of 01-between-machines, [04-order-and-recovery](../sync/04-order-and-recovery.md), the [plugins](../profiles/01-format-and-delivery.md#plugins) of 01-format-and-delivery, and the spine's [components](01-spine.md#components).
Its answer goes in its own section of `02-code-map.md`.
Exit: the user agrees to that section.
Waits on 5.1.1.
Done on 2026-10-14.

## 5.1.1 How hosts run and extend themselves

Question: how do current designs run an app's core and its extensions, on one ordered loop or as concurrent tasks, with extensions registered at compile time, so that deleting one leaves the rest whole, a run replays exactly from its recorded inputs, order holds at the sim's frame rate, and plugins in an embedded JavaScript engine reach a subset of the same hooks?
5.1 can't choose how the platform runs its features without it, and the choice sets the shape of every hook: a call on one loop, or a message between tasks.
fsc-editor replayed its recorded sim events through the same code, and its replay "swaps the source of events and changes nothing else" (fsc-editor, `src/main/sim/replay.ts`).
Replaying every input of the core, from the sim, the other cores, the clients, the core helper, the clock, and slow work such as a QuickJS-ng call, would carry that to the whole core, so a bug report's recording could reproduce a bug in the core on our own PC.
A research read settles it.
It reads sans-IO protocol cores such as quinn-proto and str0m, deterministic simulation testing in Rust, such as madsim, turmoil, and shuttle, actor patterns on tokio, Bevy's plugins and schedules, and VS Code's and Zed's extension APIs.
It judges each on registering at compile time, deleting an extension, replaying a run from recorded inputs, keeping order at the sim's frame rate, and giving plugins in QuickJS-ng a second face.
It reads the spine's [the core](01-spine.md#the-core), [decision 027](../../decisions/027-core-runs-on-tokio.md), and 5.1's question.
Its answer goes in an entry in this area's log, which 5.1's section of `02-code-map.md` cites.
Exit: a log entry in this area answers the question.
Done on 2026-10-14.

## 5.2 The sim seam

Question: through what interface do the platform, the features, and the engines reach the sim, so that a stand-in can fill it on the bench, a recording can replay through it, and the IDE can link it; and do features share one SimConnect connection, or hold one each?
5 can't place sim access or the sync engine without it, and [node 7](#7-testing) can't design the bench.
fsc-editor kept the raw events it got from the sim apart from the state it built from them, recorded the raw events, and replayed them through the same code: its replay "swaps the source of events and changes nothing else" (fsc-editor, `src/main/sim/replay.ts`).
FS Copilot's traffic plan gave traffic a SimConnect connection of its own, so "disposing it is a complete cleanup" (FS Copilot fork, `record/traffic-atc/docs/03-implementation-plan.md`), and a client's masks end with its connection ([flight-controls log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)).
It reads the spine's [the core](01-spine.md#the-core) and [the WASM module](01-spine.md#the-wasm-module), the foundations chapters [04-01](../../learn/foundations/04-01-connection-and-data.md) and [05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md), this area's [2026-10-09 flight entry](log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start), and fsc-editor's `src/main/sim/`.
Its answer goes in its own section of `02-code-map.md`.
Exit: the user agrees to that section.
Done on 2026-10-15.

## 5.3 Work in the sim

Question: how does a feature add work to our WASM module, one binary the sim loads when it mounts our package, and to the panel bridge, which loads a module for each instrument a feature or a plugin names; and how does each piece tear itself down when its session ends or the core goes quiet?
5 can't run its first test, deleting a feature's crate, on a feature with code in the sim without it, and the spine leaves each module's teardown to the parts that design the panel bridge and the WASM module ([01-spine](01-spine.md#left-open)).
Anything in the pilot's input path must fail open, so the answer gives every such piece the three things [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) asks for.
It reads the spine's [what moves them](01-spine.md#what-moves-them) and [code in the sim](01-spine.md#code-in-the-sim), 04-room-for-later's [code inside the sim](../product/04-room-for-later.md#code-inside-the-sim), and the FS Copilot fork's `FsCopilot.Bridge.Wasm/wasm_module.cpp` and `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js`.
Its answer goes in its own section of `02-code-map.md`.
Exit: the user agrees to that section.
Raised elsewhere: by 5.2, a SimConnect client hears only the CommBus calls whose sender set the SimConnect flag, and the A220's module sets only JavaScript's, by its code, so reading such an aircraft's bus likely takes panel JavaScript (unverified; [05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md#unverified-claims) says what settles it).
Done on 2026-10-15.

## 5.4 The workspace

Question: where does each unit live in the repository; how does one repository build the Windows programs for x86_64, the WASM module for wasm32 through cargo-msfs, our code in the sim through esbuild at `es2017`, the desktop app's pages through Vite, plugins and write functions for QuickJS-ng, and the backend for its Worker, with the message crate built for both of Rust's targets; and how does CI run the code map's third test?
5 can't give a unit its place, or run that test, without it.
p08 built its module outside its Cargo workspace, with `exclude = ["module"]` (read in `experiments/areas/architecture/flight/Cargo.toml`), so whether the module builds inside one, against the message crate the core also uses, is untried.
It reads the spine's [language and toolchains](01-spine.md#language-and-toolchains) and [frameworks](01-spine.md#frameworks), decisions [018](../../decisions/018-rust-and-typescript.md), [025](../../decisions/025-messages-in-one-rust-crate.md), and [028](../../decisions/028-desktop-pages-react-vite-tailwind.md) to [031](../../decisions/031-coherent-gt-check-tool.md), and the probes [p03](../../../experiments/areas/architecture/p03-rust-module.mjs), [p07](../../../experiments/areas/architecture/p07-types.mjs), and p08's [build.mjs](../../../experiments/areas/architecture/flight/build.mjs).
It may end in a build probe.
Its answer goes in its own section of `02-code-map.md`.
Exit: the user agrees to that section.
Done on 2026-10-15.

## 6 Systems

Question: what is the design of each system the code map names, deep enough that every choice it leaves open stays inside its own units?
Step 8 can't lay out stages for code nobody has designed, and every system is designed before any product code (user, 2026-10-14).
The spine leaves the design of 11 parts to step 8, and more of sync and the session ([parts](01-spine.md#parts)), and files open items under each ([left open](01-spine.md#left-open)).
The design docs written after it leave more: [01-between-machines](../network/01-between-machines.md#left-open)'s checks, the sync engine's rules for checking a write and the bench cases they start from ([01-format-and-delivery](../profiles/01-format-and-delivery.md#checking-a-write)), and 01-format-and-delivery's [left open](../profiles/01-format-and-delivery.md#left-open).
Its children are one for each of [the code map's systems](02-code-map.md#systems), in the order of the platform's rows from the kernel up, then the features, then plugins and the apps, which reach into the features, then installing and updating, and the build (user, 2026-10-15).
No system is designed yet down to its units' interfaces, budgets, and cases for the bench, so a child whose system has design docs checks them against the code map first, and adds a blockquote at the top of each whose text the map changes, naming the section of 02-code-map that changes it.
A child whose system 02-code-map designs in part, as it does 6.1 to 6.3 and 6.18, links to those sections, and its design doc holds only what they leave out.
Each child's answer goes in a design doc in its system's area, which gives its units and their interfaces, its budgets, its cases for the bench, and what it leaves open, as 02-code-map's sections do.
Each child also settles the open items its section names, from the spine's [left open](01-spine.md#left-open), 02-code-map's [left open](02-code-map.md#left-open), and the design docs above.
Exit: every child is done, and every design doc reads as one current text, as [step 8's exit checks](../product/plan.md#8-v1-build-plan) describe, so node 7 reads the designs without their notes (user, 2026-10-17).
Waits on 5, and 6.1 to 6.18.

## 6.1 The core's loop and edge

Question: what are the kernel's interfaces for the loop, the registry, moments, requests and their guards, the outbox, timers, jobs, and each unit's state; and how does the core's edge in `apps/core` stamp each input into the queue, carry out each output and job, write the replay log, and replay a run from it?
Every other system in the core registers with the kernel and reaches the world through the edge, so none can give its units' interfaces before this one.
It reads 02-code-map's [platform's interface](02-code-map.md#the-platforms-interface) and [registry and moments](02-code-map.md#the-registry-and-moments), [5.1.1's entry][5.1.1], [decision 027](../../decisions/027-core-runs-on-tokio.md), and the spine's [the core](01-spine.md#the-core) and [shared conventions](01-spine.md#shared-conventions).
It settles whether a recording replays on a PC with another CPU ([02-code-map](02-code-map.md#left-open)).
Its answer goes in `record/areas/core/01-loop-and-edge.md`.
Exit: the user agrees to that design doc.
Done on 2026-10-15.

## 6.2 Clients and the panel bridge

Question: what are the clients crate's interfaces for each client's socket and first message, client state and commands, settings, notices, lock renewals, and the panel modules each panel loads; how does page-client find the core, open its connection, and connect again; and how does the panel bridge load panel modules and run `ops`?
Every crate above the kernel shows state or takes commands through the clients crate, and every page in the sim reaches the core through page-client.
It reads 6.1's answer, 02-code-map's [modules in the panel bridge](02-code-map.md#modules-in-the-panel-bridge), the spine's [communication](01-spine.md#communication) and [messages between components](01-spine.md#messages-between-components), decisions [008](../../decisions/008-every-link-ends-at-core.md) to [011](../../decisions/011-cockpit-panels-connect-only-in-session.md), [013](../../decisions/013-core-accepts-sim-origin-or-none.md), [014](../../decisions/014-apps-find-core-through-port-file.md), and [016](../../decisions/016-core-keeps-pilots-settings.md), 04-room-for-later's [one protocol for every client](../product/04-room-for-later.md#one-protocol-for-every-client), and the FS Copilot fork's panel code in `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/`.
It settles the spine's open items on the core's WebSocket library, on a component whose version or hash differs from the core's, and on how a client beyond the PC is let in ([01-spine](01-spine.md#left-open)).
Its answer goes in `record/areas/core/02-clients-and-panel-bridge.md`.
Exit: the user agrees to that design doc.
Done on 2026-10-15.

## 6.3 The sim seam and our WASM module

Question: what are the interfaces of the sim service, the sim client, and the sim edge; how does sim awareness make one moment of a load's many signals; how does the routine host carry each want through the sim's APIs and take the session up again after a flight load; and how does the sim service keep the module's counter going quiet during a load from counting as trouble?
Every feature that reaches the sim does it through these units, and the bench's stand-in fills the seam they define ([node 7](#7-testing)).
It reads 6.1's and 6.2's answers, 02-code-map's [sim seam](02-code-map.md#the-sim-seam) and [work in the sim](02-code-map.md#work-in-the-sim), the spine's [sim awareness](01-spine.md#sim-awareness) and [the WASM module](01-spine.md#the-wasm-module), decision [017](../../decisions/017-core-writes-control-slot-every-200ms.md), this area's [2026-10-09 flight entry][flight], the [CommBus log](../commbus/log.md), the [interface log](../interface/log.md), fsc-editor's `src/main/sim/` and `link/`, and the FS Copilot fork's `FsCopilot.Bridge.Wasm/wasm_module.cpp`.
It settles the spine's open items on telling a sim crash from the pilot closing the sim, and on our WASM module after a flight load ([01-spine](01-spine.md#left-open)), and 01-format-and-delivery's on telling which preset loaded ([left open](../profiles/01-format-and-delivery.md#left-open)).
Its answer goes in `record/areas/core/03-sim-seam-and-wasm-module.md`.
Exit: the user agrees to that design doc.
Raised elsewhere: by 5.2, how sim awareness makes one moment of a load's many signals, and whether that logic is an engine of its own (user, 2026-10-15): our client heard `AircraftLoaded` three times and `FlightLoaded` once through one load ([architecture log][flight]), and fsc-editor saw every input event it watched report its value 4.1s to 8.2s before the sim announced the aircraft (measured on MSFS 2024, 2026-08-23, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — An aircraft change snapshots every input event before it announces itself").
Raised elsewhere: by 5.3, which of the sim's APIs carries each want of the routine host ([02-code-map](02-code-map.md#what-a-routine-can-ask-for)).
Raised elsewhere: by 6.2, the sim service sends the core's announcement, a CommBus event named `CROSSCHECK_CORE` whose payload holds the core's port and whether a session runs, every 2s and at once when the session crate asks, as a session starts or ends, since the sim service sits below the session in the code map's units ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#page-client)).
Raised elsewhere: by 6.2, what the core does with our WASM module when the version or hash it leaves in its slot differs from the core's, since its data slots are structs the module reads in place, where 6.2 has the core log a WebSocket client that differs and go on talking to it ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#a-client-whose-version-differs)).
Done on 2026-10-15.

## 6.4 The network

Question: what are the interfaces of the network crate, with its channels, moments, heartbeat, clock offsets, and coming back, and of the transport; how does the backend draw invite codes and match each to the crew's endpoint IDs; where does the relays' configuration live; and what in [01-between-machines](../network/01-between-machines.md) does the code map change?
The session, sync, and every feature that sends between machines reach the other cores through these units.
It reads 01-between-machines, the [network log](../network/log.md), 6.1's and 6.2's answers, decisions [032](../../decisions/032-one-quic-connection-through-iroh.md) to [039](../../decisions/039-cut-link-replays-others-late-join.md), the FS Copilot fork's `record/self-hosted-relay/`, and fsc-editor's `relay/`.
It settles who hosts the relays, and the framework and storage of the Cloudflare Worker that 02-code-map's [workspace](02-code-map.md#the-workspace) puts in `backend/` ([01-spine](01-spine.md#left-open)), and turns 01-between-machines' checks for the network's stage into cases for the bench ([left open](../network/01-between-machines.md#left-open)).
Its answer goes in `record/areas/network/02-units.md`.
Exit: the user agrees to that design doc.
Raised elsewhere: by 5, where the relays' configuration lives, since they run `iroh-relay` with no code of ours ([02-code-map](02-code-map.md#left-open)).
Done on 2026-10-16.

## 6.5 The core helper

Question: how does the core-helper-service crate start the core helper, start it again, and pass it the bindings, captures, and sounds features register; and what does `apps/core-helper` run for Raw Input, audio, and speech, behind which interface?
Control, avatars, and ATC audio reach the pilot's input and speakers only through it.
It reads 6.1's and 6.2's answers, the spine's [the helper](01-spine.md#the-helper), decisions [006](../../decisions/006-core-catches-take-control-input.md), [007](../../decisions/007-core-runs-audio.md), and [019](../../decisions/019-input-and-audio-run-in-helper.md), and this area's [2026-10-08 entry on Raw Input and audio](log.md#2026-10-08-a-rust-program-captures-one-processs-audio-plays-on-a-device-it-looks-up-by-name-and-receives-keyboard-and-hid-input-through-raw-input-in-sink-mode-and-builds-with-visual-studios-linker).
It settles the binary format on the core helper's standard input and output ([01-spine](01-spine.md#left-open)).
Its answer goes in `record/areas/core/04-core-helper.md`.
Exit: the user agrees to that design doc.
Done on 2026-10-16.

## 6.6 Recording and bug reports

Question: what does the recording crate keep beyond the queue, and for how long; how are the replay log and the self-describing record a later version reads encoded; and how does a bug report leave the pilot's PC and reach us through the backend?
The session, the profile loader, the cockpit stream, and plugins ask the recording crate to record, and each machine's recording is how a friend session's data comes back ([node 7](#7-testing)).
It reads 6.1's and 6.4's answers, 03-v1-scope's [recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports), 04-room-for-later's [recording](../product/04-room-for-later.md#recording), [5.1.1's entry][5.1.1], and fsc-editor's `src/main/sim/replay.ts`.
It settles how much of the queue a recording keeps ([02-code-map](02-code-map.md#left-open)).
Its answer goes in `record/areas/recording/01-recording-and-bug-reports.md`.
Exit: the user agrees to that design doc.
Done on 2026-10-16.
Raised elsewhere: by 5.1, how many bytes an hour a recording of every input the core takes in comes to, raw and compressed, since the one loop of [5.1.1's entry][5.1.1] replays a run only from such a recording; the probe [p10](../../../experiments/areas/architecture/p10-recording.mjs), built on 2026-10-14 and parked before it ran, captures a flying machine's inputs from the sim in the 58P for about 10 minutes (user, 2026-10-14).
Raised elsewhere: by 6.1, the edge writes a log of every input from the core's first, in every run, with or without a session, since a replay can't start mid-run, so 6.6 keeps or deletes a run's log whole, and a minimal recording, which [recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports) offers, replays nothing, where the spine's [components with no session](01-spine.md#components-with-no-session) has the core record only in a session ([01-loop-and-edge](../core/01-loop-and-edge.md#what-a-recording-holds)).
Raised elsewhere: by 6.4, where bug reports' files go, since a D1 row holds at most 2 MB and a free database at most 500 MB, and R2 needs a subscription; and whether the self-describing record keeps each connection's path and loss and each sender's clock offset, which the queue holds as the transport's events and the heartbeats ([02-units](../network/02-units.md#the-backend)).

## 6.7 The session

Question: what are the session crate's interfaces for members, session keys, control, the session file, joining and leaving, preflight, the match check, and the version check at join; how do rate and pause, and Go to, work as features; what does the menu script report and run; and what in [01-roles-and-members](../session/01-roles-and-members.md) does the code map change?
Profiles, sync, and most features act on the session's keys and moments.
It reads 01-roles-and-members, 6.3's, 6.4's, and 6.6's answers, 03-v1-scope's [session](../product/03-v1-scope.md#session) and [time, date, sim rate, and pause](../product/03-v1-scope.md#time-date-sim-rate-and-pause), 04-room-for-later's [roles](../product/04-room-for-later.md#roles) and [people beyond the crew](../product/04-room-for-later.md#people-beyond-the-crew), the [environment log](../environment/log.md), and the [interface log](../interface/log.md).
It settles which pilot's bundle a session pins, and where the core reads a streamed Marketplace aircraft's version ([01-format-and-delivery](../profiles/01-format-and-delivery.md#left-open)).
Its answer goes in `record/areas/session/02-units.md`.
Exit: the user agrees to that design doc.
Done on 2026-10-16.
Raised elsewhere: by 6.1, the session crate decides when the core exits, by the spine's rule, and runs a quit, from the desktop app, the watcher's tray, or Windows ending the pilot's session, as a Leave before the exit, within 3s of Windows' `WM_QUERYENDSESSION`; it registers the source through which the core hears Windows end the session ([01-loop-and-edge](../core/01-loop-and-edge.md#quitting)).
Raised elsewhere: by 6.3, the session crate calls `sim_service::announce(cx, session)` as a session starts or ends; it takes the run of the sim for the session file, and whether the last run ended as a quit or a crash for the crew's notice, from sim awareness's state; and the menu script reports its master page and page to the sim service for sim awareness ([03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md#sim-awareness)).
Raised elsewhere: by 6.4, the network checks the version at join, at the backend and in each first message, and the session crate shows the backend's refusal; the session crate registers the session channel as each connection's opener, sends its keys whole on every `LinkUp`, counts a member out on `MemberLeft` and `MemberOut`, asks `Host`, `Join`, `Open`, `Dial`, and `Leave`, writes the session file between `BackendAnswered` and `Open`, with the endpoint key, the relay list and its tokens, and the crew's endpoint IDs, and hands control over before a PF's `Leave` ([02-units](../network/02-units.md#requests-the-session-crate-makes)).
Raised elsewhere: by 6.6, the session crate tells the recording crate when a session starts, with its ID and its endpoint key; when a member joins, with their display name; when preflight ends, with the aircraft and the departure airport from the flight file's `[Departure]` section; and when the session ends; and the backend marks a member who leaves as left, keeping their row for 30 days so their upload is taken ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#the-index)).

## 6.8 Profiles

Question: what are the profile engine's, the profile loader's, and the profile builder's interfaces; how does the loader fetch a bundle, cache it, and load it on the pilot's aircraft; and what in [01-format-and-delivery](../profiles/01-format-and-delivery.md) does the code map change?
Sync, pointer sync, avatars, and plugins act on what a loaded profile gives them.
It reads 01-format-and-delivery, 6.3's and 6.7's answers, 02-code-map's [profiles in this repository](02-code-map.md#profiles-in-this-repository), decisions [021](../../decisions/021-profiles-and-plugins-apart-from-releases.md), [045](../../decisions/045-profile-format-yaml-and-javascript.md), and [046](../../decisions/046-sandbox-runtimes-and-limits.md), and FS Copilot's profiles in `../fsc/profiles/`.
It settles which compiler the core embeds to build a local bundle's plugin ([left open](../profiles/01-format-and-delivery.md#left-open)).
Its answer goes in `record/areas/profiles/02-units.md`.
Exit: the user agrees to that design doc.
Done on 2026-10-16.
Raised elsewhere: by 5.4, whether CI holds a released level's builder output to its release tag as it holds the level's schema and declarations ([02-code-map](02-code-map.md#left-open)).
Raised elsewhere: by 6.7, the profile loader on the PF's core writes the pinned bundle's hash as a `Pf` session key of its own, the newest its cache holds for the session's aircraft, whenever that aircraft changes before preflight ends, and every other loader loads it by hash; the loader registers the match check's item for the bundle each core loaded, "unpublished" for a local one, and "No profile for this aircraft" as an error when none is published, in which case the session flies without one ([the session's units](../session/02-units.md#which-bundle-a-session-pins)).

## 6.9 Sync

Question: what are the cockpit stream's, the sync engine's, and state sync's interfaces; how does the sync engine check a write, tell its own echo from a pilot's change, retry, follow a moving knob, and run write functions; and what in the sync design docs, [01-profile-entries](../sync/01-profile-entries.md) to [04-order-and-recovery](../sync/04-order-and-recovery.md), does the code map change?
Pointer sync, avatars, and plugins send on the cockpit stream, and state sync carries most of what a crew shares.
It reads the four sync docs and the [sync log](../sync/log.md), 6.4's, 6.7's, and 6.8's answers, 01-format-and-delivery's [checking a write](../profiles/01-format-and-delivery.md#checking-a-write), and decisions [039](../../decisions/039-cut-link-replays-others-late-join.md) to [043](../../decisions/043-driven-entries-and-putting-back.md).
It settles whether the profile engine fires `H:` events through SimConnect's client events or through calculator code ([01-spine](01-spine.md#left-open)), whether the legacy transmit call reaches every aircraft's handlers ([01-format-and-delivery](../profiles/01-format-and-delivery.md#left-open)), and what [02-live-sync](../sync/02-live-sync.md#open-questions)'s and [03-catch-up](../sync/03-catch-up.md#open-questions)'s open questions still hold, each as a case for the bench where it turns on frame timing.
Its answer goes in `record/areas/sync/05-units.md`.
Exit: the user agrees to that design doc.
Done on 2026-10-16.
Raised elsewhere: by 6.2, which panel listens for `H:` events, and how, since [decision 011](../../decisions/011-cockpit-panels-connect-only-in-session.md) keeps one panel for them, as a panel module whose rule picks that panel ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#cockpit-panels-and-their-modules)).
Raised elsewhere: by 6.3, SDK 1.7.3 has `fsEventsRegisterHEvent`, which takes an `H:` event's name, and `fsEventsHEventCall`, so our module can fire an `H:` event by name without calculator code, for the item on how the profile engine fires them ([03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md#wants-and-the-sims-apis)).
Raised elsewhere: by 6.4, the cockpit-stream crate sends its vector clock once a second on a one-off channel of its own, not on the heartbeat, and sends what a member lacks on every `LinkUp` with `again`, which a link moved onto a second connection raises again, and which a restarted core's link never carries ([02-units](../network/02-units.md#links)).
Raised elsewhere: by 6.6, state sync marks the recording, through `cx.recording().mark`, when a write never lands, with the entry, both machines' values, and the retries, and when a watch-only entry's values differ between machines; and the cockpit stream, state sync, and the sync engine stay whole in the recording, so a replay checks them ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#marks)).
Raised elsewhere: by 6.7, the cockpit stream carries a change of control's vector clock as a message of its own kind, sent on `ControlPassed` by the core that made the change, since the session crate can't read the clock; it registers its guard on `TakeControl`; it starts a late joiner's catch-up on `FlightChanged`, and a following machine's catch-up at preflight's end on `PreflightEnded`, which a member the crew went without raises when it comes back; state sync guards the session crate's `Ready` until the aircraft has settled; and catch-up writes switch positions and can't start an engine, so a joiner gets running engines from a runway start, which Go to picks while the PF's engines run ([the session's units](../session/02-units.md)).

## 6.10 Flight-model sync

Question: how does the flight-model feature carry the flying machine's pose and velocities to the following machines, from the samples the core reads and sends to the `Follow` routine that writes them each frame, and on which clock is each sample stamped?
A following machine flies only by the flight-model feature's writes, and the PF's yoke, rudder, and toe brakes travel in that feature's samples rather than in the cockpit stream ([02-live-sync](../sync/02-live-sync.md)).
It reads 03-v1-scope's [flight-model sync](../product/03-v1-scope.md#flight-model-sync), the [flight-model log](../flight-model/log.md), 6.3's, 6.4's, and 6.7's answers, the spine's [times](01-spine.md#times), and decisions [005](../../decisions/005-wasm-module-writes-following-aircraft.md), [024](../../decisions/024-times-in-microseconds-on-monotonic-clock.md), and [038](../../decisions/038-clock-offset-from-timed-exchange.md).
It settles the spine's open items under flight-model sync, on the module's clock and on how far the core's arrival stamp trails the sim's read ([01-spine](01-spine.md#left-open)).
Its answer goes in `record/areas/flight-model/01-flight-model-sync.md`.
Exit: the user agrees to that design doc.
Done on 2026-10-17.
Raised elsewhere: by 6.4, each sender's clock offset sits in the network's state by pilot ID and restart count, and the flight model's channel handler, not the network, drops a sample made under an older control value ([02-units](../network/02-units.md#channels-and-sends)).
Raised elsewhere: by 6.6, flight-model sync registers as partly recorded and declares its pose read every frame and its samples' channel unrecorded: it runs in a replay on what was recorded, unchecked, and may register no guard, catch-up step, or cockpit kind, or make a request the platform decides ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#unrecorded-inputs)).
Raised elsewhere: by 6.7, a following machine follows only while its pilot is in the flight, as `FlightChanged` tells, and in preflight its aircraft is frozen by both `Follow` and the session crate's `Hold`; a joiner of a PF whose engines run loads on a runway, so flight-model sync moves it from that runway to the PF, airborne or not ([the session's units](../session/02-units.md#go-to)).

## 6.11 Pointer sync

Question: how does a press on a display or a panel reach the other cockpits and play there, through the panel bridge, the cockpit stream, the EFB app, and the desktop app; and on which clock does the panel bridge measure a span?
It's v1's one feature with a panel module ([02-code-map](02-code-map.md#features)), so it's the first to load one through 6.2's panel bridge.
It reads 03-v1-scope's [pointer sync](../product/03-v1-scope.md#pointer-sync), 6.2's and 6.9's answers, 01-format-and-delivery's [displays](../profiles/01-format-and-delivery.md#displays), and the FS Copilot fork's `record/pointer-forwarding/` and `record/wasm-pointer/`.
It settles the spine's open item on which clock the panel bridge measures a span on ([01-spine](01-spine.md#left-open)).
Its answer goes in `record/areas/pointer-sync/01-pointer-sync.md`.
Exit: the user agrees to that design doc.
Done on 2026-10-17.
Raised elsewhere: by 6.9, state sync has a panel module too, `h-events`, so pointer sync isn't v1's one feature with a panel module; pointer sync's press kind answers `Unfinished(handle)` until its panel has played the press through to its release, then calls `cx.cockpit().applied(handle)`, and `Skipped` while the cockpit stream's catch-up runs or for a display whose panel hasn't announced itself, reading the stream's state ([the sync units](../sync/05-units.md#kinds)).
Raised elsewhere: by 6.10, no v1 unit waits on how far the core's arrival stamp trails a page's read, since a page that times something sends a span, as pointer sync's presses do, so pointer sync times nothing by a press's arrival ([flight-model sync](../flight-model/01-flight-model-sync.md#the-cores-counter-in-our-module)).

## 6.12 Control

Question: how do the take-control key and buttons reach the session's control, from the core helper's captures to the request the session guards, and what marks a pass?
The PF is the session's first role, and the take-control key is how it moves ([01-roles-and-members](../session/01-roles-and-members.md#the-pf)).
It reads 03-v1-scope's [take-control key](../product/03-v1-scope.md#take-control-key), 6.5's and 6.7's answers, and decisions [006](../../decisions/006-core-catches-take-control-input.md) and [036](../../decisions/036-control-is-one-value.md).
The voice phrases left v1 for Soon on 2026-10-17 (user), so the spine's open item on telling speech from noise goes to that pick, and the [control log](../control/log.md) holds the research it starts from.
Its answer goes in `record/areas/control/01-take-control.md`.
Exit: the user agrees to that design doc.
Done on 2026-10-17.
Raised elsewhere: by 6.5, take-control registers its binding by its setting's key and gets each press and release with the helper's stamp, so it times a long press itself; the next press crosses while the desktop app binds the key, named for showing; voice registers its phrases and gets each heard phrase's index with when it began and ended; the detector and the recognizer fill one trait inside `apps/core-helper`, so the microphone's audio never leaves the helper, and they hear nothing while a sound of ours plays; and the cues and recorded lines are Ogg Opus files in each feature's crate ([04-core-helper](../core/04-core-helper.md#what-a-feature-registers-and-calls)).
Raised elsewhere: by 6.7, the take-control key and button and the voice handover's answer each ask the session crate's `TakeControl`, built as this pilot taking control now, whose verdict the apps show, and the cues play on `ControlPassed` ([the session's units](../session/02-units.md#control)).

## 6.13 Avatars

Question: how does the avatars feature seat each pilot's figure and bring its hand to what they click, from the click through the ray the aircraft model casts to the `Figure` routine that poses it; and which of [avatars' tentative decisions](../avatars/decisions.md) does its design confirm?
It's the one feature that reads an aircraft's own models, so its design also designs the aircraft-model engine ([02-code-map](02-code-map.md#systems)).
It reads avatars' tentative decisions and the [avatars log](../avatars/log.md), 03-v1-scope's [avatar sync](../product/03-v1-scope.md#avatar-sync), 01-format-and-delivery's [seats](../profiles/01-format-and-delivery.md#seats), 6.3's, 6.5's, 6.8's, and 6.9's answers, and [decision 004](../../decisions/004-core-works-out-figures-hand.md).
Its answer goes in `record/areas/avatars/01-avatars.md`.
Exit: the user agrees to that design doc.
Done on 2026-10-17.
Raised elsewhere: by 6.3, the figure's SimObject title, `CROSSCHECK_Figure`, takes a kind, as [names the sim shares](02-code-map.md#names-the-sim-shares) requires.
Raised elsewhere: by 6.5, avatars turns the mouse on with the sim's process ID, read from sim awareness, and gets the left and right buttons' presses and releases and at most one move every 16ms while the left is held, each with the cursor's place in the sim's main window and the window's size, only while that window itself is in front, so a click in a popped-out display crosses nothing ([04-core-helper](../core/04-core-helper.md#raw-input)).
Raised elsewhere: by 6.6, avatars registers as partly recorded and declares its camera read every frame, its `Frame` events, its poses' channel, and its job that reads an aircraft's models unrecorded, while the figure's create answer and the core helper's clicks stay recorded; it may register no guard, catch-up step, or cockpit kind, and turns the mouse want on or off only on a recorded input ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#unrecorded-inputs)).
Raised elsewhere: by 6.10, a routine's `Frame::now` is the routine host's estimate of the core's counter, so `Figure` can draw another pilot's poses, stamped on that pilot's counter and moved onto this core's by the network's offset, without the core estimating the module's clock; and a routine can report a struct to its feature through a report slot ([flight-model sync](../flight-model/01-flight-model-sync.md#what-this-adds-to-our-wasm-module)).
Raised elsewhere: by [avatar sync](../product/03-v1-scope.md#avatar-sync)'s note of 2026-10-17, the other machine places a hand holding the yoke on its own yoke, finding the grip there from its own copy of the models or from what the clicking machine sends, since a following machine draws its yoke 0.4s behind ([avatars' tentative decisions](../avatars/decisions.md#the-clicking-pilots-machine-finds-the-point-and-the-other-machine-only-draws-it)); and avatars reads the network's check that this PC reaches the internet, which [01-between-machines](../network/01-between-machines.md#while-a-link-is-lost) uses only to inform the pilots, to choose between a slumped figure and one at rest (user, 2026-10-17).
Raised elsewhere: by the same note, the seat tool and the click tool, which write the 58P's `seats` and `location` values, have no unit in the code map's [tools](02-code-map.md#apps-the-sim-package-and-tools); and two checks in the sim wait for this design: whether the figure's hands fade through the material animation that colors it, which a see-through dropped figure would use too, and whether a click through a pilot's own figure, which draws inside the aircraft, still reaches the control behind it.
Raised elsewhere: by 6.11, pointer sync sends each gesture as it happens, so the other machine's display moves with the hand avatars draws there; and a press blocked while another pilot's gesture plays on a display flashes with no words, which counts on that pilot's figure at the display to say who's pressing ([pointer sync](../pointer-sync/01-pointer-sync.md#locks)).

## 6.14 Traffic and ATC

Question: how does the traffic host's traffic reach the other machines as AI objects, and its ATC as audio, under the traffic host's and the ATC host's roles, which one switch claims together ([02-code-map](02-code-map.md#the-traffic-and-atc-switch))?
Traffic and ATC audio each hold a role of their own, and traffic creates AI objects on a SimConnect connection of its own ([02-code-map](02-code-map.md#a-connection-for-each-feature-for-each-load)).
It reads 03-v1-scope's [traffic sync](../product/03-v1-scope.md#traffic-sync) and [hearing ATC](../product/03-v1-scope.md#hearing-atc), 01-roles-and-members' [traffic and ATC host](../session/01-roles-and-members.md#the-traffic-and-atc-host), 6.3's, 6.4's, 6.5's, and 6.7's answers, and the FS Copilot fork's `record/traffic-atc/`.
Its answer goes in `record/areas/traffic-atc/01-traffic-and-atc.md`.
Exit: the user agrees to that design doc.
Raised elsewhere: by 6.4, ATC audio's channel takes `Deadline` delivery, each frame dropped once its turn to play has passed, and traffic sends its identities whole on every `LinkUp` ([02-units](../network/02-units.md#moments)).
Raised elsewhere: by 6.5, ATC audio registers a capture by program name with its bitrate, gate level, and hangover, and gets 20ms Opus frames, each stamped at its first sample, only above the gate; it opens a playback stream with its buffer's rule and hands it frames by number; the helper lists the programs that own an audio session, for picking the ATC app; and FS Copilot's 24 kbps, −50dBFS gate, and 300ms hangover are the starting values ([04-core-helper](../core/04-core-helper.md#capturing-a-program)).
Raised elsewhere: by 6.6, traffic and ATC audio register as partly recorded and declare traffic's polls, its `Frame` events, and its states' channel, and ATC audio's capture and its frames' channel, unrecorded, while traffic's identities and its creates' answers stay recorded; both may register no guard, catch-up step, or cockpit kind, and ATC audio turns its capture on or off only on a recorded input; and traffic's poll is a call to add to 6.3's sim calls, for `SimConnect_RequestDataOnSimObjectType` ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#unrecorded-inputs)).
Raised elsewhere: by 6.7, traffic's and ATC audio's role keys are `Anyone` session keys whose values name a member, written through `WriteKeys`, and traffic registers the match check's items for traffic packs, running injectors, and multiplayer with `match_item` ([the session's units](../session/02-units.md#the-match-check)).

## 6.15 Plugins

Question: which of the platform's hooks and moments, `ops`' operations, and the routine host's wants do plugins reach through QuickJS-ng, and how does the plugins crate run a plugin under the sandbox's limits?
The Baron 58P's plugin is v1's first, and its profile settles what the plugin needs ([01-spine](01-spine.md#left-open)).
It reads 03-v1-scope's [plugins](../product/03-v1-scope.md#plugins), 04-room-for-later's [plugins](../product/04-room-for-later.md#plugins) and [code inside the sim](../product/04-room-for-later.md#code-inside-the-sim), 01-format-and-delivery's [plugins](../profiles/01-format-and-delivery.md#plugins) and [deferred](../profiles/01-format-and-delivery.md#deferred), decisions [020](../../decisions/020-plugin-code-runs-only-in-core.md) and [046](../../decisions/046-sandbox-runtimes-and-limits.md), 6.2's answer for `ops`, 6.3's for the routine host's wants, 6.6's, and the answers of 6.8 to 6.14.
It settles the spine's open item on which APIs the panel bridge and our WASM module offer plugins ([01-spine](01-spine.md#left-open)), whether the 58P's plugin needs any of 01-format-and-delivery's deferred APIs, and whether QuickJS-ng's hash seed changes anything a script sees ([02-code-map](02-code-map.md#left-open)).
Its answer goes in `record/areas/plugins/01-plugins.md`.
Exit: the user agrees to that design doc.
Raised elsewhere: by 5.1, which of the platform's hooks and moments plugins reach through QuickJS-ng, and whether a plugin needs a moment only a feature could raise, which 5.1 gives no feature, once the features they may plug into are designed (user, 2026-10-14).
Raised elsewhere: by 5.3, which operations the panel bridge's `ops` module offers plugins, and how a plugin's API names the panels those operations reach, since the core loads `ops` only into panels named when the profile loads ([02-code-map](02-code-map.md#modules-in-the-panel-bridge)).
Raised elsewhere: by 6.4, how a plugin's channel instance gets its number and announces it on the session channel, since every other channel is a constant in the message crate, and a receiver drops a channel no unit registered ([02-units](../network/02-units.md#channels-and-sends)).
Raised elsewhere: by 6.6, plugins stay whole in the recording, so a replay checks them, and whether plugin tests, a Later pick, need a plugin's exported values marked in the recording is this design's ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#left-open)).
Raised elsewhere: by 6.9, state sync reads a plugin's values as entries and calls its write methods through the plugins crate; how a plugin's own `write()` reaches the sync engine, so its echoes are known; how state sync hears that a plugin was turned off, to stop its entries; and the form of a plugin's value that's neither a number nor text, since an entry's value is one of those two ([the sync units](../sync/05-units.md#left-open)).
Raised elsewhere: by 6.14, traffic's gate and playout are an engine, `object-mirror`, generic over the sample, so a plugin's object mirroring, such as GSX's vehicles, runs the same ones; how that mirroring draws in the sim, since a plugin ships no routine, and how a plugin claims objects so traffic skips them, since traffic's list of what it skips reads no other unit ([traffic and ATC](../traffic-atc/01-traffic-and-atc.md#the-object-mirror-engine)).

## 6.16 The apps

Question: what are the EFB app's and the desktop app's shells, the API their sections use, and the banner; how does a feature's section plug in and come out; and what counts as trouble for each component, and where does the pilot see it?
Each feature shows itself to the pilot through its sections in these apps, so deleting a feature deletes its section in each ([tiers](02-code-map.md#tiers)).
It reads 03-v1-scope's [EFB app](../product/03-v1-scope.md#efb-app) and [notification banner](../product/03-v1-scope.md#notification-banner), 02-code-map's [platform](02-code-map.md#the-platform), the spine's [the desktop app](01-spine.md#the-desktop-app) and [frameworks](01-spine.md#frameworks), decisions [012](../../decisions/012-efb-app-opens-banner-panel.md) and [028](../../decisions/028-desktop-pages-react-vite-tailwind.md) to [030](../../decisions/030-in-sim-code-es2017-esbuild.md), the [interface log](../interface/log.md), 01-between-machines' [left open](../network/01-between-machines.md#left-open), and the answers of 6.2 to 6.7 and 6.10 to 6.14.
It settles the spine's open items under the apps ([01-spine](01-spine.md#left-open)), and how the status list looks ([01-between-machines](../network/01-between-machines.md#left-open)).
Its answer goes in `record/areas/interface/01-apps.md`.
Exit: the user agrees to that design doc.
Raised elsewhere: by 6.1, whether the desktop app offers a way to quit Crosscheck, which the core runs as a Leave before it exits ([01-loop-and-edge](../core/01-loop-and-edge.md#quitting)).
Raised elsewhere: by 6.2, where each notice shows, by its level; which slices each app's frame shows; what the apps tell the pilot after a `bye` and after a socket that closed without one; whether a component whose version differs counts as trouble; and the WebSocket client in the desktop app's Rust side, which sends no `Origin` ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md)).
Raised elsewhere: by 6.3, how the pilot sees a WASM module that's missing, differs, or stopped, and which of sim awareness's state the apps show ([03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md#the-modules-status)).
Raised elsewhere: by 6.4, the network's slice of client state for the status list: each member's link and path, and whether this PC reaches the internet ([02-units](../network/02-units.md#what-the-pilot-sees-and-settings)).
Raised elsewhere: by 6.5, the output device and microphone settings, each Windows' default or a device the pilot picks; the slice listing devices and programs that own an audio session; and the notices for a core helper that's down, a want it can't carry out, and a picked device that's missing ([04-core-helper](../core/04-core-helper.md#the-devices)).
Raised elsewhere: by 6.6, the report page lists the recorded sessions from each run's index and uploads one; the desktop app lists the recordings with each one's size and a way to delete it (user, 2026-10-16); the EFB app's button that marks the moment sends the recording crate's command; and the notices offering a missing pilot's part, and refusing a file too large to upload ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#a-bug-report)).
Raised elsewhere: by 6.7, where and how Crosscheck asks for the display name before a first Host or Join (user, 2026-10-16); rate and pause's part in the EFB app, code with no screen that calls `TOOLBAR_SET_ACTIVE_PAUSE`; Go to's section in the desktop app; the notices for a pilot out of the flight, a PF in the pause menu, and the backend's refusal; and the match check's wording, a streamed copy's warning among it ([the session's units](../session/02-units.md)).
Raised elsewhere: by 6.8, the profile loader's local folder setting, and the match check's profile item, whose values are a published hash, a local one shown as "unpublished", "No profile for this aircraft", and "Couldn't get the session's profile"; the apps show no profile's build report, since the core builds nothing ([the profiles' units](../profiles/02-units.md#the-match-checks-item)).
Raised elsewhere: by 6.9, the cockpit stream's slice of whether a catch-up or a replay runs, for the banner; the wording of state sync's reason on its guard of Ready; state sync's notice, once per entry for each load, for a write that never landed, an entry the driven-entry test stopped, and an entry a write function's limit stopped; and the PF's checklist, each counting entry's `name` and `default`, a slice of state sync's while preflight runs ([the sync units](../sync/05-units.md#ready-notices-marks-and-the-checklist)).
Raised elsewhere: by 6.11, the look and words of pointer sync's visible lock, which says whether the machine has no link up to the PF, naming taking control as the way out, or is catching up; the flash of a press blocked while another pilot's gesture plays, one solid color with no words, red-orange at about 60% opacity as a start, which the build settles (user, 2026-10-17); and pointer sync has no section in the EFB app or the desktop app ([locks](../pointer-sync/01-pointer-sync.md#locks)).
Raised elsewhere: by 6.12, take-control's slice of the verdict with each denial's reason, the warning while the link to the PF is lost, and the binding's name and whether it takes a long press; its button in the EFB app and the desktop app, which show that warning before a press; the desktop app's section with Bind, Cancel, Clear, the long-press setting, and the line asking the pilot to keep the input unbound in the sim; and the words of the refusal notice, the warning, "You have control", and "Adam has control" ([take-control](../control/01-take-control.md)).
Raised elsewhere: by 6.13, avatars has no section in the EFB app or the desktop app; its settings are the figure's color, a palette index, "Show my figure", and "Show the crew's figures", both on at first; and its notices name the free seats while this pilot's camera is in another figure's seat, and tell a pilot whose machine can't read the aircraft's models that their clicks bring no hand ([avatars](../avatars/01-avatars.md#the-figures-this-machine-draws)).
Raised elsewhere: by 6.14, traffic's slice of this machine's traffic packs, which a page asks for with `LIST_PACKS`, and whose look, and whether it shows the crew's lists beside this machine's, are the user's (user, 2026-10-17); the words of traffic's two notices, on aircraft that aren't the traffic host's and on copies missing or shown as stand-ins; ATC audio's slice of the program it captures, or that it's waiting for one, or that the Windows mixer mutes it; and the settings for traffic's radius, the ATC app, Automatic or a program from the core helper's list, and the ATC volume ([traffic and ATC](../traffic-atc/01-traffic-and-atc.md#settings)).

## 6.17 Installing and updating

Question: how does a pilot install Crosscheck and get its updates, what does the watcher do between runs of the sim, and where does the installer live?
Every program and the sim package reach the pilot's PC through it.
It reads 03-v1-scope's [installing and updating](../product/03-v1-scope.md#installing-and-updating), the spine's [the watcher](01-spine.md#the-watcher), decisions [002](../../decisions/002-core-starts-with-every-sim-run.md), [003](../../decisions/003-watcher-keeps-blurpage-copy-current.md), and [015](../../decisions/015-watcher-reads-files-core-writes.md), and 6.16's answer.
Its answer goes in `record/areas/install/01-installing-and-updating.md`.
Exit: the user agrees to that design doc.
Raised elsewhere: by 5, where the installer lives, and whether it's a program of ours ([02-code-map](02-code-map.md#left-open)).
Raised elsewhere: by 6.1, the watcher starts the core again only when it exits with a code other than 0, since every deliberate exit returns 0 and a panic's abort never does; and how the watcher's tray asks the core to quit ([01-loop-and-edge](../core/01-loop-and-edge.md#exiting)).
Raised elsewhere: by 6.3, the core finds the sim's process by the name `FlightSimulator2024.exe`, which our Steam edition's runs gave, and which a pilot's crash report gave the Microsoft Store edition (unverified), as the watcher noticing the sim's start can ([03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md#the-sims-process)).
Raised elsewhere: by 6.4, the installer's Windows Firewall rule for the core's path, and which program checks for it, comparing paths without regard to letter case, which [the way through home routers](../network/01-between-machines.md#the-way-through-home-routers) gives to the installer and the core.
Raised elsewhere: by 6.5, the core starts `crosscheck-core-helper.exe` from its own folder, so the installer puts the two side by side ([04-core-helper](../core/04-core-helper.md#the-helpers-life)).
Raised elsewhere: by 6.7, the session file is JSON in the core's data folder, and the watcher holds updates back while it exists ([the session's units](../session/02-units.md#the-session-file)).
Raised elsewhere: by 6.13, our Community package carries the figure's SimObject, `CROSSCHECK_FIGURE_PILOT`, and Crosscheck's empty avatar, whose build avatars' stage of the build settles in the sim ([avatars](../avatars/01-avatars.md#left-open)).

## 6.18 The build

Question: how is the Coherent GT check's tool built, how does the build hash the message crate, and how does CI release every target, beyond what 02-code-map's [workspace](02-code-map.md#the-workspace) gives for `tools/build.ts`, `tools/setup.ts`, the map check, and the check on ts-rs's files?
Every stage of [node 8](#8-the-build-order) is built and checked by it.
It reads 02-code-map's workspace, 6.8's answer for the profile builder, 6.17's for what a release delivers, the spine's [compiling our code in the sim](01-spine.md#compiling-our-code-in-the-sim) and [the check](01-spine.md#the-check), decisions [025](../../decisions/025-messages-in-one-rust-crate.md), [026](../../decisions/026-first-message-carries-version-and-hash.md), [030](../../decisions/030-in-sim-code-es2017-esbuild.md), and [031](../../decisions/031-coherent-gt-check-tool.md), and this area's [Coherent GT reference](coherent-gt.md).
It settles the spine's open items under the build, except the check on ts-rs's files, which 02-code-map settles, and the stand-in, which [node 7](#7-testing) takes ([01-spine](01-spine.md#left-open)).
Its answer goes in `record/areas/build/01-the-build.md`.
Exit: the user agrees to that design doc.
Raised elsewhere: by 5.4, what the build does when cargo-msfs, which installs only the newest SDK, has installed one newer than a release's, and how long CI takes on Windows runners, against [5.4's budget](02-code-map.md#budgets-for-the-workspace) ([02-code-map](02-code-map.md#left-open)).
Raised elsewhere: by 6.1, how the core links the C runtime statically, since `+crt-static` is a target's feature rather than a crate's and 5.4 sets no `RUSTFLAGS`, and whether the watcher, the core helper, and the desktop app link it statically too; and the map check's search of `features/` for `impl Moment`, and its allowance for the one foreign function `apps/core` declares ([01-loop-and-edge](../core/01-loop-and-edge.md#the-cores-math)).
Raised elsewhere: by 6.2, how the build gets the sim's stock `VCockpit.js` after each sim update, since the sim streams it rather than keeping it on disk, to put our two blocks into at their anchors ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#our-vcockpitjs)).
Raised elsewhere: by 6.4, the network crate compiles each release's default relay list from `relays/relays.toml`, and CI runs the backend's tests against a local D1 ([02-units](../network/02-units.md#the-relays)).
Raised elsewhere: by 6.8, the profile builder program's name and how authors get it; its `typescript.js`, TypeScript 6.0.3, pinned in the builder; CI's profiles job, which runs on each merge that changes `profiles/` or either profile engine and on each release, reads which levels are released from the release tags, and commits to a `pages` branch holding `.nojekyll` that never loses a file; and that the core builds no bundle, so CI's reason for Windows runners of building bundles as the core does falls away ([the profiles' units](../profiles/02-units.md#publishing)).
Raised elsewhere: by 6.9, state sync's routine crate, `HEvents`, goes in the module's list, and its panel module, `h-events`, builds into `/Crosscheck/modules/`; the module's bindgen reads `MSFS_Events.h` for `fsEventsRegisterHEvent` and `fsEventsHEventCall` ([the sync units](../sync/05-units.md#h-events)).
Raised elsewhere: by 6.10, flight-model sync's routine crate `Lead` joins the module's list beside `Follow`, and the module creates its report slot, `CROSSCHECK_REPORT_LEAD` ([flight-model sync](../flight-model/01-flight-model-sync.md#what-this-adds-to-our-wasm-module)).
Raised elsewhere: by 6.13, the figure's SimObject in `features/avatars/figure/` compiles with the SDK's `fspackagetool`, which our probes ran only with the sim closed, and which failed while a crashed sim's process lingered ([avatars log](../avatars/log.md#2026-10-03-a-skinned-stick-took-the-sim-down-in-an-in-sim-build-and-a-crashed-sim-held-fspackagetool-until-it-was-closed)), so whether CI's Windows runners can build it with no sim installed, or a developer builds it and the repository keeps the result, is the build's; and `tools/profile-author` builds with the other tools ([avatars](../avatars/01-avatars.md#the-units)).
Raised elsewhere: by 6.14, traffic's routine `Traffic`, in `traffic-routines`, joins the module's list, and `object-mirror` builds for wasm32 and x86_64 ([traffic and ATC](../traffic-atc/01-traffic-and-atc.md#the-units)).

## 7 Testing

Question: how is each unit tested: without the sim; on a bench of two cores on one PC, where a stand-in plays the second pilot's sim; in the sim; and on two PCs with friends; and how is each unit's budget measured?
Step 8 can't order the stages without knowing what proves each one done.
Tests that need two sims run on two PCs with friends (user, 2026-10-14), so a friend session checks many things at once, comes rarely, and needs no video call, since each machine's recording brings its data back.
Two rules come from our earlier benches:

- No development mode skips the real path.
  FS Copilot's `--dev` "builds no Coordinator and no network", so "The wire, the acks, the resend history and the session state machine never run" in it (FS Copilot fork, `record/exerciser/docs/01-design.md`, "Session: the exerciser is a peer").
- A bench drives the product only through the sim seam and pinned builds, never through its internals.
  FS Copilot's bench drove whatever its checkout had compiled last, and "a stale build is a working build, and it cost two sessions" (FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-19 — The exerciser leaves the tree, and takes four compile-time couplings with it").

A bench also forces each network path, as [two cores on one PC](../network/01-between-machines.md#two-cores-on-one-pc) requires.
It reads 5.2's and 5.3's answers, the cases for the bench that 6's children name, the [bench cases for checking a write](../profiles/01-format-and-delivery.md#checking-a-write), and the FS Copilot fork's `record/pointer-forwarding/docs/14-test-bench.md` and `record/exerciser/docs/01-design.md`.
Its answer goes in a design doc in the build area, `record/areas/build/02-testing.md`, beside 6.18's design of the build, since the spine gives the test bench to the build ([parts](01-spine.md#parts)).
Exit: the user agrees to that design doc.
Waits on 5 and 6.
Raised elsewhere: by 5, the bench lives in `tools/`, and the stand-in sim is an engine, which depends on no platform or feature code; whether the stand-in keeps the loop's rules, and where the list of routines lives if the bench runs them natively, since the bench can't link `sim-package/wasm-module/`, a cdylib alone ([02-code-map](02-code-map.md#left-open)).
Raised elsewhere: by 5.1, whether one loop keeps its queue under one sim frame at p99 with a busy core's load, write functions in QuickJS-ng and a plugin call held to its 100ms limit among it, and replays its own recording to the same outputs, as a budget the bench measures; p10's [loop](../../../experiments/areas/architecture/recording/loop/src/main.rs), built on 2026-10-14 and parked before it ran, runs that load offline on a capture or made-up inputs (user, 2026-10-14).
Raised elsewhere: by 6.4, the bench's local `iroh-relay` binds `127.0.0.1`, since in dev mode it answered on IPv6 loopback only, and whether it answers there is untried; a TCP proxy in front of it stands in for a relay's loss and cuts; the bench's cores reach a local backend through a development setting; and v1's full mix on a direct path under loss runs by hand on our droplets, in a program built on the network crate and the transport ([02-units](../network/02-units.md#cases-for-the-bench)).
Raised elsewhere: by 6.5, a development setting naming the program the core starts as its helper, so the bench can run a stand-in that scripts presses and frames, and whether that keeps to the rule that no development mode skips the real path; and a check of opus-rs on recorded ATC speech at 5% loss ([04-core-helper](../core/04-core-helper.md#cases-for-the-bench)).
Raised elsewhere: by 6.6, a replay checks only whole units, so the bench's replays of a session check the platform, state sync, pointer sync, take-control, voice, rate and pause, and Go to, and its runs with the setting that records everything check every unit; and v1's friend sessions measure a following machine's recording ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#cases-for-the-bench)).

## 8 The build order

Question: which stages build v1, in what order, each with what it builds, what it needs first, its tests, and an exit you can watch happen?
It's step 8's last output, and where the stages and their status live is this node's to decide, since a plan is the one place status lives ([writing.md](../../../.claude/rules/writing.md#design-plan-and-log)).
It reads 6's and 7's answers.
Its answer goes in the plan or plans it chooses, which hold v1's build stages.
Exit: the user agrees to those plans.
Waits on 6 and 7.

[5.1.1]: log.md#2026-10-14-a-core-replays-a-whole-run-when-one-ordered-loop-owns-its-state-and-takes-every-input-stamped-through-one-queue-as-sans-io-cores-lmax-and-tigerbeetle-run-and-neither-actors-nor-simulation-runtimes-can-replay-a-run-from-a-pilots-pc
[flight]: log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start
