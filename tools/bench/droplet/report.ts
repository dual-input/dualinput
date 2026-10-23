// The droplet run's report: for each run in a folder that tools/bench/droplet/run.ts filled, how
// many probes of each part the sender made and the receiver got, and how late they came, then a
// line for each run that sets the builds it ran side by side (record/areas/network/02-units.md,
// "Cases for the bench").
//
// Late is a probe's one-way delay above the floor, the lowest delay of any one-off probe that
// way in the run, as p06's analysis measured it. The two ends of a far run read two droplets'
// clocks, so a delay alone holds the clocks' offset, and only what it is above the floor counts.
// A run whose connection wasn't direct from the mix's start to its end, or whose link was lost,
// is reported and left out of the comparison.
//
//   node tools/bench/droplet/report.ts <folder>
//
// The folder holds `<build>/<run>/{dial,listen}/`, each with the program's probes.json and
// transport.ndjson.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** A probe as probes.json lists it: its number, its send stamp, and when it came, in µs. */
type Got = [number, number, number]

type Results = {
  role: "listen" | "dial"
  started: number | null
  secs: number
  sent: Record<string, number>
  got: Record<string, Got[]>
  round_trips: number[]
  links: [string, number][]
}

type Line = { t: number; conn: number; path?: unknown; sent?: number; lost?: number; rtt_us?: number; cwnd?: number }

type End = { results: Results; transport: Line[] }

/** The one-off parts, each way, and the stream parts, as src/mix.rs sends them. */
const ONE_OFFS = { dial: ["flight", "controls", "avatar", "batch", "audio"], listen: ["avatar"] }
const STREAMS = { dial: ["cockpit", "request"], listen: [] as string[] }

/** What src/mix.rs's `DRAIN` gives after the mix, in µs. */
const DRAIN_US = 5_000_000

export type Part = { part: string; made: number; got: number; p50: number; p99: number; max: number }

export type Run = {
  name: string
  /** Why the run doesn't count, if it doesn't. */
  refused?: string
  out: Part[]
  back: Part[]
  roundTrip: { p50: number; p99: number; max: number }
  quic: { dial: Quic; listen: Quic }
}

type Quic = { sent: number; lost: number; minCwnd: number; maxRttMs: number }

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN
}

/** One direction: the sender's counts against what the receiver got, late above the floor. */
export function direction(from: Results, to: Results, oneOffs: string[], streams: string[]): Part[] {
  const delays = (part: string) => (to.got[part] ?? []).map(([, sent, came]) => came - sent)
  const floor = Math.min(...oneOffs.flatMap(delays))
  return [...oneOffs, ...streams].map((part) => {
    const unique = new Map((to.got[part] ?? []).map((g) => [g[0], g]))
    const late = [...unique.values()].map(([, sent, came]) => came - sent - floor).sort((a, b) => a - b)
    return { part, made: from.sent[part] ?? 0, got: unique.size, p50: percentile(late, 50), p99: percentile(late, 99), max: late.at(-1) ?? Number.NaN }
  })
}

/** Why the end's connection didn't run direct through the mix, or `undefined` when it did. */
export function notDirect(end: End): string | undefined {
  const { started, secs, links } = end.results
  if (started === null) return `the ${end.results.role} end never started its mix`
  const until = started + secs * 1_000_000 + DRAIN_US
  if (links.some(([what, t]) => what === "lost" && t >= started && t <= until)) return `the ${end.results.role} end lost its link during the mix`
  const paths = end.transport.filter((l) => l.path !== undefined)
  const atStart = paths.filter((l) => l.t <= started).at(-1)
  if (atStart?.path !== "Direct") return `the ${end.results.role} end's path at the mix's start was ${JSON.stringify(atStart?.path ?? "unknown")}`
  const moved = paths.find((l) => l.t > started && l.t <= until && l.path !== "Direct")
  if (moved) return `the ${end.results.role} end's path moved to ${JSON.stringify(moved.path)} during the mix`
  return undefined
}

/** What QUIC counted during the mix, from the stats it logged each second. */
function quic(end: End): Quic {
  const { started, secs } = end.results
  const from = started ?? 0
  const stats = end.transport.filter((l) => l.lost !== undefined && l.t >= from && l.t <= from + secs * 1_000_000 + DRAIN_US)
  const first = stats[0]
  const last = stats.at(-1)
  return {
    sent: (last?.sent ?? 0) - (first?.sent ?? 0),
    lost: (last?.lost ?? 0) - (first?.lost ?? 0),
    minCwnd: Math.min(...stats.map((l) => l.cwnd ?? Infinity)),
    maxRttMs: Math.max(...stats.map((l) => (l.rtt_us ?? 0) / 1000)),
  }
}

