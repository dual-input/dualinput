// A box in the EFB app that scrolls when it runs past its room, with what its fades need: whether
// there's more above and below. Give it ref, onScroll, onMouseDown, onWheel, the cursor class, and
// NO_SCROLLBAR.
import { useEffect, useLayoutEffect, useRef, useState } from "react"

// The app's scrolling boxes draw no scrollbar: their fades say there's more above or below, and
// dragging anywhere on one scrolls it, so a scrollbar would only take 6px of the box's width the
// moment it overflowed. Coherent GT keeps ::-webkit-scrollbar, where it drops scrollbar-width.
export const NO_SCROLLBAR = "[&::-webkit-scrollbar]:w-0"

// A drag let go of while moving coasts on, slowing as iOS's scroll views do: each millisecond keeps
// DECELERATION of the speed, so a coast travels about 100 times its speed in pixels a millisecond
// (Apple, UIScrollView.DecelerationRate.fast). It's iOS's fast rate rather than its normal 0.998,
// since a mouse lets go while still moving where a finger slows before lifting: a release at
// 0.5px/ms coasted 240px over 1.2s at 0.998, and coasts 50px over 0.23s at 0.99 (user, 2026-10-30,
// measured in the bench). Only a flick coasts: a drag let go of slower than
// FLING_SPEED, in pixels a millisecond, stops where it is, and a coast stops once it's down to
// STOP_SPEED, under a pixel a frame, or at either end, since a slow drag coasting on, and every
// coast's last second at 0.01, crawled as if in slow motion (user, 2026-10-30). A drag that had
// paused for VELOCITY_WINDOW before letting go has no speed left; the speed is read over that
// window, in milliseconds, so one jittery move doesn't set it.
const DECELERATION = 0.99
const FLING_SPEED = 0.3
const STOP_SPEED = 0.05
const VELOCITY_WINDOW = 80
// A glide to a place, as a page settling where it should land, is a spring with no bounce that
// starts at the speed the box already has, so letting go of a flick carries straight into it. Its
// response is SPRING_RESPONSE, in seconds, as SwiftUI's springs give theirs: 0.3s spent its last
// few pixels creeping for 200ms and read as soft (user, 2026-10-30).
const SPRING_RESPONSE = 0.2

// A box nested in another, as a list's window in a page, takes a drag only if it can scroll the way
// the drag goes, and the page lets it be; otherwise the page takes it, so dragging past the list's
// end moves the page, as iOS's nested scroll views do between gestures. The innermost box decides
// first, since its press handler, and so its move handler, comes first, and it says so here.
let dragTakenBy: HTMLElement | null = null

