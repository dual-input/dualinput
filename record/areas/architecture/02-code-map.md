# Architecture: the code map

```text
Purpose:     The units of Crosscheck's code, which tier each is in, what each owns, its interface, and what it may depend on.
Depends on:  01-spine.md, decisions.md, log.md, ../network/01-between-machines.md, ../sync/04-order-and-recovery.md, ../session/01-roles-and-members.md, ../profiles/01-format-and-delivery.md, ../product/04-room-for-later.md
Decides:     The tiers and the tests that keep each unit apart (node 5); how the host runs its features, and what a feature registers with it, calls, and guards (node 5.1); where the core's code meets the sim, so a stand-in and a replay can take the sim's place, and which SimConnect connections the core holds (node 5.2).
```

Crosscheck's code is a host, engines, and features.
The core runs as one loop that owns all its state and takes every input, stamped, from one queue, and each feature plugs into that loop through one registration, so deleting a feature leaves everything else building and passing its tests (user, 2026-10-14).
A feature reads the host's state, reaches other features only through moments the host raises, and reaches the world only through outputs, and a feature that can block a request registers a guard rather than having the host check on it.

This answers node 5 of the [architecture plan](plan.md#5-the-code-map), whose children settle its parts; the plan says which are settled.
The tentative decisions behind it start at [decisions.md](decisions.md#crosschecks-code-is-a-host-engines-and-features-and-deleting-a-features-crate-leaves-the-rest-whole).

## Tiers

| Tier | What it is | Examples |
| --- | --- | --- |
| Host | The services every feature uses: in the core, and in the sim through the panel bridge and our WASM module, which load what features and plugins run there by name ([04-room-for-later](../product/04-room-for-later.md#code-inside-the-sim)) | The session and its keys, control, channels, the cockpit stream, catch-up, the client protocol, settings, notices, recording, the sim service, sim awareness |
| Engines | Libraries that know nothing of the app, so another program can link them, such as the [Crosscheck IDE](../product/ideas.md#crosscheck-ide) | The message crate, the profile format, the sync engine, the transport, the recording format, the sim client, the stand-in sim |
| Features | Each one thing a pilot gets | Pointer sync, avatars, traffic, ATC audio, the take-control key, rate and pause, the PF's spot on the world map |

Three tests stand in for a definition of clean, because a definition in prose invites an agent to enforce it where it doesn't fit (user, 2026-10-14):

- Deleting a feature leaves everything else building and passing its tests: its crate, its one registration, its module in the message crate and its module in the profile engine (below), and its section in each app.
- An engine builds and runs outside the core.
- CI checks each crate's dependencies against the ones this map allows.

So far the map allows these: an engine depends on no host or feature crate; no feature depends on another feature's crate ([what a handler sees and does](#what-a-handler-sees-and-does)); the loop's crates depend on neither tokio nor any crate that does I/O ([one loop](#one-loop)); and only the sim's edge calls `SimConnect.dll` ([the sim seam](#the-sim-seam)).

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

How a feature reaches the sim is in [the sim seam](#the-sim-seam), how it adds work to our WASM module and the panel bridge is [5.3](plan.md#53-work-in-the-sim)'s, and which crates hold the registry and the moments is [5.4](plan.md#54-the-workspace)'s.

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
- **The module's slots:** our WASM module is the host's, and [5.3](plan.md#53-work-in-the-sim) decides how a feature adds work to it.
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

## Left open

- Whether a recording replays on a PC with a different CPU: Windows' C runtime picks its FMA3 math by CPU, and "Differences may also be observable between computers" ([5.1.1]), while whether Rust's `f64` functions reach that math on our target is unverified; replaying a recording made on one PC on a PC with another CPU settles it.
- What [a connection for each feature](#a-connection-for-each-feature-for-each-load) leaves unmeasured, and whether the edge's exception tags hold among writes each frame: [node 7](plan.md#7-testing)'s tests in the sim.
- If traffic's copies, written each frame through the loop, move less smoothly than FS Copilot's ([cases for the bench](#cases-for-the-bench)), writes each frame move into the edge, which changes the seam: [node 7](plan.md#7-testing).
- Which client writes the module's slots when another connects to the same sim, a development core beside the pilot's or the IDE, since by default any client can write a client data area ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits)): [5.3](plan.md#53-work-in-the-sim).
- The stand-in sim's model, how it paces frames, how it plays our WASM module, and how a core on a stand-in reaches the sim's pages, which connect to the core beside this seam, so its pilot can reach Ready to fly and use Go to: [node 7](plan.md#7-testing).
- Which crates hold the bindings, the sim client, and the edge, so that only the edge calls `SimConnect.dll`: [5.4](plan.md#54-the-workspace).
- How features add work to our WASM module and the panel bridge, and how each piece tears itself down: [5.3](plan.md#53-work-in-the-sim).
- Which crates hold the registry and the moments: [5.4](plan.md#54-the-workspace).
- Which crate each unit is, and what each may depend on: node 5, once 5.2 to 5.4 answer.
- Whether QuickJS-ng's hash seed, which it takes from the wall clock when it makes a context ([5.1.1]), changes anything a script sees: a replay run twice settles it.
- Which of the host's hooks and moments plugins reach through QuickJS-ng, and whether a plugin needs a moment only a feature could raise, which this design gives no feature: [node 6](plan.md#6-systems).
- How much of the queue a recording keeps, which the parked probe [p10](../../../experiments/areas/architecture/p10-recording.mjs) sizes, and the self-describing record a later version reads: [node 6](plan.md#6-systems).
- Whether one loop meets its budgets, which p10's loop measures offline: [node 7](plan.md#7-testing).

[flight]: log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start
[5.1.1]: log.md#2026-10-14-a-core-replays-a-whole-run-when-one-ordered-loop-owns-its-state-and-takes-every-input-stamped-through-one-queue-as-sans-io-cores-lmax-and-tigerbeetle-run-and-neither-actors-nor-simulation-runtimes-can-replay-a-run-from-a-pilots-pc
