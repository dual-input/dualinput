/*
 * p22: whether the MSFS 2024 SDK's CoherentGT Debugger can stand in for the sim while we develop
 * pages for Coherent GT. Debugger.exe is a program of its own that draws its start page,
 * coui://html/debugger.html, with Coherent GT, so a copy of its folder with that page replaced runs
 * our pages in the engine with no sim. The copy goes under out/, which git ignores, since its files
 * are Microsoft's and Coherent Labs'.
 *
 * Build p18's page first, once, by running its probe. Then, from the repository's root:
 *
 *   node experiments/areas/interface/p22-sdk-coherent-host/p22-sdk-coherent-host.mjs engine
 *   node experiments/areas/interface/p22-sdk-coherent-host/p22-sdk-coherent-host.mjs features efb [--behind]
 *   node experiments/areas/interface/p22-sdk-coherent-host/p22-sdk-coherent-host.mjs loads debugger|efb [--new-frame] [--behind]
 *   node experiments/areas/interface/p22-sdk-coherent-host/p22-sdk-coherent-host.mjs burst debugger|efb [--behind]
 *
 * engine compares the debugger's engine files with the sim's, then runs a feature check, p18's page,
 * and p14's CSS catalog in the debugger, and compares p14's answers with what the sim gave on
 * 2026-10-25. It needs no sim, though the sim's install is read for the comparison.
 *
 * features runs the feature check in a frame in the sim's EFB.
 *
 * loads times p18's 1,000 rows over 8 loads of its page; burst times them 12 times inside one load.
 * Both report which window was in front and how many cores the sim kept busy at each sample. In the
 * EFB they wait for the sim's window to come to the front, since a timing taken behind another
 * window can't be told from one taken in front, unless --behind says to run as things are.
 *
 * In the EFB the page sits in an off screen frame that takes no input, and goes by itself after 60s
 * if this script dies. The inspector closes while the page runs, so it can't weigh on the timing. The
 * timed stretch builds page elements and forces no layout, so these times leave out layout and paint.
 * A median of an even count is the higher middle value.
 */

import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, extname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { Inspector, listPages } from "../../../tools/inspector.mjs"
import { REPO, repoRelative, resultFile, saveResult, stamp } from "../../../tools/results.mjs"

const NAME = "p22-sdk-coherent-host"
const HERE = dirname(fileURLToPath(import.meta.url))
const HOST = join(HERE, "out", "host")
const SDK = join(process.env.APPDATA ?? "", "cargo-msfs", "data", "msfs2024")
const P18 = join(REPO, "experiments", "areas", "interface", "p18-fscomponent", "out", "modules")
const P14 = join(REPO, "experiments", "areas", "architecture", "p14-coherent-css-full.mjs")
const P14_SIM = join(REPO, "experiments", "areas", "architecture", "results", "p14-coherent-css-full-2026-10-25-09-20-25.json")
const SIM = "FlightSimulator2024"
const FRAME = "dualinput-p22-frame"
const OFF_SCREEN = "position:fixed;left:-10000px;top:0;width:640px;height:760px;border:0;pointer-events:none"
const FULL_WINDOW = "position:absolute;left:0;top:0;width:100%;height:100%;border:0"
const ENGINE_FILES = ["CoherentGTCore.dll", "CoherentGTJS.dll", "CoherentUIGT.dll", "RenoirCore.WindowsDesktop.dll", "WTF.dll", "coherenticuin.dll", "coherenticuuc.dll", "icudtcoherent53.dll"]
const BURSTS = 12
const LOADS = 8

