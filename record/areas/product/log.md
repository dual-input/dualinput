# Product: log

What we found about Dual Input as a whole, such as what it costs the PC that runs the sim, newest entry first.
The probes are in [experiments/areas/product](../../../experiments/areas/product), and their raw output is in its `results/` folder.

## 2026-11-20: The figures' 0.34ms is about what the product's figure was measured to cost, and the schedule's entry below compared it with the probes' lighter one

**Asked:** why Dual Input's two figures cost the sim's frame five to seven times what [the schedule's entry below](#2026-11-20-dual-input-added-085ms-to-the-sims-frame-and-fs-copilot-030ms-and-dual-inputs-figures-about-034ms-of-its-085ms) expected.

**Expected:** something in the figure or in our module that the probes' figure didn't have.

**Found:** from the record and the code, with no new run.

- That entry expected 0.05ms to 0.07ms from p28's figure, which [the avatars log](../avatars/log.md#2026-11-05-a-click-that-took-the-focus-from-the-sim-left-a-figures-hand-out-and-the-rest-of-the-session-passed) lists as the budget beside the product's own figure.
  The product's figure, measured on MSFS 2024 on 2026-11-05 in that entry, cost 64µs each in view and still at its closest level of detail, and 105µs with every joint moving, against p28's 16µs to 21µs and 26µs to 37µs.
  The same entry timed our module's frame at 86µs at the median with two figures seated, against 3µs before the session, in Developer Mode, which may inflate it.
- The product's figure is rounder by the user's choice, since the pilots sit an arm's length apart: its closest level draws 47,104 triangles as posed, at 46 draw calls ([avatars log](../avatars/log.md#2026-11-05-the-figures-closest-level-of-detail-draws-47104-triangles-since-the-pilots-sit-an-arms-length-apart)).
  Its compiled `DUALINPUT_FIGURE_PILOT_LOD00.gltf` places 35 meshes on 146 nodes (read in src/features/avatars/figure/compiled/model/).
- The core with no figures creates no figure, so it feeds `Figure` an empty slot (read in src/features/avatars/core/src/crew.rs, `feed`), and its runs leave out both the drawing and `Figure`'s work on each figure.
- So two figures should cost 0.13ms drawn still or 0.21ms moving, plus `Figure`'s share of the module's 86µs, which no run has split out: 0.13ms to about 0.3ms (arithmetic).
  p31 measured 0.34ms, with rounds from -0.09ms to 0.59ms.

**Changed:** nothing.
The schedule's entry below was wrong that the figures cost five to seven times what we'd measured: they cost about what the user accepted for two figures on 2026-11-05, 0.13ms to 0.21ms drawn and about 0.14ms in the module (user, 2026-11-05).
Its open question about the figures, and its effect on [04-room-for-later](04-room-for-later.md#people-beyond-the-crew), whose lighter crowd figures p28's numbers fit, no longer stand.

**Affects:** the schedule's entry below.

## 2026-11-20: Our EFB app and banner cost the sim's frame nothing we could measure, nor did the bench's own watcher

**Asked:** whether our pages in the sim, the EFB app and the banner, make the part of Dual Input's frame cost [the entry below](#2026-11-20-dual-input-added-085ms-to-the-sims-frame-and-fs-copilot-030ms-and-dual-inputs-figures-about-034ms-of-its-085ms) left open beyond its figures, and whether the bench's own processes do.

**Expected:** the pages, since FS Copilot draws nothing in the sim, and the crew's heads on our pages draw up to 30 times a second while one moves (read in src/packages/crew/src/heads/live.ts, `LIVE`).

**Found:** on MSFS 2024 1.9.24.0, on our development machine, in one Dual Input session flying as the schedule's did, from [p31-tool-cost](../../../experiments/areas/product/p31-tool-cost/pages.mjs)'s `hold` and `pages.mjs`.
The package and cores were rebuilt at 913f6ef first, since the bench's tools there refused the bench core built at fa505c5.

- Our menu script ran in the sim's `mainUi`, our panel bridge in all 20 of the 58P's cockpit panels, our EFB app in the EFB's document, and the banner in its own panel ([look](../../../experiments/areas/product/results/p31-pages-look-2026-11-20-16-06-33.txt)).
- The EFB was closed, its document 782 by 0 pixels, and our app had no canvas in it, so no head was drawing.
- The banner's panel stayed open through the session, 480 by 520 pixels, with nothing on it.
- Over 20s, every document's animation-frame and timer callbacks together took 129ms a second: the weather radar's panel 49ms, the Flow add-on's 44ms, and each other gauge 7.7ms or less ([meter](../../../experiments/areas/product/results/p31-pages-meter-2026-11-20-16-07-42.txt)).
  Our banner ran none, the EFB's document 0.2 a second at 0.00ms, and `mainUi` none.
  The meter counts only callbacks scheduled after it starts, so the instrument reads' 250ms timer, the menu script's 500ms one, and work a socket's message starts went uncounted.
- With the banner's panel closed and opened in turn, the frame took 13.56ms and 13.60ms closed, and 13.59ms and 13.65ms open ([readings](../../../experiments/areas/product/results/p31-pages-2026-11-20-readings.txt)).
  The frame rose about 0.03ms from each reading to the next, which accounts for the 0.04ms between the two.
- With the local backend's esbuild paused and running in turn, about 3% of one core in the schedule's runs, the frame took 13.71ms and 14.04ms paused, and 13.85ms and 13.89ms running.
- The frame rose from 13.50ms to 13.89ms over the session's 8 minutes of readings, and two 30s readings a minute apart differed by up to 0.19ms, so these readings can't resolve less than about 0.2ms.

**Changed:** nothing.
What's left of Dual Input's cost beyond its figures is its panel bridge in every cockpit panel, our module's work each frame, and the core's SimConnect traffic, none of which a session can switch off and on.
A schedule with each left out, from an uncommitted patch, would settle which.

**Affects:** the open question in the entry below.

**Evidence:** [the readings](../../../experiments/areas/product/results/p31-pages-2026-11-20-readings.txt), [the look](../../../experiments/areas/product/results/p31-pages-look-2026-11-20-16-06-33.txt), and [the meter](../../../experiments/areas/product/results/p31-pages-meter-2026-11-20-16-07-42.txt).

## 2026-11-20: Dual Input added 0.85ms to the sim's frame and FS Copilot 0.30ms, and Dual Input's figures about 0.34ms of its 0.85ms

**Asked:** what each shared-cockpit tool costs the PC that runs the sim, in the sim's frame time, the tool's own CPU and memory, and its network bytes, with Dual Input and FS Copilot in the same aircraft, and how much of Dual Input's cost its figures make.

**Expected:** Dual Input to cost the sim's frame more than FS Copilot, as two rounds of the same runs showed on 2026-11-19: +0.97ms against FS Copilot's +0.54ms, in an order that put Dual Input last in each round ([report](../../../experiments/areas/product/results/p31-2026-11-19_12-46-28-report.md)).
The two figures, the pilot's own and the second pilot's in the right seat, to cost about 0.05ms to 0.07ms, since one figure in view with every joint moving cost 26µs to 37µs in [the avatars log](../avatars/log.md#2026-10-05-each-figure-poses-from-its-own-objects-variables-and-costs-frame-time-in-view-and-almost-none-out-of-view).

**Found:** on MSFS 2024 1.9.24.0, on our development machine, 2026-11-20, with the `p31-tool-cost` harness ([procedure](../../../experiments/areas/product/p31-tool-cost/procedure.md), [report](../../../experiments/areas/product/results/p31-2026-11-20_13-12-29-report.md)).
Each run started the sim fresh with one tool's package in Community, or neither, loaded the Black Square Baron 58P on runway 14 at Seymour, SEGS, at noon, and after 30s timed every frame for 300s with nobody at the PC, with no frame-rate cap, frame generation off, at 3440x1440.
PresentMon 2.6.0 timed the frames with its display, GPU, and input tracking off: with display tracking on it wrote none of the sim's frames (2026-11-19), and the PresentMon in NVIDIA's FrameView SDK records nothing outside FrameView (2026-11-18).
Each tool linked to a second pilot on the same PC through a local relay: FS Copilot 172e480 to a second FS Copilot kept off the sim, and Dual Input's release core at fa505c5 to a bench core on a stand-in sim.
The fourth mode ran Dual Input's core built with `no-figures.patch`, which creates no figure in the sim and still sends the pilot's pose.
Four rounds ran the four modes, every second round in reverse, so a steady drift over the 4 hours falls on every mode alike.
All 16 runs measured, with the sim in focus throughout.

The sim's median frame time in each run, in ms, with each tool's difference from the no-tool run of its round:

| Round | Order | No tool | FS Copilot | Dual Input | Dual Input, no figures |
| --- | --- | --- | --- | --- | --- |
| 1 | forward | 13.11 | 13.87 (+0.76) | 14.17 (+1.06) | 13.58 (+0.47) |
| 2 | reversed | 13.06 | 13.53 (+0.47) | 14.27 (+1.21) | 13.93 (+0.87) |
| 3 | forward | 13.25 | 13.19 (-0.06) | 13.88 (+0.63) | 13.55 (+0.30) |
| 4 | reversed | 13.35 | 13.42 (+0.07) | 13.70 (+0.35) | 13.79 (+0.44) |
| Median of 4 | | 13.18 | 13.48 (+0.30) | 14.03 (+0.85) | 13.69 (+0.51) |

- The no-tool runs spread 0.29ms, so FS Copilot's 0.30ms and the figures' 0.34ms sit at the edge of what this setup tells apart from the PC's drift, and Dual Input's 0.85ms well above it.
- At those medians the sim ran 75.3 fps with no tool, 73.7 with FS Copilot, 70.8 with Dual Input, and 72.5 with no figures, and its 99th percentile frame rose 0.43ms with FS Copilot, 1.19ms with Dual Input, and 0.94ms with no figures.
- Dual Input ran slower than FS Copilot in every round, by 0.28ms to 0.74ms.
  It ran slower than with no figures in rounds 1 to 3, by 0.33ms to 0.59ms, and 0.09ms faster in round 4.
- The figures' 0.34ms is five to seven times the 0.05ms to 0.07ms the avatars log predicts.
  Whether the product's figure costs more to draw than p24's, or our module's work on each figure costs the rest, is unknown.
- The sim's CPU worked about 0.24ms less than each frame took, in every mode, so the sim was CPU-bound and each tool's cost landed on that work.
- Every tool cost more in rounds 1 and 2 than in rounds 3 and 4, while the no-tool runs stayed within 13.06ms to 13.35ms.
  The cause is unknown, and the reversed rounds spread it over every mode.
- Dual Input's core and its helper used 3.8% of one core and 75 MB, and FS Copilot 8.2% and 323 MB.
  The sim's frame also carries the load each second pilot put on the same PC: Dual Input's bench core, bench relay, and local backend used about 9.5% of one core, and FS Copilot's second app and relay 5.3% to 6.3%, while the whole PC sat at 42% to 44% of its 16 logical cores in every mode.
  Whether that load or Dual Input's work inside the sim makes its extra cost is unknown.
- Dual Input's profile watched 224 names in the 58P, and FS Copilot's 475 with its 7 modules, so FS Copilot watched twice the names at less cost to the frame.
- At rest on the runway, Dual Input's pilot sent 8.5 KB/s to 8.9 KB/s by the bench relay's own count, the same with no figures, and FS Copilot's pilot 3.2 KB/s, where its relay and the network trace agree.
  For Dual Input's cores the trace disagrees with the relay, for a reason we haven't found: it put 6.1 KB/s to 6.4 KB/s on the pilot, and 13.1 KB/s to 13.9 KB/s on the bench core, which the relay counted at 5.7 KB/s to 6.0 KB/s.

**Changed:** nothing in the design.
Where Dual Input's cost beyond its figures goes, and why its figures cost more than p24's did, stay open.

**Affects:** [04-room-for-later](04-room-for-later.md#people-beyond-the-crew)'s cost of a figure, measured on p24's figure, if a closer run confirms what the product's figures cost here.

**Evidence:** [2026-11-20's report](../../../experiments/areas/product/results/p31-2026-11-20_13-12-29-report.md) and [2026-11-19's](../../../experiments/areas/product/results/p31-2026-11-19_12-46-28-report.md), each with its runs' JSON beside it.
