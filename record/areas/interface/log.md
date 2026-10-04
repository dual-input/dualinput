# Interface: log

What our experiments found about showing Crosscheck to the pilot inside the sim, such as the notification banner and the EFB app, newest entry first.
The probes and their raw output are in [experiments/areas/interface](../../../experiments/areas/interface), with the results in its `results/` folder.

## 2026-10-04: A click on a notice in our panel opens the EFB onto another app, whether the EFB was open or closed

**Asked:** can a notice on our panel open the EFB onto a given app, after the toolbar's calls put nothing on screen ([entry below](#2026-10-04-code-in-the-efbs-document-switches-the-efb-to-another-app-but-no-call-we-found-puts-the-efb-on-screen))?

**Expected:** the sim's own flow events would do it, since its interface opens the EFB onto a page with `LaunchFlowEvent("UI_EFB_OPEN", "")` and `LaunchFlowEvent("UI_EFB_OPEN_PAGE", "", "<app>", "<page>")` (read in fs-base-ui, `html_ui/Global/pkg/base.bundle.js`, and fs-base-efb-app-atlas, `AtlasApp.js`).

**Found:** on MSFS 2024 SU6, in the Black Square Baron 58P, parked, with GSX standing in for our app:

- With the EFB opened by Tab, the toolbar still listed `PANEL_EFB` as `"Invisible"`; the only change we found was the EFB's action bar losing the class `panel-ui-actions--hidden`, which it carries exactly while the EFB is closed.
- Neither the flow events above nor ChasePlane's `document.querySelector("ui-panel").m_listener.setPanelOpened(id, true)` did anything to the EFB, run in our panel's document or the toolbar's.
- `Coherent.call("TOGGLE_EFB")`, the call behind the toolbar's `ToolBarListener.toggleEFB` (read in fs-base-ui, `html_ui/Global/lib.js`), opens and closes the EFB from our panel's document and from the EFB's own.
- The EFB's document hears `OPEN_BY_KEY(app, page, args)` from the sim and opens that app (read in fs-base-efb, `html_ui/efb_ui/efb_os/efb_os.js`), so the sim has some way to open the EFB onto an app, which we haven't found.
- The chain, installed through the inspector, with a stand-in for our EFB app in the EFB's document:
  1. A click on the notice raises `L:CROSSCHECK_P05_EFB_APP`.
  2. The stand-in, polling it every 200ms, calls `TOGGLE_EFB` only if the action bar says the EFB is closed, then presses GSX's dock button.
  3. With the EFB open on Atlas, it stayed open and switched to GSX; with it closed after the pilot left it on Atlas, it opened onto GSX.
  4. GSX's button was pressed 73ms to 240ms after each of five clicks.
- A first version that called `TOGGLE_EFB` from the panel closed an open EFB, as a toggle does.
- ChasePlane keeps its full-screen overlay closed in VR, reading `globalVars.vrMode` in the toolbar's document (read in p42-util-chaseplane 2026.39.1.16, `HTML_UI/icons/toolbar/P42_PANEL_CHASEPLANE_OVERLAY.svg`).

**Changed:** the hybrid works: notices on our panel, and a click on one opens our EFB app, whatever state the EFB is in.
It rests on two things only measured with code installed through the inspector: our EFB app's code running while the EFB is closed, and pressing our app's button, which may be off the dock and off the app list's first page.

