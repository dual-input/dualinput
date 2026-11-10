// State sync between bench cores on the stand-in sim: each route a control can take through the
// sim, a value's echo, the notification for a write that never lands, the guard on Ready, and a
// late joiner's catch-up, on a small profile of the scenario's own, built as a local bundle
// (record/areas/sync/05-units.md, "Cases for the bench"; record/areas/build/plan.md, "14 State
// sync").

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test, type TestContext } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { CockpitAct } from "../../../src/engines/messages/ts/bench/CockpitAct.ts"
import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import { BenchRun, type Core } from "../cores.ts"
import { BARON, load } from "../flights.ts"
import { app, BenchNetwork, host, join } from "../network.ts"
import type { FakeApp } from "../pages.ts"
import { FakeCockpitPanel } from "../panel.ts"
import { builtHashes, runBuilder } from "../profiles.ts"

/** Every kind of entry, each on a variable or event only this scenario's stand-in aircraft has. */
const PROFILE = `maker: Black Square
name: Baron 58P
maturity: experimental
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
  throttle:
    name: Throttle
    owner: pilot_flying
    watch: L('THROTTLE')
    write: L('THROTTLE')
  lamp:
    name: Lamp
    watch: L('LAMP')
    write: {toggle: K('TOGGLE_LAMP')}
  nav:
    name: Nav lights
    watch: B('LIGHTING_NAV_1')
    write: {toggle: B('LIGHTING_NAV_1_Toggle')}
  adf_bfo:
    name: ADF BFO
    watch: instrument('KR87A', 'bfoMode')
    write: {toggle: H('adf_bfo')}
events:
  ap_master:
    name: Autopilot master
    watch: K('AP_MASTER')
    write: K('AP_MASTER')
  fuel:
    name: Fuel pump press
    watch: H('FUEL')
    write: H('FUEL')
  ticker:
    name: Ticker
    watch: L('TICK')
    write: K('DO_TICK')
`

const FILE = "aircraft/bksq-baronpro.yaml"

/** A pilot: a core with the bench's network, its fake desktop app, its sim running, and one fake cockpit panel. */
type Pilot = { core: Core; app: FakeApp; name: string; panel: FakeCockpitPanel }

/** Builds the scenario's profile as a local bundle, which a session's pilot flying pins. */
function localBundle(run: BenchRun): string {
  const profiles = path.join(run.folder, "profile")
  fs.mkdirSync(path.join(profiles, "aircraft"), { recursive: true })
  fs.writeFileSync(path.join(profiles, FILE), PROFILE)
  const local = path.join(run.folder, "local-bundles")
  const built = builtHashes(runBuilder(["build", path.join(profiles, FILE), "--out", local]))
  assert.ok(built.get(FILE), "the scenario's profile built")
  return local
}

async function pilot(run: BenchRun, net: BenchNetwork, name: string, local: string, settings: Record<string, unknown> = {}): Promise<Pilot> {
  const options = net.core()
  const core = await run.core(name, { ...options, settings: { ...options.settings, "profiles.local": local, ...settings } })
  const p = { core, app: await app(core), name, panel: new FakeCockpitPanel(core, "VCockpit60", { KR87A: { bfoMode: false } }) }
  const sim = run.stub()
  core.act({ act: "watch", process: sim.id })
  await core.hear("stage Starting aircraft none")
  core.act({ act: "inputs", events: [["LIGHTING_NAV_1", 0]] })
  // The cockpit stream's test unit stands in beside state sync, so its step says it's ready.
  cockpit(p, { act: "ready", on: true })
  core.onHEvent((event) => p.panel.hEvent(event))
  return p
}

function cockpit(p: Pilot, a: CockpitAct): void {
  p.core.cockpit(a)
}

function slice(p: Pilot): SessionSlice | undefined {
  return p.app.slice<SessionSlice>("session")
}

async function until(p: Pilot, ok: (s: SessionSlice) => boolean, what: string, ms = 20_000): Promise<void> {
  await p.app.until(() => {
    const s = slice(p)
    return s !== undefined && ok(s)
  }, `${p.name}: ${what}`, ms)
}

const mine = (s: SessionSlice) => s.members.find((m) => m.pilot === s.me)

async function ready(p: Pilot, ms?: number): Promise<void> {
  await until(p, (s) => mine(s)?.in_flight === true && s.ready?.length === 0, "Ready allowed", ms)
  await p.app.ok("session.ready", { on: true })
}

