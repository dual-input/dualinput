/*
 * p10: can a package of ours, with no inspector, put code into the world
 * map's documents that sets the departure, stand, and aircraft and starts the
 * flight? The plan's step 6 question left open by p07 and p08, which ran the
 * same chain through the inspector (record/areas/interface/log.md,
 * 2026-10-05, "A package reaches the menu's document by shipping its own copy
 * of one of the sim's UI components").
 *
 *   node experiments/areas/interface/menu/build.mjs     with MSFS closed
 *   node experiments/areas/interface/p10-menu-package.mjs [--airport KSEA] [--stand PARKING] [--aircraft "<display name>"] [--no-launch]
 *
 * crosscheck-p10-menu (interface/menu/build.mjs) carries p10-menu.js and puts
 * it into a document through our toolbar icon, and, if built with
 * --cookedcomp, through our copy of one of the menu's UI components. The
 * script says hello to p10 on 127.0.0.1:47810 from every document it loads in
 * and runs the world map's requests when p10 tells it to, so p10 plays
 * Crosscheck's core.
 *
 * The pilot opens Free flight's world map and presses Page Down. p10 then:
 *   1. lists the documents our script reached, by its hellos, and checks each
 *      of the sim's documents for it through the inspector, which only reads;
 *   2. saves the menu's UI components that mainUi loaded, the stock copies a
 *      --cookedcomp build needs, to experiments/sim-sources/menu/cookedcomps/;
 *   3. tells the first copy in a document with the store to set the
 *      departure airport, a stand, and the aircraft, and reads the departure
 *      back through the inspector in mainUi;
 *   4. takes a screenshot, and unless --no-launch, tells the script to start
 *      the flight, and reads the aircraft through SimConnect once the pilot is
 *      in the cockpit.
 *
 * The aircraft defaults to the Black Square Baron 58P, the next probe's.
 */

import { createServer } from "node:http"
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { Recorder, repoRelative, scrub, sleep } from "../aircraft/lib/out.mjs"
import { Sim } from "../aircraft/lib/sim.mjs"
import { Inspector, flattenResources, listPages, resourceContent } from "../../tools/inspector.mjs"
import { startBeeper, startKeys, startSpeaker } from "../../tools/guide.mjs"
import { simSourcesDir } from "../../tools/results.mjs"
import { startShooter } from "../../tools/shot.mjs"

const PORT = 47_810
const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] ?? null }
const AIRPORT = opt("--airport") ?? "KSEA"
const STAND = opt("--stand") ?? "PARKING"
const AIRCRAFT = opt("--aircraft") ?? "Black Square Baron 58P Professional"
const LAUNCH = !argv.includes("--no-launch")
const DEPARTURE = "game/currentFlight/gameFlight/departure"

// The components Flow Pro copies, which ours must not (read in
// p42-util-flow-pro 26.33.5, cookedcomps/).
const FLOW_PRO = new Set(["3a799c8c-bed8-48de-b7d4-d30472668e33", "6a4dfddf-022f-461c-8ec9-7d7c76acecc5", "9721da52-75a5-4894-aa68-60c217974791", "a50009b8-cd65-40b0-8985-a62f9eb4aa7e"])

const rec = new Recorder("p10-menu-package", { area: "interface" })
const findings = []
const find = (text) => { findings.push(text); rec.log("finding", text) }

// ---------------------------------------------------------------- the core's side

const copies = new Map()
const reports = []
const queue = []
let seq = 0

function body(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))) } catch { resolve(null) } })
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" }
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return }
  if (url.pathname === "/p10/next") {
    const id = Number(url.searchParams.get("id"))
    const since = Number(url.searchParams.get("since") ?? 0)
    let c = copies.get(id)
    if (!c) {
      c = { id, info: null, firstPoll: Date.now(), lastPoll: 0 }
      copies.set(id, c)
      // A copy that loaded before p10 started lost its hello, so ask again.
      queue.push({ seq: ++seq, to: id, op: "hello" })
    }
    c.lastPoll = Date.now()
    res.writeHead(200, { ...cors, "content-type": "application/json" })
    res.end(JSON.stringify(queue.filter((q) => q.to === id && q.seq > since)))
    return
  }
  const b = await body(req)
  if (b && url.pathname === "/p10/hello") {
    const c = copies.get(b.id) ?? { id: b.id, firstPoll: null, lastPoll: 0 }
    if (!c.info) rec.log("hello", `from ${JSON.stringify(b.title)} (${b.href}), loaded by ${b.via}: engine ${b.engine}, Coherent ${b.coherent}, _globalDataLoader ${b.loader}`, b)
    c.info = b
    copies.set(b.id, c)
  } else if (b && url.pathname === "/p10/report") {
    reports.push({ ...b, at: Date.now() })
    rec.log("script", `${b.step}: ${JSON.stringify(b.detail).slice(0, 600)}`, b)
  }
  res.writeHead(200, cors)
  res.end("ok")
})

