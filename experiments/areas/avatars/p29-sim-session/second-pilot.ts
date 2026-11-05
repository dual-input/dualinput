/*
 * p29: a second pilot for avatars' session in the sim, on one PC. A local relay, backend, and profiles' site, as p26's
 * stack has them, and a bench core in the 58P on a stand-in sim, whose seat, look, clicks, and walk a command moves, so
 * its figure does in the real sim what a pilot on another machine would do, while the sim's pilot only watches.
 *
 *   node tools/bench.ts session        (once, if target/bench is older than the tree)
 *   node experiments/areas/avatars/p29-sim-session/second-pilot.ts <commands file>
 *
 * It prints how to start the real core, joins that core to the second pilot's session once it's running, and readies
 * both. Each line appended to the commands file is one command:
 *
 *   sit                 the copilot's seat, looking ahead
 *   look <yaw> <pitch>  the camera turned, in degrees, right and up
 *   click <x> <y>       a click at the cursor, -1 to 1 right and up
 *   walk | run | sneak  on foot down the aircraft's right side and back, sneak crouching
 *   stand               on foot, standing still on the right side, facing the aircraft
 *   report              what the second pilot's Figure is fed, and the session's state
 *   quit                ends it all
 */

import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { spawn } from "node:child_process"
import { worldCamera, worldOf, PARKED, type V3 } from "../../../../tools/bench/aircraft.ts"
import { BenchRun } from "../../../../tools/bench/cores.ts"
import { BARON, load } from "../../../../tools/bench/flights.ts"
import { StandInHelper } from "../../../../tools/bench/helper.ts"
import { app, BenchNetwork, host } from "../../../../tools/bench/network.ts"
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
const FOLDER = path.join(ROOT, "target", "sim-session")
const REAL_CORE = path.join(FOLDER, `core-${new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")}`)
const SECOND_PILOT = "Second pilot"
/** The 58P's seats in the profile: the copilot's eye, and the height of the ramp in the aircraft's frame, from tools/figure-viewer's cockpit.json. */
const EYE: V3 = [-0.282, 0.855, -0.144]
const GROUND = -1.189
/** Down the aircraft's right side, outside the wing's tip as the pilot looks out of the right window. */
const LANE = -7
const FOV = 1
const FRAME_MS = 33

