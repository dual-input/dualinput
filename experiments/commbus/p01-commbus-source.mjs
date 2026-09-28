/*
 * p01: how panel JavaScript reaches the CommBus, and whether a script that
 * arrives after a panel loaded can read the names that panel registered.
 *
 * Read-only. It evaluates expressions in each panel and reads the scripts each
 * panel loaded. It wraps nothing and leaves nothing behind in the page.
 *
 * Needs MSFS 2024 in a flight with the Synaptic A220-300, panels powered.
 *
 *   node experiments/commbus/p01-commbus-source.mjs [title filter, default VCockpit]
 *
 * The report goes to experiments/commbus/results/. The source it reads goes to
 * experiments/sim-sources/commbus/, which git ignores, because it's Asobo's code.
 */

import { writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

import { listPages, Inspector, loadedScripts, resourceContent } from "../tools/inspector.mjs"
import { saveResult, simSourcesDir, slug } from "../tools/results.mjs"

const filter = (process.argv[2] || "VCockpit").toLowerCase()

// Runs in the panel, so it's written for Chrome 49. It reads and returns; it
// assigns nothing on window.
const SURVEY = `
(function () {
  var out = { types: {}, coherentKeys: [], globals: [], sources: {}, listenerObjects: [] }
  var geval = eval

  function lookup(path) {
    var parts = path.split(".")
    var v
    try { v = geval("typeof " + parts[0] + " === 'undefined' ? undefined : " + parts[0]) } catch (e) { return { error: String(e) } }
    for (var i = 1; i < parts.length; i++) {
      if (v == null) return { value: undefined }
      try { v = v[parts[i]] } catch (e) { return { error: String(e) } }
    }
    return { value: v }
  }

  function describe(v) {
    if (typeof v !== "function") return typeof v
    var s = ""
    try { s = Function.prototype.toString.call(v) } catch (e) {}
    return s.indexOf("[native code]") >= 0 ? "function (native)" : "function"
  }

  function keep(name, fn) {
    if (out.sources[name]) return
    try { out.sources[name] = Function.prototype.toString.call(fn) } catch (e) { out.sources[name] = "(toString threw: " + e + ")" }
  }

  function keepClass(name, fn) {
    keep(name, fn)
    if (!fn.prototype) return
    var names = []
    try { names = Object.getOwnPropertyNames(fn.prototype) } catch (e) {}
    for (var i = 0; i < names.length; i++) {
      var d = null
      try { d = Object.getOwnPropertyDescriptor(fn.prototype, names[i]) } catch (e) {}
      if (d && typeof d.value === "function" && names[i] !== "constructor") keep(name + ".prototype." + names[i], d.value)
    }
  }

  var paths = [
    "RegisterCommBusListener", "RegisterViewListener", "ViewListener", "ViewListener.ViewListener",
    "Coherent", "Coherent.on", "Coherent.off", "Coherent.call", "Coherent.trigger"
  ]
  for (var i = 0; i < paths.length; i++) {
    var r = lookup(paths[i])
    out.types[paths[i]] = r.error ? "threw: " + r.error : describe(r.value)
    if (typeof r.value === "function" && describe(r.value) === "function") keepClass(paths[i], r.value)
  }

  var coherent = lookup("Coherent").value
  if (coherent) {
    var ck = []
    try { ck = Object.getOwnPropertyNames(coherent) } catch (e) {}
    for (var j = 0; j < ck.length; j++) {
      var cv
      try { cv = coherent[ck[j]] } catch (e) { cv = undefined }
      out.coherentKeys.push(ck[j] + ": " + describe(cv))
    }
  }

  // A class declared at a script's top level isn't a property of window, so
  // follow the names the listener code constructs, two levels deep.
  for (var pass = 0; pass < 2; pass++) {
    var text = ""
    for (var k in out.sources) text += out.sources[k] + "\\n"
    var re = /new\\s+([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)\\s*\\(/g
    var m
    while ((m = re.exec(text))) {
      var name = m[1]
      if (out.sources[name] || /^(Array|Object|Map|Set|Error|Promise|Date|RegExp|WeakMap|Function)$/.test(name)) continue
      var hit = lookup(name)
      if (typeof hit.value === "function") {
        out.types[name] = describe(hit.value)
        if (describe(hit.value) === "function") keepClass(name, hit.value)
      }
    }
  }

  var keys = []
  try { keys = Object.getOwnPropertyNames(window) } catch (e) {}
  for (var n = 0; n < keys.length; n++) {
    var key = keys[n], v
    try { v = window[key] } catch (e) { continue }
    if (/comm.?bus|view.?listener/i.test(key)) {
      out.globals.push(key + ": " + describe(v))
      if (typeof v === "function" && describe(v) === "function") keepClass(key, v)
    }
    if (v && typeof v === "object") {
      var ctor = ""
      try { ctor = v.constructor && v.constructor.name } catch (e) {}
      if (ctor && /listener|comm.?bus/i.test(ctor)) {
        var own = []
        try { own = Object.keys(v) } catch (e) {}
        out.listenerObjects.push({ key: key, ctor: ctor, keys: own.slice(0, 40) })
      }
    }
  }
  return out
})()`

// Counted in every script each panel loaded, to show where CommBus traffic
// starts in JavaScript.
const NEEDLES = ["RegisterCommBusListener", "callWasm", "callSimConnect", "callAll", "COMM_BUS"]

const lines = []
const say = (s = "") => { lines.push(s); console.log(s) }

function hash(obj) {
  return createHash("sha1").update(JSON.stringify(obj)).digest("hex").slice(0, 10)
}

// Names are facts about the API and can go in the committed report; the bodies
// they came from stay in the ignored dump.
function coherentNames(sources) {
  const found = new Set()
  const re = /Coherent\.(call|on|off|trigger)\(\s*["']([^"']+)["']/g
  for (const s of Object.values(sources)) {
    let m
    while ((m = re.exec(s))) found.add(`Coherent.${m[1]}("${m[2]}")`)
  }
  return [...found].sort()
}

function assignedProperties(sources) {
  const found = new Set()
  const re = /this\.([A-Za-z_$][\w$]*)\s*=[^=]/g
  for (const s of Object.values(sources)) {
    let m
    while ((m = re.exec(s))) found.add(m[1])
  }
  return [...found].sort()
}

async function main() {
  const pages = await listPages()
  const panels = pages.filter((p) => String(p.title || "").toLowerCase().includes(filter))

  say("p01 · how panel JavaScript reaches the CommBus")
  say(`${new Date().toISOString()}`)
  say(`${pages.length} inspectable documents, ${panels.length} with "${filter}" in the title`)
  say()
  say("1 · Panels")
  for (const p of panels) say(`  ${String(p.id).padStart(3)}  ${String(p.title).padEnd(36)} ${p.url || ""}`)
  if (!panels.length) {
    say("  none, so nothing more to do; is a flight loaded?")
    return
  }

  const surveys = []
  const scriptUse = new Map()

  for (const p of panels) {
    const insp = new Inspector(p.id)
    try {
      await insp.open()
      const survey = await insp.evaluate(SURVEY)
      surveys.push({ page: p, survey })
      for (const s of await loadedScripts(insp)) {
        if (!scriptUse.has(s.url)) {
          const body = await resourceContent(insp, s).catch(() => "")
          const counts = {}
          for (const n of NEEDLES) {
            let at = -1, c = 0
            while ((at = body.indexOf(n, at + 1)) !== -1) c++
            if (c) counts[n] = c
          }
          const defines = /function\s+RegisterCommBusListener\b|RegisterCommBusListener\s*=/.test(body)
          scriptUse.set(s.url, { counts, defines, bytes: body.length, panels: [] })
        }
        scriptUse.get(s.url).panels.push(p.id)
      }
    } catch (e) {
      surveys.push({ page: p, error: e.message })
    } finally {
      insp.close()
    }
  }

  say()
  say("2 · What each panel has")
  const groups = new Map()
  for (const s of surveys) {
    if (s.error) { say(`  ${s.page.id}  failed: ${s.error}`); continue }
    const key = hash(s.survey.sources)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(s)
  }
  for (const s of surveys.filter((x) => !x.error)) {
    const t = s.survey.types
    say(`  ${String(s.page.id).padStart(3)}  RegisterCommBusListener ${t.RegisterCommBusListener}, ` +
      `Coherent.on ${t["Coherent.on"]}, source set ${hash(s.survey.sources)}`)
  }
  say()
  say(`  ${groups.size} distinct set${groups.size === 1 ? "" : "s"} of listener source across the panels.`)

  const first = surveys.find((s) => !s.error && s.survey.types.RegisterCommBusListener === "function")
  say()
  say("3 · The listener code")
  if (!first) {
    say("  No panel has a JavaScript RegisterCommBusListener. Types seen in the first panel:")
    const any = surveys.find((s) => !s.error)
    if (any) for (const [k, v] of Object.entries(any.survey.types)) say(`    ${k.padEnd(28)} ${v}`)
  } else {
    const sv = first.survey
    say(`  Read from panel ${first.page.id}, ${first.page.title}.`)
    say()
    say("  Types:")
    for (const [k, v] of Object.entries(sv.types)) say(`    ${k.padEnd(28)} ${v}`)
    say()
    say("  Functions and methods read:")
    for (const [k, v] of Object.entries(sv.sources)) say(`    ${k.padEnd(52)} ${v.length} chars`)
    say()
    say("  Coherent calls made with a literal name:")
    const names = coherentNames(sv.sources)
    for (const n of names) say(`    ${n}`)
    if (!names.length) say("    none; the names are passed in variables, so read the dump")
    say()
    say("  Properties the code assigns on this (where a list of registrations would live):")
    say(`    ${assignedProperties(sv.sources).join(", ") || "none"}`)
    say()
    say("  Own properties of Coherent:")
    say(`    ${sv.coherentKeys.join(", ") || "none"}`)
    say()
    say("  Globals whose name mentions comm bus or view listener:")
    say(`    ${sv.globals.join(", ") || "none"}`)

    const dir = simSourcesDir("commbus")
    for (const g of groups.values()) {
      const s = g[0]
      const file = join(dir, `p01-${slug(s.page.title)}-${hash(s.survey.sources)}.js`)
      writeFileSync(file, Object.entries(s.survey.sources).map(([k, v]) => `// ${k}\n${v}\n`).join("\n"))
      say()
      say(`  Source for panels ${g.map((x) => x.page.id).join(", ")} saved to ${file.replace(/\\/g, "/").replace(/^.*\/experiments\//, "experiments/")}`)
    }
  }

  say()
  say("4 · Objects on window whose constructor looks like a listener")
  let anyObj = false
  for (const s of surveys.filter((x) => !x.error)) {
    for (const o of s.survey.listenerObjects) {
      anyObj = true
      say(`  ${String(s.page.id).padStart(3)}  window.${o.key}: ${o.ctor} { ${o.keys.join(", ")} }`)
    }
  }
  if (!anyObj) say("  none; listeners live in closures or module scope, out of reach after load")

  say()
  say("5 · Scripts that mention the CommBus")
  const used = [...scriptUse.entries()].filter(([, u]) => Object.keys(u.counts).length)
  for (const [url, u] of used) {
    const counts = Object.entries(u.counts).map(([k, v]) => `${k} ${v}`).join(", ")
    say(`  ${url}`)
    say(`      ${counts}${u.defines ? ", defines RegisterCommBusListener" : ""}; panels ${u.panels.join(", ")}`)
  }
  if (!used.length) say("  none")
  say()
  say(`${scriptUse.size} distinct scripts scanned.`)

  console.log(`\nsaved ${saveResult("commbus", "p01-commbus-source", lines.join("\n"))}`)
}

main().catch((e) => {
  console.error("\n" + e.message + "\n")
  process.exit(1)
})
