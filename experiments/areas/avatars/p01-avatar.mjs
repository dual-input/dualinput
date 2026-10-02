/*
 * p01: whether Crosscheck can show one pilot's avatar on the other pilot's
 * machine with multiplayer off, by reading where the avatar is and moving a
 * figure to match, on MSFS 2024.
 *
 * Reading: the SDK gives the avatar its own object, SIMCONNECT_OBJECT_ID_USER_AVATAR
 * (MSFS 2024 SDK, SimConnect.h). On the DevSupport forum an Asobo developer
 * wrote that "index 2" on PLANE LATITUDE, LONGITUDE, and ALTITUDE gives the
 * avatar's position, and another developer got UNRECOGNIZED_ID reading object 2
 * (devsupport.flightsimulator.com/t/10684, 2026-07-21 and 2025-01-08). "Index 2"
 * could mean object 2 or the variable index PLANE LATITUDE:2, so the probe
 * reads both, and every other way of addressing the avatar we know of, and
 * shows which of them follow you as you walk.
 *
 * Showing: MSFS 2024's people are CharacterSim objects, and developers who
 * spawned one through SimConnect got an object nobody could see
 * (devsupport.flightsimulator.com/t/11769, 2024; t/18104, 2026). Nobody in our
 * records has tried. The probe spawns each person-like object it finds in
 * front of you, one at a time, and you say which you see. Then the first one
 * you saw follows you, frozen and written every sim frame, as our FS Copilot
 * fork drove injected traffic (FS Copilot fork,
 * record/traffic-atc/docs/01-design.md, Driving).
 *
 * One machine, with you walking the avatar. About 3 minutes, in five steps:
 *
 *   seated    Unattended, before you get out: which ways of addressing the
 *             avatar answer while you're in the cockpit, and which of the
 *             objects nearby and the titles the sim lists look like people.
 *   on foot   Get out and press Page Down. Walk at the first beep, run at the
 *             second, crouch at the third, and stand still facing open ground
 *             at the long low beep, about 15s.
 *   figures   Press Page Down, and each short beep puts a figure 4m in front of
 *             you for 4s. Press Page Down each time you see one.
 *   follow    Press Page Down and walk around for 30s, looking back: the first
 *             figure you saw walks your path 1s behind you and 2m to your right.
 *   back      Back in your seat, press Page Down, then look left and then right
 *             until the long low beep, 6s: whether the avatar's object goes,
 *             and whether the camera's direction reads.
 *
 * Nothing touches the pilot's input. Each figure goes with AIRemoveObject at
 * the end of its step and on Ctrl+C, and the sim removes a client's AI objects
 * when the client disconnects, so a crashed probe leaves none behind (measured
 * on MSFS 2024, 2026-09-06, FS Copilot fork, record/traffic-atc/docs/build/log.md,
 * "2026-09-06 · Stage 0 capture read; TrafficInject built and smoke-tested —
 * Q01, Q08 settled").
 *
 *   node experiments/areas/avatars/p01-avatar.mjs
 *
 * Output: one line per step on the console, every sample in
 * experiments/areas/avatars/results/p01-avatar-<time>.ndjson, and the report in
 * the .txt beside it.
 */

import { spawn } from "node:child_process"
import { createInterface } from "node:readline"

import { InitPosition } from "node-simconnect"

import { distance } from "../aircraft/lib/flights.mjs"
import { Recorder, fmt, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"

// MSFS 2024 SDK, SimConnect.h: SIMCONNECT_OBJECT_ID_MAX is DWORD_MAX - 128, and
// the avatar's and the current object's proxy IDs are the two after it.
const OBJECT_ID_MAX = 0xffffffff - 128
const USER = 0
const USER_AVATAR = OBJECT_ID_MAX + 1
const USER_CURRENT = OBJECT_ID_MAX + 2

// SIMCONNECT_SIMOBJECT_TYPE, in the same header.
const TYPES = { 1: "ALL", 2: "AIRCRAFT", 3: "HELICOPTER", 4: "BOAT", 5: "GROUND", 6: "HOT_AIR_BALLOON", 7: "ANIMAL", 8: "USER_AVATAR", 9: "USER_CURRENT" }

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]

// The last six are documented for human objects (MSFS 2024 SDK, Simulation
// Variables, Miscellaneous Variables: Humans and General Misc.).
const POSE = [
  ...POS,
  ["PLANE ALT ABOVE GROUND", "feet"], ["PLANE PITCH DEGREES", "degrees"], ["PLANE BANK DEGREES", "degrees"],
  ["GROUND VELOCITY", "knots"], ["VELOCITY BODY Z", "feet per second"], ["SIM ON GROUND", "bool"],
  ["IS CROUCH", "bool"], ["IS TALKING", "bool"], ["GENDER", "number"], ["HEIGHT", "number"],
  ["HAND ANIM STATE", "number"], ["ANIMATION DELTA TIME", "seconds"],
]
const NAMES = ["TITLE", "CATEGORY", "IDLE ANIMATION ID"]

