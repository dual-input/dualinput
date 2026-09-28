# Aircraft-specific systems

- [Why study-level aircraft diverge](#why-study-level-aircraft-diverge)
- [How major addons expose state](#how-major-addons-expose-state)
- [Control semantics](#control-semantics)
- [Causes vs. effects](#causes-vs-effects)
- [Hidden state](#hidden-state)
- [Sources of divergence](#sources-of-divergence)
- [Matching aircraft](#matching-aircraft)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

## Why study-level aircraft diverge

A study-level aircraft runs its own model of its systems and keeps the state in its own variables, CommBus channels, or memory, so the sim's `A:` variables and `K:` events for those systems can go stale or do nothing.
Each aircraft needs its own map of where its state lives and what changes it.

**How it works.**
The Synaptic A220's systems run in `systems.wasm`, a 6.8 MB Rust module loaded as a gauge in `panel.cfg`.
It reads a short list of `A:` variables, such as `A:AMBIENT PRESSURE`, writes `L:A22X` variables for switch positions and lamps, intercepts a list of key events, and publishes the rest of its state as JSON on the CommBus ([05-02](05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm)) [1].
fsc-editor searched the module's strings for the sim names it uses [1]:

| System | Stock name | On the A220 |
| --- | --- | --- |
| Altimeter | `A:KOHLSMAN SETTING MB` | Absent from the module; the setting is `qnh_hpa` on the `A22X.L PFD Data` channel |
| APU | `A:APU PCT RPM`, `A:APU SWITCH` | The sounds read the RPM from `L:A22X APU RPM` [19] |
| Transponder | `A:TRANSPONDER CODE` | Absent; the module intercepts `K:XPNDR_SET` and keeps the code itself |
| Autopilot | `K:AP_MASTER` | The button fires it, and lights from `L:A22X AP Master` [19] |

**What it changes for Crosscheck.**
The SDK's variable list can't say where a study-level aircraft keeps its state, so Crosscheck needs that knowledge per aircraft before the flight, from the aircraft's files, its vendor's documentation, and watching it ([03-03](03-03-reading-and-writing.md#enumerating-vs-observing)).
State kept only on the CommBus needs code in the sim to read.

**Traps.**

- A stale `A:` variable reads a plausible number, not an error ([03-01](03-01-units-and-variables.md#a-simulation-variables)).
- Vendor documentation, profiles, and binaries disagree.
  FS Copilot's A220 profile, written "without the aircraft installed", syncs baro through `A:KOHLSMAN SETTING MB:1` and `K:KOHLSMAN_SET` [2], and neither name appears in the module [1].
  fsc-editor's notes call that conclusive, but the SDK also numbers both, as `KEY_KOHLSMAN_SET` and the gauge token `KOHLSMAN_SETTING_MB`, and a module can use the numbers without the names [19], so only a flight can settle it.

## How major addons expose state

Each vendor picks its own channels, from FlyByWire's documented `L:` variables and custom events to PMDG's SimConnect client data area, while the Asobo defaults use `A:` variables, `K:` events, and `B:` presets.

**How it works.**

| Aircraft | State to read | Control to write |
| --- | --- | --- |
| FlyByWire A32NX | `L:A32NX_*`, such as `L:A32NX_FCU_EFIS_L_DISPLAY_BARO_VALUE` [3] [4] | Custom events named with a period, such as `A32NX.FCU_EFIS_L_BARO_SET` [3] |
| PMDG 777-300ER | The client data area `PMDG_777X_Data`, a C struct [5] | Events numbered from 69632, such as `#69748` for the logo lights [5] |
| Fenix A320 | `L:I_*` variables, mostly on its annunciator lights, 424 names [6] | `L:S_*` for switches and `L:E_*` for encoders [6] |
| iniBuilds A350 | `L:INI_*`, such as `L:INI_AIRSPEED_DIAL` [4] | `L:INI_*_COMMAND`, such as `L:INI_AIRSPEED_DIAL_UP_COMMAND`, judging by the names [4] |
| Synaptic A220 | `L:A22X *` for switches and lamps, and CommBus JSON for the rest [1] [7] | Stock `K:` events it intercepts, `L:` writes, and `H:` events for keypads [1] |
| Asobo C172 G1000 | `A:` variables, such as `A:LIGHT BEACON:1`, and `L:XMLVAR_*` [4] | `K:` events and `B:` presets, such as `B:ELECTRICAL_Battery_STBY_2_Set` [4] |

PMDG's SDK manual ships in the MSFS 2024 package but gives MSFS 2020's folder paths [5].
It says the data stays off until the user adds `EnableDataBroadcast=1` under `[SDK]` in `777_Options.ini` [5], which on our Steam install is in `%APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2024\pmdg-aircraft-77w\work\` [20].
The 777's cockpit clicks take a third route: its package declares no `<InputEvent>`, and each of 797 mouse callbacks in its cockpit XML sends the switch's number times 100, plus a code for the mouse action, through `K:ROTOR_BRAKE` [8].
FS Copilot's PMDG profile replays a left click on switch 1084 as `108401 (>K:ROTOR_BRAKE)`, and reads the switch's state from its animation variable, `L:switch_1084_a` [4] [8].

Displays differ too: 20 of the PMDG 777's 22 `panel.cfg` gauges load `WasmInstrument`, as do 11 of the A350's 15 and 14 of the Fenix's 21, against only the systems gauge among the A220's 14 [1] [9].
Panel code drives the A380's WASM displays at a position, and no sequence tried so far drives the A350's ([06-03](06-03-display-kinds-input-and-pop-outs.md#display-kinds-html-react-on-dom-react-on-svg-canvas-wasm-gauges)).

**What it changes for Crosscheck.**
Crosscheck needs a reader and a writer for each kind of channel: the namespaces [part 3](outline.md#3-variables-events-and-units-full) covers, SimConnect client data for PMDG, and the CommBus for the A220.
PMDG's data also needs each pilot to edit a file in their own install.

**Traps.**

- SimConnect's input event list would show none of the 777's switches, since none is declared (unverified: read from the XML, not enumerated).

## Control semantics

A latched switch or a set-to-position event carries a state, which the other machine can write as it stands.
A momentary press, a toggle, and a relative step carry an action, whose result depends on the state of the aircraft it lands on.

**How it works.**

| Semantics | Example | What syncing it takes |
| --- | --- | --- |
| Latching | `L:A22X L Pack Off`, readable and writable [1] | Write the value |
| Momentary | `L:A22X External Power Toggle`, only ever written 1, with the state in `L:A22X External Power In Use` [1] | Replay the press, or compare the state |
| Toggle vs. set | The A220's autopilot buttons have only toggle events, such as `K:AP_MASTER` [2]; a PMDG event takes a position or a mouse flag [5] | Toggle only when the states differ |
| Relative | `L:A22X L Altimeter Set` takes a signed number of detents [1] [7]; Fenix's baro knob runs `(L:E_FCU_EFIS1_BARO) ++ (>L:E_FCU_EFIS1_BARO)` on each increment [6] | An absolute set and readback: FlyByWire has `A32NX.FCU_EFIS_L_BARO_SET`, and the A220 has neither [1] [3] |
| Guarded | An A220 guard is its own input event, with its state in `O:GuardState` [1]; a PMDG guard is its own switch, `L:switch_516_a` [4] | Sync the guard as a control |
| Multi-position | `L:A22X Taxi Lights`, 0 to 2 [1] | Write the index |
| Spring-loaded | `L:A22X APU Switch`, where 2 is START [1] | Knowing whether the variable springs back or only its drawing |

The A220 profile writes a toggle only when the two machines disagree [2]:

```yaml
- get: L:A22X AP Master
  set: "value != current ? '(>K:AP_MASTER)' : ''"
```

**What it changes for Crosscheck.**
Crosscheck's knowledge of an aircraft has to record each control's semantics, because the sim doesn't: all 464 of the A220's input events have the same type ([03-02](03-02-events-and-other-namespaces.md#b-input-events)).
[Part 8](outline.md#8-synchronization-full) covers relative vs. absolute actions.

**Traps.**

- FS Copilot's built-in guard, which skips a toggle whose value the machine already has, compares against `current`, which is null until the machine has read the variable once, so the first apply after connecting is never guarded [10].
- Pulses from a fast-turned knob can merge: the A220 profile says "Several increments can land inside one poll interval with no intervening zero, so clicks coalesce" [2].
- A spring can be drawn without moving the variable.
  The A220's XML draws the APU switch back at ON 3s after a mouse move but leaves `L:A22X APU Switch` at 2 [1], while the profile says the aircraft's systems return it to 1 once the APU lights [2].

## Causes vs. effects

A cause is what a pilot's hand changes, such as a switch position or an event, and an effect is what the aircraft's systems compute from it, such as a lamp, a sound, or a mode readback.
Writing a cause on the other machine lets its systems compute the same effects, and writing an effect fights those systems, which compute it again.

**How it works.**
The A220 names both halves of its display tune inhibit button: `L:A22X Display Tune Inhibit` is the press, and `L:A22X Display Tune Inhibited` is the state [1].
FS Copilot's A220 profile reads the effect and writes the cause when the two machines disagree [2].
It leaves out about 45 lamp variables because "writing them fights the local model", and about 120 aural cue variables because syncing them "double-plays callouts and warnings" [2].
Across FS Copilot's profiles, 9,673 setters write a name other than the one their `get:` reads, and 701 write the same one, so reading a state and writing the event that changes it is the usual shape of an entry [11].

**What it changes for Crosscheck.**
For each control, Crosscheck's aircraft knowledge needs the cause to write and the effect to compare, and comparing effects across machines is how Crosscheck can notice divergence ([part 8](outline.md#8-synchronization-full)).

**Traps.**

- Nothing marks which of several variables that move together is the cause ([03-03](03-03-reading-and-writing.md#enumerating-vs-observing)).
- An effect written from the other machine can be recomputed at once, and the two machines then fight: fsc-editor's design says "A variable that reverts shortly after being written will desync if bound" [12], and our records hold no measured case.

## Hidden state

FMS entries, flight plans, the page each display shows, failures, and running timers live inside the aircraft's code, often with no variable to read.
Crosscheck can sync them only through a vendor channel, or by replaying inputs onto an aircraft in the same state.

**How it works.**

| State | Where it lives |
| --- | --- |
| FMS entries | The A220's keypad fires `H:A220_KBD_<ID>_#INDEX#` events ([03-02](03-02-events-and-other-namespaces.md#h-html-events)); PMDG exports each CDU screen as 24 by 14 cells, once enabled in `777_Options.ini` [5] |
| Flight plans | The A220's FMS is in its module, with CommBus channels such as `A220.Flight Plan Request`, two navigation databases, and a SimBrief uplink [1]; the PMDG 777 keeps its own navigation data, AIRAC cycle 2609 on our machine, and saved routes in its work folder [20] |
| Display pages | A reloaded display comes back on its first page ([06-01](06-01-the-engine-and-instruments.md#vcockpit-baseinstrument-and-panelcfg-gauges)); G1000 NXi softkeys sync as `H:AS1000_PFD_SOFTKEYS_1` and the like, whose meaning depends on the page [13] |
| Failures | The SDK's "Aircraft Failures" events are 8 toggles, such as `K:TOGGLE_ENGINE1_FAILURE` [14] |
| Timers | The A220's chronograph buttons are momentary `L:A22X L Chrono` presses, and no variable in the A220 notes holds the elapsed time [1] |

**What it changes for Crosscheck.**
Replaying inputs works only onto an aircraft in the same state, so Crosscheck needs both aircraft in a known state before replay starts, and a way to recover when they aren't.
[Part 8](outline.md#8-synchronization-full) covers initial sync and resync.

**Traps.**

- A replayed key on a display showing another page presses something else.
  Our FS Copilot fork drops a forwarded click for a panel that hasn't announced itself yet, because such a panel has reloaded and "replaying into it would be random input, not a catch-up" [15].
- Two machines with different navigation data might build different flight plans from the same entries (unverified, [04-03](04-03-client-data-ai-and-throughput.md#the-ai-objects-api-and-the-facilities-api)).

## Sources of divergence

Two machines given the same inputs can drift apart, because each runs the flight model and the aircraft's systems on its own frames, with its own AI traffic around it, and our records don't measure how far.
Any continuous quantity can drift unless one machine's value wins.

**How it works.**

- **Frame timing.**
  Frame rates differ by machine and scene, and pause and simulation rate are per machine ([02-03](02-03-the-running-sim.md#the-sim-loop)).
- **Physics.**
  FS Copilot and YourControls freeze the aircraft on the following machine and set its position from the one flying ([01](01-prior-art-and-crew-practice.md#prior-art)).
  FS Copilot also sends 11 fuel tank level variables, such as `A:FUEL TANK LEFT MAIN LEVEL`, from the machine of the pilot in control, sampled every 30ms [10] [13].
- **Randomness.**
  Nothing in our records measures randomness inside an aircraft's systems.
  Each sim spawns its own AI traffic, which our fork's traffic design replaces with one host's traffic, injected into every other sim [16].
- **The aircraft's own outputs.**
  Each machine's systems compute their own callouts and lamps, which is why the A220 profile syncs neither [2].

**What it changes for Crosscheck.**
For each value, Crosscheck has to decide whether one machine sends it or both compute it and compare, which is [part 8](outline.md#8-synchronization-full)'s question of replication models.

**Traps.**

- A value one machine sends can fight the receiver's own model, as FS Copilot's tank levels would if the frozen aircraft's engines keep burning fuel, which is unmeasured.

## Matching aircraft

Both machines must run the same aircraft package at the same version, with the same preset, and for some aircraft the same livery and options, because each can change variable names, panel keys, or behavior.
The sim reports the folder, title, and livery ([02-02](02-02-aircraft.md#how-an-aircraft-is-identified)), and no API in our records reports a package's version.

**How it works.**

- **Addon.**
  FS Copilot picks a profile by folder, so the Asobo A320neo and the FlyByWire A32NX get separate profiles, `microsoft-a320neo.yaml` and `FlyByWire_A320_NEO.yaml` [4].
- **Version.**
  A package's version is `package_version` in its `manifest.json`.
  fsc-editor's A220 notes were read at 1.0.8 on 2026-09-04 and say to re-verify name lists after an update, and the installed package is 1.0.10, released 2026-09-25 [1] [17].
  Packages in the sim-managed `Official2024` folder have one too, such as the iniBuilds A380's, beside its `.fsarchive` files [17].
- **Livery.**
  The A220's liveries are separate packages, such as `synaptic-a220-livery-dal-324` at 0.0.14 [17].
  The livery's registration shows up in the identity of the A220's display panel, `DisplayUnits|config=N324DU` ([02-02](02-02-aircraft.md#how-an-aircraft-is-identified)).
- **Options.**
  The A220 keeps options in `L:INI_*` variables: `L:INI_BARO_SYNC_OPTION` ties its three altimeters together, and `L:INI_LIGHT_PANEL_OPTION` flips which way the light switches animate [1].
  PMDG keeps the 777's in `777_Options.ini`, beside 11 saved panel states such as `COLDDARK.sav` [20].

**What it changes for Crosscheck.**
On join, Crosscheck has to compare an identity both machines compute the same way: the folder, the title, the livery, the package version, and the options that change behavior.
Reading the version means finding the package on disk, and the path `AircraftLoaded` reports is sometimes relative ([02-02](02-02-aircraft.md#how-an-aircraft-is-identified)).

**Traps.**

- A version string can disagree with the bytes.
  fsc-editor's own package said 0.0.1 in its manifest while its module said 0.1.0, so it compares a SHA-256 of the module instead [18].

## Sources

1. Documented in our record, read from the aircraft's files: fsc-editor, `docs/aircraft/synaptic-a220.md`, from package 1.0.8 on 2026-09-04: "Provenance", "Package layout", "Architecture — the thing to remember", "THE ALTIMETER PROBLEM", "LVAR catalogue", "Input events (`B:`)", "Key events the WASM intercepts", "Radios and transponder", "CommBus channels", and "Rust module map (from panic paths in `systems.wasm`)".
2. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `Definitions/synaptic_a220.yaml`.
3. Documented: FlyByWire, [A32NX custom events](https://github.com/flybywiresim/aircraft/blob/master/fbw-a32nx/docs/a320-events.md), `A32NX.FCU_EFIS_{side}_BARO_SET`, and [A320neo local SimVars](https://github.com/flybywiresim/aircraft/blob/master/fbw-a32nx/docs/a320-simvars.md), for the `A32NX_` prefix; read 2026-09-27, and neither names a sim version.
4. Documented, read from disk: FS Copilot profiles, `definitions/`, which isn't committed to that repository as of 2026-09-27: `FlyByWire_A320_NEO.yaml`, `PMDG 777-300ER.yaml`, `FNX_32X.yaml`, `A350.yaml`, `ASOBO_C172SP_G1000.yaml`, and `microsoft-a320neo.yaml`.
5. Documented, read from the installed package: PMDG 777-300ER (`pmdg-aircraft-77w` 2.4.143, built for MSFS 2024), 2026-09-27: `Documentation/SDK/PMDG_777X_SDK.h`, and `PMDG_777_MSFS_SDK.pdf`, sections "ENABLING DATA OUTPUT" and "CONTROLLING THE PMDG 777", in a PDF dated June 2024.
6. Documented, read from the installed package: Fenix A320 (`fnx-aircraft-320` 2.4.0.4720), 2026-09-27: the `EFIS` component in `SimObjects/Airplanes/FNX_32X/attachments/fnx/Part_Interior_Cockpit/model/Cockpit_Behavior.xml`, and `FNX32X_Interact_Knob_PushPullButton_Template` in `ModelBehaviorDefs/fnx32x/Templates/Interactions.xml`; the 424 are distinct `I_` names across the package's XML.
7. Documented: Synaptic, [A220 simvars](https://docs.synapticsim.com/pilots/simvars), read 2026-09-27.
8. Documented, read from the installed package: PMDG 777-300ER, `SimObjects/Airplanes/PMDG 777-300ER/attachments/pmdg/Function_Interior_77W/model/77W_Cockpit_Behavior.xml`: the component `switch_1084_a`, and a count of the callbacks that end `(L:SwitchID, number) (>K:ROTOR_BRAKE)`; no XML file in the package contains `<InputEvent `.
9. Documented, read from installed packages: FS Copilot fork, `record/exerciser/results/p04-panel-identifiers-2026-09-17.txt`, a count of each aircraft's `htmlgauge` lines and of those loading `WasmInstrument`.
10. Documented, read from FS Copilot's source: fsc-editor, `docs/fscopilot-behavior.md`, sections "The execution split: shared vs master" and "How a change leaves this machine".
11. Documented in our record, counted over FS Copilot's profiles: fsc-editor, `docs/sim-vars/18-language-core.md`, the struck row on `set:` and `get:` names under "Setter-shape rules".
12. Documented in our record: fsc-editor, `docs/sim-vars/10-probe.md`, "Cause versus symptom — the real payoff", from a design that isn't being built.
13. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `Definitions/modules/AS_G1000_NXi.yaml` and `Definitions/modules/fuel.yaml`.
14. Documented: MSFS 2024 SDK, [Aircraft Misc. Events](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Key_Events/Aircraft_Misc_Events.htm), section "Aircraft Failures".
15. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, the row "Event for a key no panel has helloed".
16. Documented in our record: FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "One host, and it need not be the master", a sketch that hadn't run.
17. Documented, read from the installed packages, 2026-09-27: the `manifest.json` of `synaptic-aircraft-a220`, whose release notes say "VERSION 1.0.10 RELEASED SEPTEMBER 25, 2026", of `synaptic-a220-livery-dal-324`, and of `inibuilds-aircraft-a380` in `Official2024\Steam`.
18. Documented in our record: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — Two version numbers for one package, and neither is trustworthy".
19. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/Types/MSFS_EventsEnum.h`, where `KEY_KOHLSMAN_SET` is `KEY_ID_MIN + 504`, and `WASM/include/MSFS/Legacy/gauges.h`, where the `GAUGE_TOKEN` enum has `KOHLSMAN_SETTING_MB = 75`.
20. Documented, read from our MSFS 2024 Steam install, 2026-09-27: `%APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2024\pmdg-aircraft-77w\work\`: `777_Options.ini`, the 11 `.sav` files in `PanelState\`, the routes in `Flightplans\`, and `NavigationData\cycle_info.txt`.

## Unverified claims

- **Which A220 sim names are dead.**
  The list comes from the strings in `systems.wasm` [1], which miss a name built at runtime and a numeric ID [19].
  Turning the captain's baro knob while reading `A:KOHLSMAN SETTING MB:1`, and squawking a new code while reading `A:TRANSPONDER CODE:1`, would settle the two FS Copilot's profile relies on [2].
- **SimConnect lists none of the PMDG 777's switches.**
  Enumerating the 777's input events would settle it.
- **What the Fenix does when a synced encoder counter jumps.**
  FS Copilot's Fenix profile syncs `L:E_FCU_EFIS1_BARO` as a plain value [4], so a receiver whose counter differs may jump many detents.
  Writing the counter 10 above its current value and watching the baro would settle it.
- **Whether the A220's APU switch springs back in its variable.**
  Starting the APU with the mouse and logging `L:A22X APU Switch` would settle it.
- **Whether merged A220 baro pulses lose detents.**
  Writing `L:A22X L Altimeter Set` 10 times in one frame and counting the steps would settle it.
- **How far two machines drift, and whether a frozen aircraft keeps burning fuel.**
  Flying one aircraft on two machines from one start, with FS Copilot's fuel module removed, and comparing tank levels and engine temperatures every minute would settle both.
