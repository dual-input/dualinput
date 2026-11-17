# Session: log

What we found building and testing the session, newest entry first.

## 2026-11-17: In the sim, Join set the world map and started the flight within 0.9s, and active pause followed from our EFB app's code in 264ms, once the menu script parsed

**Asked:** stage 21's cases in the sim ([plan](../build/plan.md#21-rate-and-pause-and-go-to)): does our EFB app's code turn active pause on and off, which runway does Join's request pick, which entries of the world map's lists are the pilot flying's, does a gate with a letter match its flight file, does the menu script see Free flight's world map, and does Join now reach the flight within Go to's 5s?

**Expected:** each as the bench had it, with the matches the menu script makes unverified.

**Found:** on MSFS 2024, with `node tools/sim/go-to.ts`: a bench core played James, the pilot flying, in a Baron 58P at KSEA's PARKING 140, and the release core built from this tree played Adam, the user's sim:

- **The first two runs never left the start:** the menu script loaded into mainUi but never joined the core, and mainUi's console said "SyntaxError: Unexpected identifier 'request'. Expected ')' to end an 'if' condition.".
  Coherent GT rejects `if (!await request(…))`, which esbuild wrote from our `!(await request(…))`, and the error took out the whole script.
  [Coherent GT's limits](../architecture/coherent-gt.md) gain it, and the menu script puts each awaited value into a const first.
- **The menu script** reported Free flight's world map, so `FreeFlightPage` is an element it finds.
- **The aircraft list** held 138 entries, 1 in the Baron's folder, named in its thumbnail's path as for p08's A380: `aircraftId` 10, `displayName` "Black Square Baron 58P Professional", and `variation` "N513LW", the livery then selected, not the `A:TITLE`.
  So the Baron's entry came from its folder alone, and the preference for a variation equal to `A:TITLE` serves aircraft with an entry per preset, as the A380's.
- **The liveries** each have a `title`, such as "N515MR", and an `id`, such as "18070071185185781799:1", which `saveVariationId` takes.
  The Baron read no `A:LIVERY NAME`, and its `A:TITLE`, "Black Square Baron 58P Professional N515MR", ends with its livery's title.
- **Set up only** took 0.7s from its command to PARKING 140 selected, then the aircraft and the livery, 1.2s in all.
- **Join now,** with James's engines running, selected a runway by its `ID` 0.45s after its command, then started the flight, and pressed Ready to fly 0.4s after the load reached it; Adam's Baron stood with both engines running, in James's flight.
  The script's own figure, 8.9s, counted from Set up only's start, which its fix leaves out.
  Adam's aircraft then went to the sea, since flight-model sync moved it to James's, and the stand-in's aircraft sits at 0° latitude and 0° longitude.
- **Active pause:** James's press on and off each reached Adam's sim through our EFB app's `TOOLBAR_SET_ACTIVE_PAUSE`, with the EFB closed, in 264ms and 263ms from the press, under the 500ms [budget](02-units.md#budgets); Adam's own press on and off each wrote the key.
- **A gate with a letter:** the list named it "GATE N 17 -- GATE MEDIUM", and the flight file `GateName=GATE_N` and `GateNumber=17`.
- **The replay** of Adam's core matched all 144 checkpoints.

**Changed:**

- The menu script reads a flight file's underscore as a space, so GATE_N 17 takes "GATE N 17".
- With no `A:LIVERY NAME`, Join selects the livery whose title ends the pilot flying's `A:TITLE`.

The water was the bench core's, which a session with two sims doesn't have; Join from the world map in two real sims is still unrun.

**Evidence:** the run's report and Adam's core's log, read from `target/sim/runs/2026-11-17_17-15-56-go-to/` and quoted here, since the run's folder sits outside the tree.

**Affects:** [02-units](02-units.md)'s Go to and the menu script, [Join](../interface/decisions.md#join-takes-a-joiner-from-the-world-map-into-the-pfs-flight-or-only-sets-it-up), and [Coherent GT's limits](../architecture/coherent-gt.md).

## 2026-11-17: Stage 21's rate and pause and Go to pass their bench cases, and a following machine's part was asked to pause 21ms after the press

