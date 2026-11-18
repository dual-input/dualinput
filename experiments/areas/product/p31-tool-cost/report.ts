/*
 * p31's report: the runs of the last 12 hours side by side, from the JSON each run wrote, with what
 * each tool syncs and what kept the comparison from being even. It reads only the results folder,
 * so it can be written again at any time.
 */

import fs from "node:fs"
import path from "node:path"

import type { FrameStats, ProcessResult } from "./measure.ts"
import { RESULTS } from "./places.ts"
import { compareProfiles } from "./profiles.ts"
import { kbs, MODES, summary, type Result } from "./result.ts"

const WITHIN_MS = 12 * 60 * 60_000
const GROUPS = [
  ["pilot: ", "The pilot's tool, what a pilot's PC runs"],
  ["second pilot: ", "The second pilot, on this PC only for the test"],
  ["network: ", "The relay and servers, on this PC only for the test"],
  ["harness: ", "The harness itself, the same in every run"],
] as const

export function report(): string {
  const all = fs
    .readdirSync(RESULTS)
    .filter((f) => /^p31-.*\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(RESULTS, f), "utf8")) as Result)
    .filter((r) => !r.dry && r.measured)
    .sort((a, b) => a.measured!.started.localeCompare(b.measured!.started))
  if (!all.length) throw new Error(`there are no runs in ${RESULTS} to report`)
  const last = Date.parse(all.at(-1)!.measured!.started)
  const runs = all.filter((r) => last - Date.parse(r.measured!.started) < WITHIN_MS)
  const seen = new Map<string, number>()
  const names = runs.map((r) => {
    const n = (seen.get(r.mode) ?? 0) + 1
    seen.set(r.mode, n)
    return n === 1 ? r.label : `${r.label}, run ${n}`
  })

  const out: string[] = []
  const first = runs[0]!
  out.push(`p31: what Dual Input and FS Copilot cost one PC, measured on ${first.measured!.started.slice(0, 10)}`)
  out.push("")
  out.push(
    `Each run started MSFS 2024 ${first.simVersion ?? "(version unread)"} fresh with one tool's package in Community, or neither, loaded the Black Square Baron 58P on runway 14 at Seymour, SEGS, in Clear Skies at noon, engines running and parking brake set, and measured ${first.measured!.seconds}s after a 30s settle, with nobody touching anything. ` +
      `PresentMon timed every frame the sim presented, a sampler read each process's memory every 2s and its CPU time at the start and end, and the kernel's network events counted each process's bytes. ` +
      `Dual Input ran from commit ${first.commit}; FS Copilot from the fork's build that fsc-exerciser synced, ${fscLine(runs.find((r) => r.fsc)?.fsc)}.`,
  )
  out.push(`The runs, in order: ${runs.map((r, i) => `${names[i]} at ${r.measured!.started.slice(11, 16)} UTC`).join(", ")}.`)
  out.push("")

  out.push("## The sim's frame times, in ms")
  out.push("")
  out.push(row(["run", "frames", "fps", "median", "p95", "p99", "worst", "over 50ms", "median of each minute", "focus"]))
  runs.forEach((r, i) => {
    const f = r.measured!.frames
    const focus = `${(r.measured!.focus * 100).toFixed(0)}%`
    if ("error" in f) out.push(row([names[i]!, f.error, "", "", "", "", "", "", "", focus]))
    else out.push(row([names[i]!, String(f.frames), f.fps.toFixed(1), f.p50.toFixed(2), f.p95.toFixed(2), f.p99.toFixed(2), f.max.toFixed(1), String(f.over50ms), f.minuteP50.map((v) => v.toFixed(2)).join(" "), focus]))
  })
  const baselines = runs.filter((r) => r.mode === "none" && !("error" in r.measured!.frames)).map((r) => r.measured!.frames as FrameStats)
  if (baselines.length) {
    const base = { p50: avg(baselines.map((b) => b.p50)), p99: avg(baselines.map((b) => b.p99)), fps: avg(baselines.map((b) => b.fps)) }
    out.push("")
    out.push(`Against the run${baselines.length > 1 ? "s" : ""} with no tool (median ${base.p50.toFixed(2)}ms, p99 ${base.p99.toFixed(2)}ms, ${base.fps.toFixed(1)} fps):`)
    for (const [i, r] of runs.entries()) {
      const f = r.measured!.frames
      if (r.mode === "none" || "error" in f) continue
      out.push(`- ${names[i]}: median ${signed(f.p50 - base.p50)}ms, p99 ${signed(f.p99 - base.p99)}ms, ${signed(f.fps - base.fps)} fps`)
    }
    if (baselines.length > 1) {
      const spread = (k: "p50" | "p99") => Math.max(...baselines.map((b) => b[k])) - Math.min(...baselines.map((b) => b[k]))
      out.push(`- The runs with no tool differ from each other by ${spread("p50").toFixed(2)}ms at the median and ${spread("p99").toFixed(2)}ms at p99, so a difference smaller than that is the PC's drift, not a tool's cost.`)
    } else out.push("- With one run with no tool, the report can't say how far the PC drifts between runs; a second at the end would.")
  }
  out.push("")

  out.push("## CPU, memory, and network, over the window")
  out.push("")
  out.push("CPU is a percentage of one logical core, memory the working set and private bytes in MB as a mean, and network the bytes each process sent and received, per second.")
  runs.forEach((r, i) => {
    const m = r.measured!
    out.push("")
    out.push(`### ${names[i]}`)
    out.push("")
    out.push(`The whole PC's CPU: ${m.pcCpuPercent.toFixed(1)}% of ${m.logicalCores} logical cores.`)
    const sim = m.processes.find((p) => p.role === "the sim")
    if (sim) out.push(`The sim: ${line(sim, r)}`)
    for (const [prefix, title] of GROUPS) {
      const members = m.processes.filter((p) => p.role.startsWith(prefix))
      if (!members.length) continue
      const cpu = members.reduce((s, p) => s + (p.cpuPercent ?? 0), 0)
      const ws = members.reduce((s, p) => s + (p.workingSetMeanMB ?? 0), 0)
      out.push(`${title}: ${cpu.toFixed(2)}% of one core and ${ws.toFixed(0)} MB working set together`)
      for (const p of members) out.push(`- ${p.role.slice(prefix.length)}: ${line(p, r)}`)
    }
    if ("error" in m.network) out.push(`Network: ${m.network.error}`)
    if (r.relayBytes) {
      for (const [pid, through] of Object.entries(r.relayBytes)) {
        const who = m.processes.find((p) => p.pid === Number(pid))?.role ?? `process ${pid}`
        out.push(`Through the bench relay, ${who} sent ${kbs(through.bytes, m.seconds)}, ${(through.busiestSecond / 1024).toFixed(1)} KB in its busiest second`)
      }
    }
    const ours = new Set(m.processes.map((p) => p.pid))
    const others = m.busiest.filter((b) => !ours.has(b.pid) && b.cpuPercent > 5 && !/^(Idle|System|powershell)$/i.test(b.name))
    if (others.length) out.push(`Other processes busy in the window: ${others.map((b) => `${b.name} ${b.cpuPercent.toFixed(1)}%`).join(", ")}`)
  })
  out.push("")

  out.push("## What each tool syncs of the 58P")
  out.push("")
  for (const l of compareProfiles()) out.push(l, "")

  out.push("## What kept the comparison from being even")
  out.push("")
  for (const [i, r] of runs.entries()) {
    const m = r.measured!
    if (m.focus < 0.95) out.push(`- ${names[i]}: the sim had the focus in only ${(m.focus * 100).toFixed(0)}% of samples, and MSFS 2024 draws fewer frames without it.`)
    const pilot = m.processes.filter((p) => p.role.startsWith("pilot: "))
    const net = m.network
    if (pilot.length && !("error" in net) && pilot.every((p) => !net[p.pid]?.sent)) {
      out.push(`- ${names[i]}: the network trace saw no byte sent by the pilot's tool, so the kernel's events may miss loopback, and its network numbers say nothing.`)
    }
    for (const n of r.notes) out.push(`- ${names[i]}: ${n}`)
  }
  for (const mode of Object.keys(MODES)) if (!runs.some((r) => r.mode === mode)) out.push(`- No run with ${MODES[mode as keyof typeof MODES]} is in the last 12 hours.`)
  out.push(
    "- The flight sat on the runway with its engines running, so the runs measure a connected session at rest: each tool still streams the aircraft at its full rate, but a flight, or a crew working switches, has each tool send more changes.",
    "- Each second pilot runs on this PC only for the test: a second FS Copilot, whose SimConnect.cfg sends it to a closed port so it never reaches the sim, and FS Copilot's relay, against a bench core on a stand-in sim, the bench relay, and the local backend under wrangler. Their CPU comes out of the same PC as the sim's, so the report lists them apart from the pilot's tool. fsc-exerciser couldn't be FS Copilot's second pilot: the fork's main refused its join for a schema that lacks the traffic and ATC packets.",
    "- Both tools' links crossed a local relay: Dual Input's through the bench relay, by the bench's relays-only setting, and FS Copilot's through its own relay, by its `--no-direct` switch. Between two PCs, each links directly when it can, and its relay costs that PC nothing.",
    "- Neither tool's traffic or ATC sharing was switched on, and each starts with it off until a pilot claims it (read in FS Copilot fork, src/FsCopilot/Simulation/ShareSwitch.cs, and record/areas/architecture/02-code-map.md, \"The traffic and ATC switch\").",
    "- Dual Input's desktop app didn't run; the pilot's core ran alone, as tools/sim/camera.ts runs it. The app, as a tray icon with its window closed, holds about 4 MB and uses 0.14% to 0.26% of one core (measured on our development machine, record/areas/install/log.md, 2026-11-11, and record/areas/traffic-atc/log.md). FS Copilot's one process is its window and its logic together, and its window stayed open.",
    "- Dual Input draws the second pilot's figure in the copilot's seat, and FS Copilot draws no one, so the sim's frame times in the Dual Input run carry that figure.",
    "- The two profiles watch different lists, as the section above shows, and FS Copilot's includes modules for the PMS50 GTN, which this PC has installed.",
    "- Each run started the sim fresh, so the scenery and shader caches warmed across the runs in their order, which the table gives.",
  )
  out.push("")
  out.push("## Each run as it printed")
  for (const [i, r] of runs.entries()) out.push("", `### ${names[i]}`, "", ...summary(r))

  const file = path.join(RESULTS, `p31-${new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")}-report.md`)
  fs.writeFileSync(file, `${out.join("\n")}\n`)
  console.log(out.join("\n"))
  return file
}

function fscLine(fsc: Result["fsc"] | undefined): string {
  return fsc ? `commit ${fsc.commit}, synced ${fsc.synced.slice(0, 10)}, FsCopilot.dll ${fsc.hash}` : "which went unrecorded"
}

function line(p: ProcessResult, r: Result): string {
  const m = r.measured!
  const net = "error" in m.network ? undefined : m.network[p.pid]
  return `${p.cpuPercent === null ? "CPU unread" : `${p.cpuPercent.toFixed(2)}%`}, ${p.workingSetMeanMB?.toFixed(0) ?? "?"} MB working set, ${p.privateMeanMB?.toFixed(0) ?? "?"} MB private${net ? `, sent ${kbs(net.sent, m.seconds)}, received ${kbs(net.received, m.seconds)}` : ""}${p.exited ? ", ended during the window" : ""}`
}

function row(cells: string[]): string {
  return `| ${cells.join(" | ")} |${cells[0] === "run" ? `\n|${cells.map(() => " --- ").join("|")}|` : ""}`
}

function avg(v: number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length
}

function signed(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`
}
