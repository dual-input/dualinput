# Glass cockpits and Coherent GT: WebSockets from a panel to localhost

- [WebSockets from a panel to localhost](#websockets-from-a-panel-to-localhost)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

The engine, the instrument lifecycle, and the Avionics Framework are in [06-01-the-engine-and-instruments](06-01-the-engine-and-instruments.md), the JavaScript APIs, the debugger, and injecting code are in [06-02-apis-debugger-and-injection](06-02-apis-debugger-and-injection.md), and display kinds, input, and pop-outs are in [06-03-display-kinds-input-and-pop-outs](06-03-display-kinds-input-and-pop-outs.md).

## WebSockets from a panel to localhost

Code in a panel document can open a WebSocket to a process on the same machine, at `ws://127.0.0.1:<port>`, and hold it open in both directions, with Developer Mode off [1] [2].
FS Copilot and YourControls both do it, and it gives panel code a channel to a desktop app with no WASM module, SimConnect, or CommBus in between [3] [4].

**How it works.**
The probe ran in the A220's DisplayUnits document, whose address is `coui://html_UI/Pages/VCockpit/Core/VCockpit.html`, against a test server on the same machine [1]:

```text
XHR      ok    status=200
fetch    ok    status=200
WS       OPEN — a cockpit document can hold a WebSocket to loopback
```

The server logged the upgrade and the panel's message on its side, and the panel received the server's echo [1].
That run had the inspector attached, and a later run of the full prototype in the cockpit, with Developer Mode off, worked the same [2].
Other machines' panels held the channel too.
In a three-way session on 2026-09-08, our machine replayed 70 presses captured on the other machines, which their panels could only have sent this way, though nobody read their logs [9].
The Fenix EFB, which loads `http://localhost:8083` in an iframe, had already shown that a cockpit page can reach loopback over HTTP ([06-03](06-03-display-kinds-input-and-pop-outs.md#display-kinds-html-react-on-dom-react-on-svg-canvas-wasm-gauges)).

The two projects find the app in different ways [3] [4]:

| | YourControls | FS Copilot fork |
| --- | --- | --- |
| Port | 7780 | The first free port from 9020 to 9024, which the panel tries in turn |
| When a panel tries | Every 4s, only while `L:YourControlsServerRunning` is true, and only from the elected instrument or an interactive one | At once, then after a wait that grows from 500ms to 4s with each lap of the five ports |
| Sockets | One per instrument that connects | One per document, shared by its instruments |

FS Copilot's panel side, `channel.js`, handles what a document's short life does to a socket [4]:

- It sends a hello with each instrument's key, URL, and size on every connect, so the app can rebuild its routing after a reload or an app restart.
- The app answers every hello, and a panel that gets no reply within 10s closes the socket and tries the next port, so a server that accepts and says nothing can't hold the panel.
- While disconnected, it queues at most 200 messages and drops any older than 30s, because stale input is worse than none.
- The app sends `bye` before it quits on purpose, so the panel can tell a quit from a crash.

The app side is .NET's `HttpListener` with `AcceptWebSocketAsync`, bound to `127.0.0.1` [5].
A published build, not run as administrator, bound `127.0.0.1:9020` and accepted a WebSocket upgrade [6].
How fast panels find a restarted app depends on the backoff: lengthening the wait after every failed port made them take about 80s, and lengthening it once per lap of the five ports brought that to about 20s [7].

FS Copilot moved forwarded clicks onto this channel from its CommBus path because a drag of 240 points is about 2.4KB [5], and the client data areas on the CommBus path hold one 512-byte message each ([05-02](05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm)).

**What it changes for Crosscheck.**
Crosscheck's panel code can reach Crosscheck's app directly, without a WASM module in between.
Both ends have to expect the socket to drop whenever a document reloads or the app restarts, and to rebuild their state from the next hello.
Any process on the machine can connect to the same port, so the app has to decide what a local connection is allowed to do.

**Traps.**

- A panel that reloads gets a new socket, and anything meant for the old document in the gap is gone: FS Copilot's app drops input for a panel that hasn't said hello rather than holding it, because a reloaded display comes back in its default state [5].
- The `Origin` header that Coherent GT sends is unknown, so FS Copilot's app can't yet tell the sim from a browser tab, and any tab on the machine can open `ws://127.0.0.1:9020` [8].
- Test with Developer Mode off and the inspector closed: the first WebSocket result came with the inspector attached, and only the second run made the channel safe to rely on [2].
- A process can hold a port after its owner quits, as an addon's helper held the debugger's ([06-02](06-02-apis-debugger-and-injection.md#the-coherent-debugger-on-port-19999)), and FS Copilot's five-port range and reply timeout cover that case [4] [5].

## Sources

1. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - Q08 yes: a cockpit document can hold a WebSocket to loopback", with the output in `record/pointer-forwarding/results/p05-websocket-vcockpit02-displayunits-2026-08-30-12-31-25.txt`.
2. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - The module works with DevMode off".
3. Documented, read from source: [YourControls](https://github.com/YourControls/yourcontrols) at commit 31b1706, `scripts/build-include/2024/YourControls/html_ui/YourControls/Main.js` and `Network.js`.
4. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/channel.js`.
5. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, sections "3.2 App ↔ peer (binary packets)", "4.1 Transport: WebSocket sidecar, not the CommBus", "4.2 Port discovery: range scan 9020–9024", and "6.2 Method level — `PanelServer`".
6. Measured without the sim, 2026-09-01: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-01 - The FS Copilot implementation is built and verified offline".
7. Measured on MSFS 2024, 2026-09-01: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-01 - Single-machine cockpit validation: the production pipeline works".
8. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, "R12 · The panel listener accepts any origin", and `record/pointer-forwarding/docs/15-sim-session.md`, "1 · R12 — what Origin does Coherent actually send?".
9. Measured on MSFS 2024, 2026-09-08: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-11 — First multi-machine session, read from the app log", with our side's log in `record/pointer-forwarding/results/session-2026-09-08-app.txt`.

## Unverified claims

- **Which `Origin` header Coherent GT sends on a panel's WebSocket.**
  FS Copilot's app logs it on every connection, and nobody has read the line from a sim session [8].
  Loading any aircraft with a Debug build of the FS Copilot fork and reading the `Panel connected, origin` line would settle it.
- **Panels on other pilots' machines held the channel.**
  We infer it from the presses our machine replayed [9], and the other machines' logs weren't read.
  Reading a peer's app log from a shared session for its `PanelServer` hello lines would settle it.
