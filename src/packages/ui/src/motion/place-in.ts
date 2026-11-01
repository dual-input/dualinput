/**
 * Where an element shows inside a box around it, in the kit root's units: from offsets, which read the
 * same in every engine and ignore a moment's transforms, and net of what each box on the way, the outer
 * one too, has scrolled. The outer box is positioned, so the chain of offset parents ends at it.
 */
export function placeIn(element: HTMLElement, box: HTMLElement): { x: number; y: number } {
  let x = 0
  let y = 0
  let at = element
  while (at !== box) {
    x += at.offsetLeft
    y += at.offsetTop
    const parent = at.offsetParent
    if (!(parent instanceof HTMLElement)) break
    x -= parent.scrollLeft
    y -= parent.scrollTop
    at = parent
  }
  return { x, y }
}
