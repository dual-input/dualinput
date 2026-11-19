/*
 * p31: what Dual Input and FS Copilot each cost one PC, in the sim's frame times and in the CPU,
 * memory, and network bytes of each tool's processes. Every run flies the same flight, the Black
 * Square Baron 58P on runway 14 at Seymour, SEGS, at noon, and measures it for 5 minutes with
 * nobody touching anything, in one of four modes:
 *
 *   none                   neither tool's package in Community, and no tool running
 *   fsc                    FS Copilot, with a second FS Copilot, kept off the sim, as the second pilot
 *   dualinput              Dual Input, with a bench core as the second pilot
 *   dualinput-no-figures   Dual Input as above, from a core built with no-figures.patch, which
 *                          creates no figure in the sim, so the two Dual Input runs tell what
 *                          the figures cost the sim's frames
 *
 * Run it in a terminal opened as administrator, since PresentMon and the network trace each start
 * an ETW session. procedure.md beside this file gives the steps.
 *
 *   node experiments/areas/product/p31-tool-cost/run.ts check
 *   node experiments/areas/product/p31-tool-cost/run.ts prepare
 *   node experiments/areas/product/p31-tool-cost/run.ts all [--repeats <n>] [--seconds <n>] [--modes none,fsc,dualinput] [--dry]
 *   node experiments/areas/product/p31-tool-cost/run.ts none | fsc | dualinput [--seconds <n>] [--dry]
 *   node experiments/areas/product/p31-tool-cost/run.ts finish | restore | profiles
 *
 * `all` runs the modes in turn, every second round in reverse, so a steady drift over the hours
 * falls on every mode alike, then moves every package back and writes the report. Each run switches Community, starts its tool,
 * starts the sim through Steam, loads the flight through the menu (sim.ts), brings the sim to the
 * front, settles 30s, measures, stops the tool, and closes the sim. A crash or a hang starts the run
 * over from a closed sim, and its third try asks aloud for the flight instead. `--dry` runs with a
 * stand-in process for the sim and leaves Community alone unless DUALINPUT_P31_PACKAGES names a
 * copy of a packages folder.
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
import { install, refuseWhileSimRuns, simRunning, userCfgs } from "../../../../tools/lib/install.ts"
import { writeMessageTypes } from "../../../../tools/lib/messages.ts"
import { PACKAGE } from "../../../../tools/lib/package.ts"
import { ROOT } from "../../../../tools/lib/repo.ts"
import { Failed, main, run } from "../../../../tools/lib/run.ts"
import { desktop, type Desktop } from "../../../../tools/sim/desktop.ts"
import { Guide } from "../../../../tools/sim/guide.ts"
import { DUAL_INPUT, FS_COPILOT, mount, restore, where, type Package } from "./community.ts"
import { elevated, measure, othersBusy, PRESENTMON, PRESENTMON_URL, presentMonWorks, processes, SIM_EXE, tree, type Measured, type Tracked } from "./measure.ts"
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
  NO_FIGURES_CORE,
  RELEASE_CORE,
  RESULTS,
  WORK,
} from "./places.ts"
import { compareProfiles, FSC_DEFINITIONS, FSC_PROFILE_NAME } from "./profiles.ts"
import { report } from "./report.ts"
import { MODES, summary, type Mode, type Result } from "./result.ts"
import { closeSim, focusSim, launchSim, loadFlight, SimDown } from "./sim.ts"

const MOUNTS: Record<Mode, Package[]> = { none: [], fsc: [FS_COPILOT], dualinput: [DUAL_INPUT], "dualinput-no-figures": [DUAL_INPUT] }

const SETTLE_MS = 30_000
/** How many times a run starts over from a closed sim before it gives up, the last of them asking aloud for the flight. */
const ATTEMPTS = 3
const BARON = /baronpro/i
/** The copilot's eye in the 58P's profile, where the second pilot's camera sits, as tools/sim/camera.ts has it. */
const COPILOT_EYE: [number, number, number] = [-0.282, 0.855, -0.144]

