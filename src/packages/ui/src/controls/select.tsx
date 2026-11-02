import { Check, ChevronDown } from "lucide-react"
import { createContext, useContext, useRef, useState } from "react"
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, RefObject } from "react"
import { createPortal } from "react-dom"

import { cx } from "../lib/cx.ts"
import { useAnchored, useDismiss, usePresence } from "../lib/popup.ts"
import { useRoot } from "../lib/root.tsx"
import { fadeMask, NO_SCROLLBAR, useScroller } from "../motion/scroller.ts"

type SelectValue = {
  value: string
  choose: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  trigger: RefObject<HTMLButtonElement | null>
}

const SelectContext = createContext<SelectValue | null>(null)

function useSelect(): SelectValue {
  const select = useContext(SelectContext)
  if (!select) throw new Error("a part of a Select sits outside its Select")
  return select
}

export type SelectProps = { value: string; onValueChange: (value: string) => void; open?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }

/** A choice of one from a list that opens over the page. `open` holds it open from outside, as the kit's page does. */
export function Select({ value, onValueChange, open: openFromOutside, onOpenChange, children }: SelectProps) {
  const [openHere, setOpenHere] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const open = openFromOutside ?? openHere
  const setOpen = (next: boolean) => {
    setOpenHere(next)
    onOpenChange?.(next)
  }
  return (
    <SelectContext.Provider
      value={{
        value,
        open,
        setOpen,
        trigger,
        choose(chosen) {
          onValueChange(chosen)
          setOpen(false)
        },
      }}
    >
      {children}
    </SelectContext.Provider>
  )
}

/** What shows while the list is shut: whatever it's given, since a choice can read as more than its row, and a chevron. */
export function SelectTrigger({ className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { open, setOpen, trigger } = useSelect()
  return (
    <button
      ref={trigger}
      type="button"
      aria-haspopup="listbox"
      aria-expanded={open}
      className={cx("flex h-9 w-fit items-center justify-between whitespace-nowrap rounded-3xl border border-transparent bg-field px-3 py-2 text-sm disabled:pointer-events-none disabled:opacity-50", className)}
      onClick={() => setOpen(!open)}
      {...rest}
    >
      <span className="flex min-w-0 items-center space-x-1.5">{children}</span>
      <ChevronDown className="pointer-events-none ml-1.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  )
}

export function SelectContent({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const { open, setOpen, trigger } = useSelect()
  const { element: root } = useRoot()
  const popup = useRef<HTMLDivElement>(null)
  const { mounted, leaving } = usePresence(open)
  const placed = useAnchored(mounted, trigger, popup, { side: "bottom", align: "center", offset: 4 })
  useDismiss(open, [popup, trigger], () => setOpen(false))
  const scroller = useScroller()
  if (!mounted || !root) return null
  return createPortal(
    <div
      ref={popup}
      role="listbox"
      className={cx("absolute z-50 min-w-36 rounded-3xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10", leaving ? "animate-pop-out" : "animate-pop-in", className)}
      style={{ left: placed?.left, top: placed?.top, width: trigger.current?.offsetWidth, visibility: placed ? "visible" : "hidden" }}
      {...rest}
    >
      {/* It scrolls as every box does, since a VR pointer has no wheel, and it's apart from the popup so its fades leave the popup's edge alone. */}
      <div
        ref={scroller.ref}
        onScroll={scroller.onScroll}
        onWheel={scroller.onWheel}
        onMouseDown={scroller.onMouseDown}
        className={cx("max-h-64 select-none overflow-y-auto p-1.5", NO_SCROLLBAR, scroller.cursor)}
        style={fadeMask(scroller.above, scroller.below, 24, 24)}
      >
        {children}
      </div>
    </div>,
    root,
  )
}

export function SelectItem({ value, disabled, className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { value: string; disabled?: boolean }) {
  const { value: chosen, choose } = useSelect()
  const selected = value === chosen
  return (
    <div
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      className={cx("relative flex w-full cursor-default items-center rounded-2xl py-2 pl-3 pr-8 text-sm font-medium hover:bg-accent hover:text-accent-foreground", disabled && "pointer-events-none opacity-50", className)}
      onClick={() => !disabled && choose(value)}
      {...rest}
    >
      <span className="flex min-w-0 flex-1 items-center space-x-2 whitespace-nowrap">{children}</span>
      {selected && (
        <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
          <Check className="size-4" aria-hidden />
        </span>
      )}
    </div>
  )
}
