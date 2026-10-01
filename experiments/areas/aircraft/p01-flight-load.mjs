/*
 * p01: does SimConnect_FlightLoad load a flight on MSFS 2024, from the main menu
 * and from inside a flight, when the flight file names another aircraft?
 *
 * The harness that runs tests with nobody at the sim depends on it, and nobody
 * in our records has called it. A forum thread reports that on MSFS 2024 it
 * loads, but puts an air start on the ground until Ready to Fly is clicked
 * (unverified: MSFS DevSupport, "Loading a saved flight via Simconnect is not
 * working", 2024-11-22).
 *
 * It asks the sim through node-simconnect to load three flights in turn:
 *
 *   1. flights/f1-pa24-gvac.flt         the A2A PA-24, from wherever the sim is; the main menu, expected
 *   2. flights/f0-fenix-a321-gvac.flt   the Fenix A321, from inside load 1's flight
 *   3. flights/f1-pa24-gvac.flt         the PA-24 again
 *
 * F0 is the sim's own CustomFlight.FLT of 2026-09-29, unchanged: the Fenix A321
 * holding short of runway 19 at GVAC. F1 is F0 with [Sim.0] naming the PA-24
 * (Sim, Livery, and TailNumber) and [LocalVars.0] emptied, so the aircraft is the
 * difference.
 *
 * A load passes when, within 180s of the request, a load event has arrived (the
 * flow event FLT_LOADED, or the system event FlightLoaded or AircraftLoaded);
 * TITLE, the position to within 1,000m, and SIM ON GROUND then match the file;
 * and the Sim system state reads 1, the user in control. It then watches a set
 * of A: and L: values until none changes for 10s, for up to 120s, and calls that
 * the aircraft settled. While a load runs, it lists the inspector's documents on
 * 127.0.0.1:19999 every 10s. After the first load that passes, it sets CAMERA
 * STATE to 3, chase, and back to 2, cockpit, reading it back each time.
 *
 * It prints one line per event as it happens, writes the same lines to
 * experiments/areas/aircraft/results/p01-flight-load-<time>.ndjson, and writes
 * the report it prints at the end to the .txt beside it. Paths under the
 * repository, %APPDATA%, %LOCALAPPDATA%, and the home folder are written with
 * those names in place of the folder. The sim's other strings go in as they
 * arrive, so read the results before committing them.
 *
 * Before running: the sim at the main menu, fscopilot-bridge out of Community,
 * GSX closed, and the Ready to Fly skip add-on installed. If load 1 doesn't reach
 * a flight, the probe asks you to start a free flight by hand, in any aircraft
 * but the Fenix A321, and runs loads 2 and 3 from inside it. Ctrl+C stops it,
 * still writes the report, and puts the camera back in the cockpit if the probe
 * moved it.
 *
 *   node experiments/areas/aircraft/p01-flight-load.mjs [--port <n>] [--no-event-gate]
 *   node experiments/areas/aircraft/p01-flight-load.mjs --dry-run
 *
 * --port connects to 127.0.0.1:<n>, a static port SimConnect.xml can define, in
 * place of node-simconnect finding the sim through the registry.
 * --no-event-gate passes a load on its readings alone, for a sim that loads the
 * flight without sending any of the three load events.
 * --dry-run reads both flight files, resolves every path, looks for each
 * aircraft and livery in Community, and prints the plan without connecting.
 */

