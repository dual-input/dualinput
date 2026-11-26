// Authoring, the core's feature that serves the profile extension's language server, with a fake
// `serve` speaking its protocol to bench cores on the stand-in sim: live values on watch lines,
// Run of each write form with its preview and revert notice, its refusals, a crew, reconnecting,
// the panels every served window keeps and the display picker's outline, the slice's size for the
// 58P, and sim variables shared by state sync and authoring
// (record/areas/profiles/04-the-extension-in-the-sim.md, "Cases").

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { type TestContext, test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { AuthoringSlice } from "../../../src/engines/messages/ts/authoring/AuthoringSlice.ts"
import type { Got } from "../../../src/engines/messages/ts/authoring/Got.ts"
import type { OpenBundle } from "../../../src/engines/messages/ts/authoring/OpenBundle.ts"
import type { OpenName } from "../../../src/engines/messages/ts/authoring/OpenName.ts"
import type { RunResult } from "../../../src/engines/messages/ts/authoring/RunResult.ts"
import type { Given } from "../../../src/engines/messages/ts/authoring/Given.ts"
import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import { ROOT } from "../../lib/repo.ts"
import { budget } from "../budgets.ts"
import { BenchRun, type Core, type Stub } from "../cores.ts"
import { BARON, load, toMenu } from "../flights.ts"
import { app, BenchNetwork, host, join } from "../network.ts"
import { type FakeApp, FakePage, fakeMenuScript } from "../pages.ts"
import { FakeCockpitPanel } from "../panel.ts"
import { builtHashes, runBuilder } from "../profiles.ts"
import { FakeServe, MESSAGE_BUDGET, number, occurrences, value } from "../serve.ts"

/** A write function that engages altitude hold with a chain and a pace, and the one a later edit gives it. */
const ALT_HOLD = "write(K('AP_ALT_HOLD')).repeat(2).every('3 frames')"
const LEVELER = "write(K('AP_PITCH_LEVELER_ON'))"

/** The scenario's own profile, with an entry of each write form on names only its stand-in aircraft has. */
function profile(altHold = ALT_HOLD, extra = ""): string {
  return `maker: Black Square
name: Baron 58P
status: experimental
authors: The bench
aircraft:
  variants:
    press: bksq-aircraft-baronpropress
displays: BlackSquareTablet
state:
  battery:
    name: Battery
    watch: L('BATTERY')
    write: L('BATTERY')
  apu:
    name: APU master
    watch: L('APU')
    write: L('APU')
  beacon:
    name: Beacon
    watch: L('BEACON')
    write: L('BEACON')
  lamp:
    name: Lamp
    watch: L('LAMP')
    write:
      toggle: K('TOGGLE_LAMP')
  heading:
    name: Heading bug
    watch: L('HDG')
    write:
      inc: K('HDG_INC')
      dec: K('HDG_DEC')
      wrap: true
      range: [0, 359]
      pace: 2 frames
  alt_hold:
    name: Altitude hold
    watch: L('ALT_HOLD')
    write: |
      (value) => {
        if (value == state.alt_hold) return
        ${altHold}
      }
  nav:
    name: Nav lights
    watch: B('LIGHTING_NAV_1')
    write:
      toggle: B('LIGHTING_NAV_1_Toggle')
  beacon_light:
    name: Beacon lights
    watch: B('LIGHTING_BEACON_1')
    write:
      toggle: B('LIGHTING_BEACON_1_Toggle')
  adf_bfo:
    name: ADF BFO
    watch: instrument('KR87A', 'bfoMode')
    write:
      toggle: H('adf_bfo')
  throttle:
    name: Throttle
    owner: pilot_flying
    watch: L('THROTTLE')
    write: L('THROTTLE')
  stuck:
    name: Stuck switch
    watch: L('STUCK')
    write: L('STUCK')
  com:
    name: COM frequency
    default: 0
    watch:
      inc: K('COM_INC')
      dec: K('COM_DEC')
      wrap: false
      range: [0, 100]
    write:
      inc: K('COM_INC')
      dec: K('COM_DEC')
${extra}events:
  ap_master:
    name: Autopilot master
    watch: K('AP_MASTER')
    write: K('AP_MASTER')
  kohlsman:
    name: Altimeter setting
    watch: K('KOHLSMAN_SET')
    write: K('KOHLSMAN_SET')
  fuel:
    name: Fuel pump press
    watch: H('FUEL')
    write: H('FUEL')
`
}

/** Another aircraft's profile, which no session of the scenario's flies. */
const PIPER = `maker: Piper
name: PA-24
status: experimental
authors: The bench
aircraft:
  variants:
    a2a: pa24-250
state:
  battery:
    name: Battery
    watch: L('BATTERY')
    write: L('BATTERY')
`

const FILE = "aircraft/bksq-baronpro.yaml"

/** Builds `yaml` as `file` into `out`, as an author's tool does, and returns the bundle as `serve` sends it. */
function build(run: BenchRun, yaml: string, note: string, out = path.join(run.folder, `bundle-${note}`), file = FILE): { bundle: OpenBundle; hash: string } {
  const profiles = path.join(run.folder, `profile-${note}`)
  fs.mkdirSync(path.join(profiles, path.dirname(file)), { recursive: true })
  fs.writeFileSync(path.join(profiles, file), yaml)
  const hash = builtHashes(runBuilder(["build", path.join(profiles, file), "--out", out])).get(file)
  assert.ok(hash, `the profile ${note} built`)
  return { bundle: { t: "built", text: fs.readFileSync(path.join(out, path.basename(file)), "utf8") }, hash }
}

/** A pilot: a core with the bench's network and the scenario's local folder, its fake desktop app, its sim running, and its cockpit panels. */
type Pilot = { core: Core; app: FakeApp; name: string; panels: FakeCockpitPanel[]; sim: Stub }

type PanelsOf = (core: Core) => FakeCockpitPanel[]

/** One panel with the KR87A, which state sync's `adf_bfo` reads, and the tablet. */
const onePanel: PanelsOf = (core) => [new FakeCockpitPanel(core, "VCockpit60", { KR87A: { bfoMode: false, multiMode: 2 } })]

async function pilot(t: TestContext, run: BenchRun, net: BenchNetwork, name: string, local: string, panels: PanelsOf = onePanel): Promise<Pilot> {
  const options = net.core()
  const core = await run.core(name, { ...options, settings: { ...options.settings, "profiles.local": local } })
  const p = { core, app: await app(core), name, panels: panels(core), sim: run.stub() }
  t.after(() => p.panels.forEach((panel) => panel.close()))
  core.act({ act: "watch", process: p.sim.id })
  await core.hear("stage Starting aircraft none")
  core.act({ act: "inputs", events: [["LIGHTING_NAV_1", 0], ["LIGHTING_BEACON_1", 0]] })
  // The cockpit stream's test unit stands in beside state sync, so its step says it's ready.
  core.cockpit({ act: "ready", on: true })
  // An H: event our module fires reaches every instrument of every panel, as the sim's do.
  core.onHEvent((event) => p.panels.forEach((panel) => panel.hEvent(event)))
  return p
}

/** A fresh network and run, and the scenario's profile built into a local folder, which the pilot flying's core pins. */
async function bench(t: TestContext, name: string): Promise<{ run: BenchRun; net: BenchNetwork; local: string; session: { bundle: OpenBundle; hash: string } }> {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun(name, t)
  const local = path.join(run.folder, "local-bundles")
  const session = build(run, profile(), "session", local)
  return { run, net, local, session }
}

function sessionOf(p: Pilot): SessionSlice | undefined {
  return p.app.slice<SessionSlice>("session")
}

async function until(p: Pilot, ok: (s: SessionSlice) => boolean, what: string, ms = 20_000): Promise<void> {
  await p.app.until(() => {
    const s = sessionOf(p)
    return s !== undefined && ok(s)
  }, `${p.name}: ${what}`, ms)
}

const mine = (s: SessionSlice) => s.members.find((m) => m.pilot === s.me)

/** A session `a` hosts and the others join, each in the Baron, through preflight's end. */
async function flying(a: Pilot, ...others: Pilot[]): Promise<void> {
  const code = await host(a.core, a.name)
  for (const p of others) await join(p.core, code, p.name)
  const all = [a, ...others]
  for (const p of all) await until(p, (s) => s.members.length === all.length, "every member")
  for (const p of all) await load(p.core, BARON)
  for (const p of all) {
    await until(p, (s) => mine(s)?.in_flight === true && s.ready?.length === 0, "Ready allowed")
    await p.app.ok("session.ready", { on: true })
  }
  for (const p of all) await until(p, (s) => s.preflight.phase === "ended", "preflight's end")
  for (const p of all) await caughtUp(p)
}

async function caughtUp(p: Pilot, ms = 20_000): Promise<void> {
  for (const started = Date.now(); Date.now() - started < ms; await sleep(100)) {
    const after = p.core.heard().length
    p.core.cockpit({ act: "report" })
    const line = await p.core.hear(/^cockpit report /, { after })
    const report = JSON.parse(line.replace(/^cockpit report /, "")) as { catching_up: boolean; replaying: boolean }
    if (!report.catching_up && !report.replaying) return
  }
  throw new Error(`${p.name} never finished catching up`)
}

/** A `serve` connected to `p`'s core, its slice in. */
async function serving(t: TestContext, p: Pilot, options?: { window?: string; version?: string }): Promise<FakeServe> {
  const serve = new FakeServe(p.core.data, options)
  t.after(() => serve.close())
  await serve.ready()
  return serve
}

/** What the open name `name` got, in the newest slice. */
function got(s: AuthoringSlice | undefined, name: string): Got | undefined {
  return s?.names.find((n) => n.name === name)?.got
}

const num = (n: number): Got => ({ t: "value", value: { as: "number", value: n } })

/** Runs `entry` with `given`, and returns the Run's result once the slice has it. */
async function ran(serve: FakeServe, entry: string, given: Given): Promise<RunResult> {
  const before = serve.slice()?.last?.run ?? 0
  assert.equal(await serve.run(entry, given), null, `the core took ${entry}'s Run`)
  const s = await serve.state((s) => (s.last?.run ?? 0) > before, `${entry}'s Run's result`)
  return s.last!
}

const taken = { t: "taken" } as const

async function variable(p: Pilot, name: string): Promise<number> {
  const found = (await p.core.report()).variables.find(([n]) => n === name)
  return found ? Number(found[1]) : 0
}

async function input(p: Pilot, name: string): Promise<number> {
  return (await p.core.report()).inputs.find(([n]) => n === name)?.[1] ?? 0
}

function setVariable(p: Pilot, name: string, value: number): void {
  p.core.act({ act: "set", numbers: [[name, value]], texts: [] })
}

async function settles<T>(what: string, get: () => Promise<T>, want: T, ms = 10_000): Promise<void> {
  let last: T | undefined
  for (const started = Date.now(); Date.now() - started < ms; await sleep(50)) {
    last = await get()
    if (last === want) return
  }
  assert.fail(`${what}: wanted ${String(want)}, had ${String(last)}`)
}

/** How many times `p` sent the client event `name`, with `data` as its value when given. */
async function keysSent(p: Pilot, name: string, data?: number): Promise<number> {
  const calls = (await p.core.report()).calls
  const mapped = calls.find((c) => c.function === "MapClientEventToSimEvent" && c.arguments.includes(`"${name}"`))
  if (!mapped) return 0
  const id = /event: (\d+)/.exec(mapped.arguments)![1]
  const value = new RegExp(`data: ${data}\\b`)
  return calls.filter((c) => c.function === "TransmitClientEvent" && c.unit === mapped.unit && c.arguments.includes(`event: ${id},`) && (data === undefined || value.test(c.arguments))).length
}

/** How many times `p`'s core wrote the variable `name`, through the definition its watch made. */
async function writes(p: Pilot, name: string): Promise<number> {
  const calls = (await p.core.report()).calls
  const defined = calls.find((c) => c.function === "AddToDataDefinition" && c.arguments.includes(`"${name}"`))
  if (!defined) return 0
  const definition = /definition: (\d+)/.exec(defined.arguments)![1]
  return calls.filter((c) => c.function === "SetDataOnSimObject" && c.unit === defined.unit && c.arguments.includes(`definition: ${definition},`)).length
}

/** The outline's boxes in a panel, by the key each shows. */
function outlined(panel: FakeCockpitPanel): string[] {
  return panel.doc.querySelectorAll("[data-dualinput-outline]").map((b) => b.getAttribute("data-dualinput-outline")!)
}

/** The names the live values case's open text watches. */
const NAMES: OpenName[] = [
  value("L('BATTERY')"),
  value("A('SIM ON GROUND', 'Bool')"),
  value("B('LIGHTING_NAV_1')"),
  value("instrument('KR87A', 'bfoMode')"),
  // A path no entry of the profile reads.
  value("instrument('KR87A', 'multiMode')"),
  occurrences("K('AP_MASTER')"),
  occurrences("H('FUEL')"),
  occurrences("L('TICK')"),
  // A counting map's `inc:` and `count:` lines.
  occurrences("K('COM_INC')"),
  value("L('SPD_COUNT')"),
  // Misspelled: an L: the sim creates at 0, an A: the sim refuses, and an instrument no panel holds.
  value("L('BATERY')"),
  value("A('NO SUCH VARIABLE', 'Number')"),
  value("instrument('KX155B_9', 'freq')"),
]

test("live values: each kind of name gets its value or its firings, a misspelled L: reads 0, a misspelled A: and an instrument no panel holds get errors, a line typed later reads without a save, and a Run before the flight is refused", { timeout: 150_000 }, async (t) => {
  const { run, net, local, session } = await bench(t, "authoring-values")
  const p = await pilot(t, run, net, "James", local, (core) => [
    new FakeCockpitPanel(core, "VCockpit60", { KR87A: { bfoMode: false, multiMode: 2 } }),
    new FakeCockpitPanel(core, "VCockpit61", { KX155B_1: { freq: 118.5 } }, "GNS_DISABLED"),
  ])
  p.core.act({ act: "reject", name: "NO SUCH VARIABLE" })
  // `serve` connects before the session starts, and sends nothing more once the flight starts.
  const serve = await serving(t, p)
  assert.equal(await serve.open(NAMES, session.bundle), null)
  assert.deepEqual((await ran(serve, "battery", number(1))).outcome, { t: "refused", why: "you're not in a session's flight" })
  await flying(p)

  setVariable(p, "L:SPD_COUNT", 7)
  let s = await serve.state((s) => NAMES.every((n) => got(s, n.name)?.t !== "waiting") && JSON.stringify(got(s, "L('SPD_COUNT')")) === JSON.stringify(num(7)), "every name's reading")
  assert.deepEqual(got(s, "L('BATTERY')"), num(0))
  assert.deepEqual(got(s, "A('SIM ON GROUND', 'Bool')"), num(1))
  assert.deepEqual(got(s, "B('LIGHTING_NAV_1')"), num(0))
  assert.deepEqual(got(s, "instrument('KR87A', 'bfoMode')"), num(0))
  assert.deepEqual(got(s, "instrument('KR87A', 'multiMode')"), num(2))
  assert.deepEqual(got(s, "L('BATERY')"), num(0), "a misspelled L: reads 0")
  assert.equal(got(s, "A('NO SUCH VARIABLE', 'Number')")?.t, "error")
  assert.deepEqual(got(s, "instrument('KX155B_9', 'freq')"), { t: "error", error: "no panel holds `KX155B_9`" })
  assert.deepEqual(got(s, "L('SPD_COUNT')"), num(7))
  for (const name of ["K('AP_MASTER')", "H('FUEL')", "L('TICK')", "K('COM_INC')"]) assert.deepEqual(got(s, name), { t: "fired", times: 0, last: null }, name)

  setVariable(p, "L:BATTERY", 1)
  p.core.act({ act: "set-input", name: "LIGHTING_NAV_1", value: 1 })
  Object.assign(p.panels[0]!.gauges.get("KR87A")!, { bfoMode: true })
  p.core.act({ act: "send-event", name: "AP_MASTER", data: 0 })
  p.core.act({ act: "send-event", name: "COM_INC", data: 0 })
  p.core.act({ act: "send-event", name: "COM_INC", data: 0 })
  for (const panel of p.panels) panel.hEvent("FUEL")
  setVariable(p, "L:TICK", 1)
  s = await serve.state(
    (s) =>
      JSON.stringify([got(s, "L('BATTERY')"), got(s, "B('LIGHTING_NAV_1')"), got(s, "instrument('KR87A', 'bfoMode')")]) === JSON.stringify([num(1), num(1), num(1)]) &&
      (got(s, "K('COM_INC')") as { times?: number }).times === 2 &&
      (got(s, "L('TICK')") as { times?: number }).times === 1 &&
      (got(s, "H('FUEL')") as { times?: number }).times === 1,
    "each change and firing",
  )
  assert.deepEqual(got(s, "K('AP_MASTER')"), { t: "fired", times: 1, last: 0 })
  assert.deepEqual(got(s, "H('FUEL')"), { t: "fired", times: 1, last: null })
  assert.deepEqual(got(s, "L('TICK')"), { t: "fired", times: 1, last: 1 }, "a pulse's rise from 0, with the value it rose to")

  // A line typed after the watch, on a strobe already on, reads at once, and the other lines keep
  // their counts; and one on an instrument of a panel whose instruments no entry names, which
  // that panel's module starts for.
  setVariable(p, "L:STROBE", 1)
  await sleep(200)
  assert.equal(await serve.open([...NAMES, value("L('STROBE')"), value("instrument('KX155B_1', 'freq')")]), null)
  s = await serve.state((s) => got(s, "L('STROBE')")?.t === "value" && got(s, "instrument('KX155B_1', 'freq')")?.t === "value", "the new lines' values")
  assert.deepEqual(got(s, "L('STROBE')"), num(1))
  assert.deepEqual(got(s, "instrument('KX155B_1', 'freq')"), num(118.5))
  assert.deepEqual(got(s, "K('COM_INC')"), { t: "fired", times: 2, last: 0 })
  assert.equal(s.status.in_flight, true)
  assert.equal(s.status.crew, false)
  assert.equal(s.status.flying, true)
  assert.deepEqual(s.status.profile, { maker: "Black Square", name: "Baron 58P", hash: session.hash, local: true })
  assert.deepEqual(s.status.bundle, { t: "loaded", hash: session.hash })
  assert.equal(s.status.title, "Baron 58P", "the loaded aircraft's A:TITLE, which the lens that adds it to a profile names it by")
  assert.equal(s.status.uncovered, false, "the session pinned the scenario's profile")
})

test("Run: a name, a toggle that matches and one that differs, a stepping write at its pace, a function's chain, an event with and without a value, a counting entry's steps, and an input event's and an H: event's toggles each make their calls; the preview sends nothing; the revert notice; and the refusals", { timeout: 150_000 }, async (t) => {
  const { run, net, local, session } = await bench(t, "authoring-run")
  const p = await pilot(t, run, net, "James", local)
  await flying(p)
  const serve = await serving(t, p)
  assert.equal(await serve.open([], session.bundle), null)
  await serve.state((s) => s.status.bundle.t === "loaded", "the open text's bundle loaded")

  // The preview gives the actions the Run then sends, and the stand-in sees no call from it.
  assert.equal(await serve.panel({ t: "run", entry: "heading", typed: number(3) }), null)
  let s = await serve.state((s) => s.run?.preview.t === "sends", "the heading bug's preview")
  assert.deepEqual(s.run!.preview, { t: "sends", actions: [{ action: { t: "key", name: "K('HDG_INC')", values: [] }, times: 3, every: "2 frames" }] })
  await sleep(300)
  assert.equal(await keysSent(p, "HDG_INC"), 0, "the preview sent nothing")
  assert.deepEqual((await ran(serve, "heading", number(3))).outcome, taken)
  await settles("the heading bug's steps", () => keysSent(p, "HDG_INC"), 3)

  assert.deepEqual((await ran(serve, "battery", number(1))).outcome, taken)
  await settles("the battery", () => variable(p, "L:BATTERY"), 1)
  // The battery's values seen, and a write that holds says nothing more.
  assert.equal(await serve.panel({ t: "run", entry: "battery", typed: number(0) }), null)
  s = await serve.state((s) => s.run?.entry === "battery" && s.run.seen.t === "values" && s.run.seen.values.length === 2, "the battery's values seen")
  assert.deepEqual(s.run!.seen, { t: "values", values: [{ as: "number", value: 0 }, { as: "number", value: 1 }] })
  await sleep(1_500)
  assert.deepEqual(serve.slice()!.last!.outcome, taken, "a write that holds gives no notice")

  setVariable(p, "L:LAMP", 1)
  await sleep(300)
  assert.deepEqual((await ran(serve, "lamp", number(1))).outcome, taken)
  await sleep(300)
  assert.equal(await keysSent(p, "TOGGLE_LAMP"), 0, "a toggle over a reading that matches flips nothing")
  await ran(serve, "lamp", number(0))
  await settles("the lamp's toggle", () => keysSent(p, "TOGGLE_LAMP"), 1)

  await ran(serve, "alt_hold", number(1))
  await settles("the function's chain", () => keysSent(p, "AP_ALT_HOLD"), 2)
  await ran(serve, "kohlsman", number(16272))
  await settles("the event with a value", () => keysSent(p, "KOHLSMAN_SET", 16272), 1)
  await ran(serve, "ap_master", { t: "nothing" })
  await settles("the event with none", () => keysSent(p, "AP_MASTER"), 1)
  await ran(serve, "com", { t: "steps", steps: 3 })
  await settles("the counting entry's steps", () => keysSent(p, "COM_INC"), 3)
  await ran(serve, "nav", number(1))
  await settles("the input event's preset", () => input(p, "LIGHTING_NAV_1"), 1)
  const fired: string[] = []
  p.core.onHEvent((name) => fired.push(name))
  await ran(serve, "adf_bfo", number(1))
  await serve.until(() => fired.includes("adf_bfo"), "the H: event")

  // The stand-in's aircraft puts the stuck switch back 120ms after a write.
  p.core.act({ act: "rule", when: { when: "written", name: "L:STUCK" }, after_ms: 120, then: { then: "set", name: "L:STUCK", value: 0 } })
  const stuck = await ran(serve, "stuck", number(1))
  s = await serve.state((s) => s.last?.run === stuck.run && s.last.outcome.t === "reverted", "the revert notice")
  const reverted = s.last!.outcome as { t: "reverted"; to: unknown; after_ms: number }
  assert.deepEqual(reverted.to, { as: "number", value: 0 })
  console.log(`measure: the revert notice said back to 0 after ${reverted.after_ms}ms, against the stand-in's 120ms`)
  assert.ok(reverted.after_ms >= 100 && reverted.after_ms <= 400, `back after ${reverted.after_ms}ms`)

  // A changed write function runs without a save, and a toggle right after the new bundle runs on the readings authoring held.
  const changed = build(run, profile(LEVELER), "changed")
  assert.equal(await serve.open([], changed.bundle), null)
  await serve.state((s) => s.status.bundle.t === "loaded" && s.status.bundle.hash === changed.hash, "the changed bundle loaded")
  await ran(serve, "lamp", number(0))
  await settles("the toggle on the new bundle", () => keysSent(p, "TOGGLE_LAMP"), 2)
  await ran(serve, "alt_hold", number(1))
  await settles("the changed function", () => keysSent(p, "AP_PITCH_LEVELER_ON"), 1)
  assert.deepEqual((await ran(serve, "no_such_entry", number(1))).outcome, { t: "refused", why: "the profile has no entry `no_such_entry`" })

  // Refused: text that doesn't build, and a bundle that isn't the session's profile.
  assert.equal(await serve.open([], { t: "failed", error: "aircraft/bksq-baronpro.yaml:9:5: a name call is missing its )" }), null)
  await serve.state((s) => s.status.bundle.t === "refused", "the refusal of text that doesn't build")
  assert.deepEqual((await ran(serve, "battery", number(0))).outcome, { t: "refused", why: "the open text doesn't build: aircraft/bksq-baronpro.yaml:9:5: a name call is missing its )" })
  const piper = build(run, PIPER, "piper", undefined, "aircraft/a2a-pa24.yaml")
  assert.equal(await serve.open([], piper.bundle), null)
  const why = "this profile is for the Piper PA-24, and the session flies the Black Square Baron 58P"
  await serve.state((s) => s.status.bundle.t === "refused" && s.status.bundle.why === why, "the refusal of another aircraft's profile")
  assert.deepEqual((await ran(serve, "battery", number(0))).outcome, { t: "refused", why })
  assert.equal(await variable(p, "L:BATTERY"), 1, "no refused Run wrote")
})

test("with a crew: a Run reaches the other core through state sync, a pilot monitoring's Run of the pilot flying's entry is refused and their own change put back once, two presets in a row each fire once, and sim variables hands state sync and authoring each reading", { timeout: 180_000 }, async (t) => {
  const { run, net, local, session } = await bench(t, "authoring-crew")
  const pf = await pilot(t, run, net, "James", local)
  const pm = await pilot(t, run, net, "Adam", local)
  await flying(pf, pm)
  const pfServe = await serving(t, pf)
  const pmServe = await serving(t, pm)
  const watched = [value("L('BEACON')"), occurrences("K('AP_MASTER')")]
  for (const serve of [pfServe, pmServe]) {
    assert.equal(await serve.open(watched, session.bundle), null)
    await serve.state((s) => s.status.bundle.t === "loaded" && s.status.crew, "the bundle, with a crew")
  }

  assert.deepEqual((await ran(pmServe, "throttle", number(0.5))).outcome, {
    t: "refused",
    why: "`throttle` belongs to the pilot flying, so Run waits until you have control",
  })
  assert.deepEqual((await ran(pfServe, "battery", number(1))).outcome, taken)
  await settles("the battery on the pilot monitoring's aircraft", () => variable(pm, "L:BATTERY"), 1)

  // The pilot monitoring moves the pilot flying's throttle by hand, and only state sync puts it back.
  const before = await writes(pm, "L:THROTTLE")
  setVariable(pm, "L:THROTTLE", 0.5)
  await settles("the throttle, put back", () => variable(pm, "L:THROTTLE"), 0)
  await sleep(1_500)
  assert.equal((await writes(pm, "L:THROTTLE")) - before, 1, "put back once")

  // State sync's preset from the pilot flying's nav lights, and a Run's preset right behind it, each fire once.
  pf.core.act({ act: "set-input", name: "LIGHTING_NAV_1", value: 1 })
  await ran(pmServe, "beacon_light", number(1))
  await settles("the nav lights", () => input(pm, "LIGHTING_NAV_1"), 1)
  await settles("the beacon lights", () => input(pm, "LIGHTING_BEACON_1"), 1)
  await sleep(1_000)
  assert.deepEqual([await input(pm, "LIGHTING_NAV_1"), await input(pm, "LIGHTING_BEACON_1")], [1, 1], "neither preset fired twice")

  // State sync and authoring each get one L: and one K: event's readings and firings.
  setVariable(pf, "L:BEACON", 1)
  pf.core.act({ act: "send-event", name: "AP_MASTER", data: 0 })
  await pfServe.state((s) => JSON.stringify(got(s, "L('BEACON')")) === JSON.stringify(num(1)) && (got(s, "K('AP_MASTER')") as { times?: number }).times === 1, "authoring's reading and firing")
  await settles("state sync's beacon, on the other core", () => variable(pm, "L:BEACON"), 1)
  await settles("state sync's autopilot master, on the other core", () => keysSent(pm, "AP_MASTER"), 1)
  // A watch that starts on a variable state sync already watches reads its value at once.
  setVariable(pf, "L:APU", 1)
  await settles("the APU on the other core", () => variable(pm, "L:APU"), 1)
  assert.equal(await pfServe.open([value("L('APU')")]), null)
  await pfServe.state((s) => JSON.stringify(got(s, "L('APU')")) === JSON.stringify(num(1)), "the APU's value at once")
  // Authoring's watch of the beacon ends, and state sync's runs on.
  setVariable(pf, "L:BEACON", 0)
  await settles("state sync's beacon after authoring's watch ended", () => variable(pm, "L:BEACON"), 0)

  // Leaving the flight closes sim variables' connection, and its routine with it.
  await toMenu(pm.core)
  await sleep(500)
  const fed = await pm.core.routineWrites("HTML_AND_INPUT_EVENTS")
  assert.ok(fed > 0, "the routine was fed")
  await sleep(1_000)
  assert.equal(await pm.core.routineWrites("HTML_AND_INPUT_EVENTS"), fed, "the routine's slot is written no more")
  await pmServe.state((s) => !s.status.in_flight, "the pilot monitoring out of the flight")
  assert.deepEqual((await ran(pmServe, "battery", number(0))).outcome, { t: "refused", why: "you're not in a session's flight" })
})

test("instrument reads: an instrument() on another instrument of a panel already running instrument-reads gets its value, and state sync still reads its own there after a profile's reload", { timeout: 180_000 }, async (t) => {
  const { run, net, local } = await bench(t, "authoring-instruments")
  // The KR87A, which state sync's `adf_bfo` reads, so its panel runs instrument-reads from the
  // profile's load, and an autopilot beside it that no entry reads. The pilot monitoring's local
  // folder holds nothing, so each save reaches it from the pilot flying's core.
  const panels: PanelsOf = (core) => [new FakeCockpitPanel(core, "VCockpit60", { KR87A: { bfoMode: false }, KAP140: { altitude: 3000 } })]
  const empty = path.join(run.folder, "adam-local")
  fs.mkdirSync(empty, { recursive: true })
  const pf = await pilot(t, run, net, "James", local, panels)
  const pm = await pilot(t, run, net, "Adam", empty, panels)
  await flying(pf, pm)
  const [mine] = pf.panels as [FakeCockpitPanel]
  const [theirs] = pm.panels as [FakeCockpitPanel]
  await pf.app.until(() => mine.runs("instrument-reads"), "the pilot flying's panel runs instrument-reads")
  const serve = await serving(t, pf)
  const altitude = "instrument('KAP140', 'altitude')"
  assert.equal(await serve.open([value(altitude)]), null)
  await serve.state((s) => JSON.stringify(got(s, altitude)) === JSON.stringify(num(3000)), "the autopilot's value")

  // A save reloads the profile on both cores, and the pilot flying's panel runs instrument-reads
  // on through it, for authoring's watch.
  const saved = build(run, profile(LEVELER), "saved", local)
  for (const p of [pf, pm]) await p.core.logged(new RegExp(`the profile loaded hash="${saved.hash}"`), { ms: 15_000 })
  for (const p of [pf, pm]) await caughtUp(p)
  await pm.app.until(() => theirs.runs("instrument-reads"), "the pilot monitoring's panel runs instrument-reads")
  await sleep(600)
  const fired: string[] = []
  pm.core.onHEvent((name) => {
    fired.push(name)
    if (name === "adf_bfo") Object.assign(theirs.gauges.get("KR87A")!, { bfoMode: true })
  })
  Object.assign(mine.gauges.get("KR87A")!, { bfoMode: true })
  await pm.app.until(() => fired.includes("adf_bfo"), "the pilot monitoring's toggle of the BFO, from the pilot flying's reading after the reload", 10_000)
  assert.equal(mine.runs("instrument-reads"), true)
  assert.deepEqual(got(serve.slice(), altitude), num(3000), "the autopilot still reads")
})

/** A fake cockpit panel's bridge with no modules of its own, named as the sim names a panel. */
function page(core: Core, name: string, instruments: string[]): FakePage {
  return new FakePage(core, { component: "panel-bridge", sessionOnly: true, panel: name, instruments })
}

test("panels: serve connecting mid-session brings back every panel told none, whose keys never read as no panel's while a key no panel holds is marked after an announcement's time, a profile's reload leaves every panel open, the outline goes to the row's panels and leaves the row left, serve's leaving closes a panel left with nothing, and connected at a session's start no panel is told none", { timeout: 180_000 }, async (t) => {
  const { run, net, local } = await bench(t, "authoring-panels")
  const p = await pilot(t, run, net, "James", local, (core) => [new FakeCockpitPanel(core, "VCockpit60", { KR87A: { bfoMode: false }, GNS_DISABLED: {} })])
  const [a] = p.panels as [FakeCockpitPanel]
  const pages = [70, 71, 72].map((i) => page(p.core, `VCockpit${i}`, [`GAUGE_${i}`]))
  t.after(() => pages.forEach((x) => x.close()))
  const answered = (x: FakePage) => x.messages("load").length + x.messages("none").length > 0
  await flying(p)
  await pages[0]!.until(() => pages.every(answered), "every page's answer")
  // The Baron's H: event goes to one panel, and every other page gets nothing, as does a radio's
  // panel that joins once the profile has loaded, when the H: event's module is held.
  const told = pages.filter((x) => x.messages("none").length > 0)
  assert.ok(told.length >= 2, `${told.length} pages told none`)
  const b = new FakeCockpitPanel(p.core, "VCockpit61", { GNS_DISABLED: {} }, "KX155B_1")
  Object.assign(b.display, { freq: 118.5 })
  p.panels.push(b)
  await b.page.until(() => b.page.messages("none").length === 1, "the radio's panel told none")

  const serve = await serving(t, p)
  const connected = performance.now()
  // A line on the radio, whose panel is coming back, and one on a key no panel holds: the radio's
  // waits for its panel rather than read as no panel's, and the other gets its mark only once the
  // panels have had an announcement's 2s to come back in.
  const radio = "instrument('KX155B_1', 'freq')"
  const nowhere = "instrument('KX155B_9', 'freq')"
  assert.equal(await serve.open([value(radio), value(nowhere)]), null)
  await pages[0]!.until(() => told.every((x) => x.opened.length === 2 && x.messages("load").some((m) => m.modules.some((n) => n.name === "outline"))), "every panel told none back, with the outline")
  await b.page.until(() => b.runs("outline"), "the radio's panel back, with the outline")
  await serve.state((s) => got(s, nowhere)?.t === "error", "the mark of a key no panel holds")
  const marked = performance.now() - connected
  console.log(`measure: the mark of a key no panel holds came ${Math.round(marked)}ms after serve connected mid-session, against the announcement's 2,000ms`)
  assert.ok(marked >= 1_500, `the mark came ${Math.round(marked)}ms after serve's recall of the panels`)
  await serve.state((s) => JSON.stringify(got(s, radio)) === JSON.stringify(num(118.5)), "the radio's value")
  assert.ok(serve.slices.every((x) => got(x.value, radio)?.t !== "error"), "the radio's line never read as no panel's")

  // The display picker lists every panel, and outlines the row's: both panels for a key two hold, then one, then none.
  assert.equal(await serve.panel({ t: "picker", active: "GNS_DISABLED" }), null)
  const s = await serve.state((s) => s.panels.length === 5, "the picker's panels")
  assert.deepEqual(s.panels.find((x) => x.name === "VCockpit61")?.instruments, ["KX155B_1", "GNS_DISABLED"])
  await b.page.until(() => outlined(a).length === 1 && outlined(b).length === 1, "both GNS_DISABLED outlined")
  assert.deepEqual([outlined(a), outlined(b)], [["GNS_DISABLED"], ["GNS_DISABLED"]])
  assert.equal(await serve.panel({ t: "picker", active: "KR87A" }), null)
  await b.page.until(() => outlined(b).length === 0 && outlined(a)[0] === "KR87A", "the KR87A outlined, and the row left cleared")
  assert.equal(await serve.panel({ t: "nothing" }), null)
  await b.page.until(() => outlined(a).length === 0, "the outline cleared as the picker closes")

  // A save in a test session reloads the profile on every core, and every panel stays open.
  const saved = build(run, profile(ALT_HOLD, "  strobe:\n    name: Strobe\n    watch: L('STROBE')\n    write: L('STROBE')\n"), "saved", local)
  await p.core.logged(new RegExp(`the profile loaded hash="${saved.hash}"`), { ms: 15_000 })
  await sleep(1_000)
  for (const x of [...pages, a.page, b.page]) assert.equal(x.client.state === "closed", false, "a panel open through the reload")
  assert.equal(b.runs("outline"), true)

  // `serve` leaves: the radio's panel, left with nothing, closes, and the others stop the outline.
  serve.close()
  await b.page.until(() => b.page.client.state === "closed", "the radio's panel closing")
  await pages[0]!.until(() => told.every((x) => x.messages("stop").some((m) => m.modules.includes("outline"))), "the outline stopping")

  // Connected at a session's start, no panel is told none.
  const again = await serving(t, p)
  assert.ok(again.connected)
  await p.app.ok("session.leave")
  await pages[0]!.until(() => pages.every((x) => x.client.state === "closed"), "every page closing at the session's end")
  const nones = pages.map((x) => x.messages("none").length)
  const loads = pages.map((x) => x.messages("load").length)
  await flying(p)
  await pages[0]!.until(() => pages.every((x, i) => x.messages("load").length > loads[i]!), "every page loaded in the new session", 15_000)
  await sleep(1_000)
  assert.deepEqual(pages.map((x) => x.messages("none").length), nones, "no page told none")
})

test("windows and releases: a serve of another release gets every command refused, the last window to connect is served while the other sees its ID, and the first is served again once the last leaves", { timeout: 120_000 }, async (t) => {
  const { run, net, local, session } = await bench(t, "authoring-windows")
  const p = await pilot(t, run, net, "James", local)
  await flying(p)
  const other = await serving(t, p, { version: "0.0.0", window: "older-release" })
  const refused = await other.open([value("L('BATTERY')")], session.bundle)
  assert.match(refused ?? "", /^Dual Input is \S+ and this extension is 0\.0\.0/)
  assert.match((await other.panel({ t: "nothing" })) ?? "", /^Dual Input is/)
  assert.match((await other.run("battery", number(1))) ?? "", /^Dual Input is/)
  assert.equal(other.slice()!.window, null, "nothing serves a client of another release")

  const first = await serving(t, p, { window: "first" })
  assert.equal(await first.open([value("L('BATTERY')")], session.bundle), null)
  await first.state((s) => s.window === "first" && got(s, "L('BATTERY')")?.t === "value", "the first window served")
  const last = await serving(t, p, { window: "last" })
  assert.equal(await last.open([value("L('APU')")], session.bundle), null)
  await first.state((s) => s.window === "last", "the first window seeing the last one has the sim")
  assert.equal(await first.run("battery", number(1)), "another VS Code window has the sim")
  last.close()
  const s = await first.state((s) => s.window === "first" && got(s, "L('BATTERY')")?.t === "value" && s.status.bundle.t === "loaded", "the first window served again, with no edit")
  assert.deepEqual(s.names.map((n) => n.name), ["L('BATTERY')"])
  assert.deepEqual((await ran(first, "battery", number(1))).outcome, taken)
  await settles("the battery", () => variable(p, "L:BATTERY"), 1)
})

test("a serve whose core restarted gets its boxes and Run back with no edit", { timeout: 180_000 }, async (t) => {
  const { run, net, local, session } = await bench(t, "authoring-restart")
  const pf = await pilot(t, run, net, "James", local)
  const pm = await pilot(t, run, net, "Adam", local)
  await flying(pf, pm)
  const serve = await serving(t, pm)
  assert.equal(await serve.open([value("L('BATTERY')")], session.bundle), null)
  assert.equal(await serve.panel({ t: "run", entry: "battery", typed: number(1) }), null)
  await serve.state((s) => s.status.bundle.t === "loaded" && got(s, "L('BATTERY')")?.t === "value", "the box and the bundle")

  // The pilot monitoring's core crashes while its sim flies on: the next stand-in's sim already
  // holds the aircraft, and the menu script's master page takes the core from Starting to Flying.
  await pm.core.kill()
  const restarted = await run.core(pm.name, { ...net.core(), settings: { ...net.core().settings, "profiles.local": local } })
  restarted.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "aircraft-loaded", path: BARON.cfg } }] })
  await sleep(100)
  const menu = fakeMenuScript(restarted, "in-game")
  t.after(() => menu.close())
  restarted.cockpit({ act: "ready", on: true })
  restarted.act({ act: "watch", process: pm.sim.id })
  await restarted.hear(`stage Flying aircraft ${BARON.path}`, { ms: 15_000 })
  await serve.until(() => serve.sockets === 2, "serve connecting to the restarted core", 15_000)
  const s = await serve.state((s) => s.status.in_flight && s.status.bundle.t === "loaded" && got(s, "L('BATTERY')")?.t === "value" && s.run?.entry === "battery", "the box, the bundle, and Run back", 40_000)
  assert.equal(s.window, "bench-window")
  // A core catching up puts its own changes back, a Run's among them, which the revert notice
  // would show.
  await caughtUp({ ...pm, core: restarted })
  assert.deepEqual((await ran(serve, "battery", number(1))).outcome, taken)
  const battery = async () => Number((await restarted.report()).variables.find(([n]) => n === "L:BATTERY")?.[1] ?? 0)
  await settles("the battery on the restarted core", battery, 1)
  await settles("the battery on the pilot flying's core", () => variable(pf, "L:BATTERY"), 1, 15_000)
})

