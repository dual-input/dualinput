/*
 * p09: with the EFB crowded, so our app is on neither its dock nor the first
 * page of its app list, can our app's own code open the EFB onto our app, and
 * does that code run while the EFB is closed? The plan's step 6 probe on the
 * notification banner (record/areas/product/plan.md; record/areas/product/
 * 03-v1-scope.md, "Notification banner").
 *
 *   node experiments/areas/interface/efb/build.mjs     before MSFS starts
 *   node experiments/areas/interface/p09-crowded-efb.mjs [--ops <file>]
 *
 * The chain measured on 2026-10-04 ran from a stand-in in the EFB's document,
 * put there through the inspector, which pressed GSX's button on the dock
 * (record/areas/interface/log.md, "A click on a notice in our panel opens the
 * EFB onto another app"). This one runs from a real app, "ZZ Crosscheck P09",
 * loaded the sim's way among 48 filler apps (interface/efb/build.mjs). A
 * click on a notice reaches Crosscheck's core, and the core tells the app, so
 * here p09 plays the core: the app polls p09 over HTTP, and p09 answers with
 * the steps to run.
 *
 * The steps it tries, in order, until our app's view reports onOpen or
 * onResume:
 *   1. open the EFB if it's closed (Coherent.call("TOGGLE_EFB"), measured on
 *      2026-10-04), then fire OPEN_BY_KEY with our app's internal name in the
 *      EFB's own document: the sim opens the EFB onto an app with that event
 *      (read in fs-base-efb, html_ui/efb_ui/efb_os/efb_os.js), and the sim's
 *      engine.trigger calls the document's own handlers before it reaches the
 *      sim (read in mainUi's coui://html_UI/JS/AsoboCoherent.js);
 *   2. the same with the app's display name;
 *   3. Coherent.trigger, which may go through the sim;
 *   4. the flow event the sim's own interface sends, UI_EFB_OPEN_PAGE (read in
 *      fs-base-ui, html_ui/Global/pkg/base.bundle.js);
 *   5. a press on our app's name, if it's on screen.
 * It runs them from three states: closed and never opened since the flight
 * loaded, open on another app, and closed after use. A screenshot follows
 * each try, so the sim stays in front.
 *
 * With --ops <file>, p09 keeps running after that and sends each JSON array of
 * steps appended to the file to the app, until Page Up.
 *
 * Output: results/p09-crowded-efb-<time>.txt and .ndjson, and the screenshots
 * in a folder beside them.
 */

import { createServer } from "node:http"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"

import { Recorder, repoRelative, scrub, sleep } from "../aircraft/lib/out.mjs"
import { Sim } from "../aircraft/lib/sim.mjs"
import { Inspector, listPages } from "../../tools/inspector.mjs"
import { startBeeper, startKeys, startSpeaker } from "../../tools/guide.mjs"
import { startShooter } from "../../tools/shot.mjs"

const PORT = 47_809
const APP = { internal: "ZzCrosscheckP09", name: "ZZ Crosscheck P09" }
const OPENED_MS = 3000

const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] ?? null }

const rec = new Recorder("p09-crowded-efb", { area: "interface" })
const findings = []
const find = (text) => { findings.push(text); rec.log("finding", text) }

// ---------------------------------------------------------------- the core's side

const polls = []
const events = []
const queue = []
const waiting = new Map()
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
  if (url.pathname === "/p09/next") {
    const since = Number(url.searchParams.get("since") ?? 0)
    polls.push({ t: Date.now(), efb: url.searchParams.get("efb"), installed: url.searchParams.get("installed") === "1" })
    res.writeHead(200, { ...cors, "content-type": "application/json" })
    res.end(JSON.stringify(queue.filter((c) => c.seq > since)))
    return
  }
  if (url.pathname === "/p09/result") {
    const b = await body(req)
    rec.data("result", `steps ${b?.id}: ${JSON.stringify(b?.results ?? null).slice(0, 400)}`, { result: b })
    waiting.get(b?.id)?.(b)
  } else if (url.pathname === "/p09/event") {
    const b = await body(req)
    if (b) { events.push({ ...b, at: Date.now() }); rec.log("app", `${b.what}${b.detail ? ` ${JSON.stringify(b.detail)}` : ""}, the EFB ${b.efb}`, b) }
  }
  res.writeHead(200, cors)
  res.end("ok")
})

