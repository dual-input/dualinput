# Avatars: log

What our experiments found about showing one pilot's avatar on the other pilot's machine with MSFS multiplayer off, newest entry first.
The avatar shows as a figure: a person-shaped object Crosscheck spawns and moves.
SimConnect reads the avatar's position, ground speed, and facing every sim frame through `SIMCONNECT_OBJECT_ID_USER_AVATAR`, and `SimConnect_CameraGet` gives where the pilot looks, whether ChasePlane drives the camera or not.
The sim's own people stay invisible when a SimConnect client spawns them.
GSX's people show, and walk when we write their animation frame every frame.
GSX's separate seated people move on their own, though they sit a seat's height too high on a seat object.
The probes are p01 to p06 in [experiments/areas/avatars](../../../experiments/areas/avatars), and their raw output is in [experiments/areas/avatars/results](../../../experiments/areas/avatars/results).
Every entry was measured on MSFS 2024 SunRise 12.2.282174.999 on 2026-10-02 and 2026-10-03, at a gate at LQSA with the Cessna C152 Aerial Advertising unless the entry names another aircraft, on our development machine with GSX Pro 4.0.19 and ChasePlane 26.39.1 installed.

## 2026-10-03: During a drag the cursor keeps moving, and gliding on the touched surface's plane keeps the hand on a lever where a fresh cast falls through

**Asked:** with the hand at the raw hit and no control names, how should it follow a press that's held and dragged: does MSFS 2024 keep moving the cursor while the pilot drags a lever, and does gliding along the plane of the surface first touched beat casting the ray again at every move?

**Expected:** the plane would follow a drag across a panel seen from an angle, and a fresh cast would fall behind a lever, since the model holds the lever where its file stores it.
We didn't know whether the sim locks or hides the cursor during a lever drag.

**Found:**

- In the A2A Comanche, parked, the pilot pressed 42 times: 14 taps, 2 holds, and 26 drags across the panel, the side wall, the throttle quadrant, the G5 displays, and the copilot's yoke.
  For the close-up presses on the G5s, the camera sat 0.5m forward of the default eye, and the ray followed it.
- The cursor kept moving with the mouse through every drag, levers included.
  On the throttle it ran down and right as the lever came back, then back up, with no jump or lock, and sample by sample it moved the way the mouse's own counts did.
- On flat surfaces the plane and a fresh cast agreed: medians of 0 to 1.5cm on `MAIN_DASH` and `BlackPanel`.
- On the levers they split: a fresh cast was a median 8cm and 65cm from the plane on two drags of `LEVER_RPM_2`, and 22cm on `LEVER_Mixture_Rod`, landing on the floor and pedals behind levers that had moved in the sim, while the plane kept the hand at the lever.
- Where the sphere's 1.45cm radius met a knob and its bezel, it showed dark ragged patches, as if cut away (pilot's screenshot).
  Its material is single-sided and partly emissive (`tools/sphere.mjs`), so the patches aren't its inside.
  Shadows from the knob and bezel, with a shadow map's ragged edge, are our guess (unverified).

- The pilot found that the hand felt right, and that its 0.5s on the spot after a release was a little long.

**Changed:** a held press follows the cursor's ray across the plane of the surface it first touched.
A fresh cast stays useful only where the plane meets a curve or an edge.
The hand leaves 0.25s after a release.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p20's second run](../../../experiments/areas/avatars/results/p20-click-calibrate-2026-10-03-08-47-25.txt), whose log has every press and each drag's path; its releases are logged under the kinds `tap`, `hold`, and `drag`, a bug since fixed.

## 2026-10-03: The ray through the cursor needs no calibration: CameraGet's field of view is the view's height, and clicks land within 2mm at any zoom and window shape

**Asked:** what turns a click into the ray from the pilot's eye, for any pilot: which signs, whether `SimConnect_CameraGet`'s field of view is the view's width or its height, and whether any offset is added?
p19 couldn't settle it, because it never knew what the pilot meant to click ([entry below](#2026-10-03-a-clicks-ray-cast-into-the-cockpit-model-finds-the-control-the-pilot-clicked-with-no-names-but-the-run-couldnt-pin-down-the-field-of-view)).

**Expected:** a fit to clicks on known spots would settle the signs and offsets, and only a second zoom and a second window shape could tell a width from a height.

**Found:**

- In the A2A Comanche, parked, a small yellow ball sat 3cm in front of a known spot, and the pilot clicked its center: 10 spots from the left wall across the panel to the right wall and the overhead, then 4 more zoomed in, then 4 more with the window resized to fullscreen.
- One rule lands all 18 clicks within 2mm of their spots, with nothing fitted:
  - `CameraGet`'s `fov`, in radians, is the view's height, and the view's width follows the window's shape
  - the screen's right is the model's −x
  - in the `SIMOBJECT` referential, a positive yaw (SimConnect.h's `Bank` field) turns the view right and a positive pitch turns it down
  - no offset in either angle

  | Pass | `fov` | Window | Off by, RMS |
  | --- | --- | --- | --- |
  | First | 41.1° | 2401×1360 | 0.11° |
  | Zoomed | 19.8° | 2401×1360 | 0.14° |
  | Fullscreen | 55.9° | 5120×1440 | 0.14° |

- Fitted to all 18 clicks, every sign and offset came out as in that rule, with the scale at 1.000 and a pitch offset of −0.05°.
  The best mirrored fit was off by 24.6°.
- p19's ray took the `fov` as the view's width, and it was off by 12.7° on these clicks.
  It pulled every ray toward the middle of the screen by the window's aspect ratio, so its error grew with a click's distance from the middle, which fits the pilot's report from p19.
- The probe stopped at a bug in its report line before the free clicks, so the numbers above come from replaying its recorded clicks with the fixed code.

**Changed:** the ray needs no calibration by anyone: the same rule, fed the live camera and window size, holds for any zoom and window shape.
The hand can go where the pilot clicks to within the model's own accuracy.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p20's run](../../../experiments/areas/avatars/results/p20-click-calibrate-2026-10-03-08-41-26.txt), and the ray and fit in [lib/pick.mjs](../../../experiments/areas/avatars/lib/pick.mjs).

