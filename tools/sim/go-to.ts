// Stage 21's cases in the sim, in one session with someone at the sim (record/areas/build/plan.md,
// "21 Rate and pause, and Go to"): the menu script seeing Free flight's world map; which entry of the
// world map's aircraft list and liveries is the pilot flying's; Join's Set up only at a stand; Join
// now on a runway through Ready to fly, with the Baron 58P's engines running after it and Go to's
// budget; active pause from our EFB app's code with the EFB closed, both ways; and a gate whose
// list name has a letter against its flight file. A bench core plays the pilot flying, James, in a
// Baron 58P on a stand-in sim at KSEA's PARKING 140, through a relay and backend on this PC, and
// the real core, built from this tree, joins James's session as Adam. It writes the report to
// report.txt in the run's folder.
//
//   node tools/build.ts install                   with the sim closed, so our package holds this
//                                                  tree's menu script and EFB app
//   node tools/bench.ts go-to                     once, so target/bench holds this tree's bench core
//   node tools/sim/go-to.ts --core <program>     the real core, built from this tree
//
// Then start the sim; the script says each step aloud, beeps high for a pass and low for a fail,
// and Page Up skips the step it waits on. Keys in the terminal:
//   q   stops both cores, replays the real core's recording, and ends

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import type { GoToSlice } from "../../src/engines/messages/ts/go-to/GoToSlice.ts"
import type { SessionSlice } from "../../src/engines/messages/ts/session/SessionSlice.ts"
import { BenchRun } from "../bench/cores.ts"
import { BARON, load } from "../bench/flights.ts"
import { BenchNetwork, host } from "../bench/network.ts"
import { ROOT } from "../lib/repo.ts"
import { Failed, main } from "../lib/run.ts"
import { desktop, type Desktop } from "./desktop.ts"
import { Guide } from "./guide.ts"
import { evaluate, listPages } from "./inspector.ts"

const BENCH = path.join(ROOT, "target", "bench", "release-with-checks")
process.env.DUALINPUT_BENCH_CORE = path.join(BENCH, "dualinput-core.exe")
process.env.DUALINPUT_BENCH_STAND_IN_HELPER = path.join(BENCH, "stand-in-core-helper.exe")
process.env.DUALINPUT_BENCH_RELAY = path.join(BENCH, "bench-relay.exe")
process.env.DUALINPUT_BENCH_BUILDER = path.join(BENCH, "dualinput-profile-builder.exe")
process.env.DUALINPUT_BENCH_PROFILES = path.join(ROOT, "target", "bench", "profiles")

/** James's flight file, at a stand KSEA lists as "PARKING 140 -- RAMP CARGO" (record/areas/interface/log.md, 2026-10-05). */
const DEPARTURE = "[Departure]\r\nICAO=KSEA\r\nGateName=PARKING\r\nGateNumber=140\r\nGateSuffix=NONE\r\n"

/** The Baron 58P's `A:TITLE`, as p10 read it (record/areas/interface/log.md, 2026-10-06), and the livery that title names. */
const BARON_TITLE = "Black Square Baron 58P Professional N515MR"
const BARON_LIVERY = "N515MR"

/** Reads the world map's store in the menu's document. Runs in Coherent GT, so it's ES2017. */
const READ_STORE = (paths: string[]) => `(function () {
  var l = window._globalDataLoader;
  return ${JSON.stringify(paths)}.map(function (p) { var d = l && l.getData(p); return d ? JSON.parse(JSON.stringify(d.value)) : null; });
})()`

/** Reads a list of the store's, as the world map's list fetcher reads it; the promise's value comes back through a global. */
const READ_LIST = (list: string) => `(function () {
  window.DUALINPUT_CHECK_LIST = null;
  engine.call("requestArrayElements", ${JSON.stringify(list)}, 0, 1000).then(function (n) {
    var out = [];
    for (var i = 0; i < Math.min(n, 1000); i++) { var d = window._globalDataLoader.getData(${JSON.stringify(list)} + "/" + i); out.push(d ? JSON.parse(JSON.stringify(d.value)) : null); }
    window.DUALINPUT_CHECK_LIST = out;
  });
  return true;
})()`

