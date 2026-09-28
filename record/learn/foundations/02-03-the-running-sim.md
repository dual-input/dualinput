# The MSFS 2024 platform: the running sim

- [The sim loop](#the-sim-loop)
- [The flight lifecycle](#the-flight-lifecycle)
- [Developer Mode tools](#developer-mode-tools)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Installs and packages are in [02-01-installs-and-packages](02-01-installs-and-packages.md), and SimObjects, aircraft identity, and model behaviors are in [02-02-aircraft](02-02-aircraft.md).

## The sim loop

The sim advances in frames and runs its clock at a simulation rate from 0.0625 to 128, in powers of two [1].
The frame rate isn't fixed: it falls as the scene gets heavier [2].
Pause comes in three kinds, slew moves the aircraft without the flight model, replay plays a recording back, and the time of day is a setting either pilot can change [3] [4] [5].

**How it works.**
SimConnect can send data every rendered frame (`SIMCONNECT_PERIOD_VISUAL_FRAME`) or every simulated frame, "whether that frame is rendered or not" (`SIMCONNECT_PERIOD_SIM_FRAME`) [6].
The `Frame` system event arrives every visual frame, carrying the frame rate and the simulation rate [3] [6].
On one machine and one scene, the sim ran at 44.7 fps with no traffic and at 32.5 fps with 132 injected aircraft [2].

Code that moves an aircraft itself has to keep pace with those frames.
FS Copilot's traffic work froze each injected aircraft, so the sim stopped moving it, and wrote its position at 20Hz into a sim running near 33 fps: the aircraft moved on some frames and not on others [7].
Writing a position on every `Frame` event fixed it [7].

The simulation rate is `E:SIMULATION RATE`, which calculator code can set, and the key events `K:SIM_RATE_SET`, `K:SIM_RATE_INCR`, and `K:SIM_RATE_DECR` change it too [1] [4].

The `Pause_EX1` system event reports which pause is on, as flags [3]:

| Flag | Value | Meaning |
| --- | --- | --- |
| `PAUSE_STATE_FLAG_PAUSE` | 1 | Full pause: the sim, traffic, and everything else |
| `PAUSE_STATE_FLAG_ACTIVE_PAUSE` | 4 | Active pause, from the Active Pause button |
| `PAUSE_STATE_FLAG_SIM_PAUSE` | 8 | The user's aircraft pauses, and traffic and multiplayer keep running |

Value 2, `PAUSE_STATE_FLAG_PAUSE_WITH_SOUND`, is an FSX flag the sim no longer uses [3].
`K:PAUSE_SET` turns pause on or off [4].

Slew has `K:SLEW_TOGGLE`, `K:SLEW_SET`, and `A:IS SLEW ACTIVE` [4] [8].
Replay has a flow event at each end, `SIMCONNECT_FLOW_EVENT_REPLAY_START` and `SIMCONNECT_FLOW_EVENT_REPLAY_END`, and a camera state, 15 in `A:CAMERA STATE` [5] [9].
The time of day is `E:ZULU TIME` and `E:LOCAL TIME`, in seconds since midnight, and key events such as `K:ZULU_HOURS_SET` and `K:CLOCK_HOURS_SET` set it [1] [4].

**What it changes for Crosscheck.**
Two machines never run the same frames, so Crosscheck can't sync frame by frame: anything it writes every frame follows the receiving machine's frames, not the sender's.
Pause, simulation rate, slew, and time of day are per machine, and FS Copilot syncs none of them [10], so a pilot who pauses falls behind the other.
[Part 8](outline.md#8-synchronization-full) covers syncing clocks, pause, and simulation rate.

**Traps.**

- Pause events have had bugs in MSFS 2024, according to forum reports we haven't checked: `Pause_EX1` sent 0 for every pause on build 1.0.84.0, and photo mode froze the aircraft like active pause without sending any pause event on build 1.5.26.0 (unverified) [11].
- On build 1.1.7.0, `E:LOCAL TIME` returned zulu time, and `E:ZULU TIME` returned the host PC's UTC time rather than the sim's; the forum thread reports both fixed in 1.2.7.0, and the zulu date variables in 1.3.7.0 (unverified) [11].
- Forum reports from build 1.1.9.0 into early 2025 say `K:ZULU_HOURS_SET` and `K:CLOCK_HOURS_SET` get reverted a second later, or reset the other date and time fields to real time, and nobody reports that fixed (unverified) [11].
- A clock stepped by the frame rate the sim reports drifts from real time and snaps back when it re-syncs [12].

## The flight lifecycle

SimConnect connects at the main menu, before any aircraft exists, and the aircraft and its variables come into being during loading, over tens of seconds [13] [14].
The sim announces the stages through system events, which forum reports say have gaps in MSFS 2024, and through flow events, which our records haven't tested [3] [5] [11].

**How it works.**

| Stage | What exists | What announces it |
| --- | --- | --- |
| Main menu | SimConnect answers, and none of the aircraft's `L:` variables exist [13] | Nothing we've measured |
| Loading | The flight file and the aircraft load, and the aircraft registers its `L:` variables over seconds [14] | `FlightLoaded` and `AircraftLoaded` [3]; `SIMCONNECT_FLOW_EVENT_FLT_LOAD`, then `SIMCONNECT_FLOW_EVENT_FLT_LOADED` [5] |
| Flight start | The pilot is flying | `SimStart` [3]; `SIMCONNECT_FLOW_EVENT_FLIGHT_START` [5] |
| Aircraft change | A new aircraft loads, from the menu or, in Developer Mode, from the Aircraft Selector [15] | `AircraftLoaded` [3] |
| Return to menu | The flight ends | `SIMCONNECT_FLOW_EVENT_FLIGHT_END` and `SIMCONNECT_FLOW_EVENT_BACK_TO_MAIN_MENU` [5]; `SimStop`, in principle [3] |

fsc-editor measured the loading stage.
A Black Square Bonanza's 88 `L:` variables arrived in steps: 71 during the load, and the last 3 at 35s after it [14].
fsc-editor's app, which read the variable table once, when it connected at the main menu, never saw an aircraft's `L:` variables [13].

Flow events also mark a teleport, a back-on-track or skip in an activity, a replay, and a crash [5]; whether any of these but `FLT_LOADED` resets the aircraft's state is unverified.
`SimConnect_SubscribeToFlowEvent` takes only the connection handle, and each event arrives as a `SIMCONNECT_RECV_FLOW_EVENT` carrying the event type and the path of any flight file loaded [16].
The SDK says that after `FLT_LOADED` the aircraft "is now in a new state", and code should re-read its variables from the sim [5].

**What it changes for Crosscheck.**
Crosscheck can't start syncing until both machines have loaded the same aircraft and its variables exist, and it has to take a fresh snapshot after anything that resets the aircraft's state: a reload, and possibly a teleport or a back-on-track.
Which event marks "loaded and settled" reliably is a question for a sim session.

**Traps.**

- A flight reset sends `SimStop`, `SimStart`, `SimStop`, `SimStart`, so a `SimStart` doesn't mean a flight began [3].
- Forum reports on MSFS 2024 say the sim sends a pause but no `SimStop` when the pilot returns to the main menu, and reports unpaused as soon as the pilot clicks Fly, while the world loads and the aircraft taxis on its own (unverified) [11].
- Developers on the forum use `A:CAMERA STATE` to tell where the user is, and one of them uses 12 for the world map, but the MSFS 2024 documentation lists 10 as World Map and 12 as Hangar Custom [9] [11].
  We trust the documentation for 2024, and neither is measured.

## Developer Mode tools

Developer Mode, turned on in the sim's General options, adds a toolbar of tools that inspect the running aircraft and build packages [17].
Most of them need a flight running, and none of them exist on a pilot's machine unless the pilot turns Developer Mode on [17] [18].

**How it works.**

| Tool | Where | What it does |
| --- | --- | --- |
| Behaviors | Tools menu | Shows the aircraft's components, animations, mouse areas, input events, and variables, and lets you set an input event's value, run a binding, or edit a variable [18] |
| Console | Debug menu | Shows the sim's log in channels such as Virtual File System and ModelBehaviors, filtered by errors, warnings, and info [19] |
| Aircraft Selector | Tools menu | Loads another installed aircraft into the running flight [15] |
| Virtual File System | Tools menu | Shows the mount points, and opens the Community folders [17] [20] |
| Project Editor | Tools menu | Builds packages from a project and mounts them into the running sim [21] |
| SimVar watcher | An SDK sample, not a Developer Mode window | A C# app that reads and sets `A:` variables through SimConnect [22] |

The Behaviors window's Input Events view answers "what does this switch do": for each input event it shows the current value, the calculator code each `<Inc>`, `<Dec>`, and `<Set>` runs, and the bindings, with bindings to key event IDs in blue [18].
The SimVar watcher reads and sets simulation variables, and needs a flight running [22].

**What it changes for Crosscheck.**
These tools are for us, while we work out what an aircraft does.
They answer questions about the present moment and keep no history [23], and a pilot's sim won't have them, so whatever Crosscheck needs while the pilots fly has to come through SimConnect, a WASM module, or panel code.

**Traps.**

- A package being built in the Project Editor outranks every installed copy of it [20], so while you test from the editor, the copy in the Community folder isn't what runs.
- The Behaviors window can't show parameters for behaviors in a `<CompileBehaviors>` element, only for those in `<Behaviors>` [18].
- Test a finding with Developer Mode off before relying on it.
  Our records once concluded that the Coherent debugger on port 19999 needed Developer Mode, from a connection refused while the sim was still booting, and it doesn't [24].

## Sources

1. Documented: MSFS 2024 SDK, [Environment Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Environment_Variables.htm): `SIMULATION RATE`, `ZULU TIME`, and `LOCAL TIME`.
2. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Baseline: BeyondATC's own traffic scores 0.56; visual confirmation of the fix", the FPS line.
3. Documented: MSFS 2024 SDK, [SimConnect_SubscribeToSystemEvent](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/General/SimConnect_SubscribeToSystemEvent.htm).
4. Documented: MSFS 2024 SDK, [Miscellaneous Events](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Key_Events/Miscellaneous_Events.htm) and [Aircraft Flight Control Events](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Key_Events/Aircraft_Flight_Control_Events.htm).
5. Documented: MSFS 2024 SDK, [FsFlowEvent](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/WASM/Flow_API/FsFlowEvent.htm), for what each flow event means, and `SimConnect SDK/include/SimConnect.h` in SDK 1.7.3, for the `SIMCONNECT_FLOW_EVENT` names.
6. Documented: MSFS 2024 SDK, [SIMCONNECT_PERIOD](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Structures_And_Enumerations/SIMCONNECT_PERIOD.htm) and [SIMCONNECT_RECV_EVENT_FRAME](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Structures_And_Enumerations/SIMCONNECT_RECV_EVENT_FRAME.htm).
7. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Jitter measured, not eyeballed — freeze + per-frame writes wins; Q16 settled".
8. Documented: MSFS 2024 SDK, [Aircraft Misc Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Misc_Variables.htm), `IS SLEW ACTIVE`.
9. Documented: MSFS 2024 SDK, [Camera Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Camera_Variables.htm), `CAMERA STATE`.
10. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, where no C#, C++, or JavaScript file handles sim pause, simulation rate, slew, or time of day, and the aircraft profiles in FS Copilot profiles, `definitions/`, don't either.
11. Unverified, forum: MSFS DevSupport, [Pause reporting unpaused immediately after clicking Fly](https://devsupport.flightsimulator.com/t/simconnect-subscribetosystemevent-pause-reporting-unpaused-immediately-after-clicking-fly/10791) (builds 1.0.72.0 and 1.0.84.0, 2024-11, acknowledged by Asobo), [Photo mode does not send pause events](https://devsupport.flightsimulator.com/t/photo-mode-does-not-send-pause-events/15233) (build 1.5.26.0, 2025-08), [Not sending SimStop when leaving for the main menu](https://devsupport.flightsimulator.com/t/msfs2024-not-sending-simstop-when-leaving-for-the-main-menu/11572) (build 1.1.9.0, 2024-11, with the `A:CAMERA STATE` workaround in its replies), and [Time related simvars are mixed up](https://devsupport.flightsimulator.com/t/time-related-simvars-are-mixed-up/11270) (build 1.1.7.0, 2024-11, tagged fixed, with the reports on the time-setting key events in its replies).
12. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 4, traffic: what the app needed that the prototype did not".
13. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — An aircraft's `L:` variables do not exist before the aircraft does".
14. Measured on MSFS 2024, 2026-08-27: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-27 — The settle rule did not fail here, and one aircraft was two".
15. Documented: MSFS 2024 SDK, [Tools menu](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools.htm), "Aircraft Selector".
16. Documented: MSFS 2024 SDK, [SimConnect_SubscribeToFlowEvent](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_SubscribeToFlowEvent.htm) and [SIMCONNECT_RECV_FLOW_EVENT](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Structures_And_Enumerations/SIMCONNECT_RECV_FLOW_EVENT.htm).
17. Documented: MSFS 2024 SDK, [SDK Overview](https://docs.flightsimulator.com/msfs2024/html/1_Introduction/SDK_Overview.htm), on enabling Developer Mode and on finding the Community folders.
18. Documented: MSFS 2024 SDK, [Behaviors Debug](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Behaviours_Debug/Behaviors_Debug.htm) and [Behavior Tabs](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Behaviours_Debug/Behavior_Tabs.htm).
19. Documented: MSFS 2024 SDK, [The Console](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Debug/The_Console.htm).
20. Documented: MSFS 2024 SDK, [Virtual File System Information](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Virtual_File_System_Information.htm) and [The Virtual File System](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/The_Virtual_File_System.htm).
21. Documented: MSFS 2024 SDK, [The Project Editor](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Project_Editor/The_Project_Editor.htm).
22. Documented: MSFS 2024 SDK, [SimvarWatcher](https://docs.flightsimulator.com/msfs2024/html/7_Samples_Tutorials/Samples/VisualStudio/SimvarWatcher.htm).
23. Documented in our record: fsc-editor, `docs/sim-vars/01-goals.md`, "Positioning".
24. Measured on MSFS 2024, 2026-09-01: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-01 - Single-machine cockpit validation: the production pipeline works", the Q00 correction.

## Unverified claims

- **Simulated frames and visual frames run at different rates.**
  The SDK's wording implies simulated frames that aren't rendered [6], and nobody has counted both at once.
  Subscribing at both periods and counting callbacks for a minute would settle it.
- **What SimConnect reports during a replay**, and whether writes during one reach the aircraft.
  Starting a replay with a SimConnect client subscribed to position and to flow events would settle it.
- **The flow events fire as documented, in the order the table gives.**
  Nothing in our records subscribes to them.
  Nor does anything say whether a teleport, back-on-track, skip, replay, or crash resets the aircraft's state the way `FLT_LOADED` does.
  Logging every flow event and system event through a menu-to-flight-to-menu cycle, a teleport, and an aircraft change, and reading the aircraft's variables after each, would settle it, together with the forum reports on pause and `SimStop` [11].
- **`K:ZULU_HOURS_SET` and `K:CLOCK_HOURS_SET` don't hold on MSFS 2024.**
  Forum reports say so [11], and nothing in our records sets the time.
  Sending each event in a flight and reading `E:ZULU TIME` and `E:LOCAL TIME` for the next minute would settle it.
- **`A:CAMERA STATE` values in MSFS 2024.**
  The documentation and a forum post disagree on the world map's value [9] [11].
  Reading the variable at the main menu, on the world map, and in the cockpit would settle it.
