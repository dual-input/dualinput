// p40: what moves the Baron 58P's elevator trim and bank in the frames after Follow lets it go at a
// handover (record/areas/build/plan.md, "16c Trim and bank after a handover"; record/areas/sync/log.md,
// 2026-11-18). The lead: the 58P's autopilot is the sim's own, which flies pitch through the trim
// (`pitch_use_trim = 1` in its systems.cfg), and a PID computed on an aircraft that can't respond
// winds up; the 58P sets `pitch_pid_reset_mode=2` and `roll_pid_reset_mode=2`, under which the SDK
// says a PID that hasn't run for 10 frames resets to the aircraft's state when it runs again.
//
// The real core flies the 58P and a bench core on a stand-in plays the second pilot, flying straight
// and level at 150 kt, 3,000 ft above the stand, set again at each case's start. Five handovers, in
// this order, each after 20s of following, with the autopilot:
//
//   reset       on through the following, off from 1s before the handover, and engaged after it
//               as in off-engage, so its PIDs stop for well over 10 frames between
//   on          on through the handover, as stage 14b's session had it
//   off-engage  off through the following, and the script engages heading and altitude hold on the
//               58P 0.6s after it takes control
//   on-again    as on, to see whether it repeats
//   off         off through the following and the handover, so the 58P flies hands off after it
//
// Two runs on 2026-11-19, with the cases in the order on, off, off-engage, reset, on-again,
// measured on and off, and the rest tested nothing: the stand-in carried one case's descent into
// the next, and after a catch-up from its cockpit, which runs no preset, the 58P's autopilot didn't
// engage again (record/areas/flight-model/log.md, 2026-11-19). This version, which levels the
// stand-in each case and gives it the 58P's values for the controls written through presets first,
// hasn't run.
//
// A cockpit panel reads the 58P each of its frames from the case's start to 12s after the
// handover. The report gives each case's frames around the handover and a line on the following
// and on the flight after; frames.json in the run's folder holds every frame.
//
//   node tools/build.ts install                        with the sim closed
//   node tools/bench.ts state-sync                     once, so target/bench holds this tree
//   cargo build --release -p dualinput-core
//   node experiments/areas/flight-model/p40-handover-autopilot/session.ts --core target/release/dualinput-core.exe
//
// Then start the sim and load the 58P at a stand with its engines running; the script says each
// step aloud and needs no hands. q in its terminal stops the core, replays its recording, and ends.

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import type { SessionSlice } from "../../../../src/engines/messages/ts/session/SessionSlice.ts"
import type { SimSlice } from "../../../../src/engines/messages/ts/sim/SimSlice.ts"
import { BenchRun, type Core } from "../../../../tools/bench/cores.ts"
import { load } from "../../../../tools/bench/flights.ts"
import { app, BenchNetwork, join } from "../../../../tools/bench/network.ts"
import { ROOT } from "../../../../tools/lib/repo.ts"
import { Failed, main } from "../../../../tools/lib/run.ts"
import { desktop, type Desktop } from "../../../../tools/sim/desktop.ts"
import { Guide } from "../../../../tools/sim/guide.ts"
import { evaluate, listPages } from "../../../../tools/sim/inspector.ts"

const OUT = path.join(ROOT, "target", "bench", "release-with-checks")
const BARON = /baronpro/i