import { createWriteStream, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { basename, dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import {
  DataRequestFlag,
  FlowEvent,
  Protocol,
  RawBuffer,
  SimConnectConstants,
  SimConnectDataType,
  SimConnectPeriod,
  open,
} from "node-simconnect"

import { listPages } from "../../tools/inspector.mjs"
import { REPO, repoRelative, resultFile, stamp } from "../../tools/results.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const F0 = join(HERE, "flights", "f0-fenix-a321-gvac.flt")
const F1 = join(HERE, "flights", "f1-pa24-gvac.flt")
const PLAN = [F1, F0, F1]

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes("--dry-run")
const EVENT_GATE = !argv.includes("--no-event-gate")
const portAt = argv.indexOf("--port")
const PORT = portAt === -1 ? null : Number(argv[portAt + 1])

const LOAD_TIMEOUT_MS = 180_000
const POSITION_TOLERANCE_M = 1_000
const STALL_MS = 30_000
const SETTLE_QUIET_MS = 10_000
const SETTLE_CAP_MS = 120_000
const PAGES_EVERY_MS = 10_000
const STATE_POLL_MS = 2_000
const CAMERA_HOLD_MS = 5_000
const MANUAL_WAIT_MS = 600_000

// MSFS 2024 SDK, Camera Variables, CAMERA STATE.
const CAMERA_STATES = [
  null, "forced custom target position", "cockpit", "chase plane drone", "fixed on plane",
  "environment 6DOF", "gameplay", "showcase", "drone plane", "waiting", "world map",
  "hangar RTC", "hangar custom", "menu RTC", "in-game RTC", "replay", "drone developer",
  "drone top down", "follow actor", "hangar", "old drone plane", "chase F18 plane", "ground",
  "follow air traffic plane", "first view", "drone photo mode", "third view", "transition",
  "catch object", "idle", "world map idle", "explore flightpath drone", "focus location",
  "worldmap transition",
]

const SYSTEM_EVENTS = [
  "FlightLoaded", "AircraftLoaded", "SimStart", "SimStop", "Sim", "Pause_EX1", "Crashed",
  "View", "PositionChanged",
]

const DEF = { POS: 1, TITLE: 2, LIVERY_FOLDER: 3, LIVERY_NAME: 4, CAMERA: 5, SETTLE: 6 }
const REQ = { POS: 1, TITLE: 2, LIVERY_FOLDER: 3, LIVERY_NAME: 4, CAMERA: 5, SETTLE: 6, SIM: 101, FLIGHT: 102, AIRCRAFT: 103 }

const POS_VARS = [
  ["PLANE LATITUDE", "degrees"],
  ["PLANE LONGITUDE", "degrees"],
  ["PLANE ALTITUDE", "feet"],
  ["SIM ON GROUND", "bool"],
]

// Switches and settings that move while an aircraft loads its start state, and
// that we expect to stay put once it's at rest, engines running or not; unlike
// RPM or fuel, none of them drifts on its own.
const SETTLE_A = [
  ["ELECTRICAL MASTER BATTERY:1", "bool"],
  ["AVIONICS MASTER SWITCH", "bool"],
  ["LIGHT BEACON", "bool"],
  ["LIGHT NAV", "bool"],
  ["LIGHT STROBE", "bool"],
  ["LIGHT LANDING", "bool"],
  ["BRAKE PARKING POSITION", "bool"],
  ["GENERAL ENG COMBUSTION:1", "bool"],
  ["FLAPS HANDLE INDEX", "number"],
  ["COM ACTIVE FREQUENCY:1", "MHz"],
  ["TRANSPONDER CODE:1", "number"],
]

// Each aircraft's own marks of a finished load. The PA-24 sets L:DATLoaded or
// L:DatNotFound once it's ready, and its tablet shows an error while neither is
// set (read in a2a-aircraft-pa24 2.1.3, A2ATabletAppComanche250.js, NotificationsDataPublisher). The Fenix
// sets switch variables when its systems program applies the panel state
// (record/areas/aircraft/fenix-a320-family/study.md). Reading L: through a data
// definition is documented and FS Copilot does it, but nobody in our records has
// measured it, so the report says how many of these returned a value.
const SETTLE_L = [
  { match: /PA-24/i, names: ["L:DATLoaded", "L:DatNotFound", "L:FlightPhase", "L:Battery1Switch"] },
  { match: /^Fenix/i, names: ["L:Panel_state", "L:FNX_FLT_LOADED", "L:S_OH_ELEC_BAT1", "L:I_OH_ELEC_BAT1_L", "L:S_MIP_PARKING_BRAKE"] },
]

const started = Date.now()
const when = stamp(new Date(started))
const timeline = []
let ndjson = null
let RUN = null

const live = {
  handle: null, recvOpen: null, gone: null, stopping: false, finishing: false,
  sim: null, pause: null, flight: null, aircraft: null,
  title: null, titleAt: 0, liveryFolder: null, liveryName: null,
  lat: null, lon: null, alt: null, onGround: null, posAt: 0, loggedLat: null, loggedLon: null,
  camera: null, cameraLog: [], cameraMoved: false,
  settle: null, settleDefined: false,
  sent: new Map(), requestTimer: null, pollTimer: null,
}

// ---------------------------------------------------------------- flight files

// The sim writes flight files in Windows-1252 with CRLF line ends: the degree
// sign in a position is the byte 0xB0 (read in CustomFlight.FLT, 2026-09-29).
// latin1 decodes that byte to the same character.
function readFlight(path) {
  const text = readFileSync(path, "latin1")
  const sections = new Map()
  let current = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const head = /^\[(.+)\]$/.exec(line)
    if (head) {
      current = head[1].toLowerCase()
      if (!sections.has(current)) sections.set(current, new Map())
      continue
    }
    const eq = line.indexOf("=")
    if (current === null || eq <= 0) continue
    sections.get(current).set(line.slice(0, eq).trim().toLowerCase(), line.slice(eq + 1).trim())
  }
  const get = (section, key) => sections.get(section)?.get(key) ?? null
  const flight = {
    path,
    rel: repoRelative(path),
    bytes: Buffer.byteLength(text, "latin1"),
    crlf: text.includes("\r\n") && !/[^\r]\n/.test(text),
    title: get("sim.0", "sim"),
    livery: get("sim.0", "livery"),
    tail: get("sim.0", "tailnumber"),
    latText: get("simvars.0", "latitude"),
    lonText: get("simvars.0", "longitude"),
    lat: dms(get("simvars.0", "latitude")),
    lon: dms(get("simvars.0", "longitude")),
    altFt: Number(get("simvars.0", "altitude")),
    onGround: /^true$/i.test(get("simvars.0", "simonground") ?? "") ? 1 : 0,
    firstState: get("freeflight", "firstflightstate"),
    departure: [get("departure", "icao"), get("departure", "runwaynumber")].filter(Boolean).join(" runway "),
    localVars: sections.get("localvars.0")?.size ?? 0,
  }
  const missing = ["title", "lat", "lon"].filter((k) => flight[k] === null)
  if (missing.length) throw new Error(`${flight.rel}: no ${missing.join(", ")} in [Sim.0] or [SimVars.0]`)
  return flight
}

function dms(text) {
  const m = /^([NSEW])\s*([\d.]+)\D+([\d.]+)'\s*([\d.]+)"?$/.exec(text ?? "")
  if (!m) return null
  const v = Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600
  return m[1] === "S" || m[1] === "W" ? -v : v
}

// ---------------------------------------------------------------- dry run

function dryRun(flights) {
  const pkg = createRequire(import.meta.url)("node-simconnect/package.json")
  const community = communityDir()
  const out = []
  const say = (s = "") => out.push(s)

  say("p01 · dry run: what it would load, without connecting")
  say()
  say(`node-simconnect  ${pkg.version}, Protocol.SunRise (${Protocol.SunRise})`)
  say(`connects         ${PORT ? `127.0.0.1:${PORT}` : "through the registry, where the running sim publishes its pipe"}`)
  say(`inspector        127.0.0.1:19999, through experiments/tools/inspector.mjs`)
  say(`results          ${repoRelative(join(REPO, "experiments", "areas", "aircraft", "results"))}/p01-flight-load-<time>.ndjson and .txt`)
  say(`Community        ${community ? scrub(community) : "not found: no UserCfg.opt under %APPDATA%\\Microsoft Flight Simulator 2024"}`)

  let problems = 0
  for (const [label, path] of [["f1", F1], ["f0", F0]]) {
    const f = flights.get(path)
    const found = community ? findInCommunity(community, f.title, f.livery) : { title: null, livery: null }
    const sendable = f.path.length < SimConnectConstants.MAX_PATH && /^[\x20-\x7e]+$/.test(f.path)
    if (!f.crlf || !sendable) problems++
    say()
    say(`${label}  ${f.rel}, ${f.bytes.toLocaleString("en-US")} bytes, ${f.crlf ? "CRLF throughout" : "NOT CRLF throughout"}`)
    say(`    FlightLoad gets  ${scrub(f.path)} (${f.path.length} characters${sendable ? "" : "; too long or not ASCII for node-simconnect's 260-byte field"})`)
    say(`    aircraft   "${f.title}", ${found.title ?? "not found in Community (it may be a streamed package)"}`)
    say(`    livery     ${f.livery ?? "(none)"}, ${found.livery ?? "no folder of that name in Community"}`)
    say(`    tail       ${f.tail ?? "(none)"}`)
    say(`    position   ${f.lat.toFixed(6)}, ${f.lon.toFixed(6)}, ${f.altFt} ft, ${f.onGround ? "on the ground" : "airborne"} (from ${f.latText}, ${f.lonText})`)
    say(`    start      ${f.firstState ?? "(no FirstFlightState)"}${f.departure ? ` at ${f.departure}` : ""}`)
    say(`    LocalVars  ${f.localVars} entries`)
  }

  say()
  say("Plan")
  PLAN.forEach((path, i) => {
    const f = flights.get(path)
    const from = i === 0 ? "from wherever the sim is (the main menu, expected)" : `from inside load ${i}'s flight`
    say(`  ${i + 1}. ${basename(path)}  ${f.title}, ${from}`)
  })
  say(`  Each load: ${LOAD_TIMEOUT_MS / 1000}s to pass the gate (${EVENT_GATE ? "a load event, then" : "no load event needed;"} TITLE, position within ${POSITION_TOLERANCE_M.toLocaleString("en-US")}m, SIM ON GROUND, Sim 1),`)
  say(`  then up to ${SETTLE_CAP_MS / 1000}s for ${SETTLE_QUIET_MS / 1000}s without a change; inspector listed every ${PAGES_EVERY_MS / 1000}s.`)
  say(`  After the first load that passes: CAMERA STATE to 3 (chase) and back to 2 (cockpit), ${CAMERA_HOLD_MS / 1000}s each.`)
  say()
  say(problems ? `${problems} problem(s) above.` : "Nothing to fix. Not connected; nothing was sent.")
  console.log(out.join("\n"))
  return problems ? 1 : 0
}

function communityDir() {
  const cfg = join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "UserCfg.opt")
  if (!existsSync(cfg)) return null
  const m = /InstalledPackagesPath\s+"([^"]+)"/.exec(readFileSync(cfg, "latin1"))
  return m ? join(m[1], "Community") : null
}

