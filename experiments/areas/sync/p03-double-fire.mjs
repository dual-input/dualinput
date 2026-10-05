/*
 * Whether the input event double-fire stays inside live sync's duplicate
 * filter at a low frame rate, and whether a held key repeats inside it: the
 * plan's step 6 probe (record/areas/product/plan.md) on the filter that
 * record/areas/sync/02-live-sync.md, "Keeping a change from applying twice",
 * sets at 3 frames, capped at 200ms.
 *
 *   node experiments/areas/sync/p03-double-fire.mjs
 *
 * On the A2A PA-24, fsc-editor saw each input event reported twice: of 53
 * same-name, same-value pairs, 43 came 17ms to 21ms apart, 9 came 37ms to 40ms
 * apart, and one, a course knob dragged through the same value, 261ms apart;
 * that session's frame rate wasn't recorded (fsc-editor,
 * docs/sim-vars/build/v1-log.md, "2026-08-23 — Stage 2 verified live. The
 * double-fire is frame-locked, and tighter than measured.").
 *
 * The probe subscribes to every input event the loaded aircraft has, counts
 * sim frames with a standing per-frame request, and stamps each report with
 * its time and frame. The pilot, in the PA-24:
 *   1. clicks about 10 switches once each, a second apart, at their usual
 *      frame rate;
 *   2. caps the frame rate near 20 fps and clicks the same switches;
 *   3. holds a key bound to a momentary control, such as the starter, for 3s,
 *      twice, and holds the mouse on a momentary button for 3s.
 * The report gives, per phase, the frame rate and every same-name,
 * same-value pair's gap in milliseconds and frames, against the filter.
 */

import { Recorder, fmt, plural, repoRelative, secs, sleep } from "../aircraft/lib/out.mjs"
import { Sim } from "../aircraft/lib/sim.mjs"
import { startBeeper, startKeys, startSpeaker } from "../../tools/guide.mjs"

const FILTER = { frames: 3, capMs: 200 }

const PHASES = [
  { id: "usual", say: "Click about ten switches once each, a second apart. Page Down when done.", text: "At your usual frame rate, click about 10 switches once each, about a second apart. Page Down when done." },
  { id: "capped", before: "Cap the frame rate near 20 frames a second. Page Down when it's capped.", say: "Click the same switches once each, a second apart. Page Down when done.", text: "With the frame rate capped near 20 fps, click the same switches once each, a second apart. Page Down when done." },
  { id: "held", say: "Hold a key bound to a momentary control for three seconds, twice. Then hold the mouse on a momentary button for three seconds. Page Down when done.", text: "Hold a key bound to a momentary control, such as the starter, for 3s, twice; then hold the mouse on a momentary button for 3s. Page Down when done." },
]

const rec = new Recorder("p03-double-fire", { area: "sync" })
let frame = 0
const frameTimes = []

async function main() {
  rec.open()
  const keys = await startKeys()
  const beep = startBeeper()
  const say = startSpeaker()
  const sim = await Sim.connect(rec, { name: "CROSSCHECK p03 double-fire" })
  sim.track()
  await sleep(1500)

  beep(880, 150)
  say("Load the A2A Comanche, and press Page Down when you're in the cockpit.")
  rec.log("prompt", "Load the A2A PA-24 Comanche, anywhere, and Page Down when you're in the cockpit.")
  await keys.next()

  const list = await sim.inputEvents()
  rec.log("inputs", `${plural(list.length, "input event")} on ${sim.live.title ?? "the loaded aircraft"}`)
  const byHash = new Map(list.map((e) => [String(e.hash), e.name]))

  sim.watch([["SIM ON GROUND", "bool"]], {
    period: "frame",
    changed: false,
    label: "frames",
    onData: (_, t) => { frame++; frameTimes.push(t) },
  })

  let phase = null
  const reports = []
  sim.subscribeInputEvents([...byHash.keys()], ({ hash, value, t }) => {
    const r = { phase: phase?.id ?? "between", name: byHash.get(hash) ?? hash, value, t, frame }
    reports.push(r)
    rec.data("input", `${r.phase} ${r.name} ${fmt(value)} at frame ${frame}`, r)
  })

  const phases = []
  for (const p of PHASES) {
    if (p.before) {
      beep(880, 150)
      say(p.before)
      rec.log("prompt", p.before)
      await keys.next()
    }
    beep(880, 150)
    say(p.say)
    rec.log("prompt", p.text)
    const f0 = frame
    const t0 = Date.now()
    phase = p
    await keys.next()
    phase = null
    const ms = Date.now() - t0
    const fps = ((frame - f0) / ms) * 1000
    phases.push({ id: p.id, ms, frames: frame - f0, fps })
    rec.log("phase", `${p.id}: ${fps.toFixed(1)} sim frames a second over ${secs(ms)}`)
    beep(1200, 120)
  }
  say("Done. Put the frame rate back.")

  const text = report(phases, reports)
  rec.writeReport(text)
  console.log("\n" + text)
  console.log(`saved ${repoRelative(rec.files.txt)}`)
  sim.close()
  await rec.close()
  process.exit(0)
}

// Pairs of consecutive reports of one name with the same value, within a phase.
function pairs(reports) {
  const last = new Map()
  const out = []
  for (const r of reports) {
    const prev = last.get(r.name)
    if (prev && prev.value === r.value) out.push({ name: r.name, value: r.value, ms: r.t - prev.t, frames: r.frame - prev.frame })
    last.set(r.name, r)
  }
  return out
}

function report(phases, reports) {
  const lines = [`p03-double-fire, started ${new Date(rec.started).toISOString()}`]
  lines.push(`Filter: a report with the same name and value as one from the last ${FILTER.frames} frames, but never one more than ${FILTER.capMs}ms after it, is dropped as an echo.`)
  lines.push("")
  for (const p of phases) {
    const own = reports.filter((r) => r.phase === p.id)
    const ps = pairs(own)
    const inFilter = ps.filter((x) => x.frames <= FILTER.frames && x.ms <= FILTER.capMs)
    lines.push(`== ${p.id}: ${p.fps.toFixed(1)} fps; ${plural(own.length, "report")}, ${plural(ps.length, "same-name, same-value pair")}, ${inFilter.length} inside the filter`)
    const hist = new Map()
    for (const x of ps) hist.set(x.frames, (hist.get(x.frames) ?? 0) + 1)
    lines.push(`   pairs by frames apart: ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([f, n]) => `${f}: ${n}`).join(", ") || "none"}`)
    for (const x of ps.slice(0, 60)) lines.push(`   ${x.name} ${fmt(x.value)}: ${x.ms}ms, ${plural(x.frames, "frame")}${x.frames <= FILTER.frames && x.ms <= FILTER.capMs ? ", inside" : ""}`)
    if (ps.length > 60) lines.push(`   and ${ps.length - 60} more in the NDJSON`)
    lines.push("")
  }
  return lines.join("\n")
}

main().catch(async (e) => {
  rec.log("error", e.stack ?? String(e))
  await rec.close()
  process.exit(1)
})