const tell = (id, cmd) => { queue.push({ seq: ++seq, to: id, ...cmd }); rec.log("tell", `${cmd.op} to copy ${id}: ${JSON.stringify(cmd)}`) }

async function reportOf(id, step, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const r = reports.find((x) => x.id === id && x.step === step)
    if (r) return r
    await sleep(200)
  }
  return null
}

// ---------------------------------------------------------------- inspector reads

async function scan() {
  const pages = await listPages()
  const reached = []
  let main = null
  for (const p of pages) {
    const insp = new Inspector(p.id)
    try {
      await insp.open()
      const v = await insp.evaluate(`(function () { var s = window.CROSSCHECK_P10; return s ? { id: s.id, via: s.via, polls: s.polls, loaded: s.loaded } : null; })()`)
      if (v) reached.push({ title: p.title || p.url, ...v })
      if (/mainUi/i.test(String(p.title)) || /mainUI\.html/i.test(String(p.url))) main = { page: p, insp }
      else insp.close()
    } catch (e) {
      rec.log("scan", `${p.title || p.url}: ${e.message}`)
      insp.close()
    }
  }
  rec.log("scan", `${pages.length} documents; our script in ${reached.length}: ${JSON.stringify(reached)}`, { pages: pages.map((p) => p.title || p.url), reached })
  return { pages, reached, main }
}

async function saveComponents(insp) {
  await insp.send("Page.enable", {})
  const tree = await insp.send("Page.getResourceTree", {})
  const items = flattenResources(tree.result.frameTree).filter((r) => /cookedcomps/i.test(r.url))
  const dir = simSourcesDir("menu", "cookedcomps")
  const saved = []
  for (const r of items) {
    try {
      const text = await resourceContent(insp, r)
      const file = r.url.split(/[\\/]/).pop()
      writeFileSync(join(dir, file), text)
      const guid = (file.match(/\{?([0-9a-f-]{36})\}?/i)?.[1] ?? "").toLowerCase()
      saved.push({ file, bytes: text.length, flowPro: FLOW_PRO.has(guid) })
    } catch (e) {
      rec.log("components", `${r.url}: ${e.message}`)
    }
  }
  rec.data("components", `${saved.length} saved`, { saved })
  return { listed: items.length, saved }
}

// ---------------------------------------------------------------- main

