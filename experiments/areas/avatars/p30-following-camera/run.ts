/*
 * p30: where a following machine's camera reads in flight, to find a reading `Follow`'s pose writes don't shift
 * (record/areas/avatars/log.md, "2026-11-17: On a following machine the camera reads one frame of the aircraft's motion
 * behind the seat, on every axis"). The real core flies the Baron 58P in the sim at a stand, a bench core on a stand-in sim takes
 * control, and its stand-in aircraft climbs 3,000 ft and flies straight at three speeds, turns, and climbs, while the 58P
 * follows it. Each frame, two readers write down the camera:
 *
 *   - from outside the sim, as the core reads it: SimConnect_CameraGet in each of its four referentials, SIMOBJECT,
 *     WORLD, EYEPOINT, and SIMOBJECT_DATUM, beside the aircraft's pose at period SIM_FRAME, into results/p30-*.ndjson
 *   - from inside our WASM module, with camera-in-module.patch applied: fsCameraGet in the same four referentials, and
 *     the pose, just before the routine host's frame and just after it, so on both sides of `Follow`'s write, into the
 *     module's work folder, which this script copies into results/p30-*-module.csv
 *
 * analyze.mjs reads both and says, for each reading, how far behind the seat's eye it is against one frame's travel.
 *
 * Before it, with the sim closed and the installed Dual Input quit from its tray icon, since its app writes its own
 * package into Community as it starts:
 *
 *   git apply experiments/areas/avatars/p30-following-camera/camera-in-module.patch
 *   node tools/build.ts install
 *   git apply -R experiments/areas/avatars/p30-following-camera/camera-in-module.patch
 *   node tools/bench.ts flight-model          once, so target/bench holds this tree's bench build and profiles
 *   cargo build --release -p dualinput-core -p dualinput-core-helper
 *
 * Then, with the sim at its main menu:
 *
 *   node experiments/areas/avatars/p30-following-camera/run.ts --core target/release/dualinput-core.exe
 *
 * The pilot loads the 58P at a stand and presses Ready to fly, then keeps the sim in front and the cockpit view in the
 * left seat, with their hands off, for about 3 minutes, until the long low beep. If ChasePlane drives the camera, the
 * script asks for it to be turned off for one more run of 15s: Page Up once it's off, Page Down to skip that run.
 */

import { spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"

import type { SessionSlice } from "../../../../src/engines/messages/ts/session/SessionSlice.ts"
import type { SimSlice } from "../../../../src/engines/messages/ts/sim/SimSlice.ts"
import { BenchRun, type Core } from "../../../../tools/bench/cores.ts"
import { load } from "../../../../tools/bench/flights.ts"
import { StandInHelper } from "../../../../tools/bench/helper.ts"
import { app, BenchNetwork, join } from "../../../../tools/bench/network.ts"
import { userCfgs } from "../../../../tools/lib/install.ts"
import { ROOT } from "../../../../tools/lib/repo.ts"
import { desktop, type Desktop } from "../../../../tools/sim/desktop.ts"
import { Guide } from "../../../../tools/sim/guide.ts"
import { evaluate, listPages } from "../../../../tools/sim/inspector.ts"
// @ts-expect-error: a JavaScript module of the experiments, with no types
import { resultFile, stamp } from "../../../tools/results.mjs"

const require = createRequire(path.join(ROOT, "experiments", "package.json"))
// node-simconnect 4.2.0, which the experiments' package.json pins.
const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require("node-simconnect")

const OUT = path.join(ROOT, "target", "bench", "release-with-checks")
const BARON = /baronpro/i

/** The copilot's eye in the 58P's profile, where the second pilot's camera sits, as tools/sim/flight-model.ts has it. */
const COPILOT_EYE: [number, number, number] = [-0.282, 0.855, -0.144]

/** The module's work folder on a Steam install, which camera-in-module.patch writes `p30-camera.csv` into. */
const MODULE_CSV = path.join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "WASM", "MSFS2024", "dualinput", "work", "p30-camera.csv")

