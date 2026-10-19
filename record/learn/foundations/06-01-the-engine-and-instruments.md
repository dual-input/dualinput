# Glass cockpits and Coherent GT: the engine and its instruments

- [Coherent GT: the Chrome 49 engine and its limits](#coherent-gt-the-chrome-49-engine-and-its-limits)
- [VCockpit, `BaseInstrument`, and `panel.cfg` gauges](#vcockpit-baseinstrument-and-panelcfg-gauges)
- [The MSFS Avionics Framework and Working Title avionics](#the-msfs-avionics-framework-and-working-title-avionics)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

The JavaScript APIs, the debugger, and injecting code are in [06-02-apis-debugger-and-injection](06-02-apis-debugger-and-injection.md), display kinds, input, and pop-outs are in [06-03-display-kinds-input-and-pop-outs](06-03-display-kinds-input-and-pop-outs.md), and WebSockets to localhost are in [06-04-websockets-to-localhost](06-04-websockets-to-localhost.md).

A glass cockpit display in MSFS 2024 is a web page that the sim draws onto one screen in the cockpit, and this part is about those pages and the code that runs in them.

## Coherent GT: the Chrome 49 engine and its limits

MSFS 2024 draws every HTML cockpit display with Coherent GT, a WebKit-based engine from Coherent Labs whose user agent says Chrome 49 [1] [2].
Its JavaScript parses ES2017 and object rest, and no other syntax from ES2018 on, such as object spread, `?.`, and `??` [1] [26].
A file that uses any of that syntax fails to parse, and none of the file runs.

**How it works.**
Our probe read this user agent in an A220 panel document on 2026-08-30 [1]:

```text
Mozilla/5.0 (Windows NT 6.2; Win64; x64) AppleWebKit/604.1.38 (KHTML, like Gecko) Chrome/49.0.2623 Safari/604.1.38 CoherentGT/2.0
```

Our records call the engine Chrome 49 after this string, but the engine isn't Chrome.
Coherent Labs writes that Coherent GT "is based on WebKit" [2], the same probe read `navigator.vendor` as `Apple Computer, Inc.` [1], and the debugger speaks WebKit's inspector protocol [3].
Its features match no release of Chrome or Safari [1] [4]:

| Feature | In Coherent GT | First in Chrome | First in Safari |
| --- | --- | --- | --- |
| `async` functions | Yes | 55 | 10.1 |
| `WeakRef` | Yes | 84 | 14.1 |
| `Object.fromEntries` | No | 73 | 12.1 |
| Optional chaining, `?.` | No | 80 | 13.1 |
| `PointerEvent` | No | 55 | 13 |

So the version in the string predicts nothing, and the measured list is the rule.
What's missing fails in two ways [1] [5]:

| Missing | How it fails |
| --- | --- |
| Syntax: `?.`, `??`, `\|\|=`, `&&=`, `??=`, class fields and `#private` members, numeric separators such as `1_000` | The file doesn't parse, and not one line of it runs |
| Built-ins: `Object.fromEntries`, `Array.prototype.at`, `String.prototype.replaceAll`, `Promise.allSettled`, `BigInt`, `Intl` | The call throws when it runs |
| Web APIs: `PointerEvent`, `ResizeObserver`, `IntersectionObserver`, `AbortController`, `Worker`, `BroadcastChannel`, `queueMicrotask`, `indexedDB` | The same |

A syntax error takes out the whole file because the engine parses a script completely before running any of it.
The FS Copilot fork nearly shipped one.
An eighth `Include.addImports(` in its `VCockpit.js` got seven closing parentheses, and `node --check` reported "missing ) after argument list" before any sim loaded the file [6].
Reading the file, the error would have stopped every instrument in every panel from loading, because the file defines the panel element and the `registerInstrument` function that every instrument's script calls ([the next section](#vcockpit-baseinstrument-and-panelcfg-gauges)) [6] [7].

`node --check` catches a file that no engine can parse, and it passes `?.`, because Node accepts it.
Vendors avoid the newer syntax by compiling to an older target.
The A220's DisplayUnits bundle has `??` spelled out the long way, as in `(h = this._notifyDepthMap.get(e)) !== null && h !== void 0 ? h : 0` [7].

Two more limits apply to anything drawn on a display [8].
The sim renders cockpit screens as emissive surfaces with bloom, so bright strokes glow and fatten, and dark muted shades survive.
CSS gradients run at reduced precision: a `repeating-linear-gradient` with a period of a few pixels, across the 7410-pixel-wide DisplayUnits document, smeared into wide bands, and a small gradient tile repeated with `background-size` drew correctly.

**What it changes for Dual Input.**
Every file Dual Input puts in a panel must parse in this engine, and a Node syntax check doesn't prove that it does.
Rejecting the syntax Coherent GT lacks falls to Dual Input's build, and which ECMAScript version a parser should be set to for that is unverified, because the engine matches no version exactly.

**Traps.**

- A class declared at the top level isn't a property of `window`, so `window.BaseInstrument` is undefined in a document where the class works; test with `typeof BaseInstrument` [5].
  Our own probe fell for it and reported `BaseInstrument` missing [1].
- `TouchEvent` exists as a constructor and `navigator.maxTouchPoints` doesn't, so feature detection finds half a touch model [1].
- The list was measured once, on 2026-08-30, in one A220 document, and a sim update can change it; our record says to re-run the probe after each update [5].

## VCockpit, `BaseInstrument`, and `panel.cfg` gauges

Each `[VCockpitNN]` section of an aircraft's `panel.cfg` becomes one web page, a panel document, which loads that section's gauges one after another as custom elements that extend `BaseInstrument` [7] [9].
Each instrument runs its own frame loop, which calls `Init` once the sim is ready and `Update` every frame after that, and a document reloads itself when the sim sends it its panel data a second time [7].

**How it works.**
The A220's `panel.cfg` has 14 sections [10].
This one puts all five of its display units on one screen:

```text
[VCockpit02]
size_mm = 1208, 412
pixel_size = 7410, 1110
texture = $A22X_DU

htmlgauge00 = a22x/DisplayUnits/instrument.html?config=[config], 0, 0, 1208, 412
```

`texture` names the screen in the 3D model that the document is drawn on, and `htmlgauge00` names the gauge's HTML file, its query, and its place on the panel [9] [10].
All 14 of the A220's documents are the same page, `coui://html_UI/Pages/VCockpit/Core/VCockpit.html`, whose `VCockpit.js` loads the gauges [11].
The sim's `VCockpit.js` and `BaseInstrument.js`, captured from MSFS 2024, load one like this [7]:

```text
sim             Coherent event "ShowVCockpitPanel": the section's name, its sizes, and one entry per gauge
VCockpit.js     load(): document.title = "VCockpit02"; import the gauge's HTML file
gauge script    registerInstrument("a22x-displayunits", a class extending BaseInstrument)
VCockpit.js     1s later: customElements.define(); createInstrument(): set the element's Guid and
                Url attributes, place and size it scaled by vDisplaySize / vLogicalSize, append it,
                add " - DisplayUnits" to the title, then load the next gauge
BaseInstrument  connectedCallback(): unless at the main menu, start a requestAnimationFrame loop;
                wait until all instruments are loaded and SimVar.IsReady(); Init() once; Update() each frame
```

The A220's own instrument class is 33 lines.
It loads a 4MB bundle that draws the display, dispatches a DOM `update` event from `Update`, and turns each `H:` event that reaches `onInteractionEvent` into a DOM event [7].

An instrument's `instrumentIdentifier` is its class's `templateID`, with `_<n>` added when the gauge's query holds `index=<n>`, and the document's title becomes `VCockpitNN - <instrumentIdentifier>` [7].
So the A220's EFBs, loaded with `?Index=1` and `?Index=2`, report `efbA220_1` and `efbA220_2`, while its CTPs, loaded with `?side=left` and `?side=right`, both report `CTP`, and all four FCPs report `FCP` [10] [12].
The sim fills in placeholders in the query: on livery N324DU, the DisplayUnits query read `config=N324DU` [13].

Each A220 instrument with a size in `panel.cfg` measured exactly its section's `pixel_size`: 7410x1110, 1608x186, 460x102, 260x260, 250x250, and 2048x1476 [10] [14].
The two sections with `pixel_size = 0, 0`, a WASM systems gauge and a headless gauge named `Sentry`, measured 10x10 [14].

Three things stop or restart an instrument, all read from the sim's code [7]:

| Trigger | What happens |
| --- | --- |
| The `quality` attribute the sim sets on the document | At `hidden` or `disabled`, the panel element is hidden; at `disabled`, `Update` stops |
| The game state | At the main menu the frame loop ends; going from loading into the briefing or the flight calls `reboot()`, and going from the briefing into the flight calls `onFlightStart()` |
| `ShowVCockpitPanel` arriving at a panel that already has data | `window.location.reload()`: a fresh document, with every script, global, and instrument started again |

When the sim changes `quality`, and when it sends panel data a second time, isn't in our records.
Our FS Copilot review names view changes, pop-outs, and cockpit reinitialization as causes of reloads, without a measurement [15].
It also points out that a reloaded display comes back in its default state, on its first page, whatever the pilot had open [15].

Code that runs when an instrument is created runs before the instrument is laid out.
FS Copilot's hook, built in `createInstrument`, found no size for 9 of the A220's 14 instruments, and measuring again once a second found a size for all 14 [14].
Whether MSFS 2024 also delays loading a document until the pilot looks at its screen is unverified.

Documents share no JavaScript: each has its own globals, and the engine has no `Worker` or `BroadcastChannel` to pass objects between them [1].
Two projects elect one document through an `L:` variable instead.
Each FS Copilot hook writes a random number to `L:FSC_HOOK`, and only the hook whose number is still there when an `H:` event arrives reports the event [16]; YourControls does the same with `L:YourControlsPanelId` [17].

**What it changes for Dual Input.**
Code Dual Input puts in panels runs once per document, 14 times on the A220, starts before its instrument has a size, and dies with its document on a reload.
Naming one instrument the same way on both machines takes its identifier and its query, and the query can carry the livery.

**Traps.**

- A document's title isn't unique either: it's built from the identifier, so the two A220 CTP documents share one [7] [12].
- `BaseInstrument.isInteractive` defaults to false, and FS Copilot's element-name sync skips every instrument that doesn't override it, such as the A220's MKP [7] [12].
- A section can hold several gauges in one document: a document listed as `VCockpit02 - WasmInstrument - WasmInstrument` holds two [3].
  [06-02](06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open) shows how that broke FS Copilot's loader.

## The MSFS Avionics Framework and Working Title avionics

The MSFS Avionics Framework is a TypeScript and JSX library, published by Microsoft, Asobo Studio, and Working Title Simulations, for building glass cockpits from components that exchange data over an event bus [18].
The SDK says many of the aircraft that come with MSFS 2024 use glass cockpits built on it, and leaves its documentation to the framework's own site [19].

**How it works.**
The framework has two halves [18] [20]:

- **FSComponent** draws.
  Its documentation calls it "heavily based on the React API", and says "All FSComponent components are class based" and "Components do not re-render on props changes" [18].
- **The EventBus** carries data.
  Code publishes a value on a named topic, every subscriber to that topic receives it, and the documentation recommends one bus per instrument [20].

The bus lets an instrument read the sim once and fan the value out.
A `SimVarPublisher` reads a set of simulation variables and publishes them, which the documentation recommends over calling `SimVar.GetSimVarValue()` from every component, because each call has a cost [21].
`H:` events arrive the same way: an instrument's `onInteractionEvent` passes them to an `HEventPublisher`, which publishes each one on the `hEvent` topic [22].

A topic published with the `sync` flag also reaches the other instruments.
The framework's code, compiled into the A220's DisplayUnits bundle from `@microsoft/msfs-sdk`, does this [7]:

```text
publisher     bus.pub(topic, data, sync = true)
              → queued, and sent once a frame as JSON through the sim's generic data listener,
                under the key "wt.eb.evt"
other buses   each instrument's bus listening on "wt.eb.evt" publishes the topic locally,
              skipping packages that came from its own bus
a new bus     publishes "resync_request", and every other bus re-sends the synced topics it cached
```

The documentation says separate buses don't share topics on their own [20], and this sync is the exception.

The same site, whose publishers include Working Title, documents its own avionics packages: the G1000 NXi, G3000 and G5000, GNS 430W and 530W, G3X Touch, WT21, Epic 2, UNS-1Lw, and IFD [18] [23].
A third-party aircraft can use part of the framework.
The A220's DisplayUnits bundle carries the framework's EventBus and publishers, and draws with React (`react-dom` and `createRoot`) into SVG [7] [24].
Its six instrument bundles draw and hold no aircraft state: the aircraft's systems module holds it and publishes it on the CommBus ([05-02](05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm)) [25].

**What it changes for Dual Input.**
In framework avionics, state such as a display page or a map range can live only in JavaScript objects and bus topics inside the instruments, where SimConnect can't reach it (unverified for any particular aircraft).
Synced topics cross between documents on a sim channel with a known key, and code of ours can listen on it: a listener in the EFB's document heard all five of a G3000's buses under `wt.eb.evt`, and a package it sent moved the MFD's map (measured on MSFS 2024, 2026-10-06, [CommBus log](../../areas/commbus/log.md#2026-10-06-our-own-code-hears-wtebevt-from-the-efbs-document-and-the-g3000-acts-on-a-package-it-sends)).

**Traps.**

- A variable name in a framework bundle doesn't mean the aircraft uses it.
  `KOHLSMAN SETTING MB` appears in all six A220 bundles, only inside the framework's stock `AdcPublisher` table, and the aircraft's systems module never reads it [25].
- The framework's documentation says `H:` events can come from "SimConnect add-ons" [22], and [03-03](03-03-reading-and-writing.md#which-namespace-can-be-read-written-or-listed-from-where) found no SimConnect call that sends one.
  Which is right is unverified.
- The framework documents MSFS 2020 under `/docs/` and MSFS 2024 under `/2024/docs/`, and the pages cited here are the 2024 ones [18].

## Sources

1. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/results/p08-environment-vcockpit02-displayunits-2026-08-30-11-48-57.txt`, the output of `probes/p08-environment.js` in the A220's DisplayUnits document.
2. Documented: Coherent Labs, [How to mock and test game UI made with Coherent GT in Google Chrome](https://coherent-labs.com/posts/how-to-mock-and-test-game-ui-made-with-coherent-gt-in-google-chrome/).
3. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 — Q00 is yes: the sim hosts a WebKit inspector and it evaluates anything".
4. Documented: MDN browser compatibility data, `@mdn/browser-compat-data` 8.1.3 of 2026-09-24, the entries for async functions, `WeakRef`, `Object.fromEntries`, optional chaining, and `PointerEvent`.
5. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/09-environment.md`, sections "What injected code may use", "Web APIs", and "MSFS globals".
6. Measured with `node --check`, not in the sim, on 2026-09-02: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-02 - The branch's VCockpit.js was unparseable; caught before any panel loaded it".
7. Documented, read from JavaScript captured out of the running sim: FS Copilot profiles at d3d7689, `sim-sources/vcockpit02-displayunits/`, captured from MSFS 2024 on 2026-08-30: `html_UI_Pages_VCockpit_Core_VCockpit.js`, which is FS Copilot's copy, the stock file plus its own marked blocks; `html_UI_Pages_VCockpit_Instruments_Shared_BaseInstrument.js`; the A220's `html_ui_pages_vcockpit_instruments_a22x_displayunits_instrument.index.js`; and its bundle, `html_ui_pages_vcockpit_instruments_a22x_displayunits_instrument.js`, including the EventBus under `node_modules/@microsoft/msfs-sdk/msfssdk.js`.
8. Measured on MSFS 2024, 2026-09-01: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-01 - Single-machine cockpit validation: the production pipeline works", the two rendering lessons.
9. Documented: MSFS 2024 SDK, [panel.cfg](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/CFG_Files/panel_cfg.htm), the `[VCockpitNN]` parameters and the `htmlgaugeNN` format.
10. Documented, read from the installed package: Synaptic A220 (`synaptic-aircraft-a220` 1.0.10) in the Community folder of our development machine, 2026-09-27, `SimObjects/Airplanes/Synaptic_A220/attachments/inibuilds/Part_Interior_A223_Cockpit/panel/panel.cfg`.
11. Measured on MSFS 2024, 2026-09-08: FS Copilot fork, `record/pointer-forwarding/results/session-2026-09-08-app.txt`, the `PanelServer` hello lines, each with the document's address.
12. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - A220 panel identifiers collide, and MKP is not interactive".
13. Measured on MSFS 2024, 2026-09-17: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-17 — The A220's DisplayUnits key carries the livery, and the profile names only Default".
14. Measured on MSFS 2024, 2026-09-17: FS Copilot fork, `record/exerciser/docs/log.md`, "2026-09-17 — FSC sends panel rects to a watcher, and most cockpit hellos have none" and "2026-09-17 — Measuring until there is a size to send: 14 of 14 panels report their rect", with the sizes in `record/exerciser/results/p03-panel-watch-after-fix-2026-09-17.txt`.
15. Documented in our record, as reasoning without a measurement: FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, "R09 · Pending events flush into a panel that is not ready".
16. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/hook.js`.
17. Documented, read from source: [YourControls](https://github.com/YourControls/yourcontrols) at commit 31b1706, `scripts/build-include/2024/YourControls/html_ui/YourControls/Main.js`.
18. Documented: MSFS Avionics Framework, [MSFS Avionics Framework](https://microsoft.github.io/msfs-avionics-mirror/2024/docs/intro/), the MSFS 2024 introduction and its copyright line.
19. Documented: MSFS 2024 SDK, [Instruments](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/Modular_SimObjects/Aircraft/Instruments/Instruments.htm), the section on the MSFS Avionics Framework.
20. Documented: MSFS Avionics Framework, [Using the Event Bus](https://microsoft.github.io/msfs-avionics-mirror/2024/docs/getting-started/using-the-event-bus/).
21. Documented: MSFS Avionics Framework, [SimVars](https://microsoft.github.io/msfs-avionics-mirror/2024/docs/interacting-with-msfs/simvars/).
22. Documented: MSFS Avionics Framework, [Receiving H Events](https://microsoft.github.io/msfs-avionics-mirror/2024/docs/interacting-with-msfs/receiving-h-events/).
23. Documented: MSFS Avionics Framework, [Avionics Development](https://microsoft.github.io/msfs-avionics-mirror/2024/docs/avionics/).
24. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - Q03 PASSES: a synthetic mouse click drives a React/SVG display", the geometry paragraph.
25. Documented in our record, read from the aircraft's files: fsc-editor, `docs/aircraft/synaptic-a220.md`, sections "Package layout", "Architecture — the thing to remember", and "THE ALTIMETER PROBLEM".
26. Measured on MSFS 2024, 2026-10-09: [architecture log](../../areas/architecture/log.md#2026-10-09-coherent-gt-parses-all-of-es2017-and-object-rest-but-no-other-syntax-from-es2018-on-has-no-built-in-from-es2018-on-of-its-own-but-weakref-and-runs-typescript-compiled-to-es2017-by-tsc-and-by-esbuild), five documents through the inspector; the full list is in [Coherent GT's JavaScript](../../areas/architecture/coherent-gt.md).

## Unverified claims

- **When the sim changes an instrument's `quality`, and when it reloads a document.**
  The code shows what each does [7], and our only list of reload causes is reasoning [15].
  Watching `document.body`'s `quality` attribute and each document's page ID through the inspector, while changing views, popping out a display, and changing aircraft, would settle both.
- **Whether MSFS 2024 delays loading a panel document until its screen is in view.**
  Listing the inspector's pages right after a flight loads, before looking around the cockpit, and again afterward, would settle it.
- **Whether a SimConnect client can send an `H:` event.**
  The framework's documentation says so [22], and [03-03](03-03-reading-and-writing.md#which-namespace-can-be-read-written-or-listed-from-where) found no call for it.
  Mapping an `H:` name with `SimConnect_MapClientEventToSimEvent`, transmitting it, and logging `onInteractionEvent` in a panel would settle it.