**Affects:** the [EFB app](../product/03-v1-scope.md#efb-app) and the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** inspector reads, the screenshots after each call, and the pilot's report; no run file.

## 2026-10-04: Our toolbar icon loads a script of ours into the toolbar's document, and it opens our panel with no click

**Asked:** can Crosscheck open its in-game panel by itself, from code we ship and control, with no click and no EFB app ([entry below](#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page))?
The core can't make the call: `Coherent` exists only inside the sim's documents, and the inspector on port 19999, though it works with DevMode off (FS Copilot fork, `record/pointer-forwarding/docs/09-environment.md`), is a debugger we won't ship on.

**Expected:** Parallel 42's add-ons run code in the toolbar's document, and the toolbar's document can open panels, so their way in would be ours too.

**Found:** on MSFS 2024 SU6, in the Black Square Baron 58P, parked:

- The toolbar's document loads a script from four add-ons' `InGamePanels` folders, such as `P42ChasePlane_worker.js` and FS Reborn's `toolbar_bridge.js`, and the sim's own files name none of them.
- The way in is the panel's toolbar icon: the toolbar inlines the icon's SVG into its own document, and ChasePlane's icon holds `<img src onerror="…">`, whose handler appends ChasePlane's script to the toolbar's `<head>` (read in p42-util-chaseplane 2026.39.1.16, `HTML_UI/icons/toolbar/P42_PANEL_CHASEPLANE.svg`).
  ChasePlane's overlay icon also opens the overlay from there, which is how it opens without a click.
  Parallel 42 publish the method under MIT as [parallel42/msfs-toolbar-interop](https://github.com/parallel42/msfs-toolbar-interop).
- Our blank toolbar button came from our icon's path: the 2020 template's `html_ui/Textures/Menu/toolbar/`, where 2024 looks in `html_ui/icons/toolbar/`.
- p05's icon, at the 2024 path with the same `img` ([ingame/build.mjs](../../../experiments/areas/interface/ingame/build.mjs)), loaded our `p05-toolbar.js` into the toolbar's document straight after a Build and Mount, with no flight reload.
- The script called `Coherent.call("TOOLBAR_BUTTON_TOGGLE", "PANEL_CROSSCHECK_P05", true)` 3s after loading, with no error.
  After the first Build and Mount the panel stayed closed; after the next two the pilot saw it open by itself.
- A Build and Mount gave the toolbar a fresh document, holding one copy of our script and none of the flags we had set in it, but the script it ran was the copy from the first build, so the toolbar's document keeps its first files as our panel's does.
- Opened from code, from the toolbar's document or the EFB's, our 48-wide column sat at the left of the screen, not the right.

**Changed:** Crosscheck can open its panel itself, from code in its own package, with no EFB app and no click.
The trick isn't a sim feature: it rests on the toolbar inlining icon markup, which an update could stop.
Why the first call left the panel closed is unknown; a script that calls until the toolbar lists the panel as open is built but hasn't run, because the sim kept serving the first copy.
Putting the column back on the right when code opens it is untested.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) and the [EFB app](../product/03-v1-scope.md#efb-app) in the v1 scope.

**Evidence:** inspector reads of the toolbar's document, the toolbar's own record of each panel's state, and the pilot's report; no run file.

## 2026-10-04: Code in the EFB's document switches the EFB to another app, but no call we found puts the EFB on screen

**Asked:** can a notice on our panel open the EFB on Crosscheck's own app, so the EFB app holds the controls and the panel only shows notices?

**Expected:** the EFB is a toolbar panel, so the toolbar call would open it, and the EFB's code would have a way to pick an app.

**Found:** on MSFS 2024 SU6, in the Black Square Baron 58P, parked, with GSX and iniJetways installed as stand-ins for our app:

- The EFB is the toolbar panel `PANEL_EFB`, and its document, titled "Electronic Flight Bag", stays loaded while the EFB is closed.
- `TOOLBAR_BUTTON_TOGGLE` for `PANEL_EFB` set the toolbar's record of it to `"Detached"` when called from our panel's document or the toolbar's, and back to `"Invisible"` when closed from the toolbar's; no EFB showed on screen in either case.
  How Tab opens the EFB is untested.
- The EFB opens an app through `efbViewService.openApp(name)`, which no global exposes, and an app is handed the EFB's bus, settings, notification manager, and onboarding manager, but not the view service (read in fs-base-efb, `html_ui/efb_ui/efb_os/efb_os.js`, `EFBViewService` and `Container.use`).
- Pressing an app's button from code works: mouse events on GSX's dock button switched the EFB's view to `GSX_EFB`, and on IniJetways in the home page's app list to `MultiJetwayControllerApp`, while the EFB was closed.
  The app list pages, so an app off its first page needs paging first.

**Changed:** the hybrid, with notices on our panel and controls in an EFB app, would need a way to put the EFB on screen that we haven't found; switching it to our app once it's open is solved, by a trick.

**Affects:** the [EFB app](../product/03-v1-scope.md#efb-app) and the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** inspector reads and the screenshots taken after each call; no run file.

## 2026-10-04: An in-game panel's size is a percent of the screen's height, capped at 150% of it, so ours can't span a wide screen, though Parallel 42's panels do

**Asked:** can p05's always-open panel ([entry below](#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)) cover the whole screen, as ChasePlane's overlay does, so its notices can go anywhere on it?

**Expected:** `defaultWidth="100"` and `defaultHeight="100"` would fill the screen, since the template's sizes are percents of the screen.

**Found:** in a 2,401 by 1,360 window, p05's definition gave these pages, measured through the inspector:

| `defaultWidth` | `defaultHeight` | `defaultTop`, `defaultRight` | Page | Where |
| --- | --- | --- | --- | --- |
| 22 | 42 | 22, 1 | not measured | the right |
| 100 | 100 | 0, 0 | 1,360 by 1,360 | the left |
| 1000 | 100 | 0, 0 | 2,040 by 1,360 | the left |
| 48 | 100 | 0, 0 | 665 by 1,360 | the right |

- So width counts in percents of the screen's height, about, and the sim caps it at 150% of the height.
  Why the two wide panels sat at the left, with `defaultRight="0"`, is unknown.
- ChasePlane's overlay and Parallel 42's Flow each report a page and an `ingame-ui` box of 2,401 by 1,360, the whole window.
  Their `ingame-ui` carries our attributes plus the classes `no-header no-background collapsible`, `min-width="5"`, and `min-height="5"`, and the toolbar's page lists both, and ours, in the state `"Detached"`.
- Their compiled definitions, such as `InGamePanels/p42-util-chaseplane-overlay.spb`, are in a binary format we couldn't read, so how they reach the full width is unknown.
- Each Parallel 42 package ships `html_ui/pages/ToolBar/toolbar_interop.js`, a file in the sim's toolbar folder that the sim itself doesn't ship, so its code runs in the toolbar's page: ChasePlane's `window.p42_chaseplane_core` lives there, and their scripts wait on the events `TOOLBAR_READY`, `TOOLBAR_CONNECTED`, and `toolbar_attached` (read in p42-util-chaseplane 2026.39.1.16 and p42-util-flow-pro 26.33.5).
- Flow ships a second panel for VR, `PANEL_FLOW_VR`, named "//42 Flow - Popout", which the toolbar lists as `"Invisible"`.
- The sim's frame script tells the sim the frame's rectangle with `Coherent.trigger("UPDATE_PANEL_RECT", this.panelID, rect.left, rect.right, rect.top, bottom)` (read in fs-base-ui 0.1.10, `html_ui/templates/ingameUi/ingameUi.js`).

**Changed:** p05 uses the full-height column 48 wide on the right, which is where the scope puts notices.
Full screen would take guessed definition attributes, each costing a Build and Mount, or Parallel 42's toolbar file, through which we found no size call.
Whether clicks on the column's clear part reach the cockpit is untested; if they don't, reporting only the card's rectangle with `UPDATE_PANEL_RECT` might let them through (unverified).

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope, and [ingame/build.mjs](../../../experiments/areas/interface/ingame/build.mjs).

**Evidence:** [the three pages' sizes and attributes](../../../experiments/areas/interface/results/p05-ingame-panel-sizes-2026-10-04.txt), read with the column live; the 100 and 1000 widths weren't saved.

## 2026-10-04: An in-game panel of ours takes clicks, and opens from code in the toolbar's and the EFB's pages, but not in a cockpit page

**Asked:** can an in-game panel of ours, see-through and pinned to the right of the screen, show the pre-flight card, take clicks on its Start flying button, and open without the pilot clicking the toolbar?

**Expected:** see-through and clicks, yes, since ChasePlane's overlay is such a panel; opening from code, no prediction.

**Found:** in the Black Square Baron 58P, parked, on MSFS 2024 SU6, SunRise 12.2.282174.999:

- p05's package ([ingame/build.mjs](../../../experiments/areas/interface/ingame/build.mjs)) copies the format of a working MSFS 2020 template (bymaximus/msfs2020-toolbar-window-template): a `SimBase.Document Type="InGamePanels"` compiled by an `SPB` asset group, and its page by a `Copy` group.
  The Project Editor asked for an order hint before it built, and we gave it `UI_PATCH`.
- Build and Mount mounted it with the sim running, and the toolbar listed "Crosscheck", with a blank square where our icon should be.
- Opened from the toolbar, it sat on the right, see-through around the card.
  The page's `vh` counts the panel's own height, not the screen's, so the first column, 42% of the screen's height, drew everything 2.4 times too small.
- The panel counted 4 presses of Start flying into `L:CROSSCHECK_P05_CLICKS` before we drove it from code, which we take to be the pilot's.
- `Coherent.call("TOOLBAR_BUTTON_TOGGLE", "PANEL_CROSSCHECK_P05", open)` opened and closed the panel when run in the toolbar's page and in the "Electronic Flight Bag" page, and did nothing in the Baron's tablet page or in `VLogic`; `mainUi` has no `Coherent` to call it with.
- Closing the panel destroyed its page, and opening it made a new one.
- An open panel kept serving its first `p05.js` after a Build and Mount, and after closing and opening it, until `location.reload(true)` through the inspector.
- Kept open, the page slid the card and six notices in and out with CSS transitions, driven through `window.CROSSCHECK_P05` from the inspector, and a screenshot showed the card and a notice with sharp text.
- The sim blurs whatever lies behind the panel's painted pixels: under a see-through pink layer, the instruments showed as a smooth blur, not tinted pink.
  A pink background on the page's `html` element never showed, and a full-size element of the page did.

**Changed:** the banner can be an in-game panel with its own buttons, left open, that shows and hides its elements by CSS without toggling the panel.
Crosscheck's EFB app could open it, since the EFB's page can; whether the app's code runs while the EFB is closed is untested.
The panel must paint nothing outside its elements, or it blurs that part of the cockpit.
Clicks through its clear part, outside views, VR, and the icon are untested.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) and the EFB app in the v1 scope.

**Evidence:** inspector sessions run by hand; no run file, and the screenshots weren't kept.

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
