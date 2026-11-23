// Authoring's cases in the sim, for one session with someone at the sim, in the Black Square
// Baron 58P (record/areas/profiles/04-the-extension-in-the-sim.md, "Cases"). The real core flies
// the 58P and hosts, and the script plays the profile extension's language server, `serve`,
// through the bench's fake (tools/bench/serve.ts), with the tree's 58P profile open: every name on
// its watch lines, and the bundle the tree's builder makes of it. State sync acts only with a
// crew, so a bench core on a stand-in joins as the second pilot, as in tools/sim/state-sync.ts,
// for the cases on state sync's routes, and stays for every case. A sampler in the ADF
// radio's panel reads what each case changes, frame by frame, through the sim's inspector, and
// the script writes report.txt in the run's folder.
//
//   node tools/build.ts install                     with the sim closed
//   node tools/bench.ts authoring                   once, so target/bench holds this tree
//   cargo build --release -p dualinput-core
//   node tools/sim/authoring.ts --core target/release/dualinput-core.exe
//
// Then start the sim and load the 58P cold and dark at a stand; the script says each step aloud.
// The cases that need no one run first, for about two minutes, and then the pilot's part, about
// three minutes of it: the left mixture lever, the beacon switch, two buttons on the ADF radio, and
// a still view of the radio stack while the picker walks the panels. Keys:
//   Page Down   starts a step the script asks for
//   Page Up     skips it
//   q           stops the cores, replays the real core's recording, and ends

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import type { AuthoringSlice } from "../../src/engines/messages/ts/authoring/AuthoringSlice.ts"
import type { CockpitPanel } from "../../src/engines/messages/ts/authoring/CockpitPanel.ts"
import type { Given } from "../../src/engines/messages/ts/authoring/Given.ts"
import type { OpenBundle } from "../../src/engines/messages/ts/authoring/OpenBundle.ts"
import type { OpenName } from "../../src/engines/messages/ts/authoring/OpenName.ts"
import type { RunResult } from "../../src/engines/messages/ts/authoring/RunResult.ts"
import type { Value } from "../../src/engines/messages/ts/authoring/Value.ts"
import type { CockpitSlice } from "../../src/engines/messages/ts/cockpit/CockpitSlice.ts"
import type { SessionSlice } from "../../src/engines/messages/ts/session/SessionSlice.ts"
import type { SimSlice } from "../../src/engines/messages/ts/sim/SimSlice.ts"
import { MARK } from "../../src/features/authoring/panel/src/outline.ts"
import { BenchRun, type Core } from "../bench/cores.ts"
import { load } from "../bench/flights.ts"
import { app, BenchNetwork, join } from "../bench/network.ts"
import { FakeApp } from "../bench/pages.ts"
import { FakeCockpitPanel } from "../bench/panel.ts"
import { builtHashes, runBuilder } from "../bench/profiles.ts"
import { FakeServe, MESSAGE_BUDGET, number, occurrences, value } from "../bench/serve.ts"
import { shoot } from "../lib/dev-window.ts"
import { SIM_PROCESS } from "../lib/install.ts"
import { ROOT } from "../lib/repo.ts"
import { Failed, main, output } from "../lib/run.ts"
import { desktop, type Desktop } from "./desktop.ts"
import { Guide } from "./guide.ts"
import { evaluate, listPages, type Page } from "./inspector.ts"

const OUT = path.join(ROOT, "target", "bench", "release-with-checks")
const PROFILE = path.join(ROOT, "profiles", "aircraft", "bksq-baronpro.yaml")
const BARON = /baronpro/i

/** The budgets (record/areas/profiles/04-the-extension-in-the-sim.md, "Budgets"). */
const BOX_WITHIN_MS = 150
const RUN_WITHIN_MS = 100

/** A misspelled `L:`, one letter short of the left mixture lever's. */
const MISSPELLED = "L('BKSQ_MixtureLeverPositon_1')"

/**
 * The cockpit panel the sampler runs in: the ADF radio's, since the KR87A's own properties read
 * only in its panel, and any panel reads the sim's variables and hears an `H:` event our module
 * fires (measured on MSFS 2024, 2026-11-10, record/areas/sync/log.md, "The SDK's H: event call
 * fails on MSFS 2024, so our module fires H: events as calculator code, which reached every
 * panel").
 */
const SAMPLER = /KR87A/

/** How long a sampler reads before it stops on its own, so a script that dies leaves nothing reading. */
const SAMPLE_FOR_MS = 20 * 60_000

/**
 * How far before the command the script looks for a change on the panel's clock, which may run a
 * little behind the PC's (`clockBounds` measures it). A Run's value can't land before its
 * command, so looking early finds nothing else.
 */
const SKEW_MS = 100

/** What the sampler reads each frame: a sim variable by name and unit, or an instrument's property by its key and a dotted path, where a function on the path is called. */
type Probe = { simvar: string; unit: string } | { instrument: string; path: string }

/** A probe's reading changed: when, in ms on the PC's clock, which probe by its place, and its value, or null where it read nothing. */
type Change = [number, number, number | null]

type Readings = { changes: Change[]; heard: [number, string][]; gaps: number[] }

/** When a case's change landed since `since`, from the sampler's readings, or undefined while it hasn't. */
type Landed = (r: Readings, since: number) => number | undefined

type Session = {
  second: Core
  /** The second pilot's cockpit panel, which holds a stand-in for the ADF radio. */
  panel: FakeCockpitPanel
  serve: FakeServe
  /** The PC's time each slice in `serve.slices` arrived, at the same place. */
  arrivals: number[]
  folder: string
  names: OpenName[]
  /** The open text's bundle's hash. */
  hash: string
  guide: Guide
  say: (line: string, aloud?: boolean) => void
  result: (ok: boolean, line: string) => void
  budget: (line: string, within: boolean) => void
  skip: (what: string) => void
}

main(() => {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== "--core") throw new Failed("usage: node tools/sim/authoring.ts --core <program>")
  const core = path.resolve(args[1]!)
  if (!fs.existsSync(core)) throw new Failed(`there's no core at ${core}`)
  run(core).catch((error: Error) => {
    console.error(`\n${error.message}`)
    process.exit(1)
  })
})

