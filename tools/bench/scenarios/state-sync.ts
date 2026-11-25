// State sync between bench cores on the stand-in sim: each route a control can take through the
// sim, a value's echo, the notification for a write that never lands, the guard on Ready, and the
// catch-ups of a late joiner and of a crew at preflight's end, on a small profile of the
// scenario's own, built as a local bundle
// (record/areas/sync/05-units.md, "Cases for the bench").

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
  throttle:
    name: Throttle
    owner: pilot_flying
    watch: L('THROTTLE')
    write: L('THROTTLE')
  trim:
    name: Trim
    owner: pilot_flying
    watch: L('TRIM')
    write: K('SET_TRIM')
  lamp:
    name: Lamp
    watch: L('LAMP')
    write:
      toggle: K('TOGGLE_LAMP')
  nav:
    name: Nav lights
    watch: B('LIGHTING_NAV_1')
    write:
      toggle: B('LIGHTING_NAV_1_Toggle')
  adf_bfo:
    name: ADF BFO
    watch: instrument('KR87A', 'bfoMode')
    write:
      toggle: H('adf_bfo')
  alt_hold:
    name: Altitude hold
    watch: L('ALT_HOLD')
    write: |
      (value) => {
        if (value == state.alt_hold) return
        write(value ? K('AP_ALT_HOLD') : K('AP_PITCH_LEVELER_ON'))
      }
  vs_hold:
    name: Vertical speed mode
    watch: L('VS_HOLD')
    write:
      toggle: K('AP_PANEL_VS_HOLD', 1)
  com1:
    name: COM 1 frequency
    watch: A('COM ACTIVE FREQUENCY:1', 'Hz')
    write: K('COM_RADIO_SET_HZ')
  altimeter:
    name: Altimeter
    watch: L('ALTIMETER')
    write: B('ALTIMETER_Set')
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

