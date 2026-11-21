// Traffic between bench cores in a session in the Baron 58P: the traffic host's stand-in holds AI
// traffic, as an ATC app's would, and the other core's stand-in shows each object as a frozen
// copy, which its `Traffic`, run natively, draws 1s behind the host's reads
// (record/areas/traffic-atc/01-traffic-and-atc.md, "Cases for the bench").

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test, type TestContext } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { AiObject } from "../../../src/engines/messages/ts/bench/AiObject.ts"
import type { Made } from "../../../src/engines/messages/ts/bench/Made.ts"
import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import type { TrafficSlice } from "../../../src/engines/messages/ts/traffic/TrafficSlice.ts"
import { userCfgText } from "../aircraft.ts"
import { budget } from "../budgets.ts"
import { BenchRun, type Core } from "../cores.ts"
import { BARON, load, toMenu } from "../flights.ts"
import { app, BenchNetwork, host, join } from "../network.ts"
import { FakeApp } from "../pages.ts"

/** The role's label, as traffic registers it, by which a scenario finds its key in the session's slice. */
const TRAFFIC = "Share my traffic"

/** Where the AI traffic stands: EGLL's apron, each object 10m north of the one before. */
const BASE = { lat: 51.47, lon: -0.46 }
const METERS_NORTH = 111_195
/** 20 kt, a taxiing aircraft's speed, in feet a second and in meters a second. */
const TAXI_FT = 33.76
const TAXI = TAXI_FT * 0.3048
/** How far behind the traffic host's reads a copy is drawn, in seconds. */
const DELAY = 1
/** Traffic's identities' channel, as `IDENTITIES` in src/engines/messages/src/traffic.rs numbers it. */
const IDENTITIES = 7
/** How long the identity case holds them, in ms. */
const HOLD_MS = 3_000

type Pilot = { core: Core; app: FakeApp; traffic: FakeApp; name: string }

async function pilot(run: BenchRun, net: BenchNetwork, name: string, settings: Record<string, unknown> = {}): Promise<Pilot> {
  const core = await run.core(name, { settings: { ...net.core().settings, ...settings } })
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  return { core, app: await app(core), traffic: await FakeApp.open(core, ["traffic"]), name }
}

function slice(p: Pilot): SessionSlice {
  return p.app.slice<SessionSlice>("session")!
}

async function until(p: Pilot, ok: (s: SessionSlice) => boolean, what: string, ms = 15_000): Promise<void> {
  await p.app.until(() => {
    const s = p.app.slice<SessionSlice>("session")
    return s !== undefined && ok(s)
  }, `${p.name}: ${what}`, ms)
}

const mine = (s: SessionSlice) => s.members.find((m) => m.pilot === s.me)

/** A session `a` hosts and the others join, each in the flight. */
async function flying(a: Pilot, ...others: Pilot[]): Promise<void> {
  const code = await host(a.core, a.name)
  for (const p of others) await join(p.core, code, p.name)
  for (const p of [a, ...others]) await until(p, (s) => s.members.length === others.length + 1, "every member")
  for (const p of [a, ...others]) await inFlight(p)
}

async function inFlight(p: Pilot): Promise<void> {
  await load(p.core, BARON)
  await until(p, (s) => mine(s)?.in_flight === true, "in the flight")
}

/** Turns `p`'s Share my traffic on or off, as the Traffic tab's switch does, and waits until the key says so. */
async function share(p: Pilot, on = true): Promise<void> {
  await until(p, (s) => s.roles.some((r) => r.label === TRAFFIC), "traffic's role")
  const key = slice(p).roles.find((r) => r.label === TRAFFIC)!.key
  await p.app.ok("session.share", { key, on })
  await until(p, (s) => (s.roles.find((r) => r.key === key)?.holder === s.me) === on, on ? "holding traffic's key" : "not holding traffic's key")
}