main(() => {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== "--core") throw new Failed("usage: node tools/sim/go-to.ts --core <program>")
  const program = path.resolve(args[1]!)
  if (!fs.existsSync(program)) throw new Failed(`there's no core at ${program}`)
  run(program).catch((error: Error) => {
    console.error(`\n${error.message}`)
    process.exit(1)
  })
})

async function run(program: string): Promise<void> {
  const started = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
  const folder = path.join(ROOT, "target", "sim", "runs", `${started}-go-to`)
  const data = path.join(folder, "core")
  fs.mkdirSync(data, { recursive: true })
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

  // James, the pilot flying, on a bench core.
  const network = await BenchNetwork.start(1)
  const { settings } = network.core()
  const bench = new BenchRun("sim-go-to")
  const james = await bench.core("james", { settings })
  const stub = spawn("ping", ["-n", "86400", "127.0.0.1"], { stdio: "ignore" })
  james.act({ act: "watch", process: stub.pid! })
  await james.hear("stage Starting aircraft none")
  const flight = path.join(folder, "james.FLT")
  fs.writeFileSync(flight, DEPARTURE)
  await load(james, BARON, { title: BARON_TITLE, livery: BARON_LIVERY, flight })
  const code = await host(james, "James")

  // Adam, the real core, with setup done, so the EFB app opens on home.
  fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ ...settings, "session.name": "Adam", "app.setup-done": true, "app.guide-done": true }, null, 2))
  const out = fs.openSync(`${data}-output.txt`, "w")
  const child = spawn(program, ["--data", data], { stdio: ["ignore", out, out] })
  watchKeys(say, async () => {
    child.kill()
    await james.kill()
    stub.kill()
    await network.stop()
    guide.close()
  }, program, data)
  await until(() => (fs.existsSync(path.join(data, "port.json")) ? true : undefined), 30_000, guide)
  const adam = await desktop(data, ["session", "go-to"])
  await adam.command("session.join", { code })
  say(`James hosts ${code} in the Baron 58P at KSEA, PARKING 140, and Adam's core joins it, in ${path.relative(ROOT, folder)}`)

  say("Start the sim. Open Free flight's world map, then open the EFB on Dual Input.", true)
  const worldMap = await until(() => (log(data).includes("master=WorldMap") ? true : undefined), 60 * 60_000, guide)
  result(worldMap === true, "the menu script reported Free flight's world map, so FreeFlightPage is an element it finds")

  // Which of the aircraft list and the liveries is James's.
  const menu = await mainUi()
  await evaluate(menu, READ_LIST("game/aircraft/aircraftList"))
  await sleep(2_000)
  const aircraft = (await evaluate<Record<string, unknown>[] | null>(menu, "window.DUALINPUT_CHECK_LIST")) ?? []
  const barons = aircraft.filter((a) => /\/SimObjects\/Airplanes\/bksq-aircraft-baronpropress\//i.test(String(a?.thumbnailPath)))
  say(`the aircraft list holds ${aircraft.length} entries, ${barons.length} in the Baron 58P's folder:`)
  for (const b of barons) say(`  ${JSON.stringify({ aircraftId: b.aircraftId, variationIndex: b.variationIndex, variation: b.variation, displayName: b.displayName, isUsable: b.isUsable })}`)
  result(barons.length > 0, "the aircraft list has an entry in the Baron's folder, which Join selects")

  const slice = () => adam.slice<GoToSlice>("go-to")
  await until(() => (slice()?.join.as === "ready" ? true : undefined), 30_000, guide)
  say("Press Join on James's row, then Set up only.", true)
  const setUp = await said(adam, guide)
  const [departure, current] = await evaluate<[Record<string, unknown> | null, Record<string, unknown> | null]>(menu, READ_STORE(["game/currentFlight/gameFlight/departure", "game/aircraft/currentAircraft"]))
  const taxis = ((departure?.worldLocation as { airportInfos?: { taxis?: { ID: number; name: string }[] } } | undefined)?.airportInfos?.taxis ?? [])
  const taxi = taxis.find((t) => t.ID === departure?.taxiIndex)
  say(`Set up only said ${JSON.stringify(setUp?.outcome)}; the world map's stand is ${taxi?.name}, and its aircraft ${current?.variation} (${current?.aircraftId})`)
  result(setUp?.outcome.as === "set-up" && !setUp.outcome.no_stand && taxi?.name.indexOf("PARKING 140") === 0, "Set up only selected KSEA's PARKING 140 and the Baron 58P")
  const liveries = await readLiveries(menu)
  say(`the Baron's liveries, by their fields: ${JSON.stringify(liveries.slice(0, 20))}`)

  // James starts his engines, so Join now takes a runway.
  james.act({ act: "set", numbers: [["A:NUMBER OF ENGINES", 2], ["A:GENERAL ENG COMBUSTION:1", 1], ["A:GENERAL ENG COMBUSTION:2", 1]], texts: [] })
  await until(() => (slice()?.spot?.engines ? true : undefined), 30_000, guide)
  say("Press Join, then Join now, and wait in the cockpit for the next step.", true)
  // Set up only wrote its own "Join started", so this counts the lines after it.
  const joins = (text: string) => text.split("Join started").length
  const joinsBefore = joins(log(data))
  const pressed = await until(() => (joins(log(data)) > joinsBefore ? performance.now() : undefined), 10 * 60_000, guide)
  const runway = await until(() => (/a step of Join answered step=Runway/.test(log(data).split("Join started").at(-1) ?? "") ? performance.now() : undefined), 60_000, guide)
  say(`budget: Go to's runway selected ${(runway - pressed).toFixed(0)}ms after the press reached the core, read by polling the log every 250ms, against 5s`)
  await until(() => (/the sim's stage changed stage=Flying/.test(log(data)) ? true : undefined), 5 * 60_000, guide)
  say(`the flight: ${log(data).split("\n").filter((l) => l.includes("the loaded flight file names its departure") || l.includes("the loaded aircraft's title and livery")).slice(-2).join(" | ")}`)
  await sleep(5_000)
  const engines = await cockpit<number[]>("[1, 2].map(function (n) { return SimVar.GetSimVarValue('GENERAL ENG COMBUSTION:' + n, 'bool'); })")
  result(engines.some(Boolean), `Join now put Adam on a runway with the engines running: combustion ${JSON.stringify(engines)}`)
  const session = adam.slice<SessionSlice>("session")
  result(session?.members.find((m) => m.pilot === session.me)?.in_flight === true, "Join now pressed Ready to fly, and Adam is in James's flight")

  // Active pause from our EFB app's code, with the EFB closed.
  say("Close the EFB, and leave the controls alone.", true)
  await sleep(8_000)
  for (const on of [true, false]) {
    const before = performance.now()
    james.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "pause", flags: on ? 4 : 0 } }] })
    const took = await until(() => (myPause(adam) === on ? performance.now() - before : undefined), 10_000, guide).catch(() => undefined)
    result(took !== undefined, `James's active pause ${on ? "on" : "off"} reached Adam's sim through our EFB app's TOOLBAR_SET_ACTIVE_PAUSE${took === undefined ? "" : `, in ${took.toFixed(0)}ms`}`)
  }
  say("Now turn active pause on yourself, then off.", true)
  const writes = await until(() => (log(data).split("this pilot changed active pause").length - 1 >= 2 ? true : undefined), 2 * 60_000, guide)
  result(writes === true, "Adam's own active pause, on and off, each wrote the key")

  // A gate whose list name has a letter, against its flight file.
  say("End the flight. On the world map, take departure KSEA, stand GATE N 17, then Fly, and Ready to fly.", true)
  const flights = (s: string) => s.split("the sim's stage changed stage=Flying").length
  const before = flights(log(data))
  let gate: string | undefined
  // The world map's stand, read until the flight it starts is up.
  await until(async () => {
    const [d] = await evaluate<[Record<string, unknown> | null]>(menu, READ_STORE(["game/currentFlight/gameFlight/departure"])).catch(() => [null])
    const list = (d?.worldLocation as { airportInfos?: { taxis?: { ID: number; name: string }[] } } | undefined)?.airportInfos?.taxis ?? []
    gate = list.find((t) => t.ID === d?.taxiIndex)?.name ?? gate
    return flights(log(data)) > before ? true : undefined
  }, 15 * 60_000, guide)
  const departureLine = log(data).split("\n").filter((l) => l.includes("the loaded flight file names its departure")).at(-1) ?? ""
  const named = /stand_name="?(.*?)"? stand_number=(\d+)/.exec(departureLine)
  say(`the list named the stand ${gate}, and the flight file ${named?.[1]} ${named?.[2]}`)
  result(!!gate && !!named && standMatches(gate, named[1]!, Number(named[2])), "departure_stand would find that gate from its flight file's GateName and GateNumber")
  say("Done. Press q in the terminal to stop the cores and replay Adam's recording.", true)
}

