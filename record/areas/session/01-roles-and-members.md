# Session: roles and members

```text
Purpose:     Who is in a session, which roles its members hold, and how each role moves.
Depends on:  ../product/03-v1-scope.md, ../product/04-room-for-later.md, ../network/01-between-machines.md, ../sync/04-order-and-recovery.md
Decides:     The member list and its kinds, the table of roles and v1's two, who may take control and when, and how the traffic and ATC host is chosen.
```

A session's members are listed on the session channel, each by an entry it writes itself.
Its roles are one table, each row saying who may hold the role, how it moves, and what happens when its holder loses the link, leaves the flight, or leaves the session.
v1's table has two rows, the PF and the traffic and ATC host, and the picks after v1 add rows rather than mechanisms ([04-room-for-later](../product/04-room-for-later.md#roles)).

This answers node 3 of the [architecture plan](../architecture/plan.md#3-sync-and-the-session) for the session, and [04-order-and-recovery](../sync/04-order-and-recovery.md) answers it for sync.
The flying machine is the PF's, and a following machine is any other pilot's.

## The member list

Each member writes its own entry on the session channel: its pilot ID, display name, kind, and endpoint ID ([01-between-machines](../network/01-between-machines.md#channels)).

- A joiner becomes a member once its first message has passed ([joining](../network/01-between-machines.md#joining)), and stops being one when it leaves the session, quits Crosscheck, or has been disconnected for 30 minutes ([coming back](../network/01-between-machines.md#coming-back)).
- A member's kind is crew in v1, and passenger once [join modes](../product/ideas.md#join-modes) comes.
  Crew members send on the cockpit stream, so they hold counters in the vector clocks; a passenger sends no cockpit message, so it never appears in one ([04-order-and-recovery](../sync/04-order-and-recovery.md#the-cockpit-stream)).
- Every member, a passenger included, acknowledges on the heartbeat what it applied, because each core keeps the cockpit's messages until every member has acknowledged them ([coming back](../network/01-between-machines.md#coming-back)).
  In FS Copilot, a peer that stopped acknowledging "keeps its last ack as the floor, so history stops draining", until a cap of 2,000 gestures drops the oldest (documented in the FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, "4.6 History: everything after the last ack").
- [Preflight](../product/03-v1-scope.md#preflight) waits for every crew member's Ready, except those another pilot chose to go without.

## The table of roles

| Role | Who may hold it | How it moves | Its holder loses the link | Its holder leaves the flight, or their sim closes | Its holder leaves the session |
| --- | --- | --- | --- | --- | --- |
| PF | Any crew member | [Below](#the-pf) | Nothing changes | Control passes to the PM at once | Control passes to the PM first |
| Traffic and ATC host | Any crew member | [Below](#the-traffic-and-atc-host) | Nothing changes | Hosting pauses | The role is released |

### The PF

- Any crew member may hold control, and never a passenger, nor later a flight engineer ([take-control key](../product/03-v1-scope.md#take-control-key)).
- Control moves by the take-control key or button, at any time except during the pilot's own catch-up ([04-order-and-recovery](../sync/04-order-and-recovery.md#catch-up)); by a voice handover, the PF's offer and the PM's answer ([voice phrases](../product/03-v1-scope.md#voice-phrases)); and when the PF leaves the flight or the session, or their sim closes ([04-order-and-recovery](../sync/04-order-and-recovery.md#a-sim-that-closed); [leaving](../network/01-between-machines.md#leaving)).
- Each change raises the control value, and two made at once are settled by pilot ID ([control](../network/01-between-machines.md#control)).
- While the PF's link is lost, nothing changes: the PF flies on, a PM that lost the flying machine locks, and any pilot may take control, a PM with a warning ([while a link is lost](../network/01-between-machines.md#while-a-link-is-lost)).
- The session's authority moves with control ([the connection](../product/03-v1-scope.md#the-connection)), and a new PF writes the session channel's keys again under the new control value ([channels](../network/01-between-machines.md#channels)).
- In v1, control passes to the one PM when the PF leaves; with more than two crew, this row says which pilot it passes to, a rule the pick for larger crews sets ([join modes](../product/ideas.md#join-modes)).

### The traffic and ATC host

- The traffic host is also the ATC host, as [hearing ATC](../product/03-v1-scope.md#hearing-atc) says, so v1 has one role for both, and the table lets it split into two.
  FS Copilot's build split them, giving traffic and ATC audio a host each (FS Copilot fork, `record/traffic-atc/docs/03-implementation-plan.md`, "Decisions locked with the user (2026-09-06)", row 1).
- A pilot takes the role by hand, turning on "Share my traffic and ATC" in the EFB app or the desktop app, and releases it by turning it off (user, 2026-10-11).
  The first to turn it on holds it, and every other pilot's switch shows who holds it and stays off until it's released.
  Two pilots who turn it on at once are settled by the session channel's stamp, and the switch of the one who lost goes back off ([channels](../network/01-between-machines.md#channels)).
  FS Copilot's build worked the same way, with no taking over: "a toggle is disabled while someone else hosts that feature" (same document, same section, row 2).
  Taking the role automatically would need Crosscheck to tell which pilot runs a traffic injector, which [traffic sync](../product/03-v1-scope.md#traffic-sync)'s open questions leave unknown.
- While the host's link is lost, the host keeps the role, and a receiver removes a copy that has had no sample for 15s, as FS Copilot's receiver does; the identity set that comes with the new connection spawns it again ([channels](../network/01-between-machines.md#channels); FS Copilot fork, same document, "Key invariants").
- While the host is out of the flight, or their sim is closed, the host keeps the role and hosting pauses: every receiver removes that host's copies at once, and once the host's sim is back in a flight, its traffic arrives as a fresh set.
  FS Copilot withdrew hosting while the host's sim was disconnected, and took it up again when it reconnected (same document, "Key invariants").
- When the host leaves the session, the role is released, and every receiver removes that host's copies, as FS Copilot's did (same document, "Decisions locked with the user (2026-09-06)", row 4).
- When the role passes to a new host, the new host first removes the copies it had spawned of the old host's traffic, and the old host stops sending ([traffic sync](../product/03-v1-scope.md#traffic-sync)).

## Roles after v1

[04-room-for-later](../product/04-room-for-later.md#roles) names the rows later picks add, each with the same columns: the machine that carries out ground services, which is the flying machine; a weather source; the ATC host's duty of taking the second pilot's microphone to ATC; and a flight engineer, whom control never passes to.
Passengers are a kind of member, not a role.
