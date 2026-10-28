// The EFB app's home page on a pilot's first visit, designed from the user's sketch of 2026-10-26:
// the start card, then a short guide to how a session works that ends on the aircraft check, for an
// aircraft Dual Input supports and for one it doesn't. The aircraft are examples.
import { useLayoutEffect, useRef, useState } from "react"
import { CircleCheck, CircleX } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { StatusChip } from "@/bench/screens"
import { AppFrame, Label } from "./shell"

// The loaded aircraft as the card names it: the maker from its package's manifest, the model,
// and its tail number, which the sim reports as `A:ATC ID`.
const LOADED = { maker: "Black Square", model: "Baron 58P", tail: "N58BK" }
const LOADED_UNSUPPORTED = { maker: "Fenix", model: "A320", tail: "G-FNXA" }
const SUPPORTED = [
  { name: "Black Square Baron 58P", maturity: "Stable" },
  { name: "Synaptic A220", maturity: "Stable" },
  { name: "A2A Simulations PA24-250 Comanche", maturity: "Experimental" },
]

// The loaded aircraft on top, since a session flies the host's aircraft, then Host and the code
// field to join with. Selecting the code field fills it from the clipboard and joins at once
// (record/areas/product/03-v1-scope.md, Invite code), so the field stays in view.
function StartCard({ supported }: { supported: boolean }) {
  const { Badge, Button, Card, CardContent, Separator, InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } = useUI()
  const [code, setCode] = useState("")
  const aircraft = supported ? LOADED : LOADED_UNSUPPORTED
  return (
    // The card's padding matches the page's 20px, where Luma's default card spacing is 24px.
    <Card className="[--card-spacing:--spacing(5)]">
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
        <Button size="lg" className="w-full">
          Host a session
        </Button>
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">or join with a code</span>
          <Separator className="flex-1" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <InputOTP maxLength={6} value={code} onChange={(v: string) => setCode(v.toUpperCase())}>
            <InputOTPGroup>
              {[0, 1, 2].map((i) => (
                <InputOTPSlot key={i} index={i} className="font-mono" />
              ))}
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              {[3, 4, 5].map((i) => (
                <InputOTPSlot key={i} index={i} className="font-mono" />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <Button variant="outline" disabled={code.length < 6}>
            Join
          </Button>
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
// on later visits.
function WelcomeGuide({ supported, startAt = 0, onClose }: { supported: boolean; startAt?: number; onClose: () => void }) {
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
  const go = (to: number) => {
    setBack(to < page)
    setPage(to)
  }
  const title = (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-base font-semibold">Welcome to Dual Input</h2>
      {!last && (
        <Button variant="link" className="h-auto border-0 p-0 text-muted-foreground" onClick={onClose}>
          Skip guide
        </Button>
      )}
    </div>
  )
  const pageView = (
    <div className="overflow-hidden transition-[height] duration-300 ease-out" style={{ height }}>
      <div ref={content}>
        {/* Keyed by page, so each page slides in from the side it comes from. Pages before the
            check share one height, the longest's, so the buttons stay put between them. */}
        <div key={page} className={"flex min-h-28 animate-in flex-col gap-1.5 px-5 duration-200 fade-in " + (back ? "slide-in-from-left-3" : "slide-in-from-right-3")}>
          {last ? (
            <AircraftCheck supported={supported} />
          ) : (
            <>
              <h3 className="text-base font-semibold">{GUIDE[page].title}</h3>
              <p className="text-sm text-muted-foreground">{GUIDE[page].body}</p>
            </>
          )}
        </div>
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
        {page > 0 && (
          <Button variant="ghost" onClick={() => go(page - 1)}>
            Back
          </Button>
        )}
        <Button variant="secondary" onClick={() => (last ? onClose() : go(page + 1))}>
          {last ? "Done" : "Next"}
        </Button>
      </div>
    </>
  )
  return (
    // It rises in a beat after the page appears, so the eye lands on it once.
    <section className="flex animate-in flex-col gap-3 duration-500 fade-in slide-in-from-bottom-4" style={{ animationDelay: "400ms", animationFillMode: "backwards" }}>
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

// A frame for the aircraft check opens the guide on its last page.
export function HomeFirstTimeFrame({ theme, aircraft, openOnCheck }: { theme: Theme; aircraft: "supported" | "unsupported"; openOnCheck?: boolean }) {
  const supported = aircraft === "supported"
  const [guiding, setGuiding] = useState(true)
  return (
    <AppFrame theme={theme} status={{ aircraft }}>
      {/* 8px on top, since the header's own height already leaves room under its line. */}
      <div className="flex flex-1 flex-col gap-6 p-5 pt-2">
        <StartCard supported={supported} />
        {guiding && <WelcomeGuide supported={supported} startAt={openOnCheck ? PAGES - 1 : 0} onClose={() => setGuiding(false)} />}
      </div>
    </AppFrame>
  )
}
