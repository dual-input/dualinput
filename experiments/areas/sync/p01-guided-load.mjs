/*
 * Settling and writes on each studied aircraft, loaded by a pilot from the
 * sim's own menu, as a crew's pilots load theirs.
 *
 *   node experiments/areas/sync/p01-guided-load.mjs
 *   node experiments/areas/sync/p01-guided-load.mjs --from 5      resume at the 5th load
 *   node experiments/areas/sync/p01-guided-load.mjs --only synaptic-a220
 *   node experiments/areas/sync/p01-guided-load.mjs --loads 7,1,1   these LOADS, in this order
 *
 * For each load in LOADS, in order, the probe:
 *   1. names the aircraft, its place in the list, and whether Flow Pro's
 *      auto-click is on for it; the pilot presses Page Down as they click Fly
 *      in Free flight, or Page Up to skip the aircraft;
 *   2. records, from the sim's FlightLoaded or that press, whichever comes
 *      first, every L: variable that moves, through fsc-editor-link's stream,
 *      the stock values in TIMELINE_A every frame, and the sim's load events;
 *   3. waits for a second Page Down, when Ready to fly is clicked, by the pilot
 *      or by Flow Pro;
 *   4. asks for hands off the cockpit for 2 minutes from that press;
 *   5. measures the frame rate for 10s, then runs the write tests, which put
 *      back every value they change;
 *   6. asks for the next aircraft.
 * The report applies catch-up's settle rule (record/areas/sync/03-catch-up.md,
 * "Settling after a load"; lib/settle.mjs) to every load, timed from each
 * candidate moment of "loaded", the sim's markers first and the presses as a
 * check on them, over every value and over a short list of switches, and lists
 * what moved after the rule called the aircraft settled.
 *
 * The connection stays open across loads, as a crew member's Crosscheck would.
 * It subscribes to no K: events: the crashes in
 * experiments/areas/aircraft/results/crashes.tsv that followed probes came
 * after notification groups at priority 1 were left behind (run.mjs, connect).
 * fsc-editor streams L: variables through its link across aircraft changes a
 * pilot makes from the menu (fsc-editor, docs/sim-vars/build/v1-log.md,
 * "2026-08-24 — Re-enumeration stops on a pause, not on a finished table").
 */

import { AIRCRAFT } from "../aircraft/lib/aircraft.mjs"
import { Link } from "../aircraft/lib/link.mjs"
import { SETTLE_A } from "../aircraft/lib/load.mjs"
import { Recorder, fmt, plural, repoRelative, scrub, secs, sleep } from "../aircraft/lib/out.mjs"
import { TIMELINE_A } from "../aircraft/lib/probes.mjs"
import { Sim } from "../aircraft/lib/sim.mjs"
import { startBeeper, startKeys, startSpeaker } from "../../tools/guide.mjs"
import { RULE, markers, settleVerdict } from "./lib/settle.mjs"

// The Baron's latest restore came about 52s after Ready to fly, in a runway
// start (experiments/areas/sync/results/p01-guided-load-2026-10-05-16-45-26.txt).
const HANDS_OFF_MS = 120_000
const READY_TIMEOUT_MS = 15 * 60_000
const RESCAN_MS = 5_000
// Change times kept per value, before and after the Ready press. A value past
// this moved too often to matter to the verdicts, which need at most its first
// 6 changes after any candidate moment.
const KEEP_TIMES = 30

// One aircraft for each way of loading its state that our studies found, and
// the last load repeats the first with Flow Pro's auto-click off, so any
// difference the click makes shows on the same aircraft (agreed with the user,
// 2026-10-05). The Bonanza, Aerostar, L-1011, A380, and Phenom 300E share a
// developer's way of loading with one of these, or added nothing beside them.
const BARON_58P = "Black Square Baron 58P (Baron Pro, pressurized)"
const LOADS = [
  { id: "black-square-baron-pro", label: BARON_58P, flowPro: true },
  { id: "a2a-pa24-comanche", flowPro: true },
  { id: "synaptic-a220", flowPro: true },
  { id: "fenix-a320-family", flowPro: true },
  { id: "inibuilds-a350", flowPro: true },
  { id: "pmdg-777-300er", flowPro: true },
  { id: "black-square-baron-pro", label: BARON_58P, flowPro: false },
]

