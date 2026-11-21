// Pointer sync between bench cores in a session in the Baron 58P, each with a fake cockpit
// panel running the panel bridge and the `pointer-sync` module over a fake document: taps,
// drags, and holds playing on the other display, gestures cut short by a late up, a cut, and a
// killed core, the locks a press meets, the ups a panel never answers, catch-ups, and the
// visible lock through outages (record/areas/pointer-sync/01-pointer-sync.md, "Cases for the
// bench").

import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { CockpitAct } from "../../../src/engines/messages/ts/bench/CockpitAct.ts"
import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import type { Heard } from "../../../src/platform/panel-bridge/test/fake-document.ts"
import { BenchRun, type Core } from "../cores.ts"
import { BARON, load } from "../flights.ts"
import { app, BenchNetwork, host, join } from "../network.ts"
import { type FakeApp, FakePage } from "../pages.ts"
import { FakeCockpitPanel, TABLET } from "../panel.ts"
import { resume, suspend } from "../suspend.ts"

/** A pilot: a core with the bench's network, its fake desktop app, its sim running, and its cockpit panel. */
type Pilot = { core: Core; app: FakeApp; name: string; panel: FakeCockpitPanel }

const NO_LINK = "Lost the connection to the pilot flying. Take control to keep flying, or wait for the connection to come back."
const CATCHING_UP = "Catching up with the pilot flying's cockpit. This display unlocks when it's done."
const RED_ORANGE = "rgba(255, 69, 0, 0.6)"

async function pilot(run: BenchRun, net: BenchNetwork, name: string, panel = "VCockpit60"): Promise<Pilot> {
  const core = await run.core(name, net.core())
  const p = { core, app: await app(core), name, panel: new FakeCockpitPanel(core, panel) }
  const sim = run.stub()
  core.act({ act: "watch", process: sim.id })
  await core.hear("stage Starting aircraft none")
  return p
}

async function until(p: Pilot, ok: (s: SessionSlice) => boolean, what: string, ms = 15_000): Promise<void> {
  await p.app.until(() => {
    const s = p.app.slice<SessionSlice>("session")
    return s !== undefined && ok(s)
  }, `${p.name}: ${what}`, ms)
}

function slice(p: Pilot): SessionSlice {
  return p.app.slice<SessionSlice>("session")!
}

const mine = (s: SessionSlice) => s.members.find((m) => m.pilot === s.me)

async function ready(p: Pilot): Promise<void> {
  await until(p, (s) => mine(s)?.in_flight === true && s.ready?.length === 0, "Ready allowed")
  await p.app.ok("session.ready", { on: true })
}

/** Waits until `panel` runs the pointer sync module. */
async function loaded(panel: FakeCockpitPanel, what: string): Promise<void> {
  await panel.page.until(() => panel.loaded(), `${what}'s panel loading pointer sync`, 15_000)
}

/** A session `a` hosts and the others join, each in the Baron with its panel loaded, through preflight's end. */
async function flying(a: Pilot, ...others: Pilot[]): Promise<void> {
  const code = await host(a.core, a.name)
  for (const p of others) await join(p.core, code, p.name)
  const all = [a, ...others]
  for (const p of all) await until(p, (s) => s.members.length === all.length, "every member")
  for (const p of all) await load(p.core, BARON)
  for (const p of all) await ready(p)
  for (const p of all) await until(p, (s) => s.preflight.phase === "ended", "preflight's end")
  for (const p of all) await loaded(p.panel, p.name)
}

/** Waits until `ok` holds, checking every 20ms, for at most `ms`. */
async function soon(ok: () => boolean, what: string, ms = 10_000): Promise<void> {
  const started = performance.now()
  while (!ok()) {
    if (performance.now() - started > ms) throw new Error(`${what} didn't happen within ${ms}ms`)
    await sleep(20)
  }
}

/** What a panel's display and document heard from the other pilot, since `after`, in the order they heard it. */
function played(panel: FakeCockpitPanel, after = 0): Heard[] {
  return panel
    .events()
    .filter((h) => !h.trusted && h.at >= after)
    .sort((x, y) => x.at - y.at)
}

function types(heard: Heard[]): string[] {
  return heard.map((h) => h.type)
}

/** The gesture messages `p`'s core sent on the cockpit stream, among its lines after `after`. */
function sentOut(p: Pilot, after = 0): string[] {
  return p.core
    .heard()
    .slice(after)
    .filter((l) => l.startsWith(`cockpit sent other ${TABLET} `))
}