/** What the panel reads of the 58P each of its frames, as `[column, name, unit]`, in this order. */
const READ: [string, string, string][] = [
  ["frozen", "A:IS ATTITUDE FREEZE ON", "bool"],
  ["ap", "A:AUTOPILOT MASTER", "bool"],
  ["altHold", "A:AUTOPILOT ALTITUDE LOCK", "bool"],
  ["hdgHold", "A:AUTOPILOT HEADING LOCK", "bool"],
  ["hdg", "A:PLANE HEADING DEGREES MAGNETIC", "degrees"],
  ["bank", "A:PLANE BANK DEGREES", "degrees"],
  ["pitch", "A:PLANE PITCH DEGREES", "degrees"],
  ["alt", "A:PLANE ALTITUDE", "feet"],
  ["vs", "A:VERTICAL SPEED", "feet per minute"],
  ["trim", "A:ELEVATOR TRIM PCT", "percent"],
  ["elev", "A:ELEVATOR POSITION", "percent"],
  ["ail", "A:AILERON POSITION", "percent"],
  ["rud", "A:RUDDER POSITION", "percent"],
  ["yokeY", "A:YOKE Y POSITION WITH AP", "percent"],
  ["yokeX", "A:YOKE X POSITION WITH AP", "percent"],
  ["fdPitch", "A:AUTOPILOT FLIGHT DIRECTOR PITCH", "degrees"],
  ["fdBank", "A:AUTOPILOT FLIGHT DIRECTOR BANK", "degrees"],
  ["ias", "A:AIRSPEED INDICATED", "knots"],
  ["alpha", "A:INCIDENCE ALPHA", "degrees"],
  ["beta", "A:INCIDENCE BETA", "degrees"],
  ["wind", "A:AMBIENT WIND VELOCITY", "knots"],
  ["windDir", "A:AMBIENT WIND DIRECTION", "degrees"],
  ["ailTrim", "A:AILERON TRIM PCT", "percent"],
  ["rudTrim", "A:RUDDER TRIM PCT", "percent"],
]
const COL = Object.fromEntries(READ.map(([c], i) => [c, i + 1])) as Record<string, number>

type Case = {
  name: string
  /** The autopilot while the 58P follows. */
  following: boolean
  /** Seconds before the handover the second pilot disengages it, if it does. */
  offBefore?: number
  /** Whether the script engages heading and altitude hold on the 58P after it takes control. */
  engageAfter: boolean
}

// The reset case goes first, since it's the one no run has had yet.
const CASES: Case[] = [
  { name: "reset", following: true, offBefore: 1, engageAfter: true },
  { name: "on", following: true, engageAfter: false },
  { name: "off-engage", following: false, engageAfter: true },
  { name: "on-again", following: true, engageAfter: false },
  { name: "off", following: false, engageAfter: false },
]

/** The input events the 58P profile watches, which the stand-in lacks until it's told them. */
const INPUTS = [
  "ELECTRICAL_Battery_1",
  "ELECTRICAL_Alternator_1",
  "ELECTRICAL_Alternator_2",
  "ELECTRICAL_Avionics_Bus_1",
  "LIGHTING_BEACON_1",
  "LIGHTING_STROBE_1",
  "LIGHTING_NAV_1",
  "LIGHTING_TAXI_1",
  "LIGHTING_LANDING_1",
  "LIGHTING_LANDING_2",
  "LIGHTING_WING_1",
]

const FOLLOW_S = 20
const AFTER_S = 12
const ENGAGE_AFTER_MS = 600

type Session = {
  real: Desktop
  second: Core
  say: (line: string, aloud?: boolean) => void
  folder: string
  course: number
  target: number
  magvar: number
}

