// A following pilot's camera's cases in the sim, for one session with someone at the sim, in the
// Black Square Baron 58P (record/areas/build/plan.md, "16b A following pilot's camera"): with the
// camera read by the platform's `Camera` in our module, a pilot whose 58P follows a bench core's
// stand-in in flight keeps their seat, and a click lands where it did at the stand, while
// following, in active pause, with ChasePlane off, on foot, and after taking control in flight.
//
// The 58P's profile locates no switch, so a click is judged against the pilot's own click on the
// same target at the stand, where the camera reads true: the bench core is fed the pilot's figure,
// and each click's hand must land within 5cm of the stand's, where a camera a frame behind would
// put it meters off.
//
//   git apply experiments/areas/avatars/p29-sim-session/update-timer.patch
//   node tools/build.ts install                        with the sim closed and the installed
//                                                      Dual Input quit from its tray
//   git apply -R experiments/areas/avatars/p29-sim-session/update-timer.patch
//   node tools/bench.ts avatars                        once, so target/bench holds this tree
//   cargo build --release -p dualinput-core -p dualinput-core-helper
//   node tools/sim/camera.ts --core target/release/dualinput-core.exe
//
// Then start the sim and load the 58P at a stand; the script says each step aloud. Page Up says
// a step is done, Page Down skips it, and the script stops the cores and writes report.txt in its
// run's folder at the end.

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import type { FedFigure } from "../../src/engines/messages/ts/bench/FedFigure.ts"
import type { SessionSlice } from "../../src/engines/messages/ts/session/SessionSlice.ts"
import type { SimSlice } from "../../src/engines/messages/ts/sim/SimSlice.ts"
import { BenchRun, type Core, type Fed } from "../bench/cores.ts"
import { load } from "../bench/flights.ts"
import { StandInHelper } from "../bench/helper.ts"
import { app, BenchNetwork, join } from "../bench/network.ts"
import { userCfgs } from "../lib/install.ts"
import { ROOT } from "../lib/repo.ts"
import { Failed, main } from "../lib/run.ts"
import { desktop, type Desktop } from "./desktop.ts"
import { Guide } from "./guide.ts"
import { evaluate, listPages } from "./inspector.ts"

const OUT = path.join(ROOT, "target", "bench", "release-with-checks")
const BARON = /baronpro/i

/** The copilot's eye in the 58P's profile, where the second pilot's camera sits, as tools/sim/flight-model.ts has it, so change both together. */
const COPILOT_EYE: [number, number, number] = [-0.282, 0.855, -0.144]
/** How far a click's hand may land from the stand's, and the eye from the stand's, in meters. */
const CLICK_WITHIN = 0.05
const EYE_WITHIN = 0.1
const STILL: [string, number][] = ["A:VELOCITY BODY X", "A:VELOCITY BODY Y", "A:VELOCITY BODY Z", "A:ROTATION VELOCITY BODY X", "A:ROTATION VELOCITY BODY Y", "A:ROTATION VELOCITY BODY Z"].map((name) => [name, 0])
const TRACKED = ["A:PLANE LATITUDE", "A:PLANE LONGITUDE", "A:PLANE ALTITUDE", "A:PLANE HEADING DEGREES TRUE"]

type V3 = [number, number, number]
type Session = { real: Desktop; second: Core; say: (line: string, aloud?: boolean) => void; result: (ok: boolean, line: string) => void; guide: Guide }

main(() => {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== "--core") throw new Failed("usage: node tools/sim/camera.ts --core <program>")
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
  const folder = path.join(ROOT, "target", "sim", "runs", `${started}-camera`)
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
  const benchRun = new BenchRun("sim-camera")
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

  const data = path.join(folder, "core")
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
    if (!flying()) say("Start the sim, load a flight in the Baron 58P on the ground at a stand, engines running, and press Ready to fly.", true)
    await until(() => (flying() ? true : undefined), 60 * 60_000)
    await sleep(15_000)
    const aircraftPath = simSlice()!.aircraft!.path
    say("The session is starting. Sit in the left seat in the cockpit view, and keep your hands off until a step asks for them.", true)
    await real.command("session.host", null)
    const session = () => real.slice<SessionSlice>("session")
    const code = await until(() => session()?.code ?? undefined, 30_000)
    const secondApp = await app(second)
    await join(second, code, "Second pilot")
    await until(() => (session()?.members.length === 2 ? true : undefined), 30_000)
    await load(second, { cfg: `SimObjects\\Airplanes\\${aircraftPath.replaceAll("/", "\\")}\\aircraft.cfg`, path: aircraftPath }, { title: "Baron 58P", livery: "bench" })
    await until(() => (secondApp.slice<SessionSlice>("session")?.ready?.length === 0 ? true : undefined), 30_000)
    await secondApp.ok("session.ready", { on: true })
    await until(() => (session()?.ready?.length === 0 ? true : undefined), 75_000)
    await real.command("session.ready", { on: true })
    await until(() => (session()?.preflight.phase === "ended" ? true : undefined), 30_000)
    await cases({ real, second, say, result, guide })
  } finally {
    await end()
  }
  console.log(`The report is in ${path.relative(ROOT, report)}.`)
  process.exit(0)
}

