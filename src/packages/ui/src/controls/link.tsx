import type { AnchorHTMLAttributes, ReactNode } from "react"

import { cx } from "../lib/cx.ts"
import { showPress } from "../lib/press.ts"

const TONES = {
  primary: "text-primary",
  muted: "text-muted-foreground",
  warning: "text-warning",
  destructive: "text-destructive",
}

export type LinkTone = keyof typeof TONES
export type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { tone?: LinkTone; disabled?: boolean; icon?: ReactNode }

/**
 * Words that do what they're given, in a sentence or on their own, in a box's color where a box holds
 * them. The underline is a border on an inline element, since Coherent GT drops text-underline-offset
 * and a plain underline hugs the letters: it sits at the foot of the font's own box, a little below the
 * baseline, takes no room from the line, and follows the words onto a second. An icon sits before the
 * words, outside the line. A press moves it down a pixel, as it does a button, through `top`, since a
 * transform doesn't move an inline element. A link on its own reads as a control, so its caller gives
 * it font-medium, and one in a sentence keeps the sentence's weight.
 */
export function Link({ tone = "primary", disabled, icon, className, children, onMouseDown, ...rest }: LinkProps) {
  return (
    <a
      aria-disabled={disabled || undefined}
      className={cx("group relative cursor-pointer data-[pressed]:top-[var(--hair)]", TONES[tone], disabled && "pointer-events-none opacity-50", className)}
      onMouseDown={(event) => {
        showPress(event)
        onMouseDown?.(event)
      }}
      {...rest}
    >
      {icon && <span className="mr-3 inline-block align-text-bottom [&_svg]:size-4">{icon}</span>}
      <span className="border-b border-transparent group-hover:border-current">{children}</span>
    </a>
  )
}
