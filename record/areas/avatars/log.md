# Avatars: log

What our experiments found about showing one pilot's avatar on the other pilot's machine with MSFS multiplayer off, as a figure, a person-shaped object Crosscheck spawns and moves, newest entry first.
SimConnect reads the avatar's position, ground speed, and facing every sim frame through `SIMCONNECT_OBJECT_ID_USER_AVATAR`.
The sim's own people stay invisible when a SimConnect client spawns them, while GSX's people show and follow a position we write every frame, sliding rather than walking.
The probes are [p01-avatar.mjs](../../../experiments/areas/avatars/p01-avatar.mjs) and [p02-figures.mjs](../../../experiments/areas/avatars/p02-figures.mjs), and their raw output is in [experiments/areas/avatars/results](../../../experiments/areas/avatars/results).
Every entry was measured on MSFS 2024 SunRise 12.2.282174.999 on 2026-10-02, at a gate at LQSA with the Cessna C152 Aerial Advertising, on our development machine with GSX and ChasePlane running.

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
