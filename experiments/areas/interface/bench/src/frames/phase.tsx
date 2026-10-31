// The session's phase, which the app's header shows in place of the mark and version while a
// session is in preflight or flying, so it shows on every page (user, 2026-10-30). The session page
// says which phase it's in, and the app's frame hands it to the header.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Headset, Plane } from "lucide-react"

import { useUI } from "@/bench/ui"

// Preflight runs from the moment the PF is in a flight on the ground
// (record/areas/session/02-units.md, Preflight), so a joiner whose PF waits at a stand is in it
// before they're in the flight, then syncing once its countdown ends. Before preflight there's
// none, and the header shows the mark. Preflight says what it is: sync hasn't started yet, rather
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
// then its name in capitals, in the same color, then a chip for each feature being shared; under
// them, from the dot's edge, for a phase that needs it, a line saying what it is, muted, cut at the
// header's room. The line keeps its words while it closes.
function PhaseFace({ phase, stage, dotStays, shared }: { phase: SessionPhase; stage: Stage; dotStays: boolean; shared: Shared }) {
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
        <SharedChips shared={shared} style={fade(stage)} />
      </div>
      <div className="overflow-hidden transition-[height] ease-in-out" style={{ height: p.line ? 16 : 0, transitionDuration: `${STEP.move}ms` }}>
        <span className="block truncate text-xs leading-4 text-muted-foreground" style={fade(stage, STEP.lineAfter)}>
          {lastLine.current}
        </span>
      </div>
    </div>
  )
}

// While traffic or ATC audio is being shared, the header carries the crew list's chip for it, its
// tab's icon in an outline, after the phase's name, so it shows on every page, and a tooltip says
// who is sharing (user, 2026-10-31). Chip and icon are the sync's green, which says engaged, as the
// phase's name does; the crew list's chips stay muted, since there they say whose role it is.
// Tried and dropped: a green bar above the tab's icon, as an Airbus FCU pushbutton's, which looked
// ugly (user, 2026-10-31).
const FEATURES: { id: SharedFeature; icon: React.ReactNode; noun: string }[] = [
  { id: "traffic", icon: <Plane />, noun: "traffic" },
  { id: "atc", icon: <Headset />, noun: "ATC" },
]
function SharedChips({ shared, style }: { shared: Shared; style: React.CSSProperties }) {
  const { Badge, Tooltip, TooltipContent, TooltipTrigger } = useUI()
  const on = FEATURES.filter((f) => shared[f.id])
  if (!on.length) return null
  return (
    <span className="flex gap-1" style={style}>
      {on.map((f) => {
        const who = shared[f.id]!
        const says = `${who === "You" ? "You're" : `${who} is`} sharing ${f.noun}`
        return (
          <Tooltip key={f.id}>
            <TooltipTrigger render={<span className="inline-flex animate-in duration-300 fade-in" />}>
              <Badge variant="outline" aria-label={says} className="border-success px-1.5 text-success">
                {f.icon}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{says}</TooltipContent>
          </Tooltip>
        )
      })}
    </span>
  )
}

// The header's start: the brand, the mark and version, or, in a session that's in preflight or
// flying, its phase. It shows one at a time, and steps from one to the next.
export function HeaderStart({ phase, shared = {}, brand }: { phase?: SessionPhase; shared?: Shared; brand: React.ReactNode }) {
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
        <PhaseFace phase={shown} stage={stage} dotStays={from !== "brand" && target !== "brand"} shared={shared} />
      )}
    </div>
  )
}
