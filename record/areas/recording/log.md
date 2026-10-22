# Recording: log

What we found about the recording, replays, and bug reports, newest entry first.

## 2026-10-21: Partial recording caused three bugs in stage 4's sim service, while recording every input costs 45 to 126 MB an hour

**Asked:** should the core go on leaving a partly recorded unit's high-rate inputs out of its recording, as [unrecorded inputs](01-recording-and-bug-reports.md#unrecorded-inputs) designs it, once stage 4's code review found bugs where the sim service had to keep such a unit's drift to itself?

**Expected:** that [what keeps the drift from spreading](01-recording-and-bug-reports.md#what-keeps-the-drift-from-spreading) would hold in each platform crate that serves features, at a small cost in each.

**Found:**

- Stage 4's code review found three bugs in the sim service, each from partial recording (stage 4's code review, 2026-10-21):
  - The service drew each call's tag from one counter across units, and a tag goes out in a unit's calls, which the checkpoints hash, so a partly recorded unit that made fewer calls in a replay shifted every later tag of every other unit.
  - The service's 200ms rewrite timer, which writes each live routine's feed again, started from whichever unit fed first, so a partly recorded feature whose feed came first live, and later or never in a replay, shifted the service's later handles.
  - The module's unfreeze turned on whether any routine was live, which a partly recorded feature's feeds decide, such as flight-model sync's for `Follow`, so an output of the platform's turned on a unit that drifts in a replay.
- Each platform crate that serves features would bring more of these, since each has to keep every decision of its own off a partly recorded unit's inputs.
- Recording every input costs only file size:
  - p10's flying machine that hosts traffic at EGLL took in 45 MB of inputs an hour with zstd (measured on MSFS 2024, 2026-10-16, [architecture log][p10]).
  - Stage 3's bench recorded 126.2 MB with zstd in an hour that played p10's 600s capture six times in a row, beside made-up inputs at a session's rates with the link's at about 140 a second (measured on our development machine, 2026-10-20, [core log][stage 3]); how much of the 81 MB above p10's 45 MB the made-up inputs make is unmeasured.
  - Under partial recording's rules, p10's sim inputs came to 0.9 MB an hour with zstd ([architecture log][lean]).
- Neither figure holds the result of avatars' job that builds an aircraft's model, which a recording then keeps at each load; avatars' budget puts the 58P's model under 60 MB in memory ([budgets](../avatars/01-avatars.md#budgets)), and how far zstd shrinks it is unmeasured.

**Changed:** the user decided on 2026-10-21:

1. The core records every input.
   No unit is partly recorded and no input is unrecorded: no `.partly_recorded()`, no `.unrecorded()` on a channel, a sim call, a core helper want, or a job, no filter at the edge that drops them, no leaf rule, no setting that records everything, and no list of partly recorded units in the header.
   A replay checks every unit's outputs.
2. v1 uploads no bug report: a pilot sends a run's folder by hand when we ask for it.
   The report page's upload, the Worker's report endpoints, R2's storage of reports, signing each part with the session's key, asking a missing pilot, and `tools/reports.ts` come after v1, built on the same files.
3. Each PC still keeps whole runs within 1 GB, never deleting the newest run that held a session, which at 45 to 126 MB an hour holds roughly 8 to 22 hours (arithmetic).
4. Logs come first: when a pilot reports a problem, we ask for the run's `log.txt`, and for the recording only when the log isn't enough.
   A recording then replays at any log level, even on a build of the same commit with log lines added afterward, as [a replay on the same commit with local changes](01-recording-and-bug-reports.md#a-replay-on-the-same-commit-with-local-changes) allows.
   Each unit logs at info each decision a pilot can notice, with its reason, such as control passing, a value applied or refused, a link lost, and catch-up's steps.
5. This reverses the user's call of 2026-10-16, in [why it records less than every input](01-recording-and-bug-reports.md#why-it-records-less-than-every-input), that 45 MB an hour is too much to upload after a flight or to keep several flights of: v1 uploads nothing, and logs come first, so that cost no longer applies.

**Affects:** [01-recording-and-bug-reports](01-recording-and-bug-reports.md); [01-loop-and-edge](../core/01-loop-and-edge.md), whose [logging](../core/01-loop-and-edge.md#logging) gets the rule above; [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md), [03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md), and [04-core-helper](../core/04-core-helper.md); [flight-model sync](../flight-model/01-flight-model-sync.md), [traffic and ATC](../traffic-atc/01-traffic-and-atc.md), [avatars](../avatars/01-avatars.md), and [take-control](../control/01-take-control.md); [01-between-machines](../network/01-between-machines.md) and the [network's units](../network/02-units.md); [order and recovery](../sync/04-order-and-recovery.md); the [session's units](../session/02-units.md); [the profiles' units](../profiles/02-units.md); [the apps](../interface/01-apps.md); [testing](../build/02-testing.md); [the spine](../architecture/01-spine.md), [the code map](../architecture/02-code-map.md), the [architecture plan](../architecture/plan.md), and the architecture's [tentative decisions](../architecture/decisions.md); [recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports) in 03-v1-scope; and stages 8 and 16 of the [build plan](../build/plan.md).

[p10]: ../architecture/log.md#2026-10-16-a-flying-machine-that-hosts-traffic-at-egll-takes-in-285-mb-of-inputs-an-hour-45-mb-with-zstd-mostly-traffic-and-one-loop-carries-them-at-05-of-a-core-and-replays-them-exactly
[lean]: ../architecture/log.md#2026-10-16-reading-traffic-only-as-it-changes-within-50km-once-a-second-and-the-flight-model-and-camera-at-their-send-rates-would-shrink-p10s-recording-from-45-to-13-mb-an-hour
[stage 3]: ../core/log.md#2026-10-20-stage-3s-bench-carries-an-hour-of-a-busy-flight-at-05-of-a-core-with-a-p99-wait-of-87µs-replays-it-in-17s-and-a-killed-core-loses-its-last-064s
