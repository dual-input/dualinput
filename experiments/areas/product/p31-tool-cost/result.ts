/* What one p31 run writes to its JSON, and its numbers as lines, which the run prints at its end and the report repeats. */

import type { Measured } from "./measure.ts"

export const MODES = { none: "no tool", fsc: "FS Copilot", dualinput: "Dual Input" } as const
export type Mode = keyof typeof MODES

export type Result = {
  probe: "p31"
  mode: Mode
  label: string
  dry: boolean
  commit: string
  /** The FS Copilot build fsc-exerciser synced, which the FS Copilot run copies. */
  fsc: { commit: string; hash: string; synced: string } | null
  simVersion: string | null
  measured?: Measured
  /** Each core's bytes through the bench relay in the window, by its process ID, in the Dual Input run. */
  relayBytes?: Record<string, { bytes: number; busiestSecond: number }>
  notes: string[]
}

export function summary(r: Result): string[] {
  const m = r.measured
  if (!m) return [`${r.label}: no measurement`]
  const lines: string[] = []
  const f = m.frames
  lines.push("error" in f ? `frames: ${f.error}` : `frames: ${f.frames}, ${f.fps.toFixed(1)} fps; frame time ${f.p50.toFixed(2)}ms median, ${f.p95.toFixed(2)}ms p95, ${f.p99.toFixed(2)}ms p99, ${f.max.toFixed(1)}ms worst; ${f.over50ms} over 50ms`)
  lines.push(`the sim had the focus in ${(m.focus * 100).toFixed(0)}% of samples; the whole PC's CPU was ${m.pcCpuPercent.toFixed(1)}% of its ${m.logicalCores} logical cores`)
  for (const p of m.processes) {
    const net = "error" in m.network ? undefined : m.network[p.pid]
    lines.push(
      `  ${p.role} (${p.pid}): ${p.cpuPercent === null ? "CPU unread" : `${p.cpuPercent.toFixed(2)}% of one core`}, ${p.workingSetMeanMB?.toFixed(0) ?? "?"} MB working set (${p.workingSetMaxMB?.toFixed(0) ?? "?"} at most), ${p.privateMeanMB?.toFixed(0) ?? "?"} MB private${net ? `, sent ${kbs(net.sent, m.seconds)} and received ${kbs(net.received, m.seconds)}` : ""}${p.exited ? ", EXITED during the window" : ""}`,
    )
  }
  if ("error" in m.network) lines.push(`network: ${m.network.error}`)
  for (const [pid, through] of Object.entries(r.relayBytes ?? {})) lines.push(`  through the bench relay, process ${pid} sent ${kbs(through.bytes, m.seconds)}`)
  return [...lines, ...r.notes.map((n) => `note: ${n}`)]
}

export function kbs(bytes: number, seconds: number): string {
  return `${(bytes / 1024 / seconds).toFixed(2)} KB/s`
}
