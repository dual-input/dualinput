/*
 * p22: the hand on the aircraft's outside: where the pilot clicks in an
 * external view or on foot on the walkaround, the ray from the camera meets
 * the aircraft's exterior model and the hand goes there, on MSFS 2024.
 *
 * Inside, SimConnect_CameraGet's SIMOBJECT referential gave the camera in the
 * aircraft's frame (p19, p20). On foot, the user's object is the avatar
 * (record/areas/avatars/log.md, 2026-10-02), so that referential may follow it
 * instead. The WORLD referential gives the camera's latitude, longitude, and
 * altitude (p06) and three angles whose meaning in the world we haven't
 * measured. So the probe first watches both referentials in the cockpit while
 * the pilot looks around, and fits how the WORLD angles give the camera's
 * heading and pitch (lib/frames.mjs), checked against the SIMOBJECT ray we
 * trust there. Outside, yellow balls on the exterior's nose, tail, wingtips,
 * and fin top, found from the model alone, test both referentials, and the
 * hand then follows clicks with whichever lands better.
 *
 * The exterior model is the one the aircraft's model.cfg names (exterior, or
 * normal), posed at each click by every animation whose code in the behavior
 * XML can run, in lib/rpn.mjs's lenient mode, from variables watched every
 * frame; the gear and tires, which sim templates drive, stay as the file
 * stores them. Parts the visibility code hides let the ray through. The log
 * also gives how far the avatar stood from each spot it touched.
 *
 * The exterior curves, so a drag that glides on the plane of the spot first
 * touched, as inside (p20), can leave the surface. While a drag lasts, a
 * second, blue ball follows a fresh cast of the ray onto the model, with the
 * part being dragged posed again for each cast, so the pilot sees both, and
 * the log adds a third: a cast against the part first touched alone.
 *
 * p22's first runs settled the WORLD fit (heading = yaw, rise = -pitch, with
 * 0.00° of error, record/areas/avatars/log.md), so skipping the look uses it.
 *
 * In the Black Square Baron, or another aircraft whose files cockpitFiles
 * reads, parked, the sim in front, starting in the cockpit:
 *
 *   look      In the cockpit, press Page Down, then look around for 6s, with
 *             the mouse or your head, up, down, left, and right.
 *   outside   Walk outside, or switch to an external view, and press Page
 *             Down. A yellow ball sits on the nose, then the tail, the
 *             wingtips, and the top of the fin: click each one's center.
 *             Page Up skips one you can't see.
 *   clicks    Click and drag the doors, covers, caps, and anything else
 *             outside, on foot or in an external view, and drag across curved
 *             skin too: the green ball glides, the blue one recasts. Page Up
 *             ends; it ends by itself after 20 minutes.
 *
 *   node experiments/areas/avatars/p22-exterior-hand.mjs
 *
 * Nothing touches the pilot's input: clicks are read through Raw Input
 * (experiments/tools/mouse.mjs). It needs crosscheck-p12-follow 0.6.0, which
 * places a second object. The probe turns the module off and removes both
 * spheres at the end and on Ctrl+C.
 */

import path from "node:path"

