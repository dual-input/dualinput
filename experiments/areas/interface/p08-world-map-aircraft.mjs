/*
 * p08: whether code outside the world map's own can choose the aircraft, its
 * variant, and its livery, and start the flight, the steps after p07's
 * departure and stand (record/areas/product/ideas.md, "The PF's spot on the
 * world map").
 *
 *   node experiments/areas/interface/p08-world-map-aircraft.mjs
 *   node experiments/areas/interface/p08-world-map-aircraft.mjs --aircraft a220 --no-launch
 *
 * Every call is the one the world map's own code makes (read in fs-base-ui
 * 0.1.10, html_ui/Global/pkg/base.bundle.js):
 *   - picking a tile in Free flight's aircraft list sends
 *     game/aircraft/configurator/setAircraftForConfigurator with
 *     "<aircraftId>||<variationIndex>" (PlaneSelectionFreeflightPageManipulator,
 *     _selectAircraft), from the list at game/aircraft/aircraftList;
 *   - the configurator's variant page sends game/aircraft/configurator/selectItem
 *     and its livery page game/aircraft/configurator/saveVariationId, each with
 *     the clicked item's id, from configurator/items and configurator/liveries
 *     (the configurator manipulator, _onClick);
 *   - Fly sends game/currentFlight/launchFlight with "" (initFlyButton).
 * Each goes through engine.call("requestData", path, arg), as p07 found for
 * the departure's (record/areas/interface/log.md, once written;
 * results/p07-world-map-2026-10-05-18-02-58.txt).
 *
 * The pilot opens Free flight's world map and presses Page Down. The probe,
 * through the inspector in mainUi:
 *   0. sets the departure, --airport (default KSEA) and a stand, as p07 does,
 *      since the sim refuses launchFlight without one;
 *   1. reads game/aircraft/currentAircraft and the aircraft list, and finds the
 *      aircraft whose name holds --aircraft (default "a220");
 *   2. sends setAircraftForConfigurator for it and reads currentAircraft back,
 *      which says whether that call alone chooses the flight's aircraft;
 *   3. reads the configurator's items and liveries, and selects the second
 *      livery, if there is one, then reads them back;
 *   4. takes a screenshot of the world map;
 *   5. unless --no-launch, sends launchFlight, and through SimConnect waits for
 *      the sim's FlightLoaded and AircraftLoaded, and reads TITLE and LIVERY NAME.
 * The store's field names aren't documented, so every value it reads goes into
 * the NDJSON whole.
 */

import { dirname, join } from "node:path"

import { Recorder, repoRelative, scrub, sleep } from "../aircraft/lib/out.mjs"
import { Sim } from "../aircraft/lib/sim.mjs"
import { Inspector, listPages } from "../../tools/inspector.mjs"
import { startBeeper, startKeys, startSpeaker } from "../../tools/guide.mjs"
import { startShooter } from "../../tools/shot.mjs"

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const WANT = (flag("--aircraft") ?? "a220").toLowerCase()
const AIRPORT = (flag("--airport") ?? "KSEA").toUpperCase()
const LAUNCH = !args.includes("--no-launch")

const rec = new Recorder("p08-world-map-aircraft", { area: "interface" })
const findings = []
const find = (text) => { findings.push(text); rec.log("finding", text) }

// ---------------------------------------------------------------- in mainUi

// Runs in the document: Chrome 49's syntax, no optional chaining or ??.
const INSTALL = `(function () {
  var p = window.CROSSCHECK_P08;
  if (!p) {
    p = window.CROSSCHECK_P08 = { slots: {} };
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
    p.results = [];
    p.handles = [];
    try {
      p.handles.push(engine.on("ResultsUpdated", function (uid, list) { if (uid === "CROSSCHECK_P08") p.results.push(list); }));
    } catch (e) {}
  }
  return { engine: typeof engine, loader: typeof window._globalDataLoader };
})()`

