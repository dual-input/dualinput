// The profile extension's recorder, the core's platform unit `tape`, on bench cores in a session
// on the stand-in sim, alone and with a second core where a case names a crew: Play puts the
// cockpit back as it stood at Record, then plays each recorded change into it as a crewmate's at
// its recorded time, a press on a fake cockpit panel's display included, while the stand-in's
// aircraft flies the recorded path through `Follow`; what Stop, a member joining, and a save's
// reload stop; and what the recorder refuses (record/areas/profiles/05-the-recorder.md, "Cases").

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { type TestContext, test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { Called } from "../../../src/engines/messages/ts/bench/Called.ts"
import type { Notification } from "../../../src/engines/messages/ts/clients/Notification.ts"
import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import type { TapeSlice } from "../../../src/engines/messages/ts/tape/TapeSlice.ts"
import { budget } from "../budgets.ts"
import { BenchRun, type Core } from "../cores.ts"
import { BARON, load, METERS_EAST, METERS_NORTH, SPEED_FT, START } from "../flights.ts"
import { app, BenchNetwork, host, join } from "../network.ts"
import { FakeApp } from "../pages.ts"
import { FakeCockpitPanel, TABLET } from "../panel.ts"
import { builtHashes, runBuilder } from "../profiles.ts"

/** The scenario's own profile, with an entry of each kind a recording holds, on names only its stand-in aircraft has. */
function profile(extra = ""): string {
  return `maker: Black Square
name: Baron 58P
maturity: experimental
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
  apu:
    name: APU master
    watch: L('APU')
    write: L('APU')
  throttle:
    name: Throttle
    owner: pilot_flying
    watch: L('THROTTLE')
    write: L('THROTTLE')
  lamp:
    name: Lamp
    watch: L('LAMP')
    write:
      toggle: K('TOGGLE_LAMP')
  heading:
    name: Heading bug
    watch: L('HDG')
    write:
      inc: K('HDG_INC')
      dec: K('HDG_DEC')
      wrap: true
      range: [0, 359]
      pace: 2 frames
  com:
    name: COM frequency
    default: 0
    watch:
      inc: K('COM_INC')
      dec: K('COM_DEC')
      wrap: false
      range: [0, 100]
    write:
      inc: K('COM_INC')
      dec: K('COM_DEC')
${extra}events:
  ap_master:
    name: Autopilot master
    watch: K('AP_MASTER')
    write: K('AP_MASTER')
`
}

/** An entry a save adds, which makes the bundle's hash another. */
const STROBE = "  strobe:\n    name: Strobe\n    watch: L('STROBE')\n    write: L('STROBE')\n"
const LOGO = "  logo:\n    name: Logo light\n    watch: L('LOGO')\n    write: L('LOGO')\n"

/**
 * The profile with the fake cockpit panel's display, for the one case that opens a panel. A
 * profile that names a display raises the clients crate's trouble when no cockpit panel says
 * hello within 10s, so the other cases keep a profile without one.
 */
const WITH_DISPLAY = profile().replace("\nstate:\n", `\ndisplays: ${TABLET}\nstate:\n`)

const FILE = "aircraft/bksq-baronpro.yaml"

/** Builds `yaml` into `out`, as an author's save does, and returns the bundle's hash. */
function build(run: BenchRun, yaml: string, note: string, out: string): string {
  const profiles = path.join(run.folder, `profile-${note}`)
  fs.mkdirSync(path.join(profiles, path.dirname(FILE)), { recursive: true })
  fs.writeFileSync(path.join(profiles, FILE), yaml)
  const hash = builtHashes(runBuilder(["build", path.join(profiles, FILE), "--out", out])).get(FILE)
  assert.ok(hash, `the profile ${note} built`)
  return hash
}

const NO_FLIGHT = "the recorder works in a session's flight"
const CREW = "the recorder works only while you're alone in the session"
const LOADING = "the profile is still loading"

/** The variables the stand-in reports after each of its frames, in this order. */
const TRACKED = ["L:BATTERY", "L:BEACON", "L:APU", "L:THROTTLE", "L:HDG", "L:LAMP"] as const
type Tracked = (typeof TRACKED)[number]

/**
 * The stand-in aircraft's heading bug, which turns a degree for each `K:HDG_INC` or `K:HDG_DEC`
 * the core sends, as the 58P's does. A stepping write that never reads back is flagged and leaves
 * the next write stepping from the old reading, and the stand-in has no rule that adds, so a rule
 * of each event fires an `H:` event the bench hears, and the bench sets `L:HDG` a degree on.
 */
class HeadingBug {
  value = 0
  private readonly core: Core

  constructor(core: Core) {
    this.core = core
    for (const event of ["HDG_INC", "HDG_DEC"]) {
      core.act({ act: "rule", when: { when: "sent", name: event }, after_ms: 0, then: { then: "fire", name: `BENCH_${event}` } })
    }
    core.onHEvent((name) => {
      if (name === "BENCH_HDG_INC") this.set(this.value + 1)
      if (name === "BENCH_HDG_DEC") this.set(this.value - 1)
    })
  }

  /** Turns the bug to `to`, as a pilot's hand does. */
  set(to: number): void {
    this.value = ((to % 360) + 360) % 360
    this.core.act({ act: "set", numbers: [["L:HDG", this.value]], texts: [] })
  }
}

/** A pilot: a core with the bench's network and the scenario's local folder, its fake desktop app, the fake `serve` that presses the recorder's buttons, and the heading bug. */
type Pilot = { core: Core; app: FakeApp; deck: FakeApp; name: string; bug: HeadingBug }

async function pilot(t: TestContext, run: BenchRun, net: BenchNetwork, name: string, local: string): Promise<Pilot> {
  const options = net.core()
  const core = await run.core(name, { ...options, settings: { ...options.settings, "profiles.local": local } })
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  // The cockpit stream's test unit stands in beside state sync, so its step says it's ready.
  core.cockpit({ act: "ready", on: true })
  // The lamp's toggle flips it, as the aircraft's switch would.
  core.act({ act: "rule", when: { when: "sent", name: "TOGGLE_LAMP" }, after_ms: 0, then: { then: "flip", name: "L:LAMP" } })
  core.act({ act: "track", names: [...TRACKED] })
  const deck = await FakeApp.open(core, ["tape", "notifications"], "profile-extension")
  t.after(() => deck.close())
  return { core, app: await app(core), deck, name, bug: new HeadingBug(core) }
}

/** A fresh network and run, and `yaml`, the scenario's profile unless given, built into a local folder, which the host's core pins. */
async function bench(t: TestContext, name: string, yaml = profile()): Promise<{ run: BenchRun; net: BenchNetwork; local: string }> {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun(name, t)
  const local = path.join(run.folder, "local-bundles")
  build(run, yaml, "session", local)
  return { run, net, local }
}

async function until(p: Pilot, ok: (s: SessionSlice) => boolean, what: string, ms = 20_000): Promise<void> {
  await p.app.until(() => {
    const s = p.app.slice<SessionSlice>("session")
    return s !== undefined && ok(s)
  }, `${p.name}: ${what}`, ms)
}

const mine = (s: SessionSlice) => s.members.find((m) => m.pilot === s.me)

/** A session `p` hosts alone in the Baron, through preflight's end, with the recorder on; returns the session's code. */
async function alone(p: Pilot): Promise<string> {
  const code = await host(p.core, p.name)
  await until(p, (s) => s.members.length === 1, "the session")
  await load(p.core, BARON)
  await until(p, (s) => mine(s)?.in_flight === true && s.ready?.length === 0, "Ready allowed")
  await p.app.ok("session.ready", { on: true })
  await until(p, (s) => s.preflight.phase === "ended", "preflight's end")
  await caughtUp(p)
  await tapeUntil(p, (s) => s.off === null, "the recorder on")
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

type CockpitReport = { catching_up: boolean; replaying: boolean; kept: number; waiting: number }

/** What the cockpit stream holds: whether it catches up or replays, and how many messages it keeps and has waiting to apply. */
async function cockpit(p: Pilot): Promise<CockpitReport> {
  const after = p.core.heard().length
  p.core.cockpit({ act: "report" })
  const line = await p.core.hear(/^cockpit report /, { after })
  return JSON.parse(line.replace(/^cockpit report /, "")) as CockpitReport
}

async function caughtUp(p: Pilot, ms = 20_000): Promise<void> {
  for (const started = Date.now(); Date.now() - started < ms; await sleep(100)) {
    const report = await cockpit(p)
    if (!report.catching_up && !report.replaying) return
  }
  throw new Error(`${p.name} never finished catching up`)
}

function tape(p: Pilot): TapeSlice | undefined {
  return p.deck.slice<TapeSlice>("tape")
}

async function tapeUntil(p: Pilot, ok: (s: TapeSlice) => boolean, what: string, ms = 20_000): Promise<TapeSlice> {
  await p.deck.until(() => {
    const s = tape(p)
    return s !== undefined && ok(s)
  }, `${p.name}: ${what}`, ms)
  return tape(p)!
}

/** Each slice `tape` the deck received after its first `from` messages, oldest first. */
function tapes(p: Pilot, from: number): TapeSlice[] {
  return p.deck
    .received()
    .slice(from)
    .flatMap((m) => (m.t === "state" && m.slice === "tape" ? [m.value as TapeSlice] : []))
}

/** Every notification up in a slice the deck received after its first `from` messages. */
function notifications(p: Pilot, from: number): Notification[] {
  return p.deck
    .received()
    .slice(from)
    .flatMap((m) => (m.t === "state" && m.slice === "notifications" ? (m.value as Notification[]) : []))
}

/** The length of the recording a slice holds, in ms. */
function lengthOf(s: TapeSlice): number {
  assert.equal(s.state.kind, "recorded", `the recorder holds a recording, not ${JSON.stringify(s.state)}`)
  return (s.state as { length_ms: number }).length_ms
}

/** Presses Record, makes each move at its time in ms since, presses Stop at `length`, and returns the recording's length as the slice says it. */
async function record(p: Pilot, moves: [number, () => void][], length: number): Promise<number> {
  await p.deck.ok("tape.record")
  const started = performance.now()
  const at = (ms: number) => sleep(Math.max(0, ms - (performance.now() - started)))
  for (const [ms, move] of moves) {
    await at(ms)
    move()
  }
  await at(length)
  await p.deck.ok("tape.stop")
  return lengthOf(await tapeUntil(p, (s) => s.state.kind === "recorded", "the recording"))
}

/**
 * Stops `p`'s core, and checks the recorder's 20ms budget for a message's arrival over its run
 * (record/areas/profiles/05-the-recorder.md, "Budgets"). `tape` logs how late its timer handed
 * each playback's messages over, from the inputs' stamps, and the loop's stats for the run give
 * the longest any input then waited in the queue, so their sum bounds how late a message reached
 * the stream.
 */
async function checkArrival(p: Pilot, playbacks: number, what: string): Promise<void> {
  p.core.send({ kind: "exit" })
  assert.equal(await p.core.exited, 0)
  const log = p.core.log()
  const late = [...log.matchAll(/a playback reached its end most_late_us=(\d+)/g)].map((m) => Number(m[1]))
  assert.equal(late.length, playbacks, `the core logged ${late.length} playbacks' ends`)
  const stats = log.split("\n").filter((l) => l.includes("the loop's stats")).at(-1) ?? ""
  const waited = Number(/wait_max_us=(\d+)/.exec(stats)?.[1])
  const worst = Math.max(...late) + waited
  const ms = (us: number) => `${(us / 1_000).toFixed(1)}ms`
  console.log(`budget: ${what} reached the stream at most ${ms(worst)} after its recorded time, the timer at most ${late.map(ms).join(" and ")} late and an input at most ${ms(waited)} in the queue, against 20ms`)
  budget(worst <= 20_000, `${what} reached the stream ${worst}µs after its recorded time: ${stats}`)
}

/** Presses Play, and waits for the playback to play through to its end. */
async function playThrough(p: Pilot, ms = 30_000): Promise<void> {
  const seen = p.deck.received().length
  await p.deck.ok("tape.play")
  await tapeUntil(p, (s) => s.state.kind === "recorded" && tapes(p, seen).some((x) => x.state.kind === "playing"), "the playback's end", ms)
}

function setVariable(p: Pilot, name: string, value: number): void {
  p.core.act({ act: "set", numbers: [[name, value]], texts: [] })
}

/** The pilot fires a `K:` event in the cockpit, as pressing its button does. */
function fire(p: Pilot, name: string): void {
  p.core.act({ act: "send-event", name, data: 0 })
}

async function variable(p: Pilot, name: string): Promise<number> {
  const found = (await p.core.report()).variables.find(([n]) => n === name)
  return found ? Number(found[1]) : 0
}

async function settles<T>(what: string, get: () => Promise<T>, want: T, ms = 10_000): Promise<void> {
  let last: T | undefined
  for (const started = Date.now(); Date.now() - started < ms; await sleep(50)) {
    last = await get()
    if (last === want) return
  }
  assert.fail(`${what}: wanted ${String(want)}, had ${String(last)}`)
}

/** Each `TransmitClientEvent` the core made of the client event `name`, as its index in `calls`. */
function sends(calls: Called[], name: string): number[] {
  const mapped = calls.find((c) => c.function === "MapClientEventToSimEvent" && c.arguments.includes(`"${name}"`))
  if (!mapped) return []
  const id = /event: (\d+)/.exec(mapped.arguments)![1]
  return calls.flatMap((c, i) => (c.function === "TransmitClientEvent" && c.unit === mapped.unit && c.arguments.includes(`event: ${id},`) ? [i] : []))
}

/** How many times the core wrote the variable `name`, through the definition its watch made. */
function writes(calls: Called[], name: string): number {
  const defined = calls.find((c) => c.function === "AddToDataDefinition" && c.arguments.includes(`"${name}"`))
  if (!defined) return 0
  const definition = /definition: (\d+)/.exec(defined.arguments)![1]
  return calls.filter((c) => c.function === "SetDataOnSimObject" && c.unit === defined.unit && c.arguments.includes(`definition: ${definition},`)).length
}

const EVENTS = ["HDG_INC", "HDG_DEC", "TOGGLE_LAMP", "AP_MASTER", "COM_INC", "COM_DEC"] as const
const WRITTEN = ["L:BATTERY", "L:BEACON", "L:THROTTLE"] as const

/** How many times the core sent each event of the profile's writes and wrote each variable, so far. */
async function counts(p: Pilot): Promise<Record<string, number>> {
  const { calls } = await p.core.report()
  return Object.fromEntries([...EVENTS.map((e) => [e, sends(calls, e).length]), ...WRITTEN.map((v) => [v, writes(calls, v)])])
}

function minus(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v - (b[k] ?? 0)]))
}

