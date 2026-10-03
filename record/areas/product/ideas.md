# Product: ideas

These are the ideas for what Crosscheck might do.
Each entry opens with the idea, then gives its technical risk under Tech, its value to pilots under Product, and what's unknown under Open questions and Next, leaving out a label with nothing to say.
When a finding changes how an idea looks, its entry changes and cites the finding.
When we pick an idea, it gets its own area under `record/areas/`, its entry here links there, and that area's plan holds its status.
The ideas we turned down or set aside are under [Ideas left out](#ideas-left-out), each with the reason, so nobody proposes one again without knowing why it went.

## Sync

### State sync with variables and events

Each change to a switch, knob, or lever travels to the other machine as the variable or event behind it, as FS Copilot and YourControls do ([01](../../learn/foundations/01-prior-art-and-crew-practice.md#prior-art)).
The other ideas build on it.

### Pointer sync

A press on a panel display travels as the position the pointer went to, and the receiving display decides what's there.
In our FS Copilot fork this drove the A220's SVG displays, which syncing the name of the clicked element can't reach (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - Q03 PASSES: a synthetic mouse click drives a React/SVG display").
It's our leading candidate for syncing panels, pending a decision in `record/decisions/`.
Crosscheck would also show which pilot is working which display, such as "FO on the MCDU", so the other pilot keeps off it.

- **Tech:** WASM displays need more than a forwarded position, which [WASM instrument sync](#wasm-instrument-sync) covers.
  When both pilots type on one display at once, each machine would apply the keys in a different order (unverified, [08-06](../../learn/foundations/08-06-divergence-and-one-screen.md#unverified-claims)).

### Bus bridge

Crosscheck listens to the messages an aircraft's parts send each other on the CommBus and in client data areas, and to state-sharing calls its vendor built in, such as the A220's `A22X.Resync` below, and carries them to the other machine.
A profile, the file that tells Crosscheck what to sync on one aircraft, names what to listen to, and the profile IDE, the tool authors build profiles in, finds those names.

- **Tech:** reading the CommBus from panel JavaScript works, and what it yields depends on the aircraft.
  The Synaptic A220 puts its whole cockpit's state there, the A2A PA-24 doesn't use it, and the iniBuilds A350 uses it only between its modules, its electronic flight bag (EFB), and its printer (measured on MSFS 2024, 2026-09-28, and read in the aircraft's files, 2026-09-30, [CommBus log](../commbus/log.md)).
  Some aircraft hand over their full state on request, which a pilot joining mid-flight needs.
  Sending `A22X.Resync` made each of the A220's 29 change-sending channels send a full snapshot, 1,674 fields in about 100ms (measured on MSFS 2024, 2026-09-28, [CommBus log](../commbus/log.md#2026-09-28-a22xresync-returns-the-a220s-full-state-and-one-listener-hears-every-channel)).

- **Open questions:** our CommBus work covers reading.
  Whether a message carried to the other machine changes that aircraft's state, rather than only what its displays draw, is the next question.

### EventBus bridge

Avionics built on the MSFS Avionics Framework share state between instruments.
A topic published with the `sync` flag goes out once a frame as JSON under the key `wt.eb.evt`, and a new instrument's bus publishes `resync_request` to have every synced topic sent again (read in the A220's DisplayUnits bundle, [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)).
Carrying that key between machines, limited to the topics that belong to the aircraft rather than to one machine, could sync flight plans and flight management system (FMS) state for every avionics suite built on the framework, such as the G1000 NXi, G3000, and WT21, without a profile entry per aircraft.

- **Tech:** unverified, because no code outside the framework has listened to the key ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#unverified-claims)).
- **Product:** large if it works, because the FMS is where shared-cockpit tools fall short: YourControls syncs the keypresses on a flight management computer, not its state ([01](../../learn/foundations/01-prior-art-and-crew-practice.md#prior-art)).
- **Next:** listen on `wt.eb.evt` from our own code in a G1000 NXi panel, and log what arrives while a pilot changes pages and edits a flight plan, which settles the claim in [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#unverified-claims).

### WASM instrument sync

Some displays drawn by WASM code can take a forwarded press.
The iniBuilds A380's displays pressed at the position we sent once we told the display the mouse had entered it (measured on MSFS 2024, 2026-09-23, FS Copilot fork, `record/wasm-pointer/docs/log.md`, "2026-09-23 — The A380 presses where we say once the display is told the mouse entered it; the A350 does not").
The A350's module discards the position we send and presses wherever the receiving pilot's own cursor is on that display, so reaching it takes a patch to the module that nobody has written (read in inibuilds-aircraft-a350 1.2.6, `inibuilds-A350.wasm`, `GaugeInstance::DoCallback`; FS Copilot fork, `record/wasm-pointer/docs/log.md`, "2026-09-24 — Read out of the A350's binary: the press position comes from the draw data, not the click").

- **Next:** design how a production version does this, and find which aircraft's displays it reaches.

### Traffic sync

The traffic one pilot's sim shows appears in the other's, on the same principles as our FS Copilot fork's traffic work (FS Copilot fork, `record/traffic-atc/docs/01-design.md`).

- **Tech:** our FS Copilot fork carried one app instance's traffic to a second instance on the same sim and replayed it smoothly, after fixing echo, relay drops, and duplicate packets (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 4, traffic: what the app needed that the prototype did not").

### Ground operations sync

Pushback, jetways, the fuel truck, and GSX show on both machines, so both pilots see the pushback they asked for.

- **Tech:** the sim's own services start from key events, such as `K:TOGGLE_JETWAY` and `K:TOGGLE_PUSHBACK`, and GSX is a separate addon with its own `L:FSDT_GSX_*` variables; the iniBuilds A350 uses both (read in inibuilds-aircraft-a350 1.2.6, [A350 study](../aircraft/inibuilds-a350/study.md)).
  Showing the tug on the other machine is a [traffic sync](#traffic-sync) problem.

### ATC sync

ATC audio captured on one machine plays on the other, as in our FS Copilot fork's traffic and ATC work (FS Copilot fork, `record/traffic-atc/docs/01-design.md`).
A tester asked for the reverse too: the other pilot's mic reaching ATC.

- **Tech:** our FS Copilot fork captured BeyondATC's audio by process and played it back about 130ms later, plus the network delay (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 3: the audio path works on one machine — Q10, Q12, Q13 settled").
- **Open questions:** capturing by process reaches any ATC app that runs as its own process, but the sim's own ATC plays from the sim's process with the rest of its sound (unverified).
  Sending the other pilot's mic to VATSIM, SayIntentions, or BeyondATC is an integration for each.
  How a pilot chooses when their mic goes to ATC: a push-to-talk key in Crosscheck, a toggle in [Crosscheck's interface](#crosschecks-interface-in-the-efb-and-on-a-tablet), or the aircraft's audio panel where its profile maps one.

### Environment sync

Time, date, sim rate, pause, and weather match on both machines.

- **Tech:** how to set the weather from outside the sim in MSFS 2024 is unknown, and Active Sky would be its own integration.
- **Product:** weather changes more than the view.
  The wind on the navigation display comes from each machine's own weather, so with different weather the other pilot reads a different wind (unverified).

## Session

### Flight setup by the host

The host picks the aircraft, gate, panel state, time, and weather, and Crosscheck loads the same flight on both machines.

- **Tech:** `SimConnect_FlightLoad` loads a flight file from inside a running flight, including one that names another aircraft (measured on MSFS 2024, 2026-10-01, [aircraft log](../aircraft/log.md#2026-10-01-loading-flights-through-simconnect-works-but-the-sim-crashed-on-5-of-about-30-loads-so-we-canceled-the-unattended-session)).
  MSFS 2024 1.8.16.0 crashed on 5 of about 30 such loads, including both loads of the Fenix A320 at a gate, and nothing we changed stopped it (same entry).
- **Product:** ends the "which gate, and cold and dark?" exchange at the start of each session.
- **Open questions:** what makes the sim crash on a load, how the host's choices become a flight file, and how to set a panel state on aircraft that keep their own, such as the iniBuilds A350, whose EFB applies one with `K:INIB.SET_PANELSTATE` (read in inibuilds-aircraft-a350 1.2.6, [A350 study](../aircraft/inibuilds-a350/study.md)).

### Preflight match check

Before a session starts, Crosscheck compares each pilot's aircraft package and version, warns when the liveries differ, and says how to fix what doesn't match.
The check leaves out Crosscheck's own version, which the connection checks, and fuel and payload, which sync throughout the flight.

- **Tech:** each package's version is in its `manifest.json`, which our aircraft studies already read.
  On livery N324DU the A220's DisplayUnits panel identifies itself as `DisplayUnits|config=N324DU`, while FS Copilot's profile matches only `DisplayUnits|config=Default`, so by our reading, not yet flown, that display syncs on no other livery, which is why the check compares liveries (measured on MSFS 2024, 2026-09-17, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-17 — The A220's DisplayUnits key carries the livery, and the profile names only Default").

### Pre-sync checklist

A profile carries a checklist of what the pilots line up before sync starts, such as "both panels start in the same state", and Crosscheck shows it before syncing begins.
So a session starts in two steps: the machines connect, and sync starts only when the pilots say they're ready.
A later version would watch the aircraft's state and tick an item off once both machines agree, such as a knob whose value Crosscheck can read but can only sync by turning it a step at a time.
It's Crosscheck's own setup list, unlike the aircraft's checklists under [Ideas left out](#ideas-left-out), and it covers the cockpit's state, where the [preflight match check](#preflight-match-check) covers packages and liveries.

- **Product:** serves the joiner and the first-time host in [02-users](02-users.md#roles-in-every-session), who can't tell why two machines differ.
- **Open questions:** when sync starts, whether Crosscheck copies everything it can set from one pilot's cockpit to the others, which would leave the checklist only what it can't set.
  What happens to a change a pilot makes after connecting but before sync starts.

### One-click invite

A pilot invites the other with a short code to paste into Discord.
When the other pilot copies the code and switches to Crosscheck, Crosscheck finds its own code on the clipboard and joins the session, so copying is the only step.
Two PCs on the same home network find each other without a code, and the connection shows in plain words, such as "Direct, 38ms" (hypothetical).

- **Tech:** Discord shows `crosscheck://join/<code>` as plain text, and again as plain text when it's written as a Markdown link (tested in Discord, 2026-10-02).
  We think Discord makes only http and https links clickable, whichever apps are installed (unverified).
  An invite link could still start with https, pointing to a static page, on GitHub Pages for example, that sends the browser on to `crosscheck://join/<code>`.
  The other pilot would then click past Discord's warning that the link leaves Discord and the browser's "Open Crosscheck?" prompt, which is more work than copying a code, so we expect to drop links in favor of codes.
  Crosscheck can tell its own code on the clipboard from anything else only if the code's format is distinctive, such as a fixed prefix.
- **Product:** a code also works in any chat app, and one pilot can read it out to the other over voice.
- **Open questions:** whether Crosscheck joins as soon as it finds a code or asks first, since an old code can sit on the clipboard from an earlier session.
  Whether Discord's own join invitations, which games send through Rich Presence, are open to an app that isn't a game.

## Control

### Voice handover

Control passes by the spoken exchange crews use:

1. The pilot flying (PF), whose controls fly the aircraft, says "you have control", which opens a window of a few seconds.
2. If another pilot says "I have control" inside the window, control passes to them.
3. The first pilot's closing "you have control" changes nothing, so Crosscheck doesn't wait for it.

A take-control key, button, or shortcut takes control at once, without voice.
The pilot taking control hears a recorded "you have control" as confirmation.
When control passes, [soft takeover](#soft-takeover-on-handover) starts.

- **Tech:** each machine listens only to its own pilot's mic, so nothing has to work out who spoke.
  Each machine listens for a few fixed phrases rather than transcribing speech, which small local models can do on a CPU, though whether they're accurate enough is unverified.
  Windows lets Discord and Crosscheck capture the same mic at once.
  Voice only completes a handover the PF started, so control moves by mistake only if both machines mishear, in order, inside the window.
- **Open questions:** accuracy with non-native English accents, which is the first thing to test.
  [03-v1-scope](03-v1-scope.md#voice-phrases) settles which phrases v1 accepts, from the conventions regulators, militaries, and airlines document.

### Soft takeover on handover

When control passes, the new PF's hardware throttle can sit far from the aircraft's throttle, and the aircraft's throttle jumps to match it.
Crosscheck ignores their axis until the lever crosses the aircraft's value, as MIDI controllers do in pickup mode, and shows where to move it.
Trim wheels and flap and gear levers on hardware have the same mismatch.

- **Tech:** masking the pilot's axis events holds them back from the sim on stock flight controls and on the PMDG 777 (measured on MSFS 2024, 2026-10-01, [log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)).
  On an aircraft whose module asks for the same priority, such as the A2A PA-24, it works only if Crosscheck's masks are in place before the aircraft loads ([log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)).
- **Product:** removes the thrust jump at handover.
- **Open questions:** a first scoping pass on 2026-10-03 proposed these, for review when soft takeover is scoped:
  - A lever picks up once it comes within a small tolerance of the aircraft's, rather than having to cross it, and a test on real hardware sets the tolerance.
  - Pickup covers the new PF's throttles, propellers, and mixtures, each on its own, their trim where it's an axis, and either pilot's flap axis at any time.
  - The yoke and rudder drive at once, because a yoke that waited to pick up could leave nobody flying the aircraft.
  - Whenever the aircraft's lever moves away from a pilot's hardware lever, that lever picks up again.
  - With pickup, the engine levers could be shared all the time rather than only the PF's: whichever pilot's picked-up lever moves drives the aircraft's lever, and the other pilot's drops out of pickup.
  - How the new PF learns which levers haven't picked up was left open.
  - Hardware switches that disagree with the aircraft's, such as a gear lever or a home cockpit panel's switches, are a separate problem, which [02-users](02-users.md#setups) names.

### Mixed flight controls

Both pilots' hands reach the flight controls, as in a real cockpit.
The flying machine is the PF's, and the following machine is the pilot monitoring's (PM's).
The following machine still freezes its aircraft and sets it from the flying machine's position, attitude, and velocity, as FS Copilot and YourControls do ([01](../../learn/foundations/01-prior-art-and-crew-practice.md#prior-art)).
What changes is that Crosscheck takes each pilot's yoke and throttle input before the sim acts on it, sends the PM's axes one way to the flying machine, and mixes them there with the PF's, by a rule for each aircraft type.
Where the type warns of dual input, Crosscheck does too: on an Airbus, the two sidesticks' inputs are added and a "DUAL INPUT" voice warns the crew (documented, secondary, in [01](../../learn/foundations/01-prior-art-and-crew-practice.md#crm-callouts-and-transfer-of-control)).
In FS Copilot and YourControls only the PF's hardware reaches the sim, and this sends both pilots' hardware to it, so building it starts with a decision in `record/decisions/`.

- **Tech:**
  - Masking the axis events keeps them from the sim, and the block ends when the masking client dies (measured on MSFS 2024, 2026-10-01, [log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)).
    On an aircraft whose module asks for the same priority, Crosscheck's masks have to be in place before the aircraft loads ([log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)).
  - A mixed value sent back reaches stock flight controls from priority 10,001,000 down ([log](../flight-controls/log.md#2026-10-01-a-value-sent-back-at-10000001-reached-our-own-masking-group-and-the-777-ignored-re-sent-values)), and the PMDG 777's own yoke takes it at 10,001,000 only when it's sent with the legacy `SimConnect_TransmitClientEvent` ([log](../flight-controls/log.md#2026-10-01-the-pmdg-777-takes-a-value-sent-back-with-the-legacy-transmit-call)).
  - A masked event carries the value after the pilot's dead zone set in MSFS, so that setting survives ([log](../flight-controls/log.md#2026-10-01-inside-a-dead-zone-set-in-msfs-the-axis-fires-no-event)); whether the sensitivity curve does is unmeasured.
  - The other pilot's input arrives one network delay late, which the network design has to keep short.
- **Product:** an exact dual-input warning, and a second pair of hands on the controls.

## Presence

### Shared pointing

A pilot points at something in the cockpit and the other pilot sees it, tried in this order:

1. A pointer in the 3D cockpit.
2. If that can't be done, a highlight on the switch the pilot picks.
3. If neither can, a pointer on panel displays, built on what [pointer sync](#pointer-sync) already reads.

- **Tech:** the ray from the pilot's eye through the cursor meets the aircraft's cockpit model within 2mm at any zoom and window shape (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-the-ray-through-the-cursor-needs-no-calibration-cameragets-field-of-view-is-the-views-height-and-clicks-land-within-2mm-at-any-zoom-and-window-shape)), so Crosscheck can tell where in the 3D cockpit a pilot points.
  A hand that follows the cursor or the gaze all the time isn't what a pilot does, so pointing would be something the pilot chooses to do, such as a laser pointer they switch on ([avatars log](../avatars/log.md#2026-10-03-a-model-of-our-own-compiles-from-generated-gltf-and-its-size-and-color-follow-variables-of-its-own-object)).
  The sim's checklist highlight might serve the second (unverified).

### Seat awareness

Each pilot has a seat, and their camera starts there.
Where an aircraft lists no usable seats, the profile author moves the camera to each seat, and the profile IDE's "capture position" button saves it to the profile, relative to the aircraft, with the view direction.

- **Tech:** MSFS 2024 aircraft can ship seat parts with their own navigation graphs.
  The A220 has `A220_Seat_Pilot` and `A220_Seat_Copilot` (read in synaptic-aircraft-a220 1.0.10, [files](../aircraft/synaptic-a220/files.md)), and the Phenom 300E has a passenger seat, `fsreborn_phenom300e_seat_pax` (read in fsreborn-aircraft-phenom300e 1.0.24, [files](../aircraft/fsreborn-phenom-300e/files.md)).
  Whether they hold positions Crosscheck can use is unverified.
  The C152's seats show up in SimConnect as objects, `SEAT_C152_Pilot` and `SEAT_C152_Pax`, whose positions it reads, and the seated pilot's avatar sits exactly on `SEAT_C152_Pilot` (measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-seat-objects-place-the-other-pilot-in-the-cockpit-and-the-seated-avatar-doesnt-turn-with-the-look)).
  The A2A Comanche's show up the same way, as `SEAT_DEFAULT_Pilot` and `SEAT_DEFAULT_Copilot`, and sit within 8mm of where its model puts the nodes `PILOT_1` and `PILOT_2` (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-the-cockpit-models-own-space-lines-up-with-simconnects-within-8mm-but-the-models-input-event-ids-arent-the-names-the-sim-lists)).
  Whether the A220's and Phenom's seat parts show up the same way is unverified.
- **Open questions:** whether Crosscheck can move the camera to a seat at all.
  After a flight load we set `A:CAMERA STATE` to 3, the chase camera, and it went back to 2, the cockpit, 32ms later, with ChasePlane running, so we don't know whether the sim or ChasePlane moved it back (measured on MSFS 2024, 2026-10-01, [aircraft log](../aircraft/log.md#2026-10-01-loading-flights-through-simconnect-works-but-the-sim-crashed-on-5-of-about-30-loads-so-we-canceled-the-unattended-session)).
  Setting it again with ChasePlane closed would settle it.

### Join modes

Anyone who joins a session joins as a pilot or as a passenger.
A passenger picks one of the aircraft's [seats](#seat-awareness) and rides along, so a group of four can have two flying and two in the cabin.
Later, a pilot could invite a passenger to a given seat, with the invite made to look like a boarding pass.

- **Tech:** a crew and its passengers need different things from the connection.
  The crew, usually two or three people, sends every change and needs it to arrive with little delay, while passengers send almost nothing and can take more delay (unverified).
  Connecting each of 150 people to every other takes 11,175 connections (150 × 149 / 2).
  Instead, the crew could connect to each other, and passengers receive a one-way feed.
  The feed would come from one crew machine, or pass down a tree in which each passenger forwards it to a few others.
  Crosscheck would cap how many of a session's connections the relay carries, so one large event can't use up the relay.
- **Product:** serves the [groups](02-users.md#groups) who fly with passengers.
- **Open questions:** a passenger probably needs the aircraft installed to sit in its cabin (unverified), so passenger mode is an option for groups who all own the aircraft.

### Avatar sync

Each pilot sees the other pilot's avatar, with MSFS multiplayer off.
Crosscheck reads where the avatar is, which way it faces, where the pilot looks, and where they click, and on the other machine moves a figure of its own to match.
The figure is a few plain shapes that carry meaning by how they move, after the people in the game Big Walk: a long nose shows where the pilot looks, the head turns and nods, and the hands are balls on arms that stretch.
In the cockpit, a hand goes to whatever the pilot clicks or drags.

- **Tech:**
  - **The avatar:** SimConnect reads the avatar's position, ground speed, and facing every sim frame through `SIMCONNECT_OBJECT_ID_USER_AVATAR` (measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-the-avatars-own-object-id-gives-its-position-speed-and-facing-every-sim-frame)).
  - **The figure:** the sim's own people stay invisible when a SimConnect client spawns them, while GSX's people show (same date, [avatars log](../avatars/log.md#2026-10-02-a-gsx-person-shows-and-follows-where-we-write-it-and-the-sims-own-people-stay-invisible)).
    A model of our own compiles from generated glTF, and its size and color follow variables of its own object, which a WASM module sets every frame (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-a-model-of-our-own-compiles-from-generated-gltf-and-its-size-and-color-follow-variables-of-its-own-object)).
    So the figure can be Crosscheck's own simple model, with no modeled, animated character to build.
  - **Holding it in a moving cockpit:** on an aircraft with seat objects, the seated figure goes on the seat object of the other pilot's seat ([avatars log](../avatars/log.md#2026-10-02-seat-objects-place-the-other-pilot-in-the-cockpit-and-the-seated-avatar-doesnt-turn-with-the-look)).
    In flight, an object written every frame from outside the sim stutters against the cockpit (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-writes-from-outside-the-sim-place-an-object-in-a-moving-cockpit-but-cant-hold-it-still)).
    GSX keeps its seated passengers still by adding its model to the aircraft package's own `attached_objects.cfg`, which the sim then draws as part of the aircraft (read in files, [avatars log](../avatars/log.md#2026-10-03-gsx-keeps-its-passengers-aboard-by-adding-its-model-to-the-aircrafts-own-attachments)), and a model attached that way holds still in flight ([avatars log](../avatars/log.md#2026-10-03-a-model-attached-through-the-aircrafts-own-files-holds-still-in-flight)).
    On aircraft whose files Crosscheck doesn't edit, a WASM module writing the figure inside the sim's frame, turned by full attitude and led by 0.75 to 1 frame, holds it in the seat of a rocking aircraft, and what's left of its lag reads as inertia ([avatars log](../avatars/log.md#2026-10-03-over-three-minutes-of-flying-leads-of-075-and-1-frame-both-hold-the-figure-and-whats-left-reads-as-inertia)).
  - **The head:** `SimConnect_CameraGet` gives where the pilot looks, whether ChasePlane drives the camera or not (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-simconnect_cameraget-gives-where-the-pilot-looks-with-chaseplane-driving-the-camera-or-not)), and includes a Tobii head tracker's rotation (same date, [avatars log](../avatars/log.md#2026-10-03-simconnect_cameraget-includes-a-tobii-head-trackers-rotation-and-its-position-is-in-meters)).
  - **The hand:** it goes where the ray from the pilot's eye through the cursor meets the aircraft's interior model, which Crosscheck reads from the aircraft's own glTF files, with no input event or control name involved (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-a-clicks-ray-cast-into-the-cockpit-model-finds-the-control-the-pilot-clicked-with-no-names-but-the-run-couldnt-pin-down-the-field-of-view)).
    Picking the control by the name of the input event that changed failed, because the names in an aircraft's behavior files aren't the ones the sim lists ([avatars log](../avatars/log.md#2026-10-03-the-cockpit-models-own-space-lines-up-with-simconnects-within-8mm-but-the-models-input-event-ids-arent-the-names-the-sim-lists)).
    The ray needs no calibration: `SimConnect_CameraGet` puts the eye in the model's own space within 4mm, and its field of view is the view's height, so clicks land within 2mm at any zoom and window shape ([avatars log](../avatars/log.md#2026-10-03-the-ray-through-the-cursor-needs-no-calibration-cameragets-field-of-view-is-the-views-height-and-clicks-land-within-2mm-at-any-zoom-and-window-shape)).
    A held press glides along the plane of the surface it first touched, which keeps the hand on a lever that has moved in the sim ([avatars log](../avatars/log.md#2026-10-03-during-a-drag-the-cursor-keeps-moving-and-gliding-on-the-touched-surfaces-plane-keeps-the-hand-on-a-lever-where-a-fresh-cast-falls-through)), and a quick, still right press counts as a click while a held one turns the view ([avatars log](../avatars/log.md#2026-10-03-a-quick-still-right-press-is-a-click-and-a-held-or-moved-one-turns-the-view)).
    The other machine needs only the point, in the aircraft's frame, since both pilots fly the same aircraft package.
- **Product:** a pilot sees the other pilot beside them on the walkaround, which FS Copilot's pilots never do: FS Copilot requires multiplayer off (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "What the receiving pilot has to do"), and with it off nothing shows the other pilot's avatar.
  In the cockpit, the other pilot sits in their seat, turns their head where they look, and reaches for each switch, knob, and lever they work, so a pilot sees who did what as it happens.
  When a pilot's connection drops, their seated figure could slump in the seat, so the others see what happened.
- **Open questions:**
  - Whether Crosscheck should edit other developers' aircraft packages, as GSX does, which needs a decision in `record/decisions/`, and how its edit coexists with GSX's in the same file.
    Which of the two routes ships: attaching through the aircraft's files is still, and the WASM writer reaches every aircraft, stock ones included.
  - How Crosscheck seats the figure on an aircraft without seat objects.
  - Whether the figure's head and arms can turn and stretch through variables of its own object, as its size does (unverified).
  - Where the hand's model and the sim disagree.
    Parts that move or hide in the sim stand in the files where the model stores them, so the yokes block clicks on switches behind them, and a hidden part, such as the Comanche's copilot yoke, still catches the ray.
    The Comanche's `aircraft.cfg` names its yoke node and the yoke's animations under `[VR]` (read in a2a-aircraft-pa24 2.1.3), a lead for yokes.
    Attachments, such as the Comanche's GPS units, have models of their own, which Crosscheck doesn't load yet.
  - Which aircraft the hand reaches.
    The eight Community aircraft packages we looked in on our development machine, from A2A, Black Square, Fenix, iniBuilds, PMDG, and Synaptic, ship their models as `.gltf` files, as the Comanche does (read in their packages, 2026-10-03), though only the Comanche's has been read through.
    The C152, which streams with the sim, and Marketplace aircraft may have no model we can read (unverified).
    The hand has only been measured in the Comanche, so a run in a second aircraft would show whether reading its model is as general as the ray.
  - A change with no click, from a hardware switch or a key binding, brings no hand.
    The profile IDE could link each profile entry to a point in the model by having the author click the control during discovery, so the hand still reaches for it.
  - VR has no cursor.

## Interface

### Crosscheck's interface in the EFB and on a tablet

Crosscheck's controls, such as session status and the take-control button, run as an app on the sim's EFB, which a pilot in VR can reach, and in a browser on a tablet on the home network.
That makes the interface a client of Crosscheck's app on whichever screen it runs, and the app's design has to allow that from the start.

- **Tech:** MSFS 2024 runs third-party EFB apps: the A2A Aerostar 600's tablet is one, `Aerostar600App` (read in a2a-aircraft-aerostar600 1.0.6, `html_ui/efb_ui/efb_apps/Aerostar600App/A2ATabletApp.js`).
  The sim's EFB opens with the Tab key in any aircraft, including those that ship their own tablet, such as the Black Square Baron Pro (from our own use of MSFS 2024, as of 2026-10-02).

## Tools

### Flight recorder and debrief

Crosscheck records every synced change and every handover, and plays the flight back as a timeline afterward.
Pilots debrief with it, training groups use it for checkrides, and we use it to find where two cockpits diverged, with a button that bundles the last minutes into a bug report.

- **Tech:** every change already passes through Crosscheck, so recording costs little, and the timeline viewer is the work.

### Profile registry

Each profile is matched to aircraft package versions, and Crosscheck fetches the one that matches the installed aircraft.

Below is one way to submit and maintain profiles, to explore later.
FS Copilot's profiles end up owned by their first author, with no way for a later author to improve one or offer a better one, so the best work doesn't reach the profile most pilots use (from our experience with FS Copilot's profiles).
The suggestion copies [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped), which keeps the TypeScript types for npm packages:

- One canonical profile per aircraft, in one public repository.
- Changes arrive as pull requests, and each aircraft lists maintainers who review them.
- The profile IDE opens the pull request, so authors never touch git.

The analogy stops at testing: DefinitelyTyped's CI checks every change, and fsc-exerciser tests the wire but not two aircraft staying in agreement ([08-06](../../learn/foundations/08-06-divergence-and-one-screen.md#detecting-divergence-and-correcting-it)).

- **Open questions:** who reviews, and how a profile for a new aircraft version starts from the previous one.

## Ideas left out

- **Save and resume together:** few addons save and restore their own state, such as PMDG's panel states and the iniBuilds A350's autosaves (read in pmdg-aircraft-77w 2.4.143, [777 study](../aircraft/pmdg-777-300er/study.md), and inibuilds-aircraft-a350 1.2.6, [A350 study](../aircraft/inibuilds-a350/study.md)), and driving those from outside is unexplored.
- **Basic sync for aircraft without a profile:** we judge that a starter profile generated from an aircraft's input events would give little that's usable on most aircraft (unverified: nobody has tried it).
- **An activity feed for pilots:** one control can fire several events, as the PA-24's radio volume knob fired four input events in one turn ([03-03](../../learn/foundations/03-03-reading-and-writing.md#enumerating-vs-observing)), and a pilot can't read a feed of them.
  It belongs in the profile IDE.
- **Shared checklists:** checklists depend on the aircraft, and on which airline's version a crew wants.
- **Linked yokes on force-feedback hardware:** both pilots would need a force-feedback yoke, and few pilots own one (unverified).
- **An intercom routed by the aircraft's audio panel:** Discord carries the pilots' voices already, and the intercom would mean building voice capture, transport, and playback, plus mapping each aircraft's audio panel, for value nobody has evaluated.
- **Learn by demonstration in the profile IDE:** the IDE would list what changed when the author flipped a switch, and propose a profile entry.
  We set it aside while we build the core product.
- **Cockpit diff and resync:** we don't know how reliably Crosscheck can read an aircraft's state, and a resync prompt interrupts the pilots.
- **Multiplayer kept on:** other players in the session would see the shared aircraft twice, and Crosscheck can't hide anything on their machines (unverified: nobody has looked from a third machine).
  In multiplayer each pilot also sees the other pilot's copy of the aircraft (unverified: from our FS Copilot sessions), and hiding that copy would fix only the two pilots' own view.
  [Avatar sync](#avatar-sync) gives the walkaround presence that keeping multiplayer on was for.
