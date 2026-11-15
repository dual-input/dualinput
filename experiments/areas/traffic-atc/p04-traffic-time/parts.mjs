/*
 * p04: where our module's update goes in the sim, part by part, as the timer in parts.patch reports
 * it over each window of 300 frames: the whole update, taking the core's slot writes, `Traffic`'s
 * frame, every other routine's frames, and carrying out the routines' writes, keys, and fires.
 * p03's session in the sim timed only the whole update, and with about 105 copies its p99 varied
 * more than `Traffic`'s share (record/areas/traffic-atc/log.md, 2026-11-15).
 *
 *   git apply experiments/areas/traffic-atc/p04-traffic-time/parts.patch
 *   node tools/build.ts install        (with the sim closed)
 *   git apply -R experiments/areas/traffic-atc/p04-traffic-time/parts.patch
 *   node experiments/areas/traffic-atc/p04-traffic-time/parts.mjs --labels <file>
 *
 * It ends with Ctrl+C, or at the sim's end, and prints each label's windows at the end. A line
 * appended to the file named by --labels names what the following windows measure.
 */

import fs from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"

import { Recorder } from "../../aircraft/lib/out.mjs"
import { Sim } from "../../aircraft/lib/sim.mjs"

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null }
const LABELS = arg("--labels")
if (LABELS) fs.writeFileSync(LABELS, "", { flag: "a" })

/** The parts, as parts.patch names them in its `L:` variables. */
const PARTS = ["WHOLE", "TAKE", "TRAFFIC", "OTHERS", "WRITES"]
const VARS = [...PARTS.flatMap((p) => [`L:DUALINPUT_P04_${p}_P50`, `L:DUALINPUT_P04_${p}_P99`]), "L:DUALINPUT_P04_WINDOW"].map((n) => [n, "number"])

const rec = new Recorder("p04-traffic-parts", { area: "traffic-atc" })
rec.open()
const sim = await Sim.connect(rec, { name: "DUALINPUT p04 traffic parts" })
const windows = new Map()
let label = "start"
let last = 0

const median = (list) => [...list].sort((a, b) => a - b)[list.length >> 1]
const us = (v) => `${v.toFixed(1)}µs`

function report() {
  const lines = []
  for (const [name, list] of windows) {
    const parts = PARTS.map((p) => `${p.toLowerCase()} ${us(median(list.map((w) => w[p].p50)))}/${us(median(list.map((w) => w[p].p99)))}`)
    lines.push(`${name}: ${list.length} windows, median p50/p99: ${parts.join(", ")}`)
  }
  rec.log("report", `\n${lines.join("\n")}`, { lines })
}

process.on("SIGINT", () => { report(); rec.finish?.("interrupted"); process.exit(0) })
let labelRead = 0
for (;;) {
  if (LABELS) {
    const text = fs.readFileSync(LABELS, "utf8")
    if (text.length > labelRead) {
      label = text.slice(labelRead).trim().split(/\r?\n/).at(-1) || label
      labelRead = text.length
      rec.log("label", label)
    }
  }
  const got = await sim.read(VARS, { label: "parts" }).catch(() => null)
  if (got === null || sim.gone) break
  const window = got.get("L:DUALINPUT_P04_WINDOW") ?? 0
  if (window !== last) {
    last = window
    const w = Object.fromEntries(PARTS.map((p) => [p, { p50: got.get(`L:DUALINPUT_P04_${p}_P50`) / 1_000, p99: got.get(`L:DUALINPUT_P04_${p}_P99`) / 1_000 }]))
    if (!windows.has(label)) windows.set(label, [])
    windows.get(label).push(w)
    rec.log("window", `${label} #${window}: ${PARTS.map((p) => `${p.toLowerCase()} ${us(w[p].p50)}/${us(w[p].p99)}`).join(", ")}`, { label, window, ...w })
  }
  await sleep(1_000)
}
report()
process.exit(0)