/**
 * Whether the menu script's `departure_stand` takes the stand the list names `listed` for a flight
 * file's `name` and `number`. `standFor` in src/sim-package/pages/world-map.ts holds the same rule,
 * which the map check keeps a tool from importing, so change both together.
 */
function standMatches(listed: string, name: string, number: number): boolean {
  const wanted = `${name.replace(/_/g, " ")} ${number}`.toUpperCase()
  return listed.toUpperCase() === wanted || listed.toUpperCase().indexOf(`${wanted} --`) === 0
}

/** Waits for a new thing Join said. */
async function said(adam: Desktop, guide: Guide): Promise<GoToSlice["said"]> {
  const before = adam.slice<GoToSlice>("go-to")?.said?.n ?? 0
  await until(() => ((adam.slice<GoToSlice>("go-to")?.said?.n ?? 0) > before ? true : undefined), 10 * 60_000, guide)
  return adam.slice<GoToSlice>("go-to")?.said ?? null
}

function myPause(adam: Desktop): boolean | undefined {
  const session = adam.slice<SessionSlice>("session")
  const me = session?.members.find((m) => m.pilot === session.me)
  return me && (me.status.pause & 4) !== 0
}

async function readLiveries(menu: Awaited<ReturnType<typeof mainUi>>): Promise<unknown[]> {
  await evaluate(menu, READ_LIST("game/aircraft/configurator/liveries"))
  await sleep(2_000)
  return (await evaluate<unknown[] | null>(menu, "window.DUALINPUT_CHECK_LIST")) ?? []
}

