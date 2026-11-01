/** A box in the kit root's own units. */
export type Box = { left: number; top: number; width: number; height: number }
export type Side = "top" | "bottom"
export type Align = "start" | "center" | "end"
export type Placement = { side?: Side; align?: Align; offset?: number; inset?: number }
/** Where a popup goes, the side it took, and how far along its width the anchor's center falls. */
export type Placed = { left: number; top: number; side: Side; arrow: number }

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

/**
 * Places a popup against its anchor, inside `bounds`: on the side asked for, or the other where only
 * that one has room, and moved along the anchor's edge as far as it must to stay `inset` inside.
 */
export function place(anchor: Box, popup: { width: number; height: number }, bounds: Box, { side = "bottom", align = "center", offset = 4, inset = 8 }: Placement = {}): Placed {
  const roomAbove = anchor.top - bounds.top - inset
  const roomBelow = bounds.top + bounds.height - inset - (anchor.top + anchor.height)
  const needed = popup.height + offset
  const fits = side === "top" ? roomAbove >= needed : roomBelow >= needed
  const otherFits = side === "top" ? roomBelow >= needed : roomAbove >= needed
  const taken: Side = fits || !otherFits ? side : side === "top" ? "bottom" : "top"
  const wanted = align === "start" ? anchor.left : align === "end" ? anchor.left + anchor.width - popup.width : anchor.left + (anchor.width - popup.width) / 2
  const left = clamp(wanted, bounds.left + inset, Math.max(bounds.left + inset, bounds.left + bounds.width - inset - popup.width))
  const top = taken === "top" ? anchor.top - offset - popup.height : anchor.top + anchor.height + offset
  return { left, top, side: taken, arrow: anchor.left + anchor.width / 2 - left }
}
