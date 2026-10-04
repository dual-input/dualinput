/*
 * p26: the figure in the Synaptic A220's right seat, for the pilot to play
 * with on MSFS 2024: its hands go where the pilot clicks, its right hand holds
 * the first officer's sidestick at rest, its head looks where the pilot looks,
 * and the module holds it in its seat, parked or flying.
 *
 * It's p25 with a sidestick for the yoke. The tentative decisions leave
 * sidesticks out (record/areas/avatars/decisions.md), so the hands follow
 * first-try rules for the right seat:
 *
 *   home      the right hand holds the first officer's stick; the left rests
 *   a press   more than 5cm right of the seat's centerline: the right hand
 *             lets go of the stick and taps; anywhere else: the left hand taps
 *   the stick a press on the first officer's stick is the right thumb, and the
 *             hand keeps hold
 *   a drag    the tapping hand glides on the surface it touched (p20)
 *   release   the tapping hand stays 0.25s on the spot, then hovers 5cm off
 *             it; 2s after the last release both hands go home
 *
 * The grip: nothing in the A220 marks one (record/areas/avatars/log.md,
 * 2026-10-04), so the hand aims at the middle of FO_STICK_HANDLE's mesh and
 * sits on the grip's surface toward the copilot's eye, one hand's radius out,
 * kept in the grip's own frame, as p25 sits the hand on the yoke's horn.
 *
 * The pose: the A220 keeps its animation code in templates whose parameters
 * lib/cockpit-files.mjs doesn't fill in, so only the two sticks are posed, from
 * Sidestick.xml's "(L:A22X L Sidestick X, Percent) neg 2 / 50 +" and its R and
 * Y forms (synaptic-aircraft-a220 1.0.10). Everything else stays as the files
 * store it, so a click's ray can meet a part where the file has it rather
 * than where the sim has moved it, or one the sim hides. Nothing writes the R
 * pair (record/areas/aircraft/synaptic-a220/study.md), so the first officer's
 * stick stays centered.
 *
 * The seat: the A220 has no PILOT_ node, so the seat point sits under the
 * copilot's eye from cameras.cfg as the Baron's PILOT_1 sits under its
 * copilot's eye, 0.678m down and 0.062m forward (bksq-aircraft-baronpro 0.1.1,
 * BaronProfessional_Base_INT.gltf and cameras.cfg), at the side of the first
 * officer's seat node, SKEL_FO_SEAT.
 *
 * The frame: the cockpit model hangs from the interior's ROOT node, at the
 * origin (Function_Interior_A220's attached_objects.cfg and ROOT.gltf), and
 * its sticks sit where cameras.cfg's eyes say they should, so the model's
 * space is taken as SimConnect's SIMOBJECT space, as it was within 3mm in the
 * Baron (p21). The probe prints how far the camera is from cameras.cfg's
 * Pilot eye at the start, which settles it in the A220 when the pilot starts
 * from that view.
 *
 * In the Synaptic A220-300, parked or flying, from the left seat:
 *
 *   play      Click, drag, and right-click around the panel, the pedestal,
 *             the overhead, the first officer's side and stick, and look
 *             around: the figure's hands and head follow. Page Up ends; it
 *             ends by itself after 60 minutes.
 *
 *   node experiments/areas/avatars/p26-a220-figure.mjs
 *
 * It needs crosscheck-figure built and mounted, and crosscheck-p12-follow
 * 0.6.0 running. Nothing touches the pilot's input: clicks are read through
 * Raw Input (experiments/tools/mouse.mjs). The probe turns the module off and
 * removes the figure at the end and on Ctrl+C.
 */

