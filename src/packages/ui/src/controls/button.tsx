import { Children, Fragment, isValidElement } from "react"
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react"

import { cx } from "../lib/cx.ts"
import { showPress } from "../lib/press.ts"

const BASE =
  "inline-flex shrink-0 items-center justify-center whitespace-nowrap border bg-clip-padding text-sm font-medium select-none data-[pressed]:translate-y-[var(--hair)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"

const VARIANTS = {
  default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
  outline: "border-border hover:bg-outline-hover hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
  secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary-hover aria-expanded:bg-secondary",
  ghost: "border-transparent hover:bg-muted/50 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
  destructive: "border-transparent bg-destructive/20 text-destructive hover:bg-destructive/30",
  // A solid button in a status color, for the action of a box in that color, which takes the box's
  // whole palette (record/areas/interface/decisions.md, "The apps' words follow a few rules").
  success: "border-transparent bg-success text-success-foreground hover:bg-success/90",
  warning: "border-transparent bg-warning text-warning-foreground hover:bg-warning/90",
  danger: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90",
}

const SIZES = {
  xs: "h-6 rounded-4xl space-x-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
  sm: "h-8 rounded-4xl space-x-1 px-3 [&_svg:not([class*='size-'])]:size-4",
  default: "h-9 rounded-4xl space-x-1.5 px-3 [&_svg:not([class*='size-'])]:size-4",
  lg: "h-10 rounded-4xl space-x-1.5 px-4 [&_svg:not([class*='size-'])]:size-4",
  "icon-sm": "size-8 rounded-4xl [&_svg:not([class*='size-'])]:size-4",
  icon: "size-9 rounded-4xl [&_svg:not([class*='size-'])]:size-4",
}

export type ButtonVariant = keyof typeof VARIANTS
export type ButtonSize = keyof typeof SIZES
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; ref?: Ref<HTMLButtonElement> }

/**
 * Coherent GT drops `gap` (record/areas/architecture/coherent-gt.md, "CSS"), and the margins that stand
 * in for it reach only elements, so a word beside an icon needs an element of its own for the space
 * between them to land on.
 */
export function spaced(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string" || typeof child === "number") return <span>{child}</span>
    return isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment ? spaced(child.props.children) : child
  })
}

// A hover and a press show at once, with no ease, since the EFB's frames, 66.7ms apart at the world map,
// turn a short ease into a late step (record/areas/interface/log.md, p24's press check).
export function Button({ variant = "default", size = "default", type = "button", className, children, onMouseDown, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(BASE, VARIANTS[variant], SIZES[size], className)}
      onMouseDown={(event) => {
        showPress(event)
        onMouseDown?.(event)
      }}
      {...rest}
    >
      {spaced(children)}
    </button>
  )
}
