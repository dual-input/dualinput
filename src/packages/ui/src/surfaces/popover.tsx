import { cloneElement, createContext, useContext, useEffect, useRef, useState } from "react"
import type { HTMLAttributes, ReactElement, ReactNode, Ref, RefObject } from "react"
import { createPortal } from "react-dom"

import { cx } from "../lib/cx.ts"
import { useAnchored, useDismiss, usePresence } from "../lib/popup.ts"
import type { Align, Side } from "../lib/place.ts"
import { useRoot } from "../lib/root.tsx"

type PopoverValue = { open: boolean; setOpen: (open: boolean) => void; trigger: RefObject<HTMLElement | null> }

const PopoverContext = createContext<PopoverValue | null>(null)

function usePopover(): PopoverValue {
  const popover = useContext(PopoverContext)
  if (!popover) throw new Error("a part of a Popover sits outside its Popover")
  return popover
}

export function Popover({ open: openFromOutside, onOpenChange, children }: { open?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }) {
  const [openHere, setOpenHere] = useState(false)
  const trigger = useRef<HTMLElement>(null)
  const open = openFromOutside ?? openHere
  const setOpen = (next: boolean) => {
    setOpenHere(next)
    onOpenChange?.(next)
  }
  return <PopoverContext.Provider value={{ open, setOpen, trigger }}>{children}</PopoverContext.Provider>
}

type TriggerProps = { ref?: Ref<HTMLElement>; onClick?: (event: never) => void; "aria-expanded"?: boolean; "data-open"?: string }

/** Makes its one child open and shut the popover. A press on it while open shuts it, so a double click can't confirm. */
export function PopoverTrigger({ children }: { children: ReactElement<TriggerProps> }) {
  const { open, setOpen, trigger } = usePopover()
  return cloneElement(children, {
    ref: trigger,
    "aria-expanded": open,
    "data-open": open ? "" : undefined,
    onClick: (event: never) => {
      children.props.onClick?.(event)
      setOpen(!open)
    },
  })
}

export type PopoverContentProps = HTMLAttributes<HTMLDivElement> & { side?: Side; align?: Align; offset?: number; arrow?: boolean }

/** The arrow's side in px, and where the popup's line runs around it. */
const ARROW = 14

/** It takes the focus as it opens, so Enter can't press the button behind it. */
export function PopoverContent({ side = "bottom", align = "center", offset = 4, arrow, className, children, ...rest }: PopoverContentProps) {
  const { open, setOpen, trigger } = usePopover()
  const { element: root } = useRoot()
  const popup = useRef<HTMLDivElement>(null)
  const { mounted, leaving } = usePresence(open)
  const placed = useAnchored(mounted, trigger, popup, { side, align, offset })
  useDismiss(open, [popup, trigger], () => setOpen(false))
  useEffect(() => {
    if (open && placed) popup.current?.focus()
    // It takes the focus once, when it's placed and showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, placed === null])
  if (!mounted || !root) return null
  const above = placed?.side === "top"
  return createPortal(
    <div
      ref={popup}
      tabIndex={-1}
      className={cx("absolute z-50 rounded-3xl border border-foreground/10 bg-popover text-sm text-popover-foreground shadow-lg outline-none", leaving ? "animate-pop-out" : "animate-pop-in", className)}
      style={{ left: placed?.left, top: placed?.top, visibility: placed ? "visible" : "hidden" }}
      {...rest}
    >
      {children}
      {arrow && placed && (
        <span
          aria-hidden
          className={cx("absolute rounded-[3px] border-foreground/10 bg-popover", above ? "border-b border-r" : "border-l border-t")}
          style={{
            width: ARROW,
            height: ARROW,
            left: placed.arrow - ARROW / 2,
            [above ? "bottom" : "top"]: 0,
            transform: `translateY(${above ? "50%" : "-50%"}) rotate(45deg)`,
          }}
        />
      )}
    </div>,
    root,
  )
}
