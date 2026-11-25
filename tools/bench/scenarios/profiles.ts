// Profiles: cores fetching the bench's profiles' site at start, the pilot flying's loader
// pinning a bundle, every core in the flight loading it, and the match check's item, with the
// site held back, cut, or given newer bundles mid-session (record/areas/profiles/02-units.md,
// "Cases for the bench" and "Budgets").

import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { ProfilesSlice } from "../../../src/engines/messages/ts/profiles/ProfilesSlice.ts"
import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import type { NamedAircraft } from "../../../src/engines/messages/ts/sim/NamedAircraft.ts"
import type { SimSlice } from "../../../src/engines/messages/ts/sim/SimSlice.ts"
import { budget } from "../budgets.ts"
import { BenchRun, type Core, type CoreOptions } from "../cores.ts"
import { BARON, load, PA24, toMenu } from "../flights.ts"
import { app, BenchNetwork, host, join } from "../network.ts"
import { FakeApp, fakeMenuScript } from "../pages.ts"
import { builtHashes, copyProfiles, runBuilder } from "../profiles.ts"

/** The match check's item the profile loader owns, BUNDLE in the message crate's profiles module. */
const BUNDLE_ITEM = 4

type Pilot = { core: Core; app: FakeApp; name: string }

/** A pilot whose core uses the bench's network and profiles' site, with its sim running. */
async function pilot(run: BenchRun, net: BenchNetwork, name: string, { settings = {} }: CoreOptions = {}): Promise<Pilot> {
  const core = await run.core(name, { settings: { ...net.core().settings, ...settings } })
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  return { core, app: await app(core), name }
}

/** Hosts on the first pilot and joins the others, and waits until each lists every member. */
async function crew(...pilots: Pilot[]): Promise<void> {
  const [first, ...rest] = pilots
  const code = await host(first!.core, first!.name)
  for (const p of rest) await join(p.core, code, p.name)
  for (const p of pilots) await until(p, (s) => s.members.length === pilots.length, "every member")
}

async function until(p: Pilot, ok: (s: SessionSlice) => boolean, what: string, ms = 15_000): Promise<SessionSlice> {
  await p.app.until(() => {
    const s = p.app.slice<SessionSlice>("session")
    return s !== undefined && ok(s)
  }, `${p.name}: ${what}`, ms)
  return p.app.slice<SessionSlice>("session")!
}

/** The match check's difference over the profile, if the slice shows one. */
function bundleDifference(s: SessionSlice): SessionSlice["differences"][number] | undefined {
  return s.differences.find((d) => d.item === BUNDLE_ITEM)
}

/** Waits until the core's log holds a line `wanted` matches. */
async function logged(core: Core, wanted: RegExp, ms = 15_000): Promise<void> {
  for (const started = Date.now(); Date.now() - started < ms; await sleep(100)) if (wanted.test(core.log())) return
  throw new Error(`the core for ${core.data} never logged ${wanted}`)
}

/** The hashes of every bundle the core logged loading, in order. */
function loads(core: Core): string[] {
  return [...core.log().matchAll(/the profile loaded hash="([0-9a-f]{64})"/g)].map((m) => m[1]!)
}

const loadedLine = (hash: string): RegExp => new RegExp(`the profile loaded hash="${hash}"`)

/** Waits until the core's cache holds the bundle `hash`. */
async function cached(core: Core, hash: string, ms = 15_000): Promise<void> {
  const file = path.join(core.data, "profiles", "bundles", `${hash}.yaml`)
  for (const started = Date.now(); Date.now() - started < ms; await sleep(100)) if (fs.existsSync(file)) return
  throw new Error(`the cache of ${core.data} never held ${hash}`)
}

/** The hash of the tree's Baron 58P bundle, as tools/bench.ts published it. */
function treeBaron(): string {
  const index = JSON.parse(fs.readFileSync(path.join(process.env.DUALINPUT_BENCH_PROFILES!, "index.json"), "utf8")) as {
    profiles: { path: string; bundles: { hash: string }[] }[]
  }
  return index.profiles.find((p) => p.path === "aircraft/bksq-baronpro")!.bundles.at(-1)!.hash
}