// IS AVATAR and IS AIRCRAFT are environment variables, which SimConnect reads
// without the E: prefix (devsupport.flightsimulator.com/t/6673, 2024-03-05).
// CAMERA GAMEPLAY PITCH YAW gives the pitch at index 0 and the yaw at index 1
// (MSFS 2024 SDK, Camera Variables).
const GLOBALS = [
  ["IS AVATAR", "bool"], ["IS AIRCRAFT", "bool"], ["CAMERA STATE", "number"], ["CAMERA SUBSTATE", "number"],
  ["CAMERA GAMEPLAY PITCH YAW:0", "radians"], ["CAMERA GAMEPLAY PITCH YAW:1", "radians"],
]

const SHOW_MS = 4000
const FOLLOW_MS = 30_000
const DELAY_MS = 1000
const AHEAD_M = 4
const RIGHT_M = 2
const NEARBY_M = 300
const MAX_FIGURES = 8
const KNOTS_TO_FPS = 1.68781

const HUMAN = /character|human|people|person|pilot|crew|passenger|marshal|walker|worker|staff|avatar|pedestrian/i
// The title format one developer reported, "e.g. CharacterSim_Female_Slim"
// (devsupport.flightsimulator.com/t/11769). Tried only when the sim lists no
// person-like title of its own.
const FORUM_TITLE = "CharacterSim_Female_Slim"

// ---------------------------------------------------------------- keys and beeps

// From p01-mask (experiments/areas/flight-controls/p01-mask.mjs), with
// listeners added, so the figures step can count presses without waiting.
const encode = (ps) => Buffer.from(ps, "utf16le").toString("base64")
const powershell = (ps, stdio) =>
  spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encode(ps)], { stdio })

const KEYS_PS = `
$ProgressPreference = "SilentlyContinue"
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class CrosscheckKeys {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
[Console]::Out.WriteLine("READY")
$keys = @{ 0x22 = "PGDN"; 0x23 = "END" }
$was = @{ 0x22 = $false; 0x23 = $false }
while ($true) {
  foreach ($k in @(0x22, 0x23)) {
    $now = ([CrosscheckKeys]::GetAsyncKeyState($k) -band 0x8000) -ne 0
    if ($now -and -not $was[$k]) {
      $procId = 0
      [void][CrosscheckKeys]::GetWindowThreadProcessId([CrosscheckKeys]::GetForegroundWindow(), [ref]$procId)
      $name = "?"
      try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
      [Console]::Out.WriteLine("KEY " + $keys[$k] + " " + $name)
    }
    $was[$k] = $now
  }
  Start-Sleep -Milliseconds 20
}`

const BEEP_PS = `
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Split(" ")
  [Console]::Beep([int]$p[0], [int]$p[1])
}`

function startKeys() {
  const ps = powershell(KEYS_PS, ["ignore", "pipe", "ignore"])
  process.on("exit", () => { try { ps.kill() } catch { /* gone */ } })
  let waiter = null
  const listeners = new Set()
  const out = createInterface({ input: ps.stdout })
  return new Promise((ready, fail) => {
    ps.on("error", fail)
    out.on("line", (l) => {
      if (l === "READY") {
        return ready({
          next: () => new Promise((r) => { waiter = r }),
          listen: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
        })
      }
      if (!l.startsWith("KEY ")) return
      const [, key, ...fg] = l.split(" ")
      const k = { key, foreground: fg.join(" "), t: Date.now() }
      for (const fn of listeners) fn(k)
      // A press while nobody waits is dropped, so a stray key can't start a step.
      if (waiter) { const w = waiter; waiter = null; w(k) }
    })
  })
}

function startBeeper() {
  const ps = powershell(BEEP_PS, ["pipe", "ignore", "ignore"])
  process.on("exit", () => { try { ps.kill() } catch { /* gone */ } })
  return (hz, ms) => { try { ps.stdin.write(`${hz} ${ms}\n`) } catch { /* no sound is no failure */ } }
}

// ---------------------------------------------------------------- geometry

const RAD = Math.PI / 180
const EARTH_M = 6_371_000
const wrap = (deg) => ((deg % 360) + 360) % 360
const turn = (from, to) => ((to - from + 540) % 360) - 180

// A point aheadM along the heading and rightM to its right.
function offset(p, aheadM, rightM) {
  const h = p.hdg * RAD
  const north = aheadM * Math.cos(h) - rightM * Math.sin(h)
  const east = aheadM * Math.sin(h) + rightM * Math.cos(h)
  return {
    ...p,
    lat: p.lat + (north / EARTH_M) / RAD,
    lon: p.lon + (east / (EARTH_M * Math.cos(p.lat * RAD))) / RAD,
  }
}

