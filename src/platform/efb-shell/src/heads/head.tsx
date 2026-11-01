// A pilot's head, for wherever the app lists its pilots: the figure their crew sees in the sim, in that
// pilot's color. Each sits in a window, a circle filling its box, and looks to have popped out of it.

import { useRoot } from "@dualinput/ui"
import { createContext, useContext, useMemo, useRef } from "react"
import type { ReactNode } from "react"

import { Crew, HEAD_SIZE, LIST_ROOM, SLUMP_LOOK, TURN_ROOM, useLiveHead } from "./live.ts"

/** The palette a pilot's figure takes its color from, without the gray that marks a figure whose pilot is gone or lost. */
const FIGURE_COLORS = ["#e2453c", "#3b7fe0", "#3fae5a", "#f2b630", "#8e5ad8", "#f0862e", "#2fb3a6", "#e46aa6"]

/** A pilot's color, by their ID until the figures' feature says which they picked. */
export function colorOf(pilot: string): string {
  // FNV-1a, whose high bits spread where a plain sum's low bits would give every pilot one color.
  const hash = Array.from(pilot).reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0
  return FIGURE_COLORS[(hash >>> 16) % FIGURE_COLORS.length]!
}

const CrewContext = createContext<Crew | null>(null)

/** Around one card's heads, which share a crew's minds. */
export function CrewHeads({ children, crew }: { children: ReactNode; crew: Crew }) {
  crew.scale = useRoot().scale
  return <CrewContext.Provider value={crew}>{children}</CrewContext.Provider>
}

export function useCrew(): Crew {
  return useMemo(() => new Crew(), [])
}

/** How long a head takes to pop in, in milliseconds. */
const POP_MS = 360

export type HeadProps = {
  pilot: string
  /** Pops in when it first shows, after this many milliseconds, hidden until then. */
  pop?: number
  /** Watches the cursor, as heads in preflight do. */
  alive?: boolean
  /** Turns its back to us as the card's fold docks it, a folded row's head. */
  turns?: boolean
  /** A pilot out of the flight: it hangs still at 40% opacity, so who's gone reads apart from the crew still watching. */
  slumped?: boolean
}

export function Head({ pilot, pop, alive, turns, slumped }: HeadProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const crew = useContext(CrewContext)
  const { scale } = useRoot()
  const room = turns ? TURN_ROOM : LIST_ROOM
  useLiveHead(canvas, colorOf(pilot), room, scale, alive && !slumped ? crew : null, pilot, slumped ? SLUMP_LOOK : undefined)
  return (
    <span className="relative inline-block shrink-0" style={{ width: HEAD_SIZE, height: HEAD_SIZE }}>
      <span className="absolute inset-x-0 inset-y-0 rounded-full bg-muted" />
      <span className="absolute inset-x-0 inset-y-0" style={{ animation: pop === undefined ? undefined : `dualinput-head-pop ${POP_MS}ms ${pop}ms both` }}>
        <canvas ref={canvas} className="pointer-events-none absolute" style={{ opacity: slumped ? 0.4 : undefined }} />
      </span>
    </span>
  )
}

/** Where a head goes in a row still waiting for its pilot: the window alone. */
export function EmptyHead() {
  return <span className="inline-block shrink-0 rounded-full bg-muted" style={{ width: HEAD_SIZE, height: HEAD_SIZE }} />
}
