# CommBus: log

What our experiments found about reading an aircraft's CommBus traffic from panel JavaScript, newest entry first.
Reading it works, and how much it yields depends on the aircraft: the Synaptic A220 puts its whole cockpit's state on the CommBus, the A2A PA-24 doesn't use the CommBus at all, and the iniBuilds A350 uses it only for traffic between its two modules and its EFB and printer.
The probes are in [experiments/areas/commbus](../../../experiments/areas/commbus), and their raw output is in [experiments/areas/commbus/results](../../../experiments/areas/commbus/results).
The entries of 2026-09-28 were measured on MSFS 2024 that day, with FS Copilot's bridge installed, which is why every panel also registered `FSC_CLIENT_EVENT`.

## 2026-09-30: The PA-24 keeps some of its state in stock `A:` variables

**Asked:** does the claim of [the PA-24 entry](#2026-09-28-the-a2a-pa-24-doesnt-use-the-commbus) that "A2A keeps the PA-24's state in `L:` variables" hold against the aircraft's files?

**Expected:** yes, since the modules import the variable API and no CommBus call.

**Found:** it holds for most of the cockpit and misses one place, by the model and panel XML of `a2a-aircraft-pa24` 2.1.3.

- The radio stack's frequencies, the OBS, the transponder code, the altimeter setting, the avionics master, and the fuel pump switch are stock `A:` variables.
  The avionics master's switch sends `K:TOGGLE_AVIONICS_MASTER` and draws itself from `A:AVIONICS MASTER SWITCH:1`, and the altimeter knob sends `K:KOHLSMAN_INC` and `K:KOHLSMAN_DEC` and draws from `A:KOHLSMAN SETTING MB` (read in a2a-aircraft-pa24 2.1.3, `common\model\PA24_250_INTERIOR.xml`).



**Changed:** the entry's finding stands: the PA-24 doesn't use the CommBus.
Reading its state takes these stock `A:` variables as well as its `L:` variables.

**Affects:** the PA-24 entry below, whose text stays as it was.

**Evidence:** the [PA-24 study](../aircraft/a2a-pa24-comanche/study.md#state), sections "State" and "Hidden state".

## 2026-09-30: Two claims of the A350 entry don't hold against the aircraft's files

**Asked:** do the claims of [the A350 entry](#2026-09-28-the-a350s-commbus-carries-efb-traffic-and-its-cockpit-state-stays-inside-one-module) hold against the aircraft's files?

**Expected:** yes, since they came from the sim and from strings in the module.

**Found:** two don't, by the entry's own results file and by the files of `inibuilds-aircraft-a350` 1.2.6.

- "15 of its 18 panels are `WasmInstrument` gauges" is wrong: 14 panels hold 15 `WasmInstrument` gauges.
  The results file lists 14 `WasmInstrument` panels, one of them with two gauges, and the package's `panel.cfg` puts the systems gauge and Navigraph's `navigation_data_interface` on one panel.
  The other four panels are the two EFBs and two flight attendant panels (FAPs).


- The module doesn't draw every display, and the EFB isn't the only JavaScript on the CommBus.
  The FAP and the printer are JavaScript too, and the printer's page listens for `PRINTCALLBACK` (read in `A350_Printer.js`).
  The probe missed the printer because it listed only `VCockpit` panels, and the printer is a `VPainting` page.

Of the names the entry found among the module's strings, the EFB's JavaScript sends `ManualFailureToggleCommand` and `NavigraphUpdateRequested` (read in `ini-efb-a350.js`).

**Changed:** the entry's conclusion stands: the module keeps the cockpit's state to itself, and the JavaScript on the CommBus is the EFBs' and the printer's.


**Affects:** the A350 entry below, whose text stays as it was, and [06-03](../../learn/foundations/06-03-display-kinds-input-and-pop-outs.md#display-kinds-html-react-on-dom-react-on-svg-canvas-wasm-gauges), whose table put every A350 display but the EFB in the WASM gauge kind and is corrected in place.

**Evidence:** [a350-check-2026-09-28.txt](../../../experiments/areas/commbus/results/a350-check-2026-09-28.txt) for the panels, and the [A350 study](../aircraft/inibuilds-a350/study.md#prior-records), whose [commbus.tsv](../aircraft/inibuilds-a350/inventory/commbus.tsv) lists each CommBus name with its listener and sender.

## 2026-09-28: The A350's CommBus carries EFB traffic, and its cockpit state stays inside one module

**Asked:** does the iniBuilds A350 put its cockpit state on the CommBus, as the A220 does?

**Expected:** yes, because iniBuilds co-published the A220.

**Found:** no.
15 of its 18 panels are `WasmInstrument` gauges, and their JavaScript registers no CommBus name of the aircraft's own.
Only the two EFB panels, `iniEfbA350`, use the CommBus from JavaScript, with 20 and 21 names, all about the EFB:

- flight setup: `updateDepartureICAO`, `updateArrivalRunway`
- performance: `QuickPerfRequest`, `ToDataRequest`
- company messages: `AOCMessage`, `AOCClear`
- Navigraph: `RequestNavigraphAccessToken`, `NAVIGRAPH_FunctionResult`, `NAVIGRAPH_Event`
- failures: `FailureResetByEnum`

The aircraft has two modules, and both import `fsCommBusCall` and `fsCommBusRegister`.
`inibuilds-A350.wasm`, at 68,952,481 bytes, runs the systems and draws every display, so its cockpit state never has to cross a bus.
`msfs_navigation_data_interface.wasm` is Navigraph's navigation-data module.

The strings beside the EFB's names in `inibuilds-A350.wasm` include names no panel registered: `UpdateFMGS1_1`, `UpdateFMGS1_9_15`, `UpdateFMGS1_26` to `UpdateFMGS1_28`, `ManualFailureToggleCommand`, `OISOptionSet`, `NavigraphUpdateRequested`, and `cpdlc`.
From what's around them, they're likely messages the EFB sends into the module, such as flight-plan and performance data for the FMS, which a listener can't see (unverified: read from strings, not from traffic).
Nothing near them suggests the module broadcasts cockpit state.

We didn't record the EFB's traffic, because its Navigraph channels can carry an access token.

**Changed:** an aircraft that draws its displays in WASM keeps its cockpit state inside the module, where the CommBus doesn't reach it.
On such an aircraft the CommBus carries what crosses between the module and the EFB, which could matter for syncing EFB actions, such as sending takeoff data to the FMS.
Seeing those messages needs a wrapper on the EFB's sending path, since a listener hears only what the module sends.

**Affects:** nothing yet.

**Evidence:** [a350-check-2026-09-28.txt](../../../experiments/areas/commbus/results/a350-check-2026-09-28.txt).

## 2026-09-28: The A2A PA-24 doesn't use the CommBus

**Asked:** does an aircraft from another developer keep state on the CommBus too, or is the A220 a special case?

**Expected:** nothing in particular; we picked the PA-24 because it's unlike the A220 and from another developer.

**Found:** none.
No panel's JavaScript registered a CommBus name of the PA-24's own: the only name in all 16 panels was `FSC_CLIENT_EVENT`.
None of its five modules (`Accusim.wasm`, `Accusim2.wasm`, `ModelCode1.wasm`, `ModelCode2.wasm`, and `PA24_Avionics.wasm`) imports `fsCommBusCall` or `fsCommBusRegister`, and none of the SimConnect calls they import is a CommBus call.
They import the variable API (`fsVarsNamedVarGet`, `fsVarsNamedVarSet`, and `register_named_variable`), SimConnect, and key events instead, so A2A keeps the PA-24's state in `L:` variables.
The same search finds `fsCommBusCall`, `fsCommBusRegister`, and `fsCommBusUnregisterAll` in the A220's `systems.wasm`, so it can tell a module that uses the CommBus from one that doesn't.
A module's imports are fixed names in the file, so no module can call the CommBus without that string appearing in it.

**Changed:** the CommBus is a source for some aircraft and not others, so a profile has to say whether its aircraft uses it.
It pays off for aircraft built like the A220, where a module owns the state and JavaScript draws it.

**Affects:** nothing yet.

**Evidence:** [pa24-check-2026-09-28.txt](../../../experiments/areas/commbus/results/pa24-check-2026-09-28.txt).
The sim shut down while that file was being written, so its panel listing is copied from the first read, made minutes earlier, as the file says.

## 2026-09-28: `A22X.Resync` returns the A220's full state, and one listener hears every channel

**Asked:** can a listener that attaches late get the state that hasn't changed since it attached?

**Expected:** no, because the CommBus keeps no earlier messages, and the A220 sends only changes (the entry below).

**Found:** yes, by asking the aircraft.
The A220's JavaScript sends `A22X.Resync` to its systems module, through `COMM_BUS_WASM_CALLBACK`, at three times: once when DisplayUnits loads, when a change doesn't apply cleanly to its copy of a channel, and when a channel has been quiet for 3s.
It sends it no more than once a second.
We read this in the A220's `html_ui/Pages/VCockpit/Instruments/a22x/DisplayUnits/instrument.js`, in the part built from `src/avionics/lib/afdx/index.ts`.
The `{}` that most channels send about once a second keeps that 3s timer from firing.

We sent `A22X.Resync` ourselves, with `callWasm` on a listener of our own.
About 100ms later, each of the 29 channels that send changes sent a full snapshot, 1,674 fields in all: 463 on `A22X.Electrical Data`, 370 on `A220.Flight Plan Update`, 42 on each `PFD Data`, and 11 on `A22X.FCP Data`, for example.
Reloading DisplayUnits produced the same snapshots 2.3s after the reload, which fits the call it makes when it loads, and it registered its 42 names again.

A listener in the Sentry panel listened for the 43 names that only other panels had registered, and received all 39 of them that sent anything during the run.
A second listener in a CTP panel counted the same messages on the names both listened to, to within one on a channel that sends 30 messages a second.
So a panel receives any CommBus name a listener in it registers, and Crosscheck needs one listener in one panel.

**Changed:** on the A220, a late listener can get the full state within about 100ms, whenever it asks.
The call that asks is Synaptic's, so each aircraft that works this way needs its own in the profile.

**Affects:** [05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm), whose "a listener that registers late has missed what came before" holds for the CommBus but not for the A220.

**Evidence:** [p03-resync-and-reload-2026-09-28-18-32-49.txt](../../../experiments/areas/commbus/results/p03-resync-and-reload-2026-09-28-18-32-49.txt) and the `.ndjson` beside it, which holds every message.

## 2026-09-28: The A220 sends changes, not snapshots, and keeps its altimeter setting on the ADS and CTP channels

**Asked:** what state reaches panel JavaScript over the A220's CommBus, and does its selected altimeter setting?

**Expected:** a snapshot of each channel in each message, and the setting as `qnh_hpa` on `A22X.L PFD Data`, as the fsc-editor A220 notes say (fsc-editor, `docs/aircraft/synaptic-a220.md`, "Where the QNH actually lives").

**Found:** most channels send only what changed since their last message, and `{}` when nothing did.
Seven send a small, full snapshot about 30 times a second instead: `A22X DU1 Data` to `A22X DU5 Data`, `A22X.L CTP State`, and `A22X.R CTP State`.
Parked with the engines running, the aircraft sent about 285 messages a second.

Turning the baro knob changed `qnh_hpa`, `qnh_inhg`, and `altitude` on `A22X.L ADS Data` and `A22X.R ADS Data`, and `qnh.value` on `A22X.L CTP Data` and `A22X.R CTP Data`.
Both sides moved together because the A220's settings had the altimeters synced.
`A22X.L PFD Data` has no altimeter fields: its full snapshot in the next entry has 42 fields, and none of them is `qnh_hpa`, `qnh_inhg`, or `same_source`.
Those fields are on the ADS channels, so the notes attached the ADS channel's fields to the PFD channel.
The standby instrument keeps its own setting, as `qnh_hpa` on `A22X.ISI Data`, and read 1013 while the main altimeters read 1019.

The display-unit channels are named with a space, `A22X DU1 Data`, where the notes write `A22X.DU<n> Data`.
Several names aren't in the notes at all, such as `A220.Sim Paused`, `A22X.L CTP State`, and `A220.Sentry Heartbeat`.

In 101s of the pilot working the cockpit, 188 fields turned up on 28 channels, with changes from the FCP, the fuel panel, the flaps, spoilers, and sidestick, the radios, and the transponder: `hdg_sel` and `alt_sel_ft` on `A22X.FCP Data`, `vhf.com_1.active` on `A22X.Radio Data`, and so on.

The first p02 run treated each message as a snapshot, so its report lists fields as gone when a message left them out.
The files stamped `18-19-38` carry that error, and p02 has merged each message into the channel's state since.

**Changed:** reading one message tells a listener only what just changed, so a listener has to keep each channel's state, and needs a way to learn the fields that haven't changed (the entry above).
The CommBus gives an absolute value for controls whose input is relative: the A220's baro knob takes a count of detents, and `qnh_hpa` says where it landed.

**Affects:** [07-aircraft-specific-systems](../../learn/foundations/07-aircraft-specific-systems.md), whose table puts the setting on `A22X.L PFD Data`, and [05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm), which names that channel as the one holding it.

**Evidence:** [p02-commbus-watch-2026-09-28-18-22-39.txt](../../../experiments/areas/commbus/results/p02-commbus-watch-2026-09-28-18-22-39.txt), with its `.ndjson` stream and `-state.json`, and the p03 files in the entry above.

## 2026-09-28: A script that arrives after a panel loaded can list every CommBus name the panel registered

**Asked:** can panel JavaScript that arrives late learn which CommBus names the panel's own code already listens to?

**Expected:** only names registered after our script arrived, since the listeners live inside the aircraft's code.

**Found:** every name, from the sim's own bookkeeping.
Panel JavaScript listens on the CommBus through a `ViewListener` named `JS_LISTENER_COMM_BUS`, which keeps its names in a map, `eventHandlers`.
`RegisterViewListenerT`, which creates every listener, also records each one in a page-wide manager, `ViewListener.g_ViewListenersMgr`.
So `ViewListener.g_ViewListenersMgr.m_hash["JS_LISTENER_COMM_BUS"].array` lists every CommBus listener in the panel, and their `eventHandlers` keys list every name.
The A220's DisplayUnits panel registered 42 names this way, through plain `ViewListener` objects rather than `RegisterCommBusListener`.
The sim's scripts that define all this are the same in all 14 of the A220's panels.

Two details of the sim's code matter to anything that listens:
- Removing our listener removes only our handlers, because the clear function Coherent returns targets the handler it was made for (read from `Coherent._createClear`).
- `Coherent._trigger` calls a name's handlers in a loop with no try/catch, so a handler that throws stops every handler after it for that message (read from `Coherent._trigger`).

**Changed:** finding names can happen at runtime, in a running panel, which is what the profile IDE's discovery needs.
It sees only names that panel JavaScript listens on, so traffic between modules, and calls sent only to SimConnect, stay invisible to it.

**Affects:** nothing yet.

**Evidence:** [p01-commbus-source-2026-09-28-18-07-44.txt](../../../experiments/areas/commbus/results/p01-commbus-source-2026-09-28-18-07-44.txt), and section 1 of the p02 report in the entry above.
The sim's source that p01 saved stays out of the tree, in `experiments/sim-sources/`, because it's Asobo's.
