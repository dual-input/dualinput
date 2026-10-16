# Sync: its units

```text
Purpose:     The sync engine's, the cockpit stream's, and state sync's interfaces, and the rules the sync engine starts the bench from.
Depends on:  01-profile-entries.md, 02-live-sync.md, 03-catch-up.md, 04-order-and-recovery.md, ../architecture/02-code-map.md, ../core/01-loop-and-edge.md, ../core/02-clients-and-panel-bridge.md, ../core/03-sim-seam-and-wasm-module.md, ../network/02-units.md, ../recording/01-recording-and-bug-reports.md, ../session/02-units.md, ../profiles/01-format-and-delivery.md, ../profiles/02-units.md
Decides:     What each of sync's three units holds and offers; a cockpit message's fields; how the cockpit stream holds, paces, keeps, replays, and drops messages; who asks for a catch-up, when, and where its order comes from; how the sync engine tells its own echo, checks a write, steps a knob that's still moving, and runs write functions; how state sync fires and hears `H:` events and hears `K:` events; which call sends an event; what 02-live-sync's and 03-catch-up's open questions still hold; the budgets; and the cases for the bench (node 6.9).
```

The sync engine is one state machine for each loaded profile, with no I/O, so the IDE and the bench link it on their own.
The cockpit stream, in the platform, carries every cockpit message in causal order, holds each state entry's newest value, paces what it applies, keeps what it sent for a replay, and runs catch-up, which the catching-up machine asks for.
State sync is the feature that joins the engine to the sim, the stream, and the session.

The engine starts the bench from simple rules: a write stays pending until a reading equals it, a write no reading matches within 1.5s is flagged and never retried, a stepping write counts its own steps, and a write function runs once for each value.
State sync fires `H:` events from a routine of its own in our WASM module and hears them in one cockpit panel, and sends an event with one value or none by SimConnect's legacy call.
Catch-up writes in an order each machine keeps in memory, and starts whenever a following machine's profile loads after preflight has ended.

