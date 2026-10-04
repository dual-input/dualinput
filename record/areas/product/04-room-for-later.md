# Product: room for later

```text
Purpose:     What each Soon and Later pick needs from what v1 builds, so it slots in without rework.
Depends on:  01-aims.md, 03-v1-scope.md, ../sync/01-profile-entries.md, ../sync/02-live-sync.md, ../sync/03-catch-up.md
Decides:     What Crosscheck's core must allow for each Soon and Later pick, and what v1 builds now so that it does.
```

The Soon and Later picks in [the plan](plan.md) need ten things from what v1 builds.
v1 builds all ten, so any pick slots in the day after v1 ships, because v1 gives up features, never design ([01-aims](01-aims.md#aims)).
Each section below names the picks that need it and ends with what v1 builds, and [By pick](#by-pick) maps each pick to its sections.

The core is everything Crosscheck ships except [plugins](03-v1-scope.md#plugins) and profiles.
The flying machine is the PF's, and a following machine is any other pilot's.

## Channels

A channel is everything one feature sends: its messages, how they travel, how they're recorded, and how a cockpit catches up on them.
Adding a channel changes nothing for the others but the bandwidth, and removing one removes all of it.

v1 already sends five kinds of traffic:

| Channel | From | To | Needs |
| --- | --- | --- | --- |
| Cockpit: state, events, and pointer presses | Every machine | Every other | Every message, in causal order ([02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order)) |
| Flight model | The flying machine | Following machines | Only the newest sample ([02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order)) |
| Avatars | Every machine | Every other | The newest pose of each figure |
| Traffic | The traffic host | The others | Each object's identity reliably, and its newest sample (FS Copilot fork, `record/traffic-atc/docs/04-transport.md`) |
| ATC audio | The ATC host | The others | Low delay, with loss acceptable |

Later picks add more:

- the PM's axes, to the flying machine, at the lowest delay ([mixed flight controls](ideas.md#mixed-flight-controls))
- a pilot's microphone, to the ATC host ([ATC sync](ideas.md#atc-sync))
- a one-way feed to passengers, which can take more delay ([join modes](ideas.md#join-modes))
- bulk transfers, such as the A220's full state, which `A22X.Resync` returns as 1,674 fields in about 100ms (measured on MSFS 2024, 2026-09-28, [CommBus log](../commbus/log.md#2026-09-28-a22xresync-returns-the-a220s-full-state-and-one-listener-hears-every-channel)), or a profile sent to a pilot who lacks it ([profile registry](ideas.md#profile-registry))
- an aircraft's bus messages and EventBus topics ([bus bridge](ideas.md#bus-bridge), [EventBus bridge](ideas.md#eventbus-bridge))
- a plugin's own objects and sound, such as GSX's ([Plugins](ideas.md#plugins))

How channels map onto the wire is the transport's job, by the rule our FS Copilot fork's transport came to: two streams share an ordering domain only if neither is hurt by waiting behind the other (FS Copilot fork, `record/traffic-atc/docs/04-transport.md`, "Channels are ordering domains").
The fork found it when a joining peer received about 130 traffic identities on its one reliable ordered channel, and every cockpit update waited behind them (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-08 · Unreliable never crossed the relay; relay protocol v2, channels, budgets").
So each channel declares:

- who sends it and who receives it
- its delivery: every message in order, only the newest value for each key, or the lowest delay with loss acceptable
- its priority, so a bulk transfer never delays the flight model or the axes
- whether it joins the cockpit's shared order

The shared order is a service a channel joins, as the cockpit's messages do, so that a page key always lands before a press on the page it opened ([02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order)).
A bus message that opens a page would join it for the same reason.
A channel that writes into the sim uses live sync's echo tokens ([02-live-sync](../sync/02-live-sync.md#keeping-a-change-from-applying-twice)).
A topic the EventBus bridge republishes, for one, would otherwise go back out under `wt.eb.evt` from the receiving machine.

Traffic sync's object mirroring and hearing ATC's capture by process are kinds of channel that any feature or plugin can open, and a GSX plugin would be built mostly from those two ([Plugins](ideas.md#plugins)).
Traffic sync picks the objects it carries through a filter that a plugin can claim objects from, so when a GSX plugin carries GSX's vehicles, the crew doesn't see each one twice.

**v1 builds** a transport in which each channel declares those four things, v1's five channels as separate channels, object mirroring and audio capture as channel kinds, and traffic sync's filter.

## A catch-up pipeline

Catch-up is a pipeline of steps, and [catching up state](../sync/03-catch-up.md#catching-up-state) is its first.
Each step says where it runs relative to the others, such as after state so the battery is on, and how it checks that it landed.
Later picks add steps:

- **Bus bridge:** sending `A22X.Resync` made each of the A220's 29 change-sending channels send a full snapshot ([CommBus log](../commbus/log.md#2026-09-28-a22xresync-returns-the-a220s-full-state-and-one-listener-hears-every-channel)).
- **EventBus bridge:** a new instrument's bus publishes `resync_request` to have every synced topic sent again (read in the A220's DisplayUnits bundle, [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)).
- **Aircraft adapters,** each a plugin, such as one that copies the A220's display formats out of its DisplayUnits' Redux store ([aircraft adapters](ideas.md#aircraft-adapters)).

After a short outage, each channel replays its own missed messages, and the channels in the cockpit's shared order replay together, as [03-catch-up](../sync/03-catch-up.md#replaying-a-short-outage) replays state changes, events, and presses in one sequence.

**v1 builds** catch-up as a pipeline with state as its first step, so the 58P's plugin can add a second.

## Plugins

A plugin is code we ship for one aircraft or one add-on, and code that serves one product lives in a plugin, never in the core ([03-v1-scope](03-v1-scope.md#plugins)).
These picks put their product-specific parts in plugins:

- aircraft adapters, such as the A220's Redux store and the PMDG 777's panel state ([aircraft adapters](ideas.md#aircraft-adapters))
- mixed flight controls' rule for each aircraft type, such as a hypothetical Airbus rule that reads whether the autopilot is engaged
- masking for an aircraft whose inputs a profile can't describe ([soft takeover](ideas.md#soft-takeover-on-handover))
- the patch the iniBuilds A350's module needs for its displays to take a forwarded press ([WASM instrument sync](ideas.md#wasm-instrument-sync), [decision 001](../../decisions/001-changing-other-developers-packages.md))
- GSX, and each ATC service the second pilot's microphone would reach, such as VATSIM, SayIntentions, or BeyondATC ([ATC sync](ideas.md#atc-sync))

A plugin reaches every layer through hooks:

- the state object, where it adds entries with a read and a write of its own
- moments in a session: an aircraft loaded, preflight ended, control passed
- channels of its own, of the kinds above
- steps in the catch-up pipeline
- the writer, for every write to the sim
- code inside the sim, in the aircraft's panels and in a WASM module ([below](#code-inside-the-sim))

The core owns each mechanism, and a plugin owns the policy.
The input layer masks, and a plugin says what to hold back; the axes channel carries the PM's input, and a plugin mixes it.
Two plugins then never fight over one mechanism, and every mechanism keeps the fail-open rules [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) sets for anything in the pilot's input path.

v1's own features are built on the hooks plugins use, so the hooks carry real work before any plugin depends on them, and a later feature is one more module on them.

**v1 builds** the hooks, v1's features on them, and the 58P's plugin.

## Code inside the sim

v1 runs code inside the sim in two places, and both load what they run by name, so features and plugins add to them without changing them:

- **The panel bridge,** which v1 injects into the aircraft's panel documents for pointer sync, loads a module for each instrument a feature or a plugin names.
  The bus bridge, the EventBus bridge, and adapters such as the A220's each need a listener inside an instrument's document ([bus bridge](ideas.md#bus-bridge), [EventBus bridge](ideas.md#eventbus-bridge), [aircraft adapters](ideas.md#aircraft-adapters)).
  A panel file that doesn't parse takes out the whole file, and one broken shared `VCockpit.js` once broke every instrument in the sim (FS Copilot fork, `record/conventions.md`), so each module loads on its own and one module's failure reaches no other.
- **The WASM module,** which places figures in v1 ([avatar sync](03-v1-scope.md#avatar-sync)), places objects of any kind.
  Later it places [Crosscheck objects in the cockpit](ideas.md#crosscheck-objects-in-the-cockpit) and the IDE's arrows, and passes presses to displays drawn by WASM code, such as the iniBuilds A380's, which press at the position we send once told the mouse entered them ([WASM instrument sync](ideas.md#wasm-instrument-sync)).

**v1 builds** both as hosts that load modules by name.

## An input layer

Several picks hold a pilot's input back from their own sim:

- [Soft takeover](ideas.md#soft-takeover-on-handover) holds the new PF's levers until they pick up.
- [Mixed flight controls](ideas.md#mixed-flight-controls) holds the PM's axes and sends them to the flying machine.
- Blocking a cut-off pilot's switches, an open question in [the connection](03-v1-scope.md#the-connection), holds those.
- [Ground operations sync](ideas.md#ground-operations-sync) holds a PM's pushback request, such as `K:TOGGLE_PUSHBACK`, so that only the flying machine carries it out.

Masking holds the axis events back on stock flight controls and the PMDG 777, and the block ends when the masking client dies (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)).
On an aircraft whose module asks for the same priority, such as the A2A PA-24, masks work only if they're in place before the aircraft loads ([flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)).
So the part of Crosscheck that masks has to be able to start with the sim, as programs in the sim's `exe.xml` do ([installing and updating](03-v1-scope.md#installing-and-updating)).

Holding back a mouse click, such as one on the IDE's arrows or on a Crosscheck object, is a different problem, and we haven't looked for a way ([Seat awareness](ideas.md#seat-awareness)).

**v1 builds** no input layer, but its connection to the sim comes up without a flight loaded, which v1 needs anyway, since Crosscheck and the sim start in either order ([invite code](03-v1-scope.md#invite-code)).

## Roles apart from control

v1 has two roles: the PF, which moves with control, and the traffic host, who is also the ATC host and holds that role apart from control ([traffic sync](03-v1-scope.md#traffic-sync)).
Later picks add roles:

- the machine that carries out ground services, which is the flying machine ([ground operations sync](ideas.md#ground-operations-sync))
- a weather source, who may not be the PF ([environment sync](ideas.md#environment-sync))
- where the second pilot's microphone goes, the ATC host ([ATC sync](ideas.md#atc-sync))
- a flight engineer, whom control never passes to ([take-control key](03-v1-scope.md#take-control-key))
- passengers ([join modes](ideas.md#join-modes))

**v1 builds** one table of roles, each with its rule for who holds it, how it moves, and what happens when its holder drops out, with the PF and the traffic host as its first two.

## People beyond the crew

A session can hold any number of people ([01-aims](01-aims.md#aims)).
A crew of any size already fits live sync, which keeps one vector clock counter per pilot and breaks ties by the lower pilot ID ([02-live-sync](../sync/02-live-sync.md#when-two-pilots-change-one-entry)).
Passengers send almost nothing and can take more delay (unverified, [join modes](ideas.md#join-modes)), so they stay out of the vector clocks and off the crew's links, and take a feed from one crew machine or down a tree, since connecting each of 150 people to every other takes 11,175 connections.

Every sim draws a figure for each other person, and in v1 already two: the other pilot's, and the pilot's own in an outside view ([avatar sync](03-v1-scope.md#avatar-sync)).
p24's figure is 27 joints and a color, 28 values, set as global `L:` variables ([avatars log](../avatars/log.md#2026-10-03-our-own-figure-poses-in-the-sim-from-its-variables-plays-between-frames-smoothly-and-changes-color-through-asobo_property_animation)).
A model's animations name the variables they read, so with global variables every copy of the figure takes the same pose.
Variables of each figure's own object avoid that, with one model for every figure: p17's sphere took its size from `Z:CROSSCHECK_SCALE`, which our module set on that sphere alone with `fsVarsZVarSet` (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-a-model-of-our-own-compiles-from-generated-gltf-and-its-size-and-color-follow-variables-of-its-own-object)).

A cabin of 180 passengers would be 5,040 values.
The sim's `L:` name table held 5,343 names in one fsc-editor session (measured on MSFS 2024, 2026-08-24, fsc-editor, `docs/sim-vars/build/v1-log.md`, "Re-enumeration stops on a pause, not on a finished table"), so the sim keeps thousands of names, but nobody has measured writing thousands of values every frame or drawing 180 figures.
A probe in step 6 of [the plan](plan.md) measures it.
The network carries those figures too, so the avatar channel sends only what moved, at a lower rate for passengers, and at full rate only for the figures near a pilot's camera.

**v1 builds** a kind for each member, crew or passenger, vector clocks that hold only members who send, figures posed from their own objects' variables, and an avatar channel whose rate can differ by figure.

## One protocol for every client

In v1 the desktop app and the EFB app show the core's state and send it commands, and decide nothing ([EFB app](03-v1-scope.md#efb-app)).
A sim panel can hold a WebSocket to a program on the same PC (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - Q08 yes: a cockpit document can hold a WebSocket to loopback"), with the sim's developer mode off (FS Copilot fork, `record/pointer-forwarding/docs/06-open-questions.md`, Q08).
So the EFB app can speak the same protocol as a browser, rather than reach the core through something only a sim panel has, such as `L:` variables.

- **The tablet in a browser** is one more client on the same protocol, reached across the home network.
  The tablet loads the PC's address, which the desktop app shows as a QR code that also carries a token, so other devices on the network can't take control.
- **The Crosscheck IDE** is one more client too, with commands of its own: discovering what an aircraft exposes, live values, running one entry's write, and reloading a profile mid-session.

**v1 builds** one protocol that every client speaks, which can listen beyond the PC itself, off by default.

## Profiles

- **Read-only entries:** an entry with no `write` is read on every machine and compared, never written ([01-profile-entries](../sync/01-profile-entries.md#writing-a-value)).
  The rest of the [pre-sync checklist](ideas.md#pre-sync-checklist) uses them to tick off a control once both cockpits agree on it, and [what doesn't sync](ideas.md#what-doesnt-sync) to name a control nobody can sync.
- **Requests:** a third direction beside the PF's entries and shared ones ([01-profile-entries](../sync/01-profile-entries.md#choosing-who-sends)), for an action any pilot asks for and only the flying machine carries out, such as a pushback ([ground operations sync](ideas.md#ground-operations-sync)).
  The input layer keeps the asking pilot's own sim from acting on it.
- **A profile's identity:** each profile carries its version and a hash of its contents, and the crew's machines compare them at join.
  In v1 that catches a profile someone edited by hand, and once profiles come from a [registry](ideas.md#profile-registry), the same hash tells a pilot's Crosscheck which profile to fetch.
- **New blocks:** the format takes blocks beyond `state:` and `events:`, such as the checklist's items or the controls that don't sync, each with its reason.

**v1 builds** read-only entries, a direction field with room for a third value, profile hashes compared at join, and a format that takes new blocks.

## Recording

- **The debrief timeline** plays a flight back from the recording, so the recording holds the flight model's track, the handovers, and every channel with its timing, in a format later versions of Crosscheck still read, and merges across the crew's machines by the session's ID and the vector clocks ([flight recorder and debrief](ideas.md#flight-recorder-and-debrief)).
- **Telemetry** sends the event that already marks the recording and shows a notice when a write never lands ([02-live-sync](../sync/02-live-sync.md#checking-that-a-write-landed)), carrying nothing that identifies the pilot ([telemetry](ideas.md#telemetry)).
- **Plugin tests:** the recorder keeps every value a plugin received and every action it returned, so any flight flown with the plugin replays through it in a test, with no copy of the aircraft.
  The plugin's author writes no test: they fly with recording on, as pilots already do for [bug reports](03-v1-scope.md#recording-and-bug-reports).
  Panel code that reaches into the aircraft directly, such as into the A220's Redux store, does work the recording doesn't see, and only flying it checks that.

**v1 builds** a versioned recording format with the flight model's samples, each channel recording itself, and each plugin's inputs and outputs.

## By pick

| Pick | Needs | Beyond those |
| --- | --- | --- |
| [Ground operations sync](ideas.md#ground-operations-sync) | [Channels](#channels), [plugins](#plugins), [input layer](#an-input-layer), [roles](#roles-apart-from-control), [profiles](#profiles) | Until it comes, the pilot whose sim runs a pushback flies it ([traffic sync](03-v1-scope.md#traffic-sync)) |
| [Soft takeover](ideas.md#soft-takeover-on-handover) | [Input layer](#an-input-layer), [plugins](#plugins) | Showing the new PF which levers haven't picked up |
| [Mixed flight controls](ideas.md#mixed-flight-controls) | [Channels](#channels), [input layer](#an-input-layer), [plugins](#plugins) | A decision in `record/decisions/` before it's built |
| The rest of the [pre-sync checklist](ideas.md#pre-sync-checklist), and state watching | [Profiles](#profiles) | |
| [Crosscheck IDE](ideas.md#crosscheck-ide) | [One protocol](#one-protocol-for-every-client), [code inside the sim](#code-inside-the-sim), [input layer](#an-input-layer) | The single-machine setup in step 7 of [the plan](plan.md), for its two-instance write test |
| [Bus bridge](ideas.md#bus-bridge) | [Channels](#channels), [catch-up pipeline](#a-catch-up-pipeline), [plugins](#plugins), [code inside the sim](#code-inside-the-sim) | Whether a carried message changes the receiving aircraft's state, a step 6 probe |
| [EventBus bridge](ideas.md#eventbus-bridge) | [Channels](#channels), [catch-up pipeline](#a-catch-up-pipeline), [code inside the sim](#code-inside-the-sim) | Whether our code can listen on `wt.eb.evt`, a step 6 probe; it serves every aircraft built on the MSFS Avionics Framework, so it's core |
| [WASM instrument sync](ideas.md#wasm-instrument-sync) | [Plugins](#plugins), [code inside the sim](#code-inside-the-sim) | |
| The second pilot's mic reaching ATC, from [ATC sync](ideas.md#atc-sync) | [Channels](#channels), [roles](#roles-apart-from-control), [plugins](#plugins) | In v1 a pilot's microphone never leaves their machine ([voice phrases](03-v1-scope.md#voice-phrases)), and this sends it when the pilot chooses, by a means still open |
| Weather, from [environment sync](ideas.md#environment-sync) | [Channels](#channels), [roles](#roles-apart-from-control) | How to set the weather from outside the sim, which is unknown |
| Home-network discovery, from [one-click invite](ideas.md#one-click-invite) | | Joining from a session found on the home network as well as from a code |
| Crews beyond two, and passengers, from [join modes](ideas.md#join-modes) | [People beyond the crew](#people-beyond-the-crew), [roles](#roles-apart-from-control), [channels](#channels) | The figure probe in step 6 |
| The tablet in a browser, from [Crosscheck's interface](ideas.md#crosschecks-interface-in-the-efb-and-on-a-tablet) | [One protocol](#one-protocol-for-every-client) | |
| The debrief timeline, from [flight recorder and debrief](ideas.md#flight-recorder-and-debrief) | [Recording](#recording) | The viewer |
| Automatic profile fetch, and the community registry, from [profile registry](ideas.md#profile-registry) | [Profiles](#profiles), [channels](#channels) | |
| [What doesn't sync](ideas.md#what-doesnt-sync) | [Profiles](#profiles) | |
| [Crosscheck objects in the cockpit](ideas.md#crosscheck-objects-in-the-cockpit) | [Code inside the sim](#code-inside-the-sim), [input layer](#an-input-layer) | Whether an object our WASM module writes holds still enough, since [decision 001](../../decisions/001-changing-other-developers-packages.md) rules out attaching it through the aircraft's files |
| [Telemetry](ideas.md#telemetry) | [Recording](#recording) | A server, which could be the one bug reports use |

## Open questions

- Whether variables of an object, such as `Z:CROSSCHECK_SCALE`, add to the sim's `L:` name table, which the figure probe can check.
- How a click on one of our own objects reaches us and not the control beneath it.
- Where each part of a plugin runs and what language plugins are written in, which step 7 of [the plan](plan.md) decides.
