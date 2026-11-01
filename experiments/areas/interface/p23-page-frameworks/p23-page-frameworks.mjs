/*
 * p23: whether the EFB app could draw with React or Preact rather than FSComponent, and what each costs
 * in Coherent GT. Each framework's page builds the same DOM and runs harness.ts: whether a click, a
 * controlled field, a keyed reverse, a conditional part, and a room that measures after it renders work
 * there, and how long 1,000 rows and a card-sized part take. It also times the bundle's parse and first
 * run, and runs the Coherent GT check on each bundle.
 *
 * Build p18's page first, once, by running its probe, and run p22 once, for its copy of the SDK's
 * debugger. Run `npm install` here. Then, from the repository's root:
 *
 *   node experiments/areas/interface/p23-page-frameworks/p23-page-frameworks.mjs debugger
 *   node experiments/areas/interface/p23-page-frameworks/build-efb.mjs
 *   (start the sim, load a flight, open the EFB, open the app "Dual Input P23")
 *   node experiments/areas/interface/p23-page-frameworks/p23-page-frameworks.mjs efb [--behind] [--again]
 *
 * --again takes no steps, and reads what the app kept from the steps of an earlier run, in the same
 * load of the EFB.
 *
 * debugger needs no sim. It loads each page in a frame, and FSComponent bundles the modules it needs.
 *
 * efb runs in the EFB's own document, as the product's app would. First the pilot takes three short
 * steps in the app, shown on its screen with a beep, so React gets a real click, wheel, and keys: Page
 * Down starts, and Page Up skips a step. Then it waits for the sim's window to come to the front, unless
 * --behind says to run as things are, and times React against FSComponent, which draws with the EFB's
 * own copy of the framework there. Each page loads into an element of the app's screen, and the
 * inspector closes while it runs, so it can't weigh on the timing.
 * A median of an even count is the higher middle value.
 */

import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

import * as esbuild from "esbuild"

import { startBeeper, startKeys } from "../../../tools/guide.mjs"
import { Inspector, listPages } from "../../../tools/inspector.mjs"
import { REPO, repoRelative, saveResult, stamp } from "../../../tools/results.mjs"
import { startShooter } from "../../../tools/shot.mjs"

const NAME = "p23-page-frameworks"
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, "out")
const P18 = join(REPO, "experiments", "areas", "interface", "p18-fscomponent", "out")
const HOST = join(REPO, "experiments", "areas", "interface", "p22-sdk-coherent-host", "out", "host")
const RESULTS = join(REPO, "experiments", "areas", "interface", "results")
const SIM = "FlightSimulator2024"
const FULL_WINDOW = "position:absolute;left:0;top:0;width:100%;height:100%;border:0"
// Each framework runs first, second, and third once, so order weighs on none of them.
const DEBUGGER_ORDER = ["fscomponent", "react", "preact", "react", "preact", "fscomponent", "preact", "fscomponent", "react"]
const EFB_ORDER = ["react", "fscomponent", "fscomponent", "react", "react", "fscomponent"]
const OPS = ["create", "updateOne", "updateAll", "reverse", "clear", "partOn", "partOff"]
const OP_NAMES = { create: "1,000 rows created", updateOne: "one row of 1,000 updated", updateAll: "all 1,000 updated", reverse: "1,000 rows reversed", clear: "1,000 rows cleared", partOn: "29-element part mounted in a 168-element card", partOff: "that part removed" }
const DEADMAN_MS = 300000
const STEP_MS = 25000
const STEPS = [
  { id: "click", text: "Step 1 of 3: click the blue button once." },
  { id: "wheel", text: "Step 2 of 3: scroll the list below it with the mouse wheel." },
  { id: "type", text: "Step 3 of 3: click the field and type abc." },
]

const [where] = process.argv.slice(2)
const behind = process.argv.includes("--behind")
const again = process.argv.includes("--again")

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const encoded = (script) => Buffer.from(script, "utf16le").toString("base64")

// ---------------------------------------------------------------- the bundles

