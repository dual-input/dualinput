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
  EXERCISER_EXE,
  EXERCISER_LOG,
  FSC_COPY,
  FSC_RELAY_EXE,
  FSC_SOURCE,
  FSC_SYNCED,
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
    `fsc-exerciser, ${EXERCISER_EXE}: ${exists(EXERCISER_EXE)}`,
    `the FS Copilot build it synced, which the run uses: ${JSON.stringify(fscBuild())}; the fork's main is at ${git(FSC_SOURCE)}`,
    `its relay, ${FSC_RELAY_EXE}: ${exists(FSC_RELAY_EXE)}`,
    `p31's copy of FS Copilot, ${path.relative(ROOT, FSC_COPY)}: ${exists(path.join(FSC_COPY, "FsCopilot.exe"))}`,
    `the user's FS Copilot profile of the 58P in it: ${sameFile(path.join(FSC_DEFINITIONS, FSC_PROFILE_NAME), path.join(FSC_COPY, "Definitions", FSC_PROFILE_NAME)) ? "ok" : "MISSING or out of date; run prepare"}`,
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

function sameFile(a: string, b: string): boolean {
  return fs.existsSync(a) && fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b))
}

/**
 * Builds what the runs need from this tree: our package into Community, the pilot's core with the
 * release profile, and the bench's core, stand-in helper, relay, and profiles as tools/bench.ts
 * builds them; then copies the FS Copilot build fsc-exerciser synced, with the user's 58P profile.
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
  copyFsc()
  console.log(`copied FS Copilot into ${path.relative(ROOT, FSC_COPY)}, ${elapsed()}`)
}

/**
 * Copies the FS Copilot build the exerciser compiled against, since a peer of another build is
 * refused for a schema that hashes each packet type's assembly-qualified name, and puts the user's
 * 58P profile in its Definitions. The copy leaves out the Community folder, which the app would
 * otherwise deploy into the sim's at its start (read in FS Copilot fork, src/FsCopilot/Installer.cs,
 * DeployBridge), and the settings and logs the exerciser's copy wrote while it ran.
 */
