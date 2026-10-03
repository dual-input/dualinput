/*
 * p20: the ray through the cursor, fitted to clicks on known spots, and then
 * the hand sphere on the controls the pilot clicks with that fit, on MSFS 2024.
 *
 * p19 cast each click into the A2A Comanche's interior model (a2a-aircraft-pa24
 * 2.1.3) and named the controls of an engine start, but it couldn't tell which
 * field of view was right, because it never knew what the pilot meant to click.
 * Here a small yellow ball marks a known spot, the pilot clicks its center,
 * and the ray's signs, field of view, and any angle offset are fitted to those
 * clicks (lib/pick.mjs). The camera's position is taken as SimConnect_CameraGet
 * gives it in the SIMOBJECT referential, which matched the Comanche's eyepoint
 * within 4mm in p19's run.
 *
 * In the A2A Comanche, parked, the sim in front:
 *
 *   targets   A yellow ball sits on a knob, a switch, or a vent, 10 in turn,
 *             from the left wall across the panel to the right wall and the
 *             overhead. Click the center of each ball; Page Up skips one you
 *             can't see. About a minute.
 *   clicks    Then click any control, as in p19: the console names what each
 *             click hit, and the sphere turns green on it for 2.5s. Page Up
 *             ends; it ends by itself after 20 minutes.
 *
 *   node experiments/areas/avatars/p20-click-calibrate.mjs
 *
 * Nothing touches the pilot's input: clicks are read through Raw Input
 * (experiments/tools/mouse.mjs). A click on a ball also reaches the control
 * under it, so the spots are knobs, light switches, and vents. The probe turns
 * the module off and removes the sphere at the end and on Ctrl+C.
 */

import fs from "node:fs"
import path from "node:path"

import { InitPosition } from "node-simconnect"

import { REPO } from "../../tools/results.mjs"
import { SKIP, startBeeper, startKeys } from "../../tools/guide.mjs"
import { startMouse } from "../../tools/mouse.mjs"
import { findPackage } from "../aircraft/lib/flights.mjs"
import { Recorder, fmt, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { RAD, toBody, wrap } from "./lib/pose.mjs"
import { P19, fitProjection, rayThrough } from "./lib/pick.mjs"
import { cast, loadCockpit } from "./lib/raycast.mjs"

const PACKAGE = "a2a-aircraft-pa24"
const MODEL = ["SimObjects", "Airplanes", "pa24-250", "common", "model", "PA24_250_INTERIOR_LOD00.gltf"]
const MAP = path.join(REPO, "experiments", "sim-sources", "avatars", "controls-pa24-250.json")
const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const SPHERE = "CROSSCHECK_HandSphere"
// From the left wall across the panel to the right wall, then the overhead;
// no starter, gear, fuel, or breaker, since the click reaches the control.
const TARGETS = ["KNOB_CabinVent1", "NoiseCancellingSwitch", "knob_nav_instr_light", "Switch_Light_Strobe", "HSI_Course_Knob", "INSTRUMENT_altitude_knob", "BUTTON_EDM730_Step", "GAUGE_ADF_Knob", "KNOB_CabinVent2", "SWITCH_Light_Red"]
// The ball sits this far in front of the spot, toward the eye, so a knob
// doesn't hide it; the ray to its center is the ray to the spot.
const PULL_M = 0.03
// p15: nose up and right wing down are both negative; lead 1 frame (p16).
const SIGNS = [-1, -1]
const LEAD = 1
const HOLD_MS = 2500
const CAP_MS = 20 * 60_000
const COLOR = { rest: 0, touching: 1, target: 3 }
// tools/sphere.mjs: radius 2cm at scale 1, and SCALE 0 to 100 sweeps the scale
// from 0.5 to 5.
const radius = (scale) => 0.02 * (0.5 + 4.5 * scale / 100)
const SCALE = { target: 0, touching: 5 }
const NEAR_M = 0.04
const L = (n) => [`L:CROSSCHECK_P12_${n}`, "number"]
const SIMOBJECT = 1

const rec = new Recorder("p20-click-calibrate", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p20-click-calibrate" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()
const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); rec.log(kind, text, fields) }
const where = (b) => `${b.forward.toFixed(3)}m forward, ${b.right.toFixed(3)}m right, ${b.up.toFixed(3)}m up`
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const sign = (x) => (x > 0 ? "+" : "−")
const label = (h) => `mirror ${sign(h.mirror)}, yaw ${sign(h.yaw)}, pitch ${sign(h.pitch)}, k ${h.k.toFixed(3)}, yaw bias ${h.yawBias.toFixed(2)}°, pitch bias ${h.pitchBias.toFixed(2)}°`