function dirs(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => d.name)
  } catch {
    return []
  }
}

// Looks only where MSFS 2024 packages keep aircraft.cfg and livery folders, so it
// reads a few hundred directories, never a whole tree.
function findInCommunity(community, title, livery) {
  const found = { title: null, livery: null }
  const want = title.toLowerCase()
  for (const pkg of dirs(community)) {
    const planes = join(community, pkg, "SimObjects", "Airplanes")
    for (const plane of dirs(planes)) {
      const base = join(planes, plane)
      const cfgs = [join(base, "aircraft.cfg"), join(base, "common", "config", "aircraft.cfg")]
      for (const a of dirs(join(base, "presets"))) {
        for (const b of dirs(join(base, "presets", a))) cfgs.push(join(base, "presets", a, b, "config", "aircraft.cfg"))
      }
      for (const cfg of cfgs) {
        if (found.title || !existsSync(cfg)) continue
        const titles = [...readFileSync(cfg, "latin1").matchAll(/^\s*title\s*=\s*"?([^";\r\n]*?)"?\s*(?:;.*)?$/gim)]
        if (titles.some((m) => m[1].trim().toLowerCase() === want)) found.title = `in ${pkg}: ${relative(join(community, pkg), cfg)}`
      }
      if (!livery || found.livery) continue
      for (const a of dirs(join(base, "liveries"))) {
        const hit = dirs(join(base, "liveries", a)).find((b) => b.toLowerCase() === livery.toLowerCase())
        if (hit) found.livery = `in ${pkg}: ${relative(join(community, pkg), join(base, "liveries", a, hit))}`
      }
    }
  }
  return found
}

// ---------------------------------------------------------------- output

const SCRUB = [
  [REPO, "<repo>"],
  [process.env.LOCALAPPDATA, "%LOCALAPPDATA%"],
  [process.env.APPDATA, "%APPDATA%"],
  [homedir(), "%USERPROFILE%"],
].filter(([prefix]) => prefix)

function scrub(s) {
  if (typeof s !== "string") return s
  let out = s
  for (const [prefix, name] of SCRUB) {
    for (const form of new Set([prefix, prefix.replace(/\\/g, "/")])) {
      out = out.replace(new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), name)
    }
  }
  return out
}

