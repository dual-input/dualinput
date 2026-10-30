// A box in the EFB app that scrolls when it runs past its room, with what its fades need: whether
// there's more above and below. Give it ref, onScroll, onMouseDown, the cursor class, and
// NO_SCROLLBAR.
import { useEffect, useLayoutEffect, useRef, useState } from "react"

// The app's scrolling boxes draw no scrollbar: their fades say there's more above or below, and
// dragging anywhere on one scrolls it, so a scrollbar would only take 6px of the box's width the
// moment it overflowed. Coherent GT keeps ::-webkit-scrollbar, where it drops scrollbar-width.
export const NO_SCROLLBAR = "[&::-webkit-scrollbar]:w-0"

export function useScroller() {
  const ref = useRef<HTMLDivElement>(null)
  const [above, setAbove] = useState(false)
  const [below, setBelow] = useState(false)
  const [dragging, setDragging] = useState(false)
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
  // Dragging anywhere on the box scrolls it, which a mouse in the sim and a VR pointer can do where
  // there's no wheel. Coherent GT has no PointerEvent, so the drag follows the mouse's events, from
  // the window so it keeps going off the box. It starts only past 4px, so a click still clicks. The
  // release that ends a drag would click a button under it, so the click after a drag is swallowed.
  // The canvas can zoom the frame, so the drag is scaled to the box's own pixels.
  const onMouseDown = (e: React.MouseEvent) => {
    const s = ref.current
    if (!s || e.button !== 0) return
    const scale = s.getBoundingClientRect().height / s.offsetHeight || 1
    const y0 = e.clientY
    const top0 = s.scrollTop
    let moved = false
    const move = (m: MouseEvent) => {
      const dy = (m.clientY - y0) / scale
      if (!moved && Math.abs(dy) < 4) return
      moved = true
      setDragging(true)
      s.scrollTop = top0 - dy
    }
    const swallow = (c: MouseEvent) => {
      c.stopPropagation()
      c.preventDefault()
    }
    const up = () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
      setDragging(false)
      if (!moved) return
      window.addEventListener("click", swallow, { capture: true, once: true })
      // A release off every button sends no click, so the swallow mustn't wait for a later one.
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0)
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
  }
  const cursor = dragging ? "cursor-grabbing" : above || below ? "cursor-grab" : ""
  return { ref, onScroll: measure, onMouseDown, above, below, cursor }
}