This answers node 6.9 of the [architecture plan](../architecture/plan.md#69-sync).
The sync docs [01-profile-entries](01-profile-entries.md) to [04-order-and-recovery](04-order-and-recovery.md), [01-format-and-delivery](../profiles/01-format-and-delivery.md), and decisions [039](../../decisions/039-cut-link-replays-others-late-join.md) to [043](../../decisions/043-driven-entries-and-putting-back.md) give the rules this design carries, and this document holds only what they leave out.
The flying machine is the PF's, and a following machine is any other pilot's.
A pending write is a value the engine wrote to an entry that no reading has shown yet.

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `sync-engine` | Engine | For one loaded profile: the state object, each entry's stamp, the write functions in the profile's QuickJS-ng runtime, shadow values, pending writes and echo tokens, the check, the settle rule, the driven-entry test, putting back, the conflict rule, and catch-up's order | On the loop, in the IDE, and on the bench |
| `cockpit-stream` | Platform | The vector clock, holding a message until what it depends on has applied, copies, kinds, held values, pacing, kept messages and replays, changes of control, catch-up's pipeline and its exchange, and the guard on control | On the loop |
| `state-sync` | Feature | One sync engine for the loaded profile, its watches and writes through the sim service, its cockpit kinds and catch-up step, the guard on Ready, notices, marks, and the PF's checklist | Its crate in the core, the routine `HEvents` in our WASM module, and the panel module `h-events` |

Each depends on what the code map's [units](../architecture/02-code-map.md#the-units) give it: the sync engine on the profile engine, the sandbox, and the message crate; the cockpit stream on the kernel, the network, the recording crate, and the session; and state sync on the cockpit stream, the session, the sim service, the profile loader, the plugins crate, `clients`, and the sync engine.

## The sync engine

```rust
// a sketch: one engine for each loaded profile, on each machine
pub struct Engine { /* the state object, stamps, pending writes, tokens, shadows, the runtime */ }

pub struct Ctx { pub at: Micros, pub flying: bool, pub catching_up: bool }

impl Engine {
    pub fn load(profile: &Profile, variant: &str, runtime: Runtime, times: Load) -> Engine;  // compiles the write functions
    pub fn watches(&self) -> &[Watch];                              // variables, input events, K: and H: events, plugin values
    pub fn seen(&mut self, what: Seen, cx: Ctx) -> Vec<Out>;        // a reading or an occurrence on this machine
    pub fn arrived(&mut self, entry: &str, change: Arrived, cx: Ctx) -> (Applied, Vec<Out>);   // another machine's change or event
    pub fn frame(&mut self, cx: Ctx) -> Vec<Out>;                   // steps due, checks closing, the settle rule
    pub fn sent(&mut self, entry: &str, stamp: Stamp);              // the stream sent this machine's change
    pub fn give(&self) -> CatchUpState;                             // on the flying machine: each entry, its value and stamp, in order
    pub fn take(&mut self, state: &CatchUpState, cx: Ctx) -> Vec<Out>;   // on the catching-up machine
    pub fn settled(&self) -> bool;
}

pub enum Out { Act(Action), Send(Change), Withdraw(String), Flag(Flag), Mark(Mark), Stop(String) }
pub enum Action { Set(Name, Value), Key(Name, Vec<f64>), Fire(Name), Plugin(String, Value) }
```

- The engine takes the time and the roles in `Ctx` with each call, reads no clock, and makes no call itself: state sync carries out each `Out`.
- It compiles the profile's write functions, which the bundle holds as JavaScript compiled at ES2020 ([the profiles' units](../profiles/02-units.md#loading)), when it loads, in the profile's own runtime from the sandbox ([the sandbox](../profiles/01-format-and-delivery.md#the-sandbox)).
- `Load` carries the stamps of the profile's load and of this aircraft's Ready to fly, or none when this core missed it, which the settle rule and catch-up take.

### Watching and the state object

- `watches` lists what each entry of the loaded variant reads or hears: an `L:` or `A:` variable, an input event, a `K:` event, an `H:` event, an `L:` variable watched as a pulse, or a plugin's value.
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
| A plugin's write method | One `Plugin` call with the value |
| A function | The `write()` calls of one run, in call order, and each chain's steps at its pace |

- A stepping write counts from its own steps: it starts from the reading when it starts and adds each step it sends, and never reads the entry again until its last step, so a reading that lags a step behind never makes it step again.
  A new value for the entry while it steps aims again from that count, the shorter way round.
- A pace in frames counts the sim's `Frame` events, which state sync hands the engine as `frame` calls, and a pace in ms counts their stamps ([pace](../profiles/01-format-and-delivery.md#pace)).

### Its own echo

- A value the engine writes to a state entry is pending from the moment it hands the actions over until a reading of the entry equals it.
- That reading clears it, and every value pending before it on that entry, and is no change of this machine's.
- A reading that equals no pending value is this machine's own change.
- A stepping write adds each step's value to the pending ones, and a `toggle` that flips adds the value wanted.
- Values compare as `f32`, since a value written as 165 read back as 165.000002 (measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-writing-a-gsx-persons-animation-frame-makes-it-walk-and-a-seated-one-moves-on-its-own)).

