# Session: roles and members

```text
Purpose:     Who is in a session, which roles its members hold, and how each role moves.
Depends on:  ../product/03-v1-scope.md, ../product/04-room-for-later.md, ../network/01-between-machines.md, ../sync/04-order-and-recovery.md
Decides:     The member list and its kinds, the table of roles and v1's two, who may take control and when, and how the traffic and ATC host is chosen.
```

> **Note**
> Since 2026-10-14, a role is a session key a feature declares, which names its holder and which the host clears of a member who leaves the session, and who may hold it is a guard on writing the key, so [the table of roles](#the-table-of-roles) below documents the session's roles, and the code keeps no registry of them ([02-code-map](../architecture/02-code-map.md#what-a-feature-registers)).
> Traffic and ATC audio each hold a role of their own, the traffic host and the ATC host, which one request from the "Share my traffic and ATC" switch claims together, where [the traffic and ATC host](#the-traffic-and-atc-host) below gives them one role that can split ([02-code-map](../architecture/02-code-map.md#the-traffic-and-atc-switch)).
> Since 2026-10-16, each member acknowledges what it applied on a one-off channel of the cockpit-stream crate's own, where [the member list](#the-member-list) below has it acknowledge on the heartbeat ([02-units](../network/02-units.md#the-heartbeat-and-clock-offsets)).
> Since 2026-10-16, [the session's units](02-units.md) adds three things: each member also writes its sim's stage and aircraft as a key of its own, from which every core works out who is in the flight ([in the flight](02-units.md#in-the-flight)); a pass the platform makes goes to the member in the flight with the lowest pilot ID, where [the PF](#the-pf) below says only that in v1 it's the PM ([control](02-units.md#control)); and the crew can't go without a PF who dropped out during preflight, since control stays with a PF whose link is lost ([preflight](02-units.md#preflight)).

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
- Every crew member acknowledges on the heartbeat what it applied, because each core keeps the cockpit's messages until every member on its links has acknowledged them ([coming back](../network/01-between-machines.md#coming-back)).
  A passenger takes a one-way feed off the crew's links ([04-room-for-later](../product/04-room-for-later.md#people-beyond-the-crew)), so it holds nothing up, and how its feed catches up after an outage is for the pick that brings passengers.
  In FS Copilot, a peer that stopped acknowledging "keeps its last ack as the floor, so history stops draining", until a cap of 2,000 gestures (documented in the FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, "4.6 History: everything after the last ack").
- [Preflight](../product/03-v1-scope.md#preflight) waits for every crew member's Ready, except those another pilot chose to go without.

## The table of roles

| Role | Who may hold it | How it moves | Its holder loses the link | Its holder leaves the flight, or their sim closes | Its holder leaves the session |
| --- | --- | --- | --- | --- | --- |
| PF | Any crew member | [Below](#the-pf) | Nothing changes | Control passes on, as soon as their core knows | Control passes on first |
| Traffic and ATC host | Any crew member | [Below](#the-traffic-and-atc-host) | Nothing changes | Nothing changes | The role is released |

### The PF

- Any crew member may hold control, and never a passenger, nor later a flight engineer ([take-control key](../product/03-v1-scope.md#take-control-key)).
- Control moves by the take-control key or button, or by a voice handover, the PF's offer and the PM's answer ([voice phrases](../product/03-v1-scope.md#voice-phrases)), to any pilot but one whose own catch-up or replay runs over a link that's up ([04-order-and-recovery](../sync/04-order-and-recovery.md#catch-up)).
- The take-control input is live only while its pilot is in the flight, after [preflight](../product/03-v1-scope.md#preflight): the EFB app shows the button only then, and the core ignores the key and the hardware button at any other time (user, 2026-10-12).
  So nobody takes control in the main menu, or at the gate before the countdown, and a joiner who'll fly the leg takes it once the flight starts.
- It also passes on when the PF leaves the flight or the session, or their sim run ends ([04-order-and-recovery](../sync/04-order-and-recovery.md#a-sim-that-closed); [leaving](../network/01-between-machines.md#leaving)), and then it goes only to a pilot still in the flight: one whose cockpit is up to date where there is one, and one still catching up or replaying only where none is.
  In v1 that's the PM, if they're in the flight; with more than two crew, which up-to-date pilot it goes to is this row's rule, which the pick for larger crews sets ([join modes](../product/ideas.md#join-modes)).
  A pilot whose catch-up is running when control reaches them stops catching up, since they're now the source.
- Once preflight has ended, a session with no pilot in the flight ends, so control never rests with a pilot who has no aircraft (user, 2026-10-12).
  That covers a PF who leaves while the PM is already out, two sims that crash, and a crew that leaves to load another aircraft, since a session flies one aircraft, its PF's, and a crew that wants another starts a new session ([01-format-and-delivery](../profiles/01-format-and-delivery.md#the-aircraft-and-its-variants)).
  Preflight comes only at a session's start.
- Each change raises the control value, and two made at once are settled by pilot ID ([control](../network/01-between-machines.md#control)).
- While the PF's link is lost, nothing changes: the PF flies on, a PM that lost the flying machine locks, and any pilot may take control, a PM with a warning ([while a link is lost](../network/01-between-machines.md#while-a-link-is-lost)).
- The session's authority moves with control ([the connection](../product/03-v1-scope.md#the-connection)), and a new PF writes the session channel's keys again under the new control value ([channels](../network/01-between-machines.md#channels)).

### The traffic and ATC host

- The traffic host is also the ATC host, as [hearing ATC](../product/03-v1-scope.md#hearing-atc) says, so v1 has one role for both, and the table lets it split into two.
  FS Copilot's build split them, giving traffic and ATC audio a host each (FS Copilot fork, `record/traffic-atc/docs/03-implementation-plan.md`, "Decisions locked with the user (2026-09-06)", row 1).
- A pilot takes the role by hand, turning on "Share my traffic and ATC" in the EFB app or the desktop app, and releases it by turning it off (user, 2026-10-11).
  Any pilot can take it at any time, from whoever holds it, by turning their own switch on, and the old host's switch turns off (user, 2026-10-13).
  Two pilots who turn it on at once are settled by the session channel's stamp, and the switch of the one who lost goes back off ([channels](../network/01-between-machines.md#channels)).
  FS Copilot's build allowed no taking over: "a toggle is disabled while someone else hosts that feature" (same document, same section, row 2).
  A pilot can take the role by mistake, or two can tussle over it, and the old host's ATC conversation ends, since the new host's ATC app starts its own; turning the switch on is deliberate, and crews settle it on voice.
  Taking the role automatically would need Crosscheck to tell which pilot runs a traffic injector, which [traffic sync](../product/03-v1-scope.md#traffic-sync)'s open questions leave unknown.
- The role stays with its holder through a lost link, a flight left, and a crash of their sim, core, or PC, and only leaving the session releases it.
  A host who comes back while still holding it sends their traffic again, with no switch to touch.
- A receiver keeps each sender's set of identities apart, and shows the objects of whoever the session channel names as host, spawning each it lacks whenever its sim is in a flight ([channels](../network/01-between-machines.md#channels)).
  The host's key and the identities travel on different streams, which QUIC keeps in no order, so a receiver that took identities only from the named host could drop a new host's first ones.
- Two rules remove copies, and cover every way a host stops (user, 2026-10-11):
  - When the session channel stops naming a pilot as host, because they released the role, left the session, or someone took it, every machine removes that host's copies, the new host's included, as FS Copilot removed a host's traffic once the host stopped (same document, "Decisions locked with the user (2026-09-06)", row 4).
  - A copy with no sample for 15s is removed, and its identity forgotten, as FS Copilot's receiver did (same document, "Key invariants"; read in the FS Copilot fork, `FsCopilot/Simulation/TrafficReceiver.cs`, `StaleAfter`, and line 413).
    That covers a host who went quiet, by a lost link, a flight left, or a crash, whose copies on the other machines stand still for up to 15s and go; an object comes back only when the host sends its identity again, which it does in full on every new connection ([coming back](../network/01-between-machines.md#coming-back)).
    A copy that kept its identity would be spawned again with no samples and removed again every 15s.
- The host sends each object's sample at least every 5s, moving or not, so a parked aircraft never goes 15s without one, as FS Copilot's host sent each at least every 5s and its receiver's 15s was "three heartbeats" (read in the FS Copilot fork, `FsCopilot/Simulation/TrafficHost.cs`, `Heartbeat`, and `TrafficReceiver.cs`, `StaleAfter`).
- FS Copilot also dropped a host's claim when the host's peer disconnected, which its networking judged after 15s without a packet, so it removed a dropped host's traffic after the same 15s as ours (read in the FS Copilot fork, `FsCopilot/Simulation/ShareSwitch.cs`, `OnPeers`, and `FsCopilot/Network/RelayNetwork.cs`, `DisconnectTimeout`).
- When the role passes to a new host, the old host stops sending ([traffic sync](../product/03-v1-scope.md#traffic-sync)).

## Roles after v1

[04-room-for-later](../product/04-room-for-later.md#roles) names the rows later picks add, each with the same columns: the machine that carries out ground services, which is the flying machine; a weather source; the ATC host's duty of taking the second pilot's microphone to ATC; and a flight engineer, whom control never passes to.
04-room-for-later lists passengers among those roles too, and here they're a kind of member instead, since nothing moves between passengers and no duty falls to one.
