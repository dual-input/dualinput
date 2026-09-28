/*
 * p02: what state reaches panel JavaScript over the CommBus, and how it moves.
 *
 * 1. Lists every name each panel's listeners registered, read from
 *    ViewListener.g_ViewListenersMgr (p01 found that this reaches names registered
 *    before any probe attached).
 * 2. Adds a CommBus listener of our own in the panels, one subscription per
 *    CommBus name, in a panel that already registered it.
 * 3. Streams what changes: every change to a field that changes now and then,
 *    and a sample every 10s of fields that change continuously. The A220's
 *    messages carry only what changed, so a field is known only once it moves,
 *    or once the aircraft sends it for another reason.
 *
 * Saves to experiments/areas/commbus/results/: a report, every change as NDJSON, the
 * first message on each channel, and each channel's state at the end, which is
 * every field seen with its last value. Payloads can carry what the pilot typed
 * into the EFB, so read them before committing.
 *
 * It adds listeners and wraps nothing, so the aircraft's own handlers run as
 * before. Coherent calls a name's handlers in a loop with no try/catch, so ours
 * catches everything, or a throw would stop the handlers after it.
 *
 * To stop it: Ctrl+C here, or window.CROSSCHECK_P02_STOP() in a panel. Each
 * panel also stops on its own when this process stops polling for 20s, or after
 * --minutes plus one.
 *
 *   node experiments/areas/commbus/p02-commbus-watch.mjs [--minutes 10] [--show <text>]
 *
 * --show prints only changes whose channel or field contains <text>; the files
 * get everything regardless.
 */

import { createWriteStream, writeFileSync } from "node:fs"

import { listPages, Inspector } from "../../tools/inspector.mjs"
import { resultFile, repoRelative, stamp } from "../../tools/results.mjs"

const args = process.argv.slice(2)
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const MINUTES = Number(flag("minutes", 10))
const SHOW = (flag("show", "") || "").toLowerCase()
const POLL_MS = 300
const STATUS_MS = 10000
const WARMUP_MS = 8000
const COMM_BUS = "JS_LISTENER_COMM_BUS"
const INTERNAL = "ON_EVENT_TO_ALL_SUBSCRIBERS"

// Runs in the panel: Chrome 49. Returns names only, and skips our own listener.
const INVENTORY = `
(function () {
  var out = {}
  var h = ViewListener.g_ViewListenersMgr.m_hash
  Object.keys(h).forEach(function (type) {
    var arr = (h[type] && h[type].array) || []
    out[type] = arr.filter(function (l) { return l && !l.CROSSCHECK_P02 }).map(function (l) {
      var names = []
      if (l.eventHandlers && l.eventHandlers.forEach) l.eventHandlers.forEach(function (entry, key) { names.push(key) })
      return { ctor: l.constructor && l.constructor.name, names: names }
    })
  })
  return out
})()`

