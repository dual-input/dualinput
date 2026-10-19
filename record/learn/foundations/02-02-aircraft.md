# The MSFS 2024 platform: aircraft

- [SimObjects](#simobjects)
- [How an aircraft is identified](#how-an-aircraft-is-identified)
- [Model behaviors](#model-behaviors)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Installs, packages, and the virtual file system are in [02-01-installs-and-packages](02-01-installs-and-packages.md), and the running sim is in [02-03-the-running-sim](02-03-the-running-sim.md).

## SimObjects

An aircraft is a folder inside a package, such as `SimObjects\Airplanes\pa24-250` [2].
An aircraft built the MSFS 2024 way is modular: a `common` folder holds the shared aircraft, each preset folder turns it into one variant, and each livery folder repaints it [1] [2].

**How it works.**
Here is A2A's PA-24 Comanche, trimmed to the parts that matter [2]:

```text
SimObjects\Airplanes\pa24-250\
  common\
    config\    aircraft.cfg  systems.cfg  flight_model.cfg  engines.cfg  cockpit.cfg ...
    model\     PA24_250_INTERIOR.xml  Inputs\A2A_Inputs.xml  Templates\A2A_Templates.xml ...
    panel\     panel.cfg  ModelCode1.wasm  Accusim.wasm ...
  presets\a2a\PA24-250\config\
               aircraft.cfg  systems.cfg  flight_model.cfg  attached_objects.cfg ...
  attachments\a2a\   Gns430\  Gtn750\  Kln90B\  Tablet\ ...
  liveries\a2a\      N6229P\  N7791P\  N822JH\  N8351P\  N84VK\
```

Each file in `config` has one job:

| File | What it holds | PA-24 example |
| --- | --- | --- |
| `aircraft.cfg` | Identity: `[FLTSIM.N]` sections, each with a `title` [3] | `title ="A2A Piper PA-24-250 Comanche"` [2] |
| `systems.cfg` | Electrical circuits, lights, fuel, and other systems [4] | `circuit.3 = Name:Fuel_Pump#Type:CIRCUIT_FUEL_PUMP:1#Connections:bus.1`, which names circuit 3, the one `A:CIRCUIT CONNECTION ON:3` reads [4] |
| `flight_model.cfg` | The flight model | All in `common`: the preset's copy holds no parameters [2] |
| `panel.cfg` | The gauges each cockpit display runs, in `[VCockpitNN]` sections | `htmlgauge08 = WasmInstrument/WasmInstrument.html?wasm_module=ModelCode1.wasm&wasm_gauge=Code1, 0,0,1,1` [2] |

The sim builds a preset by merging, in order, the `common` files, the attachments that have an alias in the preset's `attached_objects.cfg` and a copy of the file being merged, and the preset's own files [5].
None of the PA-24's 11 attachments has an alias [2].
The merge goes parameter by parameter: a preset's parameter replaces the one in `common`, and an indexed parameter, such as `circuit.N`, is added at the end [5].
It runs twice, once when the package is mounted at boot and again when a flight starts [5].
So the PA-24's preset `aircraft.cfg` holds only `[FLTSIM.0]` and a title, and its `systems.cfg` and `flight_model.cfg` hold only `[MODULAR_MERGE]` with `auto = true` [2].

A livery is a folder with a `livery.cfg`, whose `[General]` section names it and whose `[FLTSIM.N]` sections override parameters such as `atc_id` [6].
The PA-24's `N6229P` livery sets `name = "A2A N6229P"` and `atc_id = "N6229P"`, in sections it spells `[GENERAL]` and an unindexed `[FLTSIM]` [2].
A `[Selection]` section can limit a livery to presets whose attachments define the tags it lists in `required_tags` [6].
Non-modular aircraft, built the MSFS 2020 way, don't use `livery.cfg`, and each livery is its own `[FLTSIM.N]` section with its own title [6] [7].

**What it changes for Dual Input.**
Any check Dual Input makes by reading an aircraft's files, such as whether both pilots have the same aircraft, has to merge `common`, attachments, and preset the way the sim does, or compare what the sims report instead.
[Part 7](outline.md#7-aircraft-specific-systems-refresher) covers matching aircraft.

**Traps.**

- The `aircraft.cfg` the sim names when an aircraft loads is the preset's thin file.
  When fsc-editor read the PA-24's, the file held 2 lines, and the preset's `systems.cfg` held no circuits against 37 in `common` [8].
  Nothing in the preset's files points to `common`: the layering is by folder convention [8].
- Case differs between the disk and what the sim reports.
  On disk the preset folder is `PA24-250` and the file is `aircraft.cfg` [2], and the sim reported `pa24-250` and `aircraft.CFG` [8].
- A streamed or Marketplace aircraft may have no file on disk to read: a forum report says the sim writes the preset's files to a cache folder and deletes them once it has read them (unverified) [9].

## How an aircraft is identified

The sim names the loaded aircraft three ways: its SimObject folder, which appears in the path the `AircraftLoaded` system event reports; its title, `A:TITLE`; and its livery, `A:LIVERY NAME` and `A:LIVERY FOLDER` [8] [10].
Each follows a different choice the pilot makes, so none of them alone says what the pilot is flying.

**How it works.**
For the PA-24:

| Name | Value | Follows |
| --- | --- | --- |
| Folder | `pa24-250`, from the reported path `SimObjects\Airplanes\pa24-250\presets\a2a\pa24-250\config\aircraft.CFG` [8] | the aircraft |
| Title | `A2A Piper PA-24-250 Comanche`, from the preset's `[FLTSIM.0]` [2] | the preset |
| Livery | `A2A N6229P`, from `livery.cfg` [2] | the livery |

`A:TITLE` is the `title` from `aircraft.cfg`, which the SDK calls the "unique identifier of SimObjects and their variants" [3] [10].
`A:LIVERY NAME` is the `name` from `livery.cfg`, and `A:LIVERY FOLDER` is the folder it's in [10].
On a Synaptic A220, `A:LIVERY NAME` read `Synaptic House A220-300` [11].

FS Copilot keys its aircraft profiles on the folder: it takes the path segment after `SimObjects\Airplanes\` [12].
fsc-editor found that all 16 FS Copilot profiles whose aircraft was installed were named after the aircraft's folder, ignoring case and a `-default` suffix [13].

In non-modular packages the title carries the livery instead.
FSLTL's traffic aircraft have titles like `FSLTL_FAIB_B738_UAL-United_NC`, and `A:LIVERY NAME` is empty on all of them [7].

**What it changes for Dual Input.**
Dual Input needs an aircraft identity that both machines compute the same way from what their sims report.
The folder finds the aircraft's profile, and whether the title and livery also have to match on both machines is a question for [part 7](outline.md#7-aircraft-specific-systems-refresher).

**Traps.**

- One load was announced twice, 1ms apart, with different paths: `SimObjects\Airplanes\A350\presets\...\aircraft.CFG`, relative and mixed-case, then `c:\users\...\community\inibuilds-aircraft-a350\simobjects\airplanes\a350\presets\...\aircraft.cfg`, absolute and lowercase [14].
  fsc-editor's app saw `A350` and then `a350`, and matched no profile for the first, so compare paths case-insensitively.
- The SDK says `AircraftLoaded` reports the aircraft's `.AIR` flight dynamics file [15].
  We measured it reporting the preset's `aircraft.cfg` [8], and trust the measurement.
- The livery reaches places that look unrelated to it.
  On livery N324DU, the A220's display panel identified itself as `DisplayUnits|config=N324DU` [16].
FS Copilot's profile names only `DisplayUnits|config=Default`, so, reading the code, the panel matches nothing, which nobody has confirmed in flight (unverified) [16].
- `A:ATC MODEL` doesn't identify an aircraft: it read `777` or `A320` for some traffic, and a localization token such as `ATCCOM.ATC_NAME CITATION.0.tts` for others [7].

## Model behaviors

A cockpit control's behavior is XML in the aircraft's model files.
Each part of the model gets a `<Component>`, which calls a template through `<UseTemplate>` with parameters, and the templates, the aircraft's own and Asobo's, supply the animation, the mouse interaction, and the input event [17].
An input event, written `B:` in calculator code, is declared in an `<InputEvent>` element and exposed as one or more presets, defined in the aircraft's XML or in the templates it uses [17] [18].
Calculator code is the sim's RPN scripting language, which [part 3](outline.md#3-variables-events-and-units-full) covers.

**How it works.**
Here is the PA-24's battery master switch from `PA24_250_INTERIOR.xml`, trimmed to the lines that matter [2]:

```xml
<Component ID="Switch_Battery_Master" Node="Switch_Battery_Master">
  <UseTemplate Name="Switch_Battery_Master_Base_Template">
    <IE_NAME>2States</IE_NAME>
    <INTERACTION_TYPE>Switch</INTERACTION_TYPE>
    <SET_STATE_EXTERNAL>(&gt;H:A2A_BATTERY_1_SWITCH) p0 (&gt;L:Battery1Switch)</SET_STATE_EXTERNAL>
    <GET_STATE_EXTERNAL>(L:Battery1Switch) sp0</GET_STATE_EXTERNAL>
    <USE_INPUT_EVENT_ID>Switch_Battery_Master</USE_INPUT_EVENT_ID>
    <INPUT_EVENT_ID_SOURCE>Switch_Battery_Master</INPUT_EVENT_ID_SOURCE>
  </UseTemplate>
</Component>
```

The component names a node in the 3D model, `Switch_Battery_Master`, and hands the template the calculator code that reads and sets the switch.
Setting it fires `H:A2A_BATTERY_1_SWITCH` and writes `L:Battery1Switch` [2].
A2A's `Switch_Battery_Master_Base_Template` hands the work to `ASOBO_Interaction_Base_Template` [2], from `Asobo`, the MSFS 2020 template set, which the PA-24 is built on [17].
That template names the input event preset `#INPUT_EVENT_ID_SOURCE#_#IE_NAME#`: here, `Switch_Battery_Master_2States` [18].
`USE_INPUT_EVENT_ID` attaches the preset to `<InputEvent ID="Switch_Battery_Master">`, which A2A declares in `Inputs\A2A_Inputs.xml`, with presets that extend `ASOBO_GIE_Anim_Handling` [2] [18].
When a pilot flipped the switch, SimConnect's input event subscription reported `SWITCH_BATTERY_MASTER_2STATES`, which matches the preset name, uppercased [19].

The input events the sim lists don't match the aircraft's declarations one for one.
The PA-24 enumerates 318 at runtime, against 223 `<InputEvent>` declarations in its package's XML, so at most 95 can come from the sim [20] [25].
The first 15 enumerated were all `CLICKSPOT_*` and `WALKAROUND_*`, and A2A declares 43 input events with those prefixes in `A2A_External_Inputs.xml` [20] [25], so whether the sim adds any of its own is unverified.
A Black Square Bonanza defines 5 of its own, and some aircraft wire a click straight to calculator code with no input event at all [21].
An input event can bind a key event with `<Binding EventID=...>`, and the sim then intercepts that key event and runs the input event's `<Set>` code instead of the key event's default [17].

**What it changes for Dual Input.**
One click can surface as an input event, an `H:` event, an `L:` write, or nothing Dual Input can observe, and the aircraft's XML decides which.
[Part 3](outline.md#3-variables-events-and-units-full) covers each namespace, and [part 7](outline.md#7-aircraft-specific-systems-refresher) covers how aircraft differ.

**Traps.**

- The name SimConnect reports isn't the `ID` of the `<InputEvent>`: in the one case we measured, it's the preset name the template builds, uppercased (unverified as a rule) [18] [19].
- Each of six switches flipped on the PA-24 reported its input event twice, 25–55ms apart, with the same value, and the cause wasn't investigated [22].
- Asobo's templates aren't on disk in the sim install, because the sim streams them [23].
  The SDK ships a copy in `ModelBehaviorDefs`: the MSFS 2020 set in `Asobo`, and the 2024 set in `Asobo_EX1`, which the SDK says not to mix [17].
  We read the 2020 set from SDK 1.7.3 [18], and whether it matches what the sim runs is unverified.
- `Asobo_EX1` defines neither `ASOBO_Interaction_Base_Template` nor `ASOBO_GIE_Anim_Handling` [18], so everything above about preset names holds for aircraft built on the 2020 set, like the PA-24, and is unverified for aircraft built on the 2024 set.

## Sources

1. Documented: MSFS 2024 SDK, [Modular SimObject Project Structure](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/Modular_SimObjects/Modular_SimObject_Project_Structure.htm).
2. Documented, read from the installed package: A2A PA-24 (`a2a-aircraft-pa24`) in the Community folder of our development machine, 2026-09-27, under `SimObjects/Airplanes/pa24-250/`: the preset's `aircraft.cfg`, `systems.cfg`, and `flight_model.cfg` in `presets/a2a/PA24-250/config/`, `common/config/aircraft.cfg`, `common/panel/panel.cfg`, `liveries/a2a/N6229P/livery.cfg`, and, in `common/model/`, `PA24_250_INTERIOR.xml`, `Inputs/A2A_Inputs.xml`, and `Templates/A2A_Templates.xml`.
3. Documented: MSFS 2024 SDK, [aircraft.cfg](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/CFG_Files/aircraft_cfg.htm).
4. Documented in our record, read from the PA-24: fsc-editor, `docs/sim-vars/11-static-analysis.md`, "Tier 1: structured, parse it properly".
5. Documented: MSFS 2024 SDK, [Modular SimObject Merging](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/Modular_SimObjects/Modular_SimObject_Merging.htm).
6. Documented: MSFS 2024 SDK, [livery.cfg](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/CFG_Files/livery_cfg.htm).
7. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 0 capture read; TrafficInject built and smoke-tested — Q01, Q08 settled".
8. Measured on MSFS 2024, 2026-08-18: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-18 — Stage 0 complete. Aircraft key confirmed; two findings about layout."
9. Unverified, forum: MSFS DevSupport, [Simconnect SubscribeToSystemEvent AircraftLoaded filepath error](https://devsupport.flightsimulator.com/t/simconnect-subscribetosystemevent-aircraftloaded-filepath-error/11094), 2024-11-20, build 1.1.7.0.
   A later thread, [AircraftLoaded only serves the 'preset' aircraft.cfg](https://devsupport.flightsimulator.com/t/msfs2024-modular-package-simconnect-aircraftloaded-only-serves-the-preset-aircraft-cfg/15386), 2025-09-01, agrees with our measurement [8].
10. Documented: MSFS 2024 SDK, [Aircraft Misc Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Misc_Variables.htm): `TITLE`, `LIVERY NAME`, and `LIVERY FOLDER`.
11. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · TrafficRead built and smoke-tested — Q03 settled yes".
12. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Connection/SimConnectConsumer.cs`, `PushAircraft`.
13. Documented in our record: fsc-editor, `docs/sim-vars/build/var-index-plan.md`, "What is already known", the row "Profile ↔ aircraft".
14. Measured on MSFS 2024, 2026-08-27: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-27 — The settle rule did not fail here, and one aircraft was two".
15. Documented: MSFS 2024 SDK, [SimConnect_SubscribeToSystemEvent](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/General/SimConnect_SubscribeToSystemEvent.htm).
16. Measured on MSFS 2024, 2026-09-17: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-17 — The A220's DisplayUnits key carries the livery, and the profile names only Default".
17. Documented: MSFS 2024 SDK, [Model Behaviors](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/Models/ModelBehaviors/Model_Behaviors.htm) and [Model Behaviors Inputs](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/Models/ModelBehaviors/UsingBehaviours/Model_Behaviors_Inputs.htm).
18. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `ModelBehaviorDefs/Asobo/Inputs/Templates.xml`, the MSFS 2020 template set: the template `ASOBO_Interaction_Base_Template` and the comment above it on `INPUT_EVENT_ID_SOURCE`, `IE_NAME`, and `USE_INPUT_EVENT_ID`.
    Also `ModelBehaviorDefs/Asobo_EX1`, the 2024 set, searched for those template names.
19. Measured on MSFS 2024, 2026-08-18: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-18 — Stage 0 passes against the sim. The module is off the critical path."
20. Measured on MSFS 2024, 2026-08-18: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-18 — The runtime input-event list is a superset of the aircraft's own".
21. Documented in our record: fsc-editor, `docs/sim-vars/02-namespaces.md`, sections "But coverage varies enormously" and "Pure-XML interactions".
22. Measured on MSFS 2024, 2026-08-18: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-18 — Every input event fires twice".
23. Documented in our record: fsc-editor, `docs/aircraft/synaptic-a220.md`, section "Input events (`B:`)".
24. Documented in our record, read from the installed package `inibuilds-aircraft-a380` 1.0.0 on 2026-09-29: [inibuilds-a380 study](../../areas/aircraft/inibuilds-a380/study.md), the "Readable" line of its header and "What the encryption hides", and its [file list](../../areas/aircraft/inibuilds-a380/files.md), from each archive's header and index.
25. Documented in our record, read from the installed package `a2a-aircraft-pa24` 2.1.3 on 2026-09-29: [a2a-pa24-comanche study](../../areas/aircraft/a2a-pa24-comanche/study.md), "State" and "Prior records", with every declared input event in its [input-events.tsv](../../areas/aircraft/a2a-pa24-comanche/inventory/input-events.tsv).

## Unverified claims

- **Streamed and Marketplace aircraft have no readable `aircraft.cfg` on disk.**
  One forum report says so [9], and our measurements are all of Community aircraft.
  An iniBuilds A380 in the `Official2024` folder keeps its WASM module, its model behaviors, and presumably its `aircraft.cfg` in five `.fsarchive` files whose index is encrypted [24].
  Its other two archives, `html_ui.fsarchive` and `minimal.fsarchive`, have a `notEncrypted` header and store their files uncompressed, and its `manifest.json`, `layout.json`, and `.actiondb` files are loose on disk [24].
  Reading the path `AircraftLoaded` reports for a stock MSFS 2024 aircraft, and checking whether the file exists, would settle it.
- **The input event name SimConnect reports is the template's preset name, uppercased.**
  The one example matches [18] [19], but nobody has compared a full enumeration against the XML, and the PA-24 uses the 2020 template set.
  Enumerating the input events of the PA-24 and of an aircraft built on `Asobo_EX1`, and matching each against the preset names its templates build, would settle it.
- **Whether the sim adds input events to the PA-24's.**
  The package declares 223, and of the 318 enumerated, only the first 15 were looked at, all with prefixes A2A uses [20] [25].
  Listing all 318 and matching them against the 223 declared would settle it.
- **A220 display panels on a non-Default livery match no FS Copilot profile entry.**
  We read it from the code [16], and nobody has flown it.
  A flight on livery N324DU with the pointer-forwarding counters open would settle it.
- **The SDK's `ModelBehaviorDefs` matches the templates the sim runs.**
  We read SDK 1.7.3, and the sim streams its own copy [23].
  Comparing a template's code in the Behaviors window with the SDK's file would settle it.
