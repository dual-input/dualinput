// The Figures tab, avatars' part of the EFB app: how others see this pilot, whether they see their own figure and
// the crew's, inside the aircraft and on a walkaround, and guides they open for help. A note at the top says why the
// figures do less in the loaded aircraft, since a pilot whose figure stops pointing at their clicks comes here to look
// (record/areas/interface/decisions.md, "The Figures tab holds the pilot's figure and explains what its figures can do").
// A held seat isn't here: the banner says so while this pilot's camera is in it, since the fix is in the cockpit.

import { Card, MOMENT, placeIn, Room, ScrollPage, Separator, Switch, useReveal } from "@dualinput/ui"
import { FIGURE_COLORS } from "@dualinput/crew"
import { ChevronDown, EyeOff, Info, MousePointerClick, PersonStanding } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import type { AircraftNote } from "../../../engines/messages/ts/avatars/AircraftNote.ts"
import type { AvatarsSlice } from "../../../engines/messages/ts/avatars/AvatarsSlice.ts"
import type { ProfilesSlice } from "../../../engines/messages/ts/profiles/ProfilesSlice.ts"
import { definePart, useCoreSlice, useShell } from "../../../platform/efb-shell/src/part.ts"
import { FIGURE_COLOR, NAME, useSetting, writeSetting } from "../../../platform/efb-shell/src/settings/setting.ts"
import { IdentityCard } from "../../../platform/efb-shell/src/setup/identity-card.tsx"

/** `MINE_INSIDE`, `MINE_WALKAROUND`, `CREW_INSIDE`, and `CREW_WALKAROUND` in src/features/avatars/core/src/lib.rs name the same settings, so change both together. */
const MINE_INSIDE = "avatars.mine-inside"
const MINE_WALKAROUND = "avatars.mine-walkaround"
const CREW_INSIDE = "avatars.crew-inside"
const CREW_WALKAROUND = "avatars.crew-walkaround"

/** The color a pilot who never picked one starts from, which setup starts from too, in src/platform/efb-shell/src/setup/setup-flow.tsx, and `HomeRest`'s fallback in src/platform/efb-shell/src/session/home-rest.tsx names too, so change all three together. */
const FIRST_COLOR = "orange"

/** How long after the last key a new name goes out, in milliseconds, since the crew sees it as it's written, and shouldn't watch it spelled. */
const NAME_SETTLES = 800

/** Why the figures do less in the loaded aircraft, in the information color with no tab dot, since the pilot has nothing to fix. */
function NoteForAircraft({ note, onLearnMore }: { note: AircraftNote | "no-profile"; onLearnMore: () => void }) {
  return (
    <Card flush tint="bg-info/10 text-info">
      <p className="flex items-start px-4 py-3">
        <Info className="mr-2.5 mt-0.5 size-4 shrink-0" />
        {note === "model" ? (
          <span>
            Pointing and clicking won't work in this aircraft as Dual Input can't read its model files (Marketplace aircraft).{" "}
            <button type="button" onClick={onLearnMore} className="font-medium underline underline-offset-2">
              Learn more
            </button>
          </span>
        ) : note === "seats" ? (
          <span>This aircraft's Dual Input profile has no seats, so figures show as floating heads only.</span>
        ) : (
          <span>This aircraft has no Dual Input profile yet, so figures won't show.</span>
        )}
      </p>
    </Card>
  )
}

/** A setting's switch, its whole 36px row the target, for a VR pointer. */
function SwitchRow({ label, setting }: { label: string; setting: string }) {
  const { link } = useShell()
  const on = useSetting(link, setting) !== false
  return (
    <button type="button" className="flex min-h-9 w-full items-center px-5 text-left text-sm transition-colors hover:bg-muted/40 active:bg-muted/60" onClick={() => writeSetting(link, setting, !on)}>
      <span className="min-w-0 flex-1">{label}</span>
      <Switch checked={on} tabIndex={-1} className="ml-3 pointer-events-none" />
    </button>
  )
}

function Group({ title }: { title: string }) {
  return <span className="px-5 pb-1 pt-4 text-xs text-muted-foreground">{title}</span>
}

/** Which figures show, each inside the aircraft and on a walkaround apart, all on at first. */
function Visibility() {
  return (
    <Card flush>
      <Group title="Your figure" />
      <SwitchRow label="Inside the aircraft" setting={MINE_INSIDE} />
      <SwitchRow label="Walkaround" setting={MINE_WALKAROUND} />
      <Separator className="mt-2" />
      <Group title="The crew's figures" />
      <SwitchRow label="Inside the aircraft" setting={CREW_INSIDE} />
      <SwitchRow label="Walkaround" setting={CREW_WALKAROUND} />
      <span className="h-2" />
    </Card>
  )
}

/**
 * Scrolls the page, in its own scroll box, just enough that a guide shows whole once open: down while its foot is
 * below the page's foot, but never so far its title leaves the top, and up when its title is above the top. A quarter
 * of what's left each frame, so it eases in, following the page as the guide opens, since the browser stops a scroll
 * at the page's foot, which moves down as it opens. One smooth scroll by the whole distance was cut short at that foot.
 */
