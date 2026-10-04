/*
 * p12: whether the cockpit camera's save slots let a client put the pilot's eye
 * at any point and hand the camera back, on MSFS 2024, so Crosscheck can seat a
 * pilot in any seat without a camera view for each.
 *
 * Holding the camera, a client can put the eye anywhere, but the pilot's look
 * freezes and releasing snaps back; releasing into a view hands back only into
 * the first view with each pilot item; the eyepoint events don't move the eye
 * (p04, p06, p09, p11, record/areas/aircraft/log.md). The SDK's camera simvars
 * include CAMERA ACTION COCKPIT VIEW SAVE:index, settable, "This can be used to
 * save a cockpit camera when the CAMERA STATE is set to 2 (Cockpit). The index
 * value given is the save 'slot' that will be used, from 0 to 9", and CAMERA
 * VIEW TYPE AND INDEX, settable, with view types 1 Pilot View, 2 Instruments,
 * 3 Quickview, 4 Quickview External, 5 View; CAMERA REQUEST ACTION 2 is "Move
 * Active Camera", and COCKPIT CAMERA HEIGHT a height modifier, default 50%
 * (MSFS 2024 SDK, Camera Variables). The events include VIEW_CAMERA_SELECT_0 to
 * _9 (read in MSFS 2024 SDK 1.7.3, MSFS_EventsEnum.h).
 *
 * Steps, each read with SimConnect_CameraGet's SIMOBJECT position, x turned to
 * point right, y up, z forward, in meters (measured, record/areas/avatars/log.md):
 *
 *   S0  save slot 9 with the pilot's own camera where it is
 *   S1  take the camera, put the eye at the right seat (the starting eye
 *       mirrored), save slot 8 while holding, then release with no name
 *   L   load slot 8: K:VIEW_CAMERA_SELECT_8, then CAMERA VIEW TYPE AND INDEX
 *       5 and 8; if the eye lands at the right seat with the camera free, a
 *       short high beep opens 10s for the pilot to look around, closed by a
 *       long low beep
 *   H   COCKPIT CAMERA HEIGHT to 80%, then back
 *   R   CAMERA REQUEST ACTION 2, then CAMERA ACTION COCKPIT VIEW RESET
 *
 * After S0 and S1 it reads the pilot's per-user camera file for the aircraft,
 * %APPDATA%\Microsoft Flight Simulator 2024\SimObjects\Airplanes\<folder>\cameras.CFG
 * on a Steam install, which it backs up first and puts back at the end.
 * ChasePlane is turned off through its API for the run and back on at the end.
 *
 *   node experiments/areas/aircraft/p12-camera-slots.mjs [--folder <name>]
 *
 * Output: the steps on the console, and in
 * experiments/areas/aircraft/results/p12-camera-slots-<time>.txt with the
 * .ndjson beside it.
 */

import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startBeeper } from "../../tools/guide.mjs"
import { connectChasePlane } from "./lib/chaseplane.mjs"
import { Recorder, sleep } from "./lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "./lib/sim.mjs"
import { CameraData, CameraDataMask, PositionReferential } from "node-simconnect"

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback }
const FOLDER = arg("--folder", "bksq-aircraft-baronpropress")
const FILE = join(process.env.APPDATA, "Microsoft Flight Simulator 2024", "SimObjects", "Airplanes", FOLDER, "cameras.CFG")
const BACKUP = join(tmpdir(), `crosscheck-p12-${FOLDER}-cameras.CFG`)
const CLIENT = "CROSSCHECK p12-camera-slots"
const ACQUIRED = { 0: "NOT_ACQUIRED", 1: "ACQUIRED", 2: "ACQUIRED_BY_OTHER", 3: "USER_DISABLED" }

const rec = new Recorder("p12-camera-slots", { area: "aircraft" })
const sim = await Sim.connect(rec, { name: CLIENT })
rec.open()
const beep = startBeeper()
const h = sim.handle
const lines = []
const note = (kind, text, data) => { rec.log(kind, text, data); lines.push(text) }

// ---------------------------------------------------------------- reading