async function readModule(names) {
  const v = await sim.read(names.map(L), { timeoutMs: 2000 })
  return Object.fromEntries(names.map((n) => [n, v.get(`L:CROSSCHECK_P12_${n}`) ?? null]))
}
const setModule = (values) => { for (const [k, x] of Object.entries(values)) sim.set([L(k)], [x], { label: `set CROSSCHECK_P12_${k}`, quiet: true }) }

let sphere = null
let stopMouse = null
let finished = false
async function finish(why) {
  if (finished) return
  finished = true
  if (stopMouse) stopMouse()
  setModule({ MODE: 0, OBJECT: 0, LEAD: 0 })
  if (sphere !== null) sim.remove(sphere)
  await sleep(800)
  const text = [
    "p20 · The ray through the cursor fitted to clicks on known spots, and the hand sphere on clicked controls with it, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    `Ended by ${why}`,
    "",
    ...lines.map((l) => `  ${l}`),
  ].join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
  process.exit(0)
}
process.on("SIGINT", () => finish("Ctrl+C"))

// ------------------------------------------------ setup

if (!fs.existsSync(MAP)) {
  console.error(`No control map at ${MAP}: run tools/controls.mjs first (see its header).`)
  process.exit(1)
}
const map = JSON.parse(fs.readFileSync(MAP, "utf8"))
const byNode = new Map()
for (const c of map.controls) if (!byNode.has(c.node.toLowerCase())) byNode.set(c.node.toLowerCase(), c)
const pkg = findPackage(PACKAGE)
if (!pkg) { console.error(`${PACKAGE} isn't installed.`); process.exit(1) }
const cockpit = loadCockpit([path.join(pkg, ...MODEL)])
note("model", `${MODEL.at(-1)}: ${plural(cockpit.triangles, "triangle")}; map ${plural(map.controls.length, "control")}`)

await sleep(1000)
const m0 = await readModule(["ALIVE"])
await sleep(500)
const m1 = await readModule(["ALIVE"])
if (!(m0.ALIVE !== null && m1.ALIVE > m0.ALIVE)) { note("module", "crosscheck-p12-follow isn't running"); await finish("no module") }
const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
const speed = await sim.readOne("GROUND VELOCITY", "knots")
note("setup", `aircraft TITLE ${JSON.stringify(title)}, ${fmt(speed)} kt`)
if (speed > 1) { note("calibrate", "moving: start the probe parked in the Comanche"); await finish("no calibration") }

// ------------------------------------------------ the camera

let cam = null
sim.handle.on("cameraData", (r) => {
  const c = r.cameraData
  if (c.positionReferential !== SIMOBJECT) return
  cam = { t: Date.now(), x: c.position.x, y: c.position.y, z: c.position.z, pitch: c.pbh.pitch, yaw: c.pbh.bank, roll: c.pbh.heading, fov: c.fov > Math.PI ? c.fov * RAD : c.fov }
})
const poll = setInterval(() => sim.send("camera get", () => sim.handle.cameraGet(SIMOBJECT)), 30)

// ------------------------------------------------ calibrate

// Parked, the seat objects' readings hold no motion (p08, p09).
const ac = await sim.read(POS)
const aircraft = Object.fromEntries([["lat", "PLANE LATITUDE"], ["lon", "PLANE LONGITUDE"], ["alt", "PLANE ALTITUDE"], ["hdg", "PLANE HEADING DEGREES TRUE"]].map(([k, n]) => [k, ac.get(n)]))
const seatBody = {}
for (const id of await sim.byType(1, 50, { timeoutMs: 2000 })) {
  const t = (await sim.readStrings(["TITLE"], { object: id })).get("TITLE") ?? ""
  const key = /^SEAT_.*_Pilot$/i.test(t) ? "PILOT_1" : /^SEAT_.*_Copilot$/i.test(t) ? "PILOT_2" : null
  if (!key) continue
  const reads = []
  for (let i = 0; i < 10; i++) {
    const v = await sim.read(POS, { object: id })
    reads.push(toBody(aircraft, { lat: v.get("PLANE LATITUDE"), lon: v.get("PLANE LONGITUDE"), alt: v.get("PLANE ALTITUDE") }))
    await sleep(50)
  }
  seatBody[key] = { forward: median(reads.map((r) => r.forward)), right: median(reads.map((r) => r.right)), up: median(reads.map((r) => r.up)) }
}
// Model space to the aircraft's frame: forward = z, right = -x, up = y (p18),
// plus the offset the seats give.
const toFrame = (p) => ({ forward: p[2], right: -p[0], up: p[1] })
const diffs = Object.keys(seatBody).filter((k) => map.seats[k]).map((k) => { const f = toFrame(map.seats[k].origin); return { forward: seatBody[k].forward - f.forward, right: seatBody[k].right - f.right, up: seatBody[k].up - f.up } })
const offset = diffs.length
  ? { forward: diffs.reduce((s, d) => s + d.forward, 0) / diffs.length, right: diffs.reduce((s, d) => s + d.right, 0) / diffs.length, up: diffs.reduce((s, d) => s + d.up, 0) / diffs.length }
  : { forward: 0, right: 0, up: 0 }
