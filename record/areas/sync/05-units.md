# Sync: its units

```text
Purpose:     The sync engine's, the cockpit stream's, and state sync's interfaces, and the rules the sync engine starts the bench from.
Depends on:  01-profile-entries.md, 02-live-sync.md, 03-catch-up.md, 04-order-and-recovery.md, ../architecture/02-code-map.md, ../core/01-loop-and-edge.md, ../core/02-clients-and-panel-bridge.md, ../core/03-sim-seam-and-wasm-module.md, ../network/02-units.md, ../recording/01-recording-and-bug-reports.md, ../session/02-units.md, ../profiles/01-format-and-delivery.md, ../profiles/02-units.md
Decides:     What each of sync's three units holds and offers; a cockpit message's fields; how the cockpit stream holds, paces, keeps, replays, and drops messages; who asks for a catch-up, when, and where its order comes from; how the sync engine tells its own echo, checks a write, steps a knob that's still moving, and runs write functions; how state sync fires and hears `H:` events and hears `K:` events; which call sends an event; what 02-live-sync's and 03-catch-up's open questions still hold; the budgets; and the cases for the bench (node 6.9).
```

> **Note**
> In [`H:` events](#h-events), `fsEventsHEventCall` returned `FS_EVENTS_ERROR_FAIL` and reached no panel, so the routine host fires each `H:` event as calculator code, `(>H:<name>)`, as that section's fallback has it ([sync log](log.md#2026-11-10-the-sdks-h-event-call-fails-on-msfs-2024-so-our-module-fires-h-events-as-calculator-code-which-reached-every-panel); user, 2026-11-10).

> **Note**
> The 1.5s check in [checking a write](#checking-a-write) rests on an `instrument()` entry's reads every 250ms with a wide margin, not on the Fenix's battery lamp, since a profile watches the switch it writes, which landed in about 130ms on the Fenix, whose lamps are annunciators that hang on other switches too; and in the sim, the Fenix lights its APU master's ON light whatever order catch-up writes its switches in, so the battery-before-APU order is the bench's case alone ([sync log](log.md#2026-11-09-stage-14s-session-in-the-sim-passed-in-four-aircraft-and-no-aircraft-took-an-h-event-our-module-fired); user, 2026-11-10).

> **Note**
> State sync calls `step_ready` 1.5s after its profile loads, not at the load, since `give` leaves out an entry with no reading, and a catch-up asked before the load would be answered before any watch had read; `h-events` says yes for a counting entry's `H:` events too ([sync log](log.md#2026-11-10-stage-14s-code-review-found-a-catch-up-answered-with-no-values-a-preset-fired-again-after-a-gap-and-a-stream-stalled-by-an-unload)).

> **Note**
> A catch-up write still held for its entry's first reading 1.5s after the catch-up starts counts as made, and the engine flags it as never landed, so an entry that never reads can't hold a catch-up open ([sync log](log.md#2026-11-09-the-first-session-in-the-sim-stopped-on-a-catch-up-that-six-unread-instrument-entries-held-open); user, 2026-11-09).

> **Note**
> Every write to an input event goes through our WASM module, not `set_input`, and the routine `HEvents` below also calls input event presets, under the name `NamedEvents` and the slot `DUALINPUT_ROUTINE_NAMED_EVENTS` ([sync log](log.md#2026-11-09-writes-to-input-events-go-through-our-wasm-module-since-simconnects-list-has-none-of-their-presets); user, 2026-11-09).

> **Note**
> From the first flight with friends ([sync log](log.md#2026-11-17-fsvarsbvarcall-with-a-value-jams-the-input-event-for-the-rest-of-the-flight-and-calculator-code-from-our-module-doesnt); user, 2026-11-17):
>
> - In [reaching the sim](#reaching-the-sim), `HEvents` calls each input event's preset as calculator code, as it fires `H:` events, since `fsVarsBVarCall` with a value jammed the input event for the rest of the flight.
> - In [checking a write](#checking-a-write), the engine flags every write that never lands, where it flagged only an entry's first in each load, so the run's log has a line for each, and state sync's notification still shows once for each entry and load.
> - A write function that returns a value puts that value pending in place of the one it was given, so a reading the aircraft rounded is still the write's echo ([profiles' format note](../profiles/01-format-and-delivery.md)).
> - A PF-owned entry's write on a following machine, live or in catch-up, goes unchecked, since that machine's own systems move it, as its autopilot trims the aircraft `Follow` freezes.
> - As control passes to a machine, the engine writes each PF-owned entry whose reading differs from the old PF's last value, once, at that value, through `control_passed`, which state sync calls on `ControlPassed`.
> - Two known limits: a following machine's autopilot can send its own target as the PF's vertical speed mode reaches it, which goes out as its pilot's change; and two toggles of coupled controls that arrive together can undo each other, since a toggle decides from the last reading, which [stage 14c](../build/plan.md#14c-two-coupled-writes-in-one-input) takes up.

> **Note**
> From stage 14c, because no route showed the 58P's autopilot taking an event in the frame it was sent, and a toggle guarded in the sim read the old mode too ([sync log](log.md#2026-11-19-no-route-showed-an-autopilot-events-effect-in-the-frame-it-was-sent-so-a-guard-in-the-sim-reads-the-old-mode-and-the-events-of-one-frame-apply-in-the-order-sent); user, 2026-11-19):
>
> - In [writing](#writing), an arrival's or a catch-up's `toggle`, stepping write, or write function, the three forms that decide from the cockpit's readings, waits while another entry has a value pending.
>   Each later write of an arrival or a catch-up waits behind it, in order.
>   It goes at the second `frame` call after the pending value reads back or its check drops it, and decides from the readings then, since state sync watches each variable on a request of its own, and where the sim's `Frame` event falls among one frame's requests is unmeasured.
>   It writes the value its entry holds as it goes, so a newer arrival, a catch-up taken again, or this pilot's own change in the meantime is what it writes.
>   A following machine's pending write of what the PF owns makes no other write wait, since that machine's own autopilot can move the value before it reads back, as it moves the trim.
>   A put-back goes at once, and an event entry's write isn't held, though the stream applies none behind a held arrival.
> - The stream applies nothing after a held arrival until the engine's `Stepped` says it went, as it waits on a stepping write's last step.
> - In [its own echo](#its-own-echo), a reading that brings the value a held write wants is no change of this machine's, as vertical speed mode turned off by altitude hold's event.
> - So the two-toggle known limit above no longer holds, and in [the cases for the bench](#cases-for-the-bench), a write function that checks for power in catch-up's burst behind the battery waits for the battery's write to read back and then writes, where it wrote nothing and was flagged.

> **Note**
> Each `panel_module` call below takes a third argument, a function that says whether the loaded profile names anything the module serves, and `clients` raises its trouble over a panel that never connects only when one says yes ([the apps' note](../interface/01-apps.md); user, 2026-11-01).
> `h-events` says yes when the loaded variant's `watches` holds an `H:` event, and `instrument-reads` when they hold an `instrument()`.

> **Note**
> In [`H:` events](#h-events), the clients crate, not state sync's rule, keeps `h-events` in one panel, since two panels can hold instruments of one key, and a rule that knew its panel by its keys gave the module to both ([sync log](log.md#2026-11-21-h-events-went-to-two-panels-whose-instruments-share-a-key-since-state-sync-knew-its-panel-only-by-its-keys); user, 2026-11-21).
> State sync registers it with `one_panel_module`, and its rule takes every instrument of a panel, so the first panel answered that holds an instrument gets it, and keeps it through a reload by its name, as [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md)'s note of 2026-11-21 has it.

The sync engine is one state machine for each loaded profile, with no I/O, so the IDE and the bench link it on their own.
The cockpit stream, in the platform, carries every cockpit message in causal order, holds each state entry's newest value, paces what it applies, keeps what it sent for a replay, and runs catch-up, which the catching-up machine asks for.
State sync is the feature that joins the engine to the sim, the stream, and the session.

The engine starts the bench from simple rules: a write stays pending until a reading equals it, a write no reading matches within 1.5s is flagged and never retried, a stepping write counts its own steps, and a write function runs once for each value.
State sync fires `H:` events from a routine of its own in our WASM module and hears them in one cockpit panel, and sends an event with one value or none by SimConnect's legacy call.
Catch-up writes in an order each machine keeps in memory, and starts whenever a following machine's profile loads after preflight has ended.

This answers node 6.9 of the [architecture plan](../architecture/plan.md#69-sync).
The sync docs [01-profile-entries](01-profile-entries.md) to [04-order-and-recovery](04-order-and-recovery.md), [01-format-and-delivery](../profiles/01-format-and-delivery.md), and decisions [039](../../decisions/039-cut-link-replays-others-late-join.md) to [043](../../decisions/043-driven-entries-and-putting-back.md) give the rules this design carries, and this document holds only what they leave out.
The flying machine is the PF's, and a following machine is any other pilot's.

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `sync-engine` | Engine | For one loaded profile: the state object, each entry's stamp, the write functions in the profile's QuickJS-ng runtime, shadow values, pending writes and echo tokens, the check, the settle rule, the driven-entry test, putting back, the conflict rule, and catch-up's order | On the loop, in the IDE, and on the bench |
| `cockpit-stream` | Platform | The vector clock, holding a message until what it depends on has applied, copies, kinds, held values, pacing, kept messages and replays, changes of control, catch-up's pipeline and its exchange, and the guard on control | On the loop |
| `state-sync` | Feature | One sync engine for the loaded profile, its watches and writes through the sim service, its cockpit kinds and catch-up step, the guard on Ready, notifications, log lines, and the PF's checklist | Its crate in the core, the routine `HEvents` in our WASM module, and the panel modules `h-events` and `instrument-reads` |

Each depends on what the code map's [units](../architecture/02-code-map.md#the-units) give it: the sync engine on the profile engine, the sandbox, and the message crate; the cockpit stream on the kernel, the network, and the session; and state sync on the cockpit stream, the session, the sim service, the profile loader, `clients`, and the sync engine.

## The sync engine

```rust
// a sketch: one engine for each loaded profile, on each machine
pub struct Engine { /* the state object, stamps, pending writes, tokens, shadows, the runtime */ }

pub struct Ctx { pub at: Micros, pub flying: bool, pub catching_up: bool, pub preflight_ended: bool }

impl Engine {
    pub fn load(profile: &Profile, variant: &str, runtime: Runtime, times: Load) -> Engine;  // compiles the write functions
    pub fn ready_to_fly(&mut self, at: Micros);                     // RTC_END, when it comes after the load
    pub fn watches(&self) -> &[Watch];                              // variables, input events, K: and H: events, instrument() values
    pub fn seen(&mut self, what: Seen, cx: Ctx) -> Vec<Out>;        // a reading or an occurrence on this machine
    pub fn arrived(&mut self, entry: &str, change: Arrived, cx: Ctx) -> (Applied, Vec<Out>);   // another machine's change or event
    pub fn frame(&mut self, cx: Ctx) -> Vec<Out>;                   // steps due, checks closing, the settle rule
    pub fn sent(&mut self, entry: &str, stamp: Stamp);              // the stream sent this machine's change
    pub fn give(&self) -> CatchUpState;                             // on the flying machine: each entry, its value and stamp, in order
    pub fn take(&mut self, state: &CatchUpState, cx: Ctx) -> Vec<Out>;   // on the catching-up machine
    pub fn settled(&self) -> bool;
}

pub enum Out { Act(Action), Send(Change), Withdraw(String), Flag(Flag), Stop(String) }
pub enum Action { Set(Name, Value), Key(Name, Vec<f64>), Fire(Name) }
```

- The engine takes the time and the roles in `Ctx` with each call, reads no clock, and makes no call itself: state sync carries out each `Out`.
- It compiles the profile's write functions, which the bundle holds as JavaScript compiled at ES2020 ([the profiles' units](../profiles/02-units.md#the-builder)), when it loads, in the profile's own runtime from the sandbox ([the sandbox](../profiles/01-format-and-delivery.md#the-sandbox)).
- `Load` carries the stamp of the profile's load, and either the stamp of this aircraft's Ready to fly, when that came first, or a mark that this core missed it, having found the sim already flying, as after a core restart.
  A member is in the flight from the Ready-to-fly screen ([in the flight](../session/02-units.md#in-the-flight)), so its profile usually loads before `RTC_END`, and state sync calls `ready_to_fly` when it comes.

### Watching and the state object

- `watches` lists what each entry of the loaded variant reads or hears: an `L:` or `A:` variable, an input event, a `K:` event, an `H:` event, an `L:` variable watched as a pulse, or an `instrument()`, a value in a gauge's JavaScript, which state sync reads through its panel module `instrument-reads` ([reading it in the panel](../plugins/01-plugins.md#reading-it-in-the-panel)).
- The state object holds each state entry's value as this machine reads it, and the engine keeps it in the runtime as the global `state`, setting an entry's property as its reading changes, so a write function sees this cockpit as it stands.
- A reading equal to the entry's value in the state object changes nothing.
- A counting entry's value is its shadow, which the occurrences it counts move, starting from `default` at the profile's load ([counting into a shadow value](../profiles/01-format-and-delivery.md#counting-into-a-shadow-value)).

### Writing

The engine turns an entry's `write` into actions, as [writing](../profiles/01-format-and-delivery.md#writing) has each form:

| Form | Actions |
| --- | --- |
| A name | One action with the value: a variable or input event set, or an event sent or fired |
| `toggle` | One action of its name when the reading differs from the value wanted, and none when it matches |
| `inc` and `dec` | A step at each pace from the count below, the shorter way round when `wrap` is true |
| A function | The `write()` calls of one run, in call order, and each chain's steps at its pace |

- The engine holds every write to an entry, an `instrument()` entry included, live and in catch-up, until the entry's first reading arrives, and catch-up's `step_made` waits for held writes (user, 2026-10-18).
  A counting entry or an event entry, which gets no reading, is exempt, and a read the sim refuses drops the held writes.
- A stepping write counts from its own steps: it starts from the reading when it starts and adds each step it sends, and never reads the entry again until its last step, so a reading that lags a step behind never makes it step again.
  A new value for the entry while it steps aims again from that count, the shorter way round.
- A pace in frames counts the sim's `Frame` events, which state sync hands the engine as `frame` calls, and a pace in ms counts their stamps ([pace](../profiles/01-format-and-delivery.md#pace)).

### Its own echo

- A value the engine writes to a state entry is pending from the moment it hands the actions over until a reading of the entry equals it.
- That reading clears it, and every value pending before it on that entry, and is no change of this machine's.
- A reading that equals no pending value is this machine's own change.
- A stepping write adds each step's value to the pending ones, and a `toggle` that flips adds the value wanted.
- Values compare as `f32`, since a value written as 165 read back as 165.000002, on an AI object's `A:` variable (measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-writing-a-gsx-persons-animation-frame-makes-it-walk-and-a-seated-one-moves-on-its-own)); why, and whether the pilot's own aircraft does the same, is unverified.

So a knob the other pilot turns a detent a frame arrives as 100, 101, and 102, and a reading of 100 that lags behind the write of 102 clears 100 and sends nothing.
A pilot who turns the knob back through 101 a second later is heard, because the single writes we timed on six aircraft showed in their readings within 2 frames ([sync log](log.md#2026-10-05-two-writes-in-one-frame-land-in-the-order-sent-and-a-write-shows-within-2-frames)), so each pending value had cleared long before.
A rule that remembered written values for a time would have swallowed that turn ([checking a write](../profiles/01-format-and-delivery.md#checking-a-write)).

### Checking a write

- A write gets one attempt, as the bench starts ([checking a write](../profiles/01-format-and-delivery.md#checking-a-write)).
- A value still pending 1.5s after its write, or after a stepping write's last step, is flagged: the engine drops it and hands state sync a `Flag` with the entry, the value wanted, and the reading ([notifications and log lines](#ready-notifications-log-lines-and-the-checklist)).
  The 1.5s covers the slowest readout we've timed, the Fenix's battery lamp at 1.2s in one run ([sync log](log.md#2026-10-05-the-a220s-fcp-ignores-stock-autopilot-events-the-a350-takes-a-command-at-most-every-2-frames-and-the-fenix-reads-a-counters-jump-as-that-many-detents)), since the engine can't tell which entries read a computed readout.
- A `toggle` whose lamp lights after the check flips once and is flagged, and nothing flips it a second time.
- A shadow value has nothing to read, so its writes go unchecked ([counting into a shadow value](../profiles/01-format-and-delivery.md#counting-into-a-shadow-value)).
- A watch-only entry's value from another machine is compared with this machine's reading 1.5s after it arrives, and state sync logs a difference at info ([notifications and log lines](#ready-notifications-log-lines-and-the-checklist)).

### Write functions

- A function runs only on a receiving machine, once for each value it's given, live or in catch-up, and never again when an entry it read changes.
- Its value is pending whatever the run wrote, so a run that writes nothing, such as a transponder function that skips while the battery is off, is flagged when the reading never comes to match.
  The engine can't tell a deliberate skip from a function that's wrong, so it judges by the cockpit.
- A run that hits the sandbox's 100ms limit fails that write, and the engine stops the entry on its own machine for the rest of the load, as the code map's [budgets](../architecture/02-code-map.md#budgets) require (user, 2026-10-18).
  That machine skips arriving changes to the entry, sends none, and shows its pilot state sync's notification, while state sync goes on reading the entry from the sim.

### Events

- An event entry's firing on this machine sends its occurrence, with the event's value if it carried one, and another machine's arrives as `Arrived::Fired`, which the engine fires through the entry's `write`.
- A pulse's firing carries the value the pulse rose to, so an event entry that writes its own pulse variable replays it.
- Firing an event entry, by whatever its `write` does, leaves a token for the name the entry watches, and a counting entry's step leaves one for the step's name; the next occurrence of that name on this machine uses the token up and isn't sent, and a token no occurrence uses within 1s expires.
  So an entry that watches an `H:` event and writes an input event, as [event entries](01-profile-entries.md#event-entries)' example does, doesn't send back the `H:` event its write makes the aircraft fire.
  A counting entry's shadow moves on an occurrence that uses a token.
- The engine drops an `ignore`'s consequence and the input event double-fire as [ignoring a consequence](01-profile-entries.md#ignoring-a-consequence) and [keeping a change from applying twice](02-live-sync.md#keeping-a-change-from-applying-twice) have them.

### Who sends, and putting back

- Before preflight ends, the engine reads and keeps its order, and sends nothing and puts nothing back, since the rest of sync starts at its end ([preflight](../product/03-v1-scope.md#preflight)).
- After it, a change to an entry that has stopped syncing goes nowhere, and any other change goes out as `Send`, unless [putting back](04-order-and-recovery.md#putting-back) says this machine may not send it, in which case the engine puts back the value it holds at once.
- A put-back leaves nothing pending, since what it brings back is a reading this machine may not send anyway, so a hand that keeps moving a PF-owned lever flags nothing.

### The conflict rule

- Each state entry keeps the stamp [when two pilots change one entry](02-live-sync.md#when-two-pilots-change-one-entry) describes, with its sender's restart count, and the control value it was made under, which names the PF of the moment.
- An arriving change to a shared entry applies when its stamp wins, by that section's rule and 04's tie-break for two restart counts ([the cockpit stream](04-order-and-recovery.md#the-cockpit-stream)); a change that loses counts as applied with nothing written.
- A change the stream still holds has no clock yet, so the engine judges it as made without seeing any change that arrives meanwhile.
  If the arrival wins, the engine writes it and withdraws the held change.
  If the held change wins, it goes out with a clock that includes the arrival, and every machine keeps it.

### Settling and the driven-entry test

- The settle rule calls an aircraft settled 30s after `RTC_END`, as [settling after a load](03-catch-up.md#settling-after-a-load) has it, with no quiet window, cap, or rule for an entry that changes more than 5 times ([decision 048](../../decisions/048-settled-30s-after-ready-to-fly.md)).
  The same holds for a profile that loaded after `RTC_END` ([an aircraft that loaded before its session](04-order-and-recovery.md#an-aircraft-that-loaded-before-its-session)), and until `RTC_END` comes, the aircraft hasn't settled.
- An aircraft whose Ready to fly this core missed counts as settled at once, and its shadows take the flying machine's values in catch-up rather than stepping to them ([a core that restarts](04-order-and-recovery.md#a-core-that-restarts)).
- The driven-entry test runs as [entries the aircraft drives itself](04-order-and-recovery.md#entries-the-aircraft-drives-itself) has it.

### Catch-up's order

- For each entry, the engine keeps when this cockpit first took each of its last 16 distinct values, from the reading's stamp, with the reading at the profile's load counting as taken at the load.
- `give` lists every entry in the order it first took the value it holds, which puts first the entries that hold their value from the load, as [catch-up](04-order-and-recovery.md#catch-up) asks.
- A switch has a handful of values, so its order is exact, and the battery cycled off and on after the APU master still goes before it.
  A lever that came back to a value older than its last 16 counts from that return, its last change; no interlock turns on a lever's exact position (inference).
- Every machine keeps its own, so a following machine that becomes the PF already has one.

This replaces reading the order from the flying machine's recording, which [decision 040](../../decisions/040-catch-up-first-final-value-order.md) has: the recording holds the inputs, not when the cockpit took each value, so reading it would mean running the sync engine over the run at each catch-up.

## The cockpit stream

### A cockpit message

```rust
// a sketch: the cockpit stream's module of the message crate
pub struct CockpitMessage {
    pub clock: VectorClock,   // counters by pilot ID and restart count; the sender's own is this message's number
    pub control: Control,     // the control value it was made under
    pub gap: u32,             // µs since the sender's last cockpit message
    pub kind: u16,
    pub key: String,          // the kind's key, such as an entry's name
    pub body: Vec<u8>,        // the kind's own message, in postcard
}

pub enum Cockpit {                                    // the stream's one channel, Stream delivery
    Message(CockpitMessage),
    Replay { clock: VectorClock },                    // opens a replay of what that clock covers
    CatchUpAsk,
    CatchUp { clock: VectorClock, control: Control, steps: Vec<(u16, Vec<u8>)> },
}

// state sync's module: CHANGE and PF_CHANGE carry a Value, and FIRED an Option<Value>
pub enum Value { Number(f64), Text(String) }
```

- The body is the kind's own type in its feature's module of the message crate, so the stream names no feature's types.

### Kinds

```rust
// a sketch: state sync's kinds
me.cockpit_kind(state_sync::CHANGE, StateSync::apply).hold_newest();
me.cockpit_kind(state_sync::PF_CHANGE, StateSync::apply).hold_newest().collapse_in_replay();
me.cockpit_kind(state_sync::FIRED, StateSync::fire);
```

- A kind's handler answers each message `Done`, `Skipped`, or `Unfinished(handle)`; after `Unfinished`, no later message applies until its unit calls `cx.cockpit().applied(handle)`.
  State sync calls it at a stepping write's last step, and pointer sync calls it for a gesture's up, the one gesture message that answers `Unfinished`, once its panels are done with it ([pointer sync](../pointer-sync/01-pointer-sync.md#playing-a-gesture)).
  The next message of the same kind and key goes to the handler at once, as a new value cuts a stepping write short ([one stream, in causal order](02-live-sync.md#one-stream-in-causal-order)), and the unfinished one counts as applied.
- `hold_newest` makes the stream hold each key's newest message and send it at most 20 times a second, and send every held message before a message of any kind that doesn't hold, so a lever's value goes out before the starter press after it ([the cockpit stream](04-order-and-recovery.md#the-cockpit-stream)).
  Holding lives in the stream, not in state sync, because the press a held value goes out before is pointer sync's.
- `collapse_in_replay` marks the PF-owned changes a replay collapses ([the replay](04-order-and-recovery.md#the-replay)).
- A kind whose key names a profile entry declares so at registration, with how to read the entry's number from its body.
  State sync's `CHANGE`, `PF_CHANGE`, and `FIRED` declare theirs, so avatars reaches for a located entry without naming state sync's types ([avatars](../avatars/01-avatars.md#a-change-made-without-a-click)).
- The stream's own kind, `CONTROL`, carries a change of control ([a change of control](#a-change-of-control)).

### Sending

- `cx.cockpit().send(kind, key, body)` sends, or holds when the kind holds, and `cx.cockpit().withdraw(kind, key)` drops what's held for that key.
- A held message carries the control value it was made under, not the one in force when it goes, as [a change of control](04-order-and-recovery.md#a-change-of-control) needs.
- When a message goes, the stream adds 1 to its own counter, fills in the clock and the gap, keeps the message, sends it `To::Crew`, and raises `CockpitSent`, the code map's ["cockpit sent"](../architecture/02-code-map.md#what-a-handler-sees-and-does), which also hands state sync the stamp of its change.
  `CockpitSent` carries the kind, the key, the clock, and, for a kind that declares an entry, the entry and its number.
- It sends no message of a feature's kind before preflight ends or while this member is out of the flight ([in the flight](../session/02-units.md#in-the-flight)); its own `CONTROL`, `Replay`, and catch-up's messages go whatever the member's flight.

### Applying

1. A message waits until the receiver's clock covers every message it depends on, and a message the clock already covers is a copy, which drops.
2. The stream skips it if a change of control drops it, or if a replay collapses it, and a skipped message waits for nothing.
3. It waits what's left of its gap, capped at 2s, counted from when the message before it applied, through a timer ([the replay](04-order-and-recovery.md#the-replay)).
4. Its kind's handler applies it, and once it's done or skipped, the receiver's clock takes its number.

- The stream applies at most 50 messages in one input, and the rest in the inputs of a timer, since applying one queues two calls, the kernel panics past 1,000 queued in one input, and one 64 KiB read of a replay can hold about 540 messages.
- Messages queue, applying nothing, while this member is out of the flight and while its catch-up waits for its answer ([catch-up](#catch-up)).
  A member in the flight with no profile loaded applies them, and state sync skips its own kinds then, so a `CONTROL` still applies and a replay still ends; a profile that loads later catches up.
- A message of a kind no unit here registered is skipped, which a crew on one release never sends.

### Kept messages and a replay

- The stream keeps every message it sent or applied until every member's clock covers it, and each member sends its clock once a second on a `Newest` channel of the stream's own ([02-units](../network/02-units.md#the-heartbeat-and-clock-offsets)).
  So a message normally goes within a second, and during a cut, kept messages grow until the link returns or the member is counted out at 30 minutes.
- On `LinkUp { again }`, the stream sends the member `Replay` with its own clock, then every kept message that member's last clock doesn't cover, in causal order, on the stream's one channel ([links](../network/02-units.md#links)).
- The receiving machine's replay runs until its clock covers the clock `Replay` carried.
  Within it, a message of a kind that collapses is skipped when a later message of the same kind and key follows it in the replay with only collapsing messages between them.
- A link that comes up without `again`, for a new member or a restarted core, brings no replay, and that machine's catch-up covers what it lacks.

### A change of control

- On `ControlPassed` with `made_here`, the core that made the change sends a `CONTROL` message whose body is the new control value, so its clock is the maker's ([the session's units](../session/02-units.md#control)).
- Once the session's control has changed, a message the superseded PF made under the value it lost waits until that change's `CONTROL` message arrives, then applies if the `CONTROL` message's clock includes it and is skipped if not, live or in a replay ([a change of control](04-order-and-recovery.md#a-change-of-control)).
  The stream judges a message against the newest control value it or the session crate knows, since the change's `CONTROL` message can come before the session's key.
- If a machine other than the new PF counts more of the superseded PF's messages than the `CONTROL` message's clock does, it applied a message the change drops, and it asks the new PF for a catch-up once any replay it's receiving ends.

### Catch-up

The catching-up machine asks for its catch-up, since after a pass only it knows that one was running:

- It asks the flying machine with `CatchUpAsk`:
  - when its profile loads after preflight has ended, which covers a late joiner, a pilot back from a sim, core, or PC that went down, and a session whose pin went from none to a bundle after preflight ([the pin](../profiles/02-units.md#the-pin));
  - when preflight ends with its profile loaded;
  - when control passes to another pilot while its catch-up runs;
  - after a change of control drops a message it applied;
  - and again when its link to the flying machine comes up while it waits for an answer, as [while a link is lost](../network/01-between-machines.md#while-a-link-is-lost) starts a cut catch-up again.
- The PF never asks, and a pilot whose catch-up runs when control reaches them stops it, since they're the source ([catch-up](04-order-and-recovery.md#catch-up)).
- The flying machine answers once its own profile has loaded, with each catch-up step's payload, its clock, and its control value, on the stream's channel to that member alone.
  An answer made under a control value other than the session's current one is dropped, and the catching-up machine asks the new PF.

```rust
// a sketch: state sync's step, the one step in v1's pipeline
me.catch_up_step(state_sync::STATE, StateSync::give, StateSync::take);   // give on the flying machine, take on the catching-up one
cx.cockpit().step_ready(state_sync::STATE, true);   // while its profile is loaded
cx.cockpit().step_made(state_sync::STATE);    // every write made, a stepping write's last step included
cx.cockpit().step_done(state_sync::STATE);    // made, and the aircraft settled
```

- A step's unit says whether it can give and take through `step_ready`, since the stream can't read the profile loader.
  A machine asks for its catch-up, and the flying machine answers, only while every step can, so a core with no step ready never asks.

- The catching-up machine takes the answer's clock as [catch-up](04-order-and-recovery.md#catch-up) has it, so queued copies drop, and hands each step its payload in the pipeline's order.
  It applies the rest of its queue once every step has called `step_made`, and ends the catch-up once every step has called `step_done`.

- The stream registers its guard on `TakeControl` ([guards](../architecture/02-code-map.md#guards)), which denies this pilot control only while their catch-up or replay runs over a link that's up, as [catch-up](04-order-and-recovery.md#catch-up) has it, so a pilot whose link to the PF is lost can take control during a catch-up ([take-control](../control/01-take-control.md#taking-control)).
- Whether a catch-up or a replay runs is a slice of client state, and where it shows waits for the apps' stage ([the apps](../interface/01-apps.md#a-features-parts)).
- The stream's state also says whether preflight's end started the catch-up that runs, which pointer sync reads to play the gestures queued behind that catch-up rather than skip them ([pointer sync](../pointer-sync/01-pointer-sync.md#playing-a-gesture)).

## State sync

### What it registers

```rust
// a sketch; the hooks' names follow the platform's units, and the rules' are hypothetical
pub fn register(r: &mut Registry) {
    let me = r.unit::<StateSync>("state-sync");
    me.on::<ProfileLoaded>(StateSync::load);        // an engine, its watches, and HEvents when it fires H: events
    me.on::<ProfileUnloaded>(StateSync::unload);
    me.on::<SimChanged>(StateSync::ready_to_fly);    // the stamp of RTC_END, for the settle rule
    me.on::<CockpitSent>(StateSync::sent);
    me.on_sim(StateSync::on_sim);                   // readings, input events, K: events, and frames
    me.guard::<Ready>(StateSync::settled);
    me.panel_module("h-events", StateSync::h_events_panel);
    me.panel_module("instrument-reads", StateSync::instrument_reads_panel);
    // the kinds and the catch-up step, above
}
```

### Reaching the sim

| What | The sim service's call ([what a feature calls](../core/03-sim-seam-and-wasm-module.md#what-a-feature-calls)) |
| --- | --- |
| Read an `L:` or `A:` variable, for a state entry or a pulse | `watch`, every sim frame, on change |
| Read an input event | `input` once, then its subscription, since subscribing gives no current value ([catch-up](04-order-and-recovery.md#catch-up)) |
| Hear a `K:` event | `listen(event)`, below |
| Count frames | `frames` |
| Write an `L:` or `A:` variable | `write`, on a definition of its own for that variable |
| Write an input event | `set_input` |
| Send a `K:` event | `key`: the legacy call with one value or none, `_EX1` with more |
| Fire an `H:` event | A feed of `HEvents`, [below](#h-events) |
| Read an `instrument()`, a value in a gauge's JavaScript | State sync's panel module `instrument-reads` ([reading it in the panel](../plugins/01-plugins.md#reading-it-in-the-panel)) |

- `listen(event)` is a call this design adds to the sim service: it maps the event, adds it to a group that never masks, and gives the group the highest priority, as FS Copilot hears a profile's `K:` entries ([04-02](../../learn/foundations/04-02-events.md)).
  Groups hear an event in priority order, and a group that asks for a priority already taken gets the next lower one free (documented, same chapter); a listener of ours at the highest priority heard all 88 elevator events a masking group of ours heard (measured on MSFS 2024, 2026-10-07, [flight-controls log](../flight-controls/log.md#2026-10-07-a-group-that-takes-its-priority-as-the-sim-starts-held-open-by-an-event-it-only-listens-to-masks-ahead-of-accu-sim-once-it-adds-the-axis)).
- `key` sends with delivery starting at the highest priority, so our own sends reach the listening group and the engine's tokens use them up (unverified in a run; a case in the sim).
  It sends with SimConnect's legacy call when the event carries one value or none, as [which call sends an event](../profiles/01-format-and-delivery.md#which-call-sends-an-event) has it, where 6.3's `key` always sends `_EX1`.
  A case in the sim runs each v1 profile's events by the legacy call, and an aircraft that drops them gets a field naming the call for the whole aircraft at a later level ([levels](../profiles/01-format-and-delivery.md#levels)).
- State sync makes the engine's actions in the order they come; whether the sim keeps that order across a variable's write and an event is unverified ([write functions](../profiles/01-format-and-delivery.md#write-functions)), and the L-1011's case below turns on it.

### `H:` events

**Firing them.**
State sync fires an `H:` event through a routine of its own in our WASM module, `HEvents`, whose slot is `DUALINPUT_ROUTINE_H_EVENTS`.

```rust
// a sketch: state sync's module of the message crate
pub struct HEventsSlot { pub count: u16, pub names: [u8; 8000] }   // `count` names, each ended by a 0 byte, in call order
```

- Each feed is one batch of names, in call order, and a batch longer than the slot goes in several feeds.
- A name goes without its `H:`, as an instrument receives it: the Baron's KR87A answers `adf_SetRst` for `H:adf_SetRst` (read in bksq-aircraft-baronpro 0.1.1, `KR87A.js`, `onInteractionEvent`).
- The routine asks the routine host, in its frame, to fire each name, and the routine host registers each name once with `fsEventsRegisterHEvent` and fires it with `fsEventsHEventCall` and no parameters, after every routine's frame has run.
  This adds a want to the code map's [what a routine can ask for](../architecture/02-code-map.md#what-a-routine-can-ask-for), with nothing to undo, as the code map foresaw for an `H:` event.
- The SDK documents that after `fsEventsHEventCall`, "in all JavaScript VCockpit, the callback `OnInteractionEvent` will be called" ([fsEventsHEventCall](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/wasm/event-api/fseventsheventcall/index.md)), and its header says "HVar are events distributed to js vcockpits" (read in MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_Events.h`).
- The SDK documents no SimConnect route: [SimConnect_MapClientEventToSimEvent](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_MapClientEventToSimEvent.htm) names the Event IDs list, custom events with a period, and third-party numbers, and no `H:` form; that none exists is unverified, and v1 builds the module's route either way.
  This settles the spine's item on which route the profile engine fires `H:` events by ([left open](../architecture/01-spine.md#left-open)).
- If a case in the sim finds `fsEventsHEventCall` reaches no instrument, the routine runs calculator code instead, `(>H:<name>)`, as FS Copilot's module fires every `H:` event ([03-02](../../learn/foundations/03-02-events-and-other-namespaces.md#h-html-events)), and nothing outside the routine host changes.
- The slot's feed and a variable written on state sync's connection travel different ways, so whether the L-1011's flight engineer sees a fuel pump switch written before the `H:FUEL` that follows it is a case in the sim.

**Hearing them.**
State sync hears `H:` events in one cockpit panel, through its panel module `h-events`, loaded only when the loaded variant has an event entry that watches an `H:` name.

- Its rule gives the module to the first panel it's asked about after the profile loads, and to that panel again, by its instruments' keys, after the panel reloads ([cockpit panels and their modules](../core/02-clients-and-panel-bridge.md#cockpit-panels-and-their-modules)).
- The module registers its own handler with `Coherent.on("OnInteractionEvent", …)`, the call through which stock `VCockpit.js` hands each event to its instruments (read in the FS Copilot fork's copy of MSFS 2024's file, `record/pointer-forwarding/module/vendor/VCockpit.stock.js`, at a sim version it doesn't name), runs it in a `try`, sends each event's name and target to state sync, and removes its handler in `stop`.
  FS Copilot instead wraps each instrument's `onInteractionEvent` ([03-02](../../learn/foundations/03-02-events-and-other-namespaces.md#h-html-events)), which puts its code in the path of the pilot's input; a handler beside the stock one wraps nothing.
  That Coherent runs both handlers of one event is unverified, and a case in the sim settles it.
- Stock `VCockpit.js` skips an instrument when the event names a target other than its `Guid`, or when its `urlConfig.noEvent` is set, so whether an event sent to one instrument reaches a document other than that instrument's is unverified, and a case in the sim settles it.
- One panel's handler hears each event once, where a handler in every panel would hear it once in each.

### Ready, notifications, log lines, and the checklist

- State sync's guard on `Ready` denies it until the engine says the aircraft has settled, and allows it while no profile is loaded ([preflight](../session/02-units.md#preflight)).
- A flagged write, an entry the driven-entry test stops, and an entry a write function's limit stops each show one notification, once per entry for each load, such as "Couldn't sync the beacon." ([checking that a write landed](02-live-sync.md#checking-that-a-write-landed)).
- The words of the notifications and of the guard's reason wait for the apps' stage ([the apps](../interface/01-apps.md#a-features-parts)).
- A recording holds no marks, so state sync logs at info each flagged write and each watch-only entry whose values differ, and a flagged write's line carries the entry, the value wanted, the reading, and 0 retries (user, 2026-10-23; [recording log](../recording/log.md#2026-10-23-one-zstd-frame-flushed-each-second-keeps-a-busy-flights-recording-at-426-mb-an-hour-where-a-frame-ended-each-second-takes-667-mb)).
  An entry the driven-entry test stops goes in the run's log as [entries the aircraft drives itself](04-order-and-recovery.md#entries-the-aircraft-drives-itself) has it.
- The PF's checklist, each counting entry's `name` and `default`, is a slice of client state while preflight runs.
  It shows through state sync's part in the apps, wherever the apps' design puts it, including beside the banner's preflight summary, since the banner shows the EFB app's parts' views ([the apps](../interface/01-apps.md#a-features-parts)).

## What the code map changes in the sync docs

Nothing beyond the notes they carry: the code map names the units that carry their rules, and each change this design makes to a rule is in the doc it changes, in its text or in a note at its top.

## What the open questions still hold

| Open question | What holds |
| --- | --- |
| [02-live-sync](02-live-sync.md#open-questions): whether the double-fire stays within 3 frames on other aircraft and below 21 fps | A case in the sim, and a bench case at 4 fps |
| 02-live-sync: how many retries before a flag, and how long an unused token lasts | None, and 1s, as starting values the bench's cases tune |
| 02-live-sync: keeping a `then` action or a function's actions from harm when a retry repeats them | Settled: with no retry, nothing repeats them |
| [03-catch-up](03-catch-up.md#open-questions): whether the 30s floor can come down, and whether 5 changes tells a restore from an aircraft driving a control | v1's recordings, for the 30s; settled for the 5 changes, since the settle rule counts none ([decision 048](../../decisions/048-settled-30s-after-ready-to-fly.md)) |
| 03-catch-up: which order catch-up applies state in | [Decision 040](../../decisions/040-catch-up-first-final-value-order.md), from the order [the engine keeps](#catch-ups-order); whether an interlock fails while reading back right is a case in the sim |

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures, beside the code map's [budgets](../architecture/02-code-map.md#budgets).

| What | Budget |
| --- | --- |
| An engine call | Inside the code map's 1ms for a handler, apart from write functions, which keep the sandbox's 100ms limit; 100 write functions ran in 75µs in a host doing nothing else ([architecture log](../architecture/log.md#2026-10-08-embedded-in-rust-quickjs-runs-100-write-functions-a-frame-in-75µs-idles-under-1-mb-and-holds-its-memory-and-time-limits-while-v8s-memory-limit-failed-until-turbofan-was-off)) |
| Compiling a profile's write functions at load | Under 10ms for 300, a call into QuickJS-ng (unverified) |
| Frames | One input for each `Frame` event, whose rate is unmeasured; our module's update ran 89.2 times a second through a flight ([architecture log](../architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)) |
| Kept messages | Under 4 MB: a 30-minute cut at a busy PF's 20 changes a second, at about 100 bytes each, an estimate from a sample change's 84 bytes ([network log](../network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does)), is 3.6 MB (arithmetic), inside the 100 MB [01-loop-and-edge](../core/01-loop-and-edge.md#budgets) gives a busy session |
| A catch-up's answer | Under 64 KB for 500 entries, at about 90 bytes each for its name, value, and stamp (an estimate the 58P's profile measures) |
| An `H:` event | Fired within 2 sim frames of its feed (unverified) |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with two cores, or three where a third is named, and the stand-in sim:

- A knob turned a detent a frame, 100, 101, 102, with the receiving machine's reading a frame behind: nothing goes back, and the stepping write doesn't overshoot.
- A pilot turning the knob back through the same values 1s after a write: the change goes out.
- A `toggle` over a lamp the stand-in lights 2s late: one flip, flagged, and no second flip.
- A write function that checks for power and writes nothing, live and in catch-up's burst right behind the battery: flagged.
- A press on a display that sets a variable the profile also syncs, the variable's change reaching the core before the press: where both machines end ([checking a write](../profiles/01-format-and-delivery.md#checking-a-write)).
- A pulse set and cleared within one frame: the event entry never fires.
- A value written as 165 and read as 165.000002: no flag.
- Both pilots change one shared entry within 50ms, and again while one's change is still held: every machine ends on one value.
- A lever changing 60 times a second: at most 20 messages a second, and its held value out before a press that follows.
- Three cores: B's press held at C until A's page key has applied.
- A 60s cut: the replay paced, a run of PF-owned changes collapsed, and the take-control button denied until the receiver's clock covers the replay's.
- A takeover during a cut: the old PF's solo changes dropped everywhere, and the ex-PF catching up from the new PF.
- A late joiner, and a pin that goes from none to a bundle after an airborne start: each following machine asks, writes the battery before the APU master, and ends at its last write and settled; queued copies drop.
- A `CatchUpAsk` that reaches the PF before its own profile has loaded: answered once it loads.
- A link lost between a `CatchUpAsk` and its answer: asked again when the link comes up.
- Control passing between two others during a catch-up: the catching-up machine asks the new PF, and the old PF's answer drops.
- A PF who leaves the flight during the PM's replay: its `CONTROL` goes out, and the PM's replay ends with nothing dropped.
- A member whose aircraft has no profile, during and after a takeover: `CONTROL` applies, its replay ends, and Ready and take-control are allowed.
- Ready to fly clicked 20s after the profile loads, and the stand-in restoring switches 5s after it: Ready is denied until 30s after `RTC_END`, and nothing is sent before preflight ends.
- A restarted core: settled at once, and its shadows take the flying machine's values.
- An entry the stand-in changes every 3s on both machines: it stops syncing within 30s on both.
- The PM's throttle on a following machine: put back at once, and nothing sent; moved for 3s, put back throughout, and nothing flagged.
- An event entry that watches an `H:` event and writes an input event: the `H:` event its write makes the aircraft fire isn't sent back; and when the stand-in fires it 2s after the write, past the token, the driven-entry test stops the entry within 30s, with its notification.
- A write function stuck past 100ms: its entry stops on the machine that ran it, which skips arriving changes to the entry, sends none, and shows its pilot the notification.
- An input event reported twice a frame apart: one goes out; the same report 261ms later goes out; at 4 fps, where a frame passes 200ms, both go out.
- A token nothing uses: it expires after 1s, and the pilot's press after that goes out.

In the sim:

- `HEvents` fires an event a JavaScript instrument hears; two feeds in one frame both fire; the L-1011's flight engineer acts on the fuel pump switch written before its `H:FUEL`.
- The `h-events` handler hears events beside the stock one, and an event sent to one instrument reaches the panel that holds the handler.
- Each v1 profile's `K:` events, sent by the legacy call, act.
- `listen` hears our own `key` sends, an event an aircraft's own group masks, and one the aircraft's own code fires.
- The A350 at `pace: 2 frames`, stepped from the core: ten baro commands move it 10 hPa.
- The Fenix's battery lamp follows a write within the 1.5s check.
- The double-fire on aircraft other than the PA-24, and below 21 fps.
- Catch-up on an aircraft with an APU, whose master written before the battery would fail while reading on ([choosing the order](03-catch-up.md#choosing-the-order)).

## Left open

- What the bench's cases change in the engine's starting rules: retries, running a function again when an entry it read lands, a longer check for a computed readout, or stepping inside a routine; each changes the engine alone.
- A replay from whoever kept a message, and a pass to the up-to-date pilot, with more than two pilots: the pick for larger crews.
