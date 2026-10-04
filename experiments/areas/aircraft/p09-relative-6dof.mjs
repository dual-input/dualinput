/*
 * p09: whether SimConnect_CameraSetRelative6DOF puts the pilot's cockpit eye at
 * any point relative to the aircraft's eyepoint, on MSFS 2024, without taking
 * the camera, so the pilot keeps their look, and Crosscheck can seat a pilot
 * where the aircraft has no camera view.
 *
 * The Camera API has no call to add a camera definition at runtime (read in
 * MSFS 2024 SDK 1.7.3, SimConnect.h and WASM/include/MSFS/MSFS_Camera.h), and
 * releasing the camera anywhere but into a definition snaps it back (p04,
 * record/areas/aircraft/log.md). SimConnect_CameraSetRelative6DOF moves the
 * user's camera relative to the eyepoint; SDK 1.6.9 fixed it, after it
 * "ignored position parameters and put camera at the center of the SimObject,
 * not the eyepoint" (MSFS 2024 SDK release notes). SimConnect.h defines
 * SIMCONNECT_CAMERA_IGNORE_FIELD, FLT_MAX, "Used to tell the Camera API to NOT
 * modify the value in this part of the argument", so each call here sets the
 * position and passes it for pitch, bank, and heading.
 *
 * Steps, each read 1.5s and 3.5s later with SimConnect_CameraGet's SIMOBJECT
 * position, in meters with x pointing left (measured, record/areas/avatars/log.md):
 *
 *   1  delta (0, 0, 0): where the eyepoint is
 *   2  delta (0.489, 0, 0): the 58P's copilot's view sits 0.489m right of its
 *      pilot's (p05), so this should be the right seat
 *   3  a hold in that seat, from a short high beep to a long low one, for the
 *      pilot to look around with the mouse
 *   4  delta (0.2, 0.1, -1.2): a point in the cabin no view gives
 *   5  back to the eye it started from, by the delta it had from the eyepoint
 *
 * About 35s, seated in the cockpit. With ChasePlane on, it turns ChasePlane off
 * through ChasePlane's API (lib/chaseplane.mjs, set_master_enabled) for the run,
 * and back on at the end and on Ctrl+C.
 *
 *   node experiments/areas/aircraft/p09-relative-6dof.mjs [--hold <s>]
 *
 * Output: the steps on the console, and in
 * experiments/areas/aircraft/results/p09-relative-6dof-<time>.txt with the
 * .ndjson beside it.
 */

import { startBeeper } from "../../tools/guide.mjs"
import { connectChasePlane } from "./lib/chaseplane.mjs"
import { Recorder, sleep } from "./lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "./lib/sim.mjs"
import { CameraData, CameraDataMask, PositionReferential } from "node-simconnect"

const IGNORE = 3.4028234663852886e38 // FLT_MAX, SIMCONNECT_CAMERA_IGNORE_FIELD
const ACQUIRED = { 0: "NOT_ACQUIRED", 1: "ACQUIRED", 2: "ACQUIRED_BY_OTHER", 3: "USER_DISABLED" }
const CLIENT = "CROSSCHECK p09-relative-6dof"
const holdAt = process.argv.indexOf("--hold")
const HOLD_S = holdAt > 0 ? Number(process.argv[holdAt + 1]) || 10 : 10

const rec = new Recorder("p09-relative-6dof", { area: "aircraft" })
const sim = await Sim.connect(rec, { name: CLIENT })
rec.open()
const beep = startBeeper()
const h = sim.handle
const lines = []
const note = (kind, text, data) => { rec.log(kind, text, data); lines.push(text) }

