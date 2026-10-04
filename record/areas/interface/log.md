# Interface: log

What our experiments found about showing Crosscheck to the pilot inside the sim, such as the notification banner and the EFB app, newest entry first.
The probes and their raw output are in [experiments/areas/interface](../../../experiments/areas/interface), with the results in its `results/` folder.

## 2026-10-04: A livery painting on an object of our own opens its document, but nothing it draws reaches the object's material

**Asked:** can an object of our own, held in front of the pilot's view, show HTML through a livery painting, the `[VPaintingNN]` kind of `panel.cfg` section the sim opened for an AI copy of the Baron ([entry below](#2026-10-04-an-ai-copy-of-the-pilots-aircraft-opens-its-livery-painting-and-none-of-its-cockpit-gauges))?

**Expected:** the painting would land on the material its `texture` names, as the Baron's tail number lands on `$RegistrationNumberExt` (read in bksq-aircraft-baronpro 0.1.1, `panel.N513LW/PANEL.CFG`, `[VPainting01]`).

**Found:** in the Black Square Baron 58P, parked, p02 spawned a StaticObject of ours with the card as a painting in its own `panel.cfg`, and held it 35cm ahead of the eye with the module.

- The sim opened a document for each, titled `VLiveryNN - CrosscheckP02Painting`, and handed it `globalLiveryData` with the painting's URL and size, 1024x512, and `uContainerID` 0, as it hands the Baron's own painting.
- Every painting document ran its frame loop about once every 2s, the Baron's own included: 14 frames to 15 in 2,034ms.
- Nothing the painting drew reached the panel in any of four variants: the panel showed its material's plain base color, or, on the Baron's registration material, the cockpit behind it washed out.

  | Variant | `location` | Material | Call after drawing |
  | --- | --- | --- | --- |
  | 1 | `exterior` | see-through, white | `RegistrationNumberLoaded`, the Baron's |
  | 2 | `exterior` | opaque, white | `VLIVERY_DATA_LOADED` with `false`, Asobo's live VDGS display's |
  | 3 | `interior` | see-through, white | `RegistrationNumberLoaded` |
  | 4 | `exterior` | the Baron's `$RegistrationNumberExt` recipe | `RegistrationNumberLoaded` |

  The calls come from the sim's own paintings: Asobo's VDGS display, which updates live, calls `VLIVERY_DATA_LOADED` with `false` 100ms after it connects, and its banner and text layer, drawn once, call it with `true` (read in asobo-vliveries, `pages/vlivery/paint/vdgs/vdgsdisplay.js`, `banner/banner.js`, and `textlayer/textlayer.js`).
- A removed object's painting document stayed open until the flight reloaded.

**Changed:** a livery painting on a StaticObject of ours doesn't show, and even where one shows it gets no input and runs about once every 2s, so the user dropped paintings for an interactive panel.
FSLTL's AI traffic paints its registrations with the sim's own `Registration.html` (read in fsltl-traffic-base, `FSLTL_LJ25/panel/panel.cfg`), and Asobo's VDGS paints onto some scenery object, so paintings do land on some objects that aren't the pilot's aircraft; which kinds is untested.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** p02's runs [from 07:14:52](../../../experiments/areas/interface/results/p02-floating-panel-2026-10-04-07-14-52.txt) and [07:17:57](../../../experiments/areas/interface/results/p02-floating-panel-2026-10-04-07-17-57.txt) for variant 1, and [from 07:39:42](../../../experiments/areas/interface/results/p02-floating-panel-2026-10-04-07-39-42.txt) for variants 2 to 4, each with its screenshots in the folder of the same name; the variants are in [panel/build.mjs](../../../experiments/areas/interface/panel/build.mjs).

## 2026-10-04: An AI copy of the pilot's aircraft opens its livery painting and none of its cockpit gauges

**Asked:** does the sim run an aircraft's cockpit gauges on a copy of it that isn't the pilot's, which decides whether a floating panel of ours could carry a gauge by being an aircraft?

**Expected:** no prediction.

