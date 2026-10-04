/*
 * p15: how far, how fast, and how precisely pressing the pilot's camera keys
 * slides the cockpit eye to a seat, on MSFS 2024.
 *
 * Parked before its first run on 2026-10-04: the user parked moving a pilot's
 * camera for now, and each pilot moves to their seat themselves.
 *
 * SendInput of Shift with D or A slid the eye 330mm in 500ms with the sim's
 * window in front, and the pilot kept their camera (p14,
 * record/areas/aircraft/log.md). This drives the eye to three targets with a
 * feedback loop: for each axis off by more than 1cm, it presses the key for the
 * time the remaining distance needs at the speed it last measured, reads
 * SimConnect_CameraGet's SIMOBJECT position, and repeats, up to 20 presses a
 * target. A press of 300ms or more that moves its axis under 5mm marks a limit.
 *
 *   1  the right seat: the 58P's CoPilot view's eye, 0.236m right of the
 *      reference point, 0.811m up, 0.116m behind it (p04)
 *   2  the rear cabin, 0.25m left, 0.80m up, 1.75m behind the reference point,
 *      about the 58P's rear seats
 *   3  back to the eye it started from
 *
 * Keys, as the pilot's profile binds them in COCKPIT_GLOBAL_CAMERA_TRANSLATE and
 * the pilot uses them, with Shift: D right, A left, W forward, S back (read
 * 2026-10-04, p14's log entry); height goes through COCKPIT CAMERA HEIGHT
 * instead of Shift with E or Q. COCKPIT CAMERA SPEED goes to 100% for the run,
 * and it and the height go back to what they were; ChasePlane is turned off
 * through its API and back on. About 30s, hands off, with the sim's window in front.
 *
 *   node experiments/areas/aircraft/p15-seat-slide.mjs
 *
 * Output: the steps on the console, and in
 * experiments/areas/aircraft/results/p15-seat-slide-<time>.txt with the .ndjson beside it.
 */

import { startBeeper } from "../../tools/guide.mjs"
import { startKeySender } from "../../tools/sendkeys.mjs"
import { connectChasePlane } from "./lib/chaseplane.mjs"
import { Recorder, sleep } from "./lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "./lib/sim.mjs"
import { PositionReferential } from "node-simconnect"

const CLIENT = "CROSSCHECK p15-seat-slide"
const SHIFT = 0xa0
// Height goes through COCKPIT CAMERA HEIGHT, which raised the eye 90mm from 50%
// to 80% with the camera free (p12), rather than Shift with E or Q: the default
// profile binds Shift+E to the aircraft's exits.
const AXES = {
  x: { plus: 0x44, minus: 0x41, name: "right" }, // D, A
  z: { plus: 0x57, minus: 0x53, name: "forward" }, // W, S
}
const HEIGHT_M_PER_PERCENT = 0.003
const ALL_KEYS = [SHIFT, 0x44, 0x41, 0x57, 0x53]
const TOLERANCE = 0.01
const MAX_PRESSES = 20

const rec = new Recorder("p15-seat-slide", { area: "aircraft" })
const sim = await Sim.connect(rec, { name: CLIENT })
rec.open()
const h = sim.handle
const beep = startBeeper()
const keys = startKeySender()
const lines = []
const note = (kind, text, data) => { rec.log(kind, text, data); lines.push(text) }

let waiting = null
h.on("cameraData", (r) => { if (waiting) { const w = waiting; waiting = null; w(r.cameraData) } })
async function eye() {
  const got = new Promise((resolve) => { waiting = resolve; setTimeout(() => { if (waiting === resolve) { waiting = null; resolve(null) } }, 1500) })
  sim.send("camera get SIMOBJECT", () => h.cameraGet(PositionReferential.SIMOBJECT))
  const c = await got
  return c ? { x: -c.position.x, y: c.position.y, z: c.position.z } : null // SIMOBJECT x points left
}
const show = (e) => (e ? `x ${e.x.toFixed(3)}, y ${e.y.toFixed(3)}, z ${e.z.toFixed(3)}m` : "no reply")
const status = async () => {
  const s = await new Promise((resolve) => { h.once("cameraStatus", (x) => resolve(x.acquiredState)); sim.send("camera get status", () => h.cameraGetStatus()); setTimeout(() => resolve(null), 1500) })
  return ({ 0: "NOT_ACQUIRED", 1: "ACQUIRED", 2: "ACQUIRED_BY_OTHER", 3: "USER_DISABLED" })[s] ?? "no reply"
}

let cp = null
let cpTurnedOff = false
let speedWas = null
let heightWas = null
let cleaned = false
async function cleanUp(why) {
  if (cleaned) return
  cleaned = true
  rec.log("stop", why)
  try { rec.log("stop", await keys.releaseAll(ALL_KEYS)) } catch { /* gone */ }
  if (speedWas !== null) sim.write("COCKPIT CAMERA SPEED", "percent", speedWas)
  if (heightWas !== null) sim.write("COCKPIT CAMERA HEIGHT", "percent", heightWas)
  if (cpTurnedOff) { try { await cp.setMasterEnabled(true); note("chaseplane", "Turned ChasePlane back on") } catch (e) { note("chaseplane", `Turning ChasePlane back on failed: ${e.message}`) } }
  cp?.close()
  keys.close()
}
process.on("SIGINT", async () => { await cleanUp("Ctrl+C: releasing every key"); sim.close(); await rec.close(); process.exit(1) })

