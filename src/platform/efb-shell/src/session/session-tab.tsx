// The Session tab: the start card, which turns into the session card once Host or Join succeeds. In a session
// the page ends at the card, with what parts show for preflight under it, and the two can run past the page, so
// they scroll as one. The card stays pinned at the top while the rest scrolls under it, so Ready and the countdown
// never scroll away, and folds to its row as the rest scrolls (use-card-fold.ts).

import { Card, cx, fadeMask, NO_SCROLLBAR, showPress } from "@dualinput/ui"
import { ChevronDown, Hand } from "lucide-react"
import { createElement, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"

import type { ProfilesSlice } from "../../../../engines/messages/ts/profiles/ProfilesSlice.ts"
import type { SessionSlice } from "../../../../engines/messages/ts/session/SessionSlice.ts"
import type { SimSlice } from "../../../../engines/messages/ts/sim/SimSlice.ts"
import { FigureSignals } from "../figure/standing-figure.tsx"
import { useCoreSlice, useShell } from "../part.ts"
import type { Part } from "../part.ts"
import { HomeRest } from "./home-rest.tsx"
import { SessionSide } from "./session-side.tsx"
import { StartSide } from "./start-side.tsx"
import type { Action, Status } from "./start-side.tsx"
import { useCardFold } from "./use-card-fold.ts"

/** How long "Session started" holds before the card turns, how long a turn takes to fade out what it leaves and to ease to its height, and how long an attempt runs before it says so, in milliseconds. A normal attempt is done well under 2s, and by 6s a joiner has redialed twice (record/areas/network/01-between-machines.md). */
const TURN = { hold: 900, out: 110, ease: 300 }
const SLOW_AFTER = 6000

/** How far under the page's top the pinned card rests, as `pt-px`, so its edge isn't cut by the box's clip. */
const pinned: CSSProperties = { position: "-webkit-sticky" as CSSProperties["position"], top: 0 }

/** How much the rooms easing inside a box have still to grow, so the box can set the height it will have rather than the one it has mid-ease. */
function stillEasing(box: HTMLElement): number {
  return Array.from(box.querySelectorAll<HTMLElement>("[data-ease-to]")).reduce((sum, room) => sum + Number(room.dataset.easeTo) - room.offsetHeight, 0)
}

export function SessionTab({ parts }: { parts: Part[] }) {
  const { link } = useShell()
  const session = useCoreSlice<SessionSlice>("session")
  const sim = useCoreSlice<SimSlice>("sim")
  const profiles = useCoreSlice<ProfilesSlice>("profiles")
  const aircraft = sim?.aircraft ? { ...sim.aircraft, maturity: profiles?.loaded?.maturity ?? null } : null
  const held = !!session?.held
  const me = session?.members.find((member) => member.pilot === session.me)
  const phase = session?.preflight.phase
  const started = phase === "ended"
  const preflight = held && (phase === "running" || phase === "countdown") && !!me?.in_flight

  const signals = useRef(new FigureSignals())
  const pageRef = useRef<HTMLDivElement>(null)
  // The figure stays through the turn to the session, since it's leaping off the page, and goes once it's gone.
  const [figureGone, setFigureGone] = useState(false)
  // An attempt: pressed here, answered in the session slice.
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const [code, setCode] = useState("")
  const slowTimer = useRef(0)
  const stopSlow = () => window.clearTimeout(slowTimer.current)
  useEffect(() => stopSlow, [])
  // A refusal stays in the slice until the next attempt starts, so the one showing when a pilot presses again isn't this attempt's answer.
  const answered = useRef<string | null>(null)
  const refused = session?.refused ?? null
  const refusedNow = refused && JSON.stringify(refused)
  if (!refusedNow) answered.current = null
  const attempt = (on: Action) => {
    answered.current = refusedNow
    setStatus({ kind: "busy", on, dialing: false, slow: false })
    signals.current.onAttempt()
    stopSlow()
    slowTimer.current = window.setTimeout(() => setStatus((now) => (now.kind === "busy" ? { ...now, slow: true } : now)), SLOW_AFTER)
    void link.client.command(on === "host" ? "session.host" : "session.join", on === "host" ? null : { code }).catch(() => {})
  }
  const dialing = !!session?.attempt?.dialing
  useEffect(() => {
    if (status.kind !== "busy") return
    if (refused && refused.on === status.on && refusedNow !== answered.current) {
      stopSlow()
      signals.current.onAnswer(false)
      setStatus({ kind: "refused", on: status.on, refusal: refused })
    } else if (held) {
      stopSlow()
      signals.current.onAnswer(true)
      setStatus({ kind: "done", on: status.on })
    } else if (status.dialing !== dialing) {
      setStatus({ ...status, dialing })
    }
    // A refusal counts by its words, since each of the slice's changes makes a new object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, refusedNow, held, dialing])

  // The card turns between its sides as the guide's pages turn: the side it leaves fades out, then the next fades in, rising 6px, as the card eases to its height.
  const [side, setSide] = useState<"start" | "session">(held ? "session" : "start")
  const [turning, setTurning] = useState<"out" | "in" | null>(null)
  const turnedIn = useRef(side === "session")
  // A turn's timers outlive the render that changes the side halfway through it, so they're kept apart from the effect, and only a turn the other way stops them.
  const turn = useRef<{ to: "start" | "session"; timers: number[] } | null>(null)
  const stopTurn = () => {
    turn.current?.timers.forEach((timer) => window.clearTimeout(timer))
    turn.current = null
  }
  useEffect(() => stopTurn, [])
  useEffect(() => {
    const to = held ? "session" : "start"
    if (turn.current?.to === to) return
    if (turn.current) {
      stopTurn()
      setTurning(null)
    }
    // "Session started" shows first, so a turn to the session waits for the attempt's answer, then holds it a moment.
    if (to === side || (to === "session" && status.kind === "busy")) return
    const hold = to === "session" && status.kind === "done" ? TURN.hold : 0
    turn.current = {
      to,
      timers: [
        window.setTimeout(() => setTurning("out"), hold),
        window.setTimeout(() => {
          setSide(to)
          setTurning("in")
          if (to === "start") {
            setStatus({ kind: "idle" })
            setCode("")
            setFigureGone(false)
          }
        }, hold + TURN.out),
        window.setTimeout(() => {
          setTurning(null)
          turn.current = null
        }, hold + TURN.out + TURN.ease),
      ],
    }
  }, [held, side, status.kind])
  useEffect(() => {
    if (side === "session" && !turning) turnedIn.current = true
  }, [side, turning])

  const under = side === "session" && preflight ? parts.filter((part) => part.preflight) : []
  const foldable = under.length > 0

  const sideBox = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const fold = useCardFold({ foldable, inner })
  const [sideHeight, setSideHeight] = useState<number>()
  // A room in the session that starts to ease re-renders only itself, so it says so, and the card measures again to the height it's easing to. At rest on Host and Join, the card sets its own, since a refusal's room eases open there and a measured height would clip it.
  const [, remeasure] = useState(0)
  useLayoutEffect(() => {
    const content = inner.current
    const height = turning === "out" ? sideBox.current?.offsetHeight : (turning === "in" || side === "session") && content ? content.offsetHeight + stillEasing(content) : undefined
    if (height !== sideHeight) setSideHeight(height)
  })

  const scrolls = side === "session"
  const canFold = foldable && (fold.scroller.above || fold.scroller.below)
  return (
    <div ref={pageRef} className="flex min-h-0 flex-1 flex-col px-5 pb-5">
      <div className={cx("relative flex flex-col", scrolls ? "-mx-5 -mb-5 -mt-px min-h-0" : "shrink-0")}>
        <div
          ref={fold.scroller.ref}
          onScroll={fold.onScroll}
          onWheel={scrolls ? fold.scroller.onWheel : undefined}
          onMouseDown={scrolls ? fold.scroller.onMouseDown : undefined}
          className={cx("flex flex-col", scrolls && "min-h-0 select-none overflow-y-auto px-5 pt-px", scrolls && NO_SCROLLBAR, scrolls && fold.scroller.cursor)}
          // The room under a list that runs past the page by less than the fold, on top of the page's 20px. Its foot fades as every scroll box's does, and its top fades under the folded card instead, which pins there.
          style={scrolls ? { paddingBottom: 20 + fold.pad, ...fadeMask(false, fold.scroller.below, 0, 32) } : undefined}
        >
          <div className={cx("relative flex shrink-0 flex-col", scrolls && "z-20 -mx-5 bg-background px-5")} style={scrolls ? pinned : undefined}>
            {/* Reaches past the pinned card's top, since Coherent GT pins it a pixel or two below the box's edge, where what scrolls under would show above it. The box's clip cuts this off at its edge. */}
            {scrolls && <div className="absolute inset-x-0 bottom-full h-2 bg-background" />}
            {/* A layer under the pinned card, where the box's mask can't reach, once something has gone under the folded card; only then, or hanging below it would make a short page scroll by its overhang. */}
            {scrolls && fold.goneUnder && <div className="pointer-events-none absolute inset-x-0 top-full -mt-px h-[25px]" style={{ background: "linear-gradient(to bottom, rgba(var(--background), 1), rgba(var(--background), 0))" }} />}
            <Card flush className="z-10 shrink-0">
              <div ref={fold.foldBox} data-fold-clip className="relative overflow-hidden">
                <div ref={sideBox} className="overflow-hidden" style={{ height: sideHeight, transition: `height ${TURN.ease}ms ease-out` }}>
                  <div
                    ref={inner}
                    key={side}
                    className={cx("relative space-y-5 py-5", turning === "in" && "animate-turn-in")}
                    style={{ opacity: turning === "out" ? 0 : 1, transition: `opacity ${TURN.out}ms ease-out` }}
                  >
                    {side === "session" && session ? (
                      <SessionSide session={session} started={started} turnedIn={turnedIn.current} folded={fold.folded} onEase={() => remeasure((n) => n + 1)} />
                    ) : (
                      <StartSide
                        aircraft={aircraft}
                        status={status}
                        code={code}
                        onCode={(next) => {
                          setCode(next)
                          if (status.kind === "refused" && status.on === "join") setStatus({ kind: "idle" })
                        }}
                        onHost={() => attempt("host")}
                        onJoin={() => attempt("join")}
                        onCancel={() => {
                          stopSlow()
                          signals.current.onCancel()
                          setStatus({ kind: "idle" })
                          void link.client.command("session.cancel", null).catch(() => {})
                        }}
                        slowText={status.kind === "busy" && status.dialing ? "Still trying to reach the host…" : "This is taking longer than usual."}
                      />
                    )}
                  </div>
                </div>
              </div>
            </Card>
            {/* A pill reads as a handle to grab, as a phone's sheet grabber does, and is wider to hit with a mouse in the sim. It's centered on the card's bottom edge by its offsets, since Coherent GT drops the translate property, and sky, the app's color for what can be pressed. */}
            {canFold && (
              <button
                type="button"
                aria-label={fold.folded ? "Show the whole session card" : "Fold the session card"}
                onMouseDown={showPress}
                onClick={fold.toggle}
                className="absolute -bottom-3 left-1/2 z-30 -ml-6 flex h-6 w-12 items-center justify-center rounded-full bg-card text-primary ring-1 ring-inset ring-foreground/5 data-[pressed]:translate-y-[var(--hair)]"
              >
                <span ref={fold.chevron} className="block" style={{ transition: "transform 200ms ease-out" }}>
                  <ChevronDown className="size-4" />
                </span>
              </button>
            )}
          </div>
          {/* The room the folding card leaves, so the page below keeps its place. It's apart from the pinned card, which a page pins only while there's at least its height left below it. */}
          {scrolls && <div ref={fold.spacer} aria-hidden className="shrink-0" />}
          {/* For every pilot, what preflight's rule asks for, so it shows whether or not their profile gives them a checklist. */}
          {side === "session" && preflight && (
            <p className="mt-5 flex shrink-0 items-start text-sm text-info">
              <Hand className="mr-2 mt-0.5 size-4 shrink-0" />
              Avoid unnecessary cockpit interactions until the flight starts, as some may not sync.
            </p>
          )}
          {/* It stays dim while the whole card shows, so a pilot new to the page takes in the crew and Ready first, and comes up to full as the card folds. A pointer on it brings it up at once, so it never reads as disabled. */}
          {under.length > 0 && (
            <div ref={fold.list} className="mt-5 flex shrink-0 flex-col opacity-[var(--list-shown)] hover:opacity-100" style={{ "--list-shown": fold.LIST_DIM } as CSSProperties}>
              {under.map((part) => createElement(part.preflight!, { key: part.name }))}
            </div>
          )}
        </div>
      </div>
      {!figureGone && (side === "start" || turning) && <HomeRest page={pageRef} signals={signals.current} aircraft={aircraft} onFigureGone={() => setFigureGone(true)} />}
    </div>
  )
}
