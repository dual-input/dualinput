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
 * One aircraft per run, with someone at the controls. For pitch, then
 * throttle, you press Page Down once (read globally, so the sim stays in front)
 * and keep moving that control until the long low beep, about a minute for
 * pitch and 30s for throttle. The probe steps
 * through the phases by itself, 5s each, with a short beep at each:
 *
 *   free     Nothing masked: which K: events and input events the control
 *            fires, and which values move.
 *   masked   A second process, the masker, masks the K: events the free phase
 *            heard, at 10,000,000. Does the control stay still? Does the masker
 *            hear the events? It hears them only if no aircraft module masked
 *            them first.
 *   cleared  The masker cleared its group and exited. Does the control move
 *            again?
 *   half     Pitch only: a new masker masks, and sends each axis value back at
 *            half, at each priority in RESEND_SWEEP in turn, 5s each. Does the
 *            control follow at half, and does the masker's own group hear the
 *            re-send?
 *   written  Pitch only, on an aircraft with an input variable of its own,
 *            such as Accu-Sim's L:ElevatorInput: the masker writes that
 *            variable at half instead.
 *   killed   The last masker is killed outright. Does the control move again?
 *
 * With --reload, the masks then go in before you reload the aircraft, to see
 * whether the order of registration decides a tie at 10,000,000.
 *
 * With --masks-first <study folder>, start with another aircraft loaded, such
 * as the stock Cessna 152. The probe installs the masks, loads the study
 * aircraft's parked flight through SimConnect, and asks for one window of yoke
 * and throttle together: masked, then cleared. It answers the same question as
 * --reload without loading the same aircraft twice in a row, which crashed the
 * sim once (record/areas/aircraft/log.md, 2026-10-01).
 *
 * The masker fails open:
 *   - it clears its group and exits when the observer's keepalive stops for
 *     15s or its stdin closes, and after 10 minutes in any case (30 for the
 *     reload);
 *   - killing it closes its SimConnect connection, which the killed phase
 *     checks releases the mask;
 *   - `node experiments/areas/flight-controls/p01-mask.mjs --release` kills
 *     every masker this probe started, from any terminal.
 *
 * With --legacy, pitch only: the masker sends values back with
 * SimConnect_TransmitClientEvent rather than its _EX1 form, because the PMDG
 * 777's yoke ignored _EX1 sends at every priority (record/areas/flight-controls/
 * log.md, 2026-10-01). Its sweep leaves out 10,000,001, which our own group hears,
 * and a legacy send carries no tag to recognize it by.
 *
 * With --deadzone, set a dead zone of about 50% on the pitch axis in MSFS's
 * controls first. The probe asks you to hold the yoke at about a quarter of its
 * travel. Events near ±4,000 mean they carry the raw axis; events near 0, or
 * none, mean they carry the value after MSFS's dead zone.
 *
 *   node experiments/areas/flight-controls/p01-mask.mjs [--aircraft <study folder>] [--reload] [--legacy]
 *   node experiments/areas/flight-controls/p01-mask.mjs --masks-first <study folder>
 *   node experiments/areas/flight-controls/p01-mask.mjs --deadzone
 *
 * <study folder> is a folder under record/areas/aircraft/, such as
 * a2a-pa24-comanche. Without it the probe matches the loaded aircraft's TITLE,
 * and with no match it watches the stock variables alone.
 *
 * Output: one line per phase on the console, every event in
 * experiments/areas/flight-controls/results/p01-mask-<time>.ndjson, and the
 * report in the .txt beside it.
 */

import { execFileSync, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { EventFlag, SimConnectConstants } from "node-simconnect"

import { AIRCRAFT, NEUTRAL } from "../aircraft/lib/aircraft.mjs"
import { readFlight } from "../aircraft/lib/flights.mjs"
import { loadFlight, settle } from "../aircraft/lib/load.mjs"
import { flightFile } from "../aircraft/lib/make.mjs"
import { Recorder, fmt, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, PRIORITY, Sim } from "../aircraft/lib/sim.mjs"

const SELF = fileURLToPath(import.meta.url)
const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] ?? null }

