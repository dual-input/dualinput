import type { ButtonHTMLAttributes, ComponentProps } from "react"

import { cx } from "../lib/cx.ts"

/**
 * The choices a radio group holds, one of which is picked. shadcn's Luma RadioGroup spaces them with a grid's `gap`,
 * which Coherent GT drops, so the kit makes no `gap` class (record/areas/architecture/coherent-gt.md). The caller sets
 * the space with a margin instead: `space-y-3` gives bare radios Luma's 12px, and a choice in a padded row wants less.
 * The group sets none of its own, since two classes setting one margin would win by the stylesheet's order.
 */
export function RadioGroup({ className, ...rest }: ComponentProps<"div">) {
  return <div role="radiogroup" className={cx("w-full", className)} {...rest} />
}

export type RadioGroupItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & { checked: boolean; onPick?: () => void }

/**
 * One choice's circle, shadcn's Luma radio, its unpicked fill the wash a checkbox's unticked box takes, and a dot of the
 * main color's text when picked. Luma squares the circle with `aspect-ratio`, which Coherent GT takes only with
 * `-webkit-` (record/areas/architecture/coherent-gt.md), and centers the dot with translates; `size-4` already squares
 * it, and the dot centers in a flex box, as the checkbox's tick does. As with a checkbox, the row that holds one may make itself the target, and the circle then takes
 * no press of its own.
 */
export function RadioGroupItem({ checked, onPick, className, onClick, ...rest }: RadioGroupItemProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className={cx("flex size-4 shrink-0 items-center justify-center rounded-full border border-transparent disabled:pointer-events-none disabled:opacity-50", checked ? "bg-primary text-primary-foreground" : "bg-track", className)}
      onClick={(event) => {
        onClick?.(event)
        if (!checked) onPick?.()
      }}
      {...rest}
    >
      {checked && <span aria-hidden className="size-2 rounded-full bg-primary-foreground" />}
    </button>
  )
}