import { InitPosition } from "node-simconnect"

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { startMouse } from "../../tools/mouse.mjs"
import { Recorder, fmt, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { poseAt } from "./lib/animate.mjs"
import { animationCode, behaviorText, cockpitFiles, visibilityCode } from "./lib/cockpit-files.mjs"
import { frameToNed, headingAndRise, nedToFrame, worldRay, worldToFrame } from "./lib/frames.mjs"
import { MEASURED, rayThrough } from "./lib/pick.mjs"
import { RAD, wrap } from "./lib/pose.mjs"
import { cast, crossPlane, loadCockpit, repose, subtree } from "./lib/raycast.mjs"
import { compile } from "./lib/rpn.mjs"

const AIRCRAFT = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"], ["PLANE PITCH DEGREES", "degrees"], ["PLANE BANK DEGREES", "degrees"]]
const POS = AIRCRAFT.slice(0, 4)
// p01: the avatar's own object.
const USER_AVATAR = 0xffffffff - 128 + 1
const SPHERE = "CROSSCHECK_HandSphere"
const SIMOBJECT = 1, WORLD = 2
// tools/sphere.mjs: radius 2cm at scale 1, and SCALE 0 to 100 sweeps the scale
// from 0.5 to 5. Outside, the pilot looks from meters away.
const radius = (scale) => 0.02 * (0.5 + 4.5 * scale / 100)
const SCALE = { hand: 20, target: 40 }
const COLOR = { rest: 0, touching: 1, recast: 2, target: 3 }
const LOOK_MS = 6000
// p22's first two runs fitted WORLD's angles in the cockpit with 0.00° of
// error: its yaw is the camera's true heading and its pitch the angle below
// the horizon (record/areas/avatars/log.md).
const WORLD_MEASURED = { yawSign: 1, yawOffset: 0, pitchSign: -1 }
const LINGER_MS = { release: 250, wheel: 1000 }
const TAP_MS = 300
const DRAG_PX = 5
const DRAG_COUNTS = 20
const CAP_MS = 20 * 60_000
// p15: nose up and right wing down are both negative; lead 1 frame (p16).
const SIGNS = [-1, -1]
const LEAD = 1
const L = (n) => [`L:CROSSCHECK_P12_${n}`, "number"]
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const turn = (d) => ((d % 360) + 540) % 360 - 180

const rec = new Recorder("p22-exterior-hand", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p22-exterior-hand" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()
const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); rec.log(kind, text, fields) }
const pt = (p) => p.map((x) => x.toFixed(2)).join(", ")

async function readModule(names) {
  const v = await sim.read(names.map(L), { timeoutMs: 2000 })
  return Object.fromEntries(names.map((n) => [n, v.get(`L:CROSSCHECK_P12_${n}`) ?? null]))
}
const setModule = (values) => { for (const [k, x] of Object.entries(values)) sim.set([L(k)], [x], { label: `set CROSSCHECK_P12_${k}`, quiet: true }) }

