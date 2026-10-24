# Sync: log

What our experiments and the build's stages found about keeping cockpits in sync, through profile entries, live sync, and catch-up, newest entry first.
The probes are in [experiments/areas/sync](../../../experiments/areas/sync), and their raw output is in its `results/` folder.
Every entry of 2026-10-05 was measured on MSFS 2024 SunRise 12.2.282174.999, on our development machine with Flow Pro 26.33.5, ChasePlane 2026.39.1.16, and GSX Pro 4.0.19 installed, with the frame rate capped near 30 fps unless the entry says otherwise.

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
- An engine call's time and the compile of 300 write functions, which the budgets set by hand in a release build, wait for a run with no game on the PC.

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

**Affects:** [pacing in 01-profile-entries](01-profile-entries.md#what-a-profile-says-once-per-aircraft), and the A350 study's claims about its autopilot.

**Evidence:** `results/p04-a350-heading-2026-10-05-20-00-21`, `-20-01-18`, and `-20-04-47`, each `.txt` and `.ndjson`.

## 2026-10-05: The A220's FCP ignores stock autopilot events, the A350 takes a command at most every 2 frames, and the Fenix reads a counter's jump as that many detents

**Asked:** how fast do the A220, the A350, and the Fenix take stepped writes ([the plan](../product/plan.md)'s step 6), which is the A220 study's sim question 5, the A350's question 3, and the Fenix's questions 1 and 2?

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

**Affects:** [pacing in 01-profile-entries](01-profile-entries.md#what-a-profile-says-once-per-aircraft) and its note on the Fenix's counter, and the A220, A350, and Fenix studies' sim questions 1, 2, 3, and 5.

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

**Expected:** the Baron's code finishes restoring its settings about 25s after load (read in bksq-aircraft-baronpro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md), sim question 2), and a restore might pause longer than 15s, as `L:` names appearing did (03-catch-up).

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

**Affects:** [03-catch-up](03-catch-up.md#settling-after-a-load), and the Baron study's sim question 2.

**Evidence:** `results/p01-guided-load-2026-10-05-16-54-34`, `-17-29-24`, and `-17-50-58`, each `.txt` and `.ndjson`, and the re-timed `results/p01-markers-2026-10-05-16-54-34.txt` and `-17-29-24.txt`; the first run's Fenix recording began 22.1s after its Fly, so its numbers come from the third run.