// The pose at time t, between the two samples around it.
function poseAt(samples, t) {
  for (let i = samples.length - 1; i > 0; i--) {
    const a = samples[i - 1]
    const b = samples[i]
    if (a.t > t || b.t < t) continue
    const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t)
    const mix = (x, y) => x + (y - x) * f
    return { t, lat: mix(a.lat, b.lat), lon: mix(a.lon, b.lon), alt: mix(a.alt, b.alt), hdg: wrap(a.hdg + turn(a.hdg, b.hdg) * f), fps: mix(a.fps, b.fps) }
  }
  return null
}

// ---------------------------------------------------------------- the probe

const rec = new Recorder("p01-avatar", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p01-avatar" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()

const report = {
  locations: [],
  types: [],
  nearby: [],
  phases: [],
  chosen: null,
  figures: [],
  follow: null,
  camera: null,
  addRemove: new Map(),
}

// ------------------------------------------------ objects coming and going

const ADDED = 70
const REMOVED = 71
sim.send("subscribe ObjectAdded", () => sim.handle.subscribeToSystemEvent(ADDED, "ObjectAdded"))
sim.send("subscribe ObjectRemoved", () => sim.handle.subscribeToSystemEvent(REMOVED, "ObjectRemoved"))
const spawned = new Set()
sim.handle.on("eventAddRemove", (e) => {
  const what = e.clientEventId === ADDED ? "added" : "removed"
  const type = TYPES[e.type] ?? `type ${e.type}`
  const ours = spawned.has(e.data)
  const key = `${what} ${type}${ours ? ", ours" : ""}`
  report.addRemove.set(key, (report.addRemove.get(key) ?? 0) + 1)
  const text = `object ${e.data} ${what}, ${type}${ours ? ", one of ours" : ""}`
  // Traffic comes and goes all the time at an airport; only the user's own
  // objects and types that could be a person go on the console.
  if (!ours && [2, 3, 4, 5].includes(e.type)) rec.data("object", text, { what, type, id: e.data })
  else rec.log("object", text, { what, type, id: e.data, ours })
})

// ------------------------------------------------ the user's mode and camera

const globalsSeen = new Map()
const cameraSamples = []
sim.watch(GLOBALS, {
  period: "frame",
  label: "globals",
  onChange: (name, v, before, t) => {
    globalsSeen.set(name, v)
    if (name.startsWith("CAMERA GAMEPLAY")) {
      cameraSamples.push({ t, name, v })
      return rec.data("global", `${name} ${fmt(v)}`, { name, value: v })
    }
    rec.log("global", `${name} ${before === undefined ? "" : `${fmt(before)} → `}${fmt(v)}`, { name, value: v, before })
  },
})

// ------------------------------------------------ ways of addressing the avatar

const posNames = (i = null) => POS.map(([n]) => (i === null ? n : `${n}:${i}`))
const plain = (key, label, object) => ({ key, label, object, vars: POSE, pos: posNames(), names: true })
const indexed = (i) => ({
  key: `index${i}`, label: `PLANE LATITUDE:${i} and its kin, on object 0`, object: USER,
  vars: POS.map(([n, u]) => [`${n}:${i}`, u]), pos: posNames(i), names: false,
})

async function forms() {
  const list = [
    plain("avatar", "SIMCONNECT_OBJECT_ID_USER_AVATAR", USER_AVATAR),
    plain("current", "SIMCONNECT_OBJECT_ID_USER_CURRENT", USER_CURRENT),
    plain("object2", "object ID 2", 2),
  ]
  for (const type of [8, 9]) {
    const ids = await sim.byType(type, 200, { timeoutMs: 1500 })
    rec.log("bytype", `${TYPES[type]} within 200m: ${ids.length ? ids.join(", ") : "none"}${ids.error ? `, ${ids.error}` : ids.timedOut ? ", timed out" : ""}`, { type, ids: [...ids] })
    for (const id of ids) if (!list.some((f) => f.object === id)) list.push(plain(`type${type}:${id}`, `object ${id}, listed as ${TYPES[type]}`, id))
  }
  list.push(indexed(1), indexed(2), plain("user", "object 0, the user aircraft's legacy ID", USER))
  return list
}

const toPose = (f, v) => {
  const [lat, lon, alt, hdg] = f.pos.map((n) => v.get(n))
  const gs = v.get("GROUND VELOCITY")
  const vz = v.get("VELOCITY BODY Z")
  return {
    lat, lon, alt, hdg,
    fps: vz ?? (gs === undefined ? 0 : gs * KNOTS_TO_FPS),
    gs, agl: v.get("PLANE ALT ABOVE GROUND"), pitch: v.get("PLANE PITCH DEGREES"), bank: v.get("PLANE BANK DEGREES"),
    onGround: v.get("SIM ON GROUND"), crouch: v.get("IS CROUCH"), talking: v.get("IS TALKING"),
    hand: v.get("HAND ANIM STATE"), dt: v.get("ANIMATION DELTA TIME"),
    gender: v.get("GENDER"), height: v.get("HEIGHT"),
  }
}

let aircraft = null

async function locate(where) {
  const list = await forms()
  const out = []
  for (const f of list) {
    const v = await sim.read(f.vars, { object: f.object, label: `read ${f.label}`, timeoutMs: 1500 })
    const s = f.names ? await sim.readStrings(NAMES, { object: f.object, label: `read the names on ${f.label}`, timeoutMs: 1500 }) : new Map()
    const p = toPose(f, v)
    const answered = Number.isFinite(p.lat) && Number.isFinite(p.lon)
    const r = {
      where, key: f.key, label: f.label, object: f.object, answered,
      error: v.error, missing: v.missing, pose: p,
      title: s.get("TITLE") ?? null, category: s.get("CATEGORY") ?? null, idle: s.get("IDLE ANIMATION ID") ?? null,
      fromAircraft: aircraft && answered ? distance(p.lat, p.lon, aircraft.lat, aircraft.lon) : null,
      form: f,
    }
    out.push(r)
    const extra = [
      r.title !== null ? `TITLE ${JSON.stringify(r.title)}` : null,
      r.category !== null ? `CATEGORY ${JSON.stringify(r.category)}` : null,
      answered ? `${fmt(p.lat)}, ${fmt(p.lon)}, ${Math.round(p.alt)} ft, heading ${Math.round(p.hdg)}°` : null,
      r.fromAircraft !== null ? `${r.fromAircraft.toFixed(1)}m from the aircraft` : null,
      p.gender !== undefined ? `GENDER ${fmt(p.gender)}` : null,
    ].filter(Boolean).join(", ")
    rec.log("locate", `${where}, ${f.label}: ${answered ? `answers: ${extra}` : `no position${v.error ? `: ${v.error}` : ""}${extra ? `; ${extra}` : ""}`}`, {
      where, key: f.key, object: f.object, answered, error: v.error, missing: v.missing,
      values: Object.fromEntries(v), names: Object.fromEntries(s),
    })
  }
  report.locations.push({ where, results: out, globals: Object.fromEntries(globalsSeen) })
  return out
}

// ------------------------------------------------ seated: what the sim has

console.log([
  "",
  "Before you start:",
  "  - in the cockpit, on the ground at a gate or ramp with open ground beside the aircraft",
  "  - the sim in front, with this console where you can read it",
  "  - about 3 minutes; the first step runs on its own",
].join("\n"))

// Object 0 is the aircraft while you're seated, so this is the reference the
// avatar's distances are measured from.
{
  const v = await sim.read(POS)
  const s = await sim.readStrings(["TITLE"])
  const [lat, lon, alt, hdg] = POS.map(([n]) => v.get(n))
  if (Number.isFinite(lat)) aircraft = { lat, lon, alt, hdg, title: s.get("TITLE") ?? null }
  rec.log("aircraft", aircraft ? `TITLE ${JSON.stringify(aircraft.title)} at ${fmt(lat)}, ${fmt(lon)}, heading ${Math.round(hdg)}°` : "object 0 gave no position", { aircraft })
}

await locate("seated")

// Every type at once: each request has its own ID, and an unsupported type
// answers with an exception rather than holding up the others.
const enumerated = await Promise.all(Object.keys(TYPES).map(async (k) => {
  const type = Number(k)
  const list = await sim.liveries({ type })
  const titles = new Map()
  for (const x of list) if (x.title && !titles.has(x.title)) titles.set(x.title, x.livery ?? "")
  const human = [...titles.keys()].filter((t) => HUMAN.test(t))
  const r = { type, name: TYPES[type], count: titles.size, error: list.error ?? null, human, titles }
  // Aircraft lists run to thousands of titles and say nothing about people.
  rec.log("titles", `${TYPES[type]}: ${plural(titles.size, "title")}${list.error ? `, ${list.error}` : ""}${human.length ? `; person-like: ${human.join(", ")}` : ""}`, {
    type, count: titles.size, error: list.error ?? null, human, titles: type === 2 || type === 3 ? undefined : [...titles.keys()],
  })
  return r
}))
report.types = enumerated

const nearbyIds = await sim.byType(1, NEARBY_M, { timeoutMs: 5000 })
for (const id of nearbyIds.slice(0, 80)) {
  const s = await sim.readStrings(["TITLE", "CATEGORY"], { object: id, label: `read the names on object ${id}` })
  report.nearby.push({ id, title: s.get("TITLE") ?? null, category: s.get("CATEGORY") ?? null })
}
const byCategory = new Map()
for (const n of report.nearby) byCategory.set(n.category, (byCategory.get(n.category) ?? 0) + 1)
const nearbyHuman = report.nearby.filter((n) => HUMAN.test(`${n.title} ${n.category}`))
rec.log("nearby", `${plural(nearbyIds.length, "AI object")} within ${NEARBY_M}m${nearbyIds.length > 80 ? ", the first 80 read" : ""}: ${[...byCategory].map(([c, n]) => `${n} ${c}`).join(", ") || "none"}${nearbyHuman.length ? `; person-like: ${[...new Set(nearbyHuman.map((n) => n.title))].join(", ")}` : ""}`, {
  count: nearbyIds.length, objects: report.nearby,
})

// ------------------------------------------------ pose streams

let phase = null
const stats = new Map() // phase → form key → stats
const streams = []
let tracked = null // { key, samples }
let follow = null

function track(phaseName, key, p, t) {
  let byForm = stats.get(phaseName)
  if (!byForm) stats.set(phaseName, byForm = new Map())
  let s = byForm.get(key)
  if (!s) byForm.set(key, s = { n: 0, first: t, last: t, path: 0, turned: 0, maxGs: 0, alt: [Infinity, -Infinity], agl: [Infinity, -Infinity], pitch: [Infinity, -Infinity], bank: [Infinity, -Infinity], crouch: new Set(), talking: new Set(), hand: new Set(), onGround: new Set(), prev: null })
  s.n++
  s.last = t
  if (s.prev) {
    const d = distance(s.prev.lat, s.prev.lon, p.lat, p.lon)
    if (Number.isFinite(d)) s.path += d
    if (Number.isFinite(p.hdg) && Number.isFinite(s.prev.hdg)) s.turned += Math.abs(turn(s.prev.hdg, p.hdg))
  }
  s.prev = p
  if (Number.isFinite(p.gs)) s.maxGs = Math.max(s.maxGs, p.gs)
  for (const k of ["alt", "agl", "pitch", "bank"]) if (Number.isFinite(p[k])) s[k] = [Math.min(s[k][0], p[k]), Math.max(s[k][1], p[k])]
  for (const k of ["crouch", "talking", "hand", "onGround"]) if (p[k] !== undefined) s[k].add(p[k])
}

function startStreams(located) {
  for (const r of located.filter((x) => x.answered)) {
    const f = r.form
    const w = sim.watch(f.vars, {
      period: "frame",
      changed: false,
      label: `pose ${f.key}`,
      object: f.object,
      onData: (v, t) => {
        const p = toPose(f, v)
        if (!Number.isFinite(p.lat)) return
        // Every form in the timed steps and only the followed one after, or the
        // results run to megabytes.
        if (phase && (phase !== "follow" || tracked?.key === f.key)) rec.data("pose", "", { form: f.key, phase, ...p })
        if (phase) track(phase, f.key, p, t)
        if (tracked?.key === f.key) onTracked({ t, ...p })
      },
    })
    streams.push({ key: f.key, label: f.label, w })
  }
}

function onTracked(p) {
  const s = tracked.samples
  s.push(p)
  while (s.length && s[0].t < p.t - 5000) s.shift()
  if (follow) drive(p.t)
}

const latest = () => tracked?.samples[tracked.samples.length - 1] ?? null

function phaseSummary(name) {
  const byForm = stats.get(name) ?? new Map()
  const lines = []
  for (const [key, s] of byForm) {
    const secs = (s.last - s.first) / 1000
    const range = ([a, b], unit = "") => (Number.isFinite(a) ? (Math.abs(b - a) < 0.05 ? `${fmt(a)}${unit}` : `${fmt(a)}..${fmt(b)}${unit}`) : "—")
    lines.push({
      key, path: s.path, turned: s.turned, maxGs: s.maxGs,
      text: `${key}: ${s.n} samples${secs > 0 ? ` at ${((s.n - 1) / secs).toFixed(0)}/s` : ""}, moved ${s.path.toFixed(1)}m, turned ${Math.round(s.turned)}°, ground speed up to ${s.maxGs.toFixed(1)} kt, altitude ${range(s.alt, " ft")}, AGL ${range(s.agl, " ft")}, pitch ${range(s.pitch, "°")}, bank ${range(s.bank, "°")}, IS CROUCH ${[...s.crouch].join("/") || "—"}, HAND ANIM STATE ${[...s.hand].join("/") || "—"}, SIM ON GROUND ${[...s.onGround].join("/") || "—"}`,
    })
  }
  return lines
}

// ------------------------------------------------ steps

async function ask(heading, instruction) {
  console.log(`\n▶ ${heading}\n  ${instruction}\n  Page Down to start, End to skip.`)
  const k = await keys.next()
  rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
  return k.key === "PGDN"
}

async function timed(name, ms) {
  phase = name
  beep(1000, 100)
  await sleep(ms)
  phase = null
  const lines = phaseSummary(name)
  report.phases.push({ name, lines })
  for (const l of lines) rec.log("phase", `${name}, ${l.text}`, { phase: name, form: l.key })
  return lines
}

function freeze(id) {
  sim.release(id)
  for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: id, quiet: true })
}

