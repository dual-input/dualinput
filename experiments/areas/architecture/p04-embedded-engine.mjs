/*
 * p04: what QuickJS and V8, embedded in a Rust program, cost to start, hold
 * idle, and call, running a plugin and 100 profile write functions compiled
 * from TypeScript, and whether their memory and time limits stop a runaway
 * script without taking the program down (architecture plan, node 1.3.5).
 * Node's vm module runs the same bundles as a baseline. Needs no sim.
 *
 *   node experiments/areas/architecture/p04-embedded-engine.mjs
 *
 * Install esbuild once with `npm ci` in engine/. The probe compiles the
 * TypeScript in engine/ts/ with engine/build.mjs, builds engine/ with
 * `cargo build --release` (the v8 crate downloads a prebuilt V8 the first
 * time), and then runs each host in its own process:
 *
 *   1. It starts, loads the bundles, and says READY with its startup time.
 *   2. After 5s idle, the probe reads the process's memory from the OS.
 *   3. It checks the plugin, then runs 600 frames at 60Hz, each calling all
 *      100 write functions, each of which calls one host function. The probe
 *      reads the process's cycle count on each side of the frames.
 *   4. It runs each runaway (an endless loop, 256 MB of ArrayBuffers, endless
 *      recursion, endless allocation) and then 10 frames, to check that the
 *      host still runs the write functions.
 *
 * V8 runs twice, as built and with --no-turbofan, because TurboFan-compiled
 * code missed termination in the allocation runaway. Then come the extra
 * runs: V8's default ArrayBuffer allocator against the heap limit, a matrix of
 * loops under V8's watchdog, and Node's allocation runaway in vm and in a
 * worker with resourceLimits, each under p04-capped's 1 GB job.
 */

import { execFileSync, spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"

import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const ENGINE = path.join(REPO, "experiments", "areas", "architecture", "engine")
const DIST = path.join(ENGINE, "dist")
const BIN = path.join(ENGINE, "target", "release")
const exe = (name) => path.join(BIN, `${name}.exe`)
const BASELINE = path.join(ENGINE, "node", "baseline.mjs")
const SETTLE_MS = 5_000
const SESSION_MS = 180_000

const out = []
const note = (s = "") => {
  console.log(s)
  out.push(s)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mb = (b) => (b / 1048576).toFixed(1)
const f1 = (n) => (typeof n === "number" ? n.toFixed(1) : "?")
const f2 = (n) => (typeof n === "number" ? n.toFixed(2) : "?")
const hex = (code) => (code === null ? "none" : code > 0xffff ? `0x${(code >>> 0).toString(16).toUpperCase()}` : String(code))

// Build: bundles, then the Rust hosts.
const { buildBundles } = await import(pathToFileURL(path.join(ENGINE, "build.mjs")).href)
const { esbuild } = await buildBundles()
const build = spawnSync("cargo", ["build", "--release"], { cwd: ENGINE, encoding: "utf8" })
if (build.status !== 0) {
  console.error(build.stderr)
  process.exit(1)
}

// Versions.
const tool = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" }).trim().split("\n")[0]
  } catch {
    return "?"
  }
}
const lock = fs.readFileSync(path.join(ENGINE, "Cargo.lock"), "utf8")
const crate = (name) => new RegExp(`name = "${name}"\\nversion = "([^"]+)"`).exec(lock.replace(/\r/g, ""))?.[1] ?? "?"
const rate = JSON.parse(execFileSync(exe("p04-cycles"), ["rate"], { encoding: "utf8" })).cycles_per_second
const cycles = (pid) => {
  try {
    return JSON.parse(execFileSync(exe("p04-cycles"), [String(pid)], { encoding: "utf8" })).cycles
  } catch {
    return null
  }
}

// The process's memory as Task Manager shows it (the private working set), its
// working set, and its private bytes, read from the OS as p01 reads them.
function sample(pid) {
  const ps = `
$p = Get-Process -Id ${pid}
$pf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.IDProcess -eq ${pid} } | Select-Object -First 1
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ pws = $(if ($pf) { [int64]$pf.WorkingSetPrivate } else { -1 }); ws = $p.WorkingSet64; priv = $p.PrivateMemorySize64 })`
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8" }))
}

