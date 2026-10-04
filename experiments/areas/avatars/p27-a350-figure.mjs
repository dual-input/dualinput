/*
 * p27: the figure in the iniBuilds A350's right seat, for the pilot to play
 * with on MSFS 2024: its hands go where the pilot clicks, its right hand
 * holds the first officer's sidestick at rest, its head looks where the pilot
 * looks, and the module holds it in its seat. In the iniBuilds A380, the
 * A350's cockpit stands in for the A380's.
 *
 * In the A350, the cockpit models hang at the interior's AP_A359_Cockpit, or
 * AP_A35K_Cockpit in the -1000 (the presets' attached_objects.cfg spell them
 * in capitals), and the eyes come from the variant's cameras.cfg
 * (inibuilds-aircraft-a350 1.2.6). The probe prints how far the camera is
 * from the Pilot eye at the start, which checks the frame when the pilot
 * starts from that view.
 *
 * The A380 comes from the Marketplace and ships its cockpit models as
 * .gltf.fsc and no cameras.cfg we can read (inibuilds-aircraft-a380 1.0.0),
 * so nothing gives its surfaces or its eyes. From its pilot's eye, the A350's
 * captain's stick is 33cm forward, 57cm down, and 32cm outboard, near the
 * A220's 37cm, 60cm, and 32cm (synaptic-aircraft-a220 1.0.10), so the A350's
 * cockpit stands in. Both cockpits are taken as centered on x = 0, and the
 * stand-in moves up and forward until its pilot's eye meets the A380's
 * camera as it is when the probe starts, which must be the default pilot
 * view. How close the stand-in's surfaces come to the A380's is unknown, and
 * the pilot's eye judges it.
 *
 * crosscheck-p12-follow turns the seat's offset into latitude and longitude
 * on a sphere of 6,371km (wasm/src/follow.cpp, place()), and the sim's
 * latitudes and longitudes are WGS 84's. At latitude -0.90°, heading 169.6°,
 * that put a point 26m forward of the A350's reference point 14.0cm aft and
 * 3.2cm left of where it was meant to go, and WGS 84's radii of curvature
 * accounted for all of it, to 0.1cm (tools/frames.mjs, 2026-10-04). So the
 * probe sends the module the offset that lands right on the sphere: the seat's
 * offset turned to north, east, and down, north and east scaled by the
 * sphere's radius over WGS 84's at the aircraft's latitude, and turned back,
 * every tick.
 *
 * In both, the copilot's eye is the pilot's mirrored across the centerline,
 * since the sticks are mirrored and the A350's CoPilot camera isn't, and the
 * seat point sits under it as in p26 (0.678m down, 0.062m forward, from the
 * Baron).
 *
 * The hands follow p26's right-seat sidestick rules: the right hand holds the
 * stick at home; a press more than 5cm right of the seat's centerline is the
 * right hand's, and any other the left's; a press on the first officer's stick
 * is the right thumb. The cockpit stays as its files store it: the A350 keeps
 * its animation code in a compiled <Strings> table that lib/rpn.mjs doesn't
 * read (record/areas/avatars/log.md, 2026-10-04).
 *
 * In the A350 or the A380, parked or flying, from the left seat, starting
 * from the default pilot view:
 *
 *   play      Click, drag, and right-click around, and look around: the
 *             figure's hands and head follow. Page Up ends; it ends by itself
 *             after 60 minutes.
 *
 *   node experiments/areas/avatars/p27-a350-figure.mjs
 *
 * It needs crosscheck-figure built and mounted, and crosscheck-p12-follow
 * 0.6.0 running. Nothing touches the pilot's input: clicks are read through
 * Raw Input (experiments/tools/mouse.mjs). The probe turns the module off and
 * removes the figure at the end and on Ctrl+C.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { InitPosition } from "node-simconnect"

import { SKIP, startBeeper, startKeys } from "../../tools/guide.mjs"
import { startMouse } from "../../tools/mouse.mjs"
import { findPackage } from "../aircraft/lib/flights.mjs"
import { Recorder, fmt, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { eyes } from "./figure/cockpit.mjs"
import { CHANNELS, colorChannel, variable } from "./figure/model.mjs"
import { solve } from "./figure/solve.mjs"
import { frameToNed, nedToFrame } from "./lib/frames.mjs"
import { apply, readGltf } from "./lib/gltf.mjs"
import { MEASURED, rayThrough } from "./lib/pick.mjs"
import { RAD, turn, wrap } from "./lib/pose.mjs"
import { cast, crossPlane, loadCockpit, subtree } from "./lib/raycast.mjs"

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const FIGURE = "CROSSCHECK_Figure"
const STAND_IN = "inibuilds-aircraft-a350"
const BASE = "SimObjects/Airplanes/A350"
const COCKPIT = `${BASE}/attachments/inibuilds/Part_Interior_A350_Cockpit/model`
// The cockpit first: the stick's nodes refer to it.
const MODELS = ["A350_Cockpit_LOD00.gltf", "A350_Cockpit_Static_LOD00.gltf", "A350_Cockpit_SST_LOD00.gltf"].map((f) => `${COCKPIT}/${f}`)
const VARIANTS = {
  "A350-900": { cameras: `${BASE}/presets/inibuilds/A350-900_No_Cabin/config/cameras.CFG`, attach: "AP_A359_Cockpit" },
  "A350-1000": { cameras: `${BASE}/presets/inibuilds/A350-1000_No_Cabin/config/cameras.cfg`, attach: "AP_A35K_Cockpit" },
}
const ROOT = `${BASE}/attachments/inibuilds/Function_Interior_A350/model/ROOT.gltf`
const FO_GRIP = "FO_JOY_HANDLE"
const EYE_TO_SEAT = { fwd: 0.062, up: -0.678 }
const BAND_M = 0.05
// How long a released hand stays on the spot, how long it then hovers before
// both go home, and how far off the spot it hovers. The pilot found p26's
// 0.25s, 2s, and 5cm far too long and far (2026-10-04). Then how quickly a
// hand reaches out and comes back, how far the way back sags (drive()), and
// how far out of the grip's surface the stick hand's center sits. The probe
// reads them again from the tuning file whenever it changes, so a session can
// be tuned without a restart: { "lingerMs": 150, "sessionMs": 500,
// "hoverM": 0.015, "reachS": 0.15, "backS": 0.3, "backPow": 3, "arcM": 0.06,
// "gripM": 0 }.
const TUNE_FILE = process.env.CROSSCHECK_P27_TUNE ?? path.join(os.tmpdir(), "crosscheck-p27-tune.json")
const tune = { lingerMs: 150, sessionMs: 500, hoverM: 0.015, reachS: 0.15, backS: 0.3, backPow: 3, arcM: 0.06, gripM: 0 }
// A stop file written after the start ends the probe as Page Up does, so a
// restart needs no key.
const STOP_FILE = process.env.CROSSCHECK_P27_STOP ?? path.join(os.tmpdir(), "crosscheck-p27-stop")
const STARTED_MS = Date.now()
const WHEEL_LINGER_MS = 1000
const TAP_MS = 300
const DRAG_PX = 5
const DRAG_COUNTS = 20
const CAP_MS = 60 * 60_000
// p15: nose up and right wing down are both negative; lead 1 frame (p16).
const SIGNS = [-1, -1]
const LEAD = 1
const TICK_MS = 33
// How long the head takes to get most of the way to where it looks: each tick
// closes 1 - e^(-dt / s) of what's left. The hands move on a spring (drive()).
const EASE_S = { head: 0.12 }
const GAZE_MS = 200
const RECORD_MS = 200
const SIMOBJECT = 1
const L = (n) => [`L:CROSSCHECK_P12_${n}`, "number"]
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const pt = (p) => p.map((x) => x.toFixed(3)).join(", ")

const spec = JSON.parse(fs.readFileSync(new URL("./figure/figure.json", import.meta.url), "utf8"))
const ALL = [...CHANNELS, colorChannel(spec)]
const VARS = ALL.map((ch) => [`L:${variable(ch)}`, "number"])
const HAND_RADIUS = spec.hand.radius

const rec = new Recorder("p27-a350-figure", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p27-a350-figure" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()
const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); console.log(`  ${text}`); rec.log(kind, text, fields) }

// The tuning file, read at the start and again whenever it changes; a value
// that's missing or not a number keeps what it was.
function readTune() {
  try {
    const t = JSON.parse(fs.readFileSync(TUNE_FILE, "utf8"))
    for (const k of Object.keys(tune)) if (Number.isFinite(t[k])) tune[k] = t[k]
  } catch { /* no file, or one being written: keep the values */ }
  note("tune", `a released hand stays ${tune.lingerMs}ms on the spot, then hovers ${(tune.hoverM * 100).toFixed(1)}cm off it for ${tune.sessionMs}ms before going home; a hand reaches out in ${tune.reachS}s and comes back in ${tune.backS}s, easing out at power ${tune.backPow}, on a curve sagging ${(tune.arcM * 100).toFixed(1)}cm; the stick hand's center sits ${(tune.gripM * 100).toFixed(1)}cm out of the grip's surface`, { ...tune })
}
// The path names the home folder, so it goes to the console and not the record.
console.log(`  tuning file: ${TUNE_FILE}`)
readTune()
fs.watchFile(TUNE_FILE, { interval: 500 }, readTune)