main(() => {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== "--core") throw new Failed("usage: node experiments/areas/flight-model/p40-handover-autopilot/session.ts --core <program>")
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
  const folder = path.join(ROOT, "target", "sim", "runs", `${started}-p40`)
  fs.mkdirSync(folder, { recursive: true })
  const report = path.join(folder, "report.txt")
  const guide = await Guide.start()
  const say = (line: string, aloud = false) => {
    console.log(line)
    fs.appendFileSync(report, `${line}\n`)
    if (aloud) guide.say(line)
  }

  const net = await BenchNetwork.start(1)
  const { settings } = net.core()
  const benchRun = new BenchRun("sim-p40")
  const stub = spawn("ping", ["-n", "86400", "127.0.0.1"], { stdio: "ignore" })
  const second = await benchRun.core("second-pilot", { settings })
  second.act({ act: "watch", process: stub.pid! })
  await second.hear("stage Starting aircraft none")
  second.cockpit({ act: "ready", on: true })

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
  say("The session is starting. Keep your hands off the controls until the script says it's done.", true)
  await real.command("session.host", null)
  const session = () => real.slice<SessionSlice>("session")
  const code = await until(() => session()?.code ?? undefined, 30_000)
  const secondApp = await app(second)
  await join(second, code, "Second pilot")
  await until(() => (session()?.members.length === 2 ? true : undefined), 30_000)
  const cfg = `SimObjects\\Airplanes\\${aircraftPath.replaceAll("/", "\\")}\\aircraft.cfg`
  await load(second, { cfg, path: aircraftPath }, { title: "Baron 58P", livery: "bench" })

  await until(() => (secondApp.slice<SessionSlice>("session")?.ready?.length === 0 ? true : undefined), 30_000)
  await secondApp.ok("session.ready", { on: true })
  say("waiting up to 75s for your aircraft to settle")
  await until(() => (session()?.ready?.length === 0 ? true : undefined), 75_000)
  await real.command("session.ready", { on: true })
  await until(() => (session()?.preflight.phase === "ended" ? true : undefined), 15_000)
  await until(() => (/this machine's catch-up ended/.test(second.log()) ? true : undefined), 45_000)
  await sleep(2_000)

  const stand = await readSim("A:PLANE HEADING DEGREES MAGNETIC", "degrees")
  const magvar = angle((await readSim("A:PLANE HEADING DEGREES TRUE", "degrees")) - stand)
  const alt = await readSim("A:PLANE ALTITUDE", "feet")
  const course = norm(Math.round((stand + 90) / 45) * 45)
  const target = Math.round((alt + 3_000) / 100) * 100
  const c: Session = { real, second, say, folder, course, target, magvar }
  await climb(c)
  const all: Record<string, number[][]> = {}
  for (const k of CASES) {
    try {
      all[k.name] = await handover(c, k)
    } catch (error) {
      say(`case ${k.name} stopped: ${(error as Error).message}`)
    }
    fs.writeFileSync(path.join(folder, "frames.json"), JSON.stringify({ columns: ["ms", ...READ.map(([col]) => col)], cases: all }))
  }
  say("That's every case. The aircraft is yours. Whoever runs the script stops it with q in its terminal, which replays the core's recording.", true)
}

/**
 * The second pilot takes control and flies 3,000 ft above the stand at 150 kt, 90° from the 58P's
 * heading, with its trim at -5%, and the 58P follows up to it.
 */
async function climb(c: Session): Promise<void> {
  const { second, say, course, target, magvar } = c
  say(`\n=== The second pilot flies ${course}° magnetic at ${target} ft, 150 kt`)
  say("The second pilot takes control and flies at 3000 feet. Your aircraft will rise and fly on its own.", true)
  const mixtures = await Promise.all([1, 2].map((n) => readSim(`L:BKSQ_MixtureLeverPosition_${n}`)))
  // The stand-in runs no preset, so the controls the profile writes through presets keep its
  // default of 0 there, and after a catch-up from its cockpit wrote the 58P's altimeters to 0,
  // the 58P's autopilot didn't engage for any later case, likely through its electrics
  // (unverified). So the stand-in gets the 58P's values for them before anything is caught up
  // from it.
  const inputs = await Promise.all(INPUTS.map(async (name): Promise<[string, number]> => [name, await readSim(`B:${name}`)]))
  const altimeters = await Promise.all([1, 2].map((n) => readSim(`L:INSTRUMENT_Altimeter_${n}`)))
  second.act({ act: "inputs", events: inputs })
  second.act({ act: "set", numbers: [["L:INSTRUMENT_Altimeter_1", altimeters[0]!], ["L:INSTRUMENT_Altimeter_2", altimeters[1]!]], texts: [] })
  say(`the stand-in takes the 58P's ${inputs.map(([n, v]) => `${n} ${v}`).join(", ")}, and altimeters ${altimeters.join(" and ")}`)
  await takeControl(c, "second")
  level(c)
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
      ["A:GEAR HANDLE POSITION", 0],
      ["A:ELEVATOR TRIM PCT", -5],
      ["A:AUTOPILOT HEADING LOCK DIR:1", course],
    ],
    texts: [],
  })
  for (const started = Date.now(); Math.abs((await readSim("A:PLANE ALTITUDE", "feet")) - target) > 50; ) {
    if (Date.now() - started > 15_000) throw new Failed("the 58P didn't come up to the second pilot's altitude within 15s")
    await sleep(250)
  }
  await sleep(3_000)
}

/**
 * Puts the second pilot's aircraft straight and level at the run's altitude and course, at 150 kt.
 * While the 58P flies, the bench core follows it, so the stand-in's aircraft is wherever the 58P
 * left it, and flies on by those velocities until something sets them.
 */
