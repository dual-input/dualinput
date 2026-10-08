/*
 * p04's Node baseline: the same bundles in Node's vm module, measured the way
 * the Rust hosts measure QuickJS and V8, and printing the same lines.
 *
 *   node baseline.mjs <dist folder>
 *   node --max-old-space-size=64 baseline.mjs <dist folder> alloc
 *   node baseline.mjs <dist folder> worker-alloc
 *
 * vm has no memory limit: "The node:vm module is not a security mechanism"
 * (Node.js docs, https://nodejs.org/api/vm.html). So the main run leaves out the
 * allocation runaway. The alloc form runs it alone, in a process whose V8 heap
 * is capped, to show what happens to the process. The worker-alloc form runs it
 * in a worker thread with resourceLimits, Node's own heap limit for a worker,
 * and then runs the write functions on the main thread. The runner starts both
 * forms under p04-capped, so a limit that fails can't take the machine.
 *
 * The constants are the same as engine/common/src/lib.rs, so the three hosts
 * run the same work.
 */

import fs from "node:fs"
import path from "node:path"
import { performance } from "node:perf_hooks"
import v8 from "node:v8"
import vm from "node:vm"
import { Worker } from "node:worker_threads"

const FRAMES = 600
const FRAME_MS = 1000 / 60
const WRITERS = 100
const TIME_LIMIT_MS = 100
const CHECK_FRAMES = 10
const BUFFER_MB = 256
const RUNAWAYS = [
  ["loop", "loopForever", 0, TIME_LIMIT_MS],
  ["buffers", "allocBuffers", BUFFER_MB, 10_000],
  ["recursion", "recurseForever", 0, 10_000],
]

const [dist, mode] = process.argv.slice(2)
const input = (frame, i) => ((frame * 7 + i * 13) % 200) / 2
const emit = (tag, obj) => process.stdout.write(`${tag} ${JSON.stringify(obj)}\n`)
const mb = (b) => Math.round((b / 1048576) * 100) / 100
const memory = () => {
  const m = process.memoryUsage()
  return { working_set_mb: mb(m.rss), heap_used_mb: mb(m.heapUsed), external_mb: mb(m.external + m.arrayBuffers) }
}
const heap = () => {
  const h = v8.getHeapStatistics()
  return { used_mb: mb(h.used_heap_size), total_mb: mb(h.total_heap_size), limit_mb: mb(h.heap_size_limit) }
}
// Whole 15.625ms clock ticks on Windows; the runner's cycle count is the figure
// to use (see engine/common/src/bin/cycles.rs).
const cpuMs = () => {
  const u = process.cpuUsage()
  return (u.user + u.system) / 1000
}
const sleeper = new Int32Array(new SharedArrayBuffer(4))
const sleep = (ms) => Atomics.wait(sleeper, 0, 0, ms)

// What crossed into the host from the write functions, as the Rust hosts count it.
const sink = { calls: 0, sum: 0, name_bytes: 0 }
const since = (before) => ({ calls: sink.calls - before.calls, sum: sink.sum - before.sum, name_bytes: sink.name_bytes - before.name_bytes })
const store = new Map()

// The host's functions are main-context functions, so a call from a write
// function crosses from the vm context into the main one and back.
const host = {
  read: (name) => store.get(name) ?? 0,
  write: (name, value) => void store.set(name, value),
}
const writer = {
  k(name, a, b) {
    sink.calls++
    sink.name_bytes += name.length
    if (a !== undefined) {
      sink.sum += a
      if (b !== undefined) sink.sum += b
    }
  },
  l(name, value) {
    sink.calls++
    sink.name_bytes += name.length
    sink.sum += value
  },
  b(name, value) {
    sink.calls++
    sink.name_bytes += name.length
    sink.sum += value
  },
  h(name) {
    sink.calls++
    sink.name_bytes += name.length
  },
}

function load() {
  const t0 = performance.now()
  const context = vm.createContext({ host, __writer: writer })
  const contextMs = performance.now() - t0
  const evals = {}
  for (const name of ["plugin", "writers", "runaway"]) {
    const t = performance.now()
    new vm.Script(fs.readFileSync(path.join(dist, `${name}.js`), "utf8"), { filename: `${name}.js` }).runInContext(context)
    evals[`eval_${name}_ms`] = performance.now() - t
  }
  return { context, startupMs: performance.now() - t0, contextMs, evals }
}

const writersOf = (context) => vm.runInContext("Object.keys(writersBundle).sort().map((k) => writersBundle[k])", context)

function frame(writers, f, state) {
  for (let i = 0; i < writers.length; i++) {
    try {
      writers[i](input(f, i), writer)
    } catch (e) {
      state.errors++
      state.last = String(e)
    }
  }
}

function check(context) {
  const writers = writersOf(context)
  const before = { ...sink }
  const state = { errors: 0, last: "" }
  for (let f = 0; f < CHECK_FRAMES; f++) frame(writers, f, state)
  return { delta: since(before), errors: state.errors }
}

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b)
  const at = (q) => s[Math.min(s.length, Math.max(1, Math.ceil(s.length * q))) - 1]
  return { mean_us: s.reduce((a, b) => a + b, 0) / s.length, p50_us: at(0.5), p99_us: at(0.99), max_us: s[s.length - 1] }
}

