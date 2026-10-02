/*
 * p04: whether a GSX person walks when we drive its animation frame ourselves,
 * on MSFS 2024.
 *
 * In p02 a GSX passenger followed the avatar but slid (record/areas/avatars/
 * log.md, 2026-10-02). GSX's people have one long animation clip, and the
 * frame shown is the value of one per-object variable: the passengers' model
 * XML passes (A:VELOCITY BODY Y,m/s) to ASOBO_GT_Anim_Code, and the cleaner's
 * passes (A:WAGON FRONT LINK ORIENTATION, number). The sim.cfg lists which
 * frames are the idle and walk loops, at 30 frames a second, and how far one
 * walk loop carries the person (read in fsdreamteam-gsx-pro 4.0.19,
 * SimObjects/GroundVehicles/FSDT_Passengers/sim.cfg, [fltsim.23], and
 * FSDT_cleaning_crew/sim.cfg, [fltsim.1], with each model's XML). GSX's own
 * program writes those variables; p02 wrote VELOCITY BODY Z, which nothing
 * in the model reads.
 *
 * About a minute, on foot beside the aircraft:
 *
 *   in place  Press Page Down, and the passenger, then the cleaner, stands 4m
 *             in front of you for 6s each, with its walk loop played by our
 *             writes. Press Page Down whenever a figure's legs move.
 *   follow    Press Page Down, then walk, stop, and walk again for 30s: the
 *             first figure whose legs moved stays 4m in front of you, its walk
 *             frame advanced by the distance it covers, and its idle loop
 *             played while you stand.
 *
 * Nothing touches the pilot's input. The figures go with AIRemoveObject at the
 * end of each step and on Ctrl+C, and the sim removes a client's AI objects
 * when the client disconnects (measured on MSFS 2024, 2026-09-06, FS Copilot
 * fork, record/traffic-atc/docs/build/log.md, "2026-09-06 · Stage 0 capture
 * read; TrafficInject built and smoke-tested — Q01, Q08 settled").
 *
 *   node experiments/areas/avatars/p04-walk.mjs
 *
 * Output: one line per step on the console, every sample in
 * experiments/areas/avatars/results/p04-walk-<time>.ndjson, and the report in
 * the .txt beside it.
 */

