/*
 * p07: whether code outside the world map's own can set the world map's
 * departure airport and stand, and whether Fly then starts the flight there.
 * The plan's step 6 probe on the PF's spot on the world map (record/areas/
 * product/plan.md; record/areas/product/ideas.md, "The PF's spot on the world
 * map").
 *
 *   node experiments/areas/interface/p07-world-map.mjs
 *
 * The world map's free-flight panel sets a stand with
 * Et.game.currentFlight.setDepartureTaxiIndex.request(`${taxi.ID}`), passing
 * the stand's ID rather than its place in the list, and its store's request()
 * is engine.call("requestData", path, arg) (read in fs-base-ui 0.1.10,
 * html_ui/Global/pkg/base.bundle.js, FreeflightPlanCombobox._updateDropdown
 * and selectRunway; html_ui/Global/lib.js, GlobalDataListener.request). Its
 * airport search sends AIRPORT_INPUT_TEXT to the view listener
 * JS_LISTENER_AIRPORT_SEARCH, which answers with ResultsUpdated, and picking a
 * result sends ON_DEPARTURE_AIRPORT_SELECTED with the result's index and
 * database (read in lib.js, AirportSearchListener and ViewListener.trigger).
 * The inspector lists the menu's document as mainUi, which has engine but no
 * Coherent (measured on MSFS 2024, 2026-10-04, record/areas/interface/log.md).
 *
 * A package can put a script into mainUi: Flow Pro ships its own copy of
 * fs-base-ui's start page component, cookedcomps/{3A799C8C-BED8-48DE-B7D4-
 * D30472668E33}.html, with a hidden <img src onerror> that appends a script of
 * its own to the document (read in p42-util-flow-pro 26.33.5), the trick our
 * toolbar icon used (record/areas/interface/log.md, 2026-10-04). So what this
 * probe does from the inspector in mainUi is what a script we ship could do.
 *
 * The pilot opens Free flight's world map. The probe, through the inspector:
 *   1. lists every document the world map has, and what each can reach;
 *   2. in mainUi, searches for the airport and selects it as the departure,
 *      and if the departure doesn't change, tries setFreeflightDeparture with
 *      the airport's world location;
 *   3. selects a stand by its ID, and reads the departure back;
 *   4. in the first other document that has engine, selects a second stand,
 *      which says whether code outside mainUi can do it too;
 *   5. takes a screenshot of the world map.
 * The pilot then clicks Fly, and the probe reads the flight file's
 * [Departure] section and the aircraft's position. Nothing it adds stays in
 * any document.
 */

import { readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"

import { Recorder, repoRelative, scrub, sleep } from "../aircraft/lib/out.mjs"
import { Sim } from "../aircraft/lib/sim.mjs"
import { Inspector, listPages } from "../../tools/inspector.mjs"
import { startBeeper, startKeys, startSpeaker } from "../../tools/guide.mjs"
import { startShooter } from "../../tools/shot.mjs"

const AIRPORT = "KSEA"
const UID = "CROSSCHECK_P07"
const DEPARTURE = "game/currentFlight/gameFlight/departure"
const FLT = join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "MISSIONS", "Custom", "CustomFlight", "CustomFlight.FLT")

const rec = new Recorder("p07-world-map", { area: "interface" })
const findings = []
const find = (text) => { findings.push(text); rec.log("finding", text) }

// ---------------------------------------------------------------- in a document

// Runs in the document: Chrome 49's syntax, no optional chaining or ??.
const INSTALL = `(function () {
  var p = window.CROSSCHECK_P07;
  if (!p) {
    p = window.CROSSCHECK_P07 = { slots: {}, handles: [], results: [] };
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
    var onResults = function (uid, list) { if (uid === "${UID}") p.results.push(list); };
    try { p.handles.push(engine.on("ResultsUpdated", onResults)); } catch (e) {}
    try {
      p.handles.push(engine.on("EVENT_FROM_VIEW_LISTENER", function (name, ev, uid, list) {
        if (ev === "ResultsUpdated") onResults(uid, list);
      }));
    } catch (e) {}
  }
  return {
    engine: typeof engine, coherent: typeof Coherent, loader: typeof window._globalDataLoader,
    href: String(location.href).slice(0, 160)
  };
})()`

