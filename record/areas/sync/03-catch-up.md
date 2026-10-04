# Sync: catch-up

```text
Purpose:     How a cockpit that missed changes, or never had them, comes to the flying machine's state.
Depends on:  01-profile-entries.md, 02-live-sync.md, ../product/03-v1-scope.md (preflight, the connection)
Decides:     Which catch-up runs when, the order state applies in, what happens while catch-up runs, and when a freshly loaded aircraft counts as settled.
```

A cockpit catches up in one of two ways.
After a short outage with the sim still running, it replays the changes it missed, in order.
After a late join, a sim restart, or the end of preflight, it takes the flying machine's state as it stands, applies each entry once in the order the PF last changed them, checks every write, and flags what never matches.
Events and pointer presses from before a catch-up began aren't recovered, so after a late join or a restart, displays and other state the profile can't read may differ.

## Which catch-up runs when

| Situation | Catch-up |
| --- | --- |
| A short outage, with the sim still running | Replay the stream since the drop: state changes, events, and pointer presses, in order |
| Preflight ends, a pilot joins late, or a pilot rejoins after a sim restart | Catch up state, below |

The replay needs only what was sent within the last 5 minutes, because a pilot cut off for longer leaves the session ([the connection](../product/03-v1-scope.md#the-connection)) and comes back as a late joiner.

## Replaying a short outage

The replay keeps the PF's spacing between changes, with each gap cut to at most about 2s.

Replayed back to back, a time-dependent sequence breaks.
Say the PF pressed APU start, then opened the APU bleed a minute later, once the APU could supply air.
Replayed with no gap, the bleed opens before the follower's APU is running, and it fails.
Replayed at the PF's real spacing, a 5-minute outage takes 5 minutes to replay, while the follower's position stays live.
With gaps capped at 2s, an outage with 30 changes replays in about a minute at most, and a switch with a follow-up a few seconds later keeps some of its room.
The 2s is a starting value, to tune once we've watched a real outage replay.

Our FS Copilot fork resent what it held in sequence order, as fast as the link allowed, and the receiver dropped what it had already applied (FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`).
The replay keeps the fork's order and dropping, and adds the spacing.

## Catching up state

1. The flying machine sends its state as it stands.
2. The catching-up machine skips every entry its cockpit already matches.
3. It applies each remaining entry once, at the PF's value, in the order the PF last changed them, which the stamps from [the conflict rule](02-live-sync.md#when-two-pilots-change-one-entry) already record.
   Entries the PF never changed since the aircraft loaded go first.
   Immediate writes go out in that order in one short burst, and stepped writes start in that order and run side by side, since each moves a different control.
   A shadow value is written as the difference between the PF's shadow and the catching-up machine's own.
4. A function writer runs again when an entry it read lands, so a transponder writer that skipped while the battery was off runs once the battery is on.
5. It checks every write, retries what doesn't match, and flags what never does, as live sync does ([02-live-sync](02-live-sync.md#checking-that-a-write-landed)).

Applying each entry once, at its final value, keeps the catching-up machine from running the PF's history: an APU the PF started, stopped, and started again starts once.

The PF's order matters for an interlock that acts.
An APU master written before the battery tries to start, fails, and leaves its switch reading on, so the check finds no mismatch to retry.
In the usual startup, the PF turned the battery on before the APU, so the PF's order puts the battery first.

How the order and the retries handle a battery switch:

| The PF's battery | What happens |
| --- | --- |
| Turned on, used, cycled off and on, ends on | The battery lands late, so writes that need power fail once, and the next retry, with the battery on, lands them |
| Turned on, used, then turned off, ends off | The catching-up machine's battery is off already and is skipped, so writes that need power, such as a radio frequency, fail on every retry and are flagged |

## When preflight ends

When the countdown ends, every follower's cockpit catches up state from the PF's, so pilots don't need matching cockpits to start.

- Pilots other than the PF touch nothing during preflight, because what the profile doesn't hold stays as each of them leaves it.
- The PF works through a checklist of every `default` in the profile, such as "FCU speed 80", and touches nothing else, because each shadow value is right only if the PF's aircraft starts at its default ([01-profile-entries](01-profile-entries.md#shadow-values)).
- A pilot's Ready is unavailable until their aircraft has settled ([below](#settling-after-a-load)), because a follower's aircraft still restoring its saved state when the countdown ends would send its restored values as changes, right after the catch-up, and override the PF's.

## While catch-up runs

- The catching-up pilot's own changes aren't sent, and Crosscheck moves them back toward the PF's state, which also undoes an aircraft restoring its saved state.
  The banner says "Catching up...", and tells the pilot that switches they move now will be reset.
- Changes the crew makes while catch-up runs, state and events alike, queue, and replay in stream order on top of the catch-up.
  So the middle of three presses, filed under `events:` while the other two are state, keeps its place.
- Pointer presses that arrive while catch-up runs are dropped, because the displays never showed the state those presses were made on.
  Our fork's pointer sync follows the same rule: "recovery replays, first contact does not" (FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`).
- When the PF's connection drops, control passes to a pilot who isn't catching up.
  If the only other pilot is the one catching up, catch-up stops, that pilot takes control, and the banner shows the usual message that they have control.

## Settling after a load

An aircraft that has just loaded goes on changing its own controls for a while: the Baron restores 40 `L:` variables from its saved state and settings and is done about 25s after load (read in bksq-aircraft-baronpro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md)).
A restore that lands after catch-up looks like the pilot changing those controls.

So an aircraft counts as settled when:

1. at least 15s have passed since it loaded,
2. then 15s pass with no change to any state entry,
3. or 1.5 minutes have passed since it loaded, whichever comes first, in which case the bug-report log notes that the aircraft never went quiet.

Only `state:` entries count, so gauges, timers, and animations never hold it up.
An entry that changes more than 5 times since the load is one the aircraft drives itself, such as a knob that recenters or a light that blinks, and it leaves the quiet check for that load.

A quiet window detects a pause, not a finish.
fsc-editor's rule for knowing when an aircraft's variables had all appeared, which waited for two equal scans, stopped holding 74% of an A2A aircraft's variables after a cold-and-dark load, because the aircraft registered them in bursts with pauses between (measured on MSFS 2024, 2026-08-24, fsc-editor, `docs/sim-vars/build/v1-log.md`, "Re-enumeration stops on a pause, not on a finished table"), and a Bonanza's last 3 of its 88 variables appeared 35s after load, 18s after the burst before (measured on MSFS 2024, 2026-08-27, same log, "The settle rule did not fail here, and one aircraft was two").
So a 15s window can end between two bursts.
When it does, the late restore syncs like a pilot's change: it carries the newest stamp, wins, and moves that control in every cockpit, the PF's included, and the check can't catch it, because it isn't a mismatch.
That's the trade we chose (user, 2026-10-04): a fast join every time, with an occasional control moving on its own soon after a rejoin, over a slow join every time.
If it proves common, the fallback is a longer quiet window for late joins only, where the risk is.

## What catch-up doesn't recover

- Events and pointer presses from before catch-up began.
- State the profile can't read, such as a display's page or what's typed into an FMS, so after a late join or a sim restart those may differ.
- A write that needs something the PF's cockpit no longer has, such as a frequency set while the PF's battery was on, before the PF turned it off; Crosscheck flags it.

## Considered and dropped

- **Replaying the whole session for a late joiner.**
  Every machine keeps the recording anyway, and replaying it is the one way to rebuild state the profile can't read, but it fails more often than it helps:
  - Speeding it up breaks anything that takes time, such as an APU spooling up, an inertial alignment, or an engine start, and replaying in real time takes as long as the flight.
  - The result depends on what the recording doesn't hold, such as position, time, weather, random failures, and the navigation database: the A220 study found the aircraft's FMS on AIRAC 2609 on one machine and a bundled 2503 on another (read in synaptic-aircraft-a220 1.0.10, [A220 study](../aircraft/synaptic-a220/study.md)).
  - The replay would have to start where the recording started, at the departure stand, then move the aircraft to the PF's position, which is the long-distance move [preflight](../product/03-v1-scope.md#preflight) asks pilots to avoid.
  - Replaying each change runs the aircraft's systems through the PF's whole history.
- **Ordering state by when each entry first took its final value,** from the recording.
  With retries, it reaches the same result as the PF's last-change order in both battery cases above, so it adds work for nothing.

Replaying only the presses made while parked, for state that's mostly deterministic, such as typing a route into an FMS, stays a possible experiment for one aircraft.

## Open questions

- Whether 15s, 15s, and 1.5 minutes fit real aircraft, and whether 5 changes tells a restore from an aircraft driving a control.
- Whether 2s is the right cap on replay gaps.
- How many retries before an entry is flagged, and how long to wait before reading back, which [02-live-sync](02-live-sync.md#open-questions) shares.

[The plan](../product/plan.md)'s step 6 lists the probes that answer these.
