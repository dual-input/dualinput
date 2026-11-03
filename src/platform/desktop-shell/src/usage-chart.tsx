// What the tray app takes of the PC: a box for each figure, with its value and its line over the last 24 hours.

import { useState } from "react"

import type { Sample, Usage } from "./link.ts"
import { agoText, averageOf, CHART_HEIGHT, CHART_WIDTH, cpuText, memoryText, nearest, networkText, shapeOf, totalOf } from "./usage.ts"

/** A figure's own color, which only its box uses, so nothing here has to mean a status. The first is the kit's primary. */
const MEMORY = "#74d4ff"
const CPU = "#c4b5fd"
const NETWORK = "#f9a8d4"

/** The heights a chart reaches at least, so a flat line stays low. */
const LEAST_MEMORY = 20 * 1024 * 1024
const LEAST_CPU = 1
const LEAST_NETWORK = 1024 * 1024

type BoxProps = {
  label: string
  /** The figure over the 24 hours, and the word beside it. */
  whole: string
  wholeWord: string
  color: string
  value: (sample: Sample) => number
  text: (value: number) => string
  least: number
  usage: Usage
  moments: number[]
  /** What a dot on this chart marks, which only hovering one says. */
  dotName: string
}

function Box({ label, whole, wholeWord, color, value, text, least, usage, moments, dotName }: BoxProps) {
  const shape = shapeOf(usage.samples, value, usage.now, least, moments)
  const [hovered, setHovered] = useState<ReturnType<typeof nearest>>()
  return (
    <div className="flex items-center rounded-2xl bg-card px-3 py-1.5 ring-1 ring-foreground/10">
      <div className="w-28 shrink-0">
        {hovered?.onDot ? (
          <div className="flex items-center whitespace-nowrap text-xs" style={{ color }}>
            <span className="mr-1 size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            {dotName}
          </div>
        ) : (
          <div className="whitespace-nowrap text-xs text-muted-foreground">{label}</div>
        )}
        <div className="flex items-baseline whitespace-nowrap">
          <span className="text-xl font-medium tabular-nums">{hovered ? text(value(hovered.point.sample)) : whole}</span>
          <span className="ml-1.5 text-xs text-muted-foreground">{hovered ? agoText(usage.now - hovered.point.sample.at) : wholeWord}</span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="ml-2 min-w-0 flex-1"
        role="img"
        aria-label={`${label} over the last 24 hours: ${whole} ${wholeWord}`}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          setHovered(nearest(shape, ((event.clientX - box.left) / box.width) * CHART_WIDTH))
        }}
        onMouseLeave={() => setHovered(undefined)}
      >
        <line x1={0} y1={CHART_HEIGHT - 0.5} x2={CHART_WIDTH} y2={CHART_HEIGHT - 0.5} stroke="rgba(255, 255, 255, 0.12)" />
        <path d={shape.area} fill={color} opacity={0.12} />
        <path d={shape.line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        {hovered && <line x1={hovered.point.x} y1={0} x2={hovered.point.x} y2={CHART_HEIGHT} stroke="rgba(255, 255, 255, 0.45)" />}
        {shape.dots.map((dot) => (
          <circle key={dot.sample.at} cx={dot.x} cy={dot.y} r={2.6} fill={color} stroke="rgb(var(--card))" strokeWidth={1.5} />
        ))}
      </svg>
    </div>
  )
}

export function UsageChart({ usage }: { usage: Usage }) {
  const memory = (sample: Sample) => sample.memory
  const cpu = (sample: Sample) => sample.cpu
  const network = (sample: Sample) => sample.network
  return (
    <div className="mt-2 space-y-1.5">
      <Box label="Memory" whole={memoryText(averageOf(usage.samples, memory))} wholeWord="average" color={MEMORY} value={memory} text={memoryText} least={LEAST_MEMORY} usage={usage} moments={usage.windowOpened} dotName="Window opened" />
      <Box label="CPU" whole={cpuText(averageOf(usage.samples, cpu))} wholeWord="average" color={CPU} value={cpu} text={cpuText} least={LEAST_CPU} usage={usage} moments={usage.windowOpened} dotName="Window opened" />
      <Box label="Network" whole={networkText(totalOf(usage.samples, network))} wholeWord="total" color={NETWORK} value={network} text={networkText} least={LEAST_NETWORK} usage={usage} moments={usage.updateDownloaded} dotName="Update downloaded" />
      <div className="ml-28 flex justify-between pl-5 pr-3 text-xs text-muted-foreground">
        <span>24h ago</span>
        <span>now</span>
      </div>
    </div>
  )
}
