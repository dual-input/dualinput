// A page of the app that scrolls once it holds more than the window. What's under its top goes one of
// two ways, with a clip and masks only, so nothing's laid out again (record/areas/interface/decisions.md,
// "A scrolling page folds its surfaces, and a change on a page is one moment in three steps"):
//   - A surface, a card, folds away: once its top reaches the page's top, its top edge holds there,
//     rounded as its own corners are, while what it holds scrolls up under that edge, so it shortens from
//     the top until it's gone. Its content fades just under the held edge, its surface not.
//   - Anything else fades over the page's top, through a mask of its own.
// Each card owns its fold, as an unclipped wrapper around a clipped layer and an edge layer, and registers
// them here, so one scroll loop sets two numbers on them, the clip's depth and the fade's strength.

import { createContext, useContext, useEffect, useRef } from "react"
import type { ReactNode, RefObject } from "react"

import { cx } from "../lib/cx.ts"
import { placeIn } from "./place-in.ts"
import { fadeMask, NO_SCROLLBAR, useScroller } from "./scroller.ts"

/** Over how much of the page's top what isn't a surface fades, and over how much a surface's content fades under its edge. */
const TOP_FADE = 24
const SURFACE_FADE = 16

/** A card's parts, as it registers them, and whether they're folded, so a card at rest costs a scroll no writes. */
type Fold = { wrapper: HTMLElement; clip: HTMLElement; edge: HTMLElement; content: HTMLElement; radius: string; folded: boolean }

type Registry = { add(fold: Fold): () => void; addFade(element: HTMLElement): () => void; scrollTo(element: HTMLElement): void }

const FoldContext = createContext<Registry | null>(null)

/** How long a page takes to scroll to a part a link named, in milliseconds. */
const SCROLL_TO_MS = 320

/** What scrolls the page around this component to a part of it, as View update does to Settings' update section. */
export function useScrollTo(): (element: HTMLElement) => void {
  const registry = useContext(FoldContext)
  return (element) => registry?.scrollTo(element)
}

/** Registers a card's parts with the page that scrolls it, if one does. The refs are the card's for its life. */
export function useFold(wrapper: RefObject<HTMLElement | null>, clip: RefObject<HTMLElement | null>, edge: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>): void {
  const registry = useContext(FoldContext)
  useEffect(() => {
    if (!registry || !wrapper.current || !clip.current || !edge.current || !content.current) return
    const radius = getComputedStyle(edge.current).borderTopLeftRadius
    return registry.add({ wrapper: wrapper.current, clip: clip.current, edge: edge.current, content: content.current, radius, folded: false })
  }, [registry, wrapper, clip, edge, content])
}

/** Words or controls on a scrolling page outside any card, which fade over the page's top rather than fold. */
export function Fades({ className, children }: { className?: string; children: ReactNode }) {
  const registry = useContext(FoldContext)
  const element = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!registry || !element.current) return
    return registry.addFade(element.current)
  }, [registry])
  return (
    <div ref={element} className={className}>
      {children}
    </div>
  )
}

function foldOne(fold: Fold, box: HTMLElement): void {
  const { wrapper, clip, edge, content, radius } = fold
  // The box cuts off everything above its top row, the edge's top line with it, so the card folds from
  // the moment its edge reaches that row, and the line holds there.
  const under = 1 - placeIn(wrapper, box).y
  if (under <= 0) {
    if (!fold.folded) return
    fold.folded = false
    clip.style.removeProperty("-webkit-clip-path")
    content.style.removeProperty("-webkit-mask-image")
    edge.style.top = "0"
    edge.style.display = ""
    return
  }
  fold.folded = true
  // Once the card has scrolled past whole its edge goes with it, or the last line would stay standing.
  edge.style.display = under >= wrapper.offsetHeight ? "none" : ""
  edge.style.top = `${under}px`
  clip.style.setProperty("-webkit-clip-path", `inset(${under}px 0 0 0 round ${radius})`)
  const strength = Math.min(1, under / SURFACE_FADE)
  content.style.setProperty("-webkit-mask-image", `linear-gradient(to bottom, rgba(0,0,0,${1 - strength}) ${under}px, #000 ${under + SURFACE_FADE}px)`)
}

function fadeOne(element: HTMLElement, box: HTMLElement): void {
  const top = placeIn(element, box).y
  // How far the page has left its rest, as a share of the fade, so the fade comes in with it.
  const away = Math.min(1, box.scrollTop / TOP_FADE)
  if (away === 0 || top >= TOP_FADE) {
    element.style.removeProperty("-webkit-mask-image")
    return
  }
  element.style.setProperty("-webkit-mask-image", `linear-gradient(to bottom, rgba(0,0,0,${1 - away}) ${-top}px, #000 ${TOP_FADE - top}px)`)
}

/**
 * The scroll box starts 1px above the page with 1px of padding, so its clip doesn't cut the top card's
 * edge. Coherent GT drops `gap`, so space between parts comes from `space-y`.
 */
export function ScrollPage({ className, children }: { className?: string; children: ReactNode }) {
  const folds = useRef(new Set<Fold>())
  const fades = useRef(new Set<HTMLElement>())
  const registry = useRef<Registry>({
    add(fold) {
      folds.current.add(fold)
      return () => folds.current.delete(fold)
    },
    addFade(element) {
      fades.current.add(element)
      return () => fades.current.delete(element)
    },
    scrollTo(element) {
      const box = scroller.ref.current
      if (!box) return
      const from = box.scrollTop
      const to = from + placeIn(element, box).y
      const start = performance.now()
      // How far it can go is read each frame, since what it scrolls to may still be opening.
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / SCROLL_TO_MS)
        box.scrollTop = Math.min(box.scrollHeight - box.clientHeight, from + (to - from) * (1 - (1 - t) * (1 - t)))
        if (t < 1) requestAnimationFrame(step)
      }
      step()
    },
  })
  const run = () => {
    const box = scroller.ref.current
    if (!box) return
    folds.current.forEach((fold) => foldOne(fold, box))
    fades.current.forEach((element) => fadeOne(element, box))
  }
  // A room opening above a fold moves it with no scroll, so the folds run on the box's checks too.
  const scroller = useScroller({ onMove: run, onMeasure: run })
  useEffect(() => {
    const box = scroller.ref.current
    if (!box) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(run)
    }
    box.addEventListener("scroll", onScroll)
    return () => {
      box.removeEventListener("scroll", onScroll)
      cancelAnimationFrame(frame)
    }
    // The box is the page's for its life, and `run` reads only refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="relative -mt-px flex min-h-0 flex-1 flex-col">
      <FoldContext.Provider value={registry.current}>
        <div
          ref={scroller.ref}
          onScroll={scroller.onScroll}
          onWheel={scroller.onWheel}
          onMouseDown={scroller.onMouseDown}
          className={cx("relative min-h-0 flex-1 select-none overflow-y-auto px-5 pb-5 pt-px", NO_SCROLLBAR, scroller.cursor, className)}
          // The foot fades as every box's does; the top's parts fade or fold on their own.
          style={fadeMask(false, scroller.below, 0, 32)}
        >
          <div className="space-y-6">{children}</div>
        </div>
      </FoldContext.Provider>
    </div>
  )
}
