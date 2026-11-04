// Take-control between bench cores in a session in the Baron 58P, each with a stand-in core
// helper and a fake EFB app: a press and a hold, when a press does nothing, the cues and the
// notifications at each pass, a refusal, a lost link, binding, and the helper going down
// (record/areas/control/01-take-control.md, "Cases for the bench").

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test, type TestContext } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { Notification } from "../../../src/engines/messages/ts/clients/Notification.ts"
import type { Setting } from "../../../src/engines/messages/ts/clients/Setting.ts"
import type { Bound } from "../../../src/engines/messages/ts/core_helper/Bound.ts"
import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import type { TakeControlSlice } from "../../../src/engines/messages/ts/take-control/TakeControlSlice.ts"
import { ROOT } from "../../lib/repo.ts"
import { BenchRun, type Core } from "../cores.ts"
import { BARON, load, toMenu } from "../flights.ts"
import { StandInHelper } from "../helper.ts"
import { app, BenchNetwork, host, join } from "../network.ts"
import { FakeApp, FakeEfbApp } from "../pages.ts"

const F9: Bound = { input: { key: { scan: 67, extended: false } }, name: "F9" }
const B: Bound = { input: { key: { scan: 48, extended: false } }, name: "B" }
const WARNING = "James may still be flying. If you take control, their aircraft will jump to yours when they reconnect."

/** Each cue's size, which tells it apart in the stand-in's lines, since a sound's number depends on what the build registered. */
const CUE_BYTES = Object.fromEntries(["control-passed", "refused"].map((cue) => [cue, fs.statSync(path.join(ROOT, "src", "features", "take-control", "core", "src", "sounds", `${cue}.opus`)).size]))

/** A pilot: a core with the bench's network, its sim running, its stand-in helper, the fake desktop app the session's commands go through, and a fake EFB app. */
type Pilot = { core: Core; helper: StandInHelper; app: FakeApp; efb: FakeEfbApp; name: string }

/** A pilot with a key bound to a single press unless `settings` says otherwise. */
async function pilot(t: TestContext, run: BenchRun, net: BenchNetwork, name: string, settings: Record<string, unknown> = {}): Promise<Pilot> {
  const helper = await StandInHelper.start()
  t.after(() => helper.close())
  const given = helper.coreOptions({ "take-control.input": F9, "take-control.long-press": false, ...settings })
  const core = await run.core(name, { env: given.env, settings: { ...net.core().settings, ...given.settings } })
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  const efb = new FakeEfbApp(core)
  t.after(() => efb.close())
  efb.client.watch("take-control", () => {})
  efb.client.watch("notifications", () => {})
  efb.client.watch("settings", () => {})
  await efb.until(() => control(efb) !== undefined, `${name}'s fake EFB app hearing the slice`)
  return { core, helper, app: await app(core), efb, name }
}

function control(efb: FakeEfbApp): TakeControlSlice | undefined {
  return efb.slice("take-control") as TakeControlSlice | undefined
}

function slice(p: Pilot): TakeControlSlice {
  return control(p.efb)!
}

/** A setting's value, as the slice of settings the part reads says. */
function setting(p: Pilot, key: string): unknown {
  return (p.efb.slice("settings") as Setting[] | undefined)?.find((s) => s.key === key)?.value
}

const boundName = (p: Pilot) => (setting(p, "take-control.input") as Bound | null | undefined)?.name

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

async function ready(p: Pilot): Promise<void> {
  await until(p, (s) => mine(s)?.in_flight === true && s.ready?.length === 0, "Ready allowed")
  await p.app.ok("session.ready", { on: true })
}

/** A session `a` hosts and `b` joins, with neither yet in a flight. */
async function together(a: Pilot, b: Pilot): Promise<void> {
  const code = await host(a.core, a.name)
  await join(b.core, code, b.name)
  for (const p of [a, b]) await until(p, (s) => s.members.length === 2, "both members")
}

