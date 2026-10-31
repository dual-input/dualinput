// The Figures tab, the tab the code calls avatars: how others see this pilot, their name and their
// figure's color, with the portrait setup showed them (identity.tsx); whether they see their own
// figure and the crew's, inside the aircraft and on a walkaround; and guides they open for help:
// how seats work, how a figure points at what its pilot clicks, and how to hide the sim's default
// avatar (user, 2026-10-31). A note at the top says why the figures do less in the loaded aircraft,
// where they do, since a pilot whose figure stops pointing at their clicks comes here to look. The
// copy says "figure" for Dual Input's and "avatar" only for the sim's own (user, 2026-10-31). The
// words, the name, and the colors are drafts and examples.
// What the tab leaves out: which seat this pilot is in, which the figures show; and a held seat,
// which the notification banner says while this pilot's camera is in it, "This seat is taken",
// since the fix is in the cockpit, not on the EFB (user, 2026-10-31).
import { useEffect, useId, useRef, useState } from "react"
import { ChevronDown, EyeOff, Info, MousePointerClick } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { AppFrame, useShowShared } from "./shell"
import { ScrollPage } from "./scroller"
import { MOMENT, Room, useReveal } from "./ease"
import { IdentityCard, WINDOWS_USERNAME } from "./identity"
import { FIGURE_COLORS } from "./figure-portrait"
import { useFlightAround } from "./traffic"

// Why the figures do less in the loaded aircraft, in the information color, the words too, with no
// tab dot, since the pilot has nothing to fix. Where an aircraft ships its files encrypted, as the
// Marketplace's iniBuilds A380 and Phenom 300E do, Dual Input can't read its model, so a click
// brings no hand, while seats and heads work (record/areas/avatars/01-avatars.md, A machine that
// can't read the models), which the record had as a notification and the user moved here, since it
// would come back on every flight in that aircraft; its Learn more opens the guide on pointing and
// clicking (user, 2026-10-31). A profile with no seats leaves every figure in no seat, which inside
// draws as a head at the camera (01-avatars.md, A seat), an inference the record doesn't state; and
// with no profile, avatars is idle (record/areas/product/03-v1-scope.md, Coverage).
export type AircraftNote = "model" | "seats" | "profile"
function NoteForAircraft({ note, onLearnMore }: { note: AircraftNote; onLearnMore: () => void }) {
  return (
    <p className="flex items-baseline gap-2.5 rounded-2xl bg-info/10 px-4 py-3 text-sm text-info">
      <Info className="size-4 shrink-0 [transform:translateY(3px)]" />
      <span>
        {note === "model" ? (
          <>
            Pointing and clicking won't work in this aircraft as Dual Input can't read its model files (Marketplace aircraft).{" "}
            <button type="button" onClick={onLearnMore} className="font-medium underline underline-offset-2 outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring">
              Learn more
            </button>
          </>
        ) : note === "seats" ? (
          "This aircraft's Dual Input profile has no seats, so figures show as floating heads only."
        ) : (
          "This aircraft has no Dual Input profile yet, so figures don't show in it."
        )}
      </span>
    </p>
  )
}

// A setting's switch, the whole row its label out to the card's edges, 36px tall at least, as the
// ATC output device's row is, so 16px parts two options' words, no more than parts the list from
// the card's edges (user, 2026-10-31: at 44px, 24px parted them, more than the 16px outside). A VR
// pointer anywhere on it flips the switch, as the sharing cards' rows do. A row of one line centers
// its words' capitals on the switch from their baseline, through a strut half the switch's 20px and
// half Geist's 10px capitals at 14px tall, since each platform places the words in their line box
// differently; a row with a note centers the two as a block.
function SwitchRow({ label, note }: { label: string; note?: string }) {
  const { Switch } = useUI()
  const id = useId()
  const [on, setOn] = useState(true)
  return (
    <label htmlFor={id} className={"box-content flex min-h-5 cursor-pointer px-(--card-spacing) py-2 transition-colors hover:bg-muted/40 active:bg-muted/60 " + (note ? "items-center" : "items-baseline")}>
      {!note && <span aria-hidden className="h-[15px] w-0 self-baseline" />}
      <span className="flex flex-1 flex-col gap-0.5 text-sm">
        {label}
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </span>
      <Switch id={id} checked={on} onCheckedChange={setOn} className="ml-3 self-center" />
    </label>
  )
}

