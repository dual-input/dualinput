// The session's phase, which the header shows in place of the mark and version once this pilot is in the
// flight of a session in preflight or flying, so it shows on every page
// (record/areas/interface/decisions.md, "The header shows only what needs the pilot"). The colors follow a
// Boeing flight mode annunciator, where a mode armed shows in white and engaged in green: preflight is the
// app's information color, a white with a cool tint, and sky stays the color of what can be pressed.

import { cx, MOMENT, part, useMoment } from "@dualinput/ui"
import { useRef } from "react"
import type { ReactNode } from "react"

export type SessionPhase = "preflight" | "syncing"

const PHASES: Record<SessionPhase, { name: string; text: string; line?: string }> = {
  preflight: { name: "Preflight", text: "text-info", line: "Sync starts when everyone's ready" },
  syncing: { name: "Sync active", text: "text-success" },
}

/** Between the mark and a phase there's no dot to watch settle, so the arriving words follow after the frame or two it takes to place them. */
const NO_SETTLE = 34

/** Under the name, the line that says what the phase is, which closes as the name, centered in the header, slides to its new height. */
const LINE_HEIGHT = 16

function PhaseFace({ phase, stage, dotStays }: { phase: SessionPhase; stage: Parameters<typeof part>[0]; dotStays: boolean }) {
  const { name, text, line } = PHASES[phase]
  const lastLine = useRef(line)
  if (line) lastLine.current = line
  const words = part(stage, true)
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center">
        <span className={cx("relative mr-2 flex size-1.5 shrink-0", text)} style={{ transition: `color ${MOMENT.move}ms`, ...(dotStays ? {} : words) }}>
          {phase === "preflight" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-75" style={{ opacity: stage === "out" ? 0 : undefined }} />}
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
        <span className={cx("whitespace-nowrap text-[10px] font-semibold uppercase leading-4 tracking-widest", text)} style={words}>
          {name}
        </span>
      </div>
      <div className="overflow-hidden" style={{ height: line ? LINE_HEIGHT : 0, transition: `height ${MOMENT.move}ms ease-in-out` }}>
        <span className="block truncate text-xs leading-4 text-muted-foreground" style={part(stage, true, 2)}>
          {lastLine.current}
        </span>
      </div>
    </div>
  )
}

/** The header's start: the brand, or a session's phase. It shows one at a time, and steps from one to the next in the page's moment. */
export function HeaderStart({ phase, brand }: { phase: SessionPhase | undefined; brand: ReactNode }) {
  const target: SessionPhase | "brand" = phase ?? "brand"
  const was = useRef(target)
  const bothPhases = was.current !== "brand" && target !== "brand"
  const moment = useMoment(target, target, bothPhases ? MOMENT.inAt : NO_SETTLE)
  if (moment.stage === "idle") was.current = target
  const shown = moment.shown
  return <div className="flex min-w-0 items-center">{shown === "brand" ? <div style={part(moment.stage, true)}>{brand}</div> : <PhaseFace phase={shown} stage={moment.stage} dotStays={bothPhases} />}</div>
}
