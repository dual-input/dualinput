/*
 * p21: the figure's two hands, on MSFS 2024: one holds the yoke where the
 * aircraft marks its grips and follows the yoke as the pilot moves it, and the
 * other taps where the pilot clicks. A click on the far side of the wheel
 * swaps them, as a pilot does.
 *
 * Aircraft mark their yoke grips with the nodes HANDLING_Yoke_1_Hand_Left and
 * _Hand_Right, and aircraft.cfg's [VR] section names the yoke's two animations
 * (record/areas/avatars/log.md, 2026-10-03). The probe reads the code the
 * aircraft's behavior XML plays them with (lib/cockpit-files.mjs), watches the
 * variables that code reads, runs it (lib/rpn.mjs) to get each animation's
 * frame, and poses the model with the animations (lib/animate.mjs). The yoke
 * hand goes on the horn's surface in front of each grip node, toward the
 * pilot, since the nodes sit inside the horns; the click ray (as in p20)
 * meets the posed yoke rather than the one the file stores. Parts the
 * aircraft's visibility code hides, such as a hidden yoke, let the ray through.
 *
 * The hands, after the pilot's own habit in the left seat:
 *
 *   home      the left hand holds the yoke at _Hand_Left; the right hand rests
 *   a press   left of the wheel's center by more than 5cm: the left hand taps
 *             and the right hand takes the yoke at _Hand_Right; right of it by
 *             more than 5cm: the right hand taps and the left holds the yoke;
 *             in between: the hand that's free taps
 *   the yoke  a press on the pilot's own yoke, such as its autopilot
 *             disconnect, is a thumb: the hand on the button's side of the
 *             wheel presses it, and the hand holding the yoke keeps hold
 *   a swap    to tap, both hands move at once, since the sim acts on the click
 *             at once; going home, the home hand takes the yoke first and the
 *             other keeps hold 0.3s more
 *   a drag    the tapping hand glides on the surface it touched (p20); no swap
 *             while the button is down; a thumb stays on its button
 *   release   the tapping hand stays 0.25s on the spot, then hovers 5cm off it;
 *             2s after the last release, with no press since, both go home
 *   hidden    with the yoke hidden, both hands rest unless one is tapping
 *
 * The left hand is the blue ball and the right hand the yellow one, so a swap
 * shows. It needs crosscheck-p12-follow 0.6.0, which places a second object.
 *
 * In the Black Square Baron, or any aircraft with those grip nodes and [VR]
 * names, parked, the sim in front:
 *
 *   yoke      Move the yoke through its travel: the blue ball stays on the
 *             left grip.
 *   clicks    Click and drag across the panel, left and right of the yoke,
 *             and right-click as in p20: the hands swap by side. Hide the yoke
 *             if the aircraft lets you, and click through where it was.
 *             Page Up ends; it ends by itself after 20 minutes.
 *
 *   node experiments/areas/avatars/p21-yoke-hands.mjs
 *
 * Nothing touches the pilot's input: clicks are read through Raw Input
 * (experiments/tools/mouse.mjs) and the yoke through SimConnect. The probe
 * turns the module off and removes both spheres at the end and on Ctrl+C.
 */

import path from "node:path"

import { InitPosition } from "node-simconnect"

