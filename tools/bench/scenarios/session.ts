// The session: two cores, each on the stand-in sim, joined through the bench's backend and
// relay, with a fake desktop app on each sending the session crate's commands: who is in the
// flight, preflight and its hold, control's passes, leaving and quitting, a restarted core,
// the match check, and when a core exits (record/areas/session/02-units.md, "Cases for the
// bench"; record/areas/build/plan.md, "9 The session").

import assert from "node:assert/strict"
import fs from "node:fs"
import { type AddressInfo, createServer, type Socket } from "node:net"
import path from "node:path"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { Setting } from "../../../src/engines/messages/ts/clients/Setting.ts"
import type { NetSlice } from "../../../src/engines/messages/ts/net/NetSlice.ts"
import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import { BenchRun, type Core, type CoreOptions, type Stub } from "../cores.ts"
import { type Aircraft, BARON, load as loadFlight, PA24, toMenu as endFlight } from "../flights.ts"
import { app, BenchNetwork, host, join } from "../network.ts"
import { FakeApp, FakePage, fakeMenuScript } from "../pages.ts"

const FREEZES = ["IS LATITUDE LONGITUDE FREEZE ON", "IS ALTITUDE FREEZE ON", "IS ATTITUDE FREEZE ON"]

/** A pilot: a core with the bench's backend, its fake desktop app, and the stub of its sim. */
type Pilot = { core: Core; app: FakeApp; name: string; sim: Stub }

/** A pilot whose sim runs, unless `simRuns` is false, which starts it later with `startSim`. */
async function pilot(run: BenchRun, net: BenchNetwork, name: string, { settings = {}, simRuns = true }: CoreOptions & { simRuns?: boolean } = {}): Promise<Pilot> {
  const core = await run.core(name, { settings: { ...net.core().settings, ...settings } })
  const p = { core, app: await app(core), name, sim: run.stub() }
  if (simRuns) await startSim(p)
  return p
}

async function startSim(p: Pilot): Promise<void> {
  p.core.act({ act: "watch", process: p.sim.id })
  await p.core.hear("stage Starting aircraft none")
}

/** Loads a flight in `aircraft`, on the ground unless `airborne`, through to Flying. */
const load = (p: Pilot, aircraft: Aircraft, options?: Parameters<typeof loadFlight>[2]): Promise<void> => loadFlight(p.core, aircraft, options)

/** Ends the flight, as the pause menu's End flight does, to the main menu. */
const toMenu = (p: Pilot): Promise<void> => endFlight(p.core)

function slice(p: Pilot): SessionSlice {
  const s = p.app.slice<SessionSlice>("session")
  assert.ok(s, `${p.name} has no session slice yet`)
  return s
}

/** Waits until `p`'s slice shows what `ok` looks for. */
async function until(p: Pilot, ok: (s: SessionSlice) => boolean, what: string, ms = 10_000): Promise<SessionSlice> {
  await p.app.until(() => {
    const s = p.app.slice<SessionSlice>("session")
    return s !== undefined && ok(s)
  }, `${p.name}: ${what}`, ms)
  return slice(p)
}

/** This pilot's entry, which a slice from before the session starts doesn't hold. */
function me(s: SessionSlice): SessionSlice["members"][number] | undefined {
  return s.members.find((m) => m.pilot === s.me)
}

function named(s: SessionSlice, name: string): SessionSlice["members"][number] | undefined {
  return s.members.find((m) => m.name === name)
}

/** Whether the stand-in's aircraft has all three freezes on. */
async function frozen(p: Pilot): Promise<boolean> {
  const variables = new Map((await p.core.report()).variables)
  return FREEZES.every((name) => variables.get(name) === "1")
}

async function untilFrozen(p: Pilot, want: boolean, ms = 5_000): Promise<void> {
  for (const started = Date.now(); Date.now() - started < ms; await sleep(50)) if ((await frozen(p)) === want) return
  throw new Error(`${p.name}'s aircraft didn't ${want ? "freeze" : "unfreeze"} within ${ms}ms`)
}

