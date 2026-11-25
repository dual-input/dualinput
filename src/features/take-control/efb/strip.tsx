// Taking control, the flight's one action, which can't wait for a tab switch, so it sits under the tabs on every page
// while this pilot is in the flight (record/areas/interface/decisions.md, "Take control is a held button under the tabs").
// It's the same element in every state, so nothing on the page moves when control passes.

import { arcFromTop, cx, Kbd, Link, Room, Spinner, toast } from "@dualinput/ui"
import { TriangleAlert } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"

import type { CockpitSlice } from "../../../engines/messages/ts/cockpit/CockpitSlice.ts"
import type { Bound } from "../../../engines/messages/ts/core_helper/Bound.ts"
import type { TakeControlSlice } from "../../../engines/messages/ts/take-control/TakeControlSlice.ts"
import { useCoreSlice, useShell } from "../../../platform/efb-shell/src/part.ts"
import { useSetting } from "../../../platform/efb-shell/src/settings/setting.ts"
import { Hold, HOLD_MS, TAKEN_MS } from "./hold.ts"
import type { HoldState } from "./hold.ts"
import { INPUT, LEARN_MORE, NAME, REQUEST } from "./names.ts"

/** How far the button sinks through a hold, as a scale, and how fast it springs back when let go, in milliseconds. */
const SINK = 0.97
const SPRING_BACK_MS = 120
/** How long the ring a take spreads runs, in milliseconds. */
const PULSE_MS = 600

const RING = { size: 16, center: 8, radius: 6.5, stroke: 2 }

