import type { ReactNode } from "react"

import { cx } from "../lib/cx.ts"
import { fadeMask, NO_SCROLLBAR, useScroller } from "./scroller.ts"

/**
 * How far the window reaches past its list, taken back with as much negative margin, since a box that
 * scrolls clips what reaches past it: the 8px ring a pressed Ready spreads, and a head's nose as it turns.
 */
const ROOM = 8

/**
 * A list that scrolls in a window of its own once it runs past `max`, so the card around it stays short
 * enough to fold in one gesture. A drag stays with it while it can scroll the way the drag goes and passes
 * to the page past its end, and fades at its edges say there's more.
 */
export function ScrollWindow({ max, className, children }: { max?: number; className?: string; children: ReactNode }) {
  const scroller = useScroller({ nested: true })
  return (
    <div className="relative">
      <div
        ref={scroller.ref}
        data-scroll-window
        onScroll={scroller.onScroll}
        onMouseDown={scroller.onMouseDown}
        onWheel={scroller.onWheel}
        className={cx("relative overflow-y-auto", NO_SCROLLBAR, scroller.cursor, className)}
        style={{ maxHeight: max === undefined ? undefined : max + 2 * ROOM, margin: -ROOM, padding: ROOM, ...fadeMask(scroller.above, scroller.below, 24, 24) }}
      >
        {children}
      </div>
    </div>
  )
}
