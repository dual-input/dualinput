# Synchronization: echoes and initial sync

- [Echo loops and suppressing them](#echo-loops-and-suppressing-them)
- [Initial sync: a snapshot on join, late join, resync after reconnect](#initial-sync-a-snapshot-on-join-late-join-resync-after-reconnect)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Replication models and authority are in [08-01-replication-models-and-authority](08-01-replication-models-and-authority.md), ordering and classes of data in [08-03-ordering-and-classes-of-data](08-03-ordering-and-classes-of-data.md), change detection, relative actions, and flight controls in [08-04-rates-actions-and-flight-controls](08-04-rates-actions-and-flight-controls.md), position and clocks in [08-05-position-and-clocks](08-05-position-and-clocks.md), and divergence and two pilots on one screen in [08-06-divergence-and-one-screen](08-06-divergence-and-one-screen.md).

As in [08-01](08-01-replication-models-and-authority.md), the flying machine is the pilot in control's, and the following machine is the other.

## Echo loops and suppressing them

A machine that writes a value it received sees its sim report the change as if its own pilot had made it, and without a guard it sends the value back.
Nothing in a change report says who made the change, so every guard infers it: FS Copilot counts the reports it expects for each variable, and panel code marks the events it dispatches.

**How it works.**
Suppose pilot B turns a heading knob from 90 to 100, and B's machine sends each step.
A's machine writes 91, A's sim reports 91, and A sends 91 back; by then B's knob is at 95, and B's machine writes 91, which turns the knob back.
Once the knob stops, the loop ends one round trip later: the echo carries the value B's knob already holds, so writing it changes nothing, and a request with the `CHANGED` flag reports nothing ([04-01](04-01-connection-and-data.md#data-definitions-and-requests)).
While the value moves, or when it's a toggle, the loop doesn't end.

The sim can't tell a guard which report is an echo.
`SIMCONNECT_RECV_SIMOBJECT_DATA` carries the request, object, and definition IDs and the values, and `SIMCONNECT_RECV_EVENT` carries the group, the event, and its data, with no field for who caused the change [1].
The SDK also says a client that transmits an event can hear it again ([04-02](04-02-events.md#client-events)).

FS Copilot's guards, read from its source [2] [3] [4]:

| Path | Guard | How it works |
| --- | --- | --- |
| `shared:` entries | A skip counter for each variable | Before applying a peer's value, it adds 1 to that variable's counter; while the counter is above 0, each local report of the variable is dropped instead of sent and takes 1 off; a counter last added to more than 2s ago is discarded, with a warning |
| A control that moves two variables | `skp:` | When an entry sends a change, the variable its `skp:` names gets a counter too, so its report isn't sent separately |
| `master:` entries | None | Only the flying machine sends them, and only the following machine applies them |
| Events dispatched into a panel | `selfEmit` and `isTrusted` | FS Copilot sets `selfEmit = true` on every event it dispatches, and our fork's pointer code also drops any event whose `isTrusted` is false |

The warning reads [2]:

```text
Skip counter for '{Name}' expired ({Elapsed:0.00}s > {Limit:0.00}s). Possible desync detected.
```

`isTrusted` works as a guard because real cockpit input arrives trusted.
Of the 627 events one interaction delivered to the A220's DisplayUnits, 571 were trusted, and the other 56 were the `mouseenter` and `mouseleave` events that `VCockpit.js` dispatches itself [5] ([06-03](06-03-display-kinds-input-and-pop-outs.md#touchscreens-pointer-events-and-who-owns-hover)).

FS Copilot also holds every outgoing `H:` event for 500ms [3].
No record measures why.
The profiles repo gives a reason, that without the delay intermediate states get synchronized, and it's unverified [6].

**What it changes for Crosscheck.**
Every path Crosscheck writes through needs its own echo guard.
The guard has to hold when a write draws no report, when one write draws two, and when the pilot moves the same control while the guard is waiting.

**Traps.**

- A counter that expects a report can swallow the pilot's next change.
  FS Copilot adds to the counter even when an entry's `set:` builds nothing to run, as the A220's autopilot entry does when the two states already agree ([07](07-aircraft-specific-systems.md#control-semantics)).
  No report comes, so a change the pilot makes to that variable in the next 2s is dropped and never sent (unverified) [3] [4].
- `Possible desync detected.` means only that a write drew no report before the next local change.
  fsc-editor reads `Skip counter for 'L:XMLVAR_ELT_STATE' expired (590.72s > 2.00s)` as the aircraft overwriting FS Copilot's write [7], and a write of the value the variable already held produces the same line [2] [4].
- One write can draw two reports: each switch flipped on the PA-24 reported its input event twice through SimConnect's subscription ([02-02](02-02-aircraft.md#model-behaviors)), and a guard that expects one report lets the second through.
- A guard by time window swallows real input.
  Our fork's first pointer build ignored the pilot's own input while a replay ran.
  In a session on 2026-09-08 it counted 142 ignored events against 70 replays, whose own synthetic presses and releases account for 140, so two of the pilot's real input events were lost [8].
  The code that replaced it drops only events marked `selfEmit` or untrusted, and covers the display with a visible overlay while a replay runs [9].

## Initial sync: a snapshot on join, late join, resync after reconnect

Sending only changes keeps two cockpits equal only if they started equal.
A machine that joins mid-flight, or comes back from an outage, needs a snapshot of every synced value or a replay of what it missed, and some state fits in neither.

**How it works.**
FS Copilot sends no snapshot.
Its app loads the aircraft's profile when the aircraft loads, starts reading every entry then, and sends each change to whoever is connected at the time, so a machine that joins later receives only the changes made after it joined [10] (unverified in flight).
A switch nobody touches after the join keeps whatever each cockpit had.

YourControls sends one [11]:

1. The joining machine waits 3s after connecting, which its source says "allows lvars to be processed", then sends `Ready`.
2. The machine in control answers with the current value of every `A:` and `L:` variable it syncs.
3. The host asks for the sim's time, which YourControls' documentation lists as synced "on initial connection" [12].

Our fork's traffic does the same for a machine that joins late: the host re-sends every aircraft's identity, and makes each aircraft's next sample go out whether or not it changed [13].

Resync after an outage has one worked example in our records, our fork's pointer path [9] [14]:

1. The link drops, and the network library, LiteNetLib, declares the peer gone after 15s.
   When it does, "everything sent in that window is dropped from the transport's retry queue" [14].
2. The following machine's opted-in displays lock under an amber overlay, and the flying machine's stay usable.
   The sender keeps every gesture the receiver hasn't acknowledged, and the receiver acknowledges every 3s.
3. If the link returns within 5 minutes, the sender resends what it holds in sequence order, and the receiver drops any gesture it already applied.
   The locked machine couldn't change anything during the gap, so "an outage that ends within the session timeout loses nothing" [9].
4. After 5 minutes, the session ends and the app logs a desync warning.

A first contact replays nothing, because a pilot's solo presses would land on a display that never saw the state they were made in: "recovery replays, first contact does not" [14].

On our two-instance bench, a dropped link never came back on its own.
A link cut by suspending one instance stayed down through 3 minutes of waiting, twice, and a Join pressed afterwards delivered every held press, in order and without duplicates [15].

**What it changes for Crosscheck.**
Crosscheck needs a join step that brings the joining aircraft to the other's state before change sync starts, and a resync after every outage, whether of the network or of SimConnect ([04-03](04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)).
Which machine's state wins at join, and how to tell that the joining aircraft has finished loading ([02-03](02-03-the-running-sim.md#the-flight-lifecycle)), are open questions.

**Traps.**

- A fixed wait guesses when variables exist: YourControls waits 3s, and fsc-editor measured a Bonanza's last 3 `L:` variables appearing 35s after its load ([02-03](02-03-the-running-sim.md#the-flight-lifecycle)).
- A snapshot carries values, not events.
  YourControls' snapshot holds `A:` and `L:` values and an empty list of events [11], and a keypad whose state lives in the FMS has no value to send ([07](07-aircraft-specific-systems.md#hidden-state)).
- A display that reloaded is back in its default state, so our fork drops a gesture for a display that hasn't announced itself rather than replaying into it ([07](07-aircraft-specific-systems.md#hidden-state)).
- Reliable delivery doesn't outlive a disconnect.
  FS Copilot keeps no history of `shared:` changes, so one sent in the 15s before the peer is declared gone is lost with the retry queue (unverified) [10] [14].
- A peer that quits has to say so before its process exits.
  FS Copilot's quit reached the peer as an outage, and the peer held history for 5 minutes, until our fork made the app wait up to 500ms on its way out to send its departure; the peer then knew in 45ms [16].

## Sources

1. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `SimConnect SDK/include/SimConnect.h`, `SIMCONNECT_RECV_SIMOBJECT_DATA` and `SIMCONNECT_RECV_EVENT`.
2. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Simulation/Skip.cs`.
3. Documented, read from FS Copilot's source: fsc-editor, `docs/fscopilot-behavior.md`, sections "How a change leaves this machine" and "skp: — a send-side cross-reference", checked against `FsCopilot/Simulation/Coordinator.cs`, `AddLink`, in the FS Copilot fork at 9d4e864.
4. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/Simulation/Definitions.cs`, `ApplyTo`; and `FsCopilot/Connection/SimClient.cs`, `Execute`, which returns at once on an empty expression.
5. Measured on MSFS 2024, 2026-08-30: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - Q03 PASSES: a synthetic mouse click drives a React/SVG display", the Q02 paragraph.
6. Documented, and older than the source it describes: FS Copilot profiles at d3d7689, `docs/synchronization.md`, section "H:Event Delay".
7. Documented in our record: fsc-editor, `docs/sim-vars/10-probe.md`, section "Cause versus symptom — the real payoff", whose reading of the line is an inference.
8. Measured on MSFS 2024, 2026-09-08: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-11 — First multi-machine session, read from the app log", with the explanation in `record/pointer-forwarding/docs/12-pre-pr-review.md`, "R07 · Real input is silently dropped during replay windows".
9. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, sections "0.4 Edge cases, and what each does", "0.5 What it guarantees", "4.6 History: everything after the last ack", "4.9 Lock policy: the slave locks, the master does not", and "7.1 Session (app side, `Coordinator`)".
10. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/ViewModels/MainViewModel.cs`, which loads a profile on every aircraft announcement; and `FsCopilot/Simulation/Coordinator.cs`, where nothing sends current values when a peer connects, and the `Update` path keeps no history.
11. Documented, read from source: [YourControls](https://github.com/YourControls/yourcontrols) at commit 31b1706: `src/yourcontrols/src/program/sync.rs`, the 3s delay and `send_ready`; `src/yourcontrols/src/program/network.rs`, the `Ready` branch; and `src/yourcontrols/src/definitions.rs`, `get_all_current`.
12. Documented: YourControls documentation, [Syncing Expectations](https://docs.yourcontrols.org/syncing-expectations).
13. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/Simulation/TrafficHost.cs`, the `PeerJoined` subscription; and `FsCopilot/Simulation/TrafficGate.cs`, `ForceResend`.
14. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, "R03 · History resend replays presses the peer already applied" and "R04 · A fresh session replays the last 60 s of solo input onto the new peer".
15. Measured on the two-instance bench, without the sim, 2026-09-12: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-12 — A blackholed peer link never comes back on its own".
16. Measured on the two-instance bench, without the sim, 2026-09-12: FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-12 — Stay alive long enough to say you left: Q11 fixed and measured".

## Unverified claims

- **A write that draws no report makes FS Copilot drop the pilot's next change.**
  We read it from `Definitions.cs` and `Skip.cs` [2] [4].
  With the A220 on two machines and the autopilot off on both, sending "off" from one, then pressing the autopilot button on the other within 2s and checking whether the first machine sees it, would settle it.
- **A machine that joins receives only changes made after it joined.**
  We read it from the source [10].
  Setting one `shared:` switch differently on two machines, joining, and comparing the switch without touching it would settle it.
- **A `shared:` change sent in the 15s before a disconnect is lost.**
  We read it from the source and the review of LiteNetLib [10] [14].
  On the two-instance bench, suspending one instance, changing a `shared:` value on the other within 15s, then resuming and rejoining, would settle it.
- **Why FS Copilot holds `H:` events for 500ms.**
  Only the profiles repo gives a reason [6].
  Syncing a G1000 NXi softkey with the delay set to 0 and to 500ms, and comparing both displays, would settle it.
