/*
 * p20: the ray through the cursor, fitted to clicks on known spots at more
 * than one zoom and window shape, and then the hand sphere wherever the pilot
 * presses, holds, and drags in the cockpit model, on MSFS 2024.
 *
 * p19 cast each click into the A2A Comanche's interior model (a2a-aircraft-pa24
 * 2.1.3) and named the controls of an engine start, but it couldn't tell which
 * field of view was right, because it never knew what the pilot meant to click.
 * Here a small yellow ball marks a known spot, the pilot clicks its center,
 * and the ray's signs, field of view, and any angle offset are fitted to those
 * clicks (lib/pick.mjs). Two shorter passes, one zoomed and one in a resized
 * window, test whether the ray holds for any field of view and window shape,
 * using CameraGet's field of view and the window's size as they are at each
 * click. The first run of p20 settled it: CameraGet's fov is the view's
 * height, with no offset (MEASURED in lib/pick.mjs), so the balls are
 * optional and only check that ray. The camera's position is taken as
 * SimConnect_CameraGet gives it in the SIMOBJECT referential, which matched
 * the Comanche's eyepoint within 4mm in p19's run.
 *
 * Then the sphere goes where the ray meets the model, with no guess at which
 * control that is. While the button is held, it glides along the plane of the
 * surface it first touched, where the cursor's ray crosses it, so it follows a
 * drag across a panel seen from an angle; the probe also logs where a fresh
 * cast and a fixed distance from the eye would have put it. On release it
 * stays 0.5s, then goes back to rest.
 *
 * In the A2A Comanche, parked, the sim in front:
 *
 *   balls     Page Down for the yellow balls below, Page Up to go straight to
 *             clicking.
 *   targets   A yellow ball sits on a knob, a switch, or a vent, 10 in turn,
 *             from the left wall across the panel to the right wall and the
 *             overhead. Click the center of each ball; Page Up skips one you
 *             can't see. Turn your view only as far as you need to see a ball:
 *             clicks away from the middle of the screen tell the fit the most.
 *   zoomed    Zoom the cockpit view in or out and press Page Down, then click
 *             4 more balls. Page Up skips the pass.
 *   resized   Resize the sim window, or go fullscreen, and press Page Down,
 *             then click 4 more balls. Page Up skips the pass.
 *   clicks    Click, hold, and drag anywhere: switches, knobs, levers, the
 *             yoke, the panel itself. The console names the node each press
 *             hit. Page Up ends; it ends by itself after 20 minutes.
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
import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { startMouse } from "../../tools/mouse.mjs"
import { findPackage } from "../aircraft/lib/flights.mjs"
import { Recorder, fmt, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { RAD, toBody, wrap } from "./lib/pose.mjs"
import { MEASURED, fitK, fitProjection, rayThrough, rmsOf } from "./lib/pick.mjs"
import { cast, crossPlane, loadCockpit } from "./lib/raycast.mjs"

const PACKAGE = "a2a-aircraft-pa24"
const MODEL = ["SimObjects", "Airplanes", "pa24-250", "common", "model", "PA24_250_INTERIOR_LOD00.gltf"]
const MAP = path.join(REPO, "experiments", "sim-sources", "avatars", "controls-pa24-250.json")
const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const SPHERE = "CROSSCHECK_HandSphere"
// From the left wall across the panel to the right wall, then the overhead;
// no starter, gear, fuel, or breaker, since the click reaches the control.
const TARGETS = ["KNOB_CabinVent1", "NoiseCancellingSwitch", "knob_nav_instr_light", "Switch_Light_Strobe", "HSI_Course_Knob", "INSTRUMENT_altitude_knob", "BUTTON_EDM730_Step", "GAUGE_ADF_Knob", "KNOB_CabinVent2", "SWITCH_Light_Red"]
const FEW = ["KNOB_CabinVent1", "INSTRUMENT_altitude_knob", "GAUGE_ADF_Knob", "KNOB_CabinVent2"]
// A pass after the first starts only once the field of view or the window's
// shape is this far from the first pass's.
const CHANGED = 0.05
// The ball sits this far in front of the spot, toward the eye, so a knob
// doesn't hide it; the ray to its center is the ray to the spot.
const PULL_M = 0.03
// p15: nose up and right wing down are both negative; lead 1 frame (p16).
const SIGNS = [-1, -1]
const LEAD = 1
const LINGER_MS = { release: 500, wheel: 1000 }
// A press shorter than TAP_MS is a tap unless the cursor moved DRAG_PX or the
// mouse DRAG_COUNTS (its own units, finer than pixels), which make it a drag.
const TAP_MS = 300
const DRAG_PX = 5
const DRAG_COUNTS = 20
const CAP_MS = 20 * 60_000
const COLOR = { rest: 0, touching: 1, target: 3 }
// tools/sphere.mjs: radius 2cm at scale 1, and SCALE 0 to 100 sweeps the scale
// from 0.5 to 5.
const radius = (scale) => 0.02 * (0.5 + 4.5 * scale / 100)
const SCALE = { target: 0, touching: 5 }
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
const deg = (rad) => (rad / RAD).toFixed(1)
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const label = (h) => `mirror ${sign(h.mirror)}, yaw ${sign(h.yaw)}, pitch ${sign(h.pitch)}, fov as the view's ${h.vertical ? "height" : "width"} times ${h.k.toFixed(3)}, yaw bias ${h.yawBias.toFixed(2)}°, pitch bias ${h.pitchBias.toFixed(2)}°`

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
    "p20 · The ray through the cursor fitted to clicks on known spots, and the hand sphere where the pilot presses, holds, and drags, on MSFS 2024",
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
const pkg = findPackage(PACKAGE)
if (!pkg) { console.error(`${PACKAGE} isn't installed.`); process.exit(1) }
const cockpit = loadCockpit([path.join(pkg, ...MODEL)])
note("model", `${MODEL.at(-1)}: ${plural(cockpit.triangles, "triangle")}`)

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
note("camera", `at ${where({ forward: cam.z, right: -cam.x, up: cam.y })} of the reference point, fov ${deg(cam.fov)}°`, { cam })

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

// The sphere's center one radius off the surface, on the eye's side.
function touch(point, normal) {
  const f = modelToFrame(point.map((x, k) => x + normal[k] * radius(SCALE.touching)))
  setModule({ FWD: f.forward, RIGHT: f.right, UP: f.up, COLOR: COLOR.touching })
}
const toRest = () => setModule({ FWD: rest.forward, RIGHT: rest.right, UP: rest.up, COLOR: COLOR.rest })

// Mouse events go to whichever phase is listening, and Page Up to its skip.
let onMouse = null
let outside = 0
let win = null
stopMouse = await startMouse((m) => {
  if (m.width > 0 && m.height > 0) win = { width: m.width, height: m.height }
  if (m.kind === "size") return
  if (!m.foreground) { if (m.kind === "left") outside++; return }
  if (onMouse) onMouse(m)
})
let onSkip = null
keys.listen((k) => { if (k.key === "SKIP" && onSkip) onSkip() })

// ------------------------------------------------ targets

async function targets(pass, ids) {
  const out = []
  for (const [i, id] of ids.entries()) {
    const c = map.controls.find((x) => x.id === id)
    if (!c) { note("target", `${id}: not in the map`); continue }
    const spot = c.center ?? c.origin
    const eye = camModel(cam)
    const n = dist(eye, spot)
    const ball = spot.map((x, k) => x + ((eye[k] - x) / n) * PULL_M)
    const f = modelToFrame(ball)
    setModule({ FWD: f.forward, RIGHT: f.right, UP: f.up, COLOR: COLOR.target, SCALE: SCALE.target })
    console.log(`  ${i + 1}/${ids.length}: ${id}`)
    beep(1000, 80)
    const got = await new Promise((resolve) => {
      onMouse = (m) => { if (m.kind === "left") resolve(m) }
      onSkip = () => resolve(null)
    })
    onMouse = null
    onSkip = null
    if (!got) { rec.log("target", `${pass}, ${id}: skipped`); continue }
    const s = { pass, id, cam, mouse: got, origin: camModel(cam), target: ball }
    out.push(s)
    rec.log("target", `${pass}, ${id}: clicked at ${got.x}, ${got.y} in ${got.width}×${got.height}, camera pitch ${fmt(cam.pitch)}, yaw ${fmt(cam.yaw)}, roll ${fmt(cam.roll)}, fov ${deg(cam.fov)}°`, s)
  }
  setModule({ SCALE: SCALE.touching })
  toRest()
  beep(500, 400)
  return out
}

// Waits for Page Down once the field of view or the window has changed
// enough; Page Up skips the pass.
async function prepare(heading, instruction, changed, now) {
  console.log(`\n▶ ${heading}\n  ${instruction}\n  ${START} to start, ${SKIP} to skip this pass.`)
  for (;;) {
    const k = await keys.next()
    if (k.key === "SKIP") return false
    if (changed()) return true
    console.log(`  ${now()}: not enough of a change yet. Change it further, then ${START}.`)
  }
}

let first = [], zoomed = [], resized = []
if (await prepare("Yellow balls", "Click the balls to check the ray, or skip them and go straight to clicking with the ray p20 measured.", () => true, () => "")) {
  console.log(`\n▶ Click the yellow balls\n  A small yellow ball sits on a spot in the cockpit, ${TARGETS.length} in turn. Click its center. Turn your view only as far as you need to see it. ${SKIP} skips one you can't see.`)
  first = await targets("first", TARGETS)
  const fov0 = first[0]?.cam.fov ?? cam.fov
  const aspect0 = first.length ? first[0].mouse.width / first[0].mouse.height : (win ? win.width / win.height : 1)
  if (await prepare("Zoom", "Zoom the cockpit view in or out, the way you normally do.", () => Math.abs(cam.fov / fov0 - 1) > CHANGED, () => `the field of view is ${deg(cam.fov)}°, and was ${deg(fov0)}°`)) {
    zoomed = await targets("zoomed", FEW)
  }
  if (await prepare("Resize", "Resize the sim window by dragging its edge, or go fullscreen. Move the mouse over the sim once it's done.", () => win && Math.abs(win.width / win.height / aspect0 - 1) > CHANGED, () => `the window is ${win ? `${win.width}×${win.height}` : "unknown"}, and its shape was ${aspect0.toFixed(3)}`)) {
    resized = await targets("resized", FEW)
  }
}

// ------------------------------------------------ the fit

// The clicks below use the measured ray; the balls only check it.
const params = MEASURED
const all = [...first, ...zoomed, ...resized]
const cm = (s, h) => (dist(s.target, s.origin) * Math.tan(rmsOf([s], h) * RAD) * 100).toFixed(1)
for (const [name, set] of [["first", first], ["zoomed", zoomed], ["resized", resized]]) {
  if (!set.length) continue
  // k near 1 in every pass means the fov is the view's height at any zoom and window shape.
  const own = fitK(set, MEASURED)
  note("pass", `${name}: fov ${deg(set[0].cam.fov)}°, window ${set[0].mouse.width}×${set[0].mouse.height}, ${plural(set.length, "click")}; the measured ray is off by RMS ${rmsOf(set, MEASURED).toFixed(2)}° (${set.map((s) => `${s.id} ${cm(s, MEASURED)}cm`).join(", ")}); fitted alone, k ${own.params.k.toFixed(3)}`)
}
if (all.length >= 4) {
  const fit = fitProjection(all)
  note("fit", `fitted to all ${plural(all.length, "click")}: ${label(fit.params)}, RMS ${fit.rms.toFixed(2)}°; the next best signs, ${label(fit.runnerUp.params)}, RMS ${fit.runnerUp.rms.toFixed(2)}°; p19's ray RMS ${fit.p19.rms.toFixed(2)}°`, { fit: { params: fit.params, rms: fit.rms, errors: fit.errors, runnerUp: fit.runnerUp } })
}

// ------------------------------------------------ press, hold, drag

let grab = null
let lingerUntil = 0
let lastWheel = 0
const holds = []
const nodes = new Map()
const pixels = (m, a) => Math.hypot((m.x - a.x) * m.width / 2, (m.y - a.y) * m.height / 2)
onMouse = (m) => {
  const c = cam
  if (!c || m.t - c.t > 500) return
  const origin = camModel(c)
  if (m.kind === "left" || m.kind === "wheel") {
    if (m.kind === "wheel" && m.t - lastWheel < 600) { lastWheel = m.t; lingerUntil = Date.now() + LINGER_MS.wheel; return }
    if (m.kind === "wheel") lastWheel = m.t
    const dir = rayThrough(c, m, params)
    const hit = cast(cockpit, origin, dir)
    const node = hit?.chain[0] ?? "nothing"
    nodes.set(node, (nodes.get(node) ?? 0) + 1)
    rec.log(m.kind === "left" ? "press" : "wheel", `${m.kind} at ${m.x}, ${m.y}: ${node}${hit ? ` at ${hit.distance.toFixed(3)}m` : ""}`, { mouse: m, cam: c, origin, dir, hit: hit && { point: hit.point, normal: hit.normal, distance: hit.distance, chain: hit.chain } })
    console.log(`  ${m.kind === "left" ? "press" : "wheel"}: ${node}`)
    if (!hit) return
    touch(hit.point, hit.normal)
    if (m.kind === "wheel") { lingerUntil = Date.now() + LINGER_MS.wheel; return }
    grab = { t0: m.t, start: m, point: hit.point, normal: hit.normal, distance: hit.distance, node, hand: hit.point, cursorPx: 0, rawX: 0, rawY: 0, path: [] }
    lingerUntil = 0
    return
  }
  if (!grab) return
  if (m.kind === "move") {
    const dir = rayThrough(c, m, params)
    const n = Math.hypot(...dir)
    const onPlane = crossPlane(origin, dir, grab.point, grab.normal)
    const recast = cast(cockpit, origin, dir)
    const fixed = origin.map((x, k) => x + (dir[k] / n) * grab.distance)
    if (onPlane) { grab.hand = onPlane; touch(onPlane, grab.normal) }
    grab.cursorPx = Math.max(grab.cursorPx, pixels(m, grab.start))
    grab.rawX += m.dx
    grab.rawY += m.dy
    grab.path.push({ t: m.t, x: m.x, y: m.y, dx: m.dx, dy: m.dy, onPlane, recast: recast?.point ?? null, recastNode: recast?.chain[0] ?? null, fixed })
  } else if (m.kind === "leftup") {
    const ms = m.t - grab.t0
    const raw = Math.hypot(grab.rawX, grab.rawY)
    const dragged = grab.cursorPx >= DRAG_PX || raw >= DRAG_COUNTS
    const kind = dragged ? "drag" : ms < TAP_MS ? "tap" : "hold"
    const moved = grab.path.filter((p) => p.onPlane)
    const travel = moved.length ? dist(moved[0].onPlane, moved[moved.length - 1].onPlane) : 0
    const recastGap = moved.filter((p) => p.recast).map((p) => dist(p.onPlane, p.recast))
    const hold = { kind, node: grab.node, ms, cursorPx: grab.cursorPx, raw, travel, recastGap: recastGap.length ? median(recastGap) : null, moves: grab.path.length }
    holds.push(hold)
    rec.log("release", `${kind} on ${grab.node}: ${ms}ms, the cursor moved up to ${grab.cursorPx.toFixed(0)}px and the mouse ${raw.toFixed(0)} counts; the hand slid ${(travel * 100).toFixed(1)}cm on the plane${hold.recastGap !== null ? `, a fresh cast ${(hold.recastGap * 100).toFixed(1)}cm from it (median)` : ""}`, { ...hold, path: grab.path })
    if (kind !== "tap") console.log(`  ${kind} on ${grab.node}: ${(ms / 1000).toFixed(1)}s, cursor ${grab.cursorPx.toFixed(0)}px, mouse ${raw.toFixed(0)} counts`)
    grab = null
    lingerUntil = Date.now() + LINGER_MS.release
  }
}
const tick = setInterval(() => {
  if (!grab && lingerUntil && Date.now() > lingerUntil) { lingerUntil = 0; toRest() }
}, 50)

console.log(`\n▶ Click, hold, and drag anywhere in the cockpit\n  Switches, knobs, levers, the yoke, the panel itself. The sphere goes where you press, slides with a drag, and goes back to rest ${LINGER_MS.release / 1000}s after you let go. The console names the node each press hit. ${SKIP} ends.`)
beep(1000, 100)
const why = await new Promise((resolve) => {
  onSkip = () => resolve("Page Up")
  setTimeout(() => resolve("the 20-minute cap"), CAP_MS)
})
clearInterval(tick)
clearInterval(poll)
const count = (k) => holds.filter((h) => h.kind === k)
note("presses", `${plural(holds.length, "press", "presses")} in the sim (${count("tap").length} taps, ${count("hold").length} holds, ${count("drag").length} drags), ${plural(outside, "click")} outside it; nodes hit: ${[...nodes].map(([n, c]) => `${n}${c > 1 ? ` ×${c}` : ""}`).join(", ")}`)
for (const h of count("drag").slice(0, 12)) note("drag", `on ${h.node}: ${(h.ms / 1000).toFixed(1)}s, the cursor moved up to ${h.cursorPx.toFixed(0)}px while the mouse moved ${h.raw.toFixed(0)} counts; the hand slid ${(h.travel * 100).toFixed(1)}cm on the plane${h.recastGap !== null ? `, and a fresh cast was ${(h.recastGap * 100).toFixed(1)}cm from it (median)` : ""}`)
await finish(why)
