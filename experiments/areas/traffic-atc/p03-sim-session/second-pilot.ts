/*
 * p03: a second pilot for traffic and ATC audio's session in the sim, on one PC. p26's local relay, backend, and
 * profiles' site, as p29 starts them, and a bench core in the 58P on a stand-in sim, which joins the real core's session,
 * so the real core is the pilot flying. The
 * second pilot can host traffic, playing FS Copilot's KSFO capture as its stand-in's AI traffic, which the real core
 * shows in the real sim as copies; or receive it, its stand-in holding the copies the real core's traffic sends, with
 * the dress the real core read. It runs the real core helper, so ATC the real core shares plays on the output device
 * named, apart from the ATC app's own.
 *
 *   node tools/bench.ts traffic        (once, if target/bench is older than the tree)
 *   cargo build -p dualinput-core-helper
 *   node experiments/areas/traffic-atc/p03-sim-session/second-pilot.ts <commands file> [part of an output device's name]
 *
 * Each line appended to the commands file is one command:
 *
 *   host             takes Share my traffic, and plays the capture as the stand-in's AI traffic, over and over
 *   lights <mask>    every played aircraft's light switches from then: strobe 1, landing 2, taxi 4, beacon 8, nav 16,
 *                    or `auto` for its phase's, which is what the play starts with
 *   flaps <percent>  every played aircraft's four flap surfaces from then, or `auto` for its phase's
 *   lack             adds an airliner and a helicopter beside the real core's aircraft, titled as no sim's aircraft is
 *   volume <percent> the second pilot's ATC volume, so its copy of the real core's ATC comes and goes
 *   stop             gives Share my traffic up, and ends the play
 *   report           the copies the second pilot's stand-in shows, with their dress, and who holds each role
 *   quit             ends it all
 *
 * The capture is FS Copilot's: 135 objects at KSFO over 241s, 2Hz, read in the FS Copilot fork,
 * record/traffic-atc/recordings/. Its light masks are `LIGHT … ON`'s, which read all five on for parked aircraft
 * (record/areas/traffic-atc/log.md, 2026-11-15), and its flaps are the handle's, so the play writes the switches and
 * surfaces a crew would set for each state's phase.
 */

import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { spawn } from "node:child_process"

import type { AiObject } from "../../../../src/engines/messages/ts/bench/AiObject.ts"
import type { HelperSlice } from "../../../../src/engines/messages/ts/core_helper/HelperSlice.ts"
import type { SessionSlice } from "../../../../src/engines/messages/ts/session/SessionSlice.ts"
import { BenchRun } from "../../../../tools/bench/cores.ts"
import { BARON, load, toMenu } from "../../../../tools/bench/flights.ts"
import { app, BenchNetwork, host, join } from "../../../../tools/bench/network.ts"
import { FakeApp } from "../../../../tools/bench/pages.ts"
import { userCfgs } from "../../../../tools/lib/install.ts"
import { ROOT } from "../../../../tools/lib/repo.ts"

const OUT = path.join(ROOT, "target", "bench", "release-with-checks")
process.env.DUALINPUT_BENCH_CORE = path.join(OUT, "dualinput-core.exe")
process.env.DUALINPUT_BENCH_STAND_IN_HELPER = path.join(OUT, "stand-in-core-helper.exe")
process.env.DUALINPUT_BENCH_RELAY = path.join(OUT, "bench-relay.exe")
process.env.DUALINPUT_BENCH_BUILDER = path.join(OUT, "dualinput-profile-builder.exe")
process.env.DUALINPUT_BENCH_PROFILES = path.join(ROOT, "target", "bench", "profiles")

const COMMANDS = process.argv[2]!
const DEVICE = process.argv.slice(3).find((a) => !a.startsWith("--"))?.toLowerCase()
const HELPER = path.join(ROOT, "target", "debug", "dualinput-core-helper.exe")
const CAPTURE = path.join(ROOT, "..", "..", "..", "..", "fsc", "src", "record", "traffic-atc", "recordings", "traffic-2026-09-06-15-58-19.ndjson")
const FOLDER = path.join(ROOT, "target", "sim-session")
const REAL_CORE = path.join(FOLDER, `core-${new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")}`)
const SECOND_PILOT = "Second pilot"
/** The roles' labels, as traffic and ATC audio register them. */
const TRAFFIC = "Share my traffic"
const ATC = "Share my ATC"
/** How often the play hands the stand-in what the capture held by then. */
const STEP_MS = 100

