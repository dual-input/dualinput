/*
 * p31: what Dual Input and FS Copilot each cost one PC, in the sim's frame times and in the CPU,
 * memory, and network bytes of each tool's processes. The runs share one flight, the Black Square
 * Baron 58P on runway 14 at Seymour, SEGS, engines running and parking brake set, each measured
 * for 5 minutes with nobody touching anything:
 *
 *   none        neither tool's package in Community, and no tool running
 *   fsc         FS Copilot, with fsc-exerciser as the second pilot on this PC
 *   dualinput   Dual Input, with a bench core as the second pilot on this PC
 *
 * Run it in a terminal opened as administrator, since PresentMon and the network trace each start
 * an ETW session. procedure.md beside this file gives the steps.
 *
 *   node experiments/areas/product/p31-tool-cost/run.ts check
 *   node experiments/areas/product/p31-tool-cost/run.ts prepare
 *   node experiments/areas/product/p31-tool-cost/run.ts none | fsc | dualinput [--seconds <n>] [--dry]
 *   node experiments/areas/product/p31-tool-cost/run.ts finish
 *   node experiments/areas/product/p31-tool-cost/run.ts restore | profiles
 *
 * A run switches Community, starts the tool, starts the sim through Steam, asks aloud for the
 * flight, waits for the sim to have the focus, settles 30s, measures, then stops the tool and closes
 * the sim, so the next run starts with the sim closed. `--dry` runs with a stand-in process for the
 * sim and leaves Community alone unless DUALINPUT_P31_PACKAGES names a copy of a packages folder.
 * `finish` moves every package back and writes the report from the runs of the last 12 hours.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import type { SessionSlice } from "../../../../src/engines/messages/ts/session/SessionSlice.ts"
import type { SimSlice } from "../../../../src/engines/messages/ts/sim/SimSlice.ts"
import { BenchRun, type Core } from "../../../../tools/bench/cores.ts"
import { load } from "../../../../tools/bench/flights.ts"
import { StandInHelper } from "../../../../tools/bench/helper.ts"
import { app, BenchNetwork, join } from "../../../../tools/bench/network.ts"
import { level } from "../../../../tools/bench/profiles.ts"
import { buildPrograms } from "../../../../tools/lib/cargo.ts"
import { refuseWhileSimRuns, simRunning, userCfgs } from "../../../../tools/lib/install.ts"
import { writeMessageTypes } from "../../../../tools/lib/messages.ts"
import { ROOT } from "../../../../tools/lib/repo.ts"
import { Failed, main, run } from "../../../../tools/lib/run.ts"
import { desktop, type Desktop } from "../../../../tools/sim/desktop.ts"
import { Guide } from "../../../../tools/sim/guide.ts"
import { DUAL_INPUT, FS_COPILOT, mount, restore, where, type Package } from "./community.ts"
import { elevated, measure, PRESENTMON, processes, SIM_EXE, tree, type Measured, type Tracked } from "./measure.ts"
import {
  BENCH_OUT,
  BENCH_PROFILES,
  EXERCISER,
  FSC_APP,
  FSC_PILOT_FOLDER,
  FSC_PROJECT,
  FSC_RELAY_EXE,
  FSC_SECOND_FOLDER,
  FSC_SOURCE,
  RELEASE_CORE,
  RESULTS,
  WORK,
} from "./places.ts"
import { compareProfiles, FSC_DEFINITIONS, FSC_PROFILE_NAME } from "./profiles.ts"
import { report } from "./report.ts"
import { MODES, summary, type Mode, type Result } from "./result.ts"

const MOUNTS: Record<Mode, Package[]> = { none: [], fsc: [FS_COPILOT], dualinput: [DUAL_INPUT] }

const SETTLE_MS = 30_000
const STEAM_URL = "steam://rungameid/2537590"
const BARON = /baronpro/i
/** What the sim starts and leaves running after it quits, which then makes Steam refuse to start it again. */
const LEFTOVERS = ["FenixBootstrapper", "TDSGTNXiFlightSimEXE", "TDSROARService", "roar", "gtn_simulator"]
/** The copilot's eye in the 58P's profile, where the second pilot's camera sits, as tools/sim/camera.ts has it. */
const COPILOT_EYE: [number, number, number] = [-0.282, 0.855, -0.144]

const FLIGHT =
  "Load a free flight in the Black Square Baron 58P, at Seymour, S E G S, on runway 14, with the weather preset Clear Skies and the time at noon. " +
  "Press Ready to fly. Start the engines if they aren't running, set the parking brake, and stay in the cockpit view. Then press Page Up."