// One host process through the whole protocol; returns everything it said.
async function session(what, file, args, env = {}) {
  const t0 = performance.now()
  const child = spawn(file, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
  const r = { what, lines: {}, tests: [], stderr: "", exit: null }
  child.stderr.on("data", (d) => (r.stderr += d))
  const send = (word) => child.stdin.write(`${word}\n`)
  let c0, w0
  const timer = setTimeout(() => {
    r.timedOut = true
    child.kill()
  }, SESSION_MS)
  createInterface({ input: child.stdout }).on("line", async (line) => {
    const m = /^([A-Z_]+) (.*)$/.exec(line)
    if (!m) return
    const [, tag, json] = m
    const data = JSON.parse(json)
    if (tag === "TEST") r.tests.push(data)
    else if (tag === "START") r.started = data.test
    else r.lines[tag] = data
    if (tag === "READY") {
      r.spawnToReadyMs = performance.now() - t0
      await sleep(SETTLE_MS)
      r.os = sample(child.pid)
      send("IDLE")
    } else if (tag === "IDLE") {
      send("GO")
    } else if (tag === "FRAMES_READY") {
      c0 = cycles(child.pid)
      w0 = performance.now()
      send("BEGIN")
    } else if (tag === "FRAMES") {
      const c1 = cycles(child.pid)
      const wall = performance.now() - w0
      if (c0 !== null && c1 !== null) r.cpu = { percent: ((c1 - c0) / rate / (wall / 1000)) * 100, ms: ((c1 - c0) / rate) * 1000, wallMs: wall }
      send("CONTINUE")
    }
  })
  r.exit = await new Promise((resolve) => child.on("exit", (code) => resolve(code)))
  clearTimeout(timer)
  return r
}

// A run that prints a line or two and exits: returns its tagged lines, exit code, and stderr.
function oneShot(file, args, env = {}) {
  const res = spawnSync(file, args, { env: { ...process.env, ...env }, encoding: "utf8", timeout: 60_000, windowsHide: true })
  const lines = {}
  const tests = []
  for (const line of (res.stdout ?? "").split(/\r?\n/)) {
    const m = /^([A-Z_]+) (.*)$/.exec(line)
    if (!m) continue
    const data = JSON.parse(m[2])
    if (m[1] === "TEST") tests.push(data)
    else lines[m[1]] = data
  }
  return { lines, tests, exit: res.status, stderr: res.stderr ?? "", timedOut: res.error?.code === "ETIMEDOUT" }
}

const fatal = (stderr) =>
  stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /fatal|out of memory|FATAL ERROR/i.test(l))
    .slice(0, 2)
    .join(" / ")

const sessions = [
  await session("QuickJS-ng (rquickjs)", exe("p04-quickjs"), [DIST]),
  await session("V8 (v8 crate), as built", exe("p04-v8"), [DIST], { P04_TRACE: "1" }),
  await session("V8 (v8 crate), --no-turbofan", exe("p04-v8"), [DIST], { P04_TRACE: "1", P04_V8_FLAGS: "--no-turbofan" }),
  await session("Node vm (baseline)", process.execPath, [BASELINE, DIST]),
]