// Which figures show, this pilot's own and the crew's, each inside the aircraft and on a walkaround
// apart, all on at first, the app speaking to the pilot as "your" (user, 2026-10-31). Tried and
// dropped: one switch for each, which the record gives (record/areas/product/03-v1-scope.md, Avatar
// sync); grouped by where, inside the aircraft and walkaround; "My figure"; a note under your
// figure inside, "Your figure's head is hidden and its hands fade, so they don't block your view",
// since a pilot sees the figure at work before reading it and minds it or not whatever it says
// (user, 2026-10-31).
function Visibility() {
  const { Card, Separator } = useUI()
  const group = (title: string) => <span className="px-(--card-spacing) pt-4 pb-1 text-xs text-muted-foreground">{title}</span>
  return (
    <Card className="gap-0 py-0 [--card-spacing:--spacing(5)]">
      {group("Your figure")}
      <SwitchRow label="Inside the aircraft" />
      <SwitchRow label="Walkaround" />
      <Separator className="mt-2" />
      {group("The crew's figures")}
      <SwitchRow label="Inside the aircraft" />
      <SwitchRow label="Walkaround" />
      <span className="h-2" />
    </Card>
  )
}

// A guide a pilot opens for help, in a tint with no border, as the traffic packs box is, its
// corners 16px. Its title row is the button, 44px tall for a VR pointer; its chevron turns on the
// press, and its body opens in a moment of its own (ease.tsx, useReveal), the page scrolling as it
// opens so the guide shows whole. A guide another part of the page opens, as the note's Learn more
// opens pointing and clicking, is held by the page.
function Guide({ icon, title, open, onToggle, children, shown = 0 }: { icon: React.ReactNode; title: string; open: boolean; onToggle: () => void; children: React.ReactNode; shown?: number }) {
  const body = useReveal(open)
  const section = useRef<HTMLElement>(null)
  // As it opens, and each time the page asks again to show it, as the note's Learn more does; not
  // for a guide open from the page's first showing.
  const first = useRef(true)
  useEffect(() => {
    const el = section.current
    if (first.current) {
      first.current = false
      return
    }
    if (!open || !el) return
    const frame = requestAnimationFrame(() => {
      const head = el.firstElementChild as HTMLElement
      const inner = el.lastElementChild?.firstElementChild as HTMLElement | null
      showWhole(el, head.offsetHeight + (inner?.offsetHeight ?? 0))
    })
    return () => cancelAnimationFrame(frame)
  }, [open, shown])
  return (
    <section ref={section} className="rounded-2xl bg-muted/20">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-2xl px-4 py-3 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-muted/30 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {icon}
        <span className="flex-1">{title}</span>
        <ChevronDown className="size-4 shrink-0" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 220ms ease-in-out" }} />
      </button>
      <Room open={body.open} style={body.style}>
        <div className="flex flex-col gap-4 px-4 pb-4 text-sm text-muted-foreground">{children}</div>
      </Room>
    </section>
  )
}

// An aircraft seat from the side, in Lucide's 24px grid and 2px stroke, since Lucide has an
// armchair and a sofa but no aircraft seat (user, 2026-10-31: the armchair "doesn't quite fit").
function SeatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0" aria-hidden>
      <path d="M6 3h2a2 2 0 0 1 2 1.7L11.3 12H17a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H9.5a2 2 0 0 1-2-1.6L5 5.4A2 2 0 0 1 6 3Z" />
      <path d="M10 17v4" />
      <path d="M16 17v4" />
      <path d="M8 21h10" />
    </svg>
  )
}