const secs = (ms) => `${(ms / 1000).toFixed(1)}s`
const clock = (t) => `${new Date(t).toTimeString().slice(0, 8)}.${String(t % 1000).padStart(3, "0")}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fmt = (v) => (typeof v === "number" && !Number.isInteger(v) ? String(Math.round(v * 1e6) / 1e6) : String(v))
const cameraName = (v) => (v == null ? "unknown" : `${v} (${CAMERA_STATES[v] ?? "unlisted"})`)

function log(kind, text, fields = {}) {
  const t = Date.now()
  const rec = {
    t,
    s: Math.round(t - started) / 1000,
    kind,
    text: scrub(text),
    ...JSON.parse(JSON.stringify(fields, (k, v) => (typeof v === "string" ? scrub(v) : typeof v === "bigint" ? String(v) : v))),
  }
  timeline.push(rec)
  // Closing the connection on the way out fires a close event after the stream
  // has ended, and a write then would throw.
  if (ndjson && !ndjson.writableEnded) ndjson.write(JSON.stringify(rec) + "\n")
  console.log(`${clock(t)} ${`+${secs(t - started)}`.padStart(8)}  ${kind.padEnd(9)} ${rec.text}`)
  return rec
}

// ---------------------------------------------------------------- SimConnect

function send(label, call) {
  try {
    call()
  } catch (e) {
    log("error", `${label} threw: ${e.message}`)
    return null
  }
  const id = live.handle.getLastSentPacketID()
  live.sent.set(id, label)
  if (live.sent.size > 5000) live.sent.delete(live.sent.keys().next().value)
  return id
}

async function connect() {
  try {
    const { handle, recvOpen } = await open("CROSSCHECK p01-flight-load", Protocol.SunRise, PORT ? { host: "127.0.0.1", port: PORT } : undefined)
    live.handle = handle
    live.recvOpen = recvOpen
  } catch (e) {
    const why = e instanceof AggregateError ? e.errors.map((x) => x.message).join("; ") : e.message
    throw new Error(
      `could not connect to SimConnect: ${why}\n` +
      "Is MSFS 2024 running? node-simconnect finds the sim through the registry once the sim\n" +
      "has started; --port <n> tries a static port from SimConnect.xml instead.")
  }
  const o = live.recvOpen
  log("open", `${o.applicationName} ${o.applicationVersionMajor}.${o.applicationVersionMinor}.${o.applicationBuildMajor}.${o.applicationBuildMinor}, SimConnect ${o.simConnectVersionMajor}.${o.simConnectVersionMinor}.${o.simConnectBuildMajor}.${o.simConnectBuildMinor}`, {
    app: o.applicationName,
    appVersion: [o.applicationVersionMajor, o.applicationVersionMinor, o.applicationBuildMajor, o.applicationBuildMinor].join("."),
    simConnectVersion: [o.simConnectVersionMajor, o.simConnectVersionMinor, o.simConnectBuildMajor, o.simConnectBuildMinor].join("."),
  })

  const h = live.handle
  h.on("exception", (e) => {
    const what = live.sent.get(e.sendId) ?? `send ${e.sendId}`
    log("exception", `${e.exceptionName} (${e.exception}) on ${what}, parameter ${e.index}`, { exception: e.exception, name: e.exceptionName, sendId: e.sendId, index: e.index, sent: what })
  })
  h.on("event", onSystemEvent)
  h.on("eventFilename", onFilenameEvent)
  h.on("flowEvent", onFlowEvent)
  h.on("systemState", onSystemState)
  h.on("simObjectData", onData)
  h.on("quit", () => lost("the sim quit"))
  h.on("close", () => lost("the SimConnect connection closed"))
  h.on("error", (e) => lost(`SimConnect error: ${e.message}`))

  SYSTEM_EVENTS.forEach((name, i) => send(`subscribe ${name}`, () => h.subscribeToSystemEvent(i + 1, name)))
  send("subscribe flow events", () => h.subscribeToFlowEvent())

  // Tagged, because SimConnect rejects a datum it doesn't know after the call
  // returns, and a positional read then shifts every later value onto the wrong
  // variable (fsc-editor, docs/sim-vars/build/v1-log.md, "2026-08-23 — The `A:`
  // read crashed the app. Positional reads were the wrong shape.").
  POS_VARS.forEach(([name, units], i) =>
    send(`define ${name}`, () => h.addToDataDefinition(DEF.POS, name, units, SimConnectDataType.FLOAT64, 0, i)))
  send("define TITLE", () => h.addToDataDefinition(DEF.TITLE, "TITLE", null, SimConnectDataType.STRING256))
  send("define LIVERY FOLDER", () => h.addToDataDefinition(DEF.LIVERY_FOLDER, "LIVERY FOLDER", null, SimConnectDataType.STRING256))
  send("define LIVERY NAME", () => h.addToDataDefinition(DEF.LIVERY_NAME, "LIVERY NAME", null, SimConnectDataType.STRING256))
  send("define CAMERA STATE", () => h.addToDataDefinition(DEF.CAMERA, "CAMERA STATE", "enum", SimConnectDataType.FLOAT64))
  requestAll()

  pollStates()
  live.pollTimer = setInterval(pollStates, STATE_POLL_MS)
}

// Sent again after every load event, because whether a request on the user
// aircraft survives an aircraft change on MSFS 2024 isn't in our records.
// fsc-editor sends its request again under the same ID in the same way (fsc-editor,
// src/main/sim/session.ts, defineWatch). That a request sent again also sends the
// current values again, changed or not, is unverified. The gate doesn't depend on
// it, because every load in the plan changes the aircraft, and waitForFlight asks
// for an aircraft load 2 doesn't load.
function requestAll() {
  const h = live.handle
  const user = SimConnectConstants.OBJECT_ID_USER
  send("request position", () => h.requestDataOnSimObject(REQ.POS, DEF.POS, user, SimConnectPeriod.SECOND, DataRequestFlag.DATA_REQUEST_FLAG_TAGGED))
  for (const [req, def, label] of [[REQ.TITLE, DEF.TITLE, "TITLE"], [REQ.LIVERY_FOLDER, DEF.LIVERY_FOLDER, "LIVERY FOLDER"], [REQ.LIVERY_NAME, DEF.LIVERY_NAME, "LIVERY NAME"]]) {
    send(`request ${label}`, () => h.requestDataOnSimObject(req, def, user, SimConnectPeriod.SECOND, DataRequestFlag.DATA_REQUEST_FLAG_CHANGED))
  }
  send("request CAMERA STATE", () => h.requestDataOnSimObject(REQ.CAMERA, DEF.CAMERA, user, SimConnectPeriod.SIM_FRAME, DataRequestFlag.DATA_REQUEST_FLAG_CHANGED))
}

function scheduleRequests() {
  clearTimeout(live.requestTimer)
  live.requestTimer = setTimeout(() => { if (!live.gone) requestAll() }, 500)
}

function pollStates() {
  if (live.gone) return
  const h = live.handle
  send("state Sim", () => h.requestSystemState(REQ.SIM, "Sim"))
  send("state FlightLoaded", () => h.requestSystemState(REQ.FLIGHT, "FlightLoaded"))
  send("state AircraftLoaded", () => h.requestSystemState(REQ.AIRCRAFT, "AircraftLoaded"))
}

function lost(why) {
  if (live.gone || live.finishing) return
  live.gone = why
  clearInterval(live.pollTimer)
  log("lost", why)
}

function setState(key, value, text, extra = {}) {
  if (live[key] === value) return
  live[key] = value
  log("state", text, { [key]: value, ...extra })
}

// MSFS 2024 SDK, SimConnect_SubscribeToSystemEvent: Pause_EX1's flags, and View's
// from SimConnect.h, SIMCONNECT_VIEW_SYSTEM_EVENT_DATA.
function describeEvent(name, data) {
  const flags = (names) => names.filter(([bit]) => data & bit).map(([, n]) => n).join(" + ") || "none"
  if (name === "Sim") return `${data} (${data === 1 ? "running" : "not running"})`
  if (name === "Pause_EX1") return `${data} (${flags([[1, "full pause"], [2, "pause with sound"], [4, "active pause"], [8, "sim pause"]])})`
  if (name === "View") return `${data} (${flags([[1, "cockpit 2D"], [2, "cockpit virtual"], [4, "map"]])})`
  return String(data)
}

function onSystemEvent(e) {
  const name = SYSTEM_EVENTS[e.clientEventId - 1]
  if (!name) return
  if (name === "Sim") live.sim = e.data
  if (name === "Pause_EX1") live.pause = e.data
  log("system", `${name} ${describeEvent(name, e.data)}`, { event: name, data: e.data })
  if (name === "SimStart") scheduleRequests()
}

function onFilenameEvent(e) {
  const name = SYSTEM_EVENTS[e.clientEventId - 1]
  if (!name) return
  if (name === "FlightLoaded") live.flight = e.fileName
  if (name === "AircraftLoaded") live.aircraft = e.fileName
  log("system", `${name} ${e.fileName}`, { event: name, file: e.fileName, signal: true })
  scheduleRequests()
}

function onFlowEvent(e) {
  const name = FlowEvent[e.flowEventID] ?? `flow event ${e.flowEventID}`
  log("flow", `${name}${e.fltPath ? ` ${e.fltPath}` : ""}`, { flow: name, id: e.flowEventID, file: e.fltPath, signal: name === "FLT_LOADED" })
  if (["FLT_LOADED", "FLIGHT_START", "TELEPORT_DONE"].includes(name)) scheduleRequests()
}

function onSystemState(s) {
  // MSFS 2024 SDK, SimConnect_RequestSystemState: Sim is 1 while the user
  // controls the aircraft and 0 while the user navigates the UI.
  // A loaded flight or aircraft that changes here, with no event for it, still
  // counts as a load event; the first reading only says where the sim started.
  if (s.requestID === REQ.SIM) setState("sim", s.dataInteger, `Sim state ${s.dataInteger} (${s.dataInteger === 1 ? "user in control" : "user in the UI"})`)
  else if (s.requestID === REQ.FLIGHT) setState("flight", s.dataString, `FlightLoaded state ${s.dataString || "(empty)"}`, { signal: live.flight !== null })
  else if (s.requestID === REQ.AIRCRAFT) setState("aircraft", s.dataString, `AircraftLoaded state ${s.dataString || "(empty)"}`, { signal: live.aircraft !== null })
}

function readTagged(d, onValue) {
  for (let i = 0; i < d.defineCount && d.data.remaining() >= 12; i++) onValue(d.data.readInt32(), d.data.readFloat64())
}

function onData(d) {
  const now = Date.now()
  if (d.requestID === REQ.POS) {
    readTagged(d, (i, v) => {
      if (i === 0) live.lat = v
      else if (i === 1) live.lon = v
      else if (i === 2) live.alt = v
      else if (i === 3) {
        if (live.onGround !== null && live.onGround !== v) log("state", `SIM ON GROUND ${live.onGround} → ${v}`, { onGround: v })
        live.onGround = v
      }
    })
    live.posAt = now
    if (live.lat !== null && (live.loggedLat === null || distance(live.lat, live.lon, live.loggedLat, live.loggedLon) > 100)) {
      live.loggedLat = live.lat
      live.loggedLon = live.lon
      log("state", `position ${live.lat.toFixed(6)}, ${live.lon.toFixed(6)}, ${Math.round(live.alt)} ft, on ground ${live.onGround}`, { lat: live.lat, lon: live.lon, altFt: live.alt, onGround: live.onGround })
    }
  } else if (d.requestID === REQ.TITLE) {
    const title = d.data.readString256()
    live.titleAt = now
    setState("title", title, `TITLE ${JSON.stringify(title)}`)
  } else if (d.requestID === REQ.LIVERY_FOLDER) {
    const v = d.data.readString256()
    setState("liveryFolder", v, `LIVERY FOLDER ${JSON.stringify(v)}`)
  } else if (d.requestID === REQ.LIVERY_NAME) {
    const v = d.data.readString256()
    setState("liveryName", v, `LIVERY NAME ${JSON.stringify(v)}`)
  } else if (d.requestID === REQ.CAMERA) {
    const v = d.data.readFloat64()
    live.cameraLog.push({ t: now, v })
    setState("camera", v, `CAMERA STATE ${cameraName(v)}`)
  } else if (d.requestID === REQ.SETTLE) {
    readSettle(d)
  }
}

// ---------------------------------------------------------------- one load

function distance(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || !Number.isFinite(v))) return Infinity
  const rad = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a))
}

const same = (a, b) => typeof a === "string" && typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase()

// The title and position count only when read after the first load event, so a
// value left from the flight before can't pass the gate.
function conditions(r, flight) {
  const signal = timeline.find((e) => e.t >= r.t0 && e.signal)
  const after = !EVENT_GATE ? r.t0 : signal ? signal.t : Infinity
  return {
    signal: !EVENT_GATE || Boolean(signal),
    title: live.titleAt > after && same(live.title, flight.title),
    position: live.posAt > after && distance(live.lat, live.lon, flight.lat, flight.lon) <= POSITION_TOLERANCE_M,
    ground: live.posAt > after && live.onGround === flight.onGround,
    sim: live.sim === 1,
  }
}

// The aircraft matching the file by readings alone, with or without a load
// event, which tells "loaded, but no event said so" from "nothing happened".
function inPlace(r, flight) {
  return live.titleAt > r.t0 && same(live.title, flight.title) && live.posAt > r.t0 &&
    distance(live.lat, live.lon, flight.lat, flight.lon) <= POSITION_TOLERANCE_M && live.onGround === flight.onGround
}

async function runLoad(n, flight) {
  const r = {
    n, flight, t0: Date.now(), from: live.sim === 1 ? "inside a flight" : live.sim === 0 ? "the UI (main menu)" : "an unknown state",
    met: {}, missing: [], passed: false, gateMs: null, failed: null, stall: null,
    pages: [], seen: null, settle: null, sendId: null, end: null,
  }
  log("load", `${n} of ${PLAN.length}: ${flight.rel}, ${flight.title} (${flight.livery}), from ${r.from}`, { load: n, file: flight.rel, title: flight.title, livery: flight.livery, from: r.from })
  r.sendId = send(`FlightLoad ${flight.rel}`, () => live.handle.flightLoad(flight.path))
  const pages = watchPages(r)
  let c = conditions(r, flight)
  let stallSince = null
  try {
    while (!live.gone && !live.stopping) {
      const now = Date.now()
      c = conditions(r, flight)
      for (const [k, ok] of Object.entries(c)) {
        if (ok && r.met[k] === undefined) {
          r.met[k] = now - r.t0
          log("gate", `${n}: ${k} met at ${secs(r.met[k])}`, { load: n, condition: k, ms: r.met[k] })
        }
      }
      const placed = inPlace(r, flight)
      if (placed && r.met.inPlace === undefined) {
        r.met.inPlace = now - r.t0
        log("gate", `${n}: the aircraft reads as the file's, by TITLE, position, and SIM ON GROUND, at ${secs(r.met.inPlace)}`, { load: n, condition: "inPlace", ms: r.met.inPlace })
      }
      if (Object.values(c).every(Boolean)) {
        r.passed = true
        r.gateMs = now - r.t0
        break
      }
      // The aircraft in place with the user still in the UI is how a flight
      // waiting on Ready to Fly, or on any dialog, would look from here.
      if (placed && !c.sim) {
        stallSince ??= now
        if (!r.stall && now - stallSince >= STALL_MS) {
          r.stall = { ms: now - r.t0, sim: live.sim, camera: live.camera }
          log("stall", `${n}: the aircraft is in place, but Sim has read ${live.sim} for ${secs(now - stallSince)}, so the flight hasn't started; camera ${cameraName(live.camera)}`, { load: n, sim: live.sim, camera: live.camera })
        }
      } else {
        stallSince = null
      }
      if (now - r.t0 >= LOAD_TIMEOUT_MS) break
      await sleep(250)
    }
    r.seen = {
      title: live.title, liveryFolder: live.liveryFolder, liveryName: live.liveryName,
      distanceM: distance(live.lat, live.lon, flight.lat, flight.lon), altFt: live.alt,
      onGround: live.onGround, sim: live.sim, camera: live.camera, pause: live.pause,
    }
    r.missing = Object.entries(c).filter(([, ok]) => !ok).map(([k]) => k)
    if (r.passed) {
      log("pass", `${n}: passed at ${secs(r.gateMs)}; ${Math.round(r.seen.distanceM)} m from the file's position, camera ${cameraName(live.camera)}`, { load: n, ms: r.gateMs, distanceM: r.seen.distanceM })
      r.settle = await settle(r, flight)
    } else {
      r.failed = live.gone ? `the connection was lost: ${live.gone}` : live.stopping ? "stopped by hand" : `timed out at ${LOAD_TIMEOUT_MS / 1000}s`
      log("fail", `${n}: ${r.failed}; not met: ${r.missing.join(", ")}`, { load: n, failed: r.failed, missing: r.missing })
    }
  } finally {
    pages.stop()
    r.end = Date.now()
  }
  return r
}