const ASK_FOR_FLIGHT =
  "The run couldn't load the flight on its own. Load a free flight in the Black Square Baron 58P, at Seymour, S E G S, on runway 14, at noon. " +
  "Press Ready to fly, stay in the cockpit view, and press Page Up."

type Say = (line: string, aloud?: boolean) => void
type Voice = Pick<Guide, "say" | "tick" | "pass" | "skipped" | "close">
const silent: Voice = { say: () => {}, tick: () => {}, pass: () => {}, skipped: () => false, close: () => {} }
/** What a tool's run started, and how to end it. */
type Started = { roles: (all: ReturnType<typeof processes>) => Tracked[]; ready: () => Promise<string[]>; before?: () => Promise<void>; after?: () => Promise<Pick<Result, "relayBytes">>; stop: () => Promise<void> }
type Options = { seconds: number; dry: boolean }

main(async () => {
  const [command, ...rest] = process.argv.slice(2)
  const options: Options = { seconds: Number(flag(rest, "--seconds") ?? 300), dry: rest.includes("--dry") }
  if (command === "check") return check()
  if (command === "prepare") return prepare()
  if (command === "restore") return void restore().forEach((l) => console.log(l))
  if (command === "profiles") return void compareProfiles().forEach((l) => console.log(`${l}\n`))
  if (command === "finish") return finish()
  if (command === "all") {
    const modes = (flag(rest, "--modes") ?? "none,fsc,dualinput").split(",") as Mode[]
    const unknown = modes.filter((m) => !(m in MODES))
    if (unknown.length) throw new Failed(`no mode named ${unknown.join(", ")}; the modes are ${Object.keys(MODES).join(", ")}`)
    if (modes.includes("dualinput-no-figures") && !fs.existsSync(NO_FIGURES_CORE)) throw new Failed(`there's no ${NO_FIGURES_CORE}; build it as procedure.md says`)
    return all(modes, Number(flag(rest, "--repeats") ?? 2), options)
  }
  if (command && command in MODES) {
    await session(options, async (guide) => void (await runOne(command as Mode, options, guide)))
    return
  }
  throw new Failed("usage: node experiments/areas/product/p31-tool-cost/run.ts check | prepare | all [--repeats <n>] [--seconds <n>] [--modes ...] [--dry] | none | fsc | dualinput | dualinput-no-figures [--seconds <n>] [--dry] | finish | restore | profiles")
})

function finish(): void {
  for (const line of restore()) console.log(line)
  restoreFscProfile()
  console.log(`The report is in ${path.relative(ROOT, report())}.`)
}

/**
 * Checks what every run needs before the first starts, so a missing build or an unelevated
 * terminal stops the schedule at once, not an hour in, then runs `body` with the guide's voice,
 * which a dry run keeps silent, since it runs with no one at the sim, at any hour.
 */
async function session(options: Options, body: (guide: Voice) => Promise<void>): Promise<void> {
  let quit: string[] = []
  if (!options.dry) {
    if (!elevated()) throw new Failed("this terminal isn't elevated, so PresentMon and the network trace can't start; open Terminal (Admin) and run this again")
    if (simRunning()) throw new Failed("the sim is running; close it, so the run can switch Community and start it")
    // Steam started from this elevated terminal would start the sim elevated too, which no pilot runs.
    if (!powershell("Get-Process steam -ErrorAction SilentlyContinue").trim()) throw new Failed("Steam isn't running; start it from the Start menu, then run this again")
    if (!fs.existsSync(PRESENTMON)) throw new Failed(`PresentMon isn't at ${PRESENTMON}; download ${PRESENTMON_URL} there`)
    const frames = presentMonWorks(path.join(WORK, "runs"))
    if (frames) throw new Failed(frames)
    console.log("PresentMon traced frames in a 3s check")
    if (!fs.existsSync(PACKAGE)) throw new Failed(`there's no package of this tree's in ${PACKAGE}; run prepare`)
    quit = quitInstalledDualInput()
    if (quit.length) console.log(`quit your installed Dual Input for the benchmark: ${quit.join(", ")}`)
    // A package an earlier run left aside comes back first, so the copy below replaces it rather than sitting beside it.
    for (const line of restore()) console.log(line)
    for (const copy of install(PACKAGE, userCfgs())) console.log(`installed this tree's package in ${copy}`)
  }
  const guide = options.dry ? silent : await Guide.start()
  try {
    await body(guide)
  } finally {
    guide.close()
    if (!options.dry) console.log("If your installed Dual Input was running, the runs quit it; it starts again at your next login, or from the Start menu, and puts its own package back in Community as it starts.")
  }
}