/** One of the stand-in's frames: when it ran, in ms since 1970, and each tracked variable's value. */
type Frame = { at: number; values: number[] }

/**
 * The stand-in's frames since the core's line `after`, from the last frame before it, since a
 * write the core makes as it takes a press can land before the stand-in's next frame.
 */
function frames(p: Pilot, after: number): Frame[] {
  const all = p.core.tracked()
  const since = p.core.tracked(after)
  return all.slice(Math.max(0, all.length - since.length - 1)).map((f) => ({ at: f.at / 1_000, values: f.values }))
}

/** The values `name` read across `frames`, each run of one value once. */
function course(frames: Frame[], name: Tracked): number[] {
  const i = TRACKED.indexOf(name)
  return frames.map((f) => f.values[i]!).filter((v, k, all) => k === 0 || v !== all[k - 1])
}

/** When `name` first read a value each of `steps` takes, in turn, in ms since 1970. */
function when(frames: Frame[], name: Tracked, ...steps: ((v: number) => boolean)[]): number[] {
  const i = TRACKED.indexOf(name)
  const found: number[] = []
  let k = 0
  for (const step of steps) {
    while (k < frames.length && !step(frames[k]!.values[i]!)) k++
    assert.ok(k < frames.length, `${name} never took step ${found.length + 1} of ${steps.length}; it read ${course(frames, name).join(", ")}`)
    found.push(frames[k]!.at)
  }
  return found
}

