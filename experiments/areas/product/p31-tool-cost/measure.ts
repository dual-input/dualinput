/*
 * What p31 measures in one window of a run: the sim's frame times from PresentMon, each process's
 * CPU and memory from a sampler, the bytes each process sends and receives from the kernel's
 * network events, and whether the sim kept the focus, since MSFS 2024 draws fewer frames without it.
 *
 * PresentMon and the network trace both start an ETW session, which Windows allows only an elevated
 * process, so a run needs a terminal opened as administrator. Nothing here touches the sim: no
 * inspector, no SimConnect, so the window measures the tools and nothing of ours.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import { setTimeout as sleep } from "node:timers/promises"

import { Failed } from "../../../../tools/lib/run.ts"
import { WORK } from "./places.ts"

// The PresentMon that NVIDIA's FrameView SDK installs exits 1 without a word on every capture, live
// or from a trace file, elevated or not, so it runs only inside FrameView (measured on our
// development machine, 2026-11-18, where all six runs of the first schedule got no frames).
// Intel's own release runs on its own and says what's wrong when it can't.
export const PRESENTMON = path.join(WORK, "PresentMon-2.6.0-x64.exe")
export const PRESENTMON_URL = "https://github.com/GameTechDev/PresentMon/releases/download/v2.6.0/PresentMon-2.6.0-x64.exe"
export const SIM_EXE = "FlightSimulator2024.exe"
const FRAMES_SESSION = "DualInputP31Frames"
const NETWORK_SESSION = "DualInputP31Net"
/** How often the sampler reads the tracked processes and the window in front, in ms. */
const SAMPLE_EVERY_MS = 2_000

function powershell(script: string): ChildProcess {
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  return spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { stdio: ["ignore", "pipe", "pipe"] })
}

function powershellSync(script: string): string {
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { encoding: "utf8", maxBuffer: 1 << 28 })
  if (result.status !== 0) throw new Failed(`a PowerShell step failed: ${result.stderr.trim().slice(0, 500)}`)
  return result.stdout
}

export function elevated(): boolean {
  return powershellSync("([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)").trim() === "True"
}

export type Proc = { pid: number; parent: number; name: string; path: string | null }

/** Every process now but the PowerShell that lists them, with its parent and program, for telling which process is whose. */
export function processes(): Proc[] {
  const json = powershellSync("Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID } | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath | ConvertTo-Json -Compress")
  return (JSON.parse(json) as { ProcessId: number; ParentProcessId: number; Name: string; ExecutablePath: string | null }[]).map((p) => ({ pid: p.ProcessId, parent: p.ParentProcessId, name: p.Name, path: p.ExecutablePath }))
}

/** `root` and every process descended from it. */
export function tree(all: Proc[], root: number): Proc[] {
  const found = all.filter((p) => p.pid === root)
  for (let i = 0; i < found.length; i++) found.push(...all.filter((p) => p.parent === found[i]!.pid && !found.includes(p)))
  return found
}

/** Each process's CPU time in ms, by process ID, as Windows counts it. A process that refuses to say reads nothing. */
function cpuTimes(): Map<number, { name: string; ms: number }> {
  const text = powershellSync(`Get-Process | ForEach-Object { try { "$($_.Id)\`t$($_.ProcessName)\`t$($_.TotalProcessorTime.TotalMilliseconds)" } catch { } }`)
  const times = new Map<number, { name: string; ms: number }>()
  for (const line of text.split(/\r?\n/)) {
    const [pid, name, ms] = line.split("\t")
    if (pid && name && ms) times.set(Number(pid), { name, ms: Number(ms) })
  }
  return times
}

/** A process outside the run's that used this share of one core or more counts as busy, enough to take time from the sim. */
export const BUSY_PERCENT = 10

/** The processes outside `ours` that used `BUSY_PERCENT` of one core or more over `ms`, busiest first. */
export async function othersBusy(ours: Set<number>, ms = 10_000): Promise<{ pid: number; name: string; cpuPercent: number }[]> {
  const before = cpuTimes()
  const t0 = performance.now()
  await sleep(ms)
  const after = cpuTimes()
  const wall = performance.now() - t0
  return [...after]
    .filter(([pid, { name }]) => !ours.has(pid) && name !== "Idle")
    .map(([pid, { name, ms: used }]) => ({ pid, name, cpuPercent: ((used - (before.get(pid)?.ms ?? used)) / wall) * 100 }))
    .filter((p) => p.cpuPercent >= BUSY_PERCENT)
    .sort((a, b) => b.cpuPercent - a.cpuPercent)
}