const CLEAN = `(function () {
  var p = window.CROSSCHECK_P07;
  if (!p) return "nothing";
  for (var i = 0; i < p.handles.length; i++) { try { p.handles[i].clear(); } catch (e) {} }
  window.CROSSCHECK_P07 = undefined;
  return "cleaned";
})()`

async function call(insp, key, name, args, ms = 5000) {
  await insp.evaluate(`window.CROSSCHECK_P07.call(${JSON.stringify(key)}, ${JSON.stringify(name)}, ${JSON.stringify(args)})`)
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const s = await insp.evaluate(`window.CROSSCHECK_P07.slots[${JSON.stringify(key)}]`)
    if (s && s.state !== "pending") return s
    await sleep(100)
  }
  return { state: `no answer in ${ms / 1000}s` }
}

const get = (insp, path) => insp.evaluate(`window.CROSSCHECK_P07.get(${JSON.stringify(path)})`)

const trigger = (insp, args) =>
  insp.evaluate(`(function () { try { engine.trigger.apply(engine, ${JSON.stringify(args)}); return "sent"; } catch (e) { return "threw: " + e; } })()`)

// The field names of a world location aren't documented, so the summary keeps
// their keys, and the airport is matched by its ICAO code anywhere in it.
function summarize(dep) {
  if (!dep) return { set: false }
  const wl = dep.worldLocation ?? {}
  const info = wl.airportInfos ?? {}
  const taxis = info.taxis ?? []
  const taxi = taxis.find((t) => String(t.ID) === String(dep.taxiIndex))
  return {
    set: true,
    isAirport: JSON.stringify(wl).includes(`"${AIRPORT}"`),
    title: wl.title ?? wl.name ?? null,
    taxiIndex: dep.taxiIndex ?? null,
    stand: taxi ? taxi.name : null,
    runwayIndex: dep.runwayIndex ?? null,
    taxis: taxis.length,
    runways: (info.runways ?? []).length,
    depKeys: Object.keys(dep),
    wlKeys: Object.keys(wl),
  }
}

async function departure(insp) {
  const d = await get(insp, DEPARTURE)
  return { state: d.state, dep: d.value, sum: summarize(d.value) }
}

async function waitFor(insp, test, ms = 5000) {
  const t0 = Date.now()
  let last
  while (Date.now() - t0 < ms) {
    last = await departure(insp)
    if (test(last.sum)) return { ok: true, ...last, ms: Date.now() - t0 }
    await sleep(150)
  }
  return { ok: false, ...last }
}

// ---------------------------------------------------------------- the steps

// Two ways to send a view listener's event: wrapped, as the sim's own
// ViewListener.trigger does (read in lib.js), and bare, by the event's own name,
// in case the sim takes those too.
const FORMS = [
  ["wrapped", (ev, ...args) => ["EVENT_TO_VIEW_LISTENER", "JS_LISTENER_AIRPORT_SEARCH", ev, ...args]],
  ["bare", (ev, ...args) => [ev, ...args]],
]