async function cases(c: Session): Promise<void> {
  const { second, say, result } = c
  // At the stand, where the camera reads true: the pilot's eye and their click, which the rest is judged against.
  say("\n=== At the stand")
  const seated = await pilotFigure(c, (f) => f.body.body === "seated", 30_000)
  const eye = seated.body.body === "seated" ? (seated.body.eye as V3) : undefined
  if (!eye) throw new Failed("the pilot's figure never sat on the second pilot's machine")
  say(`the pilot's eye, as the second pilot's core is fed it: ${fmt(eye)}`)
  const target = await click(c, "Pick a small knob or button you can click on its center without changing anything that matters, such as a panel light knob. Click its center once now, and the same spot each time I ask.")
  if (!target) throw new Failed("no hand came from the click at the stand, so there's nothing to judge the rest against")
  say(`the click at the stand put the hand at ${fmt(target)}`)
  await moduleTimes(c, "Lead, Figure, and Camera, on the stand")

  // On foot, `Camera` reports only when the sim gives both referentials. A main wheel, since
  // aircraft-model leaves the 58P's nose gear stowed, as its file stores it
  // (record/areas/avatars/log.md, "2026-11-17: With the camera read in our module, a pilot
  // following in flight keeps their seat and their click lands on the switch").
  say("\n=== On foot")
  await step(c, "Get out of the aircraft on foot and walk up to the left main wheel, under the left wing. Press Page Up when you're there.", 5 * 60_000)
  const footHand = await click(c, "Click the left main wheel's tire once now.")
  const foot = await lastFigure(c)
  result(foot?.body.body === "on-foot" && footHand !== undefined, `on foot, the pilot's figure stands on the ground and a click brings a hand: ${JSON.stringify(foot?.body.body)}, ${footHand ? fmt(footHand) : "no hand"}`)
  await step(c, "Go back to the left seat in the cockpit view. Press Page Up when you're seated.", 5 * 60_000)

  // Following: the second pilot takes control, and its stand-in climbs 3,000 ft and flies straight.
  say("\n=== Following in flight")
  await takeControl(c, "second")
  second.act({ act: "set", numbers: STILL, texts: [] })
  say("The second pilot has control. Your aircraft climbs straight up 3,000 feet, then flies level. Keep your hands off.", true)
  await sleep(3_000)
  second.act({ act: "set", numbers: [["A:VELOCITY BODY Y", 300]], texts: [] })
  await sleep(10_000)
  second.act({ act: "set", numbers: [["A:VELOCITY BODY Y", 0]], texts: [] })
  for (const speed of [85, 130]) {
    second.act({ act: "set", numbers: [["A:VELOCITY BODY Z", speed / 0.3048]], texts: [] })
    await sleep(6_000)
    await seatHeld(c, eye, `following at ${speed} m/s`)
    const hand = await click(c, `Click your knob's center once now, at ${speed} meters a second.`)
    judge(c, target, hand, `following at ${speed} m/s`)
  }
  await moduleTimes(c, "Follow, Figure, and Camera, in flight")

  say("\n=== Active pause, and ChasePlane off")
  await step(c, "Turn active pause on. Press Page Up when it's on.", 2 * 60_000)
  judge(c, target, await click(c, "Click your knob's center once now, in active pause."), "in active pause")
  await step(c, "Turn active pause off. Press Page Up when it's off.", 2 * 60_000)
  await step(c, "If ChasePlane runs, turn it off in its own settings, bring your knob into view, then keep your head and the mouse still. Press Page Up when that's done, or Page Down if ChasePlane isn't running.", 3 * 60_000)
  judge(c, target, await click(c, "Click your knob's center once now, with your head still."), "with ChasePlane off and the head still")

  // Flying: the pilot takes control in flight, and our module reads the camera as the sim flies the aircraft.
  say("\n=== Flying")
  say("You take control in flight. Engage the autopilot with heading and altitude hold, and keep about 160 knots.", true)
  await takeControl(c, "real")
  await step(c, "Press Page Up once the autopilot holds heading and altitude.", 3 * 60_000)
  await seatHeld(c, eye, "flying")
  judge(c, target, await click(c, "Click your knob's center once now, while you fly."), "flying")
  await moduleTimes(c, "Lead, Figure, and Camera, in flight")
  say("That's every case. The script stops the cores now, so fly on as you like, or quit.", true)
}