async function create(title, livery, at, facing) {
  const init = new InitPosition()
  Object.assign(init, { latitude: at.lat, longitude: at.lon, altitude: at.alt, pitch: 0, bank: 0, heading: wrap(facing), onGround: true, airspeed: 0 })
  const r = await sim.spawn(title, livery, init)
  if (r.id === undefined) return r
  spawned.add(r.id)
  freeze(r.id)
  return r
}

async function removeAll() {
  for (const id of spawned) sim.remove(id)
  spawned.clear()
}

let stopping = false
process.on("SIGINT", async () => {
  if (stopping) process.exit(1)
  stopping = true
  rec.log("stop", "Ctrl+C: removing the figures and writing the report")
  follow = null
  await removeAll()
  await finish()
  process.exit(0)
})

// on foot ----------------------------------------

if (await ask("On foot", "Get out of the aircraft and stand beside it, then press Page Down. Walk at the first short beep, run at the second, crouch at the third, and at the long low beep stand still, facing open ground. About 15s.")) {
  console.log("  Reading where you are; walk at the first short beep.")
  const onFoot = await locate("on foot")
  startStreams(onFoot)
  await timed("walk", 5000)
  await timed("run", 5000)
  await timed("crouch", 4000)
  beep(500, 600)
  console.log("  Stand still.")
  // The way of addressing the avatar that moved furthest while you walked and
  // ran is the one the figures place themselves by.
  const moved = new Map()
  for (const p of ["walk", "run"]) for (const l of report.phases.find((x) => x.name === p)?.lines ?? []) moved.set(l.key, (moved.get(l.key) ?? 0) + l.path)
  const best = [...moved].filter(([k, m]) => k !== "user" && m > 3).sort((a, b) => b[1] - a[1])[0]
  if (best) {
    tracked = { key: best[0], samples: [] }
    report.chosen = { key: best[0], moved: best[1] }
    rec.log("chosen", `${best[0]} moved ${best[1].toFixed(1)}m while you walked and ran, so the figures follow it`, report.chosen)
  } else {
    rec.log("chosen", "nothing moved more than 3m while you walked and ran, so the figures go off the aircraft's nose instead")
  }
  await sleep(500)
}

