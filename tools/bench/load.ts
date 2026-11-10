// The loop under load, by hand, since it measures timing: one bench core plays p10's
// capture of a flight `plays` times over, with a session's made-up inputs beside it, then
// exits. This reads the loop's stats from the core's log, replays its recording, and prints
// each budget beside what it measured (record/areas/build/02-testing.md, "The loop under
// load"). tools/bench.ts builds the core and runs this:
//
//   node tools/bench.ts load [plays]

import fs from "node:fs"
import path from "node:path"

import { simRunning } from "../lib/install.ts"
import { ROOT } from "../lib/repo.ts"
import { BenchRun } from "./cores.ts"

const CAPTURE = path.join(ROOT, "tools", "bench", "fixtures", "flight-58p-egll-600s.bin.zst")
/** The capture's length, from its first record to its last. */
const CAPTURE_S = 600.016
/** Once a minute the load unit stops the loop for 100ms, as a write function at its limit. */
const STOP_EVERY_S = 60

// The budgets, from the code map's "Budgets" and 01-loop-and-edge's.
const QUEUE_P99_US = 11_200
const BUSY_PERCENT = 20
const REPLAY_S_PER_HOUR = 360

const plays = Number(process.argv[2])
if (!Number.isInteger(plays) || plays < 1) throw new Error(`plays should be a whole number from 1, not ${process.argv[2]}`)

// Beside the sim, Windows gives the sim the CPU in turns, and a handler the loop's thread
// waits through takes over 1ms by the wall clock, so there the queue's wait alone judges the
// loop (user, 2026-11-10; record/areas/build/02-testing.md, "The loop under load").
const besideSim = simRunning()
const run = new BenchRun("load")
const core = await run.core("a")
const times = plays === 1 ? "once" : `${plays} times over`
console.log(`the core plays ${path.basename(CAPTURE)} ${times}, for about ${Math.round((plays * CAPTURE_S) / 60)} minutes`)
core.send({ kind: "load", capture: CAPTURE, plays })
const code = await core.exited
const [recording] = core.recordings()
if (code !== 0 || !recording) throw new Error(`the core exited with ${code}; its output is in ${core.data}-output.txt`)

const log = fs.readFileSync(path.join(path.dirname(recording), "log.txt"), "utf8")
const stats = log.split(/\r?\n/).filter((line) => line.includes("the loop's stats")).map(fields)
const whole = stats.find((s) => s.window === "run")
if (!whole) throw new Error(`the core's log holds no stats for the whole run: ${recording}`)
// Only whole minutes: the core's last line covers the few seconds before its exit, where
// one 100ms stop would be more than 1% of the inputs.
const minutes = stats.filter((s) => s.window === "minute" && Number(s.seconds) >= 59.5)
const worstMinute = Math.max(...minutes.map((s) => Number(s.wait_p99_us)))

const replayed = run.replay(recording)
const seconds = Number(whole.seconds)
const replayPerHour = (replayed.ms / 1_000) * (3_600 / seconds)
const stops = Math.floor((plays * CAPTURE_S) / STOP_EVERY_S)

const verdict = (ok: boolean) => (ok ? "within" : "MISSED")
const us = (n: number | string) => {
  const v = Number(n)
  return v >= 1_000 ? `${(v / 1_000).toFixed(1)}ms` : `${v}µs`
}
const report = [
  `the loop under load: ${path.basename(CAPTURE)} played ${times}, a run of ${seconds.toFixed(0)}s, ${besideSim ? "beside the sim" : "with no sim running"}, in ${run.folder}`,
  `inputs\t${whole.inputs}, ${(Number(whole.inputs) / seconds).toFixed(0)} a second`,
  `queue wait, p50\t${us(whole.wait_p50_us!)}`,
  `queue wait, p99\t${us(whole.wait_p99_us!)}\tbudget ${us(QUEUE_P99_US)}\t${verdict(Number(whole.wait_p99_us) <= QUEUE_P99_US)}`,
  // The budget holds over the run. A minute whose 100ms stop lands on a burst of traffic's
  // records, about 300 every 500ms, holds 1% of the minute's inputs behind it, so the worst
  // minute shows how often that happened, and has no budget of its own.
  `queue wait, p99 of the worst minute\t${us(worstMinute)}`,
  `queue wait, p99.9\t${us(whole.wait_p999_us!)}`,
  `queue wait, most\t${us(whole.wait_max_us!)}`,
  `busy\t${whole.busy_percent}%\tbudget ${BUSY_PERCENT}%\t${verdict(Number(whole.busy_percent) < BUSY_PERCENT)}`,
  // The input that loads the engine compiles its 100 write functions, which took 1.1ms on a
  // quiet PC and counts against the profile's load, not a handler's 1ms.
  besideSim
    ? `inputs over 1ms\t${whole.over_1ms}, of which the load's 100ms stops are ${stops} or ${stops - 1}, and the engine's load 1\tbeside the sim, recorded with no budget`
    : `inputs over 1ms\t${whole.over_1ms}, of which the load's 100ms stops are ${stops} or ${stops - 1}, and the engine's load 1\tbudget 1ms but the stops and the load\t${verdict(Number(whole.over_1ms) <= stops + 1)}`,
  `slowest input\t${us(whole.slowest_us!)}, #${whole.slowest_seq}`,
  `replay\t${(replayed.ms / 1_000).toFixed(1)}s for ${replayed.inputs} inputs, ${replayPerHour.toFixed(1)}s an hour\tbudget ${REPLAY_S_PER_HOUR}s an hour\t${verdict(replayPerHour < REPLAY_S_PER_HOUR)}`,
  // The playback, the timer thread, and tokio's jobs push at once, and the
  // recording's writer stops at an input whose stamp falls below the one before, so a
  // recording that holds every input the loop handled shows every stamp rose with its
  // sequence number (record/areas/core/01-loop-and-edge.md, "Cases for the bench").
  `stamps rise\t${replayed.inputs} of ${whole.inputs} inputs recorded in order\t\t${verdict(replayed.inputs === Number(whole.inputs))}`,
  `recording\t${(fs.statSync(recording).size / 1e6).toFixed(1)} MB`,
].join("\n")
console.log(`\n${report}`)
fs.writeFileSync(path.join(run.folder, "report.txt"), `${report}\n`)
if (report.includes("MISSED")) process.exitCode = 1

/** A log line's fields, such as `inputs=38520` and `busy_percent=0.61`. */
function fields(line: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const m of line.matchAll(/(\w+)=("?)([^\s"]*)\2/g)) found[m[1]!] = m[3]!
  return found
}
