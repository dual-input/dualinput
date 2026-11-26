// The Sync log's cases in the sim, for one session with someone at the sim, alone in the Black
// Square Baron 58P (record/areas/profiles/06-the-sync-log.md, "Cases"). The real core hosts and
// flies, and the script plays the profile extension: a client whose component is
// `profile-extension`, which turns state sync's log on while it's connected. It keeps each of
// state sync's messages with when it arrived, presses the recorder's buttons, and writes
// report.txt in the run's folder, with each row's steps.
//
//   node tools/build.ts install                     with the sim closed
//   node tools/bench.ts sync-log                    once, so target/bench holds this tree
//   cargo build --release -p dualinput-core
//   node tools/sim/sync-log.ts --core target/release/dualinput-core.exe
//
// Then start the sim and load the 58P cold and dark at a stand; the script says each step aloud,
// and a short beep opens and closes each window you act in. Your part takes about two minutes:
// the beacon switch, then a recording of the battery, the heading knob, and the autopilot's ALT
// and VS buttons, which the script plays back. Keys:
//   Page Down   starts a step the script asks for
//   Page Up     skips it
//   q           stops the core, replays its recording, and ends

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import type { FromClient } from "../../src/engines/messages/ts/clients/FromClient.ts"
import type { ProfilesSlice } from "../../src/engines/messages/ts/profiles/ProfilesSlice.ts"
import type { SessionSlice } from "../../src/engines/messages/ts/session/SessionSlice.ts"
import type { SimSlice } from "../../src/engines/messages/ts/sim/SimSlice.ts"
import type { TapeSlice } from "../../src/engines/messages/ts/tape/TapeSlice.ts"
import { HASH, VERSION } from "../../src/engines/messages/ts/stamp.ts"
import { BenchNetwork } from "../bench/network.ts"
import { ROOT } from "../lib/repo.ts"
import { Failed, main } from "../lib/run.ts"
import { desktop, type Desktop } from "./desktop.ts"
import { Guide } from "./guide.ts"

const OUT = path.join(ROOT, "target", "bench", "release-with-checks")
const PROFILE = path.join(ROOT, "profiles", "aircraft", "bksq-baronpro.yaml")
const BARON = /baronpro/i

/** A step's budget to the view, at p95 (record/areas/profiles/06-the-sync-log.md, "Budgets"). */
const STEP_WITHIN_MS = 150

/**
 * The entries the recording's case moves, by their keys in the tree's 58P profile: the battery,
 * the heading knob's bug, and the autopilot's two vertical modes, altitude hold and vertical
 * speed mode.
 */
const RECORDED = ["battery", "heading_bug", "ap_altitude_hold", "ap_vs_hold"]

/** A step's decision as serde writes the message crate's `Step`: a word alone, or a word with its fields. */
type Step = string | Record<string, Record<string, unknown>>

/** One step of the log, `LogStep` in the message crate's `sync` module. */
type LogStep = { row: number; at: number; entry: string; step: Step }

/** State sync's message to the profile extension, `SyncLog` in its module of the message crate. */
type SyncLog = { load: number; from: "Playback" | { Member: string } | null; steps: LogStep[] }

/** One of state sync's messages, with when it reached the script, in µs on the PC's counter. */
type Arrival = { arrived: number; log: SyncLog }

/**
 * A row as the script reads it: its entry, whom its first message named, that message's place
 * among the arrivals, and each step with its own message's place.
 */
type Row = { entry: string; from: string | null; first: number; steps: { step: LogStep; message: number }[] }

type Extension = {
  /** Each of state sync's messages, oldest first. */
  logs: Arrival[]
  tape(): TapeSlice | undefined
  /** Sends a command, and returns the core's answer: `null` when it took it, or its error. */
  command(name: string): Promise<string | null>
  close(): void
}

type Session = {
  extension: Extension
  guide: Guide
  say: (line: string, aloud?: boolean) => void
  /** Writes a line to the report alone, for the rows, which would bury the terminal's prompts. */
  note: (line: string) => void
  result: (ok: boolean, line: string) => void
  skip: (what: string) => void
}