/** A copy of the tree's profiles with the Baron's authors changed, which builds to another bundle. */
function edited(run: BenchRun, note: string): string {
  const copy = copyProfiles(path.join(run.folder, note))
  const file = path.join(copy, "aircraft", "bksq-baronpro.yaml")
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("authors: Dual Input", `authors: Dual Input, ${note}`))
  return copy
}

const BARON_FILE = "aircraft/bksq-baronpro.yaml"

test("the pilot flying's fetch finishing after the session's aircraft is set takes the pin from none to the bundle, which every core in the flight loads, and a replay loads the same", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("profiles-late-fetch", t)
  net.profiles.hold(true)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await crew(a, b)
  await load(a.core, BARON)
  await load(b.core, BARON)
  await logged(a.core, /the pilot flying pinned no profile/)
  const none = bundleDifference(await until(a, (s) => bundleDifference(s) !== undefined, "no profile's error"))
  assert.equal(none?.level, "error")
  assert.equal(none?.words, "No profile for this aircraft")

  net.profiles.hold(false)
  const hash = treeBaron()
  for (const p of [a, b]) await logged(p.core, loadedLine(hash))
  await logged(a.core, new RegExp(`the pilot flying pinned the session's profile hash="${hash}"`))
  await until(a, (s) => bundleDifference(s) === undefined, "the match check showing the bundle loaded")

  // A killed core's recording replays to its last flush, each second, so the kill waits for
  // one past the load.
  await sleep(1_500)
  await a.core.kill()
  const replayed = run.replay(a.core.recordings().at(-1)!)
  assert.match(fs.readFileSync(replayed.log, "utf8"), loadedLine(hash), "the replay loads the same bundle")
})

test("a member whose cache holds an older bundle fetches the pinned one by its hash and loads it, and a pass of control before preflight ends keeps the pin", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("profiles-older-cache", t)
  const b = await pilot(run, net, "Adam")
  const older = treeBaron()
  await cached(b.core, older)
  const newer = net.profiles.publish(edited(run, "newer")).get(BARON_FILE)!
  const a = await pilot(run, net, "James")
  await cached(a.core, newer)
  await crew(a, b)
  await load(a.core, BARON)
  await load(b.core, BARON)
  for (const p of [a, b]) await logged(p.core, loadedLine(newer))
  await cached(b.core, newer)
  await until(a, (s) => s.members.every((m) => m.in_flight) && bundleDifference(s) === undefined, "both in the flight with no difference")

  await a.app.ok("session.leave")
  await until(b, (s) => s.pf === s.me, "control passing to Adam", 10_000)
  await sleep(1_000)
  assert.doesNotMatch(b.core.log(), /pinned/, "Adam's core wrote no pin")
  assert.doesNotMatch(b.core.log(), /the profile unloaded/)
  assert.deepEqual(loads(b.core), [newer])
})

test("a member offline whose cache lacks the pin shows the error, loads nothing, and fetches it when it next enters the flight online", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("profiles-offline", t)
  const b = await pilot(run, net, "Adam")
  await cached(b.core, treeBaron())
  const newer = net.profiles.publish(edited(run, "newer")).get(BARON_FILE)!
  const a = await pilot(run, net, "James")
  await cached(a.core, newer)
  net.profiles.setCut(true)
  await crew(a, b)
  await load(a.core, BARON)
  await load(b.core, BARON)
  const s = await until(a, (s) => bundleDifference(s) !== undefined, "Adam's error")
  assert.equal(bundleDifference(s)?.words, "Adam couldn't download this aircraft's profile")
  assert.deepEqual(loads(b.core), [])

  net.profiles.setCut(false)
  await toMenu(b.core)
  await load(b.core, BARON)
  await logged(b.core, loadedLine(newer))
  await until(a, (s) => bundleDifference(s) === undefined, "the error clearing")
})