const [mode, where] = process.argv.slice(2)
const behind = process.argv.includes("--behind")
const newFrame = process.argv.includes("--new-frame")

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const encoded = (script) => Buffer.from(script, "utf16le").toString("base64")
// Windows PowerShell writes its progress to stderr as XML when it isn't on a console.
const powershell = (script) => execFileSync("powershell", ["-NoProfile", "-EncodedCommand", encoded(script)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()

// ---------------------------------------------------------------- the pages

const FEATURE_NAMES = ["PointerEvent", "ResizeObserver", "IntersectionObserver", "MutationObserver", "TouchEvent", "Proxy", "Reflect", "Symbol", "fetch", "WebSocket", "requestAnimationFrame", "CSS", "Intl", "BigInt", "queueMicrotask", "structuredClone", "AbortController", "TextEncoder", "customElements", "Coherent", "engine", "SimVar"]
const FEATURES_PAGE = `<!doctype html><meta charset=utf-8><body><script>
var names = ${JSON.stringify(FEATURE_NAMES)};
var r = { ua: navigator.userAgent, size: [innerWidth, innerHeight, window.devicePixelRatio], features: {} };
for (var i = 0; i < names.length; i++) r.features[names[i]] = typeof window[names[i]] !== "undefined";
r.features.globalThis = typeof globalThis !== "undefined";
r.features["Promise.prototype.finally"] = typeof Promise.prototype.finally === "function";
r.features["CSS.supports"] = typeof CSS !== "undefined" && typeof CSS.supports === "function";
var x = new XMLHttpRequest(); x.open("POST", "/features"); x.setRequestHeader("content-type", "text/plain"); x.send(JSON.stringify(r));
</script>`

// p18's own start, called again after each run, 1.5s apart, as the loads are. Its other checks read
// wrong after the first run, since they count from zero, but the 1,000 rows build a list of their own.
const BURST_PAGE = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"></head>
<body style="margin: 0; background: #0a0a0a"><div id="dualinput-p18"></div>
<script>window.DUALINPUT_P18_MANUAL = true</script><script src="app.js"></script>
<script>var i = 0; function go() { DUALINPUT_P18_START(document.getElementById("dualinput-p18")); i++; if (i < ${BURSTS}) setTimeout(go, 1500) } go()</script></body></html>`

// Loads a page in a frame, again 1.5s after each load finishes. Runs in the sim's engine, so it keeps
// to ES2017.
function frameDriver({ url, loads, fresh, style }) {
  const next = fresh ? "add" : `function () { f.src = "${url}?" + n; }`
  return `(function () {
  var f = null;
  var n = 0;
  var old = document.getElementById("${FRAME}");
  if (old) old.parentNode.removeChild(old);
  function gone() { if (f && f.parentNode) f.parentNode.removeChild(f); }
  function loaded() {
    n++;
    if (n < ${loads}) setTimeout(${next}, 1500);
  }
  function add() {
    gone();
    f = document.createElement("iframe");
    f.id = "${FRAME}";
    f.setAttribute("style", ${JSON.stringify(style)});
    f.onload = loaded;
    f.src = "${url}?" + n;
    document.body.appendChild(f);
  }
  add();
  setTimeout(gone, 60000);
  return "started";
})()`
}

// ---------------------------------------------------------------- the server

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" }
const posted = { features: () => {}, result: () => {} }
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x")
  if (req.method === "POST") {
    let body = ""
    req.on("data", (d) => (body += d))
    req.on("end", () => {
      res.writeHead(204, { "access-control-allow-origin": "*" })
      res.end()
      posted[url.pathname === "/features" ? "features" : "result"](JSON.parse(body))
    })
    return
  }
  const page = { "/features.html": FEATURES_PAGE, "/burst.html": BURST_PAGE }[url.pathname]
  if (page) {
    res.writeHead(200, { "content-type": TYPES[".html"] })
    return res.end(page)
  }
  const file = join(P18, url.pathname.replace(/^\/+/, ""))
  if (!existsSync(file)) {
    res.writeHead(404)
    return res.end()
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" })
  res.end(readFileSync(file))
})

// ---------------------------------------------------------------- the debugger's copy

let debuggerProcess
function startDebugger(startPage) {
  if (!existsSync(HOST)) cpSync(join(SDK, "Tools", "CoherentGT Debugger"), HOST, { recursive: true })
  writeFileSync(join(HOST, "html", "debugger.html"), startPage)
  debuggerProcess = spawn(join(HOST, "Debugger.exe"), [], { cwd: HOST, stdio: "ignore" })
}

// PrintWindow's flag 2 asks for what the GPU drew, so the window can be covered.
function shootDebugger(file) {
  return powershell(`
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Drawing; using System.Runtime.InteropServices;
public static class Cap {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
  public static string Shot(IntPtr h, string file) {
    SetProcessDPIAware(); RECT r; GetWindowRect(h, out r);
    var bmp = new Bitmap(r.R - r.L, r.B - r.T);
    using (var g = Graphics.FromImage(bmp)) { var dc = g.GetHdc(); PrintWindow(h, dc, 2); g.ReleaseHdc(dc); }
    bmp.Save(file, System.Drawing.Imaging.ImageFormat.Png); return bmp.Width + "x" + bmp.Height;
  }
}
"@
$p = Get-Process -Id ${debuggerProcess.pid}
$p.Refresh()
[Cap]::Shot($p.MainWindowHandle, '${file}')`)
}

// ---------------------------------------------------------------- the window in front, and the sim's load

let front = "?"
let cores = 0
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
  })
}
process.on("exit", () => debuggerProcess?.kill())

// ---------------------------------------------------------------- the sim's EFB

async function efbPage() {
  const page = (await listPages()).find((p) => /^Electronic Flight Bag$/.test(String(p.title)))
  if (!page) throw new Error("the sim has no EFB document open")
  return page
}

async function runInEfb(page, source) {
  const insp = new Inspector(page.id)
  await insp.open()
  const out = await insp.evaluate(source)
  insp.close()
  return out
}

const removeFrame = `(function () { var f = document.getElementById("${FRAME}"); if (f) f.parentNode.removeChild(f); return !document.getElementById("${FRAME}") })()`

async function waitForSimInFront() {
  console.log("waiting up to 5 minutes for the sim's window to come to the front")
  const since = Date.now()
  while (front !== SIM) {
    if (Date.now() - since > 300000) throw new Error("the sim never came to the front")
    await sleep(200)
  }
  await sleep(3000)
}

// ---------------------------------------------------------------- the sim's install

function simInstall() {
  for (const key of ["HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 2537590", "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 2537590"]) {
    try {
      const m = execFileSync("reg", ["query", key, "/v", "InstallLocation"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).match(/InstallLocation\s+REG_SZ\s+(.+)/)
      if (m && existsSync(m[1].trim())) return m[1].trim()
    } catch { /* the next key, or the Store edition, which this doesn't find */ }
  }
  return null
}

function engineFilesReport() {
  const hash = (f) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 12)
  const size = (f) => readFileSync(f).length
  const sim = simInstall()
  const lines = [`SDK ${readFileSync(join(SDK, "version.txt"), "utf8").split(/\r?\n/)[0]}; sim ${sim ? powershell(`(Get-Item '${join(sim, `${SIM}.exe`)}').VersionInfo.FileVersion`).replace(/,/g, ".") : "install not found"}`, "", "Engine files, SDK's debugger against the sim:"]
  for (const name of ENGINE_FILES) {
    const a = join(SDK, "Tools", "CoherentGT Debugger", "assembly", name)
    const b = sim && join(sim, name)
    const same = b && existsSync(b) && hash(a) === hash(b)
    lines.push(`  ${name}: SDK ${size(a)} bytes, sim ${b && existsSync(b) ? `${size(b)} bytes` : "not found"}${same ? ", identical" : ""}`)
  }
  return lines
}

// ---------------------------------------------------------------- p14's answers against the sim's

function compareP14(mine) {
  const sim = JSON.parse(readFileSync(P14_SIM, "utf8"))
  // A relative URL resolves against the page's own address, coui:// in the sim and http here.
  const norm = (x) => JSON.stringify(x).replace(/coui:\/\/html_ui\/[a-z_/]*\/|http:\/\/127\.0\.0\.1:\d+\//gi, "BASE/")
  const keyOf = {
    properties: (x) => x.name,
    functions: (x) => `${x.name} ${x.prop} ${x.value}`,
    values: (x) => `${x.prop}: ${x.value}`,
    units: (x) => x.unit,
    selectors: (x) => `${x.name} ${x.sel}`,
    atRules: (x) => x.name,
    media: (x) => x.query,
    layout: (x) => `${x.group} / ${x.name}`,
  }
  const lines = [`Catalogs equal: ${JSON.stringify(sim.catalog) === JSON.stringify(mine.catalog)}`, `Debugger: ${mine.result.ua}`]
  for (const run of sim.runs.filter((r) => r.result)) {
    lines.push("", `Against the sim's ${run.label} document, 2026-10-25 (${run.result.ua}):`)
    let total = 0
    let same = 0
    for (const section of Object.keys(keyOf)) {
      const theirs = new Map(mine.result[section].map((x) => [keyOf[section](x), x]))
      const differs = run.result[section].filter((x) => {
        const y = theirs.get(keyOf[section](x))
        return !y || norm(x) !== norm(y)
      })
      total += run.result[section].length
      same += run.result[section].length - differs.length
      lines.push(`  ${section}: ${run.result[section].length - differs.length} of ${run.result[section].length} identical`)
      for (const x of differs) {
        const y = theirs.get(keyOf[section](x))
        lines.push(`    ${keyOf[section](x)}`, `      sim      ${norm(x).slice(0, 200)}`, `      debugger ${norm(y).slice(0, 200)}`)
      }
    }
    lines.push(`  all: ${same} of ${total} identical`)
  }
  return lines
}