async function flying(a: Pilot, b: Pilot): Promise<void> {
  await together(a, b)
  for (const p of [a, b]) await load(p.core, BARON)
  for (const p of [a, b]) await ready(p)
  for (const p of [a, b]) await until(p, (s) => s.preflight.phase === "ended", "preflight's end")
  for (const p of [a, b]) await p.efb.until(() => slice(p).live, `${p.name}'s button showing`)
}

/** Waits until `p`'s helper binds exactly `bound`, and returns the binding's number. */
async function bound(p: Pilot, wanted: Bound): Promise<number> {
  let number = -1
  await p.helper.until(() => {
    const bindings = p.helper.latest?.wants().at(-1)?.bindings
    if (bindings?.length !== 1 || JSON.stringify(bindings[0]![1]) !== JSON.stringify(wanted.input)) return false
    number = bindings[0]![0]
    return true
  }, `${p.name}'s helper binding ${wanted.name}`)
  return number
}

/** The key's down, as the helper would report it, stamped as the stand-in sends it. */
async function down(p: Pilot, wanted = F9): Promise<void> {
  p.helper.latest!.act({ act: "press", binding: await bound(p, wanted), down: true })
}

async function up(p: Pilot, wanted = F9): Promise<void> {
  p.helper.latest!.act({ act: "press", binding: await bound(p, wanted), down: false })
}

async function press(p: Pilot, wanted = F9): Promise<void> {
  await down(p, wanted)
  await up(p, wanted)
}

/** Every `play` the core sent `p`'s helper of `cue`, in every run of it. */
function plays(p: Pilot, cue: "control-passed" | "refused") {
  const lines = p.helper.runs.flatMap((run) => run.lines)
  const sound = lines.find((l) => l.line === "sound" && l.bytes === CUE_BYTES[cue])
  assert.ok(sound?.line === "sound", `${p.name}'s helper was sent ${cue}`)
  return lines.flatMap((l) => (l.line === "play" && l.sound === sound.sound ? [l] : []))
}

function cards(p: Pilot): Notification[] {
  return ((p.efb.slice("notifications") ?? []) as Notification[]).filter((n) => n.id.startsWith("take-control."))
}

function card(p: Pilot, id: string): Notification | undefined {
  return cards(p).find((n) => n.id === `take-control.${id}`)
}

async function heard(p: Pilot, cue: "control-passed" | "refused", count: number): Promise<void> {
  await p.helper.until(() => plays(p, cue).length >= count, `${p.name} playing ${cue} ${count} times`)
  assert.equal(plays(p, cue).length, count)
}

async function shows(p: Pilot, text: string, detail?: string): Promise<void> {
  await p.efb.until(() => card(p, "pass")?.text === text, `${p.name}'s banner saying ${text}, with ${JSON.stringify(cards(p))}`)
  assert.equal(card(p, "pass")!.detail, detail)
}

/** Cuts `p`'s connection through the relay for `ms`, and waits until `p` has lost the link. */
async function cut(net: BenchNetwork, p: Pilot, ms: number): Promise<void> {
  const after = p.core.heard().length
  await net.relays[0]!.cut(p.core.process.pid!, ms)
  await p.core.hear(/^net lost /, { after })
}

