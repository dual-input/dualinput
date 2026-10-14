# 039: A cut link comes back by replay, and a sim, core, or PC that went down comes back as a late joiner

After a cut link, with the sim and the core still running, a pilot gets a replay of every missed change in causal order, each after the gap the PF left, capped at 2s, except that of each run of changes to a PF-owned entry with only PF-owned changes between them, only the last applies, in its place.
A pilot whose sim run ends has left the flight: control passes on if they held it, and they come back as a late joiner under the same pilot ID, with a catch-up of state.
Decided by the user on 2026-10-11 and 2026-10-12, in node 3 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#a-cut-link-comes-back-by-replay-and-a-sim-core-or-pc-that-went-down-comes-back-as-a-late-joiner).

## Context

The PF, the pilot flying, holds control, and their machine is the flying machine; a following machine is any other pilot's, and the PM, the pilot monitoring, is the other front-seat pilot ([03-v1-scope](../areas/product/03-v1-scope.md)).
What a pilot's cockpit still holds after an outage depends on what went down ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#what-comes-back-after-what)):

- A cockpit whose sim kept running through a cut link still holds everything no profile entry reads, such as a display's page or an FMS.
- A sim that closed has lost its pages, FMS, and avionics state, such as a GTN 750's flight plan, which no profile entry reads (user, 2026-10-11), and replaying the presses that built them wouldn't restore them, because a press does what the pilot meant only on the page they saw ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#a-sim-that-closed)).

A returning pilot whose sim kept running gets a replay of the cockpit stream ([decision 037](037-while-a-link-is-lost.md)), and node 2 left node 3 to pace a replay of up to 30 minutes, which at the PF's spacing runs nearly as long as a busy cut; to say how a PF whose sim crashed comes back; and to say how an ex-PF's cockpit comes to the new PF's state after a takeover during a cut ([architecture plan](../areas/architecture/plan.md#3-sync-and-the-session)).

## Options

Pacing a replay:

1. **Every missed change at the PF's spacing, each gap capped at 2s,** [03-catch-up](../areas/sync/03-catch-up.md#replaying-a-short-outage)'s rule.
   A PF working the throttle changes it every time the lever moves, while a following machine only shows it (user, 2026-10-11), so each of those changes would replay after up to 2s of its own.
2. **State entries at their newest value, keeping the spacing only for events and presses,** the shortening node 2 suggested ([01-between-machines](../areas/network/01-between-machines.md#coming-back)).
   A lever set at once to its newest value would no longer hold, at each event replayed after it, the value it had when the PF made that event, such as the mixture behind a starter press (inference).
3. **Option 1, except that of each run of changes to a PF-owned entry with only PF-owned changes between them, only the last applies, in its place.**

Who paces:

4. **Our panel bridge paces presses itself, as FS Copilot's panels did.**
   With the core pacing every cockpit message too, a panel that paced would wait each gap a second time.
5. **The core alone paces every cockpit message, live or replayed, and our panel bridge plays each press when the core hands it over.**

A sim that closed:

6. **A PF whose sim crashed passes nothing, and comes back as PF if nobody took control,** as node 2 left it ([01-between-machines](../areas/network/01-between-machines.md#control)).
   The crashed sim has lost its pages, FMS, and avionics state, which nothing restores, while another pilot's cockpit is intact (user, 2026-10-11).
7. **A pilot whose sim run ends has left the flight, and comes back as a late joiner.**

Which of a superseded PF's messages a change of control drops:

8. **Those that reach a receiver in a replay,** node 2's rule ([01-between-machines](../areas/network/01-between-machines.md#control)).
   A PF's own handover comes after every message it made, so dropping by the replay would drop a leaving PF's last changes from a PM still replaying.
9. **Those the change of control's vector clock doesn't include, live or in a replay.**
   A switch the PF flipped before it learned of another pilot's take-control press is dropped, and the ex-PF's catch-up undoes it in its own cockpit ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#a-change-of-control)).

When control can pass:

10. **To any pilot at any time,** as [the take-control key](../areas/product/03-v1-scope.md#take-control-key) rules.
    A pilot who took control partway through a replay would fly a cockpit that dates from before the cut, and one who took it during catch-up a cockpit whose own changes were never sent.
11. **To no pilot while their own replay or catch-up runs over a link that's up, except when the PF leaves.**

## Decision

Options 3, 5, 7, 9, and 11.
A replay's 2s cap bounds it at 2s a change (arithmetic), and keeping the last change of each run in its place keeps each lever where it was before the next event, such as a starter press.
The core paces as FS Copilot's panels paced presses, "Each waits its *remaining* gap, not the full one, so live gestures add no latency" (FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, 0.4), so a live message, already spaced by the network, waits nothing.
The machine whose cockpit is intact flies on (user, 2026-10-11).
A change of control's clock includes everything a PF did before its own handover, and nothing of the solo flying that a takeover during a cut supersedes.

## What it commits us to

- The pacing holds for every cockpit message, live or replayed: each waits the gap its sender left before it, capped at 2s, counted from when the one before it applied, so it waits only what's left.
- A pilot whose sim run ends, which their core sees as the sim closes or finds at start after a PC crash, has left the flight.
  If they were the PF, control passes on, at once or once the crew's first message has passed, to a pilot still in the flight.
- The pilot comes back as a late joiner under the same pilot ID, with a catch-up of state and a notice that pages, FMS, and avionics state may differ.
- Each change of control carries its maker's vector clock, and every machine that applied a message the change drops catches up state from the new PF.
- Control can't pass to a pilot while their own replay or catch-up runs over a link that's up, by key, button, or voice; when the PF leaves, it passes anyway, to a pilot still in the flight, an up-to-date one where there is one.
- It replaces node 2's rules that a sim crash passes nothing and that control drops the superseded PF's messages that reach a receiver in a replay, and settles how a replay is paced and how an ex-PF and a crashed PF come back ([architecture plan](../areas/architecture/plan.md#3-sync-and-the-session)).
- It leaves tuning the 2s cap to v1's recordings, and which up-to-date pilot receives control in a crew of more than two to the pick for larger crews ([roles and members](../areas/session/01-roles-and-members.md#the-pf)).
