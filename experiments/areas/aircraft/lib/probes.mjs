/*
 * The generic probes every aircraft gets at every load: identity and
 * configuration, input events with their types, the inspector's panels and
 * gauges, a settle timeline, the frame rate, and the stock radio events.
 *
 * Each takes the runner's context ({ sim, rec, aircraft, state, ... }) and
 * returns a result the report summarizes; the bulk of each one goes into the
 * NDJSON, record by record.
 */

import * as panels from "./panels.mjs"
import { SETTLE_A } from "./load.mjs"
import { fmt, plural, secs, sleep } from "./out.mjs"

// ---------------------------------------------------------------- identity

const ID_STRINGS = ["TITLE", "ATC TYPE", "ATC MODEL", "ATC ID", "ATC AIRLINE", "ATC FLIGHT NUMBER", "LIVERY FOLDER", "LIVERY NAME", "CATEGORY"]
const ID_NUMBERS = [
  ["NUMBER OF ENGINES", "number"],
  ["ENGINE TYPE", "enum"],
  ["ATC HEAVY", "bool"],
  ["FLAPS NUM HANDLE POSITIONS", "number"],
  ["FLAPS HANDLE INDEX", "number"],
  ["FLAPS HANDLE PERCENT", "percent"],
  ["TRAILING EDGE FLAPS LEFT ANGLE", "degrees"],
  ["EMPTY WEIGHT", "pounds"],
  ["TOTAL WEIGHT", "pounds"],
  ["MAX GROSS WEIGHT", "pounds"],
  ["FUEL TOTAL CAPACITY", "gallons"],
  ["FUEL TOTAL QUANTITY", "gallons"],
  ["FUEL TOTAL QUANTITY WEIGHT", "pounds"],
  ["PAYLOAD STATION COUNT", "number"],
  ["DESIGN SPEED VC", "knots"],
]

export async function identity(ctx) {
  const { sim, rec, aircraft } = ctx
  const strings = await sim.readStrings(ID_STRINGS)
  const numbers = await sim.read([...ID_NUMBERS, ...(aircraft.identityL ?? []).map((n) => [n, "number"])])
  const loaded = await sim.state("AircraftLoaded")
  const flight = await sim.state("FlightLoaded")
  const out = {
    strings: Object.fromEntries(strings),
    numbers: Object.fromEntries(numbers),
    missing: [...strings.missing, ...numbers.missing],
    aircraftLoaded: loaded.string ?? null,
    flightLoaded: flight.string ?? null,
  }
  rec.log("identity", `TITLE ${JSON.stringify(out.strings.TITLE)}; ATC TYPE ${JSON.stringify(out.strings["ATC TYPE"])}, MODEL ${JSON.stringify(out.strings["ATC MODEL"])}, ID ${JSON.stringify(out.strings["ATC ID"])}; livery ${JSON.stringify(out.strings["LIVERY FOLDER"])} / ${JSON.stringify(out.strings["LIVERY NAME"])}`, { strings: out.strings })
  rec.log("identity", `AircraftLoaded ${out.aircraftLoaded}`, { aircraftLoaded: out.aircraftLoaded, flightLoaded: out.flightLoaded })
  rec.log("identity", Object.entries(out.numbers).map(([k, v]) => `${k} ${fmt(v)}`).join("; "), { numbers: out.numbers, missing: out.missing })
  return out
}

// ---------------------------------------------------------------- input events