/** Fills over the hold, a frame at a time by redrawing its arc, since Coherent GT draws an SVG stroke with no dashes (record/areas/architecture/coherent-gt.md). It sits left of the label, the key's side kept free for a long binding's name. */
function HoldRing() {
  const arc = useRef<SVGPathElement>(null)
  useEffect(() => {
    const start = performance.now()
    let frame = 0
    const step = () => {
      const done = Math.min(1, (performance.now() - start) / HOLD_MS)
      arc.current?.setAttribute("d", arcFromTop(RING.center, RING.radius, done))
      if (done < 1) frame = requestAnimationFrame(step)
    }
    step()
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <span aria-hidden className="absolute inset-y-0 right-full mr-2.5 flex items-center">
      {/* Sized in CSS, so the ring takes the kit root's zoom with the button, which Coherent GT doesn't give an svg's width and height attributes (record/areas/interface/log.md, "2026-11-23: Under the kit root's zoom"). */}
      <svg style={{ width: RING.size, height: RING.size }} viewBox={`0 0 ${RING.size} ${RING.size}`} fill="none">
        <circle cx={RING.center} cy={RING.center} r={RING.radius} strokeWidth={RING.stroke} className="stroke-primary-foreground/20" />
        <path ref={arc} strokeWidth={RING.stroke} strokeLinecap="round" className="stroke-primary-foreground" />
      </svg>
    </span>
  )
}

/**
 * The button: a solid sky one that takes a hold while another pilot flies, dimmed while a guard refuses, since the reason
 * shows under it before a press rather than after one, and a quiet state, "You have control", while this pilot flies. A
 * press answers at once: the button darkens and starts to sink, and the ring fills, so a pilot who clicks and lets go sees
 * there was more to do. Let go early, it springs back. Held through, it swells past its size as a ring spreads from it,
 * the moment the core plays its cue.
 */
function Strip({ slice, catchingUp }: { slice: TakeControlSlice; catchingUp: boolean }) {
  const { link } = useShell()
  const bound = (useSetting(link, INPUT) as Bound | null | undefined)?.name
  const [state, setState] = useState<HoldState>("idle")
  const [takes, setTakes] = useState(0)
  const hold = useMemo(
    () =>
      new Hold({
        setTimer: (then, ms) => window.setTimeout(then, ms),
        clearTimer: (timer) => window.clearTimeout(timer),
        changed: setState,
        take: () => {
          setTakes((n) => n + 1)
          void link.client.command(REQUEST, null).catch(() => {})
        },
      }),
    [link],
  )
  useEffect(() => () => hold.stop(), [hold])
  const denied = slice.denied.length > 0
  const can = !slice.mine && !denied
  const body: CSSProperties =
    state === "taken"
      ? { animation: `dualinput-swell ${TAKEN_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)` }
      : state === "holding"
        ? { transform: `scale(${SINK})`, transition: `transform ${HOLD_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1)` }
        : { transform: "scale(1)", transition: `transform ${SPRING_BACK_MS}ms ease-out` }
  // While the link to the pilot flying is lost a press takes control at once, a catch-up running or not, so what that
  // does comes before why a press might not. The catch-up's own words say it ends by itself, and any other guard's reason
  // shows as the guard gave it.
  const note = slice.warning ?? (denied ? (catchingUp ? "Taking control disabled while you catch up" : slice.denied.join(" ")) : undefined)
  return (
    // Room above for the ring a take spreads, which the strip's own box would cut off.
    <div className="px-4 pb-4 pt-2">
      <div className="relative" style={body}>
        <div
          role={slice.mine ? "status" : "button"}
          aria-disabled={denied || undefined}
          onMouseDown={(event) => {
            if (event.button === 0 && can) hold.press()
          }}
          onMouseUp={() => hold.release()}
          onMouseLeave={() => hold.release()}
          className={cx(
            "relative flex h-12 w-full select-none items-center justify-center rounded-lg text-sm font-semibold transition-colors duration-300",
            slice.mine ? "cursor-default bg-primary/10 text-primary/70" : denied ? "cursor-not-allowed bg-primary text-primary-foreground opacity-30" : "cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          {/* Darkens the button the moment it's pressed, with no easing. */}
          {state === "holding" && <span className="absolute inset-x-0 inset-y-0 rounded-lg bg-black/10" />}
          <span key={slice.mine ? "mine" : "take"} className="relative" style={{ animation: "dualinput-fade-in 300ms ease-out" }}>
            {slice.mine ? "You have control" : "Hold to take control"}
            {state === "holding" && <HoldRing />}
          </span>
          {/* The key shows as an outline and its name, in the button's own ink, so a pilot learns the faster way. */}
          {bound && !slice.mine && (
            <Kbd className="absolute right-3 max-w-[30%] border border-primary-foreground bg-transparent font-semibold text-primary-foreground">
              <span className="truncate">{bound}</span>
            </Kbd>
          )}
        </div>
        {takes > 0 && <span key={takes} className="pointer-events-none absolute inset-x-0 inset-y-0 rounded-lg text-primary" style={{ animation: `dualinput-ready-pulse ${PULSE_MS}ms ease-out both` }} />}
      </div>
      {note && (
        <p className={cx("flex items-start pt-2.5 text-xs", slice.warning ? "text-warning" : "text-muted-foreground")}>
          {slice.warning ? <TriangleAlert className="mr-2 mt-px size-3.5 shrink-0" /> : catchingUp ? <Spinner className="mr-2 mt-px size-3.5 shrink-0" /> : null}
          <span>
            {note}
            {/* The warning says only that the session might desync, so the pilot reads the trade-off in the docs, which the core opens on the desktop, behind the sim. */}
            {slice.warning && (
              <>
                {" "}
                <Link
                  tone="warning"
                  onClick={() =>
                    void link.client.command(LEARN_MORE, null).then(
                      () => toast("Opening the docs on your desktop"),
                      () => toast("Couldn't open the docs"),
                    )
                  }
                >
                  Learn more
                </Link>
              </>
            )}
          </span>
        </p>
      )}
    </div>
  )
}

/** It eases open as the flight starts and shut as this pilot leaves it, drawing the last state it had while it shuts. */
export function TakeControlStrip() {
  const slice = useCoreSlice<TakeControlSlice>(NAME)
  const stream = useCoreSlice<CockpitSlice>("cockpit-stream")
  return <Room open={!!slice?.live}>{slice && <Strip slice={slice} catchingUp={!!stream && (stream.catching_up || stream.replaying)} />}</Room>
}
