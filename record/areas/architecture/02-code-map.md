# Architecture: the code map

```text
Purpose:     The units of Crosscheck's code, which tier each is in, what each owns, its interface, and what it may depend on.
Depends on:  01-spine.md, decisions.md, log.md, ../network/01-between-machines.md, ../sync/04-order-and-recovery.md, ../session/01-roles-and-members.md, ../profiles/01-format-and-delivery.md, ../product/04-room-for-later.md
Decides:     The tiers and the tests that keep each unit apart (node 5); how the host runs its features, and what a feature registers with it, calls, and guards (node 5.1).
```

Crosscheck's code is a host, engines, and features.
The core runs as one loop that owns all its state and takes every input, stamped, from one queue, and each feature plugs into that loop through one registration, so deleting a feature's crate and its registration leaves everything else building and passing its tests (user, 2026-10-14).
A feature reads the host's state, reaches other features only through moments the host raises, and reaches the world only through outputs, and a feature that can block a request registers a guard rather than having the host check on it.

This answers node 5 of the [architecture plan](plan.md#5-the-code-map), whose children settle its parts; the plan says which are settled.
The tentative decisions behind it start at [decisions.md](decisions.md#crosschecks-code-is-a-host-engines-and-features-and-deleting-a-features-crate-leaves-the-rest-whole).

## Tiers

| Tier | What it is | Examples |
| --- | --- | --- |
| Host | The services every feature uses: in the core, and in the sim through the panel bridge and our WASM module, which load what features and plugins run there by name ([04-room-for-later](../product/04-room-for-later.md#code-inside-the-sim)) | The session and its keys, control, channels, the cockpit stream, catch-up, the client protocol, settings, notices, recording |
| Engines | Libraries that know nothing of the app, so another program can link them, such as the [Crosscheck IDE](../product/ideas.md#crosscheck-ide) | The message crate, the profile format, the sync engine, the transport, the recording format |
| Features | Each one thing a pilot gets | Pointer sync, avatars, traffic, ATC audio, the take-control key, rate and pause, the PF's spot on the world map |

Three tests stand in for a definition of clean, because a definition in prose invites an agent to enforce it where it doesn't fit (user, 2026-10-14):

- Deleting a feature's crate and its one registration leaves everything else building and passing its tests.
- An engine builds and runs outside the core.
- CI checks each crate's dependencies against the ones this map allows.

A system is the units one design doc designs, in one area, and [node 6](plan.md#6-systems) of the plan designs each.
Each contract is defined once and linked or generated wherever it's used: a feature's messages stay in the message crate of [decision 025](../../decisions/025-messages-in-one-rust-crate.md), and its profile block, such as pointer sync's `displays`, stays in the profile engine, which the core, CI, and the IDE share ([01-format-and-delivery](../profiles/01-format-and-delivery.md#what-fails-a-load)), so deleting a feature also deletes its module in each (user, 2026-10-14).

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

The host records its queue, every input with its kind and stamp, under a header that names the build and a seed, so the same build replays a whole run from it, and a bug report names the build to check out.
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
| Session keys | Each key; whether one member or the whole session writes it; and whether its value names a member, whom the host clears it of when that member leaves the session | Rate and pause owns the pause and the simulation rate ([01-between-machines](../network/01-between-machines.md#channels)) |
| Channels | Who sends and receives it, its delivery, and its priority | The flight model, as one-off packets ahead of every stream |
| Cockpit stream kinds | A kind, and the handler that applies it and says when it counts as applied ([04-order-and-recovery](../sync/04-order-and-recovery.md#the-cockpit-stream)) | Pointer sync's press counts as applied once its panel has played it through to the release |
| Catch-up steps | A step, and the steps it runs after ([04-room-for-later](../product/04-room-for-later.md#a-catch-up-pipeline)) | State sync's catching up state |
| Guards | A check on a request the host decides, [below](#guards) | None in v1 beyond the host's own |
| Client state and commands | A slice of state the apps show, and the commands they send | The take-control key's command to take control |
| Settings, notices, and items for the match check | Each one | The take-control binding; "Couldn't sync the beacon" |
| The helper's input and audio | The bindings, captures, and sounds it needs | The take-control key; capturing the ATC app |

A role a feature holds is one of its session keys, naming the member who holds it, as traffic's names the traffic host and ATC audio's the ATC host; who may hold a role, where a later role limits it, is a guard on writing its key.
[Roles and members](../session/01-roles-and-members.md#the-table-of-roles) keeps the table of roles as the session's documentation, and the code holds no registry of them.
A feature whose messages must apply in order with the cockpit's, such as a later bus bridge carrying a message that opens a page ([04-room-for-later](../product/04-room-for-later.md#channels)), registers cockpit stream kinds rather than a channel, so no channel declares a place in the cockpit's order.

How a feature reaches the sim is [node 5.2](plan.md#52-the-sim-seam)'s, how it adds work to our WASM module and the panel bridge is [5.3](plan.md#53-work-in-the-sim)'s, and which crates hold the registry and the moments is [5.4](plan.md#54-the-workspace)'s.

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
Both keys go out in one message on the session channel, and each key's stamp counts that key's own changes ([01-between-machines](../network/01-between-machines.md#channels)), so two keys always written together settle two pilots' claims made at once on the same pilot (inference).
This changes [roles and members](../session/01-roles-and-members.md#the-traffic-and-atc-host), which gives the two one role that can split, and [decision 044](../../decisions/044-table-of-roles.md) once step 8's decisions are numbered.

### Budgets

Each is a starting value, which [node 7](plan.md#7-testing)'s bench measures:

- The queue stays under one sim frame at p99: 11.2ms at the 89 sim updates a second our module saw in a flight ([architecture log](log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)).
- A handler takes at most 1ms, apart from calls into QuickJS-ng, which keep their 100ms limit ([decision 046](../../decisions/046-sandbox-runtimes-and-limits.md)).
  One call at that limit holds back about 9 sim updates, in order, and about 5 frames of ATC audio, which reach the playback buffer after their turn and are dropped (arithmetic; inference).
- A write function that hits its limit fails that write, and its entry stops syncing on every machine for the rest of the load, as a plugin at its limit is turned off, because on one loop a stuck call holds up every input behind it, where [01-format-and-delivery](../profiles/01-format-and-delivery.md#the-sandbox) counted only the writes behind it.
  This changes decision 046 for write functions once step 8's decisions are numbered.
- The loop is busy less than 20% of one CPU core through a busy flight.

### Left open

- Whether a recording replays on a PC with a different CPU: Windows' C runtime picks its FMA3 math by CPU, and "Differences may also be observable between computers" ([5.1.1]), while whether Rust's `f64` functions reach that math on our target is unverified; replaying a recording made on one PC on a PC with another CPU settles it.
- How features reach the sim, and the seam a stand-in sim fills: [5.2](plan.md#52-the-sim-seam).
- How features add work to our WASM module and the panel bridge, and how each piece tears itself down: [5.3](plan.md#53-work-in-the-sim).
- Which crates hold the registry and the moments: [5.4](plan.md#54-the-workspace).
- Which hooks, and which features' own moments, plugins reach through QuickJS-ng: [node 6](plan.md#6-systems).
- How much of the queue a recording keeps, which the parked probe [p10](../../../experiments/areas/architecture/p10-recording.mjs) sizes, and the self-describing record a later version reads: [node 6](plan.md#6-systems).
- Whether one loop meets its budgets, which p10's loop measures offline: [node 7](plan.md#7-testing).

[5.1.1]: log.md#2026-10-14-a-core-replays-a-whole-run-when-one-ordered-loop-owns-its-state-and-takes-every-input-stamped-through-one-queue-as-sans-io-cores-lmax-and-tigerbeetle-run-and-neither-actors-nor-simulation-runtimes-can-replay-a-run-from-a-pilots-pc
