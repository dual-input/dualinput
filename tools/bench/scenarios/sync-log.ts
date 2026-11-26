// The Sync log: state sync's engine logging its decisions, and state sync sending the steps to a
// profile extension of this release while one is connected, on bench cores in a session on the
// stand-in sim, alone and with a second core where a case names a crew. The engine's own tests
// give each decision's steps; this scenario gives what only a core shows: when state sync logs
// and sends, whom a row names as its sender, a playback's rows, and what the log costs a run
// (record/areas/profiles/06-the-sync-log.md, "Cases").

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { type TestContext, test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import type { TapeSlice } from "../../../src/engines/messages/ts/tape/TapeSlice.ts"
import { HASH } from "../../../src/engines/messages/ts/stamp.ts"
import { budget } from "../budgets.ts"
import { BenchRun, type Core } from "../cores.ts"
import { BARON, load } from "../flights.ts"
import { app, BenchNetwork, host, join } from "../network.ts"
import { FakeApp, RawSocket } from "../pages.ts"
import { builtHashes, runBuilder } from "../profiles.ts"

/** The scenario's own profile, on names only its stand-in aircraft has. */
const PROFILE = `maker: Black Square
name: Baron 58P
status: experimental
authors: The bench
aircraft:
  variants:
    press: bksq-aircraft-baronpropress
state:
  battery:
    name: Battery
    watch: L('BATTERY')
    write: L('BATTERY')
  beacon:
    name: Beacon
    watch: L('BEACON')
    write: L('BEACON')
  lever:
    name: Mixture lever
    watch: L('LEVER')
    write: L('LEVER')
`

const FILE = "aircraft/bksq-baronpro.yaml"

/** A message's budget (record/areas/core/02-clients-and-panel-bridge.md, "Budgets"). */
const MESSAGE_BUDGET = 64 * 1024

/** A value as serde writes the sync engine's `Value`. */
type Value = { Number: number } | { Text: string }

/** A step as serde writes the sync engine's `Step`: a word alone, or a word with its fields. */
type Step = string | Record<string, Record<string, unknown>>

/** State sync's message to the profile extension, `SyncLog` in its module of the message crate. */
type SyncLog = { load: number; from: "Playback" | { Member: string } | null; steps: { row: number; at: number; entry: string; step: Step }[] }

/** A row as the scenario reads it: its entry, whom its first message named, and its steps in a few words. */
type Row = { entry: string; from: string | null; steps: string[] }

/** A pilot: a core with the bench's network and the scenario's local folder, its fake desktop app, and a fake profile extension, which also presses the recorder's buttons. */
type Pilot = { core: Core; app: FakeApp; extension: FakeApp; name: string }

async function bench(t: TestContext, name: string): Promise<{ run: BenchRun; net: BenchNetwork; local: string }> {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun(name, t)
  const local = path.join(run.folder, "local-bundles")
  const profiles = path.join(run.folder, "profile")
  fs.mkdirSync(path.join(profiles, path.dirname(FILE)), { recursive: true })
  fs.writeFileSync(path.join(profiles, FILE), PROFILE)
  assert.ok(builtHashes(runBuilder(["build", path.join(profiles, FILE), "--out", local])).get(FILE), "the profile built")
  return { run, net, local }
}

async function pilot(t: TestContext, run: BenchRun, net: BenchNetwork, name: string, local: string): Promise<Pilot> {
  const options = net.core()
  const core = await run.core(name, { ...options, settings: { ...options.settings, "profiles.local": local } })
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  // The cockpit stream's test unit stands in beside state sync, so its step says it's ready.
  core.cockpit({ act: "ready", on: true })
  const extension = await FakeApp.open(core, ["tape"], "profile-extension")
  t.after(() => extension.close())
  return { core, app: await app(core), extension, name }
}

async function until(p: Pilot, ok: (s: SessionSlice) => boolean, what: string, ms = 20_000): Promise<void> {
  await p.app.until(() => {
    const s = p.app.slice<SessionSlice>("session")
    return s !== undefined && ok(s)
  }, `${p.name}: ${what}`, ms)
}

const mine = (s: SessionSlice) => s.members.find((m) => m.pilot === s.me)

async function caughtUp(p: Pilot, ms = 20_000): Promise<void> {
  for (const started = Date.now(); Date.now() - started < ms; await sleep(100)) {
    const after = p.core.heard().length
    p.core.cockpit({ act: "report" })
    const line = await p.core.hear(/^cockpit report /, { after })
    const report = JSON.parse(line.replace(/^cockpit report /, "")) as { catching_up: boolean; replaying: boolean }
    if (!report.catching_up && !report.replaying) return
  }
  throw new Error(`${p.name} never finished catching up`)
}

/** A session `p` hosts alone in the Baron, through preflight's end; returns the session's code. */
async function alone(p: Pilot): Promise<string> {
  const code = await host(p.core, p.name)
  await until(p, (s) => s.members.length === 1, "the session")
  await load(p.core, BARON)
  await until(p, (s) => mine(s)?.in_flight === true && s.ready?.length === 0, "Ready allowed")
  await p.app.ok("session.ready", { on: true })
  await until(p, (s) => s.preflight.phase === "ended", "preflight's end")
  await caughtUp(p)
  return code
}

/** `p` joins the session `code` names, in the Baron, through its catch-up. */
async function joins(p: Pilot, code: string): Promise<void> {
  await join(p.core, code, p.name)
  await until(p, (s) => s.members.length === 2, "every member")
  await load(p.core, BARON)
  // A late joiner asks for its catch-up once its step turns ready, 1.5s after its profile loads.
  await p.core.logged("this machine takes the flying machine's catch-up", { ms: 15_000 })
  await caughtUp(p)
}

function setVariable(p: Pilot, name: string, value: number): void {
  p.core.act({ act: "set", numbers: [[name, value]], texts: [] })
}

/** Each of state sync's messages a client received, oldest first. */
function logs(client: { received(): unknown[] } | { received: unknown[] }): SyncLog[] {
  const received = typeof client.received === "function" ? client.received() : client.received
  return (received as { t: string; unit?: string; body?: unknown }[]).flatMap((m) => (m.t === "unit" && m.unit === "state-sync" ? [m.body as SyncLog] : []))
}

const shown = (v: unknown) => (v == null ? "none" : "Number" in (v as Value) ? String((v as { Number: number }).Number) : (v as { Text: string }).Text)

/** A step in a few words, under the engine's own name for it, as the engine's tests write them. */
function said(step: Step): string {
  if (typeof step === "string") return step
  const [word, fields] = Object.entries(step)[0]!
  switch (word) {
    case "ReadBack":
      return `ReadBack ${shown(fields.value)}${fields.landed ? " landed" : ""}`
    case "Writes":
      return `Writes ${(fields.actions as { name: string; values: Value[] }[]).map((a) => [a.name, ...a.values.map(shown)].join(" ")).join(", ")}`
    default:
      return "value" in fields ? `${word} ${shown(fields.value)}` : word
  }
}

/** The rows a client's messages make, in the order each began, each named by its load and its number there. */
function rows(client: FakeApp): Row[] {
  const found = new Map<string, Row>()
  for (const log of logs(client)) {
    for (const s of log.steps) {
      const key = `${log.load}/${s.row}`
      const from = log.from === null ? null : log.from === "Playback" ? "playback" : log.from.Member
      const row = found.get(key) ?? { entry: s.entry, from, steps: [] }
      row.steps.push(said(s.step))
      found.set(key, row)
    }
  }
  return [...found.values()]
}

async function rowWhere(client: FakeApp, ok: (r: Row) => boolean, what: string, ms = 10_000): Promise<Row> {
  for (const started = Date.now(); Date.now() - started < ms; await sleep(50)) {
    const row = rows(client).find(ok)
    if (row) return row
  }
  assert.fail(`no row: ${what}; the rows: ${JSON.stringify(rows(client))}`)
}

/** A client that says hello as a profile extension of another release, and stays, saying it's alive every 2s, as a client must. */
async function otherRelease(t: TestContext, core: Core): Promise<RawSocket> {
  const socket = new RawSocket(core.port(), null)
  await socket.open()
  const alive = setInterval(() => socket.send(JSON.stringify({ t: "alive" })), 2_000).unref()
  t.after(() => {
    clearInterval(alive)
    socket.close()
  })
  socket.send(JSON.stringify({ t: "hello", component: "profile-extension", version: "0.0.0", hash: HASH }))
  return socket
}

test("state sync sends its steps only while a profile extension of this release is connected", { timeout: 120_000 }, async (t) => {
  const { run, net, local } = await bench(t, "sync-log-connected")
  const p = await pilot(t, run, net, "James", local)
  p.extension.close()
  const other = await otherRelease(t, p.core)
  await alone(p)
  setVariable(p, "L:BATTERY", 1)
  await sleep(1_000)
  assert.equal(logs(other).length, 0, "an extension of another release turns no log on")

  const extension = await FakeApp.open(p.core, [], "profile-extension")
  t.after(() => extension.close())
  setVariable(p, "L:BEACON", 1)
  const beacon = await rowWhere(extension, (r) => r.entry === "beacon" && r.steps.includes("Sent"), "the beacon's change, sent")
  assert.deepEqual(beacon, { entry: "beacon", from: null, steps: ["LocalChange 1", "Sent"] })

  extension.close()
  await sleep(500)
  const before = logs(other).length
  setVariable(p, "L:BEACON", 0)
  await sleep(1_000)
  assert.equal(logs(other).length, before, "once the last extension of this release leaves, the log is off again")
  assert.equal(other.closed, null, "the other release's client stayed connected throughout")
})

test("a crewmate's change and a late joiner's catch-up are rows from the crewmate who sent them", { timeout: 180_000 }, async (t) => {
  const { run, net, local } = await bench(t, "sync-log-crew")
  const james = await pilot(t, run, net, "James", local)
  const ana = await pilot(t, run, net, "Ana", local)
  const code = await alone(james)
  setVariable(james, "L:BATTERY", 1)
  await sleep(500)
  await joins(ana, code)
  const caught = await rowWhere(ana.extension, (r) => r.entry === "battery" && r.steps.includes("ReadBack 1 landed"), "the battery's catch-up, landed")
  assert.deepEqual(caught, { entry: "battery", from: "James", steps: ["CaughtUp 1", "Writes L('BATTERY') 1", "Pending 1", "ReadBack 1 landed"] })

  setVariable(james, "L:BEACON", 1)
  const arrived = await rowWhere(ana.extension, (r) => r.entry === "beacon" && r.steps.includes("ReadBack 1 landed"), "the beacon's change, landed")
  assert.deepEqual(arrived, { entry: "beacon", from: "James", steps: ["Arrived 1", "Writes L('BEACON') 1", "Pending 1", "ReadBack 1 landed"] })
})

test("a playback's putting back and its played changes are rows from the playback", { timeout: 120_000 }, async (t) => {
  const { run, net, local } = await bench(t, "sync-log-playback")
  const p = await pilot(t, run, net, "James", local)
  await alone(p)
  const tape = () => p.extension.slice<TapeSlice>("tape")
  await p.extension.until(() => tape()?.off === null, "the recorder on")
  await p.extension.ok("tape.record")
  setVariable(p, "L:BEACON", 1)
  await sleep(500)
  await p.extension.ok("tape.stop")
  await p.extension.until(() => tape()?.state.kind === "recorded", "the recording")
  await p.extension.ok("tape.play")
  // A playback's catch-up starts a row for every entry, as any catch-up does, and writes only those
  // the cockpit doesn't already match.
  const put = await rowWhere(p.extension, (r) => r.from === "playback" && r.entry === "beacon" && r.steps[0] === "CaughtUp 0", "the beacon put back from the playback")
  assert.equal(put.steps[1], "Writes L('BEACON') 0")
  const kept = await rowWhere(p.extension, (r) => r.from === "playback" && r.entry === "battery", "the battery's row of the putting back")
  assert.deepEqual(kept.steps, ["CaughtUp 0", "AlreadyMatches"])
  await rowWhere(p.extension, (r) => r.from === "playback" && r.entry === "beacon" && r.steps[0] === "Arrived 1", "the beacon's played change")
})

test("with the log on and a lever moving, state sync's messages stay under 64 KiB and its handlers under 1ms", { timeout: 120_000 }, async (t) => {
  const { run, net, local } = await bench(t, "sync-log-lever")
  const p = await pilot(t, run, net, "James", local)
  await alone(p)
  // A lever moved for 3s, a reading about every 16ms, as a hand moves one at 60 frames a second.
  for (let n = 1; n <= 180; n++) {
    setVariable(p, "L:LEVER", n / 180)
    await sleep(16)
  }
  await sleep(500)
  const sizes = p.extension
    .received()
    .filter((m) => m.t === "unit" && m.unit === "state-sync")
    .map((m) => Buffer.byteLength(JSON.stringify(m)))
  assert.ok(sizes.length > 0, "the lever's steps reached the extension")
  const largest = Math.max(...sizes)
  console.log(`budget: ${sizes.length} of state sync's messages for a lever moved 3s, the largest ${largest.toLocaleString("en-US")} bytes, against 64 KiB`)
  budget(largest <= MESSAGE_BUDGET, `a message of ${largest} bytes`)
  p.core.send({ kind: "exit" })
  assert.equal(await p.core.exited, 0)
  p.core.checkHandlers("a run with the Sync log on and a lever moved 3s")
})
