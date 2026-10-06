/*
 * p02: how late can a pilot's own pitch and roll input reach the aircraft
 * before flying gets hard? The plan's step 6 question for mixed flight
 * controls (record/areas/product/plan.md; record/areas/product/ideas.md,
 * "Mixed flight controls"). There, the PM's axes travel to the flying machine
 * and the aircraft's motion travels back, so the PM's own control loop is late
 * by twice the one-way network delay, plus the following machine's display
 * buffer, 400ms in FS Copilot's (record/areas/product/03-v1-scope.md,
 * Flight-model sync). This measures what one pilot tolerates, on one machine.
 *
 *   node experiments/areas/flight-controls/p02-input-delay.mjs [--delays 0,150,300,500,700,1000]
 *   node experiments/areas/flight-controls/p02-input-delay.mjs --release
 *
 * In the Black Square Baron 58P in cruise, autopilot off. A second process,
 * the masker, masks the yoke's axis events at 10,000,000, which held the
 * Baron's yoke still (measured on MSFS 2024, 2026-10-01, record/areas/
 * flight-controls/log.md), and sends each value back after the step's delay at
 * 10,001,000, from where a sent value got past our own group on stock flight
 * controls (same log, "A value sent back at 10,000,001 reached our own masking
 * group"). A check at no delay first confirms the yoke follows the values sent
 * back.
 *
 * Then a step per delay, in shuffled order the pilot isn't told, each about
 * 50s, with the voice and a beep at each phase:
 *   hold   12s: hold the altitude and heading;
 *   turn   25s: turn 60 degrees, left and right by turns, at about 30 degrees
 *               of bank, to the heading the voice gives;
 *   hold   12s: hold that heading and the altitude;
 * and then Page Down if that step was flyable, Page Up if it wasn't.
 *
 * Each step's report: the pilot's verdict; altitude kept, as its largest and
 * its RMS departure from where the step started; how far the heading went past
 * the target in the turn's direction; the heading held after it; and the
 * vertical speed's and the yoke's reversals a minute, which climb when a pilot
 * chases their own late input.
 *
 * The masker fails open as p01's does: it clears its group and exits when the
 * observer's keepalive stops for 15s or its stdin closes, and after 15
 * minutes in any case; killing it releases the mask (measured, same log); and
 * --release kills every masker this probe started.
 *
 * Output: results/p02-input-delay-<time>.txt and .ndjson.
 */

import { execFileSync, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { encode, startBeeper, startKeys, startSpeaker } from "../../tools/guide.mjs"
import { Recorder, fmt, sleep } from "../aircraft/lib/out.mjs"
import { PRIORITY, Sim } from "../aircraft/lib/sim.mjs"

const SELF = fileURLToPath(import.meta.url)
const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] ?? null }

const MASK_PRIORITY = PRIORITY.highest_maskable
const RESEND_PRIORITY = 10_001_000
const DELAYS = (opt("--delays") ?? "0,150,300,500,700,1000").split(",").map(Number)
// The yoke's own axis events; ELEVATOR_SET and AILERON_SET are left alone,
// because an aircraft's module can send them as its output (p01-mask.mjs,
// OUTPUTS). Every name is in MSFS 2024 SDK 1.7.3, MSFS_EventsEnum.h.
const AXES = ["AXIS_ELEVATOR_SET", "AXIS_AILERONS_SET"]
const KEEPALIVE_MS = 5_000
const DEADMAN_MS = 15_000
const CAP_MS = 15 * 60_000
const PHASES = [["hold", 12_000], ["turn", 25_000], ["after", 12_000]]
const TURN_DEG = 60

const VARS = [
  ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES MAGNETIC", "degrees"], ["PLANE BANK DEGREES", "degrees"],
  ["PLANE PITCH DEGREES", "degrees"], ["VERTICAL SPEED", "feet per minute"], ["AIRSPEED INDICATED", "knots"],
  ["YOKE X POSITION", "percent"], ["YOKE Y POSITION", "percent"],
]

// ---------------------------------------------------------------- the masker

