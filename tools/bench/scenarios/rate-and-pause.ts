// Rate and pause between bench cores in a session in the Baron 58P, each with a fake EFB app whose
// part makes the toolbar's call on its stand-in: active pause from either pilot, the flag that
// comes back, two presses at once and twice within a round trip, the simulation rate, the EFB app
// reconnecting, the pilot flying in the pause menu, and the time of day
// (record/areas/session/02-units.md, "Cases for the bench"; record/areas/interface/01-apps.md,
// "Cases for the bench").

import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { Notification } from "../../../src/engines/messages/ts/clients/Notification.ts"
import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import { BenchRun, type Core } from "../cores.ts"
import { BARON, load } from "../flights.ts"
import { app, BenchNetwork, host, join } from "../network.ts"
import { type FakeApp, FakeEfbApp } from "../pages.ts"

/** A pilot: a core with the bench's network, its sim running, the fake desktop app the session's commands go through, and a fake EFB app whose part makes the toolbar's call. */
type Pilot = { core: Core; app: FakeApp; efb: FakeEfbApp; name: string }

/** `Pause_EX1`'s flags: active pause, and the pause menu's sim pause (record/areas/session/02-units.md, "Rate and pause"). */
const ACTIVE = 4
const MENU = 8

/** A following machine's active pause, applied within this long of the key arriving (record/areas/session/02-units.md, "Budgets"). */
const PAUSE_BUDGET_MS = 500

async function pilot(t: TestContext, run: BenchRun, net: BenchNetwork, name: string): Promise<Pilot> {
  const core = await run.core(name, net.core())
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  // The sim's rate at 1, and a step either way moving it between 1 and 2, as `K:SIM_RATE_INCR` and `K:SIM_RATE_DECR` do (measured on MSFS 2024, record/areas/environment/log.md, "2026-10-03: The rate steps and the time events work from SimConnect, and `K:SIM_RATE_SET` doesn't").
  core.act({ act: "set", numbers: [["E:SIMULATION RATE", 1]], texts: [] })
  core.act({ act: "rule", when: { when: "sent", name: "SIM_RATE_INCR" }, after_ms: 0, then: { then: "set", name: "SIMULATION RATE", value: 2 } })
  core.act({ act: "rule", when: { when: "sent", name: "SIM_RATE_DECR" }, after_ms: 0, then: { then: "set", name: "SIMULATION RATE", value: 1 } })
  return { core, app: await app(core), efb: efbApp(t, core), name }
}

function efbApp(t: TestContext, core: Core): FakeEfbApp {
  const efb = new FakeEfbApp(core)
  t.after(() => efb.close())
  efb.makesToolbarCall(core)
  efb.client.watch("notifications", () => {})
  return efb
}

function session(p: Pilot): SessionSlice {
  return p.app.slice<SessionSlice>("session")!
}

const mine = (s: SessionSlice) => s.members.find((m) => m.pilot === s.me)

async function until(p: Pilot, ok: (s: SessionSlice) => boolean, what: string, ms = 15_000): Promise<void> {
  await p.app.until(() => {
    const s = p.app.slice<SessionSlice>("session")
    return s !== undefined && ok(s)
  }, `${p.name}: ${what}`, ms)
}

/** A session `a` hosts and `b` joins, both flying the Baron 58P with preflight ended. */
async function flying(a: Pilot, b: Pilot): Promise<void> {
  const code = await host(a.core, a.name)
  await join(b.core, code, b.name)
  for (const p of [a, b]) await until(p, (s) => s.members.length === 2, "both members")
  for (const p of [a, b]) await load(p.core, BARON)
  for (const p of [a, b]) {
    await until(p, (s) => mine(s)?.in_flight === true && s.ready?.length === 0, "Ready allowed")
    await p.app.ok("session.ready", { on: true })
  }
  for (const p of [a, b]) await until(p, (s) => s.preflight.phase === "ended", "preflight's end")
}

/** The pilot's own press of active pause, as the sim reports it. */
function press(p: Pilot, on: boolean): void {
  p.core.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "pause", flags: on ? ACTIVE : 0 } }] })
}

/** Whether `p`'s sim is in active pause, by the members' status keys, which carry each sim's `Pause_EX1` flags. */
function paused(p: Pilot): boolean | undefined {
  const status = mine(session(p))?.status
  return status && (status.pause & ACTIVE) !== 0
}

async function settles(pilots: Pilot[], on: boolean, what: string): Promise<void> {
  for (const p of pilots) await until(p, () => paused(p) === on, `${p.name}'s sim ${on ? "in" : "out of"} active pause: ${what}`)
}

/** The sim's simulation rate on `p`'s stand-in. */
async function rate(p: Pilot): Promise<number> {
  const { variables } = await p.core.report()
  return Number(variables.find(([name]) => name === "SIMULATION RATE")?.[1] ?? 0)
}

async function untilRate(p: Pilot, wanted: number, what: string): Promise<void> {
  const started = Date.now()
  while ((await rate(p)) !== wanted) {
    if (Date.now() - started > 10_000) throw new Error(`${p.name}'s rate didn't become ${wanted}: ${what}`)
    await sleep(50)
  }
}

function cards(p: Pilot): Notification[] {
  return ((p.efb.slice("notifications") ?? []) as Notification[]).filter((n) => n.id.startsWith("rate-and-pause."))
}

