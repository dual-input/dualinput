/*
 * p08: whether an object we write every frame stays put in a moving cockpit,
 * on MSFS 2024.
 *
 * Every figure test so far ran parked at a gate (record/areas/avatars/log.md).
 * In flight, our writes come from outside the sim and land at least a frame
 * after the sim moved the aircraft, so a figure written in world coordinates
 * could trail the cockpit by the distance the aircraft covers in that time.
 * Our FS Copilot fork moved the user aircraft from a WASM module for its
 * frame-locked path (FS Copilot fork, record/traffic-atc/docs/01-design.md,
 * Injecting), and this probe measures how far an external client's writes lag.
 *
 * The stand-in is Marshaller_Stick, a marshaller's wand, which showed when
 * spawned (p01). Every sim frame the probe reads the aircraft, writes the wand
 * at a point fixed to the aircraft, and reads back where the sim has the wand
 * in that frame. The difference, in meters forward, right, and up of the
 * aircraft, is how far it trails. The avatar's seated object, which the sim
 * moves with the aircraft itself, is read the same way as a control.
 *
 * About a minute and a half, in level flight at cruise, straight ahead,
 * autopilot on if the aircraft has one, with the sim in front:
 *
 *   wand     Press Page Down and watch the wand above the seat beside you for
 *            25s. For 12s it's written where the aircraft is; after the short
 *            beep, it's written ahead by the lag the first half measured.
 *   pointer  Press Page Down. At the first short beep look up at the roof, at
 *            the second look right, and at the third look around freely until
 *            the long low beep, 18s. After the second beep the wand floats 0.6m
 *            in front of your eyes, where SimConnect_CameraGet says you look.
 *
 * The positions turn by the aircraft's heading only, so pitch and bank add
 * error; the report gives both.
 *
 * Nothing touches the pilot's input or the camera: the probe never calls
 * SimConnect_CameraAcquire. The wand goes with AIRemoveObject at the end of
 * each step and on Ctrl+C, and the sim removes a client's AI objects when the
 * client disconnects (measured on MSFS 2024, 2026-09-06, FS Copilot fork,
 * record/traffic-atc/docs/build/log.md, "2026-09-06 · Stage 0 capture read;
 * TrafficInject built and smoke-tested — Q01, Q08 settled").
 *
 *   node experiments/areas/avatars/p08-in-flight.mjs
 *
 * Output: one line per step on the console, every frame's readings in
 * experiments/areas/avatars/results/p08-in-flight-<time>.ndjson, and the
 * report in the .txt beside it.
 */

import { InitPosition } from "node-simconnect"

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { Recorder, fmt, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { RAD, toBody, toWorld, wrap } from "./lib/pose.mjs"

const USER = 0
// MSFS 2024 SDK, SimConnect.h: SIMCONNECT_OBJECT_ID_MAX + 1, which p03 measured
// sitting exactly on the pilot's seat object while seated.
const USER_AVATAR = 0xffffffff - 128 + 1

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const AIRCRAFT = [...POS, ["PLANE PITCH DEGREES", "degrees"], ["PLANE BANK DEGREES", "degrees"]]

const STAND_IN = "Marshaller_Stick"
const HAND_UP_M = 0.4
// A guess at eye height above the seat object; the pilot says how far off the
// pointer sits.
const EYE_UP_M = 0.65
const NOSE_M = 0.6
const KT = 1.94384
// SimConnect_CameraGet's SIMOBJECT referential (SimConnect.h,
// SIMCONNECT_POSITION_REFERENTIAL_SIMOBJECT). p06 found its Bank field
// carrying the yaw (record/areas/avatars/log.md, 2026-10-03).
const SIMOBJECT = 1

const rec = new Recorder("p08-in-flight", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p08-in-flight" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null)
const p95 = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] : null)
const bodyText = (b) => `${b.forward.toFixed(2)}m forward, ${b.right.toFixed(2)}m right, ${b.up.toFixed(2)}m up`

// ------------------------------------------------ every frame

let ac = null
const history = []
let velocity = { forward: 0, right: 0, up: 0 } // meters a second, in the aircraft's frame
let phase = null
const frames = new Map() // phase → readings