## 2026-10-03: A click's ray cast into the cockpit model finds the control the pilot clicked, with no names, but the run couldn't pin down the field of view

**Asked:** without any input event or variable name, can the hand go where the pilot clicks: the ray from the camera through the cursor, cast into the aircraft's interior model, and the hit point taken as the hand's position?

**Expected:** hits on the controls clicked, once the ray's signs and field of view were right.
p17's ray, built from the camera's WORLD pose, came out mirrored left to right, so p19 cast every click under all 16 combinations of screen mirror, yaw sign, pitch sign, and field of view taken as vertical or horizontal, and the sphere followed the combination that had named a mapped control most often.

**Found:**

- In the A2A Comanche, parked, the pilot clicked 52 times.
  The interior model `PA24_250_INTERIOR_LOD00.gltf` reads as plain glTF, 650,660 triangles in 150ms, and a cast over it takes about 1ms.
- `SimConnect_CameraGet`'s position in the `SIMOBJECT` referential was 0.010m forward, 0.303m left, and 0.539m up.
  The Comanche's eyepoint plus its Pilot camera's `InitialXyz` give 0.011m, 0.305m, and 0.543m (read in a2a-aircraft-pa24 2.1.3, `cameras.cfg`).
  So that referential gives the camera in the model's own space, to within 4mm.
  The probe instead shifted the camera 3.3cm, from its `WORLD` position turned by heading alone, which ignores the parked aircraft's pitch.
- The combination that the sphere followed for 40 clicks named the controls of an engine start, `SWITCH_magnetos_ORLB` and `Pushbutton_Starter`, five times each, and hit `FUEL_Switch_Pump_1` and `LEVER_CABIN_VENTILATION_RIGHT` on the control at the screen's left and right edges.
  It took the screen's right as the model's −x, a camera yaw to the right as positive, a look down as positive pitch, and `CameraGet`'s field of view of 1.062 radians as horizontal.
- That combination named a mapped control on only 24 of the 52 clicks, and fits after the run couldn't settle the field of view.
  The Comanche's panel has controls close together on both sides, so a ray from almost any combination passes near some control, and a mirrored combination scored as well as the unmirrored one.
- The misses fall where the model differs from what the pilot saw:
  - the pilot's yoke and the copilot's yoke, at the pose the file stores, block rays to switches behind them; the model has a `Yoke_Right_Hider` component, and we don't know whether the copilot's yoke was hidden in the sim
  - rays to the GPS units hit `BlackPanel`, because the GPS units are attachments with models of their own (`attachments/a2a/Gtn750` and the others), not part of the interior model
  - rays to the throttle quadrant hit `throttle_base` and the dash behind the levers, which the file stores at one end of their travel
- The pilot reported that "direct rays were better than rays cast to the far side of the cockpit".

**Changed:** the hand can follow clicks through the model's geometry alone, so it doesn't depend on how an aircraft names its controls.
Settling the field of view needs clicks whose target is known, which is p20's job.
A cockpit's moving and hidden parts need their state from the sim, or they block and misplace hits.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p19's run](../../../experiments/areas/avatars/results/p19-click-hand-2026-10-03-08-13-37.txt), whose log has every click under all 16 combinations.

## 2026-10-03: The cockpit model's own space lines up with SimConnect's within 8mm, but the model's input event IDs aren't the names the sim lists

**Asked:** can the hand sphere go to a control from the aircraft's model files alone: the control's node position in the interior glTF, tied to SimConnect's frame, and picked by the input event that changed?

**Expected:** the model's origin at SimConnect's reference point, and the input event IDs in the behavior XML matching the sim's list.

**Found:**

- In the A2A Comanche (a2a-aircraft-pa24 2.1.3), parked, `tools/controls.mjs` placed 103 of the 125 interactive components of `PA24_250_INTERIOR.xml` on a node of the interior glTF; the other 22 take their node from a template the tool doesn't expand.
- The seat objects `SEAT_DEFAULT_Pilot` and `SEAT_DEFAULT_Copilot` sit on the model's nodes `PILOT_1` and `PILOT_2`.
  Read through SimConnect, both sit where the model puts those nodes, with the model's +x to the left, y up, and z forward, once shifted by 0.008m forward, 0.001m right, and 0.007m up.
  The two seats agree on that shift within 0.005m.
- The Comanche's `reference_datum_position` is `0,0,0` (read in a2a-aircraft-pa24 2.1.3, `flight_model.cfg`), so this run can't tell whether SimConnect reports the model's origin or the reference datum.
- None of the sim's 318 input events matched the map, so the sphere never moved.
  The behavior XML names an input event by its component's ID, such as `SWITCH_avionics_master`, and the sim lists it with a suffix, such as `SWITCH_AVIONICS_MASTER_TOGGLE` or `SWITCH_BATTERY_MASTER_2STATES` (measured in the Comanche on 2026-10-01, [run-a2a-pa24-comanche-2026-10-01-18-20-15](../../../experiments/areas/aircraft/results/run-a2a-pa24-comanche-2026-10-01-18-20-15.ndjson)).

**Changed:** a control's position comes from the model files to within a centimeter.
Picking the control by input event name failed on this aircraft's naming alone, and an aircraft whose controls run on its own code may not use input events at all (unverified), so we're looking for a link that doesn't go through the developer's names.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p18's run](../../../experiments/areas/avatars/results/p18-hand-controls-2026-10-03-07-41-44.txt), and the mapper in [experiments/areas/avatars/tools/controls.mjs](../../../experiments/areas/avatars/tools/controls.mjs).