// Sends steps to the app with its next poll, and waits for what it reports.
function send(steps, ms = 10_000) {
  const id = ++seq
  queue.push({ seq: id, steps })
  rec.data("send", `steps ${id}: ${JSON.stringify(steps)}`, { id, steps })
  return Promise.race([
    new Promise((resolve) => waiting.set(id, resolve)),
    sleep(ms).then(() => ({ id, timedOut: true })),
  ])
}

const lastPoll = () => polls[polls.length - 1] ?? null
const efbNow = () => lastPoll()?.efb ?? "unknown"

// Poll intervals over a stretch, to see whether the EFB slows a closed app's timers.
function pollStats(from, to) {
  const p = polls.filter((x) => x.t >= from && x.t <= to)
  const gaps = p.slice(1).map((x, i) => x.t - p[i].t).sort((a, b) => a - b)
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null
  const states = {}
  for (const x of p) states[x.efb] = (states[x.efb] ?? 0) + 1
  return { n: p.length, median, max: gaps.length ? gaps[gaps.length - 1] : null, states }
}

// ---------------------------------------------------------------- the tries

const TRIES = [
  ["OPEN_BY_KEY with the internal name, by engine.trigger", [{ op: "toggleIfClosed" }, { op: "wait", ms: 300 }, { op: "trigger", args: ["OPEN_BY_KEY", APP.internal, "", ""] }]],
  ["OPEN_BY_KEY with the display name, by engine.trigger", [{ op: "toggleIfClosed" }, { op: "wait", ms: 300 }, { op: "trigger", args: ["OPEN_BY_KEY", APP.name, "", ""] }]],
  ["OPEN_BY_KEY with the internal name, by Coherent.trigger", [{ op: "toggleIfClosed" }, { op: "wait", ms: 300 }, { op: "coherentTrigger", args: ["OPEN_BY_KEY", APP.internal, "", ""] }]],
  ["the flow event UI_EFB_OPEN_PAGE", [{ op: "launchFlowEvent", args: ["UI_EFB_OPEN_PAGE", "", APP.internal, ""] }]],
  ["a press on our app's name, if it's on screen", [{ op: "toggleIfClosed" }, { op: "wait", ms: 600 }, { op: "clickText", text: APP.name }]],
]

