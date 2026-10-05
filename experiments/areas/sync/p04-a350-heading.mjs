/*
 * p04: what the iniBuilds A350 does with a heading set from outside, with the
 * aircraft powered.
 *
 *   node experiments/areas/sync/p04-a350-heading.mjs
 *
 * In p01, on an A350 whose own battery switches read off, a single
 * K:HEADING_BUG_SET showed in A:AUTOPILOT HEADING LOCK DIR within a frame, and
 * after two in one tick the value 300ms later was neither (results/p01-guided-
 * load-2026-10-05-16-54-34.txt, load 5). The A350's module writes its own
 * dial, L:INI_HEADING_DIAL, over the stock heading (measured on MSFS 2024,
 * 2026-10-05, record/areas/sync/log.md, "The A350's stock heading is an output
 * of its module, and its dial takes a value written straight into it"), so
 * the module may write its dial back over ours, powered or not.
 *
 * With the A350 powered and the sim in front, the probe watches, every frame,
 * the stock heading, the FCU dial, the heading preset, and the knob's command
 * variables, and for each step lists every change in the 3s after it with its
 * time and frame:
 *   1. K:HEADING_BUG_SET 93;
 *   2. K:HEADING_BUG_SET 142, then 41, in one tick;
 *   3. K:HEADING_BUG_INC once;
 *   4. L:INI_HEADING_DIAL_UP_COMMAND = 1, the FCU knob's own path, a detent up;
 *   5. L:INI_HEADING_DIAL_DN_COMMAND = 1, a detent back;
 *   6. L:INI_HEADING_DIAL written directly to 93, then 271, then back to its
 *      start, which says whether the heading can sync as one write;
 *   7. the up command every 2 frames, 10 times, and the down command every 3
 *      frames, 10 times, which says how fast commands may follow.
 * It sets the stock heading back to the dial's value at the end.
 */

import { Recorder, fmt, repoRelative, sleep } from "../aircraft/lib/out.mjs"
import { Sim } from "../aircraft/lib/sim.mjs"
import { startBeeper, startKeys, startSpeaker } from "../../tools/guide.mjs"

const BASELINE_MS = 2000
const OBSERVE_MS = 3000
const WATCH = [
  ["AUTOPILOT HEADING LOCK DIR", "degrees"],
  ["L:INI_HEADING_DIAL", "number"],
  ["L:INI_HDG_PRESET", "number"],
  ["L:INI_HEADING_DIAL_UP_COMMAND", "number"],
  ["L:INI_HEADING_DIAL_DN_COMMAND", "number"],
]

const rec = new Recorder("p04-a350-heading", { area: "sync" })
let frame = 0
let changes = []

