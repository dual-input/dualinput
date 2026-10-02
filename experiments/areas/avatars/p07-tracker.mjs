/*
 * p07: whether a head tracker's movement shows in SimConnect_CameraGet, and
 * what the axes and unit of its aircraft-relative position are, on MSFS 2024.
 *
 * In p06, SimConnect_CameraGet reported where the pilot looked with the mouse,
 * with ChasePlane on and off, and its SIMOBJECT position moved 0.02 to 0.04 in
 * an unknown unit (record/areas/avatars/log.md, 2026-10-03). ChasePlane mixes
 * head tracking into the pose it gives the camera: CP.dll logs tobii_raw,
 * applied_pose, and output_pose (read in p42-util-chaseplane 26.39.1). Whether
 * the sim's own camera, with ChasePlane off, includes the tracker is unknown.
 *
 * Its WORLD referential gives the camera's latitude, longitude, and altitude
 * in meters (p06), so the probe works out where the camera is in meters from
 * the aircraft's reference point, forward, right, and up, and fits the
 * SIMOBJECT and EYEPOINT positions against those.
 *
 * About a minute, seated, with the Tobii tracking you and your hand off the
 * mouse. For ChasePlane on, then off, press Page Down and at each short beep:
 *
 *   turn       turn your head left, right, up, and down (5s)
 *   side       lean left and right (4s)
 *   fore-aft   lean forward and back (4s)
 *   up-down    rise up and sink down in the seat (4s)
 *
 * The probe never calls SimConnect_CameraAcquire, so ChasePlane keeps the
 * camera.
 *
 *   node experiments/areas/avatars/p07-tracker.mjs
 *
 * Output: one line per step on the console, every reading in
 * experiments/areas/avatars/results/p07-tracker-<time>.ndjson, and the report
 * in the .txt beside it.
 */

