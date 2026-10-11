# Product: room for later

```text
Purpose:     What each Soon and Later pick needs from what v1 builds, so it slots in without rework.
Depends on:  01-aims.md, 03-v1-scope.md, ../sync/01-profile-entries.md, ../sync/02-live-sync.md, ../sync/03-catch-up.md
Decides:     What Crosscheck must allow for each Soon and Later pick, and what v1 builds now so that it does.
```

> **Note**
> A plugin's code runs only in the core, though [Code inside the sim](#code-inside-the-sim) and [Plugins](#plugins) below give plugins hooks in the cockpit panels and the WASM module: our panel bridge and module carry out what a plugin asks of them through generic APIs ([architecture's tentative decisions](../architecture/decisions.md#plugin-code-runs-only-in-the-core), 2026-10-08).
> The helper the sim launches, in [An input layer](#an-input-layer) below, is the watcher's job in [the architecture's spine](../architecture/01-spine.md#components) (user, 2026-10-06), and the spine's helper is the core's process for Windows input and audio.
> Since 2026-10-09, each vector clock counter belongs to a pilot's ID and their core's restart count, where [People beyond the crew](#people-beyond-the-crew) below keeps one counter per pilot ([architecture's tentative decisions](../architecture/decisions.md#a-pilot-keeps-their-id-through-a-core-restart-and-the-core-counts-its-restarts)).
> Profiles and plugins reach pilots apart from Crosscheck's releases, so the [profile registry](#profiles)'s fetch by hash comes in v1 for our own profiles ([architecture's tentative decisions](../architecture/decisions.md#profiles-and-plugins-reach-pilots-apart-from-crosschecks-releases), 2026-10-08).
> Since 2026-10-11, v1's [catch-up pipeline](#a-catch-up-pipeline) has one step, catching up state, because the time, date, and simulation rate reach a late joiner as session keys, and traffic as the host's identity set, neither as a step ([04-order-and-recovery](../sync/04-order-and-recovery.md#catch-up)); v1's table of [roles](#roles) is in [roles and members](../session/01-roles-and-members.md#the-table-of-roles).
> Since 2026-10-11, the flight model's samples also carry the PF's yoke, rudder, and toe-brake positions, and v1 adds two channels to the six below: catch-up's stream from the flying machine, and a heartbeat once a second from every machine, carrying the clock exchange and the replay's acknowledgments; how channels travel, the session channel as the newest value of each key and the cockpit's as the one replayed log, is in [01-between-machines](../network/01-between-machines.md#channels).
> Since 2026-10-11, the direction field in [profiles](#profiles) is `owner`, whose values name roles, and a request comes later as a field of its own, since a pushback still belongs to the PF; the core computes a profile's hash, and a profile carries no version of its own; and a plugin reaches only the sim and the aircraft, through Crosscheck's APIs, where [plugins](#plugins) lets it read the pilot's files ([01-format-and-delivery](../profiles/01-format-and-delivery.md)).

v1 builds what each Soon and Later pick in [the plan](plan.md) needs from it, so no pick rebuilds part of v1, because v1 gives up features, never design ([01-aims](01-aims.md#aims)).
That's channels that each declare how they travel, catch-up as a pipeline of steps, plugins and the hooks they use, hosts inside the sim that load modules by name, one table of roles, a session that holds passengers, one protocol for every client, a profile format with room to grow, and a versioned recording.
The one need v1 doesn't build is the input layer, and v1 builds the two things it starts from: a helper the sim launches, and a connection to the sim that comes up with no flight loaded.
A pick can still need work of its own, which [By pick](#by-pick) names beside the sections it needs.

Each section below names the picks that need it and ends with what v1 builds.
Crosscheck's own code is everything Crosscheck ships except [plugins](03-v1-scope.md#plugins) and profiles.
The flying machine is the PF's, and a following machine is any other pilot's.

## Channels

A channel is what one feature sends, or several features whose messages must apply in one order: its messages, how they travel, how they're recorded, and how a cockpit catches up on them.
A channel that doesn't join the cockpit's shared order changes nothing for the others but the bandwidth, and removing a channel removes all of it.

v1 has six channels:

| Channel | From | To | Needs |
| --- | --- | --- | --- |
| Session: joins, Ready, control, and the time, date, sim rate, and pause | Every machine | Every other | Every message, in order |
| Cockpit: state, events, and pointer presses | Every machine | Every other | Every message, in causal order ([02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order)) |
| Flight model | The flying machine | Following machines | Only the newest sample ([02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order)) |
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

- who sends it and who receives it
- its delivery: every message in order, only the newest value for each key, or the lowest delay with loss acceptable
- its priority, so a bulk transfer never delays the flight model or the axes
- whether it joins the cockpit's shared order

The shared order is the causal order [02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order) gives the cockpit's messages, so that a page key always lands before a press on the page it opened.
A channel joins it when its messages must apply in order with the cockpit's, as a bus message that opens a page would.
A channel that writes into the sim uses live sync's echo tokens ([02-live-sync](../sync/02-live-sync.md#keeping-a-change-from-applying-twice)).
If the EventBus bridge publishes a carried topic through one of the receiving machine's buses with the `sync` flag, that bus sends it out again under `wt.eb.evt`, as it does every synced topic, and our listener there hears it as a new change to send back.
Handed in as another bus's package, the topic may not go out again, because each bus publishes other buses' packages locally and skips its own (read in the A220's DisplayUnits bundle, [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)).
The bridge can hand topics in that way: a package our code sent under `wt.eb.evt` with a `busId` of its own, carrying the Phenom 300E's G3000 MFD's zoom-in, moved the MFD's map (measured on MSFS 2024, 2026-10-06, [CommBus log](../commbus/log.md#2026-10-06-our-own-code-hears-wtebevt-from-the-efbs-document-and-the-g3000-acts-on-a-package-it-sends)).

Traffic sync's object mirroring and hearing ATC's capture by process are kinds of channel that any feature or plugin can open, and a GSX plugin would be built mostly from those two ([Plugins](ideas.md#plugins)).
Traffic sync picks the objects it carries through a filter that a plugin can claim objects from, so when a GSX plugin carries GSX's vehicles, the crew doesn't see each one twice.

**v1 builds** a transport in which each channel declares those four things, v1's six channels as separate channels, object mirroring and audio capture as channel kinds, and traffic sync's filter.

## A catch-up pipeline

Catch-up is a pipeline of steps, and [catching up state](../sync/03-catch-up.md#catching-up-state) is one of them.
v1 needs others: a late joiner also takes the PF's time of day, date, and simulation rate ([time, date, sim rate, and pause](03-v1-scope.md#time-date-sim-rate-and-pause)), and the traffic it hasn't seen.
Each step says where it runs relative to the others, such as after state so the battery is on, and how it checks that it landed.
Later picks add steps:

- **Bus bridge:** a bridge that forwards whole CommBus messages needs a step that sends `A22X.Resync`, after which the A220 sent a full snapshot on each of the 29 CommBus channels that carry its changes ([CommBus log](../commbus/log.md#2026-09-28-a22xresync-returns-the-a220s-full-state-and-one-listener-hears-every-channel)).
  An A220 plugin that uses `A22X.Resync` only to read the fields its profile needs, and exports those, needs no step, since its values are ordinary entries.
- **EventBus bridge:** a step that publishes `resync_request`, which has every synced topic sent again (read in the A220's DisplayUnits bundle, [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)).
  Sent from our listener in the EFB's document, it had the Phenom 300E's buses send that listener 306 distinct topics within 5s, while the MFD's listener got 26, for a reason we haven't found (measured on MSFS 2024, 2026-10-06, [CommBus log](../commbus/log.md#2026-10-06-our-own-code-hears-wtebevt-from-the-efbs-document-and-the-g3000-acts-on-a-package-it-sends)); whether 306 is every synced topic is unverified.
- **Aircraft adapters:** a step in an adapter's plugin for state that isn't one value, such as loading a PMDG 777 panel state, which its CDU does by name (unverified), though whether the 777 loads one mid-flight is untested; loading one from the CDU in flight settles both ([aircraft adapters](ideas.md#aircraft-adapters)).

After a short outage, each channel replays its own missed messages, and the channels in the cockpit's shared order replay together, as [03-catch-up](../sync/03-catch-up.md#replaying-a-short-outage) replays state changes, events, and presses in one sequence.

**v1 builds** catch-up as a pipeline whose steps v1's own channels fill.

## Plugins

A plugin is code we ship for one aircraft or one add-on, and code that serves one product lives in a plugin, never in Crosscheck's own code ([03-v1-scope](03-v1-scope.md#plugins)).

A plugin's first job is to find state the profile can't reach and export it as values, `plugin.state.<name>`, which the profile watches as it watches an `L:` variable ([01-profile-entries](../sync/01-profile-entries.md#watching-a-value)).
For each value it can set, the plugin registers a write method, which the engine calls as `writer.plugin().<name>(value)`; the plugin itself never calls the writer ([01-profile-entries](../sync/01-profile-entries.md#the-writer-api)).
Live sync, read-back, the conflict rule, catch-up, pacing, and echo marking then cover a plugin's values and writes as they cover any entry, with no code of the plugin's.
The 58P's plugin does that for the radio settings that live only in its gauges' JavaScript ([03-v1-scope](03-v1-scope.md#plugins)).

For what isn't a value, a plugin reaches every layer through hooks:

- moments in a session, such as an aircraft loading, preflight ending, and control passing
- channels of its own, of the kinds above
- steps in the catch-up pipeline
- code inside the sim, in the aircraft's panels and in a WASM module ([below](#code-inside-the-sim))

Where no hook reaches, a plugin reads the sim, the aircraft's panels, and the pilot's files directly, since we review every plugin, and it changes what Crosscheck watches only in its write methods ([03-v1-scope](03-v1-scope.md#plugins)).
Each aircraft has one plugin, and plugins for aircraft that share code share it through a library rather than a copy.

These picks put their product-specific parts in plugins:

- aircraft adapters, such as the A220's Redux store and the PMDG 777's panel state ([aircraft adapters](ideas.md#aircraft-adapters))
- the bus bridge's parts for one aircraft, such as sending the A220's `A22X.Resync` ([bus bridge](ideas.md#bus-bridge))
- mixed flight controls' rule for each aircraft type, such as a hypothetical Airbus rule that reads whether the autopilot is engaged
- masking for an aircraft whose inputs a profile can't describe ([soft takeover](ideas.md#soft-takeover-on-handover))
- the patch the iniBuilds A350's module needs for its displays to take a forwarded press ([WASM instrument sync](ideas.md#wasm-instrument-sync), [decision 001](../../decisions/001-changing-other-developers-packages.md))
- GSX, and each ATC service the second pilot's microphone would reach, such as VATSIM, SayIntentions, or BeyondATC ([ATC sync](ideas.md#atc-sync))

The EventBus bridge puts no part in a plugin, because it would serve every avionics suite that keeps its state on the framework's bus ([EventBus bridge](ideas.md#eventbus-bridge)).

Crosscheck's own code owns each mechanism, and a plugin owns the policy.
The input layer masks, and a plugin says what to hold back; the axes channel carries the PM's input, and a plugin mixes it.
Two plugins then never fight over one mechanism, and every mechanism keeps the fail-open rules [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) sets for anything in the pilot's input path.

v1's own features are built on the hooks plugins use, so the hooks carry more than the 58P plugin's work from the first release, and a later feature is one more module on them.

**v1 builds** plugin values and write methods in the profile and the writer, the hooks, v1's features on them, and the 58P's plugin.

## Code inside the sim

v1 runs code inside the sim in two places, and both load what they run by name, so features and plugins add to them without changing them:

- **The panel bridge,** which v1 injects into the aircraft's panel documents for pointer sync, loads a module for each instrument a feature or a plugin names.
  The bus bridge and adapters such as the A220's each need a listener inside an instrument's document ([bus bridge](ideas.md#bus-bridge), [aircraft adapters](ideas.md#aircraft-adapters)).
  The [EventBus bridge](ideas.md#eventbus-bridge)'s listener can't be one of the panel bridge's modules: inside an instrument's document it misses that instrument's own bus, while in the EFB's document it heard all five of the Phenom 300E's G3000 buses (measured on MSFS 2024, 2026-10-06, [CommBus log](../commbus/log.md#2026-10-06-our-own-code-hears-wtebevt-from-the-efbs-document-and-the-g3000-acts-on-a-package-it-sends)).
  It runs in the EFB's document, beside the EFB app, and which host loads it there is open.
  A syntax error in a panel file takes out the whole file, not one line, and one broken shared `VCockpit.js` once broke every instrument in the sim (FS Copilot fork, `record/conventions.md`), so the bridge loads each module from its own file, and one module's error reaches no other.
  Later it also passes presses to displays drawn by WASM code, by sending mouse events to the display's canvas in its panel document: the iniBuilds A380's displays pressed at the position our fork sent that way, once told the mouse entered them (measured on MSFS 2024, 2026-09-23, FS Copilot fork, `record/wasm-pointer/docs/log.md`, "2026-09-23 — The A380 presses where we say once the display is told the mouse entered it; the A350 does not").
- **The WASM module,** which places figures in v1 ([avatar sync](03-v1-scope.md#avatar-sync)), places objects of any kind.
  Later it places [Crosscheck objects in the cockpit](ideas.md#crosscheck-objects-in-the-cockpit) and the arrows the [Crosscheck IDE](ideas.md#seat-awareness) draws on a figure to place it.

**v1 builds** both as hosts that load modules by name.

## An input layer

Several picks hold a pilot's input back from their own sim:

- [Soft takeover](ideas.md#soft-takeover-on-handover) holds the new PF's levers until they pick up.
- [Mixed flight controls](ideas.md#mixed-flight-controls) holds the PM's axes and sends them to the flying machine.
- Blocking a cut-off pilot's switches, an open question in [the connection](03-v1-scope.md#the-connection), holds those.
- [Ground operations sync](ideas.md#ground-operations-sync) holds a PM's pushback request, such as `K:TOGGLE_PUSHBACK`, so that only the flying machine carries it out.

Masking holds the axis events back on stock flight controls and the PMDG 777, and the block ends when the masking client dies (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)).
On an aircraft whose module asks for the same priority, such as the A2A PA-24, masks work only if they're in place before the aircraft loads ([flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)).
So the part of Crosscheck that masks has to be able to start with the sim, and in v1 the sim launches a helper of ours ([installing and updating](03-v1-scope.md#installing-and-updating)).

Holding back a mouse click, such as one on the IDE's arrows or on a Crosscheck object, is a different problem, and we haven't looked for a way ([Seat awareness](ideas.md#seat-awareness)).

**v1 builds** no input layer, but it builds the two things the layer starts from: a helper the sim launches, and a connection to the sim that comes up without a flight loaded, which v1 needs anyway, since Crosscheck and the sim start in either order ([invite code](03-v1-scope.md#invite-code)).

## Roles

v1 has two roles: the PF, who holds control, and the traffic host, who keeps the role when control passes and is also the ATC host ([traffic sync](03-v1-scope.md#traffic-sync)).
Soon and Later picks add roles and duties:

- the machine that carries out ground services, which is the flying machine ([ground operations sync](ideas.md#ground-operations-sync))
- a weather source, who may not be the PF ([environment sync](ideas.md#environment-sync))
- the ATC host's new duty, taking the second pilot's microphone to ATC ([ATC sync](ideas.md#atc-sync))
- a flight engineer, whom control never passes to ([take-control key](03-v1-scope.md#take-control-key))
- passengers ([join modes](ideas.md#join-modes))

**v1 builds** one table of roles, each with its rule for who holds it, how it moves, and what happens when its holder drops out, with the PF and the traffic host as its first two.

## People beyond the crew

A session can hold any number of people ([01-aims](01-aims.md#aims)).
A crew of any size already fits live sync, which keeps one vector clock counter per pilot and, between two following machines that didn't see each other's change, takes the lower pilot ID's ([02-live-sync](../sync/02-live-sync.md#when-two-pilots-change-one-entry)).
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

In v1 the desktop app and the EFB app show Crosscheck's state and send it commands, and decide nothing ([EFB app](03-v1-scope.md#efb-app)).
A cockpit panel can hold a WebSocket to a program on the same PC (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - Q08 yes: a cockpit document can hold a WebSocket to loopback"), with the sim's developer mode off (FS Copilot fork, `record/pointer-forwarding/docs/06-open-questions.md`, Q08).
The Fenix's MSFS 2024 tablet app shows its web app from `http://localhost:8083` (read in fnx-aircraft-320 2.4.0.4720, [Fenix study](../aircraft/fenix-a320-family/study.md)), which is a second route.
Both routes work from the documents the other clients would live in (measured on MSFS 2024, 2026-10-05, [interface log](../interface/log.md#2026-10-05-an-efb-app-the-toolbar-and-in-game-panels-each-reach-a-program-on-the-same-pc-by-websocket-and-http-and-can-show-a-page-it-serves)).
Code run in the EFB's document, standing in for an EFB app, held a WebSocket to a program on the same PC, got answers to HTTP requests, and loaded a page the program served in a hidden iframe, whose own WebSocket connected back.
Code in the toolbar's document and in Flow Pro's and ChasePlane's in-game panels did the same.
So the EFB app speaks the same protocol as a browser, rather than reach Crosscheck through something only a sim panel has, such as `L:` variables.

- **The tablet in a browser** is one more client on the same protocol, reached across the home network.
  The tablet loads the PC's address, which the desktop app shows as a QR code that also carries a token, so other devices on the network can't take control.
- **The Crosscheck IDE** is one more client too, with commands of its own: discovering what an aircraft exposes, live values, running one entry's write, and reloading a profile mid-session.

**v1 builds** one protocol that every client speaks, which can listen beyond the PC itself, off by default.
An EFB app loaded the sim's way, rather than code in the EFB's document, is untried, and so is an in-game panel of our own.

## Profiles

- **Watch-only entries:** an entry with no `write` is watched on every machine and compared, never written ([01-profile-entries](../sync/01-profile-entries.md#writing-a-value)).
  The rest of the [pre-sync checklist](ideas.md#pre-sync-checklist) uses them to tick off a control once both cockpits agree on it, and [what doesn't sync](ideas.md#what-doesnt-sync) uses them to name a control nobody can sync.
- **Plugin values:** a profile watches a value a plugin exports, and sets it through the plugin's write method, as it would a variable ([Plugins](#plugins)).
- **Requests:** a third direction beside the PF's entries and shared ones ([01-profile-entries](../sync/01-profile-entries.md#choosing-who-sends)), for an action any pilot asks for and only the flying machine carries out, such as a pushback ([ground operations sync](ideas.md#ground-operations-sync)).
  The input layer keeps the asking pilot's own sim from acting on it.
- **A profile's identity:** each profile carries its version and a hash of its contents.
  In v1 the [preflight match check](03-v1-scope.md#preflight-match-check) compares them, and once profiles come from a [registry](ideas.md#profile-registry), the same hash tells a pilot's Crosscheck which profile to fetch.
- **New blocks:** the format takes blocks beyond `state:` and `events:`, such as the checklist's items or the controls that don't sync, each with its reason.

**v1 builds** watch-only entries, plugin values, a direction field with room for a third value, profile hashes the match check compares, and a format that takes new blocks.

## Recording

- **The debrief timeline** plays a flight back from the recording ([flight recorder and debrief](ideas.md#flight-recorder-and-debrief)).
  So the recording holds the flight model's track, the handovers, and every channel with its timing, in a format later versions of Crosscheck still read, and the crew's recordings merge by the session's ID and the vector clocks.
- **Telemetry** sends the event v1 raises when a write never lands, the one that marks the recording and puts a notice on the banner ([02-live-sync](../sync/02-live-sync.md#checking-that-a-write-landed)), carrying nothing that identifies the pilot ([telemetry](ideas.md#telemetry)).
- **Plugin tests:** the recorder keeps every value a plugin exported and every write method Crosscheck called on it, so a test replays a recorded flight against the plugin's profile entries and checks what Crosscheck did with those values, with no copy of the aircraft.
  The author writes no test: they fly with recording on, as pilots do for [bug reports](03-v1-scope.md#recording-and-bug-reports).
  The plugin's own reads and writes into the aircraft's panels, such as into the A220's Redux store, run only in the sim, and only flying with the plugin checks them.

**v1 builds** a versioned recording format with the flight model's samples, each channel recording itself, and each plugin's exported values and the write methods Crosscheck called on it, as [recording and bug reports](03-v1-scope.md#recording-and-bug-reports) scopes.

## By pick

| Pick | Needs | Also needs |
| --- | --- | --- |
| [Ground operations sync](ideas.md#ground-operations-sync) | [Channels](#channels), [plugins](#plugins), [input layer](#an-input-layer), [roles](#roles), [profiles](#profiles) | What the GSX plugin has to handle, left until it's built ([Plugins](ideas.md#plugins)) |
| [Soft takeover](ideas.md#soft-takeover-on-handover) | [Input layer](#an-input-layer), [plugins](#plugins) | Showing the new PF which levers haven't picked up |
| [Mixed flight controls](ideas.md#mixed-flight-controls) | [Channels](#channels), [input layer](#an-input-layer), [plugins](#plugins) | A decision in `record/decisions/` before it's built |
| The rest of the [pre-sync checklist](ideas.md#pre-sync-checklist), and state watching | [Profiles](#profiles) | |
| [Crosscheck IDE](ideas.md#crosscheck-ide) | [One protocol](#one-protocol-for-every-client), [code inside the sim](#code-inside-the-sim) | A way to hold back a click on its arrows ([input layer](#an-input-layer)), and the single-machine setup in step 7 of [the plan](plan.md) for its two-instance write test |
| [Bus bridge](ideas.md#bus-bridge) | [Channels](#channels), [catch-up pipeline](#a-catch-up-pipeline), [plugins](#plugins), [code inside the sim](#code-inside-the-sim) | Whether a carried message changes the receiving aircraft's state, a probe deferred until after v1 ([the plan](plan.md)'s step 6) |
| [EventBus bridge](ideas.md#eventbus-bridge) | [Channels](#channels), [catch-up pipeline](#a-catch-up-pipeline), [code inside the sim](#code-inside-the-sim) | Which topics belong to the aircraft rather than to one machine, and carrying them between two machines ([EventBus bridge](ideas.md#eventbus-bridge)) |
| [WASM instrument sync](ideas.md#wasm-instrument-sync) | [Plugins](#plugins), [code inside the sim](#code-inside-the-sim) | |
| [Aircraft adapters](ideas.md#aircraft-adapters) | [Plugins](#plugins), [catch-up pipeline](#a-catch-up-pipeline), [code inside the sim](#code-inside-the-sim) | Whether code injected into the A220's DisplayUnits documents reaches its Redux store, a panel probe |
| The second pilot's mic reaching ATC, from [ATC sync](ideas.md#atc-sync) | [Channels](#channels), [roles](#roles), [plugins](#plugins) | In v1 a pilot's microphone never leaves their machine ([voice phrases](03-v1-scope.md#voice-phrases)), and this sends it when the pilot chooses, by a means still open |
| Weather, from [environment sync](ideas.md#environment-sync) | [Channels](#channels), [roles](#roles) | How to set the weather from outside the sim, which is unknown |
| Home-network discovery, from [one-click invite](ideas.md#one-click-invite) | | Joining from a session found on the home network as well as from a code |
| Crews beyond two, and passengers, from [join modes](ideas.md#join-modes) | [People beyond the crew](#people-beyond-the-crew), [roles](#roles), [channels](#channels) | A lighter figure for passengers, such as a seated one without legs, since a figure in view costs frame time ([avatars log](../avatars/log.md#2026-10-05-each-figure-poses-from-its-own-objects-variables-and-costs-frame-time-in-view-and-almost-none-out-of-view)) |
| The tablet in a browser, from [Crosscheck's interface](ideas.md#crosschecks-interface-in-the-efb-and-on-a-tablet) | [One protocol](#one-protocol-for-every-client) | |
| The debrief timeline, from [flight recorder and debrief](ideas.md#flight-recorder-and-debrief) | [Recording](#recording) | The viewer |
| Automatic profile fetch, and the community registry, from [profile registry](ideas.md#profile-registry) | [Profiles](#profiles), [channels](#channels) | |
| [What doesn't sync](ideas.md#what-doesnt-sync) | [Profiles](#profiles) | |
| [Crosscheck objects in the cockpit](ideas.md#crosscheck-objects-in-the-cockpit) | [Code inside the sim](#code-inside-the-sim) | A way to hold back a click on one ([input layer](#an-input-layer)), and whether an object our WASM module writes holds still enough, since [decision 001](../../decisions/001-changing-other-developers-packages.md) rules out attaching it through the aircraft's files |
| [Telemetry](ideas.md#telemetry) | [Recording](#recording) | A server, which could be the one bug reports use |