type Say = (line: string, aloud?: boolean) => void
type Voice = Pick<Guide, "say" | "tick" | "pass" | "skipped" | "close">
const silent: Voice = { say: () => {}, tick: () => {}, pass: () => {}, skipped: () => false, close: () => {} }
/** What a tool's run started, and how to end it. */
type Started = { roles: (all: ReturnType<typeof processes>) => Tracked[]; ready: () => Promise<string[]>; before?: () => Promise<void>; after?: () => Promise<Pick<Result, "relayBytes">>; stop: () => Promise<void> }

main(async () => {
  const [command, ...rest] = process.argv.slice(2)
  const seconds = Number(flag(rest, "--seconds") ?? 300)
  const dry = rest.includes("--dry")
  if (command === "check") return check()
  if (command === "prepare") return prepare()
  if (command === "restore") return void restore().forEach((l) => console.log(l))
  if (command === "profiles") return void compareProfiles().forEach((l) => console.log(`${l}\n`))
  if (command === "finish") {
    for (const line of restore()) console.log(line)
    restoreFscProfile()
    console.log(`The report is in ${path.relative(ROOT, report())}.`)
    return
  }
  if (command && command in MODES) return runOne(command as Mode, seconds, dry)
  throw new Failed("usage: node experiments/areas/product/p31-tool-cost/run.ts check | prepare | none | fsc | dualinput [--seconds <n>] [--dry] | finish | restore | profiles")
})

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
}

async function until<T>(get: () => T | undefined | Promise<T | undefined>, ms: number, what: string): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = await get()
    if (value !== undefined) return value
    if (Date.now() - started > ms) throw new Failed(`gave up after ${Math.round(ms / 1000)}s waiting for ${what}`)
    await sleep(200)
  }
}

function powershell(script: string): string {
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { encoding: "utf8" }).stdout
}

function exists(file: string): string {
  return fs.existsSync(file) ? "ok" : "MISSING"
}

/** What a run needs, and what's missing, without changing anything. */
async function check(): Promise<void> {
  const lines = [
    `terminal opened as administrator: ${elevated() ? "ok" : "NO, so PresentMon and the network trace won't start; open Terminal (Admin)"}`,
    `PresentMon, ${PRESENTMON}: ${exists(PRESENTMON)}`,
    `the sim: ${simRunning() ? "RUNNING; close it before a run" : "closed"}`,
    `Steam: ${powershell("if (Get-Process steam -ErrorAction SilentlyContinue) { 'running' } else { 'NOT RUNNING; start it, unelevated, from the Start menu' }").trim()}`,
    ...where().map((w) => `Community, ${w.community}: ${Object.entries(w.packages).map(([n, p]) => `${n} ${p}`).join(", ")}`),
    `the pilot's release core, ${path.relative(ROOT, RELEASE_CORE)}: ${exists(RELEASE_CORE)}`,
    `its core helper: ${exists(path.join(path.dirname(RELEASE_CORE), "dualinput-core-helper.exe"))}`,
    `the bench core, ${path.relative(ROOT, BENCH_OUT)}: ${exists(path.join(BENCH_OUT, "dualinput-core.exe"))}`,
    `the bench's profiles: ${exists(BENCH_PROFILES)}`,
    `FS Copilot as fsc-exerciser synced it, ${FSC_APP}: ${exists(FSC_APP)}, commit ${fscBuild()?.commit ?? "unrecorded"}, where the fork's main is at ${git(FSC_SOURCE)}`,
    `its relay, ${FSC_RELAY_EXE}: ${exists(FSC_RELAY_EXE)}`,
    `the user's FS Copilot profile of the 58P: ${exists(path.join(FSC_DEFINITIONS, FSC_PROFILE_NAME))}`,
    `the second FS Copilot's SimConnect.cfg, which keeps it off the sim: ${exists(path.join(FSC_SECOND_FOLDER, "SimConnect.cfg"))}`,
    `free on C:: ${(Number(powershell("(Get-PSDrive C).Free").trim()) / 2 ** 30).toFixed(1)} GB`,
  ]
  for (const line of lines) console.log(line)
  console.log("\nThe busiest processes over 5s, where a game, a torrent client, or a backup would show:")
  const before = cpu()
  await sleep(5_000)
  const after = cpu()
  const busy = [...after].map(([pid, v]) => ({ pid, name: v.name, percent: ((v.ms - (before.get(pid)?.ms ?? v.ms)) / 5_000) * 100 })).sort((a, b) => b.percent - a.percent).slice(0, 8)
  for (const b of busy) console.log(`  ${b.percent.toFixed(1).padStart(6)}% of one core  ${b.name} (${b.pid})`)
}

function cpu(): Map<number, { name: string; ms: number }> {
  const times = new Map<number, { name: string; ms: number }>()
  for (const line of powershell(`Get-Process | ForEach-Object { try { "$($_.Id)\`t$($_.ProcessName)\`t$($_.TotalProcessorTime.TotalMilliseconds)" } catch { } }`).split(/\r?\n/)) {
    const [pid, name, ms] = line.split("\t")
    if (pid && name && ms) times.set(Number(pid), { name, ms: Number(ms) })
  }
  return times
}

