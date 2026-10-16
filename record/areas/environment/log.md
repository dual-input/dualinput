# Environment: log

What our experiments found about the sim's pause, simulation rate, and time of day, newest entry first.
The pause menu raises the sim pause and lets the sim's clock run, active pause stops the clock, and only SimConnect raised a full pause.
The one way we found for code to turn active pause on and off is the toolbar's own call, from the toolbar's or the EFB's document; no SimConnect event we tried did it.
The rate steps and the time events work from SimConnect, and `K:SIM_RATE_SET` doesn't.
The date events work too, with `K:ZULU_DAY_SET` taking a day of the year.
The probes are [p01-clock.mjs](../../../experiments/areas/environment/p01-clock.mjs) and [p02-active-pause.mjs](../../../experiments/areas/environment/p02-active-pause.mjs), and their raw output is in [experiments/areas/environment/results](../../../experiments/areas/environment/results).
They read the sim's environment variables, such as `E:ZULU TIME` and `E:SIMULATION RATE`, through SimConnect by their names without the `E:` prefix.
Every entry was measured on MSFS 2024 SunRise 12.2.282174.999, with the aircraft parked.

## 2026-10-16: The toolbar's `TOOLBAR_SET_ACTIVE_PAUSE`, called from the toolbar's or the EFB's document, turns active pause on and off, and no SimConnect event we tried does

**Asked:** v1 syncs active pause from any pilot ([03-v1-scope](../product/03-v1-scope.md#time-date-sim-rate-and-pause)), so a following machine's core has to set it, and the entries below found only that `K:PAUSE_SET` raises the full pause.
Can code set active pause, and from where?
The SDK lists it only as the input action `KEY_ACTIVE_PAUSE_TOGGLE`, in context `INGAME_UI` (read in the MSFS 2024 SDK, `Tools/Setup_InputProfiles/action.actiondb`), and not among the key events in `WASM/include/MSFS/Types/MSFS_EventsEnum.h`.
The sim's toolbar sets it with `Coherent.call("TOOLBAR_SET_ACTIVE_PAUSE", paused)` (read in fs-base-ui, `html_ui/JS/Services/ToolBarPanels.js`, `setActivePause`).

**Expected:** no SimConnect event, and the toolbar's call only from the toolbar's document, since the EFB's document refused the world map's `requestData` as not bound ([interface log](../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly)).

**Found:** in the Black Square Baron 58P (`bksq-aircraft-baronpropress`), parked, with nobody touching the sim, p02 sent each and watched `Pause_EX1` and `E:ZULU TIME` for 2.5s:

| Sent | `Pause_EX1` | The sim's clock |
| --- | --- | --- |
| `K:PAUSE_ON`, then `K:PAUSE_OFF` | 8, the sim pause, then 0 | Ran at 1.00x |
| `K:PAUSE_TOGGLE`, twice | Nothing | Ran |
| `ACTIVE_PAUSE_TOGGLE`, `TOGGLE_ACTIVE_PAUSE`, `ACTIVE_PAUSE_ON`, and `ACTIVE_PAUSE_SET` through SimConnect | Nothing: each mapping failed with `NAME_UNRECOGNIZED` | Ran |
| `TOOLBAR_SET_ACTIVE_PAUSE` true, then false, by `Coherent.call` in the toolbar's document | 4, active pause, then 0; the call resolved | Stopped, -0.17x, then 0.96x |
| The same in the EFB's document | 4, then 0; the call resolved | Stopped, -0.20x, then 0.94x |
| The same in a cockpit panel's document, `VCockpit60 - WeatherSquare4000_int` | Nothing: "TOOLBAR_SET_ACTIVE_PAUSE not bound", and `Coherent.trigger` raised nothing either | Ran |
| The same in mainUi, by `engine.call` | Nothing: the same "not bound", and `engine.trigger` raised nothing | Ran |

The clock under the toolbar's call read as it did under the pilot's own active pause in the entry below, -0.14x to 0.32x across a window that takes in the moments around the change.
p02 ran its calls in each document through the inspector, with the EFB closed (user, 2026-10-16).

**Changed:** a following machine sets active pause through the EFB app's code, which runs in the EFB's document from the sim's start, with the EFB closed ([interface log](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)); that the app's own code can make the call, as the inspector made it in the EFB's document, is unverified.
None of the SimConnect events we tried could, nor the one cockpit panel and mainUi.
`K:PAUSE_ON` raises the sim pause, which the pause menu raises too, where `K:PAUSE_SET` 1 raised the full pause.

**Affects:** rate and pause in [6.7](../architecture/plan.md#67-the-session), which gains a part in the EFB app; time, date, sim rate, and pause in [03-v1-scope](../product/03-v1-scope.md#time-date-sim-rate-and-pause).

**Evidence:** [the run](../../../experiments/areas/environment/results/p02-active-pause-2026-10-16-16-20-29.txt).

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
