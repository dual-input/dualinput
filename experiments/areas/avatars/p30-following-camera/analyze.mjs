/*
 * p30's report: for each phase of run.ts's flight, how far each reading of the camera sits from the seat's eye, against
 * the aircraft's travel over one frame, so the reading `Follow`'s writes don't shift stands out.
 *
 *   node experiments/areas/avatars/p30-following-camera/analyze.mjs <p30 ndjson> [<p30 module csv>]
 *
 * The seat's eye is each reading's own median in phase 1, following on the stand, where nothing moves. An offset is
 * the reading less that, in the aircraft's frame, x left, y up, z forward, in meters. A reading the writes don't shift
 * stays within a few centimeters of it in every phase; one they shift sits a frame's travel behind it.
 */

import fs from "node:fs"

const [ndjson, csv] = process.argv.slice(2)
if (!ndjson) throw new Error("usage: node analyze.mjs <p30 ndjson> [<p30 module csv>]")

const FT = 0.3048
const PHASES = {
  1: "following, still, on the stand",
  2: "climbing straight up at 91 m/s",
  3: "level, still, 3,000 ft up",
  4: "level at 40 m/s",
  5: "level at 85 m/s",
  6: "level at 130 m/s",
  7: "turning right at 85 m/s, banked 25 degrees",
  8: "climbing at 85 m/s, nose up 8 degrees",
  9: "level at 85 m/s",
  10: "level at 85 m/s, ChasePlane off",
}
const REFS = { 1: "SIMOBJECT", 2: "WORLD", 3: "EYEPOINT", 4: "SIMOBJECT_DATUM" }

// WGS 84, as src/engines/aircraft-model/src/frame.rs turns a point into the aircraft's frame.
const EQUATOR_M = 6_378_137.0
const FLATTENING = 1 / 298.257223563
const rad = (d) => (d * Math.PI) / 180
function radii(latitude) {
  const e2 = FLATTENING * (2 - FLATTENING)
  const s = Math.sin(rad(latitude))
  const w = Math.sqrt(1 - e2 * s * s)
  return [(EQUATOR_M * (1 - e2)) / (w * w * w), EQUATOR_M / w]
}
/** A point in latitude and longitude in degrees and altitude in feet, in the frame of `a`, an aircraft's pose in degrees and feet. */
function worldToFrame(a, lat, lon, altFt) {
  const [meridian, normal] = radii(a.lat)
  const v = [rad(lat - a.lat) * meridian, rad(lon - a.lon) * normal * Math.cos(rad(a.lat)), -(altFt - a.alt) * FT]
  const [ps, th, ph] = [rad(a.heading), -rad(a.pitch), -rad(a.bank)]
  const [cps, sps, cth, sth, cph, sph] = [Math.cos(ps), Math.sin(ps), Math.cos(th), Math.sin(th), Math.cos(ph), Math.sin(ph)]
  const r = [
    [cth * cps, sph * sth * cps - cph * sps, cph * sth * cps + sph * sps],
    [cth * sps, sph * sth * sps + cph * cps, cph * sth * sps - sph * cps],
    [-sth, sph * cth, cph * cth],
  ]
  const b = [0, 1, 2].map((j) => r[0][j] * v[0] + r[1][j] * v[1] + r[2][j] * v[2])
  return [-b[1], -b[2], b[0]]
}

const pct = (values, p) => {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN
}
const median = (values) => pct(values, 0.5)
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "  - ")
const pad = (s, n) => String(s).padEnd(n)
const lines = []
const say = (line = "") => lines.push(line)

/** For each phase, the offset of each row's point from the phase-1 median of the same reading, along z and in all. */
function table(title, readings, expected) {
  say(title)
  say("  Each line: the median offset along z, forward positive, its p10 and p90, and the median distance from the phase-1 point.")
  const rest = readings.map((r) => {
    const still = r.rows.filter((row) => row.phase === 1)
    return [0, 1, 2].map((k) => median(still.map((row) => row.p[k])))
  })
  for (const phase of Object.keys(PHASES).map(Number)) {
    const cells = readings.flatMap((r, i) => {
      const rows = r.rows.filter((row) => row.phase === phase)
      if (!rows.length) return []
      const dz = rows.map((row) => row.p[2] - rest[i][2])
      const d = rows.map((row) => Math.hypot(...[0, 1, 2].map((k) => row.p[k] - rest[i][k])))
      return [`    ${pad(r.name, 24)} z ${f2(median(dz))}m (p10 ${f2(pct(dz, 0.1))}, p90 ${f2(pct(dz, 0.9))}), ${f2(median(d))}m away, over ${rows.length} reads`]
    })
    if (!cells.length) continue
    const travel = expected(phase)
    say(`  Phase ${phase}, ${PHASES[phase]}: one frame's travel ${Number.isFinite(travel) ? `${travel.toFixed(2)}m` : "unknown"}`)
    for (const cell of cells) say(cell)
  }
  say()
}

// ---------------------------------------------------------------- outside the sim