function showWhole(part: HTMLElement, height: number): void {
  let box = part.parentElement
  while (box && getComputedStyle(box).overflowY !== "auto") box = box.parentElement
  if (!box) return
  const page = box
  /** Room left at either end, the page's padding. */
  const room = 20
  const needed = () => {
    const top = placeIn(part, page).y
    const above = top - room
    const below = top + height - (page.clientHeight - room)
    return above < 0 ? above : below > 0 ? Math.min(below, above) : 0
  }
  const until = performance.now() + MOMENT.move + 400
  const step = () => {
    const by = needed()
    if (Math.abs(by) < 0.5) return
    page.scrollTop += by * 0.25
    if (performance.now() < until) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/**
 * A guide a pilot opens for help, in a tint of the page. Its title row is the button, 44px tall for a VR pointer. `asked`
 * counts each time another part of the page asks to show it, as the note's Learn more does, which scrolls to it again
 * even when it's open already; a guide open from the page's first showing doesn't scroll.
 */
function Guide({ icon, title, open, onToggle, asked = 0, children }: { icon: ReactNode; title: string; open: boolean; onToggle: () => void; asked?: number; children: ReactNode }) {
  const reveal = useReveal(open)
  const whole = useRef<HTMLElement>(null)
  const head = useRef<HTMLButtonElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (!open) return
    const frame = requestAnimationFrame(() => {
      if (whole.current && head.current && body.current) showWhole(whole.current, head.current.offsetHeight + body.current.offsetHeight)
    })
    return () => cancelAnimationFrame(frame)
  }, [open, asked])
  return (
    <section ref={whole}>
      <Card flush tint="bg-muted/20 text-muted-foreground">
        <button ref={head} type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-11 w-full items-center px-4 py-3 text-left transition-colors hover:bg-muted/30 hover:text-foreground">
          {icon}
          <span className="ml-2.5 flex-1">{title}</span>
          <ChevronDown className="ml-2.5 size-4 shrink-0" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 220ms ease-in-out" }} />
        </button>
        <Room open={reveal.open} style={reveal.style}>
          <div ref={body} className="space-y-4 px-4 pb-4">
            {children}
          </div>
        </Room>
      </Card>
    </section>
  )
}

/** An aircraft seat from the side, in Lucide's 24px grid and 2px stroke, since Lucide has none. */
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

/** A seat from above, nose up: the cushion, a backrest across its back a little wider than it, and an armrest down each side. */
function SeatFromAbove({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x - 21} y={y - 26} width={42} height={40} rx={8} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.5} />
      <rect x={x - 29} y={y - 16} width={6} height={32} rx={3} fill="currentColor" fillOpacity={0.3} />
      <rect x={x + 23} y={y - 16} width={6} height={32} rx={3} fill="currentColor" fillOpacity={0.3} />
      <rect x={x - 25} y={y + 14} width={50} height={14} rx={7} fill="currentColor" fillOpacity={0.4} />
    </g>
  )
}

/** The arc of a circle as short lines, 3px on and 4px off, since Coherent GT's stroke ignores `stroke-dasharray` (record/areas/architecture/coherent-gt.md). */
function dashedArc(x: number, y: number, r: number, from: number, to: number): string {
  const on = 3 / r
  const every = 7 / r
  let path = ""
  for (let at = from; at < to; at += every) {
    const end = Math.min(at + on, to)
    path += `M${x + r * Math.cos(at)} ${y + r * Math.sin(at)}L${x + r * Math.cos(end)} ${y + r * Math.sin(end)}`
  }
  return path
}

/**
 * Seats as bubbles, as they are in practice, from above with the nose up: a seat's bubble is its take radius, 0.4m
 * unless the profile gives one, around its eye; two seats side by side sit closer than two radii, so their bubbles
 * overlap and split at the plane halfway between them (record/areas/avatars/01-avatars.md, "A seat"). To scale at 120px
 * a meter, with the seats 0.62m apart, as the profile format's example puts them, whose numbers are hypothetical. The
 * free bubble is a faint neutral tint with a dashed edge, and this pilot's a tint of their color, filled by their head.
 */