function readEnd(folder: string): End {
  const results = JSON.parse(fs.readFileSync(path.join(folder, "probes.json"), "utf8")) as Results
  const transport = fs
    .readFileSync(path.join(folder, "transport.ndjson"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Line)
  return { results, transport }
}

export function run(name: string, dial: End, listen: End): Run {
  const trips = [...dial.results.round_trips].sort((a, b) => a - b)
  return {
    name,
    refused: notDirect(dial) ?? notDirect(listen),
    out: direction(dial.results, listen.results, ONE_OFFS.dial, STREAMS.dial),
    back: direction(listen.results, dial.results, ONE_OFFS.listen, STREAMS.listen),
    roundTrip: { p50: percentile(trips, 50), p99: percentile(trips, 99), max: trips.at(-1) ?? Number.NaN },
    quic: { dial: quic(dial), listen: quic(listen) },
  }
}

const ms = (us: number) => (Number.isNaN(us) ? "-" : (us / 1000).toFixed(1))
const lossOf = (p: Part | undefined) => (p && p.made ? `${((100 * (p.made - p.got)) / p.made).toFixed(1)}%` : "-")

function table(r: Run): string[] {
  const lines = [`== ${r.name}${r.refused ? `: refused, since ${r.refused}` : ""}`]
  lines.push(`  session round trip p50 ${ms(r.roundTrip.p50)}ms, p99 ${ms(r.roundTrip.p99)}ms, max ${ms(r.roundTrip.max)}ms`)
  for (const [end, q] of Object.entries(r.quic)) {
    lines.push(`  QUIC at the ${end} end: ${q.sent} packets sent, ${q.lost} lost, smallest window ${q.minCwnd} bytes, longest round trip ${q.maxRttMs.toFixed(1)}ms`)
  }
  lines.push("  part        way  made   got    lost   late p50  p99     max")
  for (const [way, parts] of [["out", r.out], ["back", r.back]] as const) {
    for (const p of parts) {
      lines.push(`  ${p.part.padEnd(10)}  ${way.padEnd(4)} ${String(p.made).padStart(5)}  ${String(p.got).padStart(5)}  ${lossOf(p).padStart(6)}  ${ms(p.p50).padStart(7)}  ${ms(p.p99).padStart(6)}  ${ms(p.max).padStart(6)}`)
    }
  }
  return lines
}

/** A line for each run and build: the parts whose lateness the newest-only slots could change. */
function comparison(runs: Run[]): string[] {
  const lines = ["", "late in ms, p99/max, and the batch's loss; refused runs left out", "run                         flight       audio        avatar back  cockpit      batch loss  round trip"]
  for (const r of runs.filter((r) => !r.refused)) {
    const part = (parts: Part[], name: string) => parts.find((p) => p.part === name)
    const pm = (p: Part | undefined) => (p ? `${ms(p.p99)}/${ms(p.max)}` : "-")
    lines.push(
      `${r.name.padEnd(28)}${pm(part(r.out, "flight")).padEnd(13)}${pm(part(r.out, "audio")).padEnd(13)}${pm(part(r.back, "avatar")).padEnd(13)}${pm(part(r.out, "cockpit")).padEnd(13)}${lossOf(part(r.out, "batch")).padEnd(12)}${ms(r.roundTrip.p99)}/${ms(r.roundTrip.max)}`,
    )
  }
  return lines
}

const noQuic: Quic = { sent: 0, lost: 0, minCwnd: 0, maxRttMs: 0 }

/** Every run in the folder, by build, then by run, in name order. */
export function report(folder: string): string {
  const runs: Run[] = []
  for (const build of fs.readdirSync(folder).sort()) {
    const builds = path.join(folder, build)
    if (!fs.statSync(builds).isDirectory()) continue
    for (const name of fs.readdirSync(builds).sort()) {
      const at = path.join(builds, name)
      try {
        runs.push(run(`${build} ${name}`, readEnd(path.join(at, "dial")), readEnd(path.join(at, "listen"))))
      } catch (error) {
        runs.push({ name: `${build} ${name}`, refused: `its results didn't read: ${error instanceof Error ? error.message : error}`, out: [], back: [], roundTrip: { p50: NaN, p99: NaN, max: NaN }, quic: { dial: noQuic, listen: noQuic } })
      }
    }
  }
  return [...runs.flatMap(table), ...comparison(runs)].join("\n")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2]
  if (!folder) {
    console.error("usage: node tools/bench/droplet/report.ts <folder>")
    process.exit(2)
  }
  console.log(report(folder))
}
