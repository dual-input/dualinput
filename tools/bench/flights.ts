// The flights a scenario loads on a core's stand-in sim: a load's signals in the order the sim
// gives them, through to Flying, and a flight's end to the main menu.

import type { Played } from "../../src/engines/messages/ts/bench/Played.ts"
import type { Core } from "./cores.ts"

// SimConnect's numbers for the flow events, in SDK 1.8.1's SimConnect.h.
export const RTC_START = 10
export const RTC_END = 11
export const FLIGHT_END = 15

/** The Baron 58P, which the tree's first profile covers, and the PA-24, which none does. */
export const BARON = { cfg: String.raw`SimObjects\Airplanes\bksq-aircraft-baronpropress\aircraft.cfg`, path: "bksq-aircraft-baronpropress" }
export const PA24 = { cfg: String.raw`SimObjects\Airplanes\pa24-250\presets\a2a\pa24-250\config\aircraft.cfg`, path: "pa24-250/presets/a2a/pa24-250" }
export type Aircraft = typeof BARON

/** Loads a flight in `aircraft`, on the ground unless `airborne`, through to Flying. */
export async function load(core: Core, aircraft: Aircraft, { airborne = false, title = "Baron 58P", livery = "N515MR" } = {}): Promise<void> {
  const after = core.heard().length
  core.act({ act: "set", numbers: [["A:SIM ON GROUND", airborne ? 0 : 1]], texts: [["A:TITLE", title], ["A:LIVERY NAME", livery]] })
  const signals: Played[] = [
    { after_ms: 0, signal: { signal: "flight-loaded", path: "x.FLT" } },
    { after_ms: 20, signal: { signal: "aircraft-loaded", path: aircraft.cfg } },
    { after_ms: 20, signal: { signal: "flow", event: RTC_START } },
    { after_ms: 20, signal: { signal: "flow", event: RTC_END } },
  ]
  core.act({ act: "play", signals })
  await core.hear(`stage Flying aircraft ${aircraft.path}`, { after })
}

/** Ends the flight, as the pause menu's End flight does, to the main menu. */
export async function toMenu(core: Core): Promise<void> {
  const after = core.heard().length
  core.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "flow", event: FLIGHT_END } }] })
  await core.hear(/^stage Menu /, { after })
}