main(() => {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== "--core") throw new Failed("usage: node tools/sim/sync-log.ts --core <program>")
  const core = path.resolve(args[1]!)
  if (!fs.existsSync(core)) throw new Failed(`there's no core at ${core}`)
  run(core).catch((error: Error) => {
    console.error(`\n${error.message}`)
    process.exit(1)
  })
})

async function run(program: string): Promise<void> {
  const text = fs.readFileSync(PROFILE, "utf8")
  const absent = RECORDED.filter((key) => !new RegExp(`^  ${key}:`, "m").test(text))
  if (absent.length > 0) throw new Failed(`${path.relative(ROOT, PROFILE)} has no entry ${absent.join(", ")}, which the recording's case moves`)
  process.env.DUALINPUT_BENCH_RELAY = path.join(OUT, "bench-relay.exe")
  process.env.DUALINPUT_BENCH_PROFILES = path.join(ROOT, "target", "bench", "profiles")

  const started = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
  const folder = path.join(ROOT, "target", "sim", "runs", `${started}-sync-log`)
  fs.mkdirSync(folder, { recursive: true })
  const report = path.join(folder, "report.txt")
  const guide = await Guide.start()
  const failures: string[] = []
  const skipped: string[] = []
  let passed = 0
  const note = (line: string) => fs.appendFileSync(report, `${line}\n`)
  const say = (line: string, aloud = false) => {
    console.log(line)
    note(line)
    if (aloud) guide.say(line)
  }
  const result = (ok: boolean, line: string) => {
    say(`${ok ? "PASSED" : "FAILED"}: ${line}`)
    if (ok) {
      passed++
      guide.pass()
    } else {
      failures.push(line)
      guide.fail()
    }
  }
  const skip = (what: string) => {
    say(`SKIPPED: ${what}`)
    skipped.push(what)
  }
  say(`The Sync log's cases in the sim, from ${started}, with the core ${program}`)

  const net = await BenchNetwork.start(1)
  const data = path.join(folder, "core")
  fs.mkdirSync(data, { recursive: true })
  fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ ...net.core().settings, "session.name": "Pilot" }, null, 2))
  const out = fs.openSync(`${data}-output.txt`, "w")
  const child = spawn(program, ["--data", data], { stdio: ["ignore", out, out] })
  await until(() => (fs.existsSync(path.join(data, "port.json")) ? true : undefined), 30_000, "the core's port file")
  // The extension connects as the core starts, as an author's VS Code open before the flight
  // does, so state sync turns the log on in each engine it loads.
  const extension = await connect(data)
  watchKeys(say, child, program, data, async () => {
    extension.close()
    await net.stop().catch(() => {})
    guide.close()
  })
  const real = await desktop(data, ["session", "sim", "profiles"])

  const c: Session = { extension, guide, say, note, result, skip }
  try {
    await alone(real, c)
    const from = extension.logs.length
    say("The cases run now, about two minutes of them. Each window you act in opens and closes with a short beep. Keep your hands off the controls until a step asks for them.", true)
    // A case that throws fails its own part and leaves the next to run.
    for (const part of [byHand, playedBack]) await part(c).catch((error: Error) => result(false, `${part.name} stopped: ${error.message}`))
    timing(c, from)
  } catch (error) {
    result(false, `the session stopped before its cases: ${(error as Error).message}`)
  }

  say("\n=== Results")
  say(`${passed} passed, ${failures.length} failed, ${skipped.length} skipped`)
  for (const line of failures) say(`  FAILED: ${line}`)
  for (const line of skipped) say(`  SKIPPED: ${line}`)
  say(`the report is ${path.relative(ROOT, report)}`)
  say("That's every case. Leave the flight loaded. Whoever runs the script stops it with q in its terminal, which replays the core's recording.", true)
}

/**
 * Connects to the core whose data folder is `data` as the profile extension, as `serve` does,
 * watching the recorder's slice, and saying it's alive every 2s, as a client must. Each of state
 * sync's messages is kept with the moment it reached the socket, on the clock of the steps' `at`,
 * so the budget's case subtracts one from the other: a step's `at` is its input's stamp, in µs on
 * the PC's `QueryPerformanceCounter` (src/apps/core/src/clock.rs), and Node's `process.hrtime`
 * reads the same counter, in ns from the same origin (measured on 2026-10-09,
 * record/areas/architecture/log.md, "The pages' clocks" in the entry "2026-10-09: In a flight, a
 * Rust client on SimConnect.dll masks, …").
 */