async function run(program: string): Promise<void> {
  process.env.DUALINPUT_BENCH_CORE = path.join(OUT, "dualinput-core.exe")
  process.env.DUALINPUT_BENCH_STAND_IN_HELPER = path.join(OUT, "stand-in-core-helper.exe")
  process.env.DUALINPUT_BENCH_RELAY = path.join(OUT, "bench-relay.exe")
  process.env.DUALINPUT_BENCH_BUILDER = path.join(OUT, "dualinput-profile-builder.exe")
  process.env.DUALINPUT_BENCH_PROFILES = path.join(ROOT, "target", "bench", "profiles")

  const started = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
  const folder = path.join(ROOT, "target", "sim", "runs", `${started}-authoring`)
  fs.mkdirSync(folder, { recursive: true })
  const report = path.join(folder, "report.txt")
  const guide = await Guide.start()
  const failures: string[] = []
  const skipped: string[] = []
  const budgets: string[] = []
  let passed = 0
  const say = (line: string, aloud = false) => {
    console.log(line)
    fs.appendFileSync(report, `${line}\n`)
    if (aloud) guide.say(line)
  }
  const result = (ok: boolean, line: string) => {
    say(`${ok ? "PASSED" : "FAILED"}: ${line}`)
    if (ok) {
      passed++
      guide.pass()
    } else {
      failures.push(line)
      guide.fail()
    }
  }
  const budget = (line: string, within: boolean) => {
    const text = `budget ${within ? "held" : "MISSED"}: ${line}`
    say(text)
    budgets.push(text)
  }
  const skip = (what: string) => {
    say(`SKIPPED: ${what}`)
    skipped.push(what)
  }
  say(`Authoring's cases in the sim, from ${started}, with the core ${program}`)

  // The bundle `serve` sends with the 58P's profile open, which the tree's builder makes, as the
  // extension's does from the open text.
  const built = path.join(folder, "bundle")
  const hash = [...builtHashes(runBuilder(["build", PROFILE, "--out", built])).values()][0]
  if (!hash) throw new Failed(`${path.relative(ROOT, PROFILE)} didn't build`)
  const bundle: OpenBundle = { t: "built", text: fs.readFileSync(path.join(built, path.basename(PROFILE)), "utf8") }
  const names = [...watchedNames(PROFILE), value(MISSPELLED)]
  say(`the open text is ${path.relative(ROOT, PROFILE)}, with ${names.length - 1} names on its watch lines, one misspelled name besides, and the bundle ${hash}`)

  const net = await BenchNetwork.start(1)
  const { settings } = net.core()
  const benchRun = new BenchRun("sim-authoring")
  const stub = spawn("ping", ["-n", "86400", "127.0.0.1"], { stdio: "ignore" })
  const second = await benchRun.core("second-pilot", { settings })
  second.act({ act: "watch", process: stub.pid! })
  await second.hear("stage Starting aircraft none")
  second.cockpit({ act: "ready", on: true })

  const data = path.join(folder, "core")
  fs.mkdirSync(data, { recursive: true })
  fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ ...settings, "session.name": "Pilot" }, null, 2))
  const out = fs.openSync(`${data}-output.txt`, "w")
  const child = spawn(program, ["--data", data], { stdio: ["ignore", out, out] })
  await until(() => (fs.existsSync(path.join(data, "port.json")) ? true : undefined), 30_000)
  let serve: FakeServe | undefined
  let panel: FakeCockpitPanel | undefined
  watchKeys(say, child, program, data, async () => {
    serve?.close()
    panel?.close()
    await stopSampling().catch(() => {})
    await second.kill().catch(() => {})
    stub.kill()
    await net.stop().catch(() => {})
    guide.close()
  })
  const real = await desktop(data, ["session", "sim"])
  const crew = await crewed(real, second, say)
  panel = crew.panel

  // `serve` connects once the session's flight has started, as when an author opens VS Code
  // mid-flight, so authoring calls back every panel told `none` at the session's start, which
  // the picker then lists (record/areas/profiles/04-the-extension-in-the-sim.md, "Every panel
  // stays while the extension is connected").
  serve = new FakeServe(data)
  const arrivals = stampArrivals(serve)
  await serve.ready()
  const refused = await serve.open(names, bundle)
  if (refused !== null) throw new Failed(`the core refused authoring.open: ${refused}`)

  const c: Session = { second, panel, serve, arrivals, folder, names, hash, guide, say, result, budget, skip }
  say("The cases that need no one run now, for about two minutes. Keep your hands off the controls until a step asks for them.", true)
  // A case that throws, such as on a panel that reloads under the inspector, fails its own part and leaves the next to run.
  const onRoutes = [firedHere, heardThere, presetHere]
  for (const part of [liveNames, runs, reverts, firedHere, byHand, heardThere, picker, presetHere]) {
    if (!crew.caughtUp && onRoutes.includes(part)) {
      skip(`${part.name}, since the second pilot's catch-up never ended`)
      continue
    }
    await part(c).catch((error: Error) => result(false, `${part.name} stopped: ${error.message}`))
  }
  await stopSampling().catch(() => {})

  say("\n=== Results")
  say(`${passed} passed, ${failures.length} failed, ${skipped.length} skipped`)
  for (const line of failures) say(`  FAILED: ${line}`)
  for (const line of skipped) say(`  SKIPPED: ${line}`)
  for (const line of budgets) say(`  ${line}`)
  say(`the report is ${path.relative(ROOT, report)}`)
  say("That's every case. Leave the flight loaded. Whoever runs the script stops it with q in its terminal, which replays the core's recording.", true)
}

/**
 * Waits for the pilot's flight in the 58P, hosts a session, and has the second pilot join it in
 * the 58P, through both pilots' Ready to preflight's end and the second pilot's catch-up, as
 * tools/sim/state-sync.ts does. Returns the second pilot's cockpit panel, whose ADF radio its
 * state sync reads and fires `H:` events at.
 */
async function crewed(real: Desktop, second: Core, say: Session["say"]): Promise<{ panel: FakeCockpitPanel; caughtUp: boolean }> {
  const sim = () => real.slice<SimSlice>("sim")
  const flying = () => sim()?.stage === "flying" && BARON.test(sim()?.aircraft?.path ?? "")
  if (!flying()) say("Start the sim, load a flight in the Black Square Baron 58P on the ground at a stand, cold and dark, and press Ready to fly.", true)
  await until(() => (flying() ? true : undefined), 60 * 60_000)
  // The A220 went back to Loading 7s after it first flew, a second load of its own, so the
  // flight counts as loaded once it has flown for 15s straight (measured on MSFS 2024,
  // 2026-11-09, record/areas/sync/log.md, "Stage 14's session in the sim passed in four
  // aircraft, and no aircraft took an H: event our module fired").
  for (let since = Date.now(); Date.now() - since < 15_000; await sleep(250)) {
    if (!flying()) {
      await until(() => (flying() ? true : undefined), 10 * 60_000)
      since = Date.now()
    }
  }
  const aircraftPath = sim()!.aircraft!.path
  say(`the sim is flying ${aircraftPath}; hosting the session`)
  await real.command("session.host", null)
  const session = () => real.slice<SessionSlice>("session")
  const code = await until(() => session()?.code ?? undefined, 30_000)

  second.act({ act: "inputs", events: [["ELECTRICAL_Battery_1", 0], ["LIGHTING_BEACON_1", 0]] })
  const secondApp = await app(second)
  await join(second, code, "Second pilot")
  await until(() => (session()?.members.length === 2 ? true : undefined), 30_000)
  await load(second, { cfg: `SimObjects\\Airplanes\\${aircraftPath.replaceAll("/", "\\")}\\aircraft.cfg`, path: aircraftPath }, { title: "Baron 58P", livery: "bench" })
  const panel = new FakeCockpitPanel(second, "VCockpit60", { KR87A: { bfoMode: false, antMode: false, multiMode: 0 } })
  // An H: event the second pilot's module fires reaches its panel's instruments, as the sim's do.
  second.onHEvent((name) => panel.hEvent(name))
  const stream = await FakeApp.open(second, ["cockpit-stream"])
  let caughtUp = false
  try {
    await until(() => (secondApp.slice<SessionSlice>("session")?.ready?.length === 0 ? true : undefined), 30_000)
    await secondApp.ok("session.ready", { on: true })
    say("waiting up to 75s for your aircraft to settle")
    await until(() => (session()?.ready?.length === 0 ? true : undefined), 75_000)
    await real.command("session.ready", { on: true })
    await until(() => (session()?.preflight.phase === "ended" ? true : undefined), 15_000)
    say("preflight ended; waiting up to 90s for the second pilot's catch-up to end")
    // While a catch-up runs, the stream holds everything the second pilot sends, so no case on
    // state sync's routes could pass, and the run skips them if it never ends. It ends slowly:
    // the stand-in takes none of the 58P's K:, B:, or H: writes, and each toggle, stepping write,
    // or write function in the catch-up waits out the 1.5s check of a write before it that never
    // lands, which took 24.6s and 26.1s on 2026-11-23 (record/areas/sync/log.md, "A catch-up
    // crawls when its writes never land, since each toggle, stepping write, or write function
    // waits out the 1.5s check of the write before it").
    await sleep(1_000)
    caughtUp = await reached(() => stream.slice<CockpitSlice>("cockpit-stream")?.catching_up === false, 90_000)
    if (!caughtUp) say("the second pilot's catch-up never ended, so the cases on state sync's routes are skipped")
  } finally {
    stream.close()
  }
  return { panel, caughtUp }
}

