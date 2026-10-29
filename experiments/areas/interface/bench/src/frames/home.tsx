// The EFB app's home page, designed from the user's sketch of 2026-10-26: the start card, then on a
// pilot's first visit a short guide to how a session works that ends on the aircraft check, and on
// later visits the profile authors' notes. The aircraft and the notes are examples.
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, CircleCheck, CircleX } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { StatusChip } from "@/bench/screens"
import { AppFrame, Label } from "./shell"
import { FIGURE_COLORS } from "./figure-portrait"
import { StandingFigure } from "./figure-standing"
import { ConfirmButton, RESTART_SIM } from "./confirm"

// The loaded aircraft as the card names it: the maker from its package's manifest, the model,
// and its tail number, which the sim reports as `A:ATC ID`.
const LOADED = { maker: "Black Square", model: "Baron 58P", tail: "N58BK" }
const LOADED_UNSUPPORTED = { maker: "Fenix", model: "A320", tail: "G-FNXA" }
const SUPPORTED = [
  { name: "Black Square Baron 58P", maturity: "Stable" },
  { name: "Synaptic A220", maturity: "Stable" },
  { name: "A2A Simulations PA24-250 Comanche", maturity: "Experimental" },
]

// How our servers can refuse: hosting when they don't answer, and joining with the four refusals the
// backend's lookup gives (record/areas/network/02-units.md, Its requests). The words are drafts,
// and the versions and the time are examples: the count of wrong codes is per clock hour, so the
// pause ends on the next hour.
const REFUSALS = {
  servers: { title: "Couldn't reach our servers", detail: "Dual Input needs them to connect you and your crew. Try again in a moment." },
  "no-code": { title: "No session has this code", detail: "Check it with your host and try again." },
  "you-older": { title: "Your Dual Input is older than the host's", detail: "Your host has 1.0.3 while you have 1.0.2.", action: { label: "Restart the sim to update", ...RESTART_SIM } },
  "host-older": { title: "The host's Dual Input is older than yours", detail: "Your host has 1.0.1 while you have 1.0.2. They need to update before you can join." },
  "too-many": { title: "Too many wrong codes", detail: "You are being rate limited because you've tried too many wrong codes in an hour. Joining is paused until 15:00. If you think this is a mistake, please contact us on our Discord." },
}
type Refusal = keyof typeof REFUSALS
// When each refusal shows, for the sheet that lays them side by side.
const REFUSED_WHEN: Record<Refusal, string> = {
  servers: "Hosting or joining: our servers didn't answer",
  "no-code": "Joining: no session has the code",
  "you-older": "Joining: your version is older",
  "host-older": "Joining: the host's version is older",
  "too-many": "Joining: too many wrong codes",
}
export type Action = "host" | "join"
// A join is dialing once our servers have found its code and it's reaching the crew; slow, once
// the attempt has taken SLOW_AFTER.
type Status =
  | { kind: "idle" }
  | { kind: "busy"; on: Action; dialing?: boolean; slow?: boolean }
  | { kind: "done"; on: Action }
  | { kind: "refused"; on: Action; why: Refusal }

// A normal attempt is done well under 2s: one request to our servers, and for a join a connection,
// which opened in a median of 24ms to 159ms from friends' homes to ours (record/areas/network/
// 01-between-machines.md, The way through home routers). By 6s a joiner has redialed twice, so an
// attempt that long shows a line saying so, with Cancel, under the control that asked. Wi-Fi and
// carrier-grade NAT are unmeasured, so v1's recordings would tune it.
const SLOW_AFTER = 6000

// What the page's standing figure reacts to: an attempt to host or join, as a figure-attempt event,
// our servers' answer, as figure-answer with ok in its detail, and Cancel, as figure-cancel, all
// bubbling from the card. In the app any join announces itself, the clipboard's included. The bench
// fakes our servers: they answer after a moment, yes; or refusing, no, refusing a host as
// unreachable and a join as naming no session, the refusal that also marks the code's slots; or
// slow, answering a host only after SLOW_ANSWER_AFTER, and finding a join's code at once while the
// host it names never answers, as when their sim has crashed and the backend still lists them. The
// host's name is an example.
export type Servers = "answering" | "refusing" | "slow"
const DEMO_CODE = "K7R4XM"
const DEMO_HOST = "James"
const ANSWER_AFTER = 1000
const SLOW_ANSWER_AFTER = 10000