## 2026-10-03: A model of our own compiles from generated glTF, and its size and color follow variables of its own object

**Asked:** can we build a model of our own, and change its size and color from outside the sim in real time, per object?

**Expected:** size, since an animation can key scale; color only by switching between colored parts, since the SDK's behavior files we searched have no color template.

**Found:**

- `tools/sphere.mjs` writes a plain glTF 2.0 sphere: a node `hand_scale` with a scale animation `CROSSCHECK_Scale`, over four balls in red, green, blue, and yellow.
  `fspackagetool` compiled it as a `SimObject` asset group in our probe package, adding `ASOBO_asset_optimized` with no errors, and the sim spawned it, `CROSSCHECK_HandSphere`, as a `StaticObject`.
- Its model reads two variables of its own object: the scale animation's `ANIM_CODE` reads `(Z:CROSSCHECK_SCALE)`, and each ball's `VISIBILITY_CODE` compares `(L:1:CROSSCHECK_COLOR)` with its index.
  The module set both every frame on the sphere alone, with `fsVarsZVarSet` and the sphere's object ID.
- The pilot saw the color change every 1.5s and the size sweep up, and the module read `Z:CROSSCHECK_SCALE` back as written, with no errors.
  So a model reads its object's own variables under both spellings, `Z:` and `L:1:`.
- Placed 0.6m along the ray from the camera through the cursor, the sphere moved mirrored left to right and didn't sit on the controls the pilot clicked.
  We set the ray aside, because a hand that follows the cursor all the time isn't what a pilot does.

**Changed:** Crosscheck can build its own figure from generated glTF and drive its parts per object at runtime: position, size, and color, by switching between colored parts.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p17's run](../../../experiments/areas/avatars/results/p17-hand-2026-10-03-07-27-25.txt), and the sphere's sources in [experiments/areas/avatars/wasm](../../../experiments/areas/avatars/wasm).

## 2026-10-03: Over three minutes of flying, leads of 0.75 and 1 frame both hold the figure, and what's left reads as inertia

