# Prior art and crew practice

- [Prior art](#prior-art)
- [CRM, callouts, and transfer of control](#crm-callouts-and-transfer-of-control)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

## Prior art

Every tool below gives the flight controls to one pilot at a time, whom we call the pilot in control, and opens the rest of the cockpit to both pilots, with JoinFS as a possible exception (unverified).
FSX and Prepar3D (P3D) built this into the sim, and MSFS 2024 "does not have the same concept of shared cockpit" [1], so FS Copilot and YourControls rebuild it from outside the sim, with a hand-written file for each aircraft.

| Tool and sim | Who is in control, and how that changes | Where the aircraft knowledge lives | How the machines connect |
| --- | --- | --- | --- |
| FSX and P3D shared cockpit | The pilot in control offers control with Shift+T, and the other pilot accepts it but can't take it [2] [3] | In the sim: an event table marks which key events are shared, and gauge code can call `is_master()` [2] [4] | The sim's own multiplayer session, for two users at most [2] |
| YourControls, MSFS 2020 and 2024 | Given with a Give Control button or taken with a Take Control button, a key bound to Toggle Launch Bar Switch does either, and an Observer button locks a pilot out [5] ([10-02](10-02-yourcontrols.md#yourcontrols)) | A YAML file per aircraft, with `shared:` and `master:` blocks and included modules [6] | A rendezvous server that sets up a direct link, a relay server, or a direct connection, on UDP port 25071 by default, that needs port forwarding or a LAN [5] |
| FS Copilot, MSFS 2024 | Either pilot takes control at once, from the app or with `K:TOGGLE_LAUNCH_BAR_SWITCH`, with no acceptance step [7] | A YAML profile per aircraft, with `master:` and `shared:` blocks and JavaScript expressions [8] | UDP hole punching through its rendezvous server, then its relay if no direct link forms within 4s [7] |
| SmartCopilot, X-Plane | The main controls, such as yoke and throttle, pass by request and release [9] | A `smartcopilot.cfg` per aircraft, in sections by direction: `[TRIGGERS]` both ways on change, `[CONTINUED]` master to slave, `[SEND_BACK]` from whoever has control [10] | Not researched |
| JoinFS, across MSFS, P3D, X-Plane, and FSX | The aircraft's owner grants cockpit entry and hands over the "flight", "engine", and "other" control groups, to different co-pilots if wanted [11] | Not researched, and the two pilots' aircraft types needn't match [11] | Peer-to-peer sessions, and hubs that list public ones [12] |

In P3D, a key event from the co-pilot goes first to the pilot's machine, and comes back to be acted on only if the event table marks it as shared [4].
Whether FSX did the same, and whether "pilot" there means the pilot in control or the aircraft's host, is unverified.
MSFS 2024's multiplayer carries only a short list of variables between aircraft (as of 2026-09-27) [1].

FS Copilot and YourControls move the flight with control: the machine of the pilot in control flies, and the other follows it.
They freeze the aircraft on the following machine with `K:FREEZE_LATITUDE_LONGITUDE_SET`, `K:FREEZE_ALTITUDE_SET`, and `K:FREEZE_ATTITUDE_SET`, and set its position from the machine of the pilot in control [5] [6] [7].
FS Copilot sends that position at most every 50ms while it changes, and plays it back 400ms late, so it can interpolate between samples [7].
SmartCopilot keeps the flight on one machine: the master computes the position whichever pilot has control, the pilot in control's yoke and throttle reach it through `[SEND_BACK]`, and the slave copies the position and runs its own systems [9] [10].
[Part 8, Synchronization](outline.md#8-synchronization-full), covers this as freeze and set.

The gaps are in the displays and in the aircraft's own systems code.
FS Copilot's display sync names the DOM element under a click and replays a click on the element with the same name, which misses every control on an SVG display, a canvas, or a WASM gauge [13].
In our fork, sending where the pointer went instead drove an A220 display drawn in SVG [14], but on a WASM gauge a forwarded click presses whatever the receiving pilot's own cursor is over [15].
YourControls syncs keypresses on a flight management computer (FMC), not the FMC's state [5].

FS Copilot and YourControls each ship their own copy of the sim's `html_ui/Pages/VCockpit/Core/VCockpit.js`, and FS Copilot's installer deletes the YourControls package from the Community folder [6] [7].

**What it changes for Dual Input.**
With no shared cockpit in the sim, Dual Input has to be the authority that FSX's sim was, deciding whose input counts and routing every other change.
Like FS Copilot and YourControls, it needs knowledge of each aircraft's variables and events, which [part 3](outline.md#3-variables-events-and-units-full) and [part 7](outline.md#7-aircraft-specific-systems-refresher) cover.
If Dual Input also replaces `VCockpit.js`, a pilot can't run it alongside FS Copilot or YourControls (unverified), and [part 6](outline.md#6-glass-cockpits-and-coherent-gt-full) covers injecting code into panels and its load-order conflicts.

## CRM, callouts, and transfer of control

A two-pilot crew splits into a pilot flying (PF), who controls the path of the aircraft, and a pilot monitoring (PM), who watches the aircraft's state, calls out deviations, and intervenes [16].
Control passes between them by a spoken exchange that leaves no doubt who is flying [20].
Callouts tell the other pilot when one goes heads down, and announce autoflight mode status and changes [16].

These roles are part of crew resource management (CRM), which AC 120-71B defines as "the effective use of all available resources" [16].
The PF is the role the tools above call the pilot in control.
The FAA's positive exchange of flight controls has three steps, with a visual check that the other pilot has the controls [20]:

1. The pilot handing over says "You have the flight controls."
2. The pilot taking over says "I have the flight controls."
3. The pilot handing over says "You have the flight controls" again.

The 1995 advisory circular that introduced the exchange also let an instructor take control without it, by announcing "I have the flight controls" [17].
Either way, AC 120-71B asks that there be "no confusion over who is PF at any time" [16].
The Flight Mode Annunciator (FMA) shows "who is doing what" in the autoflight system [16].
One of AC 120-71B's monitoring strategies is to check the FMA after every change selected on the autopilot's mode control panel [16].
On an Airbus, the two sidesticks aren't mechanically linked: simultaneous inputs are added, a "DUAL INPUT" voice warns the crew, and a priority takeover button cancels the other stick [18].
Two pilots on two machines have two sets of hardware too, which [part 8](outline.md#8-synchronization-full) covers.

**What it changes for Dual Input.**
Both machines must agree at every moment on which pilot is PF, and whether control is handed over, taken, or both is a question for part 8.
Every state a callout names, from a flap setting to an FMA mode, must match on both machines, or the PM cross-checks a different aircraft from the one the PF flies.
Callouts are spoken.
P3D's shared aircraft had a built-in voice intercom [3], and crews using FS Copilot talk over a separate voice call such as Discord [19], so whether Dual Input carries voice is an open question.

## Sources

1. Documented: MSFS 2024 SDK, [Simulation Variables, "Note On SimVars In Multiplayer"](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Simulation_Variables.htm#multiplayer).
2. Documented, about FSX: the Flight Simulator team's blog post [What is "Shared Cockpit"?](https://learn.microsoft.com/en-us/archive/blogs/engauged/what-is-shared-cockpit), 2007-11-09.
3. Documented, about P3D v2: Prepar3D Learning Center, [Multiplayer Sharing an Aircraft](http://www.prepar3d.com/SDKv2/LearningCenter/getting_started/multiplayer/multiplayer_sharing_an_aircraft.html), which gives the accept step that the FSX post leaves out.
4. Documented, about P3D v5: Prepar3D SDK, [Event IDs](https://www.prepar3d.com/SDKv5/sdk/references/variables/event_ids.html).
5. Documented: YourControls documentation, [Running](https://docs.yourcontrols.org/running) and [Syncing Expectations](https://docs.yourcontrols.org/syncing-expectations).
6. Documented, read from source: [YourControls](https://github.com/YourControls/yourcontrols) at commit 31b1706.
   The aircraft files are in `definitions/FS2024/`, the freeze is in `src/yourcontrols/src/sync/freezer.rs`, and the panel file is `scripts/build-include/2024/YourControls/html_ui/Pages/VCockpit/Core/VCockpit.js`.
7. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864.
   `readme.md` names the sim.
   `FsCopilot/Simulation/MasterSwitch.cs` and `FsCopilot/ViewModels/MainViewModel.cs` take control.
   `FsCopilot/Simulation/Coordinator.cs` samples position every 50ms and sends it only from the pilot in control.
   `FsCopilot.Bridge.Wasm/wasm_module.cpp` freezes the aircraft and interpolates, and `k_delay_sec` in `wasm_module.h` is 0.4.
   `FsCopilot/Network/HybridNetwork.cs` falls back to the relay, and `record/self-hosted-relay/docs/01-service-inventory.md` lists the rendezvous and relay listeners.
   The comment on the direct attempt in `HybridNetwork.cs` says 5s, and `DirectAttemptTimeout` is 4s; we give the constant, because it's what runs.
   `FsCopilot/Installer.cs` removes YourControls, and the panel file is `FsCopilot.Bridge/PackageSources/HTML_UI/Pages/VCockpit/Core/VCockpit.js`.
8. Documented, read from FS Copilot's source: fsc-editor, `docs/fscopilot-behavior.md`, sections "The execution split: shared vs master" and "How a change leaves this machine".
9. Documented: Sky4Crew, [SmartCopilot](https://sky4crew.com/smartcopilot/).
10. Documented: Sky4Crew, [Hangar](https://sky4crew.com/hangar/), which describes the `smartcopilot.cfg` format.
11. Documented: JoinFS manual, [JoinFS Shared Cockpit](https://www.joinfs.net/en/manual/).
12. Documented: JoinFS [home page](https://www.joinfs.net/en/) and [Support & FAQ](https://www.joinfs.net/en/support/).
13. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/01-problem.md`, "The four failure mechanisms".
14. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - Q03 PASSES: a synthetic mouse click drives a React/SVG display".
15. Measured on MSFS 2024, 2026-08-30: the same log, "2026-08-30 — A WASM gauge presses whatever the REAL cursor hovers, ignoring the coordinates we send", with the reasoning in `record/pointer-forwarding/docs/07-wasm-surface.md`.
16. Documented: FAA, [AC 120-71B, Standard Operating Procedures and Pilot Monitoring Duties for Flight Deck Crewmembers](https://www.faa.gov/regulations_policies/advisory_circulars/index.cfm/go/document.information/documentid/1030486), 2017-01-10, paragraphs 1.4, 5.2.2.4, 6.6.2.1, 6.9.1.1, 6.9.2, and 6.9.2.2.
17. Documented: FAA, [AC 61-115, Positive Exchange of Flight Controls Program](https://data.ntsb.gov/Docket/Document/docBLOB?ID=40455386&FileExtension=.PDF&FileName=FAA+AC+61_115_Positive+Exchange+of+Flight+Controls-Master.PDF), 1995-03-10, in a copy from an NTSB docket.
    Canceled in 2000 and superseded by the Aviation Instructor's Handbook, FAA-H-8083-9, according to AC 00-2.13, Appendix 2.
18. Documented, secondary: Wikipedia, [Side-stick](https://en.wikipedia.org/wiki/Side-stick), not an Airbus manual.
    It quotes Airbus Safety First #03 (December 2006), which we couldn't open, and nothing here covers the A220, which Bombardier designed.
19. Documented in our record: FS Copilot fork, `record/traffic-atc/docs/01-design.md` and `record/traffic-atc/docs/index.md`.
20. Documented: FAA, [Airplane Flying Handbook, FAA-H-8083-3C, chapter 1](https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/airplane_handbook/02_afh_ch1.pdf), page 1-15.

## Unverified claims

- **In FSX, a co-pilot's key event made the same round trip as in P3D.**
  Only the P3D v5 SDK describes it [4], and it says "pilot" and "co-pilot" without saying whether the pilot is the one in control or the aircraft's host.
  The FSX SDK's event documentation, or a two-machine FSX session, would settle it.
- **JoinFS's aircraft owner keeps the controls it hands over.**
  The manual says the owner can "hand over" the "other" group [11], but not whether the owner can still use it.
  A JoinFS session, or its source, would settle it.
- **A pilot can't run two packages that both replace `VCockpit.js`.**
  FS Copilot's installer deletes the YourControls package without saying why [7], and our record says whichever copy the sim resolves last wins, by a load order we don't control (FS Copilot fork, `record/pointer-forwarding/docs/10-module.md`), but nobody has installed both and watched.
  Installing FS Copilot's and YourControls' packages together, then reading which `VCockpit.js` a panel loaded through the Coherent debugger, would settle it.