/**
 * Builds what the runs need from this tree: our package into Community, the pilot's core with the
 * release profile, and the bench's core, stand-in helper, relay, and profiles as tools/bench.ts
 * builds them; then FS Copilot and fsc-exerciser, if the exerciser holds another commit than the
 * fork's main; then copies the FS Copilot build the exerciser synced, with the user's 58P profile.
 * Only build output changes in the fork's and the exerciser's checkouts.
 */
async function prepare(): Promise<void> {
  refuseWhileSimRuns()
  const started = Date.now()
  const elapsed = () => `${Math.round((Date.now() - started) / 60_000)} min in`
  run(process.execPath, [path.join("tools", "build.ts"), "install"])
  console.log(`installed our package, ${elapsed()}`)
  buildPrograms(["--release", "-p", "dualinput-core", "-p", "dualinput-core-helper"], ["dualinput-core", "dualinput-core-helper"])
  console.log(`built the pilot's release core, ${elapsed()}`)
  // As buildBench and publishProfiles in tools/bench.ts build them, so change both together.
  writeMessageTypes()
  const programs = ["dualinput-core", "stand-in-core-helper", "bench-relay", "dualinput-profile-builder"] as const
  const built = buildPrograms([...programs.flatMap((p) => ["-p", p]), "--features", "dualinput-core/stand-in", "--target-dir", path.join("target", "bench"), "--profile", "release-with-checks"], programs)
  fs.rmSync(BENCH_PROFILES, { recursive: true, force: true })
  run(built["dualinput-profile-builder"], ["publish", "--released", String(level()), "--profiles", "profiles", "--pages", BENCH_PROFILES])
  console.log(`built the bench, ${elapsed()}`)
  // fsc-exerciser's sync copies the fork's Release build to the same paths each time, so the
  // firewall's rules for them still hold. It refuses a build older than any source file, so
  // FS Copilot builds first.
  const head = git(FSC_SOURCE)
  if (fscBuild()?.commit !== head) {
    run("dotnet", ["build", FSC_PROJECT, "-c", "Release", "--nologo", "-v", "q", "-nodeReuse:false"])
    run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(EXERCISER, "sync-and-rebuild.ps1"), "-Fsc", FSC_SOURCE, "-Configuration", "Release"])
    console.log(`built FS Copilot ${head} and synced fsc-exerciser to it, ${elapsed()}`)
  }
  fs.mkdirSync(FSC_PILOT_FOLDER, { recursive: true })
  fs.mkdirSync(FSC_SECOND_FOLDER, { recursive: true })
  // SimConnect reads SimConnect.cfg from the app's working folder: on our development machine on
  // 2026-11-18, an app started in a folder whose file named a port this script listened on tried
  // that port 94 times in 15s. Port 1 refuses every connection on a PC that runs no TCPMUX, so
  // each try fails at once and the second app never reaches the sim.
  fs.writeFileSync(path.join(FSC_SECOND_FOLDER, "SimConnect.cfg"), "[SimConnect]\r\nProtocol=IPv4\r\nAddress=127.0.0.1\r\nPort=1\r\n")
  console.log(`FS Copilot ${fscBuild()?.commit} is ready to run from fsc-exerciser's copy, ${elapsed()}`)
}