/** Hosts on `a` and joins on `b`, and waits until each lists the other. */
async function crew(a: Pilot, b: Pilot): Promise<string> {
  const code = await host(a.core, a.name)
  await join(b.core, code, b.name)
  for (const p of [a, b]) await until(p, (s) => s.members.length === 2, "both members")
  return code
}

/** Both pilots ready, then the countdown, then preflight's end on both. */
async function ready(...pilots: Pilot[]): Promise<void> {
  for (const p of pilots) {
    await until(p, (s) => me(s)?.in_flight === true && s.ready?.length === 0, "Ready allowed")
    await p.app.ok("session.ready", { on: true })
  }
}

/** The stamp of the first log line that holds `text`, in µs on the PC's counter, which both cores read. */
function stamp(core: Core, text: string): number {
  const line = core.log().split("\n").find((l) => l.includes(text))
  assert.ok(line, `${core.data}'s log has no line with ${text}`)
  // The subscriber starts each line with the input's stamp, as `81236512µs #5512`
  // (record/areas/core/01-loop-and-edge.md, "Logging").
  const at = /^(\d+)µs/.exec(line)
  assert.ok(at, `no stamp in ${line}`)
  return Number(at[1])
}

test("a host who starts before the sim runs: the joiner sees no aircraft yet, then the session's once the host loads one", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-before-sim", t)
  const a = await pilot(run, net, "James", { simRuns: false })
  const b = await pilot(run, net, "Adam")
  await crew(a, b)
  let s = slice(b)
  assert.equal(s.preflight.aircraft, null, "the session has no aircraft before the host loads a flight")
  assert.equal(s.pf, slice(a).me, "the host flies")
  await startSim(a)
  await load(a, BARON)
  s = await until(b, (s) => s.preflight.aircraft?.path === BARON.path, "the session's aircraft")
  assert.equal(s.preflight.phase, "running")
  assert.equal(me(s)?.in_flight, false, "the joiner at the main menu is out of the flight")
})

test("a host who starts from a flight sets the aircraft at once, and preflight runs on the ground, or ends at once in the air", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-from-flight", t)
  const a = await pilot(run, net, "James")
  await load(a, BARON)
  await host(a.core, a.name)
  let s = await until(a, (s) => s.preflight.phase === "running", "preflight running")
  assert.equal(s.pf, s.me)
  assert.equal(s.preflight.aircraft?.path, BARON.path)
  await untilFrozen(a, true)

  const b = await pilot(run, net, "Adam")
  await load(b, BARON, { airborne: true })
  await host(b.core, b.name)
  s = await until(b, (s) => s.preflight.phase === "ended", "no preflight in the air")
  assert.equal(await frozen(b), false, "an aircraft in the air is never held")
})

test("a joiner in another aircraft is a member out of the flight, and enters it as a late joiner once it loads the session's aircraft", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-other-aircraft", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await load(a, BARON)
  const code = await host(a.core, a.name)
  await ready(a)
  await until(a, (s) => s.preflight.phase === "ended", "preflight's end", 10_000)
  await untilFrozen(a, false)

  await load(b, PA24, { title: "PA-24 Comanche" })
  await join(b.core, code, b.name)
  let s = await until(b, (s) => s.members.length === 2 && s.preflight.phase === "ended", "the session, after preflight")
  assert.equal(me(s)?.in_flight, false, "a joiner in another aircraft is out of the flight")
  assert.deepEqual(b.app.notifications(), [], "Join says how to get in, so the banner doesn't")
  assert.ok(!a.app.notifications().some((n) => n.text.includes("is in the")), "the crew row says where a crewmate is, so the banner doesn't")

  await toMenu(b)
  await load(b, BARON)
  s = await until(b, (s) => me(s)?.in_flight === true, "the joiner in the flight")
  assert.match(b.core.log(), /preflight ended, and the session's keys take this much/, "the late joiner raised PreflightEnded")
  assert.equal(await frozen(b), false, "a late joiner skips preflight's hold")

  await toMenu(b)
  await a.app.until(() => a.app.notifications().some((n) => n.text === "Adam left the flight" && n.once === true && n.out === true && n.detail === "They're still in the session."), "the crew hearing it once")
  await load(b, BARON)
  await a.app.until(() => a.app.notifications().some((n) => n.text === "Adam is back in the flight" && n.once === true && !n.out), "the crew hearing it's back")
})

