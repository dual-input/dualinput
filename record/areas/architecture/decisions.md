# Architecture: tentative decisions

What the architecture's nodes have settled for now, each with the findings behind it and what it leaves out.
Each one holds until the parent of the node that settled it is done, and then becomes a numbered decision in `record/decisions/`, as [the plan](plan.md#where-answers-go) says.
The watcher and the core are the two processes in [step 7 of the product plan](../product/plan.md#7-tech-stack-and-architecture), and the flying and following machines are defined in [03-v1-scope](../product/03-v1-scope.md).

## The core starts with every sim run

- **Decided:** the watcher starts the core whenever the sim starts, and the desktop app starts it when the pilot opens the app and the core isn't running.
  No code in the sim, such as a panel or the EFB app, starts the core.
  Settled in node 1.1 by the user, 2026-10-07.
- **Because:**
  - A mask registered before the A2A PA-24 loaded got ahead of the aircraft's own, and one registered after it loaded didn't ([flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)).
    A core that starts after the flight loads couldn't hold back input on such an aircraft for soft takeover or mixed flight controls ([04-room-for-later](../product/04-room-for-later.md#an-input-layer)).
  - A group that took its priority as the sim started, held open by an event it only listened to, masked the PA-24's elevator ahead of Accu-Sim once the axis was added after the flight loaded, and held nothing back until then; SimConnect answered before the main menu loaded its aircraft ([flight-controls log](../flight-controls/log.md#2026-10-07-a-group-that-takes-its-priority-as-the-sim-starts-held-open-by-an-event-it-only-listens-to-masks-ahead-of-accu-sim-once-it-adds-the-axis)).
  - The watcher takes over the helpers the sim would launch ([the product plan](../product/plan.md#7-tech-stack-and-architecture)), so it, rather than a helper the sim launches, starts the core early enough.
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

- **Decided:** the core reads the pilot's keyboard and flight hardware itself, through Windows' input APIs, with native code where Node has no API, and doesn't map the input through SimConnect.
  Settled in node 1.1 by the user, 2026-10-07.
- **Because:**
  - Pilots bind the key or a hardware button in Crosscheck's settings, as a single press or a long press ([take-control key](../product/03-v1-scope.md#take-control-key)), so Crosscheck needs each press and release.
  - Electron's `globalShortcut` reports no release (documented in fsc-editor, `docs/sim-vars/08-marks.md`), and it lives in the desktop app, which is optional.
  - SimConnect's input mapping takes an event for the press and one for the release (read in MSFS 2024 SDK 1.7.3, `SimConnect.h`, `SimConnect_MapInputEventToClientEvent_EX1`), and the user ruled it out as a hack (user, 2026-10-07).
- **Leaves out:** whether Raw Input in sink mode delivers a keyboard key's and a flight-hardware button's presses and releases with the sim in front, which only the mouse has shown ([mouse.mjs](../../../experiments/tools/mouse.mjs)); and whether the native code runs in the core's own process or in a process the core supervises, which node 1.3 settles.

## The core runs Crosscheck's audio

- **Decided:** the core captures the pilot's microphone and runs the speech recognizer, captures the ATC app's audio by process, and plays ATC and Crosscheck's own sounds on the device the pilot picks, with native code where Node has no API, so the desktop app stays optional.
  Settled in node 1.1 by the user, 2026-10-07.
- **Because:**
  - ATC and the handover cues play with no window open, so a pilot in VR hears them ([hearing ATC](../product/03-v1-scope.md#hearing-atc)).
  - FS Copilot's desktop process captures the ATC app by process with WASAPI's process loopback and plays it back (read in the FS Copilot fork, `FsCopilot/Audio/`), and the fork's `tools/AtcAudio` captured BeyondATC that way in a live flight (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 3: the audio path works on one machine — Q10, Q12, Q13 settled").
- **Leaves out:**
  - the choice of recognizer, which the voice phrases' build researches and tests ([the product plan](../product/plan.md#6-probes-that-retire-architecture-risks))
  - whether the native code runs in the core's own process or in a process the core supervises, which node 1.3 settles
