/*
 * One SimConnect connection, through node-simconnect 4.2.0, with the calls the
 * harness makes wrapped so each one is logged, labeled for its exceptions, and
 * answered by a promise where the sim answers at all.
 *
 *   const sim = await Sim.connect(rec)            rec is an out.mjs Recorder
 *   await sim.read([["PLANE ALTITUDE", "feet"], ["L:DATLoaded", "number"]])
 *   await sim.read(vars, { object: id })                         any object, not only the user's
 *   await sim.readStrings(["TITLE", "LIVERY NAME"])
 *   await sim.byType(5, 300)                                     object IDs of one type in a radius
 *   await sim.spawn(title, livery, initPos)                      an AI object's ID, or { error }
 *   await sim.burst([["COM STANDBY FREQUENCY:1", "Hz"]], 2000)  every sim frame
 *   sim.watch(vars, { onChange })                                changes, tagged
 *   sim.write("L:Battery1Switch", "number", 1)
 *   sim.transmit("K:XPNDR_SET", [0x4521], { priority: "highest" })
 *   sim.subscribeKeys(["K:XPNDR_SET"], { onEvent })
 *   await sim.inputEvents(); await sim.getInputEvent(hash); sim.setInputEvent(hash, 1)
 *   await sim.readClientData("Fenix:Ready", 8)
 *   await sim.state("AircraftLoaded")
 *   await sim.frameRate(10_000)
 *
 * Numeric reads are tagged, because SimConnect rejects a datum it doesn't know
 * after the call returns, and a positional read then shifts every later value
 * onto the wrong variable (fsc-editor, docs/sim-vars/build/v1-log.md,
 * "2026-08-23 — The `A:` read crashed the app. Positional reads were the wrong
 * shape."). A name that never answers is reported missing, not shifted.
 *
 * L: variables go through the same data definitions as A: variables, which our
 * FlightLoad probe measured for reads: 4 of 4 and 5 of 5 L: values returned
 * (measured on MSFS 2024, 2026-10-01,
 * experiments/areas/aircraft/results/p01-flight-load-2026-10-01-17-29-57.txt).
 * Writing an L: variable this way is unmeasured; link.mjs's calculator code is
 * the other route.
 */

import { createRequire } from "node:module"

import {
  ClientDataPeriod,
  DataRequestFlag,
  EventFlag,
  FlowEvent,
  Protocol,
  RawBuffer,
  SimConnectConstants,
  SimConnectDataType,
  SimConnectPeriod,
  open,
} from "node-simconnect"

import { distance as haversine } from "./flights.mjs"
import { fmt, sleep } from "./out.mjs"

export const NODE_SIMCONNECT = createRequire(import.meta.url)("node-simconnect/package.json").version
const USER = SimConnectConstants.OBJECT_ID_USER

// MSFS 2024 SDK, SimConnect.h: SIMCONNECT_GROUP_PRIORITY_*.
export const PRIORITY = {
  highest: 1,
  highest_maskable: 10_000_000,
  standard: 1_900_000_000,
  default: 2_000_000_000,
  lowest: 4_000_000_000,
}

// Put in the fifth parameter of every K: event the harness sends, unless the
// caller fills all five, so the harness can tell its own events from the
// aircraft's when they come back on its own subscription. The sim passes the
// fifth parameter on to subscribers (measured on MSFS 2024, 2026-10-01,
// record/areas/flight-controls/log.md, "2026-10-01: A value sent back at
// 10,000,001 reached our own masking group, and the 777 ignored re-sent
// values"). subscribeKeys also matches each arrival against the sends
// by name, value, and time, and says which of the two recognized it.
export const TAG = 0x43524f53 // "CROS"

// The system events our FlightLoad probe subscribed to, and nothing more, are
// what a connection subscribes to when it opens; subscribeExtras() adds the
// rest once a load's silent window is over (run.mjs, the fresh connection).
export const SYSTEM_EVENTS = [
  "FlightLoaded", "AircraftLoaded", "SimStart", "SimStop", "Sim", "Pause_EX1", "Crashed",
  "View", "PositionChanged",
]
export const EXTRA_EVENTS = ["FlightSaved"]
const FRAME_EVENT = 40
const EXTRA_BASE = 50
const systemName = (id) => SYSTEM_EVENTS[id - 1] ?? EXTRA_EVENTS[id - EXTRA_BASE] ?? null

// MSFS 2024 SDK, SimConnect_SubscribeToSystemEvent: Pause_EX1's flags, and View's
// from SimConnect.h, SIMCONNECT_VIEW_SYSTEM_EVENT_DATA.
export function describeSystemEvent(name, data) {
  const flags = (names) => names.filter(([bit]) => data & bit).map(([, n]) => n).join(" + ") || "none"
  if (name === "Sim") return `${data} (${data === 1 ? "running" : "not running"})`
  if (name === "Pause_EX1") return `${data} (${flags([[1, "full pause"], [2, "pause with sound"], [4, "active pause"], [8, "sim pause"]])})`
  if (name === "View") return `${data} (${flags([[1, "cockpit 2D"], [2, "cockpit virtual"], [4, "map"]])})`
  return String(data)
}

