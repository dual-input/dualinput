import type { MouseEvent as ReactMouseEvent } from "react"

/** How long a press shows at least, in milliseconds: two of the EFB's frames, which come every 66.7ms at the world map. */
const AT_LEAST = 134

/**
 * Shows a press on the element it landed on, through `data-pressed`, for as long as the mouse holds it
 * and two frames at the least. The EFB draws so seldom that a quick click's down and up often land
 * between two frames, so `:active` never paints (record/areas/interface/log.md, p24's press check).
 * Set on the element itself, so no render waits on it.
 */
export function showPress(event: ReactMouseEvent<HTMLElement>): void {
  showPressOn(event.currentTarget)
}

/** Shows a press on an element the press didn't land on, as a card's does on the card when a layer in it took the press. */
export function showPressOn(element: HTMLElement): void {
  const from = performance.now()
  element.setAttribute("data-pressed", "")
  const up = () => {
    window.removeEventListener("mouseup", up, true)
    window.setTimeout(() => element.removeAttribute("data-pressed"), Math.max(0, AT_LEAST - (performance.now() - from)))
  }
  window.addEventListener("mouseup", up, true)
}