const touches = []
const drags = []
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
  if (drags.length) {
    const all = (k) => drags.flatMap((d) => d[k])
    const q = (a, f) => (a.length ? (a.sort((x, y) => x - y)[Math.floor(a.length * f)] * 100).toFixed(1) : "-")
    note("drags", `${plural(drags.length, "drag")}, ${plural(all("gaps").length, "fresh cast")}: from the glide, a fresh cast was a median ${q(all("gaps"), 0.5)}cm and at the 90th percentile ${q(all("gaps"), 0.9)}cm, landing off the part first touched ${all("off").filter(Boolean).length} times; a cast against that part alone, a median ${q(all("partGaps"), 0.5)}cm and at the 90th percentile ${q(all("partGaps"), 0.9)}cm, and it missed the part ${all("partMiss").filter(Boolean).length} times`)
    for (const d of drags.slice(0, 15)) note("drag", `on ${d.node}, ${(d.ms / 1000).toFixed(1)}s, ${plural(d.gaps.length, "fresh cast")}: from the glide a median ${q([...d.gaps], 0.5)}cm, at most ${q([...d.gaps], 0.999)}cm; off the part ${d.off.filter(Boolean).length} times (${[...new Set(d.nodes)].slice(0, 5).join(", ")})`)
  }
  if (touches.length) {
    const near = touches.filter((t) => t.avatarM !== null)
    note("clicks", `${plural(touches.length, "press", "presses")} outside: ${touches.filter((t) => t.hit).length} hit the exterior; nodes: ${[...touches.reduce((m, t) => m.set(t.node, (m.get(t.node) ?? 0) + 1), new Map())].map(([n, c]) => `${n}${c > 1 ? ` ×${c}` : ""}`).join(", ")}${near.length ? `; the avatar stood a median ${median(near.map((t) => t.avatarM)).toFixed(2)}m from the spot (${Math.min(...near.map((t) => t.avatarM)).toFixed(2)}m to ${Math.max(...near.map((t) => t.avatarM)).toFixed(2)}m)` : ""}`)
  }
  const text = [
    "p22 · The hand on the aircraft's outside, where the pilot clicks in an external view or on foot, on MSFS 2024",
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
// Object 0 reads the aircraft even with the pilot on foot (p01).
const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
const speed = await sim.readOne("GROUND VELOCITY", "knots")
note("setup", `aircraft TITLE ${JSON.stringify(title)}, ${fmt(speed)} kt`)
if (speed > 1) { note("setup", "moving: start the probe parked"); await finish("not parked") }
const files = title ? cockpitFiles(title) : null
if (!files?.exterior?.gltf || !files.gltf) { note("model", `no exterior model found for ${JSON.stringify(title)}`); await finish("no model") }
const t0 = Date.now()
const outside = loadCockpit([files.exterior.gltf])
const model = outside.models[0]
note("model", `${files.package}: exterior ${path.basename(files.exterior.gltf)}, ${plural(outside.triangles, "triangle")}, read in ${Date.now() - t0}ms`)

// ------------------------------------------------ the exterior's animations and visibility

const behavior = behaviorText(files.exterior.xml)
const codes = animationCode(behavior)
// Code that reads its own O: or E: state stays unposed (lib/rpn.mjs).
const runnable = (code) => { try { const c = compile(code, { lenient: true }); return !c.usesState && c.vars.every((v) => v.kind === "A" || v.kind === "L") ? c : null } catch { return null } }
const plays = []
const unposed = []
for (const a of model.g.animations ?? []) {
  const entry = codes.get((a.name ?? "").toLowerCase())
  const c = entry && runnable(entry.code)
  if (c) plays.push({ animation: a, length: entry.length, code: c })
  else unposed.push(a.name)
}
const moved = new Set()
for (const p of plays) for (const ch of p.animation.channels) for (const n of subtree(model, ch.target.node)) moved.add(n)
const shows = []
for (const [name, code] of visibilityCode(behavior)) {
  const i = model.nodes.findIndex((n) => (n.name ?? "").toLowerCase() === name)
  const c = i >= 0 && runnable(code)
  if (c) shows.push({ node: i, name: model.nodes[i].name, code: c, nodes: subtree(model, i) })
}
note("pose", `${plays.length} of ${plural((model.g.animations ?? []).length, "animation")} posed from their code, moving ${plural(moved.size, "node")}; not posed: ${unposed.join(", ") || "none"}; ${plural(shows.length, "visibility code")} run`)

const key = (v) => (v.kind === "A" ? v.name : `${v.kind}:${v.name}`)
const values = new Map()
const get = (v) => values.get(key(v)) ?? 0
const watched = new Map()
for (const c of [...plays.map((p) => p.code), ...shows.map((s) => s.code)]) for (const v of c.vars) watched.set(key(v), [key(v), v.unit])
const watchList = [...watched.values()]
for (let i = 0; i < watchList.length; i += 200) sim.watch(watchList.slice(i, i + 200), { period: "frame", label: "exterior variables", onData: (got) => { for (const [k, v] of got) values.set(k, v) } })

// The exterior as the sim shows it now: posed, with what's hidden listed.
function current() {
  const world = poseAt(model, plays.map((p) => ({ animation: p.animation, frame: p.code.run(get), length: p.length })))
  repose(outside, 0, world, moved)
  const hidden = new Set()
  for (const s of shows) if (!s.code.run(get)) for (const n of s.nodes) hidden.add(n)
  return { world, hidden }
}

// ------------------------------------------------ the aircraft, the avatar, and the camera

let aircraft = null
sim.watch(AIRCRAFT, { period: "frame", label: "aircraft", onData: (got) => { aircraft = Object.fromEntries([["lat", "PLANE LATITUDE"], ["lon", "PLANE LONGITUDE"], ["alt", "PLANE ALTITUDE"], ["hdg", "PLANE HEADING DEGREES TRUE"], ["pitch", "PLANE PITCH DEGREES"], ["bank", "PLANE BANK DEGREES"]].map(([k, n]) => [k, got.get(n) ?? aircraft?.[k] ?? 0])) } })
let avatar = null
sim.watch(POS, { period: "frame", object: USER_AVATAR, label: "avatar", onData: (got) => { avatar = { lat: got.get("PLANE LATITUDE") ?? avatar?.lat, lon: got.get("PLANE LONGITUDE") ?? avatar?.lon, alt: got.get("PLANE ALTITUDE") ?? avatar?.alt } } })

let camS = null, camW = null
const angles = (c) => ({ pitch: c.pbh.pitch, yaw: c.pbh.bank, roll: c.pbh.heading, fov: c.fov > Math.PI ? c.fov * RAD : c.fov })
const pairs = []
let collecting = false
sim.handle.on("cameraData", (r) => {
  const c = r.cameraData
  if (c.positionReferential === SIMOBJECT) camS = { t: Date.now(), x: c.position.x, y: c.position.y, z: c.position.z, ...angles(c) }
  else if (c.positionReferential === WORLD) {
    camW = { t: Date.now(), lat: c.position.x, lon: c.position.y, alt: c.position.z / 0.3048, ...angles(c) }
    if (collecting && camS && aircraft) pairs.push({ s: camS, w: camW, a: { ...aircraft } })
  }
})
const poll = setInterval(() => {
  sim.send("camera get", () => sim.handle.cameraGet(SIMOBJECT))
  sim.send("camera get", () => sim.handle.cameraGet(WORLD))
}, 30)
for (let i = 0; i < 60 && !(camS && camW && aircraft); i++) await sleep(50)
if (!camS || !camW || !aircraft) { note("camera", "SimConnect_CameraGet or the aircraft didn't answer"); await finish("no camera") }

// Model space and the aircraft's frame: forward = z, right = -x, up = y, the
// model's origin taken as the aircraft's reference point (p18, p21).
const frameToModel = (f) => [-f.right, f.up, f.forward]
const modelToFrame = (p) => ({ forward: p[2], right: -p[0], up: p[1] })
const simobjectEye = (c) => [c.x, c.y, c.z]

// ------------------------------------------------ look: fit WORLD's angles

let fit = null
console.log(`\n▶ Look around in the cockpit\n  ${START}, then look up, down, left, and right for ${LOOK_MS / 1000}s, with the mouse or your head. ${SKIP} skips it.`)
const k1 = await keys.next()
if (k1.key === "START") {
  beep(1000, 100)
  collecting = true
  await sleep(LOOK_MS)
  collecting = false
  beep(500, 300)
  // Where SIMOBJECT says the camera looks, in the world, against WORLD's angles.
  const rows = pairs.map(({ s, w, a }) => {
    const d = rayThrough(s, { x: 0, y: 0, width: 1, height: 1 }, MEASURED)
    const look = headingAndRise(frameToNed(a, modelToFrame(d)))
    const eyeW = frameToModel(worldToFrame(a, w))
    return { heading: look.heading, rise: look.rise, yaw: w.yaw, pitch: w.pitch, eyeGap: dist(eyeW, simobjectEye(s)) }
  })
  const fits = []
  for (const yawSign of [1, -1]) for (const pitchSign of [1, -1]) {
    const offs = rows.map((r) => (r.heading - yawSign * r.yaw) * RAD)
    const yawOffset = Math.atan2(offs.reduce((s, o) => s + Math.sin(o), 0), offs.reduce((s, o) => s + Math.cos(o), 0)) / RAD
    const yawRms = Math.sqrt(rows.reduce((s, r) => s + turn(r.heading - yawSign * r.yaw - yawOffset) ** 2, 0) / rows.length)
    const pitchRms = Math.sqrt(rows.reduce((s, r) => s + (r.rise - pitchSign * r.pitch) ** 2, 0) / rows.length)
    fits.push({ yawSign, pitchSign, yawOffset, yawRms, pitchRms, rms: Math.hypot(yawRms, pitchRms) })
  }
  fits.sort((a, b) => a.rms - b.rms)
  fit = fits[0]
  const spanYaw = Math.max(...rows.map((r) => r.yaw)) - Math.min(...rows.map((r) => r.yaw)), spanPitch = Math.max(...rows.map((r) => r.pitch)) - Math.min(...rows.map((r) => r.pitch))
  note("look", `${plural(rows.length, "pair")} over ${spanYaw.toFixed(0)}° of WORLD yaw and ${spanPitch.toFixed(0)}° of pitch: heading = ${fit.yawSign > 0 ? "" : "-"}yaw ${fit.yawOffset >= 0 ? "+" : "-"} ${Math.abs(fit.yawOffset).toFixed(2)}° (RMS ${fit.yawRms.toFixed(2)}°), rise = ${fit.pitchSign > 0 ? "" : "-"}pitch (RMS ${fit.pitchRms.toFixed(2)}°); next best RMS ${fits[1].rms.toFixed(2)}°; WORLD's eye is a median ${(median(rows.map((r) => r.eyeGap)) * 100).toFixed(1)}cm from SIMOBJECT's`, { fits, rows: rows.slice(0, 400) })
} else {
  fit = WORLD_MEASURED
  note("look", "skipped: the WORLD referential's angles taken as p22's first runs fitted them, heading = yaw and rise = -pitch")
}

// The ray through the cursor in the model's space, by each referential.
function rays(m) {
  const out = {}
  if (camS) out.simobject = { origin: simobjectEye(camS), dir: rayThrough(camS, m, MEASURED) }
  if (camW && fit && aircraft) {
    const d = nedToFrame(aircraft, worldRay(camW, m, fit))
    out.world = { origin: frameToModel(worldToFrame(aircraft, camW)), dir: [-d.right, d.up, d.forward] }
  }
  return out
}

// ------------------------------------------------ the sphere

const v0 = await sim.read(POS)
const init = new InitPosition()
Object.assign(init, { latitude: v0.get("PLANE LATITUDE"), longitude: v0.get("PLANE LONGITUDE"), altitude: v0.get("PLANE ALTITUDE"), pitch: 0, bank: 0, heading: wrap(v0.get("PLANE HEADING DEGREES TRUE")), onGround: false, airspeed: 0 })
// Two balls: the hand, and, while a drag lasts, a second one where a fresh
// cast puts it, to set beside the glide (crosscheck-p12-follow 0.6.0).
for (const slot of ["", "2"]) {
  const r = await sim.spawn(SPHERE, "", init)
  if (r.id === undefined) { note("sphere", `${SPHERE}: not created: ${r.error}`); await finish("a failed spawn") }
  spheres.push(r.id)
  for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
  setModule({ [`OBJECT${slot}`]: r.id })
}
// At rest, out of the way: a meter above the aircraft's reference point, the
// second ball beside the first.
const REST = [[0, 1, 0], [-0.1, 1, 0]]
setModule({ SIGN_PITCH: SIGNS[0], SIGN_BANK: SIGNS[1], LEAD, SCALE: SCALE.hand, COLOR: COLOR.rest, SCALE2: SCALE.hand, COLOR2: COLOR.rest, MODE: 1 })
const put = (p, color, scale) => { const f = modelToFrame(p); setModule({ FWD: f.forward, RIGHT: f.right, UP: f.up, COLOR: color, SCALE: scale }) }
const put2 = (p, color) => { const f = modelToFrame(p); setModule({ FWD2: f.forward, RIGHT2: f.right, UP2: f.up, COLOR2: color }) }
put(REST[0], COLOR.rest, SCALE.hand)
put2(REST[1], COLOR.rest)

let onMouse = null
let win = null
stopMouse = await startMouse((m) => {
  if (m.width > 0 && m.height > 0) win = { width: m.width, height: m.height }
  if (m.kind === "size" || !m.foreground) return
  if (onMouse) onMouse(m)
})
let onSkip = null
keys.listen((k) => { if (k.key === "SKIP" && onSkip) onSkip() })

// ------------------------------------------------ outside: the balls

// The exterior's farthest points as the sim shows it now, posed and without
// what's hidden. Parts no animation moves won't do: both the Baron's and the
// Comanche's models hang most of the airframe under animated nodes, so those
// alone left the Comanche a "tail" 0.2m behind its reference point.
function extremes() {
  const { hidden } = current()
  const shown = outside.prims.filter((p) => !p.invisible && !hidden.has(p.node))
  const extreme = (axis, sign) => {
    let best = null, bv = -Infinity
    for (const p of shown) for (let v = 0; v < p.pos.length; v += 3) { const x = sign * p.pos[v + axis]; if (x > bv) { bv = x; best = [p.pos[v], p.pos[v + 1], p.pos[v + 2]] } }
    return best
  }
  return [["the nose", extreme(2, 1)], ["the tail", extreme(2, -1)], ["the left wingtip", extreme(0, 1)], ["the right wingtip", extreme(0, -1)], ["the top of the fin", extreme(1, 1)]]
}

console.log(`\n▶ Go outside\n  Walk outside, or switch to an external view, then press ${START}. ${SKIP} skips the balls.`)
const k2 = await keys.next()
const samples = []
if (k2.key === "START") {
  const TARGETS = extremes()
  note("targets", TARGETS.map(([n, p]) => `${n} at ${pt(p)}`).join("; "))
  for (const [name, spot] of TARGETS) {
    // The ball sits its own radius toward the eye, so the ray to its center
    // is the ray to the spot.
    const eye = rays({ x: 0, y: 0, width: 1, height: 1 })[fit ? "world" : "simobject"].origin
    const n = dist(eye, spot)
    const ball = spot.map((x, k) => x + ((eye[k] - x) / n) * radius(SCALE.target))
    put(ball, COLOR.target, SCALE.target)
    console.log(`  ${name}`)
    beep(1000, 80)
    const got = await new Promise((resolve) => {
      onMouse = (m) => { if (m.kind === "left") resolve(m) }
      onSkip = () => resolve(null)
    })
    onMouse = null
    onSkip = null
    if (!got) { rec.log("target", `${name}: skipped`); continue }
    const rs = rays(got)
    const off = (ray) => { const w = ball.map((x, k) => x - ray.origin[k]); return Math.acos(Math.min(1, (ray.dir[0] * w[0] + ray.dir[1] * w[1] + ray.dir[2] * w[2]) / (Math.hypot(...ray.dir) * Math.hypot(...w)))) / RAD }
    const s = { name, ball, mouse: got, camS, camW, aircraft: { ...aircraft }, avatar, off: Object.fromEntries(Object.entries(rs).map(([k, ray]) => [k, off(ray)])), range: dist(rs.world?.origin ?? rs.simobject.origin, ball) }
    samples.push(s)
    rec.log("target", `${name}: clicked at ${got.x}, ${got.y}, ${s.range.toFixed(1)}m away; off by ${Object.entries(s.off).map(([k, d]) => `${d.toFixed(2)}° by ${k}`).join(", ")}`, s)
    console.log(`    ${Object.entries(s.off).map(([k, d]) => `${k} ${d.toFixed(1)}°`).join(", ")}`)
  }
  beep(500, 300)
}
let method = fit ? "world" : "simobject"
if (samples.length) {
  const rms = (k) => Math.sqrt(samples.reduce((s, x) => s + (x.off[k] ?? 90) ** 2, 0) / samples.length)
  const cm = (k) => samples.map((x) => `${x.name} ${(Math.tan((x.off[k] ?? 90) * RAD) * x.range * 100).toFixed(0)}cm`).join(", ")
  const methods = ["world", "simobject"].filter((k) => samples.every((x) => k in x.off))
  for (const k of methods) note("targets", `by ${k}: RMS ${rms(k).toFixed(2)}° (${cm(k)})`)
  // Clicks that weren't aimed at the balls choose nothing: in one run the
  // pilot clicked through them, both referentials were off by 77°, and the
  // worse one was chosen by 0.04°.
  const best = methods.sort((a, b) => rms(a) - rms(b))[0]
  if (best && rms(best) < 5) method = best
  else note("targets", `no referential within 5° of the balls, so the clicks weren't aimed; the clicks use ${method}`)
}
note("method", `the clicks use the ${method} referential`)
put(REST[0], COLOR.rest, SCALE.hand)

// ------------------------------------------------ clicks

let grab = null
let rightPress = null
let lastWheel = 0
let lingerUntil = 0
const pixels = (m, a) => Math.hypot((m.x - a.x) * m.width / 2, (m.y - a.y) * m.height / 2)

function press(m, label) {
  const ray = rays(m)[method]
  if (!ray) return null
  const { hidden } = current()
  const hit = cast(outside, ray.origin, ray.dir, { skip: hidden, maxM: 60 })
  const avatarM = avatar && hit ? dist(frameToModel(worldToFrame(aircraft, avatar)), hit.point) : null
  const t = { label, node: hit?.chain[0] ?? "nothing", hit: !!hit, avatarM }
  touches.push(t)
  rec.log("press", `${label} at ${m.x}, ${m.y}: ${t.node}${hit ? ` at ${hit.distance.toFixed(2)}m` : ""}${avatarM !== null ? `, the avatar ${avatarM.toFixed(2)}m from it` : ""}`, { mouse: m, method, ray, hit: hit && { point: hit.point, normal: hit.normal, distance: hit.distance, chain: hit.chain }, avatar, aircraft, camS, camW, hidden: hidden.size })
  console.log(`  ${label}: ${t.node}${avatarM !== null ? ` (avatar ${avatarM.toFixed(1)}m away)` : ""}`)
  if (!hit) return null
  const at = hit.point.map((x, k) => x + hit.normal[k] * radius(SCALE.hand))
  put(at, COLOR.touching, SCALE.hand)
  put2(at, COLOR.recast)
  lingerUntil = 0
  return hit
}

// The part a drag holds: everything under the highest animated node above
// the node it touched, so it can be posed again while the part moves; or just
// that node, if no animation moves it.
function partOf(node) {
  let root = -1
  for (let j = node; j !== -1; j = model.parent[j]) if (moved.has(j)) root = j
  return { posed: root >= 0 ? subtree(model, root) : null, nodes: subtree(model, root >= 0 ? root : node) }
}

// While a drag lasts, a cast at most this often: posing the part again and
// casting take about 25ms on the Baron.
const RECAST_MS = 50

function recast(m, onPlane) {
  const now = Date.now()
  if (now - grab.last < RECAST_MS) return
  grab.last = now
  const ray = rays(m)[method]
  if (!ray) return
  if (grab.part.posed) repose(outside, 0, poseAt(model, plays.map((p) => ({ animation: p.animation, frame: p.code.run(get), length: p.length }))), grab.part.posed)
  const hidden = new Set()
  for (const s of shows) if (!s.code.run(get)) for (const n of s.nodes) hidden.add(n)
  const hit = cast(outside, ray.origin, ray.dir, { skip: hidden, maxM: 60 })
  const onPart = cast(outside, ray.origin, ray.dir, { only: grab.part.nodes, maxM: 60 })
  if (hit) {
    put2(hit.point.map((x, k) => x + hit.normal[k] * radius(SCALE.hand)), COLOR.recast)
    grab.nodes.push(hit.chain[0])
    grab.off.push(!grab.part.nodes.has(hit.node))
    if (onPlane) grab.gaps.push(dist(onPlane, hit.point))
  }
  grab.partMiss.push(!onPart)
  if (onPart && onPlane) grab.partGaps.push(dist(onPlane, onPart.point))
}

onMouse = (m) => {
  if (m.kind === "right") { rightPress = m; return }
  if (m.kind === "rightup") {
    const p = rightPress
    rightPress = null
    if (!p || m.t - p.t >= TAP_MS || pixels(m, p) >= DRAG_PX || m.delta >= DRAG_COUNTS) return
    if (press(p, "right click")) lingerUntil = Date.now() + LINGER_MS.release
    return
  }
  if (m.kind === "wheel") {
    if (m.t - lastWheel < 600) { lastWheel = m.t; lingerUntil = Date.now() + LINGER_MS.wheel; return }
    lastWheel = m.t
    if (press(m, "wheel")) lingerUntil = Date.now() + LINGER_MS.wheel
    return
  }
  if (m.kind === "left") {
    const hit = press(m, "press")
    grab = hit ? { t0: m.t, point: hit.point, normal: hit.normal, node: hit.chain[0], part: partOf(hit.node), last: 0, gaps: [], partGaps: [], off: [], partMiss: [], nodes: [] } : null
    return
  }
  if (!grab) return
  if (m.kind === "move") {
    const ray = rays(m)[method]
    const onPlane = ray && crossPlane(ray.origin, ray.dir, grab.point, grab.normal, { maxM: 60 })
    if (onPlane) put(onPlane.map((x, k) => x + grab.normal[k] * radius(SCALE.hand)), COLOR.touching, SCALE.hand)
    recast(m, onPlane)
  } else if (m.kind === "leftup") {
    if (grab.gaps.length || grab.partMiss.length) {
      const d = { node: grab.node, ms: m.t - grab.t0, gaps: grab.gaps, partGaps: grab.partGaps, off: grab.off, partMiss: grab.partMiss, nodes: grab.nodes }
      drags.push(d)
      rec.log("drag", `on ${d.node}, ${d.ms}ms, ${plural(d.gaps.length, "fresh cast")}`, d)
    }
    grab = null
    lingerUntil = Date.now() + LINGER_MS.release
  }
}
const tick = setInterval(() => {
  if (!grab && lingerUntil && Date.now() > lingerUntil) { lingerUntil = 0; put(REST[0], COLOR.rest, SCALE.hand); put2(REST[1], COLOR.rest) }
}, 50)

console.log(`\n▶ Click and drag outside\n  On foot or in an external view: doors, covers, caps, anything on the aircraft. The green ball goes where you click. While you drag, the green ball glides on the plane of the spot you pressed, and the blue one follows a fresh cast of the ray onto the model. ${SKIP} ends.`)
beep(1000, 100)
const why = await new Promise((resolve) => {
  onSkip = () => resolve("Page Up")
  setTimeout(() => resolve("the 20-minute cap"), CAP_MS)
})
clearInterval(tick)
clearInterval(poll)
await finish(why)