async function attempt(shooter, state, tries) {
  for (const [label, steps] of tries) {
    const t0 = Date.now()
    const r = await send(steps)
    await sleep(OPENED_MS)
    const shown = events.filter((e) => e.at >= t0 && (e.what === "onOpen" || e.what === "onResume"))
    const key = events.filter((e) => e.at >= t0 && e.what === "handlePageKeyAction")
    const errors = (r.results ?? []).filter((x) => x.error).map((x) => `${x.op}: ${x.error}`)
    const shot = await shooter.shot(`${state.replace(/[^a-z]+/gi, "-")}-${label.replace(/[^a-z]+/gi, "-").slice(0, 40)}`)
    rec.log("shot", shot.error ?? `saved ${repoRelative(shot.file)}`)
    const ok = shown.length > 0
    const toggled = (r.results ?? []).find((x) => x.toggled !== undefined)
    find(`${state}, ${label}: ${r.timedOut ? "the app didn't report back in 10s" : ok ? `our app's view reported ${shown.map((e) => e.what).join(" and ")} ${shown[0].at - t0}ms after the steps went out, with the EFB ${shown[0].efb}` : "our app's view reported nothing"}${toggled ? `; the EFB was ${toggled.efbBefore} and ${toggled.toggled ? "the app toggled it" : "wasn't toggled"}` : ""}${key.length ? `; handlePageKeyAction got ${JSON.stringify(key[0].detail)}` : ""}${errors.length ? `; errors: ${errors.join("; ")}` : ""}.`)
    if (ok) return label
  }
  return null
}

// ---------------------------------------------------------------- main

async function main() {
  rec.open()
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(PORT, "127.0.0.1", resolve) })
  rec.log("server", `listening on 127.0.0.1:${PORT}`)
  const keys = await startKeys()
  const beep = startBeeper()
  const say = startSpeaker()
  const shooter = startShooter(join(dirname(rec.files.txt), `p09-crowded-efb-${rec.when}`))
  const tStart = Date.now()

  let sim = null
  try { sim = await Sim.connect(rec, { name: "CROSSCHECK p09 crowded EFB" }) } catch (e) { rec.log("sim", `no SimConnect: ${e.message}`) }
  const title = sim ? (await sim.readStrings(["TITLE"])).get("TITLE") ?? null : null
  find(`Aircraft: ${title ?? "unknown"}.`)

  beep(880, 150)
  say("Get into the cockpit, and don't open the E F B. Keep the sim in front, and press Page Down.")
  rec.log("prompt", "In the cockpit, with the EFB not opened since the flight loaded. Sim in front. Page Down.")
  await keys.next()

  // 1. Is our app's code running?
  if (!polls.length) {
    say("Waiting for the app.")
    for (let i = 0; i < 60 && !polls.length; i++) await sleep(500)
  }
  if (!polls.length) {
    find("Our app never polled p09 in 30s after the pilot's Page Down.")
    await diagnose()
    return finish(shooter, sim)
  }
  const first = polls[0]
  const installed = events.find((e) => e.what === "installed")
  find(`Our app's first poll came ${((first.t - tStart) / 1000).toFixed(1)}s after p09 started, with the EFB ${first.efb}${installed ? `; the EFB installed it ${((installed.t - first.t) / 1000).toFixed(1)}s after that` : "; no installed event yet"}.`)

  say("Hands off for ten seconds.")
  const w0 = Date.now()
  await sleep(10_000)
  const idle = pollStats(w0, Date.now())
  find(`With the EFB ${efbNow()}, before anyone opened it: ${idle.n} polls in 10s, a median ${idle.median}ms apart and at most ${idle.max}ms; the app saw the EFB as ${JSON.stringify(idle.states)}.`)

  // 2. Where our app is in the EFB.
  const apps = await send([{ op: "apps" }, { op: "findText", text: APP.name }, { op: "findText", text: "Filler 01" }])
  const [list, ours, filler] = apps.results ?? []
  if (list?.apps) {
    const shown = list.apps.filter((a) => a.rect)
    const mine = list.apps.filter((a) => a.app === APP.internal)
    find(`App icons in the EFB's document: ${list.apps.length}, ${shown.length} of them on screen; ours ${mine.length ? (mine.some((a) => a.rect) ? "on screen" : "drawn but off screen") : "not drawn"}; ${list.apps.filter((a) => /Filler/.test(a.app)).length} filler icons.`)
    rec.data("apps", "app icons", { apps: list.apps })
  }
  if (ours) find(`Our app's name in the document: ${ours.found?.length ?? 0} places, ${ours.found?.filter((f) => f.rect).length ?? 0} on screen; filler 01's: ${filler?.found?.length ?? 0}.`)

  // 3. Closed and never opened.
  beep(880, 150)
  say("Hands off. Opening our app.")
  const winner = await attempt(shooter, "Closed, never opened", TRIES)
  const tries = winner ? TRIES.filter(([l]) => l === winner) : TRIES

  // 4. Open on another app.
  beep(880, 150)
  say("Open the E F B, and open the map app, or any other app. Then press Page Down. Page Up skips.")
  rec.log("prompt", "Open the EFB on the map app, or any other app, then Page Down; Page Up skips.")
  if ((await keys.next()).key === "START") {
    say("Hands off.")
    await sleep(500)
    await attempt(shooter, "Open on another app", tries)
  }

  // 5. Closed after use.
  beep(880, 150)
  say("Close the E F B, and press Page Down. Page Up skips.")
  rec.log("prompt", "Close the EFB, then Page Down; Page Up skips.")
  if ((await keys.next()).key === "START") {
    say("Hands off.")
    const c0 = Date.now()
    await sleep(3000)
    const closed = pollStats(c0, Date.now())
    find(`With the EFB closed after use: ${closed.n} polls in 3s, a median ${closed.median}ms apart; the app saw the EFB as ${JSON.stringify(closed.states)}.`)
    await attempt(shooter, "Closed after use", tries)
  }

  // 6. Live steps from a file, for whatever the tries above leave open.
  const ops = opt("--ops")
  if (ops) {
    say("Live steps. Page Up ends.")
    rec.log("ops", `sending the JSON arrays appended to ${ops}; Page Up ends`)
    let done = false
    const stop = keys.listen((k) => { if (k.key === "SKIP") done = true })
    let read = existsSync(ops) ? statSync(ops).size : 0
    while (!done) {
      await sleep(500)
      if (!existsSync(ops) || statSync(ops).size <= read) continue
      const text = readFileSync(ops, "utf8").slice(read)
      read = statSync(ops).size
      for (const line of text.split(/\r?\n/).filter((l) => l.trim())) {
        let steps
        try { steps = JSON.parse(line) } catch { rec.log("ops", `not JSON: ${line}`); continue }
        const t0 = Date.now()
        const r = await send(steps)
        await sleep(1500)
        const shot = await shooter.shot("ops")
        rec.log("ops", `${line} → ${JSON.stringify(r.results ?? r).slice(0, 1500)}; events ${JSON.stringify(events.filter((e) => e.at >= t0).map((e) => e.what))}; ${shot.error ?? repoRelative(shot.file)}`)
      }
    }
    stop()
  }

  return finish(shooter, sim)
}

