/*
 * p31's report: the last schedule's runs side by side, from the JSON each run wrote, with what each
 * tool syncs and what kept the comparison from being even. It reads only the results folder, so it
 * can be written again at any time.
 */

import fs from "node:fs"
import path from "node:path"

import type { ProcessResult } from "./measure.ts"
import { RESULTS } from "./places.ts"
import { compareProfiles } from "./profiles.ts"
import { kbs, MODES, summary, type Result } from "./result.ts"

/**
 * The last schedule is the newest run and each run before it that started within this of the run
 * after it. A schedule starts a run about every 13 minutes, and a run that fails all three tries
 * takes about 40, so an hour's gap only falls between schedules.
 */
const GAP_MS = 60 * 60_000
const GROUPS = [
  ["pilot: ", "The pilot's tool, what a pilot's PC runs"],
  ["second pilot: ", "The second pilot, on this PC only for the test"],
  ["network: ", "The relay and servers, on this PC only for the test"],
  ["harness: ", "The harness itself, the same in every run"],
] as const

export function report(): string {
  // A run's file is named for when it started, in UTC, and its mode, as p31-2026-11-18_09-54-00-fsc.json or p31-2026-11-20_09-54-00-dualinput-no-figures.json.
  const files = fs
    .readdirSync(RESULTS)
    .filter((f) => /^p31-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d-[\w-]+\.json$/.test(f))
    .map((f) => ({ at: Date.parse(`${f.slice(4, 14)}T${f.slice(15, 23).replaceAll("-", ":")}Z`), result: JSON.parse(fs.readFileSync(path.join(RESULTS, f), "utf8")) as Result }))
    .filter((f) => !f.result.dry)
    .sort((a, b) => a.at - b.at)
  if (!files.some((f) => f.result.measured)) throw new Error(`there are no measured runs in ${RESULTS} to report`)
  let start = files.length - 1
  while (start > 0 && files[start]!.at - files[start - 1]!.at < GAP_MS) start--
  const recent = files.slice(start)
  if (!recent.some((f) => f.result.measured)) throw new Error(`the last schedule's runs in ${RESULTS} measured nothing`)
  const runs = recent.filter((f) => f.result.measured).map((f) => f.result)
  const failed = recent.filter((f) => !f.result.measured).map((f) => f.result)
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
    `Each run started MSFS 2024 ${first.simVersion ?? "(version unread)"} fresh with one tool's package in Community, or neither, loaded the Black Square Baron 58P on runway 14 at Seymour, SEGS, set the time to noon, and measured ${first.measured!.seconds}s after a 30s settle, with nobody at the PC. ` +
      `The modes ran in turn, every second round in reverse, so a steady drift over the hours falls on every mode alike, and the modes are compared by their medians across the runs nothing disturbed. ` +
      `PresentMon timed every frame the sim presented, a sampler read each process's memory every 2s and its CPU time at the start and end, and the kernel's network events counted each process's bytes. ` +
      `Dual Input ran from commit ${first.commit}; FS Copilot from the fork's build that fsc-exerciser synced, ${fscLine(runs.find((r) => r.fsc)?.fsc)}.`,
  )
  out.push("")

  const kept = runs.filter((r) => !disturbed(r).length)
  out.push("## The tools side by side")
  out.push("")
  out.push(
    `Each figure is the median, across a mode's runs that nothing disturbed, of that run's own figure. Frame times are in ms; CPU is a percentage of one logical core; memory is the mean working set in MB; network is KB/s. ` +
      `CPU busy is the median time, in ms, the sim's CPU worked on each frame, which PresentMon measures apart from its wait: a sim held at a frame-rate cap draws every frame in the same time whatever a tool costs, and the cost shows there instead.`,
  )
  out.push("")
  out.push(row(["mode", "runs kept", "fps", "frame median", "p95", "p99", "over 50ms", "CPU busy per frame", "the sim's CPU", "the sim's memory", "the pilot's tool's CPU", "its memory", "it sent", "it received"], true))
  const byMode = new Map<string, Figures>()
  for (const mode of Object.keys(MODES) as (keyof typeof MODES)[]) {
    const mine = kept.filter((r) => r.mode === mode).map(figures)
    const ran = runs.filter((r) => r.mode === mode).length
    if (!ran) continue
    const m = medianFigures(mine)
    byMode.set(mode, m)
    const f = (v: number | null, digits = 2) => (v === null ? "" : v.toFixed(digits))
    out.push(row([MODES[mode], `${mine.length} of ${ran}`, f(m.fps, 1), f(m.p50), f(m.p95), f(m.p99), f(m.over50ms, 0), f(m.cpuBusy), f(m.simCpu, 1), f(m.simMemory, 0), mode === "none" ? "" : f(m.pilotCpu), mode === "none" ? "" : f(m.pilotMemory, 0), mode === "none" ? "" : f(m.sent), mode === "none" ? "" : f(m.received)]))
  }
  const base = byMode.get("none")
  if (base?.p50 != null) {
    out.push("")
    out.push("Against no tool, by the same medians:")
    for (const mode of Object.keys(MODES) as (keyof typeof MODES)[]) {
      const m = byMode.get(mode)
      if (mode === "none" || m?.p50 == null) continue
      const busy = m.cpuBusy !== null && base.cpuBusy !== null ? `; CPU busy ${signed(m.cpuBusy - base.cpuBusy)}ms per frame` : ""
      out.push(`- ${MODES[mode]}: frame median ${signed(m.p50 - base.p50)}ms, p99 ${signed(m.p99! - base.p99!)}ms, ${signed(m.fps! - base.fps!)} fps${busy}; the sim's own CPU ${signed(m.simCpu! - base.simCpu!)} points of one core`)
    }
    const [drawn, bare] = [byMode.get("dualinput"), byMode.get("dualinput-no-figures")]
    if (drawn?.p50 != null && bare?.p50 != null) {
      const busy = drawn.cpuBusy !== null && bare.cpuBusy !== null ? `, CPU busy ${signed(drawn.cpuBusy - bare.cpuBusy)}ms per frame` : ""
      out.push(`- Dual Input's figures, its run against its run with no figures: frame median ${signed(drawn.p50 - bare.p50)}ms, p99 ${signed(drawn.p99! - bare.p99!)}ms, ${signed(drawn.fps! - bare.fps!)} fps${busy}`)
    }
    const nones = kept.filter((r) => r.mode === "none").map(figures)
    if (nones.length > 1) {
      const spread = (k: "p50" | "p99" | "cpuBusy") => {
        const values = nones.map((n) => n[k]).filter((v): v is number => v !== null)
        return values.length ? (Math.max(...values) - Math.min(...values)).toFixed(2) : "?"
      }
      out.push(`- The runs with no tool differ from each other by ${spread("p50")}ms at the frame median, ${spread("p99")}ms at p99, and ${spread("cpuBusy")}ms in CPU busy, so a difference smaller than that is the PC's drift, not a tool's cost.`)
    } else out.push("- With fewer than two runs with no tool kept, the report can't say how far the PC drifts between runs.")
  }
  out.push("")

  out.push("## Each run")
  out.push("")
  out.push(row(["run", "started", "frames", "fps", "median", "p95", "p99", "worst", "over 50ms", "CPU busy", "median of each minute", "focus", "disturbed by"], true))
  runs.forEach((r, i) => {
    const f = r.measured!.frames
    const focus = `${(r.measured!.focus * 100).toFixed(0)}%`
    const why = disturbed(r).join("; ")
    const at = `${r.measured!.started.slice(11, 16)} UTC`
    if ("error" in f) out.push(row([names[i]!, at, f.error, "", "", "", "", "", "", "", "", focus, why]))
    else out.push(row([names[i]!, at, String(f.frames), f.fps.toFixed(1), f.p50.toFixed(2), f.p95.toFixed(2), f.p99.toFixed(2), f.max.toFixed(1), String(f.over50ms), f.others.MsCPUBusy?.toFixed(2) ?? "", f.minuteP50.map((v) => v.toFixed(2)).join(" "), focus, why]))
  })
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
        const rate = through.seconds ? kbs(through.bytes, through.seconds) : `${(through.bytes / 1024).toFixed(0)} KB over more than the window`
        out.push(`Through the bench relay, ${who} sent ${rate}, ${(through.busiestSecond / 1024).toFixed(1)} KB in its busiest second`)
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
    const why = disturbed(r)
    if (why.length) out.push(`- ${names[i]} is left out of the side-by-side medians: ${why.join("; ")}.`)
    const pilot = m.processes.filter((p) => p.role.startsWith("pilot: "))
    const net = m.network
    if (pilot.length && !("error" in net) && pilot.every((p) => !net[p.pid]?.sent)) {
      out.push(`- ${names[i]}: the network trace saw no byte sent by the pilot's tool, so the kernel's events may miss loopback, and its network numbers say nothing.`)
    }
    for (const n of r.notes) out.push(`- ${names[i]}: ${n}`)
  }
  for (const r of failed) out.push(`- A run with ${r.label} measured nothing: ${r.notes.join("; ")}.`)
  // The run with no figures is one a schedule asks for by name, so only its absence from a schedule that had it says anything.
  const expected = new Set<string>(["none", "fsc", "dualinput", ...recent.map((f) => f.result.mode)])
  for (const mode of expected) if (!runs.some((r) => r.mode === mode)) out.push(`- No measured run with ${MODES[mode as keyof typeof MODES]} is in the last schedule.`)
  out.push(
    "- The flight sat on runway 14 as the world map starts a runway departure, so the runs measure a connected session at rest: each tool still streams the aircraft at its full rate, but a flight, or a crew working switches, has each tool send more changes. Each run's printout below says how its flight was loaded and what the time and camera read after.",
    "- The weather was whatever the world map last had, since nothing we know sets it from outside the sim; the runs in turn spread its changes across the tools rather than onto one.",
    "- Each second pilot runs on this PC only for the test: a second FS Copilot, whose SimConnect.cfg sends it to a port the run holds without answering, so it never reaches the sim, and FS Copilot's relay, against a bench core on a stand-in sim, the bench relay, and the local backend under wrangler. Their CPU comes out of the same PC as the sim's, so the report lists them apart from the pilot's tool. fsc-exerciser couldn't be FS Copilot's second pilot: the fork's main refused its join for a schema that lacks the traffic and ATC packets.",
    "- Dual Input's cores reach the bench relay over TCP, and FS Copilot's apps reach their relay over UDP. The network trace's counts of FS Copilot's three processes add up: its relay's bytes in and out match what the two apps sent and received. Each Dual Input run prints both the trace's count of each core's bytes and the bench relay's own count of them, which should agree; where they don't, the side-by-side figure, from the trace, is in doubt.",
    "- Both tools' links crossed a local relay: Dual Input's through the bench relay, by the bench's relays-only setting, and FS Copilot's through its own relay, by its `--no-direct` switch. Between two PCs, each links directly when it can, and its relay costs that PC nothing.",
    "- Neither tool's traffic or ATC sharing was switched on, and each starts with it off until a pilot claims it (read in FS Copilot fork, src/FsCopilot/Simulation/ShareSwitch.cs, and record/areas/architecture/02-code-map.md, \"The traffic and ATC switch\").",
    "- Dual Input's desktop app didn't run; the pilot's core ran alone, as tools/sim/camera.ts runs it. The app, as a tray icon with its window closed, holds about 4 MB and uses 0.14% to 0.26% of one core (measured on our development machine, record/areas/install/log.md, 2026-11-11, and record/areas/traffic-atc/log.md). FS Copilot's one process is its window and its logic together, and its window stayed open.",
    "- Dual Input draws each pilot's figure in the pilot's sim, the second pilot's in the copilot's seat, and FS Copilot draws no one, so the sim's frame times in the Dual Input runs carry those figures.",
    ...(runs.some((r) => r.mode === "dualinput-no-figures")
      ? ["- The runs with Dual Input, no figures, ran a core built with no-figures.patch beside run.ts, which creates no figure in the sim and changes nothing else: the core still works out the pilot's figure and sends its pose to the second pilot, and the second pilot still sends its own."]
      : []),
    "- The two profiles watch different lists, as the section above shows, and FS Copilot's includes modules for the PMS50 GTN, which this PC has installed.",
    "- Each run started the sim fresh, so the scenery and shader caches warm over the first runs; the modes' turns spread that over every tool, and the table of runs gives the order.",
  )
  out.push("")
  out.push("## Each run as it printed")
  for (const [i, r] of runs.entries()) out.push("", `### ${names[i]}`, "", ...summary(r))

  const file = path.join(RESULTS, `p31-${new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")}-report.md`)
  fs.writeFileSync(file, `${out.join("\n")}\n`)
  console.log(out.join("\n"))
  return file
}

