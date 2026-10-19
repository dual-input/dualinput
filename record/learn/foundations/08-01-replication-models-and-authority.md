# Synchronization: replication models and authority

- [Replication models: state, input, lockstep, hybrid](#replication-models-state-input-lockstep-hybrid)
- [Authority: pilot in control, per-system or per-control ownership, handover, contention](#authority-pilot-in-control-per-system-or-per-control-ownership-handover-contention)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Echo loops and initial sync are in [08-02-echoes-and-initial-sync](08-02-echoes-and-initial-sync.md), ordering and classes of data in [08-03-ordering-and-classes-of-data](08-03-ordering-and-classes-of-data.md), change detection, relative actions, and flight controls in [08-04-rates-actions-and-flight-controls](08-04-rates-actions-and-flight-controls.md), position and clocks in [08-05-position-and-clocks](08-05-position-and-clocks.md), and divergence and two pilots on one screen in [08-06-divergence-and-one-screen](08-06-divergence-and-one-screen.md).

Every earlier part looked at one sim, and this part is about keeping two in agreement.
Its worked examples come from FS Copilot's source in our fork, and from two things our fork added: pointer forwarding, which carries presses on cockpit displays, and traffic, which copies one pilot's AI aircraft into the other's sim.
We call the machine of the pilot in control the flying machine, and the other the following machine; FS Copilot's code calls them master and slave.

## Replication models: state, input, lockstep, hybrid

Two machines can share a cockpit by sending what changed (state), what the pilot did (input), or what the pilot did along with a rule that every machine applies it at the same simulated step (lockstep).
FS Copilot sends state for some data and input for the rest, which makes it a hybrid, and lockstep isn't open to MSFS.

**How it works.**
[07](07-aircraft-specific-systems.md#causes-vs-effects) split each control into a cause, which the pilot's hand changes, and effects, which the aircraft computes from the cause.
The models differ in which half travels, and so in where the receiver's copy can go wrong.

- **State.**
  The sender reads a value and sends it, and the receiver writes it.
  The receiver's copy is right as soon as the write lands, whatever it held before, but a value the receiver's own systems compute gets computed again and fights the write ([04-01](04-01-connection-and-data.md#writing-data)).
  Fiedler's snapshot interpolation is this model for game objects: the receiver doesn't simulate them, but draws them between the snapshots it has [1].
- **Input.**
  The sender sends what the pilot did, such as a press, and the receiver does the same.
  Each machine computes the result, which comes out the same only if both aircraft were in the same state first ([07](07-aircraft-specific-systems.md#hidden-state)).
- **Lockstep.**
  Every machine runs the same simulation and applies each input at the same step, waiting for every machine's input before it advances.
  Age of Empires ran "the exact same simulation on each machine", and scheduled commands issued in turn 1000 for turn 1002, so they had time to arrive [2].
  It needs a simulation that computes exactly the same result from the same inputs, because any difference grows until the machines disagree [3].
  MSFS offers neither half.
  Two machines run their own frames ([02-03](02-03-the-running-sim.md#the-sim-loop)) and needn't compute the same result from the same inputs ([07](07-aircraft-specific-systems.md#sources-of-divergence)), and nothing in our records can hold the sim at a step until another machine's input arrives.
- **Hybrid.**
  Different data travels under different models.
  Fiedler's state synchronization runs the simulation on both machines and sends both inputs and state [4].

FS Copilot is a hybrid, read from its source [5]:

| What it syncs | Model | How |
| --- | --- | --- |
| Position, attitude, velocities, and control surfaces | State, from the flying machine | Sampled every 50ms, and written into the frozen following aircraft every frame |
| `master:` profile entries, such as throttles | State, from the flying machine | Sampled every 30ms |
| `shared:` profile entries, such as switches and the autopilot | State read, cause written, from either machine | Sent on change, and applied through the entry's `set:`, which usually fires the event that changes the state ([07](07-aircraft-specific-systems.md#causes-vs-effects)) |
| Clicks on HTML displays, and our fork's pointer gestures | Input, from either machine | Replayed on the other machine's display ([06-03](06-03-display-kinds-input-and-pop-outs.md#display-kinds-html-react-on-dom-react-on-svg-canvas-wasm-gauges)) |
| `H:` events | Input, from either machine | Held 500ms, then fired on the other machine ([03-02](03-02-events-and-other-namespaces.md#h-html-events)) |
| Everything else the aircraft computes, such as engines and electrics | Neither | Each machine runs its own, fed by the synced causes |

The freeze events stop the sim moving the following aircraft ([04-01](04-01-connection-and-data.md#writing-data)), and its engines and systems keep running on that machine, though whether it keeps burning fuel is unmeasured ([07](07-aircraft-specific-systems.md#unverified-claims)).

**What it changes for Dual Input.**
Each kind of data needs a model, and the model decides where divergence can come from: state fights whatever the receiver's systems recompute, and input drifts wherever the two aircraft already differed.
Lockstep stays out of reach unless something can make MSFS wait for another machine's input.

**Traps.**

- Input replayed onto a different state does something else: a press replayed onto a display that shows another page presses whatever sits at that spot on the receiver's page [6].
- Two paths for one control actuate it twice.
  Our fork syncs a display either by element name or by pointer, and takes an instrument in pointer mode off the element-name path in both directions, so "one press never actuates twice" [6].
- FS Copilot profiles' `docs/synchronization.md` describes FS Copilot's sync in more detail than any other document, and disagrees with the source: it says latitude and longitude are interpolated along the sphere, and `interpolators.h` interpolates them in a straight line [5] [7].
  We trust the source, here and wherever the two differ.

## Authority: pilot in control, per-system or per-control ownership, handover, contention

For each value, one machine's copy is the one that counts, and every machine has to agree which.
FS Copilot gives the flight path and its `master:` entries to the pilot in control, lets either machine change a `shared:` entry, and gives control to whichever machine claimed it last, with no rule for claims or writes that cross in the network.

**How it works.**
[01](01-prior-art-and-crew-practice.md#prior-art) compared how each tool moves control: FSX offered and accepted it, YourControls gives it, and FS Copilot takes it.
FS Copilot's `MasterSwitch` does it this way [8]:

1. Every app starts in control, and joining a session makes the joiner follow.
2. Taking control, from the app or with `K:TOGGLE_LAUNCH_BAR_SWITCH`, puts the machine in control and sends `SetMaster` with its own peer ID.
3. A machine that receives `SetMaster` is in control if the ID is its own, and follows otherwise.
4. A machine sends `SetMaster` only when it becomes the one in control.

So the last claim a machine hears decides its role.
With two pilots, claims can't cross: the machine in control has nothing to take, so only the follower sends a claim.
With three, two followers who take control within one network delay each hear the other's claim after their own, so both end up following, and the third drops to following on hearing either claim, since a machine tracks only its own role and neither claim names it: nobody flies (unverified).

Our fork's rule for who hosts traffic and ATC converges instead.
Each machine keeps the set of machines that have claimed a feature, and the host is the smallest peer ID in the set, "so the outcome is the same everywhere whatever order the packets arrived in" [9].

Authority can also be split by control.
A `master:` entry flows only from the flying machine, and a `shared:` entry from either ([03-03](03-03-reading-and-writing.md#precision-change-thresholds-and-value-types-on-the-wire)).
SmartCopilot and JoinFS split further, and JoinFS can give its "flight", "engine", and "other" groups to different co-pilots ([01](01-prior-art-and-crew-practice.md#prior-art)).

Handover also covers the pilot in control leaving.
When that pilot leaves a YourControls session, the host takes control back [10].
In FS Copilot the remaining pilot stays a follower, "with their sim in slave control mode and nobody feeding it" [11].
Its app keeps writing the following role to its module every 200ms, and the module unfreezes the aircraft only after 1s without that write ([05-01](05-01-kinds-lifecycle-and-apis.md#lifecycle-init-per-frame-update-deinit)), so the aircraft stays frozen until its pilot takes control [8].

Contention over a `shared:` value works like contention over the role.
If one pilot turns a switch on and the other turns it off within one network delay, each machine applies the other's change after its own, so the first machine ends off and the second on (unverified) [5].
Neither sends again, because each machine drops its sim's report of the write as an echo ([08-02](08-02-echoes-and-initial-sync.md#echo-loops-and-suppressing-them)).
Our fork's pointer notes accept the same limit for displays: they don't guarantee "convergence under concurrent conflicting input on the same panel within a latency window" [6].
A two-pilot Airbus meets it in hardware, where simultaneous sidestick inputs add up and a DUAL INPUT voice warns the crew ([01](01-prior-art-and-crew-practice.md#crm-callouts-and-transfer-of-control)).

**What it changes for Dual Input.**
Dual Input needs an owner for each value that every machine works out the same way, whatever order the messages arrived in, and a rule for two claims or two writes that cross.
Whether control is taken, given, or offered and accepted, what becomes of it when its pilot leaves or drops, and whether some switches belong to one seat are open questions.

**Traps.**

- Nothing in FS Copilot notices two machines in control, or none.
  With two in control, each sends its position and ignores the other's, so each pilot flies their own aircraft (unverified) [5].
- The profiles repo's document says crossing claims leave every machine in agreement "within ~100ms" [7], and the source gives the outcome above; we trust the source.
- FS Copilot takes control whenever it hears `K:TOGGLE_LAUNCH_BAR_SWITCH`, so an aircraft with a real launch bar, or a hardware button bound to that event, may take control when used (unverified) [8].

## Sources

1. Documented: Glenn Fiedler, [Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/), Gaffer On Games, 2014-11-30.
2. Documented: [1500 Archers on a 28.8: Network Programming in Age of Empires and Beyond](https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond), Game Developer, 2001-03-22, bylined Paul Bettner.
3. Documented: Glenn Fiedler, [Deterministic Lockstep](https://gafferongames.com/post/deterministic_lockstep/), Gaffer On Games, 2014-11-29.
4. Documented: Glenn Fiedler, [State Synchronization](https://gafferongames.com/post/state_synchronization/), Gaffer On Games, 2015-01-05.
5. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/Simulation/Coordinator.cs`, both `AddLink` methods; `FsCopilot/Simulation/Definitions.cs`, `ApplyTo`; `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `apply_control` and `interpolate`; and `FsCopilot.Bridge.Wasm/interpolators.h`.
6. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, sections "0.4 Edge cases, and what each does", "0.6 What it does not guarantee", and "10 · Known limits".
7. Documented, and older than the source it describes: FS Copilot profiles at d3d7689, `docs/synchronization.md`, sections "Interpolation Algorithm" and "Race Conditions".
8. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/Simulation/MasterSwitch.cs`; `FsCopilot/ViewModels/MainViewModel.cs`, `JoinCommand`; `FsCopilot/Connection/SimClient.cs`, the constructor's 200ms write of the control state; and `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `Update_StandAlone`.
9. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Simulation/ShareSwitch.cs`, the class comment and `Recompute`.
10. Documented, read from source: [YourControls](https://github.com/YourControls/yourcontrols) at commit 31b1706, `src/yourcontrols/src/program/network.rs`, the `PlayerLeft` branch.
11. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, "R02 · The master leaving on purpose locks the slave".

## Unverified claims

- **Two followers who take control at once leave all three machines following.**
  We read it from `MasterSwitch.cs` [8].
  Three app instances on one PC, with two of them taking control a few milliseconds apart and every instance's role logged, would settle it.
- **Crossing writes to a `shared:` entry leave the two machines swapped.**
  We read it from `Coordinator.cs` and `Definitions.cs` [5].
  Two machines flipping one `shared:` switch opposite ways within 50ms of each other, from a script, and reading the switch on both, would settle it.
- **With two machines in control, each pilot flies their own aircraft.**
  Nothing in FS Copilot checks for it [5], and nobody has seen it happen.
  Forcing both instances of the two-instance bench into control and logging which packets each applies would settle it.
- **A launch bar or a bound button takes control.**
  FS Copilot listens for the event [8], and which sources of a key event a SimConnect listener hears is unmeasured ([04-02](04-02-events.md#unverified-claims)).
  Firing `K:TOGGLE_LAUNCH_BAR_SWITCH` from a bound hardware button, and from an aircraft's own XML, with FS Copilot running would settle it.
