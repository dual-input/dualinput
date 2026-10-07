/*
 * p03: can a SimConnect client take its masking priority before an aircraft
 * loads, ahead of the aircraft's own module, without holding back the pilot's
 * controls until it wants to mask? Node 1.1.1 of the architecture plan
 * (record/areas/architecture/plan.md).
 *
 * On the A2A PA-24, whose Accu-Sim masks the pilot's axis events, our masks
 * got ahead only when they were registered before the
 * aircraft loaded (measured on MSFS 2024, 2026-10-01, record/areas/
 * flight-controls/log.md, "2026-10-01: The mask registered first gets ahead of
 * Accu-Sim's"). Those masks masked from the start. This asks whether a group
 * that masks nothing until later keeps the same place, two ways at once:
 *
 *   group A  asks for 10,000,000 with no events in it, before the aircraft
 *            loads. After it loads, the elevator axis is added, maskable.
 *   group B  asks for 10,000,000 with the throttle axis in it, not maskable,
 *            before the aircraft loads, so it hears the throttle and holds
 *            nothing back. After it loads, a second client event for the same
 *            axis is added to the group, maskable.
 *
 * Two client events, not one swapped from listening to masking, because
 * removing a client event from a group cut the sim event off from the
 * client's other groups too (measured on MSFS 2024, 2026-10-01, the comment
 * on subscribeKeys in experiments/areas/aircraft/lib/sim.mjs).
 *
 * Which group gets 10,000,000 itself doesn't matter: whichever group asks
 * second gets the next free priority behind it (record/learn/foundations/
 * 04-02-events.md), and both still ask before Accu-Sim does.
 *
 * Run it with the sim at the main menu, before any aircraft has loaded since
 * the sim started:
 *
 *   node experiments/areas/flight-controls/p03-mask-at-start.mjs
 *   node experiments/areas/flight-controls/p03-mask-at-start.mjs --release
 *
 * Then load the A2A PA-24 Comanche parked from the world map. The probe waits
 * for Ready to fly, lets the aircraft settle, and asks for two windows, each
 * started with Page Down and ended by the long low beep, with a short beep at
 * each 5s phase:
 *
 *   pitch     keep moving the yoke fore and aft: free, masked by A, cleared
 *   throttle  keep moving the throttle idle to full: listening, masked by B,
 *             cleared
 *
 * A group is ahead of Accu-Sim when it hears the hardware's events and, once
 * masking, L:ElevatorInput or L:Throttle1Position, which follow the pilot's
 * input (measured, same log entry), stays
 * still. A group behind Accu-Sim hears none of the hardware's events, because
 * Accu-Sim masks them first; the elevator then shows only the aircraft's own
 * K:AXIS_ELEVATOR_SET, within ±5,349 (same log entry).
 *
 * The holder fails open as p01's masker does: it clears its groups and exits
 * when the observer's keepalive stops for 15s or its stdin closes, and after
 * 20 minutes in any case; killing it releases its masks (measured, same log,
 * "2026-10-01: Masking stops a pilot's hardware input, and closing the masking
 * client gives it back"); and --release kills every holder this probe started.
 *
 * Output: one line per phase on the console, and
 * results/p03-mask-at-start-<time>.txt and .ndjson.
 */