import { SKIP, startBeeper, startKeys } from "../../tools/guide.mjs"
import { startMouse } from "../../tools/mouse.mjs"
import { Recorder, fmt, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { findAnimation, poseAt } from "./lib/animate.mjs"
import { animationCode, behaviorText, cockpitFiles, visibilityCode } from "./lib/cockpit-files.mjs"
import { apply, invert } from "./lib/gltf.mjs"
import { MEASURED, rayThrough } from "./lib/pick.mjs"
import { RAD, toBody, wrap } from "./lib/pose.mjs"
import { cast, crossPlane, loadCockpit, repose, subtree } from "./lib/raycast.mjs"
import { compile } from "./lib/rpn.mjs"

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const SPHERE = "CROSSCHECK_HandSphere"
const GRIP = { left: "HANDLING_Yoke_1_Hand_Left", right: "HANDLING_Yoke_1_Hand_Right" }
const WHEEL = "HANDLING_Yoke_1_Wheel_Center"
// The hand that holds the yoke when nothing's being clicked: the pilot's left,
// in the left seat.
const HOME = "left"
// A press this close to the wheel's center line, either side, doesn't swap.
const BAND_M = 0.05
// tools/sphere.mjs's colors: 2 blue, 3 yellow.
const COLOR = { left: 2, right: 3 }
const SCALE = 5
const radius = (scale) => 0.02 * (0.5 + 4.5 * scale / 100)
// The module's first object is the left hand and its second the right.
const SLOT = { left: "", right: "2" }
const LINGER_MS = { release: 250, wheel: 1000 }
// A hand handing the yoke back keeps hold this long after the other takes it.
const OVERLAP_MS = 300
// A run of presses with the same hand is one session: it ends this long after
// the last release, and only then do the hands go home. Between presses, the
// tapping hand hovers this far off its last spot.
const SESSION_MS = 2000
const HOVER_M = 0.05
const TAP_MS = 300
const DRAG_PX = 5
const DRAG_COUNTS = 20
const CAP_MS = 20 * 60_000
// p15: nose up and right wing down are both negative; lead 1 frame (p16).
const SIGNS = [-1, -1]
const LEAD = 1
const L = (n) => [`L:CROSSCHECK_P12_${n}`, "number"]
const SIMOBJECT = 1
const other = (hand) => (hand === "left" ? "right" : "left")

const rec = new Recorder("p21-yoke-hands", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p21-yoke-hands" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()
const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); rec.log(kind, text, fields) }
const where = (b) => `${b.forward.toFixed(3)}m forward, ${b.right.toFixed(3)}m right, ${b.up.toFixed(3)}m up`
const pt = (p) => p.map((x) => x.toFixed(3)).join(", ")
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

async function readModule(names) {
  const v = await sim.read(names.map(L), { timeoutMs: 2000 })
  return Object.fromEntries(names.map((n) => [n, v.get(`L:CROSSCHECK_P12_${n}`) ?? null]))
}
const setModule = (values) => { for (const [k, x] of Object.entries(values)) sim.set([L(k)], [x], { label: `set CROSSCHECK_P12_${k}`, quiet: true }) }