// The loaded aircraft on top, since a session flies the host's aircraft, then Host and the code
// field to join with. Selecting the code field fills it from the clipboard and joins at once
// (record/areas/product/03-v1-scope.md, Invite code), so the field stays in view. Host, the code
// field, and Join are marked data-figure-target, which the figure locks on to; Host is also
// data-host, which it looks at by default; and Host and Join are data-figure-press, a press on which
// winds it up. A disabled button takes no pointer events, so the figure ignores Join until the code is
// whole.
// While our servers answer, the button that asked shows it's busy and the code field is locked, and
// a refusal, or the line for an attempt taking long, opens under the control that asked: Host, or
// the code.
function StartCard({ supported, servers = "answering", play }: { supported: boolean; servers?: Servers; play?: Action }) {
  const { Badge, Button, Card, CardContent, Separator, Spinner, InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } = useUI()
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const [code, setCode] = useState("")
  const codeNow = useRef("")
  codeNow.current = code
  const hostButton = useRef<HTMLButtonElement>(null)
  const joinButton = useRef<HTMLButtonElement>(null)
  const aircraft = supported ? LOADED : LOADED_UNSUPPORTED
  const working = status.kind === "busy" || status.kind === "done"

  // An attempt's timers: its slow line's, and the fake servers' answers. A new attempt or Cancel
  // clears them, so a timer from an attempt before can't reach this one.
  const timers = useRef<number[]>([])
  const stop = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  useEffect(() => stop, [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))
  const busy = (change: { dialing?: boolean; slow?: boolean }) => setStatus((s) => (s.kind === "busy" ? { ...s, ...change } : s))

  const attempt = (on: Action, from: HTMLElement) => {
    stop()
    from.dispatchEvent(new CustomEvent("figure-attempt", { bubbles: true }))
    setStatus({ kind: "busy", on })
    later(SLOW_AFTER, () => busy({ slow: true }))
    const answer = (why?: Refusal) => {
      from.dispatchEvent(new CustomEvent("figure-answer", { bubbles: true, detail: { ok: !why } }))
      setStatus(why ? { kind: "refused", on, why } : { kind: "done", on })
    }
    if (servers === "refusing") later(ANSWER_AFTER, () => answer(on === "host" ? "servers" : "no-code"))
    else if (servers === "answering") later(ANSWER_AFTER, () => answer())
    else if (on === "host") later(SLOW_ANSWER_AFTER, () => answer())
    else later(ANSWER_AFTER, () => busy({ dialing: true }))
  }
  const join = (from: HTMLElement) => codeNow.current.length === 6 && attempt("join", from)
  // Cancel stops the attempt here alone: a joiner registers with our servers only once it reaches
  // the crew, and a session they start for a cancelled host after all lapses, since nobody renews
  // it. The code stays.
  const cancel = (from: HTMLElement) => {
    stop()
    from.dispatchEvent(new CustomEvent("figure-cancel", { bubbles: true }))
    setStatus({ kind: "idle" })
  }

  // A frame asked to play hosting or joining plays it a moment after it opens: for a join it types
  // the demo code, and then it presses its button and lets go on it, as a pilot's click does.
  useEffect(() => {
    if (!play) return
    const timers: number[] = []
    const later = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms))
    const click = (at: number, button: () => HTMLButtonElement | null, act: (b: HTMLElement) => void) => {
      later(at, () => button()?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })))
      later(at + 300, () => {
        const b = button()
        if (!b) return
        b.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
        act(b)
      })
    }
    if (play === "host") click(1400, () => hostButton.current, (b) => attempt("host", b))
    else {
      DEMO_CODE.split("").forEach((_, i) => later(900 + i * 110, () => setCode(DEMO_CODE.slice(0, i + 1))))
      click(1900, () => joinButton.current, (b) => join(b))
    }
    return () => timers.forEach(clearTimeout)
    // It plays once, from the frame's opening; each play button opens the frame afresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A refused join clears when the code is edited; a code that names no session marks its slots.
  const refusedOn = (on: Action) => (status.kind === "refused" && status.on === on ? status.why : undefined)
  const joinRefused = refusedOn("join") !== undefined
  const badCode = refusedOn("join") === "no-code"
  // Under each control, its refusal, or its slow line, which names the host once a join is dialing.
  const under = (on: Action) => {
    const why = refusedOn(on)
    if (why) return <Refused why={why} />
    if (status.kind === "busy" && status.on === on && status.slow)
      return <SlowLine text={status.dialing ? `Still trying to reach ${DEMO_HOST}…` : "This is taking longer than usual."} onCancel={cancel} />
  }
  return (
    // The card's padding matches the page's 20px, where Luma's default card spacing is 24px.
    // It never shrinks, so the notes below are what gives way on a full page. It sits above what's
    // under it, so the figure's canvas can stay put as the card grows down over its empty top.
    <Card className="relative z-10 shrink-0 [--card-spacing:--spacing(5)]">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Label>{aircraft.maker}</Label>
          <span className="truncate text-lg leading-tight font-semibold">{aircraft.model}</span>
          <span className="text-xs text-muted-foreground">{aircraft.tail}</span>
        </div>
        {supported ? <Badge variant="secondary">{SUPPORTED[0].maturity}</Badge> : <StatusChip level="trouble">Not supported</StatusChip>}
      </CardContent>
      <Separator />
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col">
          <Button ref={hostButton} size="lg" className="w-full" data-host data-figure-target data-figure-press disabled={working} onClick={(e: React.MouseEvent<HTMLElement>) => attempt("host", e.currentTarget)}>
            {status.kind === "busy" && status.on === "host" ? (
              <>
                <Spinner data-icon="inline-start" /> Starting your session…
              </>
            ) : status.kind === "done" && status.on === "host" ? (
              <>
                <Check data-icon="inline-start" /> Session started
              </>
            ) : (
              "Host a session"
            )}
          </Button>
          <UnderSlot>{under("host")}</UnderSlot>
        </div>
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">or join with a code</span>
          <Separator className="flex-1" />
        </div>
        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-3">
            <div data-figure-target onKeyDown={(e) => e.key === "Enter" && join(e.currentTarget)}>
              <InputOTP
                maxLength={6}
                value={code}
                disabled={working}
                onChange={(v: string) => {
                  setCode(v.toUpperCase())
                  if (joinRefused) setStatus({ kind: "idle" })
                }}
              >
                <InputOTPGroup>
                  {[0, 1, 2].map((i) => (
                    <InputOTPSlot key={i} index={i} className={"font-mono " + (badCode ? "border-destructive/60" : "")} />
                  ))}
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  {[3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} className={"font-mono " + (badCode ? "border-destructive/60" : "")} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <Button ref={joinButton} variant="outline" disabled={code.length < 6 || working} data-figure-target data-figure-press onClick={(e: React.MouseEvent<HTMLElement>) => join(e.currentTarget)}>
              {status.kind === "busy" && status.on === "join" ? <Spinner /> : status.kind === "done" && status.on === "join" ? <Check /> : "Join"}
            </Button>
          </div>
          <UnderSlot>{under("join")}</UnderSlot>
        </div>
      </CardContent>
    </Card>
  )
}