test("a pilot flying who loads the wrong aircraft in preflight returns to the menu holding control, and the right one becomes the session's", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-wrong-aircraft", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await crew(a, b)
  await load(a, PA24)
  await until(b, (s) => s.preflight.aircraft?.path === PA24.path, "the wrong aircraft")
  await toMenu(a)
  let s = await until(b, (s) => s.preflight.aircraft === null, "no aircraft again")
  assert.equal(s.pf, slice(a).me, "the pilot flying keeps control at the menu with nobody in the flight")
  await load(a, BARON)
  s = await until(b, (s) => s.preflight.aircraft?.path === BARON.path, "the right aircraft")
  assert.equal(s.preflight.phase, "running")
})

test("a pilot flying who leaves the session in preflight, with the other at the menu, passes control, and preflight runs once the new one is in a flight", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-pf-leaves-preflight", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await crew(a, b)
  await load(a, BARON)
  await until(b, (s) => s.preflight.phase === "running", "preflight running")
  await a.app.ok("session.leave")
  await until(b, (s) => s.pf === s.me && s.members.length === 1, "control, and the leaver gone", 15_000)
  await load(b, BARON)
  // The phase waits on the sim's answer to whether the aircraft is on the ground, a moment after
  // the session has its aircraft and the pilot is in the flight.
  await until(b, (s) => me(s)?.in_flight === true && s.preflight.phase === "running", "the new pilot flying in the flight, with preflight running")
  await untilFrozen(b, true)
})

test("both pilots ready: the countdown ends preflight on both, each held until then; an un-ready inside it cancels it", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-countdown", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await crew(a, b)
  await load(a, BARON)
  await load(b, BARON)
  await until(a, (s) => s.members.every((m) => m.in_flight), "both in the flight")
  await untilFrozen(a, true)
  await untilFrozen(b, true)

  // An un-ready late in the countdown cancels it, and the flight doesn't start. The design's
  // case un-readies at 2.9s, which the slice's 50ms rounds and the trip to the pilot flying's
  // core would make a race, so this one does at 2.5s.
  await ready(a, b)
  await until(a, (s) => s.preflight.phase === "countdown", "the countdown")
  await sleep(2_500)
  await b.app.ok("session.ready", { on: false })
  await until(a, (s) => s.preflight.phase === "running", "the countdown canceled")
  await sleep(1_000)
  assert.equal(slice(a).preflight.phase, "running", "the flight started after an un-ready")
  assert.ok(await frozen(a), "the aircraft was let go with preflight still running")

  await ready(b)
  await until(a, (s) => s.preflight.phase === "ended", "preflight's end", 6_000)
  await until(b, (s) => s.preflight.phase === "ended", "preflight's end on the other core")
  await untilFrozen(a, false)
  await untilFrozen(b, false)
  // Both cores read one PC's counter, so their stamps compare.
  const ended = "preflight ended, and the session's keys take this much"
  const apart = Math.abs(stamp(a.core, ended) - stamp(b.core, ended)) / 1_000
  console.log(`budget: preflight ended on the two cores ${apart.toFixed(1)}ms apart, against one network delay`)
  assert.ok(apart < 100, `preflight ended ${apart}ms apart`)

  // The loop's stats for the whole run, which the core logs as it exits, give its slowest
  // input, the session crate's handlers among them (record/areas/core/01-loop-and-edge.md,
  // "Logging").
  for (const p of [a, b]) {
    p.core.send({ kind: "exit" })
    assert.equal(await p.core.exited, 0)
    p.core.checkHandlers(`${p.name}'s run`)
  }
})