import { execFileSync, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { SKIP, START, encode, startBeeper, startKeys } from "../../tools/guide.mjs"
import { AIRCRAFT } from "../aircraft/lib/aircraft.mjs"
import { Recorder, fmt, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, PRIORITY, Sim } from "../aircraft/lib/sim.mjs"

const SELF = fileURLToPath(import.meta.url)
const argv = process.argv.slice(2)

const MASK_PRIORITY = PRIORITY.highest_maskable
const PITCH = "AXIS_ELEVATOR_SET"
const THROTTLE = "AXIS_THROTTLE1_SET"
const VARS = { pitch: ["L:ElevatorInput", "number"], throttle: ["L:Throttle1Position", "number"] }
const PA24 = AIRCRAFT["a2a-pa24-comanche"]
const PHASE_MS = 5_000
const SETTLE_MS = 20_000
const KEEPALIVE_MS = 5_000
const DEADMAN_MS = 15_000
const CAP_MS = 20 * 60_000
// Accu-Sim's own K:AXIS_ELEVATOR_SET stayed within ±5,349, and the hardware's
// reached ±16,380 (same log entry), so a value past this is the pilot's.
const HARDWARE_ABOVE = 6_000

// ---------------------------------------------------------------- the holder

/*
 * The process that holds the two groups. It talks to the observer by JSON
 * lines on stdout, and takes ALIVE, MASK_A, MASK_B, CLEAR_A, CLEAR_B, and QUIT
 * on stdin.
 */
async function holder() {
  const emit = (o) => { try { process.stdout.write(JSON.stringify(o) + "\n") } catch { /* observer gone */ } }
  const rec = {
    log: (kind, text, fields = {}) => emit({ kind, text, ...fields }),
    data: (kind, text, fields = {}) => emit({ kind, text, quiet: true, ...fields }),
  }
  let sim
  try {
    sim = await Sim.connect(rec, { name: "CROSSCHECK p03 holder" })
  } catch (e) {
    emit({ kind: "error", text: e.message })
    process.exit(1)
  }

  const groups = { A: sim.ids.group++, B: sim.ids.group++ }
  // Arrivals are routed by event name and group, so a second client event for
  // the same axis in the same group needs no second watcher.
  const watching = new Set()
  const listen = (label, name, id) => {
    sim.eventNames.set(id, name)
    if (watching.has(`${label} ${name}`)) return
    watching.add(`${label} ${name}`)
    sim.keyWatchers.add({
      group: groups[label], names: new Set([name]), quiet: true,
      onEvent: (e) => emit({ kind: "got", quiet: true, group: label, name: e.name, value: e.value, ours: e.ours }),
    })
  }
  const map = (name) => {
    const id = sim.ids.event++
    sim.send(`map K:${name} as ${id}`, () => sim.handle.mapClientEventToSimEvent(id, name))
    return id
  }

  // Group A: a priority and nothing else.
  sim.send(`group A (${groups.A}) priority ${MASK_PRIORITY}, no events`, () => sim.handle.setNotificationGroupPriority(groups.A, MASK_PRIORITY))
  // Group B: the throttle, listened to, then the priority, as subscribeKeys orders them.
  const b1 = map(THROTTLE)
  sim.send(`add K:${THROTTLE} (${b1}) to group B, not maskable`, () => sim.handle.addClientEventToNotificationGroup(groups.B, b1, false))
  sim.send(`group B (${groups.B}) priority ${MASK_PRIORITY}`, () => sim.handle.setNotificationGroupPriority(groups.B, MASK_PRIORITY))
  listen("B", THROTTLE, b1)

  const t0 = Date.now()
  let lastAlive = Date.now()
  let done = false
  const clearGroup = (label) => {
    if (!sim.gone) sim.send(`clear group ${label}`, () => sim.handle.clearNotificationGroup(groups[label]))
    emit({ kind: "cleared", text: `cleared group ${label}`, group: label })
  }
  const quit = (why) => {
    if (done) return
    done = true
    clearGroup("A")
    clearGroup("B")
    emit({ kind: "quit", text: why })
    setTimeout(() => { sim.close(); process.exit(0) }, 300)
  }

  createInterface({ input: process.stdin }).on("line", (l) => {
    if (l === "ALIVE") lastAlive = Date.now()
    if (l === "MASK_A") {
      const id = map(PITCH)
      sim.send(`add K:${PITCH} (${id}) to group A, maskable`, () => sim.handle.addClientEventToNotificationGroup(groups.A, id, true))
      listen("A", PITCH, id)
      emit({ kind: "masking", text: `group A masks K:${PITCH}`, group: "A" })
    }
    if (l === "MASK_B") {
      const id = map(THROTTLE)
      sim.send(`add K:${THROTTLE} (${id}) to group B, maskable`, () => sim.handle.addClientEventToNotificationGroup(groups.B, id, true))
      listen("B", THROTTLE, id)
      emit({ kind: "masking", text: `group B masks K:${THROTTLE} through a second client event`, group: "B" })
    }
    if (l === "CLEAR_A") clearGroup("A")
    if (l === "CLEAR_B") clearGroup("B")
    if (l === "QUIT") quit("the observer asked")
  }).on("close", () => quit("the observer's pipe closed"))
  sim.onLost((why) => { emit({ kind: "lost", text: why }); process.exit(0) })
  setInterval(() => {
    if (Date.now() - lastAlive > DEADMAN_MS) quit(`no keepalive for ${DEADMAN_MS / 1000}s`)
    if (Date.now() - t0 > CAP_MS) quit(`the ${CAP_MS / 60_000}-minute cap`)
  }, 1000)

  await sleep(500)
  emit({ kind: "ready", text: `group A asked for ${MASK_PRIORITY} with no events; group B asked for it listening to K:${THROTTLE}` })
}

// ---------------------------------------------------------------- the observer

const stats = () => ({ n: 0, hardware: 0, min: null, max: null })
function add(s, v) {
  s.n++
  if (Math.abs(v) > HARDWARE_ABOVE) s.hardware++
  s.min = s.min === null ? v : Math.min(s.min, v)
  s.max = s.max === null ? v : Math.max(s.max, v)
}
const span = (s) => (s && s.min !== null ? s.max - s.min : 0)
const range = (s) => (s.min === null ? "none" : s.min === s.max ? fmt(s.min) : `${fmt(s.min)}..${fmt(s.max)}`)

async function observer() {
  const rec = new Recorder("p03-mask-at-start", { area: "flight-controls" })
  const sim = await Sim.connect(rec, { name: "CROSSCHECK p03 observer" })
  rec.open()
  const keys = await startKeys()
  const beep = startBeeper()

  const holderOut = []
  let child = null
  const write = (l) => { try { child.stdin.write(l + "\n") } catch { /* not started, or exited */ } }

  const titleAtStart = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
  rec.log("start", `TITLE at start ${JSON.stringify(titleAtStart)}`, { title: titleAtStart })
  if (titleAtStart === PA24.title) {
    rec.log("error", `the ${PA24.name} is already loaded, so Accu-Sim registered first. Restart the sim, and run this at the main menu.`)
    return finish([], null, true)
  }

  // ------------------------------------------------ the holder

  let win = null
  child = spawn(process.execPath, [SELF, "--holder"], { stdio: ["pipe", "pipe", "inherit"] })
  const alive = setInterval(() => write("ALIVE"), KEEPALIVE_MS)
  const exited = new Promise((r) => child.on("exit", (code, signal) => {
    clearInterval(alive)
    rec.log("holder", `exited (${signal ?? `code ${code}`})`)
    r()
  }))
  const ready = new Promise((resolve, reject) => {
    createInterface({ input: child.stdout }).on("line", (l) => {
      let o
      try { o = JSON.parse(l) } catch { return rec.log("holder", l) }
      holderOut.push({ t: Date.now(), ...o })
      if (o.kind === "ready") resolve()
      if (o.kind === "error") reject(new Error(o.text))
      if (o.kind === "got") {
        if (win && !o.ours) add(win.holder[o.group], o.value)
        return rec.data("holder got", `group ${o.group} K:${o.name} ${o.value}`, o)
      }
      const { kind, text, quiet, ...fields } = o
      if (quiet) rec.data(`holder ${kind}`, text ?? "", fields)
      else rec.log("holder", `${kind}: ${text ?? ""}`, { holderKind: kind, ...fields })
    })
  })
  try {
    await Promise.race([ready, exited.then(() => { throw new Error("it exited before it was ready") })])
  } catch (e) {
    rec.log("error", `the holder didn't start: ${e.message}`)
    return finish([], null, true)
  }

  // ------------------------------------------------ the load

  console.log(`\n▶ Load the ${PA24.name} parked, from the world map. The probe waits for Ready to fly.`)
  let lastReady = 0
  sim.flowHandlers.add((name) => { if (name === "RTC_END") lastReady = Date.now() })
  while (!lastReady || Date.now() - lastReady < SETTLE_MS) await sleep(500)
  const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
  rec.log("loaded", `Ready to fly ${SETTLE_MS / 1000}s ago, TITLE ${JSON.stringify(title)}`, { title })
  if (title !== PA24.title) rec.log("warning", `expected TITLE ${JSON.stringify(PA24.title)}`)

  // ------------------------------------------------ watching

  sim.subscribeKeys([PITCH, THROTTLE], {
    priority: "highest", maskable: false, quiet: true,
    onEvent: (e) => { if (win && !e.ours) add(win.heard[e.name === PITCH ? "pitch" : "throttle"], e.value) },
  })
  const latest = {}
  sim.watch(Object.values(VARS), {
    period: "frame", label: "Accu-Sim's input",
    onChange: (name, v) => {
      latest[name] = v
      if (!win) return
      const s = win.value
      if (name === VARS[win.control][0]) add(s, v)
    },
  })
  await sleep(1000)

  // ------------------------------------------------ the windows

  const results = []
  async function phase(control, name, holderGroup) {
    win = { control, name, heard: { pitch: stats(), throttle: stats() }, holder: { A: stats(), B: stats() }, value: stats() }
    const v0 = latest[VARS[control][0]]
    if (typeof v0 === "number") add(win.value, v0)
    beep(1000, 100)
    await sleep(PHASE_MS)
    const w = win
    win = null
    const r = { control, phase: name, group: holderGroup, heard: w.heard[control], holder: w.holder[holderGroup], value: w.value }
    results.push(r)
    rec.log("phase", `${control} ${name}: ${line(r)}`, { control, phase: name, group: holderGroup, heard: r.heard, holder: r.holder, value: r.value })
    return r
  }
  const line = (r) => [
    `${VARS[r.control][0]} ${range(r.value)}`,
    `the hardware's events heard at the highest priority ×${r.heard.n} (${r.heard.hardware} past ±${HARDWARE_ABOVE})`,
    `group ${r.group} heard ×${r.holder.n} (${r.holder.hardware} past ±${HARDWARE_ABOVE}) ${range(r.holder)}`,
  ].join(" · ")

  async function ask(heading, instruction) {
    console.log(`\n▶ ${heading}\n  ${instruction}\n  ${START} to start, ${SKIP} to skip.`)
    beep(800, 150)
    const k = await keys.next()
    rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
    return k.key === "START"
  }

  if (await ask("Pitch: the yoke fore and aft", "Keep moving it through its full travel, back and forth, from Page Down until the long low beep, about 15s. Don't stop at the short beeps.")) {
    await phase("pitch", "free, group A empty", "A")
    write("MASK_A")
    await sleep(300)
    await phase("pitch", "masked by group A", "A")
    write("CLEAR_A")
    await sleep(300)
    await phase("pitch", "cleared", "A")
    beep(500, 600)
    console.log("  Stop.")
  }
  if (await ask("Throttle: engine 1's lever", "Keep moving it from idle to full and back, from Page Down until the long low beep, about 15s. Don't stop at the short beeps.")) {
    await phase("throttle", "listening, group B not masking", "B")
    write("MASK_B")
    await sleep(300)
    await phase("throttle", "masked by group B", "B")
    write("CLEAR_B")
    await sleep(300)
    await phase("throttle", "cleared", "B")
    beep(500, 600)
    console.log("  Stop.")
  }

  write("QUIT")
  await Promise.race([exited, sleep(3000)])
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  return finish(results, title, false)

  async function finish(rs, loadedTitle, failed) {
    const verdicts = []
    const free = (control) => rs.find((r) => r.control === control && r.phase.startsWith(control === "pitch" ? "free" : "listening"))
    for (const [control, label] of [["pitch", "A"], ["throttle", "B"]]) {
      const base = free(control)
      const masked = rs.find((r) => r.control === control && r.phase.startsWith("masked"))
      if (!base || !masked) { verdicts.push(`group ${label}: not run`); continue }
      const ratio = span(base.value) > 0 ? span(masked.value) / span(base.value) : null
      const held = ratio !== null && ratio < 0.1
      const heardHw = masked.holder.hardware > 0
      const word = held && heardHw ? "ahead of Accu-Sim: it heard the hardware and held the control still"
        : !held && !heardHw ? "behind Accu-Sim: it heard none of the hardware's events and the control moved"
          : `unclear: ${held ? "the control held" : "the control moved"}, and the group ${heardHw ? "heard" : "didn't hear"} the hardware`
      const listening = control === "throttle" ? ` · while only listening it heard ×${base.holder.n} (${base.holder.hardware} past ±${HARDWARE_ABOVE}), and ${VARS.throttle[0]} moved ${range(base.value)}` : ""
      verdicts.push(`group ${label}: ${word}${ratio === null ? "" : ` (${VARS[control][0]} at ${Math.round(ratio * 100)}% of its free range)`}${listening}`)
    }
    const exceptions = [
      ...rec.timeline.filter((e) => e.kind === "exception").map((e) => `observer: ${e.text}`),
      ...holderOut.filter((o) => o.kind === "exception").map((o) => `holder: ${o.text}`),
    ]
    const lines = [
      "p03 · Masking priority taken before the aircraft loads, on MSFS 2024",
      `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
      `TITLE at start ${JSON.stringify(titleAtStart)}, after the load ${JSON.stringify(loadedTitle)}`,
      `Groups asked for ${MASK_PRIORITY} at the main menu: A with no events, B listening to K:${THROTTLE}; ${PHASE_MS / 1000}s phases`,
      "",
      ...rs.map((r) => `${r.control} ${r.phase}: ${line(r)}`),
      "",
      ...verdicts,
      "",
      `Exceptions: ${exceptions.join("; ") || "none"}`,
    ]
    const report = lines.join("\n")
    console.log("\n" + report)
    rec.writeReport(report)
    if (failed) { write("QUIT"); await sleep(500) }
    sim.close()
    await rec.close()
    process.exit(0)
  }
}

// ---------------------------------------------------------------- release

function release() {
  const ps = `
$ProgressPreference = "SilentlyContinue"
$found = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'p03-mask-at-start\\.mjs.*--holder' }
if (-not $found) { "no holder running" }
foreach ($p in $found) { Stop-Process -Id $p.ProcessId -Force; "killed holder " + $p.ProcessId }`
  console.log(execFileSync("powershell.exe", ["-NoProfile", "-EncodedCommand", encode(ps)], { encoding: "utf8" }).trim())
}

// ---------------------------------------------------------------- dispatch

// Last in the file, so every constant above exists before either role runs.
if (argv.includes("--holder")) await holder()
else if (argv.includes("--release")) release()
else await observer()
