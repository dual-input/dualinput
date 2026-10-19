# 044: v1's table of roles holds the PF and the traffic and ATC host, whom a pilot chooses by hand

v1's table of roles gives each role who may hold it, how it moves, and what happens when its holder loses the link, leaves the flight, or leaves the session, and it holds two rows: the PF and the traffic and ATC host.
A pilot in the flight takes control by the take-control key or button, or by voice, unless their own catch-up or replay runs over a link that's up, and when the PF leaves the flight, control passes to a pilot still in it; a lost link changes nothing.
Any pilot takes the traffic and ATC host's role at any time by turning on "Share my traffic and ATC", which turns the old host's switch off, and the host releases it by turning theirs off; through a lost link, a flight left, or a crash it stays with its holder until they leave the session.
Decided by the user on 2026-10-11, 2026-10-12, and 2026-10-13, in node 3 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#v1s-table-of-roles-holds-the-pf-and-the-traffic-and-atc-host-whom-a-pilot-chooses-by-hand).

## Context

The PF, the pilot flying, holds control, and the PM, the pilot monitoring, is the other front-seat pilot ([03-v1-scope](../areas/product/03-v1-scope.md)).
[04-room-for-later](../areas/product/04-room-for-later.md#roles) asks v1 for one table of roles, each with its rule for who holds it, how it moves, and what happens when its holder drops out, so the picks after v1 add rows rather than mechanisms, and for a member list in which each member is crew or a passenger ([people beyond the crew](../areas/product/04-room-for-later.md#people-beyond-the-crew)).
Node 2 settled how the control value travels and left who may change control, and when, to this table ([decision 036](036-control-is-one-value.md)).
[Traffic sync](../areas/product/03-v1-scope.md#traffic-sync) gives the traffic host a role of its own, separate from control, and asks whether the host is chosen by hand or taken automatically by whoever has traffic.

FS Copilot's build had no taking over, "a toggle is disabled while someone else hosts that feature", removed a host's traffic once the host stopped, withdrew hosting while the host's sim was disconnected, and removed a copy after 15s without a sample (FS Copilot fork, `record/traffic-atc/docs/03-implementation-plan.md`, "Decisions locked with the user (2026-09-06)", rows 2 and 4, and "Key invariants").
It dropped a disconnected host's claim after the 15s its networking took to call a peer gone, sent each object at least every 5s, and forgot an identity with its stale copy (read in the FS Copilot fork, `FsCopilot/Simulation/ShareSwitch.cs`, `OnPeers`, `FsCopilot/Network/RelayNetwork.cs`, `DisconnectTimeout`, `FsCopilot/Simulation/TrafficHost.cs`, `Heartbeat`, and `TrafficReceiver.cs`, line 413).

## Options

How the traffic and ATC host is chosen:

1. **Taken automatically, by whoever has traffic.**
   Dual Input would need to tell which pilot runs a traffic injector, which is unknown ([traffic sync](../areas/product/03-v1-scope.md#traffic-sync)).
2. **Chosen by hand and kept until released, as FS Copilot's build kept it.**
   A role nobody can take from its holder needs a rule that frees it from a host who went quiet, and stays with a host who doesn't come back (user, 2026-10-13).
3. **Chosen by hand, and any pilot can take it at any time.**
   A pilot can take the role by mistake, or two can tussle over it, and the old host's ATC conversation ends, since the new host's ATC app starts its own ([roles and members](../areas/session/01-roles-and-members.md#the-traffic-and-atc-host)).

How many host roles:

4. **A host each for traffic and ATC audio, as FS Copilot's build split them** (FS Copilot fork, `record/traffic-atc/docs/03-implementation-plan.md`, "Decisions locked with the user (2026-09-06)", row 1).
   [Hearing ATC](../areas/product/03-v1-scope.md#hearing-atc) makes the traffic host the ATC host, and treats the one case that wants two hosts, an ATC app that injects no traffic on one machine beside a traffic injector on another, as too rare to support in v1.
5. **One role for both, which the table lets split into two later.**

What a quiet host's role does:

6. **Drop a quiet host's claim, as FS Copilot did after the 15s its networking took to call a peer gone.**
   Dropping the claim would remove a quiet host's copies no sooner than the rule that removes a copy after 15s with no sample, since FS Copilot's networking also took 15s to call a peer gone, and a host who came back would have to turn the switch on again ([roles and members](../areas/session/01-roles-and-members.md#the-traffic-and-atc-host)).
7. **Keep the role with its holder through a lost link, a flight left, or a crash.**
   A quiet host's copies stand still for up to 15s before they go.

When control can move:

8. **Any pilot, at any time, as [the take-control key](../areas/product/03-v1-scope.md#take-control-key) rules.**
   Control could rest with a pilot who has no aircraft in a flight.
9. **Only to a pilot in the flight, with the take-control input live only after preflight, a session flying one aircraft, and a session with no pilot in the flight ending.**
   Nobody takes control in the main menu or at the gate before the countdown, and a crew that wants another aircraft starts a new session ([roles and members](../areas/session/01-roles-and-members.md#the-pf)).

Where passengers go:

10. **A row in the table, as 04-room-for-later lists them among the roles.**
    Nothing moves between passengers, and no duty falls to one ([roles and members](../areas/session/01-roles-and-members.md#roles-after-v1)).
11. **A kind of member, beside crew.**

## Decision

Options 3, 5, 7, 9, and 11.
Pilots who all want the best for the session settle a tussle over the switch on voice, so a role anyone can take needs no rule that frees it from a host who went quiet, and covers a host who doesn't come back (user, 2026-10-13).
Keeping the role while its holder is quiet costs up to 15s of copies standing still, which the user accepted for the simpler design (user, 2026-10-11).
Control that rests only with a pilot in the flight never lands on one with no aircraft, and a session with nobody in the flight has nothing left to sync, so starting a new one is the clean way back (user, 2026-10-12).

## What it commits us to

- Each member writes its own entry on the session channel, crew in v1 and passenger later; crew members hold vector clock counters and acknowledge on the heartbeat, and a passenger, on a one-way feed off the crew's links, holds nothing up.
- Any crew member may hold control, which moves by the take-control key or button, or by voice, to any pilot but one whose own catch-up or replay runs over a link that's up, or, when the PF leaves the flight or the session or their sim run ends, to a pilot still in the flight, an up-to-date one where there is one, the PM in v1; a lost link changes nothing.
- The take-control input is live only while its pilot is in the flight, after preflight; once preflight has ended, a session with no pilot in the flight ends; and a session flies one aircraft, its PF's, with preflight only at its start.
- The host releases the role by turning the switch off, a pilot who takes it turns the old host's switch off, and of two who turn it on at once, settled by the session channel's stamp ([decision 035](035-channels-declare-how-they-travel.md)), the loser's switch goes back off ([roles and members](../areas/session/01-roles-and-members.md#the-traffic-and-atc-host)).
- Two rules remove a host's copies: when the session channel stops naming a pilot as host, every machine removes that host's copies, and a copy with no sample for 15s is removed and its identity forgotten, while the host sends each object's sample at least every 5s.
- A receiver keeps each sender's set of traffic identities apart and shows the objects of whoever the session channel names as host.
  The host's key and the identities travel on different streams, which QUIC keeps in no order, so a receiver that took identities only from the named host could drop a new host's first ones ([roles and members](../areas/session/01-roles-and-members.md#the-traffic-and-atc-host)).
- It answers [traffic sync](../areas/product/03-v1-scope.md#traffic-sync)'s question of how the host is chosen, and builds the table [04-room-for-later](../areas/product/04-room-for-later.md#roles) asks v1 for ([roles and members](../areas/session/01-roles-and-members.md)).
- It leaves to the picks that need them which pilot receives control when the PF leaves a crew of more than two, and hosts of their own for traffic and ATC.