// Every input event with its descriptor type, its parameter string, and its
// value now. fsc-editor found all 464 of the A220's declared DOUBLE, with
// ";FLOAT64" parameters, and that subscribing gives no first value
// (fsc-editor, docs/sim-vars/build/v1-log.md, "2026-09-04 — The `B:`
// subscription is a change feed; the entry below was wrong").
export async function inputEvents(ctx) {
  const { sim, rec } = ctx
  const t0 = Date.now()
  const list = await sim.inputEvents()
  if (list.error) rec.log("inputs", `enumeration incomplete: ${list.error}; ${list.length} so far`)
  const params = await Promise.all(list.map((e) => sim.inputEventParams(e.hash)))
  const values = await Promise.all(list.map((e) => sim.getInputEvent(e.hash)))
  const events = list.map((e, i) => ({ name: e.name, hash: String(e.hash), type: e.type, params: params[i], value: values[i] }))
  for (const e of events) rec.data("inputEvent", `${e.name} ${e.type} ${e.params ?? "(no params)"} = ${fmt(e.value)}`, e)
  const types = {}
  for (const e of events) types[e.type] = (types[e.type] ?? 0) + 1
  const paramKinds = {}
  for (const e of events) paramKinds[e.params ?? "(none)"] = (paramKinds[e.params ?? "(none)"] ?? 0) + 1
  const out = { count: events.length, types, paramKinds, ms: Date.now() - t0, error: list.error ?? null, events }
  rec.log("inputs", `${plural(events.length, "input event")} in ${secs(out.ms)}; types ${JSON.stringify(types)}; parameters ${JSON.stringify(paramKinds)}`, { count: out.count, types, paramKinds })
  ctx.inputEvents = new Map(events.map((e) => [e.name, e]))
  return out
}

// ---------------------------------------------------------------- panels

export async function panelInventory(ctx) {
  const { rec } = ctx
  const t0 = Date.now()
  let pages
  try {
    pages = await panels.inventory()
  } catch (e) {
    rec.log("panels", `the inspector isn't answering: ${e.message.split("\n")[0]}`)
    return { error: e.message.split("\n")[0], pages: [] }
  }
  // A WASM gauge's element is a wasm-instrument whose url names the module and
  // the gauge, such as ?wasm_module=Gauge/TDSGTNXiGaugeModule.wasm&wasm_gauge=GTNXI650U2
  // (measured on MSFS 2024, 2026-10-01, the PA-24's panels).
  const gaugeName = (g) => {
    const m = /wasm_module=([^&]+)&wasm_gauge=([^&]+)/.exec(g.attrs?.url ?? "")
    return m ? `${m[1]}:${m[2]}` : g.ident ?? g.attrs?.url ?? g.tag
  }
  for (const p of pages) {
    const gauges = p.gauges ? p.gauges.map(gaugeName).join(", ") : p.error ? `error: ${p.error}` : ""
    rec.data("panel", `${p.id} ${p.title}${gauges ? `: ${gauges}` : ""}`, p)
  }
  const vc = pages.filter((p) => p.panel)
  const gaugeCount = vc.reduce((n, p) => n + (p.gauges?.length ?? 0), 0)
  rec.log("panels", `${plural(pages.length, "document")}, ${vc.length} VCockpit with ${plural(gaugeCount, "gauge")}, in ${secs(Date.now() - t0)}; others: ${pages.filter((p) => !p.panel).map((p) => p.title || "(untitled)").join(", ") || "none"}`, { documents: pages.length, panels: vc.length, gauges: gaugeCount })
  return { pages }
}

// ---------------------------------------------------------------- timeline

export const TIMELINE_A = [
  ...SETTLE_A,
  ["LIGHT TAXI", "bool"],
  ["GENERAL ENG COMBUSTION:2", "bool"],
  ["GENERAL ENG COMBUSTION:3", "bool"],
  ["GENERAL ENG COMBUSTION:4", "bool"],
  ["GENERAL ENG RPM:1", "rpm"],
  ["TURB ENG N1:1", "percent"],
  ["GEAR HANDLE POSITION", "bool"],
  ["COM STANDBY FREQUENCY:1", "MHz"],
  ["NAV ACTIVE FREQUENCY:1", "MHz"],
  ["FUEL TOTAL QUANTITY", "gallons"],
  ["ELECTRICAL MAIN BUS VOLTAGE", "volts"],
  ["APU PCT RPM", "percent over 100"],
  ["EXTERNAL POWER ON:1", "bool"],
  ["SIM ON GROUND", "bool"],
  ["GROUND VELOCITY", "knots"],
]

