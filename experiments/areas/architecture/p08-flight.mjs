/*
 * p08: does what Crosscheck's Rust pieces did at the main menu hold in a
 * flight (architecture plan, node 1.5)? In one run with the A2A PA-24 parked:
 *
 *   1. The client (flight/client), on the SDK's own SimConnect.dll through
 *      declarations bindgen generates, connects as the sim boots and takes a
 *      masking group at 10,000,000 at once, as the core would; then follows the
 *      flight load's flow events, creates an AI PA-24 with a livery other than
 *      the pilot's and our figure, reads the camera, lists, reads, sets, and
 *      hears an input event, and calls a cockpit panel over the CommBus.
 *   2. The module (flight/module), on bindgen's declarations too, echoes the
 *      client's slot writes in a flight, stamped on the clocks it can read.
 *   3. The banner: the client asks, over the CommBus, the toolbar script and
 *      then the EFB app's code to open p05's panel, once after Ready to fly and
 *      again 4 minutes later, and the inspector and a screenshot check each.
 *   4. Timing, all through the flight: each echo's round trip, the module's
 *      clocks against QueryPerformanceCounter, a variable the module sets in
 *      the frame it echoes against the slot, and each page's performance.now().
 *   5. Guided, with Page Down and beeps: the yoke, free, masked by the group
 *      taken at the sim's start, and cleared; then a flight-hardware button.
 *      The helper (flight/helper) reads Raw Input in sink mode the whole run,
 *      so each Page Down pressed with the sim in front is a key a person pressed.
 *
 *   node experiments/areas/architecture/flight/build.mjs --install   (sim closed)
 *   node experiments/areas/architecture/p08-flight.mjs --launch
 *
 * --launch starts the sim through Steam after the client is waiting, so the
 * client connects as the sim boots; without it the probe waits for a sim
 * started another way. Bind the yoke in MSFS's controls, and keep the sim in
 * a window or borderless, so screenshots can see it.
 *
 * The client fails open: it clears its groups and exits when this probe's
 * keepalive stops for 15s or its stdin closes, and killing it releases its
 * masks (measured on MSFS 2024, 2026-10-01, record/areas/flight-controls/log.md).
 * The module and the scripts touch nothing in the pilot's input path.
 *
 * Output: the console, and results/p08-flight-<time>.txt, .ndjson, and a
 * folder of screenshots.
 */

import { spawn } from "node:child_process"
import path from "node:path"
import { createInterface } from "node:readline"

import { Recorder, scrub, sleep } from "../aircraft/lib/out.mjs"
import { SKIP, START, startBeeper, startKeys, startSpeaker } from "../../tools/guide.mjs"
import { Inspector, listPages } from "../../tools/inspector.mjs"
import { REPO, repoRelative } from "../../tools/results.mjs"
import { startShooter } from "../../tools/shot.mjs"

const argv = process.argv.slice(2)
const FLIGHT = path.join(REPO, "experiments", "areas", "architecture", "flight")
const CLIENT = path.join(FLIGHT, "target", "release", "p08-client.exe")
const HELPER = path.join(FLIGHT, "target", "release", "p08-helper.exe")
const STEAM_URL = "steam://rungameid/2537590"
const SIM_PROCESS = "FlightSimulator2024"
const SIM_EXE = "FlightSimulator2024.exe"
const PA24_TITLE = "A2A Piper PA-24-250 Comanche"
const FIGURE = "CROSSCHECK_Figure"
const BATTERY = "SWITCH_BATTERY_MASTER_2STATES"
const KEEPALIVE_MS = 5_000
const SETTLE_MS = 20_000
const MID_FLIGHT_MS = 4 * 60_000
const PAGE_EVERY_MS = 10_000
const PHASE_MS = 5_000
// Accu-Sim's own K:AXIS_ELEVATOR_SET stayed within ±5,349 and the hardware's
// reached ±16,380 (measured on MSFS 2024, 2026-10-01,
// record/areas/flight-controls/log.md), so a value past this is the pilot's.
const HARDWARE_ABOVE = 6_000
const FLOW = ["NONE", "FLT_LOAD", "FLT_LOADED", "TELEPORT_START", "TELEPORT_DONE", "BACK_ON_TRACK_START", "BACK_ON_TRACK_DONE", "SKIP_START", "SKIP_DONE", "BACK_TO_MAIN_MENU", "RTC_START", "RTC_END", "REPLAY_START", "REPLAY_END", "FLIGHT_START", "FLIGHT_END", "PLANE_CRASH"]
// The client's IDs (flight/client/src/main.rs).
const GROUP = { 1: "A", 2: "H" }
const EVENT = { 1: "K:SIM_RATE_INCR", 2: "K:AXIS_ELEVATOR_SET, listening", 3: "K:AXIS_ELEVATOR_SET, masking", 12: "SimStart", 13: "SimStop" }
const REQ_SPAWN_AI = 5
const REQ_SPAWN_OBJ = 6