// Writes every aircraft gets, each through a stock name, so an aircraft that
// ignores one shows as a write that never landed. The values differ from any
// start state we've seen, and the original goes back afterwards.
const STOCK_WRITES = [
  {
    label: "K:HEADING_BUG_SET → A:AUTOPILOT HEADING LOCK DIR",
    read: ["AUTOPILOT HEADING LOCK DIR", "degrees"],
    values: [93, 271],
    tolerance: 0.5,
    write: (sim, v) => sim.transmit("K:HEADING_BUG_SET", [Math.round(v)], { quiet: true }),
  },
  {
    // [0] is millibars times 16 and [1] the altimeter's index (MSFS 2024 SDK,
    // Aircraft Instrumentation Events, KOHLSMAN_SET, as
    // record/learn/foundations/03-02-events-and-other-namespaces.md cites it).
    label: "K:KOHLSMAN_SET → A:KOHLSMAN SETTING MB:1",
    read: ["KOHLSMAN SETTING MB:1", "millibars"],
    values: [1001, 1027],
    tolerance: 0.1,
    write: (sim, v) => sim.transmit("K:KOHLSMAN_SET", [Math.round(v * 16), 1], { quiet: true }),
  },
  {
    label: "L:CROSSCHECK_P01_SHOW by data definition",
    read: ["L:CROSSCHECK_P01_SHOW", "number"],
    values: [3, 7],
    tolerance: 1e-6,
    original: 0,
    write: (sim, v) => sim.set([["L:CROSSCHECK_P01_SHOW", "number"]], [v], { quiet: true }),
  },
]

// One control of the aircraft's own, where its study names a variable that's
// safe to flip and put back.
const AIRCRAFT_WRITES = {
  // The tablet saves the front armrest from this variable (read in
  // bksq-aircraft-baronpro 0.1.1, record/areas/aircraft/black-square-baron-pro/
  // inventory/datastorage-keys.txt).
  "black-square-baron-pro": [{
    label: "L:var_FrontArmrest by data definition",
    read: ["L:var_FrontArmrest", "number"],
    flip: true,
    tolerance: 1e-6,
    write: (sim, v) => sim.set([["L:var_FrontArmrest", "number"]], [v], { quiet: true }),
  }],
}

const WAIT_MS = 500 // 02-live-sync's starting wait before a read-back
const RETRIES = 3

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
const FROM = Number(flag("--from") ?? 1)
const ONLY = flag("--only")
const PICK = flag("--loads")

const picked = PICK
  ? PICK.split(",").map((s) => {
    const l = LOADS[Number(s) - 1]
    if (!l) throw new Error(`no load ${s}: LOADS has ${LOADS.length}`)
    return l
  })
  : LOADS
const loads = picked.map((l, i) => ({ ...l, n: i + 1, a: AIRCRAFT[l.id] }))
  .filter((l) => l.n >= FROM && (!ONLY || l.id === ONLY))
for (const l of loads) if (!l.a) throw new Error(`no aircraft ${l.id} in aircraft/lib/aircraft.mjs`)

// ---------------------------------------------------------------- state

const rec = new Recorder("p01-guided-load", { area: "sync" })
const run = { results: [], stopping: false, current: null, finished: false }
let sim = null
let link = null
let stream = null
let keys = null
let beep = () => {}
let say = () => {}

const names = new Map() // L: id → "L:name"
const lastL = new Map() // L: id → its last streamed value
const events = [] // { t, name, data }, the sim's system and flow events
const curatedA = new Set(SETTLE_A.map(([n]) => n))