async function readModule(names) {
  const v = await sim.read(names.map(L), { timeoutMs: 2000 })
  return Object.fromEntries(names.map((n) => [n, v.get(`L:CROSSCHECK_P12_${n}`) ?? null]))
}
const setModule = (values) => { for (const [k, x] of Object.entries(values)) sim.set([L(k)], [x], { label: `set CROSSCHECK_P12_${k}`, quiet: true }) }

const stats = { presses: { left: 0, right: 0 }, thumbs: 0, sessions: 0, drags: 0, looks: 0, outside: 0, misses: 0, gazeHits: 0, gazeMisses: 0, maxSpeed: 0 }
let figure = null
let stopMouse = null
let finished = false
let where = "the cockpit"
async function finish(why) {
  if (finished) return
  finished = true
  if (stopMouse) stopMouse()
  const m = await readModule(["FRAMES", "ERRORS", "LAST_ERROR"]).catch(() => null)
  setModule({ MODE: 0, OBJECT: 0, OBJECT2: 0, LEAD: 0 })
  if (figure !== null) sim.remove(figure)
  await sleep(800)
  if (m) note("module", `the module wrote the figure in ${plural(m.FRAMES ?? 0, "frame")}, with ${plural(m.ERRORS ?? 0, "error")}${m.ERRORS ? ` (last ${fmt(m.LAST_ERROR)})` : ""}`)
  note("presses", `the left hand tapped ${plural(stats.presses.left, "time")} and the right hand ${plural(stats.presses.right, "time")}, ${plural(stats.drags, "drag")}; the right thumb pressed the first officer's stick ${plural(stats.thumbs, "time")}; ${plural(stats.misses, "press", "presses")} met nothing in ${where}; the hands went home after ${plural(stats.sessions, "session")}; ${plural(stats.looks, "right press", "right presses")} turned the view; ${plural(stats.outside, "click")} outside the sim`)
  note("head", `the middle of the view met ${where} on ${plural(stats.gazeHits, "look")} and nothing on ${stats.gazeMisses}; the aircraft reached ${fmt(Math.round(stats.maxSpeed))} kt over the run`)
  const text = [
    "p27 · The figure in the iniBuilds A350's right seat, or the A380's with the A350's cockpit standing in: hands by the pilot's clicks, the right hand on the first officer's sidestick at rest, head by the pilot's look, held in its seat by the module, on MSFS 2024",
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

await sleep(1000)
const m0 = await readModule(["ALIVE"])
await sleep(500)
const m1 = await readModule(["ALIVE"])
if (!(m0.ALIVE !== null && m1.ALIVE > m0.ALIVE)) { note("module", "crosscheck-p12-follow isn't running"); await finish("no module") }
const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
const speed0 = await sim.readOne("GROUND VELOCITY", "knots")
note("setup", `aircraft TITLE ${JSON.stringify(title)}, ${fmt(speed0)} kt`)
const standIn = /A380/i.test(title ?? "")
if (!standIn && !/A350/i.test(title ?? "")) { note("setup", "the loaded aircraft isn't an A350 or an A380"); await finish("another aircraft") }
where = standIn ? "the stand-in" : "the cockpit"
const variantName = /A350-1000/i.test(title ?? "") ? "A350-1000" : "A350-900"
const variant = VARIANTS[variantName]
const pkg = findPackage(STAND_IN)
if (!pkg) { note("setup", `${STAND_IN} isn't installed`); await finish("no A350") }
const manifest = JSON.parse(fs.readFileSync(path.join(pkg, "manifest.json"), "utf8"))
const cockpit = loadCockpit(MODELS.map((m) => path.join(pkg, m)))
const model = cockpit.models[0]
note("model", `${standIn ? "the stand-in, " : ""}${STAND_IN} ${manifest.package_version} as the ${variantName}: ${MODELS.map((m) => path.basename(m)).join(", ")}, ${plural(cockpit.triangles, "triangle")}`)

// The A350's pilot's eye in the aircraft's space, from cameras.cfg, and in
// its cockpit model's own space, less where the cockpit hangs in ROOT.
const fileEyes = eyes(path.join(pkg, variant.cameras), { pilot: "Pilot" })
const root = readGltf(path.join(pkg, ROOT))
const attachIndex = root.nodes.findIndex((n) => (n.name ?? "").toLowerCase() === variant.attach.toLowerCase())
if (!fileEyes.pilot || attachIndex < 0) { note("setup", `the A350's Pilot eye ${fileEyes.pilot ? "found" : "missing"}, ${variant.attach} ${attachIndex < 0 ? "missing" : "found"}`); await finish("no A350 eye") }
const attachAt = apply(root.world[attachIndex], [0, 0, 0])
const fileEye = [-fileEyes.pilot.right, fileEyes.pilot.up, fileEyes.pilot.fwd]
const standInEye = fileEye.map((x, k) => x - attachAt[k])

// ------------------------------------------------ the camera, and the stand-in lined up

let cam = null
let windowSize = { width: 16, height: 9 }
sim.handle.on("cameraData", (r) => {
  const c = r.cameraData
  if (c.positionReferential !== SIMOBJECT) return
  cam = { t: Date.now(), x: c.position.x, y: c.position.y, z: c.position.z, pitch: c.pbh.pitch, yaw: c.pbh.bank, roll: c.pbh.heading, fov: c.fov > Math.PI ? c.fov * RAD : c.fov }
})
const poll = setInterval(() => sim.send("camera get", () => sim.handle.cameraGet(SIMOBJECT)), 30)
for (let i = 0; i < 40 && !cam; i++) await sleep(50)
if (!cam) { note("camera", "SimConnect_CameraGet didn't answer"); await finish("no camera") }
// SIMOBJECT is the aircraft's space (p18, p21; p26 in the A220).
const eyeOf = (c) => [c.x, c.y, c.z]
// In the A350, the cockpit hangs where its files put it. In the A380, the
// centerlines meet on x = 0, and the stand-in moves up and forward to the eye.
const pilotEye = standIn ? eyeOf(cam) : fileEye
const OFFSET = standIn ? [0, pilotEye[1] - standInEye[1], pilotEye[2] - standInEye[2]] : attachAt
const toStandIn = (p) => p.map((x, k) => x - OFFSET[k])
const toPlane = (p) => p.map((x, k) => x + OFFSET[k])
if (standIn) note("camera", `the pilot's eye at ${pt(pilotEye)} in the A380, ${(Math.abs(pilotEye[0]) * 100).toFixed(1)}cm from the centerline, against the stand-in's ${(Math.abs(standInEye[0]) * 100).toFixed(1)}cm; the stand-in moves up ${OFFSET[1].toFixed(3)}m and forward ${OFFSET[2].toFixed(3)}m`)
else note("camera", `the camera is ${(dist(eyeOf(cam), fileEye) * 100).toFixed(1)}cm from cameras.cfg's Pilot eye (${pt(eyeOf(cam))} against ${pt(fileEye)}); within a few centimeters, if the view is the Pilot view, means the files' frame is SimConnect's; the cockpit hangs at ${variant.attach}, ${pt(attachAt)}`)
// A ray in the aircraft's space, cast into the cockpit model's, with the hit back in the aircraft's.
const castPlane = (origin, dir, opts) => {
  const hit = cast(cockpit, toStandIn(origin), dir, opts)
  return hit && { ...hit, point: toPlane(hit.point) }
}

// ------------------------------------------------ the eyes and the seat

const eyeModel = [-pilotEye[0], pilotEye[1], pilotEye[2]]
const seat = { at: [eyeModel[0], eyeModel[1] + EYE_TO_SEAT.up, eyeModel[2] + EYE_TO_SEAT.fwd] }
// The aircraft's space (+x left, y up, z forward) as the figure's frame from the seat.
const toFigure = (p) => ({ fwd: p[2] - seat.at[2], right: -(p[0] - seat.at[0]), up: p[1] - seat.at[1] })
const fromFigure = (f) => [seat.at[0] - f.right, seat.at[1] + f.up, seat.at[2] + f.fwd]
const eyeFigure = toFigure(eyeModel)
const rest = {
  left: fromFigure({ fwd: spec.rest.hand.fwd, right: -spec.rest.hand.right, up: spec.rest.hand.up }),
  right: fromFigure({ fwd: spec.rest.hand.fwd, right: spec.rest.hand.right, up: spec.rest.hand.up }),
}
note("setup", `the copilot's eye at ${pt(eyeModel)}, the pilot's mirrored; the seat point at ${pt(seat.at)}`)

// ------------------------------------------------ the first officer's stick and its grip

const foIndex = model.nodes.findIndex((n) => n.name === FO_GRIP)
if (foIndex < 0) { note("stick", `no ${FO_GRIP} in ${where}`); await finish("no stick") }
// The stick: everything under the grip's parent, the helper the roll animation turns.
const ownStick = subtree(model, model.parent[foIndex] >= 0 ? model.parent[foIndex] : foIndex)
function meshMiddle(i) {
  const mesh = model.g.meshes[model.nodes[i].mesh]
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const p of mesh.primitives) {
    const acc = model.g.accessors[p.attributes.POSITION]
    lo = lo.map((v, k) => Math.min(v, acc.min[k]))
    hi = hi.map((v, k) => Math.max(v, acc.max[k]))
  }
  return lo.map((v, k) => (v + hi[k]) / 2)
}
// The grip's surface toward the copilot's eye, and the way out of it. The
// ball's center goes tune.gripM out along that way: 0 sinks half the ball
// into the grip, which the pilot asked for so the hand looks like it holds the
// grip, where p25's yoke hand rests the ball on the surface (2026-10-04). The
// stick isn't posed, so the grip stays put.
const middle = toPlane(apply(model.world[foIndex], meshMiddle(foIndex)))
let gripPoint = middle, gripNormal = [0, 0, 0]
{
  const hit = castPlane(eyeModel, middle.map((x, k) => x - eyeModel[k]), { only: ownStick })
  if (!hit || hit.distance > dist(eyeModel, middle)) note("grip", "no grip surface between the copilot's eye and the grip's middle, so the hand sits on the middle")
  else {
    gripPoint = hit.point
    gripNormal = hit.normal
    note("grip", `the grip's surface is ${hit.chain[0]}'s, ${(dist(middle, hit.point) * 100).toFixed(1)}cm from the grip's middle toward the copilot's eye`)
  }
}
const gripNow = () => gripPoint.map((x, k) => x + gripNormal[k] * tune.gripM)
note("stick", `the first officer's grip at ${pt(gripPoint)} in the aircraft's space, ${plural(ownStick.size, "node")} of stick`)

// ------------------------------------------------ the hands' state

const state = { stickHeld: true, tapHand: null, tap: null, normal: null, hover: false, thumb: null, lingerUntil: 0, thumbUntil: 0, sessionUntil: 0 }

// Where each hand's ball goes now, in the aircraft's space, and whether it's
// going back, to the stick or to rest, which it does slowly.
function target(hand) {
  if (hand === "right" && state.thumb) return { at: state.thumb, back: false }
  if (hand === state.tapHand && state.tap) return { at: state.tap.map((x, k) => x + state.normal[k] * (HAND_RADIUS + (state.hover ? tune.hoverM : 0))), back: false }
  if (hand === "right" && state.stickHeld) return { at: gripNow(), back: true }
  return { at: rest[hand], back: true }
}

// Right of the seat's centerline by more than the band is the right hand's.
const rightOfSeat = (p) => -(p[0] - seat.at[0])
const tapper = (p) => (rightOfSeat(p) > BAND_M ? "right" : "left")

function begin(m, c, label) {
  const hit = castPlane(eyeOf(c), rayThrough(c, m, MEASURED))
  if (!hit) { stats.misses++; console.log(`  ${label}: nothing`); return null }
  const thumb = hit.file === model.name && ownStick.has(hit.node)
  const hand = thumb ? "right" : tapper(hit.point)
  if (thumb) {
    stats.thumbs++
    state.thumb = hit.point.map((x, k) => x + hit.normal[k] * HAND_RADIUS)
    state.thumbUntil = 0
  } else {
    stats.presses[hand]++
    if (hand === "right") { state.stickHeld = false; state.thumb = null }
    state.tapHand = hand
    state.tap = hit.point
    state.normal = hit.normal
    state.hover = false
    state.lingerUntil = 0
    state.sessionUntil = 0
  }
  const side = rightOfSeat(hit.point)
  const what = thumb ? "the right thumb presses it, holding the stick" : `the ${hand} hand taps${hand === "right" ? ", letting go of the stick" : state.stickHeld ? ", the right holds the stick" : ""}`
  rec.log("press", `${label}: ${hit.chain[0]} in ${where}, ${(hit.distance * 100).toFixed(0)}cm from the eye, ${(Math.abs(side) * 100).toFixed(1)}cm ${side > 0 ? "right" : "left"} of the seat's centerline: ${what}`, { mouse: m, cam: c, hit: { point: hit.point, normal: hit.normal, distance: hit.distance, chain: hit.chain, file: hit.file }, hand, thumb })
  console.log(`  ${label}: ${hit.chain[0]}, ${(hit.distance * 100).toFixed(0)}cm out, ${thumb ? "right thumb" : `${hand} hand`}`)
  return { hit, thumb }
}

function release(r, ms) {
  const now = Date.now()
  if (r.thumb) { state.thumbUntil = now + ms; return }
  state.lingerUntil = now + ms
  state.sessionUntil = now + ms + tune.sessionMs
}

// ------------------------------------------------ the head

// The point the middle of the pilot's view rests on in the cockpit, or with
// nothing there, the way the pilot looks, as the figure's yaw and pitch.
const look = { yaw: -40, pitch: -5 }
let gazeTarget = { ...look }
function gaze() {
  const c = cam
  if (!c || Date.now() - c.t > 500) return
  const dir = rayThrough(c, { x: 0, y: 0, ...windowSize }, MEASURED)
  const hit = castPlane(eyeOf(c), dir)
  let v
  if (hit) {
    stats.gazeHits++
    const p = toFigure(hit.point)
    v = { fwd: p.fwd - eyeFigure.fwd, right: p.right - eyeFigure.right, up: p.up - eyeFigure.up }
  } else {
    stats.gazeMisses++
    v = { fwd: dir[2], right: -dir[0], up: dir[1] }
  }
  gazeTarget = { yaw: Math.atan2(v.right, v.fwd) / RAD, pitch: Math.atan2(v.up, Math.hypot(v.fwd, v.right)) / RAD }
}

// ------------------------------------------------ the figure

const ease = (s, dt) => 1 - Math.exp(-dt / s)
// Going out, a hand follows its target on a spring damped just enough not to
// overshoot, from where it is and how fast it's moving, so a click on the way
// back starts the hand from there. Starting still, it gets 95% of the way,
// where 4.74 time constants leave (1 + 4.74)e^-4.74 = 5%, in tune.reachS.
const hands = { left: target("left").at, right: target("right").at }
const speeds = { left: [0, 0, 0], right: [0, 0, 0] }
function spring(hand, t, dt) {
  const w = 4.74 / Math.max(0.01, tune.reachS), e = Math.exp(-w * dt)
  hands[hand] = hands[hand].map((x, k) => {
    const y = x - t.at[k], v = speeds[hand][k], c = v + w * y
    speeds[hand][k] = (v - w * c * dt) * e
    return t.at[k] + (y + c * dt) * e
  })
}

// Going back, to rest or to the stick, a hand follows a curve that sags down
// and in toward the body, tune.arcM at its middle, where the spring's path is
// the straight line, which the pilot found too linear (2026-10-04). Along
// the curve it eases out, 1 - (1 - t)^tune.backPow: it leaves at full speed
// and slows into place. The minimum-jerk profile people's reaching follows
// (Flash and Hogan, 1985), slow to start and slow to stop, looked uncanny on
// a figure of balls and sticks, where a snap looks right (the pilot,
// 2026-10-04). A return of 60cm takes tune.backS, and a shorter one less, by
// the square root of its length, down to a third. The curve is a quadratic
// Bézier, whose middle sits halfway from the chord's middle to its control
// point, so the control point sits twice the sag out.
const easeOut = (t) => 1 - (1 - t) ** Math.max(1, tune.backPow)
const shoulder = (hand) => fromFigure({ fwd: eyeFigure.fwd, right: (hand === "right" ? 1 : -1) * spec.shoulders.width, up: eyeFigure.up - 0.25 })
const returns = { left: null, right: null }
const wasBack = { left: true, right: true }
function startReturn(hand, to) {
  const from = hands[hand], length = dist(from, to)
  const mid = from.map((x, k) => (x + to[k]) / 2)
  const body = shoulder(hand)
  const inward = [body[0] - mid[0], 0, body[2] - mid[2]]
  const n = Math.hypot(...inward) || 1
  // Down and in, less any part along the line itself, which would only speed
  // the hand along it: a level return sags down, and a steep one, such as
  // from the overhead, bows in toward the body.
  const u = length > 1e-6 ? to.map((x, k) => (x - from[k]) / length) : [0, 0, 0]
  let way = [inward[0] / n * 0.5, -1, inward[2] / n * 0.5]
  const along = way[0] * u[0] + way[1] * u[1] + way[2] * u[2]
  way = way.map((x, k) => x - along * u[k])
  const m = Math.hypot(...way)
  const sag = m > 1e-3 ? Math.min(tune.arcM, 0.3 * length) : 0
  returns[hand] = { from, control: mid.map((x, k) => x + (m > 1e-3 ? way[k] / m : 0) * 2 * sag), start: Date.now(), length: tune.backS * Math.min(1, Math.max(1 / 3, Math.sqrt(length / 0.6))) }
}
function follow(hand, to, dt) {
  const r = returns[hand]
  const t = Math.min(1, (Date.now() - r.start) / 1000 / Math.max(0.05, r.length))
  const s = easeOut(t)
  const before = hands[hand]
  hands[hand] = r.from.map((x, k) => (1 - s) * (1 - s) * x + 2 * (1 - s) * s * r.control[k] + s * s * to[k])
  // The speed it leaves with, should a click send it out again on the spring.
  speeds[hand] = hands[hand].map((x, k) => (x - before[k]) / Math.max(dt, 1e-3))
  if (t >= 1) { returns[hand] = null; speeds[hand] = [0, 0, 0] }
}
let lastRecorded = 0
function drive(dt) {
  for (const hand of ["left", "right"]) {
    const t = target(hand)
    if (t.back && !wasBack[hand]) startReturn(hand, t.at)
    wasBack[hand] = t.back
    if (!t.back) returns[hand] = null
    if (returns[hand]) follow(hand, t.at, dt)
    else spring(hand, t, dt)
  }
  const a = ease(EASE_S.head, dt)
  look.yaw = wrap(look.yaw + turn(look.yaw, gazeTarget.yaw) * a + 180) - 180
  look.pitch += (gazeTarget.pitch - look.pitch) * a
  const v = solve(spec, { eye: eyeFigure, look: { yaw: look.yaw, pitch: look.pitch, roll: 0 }, handL: toFigure(hands.left), handR: toFigure(hands.right) })
  v.COLOR = 0
  const now = Date.now()
  const record = now - lastRecorded >= RECORD_MS
  if (record) lastRecorded = now
  sim.set(VARS, ALL.map((ch) => v[ch.name]), { quiet: true, record, label: "figure variables" })
}
drive(1)

// The seat's offset as the module must receive it to land on WGS 84's
// earth: the module's sphere stretches north and east by WGS 84's radii of
// curvature over its own, so the offset shrinks by the same.
const WGS_A = 6_378_137, WGS_E2 = 0.00669437999014, SPHERE_M = 6_371_000
let attitude = null
sim.watch([["PLANE LATITUDE", "degrees"], ["PLANE HEADING DEGREES TRUE", "degrees"], ["PLANE PITCH DEGREES", "degrees"], ["PLANE BANK DEGREES", "degrees"]], {
  period: "frame",
  label: "attitude",
  onData: (got) => {
    attitude = { lat: got.get("PLANE LATITUDE") ?? attitude?.lat ?? 0, hdg: got.get("PLANE HEADING DEGREES TRUE") ?? attitude?.hdg ?? 0, pitch: got.get("PLANE PITCH DEGREES") ?? attitude?.pitch ?? 0, bank: got.get("PLANE BANK DEGREES") ?? attitude?.bank ?? 0 }
  },
})
for (let i = 0; i < 40 && !attitude; i++) await sleep(50)
function moduleOffset() {
  const body = { forward: seat.at[2], right: -seat.at[0], up: seat.at[1] }
  if (!attitude) return body
  const s = Math.sin(attitude.lat * RAD)
  const M = WGS_A * (1 - WGS_E2) / (1 - WGS_E2 * s * s) ** 1.5, N = WGS_A / Math.sqrt(1 - WGS_E2 * s * s)
  const ned = frameToNed(attitude, body)
  return nedToFrame(attitude, [ned[0] * SPHERE_M / M, ned[1] * SPHERE_M / N, ned[2]])
}
const sendSeat = () => { const o = moduleOffset(); setModule({ FWD: o.forward, RIGHT: o.right, UP: o.up }); return o }

const v0 = await sim.read(POS)
const init = new InitPosition()
Object.assign(init, { latitude: v0.get("PLANE LATITUDE"), longitude: v0.get("PLANE LONGITUDE"), altitude: v0.get("PLANE ALTITUDE"), pitch: 0, bank: 0, heading: wrap(v0.get("PLANE HEADING DEGREES TRUE")), onGround: false, airspeed: 0 })
const r = await sim.spawn(FIGURE, "", init)
if (r.id === undefined) { note("figure", `${FIGURE}: not created: ${r.error}. Is crosscheck-figure built and mounted?`); await finish("a failed spawn") }
figure = r.id
for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: figure, quiet: true })
setModule({ OBJECT: figure, OBJECT2: 0, SCALE: 0, COLOR: 0, SIGN_PITCH: SIGNS[0], SIGN_BANK: SIGNS[1], LEAD })
const sent = sendSeat()
setModule({ MODE: 1 })
note("figure", `${FIGURE}: object ${figure}, placed by the module on the seat point every frame, led by ${LEAD} frame; at latitude ${fmt(attitude?.lat)}°, heading ${fmt(attitude?.hdg)}°, it gets the seat as ${(sent.forward - seat.at[2]) * 100 >= 0 ? "+" : ""}${((sent.forward - seat.at[2]) * 100).toFixed(1)}cm forward and ${(sent.right + seat.at[0]) * 100 >= 0 ? "+" : ""}${((sent.right + seat.at[0]) * 100).toFixed(1)}cm right of the true offset, for WGS 84`)