const parseVar = (v) => {
  if (Array.isArray(v)) return { name: v[0], units: v[1] ?? null, type: v[2] ?? (v[1] === null ? "string" : "number") }
  if (typeof v === "string") return { name: v, units: "number", type: "number" }
  return { name: v.name, units: v.units ?? null, type: v.type ?? (v.units == null ? "string" : "number") }
}

// SimConnect wants the bare name for K: events: "XPNDR_SET", not "K:XPNDR_SET".
const eventName = (name) => name.replace(/^K:/i, "")

const u32 = (v) => (Math.trunc(Number(v)) >>> 0)
const i32 = (v) => v | 0

export class Sim {
  static async connect(rec, { name = "CROSSCHECK harness", port = null } = {}) {
    let opened
    try {
      opened = await open(name, Protocol.SunRise, port ? { host: "127.0.0.1", port } : undefined)
    } catch (e) {
      const why = e instanceof AggregateError ? e.errors.map((x) => x.message).join("; ") : e.message
      throw new Error(
        `could not connect to SimConnect: ${why}\n` +
        "Is MSFS 2024 running? node-simconnect finds the sim through the registry once the sim\n" +
        "has started; --port <n> tries a static port from SimConnect.xml instead.")
    }
    return new Sim(rec, opened.handle, opened.recvOpen)
  }

  constructor(rec, handle, recvOpen) {
    this.rec = rec
    this.handle = handle
    this.recvOpen = recvOpen
    this.gone = null
    this.sent = new Map()
    this.lostListeners = new Set()
    this.ids = { def: 100, req: 1000, event: 1000, group: 10, cdata: 100, cdef: 50_000 }
    this.pending = new Map() // requestID → { resolve, reject?, onData }
    this.bySend = new Map() // sendId → requestID, so an exception can fail its request
    this.defs = new Map() // key → { id, vars }
    this.events = new Map() // bare event name → client event id
    this.eventNames = new Map() // client event id → bare event name
    this.keyWatchers = new Set()
    this.sends = [] // K: events this client sent, for recognizing them on the way back
    this.inputWatchers = new Set()
    this.inputParams = new Map() // hash string → resolve
    this.clientData = new Map() // area name → client data id
    this.systemHandlers = new Set()
    this.flowHandlers = new Set()
    this.live = {
      sim: null, pause: null, flight: null, aircraft: null, aircraftAt: 0,
      title: null, titleAt: 0, liveryFolder: null, liveryName: null,
      lat: null, lon: null, alt: null, onGround: null, posAt: 0, loggedLat: null, loggedLon: null,
    }

    const o = recvOpen
    const appVersion = [o.applicationVersionMajor, o.applicationVersionMinor, o.applicationBuildMajor, o.applicationBuildMinor].join(".")
    const scVersion = [o.simConnectVersionMajor, o.simConnectVersionMinor, o.simConnectBuildMajor, o.simConnectBuildMinor].join(".")
    this.version = `${o.applicationName} ${appVersion}, SimConnect ${scVersion}`
    rec.log("open", this.version, { app: o.applicationName, appVersion, simConnectVersion: scVersion, nodeSimconnect: NODE_SIMCONNECT })

    const h = handle
    h.on("exception", (e) => this.onException(e))
    h.on("event", (e) => this.onEvent(e.clientEventId, [e.data, 0, 0, 0, 0], false, e.groupID))
    h.on("eventEx1", (e) => this.onEvent(e.clientEventId, e.data, true, e.groupID))
    h.on("eventFilename", (e) => this.onFilename(e))
    h.on("eventFrame", (e) => this.onFrame?.(e))
    h.on("flowEvent", (e) => this.onFlow(e))
    h.on("systemState", (s) => this.answer(s.requestID, s))
    h.on("simObjectData", (d) => this.answer(d.requestID, d))
    h.on("simObjectDataByType", (d) => this.answer(d.requestID, d))
    h.on("assignedObjectID", (a) => this.answer(a.requestID, a))
    h.on("clientData", (d) => this.answer(d.requestID, d))
    h.on("inputEventsList", (l) => this.answer(l.requestID, l))
    h.on("getInputEvent", (g) => this.answer(g.requestID, g))
    h.on("subscribeInputEvent", (s) => this.onInputEvent(s))
    h.on("enumerateInputEventParams", (p) => {
      const key = String(p.inputEventIdHash)
      const fn = this.inputParams.get(key)
      if (fn) { this.inputParams.delete(key); fn(p.value) }
    })
    h.on("enumerateSimobjectAndLiveryList", (l) => this.answer(l.requestID, l))
    h.on("quit", () => this.lost("the sim quit"))
    h.on("close", () => this.lost("the SimConnect connection closed"))
    h.on("error", (e) => this.lost(`SimConnect error: ${e.message}`))

    SYSTEM_EVENTS.forEach((n, i) => this.send(`subscribe ${n}`, () => h.subscribeToSystemEvent(i + 1, n)))
    this.send("subscribe flow events", () => h.subscribeToFlowEvent())
  }

  // ---------------------------------------------------------------- plumbing

