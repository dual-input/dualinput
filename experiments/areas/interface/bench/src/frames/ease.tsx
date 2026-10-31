// A page whose state changes while a pilot watches, as the Traffic tab's does when sharing starts or
// stops, or a check's line turns, changes in one moment with three steps, as the header's phase does
// (phase.tsx), so nothing moves two ways at once and nothing moves while it's being read:
//   1. out: what's going fades, words rising 4px as they go;
//   2. move: with nothing changing on show, the layout settles, every part in one ease, one length,
//      one curve, a room opening as another shuts;
//   3. in: what's arriving fades in, in an order, each step 40ms after the last, words rising 4px.
//      It starts while the layout still settles, once it's about 80% there, as the session card's
//      rooms do (home.tsx, EaseRoom), since one step after the other left the card's row blank for
//      a beat (user, 2026-10-31).
// A control a pilot pressed answers at once, outside the moment, as a switch slides on its press.
// The page keeps showing its old state through the first step, and its new one from the second, so
// each part knows whether it changes from what it was before the moment and what it is after it.
import { useEffect, useLayoutEffect, useRef, useState } from "react"

// In milliseconds, `inAt` counted from the layout's start. The steps in, and the steps that wait on
// them, are counted in `step`s, and a moment ends after the fifth, the most any page waits.
export const MOMENT = { out: 120, move: 220, inAt: 150, in: 200, step: 40, steps: 5 }
export const ARRIVE = MOMENT.out + MOMENT.inAt
export type Stage = "idle" | "out" | "move" | "in"

// The moment's clock. A new key starts a moment, which shows the value from before it until the
// layout moves; with the key unchanged, the value shows as it comes, so a count rolls with no moment.
// A key that changes back before the layout moves ends the moment where it is.
export function useMoment<T>(key: string, value: T): { shown: T; from: T; to: T; stage: Stage } {
  const [shownKey, setShownKey] = useState(key)
  const [stage, setStage] = useState<Stage>("idle")
  const held = useRef(value)
  const from = useRef(value)
  if (key === shownKey) held.current = value
  useEffect(() => {
    if (key === shownKey) {
      setStage("idle")
      return
    }
    from.current = held.current
    setStage("out")
    const timers = [
      window.setTimeout(() => {
        setShownKey(key)
        setStage("move")
      }, MOMENT.out),
      window.setTimeout(() => setStage("in"), ARRIVE),
      window.setTimeout(() => setStage("idle"), ARRIVE + MOMENT.in + MOMENT.steps * MOMENT.step),
    ]
    return () => timers.forEach(clearTimeout)
    // The moment starts on a new key alone; the key it shows moves on inside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const shown = key === shownKey ? value : held.current
  return { shown, stage, from: stage === "idle" ? shown : from.current, to: value }
}

// How a part that changes in the moment looks at each step: gone in the first, hidden below its
// place in the second, and fading up into it in the third, after `at` steps. A part that doesn't
// change is left alone. A block, such as a paragraph or a list, fades without rising. A part whose
// own spot doesn't move with the layout, such as a card's row whose parts change while hidden,
// arrives early, as the layout starts to move, rather than waiting on it.
export function part(stage: Stage, changes: boolean, at = 0, rise = true, early = false): React.CSSProperties {
  if (!changes || stage === "idle") return {}
  const y = (px: number) => (rise ? `translateY(${px}px)` : "none")
  if (stage === "out") return { opacity: 0, transform: y(-4), transition: `opacity ${MOMENT.out}ms ease-in, transform ${MOMENT.out}ms ease-in` }
  if (stage === "move" && !early) return { opacity: 0, transform: y(4) }
  const delay = at * MOMENT.step
  return { opacity: 1, transform: "none", transition: `opacity ${MOMENT.in}ms ease-out ${delay}ms, transform ${MOMENT.in}ms ease-out ${delay}ms` }
}

// A part that comes and goes: its room opens to its content's height, or shuts, in the moment's
// second step, and holds what it had while it shuts. Its spacing from what it follows sits inside
// it, so a shut room leaves none. Coherent GT has no ResizeObserver, so the content is measured
// after every render, and an open room follows its content's height. It cuts off what overflows it
// only while it's shut or moving, so a card at rest in it keeps its outline and shadow.
export function Room({ open, pad = "", style, children }: { open: boolean; pad?: string; style?: React.CSSProperties; children?: React.ReactNode }) {
  const last = useRef(children)
  if (open) last.current = children
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  useLayoutEffect(() => {
    const measured = inner.current?.offsetHeight ?? 0
    if (measured !== height) setHeight(measured)
  })
  const [moving, setMoving] = useState(false)
  const was = useRef(open)
  useEffect(() => {
    if (was.current === open) return
    was.current = open
    setMoving(true)
    const t = window.setTimeout(() => setMoving(false), MOMENT.move)
    return () => clearTimeout(t)
  }, [open])
  return (
    <div style={{ height: open ? height : 0, overflow: open && !moving ? "visible" : "hidden", transition: `height ${MOMENT.move}ms ease-in-out` }}>
      <div ref={inner} className={pad}>
        <div style={style}>{last.current}</div>
      </div>
    </div>
  )
}

// A part that one control opens and shuts, such as a help note's body: opening, it eases open at
// once, since there's nothing to clear first, and its content fades in once it's about 80% open;
// shutting, its content fades first, then it eases shut, its content hidden until it's shut.
// Run as the page's moment, opening waited out a fade of content already hidden, and shutting let
// the content fade back in over the room's last pixels (2026-10-31).
export function useReveal(open: boolean): { open: boolean; style: React.CSSProperties } {
  const [shown, setShown] = useState(open)
  const [look, setLook] = useState<"rest" | "hidden" | "in" | "out">("rest")
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const timers: number[] = []
    if (open) {
      setShown(true)
      setLook("hidden")
      timers.push(window.setTimeout(() => setLook("in"), MOMENT.inAt))
      timers.push(window.setTimeout(() => setLook("rest"), MOMENT.inAt + MOMENT.in))
    } else {
      setLook("out")
      timers.push(
        window.setTimeout(() => {
          setShown(false)
          setLook("hidden")
        }, MOMENT.out)
      )
      timers.push(window.setTimeout(() => setLook("rest"), MOMENT.out + MOMENT.move))
    }
    return () => timers.forEach(clearTimeout)
  }, [open])
  const style: React.CSSProperties =
    look === "hidden"
      ? { opacity: 0 }
      : look === "out"
        ? { opacity: 0, transition: `opacity ${MOMENT.out}ms ease-in` }
        : look === "in"
          ? { opacity: 1, transition: `opacity ${MOMENT.in}ms ease-out` }
          : {}
  return { open: shown, style }
}
