# Product: ideas

These are the ideas for what Crosscheck might do.
Each entry opens with the idea, then gives its technical risk under Tech, its value to pilots under Product, and what's unknown under Open questions and Next, leaving out a label with nothing to say.
When a finding changes how an idea looks, its entry changes and cites the finding.
When we pick an idea, it gets its own area under `record/areas/`, its entry here links there, and that area's plan holds its status.
The ideas we turned down or set aside are under [Ideas left out](#ideas-left-out), each with the reason, so nobody proposes one again without knowing why it went.

## Sync

### State sync with variables and events

Each change to a switch, knob, or lever travels to the other machine, as it does in FS Copilot and YourControls ([01](../../learn/foundations/01-prior-art-and-crew-practice.md#prior-art)).
The other ideas build on it.
Its design is in [01-profile-entries](../sync/01-profile-entries.md), [02-live-sync](../sync/02-live-sync.md), and [03-catch-up](../sync/03-catch-up.md): a control's new value crosses the wire, and the receiving machine sets it the way its aircraft needs, reads it back, and brings the cockpit up to date after a drop.

### Pointer sync

A press on a panel display travels as the position the pointer went to, and the receiving display decides what's there.
In our FS Copilot fork this drove the A220's SVG displays, which syncing the name of the clicked element can't reach (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - Q03 PASSES: a synthetic mouse click drives a React/SVG display").
It's our leading candidate for syncing panels, pending a decision in `record/decisions/`.
Crosscheck would also show which pilot is working which display, such as "FO on the MCDU", so the other pilot keeps off it.

- **Tech:** WASM displays need more than a forwarded position, which [WASM instrument sync](#wasm-instrument-sync) covers.
  When both pilots type on one display at once, each machine would apply the keys in a different order (unverified, [08-06](../../learn/foundations/08-06-divergence-and-one-screen.md#unverified-claims)).

### Bus bridge

Crosscheck listens to the messages an aircraft's parts send each other on the CommBus and in client data areas, and to state-sharing calls its vendor built in, such as the A220's `A22X.Resync` below, and carries them to the other machine.
A profile, the file that tells Crosscheck what to sync on one aircraft, names what to listen to, and the [Crosscheck IDE](#crosscheck-ide), the tool authors build profiles in, finds those names.

- **Tech:** reading the CommBus from panel JavaScript works, and what it yields depends on the aircraft.
  The Synaptic A220 puts its whole cockpit's state there, the A2A PA-24 doesn't use it, and the iniBuilds A350 uses it only between its modules, its electronic flight bag (EFB), and its printer (measured on MSFS 2024, 2026-09-28, and read in the aircraft's files, 2026-09-30, [CommBus log](../commbus/log.md)).
  Some aircraft hand over their full state on request, which a pilot joining mid-flight needs.
  Sending `A22X.Resync` made each of the A220's 29 change-sending channels send a full snapshot, 1,674 fields in about 100ms (measured on MSFS 2024, 2026-09-28, [CommBus log](../commbus/log.md#2026-09-28-a22xresync-returns-the-a220s-full-state-and-one-listener-hears-every-channel)).

- **Open questions:** our CommBus work covers reading.
  Whether a message carried to the other machine changes that aircraft's state, rather than only what its displays draw, is the next question.

### EventBus bridge

Avionics built on the MSFS Avionics Framework share state between instruments.
A topic published with the `sync` flag goes out once a frame as JSON under the key `wt.eb.evt`, and a new instrument's bus publishes `resync_request` to have every synced topic sent again (read in the A220's DisplayUnits bundle, [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)).
Carrying that key between machines, limited to the topics that belong to the aircraft rather than to one machine, could sync flight plans and flight management system (FMS) state for every avionics suite built on the framework, such as the G1000 NXi, G3000, and WT21, without a profile entry per aircraft.

- **Tech:** our own listener in the EFB's document hears all five of the Phenom 300E's G3000 buses, whose topics include settings, pane commands, and a flight plan's edits (measured on MSFS 2024, 2026-10-06, [CommBus log](../commbus/log.md#2026-10-06-our-own-code-hears-wtebevt-from-the-efbs-document-and-the-g3000-acts-on-a-package-it-sends)).
  A package it sends as another bus reaches them: one carrying the MFD's zoom-in moved the MFD's map (same entry).
  A listener inside an instrument's document misses that instrument's own bus (same entry).
- **Product:** large if it works, because the FMS is where shared-cockpit tools fall short: YourControls syncs the keypresses on a flight management computer, not its state ([01](../../learn/foundations/01-prior-art-and-crew-practice.md#prior-art)).
- **Next:** carry the topics between two machines, and find which belong to the aircraft rather than to one machine, starting with a flight plan's `fplsync_` topics.

### WASM instrument sync

Some displays drawn by WASM code can take a forwarded press.
The iniBuilds A380's displays pressed at the position we sent once we told the display the mouse had entered it (measured on MSFS 2024, 2026-09-23, FS Copilot fork, `record/wasm-pointer/docs/log.md`, "2026-09-23 — The A380 presses where we say once the display is told the mouse entered it; the A350 does not").
The A350's display ignores the position we send and presses wherever the receiving pilot's own cursor is on that display (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 — A WASM gauge presses whatever the REAL cursor hovers, ignoring the coordinates we send").
Reaching it takes a patch to the module that nobody has written, which an A350 [plugin](#plugins) could make on the pilot's machine ([decision 001](../../decisions/001-changing-other-developers-packages.md)).

- **Next:** design how a production version does this, and find which aircraft's displays it reaches.

### Plugins

A plugin is code we ship for one aircraft or one add-on.
It finds state a profile can't reach, exports it as values the profile watches, registers the write methods that set them, and reaches the rest through hooks into Crosscheck, so Crosscheck's own code never names a product.
Its scope for v1, with one plugin for the 58P, is in [03-v1-scope](03-v1-scope.md#plugins), and what Crosscheck builds for plugins is in [04-room-for-later](04-room-for-later.md#plugins).

- **Tech:** a plugin for GSX could show GSX's ground vehicles and people on every machine and play its sound, as traffic sync and hearing ATC carry traffic and ATC, rather than have each machine's GSX run the same service.
  Our fork listed and spawned 11 of 11 ground vehicles, among them GSX's tugs, fuel trucks, and catering trucks, and Asobo's baggage carts, though nobody judged how they look when driven (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · First visual replay; engines, pushback, ground vehicles").
  A GSX person walks when we write the animation variable of its own object (measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-writing-a-gsx-persons-animation-frame-makes-it-walk-and-a-seated-one-moves-on-its-own)), and GSX's program, `Couatl64`, owns an audio session of its own (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Picking the ATC app: what the API allows").
  With different GSX versions on two machines, we expect the worst case to be a vehicle missing from one pilot's view, rather than a service that never runs (unverified).
- **Open questions:** what the GSX plugin has to handle, left until we build it: two pilots calling the same service each on their own machine, taking GSX's objects over from traffic sync, the vehicles' own animations, and control passing during a pushback.

### Aircraft adapters

An adapter is a [plugin](#plugins) for one aircraft that reaches state no variable or event shows and puts it in Crosscheck's state for that aircraft, so a cockpit can catch up on it.
As a plugin, it may change its aircraft's files on the pilot's machine ([decision 001](../../decisions/001-changing-other-developers-packages.md)).
The A220's display formats live in its DisplayUnits' Redux store (read in synaptic-aircraft-a220 1.0.10, `html_ui/Pages/VCockpit/Instruments/a22x/DisplayUnits/instrument.js`), and the PMDG 777 loads a panel-state file when a flight loads (unverified; loading a flight and comparing its cockpit with the package's `Config\PanelState\` files settles it).

- **Tech:** code Crosscheck injects into the A220's display documents might reach the store at runtime without changing the aircraft's files (unverified; a panel probe that looks for the store from a DisplayUnits document settles it).
  Writing into another developer's store can break what their code derives from it, so an adapter would copy narrow parts, such as the current display format.
  Whether the 777 loads a panel state mid-flight is untested, though its CDU loads one by name (unverified; loading one from the CDU in flight settles both).
  The [bus bridge](#bus-bridge) is a related route: the A220's `A22X.Resync` returns its full state over the CommBus.
- **Product:** a late joiner's display pages and FMS would match the PF's, which [catch-up](../sync/03-catch-up.md) can't reach.

### Traffic sync

The traffic one pilot's sim shows appears in the other's, on the same principles as our FS Copilot fork's traffic work (FS Copilot fork, `record/traffic-atc/docs/01-design.md`).

- **Tech:** our FS Copilot fork carried one app instance's traffic to a second instance on the same sim and replayed it smoothly, after fixing echo, relay drops, and duplicate packets (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 4, traffic: what the app needed that the prototype did not").

### Ground operations sync

Pushback, jetways, the fuel truck, and GSX show on both machines, so both pilots see the pushback they asked for.

- **Tech:** the sim's own services start from key events, such as `K:TOGGLE_JETWAY` and `K:TOGGLE_PUSHBACK`, and GSX is a separate addon with its own `L:FSDT_GSX_*` variables; the iniBuilds A350 uses both (read in inibuilds-aircraft-a350 1.2.6, [A350 study](../aircraft/inibuilds-a350/study.md)).
  Showing the tug on the other machine is a [traffic sync](#traffic-sync) problem.
  The sim's own services are the same on every aircraft, so they belong in Crosscheck's own code, while GSX is one product, so it comes through a [plugin](#plugins).
  Until ground operations sync is built, [traffic sync](03-v1-scope.md#traffic-sync) sets who flies a pushback.

### ATC sync

ATC audio captured on one machine plays on the other, as in our FS Copilot fork's traffic and ATC work (FS Copilot fork, `record/traffic-atc/docs/01-design.md`).
A tester asked for the reverse too: the other pilot's mic reaching ATC.

- **Tech:** our FS Copilot fork captured BeyondATC's audio by process and played it back about 130ms later, plus the network delay (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 3: the audio path works on one machine — Q10, Q12, Q13 settled").
- **Open questions:** capturing by process reaches any ATC app that runs as its own process, but the sim's own ATC plays from the sim's process with the rest of its sound (unverified).
  Sending the other pilot's mic to VATSIM, SayIntentions, or BeyondATC is an integration for each.
  How a pilot chooses when their mic goes to ATC: a push-to-talk key in Crosscheck, a toggle in [Crosscheck's interface](#crosschecks-interface-in-the-efb-and-on-a-tablet), or the aircraft's audio panel where its profile maps one.

### Environment sync

Time, date, sim rate, pause, and weather match on both machines.

- **Tech:** how to set the weather from outside the sim in MSFS 2024 is unknown, and Active Sky would be its own integration.
- **Product:** weather changes more than the view.
  The wind on the navigation display comes from each machine's own weather, so with different weather the other pilot reads a different wind (unverified).

## Session

### The PF's spot on the world map

When a pilot joins a session, Crosscheck's Join takes their sim from wherever it is to the PF's airport and stand, in the PF's aircraft and livery, and on to Ready to fly.
In v1, preflight's Go to button does only the world map's part, and the pilot starts the flight ([03-v1-scope](03-v1-scope.md#preflight)).
It replaces loading the host's flight on every machine with `SimConnect_FlightLoad`, which [Ideas left out](#ideas-left-out) explains.

- **Tech:** code in the menu's document, which we ran through the sim's inspector, makes the world map's own requests: the airport search sets the departure, `game/currentFlight/setDepartureTaxiIndex` the stand, `game/aircraft/configurator/setAircraftForConfigurator` the aircraft, `game/aircraft/configurator/saveVariationId` the livery, and `game/currentFlight/launchFlight` starts the flight, which loaded at the stand it was given (measured on MSFS 2024, 2026-10-05, [interface log](../interface/log.md#2026-10-05-code-in-the-menus-document-sets-the-world-maps-departure-stand-aircraft-and-livery-and-starts-the-flight)).
  A package of ours puts a script there through its own copy of the sim's BlurPage component, which the core would make on the pilot's machine from the sim's own file, so the copy never falls behind a sim update.
  From a closed sim, with nobody at it, that script went through Start, Free flight, the departure, stand, aircraft, and livery, Fly, and Ready to fly, 164.5s from the launch, 132s of it the sim's boot (measured on MSFS 2024, 2026-10-06, [interface log](../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly)).
  Join has to start from wherever the pilot is: it reads which page is up, takes the next step from there, confirms each step arrived, and shows an error when one fails or the page is one it doesn't know, since nothing we found takes the menu home without the sim in front (user, 2026-10-06; [interface log](../interface/log.md#2026-10-06-code-in-the-menus-document-tells-which-page-is-up-and-nothing-we-found-takes-the-menu-home-without-the-sim-in-front)).
- **Next:** scope Join when the feature is built, after v1 (user, 2026-10-05).

### Preflight match check

Before a session starts, Crosscheck compares each pilot's aircraft package and version, warns when the liveries differ, and says how to fix what doesn't match.
The check leaves out Crosscheck's own version, which the connection checks, and fuel and payload, which sync throughout the flight.

- **Tech:** each package's version is in its `manifest.json`, which our aircraft studies already read.
  On livery N324DU the A220's DisplayUnits panel identifies itself as `DisplayUnits|config=N324DU`, while FS Copilot's profile matches only `DisplayUnits|config=Default`, so by our reading, not yet flown, that display syncs on no other livery, which is why the check compares liveries (measured on MSFS 2024, 2026-09-17, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-17 — The A220's DisplayUnits key carries the livery, and the profile names only Default").

### What doesn't sync

Crosscheck tells pilots what on their aircraft doesn't sync, from the aircraft's profile, so nobody is surprised when a knob doesn't move on the other side.

- **Open questions:** when pilots learn it, before the flight or when they touch the control, and how a profile records what we tried and couldn't sync.

### Pre-sync checklist

A profile carries a checklist of what the pilots line up before sync starts, such as "both panels start in the same state", and Crosscheck shows it before syncing begins.
So a session starts in two steps: the machines connect, and sync starts only when the pilots say they're ready.
A later version would watch the aircraft's state and tick an item off once both machines agree, such as a knob whose value Crosscheck can read but can only sync by turning it a step at a time.
It's Crosscheck's own setup list, unlike the aircraft's checklists under [Ideas left out](#ideas-left-out), and it covers the cockpit's state, where the [preflight match check](#preflight-match-check) covers packages and liveries.

- **Product:** serves the joiner and the first-time host in [02-users](02-users.md#roles-in-every-session), who can't tell why two machines differ.
- **Tech:** when preflight ends, every other cockpit takes the PF's value for every entry the profile can read or track ([03-catch-up](../sync/03-catch-up.md#when-preflight-ends)), so the checklist v1 needs holds only the starting values of the controls Crosscheck tracks by counting.
  A change a pilot other than the PF makes before then stays only if the profile doesn't hold that control.

### One-click invite

A pilot invites the other with a short code to paste into Discord.
When the other pilot copies the code and switches to Crosscheck, Crosscheck finds its own code on the clipboard and joins the session, so copying is the only step.
Two PCs on the same home network find each other without a code, and the connection shows in plain words, such as "Direct, 38ms" (hypothetical).

- **Tech:** Discord shows `crosscheck://join/<code>` as plain text, and again as plain text when it's written as a Markdown link (tested in Discord, 2026-10-02).
  We think Discord makes only http and https links clickable, whichever apps are installed (unverified).
  An invite link could still start with https, pointing to a static page, on GitHub Pages for example, that sends the browser on to `crosscheck://join/<code>`.
  The other pilot would then click past Discord's warning that the link leaves Discord and the browser's "Open Crosscheck?" prompt, which is more work than copying a code, so we expect to drop links in favor of codes.
  Crosscheck can tell its own code on the clipboard from anything else only if the code's format is distinctive, such as a fixed prefix.
- **Product:** a code also works in any chat app, and one pilot can read it out to the other over voice.
- **Open questions:** whether Crosscheck joins as soon as it finds a code or asks first, since an old code can sit on the clipboard from an earlier session.
  Whether Discord's own join invitations, which games send through Rich Presence, are open to an app that isn't a game.

### Telling the crew a sim crashed

When a pilot's sim crashes, the rest of the crew learns that it crashed, such as "James's sim crashed. Crosscheck rejoins him once he's back in a flight.", rather than seeing a dropped connection (user, 2026-10-07).
On the machine that crashed, the desktop app comes up with a Rejoin button, which starts the sim and puts the pilot back in the flight where the aircraft is, in the air if it's flying (user, 2026-10-07).

- **Tech:** the core is a process of its own that starts with the sim ([architecture's tentative decisions](../architecture/decisions.md#the-core-starts-with-every-sim-run)), and while a session is held it stays up after the sim closes ([architecture's spine](../architecture/01-spine.md#what-moves-them)), so it can tell the crew.
  The watcher notices the sim's process ending from the operating system ([the plan](plan.md#7-tech-stack-and-architecture)).
  In each of the 5 crashes in our records, our harness's SimConnect connection closed with no quit message before it, and Windows logged `FlightSimulator2024.exe` faulting with exception 0xc0000005 (measured on MSFS 2024, 2026-10-01, [crashes.tsv](../../../experiments/areas/aircraft/results/crashes.tsv) and the run reports it names).
- **Product:** the crew knows to wait for a pilot whose sim is restarting, rather than wondering whether the connection will come back.
- **Open questions:** how the core tells a crash from a pilot closing the sim or going back to the main menu.
  The SDK documents a quit message when the sim closes ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md)), and whether a normal close sends it before the connection closes is unmeasured; closing the sim once with a client attached settles it.
  Whether Rejoin can start a flight in the air, from the menu's script or another way, is untested.
- **Next:** a probe of starting a flight in the air, when we look into Rejoin (user, 2026-10-07).

## Control

### Voice handover

Control passes by the spoken exchange crews use:

1. The pilot flying (PF), whose controls fly the aircraft, says "you have control", which opens a window of a few seconds.
2. If another pilot says "I have control" inside the window, control passes to them.
3. The first pilot's closing "you have control" changes nothing, so Crosscheck doesn't wait for it.

A take-control key, button, or shortcut takes control at once, without voice.
The pilot taking control hears a recorded "you have control" as confirmation.
When control passes, [soft takeover](#soft-takeover-on-handover) starts.

- **Tech:** each machine listens only to its own pilot's mic, so nothing has to work out who spoke.
  Each machine listens for a few fixed phrases rather than transcribing speech, which small local models can do on a CPU, though whether they're accurate enough is unverified.
  Windows lets Discord and Crosscheck capture the same mic at once.
  Voice only completes a handover the PF started, so control moves by mistake only if both machines mishear, in order, inside the window.
- **Open questions:** accuracy with non-native English accents, which is the first thing to test.
  [03-v1-scope](03-v1-scope.md#voice-phrases) settles which phrases v1 accepts, from the conventions regulators, militaries, and airlines document.

### Soft takeover on handover

When control passes, the new PF's hardware throttle can sit far from the aircraft's throttle, and the aircraft's throttle jumps to match it.
Crosscheck ignores their axis until the lever crosses the aircraft's value, as MIDI controllers do in pickup mode, and shows where to move it.
Trim wheels and flap and gear levers on hardware have the same mismatch.

- **Tech:** masking the pilot's axis events holds them back from the sim on stock flight controls and on the PMDG 777 (measured on MSFS 2024, 2026-10-01, [log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)).
  On an aircraft whose module asks for the same priority, such as the A2A PA-24, it works only if Crosscheck's masks are in place before the aircraft loads ([log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)).
  Masking holds back the Black Square Baron's mixture, which the Baron takes through its own input event, when the lever is bound in MSFS (measured on MSFS 2024, 2026-10-06, [flight-controls log](../flight-controls/log.md#2026-10-06-masking-holds-back-a-mixture-lever-bound-in-msfs-and-not-one-spadnext-drives-because-spadnext-sets-the-input-event-itself)).
  It doesn't when SPAD.neXt drives the lever, because SPAD.neXt sets the input event itself and sends no key event to mask (same entry), so soft takeover needs another way to hold back a lever driven by a tool that sets input events.
  The pilot's own tool could hold it back (user, 2026-10-07): while the core holds back a lever, it sets a variable for that lever to 1, such as a hypothetical `L:CROSSCHECK_HOLD_THROTTLE_1`, and the pilot gives that lever's binding in SPAD.neXt or MobiFlight a condition that disables it while the variable is 1.
  It takes a variable for each lever, not one for all, because one flag on every binding would also switch off a yoke or rudder bound in the tool while a throttle waits to pick up.
  That both tools, and others such as FSUIPC and Axis and Ohs, can make a binding wait on an `L:` variable is unverified, and the tools' documentation or a binding tried in each settles it.
  An `L:` variable is global to the sim and keeps its value after the program that set it is gone, until the sim exits ([03-01](../../learn/foundations/03-01-units-and-variables.md)), so the WASM module sets each one back to 0 when it stops hearing from the core ([architecture's spine](../architecture/01-spine.md#what-moves-them)).
- **Product:** removes the thrust jump at handover.
- **Open questions:** a first scoping pass on 2026-10-03 proposed these, for review when soft takeover is scoped:
  - A lever picks up once it comes within a small tolerance of the aircraft's, rather than having to cross it, and a test on real hardware sets the tolerance.
  - Pickup covers the new PF's throttles, propellers, and mixtures, each on its own, their trim where it's an axis, and either pilot's flap axis at any time.
  - The yoke and rudder drive at once, because a yoke that waited to pick up could leave nobody flying the aircraft.
  - Whenever the aircraft's lever moves away from a pilot's hardware lever, that lever picks up again.
  - With pickup, the engine levers could be shared all the time rather than only the PF's: whichever pilot's picked-up lever moves drives the aircraft's lever, and the other pilot's drops out of pickup.
  - How the new PF learns which levers haven't picked up was left open.
  - Hardware switches that disagree with the aircraft's, such as a gear lever or a home cockpit panel's switches, are a separate problem, which [02-users](02-users.md#setups) names.

### Mixed flight controls

Both pilots' hands reach the flight controls, as in a real cockpit.
The flying machine is the PF's, and the following machine is the pilot monitoring's (PM's).
The following machine still freezes its aircraft and sets it from the flying machine's position, attitude, and velocity, as FS Copilot and YourControls do ([01](../../learn/foundations/01-prior-art-and-crew-practice.md#prior-art)).
What changes is that Crosscheck takes each pilot's yoke and throttle input before the sim acts on it, sends the PM's axes one way to the flying machine, and mixes them there with the PF's, by a rule for each aircraft type.
Where the type warns of dual input, Crosscheck does too: on an Airbus, the two sidesticks' inputs are added and a "DUAL INPUT" voice warns the crew (documented, secondary, in [01](../../learn/foundations/01-prior-art-and-crew-practice.md#crm-callouts-and-transfer-of-control)).
In FS Copilot and YourControls only the PF's hardware reaches the sim, and this sends both pilots' hardware to it, so building it starts with a decision in `record/decisions/`.

- **Tech:**
  - Masking the axis events keeps them from the sim, and the block ends when the masking client dies (measured on MSFS 2024, 2026-10-01, [log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)).
    On an aircraft whose module asks for the same priority, Crosscheck's masks have to be in place before the aircraft loads ([log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)).
    SPAD.neXt drove the Baron 58P's mixture lever past the mask, because it set the Baron's input event itself and sent no key event (measured on MSFS 2024, 2026-10-06, [flight-controls log](../flight-controls/log.md#2026-10-06-masking-holds-back-a-mixture-lever-bound-in-msfs-and-not-one-spadnext-drives-because-spadnext-sets-the-input-event-itself)); whether it drives a yoke or a throttle the same way is unmeasured.
  - A mixed value sent back reaches stock flight controls from priority 10,001,000 down ([log](../flight-controls/log.md#2026-10-01-a-value-sent-back-at-10000001-reached-our-own-masking-group-and-the-777-ignored-re-sent-values)), and the PMDG 777's own yoke takes it at 10,001,000 only when it's sent with the legacy `SimConnect_TransmitClientEvent` ([log](../flight-controls/log.md#2026-10-01-the-pmdg-777-takes-a-value-sent-back-with-the-legacy-transmit-call)).
  - A masked event carries the value after the pilot's dead zone set in MSFS, so that setting survives ([log](../flight-controls/log.md#2026-10-01-inside-a-dead-zone-set-in-msfs-the-axis-fires-no-event)); whether the sensitivity curve does is unmeasured.
  - The PM flies a loop late by twice the one-way network delay plus the following machine's display buffer, and a pilot whose own pitch and roll input reached the Baron 150ms late found it flyable, and 300ms late not (measured on MSFS 2024, 2026-10-06, [flight-controls log](../flight-controls/log.md#2026-10-06-a-pilots-own-pitch-and-roll-input-was-flyable-150ms-late-and-not-300ms-late-in-the-baron-at-cruise)).
    With FS Copilot's 400ms buffer alone past that, a PM flying through mixed controls would need a much shorter buffer and a partner nearby, or their input applied on their own machine first.
  - Flying through that lag looks unworkable: pilots would feel even 100ms, and an Airbus is as sensitive (judged by the user, 2026-10-06).
- **Next:** reconsider after v1 what else the idea could serve, since flying with both pilots' inputs mixed looks out of reach (user, 2026-10-06).
- **Product:** an exact dual-input warning, and a second pair of hands on the controls.

## Presence

### Seat awareness

Each pilot has a seat.
The profile author places each seat in the sim itself, from the [Crosscheck IDE](#crosscheck-ide), in a minute a seat:

1. The easy way, tried first: the IDE seats the figure on each seat object SimConnect lists for the aircraft.
2. Where the aircraft lists none and its cockpit model is readable, the author clicks the seat's cushion, and the figure spawns sitting there.
3. Where the model can't be read either, the figure spawns where the camera is.
4. The author then drags arrows on the figure in the sim to move and turn it, adjusts its legs and knees by handles of their own, and saves.
   If arrows in the sim can't be done, the IDE offers its own controls, with the figure previewed in the sim.

- **Tech:** MSFS 2024 aircraft can ship seat parts with their own navigation graphs.
  The A220 has `A220_Seat_Pilot` and `A220_Seat_Copilot` (read in synaptic-aircraft-a220 1.0.10, [files](../aircraft/synaptic-a220/files.md)), and the Phenom 300E has a passenger seat, `fsreborn_phenom300e_seat_pax` (read in fsreborn-aircraft-phenom300e 1.0.24, [files](../aircraft/fsreborn-phenom-300e/files.md)).
  The C152's seats show up in SimConnect as objects, `SEAT_C152_Pilot` and `SEAT_C152_Pax`, whose positions a SimConnect client reads, and the seated pilot's avatar sits exactly on `SEAT_C152_Pilot` (measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-seat-objects-place-the-other-pilot-in-the-cockpit-and-the-seated-avatar-doesnt-turn-with-the-look)).
  The A2A Comanche's show up the same way, as `SEAT_DEFAULT_Pilot` and `SEAT_DEFAULT_Copilot`, and sit about 1cm from where its model puts the nodes `PILOT_1` and `PILOT_2`, shifted the same way for both seats (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-the-cockpit-models-own-space-lines-up-with-simconnects-within-8mm-but-the-models-input-event-ids-arent-the-names-the-sim-lists)).
  Whether the A220's and Phenom's seat parts show up the same way, with positions Crosscheck can use, is unverified.
  On an aircraft whose model files are encrypted, such as a Marketplace package, the IDE can't load the cockpit model, so the avatar sits on the seat objects SimConnect lists and turns its head, without touching controls.
  The partly encrypted Phenom 300E lists both pilots' seats and its passenger seats, and the partly encrypted A380 only its two pilots', each with the seated avatar exactly on the pilot's (measured on MSFS 2024, 2026-10-03, [aircraft log](../aircraft/log.md#2026-10-03-two-partly-encrypted-aircraft-list-seat-objects-the-phenom-300e-for-its-pilots-and-passengers-and-the-a380-for-its-pilots)).
  The seat objects are the seats in the aircraft's navigation graph, so the Baron 58P, whose graph has only the pilot's seat, lists only that one, though its cockpit model has nodes for both front seats (measured on MSFS 2024, 2026-10-03, [aircraft log](../aircraft/log.md#2026-10-03-the-baron-58p-lists-only-its-pilots-seat-because-the-seat-objects-are-the-seats-in-each-aircrafts-navigation-graph)).
  - **Moving a pilot's camera to a seat:** with the sim's own camera, a SimConnect client acquires the camera and releases it into one of the aircraft's camera views, such as the 58P's `CoPilot`, and the pilot looks around from there as usual (measured on MSFS 2024, 2026-10-03, [aircraft log](../aircraft/log.md#2026-10-03-a-simconnect-client-moves-the-pilots-camera-to-the-copilots-seat-by-releasing-the-camera-into-the-aircrafts-copilot-view-unless-chaseplane-runs)).
    ChasePlane takes the camera back from that, and its own API loads its view of the same seat instead (same date, [aircraft log](../aircraft/log.md#2026-10-03-chaseplanes-own-api-moves-the-pilots-camera-to-the-copilots-seat-by-loading-its-copilot-view)).
    A point with no view is out of reach of both: the eyepoint events don't move the eye, and a held camera takes neither the mouse look nor clicks (same date, [aircraft log](../aircraft/log.md#2026-10-03-the-eyepoint-events-dont-move-the-cockpit-eye-the-pilots-own-camera-keys-fire-none-of-the-legacy-camera-events-and-a-held-camera-doesnt-take-the-mouse-look)).
  - **Seating by camera views, closed on 2026-10-04:** a Community package of ours can add views to an aircraft, by copying its camera file and mounting after its package, and the camera hands back into a view with a free pilot item anywhere in the aircraft (measured on MSFS 2024, 2026-10-04, [aircraft log](../aircraft/log.md#2026-10-04-a-community-package-of-ours-adds-a-seat-view-anywhere-in-the-aircraft-it-replaces-the-camera-file-when-it-mounts-after-the-aircrafts-the-sim-reads-it-at-start-and-a-free-pilot-item-lets-the-camera-hand-back-there)).
    But it reaches only the first view with each pilot item, a handful of seats per aircraft where an airliner needs 180 (same date, [aircraft log](../aircraft/log.md#2026-10-04-the-camera-hands-back-into-one-view-per-pilot-item-the-first-that-has-it-so-a-packages-seat-views-cover-a-handful-of-seats)), so we don't use it.
    The Camera API has no call that adds a view, the per-user camera file's views reach neither SimConnect nor ChasePlane, and `SimConnect_CameraSetRelative6DOF` holds the camera and freezes the look (same date, [aircraft log](../aircraft/log.md#2026-10-04-camerasetrelative6dof-puts-the-eye-at-any-point-but-holds-the-camera-and-a-camera-handed-back-into-a-view-returns-to-the-views-own-eye)).
- **Open questions:** how pilots switch seats, before and during a flight, which we'll come back to.
  Whether arrows in the sim can be dragged: the ray through the cursor lands within 2mm ([avatars log](../avatars/log.md#2026-10-03-the-ray-through-the-cursor-needs-no-calibration-cameragets-field-of-view-is-the-views-height-and-clicks-land-within-2mm-at-any-zoom-and-window-shape)), and we know where the arrows are, so hitting them is our own arithmetic, but a click on an arrow also reaches the sim, so the IDE either keeps arrows clear of controls or holds the click back, which puts it in the pilot's input path, where CLAUDE.md's fail-open rules apply.
  Moving a pilot's camera to a seat went to [Ideas left out](#ideas-left-out) on 2026-10-04: each pilot moves to their seat themselves, and Crosscheck tells which seat they took from where their camera is.

### Join modes

Anyone who joins a session joins as a pilot or as a passenger.
A passenger picks one of the aircraft's [seats](#seat-awareness) and rides along, so a group of four can have two flying and two in the cabin.
Later, a pilot could invite a passenger to a given seat, with the invite made to look like a boarding pass.

- **Tech:** a crew and its passengers need different things from the connection.
  The crew, usually two or three people, sends every change and needs it to arrive with little delay, while passengers send almost nothing and can take more delay (unverified).
  Connecting each of 150 people to every other takes 11,175 connections (150 × 149 / 2).
  Instead, the crew could connect to each other, and passengers receive a one-way feed.
  The feed would come from one crew machine, or pass down a tree in which each passenger forwards it to a few others.
  Crosscheck would cap how many of a session's connections the relay carries, so one large event can't use up the relay.
- **Product:** serves the [groups](02-users.md#groups) who fly with passengers.
- **Open questions:** a passenger probably needs the aircraft installed to sit in its cabin (unverified), so passenger mode is an option for groups who all own the aircraft.

### Avatar sync

Each pilot sees the other pilot's avatar, with MSFS multiplayer off.
Crosscheck reads where the avatar is, which way it faces, where the pilot looks, and where they click, and on the other machine moves a figure of its own to match.
The figure is a few plain shapes that carry meaning by how they move, after the people in the game Big Walk: a long nose shows where the pilot looks, the head turns and nods, and the hands are balls on arms that stretch.
In the cockpit, one hand holds the yoke and the other goes to whatever the pilot clicks or drags, inside or on the aircraft's outside, by a pilot's habits with a yoke, in either seat.
How the hands work, and where they stop, is in [the avatars' tentative decisions](../avatars/decisions.md).

- **Tech:**
  - **The avatar:** SimConnect reads the avatar's position, ground speed, and facing every sim frame through `SIMCONNECT_OBJECT_ID_USER_AVATAR` (measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-the-avatars-own-object-id-gives-its-position-speed-and-facing-every-sim-frame)).
  - **The figure:** the sim's own people stay invisible when a SimConnect client spawns them, while GSX's people show (measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-a-gsx-person-shows-and-follows-where-we-write-it-and-the-sims-own-people-stay-invisible)).
    A model of our own compiles from generated glTF, and its size and color follow variables of its own object, which a WASM module sets every frame (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-a-model-of-our-own-compiles-from-generated-gltf-and-its-size-and-color-follow-variables-of-its-own-object)).
    So the figure can be Crosscheck's own simple model, with no modeled, animated character to build.
    A figure of balls and sticks built that way, its joints animations that read variables, poses in the cockpit as our dev page poses it: the head turns, the arms run straight to their targets, the legs bend at the knee, and one variable changes its color (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-our-own-figure-poses-in-the-sim-from-its-variables-plays-between-frames-smoothly-and-changes-color-through-asobo_property_animation)).
    Its sticks reach any length by telescoping, two fixed pieces at a time, since the sim didn't play a scale animation that stretched them (same date, [avatars log](../avatars/log.md#2026-10-03-sticks-that-telescope-two-fixed-pieces-shown-by-the-sticks-length-end-at-the-hands-and-feet)).
    One sim draws many of these figures, each posed from `Z:` variables of its own object, at about 16µs to 21µs of frame time each in view and almost none out of view (measured on MSFS 2024, 2026-10-05, [avatars log](../avatars/log.md#2026-10-05-each-figure-poses-from-its-own-objects-variables-and-costs-frame-time-in-view-and-almost-none-out-of-view)).
  - **Holding it in a moving cockpit:** on an aircraft with seat objects, the seated figure goes on the seat object of the other pilot's seat (measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-seat-objects-place-the-other-pilot-in-the-cockpit-and-the-seated-avatar-doesnt-turn-with-the-look)).
    In flight, an object written every frame from outside the sim stutters against the cockpit (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-writes-from-outside-the-sim-place-an-object-in-a-moving-cockpit-but-cant-hold-it-still)).
    GSX keeps its seated passengers still by adding its model to the aircraft package's own `attached_objects.cfg`, which the sim then draws as part of the aircraft (read in GSX Pro 4.0.19 and fnx-aircraft-320, preset `FNX_320_CFM_SL`, `attached_objects.cfg`, [avatars log](../avatars/log.md#2026-10-03-gsx-keeps-its-passengers-aboard-by-adding-its-model-to-the-aircrafts-own-attachments)), and a model attached that way holds still in flight (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-a-model-attached-through-the-aircrafts-own-files-holds-still-in-flight)).
    A WASM module needs no edit to the aircraft: it writes the figure inside the sim's frame, turns its seat offset by the aircraft's heading, pitch, and bank, and moves it ahead by 0.75 to 1 frame's worth of the aircraft's motion.
    In the C152, over 3 minutes of flying, that held GSX's seated passenger, standing in for our figure, in its seat, and the pilot judged the slight lag left as the passenger's inertia (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-over-three-minutes-of-flying-leads-of-075-and-1-frame-both-hold-the-figure-and-whats-left-reads-as-inertia)).
    In the Baron 58P, it held our own figure through 9 minutes of flight at up to 185 kt GS, though some part of it missed a frame now and then (same date, [avatars log](../avatars/log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs)).
  - **The head:** `SimConnect_CameraGet` gives where the pilot looks, whether ChasePlane drives the camera or not (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-simconnect_cameraget-gives-where-the-pilot-looks-with-chaseplane-driving-the-camera-or-not)), and includes a Tobii head tracker's rotation (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-simconnect_cameraget-includes-a-tobii-head-trackers-rotation-and-its-position-is-in-meters)).
  - **The hands:** measured in the A2A Comanche and the Black Square Baron 58P, inside and on foot outside; what they do, where they stop, and the findings behind each are in [the avatars' tentative decisions](../avatars/decisions.md).
- **Product:** a pilot sees the other pilot beside them on the walkaround, which FS Copilot's pilots never do: FS Copilot requires multiplayer off (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "What the receiving pilot has to do"), and with it off nothing shows the other pilot's avatar.
  In the cockpit, the other pilot sits in their seat, turns their head where they look, and reaches for each switch, knob, and lever they click, so a pilot sees who did what as it happens.
  With each entry's spot in the cockpit from the [Crosscheck IDE](#crosscheck-ide), the hand also reaches for a control the pilot changed without a click, such as a home cockpit's switch, a hardware flap lever, or a keyboard shortcut.
  When a pilot's connection drops, their seated figure could slump in the seat, so the others see what happened.
- **Open questions:**
  - How Crosscheck seats the figure on an aircraft without seat objects.
  - Whether Crosscheck loads attachments' models: the Comanche's GPS units have models of their own, so rays aimed at them hit the panel behind (`BlackPanel` in the Comanche) (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-a-clicks-ray-cast-into-the-cockpit-model-finds-the-control-the-pilot-clicked-with-no-names-but-the-run-couldnt-pin-down-the-field-of-view)).
  - Which aircraft carry over.
    The ray has been measured against known spots only in the Comanche, and the yoke hand has run only in the Baron 58P.
    The Comanche plays its yoke from A2A's `L:YokeBank_Anim` and `L:YokePitch_Anim`, where the Baron plays its yoke from `A:YOKE X POSITION WITH AP LINEAR` and `A:YOKE Y POSITION WITH AP` (read in a2a-aircraft-pa24 2.1.3 and bksq-aircraft-baronpro 0.1.1, [avatars log](../avatars/log.md#2026-10-03-aircraft-mark-their-yoke-grips-with-the-same-node-names-and-the-yokes-own-animations-put-them-on-a-level-wheel)).
    The yoke hand runs whichever code the aircraft has, so it would pose the Comanche's yoke the same way (unverified).
  - What the figure does for a click beyond its 2m to 3m reach: on foot, the pilot stood a median 1.8m to 2.6m from the spot, and up to 5.8m (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-on-foot-outside-the-click-ray-lands-within-1cm-on-the-exterior-and-the-pilot-clicks-from-up-to-6m-away)).
  - How the hands work with a sidestick or a center stick, since the rules are for a yoke, in either seat ([the avatars' tentative decisions](../avatars/decisions.md#the-hands-follow-a-pilots-habits-with-the-right-hand-on-the-yoke-in-the-right-seat)).
  - Whether avatar sync works for a pilot in VR: whether Crosscheck can read a VR pilot's head and hands, and how the figure looks in a headset, to explore later.
    A sidestick pilot never swaps hands, and a center stick probably stays in the right hand (unverified).
  - Whether, on the other pilot's machine, Crosscheck should hold each change that swaps hands for 0.3s before applying it, so the hands can pass the yoke as a person would.
    There Crosscheck applies the change itself, so it could let the free hand take the yoke, then send the tapping hand and move the switch, at the cost of 0.3s more delay on every change that swaps hands.

## Interface

### Crosscheck's interface in the EFB and on a tablet

Crosscheck's controls, such as session status and the take-control button, run as an app on the sim's EFB, which a pilot in VR can reach, and in a browser on a tablet on the home network.
That makes the interface a client of Crosscheck's app on whichever screen it runs, and the app's design has to allow that from the start.

- **Tech:** MSFS 2024 runs third-party EFB apps: the A2A Aerostar 600's tablet is one, `Aerostar600App` (read in a2a-aircraft-aerostar600 1.0.6, `html_ui/efb_ui/efb_apps/Aerostar600App/A2ATabletApp.js`).
  The sim's EFB opens with the Tab key in any aircraft, including those that ship their own tablet, such as the Black Square Baron Pro (from our own use of MSFS 2024, as of 2026-10-02).

### Notification banner

Crosscheck's notices, such as "James is in the pause menu", latency trouble, lost packets, and a lost connection, slide in at the side of the screen.
A pilot sees them whether or not the EFB is open, and a click on one opens Crosscheck's EFB app at what it's about.

- **Tech:** a see-through in-game panel of ours, kept open, takes clicks and slides notices in and out (measured on MSFS 2024, 2026-10-04, [interface log](../interface/log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)), and a script its toolbar icon puts into the sim's toolbar opened it with no click after two of three Build and Mounts (same date, [interface log](../interface/log.md#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click)).
  A click on a notice opens our EFB app wherever it sits in the EFB, as the [EFB app](03-v1-scope.md#efb-app) scope describes.
  A banner on an object of ours, held in front of the pilot's view, smeared in motion and was sometimes cut into by the cockpit (judged by the pilot in MSFS 2024, 2026-10-04, [interface log](../interface/log.md#2026-10-04-a-banner-drawn-on-an-object-of-ours-smears-in-motion-and-is-clipped-behind-the-cockpit-so-we-parked-it-for-an-in-game-panel)).
  The pilot caught none of three `SimConnect_Text` texts, though the sim reported two as displayed (same date, [interface log](../interface/log.md#2026-10-04-simconnect_text-reports-its-texts-as-displayed-and-the-pilot-didnt-catch-any-of-them)).
- **Open questions:** how the panel shows in VR, and whether clicks on its empty part reach the cockpit.

### Component health

When one of Crosscheck's components has trouble, from the watcher and the apps to the code in the sim and the relay, the pilot can see which one, such as "the panel bridge is red", and the trouble lands in Crosscheck's logs and recording, so a bug report the pilot sends us shows what happened (user, 2026-10-08).
What matters is that the answer is there when something stops working, not a row of indicators (user, 2026-10-08).

- **Tech:** the core is the hub most components already report to ([architecture's spine](../architecture/01-spine.md#components)).
  The WASM module hears from the core every second in a session ([architecture's spine](../architecture/01-spine.md#what-moves-them)), and FS Copilot's app re-sent its state to every panel every 2s, so a panel could take silence to mean the app was gone (read in the FS Copilot fork, `FsCopilot/Connection/PanelServer.cs`), so silence from a component is something the core can name and log.
  Another package's `VCockpit.js` override winning the mount order would show as a panel bridge that never connects ([installing and updating](03-v1-scope.md#installing-and-updating)).
- **Open questions:** what counts as trouble for each component, and where the pilot sees it: the desktop app, the EFB app for a pilot in VR, or a notice on the banner when it costs them a feature.

### Crosscheck objects in the cockpit

Crosscheck places objects of its own in the cockpit, which a pilot in VR reaches without a tablet, such as a take-control button the pilot puts above the glareshield or sticks to a window.

- **Tech:** an object attached through the aircraft's own files holds still in flight, as GSX's seated passengers did at up to 244 kt, but that means editing each aircraft package (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-a-model-attached-through-the-aircrafts-own-files-holds-still-in-flight)).
  An object a WASM module writes every frame holds its place with a lead of about 0.75 frames, and what's left reads as inertia on a seated person (measured, same date, [avatars log](../avatars/log.md#2026-10-03-over-three-minutes-of-flying-leads-of-075-and-1-frame-both-hold-the-figure-and-whats-left-reads-as-inertia)), which a button fixed to a window mustn't show.
  A click's ray cast into the cockpit model finds the control the pilot clicked ([avatars log](../avatars/log.md#2026-10-03-a-clicks-ray-cast-into-the-cockpit-model-finds-the-control-the-pilot-clicked-with-no-names-but-the-run-couldnt-pin-down-the-field-of-view)), and whether it can find a click on one of our own objects is untested.
- **Open questions:** whether predicting each frame from its actual frame time holds an object our WASM module writes as still as a button fixed to a window needs, since Crosscheck's own features don't attach objects through an aircraft's files ([decision 001](../../decisions/001-changing-other-developers-packages.md)).

## Tools

### Flight recorder and debrief

Crosscheck records every synced change and every handover, and plays the flight back as a timeline afterward.
Pilots debrief with it, training groups use it for checkrides, and we use it to find where two cockpits diverged, with a button that bundles the last minutes into a bug report.

- **Tech:** every change already passes through Crosscheck, so recording costs little, and the timeline viewer is the work.

### Telemetry

When Crosscheck sets a control on the other pilot's machine, reads it back, and still finds the wrong value after a few tries, it sends a server of ours an event carrying only the aircraft's package and version, the profile's version, and the control.
This covers only controls whose profile entry Crosscheck can read, the limit that keeps [cockpit diff and resync](#ideas-left-out) out.
A setting switches it on or off, and which way it starts is an open question below.
It adds to the [bug reports](03-v1-scope.md#recording-and-bug-reports) pilots send, because telemetry finds the patterns across many flights, and a bug report explains one.

- **Tech:** the server the v1 scope plans for bug reports could take these events too, or a hosted error-tracking service such as [Sentry](https://sentry.io/) could, which would also catch Crosscheck's own crashes.
- **Product:** a profile that fails on many pilots' flights gets fixed even when none of them files a bug report.
- **Open questions:**
  - Whether it starts off until a pilot turns it on, or on until a pilot turns it off.
    Each event reaches our server from the pilot's IP address, which the EU's General Data Protection Regulation (GDPR) counts as personal data, so the events are anonymous only if the server discards the address (unverified).
    Legal advice settles whether the GDPR, or the EU's ePrivacy Directive on reading data from a device (unverified), requires asking the pilot first.
  - Which events to send beyond a control that never matched, chosen once Crosscheck syncs real flights and we see what fails.

### Crosscheck IDE

The Crosscheck IDE is where we, and after v1 the community, write profiles: it finds what an aircraft exposes, binds it, and checks the result against the live sim.
It's built new from fsc-editor's design and record, so it carries none of FS Copilot's profile dialect or its other baggage.
Besides finding names, it places things in the sim through its live connection: the avatar on each seat, by the steps [Seat awareness](#seat-awareness) lists, and each entry's spot in the cockpit, so the avatar of whoever changes an entry can reach out and touch it.

- **Tech:** fsc-editor already finds variables by flipping a switch and showing what changed, shows each line's live value, runs a setter against the live sim, and reads an add-on's files into a report that starts a profile (fsc-editor, `docs/sim-vars/index.md`).
  Our avatar work poses a figure of our own in the cockpit from variables, as its dev page sets them (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-our-own-figure-poses-in-the-sim-from-its-variables-plays-between-frames-smoothly-and-changes-color-through-asobo_property_animation)).
- **Product:** it gets the same care as the apps pilots use, from its first version, because a tool whose interface is allowed to drift keeps drifting.
- **Open questions:** whether the IDE joins through the Crosscheck session and its code, as [03-v1-scope](03-v1-scope.md#invite-code) asks.
  A test of a profile across two machines, needed before the IDE exists, could be a quick tool on fsc-editor's relay.

### Profile registry

Each profile is matched to aircraft package versions, and Crosscheck fetches the one that matches the installed aircraft.

Below is one way to submit and maintain profiles, to explore later.
FS Copilot's profiles end up owned by their first author, with no way for a later author to improve one or offer a better one, so the best work doesn't reach the profile most pilots use (from our experience with FS Copilot's profiles).
The suggestion copies [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped), which keeps the TypeScript types for npm packages:

- One canonical profile per aircraft, in one public repository.
- Changes arrive as pull requests, and each aircraft lists maintainers who review them.
- The Crosscheck IDE opens the pull request, so authors never touch git.

The analogy stops at testing: DefinitelyTyped's CI checks every change, and fsc-exerciser tests the wire but not two aircraft staying in agreement ([08-06](../../learn/foundations/08-06-divergence-and-one-screen.md#detecting-divergence-and-correcting-it)).

- **Open questions:** who reviews, and how a profile for a new aircraft version starts from the previous one.

## Ideas left out

- **Save and resume together:** few addons save and restore their own state, such as PMDG's panel states and the iniBuilds A350's autosaves (read in pmdg-aircraft-77w 2.4.143, [777 study](../aircraft/pmdg-777-300er/study.md), and inibuilds-aircraft-a350 1.2.6, [A350 study](../aircraft/inibuilds-a350/study.md)), and driving those from outside is unexplored.
- **Basic sync for aircraft without a profile:** we judge that a starter profile generated from an aircraft's input events would give little that's usable on most aircraft (unverified: nobody has tried it).
- **An activity feed for pilots:** one control can fire several events, as the PA-24's radio volume knob fired four input events in one turn ([03-03](../../learn/foundations/03-03-reading-and-writing.md#enumerating-vs-observing)), and a pilot can't read a feed of them.
  It belongs in the Crosscheck IDE.
- **Shared checklists:** checklists depend on the aircraft, and on which airline's version a crew wants.
- **Linked yokes on force-feedback hardware:** both pilots would need a force-feedback yoke, and few pilots own one (unverified).
- **An intercom routed by the aircraft's audio panel:** Discord carries the pilots' voices already, and the intercom would mean building voice capture, transport, and playback, plus mapping each aircraft's audio panel, for value nobody has evaluated.
- **Learn by demonstration in the Crosscheck IDE:** the IDE would list what changed when the author flipped a switch, and propose a profile entry.
  We set it aside while we build the core product.
- **Cockpit diff and resync:** we don't know how reliably Crosscheck can read an aircraft's state, and a resync prompt interrupts the pilots.
- **Multiplayer kept on:** other players in the session would see the shared aircraft twice, and Crosscheck can't hide anything on their machines (unverified: nobody has looked from a third machine).
  In multiplayer each pilot also sees the other pilot's copy of the aircraft (unverified: from our FS Copilot sessions), and hiding that copy would fix only the two pilots' own view.
  [Avatar sync](#avatar-sync) gives the walkaround presence that keeping multiplayer on was for.
- **Flight setup by the host:** Crosscheck would load the host's flight, aircraft, gate, and panel state on every machine through `SimConnect_FlightLoad`, which works, but MSFS 2024 1.8.16.0 crashed on 5 of about 30 such loads (measured on MSFS 2024, 2026-10-01, [aircraft log](../aircraft/log.md#2026-10-01-loading-flights-through-simconnect-works-but-the-sim-crashed-on-5-of-about-30-loads-so-we-canceled-the-unattended-session)).
  A crashed sim is the worst outcome a pilot can have, and what a load from outside does to the sim an hour into a flight is unknown, so the step it saves isn't worth it.
  [The PF's spot on the world map](#the-pfs-spot-on-the-world-map) gets most of the way there instead.
- **Shared pointing:** a pointer in the 3D cockpit, a highlight on a switch, or a pointer on a panel display, for showing the other pilot where to look.
  [Avatar sync](#avatar-sync)'s hand reaches out and touches each switch and surface the pilot clicks, which shows the other pilot more than a pointer would, so we dropped pointing for it on 2026-10-03.
- **Pausing the flight when a pilot drops out:** a pilot whose sim restarted comes back with a fresh cockpit that a pause doesn't restore, and pausing doesn't suit flights on online networks such as VATSIM.
  The others fly on instead, as [03-v1-scope](03-v1-scope.md#the-connection) says.
- **Permanent codes:** a code of a pilot's own, handed out first come, first served, needs an identity that outlasts a session, and nothing else in Crosscheck needs one, so we left it out on 2026-10-04.
- **Moving a pilot's camera to their seat:** no route was clean, so we left it out on 2026-10-04.
  Views a package of ours adds reach only a handful of seats per aircraft, and adding them means generating and managing each aircraft's camera file ([aircraft log](../aircraft/log.md#2026-10-04-the-camera-hands-back-into-one-view-per-pilot-item-the-first-that-has-it-so-a-packages-seat-views-cover-a-handful-of-seats)).
  `SimConnect_CameraSetRelative6DOF` holds the camera and freezes the pilot's look ([aircraft log](../aircraft/log.md#2026-10-04-camerasetrelative6dof-puts-the-eye-at-any-point-but-holds-the-camera-and-a-camera-handed-back-into-a-view-returns-to-the-views-own-eye)), and pressing the pilot's own camera keys needs the sim's window in front ([aircraft log](../aircraft/log.md#2026-10-04-key-presses-a-program-sends-move-the-cockpit-eye-with-the-sim-window-in-front-and-leave-the-pilot-their-camera)).
  Pilots set up their own views instead, with the sim's camera or ChasePlane, and Crosscheck tells their seat from where their camera is ([avatar sync](03-v1-scope.md#avatar-sync)).
