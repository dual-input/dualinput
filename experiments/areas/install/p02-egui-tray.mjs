/*
 * p02: what a Rust tray app costs all day with an egui window for its few
 * screens, such as the performance history's graph, measured as p01 measured
 * Tauri's, so the tray app can drop Tauri if the EFB app is Dual Input's only
 * window (user, 2026-10-25). Needs no sim.
 *
 *   node experiments/areas/install/p02-egui-tray.mjs [--glow]
 *
 * Build the app first, in egui-tray/app: `cargo build --release` for eframe's
 * default renderer, wgpu, or `cargo build --release --no-default-features
 * --features glow --target-dir target-glow` for OpenGL, which --glow measures.
 *
 * It serves a WebSocket on 127.0.0.1, starts the app with the port as its
 * argument, and waits for the app to connect. Then it measures four states,
 * each after 15s to settle and again after 60s idle: the tray alone; a window
 * open, showing a static graph; the window hidden; and the window closed. Memory
 * and CPU are read as p01 read them, and each process's GPU memory too, from
 * Windows' GPU Process Memory counters, since egui draws on the GPU and Task
 * Manager's memory leaves GPU memory out. The window opens on the desktop for
 * about two and a half minutes.
 */

import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"

import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const GLOW = process.argv.includes("--glow")
const HERE = path.join(REPO, "experiments", "areas", "install", "egui-tray")
const EXE = path.join(HERE, "app", GLOW ? "target-glow" : "target", "release", "p02-egui-tray.exe")
const CONNECT_MS = 30_000
const SETTLE_MS = 15_000
const IDLE_MS = 60_000

const mb = (b) => (b / 1048576).toFixed(1)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ps = (script) => execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", maxBuffer: 64 << 20 })

if (!fs.existsSync(EXE)) {
  console.log(`not built: see the comment at the top of ${repoRelative(path.join(REPO, "experiments", "areas", "install", "p02-egui-tray.mjs"))}`)
  process.exit(1)
}

// The server: a minimal WebSocket handshake, then text frames both ways, as p01's.
let socket = null
const replies = []
const server = createServer((req, res) => { res.writeHead(404); res.end() })
server.on("upgrade", (req, s) => {
  const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")
  s.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  s.on("error", () => { /* the app was killed */ })
  s.on("data", (buf) => { const text = readText(buf); if (text !== null) replies.push(text) })
  socket = s
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const port = server.address().port

// One masked client frame of under 126 bytes, which is all the app sends.
function readText(buf) {
  if (buf.length < 2 || (buf[0] & 0x0f) !== 1) return null
  const len = buf[1] & 0x7f
  const mask = buf.subarray(2, 6)
  const data = buf.subarray(6, 6 + len)
  return Buffer.from(data.map((b, i) => b ^ mask[i % 4])).toString("utf8")
}

function send(text) {
  const data = Buffer.from(text, "utf8")
  socket.write(Buffer.concat([Buffer.from([0x81, data.length]), data]))
}

async function command(cmd) {
  const before = replies.length
  send(cmd)
  const t0 = Date.now()
  while (replies.length === before && Date.now() - t0 < 10_000) await sleep(50)
  return replies[before] ?? "no reply in 10s"
}

// The app and every process under it by ParentProcessId.
function processesOf(root) {
  const all = JSON.parse(ps(`ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = $_.Name } })`))
  const tree = new Set([root])
  for (let grew = true; grew;) {
    grew = false
    for (const p of all) if (tree.has(p.ppid) && !tree.has(p.pid)) { tree.add(p.pid); grew = true }
  }
  return all.filter((p) => tree.has(p.pid))
}

// Task Manager's memory (the private working set), the working set, private
// bytes, CPU time, and dedicated and shared GPU memory, for each process.
function sample(root) {
  const picked = processesOf(root)
  if (!picked.length) return []
  const out = ps(`
$ids = @(${picked.map((p) => p.pid).join(",")})
$perf = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $ids -contains $_.IDProcess })
$gpu = @()
try { $gpu = @((Get-Counter '\\GPU Process Memory(*)\\Dedicated Usage', '\\GPU Process Memory(*)\\Shared Usage' -ErrorAction Stop).CounterSamples) } catch {}
$rows = foreach ($id in $ids) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p) { $pf = $perf | Where-Object { $_.IDProcess -eq $id } | Select-Object -First 1
  $mine = @($gpu | Where-Object { $_.InstanceName -like "pid_$($id)_*" })
  $ded = ($mine | Where-Object { $_.Path -like '*dedicated usage' } | Measure-Object -Property CookedValue -Sum).Sum
  $sh = ($mine | Where-Object { $_.Path -like '*shared usage' } | Measure-Object -Property CookedValue -Sum).Sum
  [pscustomobject]@{ pid = $id; pws = $(if ($pf) { [int64]$pf.WorkingSetPrivate } else { -1 }); ws = $p.WorkingSet64; priv = $p.PrivateMemorySize64; cpu = $p.TotalProcessorTime.TotalMilliseconds; gpuDed = [int64]$ded; gpuShared = [int64]$sh } } }
ConvertTo-Json -Compress -InputObject @($rows)`)
  const mem = JSON.parse(out)
  return picked.flatMap((p) => {
    const m = mem.find((x) => x.pid === p.pid)
    return m ? [{ ...p, ...m }] : []
  })
}

const sum = (procs, k) => procs.reduce((s, p) => s + p[k], 0)
const mem = (procs) => `Task Manager's memory ${mb(sum(procs, "pws"))} MB, working set ${mb(sum(procs, "ws"))} MB, private bytes ${mb(sum(procs, "priv"))} MB, GPU memory ${mb(sum(procs, "gpuDed"))} MB dedicated and ${mb(sum(procs, "gpuShared"))} MB shared`

async function measure(label, root) {
  await sleep(SETTLE_MS)
  const first = sample(root)
  await sleep(IDLE_MS)
  const last = sample(root)
  const cpuMs = last.reduce((s, p) => s + p.cpu - (first.find((b) => b.pid === p.pid)?.cpu ?? 0), 0)
  const n = last.length
  const lines = [`- ${label}: ${n} process${n === 1 ? "" : "es"}; after ${SETTLE_MS / 1000}s settling: ${mem(first)}; after ${IDLE_MS / 1000}s idle: ${mem(last)}; CPU over the ${IDLE_MS / 1000}s ${(cpuMs / IDLE_MS * 100).toFixed(2)}% of one processor (${cpuMs.toFixed(0)}ms)`]
  for (const p of last) {
    const c = p.cpu - (first.find((b) => b.pid === p.pid)?.cpu ?? 0)
    lines.push(`  - ${p.name} (${p.pid}): Task Manager's memory ${mb(p.pws)} MB, working set ${mb(p.ws)} MB, private bytes ${mb(p.priv)} MB, GPU ${mb(p.gpuDed)} MB dedicated and ${mb(p.gpuShared)} MB shared, CPU ${c.toFixed(0)}ms`)
  }
  console.log(lines[0])
  return lines
}

const tool = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: "utf8" }).trim().split("\n")[0] } catch { return "?" } }
const lock = fs.readFileSync(path.join(HERE, "app", "Cargo.lock"), "utf8")
const crate = (name) => lock.match(new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = "([^"]+)"`))?.[1] ?? "?"
const crates = ["eframe", "egui", "egui_plot", GLOW ? "glow" : "wgpu", "winit", "tray-icon", "tungstenite"].map((c) => `${c} ${crate(c)}`).join(", ")
const gpus = (() => { try { return ps("(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + ' (driver ' + $_.DriverVersion + ')' }) -join '; '").trim() } catch { return "?" } })()

