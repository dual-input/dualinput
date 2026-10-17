# Pointer sync

```text
Purpose:     How a press or drag on a synced display reaches the crew's displays and plays there, and how a display takes no press while it can't sync one.
Depends on:  ../product/03-v1-scope.md, ../architecture/01-spine.md, ../architecture/02-code-map.md, ../architecture/coherent-gt.md, ../core/02-clients-and-panel-bridge.md, ../sync/04-order-and-recovery.md, ../sync/05-units.md, ../network/01-between-machines.md, ../network/02-units.md, ../profiles/01-format-and-delivery.md
Decides:     What a gesture sends, and when; how another machine's panel plays it, and when each of its messages counts as applied; how a gesture is timed, and which clock the panel bridge measures a span on; which displays lock, when, and what a pilot's blocked press shows; what pointer sync registers; its known limits; the budgets; and the cases for the bench (node 6.11).
```

A pilot's press or drag on a synced display goes to the crew as it happens: its down, its moves, and its up, each a cockpit message keyed by the display.
Each other machine's panel plays each message on its own copy of the display, at the same fractions of the display's size, as it arrives.
While another pilot's gesture plays on a display, that display takes no press from its own pilot, and flashes while one is held; on a machine other than the PF's, every synced display locks while the machine has lost its link to the PF or is catching up.
The panel bridge measures no span: the cockpit stream's gaps, on the core's counter, time every gesture in a replay.