test("a lost link during the countdown cancels it, and a ready pilot whose sim crashes comes back unready", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-countdown-lost", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await crew(a, b)
  await load(a, BARON)
  await load(b, BARON)
  // A link is lost after 5s with nothing on it, and the countdown runs 3s, so the cut comes
  // first, and the last Ready 3.5s into it, while the pilot flying still holds the link up.
  await ready(b)
  await until(a, (s) => named(s, "Adam")?.ready === true, "the other pilot ready")
  const [heardA, heardB] = [a.core.heard().length, b.core.heard().length]
  await net.relays[0]!.cut(b.core.process.pid!, 10_000)
  await sleep(3_500)
  await a.app.ok("session.ready", { on: true })
  await until(a, (s) => s.preflight.phase === "countdown", "the countdown")
  await until(a, (s) => s.preflight.phase === "running", "the countdown canceled", 5_000)
  // Each side wrote its own Ready off as it lost the link, and the other sees it once the
  // link is back.
  await a.core.hear(/^net up \S+ again=true/, { after: heardA, ms: 40_000 })
  await b.core.hear(/^net up \S+ again=true/, { after: heardB, ms: 40_000 })
  const back = await until(a, (s) => named(s, "Adam")?.ready === false, "the cut pilot back, unready")
  assert.equal(back.preflight.phase, "running")

  // A ready pilot whose sim crashes leaves the flight, so it comes back unready.
  await ready(b)
  await until(a, (s) => named(s, "Adam")?.ready === true, "the pilot ready again")
  await b.sim.kill()
  await until(a, (s) => named(s, "Adam")?.ready === false, "the crashed pilot unready", 10_000)
})

test("going without a pilot whose sim kept running ends preflight, and that pilot raises PreflightEnded on return; nobody goes without the pilot flying", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-go-without", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await crew(a, b)
  await load(a, BARON)
  await load(b, BARON)
  await ready(b)
  const refused = await b.app.command("session.go-without", { member: slice(b).pf })
  assert.match(refused ?? "", /can't go without the pilot flying/)

  await net.relays[0]!.cut(b.core.process.pid!, 20_000)
  await until(a, (s) => named(s, "Adam") !== undefined && slice(a).members.length === 2, "the member still counted")
  await sleep(6_000)
  await ready(a)
  await a.app.ok("session.go-without", { member: named(slice(a), "Adam")!.pilot })
  await until(a, (s) => s.preflight.phase === "ended", "preflight's end without the cut pilot", 8_000)
  await until(b, (s) => s.preflight.phase === "ended", "the cut pilot seeing preflight's end", 40_000)
  assert.match(b.core.log(), /preflight ended, and the session's keys take this much/, "the pilot gone without raised PreflightEnded on return")
})

test("a pilot flying who leaves the flight after preflight passes control, and the session ends once nobody is in the flight", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-nobody-flies", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await crew(a, b)
  await load(a, BARON)
  await load(b, BARON)
  await ready(a, b)
  await until(a, (s) => s.preflight.phase === "ended", "preflight's end", 6_000)
  await toMenu(a)
  const s = await until(b, (s) => s.pf === s.me, "control passing to the pilot in the flight")
  assert.equal(me(s)?.in_flight, true)
  await toMenu(b)
  for (const p of [a, b]) await until(p, (s) => !s.held, "the session ending", 10_000)
  assert.ok(!fs.existsSync(path.join(a.core.data, "session.json")), "the session file goes with the session")
})