// Runs in the panel: Chrome 49. Called with the names to watch and the minutes
// to live.
const WATCH = `
function (names, minutes) {
  if (typeof window.CROSSCHECK_P02_STOP === "function") { try { window.CROSSCHECK_P02_STOP() } catch (e) {} }

  var MAX_ARRAY = 64, MAX_FIELDS = 4000, MAX_SAMPLE = 60000
  var CONT_CHANGES = 4, CONT_WINDOW = 5000, CONT_SAMPLE = 10000
  var s = {
    changes: [], firsts: [], counts: {}, bytes: {}, errors: 0, lastError: "",
    lastRaw: {}, last: {}, times: {}, continuous: {}, sampledAt: {},
    lastDrain: Date.now(), deadline: Date.now() + (minutes + 1) * 60000
  }

  function flatten(v, path, out, depth) {
    if (out.n >= MAX_FIELDS) return
    if (v === null || typeof v !== "object") { out.map[path] = v; out.n++; return }
    if (depth > 8) { out.map[path] = "(deeper)"; out.n++; return }
    if (Array.isArray(v)) {
      if (v.length > MAX_ARRAY) { out.map[path + ".length"] = v.length; out.n++; return }
      if (!v.length) { out.map[path] = "[]"; out.n++; return }
      for (var i = 0; i < v.length; i++) flatten(v[i], path + "[" + i + "]", out, depth + 1)
      return
    }
    var keys = Object.keys(v)
    if (!keys.length) { out.map[path] = "{}"; out.n++; return }
    for (var k = 0; k < keys.length; k++) flatten(v[keys[k]], path ? path + "." + keys[k] : keys[k], out, depth + 1)
  }

  function onMessage(name, arg, argc) {
    try {
      var now = Date.now()
      var raw = typeof arg === "string" ? arg : JSON.stringify(arg)
      if (raw === undefined) raw = String(arg)
      s.counts[name] = (s.counts[name] || 0) + 1
      s.bytes[name] = (s.bytes[name] || 0) + raw.length
      if (raw === s.lastRaw[name]) return
      s.lastRaw[name] = raw

      var parsed
      try { parsed = JSON.parse(raw) } catch (e) { parsed = { "(not JSON)": raw.length > 200 ? raw.slice(0, 200) : raw } }
      var out = { map: {}, n: 0 }
      flatten(parsed, "", out, 0)
      // The A220 sends changes, not snapshots: a message carries only the fields
      // that moved, and "{}" when nothing did. So merge each message into the
      // channel's state, and a field missing from a message hasn't gone anywhere.
      var st = s.last[name]
      if (!st) {
        st = s.last[name] = {}
        s.firsts.push({ t: now, name: name, argc: argc, bytes: raw.length, fields: out.n, raw: raw.length > MAX_SAMPLE ? raw.slice(0, MAX_SAMPLE) : raw })
      }
      if (out.map[""] === "{}") return
      for (var p in out.map) {
        var seen = Object.prototype.hasOwnProperty.call(st, p)
        var a = st[p], b = out.map[p]
        st[p] = b
        if (!seen) { s.changes.push({ t: now, name: name, path: p, kind: "new", to: b }); continue }
        if (a === b) continue
        var key = name + "|" + p
        var t = s.times[key] || (s.times[key] = [])
        t.push(now)
        while (t.length && now - t[0] > CONT_WINDOW) t.shift()
        if (!s.continuous[key] && t.length >= CONT_CHANGES) {
          s.continuous[key] = true
          s.sampledAt[key] = now
          s.changes.push({ t: now, name: name, path: p, kind: "continuous" })
          continue
        }
        if (s.continuous[key]) {
          if (now - s.sampledAt[key] >= CONT_SAMPLE) { s.sampledAt[key] = now; s.changes.push({ t: now, name: name, path: p, kind: "sample", to: b }) }
          continue
        }
        s.changes.push({ t: now, name: name, path: p, kind: "change", from: a, to: b })
      }
    } catch (e) {
      s.errors++
      s.lastError = String(e)
    }
  }

  var listener = RegisterCommBusListener(function () {})
  listener.CROSSCHECK_P02 = true
  names.forEach(function (n) {
    listener.on(n, function () { onMessage(n, arguments[0], arguments.length) })
  })

  var timer = setInterval(function () {
    var now = Date.now()
    if (now > s.deadline || now - s.lastDrain > 20000) window.CROSSCHECK_P02_STOP()
  }, 2000)

  window.CROSSCHECK_P02 = {
    drain: function () {
      s.lastDrain = Date.now()
      var r = { changes: s.changes, firsts: s.firsts, counts: s.counts, bytes: s.bytes, errors: s.errors, lastError: s.lastError }
      s.changes = []; s.firsts = []; s.counts = {}; s.bytes = {}
      return r
    },
    state: function () { return s.last }
  }
  window.CROSSCHECK_P02_STOP = function () {
    clearInterval(timer)
    try { listener.unregister() } catch (e) {}
    window.CROSSCHECK_P02 = undefined
    window.CROSSCHECK_P02_STOP = function () { return "not running" }
    return "stopped"
  }
  return names.length
}`

const when = stamp()
const reportFile = resultFile("commbus", "p02-commbus-watch", "txt", when)
const streamFile = resultFile("commbus", "p02-commbus-watch", "ndjson", when)
const firstsFile = resultFile("commbus", "p02-commbus-watch-first-messages", "json", when)
const stateFile = resultFile("commbus", "p02-commbus-watch-state", "json", when)
const stream = createWriteStream(streamFile)
const report = []
const note = (s = "") => { report.push(s); console.log(s) }

const clock = (t) => new Date(t).toTimeString().slice(0, 8) + "." + String(t % 1000).padStart(3, "0")
function show(v) {
  if (typeof v === "number" && !Number.isInteger(v)) return String(Math.round(v * 10000) / 10000)
  const s = typeof v === "string" ? JSON.stringify(v) : String(v)
  return s.length > 60 ? s.slice(0, 57) + "…" : s
}