/** What the outside reader reads of the 58P each sim frame, as `[name, unit]`, in this order. */
const POSE: [string, string][] = [
  ["PLANE LATITUDE", "degrees"],
  ["PLANE LONGITUDE", "degrees"],
  ["PLANE ALTITUDE", "feet"],
  ["PLANE HEADING DEGREES TRUE", "degrees"],
  ["PLANE PITCH DEGREES", "degrees"],
  ["PLANE BANK DEGREES", "degrees"],
  ["VELOCITY BODY X", "feet per second"],
  ["VELOCITY BODY Y", "feet per second"],
  ["VELOCITY BODY Z", "feet per second"],
  ["IS LATITUDE LONGITUDE FREEZE ON", "bool"],
  ["ABSOLUTE TIME", "seconds"],
]

/** The stand-in's velocities at 0, which stops its aircraft where it is. */
const STILL: [string, number][] = ["A:VELOCITY BODY X", "A:VELOCITY BODY Y", "A:VELOCITY BODY Z", "A:ROTATION VELOCITY BODY X", "A:ROTATION VELOCITY BODY Y", "A:ROTATION VELOCITY BODY Z"].map((name) => [name, 0])

/** What the stand-in sends of its aircraft after each of its frames, in this order. */
const TRACKED = ["A:PLANE LATITUDE", "A:PLANE LONGITUDE", "A:PLANE ALTITUDE", "A:PLANE HEADING DEGREES TRUE", "A:PLANE PITCH DEGREES", "A:PLANE BANK DEGREES"]

/** Meters a second, in the stand-in's feet a second. */
const FPS = (ms: number): number => ms / 0.3048

type Session = { real: Desktop; second: Core; say: (line: string, aloud?: boolean) => void; guide: Guide; reader: Reader }

