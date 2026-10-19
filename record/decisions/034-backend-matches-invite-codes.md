# 034: The backend matches invite codes to the crew's endpoint IDs, and no running session waits on it

The backend draws each invite code and keeps the session under it: its ID, the host's Dual Input version and message crate hash, its relay list with each relay's token, and each member's pilot ID, display name, kind, crew in v1, and endpoint ID ([01-between-machines](../areas/network/01-between-machines.md#joining)).
A joining core looks up the code, the backend refuses a joiner whose version or message crate hash differs from the session's and otherwise answers with the session's ID, its relay list, and the crew, and the joining core dials each member by endpoint ID through every relay in that list.
No running session waits on the backend: a returning pilot dials the crew from the session file and asks the backend only if nobody answers, and the relays speak only iroh's protocol.
Decided by the user on 2026-10-11, in node 2 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#the-backend-matches-invite-codes-to-the-crews-endpoint-ids-and-no-running-session-waits-on-it).

## Context

The spine gave invite codes and introductions between cores to the relay ([01-spine](../areas/architecture/01-spine.md#components)), as fsc-editor's relay holds a session's invite code (read in fsc-editor, `relay/src/index.ts`), and left open whether the relay's and the backend's messages are the message crate's ([01-spine](../areas/architecture/01-spine.md#left-open)).
Node 2 made the relays n0's `iroh-relay`, unmodified ([decision 033](033-relays-run-iroh-relay-unmodified.md)), and the code is the credential: it admits a pilot with no approval, as [the invite code](../areas/product/03-v1-scope.md#invite-code) rules ([01-between-machines](../areas/network/01-between-machines.md#joining)).

- Until a connection has chosen a path, iroh sends its first packets to every address it knows, and an endpoint's address holds several relays at once (read in iroh 1.3.0, `src/socket/remote_map/remote_state.rs`, `handle_msg_send_datagram`, and iroh-base 1.3.0, `src/endpoint_addr.rs`).
- iroh's handshake checks the accepting core's key against the endpoint ID the dialer asked for and has the dialer sign with its own key (read in iroh 1.3.0, `src/tls/verifier.rs`).

## Options

1. **The relay holds the codes and introduces the cores**, as the spine had it.
   Code of ours would run on the relays, where a stock relay lets n0's releases or n0's managed relays drop in unchanged (user, 2026-10-11).
2. **A backend that a running session waits on.**
   A backend that went down could end a session (user, 2026-10-11).
3. **Listing a joiner as soon as it looks up the code.**
   FS Copilot counted a handshake that later failed as a peer, and locked the pilot's panels for 5 minutes ([09-06](../learn/foundations/09-06-connection-lifecycle.md#connection-lifecycle-heartbeats-timeouts-a-clean-leave-vs-an-outage-reconnecting)).
4. **Counting every request from an address against it.**
   Carrier-grade NAT puts many pilots behind one address ([01-between-machines](../areas/network/01-between-machines.md#joining)).
5. **A backend that matches codes to endpoint IDs, which no running session waits on, and lists a joiner only once its first message has passed with a member.**
   One backend serves every Dual Input release in use, so it serves each version of its requests still in pilots' hands, and each core renews its place with it while the session lasts ([01-between-machines](../areas/network/01-between-machines.md#joining)).

## Decision

Option 5.
A stock relay keeps code of ours off the relays, and a backend that a running session never waits on can't end one by going down (user, 2026-10-11).
iroh reaches a member by endpoint ID through whichever relay it homes at and finds the direct path itself, so the backend and the session file keep endpoint IDs and no addresses.
A joiner counts as crew only once its first message has passed, so a handshake that fails never shows as a member.

## What it commits us to

- A joiner registers itself with the backend, which then lists it, only after its first message has passed with a member.
- Each core renews its place every 10 minutes, the backend drops a member after 30 minutes without renewal, Leave session tells it at once, and it frees the code once the crew is empty.
- Each request a core makes about itself carries a signature by its endpoint key, so nobody else can register, renew, or leave in a pilot's name ([01-between-machines](../areas/network/01-between-machines.md#joining)).
- Requests and answers are JSON, with the message crate's types and a version of the backend's own, which answers the spine's question of whether the backend's messages are the crate's.
- The backend counts only wrong codes against an address.
- A core accepts a connection whose first message carries its session's code, version, and hash ([decision 026](026-first-message-carries-version-and-hash.md)).
- It changes the spine, which gave invite codes and introductions to the relay ([01-spine](../areas/architecture/01-spine.md#components)).
- It leaves out what the backend runs on, for which the spine's candidate is a Cloudflare Worker ([01-spine](../areas/architecture/01-spine.md#components)).