const rec = new Recorder("p08-flight", { area: "architecture" })
rec.open()
const shotsDir = rec.files.txt.replace(/\.txt$/, "")
const findings = []
const find = (s) => { findings.push(s); rec.log("find", s) }

// ---------------------------------------------------------------- the client

const lines = []
const waiters = new Set()
let clientExited = null
const client = spawn(CLIENT, [], { cwd: path.dirname(CLIENT), stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
client.on("exit", (code) => { clientExited = code; rec.log("client", `exited (code ${code})`) })
createInterface({ input: client.stderr }).on("line", (l) => rec.log("client", `stderr: ${l}`))
createInterface({ input: client.stdout }).on("line", (raw) => {
  const [at, kind, ...f] = raw.split("\t")
  const l = { t: Date.now(), us: Number(at), kind, f }
  lines.push(l)
  const quiet = ["WROTE", "OUT", "ECHO", "EVENT", "VAR", "LIVERY", "INPUT", "QPC"].includes(kind)
  if (quiet) rec.data(`c:${kind}`, f.join(" "), { us: l.us, f })
  else rec.log("client", `${kind} ${f.map((x) => scrub(x)).join(" | ")}`, { us: l.us, f })
  for (const w of waiters) if (w.pred(l)) { waiters.delete(w); w.resolve(l) }
})
const send = (cmd) => { try { client.stdin.write(cmd + "\n") } catch { /* exited */ } }
const sendTab = (...fields) => send(fields.join("\t"))
// The first client line from now on that matches, or null after ms.
function next(pred, ms) {
  return new Promise((resolve) => {
    const w = { pred, resolve }
    waiters.add(w)
    setTimeout(() => { if (waiters.delete(w)) resolve(null) }, ms)
  })
}
const since = (t, kind) => lines.filter((l) => l.t >= t && (!kind || l.kind === kind))
const alive = setInterval(() => send("alive"), KEEPALIVE_MS)

// ---------------------------------------------------------------- the helper

const helperLines = []
const helper = spawn(HELPER, [String(50 * 60)], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true })
createInterface({ input: helper.stdout }).on("line", (raw) => {
  const [at, kind, ...f] = raw.split("\t")
  const l = { t: Date.now(), us: Number(at), kind, f }
  helperLines.push(l)
  rec.data(`h:${kind}`, f.join(" "), { us: l.us, f })
})

// ---------------------------------------------------------------- pages

const label = (p) => String(p.title || "") || String(p.url || "").split("/").slice(-2).join("/") || `page ${p.id}`
async function inPage(page, expression) {
  const insp = new Inspector(page.id)
  try {
    await insp.open()
    return { ok: true, value: await insp.evaluate(expression) }
  } catch (e) {
    return { ok: false, error: e.message }
  } finally {
    insp.close()
  }
}
async function pages() {
  try { return await listPages() } catch { return [] }
}
const PAGE_KINDS = {
  toolbar: (p) => /toolbar/i.test(String(p.title)) || /toolbar/i.test(String(p.url)),
  efb: (p) => /electronic flight bag/i.test(String(p.title)) || /efb_ui/i.test(String(p.url)),
  banner: (p) => /CrosscheckP05/i.test(String(p.url)),
  cockpit: (p) => /^VCockpit/i.test(String(p.title)),
}
async function pageOf(kind) {
  return (await pages()).find(PAGE_KINDS[kind]) ?? null
}

// Each page's performance.now() and Date.now(), bracketed by this process's
// hrtime, every PAGE_EVERY_MS through the flight. Node's hrtime is tied to
// QueryPerformanceCounter by asking the client for its counter (qpcSamples).
const pageSamples = []
const qpcSamples = []
let sampling = false
async function samplePages() {
  const list = await pages()
  const chosen = ["toolbar", "efb", "banner"].map((k) => [k, list.find(PAGE_KINDS[k])]).filter(([, p]) => p)
  const cockpit = list.find(PAGE_KINDS.cockpit)
  if (cockpit) chosen.push(["cockpit panel", cockpit])
  for (const [kind, p] of chosen) {
    const h0 = process.hrtime.bigint()
    const r = await inPage(p, "[performance.now(), Date.now()]")
    const h1 = process.hrtime.bigint()
    if (r.ok && Array.isArray(r.value)) pageSamples.push({ kind, title: label(p), h0: Number(h0) / 1e6, h1: Number(h1) / 1e6, perf: r.value[0], date: r.value[1] })
  }
}
async function sampleQpc() {
  const h0 = process.hrtime.bigint()
  send("qpc")
  const l = await next((x) => x.kind === "QPC", 2000)
  const h1 = process.hrtime.bigint()
  if (l) qpcSamples.push({ h0: Number(h0) / 1e6, h1: Number(h1) / 1e6, us: l.us })
}
async function samplingLoop() {
  sampling = true
  let n = 0
  while (sampling) {
    await samplePages()
    if (n++ % 3 === 0) await sampleQpc()
    await sleep(PAGE_EVERY_MS)
  }
}

// ---------------------------------------------------------------- guide

const keys = await startKeys()
const beep = startBeeper()
const speak = startSpeaker()
const shooter = startShooter(shotsDir)
function prompt(heading, text) {
  console.log(`\n▶ ${heading}${text ? `\n  ${text}` : ""}`)
  speak(heading)
}
async function ask(heading, instruction) {
  for (;;) {
    prompt(heading, `${instruction}\n  ${START} to start, with the sim in front; ${SKIP} to skip.`)
    beep(800, 150)
    const k = await keys.next()
    rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
    if (k.key !== "START") return false
    if (k.foreground === SIM_PROCESS) return true
    console.log(`  ${k.foreground} was in front, not the sim. Click into the sim, then press ${START} again.`)
  }
}
async function shot(name) {
  const s = await shooter.shot(name)
  rec.log("shot", s.error ? `${name}: ${s.error}` : `${name}: ${repoRelative(s.file)}`, s)
  return s
}

// ---------------------------------------------------------------- the run

const t0 = Date.now()
console.log("Waiting for the client to connect…")
if (argv.includes("--launch")) {
  // The client is already retrying, so it connects as soon as the sim answers.
  await sleep(1000)
  spawn("cmd.exe", ["/c", "start", "", STEAM_URL], { stdio: "ignore", detached: true }).unref()
  rec.log("sim", `asked Steam to start the sim (${STEAM_URL})`)
}
const connected = await next((l) => l.kind === "CONNECTED" || l.kind === "GAVEUP", 10 * 60_000)
if (!connected || connected.kind !== "CONNECTED") { console.log("The client never connected."); await finish("the client never connected") }
await next((l) => l.kind === "READY", 10_000)
const open = lines.find((l) => l.kind === "OPEN")
const groupCalls = lines.filter((l) => l.kind === "CALL" && /group A|K:SIM_RATE_INCR/.test(l.f[0]))
find(`Connected ${((connected.t - t0) / 1000).toFixed(1)}s after the client started${argv.includes("--launch") ? ", which asked Steam to start the sim" : ""}; ${open ? `the sim is ${open.f[0]} ${open.f[1]}, build ${open.f[2]}, SimConnect ${open.f[3]}` : "no open record"}.`)
find(`Group A at the sim's start: ${groupCalls.map((l) => `${l.f[0]} returned ${l.f[1]}`).join("; ")}.`)

// The main menu: the inspector lists mainUi once it's up.
console.log("Waiting for the main menu…")
let menuAt = null
for (let i = 0; i < 300 && !menuAt; i++) {
  if ((await pages()).some((p) => /mainUi/i.test(String(p.title)))) menuAt = Date.now()
  else await sleep(2000)
}
rec.log("sim", menuAt ? `main menu ${((menuAt - connected.t) / 1000).toFixed(0)}s after connecting` : "no main menu in 10 minutes")
const aircraftAtMenu = since(t0, "FILENAME").map((l) => `${l.f[0] === "10" ? "AircraftLoaded" : "FlightLoaded"} ${scrub(l.f[1])} at +${((l.t - connected.t) / 1000).toFixed(0)}s`)
find(`Before the main menu settled, after group A went in: ${aircraftAtMenu.join("; ") || "no aircraft or flight loaded"}.`)
await sleep(5000)

send("module")
const firstOut = await next((l) => l.kind === "OUT", 10_000)
find(firstOut ? `At the main menu, the module's OUT slot: magic ${firstOut.f[0]}, version ${firstOut.f[1]}, frame ${firstOut.f[2]}, echoing ${firstOut.f[3]}.` : "At the main menu, no OUT record from the module within 10s of writing IN.")

let pingN = 0
async function ping(when) {
  const n = ++pingN
  const t = Date.now()
  sendTab("bus", "CROSSCHECK_P08_BANNER", JSON.stringify({ n, via: "ping" }))
  await sleep(3000)
  const answers = since(t, "COMMBUS").map((l) => { try { return JSON.parse(l.f[1]) } catch { return null } }).filter((a) => a && a.n === n)
  find(`${when}, a ping over the CommBus: ${answers.map((a) => `${a.from} answered (${a.way}, loaded ${(a.loadedAgoMs / 1000).toFixed(0)}s ago, panel ${a.panel ?? "unknown"})`).join("; ") || "no script answered"}.`)
  return answers
}
await ping("At the main menu")

prompt("Load the A2A PA-24 parked, from the world map.", "The probe waits for Ready to fly, then lets the aircraft settle.")
const rtc = await next((l) => l.kind === "FLOW" && l.f[0] === "11", 20 * 60_000)
if (!rtc) await finish("no Ready to fly in 20 minutes")
const flows = since(menuAt ?? t0, "FLOW").map((l) => `${FLOW[Number(l.f[0])] ?? l.f[0]} +${((l.t - rtc.t) / 1000).toFixed(1)}s`)
find(`Flow events through the load, relative to RTC_END: ${flows.join(", ")}.`)
const loads = since(menuAt ?? t0, "FILENAME").map((l) => `${l.f[0] === "10" ? "AircraftLoaded" : "FlightLoaded"} ${scrub(l.f[1])}`)
find(`System events through the load: ${loads.join("; ") || "none"}.`)
await sleep(SETTLE_MS)

if (!await ask("Click into the sim and keep it in front.", "The next few minutes need nothing from you; the probe times the sim, which needs it in front.")) await finish("skipped at the timing prompt")
beep(1000, 100)
send("echo")
samplingLoop()

// ------------------------------------------------ the banner, after Ready to fly

async function banner(when) {
  await ping(when)
  for (const via of ["toolbar", "efb"]) {
    const n = ++pingN
    const t = Date.now()
    sendTab("bus", "CROSSCHECK_P08_BANNER", JSON.stringify({ n, via, open: true }))
    await sleep(3000)
    const answers = since(t, "COMMBUS").map((l) => { try { return JSON.parse(l.f[1]) } catch { return null } }).filter((a) => a && a.n === n)
    const page = await pageOf("banner")
    const toolbar = await pageOf("toolbar")
    const state = toolbar ? await inPage(toolbar, `(function () { var s = window.CROSSCHECK_P08_TOOLBAR; var els = document.querySelectorAll("ui-resource-element"); for (var k = 0; k < els.length; k++) { var m = els[k].manipulator; var d = m && m.m_toolBarButtonData && m.m_toolBarButtonData.panelData; if (d && d.id === "PANEL_CROSSCHECK_P05") return { state: d.state, script: !!s }; } return { state: null, script: !!s }; })()`) : null
    const s = await shot(`banner-${when.replace(/\W+/g, "-").toLowerCase()}-${via}`)
    find(`${when}, the ${via === "efb" ? "EFB app's code" : "toolbar script"} asked to open the banner: ${answers.map((a) => `${a.what}${a.called === false ? ` (threw: ${a.error})` : ""}${a.error && a.called !== false ? ` (${a.error})` : ""}`).join(", ") || "no answer"}; the inspector ${page ? `lists the banner's page (${label(page)})` : "lists no banner page"}; the toolbar has the panel ${state?.ok ? state.value?.state ?? "unlisted" : "unread"}; screenshot ${s.error ? s.error : path.basename(s.file)}.`)
    sendTab("bus", "CROSSCHECK_P08_BANNER", JSON.stringify({ n: ++pingN, via, open: false }))
    await sleep(2000)
    const after = await pageOf("banner")
    rec.log("banner", `${when}, ${via} closed it: the inspector ${after ? "still lists" : "no longer lists"} the banner's page`)
  }
}
await banner("After Ready to fly")

// ------------------------------------------------ AI objects

send("pos")
const pos = await next((l) => l.kind === "POS", 5000)
send(`strings\t0`)
const user = await next((l) => l.kind === "STRINGS" && l.f[0] === "0", 5000)
const userLivery = user ? user.f[2] : ""
find(`The user aircraft: ${user ? `TITLE ${user.f[1]}, LIVERY NAME ${user.f[2]}` : "no strings"}; ${pos ? `at ${Number(pos.f[0]).toFixed(5)}, ${Number(pos.f[1]).toFixed(5)}, ${Number(pos.f[2]).toFixed(0)} ft, heading ${Number(pos.f[3]).toFixed(1)}° true` : "no position"}.`)
const tLiv = Date.now()
sendTab("liveries", "pa-24")
const livDone = await next((l) => l.kind === "LIVERIES", 30_000)
const liveries = since(tLiv, "LIVERY").map((l) => ({ title: l.f[0], livery: l.f[1] }))
const pick = liveries.find((x) => x.title === PA24_TITLE && x.livery && x.livery !== userLivery) ?? liveries.find((x) => x.title === PA24_TITLE)
find(`EnumerateSimObjectsAndLiveries listed ${livDone ? livDone.f[0] : "?"} aircraft entries, ${liveries.length} of them PA-24s${pick ? `; the AI copy gets ${JSON.stringify(pick.livery)}` : ""}.`)

// A point ahead of the aircraft, flat-earth, which holds over tens of meters.
function ahead(meters) {
  const [lat, lon, alt, hdg] = pos.f.map(Number)
  const r = (hdg * Math.PI) / 180
  const dLat = (meters * Math.cos(r)) / 111_320
  const dLon = (meters * Math.sin(r)) / (111_320 * Math.cos((lat * Math.PI) / 180))
  return [lat + dLat, lon + dLon, alt, hdg]
}
const spawned = []
if (pos && pick) {
  const [lat, lon, alt, hdg] = ahead(40)
  sendTab("spawnai", pick.title, pick.livery, "CC-P08", lat, lon, alt, (hdg + 180) % 360)
  const a = await next((l) => (l.kind === "ASSIGNED" && l.f[0] === String(REQ_SPAWN_AI)) || l.kind === "EXCEPTION", 8000)
  if (a?.kind === "ASSIGNED") spawned.push(["the AI PA-24", Number(a.f[1])])
  else find(`The AI PA-24 wasn't created: ${a ? `exception ${a.f.join(" ")}` : "no reply in 8s"}.`)
}
if (pos) {
  const [lat, lon, alt, hdg] = ahead(6)
  sendTab("spawnobj", FIGURE, "", lat, lon, alt, (hdg + 180) % 360)
  const a = await next((l) => (l.kind === "ASSIGNED" && l.f[0] === String(REQ_SPAWN_OBJ)) || l.kind === "EXCEPTION", 8000)
  if (a?.kind === "ASSIGNED") spawned.push(["our figure", Number(a.f[1])])
  else find(`Our figure wasn't created: ${a ? `exception ${a.f.join(" ")}` : "no reply in 8s"}.`)
}
await sleep(4000)
for (const [what, id] of spawned) {
  sendTab("strings", id)
  const s = await next((l) => l.kind === "STRINGS" && l.f[0] === String(id), 5000)
  find(`${what}, object ${id}: ${s ? `TITLE ${s.f[1]}, LIVERY NAME ${s.f[2] || "(none)"}` : "no strings read back"}.`)
}
if (spawned.length) await shot("ai-objects")
for (const [, id] of spawned) sendTab("remove", id)

// ------------------------------------------------ the camera

const tCam = Date.now()
send("camera")
await sleep(1500)
const cam = since(tCam, "CAMERA")[0]
const camStatus = since(tCam, "CAMSTATUS")[0]
find(`The camera: ${camStatus ? `status ${camStatus.f[0]}, game-controlled ${camStatus.f[1]}` : "no status"}; ${cam ? `at ${cam.f.slice(0, 3).map((v) => Number(v).toFixed(3)).join(", ")} m from the aircraft, pitch ${Number(cam.f[3]).toFixed(1)}°, bank ${Number(cam.f[4]).toFixed(1)}°, heading ${Number(cam.f[5]).toFixed(1)}°, field of view ${Number(cam.f[6]).toFixed(1)}` : "no camera data"}.`)

// ------------------------------------------------ an input event

const tIn = Date.now()
sendTab("inputs", "battery")
const inDone = await next((l) => l.kind === "INPUTS", 15_000)
const inputs = since(tIn, "INPUT").map((l) => ({ name: l.f[0], hash: l.f[1], type: l.f[2] }))
const input = inputs.find((x) => x.name === BATTERY) ?? inputs.find((x) => /BATTERY_MASTER/i.test(x.name))
find(`EnumerateInputEvents listed ${inDone ? inDone.f[0] : "?"} input events; with "battery" in the name: ${inputs.map((x) => x.name).join(", ") || "none"}.`)
if (input) {
  send("battery")
  sendTab("inputget", input.hash)
  const got = await next((l) => l.kind === "GETINPUT", 5000)
  const v = got ? Number(got.f[2]) : null
  sendTab("inputsub", input.hash)
  await sleep(500)
  const tSet = Date.now()
  const flipped = v === 1 ? 0 : 1
  sendTab("inputset", input.hash, flipped)
  await sleep(3000)
  const heard = since(tSet, "SUBINPUT").map((l) => l.f[2])
  const vars = since(tSet, "VAR").filter((l) => l.f[0] === "Battery1Switch").map((l) => l.f[1])
  sendTab("inputset", input.hash, v ?? 0)
  await sleep(3000)
  const back = since(tSet + 3000, "VAR").filter((l) => l.f[0] === "Battery1Switch").map((l) => l.f[1])
  find(`${input.name} (hash ${input.hash}): GetInputEvent read ${v ?? "nothing"}; set to ${flipped}, the subscription reported ${heard.join(", ") || "nothing"} and L:Battery1Switch read ${vars.join(", ") || "no change"}; set back to ${v ?? 0}, L:Battery1Switch read ${back.join(", ") || "no change"}.`)
}

// ------------------------------------------------ the CommBus to a cockpit panel

const cockpit = await pageOf("cockpit")
if (cockpit) {
  const setup = await inPage(cockpit, `(function () {
    var r = window.CROSSCHECK_P08_PANEL = { heard: 0, errors: [] };
    function go() {
      var l = RegisterCommBusListener(function () { r.ready = true; });
      l.on("CROSSCHECK_P08_HELLO", function (data) { r.heard++; try { l.call("COMM_BUS_SIMCONNECT_CALLBACK", "CROSSCHECK_P08_ANSWER", JSON.stringify({ from: "panel", hello: String(data) })); } catch (e) { r.errors.push(String(e)); } });
    }
    if (typeof RegisterCommBusListener !== "undefined") { go(); return "common.js"; }
    var s = document.createElement("script"); s.src = "coui://html_ui/JS/Services/CommBus.js"; s.onload = function () { try { go(); } catch (e) { r.errors.push(String(e)); } }; document.head.appendChild(s);
    return "loading CommBus.js";
  })()`)
  await sleep(2000)
  const t = Date.now()
  for (let i = 1; i <= 5; i++) { sendTab("bus", "CROSSCHECK_P08_HELLO", `hello ${i}`); await sleep(300) }
  await sleep(2000)
  const answers = since(t, "COMMBUS").filter((l) => /"from":"panel"/.test(l.f[1]))
  find(`The CommBus to ${label(cockpit)} (${setup.ok ? setup.value : setup.error}): 5 calls, ${answers.length} answers.`)
}

// ------------------------------------------------ guided: the yoke

send("listen")
await sleep(1000)
const yoke = []
let window_ = null
const stat = () => ({ n: 0, hardware: 0, min: null, max: null })
function add(s, v) { s.n++; if (Math.abs(v) > HARDWARE_ABOVE) s.hardware++; s.min = s.min === null ? v : Math.min(s.min, v); s.max = s.max === null ? v : Math.max(s.max, v) }
const span = (s) => (s && s.min !== null ? s.max - s.min : 0)
const range = (s) => (s.min === null ? "none" : `${Number(s.min.toFixed(2))}..${Number(s.max.toFixed(2))}`)
rec.onRecord((r) => {
  if (!window_) return
  if (r.kind === "c:EVENT") { const [g, e, v] = r.f.map(Number); if (g === 2) add(window_.h, v); if (g === 1 && e === 3) add(window_.a, v) }
  if (r.kind === "c:VAR" && r.f[0] === "ElevatorInput") add(window_.value, Number(r.f[1]))
})
async function phase(name) {
  window_ = { name, h: stat(), a: stat(), value: stat() }
  const last = [...lines].reverse().find((l) => l.kind === "VAR" && l.f[0] === "ElevatorInput")
  if (last) add(window_.value, Number(last.f[1]))
  beep(1000, 100)
  await sleep(PHASE_MS)
  const w = window_
  window_ = null
  rec.log("phase", `yoke ${name}: L:ElevatorInput ${range(w.value)} · heard at the highest priority ×${w.h.n} (${w.h.hardware} past ±${HARDWARE_ABOVE}) · group A heard ×${w.a.n} (${w.a.hardware} past ±${HARDWARE_ABOVE})`)
  return w
}
for (;;) {
  if (!await ask("Pitch: the yoke fore and aft.", "Keep moving it through its full travel, back and forth, from Page Down until the long low beep, about 15s. Don't stop at the short beeps.")) { rec.log("skip", "the yoke"); break }
  const free = await phase("free")
  if (free.h.hardware === 0) { beep(300, 400); console.log("  No yoke input reached the sim. Is it bound in MSFS's controls? Asking again."); continue }
  send("mask")
  await sleep(300)
  const masked = await phase("masked by group A")
  send("clear")
  await sleep(300)
  const cleared = await phase("cleared")
  beep(500, 600)
  console.log("  Stop.")
  yoke.push(free, masked, cleared)
  const ratio = span(free.value) > 0 ? span(masked.value) / span(free.value) : null
  const held = ratio !== null && ratio < 0.1
  const word = held && masked.a.hardware > 0 ? "ahead of Accu-Sim: group A heard the hardware and L:ElevatorInput held still"
    : !held && masked.a.hardware === 0 ? "behind Accu-Sim: group A heard none of the hardware and L:ElevatorInput moved"
      : `unclear: L:ElevatorInput ${held ? "held" : "moved"}, and group A ${masked.a.hardware ? "heard" : "didn't hear"} the hardware`
  find(`The yoke, masked through SimConnect.dll by the group taken at the sim's start: ${word}${ratio === null ? "" : ` (${Math.round(ratio * 100)}% of its free range)`}.`)
  for (const w of yoke) find(`  ${w.name}: L:ElevatorInput ${range(w.value)}; heard at the highest priority ×${w.h.n}, ${w.h.hardware} past ±${HARDWARE_ABOVE}; group A heard ×${w.a.n}, ${w.a.hardware} past ±${HARDWARE_ABOVE}.`)
  break
}

// ------------------------------------------------ guided: a button

if (await ask("A button on your yoke or joystick.", "Press and release it a few times, from Page Down until the long low beep, about 10s.")) {
  const t = Date.now()
  beep(1000, 100)
  await sleep(10_000)
  beep(500, 600)
  const presses = helperLines.filter((l) => l.t >= t && l.kind === "BUTTONS")
  const inFront = presses.filter((l) => String(l.f[2]).toLowerCase() === SIM_EXE.toLowerCase())
  find(`A flight-hardware button through Raw Input in sink mode: ${presses.length} changes in 10s, ${inFront.length} with the sim in front; ${presses.slice(0, 6).map((l) => `${l.f[0]} down ${l.f[1]}`).join("; ") || "none"}.`)
}

// ------------------------------------------------ the banner, mid-flight

const wait = rtc.t + MID_FLIGHT_MS - Date.now()
if (wait > 0) {
  prompt("Keep the sim in front.", `The probe opens the banner once more in about ${Math.round(wait / 1000)}s, then it's done.`)
  await sleep(wait)
}
await banner("Mid-flight")
await finish("done")

// ---------------------------------------------------------------- the report

function median(xs) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
function pct(xs, p) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] }
// Least squares; the slope of y against x, in ppm when both are in the same unit.
function fit(points) {
  const n = points.length
  if (n < 3) return null
  const mx = points.reduce((s, p) => s + p[0], 0) / n
  const my = points.reduce((s, p) => s + p[1], 0) / n
  let sxy = 0, sxx = 0
  for (const [x, y] of points) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2 }
  const slope = sxy / sxx
  const residuals = points.map(([x, y]) => y - (my + slope * (x - mx)))
  return { ppm: slope * 1e6, spread: Math.max(...residuals) - Math.min(...residuals), spanS: (points[n - 1][0] - points[0][0]) / 1e6 }
}
// A function, not a const, because finish() can run before the module's code
// reaches this line, when the client never connects.
function ms(us) { return us === null || !Number.isFinite(us) ? "?" : (us / 1000).toFixed(2) }
function summary(xs) { return xs.length ? `min ${ms(Math.min(...xs))}ms, median ${ms(median(xs))}ms, 95th percentile ${ms(pct(xs, 0.95))}ms, max ${ms(Math.max(...xs))}ms` : "none" }