/** Live values: every name on the profile's watch lines gets its reading, and a misspelled `L:` reads 0. */
async function liveNames(c: Session): Promise<void> {
  c.say("\n=== Live values: the 58P's names")
  const { status } = await c.serve.state((s) => s.status.bundle.t !== "none" && s.status.profile !== null, "the open text's bundle taken or refused", 20_000)
  const pinned = status.profile?.hash === c.hash ? "the open text's own" : `${status.profile?.hash}, another than the open text's`
  c.say(`Dual Input ${status.version}; the session flies the ${status.profile?.maker} ${status.profile?.name} with the bundle ${pinned}, and the sim loaded ${status.aircraft}`)
  c.result(status.bundle.t === "loaded", `authoring loaded the open text's bundle: ${JSON.stringify(status.bundle)}`)

  const all = (s: AuthoringSlice) => s.names.length === c.names.length && s.names.every((n) => n.got.t !== "waiting")
  const s = await c.serve.state(all, "every name's first reading", 30_000).catch(() => c.serve.slice()!)
  const count = (t: string) => s.names.filter((n) => n.got.t === t).length
  const waiting = s.names.filter((n) => n.got.t === "waiting").map((n) => n.name)
  c.result(
    s.names.length === c.names.length && waiting.length === 0,
    `each of the ${c.names.length} names got a value, its firings, or an error within 30s: ${count("value")} values, ${count("fired")} watched for firings, ${count("error")} errors${waiting.length ? `, and ${waiting.length} still waiting: ${waiting.join(", ")}` : ""}`,
  )
  for (const n of s.names) if (n.got.t === "error") c.say(`  ${n.name}: ${n.got.error}`)
  const typo = s.names.find((n) => n.name === MISSPELLED)?.got
  c.result(typo?.t === "value" && typo.value.as === "number" && typo.value.value === 0, `a misspelled L:, ${MISSPELLED}, reads 0: ${JSON.stringify(typo)}`)
  const largest = Math.max(...c.serve.slices.map((x) => x.bytes))
  c.budget(`the slice with every name open: ${largest.toLocaleString("en-US")} bytes at most, against ${MESSAGE_BUDGET.toLocaleString("en-US")} for a message`, largest < MESSAGE_BUDGET)
}

/**
 * Run by each route, with no one at the controls: each entry goes to a value it doesn't read and
 * back, so the cockpit ends as it began, and each Run is timed from the command to the panel's
 * first reading of its change. That time takes in the sim's own frames after the first action
 * went out, so it's the budget's span and more. The battery, the avionics, and the ADF radio's
 * switch end on, since the KR87A acts on no event without power (read in
 * bksq-aircraft-baronpro 0.1.1, KR87A.js, `onInteractionEvent`), and the cases after this one
 * press it.
 */
async function runs(c: Session): Promise<void> {
  c.say("\n=== Run, by each route")
  const at = { heat: 0, trim: 1, pitot: 2, battery: 3, adfPower: 4, bfo: 5, powered: 6 }
  await sample([
    { simvar: "L:var_windshieldHeatSwitch", unit: "number" },
    { simvar: "A:RUDDER TRIM PCT", unit: "percent" },
    { simvar: "A:CIRCUIT SWITCH ON:29", unit: "bool" },
    { simvar: "A:ELECTRICAL MASTER BATTERY", unit: "bool" },
    { simvar: "A:CIRCUIT SWITCH ON:74", unit: "bool" },
    { instrument: "KR87A", path: "bfoMode" },
    { instrument: "KR87A", path: "isElectricityAvailable" },
  ])
  const [low, high] = await clockBounds()
  c.say(`the ADF radio's panel's clock reads from ${low}ms to ${high}ms off the PC's, so each time below holds to that`)

  const heat = await need(c, at.heat, "L:var_windshieldHeatSwitch")
  if (heat !== null) await runsTo(c, "an L: entry, windshield_heat", "windshield_heat", at.heat, [flip(heat), heat])
  const trim = await need(c, at.trim, "A:RUDDER TRIM PCT")
  if (trim !== null) await runsTo(c, "an A: entry, rudder_trim, in percent", "rudder_trim", at.trim, [trim <= 0 ? trim + 10 : trim - 10, trim], (a, b) => Math.abs(a - b) < 0.5)
  const pitot = await need(c, at.pitot, "A:CIRCUIT SWITCH ON:29")
  if (pitot !== null) await runsTo(c, "a K: event entry, pitot_heat_1, whose toggle sends K:PITOT_HEAT_TOGGLE with 1", "pitot_heat_1", at.pitot, [flip(pitot), pitot])
  const battery = await need(c, at.battery, "A:ELECTRICAL MASTER BATTERY")
  if (battery !== null) await runsTo(c, "a B: preset entry, battery, whose toggle calls ELECTRICAL_Battery_1_Toggle", "battery", at.battery, battery === 1 ? [0, 1] : [1])

  // The avionics master's input event has no variable a panel reads it by, so its box says it's on.
  const AVIONICS = "B('ELECTRICAL_Avionics_Bus_1')"
  if (numberIn(c.serve.slice(), AVIONICS) !== 1) {
    const r = await ran(c, "avionics_master", number(1))
    const on = !("refused" in r) && (await c.serve.state((s) => numberIn(s, AVIONICS) === 1, "the avionics master on", 5_000).then(() => true, () => false))
    c.result(on, `a second B: preset entry, avionics_master, turns the avionics on, as its box reads${"refused" in r ? `: ${r.refused}` : ""}`)
  }
  if ((await reading(at.adfPower)) === 0) await runsTo(c, "a K: event entry with a value, adf_power, whose toggle sends K:ELECTRICAL_CIRCUIT_TOGGLE with 74", "adf_power", at.adfPower, [1])
  const powered = await whenLanded(reads(at.powered, (x) => x === 1), 0, 20_000)
  c.result(powered !== undefined, "the ADF radio has power, by its own isElectricityAvailable()")

  const timer = await timedRun(c, "an H: event entry, adf_timer, fired with no value", "adf_timer", { t: "nothing" }, hears("adf_SetRst"))
  if (timer) {
    await sleep(1_500)
    const times = (await readings()).heard.filter(([t, name]) => t >= timer.sent - SKEW_MS && name === "adf_SetRst").length
    c.result(times === 1, `the ADF radio's panel heard H:adf_SetRst ${times} times in the 1.5s after the Run, which fired it once`)
  }
  const bfo = powered === undefined ? null : await need(c, at.bfo, "the KR87A's bfoMode")
  if (bfo !== null) await runsTo(c, "an H: event entry's toggle, adf_bfo, which fires H:adf_bfo over the KR87A's bfoMode", "adf_bfo", at.bfo, [flip(bfo), bfo], undefined, "instrument('KR87A', 'bfoMode')")
}

