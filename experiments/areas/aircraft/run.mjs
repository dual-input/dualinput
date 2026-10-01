/*
 * The harness for the unattended sim session: loads one aircraft in its parked
 * and runway starts, runs the generic probes at each load, then the aircraft's
 * own tests, and writes a report that stands on its own.
 *
 *   node experiments/areas/aircraft/run.mjs <aircraft> [--state parked|runway] [--only 7,11] [--focused]
 *   node experiments/areas/aircraft/run.mjs <aircraft> --dry-run
 *   node experiments/areas/aircraft/run.mjs all --dry-run
 *   node experiments/areas/aircraft/run.mjs --restore-pending [<aircraft>]    with the sim closed
 *
 * <aircraft> is a folder name under record/areas/aircraft/, such as
 * a2a-pa24-comanche. Without --state it loads parked, then runway.
 *
 * For one aircraft it:
 *   1. connects, and if the sim already has this aircraft loaded, loads the
 *      neutral flight (a stock Cessna 152 at GVAC) first;
 *   2. backs up the aircraft's own persistent files (lib/aircraft.mjs says
 *      which) to %LOCALAPPDATA%\Crosscheck\harness-backups\, and stops if the
 *      backup fails, because the tests write wear, fuel, and settings into the
 *      user's real airframes; if a backup of the aircraft is still pending a
 *      restore, it uses that one instead, which holds the files as they were
 *      before any run;
 *   3. for each start state, loads flights/<aircraft>-<state>.flt, gates the
 *      load, and waits for the aircraft to settle (lib/load.mjs), with the
 *      neutral flight between the two states, because the sim crashed once on
 *      a load that kept the aircraft;
 *   4. runs the generic probes (lib/probes.mjs): identity and configuration,
 *      input events with their types, the inspector's panels and gauges, a 60s
 *      timeline of the aircraft's state values 4 times a second from the
 *      moment the load passed, the frame rate, and the stock radio events;
 *   5. runs the tests in tests/<aircraft>.mjs whose start state this is;
 *   6. writes the report, leaving the aircraft loaded; with --end-on-neutral it
 *      loads the neutral flight first, which crashed the sim twice in two tries.
 * Ctrl+C or a lost connection skips to step 6 and writes what it has; a second
 * Ctrl+C quits at once.
 *
 * It never restores while the sim runs. The backup stays listed in
 * results/pending-restores.tsv until --restore-pending, run with the sim
 * closed at the end of the session or after a crash, puts the files back,
 * checks them byte for byte, and logs the restore in results/restores.tsv.
 * A crash the run notices goes in results/crashes.tsv with the Windows
 * Application log's line.
 *
 * A test module, tests/<aircraft>.mjs, exports default
 *
 *   {
 *     aircraft: "<aircraft>",
 *     tests: [
 *       {
 *         question: 11,              the question's number in the study's Sim questions
 *         title: "...",              the question, short
 *         state: "runway",           "parked", "runway", or "any": the load it runs at
 *         frameSensitive: false,     true when the answer depends on the frame rate
 *         limitMs: 60_000,           at most 90_000
 *         async run(ctx) { ...; return "one-line answer" },
 *       },
 *     ],
 *   }
 *
 * A test records what it sees with ctx.note(text, fields), changes the sim only
 * through ctx, and registers ctx.cleanup(fn) for whatever it must put back,
 * which runs after it passes, throws, or times out. When limitMs passes, every
 * ctx call that waits throws, so the test stops at its next call. ctx gives:
 *
 *   read(vars), readOne(name, units), readStrings(names), burst(vars, ms),
 *   watch(vars, opts), waitFor(name, units, test, opts), write(name, units, v)
 *       A: and L: variables through SimConnect data definitions, tagged
 *   transmit("K:EVENT", [values], { priority, tag }), subscribeKeys(names, opts)
 *       K: events; subscriptions see every event at priority "highest" and
 *       mark the harness's own sends ours
 *   inputEvent(name), getInput(name), setInput(name, v), subscribeInputs(names, fn)
 *       input events by name, from this load's enumeration
 *   exec(code), fireH("H:EVENT"), setL(name, v), getL(name)
 *       calculator code through fsc-editor-link
 *   readClientData(name, bytes), panelEval(page, expression)
 *   sleep(ms), note(text, fields), cleanup(fn), aircraft, state, sim, link
 *
 * Every test with frameSensitive true is skipped unless --focused is given,
 * and the report lists the skipped ones with the command that runs them, so
 * they can run together once someone has put the sim in focus: a sim in the
 * background renders fewer frames.
 *
 * Names a test creates in the sim, such as L: variables and DataStorage keys,
 * start with CROSSCHECK_, because every package shares those namespaces.
 *
 * Output: one line per event on the console as it happens, the same records in
 * experiments/areas/aircraft/results/run-<aircraft>-<time>.ndjson, and the
 * report in the .txt beside it. Read the results before committing them: the
 * sim's own strings go in as they arrive.
 *
 * --dry-run reads every flight file, resolves every backup path, loads the test
 * module, and prints the plan, without connecting.
 * --port connects to 127.0.0.1:<n>, a static port SimConnect.xml can define.
 * --skip-generic leaves out the inventories, timeline, frame rate, and radio
 * probes, for working on a test; a run for the record runs them.
 */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"

import { AIRCRAFT, NEUTRAL, aircraft as getAircraft, persistentItems } from "./lib/aircraft.mjs"
import { BACKUP_ROOT, PENDING, backup, markPending, pendingFor, pendingList, readManifest, restorePending, survey, verify } from "./lib/backup.mjs"
import { findAircraft, packagesDir, readFlight } from "./lib/flights.mjs"
import { Link } from "./lib/link.mjs"
import { loadFlight, settle, startSettle } from "./lib/load.mjs"
import { FLIGHTS, flightFile, makeFlight } from "./lib/make.mjs"
import { Recorder, fmt, plural, repoRelative, scrub, secs, sleep } from "./lib/out.mjs"
import * as panels from "./lib/panels.mjs"
import * as probes from "./lib/probes.mjs"
import { NODE_SIMCONNECT, Sim } from "./lib/sim.mjs"
import { STATES, checkModule, makeContext } from "./lib/tests.mjs"

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2)
const VALUED = ["--state", "--only", "--port"]
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] ?? null }
const has = (name) => argv.includes(name)
const positional = argv.filter((a, i) => !a.startsWith("--") && !VALUED.includes(argv[i - 1]))

