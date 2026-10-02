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

1. The pilot in control says "you have control", which opens a window of a few seconds.
2. If another pilot says "I have control" inside the window, control passes to them.
3. The first pilot's closing "you have control" changes nothing, so Crosscheck doesn't wait for it.

A take-control key, button, or shortcut takes control at once, without voice.
The pilot taking control hears a recorded "you have control" as confirmation.
When control passes, [soft takeover](#soft-takeover-on-handover) starts.

- **Tech:** each machine listens only to its own pilot's mic, so nothing has to work out who spoke.
  Each machine listens for a few fixed phrases rather than transcribing speech, which small local models can do on a CPU, though whether they're accurate enough is unverified.
  Windows lets Discord and Crosscheck capture the same mic at once.
  Voice only completes a handover the pilot in control started, so control moves by mistake only if both machines mishear, in order, inside the window.
- **Open questions:** accuracy with non-native English accents, which is the first thing to test.
  Which phrases to accept, since the FAA's exchange says "you have the flight controls" ([01](../../learn/foundations/01-prior-art-and-crew-practice.md#crm-callouts-and-transfer-of-control)) and crews elsewhere use others.

### Soft takeover on handover

When control passes, the new pilot in control's hardware throttle can sit far from the aircraft's throttle, and the aircraft's throttle jumps to match it.
Crosscheck ignores their axis until the lever crosses the aircraft's value, as MIDI controllers do in pickup mode, and shows where to move it.
Trim wheels and flap and gear levers on hardware have the same mismatch.

- **Tech:** masking the pilot's axis events holds them back from the sim on stock flight controls and on the PMDG 777 (measured on MSFS 2024, 2026-10-01, [log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)).
  On an aircraft whose module asks for the same priority, such as the A2A PA-24, it works only if Crosscheck's masks are in place before the aircraft loads ([log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)).
- **Product:** removes the thrust jump at handover.

### Mixed flight controls

Both pilots' hands reach the flight controls, as in a real cockpit.
The flying machine is the pilot in control's, and the following machine is the other.
The following machine still freezes its aircraft and sets it from the flying machine's position, attitude, and velocity, as FS Copilot and YourControls do ([01](../../learn/foundations/01-prior-art-and-crew-practice.md#prior-art)).
What changes is that Crosscheck takes each pilot's yoke and throttle input before the sim acts on it, sends the other pilot's axes one way to the flying machine, and mixes them there with the pilot in control's, by a rule for each aircraft type.
Where the type warns of dual input, Crosscheck does too: on an Airbus, the two sidesticks' inputs are added and a "DUAL INPUT" voice warns the crew (documented, secondary, in [01](../../learn/foundations/01-prior-art-and-crew-practice.md#crm-callouts-and-transfer-of-control)).
In FS Copilot and YourControls only the pilot in control's hardware reaches the sim, and this sends both pilots' hardware to it, so building it starts with a decision in `record/decisions/`.

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

- **Tech:** pointing in the 3D cockpit is unexplored, and the sim's checklist highlight might serve the second (unverified).

### Seat awareness

Each pilot has a seat, and their camera starts there.
Where an aircraft lists no usable seats, the profile author moves the camera to each seat, and the profile IDE's "capture position" button saves it to the profile, relative to the aircraft, with the view direction.

- **Tech:** MSFS 2024 aircraft can ship seat parts with their own navigation graphs.
  The A220 has `A220_Seat_Pilot` and `A220_Seat_Copilot` (read in synaptic-aircraft-a220 1.0.10, [files](../aircraft/synaptic-a220/files.md)), and the Phenom 300E has a passenger seat, `fsreborn_phenom300e_seat_pax` (read in fsreborn-aircraft-phenom300e 1.0.24, [files](../aircraft/fsreborn-phenom-300e/files.md)).
  Whether they hold positions Crosscheck can use is unverified.
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
Crosscheck reads where the avatar is and which way it faces, and on the other machine moves a figure to match: a person-shaped object that Crosscheck ships.

- **Tech:** SimConnect reads the avatar's position, ground speed, and facing every sim frame through `SIMCONNECT_OBJECT_ID_USER_AVATAR` (measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-the-avatars-own-object-id-gives-its-position-speed-and-facing-every-sim-frame)).
  The sim's own people stay invisible when a SimConnect client spawns them, while GSX's people show and follow a position written every frame, sliding rather than walking (same date, [avatars log](../avatars/log.md#2026-10-02-a-gsx-person-shows-and-follows-where-we-write-it-and-the-sims-own-people-stay-invisible)).
  So the figure would be a person Crosscheck ships as a SimObject with a model of its own, which means building a modeled, animated character.
- **Product:** a pilot sees the other pilot beside them on the walkaround, which FS Copilot's pilots never do: FS Copilot requires multiplayer off (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "What the receiving pilot has to do"), and with it off nothing shows the other pilot's avatar.
- **Open questions:** what makes a figure walk rather than slide, which GSX's SimObject files may show.
  How the other pilot shows in the cockpit: once a pilot is seated, the avatar's object sits 0.3m from the aircraft's reference point at the aircraft's heading (measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-the-avatars-own-object-id-gives-its-position-speed-and-facing-every-sim-frame)), and whether it turns when they look around is unmeasured.

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