/**
 * Ends the installed Dual Input's tray app and its core, which would otherwise spoil every run: the
 * app writes its own package into Community after each sim close whenever ours is aside, or of
 * another version, as this tree's 0.1.0 is beside a 0.1.1 release (read in
 * src/apps/desktop/src/jobs.rs, `SimExited` and `write_package`), and it starts its own core with
 * every sim, beside the run's.
 */
function quitInstalledDualInput(): string[] {
  const home = path.join(process.env.LOCALAPPDATA ?? "", "DualInput").toLowerCase()
  const installed = processes().filter((p) => p.path?.toLowerCase().startsWith(`${home}\\`))
  for (const p of installed) spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore" })
  return installed.map((p) => `${p.name} (${p.pid})`)
}

/**
 * Every mode in turn, `repeats` times, then Community back as it started and the report. Every
 * second round runs in reverse, so each mode's runs sit at the same mean place in the schedule,
 * and a steady drift raises every mode's median alike. In 2026-11-19's schedule, which ran
 * none, FS Copilot, Dual Input twice in that order, each round's frame times rose in that order.
 */
async function all(modes: Mode[], repeats: number, options: Options): Promise<void> {
  const started = Date.now()
  try {
    await session(options, async (guide) => {
      for (let round = 1; round <= repeats; round++) {
        for (const mode of round % 2 ? modes : [...modes].reverse()) {
          console.log(`\n=== round ${round} of ${repeats}: ${MODES[mode]}, ${Math.round((Date.now() - started) / 60_000)} min in`)
          // A run that stops before its tries, such as on a package missing from Community, leaves the rest of the schedule to run.
          const result = await runOne(mode, options, guide).catch((error: Error) => void console.log(`the run with ${MODES[mode]} stopped: ${error.message}`))
          // Frame times are what the schedule is for, so a window that measured none ends it rather than measuring the rest without them.
          if (!options.dry && result?.measured && "error" in result.measured.frames) throw new Failed(`stopped the schedule, since the run with ${MODES[mode]} measured no frames: ${result.measured.frames.error}`)
        }
      }
    })
  } finally {
    // A restore that can't move a package back says why, and leaves the report to be written all the same.
    try {
      if (!options.dry || process.env.DUALINPUT_P31_PACKAGES) for (const line of restore()) console.log(line)
    } catch (error) {
      console.log(`Community isn't back as it was: ${(error as Error).message}`)
    }
    restoreFscProfile()
  }
  if (options.dry) return console.log("dry: no report, since a dry run's numbers measure no sim")
  let written: string
  try {
    written = path.relative(ROOT, report())
  } catch (error) {
    written = `not written: ${(error as Error).message}`
  }
  console.log(`\nEvery run is done, ${Math.round((Date.now() - started) / 60_000)} min after the first started. The report is in ${written}.`)
}

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
    `PresentMon, ${PRESENTMON}: ${fs.existsSync(PRESENTMON) ? "ok" : `MISSING; download ${PRESENTMON_URL} there`}`,
    `the sim: ${simRunning() ? "RUNNING; close it before a run" : "closed"}`,
    `your installed Dual Input: ${processes().some((p) => p.path?.toLowerCase().startsWith(`${path.join(process.env.LOCALAPPDATA ?? "", "DualInput").toLowerCase()}\\`)) ? "running; the run quits it at its start" : "not running"}`,
    `Steam: ${powershell("if (Get-Process steam -ErrorAction SilentlyContinue) { 'running' } else { 'NOT RUNNING; start it, unelevated, from the Start menu' }").trim()}`,
    ...where().map((w) => `Community, ${w.community}: ${Object.entries(w.packages).map(([n, p]) => `${n} ${p}`).join(", ")}`),
    `the pilot's release core, ${path.relative(ROOT, RELEASE_CORE)}: ${exists(RELEASE_CORE)}`,
    `its core helper: ${exists(path.join(path.dirname(RELEASE_CORE), "dualinput-core-helper.exe"))}`,
    `the core with no figures, for --modes ...,dualinput-no-figures, ${path.relative(ROOT, NO_FIGURES_CORE)}: ${exists(NO_FIGURES_CORE)}, and its core helper: ${exists(path.join(path.dirname(NO_FIGURES_CORE), "dualinput-core-helper.exe"))}`,
    `the bench core, ${path.relative(ROOT, BENCH_OUT)}: ${exists(path.join(BENCH_OUT, "dualinput-core.exe"))}`,
    `the bench's profiles: ${exists(BENCH_PROFILES)}`,
    `FS Copilot as fsc-exerciser synced it, ${FSC_APP}: ${exists(FSC_APP)}, commit ${fscBuild()?.commit ?? "unrecorded"}, where the fork's main is at ${git(FSC_SOURCE)}`,
    `its relay, ${FSC_RELAY_EXE}: ${exists(FSC_RELAY_EXE)}`,
    `the user's FS Copilot profile of the 58P: ${exists(path.join(FSC_DEFINITIONS, FSC_PROFILE_NAME))}`,
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
  // A run stopped partway leaves packages aside, and the install below would put a second copy beside them.
  for (const line of restore()) console.log(line)
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
  console.log(`FS Copilot ${fscBuild()?.commit} is ready to run from fsc-exerciser's copy, ${elapsed()}`)
}

