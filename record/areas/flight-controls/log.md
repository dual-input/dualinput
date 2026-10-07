# Flight controls: log

What our experiments found about keeping a pilot's own flight controls out of the sim, newest entry first.
A SimConnect client's mask at 10,000,000 blocks the pilot's hardware input bound in MSFS, input events included, and gives it back when the client dies; a tool such as SPAD.neXt that sets the aircraft's input event itself gets past it.
Two groups can't share a priority, so on an aircraft whose module asks for the same one, the group that registers first is ahead.
A group that takes its priority as the sim starts, held open by an event it only listens to, keeps its place, and masks ahead of Accu-Sim once it adds the axis.
A value sent back at half reaches the sim from 10,001,000 down, and the PMDG 777's own yoke takes it only when it's sent with the legacy `SimConnect_TransmitClientEvent`.
The probes are [p01-mask.mjs](../../../experiments/areas/flight-controls/p01-mask.mjs), [p02-input-delay.mjs](../../../experiments/areas/flight-controls/p02-input-delay.mjs), and [p03-mask-at-start.mjs](../../../experiments/areas/flight-controls/p03-mask-at-start.mjs), and their raw output is in [experiments/areas/flight-controls/results](../../../experiments/areas/flight-controls/results).
Every entry was measured on MSFS 2024 SunRise 12.2.282174.999, on the date in its heading, with the hardware on our development machine.

## 2026-10-07: A group that takes its priority as the sim starts, held open by an event it only listens to, masks ahead of Accu-Sim once it adds the axis

**Asked:** can Crosscheck's core take its masking priority as the sim starts, ahead of an aircraft's own module, without holding back the pilot's controls until a session wants to mask ([architecture plan](../architecture/plan.md#111-masking-priority-at-sim-start), node 1.1.1)?

**Expected:** no prediction for a group that masks nothing at first.

**Found:** p03 started before the sim, asked Steam to start it, and registered its groups the moment SimConnect answered; the pilot then loaded the A2A PA-24 parked from the world map:

- Asking 10,000,000 for a group with no events in it failed: the sim answered `SetNotificationGroupPriority` with `UNRECOGNIZED_ID`.
- Group A, holding `K:SIM_RATE_INCR` as an event it listens to and doesn't mask, took its priority with no error.
- The sim sent `AircraftLoaded` for the PA-24 9s after our groups went in, when the main menu loaded it, and again 381s after, for the flight.
- With the pilot moving the yoke and the axis not in group A, `L:ElevatorInput` moved from −0.07 to 100, so Accu-Sim took the input.
- Once `K:AXIS_ELEVATOR_SET` was added to group A, maskable, after Ready to fly, group A heard all 88 elevator events that our listener at the highest priority heard, 46 of them past ±6,000 and up to ±16,384, and `L:ElevatorInput` held at 100, 0% of its free range.
- Once group A was cleared, `L:ElevatorInput` moved from −100 to 100 again.
- Group B was to do the same holding the throttle's own axis event, not maskable, but the throttle, bound to MSFS's "THROTTLE 1 AXIS", fired no `K:AXIS_THROTTLE1_SET`: `L:Throttle1Position` moved from 0.3 to 97.8 while our listener heard none, so group B's test didn't run.
  On 2026-10-01 the same aircraft's throttle fired `K:AXIS_THROTTLE1_SET` ([entry below](#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)), so something between the two runs changed the event, perhaps the binding (unverified); which event this binding fires, the probe didn't listen for.
  We didn't run group B again, because group A answers the question, and the core doesn't need to hear the axes before a session (user, 2026-10-07).

**Changed:** the core can take its masking priority when it connects, as the sim starts, by holding a group open with an event it only listens to, and add the axes it masks when a session needs them, ahead of an aircraft that loads later, with nothing held back until then.
SimConnect answered before the main menu loaded its aircraft, so a core that connects as soon as it can gets in ahead of the menu's aircraft too, in this one run.

