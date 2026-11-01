// A box that scrolls when it runs past its room, by the wheel or a drag anywhere on it, with what its
// fades need: whether there's more above and below. It draws no scrollbar, since its fades say there's
// more, and a scrollbar would take 6px of its width the moment it overflowed.

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react"

import { useRoot } from "../lib/root.tsx"

/** Coherent GT keeps ::-webkit-scrollbar, where it drops scrollbar-width. A box that scrolls down scrolls down alone, so a line that runs too wide can't bring a scrollbar along its foot. */
export const NO_SCROLLBAR = "overflow-x-hidden [&::-webkit-scrollbar]:w-0"

// A drag let go of while moving coasts on, slowing as iOS's scroll views do: each millisecond keeps
// DECELERATION of the speed, iOS's fast rate, since a mouse lets go while still moving where a finger
// slows before lifting. Only a flick coasts: a drag let go of slower than FLING_SPEED, in pixels a
// millisecond, stops where it is, and a coast stops at STOP_SPEED or at either end, since a slow drag
// coasting on crawled as if in slow motion. The speed is read over VELOCITY_WINDOW, in milliseconds, so
// one jittery move doesn't set it, and a drag that paused that long before letting go has none left.
const DECELERATION = 0.99
const FLING_SPEED = 0.3
const STOP_SPEED = 0.05
const VELOCITY_WINDOW = 80
// A glide to a place, as a page settling where it should land, is a spring with no bounce that starts at
// the speed the box already has, so letting go of a flick carries straight into it. Its response, in
// seconds, as SwiftUI's springs give theirs: 0.3s spent its last few pixels creeping and read as soft.
const SPRING_RESPONSE = 0.2
/** How far a press moves before it's a drag rather than a click, in the root's units. */
const DRAG_AFTER = 4

// A box nested in another, as a list's window in a page, takes a drag only if it can scroll the way the
// drag goes; otherwise the page takes it, as iOS's nested scroll views do between gestures. The innermost
// box decides first, since its press handler, and so its move handler, comes first.
let dragTakenBy: HTMLElement | null = null

export type ScrollerOptions = {
  nested?: boolean
  /** Given where a coast would end, where it should land instead, or nothing to let it end there. */
  settleAt?: (end: number) => number | undefined
  /** Follows every scroll the box makes itself, in the same frame, so a page drawn from the scroll never lags it. */
  onMove?: () => void
  /** Where a motion of the box's own is going as it starts, and null when a press or a wheel stops one. */
  onMotion?: (to: number | null) => void
}

