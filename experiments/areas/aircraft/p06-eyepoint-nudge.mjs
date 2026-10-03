/*
 * p06: whether the sim's eyepoint key events move the pilot's cockpit eye in
 * MSFS 2024, by how much each, and how far, so Crosscheck could hand the camera
 * back into the aircraft's nearest view and nudge the eye to a seat the
 * profile defines (p04 showed the hand-back, record/areas/aircraft/log.md).
 *
 * For each of K:EYEPOINT_RIGHT, _BACK, _LEFT, _FORWARD, _UP, and _DOWN, it sends
 * bursts of 10 events 30ms apart and reads SimConnect_CameraGet's SIMOBJECT
 * position after each burst, in meters with x pointing left (measured,
 * record/areas/avatars/log.md). A direction stops when a burst moves the eye
 * less than 2mm, which marks a limit, or when the eye has traveled the
 * distance the direction is asked for: 0.6m right, about the copilot's seat,
 * 2.2m back, about the 58P's rear seats, and 0.3m in the others. Then it holds
 * 2s to see whether the eye stays, and sends K:EYEPOINT_RESET.
 *
 * Unattended, about 40s, seated in the cockpit with ChasePlane disabled; the
 * view slides around the cockpit. On the way out, and on Ctrl+C, it puts the
 * eye back where it started, by K:EYEPOINT_RESET or else by releasing the
 * camera into the aircraft's Pilot view.
 *
 *   node experiments/areas/aircraft/p06-eyepoint-nudge.mjs
 *
 * Output: the steps on the console, and in
 * experiments/areas/aircraft/results/p06-eyepoint-nudge-<time>.txt with the
 * .ndjson beside it.
 */

import { Recorder, sleep } from "./lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "./lib/sim.mjs"
import { PositionReferential } from "node-simconnect"

const CLIENT = "CROSSCHECK p06-eyepoint-nudge"
const BURST = 10
const GAP_MS = 30
const READ_MS = 300
const MAX_BURSTS = 30
// How far each direction is asked to travel, and which way it moves the eye in
// CameraGet's SIMOBJECT frame (x left, y up, z forward).
const DIRECTIONS = [
  { name: "RIGHT", axis: "x", sign: -1, travel: 0.6 },
  { name: "BACK", axis: "z", sign: -1, travel: 2.2 },
  { name: "LEFT", axis: "x", sign: 1, travel: 0.3 },
  { name: "FORWARD", axis: "z", sign: 1, travel: 0.3 },
  { name: "UP", axis: "y", sign: 1, travel: 0.3 },
  { name: "DOWN", axis: "y", sign: -1, travel: 0.3 },
]

const rec = new Recorder("p06-eyepoint-nudge", { area: "aircraft" })
const sim = await Sim.connect(rec, { name: CLIENT })
rec.open()
const h = sim.handle
const lines = []
const note = (kind, text, data) => { rec.log(kind, text, data); lines.push(text) }

let waiting = null
h.on("cameraData", (r) => { if (waiting) { const w = waiting; waiting = null; w(r.cameraData) } })
async function eye() {
  const got = new Promise((resolve) => { waiting = resolve; setTimeout(() => { if (waiting === resolve) { waiting = null; resolve(null) } }, 1500) })
  sim.send("camera get SIMOBJECT", () => h.cameraGet(PositionReferential.SIMOBJECT))
  const c = await got
  return c ? { x: c.position.x, y: c.position.y, z: c.position.z } : null
}
const show = (e) => (e ? `x ${e.x.toFixed(3)}m, y ${e.y.toFixed(3)}m, z ${e.z.toFixed(3)}m` : "no reply")
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

