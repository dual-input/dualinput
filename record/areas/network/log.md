# Network: log

What we found about connecting the crew's machines, directly or through our relay, newest entry first.

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