This answers node 6.11 of the [architecture plan](../architecture/plan.md#611-pointer-sync), and holds only what these leave out: [03-v1-scope](../product/03-v1-scope.md#pointer-sync)'s pointer sync, the code map's [modules in the panel bridge](../architecture/02-code-map.md#modules-in-the-panel-bridge) and [what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns), 6.2's [panel bridge](../core/02-clients-and-panel-bridge.md#the-panel-bridge), [04-order-and-recovery](../sync/04-order-and-recovery.md)'s cockpit stream and replay, 6.9's [kinds](../sync/05-units.md#kinds), and [01-format-and-delivery](../profiles/01-format-and-delivery.md#displays)'s displays.
It carries over the capture and the play of our FS Copilot fork's panel code (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js` and `overlay.js`), and sends each gesture as it happens, where the fork sends it whole at its release.
Here a display is an instrument the profile's `displays` names, and a gesture is one press or drag, from a button's down to its up.

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `pointer-sync` | Feature | The displays each panel here announced, its cockpit kind, each up waiting on its panels, and the visible lock as a slice of client state | Its crate in the core, and the panel module `pointer-sync` in each panel that holds a display |

It depends on the cockpit stream, `clients`, the network, and the session, the last for the PF.
It shows nothing outside the displays, so it has no part in the EFB app or the desktop app, where the code map's [features](../architecture/02-code-map.md#features) gives it both.
It has no unrecorded input, so a replay checks it as a whole unit ([a replay](../recording/01-recording-and-bug-reports.md#a-replay)).

## A gesture

```rust
// a sketch: pointer sync's module of the message crate
pub const GESTURE: Kind = Kind(K);   // its cockpit kind, keyed by the display's key; K hypothetical

pub enum Gesture {
    Down { button: u8, at: Point },
    Move { at: Point },
    Held,
    Up { at: Point, click: bool },
}

pub struct Point { pub x: f32, pub y: f32 }   // fractions of the display's bounding rect, never clamped
```

The panel module captures as FS Copilot's does, apart from when it sends:

- It listens on the panel's document, in the capture phase, for `mousedown`, `mousemove`, and `mouseup`, because a display's own handlers may stop an event's propagation and the sim delivers each event to the deepest node (read in the FS Copilot fork, `pointer.js`, `_listen`).
- A gesture starts at a `mousedown` whose target lies inside a display the module serves, or, where the target isn't an element, whose point lies within 0.02 of the display's rect; a press whose target is one of our overlays starts none (same file, `_inside`).
  The module serves each display in its panel that the rule picked, so a panel document with several displays sends each gesture under its own display's key, where FS Copilot's panel code serves the first it's told of and leaves the rest out (read in the FS Copilot fork, `hook.js`, `_configure`).
- It skips every event we dispatched, by a flag of ours and by `isTrusted`, since real cockpit input is trusted and a synthetic event never is (measured by our FS Copilot work, FS Copilot fork, `record/pointer-forwarding/docs/06-open-questions.md`, Q02).
- `Down` goes at once.
  A `Move` goes at most every 33ms, and only once the pointer has traveled 2px since the last point sent, as FS Copilot samples a drag (same file, `DRAG_SAMPLE_MS` and `DRAG_MIN_STEP_PX`).
  `Held` goes each time 1s passes with nothing else sent, so a press held still keeps its lock on the other machines and its length in a replay.
  `Up` goes at that button's `mouseup`, wherever it lands, with `click` set when the gesture traveled under 4px, FS Copilot's line between a press and a drag (same file, `DRAG_MIN_PX`).
- Each goes to the core as a `unit` message with the display's key, and the core sends it on the cockpit stream under that key.
  The stream sends none before preflight ends or while this member is out of the flight ([sending](../sync/05-units.md#sending)), so a press then acts on its own display alone.
- A gesture has no cap: a long press plays for as long as it's held, and a drag sends as many moves as it takes, where FS Copilot capped a hold at 1.5s and a drag at 240 points (same file, `_onUp` and `DRAG_MAX_POINTS`).

FS Copilot sends a gesture whole at its release, and its record rejects live streaming for "More packets, more reordering risk, and no proven benefit" (FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, 4.7).
The risk there was its two packet types riding two streams, so a drag could be handled after the press that followed it (same document, 4.5); our cockpit stream carries every message in one causal order.
Sent whole, a gesture would reach the other display only after its release, a map pan its whole length late, while avatars' hand follows the drag as it's made, from a mouse move every 16ms while the left button is held ([raw input](../core/04-core-helper.md#raw-input)).
It would also put a switch flipped on hardware during a held press ahead of the whole press, where streamed it lands between the down and the up, as it happened.

## Playing a gesture

On each other machine, the core hands each message to the module of every panel there that announced the display, as FS Copilot routes a press to every document that announced its key (FS Copilot fork, `13-pr-prep.md`, 0.4), and the module plays it:

- **`Down`:** it finds the target under the point with the bridge's hit test, which looks past our overlays ([what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns)), dispatches `mousedown` with the button, and asks the bridge for an unseen lock over the display ([locks](#locks)).
  With nothing under the point, the gesture plays nothing.
- **`Move`:** `mousemove` at whatever lies under the point, or at the down's target where nothing does.
- **`Held`:** it renews the lock.
- **`Up`:** `mouseup` at whatever lies under the point, or at the down's target, then `click` at the same target when `click` is set; it releases the lock and tells the core it played the up.
- Each event is a `MouseEvent` with the fields FS Copilot's `_fire` sets, since Coherent GT has no `PointerEvent` ([coherent-gt](../architecture/coherent-gt.md#web-apis)); a synthetic sequence at a peer's fractions drove the A220's ND to plan mode, and replayed drags worked (measured on MSFS 2024, 2026-09-17 and 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "A peer's press drove the real A220 ND, opted in by identifier alone" and "Drag works. Tier 3 is real, with a drift caveat").
- One gesture plays on a display at a time.
  A `Move`, `Held`, or `Up` for a display with no gesture playing is ignored, as when its `Down` came while catch-up ran, or before its panel announced itself.
- 2s after a playing gesture's last message, the bridge lets its lock lapse, and the module ends the gesture with a `mouseup` dispatched on the document and no click, then ignores the rest of it.
  That ends a gesture whose sender lost its link, its core, or its panel partway, and a `Down` for a display with a gesture still playing ends that one the same way first.
  A `mouseup` on the document lands on no control, so a display's own drag or hold should end without acting (unverified; a case in the sim).

The core's handler for the kind answers each message as the stream asks ([kinds](../sync/05-units.md#kinds)):

| A message | The handler answers |
| --- | --- |
| Any, while this machine's catch-up runs | `Skipped`, as for every press then ([the cockpit stream](../sync/04-order-and-recovery.md#the-cockpit-stream)) |
| Any, for a display no panel here has announced | `Skipped` |
| `Down`, `Move`, or `Held` | `Done`, once handed to each panel that announced the display |
| `Up` | `Unfinished(handle)`, and `cx.cockpit().applied(handle)` once each of those panels has played it, or its socket has closed or been replaced, or 1s has passed, which also marks the recording |

So the next cockpit message waits for a press's click, as [the cockpit stream](../sync/04-order-and-recovery.md#the-cockpit-stream) requires, and for nothing else of a gesture's.
The 1s bounds what a broken module costs: no later message, state sync's included, waits on its answer for longer.

## Timing

- Live, each message plays as it arrives, its gap already past ([the replay](../sync/04-order-and-recovery.md#the-replay)), so the other display follows the pilot's hand one trip behind.
- In a replay, or queued behind a catch-up, each waits what's left of its gap, capped at 2s.
  A gesture's gaps are the sending core's spacing between its sends, each made as a panel message arrived, so they keep a drag's spacing, the idle time before each `Down`, and a held press's length, which its `Held` messages break into gaps of 1s.
- So the panel bridge measures no span, which settles the spine's item on which clock it measures one on ([left open](../architecture/01-spine.md#left-open)); the apps' stage still settles it for any other page that sends one.
  FS Copilot's panel timed its holds, its paths, and its gaps with `Date.now()` (read in the FS Copilot fork, `pointer.js`, `_onDown` and `_onUp`); our module reads a clock only to space its moves 33ms apart and its `Held` messages 1s apart, and sends no time.
- A gap is the difference between two arrival stamps, so the constant part of how far an arrival trails its page's read cancels, and pointer sync waits on no bound of it, as [flight-model sync](../flight-model/01-flight-model-sync.md#the-cores-counter-in-our-module) has it for every v1 unit.
  Only the trail's jitter moves a replayed move, which we expect to be about a frame (inference: how long a page's message takes is unmeasured, [times](../architecture/01-spine.md#times)).
- A replayed drag keeps its pauses, where FS Copilot's replay cut each gap between two samples to 250ms and so ran up to 12% short (measured offline on recorded drags, 2026-08-30, FS Copilot fork, `build/log.md`, "The drag drift candidate is real but small, and temporal not spatial").

## Locks

The bridge owns every lock, and each is an overlay over one display's rect ([what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns)).
Pointer sync asks for one over a display only once its own pilot's gesture there has ended, so a pilot whose button is down on a display when a lock comes keeps their gesture whole, on their own display and in what they send.

### While another pilot's gesture plays

- The unseen lock paints nothing, so the display takes no press from its own pilot while the other's gesture plays, as FS Copilot's `replayingQuiet` state does: Coherent GT painted it as nothing, and the point at the display's center still hit it (measured on MSFS 2024, 2026-09-18, FS Copilot fork, `build/log.md`, "The replay interlock blocks silently; twelve seconds is where it speaks").
- It holds from the gesture's `Down` to its `Up`, each message renews it, and the bridge drops it on its own 2s after the last renewal, so a module that fails partway blocks nothing for long, as [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) asks of anything in the pilot's input path.
- A press that lands on it is dropped, never queued, and sent nowhere, and the bridge paints the lock while that button is down, in one solid color and with no words, gone at the up (user, 2026-10-17).
  Gone at the up, it reads as the press's own doing; the other pilot's figure at the display already says who's pressing ([avatar sync](../product/03-v1-scope.md#avatar-sync)).
  Its color is for the build, starting from red-orange at about 60% opacity (user, 2026-10-17), kept apart from the warning the bridge shows once the core falls silent.
- FS Copilot painted its replay lock only once blocking had lasted 12s, for a backlog of gestures in its panel (same entry); ours needs no such stage, since the core paces and a panel never holds more than the gesture playing.

### On a machine other than the PF's

- Every synced display on it locks, visibly, while this core's link to the PF is lost, and while its replay or its catch-up runs; the PF's never lock.
- A lost link starts at `LinkLost`, 5s after the PF's connection goes quiet ([moments](../network/02-units.md#moments)), and taking control makes this pilot the PF, which lifts it ([while a link is lost](../network/01-between-machines.md#while-a-link-is-lost)).
  A PF whose sim closes passes control at once ([a sim that closed](../sync/04-order-and-recovery.md#a-sim-that-closed)), and one who leaves passes it first ([leaving](../network/01-between-machines.md#leaving)), so a lost link is the one way this machine loses the PF.
- The replay keeps the displays locked as the cut did, until its clock covers the replay's ([the replay](../sync/04-order-and-recovery.md#the-replay)).
- The catch-up locks them too: this machine skips the crew's gestures while it catches up, so its displays wouldn't follow the crew's, while its pilot's presses would reach theirs.
  At preflight's end that lasts until the catch-up's writes are made, a few seconds (inference).
- Preflight locks nothing: the stream sends no gesture then, and [preflight](../product/03-v1-scope.md#preflight)'s rules have pilots touch nothing.
- The lock says why: a lost link, naming taking control as the way out, as FS Copilot's amber card does, "Take control to keep flying, or wait for the connection to return." (read in the FS Copilot fork, `overlay.js`, `Overlay.STATES`), or catching up.
  Its look and words are [6.16](../architecture/plan.md#616-the-apps)'s.
- Pointer sync registers the lock as a slice of client state, which `clients` builds each round from the session's control, the network's links, and the stream's state ([what a unit registers and calls](../core/02-clients-and-panel-bridge.md#what-a-unit-registers-and-calls)), and the module watches it through `ctx.watch`, so no moment has to say when a replay or a catch-up ends, and a module that starts gets the slice at once.
- Any message from the core renews it, and 8s to 10s after the last one it turns into the bridge's warning, which blocks nothing ([what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns)).

## What pointer sync registers

```rust
// a sketch; the hooks' names follow the platform's units, and the two marked are hypothetical
pub fn register(r: &mut Registry) {
    let me = r.unit::<PointerSync>("pointer-sync");
    me.panel_module("pointer-sync", PointerSync::displays);       // the instruments the profile's displays name
    me.on_panel(PointerSync::captured);                            // hypothetical: a gesture from this machine's panel
    me.cockpit_kind(pointer_sync::GESTURE, PointerSync::play);     // neither held nor collapsed
    me.client_state::<Lock>("pointer-sync", PointerSync::lock);   // none, a lost link, or catching up
    me.on::<PanelReplaced>(PointerSync::replaced);                 // hypothetical names for 6.2's moments
    me.on::<ClientLeft>(PointerSync::left);
}
```

```ts
// a sketch: pointer sync's panel module, built by esbuild at es2017 into pointer-sync.js
CROSSCHECK_BRIDGE_API.define("pointer-sync", {
  start(ctx) {
    for (const display of ctx.instruments) capture(display, ctx);   // the instruments `load` named for this module
    ctx.on("gesture", play);                                       // another pilot's Down, Move, Held, or Up
    ctx.watch("pointer-sync", lockAll);                            // the visible lock
  },
  stop() { /* removes its listeners and timers; the bridge drops its locks */ },
});
```

- The kind neither holds each key's newest message nor collapses in a replay, since every move of a drag plays.
- `ctx.watch` and the unseen lock's lapse and flash are what this design adds to 6.2's [panel modules](../core/02-clients-and-panel-bridge.md#panel-modules), beside sending, receiving, and asking for a lock.

## Known limits

- Two pilots who press one display within one trip of each other each get their own `Down` played first, so the display can end differently on the two machines.
  Outside that trip, the first `Down` locks the display on the other machine before its pilot can press.
  It's rare, since each pilot sees the other's figure reach for the display (user, 2026-10-17), and with the figures hidden nothing warns; pressing a page button again brings both back, since it sits at the same fraction on both (FS Copilot fork, `13-pr-prep.md`, 10).
  This settles [03-v1-scope](../product/03-v1-scope.md#pointer-sync)'s open question on both pilots typing on one display.
- A press does what its pilot meant only where both displays show the same page, as [03-v1-scope](../product/03-v1-scope.md#pointer-sync) says.
- A press in preflight acts on its own display alone.
- A gesture a lapse ended leaves the other display wherever its last message put it, which can differ from where the sender's ended.

## What this changes elsewhere

The notes at the top of [03-v1-scope](../product/03-v1-scope.md), [the code map](../architecture/02-code-map.md), [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md), [04-order-and-recovery](../sync/04-order-and-recovery.md), [the spine](../architecture/01-spine.md), and [flight-model sync](../flight-model/01-flight-model-sync.md) list what this design changes there, and two [tentative decisions](../architecture/decisions.md#pointer-sync-sends-each-gesture-as-it-happens-and-the-panel-bridge-sends-no-span) give the reasons.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures, beside the code map's [budgets for work in the sim](../architecture/02-code-map.md#budgets-for-work-in-the-sim).

| What | Budget |
| --- | --- |
| A gesture's messages | At most about 30 a second while it moves, and one a second while it's held still: about 3 KB/s on a link, at about 100 bytes a cockpit message beside 2.2's 84 for a change ([network log](../network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does); arithmetic) |
| Messages to one panel | About 30 a second through a drag, 6.2's [budget](../core/02-clients-and-panel-bridge.md#budgets) for one panel |
| An up's answer | Within 1s, when the core counts it applied whatever came |
| The unseen lock | Gone within 2s of its gesture's last message |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with two cores, the stand-in sim, and a panel faked from the bridge outward:

- A tap: the other panel gets `mousedown`, `mouseup`, and `click` at the same fractions.
- A 3s drag: its moves reach the other panel while it's made, at most 30 a second, with no `click` at the end.
- A press held still for 5s: its `Held` messages keep the other display's lock, and replayed after a cut it still lasts 5s.
- A switch flipped on hardware while a display press is held: both machines apply it between the down and the up.
- The sending core killed partway through a drag: the other display's lock lapses within 2s of the last move, it gets a `mouseup` on the document, and nothing more of that gesture plays.
- A 10s cut partway through a drag: the other machine ends the gesture 2s after its last move, and the replay skips the rest of it and plays every gesture after it.
- A press on a display under the unseen lock: the flash shows while it's held and goes at the up, the display gets nothing, and nothing is sent.
- The other pilot's `Down` while this pilot's button is down on the display: the lock comes at this pilot's up, and their own `Up` goes out.
- An up the panel never answers: applied after 1s and marked; a module that throws partway through a gesture: its lock gone within 2s.
- A receiving panel that reloads partway through a gesture: the up handed to the old socket counts as applied, and the new panel ignores the rest.
- A `Down` that arrives during catch-up: skipped, and its moves and up after catch-up ends are ignored.
- The PM's link to the PF lost: within 5s every synced display on the PM's machine locks and none on the PF's, taking control lifts it, and after the link returns it holds until the replay ends.
- A late joiner's catch-up: its synced displays lock until it ends.
- A press in preflight: it acts on its own display and is sent nowhere.
- Two displays in one panel document: each gesture goes, and plays, under its own display's key.
- Every event the module dispatches: none is captured or sent back.

In the sim:

- On the 58P's tablet and the A220's ND, a down, moves, and an up dispatched by the module act as the pilot's own press and drag would, and a press held 3s acts as a held press.
- A `mouseup` dispatched on the document ends a held press and a drag on those two displays without acting.
- An unseen lock that a press paints and its up clears, timed as FS Copilot's `replayingQuiet` was.

With friends, on two PCs:

- Whether the two PCs give a display the same rect, which FS Copilot's two-machine session couldn't show, having logged one side's 7410×1110 (FS Copilot fork, `06-open-questions.md`, Q04).
- Whether a drag looks smooth on the other display over a relayed link, and moves with the other pilot's hand.

## Left open

- The look and words of the visible lock, and the flash's color: [6.16](../architecture/plan.md#616-the-apps)'s, and the build's.