main().catch((error: Error) => {
  console.error(`\n${error.stack ?? error.message}`)
  process.exit(1)
})

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== "--core") throw new Error("usage: node experiments/areas/avatars/p30-following-camera/run.ts --core <program>")
  const program = path.resolve(args[1]!)
  if (!fs.existsSync(program)) throw new Error(`there's no core at ${program}`)
  process.env.DUALINPUT_BENCH_CORE = path.join(OUT, "dualinput-core.exe")
  process.env.DUALINPUT_BENCH_STAND_IN_HELPER = path.join(OUT, "stand-in-core-helper.exe")
  process.env.DUALINPUT_BENCH_RELAY = path.join(OUT, "bench-relay.exe")
  process.env.DUALINPUT_BENCH_BUILDER = path.join(OUT, "dualinput-profile-builder.exe")
  process.env.DUALINPUT_BENCH_PROFILES = path.join(ROOT, "target", "bench", "profiles")

  const when: string = stamp()
  const ndjson: string = resultFile("avatars", "p30-following-camera", "ndjson", when)
  const report: string = resultFile("avatars", "p30-following-camera", "txt", when)
  const moduleCsv: string = resultFile("avatars", "p30-following-camera", "csv", when).replace(/\.csv$/, "-module.csv")
  const moduleFrom = fs.existsSync(MODULE_CSV) ? fs.statSync(MODULE_CSV).size : 0
  const guide = await Guide.start()
  const say = (line: string, aloud = false) => {
    console.log(`${new Date().toISOString().slice(11, 19)} ${line}`)
    fs.appendFileSync(report, `${line}\n`)
    if (aloud) guide.say(line)
  }

  const net = await BenchNetwork.start(1)
  const { settings } = net.core()
  const benchRun = new BenchRun("p30-following-camera")
  const stub = spawn("ping", ["-n", "86400", "127.0.0.1"], { stdio: "ignore" })
  const helper = await StandInHelper.start()
  const userCfg = userCfgs().find((file) => fs.existsSync(file))
  const second = await benchRun.core("second-pilot", helper.coreOptions(userCfg ? { ...settings, "sim.user-cfg": userCfg } : settings))
  second.act({ act: "watch", process: stub.pid! })
  await second.hear("stage Starting aircraft none")
  second.cockpit({ act: "ready", on: true })
  second.act({ act: "track", names: TRACKED })
  second.act({ act: "set", numbers: [["E:IS AVATAR", 0]], texts: [] })
  second.act({ act: "camera", referential: 1, position: COPILOT_EYE, pitch: 0, yaw: 0, roll: 0, fov: 1 })

  const data = path.join(ROOT, "target", "sim", "runs", `${when}-p30-following-camera`)
  fs.mkdirSync(data, { recursive: true })
  fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ ...settings, "session.name": "Pilot" }, null, 2))
  const out = fs.openSync(`${data}-output.txt`, "w")
  const child = spawn(program, ["--data", data], { stdio: ["ignore", out, out] })
  const end = async () => {
    child.kill()
    await second.kill().catch(() => {})
    stub.kill()
    helper.close()
    await net.stop().catch(() => {})
    guide.close()
  }
  try {
    await until(() => (fs.existsSync(path.join(data, "port.json")) ? true : undefined), 30_000)
    const real = await desktop(data, ["session", "sim"])
    const simSlice = () => real.slice<SimSlice>("sim")
    const flying = () => simSlice()?.stage === "flying" && BARON.test(simSlice()?.aircraft?.path ?? "")
    if (!flying()) say("Start the sim, load a flight in the Baron 58P on the ground at a stand, and press Ready to fly.", true)
    await until(() => (flying() ? true : undefined), 60 * 60_000)
    await sleep(15_000)
    const aircraftPath = simSlice()!.aircraft!.path
    say("The session is starting. Sit in the left seat in the cockpit view, keep your hands off the mouse and the controls, and keep the sim in front until the long low beep.", true)
    await real.command("session.host", null)
    const session = () => real.slice<SessionSlice>("session")
    const code = await until(() => session()?.code ?? undefined, 30_000)
    const secondApp = await app(second)
    await join(second, code, "Second pilot")
    await until(() => (session()?.members.length === 2 ? true : undefined), 30_000)
    const cfg = `SimObjects\\Airplanes\\${aircraftPath.replaceAll("/", "\\")}\\aircraft.cfg`
    await load(second, { cfg, path: aircraftPath }, { title: "Baron 58P", livery: "bench" })
    // Both Ready, through preflight's end, after which either may take control.
    await until(() => (secondApp.slice<SessionSlice>("session")?.ready?.length === 0 ? true : undefined), 30_000)
    await secondApp.ok("session.ready", { on: true })
    await until(() => (session()?.ready?.length === 0 ? true : undefined), 75_000)
    await real.command("session.ready", { on: true })
    await until(() => (session()?.preflight.phase === "ended" ? true : undefined), 30_000)
    await until(() => (/this machine's catch-up ended/.test(second.log()) ? true : undefined), 45_000)

    const reader = await Reader.open(ndjson, say)
    const c: Session = { real, second, say, guide, reader }
    await flights(c)
    reader.close()
  } finally {
    await setPhase(0).catch(() => {})
    await end()
    if (fs.existsSync(MODULE_CSV)) {
      const all = fs.readFileSync(MODULE_CSV)
      fs.writeFileSync(moduleCsv, all.subarray(moduleFrom))
      say(`copied ${((all.length - moduleFrom) / 1e6).toFixed(1)} MB of the module's lines to ${path.relative(ROOT, moduleCsv)}`)
    } else {
      say(`the module wrote no ${MODULE_CSV.replace(process.env.APPDATA ?? "", "%APPDATA%")}, so it ran without camera-in-module.patch`)
    }
  }
  const analyzed = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "analyze.mjs"), ndjson, moduleCsv], { stdio: ["ignore", "pipe", "inherit"] })
  let text = ""
  analyzed.stdout!.setEncoding("utf8").on("data", (chunk: string) => (text += chunk))
  await new Promise((done) => analyzed.on("exit", done))
  console.log(text)
  fs.appendFileSync(report, `\n${text}`)
  console.log(`The report is in ${path.relative(ROOT, report)}.`)
  process.exit(0)
}

