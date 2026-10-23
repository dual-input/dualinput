# Traffic and ATC: traffic sync and hearing ATC

```text
Purpose:     How the traffic host's AI traffic appears in every other pilot's sim, and the ATC host's ATC app plays in every other pilot's headset.
Depends on:  ../product/03-v1-scope.md, ../session/01-roles-and-members.md, ../session/02-units.md, ../architecture/02-code-map.md, ../core/03-sim-seam-and-wasm-module.md, ../core/04-core-helper.md, ../network/01-between-machines.md, ../network/02-units.md, ../recording/01-recording-and-bug-reports.md, ../flight-model/01-flight-model-sync.md, log.md
Decides:     What the traffic host polls, how often, and which objects it carries; what an identity and a state carry, and when a state goes out; how a receiving machine creates, freezes, dresses, and removes each copy, and how traffic's routine draws them; the object-mirror engine; traffic's notices and its list of traffic packs; how ATC audio picks the ATC app, sends its frames, and plays them; the settings; the budgets; and the cases for the bench (node 6.14).
```

> **Note**
> Since 2026-10-17, v1 has no plugins, so how a plugin mirrors objects and claims them, which [the object-mirror engine](#the-object-mirror-engine) gives to 6.15, waits for plugins' design after v1 ([plugins and the sandbox](../plugins/01-plugins.md#what-this-answers)).
> Since 2026-10-17, traffic and ATC audio each register a slice of client state, which [what they register](#what-they-register) leaves out ([slices and commands](../interface/01-apps.md#slices-and-commands)), and each has a part in an app wherever the apps' design shows its slice; where their notices and settings show is that design's, which settles what [notices](#notices) and [settings](#settings) leave to 6.16.
>
> Since 2026-10-18, the design review after node 6 changes this document in two places (user, 2026-10-18):
>
> - [The buffer](#the-buffer)'s depth comes from the last 500 frames received, where it says the last 10s of frames, so a transmission after a pause starts from history rather than at 60ms.
> - Avatars removes no figure itself at a profile's unload ([avatars](../avatars/01-avatars.md)), so [which copies it shows](#which-copies-it-shows) can't compare traffic's removal to it; traffic still removes each copy with `AIRemoveObject`, since it removes copies while its connection stays open.
>
> Since 2026-10-21, the core records every input, which changes this document in two places (user, 2026-10-21; [recording log](../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour)):
>
> - Neither traffic nor ATC audio registers as partly recorded: traffic's polls, its reads of each new object's identity, and its states' channel, and ATC audio's captured frames and its frames' channel, are recorded, where [the units](#the-units), [what they register](#what-they-register), [what goes out](#what-goes-out), and [the ATC host](#the-atc-host) declare them unrecorded, and a replay checks both units' outputs.
> - Neither is a leaf, so the one request that claims both role keys, in [the units](#the-units), rests on [the traffic and ATC switch](../architecture/02-code-map.md#the-traffic-and-atc-switch) alone.
>
> Since 2026-10-22, building the core helper's buffer changes this document in two places (user, 2026-10-22; [core log](../core/log.md#2026-10-22-stage-6s-helper-passes-on-nothing-it-wasnt-asked-for-and-comes-back-2s-after-a-kill-but-capturing-a-continuous-tone-takes-14-of-a-core-against-1)):
>
> - [The buffer](#the-buffer)'s transmission ends once no frame has come for the buffer's most depth, 300ms, rather than at the first turn with nothing buffered: until then it conceals each turn, a frame that comes within it plays on, and one that comes after it counts as late toward the next depth. Frames late in order once ended a transmission at the first such turn, and dropped the rest of it unheard.
> - On [every other machine](#every-other-machine), ATC audio closes its playback stream and opens a new one when the ATC host's restart count rises, as when the key moves, since a restarted host numbers its frames from 0 again, and every message carries its sender's restart count ([channels and sends](../network/02-units.md#channels-and-sends)).
>
> Since 2026-10-23, ATC audio's capture starts at 32 kbps, where [the ATC host](#the-atc-host) keeps FS Copilot's bitrate, 24 kbps, since the core helper encodes in Opus's Audio mode, at 27.6 kbps on BeyondATC's speech, where a listener told it from the original no more than any other setting (user, 2026-10-23; [core log](../core/log.md#2026-10-23-stage-6s-helper-passes-every-case-at-the-desk-and-in-the-sim-and-captures-within-1-of-a-core-in-opuss-audio-mode-but-never-sees-an-xbox-controllers-buttons-over-usb)).

On the traffic host, traffic polls the sim's AI aircraft and helicopters within the radius setting, and the ground objects within 1km whose titles it allows, twice a second.
It sends each object's identity once, and its state when it changes or every 5s.
Every other machine creates a frozen copy of each object, and traffic's routine `Traffic` in our WASM module draws each copy every frame, 1s behind the traffic host's reads.
On the ATC host, the core helper captures the ATC app and sends its speech as stamped Opus frames, and every other machine plays them behind a depth it picks at the start of each transmission.

This answers node 6.14 of the [architecture plan](../architecture/plan.md#614-traffic-and-atc), and holds only what these leave out: 03-v1-scope's [traffic sync](../product/03-v1-scope.md#traffic-sync) and [hearing ATC](../product/03-v1-scope.md#hearing-atc); 01-roles-and-members' [traffic and ATC host](../session/01-roles-and-members.md#the-traffic-and-atc-host); the code map's [traffic and ATC switch](../architecture/02-code-map.md#the-traffic-and-atc-switch); 01-between-machines' [channels](../network/01-between-machines.md#channels) and [sending](../network/01-between-machines.md#sending); 04-core-helper's [capturing a program](../core/04-core-helper.md#capturing-a-program) and [playing](../core/04-core-helper.md#playing); and 01-recording-and-bug-reports' unrecorded inputs.
Here a copy is the AI object a receiving machine creates for one of the traffic host's objects, and a receiving machine is any machine whose pilot isn't the traffic host.
FS Copilot built both features, and this design carries over its measured mechanism: the copies frozen and written every frame, the poll at 2Hz, the gate, and the capture ([log](log.md)).

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `traffic` | Feature | On the traffic host, the objects it tracks and the gate's state for each; on a receiving machine, each sender's identities and newest states, each copy's object ID, and the notices' counts; the radius setting; and the list of known traffic packs | Its crate in the core, and its routine `Traffic`, in `traffic-routines`, in our WASM module |
| `object-mirror` | Engine | The gate, which decides which states the traffic host sends, and the playout, which gives a copy's pose at a time from its samples, both generic over the sample | Under traffic, in the core and in `Traffic`; natively on the bench |
| `atc-audio` | Feature | The ATC app and ATC volume settings, the capture's state on the ATC host, and the playback stream on the other machines | Its crate in the core |
| The message crate's `traffic` and `atc_audio` modules | Engine | The role keys, the channels and their messages, and `Traffic`'s slot | Wherever the message crate does |

- Traffic depends on the session, for its key, the members, and who is in the flight; the sim service; the network, for its channels, each sender's clock offset, and `LinkUp`; `clients`, for its setting, notices, slice, and command; and `object-mirror`.
  ATC audio depends on the session, the core helper's service, the network, and `clients`.
- `object-mirror` depends on nothing of ours, so it sits on the engines' bottom line beside `messages`; `traffic-routines` uses it, which the code map's rule on a routine's dependencies admits through this design's note there.
- Both are partly recorded, so each is a leaf (what keeps the drift from spreading), and neither writes its own role key: the apps' "Share my traffic and ATC" switch sends the one request that claims both ([session keys](../session/02-units.md#session-keys)).
  - Traffic's unrecorded inputs are its polls, its reads of each new object's identity, and its states' channel; it reads no `Frame` event, since `Traffic` draws the copies.
  - ATC audio's are the captured frames and its frames' channel; the core helper's report on each transmission played stays recorded.

## Names

`Traffic`'s slot is `DUALINPUT_ROUTINE_TRAFFIC`, of the routine host's kind ([names the sim shares](../architecture/02-code-map.md#names-the-sim-shares)).

## What they register

```rust
// a sketch; the hooks' names follow the platform's units
pub fn register(r: &mut Registry) {
    let me = r.unit::<Traffic>("traffic").partly_recorded();
    me.session_key(traffic::HOST);                            // Anyone, naming a member; the switch claims it
    me.channel(traffic::IDENTITIES, Traffic::on_identity);    // a stream, recorded
    me.channel(traffic::STATES, Traffic::on_states);          // Newest and unrecorded
    me.on_sim(Traffic::on_sim);                               // poll answers, identities, a copy's ID, an exception
    me.on::<KeyChanged>(Traffic::host);                       // the traffic host changed
    me.on::<FlightChanged>(Traffic::flight);                  // this pilot entered or left the flight, a load included
    me.on::<LinkUp>(Traffic::link_up);                        // the identities whole, and every state again
    me.setting(setting::RADIUS_KM, 200);
    me.command(command::LIST_PACKS, Traffic::list_packs);
}

pub fn register(r: &mut Registry) {
    let me = r.unit::<AtcAudio>("atc-audio").partly_recorded();
    me.session_key(atc_audio::HOST);
    me.channel(atc_audio::FRAMES, AtcAudio::on_frame);        // Deadline and unrecorded
    me.capture(capture::ATC, AtcAudio::on_captured);          // registered unrecorded
    me.stream(stream::ATC);
    me.on::<KeyChanged>(AtcAudio::host);
    me.setting(setting::ATC_APP, AtcApp::Automatic);
    me.setting(setting::ATC_VOLUME, 100);
}
```

## The traffic host

### Polling

- While this pilot holds traffic's key and is in the flight, traffic polls every 500ms, as FS Copilot did, for `SIMCONNECT_SIMOBJECT_TYPE_AIRCRAFT` and `HELICOPTER` within the radius setting, and for `GROUND` within 1km.
  At 2Hz FS Copilot's copies moved uniformly, at 1Hz they held now and then at a sample's end, and at 0.5Hz they stalled and ran 2s behind (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "Jitter measured, not eyeballed").
- `poll(type, radius)` is the sim call 6.6 asked this design to add to 6.3's: one `SimConnect_RequestDataOnSimObjectType` for each call, under a request ID of its own, so an answer that arrives after the next poll still names its poll, which FS Copilot had to encode in its request IDs because the answer carries no send ID (read in the FS Copilot fork, `FsCopilot/Simulation/TrafficDefinitions.cs`, `TrafficReq`).
- A poll is complete once each type's answers reach their `dwoutof`, and an empty answer has `dwoutof` 0 (read in `FsCopilot/Simulation/TrafficHost.cs`, `OnByType`; documented, [SIMCONNECT_RECV_SIMOBJECT_DATA](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Structures_And_Enumerations/SIMCONNECT_RECV_SIMOBJECT_DATA.htm)).
  A poll still incomplete after 2s is dropped with nothing sent as gone, and no poll starts while one is out, as in FS Copilot (read in `TrafficHost.cs`, `PollTick`).
- Each answer is stamped by the edge as it reaches the queue, and that stamp, on this core's counter, is the sample's time, since FS Copilot found a sample must be aged from its read, not its send ([traffic report](results/2026-10-17-fsc-traffic-code.txt), point 8).
- The poll reads FS Copilot's state, its position, attitude, body and rotation velocities, ground speed, on-ground flag, gear, flaps, five lights, and engines, less `VERTICAL SPEED`, which nothing on a receiving machine writes (read in `FsCopilot/Simulation/TrafficDefinitions.cs`, `ObjectState`).
- An object seen for the first time is read once for `TITLE`, `LIVERY NAME`, `ATC ID`, `ATC AIRLINE`, `ATC FLIGHT NUMBER`, and `CATEGORY`, through a `watch` on its object ID with a period of once, which this design adds to 6.3's periods, as FS Copilot read it with `SIMCONNECT_PERIOD_ONCE` (same report, point 1).
  Every such read reuses one definition, and the sim client doesn't make it again on a new connection, since p10 met 1,023 distinct objects in 10 minutes at EGLL ([SDK and probes report](results/2026-10-17-sdk-and-probes.txt), section B).
  The object sends nothing until that read answers.

### Which objects the host carries

The traffic host skips, in this order:

1. The pilot's own aircraft, by `IS USER SIM`, and the avatar on foot; whether the parked aircraft still reads `IS USER SIM` as 1 while its pilot walks around is a [check in the sim](#cases-for-the-bench).
2. Any object traffic itself created, which exists only on a machine whose pilot was receiving before taking the role, and goes once its removal lands ([which copies it shows](#which-copies-it-shows)).
3. Any title starting `DUALINPUT_`, so avatars' figures, `DUALINPUT_FIGURE_PILOT` ([avatars](../avatars/01-avatars.md#names)), and any later object of ours never become copies.
4. Any ground object whose title isn't on the allowlist.

The allowlist is a list of title prefixes in traffic's crate, which starts with `ASO_Pushback_` and takes other pushback tugs as the build finds them, GSX's among them, while GSX's other vehicles and its people wait for [ground operations sync](../product/ideas.md#ground-operations-sync), which brings GSX through a plugin (user, 2026-10-17).
At EGLL, p10's poll within 5km met 850 ground objects over 10 minutes: 823 of GSX's gate signs and walls, none of which moved, and 27 objects titled `ASO_Pushback_White` or `ASO_Pushback_Blue`, 7 of which moved, likely pushing AI aircraft (unverified) ([log](log.md)).
Each sim that runs GSX likely makes its own signs (unverified), and no variable the SDK documents says which client spawned an object or for which aircraft (documented, [Aircraft Misc Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Misc_Variables.htm); unmeasured), so carrying every ground object would show the signs twice wherever both pilots run GSX.
GSX's people report `CATEGORY` `GroundVehicle` too ([avatars log](../avatars/log.md#2026-10-02-a-gsx-person-shows-and-follows-where-we-write-it-and-the-sims-own-people-stay-invisible)), and stay off the allowlist.
Ground objects are polled within 1km because a tug about 5m long (unverified) spans about 3 pixels at 1km, and half a pixel at 5km, on a 1,920 by 1,080 screen at a 90° field of view, which the sim measures as the view's height (arithmetic; [avatars log](../avatars/log.md#2026-10-03-the-ray-through-the-cursor-needs-no-calibration-cameragets-field-of-view-is-the-views-height-and-clicks-land-within-2mm-at-any-zoom-and-window-shape)).

### The gate

The gate is `object-mirror`'s, with FS Copilot's rules and thresholds (read in the FS Copilot fork, `FsCopilot/Simulation/TrafficGate.cs`, `Decide`):

- An object's first sample goes out.
- A sample goes out past the thresholds on position, altitude, attitude, ground speed, and gear, or on any change of the on-ground flag, flaps, lights, or engines.
- Otherwise it goes out every 5s, which keeps a parked aircraft from going 15s without a sample ([roles and members](../session/01-roles-and-members.md#the-traffic-and-atc-host)).
- When a sample goes out after samples held back, the last one held goes first, with its own time, so a receiving machine doesn't spread the first step of a motion across the quiet before it.
- The sample that ends a run of motion goes out again on the next two polls, since a lost last sample would leave a copy carried past where it stopped until the next 5s sample (FS Copilot fork, `record/traffic-atc/docs/04-transport.md`, "Delivery per stream").

### What goes out

- **An identity:** on traffic's identities stream, the newest value for each object, keyed by the traffic host's object ID: its title, livery, `ATC ID`, airline, flight number, and kind, aircraft, helicopter, or ground object; or that the object has gone, once a complete poll misses it.
- **States:** on traffic's states channel, `Newest` and unrecorded, in batches of under 1,162 bytes ([sending](../network/01-between-machines.md#sending)), each keyed by its place among its poll's batches.
  A batch carries a base time, in µs on the traffic host's counter, and each state its object ID, its time in ms after the base, and FS Copilot's fields at FS Copilot's precision (read in `FsCopilot/Simulation/TrafficPackets.cs`), about 25 states to a batch (arithmetic).
- **On `LinkUp`:** the traffic host sends that member every identity, and marks every object for its 5s sample at the next poll, so a member that comes back or joins can create every copy within about 500ms of its identities.
- **When traffic stops polling,** because this pilot left the flight or the key stopped naming them, it forgets every object it tracked and the gate's state for each, so polling again sends every identity anew.
  Leaving the flight also sends every object as gone, and when the key moves, the receiving machines remove the copies themselves.

## A receiving machine

### Which copies it shows

- A receiving machine keeps each sender's identities and newest states apart, and shows the copies of the member traffic's key names while its own pilot is in the flight ([roles and members](../session/01-roles-and-members.md#the-traffic-and-atc-host)).
- It creates a copy once it holds the object's identity and a state; a state that comes before its identity waits up to 10s, as FS Copilot's did ([traffic report](results/2026-10-17-fsc-traffic-code.txt), point 2).
  It feeds the copy to `Traffic` once the network holds the traffic host's clock offset, which the first heartbeats give ([the heartbeat and clock offsets](../network/02-units.md#the-heartbeat-and-clock-offsets)).
- It removes a copy:
  - when its identity says it has gone;
  - after 15s with no state, keeping its identity, so the next state creates it again, since two 5s samples lost in a row would otherwise take a parked copy away for the rest of the session;
  - when the key stops naming its sender, the new traffic host's own machine included, forgetting that sender's identities;
  - when this pilot leaves the flight, a load included, keeping the identities and newest states, so the copies come back when the pilot is in the flight again; whether a load already removed them is unmeasured, and traffic logs the exception a removal then gets.
- It removes each copy with `AIRemoveObject` rather than by closing its connection, since closing has been measured only as a killed client, as avatars removes its figures ([avatars](../avatars/01-avatars.md#the-figures-this-machine-draws)).

### Creating a copy

1. Traffic calls `create_ai` with the identity's title, livery, and `ATC ID` as the tail, with no marker, at its newest state's position, attitude, and on-ground flag, and its ground speed as the airspeed, which 6.3 carries as `AICreateNonATCAircraft_EX1` for an aircraft or a helicopter and `AICreateSimulatedObject_EX1` for a ground object (read in `FsCopilot/Simulation/TrafficReceiver.cs`, `Create`).
   FS Copilot's injector, killed twice, left none of its objects in the sim, which is why it dropped its tail marker (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 0 capture read; TrafficInject built and smoke-tested — Q01, Q08 settled").
2. On the copy's object ID, it calls `release`, which this design adds to 6.3's calls for `AIReleaseControl`, then sends `K:FREEZE_LATITUDE_LONGITUDE_SET`, `K:FREEZE_ALTITUDE_SET`, and `K:FREEZE_ATTITUDE_SET` with 1 on that ID, through a `key` naming it, as avatars freezes its figures.
   Released and frozen, FS Copilot's copies read `IS ... FREEZE ON` back as 1 on all three, and the sim stopped moving them (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "Jitter measured, not eyeballed").
   `AIReleaseControl` failed on every `StaticObject` our probes created, and their freeze held anyway ([SDK and probes report](results/2026-10-17-sdk-and-probes.txt), section B), so traffic logs that exception and goes on.
3. For an aircraft or a helicopter, it writes the dress, through a `write` on the copy's ID: `GEAR HANDLE POSITION`, `FLAPS HANDLE INDEX`, `LIGHT STROBE`, `LIGHT LANDING`, `LIGHT TAXI`, `LIGHT BEACON`, `LIGHT NAV`, and each engine's `GENERAL ENG COMBUSTION`, and again whenever one changes.
   A created aircraft comes with its engines running, and a ground object answers each of these with `DATA_ERROR`, so a ground object gets none (read in `FsCopilot/Simulation/TrafficDefinitions.cs`; FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "First visual replay; engines, pushback, ground vehicles").

- A create that throws is made again with no livery as its kind's stand-in: "Asobo PassiveAircraft Citation CJ4" for an aircraft and "Asobo PassiveAircraft Bell 407" for a helicopter (read in `FsCopilot/Simulation/TrafficFallbacks.cs`).
  A ground object has no stand-in, and a stand-in that fails too leaves the copy missing.
  The SDK lists `CREATE_OBJECT_FAILED` among a create's exceptions (documented, [SimConnect_AICreateNonATCAircraft_EX1](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/AI_Object/SimConnect_AICreateNonATCAircraft_EX1.htm)), and a SimObject the sim hadn't loaded threw it ([interface log](../interface/log.md#2026-10-04-build-and-mount-loads-a-new-module-with-no-sim-restart-leaves-png-textures-out-and-a-program-can-click-it)); how a create with an aircraft title this sim lacks fails, and whether the Bell 407 creates on MSFS 2024, are checks in the sim.
- Traffic doesn't check a title against this sim's aircraft before creating it: the create's exception decides, since FS Copilot found "A partial set is worse than none", because a title its list missed kept its stand-in (read in `TrafficReceiver.cs`).
- The sim refuses objects past 1,000 with `TOO_MANY_OBJECTS` (documented, [SIMCONNECT_EXCEPTION](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Structures_And_Enumerations/SIMCONNECT_EXCEPTION.htm); whether for one client or for all, unmeasured), and a copy refused for it counts as missing; p10 counted 142 to 153 aircraft at EGLL ([architecture log](../architecture/log.md)).

### `Traffic`, each frame

- Traffic feeds `Traffic` each batch of states as it arrives, each state with its copy's object ID, its pose, and its time moved onto this core's counter by the traffic host's clock offset, as flight-model sync feeds `Follow` ([flight-model sync](../flight-model/01-flight-model-sync.md#what-this-adds-to-our-wasm-module)), and an entry for each copy it removes.
  A batch fits [a routine's slot](../architecture/02-code-map.md#routines-in-our-wasm-module), whose 8,192 bytes hold about 100 entries (arithmetic).
- Each frame, for each copy, `Traffic` asks the playout for its pose at `Frame::now` less 1s, and writes the six `A:PLANE` variables through `fsVarsAVarSet` on the copy's ID, as `Figure` places a figure ([avatars](../avatars/01-avatars.md#figure-each-frame)), and the six body and rotation velocities, which feed only a frozen object's animations and sounds.
  FS Copilot wrote the velocities through `SetDataOnSimObject` (read in `TrafficDefinitions.cs`), so writing them through `fsVarsAVarSet` is a check in the sim.
- The playout is FS Copilot's, on a fixed delay rather than one that follows the samples' spacing (read in `FsCopilot/Simulation/TrafficInterpolator.cs`, `TryRender`):
  - between two samples, the position moves along the line between them, and each angle turns the short way round;
  - past the newest, the copy carries along the last two samples' line for as long as the gap between them, up to 600ms, so 500ms at 2Hz, then holds;
  - a sample at or before the newest is dropped, so a repeated stop costs nothing;
  - a copy whose pose hasn't changed since its last write isn't written, so a parked copy costs no writes.
- Traffic ends `Traffic` once it holds no copy, and feeds it again with the next.
- **Why here:** a frozen object moves only where it's written, so a moving copy must be written every frame: written at 20Hz into a sim at about 33 fps, FS Copilot's copies scored 1.65 on its jitter measure, against 0.17 written on each `Frame` event (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "Jitter measured, not eyeballed").
  `Traffic` writes inside the sim's frame, where the core's writes would each follow a `Frame` event's round trip through the queue, the loop, and the edge, 7,800 SimConnect calls a second for 130 copies at 60 fps (arithmetic).
  Our probes found the same in a moving cockpit: SimConnect read seat objects about 2.3m behind a flying aircraft and writes from outside trailed it, while a module writing inside the frame kept up ([avatars log](../avatars/log.md#2026-10-03-writes-from-outside-the-sim-place-an-object-in-a-moving-cockpit-but-cant-hold-it-still); [same log](../avatars/log.md#2026-10-03-written-from-inside-the-sims-frame-by-a-wasm-module-an-object-keeps-up-with-a-flying-aircraft)).
  A copy flies in the world rather than in a cockpit, so that's an argument for copies, not a measurement of them.
- **Why 1s:** FS Copilot drew its copies at its samples' spacing plus 200ms, about 700ms at 2Hz, behind times it took from the traffic host's reads through an offset fitted to its least-delayed packets (read in `TrafficReceiver.cs`, `OnStates`, and `TrafficInterpolator.cs`, `Push`).
  `Traffic`'s 1s covers the 500ms between samples and up to 500ms of lateness, near the 534ms 99th percentile through a far relay at 3% loss ([the relays](../network/01-between-machines.md#the-relays)).

### Notices

Traffic raises two notices on a receiving machine while another member holds its key and this pilot is in the flight; their words and where they show are [6.16](../architecture/plan.md#616-the-apps)'s:

- **Aircraft that aren't the traffic host's:** every 10s, traffic polls `AIRCRAFT` and `HELICOPTER` within 200km for `IS USER SIM` alone, and counts the objects that are neither this pilot's aircraft nor its copies, as FS Copilot's receiver counted aircraft (read in `FsCopilot/Simulation/TrafficReceiver.cs`, `ForeignPoll`), with helicopters added.
  Two counts in a row above 0 raise the notice, with the count and the traffic host's name, since a copy whose create answers after the count's answer counts once as not ours, and a count of 0 clears it.
  It covers the sim's own AI traffic and any injector running on this machine; whether multiplayer's other pilots show as objects it counts is unverified.
- **Copies missing or shown as stand-ins:** the count of the traffic host's aircraft and helicopters this machine shows as a stand-in or not at all, with the traffic host's name, raised while it's above 0.
  Two groups of FS Copilot's testers flew with airliners missing because their traffic packs differed (from our experience with FS Copilot), and a stand-in is the same mismatch caught one step later.
  A ground object that won't create says nothing about traffic packs, so it isn't counted.

## Traffic packs

- When a page sends traffic's `LIST_PACKS` command, traffic runs a job that lists the folders in each package folder the session crate's job reads, keeps each whose name a known traffic pack matches, reads its `manifest.json`'s `package_version`, and puts the list in traffic's slice (user, 2026-10-17).
  A streamed pack shows with no version, since streamed packages keep no manifest on disk ([the match check](../session/02-units.md#the-match-check)).
- The known traffic packs are a list in traffic's crate, each a folder name or a prefix of one, which starts with `fsltl-traffic-base`, the one on our development machine (read on 2026-10-17).
- The job reads folder names and manifests alone, where finding the package each of the traffic host's titles comes from would read every `aircraft.cfg` and `livery.cfg`: 2,690 files in our development machine's Community folder, 2,551 of them in `fsltl-traffic-base` (read on 2026-10-17).

## The object-mirror engine

```rust
// a sketch
pub struct Gate<S: Sample> { /* each object's last sent sample, held sample, repeats, and heartbeat */ }
impl<S: Sample> Gate<S> {
    pub fn decide(&mut self, object: u32, sample: S, at: u64) -> Sends<S>;   // nothing, or a held sample and this one
    pub fn heartbeat_all(&mut self);                                       // every object's next sample goes out
}

pub struct Playout<P: Pose> { /* each object's recent samples */ }
impl<P: Pose> Playout<P> {
    pub fn push(&mut self, object: u32, at: u64, pose: P) -> bool;         // false for a sample at or before the newest
    pub fn at(&mut self, object: u32, t: u64) -> Option<P>;                // None when unchanged since the last call
}
```

- It reads no clock and does no I/O, and builds for x86_64 in the core and for wasm32 in `Traffic`.
- It's generic over the sample and the pose, so a later plugin's object mirroring, such as GSX's vehicles ([room for later](../product/04-room-for-later.md#channels)), runs the same gate and playout; how a plugin mirrors objects, and claims them so traffic skips them, is [6.15](../architecture/plan.md#615-plugins)'s.

## ATC audio

### The ATC host

- While this pilot holds ATC audio's key and a session runs, in the flight or not, ATC audio turns its capture on with the ATC app setting's programs and 6.5's starting values, FS Copilot's bitrate, gate, and hangover, which this design keeps ([capturing a program](../core/04-core-helper.md#capturing-a-program)).
- The ATC app setting is Automatic or one program's name, which the pilot picks from the core helper's list of programs that own an audio session.
  Automatic is the list `BeyondATC` and `SayIntentionsAI`, the programs BeyondATC's and SayIntentions' Start menu shortcuts start on our development machine (read on 2026-10-17); SayIntentions' may be a launcher, so whether the helper captures its speech is a [check in the sim](#cases-for-the-bench).
  The helper captures the first on the list that's running, looking every 2s, so a capture names a list where 6.5's names one program.
  SayIntentions works through FS Copilot's capture (reported by the user, 2026-10-17), whose automatic list named it `SayIntentions`, which doesn't match `SayIntentionsAI` ([log](log.md)).
  Other ATC apps join the list once their program names are confirmed: FS Copilot's list also named `Pilot2ATC`, `PF3`, `FSHud`, and `VoxATC`, which nobody has checked.
- The helper reports which program it captures, or that it's waiting for one.
- Each captured frame goes to the crew on ATC audio's frames channel, `Deadline` and unrecorded: its number, counting the frames sent since the capture turned on, so silence takes no numbers; its stamp, the helper's counter value for its first sample ([capturing a program](../core/04-core-helper.md#capturing-a-program)); and its Opus bytes.
- A frame's deadline is its stamp plus 300ms, the delay at which a readback on Discord overtakes the call ([hearing ATC](../product/03-v1-scope.md#hearing-atc)), so a frame still in this core's queue then is dropped.

### Every other machine

- While another member holds ATC audio's key and a session runs, ATC audio opens the helper's playback stream with the buffer's rule and the ATC volume, and hands it each frame from that member with its number and stamp; a frame from anyone else is dropped.
- When the key moves, it closes the stream and opens one for the new ATC host, with a fresh decoder and buffer, as FS Copilot's receiver did ([ATC report](results/2026-10-17-fsc-atc-code.txt), point 8).
- The ATC volume setting runs from 0 to 100%, 100% at first, and sets the stream's gain, because the helper mixes ATC and every feature's sounds into one output stream ([inside the helper](../core/04-core-helper.md#inside-the-helper)), so the Windows mixer can't turn ATC down alone.

### The buffer

- The helper compares each frame with the frame received before it: a stamp more than 30ms past what their numbers account for starts a new transmission, since the gate's silence takes no numbers, and within a transmission a missing number is a lost frame, which the codec conceals.
  Comparing with the frame before, rather than with the transmission's first, keeps a drift between the two clocks over a 2-minute ATIS from splitting it.
- The helper holds a transmission's first frame for the depth, then plays a frame each 20ms by number; a frame that arrives after its turn is dropped and concealed, and the transmission ends when its frames run out.
- At each transmission's first frame, the helper sets the depth, between 60ms and 300ms, to the smallest that would have played 98% of the last 10s of frames on time; a frame's lateness counts from its transmission's first frame plus 20ms for each frame since, and with nothing heard yet the depth is 60ms.
- The depth changes only between transmissions, so no word stretches, where adapting within one would stretch speech.
- At 3% loss through a relay 97ms to 131ms from the sender, 6% to 11% of frames came more than 170ms late, and the worst 1% came 337ms to 534ms late ([the relays](../network/01-between-machines.md#the-relays)).
  So FS Copilot's fixed 60ms would conceal at least 6% to 11% of frames, where a depth that rises to 300ms conceals only those past 300ms, somewhat more than 1%.
- At each transmission's end the helper reports its frames played, concealed, and dropped late, and its depth, which the recording keeps, so friends' sessions tune the buffer's limits that [01-between-machines](../network/01-between-machines.md#left-open) leaves to v1's recordings, while the frames themselves aren't recorded.

## Settings

| Setting | Unit | Default |
| --- | --- | --- |
| Traffic's radius, up to the SDK's 200km cap ([SimConnect_RequestDataOnSimObjectType](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_RequestDataOnSimObjectType.htm)) | `traffic` | 200km |
| The ATC app | `atc-audio` | Automatic |
| The ATC volume | `atc-audio` | 100% |

Where each shows is [6.16](../architecture/plan.md#616-the-apps)'s.

## What this changes elsewhere

The text or the notes at the top of [03-v1-scope](../product/03-v1-scope.md), [the code map](../architecture/02-code-map.md), [03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md), [04-core-helper](../core/04-core-helper.md), [01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md), [the session's units](../session/02-units.md), and [01-roles-and-members](../session/01-roles-and-members.md) list what this design changes there, including the open questions it settles in 03-v1-scope, and [tentative decisions](../architecture/decisions.md#traffic-polls-twice-a-second-and-a-receiving-machine-draws-each-frozen-copy-every-frame-from-a-routine-of-traffics-1s-behind) give the reasons.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures, beside the code map's [budgets](../architecture/02-code-map.md#budgets) and [budgets for work in the sim](../architecture/02-code-map.md#budgets-for-work-in-the-sim).

| What | Budget |
| --- | --- |
| A poll's answers on the loop | Each within a handler's 1ms, at the 291 aircraft records a second p10 read at EGLL ([architecture log](../architecture/log.md)) and its ground objects within 1km |
| `Traffic` | Under 0.1ms a frame at p99 with 25 moving copies, beside the module's 0.1ms for its other routines, which this raises; in FS Copilot's captures, up to 22 aircraft moved over a capture of 242s ([traffic report](results/2026-10-17-fsc-traffic-code.txt), point 9) |
| The sim's frame on a receiving machine | What the same objects cost the traffic host: in FS Copilot's measure, 44.7 fps with none, 38.0 with BeyondATC's 73, and 32.5 with 132 copies (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "Baseline: BeyondATC's own traffic scores 0.56") |
| Traffic between machines | About 2.5KB/s for 120 aircraft, with the gate sending 22.2% of samples ([traffic report](results/2026-10-17-fsc-traffic-code.txt), points 5 and 9) |
| ATC audio between machines | About 3KB/s while ATC talks ([04-core-helper](../core/04-core-helper.md#what-runs-where)) |
| ATC from the app to the crew | About 130ms, FS Copilot's measure with its 60ms buffer, plus the network and any depth past 60ms (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "Stage 3: the audio path works on one machine") |
| Creating 150 copies at a join | Within 5s, their creates sent without waiting on each other's answers; p08's create took 5.5ms to its object ID, and p28's loop, which waited on each create, its release, its freezes, and a write, took about 76ms a figure ([SDK and probes report](results/2026-10-17-sdk-and-probes.txt), section B) |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with two cores, the stand-in sim, a stand-in core helper, and the routine host built natively:

- The traffic host's poll answers 130 aircraft and, within 1km, 700 GSX signs and 20 `ASO_Pushback_White` tugs: identities go out for the aircraft and the tugs alone.
- A parked aircraft's state goes out every 5s; an aircraft that starts to move sends its held sample first, then each poll's; its stop goes out on three polls, and the receiving machine draws it stopped once.
- A poll whose answers aren't whole after 2s: dropped, and nothing goes as gone.
- A title starting `DUALINPUT_`: never carried.
- A receiving pilot who takes the role: their copies are removed, and their poll carries none of them meanwhile.
- A traffic host who loses the role and takes it back: every identity goes out again, and the copies come back.
- `LinkUp`: that member gets every identity, creates every copy within 500ms, and draws them once the clock offset arrives.
- A state before its identity: kept up to 10s, and the copy created when the identity comes.
- A create that throws: the stand-in; the stand-in throwing too: missing, and the notice counts it.
- A copy with no state for 15s: removed, its identity kept, and created again at its next state.
- The key moving to another member: every copy of the old traffic host's removed on every machine, and its identities forgotten.
- The receiving pilot leaving the flight, or a flight load on their machine: every copy removed, and created again once they're back in the flight.
- Two feeds within one module frame: `Traffic` takes both.
- `Traffic` drawing samples 500ms apart: no hold at a sample's end; a copy past its newest sample carried 500ms, then held; a parked copy not written.
- 40 aircraft in the receiving machine's sim that aren't copies, over two counts: the notice; the copies alone: none.
- `LIST_PACKS` with `fsltl-traffic-base` in Community: the list names it with its manifest's version.
- A capture listing `BeyondATC` then `SayIntentionsAI` with only SayIntentions running: it captures `SayIntentionsAI`.
- Frames with 80ms ± 30ms of jitter: the depth settles at their 98th percentile; a frame later than its turn is dropped and concealed; a missing number whose stamp gap matches is concealed; a stamp 30ms past what consecutive numbers account for starts a new transmission; a 2-minute transmission whose stamps drift 12ms from the device stays one.
- ATC audio's key moving: the old stream closed, a new one open, and the old ATC host's frames dropped.

In the sim:

- `Traffic`'s copies move as smoothly as FS Copilot's, 0.17 on its jitter measure, taxiing, pushing back, and in flight, and as smoothly as BeyondATC's updated traffic on the same measure, which ends the build's stage for traffic.
- `fsVarsAVarSet` holds a frozen AI aircraft's pose and velocities, which p12 measured only for the pose of `Marshaller_Stick`, a marshaller's wand (read in `experiments/areas/avatars/p12-wasm.mjs`, `STAND_IN`).
- The copies show on TCAS ([traffic sync](../product/03-v1-scope.md#traffic-sync)).
- Whether a client's AI objects survive a flight load.
- Whether the tug of a pilot's own pushback, through `K:TOGGLE_PUSHBACK`, is an object the `GROUND` poll finds, titled `ASO_Pushback_`, and whether an `ASO_Pushback_` title creates as a copy.
- Whether multiplayer's other pilots show in the count of aircraft that aren't the traffic host's.
- How a create with an aircraft title the sim lacks fails, and whether "Asobo PassiveAircraft Bell 407" creates as the helicopter stand-in.
- Whether the pilot's parked aircraft reads `IS USER SIM` as 1 while its pilot walks around; if it doesn't, the poll skips it by its object ID.
- Whether the helper captures SayIntentions' speech through `SayIntentionsAI`.

## Known limits

- Copies are frozen, so the sim doesn't hold them to the ground, and a receiving pilot with other scenery sees them float or sink ([traffic sync](../product/03-v1-scope.md#traffic-sync)).
- Dual Input hides no other source's traffic: the notice asks the pilot to turn it off.
- A receiving pilot who runs an ATC app of their own hears two ATCs, since nothing finds one on a receiving machine.
- GSX's vehicles and people, other than the pushback tugs the allowlist names, show only on the machine that runs them, until ground operations sync, and an AI aircraft's copy pushes back with no tug where its tug's title isn't on the allowlist.
- On a following machine, copies are drawn 1s behind the traffic host, and the crew's aircraft 0.4s behind the PF, so the copies show 0.6s staler than the aircraft: a tug at 2kt to 3kt would sit 0.6m to 0.9m off the nose gear it pushes (arithmetic), and AI traffic's replies to the crew show that much later.

## Left open

- The traffic packs beyond `fsltl-traffic-base`, the pushback tugs beyond `ASO_Pushback_`, and the ATC apps beyond `BeyondATC` and `SayIntentionsAI`: the build, as each is confirmed.
- How a page shows the traffic packs, and whether it shows the crew's beside this machine's, which adds an ask and an answer between the cores on a channel of traffic's: the user's, with [6.16](../architecture/plan.md#616-the-apps) (user, 2026-10-17).
