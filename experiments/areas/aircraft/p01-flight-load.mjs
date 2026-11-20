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
 * (Sim, Livery, and TailNumber) and the A321's state sections removed, so the
 * aircraft is the difference.
 *
 * The load gate and the settle wait are the harness's, in lib/load.mjs, which
 * says what passes a load and when an aircraft has settled. While a load runs,
 * it lists the inspector's documents on 127.0.0.1:19999 every 10s. After the
 * first load that passes, it sets CAMERA STATE to 3, chase, and back to 2,
 * cockpit, reading it back each time.
 *
 * It prints one line per event as it happens, writes the same lines to
 * experiments/areas/aircraft/results/p01-flight-load-<time>.ndjson, and writes
 * the report it prints at the end to the .txt beside it (lib/out.mjs).
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
 * aircraft and livery among the packages, and prints the plan without connecting.
 */

import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { Protocol } from "node-simconnect"

import { communityDir, findAircraft, readFlight } from "./lib/flights.mjs"
import { LOAD_TIMEOUT_MS, POSITION_TOLERANCE_M, loadFlight, settle } from "./lib/load.mjs"
import { REPO, Recorder, fmt, repoRelative, scrub, secs, sleep } from "./lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "./lib/sim.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const F0 = join(HERE, "flights", "f0-fenix-a321-gvac.flt")
const F1 = join(HERE, "flights", "f1-pa24-gvac.flt")
const PLAN = [F1, F0, F1]

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes("--dry-run")
const EVENT_GATE = !argv.includes("--no-event-gate")
const portAt = argv.indexOf("--port")
const PORT = portAt === -1 ? null : Number(argv[portAt + 1])

const SETTLE_QUIET_MS = 10_000
const SETTLE_CAP_MS = 120_000
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

// Each aircraft's own marks of a finished load. The PA-24 sets L:DATLoaded or
// L:DatNotFound once it's ready, and its tablet shows an error while neither is
// set (read in a2a-aircraft-pa24 2.1.3, A2ATabletAppComanche250.js,
// NotificationsDataPublisher). The Fenix sets switch variables when its systems
// program applies the panel state (read in the program's own log,
// %PROGRAMDATA%\Fenix\FenixSim A320\logs\log-System.txt, "Quickstart:Writing").
const SETTLE_L = [
  { match: /PA-24/i, names: ["L:DATLoaded", "L:DatNotFound", "L:FlightPhase", "L:Battery1Switch"] },
  { match: /^Fenix/i, names: ["L:Panel_state", "L:FNX_FLT_LOADED", "L:S_OH_ELEC_BAT1", "L:I_OH_ELEC_BAT1_L", "L:S_MIP_PARKING_BRAKE"] },
]

const rec = new Recorder("p01-flight-load")
let sim = null
let RUN = null
const cam = { value: null, log: [], moved: false, watch: null }
let stopping = false
let finishing = false

const cameraName = (v) => (v == null ? "unknown" : `${v} (${CAMERA_STATES[v] ?? "unlisted"})`)

// ---------------------------------------------------------------- dry run

