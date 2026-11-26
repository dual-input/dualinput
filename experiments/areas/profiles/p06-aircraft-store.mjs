/*
 * p06: what the sim's own aircraft store says about an aircraft's variations, read
 * without changing anything, for the variant picker
 * (record/areas/profiles/07-the-variant-picker.md).
 *
 * The world map keeps its aircraft in a store in the menu's document, mainUi:
 * game/aircraft/currentAircraft, the list game/aircraft/aircraftList, and the
 * configurator's variations game/aircraft/configurator/items, each list read through
 * requestArrayElements and then getData on path/<index> (record/areas/interface/log.md,
 * 2026-10-05, p08). p08 set the aircraft; this only reads, so it runs at the world map
 * or in a flight, and changes neither the selection nor the flight.
 *
 *   node experiments/areas/profiles/p06-aircraft-store.mjs [aircraft list filter]
 *
 * Output: the report on the console and in
 * experiments/areas/profiles/results/p06-aircraft-store-<time>.txt, with each entry's
 * fields but the long `details`.
 */

import { listPages, selectPage, Inspector } from "../../tools/inspector.mjs"
import { saveResult } from "../../tools/results.mjs"

const filter = (process.argv[2] ?? "").toLowerCase()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pages = await listPages()
const page = selectPage(pages, "mainUi")
const insp = new Inspector(page.id)
await insp.open()

// Runs in the document: ES2017's syntax, as Coherent GT parses it.
const INSTALL = `(function () {
  var p = window.DUALINPUT_P06_STORE = window.DUALINPUT_P06_STORE || { slots: {} };
  p.call = function (key, name, args) {
    p.slots[key] = { state: "pending" };
    try {
      engine.call.apply(engine, [name].concat(args)).then(
        function (v) { p.slots[key] = { state: "resolved", value: v === undefined ? null : v }; },
        function (e) { p.slots[key] = { state: "rejected", error: String(e) }; });
    } catch (e) { p.slots[key] = { state: "threw", error: String(e) }; }
    return "started";
  };
  p.get = function (path) {
    var l = window._globalDataLoader;
    if (!l) return { state: "no _globalDataLoader" };
    var d = l.getData(path);
    try { return { state: d ? "ok" : "no data", value: d ? JSON.parse(JSON.stringify(d.value)) : null }; }
    catch (e) { return { state: "unreadable", error: String(e) }; }
  };
  return typeof engine;
})()`
const CLEAN = `(function () { window.DUALINPUT_P06_STORE = undefined; return "cleaned"; })()`

async function call(key, name, args, ms = 5000) {
  await insp.evaluate(`window.DUALINPUT_P06_STORE.call(${JSON.stringify(key)}, ${JSON.stringify(name)}, ${JSON.stringify(args)})`)
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const s = await insp.evaluate(`window.DUALINPUT_P06_STORE.slots[${JSON.stringify(key)}]`)
    if (s && s.state !== "pending") return s
    await sleep(100)
  }
  return { state: `no answer in ${ms / 1000}s` }
}
const get = (path) => insp.evaluate(`window.DUALINPUT_P06_STORE.get(${JSON.stringify(path)})`)

async function list(path, keep = () => true) {
  const range = await call(`range:${path}`, "requestArrayElements", [path, 0, 1000])
  if (typeof range.value !== "number") return { state: range.state, count: null, items: [] }
  const items = []
  for (let i = 0; i < Math.min(range.value, 1000); i++) {
    const v = (await get(`${path}/${i}`)).value
    if (keep(v)) items.push(v)
  }
  return { state: range.state, count: range.value, items }
}

const brief = (v) => (v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "details")) : v)
const out = []
const say = (s = "") => { out.push(s); console.log(s) }

try {
  say(`p06 aircraft store, in ${page.title}, filter "${filter}"`)
  say(`documents open: ${pages.length}, a cockpit's among them: ${pages.some((p) => /VCockpit/i.test(p.title ?? ""))}`)
  say(`engine: ${await insp.evaluate(INSTALL)}`)
  const current = await get("game/aircraft/currentAircraft")
  say(`\n## game/aircraft/currentAircraft: ${current.state}`)
  say(JSON.stringify(brief(current.value), null, 1))
  const items = await list("game/aircraft/configurator/items")
  say(`\n## game/aircraft/configurator/items: ${items.state}, ${items.count}`)
  for (const v of items.items) say(JSON.stringify(brief(v)))
  if (filter) {
    const listed = await list("game/aircraft/aircraftList", (v) => JSON.stringify(v ?? "").toLowerCase().includes(filter))
    say(`\n## game/aircraft/aircraftList: ${listed.state}, ${listed.count} entries, ${listed.items.length} holding "${filter}"`)
    for (const v of listed.items) say(JSON.stringify(brief(v)))
  }
} finally {
  await insp.evaluate(CLEAN)
}
const file = saveResult("profiles", "p06-aircraft-store", out.join("\n"))
console.log(`\nsaved ${file.replace(/\\/g, "/").replace(/^.*\/experiments\//, "experiments/")}`)
process.exit(0)