const child = spawn(EXE, [String(port)], { stdio: "ignore", windowsHide: false })
let exited = null
child.on("exit", (code) => { exited = code })
const t0 = Date.now()
while (!socket && Date.now() - t0 < CONNECT_MS && exited === null) await sleep(100)
const sections = []
if (!socket) {
  sections.push(`- The app never connected${exited !== null ? `; it exited with ${exited}` : ""}.`)
} else {
  sections.push(`- The app connected ${((Date.now() - t0) / 1000).toFixed(1)}s after start.`)
  sections.push(...await measure("The tray icon alone, no window ever opened", child.pid))
  sections.push(`- open: ${await command("open")}`)
  sections.push(...await measure("A window open, showing a static graph", child.pid))
  sections.push(`- hide: ${await command("hide")}`)
  sections.push(...await measure("The window hidden", child.pid))
  sections.push(`- show: ${await command("show")}; close: ${await command("close")}`)
  sections.push(...await measure("The window closed, the tray icon left", child.pid))
  sections.push(`- Still running at the end: the app ${exited === null ? "yes" : `no, exited with ${exited}`}.`)
}
for (const p of processesOf(child.pid)) try { execFileSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore" }) } catch { /* gone */ }
socket?.destroy()
server.close()

const lines = [
  `p02-egui-tray, ${new Date().toISOString()}`,
  `Windows ${os.release()}, ${os.cpus().length} logical processors; Node ${process.version}; ${tool("rustc", ["--version"])}`,
  `Crates, from egui-tray/app/Cargo.lock: ${crates}; renderer ${GLOW ? "glow (OpenGL)" : "wgpu, eframe's default"}; built with cargo build --release, LTO on and symbols stripped; the program is ${mb(fs.statSync(EXE).size)} MB`,
  `GPU: ${gpus}`,
  `Each state: ${SETTLE_MS / 1000}s to settle, sampled, ${IDLE_MS / 1000}s idle, sampled. CPU is the processor time the app's processes used during the idle ${IDLE_MS / 1000}s.`,
  `Processes: the app's and every process under it by ParentProcessId.`,
  "",
  ...sections,
]
const text = lines.join("\n")
console.log(`\n${text}`)
console.log(`saved ${repoRelative(saveResult("install", GLOW ? "p02-egui-tray-glow" : "p02-egui-tray", text))}`)
process.exit(0)