/** Waits until `p`'s log holds `text`. */
async function logged(p: Pilot, text: string, ms = 15_000): Promise<void> {
  await soon(() => p.core.log().includes(text), `${p.name}'s log saying ${text}`, ms)
}

function act(p: Pilot, a: CockpitAct): void {
  p.core.cockpit(a)
}

/** Asks for control on `p` until `p` holds it, since a guard denies it while a replay or catch-up runs. */
async function takeControl(p: Pilot): Promise<void> {
  const started = performance.now()
  while (slice(p).pf !== slice(p).me) {
    if (performance.now() - started > 20_000) throw new Error(`${p.name} never took control`)
    act(p, { act: "take-control" })
    await sleep(1_000)
  }
}

/** Cuts `p`'s connection through the relay for `ms`, runs `during` once both sides lost the link, and waits until they have it back. */
async function cut(net: BenchNetwork, p: Pilot, other: Pilot, ms: number, during: () => Promise<void> = async () => {}): Promise<void> {
  const after = [p.core.heard().length, other.core.heard().length] as const
  await net.relays[0]!.cut(p.core.process.pid!, ms)
  await p.core.hear(/^net lost /, { after: after[0] })
  await other.core.hear(/^net lost /, { after: after[1] })
  await during()
  await p.core.hear(/^net up \S+ again=true/, { after: after[0], ms: ms + 60_000 })
  await other.core.hear(/^net up \S+ again=true/, { after: after[1], ms: ms + 60_000 })
}

/** Drags on `p`'s display from `from` to `to`, in fractions across the top row, for `ms`, moving every few ms, and leaves the button down. */
async function drag(p: Pilot, from: number, to: number, ms: number): Promise<void> {
  const started = performance.now()
  for (let done = 0; done < ms; done = performance.now() - started) {
    p.panel.move(from + ((to - from) * done) / ms, 0.1)
    await sleep(5)
  }
}

/**
 * A panel that announces the tablet and never says it played an up, as a broken module would:
 * it speaks pointer sync's messages from the socket outward, with no bridge.
 */
function silentPanel(core: Core, name: string): FakePage {
  const page = new FakePage(core, { component: "panel-bridge", sessionOnly: true, panel: name, instruments: [TABLET] })
  page.client.onPanel((m) => {
    if (m.t === "load") page.client.sendUnit("pointer-sync", { t: "displays", displays: [TABLET] })
  })
  return page
}

test("a tap plays at the same fractions, a 3s drag's moves arrive while it's made, and a 5s hold keeps the lock, replayed after a cut too", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("pointer-sync-gestures", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await flying(a, b)

  a.panel.tap(0.1, 0.1)
  await soon(() => types(played(b.panel)).includes("click"), "the tap's click")
  assert.deepEqual(
    b.panel.buttons[0]!.heard.map((h) => [h.type, h.x, h.y, h.trusted]),
    [
      ["mousedown", 80, 60, false],
      ["mouseup", 80, 60, false],
      ["click", 80, 60, false],
    ],
    "at the same fractions",
  )

  const dragAt = performance.now()
  const unitsBefore = b.panel.page.messages("unit").length
  a.panel.press(0.05, 0.1)
  const dragging = drag(a, 0.05, 0.95, 3_000)
  await soon(() => played(b.panel, dragAt).some((h) => h.type === "mousemove"), "the drag's first move", 1_000)
  const firstMove = performance.now() - dragAt
  await dragging
  const movesBeforeUp = played(b.panel, dragAt).filter((h) => h.type === "mousemove").length
  a.panel.release(0.95, 0.1)
  await soon(() => played(b.panel, dragAt).some((h) => h.type === "mouseup"), "the drag's up")
  const moves = played(b.panel, dragAt).filter((h) => h.type === "mousemove").length
  const toPanel = b.panel.page.messages("unit").length - unitsBefore
  t.diagnostic(`budget: a 3s drag sent ${moves} moves, ${(moves / 3).toFixed(1)} a second, against about 30`)
  t.diagnostic(`budget: the drag brought ${toPanel} messages to the other panel, ${(toPanel / 3).toFixed(1)} a second, against under 30`)
  assert.ok(firstMove < 1_000, `the first move arrived ${firstMove.toFixed(0)}ms into the drag`)
  assert.ok(movesBeforeUp >= moves - 2, `${movesBeforeUp} of ${moves} moves arrived while the drag was made`)
  assert.ok(moves >= 45 && moves <= 93, `${moves} moves in 3s`)
  assert.ok(toPanel / 3 < 31, `${toPanel} messages in 3s`)
  assert.ok(!types(played(b.panel, dragAt)).includes("click"), "a drag's up doesn't click")

  a.panel.press(0.6, 0.6)
  await soon(() => b.panel.blocked(), "the hold's lock")
  for (let s = 1; s <= 5; s++) {
    await sleep(1_000)
    assert.equal(b.panel.blocked(), true, `the lock holds at ${s}s, from the hold's Held messages`)
  }
  a.panel.release(0.6, 0.6)
  await soon(() => !b.panel.blocked(), "the lock going at the hold's up")
  const hold = b.panel.buttons[6]!.heard
  const held = hold.at(-2)!.at - hold.at(-3)!.at
  assert.deepEqual(types(hold.slice(-3)), ["mousedown", "mouseup", "click"])
  assert.ok(held > 4_700 && held < 5_600, `the hold played as a ${held.toFixed(0)}ms press`)

  const fromB = b.panel.buttons[6]!.heard.length
  await cut(net, b, a, 15_000, async () => {
    a.panel.press(0.6, 0.6)
    await sleep(5_000)
    a.panel.release(0.6, 0.6)
  })
  await soon(() => b.panel.buttons[6]!.heard.slice(fromB).some((h) => h.type === "click"), "the replayed hold's click", 20_000)
  const replayed = b.panel.buttons[6]!.heard.slice(fromB)
  const replayedHeld = replayed.at(-2)!.at - replayed.at(-3)!.at
  t.diagnostic(`the hold made during a cut replayed as a ${replayedHeld.toFixed(0)}ms press, against 5,000ms`)
  assert.ok(replayedHeld > 4_700 && replayedHeld < 5_600, `${replayedHeld.toFixed(0)}ms`)
})