note("calibrate", diffs.length ? `the seats put the model's origin ${where(offset)} of SimConnect's reference point` : "no seat objects: the model's origin taken as SimConnect's reference point", { seatBody, offset })
const modelToFrame = (p) => ({ forward: p[2] + offset.forward, right: -p[0] + offset.right, up: p[1] + offset.up })
const frameToModel = (b) => [-(b.right - offset.right), b.up - offset.up, b.forward - offset.forward]
// The camera's SIMOBJECT position is in the aircraft's frame already.
const camModel = (c) => frameToModel({ forward: c.z, right: -c.x, up: c.y })
for (let i = 0; i < 40 && !cam; i++) await sleep(50)
if (!cam) { note("camera", "SimConnect_CameraGet didn't answer"); await finish("no camera") }
note("camera", `at ${where({ forward: cam.z, right: -cam.x, up: cam.y })} of the reference point, fov ${fmt(cam.fov)} rad`, { cam })

const pilot = seatBody.PILOT_1 ?? modelToFrame(map.seats.PILOT_1?.origin ?? [0.3, -0.13, 0.12])
const rest = { forward: pilot.forward + 0.35, right: pilot.right, up: pilot.up + 0.25 }

// ------------------------------------------------ the sphere

const v0 = await sim.read(POS)
const init = new InitPosition()
Object.assign(init, { latitude: v0.get("PLANE LATITUDE"), longitude: v0.get("PLANE LONGITUDE"), altitude: v0.get("PLANE ALTITUDE"), pitch: 0, bank: 0, heading: wrap(v0.get("PLANE HEADING DEGREES TRUE")), onGround: false, airspeed: 0 })
const r = await sim.spawn(SPHERE, "", init)
if (r.id === undefined) { note("sphere", `${SPHERE}: not created: ${r.error}`); await finish("a failed spawn") }
sphere = r.id
for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
setModule({ OBJECT: r.id, SIGN_PITCH: SIGNS[0], SIGN_BANK: SIGNS[1], LEAD, SCALE: SCALE.touching, COLOR: COLOR.rest, FWD: rest.forward, RIGHT: rest.right, UP: rest.up, MODE: 1 })

// Clicks and Page Up go to whichever phase is listening.
let onClick = null
let outside = 0
stopMouse = await startMouse((m) => {
  if (m.kind !== "left" && m.kind !== "wheel") return
  if (!m.foreground) { if (m.kind === "left") outside++; return }
  if (onClick) onClick(m)
})
let onSkip = null
keys.listen((k) => { if (k.key === "SKIP" && onSkip) onSkip() })

// ------------------------------------------------ targets

console.log(`\n▶ Click the yellow balls\n  A small yellow ball sits on a spot in the cockpit, ${TARGETS.length} in turn. Click its center. ${SKIP} skips one you can't see.`)
const samples = []
for (const [i, id] of TARGETS.entries()) {
  const c = map.controls.find((x) => x.id === id)
  if (!c) { note("target", `${id}: not in the map`); continue }
  const spot = c.center ?? c.origin
  const eye = camModel(cam)
  const w = eye.map((x, k) => x - spot[k])
  const n = Math.hypot(...w)
  const ball = spot.map((x, k) => x + (w[k] / n) * PULL_M)
  const f = modelToFrame(ball)
  setModule({ FWD: f.forward, RIGHT: f.right, UP: f.up, COLOR: COLOR.target, SCALE: SCALE.target })
  console.log(`  ${i + 1}/${TARGETS.length}: ${id}`)
  beep(1000, 80)
  const got = await new Promise((resolve) => {
    onClick = (m) => { if (m.kind === "left") resolve(m) }
    onSkip = () => resolve(null)
  })
  onClick = null
  onSkip = null
  if (!got) { rec.log("target", `${id}: skipped`); continue }
  const s = { id, cam, mouse: got, origin: camModel(cam), target: ball }
  samples.push(s)
  rec.log("target", `${id}: clicked at ${got.x}, ${got.y}, camera pitch ${fmt(cam.pitch)}, yaw ${fmt(cam.yaw)}, roll ${fmt(cam.roll)}`, s)
}
beep(500, 400)

// ------------------------------------------------ the fit