// The place to put a figure: in front of the avatar, or with no avatar to read,
// 15m off the aircraft's nose.
function anchor() {
  const p = latest()
  if (p) return { at: offset(p, AHEAD_M, 0), facing: p.hdg + 180 }
  if (aircraft) return { at: offset(aircraft, 15, 0), facing: aircraft.hdg + 180 }
  return null
}

// figures -----------------------------------------

const avatarTitles = (report.locations.find((l) => l.where === "on foot")?.results ?? [])
  .filter((r) => r.key !== "user" && r.title && r.title !== aircraft?.title)
  .map((r) => r.title)
const liveryOf = (title) => {
  for (const t of report.types) if (t.titles.has(title)) return t.titles.get(title)
  return ""
}
const candidates = [...new Set([
  ...avatarTitles,
  ...nearbyHuman.map((n) => n.title).filter(Boolean),
  ...report.types.filter((t) => t.type !== 2 && t.type !== 3).flatMap((t) => t.human).sort((a, b) => /charactersim/i.test(b) - /charactersim/i.test(a)),
  ...report.types.filter((t) => t.type === 2 || t.type === 3).flatMap((t) => t.human),
])].slice(0, MAX_FIGURES)
if (!candidates.length) candidates.push(FORUM_TITLE)
rec.log("candidates", candidates.join(", "), { candidates })