const MASK_PRIORITY = PRIORITY.highest_maskable
// Where the masker sends a value back. Our first full run sent at 10,000,001,
// and the masker's own group, asked for at 10,000,000, heard every re-send and
// masked it (measured on MSFS 2024, 2026-10-01, experiments/areas/
// flight-controls/results/p01-mask-2026-10-01-20-39-35.ndjson). That fits the
// SDK placing a group that asks for a taken priority at the next lower free one
// (record/learn/foundations/04-02-events.md, Traps), if another client held
// 10,000,000. The sweep finds where a re-send gets past our group: just behind
// it, 10,001,000, where the PMDG 777's own groups may start (unverified), further down,
// SIMCONNECT_GROUP_PRIORITY_STANDARD, and the sim's own turn,
// SIMCONNECT_GROUP_PRIORITY_DEFAULT.
const RESEND_SWEEP = [MASK_PRIORITY + 1, 10_001_000, 100_000_000, PRIORITY.standard, PRIORITY.default]
const PHASE_MS = 5_000
const KEEPALIVE_MS = 5_000
const DEADMAN_MS = 15_000
const CAP_MS = 10 * 60_000
const RELOAD_CAP_MS = 30 * 60_000
const SCALE = 0.5

// Every name is in MSFS 2024 SDK 1.7.3, WASM/include/MSFS/Types/MSFS_EventsEnum.h.
const CANDIDATES = [
  "AXIS_ELEVATOR_SET", "ELEVATOR_SET",
  "AXIS_THROTTLE_SET", "AXIS_THROTTLE1_SET", "AXIS_THROTTLE2_SET",
  "THROTTLE_AXIS_SET_EX1", "THROTTLE1_AXIS_SET_EX1", "THROTTLE2_AXIS_SET_EX1",
  "THROTTLE_SET", "THROTTLE1_SET", "THROTTLE2_SET",
  "THROTTLE_FULL", "THROTTLE_CUT", "THROTTLE_INCR", "THROTTLE_DECR",
]

// Events an aircraft's own module may send to move the sim's surfaces and
// levers, such as K:ELEVATOR_SET (unverified for any one aircraft), and the normally aspirated Baron's
// Flight controls and autoflight). Masking one would cut the module's output,
// so the probe listens for them and never masks them.
const OUTPUTS = new Set(["ELEVATOR_SET", "THROTTLE_SET", "THROTTLE1_SET", "THROTTLE2_SET"])

const isAxis = (name) => name.includes("AXIS")

// What --masks-first masks: the events the PA-24's free phases heard from our
// development machine's yoke and throttle (measured on MSFS 2024, 2026-10-01,
// experiments/areas/flight-controls/results/p01-mask-2026-10-01-20-46-10.txt),
// and the second engine's throttle, which the Baron's heard.
const MASKS_FIRST = ["AXIS_ELEVATOR_SET", "AXIS_THROTTLE1_SET", "AXIS_THROTTLE2_SET"]

// Units as the sim's own behaviors read these variables (MSFS 2024 SDK 1.7.3,
// ModelBehaviorDefs/Asobo/Common/Handling.xml and Subtemplates/).
const CONTROLS = {
  pitch: {
    label: "Pitch: yoke or stick fore and aft",
    how: "through its full travel, back and forth",
    stock: [["YOKE Y POSITION", "percent"], ["ELEVATOR POSITION", "percent"]],
  },
  throttle: {
    label: "Throttle: engine 1's lever",
    how: "from idle to full and back",
    stock: [["GENERAL ENG THROTTLE LEVER POSITION:1", "percent"]],
  },
}

// Each aircraft's own variables for the pilot's input, unverified for an
// aircraft no run has watched. They come first when the
// probe judges whether a control moved, because a module's input can move
// while the stock values don't. `write` names the input variable the written
// phase writes directly.
const LOCAL = {
  "a2a-pa24-comanche": { pitch: ["L:ElevatorInput"], throttle: ["L:Throttle1Position"], write: "L:ElevatorInput" },
  "a2a-aerostar-600": { pitch: ["L:ElevatorInput"], throttle: ["L:Eng1_ThrottlePosition"], write: "L:ElevatorInput" },
  "synaptic-a220": { pitch: ["L:A22X L Sidestick Y"], throttle: ["L:A22X Throttle L Raw", "L:A22X Throttle 1 TLA"] },
  "pmdg-777-300er": { pitch: ["L:yokes_Fore_Aft"] },
  "fenix-a320-family": { pitch: ["L:N_FC_SIDESTICK_CAPT_PITCH"] },
}

