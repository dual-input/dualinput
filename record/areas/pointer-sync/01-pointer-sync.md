# Pointer sync

```text
Purpose:     How a press or drag on a synced display reaches the crew's displays and plays there, and how a display takes no press while it can't sync one.
Depends on:  ../product/03-v1-scope.md, ../architecture/01-spine.md, ../architecture/02-code-map.md, ../architecture/coherent-gt.md, ../core/02-clients-and-panel-bridge.md, ../sync/03-catch-up.md, ../sync/04-order-and-recovery.md, ../sync/05-units.md, ../network/01-between-machines.md, ../network/02-units.md, ../profiles/01-format-and-delivery.md
Decides:     What a gesture sends, and when; how another machine's panel plays it, and when each of its messages counts as applied; how a gesture is timed, and which clock the panel bridge measures a span on; which displays lock, when, and what a pilot's blocked press shows; what pointer sync registers; its known limits; the budgets; and the cases for the bench (node 6.11).
```

> **Note**
> Since 2026-10-18, a mouse-up with no gesture open sends nothing, where [a gesture](#a-gesture) sends it as a down and an up, as FS Copilot's `_onUp` does with no reason given; the receiver already plays nothing for an up with no gesture, and the other display would click where this one didn't, which the case in the sim that [cases for the bench](#cases-for-the-bench) lists checks (user, 2026-10-18).

A gesture is one press or drag on a synced display, an instrument the profile's `displays` names, from a button's down to its up.
It goes to the crew as it happens: its down, its moves, and its up, each a cockpit message keyed by the display.
Each other machine's panel plays each message on its own copy of the display, at the same fractions of the display's size, as it arrives.
While another pilot's gesture plays on a display, that display takes no press from its own pilot, and a press there flashes it until the press's up.
On a machine other than the PF's, every synced display locks while the machine has no link up to the PF, or runs a replay or a catch-up.
The panel bridge measures no span, no duration a message carries: in a replay, the cockpit stream's gaps, on the core's counter, time every gesture.

This answers node 6.11 of the [architecture plan](../architecture/plan.md#611-pointer-sync), and holds only what these leave out: [03-v1-scope](../product/03-v1-scope.md#pointer-sync)'s pointer sync, the code map's [modules in the panel bridge](../architecture/02-code-map.md#modules-in-the-panel-bridge) and [what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns), 6.2's [panel bridge](../core/02-clients-and-panel-bridge.md#the-panel-bridge), [04-order-and-recovery](../sync/04-order-and-recovery.md)'s cockpit stream and replay, 6.9's [kinds](../sync/05-units.md#kinds), and [01-format-and-delivery](../profiles/01-format-and-delivery.md#displays)'s displays.
It carries over the capture and the play of our FS Copilot fork's panel code (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js` and `overlay.js`).

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `pointer-sync` | Feature | The displays each panel here announced, its cockpit kind, each up waiting on its panels, and the visible lock as a slice of client state | Its crate in the core, and the panel module `pointer-sync` in each panel that holds a display |

It depends on the cockpit stream, `clients`, the network, and the session, the last for the PF.
It shows nothing outside the displays, so it has no part in the EFB app or the desktop app, where the code map's [features](../architecture/02-code-map.md#features) gives it both.

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
- It skips every event we dispatched, by a flag of ours and by `isTrusted`, since a synthetic event is never trusted and real cockpit input is: of the 627 events one interaction delivered to the A220's DisplayUnits, 571 were trusted, and the other 56 were the `mouseenter` and `mouseleave` pairs at (0,0) that `VCockpit.js` dispatches (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "Q03 PASSES: a synthetic mouse click drives a React/SVG display").
- `Down` goes at once.
  A `Move` goes at most every 33ms, and only once the pointer has moved 2px since the last point sent, counting the horizontal and vertical distances together, as FS Copilot samples a drag (read in the FS Copilot fork, `pointer.js`, `_onMove`).
  `Held` goes each time 1s passes with nothing else sent, so a press held still keeps its lock on the other machines and its length in a replay.
  `Up` goes at that button's `mouseup`, wherever it lands, with `click` set when the pointer never got 4px from the down, counted the same way, FS Copilot's line between a press and a drag (same file, `_onUp`).
- The next `mousedown` in the document first ends any gesture still open, sending its `Up` with no click, so a release the panel never heard ends no later than the pilot's next press.
  A `mouseup` inside a display with no gesture open goes as a `Down` and an `Up` at its point, as FS Copilot sends such an up as a press (same function).
- Each goes to the core as a `unit` message with the display's key, and the core sends it on the cockpit stream under that key.
  The stream sends none before preflight ends or while this member is out of the flight ([sending](../sync/05-units.md#sending)), so a press then acts on its own display alone.
- A gesture has no cap: a long press plays for as long as it's held, and a drag sends as many moves as it takes, where FS Copilot capped a hold at 1.5s and a drag at 240 points (same file, `_onUp` and `DRAG_MAX_POINTS`).

FS Copilot sends a gesture whole at its release, and its record rejects live streaming for "More packets, more reordering risk, and no proven benefit", naming no mechanism (FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, 4.7).
The cockpit stream carries every message in one causal order, and a drag's messages run at 6.2's budget for one panel ([budgets](#budgets)).
Sent whole, a gesture would reach the other display only after its release, a map pan its whole length late, while avatars' hand follows the drag as it's made, from at most one mouse move every 16ms while the left button is held ([raw input](../core/04-core-helper.md#raw-input)).
It would also put a switch flipped on hardware during a held press ahead of the whole press, where streamed it lands between the down and the up, as it happened.

## Playing a gesture

On each other machine, the core hands each message to the module of every panel there that announced the display, as FS Copilot routes a press to every document that announced its key (FS Copilot fork, `13-pr-prep.md`, 0.4), and the module plays it:

- **`Down`:** it finds the target under the point with the bridge's hit test, which looks past our overlays ([what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns)), dispatches `mousedown` with the button, and asks the bridge for an unseen lock over the display ([locks](#locks)).
  The hit test sets the overlay's `pointer-events` to `none` around `elementFromPoint`, as FS Copilot's does, assuming the engine applies the style at once, which FS Copilot never checked in the sim (read in the FS Copilot fork, `overlay.js`, `hitTest`); a case in the sim settles it.
  With nothing under the point, the gesture plays nothing.
- **`Move`:** `mousemove` at whatever lies under the point, or at the down's target where nothing does.
- **`Held`:** it renews the lock.
- **`Up`:** `mouseup` at whatever lies under the point, or at the down's target, then `click` at the same target when `click` is set; it releases the lock and tells the core it's done with the up.
- Each event is a `MouseEvent` with the fields FS Copilot's `_fire` sets, since Coherent GT has no `PointerEvent` ([coherent-gt](../architecture/coherent-gt.md#web-apis)); a synthetic sequence at a peer's fractions drove the A220's ND to plan mode, and replayed drags worked (measured on MSFS 2024, 2026-09-17 and 2026-08-30, FS Copilot fork, `build/log.md`, "A peer's press drove the real A220 ND, opted in by identifier alone" and "Drag works. Tier 3 is real, with a drift caveat").
- One gesture plays on a display at a time, and a `Down` for a display with a gesture still playing ends that gesture first, as a lapse does.
- When a playing gesture's lock lapses, 2s after its last message ([locks](#locks)), the module ends the gesture with a `mouseup` dispatched on the document and no click.
  A `mouseup` on the document lands on no control, so a display's own drag or hold should end without acting (unverified; a case in the sim).
  If more of that gesture comes later, late over a path that stalled or in a replay after a cut, the module starts it again with a `mousedown` at its point and plays on, so a tap whose up came late still clicks.
- A `Move` or `Held` for a display with no gesture playing or lapsed is ignored, as when its `Down` came while a catch-up skipped it, or before its panel announced itself; such an `Up` plays nothing and tells the core it's done.

The core's handler for the kind answers each message as the stream asks ([kinds](../sync/05-units.md#kinds)):

| A message | The handler answers |
| --- | --- |
| Any, while a catch-up runs here that preflight's end didn't start | `Skipped`, as [the cockpit stream](../sync/04-order-and-recovery.md#the-cockpit-stream) skips a press then |
| Any, for a display no panel here has announced | `Skipped` |
| `Down`, `Move`, or `Held` | `Done`, once handed to each panel that announced the display |
| `Up` | `Unfinished(handle)`, and `cx.cockpit().applied(handle)` once each of those panels is done with it or its socket has closed or been replaced, or after 1s, the one case that marks the recording |

- The catch-up at preflight's end skips no gesture, since neither cockpit's displays were touched in preflight ([preflight](../product/03-v1-scope.md#preflight)): what the PF presses in its first seconds queues behind the catch-up's writes and plays once they're made ([catch-up](../sync/05-units.md#catch-up)).
  Any other catch-up, a late joiner's, a rejoiner's, or an ex-PF's, skips gestures, since its displays may show other pages than the ones they were made on.
- So of a gesture's messages, only its up holds back the cockpit messages of other kinds and displays after it, until its click has played, as [the cockpit stream](../sync/04-order-and-recovery.md#the-cockpit-stream) requires.
  The 1s bounds what a broken module costs: no later message, state sync's included, waits on it for longer.

## Timing

- Each message waits what's left of its gap, as every cockpit message does ([the replay](../sync/04-order-and-recovery.md#the-replay)), so live it plays as it arrives, one trip behind the pilot's hand.
- The core makes each send as the panel's message arrives, so a gesture's gaps keep a drag's spacing, a held press's length in its `Held` messages' 1s gaps, and the pause before each `Down`, up to the 2s cap.
- So the panel bridge sends no span, which settles the spine's item on which clock it measures one on ([left open](../architecture/01-spine.md#left-open)); the apps' stage still settles it for any other page that sends one.
  FS Copilot's panel timed its holds, its paths, and its gaps with `Date.now()` (read in the FS Copilot fork, `pointer.js`, `_onDown` and `_onUp`); our module reads a clock only to space what it sends.
- Each gap is the difference between two of the core's arrival stamps, so a constant delay between the panel's event and the core's stamp cancels, and only that delay's jitter moves a replayed move, which we expect to be about a frame (inference: how long a page's message takes is unmeasured, [times](../architecture/01-spine.md#times)).
- A replayed drag keeps its pauses, where FS Copilot's replay cut each gap between two samples to 250ms and so ran up to 12% short (measured offline on recorded drags, 2026-08-30, FS Copilot fork, `build/log.md`, "The drag drift candidate is real but small, and temporal not spatial").

## Locks

The bridge owns every lock, and each is an overlay over one display's rect ([what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns)).
Pointer sync asks for one over a display only once its own pilot's gesture there has ended, so a pilot whose button is down on a display when a lock comes keeps their gesture whole, on their own display and in what they send.
A lock that a blocked press is held on stays until that press's up, so a release over a control behind it never acts on the display unsent.

### While another pilot's gesture plays

- The unseen lock is an overlay that paints nothing and takes every press, so the display gets no press from its own pilot while the other's gesture plays, as FS Copilot's `replayingQuiet` state does: Coherent GT painted it as nothing, and `elementFromPoint` at the display's center returned the overlay (measured on MSFS 2024, 2026-09-18, FS Copilot fork, `build/log.md`, "The replay interlock blocks silently; twelve seconds is where it speaks").
  That a pilot's real press lands on it is unverified, and a case in the sim settles it.
- It holds from the gesture's `Down` to its `Up`, and the module renews it at each of the gesture's messages; no message from the core renews it, and the bridge drops it on its own 2s after the module last did, so a module that fails partway blocks nothing for long, as [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) asks of anything in the pilot's input path.
- A press that lands on it reaches neither the display nor the crew ([a gesture](#a-gesture)), and while that button is down the bridge shows the flash: the lock painted in one solid color, with no words, until the up (user, 2026-10-17).
  Ending at the up, the flash reads as the press's own doing, and the other pilot's figure at the display already says who's pressing ([avatar sync](../product/03-v1-scope.md#avatar-sync)).
  Its color starts at red-orange, about 60% opacity (user, 2026-10-17), apart from the warning the bridge shows once the core falls silent.
- FS Copilot painted its replay lock only once blocking had lasted 12s, for a backlog of gestures in its panel (same entry); ours needs no such stage, since the core paces and a panel never holds more than the gesture playing.

### On a machine other than the PF's

- Every synced display on it locks, visibly, while this core has no link up to the PF, and while its [replay](../sync/04-order-and-recovery.md#the-replay) or its catch-up runs; the PF's never lock.
- A lost link starts at `LinkLost`, 5s after the PF's connection goes quiet ([moments](../network/02-units.md#moments)), and a PF whose Leave closed the connection before their handover reached this core leaves no link up either ([leaving](../network/01-between-machines.md#leaving)).
  Taking control makes this pilot the PF, which lifts the lock ([while a link is lost](../network/01-between-machines.md#while-a-link-is-lost)).
  A PF whose sim closes passes control at once ([a sim that closed](../sync/04-order-and-recovery.md#a-sim-that-closed)).
- A catch-up locks them too, until it ends ([catch-up](../sync/04-order-and-recovery.md#catch-up)), since without the lock its pilot's presses would reach the crew's displays while a catch-up other than preflight's skips theirs.
  At preflight's end that lasts until the catch-up's writes are made and the aircraft has settled, a few seconds, since Ready waits for the aircraft to settle (inference).
- Preflight locks nothing: the stream sends no gesture then, and [preflight](../product/03-v1-scope.md#preflight)'s rules have pilots touch nothing.
- The lock says why: no link to the PF, naming taking control as the way out, as FS Copilot's amber card does, "Take control to keep flying, or wait for the connection to return." (read in the FS Copilot fork, `overlay.js`, `Overlay.STATES`), or catching up.
- Pointer sync registers the lock as a slice of client state, which `clients` builds each round from the session's control, the network's links, and the stream's state ([what a unit registers and calls](../core/02-clients-and-panel-bridge.md#what-a-unit-registers-and-calls)).
  The module watches it through `ctx.watch`, so no moment has to say when a replay or a catch-up ends.

## What pointer sync registers

```rust
// a sketch; the hooks' names follow the platform's units, and the two marked are hypothetical
pub fn register(r: &mut Registry) {
    let me = r.unit::<PointerSync>("pointer-sync");
    me.panel_module("pointer-sync", PointerSync::displays);       // the instruments the profile's displays name
    me.on_panel(PointerSync::captured);                            // hypothetical: a gesture from this machine's panel
    me.cockpit_kind(pointer_sync::GESTURE, PointerSync::play);
    me.client_state::<Lock>("pointer-sync", PointerSync::lock);   // none, no link to the PF, or catching up
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
- The handler reads from the stream's state whether preflight's end started the catch-up that runs.

## Known limits

- Two pilots who press one display within one trip of each other each see their own press act first, so the display can end differently on the two machines.
  Outside that trip, the first `Down` locks the display on the other machine before its pilot can press.
  It's rare, since each pilot sees the other's figure reach for the display (user, 2026-10-17), though with the figures hidden nothing warns.
  Pressing the page button again puts both displays on one page, since the button sits at the same fraction on both (FS Copilot fork, `13-pr-prep.md`, 10).
  This settles [03-v1-scope](../product/03-v1-scope.md#pointer-sync)'s open question on both pilots typing on one display.
- A lock covers a whole instrument, so on an instrument that draws several displays, a gesture on one blocks presses on all of them on the other machine while it plays: the A220's one DisplayUnits document holds its five display units (FS Copilot fork, `build/log.md`, "Q03 PASSES: a synthetic mouse click drives a React/SVG display").
- FS Copilot's replayed drags sometimes drifted visibly, which it never diagnosed (same log, "Drag works. Tier 3 is real, with a drift caveat"); keeping a drag's pauses removes only the temporal part it measured.
- A gesture whose rest never arrives after a lapse leaves the other display wherever its last message put it.

## What this changes elsewhere

The text or the notes at the top of [03-v1-scope](../product/03-v1-scope.md), [the code map](../architecture/02-code-map.md), [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md), [03-catch-up](../sync/03-catch-up.md), [04-order-and-recovery](../sync/04-order-and-recovery.md), [05-units](../sync/05-units.md), [the spine](../architecture/01-spine.md), and [flight-model sync](../flight-model/01-flight-model-sync.md) list what this design changes there, and two [tentative decisions](../architecture/decisions.md#pointer-sync-sends-each-gesture-as-it-happens-and-the-panel-bridge-sends-no-span) give the reasons and change [decision 042](../../decisions/042-vector-clock-records-what-applied.md).

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures, beside the code map's [budgets for work in the sim](../architecture/02-code-map.md#budgets-for-work-in-the-sim).

| What | Budget |
| --- | --- |
| A gesture's messages | About 30 a second while it moves, and one a second while it's held still: about 3 KB/s of messages before packet headers, an estimate at about 100 bytes each beside 2.2's 84 for a cockpit change ([network log](../network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does)) |
| Messages to one panel | About 30 a second through a drag, at the ceiling of 6.2's [budget](../core/02-clients-and-panel-bridge.md#budgets) of under 30 for one panel |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with two cores, the stand-in sim, and a panel faked from the bridge outward:

- A tap: the other panel gets `mousedown`, `mouseup`, and `click` at the same fractions.
- A 3s drag: its moves reach the other panel while it's made, about 30 a second, with no `click` at the end.
- A press held still for 5s: its `Held` messages keep the other display's lock, and replayed after a cut it still lasts 5s.
- A switch flipped on hardware while a display press is held: both machines apply it between the down and the up.
- The sending core killed partway through a drag: the other display's lock lapses within 2s of the last move, it gets a `mouseup` on the document, and nothing more of that gesture plays.
- A tap whose up arrives 2.5s after its down, as through the move to the relay: the gesture lapses, starts again at the up, and clicks.
- A 10s cut partway through a drag: the other machine ends the gesture 2s after its last move, and the replay starts it again from its next move and plays every gesture after it.
- A press on a display under the unseen lock: the flash shows while it's held and goes at the up, the display gets nothing, nothing is sent, and a lock whose gesture ends meanwhile stays until that up.
- The other pilot's `Down` while this pilot's button is down on the display: the lock comes at this pilot's up, and their own `Up` goes out.
- An `Up` for a display with no gesture playing: answered at once, with no wait and no mark; an up the panel never answers: applied after 1s and marked; a module that throws partway through a gesture: its lock gone within 2s.
- A receiving panel that reloads partway through a gesture: the up handed to the old socket counts as applied, and the new panel ignores the rest.
- A `Down` that arrives during a late joiner's catch-up: skipped, and its moves and up after the catch-up ends are ignored; a PF's press in the first second after preflight's end: it plays on the PM's display once the catch-up's writes are made.
- The PM's link to the PF lost: within 5s every synced display on the PM's machine locks and none on the PF's, taking control lifts it, and after the link returns it holds until the replay ends.
- A PF's Leave whose close reaches the PM before the handover: the PM's displays lock until the PM takes control.
- A late joiner's catch-up: its synced displays lock until it ends.
- A press in preflight: it acts on its own display and is sent nowhere.
- Two displays in one panel document: each gesture goes, and plays, under its own display's key.
- A `mousedown` while a gesture is open in the same document: the open one goes out with an `Up` and no click first.
- Every event the module dispatches: none is captured or sent back.

In the sim:

- On the 58P's tablet and the A220's ND, a down, moves, and an up dispatched by the module act as the pilot's own press and drag would, and a press held 3s acts as a held press.
- A `mousemove` and a `mouseup` played under the unseen lock reach the display's controls, so the hit test sees past the overlay.
- A real press on a display under the unseen lock reaches nothing, and the flash paints at that press and clears at its up.
- A `mouseup` dispatched on the document ends a held press and a drag on those two displays without acting.
- A press released off the display, and one begun off it and released on it: what the panel's document hears of each, and what goes out.

With friends, on two PCs:

- Whether the two PCs give a display the same rect: FS Copilot's two-machine session logged 7410×1110 on one side, and its peers' logs were never read (FS Copilot fork, `13-pr-prep.md`, 4.4 and 14).
- Whether a drag looks smooth on the other display over a relayed link, and moves with the other pilot's hand.

## Left open

- The look and words of the visible lock, and the flash's color: [6.16](../architecture/plan.md#616-the-apps)'s, and the build's.
