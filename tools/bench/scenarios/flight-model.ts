// Flight-model sync between bench cores in a session in the Baron 58P: the flying core's
// stand-in aircraft moves by its velocities, `Lead` reports it, and each following core's
// `Follow` draws its own stand-in aircraft 400ms behind
// (record/areas/flight-model/01-flight-model-sync.md, "Cases for the bench";
// record/areas/architecture/02-code-map.md, "Cases for the bench, for work in the sim").
//
// Each stand-in sends its aircraft's place after every frame, stamped with the PC's own time,
// which two cores on one PC share, so a scenario lays one aircraft's path over another's.

import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { Notification } from "../../../src/engines/messages/ts/clients/Notification.ts"
import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import { BenchRun, type Core, type Stub } from "../cores.ts"
import { BARON, load, toMenu } from "../flights.ts"
import { app, BenchNetwork, host, join } from "../network.ts"
import { type FakeApp, fakeMenuScript } from "../pages.ts"

/** What each stand-in sends after every frame, in this order. */
const TRACKED = ["A:PLANE LATITUDE", "A:PLANE LONGITUDE", "A:PLANE ALTITUDE", "A:IS LATITUDE LONGITUDE FREEZE ON", "A:IS ALTITUDE FREEZE ON", "A:IS ATTITUDE FREEZE ON", "A:AILERON POSITION", "A:BRAKE LEFT POSITION"]

/** 150 kt, in feet per second and in meters per second. */
const SPEED_FT = 253.2
const SPEED = SPEED_FT * 0.3048
/** How far behind the samples a following aircraft is drawn, in seconds. */
const DELAY = 0.4

/** One frame of a stand-in's aircraft: when, in seconds of the PC's time, where, in meters north and east of the scenario's start and feet up, whether all three freezes are on, and two of its controls. */
type Point = { t: number; north: number; east: number; alt: number; frozen: boolean; aileron: number; brake: number }

/** Where every scenario's flying aircraft starts: over Switzerland, heading east. */
const START = { lat: 47, lon: 8, alt: 5_000 }
const METERS_NORTH = 111_195
const METERS_EAST = METERS_NORTH * Math.cos((START.lat * Math.PI) / 180)

type Pilot = { core: Core; app: FakeApp; name: string; from: number; sim: Stub }

