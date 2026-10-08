/*
 * p01: what a process that shows only a tray icon costs, idle, in each runtime
 * the watcher could run in (architecture plan, node 1.3.1). Needs no sim.
 *
 *   node experiments/areas/architecture/p01-tray-runtimes.mjs
 *
 * Build the programs in tray/ first: `cargo build --release` in tray/rust, and
 * `dotnet publish -c Release -o out` in tray/winforms and tray/aot, with the
 * Visual Studio Installer folder on PATH for the Native AOT link. Electron is
 * fsc-editor's (../fsc-editor/node_modules/electron), as p16 uses.
 *
 * Each program starts, says TRAY once its icon is in place, settles for 15s,
 * then idles for 60s. Memory is read at the end of the 60s, and CPU is the
 * processor time used during them, for the program and every process it
 * started, as Task Manager would add them up.
 */

import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"

import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const HERE = path.join(REPO, "experiments", "areas", "architecture")
const TRAY = path.join(HERE, "tray")
const ELECTRON_DIR = path.join(REPO, "..", "fsc-editor", "node_modules", "electron")
const ELECTRON = path.join(ELECTRON_DIR, "dist", "electron.exe")
const SETTLE_MS = 15_000
const IDLE_MS = 60_000

const runs = [
  { what: "Node, no tray (reference)", exe: process.execPath, args: ["-e", "console.log('TRAY'); setInterval(() => {}, 1 << 30)"], ship: [process.execPath] },
  { what: "Electron main process", exe: ELECTRON, args: [path.join(TRAY, "electron", "main.cjs")], ship: [path.dirname(ELECTRON)] },
  { what: ".NET WinForms, self-contained", exe: path.join(TRAY, "winforms", "out", "p01-tray-winforms.exe"), args: [] },
  { what: ".NET Native AOT, Win32", exe: path.join(TRAY, "aot", "out", "p01-tray-aot.exe"), args: [] },
  { what: "Rust, Win32", exe: path.join(TRAY, "rust", "target", "release", "p01-tray-rust.exe"), args: [] },
]

// Every process under root, with its memory as Task Manager shows it (the
// private working set), its working set, its private bytes, and its CPU time.
function sample(root) {
  const ps = `
$ids = @(${root}); $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
do { $n = $ids.Count; foreach ($p in $all) { if ($ids -contains $p.ParentProcessId -and -not ($ids -contains $p.ProcessId)) { $ids += $p.ProcessId } } } while ($ids.Count -ne $n)
$perf = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $ids -contains $_.IDProcess })
$rows = foreach ($id in $ids) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p) { $pf = $perf | Where-Object { $_.IDProcess -eq $id } | Select-Object -First 1
  [pscustomobject]@{ pid = $id; name = $p.ProcessName; pws = $(if ($pf) { [int64]$pf.WorkingSetPrivate } else { -1 }); ws = $p.WorkingSet64; priv = $p.PrivateMemorySize64; cpu = $p.TotalProcessorTime.TotalMilliseconds } } }
ConvertTo-Json -Compress -InputObject @($rows)`
  const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8" })
  return JSON.parse(out)
}

const mb = (b) => (b / 1048576).toFixed(1)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function sizeOf(p) {
  const st = fs.statSync(p)
  if (!st.isDirectory()) return st.size
  return fs.readdirSync(p).reduce((sum, f) => sum + sizeOf(path.join(p, f)), 0)
}

async function measure(run) {
  if (!fs.existsSync(run.exe)) return { ...run, error: "not built" }
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(run.exe, run.args, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  let err = ""
  child.stderr.on("data", (d) => { err += d })
  const tray = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 20_000)
    createInterface({ input: child.stdout }).on("line", (l) => { if (l.trim() === "TRAY") { clearTimeout(t); resolve(true) } })
    child.on("exit", () => { clearTimeout(t); resolve(false) })
  })
  if (!tray) { try { child.kill() } catch { /* gone */ } return { ...run, error: `no TRAY line; ${err.trim().slice(0, 300)}` } }
  await sleep(SETTLE_MS)
  const before = sample(child.pid)
  await sleep(IDLE_MS)
  const after = sample(child.pid)
  try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }) } catch { /* gone */ }
  const cpuMs = after.reduce((sum, p) => sum + p.cpu - (before.find((b) => b.pid === p.pid)?.cpu ?? 0), 0)
  return { ...run, procs: after, cpuMs }
}

const electronVersion = JSON.parse(fs.readFileSync(path.join(ELECTRON_DIR, "package.json"), "utf8")).version
const tool = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: "utf8" }).trim().split("\n")[0] } catch { return "?" } }
const lines = [
  `p01-tray-runtimes, ${new Date().toISOString()}`,
  `Windows ${os.release()}, ${os.cpus().length} logical processors; Node ${process.version}, Electron ${electronVersion}, .NET SDK ${tool("dotnet", ["--version"])}, ${tool("rustc", ["--version"])}`,
  `Each: ${SETTLE_MS / 1000}s to settle after its icon appeared, then ${IDLE_MS / 1000}s idle. Memory at the end; CPU over the ${IDLE_MS / 1000}s, as a share of one processor.`,
  "",
]
for (const run of runs) {
  process.stdout.write(`${run.what}... `)
  const r = await measure(run)
  if (r.error) { lines.push(`- ${r.what}: ${r.error}`, ""); console.log(r.error); continue }
  const sum = (k) => r.procs.reduce((s, p) => s + p[k], 0)
  const disk = (run.ship ?? [run.exe]).reduce((s, p) => s + sizeOf(p), 0)
  const summary = `${r.procs.length} process${r.procs.length === 1 ? "" : "es"}, Task Manager's memory ${mb(sum("pws"))} MB, working set ${mb(sum("ws"))} MB, private bytes ${mb(sum("priv"))} MB, CPU ${(r.cpuMs / IDLE_MS * 100).toFixed(2)}% (${r.cpuMs.toFixed(0)}ms), ${mb(disk)} MB on disk`
  console.log(summary)
  lines.push(`- ${r.what}: ${summary}`)
  for (const p of r.procs) lines.push(`  - ${p.name} (${p.pid}): Task Manager's memory ${mb(p.pws)} MB, working set ${mb(p.ws)} MB, private bytes ${mb(p.priv)} MB`)
  lines.push("")
}
const text = lines.join("\n")
console.log(`\n${text}`)
console.log(`saved ${repoRelative(saveResult("architecture", "p01-tray-runtimes", text))}`)
