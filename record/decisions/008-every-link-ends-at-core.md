# 008: Every link between our components ends at the core

No two of Dual Input's components talk to each other directly, apart from the watcher downloading updates from the release host: each talks to the core, and the core passes on what another needs.
Apart from the announcements through which the sim's pages find the core and learn whether a session runs ([decision 009](009-sim-pages-find-core-over-commbus.md)), the core uses the CommBus and `L:` variables only to reach the aircraft's state.
Soft takeover, a Soon pick, would add a hold flag for each lever as an `L:` variable for the pilot's binding tool to read, and whether such a tool can make a binding wait on one is unverified ([ideas](../areas/product/ideas.md#soft-takeover-on-handover)).
Decided by the user on 2026-10-08, in node 1.2 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#every-link-between-our-components-ends-at-the-core).

## Context

Dual Input runs as the watcher, the core, and the core's helper on each pilot's PC, with the desktop app when the pilot opens it, five pieces of code inside the sim, and three services off the pilots' machines ([01-spine](../areas/architecture/01-spine.md#components)), and [node 1.2](../areas/architecture/plan.md#12-communication) had to say how they reach each other.
Some of them could reach each other without the core.
The CommBus joins modules, panel JavaScript, and SimConnect clients ([05-02](../learn/foundations/05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm)).
In one probe, a click on a notice in our panel raised `L:CROSSCHECK_P05_EFB_APP`, which a stand-in for our EFB app polled every 200ms to open the EFB onto an app (measured on MSFS 2024, 2026-10-04, [interface log](../areas/interface/log.md#2026-10-04-a-click-on-a-notice-in-our-panel-opens-the-efb-onto-another-app-whether-the-efb-was-open-or-closed)).
The EFB app speaks the same protocol as a browser, rather than reach Dual Input through something only a sim panel has, such as `L:` variables ([04-room-for-later](../areas/product/04-room-for-later.md#one-protocol-for-every-client)).

## Options

1. **Let components talk to each other directly where the sim gives them a path,** such as the banner panel raising an `L:` variable for the EFB app, or a panel calling the WASM module over the CommBus.
   Each such link is one the core doesn't see, so no one place would log every link, which component health needs ([ideas](../areas/product/ideas.md#component-health)), and the session would have more than one owner.
2. **End every link at the core, which passes on what another component needs.**
   A panel's action meant for the WASM module then takes a WebSocket to the core and then a data slot to the module ([01-spine](../areas/architecture/01-spine.md#communication)), and nothing in v1 needs it faster.

## Decision

Option 2.
Each of v1's features needs only links that end at the core: a click on a notice in the banner panel, for one, opens the EFB onto our app by way of the core ([01-spine](../areas/architecture/01-spine.md#communication)).
One hub gives one place that logs every link, which component health needs, and one owner of the session.

## What it commits us to

- The watcher's link to the release host, over HTTPS, is the one link that doesn't end at the core ([01-spine](../areas/architecture/01-spine.md#communication)).
- The core logs every connection, first message, and close, and the recording keeps them, so a bug report shows which component stopped and when ([01-spine](../areas/architecture/01-spine.md#how-the-core-knows-a-component-is-alive)).
- This decision leaves out a direct link that a later feature might need for speed.