const quickjsVersion = sessions[0].lines.READY?.version ?? "?"
const v8Version = sessions[1].lines.READY?.version ?? "?"
const bundleBytes = ["plugin", "writers", "runaway"].map((n) => `${n}.js ${fs.statSync(path.join(DIST, `${n}.js`)).size} bytes`).join(", ")
note(`p04-embedded-engine, ${new Date().toISOString()}`)
note(`Windows ${os.release()}, ${os.cpus().length} logical processors; ${tool("rustc", ["--version"])}, MSVC target`)
note(`Crates: rquickjs ${crate("rquickjs")} (rquickjs-sys ${crate("rquickjs-sys")}, QuickJS-ng ${quickjsVersion}); v8 ${crate("v8")} (V8 ${v8Version}); windows-sys ${crate("windows-sys")}`)
note(`esbuild ${esbuild}; Node ${process.version} (V8 ${process.versions.v8})`)
note(`Bundles: ES2020 IIFEs from engine/ts/: ${bundleBytes}.`)
note("Frames: 600 at 60Hz; each frame calls all 100 write functions, and each call crosses into one host function (the writer's k, l, b, or h).")
note("Limits: 64 MB of memory (QuickJS's whole runtime; V8's heap, and V8's ArrayBuffers through a counting allocator) and 100ms of time per frame or runaway call; the memory runaways get 10s, so only the memory limit can stop them.")
note("Each Rust host runs in a Windows job capped at 1 GB of committed memory, and Node's allocation runaways run under p04-capped's same cap, so a limit that fails ends the process instead of filling the machine.")
note(`CPU: the process's cycle count over the frames (QueryProcessCycleTime, all threads), at ${(rate / 1e9).toFixed(2)} GHz, as a share of one core. Other builds may have been running on this machine, so CPU and timings can be noisy.`)
note()

// Summary table.
const rows = [["engine", "spawn to ready ms", "startup ms", "WS MB", "private WS MB", "private bytes MB", "frame mean us", "frame p99 us", "CPU % of a core"]]
for (const s of sessions) {
  const ready = s.lines.READY ?? {}
  const fr = s.lines.FRAMES ?? {}
  rows.push([
    s.what,
    f1(s.spawnToReadyMs),
    f2(ready.startup_ms),
    s.os ? mb(s.os.ws) : "?",
    s.os ? mb(s.os.pws) : "?",
    s.os ? mb(s.os.priv) : "?",
    f1(fr.mean_us),
    f1(fr.p99_us),
    s.cpu ? f2(s.cpu.percent) : "?",
  ])
}
const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)))
for (const [i, r] of rows.entries()) {
  note(r.map((c, j) => (j === 0 ? String(c).padEnd(widths[j]) : String(c).padStart(widths[j]))).join("  "))
  if (i === 0) note(widths.map((w) => "-".repeat(w)).join("  "))
}
note()
note("startup ms is measured inside the process, from before the engine's first call to the three bundles evaluated; spawn to ready adds the process's own start. Memory is the host process alone, 5s after READY.")
note()

// Limits, per engine.
const describeTest = (t) => `${t.threw ? "stopped" : "NOT stopped"} after ${f1(t.ms)}ms (${t.error}); the 10 frames after it ${t.host_ok ? "ran and matched" : "did NOT match"}`
note("Limits")
for (const s of sessions) {
  note(`- ${s.what}:`)
  for (const t of s.tests) note(`  - ${t.test}: ${describeTest(t)}${t.heap_limit_hits ? `; near-heap-limit callback ran ${t.heap_limit_hits} time${t.heap_limit_hits === 1 ? "" : "s"}` : ""}${t.buffer_refusals ? `; allocator refused ${t.buffer_refusals} buffer${t.buffer_refusals === 1 ? "" : "s"}` : ""}`)
  const done = new Set(s.tests.map((t) => t.test))
  if (s.started && !done.has(s.started)) {
    const hits = (s.stderr.match(/near_heap_limit hit/g) ?? []).length
    const fired = (s.stderr.match(/watchdog fired/g) ?? []).length
    note(`  - ${s.started}: the process ENDED during it, exit ${hex(s.exit)}: ${fatal(s.stderr) || s.stderr.trim().split(/\r?\n/).slice(-1)[0]}; near-heap-limit callback ran ${hits} time${hits === 1 ? "" : "s"}, watchdog fired ${fired} time${fired === 1 ? "" : "s"}`)
  }
  if (s.timedOut) note(`  - the probe stopped the process after ${SESSION_MS / 1000}s`)
}