// settleAt, given where a coast would end, says where it should land instead, or nothing to let it
// end there; onMove follows every scroll the box makes itself, in the same frame, so a page drawn
// from the scroll never lags it by the frame a scroll event takes to arrive; onMotion hears where
// a motion of the box's own, a glide or a coast, is going as it starts, and nothing when a press
// or a wheel stops one; onLift follows a finger leaving the box. A finger scrolls a box itself, as
// a phone's browser does, which the bench is tried on by touch (phone.tsx): the box only notes it's
// held meanwhile, so a page that snaps once the scroll rests doesn't while a finger rests on it.
type Told = { settleAt?: (end: number) => number | undefined; onMove?: () => void; onMotion?: (to: number | null) => void; onLift?: () => void }
export function useScroller({ nested, ...said }: Told & { nested?: boolean } = {}) {
  const ref = useRef<HTMLDivElement>(null)
  const [above, setAbove] = useState(false)
  const [below, setBelow] = useState(false)
  const [dragging, setDragging] = useState(false)
  const told = useRef<Told>(said)
  told.current = said
  const measure = () => {
    const s = ref.current
    if (!s) return
    setAbove(s.scrollTop > 1)
    setBelow(s.scrollHeight - s.scrollTop - s.clientHeight > 1)
  }
  useLayoutEffect(measure)
  // On home, the start card easing open over a refusal shortens the box without a render here, so
  // it measures again when an easing on the page ends.
  useEffect(() => {
    const page = ref.current?.closest("[data-home-page]")
    page?.addEventListener("transitionend", measure)
    return () => page?.removeEventListener("transitionend", measure)
  })

  // The box's own motion, a coast or a glide, which a press or a wheel stops.
  const frame = useRef(0)
  const pressed = useRef(false)
  const stop = () => {
    if (!frame.current) return
    cancelAnimationFrame(frame.current)
    frame.current = 0
    told.current.onMotion?.(null)
  }
  useEffect(() => stop, [])
  const end = (s: HTMLElement) => s.scrollHeight - s.clientHeight
  // Where a coast from top at speed v ends, as the decelerating speed would carry it.
  const coastEnd = (s: HTMLElement, v: number) => Math.min(end(s), Math.max(0, s.scrollTop + (v * DECELERATION) / (1 - DECELERATION)))
  const scrollTo = (s: HTMLElement, top: number) => {
    s.scrollTop = top
    told.current.onMove?.()
  }
  // Glides to top, from the speed v it has, in pixels a millisecond: a spring damped just enough not
  // to bounce, whose offset from where it's going is (x0 + (v0 + w x0) t) e^(-w t).
  const glideTo = (top: number, v = 0) => {
    const s = ref.current
    if (!s) return
    stop()
    told.current.onMotion?.(top)
    const w = (2 * Math.PI) / SPRING_RESPONSE
    const x0 = s.scrollTop - top
    const v0 = v * 1000
    let start: number | undefined
    const step = (now: number) => {
      if (start === undefined) start = now
      const t = (now - start) / 1000
      const fall = Math.exp(-w * t)
      const x = (x0 + (v0 + w * x0) * t) * fall
      const speed = (v0 - w * (v0 + w * x0) * t) * fall
      const done = Math.abs(x) < 0.5 && Math.abs(speed) < 20
      scrollTo(s, done ? top : top + x)
      frame.current = done ? 0 : requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }
  const coast = (v: number) => {
    const s = ref.current
    if (!s) return
    stop()
    told.current.onMotion?.(coastEnd(s, v))
    let at = s.scrollTop
    let last: number | undefined
    const step = (now: number) => {
      const dt = last === undefined ? 16 : now - last
      last = now
      v *= DECELERATION ** dt
      at = Math.min(end(s), Math.max(0, at + v * dt))
      scrollTo(s, at)
      frame.current = Math.abs(v) < STOP_SPEED || at <= 0 || at >= end(s) ? 0 : requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }
  // Letting go: the coast's end, projected as the decelerating speed would carry it, decides
  // whether the page settles somewhere else, gliding there from the speed it was let go at, or
  // coasts on.
  const letGo = (v: number) => {
    const s = ref.current
    if (!s) return
    const to = told.current.settleAt?.(coastEnd(s, v))
    if (to !== undefined) glideTo(to, v)
    else if (Math.abs(v) >= STOP_SPEED) coast(v)
  }

  // Dragging anywhere on the box scrolls it, which a mouse in the sim and a VR pointer can do where
  // there's no wheel. Coherent GT has no PointerEvent, so the drag follows the mouse's events, from
  // the window so it keeps going off the box. It starts only past 4px, so a click still clicks. The
  // release that ends a drag would click a button under it, so the click after a drag is swallowed.
  // The canvas can zoom the frame, so the drag is scaled to the box's own pixels.
  const onMouseDown = (e: React.MouseEvent) => {
    const s = ref.current
    if (!s || e.button !== 0) return
    stop()
    pressed.current = true
    const scale = s.getBoundingClientRect().height / s.offsetHeight || 1
    const y0 = e.clientY
    const top0 = s.scrollTop
    let moved = false
    const trail: [number, number][] = []
    const abandon = () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
      pressed.current = false
    }
    const move = (m: MouseEvent) => {
      const dy = (m.clientY - y0) / scale
      if (!moved && Math.abs(dy) < 4) return
      if (!moved) {
        if (dragTakenBy && dragTakenBy !== s) return abandon()
        if (nested) {
          // A drag upward scrolls the box down.
          if (dy < 0 ? s.scrollTop >= end(s) - 1 : s.scrollTop <= 1) return abandon()
          dragTakenBy = s
        }
      }
      moved = true
      setDragging(true)
      scrollTo(s, top0 - dy)
      const now = performance.now()
      trail.push([now, s.scrollTop])
      while (trail.length > 2 && now - trail[0][0] > VELOCITY_WINDOW) trail.shift()
    }
    const swallow = (c: MouseEvent) => {
      c.stopPropagation()
      c.preventDefault()
    }
    const up = () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
      pressed.current = false
      dragTakenBy = null
      setDragging(false)
      const now = performance.now()
      const first = trail[0]
      const last = trail[trail.length - 1]
      const v = last && first !== last && now - last[0] < VELOCITY_WINDOW ? (last[1] - first[1]) / (last[0] - first[0]) : 0
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
  const onTouchStart = () => {
    stop()
    pressed.current = true
  }
  const onTouchEnd = () => {
    pressed.current = false
    told.current.onLift?.()
  }
  // Whether the box is being scrolled other than by a wheel: held, coasting, or gliding.
  const moving = () => pressed.current || frame.current !== 0
  return { ref, onScroll: measure, onMouseDown, onWheel: stop, onTouchStart, onTouchEnd, above, below, cursor, glideTo, moving }
}

// The fades at a scroll box's ends, while there's more that way: a mask on the box itself, its
// content fading out to what's behind, rather than a layer of the background over it. A layer
// ending on the box's edge left a row of what scrolled under at full strength past it wherever the
// canvas put the box at a fraction of a pixel, since the box's clip rounds out to the row its edge
// falls in and the layer covered a sliver of that row; a layer reaching 1px past the edge fixed the
// top but would cover the tab bar's border at the bottom, and clipping that layer at the box's
// edges rounded otherwise than the box's own clip (user, 2026-10-31; measured in Chromium, a row at
// up to 163 of 255 at 1x, 1.25x, 1.75x, and 2x). A mask is clipped with what it masks, so the two
// can't part. Each ramp turns off by moving out past the box's edge, the mask's size and place
// easing, so a fade comes and goes over 200ms as the layers' opacity did. Coherent GT keeps the
// -webkit- mask properties (record/areas/architecture/coherent-gt.md).
// Each ramp is straight, 24px at the top of a page and 32px at its foot, the overlays' look to the
// pixel, measured side by side at one scroll position in Chromium. Tried and dropped: eased ramps
// of 16px and 20px, which came out steeper, the card's top edge appearing all at once (user,
// 2026-10-31: "the old implementation was a gentler/softer gradient").
export function fadeMask(above: boolean, below: boolean, top: number, bottom: number): React.CSSProperties {
  const off = (above ? 0 : top) + (below ? 0 : bottom)
  return {
    WebkitMaskImage: `linear-gradient(to bottom, transparent, #000 ${top}px, #000 calc(100% - ${bottom}px), transparent)`,
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskSize: `100% calc(100% + ${off}px)`,
    WebkitMaskPosition: `0 ${above ? 0 : -top}px`,
    transition: "-webkit-mask-size 200ms ease-out, -webkit-mask-position 200ms ease-out",
  }
}

// A page of the app that scrolls once it holds more than the window, for every page but home,
// whose session card folds as it scrolls. Like home's, it draws no scrollbar, fades at either end
// while there's more that way (fadeMask), and scrolls on a drag anywhere. The scroll box starts 1px
// above the page with 1px of padding, so its clip doesn't cut the top card's border, and the page's
// parts keep their height rather than shrinking to fit (user, 2026-10-31: a page built without
// these brought back a scrollbar and a clipped border).
export function ScrollPage({ children }: { children: React.ReactNode }) {
  const scroller = useScroller()
  return (
    <div className="relative -mt-px flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller.ref}
        onScroll={scroller.onScroll}
        onWheel={scroller.onWheel}
        onMouseDown={scroller.onMouseDown}
        onTouchStart={scroller.onTouchStart}
        onTouchEnd={scroller.onTouchEnd}
        onTouchCancel={scroller.onTouchEnd}
        className={"flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 pt-px pb-5 select-none [&>*]:shrink-0 " + NO_SCROLLBAR + " " + scroller.cursor}
        style={fadeMask(scroller.above, scroller.below, 24, 32)}
      >
        {children}
      </div>
    </div>
  )
}
