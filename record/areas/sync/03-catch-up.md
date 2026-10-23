# Sync: catch-up

```text
Purpose:     How a cockpit that missed changes, or never had them, comes to the flying machine's state.
Depends on:  01-profile-entries.md, 02-live-sync.md, ../product/03-v1-scope.md (preflight, the connection)
Decides:     Which catch-up runs when, the order state applies in, what happens while catch-up runs, and when a freshly loaded aircraft counts as settled.
```

A cockpit catches up in one of two ways.
After a link cut for up to 30 minutes, with the sim still running, it replays the changes it missed, in order.
After a late join, a sim or core that went down, or the end of preflight, it takes the flying machine's state as it stands, applies each entry once in the order the flying machine's cockpit first took its value, checks every write, and flags what never matches.
Events and pointer presses from before a catch-up began aren't recovered, so after a late join or a restart, a display's page, an FMS's contents, and anything else the profile can't read can differ.

The flying machine is the PF's, and a following machine is any other pilot's.

## Which catch-up runs when

| Situation | Catch-up |
| --- | --- |
| A link cut for up to 30 minutes, with the sim still running | Replay the stream since the drop: state changes, events, and pointer presses, in order |
| Preflight ends, a pilot joins late, or a pilot comes back after their sim closed or crashed, or their core crashed ([04-order-and-recovery](04-order-and-recovery.md#catch-up)) | Catch up state, below |
| A change of control drops a message an ex-PF had applied ([a change of control](04-order-and-recovery.md#a-change-of-control)) | The ex-PF catches up state from the new PF |

The replay needs only what was sent since the drop, up to the cut-off that ends a pilot's session ([the connection](../product/03-v1-scope.md#the-connection)), because a pilot cut off for longer comes back as a late joiner.

The catching-up machine asks the flying machine for its catch-up ([catch-up](05-units.md#catch-up)):

- whenever its profile loads after preflight has ended, which covers a late joiner, a pilot back after a sim restart, and a profile that loaded late;
- when preflight ends with its profile loaded;
- and again when control passes during it.

## Replaying a short outage

The replay keeps the PF's spacing between changes, with each gap cut to at most 2s, and skips all but the last of each run of PF-owned changes ([04-order-and-recovery](04-order-and-recovery.md#the-replay)).

Replayed back to back, a sequence that needs time between its steps breaks.
Say the PF pressed a key that opens a display page, then pressed a button on that page a second later: with no gap, the second press lands before the page has drawn.
Replayed at the PF's real spacing, a 5-minute outage takes 5 minutes to replay, while the following machine's position stays live.
With gaps capped at 2s, a replay lasts at most 2s for each change it carries: an outage with 30 changes replays in about a minute at most, and each step keeps up to 2s of the time the PF gave it.
Skipping all but the last of each run of PF-owned changes is all the shortening a replay needs.
A follow-up further apart than 2s, such as an APU bleed opened a minute after the APU start, still replays too early, and the bleed fails: that's the cost of the cap.
The 2s is a starting value, to tune once we've watched a real outage replay.

Our FS Copilot fork's pointer sync did the same for presses: it resent what it held in sequence order, kept each press's idle time before it, `GapMs`, capped at 1s, so "a panel that loads a page after a click gets the time the pilot gave it", and dropped what the receiver had already applied (documented in the FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`).
Dual Input's replay does the same for every kind of change, with the longer cap, because a cockpit's follow-up can come later than a display's.

## Catching up state

1. The flying machine sends its state object as it stands.
2. The catching-up machine skips every entry its cockpit already matches, and every watch-only entry, which it only compares.
   The core reads an input event's value once when it starts watching it, since subscribing reports nothing until the value changes, so this step can tell whether that entry matches ([04-order-and-recovery](04-order-and-recovery.md#catch-up)).
3. It applies each remaining entry once, at the PF's value, in the order [below](#choosing-the-order).
   Entries the PF never changed since the aircraft loaded go first.
   Immediate writes go out in that order in one short burst, and stepped writes start in that order and run side by side, since each moves a different control.
   Of two writes to one variable sent in one frame, the second won on every try on six studied aircraft, so SimConnect keeps the order of writes to one variable (measured on MSFS 2024, 2026-10-05, [sync log](log.md#2026-10-05-two-writes-in-one-frame-land-in-the-order-sent-and-a-write-shows-within-2-frames)).
   Whether an aircraft's code sees writes to two different entries in the order sent, which is what an interlock turns on, is untested.
   For a shadow value, the catching-up machine steps the control by the difference between the PF's shadow and its own, and its own shadow counts those steps as they land.
4. A write function runs once, and never again when an entry it read lands ([write functions](05-units.md#write-functions)).
5. It checks every write, giving each one attempt, and flags what never matches, as live sync does ([02-live-sync](02-live-sync.md#checking-that-a-write-landed)).

Applying each entry once, at its final value, keeps the catching-up machine from running the PF's history: an APU the PF started, stopped, and started again starts once.

v1's catch-up pipeline has one step, catching up state, and an aircraft's [plugin](../product/03-v1-scope.md#plugins) can add steps after it, such as one that sends the A220's `A22X.Resync` for its full state ([04-room-for-later](../product/04-room-for-later.md#a-catch-up-pipeline)).

## Choosing the order

The order matters for an interlock: a control that acts once, when it's set, and only if another control is already set.
Take a hypothetical aircraft whose APU master, written before the battery, tries to start the APU, fails, and leaves the switch reading on: the check finds no mismatch, and the APU stays off.
Which real aircraft behave like this is unverified, and one probe on an aircraft with an APU would show it.

Two orders were weighed, and catch-up takes the second ([04-order-and-recovery](04-order-and-recovery.md#catch-up)):

- **The order the PF last changed each entry**, which the stamps from [the conflict rule](02-live-sync.md#when-two-pilots-change-one-entry) already record, so it needs nothing more.
- **The order each entry first took the value it holds now**, which needs the session's history, kept in the recording.

Say the PF turned the battery on, then the APU master, then cycled the battery off and on.
Both end on, and the battery's last change came after the APU's, so last-change order writes the APU master first, while the catching-up machine's battery is still off, and on the hypothetical aircraft the APU stays off with nothing flagged.
The battery first took "on" before the APU did, so first-final-value order writes the battery first, and the APU starts.

A write that reads back wrong without power, such as a radio frequency, may fail right behind the battery switch, before the bus has power; that such a write fails at all is unmeasured, and it's among the cases the bench tests at sync's stage of step 8 ([01-format-and-delivery](../profiles/01-format-and-delivery.md#checking-a-write)).
If the PF's battery ends off, both orders skip it on a catching-up aircraft that loaded cold and dark, so writes that need power fail, and Dual Input flags them.

## When preflight ends

When the countdown ends, every other pilot's cockpit catches up state from the PF's, so pilots don't need matching cockpits to start.

- Pilots other than the PF touch nothing in the cockpit during preflight, as [preflight](../product/03-v1-scope.md#preflight)'s rules say, because catch-up sets only what the profile holds.
- The PF works through a checklist of every `default` in the profile and touches nothing else, because each shadow value is right only if the PF's aircraft starts at its default ([01-profile-entries](01-profile-entries.md#keeping-a-shadow-value)).
- A pilot's Ready is unavailable until their aircraft has settled ([below](#settling-after-a-load)), because a following machine's aircraft still restoring its saved state when the countdown ends would send its restored values as changes, right after the catch-up, and override the PF's.

## While catch-up runs

A late joiner's or a rejoining pilot's catch-up starts as soon as they're in a flight, and ends once it has made its last write and its aircraft has settled, whichever comes later ([04-order-and-recovery](04-order-and-recovery.md#catch-up); [settling after a load](#settling-after-a-load)).

- The catching-up pilot's own changes aren't sent, and Dual Input moves them back toward the PF's state, which also undoes the aircraft restoring its saved state.
  The banner says "Catching up...", and tells the pilot that switches they move now will be reset.
- The catching-up machine's synced displays lock until its catch-up ends ([pointer sync](../pointer-sync/01-pointer-sync.md#playing-a-gesture)).
- Changes the other pilots make while catch-up runs, state and events alike, queue, and apply in stream order on top of the catch-up once its writes are made, each waiting only what's left of the gap its sender left before it, capped at 2s ([the replay](04-order-and-recovery.md#the-replay)).
  So if a pilot presses a state control, then an event control, then another state control, the event still applies between the two.
  The catching-up machine takes the catch-up's vector clock for every counter but its own, so a queued message the state already holds drops as a copy ([04-order-and-recovery](04-order-and-recovery.md#catch-up)).
- Pointer presses that arrive while catch-up runs are dropped, because the displays never showed the state those presses were made on.
  Our fork's pointer sync follows a similar rule for a new session, "recovery replays, first contact does not" (documented in the FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, R04), and drops a press for a display that hasn't announced itself (documented in the FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`).
  In the catch-up that preflight's end starts, presses queue instead and apply once its writes are made, since neither cockpit's displays were touched in preflight ([pointer sync](../pointer-sync/01-pointer-sync.md#playing-a-gesture)).
- Control can't pass to the catching-up pilot until their own catch-up ends ([04-order-and-recovery](04-order-and-recovery.md#catch-up)).
  A PM's catch-up doesn't stop when the PF's connection drops, since that doesn't pass control, and a catch-up cut off by a lost link starts again on the new connection ([01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)).

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

So an aircraft counts as settled 30s after load ([decision 048](../../decisions/048-settled-30s-after-ready-to-fly.md)).
When a session starts, or its profile loads, after Ready to fly, the 30s still counts from Ready to fly ([an aircraft that loaded before its session](04-order-and-recovery.md#an-aircraft-that-loaded-before-its-session)).

A quiet window, which waits until no entry has changed for a while, detects a pause, not a finish.
fsc-editor's rule for knowing when an aircraft's variables had all appeared waited for two equal scans of the sim's `L:` name table.
After a cold-and-dark load of an A2A aircraft, it stopped when the table held 3,963 of the 5,343 names it later held, 74%.
The aircraft registered the 1,380 missing cockpit variables in bursts with pauses between, and a duplicate aircraft-loaded event had also made two scans equal by construction (measured on MSFS 2024, 2026-08-24, fsc-editor, `docs/sim-vars/build/v1-log.md`, "Re-enumeration stops on a pause, not on a finished table").
A Bonanza's last 3 of its 88 variables appeared 35s after load, 18s after the burst before (measured on MSFS 2024, 2026-08-27, same log, "The settle rule did not fail here, and one aircraft was two").
Those are variables appearing, not restored values changing.
Restored values didn't pause that long: on six studied aircraft, loaded from the menu, the switches made their last change 1.6s to 12.1s after Ready to fly, so every aircraft's switches had settled by 30s (measured on MSFS 2024, 2026-10-05, [sync log](log.md#2026-10-05-every-aircraft-restores-its-switches-within-15s-of-ready-to-fly-and-settling-timed-from-fly-misleads)).
The only aircraft state that changed after 30s was the Fenix's ground power and its door locks: each flipped 10s to 22s after Ready to fly and flipped back 46s to 54s after it, so only the return came after 30s (same log entry).
A restore that comes after 30s syncs like a pilot's change: it carries the newest stamp, wins, and moves that control in every cockpit, the PF's included, and the check can't catch it, because it isn't a mismatch.
That's the trade we chose (user, 2026-10-04): a fast join every time, with an occasional control moving on its own soon after a rejoin, over a slow join every time.
If it proves common, the fallback is a longer wait for late joins only, where the risk is.

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

- Whether any studied aircraft has an interlock that fails while reading back right, which a case in the sim settles ([what the open questions still hold](05-units.md#what-the-open-questions-still-hold)).
- Whether catch-up's writes are retried, which the bench at sync's stage of step 8 settles, starting from one attempt per write ([01-format-and-delivery](../profiles/01-format-and-delivery.md#checking-a-write)).