**Asked:** do [stage 21](../build/plan.md#21-rate-and-pause-and-go-to)'s rate and pause and Go to hold their [cases for the bench](02-units.md#cases-for-the-bench), and the apps' case of an EFB app that reconnects?

**Expected:** yes, with the EFB app's part and the menu script faked: the fake EFB app plays `Pause_EX1` on its core's stand-in when the part is asked to pause, as the toolbar's call would, and the fake menu script answers each world map request and plays a flight's load when asked to start it.

**Found:** on the bench, with two cores in a session in the Baron 58P, James's as the pilot flying and Adam's following, `node tools/bench.ts rate-and-pause go-to` passed its 4 tests, 2 for each scenario, which cover the first five items below, and the menu script's own test passed (`results/2026-11-17-stage-21-bench.txt`):

- **Active pause:** one press of James's reached Adam's part 21ms later, counted from the press, so the key's way between the cores is in it.
  The 500ms [budget](02-units.md#budgets) runs to the pause being applied, and the bench stops when the part is asked, so the part's `TOOLBAR_SET_ACTIVE_PAUSE` call and the flag it brings back wait for the sim.
  The flag Adam's part brought back wrote no key, both pressing at once ended on one value, and James pressing it three times within a round trip left both sims on his last.
  With Adam's part bringing its flag back 300ms late, James's on and off left Adam's sim off, a case the code review found the first version got wrong, by asking Adam's part only for the first.
- **The simulation rate:** Adam's own change stepped back to James's, and James's change reached Adam.
- **The EFB app reconnecting:** a pause the key took while Adam's EFB app was gone reached Adam's sim once a new app joined.
- **The pause menu and the time of day:** "James has paused" held on Adam's banner while James's sim had `Pause_EX1`'s flag 8, and sims 20 minutes apart showed a warning.
- **Join:** Set up only sent the airport, PARKING 140, the aircraft, and the livery; with James's engines running, Join now sent a runway and started the flight, then pressed Ready to fly once the load reached it, and Adam entered the flight.
  A stand the list lacks kept the airport and said so, a failed airport search stopped Join there and said so, and Join gave each of its five reasons while unavailable.
- **The menu script's own test:** `departure_stand` for PARKING 14 at an airport with PARKING 140 takes PARKING 14.

Building it found one thing the design left out, and a read that narrows one it left open:

- **A departure from the last flight:** sim awareness kept a flight's `[Departure]` through the next load, so a flight file without one would have sent a joiner to the last flight's airport, and sim awareness drops it at each `FlightLoaded`.
- **By the code, the runway's request takes the runway's `ID`,** as the stand's does, since the world map's list hands each entry's `ID` to `SetDepartureRunwayIndex` (read in fs-base-ui 0.1.10, `html_ui/Global/pkg/base.bundle.js`, `FreeflightPlanCombobox._updateDropdown`), and the case in the sim settles it.

**Changed:** stage 21's code, its plan lines, and these choices, which the design left open:

- Join asks the world map's aircraft list for the pilot flying's aircraft as the joiner reaches the world map, through a `find_aircraft` request, so it can say "Install the Baron 58P to fly with James" before it's pressed.
- The menu script matches the pilot flying's aircraft by the `SimObjects\Airplanes\` folder in an entry's thumbnail's path, and prefers the entry whose variation is their `A:TITLE`, as the A380's entry named its folder there and had its title as its variation (`experiments/areas/interface/results/p08-world-map-aircraft-2026-10-05-19-31-33.ndjson`).
  It matches a livery when any of the entry's text fields equals their `A:LIVERY NAME`.
- A part in the EFB app shows on a crew row, a place [a feature's parts](../interface/01-apps.md#a-features-parts) doesn't list, since Join ends the pilot flying's row.
- The menu script reports the page every 500ms outside a session too, since stage 11b's aircraft picker reads it at home.

What no bench can answer waits for the stage's session in the sim, `node tools/sim/go-to.ts`, whose cases [stage 21](../build/plan.md#21-rate-and-pause-and-go-to) lists.

**Affects:** [02-units](02-units.md)'s rate and pause, Go to, and the menu script, the sim seam's [`world_map`](../core/03-sim-seam-and-wasm-module.md#what-a-feature-calls), and the apps' [parts](../interface/01-apps.md#a-features-parts).

## 2026-11-04: A member's entry is rewritten on a change, so a new name or color reaches the crew at once, and the color moves to the session

**Asked:** could a new name reach the crew in its session rather than the next, and could the apps' heads wear the color a pilot picked, which they computed from the pilot's ID (user, 2026-11-04)?

**Expected:** yes, since "never rewritten" described a key nothing had a reason to change, rather than a rule anything leaned on.

**Found:** `member` is an ordinary key, written as `status`, `ready`, and `match` are, and the session crate's slice and match check read a pilot's name from the current value each time.
On the bench, a name and a color changed mid-session reached the other core's slice, an emptied name kept the last, and the session file kept both, and all 23 of `node tools/bench.ts session`'s cases pass.

**Changed:**

- The `member` key holds the pilot's color, and is rewritten when their name or color changes.
- The color setting is the session crate's, `session.color`, and `PALETTE` moved to the message crate's session module, so the apps' shell and the session crate name no feature for it.
- The session crate works out each member's color, by the rule avatars had for a pilot who never picked, and shows it in the slice `session`, so a head and its figure can't disagree.
- The pose carries no color.
- The Figures tab sends a new name 800ms after the last key, so the crew doesn't watch it spelled, and it drops "Your new name will apply in your next session".

A notification already up keeps the old name until it's next raised, which we accept.

**Affects:** [02-units](02-units.md), [the Figures tab](../interface/decisions.md#the-figures-tab-holds-the-pilots-figure-and-explains-what-its-figures-can-do), and [01-avatars](../avatars/01-avatars.md).

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
The faster build showed a second race in a case, the network's wrong-code refusal: the core with the other code read the host's first message first and refused it, as [the network's units](../network/02-units.md) allow either side to, where the case expected the host to refuse; it accepts either side, and checks the other side's notification.

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
- Aircraft awareness reads `A:TITLE` for the crew's notifications, since the path holds folder names, not a name a pilot knows ([the aircraft's facts](../core/03-sim-seam-and-wasm-module.md#the-aircrafts-facts)).
- The countdown case un-readies at 2.5s, not the design's 2.9s, since the slice's 50ms rounds and the trip to the pilot flying's core would make 2.9s a race with the countdown's 3s.
- Of stage 7's leave case, the bench checks the handover, `MemberLeft`, and a quit's exit within 3s, and the network crate's own tests check that a leave stops the other core's dials and tells the backend.

**Changed:** the menu's page, which only Go to reads, comes with Go to in [stage 21](../build/plan.md#21-rate-and-pause-and-go-to), and the menu script reports only its master page until then.
The kernel's view of the units' state carries each request's verdict, so the session's slice says why Ready or the role switch can't be used before the pilot tries.

**Affects:** [the session's units](02-units.md), [the sim seam](../core/03-sim-seam-and-wasm-module.md)'s aircraft's facts, and [the build plan](../build/plan.md)'s stages 9 and 21.

**Evidence:** [results/2026-10-24-stage-9-whole-bench.txt](results/2026-10-24-stage-9-whole-bench.txt).