/**
 * The revert notice's candidates: three test buttons, which spring back in many cockpits, and the
 * transponder's code, which its gauge may keep, so each may be a variable the 58P puts back
 * (unverified for each, and it's fine if none does).
 */
const CANDIDATES: { entry: string; probe: Probe; other: (v: number) => number }[] = [
  { entry: "annunciator_test", probe: { simvar: "L:var_AnnunciatorTestButton", unit: "number" }, other: flip },
  { entry: "co_test", probe: { simvar: "L:var_CoTest", unit: "number" }, other: flip },
  { entry: "audio_marker_test", probe: { simvar: "L:var_KmaMarkerTest", unit: "number" }, other: flip },
  // Squawk 1234 or 4321, each digit a hexadecimal one.
  { entry: "transponder_code", probe: { simvar: "A:TRANSPONDER CODE:1", unit: "Bco16" }, other: (v) => (v === 0x1234 ? 0x4321 : 0x1234) },
]

/**
 * The revert notice, on each of `CANDIDATES`. A case passes when the notice agrees with the
 * panel, which reads the variable every frame: a value back where it was within 1s of landing
 * gives the notice, and one that holds, or never moves, gives none. Each ends where it began.
 */
async function reverts(c: Session): Promise<void> {
  c.say("\n=== The revert notice")
  await sample(CANDIDATES.map((x) => x.probe))
  let noticed = 0
  for (const [i, x] of CANDIDATES.entries()) {
    const before = await need(c, i, "simvar" in x.probe ? x.probe.simvar : x.entry)
    if (before === null) continue
    const target = x.other(before)
    const r = await ran(c, x.entry, number(target))
    if ("refused" in r) {
      c.result(false, `${x.entry} to ${fmt(target)}: ${r.refused}`)
      continue
    }
    await sleep(1_500)
    const last = c.serve.slice()?.last
    const notice = last?.run === r.result.run && last.outcome.t === "reverted" ? last.outcome : undefined
    const seen = (await readings()).changes.filter(([t, p]) => p === i && t >= r.sent - SKEW_MS)
    const landed = seen.find(([, , v]) => v !== before)
    const back = landed && seen.find(([t, , v]) => t > landed[0] && v === before)
    const backMs = landed && back ? Math.round(back[0] - landed[0]) : undefined
    // authoring reads for 1s after the Run's last action, which comes a frame or two before the
    // panel reads it landed, so a return near 1s may fall on either side of the notice's edge.
    const edge = backMs !== undefined && Math.abs(backMs - 1_000) < 150
    const panelSaw = !landed ? `read no change from ${fmt(before)}` : backMs !== undefined ? `read ${fmt(landed[2])}, then ${fmt(before)} again ${backMs}ms later` : `read it holding at ${fmt(landed[2])}`
    if (notice) noticed++
    // The notice comes only once the core has read the Run's value and then the old one, and a test
    // button the 58P springs back within one of the panel's frames, as annunciator_test came back
    // after 32ms on 2026-11-23, leaves the panel nothing to read, so the panel can't check it.
    const frame = percentile((await readings()).gaps, 0.5)
    if (notice && !landed && notice.after_ms < 2 * frame) {
      c.skip(`the revert notice on ${x.entry}, which said back to ${show(notice.to)} after ${notice.after_ms}ms, within two of the panel's ${frame.toFixed(1)}ms frames, too soon for the panel to read`)
      continue
    }
    c.result(edge || Boolean(notice) === (backMs !== undefined && backMs <= 1_000), `${x.entry} to ${fmt(target)}: ${notice ? `the notice said back to ${show(notice.to)} after ${notice.after_ms}ms` : "no notice"}, and the panel ${panelSaw}`)
    if ((await reading(i)) !== before) await ran(c, x.entry, number(before))
  }
  c.say(`${noticed} of ${CANDIDATES.length} writes gave the revert notice`)
}

/**
 * State sync's `H:` event, fired through sim-variables: the second pilot's panel hears SET RST
 * twice in a burst, its state sync sends both, and our module fires each into the sim, where the
 * ADF radio's panel hears them, as tools/sim/state-sync.ts has the case.
 */