function timing() {
  const out = []
  // The first OUT for each sequence number is the echo; ECHO lines carry the
  // number the module set L:CROSSCHECK_P08_ECHO to in the same frame.
  const echoes = new Map()
  for (const l of lines) {
    if (l.kind === "OUT") { const seq = Number(l.f[3]); if (seq && !echoes.has(seq)) echoes.set(seq, { arrival: l.us, core: Number(l.f[4]), mono: Number(l.f[5]), real: Number(l.f[6]), deltaSum: Number(l.f[7]), frames: Number(l.f[2]) }) }
  }
  for (const l of lines) if (l.kind === "ECHO") { const e = echoes.get(Number(l.f[0])); if (e && e.echoAt === undefined) e.echoAt = l.us }
  const list = [...echoes.values()].filter((e) => e.core > 0)
  const rtt = list.map((e) => e.arrival - e.core)
  out.push(`Echoes: ${list.length} of ${lines.filter((l) => l.kind === "WROTE").length} IN writes came back; round trip, client's write to its receipt of the echo: ${summary(rtt)}.`)
  const mono = list.filter((e) => e.mono > 0)
  if (mono.length) {
    const inside = mono.filter((e) => e.core <= e.mono / 1000 && e.mono / 1000 <= e.arrival).length
    const f = fit(mono.map((e) => [e.arrival, e.arrival - e.mono / 1000]))
    out.push(`The module's monotonic clock: ${inside} of ${mono.length} stamps fall between the client's write and its receipt on the client's own counter; offset to the counter ${ms(mono[0].arrival - mono[0].mono / 1000)}ms at the first echo; drift ${f ? `${f.ppm.toFixed(2)} ppm over ${f.spanS.toFixed(0)}s, residual spread ${ms(f.spread)}ms` : "not enough echoes"}.`)
    const steps = mono.slice(1).map((e, i) => e.mono - mono[i].mono).filter((d) => d > 0)
    out.push(`  Its smallest step between echoes: ${steps.length ? (Math.min(...steps) / 1e6).toFixed(3) : "?"}ms; the stamps end in ${[...new Set(mono.slice(0, 20).map((e) => e.mono % 1000))].length > 1 ? "varied" : "the same"} ns digits.`)
  } else out.push("The module's monotonic clock: no echo carried a stamp.")
  const real = list.filter((e) => e.real > 0)
  if (real.length) { const f = fit(real.map((e) => [e.arrival, e.arrival - e.real / 1000])); out.push(`The module's realtime clock against the counter: drift ${f ? `${f.ppm.toFixed(2)} ppm over ${f.spanS.toFixed(0)}s, residual spread ${ms(f.spread)}ms` : "not enough echoes"}.`) }
  if (list.length > 1) {
    const a = list[0], b = list[list.length - 1]
    out.push(`The sum of Update_StandAlone's frame times against the counter: ${(b.deltaSum - a.deltaSum).toFixed(2)}s against ${((b.arrival - a.arrival) / 1e6).toFixed(2)}s, over ${b.frames - a.frames} frames.`)
  }
  const both = list.filter((e) => e.echoAt !== undefined).map((e) => e.echoAt - e.arrival)
  out.push(`L:CROSSCHECK_P08_ECHO, requested through SimConnect each sim frame it changes, against the slot from the same frame: ${both.length} pairs; it arrived after the slot by ${summary(both)}.`)
  const q = fit(qpcSamples.map((s) => [s.us, s.us - ((s.h0 + s.h1) / 2) * 1000]))
  out.push(`Node's hrtime against the client's counter: ${qpcSamples.length} samples, drift ${q ? `${q.ppm.toFixed(2)} ppm, residual spread ${ms(q.spread)}ms` : "not enough samples"}.`)
  for (const kind of [...new Set(pageSamples.map((s) => s.kind))]) {
    const ss = pageSamples.filter((s) => s.kind === kind)
    const perf = fit(ss.map((s) => [((s.h0 + s.h1) / 2) * 1000, (s.perf - (s.h0 + s.h1) / 2) * 1000]))
    const date = fit(ss.map((s) => [((s.h0 + s.h1) / 2) * 1000, (s.date - (s.h0 + s.h1) / 2) * 1000]))
    const rt = ss.map((s) => s.h1 - s.h0)
    out.push(`${kind} (${ss[0].title}): ${ss.length} samples; performance.now() ${perf ? `drifts ${perf.ppm.toFixed(1)} ppm from hrtime, residual spread ${ms(perf.spread)}ms` : "too few samples"}; Date.now() ${date ? `drifts ${date.ppm.toFixed(1)} ppm, residual spread ${ms(date.spread)}ms` : "too few"}; inspector round trip median ${median(rt)?.toFixed(1)}ms.`)
  }
  return out
}