So a knob the other pilot turns a detent a frame arrives as 100, 101, and 102, and a reading of 100 that lags behind the write of 102 clears 100 and sends nothing.
A pilot who turns the knob back through 101 a second later is heard, because each pending value cleared within 2 frames of its write, as every write that landed showed on six aircraft ([sync log](log.md#2026-10-05-two-writes-in-one-frame-land-in-the-order-sent-and-a-write-shows-within-2-frames)).
A rule that remembered written values for a time would have swallowed that turn ([checking a write](../profiles/01-format-and-delivery.md#checking-a-write)).

### Checking a write

- A write gets one attempt, as the bench starts ([checking a write](../profiles/01-format-and-delivery.md#checking-a-write)).
- A value still pending 1.5s after its write, or after a stepping write's last step, is flagged: the engine drops it, marks the recording with the entry, the value wanted, the reading, and 0 retries, and has state sync show the notice once per entry for each load ([checking that a write landed](02-live-sync.md#checking-that-a-write-landed)).
  The 1.5s covers the slowest readout measured, the Fenix's battery lamp at 1.2s ([sync log](log.md#2026-10-05-the-a220s-fcp-ignores-stock-autopilot-events-the-a350-takes-a-command-at-most-every-2-frames-and-the-fenix-reads-a-counters-jump-as-that-many-detents)), since the engine can't tell which entries read a computed readout.
- A `toggle` whose lamp lights after the check flips once and is flagged, and nothing flips it a second time.
- A shadow value has nothing to read, so its writes go unchecked ([counting into a shadow value](../profiles/01-format-and-delivery.md#counting-into-a-shadow-value)).
- A watch-only entry's value from another machine is compared with this machine's reading 1.5s after it arrives, and a difference marks the recording.

### Write functions

- A function runs once for each value it's given, live or in catch-up, and never again when an entry it read changes.
- Its value is pending whatever the run wrote, so a run that writes nothing, such as a transponder function that skips while the battery is off, is flagged when the reading never comes to match.
  The engine can't tell a deliberate skip from a function that's wrong, so it judges by the cockpit.
- A run that hits the sandbox's 100ms limit fails that write, and the engine stops the entry for the rest of the load, as the code map's [budgets](../architecture/02-code-map.md#budgets) require; state sync tells every other machine ([kinds](#kinds)).

### Events

- An event entry's firing on this machine sends its occurrence, with the event's value if it carried one, and another machine's arrives as `Arrived::Fired`, which the engine fires through the entry's `write`.
- Each `Key` or `Fire` the engine makes leaves a token for its name, and the next occurrence of that name on this machine uses the token up instead of being sent; a token no occurrence uses within 1s expires, as an `ignore` does.
  A counting entry's shadow moves on an occurrence that uses a token, and that occurrence isn't sent.
- After an entry fires on this machine, by its pilot or by the engine, the next occurrence of each name in its `ignore` within 1s is dropped ([ignoring a consequence](01-profile-entries.md#ignoring-a-consequence)).
- An input event's report with the same name and value as one in the last 3 frames, and within 200ms, is dropped as the double-fire ([keeping a change from applying twice](02-live-sync.md#keeping-a-change-from-applying-twice)).

### Who sends, and putting back

- A change of this machine's goes out as `Send`, unless the entry is PF-owned and this isn't the flying machine, or this machine's catch-up runs, or the entry has stopped syncing.
- When it may not go out, the engine puts back the value it holds, at once, as [putting back](04-order-and-recovery.md#putting-back) has it.

### The conflict rule

- The engine keeps each state entry's stamp: the vector clock of the message that set it, its sender's pilot ID and restart count, and the control value it was made under, which names the PF of the moment.
- An arriving change to a shared entry applies when its stamp wins, by [the conflict rule](02-live-sync.md#when-two-pilots-change-one-entry) and its tie-break for two restart counts ([the cockpit stream](04-order-and-recovery.md#the-cockpit-stream)); a change that loses counts as applied with nothing written.
- A change of this machine's that the stream still holds has no clock yet, so it counts as made without having seen anything that arrives before it goes.
  When an arriving change beats it, the engine writes the arrival and withdraws the held one, and when the held one wins, it goes out later with a clock that includes the arrival, so the other machine judges it the later of the two and every machine keeps it.

### Settling and the driven-entry test

- The settle rule runs as [settling after a load](03-catch-up.md#settling-after-a-load) has it, from `Load`'s stamps, and for an aircraft that loaded before its profile, as [an aircraft that loaded before its session](04-order-and-recovery.md#an-aircraft-that-loaded-before-its-session) has it.
- An aircraft whose Ready to fly this core missed, as after a core restart, counts as settled at once, and its shadows take the flying machine's values in catch-up rather than stepping to them ([a core that restarts](04-order-and-recovery.md#a-core-that-restarts)).
- The driven-entry test runs as [entries the aircraft drives itself](04-order-and-recovery.md#entries-the-aircraft-drives-itself) has it.

### Catch-up's order

- For each entry, the engine keeps when this cockpit first took each of its last 16 distinct values, from the reading's stamp, with the reading at the profile's load counting as taken at the load.
- `give` lists every entry in the order it first took the value it holds, which puts first the entries that hold their value from the load, as [catch-up](04-order-and-recovery.md#catch-up) asks.
- A switch has a handful of values, so its order is exact, and the battery cycled off and on after the APU master still goes before it.
  A lever that took more than 16 values counts from when it returned to a value it no longer remembers, which is its last change, and no interlock turns on a lever's exact position (inference).
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

// state sync's module: CHANGE and PF_CHANGE carry a Value, FIRED an Option<Value>, STOPPED nothing
pub enum Value { Number(f64), Text(String) }
```

- A message names its entry by name and each counter by pilot ID and restart count, as [decision 042](../../decisions/042-vector-clock-records-what-applied.md) chose; a change measured 84 bytes so ([network log](../network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does)).
- The body is the kind's own type in its feature's module of the message crate, so the stream names no feature's types.
- The receiver's clock goes out once a second on a `Newest` channel of the stream's own, as [02-units](../network/02-units.md#the-heartbeat-and-clock-offsets) has it.

### Kinds

```rust
// a sketch: state sync's kinds
me.cockpit_kind(state_sync::CHANGE, StateSync::apply).hold_newest();
me.cockpit_kind(state_sync::PF_CHANGE, StateSync::apply).hold_newest().collapse_in_replay();
me.cockpit_kind(state_sync::FIRED, StateSync::fire);
me.cockpit_kind(state_sync::STOPPED, StateSync::stop);
```

- A kind's handler answers each message `Done`, `Skipped`, or `Pending(handle)`, and a pending one holds the stream until its unit calls `cx.cockpit().applied(handle)`, as a stepping write does at its last step and pointer sync's press at its release.
  The next message of the same kind and key goes to the handler at once, as a new value cuts a stepping write short ([one stream, in causal order](02-live-sync.md#one-stream-in-causal-order)), and the one pending counts as applied.
- `hold_newest` makes the stream hold each key's newest message and send it at most 20 times a second, and send every held message before a message of any kind that doesn't hold, so a lever's value goes out before the starter press after it ([the cockpit stream](04-order-and-recovery.md#the-cockpit-stream)).
  A kind that holds is the stream's, rather than state sync's, because the press it flushes before is pointer sync's.
- `collapse_in_replay` marks the PF-owned changes a replay collapses ([the replay](04-order-and-recovery.md#the-replay)).
- State sync's `STOPPED` stops an entry on every machine when a write function hits its limit on one.
- The stream's own kind, `CONTROL`, carries a change of control ([a change of control](#a-change-of-control)).

### Sending

- `cx.cockpit().send(kind, key, body)` sends, or holds when the kind holds, and `cx.cockpit().withdraw(kind, key)` drops what's held for that key.
- When a message goes, the stream adds 1 to its own counter, fills in the clock, the control value, and the gap, keeps the message, sends it `To::Crew`, and raises `CockpitSent { kind, key, clock }`, the code map's ["cockpit sent"](../architecture/02-code-map.md#what-a-handler-sees-and-does), which also hands state sync the stamp of its change.
- It sends nothing while this member is out of the flight ([in the flight](../session/02-units.md#in-the-flight)).

### Applying

1. A message waits until the receiver's clock covers every message it depends on, and a message the clock already covers is a copy, which drops.
2. It waits what's left of its gap, capped at 2s, counted from when the message before it applied, through a timer ([the replay](04-order-and-recovery.md#the-replay)).
3. The stream skips it if a change of control drops it, or if a replay collapses it.
4. Its kind's handler applies it, and once it's done or skipped, the receiver's clock takes its number.

- Messages queue, applying nothing, while this member is out of the flight, while it has no profile loaded, and while its catch-up waits for its answer ([catch-up](#catch-up)).
- A message of a kind no unit here registered is skipped, which a crew on one release never sends.

### Kept messages and a replay

- The stream keeps every message it sent or applied until the clock every member of the session last sent covers it, so normally a message goes within a second, and during a cut, kept messages grow until the link returns or the member is counted out at 30 minutes.
- On `LinkUp { again }`, the stream sends the member `Replay` with its own clock, then every kept message that member's last clock doesn't cover, in causal order, on the stream's one channel ([links](../network/02-units.md#links)).
- The receiving machine's replay runs until its clock covers the clock `Replay` carried.
  Within it, a message of a kind that collapses is skipped when a later message of the same kind and key follows it in the replay with only collapsing messages between them.
- A link that comes up without `again`, for a new member or a restarted core, brings no replay, and that machine's catch-up covers what it lacks.

### A change of control

- On `ControlPassed` with `made_here`, the core that made the change sends a `CONTROL` message whose body is the new control value, so its clock is the maker's ([the session's units](../session/02-units.md#control)).
- Once the session's control has changed, a message the superseded PF made under the value it lost waits until that change's `CONTROL` message arrives, then applies if the `CONTROL` message's clock includes it and is skipped if not, live or in a replay ([a change of control](04-order-and-recovery.md#a-change-of-control)).
- A machine other than the new PF whose clock counts more of the superseded PF's messages than the `CONTROL` message's clock does applied one the change drops, and asks for a catch-up from the new PF once any replay it's receiving ends.

### Catch-up

The catching-up machine asks for its catch-up, since after a pass only it knows that one was running:

- It asks the flying machine with `CatchUpAsk` when its profile loads after preflight has ended, when preflight ends with its profile loaded, when control passes to another pilot while its catch-up runs, and after a change of control drops a message it applied.
  The first covers a late joiner, a pilot back from a sim, core, or PC that went down, and a session whose pin went from none to a bundle after preflight ([the pin](../profiles/02-units.md#the-pin)).
- The PF never asks, and a pilot whose catch-up runs when control reaches them stops it, since they're the source ([catch-up](04-order-and-recovery.md#catch-up)).
- The flying machine answers with each catch-up step's payload, its clock, and its control value, on the stream's channel to that member alone; an answer made under a control value other than the session's current one is dropped, and the asker asks the new PF.
- The asker takes the answer's clock for every counter but its own, keeping the larger of each, so queued messages the answer covers drop as copies, hands each step its payload in the pipeline's order, applies the rest of the queue once every step's writes are made, and ends the catch-up once every step is done.

```rust
// a sketch: state sync's step, the one step in v1's pipeline
me.catch_up_step(state_sync::STATE, StateSync::give, StateSync::take);   // give on the flying machine, take on the asker
cx.cockpit().step_made(state_sync::STATE);    // every write made, a stepping write's last step included
cx.cockpit().step_done(state_sync::STATE);    // made, and the aircraft settled
```

- The stream registers its guard on `TakeControl`, which denies this pilot control while their catch-up runs, or their replay runs over a link that's up ([guards](../architecture/02-code-map.md#guards)).
- Whether a catch-up or a replay runs is a slice of client state, and where the banner shows it is [6.16](../architecture/plan.md#616-the-apps)'s.

## State sync

### What it registers

```rust
// a sketch; the hooks' names follow the platform's units, and the rule's is hypothetical
pub fn register(r: &mut Registry) {
    let me = r.unit::<StateSync>("state-sync");
    me.on::<ProfileLoaded>(StateSync::load);        // an engine, its watches, and HEvents when it fires H: events
    me.on::<ProfileUnloaded>(StateSync::unload);
    me.on::<SimChanged>(StateSync::ready_to_fly);    // the stamp of RTC_END, for the settle rule
    me.on::<CockpitSent>(StateSync::sent);
    me.on_sim(StateSync::on_sim);                   // readings, input events, K: events, and frames
    me.guard::<Ready>(StateSync::settled);
    me.panel_module("h-events", StateSync::h_events_panel);
    // the kinds and the catch-up step, above
}
```

### Reaching the sim

| What | The sim service's call ([what a feature calls](../core/03-sim-seam-and-wasm-module.md#what-a-feature-calls)) |
| --- | --- |
| Read an `L:` or `A:` variable, for a state entry or a pulse | `watch`, every sim frame, on change |
| Read an input event | `input` once, then its subscription, since a subscription reports nothing until the value changes ([catch-up](04-order-and-recovery.md#catch-up)) |
| Hear a `K:` event | `listen(event)`, below |
| Count frames | `frames` |
| Write an `L:` or `A:` variable | `write`, on a definition of its own for that variable |
| Write an input event | `set_input` |
| Send a `K:` event | `key`: the legacy call with one value or none, `_EX1` with more |
| Fire an `H:` event | A feed of `HEvents`, [below](#h-events) |
| A plugin's value, or its write method | The plugins crate, [6.15](../architecture/plan.md#615-plugins)'s |

- `listen(event)` is a call this design adds to the sim service: it maps the event, adds it to a group that never masks, and gives the group the highest priority, so the group hears an event before an aircraft's own group can mask it.
  Our own sends reach it, as a value sent back at 10,000,001 reached our own masking group ([flight-controls log](../flight-controls/log.md#2026-10-01-a-value-sent-back-at-10000001-reached-our-own-masking-group-and-the-777-ignored-re-sent-values)), and the engine's tokens use them up.
- `key` sends with SimConnect's legacy call when the event carries one value or none, as [which call sends an event](../profiles/01-format-and-delivery.md#which-call-sends-an-event) has it, where 6.3's `key` always sends `_EX1`.
  The PMDG 777's module dropped a masked axis event sent with `_EX1` and acted on it sent with the legacy call (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-the-pmdg-777-takes-a-value-sent-back-with-the-legacy-transmit-call)), which we read as its module handling only the legacy call's message (unverified).
  An aircraft whose module handled only `_EX1`'s message would miss a legacy send, and none we've studied is known to; a case in the sim runs each v1 profile's events by the legacy call, and if an aircraft drops them, a later level adds a field naming the call for the whole aircraft, which changes no profile already written ([levels](../profiles/01-format-and-delivery.md#levels)).
- The engine's `Action` maps onto these calls in the order it comes, so a run's actions keep their call order on state sync's connection.

### `H:` events

**Firing them.**
State sync fires an `H:` event through a routine of its own in our WASM module, `HEvents`, whose slot is `CROSSCHECK_ROUTINE_H_EVENTS`.

```rust
// a sketch: state sync's module of the message crate
pub struct HEventsSlot { pub count: u16, pub names: [u8; 8000] }   // `count` names, each ended by a 0 byte, in call order
```

- Each feed is one batch of names, in call order, and a batch longer than the slot goes in several feeds.
- The routine asks the routine host, in its frame, to fire each name, and the routine host registers each name once with `fsEventsRegisterHEvent` and fires it with `fsEventsHEventCall` and no parameters, after every routine's frame has run.
  This adds a want to the code map's [what a routine can ask for](../architecture/02-code-map.md#what-a-routine-can-ask-for), with nothing to undo, as the code map foresaw for an `H:` event.
- The SDK documents that after `fsEventsHEventCall`, "in all JavaScript VCockpit, the callback `OnInteractionEvent` will be called" ([fsEventsHEventCall](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/wasm/event-api/fseventsheventcall/index.md)), and its header calls `H:` events "events distributed to js vcockpits" (read in MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_Events.h`).
- SimConnect has no route we can find: [SimConnect_MapClientEventToSimEvent](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_MapClientEventToSimEvent.htm) names the Event IDs list, custom events with a period, and third-party numbers, and no `H:` form (documented).
  This settles the spine's item on how the profile engine fires `H:` events ([left open](../architecture/01-spine.md#left-open)).
- If a case in the sim finds `fsEventsHEventCall` reaches no instrument, the routine runs calculator code instead, `(>H:<name>)`, as FS Copilot's module fires every `H:` event ([03-02](../../learn/foundations/03-02-events-and-other-namespaces.md#h-html-events)), and nothing outside the routine host changes.
- The slot's feed and a variable written on state sync's connection travel different ways, so whether the L-1011's flight engineer sees a fuel pump switch written before the `H:FUEL` that follows it is a case in the sim.

**Hearing them.**
State sync hears `H:` events in one cockpit panel, through its panel module `h-events`, loaded only when the loaded variant has an event entry that watches an `H:` name.

- Its rule gives the module to the first panel it's asked about after the profile loads, and to that panel again, by its instruments' keys, after the panel reloads ([cockpit panels and their modules](../core/02-clients-and-panel-bridge.md#cockpit-panels-and-their-modules)).
- The module registers its own handler with `Coherent.on("OnInteractionEvent", …)`, the call through which stock `VCockpit.js` hands each event to its instruments (read in the FS Copilot fork, `record/pointer-forwarding/module/vendor/VCockpit.stock.js`), runs it in a `try`, sends each event's name and target to state sync, and removes its handler in `stop`.
  FS Copilot instead wraps each instrument's `onInteractionEvent` ([03-02](../../learn/foundations/03-02-events-and-other-namespaces.md#h-html-events)), which puts its code in the path of the pilot's input; a handler beside the stock one blocks nothing.
- Stock `VCockpit.js` skips each instrument whose `Guid` isn't the event's target, so whether an event sent to one instrument reaches a document other than that instrument's is unverified, and a case in the sim settles it.
- One panel's handler hears each event once, where a handler in every panel would hear it once in each.

### Ready, notices, marks, and the checklist

- State sync's guard on `Ready` denies it until the engine says the aircraft has settled ([preflight](../session/02-units.md#preflight)); the wording of its reason is [6.16](../architecture/plan.md#616-the-apps)'s.
- A flagged write, an entry the driven-entry test stops, and an entry a write function's limit stops each show one notice, once per entry for each load, such as "Couldn't sync the beacon. After your flight, send a bug report from the desktop app." ([checking that a write landed](02-live-sync.md#checking-that-a-write-landed)).
- It marks the recording through `cx.recording().mark` for each of those, for a watch-only entry whose values differ, and for an aircraft that never went quiet ([marks](../recording/01-recording-and-bug-reports.md#marks)).
- The PF's checklist, each counting entry's `name` and `default`, is a slice of client state while preflight runs, which [6.16](../architecture/plan.md#616-the-apps) shows beside the preflight summary.

## What the code map changes in the sync docs

Nothing beyond the notes they carry: the code map names the units that carry their rules, and each change this design makes to a rule is listed in the note at the top of the doc it changes.

## What the open questions still hold

| Open question | What holds |
| --- | --- |
| [02-live-sync](02-live-sync.md#open-questions): whether the double-fire stays within 3 frames on other aircraft and below 21 fps | A case in the sim, and a bench case at 4 fps |
| 02-live-sync: how many retries before a flag, and how long an unused token lasts | None, and 1s, as starting values the bench's cases tune |
| 02-live-sync: keeping a `then` action or a function's actions from harm when a retry repeats them | Settled: with no retry, nothing repeats them |
| [03-catch-up](03-catch-up.md#open-questions): whether the 30s floor can come down, and whether 5 changes tells a restore from an aircraft driving a control | v1's recordings |
| 03-catch-up: which order catch-up applies state in | [Decision 040](../../decisions/040-catch-up-first-final-value-order.md), from the order [the engine keeps](#catch-ups-order); whether an interlock fails while reading back right is a case in the sim |

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures, beside the code map's [budgets](../architecture/02-code-map.md#budgets).

| What | Budget |
| --- | --- |
| An engine call | Inside the code map's 1ms for a handler, apart from write functions, which keep the sandbox's 100ms limit; 100 write functions ran in 75µs in a host doing nothing else ([architecture log](../architecture/log.md#2026-10-08-embedded-in-rust-quickjs-runs-100-write-functions-a-frame-in-75µs-idles-under-1-mb-and-holds-its-memory-and-time-limits-while-v8s-memory-limit-failed-until-turbofan-was-off)) |
| Compiling a profile's write functions at load | Under 10ms for 300, a call into QuickJS-ng (unverified) |
| Frames | One input for each sim frame, 89 a second at the most our module saw ([architecture log](../architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)) |
| Kept messages | Under 4 MB: a 30-minute cut at a busy PF's 20 changes a second, at about 100 bytes each, is 3.6 MB (arithmetic), inside the 100 MB [02-units](../network/02-units.md#budgets) gives a busy session |
| A catch-up's answer | Under 64 KB for 500 entries, at about 90 bytes each for its name, value, and stamp (an estimate the 58P's profile measures) |
| A check | 1.5s from the write, or from a stepping write's last step |
| An echo token | 1s |
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
- Control passing between two others during a catch-up: the asker asks the new PF, and the old PF's answer drops.
- A restarted core: settled at once, and its shadows take the flying machine's values.
- An entry the stand-in changes every 3s on both machines: it stops syncing within 30s on both.
- The PM's throttle on a following machine: put back at once, and nothing sent.
- A write function stuck past 100ms: its entry stops on both machines.
- An input event reported twice a frame apart: one goes out; the same report 261ms later goes out; at 4 fps, where a frame passes 200ms, both go out.
- A token nothing uses: it expires after 1s, and the pilot's press after that goes out.

In the sim:

- `HEvents` fires an event a JavaScript instrument hears; two feeds in one frame both fire; the L-1011's flight engineer acts on the fuel pump switch written before its `H:FUEL`.
- The `h-events` handler hears events beside the stock one, and an event sent to one instrument reaches the panel that holds the handler.
- Each v1 profile's `K:` events, sent by the legacy call, act.
- `listen` hears an event an aircraft's own group masks.
- The A350 at `pace: 2 frames`, stepped from the core: ten baro commands move it 10 hPa.
- The Fenix's battery lamp follows a write within the 1.5s check.
- The double-fire on aircraft other than the PA-24, and below 21 fps.
- Catch-up on an aircraft with an APU, whose master written before the battery would fail while reading on ([choosing the order](03-catch-up.md#choosing-the-order)).

## Left open

- The settle rule's 30s floor and its 5 changes, the driven-entry test's 3s and 30s, the 2s cap on a gap, and the 20 values a second, which v1's recordings tune.
- What the bench's cases change in the engine's starting rules: retries, running a function again when an entry it read lands, a longer check for a computed readout, or stepping inside a routine; each changes the engine alone.
- A plugin's values and write methods as entries, how a plugin's own `write()` reaches the engine so its echoes are known, and a value that's neither a number nor text: [6.15](../architecture/plan.md#615-plugins).
- Where the banner shows a catch-up or a replay, the Ready guard's reason, and the PF's checklist: [6.16](../architecture/plan.md#616-the-apps).
- A replay from whoever kept a message, and a pass to the up-to-date pilot, with more than two pilots: the pick for larger crews.