/** An AI aircraft of `p`'s sim, the `n`th of its traffic, standing at `BASE`, or moving north at 20 kt. */
function aircraft(id: number, n: number, { moving = false, kind = "aircraft" as AiObject["kind"], title = `FSLTL_FAIB_B738_${n}` } = {}): AiObject {
  return {
    id,
    kind,
    numbers: [
      ["A:PLANE LATITUDE", BASE.lat + (n * 10) / METERS_NORTH],
      ["A:PLANE LONGITUDE", BASE.lon],
      ["A:PLANE ALTITUDE", 83],
      ["A:PLANE HEADING DEGREES TRUE", 0],
      ["A:SIM ON GROUND", 1],
      ["A:GEAR HANDLE POSITION", 100],
      ["A:LIGHT NAV", 1],
      ["A:LIGHT BEACON", moving ? 1 : 0],
      ["A:TRAILING EDGE FLAPS LEFT PERCENT", moving ? 20 : 0],
      ["A:NUMBER OF ENGINES", 2],
      ["A:GENERAL ENG COMBUSTION:1", moving ? 1 : 0],
      ["A:GENERAL ENG COMBUSTION:2", moving ? 1 : 0],
      ["A:VELOCITY BODY Z", moving ? TAXI_FT : 0],
    ],
    texts: [
      ["A:TITLE", title],
      ["A:ATC ID", `N${100 + n}`],
      ["A:ATC AIRLINE", "United"],
      ["A:ATC FLIGHT NUMBER", String(n)],
    ],
  }
}

/** A ground object of the sim's, such as a GSX sign or a pushback tug. */
function ground(id: number, n: number, title: string): AiObject {
  return { id, kind: "ground", numbers: [["A:PLANE LATITUDE", BASE.lat - (n * 2) / METERS_NORTH], ["A:PLANE LONGITUDE", BASE.lon + 0.001]], texts: [["A:TITLE", title]] }
}

/** Puts `objects` in `p`'s sim, in acts of up to 100, so no line of the bench's socket runs long. */
function put(p: Pilot, objects: AiObject[]): void {
  for (let at = 0; at < objects.length; at += 100) p.core.act({ act: "ai", objects: objects.slice(at, at + 100) })
}

/** The copies `p`'s sim shows, which leaves out every object of ours, such as a figure. */
async function copies(p: Pilot): Promise<Made[]> {
  return (await p.core.report()).objects.filter((o) => !o.title.startsWith("DUALINPUT_"))
}

const variable = (o: Made, name: string) => Number(new Map(o.variables).get(name) ?? NaN)

/** How far north of `BASE` a copy is drawn, in meters. */
const north = (o: Made) => (variable(o, "PLANE LATITUDE") - BASE.lat) * METERS_NORTH

/**
 * How many seconds the copy titled `title` trails the `n`th aircraft, which has taxied north at 20 kt
 * since `since`, a time on the PC's clock: the stand-in moves it each frame by its velocity, so where it
 * is follows from the time, which the copies' read just before gives.
 */
function trailing(shown: Made[], title: string, n: number, since: number): number {
  const original = n * 10 + (TAXI * (Date.now() - since)) / 1e3
  return (original - north(shown.find((c) => c.title === title)!)) / TAXI
}

/** Whether every copy in `shown` is drawn: a copy has no position in the stand-in's sim until `Traffic` writes one. */
const drawn = (shown: Made[]) => shown.every((c) => Number.isFinite(variable(c, "PLANE LATITUDE")))

/** Waits until `p`'s copies are ones `ok` takes, and returns them. */
async function untilCopies(p: Pilot, ok: (copies: Made[]) => boolean, what: string, ms = 15_000): Promise<Made[]> {
  const started = Date.now()
  for (;;) {
    const now = await copies(p)
    if (ok(now)) return now
    if (Date.now() - started > ms) throw new Error(`${p.name}: ${what} didn't happen within ${ms}ms; ${now.length} copies`)
    await sleep(100)
  }
}

function trafficSlice(p: Pilot): TrafficSlice | undefined {
  return p.traffic.slice<TrafficSlice>("traffic")
}