  // Returns the packet's send ID, which the sim's exceptions refer to.
  send(label, call) {
    if (this.gone) throw new Error(`not connected: ${this.gone}`)
    // lib/load.mjs, silentWindow: during a load's silent window nothing goes
    // to the sim, and a send that tries is logged, so a leak shows.
    if (this.silent) {
      this.rec.log("held", `${label}: not sent, inside a silent load window`, { label })
      return null
    }
    try {
      call()
    } catch (e) {
      this.rec.log("error", `${label} threw: ${e.message}`)
      return null
    }
    const id = this.handle.getLastSentPacketID()
    this.sent.set(id, label)
    if (this.sent.size > 20_000) this.sent.delete(this.sent.keys().next().value)
    return id
  }

  onException(e) {
    const what = this.sent.get(e.sendId) ?? `send ${e.sendId}`
    this.rec.log("exception", `${e.exceptionName} (${e.exception}) on ${what}, parameter ${e.index}`, {
      exception: e.exception, name: e.exceptionName, sendId: e.sendId, index: e.index, sent: what,
    })
    const req = this.bySend.get(e.sendId)
    const p = req !== undefined ? this.pending.get(req) : null
    if (p?.fail) p.fail(`${e.exceptionName} on ${what}`)
  }

  onLost(fn) {
    this.lostListeners.add(fn)
    return () => this.lostListeners.delete(fn)
  }

  lost(why) {
    if (this.gone) return
    this.gone = why
    clearInterval(this.pollTimer)
    clearTimeout(this.requestTimer)
    this.rec.log("lost", why)
    for (const [, p] of this.pending) p.fail?.(`connection lost: ${why}`)
    for (const fn of this.lostListeners) {
      try { fn(why) } catch { /* each listener gets its chance */ }
    }
  }

  close() {
    clearInterval(this.pollTimer)
    clearTimeout(this.requestTimer)
    if (!this.gone) this.gone = "closed by the harness"
    try { this.handle.close() } catch { /* already closed */ }
  }

  answer(requestID, data) {
    const p = this.pending.get(requestID)
    if (p) p.onData(data)
  }

  // A request that the sim answers once, or never: the promise resolves with
  // what the handler returns, or with { timedOut } or { error }.
  ask(label, timeoutMs, start, onData) {
    const req = this.ids.req++
    return new Promise((resolve) => {
      const done = (v) => {
        clearTimeout(timer)
        this.pending.delete(req)
        resolve(v)
      }
      const timer = setTimeout(() => done({ timedOut: true }), timeoutMs)
      this.pending.set(req, {
        onData: (d) => { const v = onData(d); if (v !== undefined) done(v) },
        fail: (why) => done({ error: why }),
      })
      if (this.gone) return done({ error: `not connected: ${this.gone}` })
      const sendId = this.send(label, () => start(req))
      if (sendId === null) done({ error: this.silent ? `${label}: held, inside a silent load window` : `${label} threw` })
      else this.bySend.set(sendId, req)
    })
  }

  // ---------------------------------------------------------------- variables

  // One data definition per distinct list, reused, so a read repeated 240 times
  // in a timeline defines its variables once.
  define(vars, key = null) {
    const list = vars.map(parseVar)
    const k = key ?? JSON.stringify(list.map((v) => [v.name, v.units, v.type]))
    const had = this.defs.get(k)
    if (had) return had
    const id = this.ids.def++
    list.forEach((v, i) => {
      const type = v.type === "string" ? SimConnectDataType.STRING256 : SimConnectDataType.FLOAT64
      this.send(`define ${v.name}${v.units ? ` (${v.units})` : ""}`, () => this.handle.addToDataDefinition(id, v.name, v.type === "string" ? null : v.units, type, 0, i))
    })
    const def = { id, vars: list }
    this.defs.set(k, def)
    return def
  }

  static readTagged(d, def) {
    const values = new Map()
    for (let i = 0; i < d.defineCount && d.data.remaining() >= 4; i++) {
      const id = d.data.readInt32()
      const v = def.vars[id]
      if (!v) break
      if (v.type === "string") {
        if (d.data.remaining() < 256) break
        values.set(v.name, d.data.readString256())
      } else {
        if (d.data.remaining() < 8) break
        values.set(v.name, d.data.readFloat64())
      }
    }
    return values
  }

  // Values for the user aircraft, or for `object`, once: a Map of name → value,
  // and the names that didn't answer.
  async read(vars, { timeoutMs = 3000, label = null, object = USER } = {}) {
    const def = this.define(vars)
    const r = await this.ask(label ?? `read ${def.vars.length} values${object === USER ? "" : ` on object ${object}`}`, timeoutMs,
      (req) => this.handle.requestDataOnSimObject(req, def.id, object, SimConnectPeriod.ONCE, DataRequestFlag.DATA_REQUEST_FLAG_TAGGED),
      (d) => Sim.readTagged(d, def))
    const values = r instanceof Map ? r : new Map()
    return Object.assign(values, {
      missing: def.vars.map((v) => v.name).filter((n) => !values.has(n)),
      error: r instanceof Map ? null : r.error ?? (r.timedOut ? "timed out" : null),
    })
  }

  async readOne(name, units = "number", opts = {}) {
    const values = await this.read([[name, units]], opts)
    return values.has(name) ? values.get(name) : null
  }

  async readStrings(names, opts = {}) {
    return this.read(names.map((n) => [n, null, "string"]), opts)
  }