async function runOne(mode: Mode, seconds: number, dry: boolean): Promise<void> {
  const label = MODES[mode]
  const name = `${stamp()}-${mode}`
  const folder = path.join(WORK, "runs", name)
  fs.mkdirSync(folder, { recursive: true })
  fs.mkdirSync(RESULTS, { recursive: true })
  const text: string[] = []
  // A dry run speaks and beeps nothing, since it runs with no one at the sim, at any hour.
  const guide = dry ? silent : await Guide.start()
  const say: Say = (line, aloud = false) => {
    console.log(line)
    text.push(line)
    if (aloud) guide.say(line)
  }
  const notes: string[] = []

  if (!dry && !elevated()) throw new Failed("this terminal isn't elevated, so PresentMon and the network trace can't start; open Terminal (Admin) and run this again")
  if (!dry && simRunning()) throw new Failed("the sim is running; close it, so this run can switch Community and start it")
  // Steam started from this elevated terminal would start the sim elevated too, which no pilot runs.
  if (!dry && !powershell("Get-Process steam -ErrorAction SilentlyContinue").trim()) throw new Failed("Steam isn't running; start it from the Start menu, then run this again")
  if (!fs.existsSync(PRESENTMON)) notes.push(`PresentMon isn't at ${PRESENTMON}, so this run has no frame times`)

  say(`p31, the run with ${label}, ${new Date().toString()}`)
  if (!dry || process.env.DUALINPUT_P31_PACKAGES) for (const line of mount(MOUNTS[mode])) say(line)
  else say("dry: Community stays as it is")

  const started = await start(mode, folder, say, notes, dry)
  // Ctrl+C stops the tool as a run's end does, so no FS Copilot or core is left running; the sim stays open.
  process.once("SIGINT", () => void started.stop().finally(() => process.exit(130)))
  let stand: ChildProcess | undefined
  let measured: Measured | undefined
  let extra: Pick<Result, "relayBytes"> = {}
  let version: string | null = null
  try {
    let sim: number
    if (dry) {
      stand = spawn("ping", ["-n", "86400", "127.0.0.1"], { stdio: "ignore" })
      sim = stand.pid!
      say("dry: a ping stands in for the sim")
    } else {
      sim = await launchSim(say)
      version = simVersion()
      say(FLIGHT, true)
      await pageUp(guide, 45 * 60_000)
    }
    for (const line of await started.ready()) say(line)
    if (!dry) await focused(sim, say)
    const minutes = Math.ceil((SETTLE_MS + seconds * 1000) / 60_000)
    say(`Hands off now, for about ${minutes} minute${minutes === 1 ? "" : "s"}, until the high beep.`, true)
    guide.tick()
    await sleep(SETTLE_MS)
    await started.before?.()
    const tracked = started.roles(processes())
    say(`measuring for ${seconds}s: ${tracked.map((t) => `${t.role} (${t.pid})`).join(", ")}`)
    measured = await measure(folder, sim, tracked, seconds)
    extra = (await started.after?.()) ?? {}
    guide.pass()
    say("Measured. You can move again; the run stops the tool and closes the sim now.", true)
  } finally {
    await started.stop().catch((error: Error) => say(`stopping the tool: ${error.message}`))
    stand?.kill()
    if (!dry) await closeSim(say).catch((error: Error) => say(error.message, true))
  }

  const result: Result = { probe: "p31", mode, label, dry, commit: git(ROOT), fsc: mode === "dualinput" ? null : fscBuild(), simVersion: version, measured, ...extra, notes }
  // A dry run's numbers measure no sim, so they stay in target/ with its raw output.
  const json = dry ? path.join(folder, "result.json") : path.join(RESULTS, `p31-${name}.json`)
  fs.writeFileSync(json, `${JSON.stringify(result, null, 2)}\n`)
  for (const line of summary(result)) say(line)
  fs.writeFileSync(path.join(folder, "run.txt"), `${text.join("\n")}\n`)
  say(`The numbers are in ${path.relative(ROOT, json)}, and PresentMon's CSV and the network trace in ${path.relative(ROOT, folder)}.`)
  guide.close()
  process.exit(0)
}

/** The run's tool, started before the sim is, as a pilot would have it running. */
async function start(mode: Mode, folder: string, say: Say, notes: string[], dry: boolean): Promise<Started> {
  if (mode === "fsc") return startFsc(folder, say, notes)
  if (mode === "dualinput") return startDualInput(folder, say, notes, dry)
  const me = process.pid
  return { roles: (all) => harness(all, me, () => undefined), ready: async () => [], stop: async () => {} }
}

/** The harness's own processes, which every run has: this script, the guide's three PowerShells, and whatever `role` names first. */
function harness(all: ReturnType<typeof processes>, me: number, role: (p: { pid: number; parent: number; name: string }) => string | undefined): Tracked[] {
  return tree(all, me).map((p) => ({ role: role(p) ?? (p.pid === me ? "harness: this script" : `harness: ${p.name}`), pid: p.pid, name: p.name }))
}

/**
 * FS Copilot as its own one-PC bench runs it: the pilot's app, and a second app that joins the
 * pilot's session through the control channel `--bench` opens (read in FS Copilot fork,
 * src/FsCopilot/Connection/BenchControl.cs). fsc-exerciser can't be the second pilot: FS Copilot's
 * main registers traffic and ATC packets the exerciser doesn't, and refused its join for
 * SCHEMA_MISMATCH on our development machine on 2026-11-18. Both apps link through the fork's relay
 * on this PC.
 */