const is = (want: number) => (v: number) => v === want

/** What one Play did: the stand-in's frames from the press, the calls it made, and what the deck received. */
type Played = { frames: Frame[]; calls: Record<string, number>; order: Called[]; slices: TapeSlice[]; notes: Notification[] }

/** The 5.7s from the throttle's last value to the beacon's change, in ms. */
function pause(f: Frame[]): number {
  const [, beacon] = when(f, "L:BEACON", is(0), is(1))
  return beacon! - when(f, "L:THROTTLE", is(0.6))[0]!
}

test("Play puts the cockpit back as it stood at Record, then plays each change at its time: a switch, a lever's values, a knob's steps with a toggle held behind them, an event, and a counting entry's steps; a 5s pause plays as 5s; a second Play makes the same calls; the banner says nothing of the playback's catch-up; and Record and Play are refused before preflight ends", { timeout: 180_000 }, async (t) => {
  const { run, net, local } = await bench(t, "tape-play")
  const p = await pilot(t, run, net, "James", local)
  assert.equal(await p.deck.command("tape.record"), NO_FLIGHT, "Record before the session")
  assert.equal(await p.deck.command("tape.play"), NO_FLIGHT, "Play before the session")
  await host(p.core, p.name)
  await until(p, (s) => s.members.length === 1, "the session")
  await load(p.core, BARON)
  await until(p, (s) => mine(s)?.in_flight === true && s.ready?.length === 0, "Ready allowed")
  assert.equal(await p.deck.command("tape.record"), NO_FLIGHT, "Record before preflight ends")
  assert.equal(await p.deck.command("tape.play"), NO_FLIGHT, "Play before preflight ends")
  assert.deepEqual(tape(p), { state: { kind: "empty" }, off: "no-flight", stopped: null })
  await p.app.ok("session.ready", { on: true })
  await until(p, (s) => s.preflight.phase === "ended", "preflight's end")
  await caughtUp(p)
  await tapeUntil(p, (s) => s.off === null, "the recorder on")
  assert.equal(await p.deck.command("tape.play"), "there's no recording to play")

  // Every entry stands at 0 as Record is pressed.
  const atRecord = p.core.lineCount()
  const length = await record(
    p,
    [
      [600, () => setVariable(p, "L:BATTERY", 1)],
      [800, () => setVariable(p, "L:THROTTLE", 0.2)],
      [900, () => setVariable(p, "L:THROTTLE", 0.4)],
      [1_000, () => setVariable(p, "L:THROTTLE", 0.6)],
      [1_200, () => p.bug.set(10)],
      [1_300, () => p.bug.set(20)],
      [1_400, () => p.bug.set(30)],
      // On playback the lamp arrives while the knob still steps toward 30.
      [1_450, () => setVariable(p, "L:LAMP", 1)],
      [1_700, () => fire(p, "AP_MASTER")],
      [2_000, () => fire(p, "COM_INC")],
      [2_100, () => fire(p, "COM_INC")],
      [2_200, () => fire(p, "COM_INC")],
      [6_700, () => setVariable(p, "L:BEACON", 1)],
    ],
    7_000,
  )
  const recordedPause = pause(frames(p, atRecord))
  assert.ok(length >= 6_900 && length <= 7_500, `the recording's length was ${length}ms`)

  /** Moves what the recording left away from Record's values, where a pilot would, then plays it back. */
  const moveAndPlay = async (): Promise<Played> => {
    setVariable(p, "L:THROTTLE", 0.9)
    p.bug.set(40)
    fire(p, "COM_INC")
    fire(p, "COM_INC")
    await sleep(500)
    const before = await counts(p)
    const at = p.core.lineCount()
    const seen = p.deck.received().length
    await playThrough(p)
    // The last change's write reads back.
    await sleep(500)
    const order = (await p.core.report()).calls
    return { frames: frames(p, at), calls: minus(await counts(p), before), order, slices: tapes(p, seen), notes: notifications(p, seen) }
  }

  const first = await moveAndPlay()
  const [messages = 0, bytes = 0] = /a recording stopped messages=(\d+) taken=\d+ ms=\d+ bytes=(\d+)/.exec(p.core.log())!.slice(1).map(Number)
  console.log(`measure: the recording held ${messages} messages in ${bytes} bytes, catch-up's payloads at Record included`)
  const second = await moveAndPlay()
  await checkArrival(p, 2, "a message")
  for (const [n, played] of [first, second].entries()) {
    const label = n === 0 ? "the first Play" : "the second Play"
    const f = played.frames
    assert.ok(played.slices.some((s) => s.state.kind === "restoring"), `${label}: the slice said the cockpit was being put back`)
    assert.deepEqual(played.slices.at(-1), { state: { kind: "recorded", length_ms: length }, off: null, stopped: null }, label)
    const shown = played.notes.filter((x) => x.id !== "cockpit-stream.catch").map((x) => x.text)
    if (shown.length > 0) console.log(`${label}: the banner showed ${[...new Set(shown)].join("; ")}`)
    assert.deepEqual(played.notes.filter((x) => x.id === "cockpit-stream.catch"), [], `${label}: no catch-up notification`)

    // Put back first, each entry at Record's value, and then each change, in the recording's order.
    assert.deepEqual(course(f, "L:BATTERY"), [1, 0, 1], `${label}: the battery`)
    assert.deepEqual(course(f, "L:BEACON"), [1, 0, 1], `${label}: the beacon`)
    assert.deepEqual(course(f, "L:THROTTLE"), [0.9, 0, 0.2, 0.4, 0.6], `${label}: the throttle`)
    assert.deepEqual(course(f, "L:LAMP"), [1, 0, 1], `${label}: the lamp`)
    const heading = course(f, "L:HDG")
    const low = heading.indexOf(0)
    assert.ok(heading[0] === 40 && low > 0 && heading.at(-1) === 30, `${label}: the heading bug read ${heading.join(", ")}`)
    assert.ok(heading.slice(0, low + 1).every((v, k, all) => k === 0 || v < all[k - 1]!), `${label}: the heading bug turned back to 0 and no further`)
    assert.ok(heading.slice(low).every((v, k, all) => k === 0 || v > all[k - 1]!), `${label}: the heading bug then turned up to 30`)
    const restored = Math.max(...(["L:BATTERY", "L:BEACON", "L:THROTTLE", "L:LAMP", "L:HDG"] as const).map((name) => when(f, name, is(0))[0]!))
    const [, replayed] = when(f, "L:BATTERY", is(0), is(1))
    assert.ok(restored < replayed!, `${label}: every entry was back at Record's value ${replayed! - restored}ms before the first change played`)
    // The lamp's toggle waits for the knob's last step.
    const [, turned] = when(f, "L:HDG", is(0), is(30))
    const [, lit] = when(f, "L:LAMP", is(0), is(1))
    assert.ok(lit! >= turned!, `${label}: the lamp lit ${turned! - lit!}ms before the heading bug reached 30`)
    assert.ok(sends(played.order, "TOGGLE_LAMP").at(-1)! > sends(played.order, "HDG_INC").at(-1)!, `${label}: the toggle went after the knob's last step`)
    // A 5.7s pause plays as recorded, longer than the 2s a crewmate's gap is capped at.
    const playedPause = pause(f)
    console.log(`measure: ${label} played the pause as ${Math.round(playedPause)}ms, against ${Math.round(recordedPause)}ms recorded`)
    assert.ok(Math.abs(playedPause - recordedPause) <= 300, `${label}: the pause played as ${Math.round(playedPause)}ms, against ${Math.round(recordedPause)}ms recorded`)

    // Each write once: the heading bug's 40 steps back and 30 up, the lamp's toggle each way,
    // the event once, the battery, beacon, and throttle put back once each, then their changes.
    const { COM_INC, COM_DEC, ...rest } = played.calls
    assert.deepEqual(rest, { HDG_INC: 30, HDG_DEC: 40, TOGGLE_LAMP: 2, AP_MASTER: 1, "L:BATTERY": 2, "L:BEACON": 2, "L:THROTTLE": 4 }, `${label}: the calls`)
    // The counting entry steps back from the 5 the pilot left to Record's 0, then up to 3.
    assert.deepEqual({ COM_INC, COM_DEC }, { COM_INC: 3, COM_DEC: 5 }, `${label}: the counting entry's steps`)
  }
})

