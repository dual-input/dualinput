// The desktop app on the bench, for its own cases and for those where it starts a core again
// (record/areas/build/02-testing.md, "What it runs"). The bench lays out a folder as Velopack
// installs one, with the desktop app and a bench build of the core named dualinput-core.exe in
// its `current\`, so the app's real path runs: it finds itself installed, starts the core from
// its own folder, and writes our package. A stub named FlightSimulator2024.exe stands for the
// sim's process, which the app finds by its name, so no other scenario and no sim may run beside
// these cases. The app reaches the run's packages folder, its update feed, and a local port of
// its own through development settings in its data folder's settings.json.

import assert from "node:assert/strict"
import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import type { DesktopState } from "../../src/engines/messages/ts/desktop/DesktopState.ts"
import type { ToDesktop } from "../../src/engines/messages/ts/desktop/ToDesktop.ts"
import { VERSION } from "../../src/engines/messages/ts/stamp.ts"
import { fullPackage } from "../lib/release.ts"
import { benchCore, benchSettings, type BenchRun, Core } from "./cores.ts"
import { SIM_ORIGIN } from "./pages.ts"

/** The sim's program, which the desktop app looks for. `SIM` in src/apps/desktop/src/processes.rs names the same one, so change both together. */
const SIM = "FlightSimulator2024.exe"

/** The desktop app that tools/bench.ts built. */
function benchDesktop(): string {
  const desktop = process.env.DUALINPUT_BENCH_DESKTOP
  if (!desktop) throw new Error("DUALINPUT_BENCH_DESKTOP isn't set; run the bench with node tools/bench.ts")
  return desktop
}

/** A port nothing on this PC listens on, for the app's local port. */
async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as net.AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/**
 * Velopack's manifest of an installed release, which its locator reads from `current\` to
 * tell the app it's installed, as vpk writes it for our releases.
 */