test("the pilot flying pins a local bundle: a member with the same file loads it, and one without it fetches nothing, gets it from the pilot flying, and loads it", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("profiles-local", t)
  const copy = edited(run, "local")
  const local = path.join(run.folder, "local-bundles")
  const hash = builtHashes(runBuilder(["build", path.join(copy, "aircraft", "bksq-baronpro.yaml"), "--out", local])).get(BARON_FILE)!
  const a = await pilot(run, net, "James", { settings: { "profiles.local": local } })
  const b = await pilot(run, net, "Adam", { settings: { "profiles.local": local } })
  const c = await pilot(run, net, "Rosa")
  await crew(a, b, c)
  for (const p of [a, b, c]) await load(p.core, BARON)
  await logged(a.core, new RegExp(`the pilot flying pinned the session's profile hash="${hash}" local=true`))
  for (const p of [a, b, c]) await logged(p.core, loadedLine(hash))
  await cached(c.core, hash)
  await until(a, (s) => s.members.every((m) => m.in_flight) && bundleDifference(s) === undefined, "every member in the flight with no difference")
  assert.ok(!net.profiles.requests.some((r) => r.path.includes(hash)), "no core fetched the local bundle")
})

test("the pilot flying loads the wrong aircraft, then the right one, and the pin follows; a member in the new aircraft before the new pin loads nothing for it, then the new bundle", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("profiles-aircraft-change", t)
  const copy = copyProfiles(path.join(run.folder, "with-pa24"))
  fs.writeFileSync(path.join(copy, "aircraft", "a2a-pa24.yaml"), "maker: M\nname: A\nstatus: complete\nauthors: Dual Input\naircraft:\n  variants:\n    pa24: pa24-250\n")
  const hashes = net.profiles.publish(copy)
  const baron = hashes.get(BARON_FILE)!
  const pa24 = hashes.get("aircraft/a2a-pa24.yaml")!
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  for (const p of [a, b]) for (const h of [baron, pa24]) await cached(p.core, h)
  await crew(a, b)
  await load(a.core, PA24)
  await logged(a.core, new RegExp(`the pilot flying pinned the session's profile hash="${pa24}"`))
  // Adam waits in the Baron, out of the flight, so he enters it the moment the session's
  // aircraft becomes the Baron, whether or not the new pin has arrived.
  await load(b.core, BARON)
  await toMenu(a.core)
  await load(a.core, BARON)
  await logged(a.core, new RegExp(`the pilot flying pinned the session's profile hash="${baron}"`))
  await logged(b.core, loadedLine(baron))
  assert.ok(!loads(b.core).includes(pa24), "Adam never loaded the PA-24's bundle in the Baron")
  assert.deepEqual(loads(a.core), [pa24, baron])
})

test("a member leaves the flight and comes back: the profile unloads, and the same pin loads again, though a newer bundle was published meanwhile", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("profiles-rejoin", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await crew(a, b)
  await load(a.core, BARON)
  await load(b.core, BARON)
  const hash = treeBaron()
  await logged(b.core, loadedLine(hash))
  await toMenu(b.core)
  await logged(b.core, /the profile unloaded/)
  net.profiles.publish(edited(run, "newer"))
  await load(b.core, BARON)
  for (const started = Date.now(); loads(b.core).length < 2 && Date.now() - started < 10_000; ) await sleep(100)
  assert.deepEqual(loads(b.core), [hash, hash])
})

test("a session that starts airborne with the pilot flying's cache empty pins the bundle once the fetch finishes, after preflight ended", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("profiles-airborne", t)
  net.profiles.hold(true)
  const a = await pilot(run, net, "James")
  await load(a.core, BARON, { airborne: true })
  await host(a.core, a.name)
  await until(a, (s) => s.preflight.phase === "ended", "preflight's end at once")
  await logged(a.core, /the pilot flying pinned no profile/)
  net.profiles.hold(false)
  const hash = treeBaron()
  await logged(a.core, new RegExp(`the pilot flying pinned the session's profile hash="${hash}"`))
  await logged(a.core, loadedLine(hash))
})

test("a bundle whose fetch failed at start is fetched again when the pilot hosts, and the pin goes from none to it", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("profiles-start-retry", t)
  net.profiles.refuseBundles(true)
  const a = await pilot(run, net, "James")
  await logged(a.core, /couldn't fetch a profile's bundle/)
  net.profiles.refuseBundles(false)
  await load(a.core, BARON)
  await host(a.core, a.name)
  const hash = treeBaron()
  await logged(a.core, /the profiles' fetch failed at start, so a new session tries it again/)
  await logged(a.core, new RegExp(`the pilot flying pinned the session's profile hash="${hash}"`))
  await logged(a.core, loadedLine(hash))
})