// A link inside a sentence. Neither opens anything yet: "supported aircraft" is to open a large
// popup the user will design.
function InlineLink({ children }: { children: React.ReactNode }) {
  return (
    <a href="#" onClick={(e) => e.preventDefault()} className="text-primary underline-offset-4 hover:underline">
      {children}
    </a>
  )
}

// The guide's pages before the aircraft check, in the user's words.
const GUIDE = [
  {
    title: "Flying together",
    body: "One of you hosts and shares their invite code, and others enter it to join. You each spawn into the same aircraft, preferably cold and dark, and Dual Input keeps you in sync.",
  },
  {
    title: "Who flies",
    body: "The host starts as the pilot flying: their yoke, rudder, and throttles move the aircraft. You both work the switches, knobs, and displays. Others can take over as pilot flying at any time (see Settings for keybinds).",
  },
  {
    title: "Preflight",
    body: "The Preflight phase lines everyone up before anything moves. Dual Input flags deal breakers between your setups and presents any checklist items from profile authors to help avoid sync issues.",
  },
  {
    title: "Profiles",
    body: "Profile files tell Dual Input which switches, knobs, and displays to sync and how. They are mostly built by community members. How well an aircraft is synced depends on the specific way an aircraft was built and how the profile handles it.",
  },
]
const PAGES = GUIDE.length + 1
// How long the guide takes to go once closed, and a page turn's two halves, in milliseconds.
const LEAVE_MS = 300
const TURN = { out: 110, in: 170 }