// ---------------------------------------------------------------- the modes

async function engine(port) {
  const when = stamp()
  const lines = [`${NAME} engine, ${new Date().toISOString()}`, "", ...engineFilesReport()]
  const got = {}
  let done
  const allIn = new Promise((resolve) => (done = resolve))
  const check = () => { if (got.features && got.p18 && got.p14) done() }
  posted.features = (r) => { got.features = r; check() }
  posted.result = (r) => { got.p18 = r; check() }
  // p14's page lives in p14, and saves what it measures as a Chromium baseline, so its result moves
  // here at once and p14's own reports go on reading only Chromium's.
  const p14 = spawn(process.execPath, [P14, "--baseline"], { cwd: REPO })
  p14.stderr.on("data", (d) => process.stderr.write(d))
  const p14Json = resultFile("interface", `${NAME}-engine-p14`, "json", when)
  const p14Port = await new Promise((resolve) => {
    p14.stdout.on("data", (d) => {
      const s = String(d)
      const port14 = s.match(/127\.0\.0\.1:(\d+)/)
      if (port14) resolve(port14[1])
      const saved = s.match(/saved (\S+\.json)/)
      if (saved) { renameSync(join(REPO, saved[1]), p14Json); got.p14 = JSON.parse(readFileSync(p14Json, "utf8")); check() }
    })
  })
  startDebugger(`<html><body style="margin:0;background:#000">
<iframe src="http://127.0.0.1:${port}/features.html" style="position:absolute;left:0;top:0;width:300px;height:120px;border:0"></iframe>
<iframe src="http://127.0.0.1:${p14Port}/" style="position:absolute;left:0;top:130px;width:300px;height:600px;border:0"></iframe>
<iframe src="http://127.0.0.1:${port}/index.html" style="position:absolute;left:310px;top:0;width:640px;height:760px;border:0"></iframe>
</body></html>`)
  const timedOut = await Promise.race([allIn.then(() => false), sleep(90000).then(() => true)])
  if (timedOut) lines.push("", `Timed out with: ${Object.keys(got).join(", ") || "nothing"}`)
  await sleep(2000)
  const png = resultFile("interface", `${NAME}-engine`, "png", when)
  lines.push("", `Screenshot: ${repoRelative(png)}, ${shootDebugger(png)}`)
  if (got.features) lines.push("", "Feature check in a frame:", JSON.stringify(got.features))
  if (got.p18) lines.push("", "p18's page:", ...got.p18.checks.map((c) => `  ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`))
  if (got.p14) lines.push("", ...compareP14(got.p14), "", `p14's answers: ${repoRelative(p14Json)}`)
  return lines
}