test("a press passes control with a cue and a notification on both machines, and does nothing from the pilot flying or before preflight has ended", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("take-control-press", t)
  const a = await pilot(t, run, net, "James")
  const b = await pilot(t, run, net, "Adam")
  await together(a, b)

  // Out of the flight, and in it before preflight has ended.
  await press(b)
  await load(b.core, BARON)
  await load(a.core, BARON)
  await press(b)
  await sleep(300)
  assert.equal(slice(b).live, false)
  assert.equal(session(b).pf, session(a).me, "control stays")
  assert.deepEqual(cards(b), [], "no notification")
  assert.equal(plays(b, "refused").length, 0, "no cue")
  assert.equal(plays(b, "control-passed").length, 0)

  for (const p of [a, b]) await ready(p)
  for (const p of [a, b]) await until(p, (s) => s.preflight.phase === "ended", "preflight's end")
  for (const p of [a, b]) await p.efb.until(() => slice(p).live && slice(p).denied.length === 0, `${p.name}'s button showing, allowed`)
  assert.equal(slice(a).mine, true)
  assert.equal(slice(b).mine, false)
  assert.equal(boundName(b), "F9")
  assert.equal(setting(b, "take-control.long-press"), false)

  // The pilot flying's press.
  await press(a)
  await sleep(300)
  assert.equal(plays(a, "control-passed").length, 0, "a press by the pilot flying plays nothing")
  assert.equal(plays(a, "refused").length, 0)
  assert.deepEqual(cards(a), [])

  // The pilot monitoring's.
  await press(b)
  await heard(b, "control-passed", 1)
  await shows(b, "You have control")
  await heard(a, "control-passed", 1)
  await shows(a, "Adam has control")
  assert.equal(card(a, "pass")!.pilot, session(b).me, "its card leads with the new pilot flying's head")
  await b.efb.until(() => slice(b).mine, "Adam's button saying he has control")

  // A press to the cue, from the helper's stamp on the down, on each pass back and forth.
  const samples: number[] = []
  let [from, to] = [a, b]
  for (let i = 0; i < 40; i++) {
    const before = plays(from, "control-passed").length
    await down(from)
    await from.helper.until(() => plays(from, "control-passed").length > before, `${from.name}'s cue`)
    samples.push(plays(from, "control-passed").at(-1)!.since_press_us)
    await up(from)
    await until(to, (s) => s.pf === session(from).me, "the pass reaching the other machine")
    await from.efb.until(() => slice(from).mine && !slice(to).mine, "both buttons saying who flies")
    ;[from, to] = [to, from]
  }
  samples.sort((x, y) => x - y)
  const at = (share: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * share))]!
  // The output stream took up to 89ms on our development machine (record/areas/control/log.md,
  // 2026-11-04), so about 10ms of the budget's 100ms is left for this part.
  console.log(`budget: a single press to the cue reached the helper in ${at(0.5)}µs at p50, ${at(0.99)}µs at p99, and ${samples.at(-1)}µs at most, of ${samples.length} presses, against 10,000µs, the output stream's own time and this making the budget's 100,000µs`)
  assert.ok(at(0.99) < 10_000, `${at(0.99)}µs`)
})

test("a hold takes control at 0.35s before its release, and a shorter one takes nothing", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("take-control-hold", t)
  const a = await pilot(t, run, net, "James")
  const b = await pilot(t, run, net, "Adam", { "take-control.long-press": true })
  await flying(a, b)
  await b.efb.until(() => slice(b).denied.length === 0, "the guard allowing it")
  assert.equal(setting(b, "take-control.long-press"), true)

  await down(b)
  await sleep(200)
  await up(b)
  await sleep(400)
  assert.equal(plays(b, "control-passed").length, 0, "a hold of 0.2s takes nothing")
  assert.equal(session(b).pf, session(a).me)

  await down(b)
  await heard(b, "control-passed", 1)
  const after = plays(b, "control-passed")[0]!.since_press_us
  console.log(`a hold took control ${after}µs after its down, against 350,000µs`)
  assert.ok(after >= 349_000 && after < 450_000, `${after}µs`)
  await until(b, (s) => s.pf === s.me, "control at Adam, with the key still down")
  await up(b)
  await sleep(300)
  assert.equal(plays(b, "control-passed").length, 1, "the release plays nothing")
})

