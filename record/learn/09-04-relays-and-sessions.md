# Networking: relays and session setup

- [Relays: when they're needed, hosting, fan-out, cost](#relays-when-theyre-needed-hosting-fan-out-cost)
- [Setting up a session: codes, rendezvous servers](#setting-up-a-session-codes-rendezvous-servers)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Addresses and link quality are in [09-01-addresses-and-link-quality](09-01-addresses-and-link-quality.md), transports and delivery modes in [09-02-transports-and-delivery](09-02-transports-and-delivery.md), NAT and traversal in [09-03-nat-and-traversal](09-03-nat-and-traversal.md), serialization and security in [09-05-versions-and-security](09-05-versions-and-security.md), and the connection lifecycle in [09-06-connection-lifecycle](09-06-connection-lifecycle.md).

As in [09-01](09-01-addresses-and-link-quality.md), a peer is another pilot's copy of the app, and an endpoint is an IP address with a port.
A rendezvous server is one that both apps can reach and that tells each where to find the other, as in [09-03](09-03-nat-and-traversal.md#stun-turn-ice-and-hole-punching).

## Relays: when they're needed, hosting, fan-out, cost

A relay is a server with a public address that every app connects out to, and it forwards each packet from one peer to the others.
It reaches pilots whose NATs defeat hole punching, because each app only ever sends outward.
It costs an extra leg of latency and a host that accepts public UDP or WebSocket connections.
Its bandwidth grows with every seat, because one packet in becomes one copy out for each other peer.

**How it works.**
A relay is needed wherever no direct link forms ([09-03](09-03-nat-and-traversal.md#stun-turn-ice-and-hole-punching)).
FS Copilot profiles' networking doc lists four cases: symmetric NAT, corporate firewalls that block most UDP, CGNAT, and networks with no UPnP or NAT-PMP [1].
FS Copilot also falls back to its relay whenever a direct attempt takes over 4s ([Setting up a session](#setting-up-a-session-codes-rendezvous-servers)).

FS Copilot's relay runs in the same process as its rendezvous server, on UDP port 3600 [2] [3]:

1. Each app keeps one LiteNetLib connection to the relay, opened with the token `v=2;pid=<peer ID>;schema=<fingerprint>`, and the relay refuses a peer ID that's already connected.
2. To link to a peer, an app sends `ConnectIntent` with the peer's ID.
   The relay checks that the peer is connected and that the two apps' fingerprints and relay protocol versions match, then sends `LinkReady` to both.
3. In relay protocol version 2, every frame starts with one byte, 0 for control and 1 for data.
   The relay sends each data frame, whole and unread, to every peer linked to its sender, on the channel and with the delivery method it arrived with.

That last step is the fan-out: the sender sends once, and the relay sends one copy to each other linked peer.
Our fork's transport notes work out a four-seat session from the design figures [4]:

```text
ingress:  physics 4 × 2.3 KB/s + traffic 1.8 + audio 3 (while talking)  ≈ 14 KB/s
egress:   ingress × 3                                                    ≈ 42 KB/s  (~340 kbps)
```

The record puts a hundred such sessions at about 45 Mbps out of the relay, though its own per-session figure of 42 KB/s gives about 34 Mbps, and it doesn't say what makes up the difference [4].

Every relayed packet crosses two legs, sender to relay and relay to receiver, and our fork's relay loop adds up to 10ms of its own [4].
So where the relay sits sets the delay.
Our self-hosted relay's runbook estimates the round trip each placement adds, and nobody has measured these [5]:

| Pilots in | Through New York | Through London |
| --- | --- | --- |
| Europe and Europe | ~160ms | ~40ms |
| Europe and US East | ~100ms | ~100ms |
| US East and US East | ~40ms | ~160ms |
| US West and US West | ~140ms | ~300ms |

A UDP relay needs a machine with its own public IPv4 address, and a provider that doesn't filter or throttle UDP [6].
Cloudflare's proxy can't carry it: Spectrum proxies UDP, and as of 2026-09-27, "Custom TCP/UDP applications require an Enterprise plan with Spectrum as a paid add-on" [7].
So the relay's DNS record has to bypass the proxy, which publishes the server's real address [6].
Our record also lists Fly.io, Railway, Render, Heroku, Vercel, and Cloudflare Workers as unable to take arbitrary inbound UDP [6].
Our fork's relay runs on a DigitalOcean droplet at $4 a month in New York, using 27 MB of memory [8].
Our record weighs three routes that cost no money, and notes that free tiers change [9]:

- Oracle Cloud's free tier.
- A machine at home that isn't behind CGNAT.
- For a fixed group of pilots, a mesh VPN such as ZeroTier, which puts every machine on one virtual network.

A WebSocket relay is the other shape.
fsc-editor's runs as a Cloudflare Worker with one Durable Object per session code: the object reads only each message's envelope, stores nothing, and a session with no traffic costs nothing while the object hibernates [10].
It carries TCP, so every message waits behind any lost one ([09-02](09-02-transports-and-delivery.md#delivery-modes-reliable-ordered-sequenced-unreliable-head-of-line-blocking-mtu-and-fragmentation)).
TURN is the standard protocol for a relay, and WebRTC reaches it through ICE ([09-03](09-03-nat-and-traversal.md#stun-turn-ice-and-hole-punching)).

**What it changes for Crosscheck.**
A pair of pilots with no direct link needs a relay, a forwarded port on one pilot's router where there's no CGNAT, or a network the pilots set up themselves, such as a mesh VPN.
A relay is a server that someone runs, pays for, and keeps compatible with every client version in use.
Its traffic grows with seats times packet rate, and its location adds to the latency of every pair it carries.
Who would host it, and where, are open questions.

**Traps.**

- The relay amplifies what it's given: it forwards anything at any rate, one packet in and one out per other peer, and our fork's notes list a rate limit and a cap on links for each peer as needed and not built [4].
- A relay that answers bad input amplifies too: our fork's first relay answered every unreliable packet with a reliable `PROTOCOL_ERROR`, about 54 a second per peer while ATC audio was hosted, and version 2 logs an unknown control type without answering [4].
- One peer's failure stopped everyone's forwarding: before a fix, an exception while sending to one peer, such as an unreliable packet over that link's MTU, aborted the rest of that poll's events for every session on the relay [4].
- The relay's version has to match the apps': our fork's apps speak relay protocol version 2, and against upstream's version 1 relay they got one `PROTOCOL_ERROR` per `ConnectIntent` and `NO LINK` after 15s [4].

## Setting up a session: codes, rendezvous servers

Two apps that can't reach each other find each other through a server they both can reach: one app registers under a short code, the other pilot types that code, and the server either introduces the two for a direct link or links them through a relay.
The code is the only thing the pilots share, so its length, its alphabet, and how long it stays valid decide how easily it's read aloud and how hard it is to guess.

**How it works.**
FS Copilot has no session of its own: each app's peer ID is its code [11] [12].

1. When it starts, the app picks 8 letters from A to Z with a cryptographic random number generator, one of about 2.1 × 10^11 possible codes, and shows it as the code to share.
2. It registers with the rendezvous server and repeats that every 20s ([09-03](09-03-nat-and-traversal.md#stun-turn-ice-and-hole-punching)), and it keeps a connection open to the relay [12] [13].
3. The joining pilot types the code, and the app tries a direct link through the rendezvous server for up to 4s, then links through the relay [14].
4. Each side then sends a `PeerTags` packet listing its peers, and an app that receives one tries to link to every peer on the list, so three or more pilots end up with a link between every pair [13] [14].

Two joins from our machine's log of a session on 2026-09-08 [15]:

| Join | Log lines | Time from the call to the link |
| --- | --- | --- |
| Direct | `DIR` at 21:58:34.574, a punch at 21:58:34.666, `CON` at 21:58:34.727 | 153ms |
| Through the relay | `DIR` at 21:37:57.727, `[Relay] CON` at 21:38:01.862 | 4.1s |

fsc-editor's Remote Connect lets the relay pick the code [10] [16]:

- It's 6 characters from a 30-character alphabet that leaves out `I L O U 0 1` "because codes are read aloud and typed by someone looking at a sim", one of about 7.3 × 10^8 codes, shown as `K7R-M2Q`.
- If a code is already in use, the relay draws another.
- The code stays valid for the whole session, so a pilot can join late, and the Worker allows 20 join attempts a minute from each IP address, counted separately at each Cloudflare location, before any session object runs.
- The host gets a resume token, so the code is enough to join a session and not enough to take it over.

**What it changes for Crosscheck.**
Two apps need a server both reach to find each other, before any link exists and even when the link then goes direct, unless one pilot is reachable and the other types in that pilot's address, as YourControls' direct mode asks ([01](01-prior-art-and-crew-practice.md#prior-art)).
A code has to survive being read aloud, and whether it lasts for one app run or one session, and how hard it is to guess, are open questions tied to security ([09-05](09-05-versions-and-security.md#security-authentication-encryption-validating-what-a-peer-writes-into-your-sim)).

**Traps.**

- FS Copilot's code changes every time the app starts, so a code shared before a restart joins nothing, and our traffic log found a test driver that pinned the previous run's code failing to join without an error [17].
- A peer that crashed stays registered at the rendezvous server for up to 6 minutes, 5 minutes after its last request plus a cleanup that runs once a minute [18].
  A call to its code in that time gets the address of an app that isn't there, so the join spends the full 4s on a direct attempt before trying the relay (unverified) [14].
  The relay then reports `TARGET_NOT_FOUND` if its own 15s timeout has passed, and otherwise links the caller to the dead peer (unverified) [3].
- The rendezvous server answers an unregistered code with `REJECT|<caller>|<code>|NOT_FOUND` and introduces a registered one, so anyone can test which codes are live ([09-05](09-05-versions-and-security.md#security-authentication-encryption-validating-what-a-peer-writes-into-your-sim)) [18].
- fsc-editor's comment says its sampling keeps every code equally likely, but when a byte is rejected, the code draws one more and reduces it modulo 240, which leaves the first 16 characters of the alphabet under 1% likelier than the rest (read from source, arithmetic) [10].

## Sources

1. Documented, and older than the source it describes: FS Copilot profiles at d3d7689, `docs/networking.md`, section "When Relay is Needed".
2. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Discovery/Program.cs`, which hosts `Stun` and `Relay` in one process.
3. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Discovery/Relay.cs`: `OnConnectionRequest`, `OnNetworkReceive`, `HandleConnectIntent`, and `ForwardToLinkedPeers`.
4. Documented in our record: FS Copilot fork, `record/traffic-atc/docs/04-transport.md`, sections "The failure that forced this", "The relay protocol, version 2", "What the relay costs at scale", and "Verified", whose relay probes were measured without the sim on 2026-09-08.
5. Documented in our record, estimates: FS Copilot fork, `record/self-hosted-relay/docs/03-runbook.md`, step 1, the table of approximate added round trips.
6. Documented in our record: FS Copilot fork, `record/self-hosted-relay/docs/02-hosting-choice.md`, sections "The constraint that decides everything: Cloudflare cannot proxy this" and "What the workload actually needs", and its closing list of platforms not to try.
7. Documented: Cloudflare, [Cloudflare Spectrum](https://developers.cloudflare.com/spectrum/), last updated 2026-04-23, read on 2026-09-27.
8. Measured on the deployed relay, without the sim, 2026-09-08: FS Copilot fork, `record/self-hosted-relay/docs/05-deployment-log.md`, "What is running" and "Memory use is far below the estimate".
9. Documented in our record: FS Copilot fork, `record/self-hosted-relay/docs/04-free-options.md`.
10. Documented in our record, read from source: fsc-editor at 4cbf8ab: `docs/remote-connect.md`, sections "Shape", "The code", and "Ending a session"; `relay/src/index.ts`, `randomCode` and `join`; and `relay/wrangler.toml`, the `JOIN_LIMIT` rate limit.
11. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/Program.cs`, which sets the peer ID from `Random.String(8)` unless `--peer-id` is given; and `FsCopilot/Random.cs`, which draws from `RandomNumberGenerator` over the letters A to Z.
12. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Network/P2PNetwork.cs`: `IntroduceLoop`, `OnConnectionSuccess`, which sends `PeerTags`, and `Connect`.
13. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Network/RelayNetwork.cs`: `ReconnectLoop` and `OnLinkReady`, which sends `PeerTags`.
14. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Network/HybridNetwork.cs`: `DirectAttemptTimeout`, `Connect`, `OnPeerTags`, and `ConnectBurstAsync`.
15. Measured on MSFS 2024, 2026-09-08: FS Copilot fork, `record/pointer-forwarding/results/session-2026-09-08-app.txt`, lines 175 to 176 and 510 to 512, read in `record/pointer-forwarding/docs/build/log.md`, "2026-09-11 — First multi-machine session, read from the app log".
16. Documented, read from source: fsc-editor at 4cbf8ab, `src/shared/remote-connect.ts`: `CODE_ALPHABET`, `CODE_LENGTH`, and `CODE_GROUP`.
17. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 4, the card laid out and verified against a live sim", the paragraph on the scriptable bed.
18. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Discovery/Stun.cs`: `PeerTtl`, `CleanupInterval`, `ExecuteAsync`, and `HandleCall`.

## Unverified claims

- **A join to a crashed peer's code waits out the direct attempt, then fails at the relay.**
  We read it from the source [3] [14] [18].
  On the two-instance bench, killing one instance and joining its code from the other within a minute, while timing each log line, would settle it.
- **The runbook's latency for each relay placement.**
  They're estimates [5].
  Measuring the round trip from a few pilots' machines to a test server in each region would settle them.