// Samples every value 4 times a second. It's one standing request, every sim
// frame, kept to one sample per 250ms here, so that started before a FlightLoad
// it samples through the load's silent window without sending anything
// (lib/load.mjs, silentWindow). begin(t0) sets the moment the samples are
// timed from, the load gate passing, and ends the timeline durationMs later.
// The report gives each value's first and last reading and when it last moved;
// a negative time is before the gate passed.
export function startTimeline(ctx, { durationMs = 60_000, everyMs = 250 } = {}) {
  const { sim, rec, aircraft } = ctx
  const vars = [...TIMELINE_A, ...(aircraft.settleL ?? []).map((n) => [n, "number"]), ...(aircraft.timelineL ?? []).map((n) => [n, "number"])]
  const seen = new Map()
  const stats = new Map()
  const startedAt = Date.now()
  let t0 = null
  let samples = 0
  let lastSample = 0
  let finish
  const done = new Promise((resolve) => { finish = resolve })
  const rel = (t) => (t0 === null ? t - startedAt : t - t0)
  const end = (why) => {
    if (!w) return
    w.stop()
    w = null
    const out = { samples, everyMs, durationMs, why, timedFrom: t0 === null ? "the request" : "the gate", stats: {}, silent: vars.map(([n]) => n).filter((n) => !stats.has(n)) }
    for (const [name, s] of stats) out.stats[name] = { first: s.first, firstMs: rel(s.firstT), last: s.last, changes: s.changes, lastChangeMs: s.lastChangeT === null ? null : rel(s.lastChangeT) }
    const moved = Object.entries(out.stats).filter(([, s]) => s.changes > 0)
    rec.log("timeline", `${samples} samples; ${moved.length} of ${stats.size} values moved: ${moved.map(([n, s]) => `${n} ×${s.changes} (last ${s.lastChangeMs < 0 ? "-" : "+"}${secs(Math.abs(s.lastChangeMs))})`).join(", ") || "none"}`, { samples, moved: moved.length, answered: stats.size, total: vars.length })
    finish(out)
  }
  let w = sim.watch(vars, {
    period: "frame",
    changed: false,
    label: "timeline",
    onData: (got, t) => {
      if (t - lastSample < everyMs) return
      lastSample = t
      samples++
      for (const [name, v] of got) {
        const s = stats.get(name) ?? { first: v, firstT: t, last: v, changes: 0, lastChangeT: null }
        if (seen.has(name) && seen.get(name) !== v) {
          s.changes++
          s.lastChangeT = t
          if (s.changes <= 8) rec.data("timeline", `${rel(t) < 0 ? "-" : "+"}${secs(Math.abs(rel(t)))} ${name} ${fmt(seen.get(name))} → ${fmt(v)}`, { name, from: seen.get(name), to: v, ms: rel(t) })
        }
        s.last = v
        stats.set(name, s)
        seen.set(name, v)
      }
      if (t0 !== null && t - t0 >= durationMs) end("done")
    },
  })
  rec.log("timeline", `sampling ${vars.length} values every ${everyMs}ms, ${durationMs / 1000}s from the gate`)
  return {
    done,
    begin(at) { t0 = at },
    stop: (why = "stopped") => end(why),
  }
}
// ---------------------------------------------------------------- frame rate

export async function frameRate(ctx, ms = 10_000) {
  const { sim, rec } = ctx
  const r = await sim.frameRate(ms)
  rec.log("fps", `${r.fps === null ? "no" : r.fps.toFixed(1)} sim frames a second over ${ms / 1000}s (${r.deliveries} SIM_FRAME deliveries, longest gap ${r.maxGapMs}ms); the Frame event says ${r.frameEventFps === null ? "nothing" : `${r.frameEventFps.toFixed(1)} fps`}`, r)
  return r
}

// ---------------------------------------------------------------- radios

