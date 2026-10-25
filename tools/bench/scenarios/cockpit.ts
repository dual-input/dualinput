// The cockpit stream between bench cores in a session, in the flight after preflight, with the
// test unit that stands in for state sync, and pointer sync's tap: a held value's rate, a cut's paced
// and collapsed replay, a takeover during a cut, a late joiner's catch-up, control passing during
// one, a pilot flying who leaves during a replay, and a member with no profile
// (record/areas/sync/05-units.md, "Cases for the bench"; record/areas/build/plan.md, "13 The sync
// engine and the cockpit stream").

import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { CockpitAct } from "../../../src/engines/messages/ts/bench/CockpitAct.ts"
import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import { BenchRun, type Core } from "../cores.ts"
import { BARON, load, toMenu } from "../flights.ts"
import { app, BenchNetwork, host, join } from "../network.ts"
import type { FakeApp } from "../pages.ts"
import { FakeCockpitPanel } from "../panel.ts"

/** A pilot: a core with the bench's network, its fake desktop app, and its sim running. */
type Pilot = { core: Core; app: FakeApp; name: string }

async function pilot(run: BenchRun, net: BenchNetwork, name: string): Promise<Pilot> {
  const core = await run.core(name, net.core())
  const p = { core, app: await app(core), name }
  const sim = run.stub()
  core.act({ act: "watch", process: sim.id })
  await core.hear("stage Starting aircraft none")
  return p
}

function slice(p: Pilot): SessionSlice {
  const s = p.app.slice<SessionSlice>("session")
  assert.ok(s, `${p.name} has no session slice yet`)
  return s
}

async function until(p: Pilot, ok: (s: SessionSlice) => boolean, what: string, ms = 15_000): Promise<void> {
  await p.app.until(() => {
    const s = p.app.slice<SessionSlice>("session")
    return s !== undefined && ok(s)
  }, `${p.name}: ${what}`, ms)
}

const mine = (s: SessionSlice) => s.members.find((m) => m.pilot === s.me)

/** Readies `p` once Ready is allowed. */
async function ready(p: Pilot): Promise<void> {
  await until(p, (s) => mine(s)?.in_flight === true && s.ready?.length === 0, "Ready allowed")
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
}

function act(p: Pilot, a: CockpitAct): void {
  p.core.cockpit(a)
}

function send(p: Pilot, kind: "held" | "pilot-flying" | "event", key: string, value: number, count = 1, every_ms = 0): void {
  act(p, { act: "send", kind, key, value, count, every_ms })
}

type Report = { values: Record<string, number>; take_control: string; catching_up: boolean; replaying: boolean; kept: number; waiting: number }

async function report(p: Pilot): Promise<Report> {
  const after = p.core.heard().length
  act(p, { act: "report" })
  const line = await p.core.hear(/^cockpit report /, { after })
  return JSON.parse(line.replace(/^cockpit report /, "")) as Report
}

/** The values `p`'s test unit applied for `kind` and `key`, in order, among its lines after `after`. */
function applied(p: Pilot, kind: string, key: string, after = 0): number[] {
  const at = new RegExp(`^cockpit applied ${kind} ${key} (\\S+) from=`)
  return p.core
    .heard()
    .slice(after)
    .flatMap((l) => {
      const m = at.exec(l)
      return m ? [Number(m[1])] : []
    })
}

/** Waits until `p`'s log holds `text`. */
async function logged(p: Pilot, text: string | RegExp, ms = 15_000): Promise<void> {
  const started = Date.now()
  while (!(typeof text === "string" ? p.core.log().includes(text) : text.test(p.core.log()))) {
    if (Date.now() - started > ms) throw new Error(`${p.name}'s log never said ${text}`)
    await sleep(100)
  }
}

/** Cuts `p`'s connection through the relay for `ms`, and waits until both sides lost the link and have it back. */
async function cut(net: BenchNetwork, p: Pilot, other: Pilot, ms: number, during: () => Promise<void> = async () => {}): Promise<void> {
  const after = [p.core.heard().length, other.core.heard().length] as const
  await net.relays[0]!.cut(p.core.process.pid!, ms)
  await p.core.hear(/^net lost /, { after: after[0] })
  await other.core.hear(/^net lost /, { after: after[1] })
  await during()
  await p.core.hear(/^net up \S+ again=true/, { after: after[0], ms: ms + 60_000 })
  await other.core.hear(/^net up \S+ again=true/, { after: after[1], ms: ms + 60_000 })
}