async function setAirport(insp) {
  for (const [form, wrap] of FORMS) {
    await insp.evaluate("window.CROSSCHECK_P07.results.length = 0")
    const sent = await trigger(insp, wrap("AIRPORT_INPUT_TEXT", UID, AIRPORT, "ON_DEPARTURE_AIRPORT_SELECTED"))
    rec.log("search", `AIRPORT_INPUT_TEXT ${AIRPORT}, ${form}: ${sent}`)
    let list = null
    for (let i = 0; i < 40 && !list; i++) {
      await sleep(100)
      const r = await insp.evaluate("window.CROSSCHECK_P07.results")
      if (r && r.length) list = r[r.length - 1]
    }
    if (!list) {
      find(`The airport search, sent ${form}, answered nothing in 4s.`)
      continue
    }
    const hit = list.find((x) => x.ICAO === AIRPORT) ?? null
    rec.log("search", `${list.length} results; ${hit ? `${AIRPORT} at index ${hit.index}, database ${hit.database}` : `none is ${AIRPORT}`}`, { first: list.slice(0, 5) })
    if (!hit) continue
    for (const [selForm, selWrap] of FORMS) {
      const r = await trigger(insp, selWrap("ON_DEPARTURE_AIRPORT_SELECTED", hit.index, hit.database))
      rec.log("search", `ON_DEPARTURE_AIRPORT_SELECTED, ${selForm}: ${r}`)
      const w = await waitFor(insp, (s) => s.isAirport && s.taxis > 0)
      if (w.ok) {
        find(`The airport search, sent ${form}, and the selection, sent ${selForm}, set the departure to ${AIRPORT} in ${w.ms}ms: ${w.sum.taxis} stands, ${w.sum.runways} runways.`)
        return w
      }
      find(`After ON_DEPARTURE_AIRPORT_SELECTED, sent ${selForm}, the departure didn't become ${AIRPORT} in 5s: ${JSON.stringify(w.sum)}`)
    }
  }

  // The fallback: the store's own setter, with the airport's world location.
  const loc = await call(insp, "fromICAO", "requestData", ["game/worldmap/worldLocations/fromICAO", AIRPORT])
  const got = await get(insp, `game/worldmap/worldLocations/fromICAO/${AIRPORT}`)
  const v = got.value ?? {}
  rec.log("fromICAO", `requestData ${loc.state}; the location's keys: ${Object.keys(v).join(", ") || "none"}`, { loc, location: v })
  for (const k of ["uID", "uid", "ID", "id", "guid"]) {
    if (v[k] === undefined) continue
    const r = await call(insp, `free-${k}`, "requestData", ["game/currentFlight/setFreeflightDeparture", String(v[k])])
    const w = await waitFor(insp, (s) => s.isAirport && s.taxis > 0, 3000)
    rec.log("fromICAO", `setFreeflightDeparture(${k} ${v[k]}): ${r.state}; departure ${JSON.stringify(w.sum)}`)
    if (w.ok) {
      find(`setFreeflightDeparture with the location's ${k} set the departure to ${AIRPORT} in ${w.ms}ms.`)
      return w
    }
  }
  find(`Neither route set the departure airport.`)
  return null
}

const setStand = (insp, taxi) =>
  call(insp, `taxi-${taxi.ID}`, "requestData", ["game/currentFlight/setDepartureTaxiIndex", String(taxi.ID)])

