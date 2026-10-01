/*
 * p01: whether Crosscheck can keep a pilot's own flight controls out of the
 * sim, by masking the K: events their hardware fires, on MSFS 2024.
 *
 * An aircraft that runs its own flight controls, such as A2A's Accu-Sim
 * aircraft, the Synaptic A220, the iniBuilds A350, or the PMDG 777, may mask
 * the pilot's axis events through SimConnect itself (unverified; the masked

 * phase shows it). A forum thread says masking
 * "never has worked properly in MSFS" (record/learn/foundations/04-02-events.md).
 * Nobody in our records has measured it.
 *
 * A guided session, one aircraft per run, with someone at the controls. Each
 * step waits for Page Down, read globally so the sim can stay in front, and End
 * skips the step. A high beep opens a capture window and a low beep closes it.
 *
 *   1  Discover  No masking: which K: events and input events each control
 *                fires, and which values move. Yaw is moved slowly, so a dead
 *                zone set in MSFS shows whether an event carries the value
 *                after MSFS's own sensitivity and dead zone.
 *   2  Mask      A second process, the masker, masks the K: events step 1
 *                heard, at 10,000,000. Does each control stay still, and does
 *                the masker hear the events? It hears them only if no module
 *                masked them first. Then the masker clears its group, and pitch
 *                is checked free.
 *   3  Re-send   The masker sends each axis value back at half, at 10,000,001,
 *                just after its own group. Does the control follow at half? On
 *                an aircraft whose module reads its own input variable, such as
 *                Accu-Sim's L:ElevatorInput, it also tries writing that.
 *   4  Kill      A new masker is killed outright. Is pitch free again?
 *   5  Reload    Masks set before the aircraft reloads, to see whether the
 *                order of registration decides a tie at 10,000,000.
 *
 * The masker fails open:
 *   - it clears its group and exits when the observer's keepalive stops for
 *     15s or its stdin closes, and after 10 minutes in any case (30 for the
 *     reload step);
 *   - killing it closes its SimConnect connection, which step 4 checks
 *     releases the mask;
 *   - `node experiments/areas/flight-controls/p01-mask.mjs --release` kills
 *     every masker this probe started, from any terminal.
 *
 *   node experiments/areas/flight-controls/p01-mask.mjs [--aircraft <study folder>] [--only 1,2,3]
 *
 * <study folder> is a folder under record/areas/aircraft/, such as
 * a2a-pa24-comanche. Without it the probe matches the loaded aircraft's TITLE,
 * and with no match it watches the stock variables alone. Steps 2 to 5 mask
 * what step 1 heard in the same run, so --only without 1 masks nothing.
 *
 * Output: one line per step on the console, every event in
 * experiments/areas/flight-controls/results/p01-mask-<time>.ndjson, and the
 * report in the .txt beside it.
 */

import { execFileSync, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { AIRCRAFT } from "../aircraft/lib/aircraft.mjs"
import { Recorder, fmt, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, PRIORITY, Sim } from "../aircraft/lib/sim.mjs"

const SELF = fileURLToPath(import.meta.url)
const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] ?? null }

const MASK_PRIORITY = PRIORITY.highest_maskable
const RESEND_PRIORITY = MASK_PRIORITY + 1
const KEEPALIVE_MS = 5_000
const DEADMAN_MS = 15_000
const CAP_MS = 10 * 60_000
const RELOAD_CAP_MS = 30 * 60_000
const SCALE = 0.5

