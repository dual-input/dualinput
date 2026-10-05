# Avatars: log

What our experiments found about showing one pilot's avatar on the other pilot's machine with MSFS multiplayer off, newest entry first.
The avatar shows as a figure: an object Crosscheck spawns and moves.
SimConnect reads the avatar's position, ground speed, and facing every sim frame through `SIMCONNECT_OBJECT_ID_USER_AVATAR`, and `SimConnect_CameraGet` gives where the pilot looks, whether ChasePlane drives the camera or not.
The sim's own people stay invisible when a SimConnect client spawns them, GSX's people show, and a model of our own compiles from generated glTF, with its size and color set per object while it runs.
A figure of our own, balls and sticks whose joints are animations that read variables, poses in the cockpit as our dev page poses it, and one variable changes its color.
In a moving cockpit, a WASM module that writes the figure inside the sim's frame, turned by the aircraft's full attitude and led by 0.75 to 1 frame, holds it in its seat.
The figure's hand goes where the pilot clicks: the ray from the eye through the cursor, cast into the aircraft's interior model, lands within 2mm with no calibration and no control names, and a held press glides along the surface it touched.
A sidestick's grip moves with its own animations as a yoke does, though of the three sidestick airliners we could read, only the Fenix marks where the hand goes.
Many figures, each posed from its own object's variables, cost about 18µs a frame each in view and almost nothing out of view.
The probes are p01 to p28 in [experiments/areas/avatars](../../../experiments/areas/avatars), and their raw output is in [experiments/areas/avatars/results](../../../experiments/areas/avatars/results).
Every entry that ran in the sim was measured on MSFS 2024 SunRise 12.2.282174.999 between 2026-10-02 and 2026-10-05, at a gate at LQSA with the Cessna C152 Aerial Advertising unless the entry names another aircraft, on our development machine with GSX Pro 4.0.19 and ChasePlane 26.39.1 installed.

## 2026-10-05: Each figure poses from its own object's variables, costs frame time in view and almost none out of view, and costs nothing to write

