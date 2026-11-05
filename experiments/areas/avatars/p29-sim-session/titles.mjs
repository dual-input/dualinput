/*
 * p29: the title and category of every object within 50m of the aircraft, as profile-author's
 * seat listing asks for them, read one object at a time.
 *
 *   node experiments/areas/avatars/p29-sim-session/titles.mjs
 */

import { Recorder } from "../../aircraft/lib/out.mjs"
import { Sim } from "../../aircraft/lib/sim.mjs"

const rec = new Recorder("p29-titles", { area: "avatars" })
rec.open()
const sim = await Sim.connect(rec, { name: "DUALINPUT p29 titles" })
const lines = []
for (const id of await sim.byType(1, 50, { timeoutMs: 3000 })) {
  const got = await sim.readStrings(["TITLE", "CATEGORY"], { object: id }).catch(() => null)
  lines.push(`${id}: ${got?.get?.("TITLE")} [${got?.get?.("CATEGORY")}]`)
}
rec.log("objects", `\n${lines.join("\n")}`, { lines })
sim.close()
process.exit(0)
