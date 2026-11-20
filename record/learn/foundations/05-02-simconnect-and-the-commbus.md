# WASM modules: SimConnect and the CommBus

- [SimConnect from inside a module](#simconnect-from-inside-a-module)
- [The CommBus: WASM to JS to WASM](#the-commbus-wasm-to-js-to-wasm)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Module kinds, the lifecycle, and the gauge API are in [05-01-kinds-lifecycle-and-apis](05-01-kinds-lifecycle-and-apis.md), and the toolchain, versioning, and debugging are in [05-03-toolchain-versioning-and-debugging](05-03-toolchain-versioning-and-debugging.md).

A module can't open a socket ([05-01](05-01-kinds-lifecycle-and-apis.md#gauge-vs-standalone-modules-and-the-sandbox)), so it talks to the rest of the world through two channels the sim provides: SimConnect, which reaches apps outside the sim, and the CommBus, which reaches panel JavaScript and other modules.

## SimConnect from inside a module

A module includes the SDK's `SimConnect.h` and calls `SimConnect_Open` like an app does, and the sim's SimConnect server treats it as one more client [1] [2] [3].
Both our modules reach their apps this way, through client data areas that both sides name ([04-03](04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits)).

**How it works.**
Everything in [part 4](outline.md#4-simconnect-full) holds for a module, with three differences.

The first is pumping.
An app loops, calling `SimConnect_CallDispatch` or waiting on an event handle ([04-01](04-01-connection-and-data.md#what-it-is)), and a module can't sit in a loop, because the sim calls its functions and waits for each to return.
Our two modules pump in different ways:

| Module | How it pumps | Evidence that messages arrive |
| --- | --- | --- |
| FS Copilot | Calls `SimConnect_CallDispatch` once, in `module_init`, and never again [2] | Read from source only; a 2021 forum post, about MSFS 2020, says one call is enough inside the sim (unverified) [5] |
| fsc-editor | Calls it at the start of every `Update_StandAlone` [3] | Commands sent from outside were answered, with values streaming throughout (measured) [4] |

The second is who creates the areas.
A standalone module loads at boot, and the app connects whenever the pilot starts it, so the module is there first.
fsc-editor's module creates both its areas in `module_init` and leaves a hello in the output area, and the app only maps and subscribes, treating an exception there as "module not running" [3] [6]:

```text
sim boots        module_init: open "fsc-editor-link"; create FSCEDITOR_LINK_CMD and
                 FSCEDITOR_LINK_OUT, 8,192 bytes each; subscribe to CMD, ON_SET;
                 leave a hello in OUT with the module's version, 0.7.0, and protocol, 6
app connects     map both names; subscribe to OUT, ON_SET; write "start" into CMD
module           reads "start" in its dispatch callback; writes a hello with the variable
                 count, then the L: names in chunks, then changed values at 15Hz, into OUT
```

The third is which sim the module is built for.
The SDK says a module is detected as an MSFS 2024 module only if it's linked with `MSFS_WasmVersions.a`, and that without it, features such as SimConnect "behave as if they were from a MSFS 2020 module" [7].
The platform toolset links it without being asked ([05-03](05-03-toolchain-versioning-and-debugging.md#toolchain-sdk-platform-toolset-fspackagetool-the-project-editor)).
A Rust module built without it was compiled into `WASM\MSFS2024` and ran [20], and what the sim does differently for such a module is unmeasured.

A module has all of SimConnect, alongside the Vars API.
FS Copilot's module reads four freeze and state variables and `L:FSC_CONTROL` through a data definition at `SIMCONNECT_PERIOD_SIM_FRAME` with the `CHANGED` flag, and writes position through calculator code [2].

**What it changes for Dual Input.**
Dual Input's app and module would share only what the SimConnect server carries, so the limits of client data areas apply: 8,192 bytes an area, one message an area, and the last message kept after its writer leaves ([04-03](04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits)).
The module is there before the app and stays after it, so the app has to find out, each time it connects, whether a module is there and which version it is.

**Traps.**

- Both our modules return from `module_init` without a word when `SimConnect_Open` fails, so a module that couldn't connect looks, from the app, like no module at all [2] [3].
- Inside a module, `HANDLE` is 64 bits wide though pointers are 32 [19].
  A Rust binding that declared it as a pointer got `S_OK` from `SimConnect_Open` and a handle that fit in 32 bits, then `E_FAIL`, −2147467259, from the first call after it, and the module's data areas never appeared; declared as a 64-bit integer, `SimConnect_Open` and the eight setup calls after it returned `S_OK` [20].
  C++ takes the width from the SDK's header, so a binding written by hand has to follow the header for every type, because a wrong width compiles and loads.
- Some SimConnect structures changed size in MSFS 2024: the `ident` member of `SIMCONNECT_ICAO` and the structures built on it grew to 8 [1] [7].
  The SDK warns about code that copies them into short fixed buffers.
- In MSFS 2020, a gauge module received no `SimStart` or `SimStop`, because it loads only once a flight is running, according to a 2021 forum post (unverified) [8].
  Code moved from a standalone module into a gauge could wait forever for an event that never comes.

## The CommBus: WASM to JS to WASM

The CommBus is the sim's named-message bus among WASM modules, panel JavaScript, and SimConnect clients [9] [10] [11].
A sender calls an event name with a string, and every listener registered under that name, on the platforms the sender picked, receives it.
Unlike a client data area, it keeps no last value.

**How it works.**
Each side registers a callback under an event name and calls names the others registered [9] [10] [11]:

| Side | Listen | Send |
| --- | --- | --- |
| Module | `fsCommBusRegister(name, callback, context)` | `fsCommBusCall(name, buffer, size, broadcastTo)` |
| Panel JavaScript | `RegisterCommBusListener()`, then `.on(name, callback)` | `.callWasm(name, text)`, `.callSimConnect(name, text)`, or `.callAll(name, text)` |
| SimConnect client | `SimConnect_SubscribeToCommBusEvent` ([04-01](04-01-connection-and-data.md#what-it-is)) | `SimConnect_CallCommBusEvent` |

A module's call reaches only the platforms in its `broadcastTo` flags [11]:

| Flag | Value | Reaches |
| --- | --- | --- |
| `FsCommBusBroadcast_JS` | 1 | Panel JavaScript |
| `FsCommBusBroadcast_Wasm` | 2 | Other modules |
| `FsCommBusBroadcast_WasmSelfCall` | 4 | With `_Wasm`, the calling module too |
| `FsCommBusBroadcast_SimConnect` | 8 | SimConnect clients |
| `FsCommBusBroadcast_Default` | 11 | JavaScript, other modules, and SimConnect clients |

The SDK recommends JSON for the string, and says "All calls are asynchronous" [9].
None of the three APIs has a call that reads an earlier message [9] [10] [11], so a listener that registers late has missed what came before.

A SimConnect client and the sim's pages reach each other over it, in both directions.
On 2026-10-08 a probe that was a SimConnect client called `SimConnect_CallCommBusEvent` for JavaScript every 500ms, and subscribed with `SimConnect_SubscribeToCommBusEvent` to a name each page called [17] [18].
In the main menu, 13 of the 14 pages heard the calls and reached the subscription.
In a flight in the A2A PA-24, 30 of the 31 pages heard them, all 16 of its cockpit panels among them, and 29 reached the subscription [18].
A page's call back is `COMM_BUS_SIMCONNECT_CALLBACK` with an event name and a text, made on its listener where it has one and on `engine` where it has none [17] [18].

What a page has decides how it listens, and a page without `Coherent` hears the calls through the sim's own view-listener mechanism, not through the CommBus API [17]:

| Page has | It listens through | Pages |
| --- | --- | --- |
| The sim's `common.js` | `RegisterCommBusListener`, after loading the sim's `Services/CommBus.js` where the page hasn't | The EFB, the cockpit panels, our in-game panel, and the toolbar in a flight, among others |
| `engine` but no `Coherent` | `ADD_VIEW_LISTENER` for `JS_LISTENER_COMM_BUS`, then `EVENT_FROM_VIEW_LISTENER` | mainUi, the main menu's own page, and the menu's atlas, notifications, Shared variables, Mission Steps, and toolbar pages |

A sketch of the second route, from the probe:

```js
engine.on("EVENT_FROM_VIEW_LISTENER", function (listener, name) {
  if (String(listener).toUpperCase() === "JS_LISTENER_COMM_BUS" && name === "CROSSCHECK_P15_HELLO") {
    // the client's call arrived
  }
});
engine.trigger("ADD_VIEW_LISTENER", "JS_LISTENER_COMM_BUS", window.location.pathname);
```

A call arrives on that route as an `EVENT_FROM_VIEW_LISTENER` for `JS_LISTENER_COMM_BUS`, never as an event of its own name, so a page that listens for the name alone hears nothing [17].
The sim's own page code takes events this way (read in fs-base-ui 0.1.10, `html_ui/Global/lib.js`, `ViewListenerMgr`) [17].

Two pages broke the pattern [18]:

- A page named `transition` heard no call, and the sim rejected its call back: "COMM_BUS_SIMCONNECT_CALLBACK not bound. Call engine.trigger instead of engine.call if you do not bind nor need the result."
- The toolbar's page in a flight heard 13 calls, but its listener still hadn't reported ready about 7s after it registered, and the one call it made 1.5s in never reached the probe or settled.
  In an earlier run its listener reported ready and its call arrived [17].

FS Copilot uses the CommBus between its panel hook and its module, to carry clicks on a display and `H:` events.
The module relays them to and from the app through two client data areas of 512 bytes [2] [12]:

```text
panel hook       bus.callWasm("FSC_GAUGE_EVENT", '{"type":"interact",...}')
   ↓
module           fsCommBusRegister("FSC_GAUGE_EVENT", receive_gauge_msg)
                 → SimConnect_SetClientData(FSC_BUS_OUT, 512 bytes)
   ↓
app ── network ── the other machine's app
                     ↓ SetClientData(FSC_BUS_IN, 512 bytes)
                  its module: fsCommBusCall("FSC_CLIENT_EVENT", msg, 512, FsCommBusBroadcast_JS)
                     ↓
                  every panel: bus.on("FSC_CLIENT_EVENT", ...), and the addressed one clicks
```

Because the module broadcasts to all JavaScript, every panel document receives and parses every inbound message and drops those addressed to another panel [13].
Our FS Copilot fork moved forwarded clicks off this path, to a WebSocket from each panel to the app, because the areas hold one 512-byte message each and a drag needs a stream of 20 to 30 messages a second [13] [14].
[Part 6](outline.md#6-glass-cockpits-and-coherent-gt-full) covers that WebSocket.

Aircraft use the CommBus too.
The Synaptic A220's systems module publishes its state as JSON on more than 30 named channels, such as `A22X.L PFD Data`, for its JavaScript displays to draw [15].
The panels get the selected altimeter setting on the CommBus, as `qnh_hpa` on `A22X.L ADS Data` and `qnh.value` on `A22X.L CTP Data` [16].
Whether `A:KOHLSMAN SETTING MB` follows it is unverified ([07](07-aircraft-specific-systems.md#why-study-level-aircraft-diverge)).

**What it changes for Dual Input.**
Some aircraft keep state only on the CommBus, and a Dual Input module could register for the same names to read it, but it receives only calls whose sender set the WASM flag.
The A220's module sets only the JavaScript flag, `FsCommBusBroadcast_JS`, so a module can't read the A220's channels, and Dual Input has to read them from panel JavaScript (unverified).
A SimConnect client can call into all but one of the pages we use, and a page's call back can be lost before its listener reports ready, as the toolbar's was [18].

**Traps.**

- The SDK's samples call `fsCommBusCall` with `FsCallFlags::FsCall_JS` and similar names, which SDK 1.7.3's header doesn't have, and show a callback type without the `context` argument the header declares [9] [11].
  We trust the header, which spells the flags `FsCommBusBroadcast_JS` and so on.
- A module doesn't hear its own calls unless it adds `FsCommBusBroadcast_WasmSelfCall` [11].
- FS Copilot's module drops a message from JavaScript longer than 512 bytes, and logs nothing [2].
- The route into a page without `Coherent` is the sim's own page code, not a call of the JavaScript Communication API [10] [17], so a sim update could change it.
- A SimConnect client receives only calls whose sender set `FsCommBusBroadcast_SimConnect` [11].
  Our A220 notes say SimConnect can't see its CommBus traffic [15], and no client has subscribed to one of its channels (unverified).
  The SDK's claim that SimConnect clients and JavaScript exchange CommBus events holds for the events our probe sent [17] [18].

## Sources

1. Documented: MSFS 2024 SDK, [SimConnect SDK](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/SimConnect_SDK.htm), sections "Upgrade SimConnect from MSFS 2020 to MSFS 2024", "WebAssembly Modules", and "Design Considerations".
2. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge.Wasm/wasm_module.cpp` (`module_init`, `dispatch`, and `receive_gauge_msg`) and `protocol.h`.
3. Documented, read from source: fsc-editor at 4cbf8ab, `link/src/module.cpp` (`module_init`, `Update_StandAlone`, `send`, and the `start` branch of `dispatch`).
4. Measured on MSFS 2024, 2026-08-25: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-25 — The wire runs calculator code, and `gauges.h` came back clean".
5. Unverified, forum, about MSFS 2020: Microsoft Flight Simulator Forums, [SimConnect connection in WASM module](https://forums.flightsimulator.com/t/simconnect-connection-in-wasm-module/358861), the post of 2021-01-29 quoting another developer.
6. Documented, read from source: fsc-editor at 4cbf8ab, `src/main/sim/link.ts`, `subscribeLink` and its comment.
7. Documented: MSFS 2024 SDK, [WebAssembly](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/WASM/WebAssembly.htm), section "Upgrade a WebAssembly module from MSFS 2020 to MSFS 2024".
8. Unverified, forum, about MSFS 2020: Microsoft Flight Simulator Forums, [Does SimConnect work differently in standalone Wasm modules and panel Wasm modules?](https://forums.flightsimulator.com/t/does-simconnect-work-differently-in-standalone-wasm-modules-and-panel-wasm-modules/400430), 2021-05-10.
9. Documented: MSFS 2024 SDK, [Communication API](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/WASM/Communication_API/Communication_API.htm), for WASM.
10. Documented: MSFS 2024 SDK, [Communication API](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/JavaScript/Communication_API/Communication_API.htm), for JavaScript.
11. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_CommBus.h`, and `SimConnect SDK/include/SimConnect.h`, the CommBus calls.
12. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/bus.js` and `hook.js`, and `FsCopilot/Connection/SimClient.cs` (the constructor, and `Set(Interact)`).
13. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/04-transport.md`, sections "What exists" and "Bypassing it".
14. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, "4.1 Transport: WebSocket sidecar, not the CommBus".
15. Documented in our record, read from the aircraft's files: fsc-editor, `docs/aircraft/synaptic-a220.md`, sections "Architecture — the thing to remember", "THE ALTIMETER PROBLEM", and "CommBus channels".
16. Measured on MSFS 2024, 2026-09-28: [CommBus log](../../areas/commbus/log.md#2026-09-28-the-a220-sends-changes-not-snapshots-and-keeps-its-altimeter-setting-on-the-ads-and-ctp-channels), "The A220 sends changes, not snapshots, and keeps its altimeter setting on the ADS and CTP channels".
17. Measured on MSFS 2024 SunRise 12.2.282174.999, 2026-10-08: [interface log](../../areas/interface/log.md#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one), "Every page we use reaches the core by WebSocket and by the CommBus, but the menu's page can't read an `L:` variable, and a flight load resets one", with the output in `experiments/areas/interface/results/p13-sim-links-2026-10-08-13-54-50.txt` and `p14-commbus-pages-2026-10-08-14-05-05.txt`.
18. Measured on MSFS 2024 SunRise 12.2.282174.999, 2026-10-08: [interface log](../../areas/interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel), "A page's WebSocket stays open after the page is gone, and the CommBus reaches every page we use in the menu and every cockpit panel", with the output in `experiments/areas/interface/results/p15-links-coverage-2026-10-08-14-54-27.txt`.
19. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_WindowsTypes.h`, `typedef unsigned long long HANDLE`.
20. Measured on MSFS 2024 SunRise 12.2.282174.999, 2026-10-08: [architecture log](../../areas/architecture/log.md#2026-10-08-a-standalone-module-built-from-rust-with-cargo-msfs-and-packaged-by-our-own-script-runs-on-msfs-2024-and-trades-data-slots-with-a-simconnect-client-once-its-simconnect-handle-is-64-bits-wide), "A standalone module built from Rust with cargo-msfs, and packaged by our own script, runs on MSFS 2024 and trades data slots with a SimConnect client, once its SimConnect handle is 64 bits wide", with the output in `experiments/areas/architecture/results/p03-rust-module-2026-10-08-17-54-02.txt` for the failing call, `-17-59-24.txt` for the handle that fit in 32 bits, and `-18-04-12.txt` for the 64-bit run.

## Unverified claims

- **One `SimConnect_CallDispatch` call is enough in an MSFS 2024 module.**
  FS Copilot's module relies on it, and our only support is a 2021 forum post about MSFS 2020 [2] [5].
  A module that calls it once in `module_init` and counts client data deliveries over a minute of the app writing every 200ms would settle it.
- **A module or a SimConnect client can't read the A220's CommBus channels.**
  Nobody has measured which flags the module's calls set.
  Registering for `A22X.L ADS Data` in a module, and subscribing to it with `SimConnect_SubscribeToCommBusEvent` from a client, and logging what arrives in both while the pilot turns the altimeter knob would settle it.
- **In MSFS 2024, a gauge module gets no `SimStart` or `SimStop`.**
  The report is from MSFS 2020 [8].
  Subscribing to both from a gauge module and from a standalone module through one flight would settle it.
