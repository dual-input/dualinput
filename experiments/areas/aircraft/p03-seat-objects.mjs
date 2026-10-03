/*
 * p03: whether the sim lists seat objects for the loaded aircraft, read through
 * SimConnect, on MSFS 2024, so an aircraft whose model files are encrypted can
 * still seat a figure.
 *
 * The C152's seats show up as objects, SEAT_C152_Pilot and SEAT_C152_Pax, and
 * the A2A Comanche's as SEAT_DEFAULT_Pilot and SEAT_DEFAULT_Copilot (measured on
 * MSFS 2024, 2026-10-02 and 2026-10-03, record/areas/avatars/log.md). Both
 * aircraft ship readable model files. Whether a partly encrypted Marketplace
 * aircraft, such as the FSReborn Phenom 300E or the iniBuilds A380, gets seat
 * objects too is what this answers.
 *
 * Unattended, a few seconds, with the aircraft loaded and the pilot seated.
 * It lists every object within 50m: its title, category, and where it sits
 * relative to the aircraft's reference point, in meters forward, right, and up.
 *
 *   node experiments/areas/aircraft/p03-seat-objects.mjs
 *
 * Output: the list on the console, and in
 * experiments/areas/aircraft/results/p03-seat-objects-<time>.txt with the
 * .ndjson beside it.
 */

import { Recorder, fmt } from "./lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "./lib/sim.mjs"
import { toBody } from "../avatars/lib/pose.mjs"

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const RADIUS_M = 50

const rec = new Recorder("p03-seat-objects", { area: "aircraft" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p03-seat-objects" })
rec.open()

const pose = async (object) => {
  const v = await sim.read(POS, { object, label: `read the position of object ${object}` })
  const [lat, lon, alt, hdg] = POS.map(([n]) => v.get(n))
  return Number.isFinite(lat) ? { lat, lon, alt, hdg } : null
}

const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
const aircraft = await pose(0)
rec.log("aircraft", `TITLE ${JSON.stringify(title)}`)

const lines = []
const ids = await sim.byType(1, RADIUS_M, { timeoutMs: 5000 })
rec.log("objects", `${ids.length} objects within ${RADIUS_M}m${ids.error ? `, ${ids.error}` : ""}`)
for (const id of ids) {
  const s = await sim.readStrings(["TITLE", "CATEGORY"], { object: id, label: `read the names on object ${id}` })
  const p = await pose(id)
  const b = p && aircraft ? toBody(aircraft, p) : null
  const where = b ? `${b.forward.toFixed(2)}m forward, ${b.right.toFixed(2)}m right, ${b.up.toFixed(2)}m up` : "no position"
  const line = `object ${id}: TITLE ${JSON.stringify(s.get("TITLE") ?? null)}, CATEGORY ${JSON.stringify(s.get("CATEGORY") ?? null)}, ${where}${p ? `, heading ${fmt(p.hdg)}°` : ""}`
  lines.push(line)
  rec.log("object", line, { id, title: s.get("TITLE") ?? null, category: s.get("CATEGORY") ?? null, body: b })
}

const seats = lines.filter((l) => /seat/i.test(l))
const text = [
  "p03 · Seat objects for the loaded aircraft, through SimConnect, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  `Aircraft: TITLE ${JSON.stringify(title)}`,
  "",
  `Objects within ${RADIUS_M}m: ${lines.length}`,
  ...lines.map((l) => `  ${l}`),
  "",
  `Seat objects: ${seats.length ? seats.length : "none"}`,
  `Exceptions: ${rec.timeline.filter((e) => e.kind === "exception").map((e) => e.text).join("; ") || "none"}`,
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
sim.close()
await rec.close()
process.exit(0)
