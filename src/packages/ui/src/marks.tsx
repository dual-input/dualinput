import { Loader2 } from "lucide-react"
import type { HTMLAttributes, LabelHTMLAttributes, SVGAttributes } from "react"

import { spaced } from "./controls/button.tsx"
import { cx } from "./lib/cx.ts"

const BADGES = {
  secondary: "border-transparent bg-secondary text-secondary-foreground",
  outline: "border-border text-foreground",
  primary: "border-transparent bg-primary text-primary-foreground",
  // A status chip is soft: its color at 15% behind text in its color.
  info: "border-transparent bg-info/15 text-info",
  warning: "border-transparent bg-warning/15 text-warning",
  trouble: "border-transparent bg-destructive/15 text-destructive",
  success: "border-transparent bg-success/15 text-success",
}

export type BadgeVariant = keyof typeof BADGES

export function Badge({ variant = "secondary", className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span className={cx("inline-flex h-5 shrink-0 items-center justify-center space-x-1 overflow-hidden whitespace-nowrap rounded-3xl border px-2 py-0.5 text-xs font-medium [&>svg]:pointer-events-none [&>svg]:size-3", BADGES[variant], className)} {...rest}>
      {spaced(children)}
    </span>
  )
}

const KBD_SIZES = { default: "h-5.5 min-w-5.5 rounded-lg px-1.5 text-xs", sm: "h-4 min-w-4 rounded-md px-1 text-[10px]" }

/** A key to press. `sm` is for a row of key hints under a list, where several share a narrow line. */
export function Kbd({ size = "default", className, ...rest }: HTMLAttributes<HTMLElement> & { size?: keyof typeof KBD_SIZES }) {
  return <kbd className={cx("pointer-events-none inline-flex select-none items-center justify-center bg-muted font-sans font-medium text-muted-foreground", KBD_SIZES[size], className)} {...rest} />
}

export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cx("flex select-none items-center text-sm font-medium leading-none", className)} {...rest} />
}

/**
 * A hairline is a border, since a root scaled below 1 rounds a 1px height down to nothing, where a
 * border keeps its pixel (record/areas/interface/log.md, p24).
 */
export function Separator({ vertical, className, ...rest }: HTMLAttributes<HTMLDivElement> & { vertical?: boolean }) {
  return <div role="separator" className={cx("shrink-0 border-border", vertical ? "self-stretch border-l" : "w-full border-t", className)} {...rest} />
}

export function Spinner({ className, ...rest }: SVGAttributes<SVGSVGElement>) {
  return <Loader2 role="status" aria-label="Loading" className={cx("size-4 animate-spin", className)} {...rest} />
}
