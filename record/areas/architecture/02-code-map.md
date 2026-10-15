# Architecture: the code map

```text
Purpose:     The units of Crosscheck's code, which tier each is in, what each owns, its interface, and what it may depend on.
Depends on:  01-spine.md, decisions.md, log.md, ../network/01-between-machines.md, ../sync/04-order-and-recovery.md, ../session/01-roles-and-members.md, ../profiles/01-format-and-delivery.md, ../product/04-room-for-later.md
Decides:     The tiers and the tests that keep each unit apart (node 5); how the host runs its features, and what a feature registers with it, calls, and guards (node 5.1); where the core's code meets the sim, so a stand-in and a replay can take the sim's place, and which SimConnect connections the core holds (node 5.2); how a feature adds work to our WASM module and the panel bridge, and how that work ends (node 5.3); where each unit lives, how one repository builds every target, and how CI checks the map (node 5.4).
```

Crosscheck's code is a host, engines, and features.
The core runs as one loop that owns all its state and takes every input, stamped, from one queue, and each feature plugs into that loop through one registration, so deleting a feature leaves everything else building and passing its tests (user, 2026-10-14).
A feature reads the host's state, reaches other features only through moments the host raises, and reaches the world only through outputs, and a feature that can block a request registers a guard rather than having the host check on it.

