// p31: why state sync's writes read another value in the first flight with friends, and the
// drift after a handover, made to happen again in one session in the sim (record/areas/sync/log.md,
// 2026-11-16; record/areas/build/plan.md, "14b State sync's writes that read another value").
// The real core flies the Black Square Baron 58P, and a bench core on a stand-in plays the second
// pilot. It asks four things, and writes report.txt in the run's folder:
//
// - Does an input event's `_Set` preset keep the value of its first call through our module? The
//   heading bug, the parking brake, and the gear handle each take several values, through each of
//   route.patch's three routes: 0 as built, 1 a fresh ID for each call, 2 calculator code.
// - Does a handover with the autopilot in heading mode turn the aircraft toward a heading bug that
//   didn't follow, and does it fly straight on when the bug followed?
// - When altitude hold and vertical speed mode arrive together, does the toggle undo altitude
//   hold, and does vertical speed mode set a target of its own that goes back to the other pilot?
// - Do the KFC 150's own on and off events set each mode, so the profile needn't toggle?
//
//   git apply experiments/areas/sync/p31-handover/route.patch
//   node tools/build.ts install                        with the sim closed
//   node tools/bench.ts state-sync                     once, so target/bench holds this tree
//   cargo build --release -p dualinput-core
//   node experiments/areas/sync/p31-handover/session.ts --core target/release/dualinput-core.exe
//   git apply -R experiments/areas/sync/p31-handover/route.patch    after the session
//
// Then start the sim and load the 58P at a stand with its engines running; the script says each
// step aloud. q in its terminal stops the core, replays its recording, and ends.

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import type { SessionSlice } from "../../../../src/engines/messages/ts/session/SessionSlice.ts"
import type { SimSlice } from "../../../../src/engines/messages/ts/sim/SimSlice.ts"
import { BenchRun, type Core } from "../../../../tools/bench/cores.ts"
import { load } from "../../../../tools/bench/flights.ts"
import { app, BenchNetwork, join } from "../../../../tools/bench/network.ts"
import type { FakeApp } from "../../../../tools/bench/pages.ts"
import { ROOT } from "../../../../tools/lib/repo.ts"
import { Failed, main } from "../../../../tools/lib/run.ts"
import { desktop, type Desktop } from "../../../../tools/sim/desktop.ts"
import { Guide } from "../../../../tools/sim/guide.ts"
import { evaluate, listPages } from "../../../../tools/sim/inspector.ts"

const OUT = path.join(ROOT, "target", "bench", "release-with-checks")
const BARON = /baronpro/i
const ROUTES = [0, 1, 2]
const ROUTE_NAMES = ["as built", "a fresh ID each call", "calculator code"]

/** What the script reads of the 58P each frame of a cockpit panel while it records, as `[name, unit]`, in this order. */
const READ: [string, string][] = [
  ["A:PLANE HEADING DEGREES MAGNETIC", "degrees"],
  ["A:PLANE BANK DEGREES", "degrees"],
  ["A:PLANE ALTITUDE", "feet"],
  ["A:AUTOPILOT HEADING LOCK DIR:1", "degrees"],
  ["A:ELEVATOR TRIM PCT", "percent"],
  ["A:IS LATITUDE LONGITUDE FREEZE ON", "bool"],
]

/** What the stand-in sends of its aircraft after each of its frames, in this order. */
const TRACKED = ["A:PLANE ALTITUDE", "A:AUTOPILOT VERTICAL HOLD VAR:1", "A:AUTOPILOT HEADING LOCK DIR:1", "A:AUTOPILOT VERTICAL HOLD", "A:AUTOPILOT ALTITUDE LOCK", "A:ELEVATOR TRIM PCT"]

/** The second pilot's flight in the air: where it is, which way it flies, and how fast, with no rotation. */
type Course = { alt: number; headingTrue: number }

type Session = { real: Desktop; second: Core; secondApp: FakeApp; say: (line: string, aloud?: boolean) => void; result: (ok: boolean, line: string) => void; guide: Guide }

/** Each preset write's outcome, by route, for the summary. */
const tally = new Map<string, { landed: number; missed: number }>()

