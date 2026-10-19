# Synchronization: rates, actions, and flight controls

- [Change detection, sample rates, bandwidth budgets](#change-detection-sample-rates-bandwidth-budgets)
- [Relative vs. absolute actions](#relative-vs-absolute-actions)
- [Flight controls: who flies, and local hardware fighting synced values](#flight-controls-who-flies-and-local-hardware-fighting-synced-values)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Replication models and authority are in [08-01-replication-models-and-authority](08-01-replication-models-and-authority.md), echo loops and initial sync in [08-02-echoes-and-initial-sync](08-02-echoes-and-initial-sync.md), ordering and classes of data in [08-03-ordering-and-classes-of-data](08-03-ordering-and-classes-of-data.md), position and clocks in [08-05-position-and-clocks](08-05-position-and-clocks.md), and divergence and two pilots on one screen in [08-06-divergence-and-one-screen](08-06-divergence-and-one-screen.md).

As in [08-01](08-01-replication-models-and-authority.md), the flying machine is the pilot in control's, and the following machine is the other.

## Change detection, sample rates, bandwidth budgets

A sender sets three things: a threshold, for what counts as a change; a sample rate, for how often it looks; and a heartbeat, for when it sends anyway.
Together they set the bandwidth, and how late and how coarse the receiver's copy is.

**How it works.**
FS Copilot's settings, read from its source [1] [2]:

| Stream | Looks | A change is | Sends |
| --- | --- | --- | --- |
| `shared:` entries read through SimConnect | Every simulated frame | Any difference | Every change |
| Entries its module reads, such as `B:` and `Z:` | Every frame | A difference over 1e-6 | Every change |
| `master:` entries | Every simulated frame | Any difference | The newest, at most every 30ms |
| Physics, 116 bytes a packet | Every simulated frame | Any difference | The newest, at most every 50ms |

Sampling sends the newest value in each window, and only if one arrived, so a stream that doesn't change sends nothing.
Physics costs at most 116 bytes 20 times a second, 2.3 KB/s before headers [2].
A threshold of 0 also sends every tick of anything clock-like: over 4 minutes of an untouched PA-24, two counters made 87% of the change records ([03-03](03-03-reading-and-writing.md#enumerating-vs-observing)).

Our fork's traffic sender uses all three settings [3]:

- **A threshold for each field**: about 0.1 m of position, 0.5 feet of altitude, 0.1° of heading, pitch, or bank, 0.5 knots of ground speed, 0.05 of gear handle position (5% of its travel), and any change of flaps, engines, or lights.
- **A heartbeat every 5s**, which its source calls "loss insurance on an unreliable channel, not a rate".
- **The last quiet sample first**: when a change follows a quiet stretch, it sends the last unchanged sample before the new one, so the receiver doesn't spread the first step of motion across the whole quiet stretch.

At a busy gate this passed about 20% of samples, bringing 130 aircraft at 2Hz from 8.3 KB/s to 1.8 KB/s.
A replay of the gated capture scored 0.14 to 0.23 for smoothness, against 0.17 ungated [4].
The smoothness score is defined in [08-05](08-05-position-and-clocks.md#position-and-attitude-freeze-and-set-slew-dead-reckoning-interpolation-buffers-jitter-time-shift-ground-contact), where 0 is constant motion.

The sample rate sets how coarse the receiver's path is [5]:

| Traffic sample rate | Smoothness, median | Worst | What it looked like |
| --- | --- | --- | --- |
| 2Hz | 0.17 | 0.17 | Uniform |
| 1Hz | 0.15 | 0.5 to 0.75 | Occasional holds when a sample was late |
| 0.5Hz | 0.13 | 1.6 to 1.7 | Frequent stalls, and every aircraft 2s behind |

The median stays flat because the receiver interpolates between samples at any rate.
What gets worse is the end of each segment, where an aircraft reaches its last known point and waits, and the score doesn't see corners cut on turns either [5].

When there are more objects than the budget carries, Fiedler's priority accumulator sends the most important: each frame it adds each object's priority to a running total, sends the objects with the highest totals that fit, and keeps the others' totals for the next frame [6].

**What it changes for Dual Input.**
Dual Input needs a threshold, a sample rate, and a heartbeat for each class of data, set from what the receiving aircraft can tell apart and what a pilot can see.
Its budget has to include what a relay sends on to each other machine, which [part 9](outline.md#9-networking-full-from-the-ground-up) covers.
How many changes a second a busy airliner cockpit produces is an open question.

**Traps.**

- A heartbeat must not feed a delay estimate.
  The traffic receiver ignores the spacing of quiet samples, because a 5s heartbeat would "drag the render point a second and a half into the past" [7].
- A stream that sends only changes, without resending, loses its final value, which is what the traffic sender's repeated stop prevents ([08-03](08-03-ordering-and-classes-of-data.md#classes-of-data-what-must-arrive-vs-what-can-be-dropped)).
- The profiles repo puts a whole FS Copilot session at about 5 KB/s per peer, and that figure is arithmetic, not a measurement [8].

## Relative vs. absolute actions

An absolute action sets a value, such as flaps to 2, and lands in the same place on any aircraft however many times it runs.
A relative action, such as a toggle, a detent, or a press, lands relative to the receiver's current state, so replaying it onto a different state, or twice, moves the two aircraft further apart.

**How it works.**
[03-02](03-02-events-and-other-namespaces.md#k-key-events) showed that a key event is an action, and [07](07-aircraft-specific-systems.md#control-semantics) sorted controls by what syncing them takes.
In a sync, a relative action goes wrong three ways:

- **Applied twice.**
  FS Copilot's `SimClient.Set` sends a `K:` event through SimConnect and then, because its branches are `if`s with no `else`, runs it again as calculator code [9] [10].
  For a PC-12 `master:` entry whose `set:` is `(>K:TOGGLE_STARTER1)`, both would fire, leaving the following machine's starter off while the flying machine's is on (unverified).
  fsc-editor wrote a probe for it, and nobody has run it [11].
- **Applied to a different state.**
  A press replayed onto a display that shows another page presses whatever is there ([08-01](08-01-replication-models-and-authority.md#replication-models-state-input-lockstep-hybrid)), and an encoder counter synced as a value may jump many detents ([07](07-aircraft-specific-systems.md#unverified-claims)).
- **Merged.**
  Several A220 baro detents can land inside one poll, so the receiver sees one step where the pilot made several ([07](07-aircraft-specific-systems.md#control-semantics)).

The fix in our records is to send the state the action produced and work out the action on the receiver.
The A220 profile's autopilot entry reads `L:A22X AP Master` and fires the toggle only when the received value differs from the local one ([07](07-aircraft-specific-systems.md#control-semantics)), so a repeated message changes nothing, and the next update corrects a lost one.
A value can then be resent freely, in a snapshot or a heartbeat, and an action only with the numbering and the check for copies that [08-03](08-03-ordering-and-classes-of-data.md#ordering-sequence-numbers-deduplication-idempotency-last-writer-wins) describes.

**What it changes for Dual Input.**
For each control synced as an action, Dual Input needs one of two things: the state the action changes, so it can send the state and work out the action on the receiver, or both aircraft equal to begin with and every action delivered exactly once.
Controls with only relative events and no readable state, such as the A220's chronograph ([07](07-aircraft-specific-systems.md#hidden-state)), are the open cases.

**Traps.**

- A display press is absolute in where it lands and relative in what it does: sent as a position, it still acts on whatever page the receiver shows [12].
- A guard that compares against a value the machine hasn't read yet doesn't guard, so FS Copilot's first apply after connecting is never guarded ([07](07-aircraft-specific-systems.md#control-semantics)).

## Flight controls: who flies, and local hardware fighting synced values

Only one machine's flight model can fly the aircraft, so the pilot in control's stick and throttles drive it, and the other machine copies the result.
The following pilot's own hardware still sends its inputs into their sim, and nothing in our records stops those inputs or measures what they do against the copied values.

**How it works.**
On the following machine, FS Copilot's module writes each control surface twice every frame, under the comment "correct usage depends on aircraft. we use both" [13]:

- As `A:AILERON POSITION`, `A:ELEVATOR POSITION`, and `A:RUDDER POSITION`, in `Position 16k`.
- As `K:AXIS_AILERONS_SET`, `K:AXIS_ELEVATOR_SET`, and `K:AXIS_RUDDER_SET`, with the sign flipped.

The `master:` entries, such as throttles and brakes, arrive at most every 30ms, and only when the flying pilot's control moves [1].

The following pilot's stick and levers still reach their sim, through the same axis events.
On the A220, the systems module registers handlers for `AXIS_AILERONS_SET`, `AXIS_ELEVATOR_SET`, `AXIS_RUDDER_SET`, and the throttle axes [14], so on that aircraft FS Copilot's writes and the following pilot's hardware feed the same code (unverified).

Two cases follow from the source, and neither is measured:

- A following pilot who moves their throttle lever sets their own sim's throttle, and it stays there until the flying pilot's throttle next moves, because a `master:` entry is sent only on change [1] (unverified).
- At a handover, the new flying pilot's hardware becomes the source, so if their levers sit somewhere else, the throttles go there on the next axis event their hardware sends (unverified).

A two-pilot Airbus meets the same problem in hardware, and answers it by adding simultaneous sidestick inputs and announcing DUAL INPUT ([01](01-prior-art-and-crew-practice.md#crm-callouts-and-transfer-of-control)).
Keeping the following pilot's hardware out of their sim takes SimConnect's masking, which works on MSFS 2024 when Dual Input's group sits ahead of the aircraft's own ([04-02](04-02-events.md#client-events)).

**What it changes for Dual Input.**
Dual Input needs a rule for what the following pilot's hardware does, whether ignored, blocked, or combined, and a handover that copes with two sets of levers in different places.
Blocking is open to it, as long as it registers its masks before the aircraft's module does ([04-02](04-02-events.md#client-events)).

**Traps.**

- No one write path suits every aircraft, which is why FS Copilot writes both a variable and an event for each surface [13].
- What a write to `A:ELEVATOR POSITION` does while the pilot holds the stick is unmeasured ([04-01](04-01-connection-and-data.md#unverified-claims)).

## Sources

1. Documented, read from FS Copilot's source: fsc-editor, `docs/fscopilot-behavior.md`, section "How a change leaves this machine", checked against `FsCopilot/Simulation/Coordinator.cs`, `AddLink(Definition)`, in the FS Copilot fork at 9d4e864.
2. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/Connection/SimClient.cs`, `Stream<T>`, which requests `SIM_FRAME` with the `CHANGED` flag; `FsCopilot.Bridge.Wasm/var_watcher.h`, the 1e-6 threshold; `FsCopilot/Simulation/Coordinator.cs`, `AddLink<TPacket>`, the 50ms sample; and `FsCopilot.Bridge.Wasm/protocol.h`, `sizeof(physics) == 116`.
3. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/Simulation/TrafficGate.cs`, the class comment and `Changed`; `FsCopilot/Simulation/TrafficDefinitions.cs`, the units of `ObjectState`; and `FsCopilot/Simulation/TrafficHost.cs`, the 5s `Heartbeat`.
4. Measured on MSFS 2024, 2026-09-06, the rates computed over recorded captures and the smoothness from replaying a gated capture into the sim: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · The change gate: 20 % of samples, 8.3 → 1.8 KB/s".
5. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Jitter measured, not eyeballed — freeze + per-frame writes wins; Q16 settled", the rate floor table.
6. Documented: Glenn Fiedler, [State Synchronization](https://gafferongames.com/post/state_synchronization/), Gaffer On Games, 2015-01-05, section on the priority accumulator.
7. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Simulation/TrafficInterpolator.cs`, the comment in `Push`.
8. Documented, and older than the source it describes: FS Copilot profiles at d3d7689, `docs/synchronization.md`, section "Bandwidth Usage".
9. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Connection/SimClient.cs`, `Set`.
10. Documented, read from FS Copilot's source: fsc-editor, `docs/fscopilot-behavior.md`, section "How writes reach the sim".
11. Documented in our record: fsc-editor, `docs/sim-vars/build/double-write-probe.md`, whose status is "unrun".
12. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, sections "0.6 What it does not guarantee" and "10 · Known limits".
13. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `apply_control` for control surfaces.
14. Documented in our record, read from the aircraft's files: fsc-editor, `docs/aircraft/synaptic-a220.md`, section "Key events the WASM intercepts".

## Unverified claims

- **FS Copilot fires a `K:` event twice from a `master:` entry.**
  We read it from `SimClient.cs` [9], and fsc-editor's probe for it hasn't run [11].
  Running that probe, with the PC-12 cold and dark and a starter toggled from the other machine, would settle it.
- **The A220's axis handlers take both FS Copilot's writes and the following pilot's hardware.**
  We read the handler list from the module's strings [14].
  Moving the following pilot's stick while FS Copilot writes the surfaces, and logging `A:AILERON POSITION` on both machines, would settle it.
- **A following pilot's throttle lever holds until the flying pilot's next change, and a handover moves the throttles to the new pilot's levers.**
  Both follow from the source [1].
  A two-machine flight that moves the following pilot's throttle hardware, then hands over with the two sets of levers apart, while logging `A:GENERAL ENG THROTTLE LEVER POSITION:1` on both machines, would settle both.
