# Session: log

What we found building and testing the session, newest entry first.

## 2026-10-24: In the sim, the menu script takes the core out of Starting and Hold holds the aircraft through preflight, after two fixes the bench couldn't catch

**Asked:** do [stage 9](../build/plan.md#9-the-session)'s cases in the sim hold: our BlurPage copy brings the menu script, whose master page takes a core that found the sim running out of Starting, and preflight's `Hold` freezes the pilot's aircraft through our WASM module and lets it go when preflight ends?

**Expected:** both, as on the bench, though the module's freeze had never run in the sim ([the sim seam](../core/03-sim-seam-and-wasm-module.md#wants-and-the-sims-apis)).

**Found:** on MSFS 2024 SunRise 12.2.282174.999, in the Black Square Baron 58P Professional, with the release core hosting a session alone, through `node tools/sim/session.ts`, over three runs:

- **The first run** never left Starting: the menu script loaded into the menu's document, mainUi, but never joined the core.
  The page client took the CommBus only through `RegisterCommBusListener`, which mainUi defines but which throws there for want of `RegisterViewListenerT`.
  [The spine](../architecture/01-spine.md#finding-the-core) has the menu script take it as mainUi's own view listeners do, through `engine`, and the code hadn't; through `engine`, mainUi heard 3 of the core's announcements in 6s, read through the sim's inspector.
- **The second run,** with that fixed, passed the menu's case, but `Hold` never froze the aircraft: the core fed it, and a cockpit panel read all three freezes off.
  Our module had read none of the core's writes, which [the core log](../core/log.md#2026-10-24-our-wasm-module-read-none-of-the-cores-writes-because-its-dispatch-callback-reached-its-buffer-through-the-context-pointer-with-a-threads-own-slot-it-reads-them-and-hold-freezes-the-aircraft) follows to the fix.
- **The third run,** on the final code, passed all three cases: the menu script's master page took the core from Starting to Menu, the panel read all three freezes on 10s into the flight, and all three off 3s after preflight ended; the replay matched the run.
  The sim puts the pilot in walkaround after Ready to fly ([interface log](../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly)), but whether the pilot was still in it when the panel read the freezes, the run didn't record.
- Neither fault could show on the bench: its pages run the page client in surroundings of their own, not the sim's, and the stand-in sim runs the routine host without the module's connection.
- Held mid-taxi by a probe, the aircraft's turn coordinator kept following the rudder, and ChasePlane kept its motion effects (seen by the user), since a frozen aircraft keeps integrating its velocities ([flight-model log](../flight-model/log.md#2026-10-03-freezing-holds-the-pose-but-not-the-velocities-so-a-follower-has-to-write-them-all)); preflight starts parked, where they start at 0.

**Changed:** the page client takes the CommBus through `engine` in a page without the sim's `common.js`, our module's dispatch callback collects into a thread's own slot, and the sim session's script reads a freeze given as `true` or as 1.

**Affects:** nothing in the record beyond the core log's entry; the code came back to [the spine](../architecture/01-spine.md#finding-the-core).

**Evidence:** [results/2026-10-24-stage-9-sim-session.txt](results/2026-10-24-stage-9-sim-session.txt).

## 2026-10-23: An unoptimized bench build sat close enough to a handler's 1ms for a pause of the PC's to cross it, so the bench builds optimized

**Asked:** with the session crate bringing its state up to date once for each input (the stage's entry below), why did a second whole bench still fail the countdown case on the code map's 1ms for a handler, at 1,128µs, when the session's cases alone had passed it at 862µs, both from runs whose output we didn't keep?

**Expected:** one input doing too much: the joiner's input that takes the host's first message, which brings the link up, merges the keys, sends this core's keys back, and writes the session file.

**Found:** on our development machine, with a patch we didn't keep that logged the time each handler took in each input, running the session's cases on the bench build without optimizations, then on the release profile:

- The session crate's handlers took under 200µs of that input, and the network crate's 788µs.
  At a joiner's first `LinkUp` the network crate posts the pilot's entry to the backend, signed with the session's endpoint key, and worked the key's public half out twice besides the signature: three curve multiplications, about 250µs each without optimizations, a third of the 770µs the host's Host input spent in the network crate on the same three.
  Holding the key with its public half cut that input to 643µs, and the host's Host input from 950µs to 681µs.
- The clients crate's round, which builds every slice an app shows every 50ms, was most of the inputs the patch logged, those over 300µs, usually at 300µs to 650µs.
  Of the rounds over 300µs, the session's slice took 187µs to 1,157µs, 367µs on average, and turning its JSON value tree into text was about 90µs to 175µs of that.
  It writes each slice's text straight from the unit's value instead.
- The case still failed, on a different input each run.
  In one input the kernel's refresh of the requests' verdicts, which takes about 20µs, took 592µs.
  We take that for Windows pausing the core's thread mid-input (unverified: a trace of the thread's context switches would settle it), and a pause that long on top of a 500µs round puts the input past 1ms.
- The bench runs one scenario at a time, so the whole bench's 1,128µs and the 862µs alone were two runs of the same case, not one run under another scenario's load.
- On the release profile, the same cases' slowest input took 242µs on one core and 405µs on the other, and their one failure was a check of a late joiner's slice, made before its session started, when the slice lists no members: it threw rather than waiting.

**Changed:** the bench's scenarios build with a profile of their own, `release-with-checks`, optimized like a release, with overflow checks and debug assertions on (user, 2026-10-23).
On it, all 15 of the session's cases passed, with slowest inputs of 477µs and 380µs, and a change to one file of the session crate rebuilt in 6s.
The late joiner's check waits for this pilot's entry in the slice.
The faster build showed a second race in a case, the network's wrong-code refusal: the core with the other code read the host's first message first and refused it, as [the network's units](../network/02-units.md) allow either side to, where the case expected the host to refuse; it accepts either side, and checks the other side's notice.

The whole bench on that profile then failed the countdown case once more: of the 15,558 inputs of the 8 cores that logged their run's stats as they exited, one went over 1ms, at 1,049µs, in an input that wrote no log line, so did none of the work that logs, on a core busy 0.19% of its run, and the next slowest took 832µs.
So a scenario's check of the 1ms allows each core one input over it, if under 2ms (user, 2026-10-23).

**Affects:** [the testing doc](../build/02-testing.md#building-what-it-runs)'s Building what it runs.

**Evidence:** [results/2026-10-23-handler-timing.txt](results/2026-10-23-handler-timing.txt).

## 2026-10-23: Stage 9's session crate passes the stage's 15 bench tests, ends preflight on two cores 0.6ms apart, and sends under 300 bytes of keys in a first message

**Asked:** do the bench tests and the four budgets that [stage 9](../build/plan.md#9-the-session) lists hold on its code: 11 of [the session's cases for the bench](02-units.md#cases-for-the-bench), the ones that need no later stage, and 4 carried from stages 2, 4, 5, and 7?

**Expected:** each case as the design has it, and each budget well inside, since a v1 session holds two members' keys.

**Found:** on our development machine, with the bench build of the core on the bench's profile `release-with-checks` (the entry above), two cores through the bench's local relay and backend, and a fake desktop app on each sending the session crate's commands:

- All 15 of `tools/bench/scenarios/session.ts`'s cases passed, each ending in a replay of every core's recording that matched its run.
- **A handler:** the slowest input of either core in the countdown case took 444µs and 457µs, inside the code map's 1ms.
  On the unoptimized build, the whole bench's first run caught the joiner's input that takes the host's first message at 1,120µs (from a run whose output we didn't keep).
  The session crate brought everything that follows from the keys up to date twice in that input: once on `LinkUp`, and once on the host's keys, which arrive behind it.
  It does that once for each input, after everything else the input set off, and the entry above follows what the second whole bench found.
- **Memory:** a two-member session's keys took 1,073 bytes at preflight's end, against 1 MB, counted as each value's bytes and each entry's fixed size, from each core's log line `preflight ended, and the session's keys take this much`.
- **A first message's keys:** 197 bytes from the joiner and 254 from the host, against 4 KB, from each core's log line `a connection's first message carries this core's keys` (both in [the handler timing's results](results/2026-10-23-handler-timing.txt), run 8).
- **Preflight's end:** the two cores logged it 0.6ms apart, read on the one counter both cores share, against one network delay: 1.5ms at p99 for a stream's message through the local relay, from the same results' case that holds back one core's relay connection, measured at the core not held back.
- **A pilot flying's Leave:** control reached the other pilot 21ms after it, against the network's 1s.
- The whole bench passed on the stage's code before its code review's fixes, all 65 cases, as [the results](results/2026-10-24-stage-9-whole-bench.txt) show.
  After the fixes, which touched the session's and the network's crates, those two scenarios' 20 cases passed again ([results](results/2026-10-24-stage-9-bench-after-review.txt)), the countdown case's slowest inputs at 881µs and 956µs, inside the 1ms.
  A torrent client was taking CPU beside the bench, and one core's input waited 991µs at p99, so we take the rise for the PC's load (unverified: a run on a quiet PC would settle it).
  Its first run, on the unoptimized build, failed 2 of 65: the 1,120µs input above, and the lost-link countdown case, whose test read the other pilot as unready before the link had come back, which it waits for.
  The busiest mix's loop, which took 1,415µs at its slowest on the unoptimized build, took 303µs (the first run's output, like the 1,120µs, we didn't keep).

The build changed six things the record didn't say:

- The bench's stand-ins for the session crate went, since the crate is built: the network's and the clients' scenarios host and join through its commands, and the case of a connection that sends no first message stays the network crate's own test, since the session crate always sends one.
- A core whose sim closes with no session held and no desktop app connected exits, so the scenarios that close their stand-in's sim keep a fake desktop app open, as a pilot's open window would.
- The pilot flying writes its own Ready off when it loses a link in preflight too, as the design has every member do, so after a cut both pilots click Ready again.
- Aircraft awareness reads `A:TITLE` for the crew's notices, since the path holds folder names, not a name a pilot knows ([the aircraft's facts](../core/03-sim-seam-and-wasm-module.md#the-aircrafts-facts)).
- The countdown case un-readies at 2.5s, not the design's 2.9s, since the slice's 50ms rounds and the trip to the pilot flying's core would make 2.9s a race with the countdown's 3s.
- Of stage 7's leave case, the bench checks the handover, `MemberLeft`, and a quit's exit within 3s, and the network crate's own tests check that a leave stops the other core's dials and tells the backend.

**Changed:** the menu's page, which only Go to reads, comes with Go to in [stage 21](../build/plan.md#21-rate-and-pause-and-go-to), and the menu script reports only its master page until then.
The kernel's view of the units' state carries each request's verdict, so the session's slice says why Ready or the role switch can't be used before the pilot tries.

**Affects:** [the session's units](02-units.md), [the sim seam](../core/03-sim-seam-and-wasm-module.md)'s aircraft's facts, and [the build plan](../build/plan.md)'s stages 9 and 21.

**Evidence:** [results/2026-10-24-stage-9-whole-bench.txt](results/2026-10-24-stage-9-whole-bench.txt).
