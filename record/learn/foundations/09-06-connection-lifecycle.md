# Networking: the connection lifecycle

- [Connection lifecycle: heartbeats, timeouts, a clean leave vs. an outage, reconnecting](#connection-lifecycle-heartbeats-timeouts-a-clean-leave-vs-an-outage-reconnecting)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Addresses and link quality are in [09-01-addresses-and-link-quality](09-01-addresses-and-link-quality.md), transports and delivery modes in [09-02-transports-and-delivery](09-02-transports-and-delivery.md), NAT and traversal in [09-03-nat-and-traversal](09-03-nat-and-traversal.md), relays and session setup in [09-04-relays-and-sessions](09-04-relays-and-sessions.md), and serialization and security in [09-05-versions-and-security](09-05-versions-and-security.md).

As in [09-01](09-01-addresses-and-link-quality.md), a peer is another pilot's copy of the app, and the round trip time (RTT) runs from sending a packet to receiving the answer.

## Connection lifecycle: heartbeats, timeouts, a clean leave vs. an outage, reconnecting

A link over UDP lasts only while both apps keep hearing from each other.
So each app sends small heartbeat packets and declares the other gone after a timeout without any packet, and an explicit goodbye tells a pilot who left apart from a link that failed.
FS Copilot's links ping every second and time out after 15s, a Leave travels inside the disconnect itself, and nothing rebuilds a link to a peer after an outage.

**How it works.**
LiteNetLib pings each peer every `PingInterval`, 1,000ms by default, which FS Copilot keeps [1] [2].
The pings measure the RTT ([09-01](09-01-addresses-and-link-quality.md#latency-jitter-loss-and-bandwidth-typical-figures-on-a-lan-vs-the-internet)), and they keep the mapping in every NAT on the path from expiring ([09-03](09-03-nat-and-traversal.md#nat-types-cgnat-port-forwarding-upnp-and-nat-pmp)).
RFC 8085 notes that NATs have to keep an idle mapping at least two minutes, that many middleboxes use less, and that an app which needs keep-alives should send them no more often than every 15s [3].
FS Copilot also re-registers with its rendezvous server every 20s, and its relay path sends its own ping through the relay every 3s to measure the round trip to each peer [2] [4].

TCP sends nothing on an idle connection unless keep-alives are turned on, and RFC 9293 says their interval "MUST default to no less than two hours" [5].
So an app over TCP or WebSocket sends heartbeats of its own, such as WebSocket's ping and pong frames [6].

LiteNetLib declares a peer gone after `DisconnectTimeout` passes with no packet from it: 5,000ms by default, and 15,000ms in FS Copilot [1] [2].
A shorter timeout notices a dead peer sooner and turns a short Wi-Fi drop into an outage, and a longer one rides out the drop and keeps sending to a peer that has gone.

How each kind of departure reaches the other app, read from FS Copilot's source and measured on our two-instance bench [2] [4] [7] [8]:

| What happened | On a direct link | On a relay link | The other app |
| --- | --- | --- | --- |
| The pilot pressed Leave | A disconnect carrying the 4 bytes `left` | `DisconnectIntent`, and the relay sends `PEER_LEFT` | Ends the session at once |
| The pilot quit the app | The same, with the app waiting up to 500ms for it to leave the socket | The same, with a 100ms wait | Ends the session, 45ms after the quitting app tells its panels (measured) |
| A crash, a kill, or a pulled cable | Nothing, then a timeout after 15s | The relay times out after 15s and sends `PEER_DISCONNECTED` | Treats it as an outage ([08-02](08-02-echoes-and-initial-sync.md#initial-sync-a-snapshot-on-join-late-join-resync-after-reconnect)) |

The goodbye rides inside the disconnect rather than in a packet before it, because, in FS Copilot's words, "the transport does not promise queued packets go out ahead of the disconnect" [9].

A WebSocket has the same split.
A crash and a kill both end with close code 1006, which RFC 6455 reserves for a connection "closed abnormally" [6].
A clean 1000 needs the closing handshake to finish while the process exits, so our fork's panel channel sends its own `bye` first [10] ([06-04](06-04-websockets-to-localhost.md#websockets-from-a-panel-to-localhost)).
fsc-editor closes with 4001, from the range RFC 6455 leaves to applications, when a host stops on purpose [6] [11].

After an outage, FS Copilot's relay path reconnects to the relay server every 2s until it's back, and no link to a peer comes back [4] [12].
A link forms only when a pilot joins, and `PeerTags`, the packet that makes an app link to other peers, is sent only when a link has just formed [12].
On our two-instance bench, a link cut by suspending one instance stayed down through 3 minutes of waiting, twice, and a Join afterwards restored it ([08-02](08-02-echoes-and-initial-sync.md#initial-sync-a-snapshot-on-join-late-join-resync-after-reconnect)) [13].
fsc-editor's relay holds a session for 30s after its host drops, and the host's app retries after 0.5, 1.5, 4, and 8s with its resume token, then tells the pilot it lost the connection [11] [14].

**What it changes for Crosscheck.**
Crosscheck needs a heartbeat and a timeout on every link, a goodbye that reaches the peer before the process exits, and a rule for each machine during an outage and after it, which [08-02](08-02-echoes-and-initial-sync.md#initial-sync-a-snapshot-on-join-late-join-resync-after-reconnect) covers from the sync side.
Whether Crosscheck rebuilds links on its own, and how long an outage it rides out before it ends a session, are open questions.

**Traps.**

- A goodbye queued on the way out never leaves.
  LiteNetLib sends on its next update tick, and a quitting process exits first, so FS Copilot's quits reached the peer as outages 15s later, until the app waited for the send [8].
- Leaving right after joining can put the pilot back in: when a bench scenario left about 70ms after the link came up, the pair was linked again 4s later, and the instance that left was back in the session [7].
- A handshake isn't a peer.
  LiteNetLib's `ConnectionState.Any` includes `Outgoing`, a handshake that may still fail, and FS Copilot counted those as peers.
  So a failed join showed a peer for up to 5s and locked the pilot's panels for 5 minutes, until our fork added a `Connected` flag [15].
- Suspending a process and killing it test different things: a kill closes the sockets, and a suspended process holds them open and answers nothing, which only a timeout detects [16].
- Reliable delivery ends at the timeout: whatever is still unacknowledged when LiteNetLib declares the peer gone leaves its retry queue ([08-02](08-02-echoes-and-initial-sync.md#initial-sync-a-snapshot-on-join-late-join-resync-after-reconnect)).

## Sources

1. Documented, read from source: [LiteNetLib](https://github.com/RevenantX/LiteNetLib) at tag 1.3.1, `LiteNetLib/NetManager.cs`: `PingInterval` and `DisconnectTimeout`, and their comments.
2. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Network/P2PNetwork.cs`: the `NetManager` settings, `IntroduceLoop`, `Disconnect`, `DrainDisconnect`, and `OnPeerDisconnected`.
3. Documented: L. Eggert and others, [RFC 8085, UDP Usage Guidelines](https://www.rfc-editor.org/rfc/rfc8085), 2017-03, section 3.5.
4. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Network/RelayNetwork.cs`: `ReconnectDelay`, `RelaySettle`, `PingInterval`, `ReconnectLoop`, `PingLoop`, `DrainDisconnect`, and `OnLinkClosed`; and `FsCopilot.Discovery/Relay.cs`, `OnPeerDisconnected` and `HandleDisconnectIntent`.
5. Documented: W. Eddy, editor, [RFC 9293, Transmission Control Protocol (TCP)](https://www.rfc-editor.org/rfc/rfc9293), 2022-08, section 3.8.4.
6. Documented: I. Fette and A. Melnikov, [RFC 6455, The WebSocket Protocol](https://www.rfc-editor.org/rfc/rfc6455), 2011-12, sections 5.5.2, 5.5.3, 7.4.1, and 7.4.2.
7. Measured on the two-instance bench, without the sim, 2026-09-12: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-12 — A deliberate quit reaches the peer as an outage".
8. Measured on the two-instance bench, without the sim, 2026-09-12: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-12 — Stay alive long enough to say you left: Q11 fixed and measured".
9. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Network/INetwork.cs`, the comment on `PeerLeft`.
10. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-05 - Two overlay bugs closed: a deliberate quit says goodbye, and the red warning retracts".
11. Documented, read from source: fsc-editor at 4cbf8ab: `src/shared/remote-connect.ts`, `HOST_GRACE_MS` and `CLOSE_INTENTIONAL`; and `relay/src/index.ts`, `webSocketClose` and `alarm`.
12. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-12 — Q12 is survivable and it is not a two-pilot special case".
13. Measured on the two-instance bench, without the sim, 2026-09-12: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-12 — A blackholed peer link never comes back on its own".
14. Documented, read from source: fsc-editor at 4cbf8ab, `src/main/remote-connect/session.ts`, `RECONNECT_DELAYS_MS` and `onClosed`.
15. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, "R01 · A failed or rejected join locks the panels for five minutes".
16. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/14-test-bench.md`, the table of three ways to remove an instance.

## Unverified claims

No claim in this chapter is unverified.
One gap is worth measuring: nothing in our records says how long an idle mapping lasts on a pilot's router, because FS Copilot's 1s pings never let one sit idle.
Sending STUN requests from one socket with a longer idle gap before each, and noting when the public port changes, would measure it for one router.
