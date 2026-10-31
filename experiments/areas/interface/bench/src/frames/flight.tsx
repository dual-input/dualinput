// Taking control, the flight's one action, which can't wait for a tab switch, so the app's frame
// draws it under the tabs on every page while this pilot is in the flight (user, 2026-10-31). The
// session page says how control stands, as it says its phase (phase.tsx), and the frame draws the
// strip. Whether this session is held at all goes the same way, for the header, whose rows change
// what they say in a session.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react"
import { TriangleAlert } from "lucide-react"

import { useUI } from "@/bench/ui"

// How control stands for this pilot once the flight has started, from take-control's slice of
// client state (record/areas/control/01-take-control.md, Taking control): whether this pilot holds
// it; who does otherwise; whether this pilot's own catch-up runs, during which the cockpit stream's
// guard refuses them control; whether this core's link to the PF is lost, when a press takes
// control at once and the slice carries a warning to show before it; and the binding's name, when
// a key or button is bound. Before the flight starts, and out of it, there's none, and the strip
// goes, as the record has the EFB app show no button then. A demo plays a press by itself, for the
// frames that show one.
export type Control = {
  mine: boolean
  pf?: string
  catchingUp?: boolean
  pfLost?: boolean
  bound?: string
  take: () => void
  demo?: "hold" | "tap"
}

export const ControlContext = createContext<(control: Control | undefined) => void>(() => {})
export const SessionContext = createContext<(inSession: boolean) => void>(() => {})

// Each says its state before the frame first paints, so a frame that opens in a flight shows the
// strip at once, and clears it when the page goes.
export function useShowControl(control: Control | undefined) {
  const show = useContext(ControlContext)
  useLayoutEffect(() => {
    show(control)
  }, [show, control])
  useLayoutEffect(() => () => show(undefined), [show])
}
export function useShowSession(inSession: boolean) {
  const show = useContext(SessionContext)
  useLayoutEffect(() => {
    show(inSession)
  }, [show, inSession])
  useLayoutEffect(() => () => show(false), [show])
}

// A click takes nothing, so a stray click or a VR trigger's jolt can't take control; holding the
// button does, once held 0.5s (user, 2026-10-31: 1s felt "a touch too long"). The bound key's long
// press holds 1s, with no setting (record/areas/control/01-take-control.md, The binding), and moves
// to the same 0.5s with the record, so the gesture keeps one number. The press answers at once:
// the button darkens and starts to sink, and a 16px ring left of the label fills over the hold, as
// preflight's countdown ring drains, the key cap's side kept free for a long binding's name, so a
// pilot who clicks and lets go sees there was more to do. Coherent GT has no conic gradient, so the
// ring is an SVG stroke whose dash offset animates, as the countdown's is, which is unmeasured there
// (user, 2026-10-31; tried and dropped: a 40px bar). Let go early, it's gone at once and the button springs back (user, 2026-10-31: faded, it felt
// slow). Held through, the button swells past its size and settles as a ring spreads from it, the
// moment the core plays its control-passed cue (record/areas/control/01-take-control.md, A pass).
// In milliseconds, and the sinking as a scale.
const HOLD = { ms: 500, back: 120, taken: 320, sink: 0.97 }
type Hold = "idle" | "holding" | "taken"