// ------------------------------------------------ the presses (p21)

let grab = null
let rightPress = null
let lastWheel = 0
let wheelPress = null
const pixels = (m, a) => Math.hypot((m.x - a.x) * m.width / 2, (m.y - a.y) * m.height / 2)
stopMouse = await startMouse((m) => {
  if (m.width && m.height) windowSize = { width: m.width, height: m.height }
  if (m.kind === "size") return
  if (!m.foreground) { if (m.kind === "left") stats.outside++; return }
  const c = cam
  if (!c || m.t - c.t > 500) return
  if (m.kind === "right") { rightPress = { m, c }; return }
  if (m.kind === "rightup") {
    const p = rightPress
    rightPress = null
    if (!p) return
    if (m.t - p.m.t >= TAP_MS || pixels(m, p.m) >= DRAG_PX || m.delta >= DRAG_COUNTS) { stats.looks++; return }
    const r = begin(p.m, p.c, "right click")
    if (r) release(r, tune.lingerMs)
    return
  }
  if (m.kind === "wheel") {
    // Notches in a row turn the same knob: the hand stays on it.
    if (m.t - lastWheel < 600 && wheelPress) { lastWheel = m.t; release(wheelPress, WHEEL_LINGER_MS); return }
    lastWheel = m.t
    wheelPress = begin(m, c, "wheel")
    if (wheelPress) release(wheelPress, WHEEL_LINGER_MS)
    return
  }
  if (m.kind === "left") {
    const r = begin(m, c, "press")
    grab = r ? { start: m, point: r.hit.point, normal: r.hit.normal, thumb: r.thumb, cursorPx: 0, raw: 0 } : null
    return
  }
  if (!grab) return
  if (m.kind === "move") {
    // A thumb stays on its button; a tapping hand glides.
    const onPlane = grab.thumb ? null : crossPlane(eyeOf(c), rayThrough(c, m, MEASURED), grab.point, grab.normal)
    if (onPlane) state.tap = onPlane
    grab.cursorPx = Math.max(grab.cursorPx, pixels(m, grab.start))
    grab.raw += Math.hypot(m.dx, m.dy)
  } else if (m.kind === "leftup") {
    if (grab.cursorPx >= DRAG_PX || grab.raw >= DRAG_COUNTS) stats.drags++
    release(grab, tune.lingerMs)
    grab = null
  }
})

