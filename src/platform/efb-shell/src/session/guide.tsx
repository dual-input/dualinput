// The welcome text's place on a pilot's first visit: pages on how a session works, then the aircraft check. Done and
// Skip guide close it for good, leaving the start card alone, as home is on later visits, with a send-off on the page
// by itself in the room the guide leaves (record/areas/interface/decisions.md, "Home is the start card and, on a
// first visit, a guide").

import { Button, Card, CardContent, cx, Link } from "@dualinput/ui"
import { CircleCheck, TriangleAlert } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { useShell } from "../part.ts"

const PAGES = [
  { title: "Flying together", body: "One of you hosts and shares their invite code, and others enter it to join. You each spawn into the same aircraft, preferably cold and dark, and Dual Input keeps you in sync." },
  { title: "Who flies", body: "The host starts as the pilot flying: their yoke, rudder, and throttles move the aircraft. You both work the switches, knobs, and displays. Others can take over as pilot flying at any time (see Settings for keybinds)." },
  { title: "Preflight", body: "The Preflight phase lines everyone up before anything moves. Dual Input flags deal breakers between your setups and presents any checklist items from profile authors to help avoid sync issues." },
  { title: "Profiles", body: "Profile files tell Dual Input which switches, knobs, and displays to sync and how. They are mostly built by community members. How well an aircraft is synced depends on the specific way an aircraft was built and how the profile handles it." },
]
const COUNT = PAGES.length + 1

/** How long the guide takes to go once closed, and a page turn's two halves, in milliseconds. */
const LEAVE_MS = 300
const TURN = { out: 110, in: 170 }

/** The guide's last page: whether Dual Input supports the loaded aircraft, and when it doesn't, what a session still shares in it and the way to one it does. */
function AircraftCheck({ supported, onPick }: { supported: boolean; onPick: () => void }) {
  if (supported) {
    return (
      <>
        <h3 className="flex items-center text-base font-semibold">
          <CircleCheck className="mr-2 size-4 shrink-0 text-success" />
          This aircraft is supported
        </h3>
        <p className="mt-1.5 text-sm text-muted-foreground">Click Host above and share the invite code with someone to start flying together.</p>
      </>
    )
  }
  return (
    <>
      <h3 className="flex items-center text-base font-semibold">
        <TriangleAlert className="mr-2 size-4 shrink-0 text-warning" />
        Dual Input doesn't support this aircraft yet
      </h3>
      <p className="mt-1.5 text-sm text-muted-foreground">Cockpit state won't sync but you can still fly it together, sharing its position, who's flying, traffic, and ATC.</p>
      <p className="mt-4 text-sm text-muted-foreground">
        Alternatively, switch to a <Link onClick={onPick}>supported aircraft</Link>, or try your hand at building a profile for it (<Link disabled>see how</Link>).
      </p>
    </>
  )
}