async function connect(data: string): Promise<Extension> {
  const port = (JSON.parse(fs.readFileSync(path.join(data, "port.json"), "utf8")) as { port: number }).port
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Failed(`the core's WebSocket on ${port} didn't open`))
  })
  const logs: Arrival[] = []
  const answers = new Map<number, (error: string | null) => void>()
  let tape: TapeSlice | undefined
  ws.onmessage = (event) => {
    // Stamped before the message is parsed, so a large one's parsing adds nothing to its time.
    const arrived = Number(process.hrtime.bigint() / 1000n)
    const message = JSON.parse(String(event.data)) as { t: string; unit?: string; body?: unknown; slice?: string; value?: unknown; id?: number; error?: string }
    if (message.t === "unit" && message.unit === "state-sync") logs.push({ arrived, log: message.body as SyncLog })
    else if (message.t === "state" && message.slice === "tape") tape = message.value as TapeSlice
    else if (message.t === "answer") answers.get(message.id!)?.(message.error ?? null)
  }
  const send = (message: FromClient) => ws.send(JSON.stringify(message))
  send({ t: "hello", component: "profile-extension", version: VERSION, hash: HASH })
  send({ t: "watch", slices: ["tape"] })
  const alive = setInterval(() => send({ t: "alive" }), 2_000)
  let next = 1
  return {
    logs,
    tape: () => tape,
    command(name) {
      const id = next++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Failed(`the core never answered ${name}`)), 10_000)
        answers.set(id, (error) => {
          clearTimeout(timer)
          resolve(error)
        })
        send({ t: "command", id, name, args: null })
      })
    },
    close() {
      clearInterval(alive)
      ws.close()
    },
  }
}

/**
 * Waits for the pilot's flight in the 58P, and hosts a session alone through Ready and
 * preflight's end, until the recorder can act.
 */
async function alone(real: Desktop, c: Session): Promise<void> {
  const sim = () => real.slice<SimSlice>("sim")
  const flying = () => sim()?.stage === "flying" && BARON.test(sim()?.aircraft?.path ?? "")
  // A moment for the sim's slice to arrive, so a flight already loaded isn't asked for again.
  await sleep(1_000)
  if (!flying()) c.say("Start the sim, load a flight in the Black Square Baron 58P on the ground at a stand, cold and dark, and press Ready to fly.", true)
  await until(() => (flying() ? true : undefined), 60 * 60_000, "a flight in the 58P")
  // The A220 went back to Loading 7s after it first flew, a second load of its own, so the
  // flight counts as loaded once it has flown for 15s straight (measured on MSFS 2024,
  // 2026-11-09, record/areas/sync/log.md, "Stage 14's session in the sim passed in four
  // aircraft, and no aircraft took an H: event our module fired").
  for (let since = Date.now(); Date.now() - since < 15_000; await sleep(250)) {
    if (!flying()) {
      await until(() => (flying() ? true : undefined), 10 * 60_000, "the 58P's flight to load again")
      since = Date.now()
    }
  }
  c.say(`the sim is flying ${sim()!.aircraft!.path}; hosting the session`)
  await real.command("session.host", null)
  const session = () => real.slice<SessionSlice>("session")
  await until(() => session()?.code ?? undefined, 30_000, "the session's code")
  c.say("waiting up to 75s for your aircraft to settle")
  await until(() => (session()?.ready?.length === 0 ? true : undefined), 75_000, "Ready to be allowed")
  await real.command("session.ready", { on: true })
  await until(() => (session()?.preflight.phase === "ended" ? true : undefined), 15_000, "preflight's end")
  await until(() => real.slice<ProfilesSlice>("profiles")?.loaded ?? undefined, 30_000, "a profile of the 58P's, which node tools/bench.ts sync-log publishes from the tree")
  await until(() => (c.extension.tape()?.off === null ? true : undefined), 30_000, "the recorder to be able to act")
}