/** A session `a` hosts and the others join, each in the Baron, through preflight's end. */
async function flying(a: Pilot, ...others: Pilot[]): Promise<void> {
  const code = await host(a.core, a.name)
  for (const p of others) await join(p.core, code, p.name)
  const all = [a, ...others]
  for (const p of all) await until(p, (s) => s.members.length === all.length, "every member")
  for (const p of all) await load(p.core, BARON)
  for (const p of all) await ready(p)
  for (const p of all) await until(p, (s) => s.preflight.phase === "ended", "preflight's end")
  for (const p of all) await caughtUp(p)
}

/** Waits until `p`'s catch-up and any replay have ended, after which its pilot's changes go out. */
async function caughtUp(p: Pilot, ms = 20_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < ms) {
    const after = p.core.heard().length
    cockpit(p, { act: "report" })
    const line = await p.core.hear(/^cockpit report /, { after })
    const report = JSON.parse(line.replace(/^cockpit report /, "")) as { catching_up: boolean; replaying: boolean }
    if (!report.catching_up && !report.replaying) return
    await sleep(100)
  }
  throw new Error(`${p.name} never finished catching up`)
}

/** The value of a variable on `p`'s stand-in aircraft. */
async function variable(p: Pilot, name: string): Promise<number> {
  const report = await p.core.report()
  const found = report.variables.find(([n]) => n === name)
  return found ? Number(found[1]) : 0
}

async function input(p: Pilot, name: string): Promise<number> {
  const report = await p.core.report()
  const found = report.inputs.find(([n]) => n === name)
  return found ? found[1] : 0
}

/** Polls `get` until it answers `want`. */
async function settles<T>(what: string, get: () => Promise<T>, want: T, ms = 10_000): Promise<void> {
  const started = Date.now()
  let last: T | undefined
  while (Date.now() - started < ms) {
    last = await get()
    if (last === want) return
    await sleep(50)
  }
  assert.fail(`${what}: wanted ${String(want)}, had ${String(last)}`)
}

/** How many times `p`'s stream sent a message for `key`, by the lines the test unit tells the bench. */
function sent(p: Pilot, key: string): number {
  const at = new RegExp(`^cockpit sent other ${key} `)
  return p.core.heard().filter((l) => at.test(l)).length
}

/** How many times `p` sent the client event `name`. */
async function keysSent(p: Pilot, name: string): Promise<number> {
  const calls = (await p.core.report()).calls
  const mapped = calls.find((c) => c.function === "MapClientEventToSimEvent" && c.arguments.includes(`"${name}"`))
  if (!mapped) return 0
  const id = /event: (\d+)/.exec(mapped.arguments)![1]
  return calls.filter((c) => c.function === "TransmitClientEvent" && c.unit === mapped.unit && c.arguments.includes(`event: ${id},`)).length
}

function setVariable(p: Pilot, name: string, value: number): void {
  p.core.act({ act: "set", numbers: [[name, value]], texts: [] })
}

/** Two pilots flying together, on a fresh network and the scenario's profile, with the rest of the case to run. */
async function crew(t: TestContext, name: string): Promise<{ pf: Pilot; pm: Pilot; net: BenchNetwork; run: BenchRun; local: string }> {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun(`state-sync-${name}`, t)
  const local = localBundle(run)
  const pf = await pilot(run, net, "James", local)
  const pm = await pilot(run, net, "Adam", local)
  t.after(() => {
    pf.panel.close()
    pm.panel.close()
  })
  await flying(pf, pm)
  return { pf, pm, net, run, local }
}

test("a switch flipped on one core's aircraft moves on the other's, and nothing comes back", { timeout: 120_000 }, async (t) => {
  const { pf, pm } = await crew(t, "switch")
  setVariable(pf, "L:BEACON", 1)
  await settles("the PM's beacon", () => variable(pm, "L:BEACON"), 1)
  setVariable(pm, "L:BEACON", 0)
  await settles("the PF's beacon", () => variable(pf, "L:BEACON"), 0)
  await sleep(500)
  assert.equal(sent(pf, "beacon"), 1, "the PF sent its one flip and not the echo of the PM's")
  assert.equal(sent(pm, "beacon"), 1, "the PM sent its one flip and not the echo of the PF's")
  assert.equal(await variable(pm, "L:THROTTLE"), 0)
  setVariable(pm, "L:THROTTLE", 0.5)
  await settles("the PM's own throttle, put back", () => variable(pm, "L:THROTTLE"), 0)
  assert.equal(sent(pm, "throttle"), 0, "a lever of the PF's sends nothing from the PM")
  setVariable(pf, "L:THROTTLE", 0.75)
  await settles("the PM's throttle, from the PF", () => variable(pm, "L:THROTTLE"), 0.75)
})