function plugin(context) {
  const p = vm.runInContext("pluginBundle.plugin", context)
  p.write.radar_range(45)
  p.write.radar_tilt(-20)
  const values = p.exports()
  const ok = values.radar_range === 40 && values.radar_tilt === -15 && store.get("RADAR_RANGE_INDEX") === 2
  const n = 1000
  let t = performance.now()
  for (let i = 0; i < n; i++) p.exports()
  const exports_us = ((performance.now() - t) * 1000) / n
  t = performance.now()
  for (let i = 0; i < n; i++) p.write.radar_range(i % 400)
  const write_us = ((performance.now() - t) * 1000) / n
  return { ok, range_nm: values.radar_range, tilt_deg: values.radar_tilt, exports_us, write_us }
}

function runaway(context, test, name, arg, limit) {
  emit("START", { test })
  const t = performance.now()
  let threw = false
  let error
  try {
    // A function call has no timeout in vm; only running a script does.
    const r = new vm.Script(`runawayBundle.${name}(${arg})`).runInContext(context, { timeout: limit })
    error = `returned ${r}`
  } catch (e) {
    threw = true
    error = `${e.code ?? e.name}: ${e.message}`
  }
  return { test, threw, error, ms: performance.now() - t }
}

function lines() {
  const queue = []
  let wake = null
  let buf = ""
  process.stdin.on("data", (d) => {
    buf += d
    let i
    while ((i = buf.indexOf("\n")) >= 0) {
      queue.push(buf.slice(0, i).trim())
      buf = buf.slice(i + 1)
      if (wake) wake()
    }
  })
  return async (word) => {
    for (;;) {
      while (queue.length) if (queue.shift() === word) return true
      await new Promise((r) => (wake = r))
    }
  }
}

async function main() {
  const loaded = load()
  const { context } = loaded
  emit("READY", {
    engine: "Node vm",
    version: `${process.version}, V8 ${process.versions.v8}`,
    startup_ms: loaded.startupMs,
    context_ms: loaded.contextMs,
    ...loaded.evals,
    process_uptime_ms: performance.now(),
    heap: heap(),
    memory: memory(),
  })
  const waitFor = lines()
  await waitFor("IDLE")
  emit("IDLE", memory())
  await waitFor("GO")

  emit("PLUGIN", plugin(context))

  const writers = writersOf(context)
  if (writers.length !== WRITERS) throw new Error(`${writers.length} write functions`)
  emit("FRAMES_READY", {})
  await waitFor("BEGIN")
  const before = { ...sink }
  const state = { errors: 0, last: "" }
  const frameUs = []
  let late = 0
  const cpu0 = cpuMs()
  const start = performance.now()
  for (let f = 0; f < FRAMES; f++) {
    const slot = start + f * FRAME_MS
    const now = performance.now()
    if (slot > now) sleep(slot - now)
    else if (now - slot > FRAME_MS) late++
    const t = performance.now()
    frame(writers, f, state)
    frameUs.push((performance.now() - t) * 1000)
  }
  const wallMs = performance.now() - start
  const cpu = cpuMs() - cpu0
  emit("FRAMES", {
    frames: frameUs.length,
    ...stats(frameUs),
    first_us: frameUs[0],
    wall_ms: wallMs,
    tick_cpu_ms: cpu,
    tick_cpu_percent: (cpu / wallMs) * 100,
    late_frames: late,
    errors: state.errors,
    sink: since(before),
    last_error: state.last,
    heap: heap(),
    memory: memory(),
  })
  await waitFor("CONTINUE")
  process.stdin.pause()

  const reference = check(context)
  emit("CHECK", reference.delta)
  for (const [test, name, arg, limit] of RUNAWAYS) {
    const r = runaway(context, test, name, arg, limit)
    const after = check(context)
    const same = after.delta.calls === reference.delta.calls && Math.abs(after.delta.sum - reference.delta.sum) < 1e-6
    emit("TEST", { ...r, host_ok: same && after.errors === 0, check: after.delta, heap: heap(), memory: memory() })
  }
  emit("DONE", memory())
}

// The allocation runaway alone, on the main thread, in vm.
function alloc() {
  const { context } = load()
  emit("READY", { heap: heap(), memory: memory() })
  const r = runaway(context, "alloc", "allocForever", 0, 10_000)
  emit("TEST", { ...r, host_ok: check(context).errors === 0, heap: heap(), memory: memory() })
}

// The allocation runaway in a worker thread with a 64 MB old generation, then
// the write functions on the main thread.
async function workerAlloc() {
  const { context } = load()
  const reference = check(context)
  emit("READY", { heap: heap(), memory: memory() })
  emit("START", { test: "alloc" })
  const t = performance.now()
  const code = `
    const { workerData } = require("node:worker_threads")
    const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm")
    const context = vm.createContext({})
    new vm.Script(fs.readFileSync(path.join(workerData, "runaway.js"), "utf8")).runInContext(context)
    vm.runInContext("runawayBundle.allocForever()", context)`
  const worker = new Worker(code, { eval: true, workerData: dist, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 } })
  const outcome = await new Promise((resolve) => {
    let error = null
    worker.on("error", (e) => (error = `${e.code ?? e.name}: ${e.message}`))
    worker.on("exit", (code) => resolve({ error, exit: code }))
  })
  const after = check(context)
  const same = after.delta.calls === reference.delta.calls && Math.abs(after.delta.sum - reference.delta.sum) < 1e-6
  emit("TEST", {
    test: "alloc",
    threw: outcome.error !== null,
    error: outcome.error ?? `worker exited ${outcome.exit}`,
    ms: performance.now() - t,
    host_ok: same && after.errors === 0,
    check: after.delta,
    heap: heap(),
    memory: memory(),
  })
  emit("DONE", memory())
}

if (mode === "alloc") alloc()
else if (mode === "worker-alloc") await workerAlloc()
else await main()