/** A switch flipped by hand: each flip of the beacon is a row of its own, a local change, then sent. */
async function byHand(c: Session): Promise<void> {
  c.say("\n=== A switch flipped by hand")
  if (!(await phase(c, "the beacon switch", "Next, the beacon switch. At the beep, flip it and flip it back, twice, slowly, until the second beep, about 10 seconds."))) return
  const from = c.extension.logs.length
  await sleep(10_000)
  c.guide.tick()
  // A flip's `Sent` comes as the cockpit stream next sends, within its round of 50ms.
  await sleep(1_000)
  const flips = rows(c.extension.logs).filter((r) => r.entry === "beacon" && r.first >= from)
  const odd = flips.filter((r) => r.from !== null || words(r).join(", ") !== "LocalChange, Sent")
  c.result(
    flips.length > 0 && odd.length === 0,
    `the beacon switch gave ${count(flips.length, "row")}, each a local change, then sent${odd.length ? `, but not ${odd.map((r) => words(r).join(", ")).join("; ")}` : ""}`,
  )
  c.note("the beacon's rows, each with its steps' times from its first:")
  for (const row of flips) noteRow(c, row)
}

/**
 * A recording played back: the pilot records the battery, a turn of the heading knob, and the
 * autopilot's vertical modes, moves them elsewhere, and the recorder plays the recording, so its
 * putting back and each played change come from the playback, through state sync's own handlers
 * (record/areas/profiles/05-the-recorder.md, "Playback"). The battery stays on after Stop, since
 * it was off at Record, so putting back has it to turn off. The case finds its rows by when each
 * of the recorder's commands went rather than by the beeps, since a press can come late, and the
 * pilot moves nothing between a command and the beep after it.
 */
async function playedBack(c: Session): Promise<void> {
  c.say("\n=== A recording played back")
  if (!(await phase(c, "the recording", "Next, the recording, about a minute and a half. Each control's name comes just before its beep, and a second beep ends its turn."))) return
  // The autopilot may need the avionics bus as well as the battery (unverified), so the
  // avionics master goes on before Record, which keeps it out of the recording, and the battery
  // off, so the recording has the battery's change to hold.
  await act(c, "Set the avionics master on and the battery off.", 5_000)
  const recordFrom = await pressed(c, "tape.record")
  await act(c, "The battery on.", 4_000)
  await act(c, "Turn the heading knob to the right, slowly, about 30 degrees.", 6_000)
  await act(c, "Press the autopilot's ALT button.", 4_000)
  await act(c, "Press the autopilot's VS button.", 4_000)
  await sleep(1_000)
  const recordTo = await pressed(c, "tape.stop")
  const recorded = await until(
    () => {
      const state = c.extension.tape()?.state
      return state?.kind === "recorded" ? state : undefined
    },
    5_000,
    "the recording to end",
  )
  await act(c, "Now move them elsewhere. Turn the heading knob back to the left, about 60 degrees.", 6_000)
  await act(c, "Press ALT.", 4_000)
  c.say(`Hands off while the recorder puts the cockpit back and plays the recording, about ${Math.round(recorded.length_ms / 1000) + 10} seconds.`, true)
  const playFrom = await pressed(c, "tape.play")
  await until(() => (c.extension.tape()?.state.kind !== "recorded" ? true : undefined), 10_000, "the playback to start")
  await until(() => (c.extension.tape()?.state.kind === "recorded" ? true : undefined), recorded.length_ms + 90_000, "the playback to end")
  // The check of a write gives up 1.5s after it, so a played row's last step comes by then.
  await sleep(2_000)
  c.say("The playback ended.", true)
  const stopped = c.extension.tape()?.stopped
  if (stopped) c.say(`something other than Stop ended the playback: ${JSON.stringify(stopped)}`)

  const all = rows(c.extension.logs)
  const played = all.filter((r) => r.from === "playback" && r.first >= playFrom)
  const putBack = played.filter((r) => words(r)[0] === "CaughtUp")
  const counts = RECORDED.map((key) => ({
    key,
    sent: all
      .filter((r) => r.entry === key && r.from === null)
      .flatMap((r) => r.steps)
      .filter((s) => word(s.step.step) === "Sent" && s.message >= recordFrom && s.message < recordTo).length,
    played: played.filter((r) => r.entry === key && words(r)[0] === "Arrived").length,
  }))
  c.result(counts.every((n) => n.sent > 0), `the recording holds changes the stream sent of each entry the case moves: ${counts.map((n) => `${n.key} ${n.sent}`).join(", ")}`)
  c.result(putBack.length > 0, `the playback's putting back gave ${count(putBack.length, "row")} from the playback, each of a catch-up's value: ${[...new Set(putBack.map((r) => r.entry))].join(", ") || "none"}`)
  c.result(
    counts.every((n) => n.sent > 0 && n.played === n.sent),
    `each of those changes played back as a row of its own from the playback: ${counts.map((n) => `${n.key} ${n.played} of ${n.sent}`).join(", ")}`,
  )
  const times = played.flatMap((r) => {
    const ms = landedMs(r)
    return ms === undefined ? [] : [ms]
  })
  c.say(
    times.length === 0
      ? `none of the playback's ${count(played.length, "row")} landed`
      : `${times.length} of the playback's ${count(played.length, "row")} landed, read back ${fmt(percentile(times, 0.5))}ms after their first step at the median, and ${fmt(Math.max(...times))}ms at most`,
  )
  // This PC's own rows go in too, such as a local change the putting back puts back, since a
  // played row can wait on one, as the Sync log shows them side by side.
  c.note("the rows from Play on, the playback's and this PC's, each with its steps' times from its first:")
  for (const row of all.filter((r) => r.first >= playFrom)) noteRow(c, row)
}

