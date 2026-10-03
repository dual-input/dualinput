/*
 * p25: the figure in the copilot's seat, driven as a session would drive it,
 * on MSFS 2024: its hands go where the pilot clicks, by the yoke rules with the
 * seats swapped, its head looks where the pilot looks, and the module holds it
 * in its seat in flight.
 *
 * The pilot clicks from the left seat, and the figure acts as the right-seat
 * pilot those clicks belong to. Each click's ray (lib/pick.mjs) meets the
 * cockpit model, posed from the aircraft's own code as in p23, and the point
 * it meets, relative to the aircraft, is what a session would send. The head
 * turns, from the copilot's eye, to whatever the middle of the pilot's view
 * rests on, and with nothing there, looks the way the pilot looks.
 *
 * The hands follow the tentative decisions (record/areas/avatars/decisions.md)
 * with the seats swapped:
 *
 *   home      the right hand holds the copilot's yoke; the left hand rests
 *   a press   right of that yoke's wheel by more than 5cm: the right hand taps
 *             and the left takes the yoke; left of it by more than 5cm: the
 *             left hand taps and the right keeps the yoke; in between: the
 *             hand that's free taps
 *   the yoke  a press on the copilot's own yoke is the thumb on its side, and
 *             the hand holding the yoke keeps hold
 *   a drag    the tapping hand glides on the surface it touched (p20)
 *   release   the tapping hand stays 0.25s on the spot, then hovers 5cm off it;
 *             2s after the last release both go home, the right hand taking
 *             the yoke 0.3s before the left lets go
 *   hidden    with the copilot's yoke hidden, both hands rest unless one taps
 *
 * The Baron marks grips only on the pilot's yoke (HANDLING_Yoke_1_Hand_Left
 * and _Right, children of Yoke_L), and its copilot's yoke is the same
 * hierarchy, YokePitch_R, YokeRoll_R, and Yoke_R, moved by the same two
 * animations. Each grip keeps its place relative to the yoke's roll node: the
 * pilot's relative to YokeRoll_L, placed relative to YokeRoll_R. Yoke_R is
 * turned 180° from Yoke_L, and grips placed under it missed the copilot's
 * yoke, while relative to YokeRoll_R a ray from the copilot's eye met the horn
 * 1.7cm before each grip, as it does on the pilot's yoke (checked offline in
 * bksq-aircraft-baronpro 0.1.1). The hand goes on that surface.
 *
 * The figure is CROSSCHECK_Figure (figure/build.mjs), its joints set as global
 * L: variables through SimConnect, as in p24. The hands and the head ease
 * toward their targets over about 60ms and 120ms. crosscheck-p12-follow places
 * the figure on the copilot's seat node every frame, turned by the aircraft's
 * full attitude and led by one frame, which held a seated figure in a flying
 * aircraft (record/areas/avatars/log.md, p15 and p16).
 *
 * In the Black Square Baron 58P, parked or flying, from the left seat:
 *
 *   clicks    Click, drag, and right-click around the panel, the copilot's
 *             yoke and its buttons, and the pilot's side, and look around: the
 *             figure's hands and head follow. Page Up ends; it ends by itself
 *             after 30 minutes.
 *
 *   node experiments/areas/avatars/p25-figure-hands.mjs
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
import { Recorder, fmt, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { eyes } from "./figure/cockpit.mjs"
import { CHANNELS, colorChannel, variable } from "./figure/model.mjs"
import { solve } from "./figure/solve.mjs"
import { findAnimation, poseAt } from "./lib/animate.mjs"
import { animationCode, behaviorText, cockpitFiles, visibilityCode } from "./lib/cockpit-files.mjs"
import { apply, invert, mul } from "./lib/gltf.mjs"
import { MEASURED, rayThrough } from "./lib/pick.mjs"
import { RAD, turn, wrap } from "./lib/pose.mjs"
import { cast, crossPlane, loadCockpit, repose, subtree } from "./lib/raycast.mjs"
import { compile } from "./lib/rpn.mjs"

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const FIGURE = "CROSSCHECK_Figure"
const GRIP = { left: "HANDLING_Yoke_1_Hand_Left", right: "HANDLING_Yoke_1_Hand_Right" }
const WHEEL = "HANDLING_Yoke_1_Wheel_Center"
// The hand that holds the yoke when nothing's being clicked: the right, in the
// right seat.
const HOME = "right"
const BAND_M = 0.05
const LINGER_MS = { release: 250, wheel: 1000 }
const OVERLAP_MS = 300
const SESSION_MS = 2000
const HOVER_M = 0.05
const TAP_MS = 300
const DRAG_PX = 5
const DRAG_COUNTS = 20
const CAP_MS = 30 * 60_000
// p15: nose up and right wing down are both negative; lead 1 frame (p16).
const SIGNS = [-1, -1]
const LEAD = 1
const TICK_MS = 33
// How long the hands and the head take to get most of the way to a target:
// each tick closes 1 - e^(-dt / s) of what's left.
const EASE_S = { hand: 0.06, head: 0.12 }
const GAZE_MS = 200
// The figure's variables go to the sim every tick and into the record this
// often, enough to replay a session in the dev page: every tick filled 43MB in
// 19 minutes.
const RECORD_MS = 200
const SIMOBJECT = 1
const L = (n) => [`L:CROSSCHECK_P12_${n}`, "number"]
const other = (hand) => (hand === "left" ? "right" : "left")
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const pt = (p) => p.map((x) => x.toFixed(3)).join(", ")

const spec = JSON.parse(fs.readFileSync(new URL("./figure/figure.json", import.meta.url), "utf8"))
const ALL = [...CHANNELS, colorChannel(spec)]
const VARS = ALL.map((ch) => [`L:${variable(ch)}`, "number"])
const HAND_RADIUS = spec.hand.radius

const rec = new Recorder("p25-figure-hands", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p25-figure-hands" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()
const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); rec.log(kind, text, fields) }

async function readModule(names) {
  const v = await sim.read(names.map(L), { timeoutMs: 2000 })
  return Object.fromEntries(names.map((n) => [n, v.get(`L:CROSSCHECK_P12_${n}`) ?? null]))
}
const setModule = (values) => { for (const [k, x] of Object.entries(values)) sim.set([L(k)], [x], { label: `set CROSSCHECK_P12_${k}`, quiet: true }) }

const stats = { presses: { left: 0, right: 0 }, thumbs: { left: 0, right: 0 }, swaps: 0, sessions: 0, drags: 0, looks: 0, outside: 0, hiddenPresses: 0, gazeHits: 0, gazeMisses: 0, ticks: 0, maxSpeed: 0 }
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
  note("presses", `the left hand tapped ${plural(stats.presses.left, "time")} and the right hand ${plural(stats.presses.right, "time")}, ${plural(stats.drags, "drag")}; on the copilot's yoke, the left thumb pressed ${plural(stats.thumbs.left, "time")} and the right ${plural(stats.thumbs.right, "time")}; the yoke hand swapped ${plural(stats.swaps, "time")}, and the hands went home after ${plural(stats.sessions, "session")}; ${plural(stats.hiddenPresses, "press", "presses")} with the copilot's yoke hidden; ${plural(stats.looks, "right press", "right presses")} turned the view; ${plural(stats.outside, "click")} outside the sim`)
  note("head", `the middle of the view met the cockpit on ${plural(stats.gazeHits, "look")} and nothing on ${stats.gazeMisses}; the aircraft reached ${fmt(Math.round(stats.maxSpeed))} kt over the run`)
  const text = [
    "p25 · The figure in the copilot's seat: hands by the pilot's clicks and the yoke rules with the seats swapped, head by the pilot's look, held in its seat by the module, on MSFS 2024",
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
const files = title ? cockpitFiles(title) : null
if (!files?.gltf) { note("model", `no interior model found for ${JSON.stringify(title)}`); await finish("no model") }
const cockpit = loadCockpit([files.gltf])
const model = cockpit.models[0]

// ------------------------------------------------ the cockpit, posed from its own code (p23)

const behavior = behaviorText(files.xml)
const codes = animationCode(behavior)
// Code that reads its own O: or E: state stays unposed (lib/rpn.mjs).
const runnable = (code) => { try { const c = compile(code, { lenient: true }); return !c.usesState && c.vars.every((v) => v.kind === "A" || v.kind === "L") ? c : null } catch { return null } }
const plays = []
for (const a of model.g.animations ?? []) {
  const entry = codes.get((a.name ?? "").toLowerCase())
  const c = entry && runnable(entry.code)
  if (c) plays.push({ animation: a, length: entry.length, code: c })
}
const moved = new Set()
for (const p of plays) for (const ch of p.animation.channels) for (const n of subtree(model, ch.target.node)) moved.add(n)
const shows = []
for (const [name, code] of visibilityCode(behavior)) {
  const i = model.nodes.findIndex((n) => (n.name ?? "").toLowerCase() === name)
  const c = i >= 0 && runnable(code)
  if (c) shows.push({ node: i, name: model.nodes[i].name, code: c, nodes: subtree(model, i) })
}
const key = (v) => (v.kind === "A" ? v.name : `${v.kind}:${v.name}`)
const values = new Map()
const get = (v) => values.get(key(v)) ?? 0
const watched = new Map()
for (const c of [...plays.map((p) => p.code), ...shows.map((s) => s.code)]) for (const v of c.vars) watched.set(key(v), [key(v), v.unit])
const watchList = [...watched.values()]
for (let i = 0; i < watchList.length; i += 200) sim.watch(watchList.slice(i, i + 200), { period: "frame", label: "cockpit variables", onData: (got) => { for (const [k, v] of got) values.set(k, v) } })
const fullPose = () => poseAt(model, plays.map((p) => ({ animation: p.animation, frame: p.code.run(get), length: p.length })))
const hiddenNow = () => { const h = new Set(); for (const s of shows) if (!s.code.run(get)) for (const n of s.nodes) h.add(n); return h }
note("model", `${files.package}, ${path.basename(files.gltf)}: ${plural(cockpit.triangles, "triangle")}; ${plays.length} of ${plural((model.g.animations ?? []).length, "animation")} posed from their code, ${plural(shows.length, "visibility code")} run`)

// ------------------------------------------------ the copilot's yoke

const nodeIndex = (name) => model.nodes.findIndex((n) => n.name === name)
const pilotGrip = { left: nodeIndex(GRIP.left), right: nodeIndex(GRIP.right) }
const pilotYoke = pilotGrip.left >= 0 ? model.parent[pilotGrip.left] : -1
const pilotYokeName = pilotYoke >= 0 ? model.nodes[pilotYoke].name ?? "" : ""
const copilotYoke = nodeIndex(pilotYokeName.replace(/_L$/, "_R"))
const wheelNode = nodeIndex(WHEEL)
const animX = findAnimation(model.g, files.vr.yoke_anim_x ?? "")
const animY = findAnimation(model.g, files.vr.yoke_anim_y ?? "")
const yokePlays = plays.filter((p) => p.animation === animX || p.animation === animY)
if (pilotGrip.left < 0 || pilotGrip.right < 0 || copilotYoke < 0 || yokePlays.length !== 2) {
  note("yoke", `can't find the copilot's grips: the pilot's grips ${pilotGrip.left >= 0 && pilotGrip.right >= 0 ? `under ${pilotYokeName}` : "missing"}, the copilot's yoke ${copilotYoke >= 0 ? model.nodes[copilotYoke].name : "missing"}, the yoke's animations posed ${yokePlays.length} of 2`)
  await finish("no copilot's yoke")
}
// The grips and the wheel's center relative to the pilot's roll node, the
// yoke node's parent, which the copilot's roll node repeats.
const pilotRoll = model.parent[pilotYoke], copilotRoll = model.parent[copilotYoke]
const inRoll = (i) => mul(invert(model.world[pilotRoll]), model.world[i])
const gripLocal = { left: inRoll(pilotGrip.left), right: inRoll(pilotGrip.right) }
const wheelLocal = wheelNode >= 0 ? inRoll(wheelNode) : inRoll(pilotYoke)
const yokeMoved = new Set()
for (const p of yokePlays) for (const ch of p.animation.channels) for (const n of subtree(model, ch.target.node)) yokeMoved.add(n)
// The copilot's own yoke: everything under the highest node above it that the
// yoke's animations move, so presses on its buttons are thumbs.
let ownRoot = copilotYoke
for (let j = model.parent[copilotYoke]; j !== -1; j = model.parent[j]) if (yokeMoved.has(j)) ownRoot = j
const ownYoke = subtree(model, ownRoot)
const yokeShows = shows.filter((s) => s.nodes.has(copilotYoke))
note("yoke", `the copilot's grips are ${GRIP.left} and ${GRIP.right}, placed relative to ${model.nodes[copilotRoll].name} as they sit relative to ${model.nodes[pilotRoll].name}; its own yoke is ${plural(ownYoke.size, "node")} under ${model.nodes[ownRoot].name}; it shows while ${yokeShows.map((s) => `${s.name}: ${s.code.code}`).join(" and ") || "always"}`)

// Each hand on its grip, in the grip's own frame so it rolls with the yoke:
// on the horn's surface toward the copilot's eye, one hand's radius out, found
// with the yoke centered, as p21 found the pilot's.
const camerasCfg = path.join(path.dirname(files.cfg), "cameras.cfg")
const eyeCfg = fs.existsSync(camerasCfg) ? eyes(camerasCfg, { copilot: "CoPilot" }).copilot : null
if (!eyeCfg) { note("setup", "no CoPilot camera in cameras.cfg"); await finish("no copilot's eye") }
const eyeModel = [-eyeCfg.right, eyeCfg.up, eyeCfg.fwd]
const gripSurface = { left: [0, 0, 0], right: [0, 0, 0] }
const gripMatrix = (world, hand) => mul(world[copilotRoll], gripLocal[hand])
{
  const world = poseAt(model, yokePlays.map((p) => ({ animation: p.animation, frame: p.length / 2, length: p.length })))
  repose(cockpit, 0, world, yokeMoved)
  for (const hand of ["left", "right"]) {
    const g = gripMatrix(world, hand)
    const anchor = apply(g, [0, 0, 0])
    const hit = cast(cockpit, eyeModel, anchor.map((x, k) => x - eyeModel[k]), { only: ownYoke })
    if (!hit || hit.distance > dist(eyeModel, anchor)) { note("grip", `${hand}: no yoke surface between the copilot's eye and the grip, so the hand sits on it`); continue }
    gripSurface[hand] = apply(invert(g), hit.point.map((x, k) => x + hit.normal[k] * HAND_RADIUS))
    note("grip", `${hand}: the copilot's yoke's surface (${hit.chain[0]}) is ${(dist(anchor, hit.point) * 100).toFixed(1)}cm in front of the grip toward the eye`, { surface: gripSurface[hand] })
  }
}
const yokeNow = () => {
  const world = poseAt(model, yokePlays.map((p) => ({ animation: p.animation, frame: p.code.run(get), length: p.length })))
  const grip = { left: apply(gripMatrix(world, "left"), gripSurface.left), right: apply(gripMatrix(world, "right"), gripSurface.right) }
  const wheel = apply(mul(world[copilotRoll], wheelLocal), [0, 0, 0])
  return { world, grip, wheel, shown: yokeShows.every((s) => s.code.run(get)) }
}

// ------------------------------------------------ the seat and the figure's frame

// The copilot's seat node: the model's PILOT_ node right of the centerline
// (PILOT_1 in the Baron, p21). The model's origin is taken as SimConnect's
// reference point, which it matched within 3mm in the Baron (p21), so the
// probe needs no parked calibration and can start in flight.
const seat = model.nodes
  .map((n, i) => ({ name: n.name ?? "", at: apply(model.world[i], [0, 0, 0]) }))
  .filter((s) => /^PILOT_\d+$/i.test(s.name) && s.at[0] < 0)
  .sort((a, b) => a.at[0] - b.at[0])[0]
if (!seat) { note("setup", "no PILOT_ node right of the centerline for the copilot's seat"); await finish("no seat") }
// Model space (+x left, y up, z forward) as the figure's frame from the seat.
const toFigure = (p) => ({ fwd: p[2] - seat.at[2], right: -(p[0] - seat.at[0]), up: p[1] - seat.at[1] })
const fromFigure = (f) => [seat.at[0] - f.right, seat.at[1] + f.up, seat.at[2] + f.fwd]
const eyeFigure = toFigure(eyeModel)
const rest = {
  left: fromFigure({ fwd: spec.rest.hand.fwd, right: -spec.rest.hand.right, up: spec.rest.hand.up }),
  right: fromFigure({ fwd: spec.rest.hand.fwd, right: spec.rest.hand.right, up: spec.rest.hand.up }),
}
note("setup", `the figure on ${seat.name} at ${pt(seat.at)} in the model; the copilot's eye at ${pt(eyeModel)}`)

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

// ------------------------------------------------ the hands' state (p21, seats swapped)

const state = { yokeHand: HOME, tapHand: null, tap: null, normal: null, hover: false, thumb: null, lingerUntil: 0, thumbUntil: 0, sessionUntil: 0, handoff: null }
let yoke = yokeNow()
const holding = (hand) => state.handoff?.from === hand && Date.now() < state.handoff.until && yoke.shown

// A hand leaving the yoke to tap goes at once, since the sim acts on the click
// at once (p21's third run); going home keeps the overlap.
function takeYoke(hand, overlap) {
  state.handoff = overlap && hand !== state.yokeHand && yoke.shown ? { from: state.yokeHand, until: Date.now() + OVERLAP_MS } : null
  state.yokeHand = hand
}

// Where each hand's ball goes now, in model space.
function target(hand) {
  if (holding(hand)) return yoke.grip[hand]
  if (state.thumb?.hand === hand) return apply(yoke.world[state.thumb.node], state.thumb.local)
  if (hand === state.tapHand && state.tap) return state.tap.map((x, k) => x + state.normal[k] * (HAND_RADIUS + (state.hover ? HOVER_M : 0)))
  if (hand === state.yokeHand && yoke.shown) return yoke.grip[hand]
  return rest[hand]
}

function tapper(p) {
  const side = p[0] - yoke.wheel[0]
  if (side > BAND_M) return "left"
  if (side < -BAND_M) return "right"
  return other(state.yokeHand)
}

function hitAt(m, c) {
  repose(cockpit, 0, fullPose(), moved)
  return cast(cockpit, eyeOf(c), rayThrough(c, m, MEASURED), { skip: hiddenNow() })
}

function begin(m, c, label) {
  yoke = yokeNow()
  const hit = hitAt(m, c)
  if (!hit) { console.log(`  ${label}: nothing`); return null }
  const side = hit.point[0] - yoke.wheel[0]
  const thumb = ownYoke.has(hit.node)
  const hand = thumb ? (side > 0 ? "left" : "right") : tapper(hit.point)
  const holder = thumb ? state.yokeHand : other(hand)
  const swapped = holder !== state.yokeHand
  if (swapped) stats.swaps++
  if (!yoke.shown) stats.hiddenPresses++
  ;(thumb ? stats.thumbs : stats.presses)[hand]++
  if (thumb) {
    state.thumb = { hand, node: hit.node, local: apply(invert(yoke.world[hit.node]), hit.point.map((x, k) => x + hit.normal[k] * HAND_RADIUS)) }
    state.thumbUntil = 0
  } else {
    takeYoke(holder, false)
    state.tapHand = hand
    state.tap = hit.point
    state.normal = hit.normal
    state.hover = false
    state.lingerUntil = 0
    state.sessionUntil = 0
  }
  const what = thumb ? `the ${hand} thumb presses it${hand === holder ? ", holding the yoke" : `, the ${holder} hand keeping hold`}` : `the ${hand} hand taps${yoke.shown ? `, the ${holder} holds the yoke` : ", the copilot's yoke hidden"}`
  rec.log("press", `${label}: ${hit.chain[0]}, ${(Math.abs(side) * 100).toFixed(1)}cm ${side > 0 ? "left" : "right"} of the copilot's wheel: ${what}${swapped ? " (swapped)" : ""}`, { mouse: m, cam: c, hit: { point: hit.point, normal: hit.normal, distance: hit.distance, chain: hit.chain }, hand, thumb, swapped })
  console.log(`  ${label}: ${hit.chain[0]}, ${thumb ? `${hand} thumb` : `${hand} hand`}${swapped ? " (swap)" : ""}`)
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
  const hit = cast(cockpit, eyeOf(c), dir, { skip: hiddenNow() })
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
function drive(dt) {
  yoke = yokeNow()
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
  stats.ticks++
}
let lastRecorded = 0
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
note("figure", `${FIGURE}: object ${figure}, placed by the module on ${seat.name} every frame, led by ${LEAD} frame`)

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
    stats.sessions++
    takeYoke(HOME, true)
  }
  if (state.handoff && now >= state.handoff.until) state.handoff = null
  drive((now - last) / 1000)
  last = now
}, TICK_MS)
const looking = setInterval(gaze, GAZE_MS)
const speedWatch = setInterval(async () => { const s = await sim.readOne("GROUND VELOCITY", "knots").catch(() => 0); stats.maxSpeed = Math.max(stats.maxSpeed, s || 0) }, 5000)

console.log(`\n▶ The figure in the copilot's seat\n  Click, drag, and right-click around the panel, the copilot's yoke and its buttons, and the pilot's side, and look around: its hands and head follow. Parked or flying. ${SKIP} ends.`)
beep(1000, 100)
const why = await new Promise((resolve) => {
  keys.listen((k) => { if (k.key === "SKIP") resolve("Page Up") })
  setTimeout(() => resolve("the 30-minute cap"), CAP_MS)
})
clearInterval(tick)
clearInterval(looking)
clearInterval(speedWatch)
clearInterval(poll)
await finish(why)
