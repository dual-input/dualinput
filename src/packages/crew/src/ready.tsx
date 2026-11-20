// This pilot's Ready and the countdown it starts.

import { arcFromTop, Button, cx, Tooltip } from "@dualinput/ui"
import { Check } from "lucide-react"
import { useEffect, useRef, useState } from "react"

/** How long the check takes to open room for itself and spring in, in milliseconds. */
const READY_EASE = { room: 200, check: 300, after: 60 }
/** How long the ring a press spreads takes, in milliseconds. */
const PULSE_MS = 600

/**
 * Outlined until pressed, then filled green with a check, and pressed again it un-readies. Until the aircraft
 * has settled it's disabled, and a tooltip says why. The ring it spreads when pressed sits beside the button,
 * since Coherent GT cuts what a rounded button draws past its edge (record/areas/interface/log.md, p24).
 */
export function ReadyButton({ ready, why, onToggle }: { ready: boolean; why: string | undefined; onToggle: () => void }) {
  const was = useRef(ready)
  const [pulses, setPulses] = useState(0)
  useEffect(() => {
    if (ready && !was.current) setPulses((n) => n + 1)
    was.current = ready
  }, [ready])
  if (why) {
    return (
      <Tooltip content={why} className="max-w-60">
        <span className="inline-flex">
          <Button size="sm" variant="outline" disabled>
            Ready
          </Button>
        </span>
      </Tooltip>
    )
  }
  return (
    <span className="relative inline-flex">
      {pulses > 0 && <span key={pulses} className="pointer-events-none absolute -bottom-px -left-px -right-px -top-px rounded-4xl text-success" style={{ animation: `dualinput-ready-pulse ${PULSE_MS}ms ease-out both` }} />}
      <Button size="sm" variant={ready ? "success" : "outline"} onClick={onToggle}>
        <span className="inline-flex items-center">
          {/* The check is out of the flow, since Coherent GT sizes the button by what a room holds, whatever the room's width (record/areas/architecture/coherent-gt.md). */}
          <span className="relative inline-block h-4 overflow-hidden" style={{ width: ready ? 20 : 0, transition: `width ${READY_EASE.room}ms ease-out` }}>
            <Check
              className="absolute left-0 top-0 size-4"
              style={{
                transform: ready ? "scale(1)" : "scale(0.3)",
                opacity: ready ? 1 : 0,
                transition: ready ? `transform ${READY_EASE.check}ms cubic-bezier(0.34, 1.56, 0.64, 1) ${READY_EASE.after}ms, opacity ${READY_EASE.check}ms ease-out ${READY_EASE.after}ms` : "transform 150ms ease-in, opacity 150ms ease-in",
              }}
            />
          </span>
          <span>Ready</span>
        </span>
      </Button>
    </span>
  )
}

/** A number that rolls to its next value as a counter's wheel does. */
export function Rolling({ value }: { value: number }) {
  const [leaving, setLeaving] = useState<number | null>(null)
  const last = useRef(value)
  useEffect(() => {
    if (last.current === value) return
    setLeaving(last.current)
    last.current = value
    const timer = window.setTimeout(() => setLeaving(null), 250)
    return () => window.clearTimeout(timer)
  }, [value])
  return (
    <span className="relative inline-flex overflow-hidden">
      {leaving !== null && (
        <span key={`out-${leaving}`} className="absolute inset-x-0 inset-y-0 animate-roll-out">
          {leaving}
        </span>
      )}
      <span key={value} className={cx(leaving !== null && "animate-roll-in")}>
        {value}
      </span>
    </span>
  )
}

/** How long the countdown runs once every counted pilot is ready, in seconds. `COUNTDOWN` in src/platform/session/src/preflight.rs runs it, and this draws it, so change both together. */
export const COUNTDOWN = 3

const RING = { size: 28, stroke: 2.5, out: 150 }

/**
 * The countdown: a ring just before this pilot's Ready, the button that stops it, with the seconds left rolling
 * inside it and its arc draining over them, so it takes no row of its own and moves nothing as it comes and goes.
 * It's green, as a pressed Ready is, since it runs because every Ready is. It's an SVG stroke, since Coherent GT
 * draws no conic gradient (record/areas/architecture/coherent-gt.md).
 */
export function CountdownRing({ left }: { left: number | null }) {
  const running = left !== null
  const last = useRef(left ?? 0)
  if (running) last.current = left
  // It stays drawn while it shrinks away.
  const [held, setHeld] = useState(running)
  useEffect(() => {
    if (running) {
      setHeld(true)
      return
    }
    const timer = window.setTimeout(() => setHeld(false), RING.out)
    return () => window.clearTimeout(timer)
  }, [running])
  const center = RING.size / 2
  const radius = center - RING.stroke / 2
  // Each run drains from full, a frame at a time, by redrawing its arc, since Coherent GT draws an SVG stroke with no dashes
  // (record/areas/architecture/coherent-gt.md, "CSS").
  const arc = useRef<SVGPathElement>(null)
  useEffect(() => {
    if (!running) return
    const start = performance.now()
    let frame = 0
    const step = () => {
      const gone = Math.min(1, (performance.now() - start) / (COUNTDOWN * 1000))
      arc.current?.setAttribute("d", arcFromTop(center, radius, 1 - gone))
      if (gone < 1) frame = requestAnimationFrame(step)
    }
    step()
    return () => cancelAnimationFrame(frame)
  }, [running, center, radius])
  if (!running && !held) return null
  return (
    <span
      role="timer"
      aria-label={`Flight starts in ${last.current}`}
      className={cx("relative mr-2 flex shrink-0 items-center justify-center text-success", running && "animate-zoom-in")}
      style={{ width: RING.size, height: RING.size, opacity: running ? 1 : 0, transform: running ? "none" : "scale(0.5)", transition: running ? undefined : `opacity ${RING.out}ms ease-in, transform ${RING.out}ms ease-in` }}
    >
      <svg className="absolute inset-x-0 inset-y-0" width={RING.size} height={RING.size} viewBox={`0 0 ${RING.size} ${RING.size}`} fill="none">
        <circle cx={center} cy={center} r={radius} strokeWidth={RING.stroke} className="stroke-success/20" />
        <path ref={arc} strokeWidth={RING.stroke} strokeLinecap="round" className="stroke-current" />
      </svg>
      <span className="relative text-xs font-semibold tabular-nums">
        <Rolling value={last.current} />
      </span>
    </span>
  )
}

/** The countdown's seconds, drawn from the moment its phase starts. */
export function useCountdown(counting: boolean): number | null {
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    if (!counting) {
      setLeft(null)
      return
    }
    setLeft(COUNTDOWN)
    const tick = window.setInterval(() => setLeft((seconds) => (seconds === null ? null : Math.max(0, seconds - 1))), 1000)
    return () => window.clearInterval(tick)
  }, [counting])
  return left
}
