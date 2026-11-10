# Pointer sync: log

What the build's stages found about pointer sync, which plays one pilot's presses and drags on a synced display on the crew's copies of it, newest entry first.
Each entry's raw output is in the `results/` folder beside this log.

## 2026-11-09: Pointer sync's cases in the sim pass on the A220's ND and the Baron's tablet, once the second pilot's display carries the A220's livery

**Asked:** do [pointer sync's cases in the sim](01-pointer-sync.md#cases-for-the-bench) hold, in stage 14's session, with the real core hosting and a bench core's fake cockpit panel as the second pilot's display, on the Baron 58P's tablet and on the A220's ND with a local profile that names its `DisplayUnits`?

**Expected:** each case to pass.

**Found:** on MSFS 2024 SunRise 12.2.282174.999 ([the runs' reports](../sync/results/2026-11-09-stage-14-session-reruns.txt)):

- On the A220's ND, with its power on, every case passed: the second pilot's tap played as one down, one up, and one click; their press held 3s played through to its up; their drag, a step every 100ms, played its down, four moves, and its up; the pilot's press under their lock flashed; and the pilot's press, dragged off the ND and let go, played on the second pilot's display and ended there, leaving it unlocked.
- The A220's five screens are one panel, `VCockpit02 - DisplayUnits`, whose key carries the livery, `DisplayUnits|config=C-GUAC`.
  With a fake display keyed plain `DisplayUnits`, nothing played either way, as the known limit of the entry below has it, so the second pilot's display takes the sim's key.
- On the Baron's tablet, the tap played as one down, one up, and one click, the held press played through, the pilot's press under the lock flashed, and the press dragged off ended on the second pilot's display.
- A drag whose moves went in the same instant as its press and up played as a down at its start and an up at its end, with no moves between, on both displays.
  No hand drags that way, and the paced drag passed.

**Changed:** the session's script gives the second pilot's display the sim's key, and drags at a hand's pace.

**Affects:** nothing in the design.

## 2026-10-25: Stage 19 builds pointer sync, and a PF's press made before the PM's catch-up ask reaches the PF drops on the PM

**Asked:** do [stage 19](../build/plan.md#19-pointer-sync)'s cases hold between bench cores, each with a fake cockpit panel running the panel bridge and the `pointer-sync` module over a fake document, and do [pointer sync's budgets](01-pointer-sync.md#budgets)?

**Expected:** the design as [01-pointer-sync](01-pointer-sync.md) gives it, which no run had tried.

**Found:** on our development machine, with no game running ([results](results/2026-10-25-stage-19-bench.txt)):

- All 9 `pointer-sync` cases pass, and the 7 `cockpit` cases, whose first now sends a pointer sync tap behind a held value.
  The bridge's tests and the module's, 24 in all, pass over the fake document.
- A tap plays as `mousedown`, `mouseup`, and `click` at the same fractions.
  A 5s hold keeps the other display locked through its `Held` messages, and the same hold made during a cut replays as a 5,008ms press.
- A drag sent 21.3 moves a second, against the design's about 30, and brought 22 messages a second to the other panel, against under 30.
  The bench's drag moves the pointer at Windows' 15.6ms timer ticks, so the 33ms between moves passes on the third tick, 47ms apart, where a mouse event each frame at 30 or 60 fps sends one every 33ms.
- A move's cockpit message takes 106 bytes, against the design's estimate of about 100, so a drag costs about 3.2 KB/s before packet headers; pilot IDs, in the sender, the clock's two counters, and the control value, take 64 of them.
- A killed sender's gesture lapsed on the other display 2,016ms after its last move, and a module that throws partway left no lock 1,999ms after it failed, against 2s.
- The PM's displays locked 4,999ms after its link to the PF was cut, as the link was lost at 5s, and with the core suspended, its visible locks turned into warnings 8,094ms after its last message, against 10s.
- A gesture goes out under its instrument's whole key, which carries its url's query, and the A220's display units carry the livery there, as `DisplayUnits|config=N324DU` ([displays](../profiles/01-format-and-delivery.md#displays)).
  So two pilots on different liveries, who fly together, play none of each other's display presses; the code review found it.
  Keying a gesture by the profile's `displays` entry instead would cross the A220's four FCPs, `FCP|type=vs`, `alt`, `hdg`, and `speed`, which a profile's bare `FCP` opts in and only the query tells apart (measured on MSFS 2024, 2026-09-01, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-01 - Single-machine cockpit validation: the production pipeline works").
- Stage 13's cockpit stream answers a catch-up with the PF's whole clock, so a PF's press sent before the PM's catch-up ask reaches the PF is covered by the answer, and drops on the PM as a copy (read in `src/platform/cockpit-stream/src/lib.rs`, `answer` and `answered_catch_up`).
  The design has the PF's presses in the first seconds after preflight's end play on the PM; on the bench, one made after the ask played while the catch-up ran.
- The code review made 8 findings; besides the key, it found a rejoin for a late instrument that left the core skipping that panel's gestures, the pilot's own up ignored when it landed on a lock, a held press under a lock with no deadman, and an unlocked panel's ups each waiting 1s; each is fixed, with a test in the bridge's, the module's, or the clients crate's tests.

**Changed:** the user decided each of these on 2026-10-25:

- A gesture keeps its instrument's whole key, and a display whose key carries the livery playing nothing on another livery is a known limit.
  The core hands each message only to the panels serving an instrument of its key, on each panel's socket, through a `unit` message to one socket that the clients crate takes, so two panels holding displays each get only their own display's messages.
- A gesture whose pilot neither moves nor releases for 30s ends with an `Up` and no click, since an up the panel never hears, as when the pilot releases off the panel, would keep the other display locked through its `Held` messages.
- A press under a lock whose up the panel never hears holds the lock 10s at most.
- The visible lock says "Lost the connection to the pilot flying. Take control to keep flying, or wait for the connection to come back." with no link to the PF, and "Catching up with the pilot flying's cockpit. This display unlocks when it's done." through a replay or a catch-up; the warning says "Dual Input stopped responding, so presses on this display aren't shared with the other pilot.", on a gray veil that blocks nothing, until the core speaks again or its socket closes.
- A PF's press made before the PM's catch-up ask reaches the PF, within about one trip of preflight's end, dropping on the PM is a known limit, since a PF rarely presses a synced display then.

**Affects:** [01-pointer-sync](01-pointer-sync.md), whose note gives the four changes to its design.
Its cases in the sim moved to [stage 14](../build/plan.md#14-state-sync)'s session, and its cases with friends to [stage 16](../build/plan.md#16-flight-model-sync)'s first flight with friends.
