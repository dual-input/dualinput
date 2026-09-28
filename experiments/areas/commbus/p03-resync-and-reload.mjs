/*
 * p03: can a listener that attaches late get the A220's full state?
 *
 * The A220's messages carry only what changed (p02). Its displays call
 * "A22X.Resync" when a change doesn't apply cleanly, when a channel goes quiet
 * for 3s, and once when DisplayUnits loads (read from
 * html_ui/Pages/VCockpit/Instruments/a22x/DisplayUnits/instrument.js,
 * src/avionics/lib/afdx/index.ts, on 2026-09-28). This measures what the
 * systems module sends after each:
 *
 *   1. 6s of baseline.
 *   2. We call A22X.Resync ourselves, then record 6s.
 *   3. We reload the DisplayUnits panel, then record 15s, and read which names
 *      it registered again.
 *
 * Two recorders listen: one in Sentry for every CommBus name any panel
 * registered, which also shows whether a panel gets names it never registered,
 * and one in a CTP for the names that panel registered itself.
 *
 * Step 3 reloads a cockpit display: DisplayUnits goes blank for a moment and
 * comes back. The recorders add listeners and wrap nothing, and stop on their
 * own 20s after this process stops polling. window.CROSSCHECK_P03_STOP() in a
 * panel stops one by hand.
 *
 *   node experiments/areas/commbus/p03-resync-and-reload.mjs
 */

import { createWriteStream, writeFileSync } from "node:fs"

import { listPages, Inspector } from "../../tools/inspector.mjs"
import { resultFile, repoRelative, stamp } from "../../tools/results.mjs"

const COMM_BUS = "JS_LISTENER_COMM_BUS"
const INTERNAL = "ON_EVENT_TO_ALL_SUBSCRIBERS"
const POLL_MS = 250

// Runs in the panel: Chrome 49.
const INVENTORY = `
(function () {
  var h = ViewListener.g_ViewListenersMgr.m_hash
  var arr = (h["${COMM_BUS}"] && h["${COMM_BUS}"].array) || []
  var names = []
  arr.forEach(function (l) {
    if (!l || l.CROSSCHECK_P03 || !l.eventHandlers || !l.eventHandlers.forEach) return
    l.eventHandlers.forEach(function (entry, key) { if (names.indexOf(key) < 0) names.push(key) })
  })
  return names
})()`

// Runs in the panel: Chrome 49. Records every message; keeps the text only when
// it differs from the channel's previous message, because several channels
// repeat an identical snapshot 30 times a second.
const RECORDER = `
function (names, minutes) {
  if (typeof window.CROSSCHECK_P03_STOP === "function") { try { window.CROSSCHECK_P03_STOP() } catch (e) {} }
  var s = { msgs: [], lastRaw: {}, errors: 0, lastError: "", lastDrain: Date.now(), deadline: Date.now() + minutes * 60000 }

  function count(v, depth) {
    if (v === null || typeof v !== "object" || depth > 8) return 1
    var n = 0, k
    if (Array.isArray(v)) { for (k = 0; k < v.length; k++) n += count(v[k], depth + 1); return n }
    for (k in v) n += count(v[k], depth + 1)
    return n
  }

  function onMessage(name, arg) {
    try {
      var raw = typeof arg === "string" ? arg : JSON.stringify(arg)
      if (raw === undefined) raw = String(arg)
      var fields = 0
      try { fields = count(JSON.parse(raw), 0) } catch (e) { fields = -1 }
      var same = raw === s.lastRaw[name]
      s.lastRaw[name] = raw
      s.msgs.push([Date.now(), name, raw.length, fields, same ? null : (raw.length > 20000 ? raw.slice(0, 20000) : raw)])
    } catch (e) {
      s.errors++
      s.lastError = String(e)
    }
  }

  var listener = RegisterCommBusListener(function () {})
  listener.CROSSCHECK_P03 = true
  names.forEach(function (n) {
    listener.on(n, function () { onMessage(n, arguments[0]) })
  })

  var timer = setInterval(function () {
    var now = Date.now()
    if (now > s.deadline || now - s.lastDrain > 20000) window.CROSSCHECK_P03_STOP()
  }, 2000)

  window.CROSSCHECK_P03 = {
    drain: function () {
      s.lastDrain = Date.now()
      var r = { msgs: s.msgs, errors: s.errors, lastError: s.lastError }
      s.msgs = []
      return r
    },
    resync: function () {
      try {
        var p = listener.callWasm("A22X.Resync", "{}")
        if (p && p.catch) p.catch(function (e) { s.errors++; s.lastError = "resync: " + String(e) })
        return "sent"
      } catch (e) {
        return "threw: " + e
      }
    }
  }
  window.CROSSCHECK_P03_STOP = function () {
    clearInterval(timer)
    try { listener.unregister() } catch (e) {}
    window.CROSSCHECK_P03 = undefined
    window.CROSSCHECK_P03_STOP = function () { return "not running" }
    return "stopped"
  }
  return names.length
}`