test("a pilot flying who leaves mid-flight hands control over within 1s and is a leave, not an outage; one who quits does the same, and exits", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-pf-leaves", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await crew(a, b)
  await load(a, BARON)
  await load(b, BARON)
  await ready(a, b)
  await until(a, (s) => s.preflight.phase === "ended", "preflight's end", 6_000)
  let heard = b.core.heard().length
  const left = performance.now()
  await a.app.ok("session.leave")
  await until(b, (s) => s.pf === s.me, "control on the pilot left", 2_000)
  const handed = performance.now() - left
  console.log(`budget: control reached the other pilot ${handed.toFixed(0)}ms after the leave, against 1,000ms`)
  assert.ok(handed < 1_000, `control took ${handed.toFixed(0)}ms`)
  await b.core.hear(/^net left /, { after: heard, ms: 5_000 })
  assert.ok(!b.core.heard().slice(heard).some((l) => l.startsWith("net lost")), "a leave reached the other core as an outage")

  // b flies alone; a joins again, takes no control, and b quits.
  const c = await pilot(run, net, "Rosa")
  await join(c.core, slice(b).code!, c.name)
  await load(c, BARON)
  await until(c, (s) => me(s)?.in_flight === true, "the late joiner in the flight")
  heard = c.core.heard().length
  const quit = performance.now()
  await b.app.ok("session.quit")
  assert.equal(await b.core.exited, 0, "a quit exits with 0")
  const quitMs = performance.now() - quit
  assert.ok(quitMs < 3_000, `the quit took ${quitMs.toFixed(0)}ms to exit, against 3s`)
  // That a leave stops the other core's dials, and tells the backend, the network crate's own
  // tests hold: a_close_with_leaves_code_is_a_leave_and_any_other_a_lost_link and
  // a_joiner_lists_itself_at_its_first_link_up_and_tells_the_backend_it_left.
  await c.core.hear(/^net left /, { after: heard, ms: 5_000 })
  await until(c, (s) => s.pf === s.me, "control on the pilot left", 3_000)
})

test("a restarted core with a session file comes back under a higher restart count, announces the session, and passes control it held before it enters the flight", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-restart", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await crew(a, b)
  await load(a, BARON)
  await load(b, BARON)
  await ready(a, b)
  await until(a, (s) => s.preflight.phase === "ended", "preflight's end", 6_000)

  // The core crashes while its sim flies on: the next stand-in's sim already holds the
  // aircraft, which the AircraftLoaded state answers with, and the menu script's master page
  // takes the core from Starting to Flying.
  await a.core.kill()
  const restarted = await run.core("James", net.core())
  restarted.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "aircraft-loaded", path: BARON.cfg } }] })
  await sleep(100)
  const menu = fakeMenuScript(restarted, "in-game")
  t.after(() => menu.close())
  restarted.act({ act: "watch", process: a.sim.id })
  await restarted.hear(`stage Flying aircraft ${BARON.path}`, { ms: 15_000 })
  const s = await until(b, (s) => s.pf === s.me, "control passing from the restarted core", 30_000)
  assert.equal(s.members.length, 2)
  const log = restarted.log()
  assert.match(log, /the core found a session file, so it comes back to the session code=\S+ restart=1/)
  assert.match(log, /the core announces that a session started/)
  const passed = log.indexOf("this core restarted holding control, so it passed control on")
  const entered = log.indexOf("a member entered the flight")
  assert.ok(passed >= 0 && (entered < 0 || passed < entered), "the restarted core passed control before it entered the flight")
})

