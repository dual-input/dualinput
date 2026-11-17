// Go to, which the EFB app labels Join, between bench cores in a session: the pilot flying's
// spot from their flight file and engines, Join from the world map through a fake menu script,
// Set up only at a stand and Join now on a runway through to Ready to fly, a stand the world map
// lacks, a step that fails, and each reason Join is unavailable (record/areas/session/02-units.md,
// "Go to" and "Cases for the bench"; record/areas/interface/decisions.md, "Join takes a joiner from
// the world map into the PF's flight, or only sets it up").

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test, type TestContext } from "node:test"

import type { GoToSlice } from "../../../src/engines/messages/ts/go-to/GoToSlice.ts"
import type { Unavailable } from "../../../src/engines/messages/ts/go-to/Unavailable.ts"
import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import type { WorldMapRequest } from "../../../src/engines/messages/ts/sim/WorldMapRequest.ts"
import { BenchRun, type Core } from "../cores.ts"
import { BARON, load, PA24, toMenu } from "../flights.ts"
import { app, BenchNetwork, host, join } from "../network.ts"
import { FakeApp, FakeMenuScript } from "../pages.ts"

/** The flight file's `[Departure]` section as the sim writes it (record/areas/interface/log.md, 2026-10-05). */
const AT_PARKING_140 = "[Departure]\r\nICAO=EGLL\r\nGateName=PARKING\r\nGateNumber=140\r\nGateSuffix=NONE\r\n"

type Pilot = { core: Core; app: FakeApp; name: string }

async function pilot(run: BenchRun, net: BenchNetwork, name: string): Promise<Pilot> {
  const core = await run.core(name, net.core())
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  const desktop = await app(core)
  return { core, app: desktop, name }
}

/** A flight file in the run's folder holding `text`. */
function flightFile(run: BenchRun, name: string, text: string): string {
  const file = path.join(run.folder, `${name}.FLT`)
  fs.writeFileSync(file, text)
  return file
}

/** The joiner's fake menu script, at the world map, with the Baron 58P in its aircraft list. */
function worldMap(t: TestContext, p: Pilot): FakeMenuScript {
  const menu = new FakeMenuScript(p.core, "world-map", [BARON])
  t.after(() => menu.close())
  menu.client.watch("go-to", () => {})
  return menu
}

function goTo(menu: FakeMenuScript): GoToSlice | undefined {
  return menu.slice("go-to") as GoToSlice | undefined
}

async function joinIs(menu: FakeMenuScript, wanted: "ready" | "hidden" | Unavailable, what: string): Promise<void> {
  await menu.until(() => {
    const join = goTo(menu)?.join
    return join?.as === wanted || (join?.as === "unavailable" && join.why === wanted)
  }, `Join ${wanted}: ${what}, with ${JSON.stringify(goTo(menu))}`)
}

async function until(p: Pilot, ok: (s: SessionSlice) => boolean, what: string): Promise<void> {
  await p.app.until(() => {
    const s = p.app.slice<SessionSlice>("session")
    return s !== undefined && ok(s)
  }, `${p.name}: ${what}`, 15_000)
}

/** The requests a Join made, from the menu script's `from`th on, leaving out the aircraft list's checks, which come as the page or the aircraft changes. */
function steps(menu: FakeMenuScript, from: number): WorldMapRequest["do"][] {
  return menu.requests
    .slice(from)
    .map((r) => r.do)
    .filter((d) => d !== "find-aircraft")
}

/** Sends Join, and waits until it has said something new. */
async function joinAs(p: Pilot, menu: FakeMenuScript, now: boolean): Promise<NonNullable<GoToSlice["said"]>> {
  const before = goTo(menu)?.said?.n ?? 0
  await p.app.ok("go-to.join", { now })
  await menu.until(() => (goTo(menu)?.said?.n ?? 0) > before, "Join saying how it went")
  return goTo(menu)!.said!
}