async function startFsc(folder: string, say: Say, notes: string[]): Promise<Started> {
  for (const file of [FSC_APP, FSC_RELAY_EXE, path.join(FSC_SECOND_FOLDER, "SimConnect.cfg")]) if (!fs.existsSync(file)) throw new Failed(`there's no ${file}; run prepare`)
  if (powershell("Get-NetUDPEndpoint -LocalPort 3600 -ErrorAction SilentlyContinue").trim()) throw new Failed("something already holds UDP port 3600, FS Copilot's relay port; close any FS Copilot, exerciser, or relay left running")
  if (powershell("Get-NetTCPConnection -LocalPort 9020 -State Listen -ErrorAction SilentlyContinue").trim()) throw new Failed("something already listens on port 9020, where FS Copilot's panels look first; close any FS Copilot left running")
  // FS Copilot loads profiles from its program's folder, so the user's 58P profile goes into the
  // copy's Definitions for the run, and the fork's own comes back at its end, or at `finish`.
  fs.copyFileSync(path.join(FSC_DEFINITIONS, FSC_PROFILE_NAME), path.join(path.dirname(FSC_APP), "Definitions", FSC_PROFILE_NAME))
  const children: ChildProcess[] = []
  const relayOut = fs.createWriteStream(path.join(folder, "fsc-relay.txt"))
  const benchPort = await freePort()
  let pilot: ChildProcess | undefined
  const stop = async () => {
    await bench(benchPort, { c: "quit" }).catch(() => {})
    // The pilot's own close path says goodbye to its peer, as its window's close button does.
    closeWindow(pilot?.pid)
    await sleep(5_000)
    for (const p of children) if (p.exitCode === null) p.kill()
    relayOut.end()
    restoreFscProfile()
  }
  let relaySaid = ""
  // As fsc-exerciser's Local.StartRelay starts it, with its HTTP side on a port nothing else takes.
  const relay = spawn(FSC_RELAY_EXE, [], { cwd: path.dirname(FSC_RELAY_EXE), env: { ...process.env, ASPNETCORE_URLS: "http://127.0.0.1:5399" }, stdio: ["ignore", "pipe", "pipe"] })
  children.push(relay)
  for (const stream of [relay.stdout!, relay.stderr!]) {
    stream.on("data", (d: Buffer) => {
      relaySaid += d.toString()
      relayOut.write(d)
    })
  }
  // FS Copilot's codes are 8 characters, and the bench's join refuses any other length.
  const code = `PI${crypto.randomBytes(3).toString("hex").toUpperCase()}`
  // Each app writes its log into its working folder, read from where this run started.
  const since = (file: string) => {
    const from = fs.existsSync(file) ? fs.statSync(file).size : 0
    return () => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").slice(from) : "")
  }
  const pilotLog = since(path.join(FSC_PILOT_FOLDER, "log"))
  const secondLog = since(path.join(FSC_SECOND_FOLDER, "log"))
  let second: ChildProcess
  try {
    await until(() => (relaySaid.includes("UDP port: 3600") ? true : undefined), 30_000, "FS Copilot's relay to listen on UDP 3600")
    // `--no-direct` sends every link through the relay, as the bench's relays-only setting does Dual Input's, so both tools' traffic takes the same path (read in FS Copilot fork, src/FsCopilot/Program.cs).
    pilot = spawn(FSC_APP, ["--relay", "localhost", "--peer-id", code, "--no-direct"], { cwd: FSC_PILOT_FOLDER, stdio: "ignore" })
    children.push(pilot)
    // The sim's panels look for FS Copilot on ports 9020 to 9024 in turn, so the pilot's app takes 9020 before the second starts.
    await until(() => (/\[PanelServer\] Listening on 127\.0\.0\.1:9020/.test(pilotLog()) ? true : undefined), 60_000, "the pilot's FS Copilot to listen on port 9020")
    const secondId = `SE${crypto.randomBytes(3).toString("hex").toUpperCase()}`
    second = spawn(FSC_APP, ["--relay", "localhost", "--peer-id", secondId, "--no-direct", "--bench", String(benchPort)], { cwd: FSC_SECOND_FOLDER, stdio: "ignore" })
    children.push(second)
    say(`started the pilot's FS Copilot as ${code}, and a second FS Copilot as ${secondId}, on the local relay`)
    // A join sent before both apps reach the relay fails, and a failed join leaves the joiner master (read in FS Copilot fork, src/FsCopilot/ViewModels/MainViewModel.cs, JoinCommand).
    await until(() => (relaySaid.includes(`CONNECT pid=${code}`) && relaySaid.includes(`CONNECT pid=${secondId}`) ? true : undefined), 60_000, "both FS Copilots to reach the relay")
    await joinSecond(benchPort, code, say)
  } catch (error) {
    await stop()
    throw error
  }
  const [pilotApp, secondApp] = [pilot, second]
  const secondReachedSim = () => /\[SimConnect\] (Consumer|Producer) connected/.test(secondLog())

  return {
    roles: (all) =>
      harness(all, process.pid, (p) => {
        if (p.pid === pilotApp.pid) return "pilot: FS Copilot"
        if (tree(all, pilotApp.pid!).some((q) => q.pid === p.pid)) return `pilot: FS Copilot's ${p.name}`
        if (p.pid === secondApp.pid) return "second pilot: a second FS Copilot, kept off the sim"
        if (tree(all, secondApp.pid!).some((q) => q.pid === p.pid)) return `second pilot: its ${p.name}`
        if (p.pid === relay.pid) return "network: FS Copilot's relay"
        return undefined
      }),
    ready: async () => {
      let peers = await bench(benchPort, { c: "peers" }).catch(() => null)
      if (!peers?.connected || peers.master) {
        notes.push(`the second FS Copilot read ${JSON.stringify(peers)} after the flight loaded, so it joined again`)
        await joinSecond(benchPort, code, say).catch((error: Error) => notes.push(error.message))
        peers = await bench(benchPort, { c: "peers" }).catch(() => null)
      }
      if (!peers?.connected || peers.master) notes.push(`the second FS Copilot read ${JSON.stringify(peers)}, not linked and following, so the pilot's FS Copilot may not have been sending as a master to a follower`)
      if (secondReachedSim()) notes.push("the second FS Copilot's log says its SimConnect reached the sim, so it wrote into the pilot's aircraft and the run measures two apps on one sim")
      return [`the second FS Copilot is ${peers?.connected ? "linked" : "NOT linked"}, ${peers?.master ? "as master" : "following"}, with peers ${JSON.stringify(peers?.peers ?? [])}`]
    },
    after: async () => {
      if (secondReachedSim()) notes.push("the second FS Copilot's SimConnect reached the sim during the window")
      return {}
    },
    stop,
  }
}