test("the match check: a streamed copy against an installed one is a warning, and two streamed copies show nothing", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-match", t)
  // One pilot's packages folder holds the Baron in Community, and the other's holds nothing,
  // so the Baron there counts as streamed.
  const userCfg = (name: string, withBaron: boolean): string => {
    const packages = path.join(run.folder, `${name}-packages`)
    if (withBaron) {
      const pkg = path.join(packages, "Community", "bksq-aircraft-baronpro")
      fs.mkdirSync(path.join(pkg, "SimObjects", "Airplanes", BARON.path), { recursive: true })
      fs.writeFileSync(path.join(pkg, "manifest.json"), JSON.stringify({ package_version: "0.1.1" }))
    } else {
      fs.mkdirSync(path.join(packages, "Community"), { recursive: true })
    }
    const cfg = path.join(run.folder, `${name}-UserCfg.opt`)
    fs.writeFileSync(cfg, `Version 1\r\nInstalledPackagesPath "${packages}"\r\n`)
    return cfg
  }
  const a = await pilot(run, net, "James", { settings: { "sim.user-cfg": userCfg("James", true) } })
  const b = await pilot(run, net, "Adam", { settings: { "sim.user-cfg": userCfg("Adam", false) } })
  await crew(a, b)
  await load(a, BARON)
  await load(b, BARON)
  const s = await until(a, (s) => s.differences.some((d) => d.item === 2), "the version's difference")
  const version = s.differences.find((d) => d.item === 2)!
  assert.equal(version.level, "warning")
  assert.match(version.words, /keeps no version Dual Input can read/)
  assert.equal(version.note, "The two copies may differ and some controls may not sync")
  assert.ok(!s.differences.some((d) => d.item === 3), "the same livery shows no difference")

  const c = await pilot(run, net, "Rosa", { settings: { "sim.user-cfg": userCfg("Rosa", false) } })
  const d = await pilot(run, net, "Sam", { settings: { "sim.user-cfg": userCfg("Sam", false) } })
  await crew(c, d)
  await load(c, BARON)
  await load(d, BARON)
  await until(c, (s) => s.members.every((m) => m.in_flight), "both in the flight")
  await sleep(1_000)
  assert.deepEqual(slice(c).differences, [], "two streamed copies show nothing")
})

test("a connection made in the main menu reaches Menu, and one made in a flight reaches Flying with the state's aircraft, by the menu script's master page", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("session-master-page", t)
  const a = await run.core("a")
  const menu = fakeMenuScript(a, "main")
  t.after(() => menu.close())
  a.act({ act: "watch", process: run.stub().id })
  await a.hear("stage Menu aircraft none", { ms: 10_000 })

  const b = await run.core("b")
  b.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "aircraft-loaded", path: BARON.cfg } }] })
  await sleep(100)
  const flying = fakeMenuScript(b, "in-game")
  t.after(() => flying.close())
  b.act({ act: "watch", process: run.stub().id })
  await b.hear(`stage Flying aircraft ${BARON.path}`, { ms: 10_000 })
  await sleep(1_000)
  assert.equal(b.heard().filter((l) => l.startsWith("stage Flying")).length, 1, "one SimChanged for the load the core found")
})

test("a quit sent from the EFB app's socket takes effect, and a core with no session and no desktop app exits once its sim closes", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("session-quit-exit", t)
  const a = await run.core("a")
  a.act({ act: "watch", process: run.stub().id })
  await a.hear("stage Starting aircraft none")
  const efb = new FakePage(a, { component: "efb-app" })
  t.after(() => efb.close())
  await efb.until(() => efb.client.connected, "the EFB app connecting")
  await efb.client.command("session.quit", null)
  assert.equal(await a.exited, 0, "a quit exits with 0")
  await efb.until(() => efb.client.state === "quit", "the EFB app hearing the core's bye")

  const b = await run.core("b")
  b.act({ act: "watch", process: run.stub().id })
  await b.hear("stage Starting aircraft none")
  b.act({ act: "quit" })
  assert.equal(await b.exited, 0, "the core exits with 0 once its sim closed with no session")
  assert.match(b.log(), /the sim closed and no session is held, so the core exits/)
})

test("a module from another build while Hold is fed raises the sim service's trouble notification for our package", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-hold-package", t)
  const a = await pilot(run, net, "James")
  await load(a, BARON)
  a.core.act({ act: "module-from", slots_hash: "1" })
  await a.core.hear("module Differs")
  await sleep(500)
  assert.ok(!a.app.notifications().some((n) => n.id === "sim-service.package"), "no routine is fed yet, so no notification")
  await host(a.core, a.name)
  await a.app.until(() => a.app.notifications().some((n) => n.id === "sim-service.package"), "the package's trouble notification")
})