function usePainted() {
  const [painted, setPainted] = useState(false)
  useEffect(() => {
    let inner = 0
    const outer = requestAnimationFrame(() => (inner = requestAnimationFrame(() => setPainted(true))))
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [])
  return painted
}

// The strip under the tabs. It eases open as the flight starts and shut as this pilot leaves it,
// drawing the last state it had while it shuts; a frame that opens in a flight has it at once.
// Coherent GT has no ResizeObserver, so its height is measured after every render.
export function TakeControl({ control }: { control?: Control }) {
  const [drawn, setDrawn] = useState(control)
  if (control && control !== drawn) setDrawn(control)
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  const painted = usePainted()
  useLayoutEffect(() => {
    const h = control ? (inner.current?.offsetHeight ?? 0) : 0
    if (h !== height) setHeight(h)
  })
  return (
    <div className="shrink-0 overflow-hidden ease-out" style={{ height, transition: painted ? "height 300ms ease-out" : "none" }}>
      <div ref={inner}>{drawn && <Strip control={drawn} />}</div>
    </div>
  )
}

// The same element in every state, so nothing on the page moves when control passes: a solid sky
// button that takes a hold while another pilot flies; a quiet state, "You have control", with no
// hover or press, while this pilot does (the user's), its sky text dimmed, since at full it read as a
// text button (user, 2026-10-31); and the same sky button dimmed while this
// pilot's catch-up runs, since the slice says the guard would refuse, so the reason shows before a
// press rather than after one; the kit's gray read as a big secondary button, not a disabled one
// (user, 2026-10-31). A line under it says why it's disabled, in a neutral color with a spinner,
// since the catch-up ends by itself (user, 2026-10-31: the information color didn't work), or,
// while the link to the PF is lost, what taking control then does (user, 2026-10-31: above the
// button, the line was easy to miss). The record's example says "he", and a pilot's words never do
// (user, 2026-10-29). The bound key shows on the button as a key cap, so a pilot learns the faster
// way; with none bound, none shows. The cap is an outline and the key's name, both in the button's
// own ink, the name a weight heavier, with no fill, so it reads the same at rest and while held
// (user, 2026-10-31: a filled cap that looked right while held didn't at rest). A combination shows
// a cap per key, though the binding takes one key or one hardware button
// (record/areas/control/01-take-control.md, The binding), drawn to see how a long one fits; a
// button's name is the helper's, from its device. The words are drafts.
function Strip({ control }: { control: Control }) {
  const { Kbd, KbdGroup, Spinner } = useUI()
  const { mine, pf, catchingUp, pfLost, bound, take, demo } = control
  const [hold, setHoldState] = useState<Hold>("idle")
  const holdNow = useRef<Hold>("idle")
  const setHold = (h: Hold) => {
    holdNow.current = h
    setHoldState(h)
  }
  const timer = useRef<number>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  // Once control passes on, the button is ready for the next hold.
  useEffect(() => {
    if (!mine && holdNow.current === "taken") setHold("idle")
  }, [mine])

  const can = !mine && !catchingUp
  const start = () => {
    if (!can || holdNow.current !== "idle") return
    setHold("holding")
    timer.current = window.setTimeout(() => {
      setHold("taken")
      take()
    }, HOLD.ms)
  }
  const stop = () => {
    if (holdNow.current !== "holding") return
    clearTimeout(timer.current)
    setHold("idle")
  }
  useEffect(() => {
    if (!demo) return
    const pressAt = window.setTimeout(start, 1200)
    const letGoAt = demo === "tap" ? window.setTimeout(stop, 1450) : undefined
    return () => {
      clearTimeout(pressAt)
      clearTimeout(letGoAt)
    }
    // A demo plays once, from the frame's opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The sinking eases out, so most of it comes with the press itself, then creeps on through the
  // hold; letting go springs it back fast; a take plays its swell instead.
  const body: React.CSSProperties =
    hold === "taken"
      ? { animation: `control-taken ${HOLD.taken}ms cubic-bezier(0.34, 1.56, 0.64, 1)` }
      : { transform: `scale(${hold === "holding" ? HOLD.sink : 1})`, transition: `transform ${hold === "holding" ? `${HOLD.ms}ms cubic-bezier(0.2, 0.7, 0.3, 1)` : `${HOLD.back}ms ease-out`}` }
  const note = pfLost ? `${pf} may still be flying. If you take control, their aircraft will jump to yours when they reconnect.` : catchingUp ? "Taking control disabled while you catch up" : undefined
  return (
    // Room above for the ring a take spreads, which the strip's own box would cut off.
    <div className="px-4 pt-2 pb-4">
      <div className="relative" style={body}>
        <div
          role={mine ? "status" : "button"}
          tabIndex={can ? 0 : undefined}
          aria-disabled={catchingUp || undefined}
          onMouseDown={(e) => e.button === 0 && start()}
          onMouseUp={stop}
          onMouseLeave={stop}
          onKeyDown={(e) => {
            if ((e.key === " " || e.key === "Enter") && !e.repeat) {
              e.preventDefault()
              start()
            }
          }}
          onKeyUp={(e) => (e.key === " " || e.key === "Enter") && stop()}
          className={
            "relative flex h-12 w-full items-center justify-center rounded-lg text-sm font-semibold outline-none select-none transition-colors duration-300 focus-visible:ring-3 focus-visible:ring-ring/50 " +
            (mine ? "cursor-default bg-primary/10 text-primary/70" : catchingUp ? "cursor-not-allowed bg-primary text-primary-foreground opacity-30" : "cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90")
          }
        >
          {/* Darkens the button the moment it's pressed, with no easing. */}
          {hold === "holding" && <span className="absolute inset-0 rounded-lg bg-black/10" />}
          <span key={mine ? "mine" : "take"} className="relative animate-in duration-300 fade-in">
            {mine ? "You have control" : "Hold to take control"}
            {hold === "holding" && (
              // The path counts 100 long, dashed 100 on and 100 off, so an offset of 100 shows none
              // of it; turned so it fills clockwise from the top.
              <svg viewBox="0 0 16 16" className="absolute top-1/2 right-full -mt-2 mr-2.5 size-4" style={{ transform: "rotate(-90deg)" }} aria-hidden>
                <circle cx="8" cy="8" r="6.5" fill="none" strokeWidth="2" className="stroke-primary-foreground/20" />
                <circle cx="8" cy="8" r="6.5" fill="none" strokeWidth="2" strokeLinecap="round" pathLength={100} strokeDasharray="100 100" className="stroke-primary-foreground" style={{ animation: `hold-ring ${HOLD.ms}ms linear forwards` }} />
              </svg>
            )}
          </span>
          {bound && !mine && (
            <KbdGroup className="absolute right-3">
              {bound.split("+").map((key) => (
                <Kbd key={key} className="border border-primary-foreground bg-transparent font-semibold text-primary-foreground">
                  {key}
                </Kbd>
              ))}
            </KbdGroup>
          )}
        </div>
        {hold === "taken" && <span className="pointer-events-none absolute inset-0 rounded-lg text-primary" style={{ animation: "ready-pulse 600ms ease-out forwards" }} />}
      </div>
      {note && (
        <p className={"flex items-start gap-2 pt-2.5 text-xs " + (pfLost ? "text-warning" : "text-muted-foreground")}>
          {pfLost ? <TriangleAlert className="mt-px size-3.5 shrink-0" /> : <Spinner className="mt-px size-3.5 shrink-0" />}
          {note}
        </p>
      )}
    </div>
  )
}