// Node's allocation runaway, which the main baseline run leaves out.
const nodeAlloc = oneShot(exe("p04-capped"), [process.execPath, "--max-old-space-size=64", BASELINE, DIST, "alloc"])
const nodeWorker = oneShot(exe("p04-capped"), [process.execPath, BASELINE, DIST, "worker-alloc"])
note(`- Node vm, alloc, in a process started with --max-old-space-size=64: ${nodeAlloc.tests.length ? describeTest(nodeAlloc.tests[0]) : `the process ENDED, exit ${hex(nodeAlloc.exit)}: ${fatal(nodeAlloc.stderr)}`}`)
note(`- Node worker thread with resourceLimits { maxOldGenerationSizeMb: 64 }, alloc: ${nodeWorker.tests.length ? describeTest(nodeWorker.tests[0]) : `the process ENDED, exit ${hex(nodeWorker.exit)}: ${fatal(nodeWorker.stderr)}`}`)
note()

// V8's default allocator: what the heap limit alone lets through.
const da = oneShot(exe("p04-v8"), [DIST, "default-allocator"]).lines.DEFAULT_ALLOCATOR
note("V8 with the 64 MB heap limit and V8's default ArrayBuffer allocator (no counting allocator), allocBuffers(256):")
note(da ? `  ${da.result} after ${f1(da.ms)}ms; V8's external memory ${da.heap.external_mb} MB; private bytes ${da.before.private_mb} MB before, ${da.after.private_mb} MB after` : "  no result")
note()

// Which loops V8's watchdog stops, with and without TurboFan.
const loops = [
  ["keep new Array(1024), as allocForever", "const h = []; for (;;) h.push(new Array(1024).fill(h.length))"],
  ["keep new Array(1024), no fill", "const h = []; for (;;) h.push(new Array(1024))"],
  ["keep new Array(16).fill", "const h = []; for (;;) h.push(new Array(16).fill(h.length))"],
  ["keep an array literal", "const h = []; for (;;) h.push([1, 2, 3, 4, 5, 6, 7, 8])"],
  ["keep strings", "const h = []; for (;;) h.push('x'.repeat(1000) + h.length)"],
  ["keep nothing, new Array(1024).fill", "let n = 0; for (;;) n += new Array(1024).fill(n).length"],
]
note("V8 watchdog armed for 20ms, 512 MB heap, no near-heap-limit callback (if termination never lands, V8 ends the process at the heap limit):")
for (const flags of ["", "--no-turbofan"]) {
  for (const [what, script] of loops) {
    const r = oneShot(exe("p04-v8"), [DIST, "terminate", script, "20"], flags ? { P04_V8_FLAGS: flags } : {})
    const t = r.lines.TERMINATE
    const result = t ? `${t.result} after ${f1(t.ms)}ms, heap ${t.heap.used_mb} MB` : `process ENDED, exit ${hex(r.exit)}: ${fatal(r.stderr)}`
    note(`  - ${flags || "as built"}, ${what}: ${result}`)
  }
}
note()

// Everything each host said, for the record.
note("Details")
for (const s of sessions) {
  note(`- ${s.what}, exit ${hex(s.exit)}`)
  if (s.os) note(`  - OS, idle: working set ${mb(s.os.ws)} MB, private working set ${mb(s.os.pws)} MB, private bytes ${mb(s.os.priv)} MB`)
  if (s.cpu) note(`  - CPU over the frames: ${f1(s.cpu.ms)}ms of cycles in ${f1(s.cpu.wallMs)}ms`)
  for (const tag of ["WARNING", "READY", "IDLE", "PLUGIN", "FRAMES", "CHECK", "DONE", "FAILED"]) {
    if (s.lines[tag]) note(`  - ${tag} ${JSON.stringify(s.lines[tag])}`)
  }
  for (const t of s.tests) note(`  - TEST ${JSON.stringify(t)}`)
}
note(`- Node vm alloc: exit ${hex(nodeAlloc.exit)}, ${JSON.stringify(nodeAlloc.lines)} ${nodeAlloc.tests.map((t) => JSON.stringify(t)).join(" ")}`)
note(`- Node worker alloc: exit ${hex(nodeWorker.exit)}, ${JSON.stringify(nodeWorker.lines)} ${nodeWorker.tests.map((t) => JSON.stringify(t)).join(" ")}`)

console.log(`saved ${repoRelative(saveResult("architecture", "p04-embedded-engine", out.join("\n")))}`)
