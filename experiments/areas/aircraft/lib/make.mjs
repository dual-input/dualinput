/*
 * Builds a flight file for one aircraft and start state from F1, the PA-24's
 * file of 2026-10-01, which is the sim's own CustomFlight.FLT with the other
 * aircraft's state sections removed and loaded in our FlightLoad probe
 * (experiments/areas/aircraft/results/p01-flight-load-2026-10-01-17-29-57.txt).
 *
 * Everything but the aircraft, the start state, and the position stays as F1
 * has it: GVAC, live weather, the same scheduler time.
 *
 * runway   holding short of runway 19, FirstFlightState PREFLIGHT_HOLDSHORT,
 *          F1's own position and heading.
 * parked   parking spot PARKING 7 on the main apron, FirstFlightState
 *          PREFLIGHT_GATE, with [Departure] naming the spot as the SDK gives
 *          (MSFS 2024 SDK, FLT File Properties, [Departure] GateName,
 *          GateNumber, GateSuffix: https://docs.flightsimulator.com/msfs2024/
 *          html/5_Content_Configuration/FLT_Files/FLT_Properties.htm). The spot
 *          is the south end of the line of seven large ramp spots, PARKING 1
 *          to 7, whose MSFS 2024 data gives each a 79 ft radius, heading 90°
 *          true, 72m apart (read in Little Navmap's MSFS 2024 database,
 *          little_navmap_msfs24.sqlite, table parking, 2026-10-01). GVAC has
 *          no spot whose radius fits a 777-300ER's 64.8m span or an A380's
 *          79.8m, so we took the end of the line, where one wing has the open
 *          apron and the other the empty spot 6.
 */

import { existsSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { findPackage, getKey, latText, lonText, parseFlt, readFltFile, removeKey, renderFlt, setKey } from "./flights.mjs"

export const FLIGHTS = join(dirname(fileURLToPath(import.meta.url)), "..", "flights")
export const TEMPLATE = join(FLIGHTS, "f1-pa24-gvac.flt")

export const PARKED = {
  gateName: "PARKING",
  gateNumber: 7,
  lat: 16.73172378540039,
  lon: -22.94498634338379,
  headingDeg: 89.83065795898438,
}

export const flightFile = (id, state) => join(FLIGHTS, `${id}-${state}.flt`)

// The package's own phase file for a start state: apron.flt for parked,
// runway.flt for the runway, matched without regard to case.
function phaseFile(a, state) {
  if (!a.phaseLocalVars) return null
  const root = findPackage(a.phaseLocalVars.pkg)
  if (!root) return null
  const dir = join(root, ...a.phaseLocalVars.dir)
  if (!existsSync(dir)) return null
  const want = state === "parked" ? "apron.flt" : "runway.flt"
  const hit = readdirSync(dir).find((f) => f.toLowerCase() === want)
  return hit ? join(dir, hit) : null
}

// Returns { parsed, text, notes } without writing anything.
export function makeFlight(a, state) {
  if (!a.title) throw new Error(`${a.id}: no title yet; a live session has to list it`)
  const f = readFltFile(TEMPLATE)
  const notes = []
  setKey(f, "Main", "Title", `Crosscheck ${a.id} ${state}`)
  setKey(f, "Main", "Description", `Crosscheck harness: ${a.name}, ${state} at GVAC`)
  setKey(f, "Sim.0", "Sim", a.title)
  if (a.livery) setKey(f, "Sim.0", "Livery", a.livery)
  else removeKey(f, "Sim.0", "Livery")
  setKey(f, "Sim.0", "TailNumber", a.tail ?? "")

  if (state === "parked") {
    setKey(f, "FreeFlight", "FirstFlightState", "PREFLIGHT_GATE")
    removeKey(f, "Departure", "RunwayNumber")
    removeKey(f, "Departure", "RunwayDesignator")
    setKey(f, "Departure", "ICAO", "GVAC")
    setKey(f, "Departure", "GateName", PARKED.gateName)
    setKey(f, "Departure", "GateNumber", String(PARKED.gateNumber))
    setKey(f, "Departure", "GateSuffix", "NONE")
    setKey(f, "SimVars.0", "Latitude", latText(PARKED.lat))
    setKey(f, "SimVars.0", "Longitude", lonText(PARKED.lon))
    setKey(f, "SimVars.0", "Pitch", "0")
    setKey(f, "SimVars.0", "Heading", String(PARKED.headingDeg))
  }

  const phase = phaseFile(a, state)
  if (a.phaseLocalVars) {
    if (!phase) throw new Error(`${a.id}: no ${state === "parked" ? "apron" : "runway"} flight file in its package`)
    const src = readFltFile(phase)
    const lv = src.sections.find((s) => s.name.toLowerCase() === "localvars.0")
    const dest = f.sections.find((s) => s.name.toLowerCase() === "localvars.0")
    if (lv && dest) {
      const lines = lv.lines.slice(1).filter((l) => l.indexOf("=") > 0)
      dest.lines = [dest.lines[0], ...lines, ""]
      notes.push(`[LocalVars.0] from ${phase.split(/[\\/]/).slice(-1)[0]}: ${lines.length} keys`)
    }
  }
  return { parsed: f, text: renderFlt(f), notes, state, firstState: getKey(f, "FreeFlight", "FirstFlightState") }
}

export { parseFlt }