export type Tracked = { role: string; pid: number; name: string }

export type ProcessResult = Tracked & {
  /** CPU over the window, as a percentage of one logical core. */
  cpuPercent: number | null
  workingSetMeanMB: number | null
  workingSetMaxMB: number | null
  privateMeanMB: number | null
  privateMaxMB: number | null
  /** Ended during the window. */
  exited: boolean
}

export type FrameStats = {
  frames: number
  fps: number
  p50: number
  p95: number
  p99: number
  max: number
  /** Frames over 50ms, a hitch a pilot sees. */
  over50ms: number
  /** The median frame time of each minute of the window, to show whether it held steady. */
  minuteP50: number[]
  /** The medians of any other timing columns this PresentMon wrote, such as the time until displayed. */
  others: Record<string, number>
  column: string
}

export type Measured = {
  started: string
  seconds: number
  frames: FrameStats | { error: string }
  processes: ProcessResult[]
  network: Record<number, { sent: number; received: number }> | { error: string }
  /** The share of samples in which the sim's window had the focus. */
  focus: number
  /** The 12 processes that took the most CPU in the window, whoever's they are. */
  busiest: { pid: number; name: string; cpuPercent: number }[]
  /** Every process's CPU together, as a percentage of the whole PC. */
  pcCpuPercent: number
  logicalCores: number
}

/**
 * Has PresentMon trace every process's frames for 3s, as a window would, and says why it couldn't,
 * or null when it could. A schedule calls it before its first run, while someone is still at the
 * terminal, so a PresentMon that can't trace stops the schedule in seconds rather than after it.
 * PresentMon exits 0 once its trace has run, and anything else when it can't start one: 1 for
 * FrameView's copy, 6 for Intel's unelevated. It writes its CSV only once a process presents, and
 * an idle desktop presented nothing in 3s on 2026-11-19, so a missing CSV fails nothing.
 */
export function presentMonWorks(folder: string): string | null {
  fs.mkdirSync(folder, { recursive: true })
  const csv = path.join(folder, "presentmon-check.csv")
  fs.rmSync(csv, { force: true })
  const ran = spawnSync(PRESENTMON, ["--output_file", csv, "--timed", "3", "--terminate_after_timed", "--no_console_stats", "--session_name", FRAMES_SESSION, "--stop_existing_session"], { encoding: "utf8", timeout: 30_000 })
  const said = `${ran.stdout ?? ""}${ran.stderr ?? ""}`.trim().slice(0, 400)
  if (ran.status !== 0) return `PresentMon couldn't trace frames in a 3s check, and exited with ${ran.status}: ${said || ran.error?.message || "nothing said"}`
  if (!fs.existsSync(csv)) return null
  const stats = frameStats(csv, null)
  return "error" in stats ? `PresentMon's 3s check: ${stats.error}` : null
}

/**
 * Measures one window of `seconds`, with the sim as `sim` and the tool's processes as `tracked`,
 * and writes PresentMon's CSV and the network trace into `folder`.
 */
