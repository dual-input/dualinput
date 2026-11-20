// Flight-model sync's cases in the sim, for one session with someone at the sim, in the Black
// Square Baron 58P (record/areas/build/plan.md, "16 Flight-model sync";
// record/areas/flight-model/01-flight-model-sync.md, "Cases for the bench"): the real core
// flies and a bench core on a stand-in follows it, then the bench core takes control and the
// 58P follows its stand-in aircraft, which flies on by its velocities. The script reads the
// 58P frame by frame from a cockpit panel through the sim's inspector, lays its path over the
// stand-in's, and writes report.txt in the run's folder.
//
//   node tools/build.ts install                        with the sim closed
//   node tools/bench.ts flight-model                   once, so target/bench holds this tree
//   node tools/sim/flight-model.ts --core <program>    the release core, built from this tree
//
// To time our module's update, apply experiments/areas/avatars/p29-sim-session/update-timer.patch
// before the install: the script reads the timer's variables when the module has them.
//
// Then start the sim and wait at the main menu; the script says each step aloud. Keys:
//   Page Up     answers yes to a question the script asks aloud, or says a step is done
//   Page Down   answers no
//   q           stops the core, replays its recording, and ends

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import type { SessionSlice } from "../../src/engines/messages/ts/session/SessionSlice.ts"
import type { SimSlice } from "../../src/engines/messages/ts/sim/SimSlice.ts"
import { BenchRun, type Core } from "../bench/cores.ts"
import { load } from "../bench/flights.ts"
import { StandInHelper } from "../bench/helper.ts"
import { app, BenchNetwork, join } from "../bench/network.ts"
import type { FakeApp } from "../bench/pages.ts"
import { userCfgs } from "../lib/install.ts"
import { ROOT } from "../lib/repo.ts"
import { Failed, main } from "../lib/run.ts"
import { desktop, type Desktop } from "./desktop.ts"
import { Guide } from "./guide.ts"
import { evaluate, listPages } from "./inspector.ts"

const OUT = path.join(ROOT, "target", "bench", "release-with-checks")
const BARON = /baronpro/i

/** How far behind the samples a following aircraft is drawn, in seconds. */
const DELAY = 0.4

/**
 * The copilot's eye in the 58P's profile, in meters left, up, and forward of the aircraft's
 * datum: its hip, `[-0.282, 0.212, -0.09]`, and its eye 0.643m above and 0.054m behind it. The
 * second pilot's camera sits there, so its figure takes that seat in the sim. `COPILOT_EYE` in
 * tools/sim/camera.ts is the same eye, so change both together.
 */
const COPILOT_EYE: [number, number, number] = [-0.282, 0.855, -0.144]

/** What the script reads of the 58P each frame of a cockpit panel, as `[name, unit]`, in this order. */
const READ: [string, string][] = [
  ["A:PLANE LATITUDE", "degrees"],
  ["A:PLANE LONGITUDE", "degrees"],
  ["A:PLANE ALTITUDE", "feet"],
  ["A:PLANE HEADING DEGREES TRUE", "degrees"],
  ["A:IS LATITUDE LONGITUDE FREEZE ON", "bool"],
  ["A:VELOCITY BODY X", "feet per second"],
  ["A:VELOCITY BODY Y", "feet per second"],
  ["A:VELOCITY BODY Z", "feet per second"],
  ["A:ROTATION VELOCITY BODY X", "radians per second"],
  ["A:ROTATION VELOCITY BODY Y", "radians per second"],
  ["A:ROTATION VELOCITY BODY Z", "radians per second"],
  ["A:AUTOPILOT MASTER", "bool"],
  ["A:PLANE PITCH DEGREES", "degrees"],
  ["A:PLANE BANK DEGREES", "degrees"],
]

/** What the stand-in sends of its aircraft after each of its frames, in this order. */
const TRACKED = ["A:PLANE LATITUDE", "A:PLANE LONGITUDE", "A:PLANE ALTITUDE", "A:PLANE HEADING DEGREES TRUE", "A:VELOCITY BODY X", "A:VELOCITY BODY Y", "A:VELOCITY BODY Z", "A:ROTATION VELOCITY BODY X", "A:ROTATION VELOCITY BODY Y", "A:ROTATION VELOCITY BODY Z", "A:PLANE PITCH DEGREES", "A:PLANE BANK DEGREES"]

/** The stand-in's velocities at 0, which stops its aircraft where it is. */
const STILL: [string, number][] = ["A:VELOCITY BODY X", "A:VELOCITY BODY Y", "A:VELOCITY BODY Z", "A:ROTATION VELOCITY BODY X", "A:ROTATION VELOCITY BODY Y", "A:ROTATION VELOCITY BODY Z"].map((name) => [name, 0])