**Asked:** at length, which of the two best leads from p15 holds the seated figure better ([entry below](#2026-10-03-nose-up-and-right-wing-down-are-negative-and-turned-by-full-attitude-a-wasm-written-figure-holds-its-seat))?

**Expected:** 0.75 frames, which looked best in 8s steps.

**Found:** the pilot flew the C152 for about 3 minutes, from 111 kt down to 62 kt, with pitch from −13° to 15° and bank up to 32°, switching between 0.75 frames (36s in all) and 1 frame (136s) 12 times.
Both held GSX's seated passenger well, and the slight lag left behind felt like the passenger's inertia rather than an error, the pilot reported.

**Changed:** either lead serves, so the choice between them can wait for our own figure and wider flying.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p16's run](../../../experiments/areas/avatars/results/p16-ab-lead-2026-10-03-07-07-05.txt), whose log has each switch with the speed, pitch, and bank at that moment.

## 2026-10-03: Nose up and right wing down are negative, and turned by full attitude a WASM-written figure holds its seat

**Asked:** with the seat offset turned by pitch and bank as well as heading, does a WASM-written figure hold its seat while the pilot rocks and pitches, and what are the signs of `A:PLANE PITCH DEGREES` and `A:PLANE BANK DEGREES`?
The earlier runs turned the offset by heading only ([entry below](#2026-10-03-led-by-one-frame-a-wasm-written-figure-sits-in-the-seat-of-a-flying-aircraft-but-doesnt-hold-still)).

**Expected:** the sim carries the seat object through pitch and roll itself, so the right signs would predict it closely.

**Found:**

- Over 12s with the pitch between −12° and 16° and the bank between −29° and 35°, the module (`crosscheck-p12-follow` 0.4.0) predicted `SEAT_C152_Pax` every frame from its parked offset, turned by heading, pitch, and bank under each of the four sign pairs.
  Predicted from the previous frame's aircraft pose with both signs negative, its RMS error was 0.006m.
  The other three pairs from the previous frame were 0.06m to 0.08m off, and all four from the current frame's pose were about 1.77m off.
- So nose up is negative `A:PLANE PITCH DEGREES`, right wing down is negative `A:PLANE BANK DEGREES`, and the sim places the seat object from the previous frame's aircraft pose, turned about `A:PLANE LATITUDE`, `A:PLANE LONGITUDE`, and `A:PLANE ALTITUDE` by the usual heading, pitch, bank order.
- Turned by those signs and carried on by a lead of the aircraft's change since the previous frame, position and attitude both, GSX's seated passenger held its seat through rocking and pitching best at 0.75 frames, nearly as well at 1 frame, and worse at 1.25 frames and on the seat object led by 2 frames, the pilot judged.
  It still sat a little off the seat, which the pilot puts down to GSX's model rather than to the placement.
- The module wrote every frame of every step with no error.

**Changed:** a WASM module writing inside the sim's frame, turning by full attitude and leading by about 0.75 frames, holds a figure in its seat in a rocking aircraft well enough to build on, without editing the aircraft's files.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p15's run](../../../experiments/areas/avatars/results/p15-attitude-2026-10-03-07-03-58.txt); the pilot pressed Page Down in every step, so the presses don't separate them.

## 2026-10-03: Led by one frame, a WASM-written figure sits in the seat of a flying aircraft, but doesn't hold still

**Asked:** where does a figure written from inside the sim's frame land in a flying aircraft's cabin, and can a lead put it in the seat?
In p12 the wand sat by the tail ([entry below](#2026-10-03-written-from-inside-the-sims-frame-by-a-wasm-module-an-object-keeps-up-with-a-flying-aircraft)), so p13 and p14 used GSX's seated passenger, `FSDT_Passenger_CASUAL_M_0030_SEATED`, whose origin is at its feet, placed 0.45m below the seat point.

**Expected:** a write from `Update_StandAlone` would land in the frame it's made.

**Found:**

- With no lead (p13), the passenger sat outside, behind the C152's cabin: a meter or two back when written at the seat's parked offset from the aircraft, and further back when written on the seat object's own position.
  The pilot's screen recording shows both through the rear window.
- From inside the frame, `SEAT_C152_Pax` read 1.4m to 1.8m behind the aircraft's reference point at 84 to 114 kt, against 0.10m ahead parked, and SimConnect from outside read it 1.8m to 2.3m behind.
  At about 32 frames a second that's about one frame of travel, so the seat object's reported position is a frame old (inference).
- p14 moved the passenger on by what the aircraft moved since the previous frame, times a lead, at 76 to 97 kt:
  - at the parked offset, led one frame: inside the cabin at the passenger seat, sitting too high;
  - at the parked offset, led two frames: outside, ahead of the aircraft, seen through the windshield;
  - on the seat object, led two frames: inside the cabin at the seat, sitting too high.
- In no step did the passenger sit exactly in the seat or hold perfectly still, the pilot reported, and the recording shows it shifting between frames.
- The module wrote every frame of every step with no error.

**Changed:** a write from `Update_StandAlone` shows a frame after the aircraft is drawn, so a WASM-written figure needs a one-frame lead and still wobbles.
For a figure that must sit still, attaching it through the aircraft's own files is the route measured to work ([entry below](#2026-10-03-a-model-attached-through-the-aircrafts-own-files-holds-still-in-flight)), and the WASM writer is a rougher fallback.
Why it wobbles is unknown: frame times vary, and the parked offset turns by heading only while the pilot rocked the wings.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** p13's runs, the last [from 06:41:53](../../../experiments/areas/avatars/results/p13-seat-follow-2026-10-03-06-41-53.txt), and [p14's run](../../../experiments/areas/avatars/results/p14-lead-frames-2026-10-03-06-50-09.txt).
The pilot's screen recordings of both are kept out of the repository, because they show the home folder's path.

## 2026-10-03: Written from inside the sim's frame by a WASM module, an object keeps up with a flying aircraft

**Asked:** does an object written every frame from inside the sim, by a WASM module, hold still in a moving cockpit, where writes from outside stuttered ([entry below](#2026-10-03-writes-from-outside-the-sim-place-an-object-in-a-moving-cockpit-but-cant-hold-it-still))?

**Expected:** yes along the flight path, since `Update_StandAlone` sees each frame's aircraft pose before the frame is drawn.

**Found:**

- Our module, `crosscheck-p12-follow`, ran: its `L:CROSSCHECK_P12_ALIVE` counted 16 frames in 0.5s.
  It wrote the wand in all 301 frames of each 10s step, with both `fsVarsAVarSet`, given the wand's SimConnect object ID as its `FsObjectId`, and `SimConnect_SetDataOnSimObject` from inside the module, and neither returned an error.
- In a Cessna 152 at 97 to 109 kt, the pilot judged both module steps better than writes from outside: the wand no longer lagged along the flight path, and the pilot pressed once in each module step and not at all in the outside step.
- The wand still lagged when the aircraft pitched and rolled.
  The module turned its offset by heading only and wrote no pitch or bank, so that part is ours.
- The pilot saw the wand near the tail rather than at the seat, while SimConnect read it 0.37m behind the aircraft's reference point and the avatar's object 2.24m behind.
  Why the two disagree is unknown.

**Changed:** writing from inside the sim's frame keeps a figure up with a flying aircraft, so the WASM route works for aircraft whose files Crosscheck doesn't edit.
Where to write it, and how to follow pitch and roll, are still open.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p12's run](../../../experiments/areas/avatars/results/p12-wasm-2026-10-03-06-29-23.txt), and the module's source in [experiments/areas/avatars/wasm](../../../experiments/areas/avatars/wasm).

## 2026-10-03: A model attached through the aircraft's own files holds still in flight

**Asked:** do GSX's seated passengers, attached through the Fenix's own `attached_objects.cfg` ([entry below](#2026-10-03-gsx-keeps-its-passengers-aboard-by-adding-its-model-to-the-aircrafts-own-attachments)), hold still in flight with nothing outside the sim moving them?

**Expected:** yes, since the sim draws them as part of the aircraft.

**Found:** in the Fenix A320 (`A:TITLE` `FenixA320 CFM SL`) at 218 to 244 kt and about 5,100 ft AGL, we set every `L:FSDT_GSX_PASSENGER_SEAT_*` to 1 through SimConnect, and the passengers showed and held still in their seats for the 11s the pilot watched.
The only objects within 500m were the aircraft, the avatar's object, and `SEAT_DEFAULT_Pilot`, so no separate object carried the passengers for GSX's program to move.
The process check matched `Couatl64_boot`, which stays after Couatl is quit from its tray, so whether GSX's own program was running is unknown, and with no object to move it couldn't have moved them.

**Changed:** attaching through the aircraft's files is a measured way to keep a figure still in a flying aircraft, on aircraft whose package Crosscheck can edit.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p11's run](../../../experiments/areas/avatars/results/p11-fenix-attached-2026-10-03-06-12-41.txt), and a read-only listing of objects within 500m taken right after it.

## 2026-10-03: GSX keeps its passengers aboard by adding its model to the aircraft's own attachments

**Asked:** how does GSX keep its seated passengers still in a flying aircraft, when the object we spawned from its files stayed behind ([entry below](#2026-10-03-the-sim-doesnt-carry-an-object-of-category-viewer-with-the-aircraft))?

**Expected:** no prediction; GSX's own program is packed and its scripts encrypted.

**Found** (read in files, not run):

- GSX adds a section to the aircraft package's own preset `attached_objects.cfg`, and keeps the original beside it as `attached_objects.cfg.gsx`.
  In `fnx-aircraft-320`, preset `FNX_320_CFM_SL`, the added `[sim_attachment.2]` gives `attachment_root = SimObjects/GroundVehicles/FSDT_Passengers_Seats`, `attachment_file = model.FNX_A320_01/FSDT_Passengers_Seats.xml`, and `attach_to_model = exterior`.
  GSX also rewrote the package's `layout.json` to match the larger file.
- The same section is in 24 presets: every preset of `fnx-aircraft-320` and `fnx-aircraft-319-321`, three of `inibuilds-aircraft-a350`, and one of `pmdg-aircraft-77w`, the packages enabled in `%APPDATA%\Virtuali\Airplanes\PaxAirplanes_2024.json`.
- The attached model is 192 nodes at seat positions in meters from the aircraft's reference point, with no mesh and no animation of its own.
  Its XML hangs a seated figure on each node with `<ModelAttachments>`, each shown while its `L:FSDT_GSX_PASSENGER_SEAT_*` and `L:FSDT_GSX_INTPAX_VISIBLE` are set, and each figure plays its own idle animation.
- The PMDG 777 attaches its own copilot figure the same way, `[sim_attachment.5]` with `attach_to_model = "interior"` (read in pmdg-aircraft-77w 2.4.143).
- GSX's in-sim module, `fsdt-msfs-bridge.wasm`, exports only `module_init` and `module_deinit` and imports `set_named_variable_value` and `execute_calculator_code`, so it can set the `L:` variables and can't move an object.

**Changed:** the sim carries a model smoothly only when the aircraft's own files attach it, and GSX gets there by editing those files on the user's machine.
A Crosscheck figure could be attached the same way, with its parts moved by its own animations reading `CROSSCHECK_` `L:` variables, since an attached model's animations run on the aircraft it's attached to ([Model Attachments](https://docs.flightsimulator.com/msfs2024/html/3_Models_And_Textures/Model_Attachments.htm)).
Then a frame of lag in our writes moves a hand late, not the whole figure against the cockpit.
Editing another developer's aircraft package is a product decision, and it has to coexist with GSX's own edit of the same file.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** the subagent's read of the Fenix package and GSX Pro 4.0.19 on our development machine; the files belong to Fenix and FSDreamTeam, so nothing of them is in the repository.

## 2026-10-03: The sim doesn't carry an object of category Viewer with the aircraft

**Asked:** does the sim carry GSX's per-aircraft seat object with the aircraft by itself?
The pilot has seen GSX's seated passengers sit still in a flying Fenix A320, GSX's in-sim module does no per-frame writes, and the object's `sim.cfg` gives `category = Viewer`, which the SDK lists without explaining (read in fsdreamteam-gsx-pro 4.0.19, `modules/fsdt-msfs-bridge.wasm` and `SimObjects/GroundVehicles/FSDT_Passengers_Seats`).

**Expected:** no prediction.

**Found:** we spawned `FSDT_Passengers_Seats_FNX_A320_01`, whose `A:CATEGORY` read `Viewer`, at a Cessna 152's position at 94 kt, and wrote nothing to it.
In 20s it moved 0m over the ground while the aircraft flew 945m on, so the sim leaves it where it's put.
In a second run started in active pause, the passengers showed once we set their `L:FSDT_GSX_PASSENGER_SEAT_*` variables and `L:FSDT_GSX_INTPAX_VISIBLE` to 1 through SimConnect, and when the pilot unpaused, they stayed where they were while the aircraft flew on.

**Changed:** category Viewer isn't how GSX keeps its passengers with the aircraft, and how it does is still unknown.
The route for our figure stays a WASM module writing inside the sim's frame.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p10's run](../../../experiments/areas/avatars/results/p10-viewer-2026-10-03-05-35-26.txt).

## 2026-10-03: Writes from outside the sim place an object in a moving cockpit but can't hold it still

**Asked:** can a SimConnect client outside the sim keep an object fixed in the cockpit of a flying aircraft by writing its position every frame?

**Expected:** the object would trail by the distance the aircraft covers while a write reaches the sim, and writing it that far ahead would cancel the trail.

**Found:**

- In a Cessna 152 at 88 to 97 kt and 31 to 32 frames a second, SimConnect reported the seat objects and the seated avatar's object about 2.3m behind the aircraft's reference point, against 0.10m ahead parked.
  So it reports those objects about 50ms behind the aircraft in the same frame's data.
- p08 aimed `Marshaller_Stick` at that in-flight reading of `SEAT_C152_Pax` and wrote it every frame, and the pilot saw it trail toward the tail.
- p09 aimed it at the seat's parked position instead, and swept the lead from 0ms to 300ms, 5s a step.
  The wand showed about where intended at the lowest leads, and the pilot saw it stutter and lag at every step.
- Frame to frame, the wand's reading moved by a median of 0.5m to 0.8m (95th percentile about 2m), against 0.4m (0.8m to 1.2m) for the avatar's object, while the aircraft covered about 1.5m a frame.
  Each 33ms of lead moved the wand's reading about 1.6m forward, and no lead steadied it.

**Changed:** a figure in the cockpit of a flying aircraft can't be driven from outside the sim.
A file read we did alongside found no SimConnect call, WASM API, or separate package that attaches an object to another developer's aircraft: every attach mechanism, such as `attached_objects.cfg`, `<ModelAttachments>`, and the `[PILOT]` section, is declared in the aircraft's own files ([attached_objects.cfg](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/CFG_Files/attached_objects.htm), [Model Attachments](https://docs.flightsimulator.com/msfs2024/html/3_Models_And_Textures/Model_Attachments.htm)).
What's left is writing from inside the sim: a WASM module can set another object's variables with `fsVarsAVarSet`, which takes a target object (read in MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_Vars.h`), from `Update_StandAlone`, which an Asobo developer described as running after the sim's update and before model behaviors ([thread](https://devsupport.flightsimulator.com/t/update-standalone-and-when-it-gets-executed/15196)).
Whether that holds a figure still is untested.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p08's run](../../../experiments/areas/avatars/results/p08-in-flight-2026-10-03-05-11-58.txt) and [p09's run](../../../experiments/areas/avatars/results/p09-lead-2026-10-03-05-18-42.txt).

## 2026-10-03: SimConnect_CameraGet includes a Tobii head tracker's rotation, and its position is in meters

**Asked:** does a head tracker's movement show in `SimConnect_CameraGet`, and what are the axes and unit of its position?

**Expected:** ChasePlane mixes head tracking into the pose it gives the camera, since `CP.dll` logs `tobii_raw`, `applied_pose`, and `output_pose` (read in p42-util-chaseplane 26.39.1).
No prediction for the sim's own camera with ChasePlane off.
The pilot expected no translation from the tracker, which they believe a recent MSFS update broke (unverified).

**Found:**

- The pilot moved only their head, with a Tobii tracker running and their hand off the mouse.
  `A:CAMERA GAMEPLAY PITCH YAW` held at −6.3° and 1.3° throughout, so it doesn't include the tracker.
- With ChasePlane on, turning the head moved `SimConnect_CameraGet`'s pitch from −60° to 31° and its yaw from −87° to 73°, in the `SIMOBJECT` referential.
  Its position moved too, by up to 0.31m during the step where the pilot rose and sank in the seat.
- With ChasePlane disabled, turning the head moved the pitch from −80° to 11° and the yaw from −122° to 59°, and leaning rolled the camera by up to 21°.
  The position didn't move: every axis stayed within 0.0002m.
- From the `WORLD` referential's latitude, longitude, and altitude, the probe worked out where the camera was in meters from the aircraft's reference point.
  Against those, the `SIMOBJECT` and `EYEPOINT` positions are in meters, with x pointing left, y up, and z forward (correlation 1.000 on each axis, slope 1.00).
- ChasePlane's `L:p42_cp_r_x`, `_y`, and `_z` are in meters too, with x pointing right, y up, and z forward (slopes 1.00, 0.94, and 0.99).

**Changed:** `SimConnect_CameraGet` is the one source that follows the mouse, ChasePlane, and a head tracker, so it's what Crosscheck reads to turn the other pilot's head.
With ChasePlane off, the sim's own camera carries the tracker's rotation and none of its translation, so a lean shows only with ChasePlane on.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p07's run](../../../experiments/areas/avatars/results/p07-tracker-2026-10-02-22-16-05.txt).

## 2026-10-03: SimConnect_CameraGet gives where the pilot looks, with ChasePlane driving the camera or not

**Asked:** what tells Crosscheck where the pilot looks in the cockpit, whether or not ChasePlane drives the camera?

**Expected:** `A:CAMERA GAMEPLAY PITCH YAW` would read 0 with ChasePlane on and track the look with it off, as in p03 ([entry below](#2026-10-02-seat-objects-place-the-other-pilot-in-the-cockpit-and-the-seated-avatar-doesnt-turn-with-the-look)).
ChasePlane moves the sim's camera through Asobo's Camera API (read in p42-util-chaseplane 26.39.1, `ChasePlaneModule.wasm`, which imports `fsCameraAcquire`, `fsCameraSet`, and `fsCameraGet`), and Asobo staff wrote that from the sim's Sim Update 6 beta, 1.8.8.0, `SimConnect_CameraGet` returns the active camera even when nobody has acquired it ([thread](https://devsupport.flightsimulator.com/t/cameraapi-cameraget-behavior-requires-clarification/17697)).
ChasePlane's overlay adds `L:p42_cp_r_pitch` and `L:p42_cp_r_yaw` to the aircraft's attitude to show where the camera points (read in the same package, `P42ChasePlane_overlay.js`).
So we expected `SimConnect_CameraGet` to report where the pilot looks in both states, and the two `L:` variables to track it with ChasePlane on.

**Found:**

- With ChasePlane on, `SimConnect_CameraGetStatus` reported `ACQUIRED_BY_OTHER`, and with ChasePlane disabled in its own settings, `NOT_ACQUIRED`.
  Our client never acquired the camera.
- In both states, we sent `SimConnect_CameraGet` about every 100ms for 8s in each of the `SIMOBJECT`, `WORLD`, and `EYEPOINT` referentials, and got 77 replies in each, with no SimConnect exception.
- Its rotation is in degrees, and two fields of `SIMCONNECT_DATA_PBH` carry a different angle from the one `SimConnect.h` names.
  With ChasePlane on, the first, `Pitch`, carried the pitch, from −65° to 57°.
  The second, `Bank`, carried the yaw, from −115° to 96°.
  The third, `Heading`, carried the roll: it followed `L:p42_cp_r_roll` and stayed within 0.2° of 0 in the `SIMOBJECT` referential.
- With ChasePlane on, `L:p42_cp_r_pitch` and `L:p42_cp_r_yaw` tracked the look too.
  CameraGet's pitch was the negative of `L:p42_cp_r_pitch` (correlation −0.995), and its yaw matched `L:p42_cp_r_yaw` (0.996).
  With ChasePlane disabled, both held still.
- With ChasePlane disabled, CameraGet's pitch and yaw were the negatives of `A:CAMERA GAMEPLAY PITCH YAW:0` and `:1` in degrees (−0.996 each).
- In the `SIMOBJECT` referential the camera's position read about 0.22, 0.52, and −2.21 on x, y, and z, and moved by 0.02 to 0.04 while ChasePlane ran, and not at all without it.
  We don't know the axes or the unit.
  In meters the movement would be 2cm to 4cm, and a read taken after moving the camera a known distance would settle it.
  In `WORLD` it read latitude, longitude, and an altitude of 513.9, which matches the aircraft's 1,684 ft MSL in meters.

**Changed:** `SimConnect_CameraGet` gives where the pilot looks, both from ChasePlane's camera and from the sim's own, so Crosscheck can turn the head of the other pilot's figure without asking anyone to disable ChasePlane.
Whether a head tracker's movement shows in it is unmeasured.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p06's run](../../../experiments/areas/avatars/results/p06-camera-2026-10-02-22-02-56.txt), whose file name carries the time in UTC.

## 2026-10-02: Writing a GSX person's animation frame makes it walk, and a seated one moves on its own

**Asked:** can Crosscheck make a figure walk rather than slide, and sit in a seat?

**Expected:** each GSX person's model plays the animation frame whose number one variable of its own object holds.
The passengers' model XML passes `(A:VELOCITY BODY Y,m/s)` to `ASOBO_GT_Anim_Code`, the cleaner's passes `(A:WAGON FRONT LINK ORIENTATION, number)`, and each `sim.cfg` lists which frames are the idle and walk loops at 30 frames a second (read in fsdreamteam-gsx-pro 4.0.19, `SimObjects/GroundVehicles/FSDT_Passengers` and `FSDT_cleaning_crew`).
p02, in the [entry below](#2026-10-02-a-gsx-person-shows-and-follows-where-we-write-it-and-the-sims-own-people-stay-invisible), wrote `A:VELOCITY BODY Z`, which nothing in the model reads.
GSX's seated people are separate objects, whose model plays its clip with `typeParam="AutoPlay,Random"` and no variable (read in the same package, `FSDT_Passengers_Seated`).

**Found:**

- Every sim frame we wrote walk-loop frames to `A:VELOCITY BODY Y` on `FSDT_Passenger_CASUAL_M_0030`, and to `A:WAGON FRONT LINK ORIENTATION` on `FSDT_cleaning_crew_M_0020`.
  Both walked in place: the pilot pressed Page Down, the probe's signal that a figure's legs were moving, about 1.3s after each appeared.
- The objects, released with `SimConnect_AIReleaseControl` and frozen with `K:FREEZE_LATITUDE_LONGITUDE_SET`, `K:FREEZE_ALTITUDE_SET`, and `K:FREEZE_ATTITUDE_SET`, kept what we wrote: frame 245 read back as 245, and 165 as 165.000002.
- The passenger then kept 4m in front of the avatar for 30s.
  While the pilot walked, we advanced its walk frame by the distance it covered, at the rate its 3.57m stride sets, and while the pilot stood, we played its idle loop by time.
  It spent 349 sim frames walking and 582 idling, and the pilot judged its steps close enough to tune later.
- `FSDT_Passenger_CASUAL_M_0030_SEATED`, of `A:CATEGORY` `StaticObject`, sat on `SEAT_C152_Pax` and moved on its own, breathing and shifting, with nothing written.
  Its feet were at the seat object's position, so it sat a seat's height too high: the model's origin is at its feet, while the seat object marks where a person sits.

**Changed:** a figure Crosscheck ships can walk under our own writes, built as GSX's people are: one clip whose frame is a variable of the figure's own object.
A seated figure needs only a position, and with its origin at the hip it would sit on an aircraft's seat objects with no offset.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p04's run](../../../experiments/areas/avatars/results/p04-walk-2026-10-02-21-50-46.txt) for walking, and [p05's run](../../../experiments/areas/avatars/results/p05-seated-2026-10-02-21-55-07.txt) for sitting.
The p04 run from 21:50:18 was a false start, and nothing here uses it.

## 2026-10-02: Seat objects place the other pilot in the cockpit, and the seated avatar doesn't turn with the look

**Asked:** what can Crosscheck read and show of the other pilot in the cockpit?

**Expected:** no prediction.

**Found:**

- The C152 has seat objects, `SEAT_C152_Pilot` and `SEAT_C152_Pax`, of `A:CATEGORY` `SimpleObjectSim`, which `SimConnect_RequestDataOnSimObjectType` lists within 50m.
  From the aircraft's reference point, the pilot's sits 0.10m forward, 0.23m left, and 0.14m down, and the passenger's 0.10m forward, 0.21m right, and 0.13m down.
- Seated, the avatar's object sits exactly on `SEAT_C152_Pilot`.
- While the pilot looked around for 8s, the avatar's object's heading held at 26.66° true, the aircraft's heading.
- A standing GSX passenger placed on `SEAT_C152_Pax` was drawn in the cockpit view, standing and clipping through the aircraft.
- With ChasePlane driving the camera, `A:CAMERA GAMEPLAY PITCH YAW` read 0 at both indexes.
  With ChasePlane disabled in its own settings but its bridge, `CP MSFS Bridge.exe`, still running, `A:CAMERA GAMEPLAY PITCH YAW` tracked the look: pitch −77.5° to 74.6°, yaw −156.7° to 119.7°.
- `L:p42_cp_rendered_camera_sequence` advanced every frame, and `L:p42_cp_rendered_camera_valid` stayed 0.

**Changed:** on an aircraft with seat objects, Crosscheck can read both seats' positions, and the figure goes in the other pilot's seat.
Where the pilot looks has to come from the camera, not the avatar, and the [entry above](#2026-10-03-simconnect_cameraget-gives-where-the-pilot-looks-with-chaseplane-driving-the-camera-or-not) finds a source that works with ChasePlane.

**Affects:** the ideas [Avatar sync](../product/ideas.md#avatar-sync) and [Seat awareness](../product/ideas.md#seat-awareness).

**Evidence:** [p03's run](../../../experiments/areas/avatars/results/p03-cockpit-2026-10-02-21-42-04.txt).

## 2026-10-02: A GSX person shows and follows where we write it, and the sim's own people stay invisible

**Asked:** can Crosscheck show the other pilot's avatar by spawning a figure and writing its position every frame?

**Expected:** the sim's own people, titled `CharacterSim_...`, would stay invisible, as developers on the DevSupport forum reported ([2024 thread](https://devsupport.flightsimulator.com/t/simconnect-injections-in-fs2024/11769), [2026 thread](https://devsupport.flightsimulator.com/t/charactersim/18104)).
No prediction for anything else.

**Found:**

- The sim's own people near the gate had `A:CATEGORY` `ProceduralCharacter` and `A:TITLE` `CharacterSim_Female_Heavy` and `CharacterSim_Male_Thin`.
  We spawned both with `SimConnect_AICreateSimulatedObject_EX1`, and `CharacterSim_Male_Thin` again with `SimConnect_AICreateSimulatedObject`.
  Each was created and read back at the spot we gave, and the pilot saw nothing.
- `SimConnect_EnumerateSimObjectsAndLiveries` lists no `CharacterSim_` title for any object type, so these titles turn up only as live objects near the pilot.
- The same call lists GSX's people among its ground vehicles, with titles starting `FSDT_`.
  Five of them showed 4m in front of the pilot: `FSDT_Passenger_CASUAL_M_0030`, `FSDT_Passenger_BUSINESS_F_0024`, `FSDT_Passenger_PILOT_02`, `FSDT_Marshaller_02`, and `FSDT_cleaning_crew_M_0020`, each with `A:CATEGORY` `GroundVehicle`.
  The pilot pressed Page Down on seeing each one, about 2s after it appeared.
- `Marshaller_Stick`, a marshaller's wand with `A:CATEGORY` `StaticObject`, showed too, and `SEAT_C152_Pilot`, with `SimpleObjectSim`, didn't.
- We released and froze the casual passenger, then every sim frame wrote it 4m in front of where the avatar had been 300ms earlier, facing the way the avatar faced.
  In 30s, 930 writes ran with no exception.
  The figure kept up with the pilot, turned with them, and stayed on the ground, but slid: writing `A:VELOCITY BODY Z` from the avatar's ground speed didn't start its walk.

**Changed:** the sim's own people are out as the figure.
A person shows when a package ships it as a SimObject with a model of its own, as GSX does, so Crosscheck would ship its own figure that way rather than depend on GSX.
Why the sim's own people stay invisible is unverified.
What starts a figure's walk is unknown, and reading how GSX's people are animated in their SimObject files would settle what a figure of ours needs.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p01's run](../../../experiments/areas/avatars/results/p01-avatar-2026-10-02-21-05-51.txt) for the sim's own people, the wand, and the seat, and [p02's run](../../../experiments/areas/avatars/results/p02-figures-2026-10-02-21-20-34.txt) for GSX's people and the figure that followed the avatar.
The other p02 run in the folder, from 21:19:43, was a false start, and nothing here uses it.

## 2026-10-02: The avatar's own object ID gives its position, speed, and facing every sim frame

**Asked:** can a SimConnect client read where the pilot's avatar is and which way it faces, and through which object ID?

**Expected:** `SIMCONNECT_OBJECT_ID_USER_AVATAR`, which the SDK's `SimConnect.h` defines, to give the avatar's position.
On the DevSupport forum, an Asobo developer wrote that "index 2" on `A:PLANE LATITUDE`, `A:PLANE LONGITUDE`, and `A:PLANE ALTITUDE` gives the avatar's position, and another developer got `UNRECOGNIZED_ID` reading object 2 ([thread](https://devsupport.flightsimulator.com/t/avatar-pilot-on-walk-around-mode-simvars-to-know-its-location/10684)).

**Found:**

- `SIMCONNECT_OBJECT_ID_USER_AVATAR` answered every sim frame, 31 times a second at that frame rate, with `A:PLANE LATITUDE`, `A:PLANE LONGITUDE`, `A:PLANE ALTITUDE`, `A:PLANE HEADING DEGREES TRUE`, `A:GROUND VELOCITY`, `A:SIM ON GROUND`, and `A:IS CROUCH`.
  Its `A:CATEGORY` reads `CharacterSim` and its `A:TITLE` is empty.
  `SimConnect_RequestDataOnSimObjectType` with type `SIMCONNECT_SIMOBJECT_TYPE_USER_AVATAR` listed it as object 32768.
- `A:GROUND VELOCITY` read about 3.9 kt walking and 5.8 kt running.
  `A:VELOCITY BODY Z`, `A:PLANE PITCH DEGREES`, `A:PLANE BANK DEGREES`, and `A:HAND ANIM STATE` stayed 0.
- `A:PLANE HEADING DEGREES TRUE` is the way the body faces.
  Walking a circle, it differed from the direction of travel by a median 6°.
  Walking backward, it held at 213° while the avatar moved the opposite way.
  Standing still and looking around, it swept through 250° in steps of about 2° a frame, and the pilot saw the avatar's body turn with the camera.
- `SIMCONNECT_OBJECT_ID_USER_CURRENT` gave the avatar on foot and the aircraft once the pilot sat down.
- The avatar's object stays while the pilot is seated, 0.3m from the aircraft's reference point, at the aircraft's heading.
  `E:IS AVATAR` and `E:IS AIRCRAFT`, read on object 0, swapped when the pilot sat down.
- Object ID 2 answered `UNRECOGNIZED_ID`, and on object 0, `A:PLANE LATITUDE:1` and `A:PLANE LATITUDE:2` both returned the aircraft's position, so "index 2" works as neither an object ID nor a variable index.
- `A:CAMERA GAMEPLAY PITCH YAW` stayed 0 at both indexes throughout, on foot and seated, with ChasePlane running, so the camera's direction is unmeasured.

**Changed:** one SimConnect request at the sim's frame rate gives Crosscheck everything it needs to place the other pilot's figure on foot, and the heading turns the figure the way the pilot faces.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p01's run](../../../experiments/areas/avatars/results/p01-avatar-2026-10-02-21-05-51.txt) for the object IDs and the seated avatar, and [p02's run](../../../experiments/areas/avatars/results/p02-figures-2026-10-02-21-20-34.txt) for the heading.