/**
 * What disturbed a run, by what it measured: the sim behind another window for over 5% of the
 * samples, since MSFS 2024 draws fewer frames without the focus, or no frames at all. Processes
 * outside the run are listed with each run but leave it in: every run of the first schedule had
 * the 58P's two GTN simulators at about 28% of a core each, Defender at 14% to 28%, and Windows'
 * System and dwm at 10% to 22%, so a rule that left out busy runs left out every run.
 */
function disturbed(r: Result): string[] {
  const m = r.measured!
  const why: string[] = []
  if ("error" in m.frames) why.push("no frames")
  if (m.focus < 0.95) why.push(`the sim in front ${(m.focus * 100).toFixed(0)}% of the window`)
  return why
}

type Figures = { fps: number | null; p50: number | null; p95: number | null; p99: number | null; over50ms: number | null; cpuBusy: number | null; simCpu: number | null; simMemory: number | null; pilotCpu: number | null; pilotMemory: number | null; sent: number | null; received: number | null }

/** One run's figures for the side-by-side table: the sim's frames and its own process, and the pilot's tool's processes together. */
function figures(r: Result): Figures {
  const m = r.measured!
  const f = "error" in m.frames ? null : m.frames
  const sim = m.processes.find((p) => p.role === "the sim")
  const pilot = m.processes.filter((p) => p.role.startsWith("pilot: "))
  const net = "error" in m.network ? null : m.network
  const sum = (values: (number | null)[]) => (values.some((v) => v === null) || !values.length ? null : values.reduce((a, b) => a! + b!, 0))
  return {
    fps: f?.fps ?? null,
    p50: f?.p50 ?? null,
    p95: f?.p95 ?? null,
    p99: f?.p99 ?? null,
    over50ms: f?.over50ms ?? null,
    cpuBusy: f?.others.MsCPUBusy ?? null,
    simCpu: sim?.cpuPercent ?? null,
    simMemory: sim?.workingSetMeanMB ?? null,
    pilotCpu: sum(pilot.map((p) => p.cpuPercent)),
    pilotMemory: sum(pilot.map((p) => p.workingSetMeanMB)),
    sent: net && pilot.length ? pilot.reduce((s, p) => s + (net[p.pid]?.sent ?? 0), 0) / 1024 / m.seconds : null,
    received: net && pilot.length ? pilot.reduce((s, p) => s + (net[p.pid]?.received ?? 0), 0) / 1024 / m.seconds : null,
  }
}

