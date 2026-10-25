/*
 * p20: whether code in the EFB's document can make Go to's requests on the
 * world map, choosing the departure airport and then a stand, so an EFB app of
 * ours could run Go to without the menu script BlurPage brings in (record/
 * decisions/003-watcher-keeps-blurpage-copy-current.md). Stage 11b's
 * EFB-only question (user, 2026-10-25).
 *
 *   node experiments/areas/interface/p20-efb-go-to.mjs
 *
 * Needs Free flight's world map open, with the sim in front for the screenshot.
 * Nobody needs to touch anything, and nobody clicks Fly.
 *
 * p07 made both requests from the menu's document, mainUi: the airport through
 * the airport search's view listener, JS_LISTENER_AIRPORT_SEARCH, with
 * AIRPORT_INPUT_TEXT, then ON_DEPARTURE_AIRPORT_SELECTED with the result's index
 * and database; the stand with engine.call("requestData",
 * "game/currentFlight/setDepartureTaxiIndex", <stand ID>), which also worked from
 * Atlas's document (measured on MSFS 2024, 2026-10-05, record/areas/interface/
 * log.md). The EFB's document has engine and Coherent and the sim's common.js,
 * but not the menu's data store (same entry), so this makes every request from
 * the EFB's document and reads the departure back from mainUi's store:
 *   1. the airport, by the search's events sent bare through engine.trigger, as
 *      p07 sent them from mainUi;
 *   2. if that hears no results, the airport again, through a view listener the
 *      EFB's document registers itself with the sim's RegisterViewListener;
 *   3. if neither chose it, the airport from the toolbar's document, where our
 *      toolbar icon's script runs (record/areas/interface/log.md, 2026-10-04),
 *      then from the world map's atlas page, which may be the "Atlas" the
 *      2026-10-05 entry meant, then from mainUi, as p07 chose it, the control
 *      that says whether the search works at all;
 *   4. a different stand from each of those documents, by its ID, through
 *      requestData;
 *   5. a screenshot of the world map.
 * It leaves the departure where it put it, and removes its listeners.
 */

import fs from "node:fs"
import path from "node:path"

import { Inspector, listPages } from "../../tools/inspector.mjs"
import { repoRelative, resultFile, stamp } from "../../tools/results.mjs"
import { startShooter } from "../../tools/shot.mjs"