  // Changes, as SimConnect reports them, until stop(): period "frame" (sim
  // frame), "visual", or "second". onChange gets (name, value, before, t).
  watch(vars, { period = "frame", changed = true, onChange = null, onData = null, label = "watch", object = USER } = {}) {
    const def = this.define(vars)
    const req = this.ids.req++
    const values = new Map()
    const per = { frame: SimConnectPeriod.SIM_FRAME, visual: SimConnectPeriod.VISUAL_FRAME, second: SimConnectPeriod.SECOND }[period]
    this.pending.set(req, {
      onData: (d) => {
        const t = Date.now()
        const got = Sim.readTagged(d, def)
        onData?.(got, t)
        for (const [name, v] of got) {
          const had = values.has(name)
          const before = values.get(name)
          values.set(name, v)
          if (!had || before !== v) onChange?.(name, v, had ? before : undefined, t)
        }
      },
    })
    const flags = DataRequestFlag.DATA_REQUEST_FLAG_TAGGED | (changed ? DataRequestFlag.DATA_REQUEST_FLAG_CHANGED : 0)
    const sendId = this.send(`${label}: request ${def.vars.length} values every ${period}`, () => this.handle.requestDataOnSimObject(req, def.id, object, per, flags))
    if (sendId !== null) this.bySend.set(sendId, req)
    return {
      values,
      stop: () => {
        this.pending.delete(req)
        if (!this.gone) this.send(`${label}: stop`, () => this.handle.requestDataOnSimObject(req, def.id, object, SimConnectPeriod.NEVER, DataRequestFlag.DATA_REQUEST_FLAG_DEFAULT))
      },
    }
  }

  // Every sim frame's values for ms milliseconds: [{ t, values: { name: value } }].
  async burst(vars, ms, { label = "burst" } = {}) {
    const samples = []
    const w = this.watch(vars, { period: "frame", changed: false, label, onData: (got, t) => samples.push({ t, values: Object.fromEntries(got) }) })
    await sleep(ms)
    w.stop()
    return samples
  }

  // Waits until test(value) holds for a variable, polling every pollMs; returns
  // { ok, value, ms }.
  async waitFor(name, units, test, { timeoutMs = 10_000, pollMs = 100 } = {}) {
    const t0 = Date.now()
    let value = null
    while (!this.gone && Date.now() - t0 < timeoutMs) {
      value = await this.readOne(name, units)
      if (test(value)) return { ok: true, value, ms: Date.now() - t0 }
      await sleep(pollMs)
    }
    return { ok: false, value, ms: Date.now() - t0 }
  }

  write(name, units, value, { label = null } = {}) {
    const def = this.define([[name, units, "number"]], `write:${name}:${units}`)
    const buffer = new RawBuffer(8)
    buffer.writeFloat64(Number(value))
    this.rec.log("write", `${name} ← ${fmt(value)}${units && units !== "number" ? ` ${units}` : ""}`, { name, units, value })
    return this.send(label ?? `write ${name} = ${value}`, () => this.handle.setDataOnSimObject(def.id, USER, { buffer, arrayCount: 0, tagged: false }))
  }

  // Several numeric values in one write, to `object`. Positional, so every name
  // has to be one the sim accepts: a rejected name shifts the values after it.
  // quiet keeps a write per frame off the console.
  set(vars, values, { object = USER, label = null, quiet = false } = {}) {
    const def = this.define(vars.map((v) => [parseVar(v).name, parseVar(v).units, "number"]))
    const buffer = new RawBuffer(8 * values.length)
    for (const v of values) buffer.writeFloat64(Number(v))
    const text = `${def.vars.map((v, i) => `${v.name} ← ${fmt(values[i])}`).join(", ")}${object === USER ? "" : ` on object ${object}`}`
    if (quiet) this.rec.data("write", text, { object, values })
    else this.rec.log("write", text, { object, values })
    return this.send(label ?? `set ${def.vars.length} values on object ${object}`, () => this.handle.setDataOnSimObject(def.id, object, { buffer, arrayCount: 0, tagged: false }))
  }

  // ---------------------------------------------------------------- K: events

  event(name) {
    const bare = eventName(name)
    let id = this.events.get(bare)
    if (id !== undefined) return id
    id = this.ids.event++
    this.events.set(bare, id)
    this.eventNames.set(id, bare)
    this.send(`map K:${bare}`, () => this.handle.mapClientEventToSimEvent(id, bare))
    return id
  }

  // Sends a K: event to the user aircraft. priority is a PRIORITY key or a
  // number; the sim hands the event to notification groups from that priority
  // down (MSFS 2024 SDK, SimConnect_TransmitClientEvent_EX1,
  // SIMCONNECT_EVENT_FLAG_GROUPID_IS_PRIORITY).
  transmit(name, values = [], { priority = "highest", tag = true, quiet = false, object = USER } = {}) {
    const bare = eventName(name)
    const id = this.event(bare)
    const data = [0, 0, 0, 0, 0]
    values.slice(0, 5).forEach((v, i) => { data[i] = Number(v) })
    const tagged = tag && values.length < 5
    if (tagged) data[4] = TAG
    const pr = typeof priority === "number" ? priority : PRIORITY[priority]
    if (pr === undefined) throw new Error(`unknown priority ${priority}`)
    const t = Date.now()
    const sendId = this.send(`K:${bare} ${values.join(" ")}`, () =>
      this.handle.transmitClientEventEx(object, id, pr, EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY, ...data.map(u32)))
    this.sends.push({ name: bare, data: data.map(u32), t, matched: false })
    if (this.sends.length > 500) this.sends.shift()
    const text = `K:${bare} ${values.map(fmt).join(" ")} at priority ${typeof priority === "number" ? priority : priority}${tagged ? ", tagged" : ""}${object === USER ? "" : ` to object ${object}`}`
    if (quiet) this.rec.data("send", text, { event: bare, values, priority: pr, tagged })
    else this.rec.log("send", text, { event: bare, values, priority: pr, tagged })
    return sendId
  }