const DRY_RUN = has("--dry-run")
const FOCUSED = has("--focused")
const SKIP_GENERIC = has("--skip-generic")
const PORT = opt("--port") ? Number(opt("--port")) : null
const ONLY = opt("--only") ? new Set(opt("--only").split(",").map((s) => Number(s.trim())).filter(Number.isFinite)) : null
const STATE_ARG = opt("--state")
const RESTORE = has("--restore-pending")
const END_ON_NEUTRAL = has("--end-on-neutral")

const NEUTRAL_FILE = join(FLIGHTS, "neutral-runway.flt")

function usage(msg) {
  console.error(`${msg}\n\nusage: node experiments/areas/aircraft/run.mjs <aircraft> [--state parked|runway] [--only 7,11] [--focused] [--dry-run]\n` +
    `aircraft: ${Object.keys(AIRCRAFT).join(", ")}, or all with --dry-run`)
  process.exit(2)
}

// ---------------------------------------------------------------- planning

function flightFor(a, state) {
  const path = flightFile(a.id, state)
  return existsSync(path) ? path : null
}

async function loadTests(a) {
  const file = join(FLIGHTS, "..", "tests", `${a.id}.mjs`)
  if (!existsSync(file)) return { file, tests: [], problems: [] }
  const mod = (await import(pathToFileURL(file).href)).default
  const problems = checkModule(mod, repoRelative(file))
  return { file, tests: problems.length ? [] : mod.tests, problems }
}

function plan(a, tests) {
  const known = knownCrashes()
  const wanted = STATE_ARG ? [STATE_ARG] : STATES
  const states = wanted.filter((s) => !known.has(`${a.id} ${s}`))
  const crashSkipped = wanted.filter((s) => known.has(`${a.id} ${s}`))
  const chosen = tests.filter((t) => !ONLY || ONLY.has(t.question))
  const perState = Object.fromEntries(states.map((s) => [s, []]))
  const skipped = []
  const unplaced = []
  for (const t of chosen) {
    const where = t.state === "any" ? states[0] : t.state
    if (!states.includes(where)) { unplaced.push(t); continue }
    if (t.frameSensitive && !FOCUSED) { skipped.push(t); continue }
    perState[where].push(t)
  }
  return { states, perState, skipped, unplaced, crashSkipped }
}

// ---------------------------------------------------------------- dry run