/** One frame of an aircraft: when, in seconds of the PC's time, its place in degrees and feet, and the rest of what was read. */
type Point = { t: number; lat: number; lon: number; alt: number; heading: number; rest: number[] }

type Session = { real: Desktop; second: Core; secondApp: FakeApp; say: (line: string, aloud?: boolean) => void; result: (ok: boolean, line: string) => void; guide: Guide; data: string }

main(() => {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== "--core") throw new Failed("usage: node tools/sim/flight-model.ts --core <program>")
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
  const folder = path.join(ROOT, "target", "sim", "runs", `${started}-flight-model`)
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
  const benchRun = new BenchRun("sim-flight-model")
  const stub = spawn("ping", ["-n", "86400", "127.0.0.1"], { stdio: "ignore" })
  // The second pilot's figure sits in the copilot's seat with its hands on the real 58P's model, which
  // its core reads from the sim's own packages folder, and its mouse is a stand-in core helper's.
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
  await until(() => (fs.existsSync(path.join(data, "port.json")) ? true : undefined), 30_000)
  watchKeys(say, child, program, data, () => {
    second.kill().catch(() => {})
    stub.kill()
    helper.close()
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
  say("The session is starting. Keep your hands off the controls until a step asks for them.", true)
  say(`the sim is flying ${aircraftPath}; hosting the session`)
  await real.command("session.host", null)
  const session = () => real.slice<SessionSlice>("session")
  const code = await until(() => session()?.code ?? undefined, 30_000)
  const secondApp = await app(second)
  await join(second, code, "Second pilot")
  await until(() => (session()?.members.length === 2 ? true : undefined), 30_000)
  const cfg = `SimObjects\\Airplanes\\${aircraftPath.replaceAll("/", "\\")}\\aircraft.cfg`
  await load(second, { cfg, path: aircraftPath }, { title: "Baron 58P", livery: "bench" })
  const c: Session = { real, second, secondApp, say, result, guide, data }

  // A case that throws, such as a panel that reloads under the inspector, fails its own part and leaves the next to run.
  for (const part of [onTheGround, inTheAir, secondLoad]) {
    await part(c).catch((error: Error) => result(false, `${part.name} stopped: ${error.message}`))
  }
  say("That's every case. Whoever runs the script stops it with q in its terminal, which replays the core's recording.", true)
}

/** The cases at the stand: the stand-in follows the 58P, then the 58P follows the stand-in, moved by writes alone. */
async function onTheGround(c: Session): Promise<void> {
  const { real, second, secondApp, say, result } = c
  const session = () => real.slice<SessionSlice>("session")
  say("\n=== On the ground")
  // The link's first clock offset takes up to 2s, then the stand-in is written at the 58P's stand.
  await sleep(5_000)
  const here = await readPose()
  const there = await standIn(second)
  const apart = meters(here, there)
  result(apart < 2, `the bench core's aircraft follows the 58P: the stand-in stands ${apart.toFixed(2)}m from it`)

  const writes = await second.followWrites()
  await sleep(10_000)
  const fed = (await second.followWrites()) - writes
  result(fed > 225 && fed < 275, `Lead reports about 20 times a second at the sim's frame rate: the second pilot's core wrote Follow's slot ${fed} times in 10s, 250 with its rewrites`)
  await moduleTimes(c, "Lead, with the 58P flying")

  // Both Ready, through preflight's end, after which either may take control.
  await until(() => (secondApp.slice<SessionSlice>("session")?.ready?.length === 0 ? true : undefined), 30_000)
  await secondApp.ok("session.ready", { on: true })
  say("waiting up to 75s for your aircraft to settle")
  await until(() => (session()?.ready?.length === 0 ? true : undefined), 75_000)
  await real.command("session.ready", { on: true })
  await until(() => (session()?.preflight.phase === "ended" ? true : undefined), 15_000)

  // State sync's case of a write through a `_Set` preset with a value, the parking brake's. The second
  // pilot's core takes a catch-up from the flying machine as preflight ends, and a change made on its
  // aircraft before that ends is the catch-up's to overwrite, so the case waits for its end.
  await until(() => (/this machine's catch-up ended/.test(second.log()) ? true : undefined), 45_000)
  await sleep(1_000)
  const brake = (await readSim("A:BRAKE PARKING POSITION", "bool")) === 1 ? 0 : 1
  second.act({ act: "set", numbers: [["A:BRAKE PARKING POSITION", brake]], texts: [] })
  await settles(c, `a _Set preset with a value, LANDING_GEAR_ParkingBrake_Set ${brake}, moves the sim's parking brake`, () => readSim("A:BRAKE PARKING POSITION", "bool"), (v) => v === brake)
  second.act({ act: "set", numbers: [["A:BRAKE PARKING POSITION", 1 - brake]], texts: [] })
  await settles(c, "and back", () => readSim("A:BRAKE PARKING POSITION", "bool"), (v) => v === 1 - brake)

  await overlay(c)

  say("The second pilot takes control. Your aircraft will rise 5 feet and slide forward for 10 seconds, then come back.", true)
  await takeControl(c, "second")
  // The stand-in flies on from the velocities Follow last wrote, which a parked aircraft's noise makes a slow drift.
  second.act({ act: "set", numbers: STILL, texts: [] })
  await settles(c, "Follow froze the 58P through fsEventsTriggerKeyEvent", async () => (await freezes()).filter(Boolean).length, (n) => n === 3)
  await sleep(4_000)

  // The stand-in rises 5 ft and rolls forward at 10 ft/s: the 58P follows through fsVarsAVarSet alone.
  const start = await standIn(second)
  const from = second.lineCount()
  await record(8)
  second.act({ act: "set", numbers: [["A:PLANE ALTITUDE", start.alt + 5], ["A:VELOCITY BODY Z", 10]], texts: [] })
  await sleep(8_500)
  second.act({ act: "set", numbers: [["A:VELOCITY BODY Z", 0]], texts: [] })
  const moved = await recorded()
  const lead = track(second, from)
  const off = behind(lead, moved)
  const went = meters(moved[0]!, moved.at(-1)!)
  result(went > 15 && percentile(off, 0.99) < 1.5, `fsVarsAVarSet holds the pilot's own aircraft's pose: the 58P moved ${went.toFixed(1)}m and rose ${(moved.at(-1)!.alt - moved[0]!.alt).toFixed(1)}ft with the stand-in, ${percentile(off, 0.5).toFixed(2)}m from its path 400ms before at the median, ${percentile(off, 0.99).toFixed(2)}m at p99, ${Math.max(...off).toFixed(2)}m at most, over ${off.length} frames`)

  // The five axis events, from the pilot flying's surfaces and brakes.
  const before = await controls()
  second.act({ act: "set", numbers: [["A:AILERON POSITION", -8_000], ["A:ELEVATOR POSITION", 6_000], ["A:RUDDER POSITION", -5_000], ["A:BRAKE LEFT POSITION", 24_000], ["A:BRAKE RIGHT POSITION", 8_000]], texts: [] })
  await sleep(2_000)
  const after = await controls()
  say(`the 58P's controls before the stand-in moved its own: ${JSON.stringify(before)}`)
  say(`and after: ${JSON.stringify(after)}`)
  result(Math.abs(after.aileron + 8_000) < 400 && Math.abs(after.elevator - 6_000) < 400 && Math.abs(after.rudder + 5_000) < 400, `the three axis events moved the 58P's surfaces to the PF's: aileron ${after.aileron.toFixed(0)}, elevator ${after.elevator.toFixed(0)}, rudder ${after.rudder.toFixed(0)}, against -8000, 6000, -5000`)
  result(Math.abs(after.brakeLeft - 24_000) < 1_500 && Math.abs(after.brakeRight - 8_000) < 1_500, `each brake reads what the PF's does: left ${after.brakeLeft.toFixed(0)}, right ${after.brakeRight.toFixed(0)}, against 24000 and 8000`)
  result(Math.abs(after.yokeX - before.yokeX) > 1 && Math.abs(after.yokeY - before.yokeY) > 1, `the yoke's variables moved with the events: YOKE X POSITION WITH AP LINEAR ${before.yokeX.toFixed(1)} to ${after.yokeX.toFixed(1)}, YOKE Y POSITION WITH AP ${before.yokeY.toFixed(1)} to ${after.yokeY.toFixed(1)}`)
  // The controls stay where the events put them while the question waits, and the readings above answer for the pedals and the brakes.
  await answer(c, "Look at the yoke. Is it held turned to one side?", "the pilot saw the yoke held over by the events")
  second.act({ act: "set", numbers: [["A:AILERON POSITION", 0], ["A:ELEVATOR POSITION", 0], ["A:RUDDER POSITION", 0], ["A:BRAKE LEFT POSITION", 0], ["A:BRAKE RIGHT POSITION", 0], ["A:PLANE ALTITUDE", start.alt]], texts: [] })
  await moduleTimes(c, "Follow, with the 58P following")

  // The stand-in goes back to the stand, so the 58P is let go where it loaded.
  second.act({ act: "set", numbers: [["A:PLANE LATITUDE", start.lat], ["A:PLANE LONGITUDE", start.lon]], texts: [] })
  await sleep(2_000)
  await takeControl(c, "real")
  await settles(c, "the 58P unfroze as its pilot took control", async () => (await freezes()).filter(Boolean).length, (n) => n === 0)
}

/** The cases in flight: the 58P follows the stand-in straight and through a turn, with the autopilot on, at a simulation rate of 2, and 50km away. */
async function inTheAir(c: Session): Promise<void> {
  const { second, say, result } = c
  say("\n=== In the air")
  await step(c, "Take off, climb to about 3000 feet, and engage the autopilot with heading and altitude hold.", 30 * 60_000)
  await answer(c, "Look at the second pilot's figure in the right seat. Is it steady, with no part jittering?", "on the flying machine, no part of the figure skips a frame in flight")
  await moduleTimes(c, "Lead and Figure, in flight")

  say("The second pilot takes control for about a minute. Keep your hands off the controls.", true)
  const autopilot = await readSim("A:AUTOPILOT MASTER", "bool")
  await record(10)
  await sleep(2_000)
  await takeControl(c, "second")
  // The stand-in flies on at the speed and attitude Follow last wrote, and straight, with no rotation.
  second.act({ act: "set", numbers: STILL.filter(([name]) => name.includes("ROTATION")), texts: [] })
  await sleep(8_500)
  const handed = await recorded()
  const paces = speeds(handed)
  const frozenAt = handed.findIndex((p) => p.rest[0] === 1)
  say(`through the handover the 58P's speed over the ground, frame by frame: ${paces[0]!.toFixed(1)} m/s before it, ${Math.min(...paces).toFixed(1)} m/s at the least and ${Math.max(...paces).toFixed(1)} m/s at the most after, and ${paces.at(-1)!.toFixed(1)} m/s at the end; the largest change between two frames was ${Math.max(...paces.slice(1).map((v, i) => Math.abs(v - paces[i]!))).toFixed(1)} m/s; Follow froze it ${frozenAt < 0 ? "in no frame recorded" : `${((handed[frozenAt]!.t - handed[0]!.t) * 1000).toFixed(0)}ms into the recording`}`)
  await answer(c, "Was the handover smooth, with no jump or lurch?", "the pilot saw a smooth handover in flight")
  let from = second.lineCount()
  await record(15)
  await sleep(15_500)
  let flown = await recorded()
  let lead = track(second, from)
  let off = behind(lead, flown)
  result(percentile(off, 0.99) < 3, `the 58P follows the stand-in in straight flight: ${percentile(off, 0.5).toFixed(2)}m from its path 400ms before at the median, ${percentile(off, 0.99).toFixed(2)}m at p99, ${Math.max(...off).toFixed(2)}m at most, over ${off.length} frames`)
  const spikes = velocitySpikes(lead, flown)
  say(`the 58P's velocities against the ones written, frame by frame: body ${spikes.body.map((v) => v.toFixed(2)).join(", ")} ft/s at most on x, y, and z, and rotation ${spikes.rotation.map((v) => v.toFixed(3)).join(", ")} rad/s, where p02's writes from outside the frame read up to 7.6 ft/s and 2.3 rad/s`)
  await answer(c, "Did the aircraft fly smoothly, with no jumps or shaking?", "the pilot saw the following aircraft fly smoothly")
  await answer(c, "Is the second pilot's figure in the right seat still steady?", "on the following machine, no part of the figure skips a frame in flight")

  // A standard-rate turn, banked 25° and pitched up 3°, with the yoke held over. The stand-in flies
  // by its velocities alone, so the script gives it the attitude an aircraft would take, over 2s each way.
  say("The aircraft banks and turns right for 20 seconds, with its yoke moving.", true)
  const level = await standIn(second)
  const [pitch0, bank0] = [level.rest[6]!, level.rest[7]!]
  from = second.lineCount()
  await record(26)
  second.act({ act: "set", numbers: [["A:AILERON POSITION", 5_000]], texts: [] })
  await ramp(second, [["A:PLANE BANK DEGREES", bank0, -25], ["A:PLANE PITCH DEGREES", pitch0, pitch0 - 3]], 2_000)
  second.act({ act: "set", numbers: [["A:ROTATION VELOCITY BODY Y", (3 * Math.PI) / 180]], texts: [] })
  await sleep(20_000)
  second.act({ act: "set", numbers: [["A:ROTATION VELOCITY BODY Y", 0], ["A:AILERON POSITION", 0]], texts: [] })
  await ramp(second, [["A:PLANE BANK DEGREES", -25, bank0], ["A:PLANE PITCH DEGREES", pitch0 - 3, pitch0]], 2_000)
  await sleep(2_500)
  flown = await recorded()
  lead = track(second, from)
  off = behind(lead, flown)
  const turned = ((flown.at(-1)!.heading - flown[0]!.heading + 540) % 360) - 180
  result(Math.abs(turned - 60) < 8 && percentile(off, 0.99) < 5, `the 58P follows the stand-in through a turn: it turned ${turned.toFixed(1)}°, ${percentile(off, 0.99).toFixed(2)}m from the path at p99, ${Math.max(...off).toFixed(2)}m at most`)
  // The 58P's rest ends with its pitch and bank, and the stand-in's does too.
  const attitude = flown.flatMap((f) => {
    const was = placeAt(lead, f.t - DELAY)
    return was ? [[Math.abs(f.rest[8]! - was.rest[6]!), Math.abs(f.rest[9]! - was.rest[7]!)] as const] : []
  })
  const [mostBank, leastBank] = [Math.max(...flown.map((f) => f.rest[9]!)), Math.min(...flown.map((f) => f.rest[9]!))]
  const [pitchOff, bankOff] = [Math.max(...attitude.map((a) => a[0])), Math.max(...attitude.map((a) => a[1]))]
  result(leastBank < bank0 - 20 && pitchOff < 1.5 && bankOff < 3, `the 58P banks and pitches with the stand-in: its bank went from ${mostBank.toFixed(1)}° to ${leastBank.toFixed(1)}°, where the sim's bank is negative to the right, and frame by frame its pitch read ${pitchOff.toFixed(2)}° at most from the stand-in's 400ms before and its bank ${bankOff.toFixed(2)}°`)
  await answer(c, "Did the aircraft bank into the turn and roll out of it smoothly?", "the pilot saw the following aircraft bank into the turn and out of it")
  const still = await readSim("A:AUTOPILOT MASTER", "bool")
  // At the handover this machine catches up from the stand-in, whose cockpit has no autopilot engaged, so this reads no case: a flight with a second 58P does.
  say(`the 58P's autopilot master read ${autopilot} before the handover and ${still} after the turn; the catch-up from the stand-in's cockpit sets it too, so this run can't tell whether the axis events leave it engaged`)
  await moduleTimes(c, "Follow and Figure, in flight")

  // A joiner moved 50km: the stand-in jumps half a degree of latitude, and the 58P is written there.
  say("The aircraft jumps 50 kilometers north. Watch whether the sim stalls.", true)
  const at = await standIn(second)
  await record(10)
  second.act({ act: "set", numbers: [["A:PLANE LATITUDE", at.lat + 0.45]], texts: [] })
  await sleep(10_500)
  const jumped = await recorded()
  const gaps = jumped.slice(1).map((p, i) => p.t - jumped[i]!.t)
  const far = meters(jumped[0]!, jumped.at(-1)!)
  say(`the 58P went ${(far / 1000).toFixed(1)}km, and the longest gap between two of the panel's frames was ${(Math.max(...gaps) * 1000).toFixed(0)}ms`)
  await answer(c, "Did the sim keep running through the jump, with no long freeze?", "the sim loads the scenery 50km on without stalling")

  // A handover at a simulation rate of 2: the 58P takes control back, flies at twice the rate, and gives it up again.
  say("You take control back for a few seconds, the sim runs at twice its rate, and the second pilot takes control again. Hold the aircraft level while it's yours.", true)
  await takeControl(c, "real")
  await sleep(3_000)
  await evaluateInPanel(`SimVar.SetSimVarValue("K:SIM_RATE_INCR", "number", 1); 0`)
  const doubled = await settles(c, "the simulation rate is 2", () => readSim("E:SIMULATION RATE", "number"), (v) => v === 2)
  if (doubled === null) {
    await takeControl(c, "real")
    return
  }
  try {
    await sleep(3_000)
    await record(6)
    await sleep(2_000)
    await takeControl(c, "second")
    await sleep(4_500)
    const handed = await recorded()
    const frozen = handed.findIndex((p) => p.rest[0] === 1)
    if (frozen <= 0) {
      result(false, "at a simulation rate of 2 the ex-PF's aircraft carries on at the speed it flew: Follow froze the 58P in no frame of the 6s recorded")
    } else {
      const pace = (points: Point[]) => (points.length < 2 ? 0 : meters(points[0]!, points.at(-1)!) / (points.at(-1)!.t - points[0]!.t))
      const [flew, carried] = [pace(handed.slice(0, frozen)), pace(handed.filter((p, i) => i >= frozen && p.t < handed[frozen]!.t + DELAY))]
      result(Math.abs(carried / flew - 1) < 0.15, `at a simulation rate of 2 the ex-PF's aircraft carries on at the speed it flew: ${flew.toFixed(1)} m/s before the handover, ${carried.toFixed(1)} m/s in Follow's first 400ms`)
    }
  } finally {
    // Whatever the case did, the pilot gets the aircraft back at the sim's own rate.
    await takeControl(c, "real").catch(() => {})
    await evaluateInPanel(`SimVar.SetSimVarValue("K:SIM_RATE_DECR", "number", 1); 0`).catch(() => {})
  }
}

/** The sim seam's case: through a second flight load in one run of the sim, Follow starts new at its first feed (record/areas/core/03-sim-seam-and-wasm-module.md, "Cases for the bench"). */
async function secondLoad(c: Session): Promise<void> {
  const { real, second, say, result } = c
  say("\n=== A second flight load")
  await takeControl(c, "second")
  // The stand-in has no ground, so it flies on level from here, whatever the 58P was doing.
  second.act({ act: "set", numbers: [...STILL.filter(([name]) => !name.endsWith("BODY Z")), ["A:PLANE PITCH DEGREES", 0], ["A:PLANE BANK DEGREES", 0]], texts: [] })
  const flying = () => real.slice<SimSlice>("sim")?.stage === "flying"
  say("Restart the flight from the pause menu, and press Ready to fly when it has loaded.", true)
  await until(() => (flying() ? undefined : true), 10 * 60_000)
  await until(() => (flying() ? true : undefined), 20 * 60_000)
  await sleep(10_000)
  const frozen = await settles(c, "after the second load, Follow froze the 58P again", async () => (await freezes()).filter(Boolean).length, (n) => n === 3, 30_000)
  if (frozen !== null) {
    await sleep(5_000)
    const apart = meters(await readPose(), await standIn(second))
    result(apart < 200, `and wrote it at the stand-in's place: ${apart.toFixed(1)}m from it`)
  }
  // A pilot back in the flight catches up with the flying machine first, for 30s in one session, and the core refuses a press to take control until that ends.
  await takeControl(c, "real", 90_000)
}

/**
 * Avatars' check of which window lies under the cursor while an overlay such as Steam's is open over
 * the sim. If it's the sim's own, a core helper that checked the window under the cursor would still
 * pass a click made through the overlay, and if it's the overlay's, it would swallow every one
 * (record/areas/avatars/01-avatars.md, "Known limits").
 */
async function overlay(c: Session): Promise<void> {
  const script = `
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class DualInputUnder {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
}
"@
function Named($h) {
  $root = [DualInputUnder]::GetAncestor($h, 2)
  $procId = 0
  [void][DualInputUnder]::GetWindowThreadProcessId($root, [ref]$procId)
  $class = New-Object System.Text.StringBuilder 256
  [void][DualInputUnder]::GetClassName($root, $class, 256)
  $name = try { (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { "?" }
  "$name/$class"
}
while ($true) {
  $p = New-Object DualInputUnder+POINT
  [void][DualInputUnder]::GetCursorPos([ref]$p)
  [Console]::Out.WriteLine("under=" + (Named ([DualInputUnder]::WindowFromPoint($p))) + " front=" + (Named ([DualInputUnder]::GetForegroundWindow())))
  Start-Sleep -Milliseconds 200
}`
  const probe = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { stdio: ["ignore", "pipe", "ignore"] })
  const seen = new Map<string, number>()
  probe.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
    for (const line of chunk.split(/\r?\n/).filter(Boolean)) seen.set(line, (seen.get(line) ?? 0) + 1)
  })
  await step(c, "Open Steam's overlay with Shift and Tab, move the mouse over the cockpit and click a few times, then close the overlay.", 3 * 60_000)
  probe.kill()
  c.say("the window under the cursor and the one in front, 5 times a second, as process/class and how often:")
  for (const [line, count] of [...seen].sort((a, b) => b[1] - a[1])) c.say(`  ${count} × ${line}`)
  const others = [...seen.keys()].filter((line) => !/^under=FlightSimulator2024\//i.test(line))
  c.result(others.length === 0, others.length === 0 ? "with Steam's overlay open, the window under the cursor stayed the sim's, so a check of it would swallow no click" : "another window came under the cursor, so a check of the window under it would swallow clicks there")
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

/** Our module's update, as the timer in update-timer.patch reports it over its last window of 300 frames, when the module was built with it. */
async function moduleTimes(c: Session, what: string): Promise<void> {
  await sleep(6_000)
  const [p50, p99, max, window] = await Promise.all(["P50", "P99", "MAX", "WINDOW"].map((n) => readSim(`L:DUALINPUT_P29_UPDATE_${n}`)))
  if (!window) return
  // The timer's variables are in ns.
  c.say(`our module's update with ${what}: ${(p50! / 1e3).toFixed(0)}µs at p50, ${(p99! / 1e3).toFixed(0)}µs at p99, ${(max! / 1e3).toFixed(0)}µs at most, over its last 300 frames, against 100µs`)
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

async function freezes(): Promise<boolean[]> {
  const names = ["IS LATITUDE LONGITUDE FREEZE ON", "IS ALTITUDE FREEZE ON", "IS ATTITUDE FREEZE ON"]
  return (await Promise.all(names.map((n) => readSim(n, "bool")))).map((v) => v === 1)
}

async function readPose(): Promise<Point> {
  const [lat, lon, alt, heading] = await Promise.all(READ.slice(0, 4).map(([name, unit]) => readSim(name, unit)))
  return { t: Date.now() / 1e3, lat: lat!, lon: lon!, alt: alt!, heading: heading!, rest: [] }
}

async function controls(): Promise<{ aileron: number; elevator: number; rudder: number; brakeLeft: number; brakeRight: number; yokeX: number; yokeY: number }> {
  const read = (name: string, unit: string) => readSim(name, unit)
  return {
    aileron: await read("A:AILERON POSITION", "position 16k"),
    elevator: await read("A:ELEVATOR POSITION", "position 16k"),
    rudder: await read("A:RUDDER POSITION", "position 16k"),
    brakeLeft: await read("A:BRAKE LEFT POSITION", "position 32k"),
    brakeRight: await read("A:BRAKE RIGHT POSITION", "position 32k"),
    yokeX: await read("A:YOKE X POSITION WITH AP LINEAR", "percent"),
    yokeY: await read("A:YOKE Y POSITION WITH AP", "percent"),
  }
}

/**
 * Starts reading `READ` in a cockpit panel once each of the panel's frames, for `seconds`, into
 * `DUALINPUT_CHECK_FLIGHT` (record/areas/architecture/02-code-map.md, "Names the sim shares").
 * The panel's clock gives each frame's time, set against the PC's time once, at the start. Runs
 * in Coherent GT, so it's ES2017.
 */
async function record(seconds: number): Promise<void> {
  await evaluateInPanel(`(function () {
    var names = ${JSON.stringify(READ)};
    var out = { started: Date.now(), from: performance.now(), frames: [] };
    window.DUALINPUT_CHECK_FLIGHT = out;
    function frame() {
      var now = performance.now();
      var row = [now];
      for (var i = 0; i < names.length; i++) row.push(Number(SimVar.GetSimVarValue(names[i][0], names[i][1])));
      out.frames.push(row);
      if (now - out.from < ${seconds * 1000} && window.DUALINPUT_CHECK_FLIGHT === out) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return 0;
  })()`)
}

/** What `record` read, once it has ended. */
async function recorded(): Promise<Point[]> {
  const text = await evaluateInPanel<string>("JSON.stringify(window.DUALINPUT_CHECK_FLIGHT || null)")
  const read = JSON.parse(text) as { started: number; from: number; frames: number[][] } | null
  if (!read || read.frames.length < 2) throw new Failed("the cockpit panel recorded no frames")
  return read.frames.map(([now, lat, lon, alt, heading, ...rest]) => ({ t: (read.started + (now! - read.from)) / 1e3, lat: lat!, lon: lon!, alt: alt!, heading: heading!, rest }))
}

/** The stand-in's aircraft, frame by frame, among the core's lines after the first `from`. */
function track(second: Core, from: number): Point[] {
  return second.tracked(from).map(({ at, values }) => {
    const [lat, lon, alt, heading, ...rest] = values
    return { t: at / 1e6, lat: lat!, lon: lon!, alt: alt!, heading: heading!, rest }
  })
}

async function standIn(second: Core): Promise<Point> {
  const before = second.lineCount()
  await until(() => (track(second, before).length > 0 ? true : undefined), 5_000)
  return track(second, before).at(-1)!
}

/** How far apart two places are, in meters. */
function meters(a: Point, b: Point): number {
  const north = (b.lat - a.lat) * 111_195
  const east = (b.lon - a.lon) * 111_195 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot(north, east, (b.alt - a.alt) * 0.3048)
}

/** Where `points` puts its aircraft at `t`, along a straight line between the two frames around it. */
function placeAt(points: Point[], t: number): Point | undefined {
  const i = points.findIndex((p) => p.t >= t)
  if (i <= 0) return undefined
  const [a, b] = [points[i - 1]!, points[i]!]
  const k = (t - a.t) / (b.t - a.t)
  const mix = (x: number, y: number) => x + (y - x) * k
  return { t, lat: mix(a.lat, b.lat), lon: mix(a.lon, b.lon), alt: mix(a.alt, b.alt), heading: b.heading, rest: b.rest }
}

/** How far the follower is from where the leader was `DELAY` earlier, at each of the follower's frames, in meters. */
function behind(leader: Point[], follower: Point[]): number[] {
  return follower.flatMap((f) => {
    const was = placeAt(leader, f.t - DELAY)
    return was ? [meters(f, was)] : []
  })
}

/** The most each of the 58P's body and rotation velocities read from what the stand-in's samples wrote, over the frames. */
function velocitySpikes(leader: Point[], follower: Point[]): { body: number[]; rotation: number[] } {
  const most = [0, 0, 0, 0, 0, 0]
  for (const f of follower) {
    const was = placeAt(leader, f.t - DELAY)
    if (!was) continue
    // The follower's rest starts with the freeze, then the six velocities; the leader's starts with them.
    for (let i = 0; i < 6; i++) most[i] = Math.max(most[i]!, Math.abs(f.rest[i + 1]! - was.rest[i]!))
  }
  return { body: most.slice(0, 3), rotation: most.slice(3) }
}

/** The aircraft's speed over the ground between each two frames of `points`, in m/s. */
function speeds(points: Point[]): number[] {
  return points.slice(1).map((p, i) => meters(points[i]!, p) / Math.max(p.t - points[i]!.t, 1e-6))
}

/** Moves each of the stand-in's variables, as `[name, from, to]`, in 20 even steps over `ms`. */
async function ramp(second: Core, moves: [string, number, number][], ms: number): Promise<void> {
  for (let step = 1; step <= 20; step++) {
    second.act({ act: "set", numbers: moves.map(([name, from, to]) => [name, from + ((to - from) * step) / 20]), texts: [] })
    await sleep(ms / 20)
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? NaN
}

/** Polls `get` until `ok` holds, and says how long it took. */
async function settles(c: Session, what: string, get: () => Promise<number>, ok: (v: number) => boolean, ms = 8_000): Promise<number | null> {
  const started = Date.now()
  let last = NaN
  while (Date.now() - started < ms) {
    try {
      last = await get()
      if (ok(last)) {
        c.result(true, `${what}: ${last}, after ${Date.now() - started}ms`)
        return Date.now() - started
      }
    } catch {
      // A page that's reloading answers nothing for a moment.
    }
    await sleep(25)
  }
  c.result(false, `${what}: never held within ${ms}ms, read ${last}`)
  return null
}

/** Says a step aloud, and waits until the pilot presses Page Up to say it's done, or `ms`. */
async function step(c: Pick<Session, "say" | "guide">, what: string, ms: number): Promise<void> {
  c.say(`${what} Press Page Up when that's done.`, true)
  c.guide.skipped()
  const started = Date.now()
  while (Date.now() - started < ms && !c.guide.skipped()) await sleep(100)
}

/**
 * Asks the pilot a yes-or-no question aloud, and again after 30s without an answer, and writes
 * the answer as `what`'s result: Page Up is yes and Page Down is no. No answer within 90s is
 * written as that, so a question the pilot missed doesn't read as a no.
 */
async function answer(c: Pick<Session, "say" | "guide" | "result">, question: string, what: string): Promise<void> {
  const words = `${question} Press Page Up for yes, or Page Down for no.`
  c.say(words, true)
  c.guide.skipped()
  c.guide.declined()
  const started = Date.now()
  let again = false
  while (Date.now() - started < 90_000) {
    if (c.guide.skipped()) return c.result(true, what)
    if (c.guide.declined()) return c.result(false, `the pilot answered no: ${what}`)
    if (!again && Date.now() - started > 30_000) {
      again = true
      c.guide.say(words)
    }
    await sleep(100)
  }
  c.say(`NOT ANSWERED within 90s: ${what}`)
  c.guide.fail()
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