let waiting = null
h.on("cameraData", (r) => { if (waiting) { const w = waiting; waiting = null; w(r.cameraData) } })
async function eye() {
  const got = new Promise((resolve) => { waiting = resolve; setTimeout(() => { if (waiting === resolve) { waiting = null; resolve(null) } }, 1500) })
  sim.send("camera get SIMOBJECT", () => h.cameraGet(PositionReferential.SIMOBJECT))
  const c = await got
  // x turned to point right; CameraGet's Bank field carries the yaw (measured, record/areas/avatars/log.md).
  return c ? { x: -c.position.x, y: c.position.y, z: c.position.z, pitch: c.pbh.pitch, yaw: c.pbh.bank } : null
}
const show = (e) => (e ? `x ${e.x.toFixed(3)}m (right +), y ${e.y.toFixed(3)}m, z ${e.z.toFixed(3)}m, pitch ${e.pitch.toFixed(0)}°, yaw ${e.yaw.toFixed(0)}°` : "no reply")
async function status() {
  const s = await new Promise((resolve) => { h.once("cameraStatus", (x) => resolve(x.acquiredState)); sim.send("camera get status", () => h.cameraGetStatus()); setTimeout(() => resolve(null), 1500) })
  return ACQUIRED[s] ?? `no reply`
}
function move(label, d) {
  sim.send(`camera set relative 6DOF ${label}`, () => h.cameraSetRelative6DOF(d[0], d[1], d[2], IGNORE, IGNORE, IGNORE))
}
async function step(label, d) {
  move(label, d)
  await sleep(1500)
  const a = await eye()
  await sleep(2000)
  const b = await eye()
  const held = a && b && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.003
  note("eye", `${label}, delta (${d.join(", ")}): ${show(a)}; 2s later ${held ? "held" : show(b)}`, { label, delta: d, a, b })
  return a
}

let restore = null
let cp = null
let cpTurnedOff = false
let cleaned = false
async function putBack(why) {
  if (cleaned) return
  cleaned = true
  rec.log("stop", why)
  try {
    if (restore) { move("back to the starting eye", restore); await sleep(1500) }
  } catch (e) { rec.log("stop", `putting the eye back failed: ${e.message}`) }
  if (cpTurnedOff) {
    try { await cp.setMasterEnabled(true); cpTurnedOff = false; await sleep(1000); note("chaseplane", `Turned ChasePlane back on; camera ${await status()}`) } catch (e) { note("chaseplane", `Turning ChasePlane back on failed: ${e.message}; turn it on in its panel`) }
  }
  cp?.close()
}
process.on("SIGINT", async () => {
  await putBack("Ctrl+C: putting the eye back")
  sim.close()
  await rec.close()
  process.exit(1)
})

const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
const before = await status()
note("aircraft", `TITLE ${JSON.stringify(title)}; camera ${before}`)
try {
  cp = await connectChasePlane(CLIENT, { rec })
  await sleep(500)
  if (cp.state.masterEnabled || before === "ACQUIRED_BY_OTHER") {
    await cp.setMasterEnabled(false)
    cpTurnedOff = true
    await sleep(1500)
    note("chaseplane", `Turned ChasePlane ${cp.state.version} off through its API; camera ${await status()}`)
  }
} catch (e) {
  note("chaseplane", `ChasePlane: ${e.message}`)
}
const start = await eye()
if (!start) throw new Error("CameraGet gave no reply; is the pilot in the cockpit?")
note("eye", `Start: ${show(start)}`, { eye: start })

// --handback2 mustn't call CameraSetRelative6DOF before taking the camera, since
// that gives the camera to a holder our client can't take it from (p09
// --handback), so it uses the 58P's eyepoint as p09's first run measured it.
const EYEPOINT_58P = { x: -0.259, y: 0.61, z: -0.107, pitch: 0, yaw: 0 }
const origin = process.argv.includes("--handback2") ? EYEPOINT_58P : await step("1, the eyepoint", [0, 0, 0])
if (origin) restore = [start.x - origin.x, start.y - origin.y, start.z - origin.z].map((v) => +v.toFixed(4))