const CLEAN = `(function () {
  var p = window.CROSSCHECK_P08;
  if (p) for (var i = 0; i < p.handles.length; i++) { try { p.handles[i].clear(); } catch (e) {} }
  window.CROSSCHECK_P08 = undefined;
  return "cleaned";
})()`

const trigger = (insp, triggerArgs) =>
  insp.evaluate(`(function () { try { engine.trigger.apply(engine, ${JSON.stringify(triggerArgs)}); return "sent"; } catch (e) { return "threw: " + e; } })()`)

async function call(insp, key, name, callArgs, ms = 5000) {
  await insp.evaluate(`window.CROSSCHECK_P08.call(${JSON.stringify(key)}, ${JSON.stringify(name)}, ${JSON.stringify(callArgs)})`)
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const s = await insp.evaluate(`window.CROSSCHECK_P08.slots[${JSON.stringify(key)}]`)
    if (s && s.state !== "pending") return s
    await sleep(100)
  }
  return { state: `no answer in ${ms / 1000}s` }
}

const request = (insp, path, arg) => call(insp, `${path}:${arg}`, "requestData", [path, arg])
const get = (insp, path) => insp.evaluate(`window.CROSSCHECK_P08.get(${JSON.stringify(path)})`)

// A list route's value may be the array itself or an object holding it, and
// the probe can't know which before it runs, so it takes the first array it
// finds.
function arrayIn(v) {
  if (Array.isArray(v)) return v
  if (v && typeof v === "object") for (const x of Object.values(v)) if (Array.isArray(x)) return x
  return null
}

// The world map's lists read through requestArrayElements(path, start, count),
// the store's requestRange (read in lib.js), so that comes first; then a plain
// getData, and then requestData, which makes the sim fill a path, as the
// store's own request() does before its getData (GlobalDataListener.request).
async function readList(insp, path) {
  const range = await call(insp, `range:${path}`, "requestArrayElements", [path, 0, 400])
  rec.data("store", `${path}: requestArrayElements ${range.state}`, { path, range })
  if (arrayIn(range.value)) return { state: "requestArrayElements", list: arrayIn(range.value), raw: range.value }
  // requestArrayElements answers with the list's length, and the entries are
  // then at path/0, path/1, and so on, as the world map's own list fetcher
  // reads them (read in lib.js, fetchWithoutCache and getElement).
  if (typeof range.value === "number") {
    const list = []
    for (let i = 0; i < Math.min(range.value, 400); i++) list.push((await get(insp, `${path}/${i}`)).value)
    const brief = (x) => (x && typeof x === "object" ? { aircraftId: x.aircraftId, variationIndex: x.variationIndex, variationId: x.variationId, id: x.id, displayName: x.displayName, variation: x.variation, name: x.name, creator: x.creator } : x)
    rec.data("store", `${path}: ${list.length} entries`, { path, list: list.map(brief) })
    return { state: `${range.value} entries`, list, raw: range.value }
  }
  let g = await get(insp, path)
  if (!arrayIn(g.value)) { await request(insp, path, ""); await sleep(300); g = await get(insp, path) }
  rec.data("store", `${path}: ${g.state}`, { path, value: g.value })
  return { state: g.state, list: arrayIn(g.value), raw: g.value }
}