test("the settings command refuses a display name over 20 characters from any app", { timeout: 30_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-name-limit", t)
  const core = await run.core("a", net.core())
  const efb = await FakeApp.open(core, ["settings"], "efb-app")
  t.after(() => efb.close())
  const set = (value: string): Promise<string | null> => efb.command("clients.set-setting", { key: "session.name", value })
  const name = (): Setting | undefined => efb.slice<Setting[]>("settings")?.find((s) => s.key === "session.name")
  await efb.until(() => name() !== undefined, "the settings' slice")
  assert.deepEqual(name()!.kind, { type: "limited-text", max: 20 })
  // Twenty characters of two bytes each, since the limit counts characters.
  const longest = "İ".repeat(20)
  assert.equal(await set(longest), null)
  await efb.until(() => name()!.value === longest, "the 20-character name in the slice")
  assert.match((await set("x".repeat(21))) ?? "", /doesn't fit session\.name/)
  await sleep(200)
  assert.equal(name()!.value, longest, "the refused name changed nothing")
})

/** A port on 127.0.0.1 nothing listens on, which refuses a fetch at once. */
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  await new Promise((resolve) => server.close(resolve))
  return port
}

test("a wrong code shows why in the slice, and the next attempt clears it", { timeout: 60_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-refused", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await join(b.core, "ZZZZZZ", b.name)
  const s = await until(b, (s) => s.refused !== null, "the refusal")
  assert.deepEqual(s.refused, { on: "join", why: "no-code" })
  assert.equal(s.attempt, null)
  assert.equal(b.app.notifications().length, 0, "a refusal raises no notification")
  assert.match((await b.app.command("session.copy-code")) ?? "", /There's no session/)

  const code = await host(a.core, a.name)
  await join(b.core, code, b.name)
  await until(b, (s) => s.held && s.refused === null && s.attempt === null, "the session, with the refusal gone")
})

test("a join reaching the crew is an attempt until its first link, and a cancel stops it on this PC alone", { timeout: 60_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-cancel-dialing", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  const code = await host(a.core, a.name)

  await net.relays[0]!.cut(b.core.process.pid!, 60_000)
  await join(b.core, code, b.name)
  const dialing = await until(b, (s) => s.attempt?.dialing === true, "the join dialing")
  assert.equal(dialing.attempt!.on, "join")
  assert.equal(dialing.held, false, "the slice says no session is held until the first link")
  await b.app.ok("session.cancel")
  await until(b, (s) => s.attempt === null && !s.held, "the attempt stopped")
  assert.equal(slice(b).refused, null)
  await net.relays[0]!.cut(b.core.process.pid!, 0)
  await sleep(1_000)
  assert.equal(slice(a).members.length, 1, "the host heard of nothing")
  assert.match((await b.app.command("session.cancel")) ?? "", /No Host or Join is running/)

  // A canceled join leaves nothing that stops the next attempt.
  await join(b.core, code, b.name)
  await until(b, (s) => s.held && s.members.length === 2, "the next join's session")
})

test("a cancel stops an attempt waiting on the backend", { timeout: 30_000 }, async (t) => {
  // A backend that takes the connection and never answers.
  const silent = createServer()
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve))
  t.after(() => silent.close())
  const sockets: Socket[] = []
  silent.on("connection", (socket) => sockets.push(socket))
  t.after(() => sockets.forEach((socket) => socket.destroy()))
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-cancel-asking", t)
  const a = await pilot(run, net, "James", { settings: { "network.backend": `http://127.0.0.1:${(silent.address() as AddressInfo).port}` } })
  await a.app.ok("clients.set-setting", { key: "session.name", value: a.name })
  await a.app.ok("session.host")
  const asking = await until(a, (s) => s.attempt !== null, "the attempt")
  assert.deepEqual(asking.attempt, { on: "host", dialing: false, code: null })
  await a.app.ok("session.cancel")
  await until(a, (s) => s.attempt === null, "the attempt stopped")
  assert.equal(slice(a).refused, null)
})