test("a lever changed 60 times a second goes out at most 20 times a second, its last value before the press after it", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("cockpit-held", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  const [panelA, panelB] = [new FakeCockpitPanel(a.core), new FakeCockpitPanel(b.core)]
  await flying(a, b)
  for (const panel of [panelA, panelB]) await panel.page.until(() => panel.loaded(), "pointer sync's module")
  const [fromA, fromB] = [a.core.heard().length, b.core.heard().length]
  send(a, "held", "lever", 1, 120, 16)
  await sleep(2_500)
  const sent = a.core.heard().slice(fromA).filter((l) => l.startsWith("cockpit sent held lever")).length
  t.diagnostic(`budget: 120 changes over about 2s went out as ${sent} messages, against 20 a second`)
  assert.ok(sent <= 42 && sent >= 30, `${sent} messages`)
  // A held value and a pointer sync tap right behind it, within the 50ms the stream holds the
  // value: the value goes out first.
  send(a, "held", "lever", 500)
  await sleep(20)
  panelA.tap(0.1, 0.1)
  await panelB.page.until(() => panelB.events("click").length > 0, "the tap at B")
  assert.deepEqual(applied(b, "held", "lever", fromB).at(-1), 500)
  const order = a.core.heard().slice(fromA).filter((l) => l.startsWith("cockpit sent ")).slice(-3)
  assert.deepEqual(order.map((l) => l.split(" ")[2]), ["held", "other", "other"], "the held value goes out before the tap's down and up")
  for (const panel of [panelA, panelB]) panel.close()
  // The loop's stats for the whole run, which the core logs as it exits
  // (record/areas/core/01-loop-and-edge.md, "Logging").
  for (const p of [a, b]) {
    p.core.send({ kind: "exit" })
    assert.equal(await p.core.exited, 0)
    p.core.checkHandlers(`${p.name}'s run, with a lever changed 60 times a second`)
  }
})