import { execFileSync } from "node:child_process"

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { Recorder, fmt, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { toBody } from "./lib/pose.mjs"

const USER = 0
const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const VARS = [
  ["CAMERA GAMEPLAY PITCH YAW:0", "radians"], ["CAMERA GAMEPLAY PITCH YAW:1", "radians"],
  ["L:p42_cp_r_x", "number"], ["L:p42_cp_r_y", "number"], ["L:p42_cp_r_z", "number"],
  ["L:p42_cp_r_pitch", "number"], ["L:p42_cp_r_yaw", "number"],
]

// SimConnect.h: SIMCONNECT_POSITION_REFERENTIAL and SIMCONNECT_CAMERA_ACQUIRED_STATE.
const REFS = { 1: "SIMOBJECT", 2: "WORLD", 3: "EYEPOINT" }
const ACQUIRED = { 0: "NOT_ACQUIRED", 1: "ACQUIRED", 2: "ACQUIRED_BY_OTHER", 3: "USER_DISABLED" }

// p06 found the field SimConnect.h names Bank carrying the yaw, and Heading
// the roll (record/areas/avatars/log.md, 2026-10-03).
const angles = (pbh) => ({ pitch: pbh.pitch, yaw: pbh.bank, roll: pbh.heading })

const PHASES = [["turn", 5000], ["side", 4000], ["fore-aft", 4000], ["up-down", 4000]]
const POLL_MS = 50
const FT = 0.3048

function tobiiProcesses() {
  try {
    const names = execFileSync("tasklist", ["/fo", "csv", "/nh"], { encoding: "utf8" }).split(/\r?\n/).map((l) => l.split('","')[0].replace(/^"/, ""))
    return [...new Set(names.filter((n) => /tobii/i.test(n)))].join(", ") || "none"
  } catch {
    return "unknown"
  }
}

const rec = new Recorder("p07-tracker", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p07-tracker" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()
const tobii = tobiiProcesses()
rec.log("setup", `Tobii processes: ${tobii}`, { tobii })

// ------------------------------------------------ readings

let win = null
let phase = null
let aircraft = null
const latestVars = new Map()
const pending = {}

sim.watch(VARS, {
  period: "frame",
  label: "camera variables",
  onChange: (name, v) => {
    latestVars.set(name, v)
    if (win) rec.data("var", `${name} ${fmt(v)}`, { name, value: v, phase })
  },
})

// Each poll asks SIMOBJECT, WORLD, then EYEPOINT, and the replies come back in
// order, so an EYEPOINT reply closes a set of three taken together.
sim.handle.on("cameraData", (r) => {
  const c = r.cameraData
  const ref = REFS[c.positionReferential] ?? `referential ${c.positionReferential}`
  pending[ref] = { x: c.position.x, y: c.position.y, z: c.position.z, ...angles(c.pbh) }
  if (ref !== "EYEPOINT" || !win) return
  const s = { t: Date.now(), phase, sim: pending.SIMOBJECT, world: pending.WORLD, eye: pending.EYEPOINT }
  for (const k of Object.keys(pending)) delete pending[k]
  if (!s.sim || !s.world || !s.eye) return
  if (aircraft) s.body = toBody(aircraft, { lat: s.world.x, lon: s.world.y, alt: s.world.z / FT })
  s.gameplay = { pitch: latestVars.get("CAMERA GAMEPLAY PITCH YAW:0"), yaw: latestVars.get("CAMERA GAMEPLAY PITCH YAW:1") }
  s.cp = { x: latestVars.get("L:p42_cp_r_x"), y: latestVars.get("L:p42_cp_r_y"), z: latestVars.get("L:p42_cp_r_z") }
  win.samples.push(s)
  rec.data("camera", phase ?? "", s)
})
let status = null
sim.handle.on("cameraStatus", (s) => { status = ACQUIRED[s.acquiredState] ?? `state ${s.acquiredState}` })

// ------------------------------------------------ analysis

const stats = (xs) => {
  const v = xs.filter(Number.isFinite)
  return v.length ? { min: Math.min(...v), max: Math.max(...v), span: Math.max(...v) - Math.min(...v) } : null
}

function fit(pairs) {
  const p = pairs.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
  const n = p.length
  if (n < 10) return null
  const ma = p.reduce((s, [a]) => s + a, 0) / n
  const mb = p.reduce((s, [, b]) => s + b, 0) / n
  let sab = 0, saa = 0, sbb = 0
  for (const [a, b] of p) { sab += (a - ma) * (b - mb); saa += (a - ma) ** 2; sbb += (b - mb) ** 2 }
  if (saa === 0 || sbb === 0) return null
  return { r: sab / Math.sqrt(saa * sbb), slope: sab / sbb, n }
}

const BODY = ["forward", "right", "up"]

// For each axis of a position, the body axis it follows best, with the slope:
// near ±1 means meters, near ±3.28 feet.
function mapping(samples, get) {
  return ["x", "y", "z"].map((axis) => {
    const fits = BODY.map((b) => ({ b, f: fit(samples.map((s) => [get(s)?.[axis], s.body?.[b]])) })).filter((x) => x.f)
    if (!fits.length) return `${axis}: no fit`
    const best = fits.sort((a, c) => Math.abs(c.f.r) - Math.abs(a.f.r))[0]
    return `${axis} follows ${best.b} (r ${best.f.r.toFixed(3)}, ${fmt(best.f.slope)} per meter)`
  })
}

function windowText(w) {
  const lines = [`${w.name}: camera ${w.status ?? "status not received"}, ${plural(w.samples.length, "reading")}`]
  for (const [name] of PHASES) {
    const s = w.samples.filter((x) => x.phase === name)
    if (!s.length) continue
    const span = (get) => { const st = stats(s.map(get)); return st ? fmt(st.span) : "—" }
    const deg = (get) => { const st = stats(s.map(get)); return st ? `${st.min.toFixed(1)}..${st.max.toFixed(1)}°` : "—" }
    lines.push(`    ${name}: SIMOBJECT pitch ${deg((x) => x.sim.pitch)}, yaw ${deg((x) => x.sim.yaw)}, roll ${deg((x) => x.sim.roll)}; ` +
      `position spans x ${span((x) => x.sim.x)}, y ${span((x) => x.sim.y)}, z ${span((x) => x.sim.z)}; ` +
      `from WORLD, meters forward ${span((x) => x.body?.forward)}, right ${span((x) => x.body?.right)}, up ${span((x) => x.body?.up)}; ` +
      `EYEPOINT spans x ${span((x) => x.eye.x)}, y ${span((x) => x.eye.y)}, z ${span((x) => x.eye.z)}; ` +
      `gameplay pitch ${deg((x) => (x.gameplay.pitch * 180) / Math.PI)}, yaw ${deg((x) => (x.gameplay.yaw * 180) / Math.PI)}; ` +
      `ChasePlane r spans x ${span((x) => x.cp.x)}, y ${span((x) => x.cp.y)}, z ${span((x) => x.cp.z)}`)
  }
  lines.push(`    SIMOBJECT position: ${mapping(w.samples, (s) => s.sim).join("; ")}`)
  lines.push(`    EYEPOINT position: ${mapping(w.samples, (s) => s.eye).join("; ")}`)
  lines.push(`    ChasePlane L:p42_cp_r_x/y/z: ${mapping(w.samples, (s) => s.cp).join("; ")}`)
  return lines.join("\n")
}

// ------------------------------------------------ steps

async function ask(heading, instruction) {
  console.log(`\n▶ ${heading}\n  ${instruction}\n  ${START} to start, ${SKIP} to skip.`)
  const k = await keys.next()
  rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
  return k.key === "START"
}

const windows = []

async function run(name) {
  const v = await sim.read(POS)
  const [lat, lon, alt, hdg] = POS.map(([n]) => v.get(n))
  aircraft = Number.isFinite(lat) ? { lat, lon, alt, hdg } : null
  status = null
  sim.send("camera get status", () => sim.handle.cameraGetStatus())
  win = { name, samples: [] }
  for (const [p, ms] of PHASES) {
    phase = p
    beep(1000, 100)
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      for (const ref of Object.keys(REFS)) sim.send(`camera get ${REFS[ref]}`, () => sim.handle.cameraGet(Number(ref)))
      await sleep(POLL_MS)
    }
  }
  phase = null
  beep(500, 600)
  await sleep(300)
  const w = win
  win = null
  w.status = status
  windows.push(w)
  rec.log("window", windowText(w).replace(/\n\s+/g, " · "), { window: name })
}

process.on("SIGINT", async () => {
  rec.log("stop", "Ctrl+C: writing the report")
  await finish()
  process.exit(0)
})

const steps = "At each short beep: turn your head left, right, up, and down; then lean left and right; then lean forward and back; then rise up and sink down. Stop at the long low beep, about 17s."
console.log("\nBefore you start: seated in the cockpit, the Tobii tracking you, ChasePlane on, and your hand off the mouse. About a minute.")
if (await ask("ChasePlane on", `Press Page Down. ${steps}`)) await run("ChasePlane on")
if (await ask("ChasePlane off", `Disable ChasePlane in its settings, then press Page Down. ${steps} ${SKIP} skips this.`)) await run("ChasePlane off")

await finish()
process.exit(0)

async function finish() {
  const counted = new Map()
  for (const e of rec.timeline.filter((x) => x.kind === "exception")) counted.set(e.text, (counted.get(e.text) ?? 0) + 1)
  const text = [
    "p07 · A head tracker in SimConnect_CameraGet, and the axes and unit of its position, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    `Tobii processes: ${tobii}`,
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