const VDOM = { entryPoints: [join(HERE, "app-vdom.tsx")], jsx: "automatic", jsxImportSource: "react" }
const FSC = { entryPoints: [join(HERE, "app-fsc.tsx")], jsx: "transform", jsxFactory: "FSComponent.buildComponent", jsxFragment: "FSComponent.Fragment" }
const BUILDS = {
  react: VDOM,
  preact: { ...VDOM, alias: { react: "preact/compat", "react-dom": "preact/compat", "react-dom/client": "preact/compat/client", "react/jsx-runtime": "preact/jsx-runtime" } },
  fscomponent: { ...FSC, plugins: [{ name: "sdk-modules", setup(b) { b.onResolve({ filter: /^@microsoft\/msfs-sdk$/ }, () => ({ path: join(P18, "sdk-modules", "index.js") })) } }] },
  // In the EFB's document the app draws with the EFB's own copy of the framework, as the kit's decision has it.
  "fscomponent-efb": {
    ...FSC,
    plugins: [{
      name: "efb-sdk",
      setup(b) {
        b.onResolve({ filter: /^@microsoft\/msfs-sdk$/ }, () => ({ path: "efb-sdk", namespace: "efb-sdk" }))
        b.onLoad({ filter: /.*/, namespace: "efb-sdk" }, () => ({ loader: "js", contents: "const s = window.msfssdk; export const DisplayComponent = s.DisplayComponent; export const FSComponent = s.FSComponent; export const Subject = s.Subject;" }))
      },
    }],
  },
}

async function build(names) {
  mkdirSync(OUT, { recursive: true })
  const lines = []
  for (const name of names) {
    const outfile = join(OUT, `${name}.js`)
    // esbuild resolves an alias from its working directory, and Preact is installed here.
    await esbuild.build({ ...BUILDS[name], absWorkingDir: HERE, bundle: true, format: "iife", target: "es2017", minify: true, legalComments: "none", define: { "process.env.NODE_ENV": '"production"' }, outfile, logLevel: "warning" })
    const code = readFileSync(outfile)
    const checked = spawnSync(process.execPath, ["node_modules/coherent-checks/dist/main.js", outfile], { cwd: REPO, encoding: "utf8" })
    const findings = (checked.stdout + checked.stderr).trim().split("\n").filter(Boolean).map((l) => l.replace(outfile, `${name}.js`).replace(repoRelative(outfile), `${name}.js`))
    lines.push(`${name}: ${(code.length / 1024).toFixed(1)} KB, ${(gzipSync(code).length / 1024).toFixed(1)} KB gzipped; Coherent GT check exit ${checked.status}, ${findings.length} lines of findings`)
    for (const f of findings.slice(0, 12)) lines.push(`    ${f.slice(0, 200)}`)
    if (findings.length > 12) lines.push(`    and ${findings.length - 12} more`)
  }
  return lines
}

// ---------------------------------------------------------------- the server

// The page fetches the bundle first, so the time it reports is parse and first run, with no loading in it.
const page = (framework) => `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head>
<body style="margin: 0; background: #0a0a0a"><div id="dualinput-p18"></div><script>
window.P23_ERRORS = [];
window.P23_FRAMEWORK = ${JSON.stringify(framework)};
window.addEventListener("error", function (e) { window.P23_ERRORS.push(String(e.message)) });
var x = new XMLHttpRequest();
x.open("GET", "/bundle/${framework}.js");
x.onload = function () {
  var s = document.createElement("script");
  s.text = x.responseText;
  var t0 = performance.now();
  window.P23_EVAL_MS = 0;
  document.head.appendChild(s);
  window.P23_EVAL_MS = Math.round((performance.now() - t0) * 100) / 100;
  if (!window.P23_RAN) { var r = new XMLHttpRequest(); r.open("POST", "/result"); r.setRequestHeader("content-type", "text/plain"); r.onload = function () { var n = JSON.parse(r.responseText).next; if (n) location.replace(n) }; r.send(JSON.stringify({ framework: ${JSON.stringify(framework)}, evalMs: window.P23_EVAL_MS, checks: [], bursts: [], errors: window.P23_ERRORS, threw: true })) }
};
x.send();
</script></body></html>`

const results = []
let onResult = () => {}
let front = "?"
let cores = 0
let leftFront = false

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x")
  if (req.method === "POST") {
    let body = ""
    req.on("data", (d) => (body += d))
    req.on("end", () => {
      const r = JSON.parse(body)
      r.front = front
      r.cores = cores
      results.push(r)
      const total = where === "efb" ? EFB_ORDER.length : DEBUGGER_ORDER.length
      console.log(`${results.length}/${total}: ${r.framework}, parse and first run ${r.evalMs}ms, ${r.bursts.length} bursts, ${r.errors.length} errors, ${front} in front`)
      const n = results.length
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" })
      res.end(JSON.stringify({ next: where === "debugger" && n < total ? `/page/${n}` : null }))
      onResult(r)
    })
    return
  }
  const m = url.pathname.match(/^\/page\/(\d+)$/)
  if (m) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    return res.end(page(DEBUGGER_ORDER[Number(m[1])]))
  }
  const file = url.pathname === "/app.css" ? join(P18, "modules", "app.css") : url.pathname.startsWith("/bundle/") ? join(OUT, url.pathname.slice("/bundle/".length)) : null
  if (!file || !existsSync(file)) {
    res.writeHead(404)
    return res.end()
  }
  res.writeHead(200, { "content-type": file.endsWith(".css") ? "text/css" : "text/javascript", "access-control-allow-origin": "*" })
  res.end(readFileSync(file))
})

