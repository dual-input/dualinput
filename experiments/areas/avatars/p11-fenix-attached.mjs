/*
 * p11: whether a model attached through the aircraft's own attached_objects.cfg
 * holds still in a flying aircraft with nothing outside the sim moving it, on
 * MSFS 2024.
 *
 * GSX keeps its seated passengers aboard by adding a [sim_attachment.N]
 * section to the aircraft package's preset attached_objects.cfg, which hangs
 * its seats model on the aircraft's exterior model; each passenger shows while
 * its L:FSDT_GSX_PASSENGER_SEAT_<row><letter> and L:FSDT_GSX_INTPAX_VISIBLE are
 * set (read in fnx-aircraft-320, presets/fnx/FNX_320_CFM_SL/config/
 * attached_objects.cfg against GSX's backup attached_objects.cfg.gsx, and
 * fsdreamteam-gsx-pro 4.0.19; record/areas/avatars/log.md, 2026-10-03). With
 * Couatl, GSX's program, closed, nothing outside the sim can move them, so if
 * they hold still in flight, the attachment alone carries them.
 *
 * Seated in the Fenix A320, with Couatl closed from its tray icon:
 *
 *   on    Press Page Down, and every passenger in rows 1 to 31 shows. Fly,
 *         and look at them through the cabin windows from an outside view,
 *         as long as you like. Press Page Down again to end.
 *
 * The probe reads every L: variable it sets first, puts each back at the end,
 * on Ctrl+C, and after 30 minutes in any case, and reads them back to confirm.
 *
 *   node experiments/areas/avatars/p11-fenix-attached.mjs
 *
 * Output: one line per step on the console, the records in
 * experiments/areas/avatars/results/p11-fenix-attached-<time>.ndjson, and the
 * report in the .txt beside it.
 */

import { execFileSync } from "node:child_process"

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { Recorder, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"

const ROWS = 31
const LETTERS = ["A", "B", "C", "D", "E", "F"]
const LVARS = ["L:FSDT_GSX_INTPAX_VISIBLE", ...Array.from({ length: ROWS }, (_, i) => LETTERS.map((l) => `L:FSDT_GSX_PASSENGER_SEAT_${i + 1}${l}`)).flat()]
const CAP_MS = 30 * 60_000
const KT = 1.94384

function couatlRunning() {
  try {
    return execFileSync("tasklist", ["/fo", "csv", "/nh"], { encoding: "utf8" }).split(/\r?\n/).some((l) => /^"Couatl/i.test(l))
  } catch {
    return null
  }
}

const rec = new Recorder("p11-fenix-attached", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p11-fenix-attached" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()
const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); rec.log(kind, text, fields) }

async function flight() {
  const v = await sim.read([["GROUND VELOCITY", "knots"], ["PLANE ALT ABOVE GROUND", "feet"], ["SIM ON GROUND", "bool"]])
  return `${Math.round(v.get("GROUND VELOCITY") ?? 0)} kt over the ground, ${Math.round(v.get("PLANE ALT ABOVE GROUND") ?? 0)} ft AGL${v.get("SIM ON GROUND") ? ", on the ground" : ""}`
}

let saved = null
async function setPassengers(on) {
  if (on) {
    const v = await sim.read(LVARS.map((n) => [n, "number"]), { timeoutMs: 3000 })
    saved = new Map(LVARS.map((n) => [n, v.get(n) ?? 0]))
    for (const n of LVARS) sim.set([[n, "number"]], [1], { quiet: true, label: `set ${n}` })
    const nonzero = [...saved].filter(([, x]) => x !== 0)
    note("lvars", `set ${LVARS.length} L: variables to 1; ${nonzero.length} were nonzero before${nonzero.length && nonzero.length < 10 ? `: ${nonzero.map(([n, x]) => `${n} ${x}`).join(", ")}` : ""}`, { saved: Object.fromEntries(saved) })
  } else if (saved) {
    for (const [n, x] of saved) sim.set([[n, "number"]], [x], { quiet: true, label: `restore ${n}` })
    // p10's first run lost its restore by disconnecting straight after
    // sending it, so this waits and reads back.
    await sleep(800)
    const v = await sim.read(LVARS.map((n) => [n, "number"]), { timeoutMs: 3000 })
    const off = [...saved].filter(([n, x]) => v.get(n) !== x).map(([n]) => n)
    note("lvars", `put back ${saved.size} L: variables; ${off.length ? `${off.length} read back wrong: ${off.slice(0, 5).join(", ")}` : "all read back as saved"}`, { off })
    saved = null
  }
}

let stopping = false
process.on("SIGINT", async () => {
  if (stopping) process.exit(1)
  stopping = true
  rec.log("stop", "Ctrl+C: putting the L: variables back")
  await setPassengers(false)
  await finish()
  process.exit(0)
})

const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
note("setup", `aircraft TITLE ${JSON.stringify(title)}${/fenix|a32/i.test(title ?? "") ? "" : ": not a Fenix A320 family title, so GSX's attachment may not be in its preset"}`)
let couatl = couatlRunning()
note("setup", `Couatl is ${couatl ? "RUNNING: quit it from its tray icon before you start" : couatl === false ? "not running" : "unknown"}`)

console.log(`\n▶ Passengers on\n  With Couatl closed, press Page Down to show every passenger in rows 1 to ${ROWS}. Fly and watch them from an outside view through the cabin windows. Press Page Down again to end.\n  ${START} to start, ${SKIP} to skip.`)
let k = await keys.next()
rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
if (k.key === "START") {
  couatl = couatlRunning()
  note("start", `Couatl ${couatl ? "running" : "not running"} at the start; ${await flight()}`)
  await setPassengers(true)
  beep(1000, 100)
  const t0 = Date.now()
  console.log("  Passengers on. Press Page Down to end.")
  k = await Promise.race([keys.next(), sleep(CAP_MS).then(() => ({ key: "CAP" }))])
  beep(500, 600)
  couatl = couatlRunning()
  note("end", `${k.key === "CAP" ? "the 30-minute cap" : "Page Down"} after ${Math.round((Date.now() - t0) / 1000)}s; Couatl ${couatl ? "running" : "not running"} at the end; ${await flight()}`)
  await setPassengers(false)
  console.log("  Tell Claude whether the passengers showed, and whether they held still in their seats in flight.")
}

await finish()
process.exit(0)

async function finish() {
  const text = [
    "p11 · GSX's attached passengers in a flying Fenix A320 with Couatl closed, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    "",
    ...lines.map((l) => `  ${l}`),
  ].join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  await sleep(300)
  sim.close()
  await rec.close()
}