test("a cached bundle whose bytes don't match its name is deleted and fetched again", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("profiles-bad-cache", t)
  const hash = treeBaron()
  const bundles = path.join(run.folder, "James", "profiles", "bundles")
  fs.mkdirSync(bundles, { recursive: true })
  fs.writeFileSync(path.join(bundles, `${hash}.yaml`), "not the bundle\n")
  const a = await pilot(run, net, "James")
  await host(a.core, a.name)
  await load(a.core, BARON)
  await logged(a.core, /a bundle's bytes don't match its name/)
  await logged(a.core, loadedLine(hash))
  const bytes = fs.readFileSync(path.join(bundles, `${hash}.yaml`))
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), hash)
})

test("a fetch's result that arrives after this member left the flight loads nothing, and the bundle loads from the cache when it comes back", { timeout: 90_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("profiles-late-result", t)
  const b = await pilot(run, net, "Adam")
  await cached(b.core, treeBaron())
  const newer = net.profiles.publish(edited(run, "newer")).get(BARON_FILE)!
  const a = await pilot(run, net, "James")
  await cached(a.core, newer)
  await crew(a, b)
  net.profiles.hold(true)
  await load(a.core, BARON)
  await logged(a.core, loadedLine(newer))
  await load(b.core, BARON)
  await until(b, (s) => s.members.every((m) => m.in_flight), "Adam in the flight")
  await toMenu(b.core)
  net.profiles.hold(false)
  await cached(b.core, newer)
  await sleep(1_000)
  assert.deepEqual(loads(b.core), [], "the fetch's result loaded nothing out of the flight")
  const fetched = net.profiles.requests.filter((r) => r.path.includes(newer)).length
  await load(b.core, BARON)
  await logged(b.core, loadedLine(newer))
  assert.equal(net.profiles.requests.filter((r) => r.path.includes(newer)).length, fetched, "no second fetch")
})