function SeatsDrawing({ hex }: { hex: string }) {
  const r = 0.4 * 120
  const half = (0.62 / 2) * 120
  const mid = 120
  const seatY = 52
  const dy = Math.sqrt(r * r - half * half)
  const [left, right] = [mid - half, mid + half]
  const bubble = (side: 0 | 1) => `M ${mid} ${seatY - dy} A ${r} ${r} 0 1 ${side} ${mid} ${seatY + dy} Z`
  const corner = Math.atan2(dy, half)
  const word = (x: number, text: string) => (
    <span className="absolute text-center text-xs" style={{ left: x - 24, top: 102, width: 48 }}>
      {text}
    </span>
  )
  return (
    <div className="relative mx-auto" style={{ width: 240, height: 120 }}>
      {/* Sized in CSS, so the seats take the kit root's zoom with the words placed over them, which Coherent GT doesn't give an svg's width and height attributes (record/areas/interface/log.md, "2026-11-23: Under the kit root's zoom"). */}
      <svg style={{ width: 240, height: 120 }} viewBox="0 0 240 120" fill="none" className="block" aria-hidden>
        <path d={bubble(1)} fill="currentColor" fillOpacity={0.05} />
        <path d={dashedArc(right, seatY, r, corner - Math.PI, Math.PI - corner)} stroke="currentColor" strokeOpacity={0.4} />
        <path d={bubble(0)} fill={hex} fillOpacity={0.14} stroke={hex} strokeOpacity={0.85} strokeWidth={1.5} />
        <SeatFromAbove x={left} y={seatY} />
        <SeatFromAbove x={right} y={seatY} />
        {/* Over the seat's back, where a seated pilot's head is from above. */}
        <circle cx={left} cy={seatY + 5} r={9} fill={hex} />
      </svg>
      {word(left, "You")}
      {word(right, "Free")}
    </div>
  )
}

function FiguresPage() {
  const { link, tab } = useShell()
  // Every tab's page stays mounted, and the portrait aims by measuring, which a hidden page can't, so the card waits for the tab's first opening.
  const opened = useRef(false)
  if (tab === "avatars") opened.current = true
  const profiles = useCoreSlice<ProfilesSlice>("profiles")
  // With no profile, avatars loads nothing and so has no note of its own to give.
  const note = useCoreSlice<AvatarsSlice>("avatars")?.note ?? (profiles && !profiles.loaded ? "no-profile" : null)
  const page = useRef<HTMLDivElement>(null)
  const saved = useSetting(link, NAME)
  // What the pilot is typing, which waits on no answer from the core. An emptied field writes nothing, so a member always has a name.
  const [typed, setTyped] = useState<string>()
  const name = typed ?? (typeof saved === "string" ? saved : "")
  useEffect(() => {
    if (!typed?.trim()) return
    const timer = window.setTimeout(() => writeSetting(link, NAME, typed.trim()), NAME_SETTLES)
    return () => window.clearTimeout(timer)
  }, [typed, link])
  const color = useSetting(link, FIGURE_COLOR)
  const picked = FIGURE_COLORS.find((candidate) => candidate.name === color) ?? FIGURE_COLORS.find((candidate) => candidate.name === FIRST_COLOR)!
  const [open, setOpen] = useState({ seats: false, pointing: false, avatar: false })
  const toggle = (guide: keyof typeof open) => () => setOpen((now) => ({ ...now, [guide]: !now[guide] }))
  const [asked, setAsked] = useState(0)
  return (
    <div ref={page} className="flex min-h-0 flex-1 flex-col">
      <ScrollPage>
        {note && (
          <NoteForAircraft
            note={note}
            onLearnMore={() => {
              setOpen((now) => ({ ...now, pointing: true }))
              setAsked((count) => count + 1)
            }}
          />
        )}
        {opened.current && <IdentityCard name={name} onName={setTyped} color={picked.name} onColor={(next) => writeSetting(link, FIGURE_COLOR, next)} region={page} />}
        <Visibility />
        <div className="space-y-3">
          <Guide icon={<SeatIcon />} title="How seats work" open={open.seats} onToggle={toggle("seats")}>
            <p>Think of seats like invisible bubbles. Moving your camera into one makes your figure take that seat. Moving out frees the seat.</p>
            <SeatsDrawing hex={picked.hex} />
          </Guide>
          <Guide icon={<MousePointerClick className="size-4 shrink-0" />} title="How pointing and clicking works" open={open.pointing} onToggle={toggle("pointing")} asked={asked}>
            <p>When you click something in the cockpit, Dual Input traces a line from your camera through your pointer to where it meets the aircraft's 3D model, and your figure's hand reaches for that spot on the crew's screens.</p>
            <p>To find it, Dual Input reads the aircraft's model files. Marketplace aircraft usually ship them encrypted, so in those your figure's hands stay at rest.</p>
          </Guide>
          <Guide icon={<EyeOff className="size-4 shrink-0" />} title="How to hide the sim's default avatar" open={open.avatar} onToggle={toggle("avatar")}>
            <p>On a walkaround, your figure can clash with the sim's own avatar. Dual Input adds a transparent avatar to the sim, which you can pick to hide the sim's own:</p>
            <ol className="space-y-1.5">
              {["In the sim's main menu, select your name at the top right.", "Select Customize Identity.", "Pick the Dual Input transparent avatar, and save."].map((step, at) => (
                <li key={step} className="flex">
                  <span className="mr-2 w-3 shrink-0 text-right">{at + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </Guide>
        </div>
      </ScrollPage>
    </div>
  )
}

export const avatars = definePart({
  name: "avatars",
  tab: { icon: PersonStanding, label: "Figures", landing: "figures", page: FiguresPage },
})
