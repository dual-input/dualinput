# Glass cockpits and Coherent GT: the JavaScript APIs, the debugger, and injecting code

- [The JS APIs: `Coherent.call`, `SimVar`, CommBus listeners](#the-js-apis-coherentcall-simvar-commbus-listeners)
- [The Coherent debugger on port 19999](#the-coherent-debugger-on-port-19999)
- [Injecting code into panels: overriding VCockpit, load-order conflicts, failing open](#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

The engine, the instrument lifecycle, and the Avionics Framework are in [06-01-the-engine-and-instruments](06-01-the-engine-and-instruments.md), display kinds, input, and pop-outs are in [06-03-display-kinds-input-and-pop-outs](06-03-display-kinds-input-and-pop-outs.md), and WebSockets to localhost are in [06-04-websockets-to-localhost](06-04-websockets-to-localhost.md).

## The JS APIs: `Coherent.call`, `SimVar`, CommBus listeners

A panel script reaches the sim through Coherent GT's bindings: `Coherent.call` asks the sim to do something and returns a Promise, and `Coherent.on` registers a handler for what the sim sends [1].
The sim's own JavaScript library, `SimVar` and `RegisterCommBusListener` among it, is built on these two [1].

**How it works.**
`Coherent` is Coherent GT's `engine` object under another name: the sim's `common.js` assigns one to the other [1].
Four calls do most of the work, read from the sim's `coherent.js`, `common.js`, and `simvar.js` [1]:

| Call | What it does |
| --- | --- |
| `Coherent.call(name, ...args)` | Calls the handler the sim registered as `name`, and returns a Promise of its result |
| `Coherent.on(name, handler)` | Runs `handler` each time the sim, or a script in the same document, triggers `name` |
| `Coherent.trigger(name, ...args)` | Triggers `name` for the handlers in this document and for the sim's own |
| `RegisterViewListener(name)` | Opens a named channel, such as `JS_LISTENER_SIMVARS`, with its own `on`, `call`, and `trigger` |

The names are the API.
`VCockpit.js` learns its gauges from `Coherent.on("ShowVCockpitPanel", ...)` ([06-01](06-01-the-engine-and-instruments.md#vcockpit-baseinstrument-and-panelcfg-gauges)).
It receives `H:` events from `Coherent.on("OnInteractionEvent", (target, args) => ...)`, and passes each to `onInteractionEvent(args)` on every instrument in the document, or only on the instrument whose `Guid` matches when the sim names a target [1].
A WASM gauge's shell sends the pilot's mouse to the sim with calls such as `Coherent.call("WASM_MOUSE_DOWN", guid, clientX, clientY, button)` [2].
The SDK's Coherent.js page indexes a long list of call names and marks itself a work in progress [3], so what a call does is learned by reading the sim's JavaScript ([the next section](#the-coherent-debugger-on-port-19999)) or by measuring it.

`SimVar` is built from both halves, and its reads and writes differ because of it [1]:

- `SimVar.GetSimVarValue(name, unit)` reads from a native object the sim provides, and returns the value at once.
- `SimVar.SetSimVarValue(name, unit, value)` sends `Coherent.call("setValue_Number", name, unit, value, ...)`, or a sibling call for other units, and returns that call's Promise.

Which namespaces each reaches, and how their names are spelled, is in [03-03](03-03-reading-and-writing.md#which-namespace-can-be-read-written-or-listed-from-where).
`SimVar.IsReady()` is false until the native object exists, and `BaseInstrument` waits for it before calling `Init` [1].

A CommBus listener is one more view listener.
`RegisterCommBusListener()` opens `JS_LISTENER_COMM_BUS`, and its `callWasm(name, jsonBuf)` is `this.call("COMM_BUS_WASM_CALLBACK", name, jsonBuf)` [1].
[05-02](05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm) covers the CommBus itself.
Instruments also reach each other on channels of their own: `BaseInstrument`'s `triggerEventToAllInstruments` sends an event to every view through `LaunchFlowEvent("ON_HTMLEVENT_TO_ALL_VIEWS", ...)` [1], and the Avionics Framework syncs its bus through `JS_LISTENER_GENERICDATA` ([06-01](06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)).

**What it changes for Crosscheck.**
Everything Crosscheck's panel code does to the sim goes through a call name or a listener channel, and few of those are documented, so each one Crosscheck depends on needs a measurement first.
A write returns before the sim has applied it, so code that writes a value and reads it straight back, to check for its own echo, may read the old value (unverified).

**Traps.**

- `SimVar.SetSimVarValue` hides failures: it catches any error, logs a warning, and returns a resolved Promise, and it does the same when the native object doesn't exist yet [1].
- Given an `undefined` value, `SetSimVarValue` logs "Trying to set a null value" and returns nothing, so `.then` on its result throws [1].
- In a document inside an iframe, `common.js` points `Coherent` at the top window's engine, so the child's calls go through its parent's (read from the code, unverified in the sim) [1].

## The Coherent debugger on port 19999

While MSFS 2024 runs, it serves a WebKit inspector on `127.0.0.1:19999` that lists every panel document and runs any JavaScript in any of them, with Developer Mode on or off [4] [5].
The SDK's `Debugger.exe` is one client for it, and a script that speaks the protocol is another.

**How it works.**
The SDK ships the debugger in `<SDK_ROOT>\Tools\CoherentGT Debugger\`, and its page says to start it with a flight running, set its URL to `http://127.0.0.1:19999`, and tick Ignore Cache in its network tab so files reload [6].
Under it is WebKit's inspector protocol, which our probes drive from Node [4]:

```text
GET  http://127.0.0.1:19999/pagelist.json     every document, titled "VCockpitNN - <instrumentIdentifier>"
WS   ws://127.0.0.1:19999/devtools/page/<id>   the protocol, for one document
 →   {"id":1,"method":"Runtime.evaluate","params":{"expression":"1+1"}}
 ←   {"result":{"result":{"type":"number","value":2}},"id":1}
```

No list of what this build supports is published, so what works was found by probing [7] [8]:

| Works | Doesn't |
| --- | --- |
| `Runtime.evaluate`: run any expression in the document | `DOM.enable` and `Timeline.enable`: not present |
| `Console.enable`: the document's console messages, the backlog included | `Page.captureScreenshot` and `Page.startScreencast`: "was not found" |
| `Page.getResourceTree`, `Page.getResourceContent`, and `Page.searchInResources`: every script the document loaded | `Page.snapshotRect` and `Page.snapshotNode`: "Could not capture snapshot" |

The resource calls are how we read the sim's own JavaScript.
MSFS 2024 streams its core packages, so files such as `VCockpit.js` and `BaseInstrument.js` aren't on disk, and one VCockpit document loads about 19 scripts, 4.5MB, all of which the inspector hands over [7].
FS Copilot profiles keep a capture of two A220 documents from 2026-08-30, which [06-01](06-01-the-engine-and-instruments.md) quotes [9].
The inspector also reloads a document: after an edit to a panel file already in an installed package, `Page.reload` ran the new file with no sim restart [10].

**What it changes for Crosscheck.**
The debugger reaches every panel on a sim set up the way a pilot's is, so it's the tool for Crosscheck's panel experiments.
Whether a shipped Crosscheck could use it too, to reach panels without replacing a core file, is an open question: it worked with Developer Mode off [5], and nothing documents it as an interface for apps.

**Traps.**

- Page IDs change between sessions, so a script selects a document by title, and titles repeat: both A220 CTP documents share one ([06-01](06-01-the-engine-and-instruments.md#vcockpit-baseinstrument-and-panelcfg-gauges)).
  The fsc-exerciser finds its document by a global that FS Copilot's panel code sets, `window.fscPointer.key` [11].
- The console collapses a message identical to the one before it: 20 identical messages arrived as 1, and a recording of about nine cockpit actions held five events [12].
  A sequence number in each message turns the loss into a visible gap.
- A dead process can hold the port.
  Two addon helpers, `TDSGTNXiFlightSimEXE` and `map-server`, outlived the MSFS process that started them, and one of them held its listening socket on 19999, which accepted connections and answered nothing [7] [13].
  The running MSFS bound the port within seconds of both being killed [13].
  Check that the port's owner is a running MSFS before reading anything into silence.
- An early connection refused while the sim was still booting once read as "needs Developer Mode" ([02-03](02-03-the-running-sim.md#developer-mode-tools)).
- The SDK calls changes made in the debugger temporary, for previewing [6], and a reload discards them.

## Injecting code into panels: overriding VCockpit, load-order conflicts, failing open

The only file the sim loads into every panel document is `html_ui/Pages/VCockpit/Core/VCockpit.js`, so FS Copilot and YourControls each ship a whole copy of it with their own lines added, and the sim runs one package's copy [14] [15].
Code added there runs inside the loading of every instrument on every aircraft, so it has to fail open: when it fails, the cockpit must behave as if it weren't installed.

**How it works.**
FS Copilot's copy is the stock file plus two blocks between `/* FS Copilot Integration */` markers [14] [16].
The first block, at the top of the file, loads eight scripts in order through a nested chain of `Include.addImports`: the sim's `CommBus.js` and seven of FS Copilot's own.
Once they've loaded, it builds a `Hook` for each instrument that arrived in the meantime.
It also replaces `EventTarget.prototype.addEventListener` in every document, to record which event types each element listens for.
The second block sits in `createInstrument`, right after the sim's code has set the instrument up:

```js
/* FS Copilot Integration */
if (jsLoaded) {
    try { hook = new Hook(template); }
    catch (error) { console.error(error); }
}
else {
    templatesToLoad.push(template);
}
/* End of FS Copilot Integration */
```

YourControls' copy hooks the same two places with fewer guards [17].
In `createInstrument` it runs `handler = new YourControlsHandler(...)` with no `try`, and its `OnInteractionEvent` handler asks that handler first, returning before any instrument sees an `H:` event whose name starts with `YCB`.
Reading the code, a throw from that constructor would skip `loadNextInstrument()`, so the document's later gauges would never load (unverified in the sim).

The copies conflict.
[02-01](02-01-installs-and-packages.md#packages-and-the-virtual-file-system) shows how the mount order picks one file among packages, and here it picks whose code runs.
FS Copilot's installer deletes the YourControls package ([01](01-prior-art-and-crew-practice.md#prior-art)), and our prototype's build refused to install beside FS Copilot's package, because the result would be "silently one or the other" [15].
Each copy is also Asobo's file as it was when copied, and FS Copilot's header warns that it "must be kept in sync with the original simulator version after MSFS updates, otherwise avionics/instruments may break" [16].
Our prototype recovered the stock file by stripping FS Copilot's marked blocks, and refused to write its own copy if any marker was missing [15].

Three incidents in the FS Copilot fork show what failing open takes:

1. A syntax error in the copy stops every instrument in every panel ([06-01](06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits)), so every panel file gets `node --check` before it's packaged [18].
2. FS Copilot's original patch kept a waiting instrument in one variable, `templateToLoad`, so on a document with several instruments, each one overwrote the one before, and only the last got a `Hook` [19].
   The fix is the array in the excerpt above, drained in order, with each construction in its own `try`.
3. A probe wrapped `Coherent.call` on an A350 display to catch its WASM mouse calls, and its flag to suppress them stayed on after a report [20].
   Every real click on that display vanished while hover still worked, the only handle to the original function had been deleted, and only `location.reload()` on the document brought the display back.
   The rules that came out of it: suppress only for the length of one dispatch and clear it unconditionally afterward, keep a restore function at a fixed global, and add a deadman that uninstalls the wrapper after 120s idle [20].

FS Copilot's production pointer code follows those rules [21] [22].
Its `pointer.js` adds listeners and dispatches events, and wraps nothing.
When it has to block the pilot's input, during an outage, it covers the instrument with a visible `div` rather than swallowing events, `window.fscUnlock()` removes the `div` from any console, and a block that hears no renewal from the app for 8s turns into a warning that doesn't block.

**What it changes for Crosscheck.**
If Crosscheck gets code into panels by replacing `VCockpit.js`, a pilot can run only one of Crosscheck, FS Copilot, and YourControls at a time (unverified, [01](01-prior-art-and-crew-practice.md#unverified-claims)), and each MSFS update that changes the stock file needs a new copy.
Whatever Crosscheck adds runs in every instrument's load, so a fault there takes out the pilot's displays along with Crosscheck's features.

**Traps.**

- A second package that overrides the same file replaces yours with no error, which is what our prototype and FS Copilot's package did to each other [15].
- `Include.addImports` loads asynchronously, and the sim can create instruments before the injected scripts exist, so code called from `createInstrument` has to queue, as FS Copilot's does [14].
- The `VCockpit.js` in our captures is FS Copilot's copy, not Asobo's: it carries FS Copilot's `/* FS Copilot Integration */` blocks, because FS Copilot was installed when the captures were taken [1] [16].

## Sources

1. Documented, read from JavaScript captured out of the running sim: FS Copilot profiles at d3d7689, `sim-sources/vcockpit02-displayunits/`, captured from MSFS 2024 on 2026-08-30: `html_UI_JS_coherent.js` (`engine.call`, `engine.trigger`, and `engine.on`), `html_UI_JS_common.js` (the assignment of `Coherent`), `html_UI_JS_simvar.js` (`GetSimVarValue`, `SetSimVarValue`, and `IsReady`), `html_ui_js_services_commbus.js`, `html_UI_Pages_VCockpit_Core_VCockpit.js` (the `OnInteractionEvent` handler, and the `/* FS Copilot Integration */` blocks that show the capture is FS Copilot's copy), and `html_UI_Pages_VCockpit_Instruments_Shared_BaseInstrument.js`.
2. Documented in our record, read from the sim's `WasmSimCanvas.js` through the inspector: FS Copilot fork, `record/pointer-forwarding/docs/07-wasm-surface.md`, section "The input channel".
3. Documented: MSFS 2024 SDK, [Coherent.js](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/JavaScript/Coherent.htm), as of 2026-09-27.
4. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 — Q00 is yes: the sim hosts a WebKit inspector and it evaluates anything".
5. Measured on MSFS 2024, 2026-09-01: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-01 - Single-machine cockpit validation: the production pipeline works", the Q00 correction.
6. Documented: MSFS 2024 SDK, [Coherent GT Debugger](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/JavaScript/Coherent_GT_Debugger.htm).
7. Documented in our record, found by probing: FS Copilot fork, `record/pointer-forwarding/docs/09-environment.md`, sections "Reading the simulator's own source" and "Inspector domains that work", including the operational trap at its end.
8. Measured on MSFS 2024, 2026-09-17: FS Copilot fork, `record/exerciser/results/p02-popout-mapping-2026-09-17.txt`, the inspector section, read in `record/exerciser/docs/log.md`, "2026-09-17 — A pop-out capture maps to rect fractions by contain-fit, within 6.5 px".
9. Documented: FS Copilot profiles at d3d7689, `sim-sources/README.md`.
10. Measured on MSFS 2024, 2026-09-17: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-17 — A peer's press drove the real A220 ND, opted in by identifier alone".
11. Documented: fsc-exerciser at 2e4783a, `README.md`, "What it needs from FS Copilot".
12. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - The console channel silently drops repeated messages".
13. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 — The port was squatted by a dead process's inherited socket".
14. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge/PackageSources/HTML_UI/Pages/VCockpit/Core/VCockpit.js`, compared with `record/pointer-forwarding/module/vendor/VCockpit.stock.js`.
15. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/10-module.md`, sections "Getting code into a panel" and "The conflict, and why the build refuses".
16. Documented, read from source: the header comment of FS Copilot's `VCockpit.js`, in the same file as [14].
17. Documented, read from source: [YourControls](https://github.com/YourControls/yourcontrols) at commit 31b1706, `scripts/build-include/2024/YourControls/html_ui/Pages/VCockpit/Core/VCockpit.js` and `html_ui/YourControls/Main.js`.
18. Measured with `node --check`, not in the sim, on 2026-09-02: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-02 - The branch's VCockpit.js was unparseable; caught before any panel loaded it".
19. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, section "5.1 Bug fixes — pre-existing, stand alone".
20. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 — A probe that wraps a sim API disabled the aircraft, and could not be undone".
21. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, sections "4.8 Blocking with an overlay div, not by suppressing events" and "7.2 Overlay (panel side)".
22. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js`, the header comment, the watchdog, and `window.fscUnlock`.

## Unverified claims

- **A read right after `SimVar.SetSimVarValue` returns the old value.**
  The write goes out through `Coherent.call` and the read comes from a native object [1], and nobody has timed the two.
  Writing an `L:` variable from a panel and reading it back at once, on the next frame, and a frame later would settle it.
- **A throw from YourControls' handler constructor stops a document's later gauges from loading.**
  We read it from the code [17].
  Making the constructor throw in a copy of YourControls' package and listing the document's instruments through the inspector would settle it.
- **A document inside an iframe calls the sim through its parent's engine.**
  We read it from `common.js` [1].
  Evaluating `Coherent === window.top.engine` in the Fenix EFB's iframe would settle it.