// fsc-editor measured a Black Square Bonanza's L: variables still arriving 35s
// after its load (fsc-editor, docs/sim-vars/build/v1-log.md, "2026-08-27 — The
// settle rule did not fail here, and one aircraft was two"), hence the 120s cap.
async function settle(r, flight) {
  const h = live.handle
  const user = SimConnectConstants.OBJECT_ID_USER
  const lNames = SETTLE_L.find((s) => s.match.test(flight.title))?.names ?? []
  const vars = [...SETTLE_A, ...lNames.map((name) => [name, "number"])]
  const s = { names: vars.map(([name]) => name), values: new Map(), changes: new Map(), last: null, lastChangeAt: Date.now(), startedAt: Date.now() }
  live.settle = s
  if (live.settleDefined) send("settle: clear definition", () => h.clearDataDefinition(DEF.SETTLE))
  vars.forEach(([name, units], i) =>
    send(`settle: define ${name}`, () => h.addToDataDefinition(DEF.SETTLE, name, units, SimConnectDataType.FLOAT64, 0, i)))
  live.settleDefined = true
  send("settle: request", () => h.requestDataOnSimObject(REQ.SETTLE, DEF.SETTLE, user, SimConnectPeriod.SIM_FRAME, DataRequestFlag.DATA_REQUEST_FLAG_CHANGED | DataRequestFlag.DATA_REQUEST_FLAG_TAGGED))
  log("settle", `${r.n}: watching ${vars.length} values, ${lNames.length} of them L:, until none changes for ${SETTLE_QUIET_MS / 1000}s`)

  while (!live.gone && !live.stopping) {
    const now = Date.now()
    if (now - s.lastChangeAt >= SETTLE_QUIET_MS || now - s.startedAt >= SETTLE_CAP_MS) break
    await sleep(250)
  }
  if (!live.gone) send("settle: stop", () => h.requestDataOnSimObject(REQ.SETTLE, DEF.SETTLE, user, SimConnectPeriod.NEVER, DataRequestFlag.DATA_REQUEST_FLAG_DEFAULT))
  live.settle = null

  const quiet = Date.now() - s.lastChangeAt >= SETTLE_QUIET_MS
  const busiest = [...s.changes].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, k]) => `${name} ×${k}`)
  const result = {
    settled: quiet,
    ms: quiet ? s.lastChangeAt - r.t0 : null,
    last: s.last,
    answered: s.values.size,
    total: s.names.length,
    lAnswered: lNames.filter((name) => s.values.has(name)).length,
    lTotal: lNames.length,
    silent: s.names.filter((name) => !s.values.has(name)),
    busiest,
  }
  log("settle", quiet
    ? `${r.n}: settled at ${secs(result.ms)} after the request; the last change was ${s.last ?? "the first reading"}`
    : `${r.n}: still changing after ${SETTLE_CAP_MS / 1000}s: ${busiest.join(", ")}`, { load: r.n, ...result })
  return result
}