test("an input event is read once and then by its subscription, and written through its preset", { timeout: 120_000 }, async (t) => {
  const { pf, pm } = await crew(t, "input")
  pf.core.act({ act: "set-input", name: "LIGHTING_NAV_1", value: 1 })
  await settles("the PM's nav lights", () => input(pm, "LIGHTING_NAV_1"), 1)
  await sleep(300)
  assert.equal(sent(pm, "nav"), 0, "the preset's own report isn't sent back")
})

test("a K: event is heard through listen, and our own send of it uses up its token", { timeout: 120_000 }, async (t) => {
  const { pf, pm } = await crew(t, "key")
  pf.core.act({ act: "send-event", name: "AP_MASTER", data: 0 })
  await settles("the PM's send of the event", () => keysSent(pm, "AP_MASTER"), 1)
  await sleep(300)
  assert.equal(sent(pf, "ap_master"), 1)
  assert.equal(sent(pm, "ap_master"), 0, "the PM's own send isn't sent back")
})

test("an H: event is heard in one panel and fired through our module, and its own firing isn't sent back", { timeout: 120_000 }, async (t) => {
  const { pf, pm } = await crew(t, "h-event")
  await pf.app.until(() => pf.panel.runs("h-events"), "the PF's panel runs h-events")
  await pm.app.until(() => pm.panel.runs("h-events"), "the PM's panel runs h-events")
  const fired: string[] = []
  pm.core.onHEvent((name) => fired.push(name))
  pf.panel.hEvent("FUEL")
  await pm.app.until(() => fired.includes("FUEL"), "the PM's module fires H:FUEL")
  await sleep(300)
  assert.equal(sent(pf, "fuel"), 1)
  assert.equal(sent(pm, "fuel"), 0, "the event its write fired isn't sent back")
})

test("an instrument() value is read in its panel and written through an H: event", { timeout: 120_000 }, async (t) => {
  const { pf, pm } = await crew(t, "instrument")
  await pf.app.until(() => pf.panel.runs("instrument-reads"), "the PF's panel runs instrument-reads")
  await pm.app.until(() => pm.panel.runs("instrument-reads"), "the PM's panel runs instrument-reads")
  await sleep(600)
  const fired: string[] = []
  pm.core.onHEvent((name) => {
    fired.push(name)
    Object.assign(pm.panel.gauges.get("KR87A")!, { bfoMode: name === "adf_bfo" })
  })
  Object.assign(pf.panel.gauges.get("KR87A")!, { bfoMode: true })
  await pm.app.until(() => fired.includes("adf_bfo"), "the PM's module fires H:adf_bfo", 5_000)
  await sleep(600)
  assert.equal(fired.filter((n) => n === "adf_bfo").length, 1, "one toggle")
  assert.equal(sent(pm, "adf_bfo"), 0, "the toggle's own reading isn't sent back")
})

test("a pulse set and cleared within one frame never fires its event entry", { timeout: 120_000 }, async (t) => {
  const { pf, pm } = await crew(t, "pulse")
  pf.core.act({ act: "frames", per_second: 2 })
  await sleep(600)
  pf.core.act({ act: "set", numbers: [["L:TICK", 1]], texts: [] })
  pf.core.act({ act: "set", numbers: [["L:TICK", 0]], texts: [] })
  await sleep(1_500)
  assert.equal(sent(pf, "ticker"), 0, "the frame never saw the 1")
  pf.core.act({ act: "frames", per_second: 89 })
  setVariable(pf, "L:TICK", 1)
  await settles("the PM's send of the event", () => keysSent(pm, "DO_TICK"), 1)
  assert.equal(sent(pf, "ticker"), 1)
})

