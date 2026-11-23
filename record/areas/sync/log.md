# Sync: log

What our experiments and the build's stages found about keeping cockpits in sync, through profile entries, live sync, and catch-up, newest entry first.
The probes are in [experiments/areas/sync](../../../experiments/areas/sync), and their raw output is in its `results/` folder.
Every entry of 2026-10-05 was measured on MSFS 2024 SunRise 12.2.282174.999, on our development machine with Flow Pro 26.33.5, ChasePlane 2026.39.1.16, and GSX Pro 4.0.19 installed, with the frame rate capped near 30 fps unless the entry says otherwise.

## 2026-11-23: A catch-up crawls when its writes never land, since each toggle, stepping write, or write function waits out the 1.5s check of the write before it

**Asked:** [stage 22g](../build/plan.md#22g-the-extension-in-the-sim)'s session in the sim on 2026-11-23, run by `tools/sim/authoring.ts`, had a real core flying the Black Square Baron 58P Professional host, and a bench core on a stand-in join as the second pilot.
It stopped because the second pilot's catch-up at preflight's end didn't end within the script's 20s, and the second pilot's core logged 33 "a write never landed", such as `com1_spacing` wanted 1 and read 0.
Was it the stage's move of state sync's routes into the platform crate `sim-variables`?

**Expected:** a regression in `sim-variables` on the second pilot's machine, which the bench missed because its two stand-ins start alike, so a crew's catch-up at preflight's end wrote nothing.

**Found:** no regression.
The stand-in takes none of the 58P's `K:`, `B:`, or `H:` writes: no rule of the script's takes them, and its only input events are the battery and the beacon.
So none of the catch-up's writes could land, though the second pilot's recording shows each one sent.
Since [stage 14c](../build/plan.md#14c-two-coupled-writes-in-one-input), a catch-up's toggle, stepping write, or write function waits while another entry has a value pending, and each later write waits behind it ([05-units](05-units.md)).
Each toggle, stepping write, or write function waited out the 1.5s check of the write before it, and the writes that set a value, queued behind it, went in the same frame it did, so the 33 flags came in 13 steps about 1.5s apart, over 19.9s from the catch-up's start ([results](results/2026-11-23-catch-up-behind-writes-that-never-land.txt)).
Stage 14's session, run by `tools/sim/state-sync.ts`, ended its catch-up within the same 20s because it ran before stage 14c, when no catch-up write waited: every write went out at once, and a catch-up counts an entry made once its write goes out, landed or not.

A new bench case loads the pilot flying with values the pilot monitoring lacks on every route, and the pilot monitoring's stand-in takes each write: its catch-up ended 333ms after preflight's end, and 327ms on a rerun.
With the stand-in's rules taken out, a toggle of a lamp never landed, the writes behind it waited its 1.5s check, and the catch-up took 1,744ms.
Later that night we ran the session in the sim twice with the script waiting up to 90s, and the second pilot's catch-up took 24.6s and 26.1s ([results](results/2026-11-23-catch-up-behind-writes-that-never-land.txt)).

In the sim, on a following machine, a catch-up's toggle, stepping write, or write function waits 1.5s the same way behind a write the aircraft never takes, unless that write is to an entry the pilot flying owns, which holds nothing (read in the code, unverified in the sim).

**Changed:** `state-sync`'s bench scenario has the new case, and `tools/sim/authoring.ts` waits up to 90s for the catch-up and skips the cases on state sync's routes if it never ends.
The user took the wait behind a write that never lands as a known limit of stage 14c on 2026-11-23.

**Affects:** [the sync units](05-units.md)' stage 14c note, which names the known limit, and stage 22g's session.

## 2026-11-21: `h-events` went to two panels whose instruments share a key, since state sync knew its panel only by its keys

**Asked:** in one run during [stage 22c](../build/plan.md#22c-the-formats-audit), the bench's `clients-panels` scenario sent state sync's `h-events` to panels 18 and 19, and it passed on a rerun; stage 22c's changes touch neither the clients crate nor how panels are answered, so what sent it to two panels?

**Expected:** a race in the clients crate, such as two panels answered in one input before the first answer was recorded.

**Found:** no race.
State sync's rule gave `h-events` to the first panel it was asked about after the load, then to any panel whose instruments' keys included every key of that panel's, so a reloaded panel, or one that joined again naming an instrument the sim created after its `hello`, got it back ([the entry of 2026-11-10](#2026-11-10-stage-14s-code-review-found-a-catch-up-answered-with-no-values-a-preset-fired-again-after-a-gap-and-a-stream-stalled-by-an-unload)).
The scenario's panels 18 and 19, `VCockpit78` and `VCockpit79`, each hold one instrument keyed `GNS_DISABLED`, as two of the Baron's panels do ([core log](../core/log.md#2026-10-22-stage-5s-bridge-loads-in-all-20-of-the-barons-panels-joins-the-core-on-a-sessions-announcement-and-leaves-the-cockpit-whole-when-bridgejs-is-missing-or-throws-but-two-panels-shared-an-instrument-key)).
The clients crate answers the panels in the order their sockets opened, and in the failing run `VCockpit79` opened first, so `VCockpit78`'s keys matched and both panels got the module ([results](results/2026-11-21-h-events-two-panels.txt)).
A run passes whenever neither of the two opens first.
A new case with only two such panels fails every run, since one of the two always opens first, and it failed in the one run before the fix, at 071f1768, where the 20-panel case failed again with `VCockpit79` first again ([results](results/2026-11-21-h-events-two-panels.txt)).
Read in the code, a panel with no instruments answered first would have given the module to every panel, since the rule asked only that a panel's keys include each key of the first panel's, and that panel had none.

In the sim, the same would happen in the Baron whenever one of its two `GNS_DISABLED` panels opens its socket first, and each `H:` event would then reach state sync twice (unverified).

**Changed:** the clients crate puts a panel module registered with `one_panel_module` in a panel's `load` only if the module's rule picks some of that panel's instruments and no other open socket was answered with it, so the first such panel answered keeps it until its socket closes (user, 2026-11-21).
A reloaded panel's new socket names the panel, so the clients crate closes the old socket before it answers the new one, and the new one gets the module, by the name that already decides a replacement.
State sync registers `h-events` that way, and its rule remembers no panel.
With the fix, `clients-panels`, `state-sync`, and `pointer-sync` passed 28 of 28, the 20-panel case with `VCockpit79` first again ([results](results/2026-11-21-h-events-two-panels.txt)).
This rests on a reloaded panel keeping its name, which [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#left-open) leaves open: if the sim renames it, the reloaded panel goes without `h-events` until the next load, where the old rule, matching keys, would have given it back.

**Affects:** [the sync units](05-units.md) and [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md), each with a note at its top, and [stage 14d](../build/plan.md#14d-h-events-in-one-panel).

## 2026-11-19: No route showed an autopilot event's effect in the frame it was sent, so a guard in the sim reads the old mode, and the events of one frame apply in the order sent

**Asked:** for [stage 14c](../build/plan.md#14c-two-coupled-writes-in-one-input), how soon can the sim read the effect of a `K:` event, sent through SimConnect as the core sends it, through our WASM module's calculator code or its Events API, or from a cockpit panel?
Does the race of [the first flight with friends](#2026-11-16-the-drift-after-a-handover-was-the-hosts-heading-bug-which-no-write-moved-after-its-first-and-every-_set-preset-that-missed-took-the-value-of-its-first-call) happen again, `K:AP_ALT_HOLD` then `K:AP_PANEL_VS_HOLD` from vertical speed mode?
Does `K:AP_PANEL_VS_HOLD` guarded by its own variable in calculator code, as FS Copilot's 58P profile guards it, leave altitude hold on?
In which order does each route apply two events sent together?

**Expected:** no source either way; the guard was the idea stage 14b left for this stage, and it works only if the sim applies the first event before the guard reads.

**Found:** on MSFS 2024 on our development machine, 2026-11-19, in bksq-aircraft-baronpro 0.1.1 at a stand with its engines running, at about 70 fps, through p33, which has our module run calculator code and key events a frame at a time ([p33-frame-order](../../../experiments/areas/sync/p33-frame-order/probe.mjs), [results](../../../experiments/areas/sync/results/p33-frame-order-2026-11-19-19-17-58.txt)).
The KFC 150 took vertical speed mode and altitude hold on the ground with the autopilot off.
The pilot flipped the compass's slave switch once or twice during the run, which drives the heading indicator, not the vertical modes.

- **No route showed `K:AP_ALT_HOLD`'s effect in the frame it was sent:**

  | Route | First reading of altitude hold on and vertical speed mode off |
  | --- | --- |
  | Our module's calculator code | 2 or 3 of our module's frames later, 31ms to 41ms, and not in the same code or in a second call in the same frame |
  | Our module's Events API | 2 frames later, 27ms to 30ms |
  | SimConnect | in SimConnect's 2nd frame after the send, 27ms to 29ms, and in our module's 1st, 12ms to 14ms |
  | A cockpit panel | in its 2nd animation frame, 41ms to 42ms |
- **A guard in calculator code read vertical speed mode as still on**, 15 of 15, whether it ran in the same code as `K:AP_ALT_HOLD`, in a second call in the same frame, in our module's next frame, after the Events API's key, or after SimConnect's send.
  So it fired the toggle each time, and each run ended with both modes off.
- **The race left both modes off**, 15 of 15, through SimConnect back to back, our module's calculator code in one call and in two, its Events API, and a panel.
  In the flight it left vertical speed mode on, which fits the two events landing in different frames, the second after the first had turned vertical speed mode off (unverified).
- **Two events sent together applied in the order sent**, 2 of 2 through each of SimConnect, our module's calculator code, and a panel: `K:AP_ALT_HOLD_ON` then `K:AP_VS_OFF` left both modes off, and `K:AP_VS_OFF` then `K:AP_ALT_HOLD_ON` left altitude hold on.
  `K:AP_VS_OFF` alone turned altitude hold off, 2 of 2, so the KFC 150's own on and off events undo each other too, depending on their order.
- `K:AP_PITCH_LEVELER_ON` then `K:AP_PANEL_VS_HOLD`, as state sync sends a press of VS from altitude hold, left vertical speed mode on, 2 of 2, as wanted.
- Other events showed sooner: `K:HEADING_BUG_SET` and `B:INSTRUMENT_Heading_Bug_Set` from calculator code read back in our module's next frame, and `(B:LIGHTING_TAXI_1)` read the taxi light's new position in the same code as its toggle preset, while `A:LIGHT TAXI` followed a frame later.
- p31's single run of the race from a panel left altitude hold on ([that entry](#2026-11-17-a-preset-called-with-a-value-from-our-wasm-module-took-only-its-first-value-and-from-a-panel-it-took-every-one)), against both off in each of these 3; p31 sent `K:AP_PANEL_VS_HOLD` with 0 rather than 1, in the air with the autopilot on, and which of those made the difference is unknown.

So a toggle guarded in the sim decides from the same old reading as a toggle the core decides, unless something holds it until the event before it shows its effect.

**Changed:** the sync engine holds a write that decides from the cockpit's readings, a `toggle`, a stepping write, or a write function, while another entry has a value pending, and makes it from the readings once that value reads back (user, 2026-11-19).
The user picked that over our module holding a guarded event 3 frames, which would have sent every `K:` write through our module and still left `instrument()` entries and write functions that read `state` unguarded.
On the bench, the `state-sync` scenario's case of the two modes, with the stand-in's rules for them, failed with the hold taken out, the other machine's altitude hold ending off, and passed with it, 12 of 12 ([results](results/2026-11-19-stage-14c-bench.txt)).

**Affects:** [stage 14c](../build/plan.md#14c-two-coupled-writes-in-one-input) and [05-units](05-units.md), with a note at its top.

## 2026-11-18: In stage 14b's session the 58P took every preset value and its heading bug followed, and as it took control its own trim fell and it banked, after our trim write went out

**Asked:** in [stage 14b's session](../../../tools/sim/handover.ts), with [the fix below](#2026-11-17-fsvarsbvarcall-with-a-value-jams-the-input-event-for-the-rest-of-the-flight-and-calculator-code-from-our-module-doesnt) in, does the Baron 58P take every value a second pilot sets through its `_Set` presets with no flag, and after a handover in heading mode does it fly straight on with its trim at the second pilot's?

**Expected:** both, since the presets go as calculator code, the heading bug's function returns what the 58P reads, and the machine taking control writes the trim at the old PF's last value.

**Found:** on MSFS 2024 on our development machine, 2026-11-18, in bksq-aircraft-baronpro 0.1.1, in two runs, with the real core flying the 58P and a bench core on a stand-in as the second pilot ([results](results/2026-11-18-stage-14b-session-in-the-sim.txt)).

- **The presets took every value, and nothing was flagged**, in each run: the heading bug 6 of 6, `INSTRUMENT_Altimeter_1_Set` 4 of 4, and the cabin heat handle 5 of 5, each read back within 302ms.
- **The heading-bug preset rounds to the nearest 1/16,384th of a turn**: 100° read back as 99.997559° and 253° as 252.993164°, where rounding up gives 100.019531° and 253.015137°, so the profile's function returns what the 58P reads.
- **The 58P's heading bug followed the second pilot's to 225°**, so it took control with its bug on the course it flew, which the jammed bug of [the first flight with friends](#2026-11-16-the-drift-after-a-handover-was-the-hosts-heading-bug-which-no-write-moved-after-its-first-and-every-_set-preset-that-missed-took-the-value-of-its-first-call) didn't.
- **As the 58P took control, its own trim fell and it banked left.**
  From the frame flight-model sync's `Follow` let it go, its elevator trim fell 6.67% each panel frame, about 15 frames a second, from -8.33% to -77.21% in the first run and -61.78% in the second, then rose again at about that rate, for 4 frames to -55.34% in the first and 6 frames to -27.75% in the second.
  A left bank started in the same frame and reached 16.0° in the first run and 23.8° in the second, in which the 58P turned up to 15.6° and lost 128 ft in 15s.
- **State sync's write at the handover went out**: run 2's recording, replayed with a log line where the write goes, shows the real core writing the trim at the second pilot's -5% as control reached it, with the 58P reading -6.67%.
  The `state-sync` bench case of that write passes too, on a stand-in sim, which has no autopilot to move the trim.
- While following, the 58P's trim read -11.67% to -8.33% in both runs against the second pilot's -5%, as its autopilot trimmed the aircraft `Follow` froze and state sync put it back.
- **The first run's dive of 829 ft came from the script**: it engaged the second pilot's altitude hold in the same change as the jump to 3,100 ft, and the 58P's autopilot held 300 ft after the run, likely the altitude the 58P had reached on the way up as the mode engaged (unverified).
  The second run engaged it 3s after the 58P reached 3,100 ft, and the 58P's autopilot held 3,100 ft.
- Both recordings replayed with every checkpoint matching, 223 and 101.

So the trim and bank move after the handover write, from something in the 58P, likely its autopilot, wound up while it couldn't move the aircraft `Follow` froze (unverified).

**Changed:** the trim and bank as a following 58P takes control are a known limit of stage 14b and the work of [stage 16c](../build/plan.md#16c-trim-and-bank-after-a-handover), so 14b's exit drops "flies straight on" (user, 2026-11-18).
The session's script engages the second pilot's autopilot once the 58P has reached its altitude.

**Affects:** [stage 14b](../build/plan.md#14b-state-syncs-writes-that-read-another-value) and [stage 16c](../build/plan.md#16c-trim-and-bank-after-a-handover).

## 2026-11-17: `fsVarsBVarCall` with a value jams the input event for the rest of the flight, and calculator code from our module doesn't

**Asked:** after [p31's session](#2026-11-17-a-preset-called-with-a-value-from-our-wasm-module-took-only-its-first-value-and-from-a-panel-it-took-every-one), does a panel's call land after our module has called the same preset, and does our module's calculator code, the way FS Copilot's module calls presets, land each value when nothing has called the preset through `fsVarsBVarCall` first?

**Expected:** the panel's calls to land either way, and no expectation for calculator code, since p31 tried it only on a preset `fsVarsBVarCall` had already called.

**Found:** on MSFS 2024 on our development machine, 2026-11-17, in bksq-aircraft-baronpro 0.1.1 parked at a stand, with no core running, through presets.patch, which has our module call a preset when an `L:` variable tells it to ([p32-presets](../../../experiments/areas/sync/p32-presets/check.ts); [first run](../../../experiments/areas/sync/results/p32-presets-2026-11-17-18-41-22.txt), [second run](../../../experiments/areas/sync/results/p32-presets-2026-11-17-18-57-29.txt)).

- **`fsVarsBVarCall` with a value lands once and then jams the input event for the rest of the flight**, for every caller.
  Its own call landed on all four presets: on `INSTRUMENT_Heading_Bug_Set`, `INSTRUMENT_Altimeter_1_Set`, and `PASSENGER_Cabin_Heat_2_Set` after two panel calls had landed, and on `INSTRUMENT_Altimeter_2_Set` as the first call.
  None of the calls after it moved the control, whether from our module, from a panel, or as our module's calculator code: 25 on the heading bug, 5 each on the altimeter and the cabin handle, and 3 on `INSTRUMENT_Altimeter_2_Set`.
  The pilot saw the heading bug's knob stuck in the cockpit too, and loading the flight again cleared it.
  So the entry below was wrong that a preset called with a value from a WASM module takes only its first value through either API: p31's route 0 called `fsVarsBVarCall` first and jammed the input event, and its fresh IDs and calculator code came after.
- **Calculator code from our module took every value** in the second run, after loading the flight again had cleared the jam: `INSTRUMENT_Heading_Bug_Set` 8 of 8, and `PASSENGER_Cabin_Heat_3_Set` 8 of 8 with a panel's calls between them, each read back 931ms to 936ms after the call, the script's round trip.
- **A panel's calls took every value with no `fsVarsBVarCall` before them**: `INSTRUMENT_Altimeter_1_Set` took all 4 values in its range, and each of the 16 beyond it read back at the nearer limit, 948 or 1084, which match 28 and 32 inHg in hPa, and which the probe printed as `MISSED` ("4 of 20 landed").
- `LANDING_GEAR_ParkingBrake_Set` 1 never landed from either route, so something held the brake released; that preset reads nothing here.
- FS Copilot's profile for the 58P Press writes the heading bug, both altimeters, the gear, and the cabin handles through these presets as calculator code from its module (read in the FS Copilot profiles, `definitions/bksq-aircraft-baronpropress.yaml`), and the user never saw them jam in FS Copilot.

**Changed:** the user decided stage 14b's fix (user, 2026-11-17):

1. Our module calls every preset as calculator code, with or without a value, as it fires `H:` events, and drops `fsVarsBVarCall` and the IDs it kept.
2. As control passes to a machine, it writes each PF-owned entry at the old PF's last value, and a following machine doesn't check those entries' writes; flight-model sync carrying the trim in its sample waits, in case a trim wheel that drifts while following bothers pilots.
3. The autopilot's vertical speed target and the KAS 297B's armed vertical speed stay shared, a known limit.
4. Two coupled toggles undoing each other goes to [stage 14c](../build/plan.md#14c-two-coupled-writes-in-one-input), since a write decides in the core from the last reading where FS Copilot's calculator code decides in the sim, and that wants experiments first.
5. The engine flags each write that never lands, and the notification stays once per entry for each load.
6. A state entry's write function may return the value its entry will read once the write lands, which the engine waits for in place of the value it gave, so the 58P's heading bug returns its value rounded to the nearest 1/16,384th of a turn (unverified against rounding up, which a written 1° fits too).

**Affects:** [stage 14b](../build/plan.md#14b-state-syncs-writes-that-read-another-value), [05-units](05-units.md), [04-order-and-recovery](04-order-and-recovery.md), [02-live-sync](02-live-sync.md), [01-profile-entries](01-profile-entries.md), [the sim seam](../core/03-sim-seam-and-wasm-module.md), and [the profile format](../profiles/01-format-and-delivery.md), each with a note at its top.

## 2026-11-17: A preset called with a value from our WASM module took only its first value, and from a panel it took every one

**Asked:** in [p31's session](../../../experiments/areas/sync/p31-handover/session.ts), with the real core flying the Baron 58P and a bench core on a stand-in as the second pilot, does a `_Set` preset with a value keep the value of its first call through our module, whichever way the module calls it; does the drift happen again; and do the KFC 150's own on and off events set its modes?

**Expected:** the first value to stick through the ID our module keeps, and not through a fresh ID or calculator code, from [the replays](#2026-11-16-the-drift-after-a-handover-was-the-hosts-heading-bug-which-no-write-moved-after-its-first-and-every-_set-preset-that-missed-took-the-value-of-its-first-call).

**Found:** on MSFS 2024 on our development machine, 2026-11-17, in bksq-aircraft-baronpro 0.1.1 ([report](../../../experiments/areas/sync/results/p31-handover-2026-11-17-17-57-21.txt), [the check from a panel](../../../experiments/areas/sync/results/p31-heading-bug-from-a-panel-2026-11-17.txt)).

- **From our module, `B:INSTRUMENT_Heading_Bug_Set` took its first value, 45°, and none of the 14 after it**, through each of three routes: the ID the module keeps, an ID looked up for each call, which the sim gave as the same 608, and calculator code, `90 (>B:INSTRUMENT_Heading_Bug_Set)`.
  `fsVarsBVarCall` returned 0 for every call, and our module made one call for each write.
- **From a cockpit panel, in the flight loaded again with no call from our module, the same preset took every value**, 180°, 270°, 45°, and 225°, each within 133ms, and `K:HEADING_BUG_SET` took 100°, 200°, 135°, 300°, and 90°.
- So the module's ID isn't the cause: a preset called with a value from a WASM module takes only its first value, through either API, and why is unknown (unverified whether that holds for each sim run, each flight, or each preset).
- **The gear handle and the parking brake read nothing either way**: the pilot's hardware, whose controls the sim had bound by itself, put each back between writes, so each preset was only ever called with one value.
- **The drift happened again**: with route 0, the 58P took control in heading mode with its bug at 45° while it flew 225° magnetic, and in 15s it turned 16° and banked up to 41°.
  Neither handover's flight says more, since the 58P lost 1,993 ft in the first and 3,133 ft in the second, each in 15s.
- **The following 58P's autopilot ran its elevator trim to full nose-down** while it followed, which the pilot watched, reading between -33.3% and -21.9% over one 10s window; the stand-in's trim never changed, so no arrival pulled it back, and putting the trim back didn't hold it.
  That trim is the likeliest cause of the dives after each handover (unverified).
- **The vertical modes didn't undo each other this time**: altitude hold back with vertical speed mode off, in one change, left the following 58P in altitude hold, and the second pilot's vertical speed target stayed at the 500 fpm it set.
- **The KFC 150 takes each of its on and off events**: `K:AP_ALT_HOLD_ON` and `_OFF`, `K:AP_VS_ON` and `_OFF`, `K:AP_HDG_HOLD_ON` and `_OFF`, `K:AP_NAV1_HOLD_ON` and `_OFF`, `K:AP_APR_HOLD_ON` and `_OFF`, and `K:AP_BC_HOLD_ON` and `_OFF`, each within 1s.
  `K:AP_ALT_HOLD_ON` and `K:AP_VS_OFF` in one frame left both modes off.
- The real core's recording replayed with all 469 checkpoints matching.

**Changed:** nothing yet; route.patch is out of the tree, and the design goes to the user.

**Affects:** [stage 14b](../build/plan.md#14b-state-syncs-writes-that-read-another-value).

## 2026-11-16: The drift after a handover was the host's heading bug, which no write moved after its first, and every `_Set` preset that missed took the value of its first call

**Asked:** for [stage 14b](../build/plan.md#14b-state-syncs-writes-that-read-another-value), what do the two recordings of [the first flight with friends](#2026-11-12-in-the-first-flight-with-friends-14-of-state-syncs-writes-read-another-value-15s-later-11-on-the-following-machine-the-elevator-trim-and-autopilot-modes-among-them) show of each write state sync made, around each handover, and of the drift after one?

**Expected:** one of the three leads in that entry: the following sim's own autopilot, the 58P profile's entries, or the check's 1.5s.

**Found:** on our development machine, both recordings replayed with every checkpoint matching, on a build of the release 0.1.0's code with log lines added in state sync for each reading, arrival, catch-up entry, and action, and in flight-model sync for the flying aircraft's samples ([results](results/2026-11-16-flight-with-friends-replayed-writes.txt)).
The host is the pilot who hosted, on the other PC, and the joiner is the pilot on our development machine.

- **The drift was the heading bug.**
  The host's `A:AUTOPILOT HEADING LOCK DIR:1` read 0° at the load and 1.01° after state sync's first write through `B:INSTRUMENT_Heading_Bug_Set`, and none of the 39 writes after that moved it.
  The joiner turned its bug to 252° and flew 253° true in heading mode.
  At control's 13th change the host took control in heading mode, and in 11s its aircraft rolled into a right bank of up to 53° and turned from 253° to 309° true, toward its own bug.
  At the 14th the joiner took control back with the host's 1.01° in its own bug, which its catch-up at the 13th had written, and it turned on.
- **The check flagged the bug once, on a write that only looked wrong.**
  The `_Set` preset turns degrees into 1/16,384ths of a turn, `p0 dnor 360 / @16k * (>K:2:AP_HEADING_BUG_SET_EX1)` (read in MSFS 2024 SDK 1.8.1, `ModelBehaviorDefs/Asobo/Common/Subtemplates/Instrument_Subtemplates.xml`), so a written 1° reads back as 46/16,384 of a turn, 1.0107°.
  The engine flags an entry once for each load, so that flag was the heading bug's only line, and the 39 writes that never landed after it left none.
- **Every `_Set` preset that missed took the value of its first call through our module** (unverified as the cause: the logs show the readings, not the calls):

  | Machine | Preset | First call | Later calls |
  | --- | --- | --- | --- |
  | Host | `INSTRUMENT_Heading_Bug_Set` | 1.0, landed | 39, each another value, none landed |
  | Host | `LANDING_GEAR_Gear_Set` | 0, landed | 1 twice, neither landed |
  | Host | `LANDING_GEAR_ParkingBrake_Set` | 1, landed | 1 eleven times, each landed |
  | Joiner | `LANDING_GEAR_ParkingBrake_Set` | 0, landed | 0 twelve times, each landed; 1 twice, neither landed in 1.5s |
  | Joiner | `INSTRUMENT_Heading_Bug_Set` | 1.0107, landed | 1.0107 twice, each landed |

  Our module looks a preset's ID up at its first call and calls the ID it keeps after that, so the ID or the sim's handling of a kept one may hold the first value; a session in the sim settles which.
  On the joiner, something set the parking brake again within 100ms of each write that released it, which fits SPAD.neXt, running on our development machine during the flight, holding a hardware switch's position (unverified).
- **Altitude hold and vertical speed mode undid each other on the following machine.**
  The flying machine's change from vertical speed mode to altitude hold arrives as two changes in one input.
  `ap_altitude_hold`'s function sends `K:AP_ALT_HOLD`, which turns vertical speed mode off, and `ap_vs_hold`'s `toggle` then reads vertical speed mode as still on and sends `K:AP_PANEL_VS_HOLD`, which turns it back on and altitude hold off.
  The host was left in vertical speed mode at 0 fpm while the joiner held altitude, twice, and took control 35s after the second.
- **A following machine's autopilot sent its own targets to the flying machine.**
  Vertical speed mode engaging on the host set its target to 100 fpm and then 400 fpm, likely the host's own climb rate (unverified), and the host's KAS 297B armed the same, and the host sent each as its pilot's change.
  The joiner wrote them into its autopilot, where 400 fpm landed, so the following machine changed the flying pilot's targets.
  [Ignoring a consequence](01-profile-entries.md#ignoring-a-consequence) says a consequence that's a readable state entry needs no `ignore`, since a value written twice stays the same, and this one isn't written twice: each machine computes its own.
- **The following machine's autopilot trims its frozen aircraft.**
  Putting the trim back kept the host's elevator trim near the joiner's, but no reading ever equaled a written value, so it was flagged once, reading -16.33% 1.5s after a write of -5.79%, while the joiner's own autopilot trimmed too.
  The drift came from the heading bug, not the trim.
- **The nav mode didn't take on the host**, with both autopilots' masters off, and the joiner's nav mode turned off 1.5s later, so both machines ended the same.
- **The cowl flaps' catch-up writes at preflight's end** missed on the joiner, and their two later writes landed; why is unknown.

So none of the three leads holds the drift's cause, which is how the presets took their values.
Of the other misses, the profile's toggles caused the modes' misses, and the following sim's autopilot caused the trim's and sent its own targets.
The check's 1.5s caused none, though flagging once for each load hid the heading bug's misses.

**Changed:** nothing yet.
A session in the sim, `experiments/areas/sync/p31-handover/session.ts`, calls each preset through three routes, our module's kept ID, an ID looked up for each call, and calculator code, makes the drift happen again, and tries the KFC 150's own on and off events for each mode.

**Affects:** [stage 14b](../build/plan.md#14b-state-syncs-writes-that-read-another-value), whose design rests on that session.

## 2026-11-12: In the first flight with friends 14 of state sync's writes read another value 1.5s later, 11 on the following machine, the elevator trim and autopilot modes among them

**Asked:** in [stage 16](../build/plan.md#16-flight-model-sync)'s first flight with friends, two pilots on two PCs in one Baron 58P through 13 handovers, does state sync keep the two cockpits the same, and does a `_Set` preset with a value, `B:LANDING_GEAR_ParkingBrake_Set`, set the other pilot's parking brake?

**Expected:** the cockpits to match as they did in stage 14's session in the sim, where the second pilot was a bench core's stand-in.

**Found:** on MSFS 2024 SunRise 12.2.282174.999 on both PCs, from 2026-11-11 23:18 to 2026-11-12 00:06 local, with the release 0.1.0 of [the flight-model log's entry for the flight](../flight-model/log.md#2026-11-12-two-pilots-on-two-pcs-flew-one-58p-smoothly-through-13-handovers-over-a-relayed-link-and-after-a-handover-with-the-autopilot-engaged-the-aircraft-drifted).
The pilots saw the cockpits follow each other through the flight, the parking brake each way among them.
The two cores' logs hold 14 lines `a write never landed`, each a write whose watch read another value 1.5s after it, the sync engine's `CHECK`, and each raised a "Couldn't sync" notification, with the values in each entry's own unit, the trim's in percent:

| Entry | Machine | Flying or following | Wanted | Read |
| --- | --- | --- | --- | --- |
| `cowl_flap_1`, `cowl_flap_2` | joiner's | following, in the catch-up at preflight's end | 16384 | 0 |
| `parking_brake` | joiner's | following | 1 | 0 |
| `kas_armed_vs` | joiner's | flying | 2000 | 1000 |
| `elevator_trim` | joiner's | following, 1.8s after a handover | -12.45 | -15.07 |
| `ap_vertical_speed` | joiner's | flying | 100 | 0 |
| `heading_bug` | host's | flying | 1.0 | 1.0107 |
| `kas_arm` | host's | following | 0 | 1 |
| `kas_armed_vs` | host's | following | 1200 | 1000 |
| `gear` | host's | following | 1 | 0 |
| `elevator_trim` | host's | following | -5.79 | -16.33 |
| `ap_nav_mode` | host's | following | 1 | 0 |
| `ap_altitude_hold`, `ap_vs_hold` | host's | following | 1, 0 | 0, 1 |

- **After a handover with the autopilot engaged the aircraft drifted, mainly sideways**, the pilot who watched it said, and thought the trim was off.
  The host's machine hadn't taken the nav mode 67s before it next took control, nor altitude hold in place of vertical speed hold 41s before, so it may have taken over in other modes than the pilot who handed over flew in (unverified: the log has no later reading of those entries).
- **Some notifications showed for controls that looked in sync**, the pilots said, the altitude arm and the vertical speed mode among them.
  The check reads once, 1.5s after the write, so a value that lands later is flagged though it lands (unverified which of the 14 did).
- The aileron and rudder trims, written straight to `A:AILERON TRIM PCT` and `A:RUDDER TRIM PCT`, have no such line.

We don't know the cause, and three leads fit what the logs show, none verified:

- The following sim runs its own autopilot on its frozen aircraft, which trims and holds modes against what we write: `elevator_trim` read -15.07 and -16.33 on the two following machines against wanted values 2.6 and 10.5 percent of trim away.
- The 58P profile's entries: `ap_nav_mode` and `ap_vs_hold` write a toggle, `ap_altitude_hold` writes one of two events by the state it last read, `kas_armed_vs` steps by 100 and skips while vertical speed hold is on, and `heading_bug` missed by 0.01°, which may be the preset's rounding.
- The check's 1.5s, for a control that takes longer on a following machine.

Each pilot's recording holds every reading both cores took, so replaying them would give each entry's values around each handover.

**Changed:** nothing in the code or the profile.
Finding the cause is work of its own after stage 16 (user, 2026-11-12).
The parking brake's `_Set` preset with a value, the case stage 14 left, held by eye each way, with one logged miss on the joiner's machine, the table's `parking_brake` row.

**Affects:** none yet.

**Evidence:** the two cores' logs in the flight-model area's results, [the joiner's](../flight-model/results/2026-11-11-flight-with-friends-pilot-a-core-log.txt) and [the host's](../flight-model/results/2026-11-11-flight-with-friends-pilot-b-core-log.txt).

## 2026-11-10: Stage 14's code review found a catch-up answered with no values, a preset fired again after a gap, and a stream stalled by an unload

**Asked:** does stage 14's code hold against its plan stage, [the sync units](05-units.md), and the repository's rules, as the `code-reviewer` agent reads it?

**Expected:** a few comment fixes, since the bench and the sim session had passed.

**Found:** six faults neither had reached, each read in the code:

- A catch-up asked before the pilot flying's profile loaded was answered in the same input as the load, before any watch had read, and `give` leaves out an entry with no reading, so the answer held only counting entries' defaults.
  A pin that goes from none to a bundle after an airborne start loads both profiles at once, so the follower's ask can reach the pilot flying first.
- The routine host drops a routine left unfed for 1s, and the core's next rewrite of the same feed starts it again on that feed, so `NamedEvents` would fire its last batch a second time, and a `_Toggle` preset fired twice puts the switch back.
- A profile unloaded while a stepping write ran left the stream waiting on that arrival for the rest of the session, holding every later cockpit message, pointer sync's among them.
- `h-events` went to no panel once its panel joined again naming an instrument the sim created after its `hello`, so every `H:` entry stopped syncing.
- A failed `instrument()` path told the pilot "Couldn't sync" with the entry's key, such as `radar_alert`, rather than its name.
- `h-events` loaded only for a profile with an `H:` event entry, though a counting entry can count `H:` events.

It also found that no `_Set` preset with a value has been written into a cockpit: the session wrote only `_Toggle` presets, so whether `fsVarsBVarCall` takes a `_Set`'s value as one double is unmeasured, and the Baron's heading bug, altimeters, gear, parking brake, and cabin heat write through `_Set`.

**Changed:**

- State sync's catch-up step turns ready 1.5s after the load, the engine's check, by which every watch has read.
- A routine can say each feed is carried out once, as `NamedEvents` does, and the host then starts it again after a gap without that feed.
- State sync counts each stepping write's arrival applied as its profile unloads.
- `h-events` goes to the panel whose instruments include every one it was given before.
- The notice names the entry, and `h-events` loads for a counting entry's `H:` events too.
- [Stage 16](../build/plan.md#16-flight-model-sync)'s session in the sim writes a `_Set` preset with a value.

**Affects:** [the sync units](05-units.md) and [the code map](../architecture/02-code-map.md), each with a note at its top.

## 2026-11-10: The SDK's H: event call fails on MSFS 2024, so our module fires H: events as calculator code, which reached every panel

**Asked:** why did no aircraft take an `H:` event our module fired, in the session of the entry below, and which way of firing one reaches the cockpit?

**Expected:** that our call lacked something, such as a parameter array, since the SDK's own `SimUtils/HEvent.cpp` makes the same two calls (read in MSFS 2024 SDK 1.7.3).

**Found:** on MSFS 2024 SunRise 12.2.282174.999, in the iniBuilds A350, p30's module fired a test `H:` event five ways, while a handler listened in each of the 18 cockpit panels ([p30's results](../../../experiments/areas/sync/results/p30-h-events-2026-11-10-08-45-37.txt)):

- `fsEventsRegisterHEvent` gave IDs 0 to 3, and `fsEventsHEventCall` returned `FS_EVENTS_ERROR_FAIL` every time: with a null array of size 0, with an array of size 0 that pointed at a value, with one integer value, and with the name registered with its `H:`.
  No panel heard any of the four.
- `execute_calculator_code("(>H:DUALINPUT_P30_TEST_5)")` returned 1, and all 18 panels heard the event.
- Neither the SDK's page for `fsEventsHEventCall` nor a forum thread we found says the call fails or limits it to some kind of module; the page's one example passes a `Vec3d`, a type p30 didn't try ([fsEventsHEventCall](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/wasm/event-api/fseventsheventcall/index.md), read on 2026-11-10).
  So whether the call is broken on this version of the sim, or works with a `Vec3d` or a string, or only from a gauge's module rather than a standalone one, is unknown.
- With our module firing `H:` events as calculator code, the TriStar's flight engineer acted on `H:FUEL` 132ms after the switch's write, and a burst of two `H:adf_SetRst` reached a panel of the Baron's, both of them ([the retest's report](results/2026-11-10-stage-14-h-retest.txt)).
  Every other case of the Baron's passed again, apart from stage 4's, whose yoke nobody moved, and which passed twice in the entry below.
- `fsVarsBVarCall` moved the Baron's battery switch through its `_Toggle` preset in 133ms, as it did in the entry below, so presets need no calculator code.

**Changed:** our module fires each `H:` event as calculator code alone, `(>H:name)`, which SDK 1.7.3 marks deprecated, as FS Copilot fires them, and as [the sync units](05-units.md#h-events) planned should `fsEventsHEventCall` reach no instrument (user, 2026-11-10).
It no longer calls `fsEventsRegisterHEvent` or `fsEventsHEventCall`.
A name that could close the code's parenthesis or add a word to it fires nothing.
Input event presets stay on `fsVarsBVarCall`.
Should a sim update drop calculator code, the SDK's call is the one to try again, with the kinds of parameter and module p30 left untried.

**Affects:** [the sync units](05-units.md), [the sim seam](../core/03-sim-seam-and-wasm-module.md), [the spine](../architecture/01-spine.md), and [the profile entries](01-profile-entries.md), each with a note at its top; [the architecture's decisions](../architecture/decisions.md), in place; and [the plan](../build/plan.md#14-state-sync)'s stage 14, whose open item this closes.

## 2026-11-09: Stage 14's session in the sim passed in four aircraft, and no aircraft took an H: event our module fired

**Asked:** after the fixes of the entry below, do the sync units' cases hold in the sim, with the real core hosting and a bench core on the stand-in sim as the second pilot, in the Baron 58P, the TriStar, the Fenix A320, the A220, and the A350; and what do the real core's loop and the loop under load measure beside them?

**Expected:** each case to pass.

**Found:** on MSFS 2024 SunRise 12.2.282174.999, on our development machine ([the runs' reports](results/2026-11-09-stage-14-session-reruns.txt)):

- In the Baron 58P, bksq-aircraft-baronpro 0.1.1, 14 of 17 cases passed:
  - windshield heat's `L:` variable moved both ways;
  - our module's call of `ELECTRICAL_Battery_1_Toggle` moved the battery switch in 101ms;
  - pitot heat's `K:` event, with one value by the legacy call, moved its switch in 99ms;
  - a beacon flipped by the mouse reached the second pilot's input event;
  - SET RST's `H:` event was heard beside the stock handler;
  - the KR87A's own `bfoMode`, read by `instrument-reads`, changed on the pilot's press, and the second pilot's toggled 115ms later;
  - the tablet took the second pilot's tap, as one down, one up, and one click, and their held press, and the pilot's press under their lock flashed.
- In the Baron, our module's `H:adf_SetRst`, fired twice, reached no listener in any cockpit panel.
  The Baron's two other failures were the script's: the held press played through, but the pilot's own mouse over the tablet came before its down, and the drag's moves went in the same instant as its press and up.
- The KR87A acts on no event without power, since its handler opens on `isElectricityAvailable()` (read in bksq-aircraft-baronpro 0.1.1, KR87A.js, `onInteractionEvent`), so the first run's BFO case, cold and dark, had nothing to sync; with the battery and avionics on, it passed.
- In the TriStar, inibuilds-aircraft-l1011 1.0.8, the fuel pump switch's `L:` variable took the second pilot's write in 66ms, and the flight engineer never acted on our module's `H:FUEL`.
- In the Fenix A320, 9 of 9 passed with a profile that watches the switches:
  - each switch write landed in about 130ms, with no notification;
  - a late joiner's catch-up wrote both batteries and the APU master, whose ON light, `L:I_OH_ELEC_APU_MASTER_L`, then lit.
- The Fenix's lights are its pushbuttons' annunciators: battery 1 coming on lit battery 2's OFF light, `L:I_OH_ELEC_BAT2_L`, 1,234ms later, as in the 2026-10-05 entry, and only while battery 2 was off.
  The session's first Fenix profile watched lights as the switches' state, and the 1.5s check flagged writes that had landed.
  The Fenix lit the APU master's ON light whatever order its switches came in, so the sim can't show catch-up's order, and the bench's case does.
- In the A220, with its power on, 8 of 8 passed:
  - the taxi lights' input event, reported twice, went out once;
  - the second pilot's tap, held press, and drag, paced at a step every 100ms, played on the ND;
  - the pilot's press under the second pilot's lock flashed;
  - the pilot's press, dragged off the ND, played on the second pilot's display, and its end left that display unlocked.
- The A220's display key carries its livery, `DisplayUnits|config=C-GUAC`, so the second pilot's display took the sim's key, as the known limit of 2026-10-25 ([pointer sync's log](../pointer-sync/log.md)) leaves it.
- 7s after the A220's first move into Flying, the sim went back to Loading, a second load of the aircraft's own, so the script counts a flight loaded once it has flown 15s straight.
- In the A350, ten baro commands at 2 frames moved it 10 hPa, from 1013.25 to 1023.25, in 882ms.
- The real core's loop, by the minute in each flight, held its queue wait at p99 between 31µs and 287µs, against 11.2ms, and its slowest input took 4.6ms, in the Baron's load.
  Every recording of the real core replayed with each checkpoint matching.
- The loop under load, beside the A350 at a busy airport with traffic, ran with the sim out of focus, so it's for comparison only ([its reports](results/2026-11-09-loop-under-load-beside-the-a350.txt)):
  - queue wait at p99 was 1.2ms, against 11.2ms; busy was 2.17%, against 20%; replay took 54s an hour, against 360s; and every input was recorded in order;
  - 942 inputs took over 1ms, against only the load's 10 planned 100ms stops.
- A first run of the loop grew slower each minute, to 12,273 inputs over 1ms, because the bench's load unit never ran the engine's frame or fed its writes back as readings, so every write's value stayed pending.
- The inspector takes one connection to a page at a time: a call made while the last one still closed was refused, which stopped two runs.

**Changed:**

- The 1.5s check stays, resting on an `instrument()` entry's reads every 250ms with a wide margin, since a profile watches the switch it writes (user, 2026-11-10).
- The session's script sets up the state each case needs, checks a change the case caused, asks the pilot only about what shows in front of them, and waits for Page Up before an aircraft's cases.
- The bench's load unit runs the engine's frame before each flight-model input and feeds each write back as its reading.
- `tools/sim/inspector.ts` waits for each connection's close before the next call.
- A probe of how our module fires `H:` events, and the TriStar's and the Baron's `H:` cases again, are open in [the plan](../build/plan.md#14-state-sync), with the loop under load beside the A350 run again in focus (user, 2026-11-10).

**Affects:** [the sync units](05-units.md), with a note at its top, and the plan's stage 14.

## 2026-11-09: The first session in the sim stopped on a catch-up that six unread instrument() entries held open

**Asked:** do the sync units' cases hold in the sim, in [stage 14](../build/plan.md#14-state-sync)'s session, with the real core hosting in the Baron 58P and a bench core on the stand-in sim as the second pilot?

**Expected:** each case in `tools/sim/state-sync.ts` to pass or fail on its own.

**Found:** on MSFS 2024 SunRise 12.2.282174.999, in bksq-aircraft-baronpro 0.1.1, every case in which the second pilot acted failed, and so did the beacon switch flipped in the sim ([the run's report](results/2026-11-09-stage-14-session-first-run.txt)):

- The second pilot's catch-up never ended, and while a catch-up runs, the cockpit stream holds everything its machine sends.
  A replay of the second pilot's recording, with a log line added to the engine, named what the catch-up waited on: a stepping write to decision height, which ended, and six `instrument()` entries, `kas_arm`, `kas_armed_vs`, `radar_alert`, `radar_profile`, `radar_hold`, and `radar_track`, each holding its write for a first reading.
  The stand-in had no panel to read those instruments, so neither a reading nor a refusal came.
- SimConnect listed the 58P's 127 input events in capitals, such as `ELECTRICAL_BATTERY_1` and `LIGHTING_BEACON_1`, while the aircraft's files and our profile spell them `ELECTRICAL_Battery_1`, so the core's exact match found none of the four electrical ones the profile reads.
- With two of p08's clients as two SimConnect connections, a group on one heard 20 of the yoke's `K:AXIS_ELEVATOR_SET` after the other connection cleared its group, which heard none after.
- The windshield heat set in the sim passed only because the second pilot already read 0, so the script sets the value the second pilot doesn't hold.

**Changed:**

- A catch-up write still held for its entry's first reading 1.5s after the catch-up starts counts as made, and the engine flags it as never landed, so an entry that never reads can't hold a catch-up open (user, 2026-11-09).
  An `instrument()` path that reads an error already counts as a refused read, which drops its held writes; this covers an instrument that no panel holds, which sends neither.
- The sim client matches an input event's name in capitals, and the stand-in lists its names in capitals, as the sim does.
- The session's script checks that the second pilot's catch-up ended before it runs an aircraft's cases.

**Affects:** [the sync units](05-units.md), with a note at its top.

## 2026-11-09: Writes to input events go through our WASM module, since SimConnect's list has none of their presets

**Asked:** how does a write that names an input event's preset, such as `B('ELECTRICAL_Battery_1_Toggle')`, reach the sim, when [reaching the sim](05-units.md#reaching-the-sim) gives every input event write to `set_input`?

**Expected:** that `SimConnect_SetInputEvent` carries them, as the design assumed.

**Found:** no run has tried it, and the records leave it nothing to send:

- `SimConnect_SetInputEvent` takes a hash, and `SimConnect_EnumerateInputEvents` is our only source of hashes.
  That list held `SAFETY_ELT_1` and neither `_ON` nor `_Set` on the Baron 58P, though both of those presets worked in calculator code (measured on MSFS 2024, 2026-08-29, fsc-editor, `docs/sim-vars/build/v1-log.md`, "b-preset-unknown calibrated in the sim, and it finds real dead code").
  The A220's list held none of the `_Push` spellings its Behaviors window shows (measured on MSFS 2024, 2026-09-03, same log, "The input-event table lists IDs; the preset rules were reading it as names").
- `1 (>B:ELECTRICAL_Battery_1)` changed nothing on the 58P, and `(>B:ELECTRICAL_Battery_1_Toggle)` turned its battery on (measured on MSFS 2024, 2026-08-29, same log, "The arity probes: bare K: pops one and broadcasts; bare B: writes are per-preset dead air").
- FS Copilot writes every preset as calculator code that its WASM module runs through `execute_calculator_code` (read in the FS Copilot fork, `FsCopilot/Simulation/Definitions.cs` and `FsCopilot.Bridge.Wasm/wasm_module.cpp`), and SDK 1.7.3 marks that call deprecated (read in `WASM/include/MSFS/Legacy/gauges.h`).
- `fsVarsBVarCall` takes an ID from `fsVarsGetBVarId`, which takes the name a preset has, and calls it with its value (read in MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_Vars.h`); no run of ours has called it.

**Changed:** every write to an input event goes through our WASM module (user, 2026-11-09):

- The routine that fires `H:` events also calls input event presets, so a write function's `H:` and `B:` actions keep their call order.
  It's named `NamedEvents`, since it no longer carries only `H:` events.
- A `B:` name in a `write` names a preset, as `_Toggle` or `_Set`, and takes the value `_Set` needs; a bare name calls nothing, and the 1.5s check flags it.
- `set_input` isn't built.
- `L:` and `A:` writes and `K:` events stay on SimConnect, where six aircraft took them in the 2026-10-05 entry below, since a module's `K:` send might not reach our listening group, and a stopped module would otherwise lose every write (user, 2026-11-09).
- If `fsVarsBVarCall` reaches no preset in this stage's session in the sim, the routine host runs calculator code instead, and nothing outside it changes.

**Affects:** [the sync units](05-units.md), [the sim seam](../core/03-sim-seam-and-wasm-module.md), and [what a routine can ask for](../architecture/02-code-map.md#what-a-routine-can-ask-for), each with a note at its top.

## 2026-10-24: Stage 13's sync engine passes every case that needs no sim, and its cockpit stream replays a cut at its sender's gaps and catches a late joiner up between bench cores

**Asked:** do [stage 13](../build/plan.md#13-the-sync-engine-and-the-cockpit-stream)'s cases hold: the sync engine's, with no core, and the cockpit stream's, between bench cores with a test unit in state sync's and pointer sync's place; and do its budgets?

**Expected:** the starting rules [the sync units](05-units.md) give, which no run had tried, and the budgets that doc set as estimates.

**Found:** on our development machine, with Cyberpunk 2077 running beside the runs, which ran at below-normal priority:

- The sync engine's 23 tests pass, each from [the sync units' cases](05-units.md#cases-for-the-bench) that needs no sim.
  Among them, a knob turned a detent a frame sends nothing back while its reading lags, a `toggle` over a lamp that lights 2s late flips once and is flagged, catch-up writes the battery before the APU master, an entry the aircraft changes every 3s stops syncing within 33s, and an input event reported twice a frame apart goes out once, and twice at 4 fps.
- The cockpit stream's own tests of its order pass, with three machines and no core: B's press waits at C until A's page key has applied, and a change of control drops the solo change the new pilot flying hadn't seen.
- Between bench cores, all 7 cockpit scenarios pass, and every core's recording replays to the same outputs.
  A lever changed 120 times over about 2s went out as 30 messages, inside 20 a second.
  A 60s cut's replay waited 2,000ms for a gap of 3.2s, its cap, applied only the last of each run of the pilot flying's changes, and denied take-control until it ended.
  In the run with the lever, the slowest input took 345µs on the pilot flying's core, against a handler's 1ms.
- The code review made 11 findings, the worst a stepping write that a put-back or a new value replaced, which lost its duty to tell the stream it was done and could hold the stream or a catch-up forever; each is fixed, with a test for each the engine's tests could reach.
- A change of state sync's takes 95 bytes, so a 30-minute cut at 20 changes a second keeps 3.42 MB, against the [budget](05-units.md#budgets)'s 4 MB; a catch-up's answer for 500 entries takes 44,638 bytes, against 64 KB, near the doc's estimate of 90 bytes an entry.
- Three timing cases failed in a run beside the game: the cockpit lever's, the session's countdown, and the profiles' build of 300 write functions.
  On 2026-10-25, with no game on the PC and the bench at normal priority, `cockpit`, `session`, and `profiles` passed all 35 of their cases.
  The lever's slowest input took 268µs, the countdown's 402µs, and the build 1,661ms, against 2,000ms.
- The engine's release timing test, in three runs on 2026-10-25 with no game, compiled 300 write functions in 2.04ms to 2.30ms, against the [budget](05-units.md#budgets)'s 10ms, and took at most 110µs for an arrival and a frame of 3,000, against 1ms.

**Changed:** the stage built five things the docs leave open or state two ways, each in its code's comments:

- A catch-up step's unit tells the stream whether it can give and take, through `cx.cockpit().step_ready`, since the stream can't read the profile loader, and a core with no step never asks for a catch-up.
- A held message carries the control value it was made under, as [a change of control](04-order-and-recovery.md#a-change-of-control) needs, where [sending](05-units.md#sending) has the stream fill it in as the message goes.
- A message from a superseded pilot flying is judged against the newest control value the stream or the session crate knows, since the change's message can come before its key.
- A pulse's firing carries the value the pulse rose to, so an event entry that writes its own pulse variable replays it.
- The stream applies at most 50 messages in one input, and the rest in the inputs of a timer, since each queues two calls and the kernel panics past 1,000.

The user also chose two changes to the format, which [01-format-and-delivery](../profiles/01-format-and-delivery.md)'s note of 2026-10-25 gives: an event entry takes no `toggle` or stepping write, since an event has no value to compare or step from, and a write function's `write()` on a variable needs a value at the type check (user, 2026-10-24 and 2026-10-25).

**Affects:** [the sync units](05-units.md), whose text, folded before this stage landed, doesn't yet say the five things above, and [01-format-and-delivery](../profiles/01-format-and-delivery.md), whose note of 2026-10-25 gives the format's two changes.

**Evidence:** [results/2026-10-24-stage-13-bench.txt](results/2026-10-24-stage-13-bench.txt).

## 2026-10-05: The A350's stock heading is an output of its module, and its dial takes a value written straight into it

**Asked:** in [p01's write tests](#2026-10-05-two-writes-in-one-frame-land-in-the-order-sent-and-a-write-shows-within-2-frames), a single `K:HEADING_BUG_SET` showed on the iniBuilds A350, but after two in one frame the value 300ms later was neither.
Was that because the A350 loaded with its own battery switches off, or does it happen powered too, and what sets its heading from outside?

**Expected:** the A350's module copies its own dial into the stock heading, so it would write its dial back over ours, powered or not (unverified).

**Found:** in the A350, powered, on a runway, reading every frame, in three runs, the third adding the last two steps below:

- `K:HEADING_BUG_SET` 93 showed in `A:AUTOPILOT HEADING LOCK DIR` within 2 frames and was back at the dial's value 1 to 4 frames after that; the dial never moved.
- `K:HEADING_BUG_SET` 142 and then 41 in one frame showed 41, the second, and went back within 2 frames.
- `K:HEADING_BUG_INC` moved nothing.
- `L:INI_HEADING_DIAL_UP_COMMAND` = 1 moved the dial one degree 2 frames after the write, the module reset the command to 0 in the same frame, and the stock heading followed within 1 frame; `_DN_COMMAND` stepped it back the same way.
- Written straight into `L:INI_HEADING_DIAL`, 93, then 271, then 0 stayed, and the stock heading followed 2 to 3 frames later.
- Ten up commands, one every 2 frames, all landed, but the dial moved 1, 1, 2, 2, 3, 3, 4, 4, 5, and 5 degrees, 30 in all; ten down commands every 3 frames came back the same way.
  The knob accelerates, so a count of commands isn't a count of degrees.

**Changed:** p01's reading was wrong: the heading went back because the module writes its dial over the stock heading, powered, not because the A350 was dark.
On the A350 the heading syncs as one write to `L:INI_HEADING_DIAL`, and `A:AUTOPILOT HEADING LOCK DIR` is a value to read, never to write.

**Affects:** [pacing in 01-profile-entries](01-profile-entries.md#what-a-profile-says-once-per-aircraft).

**Evidence:** `results/p04-a350-heading-2026-10-05-20-00-21`, `-20-01-18`, and `-20-04-47`, each `.txt` and `.ndjson`.

## 2026-10-05: The A220's FCP ignores stock autopilot events, the A350 takes a command at most every 2 frames, and the Fenix reads a counter's jump as that many detents

**Asked:** how fast do the A220, the A350, and the Fenix take stepped writes ([the plan](../product/plan.md)'s step 6)?

**Expected:** only the heading event reaches the A220's module and the A350 counts two commands before one update as one (both unverified), and how the Fenix reads a counter that jumps couldn't be told.

**Found:** each aircraft powered at a gate, every write sent from our own SimConnect client, reading every `L:` variable that moved and the stock values each step names, in the 3s after each step:

| Aircraft | Write | What moved |
| --- | --- | --- |
| Synaptic A220 | `K:HEADING_BUG_SET` 90, `K:AP_SPD_VAR_SET` 250 | nothing but sidestick jitter |
| Synaptic A220 | `K:AP_VS_VAR_SET_ENGLISH` 1500 | `A:AUTOPILOT VERTICAL HOLD VAR` changed and was back at 0 within 2 frames |
| Synaptic A220 | `K:HEADING_BUG_INC` 10 times in one frame, then once a frame | nothing |
| iniBuilds A350 | `L:INI_BARO1_INC_COMMAND` = 1 twice in one frame | the captain's baro rose 1 hPa |
| iniBuilds A350 | the same once a frame, 10 times | 5 hPa, one step every 2 frames |
| iniBuilds A350 | `L:INI_BARO1_DEC_COMMAND` = 1 every 150ms, 11 times | 11 hPa, every one |
| Fenix A320 | `L:S_OH_ELEC_BAT1` = 1 | `L:A320_Sound:Battery_bus_1` and `L:A320_Sound:Battery_connected` went to 1, and `L:I_OH_ELEC_BAT2_L` lit, 1.2s later |
| Fenix A320 | `L:S_MIP_CLOCK_CHR` +1, 1s, +1; +3; +1; +2 | the counter took each write as one jump, 0, 2, 5, 6, 8 |
| Fenix A320 | `L:E_FCU_HEADING` +1, then +10 at once | `L:N_FCU_HEADING` went from 0, the 360 the pilot set, to 1, then to 11, 255ms and 203ms after each write |
| Fenix A320 | `L:S_FCU_HEADING` −1, then +1 | the −1 dashed the heading, as a push does; the +1 changed nothing |

- The A350's baro commands moved 1 hPa each, with no acceleration, unlike its heading knob ([entry above](#2026-10-05-the-a350s-stock-heading-is-an-output-of-its-module-and-its-dial-takes-a-value-written-straight-into-it)).
- The first run's Fenix heading steps fell inside the FCU's power-up, when its AP lights and dashed displays flipped 9 times in 3s, so we ran them again after it had settled; the table gives the second run.
- Whether the chronometer took a jump of 3 as three presses or one, the variable can't tell, and nobody watched the chronometer.

**Changed:** one step per frame, the engine's default pace, loses every other step on the A350, so its profile paces commands at 2 frames or more.
The A220's autopilot targets don't sync through stock events at all, and need the FCP's own controls.
The Fenix's encoder counters can be written as one jump of the full difference.
Whether a +1 on the Fenix's push-pull counter pulls the knob, or does nothing on the ground, is open.

**Affects:** [pacing in 01-profile-entries](01-profile-entries.md#what-a-profile-says-once-per-aircraft) and its note on the Fenix's counter.

**Evidence:** `results/p02-stepped-writes-2026-10-05-19-37-47` and, for the Fenix's heading, `-19-50-45`, each `.txt` and `.ndjson`; the A220's CommBus watch is `experiments/areas/commbus/results/p02-commbus-watch-2026-10-05-19-37-55.ndjson`.

## 2026-10-05: The PA-24's double-fire comes one frame apart at 31 and 21 fps, and a held key doesn't repeat

**Asked:** does the input event double-fire stay inside [live sync's duplicate filter](02-live-sync.md#keeping-a-change-from-applying-twice), 3 frames and never more than 200ms, at a low frame rate, and does a held key repeat inside it?

**Expected:** fsc-editor saw 43 of 53 same-value pairs 17ms to 21ms apart and 9 at 37ms to 40ms, at a frame rate nobody recorded (fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — Stage 2 verified live. The double-fire is frame-locked, and tighter than measured.").

**Found:** in the A2A PA-24, parked, subscribed to every input event it has and counting sim frames:

| Phase | Frame rate | Clicks reported twice | Gap |
| --- | --- | --- | --- |
| About 10 switches, a second apart | 31.0 fps | 7 of 9 | 32ms to 34ms, 1 frame |
| The same, capped | 21.0 fps | 7 | 49ms to 50ms, 1 frame |
| A starter key held 3s, twice, and a button held 3s with the mouse | 20.4 fps | 1, the starter | 51ms, 1 frame |

- Every pair was inside the filter.
- A held key or button reported one press and one release, with no repeats.

**Changed:** the filter holds on the PA-24 down to 21 fps; at 5 fps one frame would reach its 200ms cap, which nobody has tried.

**Affects:** [live sync's open questions](02-live-sync.md#open-questions).

**Evidence:** `results/p03-double-fire-2026-10-05-18-09-44.txt` and `.ndjson`.

## 2026-10-05: Two writes in one frame land in the order sent, and a write shows within 2 frames

**Asked:** does SimConnect apply the writes Dual Input sends in one frame in the order sent, how long does an aircraft take to show a write, and how many retries does a write take to land ([the plan](../product/plan.md)'s step 6)?

**Expected:** no source either way.

**Found:** on 10 loads of six aircraft, the Black Square Baron 58P four times, the Fenix A320 twice, and the A2A PA-24, Synaptic A220, iniBuilds A350, and PMDG 777-300ER once each, each tested 2 minutes after Ready to fly, with hands off:

- Two data-definition writes of `L:CROSSCHECK_P01_ORDER` sent back to back: the second won 20 of 20 on every aircraft.
- Two `K:HEADING_BUG_SET` events back to back: the second won 10 of 10 on the Baron, PA-24, Fenix, and 777.
  On the A220 neither stuck, because it ignores the event ([entry above](#2026-10-05-the-a220s-fcp-ignores-stock-autopilot-events-the-a350-takes-a-command-at-most-every-2-frames-and-the-fenix-reads-a-counters-jump-as-that-many-detents)), and on the A350 its module wrote its own heading back ([entry above](#2026-10-05-the-a350s-stock-heading-is-an-output-of-its-module-and-its-dial-takes-a-value-written-straight-into-it)).
- Single writes, read every frame until they showed:

  | Write | Read | Showed |
  | --- | --- | --- |
  | `K:HEADING_BUG_SET` 93 and 271 | `A:AUTOPILOT HEADING LOCK DIR` | 2ms to 34ms, 1 or 2 frames, on every aircraft but the A220, where it never did |
  | `K:KOHLSMAN_SET` 1001 and 1027 hPa | `A:KOHLSMAN SETTING MB:1` | 2ms to 34ms, 1 frame, on every load |
  | `L:CROSSCHECK_P01_SHOW` by data definition | itself | 3ms to 34ms, 1 or 2 frames |
  | the Baron's `L:var_FrontArmrest` by data definition | itself | 4ms to 34ms, 1 or 2 frames |

- Every write that landed did so on its first try; the A220's heading write, which it ignores, didn't land after 3 retries 500ms apart.

**Changed:** SimConnect keeps the order of two writes to one variable sent together; whether an aircraft sees writes to two different variables in the order sent, which an interlock turns on, is untested.
A write shows within 2 frames where the aircraft takes it at all, so [live sync's 500ms read-back wait](02-live-sync.md#checking-that-a-write-landed) has room for an entry that reads the variable it writes.
A readout the aircraft computes can take longer, such as the Fenix's battery lamp at 1.2s ([entry above](#2026-10-05-the-a220s-fcp-ignores-stock-autopilot-events-the-a350-takes-a-command-at-most-every-2-frames-and-the-fenix-reads-a-counters-jump-as-that-many-detents)).

**Affects:** [02-live-sync](02-live-sync.md#checking-that-a-write-landed) and [03-catch-up](03-catch-up.md#choosing-the-order).

**Evidence:** `results/p01-guided-load-2026-10-05-16-54-34`, `-17-29-24`, and `-17-50-58`, each `.txt` and `.ndjson`, the `order` and `show` records.

## 2026-10-05: A load the sim left without an aircraft had two AircraftLoaded events, and the L: table only grows

**Asked:** nothing; these came up while loading aircraft for [the settle entry below](#2026-10-05-every-aircraft-restores-its-switches-within-15s-of-ready-to-fly-and-settling-timed-from-fly-misleads).

**Found:**

- 4 of 15 loads from the world map put the pilot in the flight with no aircraft, and the pilot loaded again: the PA-24's, the A350's, and the 777's first tries, and one Baron load.
- Each of the four had two `AircraftLoaded` events, 1.0s to 2.0s and then 6.4s to 14.3s after `FlightLoaded`, and the three we recorded through registered 0 to 4 new `L:` names.
- Each of the 11 loads that worked had one `AircraftLoaded`, 1.4s to 52.9s after `FlightLoaded`, and the three retries registered 1,002 to 1,964 new names.
- The sim's `L:` name table held 6,792 names when the run started and 15,538 after six aircraft, and loading one again added none; a name stays until the sim restarts.
- Restart, from the pause menu, loads the aircraft again: `AircraftLoaded` fires, and the Baron registered 6 new names.

**Changed:** nothing: Dual Input won't try to detect a load with no aircraft, since an empty cockpit says so louder than any message would (user, 2026-10-05).
It explains why some loads in the settle runs ran twice.

**Evidence:** `results/p01-guided-load-2026-10-05-16-54-34` and `-17-29-24`, the `system` and `load` records.

## 2026-10-05: Every aircraft restores its switches within 15s of Ready to fly, and settling timed from Fly misleads

**Asked:** when does an aircraft loaded from the menu stop restoring its own controls, and does [catch-up's settle rule](03-catch-up.md#settling-after-a-load) call it right?
The rule counts from "load", so which moment is that?

**Expected:** the Baron's code finishes restoring its settings about 25s after load (read in bksq-aircraft-baronpro 0.1.1, `model.base\BaronProfessional_Base_INT.xml` and `BlackSquareTablet.js`), and a restore might pause longer than 15s, as `L:` names appearing did (03-catch-up).

**Found:** the pilot loaded each aircraft parked from Free flight's world map; the probe recorded every `L:` variable through fsc-editor-link's stream and 27 stock values every frame, through 2 minutes of hands off after Ready to fly:

- The sim marks both moments through SimConnect: `FlightLoaded` with `CustomFlight.FLT` when Fly is clicked, and the flow event `RTC_END` when Ready to fly is clicked, by the pilot or by Flow Pro.
  Ready came 13.5s to 20.3s after Fly, except on the A350's second load, 67.2s.
- The switches, the stock values in `SETTLE_A` and each aircraft's own short list, last changed this long after `RTC_END`:

  | Aircraft | Last switch change after Ready | What changed last |
  | --- | --- | --- |
  | Black Square Baron 58P, four loads | 1.9s to 6.4s | the parking brake, and after a Restart also `L:bksq_controlLocks` and `L:var_startupComplete` |
  | A2A PA-24 | 1.6s | COM 1's active frequency |
  | Synaptic A220 | 3.5s | lights, flaps handle, COM 1, and transponder, in one frame |
  | iniBuilds A350 | 4.4s | battery and avionics master |
  | PMDG 777-300ER | 2.9s | lights, parking brake, and avionics master |
  | Fenix A320 | 12.1s | the battery 5 times from 8.5s, then `L:Panel_state` |

- Counted from Ready, the rule called the switches settled at 30.0s on every aircraft, its floor of 15s and then 15s quiet, so 30.0s says only that they stopped within 15s.
- Every value the stream carried settled 30.0s to 45.6s after Ready, with these changes after the verdict:
  - cosmetic or drifting: the PA-24's `L:BlinkingOffset` timers and `L:AmbientVisibility`, the Baron's `L:AS1000_Warnings_WarningIndex` and `L:var_scaledMaximumMixturePosition_1` and `_2`, the A350's `L:ECAM_IS_STS_CLEARABLE`, and the 777's `L:yokes_Fore_Aft`;
  - aircraft state: the Fenix's ground power, `L:B_CONFIG_GPU`, `L:I_OH_ELEC_EXT_PWR_U`, `L:A320_Ground_Power_Anim`, and `L:A320_Sound:GPU_State`, and its four `INSIDE_LOCK` door variables, each flipping 10s to 22s after Ready and flipping back 46s to 54s after it.
- Counted from Fly, a second load fooled the rule: from the A350's second `FlightLoaded`, it called the aircraft settled at 30.0s, 37s before Ready, with 354 values changing after, because nothing changes behind the loading screen.
- The Baron's last switch change came 20s to 23s after Fly, near the 25s its code gives.
- Loading the Baron again changed little: every value settled 45.6s after Ready on the first load after the sim started, 44.9s on a later load, and 44.8s after a Restart.
- The pilot's press at Fly came 22.1s after the Fenix's `FlightLoaded` and 13.3s after the 777's first one, so `p01-markers.mjs` times every load from the sim's markers instead, and p01 records from the sim's `FlightLoaded`.

**Changed:** catch-up counts settling from the sim's `RTC_END`, when Ready to fly is clicked, not from Fly.
The switches were done within 15s of Ready on every aircraft, so a rule with a lower floor would cut the wait, which is a design question.
The only real state after the verdict was the Fenix's ground power and doors flipping back.

**Affects:** [03-catch-up](03-catch-up.md#settling-after-a-load).

**Evidence:** `results/p01-guided-load-2026-10-05-16-54-34`, `-17-29-24`, and `-17-50-58`, each `.txt` and `.ndjson`, and the re-timed `results/p01-markers-2026-10-05-16-54-34.txt` and `-17-29-24.txt`; the first run's Fenix recording began 22.1s after its Fly, so its numbers come from the third run.
