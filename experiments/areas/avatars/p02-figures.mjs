/*
 * p02: whether a GSX person can stand in for the other pilot's avatar, and
 * whether the avatar's heading is the way its body faces, on MSFS 2024.
 *
 * p01 read the avatar through SIMCONNECT_OBJECT_ID_USER_AVATAR every sim frame,
 * but the sim's own people, CharacterSim objects, were invisible when we
 * spawned them. The avatar's heading held 300° throughout, and so did the walk,
 * so whether it turns with the body is untested
 * (experiments/areas/avatars/results/p01-avatar-2026-10-02-21-05-51.txt).
 * GSX lists its people among the sim's ground vehicles, such as
 * FSDT_Passenger_CASUAL_M_0030 in that run's list, and our FS Copilot fork
 * spawned GSX's ground vehicles through the same call with no failures
 * (FS Copilot fork, record/traffic-atc/docs/build/log.md, "2026-09-06 · First
 * visual replay; engines, pushback, ground vehicles").
 *
 * About 2 minutes, on foot beside the aircraft:
 *
 *   heading   Press Page Down, then at each short beep: look around with the
 *             camera without moving (5s), walk one full circle (10s), and walk
 *             backward (4s). Stop at the long low beep. The report compares the
 *             avatar's heading with the direction it moved.
 *   figures   Press Page Down, and each short beep puts a person 4m in front
 *             of you for 4s. Press Page Down only when you see a person, not a
 *             prop.
 *   follow    Press Page Down, then walk and turn for 30s: the first person you
 *             saw stays 4m in front of you, facing the way you face, written
 *             every sim frame from where you were 300ms before.
 *
 * Nothing touches the pilot's input. Each figure goes with AIRemoveObject at
 * the end of its step and on Ctrl+C, and the sim removes a client's AI objects
 * when the client disconnects (measured on MSFS 2024, 2026-09-06, FS Copilot
 * fork, record/traffic-atc/docs/build/log.md, "2026-09-06 · Stage 0 capture
 * read; TrafficInject built and smoke-tested — Q01, Q08 settled").
 *
 *   node experiments/areas/avatars/p02-figures.mjs
 *
 * Output: one line per step on the console, every sample in
 * experiments/areas/avatars/results/p02-figures-<time>.ndjson, and the report
 * in the .txt beside it.
 */

import { execFileSync } from "node:child_process"