test("with a crew: a member joining during playback stops it and the slice names them, the rest never plays, their catch-up and the messages after it run as with no playback before, and Record and Play are refused", { timeout: 180_000 }, async (t) => {
  const { run, net, local } = await bench(t, "tape-crew")
  const james = await pilot(t, run, net, "James", local)
  const adam = await pilot(t, run, net, "Adam", local)
  const code = await alone(james)
  const length = await record(
    james,
    [
      [500, () => setVariable(james, "L:BATTERY", 1)],
      [800, () => james.bug.set(20)],
      [8_500, () => setVariable(james, "L:BEACON", 1)],
    ],
    9_000,
  )
  await james.deck.ok("tape.play")
  const pressed = Date.now()
  await tapeUntil(james, (s) => s.state.kind === "playing", "the playback")
  await settles("the played heading bug", () => variable(james, "L:HDG"), 20)

  await join(adam.core, code, adam.name)
  const s = await tapeUntil(james, (s) => s.stopped !== null && s.off === "crew", "the playback stopped by Adam's joining")
  // A member whose key hasn't arrived as they join is named "a pilot", which a run where the key
  // comes after the link may give.
  const { stopped, ...rest } = s
  assert.deepEqual(rest, { state: { kind: "recorded", length_ms: length }, off: "crew" })
  assert.ok(stopped?.what === "playback" && stopped.by.kind === "joined" && ["Adam", "a pilot"].includes(stopped.by.name), JSON.stringify(stopped))
  assert.equal(await james.deck.command("tape.record"), CREW)
  assert.equal(await james.deck.command("tape.play"), CREW)
  assert.deepEqual(tape(james)!.state, { kind: "recorded", length_ms: length }, "the refusals kept the recording")

  await until(adam, (s) => s.members.length === 2, "every member")
  await load(adam.core, BARON)
  await adam.core.logged("this machine takes the flying machine's catch-up", { ms: 15_000 })
  await caughtUp(adam)
  await settles("Adam's battery, from James's catch-up", () => variable(adam, "L:BATTERY"), 1)
  await settles("Adam's heading bug, from James's catch-up", () => variable(adam, "L:HDG"), 20)
  // The beacon's change, 8.5s into the recording, never plays: Play put it back to 0.
  await sleep(Math.max(0, 11_000 - (Date.now() - pressed)))
  assert.equal(await variable(james, "L:BEACON"), 0, "James's beacon, which the rest of the recording would have turned on")
  assert.equal(await variable(adam, "L:BEACON"), 0)
  setVariable(james, "L:APU", 1)
  await settles("Adam's APU master, from James", () => variable(adam, "L:APU"), 1)
  assert.equal((await cockpit(adam)).waiting, 0, "nothing waits in Adam's stream")
  assert.doesNotMatch(james.core.log(), /a recording started[\s\S]*a recording started/, "the refused Record recorded nothing")
  assert.equal(james.core.log().match(/a playback started/g)?.length, 1, "the refused Play played nothing")
})

