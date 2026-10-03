/*
 * p23: inside, with the cockpit posed from its own code, does a fresh cast of
 * the ray follow a drag as well as it does outside, on MSFS 2024?
 *
 * Inside, a drag glides on the plane of the spot first pressed (p20), because
 * a fresh cast fell through levers the model held where the file stores them.
 * Outside, with every part whose code runs posed before each cast, a fresh
 * cast followed the curved skin and the pilot judged it right
 * (record/areas/avatars/log.md, 2026-10-03). This probe poses the cockpit the
 * same way: every animation whose code in the behavior XML can run, in
 * lib/rpn.mjs's lenient mode, from variables watched every frame, with the
 * part being dragged posed again for each cast. Parts sim templates drive, and
 * code that keeps its own state, stay as the file stores them.
 *
 * While a drag lasts, the green ball glides and the blue one follows a fresh
 * cast, and the log says, for each drag, whether the part held was posed, how
 * far the fresh cast was from the glide, and how often it fell behind the glide
 * point by more than 5cm, the way it fell through a lever before.
 *
 * In the Black Square Baron, its mixture levers are posed and its throttle and
 * prop levers aren't (templates), so one aircraft shows both; in the A2A
 * Comanche, every quadrant lever is posed. Parked, the sim in front, in the
 * cockpit:
 *
 *   drags     Drag the throttle, prop, and mixture levers, then knobs,
 *             switches, the yoke, and the panel: the green ball glides, the
 *             blue one recasts. Page Up ends; it ends by itself after 20
 *             minutes.
 *
 *   node experiments/areas/avatars/p23-cockpit-recast.mjs
 *
 * Nothing touches the pilot's input: clicks are read through Raw Input
 * (experiments/tools/mouse.mjs). It needs crosscheck-p12-follow 0.6.0, which
 * places a second object. The probe turns the module off and removes both
 * spheres at the end and on Ctrl+C.
 */

import path from "node:path"

import { InitPosition } from "node-simconnect"