function readSettle(d) {
  const s = live.settle
  if (!s) return
  readTagged(d, (i, v) => {
    const name = s.names[i]
    if (!name) return
    const had = s.values.has(name)
    const before = s.values.get(name)
    s.values.set(name, v)
    if (had && before === v) return
    s.lastChangeAt = Date.now()
    s.last = name
    const count = (s.changes.get(name) ?? 0) + 1
    s.changes.set(name, count)
    if (count <= 5) log("settle", had ? `${name} ${fmt(before)} → ${fmt(v)}` : `${name} = ${fmt(v)}`, { name, from: had ? before : null, to: v })
    else if (count === 6) log("settle", `${name} keeps changing; counted from here, not printed`, { name })
  })
}

function watchPages(r) {
  let stopped = false
  let busy = false
  let lastOthers = null
  const tick = async () => {
    if (stopped || busy) return
    busy = true
    const t = Date.now()
    try {
      const pages = await listPages()
      const isPanel = (p) => /^VCockpit/i.test(String(p.title ?? ""))
      const others = pages.filter((p) => !isPanel(p)).map((p) => `${p.title || "(untitled)"} <${p.url ?? ""}>`)
      const panels = pages.length - others.length
      r.pages.push({ t, up: true, total: pages.length, panels })
      const changed = others.join("\n") !== lastOthers
      lastOthers = others.join("\n")
      log("pages", `${r.n}: ${pages.length} documents, ${panels} VCockpit; others ${changed ? (others.length ? others.join(", ") : "none") : "as before"}`, { load: r.n, up: true, total: pages.length, panels, others })
    } catch (e) {
      r.pages.push({ t, up: false })
      log("pages", `${r.n}: the inspector isn't answering on 127.0.0.1:19999`, { load: r.n, up: false, error: e.message.split("\n")[0] })
    } finally {
      busy = false
    }
  }
  tick()
  const timer = setInterval(tick, PAGES_EVERY_MS)
  return { stop() { stopped = true; clearInterval(timer) } }
}

// ---------------------------------------------------------------- camera

function writeCamera(state) {
  const buffer = new RawBuffer(8)
  buffer.writeFloat64(state)
  return send(`set CAMERA STATE ${state}`, () =>
    live.handle.setDataOnSimObject(DEF.CAMERA, SimConnectConstants.OBJECT_ID_USER, { buffer, arrayCount: 0, tagged: false }))
}

// CAMERA STATE is settable (MSFS 2024 SDK, Camera Variables), and unmeasured by
// us. ChasePlane is installed, and CustomFlight.FLT carries its camera API
// heartbeat in L:p42_cp_camera_api_heartbeat, so it may take the camera back
// (unverified); the 5s hold is there to see that.
async function cameraTest(afterLoad) {
  const result = { afterLoad, before: live.camera, steps: [] }
  log("camera", `CAMERA STATE reads ${cameraName(live.camera)} before the switch`)
  for (const target of [3, 2]) {
    const from = Date.now()
    writeCamera(target)
    live.cameraMoved = true
    log("camera", `set CAMERA STATE to ${cameraName(target)}`)
    await sleep(CAMERA_HOLD_MS)
    const values = live.cameraLog.filter((e) => e.t >= from).map((e) => e.v)
    const outcome = live.camera === target ? "held" : values.includes(target) ? "reverted" : "ignored"
    result.steps.push({ target, values, final: live.camera, outcome })
    log("camera", `${cameraName(target)}: ${outcome}; read ${values.length ? values.map(fmt).join(" → ") : "no change"} in ${CAMERA_HOLD_MS / 1000}s, now ${cameraName(live.camera)}`, { target, values, final: live.camera, outcome })
    if (live.gone || live.stopping) break
  }
  if (live.camera === 2) live.cameraMoved = false
  return result
}