async function pilot(run: BenchRun, net: BenchNetwork, name: string, settings: Record<string, unknown> = {}): Promise<Pilot> {
  const core = await run.core(name, { settings: { ...net.core().settings, ...settings } })
  const sim = run.stub()
  core.act({ act: "watch", process: sim.id })
  await core.hear("stage Starting aircraft none")
  core.act({ act: "track", names: TRACKED })
  return { core, app: await app(core), name, from: 0, sim }
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

/** A session `a` hosts and the others join, with nobody yet in a flight. */
async function together(a: Pilot, ...others: Pilot[]): Promise<void> {
  const code = await host(a.core, a.name)
  for (const p of others) await join(p.core, code, p.name)
  for (const p of [a, ...others]) await until(p, (s) => s.members.length === others.length + 1, "every member")
}

/** Puts `p`'s aircraft `east` meters east and `north` meters north of the start, flying east at 150 kt, or standing when `still`. */
function place(p: Pilot, { east = 0, north = 0, still = false } = {}): void {
  p.core.act({
    act: "set",
    numbers: [
      ["A:PLANE LATITUDE", START.lat + north / METERS_NORTH],
      ["A:PLANE LONGITUDE", START.lon + east / METERS_EAST],
      ["A:PLANE ALTITUDE", START.alt],
      ["A:PLANE HEADING DEGREES TRUE", 90],
      ["A:VELOCITY BODY Z", still ? 0 : SPEED_FT],
    ],
    texts: [],
  })
}

/** Loads `p` into a flight in the air, so preflight ends as its pilot flying arrives. */
async function airborne(p: Pilot, where: Parameters<typeof place>[1] = {}): Promise<void> {
  place(p, where)
  await load(p.core, BARON, { airborne: true })
  await until(p, (s) => mine(s)?.in_flight === true, "in the flight")
}

/** `p`'s aircraft, frame by frame, since `p.from`, a count of the core's lines. */
function path(p: Pilot): Point[] {
  return p.core.tracked(p.from).map(({ at, values }) => {
    const [lat, lon, alt, ...rest] = values as [number, number, number, number, number, number, number, number]
    const [f1, f2, f3, aileron, brake] = rest
    return { t: at / 1e6, north: (lat - START.lat) * METERS_NORTH, east: (lon - START.lon) * METERS_EAST, alt, frozen: f1 === 1 && f2 === 1 && f3 === 1, aileron, brake }
  })
}

/** Forgets `p`'s path so far. */
function mark(...pilots: Pilot[]): void {
  for (const p of pilots) p.from = p.core.lineCount()
}

/** Where `points` puts its aircraft at `t`, along a straight line between the two frames around it, or undefined outside them. */
function at(points: Point[], t: number): Point | undefined {
  const i = points.findIndex((p) => p.t >= t)
  if (i <= 0) return undefined
  const [a, b] = [points[i - 1]!, points[i]!]
  const k = (t - a.t) / (b.t - a.t)
  return { ...b, t, north: a.north + (b.north - a.north) * k, east: a.east + (b.east - a.east) * k, alt: a.alt + (b.alt - a.alt) * k }
}

const apart = (a: Point, b: Point) => Math.hypot(a.north - b.north, a.east - b.east, (a.alt - b.alt) * 0.3048)

/** How far `follower` is from where `leader` was `DELAY` earlier, in meters, at each of the follower's frames after `since`. */
function behind(leader: Point[], follower: Point[], since: number): number[] {
  return follower.flatMap((f) => {
    const was = f.t >= since ? at(leader, f.t - DELAY) : undefined
    return was ? [apart(f, was)] : []
  })
}

/** The aircraft's speed over each pair of frames at least 5ms apart, in meters per second. */
function speeds(points: Point[]): number[] {
  const out: number[] = []
  let last = points[0]
  for (const p of points.slice(1)) {
    if (last && p.t - last.t >= 0.005) {
      out.push(apart(p, last) / (p.t - last.t))
      last = p
    }
  }
  return out
}

/** The PC's time now, in seconds, as a stand-in stamps a frame. */
const now = () => Date.now() / 1e3

/** Two pilots in a flight in the air: James flies east at 150 kt, and Adam, loaded 30km east of him and standing still, follows. */
async function flying(t: TestContext, scenario: string, settings: Record<string, unknown> = {}): Promise<{ run: BenchRun; net: BenchNetwork; a: Pilot; b: Pilot }> {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun(scenario, t)
  const a = await pilot(run, net, "James", settings)
  const b = await pilot(run, net, "Adam", settings)
  await together(a, b)
  await airborne(a)
  await until(a, (s) => s.preflight.phase === "ended", "preflight's end")
  await airborne(b, { east: 30_000, still: true })
  // A core takes no sample until the network has its sender's clock offset, which comes with the link's first exchange of heartbeats, up to 2s after the link.
  // The first sample is then drawn 400ms after it arrives, over 1km away, so it's written at once.
  await settled(a, b)
  return { run, net, a, b }
}

/** Waits until `b` has been within 5m of where `a` was 400ms before for 500ms on end. */
async function settled(a: Pilot, b: Pilot, ms = 15_000): Promise<void> {
  for (const started = Date.now(); Date.now() - started < ms; await sleep(100)) {
    const off = behind(path(a), path(b), now() - 0.5)
    if (off.length > 20 && Math.max(...off) < 5) return
  }
  throw new Error(`${b.name}'s aircraft never settled 400ms behind ${a.name}'s`)
}

function takeControl(p: Pilot): void {
  p.core.cockpit({ act: "take-control" })
}

test("one core's aircraft moves on the other's 400ms behind it, with its yoke and brake, 20 samples a second, and after a take-control the two swap", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("flight-model", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await together(a, b)
  await airborne(a)
  await until(a, (s) => s.preflight.phase === "ended", "preflight's end")

  // A sample while this pilot is out of the flight is dropped: Adam's aircraft, in the main menu, is never frozen or moved.
  place(b, { east: 30_000, still: true })
  await sleep(300)
  mark(b)
  await sleep(1_500)
  const before = path(b)
  assert.ok(before.every((p) => !p.frozen && Math.abs(p.east - 30_000) < 0.01), "Adam's aircraft stays his own while he's out of the flight")

  // Adam enters the flight 30km away, over 1km, so his aircraft is written at the first drawn pose at once.
  await load(b.core, BARON, { airborne: true })
  await until(b, (s) => mine(s)?.in_flight === true, "in the flight")
  await settled(a, b)
  const jumped = path(b).filter((p) => p.frozen)
  const far = jumped.filter((p) => Math.abs(p.east - 30_000) > 1 && apart(p, at(path(a), p.t - DELAY) ?? p) > 50)
  assert.equal(far.length, 0, "Adam's aircraft went from where it loaded to the drawn pose in one frame")

  // The flying pilot moves the yoke and holds the left brake: the following aircraft's move through the axis events.
  a.core.act({ act: "set", numbers: [["A:AILERON POSITION", -4_000], ["A:BRAKE LEFT POSITION", 16_384]], texts: [] })
  mark(a, b)
  const writes = await b.core.followWrites()
  await sleep(10_000)
  const fed = (await b.core.followWrites()) - writes
  const [lead, follow] = [path(a), path(b)]
  const off = behind(lead, follow, lead[0]!.t + 1)
  const worst = Math.max(...off)
  const lag = DELAY * 1_000 + ((off.reduce((x, y) => x + y, 0) / off.length) * 1_000) / SPEED
  console.log(`budget: flight-model: the following aircraft was within ${worst.toFixed(2)}m of where the flying one was 400ms before, over ${off.length} frames, so at most about ${Math.round(lag)}ms behind against 400ms plus the modules' shortfalls`)
  assert.ok(worst < 4, `the following aircraft strayed ${worst.toFixed(2)}m from the flying one's path 400ms before`)
  assert.ok(follow.every((p) => p.frozen), "the following aircraft stays frozen")
  assert.equal(follow.at(-1)!.aileron, -4_000, "the yoke")
  assert.equal(follow.at(-1)!.brake, 16_384, "the left brake")
  // 20 samples a second and the core's rewrite of the slot every 200ms make 25 writes a second.
  console.log(`budget: flight-model: Adam's core wrote Follow's slot ${fed} times in 10s, against about 250 for 20 samples a second and 5 rewrites`)
  assert.ok(fed > 235 && fed < 265, `Follow's slot was written ${fed} times in 10s`)

  // Adam takes control: his aircraft unfreezes and flies on from the velocities last written, and James's, which flew itself, eases back behind it.
  mark(a, b)
  takeControl(b)
  await until(b, (s) => s.pf === s.me, "control passing")
  const passed = now()
  await sleep(6_000)
  const [was, is] = [path(a), path(b)]
  const unfrozen = is.find((p) => !p.frozen)
  assert.ok(unfrozen && unfrozen.t - passed < 0.5, "the new pilot flying's aircraft unfroze as its Follow ended")
  assert.ok(is.filter((p) => p.t > unfrozen.t).every((p) => !p.frozen), "and stayed unfrozen")
  const flew = speeds(is.filter((p) => p.t > unfrozen.t))
  assert.ok(Math.min(...flew) > SPEED * 0.9 && Math.max(...flew) < SPEED * 1.1, `the new pilot flying's aircraft flies on at the speed last written: ${Math.min(...flew).toFixed(1)} to ${Math.max(...flew).toFixed(1)} m/s`)
  const eased = speeds(was)
  assert.ok(Math.min(...eased) > SPEED * 0.5 && Math.max(...eased) < SPEED * 1.2, `the ex-pilot flying's aircraft never stops or jumps: ${Math.min(...eased).toFixed(1)} to ${Math.max(...eased).toFixed(1)} m/s`)
  assert.ok(was.at(-1)!.frozen, "the ex-pilot flying's aircraft is frozen")
  const after = behind(is, was, passed + 4.5)
  assert.ok(after.length > 20 && Math.max(...after) < 4, `the ex-pilot flying's aircraft eased back to ${Math.max(...after).toFixed(2)}m from the new one's path`)
  // The loop's stats for the whole run, which the core logs as it exits: a sample 20 times a second, in and out, stays within a handler's 1ms.
  for (const p of [a, b]) {
    p.core.send({ kind: "exit" })
    assert.equal(await p.core.exited, 0)
    p.core.checkHandlers(`${p.name}'s run, with a sample 20 times a second`)
  }
})

test("a report 193ms late leaves the following aircraft's path where it was, and a pilot flying in the pause menu has it hold, whether or not the module updates", { timeout: 120_000 }, async (t) => {
  const { a, b } = await flying(t, "flight-model-late-and-pause")
  mark(a, b)
  a.core.act({ act: "late-report", delay_ms: 193 })
  await sleep(2_000)
  const late = behind(path(a), path(b), path(a)[0]!.t + 0.5)
  assert.ok(Math.max(...late) < 4, `a late report moved the following aircraft ${Math.max(...late).toFixed(2)}m off the path`)

  for (const updating of [true, false]) {
    // The pause menu: `Pause_EX1` raises 8, the aircraft stands still, and the module's update runs or doesn't.
    a.core.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "pause", flags: 8 } }] })
    if (!updating) a.core.act({ act: "frames", per_second: 0 })
    await sleep(1_000)
    mark(b)
    await sleep(3_000)
    const held = path(b)
    const moved = apart(held[0]!, held.at(-1)!)
    assert.ok(moved < 0.01 && held.every((p) => p.frozen), `with the module ${updating ? "updating" : "stopped"}, the following aircraft held through the pause: it moved ${moved.toFixed(3)}m`)
    if (!updating) a.core.act({ act: "frames", per_second: 89 })
    a.core.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "pause", flags: 0 } }] })
    // The first report after the pause is taken, and the aircraft moves on from where it held.
    await sleep(1_500)
    mark(a, b)
    await sleep(1_500)
    const on = behind(path(a), path(b), path(a)[0]!.t + 0.5)
    assert.ok(on.length > 20 && Math.max(...on) < 4, `after the pause the following aircraft is ${Math.max(...on).toFixed(2)}m off the path`)
    const pace = speeds(path(b))
    assert.ok(Math.max(...pace) < SPEED * 1.2, `after the pause it moved on with no jump: ${Math.max(...pace).toFixed(1)} m/s at most`)
  }
})

