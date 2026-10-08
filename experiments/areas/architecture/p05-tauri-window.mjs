/*
 * p05: what a Tauri 2 window costs in memory against an Electron window showing
 * the same page, and what Origin a WebSocket sends from a Tauri page, from
 * Tauri's Rust side, and from an Electron page (architecture plan, node 1.3.6).
 * Needs no sim.
 *
 *   node experiments/areas/architecture/p05-tauri-window.mjs
 *
 * Build the Tauri app first: `cargo build --release` in tauri/app. Electron is
 * fsc-editor's (../fsc-editor/node_modules/electron), as p01 and p16 use.
 *
 * It serves a WebSocket on 127.0.0.1 that completes each handshake, holds the
 * socket open, and logs the connection's Origin, as p16's server did without
 * the holding. Each app starts with its window showing tauri/page and the port
 * as its argument, and once every connection it makes has arrived, it settles
 * for 15s, is sampled, idles for 60s, and is sampled again. Memory and CPU are
 * read as p01 read them, for the app and every process it started.
 */

import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"

import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const HERE = path.join(REPO, "experiments", "areas", "architecture", "tauri")
const TAURI_EXE = path.join(HERE, "app", "target", "release", "p05-tauri-window.exe")
const ELECTRON_DIR = path.join(REPO, "..", "fsc-editor", "node_modules", "electron")
const ELECTRON = path.join(ELECTRON_DIR, "dist", "electron.exe")
const IDENTIFIER = JSON.parse(fs.readFileSync(path.join(HERE, "app", "tauri.conf.json"), "utf8")).identifier
const CONNECT_MS = 30_000
const SETTLE_MS = 15_000
const IDLE_MS = 60_000

const mb = (b) => (b / 1048576).toFixed(1)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ps = (script) => execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", maxBuffer: 64 << 20 })

// The server. Each connection's query names its client, and a page adds its
// own location.origin and user agent.
const seen = []
const sockets = new Set()
const server = createServer((req, res) => { res.writeHead(404); res.end() })
server.on("upgrade", (req, socket) => {
  const q = new URL(req.url, "http://127.0.0.1").searchParams
  seen.push({ from: q.get("from") ?? "?", origin: req.headers.origin ?? null, page: q.get("page"), ua: q.get("ua"), headers: Object.keys(req.headers) })
  const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  socket.on("error", () => { /* the app was killed */ })
  socket.on("data", () => { /* the clients send nothing this server answers */ })
  sockets.add(socket)
  socket.on("close", () => sockets.delete(socket))
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const port = server.address().port

const apps = [
  {
    what: "Tauri 2, release build",
    exe: TAURI_EXE,
    args: [String(port)],
    expect: ["tauri-page", "tauri-rust"],
    ship: [TAURI_EXE],
    // WebView2's processes may run outside the app's process tree, and a
    // process of this app's WebView2 names the app's executable or its user
    // data folder, which Tauri puts under the app's identifier.
    mine: (p) => p.name === "msedgewebview2.exe" && p.cmd !== null && (p.cmd.includes("--webview-exe-name=p05-tauri-window.exe") || p.cmd.includes(IDENTIFIER)),
  },
  {
    what: "Electron, one BrowserWindow",
    exe: ELECTRON,
    args: [path.join(HERE, "electron", "main.cjs"), String(port)],
    expect: ["electron-page"],
    ship: [path.dirname(ELECTRON)],
    mine: () => false,
  },
]

// Every process on the machine with its parent, and the command line of the
// ones that could belong to an app here.
function processes() {
  const out = ps(`
$names = @('msedgewebview2.exe', 'electron.exe', 'p05-tauri-window.exe')
$rows = foreach ($p in Get-CimInstance Win32_Process) { $named = $names -contains $p.Name
  [pscustomobject]@{ pid = [int]$p.ProcessId; ppid = [int]$p.ParentProcessId; name = $p.Name; cmd = $(if ($named) { $p.CommandLine } else { $null }); exe = $(if ($named) { $p.ExecutablePath } else { $null }) } }
ConvertTo-Json -Compress -InputObject @($rows)`)
  return JSON.parse(out)
}

// The app's processes: its own, every process under it by ParentProcessId,
// and every process outside that tree its `mine` rule claims.
function processesOf(app, root) {
  const all = processes()
  const tree = new Set([root])
  for (let grew = true; grew;) {
    grew = false
    for (const p of all) if (tree.has(p.ppid) && !tree.has(p.pid)) { tree.add(p.pid); grew = true }
  }
  const picked = all.filter((p) => tree.has(p.pid) || app.mine(p)).map((p) => ({ ...p, via: tree.has(p.pid) ? (app.mine(p) ? "tree and command line" : "tree") : "command line only" }))
  const othersWebView = all.filter((p) => p.name === "msedgewebview2.exe" && !picked.some((q) => q.pid === p.pid)).length
  return { picked, othersWebView }
}

// Task Manager's memory (the private working set), the working set, private
// bytes, and CPU time, for each process.
function sample(app, root) {
  const { picked, othersWebView } = processesOf(app, root)
  if (!picked.length) return { procs: [], othersWebView }
  const out = ps(`
$ids = @(${picked.map((p) => p.pid).join(",")})
$perf = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $ids -contains $_.IDProcess })
$rows = foreach ($id in $ids) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p) { $pf = $perf | Where-Object { $_.IDProcess -eq $id } | Select-Object -First 1
  [pscustomobject]@{ pid = $id; pws = $(if ($pf) { [int64]$pf.WorkingSetPrivate } else { -1 }); ws = $p.WorkingSet64; priv = $p.PrivateMemorySize64; cpu = $p.TotalProcessorTime.TotalMilliseconds } } }
ConvertTo-Json -Compress -InputObject @($rows)`)
  const mem = JSON.parse(out)
  const procs = picked.flatMap((p) => {
    const m = mem.find((x) => x.pid === p.pid)
    return m ? [{ ...p, ...m, kind: kindOf(p) }] : []
  })
  return { procs, othersWebView }
}

// What Chromium started the process as, from its --type and, for a utility
// process, its --utility-sub-type.
function kindOf(p) {
  if (!p.cmd) return p.name === "p05-tauri-window.exe" ? "app" : "?"
  const type = p.cmd.match(/--type=(\S+)/)?.[1]
  if (!type) return p.name === "electron.exe" ? "main" : p.name === "msedgewebview2.exe" ? "browser" : "app"
  const sub = p.cmd.match(/--utility-sub-type=(\S+)/)?.[1]
  return sub ? `${type} (${sub})` : type
}

function sizeOf(p) {
  const st = fs.statSync(p)
  if (!st.isDirectory()) return st.size
  return fs.readdirSync(p).reduce((sum, f) => sum + sizeOf(path.join(p, f)), 0)
}

function kill(pids) {
  for (const pid of pids) try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }) } catch { /* gone */ }
}