/** Puts the fork's own 58P profile back into fsc-exerciser's copy, as its sync left it, from the source its build copies. */
function restoreFscProfile(): void {
  const own = path.join(FSC_SOURCE, "Definitions", FSC_PROFILE_NAME)
  if (fs.existsSync(own) && fs.existsSync(FSC_APP)) fs.copyFileSync(own, path.join(path.dirname(FSC_APP), "Definitions", FSC_PROFILE_NAME))
}

type Peers = { ok: boolean; connected?: boolean; master?: boolean; peers?: unknown[]; error?: string }

/** Has the second app join `code` through its bench channel, as pressing Join does, until it's linked and following, three tries at most. */
async function joinSecond(port: number, code: string, say: Say): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    // The bench channel opens once the app's window and services are up, a few seconds after its start.
    await until(() => bench(port, { c: "join", code }).catch(() => undefined), 60_000, "the second FS Copilot's bench channel").catch(() => null)
    // The app reads its link from its peer list, which settles a moment after the join returns,
    // and a leave on a link still settling came back as a master on our development machine, 2026-11-18.
    let peers: Peers | null = null
    for (const started = Date.now(); Date.now() - started < 15_000 && !peers?.connected; await sleep(500)) peers = await bench(port, { c: "peers" }).catch(() => null)
    say(`the second FS Copilot's join of ${code}, try ${attempt}: ${JSON.stringify(peers)}`)
    if (peers?.connected && !peers.master) return
    await bench(port, { c: "leave" }).catch(() => null)
    await sleep(5_000)
  }
  throw new Failed(`the second FS Copilot couldn't join ${code} as a follower in three tries; its log is ${path.join(FSC_SECOND_FOLDER, "log")}`)
}

let benchId = 0

/** Sends one request on FS Copilot's bench channel, a JSON line over loopback TCP, and returns its reply line. */
function bench(port: number, request: Record<string, unknown>): Promise<Peers> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(`${JSON.stringify({ id: ++benchId, ...request })}\n`))
    let text = ""
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`FS Copilot's bench channel didn't answer ${JSON.stringify(request)}`))
    }, 60_000)
    socket.on("data", (d: Buffer) => {
      text += d.toString("utf8")
      const end = text.indexOf("\n")
      if (end < 0) return
      clearTimeout(timer)
      socket.end()
      resolve(JSON.parse(text.slice(0, end)) as Peers)
    })
    socket.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })
}

function closeWindow(pid: number | undefined): void {
  if (pid) powershell(`try { [void](Get-Process -Id ${pid} -ErrorAction Stop).CloseMainWindow() } catch { }`)
}

/**
 * Dual Input as tools/sim/camera.ts runs it: the pilot's release core on a data folder of the
 * run's, against the bench's local relay, backend, and profiles' site, and a bench core as the
 * second pilot, seated in the copilot's seat on a stand-in sim, so the pilot's sim draws its figure.
 */