**Affects:** the tentative decision [The core starts with every sim run](../architecture/decisions.md#the-core-starts-with-every-sim-run), and [node 1.1.1](../architecture/plan.md#111-masking-priority-at-sim-start) of the architecture plan.

**Evidence:** `results/p03-mask-at-start-2026-10-07-21-11-40`, `.txt` and `.ndjson`.

## 2026-10-06: A pilot's own pitch and roll input was flyable 150ms late and not 300ms late, in the Baron at cruise

**Asked:** how much network delay can mixed flight controls take ([the plan](../product/plan.md)'s step 6)?
With mixed controls, the PM's input reaches the flying machine one network delay late, and the aircraft's motion comes back one more late, behind the following machine's display buffer, which is 400ms in FS Copilot's design ([03-v1-scope](../product/03-v1-scope.md#flight-model-sync)).
So the PM flies a control loop late by twice the one-way delay plus the buffer.

**Expected:** no prediction.

**Found:** in the 58P in cruise, at about 3,650 ft and 168 kt with the autopilot off, p02 masked the yoke's `K:AXIS_ELEVATOR_SET` and `K:AXIS_AILERONS_SET` at 10,000,000 and sent each value back after a delay at 10,001,000.
With no delay, the masker sent back all 289 events it got, and the yoke followed.
The pilot flew six steps of about 50s each, a hold, a 60° turn, and a hold, at delays in an order they weren't told, 700, 1,000, 500, 0, 300, and 150ms, and judged each:

| Added delay | The pilot's verdict | Altitude off the step's start, largest / RMS |
| --- | --- | --- |
| 0ms | flyable | 16 / 10.5 ft |
| 150ms | flyable | 55 / 36 ft |
| 300ms | not flyable | 69 / 36 ft |
| 500ms | not flyable | 145 / 90 ft |
| 700ms | not flyable | 62 / 35 ft |
| 1,000ms | not flyable | 157 / 99 ft |

The probe's counts of vertical speed and yoke reversals read 0 at every delay because of a bug in counting them, and with no samples saved, neither they nor the 0s for overshooting the target heading can be checked.

**Changed:** for this pilot in this aircraft, a PM flying through mixed controls needs the whole extra loop delay near 150ms.
Twice a one-way delay plus a 400ms buffer is far past that, so the PM's view would need a much shorter buffer and a partner nearby, or the PM's input applied on their own machine first.
This is one pilot, one run, and one light twin; an airliner, slower to respond, may tolerate more (unverified).

**Affects:** the idea [mixed flight controls](../product/ideas.md#mixed-flight-controls).

**Evidence:** `results/p02-input-delay-2026-10-06-20-42-49`, `.txt` and `.ndjson`.

## 2026-10-06: Masking holds back a mixture lever bound in MSFS, and not one SPAD.neXt drives, because SPAD.neXt sets the input event itself

**Asked:** does masking hold back the Black Square Baron 58P's mixture lever, which the Baron takes through its own input event, `BKSQ_TurbochargedMixtureController_1` ([the plan](../product/plan.md)'s step 6)?
Soft takeover depends on it.

**Expected:** yes for a lever bound in MSFS.
The mixture's input event binds every `MIXTURE*` key event and axis, `AXIS_MIXTURE1_SET` among them (read in bksq-aircraft-baronpro 0.1.1, `BaronProfessional_Templates.xml`), and Asobo's throttle input event binds `AXIS_THROTTLE#_SET` the same way (read in MSFS 2024 SDK 1.7.3, `ModelBehaviorDefs/Asobo/Common/Inputs/Engine_Inputs.xml`), which masking stopped on the Baron ([entry below](#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)).

**Found:** in the 58P, engines off, with p01's mask at 10,000,000 and our development machine's hardware mixture lever, in three runs that differed only in where the lever was bound:

| Lever bound in | What reached the Baron | With the mask |
| --- | --- | --- |
| MSFS, "MIXTURE 1/2 AXIS (-100 to 100%)" | `K:AXIS_MIXTURE1_SET`, from −16,384 to 16,384, 73 times in 5s, and the input event | The masker got all 118 events, the input event fired 0 times, and `L:BKSQ_MixtureLeverPosition_1` moved 0% of its free range; cleared, it moved 90% again |
| SPAD.neXt | The input event alone, 82 times in 5s, and none of the 24 mixture key events p01 listens to | Nothing to mask |
| Both | `K:AXIS_MIXTURE1_SET` 122 times in 5s, and the input event | The masker got 104 of 105 events, and still the input event fired 106 times and the lever moved its full range |

SimConnect refused `MIXTURE_AXIS_SET_EX1`, `MIXTURE1_AXIS_SET_EX1`, and `MIXTURE2_AXIS_SET_EX1` with `NAME_UNRECOGNIZED`, though the Baron's input events bind them.

**Changed:** a masked key event never reaches an input event that binds it, for the mixture as for the throttle, so masking holds back levers bound in MSFS on the Baron.
A lever SPAD.neXt drives reaches the input event with no key event, so no SimConnect mask holds it back, and with both bindings, SPAD.neXt's path still gets through.
Soft takeover has to handle those pilots another way, such as noticing a lever that moves with no key event and telling the pilot.
Whether FSUIPC or AAO set input events the way SPAD.neXt does is unverified.

**Affects:** the ideas [soft takeover](../product/ideas.md#soft-takeover-on-handover) and [mixed flight controls](../product/ideas.md#mixed-flight-controls).

**Evidence:** `results/p01-mask-2026-10-06-18-15-07` (MSFS), `-18-12-56` (SPAD.neXt), and `-18-07-02` (both), each `.txt` and `.ndjson`.

## 2026-10-01: Inside a dead zone set in MSFS, the axis fires no event

**Asked:** does an axis event carry the value after MSFS's own dead zone, or the raw axis?

**Expected:** no prediction.

**Found:** with a dead zone of about 50% set on the pitch axis, and the yoke held at about a quarter of its travel and wiggled, our listener at priority 1 heard no `K:AXIS_ELEVATOR_SET` in 5s, and the PMDG 777's `L:yokes_Fore_Aft` didn't move.
Every earlier window with the yoke moving heard 83 or more in 5s.
So MSFS applies the dead zone before it fires the event, and a masked event carries the value after it.
Whether MSFS applies its sensitivity curve at the same stage is unmeasured.

**Changed:** Crosscheck keeps the pilot's own dead zone when it takes their input by masking, so it needn't rebuild that setting.

**Affects:** the idea [Mixed flight controls](../product/ideas.md#mixed-flight-controls).

**Evidence:** [the dead-zone run](../../../experiments/areas/flight-controls/results/p01-mask-2026-10-01-21-11-53.txt).

## 2026-10-01: The PMDG 777 takes a value sent back with the legacy transmit call

**Asked:** does the 777 act on a value sent back with `SimConnect_TransmitClientEvent`, rather than the `_EX1` form it ignored ([the entry below](#2026-10-01-a-value-sent-back-at-10000001-reached-our-own-masking-group-and-the-777-ignored-re-sent-values))?

**Expected:** yes, if PMDG's module handles only `SIMCONNECT_RECV_EVENT`.

**Found:**

- At 10,001,000, `L:yokes_Fore_Aft` followed our half-value sends: 0.5 to 1.5, against 0 to 2 unmasked.
- From 100,000,000 down, the stock yoke followed at half and PMDG's didn't, as with `_EX1`, because those sends land behind PMDG's groups.
- So PMDG's module masks an `_EX1` event and drops it, and acts on the same event sent by the legacy call.
  That its dispatch handles only `SIMCONNECT_RECV_EVENT` is our reading of its behavior, not of its code (unverified).

**Changed:** mixing two pilots' inputs works on the 777: mask at 10,000,000, then send the mixed value with the legacy call at 10,001,000, in front of PMDG's groups.
A send meant for a module's own handler should use the legacy call, which carries no fifth parameter to tag it with.

**Affects:** the idea [Mixed flight controls](../product/ideas.md#mixed-flight-controls).

**Evidence:** [the 777's legacy run](../../../experiments/areas/flight-controls/results/p01-mask-2026-10-01-21-07-52.txt).

## 2026-10-01: A value sent back at 10,000,001 reached our own masking group, and the 777 ignored re-sent values

**Asked:** can Crosscheck send a masked input back changed, at half, so the aircraft acts on it, and at which priority?

**Expected:** a send at 10,000,001 reaches only groups behind 10,000,000, since the SDK has delivery start at the priority given ([04-02](../../learn/foundations/04-02-events.md#client-events)).

**Found:**

- At 10,000,001, the send reached our own masking group, which we had asked for at 10,000,000.
  On the Baron and the 777, our masker heard every value it sent back, recognized as its own, and masked it.
  That fits the SDK's rule that a group asking for a taken priority gets the next lower free one ([04-02](../../learn/foundations/04-02-events.md#client-events)), if another client on our machine already held 10,000,000 and our group sat at 10,000,001 (unverified which client).
  On the PA-24, the stock yoke didn't move and our masker heard none, which fits Accu-Sim's group sitting ahead of ours (unverified).
- At 10,001,000, 100,000,000, 1,900,000,000, and 2,000,000,000, the send got past our group.
  On the PA-24 the stock `A:YOKE Y POSITION` followed at half, ±16.3% against ±32.6% unmasked, at every one of the four.
  On the 777 it followed at half, ±50%, from 100,000,000 down, and didn't move at 10,001,000, where something took the event first, likely PMDG's group (unverified).
- The 777's own yoke, `L:yokes_Fore_Aft`, followed none of the sends.
  One possible cause: our sends arrive as `SIMCONNECT_RECV_EVENT_EX1`, while the hardware's arrive as `SIMCONNECT_RECV_EVENT`, as our listener received them, and a module that handles only the second would mask the first and drop it (unverified).
  Sending with the legacy `SimConnect_TransmitClientEvent` would settle it.
- The value we put in an event's fifth parameter reaches every listener: our masker recognized its own sends by it.

**Changed:** sending an input back changed works on stock flight controls from 10,001,000 down.
On the 777 it's unsettled, so mixing two pilots' inputs there isn't shown to work.

**Affects:** the idea [Mixed flight controls](../product/ideas.md#mixed-flight-controls); the comment on `TAG` in `experiments/areas/aircraft/lib/sim.mjs`, which calls the fifth parameter's delivery unmeasured.

**Evidence:** [the Baron's run](../../../experiments/areas/flight-controls/results/p01-mask-2026-10-01-20-39-35.txt), [the PA-24's](../../../experiments/areas/flight-controls/results/p01-mask-2026-10-01-20-46-10.txt), and [the 777's](../../../experiments/areas/flight-controls/results/p01-mask-2026-10-01-20-59-42.txt), with each send and arrival in the `.ndjson` beside each.

## 2026-10-01: The mask registered first gets ahead of Accu-Sim's

**Asked:** does Crosscheck's mask at 10,000,000 stop the A2A PA-24's input?

**Expected:** no prediction.
We missed that the SDK gives a group asking for a taken priority the next lower free one ([04-02](../../learn/foundations/04-02-events.md#client-events)), which predicts what we found.

**Found:**

- With the aircraft loaded before our masks went in, Accu-Sim got the input.
  `L:ElevatorInput` and `L:Throttle1Position` covered their full range with the masks on, and our masker heard none of the hardware's events.
  It heard only the aircraft's own `K:AXIS_ELEVATOR_SET`, within ±5,349, which drives the stock elevator to ±32.6%, and masking those froze the stock yoke while Accu-Sim's input kept moving.
- With our masks in place before the PA-24 loaded through SimConnect, our masker heard all 467 elevator events across ±16,380, and neither variable moved.
  Once the masks cleared, both covered their full range.
- The masks survived the flight load.
- Both results follow from the SDK's rule: whichever group asks second for a priority is placed behind the first.

**Changed:** on an aircraft that masks at 10,000,000, Crosscheck's group gets ahead only if it registers before the aircraft's module, so Crosscheck has to connect before the flight starts.
Whether its masks stay first across later aircraft changes was measured for one load only.
A mask on an event the aircraft also sends, such as the PA-24's own `K:AXIS_ELEVATOR_SET`, catches the aircraft's output too.

**Affects:** the idea [Mixed flight controls](../product/ideas.md#mixed-flight-controls).

**Evidence:** [masks after the aircraft](../../../experiments/areas/flight-controls/results/p01-mask-2026-10-01-20-46-10.txt) and [masks before it](../../../experiments/areas/flight-controls/results/p01-mask-2026-10-01-20-55-38.txt).

## 2026-10-01: Masking stops a pilot's hardware input, and closing the masking client gives it back

**Asked:** does a SimConnect client's maskable group at 10,000,000, `SIMCONNECT_GROUP_PRIORITY_HIGHEST_MASKABLE`, keep the pilot's own axis input out of the sim, and does the input come back when the client goes away?

**Expected:** no prediction: the SDK says a maskable group ahead of the sim stops the event, and a forum thread says masking never worked in MSFS ([04-02](../../learn/foundations/04-02-events.md#client-events)).

**Found:**

- On the Black Square Baron 58P, whose flight controls are stock, the yoke and throttle lever stayed at 0% of their unmasked range while masked, and the masker heard every event: 103 for the elevator, and 335 and 342 for the two throttles.
- Masking the Baron's throttle key events also stopped the throttle's input event, `ENGINE_THROTTLE_1`, which otherwise follows the lever.
- On the PMDG 777, masks at 10,000,000 held `L:yokes_Fore_Aft` and the throttle lever still.
- Clearing the group gave the controls back within the next 5s window, and so did killing the masking process outright, with no cleanup: 104% and 98% of the unmasked range on the Baron, and 100% on the PA-24 and the 777.
- The same throttle fired `K:AXIS_THROTTLE1_SET` on the Baron and the PA-24, and `K:THROTTLE1_AXIS_SET_EX1` on the 777, so the event a binding fires can change with the aircraft (cause unverified).
- In the first run's trim step on the Baron, nobody touched the trim, yet `A:ELEVATOR TRIM PCT` moved from 14.7% to 19.6% and the input event `HANDLING_ELEVATORTRIM_1` changed, with none of the four trim key events we listened for.
  Something in the aircraft or the sim moved it (unverified which), so this shows nothing about hardware input that goes around key events.

**Changed:** masking key events blocks a pilot's hardware input, and the block ends when the masking client dies, so a crashed Crosscheck leaves the pilot with working controls.

**Affects:** the ideas [Soft takeover on handover](../product/ideas.md#soft-takeover-on-handover) and [Mixed flight controls](../product/ideas.md#mixed-flight-controls); [04-02](../../learn/foundations/04-02-events.md#unverified-claims), whose list of unverified claims has "Masking works in MSFS 2024".

**Evidence:** [the Baron's run](../../../experiments/areas/flight-controls/results/p01-mask-2026-10-01-20-39-35.txt), [its first, interrupted run](../../../experiments/areas/flight-controls/results/p01-mask-2026-10-01-20-28-54.txt) for the trim, [the PA-24's](../../../experiments/areas/flight-controls/results/p01-mask-2026-10-01-20-46-10.txt), and [the 777's](../../../experiments/areas/flight-controls/results/p01-mask-2026-10-01-20-59-42.txt).
