/*
 * p29: how far a pilot's own figure trails its avatar on foot, read from both objects every sim
 * frame during a session, so the lag gets a number instead of a look at screenshots.
 *
 *   node experiments/areas/avatars/p29-sim-session/own-figure-lag.mjs [--seconds 25]
 *
 * It waits for the avatar's first step, records for the given time, and prints the lag that best
 * lines the figure's path up with the avatar's, the distance between them, and how long the
 * figure takes to arrive after the avatar stops. It only reads.
 */

import { Recorder } from "../../aircraft/lib/out.mjs"
import { Sim } from "../../aircraft/lib/sim.mjs"

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : fallback }
const SECONDS = arg("--seconds", 25)
const USER_AVATAR = 0xffffffff - 128 + 1
const METERS_PER_DEGREE = 111_195
const PLACE = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"]]

const rec = new Recorder("p29-own-figure-lag", { area: "avatars" })
rec.open()
const sim = await Sim.connect(rec, { name: "DUALINPUT p29 own figure lag" })

const figures = []
for (const id of await sim.byType(1, 200, { timeoutMs: 3000 })) {
  const title = await sim.readStrings(["TITLE"], { object: id }).catch(() => null)
  if (String(title?.get?.("TITLE") ?? "").includes("DUALINPUT_FIGURE")) figures.push(id)
}
rec.log("figures", `figures within 200m: ${figures.join(", ") || "none"}`, { figures })
if (figures.length === 0) process.exit(1)

const avatar = []
const paths = new Map(figures.map((id) => [id, []]))
// The avatar's speed too: a lead by speed stops overshooting at a stop only if the speed falls a
// frame before the position stops changing.
const SPEEDS = [["GROUND VELOCITY", "meters per second"], ["VELOCITY BODY Z", "meters per second"], ["VELOCITY WORLD X", "meters per second"], ["VELOCITY WORLD Z", "meters per second"]]
const watch = (object, vars, into, label) => sim.watch(vars, {
  period: "frame",
  changed: false,
  object,
  label,
  onData: (got, t) => into.push({ t, lat: got.get("PLANE LATITUDE"), lon: got.get("PLANE LONGITUDE"), speeds: SPEEDS.map(([name]) => got.get(name)) }),
})
const watches = [watch(USER_AVATAR, [...PLACE, ...SPEEDS], avatar, "avatar"), ...figures.map((id) => watch(id, PLACE, paths.get(id), `figure ${id}`))]

const origin = await new Promise((resolve) => { const wait = setInterval(() => { if (avatar.length) { clearInterval(wait); resolve(avatar[0]) } }, 50) })
const cosLat = Math.cos(origin.lat * Math.PI / 180)
const xy = (p) => [(p.lon - origin.lon) * cosLat * METERS_PER_DEGREE, (p.lat - origin.lat) * METERS_PER_DEGREE]
const between = (a, b) => { const [ax, ay] = xy(a), [bx, by] = xy(b); return Math.hypot(ax - bx, ay - by) }

rec.log("waiting", "waiting for the avatar's first step")
const firstStepBy = Date.now() + 8 * 60_000
let started = null
while (started === null) {
  await new Promise((r) => setTimeout(r, 50))
  const last = avatar.at(-1)
  const before = avatar.at(-11)
  if (before && between(last, before) / Math.max((last.t - before.t) / 1000, 0.001) > 0.3) started = before.t
  if (Date.now() > firstStepBy) { rec.log("nothing", "no step in 8 minutes"); process.exit(1) }
  avatar.splice(0, Math.max(0, avatar.length - 40))
  for (const path of paths.values()) path.splice(0, Math.max(0, path.length - 40))
}
rec.log("recording", `first step: recording for ${SECONDS}s`)
await new Promise((r) => setTimeout(r, SECONDS * 1000))
for (const w of watches) w.stop()

const after = (list) => list.filter((p) => p.t >= started)
const av = after(avatar)
const own = [...paths.entries()]
  .map(([id, path]) => { const list = after(path); return { id, list, mean: list.reduce((sum, p, i) => sum + between(p, av[Math.min(i, av.length - 1)]), 0) / Math.max(list.length, 1) } })
  .filter((f) => f.list.length > 0)
  .sort((a, b) => a.mean - b.mean)[0]

// The avatar's place at time t, between the two frames around it.
function avatarAt(t) {
  let i = 1
  while (i < av.length - 1 && av[i].t < t) i++
  const a = av[i - 1], b = av[i]
  const f = b.t === a.t ? 0 : Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)))
  return { t, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f }
}

const speeds = av.slice(1).map((p, i) => ({ t: p.t, speed: between(p, av[i]) / Math.max((p.t - av[i].t) / 1000, 0.001) }))
const moving = speeds.filter((s) => s.speed > 0.3)
const quantile = (list, q) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN }
const speedAt = (t) => speeds.reduce((best, s) => Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best, speeds[0]).speed

const samples = own.list.filter((p) => p.t > started + 1000)
let best = { lag: 0, rms: Infinity }
const curve = []
for (let lag = 0; lag <= 1000; lag += 10) {
  const rms = Math.sqrt(samples.reduce((sum, p) => sum + between(p, avatarAt(p.t - lag)) ** 2, 0) / samples.length)
  curve.push({ lag, rms })
  if (rms < best.rms) best = { lag, rms }
}

const gaps = samples.map((p) => ({ t: p.t, gap: between(p, avatarAt(p.t)), speed: speedAt(p.t) }))
const walkingGaps = gaps.filter((g) => g.speed > 0.3).map((g) => g.gap)
const stillGaps = gaps.filter((g) => g.speed < 0.02).map((g) => g.gap)

// After each stop, how long until the figure comes within 3cm of where the avatar stopped.
const stops = []
for (let i = 1; i < speeds.length - 15; i++) {
  if (speeds[i - 1].speed > 0.3 && speeds.slice(i, i + 15).every((s) => s.speed < 0.02)) {
    const at = speeds[i].t
    const end = avatarAt(at)
    const arrived = own.list.find((p) => p.t >= at && between(p, end) < 0.03)
    if (arrived) stops.push(arrived.t - at)
  }
}

const frames = av.length / Math.max((av.at(-1).t - av[0].t) / 1000, 0.001)
const line = (name, list, digits = 2) => `${name}: median ${quantile(list, 0.5).toFixed(digits)}, p95 ${quantile(list, 0.95).toFixed(digits)}, max ${Math.max(...list).toFixed(digits)}`
const report = [
  `object ${own.id}, the figure nearest the avatar; ${av.length} avatar frames at ${frames.toFixed(1)} per second`,
  line("avatar speed while moving, m/s", moving.map((s) => s.speed)),
  `the lag that best lines the two paths up: ${best.lag}ms, leaving ${(best.rms * 100).toFixed(1)}cm rms (with no lag: ${(curve[0].rms * 100).toFixed(1)}cm rms)`,
  line("gap while moving, m", walkingGaps),
  line("gap while still, m", stillGaps),
  stops.length ? `${stops.length} stops: the figure arrived within 3cm in ${line("ms", stops, 0)}` : "no clean stop to time",
]
rec.log("report", `\n${report.join("\n")}`, { report, best, curve, stops, avatar: av, figure: own.list })
rec.finish?.("done")
sim.close()
process.exit(0)