  // Subscribes to K: events as they pass through the sim. At the default,
  // priority "highest" and not maskable, the harness hears an event before any
  // aircraft module can mask it.
  //
  // Three things measured on MSFS 2024 on 2026-10-01 shape this
  // (experiments/areas/aircraft/results/run-a2a-pa24-comanche-2026-10-01-17-59-48.txt
  // and p02-key-event-ids-2026-10-01-18-07-51.txt):
  //   - A client event belongs to one notification group at a time: adding the
  //     transmit ID to a second group moved it out of the first, and removing
  //     it from the first then failed with UNRECOGNIZED_ID. So each
  //     subscription maps client event IDs of its own.
  //   - With several client event IDs mapped to one sim event, every group
  //     hears the event under the most recently mapped ID. So arrivals are
  //     routed by event name and group, not by ID.
  //   - removeClientEvent on one ID took the sim event's other groups with it:
  //     they heard nothing more, and a send through the latest ID failed with
  //     ERROR. So stop() only stops listening, and the group stays.
  subscribeKeys(names, { priority = "highest", maskable = false, onEvent = null, quiet = false } = {}) {
    const group = this.ids.group++
    const pr = typeof priority === "number" ? priority : PRIORITY[priority]
    const bare = names.map(eventName)
    for (const name of bare) {
      const id = this.ids.event++
      this.eventNames.set(id, name)
      this.send(`map K:${name} for group ${group}`, () => this.handle.mapClientEventToSimEvent(id, name))
      this.send(`add K:${name} to group ${group}`, () => this.handle.addClientEventToNotificationGroup(group, id, maskable))
    }
    this.send(`group ${group} priority ${pr}`, () => this.handle.setNotificationGroupPriority(group, pr))
    const watcher = { group, names: new Set(bare), onEvent, quiet }
    this.keyWatchers.add(watcher)
    return { stop: () => this.keyWatchers.delete(watcher) }
  }

  onEvent(clientEventId, data, ex1, groupID) {
    if (systemName(clientEventId) || clientEventId === FRAME_EVENT) return this.onSystem(clientEventId, data[0])
    const name = this.eventNames.get(clientEventId)
    if (!name) return
    const t = Date.now()
    const tagged = ex1 && data[4] === TAG
    const sent = this.sends.find((s) => !s.matched && s.name === name && s.data[0] === data[0] && t - s.t < 2000)
    if (sent) sent.matched = true
    const ours = tagged ? "tag" : sent ? "match" : null
    const e = { name, data: data.map(i32), value: i32(data[0]), ex1, ours, t, group: groupID }
    for (const w of this.keyWatchers) {
      if (!w.names.has(name) || w.group !== groupID) continue
      const text = `K:${name} ${e.value}${ex1 ? ` [${e.data.slice(1).join(" ")}]` : ""}${ours ? `, ours (by ${ours})` : ", not ours"}`
      if (w.quiet) this.rec.data("key", text, { event: name, data: e.data, ex1, ours })
      else this.rec.log("key", text, { event: name, data: e.data, ex1, ours })
      try { w.onEvent?.(e) } catch (err) { this.rec.log("error", `key handler threw: ${err.message}`) }
    }
  }

  // ---------------------------------------------------------------- system

  subscribeExtras() {
    EXTRA_EVENTS.forEach((n, i) => this.send(`subscribe ${n}`, () => this.handle.subscribeToSystemEvent(EXTRA_BASE + i, n)))
  }

  onSystem(clientEventId, data) {
    const name = systemName(clientEventId)
    if (!name) return
    if (name === "Sim") this.live.sim = data
    if (name === "Pause_EX1") this.live.pause = data
    this.rec.log("system", `${name} ${describeSystemEvent(name, data)}`, { event: name, data })
    if (name === "SimStart") this.scheduleRequests()
    for (const fn of this.systemHandlers) fn(name, data)
  }

  onFilename(e) {
    const name = systemName(e.clientEventId)
    if (!name) return
    if (name === "FlightLoaded") this.live.flight = e.fileName
    if (name === "AircraftLoaded") { this.live.aircraft = e.fileName; this.live.aircraftAt = Date.now() }
    this.rec.log("system", `${name} ${e.fileName}`, { event: name, file: e.fileName, signal: name !== "FlightSaved" })
    if (name !== "FlightSaved") this.scheduleRequests()
    for (const fn of this.systemHandlers) fn(name, e.fileName)
  }

  onFlow(e) {
    const name = FlowEvent[e.flowEventID] ?? `flow event ${e.flowEventID}`
    this.rec.log("flow", `${name}${e.fltPath ? ` ${e.fltPath}` : ""}`, { flow: name, id: e.flowEventID, file: e.fltPath, signal: name === "FLT_LOADED" })
    if (["FLT_LOADED", "FLIGHT_START", "TELEPORT_DONE"].includes(name)) this.scheduleRequests()
    for (const fn of this.flowHandlers) fn(name, e.fltPath)
  }

