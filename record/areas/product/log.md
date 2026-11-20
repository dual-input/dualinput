# Product: log

What we found about Dual Input as a whole, such as what it costs the PC that runs the sim, newest entry first.
The probes are in [experiments/areas/product](../../../experiments/areas/product), and their raw output is in its `results/` folder.

## 2026-11-20: Dual Input added 0.85ms to the sim's frame and FS Copilot 0.30ms, and Dual Input's figures about 0.34ms of its 0.85ms

**Asked:** what each shared-cockpit tool costs the PC that runs the sim, in the sim's frame time, the tool's own CPU and memory, and its network bytes, with Dual Input and FS Copilot in the same aircraft, and how much of Dual Input's cost its figures make.

**Expected:** Dual Input to cost the sim's frame more than FS Copilot, as two rounds of the same runs showed on 2026-11-19: +0.97ms against FS Copilot's +0.54ms, in an order that put Dual Input last in each round ([report](../../../experiments/areas/product/results/p31-2026-11-19_12-46-28-report.md)).
The two figures, the pilot's own and the second pilot's in the right seat, to cost about 0.05ms to 0.07ms, since one figure in view with every joint moving cost 26µs to 37µs in [the avatars log](../avatars/log.md#2026-10-05-each-figure-poses-from-its-own-objects-variables-and-costs-frame-time-in-view-and-almost-none-out-of-view).

**Found:** on MSFS 2024 1.9.24.0, on our development machine, 2026-11-20, with the `p31-tool-cost` harness ([procedure](../../../experiments/areas/product/p31-tool-cost/procedure.md), [report](../../../experiments/areas/product/results/p31-2026-11-20_13-12-29-report.md)).
Each run started the sim fresh with one tool's package in Community, or neither, loaded the Black Square Baron 58P on runway 14 at Seymour, SEGS, at noon, and after 30s timed every frame for 300s with nobody at the PC, with no frame-rate cap, frame generation off, at 3440x1440.
PresentMon 2.6.0 timed the frames with its display, GPU, and input tracking off: with display tracking on it wrote none of the sim's frames (2026-11-19), and the PresentMon in NVIDIA's FrameView SDK records nothing outside FrameView (2026-11-18).
Each tool linked to a second pilot on the same PC through a local relay: FS Copilot 172e480 to a second FS Copilot kept off the sim, and Dual Input's release core at 933d7b9 to a bench core on a stand-in sim.
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