const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
note("aircraft", `TITLE ${JSON.stringify(title)}`)
try {
  cp = await connectChasePlane(CLIENT, { rec })
  await sleep(500)
  if (cp.state.masterEnabled) { await cp.setMasterEnabled(false); cpTurnedOff = true; await sleep(1500); note("chaseplane", "Turned ChasePlane off through its API") }
} catch (e) { note("chaseplane", `ChasePlane: ${e.message}`) }
speedWas = (await sim.read([["COCKPIT CAMERA SPEED", "percent"]])).get("COCKPIT CAMERA SPEED")
heightWas = (await sim.read([["COCKPIT CAMERA HEIGHT", "percent"]])).get("COCKPIT CAMERA HEIGHT")
sim.write("COCKPIT CAMERA SPEED", "percent", 100)
note("speed", `COCKPIT CAMERA SPEED was ${speedWas}%; set to 100% for the run`)

let front = await keys.front()
if (!front.startsWith("OK")) front = await keys.focus()
if (!front.startsWith("OK")) {
  console.log("Click into the sim window; the keys go out once it's in front (up to 20s).")
  for (let i = 0; i < 40 && !front.startsWith("OK"); i++) { await sleep(500); front = await keys.front() }
}
note("focus", `The sim window: ${front}`)
if (!front.startsWith("OK")) { await cleanUp("the sim never came to the front"); sim.close(); await rec.close(); process.exit(2) }
beep(1000, 150)
await sleep(500)

const start = await eye()
if (!start) throw new Error("CameraGet gave no reply; is the pilot in the cockpit?")
note("eye", `Start: ${show(start)}; camera ${await status()}`)

// Meters a second per axis and direction, first guessed from p14 (330mm in 500ms at the default speed), then measured.
const rate = {}
for (const a of Object.keys(AXES)) rate[`${a}+`] = rate[`${a}-`] = 0.66

async function slideTo(label, target) {
  const t0 = Date.now()
  let e = await eye()
  let presses = 0
  const limits = new Set()
  while (presses < MAX_PRESSES) {
    const off = Object.keys(AXES).map((a) => ({ a, d: target[a] - e[a] })).filter((o) => Math.abs(o.d) > TOLERANCE && !limits.has(o.a))
    if (!off.length) break
    off.sort((p, q) => Math.abs(q.d) - Math.abs(p.d))
    const { a, d } = off[0]
    const dir = d > 0 ? "+" : "-"
    const ms = Math.min(4000, Math.max(30, (Math.abs(d) / rate[`${a}${dir}`]) * 1000))
    const r = await keys.press([SHIFT, d > 0 ? AXES[a].plus : AXES[a].minus], ms)
    presses++
    if (!r.startsWith("OK")) { note("slide", `${label}: press ${presses} ${r}`); break }
    await sleep(250)
    const n = await eye()
    const moved = (n[a] - e[a]) * (d > 0 ? 1 : -1)
    rec.data("press", `${label}: ${a}${dir} for ${ms.toFixed(0)}ms moved ${(moved * 1000).toFixed(0)}mm`, { a, dir, ms, moved })
    if (ms >= 300 && moved < 0.005) { limits.add(a); note("slide", `${label}: ${AXES[a].name} stopped moving at ${show(n)}: a limit`) }
    else if (ms >= 60 && moved > 0.002) rate[`${a}${dir}`] = moved / (ms / 1000)
    e = n
  }
  const height = (await sim.read([["COCKPIT CAMERA HEIGHT", "percent"]])).get("COCKPIT CAMERA HEIGHT")
  const want = Math.min(100, Math.max(0, height + (target.y - e.y) / HEIGHT_M_PER_PERCENT))
  if (Math.abs(target.y - e.y) > TOLERANCE) { sim.write("COCKPIT CAMERA HEIGHT", "percent", want); await sleep(600); e = await eye() }
  const err = Math.hypot(...["x", "y", "z"].map((a) => target[a] - e[a]))
  note("slide", `${label}: ${presses} presses, ${((Date.now() - t0) / 1000).toFixed(1)}s, ended at ${show(e)}, ${(err * 1000).toFixed(0)}mm from the target; camera ${await status()}`, { label, target, end: e, err, presses })
  return e
}

await slideTo("1, the right seat", { x: 0.236, y: 0.811, z: -0.116 })
await slideTo("2, the rear cabin", { x: -0.25, y: 0.8, z: -1.75 })
await slideTo("3, back to the start", start)
note("speed", `Measured at 100%: ${Object.entries(rate).map(([k, v]) => `${k} ${v.toFixed(2)}m/s`).join(", ")}`)

await cleanUp("done: releasing every key, the speed back, ChasePlane back on")
const text = [
  "p15 · Sliding the cockpit eye to seats by pressing the pilot's camera keys, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  "",
  ...lines,
  "",
  `Exceptions: ${rec.timeline.filter((e) => e.kind === "exception").map((e) => e.text).join("; ") || "none"}`,
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
sim.close()
await rec.close()
process.exit(0)
