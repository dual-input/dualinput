# 013: The core accepts a WebSocket only with the sim's Origin or none

The core accepts a WebSocket whose `Origin` is `coui://html_ui` or missing, and refuses every other, and the desktop app connects from its Rust side.
Decided by the user on 2026-10-08, in nodes 1.2 and 1.3 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#the-core-accepts-a-websocket-only-with-the-sims-origin-or-none).

## Context

The core listens for WebSockets on 127.0.0.1, from the sim's pages and the desktop app ([decision 009](009-sim-pages-find-core-over-commbus.md); [decision 014](014-apps-find-core-through-port-file.md)).
Any page in a browser on the PC can open a WebSocket to 127.0.0.1 ([06-04](../learn/foundations/06-04-websockets-to-localhost.md#websockets-from-a-panel-to-localhost), its traps), so without a check, a page the pilot happens to have open could join them to a stranger's session or take control of their aircraft.
What each client sends as its `Origin` decides what a check can tell apart:

- Every page we use sent `coui://html_ui`, all 14 in the main menu and all 32 in the A2A PA-24's flight (measured on MSFS 2024, 2026-10-08, [interface log](../areas/interface/log.md#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one)); no other aircraft's pages were tried.
- A browser tab sends its own site's `Origin` ([06-04](../learn/foundations/06-04-websockets-to-localhost.md#websockets-from-a-panel-to-localhost)).
- The desktop app is a Tauri app ([decision 018](018-rust-and-typescript.md)).
  A Tauri app's pages sent `http://tauri.localhost`, as RFC 6455 requires of a browser client, and its Rust side, through tokio-tungstenite 0.30.0, sent no `Origin`, which the RFC allows a client that isn't a browser (measured on our development machine, 2026-10-08, [architecture log](../areas/architecture/log.md#2026-10-08-a-tauri-2-window-takes-723-mb-of-memory-over-seven-processes-against-electrons-665-mb-over-four-its-program-is-80-mb-against-3474-mb-and-its-rust-sides-websocket-sends-no-origin); [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455#section-4.1), section 4.1).

## Options

1. **Accept any `Origin`, as FS Copilot's app does.**
   Any tab on the machine can then open a socket to the core, as one can open `ws://127.0.0.1:9020` to FS Copilot's ([06-04](../learn/foundations/06-04-websockets-to-localhost.md#websockets-from-a-panel-to-localhost)).
2. **Rely on the browser to keep its pages off 127.0.0.1.**
   Chrome may ask the pilot first for the local network (unverified, as of 2026-10-08).
3. **Accept only `coui://html_ui`.**
   That refuses our own desktop app, whose pages send `http://tauri.localhost` and whose Rust side sends no `Origin`.
4. **Accept `coui://html_ui` or a missing `Origin`, and have the desktop app connect from its Rust side.**
   A program on the PC can send any `Origin`, so the check keeps out web pages, not programs.

## Decision

Option 4.
It lets in every page we use and the desktop app's Rust side, and refuses a page in a browser, which sends its own site's `Origin`.
The check doesn't rely on Chrome's prompt.

## What it commits us to

- The desktop app's pages reach the core through its Rust side, trading the messages' JSON text with it ([01-spine](../areas/architecture/01-spine.md#messages-and-their-types)).
- The core's WebSocket library, a choice inside the core, accepts a connection only with the `Origin` this decision allows ([decision 027](027-core-runs-on-tokio.md)).
- The apps' stage of step 8 picks the WebSocket client in the desktop app's Rust side, which must send either no `Origin` or `coui://html_ui` ([01-spine](../areas/architecture/01-spine.md#left-open)).
- This decision leaves out a web page the pilot wants to connect, which a one-time approval or a token could let in later ([01-spine](../areas/architecture/01-spine.md#left-open)).
  The tablet in a browser, reached across the home network, would carry a token from the desktop app's QR code ([04-room-for-later](../areas/product/04-room-for-later.md#one-protocol-for-every-client)), and how a client beyond the PC is let in is for the core's stage of step 8 ([01-spine](../areas/architecture/01-spine.md#left-open)).
- It also leaves out a program on the PC, which can send any `Origin` and could do worse anyway.
