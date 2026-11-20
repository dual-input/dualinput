import { cloneElement, useRef, useState } from "react"
import type { ReactElement, ReactNode, Ref } from "react"
import { createPortal } from "react-dom"

import { cx } from "../lib/cx.ts"
import { useAnchored, usePresence } from "../lib/popup.ts"
import type { Align, Side } from "../lib/place.ts"
import { useRoot } from "../lib/root.tsx"

type TriggerProps = { ref?: Ref<HTMLElement>; onMouseEnter?: (event: never) => void; onMouseLeave?: (event: never) => void }

export type TooltipProps = {
  content: ReactNode
  /** The one element it explains. A disabled button takes no mouse, so give it a span around that button. */
  children: ReactElement<TriggerProps>
  side?: Side
  align?: Align
  className?: string
  /** Holds it open, as the kit's page does. */
  open?: boolean
}

const ARROW = 10

export function Tooltip({ content, children, side = "top", align = "center", className, open: openFromOutside }: TooltipProps) {
  const [hovered, setHovered] = useState(false)
  const open = openFromOutside ?? hovered
  const { element: root } = useRoot()
  const trigger = useRef<HTMLElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const { mounted, leaving } = usePresence(open)
  const placed = useAnchored(mounted, trigger, popup, { side, align, offset: 6 })
  const above = placed?.side === "top"
  return (
    <>
      {cloneElement(children, {
        ref: trigger,
        onMouseEnter: (event: never) => {
          children.props.onMouseEnter?.(event)
          setHovered(true)
        },
        onMouseLeave: (event: never) => {
          children.props.onMouseLeave?.(event)
          setHovered(false)
        },
      })}
      {mounted &&
        root &&
        createPortal(
          <div
            ref={popup}
            role="tooltip"
            // No w-max, since Coherent GT takes the padding out of max-content under border-box, so
            // the words wrap; an absolute box left to its width fits its words
            // (record/areas/architecture/coherent-gt.md, "CSS").
            className={cx("pointer-events-none absolute z-50 max-w-xs rounded-xl bg-foreground px-3 py-1.5 text-xs text-background", leaving ? "animate-pop-out" : "animate-pop-in", className)}
            style={{ left: placed?.left, top: placed?.top, visibility: placed ? "visible" : "hidden" }}
          >
            {content}
            {placed && (
              <span
                aria-hidden
                className="absolute rounded-[2px] bg-foreground"
                style={{ width: ARROW, height: ARROW, left: placed.arrow - ARROW / 2, [above ? "bottom" : "top"]: 0, transform: `translateY(${above ? "50%" : "-50%"}) rotate(45deg)` }}
              />
            )}
          </div>,
          root,
        )}
    </>
  )
}
