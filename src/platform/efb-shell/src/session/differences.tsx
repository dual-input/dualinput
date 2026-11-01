// The match check's differences, under the crew rows with no title of their own, since nearly every one names
// a crewmate (record/areas/interface/decisions.md, "Preflight is the session card with Ready, the differences,
// and a checklist under it"). In preflight they're listed in full, for the crew to weigh before Ready. Once the
// flight starts they fold to their counts, a count of each level and a chevron, which open the list, and the
// open list takes the counts' place and folds them back.

import { cx, placeIn, ScrollWindow } from "@dualinput/ui"
import { ChevronDown, ChevronUp, CircleX, Info, TriangleAlert } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import type { Difference } from "../../../../engines/messages/ts/session/Difference.ts"

/** A window of three lines and part of a fourth, so the cut line says there's more. */
const WINDOW = 128

/**
 * One form of the differences turning into the other, in milliseconds: what's marked to fade in the leaving
 * form fades out, its icons that the arriving form also has glide to where it has them, and the arriving form's
 * own words fade up in, a row at a time.
 */
const MORPH = { ms: 320, out: 110, in: 180, stagger: 40, inAfter: { open: 90, fold: 200 } }

/** Styles the elements directly, and the cleanup it returns undoes it, so a press mid-morph starts the next from where things are. */
function morph(box: HTMLElement, from: HTMLElement, to: HTMLElement, inAfter: number): () => void {
  const touched: HTMLElement[] = []
  const set = (element: HTMLElement, style: Partial<CSSStyleDeclaration>) => {
    Object.assign(element.style, style)
    touched.push(element)
  }
  set(from, { opacity: "1" })
  from.querySelectorAll<HTMLElement>("[data-fade]").forEach((part) => set(part, { transition: `opacity ${MORPH.out}ms ease-in`, opacity: "0" }))
  from.querySelectorAll<HTMLElement>("[data-morph]").forEach((icon) => {
    const target = to.querySelector<HTMLElement>(`[data-morph="${icon.dataset.morph}"]`)
    if (!target) {
      set(icon, { transition: `opacity ${MORPH.out}ms ease-in`, opacity: "0" })
      return
    }
    const a = placeIn(icon, box)
    const b = placeIn(target, box)
    set(target, { opacity: "0" })
    set(icon, { transition: `transform ${MORPH.ms}ms cubic-bezier(0.4, 0, 0.2, 1)`, transform: `translate(${b.x - a.x}px, ${b.y - a.y}px)` })
  })
  const arriving = Array.from(to.querySelectorAll<HTMLElement>("[data-fade]"))
  arriving.forEach((part) => set(part, { transition: "none", opacity: "0", transform: "translateY(4px)" }))
  void to.offsetHeight
  arriving.forEach((part) => {
    const row = part.closest("li")
    const at = row?.parentElement ? Array.from(row.parentElement.children).indexOf(row) : 0
    const delay = inAfter + at * MORPH.stagger
    Object.assign(part.style, { transition: `opacity ${MORPH.in}ms ease-out ${delay}ms, transform ${MORPH.in}ms ease-out ${delay}ms`, opacity: "1", transform: "none" })
  })
  const undo = () => touched.forEach((element) => Object.assign(element.style, { opacity: "", transform: "", transition: "" }))
  const rows = to.querySelectorAll("li").length
  const end = window.setTimeout(undo, Math.max(MORPH.ms, inAfter + Math.max(0, rows - 1) * MORPH.stagger + MORPH.in))
  return () => {
    window.clearTimeout(end)
    undo()
  }
}

function LevelIcon({ level }: { level: string }) {
  if (level === "error") return <CircleX className="size-4 text-destructive" />
  if (level === "warning") return <TriangleAlert className="size-4 text-warning" />
  return <Info className="size-4 text-muted-foreground" />
}