// ---------------------------------------------------------------- the window in front, and the sim's load

function watchFront() {
  const watcher = spawn("powershell", ["-NoProfile", "-EncodedCommand", encoded(`
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
"@
$prev = $null
$prevT = $null
while ($true) {
  [uint32]$p = 0
  [void][Fg]::GetWindowThreadProcessId([Fg]::GetForegroundWindow(), [ref]$p)
  $name = try { (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch { "?" }
  $sim = Get-Process -Name ${SIM} -ErrorAction SilentlyContinue | Select-Object -First 1
  $now = [DateTime]::UtcNow
  $busy = 0
  if ($sim -and $null -ne $prev) { $busy = ($sim.CPU - $prev) / ($now - $prevT).TotalSeconds }
  if ($sim) { $prev = $sim.CPU; $prevT = $now }
  [Console]::Out.WriteLine("$name $([math]::Round($busy, 2))")
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 500
}`)], { stdio: ["ignore", "pipe", "ignore"] })
  process.on("exit", () => watcher.kill())
  createInterface({ input: watcher.stdout }).on("line", (l) => {
    const [name, busy] = l.trim().split(" ")
    front = name
    cores = Number(busy)
    if (name !== SIM) leftFront = true
  })
}

async function waitForSimInFront() {
  console.log("waiting up to 5 minutes for the sim's window to come to the front")
  const since = Date.now()
  while (front !== SIM) {
    if (Date.now() - since > 300000) throw new Error("the sim never came to the front")
    await sleep(200)
  }
  await sleep(3000)
}

// ---------------------------------------------------------------- the debugger

let debuggerProcess
process.on("exit", () => debuggerProcess?.kill())

async function inDebugger(port) {
  if (!existsSync(join(HOST, "Debugger.exe"))) throw new Error("no copy of the debugger: run p22's engine mode first")
  let finished
  const allIn = new Promise((resolve) => (finished = resolve))
  onResult = () => { if (results.length >= DEBUGGER_ORDER.length) finished() }
  writeFileSync(join(HOST, "html", "debugger.html"), `<html><body style="margin:0;background:#000"><iframe src="http://127.0.0.1:${port}/page/0" style="${FULL_WINDOW}"></iframe></body></html>`)
  debuggerProcess = spawn(join(HOST, "Debugger.exe"), [], { cwd: HOST, stdio: "ignore" })
  const timedOut = await Promise.race([allIn.then(() => false), sleep(DEADMAN_MS - 10000).then(() => true)])
  return timedOut ? [`Timed out with ${results.length} of ${DEBUGGER_ORDER.length} pages`] : []
}

// ---------------------------------------------------------------- the EFB

// Set once connected, so an error or Ctrl+C still gives the sim its keyboard back.
let unlock = async () => "not connected"

// Waits for the EFB's document, then for the app's screen in it, which exists once the EFB has started
// with the package installed.
async function findApp() {
  for (;;) {
    let pages = []
    try { pages = await listPages() } catch (e) { console.log(e.message.split("\n")[0]) }
    const efb = pages.find((p) => String(p.title || "") === "Electronic Flight Bag")
    if (efb) {
      const insp = new Inspector(efb.id)
      await insp.open()
      const state = await insp.evaluate("({ mounted: window.DUALINPUT_P23_MOUNTED || null, registered: window.DUALINPUT_P23_REGISTERED || null, error: window.DUALINPUT_P23_REGISTER_ERROR || null })")
      if (state.mounted) return { insp, efb, state }
      console.log(`The app isn't ready yet (${JSON.stringify(state)}); open "Dual Input P23" in the EFB. Retrying in 3s.`)
      insp.close()
    } else console.log("No EFB document yet; load a flight and open the EFB. Retrying in 3s.")
    await sleep(3000)
  }
}

const stepDone = (id, app) => (id === "click" ? app.seen.clicks > 0 : id === "wheel" ? app.listScroll > 0 : app.state === "abc" && app.field === "abc")

// The inspector refused one connection at a run's very end (2026-11-01), which cost that run its
// report, so a connection gets a few tries, and nothing after the last page can lose what it measured.
async function connect(id) {
  for (let tries = 1; ; tries++) {
    const insp = new Inspector(id)
    try {
      await insp.open()
      return insp
    } catch (e) {
      if (tries >= 5) throw e
      await sleep(1000)
    }
  }
}