/** The pilot's figure as the second pilot's core was last fed it, its crew's first figure after its own. */
async function lastFigure(c: Session): Promise<FedFigure | undefined> {
  await sleep(500)
  return other(c.second.fed().at(-1))
}

function other(fed: Fed | undefined): FedFigure | undefined {
  return fed?.figures[1]
}

/** Waits until the second pilot's core is fed the pilot's figure as `ok` looks for. */
async function pilotFigure(c: Session, ok: (f: FedFigure) => boolean, ms: number): Promise<FedFigure> {
  const fed = await c.second.untilFed((f) => {
    const figure = other(f)
    return figure !== undefined && ok(figure)
  }, "the pilot's figure", { ms })
  return other(fed)!
}

/** Asks for one click, and returns where its hand landed on the second pilot's machine, or nothing if no hand came in 10s. */
async function click(c: Session, what: string): Promise<V3 | undefined> {
  const from = c.second.fed().length
  const before = c.guide.clicks()
  c.say(what, true)
  await until(() => (c.guide.clicks() > before ? true : undefined), 3 * 60_000).catch(() => {})
  const fed = await c.second
    .untilFed((f) => other(f)?.hands.some((h) => h.hand === "point") ?? false, "a hand from the click", { after: from, ms: 10_000 })
    .catch(() => undefined)
  const hand = other(fed)?.hands.find((h) => h.hand === "point")
  return hand && hand.hand === "point" ? (hand.point as V3) : undefined
}

function judge(c: Session, target: V3, hand: V3 | undefined, what: string): void {
  if (!hand) return c.result(false, `${what}, a click brought no hand`)
  const off = distance(hand, target)
  c.result(off <= CLICK_WITHIN, `${what}, the click's hand landed ${(off * 100).toFixed(1)}cm from the stand's, at ${fmt(hand)}`)
}

/** Checks the pilot is seated on the second pilot's machine, their eye within `EYE_WITHIN` of the stand's, over 3s. */
async function seatHeld(c: Session, eye: V3, what: string): Promise<void> {
  const from = Math.max(0, c.second.fed().length - 1)
  await sleep(3_000)
  const figures = c.second.fed().slice(from).map(other).filter((f) => f !== undefined)
  const eyes = figures.map((f) => (f.body.body === "seated" ? distance(f.body.eye as V3, eye) : Infinity))
  const most = Math.max(...eyes, 0)
  c.result(figures.length > 0 && most <= EYE_WITHIN, `${what}, the pilot keeps their seat, their eye at most ${Number.isFinite(most) ? `${(most * 100).toFixed(1)}cm` : "out of the seat"} from the stand's, over ${figures.length} feeds`)
}

/** Passes control to the bench core or back to the real one, and waits until the real core says so. */
async function takeControl(c: Session, to: "real" | "second", ms = 20_000): Promise<void> {
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

/** Our module's update, as the timer in update-timer.patch reports it over its last window of 300 frames, when the module was built with it. */
async function moduleTimes(c: Session, what: string): Promise<void> {
  await sleep(6_000)
  const read = (name: string) => evaluateInPanel<number>(`SimVar.GetSimVarValue("L:DUALINPUT_P29_UPDATE_${name}", "number")`).catch(() => 0)
  const [p50, p99, max, window] = await Promise.all(["P50", "P99", "MAX", "WINDOW"].map(read))
  if (!window) return c.say(`our module's update with ${what}: not timed, since the module has no timer`)
  // The timer's variables are in ns.
  c.say(`our module's update with ${what}: ${(p50! / 1e3).toFixed(0)}µs at p50, ${(p99! / 1e3).toFixed(0)}µs at p99, ${(max! / 1e3).toFixed(0)}µs at most, over its last 300 frames`)
}

/** Runs `expression` in the first cockpit panel that answers, found again on each try, since a panel that reloads comes back as another page. */
async function evaluateInPanel<T>(expression: string): Promise<T> {
  let last: Error = new Failed("no cockpit panel answers on the inspector")
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

/** Says a step aloud, and waits until the pilot presses Page Up to say it's done, Page Down to skip it, or `ms`. */
async function step(c: Session, what: string, ms: number): Promise<void> {
  c.say(what, true)
  c.guide.skipped()
  c.guide.declined()
  for (const started = Date.now(); Date.now() - started < ms; await sleep(100)) {
    if (c.guide.skipped() || c.guide.declined()) return
  }
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

function distance(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function fmt(v: V3): string {
  return `[${v.map((x) => x.toFixed(3)).join(", ")}]`
}