import fs from "node:fs"
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
import { findAnimation, poseAt } from "./lib/animate.mjs"
import { apply, invert } from "./lib/gltf.mjs"
import { MEASURED, rayThrough } from "./lib/pick.mjs"
import { RAD, turn, wrap } from "./lib/pose.mjs"
import { cast, crossPlane, loadCockpit, repose, subtree } from "./lib/raycast.mjs"
import { compile } from "./lib/rpn.mjs"

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const FIGURE = "CROSSCHECK_Figure"
const PACKAGE = "synaptic-aircraft-a220"
const BASE = "SimObjects/Airplanes/Synaptic_A220"
// The cockpit, then its walls and glareshield; posing and the stick's nodes
// refer to the first.
const MODELS = [
  `${BASE}/attachments/inibuilds/Part_Interior_A223_Cockpit/model/A220_Cockpit_LOD00.gltf`,
  `${BASE}/attachments/inibuilds/Part_Interior_A223_Cockpit_Static/model/A220_Cockpit_Static_LOD00.gltf`,
]
// The preset folders' cameras.cfg files hold no cockpit eyes; the common one does.
const CAMERAS = `${BASE}/common/config/cameras.cfg`
const STICKS = {
  captain: { handle: "CPT_STICK_HANDLE", roll: "SIDE_STICK_ROLL_CPT", pitch: "SIDE_STICK_PITCH_CPT", x: "A22X L Sidestick X", y: "A22X L Sidestick Y" },
  firstOfficer: { handle: "FO_STICK_HANDLE", roll: "SIDE_STICK_ROLL_FO", pitch: "SIDE_STICK_PITCH_FO", x: "A22X R Sidestick X", y: "A22X R Sidestick Y" },
}
const SEAT_NODE = "SKEL_FO_SEAT"
const EYE_TO_SEAT = { fwd: 0.062, up: -0.678 }
const BAND_M = 0.05
const LINGER_MS = { release: 250, wheel: 1000 }
const SESSION_MS = 2000
const HOVER_M = 0.05
const TAP_MS = 300
const DRAG_PX = 5
const DRAG_COUNTS = 20
const CAP_MS = 60 * 60_000
// p15: nose up and right wing down are both negative; lead 1 frame (p16).
const SIGNS = [-1, -1]
const LEAD = 1
const TICK_MS = 33
// How long the hands and the head take to get most of the way to a target:
// each tick closes 1 - e^(-dt / s) of what's left.
const EASE_S = { hand: 0.06, head: 0.12 }
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

const rec = new Recorder("p26-a220-figure", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p26-a220-figure" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()
const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); console.log(`  ${text}`); rec.log(kind, text, fields) }

async function readModule(names) {
  const v = await sim.read(names.map(L), { timeoutMs: 2000 })
  return Object.fromEntries(names.map((n) => [n, v.get(`L:CROSSCHECK_P12_${n}`) ?? null]))
}
const setModule = (values) => { for (const [k, x] of Object.entries(values)) sim.set([L(k)], [x], { label: `set CROSSCHECK_P12_${k}`, quiet: true }) }