async function firedHere(c: Session): Promise<void> {
  c.say("\n=== State sync through sim-variables: H: events our module fires")
  await sample([])
  const from = Date.now()
  c.panel.hEvent("adf_SetRst")
  c.panel.hEvent("adf_SetRst")
  let heard: [number, string][] = []
  for (const started = Date.now(); Date.now() - started < 8_000 && heard.length < 2; await sleep(200)) {
    heard = (await readings()).heard.filter(([t, name]) => t >= from - SKEW_MS && name === "adf_SetRst")
  }
  c.result(heard.length >= 2, `our module fires both of the second pilot's two H:adf_SetRst in a burst: the ADF radio's panel heard ${heard.length}${heard[0] ? `, the first ${Math.round(heard[0][0] - from)}ms after the second pilot's panel` : ""}`)
}

/**
 * Live values by hand: the pilot moves the left mixture lever through its travel and flips the
 * beacon switch, and each change of a box is timed from the panel's frame that first read its
 * value. The beacon's box shows its input event, which no panel reads, so the panel reads the
 * switch through `A:LIGHT BEACON`, which the input event's preset sets (unverified whether in the
 * same frame).
 */
async function byHand(c: Session): Promise<void> {
  c.say("\n=== Live values by hand")
  const lever = "L('BKSQ_MixtureLeverPosition_1')"
  const beacon = "B('LIGHTING_BEACON_1')"
  await sample([{ simvar: "L:BKSQ_MixtureLeverPosition_1", unit: "number" }, { simvar: "A:LIGHT BEACON", unit: "bool" }])
  if (await phase(c, "the mixture lever's box", "Next, the left mixture lever. At the beep, move it slowly through its whole travel and back, and keep it moving until the second beep, about 15 seconds.")) {
    const boxes = await during(c, lever, 15_000)
    const r = await readings()
    timing(c, "the left mixture lever's box", boxes, steps(r, 0), r.gaps, 10)
  }
  if (await phase(c, "the beacon switch's box", "Next, the beacon switch. At the beep, flip it on and off, four times, slowly, until the second beep, about 15 seconds.")) {
    const from = Date.now()
    const boxes = await during(c, beacon, 15_000)
    const r = await readings()
    const flips = steps(r, 1).filter(([t]) => t >= from - SKEW_MS).length
    c.result(flips >= 2 && boxes.length === flips, `the beacon's box followed each flip: the panel read ${flips} flips of A:LIGHT BEACON, and the box ${boxes.length} changes of ${beacon}`)
    timing(c, "the beacon switch's box", boxes, steps(r, 1), r.gaps, 2)
  }
}

/**
 * State sync's `H:` event heard and its `instrument()` read, through sim-variables, with the
 * pilot's presses on the ADF radio, as tools/sim/state-sync.ts has the cases: the h-events module
 * hears SET RST beside the radio's own handler, and instrument-reads sees BFO change the KR87A's
 * bfoMode, and state sync sends each to the second pilot, whose module fires `H:adf_SetRst` and
 * `H:adf_bfo` in turn.
 */
async function heardThere(c: Session): Promise<void> {
  c.say("\n=== State sync through sim-variables: an H: event heard, and an instrument() read")
  await sample([{ instrument: "KR87A", path: "bfoMode" }, { instrument: "KR87A", path: "isElectricityAvailable" }])
  if ((await reading(1)) !== 1) {
    c.result(false, "the ADF radio has no power, so its presses can't be read")
    return
  }
  const heard: string[] = []
  const stop = c.second.onHEvent((name) => heard.push(name))
  try {
    if (await phase(c, "SET RST", "Next, the ADF radio's SET RST button. At the beep, press it once, with the mouse.")) {
      heard.length = 0
      c.result(await reached(() => heard.includes("adf_SetRst"), 30_000), "the h-events module hears the pilot's press of SET RST beside the radio's own handler, and the second pilot's module fires it")
    }
    const bfo = await reading(0)
    // The second pilot's radio reads as this one does, so the press makes the two differ, and its
    // state sync toggles its own; a change to the value this radio already reads moves nothing here.
    Object.assign(c.panel.gauges.get("KR87A")!, { bfoMode: bfo === 1 })
    if (await phase(c, "BFO", "Next, the ADF radio's BFO button. At the beep, press it once.")) {
      heard.length = 0
      const toggled = await reached(() => heard.includes("adf_bfo"), 30_000)
      const now = await reading(0)
      c.result(toggled && now !== bfo, `instrument-reads sees the KR87A's bfoMode go from ${fmt(bfo)} to ${fmt(now)}, and the second pilot's state sync toggles its own with H:adf_bfo`)
    }
  } finally {
    stop()
  }
}

/** Two rows on the radio stack, which the pilot's view holds: the ADF radio, and a NAV/COM. */
const SHOTS = [/^KR87A$/, /^KX155B/]

/**
 * The display picker: it lists every cockpit panel, and moving the row outlines each in turn, in
 * its own panel, over the instrument the row names, and leaves the row left. A screenshot of two
 * rows on the radio stack shows the outline as the pilot sees it.
 */
async function picker(c: Session): Promise<void> {
  c.say("\n=== The display picker")
  // Each panel's page, by the name its bridge's `hello` gives it, which the picker's rows carry
  // (src/platform/panel-bridge/src/start.ts).
  const pages = new Map<string, Page>()
  for (const page of await cockpits()) {
    const name = await evaluate<string | null>(page, "window.globalPanelData ? globalPanelData.sName || null : null").catch(() => null)
    if (name) pages.set(name, page)
  }
  if (!(await phase(c, "the display picker", "Next, the display picker. Look at the radio stack, with the ADF radio and the NAV and COM radios in view. At the beep, keep the view still until the second beep, about half a minute."))) return
  const pid = simPid()
  try {
    await c.serve.panel({ t: "picker" })
    await c.serve.state((s) => s.panels.length > 0, "the picker's panels")
    // Every panel answers its new count on the announcement after `serve` connected, so a late one shows a moment after the first.
    await sleep(1_000)
    const panels = [...c.serve.slice()!.panels].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
    c.result(panels.length === 20, `the picker lists ${panels.length} panels, against the 58P's 20, and the inspector ${pages.size} cockpit pages: ${panels.map((p) => `${p.name} (${p.instruments.join(", ")})`).join("; ")}`)

    const rows = panels.flatMap((p) => {
      const key = rowKey(p, panels)
      return key ? [{ panel: p, key }] : []
    })
    const shots = new Set(SHOTS.map((r) => rows.find((row) => r.test(row.key))?.key).filter((k) => k !== undefined))
    for (const row of rows) if (shots.size < 2) shots.add(row.key)
    const missed: string[] = []
    const stayed: string[] = []
    let left: { page: Page; key: string } | undefined
    for (const { panel, key } of rows) {
      const page = panel.name ? pages.get(panel.name) : undefined
      await c.serve.panel({ t: "picker", active: key })
      if (!page) {
        missed.push(`${panel.name}, ${key}: no page answers on the inspector by that name`)
        continue
      }
      const why = await outlined(page, key)
      if (why) missed.push(`${panel.name}, ${key}: ${why}`)
      const before = left
      if (before && before.key !== key && (await outlineOf(before.page, before.key).catch(() => ({ boxes: [] }))).boxes.some((b) => b.key === before.key)) stayed.push(before.key)
      if (shots.has(key) && pid !== undefined) {
        // A frame for the box to draw before the picture.
        await sleep(500)
        const file = path.join(c.folder, `picker-${key.replace(/[^\w-]+/g, "-")}.png`)
        c.say(shoot(pid, file) ? `a picture of the outline on ${key}: ${path.relative(ROOT, file)}` : `no picture of the outline on ${key}: the sim's window gave none`)
      }
      left = { page, key }
    }
    c.guide.tick()
    if (pid === undefined) c.say(`no pictures: no ${SIM_PROCESS} runs`)
    c.result(missed.length === 0, `moving the row outlined each panel's instrument in its own panel: ${rows.length - missed.length} of ${rows.length}${missed.length ? `; ${missed.join("; ")}` : ""}`)
    c.result(stayed.length === 0, `each row's outline left as the row moved on${stayed.length ? `, but not ${stayed.join(", ")}` : ""}`)
  } finally {
    await c.serve.panel({ t: "nothing" })
  }
  await sleep(1_000)
  const kept: string[] = []
  for (const [name, page] of pages) if ((await outlineOf(page, "").catch(() => ({ boxes: [] }))).boxes.length > 0) kept.push(name)
  c.result(kept.length === 0, `the outline cleared from every panel as the picker closed${kept.length ? `, but not ${kept.join(", ")}` : ""}`)
}

/**
 * State sync's preset, called through sim-variables: the second pilot's battery switch goes off
 * and back on, and our module calls the 58P's `ELECTRICAL_Battery_1_Toggle` for each, as
 * tools/sim/state-sync.ts has the case. It runs last, since the ADF radio loses its power with
 * the battery.
 */
async function presetHere(c: Session): Promise<void> {
  c.say("\n=== State sync through sim-variables: a preset our module calls")
  await sample([{ simvar: "A:ELECTRICAL MASTER BATTERY", unit: "bool" }])
  const battery = await need(c, 0, "A:ELECTRICAL MASTER BATTERY")
  if (battery === null) return
  for (const v of [flip(battery), battery]) {
    const from = Date.now()
    c.second.act({ act: "set-input", name: "ELECTRICAL_Battery_1", value: v })
    const at = await whenLanded(reads(0, (x) => x === v), from, 8_000)
    c.result(at !== undefined, `the second pilot's battery switch to ${v} reaches state sync here, and our module's call of ELECTRICAL_Battery_1_Toggle moves the 58P's${at === undefined ? ": it never moved within 8s" : `, ${Math.round(at - from)}ms after`}`)
  }
}

/**
 * Says what the pilot does next, aloud, and waits for Page Down to start it, with a beep, or Page
 * Up to skip it. Returns whether it started; a step not started within 5 minutes is skipped.
 */
async function phase(c: Session, what: string, words: string): Promise<boolean> {
  c.say(`${words} Press Page Down to start, or Page Up to skip.`, true)
  c.guide.skipped()
  c.guide.declined()
  for (const started = Date.now(); Date.now() - started < 5 * 60_000; await sleep(100)) {
    if (c.guide.declined()) {
      c.guide.tick()
      return true
    }
    if (c.guide.skipped()) {
      c.skip(`${what}, with Page Up`)
      return false
    }
  }
  c.skip(`${what}, with no Page Down within 5 minutes`)
  return false
}

/** Waits `ms` while the pilot acts, beeps as it ends, and returns each change of `name`'s box meanwhile. */
async function during(c: Session, name: string, ms: number): Promise<[number, number][]> {
  const from = c.serve.slices.length
  await sleep(ms)
  c.guide.tick()
  // The last change's slice comes within a round of the change.
  await sleep(500)
  return boxChanges(c, from, name)
}

/** Reports how soon a box followed the panel's readings, against the budget at p95, passed when at least `least` of its changes matched one. */
function timing(c: Session, what: string, boxes: [number, number][], panel: [number, number][], gaps: number[], least: number): void {
  const { ms, unmatched } = delays(boxes, panel)
  if (ms.length === 0) {
    c.result(false, `${what}: none of its ${boxes.length} changes matched a reading of the panel's`)
    return
  }
  const [p50, p95, most] = [percentile(ms, 0.5), percentile(ms, 0.95), Math.max(...ms)]
  const spacing = boxes.slice(1).map(([t], i) => t - boxes[i]![0])
  c.result(
    ms.length >= least && p95 <= BOX_WITHIN_MS,
    `${what} followed the sim: ${ms.length} of its ${boxes.length} changes matched to a frame of the panel's, ${p50}ms at p50, ${p95}ms at p95, and ${most}ms at most${unmatched ? `; ${unmatched} showed a value the panel never read or passed` : ""}`,
  )
  c.budget(`${what}, from the sim's change: ${p95}ms at p95 over ${ms.length} changes, against ${BOX_WITHIN_MS}ms`, p95 <= BOX_WITHIN_MS)
  c.say(`  the panel's frames came every ${percentile(gaps, 0.5).toFixed(1)}ms at the median, so each time is short of the sim's own by up to that${spacing.length ? `; the box changed every ${percentile(spacing, 0.5)}ms at the median, against the slice's round of 50ms` : ""}`)
}

/**
 * How long after the panel read each value its box showed it: for each change of the box, the
 * latest step of the panel's readings, up to `SKEW_MS` after the slice's arrival, that reached or
 * crossed the box's value. A lever moves on between the panel's frames, so the panel may never read
 * the very value the core sent, and a step that crossed it is the frame the panel first could have.
 * A box can show a value before the panel's frame reads it, since the core's reading may come
 * between the panel's frames and the panel's clock runs up to `SKEW_MS` off the PC's (unverified
 * which). A search that stopped at the arrival put the beacon's box 2.7s behind its switch, the
 * spacing of two flips, on MSFS 2024 on 2026-11-23, so the search looks a little past it, and a
 * time can be negative.
 */
function delays(boxes: [number, number][], panel: [number, number][]): { ms: number[]; unmatched: number } {
  const ms: number[] = []
  let unmatched = 0
  for (const [at, v] of boxes) {
    let found: number | undefined
    // The first reading is where the probe stood as the sampler started, which no change led to.
    for (let k = panel.length - 1; k >= 1; k--) {
      const [t, now] = panel[k]!
      const was = panel[k - 1]![1]
      if (t > at + SKEW_MS) continue
      if (near(now, v) || (Math.min(was, now) < v && v < Math.max(was, now))) {
        found = t
        break
      }
    }
    if (found === undefined) unmatched++
    else ms.push(Math.round(at - found))
  }
  return { ms, unmatched }
}

/** Each change of `name`'s box among `serve`'s slices from the place `from` on, as [the PC's time it arrived, its value]. */
function boxChanges(c: Session, from: number, name: string): [number, number][] {
  const changes: [number, number][] = []
  let was = numberIn(c.serve.slices[from - 1]?.value, name)
  for (let i = from; i < c.serve.slices.length; i++) {
    const v = numberIn(c.serve.slices[i]!.value, name)
    if (v !== undefined && v !== was) changes.push([c.arrivals[i]!, v])
    if (v !== undefined) was = v
  }
  return changes
}

function numberIn(s: AuthoringSlice | undefined, name: string): number | undefined {
  const got = s?.names.find((n) => n.name === name)?.got
  return got?.t === "value" && got.value.as === "number" ? got.value.value : undefined
}

/**
 * The PC's time each slice reached `serve`, at the same place as `serve.slices`, for the live
 * values' timing. The fake pushes each slice onto `slices` as its socket hands it over, so
 * wrapping that push stamps each as it arrives; it's wrapped before any message can come, in the
 * same turn as the fake's socket opens.
 */
function stampArrivals(serve: FakeServe): number[] {
  const arrivals: number[] = []
  const slices = serve.slices
  const push = slices.push.bind(slices)
  slices.push = (...items) => {
    arrivals.push(...items.map(() => Date.now()))
    return push(...items)
  }
  return arrivals
}

/** Runs `entry` with `given`, and returns when the command went with the Run's result once the slice has it, or why it didn't go. */
async function ran(c: Session, entry: string, given: Given): Promise<{ sent: number; result: RunResult } | { refused: string }> {
  const before = c.serve.slice()?.last?.run ?? 0
  const sent = Date.now()
  const answer = await c.serve.run(entry, given)
  if (answer !== null) return { refused: `the core refused the command: ${answer}` }
  const result = (await c.serve.state((s) => (s.last?.run ?? 0) > before, `${entry}'s Run's result`)).last!
  if (result.outcome.t === "refused") return { refused: `Run refused it: ${result.outcome.why}` }
  return { sent, result }
}

/** Runs `entry` with `given`, and times it from the command to when `landed` finds its change in the panel. */
async function timedRun(c: Session, what: string, entry: string, given: Given, landed: Landed): Promise<{ sent: number; ms: number } | null> {
  const r = await ran(c, entry, given)
  if ("refused" in r) {
    c.result(false, `${what}: ${r.refused}`)
    return null
  }
  const at = await whenLanded(landed, r.sent)
  if (at === undefined) {
    c.result(false, `${what}: Run took it, and the panel read no change within 3s`)
    return null
  }
  const ms = Math.round(at - r.sent)
  c.result(true, `${what}: the panel read it ${ms}ms after the command`)
  c.budget(`a Run of ${entry}, from the command to the panel's reading: ${ms}ms, against ${RUN_WITHIN_MS}ms to its first action`, ms <= RUN_WITHIN_MS)
  return { sent: r.sent, ms }
}

/**
 * Runs `entry` to each of `values` in turn, each landing when the panel reads it through probe
 * `place`. A toggle decides from the core's last reading of its entry, and an `instrument()`
 * reading comes only every 250ms (src/platform/sim-variables/panel/src/instrument-reads.ts), so a
 * Run sent as the last one lands can find the old value and send nothing, which fits adf_bfo's
 * second Run, 126ms after its first, moving nothing on 2026-11-23. So where the entry's `box` is
 * given, each next Run waits until the box shows the last Run's value, as an author would.
 */
async function runsTo(c: Session, what: string, entry: string, place: number, values: number[], same = (a: number, b: number) => a === b, box?: string): Promise<void> {
  for (const v of values) {
    const landed = await timedRun(c, `${what}, to ${fmt(v)}`, entry, number(v), reads(place, (x) => same(x, v)))
    if (landed && box) await c.serve.state((s) => numberIn(s, box) !== undefined && same(numberIn(s, box)!, v), `${box}'s box at ${fmt(v)}`, 3_000).catch(() => {})
  }
}

/** The first change through probe `place` since `since` that `ok` takes. */
function reads(place: number, ok: (v: number) => boolean): Landed {
  return (r, since) => r.changes.find(([t, p, v]) => p === place && t >= since - SKEW_MS && v !== null && ok(v))?.[0]
}

/** The first time the sampler's panel heard the `H:` event `name` since `since`. */
function hears(name: string): Landed {
  return (r, since) => r.heard.find(([t, n]) => t >= since - SKEW_MS && n === name)?.[0]
}

/** Polls the sampler's readings until `landed` finds a time since `since`, for at most `ms`. */
async function whenLanded(landed: Landed, since: number, ms = 3_000): Promise<number | undefined> {
  for (const started = Date.now(); Date.now() - started < ms; await sleep(100)) {
    const at = landed(await readings(), since)
    if (at !== undefined) return at
  }
  return undefined
}

/**
 * Starts reading `probes` each frame of the ADF radio's panel, in place of what it read before. An
 * inspector call opens a socket to its page each time, too slowly to time a change, so the panel
 * keeps each change with its time, and every `H:` event it hears, in `DUALINPUT_CHECK_READINGS`
 * (record/areas/architecture/02-code-map.md, "Names the sim shares"), and the script fetches them.
 * A time is the panel's clock as it started plus performance.now() since, and `clockBounds` says
 * how far that is from the PC's. The listener goes in once a page and stays until the panel
 * reloads, as tools/sim/state-sync.ts's does; the reads stop after `SAMPLE_FOR_MS`, or at
 * `stopSampling`. Runs in Coherent GT, so it's ES2017.
 */
async function sample(probes: Probe[]): Promise<void> {
  await inPanel(
    SAMPLER,
    `(function () {
      var probes = ${JSON.stringify(probes)};
      var was = window.DUALINPUT_CHECK_READINGS;
      if (was) was.stopped = true;
      var out = { started: Date.now(), from: performance.now(), last: [], changes: [], heard: [], gaps: [], stopped: false, listening: !!(was && was.listening) };
      window.DUALINPUT_CHECK_READINGS = out;
      var all = document.querySelectorAll("*");
      var targets = probes.map(function (p) {
        if (!p.instrument) return null;
        for (var i = 0; i < all.length; i++) if (all[i].instrumentIdentifier === p.instrument) return all[i];
        return null;
      });
      function read(i) {
        var p = probes[i];
        try {
          var v = p.simvar ? SimVar.GetSimVarValue(p.simvar, p.unit) : targets[i];
          if (!p.simvar) {
            var path = p.path.split(".");
            for (var j = 0; j < path.length && v !== null && v !== undefined; j++) {
              var owner = v;
              v = v[path[j]];
              if (typeof v === "function") v = v.call(owner);
            }
          }
          if (typeof v === "boolean") return v ? 1 : 0;
          return typeof v === "number" && !isNaN(v) ? v : null;
        } catch (e) {
          return null;
        }
      }
      var previous = null;
      function frame() {
        var elapsed = performance.now() - out.from;
        if (out.stopped || elapsed > ${SAMPLE_FOR_MS}) return;
        var t = out.started + elapsed;
        if (previous !== null) {
          out.gaps.push(t - previous);
          if (out.gaps.length > 3000) out.gaps.shift();
        }
        previous = t;
        for (var i = 0; i < probes.length; i++) {
          var v = read(i);
          if (v !== out.last[i] && out.changes.length < 100000) {
            out.changes.push([t, i, v]);
            out.last[i] = v;
          }
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
      if (!out.listening) {
        out.listening = true;
        Coherent.on("OnInteractionEvent", function (target, args) {
          var o = window.DUALINPUT_CHECK_READINGS;
          if (o && o.heard.length < 10000) o.heard.push([o.started + (performance.now() - o.from), args && args[0]]);
        });
      }
      return 0;
    })()`,
  )
  // The first frame's reading is each probe's value before the case.
  await sleep(500)
}

/** What the sampler has kept since it started. */
async function readings(): Promise<Readings> {
  const text = await inPanel<string | null>(SAMPLER, "(function () { var o = window.DUALINPUT_CHECK_READINGS; return o ? JSON.stringify({ changes: o.changes, heard: o.heard, gaps: o.gaps }) : null; })()")
  if (!text) throw new Failed("the ADF radio's panel holds no readings, so it reloaded")
  return JSON.parse(text) as Readings
}

/** The latest value the sampler read through probe `place`, waiting up to 2s for its first frame. */
async function reading(place: number): Promise<number | null> {
  for (const started = Date.now(); ; await sleep(200)) {
    const found = (await readings()).changes.filter(([, p]) => p === place).at(-1)
    if (found) return found[2]
    if (Date.now() - started > 2_000) return null
  }
}

/** The value probe `place` reads, or null, said as a failure, when it reads nothing. */
async function need(c: Session, place: number, what: string): Promise<number | null> {
  const v = await reading(place)
  if (v === null) c.result(false, `the panel reads nothing through ${what}, so its case didn't run`)
  return v
}

/**
 * The least and most the sampler's clock can be off the PC's, in ms, over 5 reads: a read lands
 * between the PC's time before the call and after it.
 */
async function clockBounds(): Promise<[number, number]> {
  let [low, high] = [-Infinity, Infinity]
  for (let i = 0; i < 5; i++) {
    const before = Date.now()
    const panel = await inPanel<number>(SAMPLER, "(function () { var o = window.DUALINPUT_CHECK_READINGS; return o.started + (performance.now() - o.from); })()")
    const after = Date.now()
    low = Math.max(low, Math.round(panel - after))
    high = Math.min(high, Math.round(panel - before))
  }
  return [low, high]
}

async function stopSampling(): Promise<void> {
  await inPanel(SAMPLER, "(function () { var o = window.DUALINPUT_CHECK_READINGS; if (o) o.stopped = true; return 0; })()")
}

type OutlineRead = { boxes: { key: string; rect: number[] }[]; instruments: number[][]; viewport: number[] }

/**
 * What `page` shows of the outline, through the inspector: each of the `outline` module's boxes,
 * by the key it shows, and where each instrument with `key`'s identifier sits in the panel. Runs
 * in Coherent GT, so it's ES2017.
 */
async function outlineOf(page: Page, key: string): Promise<OutlineRead> {
  return evaluate<OutlineRead>(
    page,
    `(function (key, mark) {
      var id = key.split("|")[0];
      function rect(el) {
        var r = el.getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
      }
      var boxes = [];
      var marked = document.querySelectorAll("[" + mark + "]");
      for (var i = 0; i < marked.length; i++) boxes.push({ key: marked[i].getAttribute(mark), rect: rect(marked[i]) });
      var instruments = [];
      var panel = document.getElementById("panel");
      var children = panel ? panel.children : [];
      for (var j = 0; j < children.length; j++) {
        var el = children[j];
        if ((el.instrumentIdentifier || el.tagName.toLowerCase()) === id) instruments.push(rect(el));
      }
      return { boxes: boxes, instruments: instruments, viewport: [window.innerWidth, window.innerHeight] };
    })(${JSON.stringify(key)}, ${JSON.stringify(MARK)})`,
  )
}

/**
 * Waits up to 3s for `page` to show the outline's box for `key` over an instrument of that key,
 * or over the whole panel where the instrument has no size yet, as the module draws it. Returns
 * nothing when it does, and what it showed when it doesn't.
 */
async function outlined(page: Page, key: string): Promise<string | undefined> {
  let last = "no box"
  for (const started = Date.now(); Date.now() - started < 3_000; await sleep(200)) {
    const read = await outlineOf(page, key).catch((error: Error) => error.message)
    if (typeof read === "string") {
      last = read
      continue
    }
    const box = read.boxes.find((b) => b.key === key)
    if (!box) {
      last = `no box, and ${read.boxes.length} for other keys`
      continue
    }
    const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) <= 2)
    const over = read.instruments.some((r) => (r[2] && r[3] ? close(box.rect, r) : close(box.rect, [0, 0, read.viewport[0]!, read.viewport[1]!])))
    return over ? undefined : `the box at ${box.rect.join(",")}, and the instruments at ${read.instruments.map((r) => r.join(",")).join("; ") || "none"}`
  }
  return last
}

