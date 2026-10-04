# Interface: log

What our experiments found about showing Crosscheck to the pilot inside the sim, such as the notification banner and the EFB app, newest entry first.
The probes and their raw output are in [experiments/areas/interface](../../../experiments/areas/interface), with the results in its `results/` folder.

## 2026-10-04: A banner drawn on an object of ours smears in motion and is clipped behind the cockpit, so we parked it for an in-game panel

**Asked:** how does a banner drawn on an object of ours, held 35cm ahead of the eye, look in use?

**Expected:** like a pair of AR glasses, with a slight lag that reads as inertia.

**Found:** the pilot, looking around the Black Square Baron 58P with the card and a banner up ([entries below](#2026-10-04-a-texture-we-write-ourselves-shows-on-our-panel-an-uncompressed-dds-shipped-by-a-copy-asset-group-with-its-ktx2json)), judged that its text smears while the view moves and that parts of the cockpit sometimes cut into it.
The panel that had loaded the broken KTX2 at the end of the eviction run showed the missing-texture checkerboard on a later spawn, though its file then held a good DDS, so the sim kept that failed read too.

**Changed:** the user parked the object route for the banner (2026-10-04) for a see-through in-game panel pinned to the right of the screen, which the sim draws in screen space and which takes clicks, so the banner can carry its own buttons again.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** the pilot's report; no run file.

## 2026-10-04: The sim lets go of a texture somewhere between 30s and 3.5 minutes after its object is removed

**Asked:** does the sim ever let go of a loaded texture, so that a texture file can carry a new picture again ([entry below](#2026-10-04-a-picture-written-over-a-texture-file-before-the-sim-first-loads-it-shows-on-the-next-spawn-and-once-loaded-the-sim-keeps-it))?
Every notice with new content, such as a seat that James holds now and Greg later, needs a texture the sim will read afresh.

**Expected:** no prediction.

**Found:** p04 wrote a notice stamped with the time over `CROSSCHECK_P02_Baked2`'s texture, which had loaded the 10:25:14 notice, and spawned the panel, three times:

- After the panel had been gone about 3.5 minutes, since 10:25:22: the new notice, drawn at 10:29:02, showed.
- After it had been gone 30s: the notice drawn at 10:29:07 didn't show, and the panel kept 10:29:02.
- After 120s: no result, because the sim wasn't in front and the screenshot caught the desktop instead; the screenshot tool saves nothing in that case since ([shot.mjs](../../../experiments/tools/shot.mjs)).

**Changed:** a texture file can carry a new picture once its panel has been gone long enough, between 30s and 3.5 minutes, so a banner can reuse a pool of texture files rather than spend one per notice for a whole flight.
The exact time, and whether anything other than time lets a texture go, are untested.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** [p04's run from 08:29:02](../../../experiments/areas/interface/results/p04-texture-rewrite-2026-10-04-08-29-02.txt) and its first two screenshots.

## 2026-10-04: A picture written over a texture file before the sim first loads it shows on the next spawn, and once loaded the sim keeps it

**Asked:** can the floating panel's picture change while the sim runs, by writing over its texture file, so that Crosscheck's app could draw any notice and the banner show it?

**Expected:** a fresh spawn would read the file again.

**Found:** in the Black Square Baron 58P, parked, p04 wrote a notice, "You've lost the connection", stamped with the time it was drawn, as an uncompressed DDS of the same size over the texture file in both copies of the package, the one Build and Mount mounted and the one in Community:

- Over the card's texture, which the panel had loaded: the panel kept showing the card, 1s and 5s after the write while it was up, and after it was removed and spawned again 4s later.
- Over `CROSSCHECK_P02_Baked2`'s texture, which had never loaded, since the sim had refused our KTX2 there ([entry below](#2026-10-04-a-texture-we-write-ourselves-shows-on-our-panel-an-uncompressed-dds-shipped-by-a-copy-asset-group-with-its-ktx2json)), padded with zeros to that file's size: the first spawn after the write showed the notice with its stamp, 10:25:14, written 1.5s before the spawn.
- The package builder logged no error during either run.

**Changed:** the sim reads a texture file the first time it needs it, sees a mounted file's new contents, and doesn't keep a failed load, but keeps a loaded texture after its object is removed.
So a banner can show a picture the app draws while the sim runs, once per texture file; whether a loaded texture is ever let go, which would let a file be used again, is untested.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** p04's runs [over the loaded texture](../../../experiments/areas/interface/results/p04-texture-rewrite-2026-10-04-08-24-19.txt) and [over the one never loaded](../../../experiments/areas/interface/results/p04-texture-rewrite-2026-10-04-08-25-14.txt), each with its screenshots in the folder of the same name.

## 2026-10-04: A texture we write ourselves shows on our panel: an uncompressed DDS, shipped by a Copy asset group with its .KTX2.json

**Asked:** how does a texture get into a package of ours, when both packagers left our PNG out ([entry below](#2026-10-04-build-and-mount-loads-a-new-module-with-no-sim-restart-leaves-png-textures-out-and-a-program-can-click-it))?

**Expected:** fspackagetool run with the sim closed would convert the PNG where the in-sim Build and Mount didn't.

**Found:**

- fspackagetool, run with the sim closed, also left the PNG out of `texture/`, while it took a `texture.cfg` from the same folder, and reported no error.
- A `.PNG.json` of flags beside the PNG, in the form ChasePlane's built textures carry (read in p42-util-chaseplane 2026.39.1.16, `P42_FLASHLIGHT_BODY_ALBEDO.PNG.KTX2.json`), didn't make either packager take it.
- The same DDS written straight into the mounted package after Build and Mount, under the name below and with a `layout.json` entry ([drop-texture.mjs](../../../experiments/areas/interface/panel/tools/drop-texture.mjs)), still showed the checkerboard on a fresh spawn; whether the sim fixes a package's files when it mounts it, or kept the texture it had already failed to find, is unknown.
- The compiled model points at `..\TEXTURE\CROSSCHECK_P02_CARD.PNG.KTX2` whatever happens to the PNG, so we shipped files under that name through `Copy` asset groups, listed after the SimObject groups:
  - Package validation refused both with "Can't find associate json for ktx2 texture" until each had a `.KTX2.json` beside it; we gave ours `{"Version":2,"SourceFileDate":…,"Flags":[],"HasTransp":true}`.
  - An uncompressed 32-bit DDS, 1024x512 with alpha and one level ([png-to-dds.ps1](../../../experiments/areas/interface/panel/tools/png-to-dds.ps1)), showed the card on the panel, held 35cm ahead of the eye: see-through, its text sharp, and the cockpit and the hangar visible through it.
  - An uncompressed KTX2 we wrote, sRGB RGBA8 with one level ([ktx2.mjs](../../../experiments/areas/interface/panel/tools/ktx2.mjs)), showed the missing-texture checkerboard, so the sim reads a texture by its contents rather than its name, and something in our KTX2 doesn't suit it.
- The sim writes the package builder's errors, though not its warnings, to `%APPDATA%\Microsoft Flight Simulator 2024\BuilderLogError.txt`; the validation errors above came from it.
- The builder watches the project's folder and tries to reload an asset group for every file that changes in it.

**Changed:** a floating panel of ours can show a picture we make, without the sim's texture conversion.
How to have the packager convert a PNG properly, compressed and with mipmaps, is still unknown, and a shipped banner wants it, since our uncompressed texture is 2MB.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope, and [panel/build.mjs](../../../experiments/areas/interface/panel/build.mjs).

**Evidence:** p02's runs [for the DDS](../../../experiments/areas/interface/results/p02-floating-panel-2026-10-04-08-19-38.txt) and [the KTX2](../../../experiments/areas/interface/results/p02-floating-panel-2026-10-04-08-19-54.txt), each with its screenshot in the folder of the same name.

## 2026-10-04: Livery paintings show on the pilot's own aircraft, and on none of six kinds of object we spawned

**Asked:** does a livery painting land on objects of other kinds than a StaticObject ([entry below](#2026-10-04-a-livery-painting-on-an-object-of-our-own-opens-its-document-but-nothing-it-draws-reaches-the-objects-material))?

**Expected:** on an aircraft at least, since FSLTL's AI traffic paints its registrations that way.

**Found:** in the Black Square Baron 58P, parked:

- p02 put the same painting, `location=exterior` on the see-through material with `RegistrationNumberLoaded`, on a StaticObject, a Boat, a GroundVehicle, a Viewer, a Human, and a minimal aircraft of our own with no engine, each in the folder its kind ships in.
  Each spawned, the sim stayed up, and each opened its painting document, which redrew about once a second; none showed anything on its panel.
- An AI copy of the Baron, held side-on 15m ahead, showed no side number, with the Baron's tablet option "Show Dynamic Registration" on.
  Whether a copy has an `ATC ID` for the Baron's script to paint is unknown, so this doesn't settle AI aircraft.
- The pilot's own Baron, seen from outside with that option on, showed "N513LW" in the painting's red, `0xA50000`, outlined in its `0xD0D0D0`, so paintings draw in this build, SunRise 12.2.282174.999.
  The tablet's label for the option says it is "Still Awaiting Fix in SU4", and the pilot says this build is SU6.
- The package builder warned of keys it doesn't know in our files: `[VERSION]` in a `panel.cfg`, `editable` in the aircraft's `[GENERAL]`, and `panel` in `[fltsim.0]` of a `sim.cfg`, so the sim doesn't recognize a panel on an object that isn't an aircraft, though it opened the paintings' documents.

**Changed:** we stopped the painting route: we found no object we can spawn that shows one.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** [p02's run from 07:58:18](../../../experiments/areas/interface/results/p02-floating-panel-2026-10-04-07-58-18.txt) and its screenshots, and [p03's run from 08:05:18](../../../experiments/areas/interface/results/p03-ai-gauges-2026-10-04-08-05-18.txt), whose screenshot shows the copy; the screenshot of the pilot's own Baron wasn't kept.

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
