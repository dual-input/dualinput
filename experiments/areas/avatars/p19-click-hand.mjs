/*
 * p19: whether the hand sphere lands on the control the pilot clicks, found by
 * casting the click's ray into the cockpit model ourselves, on MSFS 2024.
 *
 * p18 picked the control by the input event that changed, and no name in the
 * A2A Comanche's behavior XML matched the sim's list. This probe uses no names:
 * at each press or wheel turn in the sim window, the ray from the camera
 * through the cursor meets the interior model (a2a-aircraft-pa24 2.1.3,
 * PA24_250_INTERIOR_LOD00.gltf), and the hit point is where the hand goes.
 *
 * The camera comes from SimConnect_CameraGet in the SIMOBJECT referential:
 * meters from the aircraft with x left, y up, and z forward (p07), the model's
 * own axes (p18). Its angle signs and whether its field of view is vertical or
 * horizontal aren't settled: p17's ray, built on the WORLD referential, came
 * out mirrored. So every press is cast under all 16 combinations of screen
 * mirror, yaw sign, pitch sign, and field of view, and the sphere follows the
 * combination that has named a mapped control (tools/controls.mjs) most
 * often. The first few presses may miss while it settles.
 *
 * In the A2A Comanche, parked at first, the sim in front:
 *
 *   calibrate   Runs on its own, parked: about 3s.
 *   clicks      Click switches, breakers, and buttons, and turn knobs with the
 *               wheel, parked and then in flight if you like. The console names
 *               what each press hit, and the sphere turns green on it for 2.5s.
 *               Page Up ends; it ends by itself after 20 minutes.
 *
 *   node experiments/areas/avatars/p19-click-hand.mjs
 *
 * Nothing touches the pilot's input: presses are read through Raw Input
 * (experiments/tools/mouse.mjs), and the sim gets them as before. The probe
 * turns the module off and removes the sphere at the end and on Ctrl+C.
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
import { cast, loadCockpit } from "./lib/raycast.mjs"

const PACKAGE = "a2a-aircraft-pa24"
const MODEL = ["SimObjects", "Airplanes", "pa24-250", "common", "model", "PA24_250_INTERIOR_LOD00.gltf"]
const MAP = path.join(REPO, "experiments", "sim-sources", "avatars", "controls-pa24-250.json")
const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const SPHERE = "CROSSCHECK_HandSphere"
// p15: nose up and right wing down are both negative; lead 1 frame (p16).
const SIGNS = [-1, -1]
const LEAD = 1
const HOLD_MS = 2500
const CAP_MS = 20 * 60_000
const COLOR = { rest: 0, touching: 1 }
// tools/sphere.mjs: radius 2cm at scale 1, and SCALE 0 to 100 sweeps the scale
// from 0.5 to 5, so 5 gives a 1.45cm radius.
const SCALE = 5
const RADIUS_M = 0.02 * (0.5 + 4.5 * SCALE / 100)
// A hit this close to a mapped control's center names it, for controls set
// into the panel, which a ray meets on the panel's face first.
const NEAR_M = 0.04
// A wheel turn this soon after the last one is the same touch.
const WHEEL_BURST_MS = 600
const L = (n) => [`L:CROSSCHECK_P12_${n}`, "number"]
// SimConnect.h: SIMCONNECT_POSITION_REFERENTIAL.
const SIMOBJECT = 1, WORLD = 2
const FT = 0.3048

const rec = new Recorder("p19-click-hand", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p19-click-hand" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()
const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); rec.log(kind, text, fields) }
const where = (b) => `${b.forward.toFixed(3)}m forward, ${b.right.toFixed(3)}m right, ${b.up.toFixed(3)}m up`
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]

async function readModule(names) {
  const v = await sim.read(names.map(L), { timeoutMs: 2000 })
  return Object.fromEntries(names.map((n) => [n, v.get(`L:CROSSCHECK_P12_${n}`) ?? null]))
}
const setModule = (values) => { for (const [k, x] of Object.entries(values)) sim.set([L(k)], [x], { label: `set CROSSCHECK_P12_${k}`, quiet: true }) }

// ------------------------------------------------ the 16 combinations

// The first is our best guess: the screen's right is the model's -x, and p17's
// sign step, in the WORLD referential, read looking up as +pitch and looking
// right as -yaw.
const HYP = []
for (const mirror of [1, -1]) for (const yaw of [-1, 1]) for (const pitch of [1, -1]) for (const fovH of [0, 1]) {
  HYP.push({ mirror, yaw, pitch, fovH, label: `mirror ${mirror > 0 ? "+" : "−"}, yaw ${yaw > 0 ? "+" : "−"}, pitch ${pitch > 0 ? "+" : "−"}, fov ${fovH ? "horizontal" : "vertical"}`, named: 0 })
}
const best = () => HYP.reduce((b, h) => (h.named > b.named ? h : b), HYP[0])

// The ray through the cursor in the model's space. The camera's angles are in
// degrees, with p06's fields: yaw in SimConnect's Bank, roll in its Heading.
// Roll is left out: it stays near 0 unless the pilot leans with a tracker (p07).
// p17 read the field of view in radians through fsCameraGet (0.859); a value
// above pi from SimConnect can only be degrees.
function ray(cam, m, h) {
  const half = Math.tan((cam.fov > Math.PI ? cam.fov * RAD : cam.fov) / 2)
  const aspect = m.width / m.height
  const tv = h.fovH ? half / aspect : half
  const th = h.fovH ? half : half * aspect
  let f = 1, r = h.mirror * m.x * th, u = m.y * tv
  const p = h.pitch * cam.pitch * RAD
  ;[f, u] = [f * Math.cos(p) - u * Math.sin(p), f * Math.sin(p) + u * Math.cos(p)]
  const y = h.yaw * cam.yaw * RAD
  ;[f, r] = [f * Math.cos(y) - r * Math.sin(y), f * Math.sin(y) + r * Math.cos(y)]
  return [-r, u, f]
}

let sphere = null
let stopMouse = null
let finished = false
const touches = []
async function finish(why) {
  if (finished) return
  finished = true
  if (stopMouse) stopMouse()
  setModule({ MODE: 0, OBJECT: 0, LEAD: 0 })
  if (sphere !== null) sim.remove(sphere)
  await sleep(800)
  if (touches.length) {
    const b = best()
    const ranked = [...HYP].sort((x, y) => y.named - x.named)
    note("combinations", `named a mapped control, of ${plural(touches.length, "touch", "touches")}: ${ranked.slice(0, 6).map((h) => `${h.named} with ${h.label}`).join("; ")}; the other ${ranked.length - 6} at most ${ranked[6].named}`)
    const counts = new Map()
    for (const t of touches) { const r = t.results[HYP.indexOf(b)]; const k = r.name ?? "nothing"; counts.set(k, (counts.get(k) ?? 0) + 1) }
    note("touched", `with ${b.label}: ${[...counts].map(([n, c]) => `${n}${c > 1 ? ` ×${c}` : ""}`).join(", ")}`)
  }
  const text = [
    "p19 · The hand sphere on the control the pilot clicks, by casting the click's ray into the cockpit model, on MSFS 2024",
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
const t0 = Date.now()
const cockpit = loadCockpit([path.join(pkg, ...MODEL)])
note("model", `${MODEL.at(-1)}: ${plural(cockpit.prims.length, "primitive")}, ${plural(cockpit.triangles, "triangle")}, read in ${Date.now() - t0}ms; map ${plural(map.controls.length, "control")}`)

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
const worldCams = []
sim.handle.on("cameraData", (r) => {
  const c = r.cameraData
  const a = { pitch: c.pbh.pitch, yaw: c.pbh.bank, roll: c.pbh.heading, fov: c.fov }
  if (c.positionReferential === SIMOBJECT) cam = { t: Date.now(), x: c.position.x, y: c.position.y, z: c.position.z, ...a }
  else if (c.positionReferential === WORLD) worldCams.push({ cam, world: { lat: c.position.x, lon: c.position.y, alt: c.position.z / FT } })
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
  seatBody[key] = { title: t, forward: median(reads.map((r) => r.forward)), right: median(reads.map((r) => r.right)), up: median(reads.map((r) => r.up)) }
}
// Model space to the aircraft's frame: forward = z, right = -x, up = y (p18),
// plus the offset the seats give.
const toFrame = (p) => ({ forward: p[2], right: -p[0], up: p[1] })
const pairs = Object.keys(seatBody).filter((k) => map.seats[k])
const diffs = pairs.map((k) => { const f = toFrame(map.seats[k].origin); return { forward: seatBody[k].forward - f.forward, right: seatBody[k].right - f.right, up: seatBody[k].up - f.up } })
const offset = diffs.length
  ? { forward: diffs.reduce((s, d) => s + d.forward, 0) / diffs.length, right: diffs.reduce((s, d) => s + d.right, 0) / diffs.length, up: diffs.reduce((s, d) => s + d.up, 0) / diffs.length }
  : { forward: 0, right: 0, up: 0 }
note("calibrate", diffs.length ? `the seats put the model's origin ${where(offset)} of SimConnect's reference point` : "no seat objects: the model's origin taken as SimConnect's reference point", { seatBody, offset })
const modelToFrame = (p) => ({ forward: p[2] + offset.forward, right: -p[0] + offset.right, up: p[1] + offset.up })
const frameToModel = (b) => [-(b.right - offset.right), b.up - offset.up, b.forward - offset.forward]

// The camera's SIMOBJECT position against its WORLD one, worked out from the
// aircraft's position, both in the aircraft's frame.
for (let i = 0; i < 10; i++) { sim.send("camera get world", () => sim.handle.cameraGet(WORLD)); await sleep(60) }
await sleep(300)
const pairsCam = worldCams.filter((w) => w.cam)
const camFrame = (c) => ({ forward: c.z, right: -c.x, up: c.y })
let camFix = { forward: 0, right: 0, up: 0 }
if (pairsCam.length) {
  const ds = pairsCam.map((w) => { const a = toBody(aircraft, w.world), b = camFrame(w.cam); return { forward: a.forward - b.forward, right: a.right - b.right, up: a.up - b.up } })
  camFix = { forward: median(ds.map((d) => d.forward)), right: median(ds.map((d) => d.right)), up: median(ds.map((d) => d.up)) }
}
if (!cam) { note("camera", "SimConnect_CameraGet didn't answer"); await finish("no camera") }
note("camera", `SIMOBJECT at ${where(camFrame(cam))}, fov ${fmt(cam.fov)} rad; the WORLD position is ${where(camFix)} from it, over ${plural(pairsCam.length, "pair")}`, { cam, camFix })
const camModel = (c) => { const b = camFrame(c); return frameToModel({ forward: b.forward + camFix.forward, right: b.right + camFix.right, up: b.up + camFix.up }) }

// At rest: 0.35m in front of the pilot's seat and 0.25m up.
const pilot = seatBody.PILOT_1 ?? seatBody.PILOT_2 ?? modelToFrame([0.3, -0.13, 0.12])
const rest = { forward: pilot.forward + 0.35, right: pilot.right, up: pilot.up + 0.25 }

// ------------------------------------------------ the sphere

const v0 = await sim.read(POS)
const init = new InitPosition()
Object.assign(init, { latitude: v0.get("PLANE LATITUDE"), longitude: v0.get("PLANE LONGITUDE"), altitude: v0.get("PLANE ALTITUDE"), pitch: 0, bank: 0, heading: wrap(v0.get("PLANE HEADING DEGREES TRUE")), onGround: false, airspeed: 0 })
const r = await sim.spawn(SPHERE, "", init)
if (r.id === undefined) { note("sphere", `${SPHERE}: not created: ${r.error}`); await finish("a failed spawn") }
sphere = r.id
for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
setModule({ OBJECT: r.id, SIGN_PITCH: SIGNS[0], SIGN_BANK: SIGNS[1], LEAD, SCALE, COLOR: COLOR.rest, FWD: rest.forward, RIGHT: rest.right, UP: rest.up, MODE: 1 })

// ------------------------------------------------ the presses

// What a hit touched: the mapped control on its node or a parent, or the
// nearest mapped control within NEAR_M, or only the node it hit.
function identify(hit) {
  if (!hit) return { name: null, control: null }
  for (const n of hit.chain) { const c = byNode.get(n.toLowerCase()); if (c) return { name: c.id, control: c, node: hit.chain[0], how: "on" } }
  let near = null, nd = NEAR_M
  for (const c of map.controls) {
    const p = c.center ?? c.origin
    const d = Math.hypot(p[0] - hit.point[0], p[1] - hit.point[1], p[2] - hit.point[2])
    if (d < nd) { nd = d; near = c }
  }
  if (near) return { name: near.id, control: near, node: hit.chain[0], how: "near", distance: nd }
  return { name: hit.chain[0] ?? "an unnamed node", control: null, node: hit.chain[0], how: "unmapped" }
}

let holdUntil = 0
let lastWheel = 0
let outside = 0
function onMouse(m) {
  if (m.kind !== "left" && m.kind !== "wheel") return
  if (!m.foreground) { outside++; return }
  const burst = m.kind === "wheel" && m.t - lastWheel < WHEEL_BURST_MS
  if (m.kind === "wheel") lastWheel = m.t
  const c = cam
  if (!c || m.t - c.t > 500) return
  const origin = camModel(c)
  const results = HYP.map((h) => {
    const dir = ray(c, m, h)
    const hit = cast(cockpit, origin, dir)
    return { ...identify(hit), point: hit?.point ?? null, distance: hit?.distance ?? null, dir }
  })
  if (!burst) {
    results.forEach((x, i) => { if (x.control) HYP[i].named++ })
    touches.push({ t: m.t, kind: m.kind, mouse: m, cam: c, results })
  }
  const b = best()
  const res = results[HYP.indexOf(b)]
  if (!burst) {
    rec.log("touch", `${m.kind} at ${m.x}, ${m.y}: ${res.name ?? "nothing"}${res.how === "near" ? ` (${(res.distance * 100).toFixed(1)}cm off, hit ${res.node})` : ""} with ${b.label}`, { mouse: m, cam: c, results: results.map((x, i) => ({ hyp: HYP[i].label, name: x.name, how: x.how, node: x.node, point: x.point, distance: x.distance })) })
    console.log(`  ${m.kind === "left" ? "click" : "wheel"}: ${res.name ?? "nothing"}${res.how === "on" ? "" : res.how === "near" ? ` (near, hit ${res.node})` : res.how === "unmapped" ? " (not a mapped control)" : ""}`)
  }
  if (!res.point) return
  // The sphere's center sits one radius back along the ray, so it rests on the surface.
  const n = Math.hypot(...res.dir)
  const p = res.point.map((x, k) => x - (res.dir[k] / n) * RADIUS_M)
  const f = modelToFrame(p)
  setModule({ FWD: f.forward, RIGHT: f.right, UP: f.up, COLOR: COLOR.touching })
  holdUntil = Date.now() + HOLD_MS
}
stopMouse = await startMouse(onMouse)
const tick = setInterval(() => {
  if (holdUntil && Date.now() > holdUntil) {
    holdUntil = 0
    setModule({ FWD: rest.forward, RIGHT: rest.right, UP: rest.up, COLOR: COLOR.rest })
  }
}, 50)

console.log(`\n▶ Click the Comanche's controls\n  Click switches, breakers, and buttons, and turn knobs with the wheel. The console names what each press hit, and the red sphere in front of your seat turns green on it for ${HOLD_MS / 1000}s. The first few may miss while the probe settles its axes. ${SKIP} ends.`)
beep(1000, 100)
const cap = setTimeout(() => finish("the 20-minute cap"), CAP_MS)
for (;;) { const k = await keys.next(); if (k.key === "SKIP") break }
clearInterval(tick)
clearInterval(poll)
clearTimeout(cap)
const clicks = touches.filter((t) => t.kind === "left").length
note("touches", `${plural(clicks, "click")} and ${plural(touches.length - clicks, "wheel turn")} in the sim, ${plural(outside, "press", "presses")} outside it`)
await finish("Page Up")