/** The key that makes `panel`'s row: the first key no other panel holds, or else its first. */
function rowKey(panel: CockpitPanel, panels: CockpitPanel[]): string | undefined {
  return panel.instruments.find((k) => panels.every((p) => p === panel || !p.instruments.includes(k))) ?? panel.instruments[0]
}

/** The sim's process, for a picture of its window. */
function simPid(): number | undefined {
  const rows = output("tasklist", ["/FI", `IMAGENAME eq ${SIM_PROCESS}`, "/FO", "CSV", "/NH"])
  const pid = /^"[^"]*","(\d+)"/m.exec(rows)?.[1]
  return pid === undefined ? undefined : Number(pid)
}

/**
 * Every name call on a `watch:` line of `file`, each once, as `serve` sends them for an open
 * file: a state entry's as a value, and an event entry's as occurrences. A counting map's lines
 * go too, which this doesn't read, so a profile with one stops the script rather than leave them
 * out.
 */
function watchedNames(file: string): OpenName[] {
  const names: OpenName[] = []
  let block = ""
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    block = /^(\w+):/.exec(line)?.[1] ?? block
    if (/^\s+watch:\s*(?:#.*)?$/.test(line)) throw new Failed(`${path.relative(ROOT, file)} has a counting map on a watch line, which this script doesn't read`)
    const name = /^\s+watch:\s*((?:L|A|B|K|H|instrument)\(.*\))\s*(?:#.*)?$/.exec(line)?.[1]
    if (name && !names.some((n) => n.name === name)) names.push(block === "state" ? value(name) : occurrences(name))
  }
  return names
}

function steps(r: Readings, place: number): [number, number][] {
  return r.changes.flatMap(([t, p, v]) => (p === place && v !== null ? [[t, v] as [number, number]] : []))
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? NaN
}

function flip(v: number): number {
  return v === 0 ? 1 : 0
}

function fmt(v: number | null): string {
  return v === null ? "nothing" : String(Number(v.toFixed(3)))
}

function show(v: Value): string {
  return v.as === "number" ? fmt(v.value) : JSON.stringify(v.value)
}

function cockpits(): Promise<Page[]> {
  return listPages().then((pages) => pages.filter((p) => /^VCockpit/i.test(p.title)))
}

/**
 * Runs `expression` in the first cockpit panel whose title matches `title`, found again on each
 * try, since a panel that reloads comes back as another page, and the inspector refuses the old.
 */
async function inPanel<T>(title: RegExp, expression: string): Promise<T> {
  let last: Error = new Failed(`no cockpit panel matching ${title} answers on the inspector`)
  for (let tries = 0; tries < 3; tries++) {
    const page = (await cockpits()).find((p) => title.test(p.title))
    if (page) {
      try {
        return await evaluate<T>(page, expression)
      } catch (error) {
        last = error as Error
      }
    }
    await sleep(1_000)
  }
  throw last
}

/** Whether `get` holds within `ms`. */
async function reached(get: () => boolean, ms: number): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < ms) {
    if (get()) return true
    await sleep(50)
  }
  return false
}