const say = (line: string): void => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`)

if (!fs.existsSync(HELPER)) throw new Error(`no core helper at ${path.relative(ROOT, HELPER)}; run cargo build -p dualinput-core-helper`)
if (!fs.existsSync(CAPTURE)) throw new Error(`no capture at ${CAPTURE}`)

/** One object of the capture: its kind, its identity once read, and its states, oldest first. */
type Captured = { kind: AiObject["kind"]; texts: [string, string][]; states: { t: number; s: Record<string, number> }[]; gone?: number }
const objects = new Map<number, Captured>()
let length = 0
for (const line of fs.readFileSync(CAPTURE, "utf8").split("\n")) {
  if (!line.trim()) continue
  const r = JSON.parse(line)
  if (r.k === "add" && !r.user) objects.set(r.o, { kind: r.type === "HELICOPTER" ? "helicopter" : r.type === "GROUND" ? "ground" : "aircraft", texts: [], states: [] })
  const o = objects.get(r.o)
  if (r.k === "id" && o) o.texts.push(["A:TITLE", r.title], ["A:ATC ID", r.tail ?? ""], ["A:ATC AIRLINE", r.airline ?? ""], ["A:ATC FLIGHT NUMBER", r.flight ?? ""])
  if (r.k === "livery" && o) o.texts.push(["A:LIVERY NAME", r.livery ?? ""])
  if (r.k === "s" && o && !r.u) o.states.push({ t: r.t, s: r })
  if (r.k === "rm" && o) o.gone = r.t
  if (r.k === "end") length = r.t
}
say(`the capture holds ${objects.size} objects over ${(length / 1_000).toFixed(0)}s`)

fs.mkdirSync(REAL_CORE, { recursive: true })
fs.writeFileSync(COMMANDS, "", { flag: "a" })

const network = await BenchNetwork.start(1)
fs.writeFileSync(path.join(REAL_CORE, "settings.json"), JSON.stringify(network.core().settings, null, 2))

const run = new BenchRun("p03-sim-session")
const cfg = userCfgs().find((f) => fs.existsSync(f))
const second = await run.core("second-pilot", { settings: { ...network.core().settings, "sim.user-cfg": cfg, "core-helper.program": HELPER } })
// A day's worth, where the bench's Stub ends after 10 minutes.
const sim = spawn("ping", ["-n", "86400", "127.0.0.1"], { stdio: "ignore" })
second.act({ act: "watch", process: sim.pid! })
await second.hear("stage Starting aircraft none")
const desktop = await app(second)
const slices = await FakeApp.open(second, ["session", "traffic", "core-helper"])

// ATC plays on the device named, so the real ATC app's own sound and its copy come out apart.
if (DEVICE) {
  await slices.ok("core-helper.list", null)
  await slices.until(() => (slices.slice<HelperSlice>("core-helper")?.outputs.length ?? 0) > 0, "the output devices", 15_000)
  const outputs = slices.slice<HelperSlice>("core-helper")!.outputs
  const device = outputs.find((d) => d.name.toLowerCase().includes(DEVICE))
  if (!device) throw new Error(`no output device's name holds "${DEVICE}"; there are ${outputs.map((d) => d.name).join(", ")}`)
  await slices.ok("clients.set-setting", { key: "core-helper.output", value: device })
  say(`ATC from the real core plays on ${device.name}`)
}

say(`start the real core: target\\debug\\dualinput-core.exe --data ${path.relative(ROOT, REAL_CORE)}`)

/** The real core's port file, as the bench's own cores write theirs, read each time it's asked. */
const realCore = { port: () => JSON.parse(fs.readFileSync(path.join(REAL_CORE, "port.json"), "utf8")).port as number }