/** The stand-in takes control at the stand, climbs 3,000 ft, flies straight at three speeds, turns, and climbs, then lands back on the stand and hands back. */
async function flights(c: Session): Promise<void> {
  const { second, say, guide, reader } = c
  const stand = await standIn(second)
  await takeControl(c, "second")
  second.act({ act: "set", numbers: STILL, texts: [] })
  await sleep(4_000)
  guide.tick()

  const phase = async (n: number, what: string, ms: number) => {
    say(`phase ${n}: ${what}`)
    reader.phase = n
    await setPhase(n)
    await sleep(ms)
  }
  await phase(1, "following, still, on the stand", 6_000)
  await phase(2, "climbing straight up at 91 m/s for 10s", 0)
  second.act({ act: "set", numbers: [["A:VELOCITY BODY Y", 300]], texts: [] })
  await sleep(10_000)
  second.act({ act: "set", numbers: [["A:VELOCITY BODY Y", 0]], texts: [] })
  await phase(3, "level, still, 3,000 ft up", 0)
  await sleep(5_000)
  for (const [n, speed] of [[4, 40], [5, 85], [6, 130]] as const) {
    second.act({ act: "set", numbers: [["A:VELOCITY BODY Z", FPS(speed)]], texts: [] })
    await phase(n, `level at ${speed} m/s`, 12_000)
  }
  second.act({ act: "set", numbers: [["A:VELOCITY BODY Z", FPS(85)]], texts: [] })
  await phase(7, "turning right at 85 m/s, banked 25 degrees", 0)
  await ramp(second, [["A:PLANE BANK DEGREES", 0, -25]], 2_000)
  second.act({ act: "set", numbers: [["A:ROTATION VELOCITY BODY Y", (3 * Math.PI) / 180]], texts: [] })
  await sleep(15_000)
  second.act({ act: "set", numbers: [["A:ROTATION VELOCITY BODY Y", 0]], texts: [] })
  await ramp(second, [["A:PLANE BANK DEGREES", -25, 0]], 2_000)
  await phase(8, "climbing at 85 m/s, nose up 8 degrees", 0)
  await ramp(second, [["A:PLANE PITCH DEGREES", 0, -8]], 2_000)
  await sleep(8_000)
  await ramp(second, [["A:PLANE PITCH DEGREES", -8, 0]], 2_000)
  await phase(9, "level at 85 m/s", 10_000)

  if (reader.chasePlane) {
    reader.phase = 0
    await setPhase(0)
    say("ChasePlane drives the camera. Turn it off in its own settings, and press Page Up when it's off, or Page Down to skip this part.", true)
    guide.skipped()
    guide.declined()
    let answer: "off" | "skip" | "none" = "none"
    for (const started = Date.now(); Date.now() - started < 120_000 && answer === "none"; await sleep(100)) {
      if (guide.skipped()) answer = "off"
      else if (guide.declined()) answer = "skip"
    }
    say(`ChasePlane: ${answer === "off" ? "turned off" : answer === "skip" ? "left on, the run skipped" : "no answer in 120s, the run skipped"}`)
    if (answer === "off") {
      say("Keep your hands off again.", true)
      await sleep(3_000)
      await phase(10, "level at 85 m/s, ChasePlane off", 15_000)
      say("You can turn ChasePlane back on after the long low beep.", true)
    }
  }

  // Back on the stand, written at once from over 1km away, and the pilot's again.
  reader.phase = 0
  await setPhase(0)
  second.act({ act: "set", numbers: [...STILL, ["A:PLANE PITCH DEGREES", stand.pitch], ["A:PLANE BANK DEGREES", stand.bank], ["A:PLANE HEADING DEGREES TRUE", stand.heading], ["A:PLANE LATITUDE", stand.lat], ["A:PLANE LONGITUDE", stand.lon], ["A:PLANE ALTITUDE", stand.alt]], texts: [] })
  await sleep(4_000)
  await takeControl(c, "real")
  guide.fail()
  say("That's all: your aircraft is back on its stand and yours. The script stops the cores and writes its report.", true)
}

/** The outside reader: a SimConnect connection of its own, which reads the camera in each referential at each `Frame` event, and the pose every sim frame. */
class Reader {
  phase = 0
  chasePlane = false
  private readonly handle: any
  private readonly file: fs.WriteStream
  private seq = 0
  private readonly started = process.hrtime.bigint()
  private constructor(handle: any, file: string) {
    this.handle = handle
    this.file = fs.createWriteStream(file)
  }