test("a 60s cut replays at the sender's gaps, collapses runs of the pilot flying's changes, and denies take-control until it ends", { timeout: 240_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("cockpit-cut", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await flying(a, b)
  const fromB = b.core.heard().length
  await cut(net, b, a, 60_000, async () => {
    send(a, "pilot-flying", "throttle", 1, 5, 100)
    await sleep(1_000)
    send(a, "event", "starter", 1)
    await sleep(3_000)
    send(a, "pilot-flying", "throttle", 10, 3, 100)
    await sleep(1_000)
    send(a, "held", "beacon", 1)
  })
  await b.core.hear(/^cockpit applied event starter 1 /, { after: fromB, ms: 10_000 })
  const starter = performance.now()
  const during = await report(b)
  assert.equal(during.replaying, true, "the replay runs")
  assert.match(during.take_control, /^denied/, "take-control waits for the replay")
  await b.core.hear(/^cockpit applied pilot-flying throttle 12 /, { after: fromB, ms: 10_000 })
  const gap = performance.now() - starter
  await b.core.hear(/^cockpit applied held beacon 1 /, { after: fromB, ms: 10_000 })
  t.diagnostic(`the replay waited ${gap.toFixed(0)}ms for a gap of 3.2s, against its 2s cap`)
  assert.ok(gap > 1_700 && gap < 3_000, `${gap.toFixed(0)}ms`)
  assert.deepEqual(applied(b, "pilot-flying", "throttle", fromB), [5, 12], "each run collapses to its last, the first kept before the starter")
  await logged(b, "a replay of what this machine missed ended")
  assert.equal((await report(b)).take_control, "allowed")
})

test("a takeover during a cut drops the old pilot flying's solo changes, and the ex-pilot flying catches up from the new one", { timeout: 240_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("cockpit-takeover", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await flying(a, b)
  for (const p of [a, b]) act(p, { act: "ready", on: true })
  await logged(b, "this machine's catch-up ended")
  send(a, "held", "battery", 1)
  await b.core.hear(/^cockpit applied held battery 1 /)
  const [fromA, fromB] = [a.core.heard().length, b.core.heard().length]
  await cut(net, b, a, 30_000, async () => {
    send(a, "pilot-flying", "throttle", 50, 3, 100)
    await sleep(500)
    act(b, { act: "take-control" })
    await b.core.hear("cockpit take-control allowed", { after: fromB })
    await until(b, (s) => s.pf === s.me, "control")
    send(b, "held", "flaps", 2)
  })
  await a.core.hear(/^cockpit took /, { after: fromA, ms: 20_000 })
  await until(a, (s) => s.pf === slice(b).me, "the new pilot flying")
  assert.deepEqual(applied(b, "pilot-flying", "throttle", fromB), [], "the old pilot flying's solo changes are dropped")
  const took = a.core.heard().slice(fromA).find((l) => l.startsWith("cockpit took "))!
  const values = JSON.parse(took.replace(/^cockpit took /, "")) as Record<string, number>
  assert.equal(values.flaps, 2, "the ex-pilot flying takes the new one's state")
  assert.equal(values.throttle, undefined, "its own solo throttle isn't the new pilot flying's")
})

test("a late joiner asks, is answered once the pilot flying can give, asks again after a cut, and drops the copies it queued", { timeout: 240_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("cockpit-late-joiner", t)
  const a = await pilot(run, net, "James")
  await load(a.core, BARON)
  const code = await host(a.core, a.name)
  await ready(a)
  await until(a, (s) => s.preflight.phase === "ended", "preflight's end")
  send(a, "held", "x", 1, 3, 60)
  await sleep(500)

  const b = await pilot(run, net, "Adam")
  act(b, { act: "ready", on: true })
  act(b, { act: "settle", ms: 3_000 })
  await join(b.core, code, b.name)
  const fromB = b.core.heard().length
  await load(b.core, BARON)
  await logged(b, "this machine asks the pilot flying for a catch-up")
  await logged(a, "a catch-up was asked before this machine's steps can give")
  // The answer waits, and a cut takes the link while it does.
  await cut(net, b, a, 10_000, async () => {
    send(a, "held", "y", 7)
    act(a, { act: "ready", on: true })
  })
  await logged(b, "while this machine waits for its catch-up, so it asks again")
  await b.core.hear(/^cockpit took /, { after: fromB, ms: 15_000 })
  const took = JSON.parse(b.core.heard().slice(fromB).find((l) => l.startsWith("cockpit took "))!.replace(/^cockpit took /, "")) as Record<string, number>
  assert.deepEqual(took, { x: 3, y: 7 })
  const during = await report(b)
  assert.equal(during.catching_up, true, "the catch-up runs until the aircraft settles")
  assert.match(during.take_control, /^denied/)
  await b.core.hear("cockpit settled", { after: fromB, ms: 10_000 })
  await logged(b, "this machine's catch-up ended")
  const after = await report(b)
  assert.equal(after.catching_up, false)
  assert.equal(after.take_control, "allowed")
  assert.deepEqual(applied(b, "held", "y", fromB), [], "the queued copy of what the catch-up held dropped")
})

test("control passing between two others during a catch-up has the catching-up core ask the new pilot flying", { timeout: 240_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("cockpit-pass-during-catch-up", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await flying(a, b)
  // The pilot monitoring catches up as its step becomes ready, then the pilot flying's step
  // stops being able to give, so the late joiner's ask waits.
  act(a, { act: "ready", on: true })
  act(b, { act: "ready", on: true })
  await logged(b, "this machine's catch-up ended")
  send(b, "held", "flaps", 2)
  await a.core.hear(/^cockpit applied held flaps 2 /)
  act(a, { act: "ready", on: false })

  const c = await pilot(run, net, "Eve")
  act(c, { act: "ready", on: true })
  await join(c.core, slice(a).code!, c.name)
  const fromC = c.core.heard().length
  await load(c.core, BARON)
  await logged(a, "a catch-up was asked before this machine's steps can give")
  act(b, { act: "take-control" })
  await until(c, (s) => s.pf === slice(b).me, "the new pilot flying")
  await logged(c, "control passed during this machine's catch-up, so it asks the new pilot flying")
  await c.core.hear(/^cockpit took /, { after: fromC, ms: 15_000 })
  // The old pilot flying can give now, but its asker asked the new one.
  act(a, { act: "ready", on: true })
  await sleep(2_000)
  const takes = c.core.heard().slice(fromC).filter((l) => l.startsWith("cockpit took "))
  assert.equal(takes.length, 1, takes.join("\n"))
  assert.equal((JSON.parse(takes[0]!.replace(/^cockpit took /, "")) as Record<string, number>).flaps, 2)
})

test("a pilot flying who leaves the flight during the other's replay hands over everything it sent", { timeout: 240_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("cockpit-leave-during-replay", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await flying(a, b)
  const fromB = b.core.heard().length
  await cut(net, b, a, 15_000, async () => {
    for (const [key, value] of [["a", 1], ["b", 2], ["c", 3]] as const) {
      send(a, "held", key, value)
      await sleep(2_500)
    }
  })
  await b.core.hear(/^cockpit applied held a 1 /, { after: fromB, ms: 10_000 })
  await toMenu(a.core)
  await until(b, (s) => s.pf === s.me, "control, from the pilot flying who left")
  await b.core.hear(/^cockpit applied held c 3 /, { after: fromB, ms: 15_000 })
  assert.deepEqual([applied(b, "held", "a", fromB), applied(b, "held", "b", fromB), applied(b, "held", "c", fromB)], [[1], [2], [3]], "nothing dropped")
})

test("a member whose aircraft has no profile applies the change of control, ends its replay, and may take control", { timeout: 240_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("cockpit-no-profile", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await flying(a, b)
  const fromB = b.core.heard().length
  await cut(net, b, a, 15_000, async () => {
    send(a, "held", "h", 1)
    act(b, { act: "take-control" })
    await b.core.hear("cockpit take-control allowed", { after: fromB })
    await until(b, (s) => s.pf === s.me, "control")
  })
  await until(a, (s) => s.pf === slice(b).me, "the new pilot flying")
  await logged(a, "a change of control dropped a message this machine applied, and it has no profile to catch up")
  await logged(a, "a replay of what this machine missed ended")
  assert.equal((await report(a)).take_control, "allowed")
  assert.ok(!a.core.log().includes("this machine asks the pilot flying for a catch-up"), "nothing to catch up without a profile")
  assert.deepEqual(applied(b, "held", "h", fromB), [], "the old pilot flying's solo change dropped")
})
