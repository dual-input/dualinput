/*
 * p29: how long our module's update takes in the sim, as the timer in update-timer.patch
 * reports it over each window of 300 frames, with a line for each window.
 *
 *   git apply experiments/areas/avatars/p29-sim-session/update-timer.patch
 *   node tools/build.ts install        (with the sim closed)
 *   node experiments/areas/avatars/p29-sim-session/update-times.mjs
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

const rec = new Recorder("p29-update-times", { area: "avatars" })
rec.open()
const sim = await Sim.connect(rec, { name: "DUALINPUT p29 update times" })
const VARS = ["P50", "P99", "MAX", "WINDOW"].map((n) => [`L:DUALINPUT_P29_UPDATE_${n}`, "number"])
const windows = new Map()
let label = "start"
let last = 0

function report() {
  const lines = []
  for (const [name, list] of windows) {
    const p99s = list.map((w) => w.p99).sort((a, b) => a - b)
    const worst = Math.max(...p99s)
    const maximum = Math.max(...list.map((w) => w.max))
    lines.push(`${name}: ${list.length} windows, median p50 ${list.map((w) => w.p50).sort((a, b) => a - b)[list.length >> 1].toFixed(1)}µs, median p99 ${p99s[list.length >> 1].toFixed(1)}µs, worst p99 ${worst.toFixed(1)}µs, max ${maximum.toFixed(1)}µs`)
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
  const got = await sim.read(VARS, { label: "update times" }).catch(() => null)
  if (got === null || sim.gone) break
  const window = got.get("L:DUALINPUT_P29_UPDATE_WINDOW") ?? 0
  if (window !== last) {
    last = window
    const w = { p50: got.get("L:DUALINPUT_P29_UPDATE_P50") / 1_000, p99: got.get("L:DUALINPUT_P29_UPDATE_P99") / 1_000, max: got.get("L:DUALINPUT_P29_UPDATE_MAX") / 1_000 }
    if (!windows.has(label)) windows.set(label, [])
    windows.get(label).push(w)
    rec.log("window", `${label} #${window}: p50 ${w.p50.toFixed(1)}µs, p99 ${w.p99.toFixed(1)}µs, max ${w.max.toFixed(1)}µs`, { label, window, ...w })
  }
  await sleep(1_000)
}
report()
process.exit(0)
