/*
 * p28: whether one sim draws many of our figures, each posed from variables of
 * its own object, and what 2, 20, and 180 of them cost in frame time with
 * every joint moving every frame. The plan's step 6 probe on figures
 * (record/areas/product/plan.md; record/areas/product/04-room-for-later.md,
 * "People beyond the crew").
 *
 *   node experiments/areas/avatars/p28-many-figures.mjs
 *   node experiments/areas/avatars/p28-many-figures.mjs --counts 200,400,600,800
 *   node experiments/areas/avatars/p28-many-figures.mjs --counts 400,800 --no-ask --note "camera turned around"
 *
 * Ctrl+C takes the figures out and writes the report with every measurement
 * finished so far.
 *
 * Needs crosscheck-p28-figures in Community (many/build.mjs, with the sim
 * closed), and the sim's window in front, because a sim in the background
 * renders fewer frames.
 *
 * In any aircraft, parked, looking forward from the cockpit:
 *   1. the frame rate with no figures;
 *   2. for 2, 20, and 180 figures, or the counts --counts gives, spawned on a
 *      grid from 10m ahead of the aircraft and frozen there: the frame rate
 *      with the module moving every
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
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null }
// The module poses at most 1,000 (many/src/figures.cpp, MAX_FIGURES).
const COUNTS = (arg("--counts") ?? "2,20,180").split(",").map(Number)
// --no-ask skips the poses question, for a run with the camera turned away.
const ASK = !process.argv.includes("--no-ask")
const NOTE = arg("--note")
const MEASURE_MS = 10_000
const SPACING_M = 1.5
const PER_ROW = 40
// Meters from the aircraft's reference point to the first row; --ahead moves
// it past a long aircraft's nose.
const FIRST_ROW_M = Number(arg("--ahead") ?? 10)

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

// One run's state, kept here so that Ctrl+C can still take the figures out and
// write the report.
const run = { sim: null, link: null, results: [], ids: [], poses: null, before: null, lCount: null, stopping: false, finished: false }

async function main() {
  rec.open()
  process.on("SIGINT", () => { run.stopping = true; finish("interrupted").catch(() => process.exit(1)) })
  const keys = await startKeys()
  const beep = startBeeper()
  const say = startSpeaker()
  const sim = run.sim = await Sim.connect(rec, { name: "CROSSCHECK p28 many figures" })
  sim.track()
  const link = run.link = new Link(sim)
  const stream = link.stream({ onHello: (h) => { run.lCount = h.count } })
  await sleep(3000)

  beep(880, 150)
  say(NOTE ? `Setup: ${NOTE}. Keep the sim in front, and press Page Down.` : "In any aircraft, parked, look forward from the cockpit, and press Page Down.")
  rec.log("prompt", NOTE ? `Setup: ${NOTE}. Keep the sim in front. Page Down to start.` : "In any aircraft, parked, look forward from the cockpit and keep the sim in front. Page Down to start.")
  await keys.next()
  say("Hands off. Measuring.")
  run.before = run.lCount
  rec.log("lnames", `the L: table holds ${run.before ?? "an unknown number of"} names`)

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

  const { results, ids } = run
  results.push(await fps("no figures"))
  if ((await link.getL("CROSSCHECK_P28_ALIVE")) === null) rec.log("warn", "CROSSCHECK_P28_ALIVE didn't read; is crosscheck-p28-figures in Community?")

  for (const n of COUNTS) {
    if (run.stopping) return
    while (ids.length < n && !run.stopping) {
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
    if (run.stopping) return
    await link.setL("CROSSCHECK_P28_N", ids.length)
    rec.log("figures", `${plural(ids.length, "figure")} out`)
    for (const [mode, label] of [[1, "moving"], [2, "written, still"], [0, "not written"]]) {
      if (run.stopping) return
      await link.setL("CROSSCHECK_P28_MODE", mode)
      await sleep(2000)
      const r = await fps(`${ids.length} figures, ${label}`)
      if (!run.stopping) results.push({ n: ids.length, ...r })
    }
    if (ASK && run.poses === null && ids.length >= 20) {
      await link.setL("CROSSCHECK_P28_MODE", 2)
      beep(880, 150)
      say("Do the figures stand in poses of their own? Page Down for yes, Page Up for one pose.")
      rec.log("prompt", "Do the figures ahead stand in poses of their own, in colors of their own? Page Down for yes, Page Up if they all share one pose.")
      const k = await keys.next()
      run.poses = k.key === "START"
      rec.log("poses", run.poses ? "the pilot saw poses of their own" : "the pilot saw one pose for all")
      say("Hands off. Measuring.")
    }
  }

  // The module counts the names it walked: rescan appends any registered since,
  // and a fresh start reports the new count (fsc-editor, link/src/module.cpp).
  await stream.rescan()
  await sleep(2000)
  await stream.stop()
  const s2 = link.stream({ onHello: (h) => { run.lCount = h.count } })
  await sleep(3000)
  rec.log("lnames", `with ${plural(ids.length, "figure")} out, the L: table holds ${run.lCount ?? "?"} names, against ${run.before ?? "?"} before`)
  await s2.stop()
  beep(660, 400)
  say("Done.")
  await finish("every count done")
}

// Takes every figure out and writes the report, whether the run finished or
// was stopped with Ctrl+C; a measurement cut short isn't reported.
async function finish(why) {
  if (run.finished) return
  run.finished = true
  rec.log("stop", why)
  const { sim, link, ids } = run
  if (link) {
    try { await link.setL("CROSSCHECK_P28_MODE", 0); await link.setL("CROSSCHECK_P28_N", 0) } catch { /* the sim may be gone */ }
  }
  // A spawn under way when Ctrl+C came can still add its figure.
  await sleep(500)
  if (sim) for (const id of ids) sim.remove(id)
  await sleep(1000)
  if (ids.length) rec.log("figures", `${plural(ids.length, "figure")} removed`)

  const lines = [`p28-many-figures, started ${new Date(rec.started).toISOString()}${why === "interrupted" ? ", stopped with Ctrl+C" : ""}`]
  if (NOTE) lines.push(`Setup: ${NOTE}`)
  lines.push("")
  for (const r of run.results) lines.push(`${r.label}: ${r.fps === null ? "no" : r.fps.toFixed(1)} fps${r.writes !== undefined && r.writes !== null ? `, ${r.writes} Z: writes in the module's last frame` : ""}${r.errors ? `, ${r.errors} errors` : ""}`)
  lines.push("", `Poses of their own: ${run.poses === null ? "not asked" : run.poses ? "yes" : "no, one pose for all"}`)
  lines.push(`L: table: ${run.before ?? "?"} names before, ${run.lCount ?? "?"} after`)
  const text = lines.join("\n")
  rec.writeReport(text)
  console.log("\n" + text)
  console.log(`saved ${repoRelative(rec.files.txt)}`)
  try { link?.stop() } catch { /* closing anyway */ }
  try { sim?.close() } catch { /* already closed */ }
  await rec.close()
  process.exit(0)
}

main().catch(async (e) => {
  rec.log("error", e.stack ?? String(e))
  await finish("failed")
})
