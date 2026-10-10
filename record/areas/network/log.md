# Network: log

What we found about connecting the crew's machines, directly or through our relay, newest entry first.

## 2026-10-10: A Cloudflare TURN allocation exchanges data with 10 peer addresses over its life, and silently drops everything to or from an 11th

**Asked:** does a Cloudflare Realtime TURN allocation stop relaying once it has exchanged data with 10 distinct peer transport addresses (IP and port), as a developer reported in [cloudflare/cloudflare-docs#33972](https://github.com/cloudflare/cloudflare-docs/issues/33972), opened 2026-10-04 and unanswered by Cloudflare as of 2026-10-10?
Node 2.1 of the [architecture plan](../architecture/plan.md), how the crew's cores carry traffic, leads with Cloudflare Realtime TURN as the relay, and a cap matters to it: a design with one relayed connection per allocation addresses one peer, but ICE checks several remote addresses from one relayed candidate.

**Expected:** no prediction, since the issue reports the cap and Cloudflare's [TURN page](https://developers.cloudflare.com/realtime/turn/) states only rates per allocation, ">5 new IP/sec" among them, and no total.

**Found:** the cap holds as the issue describes it, and it counts every peer address an allocation has sent to, heard from, or bound a channel to, across IPs, for the allocation's whole life (measured 2026-10-10 with [p01-turn-peer-cap](../../../experiments/areas/network/p01-turn-peer-cap.mjs)).
Each peer was a UDP socket on one PC, sending through a router that gave it its own public port on our public IP, the same port whatever the destination, so the relay saw each peer at the port STUN reported.

- Of 15 peers sending to one allocation in turn, 2s apart, the first 10 got every datagram through as Data indications, and the 11th to 15th got none, with no error to either side.
- Nothing reaches an 11th address either.
  Send indications to it never arrived, and ChannelBind to it failed with `400` and an empty reason phrase, the cap's only visible sign.
  The first 10 took Send indications, ChannelBind, and ChannelData in both directions.
- Sending first takes a slot.
  An allocation that had heard from nobody sent Send indications to 12 peers in turn: the first 10 received them, and the 11th and 12th received nothing, then couldn't send to it.
  A ChannelBind before any data takes one too: 10 succeeded, and the 11th and 12th got `400 ""`.
  Each peer had first opened its NAT toward the relay with a datagram whose TTL of 4 expired before Cloudflare, 9 hops away, and the relay heard none of those.
- The count spans IPs.
  An allocation heard from a second IP, 8 ports on our IP, and a third IP, the second and third being other Cloudflare allocations' relayed addresses, and then refused a fourth IP and a ninth port on our IP.
- Twenty peers sending at once got exactly 10 through, but not the first 10 sent: the 10th was refused and the 11th got through.
- Refreshing keeps the count: a 16th peer got nothing after a Refresh with `LIFETIME` 600.
- Quiet peers keep their slots.
  The allocation was refreshed, and its permission for our IP renewed, every 2 minutes.
  5.5 minutes after the 10 peers had last sent, one of them still got through and a new peer got nothing, and 10.5 minutes after, past the 600s channel lifetime, another of them got through and another new peer got nothing.
- A lapsed permission frees no slot either.
  After 5.5 minutes with no CreatePermission, a peer holding a slot got nothing, which showed the permission had lapsed.
  After a new CreatePermission, another peer holding a slot got through, and a new peer got nothing.
- A new allocation starts at zero.
  A fresh allocation heard from the same 15 peers in reverse order, took the 5 the first had refused and 5 more, and refused the last 5, which the first had taken.
  Deleting an allocation and allocating again from the same client socket also starts at zero.
- A peer that holds a slot keeps it: one sending once a second throughout got 669 of 669 datagrams through over 11 minutes.
- Two Cloudflare allocations relay to each other: data went both ways between one allocation and two others' relayed addresses.
  Allocations don't share one relayed IP: 8 in one run used 6 relayed IPs.
- This connection forgets an idle UDP mapping after between 120s and 150s, which spoiled the permission check in two of our three idle runs.
  Cloudflare never answered the Refreshes of an allocation whose client socket had been silent for about 130s, and a peer that held a slot got nothing after 5.5 quiet minutes, presumably because each came back on a new public port (unverified).
  With every socket sending a STUN Binding request every 15s, both worked.

**Changed:** a Cloudflare allocation serves 10 peer addresses and is then spent, and nothing but a `400` on ChannelBind says so.
So a core that relays through Cloudflare must take a new allocation before it addresses an 11th, whether the peer reconnected from a new port or ICE has more remote candidates to check than the allocation has slots left.
One allocation per relayed connection spends a slot each time the peer's address changes, and ICE spends one on each remote candidate it checks from the relayed candidate, before any pair wins.
When both pilots need the relay, their two allocations can relay to each other.
On a connection like this one, a socket quiet for 2 minutes loses its public port, so a core's keepalives must come more often than that, to the relay and to a direct peer alike.

**Affects:** node 2.1 of the [architecture plan](../architecture/plan.md).

**Evidence:** [p01-turn-peer-cap](../../../experiments/areas/network/p01-turn-peer-cap.mjs) and its output in [results](../../../experiments/areas/network/results/): phases 1 to 5 in `p01-turn-peer-cap-2026-10-10-08-34-08.txt`, phase 7 in `p01-turn-peer-cap-2026-10-10-08-39-06.txt`, and phase 6, with its controls, in `p01-turn-peer-cap-2026-10-10-08-54-57.txt`.
The idle runs `p01-turn-peer-cap-2026-10-10-08-36-28.txt` and `p01-turn-peer-cap-2026-10-10-08-46-48.txt` came before the keepalives: their checks on quiet peers agree, and the NAT spoiled their permission checks.

## 2026-10-06: Research puts the share of pilot pairs that need the relay between 5% and 31%, and one small server's transfer covers tens of thousands of session-hours a month

**Asked:** what share of pilot pairs can't connect directly, which decides how much traffic the relay carries ([the plan](../product/plan.md)'s step 6, [01-aims](../product/01-aims.md#relay-and-license))?

**Expected:** no prediction.

**Found:** no source measured home simmers, so the share comes from other populations and from arithmetic on them, gathered by a research agent and checked against each source on 2026-10-06:

| Source | Data from | What was counted | Result | Kind |
| --- | --- | --- | --- | --- |
| [Trautwein et al.](https://arxiv.org/abs/2510.27500), the libp2p hole-punching campaign | 2022-12 | 4.4M hole punches from volunteers' clients in 859 networks to peers in about 87,000 more | 70% ± 7.1% connected directly, TCP and QUIC alike, and 97.6% of those on the first try; the authors warn their volunteers may sit on friendlier networks than most | Measured |
| [ProbeLab](https://probelab.io/blog/can-libp2p-punch-through-nats/) | Published 2026-08-03 | 43,684 IPFS peers, publicly reachable ones included, by the kind of NAT each sat behind | 3.9% behind a symmetric NAT, a lower bound, since 42.5% couldn't be told apart; a plain hole punch usually can't get through one, and the 39.7% that did, the authors doubt | Measured |
| [callstats.io, via webrtcHacks](https://webrtchacks.com/usage-stats/) | 2015-01 to 2016-02 | Conferences in the WebRTC apps of 100 or more customers, mostly conferencing products | 22% needed a relay, and 9% needed TCP | Measured by a vendor, method unpublished |
| Tailscale, [NAT traversal improvements](https://tailscale.com/blog/nat-traversal-improvements-pt-1) | Published 2025-10-15 | Connections between Tailscale's machines in typical conditions | "well north of 90%" direct | Claimed |
| [Richter et al.](https://arxiv.org/abs/1605.05606), IMC 2016 | To 2016-03 | Carrier-grade NAT (CGNAT), counted by network, not by subscriber | in 17% to 18% of fixed-line ISPs' networks and over 90% of mobile ones | Measured |

- A pair fails when both pilots sit behind a symmetric NAT, or one does and the other's router doesn't accept packets from an unknown port.
  With h the share of pilots behind a symmetric NAT, o the share of the rest whose router accepts such packets, and f the failure rate between two routers that should connect, the failing share is h² + 2h(1−h)(1−o) + (1−h)²f.
  We assumed h from 5% to 10% and f from 5% to 15%, which no source gives (unverified), and o is unknown, so the share runs from 5%, with every router accepting, to 31%, with none.
- Three things lower it, by amounts nobody has measured for a population like ours:
  - IPv6 on both ends;
  - asking the router to open a port with UPnP, NAT-PMP, or PCP, which would do nothing behind CGNAT (unverified);
  - probing many ports, which Tailscale calculates connects 98% of pairs with one symmetric NAT in about 10s at 100 probes a second, if the symmetric side has 256 ports open, while two symmetric NATs need about 170,000 probes a side ([How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)), so probing doesn't help the h² term.
- YourControls caps its own relay, Cloud Host, at 100 connections, and asks pilots to use it only when its other two modes fail ([YourControls docs](https://docs.yourcontrols.org/running.md)).
  Neither it nor FS Copilot publishes how many sessions need a relay.
- FS Copilot asks the router for a UPnP mapping at startup, waiting 3s for a device, and its NAT-PMP fallback waits another 3s but discards what it finds, so it never makes a NAT-PMP mapping.
  For each peer it then tries a hole punch through its rendezvous server for 4s, then its relay (read in the FS Copilot fork, `ahead` branch, `FsCopilot/Network/P2PNetwork.cs`, `Start` and `GetNat`, and `HybridNetwork.cs`, `DirectAttemptTimeout`; [09-03](../../learn/foundations/09-03-nat-and-traversal.md) says the same).
- The FS Copilot fork's own relay runs on a $4 DigitalOcean server with 500 GB of transfer a month (FS Copilot fork, `record/self-hosted-relay/docs/03-runbook.md`).
- A pilot sends about 5 KB/s, by an estimate from packet sizes in an FS Copilot architecture document older than its code, with the rate of variable updates assumed, not measured (FS Copilot profiles, `docs/synchronization.md`).
  At that rate, a relayed two-pilot session sends 36 MB an hour out of the relay, the direction DigitalOcean bills, so 500 GB carries about 13,900 relayed session-hours a month.

**Changed:** one $4 server carries the relayed sessions until crews fly about 46,000 hours a month in all, if 30% of them go through the relay, and more if fewer do, so the aim of about $10 a month holds while Crosscheck stays that small and sends no more than FS Copilot does; how many hours crews will fly is unknown.
Crosscheck connects directly first, with IPv6, a port opened on the router, and port probing, and falls back to the relay.
The real share for our pilots gets measured later: a script that friends run for a minute, with no sim, can report the kind of NAT each sits behind, and opt-in telemetry after launch can count the sessions that went through the relay.

**Affects:** [01-aims](../product/01-aims.md#relay-and-license), and the plan's step 6.

**Evidence:** the sources above; no probe ran.