// The departure p07 set, by the same calls (results/p07-world-map-2026-10-05-
// 18-02-58.txt): Start flight stays disabled without one, and launchFlight
// sent anyway brings up the sim's "Unexpected error" dialog (2026-10-05,
// results/p08-world-map-aircraft-2026-10-05-19-29-24.txt).
async function setDeparture(insp) {
  await insp.evaluate("window.CROSSCHECK_P08.results.length = 0")
  await trigger(insp, ["EVENT_TO_VIEW_LISTENER", "JS_LISTENER_AIRPORT_SEARCH", "AIRPORT_INPUT_TEXT", "CROSSCHECK_P08", AIRPORT, "ON_DEPARTURE_AIRPORT_SELECTED"])
  let list = null
  for (let i = 0; i < 40 && !list; i++) {
    await sleep(100)
    const r = await insp.evaluate("window.CROSSCHECK_P08.results")
    if (r && r.length) list = r[r.length - 1]
  }
  const hit = list ? list.find((x) => x.ICAO === AIRPORT) : null
  if (!hit) return find(`The airport search found no ${AIRPORT}, so no departure was set.`)
  await trigger(insp, ["EVENT_TO_VIEW_LISTENER", "JS_LISTENER_AIRPORT_SEARCH", "ON_DEPARTURE_AIRPORT_SELECTED", hit.index, hit.database])
  let dep = null
  for (let i = 0; i < 30; i++) {
    await sleep(150)
    dep = (await get(insp, "game/currentFlight/gameFlight/departure")).value
    if (dep && JSON.stringify(dep.worldLocation ?? {}).includes(`"${AIRPORT}"`) && (dep.worldLocation.airportInfos?.taxis ?? []).length) break
  }
  const taxis = dep?.worldLocation?.airportInfos?.taxis ?? []
  if (!taxis.length) return find(`${AIRPORT} was selected, but its stands didn't arrive.`)
  const stand = taxis[Math.floor(taxis.length / 2)]
  await request(insp, "game/currentFlight/setDepartureTaxiIndex", String(stand.ID))
  find(`Departure set first, as p07 does: ${AIRPORT}, stand ${stand.name}.`)
}

const label = (x) => (x ? x.displayName ?? x.name ?? x.title ?? x.variation ?? JSON.stringify(x).slice(0, 80) : "none")