const say = (line: string): void => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`)

fs.mkdirSync(REAL_CORE, { recursive: true })
fs.writeFileSync(COMMANDS, "", { flag: "a" })

const network = await BenchNetwork.start(1)
fs.writeFileSync(path.join(REAL_CORE, "settings.json"), JSON.stringify(network.core().settings, null, 2))

const run = new BenchRun("p29-sim-session")
const helper = await StandInHelper.start()
const cfg = userCfgs().find((f) => fs.existsSync(f))
const second = await run.core("second-pilot", helper.coreOptions({ ...network.core().settings, "sim.user-cfg": cfg }))
// A day's worth, where the bench's Stub ends after 10 minutes.
const sim = spawn("ping", ["-n", "86400", "127.0.0.1"], { stdio: "ignore" })
second.act({ act: "watch", process: sim.pid! })
await second.hear("stage Starting aircraft none")

function sit(yaw = 0, pitch = 0): void {
  second.act({ act: "set", numbers: [["E:IS AVATAR", 0]], texts: [] })
  second.act({ act: "camera", referential: 1, position: EYE, pitch: -pitch, yaw, roll: 0, fov: FOV })
}
sit()
await load(second, BARON, { title: "Black Square Baron 58P Professional N513LW" })
const code = await host(second, SECOND_PILOT)

say(`start the real core: target\\debug\\dualinput-core.exe --data ${path.relative(ROOT, REAL_CORE)}`)
say(`the second pilot hosts ${code}`)

/** The real core's port file, as the bench's own cores write theirs, read each time it's asked. */
const realCore = { port: () => JSON.parse(fs.readFileSync(path.join(REAL_CORE, "port.json"), "utf8")).port as number }

async function joinRealCore(): Promise<void> {
  while (!fs.existsSync(path.join(REAL_CORE, "port.json"))) await sleep(500)
  await sleep(1_000)
  // `open` takes a Core, of which it reads only the port.
  const real = await FakeApp.open(realCore as never, ["session", "notifications"])
  await real.ok("clients.set-setting", { key: "session.name", value: "Sim pilot" })
  await real.ok("session.join", { code })
  say("the real core joins")
  const desktop = await app(second)
  type Session = { me: string; members: { pilot: string; in_flight: boolean }[]; ready?: unknown[]; preflight: { phase: string } }
  for (const [who, client] of [["the real core", real], ["the second pilot", desktop]] as const) {
    await client.until(() => {
      const s = client.slice<Session>("session")
      return s?.members.length === 2 && s.members.every((m) => m.in_flight) && s.ready?.length === 0
    }, `${who}: Ready allowed`, 600_000)
    await client.ok("session.ready", { on: true })
    say(`${who} is ready`)
  }
  await real.until(() => real.slice<Session>("session")!.preflight.phase === "ended", "preflight's end", 60_000)
  say("preflight ended")
}
void joinRealCore().catch((e) => say(`joining failed: ${e instanceof Error ? e.message : String(e)}`))

/** Stands the second pilot at the aircraft's point `feet`, heading `heading` from the nose, looking the way it faces. */
function stand(feet: V3, heading: number, crouch: boolean): void {
  const place = worldOf(feet)
  second.act({ act: "set-avatar", numbers: [["A:PLANE LATITUDE", place.latitude], ["A:PLANE LONGITUDE", place.longitude], ["A:PLANE ALTITUDE", place.altitude], ["A:PLANE HEADING DEGREES TRUE", heading], ["A:IS CROUCH", crouch ? 1 : 0]] })
  const h = (heading * Math.PI) / 180
  const eye: V3 = [feet[0], feet[1] + (crouch ? 1 : 1.6), feet[2]]
  second.act({ act: "camera", ...worldCamera(eye, [eye[0] - Math.sin(h), eye[1], eye[2] + Math.cos(h)]) })
}

function onFoot(): void {
  second.act({ act: "set", numbers: [["A:PLANE LATITUDE", PARKED.latitude], ["A:PLANE LONGITUDE", PARKED.longitude], ["A:PLANE ALTITUDE", PARKED.altitude], ["A:PLANE HEADING DEGREES TRUE", 0], ["E:IS AVATAR", 1]], texts: [] })
}

/** Walks from 10m behind the nose's line to 10m ahead of it and back, at `speed` m/s, in frames of the core's own rate. */
async function along(speed: number, crouch: boolean): Promise<void> {
  onFoot()
  for (const [from, to, heading] of [[-10, 10, 0], [10, -10, 180]] as const) {
    const started = performance.now()
    const seconds = Math.abs(to - from) / speed
    for (;;) {
      const t = (performance.now() - started) / 1_000
      if (t >= seconds) break
      stand([LANE, GROUND, from + ((to - from) * t) / seconds], heading, crouch)
      await sleep(FRAME_MS)
    }
  }
  stand([LANE, GROUND, 0], 90, false)
}

let moving = Promise.resolve()
const queue = (work: () => Promise<void>): void => {
  moving = moving.then(work).catch((e) => say(`failed: ${e instanceof Error ? e.message : String(e)}`))
}

async function command(line: string): Promise<boolean> {
  const [word, ...rest] = line.trim().split(/\s+/)
  const [a, b] = rest.map(Number)
  say(`> ${line.trim()}`)
  if (word === "sit") sit()
  else if (word === "look") sit(a ?? 0, b ?? 0)
  else if (word === "click") helper.latest?.act({ act: "click", x: a ?? 0, y: b ?? 0 })
  else if (word === "walk") queue(() => along(1.4, false))
  else if (word === "run") queue(() => along(5, false))
  else if (word === "sneak") queue(() => along(0.8, true))
  else if (word === "stand") {
    onFoot()
    stand([LANE, GROUND, 0], 90, false)
  } else if (word === "report") {
    const fed = second.fed().at(-1)
    say(`second pilot's Figure, ${second.fed().length} feeds: ${JSON.stringify(fed?.figures.map((f) => ({ object: f.object, shows: f.shows, body: f.body.body, hands: f.hands.map((h) => h.hand) })))}`)
    const s = (await app(second)).slice<{ phase?: string; preflight: { phase: string } }>("session")
    say(`session ${JSON.stringify({ preflight: s?.preflight.phase })}`)
  } else if (word === "quit") return false
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
    for (const line of text.slice(read).split(/\r?\n/).filter(Boolean)) going = (await command(line)) && going
    read = text.length
  }
}
await moving
await second.kill()
sim.kill()
await network.stop()
process.exit(0)
