# Sync: catch-up

```text
Purpose:     How a cockpit that missed changes, or never had them, comes to the flying machine's state.
Depends on:  01-profile-entries.md, 02-live-sync.md, ../product/03-v1-scope.md (preflight, the connection)
Decides:     Which catch-up runs when, the order state applies in, what happens while catch-up runs, and when a freshly loaded aircraft counts as settled.
```

A cockpit catches up in one of two ways.
After a short outage with the sim still running, it replays the changes it missed, in order.
After a late join, a sim restart, or the end of preflight, it takes the flying machine's state as it stands, applies each entry once in the order the PF last changed them, checks every write, and flags what never matches.
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
2. The catching-up machine skips every entry its cockpit already matches.
3. It applies each remaining entry once, at the PF's value, in the order the PF last changed them, which the stamps from [the conflict rule](02-live-sync.md#when-two-pilots-change-one-entry) record.
   Entries the PF never changed since the aircraft loaded go first.
   Immediate writes go out in that order in one short burst, and stepped writes start in that order and run side by side, since each moves a different control.
   For a shadow value, the catching-up machine steps the control by the difference between the PF's shadow and its own, and its own shadow counts those steps as they land.
4. A write function runs again when an entry it read lands, so a transponder function that skipped while the battery was off runs once the battery is on.
5. It checks every write, retries what doesn't match, and flags what never does, as live sync does ([02-live-sync](02-live-sync.md#checking-that-a-write-landed)).

Applying each entry once, at its final value, keeps the catching-up machine from running the PF's history: an APU the PF started, stopped, and started again starts once.

The PF's order matters for an interlock that acts.
Take a hypothetical aircraft whose APU master, written before the battery, tries to start the APU, fails, and leaves the switch reading on: the check finds no mismatch to retry, and the APU stays off.
In the usual startup, the PF turned the battery on before the APU, so the PF's order puts the battery first.
Which real aircraft behave like this is unverified, and one probe on an aircraft with an APU would show it.

How the order and the retries handle a battery switch, on that hypothetical aircraft, where writes that need power don't land without it:

| The PF's battery | What happens |
| --- | --- |
| Turned on, used, cycled off and on, ends on | The battery lands late. A write that needs power and reads back wrong, such as a radio frequency, fails once, and the next retry, with the battery on, lands it. A write that fails but reads back right, such as the APU master, stays failed, and nothing flags it. |
| Turned on, used, then turned off, ends off | If the catching-up aircraft loaded cold and dark, its battery is off already and is skipped, so writes that need power fail on every retry, and Crosscheck flags them. |

The first row's APU is a gap: an interlock that acts, after a battery cycled since it was used, can fail with nothing to show it.

## When preflight ends

When the countdown ends, every other pilot's cockpit catches up state from the PF's, so pilots don't need matching cockpits to start.

- Pilots other than the PF touch nothing in the cockpit during preflight, because catch-up sets only what the profile holds: a PM who switches a display to another page during preflight keeps that page after the PF's state arrives.
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
- When the PF's connection drops and the PM is catching up, the PM's catch-up stops before control passes to them, as [the take-control key](../product/03-v1-scope.md#take-control-key) says.

## Settling after a load

An aircraft that has just loaded goes on changing its own controls for a while.
The SDK documents that the sim saves the 40 `L:` variables in the Baron's `systems.cfg [LocalVars]` with the flight and restores them at load, though developers reported it failing on some MSFS 2024 builds (documented, as the [Baron study](../aircraft/black-square-baron-pro/study.md) cites it; unverified for this aircraft).
The Baron's own timers finish restoring its settings about 25s after load by the code, which nobody has measured (read in bksq-aircraft-baronpro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md), sim question 2).

A restore that lands after catch-up looks like the pilot changing those controls.

So an aircraft counts as settled at whichever comes first:

- 15s with no change to any state entry, counted from 15s after load, so 30s after load at the earliest
- 1.5 minutes after load, in which case the recording notes that the aircraft never went quiet

Only `state:` entries count, so gauges, timers, and animations never hold it up.
An entry that changes more than 5 times since the load is one the aircraft drives itself, such as a knob that recenters or a light that blinks, and it leaves the quiet check for that load.

A quiet window detects a pause, not a finish.
fsc-editor's rule for knowing when an aircraft's variables had all appeared waited for two equal scans of the sim's `L:` name table.
After a cold-and-dark load of an A2A aircraft, it stopped when the table held 3,963 of the 5,343 names it later held, 74%, and the 1,380 missing were the aircraft's own cockpit variables: the aircraft registered them in bursts with pauses between, and a duplicate aircraft-loaded event had made two scans equal by construction (measured on MSFS 2024, 2026-08-24, fsc-editor, `docs/sim-vars/build/v1-log.md`, "Re-enumeration stops on a pause, not on a finished table").
A Bonanza's last 3 of its 88 variables appeared 35s after load, 18s after the burst before (measured on MSFS 2024, 2026-08-27, same log, "The settle rule did not fail here, and one aircraft was two").
Those are variables appearing, not restored values changing, so whether a restore also pauses longer than 15s is unverified, and the settle probe in [the plan](../product/plan.md)'s step 6 settles it.
If it does, a 15s window can end between two bursts.
Then the late restore syncs like a pilot's change: it carries the newest stamp, wins, and moves that control in every cockpit, the PF's included, and the check can't catch it, because it isn't a mismatch.
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
- **Ordering state by when each entry first took its final value,** from the recording.
  For writes that read back wrong, it reaches the same result as the PF's last-change order in both battery cases above.
  It would put the battery first in the first row, though, and so close the APU gap, which the comparison that dropped it on 2026-10-04 didn't weigh.

Replaying only the presses made while parked, for state that's mostly deterministic, such as typing a route into an FMS, stays a possible experiment for one aircraft.

## Open questions

- Whether 15s, 15s, and 1.5 minutes fit real aircraft, and whether 5 changes tells a restore from an aircraft driving a control.
- Whether any studied aircraft has an interlock that acts and fails while reading back right, which decides whether the gap above needs the first-final-value order.

[The plan](../product/plan.md)'s step 6 lists the probe for the settle rule.
