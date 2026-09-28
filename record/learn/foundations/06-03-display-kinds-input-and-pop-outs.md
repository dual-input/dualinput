# Glass cockpits and Coherent GT: display kinds, input, and pop-outs

- [Display kinds: HTML, React on DOM, React on SVG, canvas, WASM gauges](#display-kinds-html-react-on-dom-react-on-svg-canvas-wasm-gauges)
- [Touchscreens, pointer events, and who owns hover](#touchscreens-pointer-events-and-who-owns-hover)
- [Pop-out windows](#pop-out-windows)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

The engine, the instrument lifecycle, and the Avionics Framework are in [06-01-the-engine-and-instruments](06-01-the-engine-and-instruments.md), the JavaScript APIs, the debugger, and injecting code are in [06-02-apis-debugger-and-injection](06-02-apis-debugger-and-injection.md), and WebSockets to localhost are in [06-04-websockets-to-localhost](06-04-websockets-to-localhost.md).

## Display kinds: HTML, React on DOM, React on SVG, canvas, WASM gauges

A cockpit display draws in one of five ways: with HTML elements, with React rendering HTML elements, with React rendering SVG, on a `<canvas>`, or as a WASM gauge whose image the sim copies into the panel document [1].
In the first four, the display's own code decides what a click hit, inside the panel document.
A WASM gauge leaves that to the sim, and the difference decides what code in a panel can see and drive [1] [2].

**How it works.**
Two ways of syncing a click between machines show the difference.
FS Copilot names the HTML element under a click by its path of tag names and sibling positions, sends the name, and clicks the element with the same name on the other machine [3].
Our FS Copilot fork added a second way, which sends where the click was, as fractions of the instrument's width and height, and replays `mousedown`, `mouseup`, and `click` at that point on the other machine [4].

| Kind | What the document holds | Example | Sync by element name | Sync by position |
| --- | --- | --- | --- | --- |
| HTML | An element per control | The A350's EFB [5] | Works [3] | Not tested |
| React on DOM | Elements a framework creates and reorders | None in our records | Names shift when siblings reorder [3] | Not tested |
| React on SVG | One HTML `div`, with SVG below it | The A220's DisplayUnits [2] | Every click names the `div` [3] | Works [2] |
| Canvas | One `<canvas>` | The A220's MKP, FCP, and ISI, suspected [3] | Nothing to name [3] | Not tested |
| WASM gauge | A live image of the gauge | Every A350 display but the EFB [6] | Presses whatever the receiving pilot's cursor is over [7] | The same [7] [13] |

The A220's DisplayUnits is one document, 7410x1110, with five display units side by side, and only its mount `div` and five empty wrapper `div`s are HTML: everything drawn is SVG [2].
The A350's MFD, seen through the debugger, holds a live image and no element per control [6] [8]:

```text
<wasm-instrument data-input-group="WASM-INSTRUMENT" guid="118"
                 url="coui://…/WasmInstrument.html?wasm_module=inibuilds-A350.wasm&wasm_gauge=MFD">
  <div id="Mainframe">
    <wasm-sim-canvas>
      <img src="WasmGaugeLiveView_25">
```

A page from another process in an `<iframe>` is a sixth case.
The Fenix EFB loads `http://localhost:8083/index.html` in an iframe inside its `coui://` document, and a real click inside the iframe goes to the child document, so a listener in the panel document never hears it [9].

The Avionics Framework's FSComponent renders JSX the way React does ([06-01](06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)), so its displays presumably fall in the HTML and SVG kinds, and none has been tested (unverified).

**What it changes for Crosscheck.**
A Crosscheck aircraft profile needs each display's kind, because the kind decides whether panel code can sync that display at all.
No DOM-level scheme drives a WASM display (measured on the A350), which leaves per-aircraft channels, such as an `L:` variable per softkey, to [part 7](outline.md#7-aircraft-specific-systems-refresher).

**Traps.**

- Syncing a WASM gauge by element name is worse than not syncing it.
  FS Copilot's replay builds a `MouseEvent` with no coordinates, the gauge's shell forwards it as a press, and the press lands on whatever the receiving pilot's cursor is over [7] [10].
  `ignore: WasmInstrument` in an FS Copilot profile turns that off, and PMDG's profile already has it [7].
- A bundle's code doesn't tell you its kind: the A220's DisplayUnits bundle contains `getContext("2d")` 6 times, and draws in SVG [11].
  Inspect the live document instead.
- A display with bezel buttons isn't clicked on the glass: the A220's CTP, MKP, FCP, and ISI are worked through buttons that are model-behavior controls ([02-02](02-02-aircraft.md#model-behaviors)) [12].

## Touchscreens, pointer events, and who owns hover

A panel document receives mouse events, trusted and carrying real coordinates, and no pointer events [2].
On an HTML, SVG, or canvas display the document decides what's under the pointer, so a synthetic `MouseEvent` at a coordinate acts like a click, and on a WASM gauge the sim decides, from the physical mouse, and ignores the coordinates any event carries [7] [13].

**How it works.**
In our records, a cockpit touchscreen is a display the pilot clicks with the mouse, such as the A220's DisplayUnits or an EFB, as opposed to a display worked through bezel buttons [12].
`BaseInstrument`'s `isInteractive` defaults to false, the A220's DisplayUnits overrides it to return true, and its MKP declares false [11] [12].
YourControls calls the same flag `isTouch` [14].
Each instrument reports the flag to the sim in the flow event `ON_VCOCKPIT_INSTRUMENT_INITIALIZED`, and what the sim does with it is unverified [11].

On the A220's DisplayUnits, a probe recorded what one real interaction delivered: `mousedown` 4 times, `mouseup` 6, `mousemove` 754, `click` 4, `mouseover`, `mouseout`, `mouseenter`, `mouseleave`, and keyboard events, and never `pointerdown`, `pointerup`, or `pointermove` [2].
Of the 627 events, 571 were trusted.
The other 56 were `mouseenter` and `mouseleave` at (0,0), which `VCockpit.js` dispatches itself, with no coordinates, from its `OnMouseEnter` and `OnMouseLeave` handlers [2] [11].
`mousemove` keeps arriving while a button is held, so a drag can be captured [15].

Because the document does its own hit-testing, a position is enough.
A synthetic `mousedown`, `mouseup`, and `click` at the coordinates of a real click, (3229,191), landed on an SVG `rect` and opened the FPLN/PERF dropdown [2].

A WASM gauge's shell, the sim's `WasmSimCanvas.js`, forwards nine DOM mouse events, each through a `Coherent.call` such as `WASM_MOUSE_DOWN` with the event's coordinates [8].
On the A350's MFD, the sim acted on each press and discarded its coordinates [7] [13] [16]:

1. With the real cursor parked on the IRS button, a replay sent moves toward another control, waited 400ms, and pressed: the IRS page opened.
2. The same sequence in one JavaScript tick, with no wait, opened IRS again, 120 pixels from where every event said to press.
3. 61 `WASM_MOUSE_MOVE` calls to the display's far corner didn't move the cursor the gauge draws.
4. A press sent while the real cursor was over nothing waited, and fired on the RETURN button when the real cursor next moved onto it.

The sim keeps the hovered control from its own raycast against the physical mouse, and nothing in a document writes it [7].
The path runs through the sim's core `WasmSimCanvas.js`, so every WASM gauge is expected to behave this way, and only the A350 was tested [8].

**What it changes for Crosscheck.**
Each machine has its own cursor, and on a WASM display only the local one can press anything, so Crosscheck can't carry one pilot's press on those displays to the other through panel code.
On the other kinds, `isTrusted` tells a pilot's press from one Crosscheck dispatched, which is a signal [part 8](outline.md#8-synchronization-full) needs to keep a replayed press from being sent back.

**Traps.**

- A handler that listens only for pointer events never runs in the sim, because the engine has no `PointerEvent` [2].
- Only the topmost element at a point can be found: `document.elementsFromPoint` doesn't exist [17].
  An overlay on top makes `document.elementFromPoint` return the overlay, so FS Copilot turns off its overlay's hit-testing for each synchronous lookup [18].
- A press into a WASM gauge can fire seconds after it was sent, on whatever control the receiving pilot touches next [7].
- The `mouseenter` and `mouseleave` events at (0,0) come from the sim's own code, so a recorder that keeps every event keeps them too [2].

## Pop-out windows

Right-Alt and a click on a cockpit display opens it in a window of its own, drawn from the same panel document [19] [20].
On the A220's DisplayUnits, the document kept its size, and the sim scaled its image into the window, keeping its proportions and centering it [20].

**How it works.**
Measured on MSFS 2024 1.8.16.0 with the A220's DisplayUnits popped out [20]:

- The pop-out is a top-level window of class `AceApp` titled `DISPLAYUNITS`, the instrument's identifier in capitals.
  The sim's main window is also of class `AceApp`, titled `Microsoft Flight Simulator 2024 - 1.8.16.0`.
- Inside it, the document still measured 7410x1110.
- The window's client area was 7394x1071, so the image filled the height at scale 0.965, was 7149.6 pixels wide, and left bars of 122 pixels on either side.
- Five markers placed at known fractions of the instrument landed where that rule predicts, within 6.3 pixels of the pop-out; the residual is the sim's horizontal scale running 0.15% under its vertical one.
- The window extended past the edge of the monitor, and `PrintWindow` with `PW_RENDERFULLCONTENT` still captured all of it, in 62.6ms median for the pop-out and 33.5ms for the 2401x1360 main window.

The inspector can't take a screenshot ([06-02](06-02-apis-debugger-and-injection.md#the-coherent-debugger-on-port-19999)), so a picture of a display comes from capturing its window.
The sim has no command that pops a display out, and nothing reports where a panel is on screen, so the fsc-exerciser pops one out by sending Right-Alt and a click into the sim's window [21].

**What it changes for Crosscheck.**
A pop-out changes how one pilot views a display, and on the one display we measured it left the document's size alone.
So a position given as a fraction of the instrument means the same thing whether or not either pilot has popped the display out.
Whether popping out reloads the document, which would put the display back in its default state ([06-01](06-01-the-engine-and-instruments.md#vcockpit-baseinstrument-and-panelcfg-gauges)), is unverified.

**Traps.**

- The title carries the identifier and no query, so two instruments that share an identifier, such as the A220's two CTPs, would open windows with the same title; only DisplayUnits was checked [19].
- The pop-out's initial size has the wrong proportions for finding the instrument in it: 6.90 to 1, against the instrument's 6.68 to 1, and the pilot can resize it [19].
- Whether a click inside a pop-out reaches the document as the same trusted events as a click in the cockpit is unmeasured.

## Sources

1. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/03-scope.md`, sections "The taxonomy" and "Same-document surfaces".
2. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - Q03 PASSES: a synthetic mouse click drives a React/SVG display".
3. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/01-problem.md`, sections "What it does today" and "The four failure mechanisms".
4. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, sections "0.1 In one paragraph" and "2.2 The path of one press".
5. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/06-open-questions.md`, "Q06 · Can a `coui://` page reach into a cross-origin iframe?".
6. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 — The A350's WASM displays are not in an iframe".
7. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 — A WASM gauge presses whatever the REAL cursor hovers, ignoring the coordinates we send".
8. Documented in our record, read from the sim's `WasmSimCanvas.js` through the inspector: FS Copilot fork, `record/pointer-forwarding/docs/07-wasm-surface.md`, sections "What a WASM display is made of", "The input channel", and "Is this iniBuilds-specific?".
9. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 — The Fenix EFB is a cross-origin iframe, and capture never happens".
10. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 — WASM gauges take DOM mouse events, and FS Copilot has been sending them to (0,0)", whose transport finding stands and whose conclusion [7] supersedes.
11. Documented, read from JavaScript captured out of the running sim: FS Copilot profiles at d3d7689, `sim-sources/vcockpit02-displayunits/`, captured from MSFS 2024 on 2026-08-30: `html_UI_Pages_VCockpit_Instruments_Shared_BaseInstrument.js`, `html_UI_Pages_VCockpit_Core_VCockpit.js`, and the A220's `html_ui_pages_vcockpit_instruments_a22x_displayunits_instrument.index.js` and `html_ui_pages_vcockpit_instruments_a22x_displayunits_instrument.js`.
12. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - A220 panel identifiers collide, and MKP is not interactive".
13. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 — Same-tick injection loses too: the sim owns hover absolutely".
14. Documented, read from source: [YourControls](https://github.com/YourControls/yourcontrols) at commit 31b1706, `scripts/build-include/2024/YourControls/html_ui/YourControls/Main.js` and `html_ui/Pages/VCockpit/Core/VCockpit.js`.
15. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - Drag works. Tier 3 is real, with a drift caveat".
16. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 — The cursor cannot be synced either: no position variable, and the screen var is an output".
17. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/results/p08-environment-vcockpit02-displayunits-2026-08-30-11-48-57.txt`.
18. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, section "4.8 Blocking with an overlay div, not by suppressing events".
19. Documented in our record: FS Copilot fork, `record/exerciser/docs/01-design.md`, sections "Pop-out" and "Mapping".
20. Measured on MSFS 2024 1.8.16.0, 2026-09-17: FS Copilot fork, `record/exerciser/docs/log.md`, "2026-09-17 — A pop-out capture maps to rect fractions by contain-fit, within 6.5 px", with the numbers in `record/exerciser/results/p02-popout-mapping-2026-09-17.txt`.
21. Documented: fsc-exerciser at 2e4783a, `README.md`, "Limitations", and `src/MainWindow.axaml.cs`, `FirePopOut`.

## Unverified claims

- **Every WASM gauge ignores the coordinates of an injected press.**
  Only the A350 was tested, and the argument that the rest behave the same is that the path is a core sim file [8].
  Repeating the parked-cursor test on a PMDG 777 display would settle it for a second vendor.
- **Synthetic clicks drive canvas, React on DOM, and plain HTML displays.**
  Only React on SVG was tested [2].
  A replayed click on a confirmed canvas display and on an HTML one, with the result watched in the cockpit, would settle it; confirming that the A220's MKP, FCP, and ISI are canvas comes first [3].
- **Avionics Framework displays fall in the HTML and SVG kinds.**
  Inspecting a G1000 NXi document through the debugger would settle it.
- **What the sim does with `isInteractive`.**
  Clicking an instrument that reports false, with a probe logging the mouse events its document receives, would settle whether the sim still delivers them.
- **Whether a pop-out reloads its document, and whether clicks in it arrive as trusted events.**
  Watching the document's page ID through the inspector while popping a display out, then logging events while clicking in the pop-out, would settle both.