if (anchor() && await ask("Figures in front of you", `Stand still, facing open ground, and press Page Down. At each short beep a figure appears ${AHEAD_M}m in front of you for ${SHOW_MS / 1000}s; press Page Down each time you see one. ${plural(candidates.length, "figure")}, about ${Math.ceil(candidates.length * (SHOW_MS + 1500) / 1000)}s.`)) {
  const presses = []
  const unlisten = keys.listen((k) => { if (k.key === "PGDN") presses.push(k.t) })
  for (const title of candidates) {
    const a = anchor()
    beep(1000, 100)
    const t0 = Date.now()
    const r = await create(title, liveryOf(title), a.at, a.facing)
    const f = { title, livery: liveryOf(title), id: r.id ?? null, error: r.error ?? null, seen: false, readBack: null }
    if (r.id !== undefined) {
      const v = await sim.read(POS, { object: r.id, label: `read back object ${r.id}` })
      const s = await sim.readStrings(["TITLE", "CATEGORY"], { object: r.id, label: `read back the names on object ${r.id}` })
      const lat = v.get("PLANE LATITUDE")
      f.readBack = {
        title: s.get("TITLE") ?? null, category: s.get("CATEGORY") ?? null, error: v.error,
        offBy: Number.isFinite(lat) ? distance(lat, v.get("PLANE LONGITUDE"), a.at.lat, a.at.lon) : null,
        alt: v.get("PLANE ALTITUDE") ?? null,
      }
    }
    await sleep(Math.max(0, t0 + SHOW_MS - Date.now()))
    f.seen = presses.some((t) => t >= t0 && t <= t0 + SHOW_MS + 300)
    if (f.id !== null) { sim.remove(f.id); spawned.delete(f.id) }
    report.figures.push(f)
    rec.log("figure", f.id === null
      ? `${title}: not created: ${f.error}`
      : `${title}: object ${f.id}${f.readBack?.title ? `, reads back as ${JSON.stringify(f.readBack.title)}` : ""}${f.readBack?.offBy != null ? `, ${f.readBack.offBy.toFixed(1)}m from where it was put` : ""}; ${f.seen ? "SEEN" : "not seen"}`, f)
    await sleep(1500)
  }
  unlisten()
  beep(500, 600)
}