let waiting = null
h.on("cameraData", (r) => { if (waiting) { const w = waiting; waiting = null; w(r.cameraData) } })
async function eye() {
  const got = new Promise((resolve) => { waiting = resolve; setTimeout(() => { if (waiting === resolve) { waiting = null; resolve(null) } }, 1500) })
  sim.send("camera get SIMOBJECT", () => h.cameraGet(PositionReferential.SIMOBJECT))
  const c = await got
  return c ? { x: -c.position.x, y: c.position.y, z: c.position.z, pitch: c.pbh.pitch, yaw: c.pbh.bank } : null
}
const show = (e) => (e ? `x ${e.x.toFixed(3)}, y ${e.y.toFixed(3)}, z ${e.z.toFixed(3)}m` : "no reply")
const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Infinity)
const status = async () => {
  const s = await new Promise((resolve) => { h.once("cameraStatus", (x) => resolve(x.acquiredState)); sim.send("camera get status", () => h.cameraGetStatus()); setTimeout(() => resolve(null), 1500) })
  return ACQUIRED[s] ?? "no reply"
}
const VIEW_VARS = [["CAMERA STATE", "number"], ["CAMERA VIEW TYPE AND INDEX:0", "number"], ["CAMERA VIEW TYPE AND INDEX:1", "number"], ["COCKPIT CAMERA HEIGHT", "percent"]]
async function view() {
  const v = await sim.read(VIEW_VARS)
  return `state ${v.get("CAMERA STATE")}, view type ${v.get("CAMERA VIEW TYPE AND INDEX:0")} index ${v.get("CAMERA VIEW TYPE AND INDEX:1")}, height ${v.get("COCKPIT CAMERA HEIGHT")}%`
}
async function step(label, target = null) {
  await sleep(1500)
  const e = await eye()
  note("eye", `${label}: ${show(e)}${target ? `, ${(dist(e, target) * 1000).toFixed(0)}mm from the right-seat point` : ""}; camera ${await status()}; ${await view()}`, { label, eye: e })
  return e
}
function fileState() {
  if (!existsSync(FILE)) return "no per-user camera file"
  const t = readFileSync(FILE, "latin1")
  const defs = [...t.matchAll(/Title\s*=\s*"?([^"\r\n]*)"?[\s\S]*?InitialXyz\s*=\s*([^\r\n]*)/gi)].map((m) => `${m[1].trim()} at ${m[2].trim()}`)
  return `per-user camera file written ${statSync(FILE).mtime.toISOString().slice(11, 19)}Z, ${defs.length} definitions: ${defs.join("; ")}`
}

// ---------------------------------------------------------------- safety

let cp = null
let cpTurnedOff = false
let acquired = false
let cleaned = false
async function cleanUp(why) {
  if (cleaned) return
  cleaned = true
  rec.log("stop", why)
  try {
    sim.send("camera acquire", () => h.cameraAcquire(CLIENT))
    await sleep(300)
    sim.send("camera release into Pilot", () => h.cameraRelease("Pilot"))
    acquired = false
    await sleep(1000)
  } catch (e) { rec.log("stop", `handing the camera back failed: ${e.message}`) }
  if (existsSync(BACKUP)) { writeFileSync(FILE, readFileSync(BACKUP)); rec.log("stop", "put the per-user camera file back from its backup") }
  if (cpTurnedOff) { try { await cp.setMasterEnabled(true); rec.log("stop", "turned ChasePlane back on") } catch (e) { rec.log("stop", `turning ChasePlane back on failed: ${e.message}`) } }
  cp?.close()
}
process.on("SIGINT", async () => { await cleanUp("Ctrl+C"); sim.close(); await rec.close(); process.exit(1) })

// ---------------------------------------------------------------- the run

const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
note("aircraft", `TITLE ${JSON.stringify(title)}`)
if (existsSync(FILE)) { copyFileSync(FILE, BACKUP); note("file", `Backed up the per-user camera file; before the run: ${fileState()}`) } else note("file", "No per-user camera file before the run")
try {
  cp = await connectChasePlane(CLIENT, { rec })
  await sleep(500)
  if (cp.state.masterEnabled) { await cp.setMasterEnabled(false); cpTurnedOff = true; await sleep(1500); note("chaseplane", "Turned ChasePlane off through its API") }
} catch (e) { note("chaseplane", `ChasePlane: ${e.message}`) }