// Every name is in MSFS 2024 SDK 1.7.3, WASM/include/MSFS/Types/MSFS_EventsEnum.h.
const CANDIDATES = [
  "AXIS_ELEVATOR_SET", "AXIS_AILERONS_SET", "AXIS_RUDDER_SET",
  "ELEVATOR_SET", "AILERON_SET", "RUDDER_SET",
  "AXIS_ELEV_TRIM_SET", "ELEV_TRIM_UP", "ELEV_TRIM_DN", "ELEVATOR_TRIM_SET",
  "AXIS_THROTTLE_SET", "AXIS_THROTTLE1_SET", "AXIS_THROTTLE2_SET",
  "THROTTLE_AXIS_SET_EX1", "THROTTLE1_AXIS_SET_EX1", "THROTTLE2_AXIS_SET_EX1",
  "THROTTLE_SET", "THROTTLE1_SET", "THROTTLE2_SET",
  "THROTTLE_FULL", "THROTTLE_CUT", "THROTTLE_INCR", "THROTTLE_DECR",
  "AXIS_MIXTURE_SET", "AXIS_MIXTURE1_SET", "AXIS_PROPELLER_SET", "AXIS_PROPELLER1_SET",
  "AXIS_FLAPS_SET", "FLAPS_INCR", "FLAPS_DECR", "FLAPS_UP", "FLAPS_DOWN", "FLAPS_SET",
  "AXIS_SPOILER_SET", "SPOILERS_SET",
  "AXIS_LEFT_BRAKE_SET", "AXIS_RIGHT_BRAKE_SET", "BRAKES",
  "GEAR_UP", "GEAR_DOWN", "GEAR_TOGGLE", "GEAR_SET",
  "AXIS_STEERING_SET",
]

// Events an aircraft's own module may send to move the sim's surfaces and
// such as the A220's K:AILERON_SET (record/areas/aircraft/synaptic-a220/study.md,
// Flight controls and autoflight). Masking one would cut the module's output,
// so the probe listens for them and never masks them.
const OUTPUTS = new Set([
  "ELEVATOR_SET", "AILERON_SET", "RUDDER_SET", "ELEVATOR_TRIM_SET",
  "THROTTLE_SET", "THROTTLE1_SET", "THROTTLE2_SET", "FLAPS_SET", "SPOILERS_SET", "GEAR_SET",
])

const isAxis = (name) => name.includes("AXIS")

// Units as the sim's own behaviors read these variables (MSFS 2024 SDK 1.7.3,
// ModelBehaviorDefs/Asobo/Common/Handling.xml and Subtemplates/).
const CONTROLS = {
  pitch: {
    label: "Pitch: yoke or stick fore and aft",
    how: "through its full travel, back and forth, for the whole window",
    seconds: 6,
    stock: [["YOKE Y POSITION", "percent"], ["ELEVATOR POSITION", "percent"]],
  },
  roll: {
    label: "Roll: yoke or stick left and right",
    how: "through its full travel, back and forth, for the whole window",
    seconds: 6,
    stock: [["YOKE X POSITION", "percent"], ["AILERON POSITION", "percent"]],
  },
  yaw: {
    label: "Yaw: rudder pedals or twist",
    how: "slowly, from center to full right over 4s, then back to center",
    seconds: 8,
    stock: [["RUDDER PEDAL POSITION", "percent"], ["RUDDER POSITION", "percent"]],
  },
  throttle: {
    label: "Throttle: engine 1's lever",
    how: "from idle to full and back, twice",
    seconds: 6,
    stock: [["GENERAL ENG THROTTLE LEVER POSITION:1", "percent"]],
  },
  flaps: {
    label: "Flaps: your lever or buttons",
    how: "one notch down, then back up, twice",
    seconds: 8,
    stock: [["FLAPS HANDLE INDEX", "number"]],
  },
  trim: {
    label: "Elevator trim: your wheel or buttons",
    how: "a few steps nose up, then back down",
    seconds: 8,
    stock: [["ELEVATOR TRIM PCT", "percent"]],
  },
}

// Each aircraft's own variables for the pilot's input, unverified for an
// aircraft no run has watched. They come first when the
// probe judges whether a control moved, because a module's input can move
// while the stock values don't. `write` names the input variable step 3 tries
// writing directly.
const LOCAL = {
  "a2a-pa24-comanche": {
    pitch: ["L:ElevatorInput"], roll: ["L:AileronInput"], yaw: ["L:RudderInput"],
    throttle: ["L:Throttle1Position"], flaps: ["L:LandFlapsPos"],
    write: { pitch: "L:ElevatorInput" },
  },
  "a2a-aerostar-600": {
    pitch: ["L:ElevatorInput"], roll: ["L:AileronInput"], yaw: ["L:RudderInput"],
    throttle: ["L:Eng1_ThrottlePosition"],
    write: { pitch: "L:ElevatorInput" },
  },
  "synaptic-a220": {
    pitch: ["L:A22X L Sidestick Y"], roll: ["L:A22X L Sidestick X"], yaw: ["L:A22X Rudder Pedals"],
    throttle: ["L:A22X Throttle L Raw", "L:A22X Throttle 1 TLA"],
  },
  "pmdg-777-300er": { pitch: ["L:yokes_Fore_Aft"], roll: ["L:yokes_L_R"] },
  "fenix-a320-family": { pitch: ["L:N_FC_SIDESTICK_CAPT_PITCH"] },
}