// The wand: its object, where it should sit in the aircraft's frame, and how
// far ahead of the aircraft's last reported pose to write it.
const wand = { id: null, target: null, leadS: 0, failed: false }

sim.watch(AIRCRAFT, {
  period: "frame",
  changed: false,
  label: "aircraft",
  onData: (v, t) => {
    const [lat, lon, alt, hdg, pitch, bank] = AIRCRAFT.map(([n]) => v.get(n))
    if (!Number.isFinite(lat)) return
    ac = { t, lat, lon, alt, hdg, pitch, bank }
    history.push(ac)
    while (history.length && history[0].t < t - 600) history.shift()
    const old = history[0]
    if (old !== ac && t > old.t) {
      const d = toBody(old, ac)
      const s = (t - old.t) / 1000
      velocity = { forward: d.forward / s, right: d.right / s, up: d.up / s }
    }
    if (wand.id !== null && wand.target && !wand.failed) {
      const b = wand.target
      const at = toWorld(ac, { forward: b.forward + velocity.forward * wand.leadS, right: b.right + velocity.right * wand.leadS, up: b.up + velocity.up * wand.leadS })
      sim.set(POS, [at.lat, at.lon, at.alt, ac.hdg], { object: wand.id, label: "wand pose", quiet: true })
    }
  },
})
rec.onRecord((x) => { if (x.kind === "exception" && x.sent === "wand pose") wand.failed = true })

// Where an object is in the aircraft's frame, against the aircraft's pose
// from the same sim frame, since both requests are answered each frame in
// the order they were made.
function bodyWatch(object, label, onBody) {
  return sim.watch(POS, {
    period: "frame",
    changed: false,
    label,
    object,
    onData: (v) => {
      const [lat, lon, alt] = POS.map(([n]) => v.get(n))
      if (!ac || !Number.isFinite(lat)) return
      onBody(toBody(ac, { lat, lon, alt }))
    },
  })
}

function record(kind, body) {
  if (!phase) return
  let list = frames.get(phase)
  if (!list) frames.set(phase, list = [])
  const speed = Math.hypot(velocity.forward, velocity.right)
  const r = { kind, ...body, target: kind === "wand" ? wand.target : null, speed, pitch: ac.pitch, bank: ac.bank, leadS: wand.leadS }
  list.push(r)
  rec.data(kind, phase, r)
}

let avatarBody = null
bodyWatch(USER_AVATAR, "avatar", (b) => { avatarBody = b; record("avatar", b) })
let wandWatch = null

// The camera's direction, read every 33ms; SimConnect_CameraGet replies carry
// no request ID, so only the SIMOBJECT referential is asked for.
let look = null
sim.handle.on("cameraData", (r) => {
  const c = r.cameraData
  if (c.positionReferential !== SIMOBJECT) return
  look = { t: Date.now(), pitch: c.pbh.pitch, yaw: c.pbh.bank }
})

// ------------------------------------------------ setup

const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
await sleep(1000)
const setup = []
const note = (text, fields = {}) => { setup.push(text); rec.log("setup", text, fields) }
note(`aircraft TITLE ${JSON.stringify(title)}${ac ? `, ${(Math.hypot(velocity.forward, velocity.right) * KT).toFixed(0)} kt over the ground, pitch ${ac.pitch.toFixed(1)}°, bank ${ac.bank.toFixed(1)}°` : ", no position"}`)
note(avatarBody ? `avatar's object: ${bodyText(avatarBody)}` : "avatar's object: no position")

// The seat beside the pilot: a seat object other than the pilot's, averaged
// over a second of frames, or the avatar's seat mirrored across the centerline.
let beside = null
for (const id of ac ? await sim.byType(1, 50, { timeoutMs: 2000 }) : []) {
  const t = (await sim.readStrings(["TITLE"], { object: id })).get("TITLE") ?? ""
  if (!/^SEAT_/i.test(t) || /_pilot$/i.test(t)) continue
  const seen = []
  const w = bodyWatch(id, `seat ${t}`, (b) => seen.push(b))
  await sleep(1000)
  w.stop()
  if (seen.length) beside = { from: `seat ${t}`, body: { forward: median(seen.map((b) => b.forward)), right: median(seen.map((b) => b.right)), up: median(seen.map((b) => b.up)) } }
  break
}
if (!beside && avatarBody) beside = { from: "the avatar's seat mirrored", body: { ...avatarBody, right: -avatarBody.right } }
note(beside ? `beside the pilot: ${beside.from}, ${bodyText(beside.body)}` : "no seat to place the wand by")