// follow ------------------------------------------

const seenFigure = report.figures.find((f) => f.seen)
// With no person seen, a ground vehicle shows whether the motion works at all.
const vehicle = report.types.find((t) => t.type === 5)?.titles.keys().next().value ?? null
const followTitle = seenFigure?.title ?? vehicle

function drive(now) {
  const p = poseAt(tracked.samples, now - DELAY_MS)
  if (!p) return
  const q = offset(p, 0, RIGHT_M)
  follow.writes++
  if (!follow.poseFailed) sim.set(POS, [q.lat, q.lon, q.alt, q.hdg], { object: follow.id, label: "copy pose", quiet: true })
  if (!follow.speedFailed) sim.set([["VELOCITY BODY Z", "feet per second"]], [p.fps], { object: follow.id, label: "copy speed", quiet: true })
}

if (!tracked || !followTitle) rec.log("follow", `skipped: ${!tracked ? "nothing read the avatar's position as you walked" : "no figure was seen and the sim lists no ground vehicle"}`)
else if (await ask("A figure follows you", `Press Page Down, then walk around for ${FOLLOW_MS / 1000}s, turning to look at it: ${seenFigure ? "the first figure you saw" : `no figure was seen, so a ground vehicle, ${JSON.stringify(followTitle)},`} follows your path ${DELAY_MS / 1000}s behind you and ${RIGHT_M}m to your right. It goes at the long low beep.`)) {
  const p = latest()
  const at = offset(p, -2, RIGHT_M)
  const r = await create(followTitle, liveryOf(followTitle), at, p.hdg)
  if (r.id === undefined) {
    rec.log("follow", `${followTitle}: not created: ${r.error}`)
  } else {
    follow = { id: r.id, title: followTitle, person: Boolean(seenFigure), writes: 0, poseFailed: false, speedFailed: false, exceptions: [] }
    const unwatch = rec.onRecord((x) => {
      if (x.kind !== "exception" || !follow) return
      if (x.sent === "copy pose") follow.poseFailed = true
      if (x.sent === "copy speed") follow.speedFailed = true
      follow.exceptions.push(x.text)
    })
    beep(1000, 100)
    phase = "follow"
    await sleep(FOLLOW_MS)
    phase = null
    const f = follow
    follow = null
    unwatch()
    sim.remove(f.id)
    spawned.delete(f.id)
    beep(500, 600)
    report.follow = f
    rec.log("follow", `${f.title} as object ${f.id}: ${plural(f.writes, "frame")} written${f.poseFailed ? ", pose writes failed" : ""}${f.speedFailed ? ", speed writes failed" : ""}${f.exceptions.length ? `: ${f.exceptions.slice(0, 3).join("; ")}` : ""}`, f)
    console.log("  Tell Claude how it moved: walked or slid, kept up, faced the right way, stayed on the ground.")
  }
}

// back in the seat --------------------------------

if (await ask("Back in your seat", "Return to the cockpit, then press Page Down and look left, then right, until the long low beep, 6s.")) {
  for (const s of streams) s.w.stop()
  streams.length = 0
  tracked = null
  await locate("seated again")
  const t0 = Date.now()
  beep(1000, 100)
  await sleep(6000)
  beep(500, 600)
  const yaw = cameraSamples.filter((x) => x.t >= t0 && x.name.endsWith(":1")).map((x) => x.v / RAD)
  const pitch = cameraSamples.filter((x) => x.t >= t0 && x.name.endsWith(":0")).map((x) => x.v / RAD)
  report.camera = {
    yaw: yaw.length ? [Math.min(...yaw), Math.max(...yaw)] : null,
    pitch: pitch.length ? [Math.min(...pitch), Math.max(...pitch)] : null,
    samples: yaw.length + pitch.length,
  }
  const deg = (r) => (r ? `${r[0].toFixed(0)}°..${r[1].toFixed(0)}°` : "no change")
  rec.log("camera", `while you looked around: yaw ${deg(report.camera.yaw)}, pitch ${deg(report.camera.pitch)}, from CAMERA GAMEPLAY PITCH YAW`, report.camera)
}