test("no answer from the backend is our servers while a relay answers, and this PC offline while nothing does", { timeout: 60_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-offline", t)
  const down = `http://127.0.0.1:${await closedPort()}`
  const reach = async (p: Pilot, want: Partial<NetSlice>): Promise<void> => {
    const watching = await FakeApp.open(p.core, ["network"])
    t.after(() => watching.close())
    await watching.until(() => {
      const s = watching.slice<NetSlice>("network")
      return s?.internet === want.internet && s?.servers === want.servers
    }, `${p.name}: the network's slice saying ${JSON.stringify(want)}`)
  }
  const refusal = async (p: Pilot): Promise<SessionSlice["refused"]> => {
    await p.app.ok("clients.set-setting", { key: "session.name", value: p.name })
    await p.app.ok("session.host")
    return (await until(p, (s) => s.refused !== null, "the refusal", 15_000)).refused
  }

  const up = await pilot(run, net, "Rosa")
  await reach(up, { internet: true, servers: "reachable" })

  const servers = await pilot(run, net, "James", { settings: { "network.backend": down } })
  await reach(servers, { internet: true, servers: "unreachable" })
  assert.deepEqual(await refusal(servers), { on: "host", why: "servers" })

  const offline = await pilot(run, net, "Adam", { settings: { "network.backend": down, "network.relays": [{ url: down, token: "t", cap: 1 }] } })
  await reach(offline, { internet: false, servers: "unreachable" })
  assert.deepEqual(await refusal(offline), { on: "host", why: "offline" })
})

test("a join another core refuses stops, and says why in the words of the backend's refusal", { timeout: 60_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-refused-connection", t)
  const a = await pilot(run, net, "James")
  const code = await host(a.core, a.name)

  // A core back from a session file naming another code answers to that one, while the backend
  // still lists it under the first, so a joiner finds it and the two refuse each other.
  await a.core.kill()
  const file = path.join(a.core.data, "session.json")
  const saved = JSON.parse(fs.readFileSync(file, "utf8")) as { code: string }
  fs.writeFileSync(file, JSON.stringify({ ...saved, code: "ZZZZZZ" }, null, 2))
  await run.core(a.name, net.core())

  const b = await pilot(run, net, "Adam")
  await join(b.core, code, b.name)
  const s = await until(b, (s) => s.refused !== null, "the refusal", 20_000)
  assert.deepEqual(s.refused, { on: "join", why: "no-code" })
  assert.equal(s.attempt, null, "the join stopped")
  assert.equal(s.held, false, "the core let the session go")
  assert.deepEqual(b.app.notifications(), [], "the start card says it, so the banner doesn't")
})

test("a Host whose connection won't open never starts, says why, and leaves no session to find", { timeout: 60_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("session-no-connection", t)
  // An address that doesn't read is the one way a bench core's endpoint fails to bind.
  const a = await pilot(run, net, "James", { settings: { "network.relays": [{ url: "not a url", token: "t", cap: 1 }] } })
  await a.app.ok("clients.set-setting", { key: "session.name", value: a.name })
  await a.app.ok("session.host")
  const s = await until(a, (s) => s.refused !== null, "the refusal", 15_000)
  assert.deepEqual(s.refused, { on: "host", why: "no-connection" })
  assert.equal(s.attempt, null, "the Host stopped")
  assert.equal(s.held, false, "the slice never showed a session")
  assert.deepEqual(a.app.notifications(), [], "the start card says it, so the banner and the header don't")

  const code = /the session started with its code code="(\w+)"/.exec(a.core.log())?.[1]
  assert.ok(code, "the backend gave a code")
  await sleep(1_000)
  const b = await pilot(run, net, "Adam")
  await join(b.core, code, b.name)
  const looked = await until(b, (s) => s.refused !== null, "the joiner's refusal")
  assert.deepEqual(looked.refused, { on: "join", why: "no-code" }, "the failed Host told the backend to drop its code")
})