async function finish(how) {
  sampling = false
  clearInterval(alive)
  send("quit")
  await Promise.race([next((l) => l.kind === "CLOSED", 5000), sleep(5000)])
  try { client.kill() } catch { /* gone */ }
  try { helper.kill() } catch { /* gone */ }
  shooter.close()
  const keysPressed = helperLines.filter((l) => l.kind === "KEY" && l.f[0] === "0x22" && l.f[1] === "down")
  const keysInFront = keysPressed.filter((l) => String(l.f[3]).toLowerCase() === SIM_EXE.toLowerCase())
  const exceptions = lines.filter((l) => l.kind === "EXCEPTION").map((l) => `${l.f.join(" ")} at +${((l.t - t0) / 1000).toFixed(0)}s`)
  const calls = lines.filter((l) => l.kind === "CALL")
  const failed = calls.filter((l) => l.f[1] !== "0").map((l) => `${l.f[0]} returned ${l.f[1]}`)
  const report = [
    "p08 · Crosscheck's Rust pieces in a flight, on MSFS 2024 (architecture plan, node 1.5)",
    `${new Date(t0).toISOString()}, ${how}; the client on SimConnect.dll through bindgen's declarations`,
    "",
    ...findings,
    "",
    `Page Down through Raw Input in sink mode: ${keysPressed.length} presses, ${keysInFront.length} with the sim in front.`,
    "",
    ...timing(),
    "",
    `Client calls: ${calls.length}, ${failed.length ? `failed: ${failed.join("; ")}` : "every one returned S_OK"}.`,
    `Exceptions: ${exceptions.join("; ") || "none"}.`,
    `Client exit: ${clientExited ?? "still running when the report was written"}.`,
  ].join("\n")
  console.log("\n" + report)
  rec.writeReport(report)
  await rec.close()
  console.log(`\nsaved ${repoRelative(rec.files.txt)}`)
  process.exit(0)
}