**Found:** with the pilot in the Black Square Baron 58P, p03 spawned a second Baron 58P as an AI object 40m ahead.
The inspector on 127.0.0.1:19999 listed 20 cockpit pages, `VCockpitNN - …`, before and after; the only page added was `VLivery02 - BksqBaronLiveryRegistration`, the copy's tail-number painting.

**Changed:** together with the [entry below](#2026-10-04-an-object-of-our-own-gets-no-gauge-from-its-own-panelcfg-and-a-gauges-texture-doesnt-reach-it-by-name), we infer that the sim runs cockpit gauges, HTML and WASM alike, only on the pilot's own aircraft (unverified beyond a StaticObject and an AI aircraft, and no SDK page we found says so).
An attachment's gauges do run as the pilot's aircraft's own: A2A's Aerostar 600 attaches its GTNs, KLN90B, and tablet as attachments that carry their own `panel.cfg` (read in a2a-aircraft-aerostar600 1.0.6, `presets/a2a/Base/config/attached_objects.cfg` and `attachments/a2a/*/panel/panel.cfg`), and the SDK says the sim "loads both _VPaintings_ and _VCockpits_" from an attachment's panel ([Modular SimObject Merging](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/Modular_SimObjects/Modular_SimObject_Merging.htm)).
The aircraft's own preset lists its attachments, and the user ruled out adding or overriding a file per aircraft for the panel.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** [p03's run](../../../experiments/areas/interface/results/p03-ai-gauges-2026-10-04-07-09-26.txt), whose record has both lists of page titles.

## 2026-10-04: An object of our own gets no gauge from its own panel.cfg, and a gauge's texture doesn't reach it by name

**Asked:** can an object of our own, held in front of the pilot's view by a module, carry an HTML gauge, a full panel like an EFB of our own?

**Expected:** unknown: an aircraft's screen is a material named in its `panel.cfg`, and nothing we'd read said whether the sim loads a `panel.cfg` for an object that isn't an aircraft.

**Found:** in the Black Square Baron 58P, parked:

- p02 spawned a StaticObject of ours whose material `$CROSSCHECK_P02_PANEL` follows the Baron's GTN screen recipe, with `[VCockpit01]` in its own `panel.cfg` putting an HTML gauge on it (read in bksq-aircraft-baronpro 0.1.1, `BaronProfessional_Base_INT.gltf` and `panel.CGVGI/PANEL.CFG`).
  The panel showed solid black, the inspector listed no page for the gauge, and the gauge's frame counter, `L:CROSSCHECK_P02_GAUGE_FRAMES`, stayed at 0, in two runs.
- The same panel with its material named `$TabletScreen`, the Baron's tablet screen, stayed black; the pilot says the tablet's gauge draws while the tablet is stowed.
- The module `crosscheck-p02-panel` held the panel 35cm ahead of the eye every frame, placed from `fsCameraGet` in the `SIMOBJECT` referential and the aircraft's pose led by 1 frame, with no errors over 2,264 frames in one run, and nothing in the cockpit hid it.

The WASM drawing calls don't help either: each takes a gauge's `FsContext`, such as `fsRenderCreateTexture(FsContext ctx, …)`, which a standalone module doesn't have (read in MSFS 2024 SDK 1.7.3, `MSFS_Render.h`).

**Changed:** a floating object of ours can't carry an interactive HTML panel, so the user split the job (2026-10-04): the floating banner shows notices and the pre-flight summary with no interaction, and the EFB app and the desktop app take the input.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) and the [EFB app](../product/03-v1-scope.md#efb-app) in the v1 scope.

**Evidence:** p02's runs [from 07:13:12](../../../experiments/areas/interface/results/p02-floating-panel-2026-10-04-07-13-12.txt) and [07:20:01](../../../experiments/areas/interface/results/p02-floating-panel-2026-10-04-07-20-01.txt), and the first run's record, `p02-floating-panel-2026-10-04-07-05-20.ndjson`, which was stopped before its report; the module's source is [panel/src/panel.cpp](../../../experiments/areas/interface/panel/src/panel.cpp).

