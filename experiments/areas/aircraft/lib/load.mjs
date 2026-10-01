/*
 * Loading a flight file and knowing when it's done: the gate and the settle
 * wait from our FlightLoad probe (experiments/areas/aircraft/p01-flight-load.mjs),
 * which passed three loads in 1.8 to 3.9s and settled them in 3 to 27s
 * (measured on MSFS 2024, 2026-10-01,
 * experiments/areas/aircraft/results/p01-flight-load-2026-10-01-17-29-57.txt).
 *
 * A load passes when, within the time limit, a load event has arrived (the flow
 * event FLT_LOADED, or the system event FlightLoaded or AircraftLoaded); TITLE,
 * the position to within 1,000m, and SIM ON GROUND then match the file; and the
 * Sim system state reads 1, the user in control. The title and position count
 * only when read after the first load event, so a value left from the flight
 * before can't pass the gate.
 *
 * The aircraft has settled when none of a set of switch and setting values has
 * changed for 10s, capped at 120s, and every readiness mark the aircraft has
 * (such as the Fenix's Fenix:Ready) reads ready. fsc-editor measured a Black
 * Square Bonanza's L: variables still arriving 35s after its load (fsc-editor,
 * docs/sim-vars/build/v1-log.md, "2026-08-27 — The settle rule did not fail
 * here, and one aircraft was two"), hence the cap.
 */

import { listPages } from "../../../tools/inspector.mjs"
import { distance } from "./flights.mjs"
import { secs, sleep, fmt } from "./out.mjs"

// Switches and settings that move while an aircraft loads its start state, and
// that we expect to stay put once it's at rest, engines running or not; unlike
// RPM or fuel, none of them drifts on its own.
export const SETTLE_A = [
  ["ELECTRICAL MASTER BATTERY:1", "bool"],
  ["AVIONICS MASTER SWITCH", "bool"],
  ["LIGHT BEACON", "bool"],
  ["LIGHT NAV", "bool"],
  ["LIGHT STROBE", "bool"],
  ["LIGHT LANDING", "bool"],
  ["BRAKE PARKING POSITION", "bool"],
  ["GENERAL ENG COMBUSTION:1", "bool"],
  ["FLAPS HANDLE INDEX", "number"],
  ["COM ACTIVE FREQUENCY:1", "MHz"],
  ["TRANSPONDER CODE:1", "number"],
]

const same = (a, b) => typeof a === "string" && typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase()

export const LOAD_TIMEOUT_MS = 180_000
export const POSITION_TOLERANCE_M = 1_000
const STALL_MS = 30_000