import { InitPosition } from "node-simconnect"

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { distance } from "../aircraft/lib/flights.mjs"
import { Recorder, fmt, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { offset, poseAt, wrap } from "./lib/pose.mjs"

// MSFS 2024 SDK, SimConnect.h: SIMCONNECT_OBJECT_ID_MAX + 1, which p01
// measured following the avatar.
const USER_AVATAR = 0xffffffff - 128 + 1

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const POSE = [...POS, ["GROUND VELOCITY", "knots"]]

// Frames and strides from the sim.cfg files named above: the passenger's
// couatl.anim_jetwaypassenger_idle is 0 140, the first walk loop 155 260 with
// step_length 1.19 over step_cycles 3, and the cleaner's idle is 90 138 and
// walk 139 203 with step_length 1.30 over 2 cycles.
const FIGURES = [
  { name: "passenger", title: "FSDT_Passenger_CASUAL_M_0030", channel: ["VELOCITY BODY Y", "meters per second"], idle: [0, 140], walk: [155, 260], strideM: 3 * 1.19 },
  { name: "cleaner", title: "FSDT_cleaning_crew_M_0020", channel: ["WAGON FRONT LINK ORIENTATION", "number"], idle: [90, 138], walk: [139, 203], strideM: 2 * 1.30 },
]

const FPS = 30
const AHEAD_M = 4
const IN_PLACE_MS = 6000
const GAP_MS = 1500
const FOLLOW_MS = 30_000
const DELAY_MS = 300
const STILL_MPS = 0.3

const loopFrame = ([a, b], frames) => a + (((frames % (b - a)) + (b - a)) % (b - a))

const rec = new Recorder("p04-walk", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p04-walk" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()

const report = { inPlace: [], follow: null }
const spawned = new Set()

// ------------------------------------------------ the avatar, and the drive

const samples = []
let drive = null // called once per avatar sample while a figure is up

sim.watch(POSE, {
  period: "frame",
  changed: false,
  label: "avatar",
  object: USER_AVATAR,
  onData: (v, t) => {
    const [lat, lon, alt, hdg, gs] = POSE.map(([n]) => v.get(n))
    if (!Number.isFinite(lat)) return
    samples.push({ t, lat, lon, alt, hdg, gs })
    while (samples[0].t < t - 5000) samples.shift()
    if (drive) drive(t)
  },
})
const latest = () => samples[samples.length - 1] ?? null

// Stops writing a definition after its first exception, so a variable the sim
// refuses doesn't print a line per frame.
const failed = new Set()
rec.onRecord((x) => { if (x.kind === "exception" && typeof x.sent === "string") failed.add(x.sent) })
const write = (id, label, vars, values) => { if (!failed.has(label)) sim.set(vars, values, { object: id, label, quiet: true }) }

async function create(f, at, facing) {
  const init = new InitPosition()
  Object.assign(init, { latitude: at.lat, longitude: at.lon, altitude: at.alt, pitch: 0, bank: 0, heading: wrap(facing), onGround: true, airspeed: 0 })
  const r = await sim.spawn(f.title, "", init)
  if (r.id === undefined) return r
  spawned.add(r.id)
  // Released and frozen, then written every frame, as our FS Copilot fork drove
  // injected traffic (FS Copilot fork, record/traffic-atc/docs/01-design.md, Driving).
  sim.release(r.id)
  for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
  return r
}

function removeAll() {
  for (const id of spawned) sim.remove(id)
  spawned.clear()
}

// What the figure's channel reads back, against what we last wrote.
async function readBack(id, f, wrote) {
  const v = await sim.read([f.channel], { object: id, label: `read back ${f.channel[0]} on object ${id}`, timeoutMs: 1500 })
  const got = v.get(f.channel[0])
  return { wrote, got: got ?? null, error: v.error }
}

async function ask(heading, instruction) {
  console.log(`\n▶ ${heading}\n  ${instruction}\n  ${START} to start, ${SKIP} to skip.`)
  const k = await keys.next()
  rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
  return k.key === "START"
}

let stopping = false
process.on("SIGINT", async () => {
  if (stopping) process.exit(1)
  stopping = true
  rec.log("stop", "Ctrl+C: removing the figures and writing the report")
  drive = null
  removeAll()
  await finish()
  process.exit(0)
})

console.log([
  "",
  "Before you start:",
  "  - on foot beside the aircraft, with open ground around you",
  "  - about a minute",
].join("\n"))

// in place ----------------------------------------

if (latest() && await ask("Figures walking in place", `Stand still facing open ground, and press Page Down. A passenger, then a cleaner, stands ${AHEAD_M}m in front of you for ${IN_PLACE_MS / 1000}s each, with its walk loop playing. Press Page Down whenever a figure's legs move.`)) {
  const presses = []
  const unlisten = keys.listen((k) => {
    if (k.key !== "START") return
    presses.push(k.t)
    rec.log("press", "Page Down: legs moving")
  })
  for (const f of FIGURES) {
    const p = latest()
    const at = offset(p, AHEAD_M, 0)
    beep(1000, 100)
    const t0 = Date.now()
    const r = await create(f, at, p.hdg + 180)
    const out = { name: f.name, title: f.title, channel: f.channel[0], id: r.id ?? null, error: r.error ?? null, frames: 0, readBack: null, moved: false }
    if (out.id !== null) {
      const label = `${f.name} frame`
      let last = null
      drive = () => {
        last = loopFrame(f.walk, Math.floor(((Date.now() - t0) / 1000) * FPS))
        out.frames++
        write(out.id, label, [f.channel], [last])
      }
      await sleep(IN_PLACE_MS / 2)
      out.readBack = await readBack(out.id, f, last)
      await sleep(Math.max(0, t0 + IN_PLACE_MS - Date.now()))
      drive = null
      out.refused = failed.has(label)
      sim.remove(out.id)
      spawned.delete(out.id)
    }
    out.moved = presses.some((t) => t >= t0 && t <= t0 + IN_PLACE_MS + GAP_MS / 2)
    report.inPlace.push(out)
    rec.log("in place", out.id === null
      ? `${f.title}: not created: ${out.error}`
      : `${f.title}: ${plural(out.frames, "frame")} written to ${f.channel[0]}${out.refused ? ", refused" : ""}; wrote ${fmt(out.readBack.wrote)}, read back ${fmt(out.readBack.got)}${out.readBack.error ? ` (${out.readBack.error})` : ""}; legs ${out.moved ? "MOVED" : "didn't move"}`, out)
    await sleep(GAP_MS)
  }
  unlisten()
  beep(500, 600)
}

// follow ------------------------------------------

const walker = FIGURES.find((f) => report.inPlace.find((x) => x.name === f.name)?.moved) ?? null
if (!walker) {
  rec.log("follow", "skipped: no figure's legs moved")
} else if (await ask("A walking figure in front of you", `Press Page Down, then walk, stop, and walk again for ${FOLLOW_MS / 1000}s: the ${walker.name} stays ${AHEAD_M}m in front of you, walking while you walk and idling while you stand. It goes at the long low beep.`)) {
  const p = latest()
  const r = await create(walker, offset(p, AHEAD_M, 0), p.hdg)
  if (r.id === undefined) {
    rec.log("follow", `${walker.title}: not created: ${r.error}`)
  } else {
    const out = { title: walker.title, id: r.id, frames: 0, walking: 0, idling: 0, distanceM: 0 }
    let prev = null
    let walkedM = 0
    const t0 = Date.now()
    const label = `${walker.name} follow frame`
    drive = (now) => {
      const q = poseAt(samples, now - DELAY_MS)
      if (!q) return
      const at = offset(q, AHEAD_M, 0)
      const step = prev ? distance(prev.lat, prev.lon, at.lat, at.lon) : 0
      const dt = prev ? (q.t - prev.t) / 1000 : 0
      prev = { ...at, t: q.t }
      const walking = dt > 0 && step / dt > STILL_MPS
      if (walking) walkedM += step
      const frame = walking
        ? walker.walk[0] + ((walkedM % walker.strideM) / walker.strideM) * (walker.walk[1] - walker.walk[0])
        : loopFrame(walker.idle, Math.floor(((now - t0) / 1000) * FPS))
      out.frames++
      if (walking) out.walking++
      else out.idling++
      write(out.id, "follow pose", POS, [at.lat, at.lon, q.alt, q.hdg])
      write(out.id, label, [walker.channel], [frame])
    }
    beep(1000, 100)
    await sleep(FOLLOW_MS)
    drive = null
    out.distanceM = walkedM
    out.refused = failed.has(label) || failed.has("follow pose")
    sim.remove(out.id)
    spawned.delete(out.id)
    beep(500, 600)
    report.follow = out
    rec.log("follow", `${walker.title}: ${plural(out.frames, "frame")} written, ${out.walking} walking and ${out.idling} idling, ${walkedM.toFixed(1)}m walked${out.refused ? ", some writes refused" : ""}`, out)
    console.log("  Tell Claude how it moved: legs in step with its speed, a clean stop into idle, feet sliding or not.")
  }
}

await finish()
process.exit(0)

// ---------------------------------------------------------------- report

async function finish() {
  drive = null
  removeAll()
  const fo = report.follow
  const lines = [
    "p04 · A GSX person walking by our own animation writes, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    "",
    "Walking in place:",
    ...(report.inPlace.length
      ? report.inPlace.map((x) => `  ${x.title} by ${x.channel}: ${x.id === null ? `not created: ${x.error}` : `${plural(x.frames, "frame")} written${x.refused ? ", refused" : ""}; wrote ${fmt(x.readBack?.wrote)}, read back ${fmt(x.readBack?.got)}; legs ${x.moved ? "MOVED" : "didn't move"}`}`)
      : ["  not run"]),
    "",
    `Following: ${fo ? `${fo.title}, ${plural(fo.frames, "frame")} written, ${fo.walking} walking and ${fo.idling} idling, ${fo.distanceM.toFixed(1)}m walked${fo.refused ? ", some writes refused" : ""}` : "not run"}`,
  ]
  const counted = new Map()
  for (const e of rec.timeline.filter((x) => x.kind === "exception")) counted.set(e.text, (counted.get(e.text) ?? 0) + 1)
  lines.push("", `Exceptions: ${counted.size ? "" : "none"}`)
  for (const [e, n] of counted) lines.push(`  ${n} × ${e}`)
  const text = lines.join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
}