test("the 2s move to the relay is carried and eased back, and a 20s gap is carried 2s, held frozen, and written at once when samples return", { timeout: 180_000 }, async (t) => {
  const { net, a, b } = await flying(t, "flight-model-gaps")
  mark(a, b)
  const cut = now()
  await net.relays[0]!.cut(a.core.process.pid!, 2_000)
  // A fixed wait fails here on a quiet PC. QUIC sends again only at its next probe of the silent path, and its probes come at intervals that double, so the samples can return about 2s after the cut ends, and the ease back takes 3s more.
  // The aircraft was back within 6s of the cut's start with other programs running, and 7.5s after it on a quiet PC, so this waits for its return (measured on our development machine, 2026-11-12, record/areas/flight-model/log.md).
  await sleep(4_000)
  await settled(a, b, 6_000)
  const returned = now()
  await sleep(1_500)
  const [lead, follow] = [path(a), path(b)]
  assert.ok(follow.every((p) => p.frozen), "frozen through the gap")
  // On a straight path the carry runs along the path itself, so for the 2s it lasts the aircraft stays where it belongs.
  // The carry starts once the newest sample is 400ms old.
  const onPath = behind(lead, follow.filter((p) => p.t < cut + 2.3), cut)
  assert.ok(Math.max(...onPath) < 6, `through the 2s of its carry the following aircraft strayed ${Math.max(...onPath).toFixed(2)}m`)
  // The gap can outlast the carry, and the aircraft then holds and eases back, at up to a third of its speed more, with no jump.
  const pace = speeds(follow)
  assert.ok(Math.max(...pace) < SPEED * 1.8, `it never jumped: ${Math.max(...pace).toFixed(1)} m/s at most`)
  console.log(`the following aircraft was back on the path ${(returned - cut).toFixed(1)}s after the 2s cut began`)
  assert.ok(returned - cut < 9, `it eased back onto the path within 9s of the cut: ${(returned - cut).toFixed(1)}s`)
  const back = behind(lead, follow, returned + 0.5)
  assert.ok(back.length > 20 && Math.max(...back) < 4, `it stayed on the path once back: ${Math.max(...back).toFixed(2)}m off`)

  mark(a, b)
  const long = now()
  await net.relays[0]!.cut(a.core.process.pid!, 20_000)
  // The carry keeps the aircraft on a straight path for its first 2s, so this waits out the cut before it looks for the two together again.
  await sleep(21_000)
  await settled(a, b, 60_000)
  const gap = path(b)
  assert.ok(gap.every((p) => p.frozen), "frozen through the 20s gap")
  // The carry ends 2s past the newest sample, which is drawn 400ms after it arrived.
  const [stopped, still] = [at(gap, long + 3.5)!, at(gap, long + 15)!]
  assert.ok(apart(stopped, still) < 0.01, `the following aircraft held once its carry ended: it moved ${apart(stopped, still).toFixed(2)}m in 11.5s`)
  const carried = apart(at(gap, long + 0.3)!, stopped)
  assert.ok(carried > SPEED * 1.5 && carried < SPEED * 2.6, `it was carried for about 2s: ${carried.toFixed(0)}m`)
  // The samples come back over 1km on, so the aircraft is written there in one frame.
  const leap = Math.max(...gap.slice(1).map((p, i) => apart(p, gap[i]!)))
  assert.ok(leap > 1_000, `it was written at once when samples returned: a step of ${leap.toFixed(0)}m`)
})