  // MSFS 2024 SDK, SimConnect_RequestSystemState: AircraftLoaded, DialogMode,
  // FlightLoaded, FlightPlan, Sim.
  async state(name, { timeoutMs = 3000 } = {}) {
    const r = await this.ask(`state ${name}`, timeoutMs,
      (req) => this.handle.requestSystemState(req, name),
      (s) => ({ integer: s.dataInteger, float: s.dataFloat, string: s.dataString }))
    return r
  }

  // Titles and livery names the sim knows, for SimObjectType AIRCRAFT (2).
  async liveries({ type = 2, timeoutMs = 20_000 } = {}) {
    const c = collector((l) => l.simobjectLiveries.map((x) => ({ title: x.aircraftTitle, livery: x.liveryName })))
    const r = await this.ask("enumerate sim objects and liveries", timeoutMs,
      (req) => this.handle.enumerateSimObjectsAndLiveries(req, type),
      (l) => c.add(l))
    return Array.isArray(r) ? r : Object.assign(c.list, { error: r.error ?? "timed out" })
  }

  // ---------------------------------------------------------------- AI objects

  // The IDs of the objects of one SIMCONNECT_SIMOBJECT_TYPE within radiusM
  // meters (MSFS 2024 SDK, SimConnect_RequestDataOnSimObjectType). The sim sends
  // one reply per object, each counting the total in dwOutOf, and with no
  // object it may send none, so a timeout ends the list too. The reply is
  // positional, so the definition holds one variable every object has.
  async byType(type, radiusM, { timeoutMs = 3000 } = {}) {
    const def = this.define([["PLANE LATITUDE", "degrees"]], "byType")
    const ids = []
    const r = await this.ask(`objects of type ${type} within ${radiusM}m`, timeoutMs,
      (req) => this.handle.requestDataOnSimObjectType(req, def.id, radiusM, type),
      (d) => {
        if (d.outOf === 0) return ids
        ids.push(d.objectID)
        return ids.length >= d.outOf ? ids : undefined
      })
    return Array.isArray(r) ? r : Object.assign(ids, { error: r.error ?? null, timedOut: Boolean(r.timedOut) })
  }

  // A non-aircraft object, through SimConnect_AICreateSimulatedObject_EX1:
  // { id } once the sim assigns one, or { error }.
  async spawn(title, livery, initPos, { timeoutMs = 5000 } = {}) {
    const r = await this.ask(`create ${JSON.stringify(title)}`, timeoutMs,
      (req) => this.handle.aICreateSimulatedObjectEx1(title, livery, initPos, req),
      (a) => ({ id: a.objectID }))
    return r.id !== undefined ? r : { error: r.error ?? (r.timedOut ? "timed out" : "no reply") }
  }

  // Neither call has a reply; a failure arrives as an exception.
  release(id) {
    return this.send(`release object ${id}`, () => this.handle.aIReleaseControl(id, this.ids.req++))
  }

  remove(id) {
    return this.send(`remove object ${id}`, () => this.handle.aIRemoveObject(id, this.ids.req++))
  }

  // ---------------------------------------------------------------- tracking

