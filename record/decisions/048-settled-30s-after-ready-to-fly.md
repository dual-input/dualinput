# 048: An aircraft counts as settled 30s after Ready to fly

An aircraft that has just loaded counts as settled 30s after the pilot clicks Ready to fly, which the sim marks with the flow event `RTC_END`, with no quiet window, no 1.5-minute cap, no rule that drops a busy entry from the check, and no clock of its own for a profile or a session that starts after that.
This changes [decision 040](040-catch-up-first-final-value-order.md)'s rule for a session started after the aircraft loaded, which counted a 30s floor from Ready to fly and a 15s quiet window from the profile's load.
Decided by the user on 2026-10-23, in a review of the designs against CLAUDE.md's rule on mechanisms ([architecture log](../areas/architecture/log.md#2026-10-23-a-review-against-the-simplicity-rule-cut-eight-guards-and-kept-every-designed-feature-it-questioned)).

## Context

A pilot's Ready waits until their aircraft has settled, and a late joiner's catch-up lasts until it has, because a restore that lands after catch-up looks like the pilot changing those controls ([settling after a load](../areas/sync/03-catch-up.md#settling-after-a-load)).
The rule that called an aircraft settled took four parts: a floor 30s after Ready to fly, 15s with no change to any state entry, a cap at 1.5 minutes that marked the recording, and an entry changing more than 5 times left out of the check, with a window of its own for a profile that loads late ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#an-aircraft-that-loaded-before-its-session)).
On six aircraft loaded from the menu, the Black Square Baron 58P, the A2A PA-24, the Synaptic A220, the iniBuilds A350, the PMDG 777-300ER, and the Fenix A320, the switches last changed 1.6s to 12.1s after Ready to fly, and the rule called each settled at its 30s floor (measured on MSFS 2024, 2026-10-05, [sync log][settle]).

## Options

1. **The four-part rule.**
   It covers a restore that pauses past the floor, which no studied aircraft did, at the cost of four rules, a window of its own for a late profile, and an open question on whether 5 changes tells a restore from an aircraft driving a control.
2. **30s after Ready to fly.**
   It calls every studied aircraft settled where the four-part rule did, and a restore later than 30s syncs like a pilot's change, the trade of 2026-10-04: a fast join every time, with an occasional control moving on its own soon after a rejoin (user, 2026-10-04).

## Decision

Option 2.

## What it commits us to

- A profile or a session that starts more than 30s after Ready to fly finds its aircraft settled at once.
- A restore after 30s carries the newest stamp, wins, and moves that control in every cockpit, and its fallback stays [03-catch-up](../areas/sync/03-catch-up.md#settling-after-a-load)'s: a longer wait for late joins only, if it proves common.
- The driven-entry test of [decision 043](043-driven-entries-and-putting-back.md) is its own rule, apart from settling, and stays.

[settle]: ../areas/sync/log.md#2026-10-05-every-aircraft-restores-its-switches-within-15s-of-ready-to-fly-and-settling-timed-from-fly-misleads
