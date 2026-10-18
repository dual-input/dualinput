/*
 * p01: what a Tauri 2 app costs all day as a tray icon, before, while, and
 * after it shows a window, so the watcher can be the desktop app (installing
 * and updating, node 6.17). Needs no sim.
 *
 *   node experiments/areas/install/p01-tauri-tray.mjs
 *
 * Build the app first: `cargo build --release` in tauri-tray/app.
 *
 * It serves a WebSocket on 127.0.0.1, starts the app with the port as its
 * argument, and waits for the app's Rust side to connect. Then it measures
 * four states, each after 15s to settle and again after 60s idle: the tray
 * alone; a window open; the window hidden; and the window destroyed. Memory and
 * CPU are read as architecture's p01 and p05 read them, for the app and every
 * process it started, WebView2's among them. The window opens on the desktop
 * for about two and a half minutes.
 */

import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"

import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const HERE = path.join(REPO, "experiments", "areas", "install", "tauri-tray")
const EXE = path.join(HERE, "app", "target", "release", "p01-tauri-tray.exe")
const IDENTIFIER = JSON.parse(fs.readFileSync(path.join(HERE, "app", "tauri.conf.json"), "utf8")).identifier
const CONNECT_MS = 30_000
const SETTLE_MS = 15_000
const IDLE_MS = 60_000

const mb = (b) => (b / 1048576).toFixed(1)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ps = (script) => execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", maxBuffer: 64 << 20 })

if (!fs.existsSync(EXE)) {
  console.log(`not built: run cargo build --release in ${repoRelative(path.join(HERE, "app"))}`)
  process.exit(1)
}

// The server: a minimal WebSocket handshake, then text frames both ways, since
// the probe only sends the app one short command at a time.
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

// One unmasked server frame, as a server sends it.
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

// Every process on the machine with its parent, and the command line of the
// ones that could belong to the app.
function processes() {
  const out = ps(`
$names = @('msedgewebview2.exe', 'p01-tauri-tray.exe')
$rows = foreach ($p in Get-CimInstance Win32_Process) { $named = $names -contains $p.Name
  [pscustomobject]@{ pid = [int]$p.ProcessId; ppid = [int]$p.ParentProcessId; name = $p.Name; cmd = $(if ($named) { $p.CommandLine } else { $null }) } }
ConvertTo-Json -Compress -InputObject @($rows)`)
  return JSON.parse(out)
}

// The app's processes: its own, every process under it by ParentProcessId, and
// any WebView2 process whose command line names the app or its identifier,
// since WebView2's processes may run outside the app's tree (architecture's p05).
function processesOf(root) {
  const all = processes()
  const tree = new Set([root])
  for (let grew = true; grew;) {
    grew = false
    for (const p of all) if (tree.has(p.ppid) && !tree.has(p.pid)) { tree.add(p.pid); grew = true }
  }
  const mine = (p) => p.name === "msedgewebview2.exe" && p.cmd !== null && (p.cmd.includes("--webview-exe-name=p01-tauri-tray.exe") || p.cmd.includes(IDENTIFIER))
  return all.filter((p) => tree.has(p.pid) || mine(p))
}

// Task Manager's memory (the private working set), the working set, private
// bytes, and CPU time, for each process.
function sample(root) {
  const picked = processesOf(root)
  if (!picked.length) return []
  const out = ps(`
$ids = @(${picked.map((p) => p.pid).join(",")})
$perf = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $ids -contains $_.IDProcess })
$rows = foreach ($id in $ids) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p) { $pf = $perf | Where-Object { $_.IDProcess -eq $id } | Select-Object -First 1
  [pscustomobject]@{ pid = $id; pws = $(if ($pf) { [int64]$pf.WorkingSetPrivate } else { -1 }); ws = $p.WorkingSet64; priv = $p.PrivateMemorySize64; cpu = $p.TotalProcessorTime.TotalMilliseconds } } }
ConvertTo-Json -Compress -InputObject @($rows)`)
  const mem = JSON.parse(out)
  return picked.flatMap((p) => {
    const m = mem.find((x) => x.pid === p.pid)
    return m ? [{ ...p, ...m, kind: kindOf(p) }] : []
  })
}