async function main() {
  rec.open()
  const keys = await startKeys()
  const beep = startBeeper()
  const say = startSpeaker()
  const shooter = startShooter(join(dirname(rec.files.txt), `p07-world-map-${rec.when}`))
  const sim = await Sim.connect(rec, { name: "CROSSCHECK p07 world map" })
  sim.track()
  await sleep(1500)

  beep(880, 150)
  say("Open Free flight's world map, with any aircraft. Leave the departure alone, keep the sim in front, and press Page Down.")
  rec.log("prompt", "Open Free flight's world map, with any aircraft selected. Leave the departure alone, keep the sim in front, and Page Down.")
  await keys.next()
  say("Hands off. Working.")

  const pages = await listPages()
  rec.log("pages", `${pages.length} documents: ${pages.map((p) => `${p.id} ${p.title || p.url}`).join(" | ")}`, { pages: pages.map((p) => ({ id: p.id, title: p.title, url: p.url })) })
  const main = pages.find((p) => /mainUi/i.test(String(p.title)) || /mainUI\.html/i.test(String(p.url)))
  if (!main) throw new Error("no mainUi document; is the world map open?")

  const others = []
  for (const p of pages.filter((q) => q !== main)) {
    const insp = new Inspector(p.id)
    try {
      await insp.open()
      const reach = await insp.evaluate(INSTALL)
      const d = await departure(insp)
      rec.log("reach", `${p.title || p.url}: engine ${reach.engine}, Coherent ${reach.coherent}, _globalDataLoader ${reach.loader}; departure ${d.state}`, { page: p.title, reach })
      others.push({ page: p, insp, reach })
    } catch (e) {
      rec.log("reach", `${p.title || p.url}: couldn't run: ${e.message}`)
      insp.close()
    }
  }

  const insp = new Inspector(main.id)
  await insp.open()
  const reach = await insp.evaluate(INSTALL)
  rec.log("reach", `mainUi: engine ${reach.engine}, Coherent ${reach.coherent}, _globalDataLoader ${reach.loader}`, { reach })
  const before = await departure(insp)
  rec.log("before", `the departure before: ${before.state} ${JSON.stringify(before.sum)}`)
  find(`Before: the world map's departure was ${before.sum.title ?? "unset"}${before.sum.stand ? `, stand ${before.sum.stand}` : ""}.`)

  let expected = null
  const airport = await setAirport(insp)
  if (airport) {
    const taxis = airport.dep.worldLocation.airportInfos.taxis
    const first = taxis[Math.floor(taxis.length / 2)]
    const s1 = await setStand(insp, first)
    const w1 = await waitFor(insp, (s) => String(s.taxiIndex) === String(first.ID))
    rec.log("stand", `mainUi selected ${first.name} (ID ${first.ID}): call ${s1.state}; read back ${w1.ok ? `in ${w1.ms}ms` : `no: ${JSON.stringify(w1.sum)}`}`)
    find(w1.ok ? `From mainUi, setDepartureTaxiIndex selected stand ${first.name} (ID ${first.ID}) in ${w1.ms}ms.` : `From mainUi, setDepartureTaxiIndex didn't select stand ${first.name}: the call ${s1.state}, the departure ${JSON.stringify(w1.sum)}.`)
    if (w1.ok) expected = first

    const other = others.find((o) => o.reach.engine !== "undefined")
    if (!other) {
      find(`No other document on the world map has engine, so no shippable document was tried.`)
    } else {
      const second = taxis[Math.floor(taxis.length / 3)]
      const s2 = await setStand(other.insp, second)
      const w2 = await waitFor(insp, (s) => String(s.taxiIndex) === String(second.ID))
      const label = other.page.title || other.page.url
      rec.log("stand", `${label} selected ${second.name} (ID ${second.ID}): call ${s2.state}; mainUi read back ${w2.ok ? `in ${w2.ms}ms` : "no"}`)
      find(w2.ok ? `From ${label}, setDepartureTaxiIndex selected stand ${second.name} in ${w2.ms}ms, as mainUi read it.` : `From ${label}, setDepartureTaxiIndex didn't select stand ${second.name}: the call ${s2.state}.`)
      if (w2.ok) expected = second
    }
  }

  await sleep(800)
  const shot = await shooter.shot("world-map")
  rec.log("shot", shot.error ?? `saved ${repoRelative(shot.file)}`)

  for (const o of others) { try { await o.insp.evaluate(CLEAN) } catch { /* gone */ } o.insp.close() }
  try { await insp.evaluate(CLEAN) } catch { /* gone */ }
  insp.close()

  const fltBefore = (() => { try { return statSync(FLT).mtimeMs } catch { return 0 } })()
  beep(880, 150)
  say(expected ? `The probe set ${AIRPORT.split("").join(" ")}, stand ${expected.name}. Click Fly, and press Page Down when you're in the cockpit. Page Up skips.` : "The probe couldn't set a stand. Press Page Up to finish.")
  rec.log("prompt", expected ? `Set ${AIRPORT}, stand ${expected.name}. Click Fly, and Page Down when you're in the cockpit; Page Up skips.` : "No stand was set. Page Up to finish.")
  const k = await keys.next()
  if (k.key === "START") {
    const p = await sim.read([["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE HEADING DEGREES TRUE", "degrees"], ["SIM ON GROUND", "bool"]])
    const pos = `${p.get("PLANE LATITUDE").toFixed(6)}, ${p.get("PLANE LONGITUDE").toFixed(6)}, heading ${p.get("PLANE HEADING DEGREES TRUE").toFixed(1)} true`
    rec.log("position", pos)
    let dep = "unreadable"
    try {
      const text = readFileSync(FLT, "utf8")
      const m = text.match(/\[Departure\][^[]*/i)
      dep = m ? m[0].trim() : "no [Departure] section"
      rec.log("flt", `${statSync(FLT).mtimeMs > fltBefore ? "written at Fly" : "not rewritten"}: ${dep.replace(/\r?\n/g, "; ")}`)
    } catch (e) { rec.log("flt", `couldn't read the flight file: ${e.message}`) }
    find(`After Fly: the aircraft is at ${pos}; the flight file's ${dep.replace(/\r?\n/g, "; ")}.`)
    const s = await shooter.shot("after-fly")
    rec.log("shot", s.error ?? `saved ${repoRelative(s.file)}`)
  }
  beep(660, 400)
  say("Done.")

  const text = scrub([`p07-world-map, started ${new Date(rec.started).toISOString()}`, "", ...findings.map((f) => `- ${f}`)].join("\n"))
  rec.writeReport(text)
  console.log("\n" + text)
  console.log(`saved ${repoRelative(rec.files.txt)}`)
  shooter.close()
  sim.close()
  await rec.close()
  process.exit(0)
}

main().catch(async (e) => {
  rec.log("error", e.stack ?? String(e))
  await rec.close()
  process.exit(1)
})