// Values chosen to be valid at both 25 kHz and 8.33 kHz spacing, and unlike
// any start state we've seen. XPNDR_SET takes the code as BCD16, while
// TRANSPONDER CODE:1 in units "number" reads the code's digits as a decimal
// number: 0x4521 sent read 4521, and in units "Bco16" read 17697 (measured on
// MSFS 2024, 2026-10-01, experiments/areas/aircraft/results/
// run-a2a-pa24-comanche-2026-10-01-18-03-55.txt and -17-59-48.txt).
export const RADIO_TESTS = [
  { event: "K:COM_STBY_RADIO_SET_HZ", value: 122_800_000, read: ["COM STANDBY FREQUENCY:1", "Hz"], expect: 122_800_000, ownKey: "comStandby" },
  { event: "K:COM_RADIO_SET_HZ", value: 123_450_000, read: ["COM ACTIVE FREQUENCY:1", "Hz"], expect: 123_450_000, ownKey: "comActive" },
  { event: "K:NAV1_RADIO_SET_HZ", value: 110_500_000, read: ["NAV ACTIVE FREQUENCY:1", "Hz"], expect: 110_500_000, ownKey: "navActive" },
  { event: "K:XPNDR_SET", value: 0x4521, read: ["TRANSPONDER CODE:1", "number"], expect: 4521, ownKey: "xpdr", bcd: true },
]

// Sends each stock radio event at the highest priority, watches the stock
// variable and the aircraft's own every frame for 2s, then puts the stock
// value back the same way.
export async function radios(ctx, { holdMs = 2000 } = {}) {
  const { sim, rec, aircraft } = ctx
  const own = aircraft.radios ?? {}
  const results = []
  const keys = sim.subscribeKeys(RADIO_TESTS.map((t) => t.event), { priority: "highest" })
  try {
    for (const t of RADIO_TESTS) {
      const ownVars = (own[t.ownKey] ?? []).map((v) => (Array.isArray(v) ? v : [v, "number"]))
      const vars = [t.read, ...ownVars]
      const before = await sim.read(vars)
      const echoes = []
      const k = sim.subscribeKeys([t.event], { priority: "highest", quiet: true, onEvent: (e) => echoes.push(e) })
      const t0 = Date.now()
      sim.transmit(t.event, [t.value])
      const samples = await sim.burst(vars, holdMs, { label: `radio ${t.event}` })
      k.stop()
      const series = (name) => samples.map((s) => s.values[name]).filter((v) => v !== undefined)
      const stock = series(t.read[0])
      const firstHit = samples.find((s) => s.values[t.read[0]] === t.expect)
      const final = stock.length ? stock[stock.length - 1] : null
      const ownSeries = Object.fromEntries(ownVars.map(([n]) => [n, { before: before.get(n) ?? null, after: series(n).at(-1) ?? null, values: [...new Set(series(n))].slice(0, 8) }]))
      const r = {
        event: t.event, sent: t.value, variable: t.read[0], before: before.get(t.read[0]) ?? null,
        final, held: final === t.expect, reachedMs: firstHit ? firstHit.t - t0 : null,
        distinct: [...new Set(stock)].slice(0, 8), frames: samples.length, own: ownSeries,
        echoes: echoes.map((e) => ({ value: e.value, ours: e.ours, ex1: e.ex1, ms: e.t - t0 })),
      }
      const verdict = r.held ? `held at ${fmt(final)}` : firstHit ? `reached ${fmt(t.expect)} at +${r.reachedMs}ms, then ${fmt(final)}` : `never read ${fmt(t.expect)}; ${fmt(final)}`
      rec.log("radio", `${t.event} ${t.value}: ${t.read[0]} ${fmt(r.before)} → ${verdict}; ${echoes.length} echo(es) ${echoes.map((e) => e.ours ?? "not ours").join(", ")}` +
        (ownVars.length ? `; own: ${Object.entries(ownSeries).map(([n, s]) => `${n} ${fmt(s.before)} → ${fmt(s.after)}`).join(", ")}` : ""), r)
      results.push(r)
    }
  } finally {
    keys.stop()
  }
  // Puts the stock values back, so a test after this one starts from the
  // aircraft's own state.
  for (const r of results) {
    if (r.before === null || r.before === r.final) continue
    const t = RADIO_TESTS.find((x) => x.event === r.event)
    const value = t.bcd ? parseInt(String(Math.round(r.before)), 16) : Math.round(r.before)
    if (Number.isFinite(value)) sim.transmit(r.event, [value], { quiet: true })
  }
  await sleep(500)
  return results
}
