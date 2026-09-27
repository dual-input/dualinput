# Networking: addresses and link quality

- [Addresses and ports: public vs. private addresses, what a home router does](#addresses-and-ports-public-vs-private-addresses-what-a-home-router-does)
- [Latency, jitter, loss, and bandwidth: typical figures on a LAN vs. the internet](#latency-jitter-loss-and-bandwidth-typical-figures-on-a-lan-vs-the-internet)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Transports and delivery modes are in [09-02-transports-and-delivery](09-02-transports-and-delivery.md), NAT and traversal in [09-03-nat-and-traversal](09-03-nat-and-traversal.md), relays and session setup in [09-04-relays-and-sessions](09-04-relays-and-sessions.md), serialization and security in [09-05-versions-and-security](09-05-versions-and-security.md), and the connection lifecycle in [09-06-connection-lifecycle](09-06-connection-lifecycle.md).

[Part 8](outline.md#8-synchronization-full) decided what the two apps send each other, and this part is about how the bytes get there.
In every chapter of this part, a peer is another pilot's copy of the app, and an endpoint is an IP address together with a port.
The worked examples come from FS Copilot's source in our fork, from our records of running it, and from measurements taken on our development machine while this part was written.

## Addresses and ports: public vs. private addresses, what a home router does

A PC at home has a private address that only machines on the same home network can reach, and the home router shares one public address among all of them.
The router rewrites each outgoing packet to come from that public address and a port it picks, and remembers the pair.
It lets in only packets that answer something sent out, so the PC can reach any server, and nothing on the internet can start a conversation with it.

**How it works.**
An IP address names a network interface, and a port, a number from 0 to 65535, names one socket on it.
A UDP packet carries a source endpoint and a destination endpoint, and a server's reply goes to whatever source endpoint the packet arrived with.

IPv4 addresses are 32 bits, too few for every device, so RFC 1918 sets aside three ranges for use inside private networks, which public routers don't carry [1]:

| Range | Size |
| --- | --- |
| `10.0.0.0` to `10.255.255.255` | 16,777,216 addresses |
| `172.16.0.0` to `172.31.255.255` | 1,048,576 addresses |
| `192.168.0.0` to `192.168.255.255` | 65,536 addresses |

Our development machine is `192.168.100.116`, wired to a router at `192.168.100.1`, and any number of other homes use the same numbers for their own machines [2].

Here is one packet leaving it: a STUN request, which asks a public server which endpoint the request arrived from ([09-03](09-03-nat-and-traversal.md#stun-turn-ice-and-hole-punching)) [2].

```text
our PC                      home router                          STUN server
192.168.100.116:54894  -->  rewrites the source to          -->  sees the request come from
                            <public address>:62856               <public address>:62856
                            and records the pair
192.168.100.116:54894  <--  rewrites the destination back   <--  replies to
                                                                 <public address>:62856
```

The rewriting is network address translation (NAT), and the recorded pair is a mapping.
A packet that arrives at the public address on a port with no mapping has nowhere to go, and the router drops it.
Two pilots at home each have a private address that the other can't route to, behind a router that drops whatever the other sends first, and the rest of this part is about getting packets between them anyway.
[09-03](09-03-nat-and-traversal.md) covers how NATs differ and how two apps get through them.

`127.0.0.1` is loopback: a packet sent to it never leaves the machine, which is why a panel's WebSocket to the app passes no router ([06-04](06-04-websockets-to-localhost.md#websockets-from-a-panel-to-localhost)).

IPv6 addresses are 128 bits, enough for every device to have a public one.
RFC 6092 still recommends that a home IPv6 router keep state for flows started from inside and filter unsolicited packets from outside [3], so IPv6 removes the rewriting and keeps the drop.
Our development machine has only a link-local IPv6 address, one starting `fe80::` that works on the home network alone, so it has no IPv6 route to the internet [2].

Remote SimConnect ([04-01](04-01-connection-and-data.md#connecting)) meets the same wall.
A client on another PC in the same home reaches the sim's private address and port, and a client across the internet can't address the sim's PC at all without a forwarding rule on its router ([09-03](09-03-nat-and-traversal.md#nat-types-cgnat-port-forwarding-upnp-and-nat-pmp)).

**What it changes for Crosscheck.**
Crosscheck can't assume either pilot's PC accepts a packet it didn't ask for, so every link has to start with both apps sending outward, either to each other at once or to a server both can reach.
Whether Crosscheck uses IPv6 where both pilots have it is an open question.

**Traps.**

- A private address names a different machine in every home, so `192.168.1.20` in one pilot's log means nothing on the other pilot's network.
- FS Copilot's apps look up the rendezvous and relay host once, take the first address DNS returns in either family, and never try another, so a published IPv6 address that doesn't work breaks every app whose resolver lists it first [4].

## Latency, jitter, loss, and bandwidth: typical figures on a LAN vs. the internet

Latency is how long a packet takes to arrive, jitter is how much that time varies from packet to packet, loss is the share of packets that never arrive, and bandwidth is how many bytes a second the path carries.
On our wired home network a round trip took about 2ms and nothing was lost, and across the internet a round trip takes tens to hundreds of milliseconds, set mostly by distance.
A cockpit sync sends a few kilobytes a second, a small fraction of any home connection.

**How it works.**
The round trip time (RTT) runs from sending a packet to receiving the answer, and it's what `ping` reports.
One-way latency is about half the RTT when both directions take the same path, and measuring it directly needs the offset between the two machines' clocks, which [08-05](08-05-position-and-clocks.md#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate) covers.

Measured from our development machine over 1 Gbps wired Ethernet on 2026-09-27 [2]:

| Target | Where | RTT min / avg / max | Lost |
| --- | --- | --- | --- |
| Home router | The same network | 0 / 2 / 17ms | 0 of 50 |
| `1.1.1.1` | Cloudflare's nearest site | 19 / 22 / 37ms | 0 of 50 |
| Two STUN servers | Google's | 39 to 41ms | 0 of 6 |
| Our relay | New York | 117 / 117 / 125ms | 0 of 30 |

Between well-connected data centers, WonderNetwork's hourly pings from London, 2026-09-13 to 2026-09-27, gave these round trips [5]:

| From London to | RTT, median |
| --- | --- |
| Frankfurt | 17ms |
| New York | 70ms |
| Los Angeles | 125ms |
| Sydney | 266ms |

Distance sets a floor.
Light in fiber covers about 200km per millisecond, so a round trip over the 5,600km from London to New York can't take less than about 56ms, and real routes are longer than the straight line.
A home connection adds its own leg on top of figures like these: our round trip to the nearest Cloudflare site was about 20ms.

Jitter is the spread: our pings to `1.1.1.1` took anything from 19 to 37ms.
A receiver that plays samples at a steady pace holds them in a buffer longer than that spread, which is the render delay in [08-05](08-05-position-and-clocks.md#position-and-attitude-freeze-and-set-slew-dead-reckoning-interpolation-buffers-jitter-time-shift-ground-contact): 400ms for FS Copilot's aircraft position, and 60ms for our fork's ATC audio [6].

Loss comes from router queues that overflow under load and from radio links such as Wi-Fi.
Our 136 pings lost none, over a wired link.
Our fork's ATC audio tool can add loss and delay to its own connection, and at 5% loss with 80ms ± 30ms of delay, Opus's loss concealment filled 50 of the 52 lost frames, and no frame arrived too late for the 60ms buffer [6].

A sync sends little.
FS Copilot's aircraft position packet is 116 bytes of fields [7].
On the wire it also carries a 1-byte packet ID, LiteNetLib's 4-byte header, the 8-byte UDP header, and the 20-byte IPv4 header, which makes 149 bytes, 20 times a second: about 3 KB/s (arithmetic from source [7] [8]).
Our fork's traffic sync sends 1.8 KB/s for 130 aircraft ([08-04](08-04-rates-actions-and-flight-controls.md#change-detection-sample-rates-bandwidth-budgets)), its ATC audio 16 to 27 kbps including headers [6], and its transport notes estimate a four-seat session through a relay at about 42 KB/s out of the relay [9].
Our machine's wired link runs at 1 Gbps [2].

**What it changes for Crosscheck.**
Crosscheck has to work from about 1ms of RTT on a LAN to 300ms or more between continents or through a relay, with jitter and loss, and every buffer that absorbs them is lag the other pilot sees.
At FS Copilot's rates, bandwidth isn't the constraint, and a relay's cost grows with its packet count ([09-04](09-04-relays-and-sessions.md#relays-when-theyre-needed-hosting-fan-out-cost)).
How much delay a pilot accepts on a control both pilots use is an open question.

**Traps.**

- A figure labeled ping can be half a round trip.
  FS Copilot's list of connected pilots shows `PING: ~N ms` [10], which on a direct link is LiteNetLib's `Ping`, documented as "Current one-way ping (RTT/2) in milliseconds" [8], and on a relay link half the round trip of the app's own ping and pong [11].
  Our traffic log reads a list showing 150–175ms through our New York relay as a round trip [12].
  That test ran two instances on one PC, so a ping from one to the other and its answer made two round trips to the relay: 232ms of network alone, at the 116ms our exerciser measured to that relay [13].
  We read the log's figure as half the round trip, and upstream's relay bears that out: our exerciser saw the list show 113–180ms through it, with 72ms to that relay, and a full round trip through it can't be shorter than 144ms [13].
- An app's round trip includes its own polling.
  FS Copilot's apps handle received packets every 15ms, its relay every 10ms, and LiteNetLib sends queued packets on a 15ms tick, so each stop can hold a message for up to one interval [11] [14] [15].
- One PC hides the network.
  Two instances on one machine link directly with almost no delay, and through a relay they pay a round trip to the relay each way: our exerciser puts a gesture's one-way delay at about 145ms through upstream's relay and 230ms through ours, and neither is a path between two cities [13].
- LiteNetLib's built-in loss and latency simulation does nothing in the package we use.
  `SimulatePacketLoss` and `SimulateLatency` are fields in the release assembly, but the methods that act on them are marked `[Conditional("DEBUG")]` [16], and in the 1.3.1 package's `net8.0` build, `NetManager.OnMessageReceived` calls neither [17].
  Our fork's bench sets those fields through its `netsim` command, and its record notes only that the fields are present [18].
  A test that relies on them runs on a perfect network, so loss has to be simulated some other way, such as the ATC audio tool's own `--loss`, `--delay`, and `--jitter` [6].

## Sources

1. Documented: Y. Rekhter and others, [RFC 1918, Address Allocation for Private Internets](https://www.rfc-editor.org/rfc/rfc1918), 1996-02, section 3.
2. Measured on our development machine, 2026-09-27, while writing this chapter, over wired Ethernet: `ipconfig`; `Get-NetAdapter` for the link speed; `ping -n 50` to the router and to `1.1.1.1`; `ping -n 30` to our relay; and a PowerShell script that sent a STUN Binding request from one UDP socket to each of `stun.l.google.com:19302`, `stun1.l.google.com:19302`, and `stun.cloudflare.com:3478`, run three times.
   No raw output is committed.
3. Documented: J. Woodyatt, [RFC 6092, Recommended Simple Security Capabilities in Customer Premises Equipment (CPE) for Providing Residential IPv6 Internet Service](https://www.rfc-editor.org/rfc/rfc6092), 2011-01, section 3.2.
4. Documented in our record: FS Copilot fork, `record/self-hosted-relay/docs/01-service-inventory.md`, "Finding: the client resolves one address and does not fall back", checked against `ResolveStunEndpoint` in `FsCopilot/Network/P2PNetwork.cs` and `ResolveRelayEndpoint` in `FsCopilot/Network/RelayNetwork.cs`, `ahead` branch at 9d4e864.
5. Documented: WonderNetwork, [Global Ping Statistics](https://wondernetwork.com/pings), the pages from London to Frankfurt, New York, Los Angeles, and Sydney, read on 2026-09-27; each figure is the median of the page's 336 hourly averages, rounded to the millisecond.
6. Measured on one PC, without the sim, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 3: the audio path works on one machine — Q10, Q12, Q13 settled".
7. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/Simulation/Physics.cs`, 13 doubles, a `ulong`, and a `uint`; and `FsCopilot/Network/Codecs.cs`, `Encode`, which writes a 1-byte packet ID before the fields.
8. Documented, read from source: [LiteNetLib](https://github.com/RevenantX/LiteNetLib) at tag 1.3.1: `LiteNetLib/NetConstants.cs`, `ChanneledHeaderSize`; and `LiteNetLib/NetPeer.cs`, `Ping` and its comment.
9. Documented in our record, arithmetic from design figures: FS Copilot fork, `record/traffic-atc/docs/04-transport.md`, section "What the relay costs at scale".
10. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/Views/MainWindow.axaml`, the `PING: ~{0} ms` binding; and `FsCopilot/ViewModels/MainViewModel.cs`, which fills it from `Peer.Ping`.
11. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Network/RelayNetwork.cs`: `OnPong`, which stores `rtt / 2`, and `PollLoop`, on a 15ms interval.
12. Measured on MSFS 2024, 2026-09-08: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-08 · Unreliable never crossed the relay; relay protocol v2, channels, budgets", the paragraph on the deployed relay.
13. Measured without the sim, 2026-09-17: FS Copilot fork, `record/exerciser/docs/log.md`, "2026-09-17 — A separate process can join FSC as a peer and trade PointerEvents both ways"; `record/exerciser/results/p01-peer-join-2026-09-17.txt`, which gives the relay ping "as reported by the peer list"; and `record/exerciser/docs/01-design.md`, section "Relay", which derives the one-way figures from the ICMP times.
    The build it ran, `ahead-pointer-forwarding` at 1ba64cc, halves the relay's round trip the same way.
14. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/Network/P2PNetwork.cs`, `Loop`; and `FsCopilot.Discovery/Relay.cs`, `TickMs`.
15. Documented, read from source: [LiteNetLib](https://github.com/RevenantX/LiteNetLib) at tag 1.3.1, `LiteNetLib/NetManager.cs`, `UpdateTime`.
16. Documented, read from source: [LiteNetLib](https://github.com/RevenantX/LiteNetLib) at tag 1.3.1, `LiteNetLib/NetManager.cs`: `HandleSimulateLatency` and `HandleSimulatePacketLoss`, both `[Conditional("DEBUG")]`.
17. Read from the assembly on our development machine, 2026-09-27: in the LiteNetLib 1.3.1 NuGet package's `lib/net8.0/LiteNetLib.dll`, which a .NET 9 app such as FS Copilot loads, the 41 bytes of IL in `NetManager.OnMessageReceived` call `HandleMessageReceived` and neither simulation method, and the `netstandard2.0` build is the same.
18. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/14-test-bench.md`, the paragraph on `netsim`, and `FsCopilot/Connection/BenchControl.cs`, `NetSim`, `ahead` branch at 9d4e864.

## Unverified claims

- **FS Copilot's relay ping of 150–175ms through our New York relay is half a round trip.**
  We read it from the source [10] [11] and the ICMP times [13].
  Logging LiteNetLib's `RoundTripTime` and the relay path's raw `rtt` beside the displayed ping, in one relayed session, would settle it.
- **LiteNetLib's `netsim` fields drop and delay nothing in FS Copilot's build.**
  We read it from the source and the IL [16] [17], and nobody has run it.
  Running the two-instance bench with `netsim` set to 50% loss and counting what arrives would settle it.
