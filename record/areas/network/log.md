# Network: log

What we found about connecting the crew's machines, directly or through our relay, newest entry first.

## 2026-10-06: Research puts the share of pilot pairs that need the relay at 10% to 30%, and the relay's cost in its server, not its traffic

**Asked:** what share of pilot pairs can't connect directly, which decides how much traffic the relay carries ([the plan](../product/plan.md)'s step 6, [01-aims](../product/01-aims.md#relay-and-license))?

**Expected:** no prediction.

**Found:** no source measured home simmers, so the share comes from other populations and from arithmetic on them, by a research agent on 2026-10-06:

| Source | Data from | What was counted | Result | Kind |
| --- | --- | --- | --- | --- |
| [Trautwein et al.](https://arxiv.org/abs/2510.27500), the libp2p hole-punching campaign | 2022-12 | 4.4M hole punches between IPFS peers in 859 networks and peers in 85,000 more | 70% ± 7.1% connected directly, TCP and QUIC alike; 97.6% of those on the first try | Measured |
| [ProbeLab](https://probelab.io/blog/can-libp2p-punch-through-nats/) | Published 2026-08 | 43,684 IPFS peers, by the kind of NAT each sat behind | 3.9% behind a symmetric NAT, the kind that defeats a plain hole punch | Measured |
| [callstats.io, via webrtcHacks](https://webrtchacks.com/usage-stats/) | 2015-01 to 2016-02 | WebRTC conferences in the apps of 100 or more customers | 22% relayed, 9% over TCP | Measured by a vendor, method unpublished |
| Tailscale, [NAT traversal improvements](https://tailscale.com/blog/nat-traversal-improvements-pt-1) | Published 2025-10 | Connections between Tailscale's machines, many of them servers | "well north of 90%" direct | Claimed |
| [Richter et al.](https://arxiv.org/abs/1605.05606), IMC 2016 | To 2016-03 | Carrier-grade NAT (CGNAT) in home and mobile networks | in 17% to 18% of fixed-line networks and over 90% of mobile ones | Measured |

- A pair fails when both pilots sit behind a symmetric NAT, or one does and the other's router doesn't accept packets from an unknown port.
  With h the share of pilots behind a symmetric NAT, o the share of the rest whose router accepts such packets, and f the failure rate between two routers that should connect, the failing share is h² + 2h(1−h)(1−o) + (1−h)²f.
  With h from 5% to 10%, o unknown, and f from 5% to 15%, that's 11% to 29%.
- Three things lower it, by amounts nobody has measured for a population like ours: IPv6 on both ends, asking the router to open a port with UPnP, NAT-PMP, or PCP, which does nothing behind CGNAT, and probing many ports on a symmetric NAT, which Tailscale calculates connects 98% of such pairs in about 10s ([How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)).
  With all three, the estimate is 5% to 10% (unverified).
- YourControls offers a relay of its own, "capped at 100 users", and recommends it only when its other two modes fail ([YourControls docs](https://docs.yourcontrols.org/running.md)); neither it nor FS Copilot publishes how many sessions need it.
- FS Copilot tries UPnP, then NAT-PMP, then a hole punch for 4s, and then its relay (read in the FS Copilot fork, `FsCopilot/Network/HybridNetwork.cs` and `P2PNetwork.cs`), and its relay ran on a $4 DigitalOcean droplet with 500 GB of transfer a month (FS Copilot fork, `record/traffic-atc/docs/04-transport.md`).
- A pilot sends about 5 KB/s in FS Copilot's profiles, a contributor's figure, not a measurement (FS Copilot profiles, `docs/synchronization.md`).
  At that rate, a relayed two-pilot session is 36 MB an hour, and 500 GB carries about 13,900 relayed session-hours a month.

**Changed:** at any share in that range, the relay's cost is its server's price, not its traffic, unless Crosscheck sends far more than FS Copilot does, so the aim of about $10 a month holds.
Crosscheck connects directly first, with IPv6, a port opened on the router, and port probing, and falls back to the relay.
The real share for our pilots gets measured later: a script that friends run for a minute, with no sim, can report the kind of NAT each sits behind, and opt-in telemetry after launch can count the sessions that went through the relay.

**Affects:** [01-aims](../product/01-aims.md#relay-and-license), and the plan's step 6.

**Evidence:** the sources above; no probe ran.