function level(c: Session): void {
  c.second.act({
    act: "set",
    numbers: [
      ["A:PLANE ALTITUDE", c.target],
      ["A:PLANE HEADING DEGREES TRUE", norm(c.course + c.magvar)],
      ["A:PLANE PITCH DEGREES", 0],
      ["A:PLANE BANK DEGREES", 0],
      ["A:VELOCITY BODY X", 0],
      ["A:VELOCITY BODY Y", 0],
      ["A:VELOCITY BODY Z", 253],
      ["A:ROTATION VELOCITY BODY X", 0],
      ["A:ROTATION VELOCITY BODY Y", 0],
      ["A:ROTATION VELOCITY BODY Z", 0],
      ["A:ELEVATOR TRIM PCT", -5],
    ],
    texts: [],
  })
}

/** The second pilot's autopilot in heading and altitude hold, or off. */
function autopilot(c: Session, on: boolean): void {
  const v = on ? 1 : 0
  c.second.act({
    act: "set",
    numbers: [
      ["A:AUTOPILOT MASTER", v],
      ["A:AUTOPILOT FLIGHT DIRECTOR ACTIVE", v],
      ["A:AUTOPILOT HEADING LOCK", v],
      ["A:AUTOPILOT ALTITUDE LOCK", v],
      ["A:AUTOPILOT ALTITUDE LOCK VAR", c.target],
      ["A:AUTOPILOT HEADING LOCK DIR:1", c.course],
    ],
    texts: [],
  })
}

/**
 * One handover: the second pilot holds control with the case's autopilot, the 58P follows for
 * `FOLLOW_S`, then takes control and flies for `AFTER_S`. Returns the panel's frames.
 */
async function handover(c: Session, k: Case): Promise<number[][]> {
  const { say } = c
  say(`\n=== Case ${k.name}`)
  await takeControl(c, "second")
  level(c)
  autopilot(c, k.following)
  await record(FOLLOW_S + AFTER_S + 2)
  const followed = Date.now()
  if (k.offBefore !== undefined) {
    await sleep((FOLLOW_S - k.offBefore - 4) * 1000)
    say("In this case the autopilot goes off a second before you take control, and back on after. Listen for a disconnect tone.", true)
    await sleep(4_000)
    autopilot(c, false)
    await sleep(k.offBefore * 1000)
  } else {
    await sleep(FOLLOW_S * 1000)
  }
  say(`Case ${k.name}: you take control.`, true)
  await takeControl(c, "real")
  const passedAt = Date.now() - followed
  if (k.engageAfter) {
    await sleep(ENGAGE_AFTER_MS)
    await engage(c)
    await sleep(1_000)
    say(`after the script engaged it, the 58P's autopilot master reads ${await readSim("A:AUTOPILOT MASTER", "bool")}`)
  }
  // The second pilot takes control back early if the 58P dives or rolls far, so no case ends in
  // the water, as one did when the stand-in carried a dive from one case into the next.
  const ends = followed + (FOLLOW_S + AFTER_S + 1) * 1000
  while (Date.now() < ends) {
    const lost = c.target - (await readSim("A:PLANE ALTITUDE", "feet"))
    const bank = Math.abs(await readSim("A:PLANE BANK DEGREES", "degrees"))
    if (lost > 400 || bank > 45) {
      say(`the 58P lost ${lost.toFixed(0)} ft and banks ${bank.toFixed(0)}°, so the second pilot takes control back early`)
      await takeControl(c, "second")
      level(c)
      break
    }
    await sleep(250)
  }
  await sleep(Math.max(0, ends - Date.now()))
  const frames = await recorded()
  summarize(c, k, frames, passedAt)
  return frames
}

/** Engages the 58P's autopilot in heading and altitude hold, at the second pilot's altitude, from a panel. */
async function engage(c: Session): Promise<void> {
  await evaluateInPanel(`(function () {
    if (!SimVar.GetSimVarValue("A:AUTOPILOT MASTER", "bool")) SimVar.SetSimVarValue("K:AP_MASTER", "number", 0);
    SimVar.SetSimVarValue("K:AP_HDG_HOLD_ON", "number", 0);
    SimVar.SetSimVarValue("K:AP_ALT_HOLD_ON", "number", 0);
    SimVar.SetSimVarValue("K:AP_ALT_VAR_SET_ENGLISH", "number", ${c.target});
    return 0;
  })()`)
}