// ------------------------------------------------ steps

async function ask(heading, instruction) {
  console.log(`\n▶ ${heading}\n  ${instruction}\n  ${START} to start, ${SKIP} to skip.`)
  const k = await keys.next()
  rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
  return k.key === "START"
}

async function spawnWand(body) {
  const at = toWorld(ac, body)
  const init = new InitPosition()
  Object.assign(init, { latitude: at.lat, longitude: at.lon, altitude: at.alt, pitch: 0, bank: 0, heading: wrap(ac.hdg), onGround: false, airspeed: 0 })
  const r = await sim.spawn(STAND_IN, "", init)
  if (r.id === undefined) return r
  for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
  wand.id = r.id
  wand.target = body
  wand.failed = false
  wandWatch = bodyWatch(r.id, "wand", (b) => record("wand", b))
  return r
}

function removeWand() {
  wandWatch?.stop()
  wandWatch = null
  if (wand.id !== null) sim.remove(wand.id)
  wand.id = null
  wand.target = null
}

async function timed(name, ms, { short = true } = {}) {
  phase = name
  if (short) beep(1000, 100)
  await sleep(ms)
  phase = null
}

// How far the wand trailed its target in one phase, and the lag that implies.
function wandSummary(name) {
  const list = (frames.get(name) ?? []).filter((r) => r.kind === "wand" && r.target)
  if (!list.length) return { name, text: `${name}: no readings` }
  const err = list.map((r) => ({ forward: r.forward - r.target.forward, right: r.right - r.target.right, up: r.up - r.target.up, speed: r.speed }))
  const speed = median(err.map((e) => e.speed))
  const fwd = median(err.map((e) => e.forward))
  const lagMs = speed > 1 ? (-fwd / speed) * 1000 : null
  const att = list.map((r) => Math.max(Math.abs(r.pitch), Math.abs(r.bank)))
  const avatar = (frames.get(name) ?? []).filter((r) => r.kind === "avatar")
  const spread = (k) => { const m = median(avatar.map((r) => r[k])); return p95(avatar.map((r) => Math.abs(r[k] - m))) }
  // Parked, the avatar's object sat 0.10m forward of the reference point (p03);
  // a median far from that here would mean the readings pair with the wrong
  // frame's aircraft pose.
  const avatarAt = avatar.length ? { forward: median(avatar.map((r) => r.forward)), right: median(avatar.map((r) => r.right)), up: median(avatar.map((r) => r.up)) } : null
  return {
    name, lagMs,
    text: `${name}: ${list.length} frames at ${(speed * KT).toFixed(0)} kt, lead ${(list[0].leadS * 1000).toFixed(0)}ms; ` +
      `wand off its target by forward ${fwd.toFixed(2)}m (p95 ${p95(err.map((e) => Math.abs(e.forward))).toFixed(2)}m), ` +
      `right ${median(err.map((e) => e.right)).toFixed(2)}m, up ${median(err.map((e) => e.up)).toFixed(2)}m` +
      `${lagMs !== null ? `, a lag of ${lagMs.toFixed(0)}ms` : ""}; attitude up to ${Math.max(...att).toFixed(1)}°; ` +
      `avatar's object at ${avatarAt ? `${bodyText(avatarAt)}, varying by p95 ${spread("forward").toFixed(2)}m forward, ${spread("right").toFixed(2)}m right, ${spread("up").toFixed(2)}m up` : "—"}`,
  }
}

const report = { wand: [], pointer: null }

let stopping = false
process.on("SIGINT", async () => {
  if (stopping) process.exit(1)
  stopping = true
  rec.log("stop", "Ctrl+C: removing the wand and writing the report")
  removeWand()
  await finish()
  process.exit(0)
})

console.log("\nBefore you start: in level flight at cruise, straight ahead, autopilot on if the aircraft has one, the sim in front. About a minute and a half.")

// wand --------------------------------------------