// The flight's load as a record: { passed, gateMs, met, missing, failed, stall, seen, t0, end }.
export async function loadFlight(sim, rec, flight, { n = 1, timeoutMs = LOAD_TIMEOUT_MS, eventGate = true, pages = true, stop = () => false, silent = false } = {}) {
  const live = sim.live
  const r = {
    n, flight, t0: Date.now(), from: live.sim === 1 ? "inside a flight" : live.sim === 0 ? "the UI (main menu)" : "an unknown state",
    met: {}, missing: [], passed: false, gateMs: null, failed: null, stall: null, pages: [], seen: null, sendId: null, end: null,
  }
  rec.log("load", `${n}: ${flight.rel}, ${flight.title} (${flight.livery ?? "no livery"}), ${flight.firstState ?? "no FirstFlightState"}${flight.departure ? ` at ${flight.departure}` : ""}, from ${r.from}`,
    { load: n, file: flight.rel, title: flight.title, livery: flight.livery, state: flight.firstState, from: r.from })
  r.sendId = sim.send(`FlightLoad ${flight.rel}`, () => sim.handle.flightLoad(flight.path))
  const quiet = silent ? silentWindow(sim, rec, r) : null
  const watcher = pages && !silent ? watchPages(rec, r) : { stop() {} }

  const conditions = () => {
    const signal = rec.timeline.find((e) => e.t >= r.t0 && e.signal)
    const after = !eventGate ? r.t0 : signal ? signal.t : Infinity
    return {
      signal: !eventGate || Boolean(signal),
      title: live.titleAt > after && same(live.title, flight.title),
      position: live.posAt > after && distance(live.lat, live.lon, flight.lat, flight.lon) <= POSITION_TOLERANCE_M,
      ground: live.posAt > after && live.onGround === flight.onGround,
      sim: live.sim === 1,
    }
  }
  // The aircraft matching the file by readings alone, with or without a load
  // event, which tells "loaded, but no event said so" from "nothing happened".
  const inPlace = () =>
    live.titleAt > r.t0 && same(live.title, flight.title) && live.posAt > r.t0 &&
    distance(live.lat, live.lon, flight.lat, flight.lon) <= POSITION_TOLERANCE_M && live.onGround === flight.onGround

  let c = conditions()
  let stallSince = null
  let refreshedAt = 0
  try {
    while (!sim.gone && !stop()) {
      const now = Date.now()
      c = conditions()
      if (quiet?.done()) quiet.end()
      if (c.signal && !c.title && !sim.silent && now - refreshedAt >= 2000) {
        refreshedAt = now
        sim.refreshTitle()
      }
      for (const [k, ok] of Object.entries(c)) {
        if (ok && r.met[k] === undefined) {
          r.met[k] = now - r.t0
          rec.log("gate", `${n}: ${k} met at ${secs(r.met[k])}`, { load: n, condition: k, ms: r.met[k] })
        }
      }
      const placed = inPlace()
      if (placed && r.met.inPlace === undefined) {
        r.met.inPlace = now - r.t0
        rec.log("gate", `${n}: the aircraft reads as the file's, by TITLE, position, and SIM ON GROUND, at ${secs(r.met.inPlace)}`, { load: n, condition: "inPlace", ms: r.met.inPlace })
      }
      if (Object.values(c).every(Boolean)) {
        r.passed = true
        r.gateMs = now - r.t0
        break
      }
      // The aircraft in place with the user still in the UI is how a flight
      // waiting on Ready to Fly, or on any dialog, would look from here.
      if (placed && !c.sim) {
        stallSince ??= now
        if (!r.stall && now - stallSince >= STALL_MS) {
          r.stall = { ms: now - r.t0, sim: live.sim }
          rec.log("stall", `${n}: the aircraft is in place, but Sim has read ${live.sim} for ${secs(now - stallSince)}, so the flight hasn't started`, { load: n, sim: live.sim })
        }
      } else {
        stallSince = null
      }
      if (now - r.t0 >= timeoutMs) break
      await sleep(250)
    }
    r.seen = {
      title: live.title, liveryFolder: live.liveryFolder, liveryName: live.liveryName,
      distanceM: distance(live.lat, live.lon, flight.lat, flight.lon), altFt: live.alt,
      onGround: live.onGround, sim: live.sim, pause: live.pause, aircraft: live.aircraft,
    }
    r.missing = Object.entries(c).filter(([, ok]) => !ok).map(([k]) => k)
    if (r.passed) {
      rec.log("pass", `${n}: passed at ${secs(r.gateMs)}; ${Math.round(r.seen.distanceM)} m from the file's position`, { load: n, ms: r.gateMs, distanceM: r.seen.distanceM })
    } else {
      r.failed = sim.gone ? `the connection was lost: ${sim.gone}` : stop() ? "stopped" : `timed out at ${timeoutMs / 1000}s`
      rec.log("fail", `${n}: ${r.failed}; not met: ${r.missing.join(", ")}`, { load: n, failed: r.failed, missing: r.missing })
    }
  } finally {
    watcher.stop()
    if (quiet) {
      while (!quiet.done() && !sim.gone && !stop()) await sleep(250)
      quiet.end()
      r.quiet = quiet.info()
    }
    r.end = Date.now()
  }
  return r
}