/** Every name call on a watch line of `file`, and on its counting maps' lines, as `serve` sends them, each once. */
function namesOf(file: string): OpenName[] {
  const names: OpenName[] = []
  let block = ""
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const top = /^(\w+):/.exec(line)
    if (top) block = top[1]!
    const m = /^\s*(watch|inc|dec|set|count):\s*((?:L|A|B|K|H|instrument)\(.*\))\s*(?:#.*)?$/.exec(line)
    if (!m) continue
    const reads = m[1] === "count" || (m[1] === "watch" && block === "state") ? "value" : "occurrences"
    if (!names.some((n) => n.name === m[2])) names.push({ name: m[2]!, reads })
  }
  return names
}

test("the slice for the 58P's profile stays under a message's 64 KiB, and each round under a handler's 1ms", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("authoring-58p", t)
  // The tree's own 58P, which the bench's profiles' site publishes, flown with every one of its names open.
  const core = await run.core("James", net.core())
  const p: Pilot = { core, app: await app(core), name: "James", panels: onePanel(core), sim: run.stub() }
  t.after(() => p.panels.forEach((x) => x.close()))
  core.act({ act: "watch", process: p.sim.id })
  await core.hear("stage Starting aircraft none")
  core.cockpit({ act: "ready", on: true })
  await flying(p)
  const names = namesOf(path.join(ROOT, "profiles", FILE))
  assert.ok(names.length > 150, `${names.length} names`)
  const serve = await serving(t, p)
  assert.equal(await serve.open(names), null)
  await serve.state((s) => s.names.length === names.length && s.names.filter((n) => n.got.t !== "waiting").length > 100, "the names' values", 20_000)
  await sleep(2_000)
  const largest = Math.max(...serve.slices.map((x) => x.bytes))
  console.log(`budget: the slice for the 58P's ${names.length} names is at most ${largest.toLocaleString("en-US")} bytes, against ${MESSAGE_BUDGET.toLocaleString("en-US")}`)
  budget(largest < MESSAGE_BUDGET, `the slice was ${largest} bytes`)
  serve.close()
  core.send({ kind: "exit" })
  assert.equal(await core.exited, 0)
  core.checkHandlers("a run serving the 58P's names in rounds of client state")
})
