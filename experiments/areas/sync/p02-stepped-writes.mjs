/*
 * How the A220, the A350, and the Fenix take stepped writes: the plan's step 6
 * probe on pacing (record/areas/product/plan.md), which asks the A220 study's
 * sim question 5, the A350 study's question 3, and the Fenix study's questions
 * 1 and 2.
 *
 *   node experiments/areas/sync/p02-stepped-writes.mjs [--only synaptic-a220]
 *   node experiments/areas/sync/p02-stepped-writes.mjs --only fenix-a320-family --from-step 6
 *
 * For each aircraft the pilot loads it as the prompt says and presses Page
 * Down; the probe then runs that aircraft's steps with hands off the cockpit.
 * Around each step it records every L: variable that moves, through
 * fsc-editor-link's stream, and the stock values the step names, every frame;
 * a value that moved in the 2s before the step is marked as moving anyway.
 * For the A220 it also runs the CommBus watcher
 * (experiments/areas/commbus/p02-commbus-watch.mjs) on the FCP's channel,
 * which needs the sim's inspector on 127.0.0.1:19999.
 *
 * "In one tick" means back to back from this process, which reached the sim in
 * one frame in p01-guided-load's order test if that test's second write always
 * won; "once per frame" means one write per SIM_FRAME delivery of a standing
 * request. The sim's window has to be in front, because a sim in the
 * background renders fewer frames (aircraft/run.mjs, frameSensitive).
 */

import { spawn } from "node:child_process"
import { join } from "node:path"

import { Link } from "../aircraft/lib/link.mjs"
import { REPO, Recorder, fmt, plural, repoRelative, secs, sleep } from "../aircraft/lib/out.mjs"
import { Sim } from "../aircraft/lib/sim.mjs"
import { startBeeper, startKeys, startSpeaker } from "../../tools/guide.mjs"

const OBSERVE_MS = 3000
const BASELINE_MS = 2000

// ---------------------------------------------------------------- the steps

// Each step's run(ctx) acts; the probe then watches for OBSERVE_MS.
const AIRCRAFT_STEPS = [
  {
    id: "synaptic-a220",
    // Sim question 5 in record/areas/aircraft/synaptic-a220/study.md.
    prompt: "Load the Synaptic A220 with power on and the autopilot's control panel lit.",
    commbus: "FCP",
    stock: [["AUTOPILOT HEADING LOCK DIR", "degrees"], ["AUTOPILOT AIRSPEED HOLD VAR", "knots"], ["AUTOPILOT VERTICAL HOLD VAR", "feet/minute"]],
    steps: [
      { label: "K:HEADING_BUG_SET 90", run: (c) => c.sim.transmit("K:HEADING_BUG_SET", [90]) },
      { label: "K:AP_SPD_VAR_SET 250", run: (c) => c.sim.transmit("K:AP_SPD_VAR_SET", [250]) },
      { label: "K:AP_VS_VAR_SET_ENGLISH 1500", run: (c) => c.sim.transmit("K:AP_VS_VAR_SET_ENGLISH", [1500]) },
      { label: "K:HEADING_BUG_INC 10 times in one tick", run: (c) => { for (let i = 0; i < 10; i++) c.sim.transmit("K:HEADING_BUG_INC", [], { quiet: true }) } },
      { label: "K:HEADING_BUG_INC once per frame, 10 times", run: (c) => c.everyFrame(10, () => c.sim.transmit("K:HEADING_BUG_INC", [], { quiet: true })) },
    ],
  },
  {
    id: "inibuilds-a350",
    // Sim question 3 in record/areas/aircraft/inibuilds-a350/study.md.
    prompt: "Load the iniBuilds A350 with power on and the captain's barometer showing.",
    stock: [["KOHLSMAN SETTING MB:1", "millibars"]],
    steps: [
      { label: "L:INI_BARO1_INC_COMMAND = 1, twice in one tick", run: (c) => { c.setL("L:INI_BARO1_INC_COMMAND", 1); c.setL("L:INI_BARO1_INC_COMMAND", 1) } },
      { label: "L:INI_BARO1_INC_COMMAND = 1, once per frame, 10 times", run: (c) => c.everyFrame(10, () => c.setL("L:INI_BARO1_INC_COMMAND", 1)) },
      { label: "L:INI_BARO1_DEC_COMMAND = 1, every 150ms, 11 times, to go back", run: (c) => c.everyMs(150, 11, () => c.setL("L:INI_BARO1_DEC_COMMAND", 1)) },
    ],
  },
  {
    id: "fenix-a320-family",
    // Sim question 1 in record/areas/aircraft/fenix-a320-family/study.md.
    prompt: "Load the Fenix A320 cold and dark at a gate, with the Fenix programs running.",
    stock: [["AUTOPILOT HEADING LOCK DIR", "degrees"], ["ELECTRICAL MASTER BATTERY:1", "bool"]],
    steps: [
      { label: "L:S_OH_ELEC_BAT1 = 1 from SimConnect", run: (c) => c.setL("L:S_OH_ELEC_BAT1", 1) },
      { label: "L:S_MIP_CLOCK_CHR + 1, 1s, + 1", run: async (c) => { await c.addL("L:S_MIP_CLOCK_CHR", 1); await sleep(1000); await c.addL("L:S_MIP_CLOCK_CHR", 1) } },
      { label: "L:S_MIP_CLOCK_CHR + 3 at once", run: (c) => c.addL("L:S_MIP_CLOCK_CHR", 3) },
      { label: "L:S_MIP_CLOCK_CHR + 1", run: (c) => c.addL("L:S_MIP_CLOCK_CHR", 1) },
      { label: "L:S_MIP_CLOCK_CHR + 2 at once", run: (c) => c.addL("L:S_MIP_CLOCK_CHR", 2) },
      // Sim question 2: the FCU needs power, which the pilot sets up.
      // The first run's heading steps fell inside the FCU's power-up, when its
      // AP lights and dashed displays flipped 9 times in 3s (results/p02-
      // stepped-writes-2026-10-05-19-37-47.txt), so the pilot waits it out.
      { pilot: "Power the Fenix so the FCU shows a heading, and set the heading to 360 by hand. Wait until the FCU stops flashing, then Page Down." },
      { label: "L:E_FCU_HEADING + 1", run: (c) => c.addL("L:E_FCU_HEADING", 1) },
      { label: "L:E_FCU_HEADING + 10 at once", run: (c) => c.addL("L:E_FCU_HEADING", 10) },
      { label: "L:S_FCU_HEADING - 1", run: (c) => c.addL("L:S_FCU_HEADING", -1) },
      { label: "L:S_FCU_HEADING + 1", run: (c) => c.addL("L:S_FCU_HEADING", 1) },
    ],
  },
]