// What happened, summed up however the probe ends.
const stats = { yokeUpdates: 0, fx: [Infinity, -Infinity], fy: [Infinity, -Infinity], presses: { left: 0, right: 0 }, thumbs: { left: 0, right: 0 }, swaps: 0, sessions: 0, hiddenPresses: 0, skippedHits: 0, outside: 0, looks: 0, drags: 0 }
const spheres = []
let stopMouse = null
let finished = false
async function finish(why) {
  if (finished) return
  finished = true
  if (stopMouse) stopMouse()
  setModule({ MODE: 0, OBJECT: 0, OBJECT2: 0, LEAD: 0 })
  for (const id of spheres) sim.remove(id)
  await sleep(800)
  if (stats.yokeUpdates) note("yoke", `${plural(stats.yokeUpdates, "yoke pose")}: roll frames ${stats.fx[0].toFixed(1)} to ${stats.fx[1].toFixed(1)}, fore-aft frames ${stats.fy[0].toFixed(1)} to ${stats.fy[1].toFixed(1)}`)
  if (stats.presses.left + stats.presses.right + stats.thumbs.left + stats.thumbs.right) note("presses", `the left hand tapped ${plural(stats.presses.left, "time")} and the right hand ${plural(stats.presses.right, "time")}, ${plural(stats.drags, "drag")}; on the yoke, the left thumb pressed ${plural(stats.thumbs.left, "time")} and the right ${plural(stats.thumbs.right, "time")}; the yoke hand swapped ${plural(stats.swaps, "time")}, and the hands went home after ${plural(stats.sessions, "session")}; ${plural(stats.hiddenPresses, "press", "presses")} with the yoke hidden, ${plural(stats.skippedHits, "ray")} passing a hidden part to hit behind it; ${plural(stats.looks, "right press", "right presses")} turned the view; ${plural(stats.outside, "click")} outside the sim`)
  const text = [
    "p21 · The figure's two hands: one on the yoke's grip, following the yoke, and one tapping where the pilot clicks, swapping by side, on MSFS 2024",
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
const speed = await sim.readOne("GROUND VELOCITY", "knots")
note("setup", `aircraft TITLE ${JSON.stringify(title)}, ${fmt(speed)} kt`)
if (speed > 1) { note("setup", "moving: start the probe parked"); await finish("not parked") }

const files = title ? cockpitFiles(title) : null
if (!files?.gltf) { note("model", `no interior model found for ${JSON.stringify(title)}`); await finish("no model") }
const cockpit = loadCockpit([files.gltf])
const model = cockpit.models[0]
note("model", `${files.package}, ${path.basename(files.gltf)}: ${plural(cockpit.triangles, "triangle")}`)

// ------------------------------------------------ the yoke, from the files

const nodeIndex = (name) => model.nodes.findIndex((n) => n.name === name)
const grips = { left: nodeIndex(GRIP.left), right: nodeIndex(GRIP.right) }
const wheelNode = nodeIndex(WHEEL)
const animX = findAnimation(model.g, files.vr.yoke_anim_x ?? "")
const animY = findAnimation(model.g, files.vr.yoke_anim_y ?? "")
const behavior = behaviorText(files.xml)
const codes = animationCode(behavior)
const codeX = animX && codes.get(animX.name.toLowerCase())
const codeY = animY && codes.get(animY.name.toLowerCase())
if (grips.left < 0 || grips.right < 0 || !animX || !animY || !codeX || !codeY) {
  note("yoke", `can't pose the yoke: grips ${grips.left >= 0 && grips.right >= 0 ? "found" : "missing"}, [VR] animations ${animX ? animX.name : "missing"} and ${animY ? animY.name : "missing"}, their code ${codeX ? "found" : "missing"} and ${codeY ? "found" : "missing"}`)
  await finish("no yoke")
}
let runX, runY
try { runX = compile(codeX.code); runY = compile(codeY.code) } catch (e) { note("yoke", `can't run the yoke's code: ${e.message}`); await finish("yoke code") }
note("yoke", `${animX.name} plays (${codeX.code}) over ${codeX.length} frames, and ${animY.name} plays (${codeY.code}) over ${codeY.length}`)

// The nodes the yoke animations move, whose triangles follow the pose.
const moved = new Set()
for (const a of [animX, animY]) for (const ch of a.channels) for (const n of subtree(model, ch.target.node)) moved.add(n)
// The pilot's own yoke: everything under the highest moving node above the
// left grip, so the copilot's yoke, moved by the same animations, isn't in it.
let ownRoot = grips.left
for (let j = model.parent[grips.left]; j !== -1; j = model.parent[j]) if (moved.has(j)) ownRoot = j
const ownYoke = subtree(model, ownRoot)

// Every visibility code we can run, for the yoke's grip (is the yoke shown?)
// and for the ray (which parts let it through).
const shows = []
let unreadable = 0
for (const [name, code] of visibilityCode(behavior)) {
  const i = model.nodes.findIndex((n) => (n.name ?? "").toLowerCase() === name)
  if (i < 0) continue
  // Code that reads anything but A: and L: variables would run on zeros and
  // might hide a part that shows, so it counts as unreadable.
  try {
    const compiled = compile(code)
    if (compiled.vars.some((v) => v.kind !== "A" && v.kind !== "L")) { unreadable++; continue }
    shows.push({ node: i, name: model.nodes[i].name, code: compiled, nodes: subtree(model, i) })
  } catch { unreadable++ }
}
const gripShows = shows.filter((s) => s.nodes.has(grips.left))
note("visibility", `${plural(shows.length, "visibility code")} the probe can run, ${unreadable} it can't; the left grip shows while ${gripShows.map((s) => `${s.name}: ${s.code.code}`).join(" and ") || "always"}`)

// A variable as sim.watch names it, and the values it last read.
const key = (v) => (v.kind === "A" ? v.name : `${v.kind}:${v.name}`)
const watchable = (list) => {
  const seen = new Map()
  for (const v of list) if (v.kind === "A" || v.kind === "L") seen.set(key(v), [key(v), v.unit])
  return [...seen.values()]
}
const values = new Map()
const get = (v) => values.get(key(v)) ?? 0

// ------------------------------------------------ calibrate

// Model space to the aircraft's frame: forward = z, right = -x, up = y (p18).
// The seat objects, matched to the model's nearest PILOT_ node, give the
// offset where the model has such nodes, as the Comanche's PILOT_1 and PILOT_2
// did in p18; otherwise the model's origin is taken as SimConnect's reference.
const ac = await sim.read(POS)
const aircraft = Object.fromEntries([["lat", "PLANE LATITUDE"], ["lon", "PLANE LONGITUDE"], ["alt", "PLANE ALTITUDE"], ["hdg", "PLANE HEADING DEGREES TRUE"]].map(([k, n]) => [k, ac.get(n)]))
const seats = []
for (const id of await sim.byType(1, 50, { timeoutMs: 2000 })) {
  const t = (await sim.readStrings(["TITLE"], { object: id })).get("TITLE") ?? ""
  if (!/^SEAT_/i.test(t)) continue
  const reads = []
  for (let i = 0; i < 6; i++) {
    const v = await sim.read(POS, { object: id })
    reads.push(toBody(aircraft, { lat: v.get("PLANE LATITUDE"), lon: v.get("PLANE LONGITUDE"), alt: v.get("PLANE ALTITUDE") }))
    await sleep(50)
  }
  seats.push({ title: t, forward: median(reads.map((r) => r.forward)), right: median(reads.map((r) => r.right)), up: median(reads.map((r) => r.up)) })
}
const toFrame = (p) => ({ forward: p[2], right: -p[0], up: p[1] })
const pilotNodes = model.nodes.map((n, i) => ({ name: n.name, i })).filter((n) => /^PILOT_\d+$/i.test(n.name ?? "")).map((n) => ({ ...n, at: toFrame(apply(model.world[n.i], [0, 0, 0])) }))
const pairs = seats.map((s) => {
  const near = pilotNodes.map((n) => ({ n, d: Math.hypot(s.forward - n.at.forward, s.right - n.at.right, s.up - n.at.up) })).sort((a, b) => a.d - b.d)[0]
  return near && near.d < 0.3 ? { seat: s, node: near.n, diff: { forward: s.forward - near.n.at.forward, right: s.right - near.n.at.right, up: s.up - near.n.at.up } } : null
}).filter(Boolean)
const offset = pairs.length
  ? { forward: pairs.reduce((s, p) => s + p.diff.forward, 0) / pairs.length, right: pairs.reduce((s, p) => s + p.diff.right, 0) / pairs.length, up: pairs.reduce((s, p) => s + p.diff.up, 0) / pairs.length }
  : { forward: 0, right: 0, up: 0 }
note("calibrate", pairs.length
  ? `${pairs.map((p) => `${p.seat.title} on ${p.node.name}, off by ${where(p.diff)}`).join("; ")}: the model's origin taken as ${where(offset)} of SimConnect's reference point`
  : `${plural(seats.length, "seat object")}, none within 0.3m of a PILOT_ node of the model: its origin taken as SimConnect's reference point`, { seats, pilotNodes, offset })
const modelToFrame = (p) => ({ forward: p[2] + offset.forward, right: -p[0] + offset.right, up: p[1] + offset.up })
const frameToModel = (b) => [-(b.right - offset.right), b.up - offset.up, b.forward - offset.forward]
const camModel = (c) => frameToModel({ forward: c.z, right: -c.x, up: c.y })

// ------------------------------------------------ the camera

let cam = null
sim.handle.on("cameraData", (r) => {
  const c = r.cameraData
  if (c.positionReferential !== SIMOBJECT) return
  cam = { t: Date.now(), x: c.position.x, y: c.position.y, z: c.position.z, pitch: c.pbh.pitch, yaw: c.pbh.bank, roll: c.pbh.heading, fov: c.fov > Math.PI ? c.fov * RAD : c.fov }
})
const poll = setInterval(() => sim.send("camera get", () => sim.handle.cameraGet(SIMOBJECT)), 30)
for (let i = 0; i < 40 && !cam; i++) await sleep(50)
if (!cam) { note("camera", "SimConnect_CameraGet didn't answer"); await finish("no camera") }

// Each hand's rest, 0.30m ahead of the pilot's seat, 0.20m up, and 0.15m to its
// own side; with no seat to go by, the seat is taken as 0.6m below the eye.
const pilotSeat = seats.find((s) => /_pilot$/i.test(s.title)) ?? { forward: cam.z, right: -cam.x, up: cam.y - 0.6 }
const rest = {
  left: frameToModel({ forward: pilotSeat.forward + 0.3, right: pilotSeat.right - 0.15, up: pilotSeat.up + 0.2 }),
  right: frameToModel({ forward: pilotSeat.forward + 0.3, right: pilotSeat.right + 0.15, up: pilotSeat.up + 0.2 }),
}

// ------------------------------------------------ the hands

// The state the hands are drawn from: which holds the yoke, which taps where,
// and the yoke's pose.
// A thumb press is { hand, node, local }: where on the yoke, in that part's
// own frame, so it moves with the yoke. It sits apart from the tapping hand's
// session, so a thumb press in the middle of one doesn't end it.
const state = { yokeHand: HOME, tapHand: null, tap: null, normal: null, hover: false, thumb: null, lingerUntil: 0, thumbUntil: 0, sessionUntil: 0, handoff: null, yokeShown: true, pose: null }

// Where each hand sits on its grip, in the grip node's own frame, so it moves
// and rolls with the yoke: the anchor itself until the start measures the
// horn's surface in front of it.
const gripLocal = { left: [0, 0, 0], right: [0, 0, 0] }

function posed() {
  const fx = runX.run(get), fy = runY.run(get)
  const world = poseAt(model, [{ animation: animX, frame: fx, length: codeX.length }, { animation: animY, frame: fy, length: codeY.length }])
  const at = (i, p = [0, 0, 0]) => apply(world[i], p)
  return { fx, fy, world, grip: { left: at(grips.left, gripLocal.left), right: at(grips.right, gripLocal.right) }, wheel: wheelNode >= 0 ? at(wheelNode) : at(grips.left).map((x, k) => (x + at(grips.right)[k]) / 2) }
}

function place(hand, p) {
  const f = modelToFrame(p)
  setModule({ [`FWD${SLOT[hand]}`]: f.forward, [`RIGHT${SLOT[hand]}`]: f.right, [`UP${SLOT[hand]}`]: f.up })
}

// The hand handing the yoke over keeps hold of its grip until the handoff
// ends, as a pilot takes the yoke with one hand before letting go with the
// other.
const holding = (hand) => state.handoff?.from === hand && Date.now() < state.handoff.until && state.yokeShown && state.pose

// Gives the yoke to a hand, with the other keeping hold a moment if overlap.
// A hand leaving the yoke to tap can't wait: the sim acts on the click at
// once, so the hand arrived 0.3s after its switch had flipped (p21's third
// run). Going home has nothing to wait for, so it keeps the overlap.
function takeYoke(hand, overlap) {
  state.handoff = overlap && hand !== state.yokeHand && state.yokeShown ? { from: state.yokeHand, until: Date.now() + OVERLAP_MS } : null
  state.yokeHand = hand
}

// Draws both hands from the state.
function draw() {
  for (const hand of ["left", "right"]) {
    if (holding(hand)) place(hand, state.pose.grip[hand])
    else if (state.thumb?.hand === hand && state.pose) place(hand, apply(state.pose.world[state.thumb.node], state.thumb.local))
    else if (hand === state.tapHand && state.tap) place(hand, state.tap.map((x, k) => x + state.normal[k] * (radius(SCALE) + (state.hover ? HOVER_M : 0))))
    else if (hand === state.yokeHand && state.yokeShown && state.pose) place(hand, state.pose.grip[hand])
    else place(hand, rest[hand])
  }
}

function updateYoke() {
  state.pose = posed()
  state.yokeShown = gripShows.every((s) => s.code.run(get))
  stats.yokeUpdates++
  stats.fx = [Math.min(stats.fx[0], state.pose.fx), Math.max(stats.fx[1], state.pose.fx)]
  stats.fy = [Math.min(stats.fy[0], state.pose.fy), Math.max(stats.fy[1], state.pose.fy)]
  draw()
}

// The yoke's variables every frame, and the visibility codes' every second.
const yokeVars = watchable([...runX.vars, ...runY.vars])
const visVars = watchable(shows.flatMap((s) => s.code.vars)).filter(([k]) => !yokeVars.some(([y]) => y === k))
let lastYokeLog = 0
sim.watch(yokeVars, { period: "frame", label: "yoke", onData: (got, t) => {
  for (const [k, v] of got) values.set(k, v)
  updateYoke()
  if (t - lastYokeLog > 500) { lastYokeLog = t; rec.data("yoke", `frames ${state.pose.fx.toFixed(1)}, ${state.pose.fy.toFixed(1)}`, { values: Object.fromEntries(got), fx: state.pose.fx, fy: state.pose.fy, grip: state.pose.grip }) }
} })
// SimConnect reads a few hundred variables at once without trouble; split in
// case an aircraft has more.
for (let i = 0; i < visVars.length; i += 200) sim.watch(visVars.slice(i, i + 200), { period: "second", label: "visibility", onData: (got) => { for (const [k, v] of got) values.set(k, v); updateYoke() } })
// The visibility codes' first values come within a second; until then they'd
// run on zeros.
await sleep(1500)

// The grip anchors sit inside the yoke's horns, where a closed hand's center
// would be, so a ball on one is hidden in the horn (p21's first run). With the
// yoke centered, a ray from the pilot's eye to each anchor meets the horn's
// surface first; the hand goes there, one ball's radius out, kept in the
// anchor's own frame.
{
  const world = poseAt(model, [{ animation: animX, frame: 50 }, { animation: animY, frame: 50 }])
  repose(cockpit, 0, world, moved)
  const eye = camModel(cam)
  for (const hand of ["left", "right"]) {
    const anchor = apply(world[grips[hand]], [0, 0, 0])
    const hit = cast(cockpit, eye, anchor.map((x, k) => x - eye[k]), { only: moved })
    if (!hit || hit.distance > dist(eye, anchor)) { note("grip", `${GRIP[hand]}: no yoke surface between the eye and the anchor, so the hand sits on the anchor`); continue }
    gripLocal[hand] = apply(invert(world[grips[hand]]), hit.point.map((x, k) => x + hit.normal[k] * radius(SCALE)))
    note("grip", `${GRIP[hand]}: the yoke's surface (${hit.chain[0]}) is ${(dist(anchor, hit.point) * 100).toFixed(1)}cm in front of the anchor toward the eye; the hand sits ${(Math.hypot(...gripLocal[hand]) * 100).toFixed(1)}cm from it`, { local: gripLocal[hand] })
  }
}
updateYoke()
note("yoke", `at the start, frames ${state.pose.fx.toFixed(1)} and ${state.pose.fy.toFixed(1)}: left grip at ${pt(state.pose.grip.left)}, right grip at ${pt(state.pose.grip.right)}, wheel center at ${pt(state.pose.wheel)}, the yoke ${state.yokeShown ? "shown" : "hidden"}; ${plural(yokeVars.length, "variable")} watched every frame, ${visVars.length} every second`, { pose: { fx: state.pose.fx, fy: state.pose.fy, grip: state.pose.grip, wheel: state.pose.wheel } })

// ------------------------------------------------ the spheres

const v0 = await sim.read(POS)
for (const hand of ["left", "right"]) {
  const init = new InitPosition()
  Object.assign(init, { latitude: v0.get("PLANE LATITUDE"), longitude: v0.get("PLANE LONGITUDE"), altitude: v0.get("PLANE ALTITUDE"), pitch: 0, bank: 0, heading: wrap(v0.get("PLANE HEADING DEGREES TRUE")), onGround: false, airspeed: 0 })
  const r = await sim.spawn(SPHERE, "", init)
  if (r.id === undefined) { note("sphere", `${SPHERE}: not created: ${r.error}`); await finish("a failed spawn") }
  spheres.push(r.id)
  for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
  setModule({ [`OBJECT${SLOT[hand]}`]: r.id, [`SCALE${SLOT[hand]}`]: SCALE, [`COLOR${SLOT[hand]}`]: COLOR[hand] })
}
setModule({ SIGN_PITCH: SIGNS[0], SIGN_BANK: SIGNS[1], LEAD })
draw()
setModule({ MODE: 1 })

// ------------------------------------------------ the presses

// Which hand taps a point: by its side of the wheel's center line, beyond the
// band; inside it, the hand that's free.
function tapper(p) {
  const side = p[0] - state.pose.wheel[0]
  if (side > BAND_M) return "left"
  if (side < -BAND_M) return "right"
  return other(state.yokeHand)
}

// Casts a press's ray at the yoke's current pose, past what's hidden.
function hitAt(m, c) {
  updateYoke()
  repose(cockpit, 0, state.pose.world, moved)
  const hidden = new Set()
  for (const s of shows) if (!s.code.run(get)) for (const n of s.nodes) hidden.add(n)
  const origin = camModel(c)
  const dir = rayThrough(c, m, MEASURED)
  const hit = cast(cockpit, origin, dir, { skip: hidden })
  if (hit && hidden.size) {
    const blind = cast(cockpit, origin, dir)
    if (blind && blind.distance < hit.distance - 0.01) stats.skippedHits++
  }
  return { hit, origin, dir, hidden: hidden.size }
}

function begin(m, c, label) {
  const { hit, origin, dir, hidden } = hitAt(m, c)
  const node = hit?.chain[0] ?? "nothing"
  if (!hit) { console.log(`  ${label}: nothing`); return null }
  // On the pilot's own yoke, the thumb of the hand on that side presses it,
  // and the hand already holding the yoke keeps hold, so a press on the far
  // horn puts both hands on the yoke for a moment: handing the yoke to the
  // pressing hand made the holding hand let go and take it back within half a
  // second (p21's third run). Anywhere else, a hand taps and the other holds
  // the yoke.
  const side = hit.point[0] - state.pose.wheel[0]
  const thumb = ownYoke.has(hit.node)
  const hand = thumb ? (side > 0 ? "left" : "right") : tapper(hit.point)
  const yoke = thumb ? state.yokeHand : other(hand)
  const swapped = yoke !== state.yokeHand
  if (swapped) stats.swaps++
  if (!state.yokeShown) stats.hiddenPresses++
  ;(thumb ? stats.thumbs : stats.presses)[hand]++
  if (thumb) {
    state.thumb = { hand, node: hit.node, local: apply(invert(state.pose.world[hit.node]), hit.point.map((x, k) => x + hit.normal[k] * radius(SCALE))) }
    state.thumbUntil = 0
  } else {
    takeYoke(yoke, false)
    state.tapHand = hand
    state.tap = hit.point
    state.normal = hit.normal
    state.hover = false
    state.lingerUntil = 0
    state.sessionUntil = 0
  }
  draw()
  const what = thumb ? `the ${hand} thumb presses it${hand === yoke ? ", holding the yoke" : `, the ${yoke} hand keeping hold`}` : `the ${hand} hand taps${state.yokeShown ? `, the ${yoke} holds the yoke` : ", the yoke hidden"}`
  rec.log("press", `${label} at ${m.x}, ${m.y}: ${node}, ${(Math.abs(side) * 100).toFixed(1)}cm ${side > 0 ? "left" : "right"} of the wheel: ${what}${swapped ? " (swapped)" : ""}`, { mouse: m, cam: c, origin, dir, hit: { point: hit.point, normal: hit.normal, distance: hit.distance, chain: hit.chain }, hand, thumb, swapped, hidden, pose: { fx: state.pose.fx, fy: state.pose.fy } })
  console.log(`  ${label}: ${node}, ${thumb ? `${hand} thumb` : `${hand} hand`}${swapped ? " (swap)" : ""}`)
  return { hit, thumb }
}

// After a press ends: a thumb leaves its button after ms; a tapping hand
// waits ms on the spot, then hovers off it, and the session ends SESSION_MS
// after the release unless another press comes.
function release(r, ms) {
  const now = Date.now()
  if (r.thumb) { state.thumbUntil = now + ms; return }
  state.lingerUntil = now + ms
  state.sessionUntil = now + ms + SESSION_MS
}

let grab = null
let rightPress = null
let lastWheel = 0
let wheelPress = null
const pixels = (m, a) => Math.hypot((m.x - a.x) * m.width / 2, (m.y - a.y) * m.height / 2)
stopMouse = await startMouse((m) => {
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
    grab = r ? { t0: m.t, start: m, point: r.hit.point, normal: r.hit.normal, thumb: r.thumb, cursorPx: 0, raw: 0 } : null
    return
  }
  if (!grab) return
  if (m.kind === "move") {
    // A thumb stays on its button; a tapping hand glides.
    const onPlane = grab.thumb ? null : crossPlane(camModel(c), rayThrough(c, m, MEASURED), grab.point, grab.normal)
    if (onPlane) { state.tap = onPlane; draw() }
    grab.cursorPx = Math.max(grab.cursorPx, pixels(m, grab.start))
    grab.raw += Math.hypot(m.dx, m.dy)
  } else if (m.kind === "leftup") {
    if (grab.cursorPx >= DRAG_PX || grab.raw >= DRAG_COUNTS) stats.drags++
    release(grab, LINGER_MS.release)
    grab = null
  }
})

// The timers: a thumb leaves its button; a tapping hand lifts off its spot to
// hover; the session ends and both hands go home, the home hand taking the
// yoke before the other lets go; and a handoff ends.
const tick = setInterval(() => {
  const now = Date.now()
  if (state.thumb && state.thumbUntil && now > state.thumbUntil && !grab?.thumb) {
    state.thumb = null
    state.thumbUntil = 0
    draw()
  }
  if (!grab && state.lingerUntil && now > state.lingerUntil) {
    state.lingerUntil = 0
    state.hover = true
    draw()
  }
  if (!grab && state.sessionUntil && now > state.sessionUntil) {
    state.sessionUntil = 0
    state.tap = null
    state.tapHand = null
    state.hover = false
    stats.sessions++
    takeYoke(HOME, true)
    draw()
  }
  if (state.handoff && now >= state.handoff.until) {
    state.handoff = null
    draw()
  }
}, 50)

console.log(`\n▶ Move the yoke, then click around it\n  The blue ball is the left hand and the yellow one the right. Move the yoke: the hand on it follows. Click and drag left and right of the yoke: the hands swap by side. ${SKIP} ends.`)
beep(1000, 100)
const why = await new Promise((resolve) => {
  keys.listen((k) => { if (k.key === "SKIP") resolve("Page Up") })
  setTimeout(() => resolve("the 20-minute cap"), CAP_MS)
})
clearInterval(tick)
clearInterval(poll)
await finish(why)
