import type { ButtonHTMLAttributes } from "react"

import { cx } from "../lib/cx.ts"

export type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & { checked: boolean; onCheckedChange?: (checked: boolean) => void }

/** A pill that slides on a press. The row that holds one makes itself the target, for a VR pointer (record/areas/interface/decisions.md, "The sharing card is one row in every state"). */
export function Switch({ checked, onCheckedChange, className, onClick, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx(
        "relative inline-flex h-5 w-11 shrink-0 items-center rounded-full border-2 transition-all disabled:pointer-events-none disabled:opacity-50",
        checked ? "border-primary bg-primary" : "border-transparent bg-track",
        className,
      )}
      onClick={(event) => {
        onClick?.(event)
        onCheckedChange?.(!checked)
      }}
      {...rest}
    >
      <span className={cx("pointer-events-none block h-4 w-6 rounded-full shadow-sm transition-transform", checked ? "translate-x-4 bg-primary-foreground" : "translate-x-0 bg-foreground")} />
    </button>
  )
}
