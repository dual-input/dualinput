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

Pages that aren't cockpit panels held one too.
On 2026-10-08 our probe ran code in each page the inspector listed, and a WebSocket to the probe's server on 127.0.0.1 opened and got its echo from all 14 pages in the main menu and all 32 in a flight in the A2A PA-24, among them mainUi, the toolbar, the EFB, one in-game panel of ours, and the PA-24's 16 cockpit panels [11].
The server logged the `Origin` header of every one of them, and every page sent `Origin: coui://html_ui`, mainUi and the cockpit panels alike [11].

A page's socket doesn't end when the page does.
A cockpit panel that ran `location.reload()` left its socket open for the 23s the run had left, with no close frame and no connection ending on the server's side [12].
All 16 cockpit panels' sockets were still open 11s after the pilot was told to leave the flight, when the inspector stopped listing the panels, and the sim had sent `FLIGHT_END` and `BACK_TO_MAIN_MENU` 4s after the prompt [12].
Our banner panel's stayed open for the 35s left after the toolbar's page toggled the panel closed, though this run didn't check that the page was gone [12].
A socket opened by Node 22.23.1 closed the usual way, sending a close frame and ending its connection as soon as it closed [12].

Sockets cost no frame time we could measure.
Uncapped, at about 83 fps, the two 10s windows with nothing of ours read 12.25ms and 12.07ms a frame, and the six with a socket in each of the 16 cockpit panels, idle, taking a message every 2s, or taking 30 messages a second each, read 12.01ms to 12.07ms [11].
All 11,653 messages the probe sent to the 16 panels in that run arrived and parsed [11].
With the frame rate capped at 30 fps, every window read 31.0 fps, so the cap hid any cost [11].

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
FS Copilot's later PR notes still list that test as not done [10], and we trust the log, which describes running it.
How fast panels find a restarted app depends on the backoff: lengthening the wait after every failed port made them take about 80s, and lengthening it once per lap of the five ports brought that to about 20s [7].

FS Copilot moved forwarded clicks onto this channel from its CommBus path because a drag of 240 points is about 2.4KB [5], and the client data areas on the CommBus path hold one 512-byte message each ([05-02](05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm)).

**What it changes for Crosscheck.**
Crosscheck's panel code, and the code of every other page we use, can reach Crosscheck's app directly, without a WASM module in between.
A restart of the app ends every socket, but a reload of a page ends none, so the app can't take a closed socket to mean its page went away, and has to learn that from what the page sends.
Any process on the machine can connect to the same port, so the app has to decide what a local connection is allowed to do.

**Traps.**

- A panel that reloads opens a new socket and leaves the old one open [12], so the app holds both until it closes the old one, and a message for the panel can go out on the wrong one.
  Anything meant for the new document in the gap is gone: FS Copilot's app drops input for a panel that hasn't said hello rather than holding it, because a reloaded display comes back in its default state [5].
- Coherent GT sends `Origin: coui://html_ui` from every page we tried [11], and a browser tab sends its own site's, so a listener could tell the two apart.
  FS Copilot's app accepts any `Origin`, so any tab on the machine can open `ws://127.0.0.1:9020` [8].
  A listener that refuses a missing `Origin` would refuse our own desktop app, because the built-in WebSocket in Node 22.23.1 and in Electron 43.4.0 sends none, whether Electron runs as Node or as its main process [12].
- Measure frame time with the frame rate uncapped: a cap at 30 fps read 31.0 fps in every window and hid any cost [11].
- Test with Developer Mode off and the inspector closed: the first WebSocket result came with the inspector attached, and only the second run made the channel safe to rely on [2].
  The 2026-10-08 runs put their code in each page through the inspector too [11].
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
10. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, the trimming risk in §12, "trimmed-publish survival" under "Not verified" in §14, and the unchecked publish item in §16.
11. Measured on MSFS 2024 SunRise 12.2.282174.999, 2026-10-08: [interface log](../../areas/interface/log.md#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one), "Every page we use reaches the core by WebSocket and by the CommBus, but the menu's page can't read an `L:` variable, and a flight load resets one", with the output in `experiments/areas/interface/results/p13-sim-links-2026-10-08-13-39-22.txt` and `p13-sim-links-2026-10-08-13-54-50.txt`.
12. Measured on MSFS 2024 SunRise 12.2.282174.999, 2026-10-08, and without the sim for Node and Electron: [interface log](../../areas/interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel), "A page's WebSocket stays open after the page is gone, and the CommBus reaches every page we use in the menu and every cockpit panel", with the output in `experiments/areas/interface/results/p15-links-coverage-2026-10-08-14-54-27.txt` and `p16-client-origin-2026-10-08-15-13-38.txt`.

## Unverified claims

- **How long the sim keeps a socket open after its page is gone.**
  The longest we watched was 35s, for our banner panel, whose page the run didn't check was gone [12].
  Leaving the probe's server holding the sockets of a reloaded panel and a closed one for 10 minutes would settle it.
- **Whether the cost of sockets stays unmeasurable on an aircraft with many more cockpit panels.**
  The PA-24 has 16, and nobody has run an aircraft with many more [11].
  Repeating the uncapped frame-time windows on an aircraft with many more panels would settle it.
- **Panels on other pilots' machines held the channel.**
  We infer it from the presses our machine replayed [9], and the other machines' logs weren't read.
  Reading a peer's app log from a shared session for its `PanelServer` hello lines would settle it.