test("a joiner 10m from the pilot flying's stand eases there over 3s, and stays frozen as preflight's hold ends", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("flight-model-stand", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  await together(a, b)
  await load(a.core, BARON)
  place(a, { still: true })
  await until(a, (s) => mine(s)?.in_flight === true, "in the flight")
  place(b, { east: 10, still: true })
  mark(a, b)
  await load(b.core, BARON)
  await until(b, (s) => mine(s)?.in_flight === true, "in the flight")
  const entered = now()
  // The link's first clock offset can take 2s, then the first sample 400ms to be drawn, then the ease 3s.
  await sleep(7_000)
  const eased = path(b).filter((p) => p.t > entered)
  const pace = speeds(eased)
  assert.ok(Math.max(...pace) < 6, `the joiner slid to the pilot flying's stand at ${Math.max(...pace).toFixed(1)} m/s at most, 10m in 3s`)
  assert.ok(Math.abs(eased.at(-1)!.east) < 0.05, `and stands on it: ${eased.at(-1)!.east.toFixed(2)}m off`)
  const sliding = eased.filter((p, i) => i > 0 && Math.abs(p.east - eased[i - 1]!.east) > 1e-4)
  const took = sliding.at(-1)!.t - sliding[0]!.t
  assert.ok(took > 2.8 && took < 3.2, `the ease took ${took.toFixed(2)}s`)

  // Both Ready, the countdown, and preflight's end: the hold ends while Follow runs, and the aircraft never unfreezes.
  mark(b)
  for (const p of [a, b]) {
    await until(p, (s) => mine(s)?.in_flight === true && s.ready?.length === 0, "Ready allowed")
    await p.app.ok("session.ready", { on: true })
  }
  for (const p of [a, b]) await until(p, (s) => s.preflight.phase === "ended", "preflight's end", 30_000)
  await sleep(1_000)
  assert.ok(path(b).every((p) => p.frozen), "the following aircraft stayed frozen from preflight's hold into following")
  const { variables } = await a.core.report()
  assert.equal(new Map(variables).get("IS ALTITUDE FREEZE ON"), "0", "and the pilot flying's was let go")
})