test("a press on a display that sets a variable the profile also syncs, the variable first, ends on one value", { timeout: 120_000 }, async (t) => {
  const { pf, pm } = await crew(t, "press")
  await pf.app.until(() => pf.panel.loaded() && pm.panel.loaded(), "both panels run pointer sync")
  // Each machine's own click sets the variable, as a page key's code would, so the PM's copy of
  // the press sets the value its write already put there.
  pm.panel.buttons[0]!.addEventListener("click", () => setVariable(pm, "L:BEACON", 1))
  setVariable(pf, "L:BEACON", 1)
  await pf.core.hear(/^cockpit sent other beacon /)
  pf.panel.tap(0.1, 0.1)
  await pm.app.until(() => pm.panel.events("click").length === 1, "the PM's panel plays the click")
  await settles("the PM's beacon", () => variable(pm, "L:BEACON"), 1)
  await sleep(500)
  assert.equal(sent(pm, "beacon"), 0, "a click that lands on the written value sends nothing")
  assert.equal(await variable(pf, "L:BEACON"), 1)
})

test("a toggle over a lamp the stand-in lights 2s late flips once, and shows one notification", { timeout: 120_000 }, async (t) => {
  const { pf, pm } = await crew(t, "lamp")
  pm.core.act({ act: "rule", when: { when: "sent", name: "TOGGLE_LAMP" }, after_ms: 2_000, then: { then: "set", name: "L:LAMP", value: 1 } })
  setVariable(pf, "L:LAMP", 1)
  await settles("the PM's toggle", () => keysSent(pm, "TOGGLE_LAMP"), 1)
  await pm.app.until(() => pm.app.notifications().some((n) => n.text === "Couldn't sync Lamp"), "the PM's notification", 5_000)
  const note = pm.app.notifications().find((n) => n.text === "Couldn't sync Lamp")!
  assert.equal(note.detail, "Yours may differ from James's.")
  await settles("the lamp, lit late", () => variable(pm, "L:LAMP"), 1, 5_000)
  await sleep(1_000)
  assert.equal(await keysSent(pm, "TOGGLE_LAMP"), 1, "nothing flips it a second time")
})

test("Ready is denied until 30s after Ready to fly, and allowed then", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("state-sync-ready", t)
  const local = localBundle(run)
  const pf = await pilot(run, net, "James", local, { "state-sync.settle-ms": 30_000 })
  t.after(() => pf.panel.close())
  await host(pf.core, pf.name)
  await until(pf, (s) => s.members.length === 1, "the session")
  await load(pf.core, BARON)
  const loaded = Date.now()
  await until(pf, (s) => mine(s)?.in_flight === true && (s.ready?.length ?? 0) > 0, "Ready denied")
  assert.match(slice(pf)!.ready![0]!, /settled/)
  await until(pf, (s) => s.ready?.length === 0, "Ready allowed", 40_000)
  const waited = Date.now() - loaded
  assert.ok(waited >= 28_000, `Ready opened ${waited}ms after the load`)
  console.log(`measure: Ready opened ${waited}ms after Ready to fly, against 30s`)
})

test("a late joiner catches up onto the aircraft, the battery before the APU master, and its queued copies drop", { timeout: 180_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("state-sync-late", t)
  const local = localBundle(run)
  const pf = await pilot(run, net, "James", local)
  t.after(() => pf.panel.close())
  const code = await host(pf.core, pf.name)
  await until(pf, (s) => s.members.length === 1, "the session")
  await load(pf.core, BARON)
  await ready(pf)
  await until(pf, (s) => s.preflight.phase === "ended", "preflight's end")
  setVariable(pf, "L:BATTERY", 1)
  await sleep(100)
  setVariable(pf, "L:APU", 1)
  await sleep(300)

  const pm = await pilot(run, net, "Adam", local)
  t.after(() => pm.panel.close())
  await join(pm.core, code, pm.name)
  await until(pm, (s) => s.members.length === 2, "every member")
  await load(pm.core, BARON)
  await settles("the joiner's battery", () => variable(pm, "L:BATTERY"), 1, 20_000)
  await settles("the joiner's APU master", () => variable(pm, "L:APU"), 1, 20_000)
  const calls = (await pm.core.report()).calls
  const defined = (name: string) => calls.find((c) => c.function === "AddToDataDefinition" && c.arguments.includes(`"L:${name}"`))!
  const definition = (name: string): string => /definition: (\d+)/.exec(defined(name).arguments)![1]!
  const written = (name: string): number => calls.findIndex((c) => c.function === "SetDataOnSimObject" && c.unit === defined(name).unit && c.arguments.includes(`definition: ${definition(name)},`))
  assert.ok(written("BATTERY") >= 0 && written("APU") >= 0, "both were written")
  assert.ok(written("BATTERY") < written("APU"), "the battery before the APU master")
  await caughtUp(pm)
  assert.equal(sent(pm, "battery"), 0, "the joiner sends none of its catch-up")
})