test("Join from the world map: Set up only at the pilot flying's stand, and Join now on a runway through Ready to fly", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("go-to", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  const menu = worldMap(t, b)
  await b.core.hear(/^stage Menu /)
  const code = await host(a.core, a.name)
  await join(b.core, code, b.name)
  for (const p of [a, b]) await until(p, (s) => s.members.length === 2, "both members")

  await load(a.core, BARON, { flight: flightFile(run, "parking-140", AT_PARKING_140) })
  await a.core.hear("departure EGLL PARKING 140")
  await menu.until(() => goTo(menu)?.spot?.stand?.number === 140, "Adam seeing James's stand")
  assert.deepEqual(goTo(menu)!.spot, { airport: "EGLL", stand: { name: "PARKING", number: 140 }, engines: false, livery: "N515MR" })
  await joinIs(menu, "ready", "James at a stand")
  assert.ok(menu.requests.some((r) => r.do === "find-aircraft" && r.folder === BARON.path), "the aircraft list asked for James's aircraft")

  // Set up only: the airport, the stand, the aircraft, and the livery, and no flight.
  let from = menu.requests.length
  const started = performance.now()
  let said = await joinAs(b, menu, false)
  console.log(`budget: Set up only took ${(performance.now() - started).toFixed(0)}ms from the command to its last answer, on a fake menu script that answers at once; Go to's 5s is measured in the sim`)
  assert.deepEqual(said.outcome, { as: "set-up", no_stand: false })
  assert.deepEqual(steps(menu, from), ["departure-airport", "departure-stand", "aircraft", "livery"])
  assert.deepEqual(menu.requests.find((r) => r.do === "departure-stand"), { do: "departure-stand", name: "PARKING", number: 140 })
  assert.deepEqual(menu.requests.find((r) => r.do === "livery"), { do: "livery", name: "N515MR", title: "Baron 58P" })
  await joinIs(menu, "ready", "after Set up only")

  // James starts his engines: Join now takes a runway, starts the flight, and presses Ready to fly.
  // The launch's answer comes after the load has reached Ready to fly, as SimConnect's signals and
  // the menu script's socket can bring them in either order.
  a.core.act({ act: "set", numbers: [["A:NUMBER OF ENGINES", 2], ["A:GENERAL ENG COMBUSTION:2", 1]], texts: [] })
  await menu.until(() => goTo(menu)?.spot?.engines === true, "Adam seeing James's engines running")
  menu.late = { "launch-flight": 300 }
  from = menu.requests.length
  said = await joinAs(b, menu, true)
  assert.deepEqual(said.outcome, { as: "set-up", no_stand: false })
  assert.equal(said.now, true)
  await until(b, (s) => s.members.find((m) => m.pilot === s.me)?.in_flight === true, "Adam in the flight")
  assert.deepEqual(steps(menu, from), ["departure-airport", "departure-runway", "aircraft", "livery", "launch-flight", "ready-to-fly"])
  await joinIs(menu, "hidden", "once Adam is in the flight")
})

test("Join says why it's unavailable, keeps the airport when the stand is missing, and says which step failed", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("go-to-unavailable", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  let menu = worldMap(t, b)
  await b.core.hear(/^stage Menu /)
  const code = await host(a.core, a.name)
  await join(b.core, code, b.name)
  for (const p of [a, b]) await until(p, (s) => s.members.length === 2, "both members")

  // Adam's aircraft list lacks the Baron from the start, which Join says only once James's flight
  // names a departure.
  menu.aircraft = []
  await joinIs(menu, "no-flight", "before James loads a flight")
  await load(a.core, BARON, { flight: flightFile(run, "no-departure", "[Main]\r\nTitle=No departure\r\n") })
  await joinIs(menu, "no-departure", "James's flight names no departure")

  // James reloads at a stand.
  await toMenu(a.core)
  await load(a.core, BARON, { flight: flightFile(run, "parking-140", AT_PARKING_140) })
  await joinIs(menu, "no-aircraft", "Adam lacks the Baron")
  // Adam installs it, and the world map asks again on his next visit.
  menu.aircraft = [BARON]
  menu.show("main")
  menu.show("world-map")
  await joinIs(menu, "ready", "Adam has the Baron")

  // The world map lists no PARKING 140: the airport stays alone, and Join says so.
  menu.answer = (r) => (r.do === "departure-stand" ? { as: "no-match" } : undefined)
  let said = await joinAs(b, menu, false)
  assert.deepEqual(said.outcome, { as: "set-up", no_stand: true })
  assert.ok(menu.requests.some((r) => r.do === "aircraft"), "Join went on to the aircraft")

  // The airport search fails: Join stops there and says so.
  menu.answer = (r) => (r.do === "departure-airport" ? { as: "failed", why: "the bench's search found nothing" } : undefined)
  const from = menu.requests.length
  said = await joinAs(b, menu, true)
  assert.deepEqual(said.outcome, { as: "failed", step: "airport" })
  assert.deepEqual(steps(menu, from), ["departure-airport"])
  await joinIs(menu, "ready", "after the failure")

  // Adam in a flight in another aircraft, then back at the world map with no menu script.
  menu.answer = () => undefined
  await load(b.core, PA24, { title: "PA-24" })
  await joinIs(menu, "other-aircraft", "Adam in the PA-24")
  await toMenu(b.core)
  await joinIs(menu, "ready", "Adam back at the world map")
  menu.close()
  const watcher = await FakeApp.open(b.core, ["go-to"])
  t.after(() => watcher.close())
  await watcher.until(() => {
    const join = watcher.slice<GoToSlice>("go-to")?.join
    return join?.as === "unavailable" && join.why === "no-script"
  }, "Join without the menu script")
  menu = worldMap(t, b)
  await joinIs(menu, "ready", "the menu script back")
})
