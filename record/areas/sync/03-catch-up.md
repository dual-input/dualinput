# Sync: catch-up

```text
Purpose:     How a cockpit that missed changes, or never had them, comes to the flying machine's state.
Depends on:  01-profile-entries.md, 02-live-sync.md, ../product/03-v1-scope.md (preflight, the connection)
Decides:     Which catch-up runs when, the order state applies in, what happens while catch-up runs, and when a freshly loaded aircraft counts as settled.
```

> **Note**
> Since 2026-10-11, a pilot cut off for up to 30 minutes whose sim kept running comes back to a replay, where [replaying a short outage](#replaying-a-short-outage) below sizes one for 5 minutes; the replay keeps the rule below, which bounds it at 2s a change, and skips all but the last of each run of PF-owned changes, which is all the shortening it needs ([04-order-and-recovery](../sync/04-order-and-recovery.md#the-replay)).
> Control no longer passes when the PF's connection drops, so a PM's catch-up doesn't stop for it, as [while catch-up runs](#while-catch-up-runs) below says; a catch-up cut off by a lost link starts again on the new connection ([01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)).
> Since 2026-10-11, catch-up writes each entry in the order the flying machine's cockpit first took its value, which settles [choosing the order](#choosing-the-order); v1's catch-up pipeline has the one step, catching up state; the catching-up machine takes the catch-up's vector clock for every counter but its own, so a queued message the state already holds drops as a copy; control can't pass to a pilot until their own catch-up ends; and a sim that closed comes back by catch-up, never by replay, a sim crash included, and so does a core that crashed ([04-order-and-recovery](../sync/04-order-and-recovery.md#catch-up)).
> Since 2026-10-12, whether catch-up's writes are retried, and whether a write function runs again when an entry it read lands, as steps 4 and 5 in [catching up state](#catching-up-state) say, stay open for sync's stage of step 8, which starts from one attempt per write and one run of a function per value; a write right behind the battery switch, before the bus has power, is among the cases it tests, and that such a write fails at all is unmeasured ([01-format-and-delivery](../profiles/01-format-and-delivery.md#checking-a-write)).
> [04-order-and-recovery](../sync/04-order-and-recovery.md#catch-up) also changes this document in six places:
>
> - An ex-PF catches up state from the new PF when a change of control drops a message they had applied, a third row for [which catch-up runs when](#which-catch-up-runs-when) ([a change of control](../sync/04-order-and-recovery.md#a-change-of-control)).
> - A catch-up ends once it has made its last write and its aircraft has settled, whichever comes later, where [while catch-up runs](#while-catch-up-runs) below ends it when the aircraft has settled.
> - The core reads an input event's value once when it starts watching it, since subscribing reports nothing until the value changes, so step 2 of [catching up state](#catching-up-state) can tell whether that entry matches.
> - What queues while catch-up runs applies on top paced as every cockpit message is, each waiting only what's left of the gap its sender left before it, capped at 2s ([the replay](../sync/04-order-and-recovery.md#the-replay)).
> - When a session starts, or its profile loads, after Ready to fly, [settling after a load](#settling-after-a-load)'s 30s floor still counts from Ready to fly, and its 15s quiet window from the profile's load ([an aircraft that loaded before its session](../sync/04-order-and-recovery.md#an-aircraft-that-loaded-before-its-session)).
> - An entry that changes more than 5 times since the load just leaves the quiet check for that load; "driven by the aircraft" means only 04-order-and-recovery's test, which stops an entry syncing ([entries the aircraft drives itself](../sync/04-order-and-recovery.md#entries-the-aircraft-drives-itself)).
>
> Since 2026-10-16, [the sync units](05-units.md#catch-up) has the catching-up machine ask the flying machine for its catch-up: whenever its profile loads after preflight has ended, which covers a late joiner, a pilot back after a sim restart, and a profile that loaded late; when preflight ends with its profile loaded; and again when control passes during it ([which catch-up runs when](#which-catch-up-runs-when)).
> Step 4 of [catching up state](#catching-up-state) runs a write function once, never again when an entry it read lands ([write functions](05-units.md#write-functions)); what queued during a catch-up applies once its writes are made; and [what the open questions still hold](05-units.md#what-the-open-questions-still-hold) answers [open questions](#open-questions).

A cockpit catches up in one of two ways.
After a short outage with the sim still running, it replays the changes it missed, in order.
After a late join, a sim restart, or the end of preflight, it takes the flying machine's state as it stands, applies each entry once in an order step 7 decides, checks every write, and flags what never matches.
Events and pointer presses from before a catch-up began aren't recovered, so after a late join or a restart, a display's page, an FMS's contents, and anything else the profile can't read can differ.

The flying machine is the PF's, and a following machine is any other pilot's.

## Which catch-up runs when

| Situation | Catch-up |
| --- | --- |
| A short outage, with the sim still running | Replay the stream since the drop: state changes, events, and pointer presses, in order |
| Preflight ends, a pilot joins late, or a pilot rejoins after a sim restart | Catch up state, below |

The replay needs only what was sent since the drop, up to the cut-off that ends a pilot's session ([the connection](../product/03-v1-scope.md#the-connection)), because a pilot cut off for longer comes back as a late joiner.

## Replaying a short outage

The replay keeps the PF's spacing between changes, with each gap cut to at most 2s.

Replayed back to back, a sequence that needs time between its steps breaks.
Say the PF pressed a key that opens a display page, then pressed a button on that page a second later: with no gap, the second press lands before the page has drawn.
Replayed at the PF's real spacing, a 5-minute outage takes 5 minutes to replay, while the following machine's position stays live.
With gaps capped at 2s, an outage with 30 changes replays in about a minute at most, and each step keeps up to 2s of the time the PF gave it.
A follow-up further apart than that, such as an APU bleed opened a minute after the APU start, still replays too early, and the bleed fails: that's the cost of a replay that ends within about a minute.
The 2s is a starting value, to tune once we've watched a real outage replay.

Our FS Copilot fork's pointer sync did the same for presses: it resent what it held in sequence order, kept each press's idle time before it, `GapMs`, capped at 1s, so "a panel that loads a page after a click gets the time the pilot gave it", and dropped what the receiver had already applied (documented in the FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`).
Crosscheck's replay does the same for every kind of change, with the longer cap, because a cockpit's follow-up can come later than a display's.

## Catching up state

1. The flying machine sends its state object as it stands.
2. The catching-up machine skips every entry its cockpit already matches, and every watch-only entry, which it only compares.
3. It applies each remaining entry once, at the PF's value, in the order [below](#choosing-the-order).
   Entries the PF never changed since the aircraft loaded go first.
   Immediate writes go out in that order in one short burst, and stepped writes start in that order and run side by side, since each moves a different control.
   Of two writes to one variable sent in one frame, the second won on every try on six studied aircraft, so SimConnect keeps the order of writes to one variable (measured on MSFS 2024, 2026-10-05, [sync log](log.md#2026-10-05-two-writes-in-one-frame-land-in-the-order-sent-and-a-write-shows-within-2-frames)).
   Whether an aircraft's code sees writes to two different entries in the order sent, which is what an interlock turns on, is untested.
   For a shadow value, the catching-up machine steps the control by the difference between the PF's shadow and its own, and its own shadow counts those steps as they land.
4. A write function runs again when an entry it read lands, so a transponder function that skipped while the battery was off runs once the battery is on.
5. It checks every write, retries what doesn't match, and flags what never does, as live sync does ([02-live-sync](02-live-sync.md#checking-that-a-write-landed)).

Applying each entry once, at its final value, keeps the catching-up machine from running the PF's history: an APU the PF started, stopped, and started again starts once.

Catching up state is one step of catch-up, and an aircraft's [plugin](../product/03-v1-scope.md#plugins) can add steps after it, such as one that sends the A220's `A22X.Resync` for its full state ([04-room-for-later](../product/04-room-for-later.md#a-catch-up-pipeline)).

## Choosing the order

The order matters for an interlock: a control that acts once, when it's set, and only if another control is already set.
Take a hypothetical aircraft whose APU master, written before the battery, tries to start the APU, fails, and leaves the switch reading on: the check finds no mismatch to retry, and the APU stays off.
Which real aircraft behave like this is unverified, and one probe on an aircraft with an APU would show it.

Two orders were weighed, and we lean toward the second; the architecture decides between them at step 7 of [the plan](../product/plan.md):

- **The order the PF last changed each entry**, which the stamps from [the conflict rule](02-live-sync.md#when-two-pilots-change-one-entry) already record, so it needs nothing more.
- **The order each entry first took the value it holds now**, which needs the session's history, kept in the recording.

Say the PF turned the battery on, then the APU master, then cycled the battery off and on.
Both end on, and the battery's last change came after the APU's, so last-change order writes the APU master first, while the catching-up machine's battery is still off, and on the hypothetical aircraft the APU stays off with nothing flagged.
The battery first took "on" before the APU did, so first-final-value order writes the battery first, and the APU starts.

For a write that reads back wrong without power, such as a radio frequency, the two orders end the same way, because a retry lands it once the battery is on.
If the PF's battery ends off, both orders skip it on a catching-up aircraft that loaded cold and dark, so writes that need power fail on every retry, and Crosscheck flags them.

## When preflight ends

When the countdown ends, every other pilot's cockpit catches up state from the PF's, so pilots don't need matching cockpits to start.

- Pilots other than the PF touch nothing in the cockpit during preflight, as [preflight](../product/03-v1-scope.md#preflight)'s rules say, because catch-up sets only what the profile holds.
- The PF works through a checklist of every `default` in the profile and touches nothing else, because each shadow value is right only if the PF's aircraft starts at its default ([01-profile-entries](01-profile-entries.md#keeping-a-shadow-value)).
- A pilot's Ready is unavailable until their aircraft has settled ([below](#settling-after-a-load)), because a following machine's aircraft still restoring its saved state when the countdown ends would send its restored values as changes, right after the catch-up, and override the PF's.

## While catch-up runs

A late joiner's or a rejoining pilot's catch-up starts as soon as they're in a flight, and lasts until their aircraft has settled ([below](#settling-after-a-load)).

- The catching-up pilot's own changes aren't sent, and Crosscheck moves them back toward the PF's state, which also undoes the aircraft restoring its saved state.
  The banner says "Catching up...", and tells the pilot that switches they move now will be reset.
- Changes the other pilots make while catch-up runs, state and events alike, queue, and replay in stream order on top of the catch-up.
  So if a pilot presses a state control, then an event control, then another state control, the event still applies between the two.
- Pointer presses that arrive while catch-up runs are dropped, because the displays never showed the state those presses were made on.
  Our fork's pointer sync follows a similar rule for a new session, "recovery replays, first contact does not" (documented in the FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, R04), and drops a press for a display that hasn't announced itself (documented in the FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`).
- When the PF's connection drops and the PM is catching up, their catch-up stops first ([the take-control key](../product/03-v1-scope.md#take-control-key)).

## Settling after a load

An aircraft that has just loaded goes on changing its own controls for a while.
"Load" here is the moment the pilot clicks Ready to fly, not Fly, the world map's button that starts the loading.
The MSFS 2024 SDK documents that the sim saves the 40 `L:` variables in the Baron's `systems.cfg [LocalVars]` to a `state.cfg` file when a flight exits, and sets them from it the next time the aircraft is used ([systems.cfg](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/CFG_Files/systems_cfg.htm)).
Developers reported it failing on some MSFS 2024 builds, and Asobo said on 2026-02-26 that it would investigate (unverified, [Persistent Local Vars not working on MSFS2024?](https://devsupport.flightsimulator.com/t/persistent-local-vars-localvars-in-system-cfg-not-working-on-msfs2024/17492)).
The Baron's code finishes restoring its settings about 25s after its timers start (read in bksq-aircraft-baronpro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md), sim question 2), and in the sim its last switch changed 20s to 23s after Fly, 1.9s to 6.4s after Ready to fly (measured on MSFS 2024, 2026-10-05, [sync log](log.md#2026-10-05-every-aircraft-restores-its-switches-within-15s-of-ready-to-fly-and-settling-timed-from-fly-misleads)).

A restore that lands after catch-up looks like the pilot changing those controls.

The sim marks Ready to fly with the flow event `SIMCONNECT_FLOW_EVENT_RTC_END` (documented in the MSFS 2024 SDK's `SimConnect.h`), sent to a client subscribed with [SimConnect_SubscribeToFlowEvent](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_SubscribeToFlowEvent.htm).
Our client got it as the button was clicked, by the pilot or by Flow Pro, and again for each load when a flight loaded twice, so the last one marks the load the pilot flies (measured on MSFS 2024, 2026-10-05, [sync log](log.md#2026-10-05-every-aircraft-restores-its-switches-within-15s-of-ready-to-fly-and-settling-timed-from-fly-misleads)).
Counted from Fly, the rule can run out behind the loading screen, where nothing changes: the A350's second load took 67s from Fly to Ready to fly, so the rule called it settled 37s before Ready, with 354 values still to change (same log entry).

So an aircraft counts as settled at whichever comes first:

- 15s with no change to any state entry, counted from 15s after load, so 30s after load at the earliest
- 1.5 minutes after load, in which case the recording notes that the aircraft never went quiet

Only `state:` entries count, so gauges, timers, and animations never hold it up.
An entry that changes more than 5 times since the load is one the aircraft drives itself, such as a knob that recenters or a light that blinks, and it leaves the quiet check for that load.

A quiet window detects a pause, not a finish.
fsc-editor's rule for knowing when an aircraft's variables had all appeared waited for two equal scans of the sim's `L:` name table.
After a cold-and-dark load of an A2A aircraft, it stopped when the table held 3,963 of the 5,343 names it later held, 74%.
The aircraft registered the 1,380 missing cockpit variables in bursts with pauses between, and a duplicate aircraft-loaded event had also made two scans equal by construction (measured on MSFS 2024, 2026-08-24, fsc-editor, `docs/sim-vars/build/v1-log.md`, "Re-enumeration stops on a pause, not on a finished table").
A Bonanza's last 3 of its 88 variables appeared 35s after load, 18s after the burst before (measured on MSFS 2024, 2026-08-27, same log, "The settle rule did not fail here, and one aircraft was two").
Those are variables appearing, not restored values changing.
Restored values didn't pause that long: on six studied aircraft, loaded from the menu, the switches made their last change 1.6s to 12.1s after Ready to fly, so the rule called every aircraft's switches settled at its 30s floor (measured on MSFS 2024, 2026-10-05, [sync log](log.md#2026-10-05-every-aircraft-restores-its-switches-within-15s-of-ready-to-fly-and-settling-timed-from-fly-misleads)).
The only aircraft state that changed after the rule's verdict was the Fenix's ground power and its door locks: each flipped 10s to 22s after Ready to fly and flipped back 46s to 54s after it, so only the return came after the verdict (same log entry).
A restore that does come after a window closes syncs like a pilot's change: it carries the newest stamp, wins, and moves that control in every cockpit, the PF's included, and the check can't catch it, because it isn't a mismatch.
That's the trade we chose (user, 2026-10-04): a fast join every time, with an occasional control moving on its own soon after a rejoin, over a slow join every time.
If it proves common, the fallback is a longer quiet window for late joins only, where the risk is.

## Considered and dropped

- **Replaying the whole session for a late joiner.**
  Every machine keeps the recording anyway, and replaying it is the one way to rebuild state the profile can't read, but it fails more often than it helps:
  - Speeding it up breaks anything that takes time, such as an APU spooling up, an inertial alignment, or an engine start, and replaying in real time takes as long as the flight.
  - The result depends on what the recording doesn't hold, such as position, time, weather, random failures, and the navigation database.
    The A220 holds a Navigraph database at AIRAC 2609 in its work folder and a bundled one at 2503 in its package, and which one the FMS uses is unverified (read in synaptic-aircraft-a220 1.0.10, [A220 study](../aircraft/synaptic-a220/study.md)), so two machines with different work folders could type the same route into different databases.
  - The replay would have to start where the recording started, at the departure stand, then move the aircraft to the PF's position, which is the long-distance move [preflight](../product/03-v1-scope.md#preflight) asks pilots to avoid.
  - Replaying each change runs the aircraft's systems through the PF's whole history.

Replaying only the presses made while parked, for state that's mostly deterministic, such as typing a route into an FMS, stays a possible experiment for one aircraft.

## Open questions

- Whether the rule's 30s floor can come down, since every studied aircraft's switches were done within 15s of Ready to fly, and whether 5 changes tells a restore from an aircraft driving a control.
- Which [order](#choosing-the-order) catch-up applies state in, decided at step 7, and whether any studied aircraft has an interlock that fails while reading back right, which would settle it for first-final-value order.
