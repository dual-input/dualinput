# Networking: versions and security

- [Serialization, protocol versioning, and compatibility between app versions](#serialization-protocol-versioning-and-compatibility-between-app-versions)
- [Security: authentication, encryption, validating what a peer writes into your sim](#security-authentication-encryption-validating-what-a-peer-writes-into-your-sim)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Addresses and link quality are in [09-01-addresses-and-link-quality](09-01-addresses-and-link-quality.md), transports and delivery modes in [09-02-transports-and-delivery](09-02-transports-and-delivery.md), NAT and traversal in [09-03-nat-and-traversal](09-03-nat-and-traversal.md), relays and session setup in [09-04-relays-and-sessions](09-04-relays-and-sessions.md), and the connection lifecycle in [09-06-connection-lifecycle](09-06-connection-lifecycle.md).

As in [09-01](09-01-addresses-and-link-quality.md), a peer is another pilot's copy of the app, and an endpoint is an IP address with a port.

## Serialization, protocol versioning, and compatibility between app versions

Both apps have to agree on the bytes of every message.
A hand-written binary format with a fixed field order is compact, and it breaks as soon as either side adds or moves a field, so it needs a version check before any data flows.
FS Copilot's check compares a fingerprint of every packet type and refuses any mismatch, and the fingerprint includes the app's version number, so two builds with different version numbers never connect.

**How it works.**
[05-03](05-03-toolchain-versioning-and-debugging.md#protocol-versioning-between-the-app-and-the-module-packed-structs) covered versioning between an app and its own module, and two pilots' apps face the same problem.

FS Copilot writes each packet as a 1-byte packet ID, which is the type's position in the order the app registered its packet types, followed by the fields its codec writes with .NET's `BinaryWriter` [1] [2].
`BinaryWriter` writes numbers little-endian and a string as a length prefix, one byte for a short string, followed by the string's bytes, in UTF-8 here [2] [3].
A cockpit update that sets `L:A22X AP Master` to a double of 1 takes 27 bytes [1] [2]:

| Bytes | Content |
| --- | --- |
| 1 | Packet ID |
| 1 | Name length, 16 |
| 16 | `L:A22X AP Master` |
| 1 | Type code, 14 for a double |
| 8 | 1.0, little-endian |

Nothing in those bytes names a field or gives its length, so a reader has to know the exact layout.
A newer app that added a field would feed an older one bytes it reads as the next field.
So FS Copilot refuses to connect across layouts [2] [4] [5]:

1. For each registered packet type, it hashes a description of the type with SHA-256: the type's assembly-qualified name, then each field's offset, type, and name for a struct, or each property's name and type in constructor order for a record.
   The hashes, in registration order, make up its schema string.
2. A direct link carries the schema string in its connect token, and the accepting app rejects any other.
   The relay compares the two peers' schema strings and answers `SCHEMA_MISMATCH`.
3. The joining pilot sees "Both sides must use the same FS Copilot version."

An assembly-qualified name includes the assembly's version, which in a build we checked is `FsCopilot, Version=1.2.1.0, Culture=neutral, PublicKeyToken=null` [6].
So a new version number changes every hash, and two builds with different version numbers never connect, even when their bytes agree (read from source).

A format that tags its fields can let versions mix.
Protocol Buffers identifies each field by a number, so new code reads messages from old code, and old code skips fields it doesn't know, provided no field number is ever changed or reused [7].

Our fork's relay versions its own protocol rather than the payload [8] [9]:

- An app names the relay protocol it speaks in its connect token, `v=2`, and a token without one means version 1.
- The relay serves versions 1 and 2 side by side, refuses an app newer than itself with `VERSION_UNSUPPORTED`, and never links two apps of different versions.
- The app has no fallback, so against a version 1 relay it never links, which our fork chose over a partial link.

fsc-editor keeps one definition for both ends of its relay: `src/shared/remote-connect.ts` "is the whole contract, shared by the app and the relay" [10].
Its relay reads only each message's envelope, so the messages inside can change without redeploying it [10].

**What it changes for Crosscheck.**
Crosscheck's app will meet other versions of itself, of its relay, and of its module, and each of those boundaries needs a stated rule: refuse, agree on a version both speak, or skip what it doesn't know.
Whether two pilots on different releases can fly together is a product question, and the wire format decides the answer.

**Traps.**

- Packet IDs follow registration order, so building the app's services in another order renumbers the packets: FS Copilot constructs `ShareSwitch` after `Coordinator` "so the packet table is the same on every peer" [11].
- The fingerprint covers a type's fields and not its codec, so a codec that writes the same fields in a new order passes the check and garbles every value (read from source) [4].
- A tool that talks to the app has to register the app's own types, in the app's order, because a copy in another assembly hashes differently; our exerciser reaches FS Copilot's private packet types by reflection [12].
- A packet that fails to decode disappears: the codec returns nothing on any error, and the receiver logs an error on a direct link and drops the packet without a word on a relay link [4] [13] [14].
- FS Copilot profiles' networking doc says the schema is a CRC32 of the packet types [15], and the source hashes each type with SHA-256 [4]; we trust the source.

## Security: authentication, encryption, validating what a peer writes into your sim

Whoever can join a session can write into your sim, so security comes down to three questions: who can join, who can read or change packets on the way, and what the receiving app lets a message do.
FS Copilot answers the first with the 8-letter code alone and the second with nothing, since every packet crosses the relay unencrypted.
It answers the third with a list of the receiver's own profile entries, and then builds calculator code from the value the sender chose.

**How it works.**
FS Copilot has no step where a pilot accepts a joiner: an app of the same build that knows a code is introduced, connects, and is live [16] [17].
A live peer can take control and fly the aircraft, because any pilot takes control by sending `SetMaster` ([08-01](08-01-replication-models-and-authority.md#authority-pilot-in-control-per-system-or-per-control-ownership-handover-contention)).
Neither the rendezvous server nor the relay limits attempts [16] [18].
Each answers an unregistered code differently from a registered one, the rendezvous server with `REJECT|<caller>|<code>|NOT_FOUND` and the relay with `TARGET_NOT_FOUND`, so a script can try codes and learn which are live (read from source) [16] [18].
FS Copilot profiles' networking doc says the rendezvous server is rate-limited [15], and `Stun.cs` at 9d4e864 has no limit; we trust the source.
fsc-editor guards its shorter codes with the join limit its Worker checks before any session object runs, and with a resume token that keeps a guesser from taking over a session ([09-04](09-04-relays-and-sessions.md#setting-up-a-session-codes-rendezvous-servers)) [19].

A session also hands out addresses.
The rendezvous server sends each app the other's private and public endpoints, so whoever calls a code learns the public IP address, and the LAN address, of the pilot behind it [16].
A relayed link hides two pilots' addresses from each other and shows both to whoever runs the relay.

Nothing in FS Copilot encrypts.
Its packets are plain UDP, and LiteNetLib's two optional packet layers, `Crc32cLayer` and `XorEncryptLayer`, which XORs each packet with a repeating key, aren't used [20].
So the relay, and anything else on the path, can read every packet and change it.
The standard ways to encrypt a transport are DTLS for datagrams [21], the TLS 1.3 inside every QUIC connection, TLS under a WebSocket with `wss:`, and WebRTC data channels, which RFC 8831 requires to be secured ([09-02](09-02-transports-and-delivery.md#tcp-udp-websocket-webrtc-data-channels-quic)).
Encryption between each app and the relay still leaves the relay able to read the traffic.

What a message may do is decided by the receiver.
FS Copilot's receiver applies a cockpit update only if its name matches an entry in the receiver's own profile, and only in the direction that entry allows [22].
For a `shared:` entry with no `set:`, it then converts the value to text and runs `<value> (><variable>)` as calculator code in its module ([03-03](03-03-reading-and-writing.md#rpn-calculator-code)) [22] [23].
The codec accepts a string value [1], and the A220 profile has `shared:` entries with no `set:`, such as `L:A22X APU Gen Off` [24].
So a peer that sent text in place of a number could make the receiver run any calculator code (read from source; nobody has tried it).
Position packets go into the frozen aircraft as they arrive, and nothing in the module's position path checks a range or rejects a value that isn't a number [25].

fsc-editor treats everything from the other side as hostile [19]:

- Every path from the wire goes through `resolveInside()`, which rejects absolute paths, traversal, and any file that isn't `.yaml`.
- `MAX_FILE_BYTES` and `MAX_MANIFEST_ENTRIES` bound what a broken or hostile host can make a guest hold.
- The relay stamps which guest sent each message, from the socket it arrived on.
- Nothing is written to disk except through the app's normal save.

**What it changes for Crosscheck.**
Crosscheck has to decide who may join a session and how the app checks it.
Its receiver has to bound what any message can do to the sim, in which variables, events, and ranges, whatever the sender claims.
Whether whoever runs a relay should be able to read or change a session's traffic is an open question.

**Traps.**

- The code is also the peer's identity, so it appears in log lines about the link, such as `[Peer2Peer] DIR LMHMTCNK -> PMWCJEGL` [26].
  A log shared for a bug report shares a working code for as long as that app runs.
- FS Copilot sends the Windows user name to every peer as the pilot's name: `Program.cs` sets the name from `Environment.UserName`, and `PeerTags` carries it [11] [17].
- Any process on the pilot's own machine can open the app's panel port, because the app can't yet tell the sim from a browser tab ([06-04](06-04-websockets-to-localhost.md#websockets-from-a-panel-to-localhost)).

## Sources

1. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Simulation/Coordinator.cs`, the `Update` record and its `Codec`.
2. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Network/Codecs.cs`: `Add`, which gives each type the next ID, and `Encode`, which writes the ID and then the codec's fields with a UTF-8 `BinaryWriter`.
3. Documented: Microsoft, [BinaryWriter.Write Method](https://learn.microsoft.com/en-us/dotnet/api/system.io.binarywriter.write), the remarks on the numeric overloads and on `Write(String)`.
4. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Network/Codecs.cs`: `SchemaFor`, `GetOrderedContractProperties`, and `Decode`.
5. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/Network/P2PNetwork.cs`, `OnNatIntroduction` and `OnConnectionRequest`; `FsCopilot.Discovery/Relay.cs`, `HandleConnectIntent`; and `FsCopilot/ViewModels/MainViewModel.cs`, the message for `ViewErrors.Rejected`.
6. Read from the assembly on our development machine, 2026-09-27: the full name of `FsCopilot.dll` in fsc-exerciser's copy of the FS Copilot fork's build, a Debug build.
7. Documented: Protocol Buffers, [Language Guide (proto 3)](https://protobuf.dev/programming-guides/proto3/), sections "Assigning Field Numbers" and "Updating A Message Type".
8. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot.Discovery/Relay.cs`, `ProtocolVersion`, `OnConnectionRequest`, and `TryParseToken`; and `FsCopilot/Network/RelayNetwork.cs`, the class comment and `EnsureRelayConnected`.
9. Documented in our record: FS Copilot fork, `record/traffic-atc/docs/04-transport.md`, section "The relay protocol, version 2".
10. Documented in our record, read from source: fsc-editor at 4cbf8ab: `docs/remote-connect.md`, the opening paragraphs; and `relay/src/index.ts`, the file comment.
11. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Program.cs`: `BuildAvaloniaApp`, its comment on `ShareSwitch`, and `Environment.UserName`.
12. Measured without the sim, 2026-09-17: FS Copilot fork, `record/exerciser/docs/log.md`, "2026-09-17 — A separate process can join FSC as a peer and trade PointerEvents both ways", and `record/exerciser/docs/01-design.md`, section "Wire compatibility".
13. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Network/P2PNetwork.cs`, `OnMessage`.
14. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Network/RelayNetwork.cs`, `OnReceive`.
15. Documented, and older than the source it describes: FS Copilot profiles at d3d7689, `docs/networking.md`, sections "Token-Based Connection" and "Security Considerations".
16. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Discovery/Stun.cs`, `HandleCall`, which passes both apps' private and public endpoints to `NatIntroduce`.
17. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Network/P2PNetwork.cs`: `OnConnectionRequest`, which accepts any request whose schema matches, and `OnConnectionSuccess`, which sends `PeerTags` with the app's name.
18. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Discovery/Relay.cs`, `HandleConnectIntent`.
19. Documented in our record, read from source: fsc-editor at 4cbf8ab: `docs/remote-connect.md`, sections "The code", "Ending a session", and "Trust"; and `src/shared/remote-connect.ts`, `MAX_FILE_BYTES` and `MAX_MANIFEST_ENTRIES`.
20. Documented, read from source: [LiteNetLib](https://github.com/RevenantX/LiteNetLib) at tag 1.3.1, `LiteNetLib/Layers/XorEncryptLayer.cs` and `LiteNetLib/Layers/Crc32cLayer.cs`; FS Copilot's `NetManager`s, in `P2PNetwork.cs`, `RelayNetwork.cs`, `Stun.cs`, and `Relay.cs`, take no layer.
21. Documented: E. Rescorla and others, [RFC 9147, The Datagram Transport Layer Security (DTLS) Protocol Version 1.3](https://www.rfc-editor.org/rfc/rfc9147), 2022-04.
22. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/Simulation/Coordinator.cs`, `AddLink(Definition)`, which filters received updates by name; and `FsCopilot/Simulation/Definitions.cs`, `Set` and `ApplyTo`.
23. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Connection/SimClient.cs`, `Execute`, which sends the expression to the module, and `FsCopilot.Bridge.Wasm/wasm_module.cpp`, which passes it to `execute_calculator_code`.
24. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `Definitions/synaptic_a220.yaml`, the `shared:` block.
25. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/Simulation/Coordinator.cs`, `AddLink<TPacket>`; and `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `stream_buffer.h`, and `interpolators.h`, which contain no range or NaN check.
26. Measured on MSFS 2024, 2026-09-08: FS Copilot fork, `record/pointer-forwarding/results/session-2026-09-08-app.txt`, line 510.

## Unverified claims

- **Two FS Copilot builds with different version numbers never connect.**
  We read it from the source and the assembly name [4] [6].
  Building the fork twice with different `<Version>` values and joining one to the other would settle it.
- **A string value in a cockpit update runs as calculator code on the receiver.**
  We read it from the source [1] [22] [23], and nobody has sent one.
  On the two-instance bench with the A220 profile, sending an update for a `shared:` entry with no `set:` whose value also writes a harmless test `L:` variable, then reading that variable, would settle it.
- **A codec that reorders its fields passes FS Copilot's fingerprint.**
  We read it from `SchemaFor` [4].
  A unit test that swaps two writes in one codec and compares the schema strings before and after would settle it.