// --handback2: our own client takes the camera first, moves the eye while it
// holds it, by SimConnect_CameraSet (V1) or CameraSetRelative6DOF (V2), and
// releases it into Pilot, since our own release worked every time in p04 and
// --handback's didn't, after CameraSetRelative6DOF took the camera itself.
if (process.argv.includes("--handback2") && origin && restore) {
  const seat = [+(restore[0] + 0.489).toFixed(4), restore[1], restore[2]]
  const target = { x: origin.x + seat[0], y: origin.y + seat[1], z: origin.z + seat[2] }
  const offBy = (e) => (e ? Math.hypot(e.x - target.x, e.y - target.y, e.z - target.z) : null)
  const variant = async (label, moveIt) => {
    sim.send("camera acquire", () => h.cameraAcquire(CLIENT))
    await sleep(300)
    const held = await status()
    moveIt()
    await sleep(1200)
    const moved = await eye()
    sim.send("camera release into Pilot", () => h.cameraRelease("Pilot"))
    await sleep(1500)
    const after = await eye()
    const st = await status()
    note("eye", `${label}: after the acquire ${held}; moved to ${show(moved)} (${(offBy(moved) * 1000).toFixed(0)}mm from the right-seat point); released into Pilot: ${show(after)} (${(offBy(after) * 1000).toFixed(0)}mm); camera ${st}`, { label, held, moved, after, st })
    return offBy(after) !== null && offBy(after) < 0.02 && st === "NOT_ACQUIRED"
  }
  const v1 = await variant("V1, CameraSet while holding", () => {
    const d = new CameraData()
    d.position.x = -target.x // CameraGet's and CameraSet's SIMOBJECT x points left
    d.position.y = target.y
    d.position.z = target.z
    d.positionReferential = PositionReferential.SIMOBJECT
    sim.send("camera set to the right seat", () => h.cameraSet(d, CameraDataMask.POSITION | CameraDataMask.REFERENTIAL))
  })
  const v2 = v1 ? false : await variant("V2, CameraSetRelative6DOF while holding", () => move("the right seat, holding", seat))
  if (v1 || v2) {
    beep(1000, 150)
    let range = { pitch: [Infinity, -Infinity], yaw: [Infinity, -Infinity] }
    let drift = 0
    for (let s = 1; s <= HOLD_S; s++) {
      await sleep(1000)
      const e = await eye()
      if (!e) continue
      range = { pitch: [Math.min(range.pitch[0], e.pitch), Math.max(range.pitch[1], e.pitch)], yaw: [Math.min(range.yaw[0], e.yaw), Math.max(range.yaw[1], e.yaw)] }
      drift = Math.max(drift, offBy(e))
      rec.data("hold", `${s}s: ${show(e)}`, { s, eye: e })
    }
    beep(500, 600)
    note("hold", `The hold after ${v1 ? "V1" : "V2"}: pitch ${range.pitch.map((v) => v.toFixed(0)).join("° to ")}°, yaw ${range.yaw.map((v) => v.toFixed(0)).join("° to ")}°, the eye at most ${(drift * 1000).toFixed(0)}mm from the right-seat point`)
  }
  // Back to the starting eye inside Pilot, the same way, then ChasePlane back on.
  sim.send("camera acquire", () => h.cameraAcquire(CLIENT))
  await sleep(300)
  const d = new CameraData()
  d.position.x = -start.x
  d.position.y = start.y
  d.position.z = start.z
  d.positionReferential = PositionReferential.SIMOBJECT
  sim.send("camera set to the starting eye", () => h.cameraSet(d, CameraDataMask.POSITION | CameraDataMask.REFERENTIAL))
  await sleep(500)
  sim.send("camera release into Pilot", () => h.cameraRelease("Pilot"))
  await sleep(1500)
  restore = null
  await putBack("done: turning ChasePlane back on")
  const end = await eye()
  note("eye", `End: ${show(end)}, ${end ? (Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) * 1000).toFixed(0) : "?"}mm from the start; camera ${await status()}`)
  const text = ["p09 · Moving the eye while holding the camera, then releasing into the view (--handback2), on MSFS 2024", `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`, "", ...lines, "", `Exceptions: ${rec.timeline.filter((e) => e.kind === "exception").map((e) => e.text).join("; ") || "none"}`].join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
  process.exit(0)
}