/**
 * A step to the view: how long each step of the cases took to reach the extension, against the
 * budget of 150ms at p95 from the engine's call. A step's `at` is its input's stamp, which the
 * core takes as the input reaches its loop, at or before the engine's call, so each span also
 * holds the input's wait for the loop, and spans within the budget mean the budget held.
 */
function timing(c: Session, from: number): void {
  c.say("\n=== A step to the view")
  const logs = c.extension.logs.slice(from)
  const spans = logs.flatMap(({ arrived, log }) => log.steps.map((s) => (arrived - s.at) / 1000))
  if (spans.length === 0) {
    c.result(false, "no step reached the extension during the cases, so none was timed")
    return
  }
  const [p50, p95, worst] = [percentile(spans, 0.5), percentile(spans, 0.95), Math.max(...spans)]
  // A step can't reach the script before its input, so a span below 0 means the two clocks differ.
  const early = spans.filter((ms) => ms < 0).length
  c.result(
    early === 0 && p95 <= STEP_WITHIN_MS,
    `a step reached the extension ${fmt(p50)}ms after its input at p50, ${fmt(p95)}ms at p95, and ${fmt(worst)}ms at worst, over ${count(spans.length, "step")} in ${count(logs.length, "message")}, against ${STEP_WITHIN_MS}ms at p95${early ? `; ${early} arrived before their input's stamp, so the clocks differ` : ""}`,
  )
}

/**
 * Says what the pilot does next, aloud, and waits for Page Down to start it, with a beep, or Page
 * Up to skip it. Returns whether it started; a step not started within 5 minutes is skipped.
 */
async function phase(c: Session, what: string, text: string): Promise<boolean> {
  c.say(`${text} Press Page Down to start, or Page Up to skip.`, true)
  c.guide.skipped()
  c.guide.declined()
  for (const started = Date.now(); Date.now() - started < 5 * 60_000; await sleep(100)) {
    if (c.guide.declined()) {
      c.guide.tick()
      return true
    }
    if (c.guide.skipped()) {
      c.skip(`${what}, with Page Up`)
      return false
    }
  }
  c.skip(`${what}, with no Page Down within 5 minutes`)
  return false
}

/**
 * Names what the pilot does next, aloud, opens a window of `ms` for it with a beep once the
 * words are spoken, and closes it with another. The words take about 300ms each at the guide's
 * rate (an estimate, unverified), so a pilot hears the whole cue before the beep.
 */
async function act(c: Session, words: string, ms: number): Promise<void> {
  c.say(words, true)
  await sleep(500 + 300 * words.split(/\s+/).length)
  c.guide.tick()
  await sleep(ms)
  c.guide.tick()
}

/**
 * Sends a recorder's command as the extension, and returns how many of state sync's messages had
 * arrived as it went, which marks the command among them. Fails when the core refuses it, as it
 * does with the recorder off.
 */
async function pressed(c: Session, name: string): Promise<number> {
  const at = c.extension.logs.length
  const error = await c.extension.command(name)
  if (error !== null) throw new Failed(`the core refused ${name}: ${error}`)
  return at
}