test("Stop while the cockpit is put back, and while a knob's steps hold later changes, leaves nothing waiting in the stream, and a crewmate who joins after it gets a clock that covers every played message", { timeout: 180_000 }, async (t) => {
  const { run, net, local } = await bench(t, "tape-stop")
  const james = await pilot(t, run, net, "James", local)
  const adam = await pilot(t, run, net, "Adam", local)
  const code = await alone(james)
  // A turn of 150 steps, about 3.4s at 2 frames a step, each way, inside a recording long
  // enough that the playback still runs while its steps hold the changes after them.
  const length = await record(
    james,
    [
      [500, () => james.bug.set(150)],
      [550, () => setVariable(james, "L:LAMP", 1)],
      [600, () => setVariable(james, "L:BATTERY", 1)],
    ],
    5_000,
  )
  const stepped = async (event: string, before: Record<string, number>, steps: number) => {
    for (const started = Date.now(); Date.now() - started < 10_000; await sleep(50)) {
      if ((await counts(james))[event]! - before[event]! >= steps) return
    }
    assert.fail(`the heading bug never took ${steps} steps of ${event}`)
  }

  // Stop while the knob turns back to Record's 0.
  let before = await counts(james)
  await james.deck.ok("tape.play")
  await tapeUntil(james, (s) => s.state.kind === "restoring", "the cockpit being put back")
  await stepped("HDG_DEC", before, 20)
  await james.deck.ok("tape.stop")
  let s = await tapeUntil(james, (s) => s.state.kind === "recorded", "the recorder stopped")
  assert.deepEqual(s, { state: { kind: "recorded", length_ms: length }, off: null, stopped: null })
  let report = await cockpit(james)
  assert.deepEqual([report.catching_up, report.waiting], [false, 0], "the putting back ended, with nothing waiting")
  // State sync finishes the knob's steps it started.
  await settles("the heading bug, put back", () => variable(james, "L:HDG"), 0)
  await sleep(1_500)
  assert.equal(await variable(james, "L:BATTERY"), 0, "the battery, which only a played change would turn on")
  // State sync holds the lamp's toggle back to Record's 0 behind the knob's steps, and Stop ends
  // the stream's catch-up but not that held write, so the lamp reads 0 if it went.
  console.log(`measure: after Stop while putting back, the lamp read ${await variable(james, "L:LAMP")}`)

  // Stop while the lamp's and the battery's changes wait behind the knob's steps up to 150.
  before = await counts(james)
  await james.deck.ok("tape.play")
  await tapeUntil(james, (s) => s.state.kind === "playing", "the playback")
  await stepped("HDG_INC", before, 40)
  report = await cockpit(james)
  assert.equal(report.waiting, 2, "the lamp and the battery wait behind the knob's steps")
  assert.equal(tape(james)!.state.kind, "playing", "the playback still runs")
  await james.deck.ok("tape.stop")
  s = await tapeUntil(james, (s) => s.state.kind === "recorded", "the recorder stopped")
  assert.deepEqual(s, { state: { kind: "recorded", length_ms: length }, off: null, stopped: null })
  report = await cockpit(james)
  assert.deepEqual([report.catching_up, report.waiting], [false, 0], "nothing waits in the stream after Stop")

  // A crewmate joins while the knob's steps still run, and takes a clock that covers the stepping
  // message, which Stop counted as applied.
  await joins(adam, code)
  await settles("James's heading bug, its steps finished", () => variable(james, "L:HDG"), 150)
  assert.equal(await variable(james, "L:BATTERY"), 0, "the battery's change never played")
  setVariable(james, "L:APU", 1)
  await settles("Adam's APU master, from James", () => variable(adam, "L:APU"), 1)
  assert.equal((await cockpit(adam)).waiting, 0, "nothing waits in Adam's stream")
})