export const QUIET_AFTER_MS = 10_000
export const QUIET_CAP_MS = 90_000

// The silent load window: from the FlightLoad call until the flow event
// FLIGHT_START has passed and 10s more have gone by, at most 90s, the harness
// sends the sim nothing and only hears what it subscribed to before the load.
// Three crashes on 2026-10-01 each came 10 to 16s after a FlightLoad, around
// FLIGHT_START, while the harness polled the sim, and our FlightLoad probe,
// which polled less, never crashed (results/crashes.tsv); this tests whether
// the polling is the cause. Sim.send() refuses to send while it lasts.
function silentWindow(sim, rec, r) {
  let flightStartAt = null
  let ended = false
  const onFlow = (name) => { if (name === "FLIGHT_START" && flightStartAt === null) flightStartAt = Date.now() }
  sim.flowHandlers.add(onFlow)
  sim.silent = true
  rec.log("quiet", `${r.n}: sending nothing until FLIGHT_START and ${QUIET_AFTER_MS / 1000}s more, at most ${QUIET_CAP_MS / 1000}s`)
  return {
    done: () => Date.now() - r.t0 >= QUIET_CAP_MS || (flightStartAt !== null && Date.now() - flightStartAt >= QUIET_AFTER_MS),
    end() {
      if (ended) return
      ended = true
      sim.flowHandlers.delete(onFlow)
      sim.silent = false
      rec.log("quiet", `${r.n}: the silent window ended at ${secs(Date.now() - r.t0)}${flightStartAt === null ? ", without FLIGHT_START" : `, FLIGHT_START at ${secs(flightStartAt - r.t0)}`}`)
      sim.requestAll()
      sim.pollStates()
    },
    info: () => ({ ms: Date.now() - r.t0, flightStartMs: flightStartAt === null ? null : flightStartAt - r.t0 }),
  }
}

// The settle watch: every change of the settle values, from now. Started
// before a FlightLoad, it keeps hearing through the load's silent window,
// since a request on the user aircraft made before a load went on delivering
// after it (measured on MSFS 2024, 2026-10-01: TITLE arrived from the standing
// request 0.3s after a load, before any request was sent again,
// experiments/areas/aircraft/results/run-fenix-a320-family-2026-10-01-18-29-25.txt).
export function startSettle(sim, rec, { lVars = [], label = "settle" } = {}) {
  const vars = [...SETTLE_A, ...lVars.map((name) => [name, "number"])]
  const s = { vars, lVars, names: vars.map(([name]) => name), changes: new Map(), startedAt: Date.now(), lastChangeAt: Date.now(), last: null, w: null }
  s.w = sim.watch(vars, {
    period: "frame",
    label,
    onChange: (name, v, before) => {
      s.lastChangeAt = Date.now()
      s.last = name
      const count = (s.changes.get(name) ?? 0) + 1
      s.changes.set(name, count)
      if (count <= 5) rec.log("settle", before === undefined ? `${name} = ${fmt(v)}` : `${name} ${fmt(before)} → ${fmt(v)}`, { name, from: before ?? null, to: v })
      else if (count === 6) rec.log("settle", `${name} keeps changing; counted from here, not printed`, { name })
    },
  })
  return s
}