**Asked:** does one sim draw many of our figures, each posed from variables of its own object, and what do 2, 20, and 180 cost in frame time with every joint moving every frame ([the plan](../product/plan.md)'s step 6; [04-room-for-later](../product/04-room-for-later.md#people-beyond-the-crew))?
Then, where's the ceiling, and what does a figure out of view or hidden behind the aircraft cost?

**Expected:** joints would follow object variables as [p17's sphere's size and color did](#2026-10-03-a-model-of-our-own-compiles-from-generated-gltf-and-its-size-and-color-follow-variables-of-its-own-object), and nobody had measured the cost.

**Found:** `CROSSCHECK_FigureZ` is p24's figure with every joint and its color read from `Z:` variables of its own object.
p28 spawned it through SimConnect on a grid of 40 a row, 1.5m apart, ahead of or behind the aircraft, froze each one, and a WASM module wrote all 28 of every figure's `Z:` variables every frame, moving every joint ("moving"), holding a pose of its own ("written, still"), or writing nothing ("not written").
Each frame rate is a 10s average, with the frame rate uncapped and frame generation off unless the setup says otherwise:

- The figures stood in poses and colors of their own, at 20 and at 180, so each follows its own object's variables.
- Writing costs nothing we could measure: "written, still" matched "not written" at every count, up to 28,000 `Z:` values a frame.
- The figures' cost, in the A2A PA-24 on EGLL runway 27R, looking forward at them:

  | Figures | Not written | Written, still | Moving |
  | --- | --- | --- | --- |
  | 0 | 53.3 fps, 18.8ms | | |
  | 180 | 44.3 fps | 44.5 fps | 41.1 fps |
  | 400 | 37.4 fps | 37.4 fps | 32.2 fps |
  | 800 | 30.4 fps | 30.2 fps | 22.1 fps |
  | 1,000 | 28.4 fps | 28.1 fps | 19.5 fps |

  A still figure in view adds 16µs to 21µs to the frame, and moving every joint adds 10µs to 16µs more.
- Where the figures stood against the camera, in frame time added by 1,000 figures, or by 800 in the PA-24:

  | Setup | Still | Moving |
  | --- | --- | --- |
  | PA-24, figures ahead, looking forward | +14.7ms | +26.8ms |
  | PA-24, figures ahead, looking backward | +1.1ms | +1.8ms |
  | iniBuilds A380 with Beyond ATC injecting traffic, figures ahead, looking forward | +16.3ms | +34.6ms |
  | A380, figures behind, looking forward | +1.3ms | +1.1ms |
  | A380, figures behind, looking backward through the aircraft from its cockpit | +13.0ms | +25.1ms |

  The A380's frame rate was about 21 fps with no figures, so a figure costs the same time whatever else the sim draws.
  Behind the aircraft and looking forward, every count stayed within about 1ms, the noise of a 10s average with traffic moving.
- The `L:` name table held 6,517 names before and after 1,000 figures, so `Z:` variables don't add to it.
- With the frame rate capped at 30 fps, 180 moving figures held 31.0 fps, so a cap hides the cost below it.

**Changed:** the sim skips drawing, and most animating, for figures outside the view, but draws figures hidden inside it almost in full.
So a cabin of passengers behind a pilot looking forward costs little, and the same pilot looking back at a closed cockpit door pays for the whole cabin: in the A380, 180 figures cost 3.4ms standing still and 7.2ms moving.
The cost is drawing and animating changed joints, not our writes, so a passenger feature saves by changing fewer joints less often and drawing less: a lower update rate, fewer figures moving at once, a lighter model, and a seated level of detail without legs, kept for aisle seats, since a seat map says who sits there and anyone not seated shows as a head alone (user, 2026-10-05).
Those wait for the passenger feature.

**Affects:** [04-room-for-later](../product/04-room-for-later.md#people-beyond-the-crew).

**Evidence:** `experiments/areas/avatars/results/p28-many-figures-2026-10-05-18-18-00` (capped at 30 fps, the PA-24 at KSEA), `-18-32-07`, `-18-35-24`, `-18-46-28`, and `-18-49-45` (the PA-24 on EGLL 27R), and `-18-57-34`, `-19-04-40`, and `-19-13-17` (the A380), each `.txt` and `.ndjson`; each report states its setup and grid.

## 2026-10-04: Of the three sidestick airliners we could read, only the Fenix marks a grip, and each stick's grip moves with its own two animations

**Asked:** does the Synaptic A220's sidestick carry what our yoke hand holds, a `[VR]` section and `HANDLING_` hand nodes, and can the figure hold a sidestick as it holds a yoke?
Then the same for the other aircraft installed on our development machine.

**Expected:** sidesticks would carry hand nodes like the yokes' `HANDLING_Yoke_1_Hand_Left` and `_Right`, which we take to be for the sim's VR hands (unverified).

**Found:**

- No sim ran: two tools read the files of 12 aircraft packages, synaptic-aircraft-a220 1.0.10, fnx-aircraft-320 and fnx-aircraft-319-321 2.4.0.4720, inibuilds-aircraft-a350 1.2.6, inibuilds-aircraft-a380 1.0.0, inibuilds-aircraft-l1011 1.0.8, pmdg-aircraft-77w 2.4.143, fsreborn-aircraft-phenom300e 1.0.24, a2a-aircraft-aerostar600 1.0.6, a2a-aircraft-pa24 2.1.3, bksq-aircraft-baronpro 0.1.1, and bksq-aircraft-bonanzapro 0.1.1.
- The A380 and the Phenom 300E come from the Marketplace and ship their files as `.fsc`, which we can't read, so neither has a `.cfg` or a glTF to check.
  The Fenix A319 and A321 package's 28 models have no hand or stick nodes.
- The rest mark their controls this way:

  | Aircraft | Controls | `[VR]` section | Hand nodes |
  | --- | --- | --- | --- |
  | Synaptic A220 | sidesticks | none | none |
  | Fenix A320 | sidesticks | none | `HANDLING_Yoke_1_Hand`, on the captain's stick only |
  | iniBuilds A350 | sidesticks | every key empty | none |
  | iniBuilds L-1011 | yokes | names `CPT_JOY_HANDLE`, the A350's stick grip, which no L-1011 model has | `HANDLING_Yoke_1_Hand_Left`, `_Right`, and the same for `Yoke_2` |
  | PMDG 777-300ER | yokes | none | none |
  | A2A Aerostar 600 | yokes | none | none |
  | A2A Comanche, Black Square Baron and Bonanza | yokes | names the yoke and its two animations | `HANDLING_Yoke_1_Hand_Left`, `_Right`, and `_Wheel_Center` |

- Each stick's grip is a mesh that the stick's roll and pitch animations turn, so a point fixed in the grip's own frame follows the stick.
  Posed at the start, middle, and end of each animation, the top of each grip moves this far from where it sits at the middle frame:

  | Aircraft | Grip nodes | Grip size | Side to side | Fore and aft | What drives the animations |
  | --- | --- | --- | --- | --- | --- |
  | Synaptic A220 | `CPT_STICK_HANDLE`, `FO_STICK_HANDLE` | 10 × 19 × 11cm | 4.2cm each way | 6.3cm and 5.3cm | `L:A22X L Sidestick X` and `Y`, as `(L:A22X L Sidestick X, Percent) neg 2 / 50 +` in `Sidestick.xml` |
  | Fenix A320 | `Misc_Sidestick_Pitch_Captain_3`, `Misc_Sidestick_Pitch_FO_3` | 10 × 15 × 16cm | 3.9cm each way | 3.9cm each way | `L:N_FC_SIDESTICK_CAPT_PITCH` and `_BANK`, -1000 to 1000 ([Fenix study](../aircraft/fenix-a320-family/study.md)), through Fenix's `FNX32X_Interact_Sidestick_Template` |
  | iniBuilds A350 | `CPT_JOY_HANDLE`, `FO_JOY_HANDLE` | 8 × 14 × 14cm | 8.8cm and 5.3cm | 7.2cm each way | compiled code in the behavior file's `<Strings>` table ([A350 study](../aircraft/inibuilds-a350/study.md)) |

  The A220's code centers its stick at the middle frame.
  We haven't read the Fenix's or the A350's code, so their middle frame may not be the stick's center, which the A350's uneven 8.8cm and 5.3cm suggest (unverified).
- The Fenix's `HANDLING_Yoke_1_Hand` sits under the captain's grip, `Misc_Sidestick_Pitch_Captain_3`, 2.1cm from the middle of the grip's mesh, within its bounds, as the yokes' hand nodes sit inside their horns.
  Its name has no `_Left` or `_Right`, so the names the yoke rule looks for don't find it.
  The first officer's stick repeats the captain's pivots with `_FO` for `_Captain`, but has no hand node.
- Nothing moves the A220's first officer's stick: its animations read `L:A22X R Sidestick X` and `Y`, which nothing wrote in that run (measured on MSFS 2024, 2026-10-04, [entry above](#2026-10-04-in-the-a220s-right-seat-the-figures-right-hand-held-the-first-officers-sidestick-and-nothing-moved-that-stick)).
- `lib/cockpit-files.mjs` finds a part's animation code in a `<UseTemplate>` block that holds an `ANIM_CODE`.
  The Fenix's sidestick blocks name a template and a variable instead, and the A350's code sits in the compiled `<Strings>` table, so for those two our copy of the model can't pose the stick yet.

**Changed:** the figure can hold a sidestick as it holds a yoke, by a point fixed in the grip's frame and posed from the stick's own animations.
Only the Fenix marks that point, and only on the captain's stick, so elsewhere it comes from the grip's mesh or from the profile author.
Posing the Fenix's and the A350's sticks needs the template expanded and the compiled strings resolved.
The hand rules still need a sidestick version, since a pilot holds the stick with the outboard hand and never hands it to the other.

**Affects:** [the avatars' tentative decisions](decisions.md), whose grip rule names only yoke nodes and whose hand rules leave sidesticks out, and the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [tools/grips.mjs](../../../experiments/areas/avatars/tools/grips.mjs) and its [run](../../../experiments/areas/avatars/results/grips-2026-10-04.txt), and [tools/stick.mjs](../../../experiments/areas/avatars/tools/stick.mjs) and its [run](../../../experiments/areas/avatars/results/stick-2026-10-04.txt).

## 2026-10-03: In the right seat, the figure's hands followed the yoke rules with the right hand on the yoke, and the module held it in its seat at up to 185 kt GS

**Asked:** driven as a session would drive it, does the figure look right?
Its hands go where the pilot clicks, by the yoke rules with the right hand holding the copilot's yoke, in front of the right seat, at rest, its head looks where the pilot looks, and the module holds it in the right seat, parked and in flight.

**Expected:** the rules would carry over with the right hand on the yoke at rest, and the module, which held GSX's seated passenger in a flying C152 ([entry below](#2026-10-03-over-three-minutes-of-flying-leads-of-075-and-1-frame-both-hold-the-figure-and-whats-left-reads-as-inertia)), would hold our figure too.

**Found:**

- In the Black Square Baron 58P, p25 placed `CROSSCHECK_Figure` on the right seat's node `PILOT_1` through `crosscheck-p12-follow`, every frame, turned by the aircraft's full attitude and led by 1 frame.
  The module wrote it in 34,739 frames with no error over 19 minutes: about 10 minutes of clicks while parked, then flight up to 185 kt GS, read as `A:GROUND VELOCITY`.
- The Baron marks grips only on the pilot's yoke.
  Its copilot's yoke repeats the pilot's yoke's hierarchy, `YokePitch_R`, `YokeRoll_R`, and `Yoke_R`, moved by the same two animations, but `Yoke_R` is turned 180° from `Yoke_L`.
  Grip nodes placed under `Yoke_R` missed the copilot's yoke.
  Placed relative to `YokeRoll_R` as they sit relative to `YokeRoll_L`, a ray from the copilot's eye met the horn 1.7cm before each grip, as it meets the pilot's ([entry below](#2026-10-03-one-hand-holds-the-yoke-through-its-whole-travel-posed-from-the-aircrafts-own-code-while-the-other-taps-and-they-swap-by-side)).
- The pilot clicked from the left seat for the figure in the right seat: the left hand tapped 128 times and the right hand 36, 26 of those taps drags, and the yoke changed hands 14 times over 33 sessions.
  All 3 thumb presses were on the copilot's wheel itself, `Yoke_R`, not on its buttons.
- The middle of the pilot's view met the cockpit on 2,906 of 5,737 looks, and on the rest the figure looked the way the pilot looked.
- The pilot judged that the figure held its seat in flight and looked good, except that some part of it missed a frame now and then.
  Which part, and why, is unknown.
  A telescope switching pairs on a frame before its length moves, if visibility and translation update on different frames, would show that way, and so would a late placement (both unverified).

**Changed:** the yoke rules and the module's placement carry over to the right seat with our own figure.
Where a copilot's yoke repeats the pilot's, its grips can come from the pilot's, relative to the yoke's roll node.
The missed frame needs looking into when the product builds the figure.
A click on a yoke's wheel itself still falls under the thumb rule, which needs a rule of its own ([entry below](#2026-10-03-one-hand-holds-the-yoke-through-its-whole-travel-posed-from-the-aircrafts-own-code-while-the-other-taps-and-they-swap-by-side)).

**Affects:** [the avatars' tentative decisions](decisions.md) and the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p25's run](../../../experiments/areas/avatars/results/p25-figure-hands-2026-10-03-15-04-36.txt), and its record with the figure's per-tick writes taken out.

## 2026-10-03: A probe can screenshot the sim window, and a screenshot can show a home folder's path and a person's name

**Asked:** can a probe take a screenshot at each pose for us to judge afterward, so the pilot only has to point the view?

**Expected:** a copy of the window's client area would work with the sim in a window, and would come back black in exclusive fullscreen (unverified).

**Found:**

- p24 copies the sim window's client area with .NET's `Graphics.CopyFromScreen`, after `SetProcessDPIAware`, at 2401×1360 pixels, the window's size as p20 measured it.
  None of the shots over 7 runs came back black: their mean brightness ran from 87 to 138 out of 255.
- A full shot is about 5.9MB as PNG, 159MB for a run of 27, so p24 also writes a JPEG 1,200 pixels wide with the top 100 pixels cut off, about 120KB.
- The full shots show the home folder's path in the title bar of Devmode's Project Editor.
  The Baron's GTN shows, on its start screen, the name its license is registered to, readable in the full shot.

**Changed:** a probe can screenshot each pose for us to read afterward.
p24's screenshots stay out of the tree ([experiments/areas/avatars/.gitignore](../../../experiments/areas/avatars/.gitignore)), and one goes in only after someone has read it.

**Affects:** the probes in [experiments/areas/avatars](../../../experiments/areas/avatars).

**Evidence:** the capture in [p24-figure.mjs](../../../experiments/areas/avatars/p24-figure.mjs), and the shot lines in [p24's last run](../../../experiments/areas/avatars/results/p24-figure-2026-10-03-12-44-14.txt).

## 2026-10-03: Sticks that telescope, two fixed pieces shown by the stick's length, end at the hands and feet

**Asked:** with neither a stretching scale nor a skin usable ([entry below](#2026-10-03-the-sim-doesnt-play-a-scale-animation-that-stretches-a-stick-along-its-length), [entry below](#2026-10-03-a-skinned-stick-took-the-sim-down-in-an-in-sim-build-and-a-crashed-sim-held-fspackagetool-until-it-was-closed)), can a stick reach any length from what the sim has shown it plays: fixed meshes, translation, and visibility from a variable?

**Expected:** yes, since p17's sphere showed visibility from a variable, and p24's hands landed by translation.

**Found:**

- Each arm, thigh, and shin is 7 pairs of fixed pieces, from 2cm to 1.28m long.
  One piece of a pair runs forward from the stick's base, and the other back from the node at its end, 1% thinner, so where they overlap one surface is always in front.
  A pair of length s covers any length from s to 2s, and visibility rules on the stick's length show only the pair that fits: 84 pieces, 12 shown at a time.
- fspackagetool compiled all 32 of the model's meshes at their source dimensions.
- In the Black Square Baron 58P, parked, at rest, with both hands on the panel, and with both feet on the pedals, every stick ended at its hand, knee, or foot, and the knee drew as one even tube.
- In the runs before, the colors looked paler in the sim than in the dev page, which the pilot put down to the sim's HDR.
  In this run, after the pilot turned HDR off, the screenshots show them as the dev page does.

**Changed:** the figure's limbs reach whatever length the variables give, with no scale animation and no skin.
The figure is 207 nodes, 32 meshes, 28 animations, and 84 visibility rules.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p24's run](../../../experiments/areas/avatars/results/p24-figure-2026-10-03-12-44-14.txt), and `TELESCOPE` in [figure/model.mjs](../../../experiments/areas/avatars/figure/model.mjs).

## 2026-10-03: A skinned stick took the sim down in an in-sim build, and a crashed sim held fspackagetool until it was closed

**Asked:** can a skinned stick, its near ring bound to a joint at its base and its far ring to the node at its end, stretch by that node's translation alone?

**Expected:** yes, since the sim plays GSX's skinned people from a variable (p04).

**Found:**

- In the dev page, every vertex of a stick's far ring sat one stick radius from its ball's center, at rest and reaching.
- In the sim, Build and Mount of the skinned model in the Project Editor took the sim down.
  The build had copied the model's XML and never wrote its glTF or buffer.
- With the sim closed, fspackagetool failed twice after 121s with an empty `_RPTErrors.xml`, once on the skinned model and once on the telescoping one.
  Something of the crashed sim that `build.mjs`'s check for `FlightSimulator2024.exe` didn't catch was still running, and once the pilot closed it, the telescoping model built in 16s.
  Which process it was is unknown.
- So the standalone failures came from the crashed sim, and whether the skin caused the crash is unknown.
  The skin's layout was unusual, though the glTF 2.0 spec allows it: six skins of two joints each, `JOINTS_0` as unsigned shorts, and inverse bind matrices that put each stick's mesh in its base joint's frame rather than where the stick sits in the model.

**Changed:** we set skins aside for the telescope ([entry above](#2026-10-03-sticks-that-telescope-two-fixed-pieces-shown-by-the-sticks-length-end-at-the-hands-and-feet)).
After a crash, the sim has to be closed in full before fspackagetool runs.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** the skinned model, `experiments/areas/avatars/figure/model.mjs` at commit d96c749, and the package folder's file times, read when it happened; no run file.

## 2026-10-03: The sim doesn't play a scale animation that stretches a stick along its length

**Asked:** why did every stick run past its hand or foot?

**Expected:** each stick's scale animation, from (1, 1, 0) to (1, 1, 1.5) along the stick, would stretch it to its length, as it does in the dev page.

**Found:**

- In the Black Square Baron 58P, parked, with each stick size a mesh of its own 1m long, every arm, thigh, and shin drew its full 1m from its base, past its hand or foot.
  The hands and feet, placed by translation, landed where the dev page puts them.
- fspackagetool kept the animation as written, 2 keys from (1, 1, 0) to (1, 1, 1.5).
- With the first key at (1, 1, 0.01), the sticks drew at 1m again.
- p17's scale animation, from 0.5 to 5 the same on all three axes, played.

**Changed:** a stick can't stretch by a scale animation along its length, and the stretch moved to a skin, then to the telescope ([entry above](#2026-10-03-sticks-that-telescope-two-fixed-pieces-shown-by-the-sticks-length-end-at-the-hands-and-feet)).
Why is unknown: the sim may play only a scale that's the same on all three axes, or only one of the three components (unverified).

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** p24's runs [with a first key of 0](../../../experiments/areas/avatars/results/p24-figure-2026-10-03-12-18-15.txt) and [of 1cm](../../../experiments/areas/avatars/results/p24-figure-2026-10-03-12-25-37.txt).

## 2026-10-03: fspackagetool rewrote a mesh that nodes shared under different uneven scales

**Asked:** why did the sticks draw thinner than the balls at the knee, when both had the leg's radius?

**Expected:** each node's scale would size the one shared stick, as it does in the dev page.

**Found:**

- The model used one unit stick, radius 1 and length 1, under nodes scaled (0.015, 0.015, 1) for the arms, (0.018, 0.018, 1) for the thighs and shins, and (0.018, 0.018, 0.028) for the knee's segments.
- fspackagetool's compiled model kept every node's scale and rewrote that mesh to radius 0.044 and length 2.913.
  0.044 is 0.015 times 2.913, the arm's scale times a factor we can't account for.
- The sphere mesh, shared by balls each scaled the same on all three axes, kept its radius of 1.
- With each stick size a mesh of its own, its radius and any fixed length in its vertices and no scale on its node, the compiled meshes kept their dimensions.

**Changed:** the figure's meshes carry their sizes in their vertices, and only balls carry a scale, the same on all three axes.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p24's run](../../../experiments/areas/avatars/results/p24-figure-2026-10-03-11-58-55.txt), whose screenshots showed the thin sticks, and the compiled models read after this run and after the next build.

## 2026-10-03: Build and Mount gives a freshly spawned figure a rebuilt model with no restart

**Asked:** can we change the figure's model while the sim runs, when a build with fspackagetool needs the sim closed and a restart?

**Expected:** the SDK documents that the Project Editor's Build package button "temporarily" adds the package to the sim, and that its right-click menu has Build and Mount ([The Project Editor](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Project_Editor/The_Project_Editor.htm)).

**Found:**

- With `crosscheck-figure` installed in Community, a build of the project in the Project Editor, then a fresh spawn, drew the old model, and so did a spawn after the build had reloaded the flight.
- Build and Mount, from the package's right-click menu, then a fresh spawn, drew the rebuilt model: a test build's 30cm nose showed at once, over the Community copy.
- Before building, the Project Editor upgraded the package's SimObject asset group from `Type Version="0"` to `"1"`, and Build and Mount asked for the package's order hint, `CUSTOM_SIMOBJECTS` for a SimObject of our own.
  We didn't separate which of Build and Mount and the order hint made the second try work.

**Changed:** a change to the figure's model reaches the sim in about a minute, with no restart: `build.mjs --write-only`, Build and Mount, and a fresh spawn.
`build.mjs` writes the asset group's version and the order hint, so the Project Editor shouldn't ask again (unverified).

**Affects:** [figure/build.mjs](../../../experiments/areas/avatars/figure/build.mjs).

**Evidence:** p24's runs [after the build](../../../experiments/areas/avatars/results/p24-figure-2026-10-03-11-50-36.txt) and [after Build and Mount](../../../experiments/areas/avatars/results/p24-figure-2026-10-03-12-07-09.txt).

## 2026-10-03: Our own figure poses in the sim from its variables, plays between frames smoothly, and changes color through `ASOBO_property_animation`

**Asked:** does a figure of our own pose in the sim as our dev page poses it?
It's a glTF that [figure/model.mjs](../../../experiments/areas/avatars/figure/model.mjs) generates, balls and sticks whose joints are animations reading variables.
Does a value between two of an animation's frames play smoothly?
And can `ASOBO_property_animation` change its color from a variable?

**Expected:** the joints would follow, since p17's sphere scaled from a variable.
We had no prediction for values between frames.
The extension animates a texture's offset in A2A's Aerostar (read in a2a-aircraft-aerostar600, `EXTERIOR_LOD07.gltf`), and an Asobo developer wrote that the sim plays it only linearly ([thread](https://devsupport.flightsimulator.com/t/animated-material-uv-offset-via-asobo-property-animation-blender-undocumented-export-requirements-interpolation-mode-ignored-both-at-export-and-at-runtime/18336)), but nothing we found said a base color could be its target.

**Found:**

- In the Black Square Baron 58P, parked, p24 spawned `CROSSCHECK_Figure`, a StaticObject in our `crosscheck-figure` package, on the copilot's seat node `PILOT_1` with the aircraft's attitude.
  It set the figure's 27 joints and its color as global `L:` variables through SimConnect, and took a screenshot at each pose.
- The head turned through yaw, pitch, and roll, the head and chest leaned, the hands went to `JpiButton_R` and `FUEL_Lever_Mixture_2`, and the legs bent at the knee to rest and to the copilot's pedals.
  The dev page, drawn from the camera that `SimConnect_CameraGet` gave, put the head, hands, and feet where the screenshots show them, by eye.
- A value between frames plays smoothly.
  Moving the head right a sixth of a frame at a time, 1.67cm a frame, from frame 57, moved the red pixels' center by 1.3, 1.8, 1.6, 1.5, 1.8, and 1.3 pixels a step, with no stall and jump, and by 0.8 to 1.3 pixels in a second run.
- The color animation targets `materials/0/pbrMetallicRoughness/baseColorFactor` and `materials/1/pbrMetallicRoughness/baseColorFactor`, and fspackagetool kept it.
  The figure took each palette color, its body and its lighter chest together, and a value halfway between red and blue showed violet.
  The red pixels counted 84,426 while it was red, about 1,260 while it was blue, green, yellow, purple, teal, or pink, 16,791 while orange, and 80,041 back at red.
- The knee's 10 segments drew 1m long, fanned out from the knee.
  Each segment's 2.8cm length was a fixed scale on a node with no mesh, which fspackagetool kept as written, so the sim ignored it.
  With the length on the mesh's own node, the knee curved.

**Changed:** one figure model shows any palette color from one variable, with no hidden copy of each part for each color as p17's sphere had.
A fixed length belongs on a mesh's own node or in its vertices ([entry above](#2026-10-03-fspackagetool-rewrote-a-mesh-that-nodes-shared-under-different-uneven-scales)).

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** p24's runs [first](../../../experiments/areas/avatars/results/p24-figure-2026-10-03-11-42-56.txt), [after the knee fix](../../../experiments/areas/avatars/results/p24-figure-2026-10-03-11-58-55.txt), and [with the camera compared](../../../experiments/areas/avatars/results/p24-figure-2026-10-03-12-18-15.txt).

## 2026-10-03: Inside, with the cockpit posed, a fresh cast stays on a posed lever but still falls through one the file holds still

**Asked:** with the cockpit posed from its own code, as the exterior is, does a fresh cast follow a drag inside as well as it does outside, in place of the glide?

**Expected:** a fresh cast would stay on posed levers and fall through unposed ones, as it did before posing ([entry below](#2026-10-03-during-a-drag-the-cursor-keeps-moving-and-gliding-on-the-touched-surfaces-plane-keeps-the-hand-on-a-lever-where-a-fresh-cast-falls-through)).

**Found:**

- In the Black Square Baron 58P, parked, p23 posed 102 of the cockpit's 499 animations from their code, among them both mixture levers, `FUEL_Lever_Mixture_1` and `_2`.
  The throttle and prop levers are driven by sim templates, so they stayed as the file stores them; 346 animations are template-driven, and 44 more keep their own state.
- On posed parts, 4 drags of a mixture lever and one of a yoke button, a fresh cast was a median 0.9cm from the glide, and 6.5cm at the 90th percentile.
  It fell more than 5cm behind the glide point on 52 of 268 casts, mostly in one 8.1s mixture drag, where it landed on the lever's stem and the prop lever beside it.
- On unposed throttle levers, 2 drags, a fresh cast was a median 11.6cm and 14.4cm from the glide, and fell behind it on 36 of 55 casts.
- On flat panels and knobs, the two agreed within 0.3cm to 2.0cm, except in one 13.7s drag across panels at different depths, at a median 7.9cm.

**Changed:** posing a lever keeps a fresh cast on it most of the time, and an unposed lever still lets it fall through.
Both a glide and a fresh cast follow the cursor, which doesn't stay on a lever's knob as it slides, so for a posed part the hand could instead hold the spot it pressed, in the part's own frame, as the thumb holds a yoke button (unverified).

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p23's run](../../../experiments/areas/avatars/results/p23-cockpit-recast-2026-10-03-11-27-34.txt), whose log has every fresh cast of each drag.

## 2026-10-03: Outside, a drag should follow a fresh cast, since the plane of the first spot leaves curved skin

**Asked:** on the aircraft's outside, where the skin curves, should the hand follow a drag by gliding on the plane of the spot first pressed, as inside (p20), or by casting the ray afresh onto the model?
The question came from the pilot.

**Expected:** a fresh cast would stay on the skin, and might jump from part to part.

**Found:**

- In the Black Square Baron 58P, on foot, the pilot made 19 drags across the nose, nacelles, wings, ailerons, and flaps, with a green ball gliding and a blue one following a fresh cast up to 20 times a second, the part being dragged posed again for each.
- Over 797 fresh casts, the glide was a median 15.5cm from where the fresh cast met the skin, and 2.1m at the 90th percentile.
  Over a turbocharged nacelle, the glide plane left the skin by a median 3.9m.
- The fresh cast left the part first pressed on 537 of the 797 casts, onto the next panel of skin, such as from `BaronNose` to `NoseDoor` and `Wings.031`.
  A cast against that part alone missed it on 529 casts, so it can't serve.
- The pilot judged the fresh cast right with "no question".
- The pilot also saw the hand inside the model in some areas, on the wing among them.
  We haven't found why; the wing's flex animation stays as the file stores it (entry below), so where the sim flexes the wing, the hit may lie off its skin (unverified).

**Changed:** outside, a drag follows a fresh cast onto the posed model.
Inside it glides, because a fresh cast fell through a lever the model didn't pose; with the cockpit posed as the exterior is, a fresh cast may serve there too (unverified).

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p22's run with both balls](../../../experiments/areas/avatars/results/p22-exterior-hand-2026-10-03-11-18-41.txt), whose log has every fresh cast of each drag.

## 2026-10-03: On foot outside, the click ray lands within 1cm on the exterior, and the pilot clicks from up to 6m away

**Asked:** can the hand follow clicks on the aircraft's outside, on the walkaround or in an external view, by casting the click's ray into the exterior model?
And does `SimConnect_CameraGet` still give the camera in the aircraft's frame when the user's object is the avatar on foot?

**Expected:** the `SIMOBJECT` referential might follow the avatar on foot, so p22 also built the ray from the `WORLD` referential, whose angles we fitted against `SIMOBJECT` in the cockpit first (lib/frames.mjs).

**Found:**

- In the Black Square Baron 58P, parked, the pilot looked around in the cockpit for 6s in each of two runs, 193 pairs of readings each, over 340° to 349° of yaw and 138° to 177° of pitch.
  Both runs gave the same fit with 0.00° of error: the `WORLD` referential's yaw, in SimConnect.h's `Bank` field, is the camera's true heading, and its pitch is the camera's angle below the horizon.
  `WORLD`'s position, turned into the aircraft's frame by its heading, pitch, and bank, sat a median 0.1cm from `SIMOBJECT`'s.
- On foot, with the camera 1.6m above the avatar's position, the pilot clicked yellow balls on the exterior's nose, tail, both wingtips, and fin top, from 1.7m to 11.3m away.
  The `WORLD` ray landed 0cm to 1cm from each (RMS 0.14°), and the `SIMOBJECT` ray 0cm to 7cm (RMS 0.39°), so `SIMOBJECT` stays in the aircraft's frame on foot too.
  In the other run the pilot didn't aim at the balls, so its ball clicks say nothing.
- The exterior model, `BaronProfessional_Pressurized_EXT.gltf`, has 479,609 triangles.
  23 of its 51 animations posed from their own code, and 55 visibility codes ran.
  The gear and wheels, which sim templates drive, and the wing flex, cover flags, and props, whose code keeps its own state from frame to frame, stayed as the file stores them.
- Over the two runs' free clicks, 188 of 242 presses hit the exterior; the rest hit nothing in the model.
  The avatar stood a median 1.8m and 2.6m from the spot it touched, from 1.0m to 5.8m, so the pilot often clicks from beyond arm's reach.

**Changed:** the hand reaches the aircraft's outside the same way it reaches the cockpit, with either referential.
The figure's arm needs to reach several meters, or the figure to step closer.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** p22's runs [without the balls aimed](../../../experiments/areas/avatars/results/p22-exterior-hand-2026-10-03-11-06-55.txt) and [with them](../../../experiments/areas/avatars/results/p22-exterior-hand-2026-10-03-11-12-06.txt).

## 2026-10-03: With a run of clicks treated as one session, 115 taps took 9 swaps instead of one swap a click

**Asked:** once the thumb on the far horn leaves the yoke with the holding hand, do the hands stop swapping for every click, if they stay swapped through a run of clicks and the tapping hand hovers near the panel between them?
The pilot also found the 0.3s overlap wrong when a hand leaves the yoke to tap: the hand stayed on the yoke while the switch it was going to press had already moved, since the sim acts on a click at once.

**Expected:** a pilot working one side of the panel swaps hands once, not for every switch.

**Found:**

- In the Black Square Baron 58P, parked, in a run with only the thumb fix, all three right-thumb presses on the right horn left the left hand on the yoke, and five clicks on `ELECTRICAL_Switch_Magneto_1` swapped the hands four times.
- p21 then took a run of clicks with one hand as one session: the hands go home only 2s after the last release, the tapping hand hovers 5cm off its last spot between clicks, and a hand leaving the yoke to tap moves at once, with the overlap kept only for going home.
- Over the next run, 115 taps (64 left, 51 right, 40 of them drags) took 9 swaps and 9 sessions.
  Each swap was the first click after a pause of 1.1s to 20.9s, or a click on the other side of the wheel from the one before.
- All 8 right-thumb presses on the right horn left the left hand on the yoke.
- The pilot found that the hands felt right.

**Changed:** the hands swap once for each run of clicks on one side, and the tapping hand reaches its switch as the sim moves it.
On the other pilot's machine, where Crosscheck applies the change itself, it could hold the change until the hand arrives, for an overlap, at that much more delay; that's a product decision.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** p21's runs [with the thumb fix](../../../experiments/areas/avatars/results/p21-yoke-hands-2026-10-03-10-33-01.txt) and [with sessions](../../../experiments/areas/avatars/results/p21-yoke-hands-2026-10-03-10-38-26.txt), whose logs have every press with the hands' choice.

## 2026-10-03: On the horn's surface the yoke hand looks right, and a thumb on the far horn must not take the yoke from the holding hand

**Asked:** with the yoke hand moved onto the horn's surface, buttons on the pilot's own yoke pressed by a thumb, and the yoke handed over with an overlap, do the hands behave as a pilot's would?
The overlap came from the pilot: someone moving an object from one hand to the other takes it with the new hand before letting go with the old.

**Expected:** a pilot presses a yoke button with the thumb of the hand on that side, without letting go of the yoke.

**Found:**

- In the Black Square Baron 58P, parked, over two runs of p21, the pilot raised no fault with the yoke hand on the horn's surface, 3.1cm out from each grip node.
- In the first run the pilot worked the left side of the panel: the left hand tapped 16 times, and the hands swapped 16 times, once for each tap.
- In the second the pilot pressed buttons on the yoke: the left thumb pressed `HANDLING_Yoke_Push_AP_Disconect_1` and `YokeCwsButton_1` 6 times, and the right thumb pressed `YokeIdentButton_1` and `OatMapCompassLightButton_1` 6 times.
  Each right-thumb press handed the yoke to the right hand, so the left hand let go after the 0.3s overlap, then took the yoke back as the press ended, a fault the pilot saw.
  The probe now leaves the yoke with the hand holding it: during a press on the far horn, both hands are on the yoke.

**Changed:** a thumb press on the yoke never moves the yoke from the hand holding it.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** p21's runs [with the hand on the surface](../../../experiments/areas/avatars/results/p21-yoke-hands-2026-10-03-10-25-24.txt) and [with thumbs](../../../experiments/areas/avatars/results/p21-yoke-hands-2026-10-03-10-30-11.txt).

## 2026-10-03: One hand holds the yoke through its whole travel, posed from the aircraft's own code, while the other taps and they swap by side

**Asked:** can the figure's free hand hold the yoke's grip while the pilot moves the yoke, posed from the code the aircraft's own behavior XML plays the yoke with, while the other hand taps where the pilot clicks, the two swapping by which side of the wheel the click is on?

**Expected:** the grips would hold, since posed offline they sat level either side of the wheel ([entry below](#2026-10-03-aircraft-mark-their-yoke-grips-with-the-same-node-names-and-the-yokes-own-animations-put-them-on-a-level-wheel)).

**Found:**

- In the Black Square Baron 58P, parked, p21 posed the yoke 1,703 times across its whole travel, frames 0 to 100 of both animations, running the aircraft's own code on 3 variables it watched every frame.
  The module (`crosscheck-p12-follow` 0.6.0) placed the two hands as two objects.
- The pilot saw the yoke hand stay with the yoke, and its one fault was that it sat inside the yoke.
  The grip nodes sit inside the horns: with the yoke centered, a ray from the pilot's eye to each meets the horn's surface 1.7cm before it.
  The probe now puts the hand there, one ball's radius out, 3.1cm from the node, and keeps that spot in the node's own frame, so it rolls with the yoke (checked offline at a quarter roll).
- Of 37 taps, the left hand made 18 and the right 19, and the hands swapped 16 times.
  A click on the yoke itself counts by its side like any other: the first press hit `Yoke_L` 13.6cm left of the wheel, so the left hand tapped and the right took the yoke.
- The probe ran all 51 of the 58P's visibility codes from 18 variables, and 13 rays passed a hidden part to hit what was behind it.
- The seat object `SEAT_DEFAULT_Pilot` sat 0.283m left of SimConnect's reference point, and the model's `PILOT_1` node 0.282m right of the model's origin, with forward and up within 3mm of each other.
  So in the Baron `PILOT_1` is the copilot's seat, and if the cabin is symmetric, the model's origin lines up with the reference point within about 3mm, as in the Comanche ([entry below](#2026-10-03-the-cockpit-models-own-space-lines-up-with-simconnects-within-8mm-but-the-models-input-event-ids-arent-the-names-the-sim-lists)).

**Changed:** in the Baron, the figure's free hand holds the yoke from the aircraft's own files, with nothing picked by hand, and sits on the horn's surface.
Clicks on the yoke itself need a rule of their own.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [p21's run](../../../experiments/areas/avatars/results/p21-yoke-hands-2026-10-03-10-17-37.txt), whose log has every press with the hands' choice and the yoke's pose every 0.5s.

## 2026-10-03: Aircraft mark their yoke grips with the same node names, and the yoke's own animations put them on a level wheel

**Asked:** where on the yoke does the figure's free hand go, and can Crosscheck find that point in an aircraft's files instead of a profile author picking it?

**Expected:** a profile author would pick a grip point by hand in the profile IDE.

**Found:**

- Both aircraft we read name their pilot's yoke and its two animations in `aircraft.cfg`, under `[VR]`: `yoke_node`, `yoke_anim_x`, and `yoke_anim_y` (read in bksq-aircraft-baronpro 0.1.1 and a2a-aircraft-pa24 2.1.3).
- Under each one's pilot yoke, moving with it, sit three empty nodes: `HANDLING_Yoke_1_Hand_Left`, `HANDLING_Yoke_1_Hand_Right`, and `HANDLING_Yoke_1_Wheel_Center`.
  Black Square's Bonanza Pro has the same hand nodes, and the iniBuilds L-1011 has them as well as `HANDLING_Yoke_2_Hand_Left` and `_Hand_Right` for its second yoke (read in bksq-aircraft-bonanzapro 0.1.1 and inibuilds-aircraft-l1011 1.0.8).
  The SDK's [aircraft.cfg page](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/CFG_Files/aircraft_cfg.htm) doesn't mention them, so we don't know what reads them.
- Posed by the model's own yoke animations at the middle of their travel, the two hand nodes sit level, either side of the wheel's center:

  | Aircraft | Hands apart | Level within | Fore-aft travel | Roll, full left to full right |
  | --- | --- | --- | --- | --- |
  | Baron | 25.6cm | 0.0cm | 14.7cm | −85° to 85° |
  | Comanche | 23.0cm | 0.3cm | 28.1cm | −69° to 74° |

  `lib/animate.mjs` maps a frame to a time as the SDK documents it, the frame over the component's animation length times the glTF animation's own duration ([Animation XML Properties](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/Models/Animation_XML_Properties.htm)), which we haven't measured in the sim.
- The Baron stores its yoke at frame 0 of both animations, rolled full left and pushed full forward.
  In a run of p20 in the Baron 58P, where rays meet the model as the file stores it, rays hit the two yokes (`Yoke_L` and `Yoke_R`) on 21 of 204 presses.
- What drives the yoke differs by aircraft.
  The Baron's interior XML plays its animations from `(A:YOKE X POSITION WITH AP LINEAR, Percent)` and `(A:YOKE Y POSITION WITH AP, Percent)`, each halved and added to 50.
  The Comanche's plays them from `(L:YokeBank_Anim,number)` and `(L:YokePitch_Anim,number)`, negated, halved, and added to 50.

**Changed:** the figure's free hand can hold the yoke at an anchor the aircraft already has, posed from the variables that drive the yoke.
A profile author needs to pick a grip only where an aircraft has no such nodes.
The click ray needs the same posed yoke, or the yoke as the file stores it catches rays.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** [tools/yoke.mjs](../../../experiments/areas/avatars/tools/yoke.mjs) prints each aircraft's anchors across the travel, from [lib/animate.mjs](../../../experiments/areas/avatars/lib/animate.mjs); the [Baron run](../../../experiments/areas/avatars/results/p20-click-calibrate-2026-10-03-09-31-46.txt).

## 2026-10-03: A quick, still right press is a click, and a held or moved one turns the view

**Asked:** the sim's right button both clicks controls and, held, turns the view.
Can the hand follow right clicks without following the view turns?
And does a drag that glides on the touched surface's plane alone hold up over more presses?

**Expected:** a right click would be short and still, and a view turn longer or moving, so a right press can be judged at its release.

**Found:**

- In the A2A Comanche, parked, the pilot pressed the right button 16 times in the last of three runs.
  The 14 presses that came up within 300ms, with the cursor moving under 5px and the mouse under 20 counts, put the hand where they were pressed, 12 of them on `LEVER_Primer` alternating with left clicks and 2 on the left wall.
  The other 2, held 395ms with 46 counts of mouse movement and 210ms with 34 counts, turned the view and brought no hand.
- A right click's hand shows at its release, since only the release tells a click from a view turn.
- Across the two runs before it, the pilot made 169 left presses, 84 of them drags.
  In the first, which still logged a fresh cast at every move, drags on the pilot's yoke put the fresh cast 10cm to 16cm from the glide, because the yoke stood elsewhere in the sim than in the model, and drags on the radios' knobs and glass 0cm to 4.3cm.

**Changed:** the hand follows both buttons: a left press at once and through its drag, and a right press at its release when it's quick and still.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** p20's runs with [the fresh cast still logged](../../../experiments/areas/avatars/results/p20-click-calibrate-2026-10-03-08-58-04.txt), [the glide alone](../../../experiments/areas/avatars/results/p20-click-calibrate-2026-10-03-09-01-22.txt), and [right clicks](../../../experiments/areas/avatars/results/p20-click-calibrate-2026-10-03-09-04-10.txt).

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
- In a second run of 38 clicks, the combination that named the most mapped controls, 15, took the field of view as vertical, with the same signs: the rule p20 later measured ([entry above](#2026-10-03-the-ray-through-the-cursor-needs-no-calibration-cameragets-field-of-view-is-the-views-height-and-clicks-land-within-2mm-at-any-zoom-and-window-shape)).
  The next best named 11.

**Changed:** the hand can follow clicks through the model's geometry alone, so it doesn't depend on how an aircraft names its controls.
Settling the field of view needs clicks whose target is known, which is p20's job.
A cockpit's moving and hidden parts need their state from the sim, or they block and misplace hits.

**Affects:** the idea [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** p19's [first run](../../../experiments/areas/avatars/results/p19-click-hand-2026-10-03-08-13-37.txt) and [second run](../../../experiments/areas/avatars/results/p19-click-hand-2026-10-03-08-26-59.txt), whose logs have every click under all 16 combinations.

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