let params = P19
if (samples.length >= 4) {
  const fit = fitProjection(samples)
  params = fit.params
  const half = Math.tan(samples[0].cam.fov / 2) * params.k
  const aspect = samples[0].mouse.width / samples[0].mouse.height
  const cm = (s, deg) => (Math.hypot(...s.target.map((x, k) => x - s.origin[k])) * Math.tan(deg * RAD) * 100).toFixed(1)
  note("fit", `${label(params)}: RMS ${fit.rms.toFixed(2)}° over ${plural(samples.length, "click")}, so the view is ${(2 * Math.atan(half) / RAD).toFixed(1)}° wide and ${(2 * Math.atan(half / aspect) / RAD).toFixed(1)}° tall in a ${samples[0].mouse.width}×${samples[0].mouse.height} window, and CameraGet's fov is ${(samples[0].cam.fov / RAD).toFixed(1)}°`, { fit: { params, rms: fit.rms, errors: fit.errors, runnerUp: fit.runnerUp } })
  note("fit", `per spot, off by: ${samples.map((s, i) => `${s.id} ${fit.errors[i].toFixed(2)}° (${cm(s, fit.errors[i])}cm)`).join(", ")}`)
  note("fit", `the next best signs, ${label(fit.runnerUp.params)}, RMS ${fit.runnerUp.rms.toFixed(2)}°; p19's ray, RMS ${fit.p19.rms.toFixed(2)}°, off by ${samples.map((s, i) => `${cm(s, fit.p19.errors[i])}cm`).join(", ")}`)
} else {
  note("fit", `${plural(samples.length, "click")} on spots: too few to fit, so the clicks use p19's ray`)
}

// ------------------------------------------------ clicks

// What a hit touched: the mapped control on its node or a parent, or the
// nearest mapped control within NEAR_M, or only the node it hit.
function identify(hit) {
  if (!hit) return { name: null, how: null }
  for (const n of hit.chain) { const c = byNode.get(n.toLowerCase()); if (c) return { name: c.id, how: "on", node: hit.chain[0] } }
  let near = null, nd = NEAR_M
  for (const c of map.controls) {
    const p = c.center ?? c.origin
    const d = Math.hypot(p[0] - hit.point[0], p[1] - hit.point[1], p[2] - hit.point[2])
    if (d < nd) { nd = d; near = c }
  }
  if (near) return { name: near.id, how: "near", node: hit.chain[0], distance: nd }
  return { name: hit.chain[0] ?? "an unnamed node", how: "unmapped", node: hit.chain[0] }
}

setModule({ FWD: rest.forward, RIGHT: rest.right, UP: rest.up, COLOR: COLOR.rest, SCALE: SCALE.touching })
let holdUntil = 0
let lastWheel = 0
const touched = new Map()
let clicks = 0
onClick = (m) => {
  const burst = m.kind === "wheel" && m.t - lastWheel < 600
  if (m.kind === "wheel") lastWheel = m.t
  const c = cam
  if (!c || m.t - c.t > 500) return
  const origin = camModel(c)
  const dir = rayThrough(c, m, params)
  const hit = cast(cockpit, origin, dir)
  const res = identify(hit)
  if (!burst) {
    clicks++
    touched.set(res.name ?? "nothing", (touched.get(res.name ?? "nothing") ?? 0) + 1)
    rec.log("touch", `${m.kind} at ${m.x}, ${m.y}: ${res.name ?? "nothing"} (${res.how ?? "no hit"}${res.node && res.how !== "on" ? `, hit ${res.node}` : ""})`, { mouse: m, cam: c, origin, dir, hit: hit && { point: hit.point, distance: hit.distance, chain: hit.chain }, res })
    console.log(`  ${m.kind === "left" ? "click" : "wheel"}: ${res.name ?? "nothing"}${res.how === "near" ? ` (near, hit ${res.node})` : res.how === "unmapped" ? " (not a mapped control)" : ""}`)
  }
  if (!hit) return
  const n = Math.hypot(...dir)
  const p = hit.point.map((x, k) => x - (dir[k] / n) * radius(SCALE.touching))
  const f = modelToFrame(p)
  setModule({ FWD: f.forward, RIGHT: f.right, UP: f.up, COLOR: COLOR.touching })
  holdUntil = Date.now() + HOLD_MS
}
const tick = setInterval(() => {
  if (holdUntil && Date.now() > holdUntil) {
    holdUntil = 0
    setModule({ FWD: rest.forward, RIGHT: rest.right, UP: rest.up, COLOR: COLOR.rest })
  }
}, 50)
console.log(`\n▶ Click the Comanche's controls\n  The console names what each click hit, and the sphere turns green on it for ${HOLD_MS / 1000}s. ${SKIP} ends.`)
beep(1000, 100)
const why = await new Promise((resolve) => {
  onSkip = () => resolve("Page Up")
  setTimeout(() => resolve("the 20-minute cap"), CAP_MS)
})
clearInterval(tick)
clearInterval(poll)
note("clicks", `${plural(clicks, "touch", "touches")} in the sim, ${plural(outside, "click")} outside it: ${[...touched].map(([n, c]) => `${n}${c > 1 ? ` ×${c}` : ""}`).join(", ")}`)
await finish(why)
