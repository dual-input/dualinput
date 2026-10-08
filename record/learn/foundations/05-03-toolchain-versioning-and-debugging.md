# WASM modules: toolchain, versioning, and debugging

- [Toolchain: SDK, platform toolset, fspackagetool, the Project Editor](#toolchain-sdk-platform-toolset-fspackagetool-the-project-editor)
- [Protocol versioning between the app and the module; packed structs](#protocol-versioning-between-the-app-and-the-module-packed-structs)
- [Debugging, crashes, required exports](#debugging-crashes-required-exports)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Module kinds, the lifecycle, and the gauge API are in [05-01-kinds-lifecycle-and-apis](05-01-kinds-lifecycle-and-apis.md), and SimConnect and the CommBus from inside a module are in [05-02-simconnect-and-the-commbus](05-02-simconnect-and-the-commbus.md).

## Toolchain: SDK, platform toolset, fspackagetool, the Project Editor

A module is built by MSBuild with the SDK's `MSFS2024` platform toolset, which drives Asobo's build of clang to produce a `.wasm` file [1] [2] [3].
`fspackagetool` or the Project Editor then packages it into a Community package that holds the module under `modules` [3] [4] [5].
The sim converts the `.wasm` to native code itself, as a DLL, when it loads the module [8] [9].

**How it works.**
fsc-editor's build script runs the whole pipeline in about 17s with the sim closed [3] [6]:

```text
MSBuild fsc-editor-link.vcxproj -p:Configuration=Release -p:Platform=MSFS
    → PackageSources\Modules\fsc-editor-link.wasm
node tools/check.mjs <wasm>         fail unless the exports the sim needs are there
node tools/version.mjs sync         set the package's version to the module's
fspackagetool link.xml -nopause     → Packages\fsc-editor-link\, with manifest.json and modules\
node tools/layout.mjs <package>     write the layout.json fspackagetool left out
copy the package to Community       then restart the sim
```

The project file names a source file and an output folder, and inherits everything else from the toolset [3]:

| Setting | Value | Why |
| --- | --- | --- |
| `Platform`, `PlatformToolset` | `MSFS`, `MSFS2024` | Selects the SDK's toolset, whose MSBuild files are in the SDK's `WASM\vs\2022` [2] |
| `TargetExt` | `.wasm` | The output is a WebAssembly module |
| `NoEntryPoint` | `true` | The sim calls `module_init`, and nothing calls a program's usual entry point, `_start` |
| `IncludePath` | `$(MSFS_IncludePath)` | The toolset sets it to the WASI system headers, `WASM\include`, and `SimConnect SDK\include` [2] |

FS Copilot's project has the same shape, with a Debug configuration as well, and a post-build step that copies the module to `FsCopilot.Bridge\PackageSources\Modules\FsCopilot.wasm` [4].

The toolset's link line adds what a module needs beyond its compiled code [2].
It exports the allocator the sim calls into, from `--export malloc` to `--export mark_decommit_pages`.
It links `MSFS_WasmVersions.a`, which the SDK says marks the module as an MSFS 2024 module ([05-02](05-02-simconnect-and-the-commbus.md#simconnect-from-inside-a-module)), and exports `GetSimConnectVersion`.
A Rust module built with neither was compiled into `WASM\MSFS2024` and ran, so the file doesn't decide that folder [23], and what does is unverified.
Under the toolset are `clang-cl` 15.0.1, built from Asobo's `innative-llvm` repository, and `wasm-ld`, targeting `wasm32-unknown-wasi` [2] [7].
fsc-editor drove those two tools straight from a shell, and its module linked and then didn't run in the sim, because it lacked the allocator exports ([Debugging, crashes, required exports](#debugging-crashes-required-exports)) [7] [15].

The toolset isn't the only way to a module the sim runs.
Navigraph's cargo-msfs v1.1.0 builds a Rust crate for MSFS 2024: it installed its SDK by downloading `MSFS2024_SDK_Core_Installer_1.8.1.zip` (622.5 MB) from `sdk.flightsimulator.com` and unpacking 1.6 GB of it without running the installer, in about 7 minutes, and each build afterward took about 1s [23].
Our probe module exported the eight functions in [Debugging](#debugging-crashes-required-exports) and the three the sim calls on a standalone module, and lacked the toolset's `GetSimConnectVersion` export and its custom sections [23].
Our own script wrote the package's `manifest.json` and `layout.json`, `fspackagetool` didn't run, and on MSFS 2024 SunRise 12.2.282174.999 the sim compiled the module into `WASM\MSFS2024`, ran its `Update_StandAlone` 136 times a second at the main menu, and let it exchange client data areas with a SimConnect client, once its SimConnect handle was declared 64 bits wide ([05-02](05-02-simconnect-and-the-commbus.md#simconnect-from-inside-a-module)) [23].

Packaging reads two XML files.
The project file lists package definitions, and each package definition lists asset groups; both our packages have a group of type `Copy` from `PackageSources\Modules\` to `modules\` [3] [4].
Two tools read them:

- **The Project Editor**, a Developer Mode window ([02-03](02-03-the-running-sim.md#developer-mode-tools)).
  FS Copilot's build notes say to open `fs-copilot.xml` there and choose Build and Mount, which mounts the package into the running sim [4].
- **`fspackagetool`**, in `<SDK>\Tools\bin`, which takes the project file on the command line and runs the game's own executable, `FlightSimulator2024.exe`, to do the build [5].

The sim doesn't interpret a module: the SDK says modules are "converted to native code ahead of time (as DLLs)" [8].
On our Steam machine each compiled module sits in `%APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2024\<package>\` as `m<hash>_0.dll`, beside a `.pdb` and the module's `work` folder [9].
That folder holds 32 packages, and a sibling, `WASM\MSFS2020\`, holds 27 more, which we take to be the modules the sim treats as MSFS 2020 builds (unverified) [9].

**What it changes for Crosscheck.**
Built with the SDK's toolset and packaged by `fspackagetool`, Crosscheck's module needs Visual Studio, the SDK, and MSFS on one machine, because the tool runs the game and fsc-editor's record says the SDK has no unattended install, so fsc-editor commits the built package, and its CI compares a hash of the module's sources with the hash the build recorded [3] [10].
Built from Rust with cargo-msfs and packaged by our own script, the module needed no game and no interactive install [23].
Nobody has built it on a hosted build server (unverified).

**Traps.**

- `fspackagetool` hangs, rather than failing, while the sim is running [6].
- In fsc-editor's runs, `fspackagetool` wrote no `layout.json` and reported no error, and a package without one doesn't load ([02-01](02-01-installs-and-packages.md#packages-and-the-virtual-file-system)) [6].
- With both the Store and Steam versions installed, `fspackagetool` builds with the Store version unless given `-forcesteam` [5].
- FS Copilot's `CMakeLists.txt` names source files that don't exist, such as `FsCopilotWasm.cpp`, so only its `.vcxproj` builds the module [4].

## Protocol versioning between the app and the module; packed structs

The app and the module are two builds that update apart: the app through its installer, and the module through a Community folder the sim reads only at startup ([02-01](02-01-installs-and-packages.md#packages-and-the-virtual-file-system)).
So a newer app can meet an older module for a whole session, and each of our modules announces a version that its app checks.
A struct that crosses a client data area needs the same bytes in both languages, which the C++ side gets from `#pragma pack(1)`.

**How it works.**
FS Copilot checks for equality.
Its module writes `"1.2"` into the `FSC_READY` area in `module_init`, and the app reads that area once a second and compares it with its own `"1.2"`, reporting a mismatch when they differ [11].
Its record notes that widening the 512-byte message strings would be "an ABI change and needs a version bump on both `k_version` and `WasmVersion`" [12].

fsc-editor keeps a protocol number apart from the version.
The module's hello carries both, such as `0.7.0 6`, and the app compares the protocol with its own `LINK_PROTOCOL`, 6 [13]:

- A lower number marks the module outdated, and the app offers to reinstall it.
- A feature waits for its own number: the app ignores the module's answers about unresolved variables below `RESOLUTION_PROTOCOL`, because modules before protocol 6 called a variable absent before they had looked it up.

The number exists because an old module ignores a command it doesn't know, without replying, so an app that sent it would wait for an answer that never comes [13].
The protocol went from 1 to 6 in the week from 2026-08-23 to 2026-08-30, each step adding a command or a field, from `exec` in 2 to a three-state resolution in 6 [13].
fsc-editor's CI fails a change where `LINK_PROTOCOL` in the app and `k_protocol` in the module differ [10].

For structs, FS Copilot's `protocol.h` shows the pattern.
Here is the control surfaces message, one of five structs inside the same `#pragma pack` block, shown on its own with its size check [11]:

```cpp
#pragma pack(push, 1)
struct surfaces
{
    int32_t  ail_pos;
    int32_t  elev_pos;
    int32_t  rud_pos;
    uint64_t session_id;
    uint32_t time_ms;
};
#pragma pack(pop)

static_assert(sizeof(surfaces) == 24);
```

Without `pack(1)`, the compiler would align `session_id` to 8 bytes, moving it from offset 12 to 16, and pad the struct to 32 bytes.
The C# twin declares the same fields in the same order with `[StructLayout(LayoutKind.Sequential, Pack = 1)]`, and a fixed string such as `char msg[512]` becomes `[MarshalAs(UnmanagedType.ByValTStr, SizeConst = 512)]` [11].

Nothing checks one side against the other, and FS Copilot's `FSC_EXE` area shows why that matters.
Its app creates and writes the area as a 512-byte string, and its module creates and defines it at `sizeof(var_set)`, 200 bytes, a size left from when the area was `FSC_SET` and carried a `var_set` [11].
What size the area ends up with, and what happens to calculator code longer than 199 characters, is unmeasured.

**What it changes for Crosscheck.**
Crosscheck needs a version handshake in its first release, because the first module installed is the one every later app will meet.
Every struct it passes between languages needs one definition both sides are checked against, by a test or a generated file.

**Traps.**

- An equality check can't tell an older module from a newer one, so FS Copilot's app can say only that they differ [11].
- A version number nothing reads drifts: fsc-editor's package version sat at 0.0.1 while its module's reached 0.3.0, until the build derived one from the other [14].
- fsc-editor's installer decides a module is stale by hashing it, not by its version, so a rebuilt module replaces the old one whether or not anyone changed a number [10].
- fsc-editor's wire format is written twice, in TypeScript and C++, and only a test notices when they drift [3].

## Debugging, crashes, required exports

A broken module usually fails where nobody sees it: it builds, installs, and registers, and then doesn't run [15].
Developer Mode's WASM Debug window shows each module's status, and Visual Studio can attach to the sim to step through a debug build [18] [19].
The module has to export the allocator functions the sim calls, which the toolset's link line adds [2] [15].

**How it works.**
fsc-editor's first three builds drove clang and `wasm-ld` by hand, and each failed in the sim for a different reason, none of them in the C++: a quoted `date` in `layout.json`, two missing manifest fields, then eight missing exports [15] [16].
The first two are in [02-01](02-01-installs-and-packages.md#packages-and-the-virtual-file-system).
The third built, installed, and appeared in the WASM Debug window among 18 standalone modules, with `Status: FAILED` and "The module is not scheduled" [15].
Comparing it with FS Copilot's working module showed eight exports missing: `malloc`, `free`, `mallinfo`, `mchunkit_begin`, `mchunkit_next`, `get_pages_state`, `mark_decommit_pages`, and `__wasm_call_ctors`, which the sim calls to manage the module's memory and to construct its globals [15] [19].
fsc-editor moved the build to the toolset, whose link line exports all eight, and added a check that fails the build when one is missing [3] [15].

The WASM Debug window, on the Debug menu, lists the registered modules and gives each a status [18]:

| Status | Meaning |
| --- | --- |
| `COMPILING` | The sim is converting the `.wasm` to a DLL |
| `INITIALISING` | The DLL is loading |
| `READY` | The module runs |
| `FAILED` | The conversion to a DLL failed, and the console says why |
| `DIRTY` | The module was ready, then its code hit an error, and the sim no longer runs it |

The window also graphs each module's time per update and its memory, and a module whose code writes to address 0 gets flagged there: WebAssembly lets a program use address 0, so a null-pointer write succeeds instead of crashing [18].

The SDK's debugging page covers two more failures, and stepping through code [19]:

- `WASM: ERR_VALIDATION_ERROR (-4095 / fffff001)` in the console means the module imports a function the sim doesn't have.
  A function declared and never defined builds without error, because the toolset turns it into an import, and fails only when the sim compiles the module.
- `0xC0000005` is an access violation, and `_innative_internal_env_chkstk` at the top of the call stack means a stack overflow, from a function that used at least 65,536 bytes of stack.
- To step through code, you build the Debug configuration, attach Visual Studio to the running sim with the SDK's WASM debugger extension, and load a flight; symbols exist only in a Debug build.

A module can also say for itself whether it runs.
fsc-editor's module leaves a hello in its output area in `module_init`, and fsc-editor's command-line reader reads that area once before subscribing, so three failures that all looked like silence become three answers [16] [21]:

| The reader sees | Meaning |
| --- | --- |
| No area, and an exception | No module ran |
| A hello, and nothing after it | The module loaded, and `Update_StandAlone` never ticks |
| A hello, names, and values | It works |

On crashes, the SDK recommends apps outside the sim over modules partly because an app that crashes "typically will not crash" the sim [20], and a module whose code errors goes `DIRTY` and stops being run [18].
Our records hold no module crash.

**What it changes for Crosscheck.**
A pilot won't have Developer Mode, so Crosscheck's app has to tell "no module", "module loaded but silent", and "module working" apart itself, and tell the pilot which.
Its build has to check the required exports before a package ships, where a mistake costs seconds instead of a sim restart.

**Traps.**

- The eight exports may be required only of modules the sim treats as MSFS 2024 builds.
  MobiFlight's Event Module, installed on our machine, lacks five of them, and the sim compiled it into a DLL under `WASM\MSFS2020\` anyway; whether that module runs is unverified [17].
- Linking `MSFS_WasmVersions.a` with Rust's linker brought along a `StackSizesSection`, and the sim refused the module: the WASM Debug window showed `FAILED` and "The module is not scheduled" (seen in the window by the user, 2026-10-08), and the sim compiled no DLL [23].
  Removing the section fixed it [23].
  The log says the section covers only that object's three functions, which no saved output shows (unverified).
  The toolset-built module of fsc-editor carries a `StackSizesSection` [23] and runs [21], so the section's presence alone isn't what the sim refuses.
- The WASM Debug window flagged the build types of the Rust modules cargo-msfs built, and of our C++ probe module built with the SDK's toolset, as "Incoherent build types" beside `READY` (seen in the window by the user, 2026-10-08) [23].
  The SDK says a Debug DLL build type means WASM Debug Mode is enabled, and that the WASM and DLL build types should be the same [18].
  We haven't checked that setting (unverified), but the flag appeared for both toolchains, so it doesn't point at either.
- The SDK's debugging page says to attach to `Microsoft Flight Simulator.exe`, and the MSFS 2024 executable is `FlightSimulator2024.exe` [5] [19].
- C++ exceptions aren't supported, and the toolset compiles with `-fno-exceptions`, so code with `try` or `throw` doesn't build [2] [8].
- Where a module's `printf` output appears is unverified: FS Copilot's module logs with `fprintf(stdout, ...)`, and the SDK's console page names no WASM group [11] [22].

## Sources

1. Documented: MSFS 2024 SDK, [Creating A WASM Project](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/WASM/Creating_A_WASM_Project.htm).
2. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `WASM/vs/2022/Microsoft.Cpp.MSFS.Common.targets`, the compile options and the link line, and `Microsoft.Cpp.MSFS.Common.props`, `MSFS_IncludePath`; and `WASM/llvm/bin/clang-cl.exe --version`.
3. Documented, read from source: fsc-editor at 4cbf8ab, `link/build.sh`, `link/fsc-editor-link.vcxproj`, `link/link.xml`, `link/PackageDefinitions/fsc-editor-link.xml`, `link/tools/check.mjs`, and `link/README.md`.
4. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge.Wasm/FsCopilotWasm.vcxproj` and `CMakeLists.txt`, and `FsCopilot.Bridge/fs-copilot.xml`, `PackageDefinitions/fscopilot-bridge.xml`, and `readme.md`.
5. Documented: MSFS 2024 SDK, [The Package Tool](https://docs.flightsimulator.com/msfs2024/html/8_SDK_Tools/Package_Tool/Package_Tool.htm).
6. Measured on 2026-08-23, with the sim open and closed: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — The module becomes a sub-project, and fspackagetool cannot run with the sim open" and "2026-08-23 — fspackagetool runs in seconds, and does not write layout.json".
7. Measured on 2026-08-23, without the sim: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — A `.wasm` module builds from the SDK alone. No Visual Studio."
8. Documented: MSFS 2024 SDK, [WebAssembly](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/WASM/WebAssembly.htm), sections "WebAssembly (WASM)" and "Known Issues and Limitations".
9. Measured on our development machine, a Steam install, on 2026-09-27: `%APPDATA%\Microsoft Flight Simulator 2024\WASM\`, with 32 package folders under `MSFS2024` and 27 under `MSFS2020`.
10. Documented in our record: fsc-editor, `docs/pipeline/08-module.md`, sections "Why it is committed", "The three guards", and "Three things about step 3".
11. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge.Wasm/protocol.h` and `wasm_module.cpp` (`module_init` and `dispatch`), `FsCopilot/Connection/SimClient.cs` (`WasmVersion`, the constructor, `RegisterClientStruct`, `StrMsg`, and `VarMsg`), and `FsCopilot/Simulation/Surfaces.cs`; and the history of `wasm_module.cpp`, where commit 38b6368 renamed `FSC_SET` to `FSC_EXE` and kept its size.
12. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/04-transport.md`, section "Widening it".
13. Documented, read from source: fsc-editor at 4cbf8ab, `src/shared/link.ts` (`LINK_PROTOCOL`, its table of versions, and `RESOLUTION_PROTOCOL`), `src/main/sim/link.ts` (`outdated` and `watchResolution`), and `link/src/module.cpp`, the comment on `k_protocol`; the dates of protocols 1 and 6 are from `docs/sim-vars/build/v1-log.md`, "2026-08-23 — The module streams, and a second client got no enumeration" and "2026-08-30 — Protocol 5 called every fresh ref absent, and nobody could have seen it".
14. Documented in our record: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-27 — Two version numbers, one of which nobody had a reason to touch".
15. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — The module must export MSFS's allocator. Hand-driving clang was the wrong call."
16. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — First 2a attempt: the module did not load".
17. Measured on our development machine on 2026-09-27, without the sim: fsc-editor's `link/tools/check.mjs` run against the installed `mobiflight-event-module` 1.0.1, whose manifest has no `builder` field and asks for game version 1.36.2, reporting `mallinfo`, `mchunkit_begin`, `mchunkit_next`, `get_pages_state`, `mark_decommit_pages`, `GetSimConnectVersion`, and `Update_StandAlone` missing; and its compiled DLL in `%APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2020\mobiflight-event-module\`, dated 2026-09-19.
18. Documented: MSFS 2024 SDK, [WASM Debug](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Debug/WASM_Debug.htm).
19. Documented: MSFS 2024 SDK, [Debugging WebAssembly Modules](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/WASM/Debugging_WASM.htm).
20. Documented: MSFS 2024 SDK, [SimConnect SDK](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/SimConnect_SDK.htm), section "Design Considerations".
21. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — Stage 2a COMPLETE. All five questions pass; `L:` is reachable.", where the hello answered "did it load" apart from "does it work".
22. Documented: MSFS 2024 SDK, [The Console](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Debug/The_Console.htm).
23. Measured on MSFS 2024 SunRise 12.2.282174.999, 2026-10-08: [architecture log](../../areas/architecture/log.md#2026-10-08-a-standalone-module-built-from-rust-with-cargo-msfs-and-packaged-by-our-own-script-runs-on-msfs-2024-and-trades-data-slots-with-a-simconnect-client-once-its-simconnect-handle-is-64-bits-wide), "A standalone module built from Rust with cargo-msfs, and packaged by our own script, runs on MSFS 2024 and trades data slots with a SimConnect client, once its SimConnect handle is 64 bits wide", with the output in `experiments/areas/architecture/results/p03-rust-module-2026-10-08-17-44-49.txt`, `-17-54-02.txt`, `-17-59-24.txt`, and `-18-04-12.txt`, and `p03-build-2026-10-08-18-05-07.txt`, and, for the manifest, `experiments/areas/architecture/module/build.mjs`, `writePackage`.
    The log alone gives the SDK download's name, size, and time, the build time, and the Binaryen compile, and the user's reading of the WASM Debug window; no output of them was saved.

## Unverified claims

- **What happens to FS Copilot's `FSC_EXE` messages.**
  The module sizes the area at 200 bytes and the app at 512 [11].
  Sending a 300-character calculator expression from the app, with the module loaded first, and watching for an exception and for the expression's effect would settle it.
- **The allocator exports are required only of modules built for MSFS 2024, and `WASM\MSFS2020\` holds the modules the sim treats as MSFS 2020 builds.**
  Only fsc-editor's 2024 build is measured failing without the exports [15], and MobiFlight's module lacks them and was compiled anyway, into that folder [17].
  The WASM Debug window shows each module's status and whether it was compiled with the MSFS 2024 SDK or an earlier one [18], so checking MobiFlight's module there would settle both.
- **What decides whether the sim compiles a module into `WASM\MSFS2024` or `WASM\MSFS2020`.**
  Our Rust module, without `MSFS_WasmVersions.a`, went into `WASM\MSFS2024` [23], and MobiFlight's went into `WASM\MSFS2020` [17].
  Their manifests differ in the `builder` field, which ours sets to "Microsoft Flight Simulator 2024" and MobiFlight's lacks, and in `minimum_game_version`, ours 1.8.14 and MobiFlight's 1.36.2, and may differ in others [17] [23].
  Building the probe module again with one of those fields changed at a time, and reading where the sim compiles it, would settle it.
- **Whether a hosted build server can build and package the module.**
  The log says installing cargo-msfs compiled Binaryen's C++, with Visual Studio on the PC we used, and saved no output of it [23].
  Running the install and the build script on a clean hosted runner would settle it.
- **Where a module's `printf` output goes.**
  Loading FS Copilot's module with the Console open, and searching for its `Initialized` line, would settle it.
- **The Project Editor's Build and Mount reloads a changed standalone module in the running sim.**
  FS Copilot's build notes say the package is mounted and loaded at once [4], and nobody has checked that `module_deinit` and `module_init` run.
  Rebuilding a module whose hello carries a build number, and reading the hello, would settle it.