import { SKIP, startBeeper, startKeys } from "../../tools/guide.mjs"
import { startMouse } from "../../tools/mouse.mjs"
import { Recorder, fmt, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { poseAt } from "./lib/animate.mjs"
import { animationCode, behaviorText, cockpitFiles, visibilityCode } from "./lib/cockpit-files.mjs"
import { MEASURED, rayThrough } from "./lib/pick.mjs"
import { RAD, wrap } from "./lib/pose.mjs"
import { cast, crossPlane, loadCockpit, repose, subtree } from "./lib/raycast.mjs"
import { compile } from "./lib/rpn.mjs"

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const SPHERE = "CROSSCHECK_HandSphere"
const SIMOBJECT = 1
const radius = (scale) => 0.02 * (0.5 + 4.5 * scale / 100)
const SCALE = 5
const COLOR = { rest: 0, glide: 1, recast: 2 }
const LINGER_MS = 250
const RECAST_MS = 50
// A fresh cast this much farther along the ray than the glide point has
// passed through the part held, to what's behind it.
const BEHIND_M = 0.05
const CAP_MS = 20 * 60_000
// p15: nose up and right wing down are both negative; lead 1 frame (p16).
const SIGNS = [-1, -1]
const LEAD = 1
const L = (n) => [`L:CROSSCHECK_P12_${n}`, "number"]
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

const rec = new Recorder("p23-cockpit-recast", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p23-cockpit-recast" })
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
  const q = (a, f) => (a.length ? ([...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * f)] * 100).toFixed(1) : "-")
  for (const [label, set] of [["posed parts", drags.filter((d) => d.posed)], ["parts as the file stores them", drags.filter((d) => !d.posed)]]) {
    if (!set.length) continue
    const gaps = set.flatMap((d) => d.gaps), behind = set.flatMap((d) => d.behind)
    note("drags", `${label}: ${plural(set.length, "drag")}, ${plural(gaps.length, "fresh cast")}, a median ${q(gaps, 0.5)}cm from the glide and ${q(gaps, 0.9)}cm at the 90th percentile; ${behind.filter(Boolean).length} fell behind the glide point by more than ${BEHIND_M * 100}cm`)
  }
  for (const d of drags.slice(0, 20)) note("drag", `on ${d.node}${d.posed ? " (posed)" : ""}, ${(d.ms / 1000).toFixed(1)}s: ${plural(d.gaps.length, "fresh cast")}, a median ${q(d.gaps, 0.5)}cm from the glide, ${d.behind.filter(Boolean).length} behind it (${[...new Set(d.nodes)].slice(0, 5).join(", ")})`)
  const text = [
    "p23 · Inside, with the cockpit posed from its own code, a fresh cast beside the glide while the pilot drags, on MSFS 2024",
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

// ------------------------------------------------ the cockpit's animations and visibility

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
  if (c) shows.push({ node: i, code: c, nodes: subtree(model, i) })
}
const levers = plays.filter((p) => /throttle|mixture|prop|rpm/i.test(p.animation.name)).map((p) => p.animation.name)
note("model", `${files.package}, ${path.basename(files.gltf)}: ${plural(cockpit.triangles, "triangle")}; ${plays.length} of ${plural((model.g.animations ?? []).length, "animation")} posed, moving ${plural(moved.size, "node")}, among them ${levers.join(", ") || "no engine lever"}; ${plural(shows.length, "visibility code")} run`)

const key = (v) => (v.kind === "A" ? v.name : `${v.kind}:${v.name}`)
const values = new Map()
const get = (v) => values.get(key(v)) ?? 0
const watched = new Map()
for (const c of [...plays.map((p) => p.code), ...shows.map((s) => s.code)]) for (const v of c.vars) watched.set(key(v), [key(v), v.unit])
const watchList = [...watched.values()]
for (let i = 0; i < watchList.length; i += 200) sim.watch(watchList.slice(i, i + 200), { period: "frame", label: "cockpit variables", onData: (got) => { for (const [k, v] of got) values.set(k, v) } })

const pose = () => poseAt(model, plays.map((p) => ({ animation: p.animation, frame: p.code.run(get), length: p.length })))
const hiddenNow = () => { const h = new Set(); for (const s of shows) if (!s.code.run(get)) for (const n of s.nodes) h.add(n); return h }

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
// SIMOBJECT is the model's space, the model's origin taken as the aircraft's
// reference point (p18, p21).
const eyeOf = (c) => [c.x, c.y, c.z]
const modelToFrame = (p) => ({ forward: p[2], right: -p[0], up: p[1] })

// ------------------------------------------------ the spheres

const v0 = await sim.read(POS)
const init = new InitPosition()
Object.assign(init, { latitude: v0.get("PLANE LATITUDE"), longitude: v0.get("PLANE LONGITUDE"), altitude: v0.get("PLANE ALTITUDE"), pitch: 0, bank: 0, heading: wrap(v0.get("PLANE HEADING DEGREES TRUE")), onGround: false, airspeed: 0 })
for (const slot of ["", "2"]) {
  const r = await sim.spawn(SPHERE, "", init)
  if (r.id === undefined) { note("sphere", `${SPHERE}: not created: ${r.error}`); await finish("a failed spawn") }
  spheres.push(r.id)
  for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
  setModule({ [`OBJECT${slot}`]: r.id, [`SCALE${slot}`]: SCALE, [`COLOR${slot}`]: COLOR.rest })
}
// At rest, 0.35m ahead of the eye and 0.35m below it, the second ball beside.
const eye0 = eyeOf(cam)
const REST = [[eye0[0], eye0[1] - 0.35, eye0[2] + 0.35], [eye0[0] - 0.08, eye0[1] - 0.35, eye0[2] + 0.35]]
const put = (slot, p, color) => { const f = modelToFrame(p); setModule({ [`FWD${slot}`]: f.forward, [`RIGHT${slot}`]: f.right, [`UP${slot}`]: f.up, [`COLOR${slot}`]: color }) }
put("", REST[0], COLOR.rest)
put("2", REST[1], COLOR.rest)
setModule({ SIGN_PITCH: SIGNS[0], SIGN_BANK: SIGNS[1], LEAD, MODE: 1 })
await sleep(500)

// ------------------------------------------------ presses and drags

// The part a drag holds: everything under the highest posed node above the
// node it touched, or just that node if nothing posed moves it.
function partOf(node) {
  let root = -1
  for (let j = node; j !== -1; j = model.parent[j]) if (moved.has(j)) root = j
  return { posed: root >= 0, nodes: subtree(model, root >= 0 ? root : node) }
}

let grab = null
let lingerUntil = 0
const ballAt = (hit) => hit.point.map((x, k) => x + hit.normal[k] * radius(SCALE))

function press(m) {
  const c = cam
  if (!c) return null
  repose(cockpit, 0, pose(), moved)
  const origin = eyeOf(c), dir = rayThrough(c, m, MEASURED)
  const hit = cast(cockpit, origin, dir, { skip: hiddenNow() })
  rec.log("press", `at ${m.x}, ${m.y}: ${hit?.chain[0] ?? "nothing"}`, { mouse: m, cam: c, hit: hit && { point: hit.point, normal: hit.normal, distance: hit.distance, chain: hit.chain } })
  if (!hit) { console.log("  press: nothing"); return null }
  const part = partOf(hit.node)
  console.log(`  press: ${hit.chain[0]}${part.posed ? " (posed)" : ""}`)
  put("", ballAt(hit), COLOR.glide)
  put("2", ballAt(hit), COLOR.recast)
  lingerUntil = 0
  return { t0: m.t, point: hit.point, normal: hit.normal, node: hit.chain[0], part, last: 0, gaps: [], behind: [], nodes: [] }
}

function move(m) {
  const c = cam
  if (!c) return
  const origin = eyeOf(c), dir = rayThrough(c, m, MEASURED)
  const onPlane = crossPlane(origin, dir, grab.point, grab.normal)
  if (onPlane) put("", onPlane.map((x, k) => x + grab.normal[k] * radius(SCALE)), COLOR.glide)
  const now = Date.now()
  if (now - grab.last < RECAST_MS) return
  grab.last = now
  if (grab.part.posed) repose(cockpit, 0, pose(), grab.part.nodes)
  const hit = cast(cockpit, origin, dir, { skip: hiddenNow() })
  if (!hit) return
  put("2", ballAt(hit), COLOR.recast)
  grab.nodes.push(hit.chain[0])
  if (onPlane) {
    grab.gaps.push(dist(onPlane, hit.point))
    grab.behind.push(hit.distance - dist(origin, onPlane) > BEHIND_M)
  }
}

stopMouse = await startMouse((m) => {
  if (m.kind === "size" || !m.foreground) return
  if (m.kind === "left") { grab = press(m); return }
  if (!grab) return
  if (m.kind === "move") move(m)
  else if (m.kind === "leftup") {
    const d = { node: grab.node, posed: grab.part.posed, ms: m.t - grab.t0, gaps: grab.gaps, behind: grab.behind, nodes: grab.nodes }
    if (d.gaps.length) { drags.push(d); rec.log("drag", `on ${d.node}${d.posed ? " (posed)" : ""}, ${d.ms}ms`, d) }
    grab = null
    lingerUntil = Date.now() + LINGER_MS
  }
})
const tick = setInterval(() => {
  if (!grab && lingerUntil && Date.now() > lingerUntil) { lingerUntil = 0; put("", REST[0], COLOR.rest); put("2", REST[1], COLOR.rest) }
}, 50)

console.log(`\n▶ Drag the levers, then anything\n  The throttle, prop, and mixture levers first, then knobs, switches, the yoke, and the panel. The green ball glides on the plane of the spot you pressed; the blue one follows a fresh cast onto the posed cockpit. The console says whether the part you pressed is posed. ${SKIP} ends.`)
beep(1000, 100)
const why = await new Promise((resolve) => {
  keys.listen((k) => { if (k.key === "SKIP") resolve("Page Up") })
  setTimeout(() => resolve("the 20-minute cap"), CAP_MS)
})
clearInterval(tick)
clearInterval(poll)
await finish(why)