test("a state change sent while a display press is held goes out between its down and its up", { timeout: 240_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("pointer-sync-switch", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await flying(a, b)
  const [fromA, fromB] = [a.core.heard().length, b.core.heard().length]
  a.panel.press(0.1, 0.1)
  await soon(() => types(played(b.panel)).includes("mousedown"), "the press's down")
  act(a, { act: "send", kind: "held", key: "battery", value: 1, count: 1, every_ms: 0 })
  await b.core.hear(/^cockpit applied held battery 1 /, { after: fromB })
  assert.ok(!types(played(b.panel)).includes("mouseup"), "the change applies while the press is down")
  a.panel.release(0.1, 0.1)
  await soon(() => types(played(b.panel)).includes("click"), "the press's up")
  const lines = a.core.heard().slice(fromA).filter((l) => l.startsWith("cockpit sent "))
  assert.deepEqual(
    lines.map((l) => l.split(" ").slice(2, 4).join(" ")),
    [`other ${TABLET}`, "held battery", `other ${TABLET}`],
    "the change goes out between the down and the up",
  )
})

test("a 10s cut partway through a drag ends it, then replays it from its next message, and a late up starts its lapsed tap again and clicks", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("pointer-sync-lapses", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await flying(a, b)

  // The cut comes once the drag's first moves have played at B, so the drag lapses there.
  const before = performance.now()
  a.panel.press(0.05, 0.1)
  await drag(a, 0.05, 0.3, 1_000)
  await soon(() => played(b.panel, before).filter((h) => h.type === "mousemove").length >= 10, "the drag's moves at B before the cut")
  await cut(net, b, a, 10_000, async () => {
    await drag(a, 0.3, 0.9, 2_000)
    a.panel.release(0.9, 0.1)
    await sleep(500)
    a.panel.tap(0.6, 0.6)
  })
  await soon(() => b.panel.buttons[6]!.heard.some((h) => h.type === "click" && h.at > before), "the tap after the drag", 20_000)
  const heard = played(b.panel, before)
  const lapse = heard.findIndex((h) => b.panel.doc.heard.includes(h))
  assert.ok(lapse > 0, "the cut drag ended on the document")
  assert.ok(types(heard.slice(0, lapse)).every((type) => type === "mousedown" || type === "mousemove"), types(heard).join(" "))
  const again = types(heard.slice(lapse + 1))
  assert.equal(again[0], "mousedown", "the replay starts the drag again")
  assert.ok(again.filter((type) => type === "mousemove").length > 20, `and plays its moves: ${again.join(" ")}`)
  assert.deepEqual(again.slice(-4), ["mouseup", "mousedown", "mouseup", "click"], "then its up and the tap after it")

  // A tap whose up comes 2.5s after its down, as through the move to the relay.
  await sleep(2_000)
  const late = performance.now()
  a.panel.press(0.1, 0.1)
  await soon(() => types(played(b.panel, late)).includes("mousedown"), "the tap's down")
  await net.relays[0]!.delay(a.core.process.pid!, 2_500)
  a.panel.release(0.1, 0.1)
  await soon(() => types(played(b.panel, late)).includes("click"), "the late up's click", 10_000)
  await net.relays[0]!.delay(a.core.process.pid!, 0)
  const tap = played(b.panel, late)
  assert.deepEqual(types(tap), ["mousedown", "mouseup", "mousedown", "mouseup", "click"], "the lapse's up, then the tap again")
  assert.ok(b.panel.doc.heard.includes(tap[1]!), "the lapse ended it on the document")
  const lapsed = tap[1]!.at - tap[0]!.at
  assert.ok(lapsed >= 1_900 && lapsed < 2_400, `it lapsed ${lapsed.toFixed(0)}ms after its down`)
})

test("the sending core killed partway through a drag: the other display's lock lapses within 2s of the last move, and nothing more plays", { timeout: 240_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("pointer-sync-killed", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await flying(a, b)
  a.panel.press(0.05, 0.1)
  await drag(a, 0.05, 0.5, 1_000)
  await a.core.kill()
  const lastMove = played(b.panel).filter((h) => h.type === "mousemove").at(-1)!.at
  await soon(() => !b.panel.blocked(), "the lock lapsing", 5_000)
  const lapsed = performance.now() - lastMove
  t.diagnostic(`the lock lapsed ${lapsed.toFixed(0)}ms after the last move, against 2,000ms`)
  assert.ok(lapsed < 2_300, `${lapsed.toFixed(0)}ms`)
  assert.equal(b.panel.doc.heard.at(-1)?.type, "mouseup", "the gesture ends with a mouseup on the document")
  const count = played(b.panel).length
  await sleep(3_000)
  assert.equal(played(b.panel).length, count, "nothing more of it plays")
})

test("a press under another pilot's gesture flashes and reaches nothing, and another pilot's down while this pilot's button is down locks at this pilot's up", { timeout: 240_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("pointer-sync-locks", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await flying(a, b)

  const fromB = b.core.heard().length
  a.panel.press(0.5, 0.5)
  await soon(() => b.panel.blocked(), "the unseen lock")
  assert.equal(b.panel.lockText(), "", "an unseen lock has no words")
  b.panel.press(0.1, 0.1)
  assert.equal(b.panel.locks()[0]!.style.get("background-color"), RED_ORANGE, "the flash")
  a.panel.release(0.5, 0.5)
  await soon(() => types(played(b.panel)).includes("mouseup"), "the other pilot's up")
  await sleep(200)
  assert.equal(b.panel.locks().length, 1, "the lock the press is held on stays")
  b.panel.release(0.1, 0.1)
  assert.equal(b.panel.locks().length, 0, "and goes at its up")
  assert.equal(b.panel.buttons[0]!.heard.length, 0, "the display got nothing")
  await sleep(500)
  assert.deepEqual(sentOut(b, fromB), [], "nothing was sent")

  // Both press within one trip: each plays the other's down, and locks only at its own up.
  const [fromA2, fromB2] = [a.core.heard().length, b.core.heard().length]
  const at = performance.now()
  b.panel.press(0.1, 0.9)
  a.panel.press(0.9, 0.9)
  await soon(() => played(b.panel, at).some((h) => h.type === "mousedown"), "A's down at B")
  assert.equal(b.panel.locks().length, 0, "no lock while B's button is down")
  b.panel.release(0.1, 0.9)
  await soon(() => b.panel.blocked(), "B's lock at B's up")
  await soon(() => sentOut(b, fromB2).length === 2, "B's own up going out")
  a.panel.release(0.9, 0.9)
  await soon(() => !b.panel.blocked(), "B's lock going at A's up")
  assert.equal(sentOut(a, fromA2).length, 2)
})

test("an up no panel answers applies after 1s with a line in the log, one whose panel reloads applies at once, and a module that fails partway leaves no lock", { timeout: 240_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("pointer-sync-ups", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await flying(a, b)
  const line = "a display's panel didn't say it played another pilot's up within 1s"
  const lines = (): number => b.core.log().split(line).length - 1

  b.panel.close()
  const silent = silentPanel(b.core, "VCockpit61")
  await silent.until(() => silent.messages("load").length > 0, "the silent panel's load")
  await sleep(300)
  a.panel.tap(0.1, 0.1)
  await soon(() => lines() === 1, "the line for the up nobody answered", 5_000)

  // The silent panel reloads while an up waits on it: its socket closes, and the up applies at once.
  a.panel.tap(0.1, 0.1)
  await silent.until(() => silent.messages("unit").length >= 4, "the second tap's up at the silent panel")
  const first = new FakeCockpitPanel(b.core, "VCockpit61")
  silent.close()
  await sleep(1_500)
  assert.equal(lines(), 1, "the up on the closed socket applied at once, with no line")

  // A panel that reloads partway through a gesture: the new one ignores the rest, and answers its up at once.
  await loaded(first, "the reloaded panel")
  a.panel.press(0.2, 0.2)
  await soon(() => first.blocked(), "the down at the reloaded panel")
  const second = new FakeCockpitPanel(b.core, "VCockpit61")
  first.close()
  await loaded(second, "the panel reloaded again")
  a.panel.move(0.4, 0.4)
  await sleep(100)
  a.panel.release(0.4, 0.4)
  await second.page.until(() => second.page.messages("unit").length >= 2, "the rest of the gesture at the new panel")
  await sleep(1_500)
  assert.equal(lines(), 1, "the new panel answered its up at once")
  assert.equal(second.events().length, 0, "and played none of the gesture")

  // A module that throws partway through a gesture: its display throws on every read of its rect.
  a.panel.press(0.5, 0.5)
  await soon(() => second.blocked(), "the lock at the new panel")
  second.display.getBoundingClientRect = () => {
    throw new Error("broken")
  }
  const broke = performance.now()
  const dragging = drag(a, 0.5, 0.9, 3_000)
  await soon(() => second.locks().length === 0, "the lock going after the module failed", 2_500)
  t.diagnostic(`the lock went ${(performance.now() - broke).toFixed(0)}ms after the module failed, against 2,000ms`)
  await dragging
  assert.equal(second.locks().length, 0, "and stays gone while the gesture goes on")
  assert.ok(second.logs.some((l) => l.includes("threw")), "the bridge caught the module's throw")
  a.panel.release(0.9, 0.1)
  second.close()
})

test("a down during a late joiner's catch-up is skipped while its displays lock, a press in preflight goes nowhere, and the PF's press during preflight's end's catch-up plays", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("pointer-sync-catch-up", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  for (const p of [a, b]) act(p, { act: "ready", on: true })
  act(b, { act: "settle", ms: 3_000 })
  const code = await host(a.core, a.name)
  await join(b.core, code, b.name)
  await until(a, (s) => s.members.length === 2, "both members")
  for (const p of [a, b]) await load(p.core, BARON)
  for (const p of [a, b]) await loaded(p.panel, p.name)

  const fromA = a.core.heard().length
  a.panel.tap(0.1, 0.1)
  assert.deepEqual(
    types(a.panel.buttons[0]!.heard.filter((h) => h.trusted)),
    ["mousedown", "mouseup"],
    "a press in preflight acts on its own display",
  )
  for (const p of [a, b]) await ready(p)
  await until(a, (s) => s.preflight.phase === "ended", "preflight's end")
  await logged(a, "the flying machine answers a catch-up")
  const fromB = b.core.heard().length
  a.panel.tap(0.6, 0.6)
  await soon(() => types(played(b.panel)).includes("click"), "the press after preflight's end")
  assert.ok(!b.core.heard().slice(fromB).includes("cockpit settled"), "it played while preflight's end's catch-up ran")
  assert.equal(b.panel.buttons[0]!.heard.length, 0, "the press in preflight went nowhere")
  assert.equal(sentOut(a, fromA).length, 2, "only the press after preflight's end went out")
  await logged(b, "this machine's catch-up ended")

  const c = await pilot(run, net, "Eve", "VCockpit62")
  act(c, { act: "ready", on: true })
  act(c, { act: "settle", ms: 3_000 })
  await join(c.core, code, c.name)
  const fromC = c.core.heard().length
  await load(c.core, BARON)
  await loaded(c.panel, c.name)
  await c.core.hear(/^cockpit took /, { after: fromC, ms: 15_000 })
  await soon(() => c.panel.lockText() === CATCHING_UP, "the late joiner's lock")
  const pressed = performance.now()
  a.panel.press(0.6, 0.6)
  await c.core.hear("cockpit settled", { after: fromC, ms: 10_000 })
  await soon(() => c.panel.locks().length === 0, "the lock going as the catch-up ends")
  a.panel.move(0.7, 0.7)
  await sleep(100)
  a.panel.release(0.7, 0.7)
  await soon(() => played(b.panel, pressed).some((h) => h.type === "mouseup"), "the gesture's up at B")
  await sleep(500)
  assert.deepEqual(c.panel.events(), [], "the skipped down's moves and up play nothing at the late joiner")
})

test("the PM's displays lock with no link to the PF, until it takes control or its replay ends, and a PF's unheard Leave leaves them locked until then", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("pointer-sync-no-link", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await flying(a, b)

  let lockedAt = 0
  const cutAt = performance.now()
  await cut(net, b, a, 15_000, async () => {
    await soon(() => b.panel.lockText() === NO_LINK, "the PM's lock", 3_000)
    lockedAt = performance.now() - cutAt
    assert.equal(a.panel.locks().length, 0, "the PF's never lock")
    // Events of the pilot flying's, which the pilot monitoring's replay plays at their gaps once the link is back.
    act(a, { act: "send", kind: "event", key: "starter", value: 1, count: 3, every_ms: 1_500 })
  })
  t.diagnostic(`the PM's displays locked ${lockedAt.toFixed(0)}ms after the cut, as the link was lost 5s in`)
  assert.ok(lockedAt < 6_500, `${lockedAt.toFixed(0)}ms`)
  await soon(() => b.panel.lockText() === CATCHING_UP, "the replay's lock", 5_000)
  await logged(b, "a replay of what this machine missed ended")
  await soon(() => b.panel.locks().length === 0, "the lock going with the replay")

  await cut(net, b, a, 30_000, async () => {
    await soon(() => b.panel.lockText() === NO_LINK, "the PM's lock again", 3_000)
    await takeControl(b)
    await soon(() => b.panel.locks().length === 0, "the lock lifting as the PM takes control")
  })

  // Control back at A, which then leaves while B can't hear its handover.
  await until(a, (s) => s.pf === slice(b).me, "the new pilot flying")
  await takeControl(a)
  await until(b, (s) => s.pf === slice(a).me, "control back at A")
  await net.relays[0]!.cut(b.core.process.pid!, 60_000)
  await b.core.hear(/^net lost /, { after: 0 })
  await a.app.ok("session.leave")
  await soon(() => b.panel.lockText() === NO_LINK, "the PM's lock after the PF left", 8_000)
  await sleep(3_000)
  assert.equal(b.panel.lockText(), NO_LINK, "it holds while the PF is gone")
  await takeControl(b)
  await soon(() => b.panel.locks().length === 0, "the lock lifting as the PM takes control")
})

test("with the core suspended, a visible lock turns into a warning within 10s, unlock removes it, and with the core's socket closed every lock drops at once", { timeout: 240_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("pointer-sync-outages", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  const other = new FakeCockpitPanel(b.core, "VCockpit61")
  t.after(() => other.close())
  await flying(a, b)
  await loaded(other, "the PM's second")
  await net.relays[0]!.cut(b.core.process.pid!, 120_000)
  await soon(() => b.panel.blocked() && other.blocked(), "both of the PM's panels locking", 10_000)

  await suspend(b.core.process.pid!)
  try {
    const warned: number[] = []
    await soon(() => {
      for (const [i, panel] of [b.panel, other].entries()) {
        if (warned[i] === undefined && !panel.blocked()) warned[i] = panel.page.now() - panel.page.received.at(-1)!.at
      }
      // By index, since `every` skips the hole the second panel leaves when it warns first.
      return warned[0] !== undefined && warned[1] !== undefined
    }, "the warnings", 12_000)
    t.diagnostic(`the locks turned into warnings ${warned.map((w) => w.toFixed(0)).join("ms and ")}ms after the core's last message, against 10,000ms`)
    for (const w of warned) assert.ok(w >= 7_900 && w <= 10_000, `${w.toFixed(0)}ms`)
    assert.match(b.panel.lockText() ?? "", /stopped responding/)
    b.panel.bridge.unlock()
    assert.equal(b.panel.locks().length, 0, "unlock removes it at once")
  } finally {
    await resume(b.core.process.pid!)
  }
  await soon(() => other.blocked(), "the other panel's lock once the core answers again", 5_000)
  await b.core.kill()
  await soon(() => other.page.client.state === "closed", "the socket's close", 5_000)
  assert.equal(other.locks().length, 0, "every lock dropped at once")
})
