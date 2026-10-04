/*
 * p03: whether MSFS 2024 runs an aircraft's panel gauges on an AI copy of it,
 * which decides whether a floating panel of our own can carry an HTML gauge by
 * being an aircraft.
 *
 * p02 found that a StaticObject of our own with its own panel.cfg gets no
 * gauge: no page in the inspector, and the gauge never ran. Every gauge is a
 * page in the inspector on 127.0.0.1:19999, titled "VCockpitNN - <instrument>"
 * (experiments/tools/inspector.mjs), so a second copy of an aircraft whose
 * gauges run adds a second set of those pages.
 *
 * It lists the pages, spawns the pilot's own aircraft (its TITLE) as an AI
 * object 40m ahead of it, lists them again after 8s, and removes it. Nothing
 * to do but watch; the copy shows for about 10s.
 *
 *   node experiments/areas/interface/p03-ai-gauges.mjs
 *
 * Output: experiments/areas/interface/results/p03-ai-gauges-<time>.txt with
 * the .ndjson beside it.
 */

import path from "node:path"
import { fileURLToPath } from "node:url"

import { InitPosition, PositionReferential } from "node-simconnect"

import { listPages } from "../../tools/inspector.mjs"
import { startShooter } from "../../tools/shot.mjs"
import { Recorder, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"

const RAD = Math.PI / 180
// --side puts the copy 15m ahead, turned 90° so its fuselage faces the pilot,
// and takes a screenshot, to see whether its tail-number painting shows.
const SIDE = process.argv.includes("--side")
const AHEAD_M = SIDE ? 15 : 40
const WAIT_MS = 8000

const HERE = path.dirname(fileURLToPath(import.meta.url))
const rec = new Recorder("p03-ai-gauges", { area: "interface" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p03-ai-gauges" })
rec.open()
const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); rec.log(kind, text, fields) }
const titles = async () => (await listPages()).map((p) => String(p.title ?? ""))

const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
note("aircraft", `TITLE ${JSON.stringify(title)}`)
const before = await titles()
const panels = (ts) => ts.filter((t) => /^VCockpit\d+/.test(t))
note("before", `${plural(before.length, "page")}, ${plural(panels(before).length, "panel page")}`, { titles: before })

const v = await sim.read([["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]])
const lat = v.get("PLANE LATITUDE"), lon = v.get("PLANE LONGITUDE")
// With --side, along the pilot's look rather than the nose: CameraGet's yaw in
// the SIMOBJECT referential, right positive (record/areas/avatars/log.md, p20).
let lookYaw = 0
if (SIDE) {
  const cam = await new Promise((resolve) => {
    sim.handle.once("cameraData", (r) => resolve(r.cameraData))
    sim.send("camera get SIMOBJECT", () => sim.handle.cameraGet(PositionReferential.SIMOBJECT))
    setTimeout(() => resolve(null), 1500)
  })
  lookYaw = cam ? cam.pbh.bank : 0
  note("look", `the pilot looks ${lookYaw.toFixed(0)}° right of the nose`)
}
const hdg = (v.get("PLANE HEADING DEGREES TRUE") + lookYaw + 360) % 360
const init = new InitPosition()
Object.assign(init, {
  latitude: lat + (AHEAD_M * Math.cos(hdg * RAD) / 6_371_000) / RAD,
  longitude: lon + (AHEAD_M * Math.sin(hdg * RAD) / (6_371_000 * Math.cos(lat * RAD))) / RAD,
  altitude: v.get("PLANE ALTITUDE"), pitch: 0, bank: 0, heading: SIDE ? (hdg + 90) % 360 : hdg, onGround: true, airspeed: 0,
})
const r = await sim.spawn(title, "", init)
if (r.id === undefined) {
  note("spawn", `not created: ${r.error}`)
} else {
  note("spawn", `object ${r.id}, ${AHEAD_M}m ahead`)
  // The sim's AI drove the copy backwards out of view (the pilot, 2026-10-04),
  // so it's released from the AI and frozen, as p02 holds its objects.
  sim.release(r.id)
  for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
  await sleep(WAIT_MS)
  const after = await titles()
  const added = after.filter((t) => !before.includes(t) || after.filter((x) => x === t).length > before.filter((x) => x === t).length)
  note("after", `${plural(after.length, "page")}, ${plural(panels(after).length, "panel page")}; added: ${added.length ? [...new Set(added)].map((t) => JSON.stringify(t)).join(", ") : "none"}`, { titles: after })
  if (SIDE) {
    const shooter = startShooter(path.join(HERE, "results", `p03-ai-gauges-${rec.when}`))
    const s = await shooter.shot("copy-side-on")
    note("shot", s.error ? `screenshot: ${s.error}` : `screenshot ${path.basename(s.file)}`)
    shooter.close()
  }
  // --hold <s> keeps the copy up that long before removing it, for a closer look.
  const holdS = Number(process.argv[process.argv.indexOf("--hold") + 1]) || 0
  if (process.argv.includes("--hold") && holdS > 0) { note("hold", `holding the copy for ${holdS}s`); await sleep(holdS * 1000) }
  sim.remove(r.id)
  await sleep(1000)
}

const text = [
  "p03 · Whether an AI copy of the pilot's aircraft runs its panel gauges, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  "",
  ...lines.map((l) => `  ${l}`),
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
sim.close()
await rec.close()
process.exit(0)
