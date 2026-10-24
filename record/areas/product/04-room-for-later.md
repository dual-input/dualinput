# Product: room for later

```text
Purpose:     What each Soon and Later pick needs from what v1 builds, so it slots in without rework.
Depends on:  01-aims.md, 03-v1-scope.md, ../sync/01-profile-entries.md, ../sync/02-live-sync.md, ../sync/03-catch-up.md, ../sync/04-order-and-recovery.md, ../architecture/01-spine.md, ../architecture/02-code-map.md, ../network/01-between-machines.md, ../network/02-units.md, ../session/01-roles-and-members.md, ../profiles/01-format-and-delivery.md, ../core/02-clients-and-panel-bridge.md, ../core/04-core-helper.md, ../recording/01-recording-and-bug-reports.md, ../plugins/01-plugins.md
Decides:     What Dual Input must allow for each Soon and Later pick, and what v1 builds now so that it does.
```

v1 builds what each Soon and Later pick in [the plan](plan.md) needs from it, so no pick rebuilds part of v1, because v1 gives up features, never design ([01-aims](01-aims.md#aims)).
That's channels that each declare how they travel, catch-up as a pipeline of steps, hosts inside the sim that load modules by name, one table of roles, a session that holds passengers, one protocol for every client, a profile format with room to grow, and a recording that's a replay log of every input.
v1 doesn't build the input layer, but it builds the two things the layer starts from: a core that starts with every sim run, and a connection to the sim that comes up with no flight loaded.
Nor does it build plugins, which are designed afresh when a pick first needs one ([Plugins](#plugins)).
A pick can still need work of its own, which [By pick](#by-pick) names beside the sections it needs.

Each section below names the picks that need it and ends with what v1 builds.
Dual Input's own code is everything Dual Input ships except [plugins](03-v1-scope.md#plugins) and profiles.
The flying machine is the PF's, and a following machine is any other pilot's.

## Channels

A channel is what one feature sends, or several features whose messages must apply in one order: its messages, how they travel, and how a cockpit catches up on them.
A channel changes nothing for the other channels but the bandwidth, and removing a channel removes all of it.

v1 has eight channels: the six in this table, catch-up's stream from the flying machine, and a heartbeat once a second from every machine, which carries only the clock exchange ([01-between-machines](../network/01-between-machines.md#channels), [02-units](../network/02-units.md#channels-and-sends)).

| Channel | From | To | Needs |
| --- | --- | --- | --- |
| Session: joins, Ready, control, and the time, date, sim rate, and pause | Every machine | Every other | The newest value of each key ([01-between-machines](../network/01-between-machines.md#channels)) |
| Cockpit: state, events, and pointer presses | Every machine | Every other | Every message, in causal order ([02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order)), as one replayed log ([01-between-machines](../network/01-between-machines.md#channels)) |
| Flight model, with the PF's yoke, rudder, and toe-brake positions | The flying machine | Following machines | Only the newest sample ([02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order)) |
| Avatars | Every machine | Every other | The newest pose of each figure |
| Traffic | The traffic host | The others | Each object's identity reliably, and its newest sample (FS Copilot fork, `record/traffic-atc/docs/04-transport.md`) |
| ATC audio | The ATC host | The others | Low delay, with loss acceptable |

Soon and Later picks add more:

- the PM's axes, to the flying machine, at the lowest delay ([mixed flight controls](ideas.md#mixed-flight-controls))
- a pilot's microphone, to the ATC host ([ATC sync](ideas.md#atc-sync))
- the weather, from its source ([environment sync](ideas.md#environment-sync))
- a one-way feed to passengers, which can take more delay ([join modes](ideas.md#join-modes))
- bulk transfers, such as a profile sent to a pilot who lacks it ([profile registry](ideas.md#profile-registry)), or the A220's full state, which `A22X.Resync` returns as 1,674 fields in about 100ms (measured on MSFS 2024, 2026-09-28, [CommBus log](../commbus/log.md#2026-09-28-a22xresync-returns-the-a220s-full-state-and-one-listener-hears-every-channel))
- an aircraft's bus messages and EventBus topics ([bus bridge](ideas.md#bus-bridge), [EventBus bridge](ideas.md#eventbus-bridge))
- a plugin's own objects and sound, such as GSX's ([Plugins](ideas.md#plugins))

How channels map onto the wire is the transport's job.
Our FS Copilot fork's transport maps by one rule: two kinds of message share an ordered wire channel only if neither is hurt by waiting behind the other (FS Copilot fork, `record/traffic-atc/docs/04-transport.md`, "Channels are ordering domains").
That document's channels are wire channels, not this document's.
The fork found the rule when a joining machine received about 130 traffic identities on its one reliable ordered wire channel, and every cockpit update waited behind them (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-08 · Unreliable never crossed the relay; relay protocol v2, channels, budgets").
So each channel declares:

- its delivery: every message in order, only the newest value for each key, or the lowest delay with loss acceptable
- its priority, so a bulk transfer never delays the flight model or the axes

Each send names its receivers, and the receiving handler checks who may send ([02-units](../network/02-units.md#channels-and-sends)).

The shared order is the causal order [02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order) gives the cockpit's messages, so that a page key always lands before a press on the page it opened.
No channel joins it: a feature whose messages must apply in order with the cockpit's, as a bus message that opens a page would, registers kinds on the cockpit stream ([02-code-map](../architecture/02-code-map.md#what-a-feature-registers)).
A channel that writes into the sim uses live sync's echo tokens ([02-live-sync](../sync/02-live-sync.md#keeping-a-change-from-applying-twice)).
If the EventBus bridge publishes a carried topic through one of the receiving machine's buses with the `sync` flag, that bus sends it out again under `wt.eb.evt`, as it does every synced topic, and our listener there hears it as a new change to send back.
Handed in as another bus's package, the topic may not go out again, because each bus publishes other buses' packages locally and skips its own (read in the A220's DisplayUnits bundle, [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)).
The bridge can hand topics in that way: a package our code sent under `wt.eb.evt` with a `busId` of its own, carrying the Phenom 300E's G3000 MFD's zoom-in, moved the MFD's map (measured on MSFS 2024, 2026-10-06, [CommBus log](../commbus/log.md#2026-10-06-our-own-code-hears-wtebevt-from-the-efbs-document-and-the-g3000-acts-on-a-package-it-sends)).

Traffic sync's object mirroring and hearing ATC's capture by process are kinds of channel that any feature can open, and a GSX plugin would be built mostly from those two ([Plugins](ideas.md#plugins)).
Traffic sync picks the objects it carries through a filter, and a later plugin that claims objects from it, as a GSX plugin carrying GSX's vehicles would so the crew doesn't see each one twice, waits for plugins' design ([plugins and the sandbox](../plugins/01-plugins.md)).

**v1 builds** a transport in which each channel declares its delivery and priority and each send names its receivers, v1's eight channels as separate channels, object mirroring and audio capture as channel kinds, and traffic sync's filter.

## A catch-up pipeline

Catch-up is a pipeline of steps, and in v1 it has one, [catching up state](../sync/03-catch-up.md#catching-up-state).
A late joiner also takes the PF's time of day, date, and simulation rate ([time, date, sim rate, and pause](03-v1-scope.md#time-date-sim-rate-and-pause)), and the traffic it hasn't seen, but neither as a step: the time, date, and simulation rate reach it as session keys, and traffic as the host's identity set ([04-order-and-recovery](../sync/04-order-and-recovery.md#catch-up)).
Each step says where it runs relative to the others, such as after state so the battery is on, and how it checks that it landed.
Later picks add steps:

- **Bus bridge:** a bridge that forwards whole CommBus messages needs a step that sends `A22X.Resync`, after which the A220 sent a full snapshot on each of the 29 CommBus channels that carry its changes ([CommBus log](../commbus/log.md#2026-09-28-a22xresync-returns-the-a220s-full-state-and-one-listener-hears-every-channel)).
  An A220 plugin that uses `A22X.Resync` only to read the fields its profile needs, and exports those, needs no step, since its values are ordinary entries.
- **EventBus bridge:** a step that publishes `resync_request`, which has every synced topic sent again (read in the A220's DisplayUnits bundle, [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)).
  Sent from our listener in the EFB's document, it had the Phenom 300E's buses send that listener 306 distinct topics within 5s, while the MFD's listener got 26, for a reason we haven't found (measured on MSFS 2024, 2026-10-06, [CommBus log](../commbus/log.md#2026-10-06-our-own-code-hears-wtebevt-from-the-efbs-document-and-the-g3000-acts-on-a-package-it-sends)); whether 306 is every synced topic is unverified.
- **Aircraft adapters:** a step in an adapter's plugin for state that isn't one value, such as loading a PMDG 777 panel state, which its CDU does by name (unverified), though whether the 777 loads one mid-flight is untested; loading one from the CDU in flight settles both ([aircraft adapters](ideas.md#aircraft-adapters)).

After a short outage, the cockpit stream replays its missed messages in its one log, as [03-catch-up](../sync/03-catch-up.md#replaying-a-short-outage) replays state changes, events, and presses in one sequence, and the session channel and traffic's identities send each of their keys again on the new connection ([01-between-machines](../network/01-between-machines.md#channels)).

**v1 builds** catch-up as a pipeline with one step, catching up state.

## Plugins

A plugin is code we ship for one aircraft or one add-on, and code that serves one product lives in a plugin, never in Dual Input's own code ([03-v1-scope](03-v1-scope.md#plugins)).
Plugins are designed afresh when a pick first needs one, starting from but not bound by this section and [code inside the sim](#code-inside-the-sim) (user, 2026-10-17; [plugins and the sandbox](../plugins/01-plugins.md)).

A plugin's first job is to find state the profile can't reach and export it as values, `plugin.state.<name>`, which the profile watches as it watches an `L:` variable ([01-profile-entries](../sync/01-profile-entries.md#watching-a-value)).
For each value it can set, the plugin registers a write method, which the engine calls as `writer.plugin().<name>(value)`; the plugin itself never calls the writer ([01-profile-entries](../sync/01-profile-entries.md#the-writer-api)).
Live sync, read-back, the conflict rule, catch-up, pacing, and echo marking then cover a plugin's values and writes as they cover any entry, with no code of the plugin's.
A 58P plugin would do that for the radio settings that live only in its gauges' JavaScript ([03-v1-scope](03-v1-scope.md#plugins)).

For what isn't a value, a plugin reaches every layer through hooks:

- moments in a session, such as an aircraft loading, preflight ending, and control passing
- channels of its own, of the kinds above
- steps in the catch-up pipeline
- code inside the sim, in the aircraft's panels and in a WASM module, where our panel bridge and module carry out what the plugin asks of them through generic APIs ([below](#code-inside-the-sim))

A plugin reaches only the sim and the aircraft, through Dual Input's APIs ([01-format-and-delivery](../profiles/01-format-and-delivery.md)).
It changes what Dual Input watches only in its write methods ([03-v1-scope](03-v1-scope.md#plugins)).
Each aircraft has one plugin, and plugins for aircraft that share code share it through a library rather than a copy.

These picks put their product-specific parts in plugins:

- aircraft adapters, such as the A220's Redux store and the PMDG 777's panel state ([aircraft adapters](ideas.md#aircraft-adapters))
- the bus bridge's parts for one aircraft, such as sending the A220's `A22X.Resync` ([bus bridge](ideas.md#bus-bridge))
- mixed flight controls' rule for each aircraft type, such as a hypothetical Airbus rule that reads whether the autopilot is engaged
- masking for an aircraft whose inputs a profile can't describe ([soft takeover](ideas.md#soft-takeover-on-handover))
- the patch the iniBuilds A350's module needs for its displays to take a forwarded press ([WASM instrument sync](ideas.md#wasm-instrument-sync), [decision 001](../../decisions/001-changing-other-developers-packages.md))
- GSX, and each ATC service the second pilot's microphone would reach, such as VATSIM, SayIntentions, or BeyondATC ([ATC sync](ideas.md#atc-sync))

The EventBus bridge puts no part in a plugin, because it would serve every avionics suite that keeps its state on the framework's bus ([EventBus bridge](ideas.md#eventbus-bridge)).

Dual Input's own code owns each mechanism, and a plugin owns the policy.
The input layer masks, and a plugin says what to hold back; the axes channel carries the PM's input, and a plugin mixes it.
Two plugins then never fight over one mechanism, and every mechanism keeps the fail-open rules [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) sets for anything in the pilot's input path.

**v1 builds** no plugins, no hooks for them, and no plugin values or write methods in the profile and the writer.

## Code inside the sim

v1 runs code inside the sim in two places, and both load what they run by name, so features add to them without changing them:

- **The panel bridge,** which v1 injects into the aircraft's panel documents for pointer sync, loads a module for each instrument a feature names.
  The bus bridge and adapters such as the A220's each need a listener inside an instrument's document ([bus bridge](ideas.md#bus-bridge), [aircraft adapters](ideas.md#aircraft-adapters)).
  The [EventBus bridge](ideas.md#eventbus-bridge)'s listener can't be one of the panel bridge's modules: inside an instrument's document it misses that instrument's own bus, while in the EFB's document it heard all five of the Phenom 300E's G3000 buses (measured on MSFS 2024, 2026-10-06, [CommBus log](../commbus/log.md#2026-10-06-our-own-code-hears-wtebevt-from-the-efbs-document-and-the-g3000-acts-on-a-package-it-sends)).
  It runs in the EFB's document, beside the EFB app, and which host loads it there is open.
  A syntax error in a panel file takes out the whole file, not one line, and one broken shared `VCockpit.js` once broke every instrument in the sim (FS Copilot fork, `record/conventions.md`), so the bridge loads each module from its own file, and one module's error reaches no other.
  Later it also passes presses to displays drawn by WASM code, by sending mouse events to the display's canvas in its panel document: the iniBuilds A380's displays pressed at the position our fork sent that way, once told the mouse entered them (measured on MSFS 2024, 2026-09-23, FS Copilot fork, `record/wasm-pointer/docs/log.md`, "2026-09-23 — The A380 presses where we say once the display is told the mouse entered it; the A350 does not").
- **The WASM module,** which places figures in v1 ([avatar sync](03-v1-scope.md#avatar-sync)), places objects of any kind.
  Later it places [Dual Input objects in the cockpit](ideas.md#dual-input-objects-in-the-cockpit) and the arrows the [Dual Input IDE](ideas.md#seat-awareness) draws on a figure to place it.

A plugin's code runs only in the core, so its hooks in the cockpit panels and the WASM module are the panel bridge and the module carrying out what it asks of them through generic APIs ([architecture's tentative decisions](../architecture/decisions.md#plugin-code-runs-only-in-the-core), 2026-10-08).

**v1 builds** both as hosts that load modules by name, and none of their mechanisms for plugins (user, 2026-10-17; [plugins and the sandbox](../plugins/01-plugins.md)).

## An input layer

Several picks hold a pilot's input back from their own sim:

- [Soft takeover](ideas.md#soft-takeover-on-handover) holds the new PF's levers until they pick up.
- [Mixed flight controls](ideas.md#mixed-flight-controls) holds the PM's axes and sends them to the flying machine.
- Blocking a cut-off pilot's switches, an open question in [the connection](03-v1-scope.md#the-connection), holds those.
- [Ground operations sync](ideas.md#ground-operations-sync) holds a PM's pushback request, such as `K:TOGGLE_PUSHBACK`, so that only the flying machine carries it out.

Masking holds the axis events back on stock flight controls and the PMDG 777, and the block ends when the masking client dies (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)).
On an aircraft whose module asks for the same priority, such as the A2A PA-24, masks work only if they're in place before the aircraft loads ([flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)).
So the part of Dual Input that masks has to be able to start with the sim, and in v1 the core does: the desktop app, which runs from login, starts it with every sim run ([decision 002](../../decisions/002-core-starts-with-every-sim-run.md), [installing and updating](../install/01-installing-and-updating.md#one-program-from-login)).

Holding back a mouse click, such as one on the IDE's arrows or on a Dual Input object, is a different problem, and we haven't looked for a way ([Seat awareness](ideas.md#seat-awareness)).

**v1 builds** no input layer, but it builds the two things the layer starts from: a core that starts with every sim run, and a connection to the sim that comes up without a flight loaded, which v1 needs anyway, since Dual Input and the sim start in either order ([invite code](03-v1-scope.md#invite-code)).

## Roles

v1 has two roles: the PF, who holds control, and the traffic host, who keeps the role when control passes and is also the ATC host ([traffic sync](03-v1-scope.md#traffic-sync)).
A role is a session key a feature declares, naming its holder, and who may hold it is a guard on writing the key ([02-code-map](../architecture/02-code-map.md#what-a-feature-registers)).
Soon and Later picks add roles and duties:

- the machine that carries out ground services, which is the flying machine ([ground operations sync](ideas.md#ground-operations-sync))
- a weather source, who may not be the PF ([environment sync](ideas.md#environment-sync))
- the ATC host's new duty, taking the second pilot's microphone to ATC ([ATC sync](ideas.md#atc-sync))
- a flight engineer, whom control never passes to ([take-control key](03-v1-scope.md#take-control-key))
- passengers ([join modes](ideas.md#join-modes))

**v1 builds** one table of roles, which is the session's documentation, in [roles and members](../session/01-roles-and-members.md#the-table-of-roles), giving each role's rule for who holds it, how it moves, and what happens when its holder drops out, with the PF and the traffic host as its first two.

## People beyond the crew

A session can hold any number of people ([01-aims](01-aims.md#aims)).
A crew of any size already fits live sync.
Its vector clock gives each counter to a pilot's ID and their core's restart count ([architecture's tentative decisions](../architecture/decisions.md#a-pilot-keeps-their-id-through-a-core-restart-and-the-core-counts-its-restarts)), and between two following machines that didn't see each other's change, live sync takes the lower pilot ID's change ([02-live-sync](../sync/02-live-sync.md#when-two-pilots-change-one-entry)).
Passengers send almost nothing and can take more delay (unverified, [join modes](ideas.md#join-modes)), so they stay out of the vector clocks and off the crew's links, and take a feed from one crew machine or down a tree, because a link between every pair of people grows with the square of their number.

Each sim draws a figure for every person in the session, its own pilot's included in an outside view, so in v1 each sim draws two ([avatar sync](03-v1-scope.md#avatar-sync)).
The figure our p24 probe posed is 27 joints and a color, 28 values, set as global `L:` variables (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-our-own-figure-poses-in-the-sim-from-its-variables-plays-between-frames-smoothly-and-changes-color-through-asobo_property_animation)).
A model's animations name the variables they read, so with global variables every copy of the figure would take the same pose (unverified).
Variables of each figure's own object avoid that, with one model for every figure: 180 copies of a figure whose joints read `Z:` variables of their own object stood in poses and colors of their own (measured on MSFS 2024, 2026-10-05, [avatars log](../avatars/log.md#2026-10-05-each-figure-poses-from-its-own-objects-variables-and-costs-frame-time-in-view-and-almost-none-out-of-view)).

A cabin of 180 passengers is 5,040 values to write every frame.
As variables of each figure's own object they share 28 names, and they don't add to the sim's `L:` name table, which held 6,517 names before and after 1,000 figures (same log entry).
Writing them cost nothing measurable in the PA-24 runs, up to 28,000 values a frame.
In the A380 with traffic moving, written figures ran 2.2ms and 4.8ms slower than unwritten ones at 400 and 1,000, but not at 180, 600, or 800, which reads as the traffic's noise (unverified, same log entry).
Drawing a figure in view costs about 16µs to 21µs of frame time, and moving all its joints 10µs to 16µs more, while a figure out of view costs almost nothing, and one hidden behind the aircraft but in the view costs nearly as much as one in sight (same log entry).
So a cabin of 180 behind a pilot looking forward costs little.
In plain view in the iniBuilds A380, 180 figures cost about 3.4ms of frame time standing still and 7.2ms moving, and figures hidden behind the aircraft's own body, as a cabin is behind a closed cockpit door, cost about 80% of what they cost in view, at 600 and 1,000 figures (same log entry).
The network carries those figures too, so the avatar channel sends only what moved, at a lower rate for passengers, and at full rate only for the figures near a pilot's camera.

**v1 builds** a member list in which each member is crew or a passenger, vector clocks that hold only members who send, figures posed from their own objects' variables, and an avatar channel whose rate can differ by figure.

## One protocol for every client

In v1 the desktop app and the EFB app show Dual Input's state and send it commands, and decide nothing ([EFB app](03-v1-scope.md#efb-app)).
A cockpit panel can hold a WebSocket to a program on the same PC (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - Q08 yes: a cockpit document can hold a WebSocket to loopback"), with the sim's developer mode off (FS Copilot fork, `record/pointer-forwarding/docs/06-open-questions.md`, Q08).
The Fenix's MSFS 2024 tablet app shows its web app from `http://localhost:8083` (read in fnx-aircraft-320 2.4.0.4720, [Fenix study](../aircraft/fenix-a320-family/study.md)), which is a second route.
Both routes work from the documents the other clients would live in (measured on MSFS 2024, 2026-10-05, [interface log](../interface/log.md#2026-10-05-an-efb-app-the-toolbar-and-in-game-panels-each-reach-a-program-on-the-same-pc-by-websocket-and-http-and-can-show-a-page-it-serves)).
Code run in the EFB's document, standing in for an EFB app, held a WebSocket to a program on the same PC, got answers to HTTP requests, and loaded a page the program served in a hidden iframe, whose own WebSocket connected back.
Code in the toolbar's document and in Flow Pro's and ChasePlane's in-game panels did the same.
So the EFB app speaks the same protocol as a browser, rather than reach Dual Input through something only a sim panel has, such as `L:` variables.

- **The tablet in a browser** is one more client on the same protocol, reached across the home network.
  The tablet loads the PC's address, which the desktop app shows as a QR code that also carries a token, so other devices on the network can't take control.
  The tablet's design adds the listener beyond the PC that this needs, and that way in, without changing what v1 built, since the protocol takes nothing about a client from its address (user, 2026-10-15; [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#clients-beyond-the-pc)).
- **The Dual Input IDE** is one more client too, with commands of its own: discovering what an aircraft exposes, live values, running one entry's write, and reloading a profile mid-session.

**v1 builds** one protocol that every client speaks, and no listener beyond the PC.
An EFB app loaded the sim's way, rather than code in the EFB's document, is untried, and so is an in-game panel of our own.

## Profiles

- **Watch-only entries:** an entry with no `write` is watched on every machine and compared, never written ([01-profile-entries](../sync/01-profile-entries.md#writing-a-value)).
  The rest of the [pre-sync checklist](ideas.md#pre-sync-checklist) uses them to tick off a control once both cockpits agree on it, and [what doesn't sync](ideas.md#what-doesnt-sync) uses them to name a control nobody can sync.
- **Plugin values:** a profile watches a value a plugin exports, and sets it through the plugin's write method, as it would a variable ([Plugins](#plugins)).
- **Requests:** for an action any pilot asks for and only the flying machine carries out, such as a pushback ([ground operations sync](ideas.md#ground-operations-sync)).
  The direction field is `owner`, whose values name roles, and a pushback still belongs to the PF, so a request comes later as a field of its own ([01-format-and-delivery](../profiles/01-format-and-delivery.md)).
  The input layer keeps the asking pilot's own sim from acting on it.
- **A profile's identity:** the core computes each profile's hash, and a profile carries no version of its own ([01-format-and-delivery](../profiles/01-format-and-delivery.md)).
  In v1 the [preflight match check](03-v1-scope.md#preflight-match-check) compares the hashes, and the same hash tells a pilot's Dual Input which of our own profiles to fetch from the [registry](ideas.md#profile-registry), since profiles and plugins reach pilots apart from Dual Input's releases ([architecture's tentative decisions](../architecture/decisions.md#profiles-and-plugins-reach-pilots-apart-from-dual-inputs-releases), 2026-10-08).
- **New blocks:** the format takes blocks beyond `state:` and `events:`, such as the checklist's items or the controls that don't sync, each with its reason.

**v1 builds** watch-only entries, the direction field `owner`, profile hashes the core computes, which the match check compares and the fetch by hash of our own profiles uses, and a format that takes new blocks.

## Recording

- **The debrief timeline** plays a flight back from the recording ([flight recorder and debrief](ideas.md#flight-recorder-and-debrief)).
  v1 gives it no format, and it's built only if it fits without pressing on other design (user, 2026-10-16).
- **Telemetry** sends the event v1 raises when a write never lands, the one that marks the recording and puts a notification on the banner ([02-live-sync](../sync/02-live-sync.md#checking-that-a-write-landed)), carrying nothing that identifies the pilot ([telemetry](ideas.md#telemetry)).
- **Plugin tests:** what they need from the recording is left to the plugins' design (user, 2026-10-16).

**v1 builds** a recording that's a replay log of every input the core takes, and after v1 each run gains an index of its sessions, the one record a later version reads (user, 2026-10-21; [01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md)).

## By pick

| Pick | Needs | Also needs |
| --- | --- | --- |
| [Ground operations sync](ideas.md#ground-operations-sync) | [Channels](#channels), [plugins](#plugins), [input layer](#an-input-layer), [roles](#roles), [profiles](#profiles) | What the GSX plugin has to handle, left until it's built ([Plugins](ideas.md#plugins)) |
| [Soft takeover](ideas.md#soft-takeover-on-handover) | [Input layer](#an-input-layer), [plugins](#plugins) | Showing the new PF which levers haven't picked up |
| [Mixed flight controls](ideas.md#mixed-flight-controls) | [Channels](#channels), [input layer](#an-input-layer), [plugins](#plugins) | A decision in `record/decisions/` before it's built |
| The rest of the [pre-sync checklist](ideas.md#pre-sync-checklist), and state watching | [Profiles](#profiles) | |
| [Dual Input IDE](ideas.md#dual-input-ide) | [One protocol](#one-protocol-for-every-client), [code inside the sim](#code-inside-the-sim) | A way to hold back a click on its arrows ([input layer](#an-input-layer)), and the single-machine setup in step 7 of [the plan](plan.md) for its two-instance write test |
| The voice phrases, from [voice handover](ideas.md#voice-handover) | No section of this document: v1's core helper leaves room for a want of phrases and the `Listener` trait that [04-core-helper](../core/04-core-helper.md#speech) designs, and a voice answer is one more `TakeControl` request | A detector, a recognizer, and a way for an offer to reach the other machine, which the [control log](../control/log.md#2026-10-17-research-puts-silero-vad-and-sherpa-onnx-ahead-for-recognizing-the-voice-phrases-on-the-pilots-pc-and-the-voice-phrases-move-to-soon)'s research starts |
| [Bus bridge](ideas.md#bus-bridge) | [Channels](#channels), [catch-up pipeline](#a-catch-up-pipeline), [plugins](#plugins), [code inside the sim](#code-inside-the-sim) | Whether a carried message changes the receiving aircraft's state, a probe deferred until after v1 ([the plan](plan.md)'s step 6) |
| [EventBus bridge](ideas.md#eventbus-bridge) | [Channels](#channels), [catch-up pipeline](#a-catch-up-pipeline), [code inside the sim](#code-inside-the-sim) | Which topics belong to the aircraft rather than to one machine, and carrying them between two machines ([EventBus bridge](ideas.md#eventbus-bridge)) |
| [WASM instrument sync](ideas.md#wasm-instrument-sync) | [Plugins](#plugins), [code inside the sim](#code-inside-the-sim) | |
| [Aircraft adapters](ideas.md#aircraft-adapters) | [Plugins](#plugins), [catch-up pipeline](#a-catch-up-pipeline), [code inside the sim](#code-inside-the-sim) | Whether code injected into the A220's DisplayUnits documents reaches its Redux store, a panel probe |
| The second pilot's mic reaching ATC, from [ATC sync](ideas.md#atc-sync) | [Channels](#channels), [roles](#roles), [plugins](#plugins) | In v1 a pilot's microphone never leaves their machine ([voice phrases](03-v1-scope.md#voice-phrases)), and this sends it when the pilot chooses, by a means still open |
| Weather, from [environment sync](ideas.md#environment-sync) | [Channels](#channels), [roles](#roles) | How to set the weather from outside the sim, which is unknown |
| Home-network discovery, from [one-click invite](ideas.md#one-click-invite) | | Joining from a session found on the home network as well as from a code |
| Crews beyond two, and passengers, from [join modes](ideas.md#join-modes) | [People beyond the crew](#people-beyond-the-crew), [roles](#roles), [channels](#channels) | A lighter figure for passengers, such as a seated one without legs, since a figure in view costs frame time ([avatars log](../avatars/log.md#2026-10-05-each-figure-poses-from-its-own-objects-variables-and-costs-frame-time-in-view-and-almost-none-out-of-view)) |
| The tablet in a browser, from [Dual Input's interface](ideas.md#dual-inputs-interface-in-the-efb-and-on-a-tablet) | [One protocol](#one-protocol-for-every-client) | A listener beyond the PC, and a way in, which the tablet's design adds |
| The debrief timeline, from [flight recorder and debrief](ideas.md#flight-recorder-and-debrief) | [Recording](#recording) | The viewer, and a format, since v1 gives it none |
| Automatic profile fetch, and the community registry, from [profile registry](ideas.md#profile-registry) | [Profiles](#profiles), [channels](#channels) | |
| [What doesn't sync](ideas.md#what-doesnt-sync) | [Profiles](#profiles) | |
| [Dual Input objects in the cockpit](ideas.md#dual-input-objects-in-the-cockpit) | [Code inside the sim](#code-inside-the-sim) | A way to hold back a click on one ([input layer](#an-input-layer)), and whether an object our WASM module writes holds still enough, since [decision 001](../../decisions/001-changing-other-developers-packages.md) rules out attaching it through the aircraft's files |
| [Telemetry](ideas.md#telemetry) | [Recording](#recording) | A server, which could be the one bug reports use |