// ---------------------------------------------------------------- the run

async function waitForFlight() {
  log("manual", "No flight is running. To test loading from inside one, start a free flight by hand now, in any aircraft but the Fenix A321, which load 2 loads. The probe carries on once Sim reads 1, and gives up after 10 min.")
  const until = Date.now() + MANUAL_WAIT_MS
  while (!live.gone && !live.stopping && Date.now() < until) {
    if (live.sim === 1) {
      log("manual", `a flight is running: ${live.title ?? "(no TITLE read yet)"}`)
      await sleep(5000)
      return true
    }
    await sleep(1000)
  }
  log("manual", "no flight started; skipping the remaining loads")
  return false
}

async function main() {
  const flights = new Map([[F0, readFlight(F0)], [F1, readFlight(F1)]])
  if (DRY_RUN) return dryRun(flights)

  process.on("SIGINT", () => {
    if (live.stopping) process.exit(1)
    live.stopping = true
    log("stop", "Ctrl+C: finishing the current step and writing the report; Ctrl+C again quits at once")
  })

  log("start", `p01 · SimConnect_FlightLoad on MSFS 2024; plan ${PLAN.map((p) => basename(p)).join(", ")}`)
  await connect()

  // Opened once connected, so a run that never reached the sim leaves no file.
  const run = RUN = {
    ndjsonFile: resultFile("aircraft", "p01-flight-load", "ndjson", when),
    txtFile: resultFile("aircraft", "p01-flight-load", "txt", when),
    loads: [], camera: null, start: null,
  }
  ndjson = createWriteStream(run.ndjsonFile)
  for (const rec of timeline) ndjson.write(JSON.stringify(rec) + "\n")

  await sleep(3000)
  run.start = { sim: live.sim, flight: live.flight, aircraft: live.aircraft, title: live.title, camera: live.camera }
  log("start", `the sim is ${live.sim === 1 ? "in a flight" : live.sim === 0 ? "in the UI" : "in an unknown state"}; FlightLoaded ${live.flight || "(none)"}; camera ${cameraName(live.camera)}`)

  for (let i = 0; i < PLAN.length; i++) {
    if (live.gone || live.stopping) break
    const before = run.loads[i - 1]
    if (before && !before.passed && live.sim !== 1 && !(await waitForFlight())) break
    const r = await runLoad(i + 1, flights.get(PLAN[i]))
    run.loads.push(r)
    if (r.passed && !run.camera && !live.gone && !live.stopping) run.camera = await cameraTest(r.n)
  }
  await finish(run)
}

async function finish(run) {
  if (live.finishing) return
  live.finishing = true
  clearInterval(live.pollTimer)
  clearTimeout(live.requestTimer)
  if (live.cameraMoved && !live.gone && live.camera !== 2) {
    writeCamera(2)
    log("camera", "put CAMERA STATE back to 2 (cockpit) on the way out")
    await sleep(1000)
  }
  const text = report(run)
  console.log("\n" + text)
  writeFileSync(run.txtFile, text + "\n")
  console.log(`\nsaved ${repoRelative(run.txtFile)}`)
  console.log(`saved ${repoRelative(run.ndjsonFile)}`)
  try { live.handle?.close() } catch { /* already closed */ }
  await new Promise((resolve) => ndjson.end(resolve))
}

// ---------------------------------------------------------------- report

function label(e) {
  if (e.kind === "flow") return `flow ${e.flow}${e.file ? ` ${basename(String(e.file).replace(/\\/g, "/"))}` : ""}`
  if (e.kind === "system") return `${e.event}${e.file ? ` ${basename(String(e.file).replace(/\\/g, "/"))}` : ` ${e.data}`}`
  if (e.kind === "exception") return `exception ${e.name} on ${e.sent}`
  if (e.kind === "state" && "sim" in e) return `Sim state ${e.sim}`
  if (e.kind === "state" && "camera" in e) return `camera ${e.camera}`
  if (e.kind === "state" && "title" in e) return `TITLE ${JSON.stringify(e.title)}`
  if (e.kind === "state" && "flight" in e) return `FlightLoaded state ${basename(String(e.flight).replace(/\\/g, "/"))}`
  if (e.kind === "state" && "aircraft" in e) return "AircraftLoaded state changed"
  if (e.kind === "stall") return "stall"
  return null
}