  // The standing requests a load gate needs: position every second, TITLE and
  // the livery when they change, and the Sim, FlightLoaded, and AircraftLoaded
  // states every 2s. It logs each change, as our FlightLoad probe did.
  track() {
    if (this.tracking) return
    this.tracking = true
    this.posDef = this.define([["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["SIM ON GROUND", "bool"]], "track:pos")
    this.strDefs = ["TITLE", "LIVERY FOLDER", "LIVERY NAME"].map((n) => [n, this.define([[n, null, "string"]], `track:${n}`)])
    this.trackReqs = { pos: this.ids.req++, strings: this.strDefs.map(() => this.ids.req++) }
    this.pending.set(this.trackReqs.pos, { onData: (d) => this.onPosition(Sim.readTagged(d, this.posDef)) })
    this.strDefs.forEach(([n, def], i) => this.pending.set(this.trackReqs.strings[i], { onData: (d) => this.onString(n, Sim.readTagged(d, def).get(n)) }))
    this.requestAll()
    this.pollStates()
    this.pollTimer = setInterval(() => this.pollStates(), 2000)
  }

  // Sent again after every load event, because whether a request on the user
  // aircraft survives an aircraft change on MSFS 2024 isn't in our records.
  // fsc-editor sends its request again under the same ID in the same way
  // (fsc-editor, src/main/sim/session.ts, defineWatch).
  requestAll() {
    if (this.gone || !this.tracking || this.silent) return
    const h = this.handle
    this.send("track position", () => h.requestDataOnSimObject(this.trackReqs.pos, this.posDef.id, USER, SimConnectPeriod.SECOND, DataRequestFlag.DATA_REQUEST_FLAG_TAGGED))
    this.strDefs.forEach(([n, def], i) =>
      this.send(`track ${n}`, () => h.requestDataOnSimObject(this.trackReqs.strings[i], def.id, USER, SimConnectPeriod.SECOND, DataRequestFlag.DATA_REQUEST_FLAG_CHANGED | DataRequestFlag.DATA_REQUEST_FLAG_TAGGED)))
  }

  scheduleRequests() {
    clearTimeout(this.requestTimer)
    this.requestTimer = setTimeout(() => this.requestAll(), 500)
  }

  async pollStates() {
    if (this.gone || this.silent) return
    for (const [key, name] of [["sim", "Sim"], ["flight", "FlightLoaded"], ["aircraft", "AircraftLoaded"]]) {
      if (this.silent) return
      const s = await this.state(name)
      if (s.timedOut || s.error) continue
      const value = key === "sim" ? s.integer : s.string
      if (this.live[key] === value) continue
      // A loaded flight or aircraft that changes here, with no event for it,
      // still counts as a load event; the first reading only says where the sim
      // started.
      const signal = key !== "sim" && this.live[key] !== null
      this.live[key] = value
      if (key === "aircraft") this.live.aircraftAt = Date.now()
      this.rec.log("state", key === "sim" ? `Sim state ${value} (${value === 1 ? "user in control" : "user in the UI"})` : `${name} state ${value || "(empty)"}`, { [key]: value, signal })
    }
  }

  onPosition(values) {
    const now = Date.now()
    const l = this.live
    if (values.has("PLANE LATITUDE")) l.lat = values.get("PLANE LATITUDE")
    if (values.has("PLANE LONGITUDE")) l.lon = values.get("PLANE LONGITUDE")
    if (values.has("PLANE ALTITUDE")) l.alt = values.get("PLANE ALTITUDE")
    if (values.has("SIM ON GROUND")) {
      const v = values.get("SIM ON GROUND")
      if (l.onGround !== null && l.onGround !== v) this.rec.log("state", `SIM ON GROUND ${l.onGround} → ${v}`, { onGround: v })
      l.onGround = v
    }
    l.posAt = now
    const moved = l.loggedLat === null || haversine(l.lat, l.lon, l.loggedLat, l.loggedLon) > 100
    if (l.lat !== null && moved) {
      l.loggedLat = l.lat
      l.loggedLon = l.lon
      this.rec.log("state", `position ${l.lat.toFixed(6)}, ${l.lon.toFixed(6)}, ${Math.round(l.alt)} ft, on ground ${l.onGround}`, { lat: l.lat, lon: l.lon, altFt: l.alt, onGround: l.onGround })
    }
  }

  // TITLE once, for a load that keeps the aircraft: the standing request sends
  // TITLE only when it changes, so after reloading the same aircraft nothing
  // new arrives, and a gate waiting for a fresh TITLE would wait forever
  // (measured on MSFS 2024, 2026-10-01,
  // experiments/areas/aircraft/results/run-a2a-pa24-comanche-2026-10-01-18-12-09.txt).
  async refreshTitle() {
    const v = await this.readStrings(["TITLE"], { timeoutMs: 1500, label: "read TITLE" })
    if (v.has("TITLE")) this.onString("TITLE", v.get("TITLE"))
  }

  onString(name, value) {
    if (value === undefined) return
    const key = { TITLE: "title", "LIVERY FOLDER": "liveryFolder", "LIVERY NAME": "liveryName" }[name]
    if (key === "title") this.live.titleAt = Date.now()
    if (this.live[key] === value) return
    this.live[key] = value
    this.rec.log("state", `${name} ${JSON.stringify(value)}`, { [key]: value })
  }

  // ---------------------------------------------------------------- input events

  // [{ name, hash, type }] for the loaded aircraft. Hashes are reassigned when
  // the aircraft changes (fsc-editor, src/main/sim/session.ts, aircraftChanged),
  // so enumerate again after every load.
  async inputEvents({ timeoutMs = 15_000 } = {}) {
    const c = collector((l) => l.inputEventDescriptors.map((d) => ({ name: d.name, hash: d.inputEventIdHash, type: d.type === 1 ? "string" : "double" })))
    const r = await this.ask("enumerate input events", timeoutMs,
      (req) => this.handle.enumerateInputEvents(req),
      (l) => c.add(l))
    return Array.isArray(r) ? r : Object.assign(c.list, { error: r.error ?? "timed out" })
  }

  inputEventParams(hash, { timeoutMs = 3000 } = {}) {
    return new Promise((resolve) => {
      const key = String(hash)
      const timer = setTimeout(() => { this.inputParams.delete(key); resolve(null) }, timeoutMs)
      this.inputParams.set(key, (v) => { clearTimeout(timer); resolve(v) })
      this.send(`input event params ${key}`, () => this.handle.enumerateInputEventParams(BigInt(hash)))
    })
  }

  async getInputEvent(hash, { timeoutMs = 3000 } = {}) {
    const r = await this.ask(`get input event ${hash}`, timeoutMs,
      (req) => this.handle.getInputEvent(req, BigInt(hash)),
      (g) => ({ value: g.value }))
    return r.value !== undefined ? r.value : null
  }

  setInputEvent(hash, value, { name = null } = {}) {
    this.rec.log("write", `input event ${name ?? hash} ← ${fmt(value)}`, { inputEvent: name, hash: String(hash), value })
    return this.send(`set input event ${name ?? hash} = ${value}`, () => this.handle.setInputEvent(BigInt(hash), value))
  }

  // onEvent gets { hash, value, t }; names are the caller's to keep.
  subscribeInputEvents(hashes, onEvent) {
    const watcher = { hashes: new Set(hashes.map(String)), onEvent }
    this.inputWatchers.add(watcher)
    for (const h of hashes) this.send(`subscribe input event ${h}`, () => this.handle.subscribeInputEvent(BigInt(h)))
    return {
      stop: () => {
        this.inputWatchers.delete(watcher)
        if (this.gone) return
        for (const h of hashes) this.send(`unsubscribe input event ${h}`, () => this.handle.unsubscribeInputEvent(BigInt(h)))
      },
    }
  }

  onInputEvent(s) {
    const key = String(s.inputEventIdHash)
    const t = Date.now()
    for (const w of this.inputWatchers) {
      if (w.hashes.has(key)) {
        try { w.onEvent({ hash: key, value: s.value, t }) } catch (err) { this.rec.log("error", `input event handler threw: ${err.message}`) }
      }
    }
  }

  // ---------------------------------------------------------------- client data

  clientDataId(name) {
    let id = this.clientData.get(name)
    if (id !== undefined) return id
    id = this.ids.cdata++
    this.clientData.set(name, id)
    this.send(`map client data ${name}`, () => this.handle.mapClientDataNameToID(name, id))
    return id
  }

  // The area's first `size` bytes, once, as a Buffer; null with .error when the
  // area doesn't exist or doesn't answer.
  clientDataDef(name, offset, size) {
    const key = `cdef:${name}:${offset}:${size}`
    let def = this.defs.get(key)
    if (def) return def.id
    def = { id: this.ids.cdef++ }
    this.defs.set(key, def)
    this.send(`define client data ${name} ${offset}+${size}`, () => this.handle.addToClientDataDefinition(def.id, offset, size))
    return def.id
  }

  async readClientData(name, size, { timeoutMs = 3000, offset = 0 } = {}) {
    const id = this.clientDataId(name)
    const def = this.clientDataDef(name, offset, size)
    const r = await this.ask(`read client data ${name}`, timeoutMs,
      (req) => this.handle.requestClientData(id, req, def, ClientDataPeriod.ONCE, 0),
      (d) => ({ bytes: d.data.readBytes(Math.min(size, d.data.remaining())) }))
    if (r.bytes) return r.bytes
    return Object.assign(Buffer.alloc(0), { error: r.error ?? "timed out", missing: true })
  }

  // Every write to the area, until stop(): onData(bytes, t).
  watchClientData(name, size, onData, { offset = 0 } = {}) {
    const id = this.clientDataId(name)
    const def = this.clientDataDef(name, offset, size)
    const req = this.ids.req++
    this.pending.set(req, { onData: (d) => onData(d.data.readBytes(Math.min(size, d.data.remaining())), Date.now()) })
    const sendId = this.send(`watch client data ${name}`, () => this.handle.requestClientData(id, req, def, ClientDataPeriod.ON_SET, 0))
    if (sendId !== null) this.bySend.set(sendId, req)
    return {
      stop: () => {
        this.pending.delete(req)
        if (!this.gone) this.send(`stop client data ${name}`, () => this.handle.requestClientData(id, req, def, ClientDataPeriod.NEVER, 0))
      },
      write: (bytes) => this.send(`write client data ${name}`, () => this.handle.setClientData(id, def, 0, 0, bytes.length, bytes)),
    }
  }

  // ---------------------------------------------------------------- frame rate

  // Counts the deliveries of a one-value request at period SIM_FRAME, which the
  // sim sends once per sim frame, and the Frame system event's own frame rate
  // beside it (MSFS 2024 SDK, SimConnect_SubscribeToSystemEvent, Frame).
  async frameRate(ms = 10_000) {
    const times = []
    const frameEvents = []
    this.onFrame = (e) => { if (e.clientEventId === FRAME_EVENT) frameEvents.push(e.frameRate) }
    this.send("subscribe Frame", () => this.handle.subscribeToSystemEvent(FRAME_EVENT, "Frame"))
    const w = this.watch([["SIMULATION TIME", "seconds"]], { period: "frame", changed: false, label: "frame rate", onData: (got, t) => times.push(t) })
    await sleep(ms)
    w.stop()
    if (!this.gone) this.send("unsubscribe Frame", () => this.handle.unsubscribeFromSystemEvent(FRAME_EVENT))
    this.onFrame = null
    const gaps = times.slice(1).map((t, i) => t - times[i])
    const span = times.length > 1 ? times[times.length - 1] - times[0] : 0
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
    return {
      windowMs: ms,
      deliveries: times.length,
      fps: span > 0 ? (times.length - 1) / (span / 1000) : null,
      maxGapMs: gaps.length ? Math.max(...gaps) : null,
      frameEventFps: mean(frameEvents),
      frameEvents: frameEvents.length,
    }
  }
}

// A list reply is complete when every packet has arrived: dwEntryNumber counts
// packets from 0 to dwOutOf - 1 (MSFS 2024 SDK, SimConnect.h,
// SIMCONNECT_RECV_LIST_TEMPLATE).
function collector(take) {
  const seen = new Set()
  const list = []
  return {
    list,
    add(l) {
      for (const x of take(l)) list.push(x)
      seen.add(l.entryNumber)
      return seen.size >= l.outOf ? list : undefined
    },
  }
}