async function until<T>(get: () => T | undefined, ms: number): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = get()
    if (value !== undefined) return value
    if (Date.now() - started > ms) throw new Failed(`gave up after ${ms / 1000}s`)
    await sleep(100)
  }
}

function log(data: string): string {
  const recordings = path.join(data, "recordings")
  if (!fs.existsSync(recordings)) return ""
  const newest = fs.readdirSync(recordings).sort().at(-1)
  const file = newest && path.join(recordings, newest, "log.txt")
  return file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
}

function watchKeys(say: (line: string) => void, child: ReturnType<typeof spawn>, program: string, data: string, end: () => Promise<void>): void {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on("data", async (key: Buffer) => {
    if (key.toString("utf8") !== "q" && key.toString("utf8") !== "\u0003") return
    const stats = log(data).split(/\r?\n/).filter((l) => l.includes("the loop's stats")).at(-1)
    say(`the real core's last loop stats: ${stats ?? "none"}`)
    await end()
    child.kill()
    await sleep(1_000)
    const recordings = path.join(data, "recordings")
    const run = fs.existsSync(recordings) ? fs.readdirSync(recordings).sort().at(-1) : undefined
    const recording = run && path.join(recordings, run, "inputs.zst")
    if (recording && fs.existsSync(recording)) {
      const replayed = spawnSync(program, ["replay", recording], { encoding: "utf8" })
      say(`the core's replay: ${(replayed.stdout + replayed.stderr).trim()}`)
    }
    process.exit(0)
  })
}