async function takeSteps(insp, beep) {
  const keys = await startKeys()
  await insp.evaluate(`DUALINPUT_P23_STEP("ready", "Press Page Down to start.")`)
  console.log("Press Page Down in the sim to start.")
  for (;;) { const k = await keys.next(); if (k.key === "START") break }

  const outcomes = []
  let skipped = false
  const stopListening = keys.listen((k) => { if (k.key === "SKIP") skipped = true })
  for (const step of STEPS) {
    await insp.evaluate(`DUALINPUT_P23_STEP(${JSON.stringify(step.id)}, ${JSON.stringify(step.text)})`)
    console.log(step.text)
    beep(880, 150)
    skipped = false
    const started = Date.now()
    let outcome = "timed out"
    while (Date.now() - started < STEP_MS) {
      await sleep(300)
      const app = await insp.evaluate("DUALINPUT_P23_READ()")
      if (stepDone(step.id, app)) { outcome = "done"; await sleep(1200); break }
      if (skipped) { outcome = "skipped"; break }
    }
    await insp.evaluate("DUALINPUT_P23_UNLOCK()")
    outcomes.push(`${step.id}: ${outcome} (${((Date.now() - started) / 1000).toFixed(1)}s)`)
    console.log(`  ${outcome}`)
    beep(660, 80)
  }
  stopListening()
  return outcomes
}

async function inEfb(port) {
  const { insp, efb, state } = await findApp()
  unlock = async () => {
    const giveBack = await connect(efb.id)
    const out = await giveBack.evaluate("window.DUALINPUT_P23_UNLOCK ? window.DUALINPUT_P23_UNLOCK() : 'nothing'")
    giveBack.close()
    return out
  }
  process.on("SIGINT", async () => { console.log(`unlock: ${await unlock().catch((e) => e.message)}`); process.exit(130) })
  console.log(`EFB document ${efb.id}: the app is ${state.mounted}`)

  const beep = startBeeper()
  const outcomes = again ? ["taken in an earlier run, in this load of the EFB, and read back from the app"] : await takeSteps(insp, beep)

  // With another window in front the EFB's elements measured 0px, so the app's own readings need the
  // sim in front too (2026-11-01).
  if (!behind) await waitForSimInFront()
  await insp.evaluate(`DUALINPUT_P23_STEP("after", "Thanks. Keep the sim in front while p23 times the frameworks.")`)
  const guided = await insp.evaluate("DUALINPUT_P23_READ()")
  await insp.evaluate("DUALINPUT_P23_STOP_RECORDER()")
  const shooter = startShooter(join(RESULTS, `${NAME}-${stamp()}`))
  const shot = await shooter.shot("react-in-efb")
  shooter.close()
  insp.close()

  const counted = (step) => Object.entries(guided.counts || {}).filter(([k]) => k.startsWith(`${step} `)).map(([k, n]) => `${k.slice(step.length + 1)} ${n}`).join(", ")
  const s = guided.seen
  const lines = [
    `EFB document: ${JSON.stringify(guided.env)}`,
    "",
    "The pilot's real input, to React in the EFB's own document:",
    ...outcomes.map((o) => `  ${o}`),
    `  React's handlers saw: ${s.mouseEnters} mouse enters, ${s.mouseDowns} mouse downs, ${s.clicks} clicks, ${s.wheels} wheels, ${s.focuses} focuses, ${s.blurs} blurs`,
    `  State: pressed ${guided.presses} times, room ${guided.roomHeight}px tall, list scrolled ${guided.listScroll}px`,
    `  The controlled field: state ${JSON.stringify(guided.state)}, field ${JSON.stringify(guided.field)}, mirror ${JSON.stringify(guided.mirror)}; each change ${JSON.stringify(s.changes)}; from the sim's keyboard ${JSON.stringify(s.osText)}`,
    `  Triggers: ${JSON.stringify(s.triggers)}`,
    ...STEPS.map((step) => `  Events in ${step.id}: ${counted(step.id) || "none"}`),
    `  Screenshot: ${shot.error ? shot.error : repoRelative(shot.file)}`,
  ]

  // A page that had another window in front at any sample doesn't count, and runs again.
  for (const framework of EFB_ORDER) {
    for (;;) {
      if (!behind) await waitForSimInFront()
      leftFront = false
      const got = new Promise((resolve) => (onResult = resolve))
      const load = await connect(efb.id)
      await load.evaluate(`DUALINPUT_P23_RESET_HOST(); DUALINPUT_P23_LOAD(${JSON.stringify(framework === "fscomponent" ? "fscomponent-efb" : framework)}, ${JSON.stringify(framework)}, "http://127.0.0.1:${port}")`)
      load.close()
      const answered = await Promise.race([got.then(() => true), sleep(90000).then(() => false)])
      if (!answered) lines.push(`No answer from ${framework} within 90s`)
      await sleep(1000)
      if (behind || !leftFront) break
      if (answered) results.pop()
      lines.push(`A ${framework} page ran again, since another window came to the front`)
      console.log(`another window came to the front during ${framework}, so that page runs again`)
      beep(440, 400)
    }
  }
  beep(660, 300)
  try {
    const last = await connect(efb.id)
    await last.evaluate(`DUALINPUT_P23_RESET_HOST(); DUALINPUT_P23_STEP("end", "Done. p23 has saved its report.")`)
    last.close()
    console.log(`unlock: ${await unlock()}`)
  } catch (e) {
    lines.push(`Clearing up at the end failed: ${e.message}`)
  }
  return lines
}