const args = process.argv.slice(2)
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null
// --from-step N starts each aircraft at its Nth step, counting the pilot's, so
// the Fenix's heading steps can run alone: --only fenix-a320-family --from-step 6.
const FROM_STEP = args.includes("--from-step") ? Number(args[args.indexOf("--from-step") + 1]) : 1
const plan = AIRCRAFT_STEPS.filter((a) => !ONLY || a.id === ONLY)

// ---------------------------------------------------------------- recording

const rec = new Recorder("p02-stepped-writes", { area: "sync" })
const names = new Map()
const lastL = new Map()
let obs = null // { changes: [] } while a step's observation runs
let sim, link, keys
let beep = () => {}
let say = () => {}

function onValues(values, t) {
  for (const { id, value } of values) {
    const before = lastL.get(id)
    lastL.set(id, value)
    if (obs && before !== undefined && before !== value) obs.changes.push({ t, name: names.get(id) ?? `L:#${id}`, before, value })
  }
}

function makeContext() {
  const c = {
    sim,
    setL: (name, v) => sim.set([[name, "number"]], [v], { quiet: true }),
    addL: async (name, d) => {
      const now = await sim.readOne(name, "number")
      if (typeof now !== "number") { rec.log("warn", `${name} didn't read, so nothing was added`); return }
      c.setL(name, now + d)
      rec.log("add", `${name} ${fmt(now)} → ${fmt(now + d)}`)
    },
    everyFrame: (n, fn) => new Promise((resolve) => {
      let i = 0
      const w = sim.watch([["SIM ON GROUND", "bool"]], {
        period: "frame",
        changed: false,
        label: "per frame",
        onData: () => {
          if (i >= n) return
          fn(i++)
          if (i >= n) { w.stop(); resolve() }
        },
      })
    }),
    everyMs: async (ms, n, fn) => { for (let i = 0; i < n; i++) { fn(i); await sleep(ms) } },
  }
  return c
}

// Every change in [t0 - BASELINE_MS, t0 + OBSERVE_MS] with its time from t0,
// the values that moved before t0 marked as already moving.
async function observe(label, act, stock) {
  obs = { changes: [] }
  const stockChanges = []
  const w = sim.watch(stock, { period: "frame", label: "stock", onChange: (name, v, before, t) => { if (before !== undefined) stockChanges.push({ t, name: `A:${name}`, before, value: v }) } })
  await sleep(BASELINE_MS)
  const t0 = Date.now()
  rec.log("step", label)
  try { await act() } catch (e) { rec.log("error", `${label}: ${e.message}`) }
  const tActed = Date.now()
  await sleep(OBSERVE_MS)
  w.stop()
  const changes = [...obs.changes, ...stockChanges].sort((a, b) => a.t - b.t)
  obs = null
  const moving = new Set(changes.filter((c) => c.t < t0).map((c) => c.name))
  const after = changes.filter((c) => c.t >= t0)
  const byName = new Map()
  for (const c of after) {
    const e = byName.get(c.name) ?? { name: c.name, first: c.before, last: c.value, n: 0, ms: [], moving: moving.has(c.name) }
    e.last = c.value
    e.n++
    if (e.ms.length < 20) e.ms.push(c.t - t0)
    byName.set(c.name, e)
  }
  const moved = [...byName.values()].sort((a, b) => Number(a.moving) - Number(b.moving) || a.ms[0] - b.ms[0])
  const quiet = moved.filter((e) => !e.moving)
  rec.log("moved", `${label}: ${quiet.map((e) => `${e.name} ${fmt(e.first)} → ${fmt(e.last)} (${plural(e.n, "change")}, first +${e.ms[0]}ms)`).join("; ") || "nothing that was still before"}${moved.length > quiet.length ? `; ${moved.length - quiet.length} already moving` : ""}`, { label, actMs: tActed - t0, moved })
  return { label, actMs: tActed - t0, moved }
}