/** The lines: an error's icon in red, a warning's in amber, and a note's muted, the difference, and what it can cause. Marked, the first icon of each level is one the counts also have, and everything else fades, for a morph between the two. Each line fades on its own as the session card folds. */
function Lines({ differences, after, marked }: { differences: Difference[]; after?: ReactNode; marked: boolean }) {
  const first = (at: number) => differences.findIndex((difference) => difference.level === differences[at]!.level) === at
  return (
    <ul className="space-y-2 text-sm">
      {differences.map((difference, at) => (
        <li key={`${difference.item}-${difference.words}`} data-fold-fade className="flex items-start">
          <span className="mr-2 mt-0.5 shrink-0" {...(marked ? (first(at) ? { "data-morph": difference.level } : { "data-fade": "" }) : {})}>
            <LevelIcon level={difference.level} />
          </span>
          <span {...(marked ? { "data-fade": "" } : {})}>
            {difference.words}
            {difference.note && <span className="text-muted-foreground"> · {difference.note}</span>}
            {at === differences.length - 1 && after}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The press: both forms nudge down as the kit's buttons do. */
const PRESS = "data-[pressed]:translate-y-[var(--hair)]"
const HIDDEN = "pointer-events-none absolute left-0 top-0 opacity-0"

export function CrewDifferences({ differences, started, onEase }: { differences: Difference[]; started: boolean; onEase: () => void }) {
  const [open, setOpen] = useState(false)
  const expanded = !started || open
  const count = (level: string) => differences.filter((difference) => difference.level === level).length
  const errors = count("error")
  const warnings = count("warning")
  const box = useRef<HTMLDivElement>(null)
  const counts = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  useLayoutEffect(() => {
    const shown = expanded ? list.current : counts.current
    if (!shown) return
    const measured = shown.offsetHeight + parseFloat(getComputedStyle(shown).marginTop)
    if (measured !== height) setHeight(measured)
  })
  // The card eases with it, so it measures again to the height this box is easing to.
  useLayoutEffect(onEase, [height]) // eslint-disable-line react-hooks/exhaustive-deps
  const painted = useRef(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => (painted.current = true))
    return () => cancelAnimationFrame(frame)
  }, [])
  useLayoutEffect(() => {
    if (!painted.current || !box.current || !counts.current || !list.current) return
    return expanded ? morph(box.current, counts.current, list.current, MORPH.inAfter.open) : morph(box.current, list.current, counts.current, MORPH.inAfter.fold)
    // It morphs when the form changes, from the one showing before.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])
  return (
    <div ref={box} data-ease-to={height} className="relative -mb-2 mt-3" style={{ height, transition: `height ${MORPH.ms}ms ease-in-out` }}>
      {started && (
        <button
          ref={counts}
          type="button"
          aria-hidden={expanded}
          tabIndex={expanded ? -1 : 0}
          aria-expanded={false}
          aria-label={`${errors} errors and ${warnings} warnings between the crew's setups`}
          onClick={() => setOpen(true)}
          className={cx("group -mx-2 -mt-1.5 flex pt-1.5 text-sm", PRESS, expanded && HIDDEN)}
        >
          <span className="flex items-center rounded-[6px] p-2 group-hover:bg-muted/50">
            {errors > 0 && (
              <span className="mr-3 flex items-center text-destructive">
                <span data-morph="error" className="mr-1.5">
                  <CircleX className="size-4" />
                </span>
                <span data-fade>{errors}</span>
              </span>
            )}
            {warnings > 0 && (
              <span className="mr-1.5 flex items-center text-warning">
                <span data-morph="warning" className="mr-1.5">
                  <TriangleAlert className="size-4" />
                </span>
                <span data-fade>{warnings}</span>
              </span>
            )}
            <span data-fade>
              <ChevronDown className="size-4 text-muted-foreground" />
            </span>
          </span>
        </button>
      )}
      <div
        ref={list}
        role={started ? "button" : undefined}
        tabIndex={started && expanded ? 0 : undefined}
        aria-hidden={!expanded}
        aria-expanded={started ? true : undefined}
        onClick={started ? () => setOpen(false) : undefined}
        className={cx("-mx-2 rounded-[6px] p-2", started && "cursor-pointer hover:bg-muted/50", started && PRESS, !expanded && HIDDEN, !expanded && "right-0")}
      >
        <ScrollWindow max={WINDOW}>
          <Lines differences={differences} marked={started} after={started ? <ChevronUp className="ml-1.5 inline size-4 align-[-3px] text-muted-foreground" /> : undefined} />
        </ScrollWindow>
      </div>
    </div>
  )
}