if (beside && ac && await ask("The wand beside you", `Press Page Down, then watch the wand above the seat beside you for 25s. Halfway, a short beep switches to writing it ahead by the lag measured so far. Stop watching at the long low beep.`)) {
  const target = { ...beside.body, up: beside.body.up + HAND_UP_M }
  const r = await spawnWand(target)
  if (r.id === undefined) {
    rec.log("wand", `${STAND_IN}: not created: ${r.error}`)
  } else {
    beep(1000, 100)
    await sleep(1000)
    await timed("written where the aircraft is", 12_000, { short: false })
    const first = wandSummary("written where the aircraft is")
    report.wand.push(first)
    rec.log("wand", first.text)
    wand.leadS = first.lagMs && first.lagMs > 0 ? first.lagMs / 1000 : 0
    await timed("written ahead by the lag", 12_000)
    const second = wandSummary("written ahead by the lag")
    report.wand.push(second)
    rec.log("wand", second.text)
    removeWand()
    beep(500, 600)
    console.log("  Tell Claude how the wand sat in each half: steady, trailing, jittering, or jumping.")
  }
}

// pointer -----------------------------------------

if (avatarBody && ac && await ask("A pointer at your nose", "Press Page Down. At the first short beep look up at the roof, at the second look right, and at the third look around freely until the long low beep, 18s.")) {
  const eye = { ...avatarBody, up: avatarBody.up + EYE_UP_M }
  const ahead = { ...eye, forward: eye.forward + NOSE_M }
  const r = await spawnWand(ahead)
  if (r.id === undefined) {
    rec.log("pointer", `${STAND_IN}: not created: ${r.error}`)
  } else {
    const samples = []
    const poll = setInterval(() => {
      sim.send("camera get SIMOBJECT", () => sim.handle.cameraGet(SIMOBJECT))
      if (look && phase) samples.push({ phase, ...look })
    }, 33)
    await timed("look up", 3000)
    await timed("look right", 3000)
    // Which sign means up and which means right, from where the pilot looked.
    const up = median(samples.filter((s) => s.phase === "look up").map((s) => s.pitch))
    const right = median(samples.filter((s) => s.phase === "look right").map((s) => s.yaw))
    const pitchSign = up === null || up >= 0 ? 1 : -1
    const yawSign = right === null || right >= 0 ? 1 : -1
    rec.log("pointer", `looking up read pitch ${fmt(up)}, looking right read yaw ${fmt(right)}: up is ${pitchSign > 0 ? "+" : "−"}pitch, right is ${yawSign > 0 ? "+" : "−"}yaw`)
    const aim = setInterval(() => {
      if (!look) return
      const th = pitchSign * look.pitch * RAD
      const ps = yawSign * look.yaw * RAD
      wand.target = { forward: eye.forward + NOSE_M * Math.cos(th) * Math.cos(ps), right: eye.right + NOSE_M * Math.cos(th) * Math.sin(ps), up: eye.up + NOSE_M * Math.sin(th) }
    }, 33)
    await timed("look around", 12_000)
    clearInterval(aim)
    clearInterval(poll)
    const s = wandSummary("look around")
    report.pointer = { up, right, pitchSign, yawSign, text: s.text }
    rec.log("pointer", s.text)
    removeWand()
    beep(500, 600)
    console.log("  Tell Claude whether the wand stayed in front of your nose as you looked around, and how far off it sat.")
  }
}

await finish()
process.exit(0)

async function finish() {
  removeWand()
  const counted = new Map()
  for (const e of rec.timeline.filter((x) => x.kind === "exception")) counted.set(e.text, (counted.get(e.text) ?? 0) + 1)
  const p = report.pointer
  const text = [
    "p08 · An object written every frame in a moving cockpit, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    "",
    "Setup:",
    ...setup.map((s) => `  ${s}`),
    "",
    "The wand beside the pilot:",
    ...(report.wand.length ? report.wand.map((w) => `  ${w.text}`) : ["  not run"]),
    "",
    `The pointer: ${p ? `looking up read pitch ${fmt(p.up)}, looking right read yaw ${fmt(p.right)}; ${p.text}` : "not run"}`,
    "",
    `Exceptions: ${counted.size ? "" : "none"}`,
    ...[...counted].map(([e, n]) => `  ${n} × ${e}`),
  ].join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
}
