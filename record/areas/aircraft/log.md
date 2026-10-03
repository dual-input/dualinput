# Aircraft studies: log

What the sim found about the studied aircraft, newest entry first.
The probes, the harness, and their raw output are in [experiments/areas/aircraft](../../../experiments/areas/aircraft), with the results in its `results/` folder.

## 2026-10-03: ChasePlane's own API moves the pilot's camera to the copilot's seat by loading its CoPilot view

**Asked:** with ChasePlane running, can Crosscheck move a pilot's camera to another seat through ChasePlane itself, since ChasePlane takes the camera back from a SimConnect client ([entry below](#2026-10-03-a-simconnect-client-moves-the-pilots-camera-to-the-copilots-seat-by-releasing-the-camera-into-the-aircrafts-copilot-view-unless-chaseplane-runs))?

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

**Changed:** with ChasePlane running, Crosscheck can seat a pilot through ChasePlane's API in any seat ChasePlane has a view for, and the pilot looks around through ChasePlane as usual.
A seat with no view needs either `cam_set_position` worked out or a view created for it.
The API is undocumented, so a ChasePlane update can change it.

**Affects:** the idea [Seat awareness](../product/ideas.md#seat-awareness), and avatar sync in [03-v1-scope](../product/03-v1-scope.md).

**Evidence:** [p05's run](../../../experiments/areas/aircraft/results/p05-chaseplane-seat-2026-10-03-21-17-29.txt).

## 2026-10-03: A SimConnect client moves the pilot's camera to the copilot's seat by releasing the camera into the aircraft's copilot view, unless ChasePlane runs

**Asked:** can Crosscheck move a pilot's cockpit camera to another seat, so it can seat the pilot itself rather than tell them to move?

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

**Changed:** with the sim's own camera, Crosscheck can seat a pilot in any seat the aircraft has a camera definition for, and hand the camera back for the pilot to look around as usual.
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

**Found:** with the FSReborn Phenom 300E loaded, fsreborn-aircraft-phenom300e 1.0.24, a Marketplace package with encrypted archives ([Phenom study](fsreborn-phenom-300e/study.md)), the 15 objects within 50m included 10 seats:

- `SEAT_FSReborn_Phenom300E_Pilot`, 3.60m ahead of the aircraft's reference point, 0.34m left, and 0.46m up, facing forward.
- `SEAT_FSReborn_Phenom300E_Copilot`, listed as two objects at the same spot, 3.59m ahead, 0.33m right, and 0.48m up.
- 7 of `SEAT_FSReborn_Phenom300E_Pax`, from 0.96m behind the reference point to 0.78m ahead and about 0.4m either side, 4 facing forward and 3 facing aft.

The seated pilot's avatar object sat exactly on the pilot's seat.
The package's readable files show only a passenger seat part, `fsreborn_phenom300e_seat_pax` ([files](fsreborn-phenom-300e/files.md)), so SimConnect shows more than the files did.

With the iniBuilds A380 loaded, inibuilds-aircraft-a380 1.0.0, also a partly encrypted Marketplace package ([A380 study](inibuilds-a380/study.md)), the 4 objects within 50m included 2 seats, `SEAT_INI_A380_PILOT`, 21.96m ahead of the reference point, 0.53m left, and 6.32m up, and `SEAT_INI_A380_COPILOT`, 21.95m ahead, 0.50m right, and 6.32m up, with the seated avatar exactly on the pilot's.
No passenger seats showed within 50m, which covers most of the cabin of a 73m aircraft.

**Changed:** a figure can sit in the right seat on an aircraft whose cockpit model can't be loaded, though it can't reach for controls without the model.
Which seats an aircraft lists varies: the Phenom lists every passenger seat and the A380 only the pilots'.

**Affects:** the ideas [Seat awareness](../product/ideas.md#seat-awareness) and [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** p03's runs on [the Phenom](../../../experiments/areas/aircraft/results/p03-seat-objects-2026-10-03-20-14-37.txt) and [the A380](../../../experiments/areas/aircraft/results/p03-seat-objects-2026-10-03-20-17-11.txt).

## 2026-10-01: Loading flights through SimConnect works, but the sim crashed on 5 of about 30 loads, so we canceled the unattended session

**Asked:** can a harness answer the 108 unattended sim questions in [questions.tsv](../../../experiments/areas/aircraft/questions.tsv) by loading each aircraft from a flight file with `SimConnect_FlightLoad`, with nobody at the sim?

**Expected:** a few hours of unattended runs, one aircraft at a time.

**Found:**

- `SimConnect_FlightLoad` from node-simconnect 4.2.0 loads a `.FLT` file from inside a flight, including one that names another aircraft: the PA-24, then the Fenix A321, then the PA-24 again all reached the file's position, title, and livery within 1.8 to 3.9s, and settled within 3 to 27s ([p01 results](../../../experiments/areas/aircraft/results/p01-flight-load-2026-10-01-17-29-57.txt)).
- Setting `A:CAMERA STATE` to 3 reverted to 2 within 30ms while ChasePlane ran, so we have no way to move the camera from the harness.
- MSFS 2024 1.8.16.0 crashed 5 times in about 30 loads, each with exception 0xc0000005 10 to 16s after a `FlightLoad`, around the sim's `FLIGHT_START` step ([crashes.tsv](../../../experiments/areas/aircraft/results/crashes.tsv)):
  - The Fenix A320 starting at a gate crashed both times, at the same offset in `FlightSimulator2024.exe`.
  - The other three crashes followed a load of the same aircraft, a restore of an aircraft's files while the sim ran, and a load right after the harness's probes.
  - Loading nothing between aircraft, a silent window during each load, and restoring files only with the sim closed didn't stop them.
- The harness answered 2 questions, both on the A2A PA-24 Comanche 2.1.3 (measured on MSFS 2024, 2026-10-01, [run results](../../../experiments/areas/aircraft/results/run-a2a-pa24-comanche-2026-10-01-18-20-15.txt)):
  - **Question 11, input events:** the sim lists 318 input events at runtime, and 153 of the package's 223 declared IDs match one of them.
    Setting `SWITCH_BATTERY_MASTER_2STATES` to 0 and back to 1 moves `L:Battery1Switch` with it, while `A:ELECTRICAL MASTER BATTERY:1` stays 1 through the 1.5s the test watched.
    Setting the tooltip-only `RADIO1_DME_SWITCH_DRAG` moves nothing.
  - **Question 7, stock events:** `K:ELECT_FUEL_PUMP1_SET` 1 moves `A:GENERAL ENG FUEL PUMP SWITCH:1` from 0 to 1, and `K:TOGGLE_AVIONICS_MASTER` moves `A:AVIONICS MASTER SWITCH:1` from 1 to 0, both passed through to the sim.
    A client at or above the highest maskable priority masks `K:TOGGLE_BEACON_LIGHTS`, and `A:LIGHT BEACON` and `L:BeaconLightSwitch` still go from 1 to 0.
    It masks `K:PITOT_HEAT_ON` too, but the pitot heat was already on, so whether the event from another client would turn it on stays open.
- The harness backed up each aircraft's saved files before its loads and restored them with the sim closed; every restore matched byte for byte.

**Changed:** we canceled pass two of the [plan](plan.md#pass-two-canceled), because at this crash rate the 108 questions would take days.
A question gets answered when a design needs it, with the harness in `experiments/areas/aircraft/` and that aircraft alone.

**Affects:** the [PA-24 study](a2a-pa24-comanche/study.md), whose State, Input path, Prior records, and Sim questions sections cite these answers; and `CLAUDE.md`'s working rule on batching sim work.
