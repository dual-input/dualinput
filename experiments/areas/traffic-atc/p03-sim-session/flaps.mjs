/*
 * p03: every flap variable the SDK documents on one AI aircraft, found by its ATC ID, for an aircraft whose flaps the
 * pilot sees out while traffic's four surfaces read 0.
 *
 *   node experiments/areas/traffic-atc/p03-sim-session/flaps.mjs <ATC ID>
 */

import { Recorder } from "../../aircraft/lib/out.mjs"
import { Sim } from "../../aircraft/lib/sim.mjs"

const TAIL = process.argv[2]
const VARS = [
  ["FLAPS HANDLE INDEX", "number"],
  ["FLAPS HANDLE PERCENT", "percent"],
  ["FLAPS NUM HANDLE POSITIONS", "number"],
  ["FLAPS AVAILABLE", "bool"],
  ["TRAILING EDGE FLAPS LEFT PERCENT", "percent"],
  ["TRAILING EDGE FLAPS RIGHT PERCENT", "percent"],
  ["TRAILING EDGE FLAPS LEFT ANGLE", "degrees"],
  ["TRAILING EDGE FLAPS RIGHT ANGLE", "degrees"],
  ["TRAILING EDGE FLAPS LEFT INDEX", "number"],
  ["LEADING EDGE FLAPS LEFT PERCENT", "percent"],
  ["LEADING EDGE FLAPS LEFT ANGLE", "degrees"],
  ["LEADING EDGE FLAPS LEFT INDEX", "number"],
  ["FLAPS EFFECTIVE HANDLE INDEX", "number"],
  ["GROUND VELOCITY", "knots"],
  ["IS LATITUDE LONGITUDE FREEZE ON", "bool"],
]

const rec = new Recorder("p03-flaps", { area: "traffic-atc" })
rec.open()
const sim = await Sim.connect(rec, { name: "DUALINPUT p03 flaps" })
for (const type of [2, 3]) {
  for (const id of await sim.byType(type, 10_000)) {
    const t = await sim.readStrings(["TITLE", "ATC ID"], { object: id })
    if (t.get("ATC ID") !== TAIL) continue
    const v = await sim.read(VARS, { object: id })
    rec.log("found", `${t.get("TITLE")} [${TAIL}] (${id}): ${VARS.map(([n]) => `${n}=${v.get(n) ?? "-"}`).join(", ")}; missing ${v.missing.join(", ") || "none"}`)
  }
}
process.exit(0)
