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
import { useId, useRef, useState } from "react"
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

// A setting's switch, the whole row its label out to the card's edges, 44px tall at least, so a VR
// pointer anywhere on it flips the switch, as the sharing cards' rows do. A row of one line centers
// its words' capitals on the switch from their baseline, through a strut half the switch's 20px and
// half Geist's 10px capitals at 14px tall, since each platform places the words in their line box
// differently; a row with a note centers the two as a block.
function SwitchRow({ label, note }: { label: string; note?: string }) {
  const { Switch } = useUI()
  const id = useId()
  const [on, setOn] = useState(true)
  return (
    <label htmlFor={id} className={"box-content flex min-h-5 cursor-pointer px-(--card-spacing) py-3 transition-colors hover:bg-muted/40 active:bg-muted/60 " + (note ? "items-center" : "items-baseline")}>
      {!note && <span aria-hidden className="h-[15px] w-0 self-baseline" />}
      <span className="flex flex-1 flex-col gap-0.5 text-sm">
        {label}
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </span>
      <Switch id={id} checked={on} onCheckedChange={setOn} className="ml-3 self-center" />
    </label>
  )
}

// Which figures show, inside the aircraft and on a walkaround apart, this pilot's own and the
// crew's, all on at first (user, 2026-10-31; tried and dropped: one switch for each, which the
// record gives, record/areas/product/03-v1-scope.md, Avatar sync).
function Visibility() {
  const { Card, Separator } = useUI()
  const group = (title: string) => <span className="px-(--card-spacing) pt-4 pb-1 text-xs text-muted-foreground">{title}</span>
  return (
    <Card className="gap-0 py-0 [--card-spacing:--spacing(5)]">
      {group("Inside the aircraft")}
      <SwitchRow label="My figure" note="Your figure's head is hidden and its hands fade, so they don't block your view" />
      <SwitchRow label="The crew's figures" />
      <Separator className="mt-1" />
      {group("Walkaround")}
      <SwitchRow label="My figure" />
      <SwitchRow label="The crew's figures" />
      <span className="h-1" />
    </Card>
  )
}

// A guide a pilot opens for help, in a tint with no border, as the traffic packs box is, its
// corners 16px. Its title row is the button, 44px tall for a VR pointer; its chevron turns on the
// press, and its body opens in a moment of its own (ease.tsx, useReveal). A guide another part of
// the page opens, as the note's Learn more opens pointing and clicking, is held by the page.
function Guide({ icon, title, open, onToggle, children, anchor }: { icon: React.ReactNode; title: string; open: boolean; onToggle: () => void; children: React.ReactNode; anchor?: React.RefObject<HTMLElement | null> }) {
  const body = useReveal(open)
  return (
    <section ref={anchor} className="scroll-mt-5 rounded-2xl bg-muted/20">
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

// Seats as bubbles, in the user's words (user, 2026-10-31), under a cockpit from above: two seats,
// each in its bubble, this pilot's head in one and the other free. A seat's bubble is its take
// radius around its eye (record/areas/avatars/01-avatars.md, A seat).
function SeatsDrawing({ hex }: { hex: string }) {
  const seat = (x: number) => (
    <g>
      <circle cx={x} cy={38} r={30} fill="none" stroke="currentColor" strokeOpacity={0.45} strokeDasharray="3 4" />
      <rect x={x - 22} y={44} width={44} height={36} rx={9} fill="none" stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.5} />
      <rect x={x - 20} y={76} width={40} height={8} rx={4} fill="currentColor" fillOpacity={0.35} />
    </g>
  )
  return (
    <svg viewBox="0 0 240 108" className="mx-auto h-[108px] w-[240px]" aria-hidden>
      {seat(70)}
      {seat(170)}
      <circle cx={70} cy={38} r={9} fill={hex} />
      <text x={70} y={102} textAnchor="middle" fontSize={11} fill="currentColor">
        You
      </text>
      <text x={170} y={102} textAnchor="middle" fontSize={11} fill="currentColor">
        Free
      </text>
    </svg>
  )
}

// Scrolls the page so a part's top sits 20px under the page's top, in the page's own scroll box,
// which the canvas's zoom leaves scrollIntoView short of.
function bringUp(part: HTMLElement | null) {
  let box = part?.parentElement ?? null
  while (box && getComputedStyle(box).overflowY !== "auto") box = box.parentElement
  if (!part || !box) return
  const top = box.scrollTop + part.getBoundingClientRect().top - box.getBoundingClientRect().top - 20
  box.scrollTo({ top, behavior: "smooth" })
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
  const pointing = useRef<HTMLElement>(null)
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
              // Once the guide has opened, since before it the page is too short to bring it up.
              window.setTimeout(() => bringUp(pointing.current), MOMENT.move)
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
          <Guide icon={<MousePointerClick className="size-4 shrink-0" />} title="How pointing and clicking works" open={open.pointing} onToggle={toggle("pointing")} anchor={pointing}>
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