async function main() {
  const panels = (await listPages()).filter((p) => /^VCockpit/i.test(String(p.title || "")))
  const started = Date.now()
  note(`p02 · CommBus names and traffic in panel JavaScript`)
  note(`${new Date(started).toISOString()}, ${panels.length} panels, watching for ${MINUTES} minutes`)

  // 1. Inventory.
  const insps = new Map()
  const inventory = []
  for (const p of panels) {
    const insp = new Inspector(p.id)
    await insp.open()
    insps.set(p.id, insp)
    await insp.evaluate(`typeof window.CROSSCHECK_P02_STOP === "function" ? window.CROSSCHECK_P02_STOP() : "none"`)
    inventory.push({ page: p, types: await insp.evaluate(INVENTORY) })
  }

  note()
  note("1 · Names each panel's listeners registered")
  const commBusBy = new Map()
  for (const { page, types } of inventory) {
    note(`  ${String(page.id).padStart(3)}  ${page.title}`)
    for (const [type, listeners] of Object.entries(types)) {
      const names = [...new Set(listeners.flatMap((l) => l.names))].filter((n) => n !== INTERNAL).sort()
      if (!names.length) continue
      note(`       ${type} (${listeners.map((l) => l.ctor).join(", ")}): ${names.length}`)
      for (const n of names) note(`         ${n}`)
      if (type === COMM_BUS) commBusBy.set(page.id, names)
    }
  }

  // 2. One subscription per name, in the panel that registered the most names
  // among those that registered it.
  const order = [...commBusBy.entries()].sort((a, b) => b[1].length - a[1].length)
  const host = new Map()
  for (const [id, names] of order) for (const n of names) if (!host.has(n)) host.set(n, id)
  const byPanel = new Map()
  for (const [n, id] of host) {
    if (!byPanel.has(id)) byPanel.set(id, [])
    byPanel.get(id).push(n)
  }
  note()
  note(`2 · Watching ${host.size} CommBus names from ${byPanel.size} panels`)
  for (const [id, names] of byPanel) {
    await insps.get(id).evaluate(`(${WATCH})(${JSON.stringify(names)}, ${MINUTES})`)
    note(`  ${String(id).padStart(3)}  ${names.length} names`)
  }
  for (const [id, insp] of insps) if (!byPanel.has(id)) { insp.close(); insps.delete(id) }

  console.log(`\nLive: changes to fields that change now and then. Fields that change`)
  console.log(`continuously are counted, and sampled every 10s into the file.`)
  console.log(`Printing starts after ${WARMUP_MS / 1000}s, once fields are sorted. Ctrl+C to stop.\n`)

  // 3. Poll.
  const totals = new Map()
  const firsts = {}
  const continuous = new Set()
  const changedFields = new Map()
  let windowMsgs = 0, windowStart = Date.now(), lastStatus = Date.now(), errors = 0, lastError = ""
  let stopping = false

  const entry = (n) => {
    if (!totals.has(n)) totals.set(n, { msgs: 0, bytes: 0, first: 0, last: 0 })
    return totals.get(n)
  }

  async function pollOnce() {
    const lines = []
    await Promise.all([...byPanel.keys()].map(async (id) => {
      let r
      try {
        r = await insps.get(id).evaluate(`window.CROSSCHECK_P02 ? window.CROSSCHECK_P02.drain() : null`)
      } catch (e) {
        lastError = `panel ${id}: ${e.message}`
        return
      }
      if (!r) { lastError = `panel ${id}: watcher gone (panel reloaded, or its deadman fired)`; return }
      errors += r.errors
      if (r.lastError) lastError = `panel ${id}: ${r.lastError}`
      for (const [n, c] of Object.entries(r.counts)) {
        const e = entry(n)
        e.msgs += c; e.bytes += r.bytes[n] || 0
        e.last = Date.now(); if (!e.first) e.first = e.last
        windowMsgs += c
      }
      for (const f of r.firsts) {
        firsts[f.name] = { panel: id, t: f.t, argc: f.argc, bytes: f.bytes, fields: f.fields, raw: f.raw }
        stream.write(JSON.stringify({ t: f.t, kind: "first", name: f.name, panel: id, argc: f.argc, bytes: f.bytes, fields: f.fields }) + "\n")
        if (!SHOW || f.name.toLowerCase().includes(SHOW)) {
          lines.push([f.t, `${clock(f.t)}  + ${f.name}  first message, ${f.bytes} bytes`])
        }
      }
      for (const c of r.changes) {
        stream.write(JSON.stringify({ ...c, panel: id }) + "\n")
        const key = `${c.name}|${c.path}`
        if (c.kind === "continuous") { continuous.add(key); continue }
        if (c.kind === "sample") continue
        if (c.kind === "change") changedFields.set(key, (changedFields.get(key) || 0) + 1)
        if (c.t - started < WARMUP_MS) continue
        if (SHOW && !key.toLowerCase().includes(SHOW)) continue
        const what = c.kind === "new" ? `new: ${show(c.to)}` : `${show(c.from)} → ${show(c.to)}`
        lines.push([c.t, `${clock(c.t)}    ${c.name}  ${c.path || "(whole message)"}  ${what}`])
      }
    }))
    lines.sort((a, b) => a[0] - b[0])
    for (const [, l] of lines) console.log(l)

    const now = Date.now()
    if (now - lastStatus >= STATUS_MS) {
      const rate = Math.round(windowMsgs / ((now - windowStart) / 1000))
      const active = [...totals.values()].filter((t) => now - t.last < STATUS_MS).length
      console.log(`  · ${active} of ${host.size} channels active, ${rate} msg/s, ` +
        `${changedFields.size} fields changed now and then, ${continuous.size} continuous` +
        `${errors ? `, ${errors} errors (${lastError})` : lastError ? ` (${lastError})` : ""}`)
      windowMsgs = 0; windowStart = now; lastStatus = now; lastError = ""
    }
  }

  async function stop(why) {
    if (stopping) return
    stopping = true
    const state = {}
    for (const [id, insp] of insps) {
      try {
        const st = await insp.evaluate(`window.CROSSCHECK_P02 ? window.CROSSCHECK_P02.state() : null`)
        if (st) Object.assign(state, st)
      } catch { /* panel gone */ }
      try { await insp.evaluate(`typeof window.CROSSCHECK_P02_STOP === "function" ? window.CROSSCHECK_P02_STOP() : "none"`) } catch { /* panel gone */ }
      insp.close()
    }
    const secs = (Date.now() - started) / 1000
    note()
    note(`3 · Traffic over ${Math.round(secs)}s (${why})`)
    note(`  ${"channel".padEnd(30)} ${"msgs".padStart(7)} ${"msg/s".padStart(7)} ${"bytes".padStart(7)} ${"fields".padStart(7)} ${"now&then".padStart(9)} ${"contin.".padStart(8)}`)
    const names = [...host.keys()].sort()
    for (const n of names) {
      const t = totals.get(n)
      const seen = state[n] ? Object.keys(state[n]).length : 0
      const occasional = [...changedFields.keys()].filter((k) => k.startsWith(n + "|") && !continuous.has(k)).length
      const cont = [...continuous].filter((k) => k.startsWith(n + "|")).length
      if (!t) { note(`  ${n.padEnd(30)} ${"0".padStart(7)}   (no message)`); continue }
      note(`  ${n.padEnd(30)} ${String(t.msgs).padStart(7)} ${(t.msgs / secs).toFixed(1).padStart(7)} ` +
        `${String(Math.round(t.bytes / t.msgs)).padStart(7)} ${String(seen).padStart(7)} ` +
        `${String(occasional).padStart(9)} ${String(cont).padStart(8)}`)
    }
    note()
    note("  msgs counts every delivery; bytes is the mean message size; fields is every field seen during the run;")
    note("  now&then is fields that changed but never continuously; contin. is fields that changed 4 or more times within 5s.")
    if (errors) note(`  ${errors} handler errors in the panels, the last: ${lastError}`)
    stream.end()
    writeFileSync(firstsFile, JSON.stringify(firsts, null, 1))
    writeFileSync(stateFile, JSON.stringify(state, null, 1))
    writeFileSync(reportFile, report.join("\n") + "\n")
    console.log(`\nsaved ${repoRelative(reportFile)}`)
    console.log(`saved ${repoRelative(streamFile)}`)
    console.log(`saved ${repoRelative(firstsFile)}`)
    console.log(`saved ${repoRelative(stateFile)}`)
    process.exit(0)
  }

  process.on("SIGINT", () => { stop("stopped with Ctrl+C") })
  const endAt = started + MINUTES * 60000
  while (!stopping && Date.now() < endAt) {
    const t0 = Date.now()
    await pollOnce()
    await new Promise((r) => setTimeout(r, Math.max(0, POLL_MS - (Date.now() - t0))))
  }
  await stop("time up")
}

main().catch((e) => {
  console.error("\n" + e.message + "\n")
  process.exit(1)
})