main(() => {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== "--core") throw new Failed("usage: node experiments/areas/sync/p31-handover/session.ts --core <program>")
  const core = path.resolve(args[1]!)
  if (!fs.existsSync(core)) throw new Failed(`there's no core at ${core}`)
  run(core).catch((error: Error) => {
    console.error(`\n${error.message}`)
    process.exit(1)
  })
})

async function run(program: string): Promise<void> {
  process.env.DUALINPUT_BENCH_CORE = path.join(OUT, "dualinput-core.exe")
  process.env.DUALINPUT_BENCH_STAND_IN_HELPER = path.join(OUT, "stand-in-core-helper.exe")
  process.env.DUALINPUT_BENCH_RELAY = path.join(OUT, "bench-relay.exe")
  process.env.DUALINPUT_BENCH_BUILDER = path.join(OUT, "dualinput-profile-builder.exe")
  process.env.DUALINPUT_BENCH_PROFILES = path.join(ROOT, "target", "bench", "profiles")

  const started = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
  const folder = path.join(ROOT, "target", "sim", "runs", `${started}-p31-handover`)
  fs.mkdirSync(folder, { recursive: true })
  const report = path.join(folder, "report.txt")
  const guide = await Guide.start()
  const say = (line: string, aloud = false) => {
    console.log(line)
    fs.appendFileSync(report, `${line}\n`)
    if (aloud) guide.say(line)
  }
  const result = (ok: boolean, line: string) => {
    say(`${ok ? "PASSED" : "FAILED"}: ${line}`)
    if (ok) guide.pass()
    else guide.fail()
  }

  const net = await BenchNetwork.start(1)
  const { settings } = net.core()
  const benchRun = new BenchRun("sim-p31-handover")
  const stub = spawn("ping", ["-n", "86400", "127.0.0.1"], { stdio: "ignore" })
  const second = await benchRun.core("second-pilot", { settings })
  second.act({ act: "watch", process: stub.pid! })
  await second.hear("stage Starting aircraft none")
  second.cockpit({ act: "ready", on: true })
  second.act({ act: "track", names: TRACKED })

  const data = path.join(folder, "core")
  fs.mkdirSync(data, { recursive: true })
  fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ ...settings, "session.name": "Pilot" }, null, 2))
  const out = fs.openSync(`${data}-output.txt`, "w")
  const child = spawn(program, ["--data", data], { stdio: ["ignore", out, out] })
  await until(() => (fs.existsSync(path.join(data, "port.json")) ? true : undefined), 30_000)
  watchKeys(say, child, program, data, () => {
    second.kill().catch(() => {})
    stub.kill()
    net.stop().catch(() => {})
    guide.close()
  })
  const real = await desktop(data, ["session", "sim", "notifications"])
  const simSlice = () => real.slice<SimSlice>("sim")
  const flying = () => simSlice()?.stage === "flying" && BARON.test(simSlice()?.aircraft?.path ?? "")
  if (!flying()) say("Start the sim, load a flight in the Baron 58P on the ground at a stand, engines running, and press Ready to fly.", true)
  await until(() => (flying() ? true : undefined), 60 * 60_000)
  await sleep(15_000)
  const aircraftPath = simSlice()!.aircraft!.path
  say("The session is starting. Keep your hands off the controls until the script says the aircraft is yours.", true)
  say(`the sim is flying ${aircraftPath}; hosting the session`)
  await real.command("session.host", null)
  const session = () => real.slice<SessionSlice>("session")
  const code = await until(() => session()?.code ?? undefined, 30_000)
  const secondApp = await app(second)
  await join(second, code, "Second pilot")
  await until(() => (session()?.members.length === 2 ? true : undefined), 30_000)
  const cfg = `SimObjects\\Airplanes\\${aircraftPath.replaceAll("/", "\\")}\\aircraft.cfg`
  await load(second, { cfg, path: aircraftPath }, { title: "Baron 58P", livery: "bench" })
  const c: Session = { real, second, secondApp, say, result, guide }

  // Both Ready, through preflight's end and the second pilot's catch-up from the 58P.
  await until(() => (secondApp.slice<SessionSlice>("session")?.ready?.length === 0 ? true : undefined), 30_000)
  await secondApp.ok("session.ready", { on: true })
  say("waiting up to 75s for your aircraft to settle")
  await until(() => (session()?.ready?.length === 0 ? true : undefined), 75_000)
  await real.command("session.ready", { on: true })
  await until(() => (session()?.preflight.phase === "ended" ? true : undefined), 15_000)
  await until(() => (/this machine's catch-up ended/.test(second.log()) ? true : undefined), 45_000)
  await sleep(2_000)

  for (const part of [onTheGround, inTheAir, modes]) {
    await part(c).catch((error: Error) => result(false, `${part.name} stopped: ${error.message}`))
  }
  say("\n=== Each route's preset writes")
  for (const [key, { landed, missed }] of [...tally].sort()) say(`${key}: ${landed} landed, ${missed} didn't`)
  say("That's every case. The aircraft is yours. Whoever runs the script stops it with q in its terminal, which replays the core's recording.", true)
}

/**
 * With the 58P flying, the second pilot sets the heading bug, which the 58P takes through a
 * `_Set` preset with a value, through each route in turn. Every heading is a whole number of the
 * preset's 1/16,384ths of a turn, so a value that lands reads back as written.
 */
async function onTheGround(c: Session): Promise<void> {
  c.say("\n=== On the ground, with the 58P flying")
  const headings = [
    [45, 90, 135, 180, 225],
    [270, 315, 225, 180, 135],
    [90, 270, 180, 315, 225],
  ]
  for (const route of ROUTES) {
    await setRoute(c, route)
    for (const heading of headings[route]!) {
      await preset(c, route, "INSTRUMENT_Heading_Bug_Set", "A:AUTOPILOT HEADING LOCK DIR:1", "degrees", heading, 0.05)
    }
  }
}

/**
 * The second pilot takes control and flies 3,000 ft above the stand at 150 kt on a heading 90°
 * from the 58P's, with the autopilot in heading and altitude hold, and the 58P follows. Then the
 * gear handle takes each route; then two handovers in heading mode, one with route 0 and one with
 * route 2, show whether the 58P turns toward a heading bug that didn't follow.
 */
async function inTheAir(c: Session): Promise<void> {
  const { second, say, result } = c
  say("\n=== In the air")
  const stand = await readSim("A:PLANE HEADING DEGREES MAGNETIC", "degrees")
  const magvar = angle((await readSim("A:PLANE HEADING DEGREES TRUE", "degrees")) - stand)
  const alt = await readSim("A:PLANE ALTITUDE", "feet")
  const mixtures = await Promise.all([1, 2].map((n) => readSim(`L:BKSQ_MixtureLeverPosition_${n}`)))
  // The heading flown is a multiple of 45° magnetic, so the bug set to it reads back as written,
  // and never 45°, the first value route 0's heading bug took on the ground.
  let course = norm(Math.round((stand + 90) / 45) * 45)
  if (course === 45) course = 135
  const target = Math.round((alt + 3_000) / 100) * 100
  say(`the 58P stands at ${stand.toFixed(1)}° magnetic, magnetic variation ${magvar.toFixed(1)}°; the second pilot flies ${course}° magnetic at ${target} ft`)

  await setRoute(c, 0)
  say("The second pilot takes control and flies at 3000 feet. Your aircraft will rise and fly on its own.", true)
  const flight: Course = { alt: target, headingTrue: norm(course + magvar) }
  await takeControl(c, "second")
  straightOn(c, flight)
  second.act({
    act: "set",
    numbers: [
      ["A:GENERAL ENG THROTTLE LEVER POSITION:1", 12_500],
      ["A:GENERAL ENG THROTTLE LEVER POSITION:2", 12_500],
      ["A:GENERAL ENG PROPELLER LEVER POSITION:1", 14_500],
      ["A:GENERAL ENG PROPELLER LEVER POSITION:2", 14_500],
      ["L:BKSQ_MixtureLeverPosition_1", mixtures[0]!],
      ["L:BKSQ_MixtureLeverPosition_2", mixtures[1]!],
      ["A:FLAPS HANDLE PERCENT", 0],
      ["A:AUTOPILOT MASTER", 1],
      ["A:AUTOPILOT FLIGHT DIRECTOR ACTIVE", 1],
      ["A:AUTOPILOT HEADING LOCK", 1],
      ["A:AUTOPILOT ALTITUDE LOCK", 1],
      ["A:AUTOPILOT ALTITUDE LOCK VAR", target],
      ["A:AUTOPILOT HEADING LOCK DIR:1", course],
    ],
    texts: [],
  })
  await sleep(8_000)
  const [master, hdg, altHold] = await Promise.all(["A:AUTOPILOT MASTER", "A:AUTOPILOT HEADING LOCK", "A:AUTOPILOT ALTITUDE LOCK"].map((n) => readSim(n, "bool")))
  say(`the following 58P's autopilot: master ${master}, heading mode ${hdg}, altitude hold ${altHold}`)

  // The following aircraft's own autopilot trims what Follow freezes, and putting the trim back keeps it near the PF's.
  const trimFrom = second.lineCount()
  await record(10)
  await sleep(10_500)
  const trims = (await recorded()).map((f) => f[4]!)
  const theirs = second.tracked(trimFrom).at(-1)?.values[5]
  say(`the following 58P's elevator trim over 10s: ${Math.min(...trims).toFixed(2)}% to ${Math.max(...trims).toFixed(2)}%, with the second pilot's at ${theirs?.toFixed(2) ?? "nothing tracked"}%`)

  // The gear handle and the parking brake, on the frozen 58P, where neither moves the aircraft.
  for (const route of ROUTES) {
    await setRoute(c, route)
    let gear = (await readSim("A:GEAR HANDLE POSITION", "bool")) === 1 ? 0 : 1
    let brake = (await readSim("A:BRAKE PARKING POSITION", "bool")) === 1 ? 0 : 1
    for (let i = 0; i < 4; i++) {
      await preset(c, route, "LANDING_GEAR_Gear_Set", "A:GEAR HANDLE POSITION", "bool", gear, 0)
      await preset(c, route, "LANDING_GEAR_ParkingBrake_Set", "A:BRAKE PARKING POSITION", "bool", brake, 0)
      gear = 1 - gear
      brake = 1 - brake
    }
  }
  second.act({ act: "set", numbers: [["A:GEAR HANDLE POSITION", 0], ["A:BRAKE PARKING POSITION", 0]], texts: [] })
  await sleep(2_000)

  // Route 0: the bug the second pilot set as it took control is the one to follow.
  await setRoute(c, 0)
  let bug = await readSim("A:AUTOPILOT HEADING LOCK DIR:1", "degrees")
  let made = ""
  if (Math.abs(angle(bug - course)) < 1) {
    // The bug followed, so route 0 didn't keep its first value here: the drift needs one that differs.
    made = ", made to differ through the inspector, since route 0 moved it"
    await evaluateInPanel(`SimVar.SetSimVarValue("K:HEADING_BUG_SET", "degrees", ${norm(course + 90)}); 0`)
    await sleep(500)
    bug = await readSim("A:AUTOPILOT HEADING LOCK DIR:1", "degrees")
  }
  say(`route 0: the second pilot's bug reads ${course}°, the 58P's ${bug.toFixed(1)}°${made}`)
  say("You take control for 15 seconds. Keep your hands off the controls.", true)
  await handover(c, "with route 0", course, false, flight)

  // Route 2: the bug goes away and back, so the 58P writes it.
  await setRoute(c, 2)
  second.act({ act: "set", numbers: [["A:AUTOPILOT HEADING LOCK DIR:1", norm(course + 45)]], texts: [] })
  await sleep(2_000)
  second.act({ act: "set", numbers: [["A:AUTOPILOT HEADING LOCK DIR:1", course]], texts: [] })
  await sleep(2_000)
  bug = await readSim("A:AUTOPILOT HEADING LOCK DIR:1", "degrees")
  result(Math.abs(angle(bug - course)) < 0.05, `route 2: the 58P's bug followed the second pilot's to ${course}°: it reads ${bug.toFixed(2)}°`)
  say("You take control for 15 seconds again. Keep your hands off the controls.", true)
  await handover(c, "with route 2", course, true, flight)
}

/**
 * Sets the second pilot's aircraft flying `flight` at 150 kt, level, with no rotation. After the
 * second pilot takes control back, its aircraft would fly on from the rotation Follow last wrote.
 */
function straightOn(c: Session, flight: Course): void {
  c.second.act({
    act: "set",
    numbers: [
      ["A:PLANE ALTITUDE", flight.alt],
      ["A:PLANE HEADING DEGREES TRUE", flight.headingTrue],
      ["A:PLANE PITCH DEGREES", 0],
      ["A:PLANE BANK DEGREES", 0],
      ["A:VELOCITY BODY X", 0],
      ["A:VELOCITY BODY Y", 0],
      ["A:VELOCITY BODY Z", 253],
      ["A:ROTATION VELOCITY BODY X", 0],
      ["A:ROTATION VELOCITY BODY Y", 0],
      ["A:ROTATION VELOCITY BODY Z", 0],
    ],
    texts: [],
  })
}

/**
 * The 58P takes control in heading mode, its flight is read for 15s, and the second pilot takes
 * control back and flies `flight` again. `straight` says which the case expects: a 58P whose bug
 * followed flies straight on.
 */
async function handover(c: Session, what: string, course: number, straight: boolean, flight: Course): Promise<void> {
  await record(15)
  await takeControl(c, "real")
  await sleep(15_500)
  const flown = await recorded()
  const turned = Math.max(...flown.map((f) => Math.abs(angle(f[0]! - course))))
  const bank = Math.max(...flown.map((f) => Math.abs(f[1]!)))
  const climbed = flown.at(-1)![2]! - flown[0]![2]!
  const line = `${what}: in the 15s after the 58P took control in heading mode it turned up to ${turned.toFixed(1)}° from ${course}°, banked up to ${bank.toFixed(1)}°, and went ${climbed >= 0 ? "up" : "down"} ${Math.abs(climbed).toFixed(0)} ft`
  c.result(straight ? turned < 5 : turned > 10, straight ? `${line}, so it flew straight on` : `${line}, so the drift happened again`)
  await takeControl(c, "second")
  straightOn(c, flight)
  await sleep(5_000)
}

/**
 * The autopilot's vertical modes: first as state sync carries them to the following 58P, then
 * through the KFC 150's own events on the 58P flying, through the inspector.
 */
async function modes(c: Session): Promise<void> {
  const { second, say, result } = c
  say("\n=== The autopilot's modes")
  // Vertical speed mode at 500 fpm, as the PF's cockpit reads it, then altitude hold back, the two
  // modes in one change each time, as they arrived in the flight.
  second.act({ act: "set", numbers: [["A:AUTOPILOT VERTICAL HOLD VAR:1", 500]], texts: [] })
  await sleep(1_500)
  const from = second.lineCount()
  second.act({ act: "set", numbers: [["A:AUTOPILOT ALTITUDE LOCK", 0], ["A:AUTOPILOT VERTICAL HOLD", 1]], texts: [] })
  await sleep(3_000)
  const targets = [...new Set(second.tracked(from).map((t) => t.values[1]!))]
  say(`after vertical speed mode reached the following 58P, the second pilot's vertical speed target read ${targets.join(", ")} fpm, where it set 500`)
  second.act({ act: "set", numbers: [["A:AUTOPILOT ALTITUDE LOCK", 1], ["A:AUTOPILOT VERTICAL HOLD", 0]], texts: [] })
  await sleep(2_500)
  const [alt, vs] = await Promise.all(["A:AUTOPILOT ALTITUDE LOCK", "A:AUTOPILOT VERTICAL HOLD"].map((n) => readSim(n, "bool")))
  result(alt === 1 && vs === 0, `altitude hold back with vertical speed mode off, in one change, leaves the following 58P in altitude hold ${alt}, vertical speed mode ${vs}`)

  say("You take control for half a minute while the script presses the autopilot's buttons. Keep your hands off the controls.", true)
  await takeControl(c, "real")
  await sleep(2_000)
  const vars: Record<string, string> = {
    ALT: "A:AUTOPILOT ALTITUDE LOCK",
    VS: "A:AUTOPILOT VERTICAL HOLD",
    HDG: "A:AUTOPILOT HEADING LOCK",
    NAV: "A:AUTOPILOT NAV1 LOCK",
    APR: "A:AUTOPILOT APPROACH HOLD",
    BC: "A:AUTOPILOT BACKCOURSE HOLD",
  }
  const read = async () => {
    const values = await Promise.all(Object.values(vars).map((n) => readSim(n, "bool")))
    return Object.keys(vars).map((k, i) => `${k} ${values[i]}`).join(", ")
  }
  // Each step sends its events in one call, so in one frame, and reads the modes 1s later.
  const steps: [string, string[]][] = [
    ["vertical speed mode by toggle", ["AP_PANEL_VS_HOLD"]],
    ["altitude hold and the vertical speed toggle together, as state sync sent them", ["AP_ALT_HOLD", "AP_PANEL_VS_HOLD"]],
    ["vertical speed mode on", ["AP_VS_ON"]],
    ["altitude hold on and vertical speed mode off together", ["AP_ALT_HOLD_ON", "AP_VS_OFF"]],
    ["altitude hold off", ["AP_ALT_HOLD_OFF"]],
    ["altitude hold on", ["AP_ALT_HOLD_ON"]],
    ["heading mode off", ["AP_HDG_HOLD_OFF"]],
    ["heading mode on", ["AP_HDG_HOLD_ON"]],
    ["nav mode on", ["AP_NAV1_HOLD_ON"]],
    ["nav mode off", ["AP_NAV1_HOLD_OFF"]],
    ["approach mode on", ["AP_APR_HOLD_ON"]],
    ["approach mode off", ["AP_APR_HOLD_OFF"]],
    ["back course on", ["AP_BC_HOLD_ON"]],
    ["back course off", ["AP_BC_HOLD_OFF"]],
    ["heading mode on, altitude hold on", ["AP_HDG_HOLD_ON", "AP_ALT_HOLD_ON"]],
  ]
  say(`the 58P's modes before: ${await read()}`)
  for (const [what, events] of steps) {
    const vsBefore = await readSim("A:AUTOPILOT VERTICAL HOLD VAR:1", "feet per minute")
    await evaluateInPanel(`(function () { ${events.map((e) => `SimVar.SetSimVarValue("K:${e}", "number", 0);`).join(" ")} return 0; })()`)
    await sleep(1_000)
    const vsAfter = await readSim("A:AUTOPILOT VERTICAL HOLD VAR:1", "feet per minute")
    say(`${what} (${events.map((e) => `K:${e}`).join(" + ")}): ${await read()}; vertical speed target ${vsBefore} to ${vsAfter} fpm`)
  }
}

/** Sets route.patch's route in our module, through the inspector. */
async function setRoute(c: Session, route: number): Promise<void> {
  await evaluateInPanel(`SimVar.SetSimVarValue("L:DUALINPUT_P31_ROUTE", "number", ${route}); 0`)
  c.say(`--- route ${route}, ${ROUTE_NAMES[route]}`)
}

/**
 * The second pilot sets `variable` to `value`, which state sync on the 58P writes through the
 * preset `name`, and the case reads the 58P's variable until it holds the value, for up to 2.5s,
 * the engine's 1.5s check and the trip between the cores.
 */
async function preset(c: Session, route: number, name: string, variable: string, unit: string, value: number, within: number): Promise<void> {
  const calls = await readSim("L:DUALINPUT_P31_CALLS")
  c.second.act({ act: "set", numbers: [[variable, value]], texts: [] })
  const started = Date.now()
  let read = NaN
  let landed = false
  while (Date.now() - started < 2_500) {
    read = await readSim(variable, unit).catch(() => NaN)
    if (Math.abs(unit === "degrees" ? angle(read - value) : read - value) <= within) {
      landed = true
      break
    }
    await sleep(50)
  }
  const ms = Date.now() - started
  const [after = NaN, id, error, last] = await Promise.all(["CALLS", "ID", "ERROR", "LAST_ROUTE"].map((n) => readSim(`L:DUALINPUT_P31_${n}`)))
  const key = `route ${route}, ${name}`
  const t = tally.get(key) ?? { landed: 0, missed: 0 }
  if (landed) t.landed++
  else t.missed++
  tally.set(key, t)
  c.say(`${landed ? "landed" : "MISSED"}: ${key} ${value}: reads ${Number.isFinite(read) ? Number(read.toFixed(3)) : read}${landed ? ` after ${ms}ms` : " after 2.5s"}; our module made ${after - calls} call${after - calls === 1 ? "" : "s"}, the last through route ${last}, preset ID ${id}, error ${error}`)
}

/** Passes control to the bench core or back to the real one, and waits until the real core says so. */
async function takeControl(c: Session, to: "real" | "second", ms = 15_000): Promise<void> {
  const session = () => c.real.slice<SessionSlice>("session")
  const passed = () => (session()?.pf === session()?.me) === (to === "real")
  // The core drops a press it refuses, as it refuses one while its machine catches up, so the press goes again each second.
  for (const started = Date.now(); !passed(); ) {
    if (Date.now() - started > ms) throw new Failed(`control didn't pass within ${ms / 1000}s`)
    if (to === "second") c.second.cockpit({ act: "take-control" })
    else await c.real.command("take-control.request", null)
    await until(() => (passed() ? true : undefined), 1_000).catch(() => {})
  }
}

function cockpits(): Promise<Awaited<ReturnType<typeof listPages>>> {
  return listPages().then((pages) => pages.filter((p) => /^VCockpit/i.test(p.title)))
}

/** Runs `expression` in the first cockpit panel that answers, found again on each try, since a panel that reloads comes back as another page. */
async function evaluateInPanel<T>(expression: string): Promise<T> {
  let last: Error = new Failed("no cockpit panel answers on the inspector")
  for (let tries = 0; tries < 3; tries++) {
    for (const page of await cockpits()) {
      try {
        return await evaluate<T>(page, expression)
      } catch (error) {
        last = error as Error
      }
    }
    await sleep(1_000)
  }
  throw last
}

async function readSim(name: string, unit = "number"): Promise<number> {
  return Number(await evaluateInPanel<number | boolean>(`SimVar.GetSimVarValue(${JSON.stringify(name)}, ${JSON.stringify(unit)})`))
}

/**
 * Starts reading `READ` in a cockpit panel once each of the panel's frames, for `seconds`, into
 * `DUALINPUT_P31_FLIGHT`. Runs in Coherent GT, so it's ES2017.
 */
async function record(seconds: number): Promise<void> {
  await evaluateInPanel(`(function () {
    var names = ${JSON.stringify(READ)};
    var out = { from: performance.now(), frames: [] };
    window.DUALINPUT_P31_FLIGHT = out;
    function frame() {
      var now = performance.now();
      var row = [];
      for (var i = 0; i < names.length; i++) row.push(Number(SimVar.GetSimVarValue(names[i][0], names[i][1])));
      out.frames.push(row);
      if (now - out.from < ${seconds * 1000} && window.DUALINPUT_P31_FLIGHT === out) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return 0;
  })()`)
}

/** What `record` read, a row of `READ` for each frame, once it has ended. */
async function recorded(): Promise<number[][]> {
  const text = await evaluateInPanel<string>("JSON.stringify(window.DUALINPUT_P31_FLIGHT || null)")
  const read = JSON.parse(text) as { frames: number[][] } | null
  if (!read || read.frames.length < 2) throw new Failed("the cockpit panel recorded no frames")
  return read.frames
}

/** An angle in degrees, from 0 to 360. */
function norm(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

/** The shorter way round from 0 to `degrees`, from -180 to 180. */
function angle(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180
}

async function until<T>(get: () => T | undefined, ms: number): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = get()
    if (value !== undefined) return value
    if (Date.now() - started > ms) throw new Failed(`gave up after ${ms / 1000}s`)
    await sleep(100)
  }
}

function log(data: string): string {
  const recordings = path.join(data, "recordings")
  if (!fs.existsSync(recordings)) return ""
  const run = fs.readdirSync(recordings).sort().at(-1)
  const file = run && path.join(recordings, run, "log.txt")
  return file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
}

function watchKeys(say: (line: string) => void, child: ReturnType<typeof spawn>, program: string, data: string, end: () => void): void {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on("data", async (key: Buffer) => {
    if (key.toString("utf8") !== "q" && key.toString("utf8") !== "\u0003") return
    const stats = log(data).split(/\r?\n/).filter((l) => l.includes("the loop's stats")).at(-1)
    say(`the real core's last loop stats: ${stats ?? "none"}`)
    child.kill()
    await sleep(1_000)
    const recordings = path.join(data, "recordings")
    const run = fs.existsSync(recordings) ? fs.readdirSync(recordings).sort().at(-1) : undefined
    const recording = run && path.join(recordings, run, "inputs.zst")
    if (recording && fs.existsSync(recording)) {
      const replayed = spawnSync(program, ["replay", recording], { encoding: "utf8" })
      say(`the core's replay: ${(replayed.stdout + replayed.stderr).trim()}`)
    }
    end()
    process.exit(0)
  })
}
