/*
 * p02: whether a frozen Black Square Baron 58P, written each frame with a
 * recorded flight's pose, every velocity, and the engine levers, ends up with
 * the same airspeed, engine, and gauge readings as the flight it replays, on
 * MSFS 2024.
 *
 * p01 found that freezing holds the pose but not the velocities: frozen with
 * only the pose written, the parked Baron's forward speed climbed to 68 ft/s
 * in 4s and its propeller windmilled (record/areas/flight-model/log.md,
 * 2026-10-03). So a following machine writes every velocity. Two things are
 * unknown:
 *
 *   - whether writing every velocity each frame holds them where we write
 *     them, linear and rotational;
 *   - whether the Baron's own engine model, which integrates L:BKSQ_* values
 *     from the stock engine's outputs on each machine (read in
 *     bksq-aircraft-baronpro 0.1.1, model.base\BaronProfessional_Base_INT.xml),
 *     then tracks the flight it follows or drifts away.
 *
 * Two runs, on one machine:
 *
 *   --record   You fly a short circuit in the 58P, about 3 to 5 minutes: press
 *              Page Down where you start, fly, and press Page Down again
 *              once you've stopped on the ground. Every sim frame is recorded.
 *   --replay   Unattended, as long as the recording: start both engines and
 *              leave the aircraft parked, hands off, and press Page Down. The
 *              probe freezes the aircraft and writes each frame of the
 *              recording back, then compares what the aircraft reads with
 *              what the recording read at the same moment. Page Up stops early.
 *              With --pose-only it writes the pose and levers but no
 *              velocities, for comparison. --replay takes the newest
 *              recording, or a file named after it.
 *
 * Writes come from outside the sim, once per sim frame, so the aircraft
 * stutters on screen in flight (record/areas/avatars/log.md, 2026-10-03). The
 * values are what this probe measures, not how it looks.
 *
 * It fails open: the replay unfreezes when it ends, Ctrl+C and any crash
 * unfreeze on the way out, and from any terminal
 *
 *   node experiments/areas/flight-model/p01-frozen-baron.mjs --unfreeze
 *
 * clears the three freezes.
 *
 *   node experiments/areas/flight-model/p02-replay.mjs --record
 *   node experiments/areas/flight-model/p02-replay.mjs --replay [--pose-only] [file]
 *
 * Output: the recording, or each replayed frame, in
 * experiments/areas/flight-model/results/p02-replay-<mode>-<time>.ndjson, and the
 * report in the .txt beside it.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { REPO } from "../../tools/results.mjs"
import { Recorder, fmt, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { turn, wrap } from "../avatars/lib/pose.mjs"

const FREEZES = ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]

// Each group is written in its own call, because a write is positional and a
// name the sim refuses would shift every value after it.
const POSE = [
  ["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"],
  ["PLANE PITCH DEGREES", "degrees"], ["PLANE BANK DEGREES", "degrees"], ["PLANE HEADING DEGREES TRUE", "degrees"],
]
const BODY = [["VELOCITY BODY X", "feet per second"], ["VELOCITY BODY Y", "feet per second"], ["VELOCITY BODY Z", "feet per second"]]
const ROTATION = [["ROTATION VELOCITY BODY X", "radians per second"], ["ROTATION VELOCITY BODY Y", "radians per second"], ["ROTATION VELOCITY BODY Z", "radians per second"]]
// On the 58P the mixture lever drags L:BKSQ_MixtureLeverPosition_n and the
// XML writes the stock mixture from it at 2 Hz (read in bksq-aircraft-baronpro
// 0.1.1, model.base\BaronProfessional_Base_INT.xml), so the L: variable is the one to write.
const LEVERS = [
  ["GENERAL ENG THROTTLE LEVER POSITION:1", "percent"], ["GENERAL ENG THROTTLE LEVER POSITION:2", "percent"],
  ["GENERAL ENG PROPELLER LEVER POSITION:1", "percent"], ["GENERAL ENG PROPELLER LEVER POSITION:2", "percent"],
]
const MIXTURES = [["L:BKSQ_MixtureLeverPosition_1", "number"], ["L:BKSQ_MixtureLeverPosition_2", "number"]]

// What the follower should end up reading, compared against the recording.
const COMPARE = [
  ["AIRSPEED INDICATED", "knots"], ["VERTICAL SPEED", "feet per minute"],
  ["PROP RPM:1", "rpm"], ["PROP RPM:2", "rpm"],
  ["ENG MANIFOLD PRESSURE:1", "inHg"], ["ENG MANIFOLD PRESSURE:2", "inHg"],
  ["ENG FUEL FLOW GPH:1", "gallons per hour"], ["ENG FUEL FLOW GPH:2", "gallons per hour"],
  ["RECIP ENG CYLINDER HEAD TEMPERATURE:1", "celsius"], ["L:BKSQ_CHT_1", "number"], ["L:BKSQ_CHT_2", "number"],
]
const FLAGS = [["SIM ON GROUND", "bool"], ["ENG COMBUSTION:1", "bool"], ["ENG COMBUSTION:2", "bool"],
  ["IS LATITUDE LONGITUDE FREEZE ON", "bool"], ["IS ALTITUDE FREEZE ON", "bool"], ["IS ATTITUDE FREEZE ON", "bool"]]

const ALL = [...POSE, ...BODY, ...ROTATION, ...LEVERS, ...MIXTURES, ...COMPARE, ...FLAGS]
const ANGLES = new Set(["PLANE HEADING DEGREES TRUE"])
const RECORD_MAX_MS = 8 * 60_000

const mode = process.argv.includes("--record") ? "record" : process.argv.includes("--replay") ? "replay" : null
if (!mode) {
  console.log("Run with --record, then --replay [--pose-only] [file].")
  process.exit(1)
}
const poseOnly = process.argv.includes("--pose-only")

const rec = new Recorder(`p02-replay-${mode}${poseOnly ? "-pose-only" : ""}`, { area: "flight-model" })
const sim = await Sim.connect(rec, { name: `CROSSCHECK p02-replay ${mode}` })
rec.open()
const keys = await startKeys()
const beep = startBeeper()
const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
rec.log("aircraft", `TITLE ${JSON.stringify(title)}`)

let frozen = false
function freeze(on) {
  for (const e of FREEZES) sim.transmit(e, [on ? 1 : 0], { quiet: true })
  frozen = on
  rec.log(on ? "freeze" : "unfreeze", on ? "position, altitude, and attitude frozen" : "freezes cleared")
}
process.on("exit", () => {
  if (!frozen || sim.gone) return
  try { for (const e of FREEZES) sim.transmit(e, [0], { quiet: true }) } catch { /* the connection is gone */ }
})
process.on("uncaughtException", (e) => {
  rec.log("error", e.stack ?? String(e))
  process.exit(1)
})