/** Prints the case's frames around the handover and one line each on the following and the flight after. */
function summarize(c: Session, k: Case, frames: number[][], passedAt: number): void {
  const { say } = c
  const v = (f: number[], col: string) => f[COL[col]!]!
  // The handover is the first frame the attitude freeze reads off after reading on.
  const release = frames.findIndex((f, i) => i > 0 && v(frames[i - 1]!, "frozen") === 1 && v(f, "frozen") === 0)
  if (release < 0) {
    say(`no frame read the freeze lift; the core passed control ${passedAt}ms into the case`)
    return
  }
  const t0 = frames[release]![0]!
  const t = (f: number[]) => (f[0]! - t0) / 1000
  const span = (rows: number[][], col: string) => {
    const xs = rows.map((f) => v(f, col))
    return `${Math.min(...xs).toFixed(2)} to ${Math.max(...xs).toFixed(2)}`
  }
  const following = frames.filter((f) => t(f) >= -10 && t(f) < 0)
  const after = frames.filter((f) => t(f) >= 0 && t(f) <= AFTER_S - 1)
  const fps = (frames.length - 1) / ((frames.at(-1)![0]! - frames[0]![0]!) / 1000)
  say(`the panel read ${frames.length} frames, ${fps.toFixed(1)} a second; Follow let go at frame ${release}`)
  say(
    `in the last 10s of following: trim ${span(following, "trim")}%, elevator ${span(following, "elev")}%, aileron ${span(following, "ail")}%, ` +
      `flight director pitch ${span(following, "fdPitch")}° and bank ${span(following, "fdBank")}°, IAS ${span(following, "ias")} kt, ` +
      `alpha ${span(following, "alpha")}°, beta ${span(following, "beta")}°, wind ${span(following, "wind")} kt from ${span(following, "windDir")}°`,
  )
  const last = after.at(-1)!
  const first = frames[release - 1]!
  const turned = Math.max(...after.map((f) => Math.abs(angle(v(f, "hdg") - c.course))))
  say(
    `in the ${(t(last)).toFixed(1)}s after: trim ${span(after, "trim")}%, bank ${span(after, "bank")}°, pitch ${span(after, "pitch")}°, ` +
      `turned up to ${turned.toFixed(1)}° from ${c.course}°, altitude ${(v(last, "alt") - v(first, "alt")).toFixed(0)} ft, ` +
      `elevator ${span(after, "elev")}%, aileron ${span(after, "ail")}%, IAS ${span(after, "ias")} kt`,
  )
  const cols = ["ap", "hdg", "bank", "pitch", "alt", "vs", "trim", "elev", "ail", "yokeY", "yokeX", "fdPitch", "fdBank", "ias", "alpha", "beta"]
  say(`  t(s)   frz ${cols.map((col) => col.padStart(7)).join("")}`)
  for (const f of frames) {
    const at = t(f)
    const dense = at >= -0.5 && at <= 2.5
    const sparse = at > 2.5 && Math.abs(at - Math.round(at)) < 0.5 / fps
    if (!dense && !sparse) continue
    say(`  ${at.toFixed(2).padStart(6)} ${String(v(f, "frozen")).padStart(3)} ${cols.map((col) => v(f, col).toFixed(col === "ap" ? 0 : 1).padStart(7)).join("")}`)
  }
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
 * `DUALINPUT_P40_FRAMES`, each row the panel's clock in ms and then the values. Runs in Coherent
 * GT, so it's ES2017.
 */
async function record(seconds: number): Promise<void> {
  await evaluateInPanel(`(function () {
    var names = ${JSON.stringify(READ.map(([, name, unit]) => [name, unit]))};
    var out = { from: performance.now(), frames: [] };
    window.DUALINPUT_P40_FRAMES = out;
    function frame() {
      var now = performance.now();
      var row = [now];
      for (var i = 0; i < names.length; i++) row.push(Number(SimVar.GetSimVarValue(names[i][0], names[i][1])));
      out.frames.push(row);
      if (now - out.from < ${seconds * 1000} && window.DUALINPUT_P40_FRAMES === out) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return 0;
  })()`)
}

/** What `record` read, once it has ended. */
async function recorded(): Promise<number[][]> {
  const text = await evaluateInPanel<string>("JSON.stringify(window.DUALINPUT_P40_FRAMES || null)")
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
