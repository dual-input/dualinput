/*
 * Writes the harness's flight files, flights/<aircraft>-parked.flt and
 * flights/<aircraft>-runway.flt, from F1 and the aircraft registry
 * (lib/make.mjs says what each start state sets, lib/aircraft.mjs which
 * aircraft and livery).
 *
 *   node experiments/areas/aircraft/make-flights.mjs [<aircraft> ...] [--check]
 *
 * It also writes flights/neutral-runway.flt, the stock Cessna 152 the runner
 * loads before restoring a backup; "neutral" names it alone.
 *
 * An aircraft whose title is still unknown, because its package is encrypted,
 * is skipped; the runner writes its files in the first live session, from the
 * titles the sim lists. --check writes nothing and says which files would
 * change.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"

import { join } from "node:path"

import { AIRCRAFT, NEUTRAL, aircraft } from "./lib/aircraft.mjs"
import { FLIGHTS, flightFile, makeFlight } from "./lib/make.mjs"
import { repoRelative } from "./lib/out.mjs"
import { STATES } from "./lib/tests.mjs"

const argv = process.argv.slice(2)
const CHECK = argv.includes("--check")
const ids = argv.filter((a) => !a.startsWith("--"))

let changed = 0
const jobs = (ids.length ? ids : [...Object.keys(AIRCRAFT), "neutral"]).flatMap((id) =>
  id === "neutral" ? [[NEUTRAL, "runway", join(FLIGHTS, "neutral-runway.flt")]] : STATES.map((s) => [aircraft(id), s, flightFile(id, s)]))
for (const [a, state, path] of jobs) {
  if (!a.title) { console.log(`${a.id}: skipped, no title until a live session lists it`); continue }
  {
    const made = makeFlight(a, state)
    const same = existsSync(path) && readFileSync(path, "latin1") === made.text
    if (!same) changed++
    if (!CHECK && !same) writeFileSync(path, made.text, "latin1")
    console.log(`${repoRelative(path)}: ${same ? "unchanged" : CHECK ? "would change" : "written"}; ${made.firstState}${made.notes.length ? `; ${made.notes.join("; ")}` : ""}`)
  }
}
if (CHECK && changed) process.exitCode = 1