async function features(port) {
  const page = await efbPage()
  if (!behind) await waitForSimInFront()
  const got = new Promise((resolve) => (posted.features = resolve))
  await runInEfb(page, frameDriver({ url: `http://127.0.0.1:${port}/features.html`, loads: 1, fresh: false, style: OFF_SCREEN }))
  const r = await Promise.race([got, sleep(20000).then(() => null)])
  await sleep(500)
  const removed = await runInEfb(page, removeFrame)
  return [`${NAME} features efb, ${new Date().toISOString()}`, `Frame removed: ${removed}`, r ? JSON.stringify(r) : "no answer within 20s"]
}

async function timing(port) {
  const runs = mode === "burst" ? BURSTS : LOADS
  const samples = []
  let first
  let done
  const allIn = new Promise((resolve) => (done = resolve))
  posted.result = (r) => {
    first ??= r
    const rows = r.checks.find((c) => /1,000 rows/.test(c.name))
    samples.push({ ms: Number(rows?.detail?.match(/([\d.]+)ms/)?.[1]), front, cores })
    const s = samples[samples.length - 1]
    console.log(`${samples.length}: ${s.ms}ms, ${s.front} in front, sim busy ${s.cores} cores`)
    if (samples.length >= runs) done()
  }
  const url = `http://127.0.0.1:${port}/${mode === "burst" ? "burst" : "index"}.html`
  const loads = mode === "burst" ? 1 : LOADS
  let page
  if (where === "efb") {
    page = await efbPage()
    if (!behind) await waitForSimInFront()
    await runInEfb(page, frameDriver({ url, loads, fresh: newFrame, style: OFF_SCREEN }))
  } else {
    startDebugger(`<html><body style="margin:0;background:#000"><script>${frameDriver({ url, loads, fresh: newFrame, style: FULL_WINDOW })}</script></body></html>`)
  }
  const timedOut = await Promise.race([allIn.then(() => false), sleep(55000).then(() => true)])
  const removed = page ? await runInEfb(page, removeFrame) : null
  const times = samples.map((s) => s.ms)
  const later = times.slice(1)
  return [
    `${NAME} ${process.argv.slice(2).join(" ")}, ${new Date().toISOString()}`,
    ...(timedOut ? [`Timed out with ${samples.length} of ${runs}`] : []),
    ...samples.map((s, i) => `${i + 1}: ${s.ms}ms, ${s.front} in front, sim busy ${s.cores} cores`),
    `Median of all ${median(times)}ms; first ${times[0]}ms; median of the later ones ${median(later)}ms, range ${Math.min(...later)} to ${Math.max(...later)}ms`,
    `Sim in front for ${samples.filter((s) => s.front === SIM).length} of ${samples.length}; sim busy median ${median(samples.map((s) => s.cores))} cores`,
    ...(first ? [`Page: ${first.userAgent}`, `Sim globals in the frame: ${JSON.stringify(first.simGlobals)}`, `First run's checks: ${first.checks.filter((c) => c.ok).length} of ${first.checks.length} ok`] : []),
    ...(page ? [`Frame removed: ${removed}`] : []),
  ]
}

// ---------------------------------------------------------------- the run

if (!existsSync(join(P18, "app.js"))) throw new Error("p18's page isn't built: run experiments/areas/interface/p18-fscomponent/p18-fscomponent.mjs first")
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const { port } = server.address()
watchFront()
const lines = mode === "engine" ? await engine(port) : mode === "features" ? await features(port) : await timing(port)
const text = lines.join("\n")
console.log(text)
console.log(`saved ${repoRelative(saveResult("interface", `${NAME}-${mode}`, text))}`)
process.exit(0)
