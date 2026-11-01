import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { RefObject } from "react"

import { place } from "./place.ts"
import type { Placed, Placement } from "./place.ts"
import { useRoot } from "./root.tsx"

/** A popup stays mounted this long after it closes, in milliseconds, so its way out can play. */
const EXIT = 100

/** Keeps a popup mounted through its way out: `leaving` is true from its close until it unmounts. */
export function usePresence(open: boolean): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = window.setTimeout(() => setMounted(false), EXIT)
    return () => window.clearTimeout(timer)
  }, [open])
  return { mounted: open || mounted, leaving: !open }
}

/** Places a popup against its anchor, in the kit root's units, and again whenever the page moves under it. */
export function useAnchored(open: boolean, anchor: RefObject<HTMLElement | null>, popup: RefObject<HTMLElement | null>, placement: Placement): Placed | null {
  const { element: root } = useRoot()
  const [placed, setPlaced] = useState<Placed | null>(null)
  const latest = useRef(placement)
  latest.current = placement
  useLayoutEffect(() => {
    if (!open || !root) return
    const update = () => {
      const from = anchor.current
      const box = popup.current
      if (!from || !box) return
      const origin = root.getBoundingClientRect()
      const at = from.getBoundingClientRect()
      const next = place(
        { left: at.left - origin.left, top: at.top - origin.top, width: at.width, height: at.height },
        { width: box.offsetWidth, height: box.offsetHeight },
        { left: 0, top: 0, width: root.offsetWidth, height: root.offsetHeight },
        latest.current,
      )
      setPlaced((last) => (last && last.left === next.left && last.top === next.top && last.side === next.side && last.arrow === next.arrow ? last : next))
    }
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [open, root, anchor, popup])
  return placed
}

/** Closes a popup on a press outside every one of `inside`, or on Escape, which arrives by its keyCode alone in the EFB. */
export function useDismiss(open: boolean, inside: RefObject<HTMLElement | null>[], onDismiss: () => void): void {
  const latest = useRef(onDismiss)
  latest.current = onDismiss
  useEffect(() => {
    if (!open) return
    const onPress = (event: MouseEvent) => {
      const target = event.target as Node
      if (!inside.some((ref) => ref.current?.contains(target))) latest.current()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.keyCode === 27) latest.current()
    }
    document.addEventListener("mousedown", onPress)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPress)
      document.removeEventListener("keydown", onKey)
    }
    // The refs a popup passes are its own for its whole life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}
