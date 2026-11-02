# Architecture: the code map

```text
Purpose:     The units of Dual Input's code, which tier each is in, what each owns, its interface, and what it may depend on.
Depends on:  01-spine.md, decisions.md, log.md, ../network/01-between-machines.md, ../sync/04-order-and-recovery.md, ../session/01-roles-and-members.md, ../profiles/01-format-and-delivery.md, ../product/04-room-for-later.md
Decides:     The tiers, the tests that keep each unit apart, every unit with its folder and what it may depend on, and the systems node 6 designs (node 5); how the platform runs its features, and what a feature registers with it, calls, and guards (node 5.1); where the core's code meets the sim, so a stand-in and a replay can take the sim's place, and which SimConnect connections the core holds (node 5.2); how a feature adds work to our WASM module and the panel bridge, and how that work ends (node 5.3); where each unit lives, how one repository builds every target, and how CI checks the map (node 5.4).
```

> **Note**
> Stage 11b's tentative decisions change the desktop app's units, pending the apps' design (user, 2026-10-25): no feature has a section in the desktop app, so take-control's and go-to's `desktop/` folders become `efb/` ones ([one full window](../interface/decisions.md#dual-inputs-one-full-window-is-its-efb-app)); and `efb-shell` and `desktop-shell` draw with one kit of React components, styled with Tailwind 3, so `efb-shell`'s MSFS Avionics Framework, `desktop-shell`'s Tailwind 4, `src/apps/desktop`'s Vite entry, and [building every target](#building-every-target)'s Vite and Tailwind `@source` lines no longer hold ([the kit](../interface/decisions.md#the-apps-draw-with-a-kit-of-our-own-components-styled-with-tailwind-3); user, 2026-11-01).
> The banner's page draws with React and the kit and has no part API, so `efb-shell` holds the EFB app's frame and its part API alone, and the banner is a platform unit of its own outside the core, `src/platform/banner/` ([the banner](../interface/decisions.md#the-banner-draws-with-react-and-the-kit)).
> What the two draw of a crew, a pilot's head and Ready with its countdown, is a second package, `@dualinput/crew` in `src/packages/crew/`, since neither page's code may reach into the other's.
> `src/apps/desktop` is a Cargo workspace of its own, with its own `Cargo.lock`, so [the workspace](#the-workspace)'s one Cargo workspace holds every Rust crate but that one ([build log](../build/log.md#2026-11-01-tauri-in-the-root-workspace-gives-the-loops-crates-getrandom-so-the-desktop-app-is-a-cargo-workspace-of-its-own)).
> [The workspace](#the-workspace) gains `src/packages/`, for packages that are no tier's units, whose first is the kit, `@dualinput/ui` in `src/packages/ui/`, and a feature's EFB part may import it beside its shell and the messages' types ([the kit's package](../interface/decisions.md#the-kit-and-dual-inputs-palette-are-one-package-in-this-repository)).
> The Coherent GT check leaves `tools/` for its own repository, `dual-input/coherent-checks`, which Dual Input installs with npm ([build plan](../build/plan.md#11b-the-apps)).
> [The traffic and ATC switch](#the-traffic-and-atc-switch) becomes two switches, each writing its own feature's key, since [traffic and ATC audio are shared apart](../interface/decisions.md#traffic-and-atc-audio-are-shared-apart-each-by-a-switch-of-its-own) (user, 2026-10-31), so nothing sends the request that claims several keys together.
> In [what the bridge owns](#what-the-bridge-owns), a lock that turns into a warning keeps a lock's look, with a Dismiss on a card that takes presses while its veil passes them, and Dismiss reaches every panel by the CommBus event `DUALINPUT_BRIDGE_DISMISS`, which joins [names the sim shares](#names-the-sim-shares) under `BRIDGE` ([a visible lock](../interface/decisions.md#a-visible-lock-is-a-veil-over-the-display-with-one-centered-card); user, 2026-11-01).

Dual Input's code is a platform, engines, and features.
The core runs as one loop that owns all its state and takes every input, stamped, from one queue, and each feature plugs into that loop through one registration, so deleting a feature leaves everything else building and passing its tests (user, 2026-10-14).
A feature reads the platform's state, reaches other features only through moments the platform raises, and reaches the world only through outputs, and a feature that can block a request registers a guard rather than having the platform check on it.
The platform in the core is a kernel and a crate for each of its services, which the kernel never names, and every dependency points down the tiers ([the units](#the-units)).

This answers node 5 of the [architecture plan](plan.md#5-the-code-map), whose children settle its parts; the plan says which are settled.
The tentative decisions behind it start at [decisions.md](decisions.md#dual-inputs-code-is-a-platform-engines-and-features-and-deleting-a-features-crate-leaves-the-rest-whole).

## Tiers

| Tier | What it is | Examples |
| --- | --- | --- |
| Platform | The services every feature uses: in the core, and in the sim through the panel bridge and our WASM module, which load what features and plugins run there by name ([04-room-for-later](../product/04-room-for-later.md#code-inside-the-sim)) | The kernel, the session and its keys, control, channels, the cockpit stream, catch-up, the client protocol, settings, notifications, recording, the sim service, the routine host, the panel bridge, the apps' shells |
| Engines | Libraries that know nothing of the app, so another program can link them, such as the [Dual Input IDE](../product/ideas.md#dual-input-ide) | The message crate, the profile engine, the sync engine, the sandbox, the transport, the recording format, the sim client, sim awareness, the sim edge, the stand-in sim |
| Features | Each one thing a pilot gets | Pointer sync, avatars, traffic, ATC audio, the take-control key, rate and pause, Go to, which points the world map at the PF's spot |

Three tests stand in for a definition of clean, because a definition in prose invites an agent to enforce it where it doesn't fit (user, 2026-10-14):

- Deleting a feature leaves everything else building and passing its tests: its crate, its one registration, its module in the message crate and its module in the profile engine (below), its routines in our WASM module with their line in the module's list, its files for the panel bridge ([work in the sim](#work-in-the-sim)), and its section in each app, all of which [the workspace](#the-workspace) keeps in one folder.
- An engine builds and runs outside the core.
- CI checks each crate's dependencies against the ones this map allows, and each TypeScript folder's imports too ([the map check](#the-map-check)).

The map allows these, and [the map check](#the-map-check) holds each:

- Dependencies point down the tiers: a feature depends on the platform and the engines, the platform on the engines, and an engine on no platform, feature, app, or tool code.
- Within the platform in the core, and within the engines, a crate depends only on the lines below its own in [the units](#the-units)' picture.
- The platform outside the core depends on no crate of the core's, nor the core's on it, and the routine host depends on the message crate alone.
- No feature depends on another feature's code, nor names another feature's module in the message crate or the profile engine ([what a handler sees and does](#what-a-handler-sees-and-does)).
- Of our code, a feature's routines depend only on the message crate, the routine host, and an engine that keeps the loop's rules and builds for wasm32, such as `object-mirror` ([work in the sim](#work-in-the-sim)); its panel modules on the panel bridge and the message crate's types; and its sections on its app's shell and the message crate's types.
- Nothing depends on `src/apps/`, `src/sim-package/`, or `tools/`, except that the bench build of `src/apps/core` links `src/sim-package/routines/`, the module's list of routines ([our WASM module](../build/02-testing.md#our-wasm-module)).
- The loop's crates, every crate outside `src/apps/`, `src/sim-package/`, `tools/`, the transport, the sim edge, and the stand-in sim, keep [the loop's rules](#one-loop), and depend on neither tokio nor any crate on the map check's list of crates that do I/O.
  The stand-in sim keeps the sim edge's rules instead, since it runs where the edge runs, off the loop with a clock of its own, and its inputs are stamped and recorded like the edge's ([its rules](../build/02-testing.md#its-rules)).
- Only the two edges, the sim edge and our WASM module's in `src/sim-package/wasm-module/`, and `src/apps/core` declare foreign functions, so only the edges call `SimConnect.dll` and the sim's APIs ([the sim seam](#the-sim-seam)); `src/apps/core` declares one, the C runtime's `_set_FMA3_enable` ([the core's math](../core/01-loop-and-edge.md#the-cores-math)).

A system is the units one design doc designs, in one area, and [node 6](plan.md#6-systems) of the plan designs each of [the systems](#systems).
Each contract is defined once and linked or generated wherever it's used: a feature's messages stay in the message crate of [decision 025](../../decisions/025-messages-in-one-rust-crate.md), and its profile block, such as pointer sync's `displays`, stays in the profile engine, which the core, CI, and the IDE share ([01-format-and-delivery](../profiles/01-format-and-delivery.md#what-fails-a-load)), so deleting a feature deletes its module in the message crate and its module in the profile engine too (user, 2026-10-14).

## The units

Each unit is a folder in its tier's folder, named as in the picture below; the picture's tier folders sit in `src/`, except `tools/`, which sits at the root.
The tables say what each owns and what it uses; the map check holds [the rules in tiers](#tiers), not these columns, so CI passes a dependency a table doesn't list when the rules allow it.
`src/apps/` holds the programs on the pilot's PC, `src/sim-package/` what the sim loads from our Community package, and `tools/` what builds, checks, and tests them (user, 2026-10-15).

```text
apps/         core  core-helper  desktop  ide (later)
sim-package/  wasm-module  routines  pages
tools/        profile-builder  profile-author  bench (node 7)  build.ts  setup.ts  the map check
features/     state-sync  pointer-sync  flight-model  avatars  traffic
              atc-audio  take-control  voice (Soon)  rate-and-pause  go-to
platform/     in the core                                          outside the core
                                                                   routine-host
              profile-loader  cockpit-stream                       panel-bridge
              session                                              efb-shell  desktop-shell
              sim-service  network  core-helper-service  recording
              clients
              kernel
engines/      sync-engine  profile-build  sim-edge  stand-in-sim
              sandbox  profile-engine  recording-format  aircraft-model  sim-client  sim-awareness  transport  page-client
              messages  simconnect-types  msfs-gltf  msfs-rpn  ray-cast  object-mirror
```

The platform outside the core runs in our WASM module, in each cockpit panel, and in the two apps that take features' sections.
The platform is split this way, and named the platform rather than the host, because "the host" already names the pilot who starts a session ([invite code](../product/03-v1-scope.md#invite-code)), as "the traffic host" and "the ATC host" name pilots ([traffic sync](../product/03-v1-scope.md#traffic-sync), [hearing ATC](../product/03-v1-scope.md#hearing-atc)), and because a newcomer reads `src/platform/` as what the features are built on (user, 2026-10-15).

### Engines

| Unit | Owns | Uses, of ours |
| --- | --- | --- |
| messages | Every message between our components and between machines, each feature's module, the data slots' structs, the IDs, and the vector clock as data, with uuid's `v4` off, since the kernel draws each random ID from a seeded generator ([one loop](#one-loop)); also the transport's commands and events, since the network crate may not depend on the transport, which [the map check](#the-map-check) lists among the crates that do I/O ([02-units](../network/02-units.md#the-units)); its `ts/` folder holds the TypeScript types ts-rs generates | Nothing |
| simconnect-types | SimConnect's types and constants, which bindgen generates from the SDK's headers, while the sim edge declares its functions | Nothing |
| msfs-gltf | Reading an MSFS glTF and its buffer ([avatars](../avatars/01-avatars.md#the-units)) | Nothing |
| msfs-rpn | Expanding, compiling, and running the sim's calculator code ([avatars](../avatars/01-avatars.md#the-units)) | Nothing |
| ray-cast | A BVH for each mesh, and a cast through the nodes' transforms ([avatars](../avatars/01-avatars.md#the-units)) | Nothing |
| object-mirror | The gate and the playout, generic over the sample, which traffic and its routine `Traffic` use ([traffic and ATC](../traffic-atc/01-traffic-and-atc.md#the-units)) | Nothing |
| sandbox | QuickJS-ng's runtimes under [decision 046](../../decisions/046-sandbox-runtimes-and-limits.md)'s limits, with a time limit that counts QuickJS-ng's interrupt checks ([decision 047](../../decisions/047-sandbox-time-limit-counts-interrupt-checks.md)), giving a script no clock | Nothing |
| profile-engine | The profile format, its own blocks, `state` and `events`, each feature's block, its checker, and its levels; its `ts/` folder holds the declarations that profiles' scripts and plugins are checked against, which a level freezes with its schema | messages |
| recording-format | How the replay log is encoded, and nothing else, since v1 writes no self-describing record ([one loop](#one-loop)) | messages |
| aircraft-model | Reading an aircraft's glTF models and the behavior code that poses them, with `quick-xml`, and casting a ray into them, as [avatars' tentative decisions](../avatars/decisions.md#the-models-come-from-the-aircrafts-own-package) describe | msfs-gltf, msfs-rpn, ray-cast |
| sim-client | The [sim seam](#the-sim-seam)'s sim client | simconnect-types, messages |
| sim-awareness | Sim awareness's logic: one step function from a sim signal to the sim's state, with no clock and no I/O ([03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md#the-units)) | messages |
| sync-engine | The sync engine: watching and writing entries, shadow values, echoes, the conflict rule, read-back, write functions, the settle rule, the driven-entry test, putting back, and catch-up's order | profile-engine, sandbox, messages |
| profile-build | The builder, which type-checks and compiles with TypeScript 6.0.3 inside QuickJS-ng, for `tools/profile-builder` and later the IDE; the core links `profile-engine` alone ([the profiles' units](../profiles/02-units.md#the-units)) | profile-engine |
| transport | The connections between cores through iroh, as [01-between-machines](../network/01-between-machines.md#the-link-between-two-cores) has them | messages |
| sim-edge | The [sim seam](#the-sim-seam)'s edge, and SimConnect's function declarations | simconnect-types, sim-client |
| stand-in-sim | The bench's sim, which [testing](../build/02-testing.md#the-stand-in-sim) designs | simconnect-types, sim-client |
| page-client | In TypeScript, how a sim page reaches the core: finding it, its first message, a message every 2s ([decision 010](../../decisions/010-clients-message-core-every-2s.md)), and connecting again; the desktop app reaches the core from its Rust side instead ([01-spine](01-spine.md#messages-between-components)) | messages' `ts/` |

### The platform

| Unit | Owns | Raises | Uses, of ours |
| --- | --- | --- | --- |
| kernel | The loop, the registry, moments, requests and their guards, the outbox, timers, jobs, and the store of each unit's state | | messages |
| clients | The client protocol: each client's socket and first message, client state and commands, which panel modules each panel loads, lock renewals, settings, and notifications | A client joining or leaving, a panel's socket replaced, and a setting changed ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#the-moments-clients-raises-and-the-calls-it-takes)) | kernel |
| sim-service | The sim service, sim awareness, masking, the module's version and counter and the unfreeze, and the CommBus event that announces the core's port ([what the platform keeps](#what-the-platform-keeps)), and the world map's requests, which the menu script runs for whichever feature asks; aircraft awareness, the loaded aircraft's package, folder, install location, version, and livery, which a job of its own finds while a session is held, and which the session crate's match check and avatars read there ([03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md); user, 2026-10-18); and the packages folders, read from `UserCfg.opt` ([packages on disk](../core/03-sim-seam-and-wasm-module.md#packages-on-disk)) | `SimChanged`, for each change of the sim's state, a load among them, and `AircraftChanged` | kernel, clients, sim-client, sim-awareness |
| network | Each link's state, the channels, the heartbeat, clock offsets, coming back, the backend's invite codes, and the version check at join, at the backend and in each connection's first message ([02-units](../network/02-units.md#the-first-message)) | `LinkUp`, `LinkLost`, `MemberLeft`, `MemberOut`, and `BackendAnswered` ([moments](../network/02-units.md#moments)) | kernel, clients |
| core-helper-service | Starting the core helper and starting it again; the bindings, captures, and sounds features register with it, the next press, the mouse, and playback streams; the output device setting; and the slice of devices and programs ([04-core-helper](../core/04-core-helper.md#what-a-feature-registers-and-calls)); and phrases and the microphone setting with the voice phrases, a Soon pick | | kernel, clients |
| recording | The runs, which to keep, the slice of runs, and the commands to mark the moment and to delete a run; uploads and bug reports come after v1 ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#the-units)) | | kernel, clients, recording-format |
| session | Members, session keys, control, the session file, joining and leaving, preflight, the match check, and showing the backend's refusal at join | A session starting and ending, a member joining or leaving, a member entering or leaving the flight, a session key changing, control passing, and preflight ending | kernel, clients, sim-service, network |
| profile-loader | Fetching a profile's bundle by hash, the cache, loading it on the pilot's aircraft, and writing the bundle a session pins, as a session key the PF's core writes | The profile's load and unload | kernel, clients, sim-service, session, profile-engine |
| cockpit-stream | The cockpit stream, catch-up, the platform's guard that holds control back from a pilot whose catch-up or replay runs, and the slice that says whether either runs | "Cockpit sent" | kernel, clients, network, session |
| routine-host | Our WASM module's side of [work in the sim](#work-in-the-sim): `Routine`, wants, slots, `routines!`, the freeze, and the platform's own routine, `Hold` | | messages |
| panel-bridge | In TypeScript, [what the bridge owns](#what-the-bridge-owns), and loading panel modules | | page-client, messages' `ts/` |
| efb-shell | In TypeScript, the EFB app's frame, its session controls and preflight summary, the banner's page, and the API its sections use, on the MSFS Avionics Framework | | page-client, messages' `ts/` |
| desktop-shell | In TypeScript, the desktop app's frame, the session's view, settings, the report page, the API its sections use, and the components they share, in React and Tailwind | | messages' `ts/` |

The session crate reads none of the profile loader, state sync, or the cockpit stream: the profile loader writes the bundle a session pins, and state sync and the cockpit stream guard the session crate's Ready and control requests ([the session's units](../session/02-units.md#the-units)).
The session crate, the profile loader, and the cockpit stream don't depend on the recording crate, since they tell it nothing (user, 2026-10-23; [recording log][stage-8]).
v1 builds no plugins, so the platform has no plugins crate ([plugins and the sandbox](../plugins/01-plugins.md#no-plugins-in-v1)).

### Features

Each feature is a folder in `src/features/`, its crate in the core named for it and its routines' crate named for it with `-routines`.
A feature's section in an app is one part, which the app's list names in one line, and the shells reach a feature only through the notifications, the settings, the match check's differences, and the role keys' labels ([a feature's parts](../interface/01-apps.md#a-features-parts)).

| Unit | Parts, as v1's scope suggests and node 6 settles | Uses, beyond the kernel and the message crate |
| --- | --- | --- |
| state-sync | core, routines (`HEvents`), panel (`h-events`, `instrument-reads`), apps | cockpit-stream, session, sim-service, profile-loader, clients, sync-engine |
| pointer-sync | core, panel | cockpit-stream, session, clients, network |
| flight-model | core, routines (`Lead`, `Follow`) | network, session, sim-service |
| avatars | core, routines (`Figure`), the figure's SimObject (`figure/`) | cockpit-stream, core-helper-service, sim-service, profile-loader, network, session, clients, aircraft-model |
| traffic | core, routines (`Traffic`), apps | session, sim-service, network, clients, object-mirror |
| atc-audio | core, apps | session, core-helper-service, network, clients |
| take-control | core, efb, desktop | session, core-helper-service, clients |
| voice | core | session, core-helper-service |
| rate-and-pause | core, efb | session, sim-service, clients |
| go-to | core, desktop | session, sim-service, clients |

- State sync's `instrument-reads` reads the values in a gauge's JavaScript that a profile's `instrument()` names ([reading it in the panel](../plugins/01-plugins.md#reading-it-in-the-panel)), and `h-events` hears `H:` events ([`H:` events](../sync/05-units.md#h-events)).
- Traffic, ATC audio, and state sync have parts in the apps wherever the apps' design shows their slices ([a feature's parts](../interface/01-apps.md#a-features-parts)).
- Pointer sync depends on the session for the PF ([pointer sync](../pointer-sync/01-pointer-sync.md#the-units)).
- Rate and pause has a part in the EFB app, since the one way we found to set active pause is the toolbar's own call, from the toolbar's or the EFB's document ([environment log](../environment/log.md#2026-10-16-the-toolbars-toolbar_set_active_pause-called-from-the-toolbars-or-the-efbs-document-turns-active-pause-on-and-off-and-no-simconnect-event-we-tried-does)).
- The voice phrases are a Soon pick (user, 2026-10-17), so `voice` is out of v1's units, and its rows here and in [systems](#systems) describe it for that pick ([take-control](../control/01-take-control.md)).

### Apps, the sim package, and tools

| Unit | What it is | Uses, of ours |
| --- | --- | --- |
| `src/apps/core` | `main`, the list of the platform's crates and the features in the order they register, and the core's edge: tokio's sockets, the timer thread, which waits on a high-resolution waitable timer, the WebSocket server, the core helper's pipe, files, HTTPS, the worker pool, the replay log's writer, and the seed of the kernel's random IDs; it declares one foreign function, the C runtime's `_set_FMA3_enable`, to turn FMA3 off in the C runtime it links statically, and stops a build whose `RUSTFLAGS` replaced that static runtime ([the core's math](../core/01-loop-and-edge.md#the-cores-math), [the C runtime](../build/01-the-build.md#the-c-runtime)); and a Cargo feature, `stand-in`, that no release build turns on, which puts the stand-in where the edge goes and registers the test units and the test routine the cases name ([its place](../build/02-testing.md#its-place)) | Every crate on the core's side, the transport, and the sim edge; in its `stand-in` build, the stand-in sim and `src/sim-package/routines` |
| `src/apps/core-helper` | The core helper: Raw Input and audio, and speech with the voice phrases, a Soon pick | messages |
| `src/apps/desktop` | Tauri's Rust side, which holds the watcher's jobs and runs from login as a tray icon, and links the `velopack` crate, as no other program does, since a program that runs Velopack's startup applies a downloaded update ([installing and updating](../install/01-installing-and-updating.md#the-installer-and-the-updater)); Vite's entry; and the list of the desktop app's sections | desktop-shell, each feature's `desktop/`, messages |
| `src/sim-package/wasm-module` | The cdylib cargo-msfs builds: the edge on the sim's APIs, whose bindings its build script generates from the SDK's headers | routine-host, `src/sim-package/routines` |
| `src/sim-package/routines` | The module's list of routines, a library crate of its own, which `src/sim-package/wasm-module` and the bench build of the core both link ([our WASM module](../build/02-testing.md#our-wasm-module)) | routine-host, each feature's `routines/` |
| `src/sim-package/pages` | The `VCockpit.js` override, the EFB app's entry and its list of sections, the banner's entry, and the menu script, which reports the menu's page and runs the world map's requests | panel-bridge, efb-shell, page-client, each feature's `efb/` |
| `tools/profile-builder` | Checks each profile and builds its bundle, for CI and for authors | profile-build |
| `tools/profile-author` | The seat tool and the click tool ([the authoring tool](../avatars/01-avatars.md#the-authoring-tool)) | sim-client, sim-edge, aircraft-model, messages |

`tools/bench/` holds the bench's scenarios, its fake pages, its local profiles' site, and the stand-in core helper ([where it lives](../build/02-testing.md#where-it-lives)).

Each crate in `src/apps/` and `src/sim-package/` is named `dualinput-` and its folder, since Cargo names a program after its crate (documented, [Cargo targets](https://doc.rust-lang.org/cargo/reference/cargo-targets.html#binaries)), so each program's file carries Dual Input's name, and no program's crate can take a name a crate of the platform's or an engine holds, which Cargo refuses in one workspace (measured on our development machine, 2026-10-15, [architecture log][map]).

### The registry and moments

- The kernel holds the registry, and what every hook shares: moments, requests and their guards, timers, jobs, and the store of each unit's state.
- Each crate of the platform's adds the hooks it runs to the registry, such as the clients crate's commands and the cockpit stream's kinds, so a feature that registers a command depends on the clients crate, and the kernel names no service.
- Each moment's type lives in the crate that raises it, so a feature that handles `LinkLost` depends on the network crate.
- Each unit's state is written by its own handlers alone, a crate of the platform's as much as a feature, and another unit asks with a request, as take-control asks the session crate for control.
- Every unit's handles, for its timers, jobs, and calls, come from one counter, and its random IDs from the kernel's one generator, seeded from the core's one seed (user, 2026-10-23; [recording log][stage-8]).
  The core records every input, so no unit draws fewer in a replay than live (user, 2026-10-21; [recording log][every-input]).
- The core's `main` registers the platform's crates first, from the kernel up, then the features in their list, each through the same `register` ([what a feature registers](#what-a-feature-registers)).

### Systems

Each system is one of [the spine's parts](01-spine.md#parts), with two changes: the core splits into the first four rows below, and the panel bridge and our WASM module, which the spine puts with plugins, join the systems whose contracts they share.
[Node 6](plan.md#6-systems) designs each, or checks the design it has against this map.

| System | Area | Units | Designed in |
| --- | --- | --- | --- |
| The core's loop and edge | `core/` | kernel, `src/apps/core` | [One loop](#one-loop), [01-loop-and-edge](../core/01-loop-and-edge.md) |
| The sim seam and our WASM module | `core/` | sim-service, sim-client, sim-awareness, sim-edge, simconnect-types, routine-host, `src/sim-package/wasm-module`, `src/sim-package/routines` | [The sim seam](#the-sim-seam), [work in the sim](#work-in-the-sim), [03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md) |
| Clients and the panel bridge | `core/` | clients, page-client, panel-bridge | [What the bridge owns](#what-the-bridge-owns), [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md) |
| The core helper | `core/` | core-helper-service, `src/apps/core-helper` | [04-core-helper](../core/04-core-helper.md) |
| The network | `network/` | network, transport, `src/backend/`'s invite codes | [01-between-machines](../network/01-between-machines.md), [02-units](../network/02-units.md) |
| Sync | `sync/` | cockpit-stream, sync-engine, state-sync | [01-profile-entries](../sync/01-profile-entries.md) to [05-units](../sync/05-units.md) |
| The session | `session/` | session, rate-and-pause, go-to, the menu script | [01-roles-and-members](../session/01-roles-and-members.md), [02-units](../session/02-units.md) |
| Control | `control/` | take-control, voice | [01-take-control](../control/01-take-control.md) |
| Profiles | `profiles/` | profile-engine, profile-build, profile-loader, profile-builder | [01-format-and-delivery](../profiles/01-format-and-delivery.md), [02-units](../profiles/02-units.md) |
| Plugins | `plugins/` | sandbox | [01-plugins](../plugins/01-plugins.md) |
| Flight-model sync | `flight-model/` | flight-model | [01-flight-model-sync](../flight-model/01-flight-model-sync.md) |
| Pointer sync | `pointer-sync/` | pointer-sync | [01-pointer-sync](../pointer-sync/01-pointer-sync.md) |
| Avatars | `avatars/` | avatars, aircraft-model, msfs-gltf, msfs-rpn, ray-cast | [01-avatars](../avatars/01-avatars.md) |
| Traffic and ATC | `traffic-atc/` | traffic, atc-audio | [01-traffic-and-atc](../traffic-atc/01-traffic-and-atc.md) |
| The apps | `interface/` | efb-shell, desktop-shell, `src/apps/desktop`, `src/sim-package/pages` | [01-apps](../interface/01-apps.md) |
| Recording and bug reports | `recording/` | recording, recording-format, and after v1 `src/backend/`'s reports | [01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md) |
| Installing and updating | `install/` | `src/apps/desktop`'s watcher jobs, and the installer, Velopack's Setup.exe | [01-installing-and-updating](../install/01-installing-and-updating.md) |
| The build | `build/` | `tools/`, CI, the map check | [The workspace](#the-workspace), [01-the-build](../build/01-the-build.md) |

## The platform's interface

The platform runs every feature on one loop.
A feature plugs in by registering what it handles, what it declares, and what it guards, and its handlers read the platform's state and act only through outputs.

### One loop

```text
 SimConnect thread ───────────────┐
 tokio: iroh, WebSockets ─────────┤
 timer thread ────────────────────┤                             ┌─ the platform's services
 the core helper's pipe ──────────┼─▶ queue ─▶ recording ─▶ loop ┤
 worker pool ─────────────────────┘   each input stamped        └─ features' handlers,
                                      as it's pushed                  in registration order
                                                                │
                                                                ▼
                       outputs: sim calls, sends, client updates, timers, jobs
```

- One thread owns the platform's services, every feature's state, and the QuickJS-ng runtimes, and handles one input at a time.
- Edge tasks around it do the waiting: tokio runs the sockets, as [decision 027](../../decisions/027-core-runs-on-tokio.md) has it, a thread of the core's edge waits on a high-resolution waitable timer for the loop's timers ([threads](../core/01-loop-and-edge.md#threads)), a thread of its own runs SimConnect, whose clients "are not currently thread-safe" ([04-01](../../learn/foundations/04-01-connection-and-data.md)), and a pool runs slow work.
  Each stamps an input in µs on the PC's counter ([01-spine](01-spine.md#times)) as it pushes it, so the stamps rise in the order the loop takes the inputs.
- Everything the loop reads from disk arrives as an input too: the settings and the session file when the core starts, and the profile's bundle, its plugin included, when it loads.
- Handlers are synchronous, and none reads a clock, draws a random number, does I/O, waits, starts a thread, or iterates a `HashMap`, whose order is randomly seeded.
  A random ID the core draws, such as the session's when the host starts one ([decision 022](../../decisions/022-random-uuids-as-text.md)), comes from the kernel's one ChaCha20 generator, seeded from the one seed the core's edge puts in the core's first input ([timers, jobs, and IDs](../core/01-loop-and-edge.md#timers-jobs-and-ids), [the registry and moments](#the-registry-and-moments)).
  [Tiers](#tiers) names the loop's crates by folder, so a crate that never runs on the loop, such as the routine host, keeps the same rules.
  The loop's crates set two of Clippy's lints to deny, so `cargo clippy` fails on a call to a function their shared `clippy.toml` lists, such as `Instant::now`, `std::thread::spawn`, or `HashMap::keys`, through `disallowed_methods`, and on a `for` loop over a `HashMap`, through `iter_over_hash_type` (documented, [disallowed_methods](https://rust-lang.github.io/rust-clippy/master/index.html#disallowed_methods), [iter_over_hash_type](https://rust-lang.github.io/rust-clippy/master/index.html#iter_over_hash_type)).
  Clippy lints only our own crates, and none of its lints bans `.await` (unverified: [its list of lints](https://rust-lang.github.io/rust-clippy/master/index.html) shows none), so the map check keeps every crate on its I/O list out of the loop's crates.
- A handler takes the time from its input.
  A timer is an output whose firing comes back as an input, and slow work, such as fetching a profile or loading a cockpit model, leaves as a job and comes back as an input.
  A timer's or a job's handler checks that what it was started for still holds, such as the aircraft a fetched profile was for.
- Moments the platform raises queue on the loop and run before the next input, and a request the platform decides is decided before the next input too.
  A moment's handlers run in the order their features registered, and no feature relies on that order.
- A profile's script and a plugin get no clock: their QuickJS-ng contexts hold, of the intrinsics rquickjs adds one by one (read in rquickjs-core 0.14.0, `src/context/builder.rs`), `Eval`, `RegExp`, and `Promise`, so they leave out `Date` and `Performance`.
  Each context deletes the `Promise` and `AsyncDisposableStack` globals that `Promise` adds, and takes the intrinsic only because without it an async function made QuickJS-ng abort the core when its sandbox was dropped ([the sandbox](../plugins/01-plugins.md#the-sandbox); [plugins log](../plugins/log.md#2026-10-24-stage-12s-sandbox-stops-a-write-functions-endless-loop-at-100-interrupt-checks-and-needs-quickjs-ngs-promise-intrinsic-without-which-an-async-function-aborts-the-core-when-its-sandbox-is-dropped)).
  The sandbox deletes `Math.random`, which QuickJS-ng seeds from the wall clock ([5.1.1]), and `queueMicrotask`, and pins the stack's top at each call into JS ([the sandbox](../plugins/01-plugins.md#the-sandbox)).
  QuickJS-ng's hash seed, which it takes from the wall clock when it makes a context ([5.1.1]), changes nothing a script sees (same section).
  A script that has to wait asks the platform for a timer.
- The loop reads no clock: the sandbox's time limit counts QuickJS-ng's interrupt checks, and the sandbox calls no check from the core's edge ([decision 047](../../decisions/047-sandbox-time-limit-counts-interrupt-checks.md)).

The platform records its queue, each input with its kind and stamp, under a header that names the build, so the same build replays a whole run from it, and a bug report after v1 names the build to check out.
It leaves out no input, and a replay checks every unit (user, 2026-10-21; [recording log][every-input]).
Only the build that wrote a recording reads it as a replay.
What a later version reads from a recording, such as the report page's list of sessions, the debrief timeline, and plugin tests, is a separate record in a self-describing format with named fields, so adding a field breaks no older reader; v1 writes none, and the record comes with the uploads after v1 (user, 2026-10-23; [recording log][stage-8]).

One loop costs three things ([5.1.1]):

- A flow that takes many steps, such as catch-up, is a state machine written out, not an `async` function.
- A slow handler delays every input behind it, so [budgets](#budgets) bound each.
- A replay needs the same build, and the same profile's bundle, as the run it replays.

Actors on tokio, one per feature, would leave the order between features to the scheduler, so a replay would need every delivery recorded, and simulation runtimes replay a seeded world, not a pilot's run ([5.1.1]).

### What a feature registers

Each feature's crate exposes one `register` function, and the core's `main` calls each from one list, as Zed starts each of its own features with one call (read in Zed's main branch on 2026-10-14, `crates/zed/src/main.rs`, as [5.1.1] cites it).

```rust
// a sketch
pub fn register(r: &mut Registry) {
    let me = r.unit::<PointerSync>("pointer-sync");
    me.on::<LinkLost>(PointerSync::lock_displays);
    me.cockpit_kind(pointer_sync::GESTURE, PointerSync::play);
}
```

| Hook | The feature declares | A v1 example |
| --- | --- | --- |
| Moments | Which of the platform's it handles | Pointer sync locks its displays on `LinkLost` ([01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)) |
| Session keys | Each key; whether a member, anyone, or the PF alone writes it, each write being a request the session crate decides ([session keys](../session/02-units.md#session-keys)); and whether its value names a member, in which case the platform clears the key when that member leaves the session | Rate and pause owns the pause and the simulation rate ([01-between-machines](../network/01-between-machines.md#channels)) |
| Channels | Its delivery and its priority; each send names its receivers, and the receiving handler checks who may send ([channels and sends](../network/02-units.md#channels-and-sends)) | The flight model, as one-off packets ahead of every stream |
| Cockpit stream kinds | A kind; the handler that applies it and says when it counts as applied ([04-order-and-recovery](../sync/04-order-and-recovery.md#the-cockpit-stream)); whether the stream holds each key's newest message, and whether a replay collapses its runs ([kinds](../sync/05-units.md#kinds)); and which profile entry a message of it changes, if any, with how to read the entry's number from its body, for ["cockpit sent"](#what-a-handler-sees-and-does) | Pointer sync's gesture, sent as a down, moves, a held message after each 1s with nothing else sent, and an up, whose up counts as applied once the display's panels are done with it ([playing a gesture](../pointer-sync/01-pointer-sync.md#playing-a-gesture)) |
| Catch-up steps | A step, the steps it runs after ([04-room-for-later](../product/04-room-for-later.md#a-catch-up-pipeline)), and its payload, which it gives on the flying machine and takes on the catching-up one ([catch-up](../sync/05-units.md#catch-up)) | State sync's catching up state |
| Guards | A check on a request the platform decides, [below](#guards) | State sync holds Ready until the aircraft has settled ([settling after a load](../sync/03-catch-up.md#settling-after-a-load)) |
| Client state and commands | A slice of state the apps show, and the commands they send | The take-control key's command to take control |
| Settings, notifications, and items for the match check | Each one | The take-control binding; "Couldn't sync the beacon" |
| The core helper's input and audio | The bindings, captures, and sounds it needs | The take-control key; capturing the ATC app |

A role is a session key a feature declares, whose value names the member who holds the role: traffic's key names the traffic host, and ATC audio's names the ATC host.
Where a later role limits who may hold it, its feature registers a guard on writing that role's key.
[Roles and members](../session/01-roles-and-members.md#the-table-of-roles) keeps the table of roles as the session's documentation, and the code holds no registry of them.
A feature whose messages must apply in order with the cockpit's, such as a later bus bridge carrying a message that opens a page ([04-room-for-later](../product/04-room-for-later.md#channels)), registers cockpit stream kinds rather than a channel, so no channel declares a place in the cockpit's order.

How a feature reaches the sim is in [the sim seam](#the-sim-seam), how it adds work to our WASM module and the panel bridge is in [work in the sim](#work-in-the-sim), and which crates hold the registry and the moments is in [the registry and moments](#the-registry-and-moments).

### What a handler sees and does

A handler gets three things:

- its own feature's state, which it alone writes
- the platform's state, read-only: the session and its keys, its members, control, each link's state, preflight, the loaded profile's blocks, the settings, sim awareness, and each request's verdict from the [guards](#guards)
- an outbox, for sends on channels, calls to the sim, work in the sim, requests to the core helper, client state, notifications, timers, jobs, and requests to the platform

A feature never changes the platform's state itself: it asks, and the platform decides.
The take-control key asks for control, and the platform's [guards](#guards) decide whether the pilot gets it.

Features reach each other only through moments the platform raises, and no feature raises a moment of its own, since its type would live either in the raising feature's crate, which the handling feature would then depend on, or in the platform's, which would keep it after the feature that raises it is deleted.
When the PF's or the PM's own change to an entry goes out on the cockpit stream, the platform on that pilot's machine raises "cockpit sent" with the message's clock, the entry, and the entry's number ([sending](../sync/05-units.md#sending)).
Avatars there, unless a click has just brought the figure's hand, reaches the hand for the entry's `location` ([01-format-and-delivery](../profiles/01-format-and-delivery.md#state-entries)) and sends the point as it sends a click's, since the clicking pilot's machine works out the hand ([decision 004](../../decisions/004-core-works-out-figures-hand.md)); the other machine only draws it, and avatars depends on no other feature for it.
A message the stream skips raises no moment.

### Guards

A feature that can block a request the platform decides registers a guard on it:

```rust
// a sketch; the feature is hypothetical
me.guard::<TakeControl>(Instructor::only_the_instructor);   // Allow, or Deny("Only the instructor can take control")
```

- A guard is a quick, synchronous check on the loop that reads only its own feature's state and the platform's.
- After every input, the platform asks the guards of each request its pilot could make, and keeps the verdict, allowed or each denial's reason in the order the guards registered, in its read-only state.
  The apps show it, so the take-control button says why not before it's pressed, and a request the pilot makes takes the same verdict.
- Any denial refuses the request.
- Deleting a feature deletes its guards, and the platform never knows they existed.
- The platform's own rules are guards it registers on itself: control can't pass to a pilot while their catch-up or replay runs over a link that's up ([04-order-and-recovery](../sync/04-order-and-recovery.md#catch-up)), and the take-control input is live only while its pilot is in the flight, after preflight ([roles and members](../session/01-roles-and-members.md#the-pf)).
- Guards check requests: Ready, the take-control key and button, and claiming a role's key, and a voice handover's answer comes with the voice phrases, a Soon pick.
  A pass the platform makes itself, such as when the PF leaves the flight, isn't a request, and goes ahead as [roles and members](../session/01-roles-and-members.md#the-pf) requires.

### The traffic and ATC switch

Traffic and ATC audio each declare a role's key, the traffic host's and the ATC host's (user, 2026-10-14).
The platform offers one request that claims several keys together, refused whole if any guard denies one, and the apps' "Share my traffic and ATC" switch sends it with both keys, and shows on while this pilot holds both.
The platform never knows what either key is for, and deleting traffic removes its key from the switch in the apps, as deleting a feature removes its section in each app.
Both keys go out in one message on the session channel, and each key's stamp counts that key's own changes ([01-between-machines](../network/01-between-machines.md#channels)).
When both pilots flip the switch at once, both keys carry the same counts, so both settle on the same pilot (unverified; a [node 7](plan.md#7-testing) bench case in which both pilots claim at once settles it).
This changes [decision 044](../../decisions/044-table-of-roles.md), which gives the two one role that can split, once step 8's decisions are numbered.

### Budgets

Each is a starting value, which [node 7](plan.md#7-testing)'s bench measures:

- The queue stays under one sim frame at p99: 11.2ms at the 89 sim updates a second our module saw in a flight ([architecture log](log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)).
- A handler takes at most 1ms, apart from calls into QuickJS-ng, which keep their limit of a count of interrupt checks, about 100ms on our development machine ([decision 046](../../decisions/046-sandbox-runtimes-and-limits.md), [decision 047](../../decisions/047-sandbox-time-limit-counts-interrupt-checks.md)).
  One call at that limit holds back about 9 sim updates, in order (arithmetic), and about 5 of ATC audio's 20ms frames, which would reach the playback buffer after their turn and be dropped if the buffer holds less than 100ms (unverified; the ATC design sets the buffer, and the bench measures it).
- A write function that hits its limit fails that write, and its entry stops syncing on its own machine for the rest of the load, skipping arriving changes to the entry and sending none, because on one loop a stuck call holds up every input behind it ([decisions.md](decisions.md#a-write-function-that-hits-its-limit-stops-its-entry-syncing-for-the-rest-of-the-load)).
  This changes decision 046 for write functions once step 8's decisions are numbered.
- The loop is busy less than 20% of one CPU core through a busy flight.

## The sim seam

The core's code meets the sim at SimConnect's own calls and messages, and everything that makes sense of them runs on the loop, so the sim, a stand-in, or a replay can sit below the seam and nothing above it changes (user, 2026-10-15).
The platform holds one SimConnect connection from the sim's start, and gives each feature that reaches the sim a connection of its own for each load, so closing that connection takes the feature's work in the sim with it.

```text
 features
    │
 the platform's sim service
    │
 sim client (an engine, on the loop)
 ═════ the seam: calls out; messages, opens, losses, and the sim's process in ═════
    │
 the edge on SimConnect.dll, a stand-in sim, or a replay of the recorded queue
```

| Unit | Tier | What it does | Runs |
| --- | --- | --- | --- |
| Sim service | Platform | Opens and closes the connections, knows which feature holds each, discards a message for a connection it closed, and keeps the platform's own uses of the sim, [below](#what-the-platform-keeps) | On the loop |
| Sim client | Engine | For each connection: hands out SimConnect's IDs, parses each message, and routes it to the call that caused it; on a lost connection the platform opens again, makes its definitions, requests, and subscriptions again | On the loop, and in the IDE |
| Edge | Engine | Keeps each connection's handle on one thread, since SimConnect's clients "are not currently thread-safe" ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)); makes each call through `SimConnect.dll`; tags each exception with the handle of its call; and hands what comes up, stamped, to the program it runs in | Off the loop, in the core and the IDE |
| Stand-in sim | Engine | Takes the edge's place on the bench, and answers each call as the sim would, with SimConnect's own messages and its exceptions already tagged; [testing](../build/02-testing.md#the-stand-in-sim) designs it | On the bench |
| Bindings, simconnect-types | Engine | SimConnect's types and constants, which bindgen generates from the SDK's headers ([01-spine](01-spine.md#the-core)); the edge alone declares SimConnect's functions, so the crate graph shows that only the edge can call `SimConnect.dll`, where one crate holding both would let the sim client call it unseen | With the edge, the sim client, and the stand-in |

Four kinds of input come up through the seam, each stamped and recorded: a message SimConnect hands over, copied whole; the result of each `SimConnect_Open`; a connection's loss, from a failed call, a failed dispatch, or the sim's quit message ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)); and the sim's process, found with its ID and creation time or exited with its exit code ([its inputs](../core/03-sim-seam-and-wasm-module.md#its-inputs)).
So the loop decides when to open a connection and when to try again, by timer, and a replay runs a sim's boot and restart too.

The edge tags an exception by reading `SimConnect_GetLastSentPacketID` after each call and matching the packet ID the exception names, as the SDK documents, though it intends the function "while debugging and testing the client application" rather than "in a final retail build" (documented, [SimConnect_GetLastSentPacketID](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Debug/SimConnect_GetLastSentPacketID.htm)).
Whether the tag holds among writes each frame is unverified: FS Copilot's traffic code read the packet ID only after its one-off calls (read in the FS Copilot fork, `FsCopilot/Connection/SimTraffic.cs`, `Call`, and `FsCopilot/Simulation/TrafficReceiver.cs`, `Render`), and no run of ours has matched an exception this way; [node 7](plan.md#7-testing)'s tests in the sim settle it.
An exception the edge can't match, such as one whose packet ID is 0, `UNKNOWN_SENDID` (read in MSFS 2024 SDK 1.7.3, `SimConnect.h`), still reaches the feature whose connection it came on.

### Why the seam sits at SimConnect's calls

- Each failure our earlier sim layers had sits above the seam, where the bench runs it and a replay runs it again:
  - fsc-editor read values in definition order, so a variable the sim rejected after the call had returned cut short the values after it, and one rejected mid-definition would have shifted them ([04-01](../../learn/foundations/04-01-connection-and-data.md#data-definitions-and-requests)).
  - fsc-editor defined a watch set only when it changed, so one that arrived while the sim was closed "stopped at the connection check and was never defined" (fsc-editor, `src/main/sim/session.ts`).
  - FS Copilot's `SimClient` never saw an exception: its reading connections handle none, and its writing connection reads no message (read in the FS Copilot fork, `FsCopilot/Connection/SimConnectConsumer.cs` and `SimConnectProducer.cs`).
- fsc-editor's replay entered after its own parsing and ran a path of its own beside the live one (read in fsc-editor, `src/main/sim/session.ts`, `startSim`).
  The replay's path fed the store of live values, while each live SimConnect handler had to feed it itself, and the input event handlers didn't, so they "captured every value, recorded it as evidence, and showed none of it", and that bug shipped (fsc-editor, `src/main/sim/fixtures/README.md`, `pa24-beacon-input`).
  Below our seam, the only code that runs live and never in a replay is the edge, which makes calls, tags exceptions, and copies bytes.
- A replay needs no record of the calls the core made, because the same build makes the same calls from the same inputs.
- The bench runs the real path, as [node 7](plan.md#7-testing) requires: FS Copilot's bench couldn't run with the sim open, since keeping it out "means making `SimClient` inert under `--bench`, which is real surface inside a shipping class" (FS Copilot fork, `record/pointer-forwarding/docs/14-test-bench.md`, "Do not run the simulator during a bench run").

It costs a stand-in that answers each kind of call our code makes with SimConnect's own messages, so each call a feature adds is one more for the stand-in to model.

### A connection for each feature, for each load

The platform's connection opens as soon as `SimConnect_Open` returns `S_OK`, before the sim's open reply arrives ([architecture log][flight]), and stays open until the sim closes, for the platform's own uses ([below](#what-the-platform-keeps)).
A feature's connection opens at the feature's first sim call after its profile loads, and closes when the profile unloads or when the feature closes it.
A closed connection takes its definitions, requests, and subscriptions with it, so the feature's next call opens a new, empty one, and the sim service discards a message the edge brings for a closed connection.
A connection the sim loses while the sim runs on, the platform's or a feature's, the platform opens again at once, and the platform's own, lost when the sim closes, on the sim's next run; the sim client makes the lost connection's setup again on the new one, and a feature hears of the loss, since the objects it created went with the connection.

Closing a connection is how a feature's work in the sim ends.
The SDK says that when a client closes, "the server will remove all objects, menu items, group definitions and so on" that the client defined or requested (documented, [SimConnect_Close](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/General/SimConnect_Close.htm)).
What we've measured is a client killed: the sim removed FS Copilot's injected traffic after its process was killed before its cleanup ran (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 0 capture read; TrafficInject built and smoke-tested — Q01, Q08 settled"), and a pilot's controls came back once the masking client was killed or its group cleared ([flight-controls log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)).

Connections of their own may also keep features apart: in one client, clearing one group cut another group off from the sim event both held ([architecture log][flight]), so on a shared connection one feature's teardown could silence another's listener, while whether a group on another connection keeps hearing that event is unverified.

Two costs come with them:

- The sim's order between two connections' messages is lost, and the queue orders them by the edge's stamps.
  No feature needs another's order, since features reach each other only through the platform.
- v1 holds one connection for the platform and one for each feature that reaches the sim, about six, as FS Copilot's app held five and its module a sixth ([04-01](../../learn/foundations/04-01-connection-and-data.md#what-it-is)), and what a connection costs the sim's frame is unmeasured.

[Node 7](plan.md#7-testing)'s tests in the sim settle what's unmeasured: whether closing a connection removes its AI objects and masks as killing its client did, whether a group on one connection keeps hearing an event while a group on another is cleared, and what a connection costs the sim's frame.
If closing a connection leaves its AI objects or masks behind, the sim service removes each feature's objects before closing its connection.
If connections cost the frame too much, it puts the features on one connection.
If a group on one connection stops hearing when a group on another is cleared, the spine's rule that the core clears no group while another of its groups hears that sim event ([01-spine](01-spine.md#the-core)) covers all of the core's connections.
In each case no feature changes, since no feature sees a connection.

### What a feature sees

```rust
// a sketch
// in register:
me.on_sim(Traffic::on_sim);   // a value, a created object's ID, an exception with its call

// in a handler:
let sim = out.sim();                                        // this feature's sim calls; the platform opens its connection on first use
self.copies.insert(key, sim.create_ai(title, livery, at));  // a handle now; the object's ID arrives as an input
```

- A feature names variables and events as the sim spells them, `A:`, `L:`, `B:`, and `K:` among them, as a profile names them ([01-format-and-delivery](../profiles/01-format-and-delivery.md#names)).
  A list of names, or a struct whose fields name its variables, such as the flight model's pose, reaches the sim as one tagged watch.
- A feature hears a `K:` event through the sim service's `listen(event)` ([reaching the sim](../sync/05-units.md#reaching-the-sim)).
- Each call returns a handle at once, so whatever comes back, a value, an object's ID, or an exception, reaches the handler with the handle of the call that caused it, though for an exception among writes each frame that's unverified ([above](#the-sim-seam)).
- A feature gets the ID the sim gives each object it creates, as our avatar probe handed the figure's ID to the module that placed it (read in `experiments/areas/avatars/p12-wasm.mjs`, `setModule`).
  It never sees a connection, the numbers that name its definitions, requests, events, and groups, or SimConnect's message layouts.

### What the platform keeps

- **Masking:** a group that registers after an aircraft's module sits behind it ([flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)), so the platform's connection takes its group as the sim starts ([flight-controls log](../flight-controls/log.md#2026-10-07-a-group-that-takes-its-priority-as-the-sim-starts-held-open-by-an-event-it-only-listens-to-masks-ahead-of-accu-sim-once-it-adds-the-axis)), and a later feature that masks asks the platform.
- **The module's version and counter:** our WASM module is the platform's, and the platform's connection reads `DUALINPUT_MODULE_STATUS`, the slot where the module leaves its version and its counter; a feature's routines there are fed on the feature's own connection ([work in the sim](#work-in-the-sim)).
- **The CommBus event that announces the core's port** ([01-spine](01-spine.md#finding-the-core)).
  Any other CommBus event a feature subscribes to or calls goes through the feature's own connection, as any sim call does.
- **Sim awareness** ([01-spine](01-spine.md#sim-awareness)): the sim service raises `SimChanged` for each change of the sim's state, so it raises one for each load, however many signals the sim sends.
  When the platform's connection opens on a sim already in a flight, it raises one for the load it finds, which it asks the sim for, since a system event reports only what happens after the subscription ([04-02](../../learn/foundations/04-02-events.md#system-events-and-state)).
  Its logic is an engine of its own, `sim-awareness`, which the bench can test alone and the IDE can link ([03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md#the-units); user, 2026-10-15).

### The sim seam's budgets

Each is a starting value, which [node 7](plan.md#7-testing) measures:

- The edge puts a message on the queue within 1ms of SimConnect signaling it, at p99.
- v1's connections and their watches add under 0.2ms to the sim's frame, about the 0.18ms by which two runs of the A2A PA-24 with nothing of ours differed ([01-spine](01-spine.md#the-sims-pages)), leaving out traffic's copies, whose models cost frames whoever drives them ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)).

### Cases for the bench

Node 7 turns each into a test, on the bench or in the sim:

- `AircraftLoaded` arriving several times for one load, as it came three times around one load to our client ([architecture log][flight]), two of them in the main menu ([core log](../core/log.md#2026-10-15-two-of-the-three-aircraftloaded-our-client-heard-around-a-flight-load-came-in-the-main-menu)), raises one moment.
- The platform's connection opening on a sim already in a flight raises one moment, for the load it finds.
- Several `Frame` events in one read, which FS Copilot's traffic thread got "for frames already rendered" when the sim outpaced it (read in the FS Copilot fork, `FsCopilot/Connection/SimTraffic.cs`), each reach the loop as an input of its own.
- Traffic's copies, written each frame by traffic's routine `Traffic` while a write function hits its limit in the same load, move as smoothly as FS Copilot's, which it wrote inside its own `Frame` handler at a median jitter of 0.17, where 0 is constant motion and near 1 is stop-and-snap ([04-01](../../learn/foundations/04-01-connection-and-data.md#writing-data)).
- A message for a closed connection is discarded.
- An AI create with a title the sim lacks: its exception reaches the call, through the stand-in's tag on the bench and the edge's in the sim ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#the-ai-objects-api-and-the-facilities-api)).
- A variable the sim rejects from a definition after the call returned: the definition's other values still arrive.
- The platform's connection, opened as the sim boots, takes its masking group as soon as `SimConnect_Open` returns `S_OK`, and the calls it makes before the sim's open reply arrives take effect, as [the spine](01-spine.md#the-core) measured.
- A connection the sim loses, and the platform opens again, has its definitions, requests, and subscriptions made again, as the platform's does when the sim closes and starts again.

## Work in the sim

A feature's work in the sim is code of its own: routines in our WASM module, built into the module's one binary, and panel modules, each a file the panel bridge loads by name (user, 2026-10-15).
A routine runs from its feature's first feed until the feature ends it, or until 1s passes with no write to its data slot, which the sim service writes again every 200ms while the core runs.
Each frame it asks the routine host for what it wants, and the routine host undoes the one want that lasts past the frame that asked for it: the freeze.
In a cockpit panel, the bridge owns only what can block the pilot's input, and gives each of those the three protections [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) asks for.
A plugin ships no code into the sim ([decision 020](../../decisions/020-plugin-code-runs-only-in-core.md)), and v1 builds no plugins ([plugins and the sandbox](../plugins/01-plugins.md#no-plugins-in-v1)).

```text
 the core                                     the sim
 a feature's crate ── its routines' slots ──▶ our WASM module: the routine host ── its edge ── the sim's APIs
   │                                            └─ the feature's routines, in the module's one list
   └──── the panel's socket ────────────────▶ the panel bridge, in each cockpit panel
                                                └─ the feature's panel modules, each a file of its own
```

### Routines in our WASM module

A routine is a small crate of its feature's, built for wasm32 into the module's one binary through one line in the module's list, `src/sim-package/routines/`, and natively for its tests and for [node 7](plan.md#7-testing)'s bench, which runs the routine host and routines beside the stand-in sim.
It never calls the sim: the routine host hands it its slot's values and each frame, and does what it asks.

```rust
// a sketch: flight-model sync's routine
pub struct Follow { samples: Samples<PoseSample> }

impl Routine for Follow {
    const ID: RoutineId = routine::FOLLOW;   // with FollowSlot, in flight-model sync's module of the message crate
    type Slot = FollowSlot;

    fn on_slot(&mut self, s: &FollowSlot) { self.samples.push(s.sample) }   // a new feed

    fn frame(&mut self, f: &Frame, want: &mut Wants) {
        want.freeze();                                    // in every frame it runs, with a pose to write or not
        if let Some(pose) = self.samples.at(f.now - DELAY) {
            want.write(&pose);                            // the pose and the velocities, as the struct's fields name them
        }
    }
}

// the module's one list
routines![routine_host::Hold, flight_model::Lead, flight_model::Follow, avatars::Figure, traffic::Traffic, state_sync::HEvents];
```

```rust
// a sketch: flight-model sync's crate in the core
out.module().feed(routine::FOLLOW, FollowSlot::from(sample));   // on each pose from the flying machine
out.module().end(routine::FOLLOW);                              // when this pilot takes control
```

- **Its slot:** the module creates each routine's slot when it loads, named `DUALINPUT_ROUTINE_` and the routine's ID, such as `DUALINPUT_ROUTINE_FOLLOW`.
  A feed goes out on the feature's own connection, as every sim call of a feature's does ([a connection for each feature](#a-connection-for-each-feature-for-each-load)), and the sim service writes the last feed again every 200ms until the feature feeds another or ends the routine, so no feature keeps its routine alive by hand.
- **Its header:** each slot opens with a header the sim service writes and the routine host reads, a count of the feature's feeds, an end mark, a hash of the slots' layouts ([a module from another build](../core/03-sim-seam-and-wasm-module.md#a-module-from-another-build)), and the core's counter at the write, so a routine hears `on_slot` only for a new feed, not for the sim service's rewrite, and an ended slot holds its end mark until the next feed.
  `Frame::now` is the routine host's estimate of the core's counter, so `Follow`'s `f.now - DELAY` and the samples it reads are on the core's timeline ([the core's counter in our module](../flight-model/01-flight-model-sync.md#the-cores-counter-in-our-module)).
- **Its life:** the routine host makes a routine new at the first feed after it was ended or went unfed, and drops it at its end mark or once 1s passes with no write, so no routine carries state from one feeding into the next.
  A feature ends its routine when it's done with the work, as flight-model sync does when its pilot takes control, and the platform ends each of a feature's routines before it closes the feature's connection at unload, so the 1s timeout is only for a core that's gone.
- **How many:** a feature has a routine for each piece of work that starts and stops on its own, so following is one routine, `Follow`, and avatars' figure and its hand, which never exist apart, are one, `Figure`, with every figure in one slot of up to 8,192 bytes ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits)).
- **The platform's own:** preflight's `Hold`, which asks only for the freeze, is the platform's own routine, which lives in the routine host, since the module can't link the crates in the core that feed it, and is fed on the platform's connection.
  The platform ends `Hold` when preflight ends or when the session ends.
- **Through a gap:** `Follow` asks for the freeze in every frame it runs, so the aircraft stays frozen before its first sample is old enough to write and after it runs past its newest one.
  Past its newest sample, and before its first, `Follow` moves the frozen aircraft on, carrying it and then easing it in, and through a gap longer than 2s it holds the aircraft once the carry ends ([through a gap](../flight-model/01-flight-model-sync.md#through-a-gap), [its first frames](../flight-model/01-flight-model-sync.md#its-first-frames)).

The module never learns the session's state, so routines' slots replace the control slot of [decision 017](../../decisions/017-core-writes-control-slot-every-200ms.md), which the core writes every 200ms with the session's state and a counter, and a numbered decision records the change when step 8's decisions are numbered.
[Decision 005](../../decisions/005-wasm-module-writes-following-aircraft.md)'s 1s timeout stands with less to undo: it also clears every variable of ours that holds something back, and no v1 routine sets one, so the freeze is all that's left.

### What a routine can ask for

| A want | The routine host | When no running routine asks for it |
| --- | --- | --- |
| Read named variables, of the pilot's aircraft or of an object by its ID | Reads them during the routine's frame | Nothing to undo |
| Write named variables, on the pilot's aircraft or on an object by its ID | Writes them once every routine's frame has run | Nothing to undo: the sim's physics, or the object's last place, carries on |
| Freeze the pilot's aircraft | Reads the three freeze flags each frame, and freezes the aircraft when it isn't frozen | Unfreezes it, if it froze it |
| Send events with values, as `Follow` sends them for the yoke, rudder, and toe brakes ([what this adds to our WASM module](../flight-model/01-flight-model-sync.md#what-this-adds-to-our-wasm-module)) | Sends them once every routine's frame has run | Nothing to undo |
| Report, as `Lead` reports each read of the aircraft (same section) | Writes the report into the routine's report slot once every routine's frame has run | Nothing to undo |
| Fire an `H:` event ([`H:` events](../sync/05-units.md#h-events)) | Fires it once every routine's frame has run | Nothing to undo |

- The freeze is the one want that outlasts the asking, so it's the one the routine host undoes, and it releases only a freeze it set.
  FS Copilot's module shows what goes wrong otherwise: its timeout sends the unfreeze whoever froze the aircraft, and leaves the module's own `frz_by_me` set, so `interpolate` stays armed and writes whatever pose its buffer returns into the aircraft it unfroze (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `Update_StandAlone` and `interpolate`, and `stream_buffer.h`; not run).
  The routine host keeps no flag for a routine, since a routine that isn't running asks for nothing.
- Preflight's hold and `Follow` both ask for the freeze, and the routine host freezes while either asks, so when preflight ends and following starts in one frame, the aircraft never unfreezes between them.
- No two of v1's routines write the same variable.
- Which of the sim's APIs carries each want is the routine host's, as [wants and the sim's APIs](../core/03-sim-seam-and-wasm-module.md#wants-and-the-sims-apis) gives them, and no routine sees it.
- A routine that needs a want this table lacks adds it to the routine host, and that's the only change to the routine host a new routine makes.

### When the module stops

A module whose code hits an error goes `DIRTY`, and the sim stops running it (documented, [05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md#debugging-crashes-required-exports)), so one routine's error would stop every routine, and with them the routine host, which would unfreeze the aircraft; whether a Rust panic, which traps, puts our module there is unverified, since our records hold no module crash.
So the core unfreezes it.
When the module's counter hasn't moved for 3s, in a flight that's neither loading nor paused, while a routine of ours is live, the core takes the module as stopped and raises its notification.
It unfreezes the aircraft when the last routine that holds the freeze ends, as its pilot takes control or leaves (user, 2026-10-23; [architecture log](log.md#2026-10-23-a-review-against-the-simplicity-rule-cut-eight-guards-and-kept-every-designed-feature-it-questioned)).
To unfreeze it, the platform's connection sends `K:FREEZE_LATITUDE_LONGITUDE_SET`, `K:FREEZE_ALTITUDE_SET`, and `K:FREEZE_ATTITUDE_SET`, each with 0, in the input that ends the routine, with no read of the flags first, so a quit's exit, which takes no input after it, still carries them out; a client outside the sim released a frozen Baron that way (measured on MSFS 2024, 2026-10-03, [flight-model log](../flight-model/log.md#2026-10-03-freezing-holds-the-pose-but-not-the-velocities-so-a-follower-has-to-write-them-all)).
The core takes a freeze then to be ours, since a module with no routine live froze nothing ([the module's status](../core/03-sim-seam-and-wasm-module.md#the-modules-status)).
A pause is left out because whether the sim runs a standalone module's update during a pause is unmeasured ([05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md#lifecycle-init-per-frame-update-deinit)).
Each routine's crate denies Clippy's `unwrap_used`, `expect_used`, `panic`, and `indexing_slicing` lints (documented, [Clippy's lints](https://rust-lang.github.io/rust-clippy/master/index.html)), so the commonest panics, an `unwrap`, an `expect`, a `panic!`, and an index out of range, fail its build.

### Modules in the panel bridge

- The sim loads our `VCockpit.js` override into every cockpit panel, and the override is the sim's file plus a few guarded lines, which load the bridge's own file and queue each instrument the sim creates before that file has loaded, in `DUALINPUT_BRIDGE_PENDING`, as FS Copilot's copy does ([06-02](../../learn/foundations/06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open)).
  Everything of ours beyond those lines is in files of its own, so a mistake in one of them stops no instrument.
- A feature registers each panel module with a rule for which panels get it, as pointer sync's takes the panels its profile's [`displays`](../profiles/01-format-and-delivery.md#displays) names, and the core answers a panel's first message with the modules to load ([decision 011](../../decisions/011-cockpit-panels-connect-only-in-session.md)) once the profile has loaded, since a panel can connect before it does ([01-spine](01-spine.md#the-sims-pages)).
- A cockpit panel's first message names its panel, such as `VCockpit66`, and a first message naming the panel another socket holds replaces that socket, and the core closes the old one, since a page's socket stays open after a reload ([decision 010](../../decisions/010-clients-message-core-every-2s.md)).
  The core matches the panel rather than the instruments, since two of the Black Square Baron's panels each hold an instrument keyed `GNS_DISABLED`, and matching the instruments closed a live socket (user, 2026-10-22; [core log](../core/log.md#2026-10-22-stage-5s-bridge-loads-in-all-20-of-the-barons-panels-joins-the-core-on-a-sessions-announcement-and-leaves-the-cockpit-whole-when-bridgejs-is-missing-or-throws-but-two-panels-shared-an-instrument-key)).
  A press sent to the old socket that its panel never played is skipped and counts as applied, as a press for a display whose panel hasn't announced itself does ([the cockpit stream](../sync/04-order-and-recovery.md#the-cockpit-stream)).
- The bridge loads each panel module from its own file and calls its `start` and `stop` each in a `try`, so one that throws stops only itself.
  Whether a file that fails to parse stops the bridge's later loads in its panel is unverified, and a case for the bench settles it.
- A panel module and its feature trade messages from the message crate over the panel's socket, tagged with the module's name ([decision 025](../../decisions/025-messages-in-one-rust-crate.md)).
- A plugin ships no panel code, and v1 builds no plugins, so the bridge holds no `ops` module for their operations; a value in a gauge's JavaScript that a profile's `instrument()` names is read by state sync's panel module `instrument-reads` ([reading it in the panel](../plugins/01-plugins.md#reading-it-in-the-panel)).
- A panel module can read an aircraft's CommBus.
  Of the 43 CommBus names that only the A220's other panels listen on, 39 sent something during the run, and a listener of ours in one panel heard all 39; it also asked for the aircraft's full state with `A22X.Resync` (measured on MSFS 2024, 2026-09-28, [CommBus log](../commbus/log.md#2026-09-28-a22xresync-returns-the-a220s-full-state-and-one-listener-hears-every-channel)).
  So the bus bridge and the A220's adapter, which come after v1, read the A220's bus from a panel module, whether or not a SimConnect client can hear it.

```ts
// a sketch: pointer sync's panel module, built by esbuild at es2017 into pointer-sync.js
DUALINPUT_BRIDGE_API.define("pointer-sync", {
  start(ctx) {
    for (const display of ctx.instruments) capture(display, ctx);   // the instruments `load` named for this module
    ctx.on("gesture", play);                                       // another pilot's Down, Move, Held, or Up
  },
  stop() { /* removes its listeners; the bridge drops its locks */ },
});
```

### What the bridge owns

The bridge owns only what can block the pilot's input:

- **Locks:** a lock is an overlay the bridge places for pointer sync, either a visible one over a display blocked through an outage, or an unseen one while another pilot's gesture replays, as FS Copilot's panel code places both ([pointer sync](../product/03-v1-scope.md#pointer-sync); [06-02](../../learn/foundations/06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open)).
  The bridge's hit test looks past its own overlays, as FS Copilot's sets its overlay's `pointer-events` to `none` around `elementFromPoint` (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/overlay.js`, `hitTest`), so a gesture replayed under either lock still reaches the display.
  A visible lock holds only while the core renews it over the panel's socket every 2s, and 8s to 10s after the last renewal turns into a warning that blocks nothing, as FS Copilot's does ([01-spine](01-spine.md#what-moves-them)).
  The unseen lock lapses 2s after the panel module last renews it, and no message from the core renews it; a press that lands on it paints it until that press's up, and a lock a blocked press is held on stays until that up ([locks](../pointer-sync/01-pointer-sync.md#locks)).
  The panel module that asked for a lock stopping, or the socket closing, drops it at once.
- **Later wrappers and CommBus handlers:** no v1 panel module wraps one of the sim's APIs or listens on the CommBus.
  A later one asks the bridge to install a wrapper, and the bridge suppresses the wrapped call only for one dispatch and clears that unconditionally afterward, restores the original through `window.DUALINPUT_BRIDGE_UNLOCK()`, and uninstalls the wrapper after 120s idle: the rules the FS Copilot fork took from a probe whose wrapper left an A350 display taking no clicks ([06-02](../../learn/foundations/06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open)).
  The bridge also runs each CommBus handler of ours in a `try`, since `Coherent._trigger` calls a name's handlers with no `try`, so one that throws would stop the aircraft's own handlers after it (read in the sim's `Coherent._trigger`, [CommBus log](../commbus/log.md#2026-09-28-a-script-that-arrives-after-a-panel-loaded-can-list-every-commbus-name-the-panel-registered); not run).
- **The fixed global:** `window.DUALINPUT_BRIDGE_UNLOCK()` removes every lock and wrapper in its document and stops every panel module, from the inspector or any other console.

Anything else a panel module adds, such as pointer sync's listeners, its own `stop` removes, and one it leaves behind reads clicks and sends to a closed socket, blocking nothing.
FS Copilot's panel code, by contrast, replaces `EventTarget.prototype.addEventListener` in every document and never puts it back ([06-02](../../learn/foundations/06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open)).

### How work in the sim ends

| What happens | Our WASM module | Panel bridge |
| --- | --- | --- |
| A feature is done with some work, such as its pilot taking control | The feature ends the routine, and the routine host drops it on the next frame | The feature stops the panel module, and the bridge drops the module's locks |
| The profile unloads, or the session ends | The platform ends each of the feature's routines, then closes its connection | The core stops each panel module, and a panel left with none closes its socket |
| The core hangs | 1s with no write leaves every routine unfed | Each visible lock turns into a warning 8s to 10s after its last renewal |
| The core exits | The same | Its socket closes, and the bridge stops every panel module and drops every lock |
| Our own code in the sim stops | The module goes `DIRTY`, the core raises its notification, and the core unfreezes the aircraft when the last routine that holds the freeze ends | A bridge that never loaded sends no first message, and the core reports it ([decision 011](../../decisions/011-cockpit-panels-connect-only-in-session.md)) |
| A person steps in | Nothing to call | `window.DUALINPUT_BRIDGE_UNLOCK()` |

### Budgets for work in the sim

Each is a starting value, which [node 7](plan.md#7-testing) measures:

- Our module's update, every routine's frame and the routine host's work together, takes under 0.1ms a frame at p99, plus `Traffic`'s, under 0.1ms with 25 moving copies ([traffic and ATC's budgets](../traffic-atc/01-traffic-and-atc.md#budgets)); the sim's WASM Debug window graphs each module's time per update (documented, [05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md#debugging-crashes-required-exports)).
- The panel modules add no frame time we can measure.
  Only sockets are measured so far: one in each of the PA-24's 16 cockpit panels added none ([01-spine](01-spine.md#the-sims-pages)).

### Cases for the bench, for work in the sim

- When a pilot takes control, their aircraft unfreezes on the first frame after `Follow`'s end mark arrives, flies on from the velocities last written, and is still flying 5s later.
- When preflight's hold ends and following starts in one frame, the aircraft stays frozen through it, and `Follow` carries it on through the first 400ms, before it has a sample old enough to write.
- Through a 20s gap in the flying machine's data, the following aircraft stays frozen, carried for 2s and then held.
- A routine fed again after its end mark starts with nothing from its last feeding.
- With the core killed, the following aircraft unfreezes within 1s of the last write, plus a frame.
- With the module stopped by an error, from a test routine built to panic, the module goes `DIRTY`, the core raises its notification within 3s of the counter's last tick, and the core unfreezes the aircraft when the last routine that holds the freeze ends, while the counter stalling through a flight load or a pause raises no notification and unfreezes nothing.
- A panel module that fails to parse, or throws in `start`, leaves the other panel modules in its panel running.
- With the core suspended, a locked display's overlay turns into a warning within 10s, and `window.DUALINPUT_BRIDGE_UNLOCK()` removes it at once.
- With the core's socket closed, every lock drops and every panel module stops at once.
- A panel that reloads mid-session gets its panel modules again on its new socket, and the core closes the old one.
- A CommBus handler of ours that throws leaves the aircraft's handlers after it running.

## Names the sim shares

Every name of ours in a namespace the sim shares with other packages, a panel's globals, the CommBus, client data areas, SimObject titles, and `L:` and `Z:` variables, is `DUALINPUT_`, a kind, `_`, and a name, so a reader can tell what owns it at a glance, and names of two kinds never collide (user, 2026-10-15).
Without the kind, a routine whose ID was `MODULE` would take the client data area of the module's own status.
A probe's kind is its ID, as in p08's `L:CROSSCHECK_P08_ECHO`, which carries the product's earlier name ([architecture log][flight]).

| Kind | Where the sim shares it | Owner | Names |
| --- | --- | --- | --- |
| `ROUTINE` | Client data areas | routine-host | One for each routine, by its ID: `DUALINPUT_ROUTINE_HOLD`, `DUALINPUT_ROUTINE_LEAD`, `DUALINPUT_ROUTINE_FOLLOW`, `DUALINPUT_ROUTINE_FIGURE`, `DUALINPUT_ROUTINE_TRAFFIC`, and `DUALINPUT_ROUTINE_H_EVENTS` |
| `REPORT` | Client data areas | routine-host | One for each routine that reports, by its ID: `DUALINPUT_REPORT_LEAD` ([what this adds to our WASM module](../flight-model/01-flight-model-sync.md#what-this-adds-to-our-wasm-module)) |
| `MODULE` | Client data areas | routine-host | `DUALINPUT_MODULE_STATUS` |
| `CORE` | The CommBus | sim-service | `DUALINPUT_CORE_ANNOUNCE` |
| `BRIDGE` | A cockpit panel's `window` | panel-bridge | `DUALINPUT_BRIDGE_API`, `DUALINPUT_BRIDGE_PENDING`, and `DUALINPUT_BRIDGE_UNLOCK` |
| `MENU` | The menu document's `window` | The menu script | `DUALINPUT_MENU_LOADED`, which our BlurPage copy sets as it loads the script, so the script loads once in each document |
| `FIGURE` | SimObject titles, and `Z:` variables | avatars | The figure's title, `DUALINPUT_FIGURE_PILOT`, and `Z:DUALINPUT_FIGURE_` and each joint's channel ([avatars' names](../avatars/01-avatars.md#names)) |
| `UI` | The EFB document's `window`, and the sim's keyboard calls | The kit, `@dualinput/ui` | `DUALINPUT_UI_RELEASE_KEYBOARD`, which gives back the keyboard a text field took, and `DUALINPUT_UI_FIELD`, the field's name in `UNFOCUS_INPUT_FIELD` |
| `EFB` | The EFB document's `window`, and `L:` variables | efb-shell | `DUALINPUT_EFB_REGISTERED`, which says our app has registered, so a script loaded twice registers once; and `L:DUALINPUT_EFB_ON_SCREEN`, which says our app is on screen, so the banner hides what the app shows ([the banner's box](../interface/decisions.md#the-banner-is-a-box-of-opaque-cards-at-the-screens-top-right)) |
| `BANNER` | `L:` variables, and the sim's panels and icons | The banner's page | `L:DUALINPUT_BANNER_OPEN_EFB`, which a click on a card raises while no core can carry it ([a notification's click](../interface/decisions.md#a-notifications-click-opens-the-efb-app-where-its-explained-or-acted-on)); `L:DUALINPUT_BANNER_RESIZED`, which asks the EFB app to open the panel anew once the sim's window changed; and `PANEL_DUALINPUT_BANNER` and `ICON_TOOLBAR_DUALINPUT_BANNER`, the panel and its toolbar icon, which start with what the sim's own names for those start with |

A unit that needs a name of a new kind adds the kind to this table.

## The workspace

One repository holds all of Dual Input: its programs, our WASM module, our code in the sim, the backend, and the profiles (user, 2026-10-15).
Its code sits in `src/`, in folders that follow the [tiers](#tiers), and each feature keeps every part it has in one folder; what builds and checks the code sits beside `src/` in `tools/` (user, 2026-10-23; [decisions](decisions.md#one-repository-holds-all-of-dual-input-its-folders-by-tier-with-each-features-parts-in-one-folder)).
One Cargo workspace builds every Rust crate, the module's among them, and one npm lockfile covers every TypeScript folder; `tools/build.ts`, run by Node, builds every target but the backend and the profiles, and every build that reads the SDK reads the one copy `tools/setup.ts` installs.
CI runs on Windows, and one script checks both the crates and the TypeScript imports against this map.

```text
dualinput/
  Cargo.toml  Cargo.lock  package.json  package-lock.json  rust-toolchain.toml
  .cargo/config.toml     links every x86_64 program's C runtime statically, and sets ts-rs's
                         TS_RS_EXPORT_DIR and TS_RS_LARGE_INT
  msfs-sdk.txt           the SDK version every build uses
  src/
    engines/<name>/      each engine in the units' table, such as messages/ and sync-engine/
    platform/<name>/     each unit of the platform, such as kernel/ and routine-host/
    features/<name>/
      core/              its crate in the core
      routines/          its routines in our WASM module
      panel/             its panel modules
      desktop/  efb/     its sections of the desktop app and the EFB app
    apps/
      core/  core-helper/  each program's main, and its list of features
      desktop/           Tauri: its Rust side, and its pages built by Vite
      ide/               the Dual Input IDE, once it's built
    sim-package/
      wasm-module/       the cdylib cargo-msfs builds: the edge
      routines/          the module's list of routines, which the module and the core's bench build link
      pages/             the VCockpit.js override, the EFB app, the banner, the menu script
      stock/             the sim's stock files our copies start from
    backend/             the Cloudflare Worker, on D1, with no framework
    relays/              each relay's region, URL, and cap, and the script that deploys them
  profiles/              aircraft/ and modules/, as 01-format-and-delivery's repository
  tools/                 build.ts, check.ts, setup.ts, stock.ts, release.ts, the map check, and prose-lint;
                         profile-builder/, profile-author/, msfs-sdk/, and the bench
```

A feature has only the parts it needs: pointer sync has a crate in the core and panel modules, and no routines or sections in the apps.
Avatars keeps its figure's SimObject in its folder too, in `src/features/avatars/figure/`.
Deleting one deletes its folder, its modules in the message crate and the profile engine, and its line and its dependency in each assembly in `src/apps/` and `src/sim-package/`.
The root `Cargo.toml` names its members by globs, such as `src/features/*/core`, so deleting a feature's folder takes its crates out of the workspace with no edit there, and `default-members` takes the same globs but leaves out `src/sim-package/`, whose module's build script needs what cargo-msfs sets; Cargo took globs in both lists (measured on our development machine, 2026-10-15, [architecture log][p12]).
Cargo refuses a member glob that matches no folder, or a folder without a `Cargo.toml`, so the root `Cargo.toml` adds each tier's glob with the tier's first crate, and its `exclude` names each folder of TypeScript a glob would match, such as `src/engines/page-client` ([build log][stage-1]).
A feature's block that a released level of the profile format holds stays in the profile engine after the feature goes, since levels only add ([levels](../profiles/01-format-and-delivery.md#levels)).

### Building every target

| Target | Built by | From |
| --- | --- | --- |
| The core, the core helper, the desktop app's Rust side, and the profile builder | `cargo build`, for x86_64 | The workspace's root |
| Our WASM module | cargo-msfs, for wasm32 | `src/sim-package/wasm-module/` |
| Our code in the sim: the bridge, panel modules, and the sim's pages | esbuild at `es2017` ([decision 030](../../decisions/030-in-sim-code-es2017-esbuild.md)), then the Coherent GT check ([decision 031](../../decisions/031-coherent-gt-check-tool.md)) | `tools/` |
| The desktop app's pages and its program | `tauri build --no-bundle`, which runs Vite for the pages and then builds the Rust side ([what a release holds](../build/01-the-build.md#what-a-release-holds)) | `src/apps/desktop/` |
| The backend | wrangler | `src/backend/` |
| The messages' TypeScript types | ts-rs, which writes them during `cargo test` into the folder `TS_RS_EXPORT_DIR` names (documented, [ts-rs 12.0.1](https://docs.rs/ts-rs/12.0.1/ts_rs/)) | `src/engines/messages/` |
| The profiles' bundles | `tools/profile-builder`, on `profile-build` | `profiles/` |

- **Our WASM module is a member of the workspace,** left out of `default-members` with the rest of `src/sim-package/` because its build script needs what cargo-msfs sets, and cargo-msfs builds it from its own folder.
  p11 built it that way against the same message crate as the Windows side, in one `target/` folder and one `Cargo.lock`, and building either side after the other compiled no crate ([architecture log][p11]).
  cargo-msfs refuses a crate whose build outputs more than one file (read in navigraph/cargo-msfs v1.1.0, `src/main.rs`, Build), so `src/sim-package/wasm-module/` is a cdylib alone, and the routine host, the routines, and the module's list of them in `src/sim-package/routines/` are crates of their own, which node 7's bench can link natively.
- **One copy of the SDK** is the version `msfs-sdk.txt` names, which `tools/setup.ts` installs through `tools/msfs-sdk` into cargo-msfs's data folder, `%APPDATA%\cargo-msfs\data\msfs2024`, which holds SimConnect's header, its import library, and `SimConnect.dll` (read on disk, SDK 1.8.1, 2026-10-15; [the SDK](../build/01-the-build.md#the-sdk)).
  The bindings' build scripts read the SDK from `MSFS_SDK`, which cargo-msfs sets for the module, fall back to that folder for the Windows side, and fail with a message naming `node tools/setup.ts` when the installed SDK isn't that version.
  The one copy serves the Windows side's bindings too ([build log][stage-3]).
- **The bindings follow the SDK:** bindgen generates them at each build, so no file derived from the SDK's headers is in the repository, and tells Cargo every header it read (read in bindgen 0.72.1, `src/lib.rs`, `CargoCallbacks`), so a new SDK in the same folder generates them again.
  cargo-msfs installs only the newest SDK, with no way to name a version (read in navigraph/cargo-msfs v1.1.0, `src/sdk.rs`, `install_latest_sdk`), so `tools/msfs-sdk` installs the one `msfs-sdk.txt` names, the build prints the version it built against, from the `version.txt` `tools/msfs-sdk` writes beside the SDK, and CI keys its cache on it.
- **`RUSTFLAGS` is never set,** in CI or in our tools, because cargo-msfs hands the build its caller's environment after setting `RUSTFLAGS` to its own link arguments (same function as above, Build), and ours would replace them; Clippy's `-D warnings` goes on Clippy's own command line.
  `src/apps/core` stops a build whose `RUSTFLAGS` replaced the static C runtime that the root's `.cargo/config.toml` sets ([the C runtime](../build/01-the-build.md#the-c-runtime)).
- **The release profile is the root's,** with `lto` and `strip` on, as cargo-msfs's README asks, since a workspace reads profiles only from its root.
  So is the bench's, `release-with-checks` ([building what it runs](../build/02-testing.md#building-what-it-runs)).
- **The messages' TypeScript types** are generated into `src/engines/messages/ts/`, the folder `TS_RS_EXPORT_DIR` names.
  The root's `.cargo/config.toml` sets it and `TS_RS_LARGE_INT`, so a plain `cargo test` writes the types, typed as [decision 025](../../decisions/025-messages-in-one-rust-crate.md) asks ([build log][stage-1]).
  `tools/build.ts` deletes the folder before it runs the message crate's tests, since ts-rs removes no file it wrote before, so a deleted message's type would stay (read in ts-rs 12.0.1's source, which calls no `remove_file`).
  The types are committed and imported from there, and CI generates them again and fails on any difference, which answers the spine's [left open](01-spine.md#left-open) item on that check.
  ts-rs's derives built into the module in p11, so the message crate needs no second form for wasm32.
  The message crate's build script writes its hash, running again only when what it hashes changes, and the `cargo test` that writes ts-rs's types also writes `ts/stamp.ts`, with the version and the hash, which that check covers ([the message crate's hash](../build/01-the-build.md#the-message-crates-hash)).
- **TypeScript** has one lockfile at the root, and two npm workspaces, each with a `package.json` of its own beside the root's: `src/apps/desktop/`, because the Tauri CLI takes the folder it runs in when that holds a `package.json` (read in tauri-apps/tauri, its default branch on 2026-10-15, `crates/tauri-cli/src/helpers/app_paths.rs`), and `src/backend/`, since Cloudflare recommends installing wrangler in the project (documented, [Wrangler's commands](https://developers.cloudflare.com/workers/wrangler/commands/)).
  A feature's TypeScript folders have no `package.json` of their own.
  Each target's tsconfig sets its own `lib`: ES2017 for our code in the sim, as decision 030 sets it, the latest with the DOM for the desktop app's pages, and the Workers' types for the backend.
  The desktop app's stylesheet names `src/features/*/desktop/` as a source with Tailwind's `@source`, since Tailwind's Vite plugin scans only below Vite's root (read in @tailwindcss/vite 4.3.3, `dist/index.mjs`, in node 5.4's review), and a feature's section would otherwise render unstyled.
- **One version** lives in the root `Cargo.toml`'s `[workspace.package]`, which every crate inherits, as [decision 026](../../decisions/026-first-message-carries-version-and-hash.md) asks; Tauri takes the desktop app's from its crate when `tauri.conf.json` names none (documented, [Tauri's configuration](https://v2.tauri.app/reference/config/#version)), and since Tauri's CLI reads a version the crate inherits and its build script doesn't, the version reaches the desktop app's Windows version resource through `tauri build --config` ([each component's version and hash](../build/01-the-build.md#each-components-version-and-hash)); the build writes it into the Community package's `manifest.json`, where p08's build script wrote a fixed one (read in `experiments/areas/architecture/flight/build.mjs`, `finish`).
- **`tools/build.ts`** builds every row of the table but the backend's and the profiles', then lays out the Community package with its `layout.json` and `manifest.json`, as p08's build script does.
  Node 22.18 or later runs it by stripping its types, so our build scripts use no `enum` and name each import's `.ts` (documented, [Node's TypeScript support](https://nodejs.org/api/typescript.html)).
  `node tools/build.ts install` copies a development build's package into `Community`, since only an installed desktop app writes it ([our package](../build/01-the-build.md#our-package)).
- **Packing a release** takes `vpk`, which needs the .NET 8 SDK on the build machine (documented, [Velopack's Rust guide](https://docs.velopack.io/getting-started/rust)).
- **`tools/setup.ts`** installs cargo-msfs at the tag it names, the one CI installs too, then installs the SDK version `msfs-sdk.txt` names into cargo-msfs's folder through `tools/msfs-sdk`.

On a new PC, in order:

1. Install Visual Studio's Build Tools, with its C++ workload.
2. Install rustup, then run `rustup toolchain install` in the repository, for the toolchain and the `wasm32-wasip1` target that `rust-toolchain.toml` names.
3. Install LLVM, for bindgen.
4. Install Node, at the version `package.json`'s `engines` names.
5. Run `npm ci` at the root.
6. Run `node tools/setup.ts`; `%APPDATA%\cargo-msfs\data\msfs2024\version.txt` appears.
7. Run `cargo build`, `cargo test`, and `node tools/build.ts`; each finishes without an error.

### Profiles in this repository

The profiles, plugins, and modules that [01-format-and-delivery](../profiles/01-format-and-delivery.md#the-repository) puts in a public repository of their own live in `profiles/` here instead, with `aircraft/` where that repository has `profiles/` (user, 2026-10-15).

- An import still names a module's path without `.yaml`, from `profiles/`, so `modules/gns-430` names `profiles/modules/gns-430.yaml`.
- CI checks and builds the profiles against the profile engine at the same commit, and fails when a released level's schema or declarations differ from what its release tag holds, so a bundle it publishes loads in every released core at its level.
  It also reads each bundle back against its level's frozen schema and compiles every script at one target, and nothing holds a released level's builder output to its release tag ([publishing](../profiles/02-units.md#publishing)).
  It publishes them on this repository's GitHub Pages site, from a `pages` branch it only adds files to, on each merge that changes a bundle and on each release, and only bundles at levels a release supports.
  A repository has one Pages site (documented, [About GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)), which the profiles take, and an account on GitHub Free for organizations serves one only from a public repository (documented, [Creating a GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)), which this one is from v1 (user, 2026-10-15).
- Nobody outside the core team gets write access (user, 2026-10-15), so the profiles have no `CODEOWNERS` file, whose code owners must have write access (documented, [About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)), and a role narrower than write takes GitHub Enterprise Cloud (documented, [About custom repository roles](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/about-custom-repository-roles)).
  The core team reviews and merges every profile's pull request, and the people a profile's `authors` names review it as anyone with read access can (documented, [About pull request reviews](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews)), without their approval counting toward a merge, since only approvals from people with write access count (documented, [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).
- An author can clone the repository without file contents and check out only `profiles/` and the files at its root, which git's sparse checkout keeps in its default cone mode (documented, [git sparse-checkout](https://git-scm.com/docs/git-sparse-checkout)), or edit a profile on GitHub's site, which forks the repository and proposes the change as a pull request (documented, [Editing files](https://docs.github.com/en/repositories/working-with-files/managing-files/editing-files)); the profiles' contributor documentation shows both:

  ```bash
  git clone --filter=blob:none --sparse https://github.com/dual-input/dualinput.git
  ```

  ```bash
  cd dualinput
  ```

  ```bash
  git sparse-checkout set profiles
  ```

### CI

CI runs on Windows runners only (user, 2026-10-15), because Dual Input runs only on Windows:

- Our code runs in CI on the system it runs on for pilots, which matters to its floating-point results, since Rust's `f64` functions reach the C runtime's math, whose results change with its FMA3 switch and with its version ([core log](../core/log.md#2026-10-15-a-high-resolution-waitable-timer-wakes-within-15ms-where-tokios-wake-up-to-17ms-late-and-the-cores-math-changes-with-the-c-runtimes-fma3-switch-and-with-its-version); [left open](#left-open)).
- One toolchain setup serves every job.

Windows runners build slower than Linux ones: in one report, a project's crates built up to nearly 2x slower on Windows on two unlike machines, and about 13s against 18s on one cloud instance, with a whole build nearly 70% slower (documented, [rust-lang/rust#66192](https://github.com/rust-lang/rust/issues/66192)), and the first stage of [node 8](plan.md#8-the-build-order) that builds real code measures ours.

A pull request that changes code runs Rustfmt, Clippy, and the tests of the default members; builds the module and checks its exports against the list p03 checked; type-checks each tsconfig and runs the Coherent GT check on every file we ship into the sim; generates the messages' types and checks for a difference; runs the map check; checks the files compiled with the sim against their sources' hashes, and the stock files against `stock.json`; and checks and builds the profiles.
`node tools/check.ts` runs each of these checks that the tree has something for ([build log][stage-1]).
A pull request that changes only `profiles/` runs the profiles' job alone, through conditions on each job rather than on the workflow, so the checks a merge requires still report, and it needs no SDK, so a new SDK can't fail it.
CI installs Rust with rustup and sets `LIBCLANG_PATH`, each step runs one command, and the profiles' job is a reusable workflow the release workflow calls too ([CI](../build/01-the-build.md#ci)).

### The map check

The code map's [third test](#tiers) is a script in `tools/` that CI and a developer both run, and it checks each rule [tiers](#tiers) lists.

- A crate's tier is its folder, from the `manifest_path` that `cargo metadata` gives each crate, and the script reads the resolved graph, crates from outside the workspace included, so a routine that reaches tokio through any crate fails.
- A TypeScript file's tier is its folder, and the script takes each file's imports from `tsc --explainFiles`, the TypeScript compiler's own resolution, which lists type-only ones ([build log][stage-1]), since esbuild's metafile listed no import for a file whose only import was `import type` (measured on our development machine, 2026-10-15, esbuild 0.28.2, [architecture log][p12]).
- The message crate and the profile engine each hold every feature's module, so the crate graph can't show one feature using another's there; the script searches each feature's source for the names of other features' modules.
- The script also searches `src/features/` for `impl Moment`, so no feature raises a moment of its own ([moments](../core/01-loop-and-edge.md#moments)).
- The script also fails a platform unit, in Rust or TypeScript, whose source names a feature's module of the message crate, which [tiers](#tiers)' rules allow, since the message crate is an engine ([a feature's parts](../interface/01-apps.md#a-features-parts)).
- The script finds the loop's crates by folder, as [tiers](#tiers) defines them, so it checks a new feature's crates with no edit.
- The crates that do I/O are a list in the script, and a loop crate that reaches one through any other fails:
  - runtimes and event loops: tokio, mio, async-std, smol, async-io, polling
  - networking: socket2, hyper, reqwest, ureq, tungstenite, tokio-tungstenite, axum, iroh, iroh-relay, quinn, noq
  - Windows: windows, windows-sys, winapi
  - randomness: getrandom
  - files and the system: notify, sysinfo, tempfile, walkdir, dirs
  - logging's output: tracing-subscriber, tracing-appender, env_logger
  - the desktop app and audio: tauri, wry, cpal, wasapi
  - ours: the transport and the sim edge
- The script reads normal dependencies only, so a build dependency such as bindgen, which reads the SDK's headers while simconnect-types builds, never trips it.
  It follows no proc macro's own dependencies either, since a proc macro runs in the compiler too: ts-rs's derive reaches `windows-sys` through `termcolor` ([build log][stage-3]).
  A proc macro of ours still keeps the tiers' other rules.
  A listed crate the script lets a loop crate reach anyway carries its reason in the script.
- p10's loop has 11 crates besides itself among its normal dependencies, rquickjs and zstd among them, none on the list (measured on our development machine, 2026-10-15, [architecture log][map]).
  p07's message crate turned on uuid's `v4`, which reaches `getrandom` (read in `experiments/areas/architecture/types/messages/Cargo.toml` and `types/Cargo.lock`), so the message crate keeps it off, as p11's did ([architecture log][p11]), and the kernel draws the IDs from the seed the core's edge hands it.
- The script also searches our crates' source for a foreign function's declaration outside the two edges and `src/apps/core`'s `_set_FMA3_enable`, which the crate graph can't show.
  That covers the desktop app, whose workspace `cargo metadata` leaves out, so its dependencies go unchecked: its one of ours is the message crate, which no rule forbids an app.
- The script holds `src/packages/` too: a package may use only packages, only the pages' shells, their sections, and the programs may use one, and neither page's code may reach into the other's.
- An outside crate that calls std's file, socket, or clock functions itself, rather than through a crate on the list, passes the check, so we review each new dependency of a loop crate before it's added.

cargo-deny can ban a dependency only by naming, for each crate, which crates may depend on it (read in torrust/torrust-tracker, `deny.toml`, at 9c8bcdf), so it would hold one entry per crate where the script holds each rule once.

### Budgets for the workspace

A pull request's CI finishes within 20 minutes with a warm cache, a starting value the first stage of [node 8](plan.md#8-the-build-order) that builds real code measures.

## Left open

- Whether a recording replays on a PC with a different CPU: Windows' C runtime picks its FMA3 math by CPU, and "Differences may also be observable between computers" ([5.1.1]), and Rust's `f64` functions reach that math ([core log](../core/log.md#2026-10-15-a-high-resolution-waitable-timer-wakes-within-15ms-where-tokios-wake-up-to-17ms-late-and-the-cores-math-changes-with-the-c-runtimes-fma3-switch-and-with-its-version)), so `src/apps/core` links the C runtime statically with FMA3 off; replaying a recording made on a friend's PC on ours settles it.
- What [a connection for each feature](#a-connection-for-each-feature-for-each-load) leaves unmeasured, and whether the edge's exception tags hold among writes each frame: [node 7](plan.md#7-testing)'s tests in the sim.
- Which operations an `ops` module in the bridge offers plugins, and how a plugin's API names the panels they reach: plugins' design, after v1 ([plugins and the sandbox](../plugins/01-plugins.md#what-this-answers)).
- Two cores in sessions on one sim would feed the same slots, which a developer running a development core beside the installed one doesn't do, so nothing guards against it (user, 2026-10-15).
- Which unit of the platform loads the EventBus bridge's listener into the EFB's document, which [04-room-for-later](../product/04-room-for-later.md#code-inside-the-sim) leaves open, for after v1.
- How long CI takes on Windows runners, and how much a warm cache saves: the first stage of [node 8](plan.md#8-the-build-order) that builds real code measures it with `cargo build --timings`, against [budgets for the workspace](#budgets-for-the-workspace).
- Which of the platform's hooks and moments plugins reach through QuickJS-ng, and whether a plugin needs a moment only a feature could raise, which this design gives no feature: plugins' design, after v1.
- The self-describing record a later version reads, which comes with the uploads after v1.

[flight]: log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start
[5.1.1]: log.md#2026-10-14-a-core-replays-a-whole-run-when-one-ordered-loop-owns-its-state-and-takes-every-input-stamped-through-one-queue-as-sans-io-cores-lmax-and-tigerbeetle-run-and-neither-actors-nor-simulation-runtimes-can-replay-a-run-from-a-pilots-pc
[p11]: log.md#2026-10-15-our-wasm-module-builds-with-cargo-msfs-from-inside-the-cores-cargo-workspace-against-the-same-message-crate-and-neither-build-disturbs-the-others
[p12]: log.md#2026-10-15-cargo-takes-globs-in-default-members-too-and-esbuilds-metafile-leaves-out-a-type-only-import
[map]: log.md#2026-10-15-cargo-refuses-two-crates-of-one-name-in-a-workspace-and-p10s-loop-reaches-no-crate-that-does-io
[stage-1]: ../build/log.md#2026-10-18-cargo-refuses-a-member-glob-that-matches-no-folder-or-a-folder-without-a-cargotoml-and-typescript-702s---explainfiles-lists-a-type-only-import
[stage-3]: ../build/log.md#2026-10-20-bindgen-builds-the-windows-sides-simconnect-types-with-the-static-c-runtime-and-ts-rss-derive-reaches-windows-sys
[every-input]: ../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour
[stage-8]: ../recording/log.md#2026-10-23-one-zstd-frame-flushed-each-second-keeps-a-busy-flights-recording-at-426-mb-an-hour-where-a-frame-ended-each-second-takes-667-mb