// Black Square's control lock clamps the elevator and ailerons to ±1% while
// it's in (record/areas/aircraft/black-square-baron-pro/study.md, Flight
// controls and autoflight).
const CONTROL_LOCKS = {
  "black-square-baron-pro": "L:bksq_controlLocks",
  "black-square-bonanza-pro": "L:bksq_controlLocks",
}

const INPUT_EVENT_NAMES = /THROTTLE|FLAP|TRIM|ELEV|AILERON|RUDDER|YOKE|STICK|SPOILER|BRAKE|GEAR|LEVER|PITCH|ROLL/i

// ---------------------------------------------------------------- keys and beeps

const encode = (ps) => Buffer.from(ps, "utf16le").toString("base64")
const powershell = (ps, stdio) =>
  spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encode(ps)], { stdio })

// Page Down and End, read globally, as our FS Copilot fork's guided WASM probe
// did (FS Copilot fork, record/wasm-pointer/probes/p01-wasm-away.mjs).
// GetAsyncKeyState doesn't consume the key, so the sim sees it too.
const KEYS_PS = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class CrosscheckKeys {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
[Console]::Out.WriteLine("READY")
$keys = @{ 0x22 = "PGDN"; 0x23 = "END" }
$was = @{ 0x22 = $false; 0x23 = $false }
while ($true) {
  foreach ($k in @(0x22, 0x23)) {
    $now = ([CrosscheckKeys]::GetAsyncKeyState($k) -band 0x8000) -ne 0
    if ($now -and -not $was[$k]) {
      $procId = 0
      [void][CrosscheckKeys]::GetWindowThreadProcessId([CrosscheckKeys]::GetForegroundWindow(), [ref]$procId)
      $name = "?"
      try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
      [Console]::Out.WriteLine("KEY " + $keys[$k] + " " + $name)
    }
    $was[$k] = $now
  }
  Start-Sleep -Milliseconds 20
}`

const BEEP_PS = `
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Split(" ")
  [Console]::Beep([int]$p[0], [int]$p[1])
}`

function startKeys() {
  const ps = powershell(KEYS_PS, ["ignore", "pipe", "ignore"])
  process.on("exit", () => { try { ps.kill() } catch { /* gone */ } })
  let waiter = null
  const out = createInterface({ input: ps.stdout })
  return new Promise((ready, fail) => {
    ps.on("error", fail)
    out.on("line", (l) => {
      if (l === "READY") return ready({ next: () => new Promise((r) => { waiter = r }) })
      const [, key, ...fg] = l.split(" ")
      // A press while nobody waits is dropped, so a stray key can't start a step.
      if (waiter) { const w = waiter; waiter = null; w({ key, foreground: fg.join(" ") }) }
    })
  })
}

function startBeeper() {
  const ps = powershell(BEEP_PS, ["pipe", "ignore", "ignore"])
  process.on("exit", () => { try { ps.kill() } catch { /* gone */ } })
  return (hz, ms) => { try { ps.stdin.write(`${hz} ${ms}\n`) } catch { /* no sound is no failure */ } }
}

// ---------------------------------------------------------------- statistics

function track(map, name, v) {
  let s = map.get(name)
  if (!s) map.set(name, s = { n: 0, min: v, max: v, first: v, last: v, minAbs: Infinity })
  s.n++
  if (typeof v !== "number") { s.last = v; return }
  s.min = Math.min(s.min, v)
  s.max = Math.max(s.max, v)
  s.last = v
  if (v !== 0) s.minAbs = Math.min(s.minAbs, Math.abs(v))
}

const span = (s) => (s && typeof s.min === "number" ? s.max - s.min : 0)
const rangeText = (s) => (typeof s.min === "number" ? (s.min === s.max ? fmt(s.min) : `${fmt(s.min)}..${fmt(s.max)}`) : fmt(s.last))

// Least squares for y = a·x + b over [x, y] pairs, with r².
function fit(pairs) {
  const n = pairs.length
  if (n < 10) return null
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n
  const my = pairs.reduce((s, [, y]) => s + y, 0) / n
  let sxx = 0, sxy = 0, syy = 0
  for (const [x, y] of pairs) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2 }
  if (sxx === 0 || syy === 0) return null
  const a = sxy / sxx
  return { a, b: my - a * mx, r2: (sxy * sxy) / (sxx * syy), n }
}

// ---------------------------------------------------------------- the masker

/*
 * The process that masks. It talks to the observer by JSON lines on stdout,
 * and takes ALIVE and CLEAR on stdin.
 *
 *   cfg = { events, priority, resend: null | "event" | "lvar", scale,
 *           resendPriority, write: { <event>: { lvar, a, b } }, capMs }
 */
async function masker(cfg) {
  const emit = (o) => { try { process.stdout.write(JSON.stringify(o) + "\n") } catch { /* observer gone */ } }
  // A write or send per hardware event would bury the observer's console.
  const bulk = new Set(["write", "send"])
  const rec = {
    log: (kind, text, fields = {}) => emit({ kind, text, ...(bulk.has(kind) ? { quiet: true } : {}), ...fields }),
    data: (kind, text, fields = {}) => emit({ kind, text, quiet: true, ...fields }),
  }
  let sim
  try {
    sim = await Sim.connect(rec, { name: "CROSSCHECK p01-mask masker" })
  } catch (e) {
    emit({ kind: "error", text: e.message })
    process.exit(1)
  }

  const t0 = Date.now()
  let lastAlive = Date.now()
  let done = false
  const group = sim.ids.group

  const clear = (why) => {
    if (done) return
    done = true
    if (!sim.gone) sim.send(`clear group ${group}`, () => sim.handle.clearNotificationGroup(group))
    emit({ kind: "cleared", text: `cleared the mask group: ${why}`, why })
    setTimeout(() => { sim.close(); process.exit(0) }, 300)
  }

  // Mapped before the group, so the group's own IDs are the newest for each
  // event; arrivals are routed by name either way (lib/sim.mjs, subscribeKeys).
  if (cfg.resend === "event") for (const name of cfg.events.filter(isAxis)) sim.event(name)

  sim.subscribeKeys(cfg.events, {
    priority: cfg.priority,
    maskable: true,
    quiet: true,
    onEvent: (e) => {
      emit({ kind: "got", text: `${e.name} ${e.value}`, name: e.name, value: e.value, ours: e.ours })
      if (e.ours || done) return
      if (cfg.resend === "event" && isAxis(e.name)) {
        sim.transmit(e.name, [Math.round(e.value * cfg.scale)], { priority: cfg.resendPriority, quiet: true })
      }
      const w = cfg.resend === "lvar" ? cfg.write?.[e.name] : null
      if (w) sim.write(w.lvar, "number", w.a * e.value * cfg.scale + w.b)
    },
  })

  sim.onLost((why) => { emit({ kind: "lost", text: why }); process.exit(0) })
  const lines = createInterface({ input: process.stdin })
  lines.on("line", (l) => {
    if (l === "ALIVE") lastAlive = Date.now()
    if (l === "CLEAR") clear("the observer asked")
  })
  lines.on("close", () => clear("the observer's pipe closed"))
  setInterval(() => {
    if (Date.now() - lastAlive > DEADMAN_MS) clear(`no keepalive for ${DEADMAN_MS / 1000}s`)
    if (Date.now() - t0 > cfg.capMs) clear(`the ${cfg.capMs / 60_000}-minute cap`)
  }, 1000)

  await sleep(500)
  emit({
    kind: "ready",
    text: `masking ${plural(cfg.events.length, "event")} at priority ${cfg.priority}${cfg.resend ? `, re-sending by ${cfg.resend} at ${cfg.scale}` : ""}`,
    events: cfg.events,
  })
}

// The observer's handle on one masker process.
class Masker {
  constructor(rec, cfg, onGot) {
    this.rec = rec
    this.exited = new Promise((r) => { this.onExit = r })
    this.ready = new Promise((r, f) => { this.onReady = r; this.onFail = f })
    const b64 = Buffer.from(JSON.stringify(cfg)).toString("base64")
    this.child = spawn(process.execPath, [SELF, "--masker", b64], { stdio: ["pipe", "pipe", "inherit"] })
    this.child.on("exit", (code, signal) => {
      clearInterval(this.alive)
      rec.log("masker", `exited (${signal ?? `code ${code}`})`, { code, signal })
      this.onFail(new Error("the masker exited before it was ready"))
      this.onExit()
    })
    createInterface({ input: this.child.stdout }).on("line", (l) => {
      let o
      try { o = JSON.parse(l) } catch { return rec.log("masker", l) }
      if (o.kind === "got") onGot(o)
      if (o.kind === "ready") this.onReady(o)
      if (o.kind === "error") this.onFail(new Error(o.text))
      const { kind, text, quiet, ...fields } = o
      if (kind === "key") return // the masker's own copy of each "got"
      if (quiet) rec.data(`masker ${kind}`, text ?? "", fields)
      else rec.log("masker", `${kind}: ${text ?? ""}`, { maskerKind: kind, ...fields })
    })
    this.alive = setInterval(() => this.write("ALIVE"), KEEPALIVE_MS)
  }

  write(line) {
    try { this.child.stdin.write(line + "\n") } catch { /* exited */ }
  }

  async clear() {
    this.write("CLEAR")
    await Promise.race([this.exited, sleep(5000)])
    if (this.child.exitCode === null) await this.kill()
  }

  async kill() {
    this.child.kill("SIGKILL")
    await this.exited
  }
}

// ---------------------------------------------------------------- the observer

async function observer() {
  const only = opt("--only") ? new Set(opt("--only").split(",").map(Number)) : null
  const runs = (n) => !only || only.has(n)
  const rec = new Recorder("p01-mask", { area: "flight-controls" })
  const sim = await Sim.connect(rec, { name: "CROSSCHECK p01-mask observer" })
  rec.open()
  const keys = await startKeys()
  const beep = startBeeper()

  const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
  const key = opt("--aircraft") ?? Object.entries(AIRCRAFT).find(([, a]) => a.title === title)?.[0] ?? null
  const local = LOCAL[key] ?? {}
  rec.log("aircraft", `TITLE ${JSON.stringify(title)}, ${key ? `study ${key}` : "no study matched: stock variables only"}`, { title, key })

  const effectVars = (control) => [...(local[control] ?? []).map((n) => [n, "number"]), ...CONTROLS[control].stock]
  const allEffects = Object.keys(CONTROLS).flatMap(effectVars)

  // ------------------------------------------------ watching

  let win = null
  const latest = new Map()
  const lastKey = new Map()
  let effects = null
  let inputs = null
  let inputNames = new Map()

  sim.subscribeKeys(CANDIDATES, {
    priority: "highest",
    maskable: false,
    quiet: true,
    onEvent: (e) => {
      lastKey.set(e.name, e.value)
      if (!win) return
      track(win.heard, e.name, e.value)
      win.keySeries.push([e.t, e.name, e.value])
    },
  })

  async function startWatches() {
    effects?.stop()
    inputs?.stop()
    effects = sim.watch(allEffects, {
      period: "frame",
      label: "effects",
      onChange: (name, v, before, t) => {
        latest.set(name, v)
        if (!win) return
        track(win.effects, name, v)
        win.effectSeries.push([t, name, v])
      },
    })
    const list = await sim.inputEvents()
    const chosen = list.filter((d) => INPUT_EVENT_NAMES.test(d.name)).slice(0, 150)
    inputNames = new Map(chosen.map((d) => [String(d.hash), d.name]))
    rec.log("inputs", `${plural(list.length, "input event")} listed; watching ${chosen.length} whose names match ${INPUT_EVENT_NAMES}`, { listed: list.length, watched: chosen.map((d) => d.name) })
    inputs = chosen.length ? sim.subscribeInputEvents(chosen.map((d) => d.hash), ({ hash, value }) => {
      if (win) track(win.inputs, inputNames.get(hash) ?? hash, value)
    }) : null
  }
  await startWatches()

  const lock = CONTROL_LOCKS[key]
  if (lock) {
    const v = await sim.readOne(lock, "number")
    rec.log("check", `${lock} reads ${v}${v ? ": take the control lock out, or the elevator and ailerons stay within 1%" : ""}`, { lock, value: v })
  }

  // ------------------------------------------------ steps

  const results = []
  let masker = null
  let maskSet = []

  function onGot(o) {
    if (win && !o.ours) track(win.masker, o.name, o.value)
  }

  async function startMasker(cfg) {
    masker = new Masker(rec, { priority: MASK_PRIORITY, resend: null, scale: SCALE, resendPriority: RESEND_PRIORITY, capMs: CAP_MS, ...cfg }, onGot)
    try {
      await masker.ready
      return true
    } catch (e) {
      rec.log("error", `masker didn't start: ${e.message}`)
      return false
    }
  }

  async function stopMasker(how = "clear") {
    if (!masker) return
    const m = masker
    masker = null
    if (how === "kill") await m.kill()
    else await m.clear()
  }

  async function ask(heading, instruction) {
    console.log(`\n▶ ${heading}\n  ${instruction}\n  Page Down to start, End to skip.`)
    const k = await keys.next()
    rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
    return k.key === "PGDN"
  }

  async function capture(step, control, note, { expect = null, seconds = null } = {}) {
    const c = CONTROLS[control]
    const go = await ask(`${step}. ${c.label}${note ? `, ${note}` : ""}`, `Move it ${c.how}, after the high beep, until the low one.`)
    if (!go) {
      rec.log("skip", `${step} ${control}`)
      results.push({ step, control, note, skipped: true })
      return null
    }
    win = {
      step, control, note, t0: Date.now(),
      heard: new Map(), masker: new Map(), inputs: new Map(), effects: new Map(),
      keySeries: [], effectSeries: [],
    }
    for (const [name] of effectVars(control)) if (latest.has(name)) track(win.effects, name, latest.get(name))
    beep(1200, 150)
    await sleep((seconds ?? c.seconds) * 1000)
    const w = win
    win = null
    beep(600, 300)
    const r = { step, control, note, expect, window: w }
    r.verdict = verdict(w, discovered[control])
    results.push(r)
    rec.log("result", `${step} ${control}${note ? ` (${note})` : ""}: ${summary(r)}`, { step, control, note, expect, verdict: r.verdict, heard: Object.fromEntries(w.heard), masker: Object.fromEntries(w.masker) })
    return r
  }

  const discovered = {}

  function verdict(w, base) {
    if (!base) return { word: "baseline" }
    for (const [name] of effectVars(w.control)) {
      const b = span(base.effects.get(name))
      if (b <= 0) continue
      const ratio = span(w.effects.get(name)) / b
      const word = ratio < 0.1 ? "blocked" : ratio > 0.8 ? "moved" : ratio >= 0.35 && ratio <= 0.65 ? "half" : "partly moved"
      return { word, name, ratio }
    }
    return { word: "no baseline: nothing moved in step 1" }
  }

  function summary(r) {
    const w = r.window
    const list = (m) => [...m].map(([n, s]) => `${n} ×${s.n} ${rangeText(s)}`).join(", ") || "none"
    const moved = [...w.effects].filter(([, s]) => s.n > 1 && (span(s) > 0 || typeof s.min !== "number"))
    const v = r.verdict.ratio !== undefined ? `${r.verdict.word} (${r.verdict.name} at ${Math.round(r.verdict.ratio * 100)}% of step 1's range)` : r.verdict.word
    return [
      v,
      `heard ${list(w.heard)}`,
      masker || w.masker.size ? `masker got ${list(w.masker)}` : null,
      `input events ${list(w.inputs)}`,
      `values ${moved.map(([n, s]) => `${n} ${rangeText(s)}`).join(", ") || "none moved"}`,
    ].filter(Boolean).join(" · ")
  }

  const cleanup = async () => { await stopMasker() }
  let stopping = false
  process.on("SIGINT", async () => {
    if (stopping) process.exit(1)
    stopping = true
    rec.log("stop", "Ctrl+C: clearing the masker and writing the report")
    await cleanup()
    await finish()
    process.exit(0)
  })

  console.log([
    "",
    "Before you start:",
    "  - the aircraft on the ground, unpaused, with the parking brake set; engines may be off",
    "  - this console where you can read it, and the sim in front",
    "  - optional: a large dead zone, about 50%, on your rudder axis in MSFS's controls,",
    "    so step 1's slow yaw shows whether events carry MSFS's processed value",
  ].join("\n"))

  // 1 · Discover
  if (runs(1)) {
    for (const control of Object.keys(CONTROLS)) {
      const r = await capture(1, control, null)
      if (r) discovered[control] = r.window
    }
  }

  const heardInputs = [...new Set(Object.values(discovered).flatMap((w) => [...w.heard.keys()]))]
  maskSet = heardInputs.filter((n) => !OUTPUTS.has(n))
  rec.log("plan", maskSet.length ? `steps 2 to 5 mask ${maskSet.join(", ")}` : "step 1 heard no maskable event: nothing to mask", { maskSet })

  // Step 3's direct write: the pitch event against the module's input variable.
  let writeMap = null
  const writeVar = local.write?.pitch
  if (writeVar && discovered.pitch) {
    const w = discovered.pitch
    const pitchEvent = [...w.heard].filter(([n]) => isAxis(n)).sort((a, b) => b[1].n - a[1].n)[0]?.[0]
    if (pitchEvent) {
      const pairs = []
      let last = null
      const merged = [
        ...w.keySeries.filter(([, n]) => n === pitchEvent).map(([t, , v]) => [t, "k", v]),
        ...w.effectSeries.filter(([, n]) => n === writeVar).map(([t, , v]) => [t, "l", v]),
      ].sort((a, b) => a[0] - b[0])
      for (const [, kind, v] of merged) {
        if (kind === "k") last = v
        else if (last !== null) pairs.push([last, v])
      }
      const f = fit(pairs)
      rec.log("fit", f ? `${writeVar} ≈ ${fmt(f.a)} × ${pitchEvent} + ${fmt(f.b)}, r² ${fmt(f.r2)} over ${f.n} pairs` : `no fit of ${writeVar} to ${pitchEvent}`, { writeVar, pitchEvent, fit: f })
      if (f && f.r2 >= 0.9) writeMap = { [pitchEvent]: { lvar: writeVar, a: f.a, b: f.b } }
    }
  }

  if (maskSet.length) {
    // 2 · Mask, then release
    if (runs(2) && await startMasker({ events: maskSet })) {
      for (const control of Object.keys(CONTROLS)) await capture(2, control, "masked", { expect: "blocked" })
      await stopMasker()
      await capture(2, "pitch", "after the masker cleared its group", { expect: "moved" })
    }

    // 3 · Re-send
    if (runs(3)) {
      if (await startMasker({ events: maskSet, resend: "event" })) {
        await capture(3, "pitch", `masked, re-sent at ${SCALE} at ${RESEND_PRIORITY}`, { expect: "half" })
        await capture(3, "throttle", `masked, re-sent at ${SCALE} at ${RESEND_PRIORITY}`, { expect: "half" })
        await stopMasker()
      }
      if (writeMap && await startMasker({ events: maskSet, resend: "lvar", write: writeMap })) {
        await capture(3, "pitch", `masked, ${writeVar} written at ${SCALE}`, { expect: "half" })
        await stopMasker()
      }
    }

    // 4 · Kill
    if (runs(4) && await startMasker({ events: maskSet })) {
      await capture(4, "pitch", "masked, before the kill", { expect: "blocked", seconds: 4 })
      await stopMasker("kill")
      rec.log("kill", "the masker was killed")
      await capture(4, "pitch", "after the masker was killed", { expect: "moved", seconds: 4 })
    }

    // 5 · Reload with the masks in place
    if (runs(5)) {
      const go = await ask("5. Reload the aircraft with the masks in place",
        "Page Down to install the masks. Then reload this aircraft however you like, and press Page Down again once you're back in the cockpit.")
      if (go && await startMasker({ events: maskSet, capMs: RELOAD_CAP_MS })) {
        console.log("  Masks in place. Reload now, then Page Down once you're in the cockpit.")
        const k = await keys.next()
        rec.log("key", `${k.key}, with ${k.foreground} in front: back in the cockpit`, k)
        await startWatches()
        if (masker) {
          await capture(5, "pitch", "masked before the reload", { expect: "blocked" })
          await capture(5, "throttle", "masked before the reload", { expect: "blocked" })
          await stopMasker()
          await capture(5, "pitch", "after the masker cleared its group", { expect: "moved" })
        } else {
          rec.log("result", "5: the masker didn't survive the reload")
        }
      }
    }
  }

  await finish()
  process.exit(0)

  async function finish() {
    await stopMasker()
    const lines = [
      "p01 · Masking a pilot's own flight-control input on MSFS 2024",
      `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
      `Aircraft: TITLE ${JSON.stringify(title)}, ${key ? `study ${key}` : "no study matched: stock variables only"}`,
      `Mask priority ${MASK_PRIORITY}, re-send priority ${RESEND_PRIORITY}`,
      "",
    ]
    for (const step of [1, 2, 3, 4, 5]) {
      const rs = results.filter((r) => r.step === step)
      if (!rs.length) continue
      lines.push(`${step} ${["", "Discover", "Mask", "Re-send", "Kill", "Reload"][step]}`)
      for (const r of rs) {
        const head = `${r.control}${r.note ? ` (${r.note})` : ""}`
        if (r.skipped) { lines.push(`  ${head}: skipped`); continue }
        const ok = r.expect ? (r.verdict.word === r.expect ? "as expected" : `expected ${r.expect}`) : null
        lines.push(`  ${head}: ${summary(r)}${ok ? ` · ${ok}` : ""}`)
      }
      if (step === 1) {
        const yaw = discovered.yaw
        const ax = yaw ? [...yaw.heard].filter(([n]) => isAxis(n)) : []
        for (const [n, s] of ax) {
          lines.push(`  yaw's smallest nonzero |value| on ${n}: ${s.minAbs === Infinity ? "none" : `${s.minAbs} of 16383`}; with a dead zone set in MSFS, a large smallest value means the event carries MSFS's processed value`)
        }
        lines.push(`  masked in steps 2 to 5: ${maskSet.join(", ") || "nothing"}`)
      }
      lines.push("")
    }
    const exceptions = rec.timeline.filter((e) => e.kind === "exception" || (e.kind === "masker" && e.maskerKind === "exception")).map((e) => e.text)
    lines.push(`Exceptions: ${exceptions.join("; ") || "none"}`)
    const report = lines.join("\n")
    console.log("\n" + report)
    rec.writeReport(report)
    sim.close()
    await rec.close()
  }
}

// ---------------------------------------------------------------- release

function release() {
  const ps = `
$ProgressPreference = "SilentlyContinue"
$found = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'p01-mask\\.mjs.*--masker' }
if (-not $found) { "no masker running" }
foreach ($p in $found) { Stop-Process -Id $p.ProcessId -Force; "killed masker " + $p.ProcessId }`
  console.log(execFileSync("powershell.exe", ["-NoProfile", "-EncodedCommand", encode(ps)], { encoding: "utf8" }).trim())
}

// ---------------------------------------------------------------- dispatch

// Last in the file, so every constant above exists before either role runs.
if (argv.includes("--masker")) await masker(JSON.parse(Buffer.from(opt("--masker"), "base64").toString()))
else if (argv.includes("--release")) release()
else await observer()