// One load: every value that moved after recording started, as
// key → { kind, name, first, last, appearedT, before: { n, times }, after: { n, times } },
// with "before" and "after" the second Page Down. tArm is when the probe asked
// for the aircraft, and recording starts at the sim's first FlightLoaded after
// it, or at the first Page Down if that comes first.
function newLoadState(load) {
  return { load, tArm: Date.now(), tStart: null, t1: null, t2: null, tEnd: null, entries: new Map(), markers: null }
}

// before is undefined for a value seen for the first time, such as an L:
// variable an aircraft registers while it loads: that's an appearance, not a
// change, and the rule doesn't count it.
function noteChange(state, key, kind, name, before, value, t) {
  if (before === value) return
  let e = state.entries.get(key)
  if (!e) {
    e = { kind, name, first: before ?? value, last: before ?? value, appearedT: before === undefined ? t : null, before: { n: 0, times: [] }, after: { n: 0, times: [] } }
    state.entries.set(key, e)
  }
  if (before === undefined) { e.last = value; return }
  e.last = value
  const bucket = state.t2 !== null && t >= state.t2 ? e.after : e.before
  bucket.n++
  if (bucket.times.length < KEEP_TIMES) bucket.times.push(t)
}

const recording = () => (run.current && run.current.tStart !== null && run.current.tEnd === null ? run.current : null)

function startRecording() {
  sim.watch([...TIMELINE_A, ["CAMERA STATE", "number"]], {
    period: "frame",
    label: "timeline",
    onChange: (name, v, before, t) => {
      const state = recording()
      if (state) noteChange(state, `A:${name}`, "A", `A:${name}`, before, v, t)
    },
  })
  sim.systemHandlers.add((name, data) => {
    const t = Date.now()
    events.push({ t, name, data })
    if (name === "FlightLoaded" && run.current && run.current.tStart === null) run.current.tStart = t
  })
  sim.flowHandlers.add((name) => events.push({ t: Date.now(), name: `flow ${name}`, data: null }))
}

function onValues(values, t) {
  const state = recording()
  for (const { id, value } of values) {
    const before = lastL.get(id)
    lastL.set(id, value)
    if (state) noteChange(state, `L:${id}`, "L", names.get(id) ?? `L:#${id}`, before, value, t)
  }
}

// ---------------------------------------------------------------- the settle rule

const verdict = (state, t0, keep) =>
  settleVerdict({ entries: state.entries, t0, t2: state.t2, tEnd: state.tEnd, keep, keepTimes: KEEP_TIMES })

// The sim's markers come first: a pilot's press can land seconds late, and on
// 2026-10-05 one came 22s after the sim's FlightLoaded (results/p01-guided-load-
// 2026-10-05-16-54-34.ndjson, the Fenix). The presses stay as a check on them.
function candidates(state) {
  const m = markers(events, { from: state.tArm, readyBy: state.t2 + 10_000 })
  state.markers = m
  const from = m.fly ?? state.t1
  const first = (test) => events.find((ev) => ev.t >= from && test(ev))?.t ?? null
  return [
    ["Fly, by the sim's last FlightLoaded", m.fly],
    ["the first Page Down, clicking Fly", state.t1],
    ["the sim running", first((ev) => (ev.name === "Sim" && ev.data === 1) || ev.name === "SimStart")],
    ["Ready to fly, by the sim's last RTC_END", m.ready],
    ["the second Page Down, Ready to fly", state.t2],
  ].filter(([, t]) => t !== null && t <= state.tEnd)
}

function switchesOf(state) {
  const settleL = new Set(state.load.a.settleL ?? [])
  return (e) => (e.kind === "A" ? curatedA.has(e.name.slice(2)) : settleL.has(e.name))
}

// ---------------------------------------------------------------- write tests

const readNow = (name, units) => sim.readOne(name, units, { timeoutMs: 2000 })