test("active pause and the simulation rate follow every pilot, the flag the part brings back writes no key, and the pause menu and time of day show", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("rate-and-pause", t)
  const a = await pilot(t, run, net, "James")
  const b = await pilot(t, run, net, "Adam")
  // The two sims 20 minutes apart, on the same date: 14:05 and 14:25 UTC.
  const time = (seconds: number): [string, number][] => [["E:ZULU TIME", seconds], ["E:ZULU DAY OF MONTH", 17], ["E:ZULU MONTH OF YEAR", 11], ["E:ZULU YEAR", 2026]]
  a.core.act({ act: "set", numbers: time(50_700), texts: [] })
  b.core.act({ act: "set", numbers: time(51_900), texts: [] })
  await flying(a, b)

  // The time of day, as each entered the flight, from each pilot's side.
  const said = new Map([[a, "Adam's sim is 20 minutes ahead of yours"], [b, "Your sim is 20 minutes ahead of James's"]])
  for (const p of [a, b]) {
    await until(p, (s) => s.differences.some((d) => d.level === "warning" && d.words === said.get(p)), "the time of day's warning")
  }

  // James presses active pause: Adam's part makes the call, and the flag it brings back writes no
  // key, so nothing reaches James's part.
  const started = performance.now()
  press(a, true)
  await b.efb.until(() => b.efb.pauses.length === 1, "Adam's part asked to pause")
  const tookMs = performance.now() - started
  console.log(`budget: the following machine's active pause asked of its part ${tookMs.toFixed(0)}ms after the pilot flying's press, the key's way between the cores included, against ${PAUSE_BUDGET_MS}ms from the key arriving`)
  assert.ok(tookMs < PAUSE_BUDGET_MS, `Adam's pause took ${tookMs.toFixed(0)}ms`)
  await settles([a, b], true, "after James's press")
  await sleep(500)
  assert.deepEqual(b.efb.pauses, [true])
  assert.deepEqual(a.efb.pauses, [], "the flag Adam's part brought back wrote no key")

  // Adam, following, unpauses, and James's sim follows.
  press(b, false)
  await settles([a, b], false, "after Adam's press")
  assert.deepEqual(a.efb.pauses, [false])

  // Both press at once: one value, and once it has settled, nothing more asked of either part, and
  // nothing asked but the value both pressed.
  const asked = { a: a.efb.pauses.length, b: b.efb.pauses.length }
  press(a, true)
  press(b, true)
  await settles([a, b], true, "after both pressed at once")
  await sleep(500)
  const settled = { a: a.efb.pauses.length, b: b.efb.pauses.length }
  await sleep(1_000)
  assert.deepEqual({ a: a.efb.pauses.length, b: b.efb.pauses.length }, settled, "nothing more asked of either part")
  assert.ok([...a.efb.pauses.slice(asked.a), ...b.efb.pauses.slice(asked.b)].every((on) => on), "only the pause both pressed")
  assert.equal(paused(a), true)
  assert.equal(paused(b), true)

  // James presses it twice within one round trip: every machine ends on his last.
  press(a, false)
  press(a, true)
  press(a, false)
  await sleep(1_500)
  assert.equal(paused(a), false, "James's sim ends unpaused")
  assert.equal(paused(b), false, "Adam's sim ends unpaused")

  // Adam's part slow to bring its flag back, so the key turns twice before it does: James presses
  // on and off, and Adam's sim ends off rather than on its first ask's flag.
  b.efb.toolbarLateMs = 300
  press(a, true)
  press(a, false)
  await sleep(1_500)
  assert.equal(paused(a), false)
  assert.equal(paused(b), false, "Adam's sim ends on the key, not on its first ask")
  b.efb.toolbarLateMs = 0

  // Adam, following, changes the sim's rate, which steps back; James's change reaches Adam.
  b.core.act({ act: "set", numbers: [["E:SIMULATION RATE", 2]], texts: [] })
  await untilRate(b, 1, "Adam's own change stepped back")
  a.core.act({ act: "set", numbers: [["E:SIMULATION RATE", 2]], texts: [] })
  await untilRate(b, 2, "James's rate reached Adam")
  assert.equal(await rate(a), 2)

  // James opens the pause menu: Adam's banner says so until James leaves it.
  a.core.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "pause", flags: MENU } }] })
  await b.efb.until(() => cards(b).some((n) => n.id === "rate-and-pause.pause-menu" && n.text === "James has paused"), "Adam's banner saying James has paused")
  assert.deepEqual(cards(a), [], "James's own banner says nothing")
  a.core.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "pause", flags: 0 } }] })
  await b.efb.until(() => cards(b).length === 0, "Adam's banner clearing")
})

test("active pause set while the EFB app reconnects reaches the sim once the app is back", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("rate-and-pause-reconnect", t)
  const a = await pilot(t, run, net, "James")
  const b = await pilot(t, run, net, "Adam")
  await flying(a, b)

  b.efb.close()
  press(a, true)
  await until(b, (s) => s.members.some((m) => m.pilot !== s.me && (m.status.pause & ACTIVE) !== 0), "Adam's core hearing James's pause")
  await sleep(500)
  assert.equal(paused(b), false, "with no EFB app, Adam's sim stays as it was")

  const back = efbApp(t, b.core)
  await back.until(() => back.pauses.length === 1, "the EFB app back, and asked to pause")
  await settles([b], true, "once the EFB app is back")
})