test("a save stops a recording and a playback, which the slice says, the recorder is off while the reloaded profile loads, and the recording plays again after it", { timeout: 180_000 }, async (t) => {
  const { run, net, local } = await bench(t, "tape-save")
  const p = await pilot(t, run, net, "James", local)
  await alone(p)
  await p.deck.ok("tape.record")
  await sleep(300)
  setVariable(p, "L:BATTERY", 1)
  await sleep(5_700)
  setVariable(p, "L:BEACON", 1)
  await sleep(500)

  // A save reloads the profile, which stops the recording and keeps what it has.
  const saved = build(run, profile(STROBE), "saved", local)
  await p.core.logged(new RegExp(`the profile loaded hash="${saved}"`), { ms: 15_000 })
  let s = await tapeUntil(p, (s) => s.stopped !== null, "the recording stopped")
  assert.deepEqual(s.stopped, { what: "recording", by: { kind: "reload" } })
  const length = lengthOf(s)
  assert.ok(length >= 6_400, `the recording kept ${length}ms`)
  // The reloaded profile's catch-up step turns ready 1.5s after its load.
  await tapeUntil(p, (s) => s.off === "loading", "the recorder off while the profile loads")
  assert.equal(await p.deck.command("tape.play"), LOADING)
  await tapeUntil(p, (s) => s.off === null, "the recorder on again", 10_000)

  // A save while it plays stops the playback, before the beacon's change 6s in.
  await p.deck.ok("tape.play")
  await tapeUntil(p, (s) => s.state.kind === "playing", "the playback")
  const playing = Date.now()
  await settles("the played battery", () => variable(p, "L:BATTERY"), 1)
  const again = build(run, profile(STROBE + LOGO), "saved-again", local)
  await p.core.logged(new RegExp(`the profile loaded hash="${again}"`), { ms: 15_000 })
  s = await tapeUntil(p, (s) => s.stopped !== null && s.state.kind === "recorded", "the playback stopped")
  assert.deepEqual(s.stopped, { what: "playback", by: { kind: "reload" } })
  assert.equal(lengthOf(s), length, "a save keeps the recording")
  assert.ok(Date.now() - playing < 6_000, `the save's reload came ${Date.now() - playing}ms into the playback, after the beacon's change`)
  await sleep(Math.max(0, 7_000 - (Date.now() - playing)))
  assert.equal(await variable(p, "L:BEACON"), 0, "the beacon's change never played")

  // The same recording plays on the reloaded profile.
  await tapeUntil(p, (s) => s.off === null, "the recorder on again", 10_000)
  await playThrough(p)
  assert.equal(tape(p)!.stopped, null, "Play took back why the last one stopped")
  await settles("the beacon, played", () => variable(p, "L:BEACON"), 1)
  assert.equal(await variable(p, "L:BATTERY"), 1)
})

test("a crewmate who joins after a playback's end, while its last changes still wait behind a knob's steps, drops them and gets a clock that covers every played message", { timeout: 180_000 }, async (t) => {
  const { run, net, local } = await bench(t, "tape-end")
  const james = await pilot(t, run, net, "James", local)
  const adam = await pilot(t, run, net, "Adam", local)
  const code = await alone(james)
  // At 30 frames a second, the knob's 150 steps at 2 frames a step take 10s, far past the
  // recording's end at 0.7s, which ends `tape`'s playback while the lamp's and the battery's
  // changes still wait in the stream.
  james.core.act({ act: "frames", per_second: 30 })
  await record(
    james,
    [
      [500, () => james.bug.set(150)],
      [550, () => setVariable(james, "L:LAMP", 1)],
      [600, () => setVariable(james, "L:BATTERY", 1)],
    ],
    700,
  )
  james.bug.set(0)
  await sleep(500)
  await playThrough(james)
  assert.ok((await variable(james, "L:HDG")) < 150, "the knob still steps after the playback's end")
  assert.equal((await cockpit(james)).waiting, 2, "the lamp and the battery wait behind the knob's steps")

  // Adam's joining drops them, and counts the stepping message applied before his catch-up
  // takes James's clock, so nothing of James's after it waits on a played message.
  await joins(adam, code)
  assert.equal((await cockpit(james)).waiting, 0, "nothing waits in James's stream once Adam joined")
  await settles("James's heading bug, its steps finished", () => variable(james, "L:HDG"), 150, 20_000)
  await sleep(500)
  assert.deepEqual([await variable(james, "L:LAMP"), await variable(james, "L:BATTERY")], [0, 0], "the lamp's and the battery's changes never played")
  setVariable(james, "L:APU", 1)
  await settles("Adam's APU master, from James", () => variable(adam, "L:APU"), 1)
  assert.equal((await cockpit(adam)).waiting, 0, "nothing waits in Adam's stream")
})

