/*
 * p01: what the sim's pauses report, and whether a SimConnect client can set
 * the pause, the simulation rate, and the time of day, on MSFS 2024.
 *
 * Crosscheck v1 syncs pause from any pilot, and the simulation rate and time
 * from the PF to everyone (record/areas/product/03-v1-scope.md). Our records
 * leave three things open (record/learn/foundations/02-03-the-running-sim.md):
 *
 *   - Which pilot actions raise which Pause_EX1 flag. The SDK gives full pause
 *     (1), active pause (4), and sim pause (8), whose trigger nobody here knows.
 *   - Whether K:PAUSE_SET and the simulation-rate events work from SimConnect,
 *     and what K:SIM_RATE_SET's parameter means.
 *   - Whether K:ZULU_HOURS_SET and K:CLOCK_HOURS_SET hold. Forum reports say
 *     they're reverted a second later, or reset the date (unverified).
 *
 * About 2.5 minutes, in any aircraft, parked or flying:
 *
 *   tour    You, about 45s: press Page Down, then at each beep do the action
 *           the console names, and undo it at the next beep. The probe logs
 *           the pause flags and whether the sim's clock keeps running.
 *   pause   On its own: K:PAUSE_SET 1, then 0.
 *   rate    On its own: K:SIM_RATE_INCR twice, then K:SIM_RATE_SET with 1 and
 *           with 256, to see which one means 1x, then back to where it was.
 *   time    On its own, about 60s: the zulu hour moved 3 hours on, then the
 *           minute moved on, then the local hour, each watched for whether it
 *           holds and whether the date moves; then the time put back. The
 *           light outside changes while this runs.
 *
 * On the way out, Ctrl+C included, the probe unpauses, puts the rate back, and
 * puts the zulu hour and minute back.
 *
 *   node experiments/areas/environment/p01-clock.mjs
 *
 * Output: one line per step on the console, every reading in
 * experiments/areas/environment/results/p01-clock-<time>.ndjson, and the report
 * in the .txt beside it.
 */

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { Recorder, fmt, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim, describeSystemEvent } from "../aircraft/lib/sim.mjs"

// Environment variables read without the E: prefix through SimConnect
// (record/areas/avatars, p01-avatar.mjs, which reads IS AVATAR that way).
const CLOCK = [
  ["SIMULATION RATE", "number"], ["ZULU TIME", "seconds"], ["LOCAL TIME", "seconds"],
  ["ZULU DAY OF MONTH", "number"], ["ZULU MONTH OF YEAR", "number"], ["ZULU YEAR", "number"],
  ["ZULU DAY OF YEAR", "number"], ["LOCAL DAY OF MONTH", "number"], ["LOCAL MONTH OF YEAR", "number"],
  ["GROUND VELOCITY", "knots"],
]

const TOUR = [
  ["Open the pause menu (Esc)", "close it"],
  ["Turn active pause on", "turn it off"],
  ["Press the key you use to pause, if it isn't the menu", "press it again"],
  ["Open the EFB (Tab)", "close it"],
  ["Open photo mode", "leave it"],
]
const HALF_MS = 4000

