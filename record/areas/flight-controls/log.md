# Flight controls: log

What our experiments found about keeping a pilot's own flight controls out of the sim, newest entry first.
A SimConnect client's mask at 10,000,000 blocks the pilot's hardware input and gives it back when the client dies.
Two groups can't share a priority, so on an aircraft whose module asks for the same one, the group that registers first is ahead.
A value sent back at half reaches the sim from 10,001,000 down, and the PMDG 777's own yoke takes it only when it's sent with the legacy `SimConnect_TransmitClientEvent`.
The probe is [p01-mask.mjs](../../../experiments/areas/flight-controls/p01-mask.mjs), and its raw output is in [experiments/areas/flight-controls/results](../../../experiments/areas/flight-controls/results).
Every entry was measured on MSFS 2024 SunRise 12.2.282174.999 on 2026-10-01, with the yoke and throttle on our development machine.

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