// --handback: CameraSetRelative6DOF holds the camera and freezes the look (p09's
// first run). The sim kept a pilot's own move within a view across a release
// into it (p04, record/areas/aircraft/log.md), so this moves the eye to the
// right seat at the view's height, takes the camera, and releases it into the
// view the pilot is in, to see whether the eye stays and the look comes back.
if (process.argv.includes("--handback") && origin && restore) {
  const seat = [+(restore[0] + 0.489).toFixed(4), restore[1], restore[2]]
  const handBack = async (label, name) => {
    sim.send("camera acquire", () => h.cameraAcquire(CLIENT))
    await sleep(300)
    sim.send(`camera release into ${JSON.stringify(name)}`, () => h.cameraRelease(name))
    await sleep(1500)
    const e = await eye()
    const off = e ? Math.hypot(e.x - (origin.x + seat[0]), e.y - (origin.y + seat[1]), e.z - (origin.z + seat[2])) : null
    note("eye", `${label}: ${show(e)}, ${off === null ? "?" : (off * 1000).toFixed(0)}mm from the right-seat point; camera ${await status()}`, { label, eye: e, off })
    return off !== null && off < 0.02
  }
  await step("H1, the right seat at the view's height", seat)
  let stayed = await handBack("H2, released into Pilot", "Pilot")
  if (!stayed) {
    await step("H3, the right seat again", seat)
    stayed = await handBack("H4, released with no view name", "")
  }
  if (stayed) {
    beep(1000, 150)
    let range = { pitch: [Infinity, -Infinity], yaw: [Infinity, -Infinity] }
    for (let s = 1; s <= HOLD_S; s++) {
      await sleep(1000)
      const e = await eye()
      if (!e) continue
      range = { pitch: [Math.min(range.pitch[0], e.pitch), Math.max(range.pitch[1], e.pitch)], yaw: [Math.min(range.yaw[0], e.yaw), Math.max(range.yaw[1], e.yaw)] }
      rec.data("hold", `${s}s: ${show(e)}`, { s, eye: e })
    }
    beep(500, 600)
    note("hold", `H5, the hold after the hand-back: pitch ${range.pitch.map((v) => v.toFixed(0)).join("° to ")}°, yaw ${range.yaw.map((v) => v.toFixed(0)).join("° to ")}°`)
  }
  // Put the view's own offset back, then hand the camera back into it.
  move("back to the starting eye", restore)
  await sleep(1000)
  await handBack("H6, back in Pilot", "Pilot")
  cleaned = false
  restore = null
  await putBack("done: turning ChasePlane back on")
  const end = await eye()
  note("eye", `End: ${show(end)}, ${end ? (Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) * 1000).toFixed(0) : "?"}mm from the start; camera ${await status()}`)
  const text = ["p09 · CameraSetRelative6DOF, then the camera handed back into the view (--handback), on MSFS 2024", `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`, "", ...lines, "", `Exceptions: ${rec.timeline.filter((e) => e.kind === "exception").map((e) => e.text).join("; ") || "none"}`].join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
  process.exit(0)
}
const right = await step("2, the right seat", [0.489, 0, 0])
if (origin && right) note("eye", `  moved ${(right.x - origin.x).toFixed(3)}m right, ${(right.y - origin.y).toFixed(3)}m up, ${(right.z - origin.z).toFixed(3)}m forward of the eyepoint; camera ${await status()}`)

beep(1000, 150)
let looks = { pitch: [Infinity, -Infinity], yaw: [Infinity, -Infinity] }
let drift = 0
for (let s = 1; s <= HOLD_S; s++) {
  await sleep(1000)
  const e = await eye()
  if (!e || !right) continue
  looks = { pitch: [Math.min(looks.pitch[0], e.pitch), Math.max(looks.pitch[1], e.pitch)], yaw: [Math.min(looks.yaw[0], e.yaw), Math.max(looks.yaw[1], e.yaw)] }
  drift = Math.max(drift, Math.hypot(e.x - right.x, e.y - right.y, e.z - right.z))
  rec.data("hold", `${s}s: ${show(e)}`, { s, eye: e })
}
beep(500, 600)
note("hold", `3, the hold: pitch ${looks.pitch.map((v) => v.toFixed(0)).join("° to ")}°, yaw ${looks.yaw.map((v) => v.toFixed(0)).join("° to ")}°, the eye at most ${(drift * 1000).toFixed(0)}mm from where step 2 put it`)

const cabin = await step("4, a point in the cabin", [0.2, 0.1, -1.2])
if (origin && cabin) note("eye", `  ${(cabin.x - origin.x).toFixed(3)}m right, ${(cabin.y - origin.y).toFixed(3)}m up, ${(cabin.z - origin.z).toFixed(3)}m forward of the eyepoint`)

await putBack("done: putting the eye back")
const end = await eye()
note("eye", `5, back: ${show(end)}, ${end ? (Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) * 1000).toFixed(0) : "?"}mm from the start; camera ${await status()}`)

const text = [
  "p09 · Moving the cockpit eye with SimConnect_CameraSetRelative6DOF, on MSFS 2024",
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
