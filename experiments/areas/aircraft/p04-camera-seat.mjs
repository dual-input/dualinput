/*
 * p04: whether a SimConnect client can move the pilot's cockpit camera to
 * another seat, on MSFS 2024, so Crosscheck could seat a pilot itself.
 *
 * Nothing in our records has set the camera. Setting A:CAMERA STATE to 3
 * reverted to 2 within 30ms while ChasePlane ran (measured on MSFS 2024,
 * 2026-10-01, record/areas/aircraft/log.md), and ChasePlane holds the camera
 * while it runs: SimConnect_CameraGetStatus reads ACQUIRED_BY_OTHER (measured,
 * 2026-10-03, record/areas/avatars/log.md). CameraGet's SIMOBJECT position is
 * in meters, x pointing left, y up, and z forward (same log), so the mirror of
 * the pilot's eye across the centerline is the right seat's eye.
 *
 * Three ways, each followed by a read of where the camera went:
 *
 *   A  SimConnect_CameraSetUsingCameraDefinition with the aircraft's own copilot
 *      camera, as SimConnect_EnumerateCameraDefinitions names it, then back to
 *      the pilot's.
 *   B  SimConnect_CameraAcquire, the copilot's definition while holding the
 *      camera, SimConnect_CameraSet to the mirrored eye, then
 *      SimConnect_CameraRelease, read 1s and 3s after the release to see
 *      whether the camera stays where we put it once we let go.
 *   C  SimConnect_CameraAcquire, then SimConnect_CameraRelease with the
 *      copilot's definition's name, then the same with the pilot's.
 *
 * Unattended, about 20s, seated in the cockpit; the view jumps between the
 * seats. On the way out, and on Ctrl+C, it releases the camera and puts it back
 * at the eye it started from.
 *
 *   node experiments/areas/aircraft/p04-camera-seat.mjs
 *
 * Output: the steps on the console, and in
 * experiments/areas/aircraft/results/p04-camera-seat-<time>.txt with the
 * .ndjson beside it.
 */

import { Recorder, sleep } from "./lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "./lib/sim.mjs"
import { CameraData, CameraDataMask, PositionReferential } from "node-simconnect"

// SimConnect.h, SIMCONNECT_CAMERA_ACQUIRED_STATE.
const ACQUIRED = { 0: "NOT_ACQUIRED", 1: "ACQUIRED", 2: "ACQUIRED_BY_OTHER", 3: "USER_DISABLED" }
const CLIENT = "CROSSCHECK p04-camera-seat"
const SETTLE_MS = 1500

const rec = new Recorder("p04-camera-seat", { area: "aircraft" })
const sim = await Sim.connect(rec, { name: CLIENT })
rec.open()
const h = sim.handle
const lines = []
const note = (kind, text, data) => { rec.log(kind, text, data); lines.push(text) }

let status = null
h.on("cameraStatus", (s) => {
  status = `${ACQUIRED[s.acquiredState] ?? `state ${s.acquiredState}`}${s.gameControlled ? ", game controlled" : ""}`
  rec.log("status", `camera ${status}`, { acquiredState: s.acquiredState, gameControlled: s.gameControlled })
})
let definitions = null
h.on("cameraDefinitionList", (l) => { definitions = [...(definitions ?? []), ...l.cameraDefinitions.map((d) => d.name)] })

// CameraGet replies carry no request ID, so each read waits for the next reply.
let waiting = null
h.on("cameraData", (r) => { if (waiting) { const w = waiting; waiting = null; w(r.cameraData) } })
async function eye() {
  const got = new Promise((resolve) => { waiting = resolve; setTimeout(() => { if (waiting === resolve) { waiting = null; resolve(null) } }, 1500) })
  sim.send("camera get SIMOBJECT", () => h.cameraGet(PositionReferential.SIMOBJECT))
  const c = await got
  return c ? { x: c.position.x, y: c.position.y, z: c.position.z, pitch: c.pbh.pitch, yaw: c.pbh.bank } : null
}
async function getStatus() {
  status = null
  sim.send("camera get status", () => h.cameraGetStatus())
  await sleep(300)
  return status ?? "no reply"
}
const show = (e) => (e ? `x ${e.x.toFixed(3)}m (left +), y ${e.y.toFixed(3)}m, z ${e.z.toFixed(3)}m` : "no reply")
const side = (e, start) => (!e || !start ? "" : Math.abs(e.x + start.x) < 0.05 ? ", the mirrored seat" : Math.abs(e.x - start.x) < 0.05 ? ", the starting seat" : ", neither seat")
async function step(label, start) {
  const e = await eye()
  note("eye", `${label}: ${show(e)}${side(e, start)}; camera ${await getStatus()}`, { label, eye: e, status })
  return e
}