let start = null
let cleaned = false
async function putBack(why) {
  if (cleaned) return
  cleaned = true
  rec.log("stop", why)
  try {
    sim.transmit("EYEPOINT_RESET", [], { quiet: true })
    await sleep(800)
    const now = await eye()
    if (start && now && dist(now, start) > 0.01) {
      rec.log("stop", `K:EYEPOINT_RESET left the eye ${dist(now, start).toFixed(3)}m from the start; releasing the camera into Pilot`)
      sim.send("camera acquire", () => h.cameraAcquire(CLIENT))
      await sleep(300)
      sim.send("camera release into Pilot", () => h.cameraRelease("Pilot"))
      await sleep(800)
    }
  } catch (e) {
    rec.log("stop", `putting the eye back failed: ${e.message}`)
  }
}
process.on("SIGINT", async () => {
  await putBack("Ctrl+C: putting the eye back")
  sim.close()
  await rec.close()
  process.exit(1)
})

const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
note("aircraft", `TITLE ${JSON.stringify(title)}`)
// SimConnect.h, SIMCONNECT_CAMERA_ACQUIRED_STATE: 2 is ACQUIRED_BY_OTHER, which
// ChasePlane holds while it runs (p04).
const holder = await new Promise((resolve) => {
  h.once("cameraStatus", (s) => resolve(s.acquiredState))
  sim.send("camera get status", () => h.cameraGetStatus())
  setTimeout(() => resolve(null), 1500)
})
if (holder === 2) {
  console.log("Another client holds the camera; disable ChasePlane in its settings and run again.")
  sim.close()
  await rec.close()
  process.exit(2)
}
start = await eye()
if (!start) throw new Error("CameraGet gave no reply; is the pilot in the cockpit?")
note("eye", `Start: ${show(start)}`, { eye: start })

const summary = []
for (const d of DIRECTIONS) {
  const from = await eye()
  let last = from
  let sent = 0
  let stopped = "asked travel reached"
  const steps = []
  for (let b = 0; b < MAX_BURSTS; b++) {
    for (let i = 0; i < BURST; i++) { sim.transmit(`EYEPOINT_${d.name}`, [], { quiet: true }); sent++; await sleep(GAP_MS) }
    await sleep(READ_MS)
    const now = await eye()
    if (!now) { stopped = "CameraGet gave no reply"; break }
    const moved = dist(now, last)
    steps.push(moved / BURST)
    rec.log("burst", `EYEPOINT_${d.name} ×${sent}: ${show(now)}, moved ${(moved * 1000).toFixed(1)}mm this burst`, { direction: d.name, sent, eye: now, moved })
    last = now
    if (moved < 0.002) { stopped = sent === BURST ? "didn't move" : "stopped moving: a limit"; break }
    if (d.sign * (now[d.axis] - from[d.axis]) >= d.travel) break
  }
  await sleep(2000)
  const held = await eye()
  const along = d.sign * (last[d.axis] - from[d.axis])
  const off = Math.hypot(...["x", "y", "z"].filter((a) => a !== d.axis).map((a) => last[a] - from[a]))
  const step = steps.length ? steps[0] : 0
  const line = `EYEPOINT_${d.name}: ${sent} events, ${(along).toFixed(3)}m along ${d.axis} the expected way, ${(off * 1000).toFixed(0)}mm off the axis, first burst ${(step * 1000).toFixed(1)}mm an event; ${stopped}; 2s later ${held && dist(held, last) < 0.002 ? "still there" : `moved to ${show(held)}`}`
  note("direction", line, { direction: d.name, sent, along, off, step, stopped, last, held })
  summary.push(line)
  sim.transmit("EYEPOINT_RESET", [], { quiet: true })
  await sleep(800)
  const back = await eye()
  note("reset", `  after K:EYEPOINT_RESET: ${show(back)}, ${back ? (dist(back, start) * 1000).toFixed(0) : "?"}mm from the start`, { eye: back })
}

await putBack("done: putting the eye back")
const end = await eye()
note("eye", `End: ${show(end)}, ${end ? (dist(end, start) * 1000).toFixed(0) : "?"}mm from the start`, { eye: end })

const exceptions = rec.timeline.filter((e) => e.kind === "exception").map((e) => e.text)
const text = [
  "p06 · Nudging the cockpit eye with the eyepoint key events, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  "",
  ...lines,
  "",
  `Exceptions: ${exceptions.join("; ") || "none"}`,
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
sim.close()
await rec.close()
process.exit(0)
