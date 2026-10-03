/*
 * p05: whether ChasePlane's own API moves the pilot's camera to another seat,
 * on MSFS 2024, since ChasePlane takes the camera back from a SimConnect client
 * that releases it into the copilot's view (p04, record/areas/aircraft/log.md).
 *
 * ChasePlane's bridge, CP MSFS Bridge, serves a web app, ChasePlane Remote, on
 * port 8651, and a WebSocket API on port 8652, version 2. Nobody documents the
 * API; this probe speaks it as ChasePlane Remote's script does (read in
 * ChasePlane 2026.39.1.16, http://localhost:8651/remote_assets/remote-ui.js,
 * class uM): an api_connect message with a client name, then api_request
 * messages with a request ID, answered by api_reply. The requests used here:
 *
 *   get_views         every view of the loaded aircraft, each with a guid, a
 *                     name, a mode (0 inside), and a position
 *   set_view_by_guid  load one view
 *   cam_set_position  put the camera at a position given in the message, sent
 *                     as a bare message rather than a request
 *
 * Steps, each followed by SimConnect_CameraGet's SIMOBJECT position, in meters
 * with x pointing left (measured, record/areas/avatars/log.md):
 *
 *   1  set_view_by_guid with the view named CoPilot
 *   2  a hold in that seat, from a short high beep to a long low one, for the
 *      pilot to look around with the mouse
 *   3  cam_set_position at the pilot view's position moved right by twice the
 *      starting eye's distance from the centerline, the mirror of the pilot's eye
 *   4  set_view_by_guid with the view named Pilot, which also puts it back
 *
 * About 25s, seated in the cockpit with ChasePlane running.
 *
 *   node experiments/areas/aircraft/p05-chaseplane-seat.mjs [--hold <s>]
 *
 * Output: the steps on the console, and in
 * experiments/areas/aircraft/results/p05-chaseplane-seat-<time>.txt with the
 * .ndjson beside it.
 */

import { startBeeper } from "../../tools/guide.mjs"
import { Recorder, sleep } from "./lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "./lib/sim.mjs"
import { PositionReferential } from "node-simconnect"

const API = "ws://localhost:8652"
const CLIENT = "CROSSCHECK p05-chaseplane-seat"
const SETTLE_MS = 1500
const holdAt = process.argv.indexOf("--hold")
const HOLD_S = holdAt > 0 ? Number(process.argv[holdAt + 1]) || 10 : 10

const rec = new Recorder("p05-chaseplane-seat", { area: "aircraft" })
const sim = await Sim.connect(rec, { name: CLIENT })
rec.open()
const beep = startBeeper()
const lines = []
const note = (kind, text, data) => { rec.log(kind, text, data); lines.push(text) }

// ---------------------------------------------------------------- the eye

let waiting = null
sim.handle.on("cameraData", (r) => { if (waiting) { const w = waiting; waiting = null; w(r.cameraData) } })
async function eye() {
  const got = new Promise((resolve) => { waiting = resolve; setTimeout(() => { if (waiting === resolve) { waiting = null; resolve(null) } }, 1500) })
  sim.send("camera get SIMOBJECT", () => sim.handle.cameraGet(PositionReferential.SIMOBJECT))
  const c = await got
  // CameraGet's Bank field carries the yaw (measured, record/areas/avatars/log.md).
  return c ? { x: c.position.x, y: c.position.y, z: c.position.z, pitch: c.pbh.pitch, yaw: c.pbh.bank } : null
}
const show = (e) => (e ? `x ${e.x.toFixed(3)}m (left +), y ${e.y.toFixed(3)}m, z ${e.z.toFixed(3)}m, pitch ${e.pitch.toFixed(0)}°, yaw ${e.yaw.toFixed(0)}°` : "no reply")
let start = null
const side = (e) => (!e || !start ? "" : Math.abs(e.x + start.x) < 0.05 ? ", the mirrored seat" : Math.abs(e.x - start.x) < 0.05 ? ", the starting seat" : ", neither seat")
async function step(label) {
  const e = await eye()
  note("eye", `${label}: ${show(e)}${side(e)}`, { label, eye: e })
  return e
}

// ---------------------------------------------------------------- ChasePlane's API

