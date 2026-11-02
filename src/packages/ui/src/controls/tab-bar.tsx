import type { ComponentType, HTMLAttributes } from "react"

import { cx } from "../lib/cx.ts"

export type TabItem<Id extends string> = {
  id: Id
  icon: ComponentType<{ className?: string }>
  label: string
  /** An amber dot at the icon's lower right, while the tab holds a warning. */
  dot?: boolean
  force?: "hover"
}

export type TabBarProps<Id extends string> = Omit<HTMLAttributes<HTMLElement>, "onSelect"> & { tabs: TabItem<Id>[]; active: Id; onSelect?: (id: Id) => void }

// The dot comes in once a page's moment has settled and leaves with what's fading, and it swells a
// little past its size as it arrives.
const DOT_IN = "opacity 180ms ease-out 270ms, transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1) 270ms"
const DOT_OUT = "opacity 120ms ease-in, transform 120ms ease-in"

/** The app's row of icons, each named only for a screen reader (user, 2026-11-02). */
export function TabBar<Id extends string>({ tabs, active, onSelect, className, ...rest }: TabBarProps<Id>) {
  return (
    <nav className={cx("flex h-14 shrink-0 border-t", className)} {...rest}>
      {tabs.map(({ id, icon: Icon, label, dot, force }) => (
        <button
          key={id}
          type="button"
          aria-label={label}
          aria-current={id === active ? "page" : undefined}
          data-force={force}
          className={cx("relative flex flex-1 items-center justify-center hover:text-foreground", id === active ? "text-primary" : "text-muted-foreground")}
          onClick={() => onSelect?.(id)}
        >
          {id === active && <span className="absolute inset-x-4 -top-px h-0.5 rounded-full bg-primary" />}
          <span className="relative flex">
            <Icon className="size-5" />
            <span
              aria-label={dot ? "Needs attention" : undefined}
              aria-hidden={!dot}
              className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-warning ring-2 ring-background"
              style={{ opacity: dot ? 1 : 0, transform: dot ? "none" : "scale(0.4)", transition: dot ? DOT_IN : DOT_OUT }}
            />
          </span>
        </button>
      ))}
    </nav>
  )
}