function medianFigures(list: Figures[]): Figures {
  const pick = (k: keyof Figures) => median(list.map((f) => f[k]).filter((v): v is number => v !== null))
  return { fps: pick("fps"), p50: pick("p50"), p95: pick("p95"), p99: pick("p99"), over50ms: pick("over50ms"), cpuBusy: pick("cpuBusy"), simCpu: pick("simCpu"), simMemory: pick("simMemory"), pilotCpu: pick("pilotCpu"), pilotMemory: pick("pilotMemory"), sent: pick("sent"), received: pick("received") }
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function fscLine(fsc: Result["fsc"] | undefined): string {
  return fsc ? `commit ${fsc.commit}, synced ${fsc.synced.slice(0, 10)}, FsCopilot.dll ${fsc.hash}` : "which went unrecorded"
}

function line(p: ProcessResult, r: Result): string {
  const m = r.measured!
  const net = "error" in m.network ? undefined : m.network[p.pid]
  return `${p.cpuPercent === null ? "CPU unread" : `${p.cpuPercent.toFixed(2)}%`}, ${p.workingSetMeanMB?.toFixed(0) ?? "?"} MB working set, ${p.privateMeanMB?.toFixed(0) ?? "?"} MB private${net ? `, sent ${kbs(net.sent, m.seconds)}, received ${kbs(net.received, m.seconds)}` : ""}${p.exited ? ", ended during the window" : ""}`
}

/** A Markdown table's row, and its header's separator line after it when `header`. */
function row(cells: string[], header = false): string {
  // A cell holds one line, so an error PresentMon wrote across several, or with a pipe in it, keeps the table whole.
  const flat = cells.map((c) => c.replace(/\s+/g, " ").replaceAll("|", "\\|").trim())
  return `| ${flat.join(" | ")} |${header ? `\n|${flat.map(() => " --- ").join("|")}|` : ""}`
}

function signed(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`
}