const stats = { presses: { left: 0, right: 0 }, thumbs: 0, sessions: 0, drags: 0, looks: 0, outside: 0, gazeHits: 0, gazeMisses: 0, maxSpeed: 0 }
const stickRange = {}
let figure = null
let stopMouse = null
let finished = false
async function finish(why) {
  if (finished) return
  finished = true
  if (stopMouse) stopMouse()
  const m = await readModule(["FRAMES", "ERRORS", "LAST_ERROR"]).catch(() => null)
  setModule({ MODE: 0, OBJECT: 0, OBJECT2: 0, LEAD: 0 })
  if (figure !== null) sim.remove(figure)
  await sleep(800)
  if (m) note("module", `the module wrote the figure in ${plural(m.FRAMES ?? 0, "frame")}, with ${plural(m.ERRORS ?? 0, "error")}${m.ERRORS ? ` (last ${fmt(m.LAST_ERROR)})` : ""}`)
  note("presses", `the left hand tapped ${plural(stats.presses.left, "time")} and the right hand ${plural(stats.presses.right, "time")}, ${plural(stats.drags, "drag")}; the right thumb pressed the first officer's stick ${plural(stats.thumbs, "time")}; the hands went home after ${plural(stats.sessions, "session")}; ${plural(stats.looks, "right press", "right presses")} turned the view; ${plural(stats.outside, "click")} outside the sim`)
  note("sticks", `the stick variables ranged ${Object.entries(stickRange).map(([k, r]) => `L:${k} ${fmt(r.min)} to ${fmt(r.max)}`).join(", ") || "nowhere: none was read"}`)
  note("head", `the middle of the view met the cockpit on ${plural(stats.gazeHits, "look")} and nothing on ${stats.gazeMisses}; the aircraft reached ${fmt(Math.round(stats.maxSpeed))} kt over the run`)
  const text = [
    "p26 · The figure in the Synaptic A220's right seat: hands by the pilot's clicks with the right hand on the first officer's sidestick at rest, head by the pilot's look, held in its seat by the module, on MSFS 2024",
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
if (!/A220/i.test(title ?? "")) { note("setup", "the loaded aircraft isn't an A220"); await finish("another aircraft") }
const pkg = findPackage(PACKAGE)
if (!pkg) { note("setup", `${PACKAGE} isn't installed`); await finish("no package") }
const manifest = JSON.parse(fs.readFileSync(path.join(pkg, "manifest.json"), "utf8"))
const cockpit = loadCockpit(MODELS.map((m) => path.join(pkg, m)))
const model = cockpit.models[0]
note("model", `${PACKAGE} ${manifest.package_version}: ${MODELS.map((m) => path.basename(m)).join(" and ")}, ${plural(cockpit.triangles, "triangle")}`)

// ------------------------------------------------ the sticks, posed from Sidestick.xml's code

const nodeIndex = (name) => model.nodes.findIndex((n) => n.name === name)
const sticks = {}
for (const [side, s] of Object.entries(STICKS)) {
  const roll = findAnimation(model.g, s.roll), pitch = findAnimation(model.g, s.pitch), handle = nodeIndex(s.handle)
  if (!roll || !pitch || handle < 0) { note("stick", `the ${side}'s stick: ${s.handle} ${handle < 0 ? "missing" : "found"}, ${s.roll} ${roll ? "found" : "missing"}, ${s.pitch} ${pitch ? "found" : "missing"}`); await finish("no stick") }
  // The code reads the variables as Percent; an L: variable holds one number
  // whatever unit it's read in (unverified for these two), so it's read as number.
  sticks[side] = { ...s, index: handle, plays: [{ animation: roll, code: compile(`(L:${s.x}, number) neg 2 / 50 +`) }, { animation: pitch, code: compile(`(L:${s.y}, number) neg 2 / 50 +`) }] }
}
const plays = [...sticks.captain.plays, ...sticks.firstOfficer.plays]
const moved = new Set()
for (const p of plays) for (const ch of p.animation.channels) for (const n of subtree(model, ch.target.node)) moved.add(n)
const values = new Map()
const get = (v) => values.get(`L:${v.name}`) ?? 0
const watchList = Object.values(STICKS).flatMap((s) => [s.x, s.y]).map((n) => [`L:${n}`, "number"])
sim.watch(watchList, {
  period: "frame",
  label: "stick variables",
  onData: (got) => {
    for (const [k, v] of got) {
      values.set(k, v)
      const name = k.replace(/^L:/, "")
      const r = (stickRange[name] ??= { min: v, max: v })
      r.min = Math.min(r.min, v)
      r.max = Math.max(r.max, v)
    }
  },
})
const fullPose = () => poseAt(model, plays.map((p) => ({ animation: p.animation, frame: p.code.run(get), length: 100 })))

// The first officer's own stick: everything under the highest node above its
// grip that the stick's animations move, so a press on it is the thumb.
const fo = sticks.firstOfficer
const foMoved = new Set()
for (const p of fo.plays) for (const ch of p.animation.channels) for (const n of subtree(model, ch.target.node)) foMoved.add(n)
let ownRoot = fo.index
for (let j = model.parent[fo.index]; j !== -1; j = model.parent[j]) if (foMoved.has(j)) ownRoot = j
const ownStick = subtree(model, ownRoot)
note("stick", `the first officer's stick is ${plural(ownStick.size, "node")} under ${model.nodes[ownRoot].name}, posed by ${fo.roll} and ${fo.pitch}`)

// ------------------------------------------------ the eyes and the seat

const cams = eyes(path.join(pkg, CAMERAS), { pilot: "Pilot", copilot: "CoPilot" })
if (!cams.copilot || !cams.pilot) { note("setup", "no Pilot or CoPilot camera in cameras.cfg"); await finish("no eyes") }
const toModel = (e) => [-e.right, e.up, e.fwd]
const eyeModel = toModel(cams.copilot)
const pilotEye = toModel(cams.pilot)
const seatNode = nodeIndex(SEAT_NODE)
if (seatNode < 0) { note("setup", `no ${SEAT_NODE}`); await finish("no seat") }
const seat = { name: `under the copilot's eye, at ${SEAT_NODE}'s side`, at: [apply(model.world[seatNode], [0, 0, 0])[0], eyeModel[1] + EYE_TO_SEAT.up, eyeModel[2] + EYE_TO_SEAT.fwd] }
// Model space (+x left, y up, z forward) as the figure's frame from the seat.
const toFigure = (p) => ({ fwd: p[2] - seat.at[2], right: -(p[0] - seat.at[0]), up: p[1] - seat.at[1] })
const fromFigure = (f) => [seat.at[0] - f.right, seat.at[1] + f.up, seat.at[2] + f.fwd]
const eyeFigure = toFigure(eyeModel)
const rest = {
  left: fromFigure({ fwd: spec.rest.hand.fwd, right: -spec.rest.hand.right, up: spec.rest.hand.up }),
  right: fromFigure({ fwd: spec.rest.hand.fwd, right: spec.rest.hand.right, up: spec.rest.hand.up }),
}
note("setup", `the seat point at ${pt(seat.at)} in the model, ${seat.name}; the copilot's eye at ${pt(eyeModel)}`)

// ------------------------------------------------ the grip

// The middle of the grip's mesh, in the grip's own frame.
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
let gripLocal = meshMiddle(fo.index)
{
  const world = fullPose()
  repose(cockpit, 0, world, moved)
  const middle = apply(world[fo.index], gripLocal)
  const hit = cast(cockpit, eyeModel, middle.map((x, k) => x - eyeModel[k]), { only: ownStick })
  if (!hit || hit.distance > dist(eyeModel, middle)) note("grip", "no grip surface between the copilot's eye and the grip's middle, so the hand sits on the middle")
  else {
    gripLocal = apply(invert(world[fo.index]), hit.point.map((x, k) => x + hit.normal[k] * HAND_RADIUS))
    note("grip", `the hand sits on ${hit.chain[0]}'s surface, ${(dist(middle, hit.point) * 100).toFixed(1)}cm from the grip's middle toward the copilot's eye`)
  }
}
const stickNow = () => {
  const world = fullPose()
  return { world, grip: apply(world[fo.index], gripLocal) }
}

// ------------------------------------------------ the camera

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
// SIMOBJECT is the model's space (p18, p21).
const eyeOf = (c) => [c.x, c.y, c.z]
note("camera", `the camera is ${(dist(eyeOf(cam), pilotEye) * 100).toFixed(1)}cm from cameras.cfg's Pilot eye (${pt(eyeOf(cam))} against ${pt(pilotEye)}); within a few centimeters, if the view is the Pilot view, means the model's space is SimConnect's`)

// ------------------------------------------------ the hands' state

const state = { stickHeld: true, tapHand: null, tap: null, normal: null, hover: false, thumb: null, lingerUntil: 0, thumbUntil: 0, sessionUntil: 0 }
let stick = stickNow()

// Where each hand's ball goes now, in model space.
function target(hand) {
  if (hand === "right" && state.thumb) return apply(stick.world[state.thumb.node], state.thumb.local)
  if (hand === state.tapHand && state.tap) return state.tap.map((x, k) => x + state.normal[k] * (HAND_RADIUS + (state.hover ? HOVER_M : 0)))
  if (hand === "right" && state.stickHeld) return stick.grip
  return rest[hand]
}

// Right of the seat's centerline by more than the band is the right hand's.
const rightOfSeat = (p) => -(p[0] - seat.at[0])
const tapper = (p) => (rightOfSeat(p) > BAND_M ? "right" : "left")

function hitAt(m, c) {
  repose(cockpit, 0, fullPose(), moved)
  return cast(cockpit, eyeOf(c), rayThrough(c, m, MEASURED))
}

function begin(m, c, label) {
  stick = stickNow()
  const hit = hitAt(m, c)
  if (!hit) { console.log(`  ${label}: nothing`); return null }
  const thumb = hit.file === model.name && ownStick.has(hit.node)
  const hand = thumb ? "right" : tapper(hit.point)
  if (thumb) {
    stats.thumbs++
    state.thumb = { node: hit.node, local: apply(invert(stick.world[hit.node]), hit.point.map((x, k) => x + hit.normal[k] * HAND_RADIUS)) }
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
  rec.log("press", `${label}: ${hit.chain[0]}, ${(Math.abs(side) * 100).toFixed(1)}cm ${side > 0 ? "right" : "left"} of the seat's centerline: ${what}`, { mouse: m, cam: c, hit: { point: hit.point, normal: hit.normal, distance: hit.distance, chain: hit.chain, file: hit.file }, hand, thumb })
  console.log(`  ${label}: ${hit.chain[0]}, ${thumb ? "right thumb" : `${hand} hand`}`)
  return { hit, thumb }
}

function release(r, ms) {
  const now = Date.now()
  if (r.thumb) { state.thumbUntil = now + ms; return }
  state.lingerUntil = now + ms
  state.sessionUntil = now + ms + SESSION_MS
}

// ------------------------------------------------ the head

// The point the middle of the pilot's view rests on, or with nothing there,
// the way the pilot looks, as the figure's yaw and pitch from its own eye.
const look = { yaw: -40, pitch: -5 }
let gazeTarget = { ...look }
function gaze() {
  const c = cam
  if (!c || Date.now() - c.t > 500) return
  const dir = rayThrough(c, { x: 0, y: 0, ...windowSize }, MEASURED)
  repose(cockpit, 0, fullPose(), moved)
  const hit = cast(cockpit, eyeOf(c), dir)
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
const hands = { left: target("left"), right: target("right") }
let lastRecorded = 0
function drive(dt) {
  stick = stickNow()
  for (const hand of ["left", "right"]) {
    const t = target(hand), a = ease(EASE_S.hand, dt)
    hands[hand] = hands[hand].map((x, k) => x + (t[k] - x) * a)
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

const v0 = await sim.read(POS)
const init = new InitPosition()
Object.assign(init, { latitude: v0.get("PLANE LATITUDE"), longitude: v0.get("PLANE LONGITUDE"), altitude: v0.get("PLANE ALTITUDE"), pitch: 0, bank: 0, heading: wrap(v0.get("PLANE HEADING DEGREES TRUE")), onGround: false, airspeed: 0 })
const r = await sim.spawn(FIGURE, "", init)
if (r.id === undefined) { note("figure", `${FIGURE}: not created: ${r.error}. Is crosscheck-figure built and mounted?`); await finish("a failed spawn") }
figure = r.id
for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: figure, quiet: true })
setModule({ OBJECT: figure, OBJECT2: 0, FWD: seat.at[2], RIGHT: -seat.at[0], UP: seat.at[1], SCALE: 0, COLOR: 0, SIGN_PITCH: SIGNS[0], SIGN_BANK: SIGNS[1], LEAD })
setModule({ MODE: 1 })
note("figure", `${FIGURE}: object ${figure}, placed by the module on the seat point every frame, led by ${LEAD} frame`)

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
    if (r) release(r, LINGER_MS.release)
    return
  }
  if (m.kind === "wheel") {
    // Notches in a row turn the same knob: the hand stays on it.
    if (m.t - lastWheel < 600 && wheelPress) { lastWheel = m.t; release(wheelPress, LINGER_MS.wheel); return }
    lastWheel = m.t
    wheelPress = begin(m, c, "wheel")
    if (wheelPress) release(wheelPress, LINGER_MS.wheel)
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
    release(grab, LINGER_MS.release)
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
  drive((now - last) / 1000)
  last = now
}, TICK_MS)
const looking = setInterval(gaze, GAZE_MS)
const speedWatch = setInterval(async () => { const s = await sim.readOne("GROUND VELOCITY", "knots").catch(() => 0); stats.maxSpeed = Math.max(stats.maxSpeed, s || 0) }, 5000)

console.log(`\n▶ The figure in the A220's right seat\n  Click, drag, and right-click around the panel, the pedestal, the overhead, the first officer's side and stick, and look around: its hands and head follow. Parked or flying. ${SKIP} ends.`)
beep(1000, 100)
const why = await new Promise((resolve) => {
  keys.listen((k) => { if (k.key === "SKIP") resolve("Page Up") })
  setTimeout(() => resolve("the 60-minute cap"), CAP_MS)
})
clearInterval(tick)
clearInterval(looking)
clearInterval(speedWatch)
clearInterval(poll)
await finish(why)