let onFrame = null
const w = sim.watch(ALL, { period: "frame", changed: false, label: "frame", onData: (v, t) => onFrame?.(Object.fromEntries(v), t) })

let stopping = false
async function done(lines) {
  if (stopping) return
  stopping = true
  onFrame = null
  if (frozen) freeze(false)
  await sleep(300)
  w.stop()
  const text = [
    `p02 · Replaying a recorded flight into a frozen Baron 58P, ${mode}${poseOnly ? ", pose and levers only" : ""}, on MSFS 2024`,
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    `Aircraft: TITLE ${JSON.stringify(title)}`,
    "",
    ...lines,
  ].join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
}
process.on("SIGINT", async () => {
  rec.log("stop", "Ctrl+C")
  await done(["Stopped with Ctrl+C."])
  process.exit(0)
})

if (mode === "record") await record()
else await replay()
process.exit(0)

// ---------------------------------------------------------------- record

async function record() {
  console.log(`\n▶ Record\n  Sit where you'll start, engines running, and press ${START}. Fly a short circuit, about 3 to 5 minutes, and once you've stopped on the ground press ${START} again. ${SKIP} also stops.`)
  const k = await keys.next()
  if (k.key !== "START") return done(["Skipped."])
  let n = 0
  let t0 = null
  onFrame = (read, t) => {
    t0 ??= t
    n++
    rec.data("sample", "", { ms: t - t0, read })
  }
  beep(1000, 100)
  rec.log("record", "recording")
  const stop = await Promise.race([keys.next(), sleep(RECORD_MAX_MS).then(() => ({ key: "TIMEOUT" }))])
  onFrame = null
  beep(500, 600)
  rec.log("record", `stopped by ${stop.key}`)
  await done([`Recorded ${n} frames over ${((Date.now() - (t0 ?? Date.now())) / 1000).toFixed(0)}s.`, `Replay it with: node experiments/areas/flight-model/p02-replay.mjs --replay`])
}

// ---------------------------------------------------------------- replay

function newestRecording() {
  const dir = join(REPO, "experiments", "areas", "flight-model", "results")
  // Recordings are committed gzipped, because they run to tens of megabytes.
  const files = readdirSync(dir).filter((f) => /^p02-replay-record-.*\.ndjson(\.gz)?$/.test(f)).sort()
  if (!files.length) throw new Error("no recording yet: run with --record first")
  return join(dir, files[files.length - 1])
}

// The recorded values at ms after the start, mixed between the two frames
// around it, with headings turned the short way.
function sampler(samples) {
  let i = 0
  return (ms) => {
    if (ms <= samples[0].ms) return samples[0].read
    while (i < samples.length - 2 && samples[i + 1].ms < ms) i++
    const a = samples[i]
    const b = samples[i + 1]
    if (!b || ms >= b.ms) return (b ?? a).read
    const f = (ms - a.ms) / (b.ms - a.ms)
    const out = {}
    for (const k of Object.keys(b.read)) {
      const x = a.read[k], y = b.read[k]
      if (typeof x !== "number" || typeof y !== "number") out[k] = y
      else out[k] = ANGLES.has(k) ? wrap(x + turn(x, y) * f) : x + (y - x) * f
    }
    return out
  }
}