import { InitPosition } from "node-simconnect"

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { distance } from "../aircraft/lib/flights.mjs"
import { Recorder, fmt, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { bearing, offset, poseAt, turn, wrap } from "./lib/pose.mjs"

// MSFS 2024 SDK, SimConnect.h: SIMCONNECT_OBJECT_ID_MAX + 1, which p01 measured
// following the avatar while 2 and PLANE LATITUDE:2 didn't.
const USER_AVATAR = 0xffffffff - 128 + 1

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
// GROUND VELOCITY rather than VELOCITY BODY Z, which read 0 on the avatar while
// it walked (p01's run).
const POSE = [...POS, ["GROUND VELOCITY", "knots"], ["SIM ON GROUND", "bool"]]

// GSX titles from the sim's list in p01's run: a casual and a business
// passenger, a passenger in a pilot's uniform, a marshaller, and a cleaner. The
// last is one of the sim's own people, made by the call without a livery,
// because the _EX1 call left it invisible in p01.
const FIGURES = [
  { title: "FSDT_Passenger_CASUAL_M_0030" },
  { title: "FSDT_Passenger_BUSINESS_F_0024" },
  { title: "FSDT_Passenger_PILOT_02" },
  { title: "FSDT_Marshaller_02" },
  { title: "FSDT_cleaning_crew_M_0020" },
  { title: "CharacterSim_Male_Thin", legacy: true },
]

const SHOW_MS = 4000
const GAP_MS = 1500
const AHEAD_M = 4
const FOLLOW_MS = 30_000
const DELAY_MS = 300
const KNOTS_TO_FPS = 1.68781

// GSX runs as Couatl64.exe (experiments/areas/aircraft/run.mjs), and ChasePlane
// as "CP MSFS Bridge.exe" (seen in the development machine's process list,
// 2026-10-02). ChasePlane moves the camera, and GSX spawns its own people.
function addons() {
  let names
  try {
    names = execFileSync("tasklist", ["/fo", "csv", "/nh"], { encoding: "utf8" }).split(/\r?\n/).map((l) => l.split('","')[0].replace(/^"/, ""))
  } catch {
    return "unknown"
  }
  const found = [["GSX", /^Couatl64/i], ["ChasePlane", /^CP MSFS Bridge/i]].filter(([, re]) => names.some((n) => re.test(n))).map(([n]) => n)
  return found.length ? found.join(", ") : "neither GSX nor ChasePlane"
}

const rec = new Recorder("p02-figures", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p02-figures" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()
const running = addons()
rec.log("addons", `running: ${running}`, { running })

const report = { phases: [], figures: [], follow: null, rate: null }
const spawned = new Set()

// ------------------------------------------------ the avatar, every frame

const samples = []
let phase = null
const byPhase = new Map()
let follow = null

sim.watch(POSE, {
  period: "frame",
  changed: false,
  label: "avatar",
  object: USER_AVATAR,
  onData: (v, t) => {
    const [lat, lon, alt, hdg, gs, onGround] = POSE.map(([n]) => v.get(n))
    if (!Number.isFinite(lat)) return
    const p = { t, lat, lon, alt, hdg, gs, onGround }
    samples.push(p)
    while (samples[0].t < t - 5000) samples.shift()
    if (phase) {
      rec.data("pose", "", { phase, ...p })
      byPhase.get(phase)?.push(p)
    }
    if (follow) drive(t)
  },
})

const latest = () => samples[samples.length - 1] ?? null

await sleep(1500)
{
  const s = samples.filter((p) => p.t >= Date.now() - 1000)
  report.rate = s.length
  const p = latest()
  rec.log("avatar", p ? `${s.length} samples in the last second; ${fmt(p.lat)}, ${fmt(p.lon)}, heading ${Math.round(p.hdg)}°` : "no answer from SIMCONNECT_OBJECT_ID_USER_AVATAR", { rate: s.length, pose: p })
}

// Which of the figures the sim lists, and with which livery.
const listed = new Map()
for (const x of await sim.liveries({ type: 5 })) if (!listed.has(x.title)) listed.set(x.title, x.livery ?? "")
for (const f of FIGURES) {
  f.listed = listed.has(f.title)
  f.livery = listed.get(f.title) ?? ""
}
rec.log("titles", `${plural(listed.size, "ground vehicle title")}; not listed: ${FIGURES.filter((f) => !f.listed).map((f) => f.title).join(", ") || "none"}`, { count: listed.size })

// ------------------------------------------------ steps

async function ask(heading, instruction) {
  console.log(`\n▶ ${heading}\n  ${instruction}\n  ${START} to start, ${SKIP} to skip.`)
  const k = await keys.next()
  rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
  return k.key === "START"
}

const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

// The heading against the direction the avatar moved, once per 0.5m moved:
// near 0° when the heading is the way the body walks, near 180° walking backward.
function headingSummary(name, list) {
  let turned = 0
  for (let i = 1; i < list.length; i++) turned += Math.abs(turn(list[i - 1].hdg, list[i].hdg))
  const diffs = []
  let moved = 0
  let anchor = list[0]
  for (const p of list) {
    const d = distance(anchor.lat, anchor.lon, p.lat, p.lon)
    if (d < 0.5) continue
    moved += d
    diffs.push(turn(bearing(anchor, p), p.hdg))
    anchor = p
  }
  const abs = median(diffs.map(Math.abs))
  const hdgs = new Set(list.map((p) => Math.round(p.hdg)))
  return {
    name, n: list.length, turned, moved, distinct: hdgs.size, medianAbs: abs, diffs,
    text: `${name}: ${plural(list.length, "sample")}, ${plural(hdgs.size, "distinct heading")}, heading turned ${Math.round(turned)}° in all, moved ${moved.toFixed(1)}m${abs === null ? "" : `; heading minus direction of travel: median ${Math.round(abs)}° either way, over ${plural(diffs.length, "0.5m step")}`}`,
  }
}

async function timed(name, ms) {
  byPhase.set(name, [])
  phase = name
  beep(1000, 100)
  await sleep(ms)
  phase = null
  const s = headingSummary(name, byPhase.get(name))
  report.phases.push(s)
  rec.log("phase", s.text, { phase: name, turned: s.turned, moved: s.moved, medianAbs: s.medianAbs, distinct: s.distinct })
}

async function create(f, at, facing) {
  const init = new InitPosition()
  Object.assign(init, { latitude: at.lat, longitude: at.lon, altitude: at.alt, pitch: 0, bank: 0, heading: wrap(facing), onGround: true, airspeed: 0 })
  const r = await sim.spawn(f.title, f.livery ?? "", init, { legacy: Boolean(f.legacy) })
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

let stopping = false
process.on("SIGINT", async () => {
  if (stopping) process.exit(1)
  stopping = true
  rec.log("stop", "Ctrl+C: removing the figures and writing the report")
  follow = null
  removeAll()
  await finish()
  process.exit(0)
})

console.log([
  "",
  "Before you start:",
  "  - on foot beside the aircraft, with open ground around you",
  "  - about 2 minutes",
].join("\n"))

// heading -----------------------------------------

if (await ask("Heading", "On foot, press Page Down. At the first short beep look around with the camera without moving, at the second walk one full circle, at the third walk backward. Stop at the long low beep. About 20s.")) {
  await timed("look around, standing", 5000)
  await timed("one full circle", 10_000)
  await timed("backward", 4000)
  beep(500, 600)
  console.log("  Stop.")
}

// figures -----------------------------------------

const tried = FIGURES.filter((f) => f.listed || f.legacy)
if (latest() && await ask("People in front of you", `Stand still facing open ground, and press Page Down. At each short beep a person appears ${AHEAD_M}m in front of you for ${SHOW_MS / 1000}s. Press Page Down only when you see a person, not a prop. ${plural(tried.length, "figure")}, about ${Math.ceil(tried.length * (SHOW_MS + GAP_MS) / 1000)}s.`)) {
  const presses = []
  const unlisten = keys.listen((k) => {
    if (k.key !== "START") return
    presses.push(k.t)
    rec.log("press", "Page Down: a person seen")
  })
  for (const f of tried) {
    const p = latest()
    beep(1000, 100)
    const t0 = Date.now()
    const r = await create(f, offset(p, AHEAD_M, 0), p.hdg + 180)
    const out = { title: f.title, legacy: Boolean(f.legacy), id: r.id ?? null, error: r.error ?? null, seen: false, readBack: null }
    if (out.id !== null) {
      const v = await sim.read(POS, { object: out.id, label: `read back object ${out.id}` })
      const s = await sim.readStrings(["TITLE", "CATEGORY"], { object: out.id, label: `read back the names on object ${out.id}` })
      out.readBack = { title: s.get("TITLE") ?? null, category: s.get("CATEGORY") ?? null, error: v.error, found: Number.isFinite(v.get("PLANE LATITUDE")) }
    }
    await sleep(Math.max(0, t0 + SHOW_MS - Date.now()))
    out.seen = presses.some((t) => t >= t0 && t <= t0 + SHOW_MS + GAP_MS / 2)
    if (out.id !== null) { sim.remove(out.id); spawned.delete(out.id) }
    report.figures.push(out)
    rec.log("figure", out.id === null
      ? `${f.title}${f.legacy ? " (legacy call)" : ""}: not created: ${out.error}`
      : `${f.title}${f.legacy ? " (legacy call)" : ""}: object ${out.id}, ${out.readBack.category ?? "no category"}; ${out.seen ? "SEEN" : "not seen"}`, out)
    await sleep(GAP_MS)
  }
  unlisten()
  beep(500, 600)
}

// follow ------------------------------------------

function drive(now) {
  const q = poseAt(samples, now - DELAY_MS)
  if (!q) return
  const at = offset(q, AHEAD_M, 0)
  follow.writes++
  if (!follow.poseFailed) sim.set(POS, [at.lat, at.lon, q.alt, q.hdg], { object: follow.id, label: "figure pose", quiet: true })
  if (!follow.speedFailed) sim.set([["VELOCITY BODY Z", "feet per second"]], [(q.gs ?? 0) * KNOTS_TO_FPS], { object: follow.id, label: "figure speed", quiet: true })
}

const seen = report.figures.find((f) => f.seen)
if (!seen) {
  rec.log("follow", "skipped: no person was seen")
} else if (await ask("A person in front of you", `Press Page Down, then walk and turn for ${FOLLOW_MS / 1000}s: ${seen.title} stays ${AHEAD_M}m in front of you, facing the way you face. It goes at the long low beep.`)) {
  const f = FIGURES.find((x) => x.title === seen.title)
  const p = latest()
  const r = await create(f, offset(p, AHEAD_M, 0), p.hdg)
  if (r.id === undefined) {
    rec.log("follow", `${f.title}: not created: ${r.error}`)
  } else {
    follow = { id: r.id, title: f.title, writes: 0, poseFailed: false, speedFailed: false, exceptions: [] }
    const unwatch = rec.onRecord((x) => {
      if (x.kind !== "exception" || !follow) return
      if (x.sent === "figure pose") follow.poseFailed = true
      if (x.sent === "figure speed") follow.speedFailed = true
      follow.exceptions.push(x.text)
    })
    beep(1000, 100)
    await sleep(FOLLOW_MS)
    const done = follow
    follow = null
    unwatch()
    sim.remove(done.id)
    spawned.delete(done.id)
    beep(500, 600)
    report.follow = done
    rec.log("follow", `${done.title} as object ${done.id}: ${plural(done.writes, "frame")} written${done.poseFailed ? ", pose writes failed" : ""}${done.speedFailed ? ", speed writes failed" : ""}`, done)
    console.log("  Tell Claude how it moved: walked or slid, kept up, turned with you, stayed on the ground.")
  }
}

await finish()
process.exit(0)

// ---------------------------------------------------------------- report

async function finish() {
  removeAll()
  const lines = [
    "p02 · A GSX person in the avatar's place, and the avatar's heading, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    `Running: ${running}`,
    `Avatar: ${report.rate ?? 0} samples a second through SIMCONNECT_OBJECT_ID_USER_AVATAR`,
    "",
    "Heading:",
    ...(report.phases.length ? report.phases.map((s) => `  ${s.text}`) : ["  not run"]),
    "",
    "People put in front of you:",
    ...(report.figures.length
      ? report.figures.map((f) => `  ${f.title}${f.legacy ? " (legacy call)" : ""}: ${f.id === null ? `not created: ${f.error}` : `object ${f.id}, ${f.readBack.category ?? "no category"}${f.readBack.found ? "" : ", no position read back"}; ${f.seen ? "SEEN" : "not seen"}`}`)
      : ["  not run"]),
    "",
    `Following: ${report.follow ? `${report.follow.title}, ${plural(report.follow.writes, "frame")} written ${AHEAD_M}m ahead, ${DELAY_MS}ms late${report.follow.poseFailed ? "; pose writes failed" : ""}${report.follow.speedFailed ? "; speed writes failed" : ""}${report.follow.exceptions.length ? `; ${report.follow.exceptions.slice(0, 3).join("; ")}` : ""}` : "not run"}`,
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
