# Networking: NAT and traversal

- [NAT types, CGNAT, port forwarding, UPnP and NAT-PMP](#nat-types-cgnat-port-forwarding-upnp-and-nat-pmp)
- [STUN, TURN, ICE, and hole punching](#stun-turn-ice-and-hole-punching)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Addresses and link quality are in [09-01-addresses-and-link-quality](09-01-addresses-and-link-quality.md), transports and delivery modes in [09-02-transports-and-delivery](09-02-transports-and-delivery.md), relays and session setup in [09-04-relays-and-sessions](09-04-relays-and-sessions.md), serialization and security in [09-05-versions-and-security](09-05-versions-and-security.md), and the connection lifecycle in [09-06-connection-lifecycle](09-06-connection-lifecycle.md).

As in [09-01](09-01-addresses-and-link-quality.md), a peer is another pilot's copy of the app, an endpoint is an IP address with a port, and a mapping is a NAT's record that pairs a private endpoint with the public endpoint it rewrites it to.

## NAT types, CGNAT, port forwarding, UPnP and NAT-PMP

NATs differ in two behaviors: whether a socket keeps one public port for every destination or gets a new one for each, and which outside senders may use that port to reach it.
Carrier-grade NAT (CGNAT) is a second NAT that the internet provider runs in front of the home router.
Port forwarding, UPnP, and NAT-PMP open a port on the home router only, so behind CGNAT they open nothing the internet can reach.

**How it works.**
[09-01](09-01-addresses-and-link-quality.md#addresses-and-ports-public-vs-private-addresses-what-a-home-router-does) followed one packet: our PC's `192.168.100.116:54894` left the router as `<public address>:62856`.
RFC 4787 describes a NAT by two behaviors of that mapping [1].

The mapping behavior says which public endpoint the same socket gets when it sends to a second destination:

- **Endpoint-independent mapping** reuses the same public endpoint for every destination.
- Address-dependent mapping reuses it only for the same destination address.
- Address and port-dependent mapping makes a new one for every destination address and port.

RFC 4787 requires the first, in its REQ-1, because failing it "will force the use of a UDP relay" [1].

The filtering behavior says which packets arriving at the public endpoint get through [1]:

- Endpoint-independent filtering lets in any packet, once the inside has sent something out.
- Address-dependent filtering lets in only packets from addresses the inside has sent to.
- Address and port-dependent filtering lets in only packets from endpoints the inside has sent to.

Older writing, FS Copilot profiles' networking doc among it, sorts NATs into full cone, restricted cone, port restricted cone, and symmetric, names that RFC 4787 set aside because the terminology "has been the source of much confusion" [1] [2].
The one that matters most here is symmetric NAT, which that doc describes as assigning "different ports per destination" [2], the mapping behavior RFC 4787 requires a NAT not to have.

Our development machine's NATs map endpoint-independently.
In each of three runs, one socket sent STUN requests to three servers at two providers, and all three saw the same public port [3].
The public port wasn't the private one, 62856 for 54894, and we didn't measure the filtering.

A mapping lasts only while packets use it.
RFC 4787 requires an idle UDP mapping to last at least two minutes and recommends five [1], and RFC 8085 warns that "a significant fraction of currently deployed middleboxes unfortunately use shorter timeouts" [4].

**CGNAT.**
When an internet provider runs short of public IPv4 addresses, it gives the home router a private address too, and translates a second time inside its own network.
RFC 6598 reserves `100.64.0.0/10` as "Shared Address Space to accommodate the needs of Carrier-Grade NAT (CGN) devices", for the link between the provider's NAT and the home router [5].
The second hop out of our development machine, by `tracert -d 1.1.1.1`, is `100.67.4.1`, inside that range, which suggests our provider runs CGNAT (unverified) [3].
Our fork's hosting notes give the check: compare the WAN address on the router's status page with the address an outside server reports, for example with `curl -4 ifconfig.me`.
If the two differ, the router sits behind CGNAT, and "port forwarding cannot work" [6].

**Port forwarding** is a rule the pilot adds to the router by hand: UDP arriving on a given public port goes to a given private endpoint.
YourControls' direct mode needs one, for UDP port 25071 by default ([01](01-prior-art-and-crew-practice.md#prior-art)), and the rule works only on a router that has a public address of its own.

UPnP and NAT-PMP let the app add that rule itself:

- With UPnP, the app finds the router by a multicast search on the home network and asks its Internet Gateway Device service, `WANIPConnection`, to add a mapping [7].
- With NAT-PMP, the app sends a UDP request to port 5351 on its gateway, and RFC 6886 notes that the Port Control Protocol (PCP) superseded it in 2013 [8].

FS Copilot tries both when it starts, through the Open.NAT library: UPnP first, with 3s to find a device, then NAT-PMP [9].
When UPnP finds a router, the app binds its socket to the local address that faces that router and asks for the same port number outside as inside [9].
On our development machine, neither a UPnP search for an Internet Gateway Device nor a NAT-PMP request to the router got an answer [3].

**What it changes for Crosscheck.**
Some pilots will be behind NATs that no app can open, behind CGNAT or a NAT that maps per destination, so Crosscheck can't rely on port forwarding or UPnP to make a pilot reachable.
How many pilots are in that position is unknown.

**Traps.**

- FS Copilot never uses NAT-PMP: its fallback awaits the NAT-PMP search and discards the result, so the device stays null, and the app starts without a mapping [9].
- A UPnP mapping made behind CGNAT opens a port on the home router's WAN address, which is itself a private address inside the provider's network, so nothing on the internet can reach it (unverified) [5] [6].
- A mapping that expires between packets breaks a link that still looks open to the app, which is what keep-alives prevent ([09-06](09-06-connection-lifecycle.md#connection-lifecycle-heartbeats-timeouts-a-clean-leave-vs-an-outage-reconnecting)).

## STUN, TURN, ICE, and hole punching

A STUN server tells a client which public endpoint its packets arrive from.
In hole punching, two clients learn each other's public endpoints through a server and send to each other at the same moment.
Each outgoing packet leaves the sender's own NAT expecting the other side, so the other side's packets get in.
It works only when both NATs map endpoint-independently.
TURN is the standard relay for pairs where that fails, and ICE is the procedure that gathers every candidate endpoint, tests the pairs, and picks the best one that works.

**How it works.**
RFC 8489 describes STUN as something an endpoint can use "to determine the IP address and port allocated to it by a NAT", and says it "is not a NAT traversal solution by itself" [10].
The request that came back with `<public address>:62856` in [09-01](09-01-addresses-and-link-quality.md#addresses-and-ports-public-vs-private-addresses-what-a-home-router-does) was a STUN Binding request [3].

FS Copilot punches holes with LiteNetLib's NAT punch module, through its own rendezvous server, a server both apps can reach [9] [11] [12]:

1. Every 20s, each app sends the rendezvous server, on UDP port 3480, an introduce request carrying its peer ID and its private endpoint.
   The server records both, along with the request's source endpoint, which is the app's public one, and forgets the app 5 minutes after its last request.
2. The joining app sends `CALL|<its ID>|<target ID>`.
   The server sends each app the other's private and public endpoints, or answers `REJECT|<its ID>|<target ID>|NOT_FOUND` if the target isn't registered.
3. On receiving the other's endpoints, each app sends a punch packet to the private endpoint, then a 1-byte packet toward the public endpoint with a time-to-live of 2 hops, which LiteNetLib's source calls a "hack for some routers", and then a punch to the public endpoint.
4. When a punch arrives, LiteNetLib reports the endpoint it came from, and FS Copilot opens a LiteNetLib connection to that endpoint, with the token `<its ID>|<target ID>|<schema>`.

Each app's punch to the other's public endpoint is what opens its own NAT.
Say A's punch reaches B's NAT before B has sent anything: B's NAT drops it, but A's NAT now has a mapping toward B, and B's punch, sent at about the same moment, arrives through it.
That works only if the punch leaves from the same public endpoint the server saw, which endpoint-independent mapping guarantees.
RFC 5128 puts it the other way round: behind a NAT that doesn't map endpoint-independently, "the peering host cannot predictably know the mapped endpoint", and hole punching fails [13].

Here is one join in our machine's app log from a session on 2026-09-08, with the other pilot's public endpoint left out [14]:

```text
[21:58:34.574] [Peer2Peer] DIR LMHMTCNK -> PMWCJEGL
[21:58:34.666] [Peer2Peer] NAT PMWCJEGL -> <endpoint>
[21:58:34.727] [Peer2Peer] CON PMWCJEGL -> <endpoint>
```

`DIR` is our app calling the other pilot's code, `NAT` is a punch arriving 92ms later, and `CON` is the connection completing 61ms after that.

RFC 5128 reports a survey from 2005 in which UDP hole punching worked on more than 80% of the NAT devices tested [13].
That survey predates wide use of CGNAT, and nothing in our records counts how often it works between pilots.

**TURN** is the relay for the rest.
RFC 8656 opens with the case: behind some NATs, "it is necessary for the host to use the services of an intermediate node that acts as a communication relay" [15].
A TURN client asks the server for an allocation, a public endpoint on the server, and the server forwards packets between that endpoint and the client [15].
[09-04](09-04-relays-and-sessions.md#relays-when-theyre-needed-hosting-fan-out-cost) covers relays, including FS Copilot's own.

**ICE**, in RFC 8445, is the general procedure, and WebRTC runs it [16]:

1. Gather candidates: host candidates from the machine's own interfaces, server-reflexive candidates, which are public endpoints learned from STUN, and relayed candidates from TURN.
2. Exchange them with the other side over a signaling channel, which ICE assumes already exists.
3. Run connectivity checks on each pair of a local and a remote candidate, in priority order.
4. Nominate the best pair that works.

FS Copilot's procedure next to it:

| Step | ICE | FS Copilot |
| --- | --- | --- |
| Learn its own public endpoint | A STUN Binding request | The rendezvous server records the introduce request's source |
| Exchange endpoints | A signaling channel of any kind | The rendezvous server sends both apps the other's, on `CALL` |
| Test | Every pair of host, server-reflexive, and relayed candidates | Punches to the other's private and public endpoints |
| Relay | Relayed candidates, checked with the rest | A separate relay protocol, after 4s without a direct link [17] |

**What it changes for Crosscheck.**
A direct link needs a rendezvous server both pilots can reach, and some pairs will never get one, so Crosscheck needs a second path and a way to tell which case a pair is in.
How long to try for a direct link before falling back trades the time a join takes against the traffic a relay carries, and it's an open question.

**Traps.**

- Two pilots behind the same NAT can get two direct links.
  The punch to the private endpoint arrives, and so does the punch to the public endpoint when the NAT loops it back inside, which RFC 4787 calls hairpinning [1].
  FS Copilot connects to both, so every packet arrives twice ([08-03](08-03-ordering-and-classes-of-data.md#ordering-sequence-numbers-deduplication-idempotency-last-writer-wins)).
- Two instances on one PC always punch through: FS Copilot's `--no-direct` switch exists because "two instances on one machine always punch through to each other, so without it the relay path is never exercised" [17].
- FS Copilot tries a direct link once per join [17]: in our exerciser's run, the direct attempt was "rejected NOT_FOUND and not retried", and the link stayed on the relay for all 45s of the run [18].
- FS Copilot's server class named `Stun` doesn't speak STUN: it runs LiteNetLib's NAT introduction on UDP port 3480, not the protocol of RFC 8489 [11].

## Sources

1. Documented: F. Audet and C. Jennings, [RFC 4787, Network Address Translation (NAT) Behavioral Requirements for Unicast UDP](https://www.rfc-editor.org/rfc/rfc4787), 2007-01, sections 3, 4.1 (REQ-1), 4.3 (REQ-5), 5, and 6.
2. Documented, and older than the source it describes: FS Copilot profiles at d3d7689, `docs/networking.md`, section "When Relay is Needed".
3. Measured on our development machine, 2026-09-27, while writing this chapter, over wired Ethernet: `tracert -d -h 6 -w 1000 1.1.1.1`; a PowerShell script that sent a STUN Binding request from one UDP socket to each of `stun.l.google.com:19302`, `stun1.l.google.com:19302`, and `stun.cloudflare.com:3478`, run three times; an SSDP search sent to `239.255.255.250:1900`, once for `urn:schemas-upnp-org:device:InternetGatewayDevice:1` and once for `ssdp:all`, each waiting 3s; and a NAT-PMP external address request to the router's UDP port 5351, waiting 2s.
   No raw output is committed.
4. Documented: L. Eggert and others, [RFC 8085, UDP Usage Guidelines](https://www.rfc-editor.org/rfc/rfc8085), 2017-03, section 3.5.
5. Documented: J. Weil and others, [RFC 6598, IANA-Reserved IPv4 Prefix for Shared Address Space](https://www.rfc-editor.org/rfc/rfc6598), 2012-04, the abstract.
6. Documented in our record: FS Copilot fork, `record/self-hosted-relay/docs/04-free-options.md`, section "2. Host it yourself — free if you are not behind CGNAT".
7. Documented: Open Connectivity Foundation, [Internet Gateway Device (IGD) V 2.0](https://openconnectivity.org/developer/specifications/upnp-resources/upnp/internet-gateway-device-igd-v-2-0/), which lists the `WANIPConnection:2` service.
8. Documented: S. Cheshire and M. Krochmal, [RFC 6886, NAT Port Mapping Protocol (NAT-PMP)](https://www.rfc-editor.org/rfc/rfc6886), 2013-04, the abstract and section 3.
9. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Network/P2PNetwork.cs`: `Start`, `GetNat`, `IntroduceLoop`, `OnNatIntroduction`, `EnsureIntroduced`, and `AskIntroduce`.
10. Documented: M. Petit-Huguenin and others, [RFC 8489, Session Traversal Utilities for NAT (STUN)](https://www.rfc-editor.org/rfc/rfc8489), 2020-02, the abstract.
11. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Discovery/Stun.cs`: `Port`, `PeerTtl`, `OnNatIntroductionRequest`, and `HandleCall`.
12. Documented, read from source: [LiteNetLib](https://github.com/RevenantX/LiteNetLib) at tag 1.3.1, `LiteNetLib/NatPunchModule.cs`: `SendNatIntroduceRequest`, `NatIntroduce`, `OnNatIntroductionResponse`, and `OnNatPunch`.
13. Documented: P. Srisuresh and others, [RFC 5128, State of Peer-to-Peer (P2P) Communication across Network Address Translators (NATs)](https://www.rfc-editor.org/rfc/rfc5128), 2008-03, sections 3.3 and 4; section 4 reports B. Ford, P. Srisuresh, and D. Kegel, "Peer-to-Peer Communication Across Network Address Translators", USENIX Annual Technical Conference, 2005-04.
14. Measured on MSFS 2024, 2026-09-08: FS Copilot fork, `record/pointer-forwarding/results/session-2026-09-08-app.txt`, lines 510 to 512, read in `record/pointer-forwarding/docs/build/log.md`, "2026-09-11 — First multi-machine session, read from the app log".
15. Documented: T. Reddy and others, [RFC 8656, Traversal Using Relays around NAT (TURN)](https://www.rfc-editor.org/rfc/rfc8656), 2020-02, the abstract and section 1.
16. Documented: A. Keranen and others, [RFC 8445, Interactive Connectivity Establishment (ICE)](https://www.rfc-editor.org/rfc/rfc8445), 2018-07, sections 2, 2.1, 2.2, and 2.3.
17. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Network/HybridNetwork.cs`: `DirectAttemptTimeout`, `Connect`, and the comment on the `direct` parameter.
18. Measured without the sim, 2026-09-17: FS Copilot fork, `record/exerciser/docs/log.md`, "2026-09-17 — A separate process can join FSC as a peer and trade PointerEvents both ways", with the output in `record/exerciser/results/p01-peer-join-2026-09-17.txt`.

## Unverified claims

- **Our development machine is behind CGNAT.**
  We infer it from one hop in the shared address space [3] [5].
  Reading the WAN address on the router's status page and comparing it with the address a STUN server reports would settle it.
- **A UPnP mapping behind CGNAT reaches nothing.**
  It follows from the router's WAN address being private [5] [6], and nobody has tried it.
  Creating a UPnP mapping on a router behind CGNAT, then sending a packet to the mapped port from outside, would settle it.
- **Why our router answered neither UPnP nor NAT-PMP.**
  Either both are off on the router, or something on our machine blocked the replies [3].
  Reading the router's settings, or running FS Copilot and looking for its UPnP log line, would settle it.
