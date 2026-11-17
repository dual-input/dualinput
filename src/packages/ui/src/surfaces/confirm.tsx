import { useState } from "react"
import type { ReactNode } from "react"

import { Button } from "../controls/button.tsx"
import type { ButtonSize, ButtonVariant } from "../controls/button.tsx"
import { cx } from "../lib/cx.ts"
import type { Align } from "../lib/place.ts"
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx"

// While it asks, the button that opened it looks pressed in, the same way on every one: a solid
// button softens to the tinted version of its color, so the solid color is the action's own button
// alone, and a button already tinted at rest fades to 60%. Written out whole, since Tailwind finds a
// class only where its full name appears.
const PRESSED: Partial<Record<ButtonVariant, string>> = {
  default: "data-[open]:bg-primary/20 data-[open]:text-primary data-[open]:hover:bg-primary/20",
  warning: "data-[open]:bg-warning/20 data-[open]:text-warning data-[open]:hover:bg-warning/20",
  danger: "data-[open]:bg-destructive/20 data-[open]:text-destructive data-[open]:hover:bg-destructive/20",
  destructive: "data-[open]:opacity-60",
}

export type ConfirmProps = {
  /** What the button that asks says. */
  children: ReactNode
  question: string
  /** What the action's own button says. */
  go: string
  onConfirm: () => void
  /** A second, gentler answer before the action's own button, as Join's Set up only is before Join now. */
  also?: { label: string; onSelect: () => void }
  variant?: ButtonVariant
  size?: ButtonSize
  disabled?: boolean
  /** The action's own button, which by default looks like the button that asks. */
  goVariant?: ButtonVariant
  /** Classes for the action's own button, as Join now takes the sim's flight-button yellow. */
  goClassName?: string
  align?: Align
  className?: string
  /** Holds it open, as the kit's page does. */
  open?: boolean
}

/**
 * A button for an action that's hard to take back, which asks first in the kit's popover: the question,
 * and the action's own button at the far end, with no explanation, since a simmer knows the
 * consequences, and no Cancel, since a press outside or Escape cancels. It opens above the button, or
 * below where there's no room, pointing at it, lined up as the button lines up in what holds it
 * (record/areas/interface/decisions.md, "A dangerous action asks in the kit's popover, with no Cancel").
 */
export function Confirm({ children, question, go, onConfirm, also, variant = "default", size, disabled, goVariant, goClassName, align = "center", className, open: openFromOutside }: ConfirmProps) {
  const [openHere, setOpenHere] = useState(false)
  const open = openFromOutside ?? openHere
  return (
    <Popover open={open} onOpenChange={setOpenHere}>
      <PopoverTrigger>
        <Button variant={variant} size={size} disabled={disabled} className={cx(PRESSED[variant], className)}>
          {children}
        </Button>
      </PopoverTrigger>
      {/* Its corners run parallel to the button's: the button's 10.4px, plus 1px of border and 12px of padding. */}
      <PopoverContent side="top" align={align} offset={11} arrow className="flex items-center rounded-[23.4px] py-3 pl-5 pr-3">
        <span className="whitespace-nowrap text-sm font-medium">{question}</span>
        <div className="ml-4 flex items-center space-x-2">
          {also && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOpenHere(false)
                also.onSelect()
              }}
            >
              {also.label}
            </Button>
          )}
          <Button
            size="sm"
            variant={goVariant ?? (variant === "destructive" ? "danger" : variant)}
            className={goClassName}
            onClick={() => {
              setOpenHere(false)
              onConfirm()
            }}
          >
            {go}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