// Seats as bubbles, in the user's words (user, 2026-10-31), drawn as they are in practice, from
// above with the nose up (user, 2026-10-31: "more representative bubbles"): a seat's bubble is its
// take radius, 0.4m unless the profile gives one, around its eye, which sits over the back of the
// cushion, 5cm behind the hip; two seats side by side sit closer than two radii, so their bubbles
// overlap, and the overlap splits at the plane halfway between their eyes, as two balls of dough
// pressed together meet in a flat border (record/areas/avatars/01-avatars.md, A seat;
// record/areas/profiles/01-format-and-delivery.md, Seats). To scale at 120px a meter, with the
// seats 0.62m apart, as the format's example puts them, whose numbers are hypothetical. This
// pilot's seat and bubble take their color, the seat stronger, and their head sits at its eye
// (user, 2026-10-31: "coloring the 'taken' seat with the figure's color"); the other is free.
// Tried and dropped: two separate round bubbles, which no cockpit has.
function SeatsDrawing({ hex }: { hex: string }) {
  const px = 120
  const r = 0.4 * px
  const half = (0.62 / 2) * px
  const mid = 120
  const eyeY = 62
  const dy = Math.sqrt(r * r - half * half)
  const [left, right] = [mid - half, mid + half]
  const bubble = (side: 0 | 1) => `M ${mid} ${eyeY - dy} A ${r} ${r} 0 1 ${side} ${mid} ${eyeY + dy} Z`
  // The taken seat in its pilot's color, the cushion tinted and outlined, the backrest stronger;
  // the free seat in the page's own muted ink.
  const seat = (x: number, color?: string) => (
    <g>
      <rect x={x - 27} y={22} width={54} height={50} rx={10} fill={color ?? "none"} fillOpacity={color ? 0.22 : 0} stroke={color ?? "currentColor"} strokeOpacity={color ? 0.9 : 0.6} strokeWidth={1.5} />
      <rect x={x - 25} y={70} width={50} height={10} rx={5} fill={color ?? "currentColor"} fillOpacity={color ? 0.7 : 0.35} />
    </g>
  )
  return (
    <svg viewBox="0 0 240 132" className="mx-auto h-[132px] w-[240px]" aria-hidden>
      {seat(left, hex)}
      {seat(right)}
      <path d={bubble(0)} fill={hex} fillOpacity={0.08} stroke={hex} strokeOpacity={0.6} strokeDasharray="3 4" />
      <path d={bubble(1)} fill="none" stroke="currentColor" strokeOpacity={0.45} strokeDasharray="3 4" />
      <circle cx={left} cy={eyeY} r={9} fill={hex} />
      <text x={left} y={127} textAnchor="middle" fontSize={11} fill="currentColor">
        You
      </text>
      <text x={right} y={127} textAnchor="middle" fontSize={11} fill="currentColor">
        Free
      </text>
    </svg>
  )
}