const rec = new Recorder("p01-clock", { area: "environment" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p01-clock" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()

let latest = {}
let window = null
const w = sim.watch(CLOCK, {
  period: "frame",
  changed: false,
  label: "clock",
  onData: (v, t) => {
    latest = Object.fromEntries(v)
    if (window && t - window.lastAt >= 250) {
      window.lastAt = t
      window.samples.push({ t, ...latest, pause: sim.live.pause })
      rec.data("clock", "", { window: window.name, ...latest, pause: sim.live.pause })
    }
  },
})
const pauses = []
sim.systemHandlers.add((name, data) => {
  if (name === "Pause_EX1" && window) window.pauses.push({ t: Date.now(), data })
  if (name === "Pause_EX1") pauses.push({ t: Date.now(), data, window: window?.name ?? null })
})

const report = []
let start = null

async function watchFor(name, ms) {
  window = { name, samples: [], pauses: [], lastAt: 0 }
  await sleep(ms)
  const done = window
  window = null
  return done
}

// Whether the sim's clock ran across a window: zulu seconds against real
// seconds, taking a wrap at midnight into account.
function clockRate(samples) {
  if (samples.length < 2) return null
  const a = samples[0], b = samples[samples.length - 1]
  let dz = b["ZULU TIME"] - a["ZULU TIME"]
  if (dz < -43_200) dz += 86_400
  return dz / ((b.t - a.t) / 1000)
}
const flags = (list) => (list.length ? list.map((p) => describeSystemEvent("Pause_EX1", p.data)).join(" → ") : "no Pause_EX1")
const hm = (s) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`
const date = (r) => `${r["ZULU YEAR"]}-${String(r["ZULU MONTH OF YEAR"]).padStart(2, "0")}-${String(r["ZULU DAY OF MONTH"]).padStart(2, "0")}`

let stopping = false
async function finish(why = null) {
  if (stopping) return
  stopping = true
  window = null
  if (start) {
    if ((sim.live.pause ?? 0) & 1) sim.transmit("PAUSE_SET", [0])
    await restoreRate(start["SIMULATION RATE"])
    sim.transmit("ZULU_HOURS_SET", [Math.floor(start["ZULU TIME"] / 3600)])
    sim.transmit("ZULU_MINUTES_SET", [Math.floor((start["ZULU TIME"] % 3600) / 60)])
    await sleep(1000)
    report.push(`Put back: rate ${fmt(latest["SIMULATION RATE"])}, zulu ${hm(latest["ZULU TIME"])} on ${date(latest)}, against ${fmt(start["SIMULATION RATE"])} and ${hm(start["ZULU TIME"])} on ${date(start)} at the start`)
  }
  w.stop()
  const text = [
    "p01 · The sim's pauses, simulation rate, and time of day from SimConnect, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    why ? `Stopped: ${why}` : null,
    "",
    ...report,
    "",
    `Every Pause_EX1: ${pauses.map((p) => `${p.window ?? "between steps"}: ${describeSystemEvent("Pause_EX1", p.data)}`).join("; ") || "none"}`,
    `Exceptions: ${rec.timeline.filter((e) => e.kind === "exception").map((e) => e.text).join("; ") || "none"}`,
  ].filter((x) => x !== null).join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
}

async function restoreRate(rate) {
  for (let i = 0; i < 12 && Math.abs(latest["SIMULATION RATE"] - rate) > 1e-6; i++) {
    sim.transmit(latest["SIMULATION RATE"] > rate ? "SIM_RATE_DECR" : "SIM_RATE_INCR", [])
    await sleep(700)
  }
}

// A second Ctrl+C while the first is putting things back would cut the
// putting back short, so it's ignored. The steps send through act(), which
// stops sending once finish() starts, so a step still running doesn't undo the
// putting back (in the 17-37-45 run, the rate step sent K:SIM_RATE_INCR after
// the putting back had begun).
process.on("SIGINT", async () => {
  if (stopping) return rec.log("stop", "Ctrl+C again: still putting things back")
  rec.log("stop", "Ctrl+C: putting the pause, rate, and time back")
  await finish("Ctrl+C")
  process.exit(0)
})
const act = (...args) => { if (!stopping) sim.transmit(...args) }
process.on("uncaughtException", async (e) => {
  rec.log("error", e.stack ?? String(e))
  await finish(String(e))
  process.exit(1)
})

// ---------------------------------------------------------------- steps

await sleep(1000)
start = { ...latest }
rec.log("start", `rate ${fmt(start["SIMULATION RATE"])}, zulu ${hm(start["ZULU TIME"])}, local ${hm(start["LOCAL TIME"])}, ${date(start)}, day of year ${fmt(start["ZULU DAY OF YEAR"])}, pause ${describeSystemEvent("Pause_EX1", sim.live.pause ?? 0)}`)

// --date: only the date events, on their own, about 30s. Whether
// K:ZULU_DAY_SET takes a day of the month or of the year is what it finds out:
// a value 40 days on lands in another month only if it's a day of the year.
if (process.argv.includes("--date")) {
  const d0 = start["ZULU DAY OF YEAR"]
  const y0 = start["ZULU YEAR"]
  const show = (r) => `${date(r)}, day of year ${fmt(r["ZULU DAY OF YEAR"])}, local ${r["LOCAL MONTH OF YEAR"]}/${r["LOCAL DAY OF MONTH"]}, zulu ${hm(r["ZULU TIME"])}`
  const tests = [
    ["ZULU_DAY_SET", ((d0 + 40 - 1) % 365) + 1],
    ["ZULU_DAY_SET", 10],
    ["ZULU_YEAR_SET", y0 + 1],
  ]
  let dayOfYear = null
  for (const [event, value] of tests) {
    const before = { ...latest }
    act(event, [value])
    const wv = await watchFor(`${event} ${value}`, 6000)
    const s = wv.samples
    const end = s[s.length - 1] ?? latest
    // The first test tells which meaning the day event has, and so how to put
    // the date back.
    if (dayOfYear === null) dayOfYear = end["ZULU DAY OF YEAR"] === value
    const line = `K:${event} ${value}: before ${show(before)}; after 1s ${show(s.find((x) => x.t - s[0].t >= 1000) ?? end)}; after 6s ${show(end)}`
    report.push(line)
    rec.log("date", line)
  }
  const dayBack = dayOfYear ? d0 : start["ZULU DAY OF MONTH"]
  act("ZULU_YEAR_SET", [y0])
  act("ZULU_DAY_SET", [dayBack])
  const back = await watchFor("date put back", 3000)
  const line = `K:ZULU_DAY_SET read as a day of the ${dayOfYear ? "year" : "month"}; put back with K:ZULU_YEAR_SET ${y0} and K:ZULU_DAY_SET ${dayBack}: ${show(back.samples[back.samples.length - 1] ?? latest)}`
  report.push(line)
  rec.log("date", line)
  await finish()
  process.exit(0)
}

// tour ---------------------------------------------
console.log([
  "",
  "▶ Pause tour, about 45s",
  `  Press ${START}. At each beep, do what the console says; at the next beep, undo it.`,
  ...TOUR.map(([a, b], i) => `   ${i + 1}. ${a}, then ${b}`),
  `  ${SKIP} skips the tour.`,
].join("\n"))
const k = await keys.next()
if (k.key === "START") {
  for (const [action, undo] of TOUR) {
    beep(1000, 100)
    console.log(`  ${action} …`)
    const on = await watchFor(`${action}`, HALF_MS)
    beep(700, 100)
    console.log(`  … ${undo}`)
    const off = await watchFor(`${action}, undone`, HALF_MS)
    const r1 = clockRate(on.samples), r2 = clockRate(off.samples)
    const line = `Tour, ${action}: ${flags(on.pauses)}; clock ran at ${r1 === null ? "—" : r1.toFixed(2)}x while on, ${r2 === null ? "—" : r2.toFixed(2)}x after undoing (${flags(off.pauses)})`
    report.push(line)
    rec.log("tour", line)
  }
  beep(500, 600)
}

// pause --------------------------------------------
{
  act("PAUSE_SET", [1])
  const on = await watchFor("PAUSE_SET 1", 2500)
  act("PAUSE_SET", [0])
  const off = await watchFor("PAUSE_SET 0", 2500)
  const line = `K:PAUSE_SET 1: ${flags(on.pauses)}, clock at ${clockRate(on.samples)?.toFixed(2) ?? "—"}x; K:PAUSE_SET 0: ${flags(off.pauses)}, clock at ${clockRate(off.samples)?.toFixed(2) ?? "—"}x`
  report.push(line)
  rec.log("pause", line)
}

// rate ---------------------------------------------
{
  const steps = []
  const read = async (what) => { await sleep(1200); steps.push(`${what} → ${fmt(latest["SIMULATION RATE"])}`) }
  act("SIM_RATE_INCR", []); await read("SIM_RATE_INCR")
  act("SIM_RATE_INCR", []); await read("SIM_RATE_INCR")
  act("SIM_RATE_SET", [1]); await read("SIM_RATE_SET 1")
  act("SIM_RATE_INCR", []); await read("SIM_RATE_INCR")
  act("SIM_RATE_SET", [256]); await read("SIM_RATE_SET 256")
  if (!stopping) await restoreRate(start["SIMULATION RATE"])
  steps.push(`put back → ${fmt(latest["SIMULATION RATE"])}`)
  const line = `Simulation rate from ${fmt(start["SIMULATION RATE"])}: ${steps.join(", ")}`
  report.push(line)
  rec.log("rate", line)
}

// time ---------------------------------------------
{
  const h0 = Math.floor(latest["ZULU TIME"] / 3600)
  const m0 = Math.floor((latest["ZULU TIME"] % 3600) / 60)
  const tests = [
    ["ZULU_HOURS_SET", (h0 + 3) % 24, 20_000],
    ["ZULU_MINUTES_SET", (m0 + 17) % 60, 15_000],
    ["CLOCK_HOURS_SET", (Math.floor(latest["LOCAL TIME"] / 3600) + 5) % 24, 15_000],
  ]
  for (const [event, value, ms] of tests) {
    const before = { ...latest }
    act(event, [value])
    const wv = await watchFor(`${event} ${value}`, ms)
    const s = wv.samples
    const at = (sec) => s.find((x) => x.t - s[0].t >= sec * 1000) ?? s[s.length - 1]
    const show = (r) => `zulu ${hm(r["ZULU TIME"])}, local ${hm(r["LOCAL TIME"])}, ${date(r)}`
    const line = `K:${event} ${value}: before ${show(before)}; after 1s ${show(at(1))}; after 5s ${show(at(5))}; at the end ${show(s[s.length - 1])}`
    report.push(line)
    rec.log("time", line)
  }
}

await finish()
process.exit(0)
