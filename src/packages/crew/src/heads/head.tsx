// A pilot's head, for wherever the app lists its pilots: the figure their crew sees in the sim, in that
// pilot's color. Each sits in a window, a circle filling its box, and looks to have popped out of it.

import { useRoot } from "@dualinput/ui"
import { createContext, useContext, useMemo, useRef } from "react"
import type { ReactNode } from "react"

import { Crew, HEAD_SIZE, LIST_ROOM, SLUMP_LOOK, TURN_ROOM, useLiveHead } from "./live.ts"

/**
 * The palette a pilot's figure takes its color from, without the gray that marks a figure whose pilot is gone or lost.
 * `PALETTE` in src/engines/messages/src/session.rs and the figure's source, in src/features/avatars/figure/, lay out the
 * same palette in this order, so change all three together.
 */
export const FIGURE_COLORS = [
  { name: "red", hex: "#e2453c" },
  { name: "blue", hex: "#3b7fe0" },
  { name: "green", hex: "#3fae5a" },
  { name: "yellow", hex: "#f2b630" },
  { name: "purple", hex: "#8e5ad8" },
  { name: "orange", hex: "#f0862e" },
  { name: "teal", hex: "#2fb3a6" },
  { name: "pink", hex: "#e46aa6" },
]

/** The head of a pilot the session doesn't list, in the gray a figure turns once its pilot is gone. */
const GONE = "#8a8f98"

const ColorsContext = createContext<ReadonlyMap<string, number>>(new Map())

/** Around everything that draws a head: each member's color, by its place in the palette, as the session's slice says. */
export function HeadColors({ members, children }: { members: { pilot: string; color: number }[] | undefined; children: ReactNode }) {
  const colors = useMemo(() => new Map((members ?? []).map((member) => [member.pilot, member.color])), [members])
  return <ColorsContext.Provider value={colors}>{children}</ColorsContext.Provider>
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
  /** A pilot out of the flight: it hangs still and dim, so who's gone reads apart from the crew still watching. */
  slumped?: boolean
  /** Dim and facing forward, for a banner's card, where a slump reads as turned too far at that size (user, 2026-11-01). */
  faded?: boolean
}

export function Head({ pilot, pop, alive, turns, slumped, faded }: HeadProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const crew = useContext(CrewContext)
  const color = useContext(ColorsContext).get(pilot)
  const hex = (color === undefined ? undefined : FIGURE_COLORS[color]?.hex) ?? GONE
  const { scale } = useRoot()
  const room = turns ? TURN_ROOM : LIST_ROOM
  useLiveHead(canvas, hex, room, scale, alive && !slumped ? crew : null, pilot, slumped ? SLUMP_LOOK : undefined, !!slumped || !!faded)
  return (
    <span className="relative inline-block shrink-0" style={{ width: HEAD_SIZE, height: HEAD_SIZE }}>
      <span className="absolute inset-x-0 inset-y-0 rounded-full bg-muted" />
      <span className="absolute inset-x-0 inset-y-0" style={{ animation: pop === undefined ? undefined : `dualinput-head-pop ${POP_MS}ms ${pop}ms both` }}>
        <canvas ref={canvas} className="pointer-events-none absolute" />
      </span>
    </span>
  )
}

/** Where a head goes in a row still waiting for its pilot: the window alone. */
export function EmptyHead() {
  return <span className="inline-block shrink-0 rounded-full bg-muted" style={{ width: HEAD_SIZE, height: HEAD_SIZE }} />
}
