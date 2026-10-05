/*
 * p28: whether one sim draws many of our figures, each posed from variables of
 * its own object, and what 2, 20, and 180 of them cost in frame time with
 * every joint moving every frame. The plan's step 6 probe on figures
 * (record/areas/product/plan.md; record/areas/product/04-room-for-later.md,
 * "People beyond the crew").
 *
 *   node experiments/areas/avatars/p28-many-figures.mjs
 *
 * Needs crosscheck-p28-figures in Community (many/build.mjs, with the sim
 * closed), and the sim's window in front, because a sim in the background
 * renders fewer frames.
 *
 * In any aircraft, parked, looking forward from the cockpit:
 *   1. the frame rate with no figures;
 *   2. for 2, 20, and 180 figures, spawned on a grid 10m to 40m ahead of the
 *      aircraft and frozen there: the frame rate with the module moving every
 *      joint every frame, then writing every joint without moving it, then
 *      writing nothing;
 *   3. the pilot says whether the figures stand in poses of their own (Page
 *      Down) or all in one pose (Page Up), which is whether the joints follow
 *      each object's own variables;
 *   4. the size of the sim's L: name table before and after, through
 *      fsc-editor-link, which says whether Z: variables add to it.
 * Every figure is removed at the end.
 */

import { InitPosition } from "node-simconnect"

import { Link } from "../aircraft/lib/link.mjs"
import { Recorder, plural, repoRelative, sleep } from "../aircraft/lib/out.mjs"
import { Sim } from "../aircraft/lib/sim.mjs"
import { startBeeper, startKeys, startSpeaker } from "../../tools/guide.mjs"

const TITLE = "CROSSCHECK_FigureZ"
const COUNTS = [2, 20, 180]
const MEASURE_MS = 10_000
const SPACING_M = 1.5
const PER_ROW = 20
const FIRST_ROW_M = 10

const rec = new Recorder("p28-many-figures", { area: "avatars" })
const POSE = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"], ["PLANE PITCH DEGREES", "degrees"], ["PLANE BANK DEGREES", "degrees"]]

// Meters forward and right of the aircraft, turned by its heading, on a flat
// earth, which is close enough over 50m.
function offset(ac, fwd, right) {
  const h = (ac.hdg * Math.PI) / 180
  const north = fwd * Math.cos(h) - right * Math.sin(h)
  const east = fwd * Math.sin(h) + right * Math.cos(h)
  return {
    lat: ac.lat + north / 111_320,
    lon: ac.lon + east / (111_320 * Math.cos((ac.lat * Math.PI) / 180)),
  }
}