function dryRun(flights) {
  const community = communityDir()
  const out = []
  const say = (s = "") => out.push(s)

  say("p01 · dry run: what it would load, without connecting")
  say()
  say(`node-simconnect  ${NODE_SIMCONNECT}, Protocol.SunRise (${Protocol.SunRise})`)
  say(`connects         ${PORT ? `127.0.0.1:${PORT}` : "through the registry, where the running sim publishes its pipe"}`)
  say(`inspector        127.0.0.1:19999, through experiments/tools/inspector.mjs`)
  say(`results          ${repoRelative(join(REPO, "experiments", "areas", "aircraft", "results"))}/p01-flight-load-<time>.ndjson and .txt`)
  say(`Community        ${community ? scrub(community) : "not found: no UserCfg.opt under %APPDATA%\\Microsoft Flight Simulator 2024"}`)

  let problems = 0
  for (const [label, path] of [["f1", F1], ["f0", F0]]) {
    const f = flights.get(path)
    const found = community ? findAircraft(f.title, f.livery) : { title: null, livery: null }
    const sendable = f.path.length < 260 && /^[\x20-\x7e]+$/.test(f.path)
    if (!f.crlf || !sendable) problems++
    say()
    say(`${label}  ${f.rel}, ${f.bytes.toLocaleString("en-US")} bytes, ${f.crlf ? "CRLF throughout" : "NOT CRLF throughout"}`)
    say(`    FlightLoad gets  ${scrub(f.path)} (${f.path.length} characters${sendable ? "" : "; too long or not ASCII for node-simconnect's 260-byte field"})`)
    say(`    aircraft   "${f.title}", ${found.title ? `in ${found.title}` : "not found in a readable aircraft.cfg (it may be a streamed package)"}`)
    say(`    livery     ${f.livery ?? "(none)"}, ${found.livery ? `in ${found.livery}` : "no folder of that name among the packages"}`)
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
  say(`  then up to ${SETTLE_CAP_MS / 1000}s for ${SETTLE_QUIET_MS / 1000}s without a change; inspector listed every 10s.`)
  say(`  After the first load that passes: CAMERA STATE to 3 (chase) and back to 2 (cockpit), ${CAMERA_HOLD_MS / 1000}s each.`)
  say()
  say(problems ? `${problems} problem(s) above.` : "Nothing to fix. Not connected; nothing was sent.")
  console.log(out.join("\n"))
  return problems ? 1 : 0
}

// ---------------------------------------------------------------- camera

// Sent again after every load, because whether a request on the user aircraft
// survives an aircraft change on MSFS 2024 isn't in our records.
function watchCamera() {
  cam.watch?.stop()
  cam.watch = sim.watch([["CAMERA STATE", "enum"]], {
    period: "frame",
    label: "camera",
    onChange: (name, v) => {
      cam.log.push({ t: Date.now(), v })
      if (cam.value === v) return
      cam.value = v
      rec.log("state", `CAMERA STATE ${cameraName(v)}`, { camera: v })
    },
  })
}

// CAMERA STATE is settable (MSFS 2024 SDK, Camera Variables), and unmeasured by
// us. ChasePlane is installed, and CustomFlight.FLT carries its camera API
// heartbeat in L:p42_cp_camera_api_heartbeat, so it may take the camera back
// (unverified); the 5s hold is there to see that.
async function cameraTest(afterLoad) {
  const result = { afterLoad, before: cam.value, steps: [] }
  rec.log("camera", `CAMERA STATE reads ${cameraName(cam.value)} before the switch`)
  for (const target of [3, 2]) {
    const from = Date.now()
    sim.write("CAMERA STATE", "enum", target)
    cam.moved = true
    rec.log("camera", `set CAMERA STATE to ${cameraName(target)}`)
    await sleep(CAMERA_HOLD_MS)
    const values = cam.log.filter((e) => e.t >= from).map((e) => e.v)
    const outcome = cam.value === target ? "held" : values.includes(target) ? "reverted" : "ignored"
    result.steps.push({ target, values, final: cam.value, outcome })
    rec.log("camera", `${cameraName(target)}: ${outcome}; read ${values.length ? values.map(fmt).join(" → ") : "no change"} in ${CAMERA_HOLD_MS / 1000}s, now ${cameraName(cam.value)}`, { target, values, final: cam.value, outcome })
    if (sim.gone || stopping) break
  }
  if (cam.value === 2) cam.moved = false
  return result
}

// ---------------------------------------------------------------- the run

async function waitForFlight() {
  rec.log("manual", "No flight is running. To test loading from inside one, start a free flight by hand now, in any aircraft but the Fenix A321, which load 2 loads. The probe carries on once Sim reads 1, and gives up after 10 min.")
  const until = Date.now() + MANUAL_WAIT_MS
  while (!sim.gone && !stopping && Date.now() < until) {
    if (sim.live.sim === 1) {
      rec.log("manual", `a flight is running: ${sim.live.title ?? "(no TITLE read yet)"}`)
      await sleep(5000)
      return true
    }
    await sleep(1000)
  }
  rec.log("manual", "no flight started; skipping the remaining loads")
  return false
}

async function runLoad(n, flight) {
  const r = await loadFlight(sim, rec, flight, { n, eventGate: EVENT_GATE, stop: () => stopping })
  r.seen.camera = cam.value
  if (r.stall) r.stall.camera = cam.value
  watchCamera()
  if (r.passed) {
    const lVars = SETTLE_L.find((s) => s.match.test(flight.title))?.names ?? []
    r.settle = await settle(sim, rec, { t0: r.t0, lVars, quietMs: SETTLE_QUIET_MS, capMs: SETTLE_CAP_MS, stop: () => stopping, label: `settle ${n}` })
    r.end = Date.now()
  }
  return r
}

async function main() {
  const flights = new Map([[F0, readFlight(F0)], [F1, readFlight(F1)]])
  if (DRY_RUN) return dryRun(flights)

  process.on("SIGINT", () => {
    if (stopping) process.exit(1)
    stopping = true
    rec.log("stop", "Ctrl+C: finishing the current step and writing the report; Ctrl+C again quits at once")
  })

  rec.log("start", `p01 · SimConnect_FlightLoad on MSFS 2024; plan ${PLAN.map((p) => basename(p)).join(", ")}`)
  sim = await Sim.connect(rec, { name: "CROSSCHECK p01-flight-load", port: PORT })
  // Opened once connected, so a run that never reached the sim leaves no file.
  rec.open()
  sim.track()
  watchCamera()
  const run = RUN = { loads: [], camera: null, start: null }

  await sleep(3000)
  const live = sim.live
  run.start = { sim: live.sim, flight: live.flight, aircraft: live.aircraft, title: live.title, camera: cam.value }
  rec.log("start", `the sim is ${live.sim === 1 ? "in a flight" : live.sim === 0 ? "in the UI" : "in an unknown state"}; FlightLoaded ${live.flight || "(none)"}; camera ${cameraName(cam.value)}`)

  for (let i = 0; i < PLAN.length; i++) {
    if (sim.gone || stopping) break
    const before = run.loads[i - 1]
    if (before && !before.passed && live.sim !== 1 && !(await waitForFlight())) break
    const r = await runLoad(i + 1, flights.get(PLAN[i]))
    run.loads.push(r)
    if (r.passed && !run.camera && !sim.gone && !stopping) run.camera = await cameraTest(r.n)
  }
  await finish(run)
}

async function finish(run) {
  if (finishing) return
  finishing = true
  if (cam.moved && !sim.gone && cam.value !== 2) {
    sim.write("CAMERA STATE", "enum", 2)
    rec.log("camera", "put CAMERA STATE back to 2 (cockpit) on the way out")
    await sleep(1000)
  }
  const text = report(run)
  console.log("\n" + text)
  rec.writeReport(text)
  console.log(`\nsaved ${repoRelative(rec.files.txt)}`)
  console.log(`saved ${repoRelative(rec.files.ndjson)}`)
  sim.close()
  await rec.close()
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
  const timeline = rec.timeline
  const lines = []
  const say = (s = "") => lines.push(s)
  say("p01 · SimConnect_FlightLoad on MSFS 2024")
  say(`${new Date(rec.started).toISOString()}, node-simconnect ${NODE_SIMCONNECT}${sim ? `, ${sim.version.replace(/, SimConnect.*$/, "")}` : ", never connected"}`)
  if (run.start) {
    say(`At the start the sim was ${run.start.sim === 1 ? "in a flight" : run.start.sim === 0 ? "in the UI" : "in an unknown state"}, ` +
      `with FlightLoaded ${scrub(run.start.flight) || "(none)"}, TITLE ${JSON.stringify(run.start.title)}, camera ${cameraName(run.start.camera)}.`)
  }

  for (const r of run.loads) {
    const f = r.flight
    say()
    say(`Load ${r.n}  ${f.rel}  "${f.title}", livery ${f.livery}, from ${r.from}`)
    if (r.passed) {
      say(`  PASSED at ${secs(r.gateMs)}; ` + (r.settle?.quiet
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
  if (sim?.gone && sim.gone !== "closed by the harness") say(`The connection was lost: ${sim.gone}.`)

  say()
  say(`Next: ${nextStep(run)}`)
  return lines.join("\n")
}

function nextStep(run) {
  const loads = run.loads
  const timeline = rec.timeline
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
    rec.log("error", `the probe failed: ${e.message}`)
    await finish(RUN).catch(() => {})
  }
  process.exit(1)
})