// What Chromium started the process as, from its --type and, for a utility
// process, its --utility-sub-type.
function kindOf(p) {
  if (p.name === "p01-tauri-tray.exe") return "app"
  const type = p.cmd?.match(/--type=(\S+)/)?.[1]
  if (!type) return "browser"
  const sub = p.cmd.match(/--utility-sub-type=(\S+)/)?.[1]
  return sub ? `${type} (${sub})` : type
}

const sum = (procs, k) => procs.reduce((s, p) => s + p[k], 0)
const mem = (procs) => `Task Manager's memory ${mb(sum(procs, "pws"))} MB, working set ${mb(sum(procs, "ws"))} MB, private bytes ${mb(sum(procs, "priv"))} MB`

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
    lines.push(`  - ${p.name} (${p.pid}), ${p.kind}: Task Manager's memory ${mb(p.pws)} MB, working set ${mb(p.ws)} MB, private bytes ${mb(p.priv)} MB, CPU ${c.toFixed(0)}ms`)
  }
  console.log(lines[0])
  return lines
}

const tool = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: "utf8" }).trim().split("\n")[0] } catch { return "?" } }
const lock = fs.readFileSync(path.join(HERE, "app", "Cargo.lock"), "utf8")
const crate = (name) => lock.match(new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = "([^"]+)"`))?.[1] ?? "?"
const crates = ["tauri", "tauri-runtime-wry", "wry", "tao", "tray-icon", "webview2-com", "tokio-tungstenite"].map((c) => `${c} ${crate(c)}`).join(", ")
const webView2 = (() => { try { return ps(`(Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}').pv`).trim() } catch { return "?" } })()

const child = spawn(EXE, [String(port)], { stdio: "ignore", windowsHide: false })
let exited = null
child.on("exit", (code) => { exited = code })
const t0 = Date.now()
while (!socket && Date.now() - t0 < CONNECT_MS && exited === null) await sleep(100)
const sections = []
if (!socket) {
  sections.push(`- The app's Rust side never connected${exited !== null ? `; it exited with ${exited}` : ""}.`)
} else {
  sections.push(`- The app's Rust side connected ${((Date.now() - t0) / 1000).toFixed(1)}s after start.`)
  sections.push(...await measure("The tray icon alone, no window ever opened", child.pid))
  sections.push(`- open: ${await command("open")}`)
  sections.push(...await measure("A window open, showing a static page", child.pid))
  sections.push(`- hide: ${await command("hide")}`)
  sections.push(...await measure("The window hidden", child.pid))
  sections.push(`- show: ${await command("show")}; close (destroy): ${await command("close")}`)
  sections.push(...await measure("The window destroyed, the tray icon left", child.pid))
  sections.push(`- Still running at the end: the app ${exited === null ? "yes" : `no, exited with ${exited}`}.`)
}
const left = processesOf(child.pid)
for (const p of left) try { execFileSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore" }) } catch { /* gone */ }
socket?.destroy()
server.close()

const disk = fs.statSync(EXE).size
const lines = [
  `p01-tauri-tray, ${new Date().toISOString()}`,
  `Windows ${os.release()}, ${os.cpus().length} logical processors; Node ${process.version}; ${tool("rustc", ["--version"])}`,
  `Crates, from tauri-tray/app/Cargo.lock: ${crates}; built with plain \`cargo build --release\`, the tauri features custom-protocol and tray-icon, no tauri-cli; the program is ${mb(disk)} MB`,
  `WebView2 Runtime ${webView2} by its EdgeUpdate registry entry`,
  `Each state: ${SETTLE_MS / 1000}s to settle, sampled, ${IDLE_MS / 1000}s idle, sampled. CPU is the processor time the app's processes used during the idle ${IDLE_MS / 1000}s.`,
  `Processes: the app's and every process under it by ParentProcessId, and any msedgewebview2.exe whose command line holds --webview-exe-name=p01-tauri-tray.exe or the identifier ${IDENTIFIER}.`,
  "",
  ...sections,
]
const text = lines.join("\n")
console.log(`\n${text}`)
console.log(`saved ${repoRelative(saveResult("install", "p01-tauri-tray", text))}`)
process.exit(0)
