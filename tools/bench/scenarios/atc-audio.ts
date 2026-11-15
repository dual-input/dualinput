// ATC audio between bench cores in a session, each with a stand-in core helper: the ATC host's
// capture, its frames reaching the other machine's playback stream, the stream's gain from the
// ATC volume, and the key moving (record/areas/traffic-atc/01-traffic-and-atc.md, "Cases for the
// bench"). The buffer's cases are the real helper's own tests.

import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { AtcSlice } from "../../../src/engines/messages/ts/atc-audio/AtcSlice.ts"
import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import { BenchRun, type Core } from "../cores.ts"
import { type HelperRun, StandInHelper } from "../helper.ts"
import { app, BenchNetwork, host, join } from "../network.ts"
import { FakeApp } from "../pages.ts"

/** The role's label, as ATC audio registers it. */
const ATC = "Share my ATC"

type Pilot = { core: Core; helper: StandInHelper; app: FakeApp; atc: FakeApp; name: string }

async function pilot(t: TestContext, run: BenchRun, net: BenchNetwork, name: string): Promise<Pilot> {
  const helper = await StandInHelper.start()
  t.after(() => helper.close())
  const given = helper.coreOptions()
  const core = await run.core(name, { env: given.env, settings: { ...net.core().settings, ...given.settings } })
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  return { core, helper, app: await app(core), atc: await FakeApp.open(core, ["atc-audio"]), name }
}

async function until(p: Pilot, ok: (s: SessionSlice) => boolean, what: string, ms = 15_000): Promise<void> {
  await p.app.until(() => {
    const s = p.app.slice<SessionSlice>("session")
    return s !== undefined && ok(s)
  }, `${p.name}: ${what}`, ms)
}

async function together(a: Pilot, b: Pilot): Promise<void> {
  const code = await host(a.core, a.name)
  await join(b.core, code, b.name)
  for (const p of [a, b]) await until(p, (s) => s.members.length === 2, "both members")
}

/** Turns `p`'s Share my ATC on, as the ATC audio tab's switch does, and waits until the key names them. */
async function share(p: Pilot): Promise<void> {
  await until(p, (s) => s.roles.some((r) => r.label === ATC), "ATC audio's role")
  const key = p.app.slice<SessionSlice>("session")!.roles.find((r) => r.label === ATC)!.key
  await p.app.ok("session.share", { key, on: true })
  await until(p, (s) => s.roles.find((r) => r.key === key)?.holder === s.me, "holding ATC audio's key")
}

/** The wants `p`'s helper was last sent. */
function wants(p: Pilot): Extract<HelperRun["lines"][number], { line: "wants" }> | undefined {
  return p.helper.latest?.wants().at(-1)
}

/** Waits until `p`'s helper is sent wants `ok` takes. */
async function untilWants(p: Pilot, ok: (w: NonNullable<ReturnType<typeof wants>>) => boolean, what: string): Promise<NonNullable<ReturnType<typeof wants>>> {
  await p.helper.until(() => {
    const w = wants(p)
    return w !== undefined && ok(w)
  }, `${p.name}'s helper: ${what}`)
  return wants(p)!
}

/** The frames `p`'s helper was handed for its playback stream, by number, in the order they came. */
function played(p: Pilot): number[] {
  return p.helper.runs.flatMap((r) => r.lines.flatMap((l) => (l.line === "frame" ? [l.number] : [])))
}

/** `count` frames of 80 bytes from `p`'s capture `capture`, one each 20ms, as the helper captures speech. */
async function speak(p: Pilot, capture: number, count: number): Promise<void> {
  for (let n = 0; n < count; n++) {
    p.helper.latest!.act({ act: "frame", capture, bytes: 80 })
    await sleep(20)
  }
}