/**
 * One run of `mode`: Community switched, then up to three tries, each with the tool started first,
 * as a pilot would have it running, then the sim from closed. A crash, a hang, or a failed step ends
 * the try, stops the tool, and closes the sim, and the third try asks aloud for the flight. The run's
 * JSON holds the numbers, or every try's error when none got through.
 */
async function runOne(mode: Mode, options: Options, guide: Voice): Promise<Result> {
  const { seconds, dry } = options
  const label = MODES[mode]
  const name = `${stamp()}-${mode}`
  const folder = path.join(WORK, "runs", name)
  fs.mkdirSync(folder, { recursive: true })
  fs.mkdirSync(RESULTS, { recursive: true })
  const text: string[] = []
  const say: Say = (line, aloud = false) => {
    console.log(line)
    text.push(line)
    if (aloud) guide.say(line)
  }
  const notes: string[] = []
  say(`p31, the run with ${label}, ${new Date().toString()}`)
  // Windows starts the installed app at login, 42s after Steam on 2026-11-18, which was 20s after that schedule had looked for it, so every run looks again.
  if (!dry) for (const quit of quitInstalledDualInput()) say(`quit your installed Dual Input's ${quit}`)
  if (!dry || process.env.DUALINPUT_P31_PACKAGES) for (const line of mount(MOUNTS[mode])) say(line)
  else say("dry: Community stays as it is")

  let measured: Measured | undefined
  let extra: Pick<Result, "relayBytes"> = {}
  let version: string | null = null
  let loaded: string[] = []
  const failures: string[] = []
  for (let attempt = 1; attempt <= ATTEMPTS && !measured; attempt++) {
    let started: Started | undefined
    let stand: ChildProcess | undefined
    // Ctrl+C stops the tool and closes the sim as a try's end does, so no FS Copilot or core is left running.
    const interrupted = () => {
      void (started?.stop() ?? Promise.resolve()).finally(() => process.exit(130))
    }
    process.once("SIGINT", interrupted)
    try {
      started = await start(mode, folder, say, notes, dry)
      let sim: number
      if (dry) {
        stand = spawn("ping", ["-n", "86400", "127.0.0.1"], { stdio: "ignore" })
        sim = stand.pid!
        say("dry: a ping stands in for the sim")
      } else {
        sim = await launchSim(say)
        version = simVersion()
        if (attempt === ATTEMPTS) {
          say(ASK_FOR_FLIGHT, true)
          // With nobody at the PC this only costs the wait, so it's short.
          await pageUp(guide, 10 * 60_000)
          loaded = [`the pilot loaded the flight, after the run's own load failed ${ATTEMPTS - 1} times`]
        } else loaded = await loadFlight(sim, say)
      }
      for (const line of await started.ready()) say(line)
      if (!dry && !focusSim()) notes.push("the run couldn't bring the sim to the front before its window")
      say(`settling ${SETTLE_MS / 1000}s, then measuring for ${seconds}s`)
      await sleep(SETTLE_MS)
      if (!dry && !alive(sim)) throw new SimDown("the sim quit while the flight settled")
      const tracked = started.roles(processes())
      const busy = await othersBusy(new Set([sim, ...tracked.map((t) => t.pid)]))
      if (busy.length) notes.push(`in the 10s before the window, processes outside the run used ${busy.map((b) => `${b.name} ${b.cpuPercent.toFixed(0)}%`).join(", ")} of one core`)
      if (!dry && !focusSim()) notes.push("the sim wasn't in front as the window started, and the run couldn't bring it there")
      say(`measuring: ${tracked.map((t) => `${t.role} (${t.pid})`).join(", ")}`)
      await started.before?.()
      const window = await measure(folder, sim, tracked, seconds)
      if (!dry && !alive(sim)) throw new SimDown("the sim quit during the window")
      extra = (await started.after?.()) ?? {}
      measured = window
      guide.pass()
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      failures.push(`try ${attempt}: ${why}`)
      say(`try ${attempt} of ${ATTEMPTS} stopped: ${why}`)
    } finally {
      process.removeListener("SIGINT", interrupted)
      await started?.stop().catch((error: Error) => say(`stopping the tool: ${error.message}`))
      stand?.kill()
      if (!dry) await closeSim(say).catch((error: Error) => say(error.message))
    }
  }
  if (failures.length) notes.push(...failures.map((f) => (measured ? `${f}, so the run started over` : f)))

  const result: Result = { probe: "p31", mode, label, dry, commit: git(ROOT), fsc: mode.startsWith("dualinput") ? null : fscBuild(), simVersion: version, loaded, measured, ...extra, notes }
  // A dry run's numbers measure no sim, so they stay in target/ with its raw output.
  const json = dry ? path.join(folder, "result.json") : path.join(RESULTS, `p31-${name}.json`)
  fs.writeFileSync(json, `${JSON.stringify(result, null, 2)}\n`)
  for (const line of summary(result)) say(line)
  fs.writeFileSync(path.join(folder, "run.txt"), `${text.join("\n")}\n`)
  say(`The numbers are in ${path.relative(ROOT, json)}, and PresentMon's CSV and the network trace in ${path.relative(ROOT, folder)}.`)
  return result
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The run's tool, started before the sim is, as a pilot would have it running. */
async function start(mode: Mode, folder: string, say: Say, notes: string[], dry: boolean): Promise<Started> {
  if (mode === "fsc") return startFsc(folder, say, notes)
  if (mode === "dualinput") return startDualInput(RELEASE_CORE, folder, say, notes, dry)
  if (mode === "dualinput-no-figures") return startDualInput(NO_FIGURES_CORE, folder, say, notes, dry)
  const me = process.pid
  return { roles: (all) => harness(all, me, () => undefined), ready: async () => [], stop: async () => {} }
}

/**
 * The harness's own processes, which every run has: this script, the guide's three PowerShells, and
 * whatever `role` names first; and the shell and terminal that run the script, up to three levels
 * above it, since they draw its output and would otherwise read as a stranger busy beside the sim.
 */
function harness(all: ReturnType<typeof processes>, me: number, role: (p: { pid: number; parent: number; name: string }) => string | undefined): Tracked[] {
  const above: Tracked[] = []
  for (let p = all.find((x) => x.pid === me); p && above.length < 3; ) {
    const parent = all.find((x) => x.pid === p!.parent)
    if (!parent || /^(explorer|svchost|services|wininit)\.exe$/i.test(parent.name)) break
    above.push({ role: `harness: its ${parent.name}`, pid: parent.pid, name: parent.name })
    p = parent
  }
  return [...tree(all, me).map((p) => ({ role: role(p) ?? (p.pid === me ? "harness: this script" : `harness: ${p.name}`), pid: p.pid, name: p.name })), ...above]
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
  for (const file of [FSC_APP, FSC_RELAY_EXE]) if (!fs.existsSync(file)) throw new Failed(`there's no ${file}; run prepare`)
  if (powershell("Get-NetUDPEndpoint -LocalPort 3600 -ErrorAction SilentlyContinue").trim()) throw new Failed("something already holds UDP port 3600, FS Copilot's relay port; close any FS Copilot, exerciser, or relay left running")
  if (powershell("Get-NetTCPConnection -LocalPort 9020 -State Listen -ErrorAction SilentlyContinue").trim()) throw new Failed("something already listens on port 9020, where FS Copilot's panels look first; close any FS Copilot left running")
  // FS Copilot loads profiles from its program's folder, so the user's 58P profile goes into the
  // copy's Definitions for the run, and the fork's own comes back at its end, or at `finish`.
  fs.copyFileSync(path.join(FSC_DEFINITIONS, FSC_PROFILE_NAME), path.join(path.dirname(FSC_APP), "Definitions", FSC_PROFILE_NAME))
  const children: ChildProcess[] = []
  const relayOut = fs.createWriteStream(path.join(folder, "fsc-relay.txt"))
  const benchPort = await freePort()
  const offSim = await holdOffSim()
  let pilot: ChildProcess | undefined
  const stop = async () => {
    await bench(benchPort, { c: "quit" }).catch(() => {})
    // The pilot's own close path says goodbye to its peer, as its window's close button does.
    closeWindow(pilot?.pid)
    await sleep(5_000)
    for (const p of children) if (p.exitCode === null) p.kill()
    relayOut.end()
    offSim.close()
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

/**
 * Keeps the second FS Copilot off the sim, so the sim serves one FS Copilot, as a pilot's does.
 * SimConnect reads SimConnect.cfg from the app's working folder, and falls back to the sim's
 * default pipe when the port it names refuses, but not when the port accepts and never answers:
 * with the sim closed, an app whose file named a refusing port reached a stand-in for that pipe 8
 * times in 25s, and one whose file named a silent listener reached it 0 times and the listener 8
 * (measured on our development machine, 2026-11-18, after a file naming port 1 let the second app
 * into the sim in both of the first schedule's FS Copilot runs). So this listens on a port of its
 * own, holds each connection without a word, and writes that port into the second app's file.
 */
async function holdOffSim(): Promise<{ close: () => void }> {
  const held: net.Socket[] = []
  const server = net.createServer((socket) => {
    held.push(socket)
    socket.on("error", () => {})
    socket.resume()
  })
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as net.AddressInfo
  fs.mkdirSync(FSC_PILOT_FOLDER, { recursive: true })
  fs.mkdirSync(FSC_SECOND_FOLDER, { recursive: true })
  fs.writeFileSync(path.join(FSC_SECOND_FOLDER, "SimConnect.cfg"), `[SimConnect]\r\nProtocol=IPv4\r\nAddress=127.0.0.1\r\nPort=${port}\r\n`)
  return {
    close: () => {
      for (const socket of held) socket.destroy()
      server.close()
    },
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
 * Dual Input as tools/sim/camera.ts runs it: the pilot's `core`, built with the release profile, on
 * a data folder of the run's, against the bench's local relay, backend, and profiles' site, and a
 * bench core as the second pilot, seated in the copilot's seat on a stand-in sim, so the pilot's sim
 * draws its figure, unless `core` is the one built to draw none.
 */
async function startDualInput(core: string, folder: string, say: Say, notes: string[], dry: boolean): Promise<Started> {
  for (const file of [core, path.join(BENCH_OUT, "dualinput-core.exe"), BENCH_PROFILES]) if (!fs.existsSync(file)) throw new Failed(`there's no ${file}; run prepare`)
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
    // Each try of a run starts its core on the same folder, and the port file an earlier try's core wrote would send the run to a port nothing listens on.
    fs.rmSync(path.join(data, "port.json"), { force: true })
    fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ ...settings, "session.name": "Pilot" }, null, 2))
    const out = fs.openSync(`${data}-output.txt`, "w")
    real = spawn(core, ["--data", data], { stdio: ["ignore", out, out] })
    await until(() => (fs.existsSync(path.join(data, "port.json")) ? true : undefined), 30_000, "the pilot's core to write its port file")
    pilot = await desktop(data, ["session", "sim"])
  } catch (error) {
    await stop()
    throw error
  }
  const [secondCore, realCore] = [second, real]
  say(`started the pilot's core (${realCore.pid}) and the second pilot's bench core (${secondCore.process.pid})`)
  let relayBefore: Record<string, [number, number]> = {}
  let relayFrom = Date.now()

  return {
    roles: (all) =>
      harness(all, process.pid, (p) => {
        if (p.pid === realCore.pid) return "pilot: Dual Input's core"
        if (p.parent === realCore.pid) return `pilot: the core's ${p.name}`
        if (p.pid === secondCore.process.pid) return "second pilot: the bench core"
        if (p.parent === secondCore.process.pid) return `second pilot: the bench core's ${p.name}`
        if (/^bench-relay/i.test(p.name)) return "network: the bench relay"
        // Wrangler serves the local backend through workerd, and rebuilds its code with esbuild.
        if (/^(workerd|node|esbuild)/i.test(p.name) && p.pid !== process.pid) return `network: the local backend's ${p.name}`
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
      relayFrom = Date.now()
    },
    // The relay's counts span the window and the reading of its network trace after it, which
    // took minutes, so each carries the seconds it spans.
    after: async () => {
      const relayAfter = await net.relays[0]!.rates().catch(() => ({}) as Record<string, [number, number]>)
      const seconds = (Date.now() - relayFrom) / 1000
      const relayBytes: NonNullable<Result["relayBytes"]> = {}
      for (const [pid, [bytes, busiest]] of Object.entries(relayAfter)) relayBytes[pid] = { bytes: bytes - (relayBefore[pid]?.[0] ?? 0), busiestSecond: busiest, seconds }
      return { relayBytes }
    },
    stop,
  }
}

/** Waits for Page Up, the pilot's word that the flight is loaded. */
async function pageUp(guide: Voice, ms: number): Promise<void> {
  guide.skipped()
  for (const started = Date.now(); Date.now() - started < ms; await sleep(100)) if (guide.skipped()) return
  throw new SimDown(`no Page Up came in ${ms / 60_000} minutes`)
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