test("a traffic host's AI aircraft and tugs show on the other core as frozen, dressed copies 1s behind, its GSX signs and our own objects never do, and a poll that isn't whole sends nothing as gone", { timeout: 240_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("traffic", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  // 130 aircraft, 10 of them taxiing, a helicopter, 20 tugs, 700 GSX signs, and one object of ours, as at EGLL within 1km (measured on MSFS 2024, record/areas/traffic-atc/log.md, "2026-10-17: FS Copilot's code holds the traffic and ATC mechanisms 6.14 carries over, p10's ground objects at EGLL were GSX's gate signs and the sim's pushback tugs, and SayIntentions' program is SayIntentionsAI").
  const fleet = Array.from({ length: 130 }, (_, n) => aircraft(0x10_000 + n, n, { moving: n < 10 }))
  fleet.push(aircraft(0x10_200, 200, { kind: "helicopter", title: "Asobo Bell 407" }))
  const grounds = [
    ...Array.from({ length: 20 }, (_, n) => ground(0x20_000 + n, n, "ASO_Pushback_White")),
    ...Array.from({ length: 700 }, (_, n) => ground(0x30_000 + n, n, "FSDT_GSX_Font_BLED_VGDS_small_yellow")),
    ground(0x40_000, 0, "DUALINPUT_FIGURE_PILOT"),
  ]
  put(a, [...fleet, ...grounds])
  const moving = Date.now()
  await flying(a, b)
  await share(a)

  const shown = await untilCopies(b, (c) => c.length === 151 && drawn(c), "151 copies drawn, the aircraft, the helicopter, and the tugs")
  const titles = new Set(shown.map((c) => c.title))
  assert.ok(!titles.has("FSDT_GSX_Font_BLED_VGDS_small_yellow"), "no GSX sign is carried")
  assert.equal(shown.filter((c) => c.title === "ASO_Pushback_White").length, 20, "every tug is")
  assert.ok(titles.has("Asobo Bell 407"), "and the helicopter")
  // Released and frozen, each copy reads all three freezes on, and an aircraft's copy is dressed as its original: its tail, its lights, its flaps, and its engines.
  const parked = shown.find((c) => c.title === "FSLTL_FAIB_B738_50")!
  const mover = shown.find((c) => c.title === "FSLTL_FAIB_B738_5")!
  for (const c of [parked, mover]) {
    for (const freeze of ["IS LATITUDE LONGITUDE FREEZE ON", "IS ALTITUDE FREEZE ON", "IS ATTITUDE FREEZE ON"]) assert.equal(variable(c, freeze), 1, `${c.title}'s ${freeze}`)
  }
  assert.equal(new Map(parked.variables).get("ATC ID"), "N150", "the copy takes its original's tail")
  assert.deepEqual([variable(parked, "LIGHT NAV"), variable(parked, "LIGHT BEACON"), variable(parked, "GENERAL ENG COMBUSTION:1")], [1, 0, 0], "a parked copy's engines are off, and its nav light on")
  assert.deepEqual([variable(mover, "LIGHT BEACON"), variable(mover, "TRAILING EDGE FLAPS LEFT PERCENT"), variable(mover, "GENERAL ENG COMBUSTION:2")], [1, 20, 1], "a taxiing copy's beacon, flaps, and engines")

  // A taxiing copy is drawn 1s behind its original's reads, so it trails it by 1s at 20 kt.
  await sleep(3_000)
  const lag = trailing(await copies(b), "FSLTL_FAIB_B738_5", 5, moving)
  assert.ok(lag > 0.9 && lag < 1.2, `the taxiing copy trails its original by ${lag.toFixed(3)}s`)

  // A parked copy is written once, and stays through 15s with no change, since its original's state goes out every 5s.
  await sleep(16_000)
  const still = await copies(b)
  assert.equal(still.length, 151, "every copy is still shown after 19s, the parked ones on their 5s states")
  const parkedNow = still.find((c) => c.title === "FSLTL_FAIB_B738_50")!
  assert.equal(variable(parkedNow, "PLANE LATITUDE"), variable(parked, "PLANE LATITUDE"), "and a parked copy hasn't moved")

  // A poll whose answers aren't whole after 2s is dropped, and sends nothing as gone: an aircraft that left meanwhile keeps its copy until a whole poll misses it.
  a.core.act({ act: "hold-polls", count: 3 * 6 })
  a.core.act({ act: "ai-gone", ids: [0x10_000 + 60] })
  await sleep(2_500)
  assert.ok((await copies(b)).some((c) => c.title === "FSLTL_FAIB_B738_60"), "the gone aircraft's copy stays while no poll is whole")
  await untilCopies(b, (c) => !c.some((x) => x.title === "FSLTL_FAIB_B738_60"), "the gone aircraft's copy removed once a poll is whole", 10_000)

  // The traffic host's stats, which it logs every 30s, give what its states took between the machines.
  const stats = a.core.log().split("\n").filter((l) => l.includes("traffic's stats as the traffic host")).at(-1) ?? ""
  console.log(`budget: traffic: ${stats.replace(/^.*?objects=/, "objects=")}, against about 2.5KB/s for 120 aircraft`)
  // A poll's answers, 851 objects twice a second, each within a handler's 1ms.
  for (const p of [a, b]) {
    p.core.send({ kind: "exit" })
    assert.equal(await p.core.exited, 0)
    p.core.checkHandlers(`${p.name}'s run, with 851 objects polled twice a second`)
  }
})

test("a taxiing copy trails its original by 1s and stops where it stopped, and a receiving pilot who leaves the flight or loads one has every copy removed and shown again once back", { timeout: 180_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("traffic-motion", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  put(a, [aircraft(0x10_000, 0, { moving: true }), aircraft(0x10_001, 1)])
  const moving = Date.now()
  await flying(a, b)
  await share(a)
  await untilCopies(b, (c) => c.length === 2 && drawn(c), "both copies drawn")
  // A copy shows at its first state and holds there until the 1s it's drawn behind reaches it, so the copies are read from then.
  await sleep(DELAY * 1_000 + 500)
  // Read over 4s, the copy trails its original by the 1s it's drawn behind, with no hold at each sample's end.
  const lags: number[] = []
  for (let n = 0; n < 20; n++) {
    lags.push(trailing(await copies(b), "FSLTL_FAIB_B738_0", 0, moving))
    await sleep(200)
  }
  assert.ok(Math.min(...lags) > 0.9 && Math.max(...lags) < 1.2, `the taxiing copy trailed its original by ${Math.min(...lags).toFixed(3)}s to ${Math.max(...lags).toFixed(3)}s`)

  // The original stops: its copy is carried on to where it stopped, and holds there.
  a.core.act({ act: "ai", objects: [{ id: 0x10_000, kind: "aircraft", numbers: [["A:VELOCITY BODY Z", 0]], texts: [] }] })
  const stop = (TAXI * (Date.now() - moving)) / 1e3
  await sleep(DELAY * 1_000 + 1_500)
  const stopped = north((await copies(b)).find((c) => c.title === "FSLTL_FAIB_B738_0")!)
  await sleep(1_500)
  const held = north((await copies(b)).find((c) => c.title === "FSLTL_FAIB_B738_0")!)
  assert.equal(held, stopped, "the stopped copy holds")
  assert.ok(Math.abs(stopped - stop) < 1, `it stopped ${(stopped - stop).toFixed(2)}m from where its original did`)

  // Adam leaves the flight: every copy goes, and comes back as he loads it again.
  await toMenu(b.core)
  await until(b, (s) => mine(s)?.in_flight === false, "out of the flight")
  await untilCopies(b, (c) => c.length === 0, "every copy removed out of the flight")
  // Leaving the flight unloads the 58P's profile, whose close of traffic's connection removes the copies, so traffic's own removes, which run after it, make no call.
  const { calls } = await b.core.report()
  const made = calls.filter((c) => c.function === "AICreateNonAtcAircraft")
  // Avatars' figures go on avatars' own connection, so only traffic's unit counts.
  const removes = calls.filter((c) => c.function === "AIRemoveObject" && c.unit === made[0]?.unit)
  assert.equal(removes.length, made.length, `each copy is removed once: ${removes.map((r) => r.arguments).join("; ")}`)
  assert.ok(removes.every((r) => made.some((m) => m.unit === r.unit && m.open === r.open)), "on the connection that created it")
  await inFlight(b)
  await untilCopies(b, (c) => c.length === 2, "both copies back in the flight")
})

test("a receiving pilot who takes the role has their copies removed and their poll carries none of them, and the old host gets the new host's traffic, and every copy back once it takes the role again", { timeout: 180_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("traffic-roles", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  put(a, Array.from({ length: 5 }, (_, n) => aircraft(0x10_000 + n, n, { title: `JAMES_${n}` })))
  put(b, Array.from({ length: 3 }, (_, n) => aircraft(0x50_000 + n, n, { title: `ADAM_${n}` })))
  await flying(a, b)
  await share(a)
  await untilCopies(b, (c) => c.length === 5, "James's five copies")
  // Adam's own three aircraft aren't James's, which two counts in a row show on his tab.
  await b.traffic.until(() => trafficSlice(b)?.others === 3, "Adam's count of 3 aircraft that aren't James's", 30_000)

  await share(b)
  await untilCopies(b, (c) => c.length === 0, "Adam's copies of James's traffic removed")
  const onA = await untilCopies(a, (c) => c.length === 3, "James's copies of Adam's three")
  assert.ok(onA.every((c) => c.title.startsWith("ADAM_")), `James sees only Adam's own traffic, not Adam's copies of his: ${onA.map((c) => c.title).join(", ")}`)
  assert.equal(trafficSlice(b)?.others, 0, "the traffic host's tab counts nothing")

  await share(a)
  await untilCopies(a, (c) => c.length === 0, "James's copies of Adam's traffic removed")
  const back = await untilCopies(b, (c) => c.length === 5, "Adam's copies of James's five again")
  assert.ok(back.every((c) => c.title.startsWith("JAMES_")), "every identity went out again")
})

test("a joiner creates 150 copies within 5s of entering the flight, from the identities its link brought, and draws them once the clock offset arrives", { timeout: 180_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("traffic-join", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  put(a, Array.from({ length: 150 }, (_, n) => aircraft(0x10_000 + n, n)))
  const code = await host(a.core, a.name)
  await inFlight(a)
  await share(a)
  await join(b.core, code, b.name)
  await until(b, (s) => s.members.length === 2, "both members")
  // The identities arrive with the link, and the states with the host's next poll.
  await sleep(2_000)
  await load(b.core, BARON)
  const entered = Date.now()
  const shown = await untilCopies(b, (c) => c.length === 150, "150 copies", 10_000)
  const took = Date.now() - entered
  console.log(`budget: traffic: a joiner created 150 copies within ${took}ms of entering the flight, against 5s`)
  budget(took < 5_000, `150 copies took ${took}ms`)
  assert.ok(shown.every((c) => c.title.startsWith("FSLTL_FAIB_B738_")))
  // `Traffic` draws a copy once the network holds the host's clock offset.
  await untilCopies(b, (c) => c.length === 150 && drawn(c), "every copy drawn", 10_000)
})

test("a pilot already in the flight whose link comes up gets every identity, and creates every copy within 500ms", { timeout: 180_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("traffic-link-up", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  put(a, Array.from({ length: 150 }, (_, n) => aircraft(0x10_000 + n, n)))
  const code = await host(a.core, a.name)
  await inFlight(a)
  await share(a)
  // James carries his traffic, its identities read, before Adam's link comes up.
  await sleep(2_000)
  await load(b.core, BARON)
  const heard = b.core.heard().length
  await join(b.core, code, b.name)
  // The network's test unit says when Adam's link to James is up; every parked aircraft's next sample goes out at James's next poll, within 500ms.
  await b.core.hear(/^net up /, { after: heard, ms: 15_000 })
  const up = Date.now()
  await untilCopies(b, (c) => c.length === 150, "150 copies", 10_000)
  const took = Date.now() - up
  console.log(`budget: traffic: a pilot already in the flight created 150 copies ${took}ms after its link came up, against 500ms`)
  budget(took < 500, `150 copies took ${took}ms from the link`)
})

test("a state that comes before its identity waits for it, and its copy is created as the identity comes", { timeout: 180_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("traffic-identity-late", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  put(a, [aircraft(0x10_000, 0, { moving: true }), aircraft(0x10_001, 1)])
  await flying(a, b)
  // Adam's core holds traffic's identities for 3s, so James's first states reach it before them, as loss on a direct path can.
  const held = Date.now()
  b.core.net({ act: "hold", channel: IDENTITIES, ms: HOLD_MS })
  await share(a)
  await sleep(Math.max(0, held + HOLD_MS - 300 - Date.now()))
  assert.equal((await copies(b)).length, 0, "no copy while its identity is held")
  // The parked aircraft's next state comes with its 5s heartbeat, so its copy coming within 1s of the identities says its first state was kept.
  await untilCopies(b, (c) => c.length === 2, "both copies once the identities come", 5_000)
  const after = Date.now() - (held + HOLD_MS)
  assert.ok(after < 1_000, `both copies came ${after}ms after the identities`)
})

test("a traffic host carries 500 objects at most, so a receiving pilot who leaves the flight and comes back stays within the kernel's 1,000 calls an input", { timeout: 240_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("traffic-cap", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  put(a, Array.from({ length: 520 }, (_, n) => aircraft(0x10_000 + n, n)))
  await flying(a, b)
  await share(a)
  await untilCopies(b, (c) => c.length === 500, "500 copies", 30_000)
  await sleep(2_000)
  assert.equal((await copies(b)).length, 500, "and no more")
  assert.equal(a.core.log().split("\n").filter((l) => l.includes("carries as many objects as it may")).length, 1, "the host says so once")
  await toMenu(b.core)
  await untilCopies(b, (c) => c.length === 0, "every copy removed out of the flight", 30_000)
  await inFlight(b)
  await untilCopies(b, (c) => c.length === 500, "500 copies again", 30_000)
})

test("a create that throws makes the stand-in, the stand-in throwing too leaves the copy missing, both counted on the tab, and a copy with no state for 15s is removed and created again at its next", { timeout: 180_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("traffic-missing", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  b.core.act({ act: "lack", title: "FSLTL_ABSENT_A320" })
  b.core.act({ act: "lack", title: "FSLTL_ABSENT_H145" })
  b.core.act({ act: "lack", title: "Asobo PassiveAircraft B505" })
  put(a, [aircraft(0x10_000, 0), aircraft(0x10_001, 1, { title: "FSLTL_ABSENT_A320" }), aircraft(0x10_002, 2, { kind: "helicopter", title: "FSLTL_ABSENT_H145" })])
  await flying(a, b)
  await share(a)
  const shown = await untilCopies(b, (c) => c.length === 2, "the aircraft and the A320's stand-in")
  assert.deepEqual(shown.map((c) => c.title).sort(), ["Asobo PassiveAircraft Citation CJ4", "FSLTL_FAIB_B738_0"])
  await b.traffic.until(() => trafficSlice(b)?.missing === 2, "Adam's tab counting the stand-in and the missing helicopter")

  // The relay cut for 20s: no state for 15s takes the copies away, and the next state shows them again.
  await net.relays[0]!.cut(a.core.process.pid!, 20_000)
  await untilCopies(b, (c) => c.length === 0, "the copies removed with no state for 15s", 20_000)
  await untilCopies(b, (c) => c.length === 2, "the copies back with their next states", 30_000)
})

test("LIST_PACKS lists the known traffic packs in Community with their manifests' versions, and no other package", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("traffic-packs", t)
  const folder = path.join(run.folder, "packages-pc")
  const community = path.join(folder, "packages", "Community")
  // The second folder's name is made up for the case: a package whose name no known pack starts.
  for (const [pack, version] of [["fsltl-traffic-base", "1.2.0"], ["fsltl-traffic-extras", "2.0.0"], ["bksq-aircraft-baronpropress", "1.0.0"]] as const) {
    fs.mkdirSync(path.join(community, pack), { recursive: true })
    fs.writeFileSync(path.join(community, pack, "manifest.json"), JSON.stringify({ package_version: version }))
  }
  const cfg = path.join(folder, "UserCfg.opt")
  fs.writeFileSync(cfg, userCfgText(path.join(folder, "packages")))
  const core = await run.core("James", { settings: { "sim.user-cfg": cfg } })
  const traffic = await FakeApp.open(core, ["traffic"])
  await traffic.ok("traffic.list-packs")
  await traffic.until(() => traffic.slice<TrafficSlice>("traffic")?.packs != null, "the packs listed")
  assert.deepEqual(traffic.slice<TrafficSlice>("traffic")!.packs, [{ name: "fsltl-traffic-base", version: "1.2.0" }])
})
