# Architecture: tentative decisions

What the architecture's nodes have settled for now, each with the findings behind it and what it leaves out.
Each one becomes a numbered decision in `record/decisions/` at the end of step 7 of the product plan, once the top-level answers pass the walk through a session, as [the plan](plan.md#where-answers-go) says.
The watcher and the core are the two long-running processes in [the spine](01-spine.md), and the flying and following machines are defined in [03-v1-scope](../product/03-v1-scope.md).

## The core starts with every sim run

- **Decided:** the watcher starts the core whenever the sim starts, and again if the core exits while the sim runs, and the desktop app starts it when the pilot opens the app and the core isn't running.
  No code in the sim, such as a panel or the EFB app, starts the core.
  Settled in node 1.1 by the user, 2026-10-07, and the restart in node 1.2 by the user, 2026-10-08.
- **Because:**
  - Without the restart, a core that crashes mid-flight stays down until the pilot opens the desktop app.
  - A mask registered before the A2A PA-24 loaded got ahead of the aircraft's own, and one registered after it loaded didn't ([flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)).
    A core that starts after the flight loads couldn't hold back input on such an aircraft for soft takeover or mixed flight controls ([04-room-for-later](../product/04-room-for-later.md#an-input-layer)).
  - A group that took its priority as the sim started, held open by an event it only listened to, masked the PA-24's elevator ahead of Accu-Sim once the axis was added after the flight loaded, and held nothing back until then; SimConnect answered before the main menu loaded its aircraft ([flight-controls log](../flight-controls/log.md#2026-10-07-a-group-that-takes-its-priority-as-the-sim-starts-held-open-by-an-event-it-only-listens-to-masks-ahead-of-accu-sim-once-it-adds-the-axis)).
  - The watcher takes over the jobs of programs the sim would launch (user, 2026-10-06), so it, rather than a program the sim launches, starts the core early enough.
  - Code in the sim reaches a program on the PC only if that program is already listening on 127.0.0.1 ([interface log](../interface/log.md#2026-10-05-an-efb-app-the-toolbar-and-in-game-panels-each-reach-a-program-on-the-same-pc-by-websocket-and-http-and-can-show-a-page-it-serves)), and we found no way for a panel to start one (unverified).
    A start button in the EFB app would need the watcher to listen and start the core, which is more than the watcher should do (user, 2026-10-07).
  - A core that runs through every sim run, session or not, has to cost little: a Rust program showing only a tray icon took 1.0 MB of private working set and no measurable CPU (measured on our development machine, 2026-10-08, [architecture log](log.md#2026-10-08-a-tray-icon-alone-costs-10-mb-of-memory-in-rust-16-mb-in-net-native-aot-51-mb-in-winforms-and-397-mb-over-three-processes-in-electron)); an idle core holding its SimConnect connection and its listener is unmeasured.
  - The desktop app's start covers a host who starts a session before the sim runs ([invite code](../product/03-v1-scope.md#invite-code)).
- **Leaves out:**
  - what the core and the other components do while no session runs, which [node 1.1.2](plan.md#112-components-with-no-session) designs
  - a pilot who has quit the watcher or turned it off, which [installing and updating](../product/03-v1-scope.md#installing-and-updating) allows, so that nothing starts the core with the sim until they open the desktop app
  - when the core exits

## The watcher keeps the BlurPage copy current

- **Decided:** the watcher, not the core, makes our copy of the sim's BlurPage component from the sim's own file, watches that file, and makes the copy again whenever the file's hash differs from the one the copy was made from.
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
  - Unfreezing once the core stops needs code that outlives the core and can reach the aircraft: the watcher has no SimConnect link, since it notices the sim from the operating system ([01-spine](01-spine.md#components)), and our WASM module runs inside the sim.
  - Our probe module, `crosscheck-p12-follow`, held a figure in its seat from inside the sim's frame ([avatars log](../avatars/log.md#2026-10-03-nose-up-and-right-wing-down-are-negative-and-turned-by-full-attitude-a-wasm-written-figure-holds-its-seat)), and the product's figures need the same module.
- **Leaves out:** whether the following aircraft itself, written from outside the sim, stutters in flight, which nobody has flown, and we won't, because nothing would be gained (user, 2026-10-07).

## The core catches the take-control key and buttons

- **Decided:** the core reads the pilot's keyboard and flight hardware through Windows' input APIs, by way of the helper it starts ([below](#the-cores-input-and-audio-work-runs-in-a-helper-it-starts)), rather than mapping the input through SimConnect.
  Settled in node 1.1 by the user, 2026-10-07, and the helper in node 1.3 by the user, 2026-10-08.
- **Because:**
  - Pilots bind the key or a hardware button in Crosscheck's settings, as a single press or a long press ([take-control key](../product/03-v1-scope.md#take-control-key)), so Crosscheck needs each press and release.
  - A shortcut API in the desktop app, such as Electron's `globalShortcut`, which reports no release (documented in fsc-editor, `docs/sim-vars/08-marks.md`), would stop whenever the pilot closes the optional desktop app.
  - SimConnect's input mapping takes an event for the press and one for the release (read in MSFS 2024 SDK 1.7.3, `SimConnect.h`, `SimConnect_MapInputEventToClientEvent_EX1`), and the user ruled it out as a hack (user, 2026-10-07).
  - Through Raw Input in sink mode, with the sim in front, a Rust helper got all 3 Page Down presses a person made, and 22 changes of a flight-hardware button's state in 10s, named by its device's vendor and product ID (measured on MSFS 2024, 2026-10-09, [architecture log](log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)).

## The core runs Crosscheck's audio

- **Decided:** the core captures the pilot's microphone and runs the speech recognizer, captures the ATC app's audio by process, and plays ATC and Crosscheck's own sounds on the device the pilot picks, in the helper the core starts ([below](#the-cores-input-and-audio-work-runs-in-a-helper-it-starts)), so the desktop app stays optional.
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

- **Decided:** every page, the desktop app, and the helper send the core a message every 2s, and the core closes a socket it hasn't heard from in 8s, and restarts a helper it hasn't heard from in 8s.
  Settled in node 1.2 by the user, 2026-10-08, and the helper's messages in node 1.3 by the user, 2026-10-08.
- **Because:**
  - A page's socket doesn't close when the page goes away: a cockpit panel's was still open when the run ended 23s after the panel reloaded, and all 16 cockpit panels' were still open as the inspector stopped listing them after the pilot left the flight (measured on MSFS 2024, 2026-10-08, [interface log](../interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel)).
  - FS Copilot's panels give up on their app 8s to 10s after its last 2s renewal (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js`, `STATE_DEADMAN_MS` and its 2s watchdog), and a suspended process holds its sockets open and answers nothing (documented in the FS Copilot fork, `record/pointer-forwarding/docs/14-test-bench.md`, "Outages are made by suspending a process").
  - A hung helper's process doesn't exit, so only its messages stopping tells the core it hung.
- **Leaves out:** how long the sim keeps a socket open after its page is gone, past 23s.

## Cockpit panels connect only in a session, and only the ones in use stay

- **Decided:** the panel bridge in a cockpit panel connects when it hears that a session started, names the instruments it holds in its first message, and gets back the modules to load, and a panel the core gives nothing closes its socket.
  Settled in node 1.2 by the user, 2026-10-08.
- **Because:**
  - With no session, nothing watches the cockpit ([01-spine](01-spine.md#components-with-no-session)).
  - The exchange is cheap: one per panel at a session's start, 20 on the Baron, whose cockpit has 20 panels ([interface log](../interface/log.md#2026-10-04-an-ai-copy-of-the-pilots-aircraft-opens-its-livery-painting-and-none-of-its-cockpit-gauges)).
  - A first message from every panel tells the core the panel bridge loaded at all, which it doesn't when another package's `VCockpit.js` override wins ([installing and updating](../product/03-v1-scope.md#installing-and-updating)) or our own bridge fails to parse ([CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel)).

## The EFB app's code opens the banner panel

- **Decided:** in a session, the EFB app's code opens the banner panel when the core says the session has something to show, and closes it, by calling `TOOLBAR_BUTTON_TOGGLE` from the EFB's document.
  Crosscheck ships no script in the toolbar's document.
  This changes [03-v1-scope](../product/03-v1-scope.md#notification-banner), whose banner depends on a script that our toolbar icon puts into the toolbar.
  Settled in node 1.5 by the user, 2026-10-09.
- **Because:**
  - From our package installed in the Community folder, with no Build and Mount, the EFB app's code opened the panel and closed it again, 177s and again 279s after Ready to fly, and each call resolved; the toolbar listed the panel open, the inspector listed its page, and screenshots showed its card (measured on MSFS 2024, 2026-10-09, [interface log](../interface/log.md#2026-10-09-installed-from-the-community-folder-our-toolbar-script-loads-at-the-flight-load-and-it-and-our-efb-apps-code-each-open-the-banner-when-the-client-asks-over-the-commbus)).
  - The EFB app's code runs from the sim's start with the EFB closed ([interface log](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)), so it's there whenever the core has something to show.
  - A toolbar script did the same in the same run, but it reaches the toolbar's document through markup in our toolbar icon, which the toolbar runs, a trick a sim update could stop ([interface log](../interface/log.md#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click)), and it would be one more component to ship and watch (user, 2026-10-09).
- **Leaves out:** opening the panel during a flight load, before Ready to fly, and after a second flight load in one run of the sim, which no run has tried ([01-spine](01-spine.md#left-open)); and how the banner shows in VR, which waits for a headset ([the product plan](../product/plan.md#6-probes-that-retire-architecture-risks)).

## The core accepts a WebSocket only with the sim's Origin or none

- **Decided:** the core accepts a WebSocket whose `Origin` is `coui://html_ui` or missing, and refuses every other, and the desktop app connects from its Rust side.
  Settled in node 1.2 by the user, 2026-10-08, and the desktop app's side in node 1.3 by the user, 2026-10-08, with the desktop app a Tauri app.
- **Because:**
  - Every page we use sent `coui://html_ui`, all 14 in the main menu and all 32 in the A2A PA-24's flight (measured on MSFS 2024, 2026-10-08, [interface log](../interface/log.md#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one)); no other aircraft's pages were tried.
  - A Tauri app's pages sent `http://tauri.localhost`, as RFC 6455 requires of a browser client, and its Rust side, through tokio-tungstenite 0.30.0, sent no `Origin`, which the RFC allows a client that isn't a browser (measured on our development machine, 2026-10-08, [architecture log](log.md#2026-10-08-a-tauri-2-window-takes-723-mb-of-memory-over-seven-processes-against-electrons-665-mb-over-four-its-program-is-80-mb-against-3474-mb-and-its-rust-sides-websocket-sends-no-origin); [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455#section-4.1), section 4.1).
  - Any page in a browser on the PC can open a WebSocket to 127.0.0.1 ([06-04](../../learn/foundations/06-04-websockets-to-localhost.md#websockets-from-a-panel-to-localhost), its traps), so without the check, a page the pilot happens to have open could join them to a stranger's session or take control of their aircraft.
    Chrome may ask the pilot first for the local network (unverified, as of 2026-10-08), and the check doesn't rely on it.
- **Leaves out:**
  - a web page the pilot wants to connect, which a one-time approval or a token could let in later ([01-spine](01-spine.md#left-open))
  - a program on the PC, which can send any `Origin` and could do worse anyway

## Apps outside the sim find the core through a port file

- **Decided:** the core writes its port, its process ID, and its process's creation time, the `FILETIME` that `GetProcessTimes` gives, to a file in its data folder, and a core that finds the file naming a core that's still running, with that ID and that creation time, exits, so one core runs for each data folder.
  The desktop app reads the port there, and starts the core when the file names no running process with that ID and creation time; the watcher reads the process ID and creation time, and shows the CPU and memory use of the process that matches both beside its own.
  Settled in node 1.2 by the user, 2026-10-08, and the creation time in node 1.2 by the user, 2026-10-09, after node 1's walk through a session reopened it.
- **Because:**
  - The desktop app and the watcher hold no SimConnect connection, so the CommBus can't reach them.
  - A development core gets a data folder of its own, so it runs beside the pilot's, each with its own ports and identity, as [the product plan](../product/plan.md#7-tech-stack-and-architecture) asks.
  - A crashed core leaves its port file behind, and a process's ID "may be reused" once "all handles to the process are closed and the process object is freed" (documented, [PROCESS_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_information)), so the ID alone could name another program, and a restarted core could find it and exit.

## The watcher reads what its jobs need from files the core writes

- **Decided:** beside the port file, the core writes what the watcher's jobs need: the date of the pilot's last session, the file changes of each plugin it fetched and checked, and which plugins the pilot lets change files.
  The watcher reads them, and opens no socket to the core.
  Settled in node 1.2 by the user, 2026-10-09, after node 1's walk through a session reopened it.
- **Because:**
  - The watcher warns of a waiting update only if the pilot flew lately ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), and applies plugins' file changes before the sim boots, which the pilot can turn off ([plugins](../product/03-v1-scope.md#plugins)), while the core, which knows both, may not be running ([01-spine](01-spine.md#components-with-no-session)).
- **Leaves out:** how recent a last session has to be for the watcher to warn, which [installing and updating](../product/03-v1-scope.md#installing-and-updating) leaves open.

## The core keeps the pilot's settings

- **Decided:** the core keeps the pilot's settings in its data folder, such as the take-control binding, the output device, the recording mode, and which plugins may change aircraft files, and reads them when it starts.
  The desktop app edits them by command, and decides nothing ([01-spine](01-spine.md#components)); the EFB app offers no setting in v1 ([EFB app](../product/03-v1-scope.md#efb-app)).
  [03-v1-scope](../product/03-v1-scope.md#efb-app)'s settings stay in the desktop app as the place a pilot edits them, and the core keeps their values.
  Settled in node 1.1 by the user, 2026-10-09, after node 1's walk through a session reopened it.
- **Because:**
  - The desktop app is optional, and a pilot in VR flies with it closed, while the core still needs the bound key ([take-control key](../product/03-v1-scope.md#take-control-key)), plays ATC "on the output device each pilot picks, with no window needed" ([hearing ATC](../product/03-v1-scope.md#hearing-atc)), and records in the mode a setting chooses ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
  - The desktop app and the EFB app show Crosscheck's state and send it commands, and decide nothing ([04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client)), so the values the core acts on live with the core rather than in a file of the desktop app's.
- **Leaves out:** the watcher's own settings, such as whether it starts with Windows, which the watcher keeps ([installing and updating](../product/03-v1-scope.md#installing-and-updating)).

## The core writes the WASM module's control slot every 200ms

- **Decided:** in a session, the core writes the WASM module's control slot every 200ms, with the session's state and a counter, and each kind of message has a SimConnect client data area, a data slot, of its own.
  The module leaves its version in a slot when it loads, and writes a counter every second.
  Settled in node 1.2 by the user, 2026-10-08.
- **Because:**
  - The module can't open a socket, so data slots are its link ([05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md#simconnect-from-inside-a-module)).
  - FS Copilot's app writes its module's control slot every 200ms (read in the FS Copilot fork, `FsCopilot/Connection/SimClient.cs`, the constructor), and its module unfreezes after 1s with none, which we've flown with ([our WASM module writes the following aircraft](#our-wasm-module-writes-the-following-aircraft)).
  - Whether two writes to one slot in one frame both arrive is unmeasured ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits)), so no two kinds of message share a slot.
  - A slot keeps its last value after its writer stops (documented, same chapter), so only a counter that moves tells the core the module is still running.

## Crosscheck is written in Rust, and in TypeScript where an engine runs it

- **Decided:** the core, the helper, the watcher, the desktop app's program, and the WASM module are Rust.
  TypeScript is for the code in Coherent GT, the desktop app's pages, plugins and the profile's write functions, and the backend ([01-spine](01-spine.md#language-and-toolchains)).
  The core reaches the sim through the SDK's own `SimConnect.dll`, and runs plugins and write functions in QuickJS-ng, embedded through rquickjs, with memory and time limits; the desktop app is a Tauri app; and the WASM module is built with Navigraph's cargo-msfs and packaged by our own script.
  The Rust code's bindings to the SDK are generated from the SDK's headers, and the Rust components share one crate that defines the messages they trade.
  Settled in node 1.3 by the user, 2026-10-08.
- **Because:**
  - The user chose Rust for every component a JavaScript engine doesn't run (user, 2026-10-08).
  - At the main menu, a Rust client on the SDK's own `SimConnect.dll` did what the core does there: it connected, traded calls with mainUi over the CommBus, followed a system event, and traded data slots with our module (measured on MSFS 2024, 2026-10-08, [architecture log](log.md#2026-10-08-a-rust-program-on-the-sdks-own-simconnectdll-connects-to-msfs-2024-trades-commbus-calls-with-mainui-follows-system-events-and-trades-data-slots-with-our-rust-module)).
  - A standalone module built by cargo-msfs ran on MSFS 2024 at the main menu and traded data slots with a SimConnect client (measured on MSFS 2024, 2026-10-08, [architecture log](log.md#2026-10-08-a-standalone-module-built-from-rust-with-cargo-msfs-and-packaged-by-our-own-script-runs-on-msfs-2024-and-trades-data-slots-with-a-simconnect-client-once-its-simconnect-handle-is-64-bits-wide)).
  - A Rust helper did the helper's Windows input and audio work, built with Visual Studio's linker (measured on our development machine, 2026-10-08, [architecture log](log.md#2026-10-08-a-rust-program-captures-one-processs-audio-plays-on-a-device-it-looks-up-by-name-and-receives-keyboard-and-hid-input-through-raw-input-in-sink-mode-and-builds-with-visual-studios-linker)).
  - A Rust program showing only a tray icon took a fortieth of the memory Electron's processes took for the same (measured on our development machine, 2026-10-08, [architecture log](log.md#2026-10-08-a-tray-icon-alone-costs-10-mb-of-memory-in-rust-16-mb-in-net-native-aot-51-mb-in-winforms-and-397-mb-over-three-processes-in-electron)).
  - Embedded in Rust, QuickJS-ng held its memory and time limits as built, with the host running on, while V8's process died on an endless allocation unless TurboFan was off, and Node's `vm` module has no memory limit (measured on our development machine, 2026-10-08, [architecture log](log.md#2026-10-08-embedded-in-rust-quickjs-runs-100-write-functions-a-frame-in-75µs-idles-under-1-mb-and-holds-its-memory-and-time-limits-while-v8s-memory-limit-failed-until-turbofan-was-off)).
  - A Tauri window took about the memory of an Electron one, with a program a fortieth of the size, and its Rust side's WebSocket sends no `Origin` (measured on our development machine, 2026-10-08, [architecture log](log.md#2026-10-08-a-tauri-2-window-takes-723-mb-of-memory-over-seven-processes-against-electrons-665-mb-over-four-its-program-is-80-mb-against-3474-mb-and-its-rust-sides-websocket-sends-no-origin)).
  - The module's hand-written bindings gave `HANDLE` the wrong width for the SDK's WebAssembly headers, and nothing reported it until the sim's calls failed (measured on MSFS 2024, 2026-10-08, [architecture log](log.md#2026-10-08-a-standalone-module-built-from-rust-with-cargo-msfs-and-packaged-by-our-own-script-runs-on-msfs-2024-and-trades-data-slots-with-a-simconnect-client-once-its-simconnect-handle-is-64-bits-wide)), so no type is copied by hand.
  - The user chose TypeScript for the code a JavaScript engine runs: the sim's pages, the desktop app's pages, plugins and write functions, and the backend (user, 2026-10-06 and 2026-10-08), and Coherent GT, WebView2, QuickJS-ng, and a Cloudflare Worker each run the JavaScript it compiles to.
  - In a flight, a Rust client on the SDK's `SimConnect.dll` masked the elevator ahead of Accu-Sim with a group it took as the sim booted, created AI objects with liveries, read the camera, read, set, and heard an input event, called a cockpit panel over the CommBus, and followed the flight load's flow events, and our Rust module echoed every slot write the client made, both on declarations bindgen generated from the SDK's headers (measured on MSFS 2024, 2026-10-09, [architecture log](log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)).
- **Leaves out:**
  - a build without Visual Studio's linker, which failed with Rust's own tools ([01-spine](01-spine.md#the-helper))
  - the relay's language ([01-spine](01-spine.md#language-and-toolchains)), and the choices that stay inside one part ([01-spine](01-spine.md#left-open))

## The core's input and audio work runs in a helper it starts

- **Decided:** the core's work with Windows input and audio, through Raw Input, the microphone, ATC capture, playback, and the speech recognizer, runs in the helper, a program of its own.
  The core starts the helper in a session and while the desktop app binds a key or lists the output devices, starts it again if it exits, and talks to it over its standard input and output.
  Settled in node 1.3 by the user, 2026-10-08.
- **Because:**
  - A crash in that code, such as in a speech recognizer's C or C++ library, takes the core down if it runs in the core's process, and the pilot out of the session until the watcher restarts the core and they rejoin ([01-spine](01-spine.md#the-helper)), while the core restarts a helper that crashes, and the session goes on.
  - Our probes read Raw Input from a program they start, line by line over its standard output ([mouse.mjs](../../../experiments/tools/mouse.mjs)).
- **Leaves out:** the fields of the helper's messages, which the crate the Rust components share defines for both ends ([01-spine](01-spine.md#messages-between-components)), and their binary format, a choice inside the core and the helper ([01-spine](01-spine.md#left-open)).

## Plugin code runs only in the core

- **Decided:** a plugin is TypeScript that implements an interface of ours and runs only in the core, in QuickJS-ng embedded there under memory and time limits ([above](#crosscheck-is-written-in-rust-and-in-typescript-where-an-engine-runs-it)), and it reaches the cockpit panels, the WASM module, the sim, and the pilot's files only through APIs our own code carries out.
  Nothing a plugin ships runs in a panel or in the module: for something inside the sim's frame, our module offers mechanisms the plugin drives, such as writing given variables every frame, running given calculator code, or placing an object, and for something in a panel, our panel bridge offers generic operations.
  The changes a plugin makes to an aircraft's files are files and patches that the watcher applies.
  This changes [04-room-for-later](../product/04-room-for-later.md#code-inside-the-sim), which gives plugins hooks in the panels and in the WASM module that load their modules by name, and answers [03-v1-scope](../product/03-v1-scope.md#plugins)'s question of where each part of a plugin runs.
  Settled in node 1.3 by the user, 2026-10-08.
- **Because:**
  - Plugins implement a framework API, the way a class implements an interface, and their code runs only in the core's engine; when a plugin needs something done in panel code, we offer the API, and our own panel code carries it out (user, 2026-10-08).
  - Crosscheck's own code owns each mechanism, and a plugin owns the policy, and code that serves one product lives in a plugin, never in Crosscheck's own code ([04-room-for-later](../product/04-room-for-later.md#plugins)), so frame logic and panel code for one aircraft stay out of our module and our panel bridge.
  - Our generic panel code keeps the fail-open rules for anything in the pilot's input path ([CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel)), whatever a plugin asks of it.
  - A plugin that's only JavaScript and data can reach pilots apart from Crosscheck's releases ([below](#profiles-and-plugins-reach-pilots-apart-from-crosschecks-releases)), while the WASM module and the panel bridge load only when the sim boots or a panel loads.
  - The watcher applies file changes before the sim boots, usually while the core isn't running ([01-spine](01-spine.md#components-with-no-session)), so code that runs only in the core couldn't make them.
- **Leaves out:**
  - which APIs our panel bridge and module offer, for the part that designs plugins; the Baron 58P's plugin is the first case, and its profile settles what it needs ([plugins](../product/03-v1-scope.md#plugins))
  - a plugin that needs logic inside the frame beyond what calculator code expresses, which no v1 plugin is known to need

## Profiles and plugins reach pilots apart from Crosscheck's releases

- **Decided:** profiles and plugins update apart from Crosscheck's releases.
  The core fetches each, checks its signature against a key its own release carries, and pins one version of each, by hash, for a session; nothing changes mid-session.
  Each profile and plugin declares the version of our plugin API it needs, and the core refuses one that needs a newer Crosscheck.
  A pilot whose machine lacks the version the session pinned fetches it by its hash.
  A plugin's changes to aircraft files take effect at the next sim start, when the watcher applies them.
  This changes [03-v1-scope](../product/03-v1-scope.md#plugins), whose plugins ship and update with Crosscheck, and settles the spine's question of whether profiles reach pilots apart from Crosscheck's releases.
  Settled in node 1.3 by the user, 2026-10-08.
- **Because:**
  - If profiles and plugins shipped in releases, every fix to one would take a new Crosscheck.
    A pilot installs a new Crosscheck only with the sim closed, and pilots on different versions can't fly together, so after each fix two pilots couldn't fly until both had closed the sim to install it (user, 2026-10-08; [installing and updating](../product/03-v1-scope.md#installing-and-updating)).
  - The [preflight match check](../product/03-v1-scope.md#preflight-match-check) already compares each profile's version and hash, and the profile registry, a Later pick, would fetch a profile by that hash ([04-room-for-later](../product/04-room-for-later.md#profiles)).
  - Plugin code runs only in the core ([above](#plugin-code-runs-only-in-the-core)), so the core can load a new version whenever a session isn't using the old one.
- **Leaves out:** where profiles and plugins are served from, how their signing keys are kept, how often the core checks for new versions, and how the plugin API version relates to Crosscheck's, for [node 4](plan.md#4-profiles-and-plugin-delivery) of the architecture plan.

## Sessions and pilots are named by random UUIDs, carried as text where JSON or TypeScript reads them

- **Decided:** a session's ID and a pilot's ID are each a version 4 UUID, which has 122 random bits.
  The host's core draws the session's when it starts the session, and each pilot's core draws theirs when they start or join a session, and keeps it through every rejoin of it; each crosses as its lowercase text wherever JSON or TypeScript reads it.
  A run of the sim is named by its process's ID and the time the process was created.
  This answers [03-v1-scope](../product/03-v1-scope.md#recording-and-bug-reports)'s question of what form the session's ID takes, and [02-live-sync](../sync/02-live-sync.md#when-two-pilots-change-one-entry)'s of a pilot ID's form.
  Settled in node 1.4 by the user, 2026-10-09.
- **Because:**
  - The user chose 122 random bits over 64 for the margin against two sessions sharing an ID (user, 2026-10-09).
    As text, an ID costs 36 characters each time it crosses: once per join or link, in every message on a link that carries several senders' messages, and in every message if the vector clocks name each counter by ID ([01-spine](01-spine.md#ids)).
  - `BigInt` was missing from the one cockpit panel's document we probed for it, and a JavaScript number holds every integer exactly only up to 2^53, which our QuickJS-ng run showed, so a 128-bit ID can't cross as a JavaScript number ([01-spine](01-spine.md#ids)).
  - The invite code can't name a session for a bug report, since a later session can draw the same six characters ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
  - A process's ID "may be reused" once "all handles to the process are closed and the process object is freed" (documented, [PROCESS_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_information)), so the ID alone can't tell one run of the sim from the next.
- **Leaves out:** how the cores pack each vector clock counter's key, by pilot ID and restart count or by place in the member list ([01-spine](01-spine.md#left-open)).

## A pilot keeps their ID through a core restart, and the core counts its restarts

- **Decided:** the core keeps a session file in its data folder, from when the pilot starts or first joins a session until they press Leave session, the session ends for them after 5 minutes cut off, or the core learns the session has ended.
  The file holds the session's ID and invite code, the pilot's ID, the core's restart count, and the run of the sim the pilot was in.
  The restart count goes up by 1 each time the core starts while the file exists, and the core flushes the raised count to disk before it opens any link.
  Between cores, every message is named by its sender's pilot ID, restart count, channel, and number: a link that carries only its sender's messages names the pilot ID and restart count once, as it opens, and a link that carries several senders' messages carries them with each message; a receiver keeps what it knew of a sender's numbers when its link opens again with the same count, and starts them afresh when it sees a higher count for that sender, on a link that opens with it or on a message that carries it.
  In the vector clocks, each counter belongs to a pilot's ID and a restart count.
  This changes [02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order)'s and [04-room-for-later](../product/04-room-for-later.md#people-beyond-the-crew)'s one counter per pilot, and gives 02-live-sync's message ID its form.
  A core that restarts while the sim keeps running rejoins the pilot under the same ID and replays what they missed; one whose sim restarted too rejoins them under the same ID as a late joiner.
  This settles node 1.4's question of what a pilot's identity is across a core restart ([architecture plan](plan.md#14-shared-conventions)).
  Settled in node 1.4 by the user, 2026-10-09.
- **Because:**
  - A receiver drops a message it has already applied ([02-live-sync](../sync/02-live-sync.md#keeping-a-change-from-applying-twice)), so a receiver that didn't know a core restarted would take its messages, numbered from 1 again, for copies of old ones.
    A link back from an outage under the same count is the same core, whose replay the receiver dedupes against the numbers it kept.
  - FS Copilot made a restarted app a new peer, and the fix its pre-PR review settled on lived with three limits: up to one acknowledgment interval of events could apply twice on a restarted peer, a restarted sender's history was gone, and a new third person got a replay they didn't need (documented in the FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, R03); the third doesn't arise in Crosscheck, since a first join catches up state ([01-spine](01-spine.md#the-session-file-and-a-core-that-restarts)).
  - [The connection](../product/03-v1-scope.md#the-connection) reconnects a returning pilot from session state saved on their machine, and replays what they missed if their sim kept running; the user chose that a crashed core does the same (user, 2026-10-09).
  - A core could instead save the number of each message it sends and go on numbering after a restart, but that puts a disk write ahead of every send, where the restart count costs one write per start.
- **Leaves out:**
  - how a restarted core recovers everything the sync engine held only in memory, and gets the others the changes its pilot made that never reached them, for the part that designs sync ([01-spine](01-spine.md#left-open))
  - how each channel tells a copy from a late message, for the part that designs sync and the node on how the cores reach each other ([01-spine](01-spine.md#left-open))
  - how the conflict rule orders two changes from one pilot under two restart counts, which comparing pilot IDs can't, for the part that designs sync ([01-spine](01-spine.md#left-open))
  - what a core does when it starts and finds a session file after being down long enough that its pilot may have been cut off for more than 5 minutes ([01-spine](01-spine.md#left-open))
  - what a core that restarts mid-flight gives up by registering its masks after the aircraft loaded ([01-spine](01-spine.md#left-open))

## A time in a message is µs on the sender's PC's monotonic clock

- **Decided:** every stamp in a message, the moment a value was read, is a whole number of µs on Windows' `QueryPerformanceCounter` on the sender's PC, whose ticks become µs through `QueryPerformanceFrequency`, and every span in a message is a whole number of µs, whatever clock measured it.
  The conversion to µs runs in 128 bits, so it doesn't overflow on a PC that has run for weeks.
  A value is stamped when it's read, and the core stamps each message from a page in the sim or a plugin, and each value it requests through SimConnect, as it arrives, since a page can't read the counter, and the clocks a plugin can read, QuickJS-ng's `Date.now()` and `performance.now()`, aren't shown to count the same ticks; a page that needs a span measures it on its own clock and sends the span.
  The core stamps each data-slot write from our WASM module as it arrives, unless the flight-model sync has the module stamp on WASI's monotonic clock, which counts the counter's ticks from an origin near the sim's start (measured on MSFS 2024, 2026-10-09, [architecture log](log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)), so its stamps reach the core's timeline through one offset per run of the sim.
  A receiver reads a sender's stamps through an offset it keeps estimating for that sender.
  No frame count crosses between machines: a pace in frames counts the frames of the machine that runs it.
  Wall-clock time, in UTC, appears in a message only where a person reads it, and in the session file only inside a run's name, which the core compares and never measures with.
  Settled in node 1.4 by the user, 2026-10-09.
- **Because:**
  - `QueryPerformanceCounter` counts from the PC's start, gives consistent readings across processes, never goes backward, and ignores changes to the system clock, while a stamp on the wall clock moves when Windows sets that clock (documented, [Acquiring high-resolution time stamps](https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps)); so a restarted core goes on along the timeline it left.
  - Two PCs' counters can part by about 8.6s a day when both crystals sit 50 ppm off in opposite directions, before Windows compensates at start, and how far they part in practice is unmeasured ([01-spine](01-spine.md#times)), so one offset estimated once doesn't hold.
  - A stamp, counted in µs from the PC's start, fits a JavaScript number exactly for about 285 years ([01-spine](01-spine.md#times)).
  - Each sim runs its own frames ([08-01](../../learn/foundations/08-01-replication-models-and-authority.md#replication-models-state-input-lockstep-hybrid)), so a frame on one machine names no moment on another.
  - Samples stamped as they arrived carried the network's jitter into our traffic work's paths ([08-05](../../learn/foundations/08-05-position-and-clocks.md#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate)), and fsc-editor's values stamped as they were parsed landed 0ms to 3ms apart, in the order they were parsed (measured on MSFS 2024, 2026-08-24, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-24 — The right answer was being sorted last for arriving 2 ms early").
- **Leaves out:** how the offset is estimated, what a higher restart count does to it, and how far two PCs' counters part in practice, for the flight-model sync and the node on how the cores reach each other; whether the module stamps on its own clock, which event sets that clock's 0, and how the core estimates its offset, for the flight-model sync; how far the core's arrival stamp trails the sim's read for a page's message; and which clock a page measures a span on ([01-spine](01-spine.md#left-open)).

## Messages are defined in one Rust crate: JSON typed by ts-rs for TypeScript, fixed-width structs in data slots, and length-prefixed binary to the helper

- **Decided:** over a WebSocket, into a plugin, and both ways between the desktop app's Rust side and its pages, as a string each side parses, a message is JSON that serde_json writes, and the TypeScript sides take their types from ts-rs, generated from the crate that defines the messages, with ts-rs's large-integer setting at `number`, which types `i64`, `u64`, `i128`, and `u128` alike, so an integer field that can pass 2^53 crosses as text, as the IDs do.
  In a data slot, a message is a struct of fixed-width fields, with its size and field offsets asserted in the crate, which builds for x86_64 and wasm32.
  Over the helper's standard input and output, a message is binary and prefixed with its length.
  Settled in node 1.4 by the user, 2026-10-09.
- **Because:**
  - ts-rs's types, with its large-integer setting at `number`, took every message serde_json wrote, the plugin that answered them type-checked, and each of five wrong messages was refused; specta did the same only with two opt-ins, `PhasesFormat` and a `specta_typescript::Number` mark on each 64-bit field, and only as a release candidate; and typeshare refused a `u64` until each was marked `serialized_as = "U53"`, then refused an internally tagged enum, which we found no opt-in for (measured on our development machine, 2026-10-09, [architecture log](log.md#2026-10-09-ts-rs-with-64-bit-integers-set-to-numbers-generates-typescript-that-matches-what-serde_json-sends-specta-needs-two-opt-ins-typeshare-cant-express-our-messages-and-the-data-slots-keep-one-layout-on-x86_64-and-wasm32)).
  - A format written twice drifts: fsc-editor writes its module's wire format in TypeScript and in C++, and "nothing but `src/main/sim/link.test.ts` notices when the two" drift (read in fsc-editor, `link/README.md`).
  - Coherent GT parses JSON with no library of ours, at no frame time we could measure in the PA-24's cockpit panels (measured on MSFS 2024, 2026-10-08, [01-spine](01-spine.md#the-sims-pages)).
  - The desktop app's Rust side and its pages trade serde_json's text as a string, which each side parses, so each reads the same text p07 checked ts-rs's types against, whatever Tauri does with a value it serializes itself ([01-spine](01-spine.md#messages-and-their-types)).
  - The data slots' structs kept one layout on x86_64 and wasm32, while a struct with a pointer-sized field didn't (measured on our development machine, 2026-10-09, [architecture log](log.md#2026-10-09-ts-rs-with-64-bit-integers-set-to-numbers-generates-typescript-that-matches-what-serde_json-sends-specta-needs-two-opt-ins-typeshare-cant-express-our-messages-and-the-data-slots-keep-one-layout-on-x86_64-and-wasm32)).
- **Leaves out:** the encoding between cores, for the node on how the cores reach each other; whether the desktop app's pages and its Rust side trade the messages' text through Tauri's commands or its events, and whether tauri-specta types the command calls; and the choices inside the crate's build ([01-spine](01-spine.md#left-open)).

## Every first message carries one version number and a hash of the message crate

- **Decided:** the watcher, the core, the helper, the desktop app, and the Community package, with the WASM module in it, carry one version number, which the build writes into each from one place.
  Each first message, the module's version slot, and each pilot's join carry that version and a hash of the message crate, both as text.
  A core refuses a join whose version or hash differs from its own, and on one machine the core logs a component whose version or hash differs from its own.
  Settled in node 1.4 by the user, 2026-10-09.
- **Because:**
  - Crosscheck's programs and its package update together, as one version, and pilots on different versions can't join each other ([installing and updating](../product/03-v1-scope.md#installing-and-updating)).
  - A version number nothing reads drifts: fsc-editor's package version sat at 0.0.1 while its module's reached 0.3.0, until its build derived one from the other ([05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md#protocol-versioning-between-the-app-and-the-module-packed-structs)).
  - Two development builds can carry one version number with different messages, and the hash tells them apart, as FS Copilot's check of a hash of each packet type refuses a peer whose types differ ([09-05](../../learn/foundations/09-05-versions-and-security.md#serialization-protocol-versioning-and-compatibility-between-app-versions)).
- **Leaves out:**
  - pilots on different versions flying together, which v1 doesn't offer ([installing and updating](../product/03-v1-scope.md#installing-and-updating)) and which would need a version both sides speak rather than equal ones
  - how the build hashes the message crate, which has to cover each message's encoding as well as its fields ([01-spine](01-spine.md#left-open))
  - what the core does with a component on its own machine whose version or hash differs from its own, beyond logging it, for the part that designs the core ([01-spine](01-spine.md#left-open))

## The core runs on tokio

- **Decided:** the core's Rust code runs its sockets, timers, and other waiting work on tokio, the async runtime.
  Its WebSocket library is a choice inside the core, which accepts a connection only with the `Origin` it allows ([above](#the-core-accepts-a-websocket-only-with-the-sims-origin-or-none)) and can listen beyond the PC, off by default ([01-spine](01-spine.md#left-open)).
  Settled in node 1.6 by the user, 2026-10-09.
- **Because:**
  - The core holds many connections at once, about 20 cockpit panels' sockets on top of the desktop app's, the network, and its uploads ([01-spine](01-spine.md#communication)), and an async runtime runs them on a few threads where blocking code would hold one thread for each.
  - Tauri, the desktop app's framework, runs on tokio: "Tauri uses tokio Runtime to initialize code" (documented, [tauri::async_runtime](https://docs.rs/tauri/latest/tauri/async_runtime/index.html), tauri 2.12.2, as of 2026-10-09).
  - The desktop app's Rust side reached a WebSocket server through tokio-tungstenite 0.30.0, which runs on tokio (measured on our development machine, 2026-10-08, [architecture log](log.md#2026-10-08-a-tauri-2-window-takes-723-mb-of-memory-over-seven-processes-against-electrons-665-mb-over-four-its-program-is-80-mb-against-3474-mb-and-its-rust-sides-websocket-sends-no-origin)).
- **Leaves out:** the core's WebSocket library, for the core's stage of step 8 ([01-spine](01-spine.md#left-open)).

## The desktop app's pages are React, built with Vite and styled with Tailwind

- **Decided:** the desktop app's pages are TypeScript and React, built with Vite and styled with Tailwind.
  They share no interface with the EFB app, only TypeScript logic and the types ts-rs generates from the message crate.
  Settled in node 1.6 by the user, 2026-10-09.
- **Because:**
  - fsc-editor, our last desktop app, is built that way, on React 19, Vite 7, and Tailwind 4 (read in fsc-editor, `package.json`).
  - Tauri "is frontend agnostic and supports most frontend frameworks out of the box", and recommends Vite for React (documented, [Tauri's frontend configuration](https://v2.tauri.app/start/frontend/), as of 2026-10-09).
  - The EFB app is its own app on the sim's EFB framework, not the desktop app reused ([03-v1-scope](../product/03-v1-scope.md#efb-app)), so its interface is built from that framework's FSComponent components, which are class-based and don't re-render on new props ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)), and the desktop app's choice of framework doesn't reach it.
- **Leaves out:** nothing; the shared logic's compiling is settled [below](#our-code-in-the-sim-is-type-checked-against-es2017-and-bundled-by-esbuild-at-es2017).

## Our interface in the sim is built on the MSFS Avionics Framework

- **Decided:** the EFB app and the banner panel draw their interface with the MSFS Avionics Framework's FSComponent, in TypeScript, and the EFB app registers with the sim's EFB through Asobo's EFB API.
  The banner panel bundles our own copy of `@microsoft/msfs-sdk`, pinned to one exact version, not the copy the sim provides.
  Settled in node 1.6 by the user, 2026-10-09.
- **Because:**
  - The framework is Microsoft's, Asobo's, and Working Title's library for glass cockpits in Coherent GT, and the SDK says many of MSFS 2024's own aircraft use it (documented, [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)).
  - Shipping EFB apps are built on it: A2A's tablet is TSX on Asobo's EFB API and the framework (read in a2a-aircraft-aerostar600 1.0.6, `A2ATabletApp.js`; [03-v1-scope](../product/03-v1-scope.md#efb-app)), and our own probe apps registered through the EFB API and drew with the copy of the framework the sim provides, its global `msfssdk` (measured on MSFS 2024, 2026-10-06 and 2026-10-09, [interface log](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)).
  - Its components don't re-render on new props, and state reaches the page through values that update it directly ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)), which suits an interface showing state the core streams to it.
  - One way of drawing serves both of our pages in the sim, while the desktop app's pages stay React ([above](#the-desktop-apps-pages-are-react-built-with-vite-and-styled-with-tailwind); user, 2026-10-09).
  - The framework's authors pin and ship their own copy: Working Title's G1000 pins `@microsoft/msfs-sdk` 2.4.3 and copies it into its own folder, while the copy the sim provides can change with a sim update, and the framework's license is MIT, for use only in Microsoft Flight Simulator ([architecture log](log.md#2026-10-09-coherent-gts-makers-last-placed-its-engine-near-safari-101-the-msfs-avionics-framework-and-flybywire-compile-to-es2017-nobody-maintains-a-rule-set-for-the-engine-and-working-title-ships-its-own-pinned-copy-of-the-framework); user, 2026-10-09).
- **Leaves out:**
  - whether the EFB app can bundle our pinned copy too, since no run has registered an EFB app drawn with a second copy of the framework, which p08's EFB app rebuilt against a bundled copy settles ([01-spine](01-spine.md#left-open))
  - which version we pin, since 2.4.3 isn't on npm and 2.3.3 is its newest there as of 2026-10-09, and how the framework's versions track sim updates, which no document states, for the apps' stage ([01-spine](01-spine.md#left-open))

## Our code in the sim is type-checked against ES2017 and bundled by esbuild at es2017

- **Decided:** TypeScript checks the types of our code in the sim with its `lib` set to `DOM`, `DOM.Iterable`, `ES2017`, and `ES2021.WeakRef`, and esbuild bundles each page's code, our pinned framework included, at `es2017`.
  The EFB app and the desktop app's pages share TypeScript logic and ts-rs's types, compiled this way for the EFB app.
  Settled in node 1.6 by the user, 2026-10-09.
- **Because:**
  - Coherent GT parses all of ES2017 and object rest, and no other syntax from ES2018 on, and has every ES2015 to ES2017 built-in we tried and `WeakRef`, and no other from ES2018 on of its own (measured on MSFS 2024, 2026-10-09, [architecture log](log.md#2026-10-09-coherent-gt-parses-all-of-es2017-and-object-rest-but-no-other-syntax-from-es2018-on-has-no-built-in-from-es2018-on-of-its-own-but-weakref-and-runs-typescript-compiled-to-es2017-by-tsc-and-by-esbuild)).
  - A module using `?.`, `??`, `??=`, class and `#private` fields, object spread and rest, and a numeric separator, bundled by esbuild 0.28.2 at `es2017`, ran in the EFB's document and a cockpit panel and passed each of its checks, as it did compiled by TypeScript 7.0.2 (same entry).
  - The framework compiles to `es2017` with the same `lib`, and FlyByWire and every other project we read compile to `es2017` or near it (read, [architecture log](log.md#2026-10-09-coherent-gts-makers-last-placed-its-engine-near-safari-101-the-msfs-avionics-framework-and-flybywire-compile-to-es2017-nobody-maintains-a-rule-set-for-the-engine-and-working-title-ships-its-own-pinned-copy-of-the-framework)).
  - esbuild applies its target to every file it bundles, packages included, while the framework's own pipeline compiles only its own files with TypeScript and has Rollup bundle them with no second compile (read in microsoft/msfs-avionics-mirror, its main branch on 2026-10-09, `src/sdk`), so an npm package that pipeline bundled would reach Coherent GT as its author wrote it.
  - esbuild refused FlyByWire's `safari11` target for an object rest in a parameter ([architecture log](log.md#2026-10-09-coherent-gt-parses-all-of-es2017-and-object-rest-but-no-other-syntax-from-es2018-on-has-no-built-in-from-es2018-on-of-its-own-but-weakref-and-runs-typescript-compiled-to-es2017-by-tsc-and-by-esbuild)), so `es2017` is the target both compilers take.
- **Leaves out:** whether the framework's `for`-`of` rewrite, which esbuild can't run, pays for itself in our interface ([01-spine](01-spine.md#left-open)).

## A tool of our own checks every file we ship into the sim against Coherent GT's measured limits

- **Decided:** every JavaScript file we ship into the sim, experiments' files included, passes a check run after every edit and in CI.
  The check parses each file at ECMAScript 2017, with the pattern of each regex literal and of each `new RegExp(...)` given a fixed string, and fails any use of a built-in or web API [Coherent GT's JavaScript](coherent-gt.md) lists as missing or filled in only in some documents.
  It's a tool of its own, holding that list as one data file, built for our needs in a repository of its own under Crosscheck's GitHub organization, and published as it is, for anyone to use, without support.
  Settled in node 1.6 by the user, 2026-10-09.
- **Because:**
  - Step 7 asks for a check that every file run in Coherent GT, experiments included, parses within the engine's measured limits, run in CI and after edits ([the product plan](../product/plan.md#7-tech-stack-and-architecture)), and nobody maintains a rule set for the engine we could use instead ([architecture log](log.md#2026-10-09-coherent-gts-makers-last-placed-its-engine-near-safari-101-the-msfs-avionics-framework-and-flybywire-compile-to-es2017-nobody-maintains-a-rule-set-for-the-engine-and-working-title-ships-its-own-pinned-copy-of-the-framework)).
  - A syntax error takes out the whole file, and `node --check` passes the syntax the engine rejects, such as `?.` ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits)).
  - Neither TypeScript 7.0.2 nor esbuild 0.28.2 makes the regex features from ES2018 on work: TypeScript leaves them as written and flags some, and esbuild hides each in a `new RegExp(...)` call that a check of its output can't see (measured on our development machine, 2026-10-09, [architecture log](log.md#2026-10-09-coherent-gt-parses-all-of-es2017-and-object-rest-but-no-other-syntax-from-es2018-on-has-no-built-in-from-es2018-on-of-its-own-but-weakref-and-runs-typescript-compiled-to-es2017-by-tsc-and-by-esbuild)).
  - TypeScript's DOM types declare web APIs the engine lacks, such as `ResizeObserver`, ES5's lib declares `Intl`, which the engine lacks too, and the sim's own scripts fill in some built-ins in some documents only (same entry).
  - Other MSFS projects have no such check either, and the user wants ours usable by them without our supporting it (user, 2026-10-09).
- **Leaves out:** a regex built from a pattern computed at run time, which a parse can't see; and how the tool is built, for the build's stage of step 8 ([01-spine](01-spine.md#left-open)).

## Every pair of cores holds one QUIC connection through iroh 1.3, directly or through our relays

- **Decided:** each core runs one iroh 1.3 endpoint, its key kept in the core's data folder, and holds one QUIC connection to every other core in the session.
  iroh makes the connection directly when hole punching gets through both pilots' routers, and through one of our relays when it doesn't, and moves it between the two.
  No core forwards another's messages, QUIC's TLS 1.3 encryption stays on, and Crosscheck builds nothing for encryption.
  This answers how the cores reach each other, which the spine leaves to node 2 ([01-spine](01-spine.md#between-machines)), and picks [02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order)'s link between every pair.
  Settled in node 2 by the user, 2026-10-11 ([01-between-machines](../network/01-between-machines.md)).
- **Because:**
  - iroh finds paths, opens router ports, and relays with no glue of ours, where ICE through `is` with TURN and quinn needs about 2,500 to 4,000 lines by an agent's estimate ([network log, 2.1][n21]).
  - Across two friends' home networks and ours, every connection between real routers went direct, and iroh's relay and its move to the relay met the user's pass lines ([network log, 2.3][n23]).
  - Two endpoints in two processes on one PC each drew their own endpoint ID and ports and connected directly in 2.2ms ([network log, p04][p04]).
- **Leaves out:** Wi-Fi, carrier-grade NAT, double NAT, and mobile links, which no run has covered and v1's recordings count ([01-between-machines](../network/01-between-machines.md#the-way-through-home-routers)).

## Our relays run iroh-relay unmodified, in at least two regions

- **Decided:** a relay runs n0's `iroh-relay`, in Rust, with nothing of ours on it, in at least two regions, and the app lists the relays as a setting.
  Each pilot homes at the relay with the lowest latency, as iroh picks it.
  This settles the relay's language ([01-spine](01-spine.md#between-machines)), and changes [01-aims](../product/01-aims.md#relay-and-license)' one relay.
  Settled in node 2 by the user, 2026-10-11.
- **Because:**
  - iroh's relay carries packets over TCP, and a lost packet held back the ones behind it longer the farther the sender was from the relay: at 3% loss, 53ms at p99 at 22ms away and 534ms at 131ms ([network log, 2.3][n23]).
  - iroh makes the relay with the best latency over the last 5 minutes its home, and moves only for one under two-thirds of the current one's (read in iroh 1.3.0, `src/net_report.rs`, `add_report_history_and_set_preferred_relay`).
- **Leaves out:** who hosts the relays, our own servers or n0's managed relays, which changes nothing else; and a pair on two continents, whose sender's leg stays long whatever relays run ([01-between-machines](../network/01-between-machines.md#the-relays)).

## The backend matches invite codes to the crew's endpoints

- **Decided:** the backend draws each invite code and keeps the session's crew under it, each pilot with their endpoint ID and home relay.
  Each core refreshes its place every 60s, the backend counts a pilot out after 5 minutes with no refresh and frees the code once the crew is empty, and it tells a core that starts with a session file whether its pilot is still in the crew.
  A core accepts a connection only from an endpoint ID its crew lists.
  The backend's requests and answers are the message crate's, as JSON, and the relays speak only iroh's protocol.
  This changes the spine, which gave invite codes and introductions to the relay ([01-spine](01-spine.md#components)), and answers its questions of what a core does with a session file found after a long outage, and whether the relay's and the backend's messages are the crate's ([01-spine](01-spine.md#left-open)).
  Settled in node 2 by the user, 2026-10-11.
- **Because:**
  - A stock relay keeps code of ours off the relays, so n0's releases or n0's managed relays drop in unchanged (user, 2026-10-11).
  - The session file holds no time the core measures with, and the backend times the gap since a core's last refresh on its own clock ([01-between-machines](../network/01-between-machines.md#a-session-file-after-a-long-outage)).
  - iroh's handshake checks the accepting core's key against the endpoint ID the dialer asked for and has the dialer sign with its own key (read in iroh 1.3.0, `src/tls/verifier.rs`).
- **Leaves out:** what the backend runs on, for which the spine's candidate is a Cloudflare Worker ([01-spine](01-spine.md#components)).

## Each channel rides a stream or one-off packets, as its delivery needs

- **Decided:** the session and cockpit channels ride a stream from each sender, the session's above the cockpit's, and traffic's identities ride one below the cockpit's.
  Flight-model samples, avatar poses, traffic samples, and ATC audio frames ride one-off packets, which QUIC sends ahead of every stream.
  Every message between cores is postcard, and each channel but the cockpit's tells a copy from a late message by the rule [01-between-machines](../network/01-between-machines.md#channels-on-the-connection) gives it.
  Each core keeps the last 5 minutes of what it sent on the session and cockpit streams, and resends after an outage what the other hadn't applied.
  This answers the spine's questions of how the cores pack a message and how each channel other than the cockpit's tells a copy from a late message ([01-spine](01-spine.md#left-open)).
  Settled in node 2 by the user, 2026-10-11.
- **Because:**
  - postcard packed every v1 message smallest but one, with a stable wire format and serde's derives ([network log, 2.2][n22]).
  - QUIC builds each packet from what's waiting, one-off packets first, so messages handed over together share one packet's headers (read in noq-proto 1.3.0, `src/connection/mod.rs`, `populate_packet`).
  - Two kinds of message share an ordered channel only if neither is hurt by waiting behind the other ([04-room-for-later](../product/04-room-for-later.md#channels)).
- **Leaves out:** how the cockpit channel tells a copy from a late message, for node 3; and which fields each message carries, for node 3 and the flight-model sync ([network log, 2.2][n22]).

## A direct path silent for 2s gives way to the relay, and a core silent for 5s counts as cut off

- **Decided:** iroh's path idle timeout is 2s and its path keep-alive 0.67s, and the core sends no copies over a second path.
  Through a short gap, the following machine carries the aircraft on its last velocities and eases it to the true position when samples come again.
  A core that has heard nothing from another for 5s, a starting value, counts it silent, and tells which of the two was cut off by whether it still reaches its own home relay and the backend; it keeps dialing until the 5-minute cut-off.
  This answers how a core learns another core went quiet ([01-spine](01-spine.md#how-the-core-knows-a-component-is-alive)) and which ways to soften a short gap v1 builds ([the connection](../product/03-v1-scope.md#the-connection)).
  Settled in node 2 by the user, 2026-10-10 and 2026-10-11.
- **Because:**
  - iroh moved to the relay 2.0s after the direct path died, every time, and samples came again through the relay at once; no move happened that a drop didn't cause ([network log, 2.3][n23]).
  - One friend's router forgot an idle port within 30s (same entry).
  - iroh sends on one path at a time ([network log, 2.1][n21]).
- **Leaves out:** tuning the 5s and the 2s from v1's recordings; how far the following machine carries the aircraft and how it eases, for the flight-model sync; and who holds control when two cores each take the other for cut off, for node 3 ([01-between-machines](../network/01-between-machines.md#how-a-core-learns-another-went-quiet)).

## A receiver estimates each sender's clock offset from one timed exchange a second

- **Decided:** each core times one exchange a second with each other core on the session stream, takes the offset as NTP does, ½[(T2 − T1) + (T3 − T4)], from the exchange with the shortest round trip of the last 8, and starts afresh when the sender's restart count rises.
  This answers the spine's questions of how a receiver estimates a sender's offset, what a higher restart count does to it, and how far two PCs' counters part ([01-spine](01-spine.md#left-open)).
  Settled in node 2 by the user, 2026-10-11.
- **Because:**
  - 2.3 estimated each PC's counter against our droplets through the shortest of each eight exchanges, and the estimates scattered by 95µs to 211µs ([network log, 2.3][n23]).
  - The three PCs' counters ran from 13.1 ppm slow to 25.6 ppm fast, so two parted by up to 39 ppm, 3.4s a day (same entry), and an estimate 8s old is off by 0.3ms at that rate (arithmetic).
- **Leaves out:** the error when a connection's two directions take unequal times, which is half the difference, and how the take-control key's rule that the earlier press wins copes with it, for node 3 ([01-between-machines](../network/01-between-machines.md#clock-offsets)).

[n21]: ../network/log.md#2026-10-10-iroh-13-leads-for-carrying-a-session-between-home-pcs-provided-its-tcp-relays-stalls-dont-show-and-its-switch-to-the-relay-can-be-made-fast
[n22]: ../network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does
[n23]: ../network/log.md#2026-10-10-iroh-moves-to-the-relay-one-path-idle-timeout-after-a-direct-link-dies-and-back-within-60s-and-at-3-loss-its-tcp-relays-p99-lateness-grows-with-the-round-trip-to-the-relay-from-53ms-at-22ms-away-to-534ms-at-131ms
[p04]: ../network/log.md#2026-10-11-two-iroh-endpoints-in-two-processes-on-one-pc-each-with-its-own-key-and-ports-connect-directly-over-the-pcs-own-address