async function main() {
  rec.open()
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(PORT, "127.0.0.1", resolve) })
  rec.log("server", `listening on 127.0.0.1:${PORT}`)
  const keys = await startKeys()
  const beep = startBeeper()
  const say = startSpeaker()
  const shooter = startShooter(join(dirname(rec.files.txt), `p10-menu-package-${rec.when}`))
  const sim = await Sim.connect(rec, { name: "CROSSCHECK p10 menu package" })
  sim.track()

  beep(880, 150)
  say("Open Free flight's world map. Leave everything alone, keep the sim in front, and press Page Down.")
  rec.log("prompt", "Open Free flight's world map, leave everything alone, sim in front, Page Down.")
  await keys.next()
  say("Hands off. Working.")
  await sleep(3000)

  // 1. Where our script runs.
  const live = [...copies.values()].filter((c) => Date.now() - c.lastPoll < 5000)
  find(`Copies of our script polling p10: ${live.length}${live.length ? `, in ${live.map((c) => `${JSON.stringify(c.info?.title ?? "?")} by its ${c.info?.via ?? "?"} (engine ${c.info?.engine}, store ${c.info?.loader})`).join("; ")}` : ""}.`)
  const { pages, reached, main } = await scan()
  find(`Through the inspector, our script is in ${reached.length} of ${pages.length} documents${reached.length ? `: ${reached.map((r) => `${JSON.stringify(r.title)} (${r.via})`).join(", ")}` : ""}.`)

  // 2. Stock components, for a --cookedcomp build.
  if (main) {
    const c = await saveComponents(main.insp)
    find(`mainUi had loaded ${c.listed} UI components from cookedcomps/; saved ${c.saved.length} to experiments/sim-sources/menu/cookedcomps/, ${c.saved.filter((s) => s.flowPro).length} of them ones Flow Pro copies.`)
  } else {
    find("No mainUi document, so no components were saved.")
  }

  // 3. The world map's chain, from our script.
  const target = live.find((c) => c.info && c.info.loader !== "undefined" && c.info.engine !== "undefined")
  if (!target) {
    find("No copy of our script runs in a document with the store, so nothing was set.")
  } else {
    const before = main ? await main.insp.evaluate(`(function () { var l = window._globalDataLoader; var d = l && l.getData(${JSON.stringify(DEPARTURE)}); return d && d.value ? { taxiIndex: d.value.taxiIndex, icao: JSON.stringify(d.value.worldLocation || {}).match(/"ICAO":"([A-Z0-9]+)"/) } : null; })()`).catch(() => null) : null
    rec.log("before", `mainUi's departure before: ${JSON.stringify(before)}`)
    const t0 = Date.now()
    tell(target.id, { op: "goto", airport: AIRPORT, stand: STAND, aircraft: AIRCRAFT, launch: false })
    const done = await reportOf(target.id, "done", 45_000) ?? await reportOf(target.id, "failed", 1)
    const steps = reports.filter((r) => r.id === target.id && r.at >= t0)
    const step = (name) => steps.find((r) => r.step === name)
    const dep = step("departure")
    const stand = step("stand")
    const aircraft = step("aircraft")
    find(`From ${JSON.stringify(target.info.title)}: ${dep ? (dep.detail && dep.detail.ms !== undefined ? `the departure became ${AIRPORT} in ${dep.detail.ms}ms, ${dep.detail.taxis} stands` : `the departure wasn't set (${JSON.stringify(dep.detail)})`) : "no departure report"}; ${stand ? `stand ${stand.detail.name}, read back ${stand.detail.readBack ? "yes" : "no"}` : "no stand"}; ${aircraft ? `aircraft ${aircraft.detail.before} → ${aircraft.detail.after}` : "no aircraft change"}; ${done ? `done in ${done.detail?.ms ?? "?"}ms` : "no done report in 45s"}.`)
    const searches = steps.filter((r) => /^search/.test(r.step)).map((r) => `${r.step}: ${JSON.stringify(r.detail).slice(0, 160)}`)
    if (searches.length) find(`The airport search: ${searches.join("; ")}.`)

    if (main) {
      const after = await main.insp.evaluate(`(function () { var l = window._globalDataLoader; var d = l && l.getData(${JSON.stringify(DEPARTURE)}); var a = l && l.getData("game/aircraft/currentAircraft"); return { taxiIndex: d && d.value ? d.value.taxiIndex : null, airport: d && d.value ? (JSON.stringify(d.value.worldLocation || {}).indexOf('"${AIRPORT}"') >= 0) : false, aircraft: a && a.value ? a.value.displayName : null }; })()`).catch((e) => ({ error: e.message }))
      find(`mainUi reads back: ${JSON.stringify(after)}.`)
    }
    await sleep(800)
    const shot = await shooter.shot("world-map")
    rec.log("shot", shot.error ?? `saved ${repoRelative(shot.file)}`)

    // 4. Fly.
    if (LAUNCH && done?.detail?.ok) {
      const seen = { flightLoaded: null }
      sim.systemHandlers.add((name) => { if (name === "FlightLoaded" && seen.flightLoaded === null) seen.flightLoaded = Date.now() })
      const l0 = Date.now()
      tell(target.id, { op: "launch" })
      say("Our script started the flight. Press Page Down when you're in the cockpit, or Page Up if nothing happened.")
      const k = await keys.next()
      const launch = await reportOf(target.id, "launch", 1)
      find(`launchFlight from our script: ${launch ? JSON.stringify(launch.detail) : "no report"}; ${seen.flightLoaded ? `FlightLoaded ${((seen.flightLoaded - l0) / 1000).toFixed(1)}s after p10 told it` : "no FlightLoaded"}.`)
      if (k.key === "START") {
        const v = await sim.readStrings(["TITLE", "LIVERY NAME"]).catch(() => null)
        find(`In the cockpit: TITLE ${v ? JSON.stringify(v.get("TITLE")) : "unread"}.`)
        const s = await shooter.shot("after-launch")
        rec.log("shot", s.error ?? `saved ${repoRelative(s.file)}`)
        const flying = [...copies.values()].filter((c) => Date.now() - c.lastPoll < 5000)
        find(`After the flight loaded, ${flying.length} copies of our script still poll: ${flying.map((c) => JSON.stringify(c.info?.title ?? "?")).join(", ") || "none"}.`)
      }
    }
  }

  main?.insp.close()
  beep(660, 400)
  say("Done.")
  const text = scrub([`p10-menu-package, started ${new Date(rec.started).toISOString()}`, `Asked for ${AIRPORT}, a stand matching /${STAND}/i, and ${AIRCRAFT}`, "", ...findings.map((f) => `- ${f}`)].join("\n"))
  rec.writeReport(text)
  console.log("\n" + text)
  console.log(`saved ${repoRelative(rec.files.txt)}`)
  shooter.close()
  sim.close()
  server.close()
  await rec.close()
  process.exit(0)
}

main().catch(async (e) => {
  rec.log("error", e.stack ?? String(e))
  await rec.close()
  process.exit(1)
})