function manifest(version: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2010/07/nuspec.xsd">
<metadata>
<id>DualInput</id>
<title>Dual Input</title>
<description>Dual Input</description>
<authors>Dual Input</authors>
<version>${version}</version>
<channel>win</channel>
<mainExe>dualinput-desktop.exe</mainExe>
<os>win</os>
<rid>win-x64</rid>
</metadata>
</package>
`
}

/** A feed of releases, as `vpk pack` writes `releases.win.json`, listing `versions` with no files behind them. */
export function writeFeed(folder: string, versions: string[]): string {
  fs.mkdirSync(folder, { recursive: true })
  const assets = versions.map((version) => ({
    PackageId: "DualInput",
    Version: version,
    Type: "Full",
    FileName: fullPackage(version),
    SHA1: "",
    SHA256: "",
    Size: 1,
  }))
  fs.writeFileSync(path.join(folder, "releases.win.json"), JSON.stringify({ Assets: assets }))
  return folder
}

/** Our package as the release folder holds it, at `version`, with one file to tell copies apart by. */
function layOutPackage(folder: string, version: string): void {
  fs.mkdirSync(path.join(folder, "modules"), { recursive: true })
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ package_version: version }))
  fs.writeFileSync(path.join(folder, "modules", "dualinput.wasm"), `bench ${version}`)
}

export type DesktopOptions = {
  /** A feed folder or address in place of our repository's, or the run's empty feed. */
  feed?: string
  /** Settings for the cores the app starts, beside the bench's own. */
  settings?: Record<string, unknown>
}

/** The run's stand-in install, its pilot's data folder, and its packages folder. */
export class DesktopBench {
  readonly root: string
  readonly current: string
  readonly data: string
  readonly packages: string
  readonly community: string
  private readonly run: BenchRun
  private readonly apps: DesktopApp[] = []
  private readonly sims: ChildProcess[] = []

  constructor(run: BenchRun, options: DesktopOptions = {}) {
    this.run = run
    this.root = path.join(run.folder, "DualInput")
    this.current = path.join(this.root, "current")
    this.data = path.join(run.folder, "pilot")
    this.packages = path.join(run.folder, "Packages")
    this.community = path.join(this.packages, "Community")
    fs.mkdirSync(this.current, { recursive: true })
    fs.copyFileSync(benchDesktop(), path.join(this.current, "dualinput-desktop.exe"))
    // The sim edge's build script copies SimConnect.dll beside the core, which a bench core loads too.
    const core = benchCore()
    fs.copyFileSync(core, path.join(this.current, "dualinput-core.exe"))
    const simConnect = path.join(path.dirname(core), "SimConnect.dll")
    if (fs.existsSync(simConnect)) fs.copyFileSync(simConnect, path.join(this.current, "SimConnect.dll"))
    fs.writeFileSync(path.join(this.current, "sq.version"), manifest(VERSION))
    // Velopack's locator finds an install by the Update.exe above `current\`. No case here
    // applies an update, so this one never runs; a copy of where.exe exits at once if it did.
    fs.copyFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "where.exe"), path.join(this.root, "Update.exe"))
    layOutPackage(path.join(this.current, "dualinput"), VERSION)
    fs.mkdirSync(this.community, { recursive: true })
    const cfg = path.join(run.folder, "UserCfg.opt")
    fs.writeFileSync(cfg, `Version 1\r\nInstalledPackagesPath "${this.packages}"\r\n`)
    fs.mkdirSync(this.data, { recursive: true })
    const feed = options.feed ?? writeFeed(path.join(run.folder, "feed"), [VERSION])
    // The apps end first, since an app would start a core the run's end kills again.
    run.atEnd(() => this.end())
    this.settings({ ...benchSettings(), "sim.user-cfg": cfg, "desktop.update-feed": feed, ...options.settings })
  }

  /** Writes `settings` over the data folder's settings.json, as a developer edits it. */
  settings(settings: Record<string, unknown>): void {
    const file = path.join(this.data, "settings.json")
    const held = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>) : {}
    fs.writeFileSync(file, JSON.stringify({ ...held, ...settings }, null, 2))
  }

  /** Starts the desktop app from the install, as the Run value does at login, with `--tray`, so no window takes the screen. */
  async app(): Promise<DesktopApp> {
    const port = await freePort()
    this.settings({ "desktop.port": port })
    const app = DesktopApp.start(path.join(this.current, "dualinput-desktop.exe"), this.data, port)
    this.apps.push(app)
    return app
  }

  /** Starts a stub named as the sim's process, a copy of ping that runs for 10 minutes. */
  sim(): ChildProcess {
    const stub = path.join(this.run.folder, SIM)
    if (!fs.existsSync(stub)) fs.copyFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "PING.EXE"), stub)
    const sim = spawn(stub, ["-n", "600", "127.0.0.1"], { stdio: "ignore" })
    this.sims.push(sim)
    return sim
  }

  /** The version our package in Community says it is, or null when there's none. */
  installed(): string | null {
    const manifest = path.join(this.community, "dualinput", "manifest.json")
    if (!fs.existsSync(manifest)) return null
    return (JSON.parse(fs.readFileSync(manifest, "utf8")) as { package_version: string }).package_version
  }

  /** Ends every app and stub still running, and any core an app started. */
  async end(): Promise<void> {
    for (const app of this.apps) await app.kill()
    for (const sim of this.sims) await ended(sim)
    const port = path.join(this.data, "port.json")
    if (fs.existsSync(port)) {
      const pid = (JSON.parse(fs.readFileSync(port, "utf8")) as { process: number }).process
      kill(pid)
    }
  }
}

/** Ends `child` at once if it's still running, and waits until it has. */
export async function ended(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const gone = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  child.kill()
  await gone
}

/** Ends the process `pid` at once, as a crash would, if it runs. */
export function kill(pid: number): void {
  try {
    process.kill(pid)
  } catch {
    // It had already exited.
  }
}

/** Whether the process `pid` runs. */
export function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A desktop app the bench started, which it reads through its log and its local port. */
export class DesktopApp {
  readonly process: ChildProcess
  readonly exited: Promise<number | null>
  readonly data: string
  readonly port: number

  private constructor(process: ChildProcess, data: string, port: number) {
    this.process = process
    this.data = data
    this.port = port
    this.exited = new Promise((resolve) => process.once("exit", (code) => resolve(code)))
  }

  static start(program: string, data: string, port: number, args = ["--tray"]): DesktopApp {
    const out = fs.openSync(path.join(data, "..", `desktop-${Date.now()}-output.txt`), "w")
    const child = spawn(program, [...args, "--data", data], { stdio: ["ignore", out, out] })
    fs.closeSync(out)
    return new DesktopApp(child, data, port)
  }

  /** The app's log, `desktop.log` in its data folder's `app\`. */
  log(): string {
    const file = path.join(this.data, "app", "desktop.log")
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  }

  /** How many lines the log holds, to wait for a line after them with `hear`. */
  lines(): number {
    return this.log().split(/\r?\n/).filter(Boolean).length
  }

  /** Waits until the log says `wanted` after its first `after` lines, and returns that line. */
  async hear(wanted: RegExp, { after = 0, ms = 10_000 } = {}): Promise<string> {
    const until = performance.now() + ms
    for (;;) {
      const found = this.log().split(/\r?\n/).filter(Boolean).slice(after).find((line) => wanted.test(line))
      if (found) return found
      if (performance.now() > until) throw new Error(`the desktop app didn't log ${wanted} within ${ms}ms; its log:\n${this.log()}`)
      await sleep(25)
    }
  }

  /** The process of the core the app started, from its log line after `after`. */
  async started({ after = 0, ms = 10_000 } = {}): Promise<number> {
    const line = await this.hear(/started the core, as process (\d+)/, { after, ms })
    return Number(/as process (\d+)/.exec(line)![1])
  }

  /** The core the app started as `pid`, reached through its bench socket. */
  async core(pid: number): Promise<Core> {
    return Core.attach(this.data, pid)
  }

  /** Opens the app's local port as the EFB app does, and gives what it says and a way to ask. */
  async link(): Promise<DesktopLink> {
    return DesktopLink.open(this.port)
  }

  async kill(): Promise<void> {
    await ended(this.process)
  }
}