async function main() {
  rec.open()
  const keys = await startKeys()
  const beep = startBeeper()
  const say = startSpeaker()
  const shooter = startShooter(join(dirname(rec.files.txt), `p08-world-map-aircraft-${rec.when}`))
  const sim = await Sim.connect(rec, { name: "CROSSCHECK p08 world map aircraft" })
  sim.track()
  await sleep(1500)

  beep(880, 150)
  say("Open Free flight's world map. Leave the aircraft alone, keep the sim in front, and press Page Down.")
  rec.log("prompt", `Open Free flight's world map. Leave the aircraft alone, keep the sim in front, and Page Down. The probe picks the aircraft whose name holds "${WANT}"${LAUNCH ? " and starts the flight" : ""}.`)
  await keys.next()
  say("Hands off. Working.")

  const pages = await listPages()
  const main = pages.find((p) => /mainUi/i.test(String(p.title)) || /mainUI\.html/i.test(String(p.url)))
  if (!main) throw new Error("no mainUi document; is the world map open?")
  const insp = new Inspector(main.id)
  await insp.open()
  rec.log("reach", `mainUi: ${JSON.stringify(await insp.evaluate(INSTALL))}`)

  await setDeparture(insp)

  const before = await get(insp, "game/aircraft/currentAircraft")
  rec.data("store", "currentAircraft before", { value: before.value })
  find(`Before: currentAircraft is ${before.state}, ${label(before.value)}.`)

  // The aircraft page asks for the list when it opens (read in base.bundle.js,
  // PlaneSelectionFreeflightPageManipulator.onActivation), and the world map
  // may not have opened it.
  const update = await request(insp, "game/aircraft/updateAircraftList", "")
  rec.log("aircraft", `updateAircraftList: ${update.state}`)
  const aircraft = await readList(insp, "game/aircraft/aircraftList")
  if (!aircraft.list) {
    find(`game/aircraft/aircraftList held no list (${aircraft.state}), so no aircraft was picked.`)
  } else {
    const hit = aircraft.list.find((a) => JSON.stringify(a).toLowerCase().includes(WANT))
    rec.log("aircraft", `${aircraft.list.length} in the list; the first one's keys: ${Object.keys(aircraft.list[0] ?? {}).join(", ")}; "${WANT}": ${hit ? label(hit) : "none"}`)
    if (!hit) {
      find(`No aircraft in the list of ${aircraft.list.length} has "${WANT}" in it.`)
    } else {
      const id = `${hit.aircraftId ?? hit.id}||${hit.variationIndex ?? 0}`
      const r = await request(insp, "game/aircraft/configurator/setAircraftForConfigurator", id)
      await sleep(800)
      const after = await get(insp, "game/aircraft/currentAircraft")
      rec.data("store", "currentAircraft after", { value: after.value })
      const changed = JSON.stringify(after.value) !== JSON.stringify(before.value)
      find(`setAircraftForConfigurator("${id}") ${r.state}; currentAircraft ${changed ? `changed to ${label(after.value)}` : "didn't change"}.`)

      const items = await readList(insp, "game/aircraft/configurator/items")
      const liveries = await readList(insp, "game/aircraft/configurator/liveries")
      rec.log("configurator", `${items.list ? items.list.length : "no"} items, ${liveries.list ? liveries.list.length : "no"} liveries`)
      if (liveries.list && liveries.list.length > 1) {
        const pick = liveries.list[1]
        const lid = pick.id ?? pick.variationId ?? pick.ID
        const s = await request(insp, "game/aircraft/configurator/saveVariationId", String(lid))
        await sleep(800)
        const now = await get(insp, "game/aircraft/currentAircraft")
        rec.data("store", "currentAircraft after the livery", { value: now.value })
        find(`saveVariationId("${lid}"), the livery ${label(pick)}: ${s.state}; currentAircraft ${JSON.stringify(now.value) !== JSON.stringify(after.value) ? `changed to ${label(now.value)}` : "didn't change"}.`)
      } else {
        find(`The configurator listed ${liveries.list ? liveries.list.length : "no"} liveries, so none was picked.`)
      }
    }
  }

  await sleep(500)
  const shot = await shooter.shot("world-map")
  rec.log("shot", shot.error ?? `saved ${repoRelative(shot.file)}`)

  if (LAUNCH) {
    const seen = { flightLoaded: null, aircraftLoaded: [] }
    sim.systemHandlers.add((name, data) => {
      if (name === "FlightLoaded" && seen.flightLoaded === null) seen.flightLoaded = Date.now()
      if (name === "AircraftLoaded") seen.aircraftLoaded.push({ t: Date.now(), path: data })
    })
    const t0 = Date.now()
    const r = await request(insp, "game/currentFlight/launchFlight", "")
    rec.log("launch", `launchFlight: ${r.state}`)
    say("The probe started the flight. Press Page Down when you're in the cockpit, or Page Up if nothing happened.")
    rec.log("prompt", "The probe sent launchFlight. Page Down when you're in the cockpit, or Page Up if the world map stayed.")
    const k = await keys.next()
    if (seen.flightLoaded) find(`launchFlight started the flight: the sim's FlightLoaded came ${((seen.flightLoaded - t0) / 1000).toFixed(1)}s after it.`)
    else find(`No FlightLoaded followed launchFlight before the pilot's ${k.key === "START" ? "Page Down" : "Page Up"}.`)
    if (k.key === "START") {
      const v = await sim.readStrings(["TITLE", "LIVERY NAME", "ATC ID"]).catch(() => null)
      const loaded = seen.aircraftLoaded.map((a) => String(a.path ?? "").split("\\").slice(-4).join("\\"))
      find(`In the cockpit: TITLE ${v ? JSON.stringify(v.get("TITLE")) : "unread"}, LIVERY NAME ${v ? JSON.stringify(v.get("LIVERY NAME")) : "unread"}; AircraftLoaded ${loaded.length ? loaded.join(", ") : "none"}.`)
      const s = await shooter.shot("after-launch")
      rec.log("shot", s.error ?? `saved ${repoRelative(s.file)}`)
    }
  }

  try { await insp.evaluate(CLEAN) } catch { /* the document may have gone */ }
  insp.close()
  beep(660, 400)
  say("Done.")

  const text = scrub([`p08-world-map-aircraft, started ${new Date(rec.started).toISOString()}`, "", ...findings.map((f) => `- ${f}`)].join("\n"))
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