// Black Square's control lock clamps the elevator and ailerons to ±1% while
// it's in (record/areas/aircraft/black-square-baron-pro/study.md, Flight
// controls and autoflight).
const CONTROL_LOCKS = {
  "black-square-baron-pro": "L:bksq_controlLocks",
  "black-square-bonanza-pro": "L:bksq_controlLocks",
}

const INPUT_EVENT_NAMES = /THROTTLE|ELEV|YOKE|STICK|PITCH|LEVER/i

// ---------------------------------------------------------------- keys and beeps

const encode = (ps) => Buffer.from(ps, "utf16le").toString("base64")
const powershell = (ps, stdio) =>
  spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encode(ps)], { stdio })

// Page Down and End, read globally, as our FS Copilot fork's guided WASM probe
// did (FS Copilot fork, record/wasm-pointer/probes/p01-wasm-away.mjs).
// GetAsyncKeyState doesn't consume the key, so the sim sees it too.
const KEYS_PS = `
$ProgressPreference = "SilentlyContinue"
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
      if (!l.startsWith("KEY ")) return
      const [, key, ...fg] = l.split(" ")
      // A press while nobody waits is dropped, so a stray key can't start a run.
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
  if (!s) map.set(name, s = { n: 0, min: v, max: v, last: v })
  s.n++
  s.last = v
  if (typeof v !== "number") return
  s.min = Math.min(s.min, v)
  s.max = Math.max(s.max, v)
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

  // A legacy send has no fifth parameter to tag, so it's listed in sim.sends,
  // which subscribeKeys matches arrivals against by name, value, and time. It's
  // listed as unsigned and as signed, because which form a legacy arrival's
  // dwData takes is unmeasured.
  const sendLegacy = (name, value, priority) => {
    const id = sim.event(name)
    const t = Date.now()
    for (const v of [value >>> 0, value | 0]) sim.sends.push({ name, data: [v, 0, 0, 0, 0], t, matched: false })
    while (sim.sends.length > 500) sim.sends.shift()
    rec.data("send", `K:${name} ${value} at priority ${priority}, legacy`, { event: name, values: [value], priority, legacy: true })
    sim.send(`K:${name} ${value} legacy`, () =>
      sim.handle.transmitClientEvent(SimConnectConstants.OBJECT_ID_USER, id, value >>> 0, priority, EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY))
  }

  sim.subscribeKeys(cfg.events, {
    priority: cfg.priority,
    maskable: true,
    quiet: true,
    onEvent: (e) => {
      // Quiet, or a line per hardware event buries the observer's prompts, as it
      // did in the first run (experiments/areas/flight-controls/results/
      // p01-mask-2026-10-01-20-28-54.txt).
      emit({ kind: "got", text: `${e.name} ${e.value}`, quiet: true, name: e.name, value: e.value, ours: e.ours })
      if (e.ours || done) return
      if (cfg.resend === "event" && isAxis(e.name)) {
        const v = Math.round(e.value * cfg.scale)
        if (cfg.legacy) sendLegacy(e.name, v, cfg.resendPriority)
        else sim.transmit(e.name, [v], { priority: cfg.resendPriority, quiet: true })
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
    if (l.startsWith("RESEND ")) {
      cfg.resendPriority = Number(l.slice(7))
      emit({ kind: "resend", text: `re-sending at priority ${cfg.resendPriority}`, priority: cfg.resendPriority })
    }
  })
  lines.on("close", () => clear("the observer's pipe closed"))
  setInterval(() => {
    if (Date.now() - lastAlive > DEADMAN_MS) clear(`no keepalive for ${DEADMAN_MS / 1000}s`)
    if (Date.now() - t0 > cfg.capMs) clear(`the ${cfg.capMs / 60_000}-minute cap`)
  }, 1000)

  await sleep(500)
  emit({
    kind: "ready",
    text: `masking ${cfg.events.join(", ")} at priority ${cfg.priority}${cfg.resend ? `, re-sending by ${cfg.resend} at ${cfg.scale}` : ""}`,
    events: cfg.events,
  })
}

// The observer's handle on one masker process.
class Masker {
  constructor(rec, cfg, onGot) {
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

  get running() { return this.child.exitCode === null && this.child.signalCode === null }

  write(line) {
    try { this.child.stdin.write(line + "\n") } catch { /* exited */ }
  }

  resendAt(priority) {
    this.write(`RESEND ${priority}`)
  }

  async clear() {
    this.write("CLEAR")
    await Promise.race([this.exited, sleep(5000)])
    if (this.running) await this.kill()
  }

  async kill() {
    this.child.kill("SIGKILL")
    await this.exited
  }
}

// ---------------------------------------------------------------- the observer

async function observer() {
  const rec = new Recorder("p01-mask", { area: "flight-controls" })
  const sim = await Sim.connect(rec, { name: "CROSSCHECK p01-mask observer" })
  rec.open()
  const keys = await startKeys()
  const beep = startBeeper()

  const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
  const target = opt("--masks-first")
  const key = target ?? opt("--aircraft") ?? Object.entries(AIRCRAFT).find(([, a]) => a.title === title)?.[0] ?? null
  const local = LOCAL[key] ?? {}
  rec.log("aircraft", `TITLE ${JSON.stringify(title)}, ${key ? `study ${key}` : "no study matched: stock variables only"}`, { title, key })

  const effectVars = (control) => [...(local[control] ?? []).map((n) => [n, "number"]), ...CONTROLS[control].stock]
  const allEffects = Object.keys(CONTROLS).flatMap(effectVars)

  // ------------------------------------------------ watching

  let win = null
  const latest = new Map()
  let effects = null
  let inputs = null
  let inputNames = new Map()

  sim.subscribeKeys(CANDIDATES, {
    priority: "highest",
    maskable: false,
    quiet: true,
    onEvent: (e) => {
      if (!win) return
      track(win.heard, e.name, e.value)
      win.keySeries.push([e.t, e.name, e.value])
    },
  })

  // Started again after a reload, because whether a request on the user
  // aircraft survives an aircraft change isn't in our records, and input event
  // hashes change with the aircraft (lib/sim.mjs, requestAll and inputEvents).
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
    const chosen = list.filter((d) => INPUT_EVENT_NAMES.test(d.name)).slice(0, 100)
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
    rec.log("check", `${lock} reads ${v}${v ? ": take the control lock out, or the elevator stays within 1%" : ""}`, { lock, value: v })
  }

  // ------------------------------------------------ maskers

  let masker = null

  async function startMasker(cfg) {
    masker = new Masker(rec, { priority: MASK_PRIORITY, resend: null, scale: SCALE, resendPriority: RESEND_SWEEP[0], capMs: CAP_MS, ...cfg }, (o) => {
      if (win) track(o.ours ? win.maskerOurs : win.masker, o.name, o.value)
    })
    try {
      await masker.ready
      return true
    } catch (e) {
      rec.log("error", `the masker didn't start: ${e.message}`)
      masker = null
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

  // ------------------------------------------------ phases

  const results = []
  const baseline = {}
  const maskEvents = {}
  const legacy = argv.includes("--legacy")
  const sweep = legacy ? RESEND_SWEEP.filter((p) => p !== MASK_PRIORITY + 1) : RESEND_SWEEP

  async function ask(heading, instruction) {
    console.log(`\n▶ ${heading}\n  ${instruction}\n  Page Down to start, End to skip.`)
    const k = await keys.next()
    rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
    return k.key === "PGDN"
  }

  async function phase(control, name, expect = null) {
    win = {
      control, phase: name,
      heard: new Map(), masker: new Map(), maskerOurs: new Map(), inputs: new Map(), effects: new Map(),
      keySeries: [], effectSeries: [],
    }
    for (const [v] of effectVars(control)) if (latest.has(v)) track(win.effects, v, latest.get(v))
    beep(1000, 100)
    await sleep(PHASE_MS)
    const w = win
    win = null
    const r = { control, phase: name, expect, window: w, verdict: verdict(w, baseline[control]) }
    results.push(r)
    rec.log("phase", `${control} ${name}: ${summary(r)}`, {
      control, phase: name, expect, verdict: r.verdict,
      heard: Object.fromEntries(w.heard), masker: Object.fromEntries(w.masker), inputs: Object.fromEntries(w.inputs),
    })
    return r
  }

  function verdict(w, base, control = w.control) {
    if (!base) return { word: "baseline" }
    for (const [name] of effectVars(control)) {
      const b = span(base.effects.get(name))
      if (b <= 0) continue
      const ratio = span(w.effects.get(name)) / b
      const word = ratio < 0.1 ? "blocked" : ratio > 0.8 ? "moved" : ratio >= 0.35 && ratio <= 0.65 ? "half" : "partly moved"
      return { word, name, ratio }
    }
    return { word: "no baseline: nothing moved while free" }
  }

  function summary(r) {
    const w = r.window
    const list = (m) => [...m].map(([n, s]) => `${n} ×${s.n} ${rangeText(s)}`).join(", ") || "none"
    const moved = [...w.effects].filter(([, s]) => s.n > 1 && span(s) > 0)
    const v = r.verdict.ratio !== undefined ? `${r.verdict.word} (${r.verdict.name} at ${Math.round(r.verdict.ratio * 100)}% of the free range)` : r.verdict.word
    return [
      v,
      `heard ${list(w.heard)}`,
      w.masker.size || r.phase !== "free" ? `masker got ${list(w.masker)}` : null,
      w.maskerOurs.size ? `masker heard its own re-sends ${list(w.maskerOurs)}` : null,
      `input events ${list(w.inputs)}`,
      `values ${moved.map(([n, s]) => `${n} ${rangeText(s)}`).join(", ") || "none moved"}`,
    ].filter(Boolean).join(" · ")
  }

  // The pitch axis event against the module's input variable, from the free
  // phase, for the written phase.
  function writeMap(w, events) {
    const lvar = local.write
    const event = events.filter(isAxis).sort((a, b) => (w.heard.get(b)?.n ?? 0) - (w.heard.get(a)?.n ?? 0))[0]
    if (!lvar || !event) return null
    const merged = [
      ...w.keySeries.filter(([, n]) => n === event).map(([t, , v]) => [t, "k", v]),
      ...w.effectSeries.filter(([, n]) => n === lvar).map(([t, , v]) => [t, "l", v]),
    ].sort((a, b) => a[0] - b[0])
    const pairs = []
    let last = null
    for (const [, kind, v] of merged) {
      if (kind === "k") last = v
      else if (last !== null) pairs.push([last, v])
    }
    const f = fit(pairs)
    rec.log("fit", f ? `${lvar} ≈ ${fmt(f.a)} × ${event} + ${fmt(f.b)}, r² ${fmt(f.r2)} over ${f.n} pairs` : `no fit of ${lvar} to ${event}`, { lvar, event, fit: f })
    return f && f.r2 >= 0.9 ? { [event]: { lvar, a: f.a, b: f.b } } : null
  }

  async function run(control) {
    const c = CONTROLS[control]
    const length = control === "pitch" ? "about a minute" : "about 30s"
    if (!await ask(c.label, `Keep moving it ${c.how}, from Page Down until the long low beep, ${length}. Don't stop at the short beeps.`)) {
      rec.log("skip", control)
      return
    }
    const free = await phase(control, "free")
    baseline[control] = free.window
    const events = [...free.window.heard.keys()].filter((n) => !OUTPUTS.has(n))
    maskEvents[control] = events
    if (!events.length) {
      rec.log("plan", `${control}: no maskable K: event heard, so nothing to mask`)
    } else {
      if (await startMasker({ events })) await phase(control, "masked", "blocked")
      await stopMasker()
      await phase(control, "cleared", "moved")
      if (control === "pitch" && await startMasker({ events, resend: "event", legacy, resendPriority: sweep[0] })) {
        for (const p of sweep) {
          masker.resendAt(p)
          await phase(control, `half, re-sent${legacy ? " by the legacy call" : ""} at ${p}`, "half")
        }
      }
      const write = control === "pitch" ? writeMap(free.window, events) : null
      if (write) {
        await stopMasker()
        if (await startMasker({ events, resend: "lvar", write })) await phase(control, "written", "half")
      }
      if (masker) {
        await stopMasker("kill")
        rec.log("kill", "the masker was killed")
        await phase(control, "killed", "moved")
      }
    }
    beep(500, 600)
    console.log("  Stop.")
  }

  async function reload() {
    const events = [...new Set(Object.values(maskEvents).flat())]
    if (!events.length) return rec.log("plan", "reload: nothing to mask")
    if (!await ask("Reload with the masks in place", "Page Down installs the masks. Then reload this aircraft however you like, and press Page Down again once you're back in the cockpit.")) return
    if (!await startMasker({ events, capMs: RELOAD_CAP_MS })) return
    console.log("  Masks in place. Reload now, then Page Down once you're in the cockpit.")
    const k = await keys.next()
    rec.log("key", `${k.key}, with ${k.foreground} in front: back in the cockpit`, k)
    await startWatches()
    if (!masker?.running) return rec.log("phase", "reload: the masker didn't survive the reload")
    for (const control of Object.keys(CONTROLS)) {
      if (!maskEvents[control]?.length) continue
      if (!await ask(`${CONTROLS[control].label}, masked before the reload`, `Keep moving it ${CONTROLS[control].how} until the long low beep, about 5s.`)) continue
      await phase(control, "masked before the reload", "blocked")
      beep(500, 600)
    }
    await stopMasker()
  }

  let stopping = false
  process.on("SIGINT", async () => {
    if (stopping) process.exit(1)
    stopping = true
    rec.log("stop", "Ctrl+C: clearing the masker and writing the report")
    await finish()
    process.exit(0)
  })

  console.log([
    "",
    "Before you start:",
    "  - the aircraft on the ground, unpaused, with the parking brake set; engines may be off",
    "  - this console where you can read it, and the sim in front",
  ].join("\n"))

  // Loads a flight through SimConnect with the aircraft harness's gate, then
  // waits for the aircraft to settle (experiments/areas/aircraft/lib/load.mjs).
  async function load(id, state, a = null) {
    const flight = readFlight(flightFile(id, state))
    const r = await loadFlight(sim, rec, flight, { pages: false })
    if (!r.passed) throw new Error(`the load of ${flight.rel} failed: ${r.failed}`)
    const ready = (a?.ready ?? []).filter((x) => x.vars).map((x) => ({
      label: x.label,
      check: async () => {
        const v = await sim.read(x.vars.map((n) => [n, "number"]))
        const value = Object.fromEntries(x.vars.map((n) => [n, v.get(n)]))
        return { ok: x.test(value), value }
      },
    }))
    await settle(sim, rec, { t0: r.t0, lVars: a?.settleL ?? [], ready, capMs: 90_000 })
  }

  // One window over every control's values at once.
  async function captureAll(label) {
    win = {
      control: null, phase: label,
      heard: new Map(), masker: new Map(), maskerOurs: new Map(), inputs: new Map(), effects: new Map(),
      keySeries: [], effectSeries: [],
    }
    for (const [v] of allEffects) if (latest.has(v)) track(win.effects, v, latest.get(v))
    beep(1000, 100)
    await sleep(PHASE_MS)
    const w = win
    win = null
    return w
  }

  async function masksFirst() {
    const a = AIRCRAFT[key]
    if (!a) return rec.log("error", `--masks-first: no aircraft ${JSON.stringify(key)} in experiments/areas/aircraft/lib/aircraft.mjs`)
    for (const control of Object.keys(CONTROLS)) maskEvents[control] = MASKS_FIRST
    if (title === a.title) return rec.log("error", `--masks-first: ${a.name} is already loaded; load another aircraft, such as the ${NEUTRAL.name}, and run again`)
    try {
      sim.track()
      await sleep(2500)
      if (!await startMasker({ events: MASKS_FIRST, capMs: RELOAD_CAP_MS })) return
      await load(key, "parked", a)
    } catch (e) {
      return rec.log("error", e.message)
    }
    if (!masker?.running) return rec.log("phase", "masks first: the masker didn't survive the load")
    await startWatches()
    if (!await ask(`${a.name}, masked before it loaded`, "Keep moving the yoke and the throttle together, from Page Down until the long low beep, about 12s. Don't stop at the short beep.")) return
    const masked = await captureAll("masked before the aircraft loaded")
    await stopMasker()
    const cleared = await captureAll("cleared")
    beep(500, 600)
    console.log("  Stop.")
    for (const control of Object.keys(CONTROLS)) {
      for (const r of [
        { control, phase: masked.phase, expect: "blocked", window: masked, verdict: verdict(masked, cleared, control) },
        { control, phase: cleared.phase, expect: null, window: cleared, verdict: { word: "baseline" } },
      ]) {
        results.push(r)
        rec.log("phase", `${control} ${r.phase}: ${summary(r)}`, { control, phase: r.phase, expect: r.expect, verdict: r.verdict })
      }
    }
  }

  // The pitch axis held inside a dead zone set in MSFS: raw events would read
  // about a quarter of full scale, and processed ones 0, or none at all.
  async function deadzone() {
    if (!await ask("Pitch, held inside a dead zone of about 50% set in MSFS's controls",
      "Hold the yoke at about a quarter of its travel, nose down, wiggling it a little so it keeps sending, from Page Down until the long low beep, 5s.")) return
    const w = await captureAll("held at a quarter of its travel, dead zone set")
    beep(500, 600)
    console.log("  Stop.")
    const values = w.keySeries.filter(([, n]) => n === "AXIS_ELEVATOR_SET").map(([, , v]) => v).sort((a, b) => a - b)
    const median = values.length ? values[Math.floor(values.length / 2)] : null
    const word = median === null ? "no AXIS_ELEVATOR_SET: consistent with the value after the dead zone, if the yoke was off center"
      : Math.abs(median) < 1000 ? `median ${median}: the event carries the value after the dead zone`
        : Math.abs(median) >= 2000 && Math.abs(median) <= 8000 ? `median ${median}: the event carries the raw axis`
          : `median ${median}: unclear`
    const r = { control: "pitch", phase: w.phase, expect: null, window: w, verdict: { word } }
    results.push(r)
    rec.log("phase", `pitch ${r.phase}: ${summary(r)}`, { median, n: values.length })
  }

  if (target) {
    await masksFirst()
  } else if (argv.includes("--deadzone")) {
    await deadzone()
  } else {
    for (const control of legacy ? ["pitch"] : Object.keys(CONTROLS)) await run(control)
    if (argv.includes("--reload")) await reload()
  }
  await finish()
  process.exit(0)

  async function finish() {
    await stopMasker()
    const lines = [
      "p01 · Masking a pilot's own flight-control input on MSFS 2024",
      `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
      `Aircraft: TITLE ${JSON.stringify(title)}, ${key ? `study ${key}` : "no study matched: stock variables only"}`,
      `Mask priority ${MASK_PRIORITY}, re-send priorities ${sweep.join(", ")}${legacy ? " by the legacy SimConnect_TransmitClientEvent" : ""}, ${PHASE_MS / 1000}s phases`,
      ...(target ? [`Mode: masks installed with TITLE ${JSON.stringify(title)} loaded, before ${AIRCRAFT[key]?.name ?? key} loaded through SimConnect`] : []),
    ]
    for (const control of Object.keys(CONTROLS)) {
      const rs = results.filter((r) => r.control === control)
      lines.push("", `${control}: masked ${maskEvents[control]?.join(", ") || "nothing"}`)
      if (!rs.length) lines.push("  not run")
      for (const r of rs) {
        const ok = r.expect ? (r.verdict.word === r.expect ? " · as expected" : ` · expected ${r.expect}`) : ""
        lines.push(`  ${r.phase}: ${summary(r)}${ok}`)
      }
    }
    const exceptions = rec.timeline.filter((e) => e.kind === "exception" || (e.kind === "masker" && e.maskerKind === "exception")).map((e) => e.text)
    lines.push("", `Exceptions: ${exceptions.join("; ") || "none"}`)
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