test("a session in an aircraft with no published profile shows the loader's error", { timeout: 60_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("profiles-none", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await crew(a, b)
  await load(a.core, PA24)
  await load(b.core, PA24)
  const s = await until(a, (s) => bundleDifference(s) !== undefined, "no profile's error")
  assert.deepEqual(
    { level: bundleDifference(s)?.level, words: bundleDifference(s)?.words },
    { level: "error", words: "No profile for this aircraft" },
  )
  assert.equal(bundleDifference(s)?.note, "The cockpits won't sync")
})

/** A `UserCfg.opt` whose packages folder holds the Baron and the PA-24, or nothing when `empty`. */
function userCfg(folder: string, empty = false): string {
  const packages = path.join(folder, "packages")
  fs.mkdirSync(path.join(packages, "Community"), { recursive: true })
  if (!empty) {
    const airplanes = (name: string) => path.join(packages, "Community", name, "SimObjects", "Airplanes")
    const baron = path.join(airplanes("bksq-aircraft-baronpro"), BARON.path)
    fs.mkdirSync(baron, { recursive: true })
    fs.writeFileSync(path.join(baron, "aircraft.cfg"), `[FLTSIM.0]\r\ntitle = "Baron"\r\nui_manufacturer = "Black Square" ; e.g. Boeing, Cessna\r\nui_type = "Baron 58P Professional"\r\n`)
    const pa24 = path.join(airplanes("a2a-aircraft-pa24"), ...PA24.path.split("/"), "config")
    fs.mkdirSync(pa24, { recursive: true })
    fs.writeFileSync(path.join(pa24, "aircraft.cfg"), `[FLTSIM.0]\r\nui_manufacturer = "TT:AIRCRAFT.UI_MANUFACTURER"\r\nui_type = "PA24-250 Comanche"\r\n`)
  }
  const cfg = path.join(folder, "UserCfg.opt")
  fs.writeFileSync(cfg, `Version 1\r\nInstalledPackagesPath "${packages}"\r\n`)
  return cfg
}

test("the apps see where the pilot is, the aircraft the sim last loaded by name, and every profile's aircraft, with no session", { timeout: 60_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("profiles-slice", t)
  fs.mkdirSync(run.folder, { recursive: true })
  const a = await pilot(run, net, "James", { settings: { "sim.user-cfg": userCfg(run.folder) } })
  const watching = await FakeApp.open(a.core, ["sim", "profiles"])
  t.after(() => watching.close())
  const sim = () => watching.slice<SimSlice>("sim")
  const profiles = () => watching.slice<ProfilesSlice>("profiles")
  const installed = (s: ProfilesSlice | undefined) => s?.supported.every((p) => p.installed) === true && s.supported.length > 0

  await watching.until(() => installed(profiles()), "the Baron's profile, installed")
  assert.deepEqual(profiles(), { loaded: null, supported: [{ maker: "Black Square", model: "Baron 58P Professional", status: "Partial", installed: true, folders: [BARON.path] }], pick_failed: 0, test: null })
  assert.equal(sim()?.where, "main-menu")
  assert.equal(sim()?.aircraft, null)

  // The main menu loads the aircraft it has selected, with no flight.
  a.core.act({ act: "set", numbers: [], texts: [["A:ATC ID", "N58BS"]] })
  a.core.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "aircraft-loaded", path: BARON.cfg } }] })
  const named = (want: NamedAircraft) => watching.until(() => JSON.stringify(sim()?.aircraft) === JSON.stringify(want), `the slice naming ${want.path}`)
  await named({ path: BARON.path, maker: "Black Square", model: "Baron 58P Professional", tail: "N58BS" })
  await watching.until(() => profiles()?.loaded?.status === "Partial", "the loaded aircraft's status")

  // An `aircraft.cfg` in a `config` folder, whose token names no maker, and no profile covers it.
  a.core.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "aircraft-loaded", path: PA24.cfg } }] })
  await named({ path: PA24.path, maker: null, model: "PA24-250 Comanche", tail: "N58BS" })
  await watching.until(() => profiles()?.loaded === null, "no profile for the PA-24")

  const menu = fakeMenuScript(a.core, "world-map")
  t.after(() => menu.close())
  await watching.until(() => sim()?.where === "world-map", "the world map")
  await load(a.core, BARON)
  await watching.until(() => sim()?.where === "flight", "the flight")
  await named({ path: BARON.path, maker: "Black Square", model: "Baron 58P Professional", tail: "N58BS" })

  // In a flight the picker loads nothing; at the world map the menu script selects the Baron's
  // folder, and a pick the world map can't carry out counts as failed.
  const pick = () => watching.command("profiles.pick", { maker: "Black Square", model: "Baron 58P Professional" })
  assert.match((await pick()) ?? "", /only at the world map/)
  await toMenu(a.core)
  await watching.until(() => sim()?.where === "world-map", "back at the world map")
  menu.aircraft = [BARON]
  assert.equal(await pick(), null)
  await menu.until(() => menu.requests.some((r) => r.do === "aircraft" && r.folder === BARON.path), "the menu script asked for the Baron")
  assert.equal(profiles()?.pick_failed, 0)
  menu.aircraft = []
  assert.equal(await pick(), null)
  await watching.until(() => profiles()?.pick_failed === 1, "the failed pick counted")
})

test("a profile's aircraft no package on disk holds shows as not installed, and an aircraft with no package has no name", { timeout: 60_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("profiles-not-installed", t)
  fs.mkdirSync(run.folder, { recursive: true })
  const a = await pilot(run, net, "James", { settings: { "sim.user-cfg": userCfg(run.folder, true) } })
  const watching = await FakeApp.open(a.core, ["sim", "profiles"])
  t.after(() => watching.close())
  await watching.until(() => watching.slice<ProfilesSlice>("profiles")?.supported.length === 1, "the Baron's profile")
  await sleep(500)
  assert.equal(watching.slice<ProfilesSlice>("profiles")?.supported[0]?.installed, false)
  a.core.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "aircraft-loaded", path: BARON.cfg } }] })
  await watching.until(() => watching.slice<SimSlice>("sim")?.aircraft?.path === BARON.path, "the aircraft")
  await sleep(500)
  const aircraft = watching.slice<SimSlice>("sim")?.aircraft
  assert.equal(aircraft?.maker, null)
  assert.equal(aircraft?.model, null)
})