/** The rows the messages make, in the order each began, each found by its load and its number there. */
function rows(logs: Arrival[]): Row[] {
  const found = new Map<string, Row>()
  for (const [message, { log }] of logs.entries()) {
    for (const step of log.steps) {
      const key = `${log.load}/${step.row}`
      let row = found.get(key)
      if (!row) {
        const from = log.from === null ? null : log.from === "Playback" ? "playback" : log.from.Member
        row = { entry: step.entry, from, first: message, steps: [] }
        found.set(key, row)
      }
      row.steps.push({ step, message })
    }
  }
  return [...found.values()]
}

/** The ms from a row's first step to the read back that landed its write, or undefined where none did. */
function landedMs(row: Row): number | undefined {
  const landed = row.steps.find(({ step }) => typeof step.step !== "string" && step.step.ReadBack?.landed === true)
  return landed && (landed.step.at - row.steps[0]!.step.at) / 1000
}

/**
 * Writes a row to the report: its entry, its sender if it has one, and its latest step, then each
 * step with its time from the row's first, the first of which says the row's cause.
 */
function noteRow(c: Session, row: Row): void {
  const first = row.steps[0]!.step.at
  const landed = landedMs(row)
  c.note(`  ${row.entry}${row.from === null ? "" : `, from ${row.from}`}: ${said(row.steps.at(-1)!.step.step)}${landed === undefined ? "" : `, read back ${fmt(landed)}ms after its first step`}`)
  for (const { step } of row.steps) c.note(`    ${`+${fmt((step.at - first) / 1000)}ms`.padEnd(11)}${said(step.step)}`)
}

function words(row: Row): string[] {
  return row.steps.map((s) => word(s.step.step))
}

function word(step: Step): string {
  return typeof step === "string" ? step : Object.keys(step)[0]!
}

/**
 * A step under the engine's word for it, then its fields: a value as its number or quoted text, a
 * flag such as `landed` by its name where it's true, and a write's actions each by its name and
 * values, as in `ReadBack 1 landed` and `Writes B('ELECTRICAL_Battery_1_Toggle')`.
 */
function said(step: Step): string {
  if (typeof step === "string") return step
  const [name, fields] = Object.entries(step)[0]!
  const parts = Object.entries(fields).flatMap(([field, v]) => {
    if (typeof v === "boolean") return v ? [field] : []
    if (v === null) return []
    return [Array.isArray(v) ? v.map(shown).join(", ") : shown(v)]
  })
  return [name, ...parts].join(" ")
}

function shown(v: unknown): string {
  if (typeof v === "string" || typeof v === "number") return String(v)
  if (v !== null && typeof v === "object") {
    if ("Number" in v) return String(v.Number)
    if ("Text" in v) return JSON.stringify(v.Text)
    if ("name" in v && "values" in v && Array.isArray(v.values)) return [String(v.name), ...v.values.map(shown)].join(" ")
  }
  return JSON.stringify(v)
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? NaN
}

function fmt(ms: number): string {
  return String(Number(ms.toFixed(1)))
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}

async function until<T>(get: () => T | undefined, ms: number, what: string): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = get()
    if (value !== undefined) return value
    if (Date.now() - started > ms) throw new Failed(`gave up after ${ms / 1000}s waiting for ${what}`)
    await sleep(100)
  }
}

/** On q or Ctrl+C in the script's terminal, stops the core and the network, and replays the core's recording, as tools/sim/authoring.ts does. */
function watchKeys(say: (line: string) => void, child: ReturnType<typeof spawn>, program: string, data: string, end: () => Promise<void>): void {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on("data", async (key: Buffer) => {
    const typed = key.toString("utf8")
    if (typed !== "q" && typed !== "\u0003") return
    await end()
    child.kill()
    await sleep(1_000)
    const recordings = path.join(data, "recordings")
    const newest = fs.existsSync(recordings) ? fs.readdirSync(recordings).sort().at(-1) : undefined
    const recording = newest && path.join(recordings, newest, "inputs.zst")
    if (recording && fs.existsSync(recording)) {
      const replayed = spawnSync(program, ["replay", recording], { encoding: "utf8" })
      say(`the core's replay: ${(replayed.stdout + replayed.stderr).trim()}`)
    }
    process.exit(0)
  })
}