// Waits until none of the values changes for quietMs and every ready check
// passes, or capMs runs out. lVars are the aircraft's own marks; ready is
// [{ label, check: async () => ({ ok, value }) }]. With watch, from
// startSettle, it uses that watch; without, it starts one now.
export async function settle(sim, rec, { t0 = Date.now(), lVars = [], ready = [], quietMs = 10_000, capMs = 120_000, stop = () => false, label = "settle", watch = null } = {}) {
  const s = watch ?? startSettle(sim, rec, { lVars, label })
  const { vars, names, changes } = s
  lVars = s.lVars
  const startedAt = s.startedAt
  const w = s.w
  rec.log("settle", `watching ${vars.length} values, ${lVars.length} of them L:, until none changes for ${quietMs / 1000}s${ready.length ? `, and ${ready.map((x) => x.label).join(", ")}` : ""}`)

  const readyAt = new Map()
  const readyValue = new Map()
  let lastCheck = 0
  while (!sim.gone && !stop()) {
    const now = Date.now()
    if (ready.length && now - lastCheck >= 1000) {
      lastCheck = now
      for (const x of ready) {
        if (readyAt.has(x.label)) continue
        const res = await x.check()
        if (JSON.stringify(res.value) !== JSON.stringify(readyValue.get(x.label))) {
          readyValue.set(x.label, res.value)
          rec.log("settle", `${x.label} reads ${typeof res.value === "string" ? res.value : JSON.stringify(res.value)}${res.ok ? ", ready" : ""}`, { ready: x.label, value: res.value, ok: res.ok })
        }
        if (res.ok) readyAt.set(x.label, Date.now() - t0)
      }
    }
    const quiet = now - s.lastChangeAt >= quietMs
    if ((quiet && readyAt.size === ready.length) || now - startedAt >= capMs) break
    await sleep(250)
  }
  w.stop()
  const lastChangeAt = s.lastChangeAt
  const last = s.last

  const quiet = Date.now() - lastChangeAt >= quietMs
  const allReady = readyAt.size === ready.length
  const busiest = [...changes].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, k]) => `${name} ×${k}`)
  const result = {
    settled: quiet && allReady,
    quiet,
    ms: quiet ? Math.max(lastChangeAt - t0, ...readyAt.values()) : null,
    lastChangeMs: lastChangeAt - t0,
    last,
    answered: w.values.size,
    total: names.length,
    lAnswered: lVars.filter((name) => w.values.has(name)).length,
    lTotal: lVars.length,
    silent: names.filter((name) => !w.values.has(name)),
    busiest,
    ready: ready.map((x) => ({ label: x.label, ms: readyAt.get(x.label) ?? null, value: readyValue.get(x.label) ?? null })),
    values: Object.fromEntries(w.values),
  }
  rec.log("settle", result.settled
    ? `settled at ${secs(result.ms)} after the load request; the last change was ${last ?? "the first reading"}`
    : `not settled after ${secs(Date.now() - startedAt)}: ${!quiet ? `still changing: ${busiest.join(", ")}` : ""}${!allReady ? ` not ready: ${ready.filter((x) => !readyAt.has(x.label)).map((x) => x.label).join(", ")}` : ""}`,
    { ...result, values: undefined })
  return result
}

// Lists the inspector's documents every 10s while a load runs.
export function watchPages(rec, r, everyMs = 10_000) {
  let stopped = false
  let busy = false
  let lastOthers = null
  const tick = async () => {
    if (stopped || busy) return
    busy = true
    const t = Date.now()
    try {
      const pages = await listPages()
      const isPanel = (p) => /^VCockpit/i.test(String(p.title ?? ""))
      const others = pages.filter((p) => !isPanel(p)).map((p) => `${p.title || "(untitled)"} <${p.url ?? ""}>`)
      const panels = pages.length - others.length
      r.pages.push({ t, up: true, total: pages.length, panels })
      const changed = others.join("\n") !== lastOthers
      lastOthers = others.join("\n")
      rec.log("pages", `${r.n}: ${pages.length} documents, ${panels} VCockpit; others ${changed ? (others.length ? others.join(", ") : "none") : "as before"}`, { load: r.n, up: true, total: pages.length, panels, others })
    } catch (e) {
      r.pages.push({ t, up: false })
      rec.log("pages", `${r.n}: the inspector isn't answering on 127.0.0.1:19999`, { load: r.n, up: false, error: e.message.split("\n")[0] })
    } finally {
      busy = false
    }
  }
  tick()
  const timer = setInterval(tick, everyMs)
  return { stop() { stopped = true; clearInterval(timer) } }
}