test("a tap and a drag on a synced display, recorded and played, reach its panel as another pilot's gestures, at the same fractions, once the playback's catch-up has ended", { timeout: 180_000 }, async (t) => {
  const { run, net, local } = await bench(t, "tape-display", WITH_DISPLAY)
  const p = await pilot(t, run, net, "James", local)
  const panel = new FakeCockpitPanel(p.core)
  t.after(() => panel.close())
  await alone(p)
  await panel.page.until(() => panel.loaded(), "the panel loading pointer sync", 15_000)

  // A drag across two of the display's buttons, moving every 15ms, of which the module sends a
  // move every 33ms at most.
  const drag = Array.from({ length: 40 }, (_, k): [number, () => void] => [1_015 + k * 15, () => panel.move(0.06 + 0.01 * k, 0.6)])
  const atRecord = p.core.heard().length
  await record(p, [[500, () => panel.tap(0.1, 0.1)], [1_000, () => panel.press(0.05, 0.6)], ...drag, [1_650, () => panel.release(0.45, 0.6)]], 2_000)
  const sent = p.core
    .heard()
    .slice(atRecord)
    .filter((l) => l.startsWith(`cockpit sent other ${TABLET} `)).length
  const passed = new Set(panel.events("mousemove").map((h) => `${h.x},${h.y}`))

  // A gesture handed over before the playback's catch-up ended would reach pointer sync while it
  // skips gestures, and play nothing. The cockpit stream's test unit holds that catch-up open for
  // 2s, well past the tap's 500ms in the recording, so the case fails if `tape` doesn't wait.
  p.core.cockpit({ act: "settle", ms: 2_000 })
  const seen = p.deck.received().length
  const pressed = performance.now()
  await p.deck.ok("tape.play")
  await tapeUntil(p, (s) => s.state.kind === "playing", "the playback")
  const caughtUp = performance.now()
  assert.ok(tapes(p, seen).some((s) => s.state.kind === "restoring"), "the slice said the cockpit was being put back")
  assert.ok(caughtUp - pressed >= 1_900, `the putting back ended ${Math.round(caughtUp - pressed)}ms after Play, before the test unit's step landed`)
  await panel.page.until(() => panel.events("mouseup").filter((h) => !h.trusted).length === 2, "the drag's up played", 10_000)

  const played = panel
    .events()
    .filter((h) => !h.trusted)
    .sort((x, y) => x.at - y.at)
  const moves = played.filter((h) => h.type === "mousemove")
  // The tap's down and up, and the drag's down and up, are four of the gestures the module sent.
  assert.ok(sent - 4 >= 5, `the module sent ${sent - 4} of the drag's moves`)
  assert.deepEqual(
    played.map((h) => h.type),
    ["mousedown", "mouseup", "click", "mousedown", ...Array<string>(sent - 4).fill("mousemove"), "mouseup"],
    "the tap, then the drag with each move the module sent, and no click at the drag's up",
  )
  assert.deepEqual(
    played.filter((h) => h.type !== "mousemove").map((h) => [h.type, h.x, h.y]),
    [
      ["mousedown", ...panel.at(0.1, 0.1)],
      ["mouseup", ...panel.at(0.1, 0.1)],
      ["click", ...panel.at(0.1, 0.1)],
      ["mousedown", ...panel.at(0.05, 0.6)],
      ["mouseup", ...panel.at(0.45, 0.6)],
    ],
    "at the same fractions",
  )
  assert.deepEqual(
    moves.filter((m, k) => !passed.has(`${m.x},${m.y}`) || (k > 0 && m.x <= moves[k - 1]!.x)),
    [],
    "each move at a point the pilot's drag passed, in the drag's order",
  )
  assert.ok(played[0]!.at > caughtUp, `the tap played ${Math.round(caughtUp - played[0]!.at)}ms before the bench saw the slice leave restoring`)
})

/** What the path's case tracks of the stand-in's aircraft, in this order. */
const FLOWN = ["A:PLANE LATITUDE", "A:PLANE LONGITUDE", "A:IS LATITUDE LONGITUDE FREEZE ON", "A:IS ALTITUDE FREEZE ON", "A:IS ATTITUDE FREEZE ON"]

/** One frame of the stand-in's aircraft: when, in seconds since 1970 on the PC's clock, as `Date.now()` counts, where, in meters north and east of `START`, and whether all three freezes are on. */
type Spot = { t: number; north: number; east: number; frozen: boolean }

/** The stand-in's aircraft, frame by frame, since the core's line `after`. */
function spots(p: Pilot, after: number): Spot[] {
  return p.core.tracked(after).map(({ at, values }) => {
    const [lat, lon, f1, f2, f3] = values as [number, number, number, number, number]
    return { t: at / 1e6, north: (lat - START.lat) * METERS_NORTH, east: (lon - START.lon) * METERS_EAST, frozen: f1 === 1 && f2 === 1 && f3 === 1 }
  })
}

const apart = (a: Spot, b: Spot) => Math.hypot(a.north - b.north, a.east - b.east)

/** Where `path` put its aircraft at `t`, along a straight line between the two frames around it, or undefined outside them. */
function spotAt(path: Spot[], t: number): Spot | undefined {
  const i = path.findIndex((s) => s.t >= t)
  if (i <= 0) return undefined
  const [a, b] = [path[i - 1]!, path[i]!]
  const k = (t - a.t) / (b.t - a.t)
  return { t, north: a.north + (b.north - a.north) * k, east: a.east + (b.east - a.east) * k, frozen: b.frozen }
}

/** The frame of `path` nearest `s`. */
function nearest(path: Spot[], s: Spot): Spot {
  return path.reduce((best, f) => (apart(f, s) < apart(best, s) ? f : best))
}