/** The menu's document, where the menu script runs. */
async function mainUi() {
  for (const page of await listPages()) {
    try {
      if ((await evaluate<string>(page, "typeof window._globalDataLoader + ' ' + typeof engine")) === "object object" && /mainui/i.test(page.title + page.url)) return page
    } catch {
      // A page still loading.
    }
  }
  throw new Failed("the inspector found no menu document with the world map's store")
}

/** Runs `expression` in the first cockpit panel that answers. */
async function cockpit<T>(expression: string): Promise<T> {
  for (const page of (await listPages()).filter((p) => /^VCockpit/i.test(p.title))) {
    try {
      return await evaluate<T>(page, expression)
    } catch {
      // A panel without the sim's SimVar, such as one still loading.
    }
  }
  throw new Failed("no cockpit panel answered")
}

function log(data: string): string {
  const recordings = path.join(data, "recordings")
  if (!fs.existsSync(recordings)) return ""
  const run = fs.readdirSync(recordings).sort().at(-1)
  const file = run && path.join(recordings, run, "log.txt")
  return file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
}

/** Waits for `get` to give a value, for `ms` at most, or until Page Up skips the step. */
async function until<T>(get: () => T | undefined | Promise<T | undefined>, ms: number, guide: Guide): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = await get()
    if (value !== undefined) return value
    if (guide.skipped()) throw new Failed("skipped with Page Up")
    if (Date.now() - started > ms) throw new Failed(`gave up after ${ms / 1000}s`)
    await sleep(250)
  }
}

function watchKeys(say: (line: string) => void, stop: () => Promise<void>, program: string, data: string): void {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on("data", async (key: Buffer) => {
    if (key.toString("utf8") !== "q" && key.toString("utf8") !== "\u0003") return
    await stop()
    await sleep(1_000)
    const recordings = path.join(data, "recordings")
    const last = fs.existsSync(recordings) ? fs.readdirSync(recordings).sort().at(-1) : undefined
    const recording = last && path.join(recordings, last, "inputs.zst")
    if (recording && fs.existsSync(recording)) {
      const replayed = spawnSync(program, ["replay", recording], { encoding: "utf8" })
      say(`Adam's core's replay: ${(replayed.stdout + replayed.stderr).trim()}`)
    }
    process.exit(0)
  })
}
