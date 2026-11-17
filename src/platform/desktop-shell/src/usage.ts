// The sums and the shapes behind the window's three charts, with no drawing in them.

import type { Sample, View } from "./link.ts"

export const DAY = 24 * 60 * 60
/** Task Manager's megabyte, so a figure here reads as the same figure there. */
const MB = 1024 * 1024
/** Samples come a minute apart, so a wider gap is time the app wasn't running, which the line leaves empty. */
const GAP = 150

export const CHART_WIDTH = 236
export const CHART_HEIGHT = 36
/** Room at each side and above, so a dot at the line's end or peak isn't cut. */
const INSET = 4

export function averageOf(samples: Sample[], value: (sample: Sample) => number): number {
  return samples.length === 0 ? 0 : samples.reduce((sum, sample) => sum + value(sample), 0) / samples.length
}

export function totalOf(samples: Sample[], value: (sample: Sample) => number): number {
  return samples.reduce((sum, sample) => sum + value(sample), 0)
}

export function memoryText(bytes: number): string {
  const megabytes = bytes / MB
  return bytes > 0 && megabytes < 1 ? "<1 MB" : `${Math.round(megabytes)} MB`
}

/**
 * A share of the PC's cores, so a pilot never reads the app as stuck: to one decimal as Task Manager shows it, or below 0.1% to
 * its first digit that isn't 0, as 0.004%. Idle, the app uses about 0.065% of one core, so 0.004% of a 16-thread PC's, which one
 * decimal would show as 0.0% (record/areas/install/log.md, "2026-11-16: The desktop app's walk for the sim cost 4.0ms").
 * `cpu_text` in src/apps/desktop/src/usage.rs formats the tray menu's line the same way, so change both together.
 */
export function cpuText(percent: number): string {
  if (percent <= 0) return "0%"
  if (percent >= 0.1) return `${percent.toFixed(1)}%`
  let decimals = Math.ceil(-Math.log10(percent))
  // Rounding can carry into the next digit, as 0.0096 does to 0.010, which one fewer decimal writes as 0.01.
  if (Math.round(percent * 10 ** decimals) >= 10) decimals -= 1
  return `${percent.toFixed(decimals)}%`
}

export function networkText(bytes: number): string {
  return bytes > 0 && bytes < MB ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${Math.round(bytes / MB)} MB`
}

export function agoText(seconds: number): string {
  if (seconds < 60) return "now"
  if (seconds < 60 * 60) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / (60 * 60))}h ago`
}

export type Point = { x: number; y: number; sample: Sample }
export type Shape = { line: string; area: string; points: Point[]; dots: Point[] }

/**
 * A chart of the last 24 hours, by the clock. Its height runs from 0 to the highest value or `least`, whichever is more, so a
 * flat line sits low rather than filling the box, which is what the chart is there to show. A dot sits on the first sample at or
 * after its moment, since that's the one that shows what the moment did, or on the last sample if none has come yet, and two
 * moments on one sample draw one dot.
 */
export function shapeOf(samples: Sample[], value: (sample: Sample) => number, now: number, least: number, moments: number[]): Shape {
  const top = Math.max(least, ...samples.map(value))
  const floor = CHART_HEIGHT - 1
  const points = samples.map((sample): Point => ({
    x: INSET + ((sample.at - (now - DAY)) / DAY) * (CHART_WIDTH - 2 * INSET),
    y: floor - (value(sample) / top) * (floor - INSET),
    sample,
  }))
  const runs: Point[][] = []
  points.forEach((point, at) => {
    const before = points[at - 1]
    if (before && point.sample.at - before.sample.at <= GAP) runs[runs.length - 1]!.push(point)
    else runs.push([point])
  })
  const at = (point: Point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`
  // A run of one sample has no length to draw, so it goes out as a line to itself, which a round cap shows as a point.
  const line = runs.map((run) => `M${at(run[0]!)}${run.length === 1 ? `L${at(run[0]!)}` : ""}${run.slice(1).map((point) => `L${at(point)}`).join("")}`).join("")
  const area = runs
    .filter((run) => run.length > 1)
    .map((run) => `M${run[0]!.x.toFixed(1)} ${floor}${run.map((point) => `L${at(point)}`).join("")}L${run[run.length - 1]!.x.toFixed(1)} ${floor}Z`)
    .join("")
  const dots = moments.flatMap((moment) => {
    const point = points.find((candidate) => candidate.sample.at >= moment) ?? points[points.length - 1]
    return point ? [point] : []
  })
  return { line, area, points, dots: [...new Set(dots)] }
}

/** The point nearest `x`, or the dot, if one is about as near, so a thin spike's dot is easy to land on. */
export function nearest(shape: Shape, x: number, dotReach = 8): { point: Point; onDot: boolean } | undefined {
  const closest = (points: Point[]) => points.reduce<Point | undefined>((best, point) => (!best || Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best), undefined)
  const dot = closest(shape.dots)
  if (dot && Math.abs(dot.x - x) <= dotReach) return { point: dot, onDot: true }
  const point = closest(shape.points)
  return point && { point, onDot: false }
}

/** What quitting costs right now, in one sentence or two. */
export function quitCost(view: Pick<View, "simRunning" | "sessionHeld" | "desktop">): string {
  const stops = "EFB app will stop working until you open Dual Input again from the Start menu."
  if (view.sessionHeld) return `You'll leave your session now, and the ${stops}`
  if (view.simRunning) return `The ${stops}`
  // Logging in brings it back only if Windows starts it.
  const until = view.desktop.start_with_windows === "on" ? "log in again or open it" : "open it"
  return `Dual Input won't be ready for your next flight, or get updates, until you ${until} from the Start menu. Certain features may break on some aircraft.`
}