export function WelcomeGuide({ supported, onPick, onLeave, onClose }: { supported: boolean; onPick: () => void; onLeave: () => void; onClose: () => void }) {
  const [page, setPage] = useState(0)
  const [from, setFrom] = useState<{ page: number; back: boolean } | null>(null)
  const [back, setBack] = useState(false)
  const [turned, setTurned] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const content = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  const { tab } = useShell()
  // The card eases to the page's height, measured after every render, since Coherent GT has no ResizeObserver. A hidden tab measures nothing.
  useLayoutEffect(() => {
    const measured = content.current?.offsetHeight
    if (tab === "session" && measured !== undefined && measured !== height) setHeight(measured)
  })
  const turnTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(turnTimer.current), [])
  const last = page === COUNT - 1
  /** A turn hands over: the page it leaves fades out, then the new one fades in, so the text never cuts, and never shows two pages at once. Each drifts 6px the way the turn goes. */
  const go = (to: number) => {
    if (to === page) return
    setTurned(true)
    setFrom({ page, back: to < page })
    setBack(to < page)
    setPage(to)
    window.clearTimeout(turnTimer.current)
    turnTimer.current = window.setTimeout(() => setFrom(null), TURN.out)
  }
  const close = () => {
    if (leaving) return
    setLeaving(true)
    onLeave()
    window.setTimeout(onClose, LEAVE_MS)
  }
  const body = (at: number) =>
    at === COUNT - 1 ? (
      <AircraftCheck supported={supported} onPick={onPick} />
    ) : (
      <>
        <h3 className="text-base font-semibold">{PAGES[at]!.title}</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">{PAGES[at]!.body}</p>
      </>
    )
  return (
    // It rises in a beat after the page appears, so the eye lands on it once.
    <section className={cx(leaving && "pointer-events-none")} style={{ animation: leaving ? `dualinput-sink-out ${LEAVE_MS}ms ease-in forwards` : "dualinput-rise-in 500ms ease-out 400ms backwards" }}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold">Welcome to Dual Input</h2>
        {!last && (
          <Link tone="muted" onClick={close}>
            Skip guide
          </Link>
        )}
      </div>
      <Card flush>
        {/* A sky flap in the top-left corner, cut by the card's rounded corner. */}
        <span className="pointer-events-none absolute left-0 top-0 size-[22px] rounded-tl-4xl" style={{ background: "linear-gradient(135deg, rgba(var(--primary), 1) 50%, transparent 50%)" }} />
        <div className="space-y-5 py-5">
        <div className="overflow-hidden" style={{ height, transition: "height 300ms ease-out" }}>
          <div ref={content} className="relative">
            {/* Keyed by page, so each page drifts in from the side it comes from. The pages before the check share one height, the longest's, so the buttons stay put between them. */}
            <div key={page} className="min-h-28 px-5" style={{ animation: `${back ? "dualinput-page-in-back" : "dualinput-page-in"} ${TURN.in}ms ease-out ${turned ? TURN.out : 0}ms backwards` }}>
              {body(page)}
            </div>
            {from && (
              <div key={`from-${from.page}`} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 min-h-28 px-5" style={{ animation: `${from.back ? "dualinput-page-out-back" : "dualinput-page-out"} ${TURN.out}ms ease-in forwards` }}>
                {body(from.page)}
              </div>
            )}
          </div>
        </div>
        <CardContent className="flex items-end justify-between">
          <div className="mb-1 flex items-center">
            {Array.from({ length: COUNT }, (_, at) => (
              <button key={at} type="button" aria-label={`Page ${at + 1} of ${COUNT}`} onClick={() => go(at)} className={cx("mr-1.5 h-1.5 rounded-full", at === page ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground")} style={{ transition: "width 150ms ease-out" }} />
            ))}
          </div>
          <div className="flex items-center">
            {page > 0 && (
              <Button variant="ghost" className="mr-2" onClick={() => go(page - 1)}>
                Back
              </Button>
            )}
            <Button variant="secondary" onClick={() => (last ? close() : go(page + 1))}>
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </CardContent>
        </div>
      </Card>
    </section>
  )
}

/** The send-off, in milliseconds: it fades in as the guide goes, from a little low, holds, and fades out as it rises on. It mounts unseen, since Coherent GT has no @starting-style, and a transition brings it in two frames later. */
const FAREWELL = { delay: 150, in: 700, hold: 1500, out: 600 }

export function Farewell({ onGone }: { onGone: () => void }) {
  const [stage, setStage] = useState<"mounted" | "shown" | "going">("mounted")
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setStage("shown"))
    })
    const going = window.setTimeout(() => setStage("going"), FAREWELL.delay + FAREWELL.in + FAREWELL.hold)
    const gone = window.setTimeout(onGone, FAREWELL.delay + FAREWELL.in + FAREWELL.hold + FAREWELL.out)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(going)
      window.clearTimeout(gone)
    }
    // It runs once, from its mounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const shown = stage === "shown"
  return (
    // Raised from the room's middle, where it would look low under the start card.
    <div className="pointer-events-none absolute inset-x-0 inset-y-0 flex items-center justify-center pb-16">
      <p
        className="text-lg font-medium text-foreground/90"
        style={{
          opacity: shown ? 1 : 0,
          transform: `translateY(${stage === "mounted" ? 6 : stage === "shown" ? 0 : -4}px)`,
          transition: `opacity ${stage === "going" ? FAREWELL.out : FAREWELL.in}ms ease-out ${shown ? FAREWELL.delay : 0}ms, transform ${stage === "going" ? FAREWELL.out : FAREWELL.in}ms ease-out ${shown ? FAREWELL.delay : 0}ms`,
        }}
      >
        Have a nice flight!
      </p>
    </div>
  )
}
