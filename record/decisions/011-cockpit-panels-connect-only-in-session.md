# 011: Cockpit panels connect only in a session, and only the ones in use stay

The panel bridge in a cockpit panel connects when it hears that a session started, names the instruments it holds in its first message, and gets back the modules to load, and a panel the core gives nothing closes its socket.
Decided by the user on 2026-10-08, in node 1.2 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#cockpit-panels-connect-only-in-a-session-and-only-the-ones-in-use-stay).

## Context

Our panel bridge runs in every cockpit panel, through our `VCockpit.js` override, and carries pointer sync, the modules that features name, and what plugins ask of the panels ([01-spine](../areas/architecture/01-spine.md#components)).
It runs whether or not the pilot is in a session, because the sim runs a `VCockpit.js` override in every cockpit panel as the panel loads ([01-spine](../areas/architecture/01-spine.md#components-with-no-session)).
With no session, nothing watches the cockpit, since a pilot may fly the Baron every day and with a crew once a week (user, 2026-10-07; same section).
The core announces on the CommBus whether a session runs ([decision 009](009-sim-pages-find-core-over-commbus.md)), and the Baron's cockpit has 20 panels ([interface log](../areas/interface/log.md#2026-10-04-an-ai-copy-of-the-pilots-aircraft-opens-its-livery-painting-and-none-of-its-cockpit-gauges)).

## Options

1. **Connect whenever a panel hears the core, session or not, as the EFB app and the menu script do** ([01-spine](../areas/architecture/01-spine.md#the-sims-pages)).
   Every cockpit panel would then hold a socket through flights with nobody to fly with, where with no session each component does only what lets a session start ([01-spine](../areas/architecture/01-spine.md#components-with-no-session)).
2. **Connect only while an `L:` session flag is 1, which each panel polls,** as node 1.2.1's design under test did (user, 2026-10-08).
   Pollers reading the flag every 500ms in 16 cockpit panels connected 36ms to 547ms after the probe wrote 1 (measured on MSFS 2024, 2026-10-08, [interface log](../areas/interface/log.md#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one)).
   But a flight load resets an `L:` variable, so the core would have to write the flag again after each load (same entry).
3. **Connect only from the panels a feature needs, as YourControls connects only from its elected instrument or an interactive one** ([06-04](../learn/foundations/06-04-websockets-to-localhost.md#websockets-from-a-panel-to-localhost)).
   The other panels would send the core nothing, so it couldn't tell whether our panel bridge loaded in them.
4. **Connect from every panel when it hears that a session started, name its instruments, and keep only the panels the core gives something.**
   The exchange happens once per panel at a session's start, 20 times on the Baron.

## Decision

Option 4.
With no session, nothing watches the cockpit, and the exchange at a session's start is cheap.
A first message from every panel tells the core the panel bridge loaded at all, which it doesn't when another package's `VCockpit.js` override wins ([installing and updating](../areas/product/03-v1-scope.md#installing-and-updating)) or our own bridge fails to parse ([CLAUDE.md](../../CLAUDE.md#before-writing-code-that-runs-in-a-panel)).

## What it commits us to

- Once it has loaded the profile and the plugins, the core keeps the panels holding the displays pointer sync replays into, one panel to listen for `H:` events, and those holding the instruments a plugin reads or writes ([01-spine](../areas/architecture/01-spine.md#the-sims-pages)).
- No panel's first message arriving means our panel bridge didn't load ([01-spine](../areas/architecture/01-spine.md#communication)), and the desktop app and the EFB app warn of another package's `VCockpit.js` override ([installing and updating](../areas/product/03-v1-scope.md#installing-and-updating)).
- When the session ends for the pilot, each module the panel bridge loaded tears itself down ([01-spine](../areas/architecture/01-spine.md#what-moves-them)), and how is for the part that designs plugins and the hosts in the sim ([01-spine](../areas/architecture/01-spine.md#left-open)).
- Nobody has run an aircraft with many more cockpit panels than the PA-24's 16 ([interface log](../areas/interface/log.md#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one)).