test("with three cores, across a change of pilot flying, the third machine takes the new one's samples", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("flight-model-three", t)
  const a = await pilot(run, net, "James")
  const b = await pilot(run, net, "Adam")
  const c = await pilot(run, net, "Mira")
  await together(a, b, c)
  await airborne(a)
  await until(a, (s) => s.preflight.phase === "ended", "preflight's end")
  await airborne(b, { east: 30_000, still: true })
  await airborne(c, { north: 30_000, still: true })
  await settled(a, b)
  await settled(a, c)

  takeControl(b)
  for (const p of [a, b, c]) await until(p, (s) => s.pf === slice(b).me, "control passing to Adam")
  // Adam turns north, which only his samples show.
  b.core.act({ act: "set", numbers: [["A:PLANE HEADING DEGREES TRUE", 0]], texts: [] })
  await sleep(4_000)
  mark(a, b, c)
  await sleep(2_000)
  for (const p of [a, c]) {
    const off = behind(path(b), path(p), path(b)[0]!.t + 0.5)
    assert.ok(off.length > 20 && Math.max(...off) < 4, `${p.name}'s aircraft follows the new pilot flying's, ${Math.max(...off).toFixed(2)}m off at most`)
    const north = path(p).at(-1)!.north - path(p)[0]!.north
    const flown = path(b).at(-1)!.north - path(b)[0]!.north
    assert.ok(north > SPEED, `${p.name}'s aircraft heads north with it: ${north.toFixed(0)}m, where the pilot flying's went ${flown.toFixed(0)}m`)
  }
})

