# Synchronization: divergence and two pilots on one screen

- [Detecting divergence and correcting it](#detecting-divergence-and-correcting-it)
- [Two pilots on one screen](#two-pilots-on-one-screen)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Replication models and authority are in [08-01-replication-models-and-authority](08-01-replication-models-and-authority.md), echo loops and initial sync in [08-02-echoes-and-initial-sync](08-02-echoes-and-initial-sync.md), ordering and classes of data in [08-03-ordering-and-classes-of-data](08-03-ordering-and-classes-of-data.md), change detection, relative actions, and flight controls in [08-04-rates-actions-and-flight-controls](08-04-rates-actions-and-flight-controls.md), and position and clocks in [08-05-position-and-clocks](08-05-position-and-clocks.md).

As in [08-01](08-01-replication-models-and-authority.md), the flying machine is the pilot in control's, and the following machine is the other.

## Detecting divergence and correcting it

Two cockpits drift apart through lost or reordered messages, relative actions landing on different states, writes that cross, and each machine's own computation.
A sync that sends only changes never notices.
Detecting it takes comparing something both machines hold, and correcting it takes a rule for whose copy is right.

**How it works.**
Lockstep games compare everything, because their machines must agree exactly.
Age of Empires computed checksums over "the world, the objects, the pathfinding, targeting and every other system", and still found "always one more thing that slipped just under the radar" [1].

FS Copilot compares nothing between machines: none of its packet types carries a checksum, and the only values it resends on a timer, position and control surfaces every 50ms, go one way, with nothing on the following machine to compare them against [2].
Its signals are all local:

| Signal | From | What it means |
| --- | --- | --- |
| `Possible desync detected.` | FS Copilot's skip counter | A write drew no report before the next local change ([08-02](08-02-echoes-and-initial-sync.md#echo-loops-and-suppressing-them)) |
| `events from the peer never arrived - panels may be desynced` | Our fork's pointer path | A gap in the sender's sequence numbers ([08-03](08-03-ordering-and-classes-of-data.md#ordering-sequence-numbers-deduplication-idempotency-last-writer-wins)) |
| `missed` | Our fork's counters for each display | A replayed press found nothing at its position, which points at the two machines' displays differing in size or layout rather than at transport [3] |

In a three-way session on 2026-09-08, our machine counted 168 presses captured, 70 replayed, and 0 missed on the A220's display units [4].
Whether the display measured the same size on the other machines is still open, because nobody read their logs [4].

Our records use four ways to correct:

- **Resend state now and then**, as the traffic sender's 5s heartbeat does ([08-04](08-04-rates-actions-and-flight-controls.md#change-detection-sample-rates-bandwidth-budgets)).
- **Compare state and write the cause**, as the A220 autopilot entry does when it fires the toggle only if the states differ, so every update it receives also corrects the receiver ([08-04](08-04-rates-actions-and-flight-controls.md#relative-vs-absolute-actions)).
- **Hold one side still and replay what it missed**, as the pointer path does after an outage ([08-02](08-02-echoes-and-initial-sync.md#initial-sync-a-snapshot-on-join-late-join-resync-after-reconnect)).
- **Leave it to the pilots**, who bring two displays back together by pressing the same page button ([Two pilots on one screen](#two-pilots-on-one-screen)).

Fiedler eases a correction to a moving object in rather than snapping it: he shrinks a position or orientation error a little each frame, and a large error faster than a small one [5].

fsc-editor designed a check that catches one kind of divergence before anyone flies: a profile entry bound to a variable the aircraft overwrites.
It would write a candidate variable and watch whether the aircraft "stomps it back within a few hundred milliseconds", because "A variable that reverts shortly after being written will desync if bound" [6].
Nobody has built it ([07](07-aircraft-specific-systems.md#causes-vs-effects)).

**What it changes for Dual Input.**
Dual Input needs values that both machines hold and it can compare cheaply while the pilots fly, and for each one, which machine's copy is right ([08-01](08-01-replication-models-and-authority.md#authority-pilot-in-control-per-system-or-per-control-ownership-handover-contention)).
The states a callout names, such as flap position and FMA modes, have to match for the pilot monitoring to cross-check the aircraft the other pilot flies ([01](01-prior-art-and-crew-practice.md#crm-callouts-and-transfer-of-control)).
Which of them each aircraft exposes is an open question.

**Traps.**

- A value that both machines compute from their own inputs can differ with nothing wrong, such as the fuel a frozen following aircraft may or may not burn ([07](07-aircraft-specific-systems.md#unverified-claims)).
- A comparison sees only state it can read, and the divergence that costs most, such as an FMS on another page or a different flight plan, often has no variable to read ([07](07-aircraft-specific-systems.md#hidden-state)).
- Correcting by writing an effect fights the model that computes it ([07](07-aircraft-specific-systems.md#causes-vs-effects)).
- Agreement between two aircraft can't be tested on one PC.
  Our records test the wire and the app with both pilots on one machine, and fsc-exerciser says of itself: "What is exercised is the wire and the app's handling of it, not two aircraft staying in agreement" [7].

## Two pilots on one screen

When both pilots work one display at the same moment, such as an FMS keypad or a touchscreen, each machine applies its own input first and the other pilot's a network delay later, so the two displays can end on different pages or with different entries.
A display seldom has a state to send, so no later message corrects it.
Our fork accepts that, recovers by having both pilots press the same page button, relies on a convention of one pilot per panel, and locks a panel only while the session is connecting, the peer is lost, or a backlog is replaying.

**How it works.**
A shared switch and a shared screen fail differently when two hands reach them at once:

| | A shared switch | A shared screen |
| --- | --- | --- |
| What travels | A value both machines can read, or the cause worked out from it ([07](07-aircraft-specific-systems.md#causes-vs-effects)) | Each input, as a press position or a key, because the page, the cursor, and the scratchpad live in the display's own code ([07](07-aircraft-specific-systems.md#hidden-state)) |
| Two pilots at once | Two values cross, and the machines can end swapped ([08-01](08-01-replication-models-and-authority.md#authority-pilot-in-control-per-system-or-per-control-ownership-handover-contention)) | Two sequences of inputs interleave in a different order on each machine |
| What brings them back together | Any later message that carries the value | The same inputs in the same order on both, which means undoing the input each display has already applied |
| Echo guard | A counter for each variable ([08-02](08-02-echoes-and-initial-sync.md#echo-loops-and-suppressing-them)) | A mark on each event dispatched ([08-02](08-02-echoes-and-initial-sync.md#echo-loops-and-suppressing-them)) |

Suppose one pilot types 1 and 2 on an FMS keypad whose keys travel as `H:` events ([03-02](03-02-events-and-other-namespaces.md#h-html-events)), while the other types A and B.
Each machine shows its own keys at once and the other pilot's at least 500ms later, since FS Copilot holds every `H:` event that long ([08-02](08-02-echoes-and-initial-sync.md#echo-loops-and-suppressing-them)), so one scratchpad would read `12AB` and the other `AB12` (unverified).
A press on a touchscreen works the same way: sent as a position, it acts on whatever page the receiver shows ([08-04](08-04-rates-actions-and-flight-controls.md#relative-vs-absolute-actions)).

Our fork's implementation plan names the cause: "each side applies its own input first, and page navigation doesn't commute" [8].
It also names the limit: "No input-replay design fixes this without rollback, which panels can't do", and FS Copilot's older element-name sync "has the same property invisibly" [8].
Its answer is recovery rather than prevention: "panel chrome sits at fixed coordinates, so both pilots pressing the same page button converges a diverged panel" [8].

What the fork does prevent, it prevents with visible overlays that block input on an opted-in display [3] [9]:

| Session state | Flying machine's display | Following machine's display | Why |
| --- | --- | --- | --- |
| Connecting | Locked, blue | Locked, blue | A press made before a peer is live has nobody to go to |
| Live | Open | Open | Nothing enforces one pilot per panel; the convention does |
| Degraded, the peer lost | Open | Locked, amber | Only the flying pilot's inputs pile up, and they replay onto a display nobody else changed |
| Replaying queued gestures | Locked, teal | Locked, teal | The local pilot can't race the replay |
| App link lost | Warning, not locked | Warning, not locked | Nobody is running who could lift a lock |

The degraded lock enforces one pilot per panel for the length of an outage, so the flying pilot's held inputs, replayed later, reconstruct the display exactly [8].
The replaying lock keeps the other pilot's backlog in order, so the local pilot can "neither race it nor produce a divergence nobody can see" [10].

**What it changes for Dual Input.**
Any display Dual Input syncs by replaying input can diverge when both pilots use it within one network delay, and without a way to undo a display's own input, only the pilots can bring it back.
Whether Dual Input keeps two pilots off one display, and whether some displays have a state it could sync in place of their inputs, are open questions.

**Traps.**

- The divergence is silent: a press that lands on the wrong page usually still finds something to press, so it counts as replayed, not missed [3].
- A drag reaches the other machine only when it ends, as one packet of up to 240 points, about 8s, so the window in which the other pilot can collide with a drag is the whole drag [3].
- The replaying lock doesn't cover a quick tap that arrives with nothing queued, which replays at once and shows no lock [10].
- No lock covers the first seconds after a display loads, before its code runs [3] [8].
- On the A350's WASM displays the other pilot's press can't be replayed yet, because the module presses only under the local cursor ([06-03](06-03-display-kinds-input-and-pop-outs.md#touchscreens-pointer-events-and-who-owns-hover)).
  On the A380's it can, inside an enter wrapper whose `mouseleave` may disturb the local pilot's own hover, and we haven't measured whether it does.

## Sources

1. Documented: [1500 Archers on a 28.8: Network Programming in Age of Empires and Beyond](https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond), Game Developer, 2001-03-22, bylined Paul Bettner.
2. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, every registered packet type: `Update`, `Interact`, `Physics`, `Surfaces`, `PointerEvent`, and `PointerAck` in `FsCopilot/Simulation/Coordinator.cs`, `SetMaster` in `FsCopilot/Simulation/MasterSwitch.cs`, the hosting and traffic packets in `FsCopilot/Simulation/ShareSwitch.cs`, and `PeerTags` in `FsCopilot/Network/PeerTags.cs`; the warning text is in `Coordinator.cs`, `Fresh`.
3. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, sections "0.2 What it can carry", "0.4 Edge cases, and what each does", "0.6 What it does not guarantee", "0.7 What it reports", "4.7 Drags: batched at mouse-up, not streamed live", "7.2 Overlay (panel side)", and "10 · Known limits".
4. Measured on MSFS 2024, 2026-09-08: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-11 — First multi-machine session, read from the app log", and `record/pointer-forwarding/docs/13-pr-prep.md`, section "4.4 Coordinates normalised to the instrument rect".
5. Documented: Glenn Fiedler, [State Synchronization](https://gafferongames.com/post/state_synchronization/), Gaffer On Games, 2015-01-05, section on visual smoothing.
6. Documented in our record: fsc-editor, `docs/sim-vars/10-probe.md`, section "Cause versus symptom — the real payoff", a design that isn't built.
7. Documented: fsc-exerciser at 2e4783a, `README.md`, section "Pointer forwarding", "Limitations".
8. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/11-fsc-implementation-plan.md`, sections "Known property (document, don't hide)" and "The overlays (in `pointer.js`)", decided on 2026-09-01; its amendments of 2026-09-12 say the degraded lock is amber, not the blue its table gives.
9. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/overlay.js`, `Overlay.STATES`.
10. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, "R06 · Replayed gestures run concurrently, not in order", part 4.
11. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-12 — The review register built: sixteen of seventeen land on the branch", which lists the in-sim checks still owed.

## Unverified claims

- **The A220's display units measure the same size on every machine.**
  One side logged 7410x1110 for a whole session, and the others' logs weren't read [4].
  Reading the `rect` in the panel hello lines of every machine's log from one shared session would settle it.
- **Two pilots typing on one FMS keypad at once leave the two scratchpads in different orders.**
  It follows from each machine applying its own keys first [8], and nobody has tried it.
  Two pilots pressing different keypad keys on the A220 within 100ms of each other, then comparing both scratchpads, would settle it.
- **The connecting lock shows on a joining machine, and a replay can press through a lock overlay.**
  Both are built and checked off-sim, and the log lists both in-sim checks as still owed [11].
  Joining a session with a pointer display on screen, then replaying a press while a lock is up, would settle both.