async function main() {
  rec.open()
  const keys = await startKeys()
  const beep = startBeeper()
  const say = startSpeaker()
  const sim = await Sim.connect(rec, { name: "CROSSCHECK p04 A350 heading" })
  sim.track()
  await sleep(1500)

  beep(880, 150)
  say("In the powered A350, with the FCU lit and the sim in front, press Page Down.")
  rec.log("prompt", "In the A350, powered, with the FCU lit and the sim in front. Page Down to start; hands off afterward, about 30s.")
  await keys.next()
  say("Hands off.")

  sim.watch([["SIM ON GROUND", "bool"]], { period: "frame", changed: false, label: "frames", onData: () => { frame++ } })
  sim.watch(WATCH, {
    period: "frame",
    label: "heading",
    onChange: (name, v, before, t) => {
      if (before === undefined) return
      changes.push({ t, frame, name: name.startsWith("L:") ? name : `A:${name}`, before, value: v })
    },
  })
  const start = await sim.read(WATCH)
  rec.log("start", WATCH.map(([n]) => `${n.startsWith("L:") ? n : `A:${n}`} ${fmt(start.get(n))}`).join("; "))
  const startDial = start.get("L:INI_HEADING_DIAL") ?? 0

  // Calls fn n times, once every `every` sim frames, counted by the frame watch.
  const everyFrames = (n, every, fn) => new Promise((resolve) => {
    let sent = 0
    let next = frame
    const tick = setInterval(() => {
      if (frame < next) return
      fn(sent++)
      next = frame + every
      if (sent >= n) { clearInterval(tick); resolve() }
    }, 2)
  })

  const steps = [
    { label: "K:HEADING_BUG_SET 93", run: () => sim.transmit("K:HEADING_BUG_SET", [93], { quiet: true }) },
    { label: "K:HEADING_BUG_SET 142, then 41, in one tick", run: () => { sim.transmit("K:HEADING_BUG_SET", [142], { quiet: true }); sim.transmit("K:HEADING_BUG_SET", [41], { quiet: true }) } },
    { label: "K:HEADING_BUG_INC once", run: () => sim.transmit("K:HEADING_BUG_INC", [0], { quiet: true }) },
    { label: "L:INI_HEADING_DIAL_UP_COMMAND = 1", run: () => sim.set([["L:INI_HEADING_DIAL_UP_COMMAND", "number"]], [1], { quiet: true }) },
    { label: "L:INI_HEADING_DIAL_DN_COMMAND = 1", run: () => sim.set([["L:INI_HEADING_DIAL_DN_COMMAND", "number"]], [1], { quiet: true }) },
    // Whether the dial takes a value written straight into it, which would let
    // the heading sync as one write rather than one detent per command.
    { label: "L:INI_HEADING_DIAL = 93, written directly", run: () => sim.set([["L:INI_HEADING_DIAL", "number"]], [93], { quiet: true }) },
    { label: "L:INI_HEADING_DIAL = 271, written directly", run: () => sim.set([["L:INI_HEADING_DIAL", "number"]], [271], { quiet: true }) },
    { label: "L:INI_HEADING_DIAL back to its start, written directly", run: () => sim.set([["L:INI_HEADING_DIAL", "number"]], [startDial], { quiet: true }) },
    // How fast commands may follow: p02's baro commands sent every frame lost
    // every other one (results/p02-stepped-writes-2026-10-05-19-37-47.txt).
    { label: "L:INI_HEADING_DIAL_UP_COMMAND = 1, every 2 frames, 10 times", run: () => everyFrames(10, 2, () => sim.set([["L:INI_HEADING_DIAL_UP_COMMAND", "number"]], [1], { quiet: true })) },
    { label: "L:INI_HEADING_DIAL_DN_COMMAND = 1, every 3 frames, 10 times", run: () => everyFrames(10, 3, () => sim.set([["L:INI_HEADING_DIAL_DN_COMMAND", "number"]], [1], { quiet: true })) },
  ]

  const results = []
  for (const s of steps) {
    changes = []
    await sleep(BASELINE_MS)
    const before = changes.length
    const t0 = Date.now()
    const f0 = frame
    rec.log("step", s.label)
    await s.run()
    await sleep(OBSERVE_MS)
    const after = changes.slice(before).map((c) => ({ ...c, ms: c.t - t0, frames: c.frame - f0 }))
    rec.log("moved", `${s.label}: ${after.map((c) => `+${c.ms}ms (frame ${c.frames}) ${c.name} ${fmt(c.before)} → ${fmt(c.value)}`).join("; ") || "nothing"}${before ? `; ${before} changes in the 2s before` : ""}`, { label: s.label, after, movingBefore: before })
    results.push({ label: s.label, after, movingBefore: before })
  }

  // Back to what the FCU shows, so the stock target and the dial agree again.
  const dial = await sim.readOne("L:INI_HEADING_DIAL", "number")
  if (typeof dial === "number") sim.transmit("K:HEADING_BUG_SET", [Math.round(dial)], { quiet: true })
  await sleep(500)
  const end = await sim.read(WATCH)
  rec.log("end", WATCH.map(([n]) => `${n.startsWith("L:") ? n : `A:${n}`} ${fmt(end.get(n))}`).join("; "))
  beep(660, 400)
  say("Done.")

  const lines = [`p04-a350-heading, started ${new Date(rec.started).toISOString()}`, ""]
  lines.push(`Before: ${WATCH.map(([n]) => `${n.startsWith("L:") ? n : `A:${n}`} ${fmt(start.get(n))}`).join("; ")}`, "")
  for (const r of results) {
    const dial = r.after.filter((c) => c.name === "L:INI_HEADING_DIAL")
    const net = dial.length ? `; the dial went ${fmt(dial[0].before)} → ${fmt(dial.at(-1).value)} in ${dial.length} changes` : ""
    lines.push(`== ${r.label}${r.movingBefore ? ` (${r.movingBefore} changes in the 2s before)` : ""}${net}`)
    for (const c of r.after.slice(0, 40)) lines.push(`   +${c.ms}ms, frame ${c.frames}: ${c.name} ${fmt(c.before)} → ${fmt(c.value)}`)
    if (!r.after.length) lines.push("   nothing moved")
    lines.push("")
  }
  lines.push(`After: ${WATCH.map(([n]) => `${n.startsWith("L:") ? n : `A:${n}`} ${fmt(end.get(n))}`).join("; ")}`)
  const text = lines.join("\n")
  rec.writeReport(text)
  console.log("\n" + text)
  console.log(`saved ${repoRelative(rec.files.txt)}`)
  sim.close()
  await rec.close()
  process.exit(0)
}

main().catch(async (e) => {
  rec.log("error", e.stack ?? String(e))
  await rec.close()
  process.exit(1)
})