// ---------------------------------------------------------------- the report

function report(names) {
  const lines = []
  for (const name of names) {
    const runs = results.filter((r) => r.framework === name)
    lines.push("", `${name}, ${runs.length} loads of its page:`)
    lines.push(`  Parse and first run: ${runs.map((r) => `${r.evalMs}ms`).join(", ")}`)
    lines.push(`  Mounting the app's shell: ${runs.map((r) => `${r.mountMs}ms`).join(", ")}`)
    const errors = runs.flatMap((r) => r.errors)
    lines.push(errors.length ? `  Errors: ${[...new Set(errors)].map((e) => e.slice(0, 300)).join(" | ")}` : "  Errors: none")
    const first = runs.find((r) => r.checks.length)
    if (first) {
      for (const c of first.checks) {
        const same = runs.every((r) => r.checks.find((x) => x.name === c.name)?.ok === c.ok)
        lines.push(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.detail ? ` (${c.detail})` : ""}${same ? "" : ", differs between loads"}`)
      }
    }
    lines.push("  Each time is JavaScript + forced layout, in ms; the first burst of each load, then the median of the later ones with its range:")
    for (const op of OPS) {
      const firsts = runs.filter((r) => r.bursts.length).map((r) => r.bursts[0][op])
      const later = runs.flatMap((r) => r.bursts.slice(1).map((b) => b[op]))
      if (!later.length) continue
      const js = later.map((x) => x.js)
      lines.push(`    ${OP_NAMES[op]}: first ${firsts.map((x) => `${x.js} + ${x.layout}`).join(", ")}; later ${median(js)} + ${median(later.map((x) => x.layout))}, JavaScript range ${Math.min(...js)} to ${Math.max(...js)}`)
    }
  }
  const one = results[0]
  if (one) {
    lines.push("", `Page: ${one.userAgent}`, `Sim globals where the page ran: ${JSON.stringify(one.simGlobals)}`, `Features: ${JSON.stringify(one.features)}`)
    lines.push(`Window in front at each page's end: ${results.map((r) => r.front).join(", ")}`, `Sim busy at each page's end, in cores: ${results.map((r) => r.cores).join(", ")}`)
  }
  return lines
}

// ---------------------------------------------------------------- the run

if (!["debugger", "efb"].includes(where)) throw new Error("usage: p23-page-frameworks.mjs debugger|efb [--behind]")
for (const needed of [join(P18, "modules", "app.css"), join(P18, "sdk-modules", "index.js")]) {
  if (!existsSync(needed)) throw new Error("p18's page isn't built: run experiments/areas/interface/p18-fscomponent/p18-fscomponent.mjs first")
}

const sizes = await build(where === "efb" ? ["react", "fscomponent-efb"] : ["fscomponent", "react", "preact"])
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const { port } = server.address()
watchFront()
try {
  const found = where === "efb" ? await inEfb(port) : await inDebugger(port)
  const text = [
    `${NAME} ${process.argv.slice(2).join(" ")}, ${new Date().toISOString()}`,
    "",
    ...found,
    "",
    "Bundles, minified, at es2017:",
    ...sizes,
    ...report(where === "efb" ? ["react", "fscomponent"] : ["fscomponent", "react", "preact"]),
  ].join("\n")
  console.log(text)
  console.log(`saved ${repoRelative(saveResult("interface", `${NAME}-${where}`, text))}`)
  process.exit(0)
} catch (e) {
  console.error(e.stack ?? String(e))
  console.log(`unlock: ${await unlock().catch((err) => err.message)}`)
  process.exit(1)
}