async function joinRealCore(): Promise<void> {
  while (!fs.existsSync(path.join(REAL_CORE, "port.json"))) await sleep(500)
  await sleep(1_000)
  // The real core hosts, so it's the pilot flying, whose aircraft the second pilot's follows, rather than its own
  // following the stand-in's, which stands somewhere else. `open`, `host`, and `join` take a Core, of which they read
  // only the port.
  const code = await host(realCore as never, "Sim pilot")
  say(`the real core hosts ${code}`)
  const real = await FakeApp.open(realCore as never, ["session"])
  await join(second, code, SECOND_PILOT)
  say("the second pilot joins, and waits for the sim pilot to be in the flight")
  // The second pilot enters the flight only after the sim pilot has, since a pilot flying who leaves the flight passes
  // control to a member still in it, and the sim pilot's aircraft would then follow the stand-in's.
  const realInFlight = () => {
    const s = real.slice<SessionSlice>("session")
    return s?.members.find((m) => m.pilot === s.me)?.in_flight === true
  }
  // With --fresh-flight, a flight the sim pilot is in as this starts doesn't count, so they quit it and load the
  // session's.
  if (process.argv.includes("--fresh-flight")) {
    await real.until(() => real.slice<SessionSlice>("session") !== undefined && !realInFlight(), "the sim pilot out of the flight", 1_800_000)
    say("the sim pilot is out of the flight, so the next flight they load is the session's")
  }
  await real.until(realInFlight, "the sim pilot in the flight", 1_800_000)
  await load(second, BARON, { title: "Black Square Baron 58P Professional N513LW" })
  say("the second pilot is in the flight too")
  for (const [who, client] of [["the real core", real], ["the second pilot", desktop]] as const) {
    await client.until(() => {
      const s = client.slice<SessionSlice>("session")
      return s?.members.length === 2 && s.members.every((m) => m.in_flight) && s.ready?.length === 0
    }, `${who}: Ready allowed`, 600_000)
    await client.ok("session.ready", { on: true })
    say(`${who} is ready`)
  }
  await real.until(() => real.slice<SessionSlice>("session")!.preflight.phase === "ended", "preflight's end", 60_000)
  say("preflight ended")
  // The second pilot leaves the flight as the sim pilot does, and comes back after them, so a restart of the flight
  // never passes control to the second pilot.
  for (let away = false; ; await sleep(500)) {
    const out = !realInFlight()
    if (out && !away) {
      away = true
      await toMenu(second)
      say("the sim pilot left the flight, so the second pilot did too")
    } else if (!out && away) {
      away = false
      await load(second, BARON, { title: "Black Square Baron 58P Professional N513LW" })
      say("the sim pilot is back in the flight, and the second pilot too")
    }
  }
}
void joinRealCore().catch((e) => say(`joining failed: ${e instanceof Error ? e.message : String(e)}`))

/** Turns the second pilot's switch for the role labeled `label` on or off, as its tab does. */
async function share(label: string, on: boolean): Promise<void> {
  const key = slices.slice<SessionSlice>("session")?.roles.find((r) => r.label === label)?.key
  if (key === undefined) throw new Error(`no role labeled ${label} in the session`)
  await slices.ok("session.share", { key, on })
}

// The play: each object's next state, and the dress, from the state's phase unless `lights` or `flaps` set one.
let lights: number | null = null
let flaps: number | null = null
let playing: { started: number; next: Map<number, number>; shown: Set<number> } | null = null

/** The switches a crew sets for the state's phase: nav always, beacon with an engine running, taxi lights while taxiing, strobes and landing lights from the takeoff roll on. */
function phaseLights(s: Record<string, number>): number {
  const fast = !s.g || (s.gs ?? 0) >= 40
  const taxiing = !!s.g && (s.gs ?? 0) >= 1 && !fast
  return (fast ? 1 : 0) | (fast ? 2 : 0) | (taxiing ? 4 : 0) | ((s.e ?? 0) > 0 ? 8 : 0) | 16
}

/** Flaps for the state's phase: out on the takeoff roll and low in flight. KSFO's field is at about 13ft. */
function phaseFlaps(s: Record<string, number>): number {
  if (s.g) return (s.gs ?? 0) >= 40 ? 30 : 0
  return (s.alt ?? 0) < 2_000 ? 40 : 0
}