  static async open(file: string, say: (line: string) => void): Promise<Reader> {
    const { handle } = await open("DUALINPUT P30 reader", Protocol.SunRise)
    const reader = new Reader(handle, file)
    const FRAME = 1
    const DEFINITION = 1
    const REQUEST = 1
    handle.on("exception", (e: any) => reader.write({ k: "exception", name: e.exceptionName, index: e.index }))
    handle.on("cameraStatus", (s: any) => {
      reader.chasePlane = s.acquiredState === 2
      reader.write({ k: "status", acquired: s.acquiredState })
      say(`the camera's status: ${["not acquired", "acquired", "acquired by another client, such as ChasePlane", "disabled by the user"][s.acquiredState] ?? s.acquiredState}`)
    })
    handle.on("eventFrame", (e: any) => {
      if (e.clientEventId !== FRAME) return
      reader.write({ k: "frame", fps: e.frameRate, speed: e.simSpeed })
      for (const referential of [1, 2, 3, 4]) handle.cameraGet(referential)
    })
    handle.on("cameraData", (r: any) => {
      const c = r.cameraData
      reader.write({ k: "cam", ref: c.positionReferential, x: c.position.x, y: c.position.y, z: c.position.z, p: c.pbh.pitch, b: c.pbh.bank, h: c.pbh.heading, fov: c.fov })
    })
    handle.on("simObjectData", (d: any) => {
      if (d.requestID !== REQUEST) return
      const values = POSE.map(() => d.data.readFloat64())
      reader.write({ k: "pose", v: values })
    })
    for (const [name, unit] of POSE) handle.addToDataDefinition(DEFINITION, name, unit, SimConnectDataType.FLOAT64)
    handle.requestDataOnSimObject(REQUEST, DEFINITION, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.SIM_FRAME, 0)
    handle.subscribeToSystemEvent(FRAME, "Frame")
    handle.cameraGetStatus()
    reader.write({ k: "pose names", names: POSE.map(([name, unit]) => `${name}, ${unit}`) })
    await sleep(1_000)
    return reader
  }

  /** One line of what arrived, with the order it arrived in, the time in µs since the reader opened, and the phase. */
  write(fields: Record<string, unknown>): void {
    const t = Number((process.hrtime.bigint() - this.started) / 1000n)
    this.file.write(`${JSON.stringify({ n: this.seq++, t, phase: this.phase, ...fields })}\n`)
  }

  close(): void {
    try {
      this.handle.close()
    } catch {
      // Already closed.
    }
    this.file.end()
  }
}

/** Tells camera-in-module.patch's code which phase this is, through `L:DUALINPUT_P30_PHASE`, which it writes down while above 0. */
async function setPhase(n: number): Promise<void> {
  await evaluateInPanel(`SimVar.SetSimVarValue("L:DUALINPUT_P30_PHASE", "number", ${n}); 0`)
}

/** Passes control to the bench core or back to the real one, and waits until the real core says so. */
async function takeControl(c: Session, to: "real" | "second", ms = 20_000): Promise<void> {
  const session = () => c.real.slice<SessionSlice>("session")
  const passed = () => (session()?.pf === session()?.me) === (to === "real")
  // The core drops a press it refuses, as it refuses one while its machine catches up, so the press goes again each second.
  for (const started = Date.now(); !passed(); ) {
    if (Date.now() - started > ms) throw new Error(`control didn't pass within ${ms / 1000}s`)
    if (to === "second") c.second.cockpit({ act: "take-control" })
    else await c.real.command("take-control.request", null)
    await until(() => (passed() ? true : undefined), 1_000).catch(() => {})
  }
}

/** The stand-in's aircraft as its last frame left it. */
async function standIn(second: Core): Promise<{ lat: number; lon: number; alt: number; heading: number; pitch: number; bank: number }> {
  const before = second.lineCount()
  await until(() => (second.tracked(before).length > 0 ? true : undefined), 5_000)
  const [lat, lon, alt, heading, pitch, bank] = second.tracked(before).at(-1)!.values
  return { lat: lat!, lon: lon!, alt: alt!, heading: heading!, pitch: pitch!, bank: bank! }
}

/** Moves each of the stand-in's variables, as `[name, from, to]`, in 20 even steps over `ms`. */
async function ramp(second: Core, moves: [string, number, number][], ms: number): Promise<void> {
  for (let step = 1; step <= 20; step++) {
    second.act({ act: "set", numbers: moves.map(([name, from, to]) => [name, from + ((to - from) * step) / 20]), texts: [] })
    await sleep(ms / 20)
  }
}

/** Runs `expression` in the first cockpit panel that answers, found again on each try, since a panel that reloads comes back as another page. */
async function evaluateInPanel<T>(expression: string): Promise<T> {
  let last = new Error("no cockpit panel answers on the inspector")
  for (let tries = 0; tries < 3; tries++) {
    for (const page of (await listPages()).filter((p) => /^VCockpit/i.test(p.title))) {
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

async function until<T>(get: () => T | undefined, ms: number): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = get()
    if (value !== undefined) return value
    if (Date.now() - started > ms) throw new Error(`gave up after ${ms / 1000}s`)
    await sleep(100)
  }
}
