// How big a pixel of ours is in the view the EFB gives us. A browser would do this through its
// device pixel ratio, which reads 1 in the EFB's document, and the view runs from 456px to 632px
// wide at the tablet's three sizes in one window, so a bigger tablet draws the same page bigger only
// if we say so (record/areas/interface/decisions.md, "The EFB app fits its view with zoom on its
// root"). Layout is flexbox's, so nothing here says how anything fills the view.

import { useEffect, useState, useSyncExternalStore } from "react"

/** The width the frames are drawn at, which the view's shorter side counts as. */
export const DESIGN_WIDTH = 516

type Observable = { get(): number; sub(handler: () => void): unknown }

declare global {
  interface Window {
    // The app area the EFB publishes, which holds its dock too (measured on MSFS 2024, 2026-10-30,
    // record/areas/interface/log.md). Turning the tablet swaps its sides and keeps its scale, where
    // the view's own sides differ by the dock.
    PanelSize?: { width: Observable; height: Observable }
  }
}

export type ViewSize = { width: number; height: number; scale: number }

/** The view's size in the kit root's units, and the scale, or `previous` while the view measures nothing, as it does with another window in front of the sim. */
function measure(host: HTMLElement, previous: ViewSize): ViewSize {
  const width = host.offsetWidth
  const height = host.offsetHeight
  if (width <= 0 || height <= 0) return previous
  const panel = window.PanelSize
  const shorter = panel ? Math.min(panel.width.get(), panel.height.get()) : Math.min(width, height)
  const scale = shorter > 0 ? shorter / DESIGN_WIDTH : 1
  return { width: width / scale, height: height / scale, scale }
}

/** Each view that follows the tablet, for `viewShown` to tell. */
const shownListeners = new Set<() => void>()
let everShown = false
let current = false

/**
 * The app came back on screen. The pilot can change the tablet's size in the EFB's Settings app, and
 * while another app shows, our view measures nothing, so it keeps the old scale until it's told.
 */
export function viewShown(): void {
  everShown = true
  current = true
  shownListeners.forEach((listener) => listener())
}

/** Another app took the EFB's screen. */
export function viewLeft(): void {
  current = false
}

/** Whether ours is the EFB's current app, on screen unless the EFB itself is closed, which doesn't tell us. */
export const isCurrentApp = (): boolean => current

const subscribeShown = (listener: () => void): (() => void) => {
  shownListeners.add(listener)
  return () => shownListeners.delete(listener)
}

/**
 * Whether the pilot has seen the app yet. The EFB starts our app with the sim, so a page drawn from then on would play
 * its openings to nobody, and first-time setup would be over before the pilot opened it. The EFB reports the first
 * opening with `onOpen` and `onResume` (measured on MSFS 2024, 2026-10-06, record/areas/interface/log.md).
 */
export function useEverShown(): boolean {
  return useSyncExternalStore(subscribeShown, () => everShown)
}

/**
 * Follows the view. A change of the tablet's size or turn fires a few `resize` events, and `PanelSize`
 * changes 8ms to 16ms after the last, so each is measured again a moment later (same log entry).
 * Coherent GT has no ResizeObserver.
 */
export function useViewSize(host: HTMLElement | null): ViewSize {
  const [size, setSize] = useState<ViewSize>({ width: DESIGN_WIDTH, height: DESIGN_WIDTH, scale: 1 })
  useEffect(() => {
    if (!host) return
    const update = () => setSize((last) => {
      const next = measure(host, last)
      return next.width === last.width && next.height === last.height && next.scale === last.scale ? last : next
    })
    let later = 0
    const onResize = () => {
      update()
      window.clearTimeout(later)
      later = window.setTimeout(update, 50)
    }
    update()
    window.addEventListener("resize", onResize)
    shownListeners.add(onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      shownListeners.delete(onResize)
      window.clearTimeout(later)
    }
  }, [host])
  return size
}