// When the app never polled: what the EFB's document holds of it.
async function diagnose() {
  try {
    const pages = await listPages()
    const efb = pages.find((p) => p.title === "Electronic Flight Bag")
    if (!efb) return find(`No document titled "Electronic Flight Bag" among ${pages.length}.`)
    const insp = new Inspector(efb.id)
    await insp.open()
    const d = await insp.evaluate(`(function () {
      var scripts = [];
      var els = document.querySelectorAll("script[src]");
      for (var i = 0; i < els.length; i++) if (String(els[i].src).indexOf("efb_apps") >= 0) scripts.push(String(els[i].src).slice(-80));
      return { state: window.CROSSCHECK_P09 ? { polls: window.CROSSCHECK_P09.polls, failures: window.CROSSCHECK_P09.failures, last: window.CROSSCHECK_P09.last } : null,
        registered: window.CROSSCHECK_P09_REGISTERED || null, error: window.CROSSCHECK_P09_REGISTERED_ERROR || null,
        efbApi: typeof window.EFB_API, msfssdk: typeof msfssdk, appScripts: scripts.length, ours: scripts.filter(function (s) { return s.indexOf("ZzCrosscheckP09") >= 0; }) };
    })()`)
    insp.close()
    find(`The EFB's document: ${JSON.stringify(d)}.`)
  } catch (e) {
    find(`Couldn't read the EFB's document: ${e.message}`)
  }
}

async function finish(shooter, sim) {
  await send([{ op: "stop" }], 2000)
  const say = startSpeaker()
  say("Done.")
  const text = scrub([`p09-crowded-efb, started ${new Date(rec.started).toISOString()}`, `${polls.length} polls in all`, "", ...findings.map((f) => `- ${f}`)].join("\n"))
  rec.writeReport(text)
  console.log("\n" + text)
  console.log(`saved ${repoRelative(rec.files.txt)}`)
  shooter.close()
  sim?.close()
  server.close()
  await rec.close()
  process.exit(0)
}

main().catch(async (e) => {
  rec.log("error", e.stack ?? String(e))
  await rec.close()
  process.exit(1)
})