test("a short path with a turn, recorded and played: as Play is pressed the aircraft is frozen and written at once at the recording's first sample, holds there while the cockpit is put back, then flies the recorded path 400ms behind the playback, and once the playback ends it flies on, unfrozen, and Lead runs again", { timeout: 180_000 }, async (t) => {
  const { run, net, local } = await bench(t, "tape-path")
  const p = await pilot(t, run, net, "James", local)
  p.core.act({ act: "track", names: FLOWN })
  await alone(p)
  p.core.act({
    act: "set",
    numbers: [["A:PLANE LATITUDE", START.lat], ["A:PLANE LONGITUDE", START.lon], ["A:PLANE ALTITUDE", START.alt], ["A:PLANE HEADING DEGREES TRUE", 90], ["A:VELOCITY BODY Z", SPEED_FT]],
    texts: [],
  })
  await sleep(500)

  // A right turn of 45° between 1s and 2.5s, at the stand-in's rotation velocity in radians a second.
  const turn = (rate: number) => () => p.core.act({ act: "set", numbers: [["A:ROTATION VELOCITY BODY Y", rate]], texts: [] })
  const atRecord = p.core.lineCount()
  // When the bench presses Record, which the core takes a command's trip later.
  const pressed = Date.now() / 1e3
  const length = await record(p, [[1_000, turn(Math.PI / 4 / 1.5)], [2_500, turn(0)]], 3_500)
  const flown = spots(p, atRecord)
  const [messages = 0, taken = 0, bytes = 0] = /a recording stopped messages=(\d+) taken=(\d+) ms=\d+ bytes=(\d+)/.exec(p.core.log())!.slice(1).map(Number)
  console.log(`measure: the recording held ${taken} samples over ${length}ms, and ${messages} messages, in ${bytes} bytes, about ${Math.round(bytes / (taken + messages))} bytes each, catch-up's payloads at Record and the lists' spare slots included`)
  assert.ok(taken >= ((length / 50) * 4) / 5, `the recording held ${taken} samples over ${length}ms, against 20 a second`)

  // The aircraft flies on, away from the path, and the cockpit stream's test unit holds the
  // playback's catch-up open for 2s, through which the aircraft holds at the recording's start.
  await sleep(1_000)
  p.core.cockpit({ act: "settle", ms: 2_000 })
  const atPlay = p.core.lineCount()
  await p.deck.ok("tape.play")
  await tapeUntil(p, (s) => s.state.kind === "playing", "the playback")
  const playing = Date.now() / 1e3
  await tapeUntil(p, (s) => s.state.kind === "recorded", "the playback's end", 15_000)
  await sleep(1_000)
  const played = spots(p, atPlay)

  const firstFrozen = played.findIndex((s) => s.frozen)
  assert.ok(firstFrozen > 0, "the aircraft froze after Play")
  const stood = played[firstFrozen - 1]!
  const lastFrozen = played.findLastIndex((s) => s.frozen)
  const frozen = played.slice(firstFrozen, lastFrozen + 1)
  assert.ok(
    frozen.every((s) => s.frozen),
    "the aircraft stayed frozen from Play to the playback's end",
  )
  // Written at once: the routine host freezes the aircraft and writes its pose in one frame, so
  // every frozen frame, the first included, stands on the recorded path.
  const off = (s: Spot) => apart(s, nearest(flown, s))
  const strays = frozen.filter((s) => off(s) > 5)
  assert.deepEqual(strays.map((s) => `${Math.round(s.east)}m east, ${Math.round(s.north)}m north`), [], "every frozen frame stood on the recorded path")
  const back = frozen[0]!
  assert.ok(apart(stood, back) > 200, `the aircraft went back ${Math.round(apart(stood, back))}m to the recording's start`)
  // To the recording's first sample, which `Lead` read within 50ms of Record.
  const recordedAt = nearest(flown, back).t - pressed
  assert.ok(recordedAt >= -0.05 && recordedAt <= 0.3, `the aircraft went back to where it stood ${Math.round(recordedAt * 1_000)}ms after the bench pressed Record`)

  // It holds there through the 2s of putting back, then moves 400ms after the playback's messages
  // start, which the bench sees a little after the core.
  const moved = frozen.find((s) => s.t > back.t && apart(s, back) > 1)!
  console.log(`measure: the aircraft held at the recording's start for ${Math.round((moved.t - back.t) * 1_000)}ms, and moved ${Math.round((moved.t - playing) * 1_000)}ms after the bench saw the playback's messages start`)
  assert.ok(moved.t - back.t >= 2, `the aircraft held ${Math.round((moved.t - back.t) * 1_000)}ms at the recording's start`)
  assert.ok(moved.t - playing >= 0.2 && moved.t - playing <= 0.6, `the aircraft moved ${Math.round((moved.t - playing) * 1_000)}ms after the bench saw the playback's messages start`)

  // From there it flies the recorded path at the recorded pace: each frame where the aircraft was
  // one time shift earlier, which the frames' median sets.
  const flying = frozen.filter((s) => s.t >= moved.t)
  const shifts = flying.map((s) => s.t - nearest(flown, s).t).sort((a, b) => a - b)
  const shift = shifts[Math.floor(shifts.length / 2)]!
  const misses = flying.map((s) => {
    const was = spotAt(flown, s.t - shift)
    return was ? apart(s, was) : 0
  })
  console.log(`measure: the played path strayed at most ${Math.max(...misses).toFixed(2)}m from the recorded one`)
  assert.ok(Math.max(...misses) <= 5, `the played path strayed ${Math.max(...misses).toFixed(1)}m from the recorded one`)
  // It draws up to 400ms before Stop, the turn included, when the playback ends at the recording's length.
  const drawnTo = flying.at(-1)!.t - shift - pressed
  assert.ok(Math.abs(drawnTo - (length / 1_000 - 0.4)) <= 0.2, `the played path reached ${Math.round(drawnTo * 1_000)}ms into the recording, against ${length - 400}ms`)

  // Let go at the end, it flies on from the velocities `Follow` last wrote.
  const after = played.slice(lastFrozen + 1)
  assert.ok(after.length > 0 && after.every((s) => !s.frozen), "the aircraft is unfrozen after the playback's end")
  const onward = after.at(-1)!
  const speed = apart(onward, played[lastFrozen]!) / (onward.t - played[lastFrozen]!.t)
  assert.ok(Math.abs(speed - SPEED_FT * 0.3048) <= 8, `the aircraft flew on at ${speed.toFixed(1)} m/s`)
  assert.match(p.core.log(), /a recording plays back, so flight-model sync starts Follow on it[\s\S]*this pilot flies, so flight-model sync starts Lead/, "Lead runs again after the playback")
  await checkArrival(p, 1, "a sample or a message")
})
