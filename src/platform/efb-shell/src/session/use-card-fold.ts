// What drives the session card's fold from the page's scroll. The page keeps the whole card's height in its
// flow, with room under the shrinking card making up the difference, so folding never changes what can be
// scrolled, and can't fold or unfold itself. A fold is never left partway: a drag let go of inside it lands on
// a form, and a wheel that stops inside it finishes the way it was going.

import { useScroller } from "@dualinput/ui"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { RefObject } from "react"

import { blendLooks, clearFold, FOLD, foldLook, foldRange, scanFold, showLook } from "./fold.ts"
import type { FoldLook, FoldParts } from "./fold.ts"

/** How much of what waits under the card shows while the whole card does, coming up to full as the card folds. */
const LIST_DIM = 0.5

const easeOut = (t: number) => 1 - (1 - t) ** 3

export function useCardFold({ foldable, inner, shown }: { foldable: boolean; inner: RefObject<HTMLElement | null>; shown: boolean }) {
  const foldBox = useRef<HTMLDivElement>(null)
  const spacer = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const chevron = useRef<HTMLSpanElement>(null)
  const parts = useRef<FoldParts | undefined>(undefined)
  const fold = useRef(0)
  const [foldedNow, setFoldedNow] = useState(false)
  const [goneUnder, setGoneUnder] = useState(false)
  const [pad, setPad] = useState(0)

  // A fold the page animates, a glide or a coast, or the flight's start unfolding the card, blends from how it looked when it set off to how it looks where it's going, by how far through the fold it's come; one a press or a wheel stops goes back to being scrubbed.
  const blend = useRef<{ from: number; to: number; start: FoldLook; end: FoldLook } | null>(null)
  const blendBetween = (from: number, to: number) => {
    blend.current = null
    const found = parts.current
    if (!found) return
    const range = foldRange(found)
    if (range <= 0) return
    const a = Math.min(Math.max(from, 0), range)
    const b = Math.min(Math.max(to, 0), range)
    if (Math.abs(b - a) < 1) return
    // Just past 0, where the row's parts stand in for the list's, in their places.
    const look = (scrolled: number) => foldLook(found, Math.max(scrolled / range, 0.001))
    blend.current = { from: a, to: b, start: look(a), end: look(b) }
  }

  /** Draws the card at fold `p`: its parts, its height, and the room under it that keeps the page's height. */
  const showFold = (p: number) => {
    fold.current = p
    const found = parts.current
    const range = found ? foldRange(found) : 0
    const running = blend.current
    if (found && running) {
      const q = Math.min(1, Math.max(0, (p * range - running.from) / (running.to - running.from)))
      if (q >= 1) blend.current = null
      else showLook(found, blendLooks(running.start, running.end, q), p * range)
    }
    if (found && !blend.current) {
      if (p <= 0) clearFold(found)
      else showLook(found, foldLook(found, p), p * range)
    }
    const shrink = p * range
    // From what the side holds, not the side's own height, which may be easing as a crew changes.
    if (foldBox.current) foldBox.current.style.height = shrink ? `${(inner.current?.offsetHeight ?? 0) - shrink}px` : ""
    if (spacer.current) spacer.current.style.height = shrink ? `${shrink}px` : ""
    list.current?.style.setProperty("--list-shown", String(LIST_DIM + (1 - LIST_DIM) * p))
    // The pill's chevron turns over as the fold passes halfway, pointing the way the pill would take it, since one turned partway read as broken.
    if (chevron.current) chevron.current.style.transform = p >= 0.5 ? "none" : "rotate(180deg)"
    setFoldedNow(p >= 1)
  }

  const foldFromScroll = () => {
    const box = scroller.ref.current
    const found = parts.current
    if (!box || !foldable || !found) return undefined
    const range = foldRange(found)
    if (range <= 0) return undefined
    // Within a pixel of either end is that end: a zoomed page's scroll stops on a fraction short of it, which left the card never quite folded.
    const top = box.scrollTop
    const p = top < 1 ? 0 : top > range - 1 ? 1 : top / range
    showFold(p)
    setGoneUnder(top > range + 1)
    return { p, range }
  }

  /** Where a coast that would end at `end` lands instead: inside the fold, on its nearer form. */
  const settleAt = (end: number) => {
    const found = parts.current
    if (!foldable || !found) return undefined
    const range = foldRange(found)
    if (end < 1 || end > range - 1) return undefined
    return end < range / 2 ? 0 : range
  }

  const scroller = useScroller({
    settleAt,
    onMove: () => foldFromScroll(),
    onMotion: (to) => {
      if (to === null || !foldable) blend.current = null
      else blendBetween(scroller.ref.current?.scrollTop ?? 0, to)
    },
  })

  // A wheel leaves no letting go, so a fold it leaves partway finishes once the scroll has rested, toward the way it was going: a wheel turned down and stopped meant to fold, wherever it stopped.
  const lastTop = useRef(0)
  const heading = useRef(0)
  const snapTimer = useRef(0)
  const onScroll = () => {
    scroller.onScroll()
    const box = scroller.ref.current
    if (box && box.scrollTop !== lastTop.current) {
      heading.current = Math.sign(box.scrollTop - lastTop.current)
      lastTop.current = box.scrollTop
    }
    const at = foldFromScroll()
    window.clearTimeout(snapTimer.current)
    if (!at || scroller.moving() || at.p <= 0 || at.p >= 1) return
    snapTimer.current = window.setTimeout(() => {
      if (!scroller.moving()) scroller.glideTo(heading.current > 0 ? at.range : 0)
    }, FOLD.snapAfter)
  }

  // The flight starting takes what waits under the card away, and a folded card unfolds by itself.
  const unfoldFrame = useRef(0)
  const unfoldByTime = () => {
    const from = fold.current
    const found = parts.current
    if (found) blendBetween(from * foldRange(found), 0)
    let start: number | undefined
    const step = (now: number) => {
      if (start === undefined) start = now
      const t = Math.min(1, (now - start) / FOLD.ms)
      showFold(from * (1 - easeOut(t)))
      unfoldFrame.current = t < 1 ? requestAnimationFrame(step) : 0
    }
    unfoldFrame.current = requestAnimationFrame(step)
  }
  useEffect(
    () => () => {
      cancelAnimationFrame(unfoldFrame.current)
      window.clearTimeout(snapTimer.current)
    },
    [],
  )

  // After every render, since what it measures can change with any of them: the fold's parts, the room under a list that runs past the page by less than the fold, so the card can always fold all the way, and the fold at the page's scroll.
  useLayoutEffect(() => {
    // A hidden tab measures nothing, which would read as a card with nothing to fold.
    if (!shown) return
    parts.current = scanFold(inner.current)
    const box = scroller.ref.current
    const found = parts.current
    const range = found ? foldRange(found) : 0
    if (!box || !foldable || !found || range <= 0) {
      if (pad) setPad(0)
      if (fold.current > 0 && !unfoldFrame.current) {
        if (found) unfoldByTime()
        else showFold(0)
      }
      return
    }
    const natural = box.scrollHeight - pad - box.clientHeight
    const want = natural > 1 ? Math.max(0, Math.ceil(range - natural)) : 0
    if (want !== pad) {
      setPad(want)
      return
    }
    foldFromScroll()
  })

  return {
    scroller,
    onScroll,
    foldBox,
    spacer,
    list,
    chevron,
    pad,
    goneUnder,
    folded: foldedNow && foldable,
    /** The pill's press: glides the page to the top, or to the fold. */
    toggle: () => {
      const found = parts.current
      scroller.glideTo(fold.current >= 0.5 ? 0 : found ? foldRange(found) : 0)
    },
    LIST_DIM,
  }
}
