# 027: The core runs on tokio

The core's Rust code runs its sockets, timers, and other waiting work on tokio, the async runtime.
Its WebSocket library is a choice inside the core, which accepts a connection only with the `Origin` it allows ([decision 013](013-core-accepts-sim-origin-or-none.md)) and can listen beyond the PC, off by default ([01-spine](../areas/architecture/01-spine.md#left-open)).
Decided by the user on 2026-10-09, in node 1.6 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#the-core-runs-on-tokio).

## Context

Node 1.3 left the core's async runtime and WebSocket library open as a choice inside one part, and step 7's exit needs a decision on the frameworks ([architecture plan](../areas/architecture/plan.md#16-frameworks)).
The core holds many connections at once, about 20 cockpit panels' sockets on top of the desktop app's, the network, and its uploads ([01-spine](../areas/architecture/01-spine.md#communication)).
The desktop app is a Tauri app, a Rust program like the core ([decision 018](018-rust-and-typescript.md)).

## Options

1. **Blocking code.**
   It would hold one thread for each of the core's connections.
2. **tokio.**
   An async runtime runs those connections on a few threads.

The record compared tokio with no other async runtime.

## Decision

Option 2.
Tauri, the desktop app's framework, runs on tokio: "Tauri uses tokio Runtime to initialize code" (documented, [tauri::async_runtime](https://docs.rs/tauri/latest/tauri/async_runtime/index.html), tauri 2.12.2, as of 2026-10-09).
The desktop app's Rust side reached a WebSocket server through tokio-tungstenite 0.30.0, which runs on tokio (measured on our development machine, 2026-10-08, [architecture log](../areas/architecture/log.md#2026-10-08-a-tauri-2-window-takes-723-mb-of-memory-over-seven-processes-against-electrons-665-mb-over-four-its-program-is-80-mb-against-3474-mb-and-its-rust-sides-websocket-sends-no-origin)).

## What it commits us to

- The core's WebSocket library is left to the core's stage of step 8 ([01-spine](../areas/architecture/01-spine.md#left-open)).
  Whichever it is runs on tokio and accepts a connection only with the `Origin` that decision 013 allows.
- How a client beyond the PC is let in is left to the core's stage too: v1 builds a protocol that can listen beyond the PC, off by default ([04-room-for-later](../areas/product/04-room-for-later.md#one-protocol-for-every-client)), while the core listens on 127.0.0.1 ([01-spine](../areas/architecture/01-spine.md#left-open)).