export async function measure(folder: string, sim: number, tracked: Tracked[], seconds: number): Promise<Measured> {
  fs.mkdirSync(folder, { recursive: true })
  const csv = `${folder}\\frames.csv`
  const etl = `${folder}\\network.etl`
  const started = new Date().toISOString()

  spawnSync("logman", ["stop", NETWORK_SESSION, "-ets"], { stdio: "ignore" })
  // 0x10 and 0x20 are the provider's IPv4 and IPv6 keywords, and its send and receive events are at level 4, informational.
  const traced = spawnSync("logman", ["start", NETWORK_SESSION, "-p", "Microsoft-Windows-Kernel-Network", "0x30", "0x4", "-o", etl, "-ets"], { encoding: "utf8" })
  const networkError = traced.status === 0 ? null : `logman didn't start the network trace: ${(traced.stdout + traced.stderr).trim()}`

  const presentmon = spawn(PRESENTMON, ["--process_name", SIM_EXE, "--output_file", csv, "--timed", String(seconds), "--terminate_after_timed", "--no_console_stats", "--session_name", FRAMES_SESSION, "--stop_existing_session"], { stdio: ["ignore", "pipe", "pipe"] })
  let presentmonSaid = ""
  presentmon.stdout!.on("data", (d: Buffer) => (presentmonSaid += d.toString()))
  presentmon.stderr!.on("data", (d: Buffer) => (presentmonSaid += d.toString()))
  // A PresentMon that can't start, such as one missing from a dry run's tree, leaves a window with no frames rather than ending the run before its tool stops.
  const presentmonEnded = new Promise<number | null>((resolve) => {
    presentmon.on("exit", resolve)
    presentmon.on("error", (error) => {
      presentmonSaid += error.message
      resolve(null)
    })
  })

  const t0 = performance.now()
  const before = cpuTimes()
  const samples = await sample([sim, ...tracked.map((t) => t.pid)], seconds)
  const after = cpuTimes()
  const wallMs = performance.now() - t0

  const presentmonCode = await Promise.race([presentmonEnded, sleep(30_000).then(() => "late" as const)])
  if (presentmonCode === "late") presentmon.kill()
  if (!networkError) spawnSync("logman", ["stop", NETWORK_SESSION, "-ets"], { stdio: "ignore" })

  const frames = fs.existsSync(csv) ? frameStats(csv) : { error: `PresentMon wrote no CSV, and exited with ${presentmonCode}: ${presentmonSaid.trim().slice(0, 400)}` }
  const network = networkError ? { error: networkError } : readNetwork(etl)

  const cores = os.availableParallelism()
  const delta = (pid: number) => {
    const [a, b] = [before.get(pid), after.get(pid)]
    return a && b ? b.ms - a.ms : null
  }
  const results: ProcessResult[] = [{ role: "the sim", pid: sim, name: SIM_EXE }, ...tracked].map((t) => {
    const mine = samples.map((r) => r.p.find((p) => p[0] === t.pid)).filter((p) => p !== undefined)
    const ws = mine.map((p) => p[1] / 2 ** 20)
    const priv = mine.map((p) => p[2] / 2 ** 20)
    const cpu = delta(t.pid)
    return {
      ...t,
      cpuPercent: cpu === null ? null : (cpu / wallMs) * 100,
      workingSetMeanMB: mean(ws),
      workingSetMaxMB: ws.length ? Math.max(...ws) : null,
      privateMeanMB: mean(priv),
      privateMaxMB: priv.length ? Math.max(...priv) : null,
      exited: !after.has(t.pid),
    }
  })
  const busiest = [...after]
    .map(([pid, { name, ms }]) => ({ pid, name, cpuPercent: ((ms - (before.get(pid)?.ms ?? ms)) / wallMs) * 100 }))
    .sort((a, b) => b.cpuPercent - a.cpuPercent)
    .slice(0, 12)
  const pcCpuPercent = ([...after].reduce((sum, [pid, { ms }]) => sum + (ms - (before.get(pid)?.ms ?? ms)), 0) / wallMs / cores) * 100
  const focus = samples.length ? samples.filter((r) => r.fg === sim).length / samples.length : 0
  return { started, seconds, frames, processes: results, network, focus, busiest, pcCpuPercent, logicalCores: cores }
}

/** One read of the sampler's: ms since it started, the process whose window is in front, and each process as [ID, working set, private bytes]. */
type Row = { t: number; fg: number; p: [number, number, number][] }