async function masker(cfg) {
  const emit = (o) => { try { process.stdout.write(JSON.stringify(o) + "\n") } catch { /* observer gone */ } }
  const rec = { log: (kind, text, f = {}) => emit({ kind, text, ...f }), data: () => {} }
  let sim
  try { sim = await Sim.connect(rec, { name: "CROSSCHECK p02-input-delay masker" }) } catch (e) { emit({ kind: "error", text: e.message }); process.exit(1) }
  const t0 = Date.now()
  let lastAlive = Date.now()
  let delay = cfg.delayMs
  let done = false
  const group = sim.ids.group
  const clear = (why) => {
    if (done) return
    done = true
    if (!sim.gone) sim.send(`clear group ${group}`, () => sim.handle.clearNotificationGroup(group))
    emit({ kind: "cleared", text: why })
    setTimeout(() => { sim.close(); process.exit(0) }, 300)
  }
  for (const name of cfg.events) sim.event(name)
  let counts = { got: 0, sent: 0 }
  sim.subscribeKeys(cfg.events, {
    priority: cfg.priority, maskable: true, quiet: true,
    onEvent: (e) => {
      if (e.ours || done) return
      counts.got++
      const send = () => { if (!done) { sim.transmit(e.name, [e.value], { priority: cfg.resendPriority, quiet: true }); counts.sent++ } }
      if (delay > 0) setTimeout(send, delay)
      else send()
    },
  })
  sim.onLost((why) => { emit({ kind: "lost", text: why }); process.exit(0) })
  const lines = createInterface({ input: process.stdin })
  lines.on("line", (l) => {
    if (l === "ALIVE") lastAlive = Date.now()
    if (l === "CLEAR") clear("the observer asked")
    if (l.startsWith("DELAY ")) { delay = Number(l.slice(6)); emit({ kind: "delay", text: `delay ${delay}ms`, delay }) }
    if (l === "COUNTS") { emit({ kind: "counts", text: `got ${counts.got}, sent ${counts.sent}`, ...counts }); counts = { got: 0, sent: 0 } }
  })
  lines.on("close", () => clear("the observer's pipe closed"))
  setInterval(() => {
    if (Date.now() - lastAlive > DEADMAN_MS) clear(`no keepalive for ${DEADMAN_MS / 1000}s`)
    if (Date.now() - t0 > CAP_MS) clear(`the ${CAP_MS / 60_000}-minute cap`)
  }, 1000)
  await sleep(500)
  emit({ kind: "ready", text: `masking ${cfg.events.join(", ")} at ${cfg.priority}, sending back at ${cfg.resendPriority} after ${delay}ms` })
}

class Masker {
  constructor(rec, cfg) {
    this.exited = new Promise((r) => { this.onExit = r })
    this.ready = new Promise((r, f) => { this.onReady = r; this.onFail = f })
    this.counts = []
    const b64 = Buffer.from(JSON.stringify(cfg)).toString("base64")
    this.child = spawn(process.execPath, [SELF, "--masker", b64], { stdio: ["pipe", "pipe", "inherit"] })
    this.child.on("exit", (code, signal) => {
      clearInterval(this.alive)
      rec.log("masker", `exited (${signal ?? `code ${code}`})`)
      this.onFail(new Error("the masker exited before it was ready"))
      this.onExit()
    })
    createInterface({ input: this.child.stdout }).on("line", (l) => {
      let o
      try { o = JSON.parse(l) } catch { return }
      if (o.kind === "ready") this.onReady(o)
      if (o.kind === "error") this.onFail(new Error(o.text))
      if (o.kind === "counts") this.counts.push(o)
      if (o.kind !== "key" && o.kind !== "send") rec.log("masker", `${o.kind}: ${o.text ?? ""}`)
    })
    this.alive = setInterval(() => this.write("ALIVE"), KEEPALIVE_MS)
  }
  write(line) { try { this.child.stdin.write(line + "\n") } catch { /* exited */ } }
  async clear() {
    this.write("CLEAR")
    await Promise.race([this.exited, sleep(5000)])
    if (this.child.exitCode === null && this.child.signalCode === null) { this.child.kill("SIGKILL"); await this.exited }
  }
}

// ---------------------------------------------------------------- analysis

const wrap = (d) => ((d % 360) + 540) % 360 - 180
const r1 = (v) => (typeof v === "number" && Number.isFinite(v) ? String(Math.round(v * 10) / 10) : "-")
const rms = (xs) => (xs.length ? Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length) : null)
const maxAbs = (xs) => (xs.length ? Math.max(...xs.map(Math.abs)) : null)

// Direction changes of a series whose swing between turning points is at
// least `min`, per minute.
function reversals(series, min, ms) {
  let n = 0, dir = 0, ext = series[0]
  for (const v of series) {
    if (dir >= 0 && v > ext) ext = v
    else if (dir <= 0 && v < ext) ext = v
    if (dir >= 0 && ext - v >= min) { if (dir > 0) n++; dir = -1; ext = v }
    else if (dir <= 0 && v - ext >= min) { if (dir < 0) n++; dir = 1; ext = v }
  }
  return ms > 0 ? n / (ms / 60_000) : null
}