function copyFsc(): void {
  if (!fs.existsSync(path.join(FSC_SYNCED, "FsCopilot.exe"))) {
    throw new Failed(`fsc-exerciser holds no synced FS Copilot in ${FSC_SYNCED}; run its sync-and-rebuild.ps1 -Fsc ${FSC_SOURCE} -Configuration Release`)
  }
  fs.mkdirSync(FSC_COPY, { recursive: true })
  const left = /^(Community|settings\.json.*|log|log\..*)$/i
  fs.cpSync(FSC_SYNCED, FSC_COPY, { recursive: true, force: true, filter: (src) => !left.test(path.relative(FSC_SYNCED, src)) })
  fs.copyFileSync(path.join(FSC_DEFINITIONS, FSC_PROFILE_NAME), path.join(FSC_COPY, "Definitions", FSC_PROFILE_NAME))
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

async function startFsc(folder: string, say: Say, notes: string[]): Promise<Started> {
  if (!fs.existsSync(path.join(FSC_COPY, "FsCopilot.exe"))) throw new Failed(`there's no copy of FS Copilot in ${FSC_COPY}; run prepare`)
  if (!fs.existsSync(EXERCISER_EXE)) throw new Failed(`fsc-exerciser isn't built at ${EXERCISER_EXE}; run its sync-and-rebuild.ps1`)
  if (powershell("Get-NetUDPEndpoint -LocalPort 3600 -ErrorAction SilentlyContinue").trim()) throw new Failed("something already holds UDP port 3600, FS Copilot's relay port; close any exerciser or relay left running")
  const children: ChildProcess[] = []
  const relayOut = fs.createWriteStream(path.join(folder, "fsc-relay.txt"))
  const stop = async () => {
    for (const p of children) closeWindow(p.pid)
    await sleep(5_000)
    for (const p of children) if (p.exitCode === null) p.kill()
    relayOut.end()
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
  // The exerciser makes a code the same way, and FS Copilot takes it as its peer ID.
  const code = `EX${crypto.randomBytes(3).toString("hex").toUpperCase()}`
  let fsc: ChildProcess
  let exerciser: ChildProcess
  try {
    await until(() => (relaySaid.includes("UDP port: 3600") ? true : undefined), 30_000, "FS Copilot's relay to listen on UDP 3600")
    // `--no-direct` sends every link through the relay, as the bench's relays-only setting does Dual Input's, so both tools' traffic takes the same path (read in FS Copilot fork, src/FsCopilot/Program.cs).
    fsc = spawn(path.join(FSC_COPY, "FsCopilot.exe"), ["--relay", "localhost", "--peer-id", code, "--no-direct"], { cwd: FSC_COPY, stdio: "ignore" })
    children.push(fsc)
    say(`started FS Copilot as ${code} on the local relay`)
    await sleep(8_000)
    exerciser = await joinExerciser(code, say, children)
  } catch (error) {
    await stop()
    throw error
  }

  return {
    roles: (all) =>
      harness(all, process.pid, (p) => {
        if (p.pid === fsc.pid) return "pilot: FS Copilot"
        if (tree(all, fsc.pid!).some((q) => q.pid === p.pid)) return `pilot: FS Copilot's ${p.name}`
        if (p.pid === exerciser.pid) return "second pilot: fsc-exerciser"
        if (tree(all, exerciser.pid!).some((q) => q.pid === p.pid)) return `second pilot: fsc-exerciser's ${p.name}`
        if (p.pid === relay.pid) return "network: FS Copilot's relay"
        return undefined
      }),
    ready: async () => {
      let state = await fscState(30_000)
      if (state?.sync !== "live") {
        notes.push(`FS Copilot's session read ${JSON.stringify(state)} after the flight loaded, so the exerciser joined again`)
        closeWindow(exerciser.pid)
        await sleep(3_000)
        if (exerciser.exitCode === null) exerciser.kill()
        exerciser = await joinExerciser(code, say, children)
        state = await fscState(30_000)
      }
      if (state?.sync !== "live" || state.role !== "master") notes.push(`FS Copilot's session read ${JSON.stringify(state)}, not live with FS Copilot as master, so its numbers may not be a session's`)
      return [`FS Copilot says its session is ${state?.sync ?? "unknown"}, as ${state?.role || "no role"}`]
    },
    stop,
  }
}

/** Starts fsc-exerciser joining `code`, from its checkout's root as run.cmd does, and waits for its log to say the join went, three tries at most. */
async function joinExerciser(code: string, say: Say, children: ChildProcess[]): Promise<ChildProcess> {
  for (let attempt = 1; ; attempt++) {
    const from = fs.existsSync(EXERCISER_LOG) ? fs.statSync(EXERCISER_LOG).size : 0
    const exerciser = spawn(EXERCISER_EXE, ["--relay", "localhost", "--join", code], { cwd: EXERCISER, stdio: "ignore" })
    children.push(exerciser)
    const joined = await until(
      () => {
        if (!fs.existsSync(EXERCISER_LOG)) return undefined
        const fd = fs.openSync(EXERCISER_LOG, "r")
        const size = fs.fstatSync(fd).size
        const buffer = Buffer.alloc(Math.max(0, size - from))
        fs.readSync(fd, buffer, 0, buffer.length, from)
        fs.closeSync(fd)
        return /join: (\S+)/.exec(buffer.toString("utf8"))?.[1]
      },
      45_000,
      "fsc-exerciser to say how its join went",
    ).catch(() => "no answer")
    say(`fsc-exerciser's join of ${code}, try ${attempt}: ${joined}`)
    if (joined === "Success") return exerciser
    closeWindow(exerciser.pid)
    await sleep(3_000)
    if (exerciser.exitCode === null) exerciser.kill()
    if (attempt === 3) throw new Failed(`fsc-exerciser couldn't join FS Copilot in three tries; its log is ${EXERCISER_LOG}`)
  }
}

function closeWindow(pid: number | undefined): void {
  if (pid) powershell(`try { [void](Get-Process -Id ${pid} -ErrorAction Stop).CloseMainWindow() } catch { }`)
}

/** What FS Copilot tells a watcher of its panel channel about its session, as fsc-exerciser's Session.WatchLoop reads it: its sync state and role. */
async function fscState(ms: number): Promise<{ sync: string; role: string } | null> {
  const started = Date.now()
  while (Date.now() - started < ms) {
    for (const port of [9020, 9021, 9022, 9023, 9024]) {
      const state = await new Promise<{ sync: string; role: string } | null>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/`)
        const timer = setTimeout(() => {
          ws.close()
          resolve(null)
        }, 3_000)
        ws.onopen = () => ws.send(JSON.stringify({ t: "watch" }))
        ws.onerror = () => {
          clearTimeout(timer)
          resolve(null)
        }
        ws.onmessage = (event) => {
          const message = JSON.parse(String(event.data)) as { t?: string; sync?: string; role?: string }
          if (message.t !== "state") return
          clearTimeout(timer)
          ws.close()
          resolve({ sync: message.sync ?? "", role: message.role ?? "" })
        }
      })
      if (state) return state
    }
    await sleep(1_000)
  }
  return null
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

/** Which FS Copilot build the run used: the fork's commit the exerciser synced, as its sync recorded it, without the checkout's path, which names this PC's user. */
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