test("the ATC host captures Automatic's list in its order, its frames play on the other machine in their order and at its volume, and the ATC app setting names one program", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("atc-audio", t)
  const a = await pilot(t, run, net, "James")
  const b = await pilot(t, run, net, "Adam")
  await together(a, b)
  await share(a)

  const captured = await untilWants(a, (w) => w.programs.length === 1, "a capture")
  const [capture, programs] = captured.programs[0]!
  assert.deepEqual(programs, ["BeyondATC", "SayIntentionsAI"], "Automatic captures BeyondATC, then SayIntentions")
  const listening = await untilWants(b, (w) => w.gains.length === 1, "a playback stream")
  assert.equal(listening.gains[0]![1], 1, "at 100%")

  // The helper takes SayIntentions, the only one running, and the ATC host's tab says so.
  a.helper.latest!.act({ act: "capturing", capture, program: "SayIntentionsAI" })
  await a.atc.until(() => a.atc.slice<AtcSlice>("atc-audio")?.capturing === "SayIntentionsAI", "James's tab naming SayIntentionsAI")

  await speak(a, capture, 50)
  await b.helper.until(() => played(b).length === 50, "Adam's helper handed 50 frames")
  assert.deepEqual(played(b), Array.from({ length: 50 }, (_, n) => n), "numbered from the capture's start, in order")

  // What ATC takes between the machines: the ATC host's bytes into the relay over 250 frames of 80 bytes, 32 kbps's
  // average frame, as a second of speech's 50 frames. Each frame's number, stamp, and the link's framing come on top,
  // about 53 bytes through the relay, which is why the budget is about 7KB/s rather than the speech's 4KB/s (user,
  // 2026-11-15).
  // The link's own heartbeats and acknowledgments flow with or without ATC, so their rate over the same time, read
  // while nothing talks, comes off.
  const relay = net.relays[0]!
  const sent = async () => (await relay.rates())[String(a.core.process.pid)]?.[0] ?? 0
  const quiet = await sent()
  const quietFrom = performance.now()
  await sleep(5_000)
  const idlePerMs = ((await sent()) - quiet) / (performance.now() - quietFrom)
  const before = await sent()
  const from = performance.now()
  await speak(a, capture, 250)
  await b.helper.until(() => played(b).length === 300, "Adam's helper handed 250 frames more")
  const perFrame = ((await sent()) - before - idlePerMs * (performance.now() - from)) / 250
  console.log(`budget: atc-audio: ${(perFrame * 50).toFixed(0)} bytes a second while ATC talks, ${perFrame.toFixed(1)} bytes a frame through the relay with the link's idle ${(idlePerMs * 1_000).toFixed(0)} bytes a second taken off, against about 7KB/s`)

  await b.app.ok("clients.set-setting", { key: "atc-audio.volume", value: 40 })
  await untilWants(b, (w) => w.gains.length === 1 && Math.abs(w.gains[0]![1] - 0.4) < 1e-6, "the stream at 40%")

  await a.app.ok("clients.set-setting", { key: "atc-audio.app", value: "Pilot2ATC" })
  await untilWants(a, (w) => JSON.stringify(w.programs[0]?.[1]) === JSON.stringify(["Pilot2ATC"]), "a capture of Pilot2ATC")
})

test("ATC audio's key moving closes the old stream, opens one for the new host, and drops the old host's frames", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("atc-audio-key", t)
  const a = await pilot(t, run, net, "James")
  const b = await pilot(t, run, net, "Adam")
  await together(a, b)
  await share(a)
  const [capture] = (await untilWants(a, (w) => w.programs.length === 1, "a capture")).programs[0]!
  await untilWants(b, (w) => w.gains.length === 1, "a playback stream")
  await speak(a, capture, 10)
  await b.helper.until(() => played(b).length === 10, "Adam's helper handed 10 frames")

  await share(b)
  await untilWants(b, (w) => w.gains.length === 0 && w.programs.length === 1, "Adam's stream closed, and his capture on")
  await untilWants(a, (w) => w.programs.length === 0 && w.gains.length === 1, "James's capture off, and a stream open")
  // James's helper still hands up a frame of its old capture, which his core drops, now that he isn't the ATC host.
  await speak(a, capture, 10)
  await sleep(500)
  assert.equal(played(b).length, 10, "the old ATC host's frames are dropped")
  const [own] = wants(b)!.programs[0]!
  await speak(b, own, 10)
  await a.helper.until(() => played(a).length === 10, "James's helper handed Adam's 10 frames")
  assert.deepEqual(played(a), Array.from({ length: 10 }, (_, n) => n), "numbered from the new capture's start")
})