test("a start with nothing new published costs one answer of headers", { timeout: 60_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("profiles-unchanged", t)
  const first = await run.core("James", net.core())
  await cached(first, treeBaron())
  first.send({ kind: "exit" })
  assert.equal(await first.exited, 0)
  const before = net.profiles.requests.length
  const again = await run.core("James", net.core())
  await logged(again, /the profiles' index is unchanged/)
  await sleep(500)
  const second = net.profiles.requests.slice(before)
  console.log(`budget: a start with nothing new got ${JSON.stringify(second)}, against one answer of headers`)
  assert.deepEqual(second, [{ path: "/index.json", status: 304 }])
})

/**
 * A profile the size of the largest we plan for, 200 KB, with 300 write functions, which the
 * budgets for a build and for a load on the loop take until a profile of ours is larger
 * (record/areas/profiles/02-units.md, "Budgets"). Its names are made up, and the stand-in's
 * aircraft has none of them.
 */
function largeProfile(): string {
  let yaml = "maker: M\nname: A\nstatus: complete\nauthors: Dual Input\naircraft:\n  variants:\n    press: bksq-aircraft-baronpropress\nstate:\n"
  for (let i = 0; i < 300; i++) {
    yaml += `  switch_${i}:\n    name: Switch ${i}, a control the bench made up\n    watch: L('BENCH_SWITCH_${i}')\n    write: |\n`
    yaml += `      (value) => {\n        if (value > 0) {\n          write(L('BENCH_SWITCH_${i}'), value)\n          write(H('BENCH_SWITCH_${i}_ON'))\n        } else {\n          write(L('BENCH_SWITCH_${i}'), 0)\n          write(H('BENCH_SWITCH_${i}_OFF'))\n        }\n      }\n`
  }
  yaml += "events:\n"
  for (let i = 0; yaml.length < 210_000; i++) {
    yaml += `  event_${i}:\n    name: Event ${i}, an occurrence the bench made up\n    watch: H('BENCH_EVENT_${i}')\n    write: H('BENCH_EVENT_${i}')\n`
  }
  return yaml
}

test("a 200 KB profile of 300 write functions builds within 2s, and its load stays inside 10ms, the sync engine's compile of them included", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start(1, { emptySite: true })
  t.after(() => net.stop())
  const run = new BenchRun("profiles-large", t)
  const profiles = path.join(run.folder, "large", "profiles")
  fs.mkdirSync(path.join(profiles, "aircraft"), { recursive: true })
  const file = path.join(profiles, "aircraft", "large.yaml")
  fs.writeFileSync(file, largeProfile())

  const started = performance.now()
  runBuilder(["build", file])
  const built = performance.now() - started
  console.log(`budget: the builder checked and built a profile of 300 write functions in ${built.toFixed(0)}ms, its compiler's load included, against 2,000ms for the build`)
  budget(built < 2_000, `the build took ${built.toFixed(0)}ms`)

  const hash = net.profiles.publish(profiles).get("aircraft/large.yaml")!
  const size = fs.statSync(path.join(net.profiles.folder, "bundles", `${hash}.yaml`)).size
  assert.ok(size >= 200_000, `the bundle is ${size} bytes`)
  const a = await pilot(run, net, "James")
  await cached(a.core, hash)
  await host(a.core, a.name)
  await load(a.core, BARON)
  await logged(a.core, loadedLine(hash))
  a.core.send({ kind: "exit" })
  assert.equal(await a.core.exited, 0)
  console.log(`budget: the bundle is ${size.toLocaleString("en-US")} bytes`)
  // The compile is the sync engine's own 10ms budget for 300 write functions, the one input of the load that takes more than a handler's 1ms (record/areas/sync/05-units.md, "Budgets").
  a.core.checkHandlers(`a run that loaded a ${size.toLocaleString("en-US")}-byte bundle`, { pauseUs: 10_000 })
})
