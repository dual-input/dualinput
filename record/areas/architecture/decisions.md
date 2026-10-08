# Architecture: tentative decisions

What the architecture's nodes have settled for now, each with the findings behind it and what it leaves out.
Each one holds until the parent of the node that settled it is done, and then becomes a numbered decision in `record/decisions/`, as [the plan](plan.md#where-answers-go) says.
The watcher and the core are the two processes in [step 7 of the product plan](../product/plan.md#7-tech-stack-and-architecture), and the flying and following machines are defined in [03-v1-scope](../product/03-v1-scope.md).

## The core starts with every sim run

- **Decided:** the watcher starts the core whenever the sim starts, and again if the core exits while the sim runs, and the desktop app starts it when the pilot opens the app and the core isn't running.
  No code in the sim, such as a panel or the EFB app, starts the core.
  Settled in node 1.1 by the user, 2026-10-07, and the restart in node 1.2 by the user, 2026-10-08.
- **Because:**
  - Without the restart, a core that crashes mid-flight stays down until the pilot opens the desktop app.
  - A mask registered before the A2A PA-24 loaded got ahead of the aircraft's own, and one registered after it loaded didn't ([flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)).
    A core that starts after the flight loads couldn't hold back input on such an aircraft for soft takeover or mixed flight controls ([04-room-for-later](../product/04-room-for-later.md#an-input-layer)).
  - A group that took its priority as the sim started, held open by an event it only listened to, masked the PA-24's elevator ahead of Accu-Sim once the axis was added after the flight loaded, and held nothing back until then; SimConnect answered before the main menu loaded its aircraft ([flight-controls log](../flight-controls/log.md#2026-10-07-a-group-that-takes-its-priority-as-the-sim-starts-held-open-by-an-event-it-only-listens-to-masks-ahead-of-accu-sim-once-it-adds-the-axis)).
  - The watcher takes over the jobs of programs the sim would launch ([the product plan](../product/plan.md#7-tech-stack-and-architecture)), so it, rather than a program the sim launches, starts the core early enough.
  - Code in the sim reaches a program on the PC only if that program is already listening on 127.0.0.1 ([interface log](../interface/log.md#2026-10-05-an-efb-app-the-toolbar-and-in-game-panels-each-reach-a-program-on-the-same-pc-by-websocket-and-http-and-can-show-a-page-it-serves)), and we found no way for a panel to start one (unverified).
    A start button in the EFB app would need the watcher to listen and start the core, which is more than the watcher should do (user, 2026-10-07).
  - A core that runs through every sim run, session or not, costs little: an idle Node process took 29 MB of memory and no measurable CPU (measured on our development machine, 2026-10-06, with Node 22.23.1, [the product plan](../product/plan.md#7-tech-stack-and-architecture)).
  - The desktop app's start covers a host who starts a session before the sim runs ([invite code](../product/03-v1-scope.md#invite-code)).
- **Leaves out:**
  - what the core and the other components do while no session runs, which [node 1.1.2](plan.md#112-components-with-no-session) designs
  - a pilot who has quit the watcher or turned it off, which [step 7](../product/plan.md#7-tech-stack-and-architecture) allows, so that nothing starts the core with the sim until they open the desktop app
  - when the core exits

## The watcher keeps the BlurPage copy current

- **Decided:** the watcher, not the core, makes our copy of the sim's BlurPage component from the sim's own file, watches that file ([the product plan](../product/plan.md#7-tech-stack-and-architecture)), and makes the copy again whenever the file's hash differs from the one the copy was made from.
  This changes the [interface log's 2026-10-06 entry](../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly), which gives the job to the core.
  Settled in node 1.1 by the user, 2026-10-07.
- **Because:** the sim loads a package only when it boots ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), so the copy has to be right before the sim starts, when the core may not be running yet, and the watcher, which starts with Windows, runs then.
- **Leaves out:** whether a sim update can change `fs-base-ui` while the sim boots, after the watcher's last check, which no run has tried ([interface log](../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly)).

## The core works out where the figure's hand goes

- **Decided:** on the clicking pilot's machine, the core reads the aircraft's models, the camera, and the cursor, and finds each hand's point.
  This changes the avatars' tentative decision, which gave the job to the desktop app ([avatars decisions](../avatars/decisions.md#the-clicking-pilots-machine-finds-the-point-and-the-other-machine-only-draws-it)).
  Settled in node 1.1 by the user, 2026-10-07.
- **Because:**
  - The desktop app and the EFB app show Crosscheck's state and send it commands, and decide nothing ([04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client)), and a hand worked out in the desktop app would stop whenever the app is closed.
  - Our avatar probes read the pilot's mouse from a program outside the sim through Windows' Raw Input in sink mode, which sits in nobody's input path ([mouse.mjs](../../../experiments/tools/mouse.mjs)).

## Our WASM module writes the following aircraft

- **Decided:** our WASM module holds every machine's aircraft still in [preflight](../product/03-v1-scope.md#preflight), and on a following machine freezes the aircraft and writes the flying machine's pose and velocities inside the sim's frame.
  When it hasn't heard from the core for 1s, on any machine in a session, it unfreezes the aircraft, as [flight-model sync](../product/03-v1-scope.md#flight-model-sync) requires, and clears every variable of ours that holds something back ([01-spine](01-spine.md#what-moves-them)).
  Settled in node 1.1 by the user, 2026-10-07.
- **Because:**
  - Written from outside the sim each frame, the pose and velocities held on a parked Baron ([flight-model log](../flight-model/log.md#2026-10-03-written-every-frame-the-velocities-hold-and-the-followers-airspeed-matches-while-its-engine-temperatures-start-apart)), but an object written from outside stuttered in a moving cockpit, and one written from inside the sim's frame didn't ([avatars log](../avatars/log.md#2026-10-03-writes-from-outside-the-sim-place-an-object-in-a-moving-cockpit-but-cant-hold-it-still)).
  - FS Copilot's module freezes the aircraft, writes the pose and four velocities, `A:VELOCITY BODY Y` and `Z` and `A:VELOCITY WORLD X` and `Z`, from samples 400ms in the past, and unfreezes the aircraft after 1s with no word from its app (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `apply_physics`, and `wasm_module.h`, `k_delay_sec`), and we've flown with it (from our experience with FS Copilot).
    It leaves out the body X and rotation velocities, which a frozen aircraft keeps integrating ([flight-model log](../flight-model/log.md#2026-10-03-freezing-holds-the-pose-but-not-the-velocities-so-a-follower-has-to-write-them-all)).
  - Unfreezing once the core stops needs code that outlives the core and can reach the aircraft: the watcher has no SimConnect link, since it notices the sim from the operating system ([the product plan](../product/plan.md#7-tech-stack-and-architecture)), and our WASM module runs inside the sim.
  - Our probe module, `crosscheck-p12-follow`, held a figure in its seat from inside the sim's frame ([avatars log](../avatars/log.md#2026-10-03-nose-up-and-right-wing-down-are-negative-and-turned-by-full-attitude-a-wasm-written-figure-holds-its-seat)), and the product's figures need the same module.
- **Leaves out:** whether the following aircraft itself, written from outside the sim, stutters in flight, which nobody has flown, and we won't, because nothing would be gained (user, 2026-10-07).

## The core catches the take-control key and buttons

- **Decided:** the core reads the pilot's keyboard and flight hardware through Windows' input APIs, by way of the helper it starts ([below](#the-cores-native-code-runs-in-a-helper-it-starts)), rather than mapping the input through SimConnect.
  Settled in node 1.1 by the user, 2026-10-07, and the helper in node 1.3 by the user, 2026-10-08.
- **Because:**
  - Pilots bind the key or a hardware button in Crosscheck's settings, as a single press or a long press ([take-control key](../product/03-v1-scope.md#take-control-key)), so Crosscheck needs each press and release.
  - Electron's `globalShortcut` reports no release (documented in fsc-editor, `docs/sim-vars/08-marks.md`), and it lives in the desktop app, which is optional.
  - SimConnect's input mapping takes an event for the press and one for the release (read in MSFS 2024 SDK 1.7.3, `SimConnect.h`, `SimConnect_MapInputEventToClientEvent_EX1`), and the user ruled it out as a hack (user, 2026-10-07).
- **Leaves out:** whether Raw Input in sink mode delivers a keyboard key's and a flight-hardware button's presses and releases with the sim in front: with another window in front, it delivered F24 presses another program sent and reports from the flight hardware (measured on our development machine, 2026-10-08, [architecture log](log.md#2026-10-08-a-rust-program-captures-one-processs-audio-plays-on-a-device-it-picks-by-name-and-reads-the-keyboard-and-flight-hardware-through-raw-input-in-sink-mode-and-builds-with-visual-studios-linker)), and a probe in which a person presses a bound key and button with the sim in front settles it.

## The core runs Crosscheck's audio

- **Decided:** the core captures the pilot's microphone and runs the speech recognizer, captures the ATC app's audio by process, and plays ATC and Crosscheck's own sounds on the device the pilot picks, with native code where Node has no API, in the helper the core starts ([below](#the-cores-native-code-runs-in-a-helper-it-starts)), so the desktop app stays optional.
  Settled in node 1.1 by the user, 2026-10-07, and the helper in node 1.3 by the user, 2026-10-08.
- **Because:**
  - ATC and the handover cues play with no window open, so a pilot in VR hears them ([hearing ATC](../product/03-v1-scope.md#hearing-atc)).
  - FS Copilot's desktop process captures the ATC app by process with WASAPI's process loopback and plays it back (read in the FS Copilot fork, `FsCopilot/Audio/`), and the fork's `tools/AtcAudio` captured BeyondATC that way in a live flight (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 3: the audio path works on one machine — Q10, Q12, Q13 settled").
- **Leaves out:** the choice of recognizer, which is made when the voice phrases are built ([the product plan](../product/plan.md#6-probes-that-retire-architecture-risks)).

## Every link between our components ends at the core

- **Decided:** no two of Crosscheck's components talk to each other directly, apart from the watcher downloading updates from the release host: each talks to the core, and the core passes on what another needs.
  Apart from the announcements through which the sim's pages find the core and learn whether a session runs ([below](#the-sims-pages-find-the-core-over-the-commbus-and-talk-to-it-over-a-websocket)), the core uses the CommBus and `L:` variables only to reach the aircraft's state and the per-lever hold flags that other tools might read (unverified, [ideas](../product/ideas.md#soft-takeover-on-handover)).
  Settled in node 1.2 by the user, 2026-10-08.
- **Because:**
  - Each of v1's features needs only links that end at the core: a click on a notice in the banner panel, for one, opens the EFB onto our app by way of the core ([01-spine](01-spine.md#communication)).
  - One hub gives one place that logs every link, which component health needs ([ideas](../product/ideas.md#component-health)), and one owner of the session.
- **Leaves out:** a direct link that a later feature might need for speed.
  A panel's action meant for the WASM module takes a WebSocket and then a data slot, and nothing in v1 needs it faster.

## The sim's pages find the core over the CommBus and talk to it over a WebSocket

- **Decided:** the core announces its port and whether a session runs on the CommBus every 2s, and at once when a session starts or ends, and a page in the sim that hears it opens a WebSocket to the core on 127.0.0.1.
  The CommBus carries only those announcements, and the core listens on a port Windows picks.
  Settled in node 1.2 by the user, 2026-10-08.
- **Because:**
  - In the main menu, 13 of the 14 pages heard a SimConnect client's CommBus calls, mainUi, the toolbar's page, and the EFB's among them, and in a flight, 30 of 31, among them all 16 of the A2A PA-24's cockpit panels (measured on MSFS 2024, 2026-10-08, [interface log](../interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel)).
    A page asking is less sure: a call the toolbar's page made before its listener reported ready never arrived (same entry).
  - Every page held a WebSocket to a program on the PC ([interface log](../interface/log.md#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one)).
  - An `L:` variable couldn't carry the port: the menu's page can't read one, and a flight load reset ours to 0 (same entry).
  - The CommBus joins modules, panel JavaScript, and SimConnect clients ([05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm)), so among programs outside the sim, only a SimConnect client of the pilot's sim can call on its CommBus.
    The core needs no fixed port that another program could take first, and a development core attached to a stand-in sim can't reach the real sim's pages, which no run has tried.
    FS Copilot's panels scan ports 9020 to 9024 and take whichever instance answers first, one of the three reasons its test bench can't run beside a live sim (documented in the FS Copilot fork, `record/pointer-forwarding/docs/14-test-bench.md`, "Do not run the simulator during a bench run").
  - FS Copilot refused to announce its port over its CommBus path, because a bus that's down would take the WebSocket with it (documented in the FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, "4.2 Port discovery: range scan 9020–9024").
    That path ran through its WASM module; ours runs through the core's own SimConnect connection, without which the core has no sim to serve.
  - A CommBus call reaches every page listening on its name, so carrying the session over it would have every page sort every message, while a socket in each of 16 cockpit panels cost no frame time we could measure (same entry).
- **Leaves out:**
  - a sim update that changes how mainUi takes view listeners' events, which its route rests on (read in fs-base-ui 0.1.10, `html_ui/Global/lib.js`, `ViewListenerMgr`)
  - the CommBus's limits for a SimConnect client, which nobody has measured; our probes' 12 or 13 calls to each page all arrived ([interface log](../interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel))

## Every client sends the core a message every 2s

- **Decided:** every page and the desktop app send the core a message every 2s, and the core closes a socket it hasn't heard from in 8s.
  Settled in node 1.2 by the user, 2026-10-08: the measurement below makes the core hear from each client, and the 2s and 8s follow FS Copilot's panels.
- **Because:**
  - A page's socket doesn't close when the page goes away: a cockpit panel's was still open when the run ended 23s after the panel reloaded, and all 16 cockpit panels' were still open as the inspector stopped listing them after the pilot left the flight (measured on MSFS 2024, 2026-10-08, [interface log](../interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel)).
  - FS Copilot's panels give up on their app 8s to 10s after its last 2s renewal (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js`, `STATE_DEADMAN_MS` and its 2s watchdog), and a suspended process holds its sockets open and answers nothing (documented in the FS Copilot fork, `record/pointer-forwarding/docs/14-test-bench.md`, "Outages are made by suspending a process").
- **Leaves out:** how long the sim keeps a socket open after its page is gone, past 23s.

## Cockpit panels connect only in a session, and only the ones in use stay

- **Decided:** the panel bridge in a cockpit panel connects when it hears that a session started, names the instruments it holds in its first message, and gets back the modules to load, and a panel the core gives nothing closes its socket.
  Settled in node 1.2 by the user, 2026-10-08.
- **Because:**
  - With no session, nothing watches the cockpit ([01-spine](01-spine.md#components-with-no-session)).
  - The exchange is cheap: one per panel at a session's start, 20 on the Baron, whose cockpit has 20 panels ([interface log](../interface/log.md#2026-10-04-an-ai-copy-of-the-pilots-aircraft-opens-its-livery-painting-and-none-of-its-cockpit-gauges)).
  - A first message from every panel tells the core the panel bridge loaded at all, which it doesn't when another package's `VCockpit.js` override wins ([installing and updating](../product/03-v1-scope.md#installing-and-updating)) or our own bridge fails to parse ([CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel)).

## The core accepts a WebSocket only from the sim's pages and our own apps

- **Decided:** the core accepts a WebSocket whose `Origin` is `coui://html_ui` or missing, and refuses every other, and the desktop app connects from Electron's main process.
  Settled in node 1.2 by the user, 2026-10-08.
- **Because:**
  - Every page in the sim sent `coui://html_ui` (measured on MSFS 2024, 2026-10-08, [interface log](../interface/log.md#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one)), and the WebSocket client in Node 22.23.1, and in Electron 43.4.0 run as Node and as its main process, sent none (measured on our development machine, 2026-10-08, [interface log](../interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel)).
    A page in the desktop app's window is a browser page, and RFC 6455 has a browser send an `Origin` ([RFC 6455](https://www.rfc-editor.org/rfc/rfc6455#section-4.1), section 4.1).
  - Any page in a browser on the PC can open a WebSocket to 127.0.0.1 ([06-04](../../learn/foundations/06-04-websockets-to-localhost.md#websockets-from-a-panel-to-localhost), its traps), so without the check, a page the pilot happens to have open could join them to a stranger's session or take control of their aircraft.
    Chrome may ask the pilot first for the local network (unverified, as of 2026-10-08), and the check doesn't rely on it.
- **Leaves out:**
  - a web page the pilot wants to connect, which a one-time approval or a token could let in later ([01-spine](01-spine.md#left-open))
  - a program on the PC, which can send any `Origin` and could do worse anyway

## Apps outside the sim find the core through a port file

- **Decided:** the core writes its port and process ID to a file in its data folder, and a core that finds the file naming a core that's still running exits, so one core runs for each data folder.
  The desktop app reads the port there, and starts the core when the file names no running process; the watcher reads the process ID, to show the core's CPU and memory use beside its own.
  Settled in node 1.2 by the user, 2026-10-08.
- **Because:**
  - The desktop app and the watcher hold no SimConnect connection, so the CommBus can't reach them.
  - A development core gets a data folder of its own, so it runs beside the pilot's, each with its own ports and identity, as [the product plan](../product/plan.md#7-tech-stack-and-architecture) asks.

## The core writes the WASM module's control slot every 200ms

- **Decided:** in a session, the core writes the WASM module's control slot every 200ms, with the session's state and a counter, and each kind of message has a SimConnect client data area, a data slot, of its own.
  The module leaves its version in a slot when it loads, and writes a counter every second.
  Settled in node 1.2 by the user, 2026-10-08.
- **Because:**
  - The module can't open a socket, so data slots are its link ([05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md#simconnect-from-inside-a-module)).
  - FS Copilot's app writes its module's control slot every 200ms (read in the FS Copilot fork, `FsCopilot/Connection/SimClient.cs`, the constructor), and its module unfreezes after 1s with none, which we've flown with ([our WASM module writes the following aircraft](#our-wasm-module-writes-the-following-aircraft)).
  - Whether two writes to one slot in one frame both arrive is unmeasured ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits)), so no two kinds of message share a slot.
  - A slot keeps its last value after its writer stops (documented, same chapter), so only a counter that moves tells the core the module is still running.

## Crosscheck is written in TypeScript and Rust

- **Decided:** the core, the desktop app, the code in Coherent GT, and the backend are TypeScript, and the watcher, the helper, and the WASM module are Rust ([01-spine](01-spine.md#language-and-toolchains)).
  The core reaches the sim through node-simconnect, the desktop app is packaged by electron-builder, and the WASM module is built with Navigraph's cargo-msfs and packaged by our own script, with bindings generated from the SDK's headers.
  Settled in node 1.3 by the user, 2026-10-08.
- **Because:**
  - Node, Electron, and Coherent GT run JavaScript, the core and its clients speak one protocol ([04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client)), and the user leaned toward TypeScript throughout ([the product plan](../product/plan.md#7-tech-stack-and-architecture); user, 2026-10-06).
  - The user wanted one language for native code rather than C++ for the module and C# for the helper (user, 2026-10-08), and Rust did each job our probes asked of it ([architecture log](log.md)):
    - a standalone module built by cargo-msfs ran on MSFS 2024 at the main menu and traded data slots with a SimConnect client
    - a helper captured one process's audio, played on a device it picked, captured the microphone, and received input through Raw Input in sink mode
    - a tray icon alone cost 1.0 MB of private working set, against 1.6 MB in .NET 9 Native AOT and 39.7 MB over Electron 43.4.0's three processes
  - node-simconnect, which has no native code ([04-01](../../learn/foundations/04-01-connection-and-data.md#what-it-is)), ran every SimConnect call our probes have needed at version 4.2.0, in the probes behind the [aircraft](../aircraft/log.md), [flight-controls](../flight-controls/log.md), [avatars](../avatars/log.md), [sync](../sync/log.md), [interface](../interface/log.md), and [architecture](log.md) logs.
  - Bindings written by hand gave SimConnect's `HANDLE` 32 bits where the SDK gives it 64, and every call after `SimConnect_Open` returned `E_FAIL` (measured on MSFS 2024, 2026-10-08, [architecture log](log.md#2026-10-08-a-standalone-module-built-from-rust-with-cargo-msfs-and-packaged-by-our-own-script-runs-on-msfs-2024-and-trades-data-slots-with-a-simconnect-client-once-its-simconnect-handle-is-64-bits-wide)).
  - fsc-editor ships its Electron app with electron-builder (read in fsc-editor, `electron-builder.yml`).
- **Leaves out:** the relay's language ([01-spine](01-spine.md#language-and-toolchains)), and the choices that stay inside one part ([01-spine](01-spine.md#left-open)).

## The core's native code runs in a helper it starts

- **Decided:** the core's native code, for Raw Input, the microphone, ATC capture, playback, and the speech recognizer, runs in the helper, a program of its own.
  The core starts the helper in a session and while the desktop app binds a key or lists the output devices, starts it again if it exits, and talks to it over its standard input and output.
  Settled in node 1.3 by the user, 2026-10-08.
- **Because:**
  - A crash in native code inside the core's process takes the core down, and the pilot out of the session until the watcher restarts the core and they rejoin ([01-spine](01-spine.md#the-helper)), while the core restarts a helper that crashes, and the session goes on.
  - Our probes read Raw Input from a program they start, line by line over its standard output ([mouse.mjs](../../../experiments/tools/mouse.mjs)).
- **Leaves out:** the messages on the helper's standard input and output, which need one definition that both the TypeScript and the Rust side are checked against, for node 1.4 to settle.

## Plugins are TypeScript, and their file changes are data

- **Decided:** a plugin's code is TypeScript, run in the core or as modules the panel bridge loads, and drives mechanisms of our WASM module for anything inside the sim's frame, such as writing given variables every frame, running given calculator code, or placing an object.
  The changes a plugin makes to an aircraft's files are files and patches that the watcher applies.
  This changes [04-room-for-later](../product/04-room-for-later.md#code-inside-the-sim), which makes the WASM module a host that loads plugins' modules by name.
  Settled in node 1.3 by the user, 2026-10-08.
- **Because:**
  - Our package holds one standalone module, since the sim ran only the first of two in one package ([architecture log](log.md#2026-10-08-a-standalone-module-built-from-rust-with-cargo-msfs-and-packaged-by-our-own-script-runs-on-msfs-2024-and-trades-data-slots-with-a-simconnect-client-once-its-simconnect-handle-is-64-bits-wide)), so a plugin's code there would be compiled into Crosscheck's own module, and code that serves one product lives in a plugin, never in Crosscheck's own code ([04-room-for-later](../product/04-room-for-later.md#plugins)).
  - Crosscheck's own code owns each mechanism, and a plugin owns the policy (same section).
  - The watcher, a Rust program, which runs no TypeScript, applies file changes before the sim boots, usually while the core isn't running ([01-spine](01-spine.md#components-with-no-session)).
- **Leaves out:** a plugin that needs logic inside the frame beyond what calculator code expresses; none in v1 does, since the Baron 58P's plugin works in its gauges' JavaScript and in the core ([plugins](../product/03-v1-scope.md#plugins)).
