# Architecture: the spine

```text
Purpose:     What every other part of Crosscheck rests on: its components, how they talk, the conventions they share, and its languages.
Depends on:  decisions.md, ../product/plan.md (step 7), ../product/01-aims.md, ../product/03-v1-scope.md, ../product/04-room-for-later.md, ../sync/01-profile-entries.md, ../sync/02-live-sync.md, ../sync/03-catch-up.md
Decides:     Which components Crosscheck runs, where each runs, and what each owns (node 1.1); what each does with no session, and what moves it into one and back (node 1.1.2); how they reach each other, and how the core knows each is alive (node 1.2); what language and toolchain each is built with, where the core's native code runs, and what plugins are written in (node 1.3).
```

Each section answers one child of node 1 in the [architecture plan](plan.md), and the tentative decisions behind it, with their findings, are in [decisions.md](decisions.md).
The watcher and the core are the two processes in [step 7 of the product plan](../product/plan.md#7-tech-stack-and-architecture), and the core starts with every sim run ([tentative decisions](decisions.md#the-core-starts-with-every-sim-run)).
The flying and following machines are defined in [03-v1-scope](../product/03-v1-scope.md).
A pilot is in a session from starting or joining it until leaving it, or until 5 minutes cut off ([the connection](../product/03-v1-scope.md#the-connection)).

## Components

Crosscheck runs as the watcher, the core, and the core's helper on each pilot's PC, with the desktop app when the pilot opens it, six pieces of code inside the sim, and three services off the pilots' machines.
The core owns everything a session does.
The desktop app and the EFB app show its state and send it commands, and decide nothing ([04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client)).
The components in the sim carry out what the core tells them, and undo it on their own once the core goes quiet ([what moves them](#what-moves-them)).
The watcher works while the core may not be running, and the services off the pilots' machines connect the crew, collect reports, and hold releases.

| Component | Runs in | Owns |
| --- | --- | --- |
| Watcher | A process of its own, from the pilot's login | The sim's start and stop, the core's start with the sim, the BlurPage copy, plugins' changes to aircraft files, and updates, all while the sim is closed or starting |
| Core | A process of its own, in Node, started by the watcher or the desktop app | SimConnect, the session, the network, the profile engine and plugins, sim awareness, recording, audio, the take-control input, the figure's hand, AI traffic, and the checks |
| Helper | A process of its own, which the core starts and restarts | The core's native work: reading the keyboard, flight hardware, and mouse through Raw Input, capturing the microphone and the ATC app, running the speech recognizer, and playing sound |
| Desktop app | A window of its own, in Electron, opened by the pilot, optional | Settings, bindings, the output device, the recording mode, the report page, and the session's view |
| EFB app | The EFB's document in the sim | The controls a pilot needs in flight, and the EFB's opening onto it when a notice is clicked |
| Banner panel | An in-game panel of ours | Notices |
| Toolbar script | The toolbar's document, through our toolbar icon | The banner panel's opening |
| Menu script | The main menu's document, through our copy of BlurPage | Go to, through the world map's requests, and reports of which menu page is up |
| Panel bridge | Every cockpit panel, through our `VCockpit.js` override | Pointer sync, and the modules that features and plugins name |
| WASM module | The sim, as a standalone module from boot | The figures' placement, the aircraft's hold and writes, and the undoing of our state in the sim when the core goes quiet |
| Relay | Off the pilots' machines | Invite codes, introductions between cores, and a session's traffic when the cores can't link directly |
| Backend | Off the pilots' machines | Each pilot's part of a bug report, and later features that need a server of ours, such as [telemetry](../product/ideas.md#telemetry) |
| Release host | Off the pilots' machines | Installers and updates |

Plugins aren't components: a plugin's code runs inside the core or as modules the panel bridge loads, through hooks in each, and drives our WASM module's mechanisms for anything inside the sim's frame ([plugins](#plugins)), and the watcher applies a plugin's changes to its aircraft's files while the sim is closed ([the product plan](../product/plan.md#7-tech-stack-and-architecture)).
The installer runs once, and puts the app and our Community package in place ([installing and updating](../product/03-v1-scope.md#installing-and-updating)).
The figure is the other pilot's, which our WASM module draws ([avatar sync](../product/03-v1-scope.md#avatar-sync)).

Where each sits, and why:

- Step 7 gives the watcher the jobs [installing and updating](../product/03-v1-scope.md#installing-and-updating) gives programs the sim launches, such as the warning at sim start that an update is waiting ([the product plan](../product/plan.md#7-tech-stack-and-architecture)), and the [tentative decisions](decisions.md#the-watcher-keeps-the-blurpage-copy-current) give it the BlurPage copy.
- The core reads the take-control input with native code ([tentative decisions](decisions.md#the-core-catches-the-take-control-key-and-buttons)), runs the audio ([tentative decisions](decisions.md#the-core-runs-crosschecks-audio)), and works out where the figure's hand goes ([tentative decisions](decisions.md#the-core-works-out-where-the-figures-hand-goes)), with its helper doing the native work ([the helper](#the-helper)).
  It also reads the clipboard when the pilot selects the EFB app's code box ([invite code](../product/03-v1-scope.md#invite-code)), reads the flight file that names the PF's stand ([preflight](../product/03-v1-scope.md#preflight)), and uploads a bug report when the pilot asks from the desktop app's report page ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
- AI traffic is injected and written from the core, outside the sim.
  FS Copilot's app freezes each copy and writes it in SimConnect's `Frame` event (read in the FS Copilot fork, `FsCopilot/Simulation/TrafficReceiver.cs`, `Render`, and `FsCopilot/Connection/SimTraffic.cs`), and the fork's prototype injector, driving copies the same way, moved them more smoothly than BeyondATC moves its own ([traffic sync](../product/03-v1-scope.md#traffic-sync)).
- The core's checks are the version check at join ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), the [preflight match check](../product/03-v1-scope.md#preflight-match-check), and the check for another package's `VCockpit.js` override.
- The EFB app, the banner panel, the toolbar script, and the menu script each reach the sim's documents by a route we measured on MSFS 2024: an app registered with the EFB ([interface log, 2026-10-06](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)), an in-game panel ([2026-10-04](../interface/log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)), a script that our toolbar icon loads ([2026-10-04](../interface/log.md#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click)), and a script that our copy of BlurPage loads ([2026-10-06](../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly)).
- The panel bridge loads one module per file, so one module's syntax error reaches no other ([04-room-for-later](../product/04-room-for-later.md#code-inside-the-sim)).
- The WASM module writes inside the sim's frame and outlives the core ([tentative decisions](decisions.md#our-wasm-module-writes-the-following-aircraft)).
  Whether it also runs calculator code, for `H:` events if SimConnect's client events can't fire them (unverified, [01-profile-entries](../sync/01-profile-entries.md#the-writer-api)), is open ([left open](#left-open)).
- The relay holds a session's invite code, as fsc-editor's does (read in fsc-editor, `relay/src/index.ts`), and introduces the cores, which try a direct link first and fall back to the relay ([network log](../network/log.md#2026-10-06-research-puts-the-share-of-pilot-pairs-that-need-the-relay-between-5-and-31-and-one-small-servers-transfer-covers-tens-of-thousands-of-session-hours-a-month)).
- The backend's candidate is a Cloudflare Worker with D1 and R2 ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
- The release host is GitHub Releases (user, 2026-10-08), which fsc-editor's `electron-updater` updates fsc-editor from (read in fsc-editor, `package.json`, `electron-builder.yml`, and `src/main/updates.ts`).

## Components with no session

With no session, each component does only what lets a session start, and nothing that serves one.
A pilot may fly the Baron every day and with a crew once a week, so on the other six days no profile loads, no plugin runs, and nothing watches the cockpit (user, 2026-10-07).
Each component has to be told to idle, because an app can do session work with nobody to fly with: FS Copilot's app connected to its relay and registered with its rendezvous server at launch, session or not (read in the FS Copilot fork, `FsCopilot/Program.cs`, `BuildAvaloniaApp`, and `FsCopilot/Network/RelayNetwork.cs` and `P2PNetwork.cs`, their constructors).
So the core tells every component below when a session starts.

| Component | With no session | In a session |
| --- | --- | --- |
| Watcher | Notices the sim's process starting and stopping, keeps the BlurPage copy current, applies plugins' changes to aircraft files before the sim boots, and starts the core | No different |
| Core | Holds its SimConnect connection and its masking group; follows the sim's system and flow events; serves its clients on 127.0.0.1 | Also brings up the network, loads the profile and plugins while the pilot's aircraft is loaded, watches the cockpit, records, runs the audio, and reads the take-control input |
| Helper | Not running, except while the desktop app binds a key or lists the output devices | Reads the take-control input and the cursor, and captures and plays the audio, for the core |
| Desktop app | Optional; offers to start or join a session | Optional; shows the session |
| WASM module | Runs, and does nothing each frame | Places the figures, holds the aircraft in preflight, and on a following machine writes the aircraft |
| Panel bridge | Runs in every cockpit panel, loads no modules, and captures nothing | Runs pointer sync, and loads the modules that features and plugins name |
| EFB app | Offers to start a session or enter a code | Shows the session's controls |
| Toolbar script | Waits for the core | Opens the banner panel when the session has something to show |
| Banner panel | Closed, so it has no page | Shows the session's notices |
| Menu script | Answers the core when asked, and watches nothing | Reports which menu page is up, and runs Go to |

The core's masking group holds `K:SIM_RATE_INCR`, which it listens to and doesn't mask, and takes its priority as the sim starts ([flight-controls log](../flight-controls/log.md#2026-10-07-a-group-that-takes-its-priority-as-the-sim-starts-held-open-by-an-event-it-only-listens-to-masks-ahead-of-accu-sim-once-it-adds-the-axis)).
Three components run whether or not the pilot is in a session, because the sim starts them:

- The sim loads our WASM module when it mounts our package at boot, and keeps it through the main menu, every flight, and every aircraft change ([05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md#gauge-vs-standalone-modules-and-the-sandbox)).
- A `VCockpit.js` override runs in every cockpit panel as the panel loads: FS Copilot's put its bridge into all 14 of the Synaptic A220's panels about 7 minutes before its app's first peer link (measured on MSFS 2024, 2026-09-08, FS Copilot fork, `record/pointer-forwarding/results/session-2026-09-08-app.txt`).
- Our EFB app's code runs from sim start, with the EFB closed ([interface log](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)).

The banner panel has no page while it's closed, because closing our in-game panel destroyed its page ([interface log](../interface/log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)).

## What moves them

- **Starting or joining a session,** from the desktop app or the EFB app: the core brings up the network.
  Once the pilot is in a flight, it loads the profile and plugins and tells the components in the sim.
  The core knows when Ready to fly last came, because it has followed the sim's flow events since the sim started.
  If that was 1.5 minutes ago or more, the aircraft counts as settled ([03-catch-up](../sync/03-catch-up.md#settling-after-a-load)); if it was sooner, the quiet window can start only once the profile loads, a case 03-catch-up's rule doesn't cover.
- **Changing aircraft in a session:** the core unloads the old aircraft's profile and plugins and loads the new aircraft's.
- **Leaving the flight but not the session,** at the main menu or in another flight ([the connection](../product/03-v1-scope.md#the-connection)): the core keeps the session and the network, unloads the profile and plugins with the aircraft, and loads them again once the pilot is back in a flight as a late joiner.
- **Leaving the session, or being cut off for 5 minutes:** each component undoes what the session started.
  So every module Crosscheck loads into a panel or the sim can tear itself down, which is also what [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) asks of anything in the pilot's input path.
- **The core stopping:** nothing in the sim stays in a session's state.
  - The core's masks end with its connection ([flight-controls log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)).
  - The WASM module hears from the core on every machine in a session, and after 1s with no word from it, unfreezes the aircraft and clears every variable of ours that holds something back.
    FS Copilot's module works that way: once 1s passes with no control packet from its app, it sets `L:FSC_CONTROL` to 0 and unfreezes the aircraft, whatever the machine's role (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `Update_StandAlone`, `g_last_seen`).
  - A panel blocks input only while the core keeps telling it to, as FS Copilot's panels block only while their app's renewals arrive, and drop to a warning that blocks nothing 8s to 10s after the last one (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js`, `STATE_DEADMAN_MS` and its 2s watchdog).

The core exits once the sim has closed, no session is held, and the desktop app isn't open.
While a session is held, the core stays up through a sim restart, so it can tell the crew the sim crashed and rejoin the pilot as a late joiner ([the connection](../product/03-v1-scope.md#the-connection)).

## Communication

Every link between our components ends at the core, except the watcher's to the release host ([tentative decisions](decisions.md#every-link-between-our-components-ends-at-the-core)).
v1's features need no other: a click on a notice in the banner panel, for one, opens the EFB onto our app by way of the core, and a panel's action meant for the WASM module goes to the core over a WebSocket, then to the module through a SimConnect client data area, which this document calls a data slot.
A page here is a document the sim runs in Coherent GT, one of those the inspector lists.

```text
 Watcher ──starts──▶ Core ◀── WebSocket ──▶ Desktop app
                      │ ▲
                      │ └── WebSocket, after a CommBus announcement ── EFB app, banner panel,
                      │                                             toolbar script, menu script,
                      │                                             panel bridge
                      ├── SimConnect ── the sim: masks, events, AI traffic, and the CommBus
                      ├── SimConnect data slots ── WASM module
                      ├── starts, and a pipe ── helper
                      └── the network ── other pilots' cores, the relay, the backend
 Watcher ── HTTPS ── release host
```

| Link | Means | What crosses | How the core knows it's alive |
| --- | --- | --- | --- |
| Watcher to core | The watcher starts the core's process | Nothing else | It can't: the watcher sends it nothing |
| Desktop app and core | WebSocket on 127.0.0.1, found through the port file | The core's state one way, commands the other | Messages every 2s |
| EFB app and menu script, and core | WebSocket, found through the CommBus, whether or not a session runs | The EFB's controls and state, Go to, and which menu page is up | The same, and a first message naming the component and its version |
| Toolbar script and core | The same, while a session runs | The banner's opening | The same |
| Banner panel and core | The same, while the panel is open | Notices, and a click on one | The same |
| Panel bridge and core | The same, from every cockpit panel when a session starts, kept open only by the panels the profile or a plugin names | Pointer presses, `H:` events, plugin modules' traffic, and the locks' renewals | The same; no panel's first message ever arriving means our panel bridge didn't load, as when another package's `VCockpit.js` wins |
| Core and WASM module | Data slots, one for each kind of message | The session's state and a counter, the pose and velocities, the figures' poses, and the module's version | A counter the module writes every second |
| Core and helper | The core starts the helper's process and talks to it over the helper's standard input and output | Key and button presses, the cursor, recognized phrases, and captured ATC one way; what to capture and what to play the other | The helper's process exiting, or its message every 2s stopping, as every client's does |
| Core and other machines | The network, [below](#between-machines) | The six channels of [04-room-for-later](../product/04-room-for-later.md#channels), invite codes, and reports | For the node that designs how the cores reach each other |
| Watcher and release host | HTTPS | Updates | Not needed |

### Finding the core

The core listens on 127.0.0.1, on a port Windows picks.
A page in the sim learns the port over the CommBus, and an app outside it from a file ([tentative decisions](decisions.md#the-sims-pages-find-the-core-over-the-commbus-and-talk-to-it-over-a-websocket)).

The core calls `SimConnect_CallCommBusEvent` for JavaScript every 2s with its port and whether a session runs, and at once, on the CommBus and on every socket, when a session starts or ends, and a page that hears it opens a WebSocket to that port.
The page doesn't ask, and the core's next announcement reaches a page that loaded before the core, as the EFB app's code runs from the sim's start ([interface log](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)).
In the main menu, 13 of the 14 pages heard a SimConnect client's calls, mainUi, the toolbar's page, and the EFB's among them, and in a flight, 30 of 31, among them all 16 of the A2A PA-24's cockpit panels (measured on MSFS 2024, 2026-10-08, [interface log][coverage]); our own in-game panel heard them in an earlier flight ([interface log][links]).
The page that heard nothing, "transition", runs none of our code.
A page could call the core through the CommBus, but a call the toolbar's page made before its listener reported ready never arrived ([interface log][coverage]), so our pages don't call it.
mainUi and the menu's toolbar page have no `Coherent`, so our script there triggers `ADD_VIEW_LISTENER` for `JS_LISTENER_COMM_BUS` and takes the core's calls as `EVENT_FROM_VIEW_LISTENER`, the way mainUi's own view listeners take events (read in fs-base-ui 0.1.10, `html_ui/Global/lib.js`, `ViewListenerMgr`).
That route rests on the sim's own page code rather than on the SDK's CommBus API ([05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm)), so a sim update could change it, as it could the BlurPage copy.
In a page that has the sim's `common.js` but not its `Services/CommBus.js`, such as the toolbar's in a flight and our banner's, our script loads `CommBus.js` and listens through `RegisterCommBusListener`.
An `L:` variable can't carry the port: mainUi can't read one, and a flight load reset ours to 0 ([interface log][links]).

The CommBus joins modules, panel JavaScript, and SimConnect clients ([05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm)), so among programs outside the sim, only a SimConnect client of the pilot's sim can call on its CommBus, and a development core attached to a stand-in sim can't reach the real sim's pages, which no run has tried.

The CommBus carries these announcements and nothing else, for two reasons:

- A CommBus call reaches every page listening on its name, so each page would sort the whole session's traffic, as every panel did on FS Copilot's CommBus path (documented in the FS Copilot fork, `record/pointer-forwarding/docs/04-transport.md`, "What exists").
- Its limits for a SimConnect client are unmeasured.

The core writes its port and process ID to a file in its data folder, and one core runs for each data folder: a core that finds the file naming a core that's still running exits ([tentative decisions](decisions.md#apps-outside-the-sim-find-the-core-through-a-port-file)).
So a pilot's PC runs one core, and a development core with a data folder of its own runs beside it.

### The sim's pages

- The EFB app and the menu script connect whenever they hear the core's announcement: with no session, the EFB app is where a pilot starts one, and the core asks the menu script which page is up ([components with no session](#components-with-no-session)).
- The toolbar script connects while a session runs, since it opens the banner panel only when the session has something to show.
- The banner panel connects while it's open, since closing it destroys its page ([interface log](../interface/log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)).
- Every cockpit panel's panel bridge connects when it hears that a session started, sends a first message naming the instruments it holds, and gets back the modules to load, and a panel the core gives nothing closes its socket ([tentative decisions](decisions.md#cockpit-panels-connect-only-in-a-session-and-only-the-ones-in-use-stay)).
  Once it has loaded the profile and the plugins, the core keeps the panels holding the displays pointer sync replays into, one panel to listen for `H:` events, and those each plugin's modules run in.

A page's socket doesn't close when the page goes away: a cockpit panel's was still open when the run ended 23s after the panel reloaded, and all 16 cockpit panels' were still open as the inspector stopped listing them after the pilot left the flight (measured on MSFS 2024, 2026-10-08, [interface log][coverage]).
So each page sends the core a message every 2s, and the core closes a socket it hasn't heard from in 8s, as FS Copilot's panels give up on their app 8s to 10s after its last 2s renewal (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js`, `STATE_DEADMAN_MS` and its 2s watchdog).

A socket in each of the PA-24's 16 cockpit panels cost no frame time we could measure: uncapped, at about 83 fps, the two windows with nothing of ours read 12.25ms and 12.07ms a frame, and the windows with our sockets idle, taking a message every 2s, or taking 30 messages a second each read 12.01ms to 12.07ms (measured on MSFS 2024, 2026-10-08, [interface log][links]).

The core accepts a WebSocket only when its `Origin` is `coui://html_ui`, which every page sent, or missing, which the WebSocket client in Node 22.23.1 and in Electron 43.4.0's main process send ([tentative decisions](decisions.md#the-core-accepts-a-websocket-only-from-the-sims-pages-and-our-own-apps)).
So the desktop app connects from Electron's main process, since a page in its window is a browser page, which sends an `Origin`.

### The WASM module

The WASM module can't open a socket, so it reaches the core through data slots, as FS Copilot's and fsc-editor's modules do ([05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md#simconnect-from-inside-a-module); [tentative decisions](decisions.md#the-core-writes-the-wasm-modules-control-slot-every-200ms)).

- The module creates the slots when it loads at the sim's start, and leaves its version in one, as fsc-editor's module does (read in fsc-editor, `link/src/module.cpp`, `module_init`), so the core can tell a missing module from a present one.
- Each kind of message has a slot of its own, because whether two writes to one slot in one frame both reach the reader is unmeasured ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits)).
- In a session, the core writes the module's control slot every 200ms, with the session's state and a counter.
  The module learns that a session ended from that state, and takes 1s with no write to mean the core stopped ([what moves them](#what-moves-them)).
  A slot carries more than the 5 writes a second this takes: fsc-editor's module streamed values to its app through one at 15Hz (read in fsc-editor, `link/src/module.cpp`, `k_interval_seconds`; measured on MSFS 2024, 2026-08-27, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-27 — Protocol 4 verified in the sim; Z: resolve-does-not-create is signal").
- The module writes a counter every second, so the core can tell a running module from one that stopped.

### The watcher and the desktop app

- The watcher starts the core when the sim starts, and again if the core exits while the sim runs ([tentative decisions](decisions.md#the-core-starts-with-every-sim-run)).
  Whether the crew sees a restarted core as the same pilot is node 1.4's question.
- The watcher reads the core's process ID from the port file and shows its CPU and memory use beside its own ([the product plan](../product/plan.md#7-tech-stack-and-architecture)).
  It opens no socket to the core.
- The desktop app starts the core when the port file names no running process, and waits for the file to be written again.
- The core launches the desktop app when it isn't open: when the pilot presses the EFB app's button that brings it to the front ([EFB app](../product/03-v1-scope.md#efb-app)), and after a sim crash, to show the Rejoin button ([ideas](../product/ideas.md#telling-the-crew-a-sim-crashed)).

### Between machines

The core talks to other pilots' cores, directly when it can and through the relay when it can't, and to the backend over HTTPS.
The watcher alone talks to the release host, over HTTPS.
How the cores reach each other is for a top-level node after node 1 (user, 2026-10-08): the topology, the transport, getting through home routers, the relay, and encryption.

Two findings go to it.
A Cloudflare Worker takes HTTP requests, WebSocket upgrades among them, and Cloudflare's docs say it can't take a raw inbound TCP connection (documented, [Workers TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/), as of 2026-10-08).
A Cloudflare post of 2026-08-03 announces raw inbound TCP through Spectrum in a private beta, and names UDP only as a goal (documented, [gRPC on Workers](https://blog.cloudflare.com/grpc-workers/)).
So a Worker can't relay UDP as of 2026-10-08, which our FS Copilot record also says, without a source (FS Copilot fork, `record/self-hosted-relay/docs/02-hosting-choice.md`), and fsc-editor's Worker relay carries its sessions over WebSocket, on TCP.
Cloudflare's Realtime TURN service relays UDP only: its FAQ says it doesn't implement RFC 6062, the TURN extension for TCP relays, and TURN without it relays UDP (documented, [TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/), as of 2026-10-08; [RFC 8656](https://www.rfc-editor.org/rfc/rfc8656)).
It charges $0.05 a GB sent from Cloudflare to the client ([TURN](https://developers.cloudflare.com/realtime/turn/)), after 1,000 GB free each month ([Realtime pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)), each documented as of 2026-10-08.
Its pages describe it for WebRTC clients, so whether a client that isn't WebRTC, such as a core with a UDP transport of its own, can use it is unverified, and asking Cloudflare's TURN for a relay from such a client settles it.

### How the core knows a component is alive

Every link but two tells the core when its component goes quiet: a page's or the desktop app's messages stop, a first message never comes, the module's counter stops, or the helper's process exits or its messages stop.
The core can't tell whether the watcher runs, because the watcher sends it nothing, and how it learns that the relay or another pilot's core went quiet is for the node that designs how the cores reach each other.
Each page's first message names the component and its version, and the WASM module leaves its version in a slot, so the core logs a page from an older package by name, and names each component it expected and never heard from.
The core logs every connection, first message, and close, and the recording keeps them, so a bug report shows which component stopped and when ([ideas](../product/ideas.md#component-health)).
What counts as trouble for each component, and where the pilot sees it, is [left open](#left-open).

[links]: ../interface/log.md#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one
[coverage]: ../interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel

## Language and toolchains

Crosscheck is written in TypeScript wherever a JavaScript engine runs it, and in Rust for native code on the pilot's PC and inside the sim ([tentative decisions](decisions.md#crosscheck-is-written-in-typescript-and-rust)).

| Component | Runs in | Language |
| --- | --- | --- |
| Core | Node | TypeScript |
| Desktop app | Electron | TypeScript |
| EFB app, banner panel, toolbar script, menu script, and panel bridge | Coherent GT | TypeScript, compiled to the syntax Coherent GT parses |
| Backend | A Cloudflare Worker, its candidate host | TypeScript |
| Watcher | A Windows program of its own | Rust |
| Helper | A Windows program of its own | Rust |
| WASM module | The sim's WebAssembly | Rust |

The relay's language is for the node that designs how the cores reach each other.

### The core and the desktop app

The core reaches the sim through node-simconnect, which implements SimConnect's protocol in JavaScript with no native code ([04-01](../../learn/foundations/04-01-connection-and-data.md#what-it-is)).
At version 4.2.0 (read in `experiments/package.json`), it ran every SimConnect call our probes have needed on MSFS 2024: data definitions and requests, client events and masking groups, system and flow events, AI objects with liveries, input events, data slots, the camera, flight loads, `SimConnect_CallCommBusEvent`, and `SimConnect_SubscribeToCommBusEvent`.
Those probes are behind the [aircraft](../aircraft/log.md), [flight-controls](../flight-controls/log.md), [avatars](../avatars/log.md), [sync](../sync/log.md), and [interface](../interface/log.md) logs, from 2026-10-01 to 2026-10-08, with the CommBus calls on 2026-10-08 ([interface log][coverage]) and the data slots with our own module the same day ([architecture log][module]).
A binding that implements the protocol again has only the calls its authors wrote ([04-01](../../learn/foundations/04-01-connection-and-data.md#what-it-is)), so when Crosscheck needs a call node-simconnect lacks, we add it to node-simconnect.
Packaged in fsc-editor's app, its registry read failed, and it then used port 2048 without an error, until fsc-editor shipped the scripts that read runs outside the app's archive ([04-01](../../learn/foundations/04-01-connection-and-data.md#connecting)).

fsc-editor ships an Electron app packaged by electron-builder (read in fsc-editor, `electron-builder.yml`), and the desktop app is built the same way.

### Code in the sim

Code that runs in Coherent GT is written in TypeScript and compiled to the syntax the engine parses, as the vendors' own code is: the A220's DisplayUnits bundle spells `??` out the long way ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits)), and A2A's tablet is TSX that esbuild bundles ([EFB app](../product/03-v1-scope.md#efb-app)).
Step 7's check that every file run in Coherent GT parses within the engine's measured limits runs on the compiled output ([the product plan](../product/plan.md#7-tech-stack-and-architecture)).
Compiling doesn't fill in the built-ins Coherent GT lacks, such as `Object.fromEntries`, whose calls throw when they run, and a parse check doesn't see them ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits)), so the build also fills them in or rejects their use, as step 7 has the missing functions filled in for code shared with the desktop app.

Our WASM module is Rust, built by Navigraph's cargo-msfs and packaged by our own script: a module built that way loaded on MSFS 2024, ran its update about 136 times a second, and traded data slots with a SimConnect client at the main menu, and nobody has run it in a flight (measured on MSFS 2024, 2026-10-08, [architecture log][module]).

- cargo-msfs fetches the SDK from the SDK site's public download, `sdk.flightsimulator.com`, and unpacks it without running the installer (read in [navigraph/cargo-msfs](https://github.com/navigraph/cargo-msfs), `src/sdk.rs`, on 2026-10-08), so the repository holds none of the SDK.
  A CI runner with a C++ compiler for cargo-msfs's own install, which compiles Binaryen's C++, could build the module, which no run has tried ([architecture log][module]).
- The module's bindings to the sim are generated from the SDK's headers, as FlyByWire's msfs-rs generates them with bindgen (read in [msfs-rs](https://github.com/flybywiresim/msfs-rs), `msfs/build.rs`, on 2026-10-08), because a binding with a wrong type compiles and loads, and nothing reports the mistake until the sim's calls fail.
  Bindings written by hand gave SimConnect's `HANDLE` 32 bits where the SDK gives it 64, the first call after `SimConnect_Open` returned `E_FAIL`, and the module's slots never appeared (same entry).
- Each standalone module gets a package of its own until two working modules in one package are tried (same entry).

### The helper

The core's native code runs in the helper, a Rust program the core starts, and starts again if it exits ([tentative decisions](decisions.md#the-cores-native-code-runs-in-a-helper-it-starts)).
A crash in native code inside the core's process would take the core down, and the pilot out of the session until the watcher restarted the core and they rejoined, while a crash in the helper costs the take-control input, the figure's hand, and the audio only until the core restarts it.

- Our probes already work this way: one starts PowerShell, which compiles C# that reads the mouse through Raw Input, and reads its reports line by line from its standard output ([mouse.mjs](../../../experiments/tools/mouse.mjs)).
- A Rust build captured another process's audio through process loopback at that audio's own level, played on the default output device after looking it up by name, and captured the default input device, a Focusrite input, though whether a microphone was on it is untested.
  Registered for Raw Input in sink mode, with its own window never in front, it received F24 presses and releases that another program sent, and 1,447 HID reports in 4s from four devices nothing identified (measured on our development machine, 2026-10-08, [architecture log][helper]).
- Its build linked with Visual Studio 2022's linker, and rustup documents Visual Studio's Build Tools as enough ([rustup](https://rust-lang.github.io/rustup/installation/windows-msvc.html)); Rust's GNU target failed with Rust's own tools, and with a full MinGW is untried ([architecture log][helper]).
- The speech recognizer runs in it, and the recognizer is chosen when the voice phrases are built ([the product plan](../product/plan.md#6-probes-that-retire-architecture-risks)).

### The watcher

The watcher is Rust because it runs all day, shows the pilot its own memory use ([the product plan](../product/plan.md#7-tech-stack-and-architecture)), and Rust is the language of our other native code.
A tray icon alone cost 1.0 MB of private working set, the figure Task Manager's Memory column shows, in Rust, 1.6 MB in .NET 9 Native AOT, and 39.7 MB over Electron 43.4.0's main process and the two processes it started, with no CPU we could measure in any of them (measured on our development machine, 2026-10-08, [architecture log][tray]).

### Plugins

Plugins are TypeScript, and the changes they make to aircraft files are data the watcher applies ([tentative decisions](decisions.md#plugins-are-typescript-and-their-file-changes-are-data)).

- A plugin's code runs in the core, or as modules the panel bridge loads in the aircraft's cockpit panels, compiled like our own panel code.
- A plugin adds no code to the WASM module (user, 2026-10-08).
  What a plugin needs done inside the sim's frame is a mechanism of our module that the plugin drives, such as writing given variables every frame, running given calculator code, or placing an object, so Crosscheck's own code owns the mechanism and the plugin the policy, and code that serves one product stays out of Crosscheck's own module ([04-room-for-later](../product/04-room-for-later.md#plugins)).
- A plugin's logic inside the frame goes in calculator code our module runs, and logic beyond what calculator code expresses is [left out](decisions.md#plugins-are-typescript-and-their-file-changes-are-data), since no v1 plugin is known to need it.
  The one call that runs calculator code, `execute_calculator_code`, is deprecated in SDK 1.7.3 with no replacement ([05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md#the-gauge-api-and-its-replacements)), and FS Copilot's module makes every write to the aircraft through it (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `apply_physics`), which we've flown with on MSFS 2024 (from our experience with FS Copilot).
- The watcher applies file changes before the sim boots, usually while the core isn't running, and as a Rust program it runs no TypeScript, so a plugin's changes are files and patches the watcher reads, not code it runs.

### Messages between TypeScript and Rust

The messages that cross between TypeScript and Rust, through the data slots and the helper's standard input and output, need one definition both sides are checked against ([05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md#protocol-versioning-between-the-app-and-the-module-packed-structs)), which is node 1.4's to settle.

[module]: log.md#2026-10-08-a-standalone-module-built-from-rust-with-cargo-msfs-and-packaged-by-our-own-script-runs-on-msfs-2024-and-trades-data-slots-with-a-simconnect-client-once-its-simconnect-handle-is-64-bits-wide
[helper]: log.md#2026-10-08-a-rust-program-captures-one-processs-audio-plays-on-a-device-it-looks-up-by-name-and-receives-keyboard-and-hid-input-through-raw-input-in-sink-mode-and-builds-with-visual-studios-linker
[tray]: log.md#2026-10-08-a-tray-icon-alone-costs-10-mb-of-memory-in-rust-16-mb-in-net-native-aot-51-mb-in-winforms-and-397-mb-over-three-processes-in-electron

## Left open

- What counts as trouble for each component, and where the pilot sees it: the desktop app, the EFB app for a pilot in VR, or a notice on the banner when it costs them a feature ([ideas](../product/ideas.md#component-health)).
- How the cores reach each other ([between machines](#between-machines)).
- Letting a web page connect to the core, which the `Origin` check refuses (user, 2026-10-08): if an integration ever needs it, a site the pilot approves once, or one carrying a token, as the off-by-default listener for the tablet would ([04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client)).
- How each module tears itself down is the panel bridge's and the plugins' to design.
- Choices that stay inside one part: the compiler and syntax target for code in Coherent GT, where no ECMAScript version matches the engine ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits)); the desktop app's interface framework; the core's WebSocket library; and whether `node.exe` or Electron's executable running as Node runs the core.
- Whether the toolbar script can open the banner outside a Build and Mount, at a flight load or mid-flight when a session starts then, is open: we've seen it open the panel only after Build and Mounts, two times in three ([03-v1-scope](../product/03-v1-scope.md#notification-banner)).
- Whether profiles reach pilots apart from Crosscheck's releases.
  Profiles ship in Crosscheck's releases unless this says otherwise, pilots on different Crosscheck versions can't fly together, and updates install only while the sim is closed ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), so a fix to one profile takes a release, and two pilots can't fly together until both have closed the sim to install it.
  Profiles delivered on their own, keyed by the version and hash the [preflight match check](../product/03-v1-scope.md#preflight-match-check) already compares, would avoid that, and the profile registry, a Later pick, goes that way ([ideas](../product/ideas.md#profile-registry)).
- How the core judges an aircraft settled in a session started before [03-catch-up](../sync/03-catch-up.md#settling-after-a-load)'s rule could call it settled.
  One way keeps [03-catch-up](../sync/03-catch-up.md#settling-after-a-load)'s 30s floor from Ready to fly and counts its 15s quiet window from when the profile loads.
- Whether the WASM module runs calculator code for the profile engine, which a probe of whether SimConnect's client events reach `H:` events settles.