const records = fs.readFileSync(ndjson, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
const status = records.find((r) => r.k === "status")
say(`p30, ${ndjson.split(/[\\/]/).at(-1)}`)
say(`The camera's status at the start: ${status ? ["not acquired", "acquired", "acquired by another client, such as ChasePlane", "disabled by the user"][status.acquired] : "not read"}.`)
const exceptions = records.filter((r) => r.k === "exception")
if (exceptions.length) say(`SimConnect raised ${exceptions.length} exceptions, the first ${exceptions[0].name}.`)
say()

// Each pose read, and each camera answer with the poses around it in the order they arrived.
const poses = []
const outside = { 1: [], 2: [], 3: [], 4: [] }
const frames = []
let lastFps = NaN
for (const r of records) {
  if (r.k === "frame") {
    lastFps = r.fps
    frames.push(r)
  } else if (r.k === "pose") {
    const [lat, lon, alt, heading, pitch, bank, vx, vy, vz, frozen] = r.v
    poses.push({ n: r.n, t: r.t, phase: r.phase, lat, lon, alt, heading, pitch, bank, v: [vx * FT, vy * FT, vz * FT], frozen })
  } else if (r.k === "cam" && outside[r.ref]) {
    outside[r.ref].push({ n: r.n, t: r.t, phase: r.phase, fps: lastFps, raw: [r.x, r.y, r.z], poseBefore: poses.length - 1 })
  }
}
const travelOutside = (phase) => {
  const rows = poses.filter((p) => p.phase === phase)
  const fps = frames.filter((f) => f.phase === phase).map((f) => f.fps)
  return median(rows.map((p) => Math.hypot(...p.v))) / median(fps)
}
const asPoint = (rows) => rows.map((row) => ({ phase: row.phase, p: row.raw }))
const world = (shift) =>
  outside[2].flatMap((row) => {
    const pose = poses[row.poseBefore + shift]
    return pose ? [{ phase: row.phase, p: worldToFrame(pose, row.raw[0], row.raw[1], row.raw[2] / FT) }] : []
  })
say(`From outside the sim, as the core reads it: ${outside[1].length} SIMOBJECT answers, ${poses.length} poses, and ${frames.length} Frame events.`)
table(
  "SimConnect_CameraGet's referentials, and WORLD turned into the aircraft's frame through a pose read beside it:",
  [
    { name: "SIMOBJECT", rows: asPoint(outside[1]) },
    { name: "EYEPOINT", rows: asPoint(outside[3]) },
    { name: "SIMOBJECT_DATUM", rows: asPoint(outside[4]) },
    { name: "WORLD, last pose", rows: world(0) },
    { name: "WORLD, pose before", rows: world(-1) },
    { name: "WORLD, next pose", rows: world(1) },
  ],
  travelOutside,
)

// ---------------------------------------------------------------- inside our module

if (csv && fs.existsSync(csv) && fs.statSync(csv).size > 0) {
  const rows = fs
    .readFileSync(csv, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split(",").map((v) => (v === "" ? NaN : Number(v))))
  const side = (cols) => ({
    cams: [0, 1, 2, 3].map((i) => cols.slice(i * 6, i * 6 + 3)),
    pose: { lat: cols[24], lon: cols[25], alt: cols[26], heading: cols[27], pitch: cols[28], bank: cols[29] },
    frozen: cols[30],
  })
  const frame = rows.map((c) => ({ clock: c[0], phase: c[1], before: side(c.slice(2, 33)), after: side(c.slice(33, 64)) }))
  const dt = frame.map((f, i) => (i > 0 ? (f.clock - frame[i - 1].clock) / 1e6 : NaN))
  const travelInside = (phase) =>
    median(
      frame.flatMap((f, i) => {
        if (f.phase !== phase || i === 0 || frame[i - 1].phase !== phase) return []
        const p = worldToFrame(f.after.pose, frame[i - 1].after.pose.lat, frame[i - 1].after.pose.lon, frame[i - 1].after.pose.alt)
        return [Math.hypot(...p)]
      }),
    )
  say(`Inside our module, ${frame.length} frames, ${median(dt.filter((d) => d > 0)) * 1000} ms each at the median.`)
  const moved = frame.map((f) => Math.hypot(...worldToFrame(f.after.pose, f.before.pose.lat, f.before.pose.lon, f.before.pose.alt)))
  say(`Between the pose read before the routine host's frame and the one after it, the aircraft moved ${f2(median(moved.filter((_, i) => frame[i].phase === 5)))}m at the median in phase 5, so a read after Follow's write ${median(moved.filter((_, i) => frame[i].phase === 5)) > 0.05 ? "gives" : "doesn't give"} the pose it wrote.`)
  const at = (which, ref) => frame.map((f) => ({ phase: f.phase, p: f[which].cams[ref - 1] }))
  const worldIn = (cam, pose) => frame.map((f) => ({ phase: f.phase, p: worldToFrame(f[pose].pose, f[cam].cams[1][0], f[cam].cams[1][1], f[cam].cams[1][2] / FT) }))
  table(
    "fsCameraGet in each referential, before and after the routine host's frame, and WORLD through the pose before or after:",
    [
      { name: "SIMOBJECT before", rows: at("before", 1) },
      { name: "SIMOBJECT after", rows: at("after", 1) },
      { name: "EYEPOINT before", rows: at("before", 3) },
      { name: "EYEPOINT after", rows: at("after", 3) },
      { name: "DATUM before", rows: at("before", 4) },
      { name: "DATUM after", rows: at("after", 4) },
      { name: "WORLD bef., pose bef.", rows: worldIn("before", "before") },
      { name: "WORLD bef., pose aft.", rows: worldIn("before", "after") },
    ],
    travelInside,
  )
} else {
  say("No lines from inside our module, so the run had no camera-in-module.patch, or the sim wrote no file.")
}

console.log(lines.join("\n"))