async function startDualInput(folder: string, say: Say, notes: string[], dry: boolean): Promise<Started> {
  for (const file of [RELEASE_CORE, path.join(BENCH_OUT, "dualinput-core.exe"), BENCH_PROFILES]) if (!fs.existsSync(file)) throw new Failed(`there's no ${file}; run prepare`)
  process.env.DUALINPUT_BENCH_CORE = path.join(BENCH_OUT, "dualinput-core.exe")
  process.env.DUALINPUT_BENCH_STAND_IN_HELPER = path.join(BENCH_OUT, "stand-in-core-helper.exe")
  process.env.DUALINPUT_BENCH_RELAY = path.join(BENCH_OUT, "bench-relay.exe")
  process.env.DUALINPUT_BENCH_BUILDER = path.join(BENCH_OUT, "dualinput-profile-builder.exe")
  process.env.DUALINPUT_BENCH_PROFILES = BENCH_PROFILES

  const net = await BenchNetwork.start(1)
  const { settings } = net.core()
  const benchRun = new BenchRun("p31-tool-cost")
  const stub = spawn("ping", ["-n", "86400", "127.0.0.1"], { stdio: "ignore" })
  const helper = await StandInHelper.start()
  let second: Core | undefined
  let real: ChildProcess | undefined
  const stop = async () => {
    if (real?.pid) spawnSync("taskkill", ["/PID", String(real.pid), "/T", "/F"], { stdio: "ignore" })
    await second?.kill().catch(() => {})
    stub.kill()
    helper.close()
    await net.stop().catch(() => {})
  }
  let pilot: Desktop
  try {
    const userCfg = userCfgs().find((file) => fs.existsSync(file))
    second = await benchRun.core("second-pilot", helper.coreOptions(userCfg ? { ...settings, "sim.user-cfg": userCfg } : settings))
    second.act({ act: "watch", process: stub.pid! })
    await second.hear("stage Starting aircraft none")
    second.cockpit({ act: "ready", on: true })
    second.act({ act: "set", numbers: [["E:IS AVATAR", 0]], texts: [] })
    second.act({ act: "camera", referential: 1, position: COPILOT_EYE, pitch: 0, yaw: 0, roll: 0, fov: 1 })

    const data = path.join(folder, "core")
    fs.mkdirSync(data, { recursive: true })
    fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ ...settings, "session.name": "Pilot" }, null, 2))
    const out = fs.openSync(`${data}-output.txt`, "w")
    real = spawn(RELEASE_CORE, ["--data", data], { stdio: ["ignore", out, out] })
    await until(() => (fs.existsSync(path.join(data, "port.json")) ? true : undefined), 30_000, "the pilot's core to write its port file")
    pilot = await desktop(data, ["session", "sim"])
  } catch (error) {
    await stop()
    throw error
  }
  const [secondCore, realCore] = [second, real]
  say(`started the pilot's core (${realCore.pid}) and the second pilot's bench core (${secondCore.process.pid})`)
  let relayBefore: Record<string, [number, number]> = {}

  return {
    roles: (all) =>
      harness(all, process.pid, (p) => {
        if (p.pid === realCore.pid) return "pilot: Dual Input's core"
        if (p.parent === realCore.pid) return `pilot: the core's ${p.name}`
        if (p.pid === secondCore.process.pid) return "second pilot: the bench core"
        if (p.parent === secondCore.process.pid) return `second pilot: the bench core's ${p.name}`
        if (/^bench-relay/i.test(p.name)) return "network: the bench relay"
        if (/^(workerd|node)/i.test(p.name) && p.pid !== process.pid) return `network: the local backend's ${p.name}`
        if (p.pid === stub.pid) return "second pilot: its stand-in sim's process"
        return undefined
      }),
    ready: async () => {
      if (dry) return ["dry: with no sim, no session is hosted"]
      const sim = () => pilot.slice<SimSlice>("sim")
      const flying = () => sim()?.stage === "flying" && BARON.test(sim()?.aircraft?.path ?? "")
      await until(() => (flying() ? true : undefined), 5 * 60_000, "the pilot's core to see the 58P in a flight")
      // As tools/sim/camera.ts waits, so the aircraft's own start has run before the session starts.
      await sleep(15_000)
      const aircraftPath = sim()!.aircraft!.path
      await pilot.command("session.host", null)
      const session = () => pilot.slice<SessionSlice>("session")
      const code = await until(() => session()?.code ?? undefined, 30_000, "the session's code")
      const secondApp = await app(secondCore)
      await join(secondCore, code, "Second pilot")
      await until(() => (session()?.members.length === 2 ? true : undefined), 30_000, "the second pilot to join")
      await load(secondCore, { cfg: `SimObjects\\Airplanes\\${aircraftPath.replaceAll("/", "\\")}\\aircraft.cfg`, path: aircraftPath }, { title: "Baron 58P", livery: "bench" })
      await until(() => (secondApp.slice<SessionSlice>("session")?.ready?.length === 0 ? true : undefined), 30_000, "the second pilot's Ready")
      await secondApp.ok("session.ready", { on: true })
      await until(() => (session()?.ready?.length === 0 ? true : undefined), 75_000, "the pilot's aircraft to settle")
      await pilot.command("session.ready", { on: true })
      await until(() => (session()?.preflight.phase === "ended" ? true : undefined), 30_000, "preflight to end")
      const ended = session()
      if (ended?.pf !== ended?.me) notes.push("the pilot's core wasn't the pilot flying when the window started")
      return [`Dual Input's session ${code} is flying, with ${ended?.members.length} members, and preflight ended`]
    },
    before: async () => {
      relayBefore = await net.relays[0]!.rates().catch(() => ({}))
    },
    after: async () => {
      const relayAfter = await net.relays[0]!.rates().catch(() => ({}) as Record<string, [number, number]>)
      const relayBytes: NonNullable<Result["relayBytes"]> = {}
      for (const [pid, [bytes, busiest]] of Object.entries(relayAfter)) relayBytes[pid] = { bytes: bytes - (relayBefore[pid]?.[0] ?? 0), busiestSecond: busiest }
      return { relayBytes }
    },
    stop,
  }
}

