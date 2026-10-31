// The session's phase, which the app's header shows in place of the mark and version while a
// session is in preflight or flying, so it shows on every page (user, 2026-10-30). The session page
// says which phase it's in, and the app's frame hands it to the header.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Headset, Plane } from "lucide-react"

import { ARRIVE, MOMENT } from "./ease"

// Preflight runs from the moment the PF is in a flight on the ground
// (record/areas/session/02-units.md, Preflight), but the header shows it to a pilot only once
// they're in the flight, with their checklist and their Ready, so a joiner still at the world map
// sees the mark (user, 2026-10-31; tried and dropped: Preflight from the PF's flight, which named a
// phase whose checklist and Ready the joiner didn't have yet, and a phase of its own for boarding);
// then syncing once its countdown ends. Before preflight there's none, and the header shows the
// mark. Preflight says what it is: sync hasn't started yet, rather
// than paused, which would say it ran and stopped, and pause is the sim's word too; syncing needs
// no explaining. The colors follow a Boeing flight mode annunciator, where a mode armed shows in
// white and engaged in green: preflight is the app's information color, a white with a cool tint,
// which plain white blended into the header, and sky stays the color of what can be pressed.
export type SessionPhase = "preflight" | "syncing"
const PHASES: Record<SessionPhase, { name: string; text: string; line?: string }> = {
  preflight: { name: "Preflight", text: "text-info", line: "Sync starts when everyone's ready" },
  syncing: { name: "Sync active", text: "text-success" },
}

// Who is sharing each feature in the session, by name, "You" for this pilot.
export type SharedFeature = "traffic" | "atc"
export type Shared = Partial<Record<SharedFeature, string>>
// A feature this pilot has turned all the way down, which reaches no one here though it's shared.
export type Quiet = Partial<Record<SharedFeature, boolean>>

export const PhaseContext = createContext<(phase: SessionPhase | undefined) => void>(() => {})

// The session page's card says its phase, and clears it when it goes, so a page with no session
// leaves the header its mark. It says it before the frame first paints, so a frame that opens in a
// phase shows it at once.
export function useShowPhase(phase: SessionPhase | undefined) {
  const show = useContext(PhaseContext)
  useLayoutEffect(() => {
    show(phase)
  }, [show, phase])
  useLayoutEffect(() => () => show(undefined), [show])
}

// Every change here is a short sequence rather than a jump, so no two words ever overlap and
// nothing moves two ways at once: what leaves fades up and out; then the layout settles, the line
// under the name opening or closing while the name, centered in the header, slides to its new
// height, with only the dot showing, easing to the new phase's color; then what arrives fades up
// in, the line just after the name. Between two phases the dot stays; between the mark and a phase,
// it leaves or arrives with the words. What a frame shows as it opens is there at once: a change
// before its first paint, such as the phase arriving from the page, doesn't ease.
const STEP = { out: 150, move: 200, in: 220, lineAfter: 80 }
type Shown = SessionPhase | "brand"
type Stage = "idle" | "out" | "move" | "in"
function usePainted() {
  const painted = useRef(false)
  useEffect(() => {
    const f = requestAnimationFrame(() => (painted.current = true))
    return () => cancelAnimationFrame(f)
  }, [])
  return painted
}

// What a leaving or arriving part looks like at each stage. Opacity and a transform alone, since
// Coherent GT lacks the translate property (record/areas/architecture/coherent-gt.md).
function fade(stage: Stage, delay = 0): React.CSSProperties {
  if (stage === "out") return { opacity: 0, transform: "translateY(-4px)", transition: `opacity ${STEP.out}ms ease-in, transform ${STEP.out}ms ease-in` }
  if (stage === "move") return { opacity: 0, transform: "translateY(4px)" }
  if (stage === "in") return { opacity: 1, transform: "none", transition: `opacity ${STEP.in}ms ease-out ${delay}ms, transform ${STEP.in}ms ease-out ${delay}ms` }
  return {}
}

// The phase: a dot in its color, pulsing while preflight waits on the crew, from the kit's ping,
// then its name in capitals, in the same color, then the icon of each feature being shared; under
// them, from the dot's edge, for a phase that needs it, a line saying what it is, muted, cut at the
// header's room. The line keeps its words while it closes.
function PhaseFace({ phase, stage, dotStays, shared, quiet }: { phase: SessionPhase; stage: Stage; dotStays: boolean; shared: Shared; quiet?: Quiet }) {
  const p = PHASES[phase]
  const lastLine = useRef(p.line)
  if (p.line) lastLine.current = p.line
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-2">
        <span className={"relative flex size-1.5 shrink-0 transition-colors " + p.text} style={{ transitionDuration: `${STEP.move}ms`, ...(dotStays ? {} : fade(stage)) }}>
          {phase === "preflight" && (
            <span className="absolute inline-flex size-full transition-opacity" style={{ opacity: stage === "out" ? 0 : 1, transitionDuration: `${STEP.out}ms` }}>
              <span className="inline-flex size-full animate-ping rounded-full bg-current opacity-75" />
            </span>
          )}
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
        <span className={"text-[10px] leading-4 font-semibold tracking-widest whitespace-nowrap uppercase " + p.text} style={fade(stage)}>
          {p.name}
        </span>
        <SharedIcons shared={shared} quiet={quiet} style={fade(stage)} />
      </div>
      <div className="overflow-hidden transition-[height] ease-in-out" style={{ height: p.line ? 16 : 0, transitionDuration: `${STEP.move}ms` }}>
        <span className="block truncate text-xs leading-4 text-muted-foreground" style={fade(stage, STEP.lineAfter)}>
          {lastLine.current}
        </span>
      </div>
    </div>
  )
}