// ---------------------------------------------------------------- the run

function startCommBus(filter) {
  const script = join(REPO, "experiments", "areas", "commbus", "p02-commbus-watch.mjs")
  const child = spawn(process.execPath, [script, "--minutes", "4", "--show", filter], { stdio: ["ignore", "pipe", "pipe"] })
  child.stdout.on("data", (b) => { for (const line of String(b).split(/\r?\n/).filter(Boolean)) rec.log("commbus", line) })
  child.stderr.on("data", (b) => rec.log("commbus", `stderr: ${String(b).trim()}`))
  return child
}

async function oneAircraft(a, i, total) {
  beep(880, 150)
  say(`Aircraft ${i} of ${total}. ${a.prompt} Page Down when ready.`)
  rec.log("prompt", `[${i}/${total}] ${a.prompt} Page Down when ready; Page Up skips it.`)
  const k = await keys.next()
  if (k.key !== "START") return { id: a.id, skipped: true }
  beep(1200, 120)
  say("Hands off.")
  const commbus = a.commbus ? startCommBus(a.commbus) : null
  if (commbus) await sleep(12_000) // the watcher's warm-up, WARMUP_MS 8000, plus its attach
  const fps = await sim.frameRate(5000)
  rec.log("fps", `${fps.fps === null ? "no" : fps.fps.toFixed(1)} sim frames a second`, fps)
  const c = makeContext()
  const results = []
  for (const step of a.steps.slice(FROM_STEP - 1)) {
    if (step.pilot) {
      beep(880, 150)
      say(step.pilot)
      rec.log("prompt", step.pilot)
      const k2 = await keys.next()
      if (k2.key !== "START") break
      beep(1200, 120)
      say("Hands off.")
      continue
    }
    results.push(await observe(step.label, () => step.run(c), a.stock ?? []))
  }
  if (commbus) { commbus.kill(); await sleep(1000) }
  beep(660, 400)
  say(i < total ? "Done. Load the next aircraft." : "Done. That was the last one.")
  return { id: a.id, fps: fps.fps, results }
}

function report(all) {
  const lines = [`p02-stepped-writes, started ${new Date(rec.started).toISOString()}`, `Each step lists what moved in the ${OBSERVE_MS / 1000}s after it acted; a value already moving in the ${BASELINE_MS / 1000}s before is counted apart.`, ""]
  for (const r of all) {
    if (r.skipped) { lines.push(`== ${r.id}: skipped`, ""); continue }
    lines.push(`== ${r.id}, ${r.fps ? `${r.fps.toFixed(1)} fps` : "no frame rate"}`)
    for (const s of r.results) {
      lines.push(`   ${s.label} (acted in ${s.actMs}ms):`)
      const quiet = s.moved.filter((e) => !e.moving)
      for (const e of quiet.slice(0, 30)) lines.push(`      ${e.name} ${fmt(e.first)} → ${fmt(e.last)}, ${plural(e.n, "change")} at ${e.ms.map((m) => `+${m}ms`).join(" ")}`)
      if (quiet.length > 30) lines.push(`      and ${quiet.length - 30} more`)
      if (!quiet.length) lines.push("      nothing that was still before")
      const moving = s.moved.length - quiet.length
      if (moving) lines.push(`      (${moving} already moving)`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

async function main() {
  rec.open()
  keys = await startKeys()
  beep = startBeeper()
  say = startSpeaker()
  sim = await Sim.connect(rec, { name: "CROSSCHECK p02 stepped writes" })
  sim.track()
  link = new Link(sim)
  const stream = link.stream({
    onHello: (h) => rec.log("link", `fsc-editor-link ${h.version}, ${h.count} L: names`),
    onNames: (list) => { for (const { id, name } of list) names.set(id, `L:${name}`) },
    onValues,
  })
  const rescan = setInterval(() => stream.rescan(), 5000)
  const all = []
  let stopping = false
  process.on("SIGINT", () => { stopping = true })
  for (const [i, a] of plan.entries()) {
    if (stopping || sim.gone) break
    all.push(await oneAircraft(a, i + 1, plan.length))
  }
  clearInterval(rescan)
  const text = report(all)
  rec.writeReport(text)
  console.log("\n" + text)
  console.log(`saved ${repoRelative(rec.files.txt)}`)
  await stream.stop()
  link.stop()
  sim.close()
  await rec.close()
  process.exit(0)
}

main().catch(async (e) => {
  rec.log("error", e.stack ?? String(e))
  await rec.close()
  process.exit(1)
})
