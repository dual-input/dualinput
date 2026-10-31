// The Avatars tab: how others see this pilot, their name and their figure's color, with the
// portrait setup showed them (identity.tsx); whether they see their own figure and the crew's; and
// two notes they open for help, how seats work and hiding the sim's own avatar (user, 2026-10-31).
// A note at the top says why the figures do less in the loaded aircraft, where they do, since a
// pilot whose figure's hands stop following their clicks comes here to look. The words, the name,
// and the colors are drafts and examples.
// What the tab leaves out: which seat this pilot is in, which the figures show; and a held seat,
// which the notification banner says while this pilot's camera is in it, "This seat is taken",
// since the fix is in the cockpit, not on the EFB (user, 2026-10-31).
import { useId, useRef, useState } from "react"
import { Armchair, ChevronDown, EyeOff, Info } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { AppFrame, useShowShared } from "./shell"
import { ScrollPage } from "./scroller"
import { Room, useReveal } from "./ease"
import { IdentityCard, WINDOWS_USERNAME } from "./identity"
import { FIGURE_COLORS } from "./figure-portrait"
import { useFlightAround } from "./traffic"

// Why the figures do less in the loaded aircraft. Where a Marketplace aircraft ships its files
// encrypted, Dual Input can't read its model, so a click brings no hand, while seats and heads work
// (record/areas/avatars/01-avatars.md, A machine that can't read the models), which the record had
// as a notification and the user moved here, since it would come back on every flight in that
// aircraft (user, 2026-10-31). A profile with no seats leaves every figure in no seat, which inside
// draws as a head at the camera (01-avatars.md, A seat), so the figures are heads only, an inference
// the record doesn't state; and with no profile, avatars is idle
// (record/areas/product/03-v1-scope.md, Coverage). In the information color, with no tab dot, since
// the pilot has nothing to fix.
export type AircraftNote = "model" | "seats" | "profile"
const NOTES: Record<AircraftNote, string> = {
  model: "Your figure's hands can't follow your clicks in this aircraft, since Dual Input can't read its model files. Seats and heads still work.",
  seats: "This aircraft's profile has no seats yet, so figures show as heads only.",
  profile: "This aircraft has no profile yet, so figures don't show in it.",
}
function NoteForAircraft({ note }: { note: AircraftNote }) {
  return (
    <p className="flex items-baseline gap-2.5 rounded-xl bg-info/10 px-4 py-3 text-sm">
      <Info className="size-4 shrink-0 text-info [transform:translateY(3px)]" />
      <span>{NOTES[note]}</span>
    </p>
  )
}

// A setting's switch, the whole row its label out to the card's edges, so a VR pointer anywhere on
// it flips the switch, as the sharing cards' rows do. A row of one line centers its words' capitals
// on the switch from their baseline, through a strut half the switch's 20px and half Geist's 10px
// capitals at 14px tall, since each platform places the words in their line box differently; a
// row with a note centers the two as a block.
function SwitchRow({ label, note }: { label: string; note?: string }) {
  const { Switch } = useUI()
  const id = useId()
  const [on, setOn] = useState(true)
  return (
    <label htmlFor={id} className={"box-content flex min-h-5 cursor-pointer p-(--card-spacing) transition-colors hover:bg-muted/40 active:bg-muted/60 " + (note ? "items-center" : "items-baseline")}>
      {!note && <span aria-hidden className="h-[15px] w-0 self-baseline" />}
      <span className="flex flex-1 flex-col gap-0.5 text-sm">
        {label}
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </span>
      <Switch id={id} checked={on} onCheckedChange={setOn} className="ml-3 self-center" />
    </label>
  )
}

// A note a pilot opens for help, in the traffic packs box's tint with no border, as a supplement to
// the page. Its title row is the button, 44px tall for a VR pointer; its chevron turns on the
// press, and its body opens in a moment of its own (ease.tsx, useReveal).
function HelpNote({ icon, title, startOpen, children }: { icon: React.ReactNode; title: string; startOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!startOpen)
  const body = useReveal(open)
  return (
    <section className="rounded-xl bg-muted/20">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-4 py-3 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-muted/30 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
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

function AvatarsPage({ session, note, helpOpen }: { session: boolean; note?: AircraftNote; helpOpen?: boolean }) {
  const { Card, Separator } = useUI()
  useFlightAround(session)
  useShowShared("traffic", session ? "James" : undefined)
  useShowShared("atc", session ? "James" : undefined)
  const page = useRef<HTMLDivElement>(null)
  const [name, setName] = useState(WINDOWS_USERNAME)
  const [hue, setHue] = useState("orange")
  // A member's entry, their name in it, is written once per session and never after
  // (record/areas/session/02-units.md, Members), so a new name reaches the crew from the next one.
  // It shows under the card rather than under the field, so the card keeps its symmetry.
  const renamed = useReveal(session && name.trim() !== WINDOWS_USERNAME)
  const hex = FIGURE_COLORS.find((c) => c.name === hue)!.hex
  return (
    <div ref={page} className="flex min-h-0 flex-1 flex-col">
      <ScrollPage>
        {note && <NoteForAircraft note={note} />}
        <div className="flex flex-col">
          <IdentityCard
            name={name}
            onName={setName}
            hue={hue}
            onHue={setHue}
            crew={session ? [{ name: "James", hue: "red" }] : []}
            region={page}
            className="[--card-spacing:--spacing(5)]"
          />
          <Room open={renamed.open} pad="pt-2.5" style={renamed.style}>
            <p className="px-1 text-xs text-muted-foreground">Your crew sees your new name from your next session</p>
          </Room>
        </div>
        <Card className="gap-0 py-0 [--card-spacing:--spacing(5)]">
          <SwitchRow label="Show my own figure" note="Your figure's head is hidden and its hands fade, so they don't block what you click" />
          <Separator />
          <SwitchRow label="Show the crew's figures" />
        </Card>
        {/* At the page's foot, as the traffic packs box is, so the notes hold still as the parts
            above them change. */}
        <div className="mt-auto flex flex-col gap-3">
          <HelpNote icon={<Armchair className="size-4 shrink-0" />} title="How seats work" startOpen={helpOpen}>
            <p>Think of seats like invisible bubbles. Moving your camera into one makes your avatar take that seat. Moving out frees the seat.</p>
            <SeatsDrawing hex={hex} />
          </HelpNote>
          <HelpNote icon={<EyeOff className="size-4 shrink-0" />} title="Hide the sim's own avatar" startOpen={helpOpen}>
            <p>In outside views, the sim's own avatar stands where your figure is. To hide it, pick Dual Input's empty avatar in the sim's avatar screen.</p>
          </HelpNote>
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