export function useScroller({ nested, ...said }: ScrollerOptions = {}) {
  const { scale } = useRoot()
  const ref = useRef<HTMLDivElement>(null)
  const [above, setAbove] = useState(false)
  const [below, setBelow] = useState(false)
  const [dragging, setDragging] = useState(false)
  const told = useRef(said)
  told.current = said
  const measure = () => {
    const box = ref.current
    if (!box) return
    setAbove(box.scrollTop > 1)
    setBelow(box.scrollHeight - box.scrollTop - box.clientHeight > 1)
  }
  useLayoutEffect(measure)
  // Something easing on the page can shorten the box without a render here, so it measures again when an
  // easing ends, Coherent GT having no ResizeObserver.
  useEffect(() => {
    window.addEventListener("transitionend", measure, true)
    return () => window.removeEventListener("transitionend", measure, true)
  })

  const frame = useRef(0)
  const pressed = useRef(false)
  const stop = () => {
    if (!frame.current) return
    cancelAnimationFrame(frame.current)
    frame.current = 0
    told.current.onMotion?.(null)
  }
  useEffect(() => stop, [])
  const end = (box: HTMLElement) => box.scrollHeight - box.clientHeight
  const scrollTo = (box: HTMLElement, top: number) => {
    box.scrollTop = top
    told.current.onMove?.()
  }
  /** Where a coast at speed `v` ends, as the decelerating speed would carry it. */
  const coastEnd = (box: HTMLElement, v: number) => Math.min(end(box), Math.max(0, box.scrollTop + (v * DECELERATION) / (1 - DECELERATION)))

  /** Glides to `top` from the speed `v` it has: a spring damped just enough not to bounce, whose offset is (x0 + (v0 + w x0) t) e^(-w t). */
  const glideTo = (top: number, v = 0) => {
    const box = ref.current
    if (!box) return
    stop()
    told.current.onMotion?.(top)
    const w = (2 * Math.PI) / SPRING_RESPONSE
    const x0 = box.scrollTop - top
    const v0 = v * 1000
    let start: number | undefined
    const step = (now: number) => {
      if (start === undefined) start = now
      const t = (now - start) / 1000
      const fall = Math.exp(-w * t)
      const x = (x0 + (v0 + w * x0) * t) * fall
      const speed = (v0 - w * (v0 + w * x0) * t) * fall
      const done = Math.abs(x) < 0.5 && Math.abs(speed) < 20
      scrollTo(box, done ? top : top + x)
      frame.current = done ? 0 : requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }

  const coast = (speed: number) => {
    const box = ref.current
    if (!box) return
    stop()
    told.current.onMotion?.(coastEnd(box, speed))
    let v = speed
    let at = box.scrollTop
    let last: number | undefined
    const step = (now: number) => {
      const dt = last === undefined ? 16 : now - last
      last = now
      v *= DECELERATION ** dt
      at = Math.min(end(box), Math.max(0, at + v * dt))
      scrollTo(box, at)
      frame.current = Math.abs(v) < STOP_SPEED || at <= 0 || at >= end(box) ? 0 : requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }

  /** Letting go: where the coast would end decides whether the page settles somewhere else or coasts on. */
  const letGo = (v: number) => {
    const box = ref.current
    if (!box) return
    const to = told.current.settleAt?.(coastEnd(box, v))
    if (to !== undefined) glideTo(to, v)
    else if (Math.abs(v) >= STOP_SPEED) coast(v)
  }

  /**
   * Dragging anywhere scrolls it, which a mouse in the sim and a VR pointer can do where there's no wheel.
   * The drag follows the window's mouse events, so it keeps going off the box, and it starts only past
   * DRAG_AFTER, so a click still clicks. The release that ends a drag would click a button under it, so
   * the click after a drag is swallowed.
   */
  const onMouseDown = (event: ReactMouseEvent) => {
    const box = ref.current
    if (!box || event.button !== 0) return
    stop()
    pressed.current = true
    const y0 = event.clientY
    const top0 = box.scrollTop
    let moved = false
    const trail: [number, number][] = []
    const abandon = () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
      pressed.current = false
    }
    const move = (m: MouseEvent) => {
      const dy = (m.clientY - y0) / scale
      if (!moved && Math.abs(dy) < DRAG_AFTER) return
      if (!moved) {
        if (dragTakenBy && dragTakenBy !== box) return abandon()
        if (nested) {
          // A drag upward scrolls the box down.
          if (dy < 0 ? box.scrollTop >= end(box) - 1 : box.scrollTop <= 1) return abandon()
          dragTakenBy = box
        }
      }
      moved = true
      setDragging(true)
      scrollTo(box, top0 - dy)
      const now = performance.now()
      trail.push([now, box.scrollTop])
      while (trail.length > 2 && now - trail[0]![0] > VELOCITY_WINDOW) trail.shift()
    }
    const swallow = (click: MouseEvent) => {
      click.stopPropagation()
      click.preventDefault()
    }
    const up = () => {
      abandon()
      dragTakenBy = null
      setDragging(false)
      const now = performance.now()
      const first = trail[0]
      const last = trail[trail.length - 1]
      const v = first && last && first !== last && now - last[0] < VELOCITY_WINDOW ? (last[1] - first[1]) / (last[0] - first[0]) : 0
      letGo(Math.abs(v) < FLING_SPEED ? 0 : v)
      if (!moved) return
      window.addEventListener("click", swallow, { capture: true, once: true })
      // A release off every button sends no click, so the swallow mustn't wait for a later one.
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0)
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
  }

  const cursor = dragging ? "cursor-grabbing" : above || below ? "cursor-grab" : ""
  /** Whether the box is being scrolled other than by a wheel: held, coasting, or gliding. */
  const moving = () => pressed.current || frame.current !== 0
  return { ref, onScroll: measure, onMouseDown, onWheel: stop, above, below, cursor, glideTo, moving }
}

/**
 * The fades at a box's ends while there's more that way: a mask on the box itself, its content fading out
 * to what's behind, since a layer of the background over it left a row at full strength past its edge at
 * a fraction of a pixel (measured in Chromium, 2026-10-31). A mask is clipped with what it masks, so the
 * two can't part. Each ramp turns off by moving out past the box's edge, so a fade comes and goes over
 * 200ms. Coherent GT keeps the -webkit- mask properties (record/areas/architecture/coherent-gt.md).
 */
export function fadeMask(above: boolean, below: boolean, top: number, bottom: number): CSSProperties {
  const off = (above ? 0 : top) + (below ? 0 : bottom)
  return {
    WebkitMaskImage: `linear-gradient(to bottom, transparent, #000 ${top}px, #000 calc(100% - ${bottom}px), transparent)`,
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskSize: `100% calc(100% + ${off}px)`,
    WebkitMaskPosition: `0 ${above ? 0 : -top}px`,
    transition: "-webkit-mask-size 200ms ease-out, -webkit-mask-position 200ms ease-out",
  }
}