function analyze(step) {
  const s = step.samples
  const alt = s.map((x) => x.alt - step.refAlt)
  const turnAndAfter = s.filter((x) => x.phase !== "hold")
  const pastTarget = turnAndAfter.map((x) => step.dir * wrap(x.hdg - step.target))
  const after = s.filter((x) => x.phase === "after").map((x) => wrap(x.hdg - step.target))
  const ms = s.length ? s[s.length - 1].t - s[0].t : 0
  return {
    altMax: maxAbs(alt), altRms: rms(alt),
    overshoot: pastTarget.length ? Math.max(0, ...pastTarget) : null,
    afterRms: rms(after), afterMax: maxAbs(after),
    vsRev: reversals(s.map((x) => x.vs), 300, ms),
    yokeRev: reversals(s.map((x) => x.yokeY), 5, ms),
    bankMax: maxAbs(turnAndAfter.map((x) => x.bank)),
  }
}

// ---------------------------------------------------------------- the observer

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
const spoken = (hdg) => String(hdg === 0 ? 360 : hdg).padStart(3, "0").split("").map((d) => WORDS[+d]).join(" ")

async function observer() {
  const rec = new Recorder("p02-input-delay", { area: "flight-controls" })
  const sim = await Sim.connect(rec, { name: "CROSSCHECK p02-input-delay observer" })
  rec.open()
  const keys = await startKeys()
  const beep = startBeeper()
  const say = startSpeaker()
  const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
  rec.log("aircraft", `TITLE ${JSON.stringify(title)}`)

  let latest = null
  let current = null
  const watch = sim.watch(VARS, {
    period: "frame", changed: false, label: "flight",
    onData: (got, t) => {
      const x = {
        t, alt: got.get("PLANE ALTITUDE"), hdg: got.get("PLANE HEADING DEGREES MAGNETIC"), bank: got.get("PLANE BANK DEGREES"),
        pitch: got.get("PLANE PITCH DEGREES"), vs: got.get("VERTICAL SPEED"), ias: got.get("AIRSPEED INDICATED"),
        yokeX: got.get("YOKE X POSITION"), yokeY: got.get("YOKE Y POSITION"),
      }
      latest = x
      if (current) current.samples.push({ ...x, phase: current.phase })
    },
  })

  let masker = null
  const results = []
  const findings = []
  const find = (text) => { findings.push(text); rec.log("finding", text) }

  async function finish() {
    if (masker) { const m = masker; masker = null; await m.clear() }
    watch.stop()
    const order = results.map((r) => r.delay).join(", ")
    const rows = [...results].sort((a, b) => a.delay - b.delay).map((r) => {
      const a = r.analysis
      return [`${r.delay}ms`.padEnd(8), (r.verdict ?? "-").padEnd(13), `${r1(a.altMax)} / ${r1(a.altRms)}`.padEnd(17), `${r1(a.overshoot)}`.padEnd(11), `${r1(a.afterMax)} / ${r1(a.afterRms)}`.padEnd(15), `${r1(a.vsRev)}`.padEnd(10), `${r1(a.yokeRev)}`.padEnd(10), `${r1(a.bankMax)}`].join("")
    })
    const lines = [
      "p02 · How late a pilot's own pitch and roll input can reach the aircraft",
      `${new Date(rec.started).toISOString()}, ${sim.version}`,
      `Aircraft: TITLE ${JSON.stringify(title)}`,
      `Mask at ${MASK_PRIORITY}, values sent back at ${RESEND_PRIORITY}; steps flown in the order ${order || "none"}`,
      ...findings.map((f) => `- ${f}`),
      "",
      "Columns: altitude off the step's start, largest / RMS, ft; heading past the target in the turn's direction, deg; heading off the target while holding after the turn, largest / RMS, deg; vertical speed reversals a minute, at least 300 fpm apart; yoke reversals a minute, at least 5% apart; largest bank, deg.",
      "delay   verdict      altitude ft      overshoot  after deg      VS rev/m  yoke rev/m bank",
      ...rows,
    ]
    const report = lines.join("\n")
    console.log("\n" + report)
    rec.writeReport(report)
    sim.close()
    await rec.close()
  }

  let stopping = false
  process.on("SIGINT", async () => {
    if (stopping) process.exit(1)
    stopping = true
    rec.log("stop", "Ctrl+C: clearing the masker and writing the report")
    await finish()
    process.exit(0)
  })

  await sleep(1000)
  if (!latest) { find("No flight data from SimConnect."); return finish() }
  const ap = await sim.readOne("AUTOPILOT MASTER", "bool")
  const ground = await sim.readOne("SIM ON GROUND", "bool")
  rec.log("check", `on ground ${ground}, autopilot ${ap}, ${fmt(latest.ias)} kt, ${fmt(latest.alt)} ft`)
  if (ground) { find("The aircraft is on the ground; p02 needs it in cruise."); return finish() }

  beep(880, 150)
  say("In cruise, autopilot off, trimmed level. Keep the sim in front, and press Page Down.")
  console.log("\n▶ In cruise, autopilot off, trimmed for level flight. Page Down to start, Page Up to stop.")
  if ((await keys.next()).key !== "START") return finish()

  // Which axis events this yoke fires.
  const heard = new Map()
  const listen = sim.subscribeKeys(AXES, { priority: "highest", maskable: false, quiet: true, onEvent: (e) => heard.set(e.name, (heard.get(e.name) ?? 0) + 1) })
  say("Move the yoke a little, in pitch and roll, for five seconds.")
  beep(1000, 100)
  await sleep(5000)
  listen.stop()
  const events = [...heard.keys()]
  find(`The yoke fired ${[...heard].map(([n, c]) => `${n} ×${c}`).join(", ") || "none of " + AXES.join(", ")}.`)
  if (!events.length) return finish()

  masker = new Masker(rec, { events, priority: MASK_PRIORITY, resendPriority: RESEND_PRIORITY, delayMs: 0, capMs: CAP_MS })
  try { await masker.ready } catch (e) { find(`The masker didn't start: ${e.message}`); masker = null; return finish() }

  // The check: at no delay, the values sent back move the yoke.
  say("Masked. Move the yoke again for five seconds.")
  beep(1000, 100)
  const c0 = []
  current = { phase: "check", samples: c0 }
  await sleep(5000)
  current = null
  masker.write("COUNTS")
  await sleep(300)
  const span = (k) => (c0.length ? Math.max(...c0.map((x) => x[k])) - Math.min(...c0.map((x) => x[k])) : 0)
  const counts = masker.counts[masker.counts.length - 1] ?? {}
  find(`Check at no delay: the masker got ${counts.got ?? "?"} events and sent ${counts.sent ?? "?"} back; the yoke moved ${r1(span("yokeY"))}% in pitch and ${r1(span("yokeX"))}% in roll.`)
  if (span("yokeY") < 5 && span("yokeX") < 5) { find("The yoke didn't follow the values sent back, so no step ran."); return finish() }

  // The steps, in an order the pilot isn't told.
  const order = [...DELAYS].sort(() => Math.random() - 0.5)
  let dir = 1
  for (let k = 0; k < order.length; k++) {
    const delay = order[k]
    masker.write(`DELAY ${delay}`)
    await sleep(300)
    const step = { delay, samples: [], phase: "hold", refAlt: latest.alt, dir: (dir = -dir) }
    step.target = Math.round(((latest.hdg + step.dir * TURN_DEG) % 360 + 360) % 360 / 10) * 10 % 360
    rec.log("step", `step ${k + 1}: ${delay}ms`, { delay })
    beep(1000, 100)
    say(`Step ${k + 1} of ${order.length}. Hold altitude and heading.`)
    current = step
    await sleep(PHASES[0][1])
    step.phase = "turn"
    beep(1000, 100)
    say(`Turn ${step.dir > 0 ? "right" : "left"} to heading ${spoken(step.target)}.`)
    await sleep(PHASES[1][1])
    step.phase = "after"
    beep(1000, 100)
    say(`Hold heading ${spoken(step.target)}.`)
    await sleep(PHASES[2][1])
    current = null
    beep(500, 500)
    say("Flyable? Page Down yes, Page Up no.")
    const k2 = await Promise.race([keys.next(), sleep(30_000).then(() => null)])
    step.verdict = k2 ? (k2.key === "START" ? "flyable" : "not flyable") : "no answer"
    step.analysis = analyze(step)
    results.push(step)
    rec.log("result", `${delay}ms: ${step.verdict}`, { delay, verdict: step.verdict, analysis: step.analysis })
  }
  say("Done. The yoke is yours again.")
  await finish()
  process.exit(0)
}

// ---------------------------------------------------------------- release

function release() {
  const ps = `
$ProgressPreference = "SilentlyContinue"
$found = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'p02-input-delay\\.mjs.*--masker' }
if (-not $found) { "no masker running" }
foreach ($p in $found) { Stop-Process -Id $p.ProcessId -Force; "killed masker " + $p.ProcessId }`
  console.log(execFileSync("powershell.exe", ["-NoProfile", "-EncodedCommand", encode(ps)], { encoding: "utf8" }).trim())
}

// Last in the file, so every constant above exists before either role runs.
if (argv.includes("--masker")) await masker(JSON.parse(Buffer.from(opt("--masker"), "base64").toString()))
else if (argv.includes("--release")) release()
else await observer()