// Milliseconds and sim frames until each write shows, with up to RETRIES more
// writes, each after WAIT_MS without the value: [{ value, shown, ms, frames, writes }].
async function timeToShow(t) {
  const [name, units] = t.read
  const original = t.original ?? (await readNow(name, units))
  const values = t.flip ? [original ? 0 : 1, original ? 1 : 0] : t.values
  const out = []
  for (const v of values) {
    let frames = 0
    let shown = null
    let armed = false
    const w = sim.watch([[name, units]], {
      period: "frame",
      changed: false,
      label: "show",
      onData: (got, now) => {
        if (!armed) return
        frames++
        const x = got.get(name)
        if (shown === null && typeof x === "number" && Math.abs(x - v) <= t.tolerance) shown = { now, frames }
      },
    })
    await sleep(150)
    armed = true
    const t0 = Date.now()
    let writes = 0
    while (shown === null && writes < 1 + RETRIES && !sim.gone) {
      t.write(sim, v)
      writes++
      const until = Date.now() + WAIT_MS
      while (shown === null && Date.now() < until) await sleep(10)
    }
    w.stop()
    out.push({ value: v, shown: shown !== null, ms: shown ? shown.now - t0 : null, frames: shown ? shown.frames : frames, writes })
    await sleep(200)
  }
  if (typeof original === "number") {
    t.write(sim, original)
    await sleep(300)
  }
  return { label: t.label, original, restored: await readNow(name, units), results: out }
}

// Two writes to one variable back to back in the same tick, then a read: does
// the second one win?
async function orderTest({ label, write, read, pairs, settleMs, tolerance }) {
  const [name, units] = read
  const original = await readNow(name, units)
  const tally = { secondWon: 0, firstWon: 0, neither: 0 }
  for (const [a, b] of pairs) {
    write(a)
    write(b)
    await sleep(settleMs)
    const x = await readNow(name, units)
    if (typeof x === "number" && Math.abs(x - b) <= tolerance) tally.secondWon++
    else if (typeof x === "number" && Math.abs(x - a) <= tolerance) tally.firstWon++
    else tally.neither++
  }
  if (typeof original === "number") { write(original); await sleep(settleMs) }
  return { label, trials: pairs.length, ...tally, original, restored: await readNow(name, units) }
}

async function writeTests(load) {
  const results = { order: [], show: [] }
  results.order.push(await orderTest({
    label: "two data-definition writes of L:CROSSCHECK_P01_ORDER",
    read: ["L:CROSSCHECK_P01_ORDER", "number"],
    write: (v) => sim.set([["L:CROSSCHECK_P01_ORDER", "number"]], [v], { quiet: true, record: false }),
    pairs: Array.from({ length: 20 }, (_, i) => (i % 2 ? [11, 12] : [12, 11])),
    settleMs: 150,
    tolerance: 1e-6,
  }))
  results.order.push(await orderTest({
    label: "two K:HEADING_BUG_SET events",
    read: ["AUTOPILOT HEADING LOCK DIR", "degrees"],
    write: (v) => sim.transmit("K:HEADING_BUG_SET", [Math.round(v)], { quiet: true }),
    pairs: Array.from({ length: 10 }, (_, i) => (i % 2 ? [41, 142] : [142, 41])),
    settleMs: 300,
    tolerance: 0.5,
  }))
  for (const r of results.order) {
    rec.log("order", `${r.label}: the second won ${r.secondWon} of ${r.trials}, the first ${r.firstWon}, neither ${r.neither}; restored ${fmt(r.restored)} (was ${fmt(r.original)})`, r)
  }
  for (const t of [...STOCK_WRITES, ...(AIRCRAFT_WRITES[load.id] ?? [])]) {
    if (sim.gone || run.stopping) break
    const r = await timeToShow(t)
    results.show.push(r)
    rec.log("show", `${r.label}: ${describeShow(r)}`, r)
  }
  sim.set([["L:CROSSCHECK_P01_ORDER", "number"], ["L:CROSSCHECK_P01_SHOW", "number"]], [0, 0], { quiet: true })
  return results
}

const describeShow = (r) =>
  `${r.results.map((x) => (x.shown ? `${fmt(x.value)} in ${x.ms}ms (${plural(x.frames, "frame")}, ${plural(x.writes, "write")})` : `${fmt(x.value)} never showed (${plural(x.writes, "write")})`)).join("; ")}; restored ${fmt(r.restored)}, was ${fmt(r.original)}`