function numbers(s: Record<string, number>): [string, number][] {
  const engines = s.ne ?? 2
  const lit = lights ?? phaseLights(s)
  const out = flaps ?? phaseFlaps(s)
  return [
    // The stand-in moves an AI object along its velocities between writes, which carried a stopping aircraft past its
    // stop until the next of the capture's 2Hz states pulled it back, so it holds each object where the capture puts it.
    ["A:IS LATITUDE LONGITUDE FREEZE ON", 1],
    ["A:PLANE LATITUDE", s.lat!],
    ["A:PLANE LONGITUDE", s.lon!],
    ["A:PLANE ALTITUDE", s.alt!],
    ["A:PLANE PITCH DEGREES", s.p ?? 0],
    ["A:PLANE BANK DEGREES", s.b ?? 0],
    ["A:PLANE HEADING DEGREES TRUE", s.h ?? 0],
    ["A:VELOCITY BODY X", s.vbx ?? 0],
    ["A:VELOCITY BODY Y", s.vby ?? 0],
    ["A:VELOCITY BODY Z", s.vbz ?? 0],
    ["A:ROTATION VELOCITY BODY X", s.rx ?? 0],
    ["A:ROTATION VELOCITY BODY Y", s.ry ?? 0],
    ["A:ROTATION VELOCITY BODY Z", s.rz ?? 0],
    ["A:GROUND VELOCITY", s.gs ?? 0],
    ["A:SIM ON GROUND", s.g ?? 0],
    ["A:GEAR HANDLE POSITION", (s.gear ?? 1) * 100],
    ...["TRAILING EDGE FLAPS LEFT", "TRAILING EDGE FLAPS RIGHT", "LEADING EDGE FLAPS LEFT", "LEADING EDGE FLAPS RIGHT"].map((n): [string, number] => [`A:${n} PERCENT`, out]),
    ...["STROBE", "LANDING", "TAXI", "BEACON", "NAV"].map((n, i): [string, number] => [`A:LIGHT ${n}`, (lit >> i) & 1]),
    ["A:NUMBER OF ENGINES", engines],
    ...[1, 2, 3, 4].map((n): [string, number] => [`A:GENERAL ENG COMBUSTION:${n}`, ((s.e ?? 0) >> (n - 1)) & 1]),
  ]
}

/** `a` to `b`, `f` of the way, the short way round, in degrees from 0 to 360. */
const towards = (a: number, b: number, f: number): number => {
  const d = ((((b - a) % 360) + 540) % 360) - 180
  return (a + d * f + 360) % 360
}

/**
 * Hands the stand-in each object where the capture puts it now, in acts of up to 100, and loops at the capture's end.
 * A moving object is placed between its two states around now, every step, as the sim moves its traffic every frame:
 * jumped from one 2Hz state to the next, it read the same on two of the traffic host's 2Hz polls now and then, and its
 * copy paused, then caught up. A parked object goes out only as it passes a state.
 */
function step(): void {
  if (!playing) return
  const at = performance.now() - playing.started
  if (at > length) {
    second.act({ act: "ai-gone", ids: [...playing.shown] })
    playing = { started: performance.now(), next: new Map(), shown: new Set() }
    say("the capture plays again from its start")
    return
  }
  const acts: AiObject[] = []
  const gone: number[] = []
  for (const [id, o] of objects) {
    if (o.gone !== undefined && o.gone <= at) {
      if (playing.shown.delete(id)) gone.push(id)
      continue
    }
    let n = playing.next.get(id) ?? 0
    const was = n
    while (n < o.states.length && o.states[n]!.t <= at) n++
    playing.next.set(id, n)
    const prev = o.states[n - 1]
    if (!prev) continue
    const next = o.states[n]
    const moving = !!next && (next.s.lat !== prev.s.lat || next.s.lon !== prev.s.lon || next.s.alt !== prev.s.alt || next.s.h !== prev.s.h)
    const first = !playing.shown.has(id)
    if (!first && !moving && n === was) continue
    let s = prev.s
    if (moving) {
      const f = (at - prev.t) / (next!.t - prev.t)
      const lerp = (k: string) => (prev.s[k] ?? 0) + ((next!.s[k] ?? 0) - (prev.s[k] ?? 0)) * f
      s = { ...prev.s, lat: lerp("lat"), lon: lerp("lon"), alt: lerp("alt"), p: lerp("p"), b: lerp("b"), h: towards(prev.s.h ?? 0, next!.s.h ?? 0, f) }
    }
    playing.shown.add(id)
    acts.push({ id, kind: o.kind, numbers: numbers(s), texts: first ? o.texts : [] })
  }
  for (let i = 0; i < acts.length; i += 100) second.act({ act: "ai", objects: acts.slice(i, i + 100) })
  if (gone.length) second.act({ act: "ai-gone", ids: gone })
}
setInterval(step, STEP_MS)

/** Every played object's dress again, as `lights` and `flaps` changed it, held until its next state. */
function dressAgain(): void {
  if (!playing) return
  const acts: AiObject[] = []
  for (const id of playing.shown) {
    const o = objects.get(id)!
    const s = o.states[Math.max(0, (playing.next.get(id) ?? 1) - 1)]?.s
    if (s) acts.push({ id, kind: o.kind, numbers: numbers(s), texts: [] })
  }
  for (let i = 0; i < acts.length; i += 100) second.act({ act: "ai", objects: acts.slice(i, i + 100) })
}