await finish()
process.exit(0)

// ---------------------------------------------------------------- report

async function finish() {
  for (const s of streams) s.w.stop()
  await removeAll()
  const lines = [
    "p01 · Reading the avatar and showing a figure in its place, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    `Aircraft: ${aircraft ? `TITLE ${JSON.stringify(aircraft.title)}` : "object 0 gave no position"}`,
  ]
  for (const l of report.locations) {
    lines.push("", `Addressing the avatar, ${l.where}: IS AVATAR ${fmt(l.globals["IS AVATAR"])}, IS AIRCRAFT ${fmt(l.globals["IS AIRCRAFT"])}, CAMERA STATE ${fmt(l.globals["CAMERA STATE"])}`)
    for (const r of l.results) {
      const p = r.pose
      lines.push(`  ${r.label}: ${r.answered
        ? `${fmt(p.lat)}, ${fmt(p.lon)}, ${Math.round(p.alt)} ft, heading ${Math.round(p.hdg)}°${r.fromAircraft !== null ? `, ${r.fromAircraft.toFixed(1)}m from the aircraft` : ""}${r.title !== null ? `, TITLE ${JSON.stringify(r.title)}` : ""}${r.category !== null ? `, CATEGORY ${JSON.stringify(r.category)}` : ""}${r.idle ? `, IDLE ANIMATION ID ${JSON.stringify(r.idle)}` : ""}`
        : `no position${r.error ? `: ${r.error}` : ""}`}${r.answered && r.missing.length ? ` · didn't answer: ${r.missing.join(", ")}` : ""}`)
    }
  }
  lines.push("", "Titles the sim lists, by object type:")
  for (const t of report.types) lines.push(`  ${t.name}: ${plural(t.count, "title")}${t.error ? `, ${t.error}` : ""}${t.human.length ? `; person-like: ${t.human.join(", ")}` : ""}`)
  lines.push("", `AI objects within ${NEARBY_M}m: ${report.nearby.length}`)
  const titles = new Map()
  for (const n of report.nearby) titles.set(`${n.category} · ${n.title}`, (titles.get(`${n.category} · ${n.title}`) ?? 0) + 1)
  for (const [t, n] of [...titles].sort()) lines.push(`  ${n} × ${t}`)
  lines.push("", "Objects added and removed during the run:")
  for (const [k, n] of report.addRemove) lines.push(`  ${n} ${k}`)
  if (!report.addRemove.size) lines.push("  none")
  lines.push("", "On foot, per way of addressing the avatar:")
  for (const p of report.phases) for (const l of p.lines) lines.push(`  ${p.name}, ${l.text}`)
  if (!report.phases.length) lines.push("  not run")
  lines.push(`  Followed: ${report.chosen ? `${report.chosen.key}, which moved ${report.chosen.moved.toFixed(1)}m` : "nothing moved"}`)
  lines.push("", "Figures put in front of you:")
  for (const f of report.figures) {
    lines.push(`  ${f.title}: ${f.id === null ? `not created: ${f.error}` : `object ${f.id}${f.readBack?.title ? `, reads back as ${JSON.stringify(f.readBack.title)} (${f.readBack.category})` : ""}${f.readBack?.offBy != null ? `, ${f.readBack.offBy.toFixed(1)}m from where it was put` : ""}${f.readBack?.error ? `, read-back: ${f.readBack.error}` : ""}; ${f.seen ? "SEEN" : "not seen"}`}`)
  }
  if (!report.figures.length) lines.push("  not run")
  const fo = report.follow
  lines.push("", `Following: ${fo ? `${fo.title} (${fo.person ? "a figure you saw" : "a ground vehicle, since no figure was seen"}), ${plural(fo.writes, "frame")} written ${DELAY_MS / 1000}s behind and ${RIGHT_M}m right${fo.poseFailed ? "; pose writes failed" : ""}${fo.speedFailed ? "; speed writes failed" : ""}${fo.exceptions.length ? `; ${fo.exceptions.slice(0, 3).join("; ")}` : ""}` : "not run"}`)
  const c = report.camera
  const deg = (r) => (r ? `${r[0].toFixed(0)}°..${r[1].toFixed(0)}°` : "no change")
  lines.push("", `Camera while seated again: ${c ? `yaw ${deg(c.yaw)}, pitch ${deg(c.pitch)}, CAMERA GAMEPLAY PITCH YAW` : "not run"}`)
  const exceptions = rec.timeline.filter((e) => e.kind === "exception").map((e) => e.text)
  const counted = new Map()
  for (const e of exceptions) counted.set(e, (counted.get(e) ?? 0) + 1)
  lines.push("", `Exceptions: ${exceptions.length ? "" : "none"}`)
  for (const [e, n] of counted) lines.push(`  ${n} × ${e}`)
  const text = lines.join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
}