const when = stamp()
const reportFile = resultFile("commbus", "p03-resync-and-reload", "txt", when)
const streamFile = resultFile("commbus", "p03-resync-and-reload", "ndjson", when)
const stream = createWriteStream(streamFile)
const report = []
const note = (s = "") => { report.push(s); console.log(s) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const byTitle = (pages, text) => pages.filter((p) => String(p.title || "").includes(text))

async function main() {
  const started = Date.now()
  note("p03 · A220 full state: our resync call, then a DisplayUnits reload")
  note(new Date(started).toISOString())

  const pages = (await listPages()).filter((p) => /^VCockpit/i.test(String(p.title || "")))
  const sentry = byTitle(pages, "Sentry")[0]
  const du = byTitle(pages, "DisplayUnits")[0]
  const ctpLeft = byTitle(pages, "CTP").sort((a, b) => a.id - b.id)[0]
  if (!sentry || !du || !ctpLeft) throw new Error("expected the A220's Sentry, DisplayUnits, and CTP panels")

  const all = new Set()
  const registeredBy = new Map()
  for (const p of pages) {
    const insp = new Inspector(p.id)
    await insp.open()
    const names = (await insp.evaluate(INVENTORY)).filter((n) => n !== INTERNAL)
    insp.close()
    registeredBy.set(p.id, new Set(names))
    for (const n of names) all.add(n)
  }

  const recorders = [
    { page: sentry, names: [...all].sort(), label: "Sentry, every name" },
    { page: ctpLeft, names: [...registeredBy.get(ctpLeft.id)].sort(), label: "its own names" }
  ]
  note()
  note("1 · Recorders")
  for (const r of recorders) {
    r.insp = new Inspector(r.page.id)
    await r.insp.open()
    await r.insp.evaluate(`(${RECORDER})(${JSON.stringify(r.names)}, 2)`)
    note(`  ${String(r.page.id).padStart(3)}  ${r.page.title}: ${r.label}, ${r.names.length} names`)
  }

  const msgs = []
  const marks = []
  let errors = 0, lastError = ""
  async function pollFor(ms) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      for (const r of recorders) {
        let d
        try { d = await r.insp.evaluate(`window.CROSSCHECK_P03 ? window.CROSSCHECK_P03.drain() : null`) } catch (e) { lastError = e.message; continue }
        if (!d) { lastError = `panel ${r.page.id}: recorder gone`; continue }
        errors += d.errors
        if (d.lastError) lastError = d.lastError
        for (const [t, name, bytes, fields, raw] of d.msgs) {
          const m = { t, panel: r.page.id, name, bytes, fields, raw }
          msgs.push(m)
          stream.write(JSON.stringify(m) + "\n")
        }
      }
      await sleep(POLL_MS)
    }
  }
  function mark(what) {
    const t = Date.now()
    marks.push({ t, what })
    stream.write(JSON.stringify({ t, mark: what }) + "\n")
    note(`  ${new Date(t).toTimeString().slice(0, 8)}  ${what}`)
  }

  note()
  note("2 · Run")
  mark("baseline")
  await pollFor(6000)
  const said = await recorders[0].insp.evaluate(`window.CROSSCHECK_P03.resync()`)
  mark(`A22X.Resync called from panel ${recorders[0].page.id}: ${said}`)
  await pollFor(6000)

  const duInsp = new Inspector(du.id)
  await duInsp.open()
  await duInsp.evaluate(`setTimeout(function () { location.reload() }, 50); "reloading"`).catch(() => {})
  duInsp.close()
  mark(`DisplayUnits (panel ${du.id}) reloaded`)
  await pollFor(15000)

  let reloadedNames = null
  try {
    const again = byTitle((await listPages()).filter((p) => /^VCockpit/i.test(String(p.title || ""))), "DisplayUnits")[0]
    const i = new Inspector(again.id)
    await i.open()
    reloadedNames = (await i.evaluate(INVENTORY)).filter((n) => n !== INTERNAL)
    i.close()
  } catch (e) {
    reloadedNames = `could not read: ${e.message}`
  }

  for (const r of recorders) {
    try { await r.insp.evaluate(`typeof window.CROSSCHECK_P03_STOP === "function" ? window.CROSSCHECK_P03_STOP() : "none"`) } catch { /* gone */ }
    r.insp.close()
  }
  stream.end()

  // 3. Per phase, per channel: the largest message in fields.
  const phases = [
    { name: "baseline", from: marks[0].t, to: marks[1].t },
    { name: "after resync", from: marks[1].t, to: marks[2].t },
    { name: "after reload", from: marks[2].t, to: Infinity }
  ]
  note()
  note(`3 · Largest message per channel, in fields, as the ${recorders[0].page.title} recorder saw it`)
  note(`  ${"channel".padEnd(28)} ${"baseline".padStart(9)} ${"resync".padStart(8)} ${"latency".padStart(8)} ${"reload".padStart(8)} ${"latency".padStart(8)}`)
  const main0 = msgs.filter((m) => m.panel === recorders[0].page.id)
  for (const name of recorders[0].names) {
    const cells = phases.map((ph) => {
      const inPhase = main0.filter((m) => m.name === name && m.t >= ph.from && m.t < ph.to)
      if (!inPhase.length) return { max: "-", lat: "" }
      const max = Math.max(...inPhase.map((m) => m.fields))
      const firstBig = inPhase.find((m) => m.fields === max && max > 1)
      return { max: String(max), lat: firstBig && ph.name !== "baseline" ? `${firstBig.t - ph.from}ms` : "" }
    })
    note(`  ${name.padEnd(28)} ${cells[0].max.padStart(9)} ${cells[1].max.padStart(8)} ${cells[1].lat.padStart(8)} ${cells[2].max.padStart(8)} ${cells[2].lat.padStart(8)}`)
  }

  note()
  note("4 · Delivery to a panel that never registered the name")
  const sentryOwn = registeredBy.get(recorders[0].page.id)
  const heard = new Set(main0.map((m) => m.name))
  const foreign = recorders[0].names.filter((n) => !sentryOwn.has(n))
  note(`  ${foreign.filter((n) => heard.has(n)).length} of ${foreign.length} names registered only in other panels reached the Sentry recorder`)
  const ctpMsgs = msgs.filter((m) => m.panel === recorders[1].page.id)
  for (const name of recorders[1].names) {
    const a = main0.filter((m) => m.name === name).length
    const b = ctpMsgs.filter((m) => m.name === name).length
    note(`    ${name.padEnd(28)} Sentry ${String(a).padStart(5)}   CTP ${String(b).padStart(5)}`)
  }

  note()
  note("5 · DisplayUnits after the reload")
  note(Array.isArray(reloadedNames)
    ? `  registered ${reloadedNames.length} CommBus names again (${registeredBy.get(du.id).size} before)`
    : `  ${reloadedNames}`)
  if (errors || lastError) note(`  recorder errors: ${errors}, last: ${lastError}`)

  writeFileSync(reportFile, report.join("\n") + "\n")
  console.log(`\nsaved ${repoRelative(reportFile)}`)
  console.log(`saved ${repoRelative(streamFile)}`)
}

main().catch((e) => {
  console.error("\n" + e.message + "\n")
  process.exit(1)
})
