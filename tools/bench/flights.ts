// The flights a scenario loads on a core's stand-in sim: a load's signals in the order the sim
// gives them, through to Flying, a flight's end to the main menu, and where a scenario's flying
// aircraft starts.

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

/** Where a scenario's flying aircraft starts: over Switzerland, in degrees and feet. */
export const START = { lat: 47, lon: 8, alt: 5_000 }
/** Meters in a degree of latitude, and in a degree of longitude at `START`'s latitude. */
export const METERS_NORTH = 111_195
export const METERS_EAST = METERS_NORTH * Math.cos((START.lat * Math.PI) / 180)
/** 150 kt, in feet per second. */
export const SPEED_FT = 253.2

/**
 * Loads a flight in `aircraft`, on the ground unless `airborne`, through to Flying. `flight` names
 * the flight file the sim service reads its departure from, which a file that doesn't exist leaves
 * without one.
 */
export async function load(core: Core, aircraft: Aircraft, { airborne = false, title = "Baron 58P", livery = "N515MR", flight = "x.FLT" } = {}): Promise<void> {
  const after = core.heard().length
  core.act({ act: "set", numbers: [["A:SIM ON GROUND", airborne ? 0 : 1]], texts: [["A:TITLE", title], ["A:LIVERY NAME", livery]] })
  const signals: Played[] = [
    { after_ms: 0, signal: { signal: "flight-loaded", path: flight } },
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
