// Test sessions: a crew in flight whose author builds a new bundle into their local folder, which
// reaches the pilot flying's core, is pinned, and reloads on every core, with what a reload must
// keep and start again (record/areas/profiles/02-units.md, "Test sessions" and "Cases for the
// bench").

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test, type TestContext } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { Notification } from "../../../src/engines/messages/ts/clients/Notification.ts"
import type { ProfilesSlice } from "../../../src/engines/messages/ts/profiles/ProfilesSlice.ts"
import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import { BenchRun, type Core } from "../cores.ts"
import { BARON, load } from "../flights.ts"
import { app, BenchNetwork, host, join } from "../network.ts"
import { FakeApp } from "../pages.ts"
import { builtHashes, runBuilder } from "../profiles.ts"

const FILE = "aircraft/bksq-baronpro.yaml"

/** The scenario's profile, on variables only its stand-in aircraft has, with `entries` after the battery. */
function profile(entries: string): string {
  return `maker: Black Square
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
${entries}`
}

const BEACON = `  beacon:
    name: Beacon
    watch: L('BEACON')
    write: L('BEACON')
`

/** A beacon whose write function never returns, which the sandbox stops at its time limit. */
const STUCK_BEACON = `  beacon:
    name: Beacon
    watch: L('BEACON')
    write: |
      (value) => {
        while (value === value) {}
      }
`

const STROBE = `  strobe:
    name: Strobe
    watch: L('STROBE')
    write: L('STROBE')
`

/** A pilot: a core with the bench's network and a local folder of its own, its fake desktop app, and a watch of the profiles' slice. */
type Pilot = { core: Core; app: FakeApp; profiles: FakeApp; name: string; local: string }

/** Builds `yaml` as the scenario's profile into `local`, as an author's tool does on a save, and returns the bundle's hash. */
function build(run: BenchRun, yaml: string, local: string, note: string): string {
  const profiles = path.join(run.folder, `profile-${note}`)
  fs.mkdirSync(path.join(profiles, "aircraft"), { recursive: true })
  fs.writeFileSync(path.join(profiles, FILE), yaml)
  const hash = builtHashes(runBuilder(["build", path.join(profiles, FILE), "--out", local])).get(FILE)
  assert.ok(hash, `the profile ${note} built`)
  return hash
}