const ws = new WebSocket(API)
const pending = new Map()
const send = (obj) => { rec.log("send", JSON.stringify(obj).slice(0, 300), { sent: obj }); ws.send(JSON.stringify(obj)) }
function request(command, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = `${command}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
    pending.set(id, { resolve, reject })
    send({ message: "api_request", request_id: id, command, payload })
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${command}: no reply in 5s`)) }, 5000)
  })
}
// ChasePlane Remote unwraps replies nested up to four deep the same way.
const unwrap = (p) => { for (let i = 0; i < 4 && p && typeof p === "object" && "payload" in p; i++) p = p.payload; return p }
let info = null
let apiVersion = null
await new Promise((resolve, reject) => {
  ws.onopen = () => send({ message: "api_connect", payload: { client_name: CLIENT } })
  ws.onerror = () => reject(new Error(`could not reach ChasePlane's API at ${API}; is ChasePlane running?`))
  ws.onmessage = (m) => {
    if (typeof m.data !== "string" || m.data === "PING" || m.data === "PING_BRIDGE") return
    let x
    try { x = JSON.parse(m.data) } catch { return }
    if (x.message === "api_version") apiVersion = x.payload?.version
    else if (x.message === "initialized") { info = x.payload; resolve() }
    else if (x.message === "api_reply") {
      const p = pending.get(x.request_id)
      if (p) { pending.delete(x.request_id); x.status === 200 ? p.resolve(unwrap(x.payload)) : p.reject(new Error(`${x.error} (${x.status})`)) }
    } else if (x.message === "cam_mode_set") rec.log("chaseplane", `cam_mode_set ${JSON.stringify(x.payload)}`, { payload: x.payload })
  }
  setTimeout(() => reject(new Error("ChasePlane sent no initialized message in 5s")), 5000)
})
note("chaseplane", `ChasePlane ${info?.chaseplane_version}, API version ${apiVersion}`)

let restore = null
let cleaned = false
async function cleanUp(why) {
  if (cleaned) return
  cleaned = true
  rec.log("stop", why)
  try { if (restore) { await request("set_view_by_guid", { guid: restore }); await sleep(SETTLE_MS) } } catch (e) { rec.log("stop", `putting the view back failed: ${e.message}`) }
}
process.on("SIGINT", async () => {
  await cleanUp("Ctrl+C: loading the Pilot view")
  ws.close()
  sim.close()
  await rec.close()
  process.exit(1)
})

// ---------------------------------------------------------------- the run

const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
note("aircraft", `TITLE ${JSON.stringify(title)}`)
const viewsReply = await request("get_views")
const views = Array.isArray(viewsReply) ? viewsReply : viewsReply?.views ?? []
const inside = views.filter((v) => v.mode === 0)
const copilot = inside.find((v) => /^co-?pilot$/i.test(v.name))
const pilot = inside.find((v) => /^pilot$/i.test(v.name))
note("views", `${views.length} views, ${inside.length} inside; CoPilot ${copilot ? `at ${JSON.stringify(copilot.position)}` : "missing"}; Pilot ${pilot ? `at ${JSON.stringify(pilot.position)}` : "missing"}`, { copilot, pilot })
if (!copilot || !pilot) throw new Error("this aircraft has no views named CoPilot and Pilot in ChasePlane")
restore = pilot.guid
start = await step("Start")

await request("set_view_by_guid", { guid: copilot.guid })
await sleep(SETTLE_MS)
await step("1, after set_view_by_guid CoPilot")

beep(1000, 150)
for (let s = 1; s <= HOLD_S; s++) {
  await sleep(1000)
  await step(`2, ${s}s into the hold`)
}
beep(500, 600)

// ChasePlane's positions are offsets from the pilot's eye with x pointing right,
// so the mirror of the starting eye is twice its distance from the centerline.
const mirror = { ...pilot.position, x: pilot.position.x + 2 * start.x }
send({ message: "cam_set_position", payload: { version: 1, mode: 0, name: "Crosscheck seat", can_transition: false, transition_time: 0, transition_easing: "DEFAULT", position: mirror } })
await sleep(SETTLE_MS)
await step(`3, after cam_set_position at x ${mirror.x.toFixed(3)}`)
await sleep(2000)
await step("3, 2s later")

await cleanUp("done: loading the Pilot view")
await step("4, after set_view_by_guid Pilot")

const exceptions = rec.timeline.filter((e) => e.kind === "exception").map((e) => e.text)
const text = [
  "p05 · Moving the cockpit camera to another seat through ChasePlane's API, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  "",
  ...lines,
  "",
  `Exceptions: ${exceptions.join("; ") || "none"}`,
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
ws.close()
sim.close()
await rec.close()
process.exit(0)