const UID = "DUALINPUT_P20"
const DEPARTURE = "game/currentFlight/gameFlight/departure"
const when = stamp()
const lines = []
const note = (...texts) => { for (const t of texts) { lines.push(t); console.log(t) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- in the documents

// Both documents get this, in ES2017's syntax. get() reads the menu's store,
// which only mainUi has; the rest runs in the EFB's document.
const INSTALL = `(function () {
  var p = window.DUALINPUT_P20;
  if (!p) {
    p = window.DUALINPUT_P20 = { slots: {}, handles: [], results: [], listener: null, ready: false };
    p.get = function (path) {
      var l = window._globalDataLoader;
      if (!l) return { state: "no _globalDataLoader" };
      var d = l.getData(path);
      try { return { state: d ? "ok" : "no data", value: d ? JSON.parse(JSON.stringify(d.value)) : null }; }
      catch (e) { return { state: "unreadable", error: String(e) }; }
    };
    p.call = function (key, name, args) {
      p.slots[key] = { state: "pending" };
      try {
        engine.call.apply(engine, [name].concat(args)).then(
          function (v) { p.slots[key] = { state: "resolved", value: v === undefined ? null : v }; },
          function (e) { p.slots[key] = { state: "rejected", error: String(e) }; });
      } catch (e) { p.slots[key] = { state: "threw", error: String(e) }; }
      return "started";
    };
    var onResults = function (uid, list) { if (uid === "${UID}") p.results.push(list); };
    p.onResults = onResults;
    try {
      p.handles.push(engine.on("EVENT_FROM_VIEW_LISTENER", function (name, ev, uid, list) {
        if (ev === "ResultsUpdated") onResults(uid, list);
      }));
    } catch (e) {}
    p.register = function () {
      if (p.listener) return "registered already";
      p.listener = RegisterViewListener("JS_LISTENER_AIRPORT_SEARCH", function () { p.ready = true; });
      p.listener.on("ResultsUpdated", onResults);
      return "registering";
    };
  }
  return {
    title: document.title, engine: typeof engine, Coherent: typeof Coherent,
    RegisterViewListener: typeof RegisterViewListener, store: typeof window._globalDataLoader,
  };
})()`

const CLEAN = `(function () {
  var p = window.DUALINPUT_P20;
  if (!p) return "nothing";
  for (var i = 0; i < p.handles.length; i++) { try { p.handles[i].clear(); } catch (e) {} }
  try { if (p.listener) p.listener.unregister(); } catch (e) {}
  window.DUALINPUT_P20 = undefined;
  return "cleaned";
})()`

// ---------------------------------------------------------------- the steps

const departure = async (menu) => (await menu.evaluate(`window.DUALINPUT_P20.get(${JSON.stringify(DEPARTURE)})`)).value

function summarize(dep, icao) {
  if (!dep) return { set: false }
  const wl = dep.worldLocation ?? {}
  const taxis = wl.airportInfos?.taxis ?? []
  const taxi = taxis.find((t) => String(t.ID) === String(dep.taxiIndex))
  return { isAirport: icao ? JSON.stringify(wl).includes(`"${icao}"`) : null, title: wl.title ?? wl.name ?? null, stand: taxi ? taxi.name : null, taxiIndex: dep.taxiIndex ?? null, stands: taxis.length }
}

async function waitFor(menu, test, ms = 6000) {
  const t0 = Date.now()
  let dep
  while (Date.now() - t0 < ms) {
    dep = await departure(menu)
    if (test(dep)) return { ok: true, dep, ms: Date.now() - t0 }
    await sleep(150)
  }
  return { ok: false, dep }
}

async function results(efb, ms = 4000) {
  for (let t = 0; t < ms; t += 100) {
    const r = await efb.evaluate("window.DUALINPUT_P20.results")
    if (r && r.length) return r[r.length - 1]
    await sleep(100)
  }
  return null
}

// One way to send the search's events from one document, `from`. `send`
// returns the expression that sends one event.
async function chooseAirport(from, menu, icao, how, send) {
  await from.evaluate("window.DUALINPUT_P20.results.length = 0")
  const sent = await from.evaluate(send("AIRPORT_INPUT_TEXT", [UID, icao, "ON_DEPARTURE_AIRPORT_SELECTED"]))
  const list = await results(from)
  if (!list) { note(`  ${how}: the search (${sent}) answered nothing in 4s.`); return null }
  const hit = list.find((x) => x.ICAO === icao)
  note(`  ${how}: the search answered ${list.length} results${hit ? `, ${icao} at index ${hit.index}, database ${hit.database}` : `, none ${icao}`}.`)
  if (!hit) return null
  await from.evaluate(send("ON_DEPARTURE_AIRPORT_SELECTED", [hit.index, hit.database]))
  const w = await waitFor(menu, (d) => summarize(d, icao).isAirport && summarize(d, icao).stands > 0)
  note(w.ok ? `  ${how}: the departure became ${icao} in ${w.ms}ms, as mainUi read it: ${summarize(w.dep, icao).stands} stands.` : `  ${how}: the departure didn't become ${icao} in 6s: ${JSON.stringify(summarize(w.dep, icao))}`)
  return w.ok ? w.dep : null
}

const bare = (ev, args) => `(function () { try { engine.trigger.apply(engine, ${JSON.stringify(["EVENT_TO_VIEW_LISTENER", "JS_LISTENER_AIRPORT_SEARCH", ev])}.concat(${JSON.stringify(args)})); return "sent"; } catch (e) { return "threw: " + e; } })()`
const viaListener = (ev, args) => `(function () { try { var l = window.DUALINPUT_P20.listener; l.trigger.apply(l, ${JSON.stringify([ev])}.concat(${JSON.stringify(args)})); return "sent"; } catch (e) { return "threw: " + e; } })()`

// Selects a stand by its ID from one document, and reads it back from mainUi.
async function chooseStand(from, menu, taxi, how) {
  const key = `stand-${taxi.ID}`
  await from.evaluate(`window.DUALINPUT_P20.call(${JSON.stringify(key)}, "requestData", ${JSON.stringify(["game/currentFlight/setDepartureTaxiIndex", String(taxi.ID)])})`)
  let call = { state: "pending" }
  for (let i = 0; i < 50 && call.state === "pending"; i++) { await sleep(100); call = await from.evaluate(`window.DUALINPUT_P20.slots[${JSON.stringify(key)}]`) }
  const w = await waitFor(menu, (d) => String(d?.taxiIndex) === String(taxi.ID), 3000)
  const answer = call.state === "rejected" || call.state === "threw" ? `${call.state}: ${call.error}` : call.state
  note(w.ok ? `  ${how}: requestData selected ${taxi.name} (ID ${taxi.ID}) in ${w.ms}ms, as mainUi read it; the call ${answer}.` : `  ${how}: requestData didn't select ${taxi.name} (ID ${taxi.ID}); the call ${answer}.`)
  return w.ok
}

async function main() {
  const pages = await listPages()
  const byTitle = (t) => pages.find((p) => String(p.title || "") === t)
  const menuPage = pages.find((p) => /mainUi/i.test(String(p.title)) || /mainUI\.html/i.test(String(p.url)))
  const efbPage = byTitle("Electronic Flight Bag")
  if (!menuPage || !efbPage) throw new Error(`need mainUi and the EFB's document; have: ${pages.map((p) => p.title || p.url).join(" | ")}`)

  // The EFB's document, then two the world map has that our package can reach
  // or that the 2026-10-05 entry may have meant: the toolbar's, where our
  // toolbar icon's script runs, and the world map's own atlas page.
  const others = [["the EFB's document", efbPage], ["the toolbar's document", byTitle("Toolbar")], ["the world map's atlas page", byTitle("atlas")]].filter(([, p]) => p)
  const menu = new Inspector(menuPage.id)
  await menu.open()
  const docs = []
  try {
    note(`p20-efb-go-to, ${new Date().toISOString()}`, "")
    note(`mainUi (${menuPage.url}): ${JSON.stringify(await menu.evaluate(INSTALL))}`)
    for (const [label, page] of others) {
      const insp = new Inspector(page.id)
      await insp.open()
      docs.push({ label, insp })
      note(`${label} (${page.url}): ${JSON.stringify(await insp.evaluate(INSTALL))}`)
    }
    const efb = docs[0].insp

    const before = summarize(await departure(menu))
    const icao = /KSEA/i.test(JSON.stringify(before)) ? "KPDX" : "KSEA"
    note(`Before: the departure was ${before.title || "unset"}${before.stand ? `, stand ${before.stand}` : ""}; this run chooses ${icao}.`, "")

    note("The airport:")
    let dep = await chooseAirport(efb, menu, icao, "the EFB's document, engine.trigger bare", bare)
    if (!dep) {
      note(`  the EFB's document, RegisterViewListener: ${await efb.evaluate("window.DUALINPUT_P20.register()")}`)
      for (let i = 0; i < 30 && !(await efb.evaluate("window.DUALINPUT_P20.ready")); i++) await sleep(100)
      note(`  the listener is ${(await efb.evaluate("window.DUALINPUT_P20.ready")) ? "ready" : "not ready after 3s"}.`)
      dep = await chooseAirport(efb, menu, icao, "the EFB's document, its own view listener", viaListener)
    }
    for (const d of docs.slice(1)) if (!dep) dep = await chooseAirport(d.insp, menu, icao, `${d.label}, engine.trigger bare`, bare)
    if (!dep) {
      note("  the control, mainUi as p07 chose it:")
      dep = await chooseAirport(menu, menu, icao, "mainUi, engine.trigger bare", bare)
    }

    note("", "The stand, a different one from each document:")
    if (!dep) note("  skipped, with no airport chosen.")
    else {
      const taxis = dep.worldLocation.airportInfos.taxis
      for (const [i, d] of docs.entries()) await chooseStand(d.insp, menu, taxis[Math.floor(taxis.length * (i + 1) / (docs.length + 2))], d.label)
      await chooseStand(menu, menu, taxis[Math.floor(taxis.length * (docs.length + 1) / (docs.length + 2))], "the control, mainUi")

      // The EFB's document has no requestData call bound, and the sim's error
      // says to use engine.trigger when the result isn't needed.
      note("", "The stand, from the EFB's document, sent with engine.trigger:")
      const taxi = taxis[Math.floor(taxis.length / 7)]
      const sent = await efb.evaluate(`(function () { try { engine.trigger("requestData", "game/currentFlight/setDepartureTaxiIndex", ${JSON.stringify(String(taxi.ID))}); return "sent"; } catch (e) { return "threw: " + e; } })()`)
      const w = await waitFor(menu, (d) => String(d?.taxiIndex) === String(taxi.ID), 3000)
      note(w.ok ? `  selected ${taxi.name} (ID ${taxi.ID}) in ${w.ms}ms, as mainUi read it.` : `  didn't select ${taxi.name} (ID ${taxi.ID}) in 3s (${sent}).`)
    }

    // The store's own setter for the departure, with the airport's world
    // location, which p07 wrote as its fallback and never needed: a way to
    // choose the airport without the search, which answers only mainUi.
    const other = icao === "KSEA" ? "KPDX" : "KSEA"
    note("", `The airport by its world location, ${other}:`)
    const toolbar = docs.find((d) => d.label === "the toolbar's document")
    if (!toolbar) note("  skipped, with no toolbar's document.")
    else {
      await toolbar.insp.evaluate(`window.DUALINPUT_P20.call("fromICAO", "requestData", ${JSON.stringify(["game/worldmap/worldLocations/fromICAO", other])})`)
      await sleep(1500)
      const got = await toolbar.insp.evaluate(`window.DUALINPUT_P20.get(${JSON.stringify(`game/worldmap/worldLocations/fromICAO/${other}`)})`)
      const loc = got.value ?? {}
      note(`  the toolbar's document read the location: ${got.state}; its keys: ${Object.keys(loc).join(", ") || "none"}`)
      const id = ["uID", "uid", "ID", "id", "guid"].find((k) => loc[k] !== undefined)
      if (!id) note("  no identifier to pass.")
      else {
        for (const [label, send] of [
          ["the toolbar's document, engine.call", (insp) => insp.evaluate(`window.DUALINPUT_P20.call("free", "requestData", ${JSON.stringify(["game/currentFlight/setFreeflightDeparture", String(loc[id])])})`)],
          ["the EFB's document, engine.trigger", (insp) => insp.evaluate(`(function () { try { engine.trigger("requestData", "game/currentFlight/setFreeflightDeparture", ${JSON.stringify(String(loc[id]))}); return "sent"; } catch (e) { return "threw: " + e; } })()`)],
        ]) {
          const insp = label.startsWith("the toolbar") ? toolbar.insp : efb
          await send(insp)
          const w = await waitFor(menu, (d) => summarize(d, other).isAirport && summarize(d, other).stands > 0, 4000)
          note(w.ok ? `  ${label}, setFreeflightDeparture(${id} ${loc[id]}): the departure became ${other} in ${w.ms}ms.` : `  ${label}, setFreeflightDeparture(${id} ${loc[id]}): the departure didn't become ${other} in 4s.`)
          if (w.ok && label.startsWith("the toolbar")) {
            // Back to the first airport, so the EFB's try has a change to make.
            await chooseAirport(menu, menu, icao, "  (back to the first airport, from mainUi)", bare)
          }
        }
      }
    }

    await sleep(800)
    const shooter = startShooter(path.join(path.dirname(resultFile("interface", "p20-efb-go-to", "txt", when)), `p20-efb-go-to-${when}`))
    const shot = await shooter.shot("world-map")
    shooter.close()
    note("", `After: ${JSON.stringify(summarize(await departure(menu), icao))}`)
    note(`Screenshot: ${shot.error ? shot.error : repoRelative(shot.file)}`)
  } finally {
    for (const insp of [...docs.map((d) => d.insp), menu]) { try { await insp.evaluate(CLEAN) } catch { /* gone */ } insp.close() }
  }
  const file = resultFile("interface", "p20-efb-go-to", "txt", when)
  fs.writeFileSync(file, lines.join("\n") + "\n")
  console.log(`saved ${repoRelative(file)}`)
}

main().catch((e) => { console.error(e.stack ?? String(e)); process.exit(1) })
