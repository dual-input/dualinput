import { Check, Minus } from "lucide-react"
import type { ButtonHTMLAttributes } from "react"

import { cx } from "../lib/cx.ts"

export type CheckboxProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & { checked: boolean | "mixed"; onCheckedChange?: (checked: boolean) => void }

/**
 * A box that ticks on a press, shadcn's Luma checkbox, its unticked fill the 90% wash a switch's track takes. `mixed` is
 * the partly-ticked state of a box over others of which some are ticked, and a press on it ticks them all. As with a
 * switch, the row that holds one may make itself the target (record/areas/interface/decisions.md, "The sharing card is
 * one row in every state").
 */
export function Checkbox({ checked, onCheckedChange, className, onClick, ...rest }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={cx(
        "relative flex size-4 shrink-0 items-center justify-center rounded-[5px] border disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5",
        checked === false ? "border-transparent bg-track" : "border-primary bg-primary text-primary-foreground",
        className,
      )}
      onClick={(event) => {
        onClick?.(event)
        onCheckedChange?.(checked !== true)
      }}
      {...rest}
    >
      {checked === "mixed" ? <Minus aria-hidden /> : checked ? <Check aria-hidden /> : null}
    </button>
  )
}
