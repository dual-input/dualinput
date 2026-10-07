# Architecture: tentative decisions

What the architecture's nodes have settled for now, each with the findings behind it and what it leaves out.
Each one holds until the parent of the node that settled it is done, and then becomes a numbered decision in `record/decisions/`, as [the plan](plan.md#where-answers-go) says.

## The core starts with every sim run

- **Decided:** the watcher starts the core whenever the sim starts, every time, and the desktop app starts it when the pilot opens the app and the core isn't running.
  Nothing in the sim starts the core.
  Settled in node 1.1 by the user, 2026-10-07.
- **Because:**
  - A mask registered before the A2A PA-24 loaded got ahead of the aircraft's own, and one registered after it loaded didn't ([flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)).
    A core that starts after the flight loads couldn't hold back input on such an aircraft for soft takeover or mixed flight controls ([04-room-for-later](../product/04-room-for-later.md#an-input-layer)).
  - Code in the sim reaches a program on the PC only if that program is already listening on 127.0.0.1 ([interface log](../interface/log.md#2026-10-05-an-efb-app-the-toolbar-and-in-game-panels-each-reach-a-program-on-the-same-pc-by-websocket-and-http-and-can-show-a-page-it-serves)), and we found no way for a panel to start one (unverified).
    A start button in the EFB app would need the watcher to listen and start the core, which is more than the watcher should do (user, 2026-10-07).
  - An idle Node process took 29 MB of memory and no measurable CPU (measured on our development machine, 2026-10-06, [the product plan](../product/plan.md#7-tech-stack-and-architecture)).
  - The desktop app's start covers a host who starts a session before the sim runs ([invite code](../product/03-v1-scope.md#invite-code)).
- **Leaves out:**
  - what the core and the other components do while no session runs, which [node 1.1.2](plan.md#112-components-with-no-session) designs
  - whether the core can take its masking place at sim start without holding back the pilot's controls, which [node 1.1.1](plan.md#111-masking-priority-at-sim-start) probes

## The watcher keeps the BlurPage copy current

- **Decided:** the watcher, not the core, makes our copy of the sim's BlurPage component from the sim's own file, and makes it again whenever the stock file's hash differs from the one the copy was made from.
  Settled in node 1.1 by the user, 2026-10-07.
- **Because:** the sim loads a package only when it boots ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), so the copy has to be right before the sim starts, while the core isn't running, and the watcher runs then.
  The documents that name the core predate the watcher (user, 2026-10-07).
- **Leaves out:** a sim update that changes `fs-base-ui` while the sim boots, after the watcher's check, which nobody has run ([interface log](../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly)).

## The core works out where the figure's hand goes

- **Decided:** on the clicking pilot's machine, the core reads the aircraft's models, the camera, and the cursor, and finds each hand's point.
  This changes the avatars' tentative decision that the desktop app does it ([avatars decisions](../avatars/decisions.md#the-clicking-pilots-machine-finds-the-point-and-the-other-machine-only-draws-it)).
  Settled in node 1.1 by the user, 2026-10-07.
- **Because:**
  - The desktop app and the EFB app show Crosscheck's state and send it commands, and decide nothing ([04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client)), and a hand worked out in the desktop app would stop whenever the app is closed.
  - The avatars' decision was made before Crosscheck was split into a core and apps.
  - Our avatar probes read the pilot's mouse from a program outside the sim through Windows' Raw Input in sink mode, which sits in nobody's input path ([mouse.mjs](../../../experiments/tools/mouse.mjs)).

## Our WASM module writes the following aircraft

- **Decided:** on a following machine, our WASM module freezes the aircraft, writes the flying machine's pose and velocities inside the sim's frame, and unfreezes the aircraft when the core goes quiet.
  Settled in node 1.1 by the user, 2026-10-07.
- **Because:**
  - FS Copilot's module does this, drawing the flying machine 400ms in the past, and unfreezes the aircraft after 1s with no word from its app (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`), and we've flown with it (from our experience with FS Copilot).
  - [Flight-model sync](../product/03-v1-scope.md#flight-model-sync) unfreezes the aircraft within about 1s once Crosscheck stops, which needs code that outlives the core, inside the sim.
  - The module already places the figures inside the sim's frame ([avatars log](../avatars/log.md#2026-10-03-nose-up-and-right-wing-down-are-negative-and-turned-by-full-attitude-a-wasm-written-figure-holds-its-seat)).
- **Leaves out:** whether writes from outside the sim would serve, which we didn't measure, because nothing would be gained (user, 2026-10-07).

## The core catches the take-control key and buttons

- **Decided:** the core reads the pilot's keyboard and flight hardware itself, through Windows' input APIs, with native code where Node has no API, and doesn't map the input through SimConnect.
  Settled in node 1.1 by the user, 2026-10-07.
- **Because:**
  - Pilots bind the key or a hardware button in Crosscheck's settings, as a single press or a long press ([take-control key](../product/03-v1-scope.md#take-control-key)), so Crosscheck needs each press and release.
  - Electron's `globalShortcut` reports no release (documented in fsc-editor, `docs/sim-vars/08-marks.md`), and it lives in the desktop app, which is optional.
  - Our avatar probes read the mouse's presses and releases from a program outside the sim, with the sim in front, through Raw Input in sink mode ([mouse.mjs](../../../experiments/tools/mouse.mjs)).
- **Leaves out:** whether the native code runs in the core's own process or in a process the core supervises, which node 1.3 settles.

## The core runs Crosscheck's audio

- **Decided:** the core captures the pilot's microphone and runs the speech recognizer, captures the ATC app's audio by process, and plays ATC and Crosscheck's own sounds on the device the pilot picks, with native code where Node has no API, so the desktop app stays optional.
  Settled in node 1.1 by the user, 2026-10-07.
- **Because:**
  - Hearing ATC and the handover cues play with no window open, so a pilot in VR hears them ([hearing ATC](../product/03-v1-scope.md#hearing-atc)).
  - FS Copilot captured the ATC app by process with WASAPI's process loopback and played it back from its desktop process (read in the FS Copilot fork, `FsCopilot/Audio/`; measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 3: the audio path works on one machine — Q10, Q12, Q13 settled").
- **Leaves out:**
  - which recognizer, which the voice phrases' build researches and tests ([the product plan](../product/plan.md#6-probes-that-retire-architecture-risks))
  - whether the native code runs in the core's own process or in a process the core supervises, which node 1.3 settles