async function main() {
  rec.open()
  const keys = await startKeys()
  const beep = startBeeper()
  const say = startSpeaker({ rate: 4 })
  const sim = await Sim.connect(rec, { name: "CROSSCHECK p28 many figures" })
  sim.track()
  const link = new Link(sim)
  let lCount = null
  const stream = link.stream({ onHello: (h) => { lCount = h.count } })
  await sleep(3000)

  beep(880, 150)
  say("In any aircraft, parked, look forward from the cockpit, and press Page Down.")
  rec.log("prompt", "In any aircraft, parked, look forward from the cockpit and keep the sim in front. Page Down to start.")
  await keys.next()
  say("Hands off. Measuring.")
  const before = lCount
  rec.log("lnames", `the L: table holds ${before ?? "an unknown number of"} names`)

  const p = await sim.read(POSE)
  const ac = { lat: p.get("PLANE LATITUDE"), lon: p.get("PLANE LONGITUDE"), alt: p.get("PLANE ALTITUDE"), hdg: p.get("PLANE HEADING DEGREES TRUE") }
  const fps = async (label) => {
    const r = await sim.frameRate(MEASURE_MS)
    const alive = await link.getL("CROSSCHECK_P28_ALIVE")
    const writes = await link.getL("CROSSCHECK_P28_WRITES")
    const errors = await link.getL("CROSSCHECK_P28_ERRORS")
    rec.log("fps", `${label}: ${r.fps === null ? "no" : r.fps.toFixed(1)} fps; the module wrote ${writes ?? "?"} Z: values in its last frame, ${errors ?? "?"} errors so far`, { label, ...r, alive, writes, errors })
    return { label, fps: r.fps, writes, errors }
  }

  const results = []
  results.push(await fps("no figures"))
  if ((await link.getL("CROSSCHECK_P28_ALIVE")) === null) rec.log("warn", "CROSSCHECK_P28_ALIVE didn't read; is crosscheck-p28-figures in Community?")

  const ids = []
  let poses = null
  for (const n of COUNTS) {
    while (ids.length < n) {
      const i = ids.length
      const at = offset(ac, FIRST_ROW_M + Math.floor(i / PER_ROW) * SPACING_M * 2, ((i % PER_ROW) - (PER_ROW - 1) / 2) * SPACING_M)
      const init = new InitPosition()
      Object.assign(init, { latitude: at.lat, longitude: at.lon, altitude: ac.alt, pitch: 0, bank: 0, heading: (ac.hdg + 180) % 360, onGround: true, airspeed: 0 })
      const r = await sim.spawn(TITLE, "", init)
      if (r.id === undefined) { rec.log("warn", `figure ${i + 1} not created: ${r.error}`); break }
      sim.release(r.id)
      for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
      await link.setL(`CROSSCHECK_P28_ID_${i}`, r.id)
      ids.push(r.id)
    }
    await link.setL("CROSSCHECK_P28_N", ids.length)
    rec.log("figures", `${plural(ids.length, "figure")} out`)
    for (const [mode, label] of [[1, "moving"], [2, "written, still"], [0, "not written"]]) {
      await link.setL("CROSSCHECK_P28_MODE", mode)
      await sleep(2000)
      results.push({ n: ids.length, ...(await fps(`${ids.length} figures, ${label}`)) })
    }
    if (poses === null && ids.length >= 20) {
      await link.setL("CROSSCHECK_P28_MODE", 2)
      beep(880, 150)
      say("Do the figures stand in poses of their own? Page Down for yes, Page Up for one pose.")
      rec.log("prompt", "Do the figures ahead stand in poses of their own, in colors of their own? Page Down for yes, Page Up if they all share one pose.")
      const k = await keys.next()
      poses = k.key === "START"
      rec.log("poses", poses ? "the pilot saw poses of their own" : "the pilot saw one pose for all")
      say("Hands off. Measuring.")
    }
  }

  // The module counts the names it walked: rescan appends any registered since,
  // and a fresh start reports the new count (fsc-editor, link/src/module.cpp).
  await stream.rescan()
  await sleep(2000)
  await stream.stop()
  const s2 = link.stream({ onHello: (h) => { lCount = h.count } })
  await sleep(3000)
  rec.log("lnames", `with ${plural(ids.length, "figure")} out, the L: table holds ${lCount ?? "?"} names, against ${before ?? "?"} before`)
  await s2.stop()

  await link.setL("CROSSCHECK_P28_MODE", 0)
  await link.setL("CROSSCHECK_P28_N", 0)
  for (const id of ids) sim.remove(id)
  await sleep(1000)
  beep(660, 400)
  say("Done.")

  const lines = [`p28-many-figures, started ${new Date(rec.started).toISOString()}`, ""]
  for (const r of results) lines.push(`${r.label}: ${r.fps === null ? "no" : r.fps.toFixed(1)} fps${r.writes !== undefined && r.writes !== null ? `, ${r.writes} Z: writes in the module's last frame` : ""}${r.errors ? `, ${r.errors} errors` : ""}`)
  lines.push("", `Poses of their own: ${poses === null ? "not asked" : poses ? "yes" : "no, one pose for all"}`)
  lines.push(`L: table: ${before ?? "?"} names before, ${lCount ?? "?"} after`)
  const text = lines.join("\n")
  rec.writeReport(text)
  console.log("\n" + text)
  console.log(`saved ${repoRelative(rec.files.txt)}`)
  link.stop()
  sim.close()
  await rec.close()
  process.exit(0)
}

main().catch(async (e) => {
  rec.log("error", e.stack ?? String(e))
  await rec.close()
  process.exit(1)
})
