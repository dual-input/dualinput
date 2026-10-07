/*
 * p03: can a SimConnect client take its masking priority as the sim starts,
 * ahead of an aircraft's own module, without holding back the pilot's
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
 *   group A  asks for 10,000,000, held open by K:SIM_RATE_INCR, which it
 *            listens to and doesn't mask. After the aircraft loads, the
 *            elevator axis is added to it, maskable.
 *   group B  asks for 10,000,000 listening to the throttle axis, not
 *            maskable, so it hears the throttle and holds nothing back. After
 *            the aircraft loads, a second client event for the same axis is
 *            added to it, maskable.
 *   group C  asks for 10,000,000 with no events in it, to see whether the sim
 *            accepts a priority for an empty group.
 *
 * Group A has an event of its own because a group is made by adding an event
 * to it, which group C checks. B adds a second client event rather than
 * swapping its one from listening to masking, because removing a client event
 * from a group cut the sim event off from the client's other groups too
 * (measured on MSFS 2024, 2026-10-01, the comment on subscribeKeys in
 * experiments/areas/aircraft/lib/sim.mjs). Which of our groups gets 10,000,000
 * itself doesn't matter: a group asking for a taken priority gets the next
 * free one behind it (record/learn/foundations/04-02-events.md), and every
 * group of ours asks before Accu-Sim does.
 *
 * The main menu shows an aircraft and loads it when it's picked, before any
 * flight: the sim sent AircraftLoaded for the PA-24 then (seen on MSFS 2024,
 * 2026-10-07). So the probe starts before the sim does, connects as soon as
 * SimConnect answers, as Crosscheck's core would, and logs every
 * AircraftLoaded after its groups are in.
 *
 *   node experiments/areas/flight-controls/p03-mask-at-start.mjs --launch
 *   node experiments/areas/flight-controls/p03-mask-at-start.mjs --release
 *
 * --launch starts the sim through Steam; without it the probe waits for a sim
 * started some other way. Bind the yoke and throttle in MSFS's controls, then
 * load the A2A PA-24 Comanche parked from the world map. The probe waits for
 * Ready to fly, lets the aircraft settle, and asks for two windows, each
 * started with Page Down, with the sim in front, and ended by the long low
 * beep, with a short beep at each 5s phase:
 *
 *   pitch     keep moving the yoke fore and aft: free, masked by A, cleared
 *   throttle  keep moving the throttle idle to full: listening, masked by B,
 *             cleared
 *
 * A window whose first phase hears no input from the control, or that starts
 * with another window in front, is asked for again.
 *
 * A group is ahead of Accu-Sim when it hears the hardware's events and, once
 * masking, L:ElevatorInput or L:Throttle1Position, which follow the pilot's
 * input (measured, same log entry), stays
 * still. A group behind Accu-Sim hears none of the hardware's events, because
 * Accu-Sim masks them first (same log entry).
 *
 * The holder fails open as p01's masker does: it clears its groups and exits
 * when the observer's keepalive stops for 15s or its stdin closes, and after
 * 30 minutes in any case; killing it releases its masks (measured, same log,
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
const ANCHOR = "SIM_RATE_INCR"
const VARS = { pitch: ["L:ElevatorInput", "number"], throttle: ["L:Throttle1Position", "number"] }
const PA24 = AIRCRAFT["a2a-pa24-comanche"]
const SIM_PROCESS = "FlightSimulator2024"
const STEAM_URL = "steam://rungameid/2537590"
const PHASE_MS = 5_000
const SETTLE_MS = 20_000
const KEEPALIVE_MS = 5_000
const DEADMAN_MS = 15_000
const CAP_MS = 30 * 60_000
const CONNECT_RETRY_MS = 1_000
const CONNECT_CAP_MS = 10 * 60_000
// Accu-Sim's own K:AXIS_ELEVATOR_SET stayed within ±5,349, and the hardware's
// reached ±16,380 (same log entry), so a value past this is the pilot's.
const HARDWARE_ABOVE = 6_000

// node-simconnect throws when no sim answers, so a client that starts before
// the sim tries again until one does.
async function connectWhenUp(rec, name) {
  const t0 = Date.now()
  for (;;) {
    try {
      return await Sim.connect(rec, { name })
    } catch (e) {
      if (Date.now() - t0 > CONNECT_CAP_MS) throw e
      await sleep(CONNECT_RETRY_MS)
    }
  }
}

// ---------------------------------------------------------------- the holder

/*
 * The process that holds the three groups. It talks to the observer by JSON
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
    sim = await connectWhenUp(rec, "CROSSCHECK p03 holder")
  } catch (e) {
    emit({ kind: "error", text: e.message })
    process.exit(1)
  }

  const groups = { A: sim.ids.group++, B: sim.ids.group++, C: sim.ids.group++ }
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
  // The event first, then the priority, as subscribeKeys orders them.
  const open = (label, name) => {
    const id = map(name)
    sim.send(`add K:${name} (${id}) to group ${label}, not maskable`, () => sim.handle.addClientEventToNotificationGroup(groups[label], id, false))
    sim.send(`group ${label} (${groups[label]}) priority ${MASK_PRIORITY}`, () => sim.handle.setNotificationGroupPriority(groups[label], MASK_PRIORITY))
    listen(label, name, id)
  }
  open("A", ANCHOR)
  open("B", THROTTLE)
  sim.send(`group C (${groups.C}) priority ${MASK_PRIORITY}, no events`, () => sim.handle.setNotificationGroupPriority(groups.C, MASK_PRIORITY))

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
  const mask = (label, name) => {
    const id = map(name)
    sim.send(`add K:${name} (${id}) to group ${label}, maskable`, () => sim.handle.addClientEventToNotificationGroup(groups[label], id, true))
    listen(label, name, id)
    emit({ kind: "masking", text: `group ${label} masks K:${name}`, group: label })
  }

  createInterface({ input: process.stdin }).on("line", (l) => {
    if (l === "ALIVE") lastAlive = Date.now()
    if (l === "MASK_A") mask("A", PITCH)
    if (l === "MASK_B") mask("B", THROTTLE)
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
  emit({ kind: "ready", text: `groups in: A held open by K:${ANCHOR}, B listening to K:${THROTTLE}, C empty, each asking for ${MASK_PRIORITY}` })
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
  const launched = argv.includes("--launch")
  if (launched) {
    spawn("cmd.exe", ["/c", "start", "", STEAM_URL], { stdio: "ignore", detached: true }).unref()
    console.log(`Asked Steam to start the sim (${STEAM_URL}). Waiting for SimConnect…`)
  } else {
    console.log("Waiting for SimConnect…")
  }

  // The holder starts first, so its groups go in before anything else of ours
  // connects.
  const holderOut = []
  let win = null
  const child = spawn(process.execPath, [SELF, "--holder"], { stdio: ["pipe", "pipe", "inherit"] })
  const write = (l) => { try { child.stdin.write(l + "\n") } catch { /* exited */ } }
  const alive = setInterval(() => write("ALIVE"), KEEPALIVE_MS)
  const exited = new Promise((r) => child.on("exit", (code, signal) => {
    clearInterval(alive)
    rec.log("holder", `exited (${signal ?? `code ${code}`})`)
    r()
  }))
  let readyAt = null
  const ready = new Promise((resolve, reject) => {
    createInterface({ input: child.stdout }).on("line", (l) => {
      let o
      try { o = JSON.parse(l) } catch { return rec.log("holder", l) }
      holderOut.push({ t: Date.now(), ...o })
      if (o.kind === "ready") { readyAt = Date.now(); resolve() }
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
    console.log(`The holder didn't start: ${e.message}`)
    process.exit(1)
  }

  const sim = await connectWhenUp(rec, "CROSSCHECK p03 observer")
  rec.open()
  const keys = await startKeys()
  const beep = startBeeper()

  // Every aircraft the sim loads after our groups are in, the menu's included.
  const loads = []
  sim.systemHandlers.add((name, data) => {
    if (name === "AircraftLoaded") loads.push({ t: Date.now(), file: data })
  })
  // At the main menu, TITLE names the aircraft the menu shows, with no flight
  // loaded (seen on MSFS 2024, 2026-10-07).
  const titleAtStart = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
  rec.log("start", `TITLE when the observer connected ${JSON.stringify(titleAtStart)}, ${Math.round((Date.now() - readyAt) / 1000)}s after the holder's groups went in`, { title: titleAtStart })

  // ------------------------------------------------ the load

  console.log(`\n▶ Bind the yoke and throttle in MSFS's controls if they aren't, then load the ${PA24.name} parked, from the world map.\n  The probe waits for Ready to fly.`)
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
      if (win && name === VARS[win.control][0]) add(win.value, v)
    },
  })
  await sleep(1000)

  // ------------------------------------------------ the windows

  const results = []
  async function phase(control, name, group) {
    win = { control, name, heard: { pitch: stats(), throttle: stats() }, holder: { A: stats(), B: stats() }, value: stats() }
    const v0 = latest[VARS[control][0]]
    if (typeof v0 === "number") add(win.value, v0)
    beep(1000, 100)
    await sleep(PHASE_MS)
    const w = win
    win = null
    const r = { control, phase: name, group, heard: w.heard[control], holder: w.holder[group], value: w.value }
    rec.log("phase", `${control} ${name}: ${line(r)}`, { control, phase: name, group, heard: r.heard, holder: r.holder, value: r.value })
    return r
  }
  const line = (r) => [
    `${VARS[r.control][0]} ${range(r.value)}`,
    `the hardware's events heard at the highest priority ×${r.heard.n} (${r.heard.hardware} past ±${HARDWARE_ABOVE})`,
    `group ${r.group} heard ×${r.holder.n} (${r.holder.hardware} past ±${HARDWARE_ABOVE}) ${range(r.holder)}`,
  ].join(" · ")

  async function ask(heading, instruction) {
    for (;;) {
      console.log(`\n▶ ${heading}\n  ${instruction}\n  ${START} to start, with the sim in front; ${SKIP} to skip.`)
      beep(800, 150)
      const k = await keys.next()
      rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
      if (k.key !== "START") return false
      if (k.foreground === SIM_PROCESS) return true
      console.log(`  ${k.foreground} was in front, not the sim. Click into the sim, then press ${START} again.`)
    }
  }

  // The first phase repeats until it hears the control, so a control that
  // isn't bound, or a sim that isn't taking input, can't pass as a result.
  async function controlWindow(control, heading, instruction, first, masked, maskCmd, clearCmd, group) {
    for (;;) {
      if (!await ask(heading, instruction)) return rec.log("skip", control)
      const free = await phase(control, first, group)
      if (free.heard.hardware === 0) {
        beep(300, 400)
        console.log("  No input from that control reached the sim. Is it bound in MSFS's controls? Asking again.")
        continue
      }
      write(maskCmd)
      await sleep(300)
      const m = await phase(control, masked, group)
      write(clearCmd)
      await sleep(300)
      const c = await phase(control, "cleared", group)
      beep(500, 600)
      console.log("  Stop.")
      results.push(free, m, c)
      return
    }
  }

  await controlWindow("pitch", "Pitch: the yoke fore and aft",
    "Keep moving it through its full travel, back and forth, from Page Down until the long low beep, about 15s. Don't stop at the short beeps.",
    "free, group A not masking", "masked by group A", "MASK_A", "CLEAR_A", "A")
  await controlWindow("throttle", "Throttle: engine 1's lever",
    "Keep moving it from idle to full and back, from Page Down until the long low beep, about 15s. Don't stop at the short beeps.",
    "listening, group B not masking", "masked by group B", "MASK_B", "CLEAR_B", "B")

  write("QUIT")
  await Promise.race([exited, sleep(3000)])
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")

  // ------------------------------------------------ the report

  const verdicts = []
  for (const [control, label] of [["pitch", "A"], ["throttle", "B"]]) {
    const base = results.find((r) => r.control === control && r.phase !== "cleared" && !r.phase.startsWith("masked"))
    const masked = results.find((r) => r.control === control && r.phase.startsWith("masked"))
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
    "p03 · Masking priority taken as the sim starts, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    `${launched ? "Started the sim through Steam" : "Waited for a sim started elsewhere"}; the holder's groups went in, then the observer connected with TITLE ${JSON.stringify(titleAtStart)}`,
    `Aircraft loaded after the groups went in: ${loads.map((l) => `${Math.round((l.t - readyAt) / 1000)}s ${l.file}`).join("; ") || "none seen"}`,
    `TITLE after Ready to fly ${JSON.stringify(title)}`,
    `Groups asking for ${MASK_PRIORITY}: A held open by K:${ANCHOR}, B listening to K:${THROTTLE}, C empty; ${PHASE_MS / 1000}s phases`,
    "",
    ...results.map((r) => `${r.control} ${r.phase}: ${line(r)}`),
    "",
    ...verdicts,
    "",
    `Exceptions: ${exceptions.join("; ") || "none"}`,
  ]
  const report = lines.join("\n")
  console.log("\n" + report)
  rec.writeReport(report)
  sim.close()
  await rec.close()
  process.exit(0)
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
