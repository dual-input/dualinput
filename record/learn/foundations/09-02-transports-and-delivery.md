# Networking: transports and delivery modes

- [TCP, UDP, WebSocket, WebRTC data channels, QUIC](#tcp-udp-websocket-webrtc-data-channels-quic)
- [Delivery modes: reliable-ordered, sequenced, unreliable; head-of-line blocking; MTU and fragmentation](#delivery-modes-reliable-ordered-sequenced-unreliable-head-of-line-blocking-mtu-and-fragmentation)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Addresses and link quality are in [09-01-addresses-and-link-quality](09-01-addresses-and-link-quality.md), NAT and traversal in [09-03-nat-and-traversal](09-03-nat-and-traversal.md), relays and session setup in [09-04-relays-and-sessions](09-04-relays-and-sessions.md), serialization and security in [09-05-versions-and-security](09-05-versions-and-security.md), and the connection lifecycle in [09-06-connection-lifecycle](09-06-connection-lifecycle.md).

As in [09-01](09-01-addresses-and-link-quality.md), a peer is another pilot's copy of the app, and the round trip time (RTT) runs from sending a packet to receiving the answer.

## TCP, UDP, WebSocket, WebRTC data channels, QUIC

UDP sends separate packets that may be lost, duplicated, or reordered, and TCP turns packets into one reliable, ordered stream of bytes.
WebSocket carries messages over one TCP connection.
WebRTC data channels and QUIC run over UDP, carry several independent streams with a choice of reliability, and always encrypt.
Libraries built for real-time sync, such as LiteNetLib, which FS Copilot uses, add their own reliability on top of UDP so that each stream can choose.

**How it works.**
The sockets API has two kinds of socket: a datagram socket, where each send is one packet, and a stream socket, where bytes go in at one end and come out at the other.
UDP is the first kind, and RFC 768 says its "delivery and duplicate protection are not guaranteed" [1].
TCP is the second: it "provides a reliable, in-order, byte-stream service" [2] by numbering the bytes, having the receiver acknowledge them, and resending what goes unacknowledged.

What matters for a sync is what the receiver gets after one lost packet.
Suppose the machine of the pilot in control sends 20 position packets a second, and the 3rd is lost:

- Over UDP, packets 4, 5, and 6 arrive on time, and the receiver interpolates across the gap ([08-05](08-05-position-and-clocks.md#position-and-attitude-freeze-and-set-slew-dead-reckoning-interpolation-buffers-jitter-time-shift-ground-contact)).
- Over TCP, the receiving operating system holds the bytes of packets 4, 5, and 6 until the resent packet 3 arrives, then hands over all four at once.

That wait is head-of-line blocking, which the [next section](#delivery-modes-reliable-ordered-sequenced-unreliable-head-of-line-blocking-mtu-and-fragmentation) times.

The other transports are built from these two:

| Transport | Runs on | Delivery | Encryption | In our records |
| --- | --- | --- | --- | --- |
| UDP | IP | Separate packets, unreliable and unordered | None | Under LiteNetLib |
| TCP | IP | One reliable, ordered byte stream | TLS, if added | Under WebSocket |
| WebSocket | TCP | Reliable, ordered messages | TLS with `wss:` | A panel to the app ([06-04](06-04-websockets-to-localhost.md#websockets-from-a-panel-to-localhost)), and fsc-editor's relay [3] |
| WebRTC data channel | SCTP over DTLS over UDP [4] | Chosen per channel: ordered or not, and how long or how often to resend [5] | Always [4] | None |
| QUIC | UDP [6] | Reliable streams that don't wait for each other [6], and unreliable datagrams with an extension [7] | Always, TLS 1.3 [8] | None |
| LiteNetLib | UDP | Five modes, chosen per packet [9] | None ([09-05](09-05-versions-and-security.md#security-authentication-encryption-validating-what-a-peer-writes-into-your-sim)) | FS Copilot ([08-03](08-03-ordering-and-classes-of-data.md#classes-of-data-what-must-arrive-vs-what-can-be-dropped)) |

WebSocket, per RFC 6455, is an HTTP request that upgrades into "basic message framing, layered over TCP" [10].
It's what a browser or a Coherent GT panel can open, and what a Cloudflare Worker can accept, which is why fsc-editor's relay speaks it [3].
Every message on it shares TCP's one order.

A WebRTC data channel runs SCTP, a message transport, inside DTLS, which is TLS for datagrams, over UDP [4].
RFC 8831 lists among its uses "A real-time game where position and object state information are sent via one or more unreliable data channels" [4].
A browser app sets each channel's `ordered` flag, and either `maxRetransmits` or `maxPacketLifeTime` to bound how hard it tries [5].
WebRTC also brings its own NAT traversal, ICE ([09-03](09-03-nat-and-traversal.md#stun-turn-ice-and-hole-punching)), which needs some other channel to exchange addresses before it starts.

QUIC, per RFC 9000, carries many streams in one connection, and when a packet is lost, "only streams with data in that packet are blocked" [6].
RFC 9221 adds unreliable datagrams to a QUIC connection [7].
In .NET, `System.Net.Quic` is stable from .NET 9, runs on Windows 11 and Windows Server 2022 or later, and Microsoft's page warns that some network components may block QUIC traffic [8].

Where each can run follows from earlier parts.
A WASM module can't open a socket of any kind ([05-01](05-01-kinds-lifecycle-and-apis.md#gauge-vs-standalone-modules-and-the-sandbox)), a panel can hold a WebSocket to the app on loopback ([06-04](06-04-websockets-to-localhost.md#websockets-from-a-panel-to-localhost)), and the desktop app has the operating system's whole network stack.

**What it changes for Dual Input.**
The classes of data in [08-03](08-03-ordering-and-classes-of-data.md#classes-of-data-what-must-arrive-vs-what-can-be-dropped) need at least a must-arrive, in-order mode and a newest-wins mode on one link, without one stream waiting behind another.
Any transport over TCP, WebSocket included, puts every stream in one ordered queue.
The transport also decides which NAT traversal and encryption come built in and which Dual Input would have to add ([09-03](09-03-nat-and-traversal.md), [09-05](09-05-versions-and-security.md)).

**Traps.**

- A connection over UDP exists only inside the library.
  The operating system and every NAT on the path see separate packets, so a NAT forgets an idle link's mapping unless something keeps sending ([09-06](09-06-connection-lifecycle.md#connection-lifecycle-heartbeats-timeouts-a-clean-leave-vs-an-outage-reconnecting)).
- TCP gets through NATs less often: in the 2005 survey that RFC 5128 cites, TCP hole punching worked on just over 60% of the NAT devices tested, against more than 80% for UDP [11].
- QUIC's TLS needs a certificate on the side that listens, as the .NET listener's options show [8], and a pilot's PC has none that a certificate authority signed, so two apps would need their own way to trust each other.

## Delivery modes: reliable-ordered, sequenced, unreliable; head-of-line blocking; MTU and fragmentation

A reliable mode numbers each packet, has the receiver acknowledge it, and resends it until it's acknowledged.
An ordered mode also holds every later packet on the same channel until the missing one arrives, which is head-of-line blocking; a sequenced mode drops anything older than what it already delivered; and an unreliable mode delivers whatever arrives.
Every packet also has to fit the path's maximum transmission unit (MTU), the largest packet that every link on the path can carry: a library splits a large reliable message into fragments itself, and refuses or loses a large unreliable one.

**How it works.**
[08-03](08-03-ordering-and-classes-of-data.md#classes-of-data-what-must-arrive-vs-what-can-be-dropped) gave three modes and FS Copilot's four delivery classes, and this is what LiteNetLib does underneath them.
LiteNetLib 1.3.1 has five delivery methods, described in its source as [9]:

| Method | LiteNetLib's description |
| --- | --- |
| `Unreliable` | "Packets can be dropped, can be duplicated, can arrive without order." |
| `ReliableUnordered` | "Packets won't be dropped, won't be duplicated, can arrive without order." |
| `Sequenced` | "Packets can be dropped, won't be duplicated, will arrive in order." |
| `ReliableOrdered` | "Packets won't be dropped, won't be duplicated, will arrive in order." |
| `ReliableSequenced` | "Packets can be dropped (except the last one), won't be duplicated, will arrive in order." |

Every method but `Unreliable` travels on a numbered channel, and its header grows from 1 byte to 4 to carry the channel and a sequence number [9] [12].
A reliable channel keeps up to 64 packets in flight, and the receiver acknowledges what arrives [9] [13].
A packet that isn't acknowledged in time goes again after 25ms plus 2.1 times the average RTT, which the source comments as "25 ms + double rtt" [13].

Here is head-of-line blocking on one reliable-ordered channel, on a direct link with a 117ms RTT, the round trip we measured from our development machine to New York ([09-01](09-01-addresses-and-link-quality.md#latency-jitter-loss-and-bandwidth-typical-figures-on-a-lan-vs-the-internet)), with the timings worked out from source [13]:

```text
t =   0ms   cockpit update A is sent on channel 1 and lost
t =  50ms   cockpit update B is sent on channel 1
t = 108ms   B arrives, and the receiver holds it, because A comes first
t = 271ms   A has no acknowledgment, so LiteNetLib resends it (25 + 2.1 × 117)
t = 330ms   A arrives, and the receiver hands over A, then B
```

B reached the app 222ms after it arrived, and every other packet that arrived on channel 1 while A was missing waited until 330ms too.
FS Copilot's four classes keep that wait inside one channel: a lost traffic identity on channel 3 holds nothing on channel 1.
That's why two streams may share an ordered channel only if neither is hurt by waiting behind the other ([08-03](08-03-ordering-and-classes-of-data.md#classes-of-data-what-must-arrive-vs-what-can-be-dropped)).
TCP has one order per connection, so everything on it waits, and in the worst case it waits for TCP's retransmission timer, which RFC 6298 says should be at least 1s [14].
QUIC blocks only the streams that had data in the lost packet [6].

**MTU and fragmentation.**
Ethernet carries up to 1,500 bytes in a packet, which leaves 1,472 bytes for UDP data after the 20-byte IPv4 header and the 8-byte UDP header.
PPPoE links, VPNs, and other tunnels carry less, and IPv6 requires every link to carry at least 1,280 bytes [15].
The sender or a router splits a larger IPv4 packet into fragments, and the packet is lost if any one fragment is.
RFC 8900, "IP Fragmentation Considered Fragile", sets out the problems and the alternatives [16].

LiteNetLib keeps its packets under the MTU itself.
It budgets each link at 1,024 bytes to start, from a list of sizes up to 1,432, and it probes for a larger size only when `MtuDiscovery` is on, which is off by default [9] [17].
FS Copilot doesn't turn it on, and our fork logs `mtu 1024` on every connect [18].
LiteNetLib splits a reliable message larger than the budget into fragments, each with 6 more bytes of header, and throws `TooBigPacketException` for an `Unreliable`, `Sequenced`, or `ReliableSequenced` one [9] [12].
So our fork sizes each traffic batch to fit: 23 aircraft states of 43 bytes behind a 19-byte header, 1,008 bytes [18].

**What it changes for Dual Input.**
Each Dual Input stream needs a delivery mode and an ordering domain, chosen so that no stream waits behind one it doesn't depend on, and every message sent without reliability has to fit one packet on the smallest MTU of every path it takes, relay legs included.
Which MTU to design for is an open question: LiteNetLib starts at 1,024 bytes, IPv6 guarantees 1,280, and what the VPNs that pilots use leave is unmeasured.

**Traps.**

- LiteNetLib's `Unreliable` packets have no channel field, so they arrive as channel 0 whatever the sender asked, which broke our fork's first relay protocol ([08-03](08-03-ordering-and-classes-of-data.md#classes-of-data-what-must-arrive-vs-what-can-be-dropped)).
- A burst bigger than the window waits for acknowledgments: a joining peer's hundred-odd traffic identities need at least two round trips through a 64-packet window [18].
- The fragments of a large reliable message share its channel, so one lost fragment holds the whole message and everything queued behind it on that channel (unverified).

## Sources

1. Documented: J. Postel, [RFC 768, User Datagram Protocol](https://www.rfc-editor.org/rfc/rfc768), 1980-08.
2. Documented: W. Eddy, editor, [RFC 9293, Transmission Control Protocol (TCP)](https://www.rfc-editor.org/rfc/rfc9293), 2022-08, section 2.2.
3. Documented in our record: fsc-editor, `docs/remote-connect.md`, section "Shape", and `relay/src/index.ts`, at 4cbf8ab.
4. Documented: R. Jesup and others, [RFC 8831, WebRTC Data Channels](https://www.rfc-editor.org/rfc/rfc8831), 2021-01, sections 1, 3.1, and 4, Req. 5.
5. Documented: W3C, [WebRTC: Real-Time Communication in Browsers](https://www.w3.org/TR/webrtc/#dom-rtcdatachannelinit), `RTCDataChannelInit`: `ordered`, `maxPacketLifeTime`, and `maxRetransmits`.
6. Documented: J. Iyengar and M. Thomson, editors, [RFC 9000, QUIC: A UDP-Based Multiplexed and Secure Transport](https://www.rfc-editor.org/rfc/rfc9000), 2021-05, section 2 for streams and section 13 for head-of-line blocking.
7. Documented: T. Pauly and others, [RFC 9221, An Unreliable Datagram Extension to QUIC](https://www.rfc-editor.org/rfc/rfc9221), 2022-03.
8. Documented: Microsoft, [QUIC support in .NET](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/quic/quic-overview), sections "QUIC in .NET", "Platform dependencies", and "QuicListener".
9. Documented, read from source: [LiteNetLib](https://github.com/RevenantX/LiteNetLib) at tag 1.3.1, `LiteNetLib/NetConstants.cs`: `DeliveryMethod` and its comments, `DefaultWindowSize`, `HeaderSize`, `ChanneledHeaderSize`, `FragmentHeaderSize`, and `PossibleMtu`.
10. Documented: I. Fette and A. Melnikov, [RFC 6455, The WebSocket Protocol](https://www.rfc-editor.org/rfc/rfc6455), 2011-12, the abstract.
11. Documented, secondary: P. Srisuresh and others, [RFC 5128, State of Peer-to-Peer (P2P) Communication across Network Address Translators (NATs)](https://www.rfc-editor.org/rfc/rfc5128), 2008-03, section 4, reporting B. Ford, P. Srisuresh, and D. Kegel, "Peer-to-Peer Communication Across Network Address Translators", USENIX Annual Technical Conference, 2005-04.
12. Documented, read from source: [LiteNetLib](https://github.com/RevenantX/LiteNetLib) at tag 1.3.1, `LiteNetLib/NetPeer.cs`, `Send`, which picks the channel and throws `TooBigPacketException`.
13. Documented, read from source: [LiteNetLib](https://github.com/RevenantX/LiteNetLib) at tag 1.3.1: `LiteNetLib/NetPeer.cs`, `UpdateRoundTripTime`, which sets the resend delay; and `LiteNetLib/ReliableChannel.cs`, which sizes its window from `DefaultWindowSize` and resends a packet once that delay has passed.
14. Documented: V. Paxson and others, [RFC 6298, Computing TCP's Retransmission Timer](https://www.rfc-editor.org/rfc/rfc6298), 2011-06, section 2, rule 2.4.
15. Documented: S. Deering and R. Hinden, [RFC 8200, Internet Protocol, Version 6 (IPv6) Specification](https://www.rfc-editor.org/rfc/rfc8200), 2017-07, section 5.
16. Documented: R. Bonica and others, [RFC 8900, IP Fragmentation Considered Fragile](https://www.rfc-editor.org/rfc/rfc8900), 2020-09.
17. Documented, read from source: [LiteNetLib](https://github.com/RevenantX/LiteNetLib) at tag 1.3.1, `LiteNetLib/NetManager.cs`, `MtuDiscovery`.
18. Documented in our record, and measured on MSFS 2024, 2026-09-08: FS Copilot fork, `record/traffic-atc/docs/04-transport.md`, sections "Channels are ordering domains" and "The MTU floor", checked against `FsCopilot/Network/Transport.cs`, `ahead` branch at 9d4e864.

## Unverified claims

- **One lost fragment holds a large reliable message and everything behind it on its channel.**
  It follows from LiteNetLib sending fragments on the message's own channel [12], and nobody has measured it.
  Sending a 10KB reliable message on a channel shared with small ones, with loss simulated outside LiteNetLib, and timing the small ones, would settle it.