// ---------------------------------------------------------------- one load

async function press(prompt, { timeoutMs = null } = {}) {
  rec.log("prompt", prompt)
  const next = keys.next()
  const k = await (timeoutMs ? Promise.race([next, sleep(timeoutMs).then(() => ({ key: "TIMEOUT", t: Date.now() }))]) : next)
  rec.log("key", `${k.key}${k.foreground ? ` (in front: ${k.foreground})` : ""}`, k)
  return k
}

// Asks for a change to Flow Pro's auto-click only where the setting differs from
// the load before, since the pilot left it as that one asked.
async function oneLoad(load, i, total, before) {
  const head = `${i}/${total} aircraft`
  const name = load.label ?? load.a.name
  const turn = before && before.flowPro !== load.flowPro
  const flow = load.flowPro ? (turn ? "ON (turn Flow Pro's auto-click back on now)" : "on") : (turn || !before ? "OFF (turn Flow Pro's auto-click off now)" : "off")
  beep(880, 150)
  say(`Aircraft ${i} of ${total}: ${name}. Flow Pro auto-click ${load.flowPro ? (turn ? "on. Turn it back on now" : "on") : (turn || !before ? "off. Turn it off now" : "off")}.`)
  const state = newLoadState(load)
  run.current = state
  const k1 = await press(`[${head}] Load ${name} parked, from Free flight. Flow Pro auto-click: ${flow}. Page Down the moment you click Fly; Page Up skips this aircraft.`)
  if (k1.key !== "START") { run.current = null; say("Skipped."); return { load: { n: load.n, id: load.id }, skipped: true } }

  state.t1 = k1.t
  if (state.tStart === null) state.tStart = k1.t
  beep(1200, 120)
  const k2 = await press(`[${head}] Recording. Page Down when Ready to fly is clicked, by you or Flow Pro.`, { timeoutMs: READY_TIMEOUT_MS })
  state.t2 = k2.key === "START" ? k2.t : Date.now()
  beep(1200, 120)
  say("Hands off for two minutes.")

  const loaded = events.find((ev) => ev.name === "AircraftLoaded" && ev.t >= state.tStart)
  const path = typeof loaded?.data === "string" ? loaded.data : sim.live.aircraft
  const matched = path ? load.a.folders.some((f) => path.toLowerCase().includes(`\\${f.toLowerCase()}\\`)) : null
  rec.log("aircraft", `${sim.live.title ?? "no title yet"}; ${path ?? "no AircraftLoaded path"}${matched === false ? `; not one of ${load.id}'s folders` : ""}`, { title: sim.live.title, path, matched })

  rec.log("prompt", `[${head}] Hands off the cockpit for ${HANDS_OFF_MS / 60_000} minutes. Looking around is fine; don't click anything.`)
  const until = state.t2 + HANDS_OFF_MS
  while (Date.now() < until && !run.stopping && !sim.gone) {
    await sleep(Math.min(RESCAN_MS, until - Date.now()))
    stream?.rescan()
  }
  state.tEnd = Date.now()
  beep(1000, 100); await sleep(150); beep(1000, 100)
  say("Still hands off, for the write tests.")
  rec.log("prompt", `[${head}] Still hands off: the frame rate, then the write tests, about 90s.`)

  const fps = sim.gone ? null : await sim.frameRate(10_000)
  if (fps) rec.log("fps", `${fps.fps === null ? "no" : fps.fps.toFixed(1)} sim frames a second over 10s`, fps)
  const writes = sim.gone || run.stopping ? null : await writeTests(load)
  run.current = null

  const result = summarize(state, { fps, writes, title: sim.live.title, path, matched })
  beep(660, 400)
  say(i < total ? "Done. Quit to the main menu for the next aircraft." : "Done. That was the last aircraft.")
  rec.log("prompt", `[${head}] Done with ${name}. Quit to the main menu for the next one.`)
  return result
}

function summarize(state, extra) {
  const verdicts = candidates(state).map(([from, t0]) => ({
    from, t0Ms: t0 - state.t1,
    all: verdict(state, t0, () => true),
    switches: verdict(state, t0, switchesOf(state)),
  }))
  const m = state.markers
  const marked = {
    flyMs: m.fly === null ? null : m.fly - state.t1,
    readyMs: m.ready === null ? null : m.ready - state.t1,
    reloads: m.reloads,
    recordingFromMs: state.tStart - state.t1,
  }
  const entries = [...state.entries.values()].map((e) => ({
    kind: e.kind, name: e.name, first: e.first, last: e.last,
    appearedMs: e.appearedT === null ? null : e.appearedT - state.t1,
    before: { n: e.before.n, ms: e.before.times.map((t) => t - state.t1) },
    after: { n: e.after.n, ms: e.after.times.map((t) => t - state.t1) },
  }))
  const moved = entries.filter((e) => e.before.n + e.after.n > 0)
  const appeared = entries.filter((e) => e.appearedMs !== null)
  const result = {
    load: { n: state.load.n, id: state.load.id, flowPro: state.load.flowPro },
    ...extra,
    readyMs: state.t2 - state.t1,
    marked,
    events: events.filter((ev) => ev.t >= state.tStart && ev.t <= state.tEnd).map((ev) => ({ ms: ev.t - state.t1, name: ev.name, data: ev.data })),
    lNames: names.size,
    moved: moved.length,
    appeared: appeared.length,
    lastAppearedMs: appeared.length ? Math.max(...appeared.map((e) => e.appearedMs)) : null,
    verdicts,
  }
  rec.data("load-entries", `${state.load.n} ${state.load.id}: ${moved.length} values moved, ${appeared.length} appeared`, { load: result.load, entries })
  rec.log("load", `${state.load.n} ${state.load.id}: Ready ${secs(result.readyMs)} after Fly; ${moved.length} values moved; ${verdicts.map((v) => `from ${v.from}: ${secs(v.all.atMs)} (${v.all.why}, ${v.all.late.length} late) over all, ${secs(v.switches.atMs)} (${v.switches.why}, ${v.switches.late.length} late) over the switches`).join("; ")}`, result)
  return result
}

// ---------------------------------------------------------------- report

function report() {
  const lines = []
  lines.push(`p01-guided-load, started ${new Date(rec.started).toISOString()}`)
  lines.push(`Settle rule: ${RULE.quietMs / 1000}s with no counted change, counted from ${RULE.firstQuietFromMs / 1000}s after load, or ${RULE.capMs / 1000}s at most; a value with more than ${RULE.noisyChanges} changes since load stops counting.`)
  lines.push(`"all" is every L: variable fsc-editor-link streams, plus the stock values below; "switches" is SETTLE_A in aircraft/lib/load.mjs plus the aircraft's settleL in aircraft/lib/aircraft.mjs.`)
  lines.push(`Stock values every frame: ${[...TIMELINE_A.map(([n]) => n), "CAMERA STATE"].join(", ")}.`)
  lines.push(`A value first seen after Fly, such as an L: variable registered during the load, counts as appeared, not changed.`)
  lines.push("")
  for (const r of run.results) {
    if (r.skipped) { lines.push(`${r.load.n} ${r.load.id}: skipped`, ""); continue }
    lines.push(`== ${r.load.n} ${r.load.id}, Flow Pro auto-click ${r.load.flowPro ? "on" : "off"}`)
    lines.push(`   loaded: ${r.title ?? "?"} (${r.path ?? "no AircraftLoaded path"})${r.matched === false ? "; NOT the asked-for aircraft" : ""}`)
    lines.push(`   Ready to fly pressed ${secs(r.readyMs)} after Fly; ${r.fps?.fps ? `${r.fps.fps.toFixed(1)} fps afterwards` : "no frame rate"}`)
    const mk = r.marked
    lines.push(`   by the sim's markers: ${mk.flyMs === null ? "no FlightLoaded" : `FlightLoaded ${secs(mk.flyMs)}`} and ${mk.readyMs === null ? "no RTC_END" : `RTC_END ${secs(mk.readyMs)}`} from the first press, so Ready ${mk.flyMs !== null && mk.readyMs !== null ? secs(mk.readyMs - mk.flyMs) : "?"} after Fly; ${plural(mk.reloads, "reload")} before it; recording from ${secs(mk.recordingFromMs)}`)
    lines.push(`   events from the first press: ${r.events.map((e) => `${secs(e.ms)} ${e.name}${e.data !== null && e.data !== undefined ? ` ${typeof e.data === "string" ? e.data.split("\\").slice(-2).join("\\") : e.data}` : ""}`).join("; ") || "none"}`)
    lines.push(`   ${r.moved} values moved, ${r.appeared} appeared${r.lastAppearedMs !== null ? ` (the last ${secs(r.lastAppearedMs)} after Fly)` : ""}; the L: table held ${r.lNames} names`)
    for (const v of r.verdicts) {
      for (const [set, x] of [["all", v.all], ["switches", v.switches]]) {
        lines.push(`   from ${v.from} (+${secs(v.t0Ms)}), ${set}: settled at ${secs(x.atMs)} by ${x.why}; ${x.counted} counted, ${x.excluded} noisy; ${x.late.length} moved after`)
        for (const l of x.late.slice(0, 25)) lines.push(`      late: ${l.name} at ${l.afterMs.map(secs).join(", ")}; ${fmt(l.first)} → ${fmt(l.last)}`)
        if (x.late.length > 25) lines.push(`      and ${x.late.length - 25} more in the NDJSON's load record`)
      }
    }
    if (r.writes) {
      for (const o of r.writes.order) lines.push(`   order, ${o.label}: second won ${o.secondWon}/${o.trials}, first ${o.firstWon}, neither ${o.neither}`)
      for (const s of r.writes.show) lines.push(`   show, ${s.label}: ${describeShow(s)}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------- main

async function finish(why) {
  if (run.finished) return
  run.finished = true
  rec.log("stop", why)
  // The records are scrubbed as they're made, and the report, built from the
  // results, is scrubbed here: the aircraft's path runs through the home folder.
  const text = scrub(report())
  rec.writeReport(text)
  console.log("\n" + text)
  console.log(`saved ${repoRelative(rec.files.txt)}`)
  console.log(`saved ${repoRelative(rec.files.ndjson)}`)
  try { await stream?.stop() } catch { /* closing anyway */ }
  try { link?.stop() } catch { /* closing anyway */ }
  try { sim?.close() } catch { /* already closed */ }
  await rec.close()
  process.exit(0)
}

async function main() {
  rec.open()
  rec.log("start", `${plural(loads.length, "load")}: ${loads.map((l) => `${l.n} ${l.id}${l.flowPro ? "" : " (Flow Pro off)"}`).join(", ")}`)
  process.on("SIGINT", () => { run.stopping = true; finish("interrupted") })
  keys = await startKeys()
  beep = startBeeper()
  say = startSpeaker()
  sim = await Sim.connect(rec, { name: "CROSSCHECK p01 guided load" })
  sim.track()
  sim.onLost((w) => { run.stopping = true; rec.log("stop", `stopping: ${w}`) })
  link = new Link(sim)
  let hello = null
  stream = link.stream({
    onHello: (h) => { hello = h; rec.log("link", `fsc-editor-link ${h.version}, protocol ${h.protocol}, ${h.count} L: names`) },
    onNames: (list) => { for (const { id, name } of list) names.set(id, `L:${name}`) },
    onValues,
  })
  startRecording()
  await sleep(5000)
  if (!hello) rec.log("warn", "fsc-editor-link didn't answer start in 5s, so only the stock values are recorded")

  for (const [i, load] of loads.entries()) {
    if (run.stopping || sim.gone) break
    run.results.push(await oneLoad(load, i + 1, loads.length, loads[i - 1] ?? null))
  }
  await finish(run.stopping ? "stopped" : "every load done")
}

main().catch(async (e) => {
  rec.log("error", e.stack ?? String(e))
  await finish(`failed: ${e.message}`)
})