async function pageUp(guide: Voice, ms: number): Promise<void> {
  guide.skipped()
  for (const started = Date.now(); Date.now() - started < ms; await sleep(100)) if (guide.skipped()) return
  throw new Failed("no Page Up came; the run stops")
}

/** Waits until the sim's window has the focus, since MSFS 2024 draws fewer frames without it, asking aloud each minute it doesn't. */
async function focused(sim: number, say: Say): Promise<void> {
  const front = () => Number(powershell(`Add-Type 'using System; using System.Runtime.InteropServices; public static class P31F { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }'; $p = 0; [void][P31F]::GetWindowThreadProcessId([P31F]::GetForegroundWindow(), [ref]$p); $p`).trim())
  for (let asked = 0; front() !== sim; ) {
    if (Date.now() - asked > 60_000) {
      say("Click once on the sim's window, so it has the focus.", true)
      asked = Date.now()
    }
    await sleep(1_000)
  }
}

/** Starts the sim through Steam, after ending what a sim before it left behind, and returns its process ID. */
async function launchSim(say: Say): Promise<number> {
  killLeftovers()
  for (let attempt = 0; attempt < 2; attempt++) {
    spawnSync("cmd", ["/c", "start", "", STEAM_URL], { stdio: "ignore" })
    say(attempt === 0 ? "Starting the sim through Steam." : "The sim didn't start, so the run asks Steam again.", true)
    // Steam can ignore a launch sent seconds after the sim last quit (the memory of 2026-10-04 in our notes), so it gets a second.
    const pid = await until(() => simPid(), 60_000, "the sim's process").catch(() => undefined)
    if (pid) return pid
  }
  say("Start the sim from Steam yourself; the run waits for it.", true)
  return until(() => simPid(), 10 * 60_000, "the sim's process")
}

function simPid(): number | undefined {
  return processes().find((p) => p.name.toLowerCase() === SIM_EXE.toLowerCase())?.pid
}

/** Closes the sim as its window's close button does, and waits up to 2 min for it to quit, then asks the pilot. */
async function closeSim(say: Say): Promise<void> {
  if (!simRunning()) return
  powershell("Get-Process FlightSimulator2024 -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }")
  const gone = await until(() => (simRunning() ? undefined : true), 120_000, "the sim to quit").catch(() => false)
  if (!gone) {
    say("The sim hasn't quit in two minutes. Quit it from its main menu.", true)
    await until(() => (simRunning() ? undefined : true), 10 * 60_000, "the sim to quit")
  }
  killLeftovers()
  say("The sim has quit.")
}

function killLeftovers(): void {
  if (simRunning()) return
  powershell(`Get-Process -Name ${LEFTOVERS.join(",")} -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`)
}

function git(folder: string): string {
  return spawnSync("git", ["-C", folder, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim()
}

/** Which FS Copilot build the run used: the fork's commit fsc-exerciser synced, as its sync recorded it, without the checkout's path, which names this PC's user. */
function fscBuild(): { commit: string; hash: string; synced: string } | null {
  const recorded = path.join(EXERCISER, "fsc-exerciser.json")
  if (!fs.existsSync(recorded)) return null
  const sync = JSON.parse(fs.readFileSync(recorded, "utf8").replace(/^﻿/, "")) as { Commit: string; Hash: string; When: string }
  return { commit: sync.Commit, hash: sync.Hash, synced: sync.When }
}

function simVersion(): string | null {
  const exe = processes().find((p) => p.name.toLowerCase() === SIM_EXE.toLowerCase())?.path
  return exe ? powershell(`(Get-Item '${exe.replaceAll("'", "''")}').VersionInfo.FileVersion`).trim() : null
}
