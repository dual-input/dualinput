/*
 * p03: the sim's aircraft and helicopter titles that hold a word, such as `Passive`, to find a stand-in the sim
 * creates for a title it lacks.
 *
 *   node experiments/areas/traffic-atc/p03-sim-session/titles.mjs <word>
 */

import { Recorder } from "../../aircraft/lib/out.mjs"
import { Sim } from "../../aircraft/lib/sim.mjs"

const WORD = (process.argv[2] ?? "Passive").toLowerCase()
const rec = new Recorder("p03-titles", { area: "traffic-atc" })
rec.open()
const sim = await Sim.connect(rec, { name: "DUALINPUT p03 titles" })
// SIMCONNECT_SIMOBJECT_TYPE: aircraft 2, helicopter 3 (MSFS 2024 SDK, SimConnect.h).
for (const [name, type] of [["aircraft", 2], ["helicopter", 3]]) {
  const list = await sim.liveries({ type })
  const titles = [...new Set(list.map((l) => l.title))].filter((t) => t.toLowerCase().includes(WORD)).sort()
  rec.log("titles", `${name}: ${titles.length} titles hold "${WORD}": ${titles.join("; ")}`)
}
process.exit(0)
