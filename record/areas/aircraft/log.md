# Aircraft: log

What the sim found about aircraft, newest entry first.
The probes, the harness, and their raw output are in [experiments/areas/aircraft](../../../experiments/areas/aircraft), with the results in its `results/` folder.

## 2026-11-20: The Phenom 300E's readable archive holds seat parts for its pilot, its copilot, and its passengers

**Asked:** does [the 2026-10-03 entry](#2026-10-03-two-partly-encrypted-aircraft-list-seat-objects-the-phenom-300e-for-its-pilots-and-passengers-and-the-a380-for-its-pilots)'s claim hold, that the Phenom's readable files show only a passenger seat part, so SimConnect showed more than the files did?

**Expected:** no, since SimConnect listed a pilot's and a copilot's seat as well.

**Found:** it doesn't hold.
The index of `minimal.fsarchive`, the readable archive of fsreborn-aircraft-phenom300e 1.0.40, lists three seat parts under `simobjects\airplaneparts\`, each with a navigation graph: `fsreborn_phenom300e_seat_pilot`, `fsreborn_phenom300e_seat_copilot`, and `fsreborn_phenom300e_seat_pax` (read in its `minimal.fsarchive`, the archive's index).
The entry read version 1.0.24, which isn't installed any more.

**Changed:** the 10 seat objects SimConnect listed belong to the three parts the package's readable files hold, so SimConnect showed no seat the files lacked.
The entry's finding that a figure can sit in a seat of a partly encrypted aircraft stands.

**Affects:** the 2026-10-03 entry below, whose text stays as it was.

## 2026-10-16: A streamed package keeps no version on disk, while every installed one with a manifest has its `package_version`

**Asked:** the preflight match check compares two pilots' aircraft versions ([preflight match check](../product/03-v1-scope.md#preflight-match-check)), and a package's version is `package_version` in its `manifest.json` ([07](../../learn/foundations/07-aircraft-specific-systems.md)); 03-v1-scope says a streamed Marketplace copy has no `manifest.json` in its folder, with no source.
Where can the core read each kind of copy's version?

**Expected:** a manifest in every Community and Official package, and none in a streamed one.

**Found:** with no sim running, p16 listed every folder under `UserCfg.opt`'s `InstalledPackagesPath` on our development machine:

| Folder | Packages | With a `manifest.json` and a `package_version` |
| --- | --- | --- |
| `Community` | 137 | 133 |
| `Community2024` | 5 | 5 |
| `Official2020` | 5 | 4 |
| `Official2024`, in its `Steam` folder | 4 | 3 |
| `StreamedPackages` | 1,221 | 0 |

- 1,219 streamed packages held only a `content` folder at their top, and 2 also an `on-demand.json` whose one key is `content`: the Microsoft A320neo's and Top Mach Studios' F-22A.
- 297 streamed packages' names hold "aircraft" and not "livery", among them iniBuilds' A380 and L-1011, FSReborn's Phenom 300E, and the stock Baron G58.
- The sim's `Content.xml` gives each package only a `name` and whether it's `active`.
- The world map's aircraft list, as p08 captured it, carries each aircraft's `creator` and no version (read in `experiments/areas/interface/results/p08-world-map-aircraft-2026-10-05-19-32-47.ndjson`).

**Changed:** the match check reads an installed copy's version from its manifest, and has none for a streamed copy, so it shows a streamed copy against an installed one as a warning that the streamed copy's version can't be read.

**Affects:** the match check in [the session's units](../session/02-units.md#the-match-check), and [preflight match check](../product/03-v1-scope.md#preflight-match-check)'s open question on what identifies a copy.

**Evidence:** [p16's run](../../../experiments/areas/aircraft/results/p16-package-versions-2026-10-16-16-57-47.txt).

## 2026-10-04: Key presses a program sends move the cockpit eye, with the sim window in front, and leave the pilot their camera

**Asked:** does pressing the pilot's own camera keys for them, from a program, move the cockpit eye, since SimConnect can't send the camera's slide actions ([entry below](#2026-10-04-simconnect-doesnt-know-the-sims-cockpit-camera-slide-actions-by-name))?

**Expected:** `SendInput` would, as a real key press does, and window messages posted to the sim's window might not.

**Found:**

- The sim keeps each pilot's bindings per device as readable XML, one `inputprofile_<number>` per device in `<Steam>\userdata\<Steam account id>\2537590\remote\` on a Steam install.
  The pilot's keyboard profile binds `KEY_COCKPIT_CAMERA_SLIDE_RIGHT` to D, `_LEFT` to A, `_FRONT` to W, `_BACK` to S, `KEY_COCKPIT_CAMERA_HEIGHT_INC` to E, and `_DEC` to Q, in a context named `COCKPIT_GLOBAL_CAMERA_TRANSLATE`, each key as a Windows virtual-key code (read on our development machine, 2026-10-04).
  The default 2024 keyboard profile binds `_SLIDE_RIGHT` to left Shift and D, and lists axis actions too, `KEY_COCKPIT_CAMERA_TRANSLATION_X`, `_Y`, and `_Z` (read in the sim's `Packages\fs-input-profiles\InputProfiles\Categories\Transversal\Keyboard_2024_Transversal.xml`, and the pilot's profile).
- In the Black Square Baron 58P, bksq-aircraft-baronpro 0.1.1, with ChasePlane turned off through its API and the sim's window in front, p14 held Shift and D for 500ms with `SendInput`, by scan code: the eye moved 330mm right, and the camera stayed the sim's.
- Posting the same key-down and key-up messages to the sim's window moved the eye by less than 1mm.
- Shift and A, held 500ms with `SendInput`, moved the eye 330mm back left, to within 1mm of where it started.

**Changed:** Dual Input can slide a pilot's eye anywhere the sim's own camera keys reach, by pressing the keys the pilot bound, read from their profile, while the sim's window is in front, and the pilot keeps their camera; it can't do it with the window behind another, since the sim ignores posted messages.
How far the eye can travel, how fast at a higher `COCKPIT CAMERA SPEED`, and how closely a feedback loop on `SimConnect_CameraGet` lands it are next.

**Affects:** the idea [Seat awareness](../product/ideas.md#seat-awareness), and avatar sync in [03-v1-scope](../product/03-v1-scope.md).

**Evidence:** [p14's run](../../../experiments/areas/aircraft/results/p14-camera-keys-sent-2026-10-04-06-09-57.txt).

## 2026-10-04: SimConnect doesn't know the sim's cockpit camera slide actions by name

**Asked:** do the actions the pilot's camera keys trigger move the cockpit eye when a SimConnect client sends them?
The sim's input profiles name them `KEY_COCKPIT_CAMERA_SLIDE_LEFT`, `_SLIDE_RIGHT`, `_SLIDE_FRONT`, `_SLIDE_BACK`, `KEY_COCKPIT_CAMERA_HEIGHT_INC`, and `_HEIGHT_DEC` (read in the sim's `Packages\fs-input-profiles`, `inputprofiles\*.xml`), and the SDK's event header doesn't list them (read in MSFS 2024 SDK 1.7.3, `MSFS_EventsEnum.h`).

**Expected:** if SimConnect knew them, sending them would move the eye as the keys do.

**Found:** p13 mapped each of the six without the `KEY_` prefix, as SimConnect names events, in the Black Square Baron 58P, bksq-aircraft-baronpro 0.1.1, with ChasePlane turned off through its API.
SimConnect answered each mapping with `NAME_UNRECOGNIZED` (7), and each send with `ERROR` (1); sent as 10 bare events, as 10 with value 1 and then 0, and as one held for 1s, none moved the eye by 1mm.

**Changed:** the cockpit camera's slide and height actions live in the sim's input system, outside the events SimConnect sends, so a client can't send them; pressing the pilot's own bound keys for them is the route left to try.

**Affects:** the idea [Seat awareness](../product/ideas.md#seat-awareness).

**Evidence:** [p13's run](../../../experiments/areas/aircraft/results/p13-cockpit-slide-2026-10-04-06-06-49.txt).

## 2026-10-04: COCKPIT CAMERA HEIGHT raises the cockpit eye and leaves the pilot their camera, and the cockpit save slots didn't seat the eye

**Asked:** can the camera simvars move the pilot's cockpit eye, or save it to a slot and load it back, so Dual Input can seat a pilot at any point and hand the camera back?
The settable ones include `CAMERA ACTION COCKPIT VIEW SAVE:index`, "This can be used to save a cockpit camera when the CAMERA STATE is set to 2 (Cockpit). The index value given is the save 'slot' that will be used, from 0 to 9", `CAMERA VIEW TYPE AND INDEX`, `CAMERA REQUEST ACTION`, whose 2 is "Move Active Camera", `CAMERA ACTION COCKPIT VIEW RESET`, and `COCKPIT CAMERA HEIGHT`, "the cockpit camera height modifier expressed as a percentage. Default is 50%" ([Camera Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Camera_Variables.htm)); the events include `VIEW_CAMERA_SELECT_0` to `_9` (read in MSFS 2024 SDK 1.7.3, `MSFS_EventsEnum.h`).

**Expected:** a slot saved while our client held the camera at the right seat would load back with the camera free.

**Found:** p12 ran in the Black Square Baron 58P, bksq-aircraft-baronpro 0.1.1, with ChasePlane 2026.39.1.16 turned off through its API; `CAMERA STATE` read 2 and `CAMERA VIEW TYPE AND INDEX` 1 and 1 throughout, except 7 while our client held the camera.

- Setting `COCKPIT CAMERA HEIGHT` from 50% to 80% raised the eye exactly 90mm, with no move sideways or fore and aft, and the camera stayed `NOT_ACQUIRED`; 50% put it back.
- Setting `CAMERA ACTION COCKPIT VIEW SAVE:9` with the pilot's own camera, and `:8` while our client held the eye at the right seat, left the pilot's per-user camera file unchanged.
- After the release, `K:VIEW_CAMERA_SELECT_8`, and then `CAMERA VIEW TYPE AND INDEX` set to 5 and 8, didn't move the eye.
- `CAMERA REQUEST ACTION` 2, and then `CAMERA ACTION COCKPIT VIEW RESET`, didn't move the eye either, over 3s and 1.5s.

**Changed:** among the camera simvars, only the height modifier moves the cockpit eye while leaving the pilot their camera, and only up and down.
Where a slot save goes, if anywhere, and what loads a slot are unknown.

**Affects:** the idea [Seat awareness](../product/ideas.md#seat-awareness).

**Evidence:** [p12's run](../../../experiments/areas/aircraft/results/p12-camera-slots-2026-10-04-06-04-10.txt).

## 2026-10-04: The camera hands back into one view per pilot item, the first that has it, so a package's seat views cover a handful of seats

**Asked:** how many seat views can a package of ours give one aircraft, since an airliner has 180 seats and the camera hands back only into views with a pilot item ([entry below](#2026-10-04-a-community-package-of-ours-adds-a-seat-view-anywhere-in-the-aircraft-it-replaces-the-camera-file-when-it-mounts-after-the-aircrafts-the-sim-reads-it-at-start-and-a-free-pilot-item-lets-the-camera-hand-back-there))?
Can views share an item, or use one of our own?

**Expected:** unknown.

**Found:** p11 installed one package, `zzz-crosscheck-seat-test`, `package_order_hint` `CUSTOM_SIMOBJECTS_PATCH`, holding the Black Square Baron 58P's camera file, bksq-aircraft-baronpro 0.1.1, with five seat views at five points in the cabin; the sim mounted it after the 58P's package and listed 37 definitions, the five among them.

- Holding the camera, `SimConnect_CameraSetUsingCameraDefinition` put the eye on each of the five to the millimeter.
- Releasing the camera into each, with the status `NOT_ACQUIRED` after every release:
  - S1, `SubCategoryItem` `"LandingPilot"`: the eye stayed on S1.
  - S2, also `"LandingPilot"`: the eye landed on S1, not S2.
  - S3, `"Crosscheck_S3"`, an item of our own: the eye landed on the `Pilot` view.
  - S4, `"CoPilot"`, which the 58P's own `CoPilot` view has: the eye landed on the 58P's `CoPilot`.
  - S5, `"ClosePilot"`: the eye stayed on S5.

**Changed:** releasing the camera into a view resolves by its pilot item, not its name, and reaches only the first view with that item, so a package's seat views give an aircraft one seat per pilot item it leaves free.
The SDK lists `DefaultPilot`, `ClosePilot`, `LandingPilot`, `CoPilot`, `TrueCockpit`, and `PilotVR`, and `QuickView1` to `QuickView8`, which this run didn't try, so this route covers a handful of seats, not a cabin.

**Affects:** the idea [Seat awareness](../product/ideas.md#seat-awareness), and avatar sync in [03-v1-scope](../product/03-v1-scope.md).

**Evidence:** [p11's run](../../../experiments/areas/aircraft/results/p11-seat-items-2026-10-04-05-44-02.txt).

## 2026-10-04: A Community package of ours adds a seat view anywhere in the aircraft: it replaces the camera file when it mounts after the aircraft's, the sim reads it at start, and a free pilot item lets the camera hand back there

**Asked:** can a Community package of our own give an aircraft camera views by putting a `cameras.cfg` at the aircraft's own path, since the Camera API can't add one ([entry below](#2026-10-04-camerasetrelative6dof-puts-the-eye-at-any-point-but-holds-the-camera-and-a-camera-handed-back-into-a-view-returns-to-the-views-own-eye))?
And does the sim's root `Cameras.CFG` add views?

**Expected:** a package that mounts after the aircraft's would replace the file, as a z-named texture pack replaces the PMDG 777's textures.

**Found:** p10 built two packages on this machine from the installed Black Square Baron 58P's `cameras.cfg`, bksq-aircraft-baronpro 0.1.1, each the whole file with one test view appended: `aaa-crosscheck-camera-test` with "Dual Input: AAA" and `zzz-crosscheck-camera-test` with "Dual Input: ZZZ", 1.2m behind the copilot's view, in the cabin.
It also appended "Dual Input: ROOT" to the root `Cameras.CFG` in the sim's AppData folder.

- The sim mounts packages in groups by the manifest's `package_order_hint`, and alphabetically within a group, as its running-session report lists them (`AsoboReport-RunningSession.txt`, `[FlightSimulator_Packages]`): empty hints, then `UI_PATCH`, `PANEL_PATCH`, `CUSTOM_INSTRUMENT`, `SIMOBJECTS_PATCH`, `CUSTOM_SIMOBJECTS`, `CUSTOM_SIMOBJECTS_PATCH`, `CUSTOM_MODELLIB_PATCH`, `CUSTOM_AIRPORT`, among others.
  The 58P's package has `CUSTOM_SIMOBJECTS_PATCH`, and the HUES texture pack, `zhues_pmdg777_rev`, sits right after `pmdg-aircraft-77w` in `CUSTOM_SIMOBJECTS`.
- With empty hints, both test packages mounted long before the 58P's, and SimConnect_EnumerateCameraDefinitions listed the 58P's 32 views and neither test view.
- With both set to `CUSTOM_SIMOBJECTS_PATCH`, the sim mounted `aaa`, then `bksq-aircraft-baronpro`, then `zzz`, and listed 33 views: the 58P's 32 and "Dual Input: ZZZ", without "Dual Input: AAA".
  So the package that mounts last replaces the whole file; the files don't merge, or AAA's view, with its own name and Guid, would show too.
- "Dual Input: ROOT" never showed, in either boot.
- ChasePlane's `get_views` listed neither test view.
  ChasePlane keeps each aircraft's views as JSON files of its own, one per view, in `%APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2024\p42-util-chaseplane\work\aircraft\<aircraft>\onboard\`, each position an offset from a cockpit anchor, `anchor_at_save`, which for the 58P is the pilot's eye `CameraGet` reads.
  The 58P's were written the day before, so ChasePlane imported the aircraft's views once and reads its own copies since (read in ChasePlane 2026.39.1.16's work folder; whether it reads our shadowed file when it first imports an aircraft is untested).
- Holding the camera, `SimConnect_CameraSetUsingCameraDefinition` put the eye on "Dual Input: ZZZ" to the millimeter, and on the 58P's own `CabinForward` too.
  Releasing the camera into a view handed it back there only for `Pilot` and `CoPilot`, whose `SubCategoryItem` are `"DefaultPilot"` and `"CoPilot"`; `CabinForward`, `CabinRearward`, and "Dual Input: ZZZ", each `"None"`, put the eye at `Pilot`'s.
- p10 then moved ZZZ 0.3m up and gave it `SubCategoryItem` `"LandingPilot"`, one of the SDK's pilot items the 58P leaves unused, in the installed package, without restarting the sim; after a new flight, holding the camera put the eye where ZZZ was at boot, so the sim reads the file at its start and not at a flight's.
- After a sim restart, holding the camera put the eye on the moved ZZZ to the millimeter, and releasing the camera into ZZZ left it there, 1.2m behind the copilot's view, with the status `NOT_ACQUIRED`.
  Over the next 10s the pilot looked around with the mouse, the yaw going from −150° to 59°, and the eye stayed within 1mm of where the release put it.

**Changed:** with the sim's own camera, Dual Input can seat a pilot at any point in the aircraft, with their look as usual: a package of its own copies the aircraft's camera file and appends a view with a pilot item the aircraft leaves free, it mounts after the aircraft's package by its `package_order_hint` and name, and it's written before the sim starts.
That copies another developer's file onto the pilot's machine and shadows it, which needs a decision.
How many seats this covers turns on whether several views can share an item, since the SDK lists `ClosePilot`, `LandingPilot`, and `TrueCockpit` besides the 58P's `DefaultPilot`, `CoPilot`, and `PilotVR`.

**Affects:** the idea [Seat awareness](../product/ideas.md#seat-awareness), the [installing and updating](../product/03-v1-scope.md#installing-and-updating) scope, whose `VCockpit.js` check meets the same mount order, and avatar sync in [03-v1-scope](../product/03-v1-scope.md).

**Evidence:** p10's runs [with empty hints](../../../experiments/areas/aircraft/results/p10-camera-package-2026-10-04-05-14-39.txt), [with `CUSTOM_SIMOBJECTS_PATCH`](../../../experiments/areas/aircraft/results/p10-camera-package-2026-10-04-05-20-51.txt), [after the move and a new flight](../../../experiments/areas/aircraft/results/p10-camera-package-2026-10-04-05-26-13.txt), and [after the restart, with `"LandingPilot"`](../../../experiments/areas/aircraft/results/p10-camera-package-2026-10-04-05-30-05.txt).
The reads of `CabinForward` and `CabinRearward` came from a one-off script between the second and third runs, which released into `Pilot`, `CoPilot`, `CabinForward`, `CabinRearward`, and "Dual Input: ZZZ" in turn: the eye landed at x −0.253m, y 0.855m, z −0.144m (x right, from the reference point) for all but `CoPilot`, at 0.236m, 0.811m, −0.116m; holding, `CabinForward` put it at 0.227m, 0.661m, −2.107m and ZZZ at −0.009m, 0.761m, −1.316m.

## 2026-10-04: CameraSetRelative6DOF puts the eye at any point but holds the camera, and a camera handed back into a view returns to the view's own eye

**Asked:** can Dual Input put a pilot's eye at a point no camera view gives and hand the camera back, so the pilot keeps their look?
The Camera API has no call that adds a view at runtime (read in MSFS 2024 SDK 1.7.3, `SimConnect.h` and `WASM/include/MSFS/MSFS_Camera.h`).
`SimConnect_CameraSetRelative6DOF` moves the user's camera relative to the aircraft's eyepoint, and SDK 1.6.9 fixed it after it "ignored position parameters and put camera at the center of the SimObject, not the eyepoint" ([release notes](https://docs.flightsimulator.com/msfs2024/html/1_Introduction/Release_Notes.htm)).

**Expected:** it would move the eye without taking the camera, with `SIMCONNECT_CAMERA_IGNORE_FIELD` (`FLT_MAX`), which `SimConnect.h` describes as "Used to tell the Camera API to NOT modify the value in this part of the argument", for pitch, bank, and heading.

**Found:** p09 ran in the Black Square Baron 58P, bksq-aircraft-baronpro 0.1.1, with ChasePlane 2026.39.1.16 turned off through its API's `set_master_enabled` for each run and back on at its end.

- `CameraSetRelative6DOF` put the eye exactly where asked, relative to an eyepoint 0.259m left of the reference point, 0.610m up, and 0.107m behind it, 0.245m below where the `Pilot` view puts the eye.
  A delta of 0.489m right landed 0.489m right, and (0.2, 0.1, −1.2)m landed on it to the millimeter, in the cabin; the eye stayed at each point.
- It also took the camera: `SimConnect_CameraGetStatus` read `ACQUIRED_BY_OTHER` with ChasePlane off, pitch and yaw read 0°, and the pilot's mouse didn't move the view over 10s.
  Our client's acquire then left the status `ACQUIRED_BY_OTHER`, and its release into `Pilot` raised `CAMERA_API` (46).
  Turning ChasePlane back on freed the camera each time; what frees it with no ChasePlane is untested.
  Asobo wrote that the old call "will be the same as using the acquire call and set position/rotation in EYEPOINT mode" ([Camera API Discussion](https://devsupport.flightsimulator.com/t/camera-api-discussion/17193)).
- With our client holding the camera, `SimConnect_CameraSet` to the right seat followed by a release into `Pilot` put the eye back at `Pilot`'s own eye, so the view doesn't keep a position a client set.
  `CameraSetRelative6DOF` while our client held the camera took it from our client the same way.

**Changed:** with the sim's own camera, a client can put the eye at any point only while it holds the camera, which freezes the pilot's look, and `CameraSetRelative6DOF` holds it in a way our client can't undo.
Dual Input must not call it for a pilot without ChasePlane until we know what frees the camera.

**Affects:** the idea [Seat awareness](../product/ideas.md#seat-awareness), and avatar sync in [03-v1-scope](../product/03-v1-scope.md).

**Evidence:** p09's runs [placing the eye](../../../experiments/areas/aircraft/results/p09-relative-6dof-2026-10-04-04-56-23.txt), [handing back after it](../../../experiments/areas/aircraft/results/p09-relative-6dof-2026-10-04-04-58-28.txt), and [moving while holding, then handing back](../../../experiments/areas/aircraft/results/p09-relative-6dof-2026-10-04-04-59-44.txt).

## 2026-10-04: After a sim restart too, views added to the per-user camera file reach neither SimConnect's camera list nor ChasePlane's

**Asked:** does a full sim restart load the three test views p08 added to the 58P's per-user camera file, which a flight restart and a new flight didn't ([entry below](#2026-10-03-camera-views-added-to-the-per-user-camera-file-dont-show-up-after-a-flight-restart-or-a-new-flight))?

**Expected:** perhaps, if the sim reads the file only at startup.

**Found:** with the sim started fresh and the Black Square Baron 58P loaded, SimConnect_EnumerateCameraDefinitions listed the same 32 definitions as before, and ChasePlane's `get_views` the same 42 views.
Neither held a test view or one of the pilot's four saved custom cameras.
ChasePlane held the camera, so p08 didn't release into the views, and the day before, an unknown name sent the eye to one fallback spot.
p08 then put the backed-up file back, and it matched the backup byte for byte.

**Changed:** a view added to that file isn't one a SimConnect client can release the camera into, or one ChasePlane loads.
Whether the sim itself reads the file, such as for the pilot's own key that loads a custom camera, is untested, and add-ons may rely on it.

**Affects:** the idea [Seat awareness](../product/ideas.md#seat-awareness).

**Evidence:** [p08's run after the restart](../../../experiments/areas/aircraft/results/p08-camera-file-2026-10-04-04-43-52.txt).

## 2026-10-03: Camera views added to the per-user camera file don't show up after a flight restart or a new flight

**Asked:** do camera views added to the sim's per-user camera file for an aircraft become views that SimConnect lists and a client can release the camera into, and does ChasePlane pick them up?
If so, Dual Input can add a view for each seat the profile defines, so a pilot can be seated where the aircraft has no view of its own.

**Expected:** yes after the aircraft loads again, since the sim keeps a pilot's saved custom cameras there.

**Found:** in the Black Square Baron 58P, bksq-aircraft-baronpro 0.1.1, with ChasePlane 2026.39.1.16:

- The file is `%APPDATA%\Microsoft Flight Simulator 2024\SimObjects\Airplanes\bksq-aircraft-baronpropress\cameras.CFG` on a Steam install, last written 2025-11-02, and holds the pilot's four saved custom cameras, titled `2` to `5`, each with `SubCategory="Custom"`.
- p08 backed up the file and added three views copied from the 58P's own `CoPilot` definition, at offsets from it no chance would produce: `Crosscheck: Test A` and `Crosscheck: Test B` with `SubCategory="Pilot"`, as `CoPilot` has, and `Crosscheck: Test C` with `"Custom"`.
- Right after the write, after a flight restart, and after ending the flight and starting a new one with the 58P, SimConnect_EnumerateCameraDefinitions listed the same 32 definitions, none of them a test view or a saved custom camera, and ChasePlane's `get_views` listed the same 42 views, none of them either.
- Releasing the camera by name into each test view and into the custom camera `2` put the eye at one spot for all four, 0.23m left of the reference point, 0.70m up, and 0.20m ahead, far from where any of them points.
  So the sim takes a name it doesn't know and falls back to one fixed spot.
- Whether a full sim restart loads the file, and whether the pilot's own key for loading custom camera 2 still reads it, is untested.
  The pilot hasn't used the sim's custom cameras since switching to ChasePlane, which fits the file's date.

**Changed:** within one sim run, the per-user camera file gives Dual Input no way to add a view.
The test views stay in the file until the sim's next start, which is the restart test, and p08's `--restore` then puts the backup back.

**Affects:** the idea [Seat awareness](../product/ideas.md#seat-awareness), whose open question on seats with no camera view this narrows.

**Evidence:** p08's runs [right after the write](../../../experiments/areas/aircraft/results/p08-camera-file-2026-10-03-21-48-44.txt), [after the flight restart](../../../experiments/areas/aircraft/results/p08-camera-file-2026-10-03-21-52-01.txt), [after it, releasing by name](../../../experiments/areas/aircraft/results/p08-camera-file-2026-10-03-21-52-23.txt), and [after a new flight](../../../experiments/areas/aircraft/results/p08-camera-file-2026-10-03-21-55-12.txt).

## 2026-10-03: The eyepoint events don't move the cockpit eye, the pilot's own camera keys fire none of the legacy camera events, and a held camera doesn't take the mouse look

**Asked:** with the sim's own camera, can Dual Input put a pilot's eye at a point no camera view gives, such as a seat the profile defines?
Releasing the camera into a view keeps the pilot's look, and releasing it anywhere else snaps it back ([entry below](#2026-10-03-a-simconnect-client-moves-the-pilots-camera-to-the-copilots-seat-by-releasing-the-camera-into-the-aircrafts-copilot-view-unless-chaseplane-runs)), so we tried nudging the eye from a view, and holding the camera with the flag that permits interactions.

**Expected:** the legacy events `K:EYEPOINT_LEFT`, `_RIGHT`, `_FORWARD`, `_BACK`, `_UP`, and `_DOWN` would move the eye, since the pilot moves it with keys.

**Found:** all three probes ran in the Black Square Baron 58P, bksq-aircraft-baronpro 0.1.1, with ChasePlane disabled.

- p06 sent each of the six eyepoint events 10 times, 30ms apart, and `K:EYEPOINT_RESET` after each.
  The sim raised no exception, and the eye didn't move by as much as 1mm.
- p07 listened for 23 legacy camera events, the eyepoint, pan, view, and zoom events, while the pilot moved the eye with their own keys, Shift with W, A, S, and D.
  The eye traveled 3.43m over 20s, as far as 0.43m right of where it started, and none of the 23 events fired.
  So the sim moves the cockpit eye through input actions of its own, which SimConnect doesn't carry.
  The pilot thinks they stopped at 0.43m themselves, so how far the eye can travel is unknown.
- p04's step D held the camera at the mirror of the pilot's eye with `SimConnect_CameraEnableFlag` and `SIMCONNECT_CAMERA_FLAG_INTERACTION`, which the SDK describes only as "The add-on camera will permit interactions" ([SIMCONNECT_CAMERA_FLAG](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Structures_And_Enumerations/SIMCONNECT_CAMERA_FLAG.htm)).
  For the 10s the pilot looked around with the mouse, the camera's pitch and yaw stayed at 0°, and a click on a switch did nothing.
- That run started with the eye at 0.205m left and 0.256m back of the reference point, moved there by the pilot in p07, and releasing the camera into `Pilot` returned it there rather than to the view's own eye, at 0.253m left and 0.144m back.
  So the sim may keep a pilot's move within each view (unverified).

**Changed:** with the sim's own camera, Dual Input can put a pilot only where a camera view is, unless it drives the look and the clicks itself while it holds the camera, as ChasePlane does.
What the interaction flag permits is unknown.

**Affects:** the idea [Seat awareness](../product/ideas.md#seat-awareness), and avatar sync in [03-v1-scope](../product/03-v1-scope.md).

**Evidence:** [p06's run](../../../experiments/areas/aircraft/results/p06-eyepoint-nudge-2026-10-03-21-33-51.txt), [p07's run](../../../experiments/areas/aircraft/results/p07-camera-keys-2026-10-03-21-34-20.txt), and [p04's step D](../../../experiments/areas/aircraft/results/p04-camera-seat-2026-10-03-21-37-17.txt).
p06's run at 21-32-42 stopped before sending anything, because ChasePlane held the camera.

## 2026-10-03: ChasePlane's own API moves the pilot's camera to the copilot's seat by loading its CoPilot view

**Asked:** with ChasePlane running, can Dual Input move a pilot's camera to another seat through ChasePlane itself, since ChasePlane takes the camera back from a SimConnect client ([entry below](#2026-10-03-a-simconnect-client-moves-the-pilots-camera-to-the-copilots-seat-by-releasing-the-camera-into-the-aircrafts-copilot-view-unless-chaseplane-runs))?

**Expected:** yes, since ChasePlane has a remote control of its own.

**Found:**

- ChasePlane 2026.39.1.16's bridge, the process `CP MSFS Bridge`, serves a web app, ChasePlane Remote, on port 8651, and a WebSocket API on port 8652, listening on every network interface.
  Nobody documents the API.
  ChasePlane Remote's script speaks it as JSON: an `api_connect` message with a client name, answered by `api_version` 2 and `initialized`, then `api_request` messages with a request ID, answered by `api_reply` (read in ChasePlane 2026.39.1.16, `http://localhost:8651/remote_assets/remote-ui.js`).
  Its requests include `get_views`, `set_view_by_guid`, `set_camera_mode`, and `set_master_enabled`, and it sends `cam_set_position` and `cam_set_axis` as bare messages.
- In the Black Square Baron 58P, bksq-aircraft-baronpro 0.1.1, `get_views` returned 42 views, 22 of them inside, among them `CoPilot` and `Pilot`, imported from the aircraft's camera definitions.
  Each view's position is an offset from the pilot's eye, with x pointing right: `CoPilot` sits 0.489m right of `Pilot`.
- p05 sent `set_view_by_guid` with `CoPilot`, and SimConnect_CameraGet put the eye 0.236m right of the reference point, where the sim's own `CoPilot` definition put it in p04.
  Over the next 10s the pilot looked around with the mouse through ChasePlane: the yaw went from −179° to 64° and the pitch from −11° to 62°, and the eye moved 2cm to 4cm with ChasePlane's head motion.
- `cam_set_position`, sent with the `Pilot` view's position moved 0.499m right, left the eye at the `CoPilot` view's spot, within 4mm, and turned the look to 2° pitch and 6° yaw.
  Whether that message moves the camera inside the cockpit, and what it expects, is unknown.
- `set_view_by_guid` with `Pilot` brought the eye back to the left seat, within 1mm of where it started.

**Changed:** with ChasePlane running, Dual Input can seat a pilot through ChasePlane's API in any seat ChasePlane has a view for, and the pilot looks around through ChasePlane as usual.
A seat with no view needs either `cam_set_position` worked out or a view created for it.
The API is undocumented, so a ChasePlane update can change it.

**Affects:** the idea [Seat awareness](../product/ideas.md#seat-awareness), and avatar sync in [03-v1-scope](../product/03-v1-scope.md).

**Evidence:** [p05's run](../../../experiments/areas/aircraft/results/p05-chaseplane-seat-2026-10-03-21-17-29.txt).

## 2026-10-03: A SimConnect client moves the pilot's camera to the copilot's seat by releasing the camera into the aircraft's copilot view, unless ChasePlane runs

**Asked:** can Dual Input move a pilot's cockpit camera to another seat, so it can seat the pilot itself rather than tell them to move?

**Expected:** unknown.
Setting `A:CAMERA STATE` didn't stick ([entry below](#2026-10-01-loading-flights-through-simconnect-works-but-the-sim-crashed-on-5-of-about-30-loads-so-we-canceled-the-unattended-session)), and nothing in our records had called the camera functions that set it.

**Found:** p04 ran in the Black Square Baron 58P, bksq-aircraft-baronpro 0.1.1, twice with ChasePlane 26.39.1 driving the camera and four times with ChasePlane disabled in its own settings.
`SimConnect_CameraGet`'s `SIMOBJECT` position put the pilot's eye 0.253m left of the reference point, 0.855m up, and 0.144m behind it.

- `SimConnect_EnumerateCameraDefinitions` listed the aircraft's 32 camera definitions, among them `Pilot`, `CoPilot`, `CabinForward`, `CabinRearward`, and `PilotVR`.
- `SimConnect_CameraSetUsingCameraDefinition` raised the exception `CAMERA_API` (46) unless our client held the camera.
  Holding it, `CoPilot` moved the eye to 0.236m right, 0.811m up, and 0.116m behind the reference point.
- `SimConnect_CameraAcquire` took the camera from ChasePlane as well as from the sim, and `SimConnect_CameraSet` put the eye exactly where we asked, 0.253m right.
- `SimConnect_CameraRelease` with an empty name put the eye back in the left seat within 1s.
  With ChasePlane on, ChasePlane took the camera back, and `SimConnect_CameraGetStatus` read `ACQUIRED_BY_OTHER` again.
- With ChasePlane disabled, `SimConnect_CameraRelease` with `CoPilot` left the eye in the copilot's view, with the status `NOT_ACQUIRED`.
  Over the next 13s the pilot looked around with the mouse: the yaw went from −138° to 75° and the pitch from −10° to 56°, while the eye stayed within 2mm of the copilot's view.
  Releasing with `Pilot` brought it back to the left seat.
- With ChasePlane on, ChasePlane held the camera again within 1s of the release with `CoPilot`, and the eye stayed in the left seat for the 13s the pilot looked around.

**Changed:** with the sim's own camera, Dual Input can seat a pilot in any seat the aircraft has a camera definition for, and hand the camera back for the pilot to look around as usual.
With ChasePlane, it can't without holding the camera for as long as the pilot sits there, which takes the camera from ChasePlane.
A seat with no camera definition needs the same hold, with or without ChasePlane.

**Affects:** the idea [Seat awareness](../product/ideas.md#seat-awareness), whose open question on placing the camera at a seat this answers for the sim's own camera, and avatar sync in [03-v1-scope](../product/03-v1-scope.md).

**Evidence:** p04's runs [with ChasePlane](../../../experiments/areas/aircraft/results/p04-camera-seat-2026-10-03-21-01-10.txt), [without it](../../../experiments/areas/aircraft/results/p04-camera-seat-2026-10-03-21-03-45.txt), [without it, releasing into a definition](../../../experiments/areas/aircraft/results/p04-camera-seat-2026-10-03-21-04-19.txt), [without it, looking around in the copilot's seat](../../../experiments/areas/aircraft/results/p04-camera-seat-2026-10-03-21-08-09.txt), and [with it, after the release into the copilot's view](../../../experiments/areas/aircraft/results/p04-camera-seat-2026-10-03-21-09-20.txt).
The run at 21-06-43 held the copilot's seat with no cue to look, and the camera didn't move.

## 2026-10-03: The Baron 58P lists only its pilot's seat, because the seat objects are the seats in each aircraft's navigation graph

**Asked:** does the Black Square Baron 58P, v1's aircraft, list seat objects for both front seats, so the other pilot's figure can sit in the right seat with no seat named in the profile?

**Expected:** both front seats, as the A2A Comanche lists ([avatars log](../avatars/log.md#2026-10-03-the-cockpit-models-own-space-lines-up-with-simconnects-within-8mm-but-the-models-input-event-ids-arent-the-names-the-sim-lists)).

**Found:**

- With the 58P loaded, bksq-aircraft-baronpro 0.1.1, the 3 objects within 50m were the aircraft, the avatar's object, and one seat, `SEAT_DEFAULT_Pilot`, 0.06m behind the aircraft's reference point, 0.28m left, and 0.13m up, with the avatar's object on it.
- The copilot's payload station held 160 lb, so an empty seat doesn't explain the missing copilot's seat.
- Each aircraft's `navigation_graph_pilot.cfg` lists its seats.
  The Comanche's has two seat nodes, on the cockpit model's `PILOT_1` and `PILOT_2`, with `interactiveObject = SEAT_DEFAULT_Pilot` and `SEAT_DEFAULT_Copilot`.
  The 58P's has one, on `PILOT_0`, with Asobo's `Seat_without_seatbelt` interaction (read in a2a-aircraft-pa24 2.1.3 and bksq-aircraft-baronpro 0.1.1, `navigation_graph_pilot.cfg`).
- Of the 9 aircraft packages on our development machine with a navigation graph, 7 list both front seats in it: the A2A Aerostar and Comanche, the Fenix A320, the iniBuilds A350 and L-1011, the PMDG 777, and the Synaptic A220.
  Black Square's Baron and Bonanza, both 0.1.1, list only the pilot's.
- The 58P's cockpit model has both `PILOT_0` and `PILOT_1` nodes, and p25 seated our figure on `PILOT_1`, the right seat ([avatars log](../avatars/log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs)).
  The Aerostar, the Comanche, the Bonanza, and the A220 have `PILOT_` nodes too.
  The search found none in the other packages, but it read only files whose names say interior or cockpit, so it may have missed theirs (unverified).

**Changed:** the seat objects can't be the only automatic source of seats.
On v1's aircraft, the right seat comes from the cockpit model's `PILOT_1` node or from the profile.

**Affects:** the ideas [Seat awareness](../product/ideas.md#seat-awareness) and [Avatar sync](../product/ideas.md#avatar-sync), and avatar sync in [03-v1-scope](../product/03-v1-scope.md).

**Evidence:** [p03's run on the 58P](../../../experiments/areas/aircraft/results/p03-seat-objects-2026-10-03-20-46-58.txt).

## 2026-10-03: Two partly encrypted aircraft list seat objects, the Phenom 300E for its pilots and passengers and the A380 for its pilots

**Asked:** does the sim list seat objects through SimConnect for an aircraft whose model files are partly encrypted, so a figure can be seated where the cockpit model can't be loaded?
The C152 and the A2A Comanche, whose files are readable, list theirs ([avatars log](../avatars/log.md#2026-10-02-seat-objects-place-the-other-pilot-in-the-cockpit-and-the-seated-avatar-doesnt-turn-with-the-look)).

**Expected:** yes, since the sim spawns seat objects rather than reading them from the model.

**Found:** with the FSReborn Phenom 300E loaded, fsreborn-aircraft-phenom300e 1.0.24, a Marketplace package with encrypted archives (read in its `.fsarchive` headers), the 15 objects within 50m included 10 seats:

- `SEAT_FSReborn_Phenom300E_Pilot`, 3.60m ahead of the aircraft's reference point, 0.34m left, and 0.46m up, facing forward.
- `SEAT_FSReborn_Phenom300E_Copilot`, listed as two objects at the same spot, 3.59m ahead, 0.33m right, and 0.48m up.
- 7 of `SEAT_FSReborn_Phenom300E_Pax`, from 0.96m behind the reference point to 0.78m ahead and about 0.4m either side, 4 facing forward and 3 facing aft.

The seated pilot's avatar object sat exactly on the pilot's seat.
The package's readable files show only a passenger seat part, `fsreborn_phenom300e_seat_pax` (read in its `minimal.fsarchive`), so SimConnect shows more than the files did.

With the iniBuilds A380 loaded, inibuilds-aircraft-a380 1.0.0, also a partly encrypted Marketplace package (read in its `.fsarchive` headers), the 4 objects within 50m included 2 seats, `SEAT_INI_A380_PILOT`, 21.96m ahead of the reference point, 0.53m left, and 6.32m up, and `SEAT_INI_A380_COPILOT`, 21.95m ahead, 0.50m right, and 6.32m up, with the seated avatar exactly on the pilot's.
No passenger seats showed within 50m, which covers most of the cabin of a 73m aircraft.

**Changed:** a figure can sit in the right seat on an aircraft whose cockpit model can't be loaded, though it can't reach for controls without the model.
Which seats an aircraft lists varies: the Phenom lists every passenger seat and the A380 only the pilots'.

**Affects:** the ideas [Seat awareness](../product/ideas.md#seat-awareness) and [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** p03's runs on [the Phenom](../../../experiments/areas/aircraft/results/p03-seat-objects-2026-10-03-20-14-37.txt) and [the A380](../../../experiments/areas/aircraft/results/p03-seat-objects-2026-10-03-20-17-11.txt).

## 2026-10-01: Loading flights through SimConnect works, but the sim crashed on 5 of about 30 loads, so we canceled the unattended session

**Asked:** can a harness answer the 108 questions in [questions.tsv](../../../experiments/areas/aircraft/questions.tsv) by loading each aircraft from a flight file with `SimConnect_FlightLoad`, with nobody at the sim?

**Expected:** a few hours of unattended runs, one aircraft at a time.

**Found:**

- `SimConnect_FlightLoad` from node-simconnect 4.2.0 loads a `.FLT` file from inside a flight, including one that names another aircraft: the PA-24, then the Fenix A321, then the PA-24 again all reached the file's position, title, and livery within 1.8 to 3.9s, and settled within 3 to 27s ([p01 results](../../../experiments/areas/aircraft/results/p01-flight-load-2026-10-01-17-29-57.txt)).
- Setting `A:CAMERA STATE` to 3 reverted to 2 within 30ms while ChasePlane ran, so we have no way to move the camera from the harness.
- MSFS 2024 1.8.16.0 crashed 5 times in about 30 loads, each with exception 0xc0000005 10 to 16s after a `FlightLoad`, around the sim's `FLIGHT_START` step ([crashes.tsv](../../../experiments/areas/aircraft/results/crashes.tsv)):
  - The Fenix A320 starting at a gate crashed both times, at the same offset in `FlightSimulator2024.exe`.
  - The other three crashes followed a load of the same aircraft, a restore of an aircraft's files while the sim ran, and a load right after the harness's probes.
  - Loading nothing between aircraft, a silent window during each load, and restoring files only with the sim closed didn't stop them.
- The harness answered 2 questions, both on the A2A PA-24 Comanche 2.1.3 (measured on MSFS 2024, 2026-10-01, [run results](../../../experiments/areas/aircraft/results/run-a2a-pa24-comanche-2026-10-01-18-20-15.txt)):
  - **Input events:** the sim lists 318 input events at runtime, and 153 of the package's 223 declared IDs match one of them.
    Setting `SWITCH_BATTERY_MASTER_2STATES` to 0 and back to 1 moves `L:Battery1Switch` with it, while `A:ELECTRICAL MASTER BATTERY:1` stays 1 through the 1.5s the test watched.
    Setting the tooltip-only `RADIO1_DME_SWITCH_DRAG` moves nothing.
  - **Stock events:** `K:ELECT_FUEL_PUMP1_SET` 1 moves `A:GENERAL ENG FUEL PUMP SWITCH:1` from 0 to 1, and `K:TOGGLE_AVIONICS_MASTER` moves `A:AVIONICS MASTER SWITCH:1` from 1 to 0, both passed through to the sim.
    A client at or above the highest maskable priority masks `K:TOGGLE_BEACON_LIGHTS`, and `A:LIGHT BEACON` and `L:BeaconLightSwitch` still go from 1 to 0.
    It masks `K:PITOT_HEAT_ON` too, but the pitot heat was already on, so whether the event from another client would turn it on stays open.
- The harness backed up each aircraft's saved files before its loads and restored them with the sim closed; every restore matched byte for byte.

**Changed:** we canceled the unattended session, because at this crash rate the 108 questions would take days.
A question gets answered when a design needs it, with the harness in `experiments/areas/aircraft/` and that aircraft alone.

**Affects:** `CLAUDE.md`'s working rule on batching sim work.