## 2026-10-04: Build and Mount loads a new module with no sim restart, leaves PNG textures out, and a program can click it

**Asked:** how fast can a probe package with a module, models, and HTML change while the sim runs?

**Expected:** models with no restart, as for the avatar figure ([avatars log](../avatars/log.md#2026-10-03-build-and-mount-gives-a-freshly-spawned-figure-a-rebuilt-model-with-no-restart)), and a module only after a restart.

**Found:**

- After Build and Mount of `crosscheck-p02-panel` from the Project Editor, its module ran at once with no restart, and each Build and Mount after that restarted it: `L:CROSSCHECK_P02_ALIVE` started over from 0.
- Build and Mount built two asset groups added to the package definition only after the project was closed and opened again; before that the sim answered `CREATE_OBJECT_FAILED` for their objects.
- Build and Mount left our PNG out of the package, whether it sat in `texture/` or beside the model, and listed it in neither its inputs nor its errors, while it rewrote the model to point at `CROSSCHECK_P02_CARD.PNG.KTX2`; the panel showed the sim's missing-texture checkerboard.
- After one Build and Mount, the painting documents of objects removed earlier were gone and the pilot's view had moved, as when the flight reloads.
- A program can run Build and Mount with nobody at the machine: [click.mjs](../../../experiments/tools/click.mjs) clicked an empty part of the Project Editor to bring the sim forward, right-clicked the package, and clicked "Build and mount crosscheck-p02-panel".

**Changed:** a probe's package changes in about a minute with no restart, module included, as long as its asset groups stay the same.
How to get a texture into a package is open, and the baked card is parked.

**Affects:** [panel/build.mjs](../../../experiments/areas/interface/panel/build.mjs).

**Evidence:** p02's runs above, and the package's build output, read after each build.

## 2026-10-04: SimConnect_Text reports its texts as displayed, and the pilot didn't catch any of them

**Asked:** does `SimConnect_Text` show the pilot a notice, as a candidate for the [notification banner](../product/03-v1-scope.md#notification-banner), and can its menu type carry a choice such as "Disconnect and take control"?

**Expected:** a line of text on screen for the print and scroll types, and a menu with two choices for the menu type.

**Found:** in the Black Square Baron 58P, p01 sent three texts, each opened by a beep for the pilot to watch:

- `SIMCONNECT_TEXT_TYPE_PRINT_WHITE` for 6s: the sim answered `SIMCONNECT_TEXT_RESULT_DISPLAYED` at once.
- `SIMCONNECT_TEXT_TYPE_SCROLL_YELLOW` for 8s: the sim answered `SIMCONNECT_TEXT_RESULT_QUEUED`, and never `DISPLAYED`.
- `SIMCONNECT_TEXT_TYPE_MENU` for 15s, with a title, a prompt, and two choices: the sim answered `DISPLAYED`, and neither a selection nor `SIMCONNECT_TEXT_RESULT_TIMEOUT` followed.

The pilot, watching the screen at each beep, didn't catch anything appear; they didn't know where or how a text would show.

The MSFS 2020 SDK calls `SimConnect_Text` "deprecated and cannot be used in Microsoft Flight Simulator" ([SimConnect_Text](https://docs.flightsimulator.com/html/Programming_Tools/SimConnect/API_Reference/General/SimConnect_Text.htm)); we found no MSFS 2024 page for it, and the function is still in the 2024 SDK's `SimConnect.h` (read in MSFS 2024 SDK 1.7.3).

**Changed:** we dropped `SimConnect_Text` as a banner candidate without testing further, because an object of our own carrying an HTML gauge gives us control of how a notice looks and where it sits (decided by the user, 2026-10-04).
Whether the sim draws the texts somewhere stays unknown.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope, and the step 6 banner probe in the [plan](../product/plan.md#6-probes-that-retire-architecture-risks).

**Evidence:** [p01's run](../../../experiments/areas/interface/results/p01-simconnect-text-2026-10-04-05-50-31.txt).