async function replay() {
  const file = process.argv.slice(2).find((a) => /\.ndjson(\.gz)?$/.test(a)) ?? newestRecording()
  const raw = file.endsWith(".gz") ? gunzipSync(readFileSync(file)).toString("utf8") : readFileSync(file, "utf8")
  const samples = raw.trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.kind === "sample")
  if (samples.length < 10) throw new Error(`${file} has only ${samples.length} samples`)
  const lengthMs = samples[samples.length - 1].ms
  rec.log("recording", `${file.replace(/\\/g, "/").replace(REPO.replace(/\\/g, "/") + "/", "")}: ${samples.length} frames over ${(lengthMs / 1000).toFixed(0)}s`)
  const at = sampler(samples)

  console.log(`\n▶ Replay${poseOnly ? ", pose and levers only" : ""}\n  Start both engines, leave the aircraft parked, take your hands off the controls, and press ${START}. It runs ${(lengthMs / 1000).toFixed(0)}s on its own; ${SKIP} stops early.`)
  const k = await keys.next()
  if (k.key !== "START") return done(["Skipped."])

  const frames = []
  let t0 = null
  let stopEarly = false
  const unlisten = keys.listen((x) => { if (x.key === "SKIP") stopEarly = true })
  freeze(true)
  beep(1000, 100)
  onFrame = (read, t) => {
    t0 ??= t
    const ms = t - t0
    const want = at(ms)
    sim.set(POSE, POSE.map(([n]) => want[n]), { label: "write pose", quiet: true })
    if (!poseOnly) {
      sim.set(BODY, BODY.map(([n]) => want[n]), { label: "write body velocity", quiet: true })
      sim.set(ROTATION, ROTATION.map(([n]) => want[n]), { label: "write rotation velocity", quiet: true })
    }
    sim.set(LEVERS, LEVERS.map(([n]) => want[n]), { label: "write levers", quiet: true })
    sim.set(MIXTURES, MIXTURES.map(([n]) => want[n]), { label: "write mixtures", quiet: true })
    // The read that arrives with this frame shows the last frame's write, so
    // it's compared against the recording at the last frame's time.
    const prev = frames[frames.length - 1]
    frames.push({ ms, read, want, wantPrev: prev ? prev.want : null })
    rec.data("frame", "", { ms, read, want })
  }
  while (!stopEarly && (t0 === null || Date.now() - t0 < lengthMs)) await sleep(100)
  onFrame = null
  unlisten()
  // Hold the last pose a moment before letting go, so the release starts from
  // where the recording ended.
  await sleep(200)
  freeze(false)
  beep(500, 600)
  await done(compare(frames, stopEarly))
}

function compare(frames, stoppedEarly) {
  const scored = frames.filter((f) => f.wantPrev)
  const lines = [`${scored.length} frames compared${stoppedEarly ? ", stopped early" : ""}; each read is compared with the recording at the moment its frame was written.`, ""]
  const names = [...(poseOnly ? [] : [...BODY, ...ROTATION]), ...COMPARE].map(([n]) => n)
  const fifth = Math.max(1, Math.floor(scored.length / 5))
  lines.push("Variable: mean and largest difference from the recording; mean difference in the first and last fifth")
  for (const n of names) {
    const d = scored.map((f) => Math.abs(f.read[n] - f.wantPrev[n])).filter(Number.isFinite)
    if (!d.length) { lines.push(`  ${n}: no readings`); continue }
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
    const first = d.slice(0, fifth), last = d.slice(-fifth)
    const range = scored.map((f) => f.wantPrev[n]).filter(Number.isFinite)
    lines.push(`  ${n}: mean ${fmt(mean(d))}, largest ${fmt(Math.max(...d))}; first fifth ${fmt(mean(first))}, last fifth ${fmt(mean(last))} (recording ranged ${fmt(Math.min(...range))}..${fmt(Math.max(...range))})`)
  }
  const flags = (n) => [...new Set(scored.map((f) => f.read[n]))].map(fmt).join("/")
  lines.push("", `Flags while replaying: ${FLAGS.map(([n]) => `${n} ${flags(n)}`).join(", ")}`)
  const exceptions = rec.timeline.filter((e) => e.kind === "exception").map((e) => e.text)
  const counted = new Map()
  for (const e of exceptions) counted.set(e, (counted.get(e) ?? 0) + 1)
  lines.push("", `Exceptions: ${exceptions.length ? "" : "none"}`)
  for (const [e, n] of counted) lines.push(`  ${n} × ${e}`)
  return lines
}