test("a press during this pilot's catch-up is refused with a cue and the reason, from the key and from the button alike", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("take-control-refused", t)
  const a = await pilot(t, run, net, "James")
  const b = await pilot(t, run, net, "Adam")
  for (const p of [a, b]) p.core.cockpit({ act: "ready", on: true })
  b.core.cockpit({ act: "settle", ms: 6_000 })
  await together(a, b)
  for (const p of [a, b]) await load(p.core, BARON)
  for (const p of [a, b]) await ready(p)
  await b.efb.until(() => slice(b).live && slice(b).denied.length > 0, "the slice saying why before a press", 20_000)
  assert.deepEqual(slice(b).denied, ["You're catching up with James."])

  await press(b)
  await heard(b, "refused", 1)
  await b.efb.until(() => card(b, "refused") !== undefined, "the refusal's card")
  const refused = card(b, "refused")!
  assert.equal(refused.text, "Couldn't take control")
  assert.equal(refused.detail, "You're catching up with James.")
  assert.equal(refused.level, "warning")
  assert.equal(session(b).pf, session(a).me, "control stays")

  await b.efb.client.command("take-control.request", null)
  await heard(b, "refused", 2)
  assert.equal(session(b).pf, session(a).me, "control stays")
  assert.equal(plays(a, "control-passed").length, 0)

  await b.efb.until(() => slice(b).denied.length === 0, "the guard allowing it once the catch-up ends", 20_000)
  await press(b)
  await heard(b, "control-passed", 1)
  await shows(b, "You have control")
})

test("while the link to the pilot flying is lost a press takes control at once, the warning goes, and the old pilot flying is told once back", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("take-control-lost", t)
  const a = await pilot(t, run, net, "James")
  const b = await pilot(t, run, net, "Adam")
  await flying(a, b)
  await b.efb.until(() => slice(b).denied.length === 0, "the guard allowing it")

  await cut(net, b, 15_000)
  await b.efb.until(() => slice(b).warning === WARNING, "the button's warning, before a press")
  await b.efb.until(() => card(b, "lost-pf") !== undefined, "the banner's held card")
  assert.equal(card(b, "lost-pf")!.text, "Reconnecting to James")
  assert.equal(card(b, "lost-pf")!.detail, WARNING)
  assert.equal(card(b, "lost-pf")!.once ?? false, false, "it's held")
  assert.deepEqual(slice(b).denied, [])
  assert.equal(slice(a).warning, null, "the pilot flying isn't warned")
  assert.equal(card(a, "lost-pf"), undefined)

  await press(b)
  await heard(b, "control-passed", 1)
  await shows(b, "You have control")
  await b.efb.until(() => card(b, "lost-pf") === undefined && slice(b).warning === null, "the warning going with the deed done")

  await a.core.hear(/^net up \S+ again=true/, { ms: 60_000 })
  await heard(a, "control-passed", 1)
  await shows(a, "Adam took control while you were disconnected", "What you changed in that time was undone, and your pages and FMS entries may differ from Adam's.")
  assert.equal(card(a, "pass")!.level, "warning")
})

test("a replay on the pilot flying's machine, which the guard refuses control through, tells that pilot nothing", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("take-control-replay-at-pf", t)
  const a = await pilot(t, run, net, "James")
  const b = await pilot(t, run, net, "Adam")
  await flying(a, b)
  const fromA = a.core.heard().length

  // What Adam changes during the cut, which James's machine replays at its gaps once the link is back.
  await cut(net, b, 8_000)
  b.core.cockpit({ act: "send", kind: "event", key: "starter", value: 1, count: 3, every_ms: 1_500 })
  await a.core.hear(/^cockpit applied event starter 1 /, { after: fromA, ms: 60_000 })
  const asked = a.core.heard().length
  a.core.cockpit({ act: "report" })
  const report = JSON.parse((await a.core.hear(/^cockpit report /, { after: asked })).replace(/^cockpit report /, "")) as { take_control: string; replaying: boolean }
  assert.equal(report.replaying, true, "James's machine is replaying")
  assert.match(report.take_control, /^denied/, "the guard refuses him control")

  const replayEnded = Date.now()
  while (!a.core.log().includes("a replay of what this machine missed ended")) {
    if (Date.now() - replayEnded > 20_000) throw new Error("James's replay never ended")
    await sleep(100)
  }
  const said = a.efb.messages("state").flatMap((m) => (m.slice === "take-control" ? [(m.value as TakeControlSlice).denied] : []))
  assert.ok(said.length > 0)
  assert.deepEqual(said.filter((denied) => denied.length > 0), [], "his button, saying he has control, never says it's disabled")
})