function setEye(e) {
  const d = new CameraData()
  d.position.x = e.x
  d.position.y = e.y
  d.position.z = e.z
  d.positionReferential = PositionReferential.SIMOBJECT
  d.positionReferentialObjectId = 0
  return sim.send(`camera set to ${show(e)}`, () => h.cameraSet(d, CameraDataMask.POSITION | CameraDataMask.REFERENTIAL))
}

let start = null
let acquired = false
let cleaned = false
async function cleanUp(why) {
  if (cleaned) return
  cleaned = true
  rec.log("stop", why)
  try {
    const now = await eye()
    if (start && now && Math.abs(now.x - start.x) > 0.05) {
      if (!acquired) { sim.send("camera acquire", () => h.cameraAcquire(CLIENT)); acquired = true; await sleep(200) }
      setEye(start)
      await sleep(300)
    }
    if (acquired) { sim.send("camera release", () => h.cameraRelease("")); acquired = false }
    await sleep(300)
  } catch (e) {
    rec.log("stop", `clean-up failed: ${e.message}`)
  }
}
process.on("SIGINT", async () => {
  await cleanUp("Ctrl+C: releasing the camera and putting it back")
  sim.close()
  await rec.close()
  process.exit(1)
})

const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
note("aircraft", `TITLE ${JSON.stringify(title)}`)
sim.send("subscribe to camera status", () => h.subscribeToCameraStatusUpdate())
start = await step("Start", null)
if (!start) throw new Error("CameraGet gave no reply; is the pilot in the cockpit?")
const mirror = { x: -start.x, y: start.y, z: start.z }

sim.send("enumerate camera definitions", () => h.enumerateCameraDefinitions())
await sleep(1000)
note("definitions", `Camera definitions: ${definitions ? definitions.map((n) => JSON.stringify(n)).join(", ") : "no reply"}`, { definitions })

// A: the aircraft's own copilot camera, then back to the pilot's.
const copilot = definitions?.find((n) => /co-?pilot/i.test(n))
const pilot = definitions?.find((n) => /pilot/i.test(n) && !/co-?pilot/i.test(n))
if (copilot) {
  sim.send(`camera set using definition ${copilot}`, () => h.cameraSetUsingCameraDefinition(copilot))
  await sleep(SETTLE_MS)
  await step(`A, after the definition ${JSON.stringify(copilot)}`, start)
  if (pilot) {
    sim.send(`camera set using definition ${pilot}`, () => h.cameraSetUsingCameraDefinition(pilot))
    await sleep(SETTLE_MS)
    await step(`A, after the definition ${JSON.stringify(pilot)}`, start)
  }
} else {
  note("skip", "A: no definition names a copilot")
}

// B: acquire, set the mirrored eye, release, and see whether it stays.
sim.send("camera acquire", () => h.cameraAcquire(CLIENT))
acquired = true
await sleep(300)
await step("B, after the acquire", start)
if (copilot) {
  sim.send(`camera set using definition ${copilot}, holding the camera`, () => h.cameraSetUsingCameraDefinition(copilot))
  await sleep(SETTLE_MS)
  await step(`B, after the definition ${JSON.stringify(copilot)}, holding the camera`, start)
}
setEye(mirror)
await sleep(SETTLE_MS)
await step("B, after the set to the mirrored eye", start)
sim.send("camera release", () => h.cameraRelease(""))
acquired = false
await sleep(1000)
await step("B, 1s after the release", start)
await sleep(2000)
await step("B, 3s after the release", start)

// C: SimConnect_CameraRelease takes a camera definition's name; releasing into
// the copilot's might leave the pilot's own camera in that seat.
if (copilot) {
  sim.send("camera acquire", () => h.cameraAcquire(CLIENT))
  acquired = true
  await sleep(300)
  sim.send(`camera release into ${copilot}`, () => h.cameraRelease(copilot))
  acquired = false
  await sleep(1000)
  await step(`C, 1s after the release into ${JSON.stringify(copilot)}`, start)
  await sleep(2000)
  await step(`C, 3s after the release into ${JSON.stringify(copilot)}`, start)
  if (pilot) {
    sim.send("camera acquire", () => h.cameraAcquire(CLIENT))
    acquired = true
    await sleep(300)
    sim.send(`camera release into ${pilot}`, () => h.cameraRelease(pilot))
    acquired = false
    await sleep(1000)
    await step(`C, 1s after the release into ${JSON.stringify(pilot)}`, start)
  }
}

await cleanUp("done: putting the camera back")
await step("After putting it back", start)

const exceptions = rec.timeline.filter((e) => e.kind === "exception").map((e) => e.text)
const text = [
  "p04 · Moving the cockpit camera to another seat through SimConnect, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  "",
  ...lines,
  "",
  `Status updates: ${rec.timeline.filter((e) => e.kind === "status").map((e) => e.text.replace(/^camera /, "")).join("; ") || "none"}`,
  `Exceptions: ${exceptions.join("; ") || "none"}`,
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
sim.close()
await rec.close()
process.exit(0)