// The guide's last page: whether Dual Input supports the loaded aircraft, and when it doesn't, what
// a session still shares in it and the way to the aircraft it does support.
function AircraftCheck({ supported }: { supported: boolean }) {
  if (supported)
    return (
      <>
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <CircleCheck className="size-4 shrink-0 text-success" />
          This aircraft is supported
        </h3>
        <p className="text-sm text-muted-foreground">Click Host above and share the invite code with someone to start flying together.</p>
      </>
    )
  return (
    <>
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <CircleX className="size-4 shrink-0 text-destructive" />
        Dual Input doesn't support this aircraft yet
      </h3>
      <p className="text-sm text-muted-foreground">Cockpit state won't sync but you can still fly it together, sharing its position, who's flying, traffic, and ATC.</p>
      <p className="pt-3 text-sm text-muted-foreground">
        Alternatively, switch to a <InlineLink>supported aircraft</InlineLink>, or try your hand at building a profile for it (<InlineLink>see how</InlineLink>).
      </p>
    </>
  )
}

// The welcome text's place on a pilot's first visit: three pages on how a session works, then the
// aircraft check. Done and Skip guide close it for good, leaving the start card alone, as home is
// on later visits. It says when it starts to leave, and when it's gone.
function WelcomeGuide({ supported, startAt = 0, onLeave, onClose }: { supported: boolean; startAt?: number; onLeave: () => void; onClose: () => void }) {
  const { Button, Card, CardContent } = useUI()
  const [page, setPage] = useState(startAt)
  const [back, setBack] = useState(false)
  // The card eases to the page's height. Coherent GT has no ResizeObserver, so the height is
  // measured after every render, which also catches a page whose content changes while it shows,
  // such as the aircraft check when the pilot loads another aircraft.
  const content = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  useLayoutEffect(() => {
    const measured = content.current?.offsetHeight
    if (measured !== undefined && measured !== height) setHeight(measured)
  })
  const last = page === PAGES - 1
  // A turn hands over: the page it leaves stays a moment and fades out, then the new one fades in,
  // so the text never cuts, and never shows two pages at once, which read as trippy. Each drifts
  // 6px the way the turn goes. A timer clears the old page, as one ends the guide, and a quicker
  // turn takes the place of one still under way.
  const [from, setFrom] = useState<{ page: number; back: boolean } | null>(null)
  const turned = useRef<number>(undefined)
  const [hasTurned, setHasTurned] = useState(false)
  const go = (to: number) => {
    if (to === page) return
    setHasTurned(true)
    setFrom({ page, back: to < page })
    setBack(to < page)
    setPage(to)
    window.clearTimeout(turned.current)
    turned.current = window.setTimeout(() => setFrom(null), TURN.out)
  }
  useEffect(() => () => window.clearTimeout(turned.current), [])
  // What arrives with a turn waits, unseen, for the old page to go; the first page needs no wait.
  // The wait turns on whether the guide has turned at all, not on the old page still showing,
  // since changing a running animation's delay would jump it ahead.
  const turnIn: React.CSSProperties = { animationDuration: `${TURN.in}ms`, animationDelay: hasTurned ? `${TURN.out}ms` : "0ms", animationFillMode: "backwards" }
  const body = (p: number) =>
    p === PAGES - 1 ? (
      <AircraftCheck supported={supported} />
    ) : (
      <>
        <h3 className="text-base font-semibold">{GUIDE[p].title}</h3>
        <p className="text-sm text-muted-foreground">{GUIDE[p].body}</p>
      </>
    )
  // Closing, it sinks and fades the way it rose, and goes once that's over. A timer ends it rather
  // than the animation's end event, so it goes even where that event never comes.
  const [leaving, setLeaving] = useState(false)
  const close = () => {
    if (leaving) return
    setLeaving(true)
    onLeave()
    window.setTimeout(onClose, LEAVE_MS)
  }
  const title = (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-base font-semibold">Welcome to Dual Input</h2>
      {!last && (
        <Button variant="link" className="h-auto border-0 p-0 text-muted-foreground" onClick={close}>
          Skip guide
        </Button>
      )}
    </div>
  )
  const pageView = (
    <div className="overflow-hidden transition-[height] duration-300 ease-out" style={{ height }}>
      <div ref={content} className="relative">
        {/* Keyed by page, so each page drifts in from the side it comes from. Pages before the
            check share one height, the longest's, so the buttons stay put between them. The page
            being left lies over it, out of the flow, so the card eases to the new page's height. */}
        <div key={page} className={"flex min-h-28 animate-in flex-col gap-1.5 px-5 fade-in " + (back ? "slide-in-from-left-[6px]" : "slide-in-from-right-[6px]")} style={turnIn}>
          {body(page)}
        </div>
        {from && (
          <div
            key={`from-${from.page}`}
            aria-hidden
            className={"pointer-events-none absolute top-0 right-0 left-0 flex min-h-28 animate-out flex-col gap-1.5 px-5 fade-out " + (from.back ? "slide-out-to-right-[6px]" : "slide-out-to-left-[6px]")}
            style={{ animationDuration: `${TURN.out}ms`, animationFillMode: "forwards" }}
          >
            {body(from.page)}
          </div>
        )}
      </div>
    </div>
  )
  // The dots sit near the row's bottom edge, 24px from the bottom and 20px from the left.
  const controls = (
    <>
      <div className="mb-1 flex items-center gap-1.5">
        {Array.from({ length: PAGES }, (_, i) => (
          <button
            key={i}
            aria-label={`Page ${i + 1} of ${PAGES}`}
            onClick={() => go(i)}
            className={"h-1.5 rounded-full transition-all " + (i === page ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground")}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        {/* Back fades in with the second page, as the pages do. */}
        {page > 0 && (
          <Button variant="ghost" className="animate-in fade-in" style={turnIn} onClick={() => go(page - 1)}>
            Back
          </Button>
        )}
        <Button variant="secondary" onClick={() => (last ? close() : go(page + 1))}>
          {last ? "Done" : "Next"}
        </Button>
      </div>
    </>
  )
  return (
    // It rises in a beat after the page appears, so the eye lands on it once.
    <section
      className={"flex flex-col gap-3 " + (leaving ? "pointer-events-none animate-out fade-out slide-out-to-bottom-4" : "animate-in duration-500 fade-in slide-in-from-bottom-4")}
      style={leaving ? { animationDuration: `${LEAVE_MS}ms`, animationFillMode: "forwards" } : { animationDelay: "400ms", animationFillMode: "backwards" }}
    >
      {title}
      <Card className="relative [--card-spacing:--spacing(5)]">
        {/* A sky flap in the top-left corner, cut by the card's rounded corner, with a shadow along
            its fold. */}
        <span className="pointer-events-none absolute top-0 left-0 size-[22px]" style={{ background: "linear-gradient(135deg, var(--primary) 50%, transparent 50%)", filter: "drop-shadow(1px 1px 1px rgb(0 0 0 / 0.35))" }} />
        {pageView}
        <CardContent className="flex items-end justify-between gap-3">{controls}</CardContent>
      </Card>
    </section>
  )
}

// The profile authors' notes on the loaded aircraft, from the sketch, which a profile field after
// v1 carries; the page makes room for them now. The notes are examples. They look like something the
// authors slipped in: a slip of paper taped to the page, title included, written by hand.
const HAND: React.CSSProperties = { fontFamily: "Kalam, cursive", fontSize: 17, lineHeight: "28px" }
// Two inks: black for the notes and their dashes, and red pencil for the title and its underline.
const INK = { body: "#1c1b1a", title: "#a33a2c" }

const PAPER = "#cdc2a6"

// Example notes: a short set from the sketch, and a long one that runs past the page. Each is signed
// with the profile's `authors`, free text the profile format shows wherever it credits a profile,
// written as the authors wrote it; the names are hypothetical.
const NOTES = {
  short: {
    authors: "James Smith",
    lead: "Set the tablet's failure rate to 0 on every machine before you fly, since each sim rolls its own failures.",
    items: ["A pilot who joins late starts the ADF's elapsed timer at 0.", "The KNS-81's 10 waypoints don't sync, so enter them on each machine."],
  },
  long: {
    authors: "James Smith and Alex Doe",
    lead: "Set the tablet's failure rate to 0 on every machine before you fly, since each sim rolls its own failures. Start cold and dark on every machine, and let the pilot flying run the engine start.",
    items: [
      "A pilot who joins late starts the ADF's elapsed timer at 0.",
      "The KNS-81's 10 waypoints don't sync, so enter them on each machine.",
      "The GPS is a separate add-on, so every pilot needs the same version of it, and its flight plan doesn't sync: load the same plan on each machine.",
      "The cabin pressure controller follows the pilot flying's settings, so the other pilot's cabin altitude can lag by a second or two.",
      "The de-ice boots cycle on each machine's own timer, so their lights can blink out of step.",
      "The tablet's own pages don't sync, so each pilot sets up their own.",
    ],
  },
}

// The notes scroll inside the slip when they run past the page, under a title that stays put, and a
// fade at either end shows there's more that way.
function AuthorsNotes({ notes }: { notes: (typeof NOTES)["short"] }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [above, setAbove] = useState(false)
  const [below, setBelow] = useState(false)
  const [dragging, setDragging] = useState(false)
  const measure = () => {
    const s = scroller.current
    if (!s) return
    setAbove(s.scrollTop > 1)
    setBelow(s.scrollHeight - s.scrollTop - s.clientHeight > 1)
  }
  useLayoutEffect(measure)
  // The start card easing open over a refusal shortens the notes without a render here, so they
  // measure again when an easing on the page ends.
  useEffect(() => {
    const page = scroller.current?.closest("[data-home-page]")
    page?.addEventListener("transitionend", measure)
    return () => page?.removeEventListener("transitionend", measure)
  })
  // Dragging anywhere on the notes scrolls them, since the thin scrollbar is hard to hit with a mouse
  // in the sim and harder with a VR pointer. Coherent GT has no PointerEvent, so the drag follows the
  // mouse's events, from the window so it keeps going off the slip. It starts only past 4px, so a
  // click still clicks, and leaves a press on the scrollbar to the scrollbar. The canvas can zoom the
  // frame, so the drag is scaled to the notes' own pixels.
  const startDrag = (e: React.MouseEvent) => {
    const s = scroller.current
    if (!s || e.button !== 0 || (e.target === s && e.nativeEvent.offsetX >= s.clientWidth)) return
    const scale = s.getBoundingClientRect().height / s.offsetHeight || 1
    const y0 = e.clientY
    const top0 = s.scrollTop
    let moved = false
    const move = (m: MouseEvent) => {
      const dy = (m.clientY - y0) / scale
      if (!moved && Math.abs(dy) < 4) return
      moved = true
      setDragging(true)
      s.scrollTop = top0 - dy
    }
    const up = () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
      setDragging(false)
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
  }
  const fade = (to: "top" | "bottom", shown: boolean): React.CSSProperties => ({ background: `linear-gradient(to ${to === "top" ? "bottom" : "top"}, ${PAPER}, transparent)`, opacity: shown ? 1 : 0 })
  return (
    // Manila paper, turned a little off square, with a strip of tape at the top. It's darker than
    // white paper, so it doesn't outshine the dark page around it.
    <section className="relative mx-1 flex min-h-0 flex-col rounded-[2px] px-5 pt-3.5" style={{ ...HAND, background: PAPER, color: INK.body, transform: "rotate(-0.8deg)", boxShadow: "0 8px 18px rgb(0 0 0 / 0.4)" }}>
      <span className="absolute -top-2.5 left-1/2 h-5 w-20" style={{ background: "rgb(226 218 196 / 0.55)", transform: "translateX(-50%) rotate(2deg)", boxShadow: "0 1px 2px rgb(0 0 0 / 0.15)" }} />
      <h2 className="relative shrink-0 self-start font-bold" style={{ color: INK.title, fontSize: 19 }}>
        Notes from the profile authors
        {/* A quick, slightly uneven stroke under the title. */}
        <svg viewBox="0 0 100 6" preserveAspectRatio="none" fill="none" aria-hidden className="absolute bottom-0 left-0 h-1.5 w-full">
          <path d="M1 4C22 2.2 46 4.6 70 3C82 2.3 92 2.8 99 3.6" stroke={INK.title} strokeWidth={1.8} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </h2>
      {/* The 8px between the title and the notes, and the 16px under them, are the scroller's own
          padding, so they scroll away with the notes: the fades start right at the underline and
          the slip's bottom edge, and the scrollbar's track keeps to the text between. The scroller reaches
          12px into the slip's 20px right padding, so its 6px scrollbar sits 8px from the slip's
          edge, with the same 8px between it and the text. The scrollbar is
          styled through ::-webkit-scrollbar, which Coherent GT keeps, where it drops
          scrollbar-color and scrollbar-width. */}
      <div className="relative -mr-3 flex min-h-0 flex-col">
        <div
          ref={scroller}
          onScroll={measure}
          onMouseDown={startDrag}
          className={
            "min-h-0 overflow-y-auto pt-2 pr-2 pb-4 select-none [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[rgb(28_27_26/0.3)] [&::-webkit-scrollbar-track]:mt-2 [&::-webkit-scrollbar-track]:mb-4 [&::-webkit-scrollbar-track]:bg-transparent " +
            (dragging ? "cursor-grabbing" : above || below ? "cursor-grab" : "")
          }
        >
          <p>{notes.lead}</p>
          <ul>
            {notes.items.map((note) => (
              <li key={note} className="relative pl-5">
                <span className="absolute left-0">–</span>
                {note}
              </li>
            ))}
          </ul>
          {/* The authors sign at the end, like a letter, and a profile with no authors leaves the
              line out. */}
          {notes.authors && <p className="mt-1 text-right">— {notes.authors}</p>}
        </div>
        {/* The fades stop short of the scrollbar and its gap. */}
        <div className="pointer-events-none absolute top-0 right-3.5 left-0 h-12 transition-opacity duration-200" style={fade("top", above)} />
        <div className="pointer-events-none absolute right-3.5 bottom-0 left-0 h-12 transition-opacity duration-200" style={fade("bottom", below)} />
      </div>
    </section>
  )
}

// A refusal from our servers, in the tinted box first-time setup's failures use, with the refusal's
// own action where it has one, which asks first, since restarting the sim ends the pilot's flight.
function Refused({ why }: { why: Refusal }) {
  const r: { title: string; detail: string; action?: { label: string; question: string; go: string } } = REFUSALS[why]
  return (
    <div className="flex animate-in flex-col gap-1 rounded-3xl border border-destructive/20 bg-destructive/10 px-5 py-4 duration-200 fade-in">
      <p className="text-sm font-medium text-destructive">{r.title}</p>
      <p className="text-sm text-foreground/75">{r.detail}</p>
      {r.action && (
        <div className="mt-2">
          <ConfirmButton
            label={r.action.label}
            question={r.action.question}
            align="start"
            go={r.action.go}
            onConfirm={() => toast("Restarting the sim to update")}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:border-destructive/40 focus-visible:ring-destructive/30"
          />
        </div>
      )}
    </div>
  )
}

// An attempt taking long: a line of text with Cancel at its end, and no box, since nothing has
// failed; the button that asked keeps its spinner.
function SlowLine({ text, onCancel }: { text: string; onCancel: (from: HTMLElement) => void }) {
  return (
    <p className="animate-in text-sm text-muted-foreground duration-200 fade-in">
      {text}{" "}
      <button className="font-medium text-primary underline-offset-4 hover:underline" onClick={(e) => onCancel(e.currentTarget)}>
        Cancel
      </button>
    </p>
  )
}

// The room under a control for its refusal or slow line, easing open to its height and shut to
// none, still showing what it had while it shuts. Coherent GT has no ResizeObserver, so the height
// is measured after every render, as the guide's is.
function UnderSlot({ children }: { children?: React.ReactNode }) {
  const last = useRef(children)
  if (children) last.current = children
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const measured = children ? (inner.current?.offsetHeight ?? 0) : 0
    if (measured !== height) setHeight(measured)
  })
  return (
    <div className="overflow-hidden transition-[height] duration-300 ease-out" style={{ height }}>
      <div ref={inner} className="pt-3">
        {last.current}
      </div>
    </div>
  )
}

// A supported aircraft whose profile has no notes leaves the page's rest to the pilot's figure,
// standing on the right, waiting for them to host; the guide and the start card's own words say
// how. The figure's color is an example.
function NoNotes() {
  const hex = FIGURE_COLORS.find((c) => c.name === "orange")!.hex
  return (
    <div className="relative flex min-h-0 flex-1 justify-end">
      {/* It runs through the page's bottom and right padding, to the tab bar and the window's edge,
          so the figure's legs leave the page at the tab bar rather than ending in the air, and what
          swings right as it falls leaves at the window's edge. */}
      <div className="relative -mr-5 -mb-5 w-[260px] shrink-0 self-stretch">
        <StandingFigure hex={hex} />
      </div>
    </div>
  )
}

// The start card, and under it the page's rest; a frame's servers and play go to the card.
function HomePage({ theme, supported, servers, play, children }: { theme: Theme; supported: boolean; servers?: Servers; play?: Action; children: React.ReactNode }) {
  return (
    <AppFrame theme={theme} status={{ aircraft: supported ? "supported" : "unsupported" }} fixed>
      {/* 8px on top, since the header's own height already leaves room under its line. */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 p-5 pt-2" data-home-page>
        <StartCard supported={supported} servers={servers} play={play} />
        {children}
      </div>
    </AppFrame>
  )
}

// After the guide, whichever way it closed, a send-off on the page by itself, in the room the guide
// leaves: it fades in as the guide goes, from a little low, holds, and fades out as it rises on.
// Coherent GT has no @starting-style, so it mounts unseen and a transition brings it in two frames
// later; timers end it, as they end the guide. In milliseconds.
const FAREWELL = { delay: 150, in: 700, hold: 1500, out: 600 }
function Farewell({ onGone }: { onGone: () => void }) {
  const [phase, setPhase] = useState<"mounted" | "shown" | "going">("mounted")
  useEffect(() => {
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => setPhase("shown"))))
    const going = window.setTimeout(() => setPhase("going"), FAREWELL.delay + FAREWELL.in + FAREWELL.hold)
    const gone = window.setTimeout(onGone, FAREWELL.delay + FAREWELL.in + FAREWELL.hold + FAREWELL.out)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(going)
      clearTimeout(gone)
    }
    // It runs once, from its mounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const shown = phase === "shown"
  return (
    // Raised from the room's middle, where it would look low under the start card.
    <div className="pointer-events-none absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center pb-16">
      <p
        className="text-lg font-medium text-foreground/90 transition-[opacity,transform] ease-out"
        style={{
          opacity: shown ? 1 : 0,
          transform: `translateY(${phase === "mounted" ? 6 : phase === "shown" ? 0 : -4}px)`,
          transitionDuration: `${phase === "going" ? FAREWELL.out : FAREWELL.in}ms`,
          transitionDelay: shown ? `${FAREWELL.delay}ms` : "0ms",
        }}
      >
        Have a nice flight!
      </p>
    </div>
  )
}

// A frame for the aircraft check opens the guide on its last page.
export function HomeFirstTimeFrame({ theme, aircraft, openOnCheck }: { theme: Theme; aircraft: "supported" | "unsupported"; openOnCheck?: boolean }) {
  const supported = aircraft === "supported"
  const [guiding, setGuiding] = useState(true)
  const [farewell, setFarewell] = useState(false)
  return (
    <HomePage theme={theme} supported={supported}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {guiding && <WelcomeGuide supported={supported} startAt={openOnCheck ? PAGES - 1 : 0} onLeave={() => setFarewell(true)} onClose={() => setGuiding(false)} />}
        {farewell && <Farewell onGone={() => setFarewell(false)} />}
      </div>
    </HomePage>
  )
}

// Home on a later visit: the authors' notes, or the figure when there are none, and in an aircraft
// Dual Input doesn't support, the guide's last page, which has no notes to show. A frame says how
// our servers, faked, answer, and can play hosting or joining by itself.
export function HomeLaterFrame({ theme, aircraft, notes, servers, play }: { theme: Theme; aircraft: "supported" | "unsupported"; notes?: keyof typeof NOTES; servers?: Servers; play?: Action }) {
  const supported = aircraft === "supported"
  return (
    <HomePage theme={theme} supported={supported} servers={servers} play={play}>
      {!supported ? (
        <section className="flex flex-col gap-1.5">
          <AircraftCheck supported={false} />
        </section>
      ) : notes ? (
        <AuthorsNotes notes={NOTES[notes]} />
      ) : (
        <NoNotes />
      )}
    </HomePage>
  )
}

// Every refusal's message in a card like the start card, so each shows at the width and on the
// background it has there, under a line saying when it shows.
function RefusalsSheet() {
  const { Card, CardContent } = useUI()
  return (
    <div className="p-5">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="flex flex-col gap-6">
          {(Object.keys(REFUSALS) as Refusal[]).map((why) => (
            <div key={why} className="flex flex-col gap-2">
              <Label>{REFUSED_WHEN[why]}</Label>
              <Refused why={why} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
// The sheet takes the kit from the frame's context, so it's drawn inside the frame.
export function RefusalsFrame({ theme }: { theme: Theme }) {
  return (
    <AppFrame theme={theme} status={{ aircraft: "supported" }} header={false} tabs={false}>
      <RefusalsSheet />
    </AppFrame>
  )
}