test("a press while the link to the pilot flying is lost takes control with a catch-up running", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("take-control-lost-catching-up", t)
  const a = await pilot(t, run, net, "James")
  const b = await pilot(t, run, net, "Adam")
  for (const p of [a, b]) p.core.cockpit({ act: "ready", on: true })
  b.core.cockpit({ act: "settle", ms: 40_000 })
  await together(a, b)
  for (const p of [a, b]) await load(p.core, BARON)
  for (const p of [a, b]) await ready(p)
  await b.efb.until(() => slice(b).denied.length > 0, "the guard refusing during the catch-up", 20_000)

  await cut(net, b, 10_000)
  await b.efb.until(() => slice(b).warning === WARNING && slice(b).denied.length === 0, "the guard letting go with the link lost")
  await press(b)
  await heard(b, "control-passed", 1)
  await until(b, (s) => s.pf === s.me, "control at Adam")
  assert.equal(plays(b, "refused").length, 0)
})

test("the pilot monitoring's press and the pilot flying's within a trip of each other leave one pilot flying, with one cue or two as each pass arrived", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("take-control-both", t)
  const a = await pilot(t, run, net, "James")
  const b = await pilot(t, run, net, "Adam")
  await flying(a, b)
  await b.efb.until(() => slice(b).denied.length === 0, "the guard allowing it")

  // The pass held back on its way to James, so he still flies when he presses.
  await net.relays[0]!.delay(a.core.process.pid!, 150)
  const [meA, meB] = [session(a).me, session(b).me]
  await Promise.all([press(b), sleep(10).then(() => press(a))])
  await heard(b, "control-passed", 1)
  await heard(a, "control-passed", 1)
  await until(a, (s) => s.pf === meB, "the pass reaching James")
  await sleep(500)
  assert.equal(plays(a, "control-passed").length, 1, "James's press did nothing")
  assert.equal(plays(b, "control-passed").length, 1)
  assert.equal(session(b).pf, meB)

  // The pass already in, so his press takes control back: the same second press from a James
  // who knows.
  await net.relays[0]!.delay(a.core.process.pid!, 0)
  await a.efb.until(() => !slice(a).mine && slice(a).denied.length === 0, "James's button able to take it")
  await press(a)
  await heard(a, "control-passed", 2)
  await heard(b, "control-passed", 2)
  await until(b, (s) => s.pf === meA, "control back at James")
  await sleep(300)
  assert.equal(plays(a, "control-passed").length, 2)
  assert.equal(plays(b, "control-passed").length, 2)
})

test("the pilot flying leaving the flight plays the cue on the other machine alone, naming who left", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("take-control-left", t)
  const a = await pilot(t, run, net, "James")
  const b = await pilot(t, run, net, "Adam")
  await flying(a, b)
  await toMenu(a.core)
  await heard(b, "control-passed", 1)
  await shows(b, "You have control", "James left the flight.")
  await a.efb.until(() => !slice(a).live, "James's button going, out of the flight")
  await sleep(300)
  assert.equal(plays(a, "control-passed").length, 0, "James, out of the flight, plays nothing")
  assert.deepEqual(cards(a), [])
})

