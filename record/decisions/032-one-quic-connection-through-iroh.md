# 032: Every pair of cores holds one QUIC connection through iroh 1.3, directly or through our relays

Each core runs one iroh 1.3 endpoint, under a key drawn fresh for each session and kept in the session file, and holds one QUIC connection to every other core in the session.
iroh makes the connection directly when hole punching gets through both pilots' routers, and through one of our relays when it doesn't, and moves it between the two.
Each link is up, lost after 5s with nothing on its connection, when its core closes the connection and redials, or disconnected after 30 minutes without one.
Decided by the user on 2026-10-11, in node 2 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#every-pair-of-cores-holds-one-quic-connection-through-iroh-13-directly-or-through-our-relays).

## Context

The spine left to node 2 how the cores reach each other: the topology, the transport, getting through home routers, the relay, and encryption ([01-spine](../areas/architecture/01-spine.md#between-machines)), and how a core learns that another went quiet ([01-spine](../areas/architecture/01-spine.md#how-the-core-knows-a-component-is-alive)).
[02-live-sync](../areas/sync/02-live-sync.md#one-stream-in-causal-order) left step 7 to choose whether each machine sends to every other directly or through the flying machine.
Node 2's answer is [01-between-machines](../areas/network/01-between-machines.md), and these needs shaped it:

- Each channel needs its own delivery: a stream that resends for messages that must arrive, and packets sent once for what the next message replaces, such as the flight model, the avatars, and ATC audio ([architecture plan](../areas/architecture/plan.md#21-carrying-a-sessions-traffic)).
- No source measured home simmers, and research on other populations put the share of pilot pairs that can't connect directly between 5% and 31% ([network log, 2026-10-06](../areas/network/log.md#2026-10-06-research-puts-the-share-of-pilot-pairs-that-need-the-relay-between-5-and-31-and-one-small-servers-transfer-covers-tens-of-thousands-of-session-hours-a-month)).
- Encryption isn't a requirement, because nothing a session carries is sensitive, so a transport that encrypts anyway is judged only on the bytes its encryption adds (user, 2026-10-09).
- A developer runs a whole session on one PC, with two cores, each with its own ports and identity ([the product plan](../areas/product/plan.md#7-tech-stack-and-architecture)).

## Options

For the transport, node 2.1's research weighed these ([network log, 2.1][n21]):

1. **iroh 1.3 as it is.**
   Its relay carries everything over TCP, so a lost packet holds back every channel until TCP resends it, and it sends on one path at a time, so it sends no copies while a direct link is in doubt.
   It led on two conditions nobody had measured: that its relay's stalls not show in flight data and ATC audio, and that its move to the relay when a direct link dies silently be fast enough.
2. **iroh with TURN plugged in**, through its `unstable-custom-transports` feature.
   It would keep an iroh relay of ours and the idle-timer switch, on an API with no semver promise, which broke in 1.1.0.
3. **ICE through `is`, TURN, and quinn.**
   Its glue is about 2,500 to 4,000 lines plus a test harness, by one agent's estimate, and a Cloudflare TURN allocation serves 10 peer addresses and is then spent, with nothing but a `400` on ChannelBind to say so ([network log, 2026-10-10](../areas/network/log.md#2026-10-10-a-cloudflare-turn-allocation-exchanges-data-with-10-peer-addresses-over-its-life-and-silently-drops-everything-to-or-from-an-11th)).
4. **WebRTC through str0m, with TURN.**
   Its SCTP layer serves channels from two first-in-first-out queues with no priority between them, and it adds about 65 bytes a packet with DTLS 1.2, against about 30 for QUIC.
5. **WebRTC through webrtc-rs.**
   Set aside for its open relay bugs.
6. **Valve's GameNetworkingSockets.**
   Set aside for its unsafe calls and its C++ build.
7. **rust-libp2p.**
   It has no one-off packets or priorities, and its relay is capped by default at 2 minutes and 128 KiB.
8. **quinn with our own hole punching, or a UDP protocol of our own.**
   Hole punching's success rate rests on edge cases in routers we can't reproduce, and each pair it fails relays (user, 2026-10-10), and a protocol of our own means building all of it.
9. **No hole punching.**
   Too many pairs would relay.

For the links themselves, the record weighed these too:

1. **Sending everything through the flying machine.**
   It adds a hop between following machines and has to re-form at every handover ([02-live-sync](../areas/sync/02-live-sync.md#one-stream-in-causal-order)).
2. **Keeping a connection through an outage, rather than closing it and redialing.**
   One that lived through a 10s outage carried data 5s to 7s after the link returned, where a redialed connection carried data 0.3s to 1.4s after a total outage ended ([network log, p07][p07]).
3. **Settling two connections between a pair by who is PF.**
   After a takeover during a cut, each side counts itself PF, keeps the other's dial, closes the one the other kept, and redials again.
   The relay such a rule would choose, the dialed endpoint's home relay ([network log, p05][p05]), helps only when the PF's own link loses packets ([network log, 2.3][n23]).
4. **Settling them by each side listing the connections it still holds.**
   Each side could close the other's, because both sent their first message before seeing the other's dial.
5. **An endpoint key that outlives a session.**
   It would let the backend and the relays link every session one pilot joins (user, 2026-10-11).

## Decision

iroh 1.3 as it is, with a connection between every pair, closed and redialed when lost, settled by restart count and endpoint ID, under a key drawn for each session.
iroh finds paths, opens router ports, and relays with no glue of ours, where ICE through `is` with TURN and quinn needs about 2,500 to 4,000 lines by an agent's estimate ([network log, 2.1][n21]).
Node 2.3 measured its two conditions across home networks: from each of two friends' to ours, 10 of 10 connections went direct, and iroh's relay and its move to the relay met the pass lines the user set, which accept a 2s path idle timeout and a relay over TCP with an adaptive buffer for ATC audio (user, 2026-10-10; [network log, 2.3][n23]).
A rule that each side applies from what it holds itself picks the same connection however two dials race, and endpoint IDs are the one thing both sides of a pair always agree on.
Two endpoints in two processes on one PC each drew their own endpoint ID and ports and connected directly in 2.2ms ([network log, p04][p04]).

## What it commits us to

- Any packet on a connection counts as hearing from a member, and a heartbeat goes once a second, which answers how a core learns another went quiet ([01-between-machines](../areas/network/01-between-machines.md#the-link-between-two-cores)).
- A joining core dials every member, and after a lost link both cores redial.
  Of two connections between a pair that pass their first message, a higher restart count closes the older restart's connection, of two from one restart the one the lower endpoint ID dialed stays, and of two one side dialed, the newer.
- A core keys what it keeps about a sender by the sender's pilot ID and restart count, never by a connection.
  v1 forwards nothing, and a later feature that forwards carries each message's sender with it.
- QUIC's TLS 1.3 encryption stays on, since QUIC has no mode without it, and Dual Input builds nothing for encryption ([01-between-machines](../areas/network/01-between-machines.md#encryption)).
- Dual Input pins the exact versions of iroh, noq, and `iroh-relay`, because the design leans on behavior iroh keeps private and a minor release may change, and an upgrade is a change of its own ([01-between-machines](../areas/network/01-between-machines.md#iroh-as-a-dependency)).
- On Windows, iroh 0.96.1's `bind` hung on about half of one game's players' PCs (documented in iroh's issue #3968, as [research report 02](../areas/network/results/2026-10-10-transport-research-reports/02-iroh.txt) summarizes it; unverified on iroh 1.3), so a release build targets the baseline x86-64 CPU, and the core binds its endpoint under a timeout ([01-between-machines](../areas/network/01-between-machines.md#iroh-as-a-dependency)).
- Two cores on one PC link directly, so CI runs the network's tests with a core's IP transports cleared, against an `iroh-relay` on the same PC ([01-between-machines](../areas/network/01-between-machines.md#two-cores-on-one-pc)).
- The 5s and the 30 minutes are starting values that v1's recordings tune ([01-between-machines](../areas/network/01-between-machines.md#left-open)).
- Our relays are [decision 033](033-relays-run-iroh-relay-unmodified.md)'s, and how each channel travels on the connection is [decision 035](035-channels-declare-how-they-travel.md)'s.
- It leaves out Wi-Fi, carrier-grade NAT, double NAT, mobile links, and two friends' routers paired with each other, which no run has covered and v1's recordings count ([01-between-machines](../areas/network/01-between-machines.md#the-way-through-home-routers)).

[n21]: ../areas/network/log.md#2026-10-10-iroh-13-leads-for-carrying-a-session-between-home-pcs-provided-its-tcp-relays-stalls-dont-show-and-its-switch-to-the-relay-can-be-made-fast
[n23]: ../areas/network/log.md#2026-10-10-iroh-moves-to-the-relay-one-path-idle-timeout-after-a-direct-link-dies-and-back-within-60s-and-at-3-loss-its-tcp-relays-p99-lateness-grows-with-the-round-trip-to-the-relay-from-53ms-at-22ms-away-to-534ms-at-131ms
[p04]: ../areas/network/log.md#2026-10-11-two-iroh-endpoints-in-two-processes-on-one-pc-each-with-its-own-key-and-ports-connect-directly-over-the-pcs-own-address
[p05]: ../areas/network/log.md#2026-10-11-when-two-endpoints-home-at-different-relays-iroh-carries-both-directions-through-the-dialed-endpoints-home-relay-so-whoever-dials-picks-the-relay
[p07]: ../areas/network/log.md#2026-10-11-after-a-total-outage-a-redialed-connection-carries-data-03s-to-14s-after-the-link-returns-while-one-that-lived-through-a-10s-outage-takes-5s-to-7s