// ------------------------------------------------ the loops

let last = Date.now()
const tick = setInterval(() => {
  const now = Date.now()
  if (state.thumb && state.thumbUntil && now > state.thumbUntil && !grab?.thumb) { state.thumb = null; state.thumbUntil = 0 }
  if (!grab && state.lingerUntil && now > state.lingerUntil) { state.lingerUntil = 0; state.hover = true }
  if (!grab && state.sessionUntil && now > state.sessionUntil) {
    state.sessionUntil = 0
    state.tap = null
    state.tapHand = null
    state.hover = false
    state.stickHeld = true
    stats.sessions++
  }
  sendSeat()
  drive((now - last) / 1000)
  last = now
}, TICK_MS)
const looking = setInterval(gaze, GAZE_MS)
const speedWatch = setInterval(async () => { const s = await sim.readOne("GROUND VELOCITY", "knots").catch(() => 0); stats.maxSpeed = Math.max(stats.maxSpeed, s || 0) }, 5000)

console.log(`\n▶ The figure in the right seat${standIn ? ", with the A350's cockpit standing in" : ""}\n  Click, drag, and right-click around, and look around: its hands and head follow. Parked or flying. ${SKIP} ends.`)
beep(1000, 100)
const why = await new Promise((resolve) => {
  keys.listen((k) => { if (k.key === "SKIP") resolve("Page Up") })
  fs.watchFile(STOP_FILE, { interval: 500 }, (now) => { if (now.mtimeMs > STARTED_MS) resolve("the stop file") })
  setTimeout(() => resolve("the 60-minute cap"), CAP_MS)
})
clearInterval(tick)
clearInterval(looking)
clearInterval(speedWatch)
clearInterval(poll)
await finish(why)
