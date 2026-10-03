# Environment: log

What our experiments found about the sim's pause, simulation rate, and time of day, newest entry first.
The pause menu raises the sim pause and lets the sim's clock run, active pause stops the clock, and only SimConnect raised a full pause.
The rate steps and the time events work from SimConnect, and `K:SIM_RATE_SET` doesn't.
The date events work too, with `K:ZULU_DAY_SET` taking a day of the year.
The probe is [p01-clock.mjs](../../../experiments/areas/environment/p01-clock.mjs), and its raw output is in [experiments/areas/environment/results](../../../experiments/areas/environment/results).
Every entry was measured on MSFS 2024 SunRise 12.2.282174.999 on 2026-10-03, with the aircraft parked.

## 2026-10-03: `K:ZULU_DAY_SET` takes a day of the year, and the date events hold

**Asked:** can a SimConnect client set the date, and does `K:ZULU_DAY_SET` take a day of the month or a day of the year?

**Expected:** no prediction.

**Found:**

- From 2026-10-03, day 276 of the year, `K:ZULU_DAY_SET` 316 made the date 2026-11-12 within a second, and `K:ZULU_DAY_SET` 10 made it 2026-01-10, so the event takes a day of the year.
- `K:ZULU_YEAR_SET` 2027 made it 2027-01-10.
- Each date held for the 6s we watched, the local date moved with the zulu date, and the time of day ran on untouched.
- `K:ZULU_YEAR_SET` 2026 and `K:ZULU_DAY_SET` 276 put the date back to 2026-10-03.

**Changed:** Crosscheck can bring every machine to the PF's date as well as the PF's time of day, which matters to weather add-ons that pick the weather by date.

**Affects:** time, date, sim rate, and pause in [03-v1-scope](../product/03-v1-scope.md).

**Evidence:** [the date run](../../../experiments/areas/environment/results/p01-clock-2026-10-03-17-49-38.txt).

## 2026-10-03: The rate steps and the time events work from SimConnect, and `K:SIM_RATE_SET` doesn't

**Asked:** can a SimConnect client set the simulation rate and the time of day, and do the time events hold?
Forum reports say `K:ZULU_HOURS_SET` and `K:CLOCK_HOURS_SET` get reverted a second later, or reset the date ([02-03](../../learn/foundations/02-03-the-running-sim.md#unverified-claims), unverified).

**Expected:** no prediction.

**Found:**

- `K:SIM_RATE_INCR` took `E:SIMULATION RATE` from 1 to 2, then 4, then 8, and `K:SIM_RATE_DECR` stepped it back to 1.
- `K:SIM_RATE_SET` changed nothing, sent with 1 at a rate of 4 and with 256 at a rate of 8.
- `K:ZULU_HOURS_SET` 20 moved `E:ZULU TIME` from 17:34 to 20:34 within a second, and it was still 20:34 and running 20s later.
  `E:LOCAL TIME` moved with it, 6 hours behind, and the date stayed 2026-10-03.
- `K:ZULU_MINUTES_SET` and `K:CLOCK_HOURS_SET` held the same way, and `K:CLOCK_HOURS_SET` moved zulu time with local time.

**Changed:** Crosscheck can bring every machine to the PF's simulation rate, in steps, and to the PF's time of day, with the time events; on this build they don't revert.
Whether calculator code can set `E:SIMULATION RATE` directly, as the SDK says, is untested.

**Affects:** time, date, sim rate, and pause in [03-v1-scope](../product/03-v1-scope.md); [02-03](../../learn/foundations/02-03-the-running-sim.md#unverified-claims), whose unverified claims include the time events reverting.

**Evidence:** [the full run](../../../experiments/areas/environment/results/p01-clock-2026-10-03-17-32-54.txt).

## 2026-10-03: The pause menu is the sim pause and lets the clock run, active pause stops it, and only SimConnect raised a full pause

**Asked:** which of the pilot's actions raise which `Pause_EX1` flag, does the sim's clock run in each, and does `K:PAUSE_SET` work from SimConnect?
The SDK names full pause (1), active pause (4), and sim pause (8), and we didn't know what raises the sim pause ([02-03](../../learn/foundations/02-03-the-running-sim.md#the-sim-loop)).

**Expected:** no prediction.

**Found:**

- Opening the pause menu with Esc raised `Pause_EX1` 8, the sim pause, with `View` 0, and `E:ZULU TIME` kept running at 1.00x real time.
  Closing it sent 0.
- The active pause button raised 4, and the pilot's own pause key raised 4 as well; in both, `E:ZULU TIME` stopped, advancing at -0.14x to 0.32x real time across a window that included the moments before and after.
- Opening the EFB with Tab and opening photo mode raised no pause, and the clock ran at 1.00x.
- `K:PAUSE_SET` 1 from SimConnect raised 1, the full pause, and SimConnect sent no frame data at all until `K:PAUSE_SET` 0 cleared it.
  Nothing the pilot did raised a full pause.

**Changed:** the pause menu doesn't stop the sim's clock, so two machines stay in step through one pilot opening it, and active pause, which stops the clock, is the pause to sync.
Photo mode raised no pause event, as a forum report says, and whether it froze the aircraft, as the same report says, a parked aircraft can't show ([02-03](../../learn/foundations/02-03-the-running-sim.md#unverified-claims)).

**Affects:** time, date, sim rate, and pause in [03-v1-scope](../product/03-v1-scope.md); [02-03](../../learn/foundations/02-03-the-running-sim.md#the-sim-loop).

**Evidence:** [the full run](../../../experiments/areas/environment/results/p01-clock-2026-10-03-17-32-54.txt), and the tours of [the first run](../../../experiments/areas/environment/results/p01-clock-2026-10-03-17-32-13.ndjson) and [the run with photo mode](../../../experiments/areas/environment/results/p01-clock-2026-10-03-17-37-45.ndjson), both stopped after their tours.