test("a pilot with no binding has the helper through the session and takes control from the button, and binding, rebinding, and clearing take effect mid-session", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("take-control-binding", t)
  const a = await pilot(t, run, net, "James")
  const b = await pilot(t, run, net, "Adam", { "take-control.input": null })
  assert.equal(b.helper.runs.length, 0, "with no session, nothing is wanted of the helper")
  await flying(a, b)
  await b.helper.until(() => b.helper.latest?.wants().at(-1)?.sounds === true, "the sounds on through the session")
  assert.deepEqual(b.helper.latest!.wants().at(-1)!.bindings, [], "no binding to want")
  assert.equal(boundName(b), undefined)
  await b.efb.until(() => slice(b).denied.length === 0, "the guard allowing it")

  await b.efb.client.command("take-control.request", null)
  await heard(b, "control-passed", 1)
  await shows(b, "You have control")
  await heard(a, "control-passed", 1)
  await a.efb.until(() => !slice(a).mine && slice(a).denied.length === 0, "James's button able to take it")
  await a.efb.client.command("take-control.request", null)
  await heard(a, "control-passed", 2)
  await heard(b, "control-passed", 2)
  await until(b, (s) => s.pf === session(a).me, "control back at James")

  // Bind, then Cancel: as before.
  await b.efb.client.command("take-control.bind", { on: true })
  await b.helper.until(() => b.helper.latest!.wants().at(-1)!.next_press, "the next press wanted")
  await b.efb.until(() => slice(b).waiting, "the slice saying Bind waits")
  await b.efb.client.command("take-control.bind", { on: false })
  await b.helper.until(() => !b.helper.latest!.wants().at(-1)!.next_press, "the next press off")
  await b.efb.until(() => !slice(b).waiting, "the slice saying it doesn't")
  assert.deepEqual(b.helper.latest!.wants().at(-1)!.bindings, [])
  assert.equal(boundName(b), undefined)

  // Bind, then a key, which the part writes into the setting as the slice hands it over.
  const bindTo = async (wanted: Bound) => {
    await b.efb.client.command("take-control.bind", { on: true })
    await b.helper.until(() => b.helper.latest!.wants().at(-1)!.next_press, "the next press wanted")
    b.helper.latest!.act({ act: "next-press", input: wanted.input, name: wanted.name })
    await b.efb.until(() => slice(b).next_press?.name === wanted.name, "the slice handing over the next press")
    assert.equal(slice(b).waiting, false)
    await b.efb.client.command("clients.set-setting", { key: "take-control.input", value: wanted })
    await b.efb.client.command("take-control.bind", { on: false })
    await b.efb.until(() => boundName(b) === wanted.name && slice(b).next_press === null, "the settings showing the key by its name")
  }
  await bindTo(F9)
  assert.equal(await bound(b, F9) >= 0, true, "it's bound by its scan code")
  await press(b)
  await heard(b, "control-passed", 3)
  await heard(a, "control-passed", 3)
  await a.efb.until(() => !slice(a).mine && slice(a).denied.length === 0, "James's button able to take it")

  await a.efb.client.command("take-control.request", null)
  await heard(a, "control-passed", 4)
  await heard(b, "control-passed", 4)
  await until(b, (s) => s.pf === session(a).me, "control back at James")

  // Rebinding: only the new key is wanted of the helper, so the old one does nothing.
  await bindTo(B)
  await press(b, B)
  await heard(b, "control-passed", 5)

  // Clearing.
  await b.efb.client.command("clients.set-setting", { key: "take-control.input", value: null })
  await b.helper.until(() => b.helper.latest!.wants().at(-1)!.bindings.length === 0, "no binding wanted")
  await b.efb.until(() => boundName(b) === undefined, "the settings saying so")

  // The session's end stops what the session turned on.
  await a.app.ok("session.leave")
  await b.app.ok("session.leave")
  await b.helper.until(() => b.helper.latest!.closed !== undefined, "the helper's exit once nothing is wanted")
})

test("the helper killed mid-session and started again: the binding takes control as before", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("take-control-killed", t)
  const a = await pilot(t, run, net, "James")
  const b = await pilot(t, run, net, "Adam")
  await flying(a, b)
  await b.efb.until(() => slice(b).denied.length === 0, "the guard allowing it")
  await bound(b, F9)
  const runs = b.helper.runs.length
  process.kill(b.helper.latest!.process!)
  await b.helper.until(() => b.helper.runs.length > runs, "the helper running again")
  await bound(b, F9)
  await press(b)
  await heard(b, "control-passed", 1)
  await shows(b, "You have control")
})
