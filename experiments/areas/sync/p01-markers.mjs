/*
 * Re-times a p01-guided-load run from the sim's own markers instead of the
 * pilot's presses: Fly is the sim's last FlightLoaded before Ready, and Ready
 * is its last RTC_END (lib/settle.mjs, markers). It reads the run's NDJSON, so
 * it needs no sim.
 *
 *   node experiments/areas/sync/p01-markers.mjs experiments/areas/sync/results/p01-guided-load-<stamp>.ndjson ...
 *
 * Runs before 2026-10-05 17:45 recorded from the first press only, so where the
 * sim's FlightLoaded came before that press, the changes in between are
 * missing, and the report says how many seconds of them.
 */

import { readFileSync, writeFileSync } from "node:fs"

import { AIRCRAFT } from "../aircraft/lib/aircraft.mjs"
import { SETTLE_A } from "../aircraft/lib/load.mjs"
import { repoRelative, secs } from "../aircraft/lib/out.mjs"
import { markers, settleVerdict } from "./lib/settle.mjs"

const KEEP_TIMES = 30 // p01's, which every run so far used
const HANDS_OFF_MS = 120_000
const curatedA = new Set(SETTLE_A.map(([n]) => n))

function analyze(file) {
  const recs = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  const events = recs
    .filter((r) => r.kind === "system" || r.kind === "flow")
    .map((r) => ({ t: r.t, name: r.kind === "flow" ? `flow ${r.flow ?? r.text.split(" ")[0]}` : r.event ?? r.text.split(" ")[0] }))
  const arms = recs.filter((r) => r.kind === "prompt" && /^\[\d+\/\d+ aircraft\] Load /.test(r.text))
  const keys = recs.filter((r) => r.kind === "key" && r.key === "START")
  const entryRecs = recs.filter((r) => r.kind === "load-entries")
  const loadRecs = recs.filter((r) => r.kind === "load")

  const out = []
  for (const [i, lr] of loadRecs.entries()) {
    const er = entryRecs[i]
    const arm = arms.filter((a) => a.t < lr.t).at(-1)
    const k1 = keys.find((k) => k.t >= arm.t)
    const t1 = k1.t
    const t2 = t1 + lr.readyMs
    const tEnd = t2 + HANDS_OFF_MS
    const entries = new Map(er.entries.map((e) => [`${e.kind}:${e.name}`, {
      ...e,
      before: { n: e.before.n, times: e.before.ms.map((ms) => t1 + ms) },
      after: { n: e.after.n, times: e.after.ms.map((ms) => t1 + ms) },
    }]))
    const m = markers(events, { from: arm.t, readyBy: t2 + 10_000 })
    const a = AIRCRAFT[lr.load.id]
    const settleL = new Set(a?.settleL ?? [])
    const switches = (e) => (e.kind === "A" ? curatedA.has(e.name.slice(2)) : settleL.has(e.name))
    const v = (t0, keep) => (t0 === null ? null : settleVerdict({ entries, t0, t2, tEnd, keep, keepTimes: KEEP_TIMES }))
    out.push({
      n: lr.load.n, id: lr.load.id, flowPro: lr.load.flowPro,
      pressFly: m.fly === null ? null : t1 - m.fly,
      pressReady: m.ready === null ? null : t2 - m.ready,
      readyAfterFly: m.fly !== null && m.ready !== null ? m.ready - m.fly : null,
      reloads: m.reloads,
      missingMs: m.fly !== null && m.fly < t1 ? t1 - m.fly : 0,
      fromFly: { all: v(m.fly, () => true), switches: v(m.fly, switches) },
      fromReady: { all: v(m.ready, () => true), switches: v(m.ready, switches) },
    })
  }
  return out
}

const fmtV = (x) => (x ? `${secs(x.atMs)}${x.why === "cap" ? " (cap)" : ""}${x.late.length ? `, ${x.late.length} late` : ""}` : "?")
const signed = (ms) => (ms === null ? "?" : `${ms >= 0 ? "+" : ""}${(ms / 1000).toFixed(1)}s`)

for (const file of process.argv.slice(2)) {
  const rows = analyze(file)
  const lines = [`p01-markers, from ${repoRelative(file)}`, ""]
  lines.push("| Load | Fly press vs FlightLoaded | Ready press vs RTC_END | Reloads | Ready after Fly | Missing before recording | All, from Fly | Switches, from Fly | All, from Ready | Switches, from Ready |")
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
  for (const r of rows) {
    lines.push(`| ${r.n} ${r.id}${r.flowPro ? "" : " (Flow Pro off)"} | ${signed(r.pressFly)} | ${signed(r.pressReady)} | ${r.reloads} | ${r.readyAfterFly === null ? "?" : secs(r.readyAfterFly)} | ${r.missingMs > 0 ? secs(r.missingMs) : "none"} | ${fmtV(r.fromFly.all)} | ${fmtV(r.fromFly.switches)} | ${fmtV(r.fromReady.all)} | ${fmtV(r.fromReady.switches)} |`)
  }
  lines.push("")
  for (const r of rows) {
    for (const [from, set, x] of [["Fly", "all", r.fromFly.all], ["Fly", "switches", r.fromFly.switches], ["Ready", "all", r.fromReady.all], ["Ready", "switches", r.fromReady.switches]]) {
      if (!x || !x.late.length) continue
      lines.push(`${r.n} ${r.id}, from ${from}, ${set}: ${x.late.length} late: ${x.late.slice(0, 8).map((l) => `${l.name} at ${l.afterMs.map(secs).join(", ")}`).join("; ")}${x.late.length > 8 ? "; …" : ""}`)
    }
  }
  const text = lines.join("\n")
  const target = file.replace(/p01-guided-load-(.+)\.ndjson$/, "p01-markers-$1.txt")
  writeFileSync(target, text + "\n")
  console.log(text)
  console.log(`saved ${repoRelative(target)}\n`)
}