/** How many times `p` sent the client event `name` with `data` as its value. */
async function keysSentWith(p: Pilot, name: string, data: number): Promise<number> {
  const calls = (await p.core.report()).calls
  const mapped = calls.find((c) => c.function === "MapClientEventToSimEvent" && c.arguments.includes(`"${name}"`))
  if (!mapped) return 0
  const id = /event: (\d+)/.exec(mapped.arguments)![1]
  const value = new RegExp(`data: ${data}\\b`)
  return calls.filter((c) => c.function === "TransmitClientEvent" && c.unit === mapped.unit && c.arguments.includes(`event: ${id},`) && value.test(c.arguments)).length
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
  // The PM's core holds its write pending until it reads the beacon back, and until then takes
  // a reading of 0 for the switch not having moved yet. A pilot flips it back only after seeing
  // it move, so the PM waits too. On a GitHub runner, a flip the stand-in sim took before the
  // PM's core read the 1 counted as the write never landing (record/areas/build/log.md,
  // 2026-11-21).
  await sleep(500)
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

test("a following machine never flags what the PF owns, and writes it at the old PF's last value as it takes control", { timeout: 120_000 }, async (t) => {
  const { pf, pm } = await crew(t, "take-over")
  // The stand-in takes no K:SET_TRIM, so the pilot monitoring's trim stays where its own systems
  // hold it, as a following 58P's autopilot held its trim against every write in the sim
  // (measured on MSFS 2024, record/areas/sync/log.md, "2026-11-12: In the first flight with
  // friends 14 of state sync's writes read another value 1.5s later, 11 on the following
  // machine, the elevator trim and autopilot modes among them").
  setVariable(pf, "L:TRIM", 5)
  await settles("the PM's write of the PF's trim", () => keysSentWith(pm, "SET_TRIM", 5), 1)
  await sleep(2_000)
  assert.doesNotMatch(pm.core.log(), /a write never landed entry="trim"/, "the PM's own systems moving the PF's trim isn't flagged")
  cockpit(pm, { act: "take-control" })
  await until(pm, (s) => s.pf === s.me, "the PM flies")
  await settles("the new PF's write of the old PF's trim", () => keysSentWith(pm, "SET_TRIM", 5), 2)
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
  // Each machine's own click sets the variable, as a page key's code would, so the pilot
  // monitoring's copy of the press sets the value its write already put there.
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

test("altitude hold and vertical speed mode changed in one frame leave the other machine in altitude hold, and nothing comes back", { timeout: 120_000 }, async (t) => {
  const { pf, pm } = await crew(t, "coupled")
  // The pilot monitoring's autopilot as the 58P's KFC 150 has it: altitude hold's event turns
  // vertical speed mode off, and vertical speed mode's turns altitude hold off, each in the order
  // sent (record/areas/sync/log.md, "2026-11-19: No route showed an autopilot event's effect in
  // the frame it was sent, so a guard in the sim reads the old mode, and the events of one frame
  // apply in the order sent").
  const rule = (event: string, then: { then: "flip"; name: string } | { then: "set"; name: string; value: number }) =>
    pm.core.act({ act: "rule", when: { when: "sent", name: event }, after_ms: 0, then })
  rule("AP_ALT_HOLD", { then: "flip", name: "L:ALT_HOLD" })
  rule("AP_ALT_HOLD", { then: "set", name: "L:VS_HOLD", value: 0 })
  rule("AP_PANEL_VS_HOLD", { then: "flip", name: "L:VS_HOLD" })
  rule("AP_PANEL_VS_HOLD", { then: "set", name: "L:ALT_HOLD", value: 0 })
  rule("AP_PITCH_LEVELER_ON", { then: "set", name: "L:ALT_HOLD", value: 0 })
  setVariable(pf, "L:VS_HOLD", 1)
  await settles("the PM's vertical speed mode", () => variable(pm, "L:VS_HOLD"), 1)
  await sleep(500)
  // The pilot flying presses ALT: its autopilot turns altitude hold on and vertical speed mode
  // off in one frame, and both changes reach the pilot monitoring together.
  pf.core.act({ act: "set", numbers: [["L:ALT_HOLD", 1], ["L:VS_HOLD", 0]], texts: [] })
  await settles("the PM's altitude hold", () => variable(pm, "L:ALT_HOLD"), 1)
  await sleep(2_000)
  assert.equal(await variable(pm, "L:VS_HOLD"), 0, "the PM's vertical speed mode stays off")
  assert.equal(await variable(pm, "L:ALT_HOLD"), 1, "the PM's altitude hold stays on")
  assert.equal(await keysSent(pm, "AP_PANEL_VS_HOLD"), 1, "the PM toggled vertical speed mode once, to engage it")
  assert.equal(sent(pm, "vs_hold") + sent(pm, "alt_hold"), 0, "the modes the PM's own autopilot changed don't go back")
  assert.doesNotMatch(pm.core.log(), /a write never landed/, "every write landed")
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

test("a pilot monitoring whose cockpit differs from the pilot flying's as preflight ends catches up on every route within 5s, and every write lands", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("state-sync-differs", t)
  const local = localBundle(run)
  const pf = await pilot(run, net, "James", local)
  const pm = await pilot(run, net, "Adam", local)
  t.after(() => {
    pf.panel.close()
    pm.panel.close()
  })
  // Two stand-ins start alike, so a crew's catch-up at preflight's end writes nothing unless the
  // pilot flying's aircraft loads holding values the pilot monitoring's doesn't. These make it
  // write an entry on each route: a value through an L: variable, a K: event, and a preset, a
  // toggle through a K: event, a preset, and an H: event, and a write function.
  pf.core.act({ act: "set", numbers: [["L:BATTERY", 1], ["L:BEACON", 1], ["A:COM ACTIVE FREQUENCY:1", 118_300_000], ["L:ALTIMETER", 1013.25], ["L:LAMP", 1], ["L:ALT_HOLD", 1]], texts: [] })
  pf.core.act({ act: "inputs", events: [["LIGHTING_NAV_1", 1]] })
  Object.assign(pf.panel.gauges.get("KR87A")!, { bfoMode: true })
  // The pilot monitoring's aircraft takes each write, as the sim's would.
  const rule = (when: { when: "sent" | "fired"; name: string }, then: { then: "set"; name: string; value: number | null } | { then: "flip"; name: string }) =>
    pm.core.act({ act: "rule", when, after_ms: 0, then })
  rule({ when: "sent", name: "COM_RADIO_SET_HZ" }, { then: "set", name: "A:COM ACTIVE FREQUENCY:1", value: null })
  rule({ when: "fired", name: "ALTIMETER_Set" }, { then: "set", name: "L:ALTIMETER", value: null })
  rule({ when: "sent", name: "TOGGLE_LAMP" }, { then: "flip", name: "L:LAMP" })
  rule({ when: "sent", name: "AP_ALT_HOLD" }, { then: "set", name: "L:ALT_HOLD", value: 1 })
  pm.core.onHEvent((name) => {
    if (name === "adf_bfo") Object.assign(pm.panel.gauges.get("KR87A")!, { bfoMode: true })
  })

  const code = await host(pf.core, pf.name)
  await join(pm.core, code, pm.name)
  for (const p of [pf, pm]) await until(p, (s) => s.members.length === 2, "every member")
  for (const p of [pf, pm]) await load(p.core, BARON)
  for (const p of [pf, pm]) await ready(p)
  await until(pm, (s) => s.preflight.phase === "ended", "preflight's end")
  const ended = Date.now()
  await caughtUp(pm, 5_000)
  console.log(`measure: the pilot monitoring's catch-up ended ${Date.now() - ended}ms after preflight's end`)
  // The catch-up ends once its writes are sent, and a write lands a few of the stand-in's frames
  // later, after the rule above answers it, so the values are waited for.
  await settles("the PM's battery", () => variable(pm, "L:BATTERY"), 1)
  await settles("the PM's beacon", () => variable(pm, "L:BEACON"), 1)
  await settles("the PM's COM 1", () => variable(pm, "COM ACTIVE FREQUENCY:1"), 118_300_000)
  await settles("the PM's altimeter", () => variable(pm, "L:ALTIMETER"), 1013.25)
  await settles("the PM's lamp", () => variable(pm, "L:LAMP"), 1)
  await settles("the PM's altitude hold", () => variable(pm, "L:ALT_HOLD"), 1)
  await settles("the PM's nav lights", () => input(pm, "LIGHTING_NAV_1"), 1)
  await settles("the PM's ADF BFO", async () => (pm.panel.gauges.get("KR87A") as unknown as { bfoMode: boolean }).bfoMode, true)
  assert.doesNotMatch(pm.core.log(), /a write never landed/, "every write landed")
})