/** An airliner and a helicopter beside the capture's gate, where the real core's aircraft stands, titled as no aircraft is. */
function lack(): void {
  const at = (n: number): [string, number][] => [
    ["A:PLANE LATITUDE", 37.6182839 + n * 0.0004],
    ["A:PLANE LONGITUDE", -122.3808325],
    ["A:PLANE ALTITUDE", 20],
    ["A:PLANE HEADING DEGREES TRUE", 234],
    ["A:SIM ON GROUND", 1],
    ["A:GEAR HANDLE POSITION", 100],
    ["A:LIGHT NAV", 1],
    ["A:NUMBER OF ENGINES", 2],
  ]
  second.act({
    act: "ai",
    objects: [
      { id: 0x7f00_0001, kind: "aircraft", numbers: at(1), texts: [["A:TITLE", "P03 Absent Airliner"], ["A:ATC ID", "N301PA"]] },
      { id: 0x7f00_0002, kind: "helicopter", numbers: at(2), texts: [["A:TITLE", "P03 Absent Helicopter"], ["A:ATC ID", "N302PA"]] },
    ],
  })
}

async function report(): Promise<void> {
  const shown = (await second.report()).objects.filter((o) => !o.title.startsWith("DUALINPUT_"))
  const dress = (o: (typeof shown)[number]) => {
    const v = new Map(o.variables)
    const lit = ["STROBE", "LANDING", "TAXI", "BEACON", "NAV"].filter((n) => Number(v.get(`LIGHT ${n}`)) === 1).join("+") || "none"
    return `lights ${lit}, flaps ${["TRAILING EDGE FLAPS LEFT", "TRAILING EDGE FLAPS RIGHT", "LEADING EDGE FLAPS LEFT", "LEADING EDGE FLAPS RIGHT"].map((n) => v.get(`${n} PERCENT`) ?? "-").join("/")}`
  }
  const counts = new Map<string, number>()
  for (const o of shown) counts.set(`${o.title}: ${dress(o)}`, (counts.get(`${o.title}: ${dress(o)}`) ?? 0) + 1)
  say(`the second pilot's stand-in shows ${shown.length} copies`)
  for (const [line, n] of [...counts].sort((a, b) => b[1] - a[1])) say(`  ${n} × ${line}`)
  const s = slices.slice<SessionSlice>("session")
  const holder = (label: string) => s?.members.find((m) => m.pilot === s.roles.find((r) => r.label === label)?.holder)?.name ?? "nobody"
  say(`traffic is shared by ${holder(TRAFFIC)}, ATC by ${holder(ATC)}; the second pilot's tab counts ${JSON.stringify(slices.slice("traffic"))}`)
}

async function command(line: string): Promise<boolean> {
  const [word, ...rest] = line.trim().split(/\s+/)
  const [a] = rest.map(Number)
  say(`> ${line.trim()}`)
  if (word === "host") {
    await share(TRAFFIC, true)
    playing = { started: performance.now(), next: new Map(), shown: new Set() }
  } else if (word === "lights") {
    lights = rest[0] === "auto" ? null : (a ?? 16)
    dressAgain()
  } else if (word === "flaps") {
    flaps = rest[0] === "auto" ? null : (a ?? 0)
    dressAgain()
  } else if (word === "lack") lack()
  else if (word === "volume") await slices.ok("clients.set-setting", { key: "atc-audio.volume", value: a ?? 100 })
  else if (word === "stop") {
    await share(TRAFFIC, false)
    if (playing) second.act({ act: "ai-gone", ids: [...playing.shown, 0x7f00_0001, 0x7f00_0002] })
    playing = null
  } else if (word === "report") await report()
  else if (word === "quit") return false
  else if (word) say(`no command ${word}`)
  return true
}

let read = 0
for (let going = true; going; ) {
  await sleep(200)
  // Windows refuses the read while another program is appending a command.
  let text = ""
  try {
    text = fs.readFileSync(COMMANDS, "utf8")
  } catch {
    continue
  }
  if (text.length > read) {
    for (const line of text.slice(read).split(/\r?\n/).filter(Boolean)) {
      try {
        going = (await command(line)) && going
      } catch (e) {
        say(`failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    read = text.length
  }
}
await second.kill()
sim.kill()
await network.stop()
process.exit(0)