// While traffic or ATC audio is being shared, the header shows its tab's icon after the phase's
// name, 12px, in the sync's green, which says engaged, as the name does, so it shows on every page,
// with no tooltip, since the crew list's chips say who is sharing (user, 2026-10-31). Tried and
// dropped: the crew list's chip in green, its outline and icon alike, whose bright outline read
// bigger than the crew list's faint one though both measure 26px by 20px; and a green bar above
// the tab's icon, as an Airbus FCU pushbutton's, which looked ugly (user, 2026-10-31).
// A feature this pilot has turned all the way down, ATC audio at 0%, keeps its icon, gray and
// slashed, so a pilot who turned ATC off on a past flight sees why they hear none, since the
// volume is a saved setting (user, 2026-10-31). Gray rather than red, since red is the app's
// error and a volume at 0% is the pilot's choice; and the same headset with a slash drawn over it,
// since Lucide's crossed-out icon is a headphone, which would change the icon's shape. The slash
// is drawn twice, wide in the header's background and then thin in the icon's color, so a gap
// parts it from the strokes it crosses, as Lucide's crossed-out icons are cut.
const FEATURES: { id: SharedFeature; icon: React.ReactNode; noun: string }[] = [
  { id: "traffic", icon: <Plane className="size-3 shrink-0" />, noun: "traffic" },
  { id: "atc", icon: <Headset className="size-3 shrink-0" />, noun: "ATC" },
]
function SharedIcons({ shared, quiet = {}, style }: { shared: Shared; quiet?: Quiet; style: React.CSSProperties }) {
  // Each icon is always drawn, at no width while its feature isn't shared, so one arriving or
  // leaving moves the other over rather than jumping it. It keeps to the page's moment (ease.tsx): one
  // going fades first, then its room shuts; one coming gets its room first, then fades in.
  return (
    <span className="flex items-center text-success" style={style}>
      {FEATURES.map((f, i) => {
        const on = !!shared[f.id]
        const after = FEATURES.slice(0, i).some((g) => shared[g.id])
        const hushed = on && !!quiet[f.id]
        return (
          <span
            key={f.id}
            role={on ? "img" : undefined}
            aria-label={on ? `Sharing ${f.noun}${hushed ? ", turned all the way down here" : ""}` : undefined}
            aria-hidden={!on}
            className="flex overflow-hidden"
            style={{ width: on ? 12 : 0, marginLeft: on && after ? 6 : 0, opacity: on ? 1 : 0, transform: on ? "none" : "scale(0.6)", transition: on ? `width ${MOMENT.move}ms ease-in-out ${MOMENT.out}ms, margin-left ${MOMENT.move}ms ease-in-out ${MOMENT.out}ms, opacity ${MOMENT.in}ms ease-out ${ARRIVE}ms, transform ${MOMENT.in}ms ease-out ${ARRIVE}ms` : `opacity ${MOMENT.out}ms ease-in, transform ${MOMENT.out}ms ease-in, width ${MOMENT.move}ms ease-in-out ${MOMENT.out}ms, margin-left ${MOMENT.move}ms ease-in-out ${MOMENT.out}ms` }}
          >
            <span className="relative flex transition-colors duration-200" style={{ color: hushed ? "var(--muted-foreground)" : undefined }}>
              {f.icon}
              <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" className="absolute inset-0 size-3" style={{ opacity: hushed ? 1 : 0, transition: "opacity 200ms ease-out" }} aria-hidden>
                <path d="M3 3 21 21" stroke="var(--background)" strokeWidth="6" />
                <path d="M3 3 21 21" stroke="currentColor" strokeWidth="2" />
              </svg>
            </span>
          </span>
        )
      })}
    </span>
  )
}

// The header's start: the brand, the mark and version, or, in a session that's in preflight or
// flying, its phase. It shows one at a time, and steps from one to the next.
export function HeaderStart({ phase, shared = {}, quiet, brand }: { phase?: SessionPhase; shared?: Shared; quiet?: Quiet; brand: React.ReactNode }) {
  const target: Shown = phase ?? "brand"
  const [shown, setShown] = useState<Shown>(target)
  const [stage, setStage] = useState<Stage>("idle")
  const [from, setFrom] = useState<Shown>(target)
  const painted = usePainted()
  useEffect(() => {
    if (target === shown) return
    if (!painted.current) {
      setShown(target)
      return
    }
    setFrom(shown)
    setStage("out")
    // Between the mark and a phase there's no dot to watch settle, so the arriving words follow at
    // once, after only the frame or two the browser needs to place them below their spot.
    const move = shown !== "brand" && target !== "brand" ? STEP.move : 34
    const timers = [
      window.setTimeout(() => {
        setShown(target)
        setStage("move")
      }, STEP.out),
      window.setTimeout(() => setStage("in"), STEP.out + move),
      window.setTimeout(() => setStage("idle"), STEP.out + move + STEP.in + STEP.lineAfter),
    ]
    return () => timers.forEach(clearTimeout)
    // It steps toward the target from whatever shows; a new target mid-step starts again from there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])
  return (
    <div className="flex min-w-0 items-center">
      {shown === "brand" ? (
        <div style={fade(stage)}>{brand}</div>
      ) : (
        <PhaseFace phase={shown} stage={stage} dotStays={from !== "brand" && target !== "brand"} shared={shared} quiet={quiet} />
      )}
    </div>
  )
}
