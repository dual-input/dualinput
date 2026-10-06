/*
 * p10-ready: on the Ready to fly screen, can our package's script in mainUi
 * press Ready to fly? The step after p10-menu-package.mjs --join, which stops
 * at FlightLoaded.
 *
 *   node experiments/areas/interface/p10-ready.mjs
 *
 * Free flight's Ready to fly button is TextButton_Large_Special_Ready in
 * Career_ConfirmationPage, {2ED42842-09CF-479E-9536-A8093FAFF307}, in mainUi
 * (inspector read, 2026-10-06), and the page's code takes it as its exposed
 * child ReadyButton, whose click calls back into the sim (read in fs-base-ui
 * 0.1.10, html_ui/Global/pkg/base.bundle.js, CareerConfirmationPageManipulator;
 * cookedcomps/{2ED42842-...}.json). p10-menu.js, from crosscheck-p10-menu,
 * presses a button by such a path. This plays the core on 127.0.0.1:47810,
 * tells the copy in mainUi to press it, and times the sim's own markers:
 * SimConnect's flow event RTC_END is Ready to fly (record/areas/sync/log.md,
 * 2026-10-05).
 *
 * Run it with the sim on the Ready to fly screen and crosscheck-p10-menu
 * installed, within the hour our script polls after it loads.
 */

import { createServer } from "node:http"

import { Recorder, repoRelative, scrub, sleep } from "../aircraft/lib/out.mjs"
import { Sim } from "../aircraft/lib/sim.mjs"

const PORT = 47_810
const PATH = ["Career_ConfirmationPage", "ReadyButton"]

const rec = new Recorder("p10-ready", { area: "interface" })
const findings = []
const find = (text) => { findings.push(text); rec.log("finding", text) }
const copies = new Map()
const reports = []
const queue = []
let seq = 1000

const body = (req) => new Promise((resolve) => {
  const chunks = []
  req.on("data", (c) => chunks.push(c))
  req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))) } catch { resolve(null) } })
})

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  if (url.pathname === "/p10/next") {
    const id = Number(url.searchParams.get("id"))
    const since = Number(url.searchParams.get("since") ?? 0)
    if (!copies.has(id)) { copies.set(id, null); queue.push({ seq: ++seq, to: id, op: "hello" }) }
    res.writeHead(200, { "access-control-allow-origin": "*", "content-type": "application/json" })
    res.end(JSON.stringify(queue.filter((q) => q.to === id && q.seq > since)))
    return
  }
  const b = await body(req)
  if (b && url.pathname === "/p10/hello") { copies.set(b.id, b); rec.log("hello", `${b.title} (${b.via})`, b) }
  if (b && url.pathname === "/p10/report") { reports.push({ ...b, at: Date.now() }); rec.log("script", `${b.step}: ${JSON.stringify(b.detail)}`, b) }
  res.writeHead(200, { "access-control-allow-origin": "*" })
  res.end("ok")
})

async function main() {
  rec.open()
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve))
  const sim = await Sim.connect(rec, { name: "CROSSCHECK p10 ready" })
  sim.track()

  // Our script polls every 2s while nothing answers, so give it time to find us.
  const until = async (test, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = test(); if (v) return v; await sleep(200) } return null }
  const main = await until(() => [...copies.values()].find((c) => c && /mainUI\.html/i.test(c.href)), 20_000)
  if (!main) { find(`No copy of our script in mainUi answered in 20s; copies heard: ${JSON.stringify([...copies.values()].map((c) => c?.title ?? "no hello"))}.`); return end(sim) }
  find(`Our script answered from mainUi, loaded by its ${main.via}.`)

  const t0 = Date.now()
  queue.push({ seq: ++seq, to: main.id, op: "screen" })
  queue.push({ seq: ++seq, to: main.id, op: "press", path: PATH })
  const press = await until(() => reports.find((r) => r.id === main.id && r.step === "press" && r.at >= t0), 10_000)
  find(`Pressed ${PATH.join(" → ")}: ${JSON.stringify(press?.detail?.result ?? "no report in 10s")}.`)
  await sleep(8000)
  const rtc = rec.timeline.find((e) => e.t >= t0 && /RTC_END/.test(e.text ?? ""))
  find(rtc ? `The sim's RTC_END came ${((rtc.t - t0) / 1000).toFixed(1)}s after p10-ready told our script to press.` : `No RTC_END in 8s after the press.`)
  return end(sim)
}

async function end(sim) {
  const text = scrub([`p10-ready, started ${new Date(rec.started).toISOString()}`, "", ...findings.map((f) => `- ${f}`)].join("\n"))
  rec.writeReport(text)
  console.log("\n" + text)
  console.log(`saved ${repoRelative(rec.files.txt)}`)
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
