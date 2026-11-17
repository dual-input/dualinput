// Stage 14b's cases in the sim, for one session with someone at the sim, in the Black Square
// Baron 58P (record/areas/build/plan.md, "14b State sync's writes that read another value"): the
// real core flies, and a bench core on a stand-in plays the second pilot. The second pilot sets
// the heading bug, an altimeter, and a cabin handle, which the 58P takes through `_Set` presets,
// then takes control and flies at 3,000 ft on the autopilot in heading mode; the 58P follows,
// takes control back, and should fly straight on with its trim at the second pilot's. The script
// reads the 58P through the sim's inspector and writes report.txt in the run's folder.
//
//   node tools/build.ts install                         with the sim closed
//   node tools/bench.ts state-sync                      once, so target/bench holds this tree
//   cargo build --release -p dualinput-core
//   node tools/sim/handover.ts --core target/release/dualinput-core.exe
//
// Then start the sim and load the 58P at a stand with its engines running; the script says each
// step aloud. q in its terminal stops the core, replays its recording, and ends.

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import type { SessionSlice } from "../../src/engines/messages/ts/session/SessionSlice.ts"
import type { SimSlice } from "../../src/engines/messages/ts/sim/SimSlice.ts"
import { BenchRun, type Core } from "../bench/cores.ts"
import { load } from "../bench/flights.ts"
import { app, BenchNetwork, join } from "../bench/network.ts"
import { ROOT } from "../lib/repo.ts"
import { Failed, main } from "../lib/run.ts"
import { desktop, type Desktop } from "./desktop.ts"
import { Guide } from "./guide.ts"
import { evaluate, listPages } from "./inspector.ts"

const OUT = path.join(ROOT, "target", "bench", "release-with-checks")
const BARON = /baronpro/i

/** What the script reads of the 58P each frame of a cockpit panel while it records, as `[name, unit]`, in this order. */
const READ: [string, string][] = [
  ["A:PLANE HEADING DEGREES MAGNETIC", "degrees"],
  ["A:PLANE BANK DEGREES", "degrees"],
  ["A:PLANE ALTITUDE", "feet"],
  ["A:ELEVATOR TRIM PCT", "percent"],
]

/** What the stand-in sends of its aircraft after each of its frames, in this order. */
const TRACKED = ["A:AUTOPILOT HEADING LOCK DIR:1", "A:ELEVATOR TRIM PCT"]

type Session = { real: Desktop; second: Core; data: string; say: (line: string, aloud?: boolean) => void; result: (ok: boolean, line: string) => void }