/** The EFB app's side of the local port. */
export class DesktopLink {
  readonly states: DesktopState[] = []
  private readonly ws: WebSocket

  private constructor(ws: WebSocket) {
    this.ws = ws
    ws.addEventListener("message", (event) => this.states.push(JSON.parse(String(event.data)) as DesktopState))
  }

  static async open(port: number): Promise<DesktopLink> {
    const until = performance.now() + 10_000
    for (;;) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: SIM_ORIGIN } } as unknown as string[])
      const opened = await new Promise<boolean>((resolve) => {
        ws.addEventListener("open", () => resolve(true))
        ws.addEventListener("error", () => resolve(false))
      })
      if (opened) return new DesktopLink(ws)
      if (performance.now() > until) throw new Error(`the desktop app's local port ${port} didn't open within 10s`)
      await sleep(100)
    }
  }

  ask(ask: ToDesktop): void {
    this.ws.send(JSON.stringify(ask))
  }

  /** Waits until the app says a state `wanted` takes, and returns it. */
  async until(wanted: (state: DesktopState) => boolean, what: string, ms = 10_000): Promise<DesktopState> {
    const until = performance.now() + ms
    for (;;) {
      const found = this.states.find(wanted)
      if (found) return found
      if (performance.now() > until) throw new Error(`the desktop app didn't say ${what} within ${ms}ms; it said ${JSON.stringify(this.states)}`)
      await sleep(25)
    }
  }

  close(): void {
    this.ws.close()
  }
}

/**
 * The PowerShell that prints a process's CPU time in ms from the cycles Windows counts for it, over the processor's base
 * clock, at which its cycle counter runs. `TotalProcessorTime` can't judge an app this quiet: Windows charges it a whole
 * 15.625ms tick at a time, to whichever thread runs as the clock interrupt fires, so an app working in 1ms bursts read 5 to
 * 9 ticks over the same quiet minute, 0.130% to 0.234% of a core around a 0.2% budget (measured on our development
 * machine, 2026-11-11, record/areas/install/log.md, "2026-11-11: The bench read the desktop app's CPU in whole 15.6ms
 * clock ticks; read from cycles, the app uses 0.14% to 0.15% of a core").
 */
const CPU_MS = (pid: number) => `
Add-Type -Namespace DualInputBench -Name Cycles -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool QueryProcessCycleTime(IntPtr process, out ulong cycles);'
$cycles = [uint64]0
if (-not [DualInputBench.Cycles]::QueryProcessCycleTime((Get-Process -Id ${pid}).Handle, [ref]$cycles)) { throw 'QueryProcessCycleTime failed' }
$mhz = (Get-ItemProperty 'HKLM:\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0').'~MHz'
$cycles / ($mhz * 1000)`

/** The private working set of `pid` in bytes, Task Manager's Memory column, and its CPU time in ms. */
export function figures(pid: number): { memory: number; cpuMs: number } {
  const encoded = Buffer.from(CPU_MS(pid), "utf16le").toString("base64")
  const cpu = spawnSync("powershell", ["-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" })
  const cpuMs = Number(cpu.stdout.trim())
  assert.ok(Number.isFinite(cpuMs) && cpuMs >= 0, `the app's CPU didn't read: ${cpu.stdout}${cpu.stderr}`)
  const set = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", `(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "IDProcess=${pid}").WorkingSetPrivate`],
    { encoding: "utf8" },
  )
  const memory = Number(set.stdout.trim())
  assert.ok(Number.isFinite(memory) && memory > 0, `the app's memory didn't read: ${set.stdout}${set.stderr}`)
  return { memory, cpuMs }
}
