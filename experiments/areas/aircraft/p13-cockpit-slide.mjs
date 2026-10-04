/*
 * p13: whether the sim's own cockpit camera actions, sent as events through
 * SimConnect, move the pilot's cockpit eye in MSFS 2024 and leave them their
 * camera, so Crosscheck can slide a pilot to any seat.
 *
 * The legacy K:EYEPOINT_* events don't move the eye, and the pilot's own camera
 * keys fired none of the legacy camera events (p06, p07); COCKPIT CAMERA HEIGHT
 * raises the eye with the camera free (p12); all in record/areas/aircraft/log.md.
 * The sim's input profiles name the actions those keys trigger:
 * KEY_COCKPIT_CAMERA_SLIDE_LEFT, _SLIDE_RIGHT, _SLIDE_FRONT, _SLIDE_BACK,
 * KEY_COCKPIT_CAMERA_HEIGHT_INC, and _HEIGHT_DEC (read in the sim's
 * Packages\fs-input-profiles, inputprofiles\*.xml, 2026-10-04). They aren't in
 * the SDK's event header (MSFS 2024 SDK 1.7.3, MSFS_EventsEnum.h), so whether
 * SimConnect knows them by name is the first question.
 *
 * For each action, three ways, each read with SimConnect_CameraGet's SIMOBJECT
 * position, x turned to point right, y up, z forward, in meters:
 *
 *   a  10 events with no value, 50ms apart
 *   b  10 events with value 1, then one with value 0 (a held key, released)
 *   c  one event with value 1, held 1s, then value 0
 *
 * Then K:COCKPIT_RESET-free cleanup: the camera is taken and released into the
 * Pilot view. ChasePlane is turned off through its API for the run and back on.
 * About 40s, hands off.
 *
 *   node experiments/areas/aircraft/p13-cockpit-slide.mjs
 *
 * Output: the steps on the console, and in
 * experiments/areas/aircraft/results/p13-cockpit-slide-<time>.txt with the
 * .ndjson beside it.
 */

import { connectChasePlane } from "./lib/chaseplane.mjs"
import { Recorder, sleep } from "./lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "./lib/sim.mjs"
import { PositionReferential } from "node-simconnect"

const CLIENT = "CROSSCHECK p13-cockpit-slide"
const ACTIONS = [
  "COCKPIT_CAMERA_SLIDE_RIGHT", "COCKPIT_CAMERA_SLIDE_LEFT", "COCKPIT_CAMERA_SLIDE_FRONT",
  "COCKPIT_CAMERA_SLIDE_BACK", "COCKPIT_CAMERA_HEIGHT_INC", "COCKPIT_CAMERA_HEIGHT_DEC",
]

const rec = new Recorder("p13-cockpit-slide", { area: "aircraft" })
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
  return c ? { x: -c.position.x, y: c.position.y, z: c.position.z } : null
}
const delta = (a, b) => (a && b ? `${((b.x - a.x) * 1000).toFixed(0)}mm right, ${((b.y - a.y) * 1000).toFixed(0)}mm up, ${((b.z - a.z) * 1000).toFixed(0)}mm forward` : "no reply")
const status = async () => {
  const s = await new Promise((resolve) => { h.once("cameraStatus", (x) => resolve(x.acquiredState)); sim.send("camera get status", () => h.cameraGetStatus()); setTimeout(() => resolve(null), 1500) })
  return ({ 0: "NOT_ACQUIRED", 1: "ACQUIRED", 2: "ACQUIRED_BY_OTHER", 3: "USER_DISABLED" })[s] ?? "no reply"
}

let cp = null
let cpTurnedOff = false
let cleaned = false
async function cleanUp(why) {
  if (cleaned) return
  cleaned = true
  rec.log("stop", why)
  try {
    sim.send("camera acquire", () => h.cameraAcquire(CLIENT))
    await sleep(300)
    sim.send("camera release into Pilot", () => h.cameraRelease("Pilot"))
    await sleep(1000)
  } catch (e) { rec.log("stop", `handing the camera back failed: ${e.message}`) }
  if (cpTurnedOff) { try { await cp.setMasterEnabled(true); note("chaseplane", "Turned ChasePlane back on") } catch (e) { note("chaseplane", `Turning ChasePlane back on failed: ${e.message}`) } }
  cp?.close()
}
process.on("SIGINT", async () => { await cleanUp("Ctrl+C"); sim.close(); await rec.close(); process.exit(1) })

const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
note("aircraft", `TITLE ${JSON.stringify(title)}`)
try {
  cp = await connectChasePlane(CLIENT, { rec })
  await sleep(500)
  if (cp.state.masterEnabled) { await cp.setMasterEnabled(false); cpTurnedOff = true; await sleep(1500); note("chaseplane", "Turned ChasePlane off through its API") }
} catch (e) { note("chaseplane", `ChasePlane: ${e.message}`) }
const start = await eye()
if (!start) throw new Error("CameraGet gave no reply; is the pilot in the cockpit?")
note("eye", `Start: x ${start.x.toFixed(3)}, y ${start.y.toFixed(3)}, z ${start.z.toFixed(3)}m; camera ${await status()}`)

const send = (name, values = []) => sim.transmit(name, values, { quiet: true, tag: false })
for (const a of ACTIONS) {
  const before = rec.timeline.filter((e) => e.kind === "exception").length
  let e0 = await eye()
  for (let i = 0; i < 10; i++) { send(a); await sleep(50) }
  await sleep(800)
  let e1 = await eye()
  note("move", `${a}, a (10 events, no value): ${delta(e0, e1)}`)
  e0 = e1
  for (let i = 0; i < 10; i++) { send(a, [1]); await sleep(50) }
  send(a, [0])
  await sleep(800)
  e1 = await eye()
  note("move", `${a}, b (10 with value 1, then 0): ${delta(e0, e1)}`)
  e0 = e1
  send(a, [1])
  await sleep(1000)
  send(a, [0])
  await sleep(800)
  e1 = await eye()
  const ex = rec.timeline.filter((e) => e.kind === "exception").slice(before).map((e) => e.text)
  note("move", `${a}, c (value 1 held 1s, then 0): ${delta(e0, e1)}; camera ${await status()}${ex.length ? `; exceptions: ${[...new Set(ex)].join("; ")}` : ""}`)
}
const end = await eye()
note("eye", `Before cleanup: ${delta(start, end)} from the start`)
await cleanUp("done: handing the camera back into Pilot, ChasePlane back on")

const text = [
  "p13 · The sim's cockpit camera slide and height actions sent through SimConnect, on MSFS 2024",
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
