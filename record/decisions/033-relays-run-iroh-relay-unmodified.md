# 033: Our relays run iroh-relay unmodified, in at least two regions, and admit only Crosscheck

A relay runs n0's `iroh-relay`, in Rust, with nothing of ours on it, in at least two regions, and admits only clients that present one of its shared tokens, capping each client's rate.
Each release carries the default relay list, each entry with its URL, token, and cap, and a setting overrides the list.
A session uses its host's relay list, from which a joining core builds its endpoint with iroh's `presets::Minimal` and `RelayMode::Custom`, and each pilot homes at the relay with the lowest latency, as iroh picks it.
Decided by the user on 2026-10-11, in node 2 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#our-relays-run-iroh-relay-unmodified-in-at-least-two-regions-and-admit-only-crosscheck).

## Context

The relay carries a session's traffic when the pilots' machines can't connect to each other directly, and [01-aims](../areas/product/01-aims.md#relay-and-license) aims to keep it near $10 a month, runs one relay, adds regions only if we can host them for free, and makes the relay's address a setting.
The spine left the relay's language to node 2 ([01-spine](../areas/architecture/01-spine.md#language-and-toolchains)), since it follows from the transport ([architecture plan](../areas/architecture/plan.md#2-how-the-cores-reach-each-other)), and the transport is iroh ([decision 032](032-one-quic-connection-through-iroh.md)), whose relay is Rust ([network log, 2.1][n21]).

- iroh's relay carries packets over TCP, and a lost packet held back the ones behind it longer the farther the sender was from the relay: at 3% loss, 53ms at p99 at 22ms away and 534ms at 131ms ([network log, 2.3][n23]), and every channel shares that lateness ([network log, p06][p06]).
- `iroh-relay` admits everyone by default, and with shared tokens admits only a client that presents one of those its configuration lists, which can be two at once, and reads that list only when it starts (read in iroh-relay 1.3.0, `src/main.rs`, `AccessConfig`).

## Options

For what a relay carries:

1. **A relay that carries UDP.**
   Under the same loss, 2.3's UDP forwarder lost about what was dropped, and its p99 lateness stayed within 13ms through the near relay and reached 81ms through the far one at 3% ([network log, 2.3][n23]).
   With iroh, it means TURN plugged in through an API with no semver promise, beside an iroh relay of ours ([network log, 2.1][n21]).
2. **iroh's own relay, over TCP.**
   Its stalls grow with the sender's round trip to the relay, so relayed pilots far from the relay, on lossy links, hear ATC past the 300ms line in [03-v1-scope](../areas/product/03-v1-scope.md#hearing-atc) ([network log, 2.3][n23]).

For where relays run and whom they admit:

1. **One relay**, as 01-aims has it.
   A relayed pilot far from it, on a lossy link, is held back longest, 534ms at p99 at 131ms away at 3% loss ([network log, 2.3][n23]).
2. **n0's free public relays.**
   n0 calls them "suitable for development and hobby use only" (documented, [public relays](https://docs.iroh.computer/iroh-services/relays/public), as of 2026-10-11).
3. **`iroh-relay` as it comes, admitting everyone.**
   Any other iroh application could use our relays ([01-between-machines](../areas/network/01-between-machines.md#the-relays)).
4. **Tokens served to the cores, rather than carried in each release.**
   Serving them takes a service that tokens shipped with the release don't need, since every member of a session runs one release (user, 2026-10-11).

For the relays a session's endpoints use:

1. **Each pilot's own relay list.**
   iroh presents a relay's token only to relays in its own list, so two pilots whose lists differed couldn't reach each other's home relays (read in iroh 1.3.0, `src/socket/transports/relay/actor.rs`, `start_active_relay`).
2. **iroh's `presets::N0`.**
   It publishes each pilot's endpoint ID and home relay to n0's DNS (read in iroh 1.3.0, `src/endpoint/presets.rs`).

## Decision

iroh's own relay, unmodified, in at least two regions, admitting only clients with a token each release carries, with each session on its host's list and each endpoint built from `presets::Minimal`.
The user accepted iroh's relay over TCP for v1, with an adaptive buffer for ATC audio, at the cost 2.3 measured (user, 2026-10-10; [network log, 2.3][n23]).
The user chose at least two regions (user, 2026-10-11), and since a lost packet's hold-up grows with the sender's round trip to the relay ([network log, 2.3][n23]), a second region keeps more pilots nearer a relay (inference).
Tokens keep other iroh applications off our relays, though not someone who reads the token out of Crosscheck, and a joiner whose endpoint is built from the host's list makes one list per session true by construction ([01-between-machines](../areas/network/01-between-machines.md#joining)).

## What it commits us to

- A token changes only with a release, and a relay lists the old token and the new one until the old release is out of use.
- A change of tokens or an upgrade restarts a relay, which drops every relayed connection through it until a redial lands, as long as 23.8s after a link outage in p07 ([network log, p07][p07]), so relays restart at a quiet hour ([01-between-machines](../areas/network/01-between-machines.md#the-relays)).
- Each relay caps how fast one client can send, above v1's live traffic, and the core paces everything it sends through a relay below the cap its list gives ([decision 035](035-channels-declare-how-they-travel.md)).
- iroh homes each pilot at the relay with the best latency over the last 5 minutes, and moves only for one under two-thirds of the current one's (read in iroh 1.3.0, `src/net_report.rs`, `add_report_history_and_set_preferred_relay`).
- Our relays are upgraded before the release that carries a new iroh, at a quiet hour ([01-between-machines](../areas/network/01-between-machines.md#iroh-as-a-dependency)).
- A group can point Crosscheck at relays of its own through the setting, as 01-aims asks ([01-between-machines](../areas/network/01-between-machines.md#the-relays)).
- It settles the relay's language, which the spine left to node 2, and changes 01-aims' one relay.
- It leaves out who hosts the relays, our own servers or n0's managed relays, which changes nothing else ([01-between-machines](../areas/network/01-between-machines.md#the-relays)).

[n21]: ../areas/network/log.md#2026-10-10-iroh-13-leads-for-carrying-a-session-between-home-pcs-provided-its-tcp-relays-stalls-dont-show-and-its-switch-to-the-relay-can-be-made-fast
[n23]: ../areas/network/log.md#2026-10-10-iroh-moves-to-the-relay-one-path-idle-timeout-after-a-direct-link-dies-and-back-within-60s-and-at-3-loss-its-tcp-relays-p99-lateness-grows-with-the-round-trip-to-the-relay-from-53ms-at-22ms-away-to-534ms-at-131ms
[p06]: ../areas/network/log.md#2026-10-11-on-irohs-relay-under-loss-v1s-streams-run-as-late-as-its-one-off-packets-and-no-later-because-quic-never-sees-a-loss-there-so-a-sender-that-keeps-only-each-channels-newest-packet-changes-nothing
[p07]: ../areas/network/log.md#2026-10-11-after-a-total-outage-a-redialed-connection-carries-data-03s-to-14s-after-the-link-returns-while-one-that-lived-through-a-10s-outage-takes-5s-to-7s