async function measure(app) {
  if (!fs.existsSync(app.exe)) return { error: "not built" }
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const before = seen.length
  // windowsHide stays off: it passes SW_HIDE in the start-up info, and a GUI
  // program's first ShowWindow uses the start-up info's value in place of its
  // own (documented, Microsoft Learn's ShowWindow page), so the window could
  // start hidden.
  const child = spawn(app.exe, app.args, { env, stdio: "ignore", windowsHide: false })
  let exited = null
  child.on("exit", (code) => { exited = code })
  child.on("error", (e) => { exited = String(e) })
  const t0 = Date.now()
  const arrived = () => app.expect.filter((from) => seen.slice(before).some((s) => s.from === from))
  while (arrived().length < app.expect.length && Date.now() - t0 < CONNECT_MS && exited === null) await sleep(100)
  const connectMs = Date.now() - t0
  if (exited !== null) return { error: `exited (${exited}) before its connections arrived`, connections: seen.slice(before) }
  await sleep(SETTLE_MS)
  const first = sample(app, child.pid)
  await sleep(IDLE_MS)
  const last = sample(app, child.pid)
  const connections = seen.slice(before)
  kill([child.pid])
  await sleep(3000)
  const left = processesOf(app, child.pid).picked.filter((p) => last.procs.some((q) => q.pid === p.pid))
  kill(left.map((p) => p.pid))
  const cpuMs = last.procs.reduce((sum, p) => sum + p.cpu - (first.procs.find((b) => b.pid === p.pid)?.cpu ?? 0), 0)
  return { first, last, cpuMs, connections, connectMs, missing: app.expect.filter((f) => !arrived().includes(f)), left }
}

// Versions: the Tauri crates as Cargo.lock pinned them, and the WebView2
// Runtime as its registry entry and its executable each give it.
const lock = fs.readFileSync(path.join(HERE, "app", "Cargo.lock"), "utf8")
const crate = (name) => lock.match(new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = "([^"]+)"`))?.[1] ?? "?"
const crates = ["tauri", "tauri-build", "tauri-runtime", "tauri-runtime-wry", "wry", "tao", "webview2-com", "tokio", "tokio-tungstenite", "tungstenite"].map((c) => `${c} ${crate(c)}`).join(", ")
const tool = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: "utf8" }).trim().split("\n")[0] } catch { return "?" } }
const webView2Registry = (() => {
  try {
    return ps(`(Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}').pv`).trim()
  } catch { return "?" }
})()
const electronVersion = JSON.parse(fs.readFileSync(path.join(ELECTRON_DIR, "package.json"), "utf8")).version

