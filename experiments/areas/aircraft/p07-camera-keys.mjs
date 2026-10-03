/*
 * p07: which K: events the sim fires while the pilot moves the cockpit eye with
 * their own key bindings, on MSFS 2024, so we know whether sending the eyepoint
 * events (p06) is what the sim itself does.
 *
 * A SimConnect client hears only the events it names, so this listens for a
 * list of candidate camera events from the SDK's legacy view and eyepoint
 * events, without masking any (the pilot's keys go through untouched). A name
 * the sim doesn't know raises an exception, which the report lists. While it
 * listens, it reads SimConnect_CameraGet's SIMOBJECT position every 200ms, in
 * meters with x pointing left (measured, record/areas/avatars/log.md), so each
 * event can be set against the eye's movement.
 *
 * About 25s, seated in the cockpit with ChasePlane disabled: after the short
 * high beep, move the eye with your bindings (Shift+W, A, S, D, and any up,
 * down, or reset keys) until the long low beep, 20s later.
 *
 *   node experiments/areas/aircraft/p07-camera-keys.mjs
 *
 * Output: the events on the console, and in
 * experiments/areas/aircraft/results/p07-camera-keys-<time>.txt with the
 * .ndjson beside it.
 */

import { startBeeper } from "../../tools/guide.mjs"
import { Recorder, sleep } from "./lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "./lib/sim.mjs"
import { PositionReferential } from "node-simconnect"

const LISTEN_MS = 20_000
const POLL_MS = 200
// Candidates from the SDK's legacy event IDs; the run reports which the sim knows.
const CANDIDATES = [
  "EYEPOINT_BACK", "EYEPOINT_DOWN", "EYEPOINT_FORWARD", "EYEPOINT_LEFT", "EYEPOINT_RIGHT", "EYEPOINT_UP", "EYEPOINT_RESET",
  "PAN_LEFT", "PAN_RIGHT", "PAN_UP", "PAN_DOWN", "PAN_RESET", "PAN_RESET_COCKPIT", "PAN_TILT_LEFT", "PAN_TILT_RIGHT",
  "VIEW_RESET", "VIEW_MODE", "VIEW_MODE_REV", "ZOOM_IN", "ZOOM_OUT", "ZOOM_1X", "ZOOM_IN_FINE", "ZOOM_OUT_FINE",
]

const rec = new Recorder("p07-camera-keys", { area: "aircraft" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p07-camera-keys" })
rec.open()
const beep = startBeeper()
const h = sim.handle

let waiting = null
h.on("cameraData", (r) => { if (waiting) { const w = waiting; waiting = null; w(r.cameraData) } })
async function eye() {
  const got = new Promise((resolve) => { waiting = resolve; setTimeout(() => { if (waiting === resolve) { waiting = null; resolve(null) } }, 1000) })
  sim.send("camera get SIMOBJECT", () => h.cameraGet(PositionReferential.SIMOBJECT))
  const c = await got
  return c ? { x: c.position.x, y: c.position.y, z: c.position.z } : null
}
const show = (e) => (e ? `x ${e.x.toFixed(3)}m, y ${e.y.toFixed(3)}m, z ${e.z.toFixed(3)}m` : "no reply")

const heard = new Map()
let listening = false
sim.subscribeKeys(CANDIDATES, {
  priority: "highest",
  maskable: false,
  onEvent: (e) => {
    if (!listening) return
    heard.set(e.name, (heard.get(e.name) ?? 0) + 1)
  },
})
await sleep(1000)

const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
const start = await eye()
console.log(`TITLE ${JSON.stringify(title)}; eye at ${show(start)}`)
console.log("Short high beep: move the eye with your keys for 20s, until the long low beep.")
await sleep(1000)
beep(1000, 150)
listening = true
const t0 = Date.now()
let last = start
let travel = 0
const extent = { x: [start.x, start.x], y: [start.y, start.y], z: [start.z, start.z] }
while (Date.now() - t0 < LISTEN_MS) {
  await sleep(POLL_MS)
  const now = await eye()
  if (!now) continue
  const moved = Math.hypot(now.x - last.x, now.y - last.y, now.z - last.z)
  if (moved > 0.001) rec.data("eye", show(now), { eye: now, t: Date.now() - t0 })
  travel += moved
  for (const a of ["x", "y", "z"]) { extent[a][0] = Math.min(extent[a][0], now[a]); extent[a][1] = Math.max(extent[a][1], now[a]) }
  last = now
}
listening = false
beep(500, 600)

const unknown = rec.timeline.filter((e) => e.kind === "exception").map((e) => e.text)
const text = [
  "p07 · K: events heard while the pilot moves the cockpit eye with their keys, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  `Aircraft: TITLE ${JSON.stringify(title)}`,
  "",
  `Eye at the start: ${show(start)}; at the end: ${show(last)}`,
  `Eye travel over ${LISTEN_MS / 1000}s: ${travel.toFixed(3)}m; range x ${extent.x.map((v) => v.toFixed(3)).join(" to ")}, y ${extent.y.map((v) => v.toFixed(3)).join(" to ")}, z ${extent.z.map((v) => v.toFixed(3)).join(" to ")}`,
  "",
  `Events heard: ${heard.size ? [...heard].map(([n, c]) => `K:${n} ×${c}`).join(", ") : "none"}`,
  `Listened for: ${CANDIDATES.length} events`,
  `Exceptions: ${unknown.join("; ") || "none"}`,
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
sim.close()
await rec.close()
process.exit(0)
