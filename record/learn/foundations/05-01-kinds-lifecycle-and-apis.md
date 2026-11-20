# WASM modules: kinds, lifecycle, and the gauge API

- [Gauge vs. standalone modules, and the sandbox](#gauge-vs-standalone-modules-and-the-sandbox)
- [Lifecycle: init, per-frame update, deinit](#lifecycle-init-per-frame-update-deinit)
- [The gauge API and its replacements](#the-gauge-api-and-its-replacements)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

SimConnect and the CommBus from inside a module are in [05-02-simconnect-and-the-commbus](05-02-simconnect-and-the-commbus.md), and the toolchain, versioning, and debugging are in [05-03-toolchain-versioning-and-debugging](05-03-toolchain-versioning-and-debugging.md).

A WASM module is C or C++ compiled to WebAssembly, which the sim loads from a package and runs inside its own process.
[03-03](03-03-reading-and-writing.md#which-namespace-can-be-read-written-or-listed-from-where) showed what only code inside the sim can do, such as listing `L:` variables and running calculator code, and this part is about the module that does it.

## Gauge vs. standalone modules, and the sandbox

The sim loads a standalone module from any package's `modules` folder when it mounts the package, and loads gauge and system modules as part of the aircraft that declares them [1] [5] [6].
Every kind runs in a sandbox: it can call only functions the sim provides, and none of those opens a socket or reaches a file outside the module's own package and a private `work` folder [1] [3] [11].

**How it works.**
The SDK lists four kinds, and three are on our development machine [1] [4] [7]:

| Kind | Declared in | Loaded | Example |
| --- | --- | --- | --- |
| Standalone | Any `.wasm` in a package's `modules` folder | When the sim mounts the package into the virtual file system [1] | `fscopilot-bridge\modules\FsCopilot.wasm` and `fsc-editor-link\modules\fsc-editor-link.wasm` [4] |
| Gauge | A `WasmInstrument` gauge in the aircraft's `panel.cfg` | With the aircraft [5] | The PA-24's `htmlgauge08 = WasmInstrument/WasmInstrument.html?wasm_module=ModelCode1.wasm&wasm_gauge=Code1` ([02-02](02-02-aircraft.md#simobjects)) |
| System | A `[WASM_SYSTEM.N]` section in the aircraft's `systems.cfg` | With the aircraft [6] | iniBuilds' L-1011 runs systems named `autoflight` and `flightcontrols` from `common\wasm\inibuilds-l1011-systems.wasm` [7] |
| Airport | A scenery | When the scenery spawns, and unloaded when it despawns [1] | None checked |

A gauge draws, and the others don't.
The SDK says a gauge draws "in a bitmap which will replace a texture inside the aircraft" [5], so a panel shows it as one image, and nothing outside the module can see its buttons ([01](01-prior-art-and-crew-practice.md#prior-art)).
A standalone module has no draw callback and belongs to no aircraft, and both of our modules are standalone [4].

The sandbox comes from WebAssembly itself.
WebAssembly code can't call the operating system: it calls only the functions its host imports into it, and the sim decides which exist [1].
So a module's import list is its whole reach.
fsc-editor's module imports 32 functions: 28 from the sim, all of them SimConnect calls, Vars API calls, or `execute_calculator_code`, and 4 from WASI, the WebAssembly system interface, such as `fd_write` [4].
Two limits follow from what the sim provides:

- **No sockets.**
  The C library in the SDK has `send` and `recv` for sockets that already exist, and no call that opens one, such as `socket`, `connect`, or `bind` [3].
  The SDK's network API makes HTTP requests, only to `https` addresses, and at most 3 at a time, shared by every module in the sim [8].
- **Files only in two places**, chosen by a prefix on the file name [1]:

  | Prefix | Reaches | Access |
  | --- | --- | --- |
  | `.\` | The module's own package | Read only |
  | `\work` | A folder that persists between sessions, kept for the module's package | Read and write |

On our Steam machine, the sim keeps each module's `work` folder beside the DLL it compiles the module into, in `%APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2024\<package>\work\` [9].
Ours are empty, and the Synaptic A220's holds the navigation database its systems module opens as `\work/synaptic.s3db` [9] [10].
The file API's error for a file outside those places is `FsIOErr_AccessNotAllowed`, which the header explains as "For example, the file is in another package" [11].
The SDK also lists "The Windows API is not supported", along with C++ exceptions and C++ threads [1].
Both our project files build the C++ library without threads, and the toolset compiles every module without exceptions ([05-03](05-03-toolchain-versioning-and-debugging.md#toolchain-sdk-platform-toolset-fspackagetool-the-project-editor)) [12] [13].

**What it changes for Dual Input.**
A Dual Input module has to be standalone, because it runs with whatever aircraft the pilots fly.
It can't open a connection to Dual Input's app, so everything between them passes through the sim ([05-02](05-02-simconnect-and-the-commbus.md)) or through a panel's WebSocket ([part 6](outline.md#6-glass-cockpits-and-coherent-gt-full)).
It can't read the loaded aircraft's files either, so what Dual Input knows about an aircraft's controls has to reach the module from the app.

**Traps.**

- In one early run, a package's `modules` folder held two standalone modules, the cargo-msfs build and a build linked with `MSFS_WasmVersions.a`, and only the first ran [26].
  The second is a build the sim refuses even in a package of its own ([05-03](05-03-toolchain-versioning-and-debugging.md#debugging-crashes-required-exports)), so the run doesn't show whether the sim ignores a second module (unverified).
  Until it is measured, give each standalone module a package of its own.
- A system module must be in the same package as the `systems.cfg` that names it [6], so Dual Input can't add one to another vendor's aircraft from a package of its own.
- A module that reads a file with the C library's blocking calls, while the sim is still streaming that file, is paused "for few frames" until it arrives; the SDK advises the asynchronous file API instead [1] [11].
- The SDK says Marketplace packages are encrypted, and tells module authors not to read an aircraft's `*.xml`, `systems.cfg`, or `flight_model.cfg`, even in their own package [1].
  Two Marketplace aircraft we've read are encrypted only in part: the iniBuilds A380's package and the FSReborn Phenom 300E's each have seven `.fsarchive` files, and two of them have a `notEncrypted` header and hold `panel.cfg`, the `.flt` files, and the panels' JavaScript [24] [25].
- Whether an `https` request to `localhost` reaches a local app is unverified, and it would need a certificate the sim accepts.

## Lifecycle: init, per-frame update, deinit

The sim calls three functions a standalone module exports: `module_init` when it loads the module, `Update_StandAlone` once a frame on MSFS 2024, and `module_deinit` "upon closing the game or after sign-out" [1] [12] [13].
Because the sim loads a standalone module with its package, one instance lives through the main menu, every flight, and every aircraft change of a session.

**How it works.**
fsc-editor's module streams `L:` variables to its app, and its three functions do this [13]:

```text
module_init         open SimConnect as "fsc-editor-link"; create the areas FSCEDITOR_LINK_CMD
                    and FSCEDITOR_LINK_OUT; register the variable-status handler; leave a hello
                    in the OUT area; SimConnect_CallDispatch
Update_StandAlone   SimConnect_CallDispatch; add delta_seconds to a clock; send one chunk of
  (every frame)     names, or, once 1/15s has passed since the last send, the values that moved
module_deinit       SimConnect_Close
```

The sim finds these functions by name, and calls each one "if they exist" [1].
The SDK names only `module_init` and `module_deinit`, and says only that "Standalone modules now have an update callback" [1].
The update's name and signature, `extern "C" MSFS_CALLBACK void Update_StandAlone(float dTime)`, come from working modules and from the forum [12] [13] [14].
It does run regularly: `E:ZULU TIME`, read in that callback and sent at most every 1/15s, arrived 1,076 times at a steady 15Hz [16].
An Asobo developer wrote that it runs each frame after the sim's own update of physics and systems, and before model behaviors (unverified) [15].
MSFS 2024 runs each module on a thread of its own, "however, each module is still single threaded" [1].

FS Copilot's module also runs on MSFS 2020, which has no update callback.
For that case it creates a 4-byte client data area, `FSC_CLOCK`, subscribes to it at `SIMCONNECT_CLIENT_DATA_PERIOD_VISUAL_FRAME`, and treats each delivery as a frame tick, but only until `Update_StandAlone` has run once [12].

A standalone module outlives each flight and the app.
fsc-editor's module stayed loaded through an aircraft change, which its variable-status handler reported as a burst of `Z:`, `O:`, and `I:` removals, one per destroyed object, then an `L:` reset [17].
It also outlived its app.
When the editor restarted with the sim running, the module re-sent the `L:` names but no values, because no value had moved since it last sent them, and the editor showed blank lines.
The fix was to make the module's `start` command forget its last values [13].

Gauges and systems follow the aircraft instead, and the SDK names their callbacks after the gauge or system [5] [6]:

| Kind | Callbacks | When the sim calls them |
| --- | --- | --- |
| Gauge | `<name>_gauge_init`, `_gauge_update`, `_gauge_draw`, `_gauge_kill`, `_gauge_mouse_handler` | Init once; update and draw once a frame, with drawing allowed only in draw; kill before the gauge is destroyed |
| System | `<name>_system_init`, `_system_update`, `_system_kill` | The same, without draw |

The MSFS 2020 form, which the SDK calls deprecated, is one callback per gauge that receives service codes such as `PANEL_SERVICE_PRE_UPDATE` and `PANEL_SERVICE_PRE_DRAW` [5].

**What it changes for Dual Input.**
State in a Dual Input module outlives each flight, so the module has to notice a flight or aircraft change and reset itself.
It outlives the app too, so whatever it does to the pilot's aircraft for the app must undo itself when the app goes quiet.
FS Copilot's module does this: its app writes `FSC_CONTROL` every 200ms, and when none has arrived for 1s the module unfreezes the aircraft [12] [18].

**Traps.**

- A misspelled `Update_StandAlone` isn't an error: the sim calls only functions that exist [1], so the module loads and never ticks.
  fsc-editor's build fails when any of the three names is missing from the module's exports [19].
- What `dTime` measures is unknown: FS Copilot ignores it and reads a steady clock, and fsc-editor adds it up [12] [13].
  If it's simulation time, a clock built from it stops in pause and runs fast at a raised simulation rate (unverified).
- Whether `Update_StandAlone` runs at the main menu and in pause is unmeasured; a forum post says it's "ALWAYS processed" (unverified) [14].
- `module_init` also runs "after sign-in" [1], so it may run twice in one sim process, and whether a module's globals start fresh the second time is unverified.

## The gauge API and its replacements

A module reaches variables and events through the gauge API in `Legacy/gauges.h`, which SDK 1.7.3 marks deprecated, and through its replacements, the Vars API in `MSFS_Vars.h` and the Event API in `MSFS_Events.h` [2] [20] [21].
Only the old API runs calculator code, and nothing in the new ones replaces that.

**How it works.**
The gauge API comes from FSX.
The SDK says it "still works for backward compatibility reasons" and that modules should move to the Vars and Event APIs [20].
In SDK 1.7.3 every one of its 56 functions carries a `[[deprecated]]` attribute: 33, including `execute_calculator_code`, read "Panels API is now deprecated", and 23 read "Use MSFS_Event.h and MSFS_Vars.h instead" [2].
So the compiler flags each old call, and that's how fsc-editor learned `get_name_of_named_variable` was deprecated [22].

| Task | Gauge API | Vars and Event APIs | Our modules |
| --- | --- | --- | --- |
| Read or write an `L:` | `register_named_variable`, then `get_named_variable_value` and `set_named_variable_value` | `fsVarsGetLVarId` or `fsVarsRegisterLVar`, then `fsVarsLVarGet` and `fsVarsLVarSet` | fsc-editor reads every `L:` with `fsVarsLVarGet` [13] |
| List `L:` names | `get_name_of_named_variable(id)`, which returns null past the end | `fsVarsGetLVarName(id, buffer, size)`, which returns an error past the end | fsc-editor walks with the new call [13] |
| Fire a key event | `trigger_key_event`, `trigger_key_event_EX1` | `fsEventsTriggerKeyEvent(id, params)` | FS Copilot's module fires its freeze and axis events in calculator code [12] |
| Hear key events | `register_key_event_handler_EX1` | `fsEventsRegisterKeyEventHandler` | Neither |
| Fire an `H:` event | Only through calculator code | `fsEventsHEventCall` | FS Copilot's module fires them in calculator code [12] |
| Run calculator code | `execute_calculator_code(code, &f, &i, &s)` | None | Both [12] [13] |

The two `L:` walks agree.
With the PA-24 loaded, both stopped after 5,364 names, the same names at the same IDs, the old call by returning a null name and the new one by returning error 0x4 [22].
The typed calls, their units, and what a missing name returns are in [03-01](03-01-units-and-variables.md#l-and-z-local-variables) and [03-03](03-03-reading-and-writing.md#enumerating-vs-observing).

`execute_calculator_code` runs a string in the sim's calculator, returns a `BOOL`, and hands back the result as a float, an integer, and a string [2].
The `BOOL` says the code parsed, not that it did anything ([03-03](03-03-reading-and-writing.md#rpn-calculator-code)).
FS Copilot's module makes every write to the aircraft this way.
Every frame, one call writes 13 variables of the other machine's position, attitude, and velocity, from a C format string that starts like this [12]:

```text
"%.12f (>A:PLANE LATITUDE, Radians) %.12f (>A:PLANE LONGITUDE, Radians) %.3f (>A:PLANE ALTITUDE, Feet) ..."
```

The Event API takes a numeric event ID, and the SDK defines the IDs as constants in `Types/MSFS_EventsEnum.h`, such as `KEY_FLAPS_SET`, `(KEY_ID_MIN + 162)` [21].
`MSFS_Events.h` declares no call that turns a name into an ID [21].
So a module handed an event name at run time keeps its own table, runs `(>K:FLAPS_SET)` as calculator code, or maps the name through SimConnect ([04-02](04-02-events.md#client-events)).

**What it changes for Dual Input.**
A Dual Input module needs calculator code for anything named at run time, such as a `B:` or `H:` write that an aircraft profile names.
The one call that runs it is deprecated in SDK 1.7.3 with no replacement, and it still worked on MSFS 2024 on 2026-08-25 [23].

**Traps.**

- The old and new `L:` reads can return different numbers for one variable, because only the new one converts units ([03-01](03-01-units-and-variables.md#l-and-z-local-variables)).
- The SDK's gauge API page names replacements, such as `fsVarsAircraftVarGet` and `fsVarsGetRegisteredNamedVarId`, that the 1.7.3 header marks deprecated in turn, in favor of `fsVarsAVarGet` and `fsVarsGetLVarId` [20] [21].
  We trust the header.
- A typed lookup that misses returns −1 for `L:` and `Z:`, and 0 for `A:` and `E:` [17] [21].
  Unit ID 0 is a real unit, meters, and the value for no unit is `FS_INVALID_UNIT`, −1 [17] [21].
- Events a module fires may skip the aircraft's own interception: an Asobo developer wrote, about MSFS 2020, that `trigger_key_event` and `execute_calculator_code` "bypass JS and Input Event interception" ([04-02](04-02-events.md#client-events)).

## Sources

1. Documented: MSFS 2024 SDK, [WebAssembly](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/WASM/WebAssembly.htm), sections "Upgrade a WebAssembly module from MSFS 2020 to MSFS 2024", "WebAssembly Modules Usage", "File Access", and "Known Issues and Limitations".
2. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/Legacy/gauges.h`: the declarations and their `[[deprecated]]` attributes.
3. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `WASM/wasi-sysroot/share/wasm32-wasi/defined-symbols.txt`, which has `send` and `recv` and no `socket`, `connect`, `bind`, `listen`, or `accept`, and `undefined-symbols.txt`, whose only socket imports are `sock_recv`, `sock_send`, and `sock_shutdown`.
4. Measured on our development machine, a Steam install, on 2026-09-27: the Community folder, where `fscopilot-bridge` 1.2.0 and `fsc-editor-link` 0.7.0 each hold one module under `modules`; and the import section of fsc-editor's committed module at 4cbf8ab, `link/Packages/fsc-editor-link/modules/fsc-editor-link.wasm`, which is byte for byte the installed copy.
5. Documented: MSFS 2024 SDK, [Creating WASM Gauges](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/WASM/Creating_WASM_Gauges.htm).
6. Documented: MSFS 2024 SDK, [Creating WASM Systems](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/WASM/Creating_WASM_Systems.htm), including "WebAssembly System Module Constraints".
7. Documented, read from the installed package: iniBuilds L-1011 (`inibuilds-aircraft-l1011` 1.0.8) in the Community folder of our development machine, 2026-09-27, `SimObjects/Airplanes/inibuilds-l1011/common/config/systems.cfg`, sections `[WASM_SYSTEM.0]` and `[WASM_SYSTEM.1]`.
8. Documented: MSFS 2024 SDK, [Network API](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/WASM/Network_API/Network_API.htm).
9. Measured on our development machine, a Steam install, on 2026-09-27: `%APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2024\`, where the folders for `fscopilot-bridge`, `fsc-editor-link`, and `synaptic-aircraft-a220` each hold a compiled `m<hash>_0.dll` and a `work` folder, empty for the first two and holding `synaptic.s3db` for the A220.
10. Documented in our record, read from the aircraft's files: fsc-editor, `docs/aircraft/synaptic-a220.md`, section "Rust module map (from panic paths in `systems.wasm`)".
11. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_IO.h`, the comment on `FsIOErr_AccessNotAllowed`; and MSFS 2024 SDK, [IO API](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/WASM/IO_API/IO_API.htm).
12. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge.Wasm/wasm_module.cpp` (`module_init`, `Update_StandAlone`, `dispatch`, `apply_physics`, and `apply_control`) and `FsCopilotWasm.vcxproj`.
13. Documented, read from source: fsc-editor at 4cbf8ab, `link/src/module.cpp`, including the comment in the `start` branch of `dispatch` that records the blank-lines report, and `link/fsc-editor-link.vcxproj`.
14. Unverified, forum: MSFS DevSupport, [Standalone WASM Module Update Callback](https://devsupport.flightsimulator.com/t/standalone-wasm-module-update-callback/12497), about MSFS 2024, 2024-12 to 2025-05, with the signature and the "ALWAYS processed" post.
15. Unverified, forum: MSFS DevSupport, [Update_StandAlone and when it gets executed](https://devsupport.flightsimulator.com/t/update-standalone-and-when-it-gets-executed/15196), the reply from an Asobo developer on 2025-08-25.
16. Measured on MSFS 2024, 2026-08-27: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-27 — Protocol 4 verified in the sim; Z: resolve-does-not-create is signal".
17. Measured on MSFS 2024, 2026-08-27: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-27 — The typed variable API works, and the sim announces invalidation".
18. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Connection/SimClient.cs`, the constructor's 200ms interval that writes `FSC_CONTROL`.
19. Documented, read from source: fsc-editor at 4cbf8ab, `link/tools/check.mjs`, `LIFECYCLE`.
20. Documented: MSFS 2024 SDK, [Gauge API](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/WASM/Gauge_API/Gauge_API.htm).
21. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_Events.h`, `MSFS_Vars.h`, and `Types/MSFS_EventsEnum.h`.
22. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — `get_name_of_named_variable` is deprecated. MSFS 2024 has a better `L:` API." and "2026-08-23 — Stage 2a COMPLETE. All five questions pass; `L:` is reachable."
23. Measured on MSFS 2024, 2026-08-25: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-25 — The wire runs calculator code, and `gauges.h` came back clean".
24. Documented, read from the installed package `inibuilds-aircraft-a380` 1.0.0 on 2026-09-29: the header and index of each `.fsarchive` file, where `html_ui\html_ui.fsarchive` and `minimal.fsarchive` say `notEncrypted` and list the files they hold, and the other five are encrypted.
25. Documented, read from the installed package `fsreborn-aircraft-phenom300e` 1.0.24 on 2026-09-29: the header and index of each `.fsarchive` file, where `html_ui\html_ui.fsarchive` and `minimal.fsarchive` say `notEncrypted` and list the files they hold, and the other five are encrypted.
26. Measured on MSFS 2024 SunRise 12.2.282174.999, 2026-10-08: [architecture log](../../areas/architecture/log.md#2026-10-08-a-standalone-module-built-from-rust-with-cargo-msfs-and-packaged-by-our-own-script-runs-on-msfs-2024-and-trades-data-slots-with-a-simconnect-client-once-its-simconnect-handle-is-64-bits-wide), "A standalone module built from Rust with cargo-msfs, and packaged by our own script, runs on MSFS 2024 and trades data slots with a SimConnect client, once its SimConnect handle is 64 bits wide", with the output in `experiments/areas/architecture/results/p03-rust-module-2026-10-08-17-44-49.txt`, which doesn't record the package's layout; the layout is in the log and in the header comment of `experiments/areas/architecture/module/build.mjs`.

## Unverified claims

- **When `Update_StandAlone` runs, and what `dTime` measures.**
  The SDK doesn't name the callback, and only forum posts place it in the frame or say it always runs [14] [15].
  A module that logs each call's `dTime` and a steady-clock time, through the main menu, a flight, a pause, and a simulation rate of 4, would settle both.
- **Whether a module's globals start fresh when `module_init` runs again after a sign-in.**
  Signing out and back in with a module that reports a counter it increments in `module_init` would settle it.
- **Whether the sim runs a second standalone module in one package.**
  A run with the cargo-msfs build and the `MSFS_WasmVersions.a` build the sim refuses in one package ran only the first, which doesn't separate the order from the refusal [26].
  Putting the cargo-msfs build and the build with the `StackSizesSection` removed in one package, and reading both frame counters, would settle it.
- **Whether an `https` request from a module can reach a local app.**
  Calling `fsNetworkHttpRequestGet` on `https://localhost` with a self-signed certificate would settle it.
