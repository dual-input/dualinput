/*
 * p06: what tells Crosscheck where the pilot looks in the cockpit, with
 * ChasePlane driving the camera and with it disabled, on MSFS 2024.
 *
 * In p03, A:CAMERA GAMEPLAY PITCH YAW read 0 while ChasePlane drove the camera
 * and tracked the look once ChasePlane was disabled in its own settings
 * (experiments/areas/avatars/results/p03-cockpit-2026-10-02-21-42-04.txt).
 * Two other sources, read in files and not yet run:
 *
 *   - ChasePlane's L:p42_cp_r_x, _y, _z, _pitch, _yaw, _roll, and _zoom, which
 *     its binocular overlay adds to the aircraft's heading and pitch to show
 *     where the camera points (read in p42-util-chaseplane 26.39.1,
 *     HTML_UI/InGamePanels/P42ChasePlane/P42ChasePlane_overlay.js, and CP.dll's
 *     variable list).
 *   - SimConnect_CameraGet, which replies with the camera's position and
 *     pitch, bank, and heading in the referential asked for. Its SDK page says
 *     it works whether or not anyone acquired the camera, and Asobo staff wrote
 *     that from Sim Update 6 Beta 1.8.8.0 it returns the active camera even when
 *     nobody did (devsupport.flightsimulator.com/t/17697, 2026-07-17).
 *     ChasePlane drives the camera through the same Camera API (read in its
 *     ChasePlaneModule.wasm imports: fsCameraAcquire, fsCameraSet, fsCameraGet).
 *
 * The probe never calls SimConnect_CameraAcquire, because that would take the
 * camera from ChasePlane. It reads, and asks SimConnect_CameraGetStatus who
 * holds the camera.
 *
 * About 30s, seated in the cockpit:
 *
 *   ChasePlane on   Press Page Down, then look hard left, right, up, and down
 *                   until the long low beep, 8s.
 *   ChasePlane off  Disable ChasePlane in its settings, press Page Down, and
 *                   look around the same way, 8s. Page Up skips it.
 *
 *   node experiments/areas/avatars/p06-camera.mjs
 *
 * Output: one line per step on the console, every reading in
 * experiments/areas/avatars/results/p06-camera-<time>.ndjson, and the report in
 * the .txt beside it.
 */

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { Recorder, fmt, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"

const VARS = [
  ["CAMERA STATE", "number"],
  ["CAMERA GAMEPLAY PITCH YAW:0", "radians"], ["CAMERA GAMEPLAY PITCH YAW:1", "radians"],
  ["L:p42_cp_mode", "number"],
  ["L:p42_cp_r_x", "number"], ["L:p42_cp_r_y", "number"], ["L:p42_cp_r_z", "number"],
  ["L:p42_cp_r_pitch", "number"], ["L:p42_cp_r_yaw", "number"], ["L:p42_cp_r_roll", "number"], ["L:p42_cp_r_zoom", "number"],
  ["L:p42_cp_rendered_camera_valid", "number"],
]

// SimConnect.h: SIMCONNECT_POSITION_REFERENTIAL and SIMCONNECT_CAMERA_ACQUIRED_STATE.
const REFERENTIALS = { 1: "SIMOBJECT", 2: "WORLD", 3: "EYEPOINT" }
const ACQUIRED = { 0: "NOT_ACQUIRED", 1: "ACQUIRED", 2: "ACQUIRED_BY_OTHER", 3: "USER_DISABLED" }

const LOOK_MS = 8000
const POLL_MS = 100
const GIVE_UP = 3

const rec = new Recorder("p06-camera", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p06-camera" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()

let win = null
const windows = []

function track(map, name, v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return
  let s = map.get(name)
  if (!s) map.set(name, s = { n: 0, min: v, max: v, last: v })
  s.n++
  s.last = v
  s.min = Math.min(s.min, v)
  s.max = Math.max(s.max, v)
}

sim.watch(VARS, {
  period: "frame",
  label: "camera variables",
  onChange: (name, v) => {
    if (!win) return
    rec.data("var", `${name} ${fmt(v)}`, { name, value: v })
    track(win.vars, name, v)
  },
})

// CameraGet replies carry no request ID, but each says its own referential.
sim.handle.on("cameraData", (r) => {
  const c = r.cameraData
  const ref = REFERENTIALS[c.positionReferential] ?? `referential ${c.positionReferential}`
  const values = { x: c.position.x, y: c.position.y, z: c.position.z, pitch: c.pbh.pitch, bank: c.pbh.bank, heading: c.pbh.heading, fov: c.fov }
  if (!win) return
  rec.data("cameraGet", ref, { ref, rotationReferential: c.rotationReferential, ...values })
  win.replies.set(ref, (win.replies.get(ref) ?? 0) + 1)
  for (const [k, v] of Object.entries(values)) track(win.cameraGet, `${ref} ${k}`, v)
})
let status = null
sim.handle.on("cameraStatus", (s) => {
  status = ACQUIRED[s.acquiredState] ?? `state ${s.acquiredState}`
  rec.log("status", `camera ${status}`, { acquiredState: s.acquiredState })
})

// A referential that keeps raising exceptions stops being asked, so a call the
// sim refuses doesn't print a line every 100ms.
const failures = new Map()
rec.onRecord((x) => {
  if (x.kind !== "exception" || typeof x.sent !== "string" || !x.sent.startsWith("camera get ")) return
  failures.set(x.sent, (failures.get(x.sent) ?? 0) + 1)
})

async function look(name) {
  status = null
  sim.send("camera get status", () => sim.handle.cameraGetStatus())
  win = { name, vars: new Map(), cameraGet: new Map(), replies: new Map() }
  const v = await sim.read(VARS, { timeoutMs: 1500 })
  for (const [n, x] of v) track(win.vars, n, x)
  beep(1000, 100)
  const t0 = Date.now()
  while (Date.now() - t0 < LOOK_MS) {
    for (const [ref, label] of Object.entries(REFERENTIALS)) {
      const sent = `camera get ${label}`
      if ((failures.get(sent) ?? 0) < GIVE_UP) sim.send(sent, () => sim.handle.cameraGet(Number(ref)))
    }
    await sleep(POLL_MS)
  }
  beep(500, 600)
  await sleep(300)
  const w = win
  win = null
  w.status = status
  w.failures = new Map([...failures].map(([k, n]) => [k.replace("camera get ", ""), n]))
  failures.clear()
  windows.push(w)
  rec.log("look", windowText(w).replace(/\n\s+/g, " · "), { window: name })
}

const deg = (r) => (r * 180) / Math.PI
const range = (s, f = (x) => x) => (s.min === s.max ? fmt(f(s.min)) : `${fmt(f(s.min))}..${fmt(f(s.max))}`)

function windowText(w) {
  const vars = [...w.vars].map(([n, s]) => `${n} ${n.startsWith("CAMERA GAMEPLAY") ? `${range(s, deg)}°` : range(s)}${s.n > 1 ? ` (${plural(s.n - 1, "change")})` : ""}`)
  const refs = Object.values(REFERENTIALS).map((ref) => {
    const n = w.replies.get(ref) ?? 0
    const failed = w.failures.get(ref)
    if (!n) return `${ref}: no reply${failed ? `, ${plural(failed, "exception")}` : ""}`
    const fields = ["pitch", "bank", "heading", "x", "y", "z", "fov"].map((k) => w.cameraGet.get(`${ref} ${k}`)).map((s, i) => s && `${["pitch", "bank", "heading", "x", "y", "z", "fov"][i]} ${range(s)}`).filter(Boolean)
    return `${ref}: ${plural(n, "reply", "replies")}, ${fields.join(", ")}`
  })
  return [
    `${w.name}: camera ${w.status ?? "status not received"}`,
    `    variables: ${vars.join("; ")}`,
    ...refs.map((r) => `    CameraGet ${r}`),
  ].join("\n")
}

async function ask(heading, instruction) {
  console.log(`\n▶ ${heading}\n  ${instruction}\n  ${START} to start, ${SKIP} to skip.`)
  const k = await keys.next()
  rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
  return k.key === "START"
}

process.on("SIGINT", async () => {
  rec.log("stop", "Ctrl+C: writing the report")
  await finish()
  process.exit(0)
})

console.log("\nBefore you start: seated in the cockpit, with ChasePlane on. About 30s.")

if (await ask("ChasePlane on", `Press Page Down, then look hard left, right, up, and down until the long low beep, ${LOOK_MS / 1000}s.`)) await look("ChasePlane on")
if (await ask("ChasePlane off (optional)", `Disable ChasePlane in its settings, press Page Down, then look around the same way, ${LOOK_MS / 1000}s. ${SKIP} skips this.`)) await look("ChasePlane off")

await finish()
process.exit(0)

async function finish() {
  const counted = new Map()
  for (const e of rec.timeline.filter((x) => x.kind === "exception")) counted.set(e.text, (counted.get(e.text) ?? 0) + 1)
  const text = [
    "p06 · Where the pilot looks: the sim's camera variables, ChasePlane's L: variables, and SimConnect_CameraGet, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    "",
    ...(windows.length ? windows.map((w) => `  ${windowText(w)}`) : ["  not run"]),
    "",
    `Exceptions: ${counted.size ? "" : "none"}`,
    ...[...counted].map(([e, n]) => `  ${n} × ${e}`),
  ].join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
}