async function dryRun(ids) {
  const out = []
  const say = (s = "") => out.push(s)
  say("run · dry run: what it would do, without connecting")
  say()
  say(`node-simconnect  ${NODE_SIMCONNECT}`)
  say(`connects         ${PORT ? `127.0.0.1:${PORT}` : "through the registry, where the running sim publishes its pipe"}`)
  say(`inspector        127.0.0.1:19999; calculator code through fsc-editor-link`)
  say(`packages         ${packagesDir() ? scrub(packagesDir()) : "not found: no UserCfg.opt"}`)
  say(`backups to       ${scrub(BACKUP_ROOT)}`)
  say(`neutral flight   ${existsSync(NEUTRAL_FILE) ? describeFlight(readFlight(NEUTRAL_FILE)) : `${repoRelative(NEUTRAL_FILE)} not yet written; the first live run writes it from the sim's list of titles`}`)
  let problems = 0
  for (const id of ids) {
    const a = getAircraft(id)
    say()
    say(`${id}  ${a.name}`)
    say(`  title    ${a.title ? JSON.stringify(a.title) : "unknown until a live session lists it"}; livery ${a.livery ?? "(none: the title names it)"}; tail ${a.tail ?? "(none)"}`)
    if (a.title) {
      const found = findAircraft(a.title, a.livery, a.packages)
      say(`           title ${found.title ? `in ${found.title}` : "not found in a readable aircraft.cfg"}; livery ${a.livery ? (found.livery ? `in ${found.livery}` : "folder not found") : "n/a"}`)
    }
    for (const state of STATE_ARG ? [STATE_ARG] : STATES) {
      const path = flightFor(a, state)
      if (!path) { problems++; say(`  ${state.padEnd(7)}  ${repoRelative(flightFile(id, state))} MISSING`); continue }
      const f = readFlight(path)
      const sendable = f.path.length < 260 && /^[\x20-\x7e]+$/.test(f.path)
      if (!f.crlf || !sendable || f.title !== a.title) problems++
      say(`  ${state.padEnd(7)}  ${describeFlight(f)}${f.title !== a.title ? "  TITLE DIFFERS FROM THE REGISTRY" : ""}${sendable ? "" : "  PATH TOO LONG OR NOT ASCII"}`)
    }
    for (const s of survey(persistentItems(a))) {
      say(`  backup   ${s.label}: ${s.path ? scrub(s.path) : "(unresolved)"}; ${s.exists ? `${plural(s.files, "file")}, ${s.bytes.toLocaleString("en-US")} bytes${s.large ? `; ${s.large} large file(s), ${s.largeBytes.toLocaleString("en-US")} bytes, recorded by size and time only` : ""}` : "doesn't exist yet"}`)
    }
    const crashed = (STATE_ARG ? [STATE_ARG] : STATES).filter((s) => knownCrashes().has(`${id} ${s}`))
    if (crashed.length) say(`  skipped  ${crashed.join(", ")}: a known crash in ${repoRelative(CRASHES)}`)
    const { file, tests, problems: tp } = await loadTests(a)
    problems += tp.length
    if (tp.length) say(`  tests    ${repoRelative(file)}: ${tp.join("; ")}`)
    else if (!tests.length) say(`  tests    none (${repoRelative(file)} ${existsSync(file) ? "has none" : "doesn't exist"})`)
    else {
      const p = plan(a, tests)
      for (const s of p.states) say(`  tests    at ${s}: ${p.perState[s].map((t) => `Q${t.question} (${t.limitMs / 1000}s)`).join(", ") || "none"}`)
      if (p.skipped.length) say(`  skipped  frame-sensitive without --focused: ${p.skipped.map((t) => `Q${t.question}`).join(", ")}`)
      if (p.unplaced.length) say(`  skipped  needing a state this run doesn't load: ${p.unplaced.map((t) => `Q${t.question} (${t.state})`).join(", ")}`)
    }
  }
  say()
  say(problems ? `${plural(problems, "problem")} above.` : "Nothing to fix. Not connected; nothing was sent.")
  console.log(out.join("\n"))
  return problems ? 1 : 0
}

function describeFlight(f) {
  return `${f.rel}, ${f.bytes.toLocaleString("en-US")} bytes${f.crlf ? "" : ", NOT CRLF"}; "${f.title}"${f.livery ? ` / ${f.livery}` : ""}; ${f.firstState ?? "no FirstFlightState"}${f.departure ? ` at ${f.departure}` : ""}; ${f.lat.toFixed(6)}, ${f.lon.toFixed(6)}${f.localVars ? `; ${f.localVars} LocalVars` : ""}`
}

// ---------------------------------------------------------------- preflight

// The session runs with the sim to itself: GSX (Couatl64) and ChasePlane move
// the camera and the aircraft, and FS Copilot's bridge answers on the same
// channels; ChasePlane took the camera back within 30ms in our FlightLoad
// probe's run (experiments/areas/aircraft/results/p01-flight-load-2026-10-01-17-29-57.txt).
function runningNames() {
  try {
    return execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" })
      .split(/\r?\n/).map((l) => (/^"([^"]+)"/.exec(l) ?? [])[1]).filter(Boolean)
  } catch {
    return []
  }
}

function preflight() {
  const warnings = []
  const names = runningNames()
  if (!names.length) warnings.push("couldn't list processes")
  if (names.length && !names.some((n) => /^FlightSimulator2024/i.test(n))) warnings.push("FlightSimulator2024 isn't running")
  for (const n of names.filter((n) => /^(Couatl64|ChasePlane)/i.test(n))) warnings.push(`${n} is running`)
  const pk = packagesDir()
  if (pk && existsSync(join(pk, "Community", "fscopilot-bridge"))) warnings.push("fscopilot-bridge is in Community")
  return warnings
}

// ---------------------------------------------------------------- the run

const run = {
  rec: null, sim: null, link: null, a: null, manifest: null, backupError: null,
  loads: [], tests: [], skipped: [], unplaced: [], warnings: [], neutral: null, restore: null,
  stopping: false, finishing: false, finished: false, startedAt: Date.now(), args: argv.join(" "),
}

const stopped = () => run.stopping || Boolean(run.sim?.gone)

async function main() {
  if (RESTORE) return restorePendingCommand(positional[0] ?? null)
  if (!positional.length) usage("give an aircraft")
  if (DRY_RUN) return dryRun(positional[0] === "all" ? Object.keys(AIRCRAFT) : positional)
  if (positional[0] === "all") usage("all works only with --dry-run: run one aircraft at a time")
  if (STATE_ARG && !STATES.includes(STATE_ARG)) usage(`--state must be ${STATES.join(" or ")}`)
  const a = run.a = getAircraft(positional[0])
  const { tests, problems, file: testFile } = await loadTests(a)
  if (problems.length) usage(`${repoRelative(testFile)}: ${problems.join("; ")}`)
  const p = plan(a, tests)
  run.skipped = p.skipped
  run.unplaced = p.unplaced
  run.crashSkipped = p.crashSkipped

  const rec = run.rec = new Recorder(`run-${a.id}`)
  process.on("SIGINT", onInterrupt)
  rec.log("start", `harness for ${a.id} (${a.name}); states ${p.states.join(", ")}; tests ${p.states.map((s) => `${s}: ${p.perState[s].map((t) => `Q${t.question}`).join(" ") || "none"}`).join("; ")}`)
  run.warnings = preflight()
  for (const w of run.warnings) rec.log("warn", w)

  await connect("start")
  rec.open()
  const sim = run.sim
  rec.log("start", `the sim is ${sim.live.sim === 1 ? "in a flight" : sim.live.sim === 0 ? "in the UI" : "in an unknown state"}; TITLE ${JSON.stringify(sim.live.title)}; AircraftLoaded ${sim.live.aircraft ?? "(unknown)"}`)

  await ensureFlights(a, p.states)
  if (stopped()) return finish()

  // Every load changes the aircraft folder, from the neutral C152 or to it,
  // because two of three crashes on 2026-10-01 followed a load within one
  // folder: the PA-24 after itself, and the Fenix A320 after the A321
  // (results/crashes.tsv). Loading the neutral first also stops the tested
  // aircraft writing its files while the backup copies them.
  const loaded = await run.sim.state("AircraftLoaded")
  if (!isNeutralLoaded(loaded.string)) {
    rec.log("neutral", `loading the neutral flight first; AircraftLoaded reads ${loaded.string || loaded.error || "nothing"}`)
    await loadNeutral()
  }

  try {
    const pending = pendingFor(a.id)
    if (pending) {
      run.manifest = readManifest(pending.dir)
      run.reused = pending
      rec.log("backup", `using the backup pending a restore since ${pending.created}, ${pending.backup}, which holds the files as they were before ${plural(pending.runs.length, "earlier run")}`, { dest: pending.dir, reused: true })
    } else {
      run.manifest = backup(a.id, persistentItems(a), { when: rec.when })
      const files = run.manifest.items.reduce((n, i) => n + i.files.length, 0)
      const large = run.manifest.items.reduce((n, i) => n + i.large.length, 0)
      rec.log("backup", `${plural(files, "file")} backed up to ${scrub(run.manifest.dest)}${large ? `; ${large} large file(s) recorded by size and time only` : ""}; ${run.manifest.items.filter((i) => !i.existed).map((i) => `${i.label} doesn't exist yet`).join("; ") || "every item existed"}`,
        { dest: run.manifest.dest, files, large, items: run.manifest.items.map((i) => ({ label: i.label, path: i.path, existed: i.existed, files: i.files.length, large: i.large.length })) })
    }
    markPending(a.id, run.manifest.dest, repoRelative(rec.files.txt))
  } catch (e) {
    run.backupError = e.message
    rec.log("error", `backup failed, so nothing is loaded: ${e.message}`)
    return finish()
  }

  for (const [i, state] of p.states.entries()) {
    if (stopped()) break
    // Loading the PA-24's runway flight straight after its parked one crashed
    // the sim 13s later, an access violation in mimalloc.dll (measured on MSFS
    // 2024, 2026-10-01, experiments/areas/aircraft/results/
    // run-a2a-pa24-comanche-2026-10-01-18-12-09.txt; one occurrence, cause
    // unverified). Every load that passed had changed the aircraft, so the
    // neutral flight goes between two starts of the same aircraft.
    if (i > 0) {
      rec.log("neutral", `loading the neutral flight between ${p.states[i - 1]} and ${state}, so the next load changes the aircraft`)
      await loadNeutral()
      if (stopped()) break
    }
    await runState(a, state, i + 1, p.perState[state])
  }
  await finish()
}

// Opens a SimConnect connection with only what our FlightLoad probe had: its
// system events, the flow events, and the position, TITLE, and livery
// requests the load gate reads. Crashes 1, 2, and 5 in results/crashes.tsv
// each followed probes that left notification groups at priority 1 behind,
// and the probe, whose loads had nothing else attached, never crashed; so
// every FlightLoad gets a fresh connection, and the probes' requests and
// subscriptions are made on it only after the load's silent window.
async function connect(why) {
  const old = run.sim
  if (old && !old.gone) {
    try { run.link?.stop() } catch { /* closing anyway */ }
    old.close()
    await sleep(1000)
  }
  const sim = run.sim = await Sim.connect(run.rec, { name: "CROSSCHECK harness", port: PORT })
  sim.track()
  sim.onLost((w) => { run.stopping = true; run.rec.log("stop", `stopping: ${w}`) })
  run.link = new Link(sim)
  run.rec.log("connect", `a fresh connection, ${why}`)
  await sleep(3000)
  return sim
}

// A FlightLoad on a fresh connection, inside a silent window; afterwards the
// connection takes the system events the probe didn't have.
async function freshLoad(flight, n) {
  await connect(`for the ${n} load`)
  const r = await loadFlight(run.sim, run.rec, flight, { n, pages: false, silent: true, stop: stopped })
  if (!run.sim.gone) run.sim.subscribeExtras()
  return r
}

function folderOf(path) {
  const m = /\\airplanes\\([^\\]+)\\/i.exec(String(path ?? "").replace(/\//g, "\\"))
  return m ? m[1].toLowerCase() : null
}

function isNeutralLoaded(path) {
  return NEUTRAL.folders.some((f) => f.toLowerCase() === folderOf(path))
}


// Writes the neutral flight, and any of this aircraft's flight files still
// missing, from the titles the sim lists, the first time a live session can.
async function ensureFlights(a, states) {
  const rec = run.rec
  const needNeutral = !existsSync(NEUTRAL_FILE)
  const missing = states.filter((s) => !flightFor(a, s))
  if (!needNeutral && !missing.length) return
  const list = await run.sim.liveries()
  rec.log("liveries", `${plural(list.length, "aircraft and livery pair")} listed${list.error ? `, incomplete: ${list.error}` : ""}`, { count: list.length })
  for (const x of list) rec.data("livery", `${x.title} / ${x.livery}`, x)
  if (needNeutral) {
    const hit = list.find((x) => NEUTRAL.match.test(x.title))
    if (!hit) rec.log("warn", "no Cessna 152 title in the sim's list, so there's no neutral flight; the restore runs with the tested aircraft still loaded")
    else {
      const made = makeFlight({ ...NEUTRAL, title: hit.title, livery: null, tail: null }, "runway")
      writeFileSync(NEUTRAL_FILE, made.text, "latin1")
      rec.log("flight", `wrote ${repoRelative(NEUTRAL_FILE)} for ${JSON.stringify(hit.title)}`)
    }
  }
  for (const state of missing) {
    let title = a.title
    if (!title && a.match) {
      const hits = [...new Set(list.filter((x) => a.match.test(x.title)).map((x) => x.title))]
      rec.log("liveries", `titles matching ${a.match}: ${hits.map((t) => JSON.stringify(t)).join(", ") || "none"}`)
      title = hits[0] ?? null
    }
    if (!title) { rec.log("warn", `${a.id} has no title, so no ${state} flight file`); continue }
    const made = makeFlight({ ...a, title }, state)
    writeFileSync(flightFile(a.id, state), made.text, "latin1")
    rec.log("flight", `wrote ${repoRelative(flightFile(a.id, state))} for ${JSON.stringify(title)}${made.notes.length ? `; ${made.notes.join("; ")}` : ""}`)
  }
}

async function loadNeutral() {
  const rec = run.rec
  if (!existsSync(NEUTRAL_FILE)) { rec.log("neutral", "no neutral flight file; skipped"); return null }
  const f = readFlight(NEUTRAL_FILE)
  run.current = `neutral, after ${run.a?.id ?? "nothing"}`
  const r = await freshLoad(f, "neutral")
  run.neutral = { passed: r.passed, gateMs: r.gateMs, failed: r.failed, title: f.title }
  return r
}

async function runState(a, state, n, tests) {
  const { rec } = run
  run.current = `${a.id} ${state}`
  const path = flightFor(a, state)
  const L = { state, n, file: path ? repoRelative(path) : null, load: null, settle: null, generic: {}, tests: [] }
  run.loads.push(L)
  if (!path) { rec.log("fail", `${state}: no flight file`); return }
  const flight = readFlight(path)
  L.load = await freshLoad(flight, state)
  if (!L.load.passed || stopped()) return
  // Started once the silent window is over, on the load's own connection, so
  // the settle values and the timeline miss the window's first seconds.
  const sim = run.sim
  const ctx = { sim, rec, link: run.link, panels, aircraft: a, state, inputEvents: null }
  const timeline = SKIP_GENERIC ? null : probes.startTimeline(ctx)
  timeline?.begin(L.load.t0 + L.load.gateMs)
  const settleWatch = startSettle(sim, rec, { lVars: a.settleL })
  L.settle = await settle(sim, rec, {
    t0: L.load.t0,
    watch: settleWatch,
    ready: a.ready.map((x) => readyCheck(sim, x, a, L.load.t0)),
    stop: stopped,
  })

  const step = async (name, fn) => {
    if (stopped()) return
    try { L.generic[name] = await fn() } catch (e) { L.generic[name] = { error: e.message }; rec.log("error", `${name} probe threw: ${e.message}`) }
  }
  await step("identity", () => probes.identity(ctx))
  await step("inputs", () => probes.inputEvents(ctx))
  if (!SKIP_GENERIC) {
    await step("panels", () => probes.panelInventory(ctx))
    if (timeline) { await step("timeline", () => timeline.done) }
    await step("fps", () => probes.frameRate(ctx))
    await step("radios", () => probes.radios(ctx))
  }
  for (const t of tests) {
    if (stopped()) break
    L.tests.push(await runTest(ctx, t))
  }
}

// A client data area belongs to the aircraft's module, so it's read only once
// AircraftLoaded names this aircraft after the load: three ILLEGAL_OPERATION
// exceptions came in step with the Fenix:Ready poll while the aircraft was
// changing, 15s before a crash (results/run-fenix-a320-family-2026-10-01-18-29-25.txt).
function readyCheck(sim, x, a, t0) {
  if (x.clientData) {
    return {
      label: x.label,
      check: async () => {
        const here = sim.live.aircraftAt > t0 && a.folders.some((f) => f.toLowerCase() === folderOf(sim.live.aircraft))
        if (!here) return { ok: false, value: "waiting for AircraftLoaded to name the aircraft" }
        const b = await sim.readClientData(x.clientData.name, x.clientData.size, { timeoutMs: 1500 })
        if (b.missing) return { ok: false, value: b.error }
        return { ok: x.test(b), value: b.toString("hex") }
      },
    }
  }
  return {
    label: x.label,
    check: async () => {
      const v = await sim.read(x.vars.map((n) => [n, "number"]), { timeoutMs: 1500 })
      const values = Object.fromEntries(v)
      return { ok: x.test(values), value: values }
    },
  }
}

async function runTest(base, t) {
  const { rec } = run
  const r = { question: t.question, title: t.title, state: base.state, answer: null, error: null, timedOut: false, ms: null, notes: [], cleanupErrors: [] }
  const { ctx, abort, runCleanups, Aborted } = makeContext({ ...base, inputEvents: base.inputEvents }, t)
  rec.log("test", `Q${t.question} ${t.title} (limit ${t.limitMs / 1000}s)`, { question: t.question, title: t.title })
  const t0 = Date.now()
  let timer
  const limit = new Promise((resolve) => { timer = setTimeout(() => { abort(); resolve({ timedOut: true }) }, t.limitMs) })
  try {
    const out = await Promise.race([Promise.resolve().then(() => t.run(ctx)).then((answer) => ({ answer })), limit])
    if (out.timedOut) r.timedOut = true
    else r.answer = String(out.answer ?? "(no answer returned)").split("\n")[0]
  } catch (e) {
    if (e instanceof Aborted) r.timedOut = true
    else { r.error = e.message; rec.log("error", `Q${t.question} threw: ${e.stack?.split("\n").slice(0, 3).join(" | ") ?? e.message}`) }
  } finally {
    clearTimeout(timer)
    abort()
    r.ms = Date.now() - t0
    r.cleanupErrors = await runCleanups()
    r.notes = ctx.notes.map((n) => ({ ms: n.t - t0, text: n.text }))
  }
  rec.log("answer", `Q${t.question}: ${r.timedOut ? `timed out at ${t.limitMs / 1000}s` : r.error ? `failed: ${r.error}` : r.answer} (${secs(r.ms)})`, { question: t.question, answer: r.answer, error: r.error, timedOut: r.timedOut, ms: r.ms })
  return r
}

// ---------------------------------------------------------------- the end

function onInterrupt() {
  if (!run.rec) process.exit(1)
  if (run.stopping) {
    run.rec.log("stop", "second Ctrl+C: quitting without the neutral load; the backup stays pending a restore")
    run.sim?.close()
    finish({ quick: true }).finally(() => process.exit(1))
    return
  }
  run.stopping = true
  run.rec.log("stop", "Ctrl+C: finishing the current step, loading the neutral flight, and writing the report; Ctrl+C again quits at once")
}

// The Windows Application log's last crash of the sim in the past few minutes,
// as one line, or null.
function simCrash(minutes = 5) {
  const ps = `Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='Application Error'; StartTime=(Get-Date).AddMinutes(-${minutes})} -ErrorAction SilentlyContinue | ` +
    `Where-Object { $_.Message -match 'FlightSimulator2024' } | Select-Object -First 1 | ` +
    `ForEach-Object { $_.TimeCreated.ToString('yyyy-MM-ddTHH:mm:ss') + ' ' + (($_.Message -split '\\r?\\n' | Where-Object { $_ } | Select-Object -First 5) -join '; ') }`
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", timeout: 20_000 }).trim() || null
  } catch {
    return null
  }
}

// The guards against crashes the runner has, for the crash log: each was added
// after a crash in results/crashes.tsv.
const MITIGATIONS = [
  "the neutral C152 between any two loads of one aircraft folder",
  "restores only with the sim closed",
  "a silent window from each FlightLoad to 10s after FLIGHT_START",
  "client data read only after AircraftLoaded names the aircraft",
  "no end-of-run neutral load",
  "a fresh SimConnect connection for each FlightLoad, with only p01's subscriptions until the silent window ends",
]

const CRASHES = join(FLIGHTS, "..", "results", "crashes.tsv")
const CRASHES_HEAD = "# Sim crashes during harness runs, one per line: when the harness noticed (UTC), the load it was in (aircraft and state), its last action, the run's report, the Windows Application log's line (local time), and the harness's guards against crashes then in effect. A KNOWN CRASH line marks a load that crashed twice, which the runner skips.\nnoticed\tload\tlast action\treport\twindows log\tin effect\n"

function crashRows() {
  if (!existsSync(CRASHES)) return []
  return readFileSync(CRASHES, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#") && !l.startsWith("noticed\t"))
    .map((l) => { const [noticed, load, last, report, windows, inEffect] = l.split("\t"); return { noticed, load, last, report, windows, inEffect } })
}

// Loads that crashed twice: "<aircraft> <state>".
function knownCrashes() {
  return new Set(crashRows().filter((r) => r.last?.startsWith("KNOWN CRASH")).map((r) => r.load))
}

// Appends a crash to results/crashes.tsv, which collects them across runs, and
// marks the load a known crash the second time it crashes, so later runs skip it.
function recordCrash(rec, line) {
  const last = [...rec.timeline].reverse().find((e) => ["load", "send", "write", "link", "test", "probe"].includes(e.kind) || (e.kind === "flow" && e.flow === "FLT_LOADED"))
  const load = run.current ?? "(between loads)"
  const cell = (s) => String(s).replace(/[\t\r\n]+/g, " ")
  const row = [new Date().toISOString(), load, last ? `${last.kind}: ${last.text}` : "(nothing logged)", repoRelative(rec.files.txt), scrub(line), MITIGATIONS.join("; ")].map(cell)
  writeFileSync(CRASHES, (existsSync(CRASHES) ? "" : CRASHES_HEAD) + row.join("\t") + "\n", { flag: "a" })
  rec.log("crash", `recorded in ${repoRelative(CRASHES)}: ${scrub(line)}`, { load, last: last?.text ?? null, windowsLog: line })
  run.crash = { line: scrub(line), last: last?.text ?? null, load }
  const same = crashRows().filter((r) => r.load === load && !r.last?.startsWith("KNOWN CRASH"))
  if (same.length >= 2 && !knownCrashes().has(load) && !load.startsWith("neutral")) {
    const offsets = same.map((r) => /Fault offset: (0x[0-9a-f]+)/i.exec(r.windows ?? "")?.[1] ?? "?")
    const known = [new Date().toISOString(), load, `KNOWN CRASH: crashed on ${same.length} loads, so the runner skips this state`, same.map((r) => r.report).join(", "), `fault offsets ${offsets.join(", ")}`, MITIGATIONS.join("; ")].map(cell)
    writeFileSync(CRASHES, known.join("\t") + "\n", { flag: "a" })
    rec.log("crash", `${load} has crashed ${same.length} times; marked a known crash, which later runs skip`)
  }
}

async function finish({ quick = false } = {}) {
  if (run.finishing) return
  run.finishing = true
  const { rec, sim } = run
  // The run ends with the tested aircraft loaded: the end-of-run neutral load
  // crashed the sim twice in two tries, about 10s after the request
  // (results/crashes.tsv, 2026-10-01T18:23:31Z and 18:45:17Z), and the restore,
  // which waits for the sim to close, doesn't need it. --end-on-neutral puts it
  // back.
  if (END_ON_NEUTRAL && run.manifest && !quick && sim && !sim.gone) {
    run.stopping = false
    const r = await loadNeutral()
    if (!r?.passed) rec.log("warn", "the neutral flight didn't load, so the tested aircraft is still loaded and may write its files")
  }
  if (sim?.gone && sim.gone !== "closed by the harness") {
    await sleep(3000)
    const line = simCrash()
    if (line) recordCrash(rec, line)
    else rec.log("lost", "no crash of FlightSimulator2024 in the Windows Application log in the past 5 minutes")
  }
  if (run.manifest) {
    const check = verify(run.manifest)
    run.changedFiles = check.mismatched
    rec.log("restore", `pending: ${check.mismatched.length} of ${check.identical + check.mismatched.length} backed-up files differ from the backup now; with the sim closed, run node experiments/areas/aircraft/run.mjs --restore-pending`, { changed: check.mismatched, pending: repoRelative(PENDING) })
  }
  const text = report()
  console.log("\n" + text)
  rec.writeReport(text)
  console.log(`\nsaved ${repoRelative(rec.files.txt)}`)
  console.log(`saved ${repoRelative(rec.files.ndjson)}`)
  try { run.link?.stop() } catch { /* closing anyway */ }
  try { sim?.close() } catch { /* already closed */ }
  await rec.close()
  run.finished = true
}

// Restores every pending backup, or one aircraft's, and refuses while the sim
// or a program that writes an aircraft's files is running.
async function restorePendingCommand(only) {
  const busy = runningNames().filter((n) => /^(FlightSimulator2024|Fenix)/i.test(n))
  if (busy.length) {
    console.error(`not restoring while ${[...new Set(busy)].join(", ")} ${busy.length > 1 ? "are" : "is"} running: close the sim first`)
    return 1
  }
  const pending = pendingList().filter((r) => !only || r.aircraft === only)
  if (!pending.length) { console.log("no backups pending a restore"); return 0 }
  const done = await restorePending({ only })
  for (const d of done) {
    const r = d.result
    console.log(`${d.aircraft}: ${r.files} backed-up files, ${r.rewritten.length} rewritten, ${r.identical} of ${r.files} identical after the restore${d.ok ? "" : "; STILL PENDING"}`)
    if (r.failed.length) console.log(`  failed: ${r.failed.map((f) => `${f.path} (${f.error})`).join(", ")}`)
    if (r.created.length) console.log(`  created during the runs and left in place: ${r.created.join(", ")}`)
    const large = (r.large ?? []).filter((l) => l.changed)
    if (large.length) console.log(`  large files that changed, not restored: ${large.map((l) => l.path).join(", ")}`)
  }
  console.log(`logged in ${repoRelative(join(FLIGHTS, "..", "results", "restores.tsv"))}`)
  return done.every((d) => d.ok) ? 0 : 1
}

// ---------------------------------------------------------------- report

function eventLabel(e) {
  if (e.kind === "flow") return `flow ${e.flow}${e.file ? ` ${basename(String(e.file).replace(/\\/g, "/"))}` : ""}`
  if (e.kind === "system") return `${e.event}${e.file ? ` ${basename(String(e.file).replace(/\\/g, "/"))}` : ` ${e.data}`}`
  if (e.kind === "exception") return `exception ${e.name} on ${e.sent}`
  if (e.kind === "state" && "sim" in e) return `Sim state ${e.sim}`
  if (e.kind === "state" && "title" in e) return `TITLE ${JSON.stringify(e.title)}`
  if (e.kind === "stall") return "stall"
  return null
}

function report() {
  const { rec, sim, a } = run
  const lines = []
  const say = (s = "") => lines.push(s)
  say(`run · ${a?.id ?? "?"} on MSFS 2024`)
  say(`${new Date(run.startedAt).toISOString()}, node-simconnect ${NODE_SIMCONNECT}${sim ? `, ${sim.version}` : ", never connected"}`)
  say(`Command: node experiments/areas/aircraft/run.mjs ${run.args}`)
  if (a) say(`Aircraft: ${a.name}, "${a.title ?? "(title from the sim)"}"${a.livery ? `, livery ${a.livery}` : ""}`)
  if (run.warnings.length) say(`Before the run: ${run.warnings.join("; ")}`)

  say()
  if (run.backupError) say(`Backup FAILED, so the run loaded nothing: ${scrub(run.backupError)}`)
  else if (run.manifest) {
    const files = run.manifest.items.reduce((n, i) => n + i.files.length, 0)
    say(`Backup: ${plural(files, "file")} in ${scrub(run.manifest.dest)}${run.reused ? `, taken ${run.reused.created} and reused, because it was still pending a restore` : ""}`)
    for (const i of run.manifest.items) say(`  ${i.label}: ${i.existed ? `${plural(i.files.length, "file")}${i.large.length ? `, ${i.large.length} large recorded by size and time` : ""}` : "didn't exist"}`)
    if (run.changedFiles) {
      say(`Restore: pending, in ${repoRelative(PENDING)}; ${run.changedFiles.length} of ${files} files differ from the backup at the end of the run. With the sim closed, run:`)
      say("  node experiments/areas/aircraft/run.mjs --restore-pending")
      if (run.changedFiles.length) say(`  changed: ${run.changedFiles.join(", ")}`)
    }
    if (run.neutral) say(`Neutral flight: ${run.neutral.passed ? `loaded in ${secs(run.neutral.gateMs)}` : `didn't load (${run.neutral.failed})`}, ${JSON.stringify(run.neutral.title)}`)
  }

  for (const L of run.loads) {
    say()
    say(`Load ${L.state}  ${L.file ?? "(no flight file)"}`)
    const r = L.load
    if (!r) { say("  not loaded"); continue }
    if (r.passed) {
      const s = L.settle
      say(`  PASSED at ${secs(r.gateMs)}; ${s?.settled ? `settled at ${secs(s.ms)}, the last change ${s.last ?? "the first reading"}` : s ? `not settled: ${s.busiest.join(", ") || "quiet"}${s.ready.filter((x) => x.ms === null).map((x) => `; not ready: ${x.label}`).join("")}` : "settle not run"}`)
      if (s?.ready.length) say(`  ready marks: ${s.ready.map((x) => `${x.label} ${x.ms === null ? "never" : `at ${secs(x.ms)}`}`).join("; ")}`)
      if (s) say(`  settle values: ${s.answered} of ${s.total} answered; L: ${s.lAnswered} of ${s.lTotal}${s.silent.length ? `; silent: ${s.silent.join(", ")}` : ""}`)
    } else say(`  FAILED: ${r.failed}; not met: ${r.missing.join(", ")}`)
    if (r.seen) say(`  read: TITLE ${JSON.stringify(r.seen.title)}, LIVERY FOLDER ${JSON.stringify(r.seen.liveryFolder)}, LIVERY NAME ${JSON.stringify(r.seen.liveryName)}; ${Number.isFinite(r.seen.distanceM) ? `${Math.round(r.seen.distanceM)} m` : "no position"} from the file's position, ${r.seen.altFt == null ? "?" : Math.round(r.seen.altFt)} ft, on ground ${r.seen.onGround}, Sim ${r.seen.sim}`)
    if (r.stall) say(`  STALL at ${secs(r.stall.ms)}: the aircraft was in place while Sim read ${r.stall.sim}`)
    const events = rec.timeline.filter((e) => e.t >= r.t0 && e.t <= (r.end + 30_000)).map((e) => [e.t, eventLabel(e)]).filter(([, l]) => l)
    say(`  events from the request: ${events.slice(0, 30).map(([t, l]) => `+${secs(t - r.t0)} ${l}`).join(" · ") || "none"}${events.length > 30 ? ` · and ${events.length - 30} more` : ""}`)
    const g = L.generic
    if (g.identity && !g.identity.error) {
      const s = g.identity.strings, nmb = g.identity.numbers
      say(`  identity: ATC TYPE ${JSON.stringify(s["ATC TYPE"])}, MODEL ${JSON.stringify(s["ATC MODEL"])}, ID ${JSON.stringify(s["ATC ID"])}, AIRLINE ${JSON.stringify(s["ATC AIRLINE"])}, FLIGHT ${JSON.stringify(s["ATC FLIGHT NUMBER"])}, CATEGORY ${JSON.stringify(s.CATEGORY)}`)
      say(`            AircraftLoaded ${scrub(g.identity.aircraftLoaded)}`)
      say(`            ${Object.entries(nmb).map(([k, v]) => `${k} ${fmt(v)}`).join("; ")}`)
      if (g.identity.missing.length) say(`            no value: ${g.identity.missing.join(", ")}`)
    } else if (g.identity?.error) say(`  identity: failed, ${g.identity.error}`)
    if (g.inputs && !g.inputs.error) say(`  input events: ${g.inputs.count}, types ${JSON.stringify(g.inputs.types)}, parameters ${JSON.stringify(g.inputs.paramKinds)}${g.inputs.error ? `, incomplete: ${g.inputs.error}` : ""}; names and values in the NDJSON, kind "inputEvent"`)
    else if (g.inputs?.error) say(`  input events: failed, ${g.inputs.error}`)
    if (g.panels) {
      if (g.panels.error) say(`  panels: ${g.panels.error}`)
      else {
        const vc = g.panels.pages.filter((p) => p.panel)
        say(`  panels: ${g.panels.pages.length} documents, ${vc.length} VCockpit; gauges in the NDJSON, kind "panel"`)
        say(`          ${vc.map((p) => `${p.title}${p.gauges ? ` [${p.gauges.length}]` : p.error ? " [error]" : ""}`).join(", ")}`)
      }
    }
    if (g.timeline && !g.timeline.error) {
      const moved = Object.entries(g.timeline.stats).filter(([, s]) => s.changes > 0)
      say(`  timeline: ${g.timeline.samples} samples over ${g.timeline.durationMs / 1000}s from the gate; ${moved.length} of ${Object.keys(g.timeline.stats).length} values moved`)
      for (const [n, s] of moved) say(`            ${n}: ${fmt(s.first)} → ${fmt(s.last)}, ${s.changes} change(s), last at +${secs(s.lastChangeMs)}`)
      if (g.timeline.silent.length) say(`            no value: ${g.timeline.silent.join(", ")}`)
    }
    if (g.fps && !g.fps.error) say(`  frame rate: ${g.fps.fps === null ? "none" : `${g.fps.fps.toFixed(1)} sim frames/s`} by SIM_FRAME deliveries over ${g.fps.windowMs / 1000}s, longest gap ${g.fps.maxGapMs}ms; Frame event ${g.fps.frameEventFps === null ? "silent" : `${g.fps.frameEventFps.toFixed(1)} fps`}`)
    if (Array.isArray(g.radios)) {
      say("  radios, each sent at priority highest and watched every frame for 2s:")
      for (const x of g.radios) {
        say(`    ${x.event} ${x.sent}: ${x.variable} ${fmt(x.before)} → ${fmt(x.final)}, ${x.held ? "held" : x.reachedMs !== null ? `reached at +${x.reachedMs}ms, then ${fmt(x.final)}` : "never reached"}; echoes ${x.echoes.map((e) => `${e.value} ${e.ours ?? "not ours"}${e.ex1 ? " EX1" : ""} +${e.ms}ms`).join(", ") || "none"}` +
          (Object.keys(x.own).length ? `; own ${Object.entries(x.own).map(([n, s]) => `${n} ${fmt(s.before)} → ${fmt(s.after)}`).join(", ")}` : ""))
      }
    } else if (g.radios?.error) say(`  radios: failed, ${g.radios.error}`)
    for (const t of L.tests) {
      say(`  Q${t.question} ${t.title}`)
      say(`    ${t.timedOut ? "TIMED OUT" : t.error ? `FAILED: ${t.error}` : t.answer} (${secs(t.ms)})`)
      for (const n of t.notes) say(`      +${secs(n.ms)} ${n.text}`)
      if (t.cleanupErrors.length) say(`      cleanup errors: ${t.cleanupErrors.join("; ")}`)
    }
  }

  say()
  if (run.skipped.length) {
    say(`Skipped, frame-sensitive: ${run.skipped.map((t) => `Q${t.question}`).join(", ")}. With the sim in focus, run:`)
    say(`  node experiments/areas/aircraft/run.mjs ${a.id} --focused --only ${run.skipped.map((t) => t.question).join(",")}`)
  }
  if (run.unplaced.length) say(`Skipped, needing a start this run didn't load: ${run.unplaced.map((t) => `Q${t.question} (${t.state})`).join(", ")}`)
  if (run.crashSkipped?.length) say(`Skipped, a known crash in ${repoRelative(CRASHES)}: ${run.crashSkipped.map((s) => `${a.id} ${s}`).join(", ")}`)
  const exceptions = rec.timeline.filter((e) => e.kind === "exception")
  const grouped = new Map()
  for (const e of exceptions) grouped.set(`${e.name} on ${e.sent}`, (grouped.get(`${e.name} on ${e.sent}`) ?? 0) + 1)
  say(`Exceptions: ${exceptions.length ? [...grouped].map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ""}`).join("; ") : "none"}`)
  if (sim?.gone && sim.gone !== "closed by the harness") say(`The connection was lost: ${sim.gone}.`)
  if (run.crash) say(`The sim crashed; the harness's last action was ${run.crash.last ?? "unknown"}. Windows: ${run.crash.line}`)
  return lines.join("\n")
}

main().then((code) => {
  if (typeof code === "number") process.exitCode = code
  if (!DRY_RUN && !RESTORE) process.exit(process.exitCode ?? 0)
}).catch(async (e) => {
  console.error(`\n${scrub(run.rec?.files ? e.stack ?? e.message : e.message)}\n`)
  if (run.rec?.files && !run.finished) {
    run.rec.log("error", `the harness failed: ${e.message}`)
    await finish().catch(() => {})
  }
  process.exit(1)
})