test("a restarted core that follows shows no trouble for our package before the module's first status write", { timeout: 120_000 }, async (t) => {
  const { run, net, a, b } = await flying(t, "flight-model-restart")
  const sim = (await b.core.report()).variables
  await b.core.kill()
  // The core crashes while its sim flies on: the next stand-in's sim already holds the aircraft, which the AircraftLoaded state answers with, and the menu script's master page takes the core from Starting to Flying, into the flight its session file names.
  const core = await run.core("Adam", net.core())
  core.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "aircraft-loaded", path: BARON.cfg } }] })
  core.act({ act: "set", numbers: [["A:SIM ON GROUND", 0], ["A:PLANE LATITUDE", Number(new Map(sim).get("PLANE LATITUDE"))], ["A:PLANE LONGITUDE", Number(new Map(sim).get("PLANE LONGITUDE"))], ["A:PLANE ALTITUDE", START.alt]], texts: [["A:TITLE", "Baron 58P"], ["A:LIVERY NAME", "N515MR"]] })
  core.act({ act: "track", names: TRACKED })
  await sleep(100)
  const menu = fakeMenuScript(core, "in-game")
  t.after(() => menu.close())
  const restarted: Pilot = { core, app: await app(core), name: "Adam", from: 0, sim: b.sim }
  core.act({ act: "watch", process: b.sim.id })
  await core.hear(`stage Flying aircraft ${BARON.path}`, { ms: 15_000 })
  await until(restarted, (s) => mine(s)?.in_flight === true, "back in the flight", 30_000)
  await settled(a, restarted, 30_000)
  const shown = restarted.app.received().flatMap((m) => (m.t === "state" && m.slice === "notifications" ? (m.value as Notification[]) : []))
  const trouble = [...new Set(shown.filter((n) => /WASM module/.test(n.text)).map((n) => n.text))]
  assert.deepEqual(trouble, [], "no notification about our module while it only hadn't written its status yet")
})

test("after a flight ends, the routine ends, and the aircraft is the pilot's own again", { timeout: 120_000 }, async (t) => {
  const { a, b } = await flying(t, "flight-model-leaves")
  await toMenu(b.core)
  await until(b, (s) => mine(s)?.in_flight === false, "out of the flight")
  await sleep(500)
  mark(b)
  await sleep(1_000)
  assert.ok(path(b).every((p) => !p.frozen), "a pilot who left the flight has an aircraft nothing freezes")
  // The pilot flying leaves too: nobody is left in the flight, so the session ends, and Lead with it.
  await toMenu(a.core)
  for (const started = Date.now(); !/flight-model sync runs no routine/.test(a.core.log()); await sleep(50)) {
    assert.ok(Date.now() - started < 10_000, "the pilot flying's core ended Lead as it left the flight")
  }
})