function report(run) {
  const o = live.recvOpen
  const lines = []
  const say = (s = "") => lines.push(s)
  say("p01 · SimConnect_FlightLoad on MSFS 2024")
  say(`${new Date(started).toISOString()}, node-simconnect ${createRequire(import.meta.url)("node-simconnect/package.json").version}` +
    (o ? `, ${o.applicationName} ${o.applicationVersionMajor}.${o.applicationVersionMinor}.${o.applicationBuildMajor}.${o.applicationBuildMinor}` : ", never connected"))
  if (run.start) {
    say(`At the start the sim was ${run.start.sim === 1 ? "in a flight" : run.start.sim === 0 ? "in the UI" : "in an unknown state"}, ` +
      `with FlightLoaded ${scrub(run.start.flight) || "(none)"}, TITLE ${JSON.stringify(run.start.title)}, camera ${cameraName(run.start.camera)}.`)
  }

  for (const r of run.loads) {
    const f = r.flight
    say()
    say(`Load ${r.n}  ${f.rel}  "${f.title}", livery ${f.livery}, from ${r.from}`)
    if (r.passed) {
      say(`  PASSED at ${secs(r.gateMs)}; ` + (r.settle?.settled
        ? `settled at ${secs(r.settle.ms)}, the last change ${r.settle.last ?? "the first reading"}`
        : `not settled within ${SETTLE_CAP_MS / 1000}s; still changing: ${r.settle?.busiest.join(", ") || "unknown"}`))
    } else {
      say(`  FAILED: ${r.failed}; not met: ${r.missing.join(", ")}`)
    }
    if (r.seen) {
      say(`  read: TITLE ${JSON.stringify(r.seen.title)}; LIVERY FOLDER ${JSON.stringify(r.seen.liveryFolder)}; LIVERY NAME ${JSON.stringify(r.seen.liveryName)}`)
      say(`        ${Number.isFinite(r.seen.distanceM) ? `${Math.round(r.seen.distanceM)} m` : "no position"} from the file's position, ${r.seen.altFt == null ? "?" : Math.round(r.seen.altFt)} ft, on ground ${r.seen.onGround}, Sim ${r.seen.sim}, pause flags ${r.seen.pause}, camera ${cameraName(r.seen.camera)}`)
    }
    const met = Object.entries(r.met).map(([k, ms]) => `${k} ${secs(ms)}`)
    say(`  conditions met: ${met.length ? met.join(", ") : "none"}`)
    // Sim already 1 before an in-flight load, and never dropping, means the
    // gate's sim condition proves nothing about that load's flight starting.
    const simChanges = timeline.filter((e) => e.t >= r.t0 && e.t <= r.end && ((e.kind === "state" && "sim" in e) || e.event === "Sim"))
      .map((e) => `${"sim" in e ? e.sim : e.data} at +${secs(e.t - r.t0)}`)
    say(`  Sim during the load: ${simChanges.length ? simChanges.join(", ") : `no change from ${r.from === "inside a flight" ? 1 : "its value at the request"}`}`)
    if (r.stall) say(`  STALL at ${secs(r.stall.ms)}: the aircraft was in place while Sim read ${r.stall.sim}, camera ${cameraName(r.stall.camera)}`)
    if (r.settle) {
      say(`  settle values: ${r.settle.answered} of ${r.settle.total} returned a value; L: through SimConnect ${r.settle.lAnswered} of ${r.settle.lTotal}` +
        (r.settle.silent.length ? `; silent: ${r.settle.silent.join(", ")}` : ""))
    }
    const events = timeline.filter((e) => e.t >= r.t0 && e.t <= r.end).map((e) => [e.t, label(e)]).filter(([, l]) => l)
    const shown = events.slice(0, 40).map(([t, l]) => `+${secs(t - r.t0)} ${l}`)
    say(`  events: ${shown.length ? shown.join(" · ") : "none"}${events.length > 40 ? ` · and ${events.length - 40} more` : ""}`)
    const up = r.pages.filter((p) => p.up)
    say(`  inspector: ${r.pages.length} listings, ${r.pages.length - up.length} with the port down` +
      (up.length ? `, ${Math.min(...up.map((p) => p.total))} to ${Math.max(...up.map((p) => p.total))} documents, up to ${Math.max(...up.map((p) => p.panels))} VCockpit` : ""))
  }

  say()
  if (run.camera) {
    say(`Camera, after load ${run.camera.afterLoad}: before ${cameraName(run.camera.before)}; ` +
      run.camera.steps.map((s) => `set ${s.target}: ${s.outcome} (read ${s.values.length ? s.values.map(fmt).join(" → ") : "no change"})`).join("; "))
  } else {
    say("Camera: not tried, because no load passed.")
  }

  const exceptions = timeline.filter((e) => e.kind === "exception")
  const flightLoadIds = new Set(run.loads.map((r) => r.sendId).filter((id) => id !== null))
  const onLoads = exceptions.filter((e) => flightLoadIds.has(e.sendId))
  const grouped = new Map()
  for (const e of exceptions) grouped.set(`${e.name} on ${e.sent}`, (grouped.get(`${e.name} on ${e.sent}`) ?? 0) + 1)
  say(`Exceptions: ${exceptions.length ? [...grouped].map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ""}`).join("; ") : "none"}`)
  if (onLoads.length) say(`  ${onLoads.length} of them on a FlightLoad request.`)
  if (live.gone) say(`The connection was lost: ${live.gone}.`)

  say()
  say(`Next: ${nextStep(run)}`)
  return lines.join("\n")
}

function nextStep(run) {
  const loads = run.loads
  if (!loads.length) return "no load ran. Fix whatever stopped it above and run the probe again."
  if (loads.every((r) => r.passed)) {
    return `all ${loads.length} loads passed, so SimConnect_FlightLoad works from ${loads[0].from} and from inside a flight, ` +
      "with a file naming another aircraft. The harness can load a flight file per aircraft, and each aircraft's settle time above is its wait."
  }
  const r = loads.find((x) => !x.passed)
  const tookIt = timeline.some((e) => e.t >= r.t0 && e.t <= r.end && (e.signal || e.flow === "FLT_LOAD"))
  if (r.failed?.startsWith("the connection was lost")) {
    return `the sim went away during load ${r.n}. If it crashed, the load itself may be the cause: run the probe again with only that file before building on FlightLoad.`
  }
  if (r.met.inPlace !== undefined && r.met.signal === undefined) {
    return `load ${r.n} put the aircraft in place, but no load event arrived, so the harness has to gate a load on readings rather than events. Run the probe again with --no-event-gate to see whether the rest of the plan passes.`
  }
  if (!tookIt) {
    return `load ${r.n} drew no load event at all, so the sim did nothing visible with the request. ` +
      "Send the same file through the SDK's own SimConnect.dll, with a SimConnect_FlightLoad binding added to the a2a-fm-probe's simconnect.py " +
      "(%USERPROFILE%\\Desktop\\work\\temp\\a2a-fm-probe), to tell a node-simconnect packet problem from the sim ignoring the call; then try the path without its extension."
  }
  if (r.stall) {
    return `load ${r.n} put the aircraft in place but the flight never started. Look at the sim's screen: if Ready to Fly is showing, the skip add-on doesn't act on a SimConnect load, and the harness needs another way past it.`
  }
  if (r.missing.includes("title")) {
    return `load ${r.n} loaded something, but TITLE never read "${r.flight.title}". Compare [Sim.0] Sim with the titles SimConnect_EnumerateSimObjectsAndLiveries returns.`
  }
  if (r.missing.includes("position") || r.missing.includes("ground")) {
    return `load ${r.n} loaded the aircraft away from the file's [SimVars.0] position or ground state. The sim may place it from [Departure] and FirstFlightState instead; try a copy without [Departure].`
  }
  if (r.missing.includes("sim")) {
    return `load ${r.n} matched the file, but Sim never read 1. Check the sim's screen for a dialog, and whether the Sim state reads 1 in a flight at all on MSFS 2024.`
  }
  if (!loads[0].passed && loads.slice(1).some((x) => x.passed)) {
    return "loading works from inside a flight but not from where load 1 started, so the harness needs a person to start its first flight."
  }
  return `load ${r.n} failed (${r.failed}); read its events above.`
}

main().then((code) => {
  if (typeof code === "number") process.exitCode = code
  if (!DRY_RUN) process.exit(0)
}).catch(async (e) => {
  // Before the run starts, the failures are expected ones, such as no sim, and
  // the message says what to do; after it, a stack says where the probe broke.
  console.error(`\n${scrub(RUN ? e.stack ?? e.message : e.message)}\n`)
  if (RUN) {
    log("error", `the probe failed: ${e.message}`)
    await finish(RUN).catch(() => {})
  }
  process.exit(1)
})