const sections = []
let webView2Exe = null
for (const app of apps) {
  process.stdout.write(`${app.what}... `)
  const r = await measure(app)
  const out = [`- ${app.what}:`]
  if (r.error) {
    console.log(r.error)
    out.push(`  ${r.error}`)
  } else {
    const sum = (procs, k) => procs.reduce((s, p) => s + p[k], 0)
    const mem = (procs) => `Task Manager's memory ${mb(sum(procs, "pws"))} MB, working set ${mb(sum(procs, "ws"))} MB, private bytes ${mb(sum(procs, "priv"))} MB`
    const disk = app.ship.reduce((s, p) => s + sizeOf(p), 0)
    const n = r.last.procs.length
    const summary = `${n} process${n === 1 ? "" : "es"}; after ${SETTLE_MS / 1000}s settling: ${mem(r.first.procs)}; after ${IDLE_MS / 1000}s idle: ${mem(r.last.procs)}; CPU over the ${IDLE_MS / 1000}s ${(r.cpuMs / IDLE_MS * 100).toFixed(2)}% of one processor (${r.cpuMs.toFixed(0)}ms); ${mb(disk)} MB on disk`
    console.log(summary)
    out.push(`  ${summary}`)
    out.push(`  Connections arrived ${(r.connectMs / 1000).toFixed(1)}s after start${r.missing.length ? `; never arrived: ${r.missing.join(", ")}` : ""}.`)
    out.push(`  Processes at the end of the idle minute, each with how it was matched to the app:`)
    for (const p of r.last.procs) {
      const firstCpu = r.first.procs.find((b) => b.pid === p.pid)?.cpu ?? 0
      out.push(`  - ${p.name} (${p.pid}), ${p.kind}, by ${p.via}: Task Manager's memory ${mb(p.pws)} MB, working set ${mb(p.ws)} MB, private bytes ${mb(p.priv)} MB, CPU ${(p.cpu - firstCpu).toFixed(0)}ms`)
    }
    const outside = r.last.procs.filter((p) => p.via === "command line only").length
    out.push(`  Outside the process tree but claimed by command line: ${outside}. Other msedgewebview2.exe processes on the machine, left out: ${r.last.othersWebView}.`)
    if (r.left.length) out.push(`  Still running 3s after taskkill /T /F, then killed: ${r.left.map((p) => `${p.name} (${p.pid}, ${p.kind})`).join(", ")}.`)
    for (const c of r.connections) {
      const engine = c.ua?.match(/(Edg|Chrome)\/[\d.]+/g)?.join(", ")
      out.push(`  - ${c.from} sent ${c.origin === null ? "no Origin" : `the Origin ${c.origin}`}${c.page ? `; the page's location.origin was ${c.page}` : ""}${engine ? `; its user agent names ${engine}` : ""}; request headers: ${c.headers.join(", ")}`)
    }
    webView2Exe ??= r.last.procs.find((p) => p.name === "msedgewebview2.exe")?.exe ?? null
  }
  out.push("")
  sections.push(...out)
}
for (const s of sockets) s.destroy()
server.close()

const webView2File = webView2Exe ? tool("powershell.exe", ["-NoProfile", "-Command", `(Get-Item '${webView2Exe}').VersionInfo.FileVersion`]) : "?"
const webView2Disk = webView2Exe ? `${mb(sizeOf(path.dirname(webView2Exe)))} MB` : "?"
const lines = [
  `p05-tauri-window, ${new Date().toISOString()}`,
  `Windows ${os.release()}, ${os.cpus().length} logical processors; Node ${process.version}; ${tool("rustc", ["--version"])}`,
  `Tauri crates, from tauri/app/Cargo.lock: ${crates}; built with plain \`cargo build --release\` and the tauri feature custom-protocol, no tauri-cli`,
  `WebView2 Runtime: ${webView2Registry} by its EdgeUpdate registry entry, ${webView2File} by msedgewebview2.exe's file version; its version folder takes ${webView2Disk}, shared by every WebView2 app and not shipped with ours`,
  `Electron ${electronVersion}, fsc-editor's`,
  `Each app: started with its window showing, waited for its connections, ${SETTLE_MS / 1000}s to settle, sampled, ${IDLE_MS / 1000}s idle, sampled, then taskkill /T /F. CPU is the processor time its processes used during the idle ${IDLE_MS / 1000}s.`,
  `Processes: the app's and every process under it by ParentProcessId; for Tauri also any msedgewebview2.exe whose command line holds --webview-exe-name=p05-tauri-window.exe or the identifier ${IDENTIFIER}, which names its user data folder.`,
  "",
  ...sections,
]
const text = lines.join("\n")
console.log(`\n${text}`)
console.log(`saved ${repoRelative(saveResult("architecture", "p05-tauri-window", text))}`)