main(() => {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== "--core") throw new Failed("usage: node tools/sim/handover.ts --core <program>")
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
  const folder = path.join(ROOT, "target", "sim", "runs", `${started}-handover`)
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
  const benchRun = new BenchRun("sim-handover")
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
  await real.command("session.host", null)
  const session = () => real.slice<SessionSlice>("session")
  const code = await until(() => session()?.code ?? undefined, 30_000)
  const secondApp = await app(second)
  await join(second, code, "Second pilot")
  await until(() => (session()?.members.length === 2 ? true : undefined), 30_000)
  const cfg = `SimObjects\\Airplanes\\${aircraftPath.replaceAll("/", "\\")}\\aircraft.cfg`
  await load(second, { cfg, path: aircraftPath }, { title: "Baron 58P", livery: "bench" })
  const c: Session = { real, second, data, say, result }

  await until(() => (secondApp.slice<SessionSlice>("session")?.ready?.length === 0 ? true : undefined), 30_000)
  await secondApp.ok("session.ready", { on: true })
  say("waiting up to 75s for your aircraft to settle")
  await until(() => (session()?.ready?.length === 0 ? true : undefined), 75_000)
  await real.command("session.ready", { on: true })
  await until(() => (session()?.preflight.phase === "ended" ? true : undefined), 15_000)
  await until(() => (/this machine's catch-up ended/.test(second.log()) ? true : undefined), 45_000)
  await sleep(2_000)

  for (const part of [presets, inTheAir]) {
    await part(c).catch((error: Error) => result(false, `${part.name} stopped: ${error.message}`))
  }
  say("That's every case. The aircraft is yours. Whoever runs the script stops it with q in its terminal, which replays the core's recording.", true)
}

/**
 * With the 58P flying, the second pilot sets three controls the 58P takes through `_Set` presets
 * with a value, several values each, and each must land within 2.5s. The heading bug's values
 * include some that aren't whole 1/16,384ths of a turn, which the profile rounds, so the 58P's
 * reading matches its write, and the real core flags none of them.
 */
async function presets(c: Session): Promise<void> {
  c.say("\n=== The presets, with the 58P flying")
  const controls: [string, string, string, number, number[]][] = [
    ["heading bug", "A:AUTOPILOT HEADING LOCK DIR:1", "degrees", 0.05, [45, 100, 253, 90, 315.5, 180]],
    ["altimeter 1", "L:INSTRUMENT_Altimeter_1", "number", 0.5, [1000, 1020, 990, 1013]],
    ["cabin heat handle", "L:var_CabinHeatHandle", "number", 0.01, [0.25, 0.75, 0.5, 1, 0]],
  ]
  for (const [what, variable, unit, within, values] of controls) {
    let landed = 0
    for (const value of values) {
      c.second.act({ act: "set", numbers: [[variable, value]], texts: [] })
      const started = Date.now()
      let read = NaN
      while (Date.now() - started < 2_500) {
        read = await readSim(variable, unit).catch(() => NaN)
        if (Math.abs(unit === "degrees" ? angle(read - value) : read - value) <= within) break
        await sleep(50)
      }
      const ok = Math.abs(unit === "degrees" ? angle(read - value) : read - value) <= within
      if (ok) landed++
      c.say(`${ok ? "landed" : "MISSED"}: ${what} ${value}: the 58P reads ${Number(read.toFixed(4))}${ok ? ` after ${Date.now() - started}ms` : " after 2.5s"}`)
    }
    c.result(landed === values.length, `the 58P's ${what} took ${landed} of ${values.length} values through its _Set preset`)
  }
  await sleep(2_000)
  const flagged = log(c.data)
    .split(/\r?\n/)
    .filter((l) => l.includes("a write never landed"))
  c.say(`the real core's lines for writes that never landed: ${flagged.length === 0 ? "none" : `\n  ${flagged.join("\n  ")}`}`)
  c.result(!flagged.some((l) => l.includes('entry="heading_bug"')), "the heading bug's rounded writes read back as written, so none was flagged")
}

/**
 * The second pilot takes control and flies 3,000 ft above the stand at 150 kt on a heading 90°
 * from the 58P's, with the autopilot in heading and altitude hold and its trim at -5%, and the
 * 58P follows while its own autopilot trims what Follow freezes. Then the 58P takes control.
 */
async function inTheAir(c: Session): Promise<void> {
  const { second, say, result } = c
  say("\n=== In the air")
  const stand = await readSim("A:PLANE HEADING DEGREES MAGNETIC", "degrees")
  const magvar = angle((await readSim("A:PLANE HEADING DEGREES TRUE", "degrees")) - stand)
  const alt = await readSim("A:PLANE ALTITUDE", "feet")
  const mixtures = await Promise.all([1, 2].map((n) => readSim(`L:BKSQ_MixtureLeverPosition_${n}`)))
  const course = norm(Math.round((stand + 90) / 45) * 45)
  const target = Math.round((alt + 3_000) / 100) * 100
  say(`the 58P stands at ${stand.toFixed(1)}° magnetic; the second pilot flies ${course}° magnetic at ${target} ft`)
  say("The second pilot takes control and flies at 3000 feet. Your aircraft will rise and fly on its own.", true)
  await takeControl(c, "second")
  second.act({
    act: "set",
    numbers: [
      ["A:PLANE ALTITUDE", target],
      ["A:PLANE HEADING DEGREES TRUE", norm(course + magvar)],
      ["A:PLANE PITCH DEGREES", 0],
      ["A:PLANE BANK DEGREES", 0],
      ["A:VELOCITY BODY X", 0],
      ["A:VELOCITY BODY Y", 0],
      ["A:VELOCITY BODY Z", 253],
      ["A:ROTATION VELOCITY BODY X", 0],
      ["A:ROTATION VELOCITY BODY Y", 0],
      ["A:ROTATION VELOCITY BODY Z", 0],
      ["A:GENERAL ENG THROTTLE LEVER POSITION:1", 12_500],
      ["A:GENERAL ENG THROTTLE LEVER POSITION:2", 12_500],
      ["A:GENERAL ENG PROPELLER LEVER POSITION:1", 14_500],
      ["A:GENERAL ENG PROPELLER LEVER POSITION:2", 14_500],
      ["L:BKSQ_MixtureLeverPosition_1", mixtures[0]!],
      ["L:BKSQ_MixtureLeverPosition_2", mixtures[1]!],
      ["A:FLAPS HANDLE PERCENT", 0],
      ["A:GEAR HANDLE POSITION", 0],
      ["A:ELEVATOR TRIM PCT", -5],
      ["A:AUTOPILOT MASTER", 1],
      ["A:AUTOPILOT FLIGHT DIRECTOR ACTIVE", 1],
      ["A:AUTOPILOT HEADING LOCK", 1],
      ["A:AUTOPILOT ALTITUDE LOCK", 1],
      ["A:AUTOPILOT ALTITUDE LOCK VAR", target],
      ["A:AUTOPILOT HEADING LOCK DIR:1", course],
    ],
    texts: [],
  })
  await sleep(10_000)
  await record(20)
  await sleep(20_500)
  const trims = (await recorded()).map((f) => f[3]!)
  say(`while it followed for 20s, the 58P's elevator trim read ${Math.min(...trims).toFixed(2)}% to ${Math.max(...trims).toFixed(2)}%, where the second pilot's reads -5%`)
  const bug = await readSim("A:AUTOPILOT HEADING LOCK DIR:1", "degrees")
  result(Math.abs(angle(bug - course)) < 0.05, `the 58P's heading bug followed the second pilot's to ${course}°: it reads ${bug.toFixed(2)}°`)

  say("You take control for 15 seconds. Keep your hands off the controls.", true)
  await record(15)
  await takeControl(c, "real")
  await sleep(300)
  const firstTrim = await readSim("A:ELEVATOR TRIM PCT", "percent")
  await sleep(15_200)
  const flown = await recorded()
  const turned = Math.max(...flown.map((f) => Math.abs(angle(f[0]! - course))))
  const bank = Math.max(...flown.map((f) => Math.abs(f[1]!)))
  const moved = flown.at(-1)![2]! - flown[0]![2]!
  result(Math.abs(firstTrim + 5) < 1, `as it took control, the 58P's trim went to the second pilot's -5%: it read ${firstTrim.toFixed(2)}% 300ms after`)
  result(turned < 5 && Math.abs(moved) < 500, `after it took control in heading mode, the 58P turned up to ${turned.toFixed(1)}° from ${course}°, banked up to ${bank.toFixed(1)}°, and went ${moved >= 0 ? "up" : "down"} ${Math.abs(moved).toFixed(0)} ft in 15s`)
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
 * `DUALINPUT_CHECK_HANDOVER` (record/areas/architecture/02-code-map.md, "Names the sim shares").
 * Runs in Coherent GT, so it's ES2017.
 */
async function record(seconds: number): Promise<void> {
  await evaluateInPanel(`(function () {
    var names = ${JSON.stringify(READ)};
    var out = { from: performance.now(), frames: [] };
    window.DUALINPUT_CHECK_HANDOVER = out;
    function frame() {
      var now = performance.now();
      var row = [];
      for (var i = 0; i < names.length; i++) row.push(Number(SimVar.GetSimVarValue(names[i][0], names[i][1])));
      out.frames.push(row);
      if (now - out.from < ${seconds * 1000} && window.DUALINPUT_CHECK_HANDOVER === out) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return 0;
  })()`)
}

/** What `record` read, a row of `READ` for each frame, once it has ended. */
async function recorded(): Promise<number[][]> {
  const text = await evaluateInPanel<string>("JSON.stringify(window.DUALINPUT_CHECK_HANDOVER || null)")
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