This answers node 5 of the [architecture plan](plan.md#5-the-code-map), whose children settle its parts; the plan says which are settled.
The tentative decisions behind it start at [decisions.md](decisions.md#crosschecks-code-is-a-host-engines-and-features-and-deleting-a-features-crate-leaves-the-rest-whole).

## Tiers

| Tier | What it is | Examples |
| --- | --- | --- |
| Host | The services every feature uses: in the core, and in the sim through the panel bridge and our WASM module, which load what features and plugins run there by name ([04-room-for-later](../product/04-room-for-later.md#code-inside-the-sim)) | The session and its keys, control, channels, the cockpit stream, catch-up, the client protocol, settings, notices, recording, the sim service, sim awareness, our WASM module's host, the panel bridge |
| Engines | Libraries that know nothing of the app, so another program can link them, such as the [Crosscheck IDE](../product/ideas.md#crosscheck-ide) | The message crate, the profile format, the sync engine, the transport, the recording format, the sim client, the stand-in sim |
| Features | Each one thing a pilot gets | Pointer sync, avatars, traffic, ATC audio, the take-control key, rate and pause, the PF's spot on the world map |

Three tests stand in for a definition of clean, because a definition in prose invites an agent to enforce it where it doesn't fit (user, 2026-10-14):

- Deleting a feature leaves everything else building and passing its tests: its crate, its one registration, its module in the message crate and its module in the profile engine (below), its routines in our WASM module with their line in the module's list, its files for the panel bridge ([work in the sim](#work-in-the-sim)), and its section in each app.
- An engine builds and runs outside the core.
- CI checks each crate's dependencies against the ones this map allows, and each TypeScript folder's imports too ([the map check](#the-map-check)).

So far the map allows these: an engine depends on no host or feature crate; no feature depends on another feature's crate ([what a handler sees and does](#what-a-handler-sees-and-does)); the loop's crates depend on neither tokio nor any crate that does I/O ([one loop](#one-loop)); only the sim's edge calls `SimConnect.dll` ([the sim seam](#the-sim-seam)); and in our WASM module, only its edge calls the sim's APIs, and a feature's unit there shares only the message crate with the feature's crate in the core ([work in the sim](#work-in-the-sim)).

A system is the units one design doc designs, in one area, and [node 6](plan.md#6-systems) of the plan designs each.
Each contract is defined once and linked or generated wherever it's used: a feature's messages stay in the message crate of [decision 025](../../decisions/025-messages-in-one-rust-crate.md), and its profile block, such as pointer sync's `displays`, stays in the profile engine, which the core, CI, and the IDE share ([01-format-and-delivery](../profiles/01-format-and-delivery.md#what-fails-a-load)), so deleting a feature deletes its module in the message crate and its module in the profile engine too (user, 2026-10-14).

## The host's interface

The host runs every feature on one loop.
A feature plugs in by registering what it handles, what it declares, and what it guards, and its handlers read the host's state and act only through outputs.

### One loop

```text
 SimConnect thread ───────────────┐
 tokio: iroh, WebSockets, timers ─┤                             ┌─ the host's services
 the helper's pipe ───────────────┼─▶ queue ─▶ recording ─▶ loop ┤
 worker pool ─────────────────────┘   each input stamped        └─ features' handlers,
                                      as it's pushed                  in registration order
                                                                │
                                                                ▼
                       outputs: sim calls, sends, client updates, timers, jobs
```

- One thread owns the host's services, every feature's state, and the QuickJS-ng runtimes, and handles one input at a time.
- Edge tasks around it do the waiting: tokio runs the sockets and timers, as [decision 027](../../decisions/027-core-runs-on-tokio.md) has it, a thread of its own runs SimConnect, whose clients "are not currently thread-safe" ([04-01](../../learn/foundations/04-01-connection-and-data.md)), and a pool runs slow work.
  Each stamps an input in µs on the PC's counter ([01-spine](01-spine.md#times)) as it pushes it, so the stamps rise in the order the loop takes the inputs.
- Everything the loop reads from disk arrives as an input too: the settings and the session file when the core starts, and the profile's bundle, its plugin included, when it loads.
- Handlers are synchronous, and none reads a clock, does I/O, waits, starts a thread, or iterates a `HashMap`, whose order is randomly seeded.
  Clippy's `disallowed_methods` fails a build of the loop's crates that calls a function their `clippy.toml` lists, such as `Instant::now`, `std::thread::spawn`, or `HashMap::keys`, and its `iter_over_hash_type` fails one that loops over a `HashMap` (documented, [Clippy's lints](https://rust-lang.github.io/rust-clippy/master/index.html)).
  No lint catches `.await` or I/O, so the third test keeps tokio and every crate that does I/O out of the loop's crates.
- A handler takes the time from its input.
  A timer is an output whose firing comes back as an input, and slow work, such as fetching a profile or loading a cockpit model, leaves as a job and comes back as an input.
  A timer's or a job's handler checks that what it was started for still holds, such as the aircraft a fetched profile was for.
- Moments the host raises queue on the loop and run before the next input, and a request the host decides is decided before the next input too.
  A moment's handlers run in the order their features registered, and no feature relies on that order.
- A profile's script and a plugin get no clock: their QuickJS-ng contexts leave out the `Date` and `Performance` intrinsics, which rquickjs adds one by one (read in rquickjs-core 0.14.0, `src/context/builder.rs`), and `Math.random`, which QuickJS-ng seeds from the wall clock ([5.1.1]).
  One that has to wait asks the host for a timer.
- The one clock read on the loop is QuickJS-ng's 100ms limit, which runs by the clock ([decision 046](../../decisions/046-sandbox-runtimes-and-limits.md)) in the host's interrupt handler; the recording keeps the count of interrupt calls at which a limit fired, so a replay stops that call at the same point.

The host records its queue, every input with its kind and stamp, under a header that names the build, so the same build replays a whole run from it, and a bug report names the build to check out.
Only the build that wrote a recording reads it as a replay.
What a later version reads from a recording, such as the report page's list of sessions, the debrief timeline, and plugin tests, is a separate record in a self-describing format with named fields, so adding a field breaks no older reader, and the recording's design in [node 6](plan.md#6-systems) shapes it, with how much of the queue a recording keeps.

One loop costs three things ([5.1.1]):

- A flow that takes many steps, such as catch-up, is a state machine written out, not an `async` function.
- A slow handler delays every input behind it, so [budgets](#budgets) bound each.
- A replay needs the same build, and the same profile's bundle, as the run it replays.

Actors on tokio, one per feature, would leave the order between features to the scheduler, so a replay would need every delivery recorded, and simulation runtimes replay a seeded world, not a pilot's run ([5.1.1]).

### What a feature registers

Each feature's crate exposes one `register` function, and the core's `main` calls each from one list, as Zed starts each of its own features with one call (read in Zed's main branch on 2026-10-14, `crates/zed/src/main.rs`, as [5.1.1] cites it).

```rust
// a sketch
pub fn register(host: &mut Registry) {
    let me = host.feature::<PointerSync>("pointer-sync");
    me.on::<LinkLost>(PointerSync::lock_displays);
    me.cockpit_kind(kind::PRESS, PointerSync::play_press);
    me.command(command::UNLOCK_DISPLAYS, PointerSync::unlock);
}
```

| Hook | The feature declares | A v1 example |
| --- | --- | --- |
| Moments | Which of the host's it handles | Pointer sync locks its displays on "link lost" ([01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)) |
| Session keys | Each key; whether one member or the whole session writes it; and whether its value names a member, in which case the host clears the key when that member leaves the session | Rate and pause owns the pause and the simulation rate ([01-between-machines](../network/01-between-machines.md#channels)) |
| Channels | Who sends and receives it, its delivery, and its priority | The flight model, as one-off packets ahead of every stream |
| Cockpit stream kinds | A kind, and the handler that applies it and says when it counts as applied ([04-order-and-recovery](../sync/04-order-and-recovery.md#the-cockpit-stream)) | Pointer sync's press counts as applied once its panel has played it through to the release |
| Catch-up steps | A step, and the steps it runs after ([04-room-for-later](../product/04-room-for-later.md#a-catch-up-pipeline)) | State sync's catching up state |
| Guards | A check on a request the host decides, [below](#guards) | None in v1 beyond the host's own |
| Client state and commands | A slice of state the apps show, and the commands they send | The take-control key's command to take control |
| Settings, notices, and items for the match check | Each one | The take-control binding; "Couldn't sync the beacon" |
| The helper's input and audio | The bindings, captures, and sounds it needs | The take-control key; capturing the ATC app |

A role is a session key a feature declares, whose value names the member who holds the role: traffic's key names the traffic host, and ATC audio's names the ATC host.
Where a later role limits who may hold it, its feature registers a guard on writing that role's key.
[Roles and members](../session/01-roles-and-members.md#the-table-of-roles) keeps the table of roles as the session's documentation, and the code holds no registry of them.
A feature whose messages must apply in order with the cockpit's, such as a later bus bridge carrying a message that opens a page ([04-room-for-later](../product/04-room-for-later.md#channels)), registers cockpit stream kinds rather than a channel, so no channel declares a place in the cockpit's order.

How a feature reaches the sim is in [the sim seam](#the-sim-seam), how it adds work to our WASM module and the panel bridge is in [work in the sim](#work-in-the-sim), and which crates hold the registry and the moments is [5.4](plan.md#54-the-workspace)'s.

### What a handler sees and does

A handler gets three things:

- its own feature's state, which it alone writes
- the host's state, read-only: the session and its keys, its members, control, each link's state, preflight, the loaded profile's blocks, the settings, sim awareness, and each request's verdict from the [guards](#guards)
- an outbox, for sends on channels, calls to the sim, work in the sim, requests to the helper, client state, notices, timers, jobs, and requests to the host

A feature never changes the host's state itself: it asks, and the host decides.
The take-control key asks for control, and the host's [guards](#guards) decide whether the pilot gets it.

Features reach each other only through moments the host raises, and no feature raises a moment of its own, since its type would live either in the raising feature's crate, which the handling feature would then depend on, or in the host's, which would keep it after the feature that raises it is deleted.
When the PF's or the PM's own change to an entry goes out on the cockpit stream, the host on that pilot's machine raises "cockpit sent" with the entry.
Avatars there, unless a click has just brought the figure's hand, reaches the hand for the entry's `location` ([01-format-and-delivery](../profiles/01-format-and-delivery.md#state-entries)) and sends the point as it sends a click's, since the clicking pilot's machine works out the hand ([decision 004](../../decisions/004-core-works-out-figures-hand.md)); the other machine only draws it, and avatars depends on no other feature for it.
A message the stream skips raises no moment.

### Guards

A feature that can block a request the host decides registers a guard on it:

```rust
// a sketch; the feature is hypothetical
me.guard::<TakeControl>(Instructor::only_the_instructor);   // Allow, or Deny("Only the instructor can take control")
```

- A guard is a quick, synchronous check on the loop that reads only its own feature's state and the host's.
- After every input, the host asks the guards of each request its pilot could make, and keeps the verdict, allowed or each denial's reason in the order the guards registered, in its read-only state.
  The apps show it, so the take-control button says why not before it's pressed, and a request the pilot makes takes the same verdict.
- Any denial refuses the request.
- Deleting a feature deletes its guards, and the host never knows they existed.
- The host's own rules are guards it registers on itself: control can't pass to a pilot while their catch-up or replay runs over a link that's up ([04-order-and-recovery](../sync/04-order-and-recovery.md#catch-up)), and the take-control input is live only while its pilot is in the flight, after preflight ([roles and members](../session/01-roles-and-members.md#the-pf)).
- Guards check requests: the take-control key and button, a voice handover's answer, and claiming a role's key.
  A pass the host makes itself, such as when the PF leaves the flight, isn't a request, and goes ahead as [roles and members](../session/01-roles-and-members.md#the-pf) requires.

### The traffic and ATC switch

Traffic and ATC audio each declare a role's key, the traffic host's and the ATC host's (user, 2026-10-14).
The host offers one request that claims several keys together, refused whole if any guard denies one, and the apps' "Share my traffic and ATC" switch sends it with both keys, and shows on while this pilot holds both.
The host never knows what either key is for, and deleting traffic removes its key from the switch in the apps, as deleting a feature removes its section in each app.
Both keys go out in one message on the session channel, and each key's stamp counts that key's own changes ([01-between-machines](../network/01-between-machines.md#channels)).
When both pilots flip the switch at once, both keys carry the same counts, so both settle on the same pilot (unverified; a [node 7](plan.md#7-testing) bench case in which both pilots claim at once settles it).
This changes [roles and members](../session/01-roles-and-members.md#the-traffic-and-atc-host), which gives the two one role that can split, and [decision 044](../../decisions/044-table-of-roles.md) once step 8's decisions are numbered.

### Budgets

Each is a starting value, which [node 7](plan.md#7-testing)'s bench measures:

- The queue stays under one sim frame at p99: 11.2ms at the 89 sim updates a second our module saw in a flight ([architecture log](log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)).
- A handler takes at most 1ms, apart from calls into QuickJS-ng, which keep their 100ms limit ([decision 046](../../decisions/046-sandbox-runtimes-and-limits.md)).
  One call at that limit holds back about 9 sim updates, in order (arithmetic), and about 5 of ATC audio's 20ms frames, which would reach the playback buffer after their turn and be dropped if the buffer holds less than 100ms (unverified; the ATC design sets the buffer, and the bench measures it).
- A write function that hits its limit fails that write, and its entry stops syncing on every machine for the rest of the load, as a plugin at its limit is turned off, because on one loop a stuck call holds up every input behind it, where [01-format-and-delivery](../profiles/01-format-and-delivery.md#the-sandbox) counted only the writes behind it.
  This changes decision 046 for write functions once step 8's decisions are numbered.
- The loop is busy less than 20% of one CPU core through a busy flight.

## The sim seam

The core's code meets the sim at SimConnect's own calls and messages, and everything that makes sense of them runs on the loop, so the sim, a stand-in, or a replay can sit below the seam and nothing above it changes (user, 2026-10-15).
The host holds one SimConnect connection from the sim's start, and gives each feature that reaches the sim a connection of its own for each load, so closing that connection takes the feature's work in the sim with it.

```text
 features
    │
 host's sim service
    │
 sim client (an engine, on the loop)
 ═════ the seam: calls out; messages, opens, and losses in ═════
    │
 the edge on SimConnect.dll, a stand-in sim, or a replay of the recorded queue
```

| Unit | Tier | What it does | Runs |
| --- | --- | --- | --- |
| Sim service | Host | Opens and closes the connections, knows which feature holds each, discards a message for a connection it closed, and keeps the host's own uses of the sim, [below](#what-the-host-keeps) | On the loop |
| Sim client | Engine | For each connection: hands out SimConnect's IDs, parses each message, and routes it to the call that caused it; on a lost connection the host opens again, makes its definitions, requests, and subscriptions again | On the loop, and in the IDE |
| Edge | Engine | Keeps each connection's handle on one thread, since SimConnect's clients "are not currently thread-safe" ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)); makes each call through `SimConnect.dll`; tags each exception with the handle of its call; and hands what comes up, stamped, to the program it runs in | Off the loop, in the core and the IDE |
| Stand-in sim | Engine | Takes the edge's place on the bench, and answers each call as the sim would, with SimConnect's own messages and its exceptions already tagged; [node 7](plan.md#7-testing) designs it | On the bench |
| Bindings | Engine | SimConnect's declarations, which bindgen generates from the SDK's headers ([01-spine](01-spine.md#the-core)) | With the edge, the sim client, and the stand-in |

Three kinds of input come up through the seam, each stamped and recorded: a message SimConnect hands over, copied whole; the result of each `SimConnect_Open`; and a connection's loss, from a failed call, a failed dispatch, or the sim's quit message ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)).
So the loop decides when to open a connection and when to try again, by timer, and a replay runs a sim's boot and restart too.

The edge tags an exception by reading `SimConnect_GetLastSentPacketID` after each call and matching the packet ID the exception names, as the SDK documents, though it intends the function "while debugging and testing the client application" rather than "in a final retail build" (documented, [SimConnect_GetLastSentPacketID](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Debug/SimConnect_GetLastSentPacketID.htm)).
Whether the tag holds among writes each frame is unverified: FS Copilot's traffic code read the packet ID only after its one-off calls (read in the FS Copilot fork, `FsCopilot/Connection/SimTraffic.cs`, `Call`, and `FsCopilot/Simulation/TrafficReceiver.cs`, `Render`), and no run of ours has matched an exception this way; [node 7](plan.md#7-testing)'s tests in the sim settle it.
An exception the edge can't match, such as one whose packet ID is 0, `UNKNOWN_SENDID` (read in MSFS 2024 SDK 1.7.3, `SimConnect.h`), still reaches the feature whose connection it came on.

### Why the seam sits at SimConnect's calls

- Each failure our earlier sim layers had sits above the seam, where the bench runs it and a replay runs it again:
  - fsc-editor read values in definition order, so a variable the sim rejected after the call had returned cut short the values after it, and one rejected mid-definition would have shifted them ([04-01](../../learn/foundations/04-01-connection-and-data.md#data-definitions-and-requests)).
  - fsc-editor defined a watch set only when it changed, so one that arrived while the sim was closed "stopped at the connection check and was never defined" (fsc-editor, `src/main/sim/session.ts`).
  - FS Copilot's `SimClient` never saw an exception: its reading connections handle none, and its writing connection reads no message (read in the FS Copilot fork, `FsCopilot/Connection/SimConnectConsumer.cs` and `SimConnectProducer.cs`).
- fsc-editor's replay entered after its own parsing and ran a path of its own beside the live one (read in fsc-editor, `src/main/sim/session.ts`, `startSim`).
  The replay's path fed the store of live values, while each live SimConnect handler had to feed it itself, and the input event handlers didn't, so they "captured every value, recorded it as evidence, and showed none of it", and that bug shipped (fsc-editor, `src/main/sim/fixtures/README.md`, `pa24-beacon-input`).
  Below our seam, the only code that runs live and never in a replay is the edge, which makes calls, tags exceptions, and copies bytes.
- A replay needs no record of the calls the core made, because the same build makes the same calls from the same inputs.
- The bench runs the real path, as [node 7](plan.md#7-testing) requires: FS Copilot's bench couldn't run with the sim open, since keeping it out "means making `SimClient` inert under `--bench`, which is real surface inside a shipping class" (FS Copilot fork, `record/pointer-forwarding/docs/14-test-bench.md`, "Do not run the simulator during a bench run").

It costs a stand-in that answers each kind of call our code makes with SimConnect's own messages, so each call a feature adds is one more for the stand-in to model.

### A connection for each feature, for each load

The host's connection opens as soon as `SimConnect_Open` returns `S_OK`, before the sim's open reply arrives ([architecture log][flight]), and stays open until the sim closes, for the host's own uses ([below](#what-the-host-keeps)).
A feature's connection opens at the feature's first sim call after its profile loads, and closes when the profile unloads or when the feature closes it.
A closed connection takes its definitions, requests, and subscriptions with it, so the feature's next call opens a new, empty one, and the sim service discards a message the edge brings for a closed connection.
A connection the sim loses while the sim runs on, the host's or a feature's, the host opens again at once, and the host's own, lost when the sim closes, on the sim's next run; the sim client makes the lost connection's setup again on the new one, and a feature hears of the loss, since the objects it created went with the connection.

Closing a connection is how a feature's work in the sim ends.
The SDK says that when a client closes, "the server will remove all objects, menu items, group definitions and so on" that the client defined or requested (documented, [SimConnect_Close](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/General/SimConnect_Close.htm)).
What we've measured is a client killed: the sim removed FS Copilot's injected traffic after its process was killed before its cleanup ran (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 0 capture read; TrafficInject built and smoke-tested — Q01, Q08 settled"), and a pilot's controls came back once the masking client was killed or its group cleared ([flight-controls log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)).

Connections of their own may also keep features apart: in one client, clearing one group cut another group off from the sim event both held ([architecture log][flight]), so on a shared connection one feature's teardown could silence another's listener, while whether a group on another connection keeps hearing that event is unverified.

Two costs come with them:

- The sim's order between two connections' messages is lost, and the queue orders them by the edge's stamps.
  No feature needs another's order, since features reach each other only through the host.
- v1 holds one connection for the host and one for each feature that reaches the sim, about six, as FS Copilot's app held five and its module a sixth ([04-01](../../learn/foundations/04-01-connection-and-data.md#what-it-is)), and what a connection costs the sim's frame is unmeasured.

[Node 7](plan.md#7-testing)'s tests in the sim settle what's unmeasured: whether closing a connection removes its AI objects and masks as killing its client did, whether a group on one connection keeps hearing an event while a group on another is cleared, and what a connection costs the sim's frame.
If closing a connection leaves its AI objects or masks behind, the sim service removes each feature's objects before closing its connection.
If connections cost the frame too much, it puts the features on one connection.
If a group on one connection stops hearing when a group on another is cleared, the spine's rule that the core clears no group while another of its groups hears that sim event ([01-spine](01-spine.md#the-core)) covers all of the core's connections.
In each case no feature changes, since no feature sees a connection.

### What a feature sees

```rust
// a sketch
// in register:
me.on_sim(Traffic::on_sim);   // a value, a created object's ID, an exception with its call, a frame

// in a handler:
let sim = out.sim();                                        // this feature's sim calls; the host opens its connection on first use
self.copies.insert(key, sim.create_ai(title, livery, at));  // a handle now; the object's ID arrives as an input
```

- A feature names variables and events as the sim spells them, `A:`, `L:`, `B:`, and `K:` among them, as a profile names them ([01-format-and-delivery](../profiles/01-format-and-delivery.md#names)).
  A list of names, or a struct whose fields name its variables, such as the flight model's pose, reaches the sim as one tagged watch.
- Each call returns a handle at once, so whatever comes back, a value, an object's ID, or an exception, reaches the handler with the handle of the call that caused it, though for an exception among writes each frame that's unverified ([above](#the-sim-seam)).
- A feature gets the ID the sim gives each object it creates, as our avatar probe handed the figure's ID to the module that placed it (read in `experiments/areas/avatars/p12-wasm.mjs`, `setModule`).
  It never sees a connection, the numbers that name its definitions, requests, events, and groups, or SimConnect's message layouts.

### What the host keeps

- **Masking:** a group that registers after an aircraft's module sits behind it ([flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)), so the host's connection takes its group as the sim starts ([flight-controls log](../flight-controls/log.md#2026-10-07-a-group-that-takes-its-priority-as-the-sim-starts-held-open-by-an-event-it-only-listens-to-masks-ahead-of-accu-sim-once-it-adds-the-axis)), and a later feature that masks asks the host.
- **The module's version and counter:** our WASM module is the host's, and the host's connection reads the slots where the module leaves its version and its counter; a feature's routines there are fed on the feature's own connection ([work in the sim](#work-in-the-sim)).
- **The CommBus event that announces the core's port** ([01-spine](01-spine.md#finding-the-core)).
  Any other CommBus event a feature subscribes to or calls goes through the feature's own connection, as any sim call does.
- **Sim awareness** ([01-spine](01-spine.md#sim-awareness)): it raises one moment for each load, however many signals the sim sends.
  When the host's connection opens on a sim already in a flight, it raises one for the load it finds, which it asks the sim for, since a system event reports only what happens after the subscription ([04-02](../../learn/foundations/04-02-events.md#system-events-and-state)).
  Whether its logic is an engine of its own, which the bench could test alone and the IDE could link, is node 6's (user, 2026-10-15).

### The sim seam's budgets

Each is a starting value, which [node 7](plan.md#7-testing) measures:

- The edge puts a message on the queue within 1ms of SimConnect signaling it, at p99.
- v1's connections and their watches add under 0.2ms to the sim's frame, about the 0.18ms by which two runs of the A2A PA-24 with nothing of ours differed ([01-spine](01-spine.md#the-sims-pages)), leaving out traffic's copies, whose models cost frames whoever drives them ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)).

### Cases for the bench

Node 7 turns each into a test, on the bench or in the sim:

- `AircraftLoaded` arriving several times for one load, as it came three times in one load to our client ([architecture log][flight]), raises one moment.
- The host's connection opening on a sim already in a flight raises one moment, for the load it finds.
- Several `Frame` events in one read, which FS Copilot's traffic thread got "for frames already rendered" when the sim outpaced it (read in the FS Copilot fork, `FsCopilot/Connection/SimTraffic.cs`), each reach the loop as an input of its own.
- Traffic's copies, written each `Frame` through the loop while a write function hits its limit in the same load, move as smoothly as FS Copilot's, which it wrote inside its own `Frame` handler at a median jitter of 0.17, where 0 is constant motion and near 1 is stop-and-snap ([04-01](../../learn/foundations/04-01-connection-and-data.md#writing-data)).
- A message for a closed connection is discarded.
- An AI create with a title the sim lacks: its exception reaches the call, through the stand-in's tag on the bench and the edge's in the sim ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#the-ai-objects-api-and-the-facilities-api)).
- A variable the sim rejects from a definition after the call returned: the definition's other values still arrive.
- The host's connection, opened as the sim boots, takes its masking group as soon as `SimConnect_Open` returns `S_OK`, and the calls it makes before the sim's open reply arrives take effect, as [the spine](01-spine.md#the-core) measured.
- A connection the sim loses, and the host opens again, has its definitions, requests, and subscriptions made again, as the host's does when the sim closes and starts again.

## Work in the sim

A feature's work in the sim is code of its own: routines in our WASM module, built into the module's one binary, and panel modules, each a file the panel bridge loads by name (user, 2026-10-15).
A routine runs from its feature's first feed until the feature ends it, or until 1s passes with no write to its data slot, which the sim service writes again every 200ms while the core runs.
Each frame it asks the module's host for what it wants, and the module's host undoes the one want that lasts past the frame that asked for it: the freeze.
In a cockpit panel, the bridge owns only what can block the pilot's input, and gives each of those the three protections [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) asks for.
A plugin ships no code into the sim, and drives mechanisms the two hosts own ([decision 020](../../decisions/020-plugin-code-runs-only-in-core.md)).

```text
 the core                                     the sim
 a feature's crate ── its routines' slots ──▶ our WASM module: its host ── its edge ── the sim's APIs
   │                                            └─ the feature's routines, in the module's one list
   └──── the panel's socket ────────────────▶ the panel bridge, in each cockpit panel
                                                └─ the feature's panel modules, each a file of its own
```

### Routines in our WASM module

A routine is a small crate of its feature's, built for wasm32 into the module's one binary through one line in the module's list, and natively for its tests and for [node 7](plan.md#7-testing)'s stand-in sim, which runs the module's host and routines on the bench.
It never calls the sim: the module's host hands it its slot's values and each frame, and does what it asks.

```rust
// a sketch: flight-model sync's routine
pub struct Follow { samples: Samples<PoseSample> }

impl Routine for Follow {
    const ID: RoutineId = routine::FOLLOW;   // with FollowSlot, in flight-model sync's module of the message crate
    type Slot = FollowSlot;

    fn on_slot(&mut self, s: &FollowSlot) { self.samples.push(s.sample) }   // a new feed

    fn frame(&mut self, f: &Frame, want: &mut Wants) {
        want.freeze();                                    // in every frame it runs, with a pose to write or not
        if let Some(pose) = self.samples.at(f.now - DELAY) {
            want.write(&pose);                            // the pose and the velocities, as the struct's fields name them
        }
    }
}

// the module's one list
routines![preflight::Hold, flight_model::Follow, avatars::Figure, plugins::Mechanisms];
```

```rust
// a sketch: flight-model sync's crate in the core
out.module().feed(routine::FOLLOW, FollowSlot::from(sample));   // on each pose from the flying machine
out.module().end(routine::FOLLOW);                              // when this pilot takes control
```

- **Its slot:** the module creates each routine's slot when it loads, named `CROSSCHECK_` and the routine's ID, such as `CROSSCHECK_FOLLOW`.
  A feed goes out on the feature's own connection, as every sim call of a feature's does ([a connection for each feature](#a-connection-for-each-feature-for-each-load)), and the sim service writes the last feed again every 200ms until the feature feeds another or ends the routine, so no feature keeps its routine alive by hand.
- **Its header:** each slot opens with a header the sim service writes and the module's host reads, a count of the feature's feeds and an end mark, so a routine hears `on_slot` only for a new feed, not for the sim service's rewrite, and an ended slot holds its end mark until the next feed.
- **Its life:** the module's host makes a routine new at the first feed after it was ended or went unfed, and drops it at its end mark or once 1s passes with no write, so no routine carries state from one feeding into the next.
  A feature ends its routine when it's done with the work, as flight-model sync does when its pilot takes control, and the host ends each of a feature's routines before it closes the feature's connection at unload, so the 1s timeout is only for a core that's gone.
- **How many:** a feature has a routine for each piece of work that starts and stops on its own, so following is one routine, `Follow`, and avatars' figure and its hand, which never exist apart, are one, `Figure`, with every figure in one slot of up to 8,192 bytes ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits)).
- **The host's own:** preflight's `Hold`, which asks only for the freeze, and the plugins' `Mechanisms` are the host's own routines, fed on the host's connection.
  The host ends `Hold` when preflight ends and `Mechanisms` when the profile unloads, and ends both when the session ends.
- **Through a gap:** `Follow` asks for the freeze in every frame it runs, so the aircraft stays frozen before its first sample is old enough to write and after it runs past its newest one; what it writes through a gap in the flying machine's data is flight-model sync's design ([softening a short gap](../network/01-between-machines.md#softening-a-short-gap)).

The module never learns the session's state, so routines' slots replace the control slot of [decision 017](../../decisions/017-core-writes-control-slot-every-200ms.md), which the core writes every 200ms with the session's state and a counter, and a numbered decision records the change when step 8's decisions are numbered.
[Decision 005](../../decisions/005-wasm-module-writes-following-aircraft.md)'s 1s timeout stands with less to undo: it also clears every variable of ours that holds something back, and no v1 routine sets one, so the freeze is all that's left.

### What a routine can ask for

| A want | The module's host | When no running routine asks for it |
| --- | --- | --- |
| Read named variables, of the pilot's aircraft or of an object by its ID | Reads them during the routine's frame | Nothing to undo |
| Write named variables, on the pilot's aircraft or on an object by its ID | Writes them once every routine's frame has run | Nothing to undo: the sim's physics, or the object's last place, carries on |
| Freeze the pilot's aircraft | Reads the three freeze flags each frame, and freezes the aircraft when it isn't frozen | Unfreezes it, if it froze it |
| Run calculator code, for a plugin | Runs it | Nothing to undo |

- The freeze is the one want that outlasts the asking, so it's the one the module's host undoes, and it releases only a freeze it set.
  FS Copilot's module shows what goes wrong otherwise: its timeout sends the unfreeze whoever froze the aircraft, and leaves the module's own `frz_by_me` set, so `interpolate` stays armed and writes whatever pose its buffer returns into the aircraft it unfroze (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `Update_StandAlone` and `interpolate`, and `stream_buffer.h`; not run).
  Our module's host keeps no flag for a routine, since a routine that isn't running asks for nothing.
- Preflight's hold and `Follow` both ask for the freeze, and the module's host freezes while either asks, so when preflight ends and following starts in one frame, the aircraft never unfreezes between them.
- No two of v1's routines write the same variable.
- Which of the sim's APIs carries each want is for the module's host to choose, and no routine sees it.
- A routine that needs a want this table lacks, such as firing an `H:` event, adds it to the module's host, and that's the only change to the module's host a new routine makes.

### When the module stops

A module whose code hits an error goes `DIRTY`, and the sim stops running it (documented, [05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md#debugging-crashes-required-exports)), so one routine's error would stop every routine, and with them the module's host, which would unfreeze the aircraft; whether a Rust panic, which traps, puts our module there is unverified, since our records hold no module crash.
So the core unfreezes it.
When the module's counter hasn't moved for 3s, in a flight that's neither loading nor paused, the host's connection reads `A:IS LATITUDE LONGITUDE FREEZE ON`, `A:IS ALTITUDE FREEZE ON`, and `A:IS ATTITUDE FREEZE ON`, the flags FS Copilot's module reads (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `module_init`), and sends `K:FREEZE_LATITUDE_LONGITUDE_SET`, `K:FREEZE_ALTITUDE_SET`, or `K:FREEZE_ATTITUDE_SET` with 0 for each that's on, as a client outside the sim released a frozen Baron that way (measured on MSFS 2024, 2026-10-03, [flight-model log](../flight-model/log.md#2026-10-03-freezing-holds-the-pose-but-not-the-velocities-so-a-follower-has-to-write-them-all)).
In a session, the core takes any freeze to be ours.
A pause is left out because whether the sim runs a standalone module's update during a pause is unmeasured ([05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md#lifecycle-init-per-frame-update-deinit)).
Each routine's crate denies Clippy's `unwrap_used`, `expect_used`, `panic`, and `indexing_slicing` lints (documented, [Clippy's lints](https://rust-lang.github.io/rust-clippy/master/index.html)), so the commonest panics, an `unwrap`, an `expect`, a `panic!`, and an index out of range, fail its build.

### Modules in the panel bridge

- The sim loads our `VCockpit.js` override into every cockpit panel, and the override is the sim's file plus a few guarded lines, which load the bridge's own file and queue each instrument the sim creates before that file has loaded, as FS Copilot's copy does ([06-02](../../learn/foundations/06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open)).
  Everything of ours beyond those lines is in files of its own, so a mistake in one of them stops no instrument.
- A feature registers each panel module with a rule for which panels get it, as pointer sync's takes the panels its profile's [`displays`](../profiles/01-format-and-delivery.md#displays) names, and the core answers a panel's first message with the modules to load ([decision 011](../../decisions/011-cockpit-panels-connect-only-in-session.md)) once the profile has loaded, since a panel can connect before it does ([01-spine](01-spine.md#the-sims-pages)).
- A first message naming the instruments another socket holds replaces that socket, and the core closes the old one, since a page's socket stays open after a reload ([decision 010](../../decisions/010-clients-message-core-every-2s.md)).
  A press sent to the old socket that its panel never played is skipped and counts as applied, as a press for a display whose panel hasn't announced itself does ([the cockpit stream](../sync/04-order-and-recovery.md#the-cockpit-stream)).
- The bridge loads each panel module from its own file and calls its `start` and `stop` each in a `try`, so one that throws stops only itself.
  Whether a file that fails to parse stops the bridge's later loads in its panel is unverified, and a case for the bench settles it.
- A panel module and its feature trade messages from the message crate over the panel's socket, tagged with the module's name ([decision 025](../../decisions/025-messages-in-one-rust-crate.md)).
- A plugin ships no panel code: its operations, such as reading a setting in a gauge's JavaScript, run in `ops`, the bridge's own panel module, which the core loads into the panels the plugin's operations name, so the plugin's API names those panels when its profile loads.
- A panel module can read an aircraft's CommBus.
  Of the 43 CommBus names that only the A220's other panels listen on, 39 sent something during the run, and a listener of ours in one panel heard all 39; it also asked for the aircraft's full state with `A22X.Resync` (measured on MSFS 2024, 2026-09-28, [CommBus log](../commbus/log.md#2026-09-28-a22xresync-returns-the-a220s-full-state-and-one-listener-hears-every-channel)).
  So the bus bridge and the A220's adapter, which come after v1, read the A220's bus from a panel module, whether or not a SimConnect client can hear it.

```ts
// a sketch: pointer sync's panel module, built by esbuild at es2017 into pointer-sync.js
CROSSCHECK_BRIDGE.define("pointer-sync", {
  start(ctx) {
    ctx.root.addEventListener("mousedown", onDown, true);   // reads presses, blocks none
    ctx.on("press", play);                                   // a press from the other pilot
  },
  stop() { /* removes its listeners; the bridge drops its locks */ },
});
```

### What the bridge owns

The bridge owns only what can block the pilot's input:

- **Locks:** a lock is an overlay the bridge places for pointer sync, either a visible one over a display blocked through an outage, or an unseen one while another pilot's gesture replays, as FS Copilot's panel code places both ([pointer sync](../product/03-v1-scope.md#pointer-sync); [06-02](../../learn/foundations/06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open)).
  The bridge's hit test looks past its own overlays, as FS Copilot's sets its overlay's `pointer-events` to `none` around `elementFromPoint` (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/overlay.js`, `hitTest`), so a gesture replayed under either lock still reaches the display.
  A lock holds only while the core renews it over the panel's socket every 2s; 8s to 10s after the last renewal, a visible lock turns into a warning that blocks nothing, as FS Copilot's does ([01-spine](01-spine.md#what-moves-them)), and an unseen one goes; the panel module that asked for it stopping, or the socket closing, drops it at once.
- **Later wrappers and CommBus handlers:** no v1 panel module wraps one of the sim's APIs or listens on the CommBus.
  A later one asks the bridge to install a wrapper, and the bridge suppresses the wrapped call only for one dispatch and clears that unconditionally afterward, restores the original through `window.CROSSCHECK_UNLOCK()`, and uninstalls the wrapper after 120s idle: the rules the FS Copilot fork took from a probe whose wrapper left an A350 display taking no clicks ([06-02](../../learn/foundations/06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open)).
  The bridge also runs each CommBus handler of ours in a `try`, since `Coherent._trigger` calls a name's handlers with no `try`, so one that throws would stop the aircraft's own handlers after it (read in the sim's `Coherent._trigger`, [CommBus log](../commbus/log.md#2026-09-28-a-script-that-arrives-after-a-panel-loaded-can-list-every-commbus-name-the-panel-registered); not run).
- **The fixed global:** `window.CROSSCHECK_UNLOCK()` removes every lock and wrapper in its document and stops every panel module, from the inspector or any other console.

Anything else a panel module adds, such as pointer sync's listeners, its own `stop` removes, and one it leaves behind reads clicks and sends to a closed socket, blocking nothing.
FS Copilot's panel code, by contrast, replaces `EventTarget.prototype.addEventListener` in every document and never puts it back ([06-02](../../learn/foundations/06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open)).

### How work in the sim ends

| What happens | Our WASM module | Panel bridge |
| --- | --- | --- |
| A feature is done with some work, such as its pilot taking control | The feature ends the routine, and the module's host drops it on the next frame | The feature stops the panel module, and the bridge drops the module's locks |
| The profile unloads, or the session ends | The host ends each of the feature's routines, then closes its connection | The core stops each panel module, and a panel left with none closes its socket |
| The core hangs | 1s with no write leaves every routine unfed | Each lock turns into a warning 8s to 10s after its last renewal |
| The core exits | The same | Its socket closes, and the bridge stops every panel module and drops every lock |
| Our own code in the sim stops | The module goes `DIRTY`, and the core unfreezes the aircraft | A bridge that never loaded sends no first message, and the core reports it ([decision 011](../../decisions/011-cockpit-panels-connect-only-in-session.md)) |
| A person steps in | Nothing to call | `window.CROSSCHECK_UNLOCK()` |

### Budgets for work in the sim

Each is a starting value, which [node 7](plan.md#7-testing) measures:

- Our module's update, every routine's frame and the module's host's work together, takes under 0.1ms a frame at p99; the sim's WASM Debug window graphs each module's time per update (documented, [05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md#debugging-crashes-required-exports)).
- The panel modules add no frame time we can measure.
  Only sockets are measured so far: one in each of the PA-24's 16 cockpit panels added none ([01-spine](01-spine.md#the-sims-pages)).

### Cases for the bench, for work in the sim

- When a pilot takes control, their aircraft unfreezes on the first frame after `Follow`'s end mark arrives, flies on from the velocities last written, and is still flying 5s later.
- When preflight's hold ends and following starts in one frame, the aircraft stays frozen through it, and through the first 400ms before `Follow` has a sample old enough to write.
- Through a 20s gap in the flying machine's data, the following aircraft stays frozen.
- A routine fed again after its end mark starts with nothing from its last feeding.
- With the core killed, the following aircraft unfreezes within 1s of the last write, plus a frame.
- With the module stopped by an error, from a test routine built to panic, the module goes `DIRTY` and the core unfreezes the aircraft within 3s of the counter's last tick, while the counter stalling through a flight load or a pause unfreezes nothing.
- A panel module that fails to parse, or throws in `start`, leaves the other panel modules in its panel running.
- With the core suspended, a locked display's overlay turns into a warning within 10s, and `window.CROSSCHECK_UNLOCK()` removes it at once.
- With the core's socket closed, every lock drops and every panel module stops at once.
- A panel that reloads mid-session gets its panel modules again on its new socket, and the core closes the old one.
- A CommBus handler of ours that throws leaves the aircraft's handlers after it running.

## The workspace

One repository holds all of Crosscheck: its programs, our WASM module, our code in the sim, the backend, and the profiles (user, 2026-10-15).
Its folders follow the [tiers](#tiers), and each feature keeps every part it has in one folder, so deleting a feature is deleting that folder, its modules in the message crate and the profile engine, and its line in each program's list.
One Cargo workspace builds every Rust crate, the module's among them, one npm lockfile covers every TypeScript folder, and build tools in TypeScript, run by Node, build every target from the one copy of the SDK that cargo-msfs installs.
CI runs on Windows, and one script checks both the crates and the TypeScript imports against this map.

```text
crosscheck/
  Cargo.toml  Cargo.lock  package.json  package-lock.json  rust-toolchain.toml
  engines/<name>/        messages, profile, sync, transport, recording, sim client,
                         sim edge, stand-in sim, the SDK's bindings
  host/<name>/           the core's host, our WASM module's host, the panel bridge
  features/<name>/
    core/                its crate in the core
    routines/            its routines in our WASM module
    panel/               its panel modules
    desktop/  efb/       its sections of the desktop app and the EFB app
  apps/
    core/  watcher/  helper/   each program's main, and its list of features
    desktop/             Tauri: its Rust side, and its pages built by Vite
    wasm-module/         the cdylib cargo-msfs builds: the edge, and the routines' list
    sim-pages/           the VCockpit.js override, the EFB app, the banner, the menu script
    ide/                 the Crosscheck IDE, once it's built
  profiles/              aircraft/ and modules/, as 01-format-and-delivery's repository
  backend/               the Cloudflare Worker
  tools/                 the build, the packaging, and the map check
```

A feature has only the parts it needs: pointer sync has a crate in the core, panel modules, and sections in the apps, and no routines.
Which crates each tier folder holds is node 5's, once the systems are named.

### Building every target

| Target | Built by | From |
| --- | --- | --- |
| The core, the watcher, the helper, and the desktop app's Rust side | `cargo build`, for x86_64 | The workspace's root |
| Our WASM module | cargo-msfs, for wasm32 | `apps/wasm-module/` |
| Our code in the sim: the bridge, panel modules, and the sim's pages | esbuild at `es2017` ([decision 030](../../decisions/030-in-sim-code-es2017-esbuild.md)), then the Coherent GT check ([decision 031](../../decisions/031-coherent-gt-check-tool.md)) | `tools/` |
| The desktop app's pages | Vite, which Tauri runs | `apps/desktop/` |
| The backend | wrangler | `backend/` |
| The messages' TypeScript types | ts-rs, during `cargo test` of the message crate | `engines/messages/` |
| The profiles' bundles | The profile engine's builder | `profiles/` |

- **Our WASM module is a member of the workspace,** left out of `default-members` because its build script needs what cargo-msfs sets, and cargo-msfs builds it from its own folder.
  p11 built it that way against the same message crate as the Windows side, sharing one `target/` folder and one `Cargo.lock`, and building either side after the other compiled no crate ([architecture log][p11]).
  cargo-msfs refuses a crate whose build outputs more than one file (read in navigraph/cargo-msfs v1.1.0, `src/main.rs`, Build), so `apps/wasm-module/` is a cdylib alone, and the module's host and the routines are crates of their own, which the stand-in sim links natively.
  A feature turned on by a crate of the core's stayed out of the module's build ([architecture log][p11]).
- **One copy of the SDK** serves both: cargo-msfs installs it in its data folder, `%APPDATA%\cargo-msfs\data\msfs2024`, and that copy holds SimConnect's header, its import library, and `SimConnect.dll` (read on disk, SDK 1.8.1, 2026-10-15).
  The bindings' build scripts read the SDK from `MSFS_SDK`, which cargo-msfs sets for the module and which falls back to that folder for the Windows side, so `cargo build` needs no setting of its own.
  bindgen generates the bindings at each build, through libclang, so no file derived from the SDK's headers is in the repository.
- **`RUSTFLAGS` is never set,** in CI or in our tools, because cargo-msfs hands the build its caller's environment after setting `RUSTFLAGS` to its own link arguments (same function), and ours would replace them; Clippy's `-D warnings` goes on Clippy's own command line.
- **The release profile is the root's,** with `lto` and `strip` on, as cargo-msfs's README asks, since a workspace reads profiles only from its root.
- **The messages' TypeScript types** are generated into `engines/messages/`, committed, and imported from there by every TypeScript folder; CI generates them again and fails on any difference, which answers the spine's [left open](01-spine.md#left-open) item on that check.
  The derives that generate them built into the module in p11, so the message crate needs no second form for wasm32.
- **TypeScript** has one `package.json` and one lockfile at the root, and npm workspaces only in `apps/desktop/` and `backend/`, whose tools each take a folder of their own: the Tauri CLI uses the folder it runs in when that holds a `package.json` (read in tauri-apps/tauri, its default branch on 2026-10-15, `crates/tauri-cli/src/helpers/app_paths.rs`).
  A feature's TypeScript folders have no `package.json` of their own.
  Each target's tsconfig sets its own `lib`: ES2017 for our code in the sim, as [decision 030](../../decisions/030-in-sim-code-es2017-esbuild.md) sets it, the latest with the DOM for the desktop app's pages, and the Workers' types for the backend.
- **One version** lives in the root `Cargo.toml`'s `[workspace.package]`, which every crate inherits, as [decision 026](../../decisions/026-first-message-carries-version-and-hash.md) asks; Tauri takes the desktop app's from its crate when `tauri.conf.json` names none (documented, [Tauri's configuration](https://v2.tauri.app/reference/config/#version)), and the build writes it into the Community package's `manifest.json`, as p08's build script writes its manifest (read in `experiments/areas/architecture/flight/build.mjs`, `finish`).
- **`tools/build.ts`** builds the Windows programs, generates the messages' types, builds the module, bundles our code in the sim, checks it, builds the desktop app, and lays out the Community package with its `layout.json` and `manifest.json`, as p08's build script does.

### Profiles in this repository

The profiles, plugins, and modules that [01-format-and-delivery](../profiles/01-format-and-delivery.md#the-repository) puts in a public repository of their own live in `profiles/` here instead, with `aircraft/` where that repository has `profiles/` (user, 2026-10-15).

- An import still names a module's path without `.yaml`, from `profiles/`, so `modules/gns-430` names `profiles/modules/gns-430.yaml`.
- `CODEOWNERS` names each profile's maintainers by its path, as it would in a repository of their own.
- CI checks and builds the profiles on every pull request that changes `profiles/` or the profile engine, against the engine at the same commit, and publishes them on this repository's GitHub Pages site on each merge that changes a bundle, apart from Crosscheck's releases.
  A repository has one Pages site (documented, [About GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)), which the profiles take, and a Free organization serves Pages only from a public repository (documented, [GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)), which this one is from v1 (user, 2026-10-15).
- One pull request can change the profile engine, the declarations for a new level, and the profiles that use it, and no package of our tools has to be published for another repository's CI.
- An author who wants only the profiles clones without file contents and checks out `profiles/` alone, as git offers, and the profiles' contributor documentation shows how:

  ```bash
  git clone --filter=blob:none --sparse https://github.com/<org>/crosscheck.git
  ```

  ```bash
  git sparse-checkout set profiles
  ```

  An author can also edit a profile on GitHub's site, which forks the repository and opens the pull request, and tests in the sim from a local profiles folder either way ([testing an edit](../profiles/01-format-and-delivery.md#testing-an-edit)).

### CI

CI runs on Windows runners only (user, 2026-10-15), because Crosscheck runs only on Windows:

- Our code runs in CI as it runs on a pilot's PC, which matters since Windows' C runtime picks its floating-point math by CPU ([5.1.1]).
- The core builds a local bundle with the same builder code CI uses, and equal hashes prove two testers run the same copy ([testing an edit](../profiles/01-format-and-delivery.md#testing-an-edit)), so CI builds bundles on the system the core does.
- One toolchain setup serves every job: Visual Studio's linker, LLVM for bindgen, cargo-msfs and its SDK, and Node.

Windows runners cost more where minutes are billed (documented, [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)), and standard runners are free for a public repository (same page), as this one is when CI starts.
They also run slower: reports put builds on Windows at up to about 2x their time elsewhere (unverified; [rust-lang/rust#66192](https://github.com/rust-lang/rust/issues/66192) compared two local machines, and [runner-images#5166](https://github.com/actions/runner-images/issues/5166) a .NET project), and the build's design measures ours with `cargo build --timings`.

Each pull request runs Rustfmt, Clippy, and the tests of the default members; builds the module and checks its exports against the list p03 checked; type-checks each tsconfig and runs the Coherent GT check on every file we ship into the sim; generates the messages' types and checks for a difference; runs the map check; and checks and builds the profiles.

### The map check

The code map's [third test](#tiers) is a script in `tools/` that CI and a developer both run.

- Each crate names its tier in its `Cargo.toml`, under `[package.metadata.crosscheck]`, and the script reads every crate's dependencies within the workspace from `cargo metadata`.
- A TypeScript folder's tier is its place in the tree, and the script runs esbuild over each TypeScript entry with its metafile on and nothing written, so the metafile lists every file the entry pulls in and what each imports.
- It checks the rules [tiers](#tiers) gives, against both: an engine depends on no host or feature; no feature depends on another feature's code; the loop's crates depend on neither tokio nor any crate that does I/O; only the sim's edge depends on the bindings to `SimConnect.dll`; and a routine depends only on the message crate and our WASM module's host.

cargo-deny can ban a dependency only by naming, for each crate, which crates may depend on it (read in torrust/torrust-tracker, `deny.toml`, at 9c8bcdf), so it would hold one entry per crate where the script holds the rules once; rust-analyzer's tidy check and Zed's conformity check test no layering (read in rust-analyzer at 442835b, `xtask/src/tidy.rs`, and Zed at 780ac03, `tooling/xtask/src/tasks/package_conformity.rs`).

### Budgets for the workspace

Each is a starting value, which the build's design measures:

- A pull request's CI finishes within 20 minutes with a warm cache.
- `cargo build` of the default members, after a change to one feature's crate, finishes within 1 minute on our development machine.

## Left open

- Whether a recording replays on a PC with a different CPU: Windows' C runtime picks its FMA3 math by CPU, and "Differences may also be observable between computers" ([5.1.1]), while whether Rust's `f64` functions reach that math on our target is unverified; replaying a recording made on one PC on a PC with another CPU settles it.
- What [a connection for each feature](#a-connection-for-each-feature-for-each-load) leaves unmeasured, and whether the edge's exception tags hold among writes each frame: [node 7](plan.md#7-testing)'s tests in the sim.
- If traffic's copies, written each frame through the loop, move less smoothly than FS Copilot's ([cases for the bench](#cases-for-the-bench)), writes each frame move into the edge, which changes the seam: [node 7](plan.md#7-testing).
- The stand-in sim's model, how it paces frames, how it plays our WASM module, and how a core on a stand-in reaches the sim's pages, which connect to the core beside this seam, so its pilot can reach Ready to fly and use Go to: [node 7](plan.md#7-testing).
- Which of the sim's APIs carries each want of the module's host, which operations the bridge's `ops` module offers plugins, and how a plugin's API names the panels they reach: [node 6](plan.md#6-systems).
- Two cores in sessions on one sim would feed the same slots, which a developer running a development core beside the installed one doesn't do, so nothing guards against it (user, 2026-10-15).
- Which host loads the EventBus bridge's listener into the EFB's document, which [04-room-for-later](../product/04-room-for-later.md#code-inside-the-sim) leaves open, for after v1.
- Which crate each unit is, which tier folder holds it, and what each may depend on, the registry and the moments among them: node 5's map.
- Which build of the profile engine CI builds the profiles' bundles with, since every bundle it publishes must load in released cores: the engine at the same commit, if the level rule covers the builder's output, or the latest released one: [node 6](plan.md#6-systems)'s design of the profile engine.
- Whether cargo-msfs can install a given version of the SDK, since its install command fetches the newest (read in navigraph/cargo-msfs v1.1.0, `src/main.rs`, `install_latest_sdk`), so two builds a month apart could compile against two SDKs: the build's design in [node 6](plan.md#6-systems).
- Whether Tauri 2 reads a version a crate inherits from the workspace, which the first build of the desktop app settles; if it doesn't, the build writes the version into `tauri.conf.json` too.
- How long CI takes on Windows runners, and how much a warm cache saves: the build's design measures it with `cargo build --timings`.
- Whether QuickJS-ng's hash seed, which it takes from the wall clock when it makes a context ([5.1.1]), changes anything a script sees: a replay run twice settles it.
- Which of the host's hooks and moments plugins reach through QuickJS-ng, and whether a plugin needs a moment only a feature could raise, which this design gives no feature: [node 6](plan.md#6-systems).
- How much of the queue a recording keeps, which the parked probe [p10](../../../experiments/areas/architecture/p10-recording.mjs) sizes, and the self-describing record a later version reads: [node 6](plan.md#6-systems).
- Whether one loop meets its budgets, which p10's loop measures offline: [node 7](plan.md#7-testing).

[flight]: log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start
[5.1.1]: log.md#2026-10-14-a-core-replays-a-whole-run-when-one-ordered-loop-owns-its-state-and-takes-every-input-stamped-through-one-queue-as-sans-io-cores-lmax-and-tigerbeetle-run-and-neither-actors-nor-simulation-runtimes-can-replay-a-run-from-a-pilots-pc
[p11]: log.md#2026-10-15-our-wasm-module-builds-with-cargo-msfs-from-inside-the-cores-cargo-workspace-against-the-same-message-crate-and-neither-build-disturbs-the-others