async function pilot(t: TestContext, run: BenchRun, net: BenchNetwork, name: string, settings: Record<string, unknown> = {}): Promise<Pilot> {
  const local = path.join(run.folder, `${name}-local`)
  fs.mkdirSync(local, { recursive: true })
  const options = net.core()
  const core = await run.core(name, { ...options, settings: { ...options.settings, "profiles.local": local, ...settings } })
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  // The cockpit stream's test unit stands in beside state sync, so its step says it's ready.
  core.cockpit({ act: "ready", on: true })
  const profiles = await FakeApp.open(core, ["profiles"])
  t.after(() => profiles.close())
  return { core, app: await app(core), profiles, name, local }
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

/** A session `a` hosts and the others join, each in the Baron, through preflight's end. */
async function flying(a: Pilot, ...others: Pilot[]): Promise<void> {
  const code = await host(a.core, a.name)
  for (const p of others) await join(p.core, code, p.name)
  const all = [a, ...others]
  for (const p of all) await until(p, (s) => s.members.length === all.length, "every member")
  for (const p of all) await load(p.core, BARON)
  for (const p of all) {
    await until(p, (s) => mine(s)?.in_flight === true && s.ready?.length === 0, "Ready allowed")
    await p.app.ok("session.ready", { on: true })
  }
  for (const p of all) await until(p, (s) => s.preflight.phase === "ended", "preflight's end")
  for (const p of all) await caughtUp(p)
}

/** Whether `p`'s catch-up or a replay runs, as the cockpit stream's test unit reports it. */
async function catchingUp(p: Pilot): Promise<boolean> {
  const after = p.core.heard().length
  p.core.cockpit({ act: "report" })
  const line = await p.core.hear(/^cockpit report /, { after })
  const report = JSON.parse(line.replace(/^cockpit report /, "")) as { catching_up: boolean; replaying: boolean }
  return report.catching_up || report.replaying
}

async function caughtUp(p: Pilot, ms = 20_000): Promise<void> {
  for (const started = Date.now(); Date.now() - started < ms; await sleep(100)) if (!(await catchingUp(p))) return
  throw new Error(`${p.name} never finished catching up`)
}

/** Waits until the core's log holds a line `wanted` matches, and returns when it first did, by the bench's clock. */
async function logged(core: Core, wanted: RegExp, ms = 20_000): Promise<number> {
  for (const started = Date.now(); Date.now() - started < ms; await sleep(50)) if (wanted.test(core.log())) return Date.now()
  throw new Error(`the core for ${core.data} never logged ${wanted}`)
}

const loadedLine = (hash: string): RegExp => new RegExp(`the profile loaded hash="${hash}"`)
const pinnedNew = (hash: string): RegExp => new RegExp(`the pilot flying pinned a new local bundle, for a test session hash="${hash}"`)

function count(core: Core, wanted: RegExp): number {
  return core.log().match(new RegExp(wanted.source, "g"))?.length ?? 0
}

async function variable(p: Pilot, name: string): Promise<number> {
  const found = (await p.core.report()).variables.find(([n]) => n === name)
  return found ? Number(found[1]) : 0
}

function setVariable(p: Pilot, name: string, value: number): void {
  p.core.act({ act: "set", numbers: [[name, value]], texts: [] })
}

async function settles(what: string, get: () => Promise<number>, want: number, ms = 10_000): Promise<void> {
  let last: number | undefined
  for (const started = Date.now(); Date.now() - started < ms; await sleep(50)) {
    last = await get()
    if (last === want) return
  }
  assert.fail(`${what}: wanted ${want}, had ${String(last)}`)
}

const test_of = (p: Pilot) => p.profiles.slice<ProfilesSlice>("profiles")?.test ?? null
const edit = (p: Pilot): Notification | undefined => p.app.notifications().find((n) => n.id === "profile-loader.edit")

test("a new bundle in the pilot flying's local folder reloads on every core in flight while Follow runs on, its catch-up waits for no settling, both PCs show its hash, the banner says so once, and the same bytes again move no pin", { timeout: 150_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("test-sessions-pf", t)
  // Settling at 4s, so a catch-up that waited to settle after the reload's load would end 4s after it.
  const settle = { "state-sync.settle-ms": 4_000 }
  const pf = await pilot(t, run, net, "James", settle)
  const pm = await pilot(t, run, net, "Adam", settle)
  const first = build(run, profile(BEACON), pf.local, "first")
  await flying(pf, pm)
  // Adam's local folder holds nothing, so the pilot flying's core sent him the first bundle.
  await logged(pm.core, loadedLine(first))
  assert.ok(!net.profiles.requests.some((r) => r.path.includes(first)), "no core fetched the local bundle")

  // The pilot flying turns on a strobe no entry syncs yet, and saves the profile with an entry for it.
  setVariable(pf, "L:STROBE", 1)
  await sleep(500)
  const follows = await pm.core.followWrites()
  const second = build(run, profile(BEACON + STROBE), pf.local, "second")
  await logged(pf.core, pinnedNew(second))
  await logged(pf.core, loadedLine(second))
  const loadedAt = await logged(pm.core, loadedLine(second))
  await settles("Adam's strobe, from the catch-up after the reload", () => variable(pm, "L:STROBE"), 1)
  await caughtUp(pm)
  const caughtUpIn = Date.now() - loadedAt
  console.log(`test sessions: Adam's catch-up ended ${caughtUpIn}ms after his core loaded the new bundle, against 4,000ms of settling`)
  assert.ok(caughtUpIn < 3_500, `the catch-up waited to settle: it ended ${caughtUpIn}ms after the load`)
  const followed = (await pm.core.followWrites()) - follows
  assert.ok(followed > 40, `Follow's slot was written ${followed} times across the reload, on the connection it had before it`)

  // Both PCs show the new bundle's short hash, saved by James, and the banner says so once.
  const short = second.slice(0, 7)
  const james = slice(pf)!.me!
  for (const p of [pf, pm]) {
    await p.profiles.until(() => {
      const shown = test_of(p)
      return shown?.hash === short && shown.members.length === 2 && shown.members.every((m) => m.runs.t === "loaded" && m.runs.hash === short)
    }, `${p.name}: both PCs running ${short}`)
    assert.equal(test_of(p)?.from, james)
    await p.app.until(() => edit(p) !== undefined, `${p.name}: the banner's notice`)
  }
  assert.equal(edit(pf)?.text, "Your profile edit is loaded on both PCs")
  assert.equal(edit(pm)?.text, "James's profile edit is loaded on both PCs")
  assert.equal(edit(pm)?.detail, `Profile ${short}`)
  for (const p of [pf, pm]) assert.equal(count(p.core, /every member in the flight loaded the new local bundle/), 1, `${p.name}'s core said so once`)

  // The author's tool writes the same bytes again: a new modified time and the same hash, which moves no pin.
  const file = path.join(pf.local, "bksq-baronpro.yaml")
  fs.writeFileSync(file, fs.readFileSync(file))
  await sleep(3_000)
  assert.equal(count(pf.core, /the pilot flying pinned a new local bundle/), 1, "no second pin")
  assert.equal(count(pm.core, /the profile loaded hash=/), 2, "Adam loaded two bundles in all")
})

test("a new bundle in the following pilot's local folder reaches the pilot flying, which pins it, an entry the sandbox stopped syncs again under it, and a pilot who joins after gets it from the pilot flying", { timeout: 180_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("test-sessions-pm", t)
  const pf = await pilot(t, run, net, "James")
  const pm = await pilot(t, run, net, "Adam")
  const first = build(run, profile(STUCK_BEACON), pf.local, "first")
  fs.copyFileSync(path.join(pf.local, "bksq-baronpro.yaml"), path.join(pm.local, "bksq-baronpro.yaml"))
  await flying(pf, pm)
  await logged(pm.core, loadedLine(first))

  // The pilot flying's beacon reaches Adam's write function, which the sandbox stops, and the beacon stops syncing on Adam's machine.
  setVariable(pf, "L:BEACON", 1)
  await logged(pm.core, /an entry stops syncing on this machine for the rest of the load entry="beacon"/)
  assert.equal(await variable(pm, "L:BEACON"), 0)

  // Adam fixes the beacon and saves: his core sends the bundle to James's, which pins it, naming Adam.
  const adam = slice(pm)!.me!
  const fixed = build(run, profile(BEACON), pm.local, "fixed")
  await logged(pm.core, /this pilot's new local bundle goes to the pilot flying/)
  await logged(pf.core, new RegExp(`${pinnedNew(fixed).source} from="${adam}"`))
  for (const p of [pf, pm]) await logged(p.core, loadedLine(fixed))
  await settles("Adam's beacon, from the catch-up under the new bundle", () => variable(pm, "L:BEACON"), 1)
  await caughtUp(pm)
  // James's core sent the first bundle once, as it was pinned, and never again once Adam's replaced it.
  assert.equal(count(pf.core, new RegExp(`the pinned local bundle goes to the members who lack it hash="${first}"`)), 1, "the first bundle sent once")
  setVariable(pf, "L:BEACON", 0)
  await settles("Adam's beacon, live", () => variable(pm, "L:BEACON"), 0)
  for (const p of [pf, pm]) await p.profiles.until(() => test_of(p)?.from === adam, `${p.name}: saved by Adam`)

  // Rosa joins after the save, with nothing in her local folder or her cache, and gets the bundle from James's core as her link comes up.
  const rosa = await pilot(t, run, net, "Rosa")
  await join(rosa.core, slice(pf)!.code!, rosa.name)
  await until(rosa, (s) => s.members.length === 3, "every member")
  await load(rosa.core, BARON)
  await logged(rosa.core, loadedLine(fixed))
  assert.ok(!net.profiles.requests.some((r) => r.path.includes(fixed)), "no core fetched the local bundle")
  assert.ok(fs.existsSync(path.join(rosa.core.data, "profiles", "bundles", `${fixed}.yaml`)), "Rosa's cache keeps it")
})