// Scrolls the page, in its own scroll box, just enough that a guide shows whole once open: down
// while its foot is below the page's foot, but never so far its title leaves the top; up when its
// title is above the top; not at all when it shows already (user, 2026-10-31). Its height is the
// open one, its title row and its body's measured height, so the scroll runs as the guide opens
// rather than after. The canvas can zoom the page, so screen distances are turned back into the
// page's own pixels. 20px of room stays at either end, the page's padding. Tried and dropped: one
// smooth scroll by the whole distance, which the browser cut short at the page's foot before the
// guide had opened.
function showWhole(part: HTMLElement, height: number) {
  let box = part.parentElement
  while (box && getComputedStyle(box).overflowY !== "auto") box = box.parentElement
  if (!box) return
  const page = box
  const zoom = page.getBoundingClientRect().height / page.clientHeight || 1
  const room = 20
  const needed = () => {
    const top = (part.getBoundingClientRect().top - page.getBoundingClientRect().top) / zoom
    const above = top - room
    const below = top + height - (page.clientHeight - room)
    return above < 0 ? above : below > 0 ? Math.min(below, above) : 0
  }
  // A quarter of what's left each frame, so it eases in, and it follows the page as the guide
  // opens, since the browser stops a scroll at the page's foot, which moves down as it opens.
  const until = performance.now() + MOMENT.move + 400
  const step = () => {
    const by = needed()
    if (Math.abs(by) < 0.5) return
    page.scrollTop += by * 0.25
    if (performance.now() < until) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

// How a figure points at what its pilot clicks: the core casts a ray from the camera through the
// cursor and finds what it meets in the aircraft's model, a clickable part's own shape, so the hand
// reaches that spot (record/areas/avatars/01-avatars.md, The ray and What it meets); an encrypted
// model can't be read, so in it the hands stay at rest (A machine that can't read the models).
// The sim's default avatar: Dual Input ships an avatar with nothing to show, which the pilot picks
// in the sim (record/areas/product/03-v1-scope.md, Avatar sync). How it's built, and whether the
// sim's own screen lists it, is open (01-avatars.md, Left open), so the steps are drafts: the
// menu's path, the name at the main menu's top right and then Customize Identity, is from forum
// posts, unverified, and the avatar's name is hypothetical.
function AvatarsPage({ session, note, helpOpen }: { session: boolean; note?: AircraftNote; helpOpen?: boolean }) {
  useFlightAround(session)
  useShowShared("traffic", session ? "James" : undefined)
  useShowShared("atc", session ? "James" : undefined)
  const page = useRef<HTMLDivElement>(null)
  const [asked, setAsked] = useState(0)
  const [name, setName] = useState(WINDOWS_USERNAME)
  const [hue, setHue] = useState("orange")
  const [open, setOpen] = useState({ seats: !!helpOpen, pointing: !!helpOpen, avatar: !!helpOpen })
  const toggle = (k: keyof typeof open) => () => setOpen((o) => ({ ...o, [k]: !o[k] }))
  // A member's entry, their name in it, is written once per session and never after
  // (record/areas/session/02-units.md, Members), so a new name reaches the crew from the next one.
  // It shows under the card rather than under the field, so the card keeps its symmetry.
  const renamed = useReveal(session && name.trim() !== WINDOWS_USERNAME)
  const hex = FIGURE_COLORS.find((c) => c.name === hue)!.hex
  return (
    <div ref={page} className="flex min-h-0 flex-1 flex-col">
      <ScrollPage>
        {note && (
          <NoteForAircraft
            note={note}
            onLearnMore={() => {
              setOpen((o) => ({ ...o, pointing: true }))
              setAsked((n) => n + 1)
            }}
          />
        )}
        <div className="flex flex-col">
          <IdentityCard name={name} onName={setName} hue={hue} onHue={setHue} region={page} className="[--card-spacing:--spacing(5)]" />
          <Room open={renamed.open} pad="pt-2.5" style={renamed.style}>
            <p className="px-1 text-xs text-muted-foreground">Your new name will apply in your next flight</p>
          </Room>
        </div>
        <Visibility />
        <div className="flex flex-col gap-3">
          <Guide icon={<SeatIcon />} title="How seats work" open={open.seats} onToggle={toggle("seats")}>
            <p>Think of seats like invisible bubbles. Moving your camera into one makes your figure take that seat. Moving out frees the seat.</p>
            <SeatsDrawing hex={hex} />
          </Guide>
          <Guide icon={<MousePointerClick className="size-4 shrink-0" />} title="How pointing and clicking works" open={open.pointing} onToggle={toggle("pointing")} shown={asked}>
            <p>When you click something in the cockpit, Dual Input traces a line from your camera through your pointer to where it meets the aircraft's 3D model, and your figure's hand reaches for that spot on the crew's screens.</p>
            <p>To find it, Dual Input reads the aircraft's model files. Marketplace aircraft usually ship them encrypted, so in those your figure's hands stay at rest.</p>
          </Guide>
          <Guide icon={<EyeOff className="size-4 shrink-0" />} title="How to hide the sim's default avatar" open={open.avatar} onToggle={toggle("avatar")}>
            <p>On a walkaround, your figure can clash with the sim's own avatar. Dual Input adds a transparent avatar to the sim, which you can pick to hide the sim's own:</p>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5">
              <li>In the sim's main menu, select your name at the top right.</li>
              <li>Select Customize Identity.</li>
              <li>Pick the Dual Input transparent avatar, and save.</li>
            </ol>
          </Guide>
        </div>
      </ScrollPage>
    </div>
  )
}

export function AvatarsFrame({ theme, session = true, note, helpOpen }: { theme: Theme; session?: boolean; note?: AircraftNote; helpOpen?: boolean }) {
  return (
    <AppFrame theme={theme} tab="avatars" fixed>
      <AvatarsPage session={session} note={note} helpOpen={helpOpen} />
    </AppFrame>
  )
}
