# 036: Control is one value, a generation and the PF's pilot ID

Control is one value, a generation and the PF's pilot ID: every change of PF raises the generation to one past the highest its maker has seen, and of two changes with the same generation, the one naming the lower pilot ID wins.
The value rides the session channel as one key, every cockpit message and flight-model sample carries the whole value it was made under, and a PF who leaves the flight or the session, quits, or whose sim closes passes control as an ordinary handover.
Decided by the user on 2026-10-11, in nodes 2 and 3 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#control-is-one-value-a-generation-and-the-pfs-pilot-id).

## Context

The PF, the pilot flying, holds control, and their machine is the flying machine; a following machine is any other pilot's, and the PM, the pilot monitoring, is the other front-seat pilot ([03-v1-scope](../areas/product/03-v1-scope.md)).
[The take-control key](../areas/product/03-v1-scope.md#take-control-key) lets any pilot take control at any time, without the PF agreeing, and leaves to the architecture how the machines agree on which of two presses came first.
Three findings shape the answer:

- **Clocks.** Each machine reads another's stamps through an offset of its own, so two presses closer than the offsets' error could order differently on two machines ([01-spine](../areas/architecture/01-spine.md#left-open)).
- **A takeover during a cut.** While a link is lost, any pilot whose role may hold control can take it ([decision 037](037-while-a-link-is-lost.md)), and the PF flies on alone until the link returns.
  A replay of an ex-PF's solo flying into the new PF's cockpit would repeat FS Copilot's replay of solo input into a fresh session (FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, R04).
- **Leaving.** noq lets a peer drop stream data it hasn't delivered once a close arrives (read in noq 1.3.0, `src/connection.rs`, `Connection::close`), so whatever a leaving PF sends just before closing its connections could be lost.

## Options

How the machines agree on who flies:

1. **The earlier press wins, however small the gap, as the take-control key ruled.**
   Two machines that compare the moments of two presses, each through its own estimate of the other's clock, can order them differently.
2. **The flying machine, the session's authority at every moment ([the connection](../areas/product/03-v1-scope.md#the-connection)), decides for every machine.**
   The machines then agree, but for presses closer than the offsets' error it can still pick the later one, against the rule that the earlier press wins ([01-spine](../areas/architecture/01-spine.md#left-open)).
3. **One control value, a generation that every change of PF raises and the PF's pilot ID, with the lower pilot ID winning a tie.**
   Two presses within one round trip are settled by pilot ID rather than by which came first, which no pilot can notice (user, 2026-10-11).
4. **Option 3, with each message tagged by the generation alone.**
   Two pilots who take control from the same generation make values that differ only in the PF, so a receiver couldn't tell the loser's messages from the winner's.

How a PF who leaves gives up control:

5. **The PF sends a handover just before it closes its connections.**
   noq on the PM's side may drop the handover once the close arrives, so it could be lost.
6. **The PF passes nothing, as FS Copilot's master did.**
   FS Copilot's master leaving on purpose locked the other pilot, and making that pilot master was deferred (FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, R02).

## Decision

Option 3, with every message carrying the whole value, and a PF who leaves handing over before it closes.
A generation and a pilot ID compare the same on every machine, where the moments of two presses, each read through one machine's estimate of the other's clock, can compare differently.
A PF who leaves passes control as an ordinary handover to a pilot still in the flight, in v1 the PM, and closes only once that pilot's messages carry the new value, or once 1s has passed, so the handover can't be lost behind the close and the PM isn't left locked; if no pilot is in the flight once preflight has ended, the session ends ([decision 044](044-table-of-roles.md)).
A PF whose sim closes, by a crash or otherwise, has left the flight, for the reasons [decision 039](039-cut-link-replays-others-late-join.md) gives, and its core, which stays up, passes control the same way (user, 2026-10-11, in node 3; [04-order-and-recovery](../areas/sync/04-order-and-recovery.md#a-sim-that-closed)).

## What it commits us to

- Every change of PF raises the generation: the take-control key, voice, a PF leaving the flight, and a takeover while a link is lost.
- The value rides the session channel as one key, so a new connection's first message carries it ([01-between-machines](../areas/network/01-between-machines.md#joining)).
- A receiver that meets a newer value on any message or sample adopts it.
- A receiver drops a flight-model sample made under an older value than the newest it knows.
- Of cockpit messages, a receiver drops only those a superseded value's PF made under it that the change of control's vector clock doesn't include, live or in a replay (changed in node 3, [04-order-and-recovery](../areas/sync/04-order-and-recovery.md#a-change-of-control)), and a dropped message counts as delivered for the cockpit's causal order.
- A switch the PF flipped in the round trip before it learned of a takeover is in its own cockpit and nobody else's, so the ex-PF catches up state from the new PF, which undoes it in its cockpit too.
- It replaces [the take-control key](../areas/product/03-v1-scope.md#take-control-key)'s rule that the earlier press wins, however small the gap.
- Who may change control, and when, is left to the table of roles ([decision 044](044-table-of-roles.md); [roles and members](../areas/session/01-roles-and-members.md#the-pf)).