/** Reads the processes `pids` and the window in front every 2s for `seconds`, in one PowerShell, so the PC pays for one process, not one each read. */
async function sample(pids: number[], seconds: number): Promise<Row[]> {
  const script = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class DualInputP31Front {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$ids = @(${pids.join(",")})
$until = (Get-Date).AddSeconds(${seconds})
$t0 = Get-Date
while ((Get-Date) -lt $until) {
  $fg = 0
  [void][DualInputP31Front]::GetWindowThreadProcessId([DualInputP31Front]::GetForegroundWindow(), [ref]$fg)
  $p = @(Get-Process -Id $ids -ErrorAction SilentlyContinue | ForEach-Object { ,@($_.Id, $_.WorkingSet64, $_.PrivateMemorySize64) })
  [Console]::Out.WriteLine((@{ t = [int]((Get-Date) - $t0).TotalMilliseconds; fg = [int]$fg; p = $p } | ConvertTo-Json -Compress -Depth 4))
  Start-Sleep -Milliseconds ${SAMPLE_EVERY_MS}
}`
  const child = powershell(script)
  const rows: Row[] = []
  createInterface({ input: child.stdout! }).on("line", (line) => {
    try {
      const row = JSON.parse(line) as Row
      // ConvertTo-Json writes a single process's array flat, as [id, ws, private], rather than nested.
      if (row.p.length && typeof row.p[0] === "number") row.p = [row.p as unknown as [number, number, number]]
      rows.push(row)
    } catch {
      // A line that isn't a sample, such as a warning, says nothing to count.
    }
  })
  await new Promise((resolve) => child.on("exit", resolve))
  return rows
}

/** Frame times of `exe`, or of every process when it's null, from PresentMon's CSV, by the first frame-time column this PresentMon wrote. */
export function frameStats(csv: string, exe: string | null = SIM_EXE): FrameStats | { error: string } {
  const lines = fs.readFileSync(csv, "utf8").split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return { error: "PresentMon's CSV holds no frames; the sim may have had no swap chain while it ran" }
  const header = lines[0]!.split(",")
  const column = ["MsBetweenPresents", "FrameTime", "MsBetweenAppStart"].find((c) => header.includes(c))
  if (!column) return { error: `PresentMon's CSV has none of the frame-time columns this script knows: ${header.join(", ")}` }
  const at = header.indexOf(column)
  const app = header.findIndex((c) => c === "Application" || c === "ProcessName")
  // PresentMon 1.x names the time column TimeInSeconds, 2.0 CPUStartTime, both in seconds from the capture's start, and 2.6 TimeInMs, in ms.
  const time = header.findIndex((c) => c === "TimeInSeconds" || c === "CPUStartTime" || c === "TimeInMs")
  const timeScale = header[time] === "TimeInMs" ? 1 / 1000 : 1
  const otherColumns = ["MsBetweenDisplayChange", "MsUntilDisplayed", "MsInPresentAPI", "MsRenderPresentLatency", "MsGPUBusy", "MsCPUBusy"].filter((c) => header.includes(c))
  const rows = lines.slice(1).map((l) => l.split(",")).filter((r) => exe === null || app < 0 || r[app]?.toLowerCase() === exe.toLowerCase())
  const values = rows.map((r) => Number(r[at])).filter((v) => Number.isFinite(v) && v > 0)
  if (values.length < 2) return { error: `PresentMon's CSV holds no frame times for ${exe ?? "any process"}` }
  const sorted = [...values].sort((a, b) => a - b)
  const minuteP50: number[] = []
  if (time >= 0) {
    const times = rows.map((r) => Number(r[time]) * timeScale)
    const first = times[0]!
    for (let m = 0; ; m++) {
      const inMinute = rows.filter((_, i) => times[i]! - first >= m * 60 && times[i]! - first < (m + 1) * 60).map((r) => Number(r[at])).filter((v) => v > 0)
      if (!inMinute.length) break
      minuteP50.push(percentile(inMinute.sort((a, b) => a - b), 0.5))
    }
  }
  const others: Record<string, number> = {}
  for (const c of otherColumns) {
    const i = header.indexOf(c)
    const v = rows.map((r) => Number(r[i])).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b)
    if (v.length) others[c] = percentile(v, 0.5)
  }
  return {
    frames: values.length,
    fps: 1000 / mean(values)!,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1)!,
    over50ms: values.filter((v) => v > 50).length,
    minuteP50,
    others,
    column,
  }
}

/**
 * Bytes each process sent and received, by process ID, from the kernel's network events: 10 and
 * 11 for TCP over IPv4, 26 and 27 over IPv6, 42 and 43 for UDP over IPv4, and 58 and 59 over IPv6,
 * each with `PID` first and `size` second (read in the Microsoft-Windows-Kernel-Network provider's
 * manifest on our development machine, 2026-11-18). They come from the transport layer, so they
 * should count the loopback both tools use on one PC (unverified: a run where a tool's bytes read 0
 * would say they don't).
 */
export function readNetwork(etl: string): Record<number, { sent: number; received: number }> | { error: string } {
  if (!fs.existsSync(etl)) return { error: "the network trace wrote no file" }
  try {
    const text = powershellSync(`
$sent = @{}; $received = @{}
Get-WinEvent -FilterHashtable @{ Path = '${etl.replaceAll("'", "''")}'; Id = 10, 11, 26, 27, 42, 43, 58, 59 } -Oldest -ErrorAction SilentlyContinue | ForEach-Object {
  $p = [int]$_.Properties[0].Value; $n = [long]$_.Properties[1].Value
  if ($_.Id -in 10, 26, 42, 58) { $sent[$p] += $n } else { $received[$p] += $n }
}
$all = @{}
foreach ($k in @($sent.Keys) + @($received.Keys)) { $all["$k"] = @([long]$sent[$k], [long]$received[$k]) }
$all | ConvertTo-Json -Compress`)
    const read = JSON.parse(text.trim() || "{}") as Record<string, [number, number]>
    return Object.fromEntries(Object.entries(read).map(([pid, [sent, received]]) => [Number(pid), { sent, received }]))
  } catch (error) {
    return { error: (error as Error).message }
  }
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

export function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!
}