const start = await step("Start")
if (!start) throw new Error("CameraGet gave no reply; is the pilot in the cockpit?")
const seat = { x: -start.x, y: start.y, z: start.z }

// S0: save slot 9 from the pilot's own camera.
sim.write("CAMERA ACTION COCKPIT VIEW SAVE:9", "bool", 1)
await step("S0, after saving slot 9 with the pilot's own camera")
note("file", `After S0: ${fileState()}`)

// S1: hold the camera at the right seat, save slot 8, let go.
sim.send("camera acquire", () => h.cameraAcquire(CLIENT))
acquired = true
await sleep(300)
const d = new CameraData()
d.position.x = -seat.x // CameraSet's SIMOBJECT x points left
d.position.y = seat.y
d.position.z = seat.z
d.positionReferential = PositionReferential.SIMOBJECT
sim.send("camera set to the right seat", () => h.cameraSet(d, CameraDataMask.POSITION | CameraDataMask.REFERENTIAL))
await step("S1, holding the camera at the right seat", seat)
sim.write("CAMERA ACTION COCKPIT VIEW SAVE:8", "bool", 1)
await step("S1, after saving slot 8 while holding", seat)
sim.send("camera release with no name", () => h.cameraRelease(""))
acquired = false
await step("S1, after the release", seat)
note("file", `After S1: ${fileState()}`)

// L: load slot 8.
async function tryLoad(label, act) {
  act()
  const e = await step(label, seat)
  const st = await status()
  const works = dist(e, seat) < 0.03 && st === "NOT_ACQUIRED"
  if (works) {
    beep(1000, 150)
    let lo = Infinity, hi = -Infinity, drift = 0
    for (let s = 1; s <= 10; s++) { await sleep(1000); const x = await eye(); if (!x) continue; lo = Math.min(lo, x.yaw); hi = Math.max(hi, x.yaw); drift = Math.max(drift, dist(x, e)) }
    beep(500, 600)
    note("hold", `${label}: the 10s look test: yaw ${lo.toFixed(0)}° to ${hi.toFixed(0)}°, the eye at most ${(drift * 1000).toFixed(0)}mm from where the load put it`)
  }
  return works
}
let loaded = await tryLoad("L1, after K:VIEW_CAMERA_SELECT_8", () => sim.transmit("VIEW_CAMERA_SELECT_8", [], { quiet: true }))
if (!loaded) {
  loaded = await tryLoad("L2, after CAMERA VIEW TYPE AND INDEX 5 and 8", () => sim.set([["CAMERA VIEW TYPE AND INDEX:0", "number"], ["CAMERA VIEW TYPE AND INDEX:1", "number"]], [5, 8]))
}

// H: the height modifier.
const before = await sim.read([["COCKPIT CAMERA HEIGHT", "percent"]])
const was = before.get("COCKPIT CAMERA HEIGHT")
const h0 = await eye()
sim.write("COCKPIT CAMERA HEIGHT", "percent", 80)
const h1 = await step("H, after COCKPIT CAMERA HEIGHT 80%")
if (h0 && h1) note("eye", `  the eye moved ${((h1.y - h0.y) * 1000).toFixed(0)}mm up, ${((h1.x - h0.x) * 1000).toFixed(0)}mm right, ${((h1.z - h0.z) * 1000).toFixed(0)}mm forward`)
sim.write("COCKPIT CAMERA HEIGHT", "percent", Number.isFinite(was) ? was : 50)
await step("H, after putting the height back")

// R: the "move" request, then reset.
sim.write("CAMERA REQUEST ACTION", "number", 2)
await step("R, after CAMERA REQUEST ACTION 2")
await sleep(1500)
await step("R, 3s after it")
sim.write("CAMERA ACTION COCKPIT VIEW RESET", "bool", 1)
await step("R, after CAMERA ACTION COCKPIT VIEW RESET")

await cleanUp("done: handing the camera back into Pilot, restoring the file, ChasePlane back on")
note("file", `After the restore: ${fileState()}`)
await step("End")

const text = [
  "p12 · The cockpit camera's save slots, height, and move request, on MSFS 2024",
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
